/**
 * Bot sự kiện (docs/EVENT_BOT_TECH.md mục 8): vòng chạy của app Desktop và App Server, một vòng cho cả tiến trình.
 *
 * - Đọc `sync` lúc bật và 2 phút một lần. Công tắc tắt (`enabled=false`), không tài khoản nào bật bot, hoặc DB chưa có hàm (PGRST202):
 *   không gọi gì thêm. App Server chỉ gọi `sync` khi đang giữ ít nhất một tài khoản Zalo.
 * - Mỗi `pollSeconds` (DB trả, mặc định 30): báo lại kết quả còn treo, rồi một lượt `claim` cho các tài khoản bot bật mà tiến trình này
 *   đang giữ phiên Zalo; gửi lần lượt từng việc qua lõi (packages/campaign-engine/src/eventBot) và báo kết quả.
 * - Sinh nhật: tài khoản có `birthday.scanToday` thì đọc danh sách bạn bè (mỗi trang nghỉ 2–5 giây), lọc người có sinh nhật hôm nay theo
 *   ngày VN của DB, gọi `birthdays` (≤ 2.000 người mỗi lần). Lỗi thì thử lại sau 30 phút.
 * - Dừng: không nhận việc mới; việc đang gửi chờ có kết quả rồi báo; việc đã nhận mà chưa gửi thì báo `failed` (chắc chắn chưa gửi).
 * - Không đụng hạn mức, chiến dịch, lease, khoá thao tác. Không bao giờ ném lỗi ra ngoài.
 *
 * File này không import Electron hay Supabase: mọi IO qua `deps` (bài kiểm scripts/event-bot/desktop/runtime-smoke.cjs).
 */
import { sendEventBotJob, eventBotBirthdayPeople, type EventBotSendPort } from '../../../packages/campaign-engine/src/eventBot/index'
import type { EventBotClaimedJob, EventBotSendResult, EventBotSyncAccount } from '../../shared/eventBot'
import { monotonicNow } from '../../shared/monotonicNow'

export interface EventBotRuntimeDeps {
  source: 'desktop' | 'server'
  runnerId: string
  /** Có nên chạy lúc này (Desktop: còn đăng nhập). */
  active?(): boolean
  /**
   * Được nhận việc mới không (Desktop: bộ giữ sau khi máy ngủ, systemSleepGuard.canStartWork). Máy thức tạm vài giây rồi ngủ lại mà vẫn
   * nhận việc thì việc thành "không rõ" sau 5 phút và không được gửi.
   */
  canStartWork?(): boolean
  /** Tiến trình đang giữ phiên Zalo của tài khoản này (Desktop: Zalo QR có phiên, Zalo trình duyệt đã xác minh tab). */
  isHeld(accountId: number): boolean
  /** App Server: mọi tài khoản đang có phiên trong tiến trình (tham số của `sync`). Desktop không cần. */
  listHeldAccounts?(): number[]
  sync(heldAccountIds: number[]): Promise<unknown>
  birthdays(accountId: number, people: Array<{ uid: string; name: string }>): Promise<unknown>
  claim(runnerId: string, accountIds: number[], limit: number): Promise<unknown>
  report(jobId: number, claimToken: string, result: EventBotSendResult): Promise<unknown>
  port: EventBotSendPort
  /** Một trang danh sách bạn bè Zalo (getAllFriends). */
  readFriendsPage(accountId: number, count: number, page: number): Promise<unknown>
  /** Ngày hôm nay giờ VN theo DB (YYYY-MM-DD). */
  vietnamDate(): Promise<string>
  isRpcMissing?(error: unknown): boolean
  /** Đồng hồ đơn điệu (ms) cho mọi hạn chờ. */
  now?(): number
  /** Giờ máy (ms) chỉ để ghi mốc `lastClaimAt` cho ảnh chụp. */
  wallNow?(): number
  sleep?(ms: number, signal: AbortSignal): Promise<void>
  setTimer?(run: () => void, delayMs: number): unknown
  clearTimer?(handle: unknown): void
  random?(): number
  warn?(kind: string, detail?: Record<string, unknown>): void
  info?(kind: string, detail?: Record<string, unknown>): void
}

export type EventBotRuntimeState = 'stopped' | 'off' | 'idle' | 'running'

export interface EventBotRuntimeSnapshot {
  state: EventBotRuntimeState
  /** Tài khoản bật bot mà tiến trình này đang giữ (lượt gần nhất). */
  accounts: number[]
  lastClaimAt: string | null
}

export interface EventBotRuntimeMetrics {
  ticks: number; syncs: number; claims: number; jobs: number; sent: number; failed: number; unknown: number
  reports: number; reportRetries: number; birthdayScans: number; birthdayPeople: number; failures: number
}

const SYNC_REFRESH_MS = 2 * 60_000
const SYNC_RETRY_MS = 60_000
const MISSING_RPC_RETRY_MS = 30 * 60_000
/** Công tắc event_bot tắt cho nhân viên / nơi chạy: đọc lại thưa hơn (bật lên có hiệu lực trong 30 phút, hoặc khi đăng nhập lại). */
const DISABLED_SYNC_REFRESH_MS = 30 * 60_000
const BIRTHDAY_RETRY_MS = 30 * 60_000
const DEFAULT_POLL_SECONDS = 30
const FRIEND_PAGE_SIZE = 500
const FRIEND_PAGE_LIMIT = 200
const BIRTHDAY_BATCH = 2_000
const REPORT_MAX_ATTEMPTS = 20
const MAX_JOBS_PER_CLAIM = 50

interface SyncState {
  enabled: boolean
  pollSeconds: number
  accounts: EventBotSyncAccount[]
}

interface PendingReport { jobId: number; claimToken: string; result: EventBotSendResult; attempts: number }

const DISABLED: SyncState = { enabled: false, pollSeconds: DEFAULT_POLL_SECONDS, accounts: [] }

function positiveId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,18}$/.test(value.trim()) ? Number(value) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function parseEventBotSync(raw: unknown): SyncState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DISABLED
  const value = raw as { ok?: unknown; enabled?: unknown; pollSeconds?: unknown; accounts?: unknown }
  if (value.ok !== true || value.enabled !== true) return { ...DISABLED }
  const poll = Math.floor(Number(value.pollSeconds))
  const accounts: EventBotSyncAccount[] = []
  for (const item of Array.isArray(value.accounts) ? value.accounts : []) {
    if (!item || typeof item !== 'object') continue
    const row = item as { accountId?: unknown; staffId?: unknown; birthday?: { enabled?: unknown; sendTime?: unknown; scanToday?: unknown } }
    const accountId = positiveId(row.accountId)
    if (!accountId) continue
    accounts.push({
      accountId,
      staffId: positiveId(row.staffId) ?? 0,
      birthday: {
        enabled: row.birthday?.enabled === true,
        sendTime: typeof row.birthday?.sendTime === 'string' ? row.birthday.sendTime : '08:30',
        scanToday: row.birthday?.scanToday === true
      }
    })
  }
  return { enabled: true, pollSeconds: Number.isFinite(poll) ? Math.min(600, Math.max(10, poll)) : DEFAULT_POLL_SECONDS, accounts }
}

export function parseEventBotClaim(raw: unknown): { jobs: EventBotClaimedJob[]; paused: Array<{ accountId: number; until: string | null; code: string | null }> } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as { ok?: unknown; jobs?: unknown; paused?: unknown }
  if (value.ok !== true) return null
  const jobs: EventBotClaimedJob[] = []
  for (const item of Array.isArray(value.jobs) ? value.jobs : []) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const jobId = positiveId(row.jobId)
    const accountId = positiveId(row.accountId)
    const claimToken = typeof row.claimToken === 'string' ? row.claimToken.trim() : ''
    if (!jobId || !accountId || !claimToken) continue
    jobs.push({
      jobId,
      claimToken,
      accountId,
      eventType: row.eventType as EventBotClaimedJob['eventType'],
      direction: row.direction as EventBotClaimedJob['direction'],
      recipientUid: String(row.recipientUid ?? '').trim(),
      recipientName: typeof row.recipientName === 'string' ? row.recipientName : null,
      message: typeof row.message === 'string' ? row.message : ''
    })
  }
  const paused: Array<{ accountId: number; until: string | null; code: string | null }> = []
  for (const item of Array.isArray(value.paused) ? value.paused : []) {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const accountId = positiveId(row.accountId)
    if (accountId) paused.push({ accountId, until: typeof row.until === 'string' ? row.until : null, code: typeof row.code === 'string' ? row.code : null })
  }
  return { jobs: jobs.slice(0, MAX_JOBS_PER_CLAIM), paused }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

export class EventBotRuntime {
  readonly metrics: EventBotRuntimeMetrics = {
    ticks: 0, syncs: 0, claims: 0, jobs: 0, sent: 0, failed: 0, unknown: 0, reports: 0, reportRetries: 0, birthdayScans: 0, birthdayPeople: 0, failures: 0
  }
  private running = false
  private timer: unknown = null
  private inflight: Promise<void> | null = null
  private abort: AbortController = new AbortController()
  private sync: SyncState = { ...DISABLED }
  private syncedOnce = false
  private syncDueAt = Number.NEGATIVE_INFINITY
  private readonly pendingReports: PendingReport[] = []
  /** accountId → ngày VN đã quét xong (không quét lại tới khi ngày đổi). */
  private readonly birthdayDone = new Map<number, string>()
  /** accountId → mốc đơn điệu được thử quét lại. */
  private readonly birthdayRetryAt = new Map<number, number>()
  private heldEnabled: number[] = []
  private lastClaimAt: string | null = null

  constructor(private readonly deps: EventBotRuntimeDeps) {}

  private now(): number { return this.deps.now ? this.deps.now() : monotonicNow() }
  private wallNow(): number { return this.deps.wallNow ? this.deps.wallNow() : Date.now() }
  private random(): number { return this.deps.random ? this.deps.random() : Math.random() }

  start(): void {
    if (this.running) return
    this.running = true
    this.abort = new AbortController()
    this.schedule(3_000 + Math.floor(this.random() * 7_000))
  }

  /** Dừng nhận việc mới. Việc đang gửi vẫn chờ kết quả rồi báo (xem waitForIdle). */
  stop(): void {
    this.running = false
    this.abort.abort()
    if (this.timer !== null) {
      if (this.deps.clearTimer) this.deps.clearTimer(this.timer)
      else clearTimeout(this.timer as ReturnType<typeof setTimeout>)
    }
    this.timer = null
    this.sync = { ...DISABLED }
    this.syncedOnce = false
    this.syncDueAt = Number.NEGATIVE_INFINITY
    this.heldEnabled = []
    this.birthdayDone.clear()
    this.birthdayRetryAt.clear()
  }

  /** Đọc lại cài đặt ở nhịp kế tiếp (vừa đăng nhập Zalo / lưu bot). */
  refreshSoon(): void { this.syncDueAt = Number.NEGATIVE_INFINITY }

  isRunning(): boolean { return this.running }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    const current = this.inflight
    if (!current) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs)) })
    try {
      return await Promise.race([current.then(() => true, () => true), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  snapshot(): EventBotRuntimeSnapshot {
    const state: EventBotRuntimeState = !this.running ? 'stopped'
      : !this.sync.enabled || this.sync.accounts.length === 0 ? 'off'
        : this.heldEnabled.length === 0 ? 'idle' : 'running'
    return { state, accounts: [...this.heldEnabled], lastClaimAt: this.lastClaimAt }
  }

  /** Một nhịp (bài kiểm gọi trực tiếp). */
  async tick(): Promise<void> {
    if (this.inflight) return this.inflight
    this.inflight = this.runTick().catch(error => { this.warn('tick_failed', { message: messageOf(error) }) }).finally(() => { this.inflight = null })
    return this.inflight
  }

  private schedule(delayMs: number): void {
    if (!this.running) return
    const run = (): void => {
      this.timer = null
      void this.tick().finally(() => this.schedule(this.sync.pollSeconds * 1000))
    }
    this.timer = this.deps.setTimer ? this.deps.setTimer(run, delayMs) : setTimeout(run, delayMs)
  }

  private warn(kind: string, detail?: Record<string, unknown>): void {
    this.metrics.failures += 1
    try { this.deps.warn?.(kind, detail) } catch { /* bỏ qua */ }
  }

  private missing(error: unknown): boolean {
    try { return this.deps.isRpcMissing?.(error) === true } catch { return false }
  }

  private async runTick(): Promise<void> {
    this.metrics.ticks += 1
    if (!this.running) return
    if (this.deps.active && !this.deps.active()) return
    await this.flushReports()
    if (!this.running) return

    if (this.now() >= this.syncDueAt) await this.refreshSync()
    if (!this.running || !this.sync.enabled || this.sync.accounts.length === 0) { this.heldEnabled = []; return }

    const held = this.sync.accounts.map(a => a.accountId).filter(id => this.safeHeld(id))
    this.heldEnabled = held
    if (held.length === 0) return
    if (!this.mayStartWork()) return

    await this.claimAndSend(held)
    if (!this.running) return
    await this.scanBirthdays(held)
  }

  private mayStartWork(): boolean {
    try { return this.deps.canStartWork ? this.deps.canStartWork() : true } catch { return false }
  }

  private safeHeld(accountId: number): boolean {
    try { return this.deps.isHeld(accountId) } catch { return false }
  }

  private async refreshSync(): Promise<void> {
    let held: number[] = []
    if (this.deps.source === 'server') {
      try { held = [...new Set((this.deps.listHeldAccounts?.() ?? []).filter(id => Number.isSafeInteger(id) && id > 0))] } catch { held = [] }
      if (held.length === 0) {
        // VPS chưa giữ tài khoản Zalo nào: không hỏi DB.
        this.sync = { ...DISABLED }
        this.syncDueAt = this.now() + SYNC_REFRESH_MS
        return
      }
    }
    this.metrics.syncs += 1
    try {
      this.sync = parseEventBotSync(await this.deps.sync(held))
      this.syncedOnce = true
      this.syncDueAt = this.now() + (this.sync.enabled ? SYNC_REFRESH_MS : DISABLED_SYNC_REFRESH_MS)
    } catch (error) {
      if (this.missing(error)) {
        this.sync = { ...DISABLED }
        this.syncDueAt = this.now() + MISSING_RPC_RETRY_MS
        return
      }
      this.warn('sync_failed', { message: messageOf(error) })
      // Lỗi tạm: giữ cài đặt lần trước (nếu có), thử lại sau 1 phút.
      if (!this.syncedOnce) this.sync = { ...DISABLED }
      this.syncDueAt = this.now() + SYNC_RETRY_MS
    }
  }

  private async claimAndSend(accountIds: number[]): Promise<void> {
    this.metrics.claims += 1
    let parsed: ReturnType<typeof parseEventBotClaim>
    try {
      parsed = parseEventBotClaim(await this.deps.claim(this.deps.runnerId, accountIds, accountIds.length))
    } catch (error) {
      if (this.missing(error)) { this.sync = { ...DISABLED }; this.syncDueAt = this.now() + MISSING_RPC_RETRY_MS; return }
      this.warn('claim_failed', { message: messageOf(error) })
      return
    }
    this.lastClaimAt = new Date(this.wallNow()).toISOString()
    if (!parsed) { this.warn('claim_rejected'); return }
    for (const job of parsed.jobs) {
      this.metrics.jobs += 1
      await this.runJob(job)
    }
  }

  private async runJob(job: EventBotClaimedJob): Promise<void> {
    // Dừng / mất phiên sau lúc nhận việc mà chưa gửi: chắc chắn chưa gửi, báo failed để DB đóng việc (không để thành "không rõ").
    if (!this.running) {
      await this.report(job, { status: 'failed', zaloCode: null, errorMessage: 'Bot dừng trước khi gửi tin này' })
      return
    }
    if (!this.safeHeld(job.accountId)) {
      await this.report(job, { status: 'failed', zaloCode: null, errorMessage: 'Tài khoản không còn đăng nhập trên máy chạy bot' })
      return
    }
    const { outcome } = await sendEventBotJob(job, this.deps.port, { random: () => this.random() })
    const result: EventBotSendResult = outcome
    if (result.status === 'sent') this.metrics.sent += 1
    else if (result.status === 'failed') this.metrics.failed += 1
    else this.metrics.unknown += 1
    await this.report(job, result)
  }

  private async report(job: { jobId: number; claimToken: string }, result: EventBotSendResult): Promise<void> {
    const pending: PendingReport = { jobId: job.jobId, claimToken: job.claimToken, result, attempts: 0 }
    if (!await this.tryReport(pending)) this.pendingReports.push(pending)
  }

  /** true = đã xong (DB nhận, hoặc DB báo việc không còn của mình); false = cần báo lại. */
  private async tryReport(pending: PendingReport): Promise<boolean> {
    pending.attempts += 1
    this.metrics.reports += 1
    try {
      const response = await this.deps.report(pending.jobId, pending.claimToken, pending.result)
      const value = (response && typeof response === 'object' ? response : {}) as { ok?: unknown; code?: unknown }
      if (value.ok === false && value.code !== 'claim_lost') this.warn('report_rejected', { jobId: pending.jobId, code: String(value.code ?? '') })
      return true
    } catch (error) {
      if (this.missing(error)) return true
      this.warn('report_failed', { jobId: pending.jobId, attempts: pending.attempts, message: messageOf(error) })
      return pending.attempts >= REPORT_MAX_ATTEMPTS
    }
  }

  private async flushReports(): Promise<void> {
    if (this.pendingReports.length === 0) return
    const queue = this.pendingReports.splice(0, this.pendingReports.length)
    for (const pending of queue) {
      this.metrics.reportRetries += 1
      if (!await this.tryReport(pending)) this.pendingReports.push(pending)
    }
  }

  private async sleep(ms: number): Promise<boolean> {
    const signal = this.abort.signal
    if (signal.aborted) return false
    if (this.deps.sleep) {
      try { await this.deps.sleep(ms, signal) } catch { return false }
      return !signal.aborted
    }
    await new Promise<void>(resolve => {
      const timer = setTimeout(done, Math.max(0, ms))
      function done(): void { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
      signal.addEventListener('abort', done, { once: true })
    })
    return !signal.aborted
  }

  private async scanBirthdays(held: number[]): Promise<void> {
    const due = this.sync.accounts.filter(a => a.birthday.enabled && a.birthday.scanToday && held.includes(a.accountId)
      && this.now() >= (this.birthdayRetryAt.get(a.accountId) ?? Number.NEGATIVE_INFINITY))
    if (due.length === 0) return
    let vnDate: string
    try {
      vnDate = String(await this.deps.vietnamDate()).trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vnDate)) throw new Error(`Ngày VN không hợp lệ: ${vnDate}`)
    } catch (error) {
      this.warn('vietnam_date_failed', { message: messageOf(error) })
      return
    }
    for (const account of due) {
      if (!this.running) return
      if (this.birthdayDone.get(account.accountId) === vnDate) continue
      const ok = await this.scanBirthdayAccount(account.accountId, vnDate)
      if (ok) {
        this.birthdayDone.set(account.accountId, vnDate)
        this.birthdayRetryAt.delete(account.accountId)
        this.syncDueAt = Number.NEGATIVE_INFINITY // đọc lại để DB báo scanToday = false
      } else if (this.running) {
        this.birthdayRetryAt.set(account.accountId, this.now() + BIRTHDAY_RETRY_MS)
      }
    }
  }

  private async scanBirthdayAccount(accountId: number, vnDate: string): Promise<boolean> {
    this.metrics.birthdayScans += 1
    const seen = new Set<string>()
    const people: Array<{ uid: string; name: string }> = []
    try {
      for (let page = 1; page <= FRIEND_PAGE_LIMIT; page++) {
        if (page > 1 && !await this.sleep(2_000 + Math.floor(this.random() * 3_001))) return false
        if (!this.running || !this.safeHeld(accountId)) return false
        const rows = await this.deps.readFriendsPage(accountId, FRIEND_PAGE_SIZE, page)
        people.push(...eventBotBirthdayPeople(rows, vnDate, seen))
        if (!Array.isArray(rows) || rows.length < FRIEND_PAGE_SIZE) break
      }
    } catch (error) {
      this.warn('birthday_friends_failed', { accountId, message: messageOf(error) })
      return false
    }
    if (!this.running) return false
    this.metrics.birthdayPeople += people.length
    // Gọi cả khi không ai sinh nhật: DB ghi birthday_scanned_on để không quét lại trong ngày.
    const chunks = people.length === 0 ? [[]] : Array.from({ length: Math.ceil(people.length / BIRTHDAY_BATCH) },
      (_, i) => people.slice(i * BIRTHDAY_BATCH, (i + 1) * BIRTHDAY_BATCH))
    for (const chunk of chunks) {
      try {
        const response = await this.deps.birthdays(accountId, chunk)
        const value = (response && typeof response === 'object' ? response : {}) as { ok?: unknown; code?: unknown }
        if (value.ok !== true) { this.warn('birthday_rejected', { accountId, code: String(value.code ?? '') }); return false }
      } catch (error) {
        if (this.missing(error)) return false
        this.warn('birthday_report_failed', { accountId, message: messageOf(error) })
        return false
      }
    }
    try { this.deps.info?.('birthday_scanned', { accountId, vnDate, people: people.length }) } catch { /* bỏ qua */ }
    return true
  }
}
