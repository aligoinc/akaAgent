// Đồng bộ akaBiz Auto (akaBiz Desktop cũ, chiến dịch trong SQLite trên máy) sang akaAgent — phương án 2:
// app Desktop đọc file SQLite đã liên kết ở thẻ "akaBiz Desktop" rồi gọi API Web. Hợp đồng API ở akaAgentWebApp
// docs/AKABIZ_AUTO_SYNC.md; phần riêng Desktop ở docs/AKABIZ_AUTO_SYNC_DESKTOP.md.

export type AkaBizAutoPlatform = 'zalo' | 'facebook'
export type AkaBizAutoZaloAccountType = 'zalo_server' | 'zalo_web' | 'zalo_qr'
export type AkaBizAutoTargetAccountType = AkaBizAutoZaloAccountType | 'facebook'
export type AkaBizAutoCampaignScope = 'paused_pending' | 'all'

export const AKABIZ_AUTO_SYNC_IPC = {
  connect: 'akabiz:auto-sync:connect',
  run: 'akabiz:auto-sync:run',
  cancel: 'akabiz:auto-sync:cancel',
  close: 'akabiz:auto-sync:close',
  progress: 'akabiz:auto-sync:progress'
} as const

export const AKABIZ_AUTO_SYNC_MAX_DAYS = 365
export const AKABIZ_AUTO_SYNC_DEFAULT_DAYS = 90
export const AKABIZ_AUTO_SYNC_DAY_PRESETS = [7, 30, 90, 180, 365] as const
export const AKABIZ_AUTO_ZALO_ACCOUNT_TYPES: AkaBizAutoZaloAccountType[] = ['zalo_server', 'zalo_web', 'zalo_qr']

export const AKABIZ_AUTO_ZALO_TYPE_LABELS: Record<AkaBizAutoZaloAccountType, { title: string; description: string }> = {
  zalo_server: { title: 'Zalo Server', description: 'Chạy trên máy chủ, không cần mở máy tính' },
  zalo_web: { title: 'Zalo Browser', description: 'Chạy trong app akaAgent Desktop, đăng nhập bằng trình duyệt' },
  zalo_qr: { title: 'Zalo QR', description: 'Chạy trong app akaAgent Desktop, quét mã QR' }
}

export const AKABIZ_AUTO_ACCOUNT_TYPE_LABELS: Record<AkaBizAutoTargetAccountType, string> = {
  zalo_server: 'Zalo Server', zalo_web: 'Zalo Browser', zalo_qr: 'Zalo QR', facebook: 'Facebook'
}

/** Tên loại chiến dịch akaAgent (bảng `auto_campaign_actions`) cho màn Xem trước. */
export const AKABIZ_AUTO_TARGET_ACTION_NAMES: Record<string, string> = {
  zalo_message_phone: 'Zalo - Nhắn tin, kết bạn đến SĐT',
  zalo_message_friend: 'Zalo - Gửi tin nhắn đến bạn bè',
  zalo_message_group: 'Zalo - Gửi tin nhắn đến group',
  zalo_message_birthday: 'Zalo - Gửi tin nhắn chúc mừng sinh nhật',
  zalo_message_group_member: 'Zalo - Nhắn tin, kết bạn đến thành viên group/người lạ',
  zalo_message_group_realtime: 'Zalo - Nhắn tin, kết bạn theo group thời gian thực',
  zalo_message_friend_recommendation: 'Zalo - Nhắn tin, kết bạn theo đề xuất Zalo',
  zalo_message_remarketing_customer: 'Zalo - Nhắn tin, kết bạn đến khách hàng cũ',
  zalo_add_group_member: 'Zalo - Thêm thành viên vào group',
  zalo_join_group_link: 'Zalo - Tham gia vào group bằng link',
  zalo_cancel_sent_friend_request: 'Zalo - Huỷ lời mời kết bạn đã gửi',
  facebook_group_post: 'Facebook - Đăng bài vào group',
  facebook_timeline_post: 'Facebook - Đăng bài lên trang cá nhân',
  facebook_page_post: 'Facebook - Đăng bài lên fanpage',
  facebook_comment_seeding: 'Facebook - Comment seeding vào danh sách group/page/profile',
  facebook_comment_seeding_post: 'Facebook - Comment seeding vào danh sách bài post',
  facebook_newsfeed_interaction: 'Facebook - Lướt newsfeed và tương tác',
  facebook_message_uid: 'Facebook - Nhắn tin & Kết bạn đến UID',
  facebook_message_friend: 'Facebook - Nhắn tin đến bạn bè',
  facebook_page_to_message: 'Facebook - Gửi tin nhắn đến khách hàng từng inbox với page',
  facebook_join_group: 'Facebook - Tham gia vào group',
  facebook_group_invite: 'Facebook - Mời vào group',
  facebook_find_data_group: 'Facebook - Tìm kiếm data trong group',
  facebook_find_data_search: 'Facebook - Tìm kiếm data bằng search'
}

export interface AkaBizAutoSyncSettings {
  platforms: AkaBizAutoPlatform[]
  zaloAccountType: AkaBizAutoZaloAccountType | null
  shopIds: number[]
  campaignScope: AkaBizAutoCampaignScope
  /** null = không giới hạn theo ngày cập nhật; 1..365. */
  updatedWithinDays: number | null
}

export interface AkaBizAutoSyncQuota { allowed: boolean; used: number; max: number | null }

export interface AkaBizAutoSyncAccount {
  shopId: number
  name: string
  platform: AkaBizAutoPlatform
  isActive: boolean
  phone: string | null
  mapped: { accountId: string; type: AkaBizAutoTargetAccountType; name: string | null } | null
}

/** Một chiến dịch trong SQLite, đủ để form đếm theo lựa chọn (không có nội dung). */
export interface AkaBizAutoCampaignSummary {
  id: number
  name: string
  shopId: number
  platform: AkaBizAutoPlatform | null
  actionId: string
  status: string
  /** max(DateCreate, DateEdit, DateUpdateCampaignDetail) theo giờ máy, dạng `yyyy-MM-ddTHH:mm:ss`; null khi cả ba trống. */
  lastUpdatedAt: string | null
}

export interface AkaBizAutoSyncConnectResult {
  target: { staffId: number; username: string; name: string | null; organizationName: string | null }
  source: { staffId: number; accountId: number; username: string; name: string | null }
  options: {
    zalo: Record<AkaBizAutoZaloAccountType, AkaBizAutoSyncQuota>
    facebook: AkaBizAutoSyncQuota
    defaultZaloAccountType: AkaBizAutoZaloAccountType | null
  }
  accounts: AkaBizAutoSyncAccount[]
  inProgress: { runId: string; settings: AkaBizAutoSyncSettings; startedAt: string | null } | null
  dbPath: string
  installId: string
  campaigns: AkaBizAutoCampaignSummary[]
}

export interface AkaBizAutoBeginAccount {
  shopId: number
  result: 'created' | 'reused' | 'would_create' | 'would_reuse' | 'issue'
  accountId?: string | null
  type?: AkaBizAutoTargetAccountType | null
  code?: string
  message?: string
}

export interface AkaBizAutoSyncItem {
  sourceId: string
  campaignId: number
  name: string
  code: string
  message: string
}

export interface AkaBizAutoSyncReport {
  dryRun: boolean
  asOf: string | null
  settings: AkaBizAutoSyncSettings
  accounts: AkaBizAutoBeginAccount[]
  campaigns: {
    total: number
    copied: number
    alreadyCopied: number
    outOfScope: number
    byAction: { actionId: string; count: number }[]
    skipped: AkaBizAutoSyncItem[]
    issues: AkaBizAutoSyncItem[]
  }
  rows: { read: number; imported: number; dropped: number }
  adjustments: { code: string; message: string; count: number }[]
  /** Chiến dịch được chép không kèm media (điều chỉnh MEDIA_NOT_COPIED). */
  mediaNotCopied: number
}

export interface AkaBizAutoSyncProgress {
  dryRun: boolean
  stage: 'accounts' | 'campaigns' | 'finishing' | 'waiting'
  campaignsDone: number
  campaignsTotal: number
  rowsDone: number
  rowsTotal: number
  current: { name: string; rowsDone: number; rowsTotal: number } | null
  /** Câu ngắn cho dòng trạng thái (đang chờ máy chủ, đang thử lại…). */
  note: string | null
  recent: { at: string; text: string; tone: 'ok' | 'warn' | 'info' }[]
}

export type AkaBizAutoSyncResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

const SCOPE_STATUSES = ['Dừng', 'Chờ xử lý']

export function campaignPlatform(actionId: string | null | undefined): AkaBizAutoPlatform | null {
  const id = String(actionId || '')
  if (id.startsWith('zalo_')) return 'zalo'
  if (id.startsWith('facebook_') || id.startsWith('group_')) return 'facebook'
  return null
}

/** Giờ máy `yyyy-MM-ddTHH:mm:ss` → mốc ms, coi như giờ Việt Nam (+07:00). */
export function localDateMs(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(value)
  if (!match) return null
  const ms = Date.parse(`${match[1]}T${match[2]}+07:00`)
  return Number.isFinite(ms) ? ms : null
}

export function normalizeUpdatedWithinDays(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(n) && n >= 1 && n <= AKABIZ_AUTO_SYNC_MAX_DAYS ? n : null
}

/** Lọc chiến dịch theo lựa chọn, giống máy chủ (máy chủ vẫn kiểm lại). `asOfMs` = mốc bắt đầu lượt. */
export function campaignInSelection(campaign: AkaBizAutoCampaignSummary, settings: AkaBizAutoSyncSettings, asOfMs: number): boolean {
  if (!campaign.platform || !settings.platforms.includes(campaign.platform)) return false
  if (!settings.shopIds.includes(campaign.shopId)) return false
  if (settings.campaignScope === 'paused_pending' && !SCOPE_STATUSES.includes(campaign.status)) return false
  if (settings.updatedWithinDays !== null) {
    const last = localDateMs(campaign.lastUpdatedAt)
    if (last === null || last < asOfMs - settings.updatedWithinDays * 86_400_000) return false
  }
  return true
}

export function inStatusScope(campaign: AkaBizAutoCampaignSummary, scope: AkaBizAutoCampaignScope): boolean {
  return scope === 'all' || SCOPE_STATUSES.includes(campaign.status)
}

export function remainingQuota(quota: AkaBizAutoSyncQuota): number | null {
  return quota.max === null ? null : Math.max(0, quota.max - quota.used)
}

export function settingsStorageKey(organizationId: number, staffId: number): string {
  return `aka.akabizAutoSync.settings.v1:${organizationId}:${staffId}`
}
