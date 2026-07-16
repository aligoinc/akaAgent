import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import WebSocket from 'ws'
import { IPC_EVENTS, type AuthUser } from '../../shared/types'
import {
  ZALO_SERVER_DEFAULT_ORIGIN,
  ZALO_SERVER_OPERATION_UPDATED_CHANNEL,
  type ZaloServerCommandName,
  type ZaloServerCommandRequest,
  type ZaloServerCommandResponse,
  type ZaloServerDesktopHandoffReadyResponse,
  type ZaloServerMessage,
  type ZaloServerRuntimeHandoffResponse,
  type ZaloServerRuntimeEvent,
  type ZaloServerOperationSnapshot,
  type ZaloServerOperationStateSnapshot,
  type ZaloServerSessionResponse
} from '../../shared/zaloServerProtocol'
import { SupabaseService } from './supabase'

const RECONNECT_MIN_DELAY_MS = 2_000
const RECONNECT_MAX_DELAY_MS = 120_000
const RECONNECT_STABLE_RESET_MS = 30_000
const SESSION_REUSE_SAFETY_MS = 30_000
const DATABASE_REFRESH_DEBOUNCE_MS = 300
const TRACKED_OPERATION_COMMANDS = new Set<ZaloServerCommandName>([
  'zalo.loginQr.start',
  'contacts.loadFriends',
  'contacts.loadGroups',
  'contacts.loadZaloGroupMembers'
])
const WAIT_FOR_OPERATION_COMMANDS = new Set<ZaloServerCommandName>([
  'contacts.loadFriends',
  'contacts.loadGroups',
  'contacts.loadZaloGroupMembers'
])
const QUICK_COMMAND_TIMEOUT_MS = 10 * 60 * 1000
const CONNECT_TIMEOUT_MS = 15_000
const RUNTIME_HANDOFF_TIMEOUT_MS = 45_000
const DESKTOP_HANDOFF_READY_TIMEOUT_MS = 10_000

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

interface PendingOperation {
  resolve(value: unknown): void
  reject(error: Error): void
}

export class ZaloServerClient {
  private readonly origin: string
  private readonly supabase = new SupabaseService()
  private credentials: LoginCredentials | null = null
  private user: AuthUser | null = null
  private socket: WebSocket | null = null
  private token: string | null = null
  private tokenExpiresAt = 0
  private authenticated = false
  private stopped = true
  private connecting = false
  private reconnectDelayMs = RECONNECT_MIN_DELAY_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stableConnectionTimer: ReturnType<typeof setTimeout> | null = null
  private databaseRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private databaseRefreshPromise: Promise<void> | null = null
  private databaseRefreshSocket: WebSocket | null = null
  private pendingCommands = new Map<string, PendingCommand>()
  private operationSnapshots = new Map<string, ZaloServerOperationSnapshot>()
  private pendingOperations = new Map<string, PendingOperation>()
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

  getOperationState(): ZaloServerOperationStateSnapshot {
    return {
      serverStartedAt: this.serverStartedAt,
      operations: Array.from(this.operationSnapshots.values())
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map(operation => ({ ...operation }))
    }
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
    this.tokenExpiresAt = 0
    this.authenticated = false
    this.lastSequence = 0
    this.serverStartedAt = null
    this.inboundMessageChain = Promise.resolve()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.stableConnectionTimer) clearTimeout(this.stableConnectionTimer)
    this.stableConnectionTimer = null
    if (this.databaseRefreshTimer) clearTimeout(this.databaseRefreshTimer)
    this.databaseRefreshTimer = null
    this.databaseRefreshPromise = null
    this.databaseRefreshSocket = null
    const socket = this.socket
    this.socket = null
    try { socket?.close(1000, 'Desktop logout') } catch {}
    for (const pending of this.pendingCommands.values()) {
      if (pending.timeout) clearTimeout(pending.timeout)
      pending.reject(new Error('Kết nối akaAgent Zalo Server đã dừng'))
    }
    this.pendingCommands.clear()
    this.rejectPendingOperations('Kết nối akaAgent Zalo Server đã dừng')
    this.operationSnapshots.clear()
  }

  async executeCommand<T = unknown>(command: ZaloServerCommandName, ...args: unknown[]): Promise<T> {
    const socket = this.socket
    if (!this.isEnabled()) throw new Error('Gói Zalo của doanh nghiệp không bật chế độ chạy trên server')
    if (!this.isConnected() || !socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('akaAgent Zalo Server chưa kết nối. Vui lòng kiểm tra app server trên VPS.')
    }
    const requestId = randomUUID()
    const request: ZaloServerCommandRequest = { type: 'command', requestId, command, args }
    const result = await new Promise<unknown>((resolve, reject) => {
      const timeoutMs = this.getCommandTimeoutMs(command)
      const timeout = timeoutMs === null
        ? null
        : setTimeout(() => {
            this.pendingCommands.delete(requestId)
            reject(new Error('Server xử lý quá thời gian cho phép'))
          }, timeoutMs)
      this.pendingCommands.set(requestId, {
        resolve,
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
    if (TRACKED_OPERATION_COMMANDS.has(command) && this.isOperationSnapshot(result)) {
      this.acceptOperationSnapshot(result)
      if (WAIT_FOR_OPERATION_COMMANDS.has(command)) {
        return await this.waitForOperationResult(result) as T
      }
      if (command === 'zalo.loginQr.start') {
        return {
          success: true,
          accountId: result.accountId,
          operationId: result.operationId
        } as T
      }
    }
    return result as T
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

  /**
   * Tell the VPS that the previous desktop-local runtime has stopped every
   * Zalo producer. The VPS owns the recovery/start decision so a desktop that
   * wakes late can never bulk-reset an already-running server runtime.
   */
  async requestDesktopHandoffReady(
    username: string,
    password: string,
    expectedModeRevision: string
  ): Promise<ZaloServerDesktopHandoffReadyResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DESKTOP_HANDOFF_READY_TIMEOUT_MS)
    try {
      const response = await fetch(`${this.origin}/api/runtime-handoff-ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(username || '').trim(),
          password: String(password || ''),
          expectedModeRevision: String(expectedModeRevision || '').trim()
        }),
        signal: controller.signal
      })
      const value = await response.json() as Partial<ZaloServerDesktopHandoffReadyResponse> & { error?: string }
      if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`)
      if (
        typeof value.success !== 'boolean' ||
        typeof value.serverReady !== 'boolean' ||
        typeof value.serverStarted !== 'boolean' ||
        typeof value.alreadyRunning !== 'boolean'
      ) {
        throw new Error('App server trả về kết quả nhận bàn giao Zalo không hợp lệ')
      }
      return value as ZaloServerDesktopHandoffReadyResponse
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
      const reusableToken = this.getReusableSessionToken()
      if (reusableToken) {
        try {
          await this.openSocket(reusableToken, generation)
          return
        } catch {
          if (!this.isCurrentGeneration(generation)) return
          this.token = null
          this.tokenExpiresAt = 0
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
        }
      }

      const session = await this.createSession(credentials, expectedIdentity)
      if (!this.isCurrentGeneration(generation)) return
      this.token = session.token
      this.tokenExpiresAt = Date.parse(session.expiresAt)
      await this.openSocket(session.token, generation)
    } catch (error) {
      if (this.isCurrentGeneration(generation)) {
        console.warn('[ZaloServerClient] Connection failed:', this.errorMessage(error))
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
      const expiresAt = Date.parse(String(value.expiresAt || ''))
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('Server trả về thời hạn phiên đăng nhập không hợp lệ')
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
          this.scheduleStableReconnectReset(socket, generation)
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
          if (this.stableConnectionTimer) clearTimeout(this.stableConnectionTimer)
          this.stableConnectionTimer = null
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
      const serverRestarted = !!this.serverStartedAt && this.serverStartedAt !== message.snapshot.startedAt
      if (serverRestarted) this.lastSequence = 0
      this.serverStartedAt = message.snapshot.startedAt
      this.reconcileOperationSnapshots(message.operations || [], serverRestarted)
      this.publishOperationState()
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
      if (message.event.channel === ZALO_SERVER_OPERATION_UPDATED_CHANNEL) {
        if (!this.isCurrentUserEvent(message.event)) return
        this.markRuntimeEventSeen(message.event)
        if (this.isOperationSnapshot(message.event.payload)) {
          this.acceptOperationSnapshot(message.event.payload)
        }
        return
      }
      this.forwardRuntimeEvent(message.event)
      return
    }
    if (message.type === 'snapshot') {
      this.scheduleDatabaseSnapshotRefresh(socket, generation)
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
    if (this.databaseRefreshPromise) {
      const pending = this.databaseRefreshPromise
      if (this.databaseRefreshSocket === socket) return pending
      await pending
      if (!this.isCurrentSocket(socket, generation)) return
    }
    const operation = this.performDatabaseSnapshotRefresh(socket, generation)
    this.databaseRefreshPromise = operation
    this.databaseRefreshSocket = socket
    try {
      await operation
    } finally {
      if (this.databaseRefreshPromise === operation) {
        this.databaseRefreshPromise = null
        this.databaseRefreshSocket = null
      }
    }
  }

  private async performDatabaseSnapshotRefresh(socket: WebSocket, generation: number): Promise<void> {
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

  private scheduleDatabaseSnapshotRefresh(socket: WebSocket, generation: number): void {
    if (!this.isCurrentSocket(socket, generation)) return
    if (this.databaseRefreshTimer) clearTimeout(this.databaseRefreshTimer)
    this.databaseRefreshTimer = setTimeout(() => {
      this.databaseRefreshTimer = null
      if (!this.isCurrentSocket(socket, generation)) return
      void this.refreshDatabaseSnapshot(socket, generation)
    }, DATABASE_REFRESH_DEBOUNCE_MS)
  }

  private scheduleReconnect(generation: number): void {
    if (!this.isCurrentGeneration(generation) || this.reconnectTimer) return
    const delay = Math.round(this.reconnectDelayMs * (0.5 + Math.random() * 0.5))
    this.reconnectDelayMs = Math.min(RECONNECT_MAX_DELAY_MS, this.reconnectDelayMs * 2)
    const timer = setTimeout(() => {
      if (this.reconnectTimer === timer) this.reconnectTimer = null
      if (!this.isCurrentGeneration(generation)) return
      void this.connect(generation)
    }, delay)
    this.reconnectTimer = timer
  }

  private scheduleStableReconnectReset(socket: WebSocket, generation: number): void {
    if (this.stableConnectionTimer) clearTimeout(this.stableConnectionTimer)
    this.stableConnectionTimer = setTimeout(() => {
      this.stableConnectionTimer = null
      if (!this.isCurrentSocket(socket, generation) || !this.authenticated) return
      this.reconnectDelayMs = RECONNECT_MIN_DELAY_MS
    }, RECONNECT_STABLE_RESET_MS)
  }

  private getReusableSessionToken(): string | null {
    if (!this.token || !Number.isFinite(this.tokenExpiresAt)) return null
    return this.tokenExpiresAt - SESSION_REUSE_SAFETY_MS > Date.now()
      ? this.token
      : null
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

  private waitForOperationResult(operation: ZaloServerOperationSnapshot): Promise<unknown> {
    this.acceptOperationSnapshot(operation)
    const latest = this.operationSnapshots.get(operation.operationId) || operation
    if (latest.status !== 'running') return this.operationResult(latest)
    return new Promise((resolve, reject) => {
      this.pendingOperations.set(operation.operationId, { resolve, reject })
      const current = this.operationSnapshots.get(operation.operationId)
      if (current && current.status !== 'running') this.settleOperation(current)
    })
  }

  private reconcileOperationSnapshots(
    operations: ZaloServerOperationSnapshot[],
    serverRestarted: boolean
  ): void {
    const next = new Map<string, ZaloServerOperationSnapshot>()
    for (const operation of operations) {
      if (!this.isOperationSnapshot(operation)) continue
      next.set(operation.operationId, operation)
    }
    this.operationSnapshots = next
    for (const [operationId, pending] of this.pendingOperations.entries()) {
      const operation = next.get(operationId)
      if (!operation) {
        pending.reject(new Error(serverRestarted
          ? 'App server đã khởi động lại; tác vụ trước đó đã kết thúc.'
          : 'Tác vụ không còn tồn tại trên app server.'))
        this.pendingOperations.delete(operationId)
        continue
      }
      this.settleOperation(operation)
    }
  }

  private acceptOperationSnapshot(operation: ZaloServerOperationSnapshot): void {
    const existing = this.operationSnapshots.get(operation.operationId)
    const existingTime = Date.parse(existing?.updatedAt || '')
    const incomingTime = Date.parse(operation.updatedAt || '')
    const latest = existing && (
      (existing.status !== 'running' && operation.status === 'running') ||
      (Number.isFinite(existingTime) && Number.isFinite(incomingTime) && existingTime > incomingTime)
    )
      ? existing
      : operation
    this.operationSnapshots.set(operation.operationId, latest)
    this.settleOperation(latest)
    this.publishOperationState()
  }

  private publishOperationState(): void {
    if (this.mainWindow.isDestroyed()) return
    try {
      this.mainWindow.webContents.send(
        IPC_EVENTS.ZALO_SERVER_OPERATION_STATE_UPDATED,
        this.getOperationState()
      )
    } catch {
      // renderer may be closing
    }
  }

  private settleOperation(operation: ZaloServerOperationSnapshot): void {
    if (operation.status === 'running') return
    const pending = this.pendingOperations.get(operation.operationId)
    if (!pending) return
    this.pendingOperations.delete(operation.operationId)
    if (operation.status === 'failed') {
      pending.reject(new Error(operation.error || 'Tác vụ Zalo Server không hoàn thành'))
      return
    }
    pending.resolve(this.successfulOperationResult(operation))
  }

  private operationResult(operation: ZaloServerOperationSnapshot): Promise<unknown> {
    if (operation.status === 'failed') {
      return Promise.reject(new Error(operation.error || 'Tác vụ Zalo Server không hoàn thành'))
    }
    return Promise.resolve(this.successfulOperationResult(operation))
  }

  private successfulOperationResult(operation: ZaloServerOperationSnapshot): unknown {
    if (operation.status !== 'cancelled') return operation.result
    const result = operation.result && typeof operation.result === 'object' && !Array.isArray(operation.result)
      ? { ...(operation.result as Record<string, unknown>) }
      : {}
    return {
      ...result,
      success: false,
      stopped: true,
      message: typeof result.message === 'string' && result.message.trim()
        ? result.message
        : operation.error || 'Tác vụ đã dừng.'
    }
  }

  private rejectPendingOperations(message: string): void {
    for (const pending of this.pendingOperations.values()) pending.reject(new Error(message))
    this.pendingOperations.clear()
  }

  private isOperationSnapshot(value: unknown): value is ZaloServerOperationSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const operation = value as Partial<ZaloServerOperationSnapshot>
    return typeof operation.operationId === 'string' &&
      typeof operation.command === 'string' &&
      (operation.status === 'running' || operation.status === 'completed' || operation.status === 'failed' || operation.status === 'cancelled')
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

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
