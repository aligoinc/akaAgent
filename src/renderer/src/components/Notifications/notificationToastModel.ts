import type { NotificationListItem } from '../../../../shared/types'

/**
 * Thông báo nổi của Desktop (phương án docs/NOTIFICATION_ASSISTANT_INBOX_PLAN.md, anh chọn "Giữ chuông, làm sau"): khi có Chào
 * ngày mới, báo cáo 12:00 / 18:00 hoặc chiến dịch hoàn thành mới thì hiện một thẻ ở góc phải. Cùng luật với Web
 * (akaAgentWebApp apps/web/src/lib/notificationToast.ts). Không có hẹn giờ đọc DB theo nhịp: chỉ đọc danh sách khi số chưa đọc
 * của chuông tăng, và hỏi số chưa đọc đúng lúc có báo cáo theo lịch (mốc `nextRunAt` của cài đặt thông báo).
 */
export const NOTIFICATION_TOAST_TYPES: readonly string[] = ['report.morning', 'report.scheduled', 'campaign.status_changed']
/** Thông báo cũ hơn mốc này không nổi lên nữa (mở app muộn thì xem trong chuông). */
export const NOTIFICATION_TOAST_MAX_AGE_MS = 3 * 60 * 60_000
export const NOTIFICATION_TOAST_DURATION_MS = 12_000
/** Hỏi lại số chưa đọc sau mốc gửi báo cáo theo lịch (worker cần chừng nửa phút tới vài phút để dựng báo cáo). */
export const NOTIFICATION_TOAST_SCHEDULE_DELAYS_MS: readonly number[] = [60_000, 300_000]
/** Chỉ hẹn trước các mốc trong khoảng này; mốc xa hơn được hẹn khi đọc lại cài đặt sau lần hỏi cuối. */
export const NOTIFICATION_TOAST_SCHEDULE_HORIZON_MS = 26 * 60 * 60_000
/** Chiến dịch trên trang chuyển sang "hoàn thành" thì hỏi lại số chưa đọc sau ngần này. */
export const NOTIFICATION_TOAST_CAMPAIGN_DELAY_MS = 60_000

/** Thông báo chưa đọc mới nhất đáng nổi lên mà máy này chưa hiện (id lớn hơn id đã hiện gần nhất). */
export function pickToastNotification(items: readonly NotificationListItem[], lastShownId: number | null, now = Date.now()): NotificationListItem | null {
  for (const item of items) {
    if (item.readAt || !NOTIFICATION_TOAST_TYPES.includes(item.eventType)) continue
    if (lastShownId !== null && item.id <= lastShownId) continue
    const at = Date.parse(item.createdAt || item.occurredAt)
    if (!Number.isFinite(at) || now - at > NOTIFICATION_TOAST_MAX_AGE_MS) continue
    return item
  }
  return null
}

export function toastActionLabel(item: Pick<NotificationListItem, 'eventType'>): string {
  return item.eventType === 'campaign.status_changed' ? 'Xem chiến dịch' : 'Xem báo cáo'
}

/** Có nên đọc danh sách không: lần đầu thấy số > 0, hoặc số tăng so với lần trước. */
export function shouldCheckForToast(previous: number | null, current: number | null | undefined): boolean {
  if (current === null || current === undefined || current <= 0) return false
  return previous === null || current > previous
}

/**
 * Độ trễ (ms, tính từ `now`) của các lần hỏi số chưa đọc cho mốc gửi sắp tới. Mốc đã qua quá lần hỏi cuối thì bỏ; trùng thì gộp.
 */
export function toastRefreshDelays(runAts: readonly string[] | undefined, now = Date.now()): number[] {
  const delays = new Set<number>()
  for (const runAt of runAts ?? []) {
    const at = Date.parse(runAt)
    if (!Number.isFinite(at) || at - now > NOTIFICATION_TOAST_SCHEDULE_HORIZON_MS) continue
    for (const offset of NOTIFICATION_TOAST_SCHEDULE_DELAYS_MS) {
      const delay = at + offset - now
      if (delay > 0) delays.add(Math.round(delay / 1000) * 1000)
    }
  }
  return Array.from(delays).sort((a, b) => a - b)
}

/** id các chiến dịch vừa chuyển sang "hoàn thành" giữa hai lần đọc danh sách (chỉ chiến dịch có ở cả hai lần). */
export function newlyCompletedCampaignIds(previous: ReadonlyMap<number, string>, rows: ReadonlyArray<{ id: number; status: string }>): number[] {
  const ids: number[] = []
  for (const row of rows) {
    const before = previous.get(row.id)
    if (before !== undefined && before !== 'hoàn thành' && row.status === 'hoàn thành') ids.push(row.id)
  }
  return ids
}

const storageKey = (scope: string) => `aka.notificationToast.lastId:${scope}`

export function readLastShownToastId(scope: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(storageKey(scope)))
    return Number.isSafeInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function writeLastShownToastId(scope: string, id: number): void {
  try {
    window.localStorage.setItem(storageKey(scope), String(id))
  } catch {
    // Không lưu được: lần sau có thể hiện lại một lần, không sao.
  }
}
