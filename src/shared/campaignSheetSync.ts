/**
 * Đồng bộ định kỳ từ Google Sheet vào data của chiến dịch (V662, docs/CAMPAIGN_SHEET_SYNC_PLAN.md).
 * Hợp đồng dùng chung Desktop / API Web / Edge: kiểu dữ liệu, giới hạn, ngày dừng theo giờ Việt Nam, câu cho khách.
 * Không import module khác để chép nguyên văn được sang WebApp `packages/control-api/src/campaignSheetSync.ts`.
 */

export const CAMPAIGN_SHEET_SYNC_IPC = 'campaign-sheet-sync:call'
export const CAMPAIGN_SHEET_SYNC_DEFAULT_HOURS = 6
export const CAMPAIGN_SHEET_SYNC_HOUR_OPTIONS = [1, 3, 6, 12, 24] as const
export const CAMPAIGN_SHEET_SYNC_MAX_DAYS = 365
export const CAMPAIGN_SHEET_SYNC_DEFAULT_DAYS = 30
export const CAMPAIGN_SHEET_SYNC_MAX_VALUES = 20_000

/** Loại chiến dịch bật được đồng bộ (trùng `private.aka_agent_campaign_sheet_action_allowed` của V662). */
export const CAMPAIGN_SHEET_SYNC_ACTIONS: readonly string[] = [
  'zalo_message_phone', 'zalo_message_friend', 'zalo_message_group', 'zalo_message_group_member',
  'zalo_join_group_link', 'zalo_add_group_member',
  'facebook_group_post', 'facebook_join_group', 'facebook_message_uid', 'facebook_comment_seeding',
  'facebook_comment_seeding_post', 'facebook_find_data_group', 'facebook_find_data_search', 'facebook_group_invite',
  'email_send'
]

export type CampaignSheetSyncTargetField = 'phone' | 'uid' | 'email'
export type CampaignSheetSyncPlatform = 'zalo' | 'facebook' | 'email'
export type CampaignSheetSyncPhonePolicy = 'first' | 'discard' | 'all'
export type CampaignSheetSyncSplitMode = 'split' | 'all'
export type CampaignSheetSyncField = 'name' | 'uid' | 'phone' | 'email' | 'info1' | 'info2' | 'info3' | 'info4' | 'info5'
export type CampaignSheetSyncStatus = 'pending' | 'running' | 'success' | 'retry' | 'error' | 'expired' | 'paused'

export interface CampaignSheetSyncConfig {
  /** Link chuẩn `https://docs.google.com/spreadsheets/d/<id>/edit[#gid=<n>]`. */
  url: string
  hasHeader: boolean
  mapping: Partial<Record<CampaignSheetSyncField, number>>
  /** Tiêu đề cột lúc kết nối (khi có dòng tiêu đề): khác đi thì dừng đồng bộ, khách ghép cột lại. */
  expectedHeaders: string[]
  columnCount: number
  phonePolicy: CampaignSheetSyncPhonePolicy
  targetField: CampaignSheetSyncTargetField
  platform: CampaignSheetSyncPlatform
}

/** Lựa chọn khách chọn trong cửa sổ Upload, giữ trong nháp form tới lúc lưu chiến dịch. */
export interface CampaignSheetSyncDraft {
  enabled: true
  config: CampaignSheetSyncConfig
  everyHours: number
  endDate: string
  /** Giá trị đã chuẩn hoá của mọi dòng hợp lệ cửa sổ Upload đã đọc (mốc ban đầu). */
  sheetValues: string[]
  /** Mã yêu cầu tạo nguồn (gửi lại khi mạng lỗi không tạo nguồn thứ hai). */
  requestId: string
}

export interface CampaignSheetSyncCampaignEntry {
  campaignId: number
  position: number
  state: 'active' | 'left'
  leftReason?: string
  joinedAt?: string
  leftAt?: string
  added: number
}

export interface CampaignSheetSyncSource {
  id: number
  revision: number
  actionId: string
  config: Omit<CampaignSheetSyncConfig, 'expectedHeaders'>
  everyHours: number
  endDate: string
  splitMode: CampaignSheetSyncSplitMode
  campaignIds: number[]
  campaigns: CampaignSheetSyncCampaignEntry[]
  isEnabled: boolean
  status: CampaignSheetSyncStatus
  nextRunAt: string | null
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastAdded: number
  totalAdded: number
  retryCount: number
  lastErrorCode: string | null
  lastErrorMessage: string | null
  stoppedReason: string | null
  stoppedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CampaignSheetSyncRun {
  id: number
  kind: 'run' | 'enable' | 'edit' | 'disable' | 'resume' | 'stop' | 'campaign_left'
  actor: 'staff' | 'system'
  status: 'running' | 'success' | 'error' | 'interrupted' | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  rowsRead: number | null
  added: number | null
  duplicates: number | null
  invalid: number | null
  perCampaign: Array<{ campaignId: number; added: number; reopened: boolean }> | null
  errorCode: string | null
  errorMessage: string | null
  detail: Record<string, unknown> | null
}

export interface CampaignSheetSyncListItem {
  campaignId: number
  syncId: number
  status: CampaignSheetSyncStatus
  isEnabled: boolean
  everyHours: number
  endDate: string
  lastErrorCode: string | null
}

export type CampaignSheetSyncRequest =
  | { action: 'settings' }
  | { action: 'state'; campaignId: number }
  | { action: 'list'; campaignIds: number[] }
  | { action: 'runs'; syncId: number }
  | {
    action: 'save'; requestId?: string; syncId?: number; expectedRevision?: number; campaignIds?: number[]
    config?: CampaignSheetSyncConfig; everyHours: number; endDate: string; splitMode: CampaignSheetSyncSplitMode; sheetValues?: string[]
  }
  | { action: 'stop'; syncId: number; campaignId: number }
  | { action: 'resume'; syncId: number; campaignId: number; endDate?: string }

export interface CampaignSheetSyncSettings { available: boolean; maxSourcesPerStaff: number; minEveryHours: number }

export type CampaignSheetSyncResult<T = unknown> = { ok: true; data: T } | { ok: false; code: string; message: string }

export const supportsCampaignSheetSync = (actionId: string | null | undefined): boolean =>
  !!actionId && CAMPAIGN_SHEET_SYNC_ACTIONS.includes(actionId)

/** Link Google Sheet chuẩn (giữ `gid` như lúc đọc), `null` khi không phải link docs.google.com/spreadsheets. */
export function canonicalCampaignSheetUrl(raw: unknown): string | null {
  try {
    if (typeof raw !== 'string' || raw.length > 4096) return null
    const url = new URL(raw.trim())
    const id = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/)?.[1]
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password || !id) return null
    const gid = url.searchParams.get('gid') ?? new URLSearchParams(url.hash.slice(1)).get('gid') ?? ''
    if (gid && !/^\d{1,20}$/.test(gid)) return null
    return `https://docs.google.com/spreadsheets/d/${id}/edit${gid ? `#gid=${gid}` : ''}`
  } catch { return null }
}

function vietnamToday(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
  const values = new Map(parts.map(part => [part.type, Number(part.value)]))
  return Date.UTC(values.get('year')!, values.get('month')! - 1, values.get('day')!)
}
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Ngày dừng theo lịch Việt Nam: mặc định hôm nay + 30 ngày, nhưng không quá ngày kết thúc lịch của chiến dịch (nếu có);
 * tối đa hôm nay + 365 ngày.
 */
export function campaignSheetSyncEndDates(now = new Date(), campaignEndDate?: string | null): { minDate: string; defaultDate: string; maxDate: string } {
  const today = vietnamToday(now)
  const minDate = isoDay(today)
  const maxDate = isoDay(today + CAMPAIGN_SHEET_SYNC_MAX_DAYS * 86_400_000)
  let defaultDate = isoDay(today + CAMPAIGN_SHEET_SYNC_DEFAULT_DAYS * 86_400_000)
  const end = typeof campaignEndDate === 'string' ? campaignEndDate.slice(0, 10) : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(end) && end >= minDate && end < defaultDate) defaultDate = end
  return { minDate, defaultDate, maxDate }
}

/** Câu lỗi tiếng Việt, `null` khi hợp lệ. */
export function validateCampaignSheetSyncSchedule(everyHours: unknown, endDate: unknown, now = new Date(), minEveryHours = 1): string | null {
  if (!Number.isInteger(everyHours) || (everyHours as number) < minEveryHours || (everyHours as number) > 24) {
    return `Chu kỳ đồng bộ phải từ ${minEveryHours} đến 24 giờ.`
  }
  if (typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return 'Vui lòng chọn ngày dừng đồng bộ.'
  const parsed = new Date(`${endDate}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== endDate) return 'Ngày dừng đồng bộ không hợp lệ.'
  const { minDate, maxDate } = campaignSheetSyncEndDates(now)
  if (endDate < minDate) return 'Ngày dừng đồng bộ đã qua.'
  if (endDate > maxDate) return `Ngày dừng đồng bộ không được quá ${CAMPAIGN_SHEET_SYNC_MAX_DAYS} ngày kể từ hôm nay.`
  return null
}

export const formatCampaignSheetSyncDate = (value: string): string => {
  const [y, m, d] = value.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : value
}

/** Dòng tóm tắt trong form: "Đồng bộ Google Sheet · mỗi 6 giờ · đến 26/12/2026". */
export const campaignSheetSyncSummary = (everyHours: number, endDate: string): string =>
  `Đồng bộ Google Sheet · mỗi ${everyHours} giờ · đến ${formatCampaignSheetSyncDate(endDate)}`

/** Câu trạng thái cho thẻ trong chiến dịch. */
export function campaignSheetSyncStatusLabel(source: Pick<CampaignSheetSyncSource, 'status' | 'isEnabled'>, active = true): string {
  if (!active) return 'Đã tắt'
  switch (source.status) {
    case 'pending': return 'Đang chờ đồng bộ'
    case 'running': return 'Đang đồng bộ'
    case 'success': return 'Đang bật'
    case 'retry': return 'Đang thử lại'
    case 'error': return 'Đã dừng'
    case 'expired': return 'Đã hết hạn'
    case 'paused': return 'Đã tắt'
    default: return source.isEnabled ? 'Đang bật' : 'Đã tắt'
  }
}

/** Lý do chiến dịch rời nguồn / nguồn dừng (mục 4.2 của phương án). */
export function campaignSheetSyncReasonText(code: string | null | undefined): string {
  switch (code) {
    case 'expired': return 'Đã dừng đồng bộ vì hết thời hạn. Bấm Bật lại để chọn ngày mới.'
    case 'staff_off': return 'Đã tắt đồng bộ. Data đã thêm vẫn được giữ.'
    case 'sheet_columns_changed': return 'Cột của Sheet đã thay đổi. Bấm Sửa để kết nối và ghép cột lại.'
    case 'sheet_config': return 'Cấu hình ghép cột không còn hợp lệ. Bấm Sửa để kết nối và ghép cột lại.'
    case 'sheet_read_blocked': return 'Không đọc được Sheet. Kiểm tra quyền "Bất kỳ ai có đường liên kết" và tab của Sheet, rồi bấm Bật lại.'
    case 'sheet_too_large': return 'Sheet vượt giới hạn 10.000 dòng hoặc 10 MiB.'
    case 'campaign_schedule_ended': return 'Đã dừng đồng bộ vì chiến dịch hết thời gian chạy.'
    case 'campaign_deleted': return 'Chiến dịch đã bị xoá.'
    case 'campaign_data_group': return 'Chiến dịch đã chuyển sang chạy bằng Nhóm data.'
    case 'campaign_type_changed': return 'Loại chiến dịch đã thay đổi.'
    case 'campaign_moved': return 'Chiến dịch không còn thuộc tài khoản này.'
    case 'campaign_journey': return 'Chiến dịch thuộc Quy trình tự động, không đồng bộ được.'
    case 'no_campaign': return 'Không còn chiến dịch nhận data.'
    default: return ''
  }
}

/** Câu cho mã lỗi do RPC trả về. */
export function campaignSheetSyncErrorMessage(code: string, detail?: string | null): string {
  switch (code) {
    case 'sheet_sync_unavailable': return 'Tính năng đồng bộ Google Sheet chưa được mở cho tài khoản này.'
    case 'sheet_sync_not_ready': return 'Tính năng đồng bộ Google Sheet đang được cập nhật. Vui lòng thử lại sau.'
    case 'sheet_sync_campaign_invalid': return 'Chiến dịch này không bật được đồng bộ Google Sheet.'
    case 'sheet_sync_campaign_taken': return 'Chiến dịch đã có một nguồn đồng bộ Google Sheet khác.'
    case 'sheet_sync_limit': return `Mỗi tài khoản chỉ bật tối đa ${detail || 20} nguồn đồng bộ Google Sheet cùng lúc.`
    case 'sheet_sync_end_date': return `Ngày dừng đồng bộ phải từ hôm nay tới tối đa ${CAMPAIGN_SHEET_SYNC_MAX_DAYS} ngày.`
    case 'sheet_sync_every_hours': return 'Chu kỳ đồng bộ không hợp lệ.'
    case 'sheet_sync_config': return 'Cấu hình link hoặc ghép cột của Sheet không hợp lệ.'
    case 'sheet_sync_conflict': return 'Nguồn đồng bộ vừa được thay đổi ở nơi khác. Vui lòng tải lại rồi thử lại.'
    case 'sheet_sync_not_found': return 'Không tìm thấy nguồn đồng bộ Google Sheet.'
    case 'sheet_sync_requires_save': return 'Cột của Sheet đã thay đổi. Bấm Sửa để kết nối và ghép cột lại.'
    case 'sheet_sync_no_campaign': return 'Nguồn không còn chiến dịch nào nhận data.'
    case 'sheet_sync_unauthorized': return 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.'
    default: return 'Không thể xử lý đồng bộ Google Sheet. Vui lòng thử lại.'
  }
}

/** Mã lỗi `sheet_sync_*` trong câu lỗi của Postgres / PostgREST. */
export function campaignSheetSyncErrorCode(message: string | null | undefined): string | null {
  const match = String(message || '').match(/\bsheet_sync_[a-z_]+\b/)
  return match ? match[0] : null
}
