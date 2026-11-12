/**
 * Dùng lại số tiến độ của chiến dịch không đổi giữa các lượt đọc trang nền của giao diện Desktop
 * (docs/DESKTOP_UI_IDLE_READS.md). Module thuần: không import Electron/Supabase, không tự đọc DB.
 *
 * Chỉ quyết định "lượt này cần đếm lại những chiến dịch nào"; số trả về luôn là số do hàm đếm hiện có đọc từ DB
 * (lượt này hoặc một lượt trước, cũ tối đa `recountMs`). Không dùng cho bộ chạy, hạn mức hay bất kỳ quyết định
 * nghiệp vụ nào: số tiến độ ở danh sách chỉ để hiển thị.
 */

export interface CampaignProgressCounts {
  completed: number
  total: number
}

/** Các trường của dòng chiến dịch mà lượt đọc trang nào cũng có sẵn. */
export interface CampaignProgressRow {
  id: number
  status?: string | null
  updatedAt?: string | null
  lastRunAt?: string | null
  dataGroupSourceStatus?: string | null
  dataGroupSourceUpdatedAt?: string | null
}

interface Entry {
  counts: CampaignProgressCounts
  signature: string
  countedAt: number
  /** Lần gần nhất thấy dấu hiệu thay đổi (hoặc lần đầu ghi nhớ). */
  changedAt: number
}

/** Sau khi một chiến dịch đổi dấu hiệu, vẫn đếm mỗi lượt thêm ngần này ms để không sót các dòng ghi sau cùng. */
export const CAMPAIGN_PROGRESS_SETTLE_MS = 90_000
export const CAMPAIGN_PROGRESS_MAX_ENTRIES = 2000

const RUNNING_STATUS = 'đang chạy'
/** Nguồn nhóm data còn sống: data có thể được thêm từ phía máy chủ bất cứ lúc nào. */
const LIVE_SOURCE_STATUSES = new Set(['baselining', 'active'])

/**
 * Dấu hiệu "có thể đã đổi": mọi kết quả chạy cập nhật `last_run_at`/`updated_at` của chiến dịch (trigger
 * `aka_agent_touch_campaign_last_run_at`), thêm data từ Web/iOS và data tự động từ nhóm data cũng đổi `updated_at`.
 */
function signatureOf(row: CampaignProgressRow): string {
  return JSON.stringify([
    row.status ?? null, row.updatedAt ?? null, row.lastRunAt ?? null,
    row.dataGroupSourceStatus ?? null, row.dataGroupSourceUpdatedAt ?? null
  ])
}

export class CampaignProgressReuse {
  private scope = ''
  private entries = new Map<number, Entry>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries: number = CAMPAIGN_PROGRESS_MAX_ENTRIES
  ) {}

  /** Mỗi phiên (tổ chức + nhân viên) một bộ nhớ riêng; đổi phiên là bỏ hết số cũ. */
  private enter(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope
    this.entries.clear()
  }

  clear(): void {
    this.scope = ''
    this.entries.clear()
  }

  /**
   * ID cần đếm lại trong lượt đọc nền này. Đếm khi: chưa có số; đang chạy; đang mở chi tiết; nguồn nhóm data còn
   * sống; dấu hiệu khác lần đếm trước; vừa đổi trong `CAMPAIGN_PROGRESS_SETTLE_MS`; hoặc số đã cũ quá `recountMs`.
   */
  plan(scope: string, rows: CampaignProgressRow[], options: { recountMs: number; selectedId?: number | null }): number[] {
    this.enter(scope)
    const now = this.now()
    const ids: number[] = []
    for (const row of rows) {
      const entry = this.entries.get(row.id)
      if (!entry
        || row.status === RUNNING_STATUS
        || row.id === options.selectedId
        || LIVE_SOURCE_STATUSES.has(String(row.dataGroupSourceStatus ?? ''))
        || entry.signature !== signatureOf(row)
        || now - entry.changedAt < CAMPAIGN_PROGRESS_SETTLE_MS
        // Đồng hồ máy lùi (đổi giờ) cũng coi là đã cũ.
        || now - entry.countedAt >= options.recountMs
        || now < entry.countedAt) {
        ids.push(row.id)
      }
    }
    return ids
  }

  /**
   * Ghi nhớ số vừa đếm cho các dòng đã đếm. Chiến dịch không có dòng data nào (hàm đếm không trả dòng) được ghi
   * rõ là 0/0 để lượt sau không coi là "chưa có số". `startedAt` là lúc lượt đếm này bắt đầu.
   */
  store(
    scope: string,
    rows: CampaignProgressRow[],
    counts: ReadonlyMap<number, CampaignProgressCounts>,
    startedAt: number = this.now()
  ): void {
    this.enter(scope)
    for (const row of rows) {
      const signature = signatureOf(row)
      const previous = this.entries.get(row.id)
      // Một lượt đếm bắt đầu muộn hơn đã ghi rồi: không để lượt cũ về sau ghi đè số mới.
      if (previous && previous.countedAt > startedAt) continue
      const counted = counts.get(row.id)
      this.entries.delete(row.id)
      this.entries.set(row.id, {
        counts: { completed: counted?.completed ?? 0, total: counted?.total ?? 0 },
        signature,
        // Tính tuổi của số từ lúc bắt đầu đếm, không phải lúc RPC trả về.
        countedAt: startedAt,
        changedAt: previous && previous.signature === signature ? previous.changedAt : startedAt
      })
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  get(scope: string, id: number): CampaignProgressCounts | undefined {
    if (scope !== this.scope) return undefined
    const entry = this.entries.get(id)
    return entry ? { ...entry.counts } : undefined
  }

  /**
   * Số tiến độ cho mọi dòng của một lượt đọc trang. `full` đếm tất cả như trước và ghi nhớ; `reuse` chỉ đếm các
   * dòng `plan` chọn, phần còn lại lấy số đã ghi nhớ. Không có dòng nào cần đếm thì không gọi `loadCounts`.
   * Lỗi của `loadCounts` được ném nguyên ra ngoài (lượt đọc trang lỗi như trước), không trả số cũ thay thế.
   */
  async resolve(
    scope: string,
    rows: CampaignProgressRow[],
    options: { mode: 'reuse' | 'full'; recountMs: number; selectedId?: number | null },
    loadCounts: (ids: number[]) => Promise<ReadonlyMap<number, CampaignProgressCounts>>
  ): Promise<Map<number, CampaignProgressCounts>> {
    const startedAt = this.now()
    const ids = options.mode === 'reuse'
      ? this.plan(scope, rows, { recountMs: options.recountMs, selectedId: options.selectedId })
      : rows.map(row => row.id)
    const counted = ids.length > 0 ? await loadCounts(ids) : new Map<number, CampaignProgressCounts>()
    const countedIds = new Set(ids)
    this.store(scope, rows.filter(row => countedIds.has(row.id)), counted, startedAt)
    const result = new Map<number, CampaignProgressCounts>()
    for (const row of rows) {
      const counts = countedIds.has(row.id) ? counted.get(row.id) : this.get(scope, row.id)
      result.set(row.id, { completed: counts?.completed ?? 0, total: counts?.total ?? 0 })
    }
    return result
  }
}
