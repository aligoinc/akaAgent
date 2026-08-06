import type {
  AuthUser,
  ZaloLoginQrEvent,
  ZaloLoginQrStartResult,
  ZaloSessionCheckResult
} from '../../shared/types'

const ZALO_CHAT_API_ORGANIZATION_ID = 1
const ZALO_CHAT_API_DEFAULT_ORIGIN = 'https://aka-agent-chat-api.fly.dev'
const REQUEST_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 700
const TOKEN_REUSE_SAFETY_MS = 30_000

interface LoginCredentials {
  username: string
  password: string
}

interface DesktopSessionResponse {
  token: string
  expiresAt: string
  staffId: string
  organizationId: string
}

type QrOperationStatus =
  | 'requested'
  | 'qr_generated'
  | 'qr_scanned'
  | 'qr_expired'
  | 'declined'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

interface QrOperationSnapshot {
  operationId: string
  autoAccountId: string
  status: QrOperationStatus
  qrImageDataUrl?: string
  displayName?: string
  avatarUrl?: string
  message?: string
  createdAt: string
  updatedAt: string
}

interface ManagedZaloAccountSnapshot {
  autoAccountId: string
  loginStatusCode: string | null
  loginStatusName: string | null
  socketStatusCode: string | null
  socketStatusName: string | null
  sessionLastError: string | null
}

interface LogoutAccountResponse {
  success: boolean
  loggedIn: false
  status: string
  autoAccountId: string
}

interface ActiveQrOperation {
  operationId: string
  generation: number
  lastFingerprint: string | null
  timer: ReturnType<typeof setTimeout> | null
}

function isTerminal(status: QrOperationStatus): boolean {
  return ['qr_expired', 'declined', 'succeeded', 'failed', 'cancelled'].includes(status)
}

function operationEvent(operation: QrOperationSnapshot): ZaloLoginQrEvent {
  const status: ZaloLoginQrEvent['status'] = operation.status === 'qr_scanned'
    ? 'scanned'
    : operation.status === 'qr_expired'
      ? 'expired'
      : operation.status === 'succeeded'
        ? 'success'
        : operation.status === 'failed'
          ? 'error'
          : operation.status === 'requested' || operation.status === 'qr_generated'
            ? 'qr'
            : operation.status
  return {
    accountId: Number(operation.autoAccountId),
    operationId: operation.operationId,
    status,
    ...(operation.message ? { message: operation.message } : {}),
    ...(operation.qrImageDataUrl ? { qrImage: operation.qrImageDataUrl } : {}),
    ...(operation.displayName ? { displayName: operation.displayName } : {}),
    ...(operation.avatarUrl ? { avatarUrl: operation.avatarUrl } : {})
  }
}

async function responseError(response: Response): Promise<Error> {
  try {
    const body = await response.json() as { message?: unknown; error?: unknown }
    const message = typeof body.message === 'string'
      ? body.message
      : typeof body.error === 'string'
        ? body.error
        : `Chat API trả về HTTP ${response.status}`
    return new Error(message)
  } catch {
    return new Error(`Chat API trả về HTTP ${response.status}`)
  }
}

export class ZaloChatApiClient {
  private readonly origin: string
  private user: AuthUser | null = null
  private credentials: LoginCredentials | null = null
  private token: string | null = null
  private tokenExpiresAt = 0
  private generation = 0
  private activeQrByAccount = new Map<number, ActiveQrOperation>()

  public constructor(private readonly emitLoginQrEvent: (event: ZaloLoginQrEvent) => void) {
    this.origin = String(
      process.env.AKA_AGENT_CHAT_API_URL || ZALO_CHAT_API_DEFAULT_ORIGIN
    ).replace(/\/+$/, '')
  }

  public isEnabled(): boolean {
    return this.user?.organizationId === ZALO_CHAT_API_ORGANIZATION_ID &&
      this.user.entitlements.zalo === true &&
      this.user.zaloAccountCapabilities?.server === true
  }

  public start(user: AuthUser, username: string, password: string): void {
    const credentials = {
      username: String(username || '').trim(),
      password: String(password || '')
    }
    const enabled = user.organizationId === ZALO_CHAT_API_ORGANIZATION_ID &&
      user.entitlements.zalo === true &&
      user.zaloAccountCapabilities?.server === true
    const sameIdentity = this.user?.staffId === user.staffId &&
      this.user.organizationId === user.organizationId &&
      this.credentials?.username === credentials.username &&
      this.credentials.password === credentials.password
    if (enabled && sameIdentity) {
      this.user = user
      return
    }
    this.stop()
    if (!enabled || !credentials.username || !credentials.password) return
    this.user = user
    this.credentials = credentials
  }

  public stop(): void {
    this.generation += 1
    for (const operation of this.activeQrByAccount.values()) {
      if (operation.timer) clearTimeout(operation.timer)
    }
    this.activeQrByAccount.clear()
    this.user = null
    this.credentials = null
    this.token = null
    this.tokenExpiresAt = 0
  }

  public async startLoginQr(accountId: number): Promise<ZaloLoginQrStartResult> {
    this.requireEnabled()
    const operation = await this.request<QrOperationSnapshot>(
      `/api/chat/zalo/accounts/${accountId}/login-qr`,
      { method: 'POST' }
    )
    const previous = this.activeQrByAccount.get(accountId)
    if (previous?.timer) clearTimeout(previous.timer)
    const active: ActiveQrOperation = {
      operationId: operation.operationId,
      generation: this.generation,
      lastFingerprint: null,
      timer: null
    }
    this.activeQrByAccount.set(accountId, active)
    this.publishOperation(operation, active)
    if (!isTerminal(operation.status)) this.schedulePoll(accountId, active)
    return { success: true, accountId }
  }

  public async cancelLoginQr(accountId: number): Promise<ZaloLoginQrStartResult> {
    const active = this.activeQrByAccount.get(accountId)
    if (!active) return { success: true, accountId }
    if (active.timer) clearTimeout(active.timer)
    try {
      const operation = await this.request<QrOperationSnapshot>(
        `/api/chat/zalo/login-operations/${active.operationId}/cancel`,
        {
          method: 'POST',
          body: { autoAccountId: String(accountId) }
        }
      )
      this.publishOperation(operation, active)
      return { success: true, accountId }
    } finally {
      if (this.activeQrByAccount.get(accountId) === active) {
        this.activeQrByAccount.delete(accountId)
      }
    }
  }

  public async checkSession(accountId: number): Promise<ZaloSessionCheckResult> {
    this.requireEnabled()
    const accounts = await this.request<ManagedZaloAccountSnapshot[]>('/api/chat/zalo/accounts')
    const account = accounts.find(item => Number(item.autoAccountId) === accountId)
    if (!account) {
      return {
        success: false,
        loggedIn: false,
        status: 'chưa đăng nhập',
        reason: 'Không tìm thấy tài khoản Zalo thuộc quyền quản lý của nhân viên này.'
      }
    }
    const loggedIn = account.loginStatusCode === 'logged_in'
    const connected = account.socketStatusCode === 'connected'
    return {
      success: true,
      loggedIn,
      status: loggedIn ? 'đã đăng nhập' : 'chưa đăng nhập',
      ...(!loggedIn || !connected
        ? {
            reason: account.sessionLastError || account.loginStatusName ||
              account.socketStatusName || 'Socket Zalo chưa kết nối.'
          }
        : {})
    }
  }

  public async logout(accountId: number): Promise<ZaloSessionCheckResult> {
    this.requireEnabled()
    const active = this.activeQrByAccount.get(accountId)
    if (active?.timer) clearTimeout(active.timer)
    this.activeQrByAccount.delete(accountId)
    const result = await this.request<LogoutAccountResponse>(
      `/api/chat/zalo/accounts/${accountId}/logout`,
      { method: 'POST' }
    )
    return {
      success: result.success,
      loggedIn: false,
      status: result.status || 'chưa đăng nhập',
      reason: 'Đã đăng xuất Zalo và dừng socket đồng bộ.'
    }
  }

  private requireEnabled(): void {
    if (!this.isEnabled() || !this.user || !this.credentials) {
      throw new Error('Chat API chỉ nhận đăng nhập Zalo Server của tổ chức 1.')
    }
  }

  private publishOperation(operation: QrOperationSnapshot, active: ActiveQrOperation): void {
    const fingerprint = JSON.stringify(operation)
    if (fingerprint === active.lastFingerprint) return
    active.lastFingerprint = fingerprint
    this.emitLoginQrEvent(operationEvent(operation))
  }

  private schedulePoll(accountId: number, active: ActiveQrOperation): void {
    if (
      active.generation !== this.generation ||
      this.activeQrByAccount.get(accountId) !== active
    ) return
    active.timer = setTimeout(() => {
      active.timer = null
      void this.pollOperation(accountId, active)
    }, POLL_INTERVAL_MS)
  }

  private async pollOperation(accountId: number, active: ActiveQrOperation): Promise<void> {
    if (
      active.generation !== this.generation ||
      this.activeQrByAccount.get(accountId) !== active
    ) return
    try {
      const operation = await this.request<QrOperationSnapshot>(
        `/api/chat/zalo/login-operations/${active.operationId}`
      )
      if (
        active.generation !== this.generation ||
        this.activeQrByAccount.get(accountId) !== active
      ) return
      this.publishOperation(operation, active)
      if (isTerminal(operation.status)) {
        this.activeQrByAccount.delete(accountId)
        return
      }
      this.schedulePoll(accountId, active)
    } catch (error) {
      if (
        active.generation !== this.generation ||
        this.activeQrByAccount.get(accountId) !== active
      ) return
      this.activeQrByAccount.delete(accountId)
      this.emitLoginQrEvent({
        accountId,
        operationId: active.operationId,
        status: 'error',
        message: error instanceof Error ? error.message : 'Không đọc được trạng thái QR từ Chat API.'
      })
    }
  }

  private async ensureToken(): Promise<string> {
    this.requireEnabled()
    if (this.token && this.tokenExpiresAt > Date.now() + TOKEN_REUSE_SAFETY_MS) {
      return this.token
    }
    const response = await this.fetchWithTimeout('/api/chat/desktop/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(this.credentials)
    })
    if (!response.ok) throw await responseError(response)
    const session = await response.json() as DesktopSessionResponse
    const expiresAt = Date.parse(String(session.expiresAt || ''))
    if (
      !session.token ||
      !this.user ||
      Number(session.staffId) !== this.user.staffId ||
      Number(session.organizationId) !== this.user.organizationId ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      throw new Error('Chat API trả về phiên desktop không hợp lệ.')
    }
    this.token = session.token
    this.tokenExpiresAt = expiresAt
    return session.token
  }

  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown } = {},
    allowTokenRefresh = true
  ): Promise<T> {
    const token = await this.ensureToken()
    const hasBody = options.body !== undefined
    const response = await this.fetchWithTimeout(path, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(hasBody ? { 'content-type': 'application/json' } : {})
      },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {})
    })
    if (response.status === 401 && allowTokenRefresh) {
      this.token = null
      this.tokenExpiresAt = 0
      return this.request<T>(path, options, false)
    }
    if (!response.ok) throw await responseError(response)
    return response.json() as Promise<T>
  }

  private async fetchWithTimeout(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(new URL(path, this.origin), { ...init, signal: controller.signal })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Chat API phản hồi quá chậm. Vui lòng thử lại.')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
