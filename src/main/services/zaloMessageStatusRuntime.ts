/**
 * Đồng bộ trạng thái tin nhắn Zalo (đã nhận, đã xem, đã tương tác, đã phản hồi) cho tài khoản KHÔNG có akaChat: phần chạy
 * trong chương trình gửi tin (App Server và app Desktop).
 *
 * Ba việc, đều "cố gắng hết mức" và không bao giờ làm chậm hay làm hỏng việc gửi tin / nhận tin:
 *   1. lúc gửi xong một tin 1-1 (hoặc lời mời kết bạn) của chiến dịch: dựng dấu tham chiếu `zaloStatusRef` để ghi cùng kết
 *      quả gửi (trigger trong DB đọc dấu này để đăng ký lượt gửi);
 *   2. rút gọn sự kiện của bộ nghe Zalo (tin đến, cảm xúc, đã nhận, đã xem, đồng ý kết bạn) vào một bộ đệm trong RAM;
 *   3. mỗi `flushIntervalSeconds` gửi bộ đệm xuống DB thành một lô.
 *
 * ĐỘC LẬP với theo dõi tương tác cũ (zaloCampaignEngagement.ts, V339): công tắc riêng (`zalo.message_status_sync.*`), bộ đệm
 * riêng, lời gọi DB riêng; không đọc và không ghi gì của cơ chế kia. Hai bên bật / tắt riêng được.
 *
 * File này không import Electron hay Supabase: mọi IO đi qua `deps`, để chạy được trong bài kiểm
 * (scripts/zalo-message-status-sync-smoke.cjs). Nối với DB thật ở zaloMessageStatusSync.ts.
 * Hợp đồng và phần DB: akaAgentWebApp docs/ZALO_MESSAGE_STATUS_SYNC.md; phía chương trình gửi: docs/ZALO_MESSAGE_STATUS_SYNC.md.
 */
import {
  DEFAULT_MESSAGE_STATUS_SYNC_CONFIG, MessageStatusEventBuffer, ZALO_STATUS_REF_KEY, makeZaloStatusRef,
  messageStatusSyncCoversOrganization, normalizeMessageStatusEvents, parseMessageStatusIngestResult,
  parseMessageStatusSyncConfig, toMessageStatusIngestItems,
  type MessageStatusEvent, type MessageStatusIngestItem, type MessageStatusSyncConfig, type MessageStatusSyncSettingRow, type ZaloStatusRef
} from '../../shared/zaloMessageStatusSync'

export interface ZaloMessageStatusRuntimeDeps {
  /** Đọc các dòng `zalo.message_status_sync.*` của `auto_system_settings` (một lượt đọc nhỏ, có hạn giờ). */
  loadSettings(): Promise<readonly MessageStatusSyncSettingRow[]>
  /** Gửi một lô xuống DB và trả nguyên phản hồi của hàm nhận lô. Ném lỗi khi gọi không được. */
  ingest(items: readonly MessageStatusIngestItem[]): Promise<unknown>
  /** Giờ hiện tại (ISO): theo đồng hồ DB khi đang có, không thì giờ máy. */
  nowIso(): string
  /** Mốc thời gian cho hẹn giờ nội bộ (mili giây). Mặc định `Date.now`. */
  now?(): number
  setTimer?(run: () => void, delayMs: number): unknown
  clearTimer?(handle: unknown): void
  /** Cảnh báo vận hành; không bao giờ mang nội dung tin hay định danh người nhận. */
  warn?(kind: string, detail?: Record<string, unknown>): void
}

/** Tài khoản đang gửi, đủ để quyết định có ghi dấu tham chiếu hay không. */
export interface ZaloMessageStatusAccount {
  id: number
  /** UID Zalo của tài khoản (lấy từ phiên đang chạy; không có thì không ghi dấu). */
  zaloUid?: string | null
  /** Tài khoản đăng nhập bằng trình duyệt không có bộ nghe: ngoài phạm vi. */
  isZaloShowWeb?: boolean | null
  organizationId?: number | null
}

/** Một lần gửi tới một người. Tạo ngay TRƯỚC lệnh gửi; chỉ gọi `detailData` khi gửi thành công. */
export interface ZaloMessageStatusSend {
  /** Ghi lại giờ gửi. Lô chia sẻ tạo sẵn cho cả lô rồi gọi hàm này ngay trước khi gửi cho từng người. */
  markSending(): void
  /** Trường trải vào `data` của kết quả gửi THÀNH CÔNG: `{ zaloStatusRef }`, hoặc `{}` khi tính năng tắt / ngoài phạm vi. */
  detailData(sendResults: unknown): Record<string, unknown>
}

export interface ZaloMessageStatusMetrics {
  received: number; buffered: number; refs: number; flushes: number; sent: number; matched: number; rejected: number
  failures: number; settingsReads: number
  /** Sự kiện bị bỏ vì bộ đệm đầy. */
  dropped: number
}

/** Tuổi tối đa của cấu hình đã đọc khi tính năng đang BẬT. Tắt công tắc: lô kế tiếp báo ngay, không thì tối đa chừng này. */
export const CONFIG_MAX_AGE_MS = 5 * 60_000
/** Khi tính năng đang TẮT thì đọc lại thưa hơn: bật công tắc có hiệu lực trong tối đa chừng này. */
export const CONFIG_MAX_AGE_OFF_MS = 15 * 60_000
const CONFIG_RETRY_MS = 60_000
/** Tài khoản bị DB từ chối (có akaChat, ngoài phạm vi): ngừng thu 10 phút, mỗi lần bị từ chối tiếp thì gấp đôi, tối đa 2 giờ. */
const REJECT_BLOCK_MS = 10 * 60_000
const REJECT_BLOCK_MAX_MS = 2 * 60 * 60_000
const INGEST_BACKOFF_MS = [60_000, 120_000, 300_000] as const
/**
 * Ngừng thu và không gọi hàm nhận lô trong chừng này khi: DB chưa có hàm (migration chưa apply hoặc đã gỡ), DB từ chối kiểu
 * gửi lại cũng không khác (thiếu quyền, sai định danh, sai dữ liệu), DB báo đang tạm ngừng nhận (chạm trần trong ngày), hoặc
 * lô đã lỗi liên tiếp quá số lần cho phép.
 */
export const LONG_PAUSE_MS = 30 * 60_000
/** Một lô lỗi liên tiếp chừng này lần thì bỏ, không giữ mãi ("cố gắng hết mức"). */
const MAX_INGEST_ATTEMPTS = 6
const BUFFER_MAX_ROWS = 5000
/** Còn đầy bộ đệm sau một lô thì gửi lô kế tiếp sau khoảng ngắn này, không chờ hết chu kỳ. */
const DRAIN_DELAY_MS = 2_000

export class ZaloMessageStatusRuntime {
  private config: MessageStatusSyncConfig = { ...DEFAULT_MESSAGE_STATUS_SYNC_CONFIG }
  private configAt = Number.NEGATIVE_INFINITY
  private configRetryAt = 0
  private configFailures = 0
  private refreshing: Promise<void> | undefined
  private readonly buffer: MessageStatusEventBuffer
  private readonly rejections = new Map<string, number>()
  private timer: unknown
  private timerAt = 0
  private flushing = false
  private ingestFailures = 0
  /** Sau một lô lỗi: không gửi lại trước mốc này, kể cả khi sự kiện mới vẫn tới đều. */
  private retryNotBefore = 0
  /** Tăng mỗi lần `reset`: lô đang gửi dở của người đăng nhập trước không được đưa trở lại bộ đệm. */
  private generation = 0
  /** Không thu cho tới mốc này: DB báo đang tắt / tạm ngừng nhận, DB từ chối, hoặc lô lỗi quá nhiều lần. */
  private captureSuspendedUntil = 0
  readonly metrics: ZaloMessageStatusMetrics = {
    received: 0, buffered: 0, refs: 0, flushes: 0, sent: 0, matched: 0, rejected: 0, failures: 0, settingsReads: 0, dropped: 0
  }

  constructor(private readonly deps: ZaloMessageStatusRuntimeDeps) {
    this.buffer = new MessageStatusEventBuffer(BUFFER_MAX_ROWS, () => this.now())
  }

  private now(): number { return this.deps.now ? this.deps.now() : Date.now() }

  /** Đọc lại cấu hình ở nền khi bản đang giữ đã cũ. Không bao giờ chờ: nơi gọi dùng bản đang có. */
  private touchConfig(): void {
    const now = this.now()
    const maxAge = this.config.enabled ? CONFIG_MAX_AGE_MS : CONFIG_MAX_AGE_OFF_MS
    if (this.refreshing || now - this.configAt < maxAge || now < this.configRetryAt) return
    this.metrics.settingsReads += 1
    let pending: Promise<readonly MessageStatusSyncSettingRow[]>
    try { pending = this.deps.loadSettings() } catch (error) { pending = Promise.reject(error) }
    this.refreshing = pending.then(rows => {
      this.config = parseMessageStatusSyncConfig(rows)
      this.configAt = this.now()
      this.configFailures = 0
      if (!this.config.enabled || !this.config.captureEnabled) this.dropBuffered()
    }, () => {
      // Giữ cấu hình đang có; thử lại thưa dần. Chưa từng đọc được thì vẫn là "tắt".
      this.configFailures += 1
      this.configRetryAt = this.now() + Math.min(CONFIG_RETRY_MS * this.configFailures, CONFIG_MAX_AGE_MS)
      this.deps.warn?.('settings_unavailable', { failures: this.configFailures })
    }).finally(() => { this.refreshing = undefined })
  }

  /** Chờ lượt đọc cấu hình đang chạy (chỉ dùng cho bài kiểm và lúc tắt tiến trình). */
  async settled(): Promise<void> { await this.refreshing }

  /** Công tắc tổng đang bật (và tổ chức thuộc phạm vi, nếu biết tổ chức). Không chờ IO. */
  enabled(organizationId?: number | null): boolean {
    this.touchConfig()
    if (!this.config.enabled) return false
    return organizationId === undefined || organizationId === null
      ? true : messageStatusSyncCoversOrganization(this.config, organizationId)
  }

  private captureActive(organizationId?: number | null): boolean {
    return this.enabled(organizationId) && this.config.captureEnabled && this.now() >= this.captureSuspendedUntil
  }

  /**
   * Gọi ngay trước khi gửi một tin 1-1 hoặc lời mời kết bạn của chiến dịch. Trả `null` khi chắc chắn không theo dõi được
   * (tài khoản trình duyệt, thiếu UID). Việc "tính năng có đang bật không" được xét lúc `detailData`, tức sau khi lệnh gửi
   * đã xong: lần gửi đầu tiên sau khi mở chương trình vì thế không bị lỡ trong lúc cấu hình còn đang được đọc.
   */
  beginSend(account: ZaloMessageStatusAccount, targetUid: string | null | undefined, kind: ZaloStatusRef['k']): ZaloMessageStatusSend | null {
    const ownUid = String(account.zaloUid ?? '').trim()
    const target = String(targetUid ?? '').trim()
    if (account.isZaloShowWeb || !ownUid || !target || ownUid === target) return null
    this.touchConfig()
    let sentAt = this.safeNowIso()
    return {
      markSending: () => { sentAt = this.safeNowIso() },
      detailData: sendResults => {
        try {
          if (!this.enabled(account.organizationId)) return {}
          if (kind === 'friend_request' && !this.config.trackFriendAccept) return {}
          const ref = makeZaloStatusRef(ownUid, target, kind, sentAt, sendResults)
          if (!ref) return {}
          this.metrics.refs += 1
          return { [ZALO_STATUS_REF_KEY]: ref }
        } catch {
          return {}
        }
      }
    }
  }

  private safeNowIso(): string {
    try {
      const value = this.deps.nowIso()
      if (Number.isFinite(Date.parse(value))) return value
    } catch { /* dùng giờ máy */ }
    return new Date().toISOString()
  }

  /**
   * Một sự kiện của bộ nghe Zalo. Không ném lỗi, không chờ IO. `organizationId` là tổ chức của tài khoản nếu nơi gọi biết;
   * không biết thì cứ thu, DB quyết định phạm vi và trả về tài khoản bị từ chối.
   */
  receive(type: string, payload: unknown, accountId: number, ownUid: string, organizationId?: number | null): void {
    try {
      if (!this.captureActive(organizationId)) return
      const account = String(accountId)
      if (this.buffer.isBlocked(account)) return
      this.metrics.received += 1
      const events = normalizeMessageStatusEvents(type, payload, account, ownUid, this.safeNowIso(), {
        replyIgnoredKinds: this.config.replyIgnoredKinds, trackFriendAccept: this.config.trackFriendAccept
      })
      if (!events.length) return
      this.pushEvents(events)
      this.schedule(this.config.flushIntervalSeconds * 1000)
    } catch {
      this.deps.warn?.('event_unreadable')
    }
  }

  /** Đưa sự kiện vào bộ đệm; đầy thì phần thừa bị bỏ và được đếm, có cảnh báo. */
  private pushEvents(events: readonly MessageStatusEvent[]): void {
    const before = this.buffer.dropped
    this.buffer.push(events)
    const lost = this.buffer.dropped - before
    this.metrics.buffered = this.buffer.size
    if (lost > 0) {
      this.metrics.dropped += lost
      this.deps.warn?.('buffer_full', { dropped: this.metrics.dropped })
    }
  }

  /** Số sự kiện đang chờ gửi. */
  get pending(): number { return this.buffer.size }

  private schedule(delayMs: number): void {
    const now = this.now()
    const at = Math.max(now + Math.max(1, delayMs), this.retryNotBefore)
    // Sự kiện tới sau không đẩy lùi hạn gửi của lô đang chờ.
    if (this.timer !== undefined && this.timerAt <= at) return
    this.cancelTimer()
    this.timerAt = at
    const wait = Math.max(1, at - now)
    const run = (): void => { this.timer = undefined; this.timerAt = 0; void this.flush() }
    if (this.deps.setTimer) this.timer = this.deps.setTimer(run, wait)
    else {
      const handle = setTimeout(run, wait)
      handle.unref?.() // Không giữ tiến trình sống chỉ vì còn lô chờ gửi.
      this.timer = handle
    }
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return
    if (this.deps.clearTimer) this.deps.clearTimer(this.timer)
    else clearTimeout(this.timer as ReturnType<typeof setTimeout>)
    this.timer = undefined
    this.timerAt = 0
  }

  private dropBuffered(): void {
    this.buffer.clear()
    this.rejections.clear()
    this.metrics.buffered = 0
    this.cancelTimer()
  }

  /** Bỏ mọi thứ đang đệm (đổi người đăng nhập, đăng xuất). Cấu hình được đọc lại ở lần dùng kế tiếp. */
  reset(): void {
    this.generation += 1
    this.dropBuffered()
    this.captureSuspendedUntil = 0
    this.ingestFailures = 0
    this.retryNotBefore = 0
  }

  /** Gửi một lô. Mỗi lúc chỉ một lượt chạy; lỗi được giữ lại để gửi ở lượt sau, không bao giờ ném ra ngoài. */
  async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      if (!this.captureActive()) { this.dropBuffered(); return }
      const events = this.buffer.take(this.config.flushMaxRows)
      this.metrics.buffered = this.buffer.size
      if (!events.length) return
      this.metrics.flushes += 1
      const generation = this.generation
      let raw: unknown
      try {
        raw = await this.deps.ingest(toMessageStatusIngestItems(events))
      } catch (error) {
        this.metrics.failures += 1
        if (generation !== this.generation) return // đã đổi người đăng nhập trong lúc gửi: bỏ lô cũ
        const permanent = permanentErrorKind(error)
        if (permanent || this.ingestFailures + 1 >= MAX_INGEST_ATTEMPTS) {
          // Gửi lại cũng không khác (DB chưa có hàm, thiếu quyền, sai dữ liệu), hoặc đã lỗi liên tiếp quá nhiều lần: bỏ lô,
          // ngừng thu một thời gian rồi mới thử lại.
          this.captureSuspendedUntil = this.now() + LONG_PAUSE_MS
          this.ingestFailures = 0
          this.retryNotBefore = 0
          this.dropBuffered()
          this.deps.warn?.(permanent ?? 'ingest_given_up')
          return
        }
        // Giữ lô để gửi lại (ghi lại không đổi kết quả); thưa dần khi lỗi liên tiếp.
        this.pushEvents(events)
        const delay = INGEST_BACKOFF_MS[Math.min(this.ingestFailures, INGEST_BACKOFF_MS.length - 1)]
        this.ingestFailures += 1
        this.retryNotBefore = this.now() + delay
        this.deps.warn?.('ingest_failed', { failures: this.ingestFailures })
        // Hẹn giờ do sự kiện mới đặt trong lúc gửi có thể sớm hơn hạn thử lại: đặt lại theo hạn thử lại.
        this.cancelTimer()
        this.schedule(delay)
        return
      }
      if (generation !== this.generation) return
      this.ingestFailures = 0
      this.retryNotBefore = 0
      const result = parseMessageStatusIngestResult(raw)
      if (!result.enabled) {
        if (result.paused) {
          // DB tạm ngừng nhận (chạm trần trong ngày, job phụ lỗi): công tắc không đổi, nên không đọc lại cấu hình; nghỉ dài.
          this.captureSuspendedUntil = this.now() + LONG_PAUSE_MS
        } else {
          // Công tắc vừa bị tắt: ngừng thu và đọc lại cấu hình ngay ở lần dùng kế tiếp.
          this.captureSuspendedUntil = this.now() + CONFIG_MAX_AGE_MS
          this.configAt = Number.NEGATIVE_INFINITY
        }
        this.dropBuffered()
        return
      }
      this.metrics.sent += events.length
      this.metrics.matched += result.matched
      this.config = {
        ...this.config, flushIntervalSeconds: result.flushIntervalSeconds, flushMaxRows: result.flushMaxRows,
        trackFriendAccept: result.trackFriendAccept, replyIgnoredKinds: result.replyIgnoredKinds
      }
      this.noteRejected(result.rejectedAccountIds, new Set(events.map(event => event.accountId)))
      this.metrics.buffered = this.buffer.size
      if (this.buffer.size >= this.config.flushMaxRows) this.schedule(DRAIN_DELAY_MS)
      else if (this.buffer.size > 0) this.schedule(this.config.flushIntervalSeconds * 1000)
    } finally {
      this.flushing = false
    }
  }

  private noteRejected(rejected: readonly string[], sentAccounts: ReadonlySet<string>): void {
    const now = this.now()
    const rejectedSet = new Set(rejected)
    // Tài khoản vừa được nhận lại thì quên số lần bị từ chối trước đó.
    for (const account of sentAccounts) if (!rejectedSet.has(account)) this.rejections.delete(account)
    for (const account of rejectedSet) {
      const count = (this.rejections.get(account) ?? 0) + 1
      this.rejections.set(account, count)
      this.metrics.rejected += 1
      this.buffer.blockAccounts([account], now + Math.min(REJECT_BLOCK_MS * 2 ** (count - 1), REJECT_BLOCK_MAX_MS))
    }
    // Sổ đếm không lớn mãi: tài khoản đã hết hạn chặn mà không còn sự kiện nào thì tự bị quên ở đây.
    if (this.rejections.size > 20_000) this.rejections.clear()
  }
}

/**
 * Lỗi mà gửi lại cũng không khác; trả tên cảnh báo, hoặc null với lỗi có thể tự hết (mạng, quá giờ, khoá, phiên hết hạn).
 * - PGRST202 / 42883: DB chưa có hàm nhận lô;
 * - 42xxx (thiếu quyền, sai định danh phiên Desktop), 22xxx / 23xxx (dữ liệu bị từ chối), PGRST1xx / PGRST2xx (lời gọi sai dạng).
 */
function permanentErrorKind(error: unknown): string | null {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  if (code === 'PGRST202' || code === '42883') return 'ingest_function_missing'
  if (/^(22|23|42)[0-9A-Z]{3}$/.test(code) || /^PGRST[12][0-9]{2}$/.test(code)) return 'ingest_rejected'
  return null
}
