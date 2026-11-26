/**
 * Sổ tag Zalo (V660, docs/ZALO_TAG_AUTO_SEND_PLAN.md): phần chạy trong App Server và app Desktop.
 *
 * Mỗi `pollSeconds` (DB trả, mặc định 60): với từng tài khoản đang có chiến dịch "tự gửi cho người được gắn tag", đọc danh sách tag
 * bằng phiên Zalo đang có (không đăng nhập thêm), gửi một lô `{a, v}` (tài khoản, phiên bản tag) xuống DB. DB trả `needTags` cho tài
 * khoản có phiên bản đổi; khi đó gửi lại tài khoản đó kèm cả danh sách tag (mỗi lần gọi một tài khoản). DB so với lần trước và tự
 * đưa người mới gắn tag vào chiến dịch; ở đây không quyết định gì.
 *
 * Danh sách tài khoản đọc lại mỗi 2 phút (hoặc ngay khi `refreshSoon`). Tính năng tắt, hoặc không có tài khoản nào: chỉ còn lượt đọc
 * danh sách đó. Không bao giờ ném lỗi ra ngoài.
 *
 * File này không import Electron hay Supabase: mọi IO đi qua `deps` (bài kiểm scripts/zalo-tag-sync/runtime-smoke.cjs).
 */
import {
  parseZaloTagSyncAccounts, parseZaloTagSyncResult, zaloTagSnapshotFromLabels,
  type ZaloTagSyncAccounts, type ZaloTagSyncItem
} from '../../shared/zaloTagAutoAdd'

export interface ZaloTagSyncDeps {
  /** Danh sách tài khoản cần hỏi tag (đã lọc theo nơi chạy). */
  loadAccounts(): Promise<unknown>
  /** Gửi một lô xuống DB, trả nguyên phản hồi. */
  sync(items: ZaloTagSyncItem[]): Promise<unknown>
  /** Đọc tag bằng phiên đang có; không có phiên thì null. */
  readLabels(accountId: number): Promise<{ version: string; labels: Array<{ id: unknown; text?: unknown; conversations?: unknown }> } | null>
  /** Có nên chạy lúc này không (Desktop: đang đăng nhập). */
  active?(): boolean
  now?(): number
  setTimer?(run: () => void, delayMs: number): unknown
  clearTimer?(handle: unknown): void
  warn?(kind: string, detail?: Record<string, unknown>): void
}

const ACCOUNTS_REFRESH_MS = 2 * 60_000
const MAX_ITEMS_PER_CALL = 200

export interface ZaloTagSyncMetrics {
  ticks: number; reads: number; calls: number; snapshots: number; added: number; campaignRows: number; failures: number
}

export class ZaloTagSyncRuntime {
  readonly metrics: ZaloTagSyncMetrics = { ticks: 0, reads: 0, calls: 0, snapshots: 0, added: 0, campaignRows: 0, failures: 0 }
  private running = false
  private timer: unknown = null
  private inflight: Promise<void> | null = null
  private accounts: ZaloTagSyncAccounts = { enabled: false, pollSeconds: 60, accountIds: [] }
  private accountsAt = Number.NEGATIVE_INFINITY

  constructor(private readonly deps: ZaloTagSyncDeps) {}

  private now(): number { return this.deps.now ? this.deps.now() : Date.now() }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule(5_000 + Math.floor(Math.random() * 10_000))
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) {
      if (this.deps.clearTimer) this.deps.clearTimer(this.timer)
      else clearTimeout(this.timer as ReturnType<typeof setTimeout>)
    }
    this.timer = null
    this.accounts = { enabled: false, pollSeconds: 60, accountIds: [] }
    this.accountsAt = Number.NEGATIVE_INFINITY
  }

  /** Đọc lại danh sách tài khoản ở nhịp kế tiếp (vừa lưu chiến dịch, vừa đăng nhập Zalo). */
  refreshSoon(): void {
    this.accountsAt = Number.NEGATIVE_INFINITY
  }

  /** Một nhịp (bài kiểm gọi trực tiếp). */
  async tick(): Promise<void> {
    if (this.inflight) return this.inflight
    this.inflight = this.runTick().finally(() => { this.inflight = null })
    return this.inflight
  }

  private schedule(delayMs: number): void {
    if (!this.running) return
    const run = (): void => {
      this.timer = null
      void this.tick().finally(() => this.schedule(this.accounts.pollSeconds * 1000))
    }
    this.timer = this.deps.setTimer ? this.deps.setTimer(run, delayMs) : setTimeout(run, delayMs)
  }

  private warn(kind: string, detail?: Record<string, unknown>): void {
    this.metrics.failures += 1
    try { this.deps.warn?.(kind, detail) } catch { /* bỏ qua */ }
  }

  private async runTick(): Promise<void> {
    this.metrics.ticks += 1
    if (this.deps.active && !this.deps.active()) return
    if (this.now() - this.accountsAt >= ACCOUNTS_REFRESH_MS) {
      try {
        this.accounts = parseZaloTagSyncAccounts(await this.deps.loadAccounts())
        this.accountsAt = this.now()
      } catch (error) {
        this.accountsAt = this.now() - ACCOUNTS_REFRESH_MS + 60_000 // thử lại sau 1 phút
        this.warn('load_accounts_failed', { message: messageOf(error) })
        return
      }
    }
    if (!this.accounts.enabled || this.accounts.accountIds.length === 0) return

    // Đọc tag từng tài khoản (tuần tự: mỗi tài khoản một lượt gọi Zalo mỗi nhịp).
    const snapshots = new Map<number, { version: string; labels: Array<{ id: unknown; text?: unknown; conversations?: unknown }> }>()
    for (const accountId of this.accounts.accountIds) {
      try {
        const read = await this.deps.readLabels(accountId)
        if (!read) continue
        this.metrics.reads += 1
        snapshots.set(accountId, read)
      } catch (error) {
        this.warn('read_labels_failed', { accountId, message: messageOf(error) })
      }
    }
    if (snapshots.size === 0) return

    const heartbeat: ZaloTagSyncItem[] = [...snapshots.entries()].map(([a, s]) => ({ a: String(a), v: s.version }))
    const rejected = new Set<number>()
    try {
      await this.sendSnapshots(heartbeat, snapshots, rejected)
    } finally {
      // DB không nhận tài khoản này nữa (chiến dịch tắt, đổi tài khoản): bỏ khỏi danh sách tới lần đọc lại, kể cả khi nhịp dừng giữa
      // chừng (lô sau lỗi mạng / DB báo tắt), không thì nhịp sau vẫn đọc Zalo của tài khoản DB đã từ chối.
      if (rejected.size > 0) {
        this.accounts = { ...this.accounts, accountIds: this.accounts.accountIds.filter(id => !rejected.has(id)) }
      }
    }
  }

  private async sendSnapshots(heartbeat: ZaloTagSyncItem[],
    snapshots: Map<number, { version: string; labels: Array<{ id: unknown; text?: unknown; conversations?: unknown }> }>,
    rejected: Set<number>): Promise<void> {
    const needTags: number[] = []
    for (let i = 0; i < heartbeat.length; i += MAX_ITEMS_PER_CALL) {
      const result = await this.call(heartbeat.slice(i, i + MAX_ITEMS_PER_CALL))
      if (!result) return
      if (!result.enabled) { this.accounts = { ...this.accounts, enabled: false }; return }
      needTags.push(...result.needTags)
      result.rejected.forEach(id => rejected.add(id))
    }
    for (const accountId of needTags) {
      const snapshot = snapshots.get(accountId)
      if (!snapshot) continue
      const result = await this.call([{ a: String(accountId), v: snapshot.version, tags: zaloTagSnapshotFromLabels(snapshot.labels) }])
      if (!result) continue
      if (!result.enabled) { this.accounts = { ...this.accounts, enabled: false }; return }
      this.metrics.snapshots += 1
      this.metrics.added += result.added
      this.metrics.campaignRows += result.campaignRows
      result.rejected.forEach(id => rejected.add(id))
    }
  }

  private async call(items: ZaloTagSyncItem[]): Promise<ReturnType<typeof parseZaloTagSyncResult> | null> {
    this.metrics.calls += 1
    try {
      return parseZaloTagSyncResult(await this.deps.sync(items))
    } catch (error) {
      this.warn('sync_failed', { items: items.length, message: messageOf(error) })
      return null
    }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}
