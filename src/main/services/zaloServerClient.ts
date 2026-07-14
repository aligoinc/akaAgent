import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import WebSocket from 'ws'
import { IPC_EVENTS, type AuthUser } from '../../shared/types'
import {
  ZALO_SERVER_DEFAULT_ORIGIN,
  type ZaloServerCommandName,
  type ZaloServerCommandRequest,
  type ZaloServerCommandResponse,
  type ZaloServerMessage,
  type ZaloServerRuntimeHandoffResponse,
  type ZaloServerRuntimeEvent,
  type ZaloServerSessionResponse
} from '../../shared/zaloServerProtocol'
import { SupabaseService } from './supabase'

const RECONNECT_MIN_DELAY_MS = 2_000
const RECONNECT_MAX_DELAY_MS = 30_000
const QUICK_COMMAND_TIMEOUT_MS = 10 * 60 * 1000
const CONNECT_TIMEOUT_MS = 15_000
const RUNTIME_HANDOFF_TIMEOUT_MS = 45_000

interface LoginCredentials {
  username: string
  password: string
}

interface SessionIdentity {
  staffId: number
  organizationId: number
}

interface PendingCommand {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout> | null
}

export class ZaloServerClient {
  private readonly origin: string
  private readonly supabase = new SupabaseService()
  private credentials: LoginCredentials | null = null
  private user: AuthUser | null = null
  private socket: WebSocket | null = null
  private token: string | null = null
  private authenticated = false
  private stopped = true
  private connecting = false
  private reconnectDelayMs = RECONNECT_MIN_DELAY_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pendingCommands = new Map<string, PendingCommand>()
  private lastSequence = 0
  private serverStartedAt: string | null = null
  private generation = 0
  private inboundMessageChain: Promise<void> = Promise.resolve()

  constructor(private readonly mainWindow: BrowserWindow) {
    this.origin = String(process.env.AKA_ZALO_SERVER_URL || ZALO_SERVER_DEFAULT_ORIGIN).replace(/\/+$/, '')
  }

  isEnabled(): boolean {
    return this.user?.isZaloServer === true && this.user.entitlements.zalo === true
  }

  isConnected(): boolean {
    return this.authenticated && this.socket?.readyState === WebSocket.OPEN
  }

  start(user: AuthUser, username: string, password: string): void {
    const credentials = {
      username: String(username || '').trim(),
      password: String(password || '')
    }
    const useServerRuntime = user.isZaloServer === true && user.entitlements.zalo === true
    const canReuseLifecycle = !this.stopped &&
      useServerRuntime &&
      this.user?.staffId === user.staffId &&
      this.user.organizationId === user.organizationId &&
      this.credentials?.username === credentials.username &&
      this.credentials.password === credentials.password

    if (canReuseLifecycle) {
      this.user = user
      this.credentials = credentials
      if (!this.socket && !this.connecting && !this.reconnectTimer) {
        void this.connect(this.generation)
      }
      return
    }

    this.stop()
    this.user = user
    if (!useServerRuntime) return
    this.credentials = credentials
    this.stopped = false
    void this.connect(this.generation)
  }

  stop(): void {
    this.generation += 1
    this.stopped = true
    this.connecting = false
    this.credentials = null
    this.user = null
    this.token = null
    this.authenticated = false
    this.lastSequence = 0
    this.serverStartedAt = null
    this.inboundMessageChain = Promise.resolve()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    try { socket?.close(1000, 'Desktop logout') } catch {}
    for (const pending of this.pendingCommands.values()) {
      if (pending.timeout) clearTimeout(pending.timeout)
      pending.reject(new Error('Kết nối akaAgent Zalo Server đã dừng'))
    }
    this.pendingCommands.clear()
  }

  async executeCommand<T = unknown>(command: ZaloServerCommandName, ...args: unknown[]): Promise<T> {
    const socket = this.socket
    if (!this.isEnabled()) throw new Error('Staff này không được bật chế độ chạy Zalo trên server')
    if (!this.isConnected() || !socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('akaAgent Zalo Server chưa kết nối. Vui lòng kiểm tra app server trên VPS.')
    }
    const requestId = randomUUID()
    const request: ZaloServerCommandRequest = { type: 'command', requestId, command, args }
    return await new Promise<T>((resolve, reject) => {
      const timeoutMs = this.getCommandTimeoutMs(command)
      const timeout = timeoutMs === null
        ? null
        : setTimeout(() => {
            this.pendingCommands.delete(requestId)
            reject(new Error('Server xử lý quá thời gian cho phép'))
          }, timeoutMs)
      this.pendingCommands.set(requestId, {
        resolve: value => resolve(value as T),
        reject,
        timeout
      })
      socket.send(JSON.stringify(request), error => {
        if (!error) return
        const pending = this.pendingCommands.get(requestId)
        if (!pending) return
        if (pending.timeout) clearTimeout(pending.timeout)
        this.pendingCommands.delete(requestId)
        pending.reject(error)
      })
    })
  }

  /**
   * Ask the VPS runtime to stop owning this staff before a fresh desktop-local
   * session performs any Zalo recovery. This request deliberately does not use
   * or mutate the WebSocket client lifecycle because local-mode users never
   * start a server session in this process.
   */
  async requestRuntimeHandoff(username: string, password: string): Promise<ZaloServerRuntimeHandoffResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RUNTIME_HANDOFF_TIMEOUT_MS)
    try {
      const response = await fetch(`${this.origin}/api/runtime-handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(username || '').trim(),
          password: String(password || '')
        }),
        signal: controller.signal
      })
      const value = await response.json() as Partial<ZaloServerRuntimeHandoffResponse> & { error?: string }
      if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`)
      if (
        typeof value.success !== 'boolean' ||
        typeof value.serverOwned !== 'boolean' ||
        typeof value.settled !== 'boolean' ||
        typeof value.serverStopped !== 'boolean' ||
        (value.ownership !== 'none' && value.ownership !== 'server' && value.ownership !== 'desktop-or-unknown') ||
        typeof value.requiresDesktopRecovery !== 'boolean'
      ) {
        throw new Error('App server trả về kết quả bàn giao Zalo không hợp lệ')
      }
      return value as ZaloServerRuntimeHandoffResponse
    } finally {
      clearTimeout(timeout)
    }
  }

  private async connect(generation: number): Promise<void> {
    if (!this.isCurrentGeneration(generation) || this.connecting || !this.credentials || !this.user) return
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
      return
    }

    const credentials = { ...this.credentials }
    const expectedIdentity: SessionIdentity = {
      staffId: this.user.staffId,
      organizationId: this.user.organizationId
    }
    this.connecting = true
    try {
      const session = await this.createSession(credentials, expectedIdentity)
      if (!this.isCurrentGeneration(generation)) return
      this.token = session.token
      await this.openSocket(session.token, generation)
    } catch (error) {
      if (this.isCurrentGeneration(generation)) {
        this.sendConnectionLog(`⚠️ Không kết nối được akaAgent Zalo Server: ${this.errorMessage(error)}`)
        this.scheduleReconnect(generation)
      }
    } finally {
      if (generation === this.generation) this.connecting = false
    }
  }

  private async createSession(
    credentials: LoginCredentials,
    expectedIdentity: SessionIdentity
  ): Promise<ZaloServerSessionResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
    try {
      const response = await fetch(`${this.origin}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
        signal: controller.signal
      })
      const value = await response.json() as Partial<ZaloServerSessionResponse> & { error?: string }
      if (!response.ok || !value.token) throw new Error(value.error || `HTTP ${response.status}`)
      if (Number(value.staffId) !== expectedIdentity.staffId) {
        throw new Error('Server trả về phiên đăng nhập không đúng staff')
      }
      if (Number(value.organizationId) !== expectedIdentity.organizationId) {
        throw new Error('Server trả về phiên đăng nhập không đúng organization')
      }
      return value as ZaloServerSessionResponse
    } finally {
      clearTimeout(timeout)
    }
  }

  private async openSocket(token: string, generation: number): Promise<void> {
    const url = new URL(this.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws'
    url.search = ''
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url.toString())
      this.socket = socket
      this.authenticated = false
      let opened = false
      let settled = false
      const timeout = setTimeout(() => {
        try { socket.terminate() } catch {}
        if (!settled) {
          settled = true
          reject(new Error('Kết nối WebSocket quá thời gian cho phép'))
        }
      }, CONNECT_TIMEOUT_MS)
      socket.once('open', () => {
        if (!this.isCurrentSocket(socket, generation)) {
          try { socket.terminate() } catch {}
          if (!settled) {
            settled = true
            reject(new Error('Kết nối WebSocket đã bị thay thế'))
          }
          return
        }
        opened = true
        socket.send(JSON.stringify({ type: 'authenticate', token }))
      })
      socket.on('message', raw => {
        if (!settled && this.isHelloMessage(raw.toString()) && this.isCurrentSocket(socket, generation)) {
          settled = true
          clearTimeout(timeout)
          this.authenticated = true
          this.reconnectDelayMs = RECONNECT_MIN_DELAY_MS
          this.sendConnectionLog('✅ Đã kết nối akaAgent Zalo Server.')
          resolve()
        }
        this.enqueueInboundMessage(socket, generation, raw.toString())
      })
      socket.once('error', error => {
        if (!opened) {
          clearTimeout(timeout)
          if (!settled) {
            settled = true
            reject(error)
          }
        }
      })
      socket.once('close', (_code, reason) => {
        clearTimeout(timeout)
        const isCurrentSocket = this.isCurrentSocket(socket, generation)
        if (isCurrentSocket) {
          this.socket = null
          this.authenticated = false
          this.inboundMessageChain = Promise.resolve()
          this.rejectPendingCommands('Mất kết nối akaAgent Zalo Server')
        }
        if (!settled) {
          settled = true
          reject(new Error(reason.toString() || 'WebSocket đã đóng'))
        }
        if (isCurrentSocket) this.scheduleReconnect(generation)
      })
    })
  }

  private enqueueInboundMessage(socket: WebSocket, generation: number, raw: string): void {
    this.inboundMessageChain = this.inboundMessageChain
      .then(async () => {
        if (!this.isCurrentSocket(socket, generation)) return
        await this.handleMessage(raw, socket, generation)
      })
      .catch(error => {
        if (this.isCurrentSocket(socket, generation)) {
          console.warn('[ZaloServerClient] Failed to process server message:', error)
        }
      })
  }

  private async handleMessage(raw: string, socket: WebSocket, generation: number): Promise<void> {
    if (!this.isCurrentSocket(socket, generation)) return
    let message: ZaloServerMessage
    try {
      message = JSON.parse(raw) as ZaloServerMessage
    } catch {
      return
    }
    if (message.type === 'command-result') {
      this.resolveCommand(message)
      return
    }
    if (message.type === 'hello') {
      if (this.serverStartedAt && this.serverStartedAt !== message.snapshot.startedAt) this.lastSequence = 0
      this.serverStartedAt = message.snapshot.startedAt
      await this.refreshDatabaseSnapshot(socket, generation)
      if (!this.isCurrentSocket(socket, generation)) return
      for (const event of [...message.events].sort((left, right) => left.sequence - right.sequence)) {
        if (event.channel === IPC_EVENTS.CAMPAIGN_LOG) {
          // The desktop log panel starts at the live connection boundary; old
          // server progress remains available in the server admin window only.
          this.markRuntimeEventSeen(event)
          continue
        }
        this.forwardRuntimeEvent(event)
      }
      return
    }
    if (message.type === 'runtime-event') {
      this.forwardRuntimeEvent(message.event)
      return
    }
    if (message.type === 'snapshot') {
      await this.refreshDatabaseSnapshot(socket, generation)
    }
  }

  private resolveCommand(response: ZaloServerCommandResponse): void {
    const pending = this.pendingCommands.get(response.requestId)
    if (!pending) return
    if (pending.timeout) clearTimeout(pending.timeout)
    this.pendingCommands.delete(response.requestId)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error || 'Server xử lý thất bại'))
  }

  private forwardRuntimeEvent(event: ZaloServerRuntimeEvent): void {
    if (!this.isCurrentUserEvent(event)) return
    if (event.sequence <= this.lastSequence) return
    this.lastSequence = event.sequence
    try {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(event.channel, this.markServerCampaignLog(event.channel, event.payload))
      }
    } catch {
      // renderer may be closing
    }
  }

  private markRuntimeEventSeen(event: ZaloServerRuntimeEvent): void {
    if (!this.isCurrentUserEvent(event) || event.sequence <= this.lastSequence) return
    this.lastSequence = event.sequence
  }

  private isCurrentUserEvent(event: ZaloServerRuntimeEvent): boolean {
    return !!this.user &&
      event.staffId === this.user.staffId &&
      event.organizationId === this.user.organizationId
  }

  private markServerCampaignLog(channel: string, payload: unknown): unknown {
    if (
      channel !== IPC_EVENTS.CAMPAIGN_LOG ||
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      return payload
    }
    // Keep compatibility with older server builds that do not yet attach the source.
    return { ...payload, source: 'server' }
  }

  private async refreshDatabaseSnapshot(socket: WebSocket, generation: number): Promise<void> {
    if (!this.isCurrentSocket(socket, generation)) return
    try {
      const campaigns = await this.supabase.listCampaigns()
      if (!this.isCurrentSocket(socket, generation) || this.mainWindow.isDestroyed()) return
      this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
      for (const campaign of campaigns) {
        this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, campaign)
      }
    } catch (error) {
      if (this.isCurrentSocket(socket, generation)) {
        console.warn('[ZaloServerClient] Failed to refresh DB snapshot:', error)
      }
    }
  }

  private scheduleReconnect(generation: number): void {
    if (!this.isCurrentGeneration(generation) || this.reconnectTimer) return
    const delay = this.reconnectDelayMs
    this.reconnectDelayMs = Math.min(RECONNECT_MAX_DELAY_MS, this.reconnectDelayMs * 2)
    const timer = setTimeout(() => {
      if (this.reconnectTimer === timer) this.reconnectTimer = null
      if (!this.isCurrentGeneration(generation)) return
      void this.connect(generation)
    }, delay)
    this.reconnectTimer = timer
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.stopped && generation === this.generation
  }

  private isCurrentSocket(socket: WebSocket, generation: number): boolean {
    return this.isCurrentGeneration(generation) && this.socket === socket
  }

  private rejectPendingCommands(message: string): void {
    for (const pending of this.pendingCommands.values()) {
      if (pending.timeout) clearTimeout(pending.timeout)
      pending.reject(new Error(message))
    }
    this.pendingCommands.clear()
  }

  private getCommandTimeoutMs(command: ZaloServerCommandName): number | null {
    if (
      command === 'contacts.loadFriends' ||
      command === 'contacts.loadGroups' ||
      command === 'contacts.loadZaloGroupMembers'
    ) {
      return null
    }
    return QUICK_COMMAND_TIMEOUT_MS
  }

  private isHelloMessage(raw: string): boolean {
    try {
      return (JSON.parse(raw) as { type?: unknown })?.type === 'hello'
    } catch {
      return false
    }
  }

  private sendConnectionLog(message: string): void {
    try {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_LOG, {
          timestamp: new Date().toISOString(),
          message
        })
      }
    } catch {}
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
