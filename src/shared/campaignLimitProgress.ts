/**
 * Cột "Giới hạn lượt" của danh sách chiến dịch và phần số sống của tab "Hành động" (12/11/2026).
 *
 * API trả SỐ LIỆU tại một mốc giờ DB (`checkedAt`): bộ đếm ngày, giới hạn hiệu lực, trạng thái khóa và
 * giờ chạy của các lượt đang nằm trong khung giờ. Màn hình tự tính lại theo đồng hồ bằng các hàm thuần ở
 * đây, nên số "trong giờ" tự giảm đúng lúc từng lượt rời khung mà không cần gọi lại API.
 *
 * Khung giờ là khung TRƯỢT `windowMinutes` phút (mặc định 65): một lượt rời khung đúng `windowMinutes`
 * phút sau khi chạy. Không có thời điểm "reset về 0".
 */
export const CAMPAIGN_LIMIT_PROGRESS_UNAVAILABLE = 'Chưa tải được tiến độ giới hạn. Vui lòng thử lại.'
/** Số chiến dịch tối đa mỗi lượt đọc (một trang danh sách + chiến dịch đang mở chi tiết). */
export const CAMPAIGN_LIMIT_PROGRESS_MAX_IDS = 101
/** Số mốc giờ tối đa trả về cho một hành động: các lượt cũ nhất, tức các lượt rời khung sớm nhất. */
export const CAMPAIGN_LIMIT_WINDOW_TIMES_MAX = 60

export interface CampaignLimitAction {
  code: string
  name: string
  /** Bộ chạy kiểm tra giới hạn lượt ngày/khung giờ cho hành động này. false = chỉ có thể bị khóa. */
  limited: boolean
  /** Số đã chạy hôm nay theo ngày Việt Nam; null khi bộ đếm ghi ngày sau hôm nay (không xác minh được). */
  dayUsed: number | null
  /** Giới hạn ngày hiệu lực; null khi hành động không bị giới hạn lượt. */
  dayLimit: number | null
  windowLimit: number | null
  windowMinutes: number | null
  /** Số lượt nằm trong khung giờ tại `checkedAt`. */
  windowUsed: number
  /** Giờ chạy (ISO) của các lượt cũ nhất trong khung, tăng dần, tối đa CAMPAIGN_LIMIT_WINDOW_TIMES_MAX. */
  windowTimes: string[]
  /** Khung vượt trần đọc của DB: số thật có thể lớn hơn `windowUsed`. */
  windowAtLeast: boolean
  /** Đang bị khóa tại `checkedAt` (khóa đã tới giờ mở lại coi là bình thường). */
  locked: boolean
  /** Giờ mở khóa đã lưu; null khi không khóa hoặc khóa chưa có giờ mở lại. */
  lockedUntil: string | null
  lockReason: string | null
  /** Số chiến dịch khác của cùng tài khoản chạy hôm nay có cùng hành động (dùng chung bộ đếm). */
  sharedCampaigns: number
}

export interface CampaignLimitProgressItem {
  campaignId: number
  accountId: number
  /** false khi chưa đối chiếu được hành động nào làm chiến dịch đứng (Facebook): không báo giờ chạy lại của cả chiến dịch. */
  resumeKnown: boolean
  /**
   * Hành động được phép bỏ qua khi hết lượt (chiến dịch cài "tiếp tục hành động khác"): chiến dịch chỉ
   * đứng khi mọi hành động trong danh sách này đều bị chặn. Rỗng = hành động nào bị chặn cũng làm đứng.
   */
  skippableCodes: string[]
  actions: CampaignLimitAction[]
}

export interface CampaignLimitProgressResult {
  /** false khi DB chưa có hàm đọc (chưa apply migration): màn hình ẩn số, không coi là lỗi. */
  ready: boolean
  /** Giờ DB lúc đọc. */
  checkedAt: string
  /** 00:00 ngày Việt Nam kế tiếp, lúc bộ đếm ngày bắt đầu lại. */
  nextDayStartsAt: string
  items: CampaignLimitProgressItem[]
}

export type CampaignLimitState = 'ok' | 'window' | 'day' | 'locked'

export interface CampaignLimitActionView {
  state: CampaignLimitState
  /** Số lượt còn nằm trong khung giờ tại `nowMs`. */
  windowUsed: number
  dayFull: boolean
  windowFull: boolean
  /** Giới hạn giờ không thấp hơn giới hạn ngày: không cần hiện số trong giờ khi chưa đầy. */
  windowMoot: boolean
  /** Mốc (ms) sớm nhất hành động chạy lại; null khi đang chạy được hoặc chưa biết giờ (khóa không hẹn giờ). */
  resumeAt: number | null
  /** Giờ (ms) từng lượt còn trong khung sẽ rời khung, tăng dần (chỉ các lượt API đã trả). */
  slotTimes: number[]
}

const finite = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Trạng thái của một hành động tại `nowMs` (giờ máy chủ): khóa > đủ lượt ngày > đủ lượt giờ > bình thường.
 * `nextDayStartsAtMs` là lúc bộ đếm ngày về 0; qua mốc đó số ngày coi như 0 cho tới lượt đọc kế tiếp.
 */
export function campaignLimitActionView(action: CampaignLimitAction, nowMs: number, nextDayStartsAtMs: number | null): CampaignLimitActionView {
  const minutesMs = Math.max(0, Number(action.windowMinutes) || 0) * 60_000
  const slotTimes: number[] = []
  let expired = 0
  for (const value of action.windowTimes) {
    const at = finite(value)
    if (at === null) continue
    if (at + minutesMs <= nowMs) expired += 1
    else slotTimes.push(at + minutesMs)
  }
  slotTimes.sort((left, right) => left - right)
  const windowUsed = Math.max(0, action.windowUsed - expired)
  const newDay = nextDayStartsAtMs !== null && nowMs >= nextDayStartsAtMs
  const dayUsed = newDay ? 0 : action.dayUsed
  const dayFull = action.limited && action.dayLimit !== null && dayUsed !== null && dayUsed >= action.dayLimit
  const windowFull = action.limited && action.windowLimit !== null && windowUsed >= action.windowLimit
  const windowMoot = action.windowLimit !== null && action.dayLimit !== null && action.windowLimit >= action.dayLimit
  const lockedUntil = finite(action.lockedUntil)
  const locked = action.locked && (lockedUntil === null || lockedUntil > nowMs)
  if (locked) return { state: 'locked', windowUsed, dayFull, windowFull, windowMoot, resumeAt: lockedUntil, slotTimes }
  if (dayFull) return { state: 'day', windowUsed, dayFull, windowFull, windowMoot, resumeAt: newDay ? null : nextDayStartsAtMs, slotTimes }
  if (windowFull && action.windowLimit !== null) {
    // Chạy lại khi số trong khung xuống dưới giới hạn: lượt thứ (đang dùng − giới hạn + 1) rời khung.
    const index = windowUsed - action.windowLimit
    return { state: 'window', windowUsed, dayFull, windowFull, windowMoot, resumeAt: slotTimes[index] ?? null, slotTimes }
  }
  return { state: 'ok', windowUsed, dayFull, windowFull, windowMoot, resumeAt: null, slotTimes }
}

export interface CampaignLimitResume {
  /** Giới hạn lượt/khóa đang làm chiến dịch đứng. */
  blocked: boolean
  /** Hành động quyết định mốc chạy lại. */
  actionCode: string | null
  state: CampaignLimitState
  /** Mốc (ms) sớm nhất chiến dịch chạy lại theo giới hạn; null khi không bị chặn hoặc chưa biết giờ. */
  resumeAt: number | null
}

/**
 * Giới hạn lượt có đang làm chiến dịch đứng không và sớm nhất khi nào chạy lại. Hành động bắt buộc bị chặn
 * thì chờ mốc muộn nhất; chỉ còn các hành động được phép bỏ qua và tất cả đều bị chặn thì chờ mốc sớm nhất.
 * Chưa tính lịch gửi, tài khoản bận/chưa đăng nhập hay hết data.
 */
export function campaignLimitResume(item: CampaignLimitProgressItem, nowMs: number, nextDayStartsAtMs: number | null): CampaignLimitResume {
  if (!item.resumeKnown) return { blocked: false, actionCode: null, state: 'ok', resumeAt: null }
  const views = item.actions.map(action => ({ action, view: campaignLimitActionView(action, nowMs, nextDayStartsAtMs) }))
  const skippable = new Set(item.skippableCodes)
  const hard = views.filter(entry => entry.view.state !== 'ok' && !skippable.has(entry.action.code))
  if (hard.length) {
    const unknown = hard.find(entry => entry.view.resumeAt === null)
    const latest = unknown ?? hard.reduce((best, entry) => (entry.view.resumeAt as number) > (best.view.resumeAt as number) ? entry : best)
    return { blocked: true, actionCode: latest.action.code, state: latest.view.state, resumeAt: latest.view.resumeAt }
  }
  const optional = views.filter(entry => skippable.has(entry.action.code))
  if (optional.length && optional.every(entry => entry.view.state !== 'ok')) {
    const known = optional.filter(entry => entry.view.resumeAt !== null)
    const earliest = known.length
      ? known.reduce((best, entry) => (entry.view.resumeAt as number) < (best.view.resumeAt as number) ? entry : best)
      : optional[0]
    return { blocked: true, actionCode: earliest.action.code, state: earliest.view.state, resumeAt: earliest.view.resumeAt }
  }
  return { blocked: false, actionCode: null, state: 'ok', resumeAt: null }
}

const SHORT_NAMES: Readonly<Record<string, string>> = {
  zalo_find_phone_user: 'Tìm SĐT', zalo_message_friend: 'Nhắn tin', zalo_message_group: 'Nhắn nhóm',
  zalo_message_stranger: 'Nhắn tin', zalo_add_friend: 'Kết bạn', zalo_add_group_member: 'Thêm TV',
  zalo_join_group_link: 'Vào nhóm', zalo_cancel_sent_friend_request: 'Hủy lời mời',
  zalo_tag_contact: 'Gắn tag', zalo_change_alias: 'Đổi tên', sms_send: 'SMS', voice_call: 'Gọi điện',
  fb_post_group: 'Đăng nhóm', fb_post_my_profile: 'Đăng tường', fb_post_page: 'Đăng page', fb_comment: 'Comment',
  fb_message_stranger: 'Nhắn tin', fb_message_friend: 'Nhắn tin', fb_message_page_inbox_customer: 'Nhắn inbox',
  fb_add_friend: 'Kết bạn', fb_like_post: 'Like', fb_join_group: 'Vào nhóm', fb_group_invite: 'Mời nhóm'
}

/** Tên ngắn cho ô hẹp của danh sách; thiếu thì dùng tên đầy đủ. */
export const campaignLimitShortName = (action: Pick<CampaignLimitAction, 'code' | 'name'>): string =>
  SHORT_NAMES[action.code] || action.name

/** Giờ:phút theo giờ Việt Nam, kèm ngày khi khác ngày của `nowMs`. */
export function formatCampaignLimitTime(atMs: number, nowMs: number): string {
  const part = (ms: number) => {
    const date = new Date(ms + 7 * 3600_000)
    const pad = (value: number) => String(value).padStart(2, '0')
    return { day: `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`, time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` }
  }
  const at = part(atMs)
  return at.day === part(nowMs).day ? at.time : `${at.time} ${at.day}`
}
