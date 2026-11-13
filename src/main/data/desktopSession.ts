/** Main-process only. Never serialize these tokens through IPC or write them to disk. */
export interface DesktopSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  staffId: number
  organizationId: number
  sessionId: string
}

/** Local clock readings taken just before the issuer was asked for a token. */
export interface DesktopSessionClockMark {
  wallMs: number
  monoMs: number | null
}

export class DesktopSessionRejected extends Error {
  constructor() { super('Phiên truy cập dữ liệu không còn hợp lệ. Vui lòng đăng nhập lại.') }
}

const REFRESH_RETRY_DELAY_MS = 30_000
// A token that was just issued is never treated as expired by a 401 reply.
const EXPIRED_REPLY_GRACE_MS = 30_000
// Supabase Auth allows at most one week (604800 seconds).
const MAX_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Renewal deadlines are measured on this machine's clocks, from the token
 * lifetime the issuer granted (`exp - iat`), so a wrong system clock cannot
 * delay renewal past the server-side expiry. The wall clock keeps counting
 * through sleep; the monotonic clock ignores manual or automatic clock jumps.
 * The earlier of the two deadlines wins.
 */
interface SessionDeadline {
  wallMs: number
  monoMs: number | null
  issuedWallMs: number
  issuedMonoMs: number | null
}

export class DesktopSessionManager {
  private session: DesktopSession | null = null
  private deadline: SessionDeadline | null = null
  private generation = 0
  private refreshing: Promise<void> | null = null
  // Set when a renewal fails; renewal waits REFRESH_RETRY_DELAY_MS after it.
  private refreshFailedAt: DesktopSessionClockMark | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private rejectedListener: (() => void) | null = null

  constructor(private readonly refreshSession: (previous: DesktopSession, signal: AbortSignal) => Promise<DesktopSession>,
    private readonly now: () => number = Date.now,
    private readonly revokeSession?: (accessToken: string, signal: AbortSignal) => Promise<unknown>,
    private readonly monotonicNow?: () => number) {}

  onRejected(listener: () => void): () => void {
    this.rejectedListener = listener
    return () => { if (this.rejectedListener === listener) this.rejectedListener = null }
  }

  /** A login captures this before its first await; logout invalidates late completions. */
  revision(): number { return this.generation }

  /** Read before requesting a token, then pass to install(). */
  clockMark(): DesktopSessionClockMark {
    return { wallMs: this.now(), monoMs: this.monotonicNow ? this.monotonicNow() : null }
  }

  install(session: DesktopSession, expectedRevision: number, requestedAt?: DesktopSessionClockMark): void {
    if (expectedRevision !== this.generation) {
      this.revoke(session.accessToken)
      throw new Error('Phiên đăng nhập đã thay đổi.')
    }
    const lifetimeMs = validateSession(session, this.now())
    this.generation++
    this.refreshing = null
    this.refreshFailedAt = null
    this.session = { ...session }
    this.deadline = this.deadlineFor(session, lifetimeMs, requestedAt ?? this.clockMark())
    this.schedule()
  }

  clear(): void {
    if (this.session) this.revoke(this.session.accessToken)
    this.generation++
    this.session = null
    this.deadline = null
    this.refreshing = null
    this.refreshFailedAt = null
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

  /**
   * The server answered "JWT expired" for this token. Renew before the next
   * request instead of waiting for the local deadline. A token issued moments
   * ago is left alone so a server-side fault cannot cause a renewal storm.
   */
  expire(accessToken: string): void {
    if (!this.session || !this.deadline || this.session.accessToken !== accessToken) return
    if (this.ageMs() < EXPIRED_REPLY_GRACE_MS) return
    // A failed renewal's backoff still applies; until it ends, token() fails
    // fast with the ordinary fetch error instead of sending an expired JWT.
    this.deadline = { ...this.deadline, wallMs: this.now(), monoMs: this.monotonicNow ? this.monotonicNow() : null }
    if (!this.refreshing) this.schedule()
  }

  async token(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const revision = this.generation
    if (!this.session) throw new Error('Chưa có phiên truy cập dữ liệu. Vui lòng đăng nhập lại.')
    // Renew in the background while the old JWT is valid; it never adds latency
    // to ordinary queries or retries an already-dispatched database mutation.
    if (this.remainingMs() <= 60_000) {
      const pending = this.refresh()
      if (this.remainingMs() <= 5_000) await waitWithSignal(pending, signal)
      else void pending.catch(() => {})
    }
    signal?.throwIfAborted()
    if (revision !== this.generation || !this.session) throw new Error('Phiên đăng nhập đã thay đổi.')
    // While renewal is unavailable, use the existing fetch-error path. An
    // expired access token alone does not mean the login session was rejected.
    if (this.remainingMs() <= 0) throw new TypeError('fetch failed')
    return this.session.accessToken
  }

  private remainingMs(): number {
    if (!this.deadline) return 0
    const wall = this.deadline.wallMs - this.now()
    if (this.deadline.monoMs === null || !this.monotonicNow) return wall
    return Math.min(wall, this.deadline.monoMs - this.monotonicNow())
  }

  private ageMs(): number {
    if (!this.deadline) return Infinity
    return this.elapsedSince({ wallMs: this.deadline.issuedWallMs, monoMs: this.deadline.issuedMonoMs })
  }

  /** Time since a mark; the larger reading wins so a clock moved backward cannot stretch a wait. */
  private elapsedSince(mark: DesktopSessionClockMark): number {
    const wall = this.now() - mark.wallMs
    if (mark.monoMs === null || !this.monotonicNow) return wall
    return Math.max(wall, this.monotonicNow() - mark.monoMs)
  }

  private retryWaitMs(): number {
    return this.refreshFailedAt ? Math.max(0, REFRESH_RETRY_DELAY_MS - this.elapsedSince(this.refreshFailedAt)) : 0
  }

  private deadlineFor(session: DesktopSession, lifetimeMs: number | null, mark: DesktopSessionClockMark): SessionDeadline {
    // Tokens without `iat` keep the previous rule: compare `exp` with this clock.
    if (lifetimeMs === null) {
      return { wallMs: session.expiresAt * 1000, monoMs: null, issuedWallMs: mark.wallMs, issuedMonoMs: mark.monoMs }
    }
    return {
      wallMs: mark.wallMs + lifetimeMs,
      monoMs: mark.monoMs === null ? null : mark.monoMs + lifetimeMs,
      issuedWallMs: mark.wallMs,
      issuedMonoMs: mark.monoMs
    }
  }

  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    if (!this.session) return Promise.reject(new Error('Không có phiên để gia hạn.'))
    // Both the timer and data requests must respect a failed renewal's backoff.
    // Callers may keep using a valid JWT, but token() still rejects expired JWTs.
    if (this.retryWaitMs() > 0) {
      if (!this.timer) this.schedule()
      return Promise.resolve()
    }
    const old = this.session, revision = this.generation
    const requestedAt = this.clockMark()
    const pending = (async () => {
      const next = await this.refreshSession(old, AbortSignal.timeout(10_000))
      if (revision !== this.generation || this.session !== old) { this.revoke(next.accessToken); return }
      const lifetimeMs = validateSession(next, this.now())
      if (next.staffId !== old.staffId || next.organizationId !== old.organizationId || next.sessionId !== old.sessionId) {
        this.reject()
        throw new Error('Danh tính phiên gia hạn không khớp.')
      }
      this.session = { ...next }
      this.deadline = this.deadlineFor(next, lifetimeMs, requestedAt)
      this.refreshFailedAt = null
    })().catch(error => {
      if (revision === this.generation) {
        if (error instanceof DesktopSessionRejected) this.reject()
        else {
          this.refreshFailedAt = this.clockMark()
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
    const retryWait = this.retryWaitMs()
    const delay = retryWait > 0
      ? retryWait
      : Math.max(REFRESH_RETRY_DELAY_MS, this.remainingMs() - 60_000)
    this.timer = setTimeout(() => { this.timer = null; void this.refresh().catch(() => {}) }, delay)
    this.timer.unref?.()
  }
}

/** Validates the issuer's reply and returns the granted lifetime when the token states it. */
function validateSession(session: DesktopSession, now: number): number | null {
  if (!session || typeof session.accessToken !== 'string' || typeof session.refreshToken !== 'string'
    || !session.refreshToken || !Number.isSafeInteger(session.staffId) || session.staffId <= 0
    || !Number.isSafeInteger(session.organizationId) || session.organizationId <= 0
    || !Number.isFinite(session.expiresAt)) throw new Error('Phiên truy cập dữ liệu không hợp lệ.')
  let claims: Record<string, unknown>
  try { claims = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url').toString('utf8')) }
  catch { throw new Error('Token truy cập không hợp lệ.') }
  // The database verifies the signature. These checks reject an accidental
  // admin/anon response before it could become a Desktop Authorization header.
  if (claims.role !== 'aka_agent_desktop' || claims.session_id !== session.sessionId
    || typeof claims.sub !== 'string' || claims.exp !== session.expiresAt) throw new Error('Token không thuộc phiên Desktop.')
  const issuedAt = claims.iat
  if (typeof issuedAt === 'number' && Number.isFinite(issuedAt)) {
    const lifetimeMs = (session.expiresAt - issuedAt) * 1000
    // The issuer's own clock decides the lifetime, so this machine's clock
    // being fast or slow does not reject a freshly issued token.
    if (lifetimeMs <= 0 || lifetimeMs > MAX_TOKEN_LIFETIME_MS) throw new Error('Phiên truy cập dữ liệu không hợp lệ.')
    return lifetimeMs
  }
  if (session.expiresAt * 1000 <= now) throw new Error('Phiên truy cập dữ liệu không hợp lệ.')
  return null
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
