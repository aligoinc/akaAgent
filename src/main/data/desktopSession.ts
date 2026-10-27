/** Main-process only. Never serialize these tokens through IPC or write them to disk. */
export interface DesktopSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  staffId: number
  organizationId: number
  sessionId: string
}

export class DesktopSessionRejected extends Error {
  constructor() { super('Phiên truy cập dữ liệu không còn hợp lệ. Vui lòng đăng nhập lại.') }
}

const REFRESH_RETRY_DELAY_MS = 30_000

export class DesktopSessionManager {
  private session: DesktopSession | null = null
  private generation = 0
  private refreshing: Promise<void> | null = null
  private refreshRetryAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private rejectedListener: (() => void) | null = null

  constructor(private readonly refreshSession: (previous: DesktopSession, signal: AbortSignal) => Promise<DesktopSession>,
    private readonly now: () => number = Date.now,
    private readonly revokeSession?: (accessToken: string, signal: AbortSignal) => Promise<unknown>) {}

  onRejected(listener: () => void): () => void {
    this.rejectedListener = listener
    return () => { if (this.rejectedListener === listener) this.rejectedListener = null }
  }

  /** A login captures this before its first await; logout invalidates late completions. */
  revision(): number { return this.generation }

  install(session: DesktopSession, expectedRevision: number): void {
    if (expectedRevision !== this.generation) {
      this.revoke(session.accessToken)
      throw new Error('Phiên đăng nhập đã thay đổi.')
    }
    validateSession(session, this.now())
    this.generation++
    this.refreshing = null
    this.refreshRetryAt = 0
    this.session = { ...session }
    this.schedule()
  }

  clear(): void {
    if (this.session) this.revoke(this.session.accessToken)
    this.generation++
    this.session = null
    this.refreshing = null
    this.refreshRetryAt = 0
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private revoke(accessToken: string): void {
    void this.revokeSession?.(accessToken, AbortSignal.timeout(3_000)).catch(() => {})
  }

  private reject(): void {
    this.clear()
    this.rejectedListener?.()
  }

  matches(staffId: number, organizationId: number): boolean {
    return this.session?.staffId === staffId && this.session.organizationId === organizationId
  }

  async token(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const revision = this.generation
    if (!this.session) throw new Error('Chưa có phiên truy cập dữ liệu. Vui lòng đăng nhập lại.')
    // Renew in the background while the old JWT is valid; it never adds latency
    // to ordinary queries or retries an already-dispatched database mutation.
    if (this.session.expiresAt * 1000 - this.now() <= 60_000) {
      const pending = this.refresh()
      if (this.session.expiresAt * 1000 <= this.now() + 5_000) await waitWithSignal(pending, signal)
      else void pending.catch(() => {})
    }
    signal?.throwIfAborted()
    if (revision !== this.generation || !this.session) throw new Error('Phiên đăng nhập đã thay đổi.')
    // While renewal is unavailable, use the existing fetch-error path. An
    // expired access token alone does not mean the login session was rejected.
    if (this.session.expiresAt * 1000 <= this.now()) throw new TypeError('fetch failed')
    return this.session.accessToken
  }

  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    if (!this.session) return Promise.reject(new Error('Không có phiên để gia hạn.'))
    // Both the timer and data requests must respect a failed renewal's backoff.
    // Callers may keep using a valid JWT, but token() still rejects expired JWTs.
    if (this.now() < this.refreshRetryAt) {
      if (!this.timer) this.schedule()
      return Promise.resolve()
    }
    const old = this.session, revision = this.generation
    const pending = (async () => {
      const next = await this.refreshSession(old, AbortSignal.timeout(10_000))
      if (revision !== this.generation || this.session !== old) { this.revoke(next.accessToken); return }
      validateSession(next, this.now())
      if (next.staffId !== old.staffId || next.organizationId !== old.organizationId || next.sessionId !== old.sessionId) {
        this.reject()
        throw new Error('Danh tính phiên gia hạn không khớp.')
      }
      this.session = { ...next }
      this.refreshRetryAt = 0
    })().catch(error => {
      if (revision === this.generation) {
        if (error instanceof DesktopSessionRejected) this.reject()
        else {
          this.refreshRetryAt = this.now() + REFRESH_RETRY_DELAY_MS
          // Match an ordinary failed data fetch; do not surface Auth-specific
          // login/rate-limit messages for a temporary renewal failure.
          throw new TypeError('fetch failed')
        }
      }
      throw error
    }).finally(() => {
      if (revision === this.generation && this.refreshing === pending) {
        this.refreshing = null
        this.schedule()
      }
    })
    this.refreshing = pending
    return pending
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.session) return
    // Use the same retry deadline as request-triggered renewal, without pushing
    // it back on every request or adding a wait to database callers.
    const now = this.now()
    const delay = this.refreshRetryAt > now
      ? this.refreshRetryAt - now
      : Math.max(REFRESH_RETRY_DELAY_MS, this.session.expiresAt * 1000 - now - 60_000)
    this.timer = setTimeout(() => { this.timer = null; void this.refresh().catch(() => {}) }, delay)
    this.timer.unref?.()
  }
}

function validateSession(session: DesktopSession, now: number): void {
  if (!session || typeof session.accessToken !== 'string' || typeof session.refreshToken !== 'string'
    || !session.refreshToken || !Number.isSafeInteger(session.staffId) || session.staffId <= 0
    || !Number.isSafeInteger(session.organizationId) || session.organizationId <= 0
    || !Number.isFinite(session.expiresAt) || session.expiresAt * 1000 <= now) throw new Error('Phiên truy cập dữ liệu không hợp lệ.')
  let claims: Record<string, unknown>
  try { claims = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url').toString('utf8')) }
  catch { throw new Error('Token truy cập không hợp lệ.') }
  // The database verifies the signature. These checks reject an accidental
  // admin/anon response before it could become a Desktop Authorization header.
  if (claims.role !== 'aka_agent_desktop' || claims.session_id !== session.sessionId
    || typeof claims.sub !== 'string' || claims.exp !== session.expiresAt) throw new Error('Token không thuộc phiên Desktop.')
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
