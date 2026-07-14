import { randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { isIP } from 'net'
import { WebSocket, WebSocketServer } from 'ws'
import {
  ZALO_SERVER_INTERNAL_HOST,
  ZALO_SERVER_INTERNAL_PORT,
  type ZaloServerClientMessage,
  type ZaloServerCommandName,
  type ZaloServerCommandResponse,
  type ZaloServerRuntimeEvent,
  type ZaloServerRuntimeHandoffResponse,
  type ZaloServerSessionResponse,
  type ZaloServerSnapshot
} from '../../shared/zaloServerProtocol'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const AUTHENTICATE_TIMEOUT_MS = 10_000
const MAX_REQUEST_BODY_BYTES = 64 * 1024
const MAX_EVENTS_PER_STAFF = 500
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_MAX_ATTEMPTS_PER_IDENTITY = 10
const LOGIN_MAX_ATTEMPTS_PER_IP = 100
const LOGIN_ATTEMPT_BUCKET_LIMIT = 10_000
const LOGIN_ATTEMPT_PRUNE_INTERVAL_MS = 60_000

interface LoginAttemptKeys {
  identity: string
  ip: string
}

interface AuthenticatedStaff {
  staffId: number
  organizationId: number
}

interface SessionRecord extends AuthenticatedStaff {
  expiresAt: number
}

interface ClientRecord {
  socket: WebSocket
  auth: AuthenticatedStaff | null
  authTimer: ReturnType<typeof setTimeout>
  sessionToken: string | null
  sessionExpiresAt: number | null
  sessionExpiryTimer: ReturnType<typeof setTimeout> | null
  messageQueue: Promise<void>
}

export interface ZaloServerGatewayOptions {
  host?: string
  port?: number
  authenticate(username: string, password: string): Promise<AuthenticatedStaff>
  handoffToDesktop(username: string, password: string): Promise<ZaloServerRuntimeHandoffResponse>
  getSnapshot(staffId?: number): ZaloServerSnapshot
  executeCommand(staffId: number, command: ZaloServerCommandName, args: unknown[]): Promise<unknown>
  onClientCountChanged?(): void
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(body)
}

function getBearerToken(request: IncomingMessage): string | null {
  const raw = String(request.headers.authorization || '')
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BODY_BYTES) throw new Error('Request body quá lớn')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON không hợp lệ')
  return value as Record<string, unknown>
}

export class ZaloServerGateway {
  private readonly host: string
  private readonly port: number
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly clients = new Set<ClientRecord>()
  private readonly eventBuffers = new Map<number, ZaloServerRuntimeEvent[]>()
  private readonly loginAttempts = new Map<string, number[]>()
  private lastLoginAttemptPruneAt = 0
  private readonly webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_REQUEST_BODY_BYTES
  })
  private httpServer: Server | null = null
  private stopping = false
  private stopPromise: Promise<void> | null = null

  constructor(private readonly options: ZaloServerGatewayOptions) {
    this.host = options.host || ZALO_SERVER_INTERNAL_HOST
    this.port = options.port || ZALO_SERVER_INTERNAL_PORT
    this.webSocketServer.on('connection', socket => this.acceptSocket(socket))
  }

  get listeningAt(): string {
    return `http://${this.host}:${this.port}`
  }

  get connectedClientCount(): number {
    let count = 0
    for (const client of this.clients) {
      if (this.resolveClientSession(client) && client.socket.readyState === WebSocket.OPEN) count += 1
    }
    return count
  }

  async start(): Promise<void> {
    if (this.httpServer) return
    if (this.stopping) throw new Error('Zalo server gateway đã dừng')
    const server = createServer((request, response) => {
      if (this.stopping || this.httpServer !== server) {
        response.setHeader('Connection', 'close')
        json(response, 503, { error: 'Server đang dừng' })
        return
      }
      void this.handleHttp(request, response)
    })
    server.on('upgrade', (request, socket, head) => {
      if (this.stopping || this.httpServer !== server) {
        socket.destroy()
        return
      }
      const url = new URL(request.url || '/', 'http://localhost')
      if (url.pathname !== '/ws') {
        socket.destroy()
        return
      }
      this.webSocketServer.handleUpgrade(request, socket, head, ws => {
        this.webSocketServer.emit('connection', ws, request)
      })
    })
    this.httpServer = server
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error)
        server.once('error', onError)
        server.listen(this.port, this.host, () => {
          server.off('error', onError)
          resolve()
        })
      })
    } catch (error) {
      if (this.httpServer === server) this.httpServer = null
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopping = true
    this.stopPromise = this.performStop()
    return this.stopPromise
  }

  publish(event: ZaloServerRuntimeEvent): void {
    const events = this.eventBuffers.get(event.staffId) || []
    events.push(event)
    if (events.length > MAX_EVENTS_PER_STAFF) events.splice(0, events.length - MAX_EVENTS_PER_STAFF)
    this.eventBuffers.set(event.staffId, events)
    const encoded = JSON.stringify({ type: 'runtime-event', event })
    for (const client of this.clients) {
      const session = this.resolveClientSession(client)
      if (!session || session.staffId !== event.staffId || client.socket.readyState !== WebSocket.OPEN) continue
      client.socket.send(encoded)
    }
  }

  broadcastSnapshot(): void {
    for (const client of this.clients) {
      const session = this.resolveClientSession(client)
      if (!session || client.socket.readyState !== WebSocket.OPEN) continue
      client.socket.send(JSON.stringify({ type: 'snapshot', snapshot: this.options.getSnapshot(session.staffId) }))
    }
  }

  getBufferedEvents(staffId: number): ZaloServerRuntimeEvent[] {
    return [...(this.eventBuffers.get(staffId) || [])]
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (this.stopping) {
        response.setHeader('Connection', 'close')
        json(response, 503, { error: 'Server đang dừng' })
        return
      }
      const url = new URL(request.url || '/', 'http://localhost')
      if (request.method === 'GET' && url.pathname === '/health') {
        const snapshot = this.options.getSnapshot()
        json(response, snapshot.state === 'error' ? 503 : 200, {
          ok: snapshot.state !== 'error',
          state: snapshot.state,
          startedAt: snapshot.startedAt,
          vietnamTime: snapshot.vietnamTime,
          timeZoneOk: snapshot.timeZoneOk,
          runtimeCount: snapshot.runtimeCount,
          connectedClients: snapshot.connectedClients
        })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/session') {
        const body = await readJsonBody(request)
        const username = String(body.username || '').trim()
        const password = String(body.password || '')
        if (!username || !password) {
          json(response, 400, { error: 'Thiếu tên đăng nhập hoặc mật khẩu' })
          return
        }
        const loginKeys = this.getLoginAttemptKeys(request, username)
        if (!this.allowLoginAttempt(loginKeys)) {
          json(response, 429, { error: 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau.' })
          return
        }
        const auth = await this.options.authenticate(username, password)
        if (this.stopping) {
          response.setHeader('Connection', 'close')
          json(response, 503, { error: 'Server đang dừng' })
          return
        }
        this.loginAttempts.delete(loginKeys.identity)
        this.removeExpiredSessions()
        const token = randomUUID()
        const expiresAt = Date.now() + SESSION_TTL_MS
        this.sessions.set(token, { ...auth, expiresAt })
        const result: ZaloServerSessionResponse = {
          token,
          expiresAt: new Date(expiresAt).toISOString(),
          staffId: auth.staffId,
          organizationId: auth.organizationId
        }
        json(response, 200, result)
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/runtime-handoff') {
        const body = await readJsonBody(request)
        const username = String(body.username || '').trim()
        const password = String(body.password || '')
        if (!username || !password) {
          json(response, 400, { error: 'Thiếu tên đăng nhập hoặc mật khẩu' })
          return
        }
        const loginKeys = this.getLoginAttemptKeys(request, username)
        if (!this.allowLoginAttempt(loginKeys)) {
          json(response, 429, { error: 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau.' })
          return
        }
        const result = await this.options.handoffToDesktop(username, password)
        if (this.stopping) {
          response.setHeader('Connection', 'close')
          json(response, 503, { error: 'Server đang dừng' })
          return
        }
        this.loginAttempts.delete(loginKeys.identity)
        json(response, 200, result)
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/snapshot') {
        const session = this.resolveSession(getBearerToken(request))
        if (!session) {
          json(response, 401, { error: 'Phiên kết nối không hợp lệ hoặc đã hết hạn' })
          return
        }
        json(response, 200, this.options.getSnapshot(session.staffId))
        return
      }

      json(response, 404, { error: 'Not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      json(response, message.includes('đăng nhập') || message.includes('mật khẩu') || message.includes('gói') ? 401 : 500, { error: message })
    }
  }

  private acceptSocket(socket: WebSocket): void {
    if (this.stopping) {
      try { socket.close(1012, 'Server đang dừng') } catch {}
      return
    }
    const client: ClientRecord = {
      socket,
      auth: null,
      authTimer: setTimeout(() => {
        try { socket.close(4001, 'Chưa xác thực') } catch {}
      }, AUTHENTICATE_TIMEOUT_MS),
      sessionToken: null,
      sessionExpiresAt: null,
      sessionExpiryTimer: null,
      messageQueue: Promise.resolve()
    }
    this.clients.add(client)
    socket.on('message', raw => {
      const message = raw.toString()
      if (client.auth) {
        // Authenticated commands may run concurrently across accounts. Account
        // reservations inside the runtime still serialize conflicting work, while
        // cancel/pause can overtake the long operation they are meant to stop.
        void this.handleSocketMessage(client, message).catch(() => {
          if (client.socket.readyState === WebSocket.OPEN) {
            client.socket.close(1011, 'Không thể xử lý yêu cầu')
          }
        })
        return
      }
      client.messageQueue = client.messageQueue
        .then(() => this.handleSocketMessage(client, message))
        .catch(() => {
          if (client.socket.readyState === WebSocket.OPEN) {
            client.socket.close(1011, 'Không thể xử lý yêu cầu')
          }
        })
    })
    socket.on('close', () => {
      clearTimeout(client.authTimer)
      if (client.sessionExpiryTimer) clearTimeout(client.sessionExpiryTimer)
      this.clients.delete(client)
      this.options.onClientCountChanged?.()
    })
    socket.on('error', () => {
      // close event performs cleanup
    })
  }

  private async handleSocketMessage(client: ClientRecord, raw: string): Promise<void> {
    if (this.stopping || !this.clients.has(client) || client.socket.readyState !== WebSocket.OPEN) return
    let message: ZaloServerClientMessage
    try {
      message = JSON.parse(raw) as ZaloServerClientMessage
    } catch {
      client.socket.close(4002, 'JSON không hợp lệ')
      return
    }

    if (!client.auth) {
      if (message.type !== 'authenticate') {
        client.socket.close(4001, 'Chưa xác thực')
        return
      }
      const session = this.resolveSession(message.token)
      if (!session) {
        client.socket.close(4003, 'Phiên kết nối không hợp lệ hoặc đã hết hạn')
        return
      }
      client.auth = { staffId: session.staffId, organizationId: session.organizationId }
      client.sessionToken = message.token
      client.sessionExpiresAt = session.expiresAt
      clearTimeout(client.authTimer)
      this.scheduleClientSessionExpiry(client, message.token, session.expiresAt)
      client.socket.send(JSON.stringify({
        type: 'hello',
        snapshot: this.options.getSnapshot(session.staffId),
        events: this.getBufferedEvents(session.staffId)
      }))
      this.options.onClientCountChanged?.()
      return
    }

    if (message.type !== 'command') return
    const session = this.resolveClientSession(client)
    if (!session) return
    let response: ZaloServerCommandResponse
    try {
      const result = await this.options.executeCommand(session.staffId, message.command, Array.isArray(message.args) ? message.args : [])
      response = { type: 'command-result', requestId: message.requestId, ok: true, result }
    } catch (error) {
      response = {
        type: 'command-result',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(response))
  }

  private resolveSession(token: string | null): SessionRecord | null {
    if (!token) return null
    const session = this.sessions.get(token)
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token)
      return null
    }
    return session
  }

  private resolveClientSession(client: ClientRecord): SessionRecord | null {
    if (!client.auth || !client.sessionToken) return null
    const session = this.resolveSession(client.sessionToken)
    if (
      !session ||
      session.expiresAt !== client.sessionExpiresAt ||
      session.staffId !== client.auth.staffId ||
      session.organizationId !== client.auth.organizationId
    ) {
      this.closeClientForInvalidSession(client)
      return null
    }
    return session
  }

  private scheduleClientSessionExpiry(client: ClientRecord, token: string, expiresAt: number): void {
    if (client.sessionExpiryTimer) clearTimeout(client.sessionExpiryTimer)
    client.sessionExpiryTimer = setTimeout(() => {
      if (client.sessionToken !== token) return
      this.resolveClientSession(client)
    }, Math.max(0, expiresAt - Date.now()) + 1)
  }

  private closeClientForInvalidSession(client: ClientRecord): void {
    if (client.sessionExpiryTimer) {
      clearTimeout(client.sessionExpiryTimer)
      client.sessionExpiryTimer = null
    }
    if (client.sessionToken) {
      const session = this.sessions.get(client.sessionToken)
      if (session && session.expiresAt <= Date.now()) this.sessions.delete(client.sessionToken)
    }
    if (client.socket.readyState === WebSocket.OPEN || client.socket.readyState === WebSocket.CONNECTING) {
      try { client.socket.close(4003, 'Phiên kết nối không hợp lệ hoặc đã hết hạn') } catch {}
    }
  }

  private getLoginAttemptKeys(request: IncomingMessage, username: string): LoginAttemptKeys {
    const remoteAddress = request.socket.remoteAddress || 'unknown'
    let address = remoteAddress
    if (this.isLoopbackAddress(remoteAddress)) {
      const forwarded = String(request.headers['x-forwarded-for'] || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .at(-1)
      if (forwarded && isIP(forwarded)) address = forwarded
    }
    return {
      identity: `identity:${address}:${username.toLowerCase()}`,
      ip: `ip:${address}`
    }
  }

  private isLoopbackAddress(address: string): boolean {
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  }

  private allowLoginAttempt(keys: LoginAttemptKeys): boolean {
    const now = Date.now()
    this.pruneLoginAttempts(now)
    const cutoff = now - LOGIN_WINDOW_MS
    const identityAttempts = (this.loginAttempts.get(keys.identity) || [])
      .filter(timestamp => timestamp >= cutoff)
    const ipAttempts = (this.loginAttempts.get(keys.ip) || [])
      .filter(timestamp => timestamp >= cutoff)
    if (
      identityAttempts.length >= LOGIN_MAX_ATTEMPTS_PER_IDENTITY ||
      ipAttempts.length >= LOGIN_MAX_ATTEMPTS_PER_IP
    ) {
      if (this.loginAttempts.has(keys.identity)) this.loginAttempts.set(keys.identity, identityAttempts)
      if (this.loginAttempts.has(keys.ip)) this.loginAttempts.set(keys.ip, ipAttempts)
      return false
    }
    if (
      (!this.loginAttempts.has(keys.identity) || !this.loginAttempts.has(keys.ip)) &&
      this.loginAttempts.size >= LOGIN_ATTEMPT_BUCKET_LIMIT
    ) {
      return false
    }
    identityAttempts.push(now)
    ipAttempts.push(now)
    this.loginAttempts.set(keys.identity, identityAttempts)
    this.loginAttempts.set(keys.ip, ipAttempts)
    return true
  }

  private pruneLoginAttempts(now: number): void {
    if (
      now - this.lastLoginAttemptPruneAt < LOGIN_ATTEMPT_PRUNE_INTERVAL_MS &&
      this.loginAttempts.size < LOGIN_ATTEMPT_BUCKET_LIMIT
    ) {
      return
    }
    this.lastLoginAttemptPruneAt = now
    const cutoff = now - LOGIN_WINDOW_MS
    for (const [key, timestamps] of this.loginAttempts.entries()) {
      const active = timestamps.filter(timestamp => timestamp >= cutoff)
      if (active.length === 0) this.loginAttempts.delete(key)
      else if (active.length !== timestamps.length) this.loginAttempts.set(key, active)
    }
  }

  private removeExpiredSessions(): void {
    const now = Date.now()
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) this.sessions.delete(token)
    }
  }

  private async performStop(): Promise<void> {
    const server = this.httpServer
    this.httpServer = null

    for (const client of this.clients) {
      clearTimeout(client.authTimer)
      if (client.sessionExpiryTimer) clearTimeout(client.sessionExpiryTimer)
      try { client.socket.close(1001, 'Server đang dừng') } catch {}
    }

    const forceCloseTimer = setTimeout(() => {
      for (const client of this.clients) {
        if (client.socket.readyState !== WebSocket.CLOSED) {
          try { client.socket.terminate() } catch {}
        }
      }
      server?.closeAllConnections?.()
    }, 2_000)

    const closeHttp = server
      ? new Promise<void>(resolve => {
          server.close(() => resolve())
          server.closeIdleConnections?.()
        })
      : Promise.resolve()
    const closeWebSockets = new Promise<void>(resolve => {
      try {
        this.webSocketServer.close(() => resolve())
      } catch {
        resolve()
      }
    })

    await Promise.all([closeHttp, closeWebSockets])
    clearTimeout(forceCloseTimer)
    this.clients.clear()
    this.sessions.clear()
    this.loginAttempts.clear()
  }
}
