import { randomUUID, type KeyObject } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { isIP } from 'net'
import { WebSocket, WebSocketServer } from 'ws'
import {
  compileOriginPolicy,
  DEFAULT_REALTIME_ALLOWED_ORIGINS,
  isOriginAllowed,
  normalizeHttpOrigin,
  type OriginPolicy
} from './originPolicy'
import {
  loadRealtimeTicketPublicKey,
  verifyRealtimeTicketSignature
} from './realtimeTicketVerifier'
import {
  ZALO_SERVER_INTERNAL_HOST,
  ZALO_SERVER_INTERNAL_PORT,
  type ZaloServerClientMessage,
  type ZaloServerCommandName,
  type ZaloServerCommandResponse,
  type ZaloServerDesktopHandoffReadyResponse,
  type ZaloServerRuntimeEvent,
  type ZaloServerRuntimeHandoffResponse,
  type ZaloServerOperationSnapshot,
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
const CONTROL_REVALIDATION_INTERVAL_MS = 50_000
const CONTROL_TICKET_MAX_TTL_SECONDS = 60
const USED_TICKET_LIMIT = 100_000
const CONTROL_ACCESS_CACHE_MS = 45_000
const DESKTOP_DETACHED_OPERATION_COMMANDS = new Set<ZaloServerCommandName>([
  'zalo.loginQr.start',
  'contacts.loadFriends',
  'contacts.loadGroups',
  'contacts.loadZaloGroupMembers'
])

interface LoginAttemptKeys {
  identity: string
  ip: string
}

interface AuthenticatedStaff {
  staffId: number
  organizationId: number
}

interface RealtimeTicketCapabilities {
  zaloServer: boolean
  sms: boolean
}

interface RealtimeTicketPayload extends AuthenticatedStaff {
  v: 1
  jti: string
  sessionId: string
  capabilities: RealtimeTicketCapabilities
  iat: number
  exp: number
}

interface ControlClientAuth extends AuthenticatedStaff {
  kind: 'control'
  sessionId: string
  capabilities: RealtimeTicketCapabilities
}

interface DesktopClientAuth extends AuthenticatedStaff {
  kind: 'desktop'
}

type ClientAuth = ControlClientAuth | DesktopClientAuth

interface ControlAccessCacheEntry extends AuthenticatedStaff {
  sessionId: string
  allowed: boolean
  checkedAt: number
  inflight: Promise<boolean> | null
}

interface ControlCapabilityCacheEntry extends AuthenticatedStaff {
  allowed: boolean
  checkedAt: number
  inflight: Promise<boolean> | null
}

interface SessionRecord extends AuthenticatedStaff {
  expiresAt: number
}

interface ClientRecord {
  socket: WebSocket
  origin: string | null
  auth: ClientAuth | null
  authTimer: ReturnType<typeof setTimeout>
  sessionToken: string | null
  sessionExpiresAt: number | null
  sessionExpiryTimer: ReturnType<typeof setTimeout> | null
  capabilityTimer: ReturnType<typeof setTimeout> | null
  revalidationPromise: Promise<boolean> | null
  messageQueue: Promise<void>
}

export interface ZaloServerGatewayOptions {
  host?: string
  port?: number
  authenticate(username: string, password: string): Promise<AuthenticatedStaff>
  handoffToDesktop(username: string, password: string): Promise<ZaloServerRuntimeHandoffResponse>
  desktopHandoffReady(
    username: string,
    password: string,
    expectedModeRevision: string
  ): Promise<ZaloServerDesktopHandoffReadyResponse>
  getSnapshot(staffId?: number): ZaloServerSnapshot
  getOperations(staffId: number): ZaloServerOperationSnapshot[]
  executeCommand(staffId: number, command: ZaloServerCommandName, args: unknown[]): Promise<unknown>
  startControlOperation(staffId: number, command: ZaloServerCommandName, args: unknown[]): ZaloServerOperationSnapshot
  revalidateControlSession(staffId: number, organizationId: number, sessionId: string): Promise<boolean>
  revalidateControlCapability(staffId: number, organizationId: number): Promise<boolean>
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
  private readonly realtimeTicketPublicKey: KeyObject | null
  private readonly allowedOriginPolicy: OriginPolicy
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly usedTicketIds = new Map<string, number>()
  private readonly pendingTicketIds = new Set<string>()
  private readonly controlSessionCache = new Map<string, ControlAccessCacheEntry>()
  private readonly controlCapabilityCache = new Map<string, ControlCapabilityCacheEntry>()
  private readonly clients = new Set<ClientRecord>()
  private readonly clientsByStaff = new Map<string, Set<ClientRecord>>()
  private authenticatedClientCount = 0
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
    try {
      this.realtimeTicketPublicKey = loadRealtimeTicketPublicKey()
    } catch (error) {
      console.warn(
        '[ZaloServerGateway] Invalid realtime ticket public key:',
        error instanceof Error ? error.message : error
      )
      this.realtimeTicketPublicKey = null
    }
    const allowedOriginsOverride = String(process.env.AKA_AGENT_REALTIME_ALLOWED_ORIGINS || '').trim()
    this.allowedOriginPolicy = compileOriginPolicy(
      allowedOriginsOverride || DEFAULT_REALTIME_ALLOWED_ORIGINS
    )
    if (this.allowedOriginPolicy.invalidEntries.length > 0) {
      console.warn(
        '[ZaloServerGateway] Ignoring invalid realtime origin entries:',
        this.allowedOriginPolicy.invalidEntries.join(', ')
      )
    }
    this.webSocketServer.on('connection', (socket, request) => this.acceptSocket(socket, request))
  }

  get listeningAt(): string {
    return `http://${this.host}:${this.port}`
  }

  get connectedClientCount(): number {
    return this.authenticatedClientCount
  }

  async start(): Promise<void> {
    if (this.httpServer) return
    if (this.stopping) throw new Error('Zalo server gateway đã dừng')
    if (!this.realtimeTicketPublicKey || !this.allowedOriginPolicy.configured) {
      console.warn(
        '[ZaloServerGateway] Web/PWA realtime is disabled until ' +
        'an Ed25519 public key and an allowed origin policy are available.'
      )
    }
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
      const originHeader = this.readOriginHeader(request.headers.origin)
      const origin = normalizeHttpOrigin(originHeader)
      if (originHeader && (!origin || !isOriginAllowed(this.allowedOriginPolicy, origin))) {
        try {
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        } catch {}
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
    this.publishLive(event)
  }

  /**
   * Deliver transient UI state without turning it into reconnect history.
   * Campaign/account refresh notifications are useful while a client is live,
   * but they are not activity logs and a reconnect already reloads DB state.
   */
  publishLive(event: ZaloServerRuntimeEvent): void {
    this.publishToStaffClients(event, false)
  }

  /** Operation lifecycle is control state, not a user-facing activity log. */
  publishControl(event: ZaloServerRuntimeEvent): void {
    this.publishToStaffClients(event, false)
  }

  private publishToStaffClients(event: ZaloServerRuntimeEvent, controlOnly: boolean): void {
    const encoded = JSON.stringify({ type: 'runtime-event', event })
    const staffClients = this.clientsByStaff.get(this.clientStaffKey(event.staffId, event.organizationId))
    if (!staffClients) return
    for (const client of staffClients) {
      const auth = this.resolveClientAuth(client)
      if (
        !auth ||
        auth.staffId !== event.staffId ||
        auth.organizationId !== event.organizationId ||
        (controlOnly && auth.kind !== 'control') ||
        client.socket.readyState !== WebSocket.OPEN
      ) continue
      client.socket.send(encoded)
    }
  }

  broadcastSnapshot(): void {
    const encodedByAudience = new Map<string, string>()
    for (const client of this.clients) {
      const auth = this.resolveClientAuth(client)
      if (!auth || client.socket.readyState !== WebSocket.OPEN) continue
      const audienceKey = `${auth.kind}:${this.clientStaffKey(auth.staffId, auth.organizationId)}`
      let encoded = encodedByAudience.get(audienceKey)
      if (!encoded) {
        encoded = JSON.stringify({ type: 'snapshot', snapshot: this.getClientSnapshot(auth) })
        encodedByAudience.set(audienceKey, encoded)
      }
      client.socket.send(encoded)
    }
  }

  getBufferedEvents(staffId: number): ZaloServerRuntimeEvent[] {
    return [...(this.eventBuffers.get(staffId) || [])]
  }

  clearEventBuffers(): void {
    this.eventBuffers.clear()
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

      if (request.method === 'POST' && url.pathname === '/api/runtime-handoff-ready') {
        const body = await readJsonBody(request)
        const username = String(body.username || '').trim()
        const password = String(body.password || '')
        const expectedModeRevision = String(body.expectedModeRevision || '').trim()
        if (!username || !password || !expectedModeRevision) {
          json(response, 400, { error: 'Thiếu tên đăng nhập, mật khẩu hoặc revision bàn giao' })
          return
        }
        const loginKeys = this.getLoginAttemptKeys(request, username)
        if (!this.allowLoginAttempt(loginKeys)) {
          json(response, 429, { error: 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau.' })
          return
        }
        const result = await this.options.desktopHandoffReady(
          username,
          password,
          expectedModeRevision
        )
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

  private acceptSocket(socket: WebSocket, request: IncomingMessage): void {
    if (this.stopping) {
      try { socket.close(1012, 'Server đang dừng') } catch {}
      return
    }
    const client: ClientRecord = {
      socket,
      origin: normalizeHttpOrigin(this.readOriginHeader(request.headers.origin)),
      auth: null,
      authTimer: setTimeout(() => {
        try { socket.close(4001, 'Chưa xác thực') } catch {}
      }, AUTHENTICATE_TIMEOUT_MS),
      sessionToken: null,
      sessionExpiresAt: null,
      sessionExpiryTimer: null,
      capabilityTimer: null,
      revalidationPromise: null,
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
      if (client.capabilityTimer) clearTimeout(client.capabilityTimer)
      this.unregisterAuthenticatedClient(client)
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
      if (session) {
        client.auth = {
          kind: 'desktop',
          staffId: session.staffId,
          organizationId: session.organizationId
        }
        client.sessionToken = message.token
        client.sessionExpiresAt = session.expiresAt
        this.registerAuthenticatedClient(client)
        clearTimeout(client.authTimer)
        this.scheduleClientSessionExpiry(client, message.token, session.expiresAt)
        client.socket.send(JSON.stringify({
          type: 'hello',
          snapshot: this.options.getSnapshot(session.staffId),
          events: this.getBufferedEvents(session.staffId),
          operations: this.options.getOperations(session.staffId)
        }))
        this.options.onClientCountChanged?.()
        return
      }

      const ticket = await this.authenticateControlTicket(client, message.token)
      if (!ticket) return
      if (this.stopping || !this.clients.has(client) || client.socket.readyState !== WebSocket.OPEN) return
      client.auth = {
        kind: 'control',
        staffId: ticket.staffId,
        organizationId: ticket.organizationId,
        sessionId: ticket.sessionId,
        capabilities: ticket.capabilities
      }
      this.registerAuthenticatedClient(client)
      clearTimeout(client.authTimer)
      this.scheduleControlRevalidation(client)
      client.socket.send(JSON.stringify({
        type: 'hello',
        snapshot: this.getClientSnapshot(client.auth),
        events: [],
        operations: this.options.getOperations(ticket.staffId),
        liveOnly: true
      }))
      this.options.onClientCountChanged?.()
      return
    }

    if (message.type !== 'command') return
    const auth = this.resolveClientAuth(client)
    if (!auth) return
    let response: ZaloServerCommandResponse
    try {
      const args = Array.isArray(message.args) ? message.args : []
      const result = auth.kind === 'control'
        ? await this.startAuthorizedControlOperation(client, message.command, args)
        : DESKTOP_DETACHED_OPERATION_COMMANDS.has(message.command)
          ? this.options.startControlOperation(auth.staffId, message.command, args)
          : await this.options.executeCommand(auth.staffId, message.command, args)
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

  private resolveClientAuth(client: ClientRecord): ClientAuth | null {
    if (!client.auth) return null
    if (client.auth.kind === 'control') return client.auth
    if (!client.sessionToken) return null
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
    return client.auth
  }

  private scheduleClientSessionExpiry(client: ClientRecord, token: string, expiresAt: number): void {
    if (client.sessionExpiryTimer) clearTimeout(client.sessionExpiryTimer)
    client.sessionExpiryTimer = setTimeout(() => {
      if (client.sessionToken !== token) return
      this.resolveClientAuth(client)
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

  private async authenticateControlTicket(
    client: ClientRecord,
    token: string
  ): Promise<RealtimeTicketPayload | null> {
    if (!client.origin || !isOriginAllowed(this.allowedOriginPolicy, client.origin)) {
      this.closeControlClient(client, 4003, 'Origin web không được phép')
      return null
    }

    let ticket: RealtimeTicketPayload
    try {
      ticket = this.verifyRealtimeTicket(token)
      if (!ticket.capabilities.zaloServer) throw new Error('Ticket không có quyền Zalo Server')
      if (!this.consumeTicketId(ticket.jti, ticket.exp)) throw new Error('Ticket đã được sử dụng')
      const allowed = await this.revalidateControlAccess(
        ticket.staffId,
        ticket.organizationId,
        ticket.sessionId
      )
      if (!allowed) throw new Error('Quyền Zalo Server không còn hiệu lực')
    } catch (error) {
      console.warn('[ZaloServerGateway] Realtime ticket rejected:', error instanceof Error ? error.message : error)
      this.closeControlClient(client, 4003, 'Ticket realtime không hợp lệ hoặc đã hết hạn')
      return null
    }
    return ticket
  }

  private verifyRealtimeTicket(token: string): RealtimeTicketPayload {
    if (!this.realtimeTicketPublicKey) {
      throw new Error('Public key realtime chưa được cấu hình trong bản server')
    }
    const parts = String(token || '').split('.')
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Ticket sai định dạng')
    const [payloadPart, signaturePart] = parts
    if (!/^[A-Za-z0-9_-]+$/.test(payloadPart) || !/^[A-Za-z0-9_-]+$/.test(signaturePart)) {
      throw new Error('Ticket không phải base64url hợp lệ')
    }
    if (!verifyRealtimeTicketSignature(
      payloadPart,
      signaturePart,
      this.realtimeTicketPublicKey
    )) throw new Error('Chữ ký ticket không hợp lệ')

    let raw: unknown
    try {
      raw = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as unknown
    } catch {
      throw new Error('Payload ticket không hợp lệ')
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Payload ticket không hợp lệ')
    const value = raw as Record<string, unknown>
    const capabilities = value.capabilities
    if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
      throw new Error('Capability ticket không hợp lệ')
    }
    const capabilityRecord = capabilities as Record<string, unknown>
    const staffId = Math.floor(Number(value.staffId))
    const organizationId = Math.floor(Number(value.organizationId))
    const iat = Number(value.iat)
    const exp = Number(value.exp)
    const now = Math.floor(Date.now() / 1000)
    if (value.v !== 1) throw new Error('Phiên bản ticket không được hỗ trợ')
    if (!Number.isSafeInteger(staffId) || staffId <= 0) throw new Error('Staff ticket không hợp lệ')
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0) throw new Error('Organization ticket không hợp lệ')
    if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) throw new Error('Thời hạn ticket không hợp lệ')
    // Không so iat với đồng hồ cục bộ của VPS. Chữ ký, TTL tối đa, hạn dùng,
    // session/capability và jti dùng một lần vẫn là các lớp xác thực bắt buộc.
    if (exp <= now || exp <= iat || exp - iat > CONTROL_TICKET_MAX_TTL_SECONDS) {
      throw new Error('Ticket đã hết hạn hoặc có thời hạn không hợp lệ')
    }
    const jti = typeof value.jti === 'string' ? value.jti.trim() : ''
    const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : ''
    if (!jti || jti.length > 256 || !sessionId || sessionId.length > 256) {
      throw new Error('Định danh ticket không hợp lệ')
    }
    if (
      typeof capabilityRecord.zaloServer !== 'boolean' ||
      typeof capabilityRecord.sms !== 'boolean'
    ) throw new Error('Capability ticket không hợp lệ')

    return {
      v: 1,
      jti,
      sessionId,
      staffId,
      organizationId,
      capabilities: {
        zaloServer: capabilityRecord.zaloServer,
        sms: capabilityRecord.sms
      },
      iat,
      exp
    }
  }

  private consumeTicketId(jti: string, expiresAtSeconds: number): boolean {
    this.pruneUsedTicketIds()
    if (this.pendingTicketIds.has(jti) || this.usedTicketIds.has(jti)) return false
    if (this.usedTicketIds.size >= USED_TICKET_LIMIT) return false
    // JavaScript executes this reservation synchronously, so concurrent socket
    // handshakes cannot both cross the one-time boundary before DB validation.
    this.pendingTicketIds.add(jti)
    this.usedTicketIds.set(jti, expiresAtSeconds)
    this.pendingTicketIds.delete(jti)
    return true
  }

  private pruneUsedTicketIds(): void {
    const now = Math.floor(Date.now() / 1000)
    for (const [jti, expiresAt] of this.usedTicketIds.entries()) {
      if (expiresAt <= now) this.usedTicketIds.delete(jti)
    }
    const activeSessionIds = new Set(
      Array.from(this.clients)
        .map(client => client.auth?.kind === 'control' ? client.auth.sessionId : null)
        .filter((sessionId): sessionId is string => !!sessionId)
    )
    const staleBefore = Date.now() - 5 * 60_000
    for (const [sessionId, entry] of this.controlSessionCache.entries()) {
      if (!entry.inflight && entry.checkedAt < staleBefore && !activeSessionIds.has(sessionId)) {
        this.controlSessionCache.delete(sessionId)
      }
    }
    const activeStaffKeys = new Set(
      Array.from(this.clients)
        .map(client => client.auth?.kind === 'control'
          ? this.controlCapabilityKey(client.auth.staffId, client.auth.organizationId)
          : null)
        .filter((key): key is string => !!key)
    )
    for (const [key, entry] of this.controlCapabilityCache.entries()) {
      if (!entry.inflight && entry.checkedAt < staleBefore && !activeStaffKeys.has(key)) {
        this.controlCapabilityCache.delete(key)
      }
    }
  }

  private scheduleControlRevalidation(client: ClientRecord): void {
    if (client.capabilityTimer) clearTimeout(client.capabilityTimer)
    const auth = client.auth
    if (!auth || auth.kind !== 'control') return
    const sessionCheckedAt = this.controlSessionCache.get(auth.sessionId)?.checkedAt || 0
    const capabilityCheckedAt = this.controlCapabilityCache.get(
      this.controlCapabilityKey(auth.staffId, auth.organizationId)
    )?.checkedAt || 0
    const oldestCheck = Math.min(sessionCheckedAt, capabilityCheckedAt)
    const elapsed = oldestCheck > 0 ? Date.now() - oldestCheck : CONTROL_REVALIDATION_INTERVAL_MS
    const delay = Math.max(1_000, CONTROL_REVALIDATION_INTERVAL_MS - elapsed)
    client.capabilityTimer = setTimeout(() => {
      client.capabilityTimer = null
      void this.revalidateControlClient(client).then(allowed => {
        if (allowed) this.scheduleControlRevalidation(client)
      })
    }, delay)
  }

  private async revalidateControlAccess(
    staffId: number,
    organizationId: number,
    sessionId: string,
    force = false
  ): Promise<boolean> {
    const [sessionAllowed, capabilityAllowed] = await Promise.all([
      this.revalidateControlSession(staffId, organizationId, sessionId, force),
      this.revalidateControlCapability(staffId, organizationId, force)
    ])
    return sessionAllowed && capabilityAllowed
  }

  private async revalidateControlSession(
    staffId: number,
    organizationId: number,
    sessionId: string,
    force: boolean
  ): Promise<boolean> {
    const cached = this.controlSessionCache.get(sessionId)
    if (cached && (cached.staffId !== staffId || cached.organizationId !== organizationId)) return false
    if (cached?.inflight) return cached.inflight
    if (!force && cached && Date.now() - cached.checkedAt < CONTROL_ACCESS_CACHE_MS) return cached.allowed

    const entry: ControlAccessCacheEntry = cached || {
      staffId,
      organizationId,
      sessionId,
      allowed: false,
      checkedAt: 0,
      inflight: null
    }
    const inflight = this.options.revalidateControlSession(staffId, organizationId, sessionId)
      .then(allowed => {
        entry.allowed = allowed
        entry.checkedAt = Date.now()
        return allowed
      })
      .finally(() => {
        if (entry.inflight === inflight) entry.inflight = null
      })
    entry.inflight = inflight
    this.controlSessionCache.set(sessionId, entry)
    return inflight
  }

  private async revalidateControlCapability(
    staffId: number,
    organizationId: number,
    force: boolean
  ): Promise<boolean> {
    const key = this.controlCapabilityKey(staffId, organizationId)
    const cached = this.controlCapabilityCache.get(key)
    if (cached?.inflight) return cached.inflight
    if (!force && cached && Date.now() - cached.checkedAt < CONTROL_ACCESS_CACHE_MS) return cached.allowed
    const entry: ControlCapabilityCacheEntry = cached || {
      staffId,
      organizationId,
      allowed: false,
      checkedAt: 0,
      inflight: null
    }
    const inflight = this.options.revalidateControlCapability(staffId, organizationId)
      .then(allowed => {
        entry.allowed = allowed
        entry.checkedAt = Date.now()
        return allowed
      })
      .finally(() => {
        if (entry.inflight === inflight) entry.inflight = null
      })
    entry.inflight = inflight
    this.controlCapabilityCache.set(key, entry)
    return inflight
  }

  private controlCapabilityKey(staffId: number, organizationId: number): string {
    return `${organizationId}:${staffId}`
  }

  private async revalidateControlClient(client: ClientRecord): Promise<boolean> {
    const auth = client.auth
    if (!auth || auth.kind !== 'control' || client.socket.readyState !== WebSocket.OPEN) return false
    if (!client.origin || !isOriginAllowed(this.allowedOriginPolicy, client.origin)) {
      this.closeControlClient(client, 4003, 'Origin web không được phép')
      return false
    }
    if (client.revalidationPromise) return client.revalidationPromise
    const pending = this.revalidateControlAccess(auth.staffId, auth.organizationId, auth.sessionId)
      .then(allowed => {
        if (!allowed) {
          const capability = this.controlCapabilityCache.get(
            this.controlCapabilityKey(auth.staffId, auth.organizationId)
          )
          if (capability?.allowed === false) {
            this.closeControlStaffClients(
              auth.staffId,
              auth.organizationId,
              4004,
              'Quyền Zalo Server không còn hiệu lực'
            )
          } else {
            this.closeControlSessionClients(auth.sessionId, 4004, 'Phiên control không còn hiệu lực')
          }
        }
        return allowed
      })
      .catch(error => {
        console.error('[ZaloServerGateway] Cannot revalidate control client:', error)
        this.closeControlClient(client, 1011, 'Không thể kiểm tra quyền Zalo Server')
        return false
      })
      .finally(() => {
        if (client.revalidationPromise === pending) client.revalidationPromise = null
      })
    client.revalidationPromise = pending
    return pending
  }

  private async startAuthorizedControlOperation(
    client: ClientRecord,
    command: ZaloServerCommandName,
    args: unknown[]
  ): Promise<ZaloServerOperationSnapshot> {
    if (!await this.revalidateControlClient(client)) {
      throw new Error('Quyền Zalo Server không còn hiệu lực')
    }
    const auth = client.auth
    if (!auth || auth.kind !== 'control') throw new Error('Phiên realtime không còn hợp lệ')
    return this.options.startControlOperation(auth.staffId, command, args)
  }

  private closeControlClient(client: ClientRecord, code: number, reason: string): void {
    if (client.capabilityTimer) {
      clearTimeout(client.capabilityTimer)
      client.capabilityTimer = null
    }
    if (client.socket.readyState === WebSocket.OPEN || client.socket.readyState === WebSocket.CONNECTING) {
      try { client.socket.close(code, reason) } catch {}
    }
  }

  private closeControlSessionClients(sessionId: string, code: number, reason: string): void {
    for (const client of this.clients) {
      if (client.auth?.kind === 'control' && client.auth.sessionId === sessionId) {
        this.closeControlClient(client, code, reason)
      }
    }
  }

  private closeControlStaffClients(
    staffId: number,
    organizationId: number,
    code: number,
    reason: string
  ): void {
    const staffClients = this.clientsByStaff.get(this.clientStaffKey(staffId, organizationId))
    if (!staffClients) return
    for (const client of staffClients) {
      if (
        client.auth?.kind === 'control' &&
        client.auth.staffId === staffId &&
        client.auth.organizationId === organizationId
      ) this.closeControlClient(client, code, reason)
    }
  }

  private clientStaffKey(staffId: number, organizationId: number): string {
    return `${organizationId}:${staffId}`
  }

  private registerAuthenticatedClient(client: ClientRecord): void {
    const auth = client.auth
    if (!auth) return
    const key = this.clientStaffKey(auth.staffId, auth.organizationId)
    const staffClients = this.clientsByStaff.get(key) || new Set<ClientRecord>()
    if (staffClients.has(client)) return
    staffClients.add(client)
    this.clientsByStaff.set(key, staffClients)
    this.authenticatedClientCount += 1
  }

  private unregisterAuthenticatedClient(client: ClientRecord): void {
    const auth = client.auth
    if (!auth) return
    const key = this.clientStaffKey(auth.staffId, auth.organizationId)
    const staffClients = this.clientsByStaff.get(key)
    if (!staffClients?.delete(client)) return
    this.authenticatedClientCount = Math.max(0, this.authenticatedClientCount - 1)
    if (staffClients.size === 0) this.clientsByStaff.delete(key)
  }

  private getClientSnapshot(auth: ClientAuth): ZaloServerSnapshot {
    const snapshot = this.options.getSnapshot(auth.staffId)
    if (auth.kind === 'desktop') return snapshot
    return {
      ...snapshot,
      recentEvents: []
    }
  }

  private readOriginHeader(value: string | string[] | undefined): string | null {
    const raw = Array.isArray(value) ? value[0] : value
    const normalized = String(raw || '').trim()
    return normalized || null
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
      if (client.capabilityTimer) clearTimeout(client.capabilityTimer)
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
    this.clientsByStaff.clear()
    this.authenticatedClientCount = 0
    this.sessions.clear()
    this.usedTicketIds.clear()
    this.pendingTicketIds.clear()
    this.controlSessionCache.clear()
    this.controlCapabilityCache.clear()
    this.loginAttempts.clear()
  }
}
