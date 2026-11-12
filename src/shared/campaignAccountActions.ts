/**
 * Tab "Hành động" trong chi tiết chiến dịch Desktop (10/11/2026, port từ WebApp #179): các hành động
 * tài khoản mà chiến dịch đang chọn dùng (cùng danh sách menu "Hành động của tài khoản"), kèm trạng
 * thái khóa, giới hạn ngày/khung giờ hiệu lực theo đúng công thức bộ chạy (nhóm tài khoản → cài đặt
 * chiến dịch → mặc định, rồi trần gói), số đã chạy và giờ mở lại. Chỉ đọc: không tạo/reset trạng thái.
 *
 * 12/11/2026 (V502): thêm số liệu cho tab dạng thẻ và cột "Giới hạn lượt" của danh sách (giờ từng lượt trong
 * khung giờ, kết quả hôm nay, thông tin quản trị), cùng nghĩa với WebApp `packages/control-api/src/campaignAccountActions.ts`.
 * File này là bản Desktop (bộ chạy `chat`/`scheduler`, `groupApplied`), không chép nguyên văn.
 */
import type { CampaignLimitAction } from './campaignLimitProgress'

export const CAMPAIGN_ACCOUNT_ACTIONS_IPC = 'campaign:account-actions'
export const CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE = 'Chưa tải được hành động của chiến dịch. Vui lòng thử lại.'
/** Cột "Giới hạn lượt" của danh sách: một lượt đọc cho các chiến dịch đang hiện (<= CAMPAIGN_LIMIT_PROGRESS_MAX_IDS). */
export const CAMPAIGN_LIMIT_PROGRESS_IPC = 'campaign:limit-progress'

/** Nơi lấy giới hạn: nhóm tài khoản, cài đặt của chiến dịch hoặc mặc định hệ thống. */
export type CampaignActionLimitSource = 'group' | 'campaign' | 'default'

/** `chat`: Zalo Server do akaChat chạy; `scheduler`: bộ chạy akaAgent (Desktop, App Server, SMS/gọi qua app điện thoại). */
export type CampaignActionRuntime = 'chat' | 'scheduler'

export interface CampaignAccountActionRow {
  code: string
  name: string
  /** Bộ chạy kiểm tra giới hạn lượt ngày/khung giờ cho hành động này (gắn tag/đổi tên chạy kèm, không giới hạn lượt). */
  limited: boolean
  /** Đang bị khóa theo giờ DB lúc đọc; khóa đã tới giờ mở lại được coi là bình thường. */
  disabled: boolean
  /** Giờ mở lại đã lưu khi đang khóa; null khi không khóa hoặc khóa chưa có giờ mở lại. */
  enableAt: string | null
  /** Số phút còn lại tới giờ mở lại, tính theo giờ DB lúc đọc. */
  remainingMinutes: number | null
  /** Nguyên nhân khóa đã lưu (thiếu thông báo thì dùng mã lỗi). */
  disabledReason: string | null
  /** Số đã chạy hôm nay theo ngày Việt Nam; null khi bộ đếm ghi ngày sau hôm nay (không xác minh được). */
  dayUsed: number | null
  /** Giới hạn ngày hiệu lực; null khi hành động không bị kiểm tra giới hạn lượt. */
  dayLimit: number | null
  dayLimitSource: CampaignActionLimitSource | null
  /** Giới hạn ngày đã bị cắt về trần lượt/ngày của gói. */
  dayLimitCapped: boolean
  /** Trần lượt/ngày theo gói của hành động này; null khi gói không giới hạn hoặc không áp (Tìm SĐT). */
  packageDailyLimit: number | null
  /** Giới hạn ngày cài trong chiến dịch; null khi chiến dịch không cài (bộ chạy dùng mặc định). */
  campaignDayLimit: number | null
  /** Số lượt đã tính vào khung giờ hiện tại; null khi không kiểm tra giới hạn lượt. */
  windowUsed: number | null
  windowLimit: number | null
  windowMinutes: number | null
  windowLimitSource: CampaignActionLimitSource | null
  campaignWindowLimit: number | null
  campaignWindowMinutes: number | null
  /** (V502) Giờ chạy của các lượt cũ nhất còn trong khung giờ, tăng dần; vắng khi DB chưa có hàm đọc mới. */
  windowTimes?: string[]
  /** (V502) Khung vượt trần đọc: số thật có thể lớn hơn `windowUsed`. */
  windowAtLeast?: boolean
  /** (V502) Lúc hành động bị khóa. */
  lockedAt?: string | null
  /** (V502) Lượt gần nhất của hành động trên tài khoản (hôm nay hoặc trong khung giờ). */
  lastRunAt?: string | null
  /** (V502) Số chiến dịch khác của tài khoản chạy hôm nay có cùng hành động. */
  sharedCampaigns?: number
  /** (V502) Kết quả hôm nay của hành động trên tài khoản; null khi chưa có kết quả nào. */
  today?: CampaignAccountActionToday | null
}

/** Kết quả trong ngày (giờ Việt Nam) của một hành động trên tài khoản, gồm mọi chiến dịch dùng tài khoản đó. */
export interface CampaignAccountActionToday {
  /** Số lượt tính vào giới hạn theo đúng cách đếm của bộ chạy. */
  counted: number
  /** Số lượt không tính vào giới hạn (ví dụ lỗi chưa chạm tới nền tảng). */
  uncounted: number
  statuses: Array<{ status: string; counted: number; uncounted: number }>
  /** Chia lượt tính giới hạn theo chiến dịch; `name` null khi chiến dịch không thuộc nhân viên đang xem. */
  campaigns: Array<{ campaignId: number | null; name: string | null; current: boolean; counted: number }>
}

/** (V502) Thông tin quản trị của chiến dịch cho tab "Hành động". */
export interface CampaignActionManagement {
  status: string
  /** Lần chạy kế tiếp theo lịch đã lưu. */
  schedule: string | null
  scheduleType: string | null
  /** Giờ dừng gửi trong ngày (HH:mm:ss) nếu có. */
  dailyStopTime: string | null
  /** Nghỉ giữa 2 lần (giây). */
  sleepSeconds: number | null
  /** Giới hạn lượt có quyết định được lúc chiến dịch chạy lại không (Facebook: chưa đối chiếu). */
  resumeKnown: boolean
  /** Hành động được phép bỏ qua khi hết lượt, xem CampaignLimitProgressItem.skippableCodes. */
  skippableCodes: string[]
  /** Hành động mà bị khóa/hết lượt thì làm chiến dịch đứng (có giới hạn lượt hoặc bộ chạy thực hiện). */
  blockingCodes: string[]
}

export interface CampaignAccountActionsResult {
  campaignId: number
  accountId: number
  /** Giờ DB lúc đọc: trạng thái khóa, số phút còn lại và khung giờ đều tính theo mốc này. */
  checkedAt: string
  /** 00:00 ngày Việt Nam kế tiếp, lúc bộ đếm ngày bắt đầu lại. */
  nextDayStartsAt: string
  runtime: CampaignActionRuntime
  /**
   * Bộ chạy áp giới hạn của nhóm tài khoản (akaChat chỉ áp nhóm đang hoạt động cùng tổ chức). Tên nhóm lấy
   * từ danh sách tài khoản ở renderer để không đổi câu đọc tài khoản dùng chung với Chẩn đoán.
   */
  groupApplied: boolean
  /** Cài đặt chiến dịch: khi một hành động đạt giới hạn, chiến dịch tiếp tục với hành động còn lượt. */
  continueWhenActionLimitReached: boolean
  actions: CampaignAccountActionRow[]
  /** (V502) Tên nhóm tài khoản bộ chạy áp giới hạn; vắng khi đọc bằng bộ đọc cũ (renderer lấy từ danh sách tài khoản). */
  groupName?: string | null
  /** (V502) Thông tin quản trị; vắng khi DB chưa có hàm đọc mới (tab hiện như trước). */
  management?: CampaignActionManagement | null
}

/** Dòng của tab "Hành động" dưới dạng số liệu của cột "Giới hạn lượt", để dùng chung các hàm tính theo đồng hồ. */
export function campaignAccountActionLimit(row: CampaignAccountActionRow): CampaignLimitAction {
  return {
    code: row.code, name: row.name, limited: row.limited,
    dayUsed: row.dayUsed, dayLimit: row.limited ? row.dayLimit : null,
    windowLimit: row.limited ? row.windowLimit : null, windowMinutes: row.windowMinutes,
    windowUsed: row.windowUsed ?? 0, windowTimes: row.windowTimes ?? [], windowAtLeast: row.windowAtLeast === true,
    locked: row.disabled, lockedUntil: row.enableAt, lockReason: row.disabledReason,
    sharedCampaigns: row.sharedCampaigns ?? 0
  }
}

/** Đơn vị hiển thị theo mã hành động (giống form chiến dịch); mã khác dùng "lượt". */
export const CAMPAIGN_ACCOUNT_ACTION_UNITS: Readonly<Record<string, string>> = {
  fb_post_group: 'bài đăng',
  fb_post_my_profile: 'bài đăng',
  fb_post_page: 'bài đăng',
  fb_comment: 'comment',
  fb_message_stranger: 'tin nhắn',
  fb_message_friend: 'tin nhắn',
  fb_message_page_inbox_customer: 'tin nhắn',
  fb_add_friend: 'lời mời',
  fb_like_post: 'like',
  fb_join_group: 'group',
  fb_group_invite: 'lời mời',
  zalo_find_phone_user: 'SĐT',
  zalo_message_friend: 'tin nhắn',
  zalo_message_group: 'tin nhắn',
  zalo_message_stranger: 'tin nhắn',
  zalo_add_friend: 'lời mời',
  zalo_add_group_member: 'thành viên',
  zalo_join_group_link: 'group',
  zalo_cancel_sent_friend_request: 'lời mời',
  email_send: 'email',
  sms_send: 'tin nhắn',
  voice_call: 'cuộc gọi'
}

const SOURCE_LABELS: Record<CampaignActionLimitSource, string> = {
  group: 'Theo nhóm tài khoản',
  campaign: 'Theo chiến dịch',
  default: 'Mặc định hệ thống'
}

/** Dòng giải thích nguồn của một giới hạn, ví dụ "Theo nhóm Nhóm A · chiến dịch cài 50". */
export function describeCampaignActionLimitSource(
  source: CampaignActionLimitSource | null,
  options: { groupName?: string | null; campaignValue?: number | null; effectiveValue?: number | null; capped?: boolean; packageDailyLimit?: number | null } = {}
): string {
  if (!source) return ''
  const parts: string[] = []
  if (options.capped && options.packageDailyLimit) parts.push(`Theo gói (tối đa ${options.packageDailyLimit})`)
  else parts.push(source === 'group' && options.groupName ? `Theo nhóm ${options.groupName}` : SOURCE_LABELS[source])
  const { campaignValue, effectiveValue } = options
  if ((source === 'group' || options.capped) && campaignValue != null && campaignValue !== effectiveValue) {
    parts.push(`chiến dịch cài ${campaignValue}`)
  }
  return parts.join(' · ')
}
