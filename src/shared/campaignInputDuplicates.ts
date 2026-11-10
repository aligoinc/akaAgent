/**
 * "Lọc trùng dữ liệu" của cửa sổ Upload dữ liệu: đối chiếu SĐT đang tải lên với dữ liệu đã tải vào chiến dịch
 * khác trong N ngày (akaAgent V491, RPC `aka_agent_read_campaign_input_duplicates`, chỉ đọc).
 *
 * Hợp đồng dùng chung Web/API. Desktop làm sau: chép nguyên văn sang `src/shared/campaignInputDuplicates.ts`
 * (sửa ở đây trước rồi chép lại). Quy tắc đối chiếu nằm trong RPC; tệp này chỉ giữ giới hạn, kiểu dữ liệu,
 * kiểm tra đầu vào/kết quả và nhãn tiếng Việt.
 */

export const INPUT_DUPLICATES_SETTING_KEY = 'web.campaign_input_duplicates'
export const INPUT_DUPLICATES_RPC = 'aka_agent_read_campaign_input_duplicates'
/** Loại chiến dịch có lựa chọn đối chiếu (đợt 1: Zalo nhắn tin, kết bạn đến SĐT). Khớp `v_supported` của V491. */
export const INPUT_DUPLICATES_ACTIONS: readonly string[] = ['zalo_message_phone']
/** Mỗi lượt gọi máy chủ tối đa 2.000 số (V491 từ chối nhiều hơn); 10.000 số = 5 lượt tuần tự. */
export const INPUT_DUPLICATES_MAX_PHONES_PER_CALL = 2000
export const INPUT_DUPLICATES_MAX_ACCOUNTS = 500
export const INPUT_DUPLICATES_DEFAULT_DAYS = 30
export const INPUT_DUPLICATES_MAX_DAYS = 365
export const INPUT_DUPLICATES_DAY_PRESETS: readonly number[] = [7, 14, 30, 90]

/** file = chỉ trong file này (mặc định); current = tài khoản đang chọn; picked = các tài khoản Zalo khách chọn. */
export type InputDuplicateScope = 'file' | 'current' | 'picked'
export type InputDuplicatesAudience = 'admin_akabiz' | 'all' | 'off'

export interface InputDuplicatesSetting {
  audience: InputDuplicatesAudience
  defaultDays: number
  maxDays: number
}

/** Thiếu dòng công tắc (DB chưa có V491), sai định dạng hoặc lỗi đọc: tắt, chỉ còn "Chỉ trong file này". */
export const INPUT_DUPLICATES_SETTING_OFF: InputDuplicatesSetting = {
  audience: 'off', defaultDays: INPUT_DUPLICATES_DEFAULT_DAYS, maxDays: INPUT_DUPLICATES_MAX_DAYS
}

const dayValue = (value: unknown, fallback: number, max: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback

/** `auto_system_settings` `web.campaign_input_duplicates` = `{"audience":"admin_akabiz"|"all"|"off","defaultDays":30,"maxDays":365}`. */
export function parseInputDuplicatesSetting(value: unknown): InputDuplicatesSetting {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return INPUT_DUPLICATES_SETTING_OFF
    const record = parsed as Record<string, unknown>
    const audience = record.audience === 'all' || record.audience === 'admin_akabiz' || record.audience === 'off'
      ? record.audience : 'off'
    const maxDays = dayValue(record.maxDays, INPUT_DUPLICATES_MAX_DAYS, INPUT_DUPLICATES_MAX_DAYS)
    const defaultDays = dayValue(record.defaultDays, Math.min(INPUT_DUPLICATES_DEFAULT_DAYS, maxDays), maxDays)
    return { audience, defaultDays, maxDays }
  } catch { return INPUT_DUPLICATES_SETTING_OFF }
}

export function inputDuplicatesVisible(setting: InputDuplicatesSetting | undefined, isAdminAkabiz: boolean | undefined): boolean {
  return setting?.audience === 'all' || (setting?.audience === 'admin_akabiz' && isAdminAkabiz === true)
}

export const supportsInputDuplicateCheck = (actionId: string | null | undefined): boolean =>
  Boolean(actionId) && INPUT_DUPLICATES_ACTIONS.includes(String(actionId))

export interface InputDuplicatesCheckRequest {
  actionId: string
  accountIds: number[]
  days: number
  phones: string[]
  /** Chiến dịch đang nhận "Thêm data": không so với chính nó (ô "Bỏ qua data đã có trong chiến dịch" lo phần đó). */
  excludeCampaignId?: number | null
}

export interface InputDuplicateMatch {
  campaignId: number
  campaignName: string
  campaignDeleted: boolean
  accountId: number
  accountName: string
  uploadedAt: string
  status: string
  processed: boolean
}

export interface InputDuplicateItem {
  phone: string
  matchCount: number
  campaignCount: number
  latest: InputDuplicateMatch
}

export interface InputDuplicatesCheckResult {
  checkedAt: string
  since: string
  days: number
  accountCount: number
  phoneCount: number
  items: InputDuplicateItem[]
}

const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Kiểm tra thân yêu cầu (API dùng trước khi gọi DB; Web dùng để không gửi yêu cầu sai). Ném Error tiếng Việt. */
export function validateInputDuplicatesRequest(value: unknown, maxDays = INPUT_DUPLICATES_MAX_DAYS): InputDuplicatesCheckRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Yêu cầu lọc trùng không hợp lệ.')
  const body = value as Record<string, unknown>
  if (typeof body.actionId !== 'string' || !supportsInputDuplicateCheck(body.actionId)) {
    throw new Error('Loại chiến dịch này chưa hỗ trợ lọc trùng với chiến dịch khác.')
  }
  const limit = Math.min(INPUT_DUPLICATES_MAX_DAYS, Math.max(1, Math.floor(maxDays)))
  if (typeof body.days !== 'number' || !Number.isInteger(body.days) || body.days < 1 || body.days > limit) {
    throw new Error(`Số ngày kiểm tra phải từ 1 đến ${limit}.`)
  }
  if (!Array.isArray(body.accountIds) || body.accountIds.length === 0 || body.accountIds.length > INPUT_DUPLICATES_MAX_ACCOUNTS
    || !body.accountIds.every(positiveId)) {
    throw new Error('Vui lòng chọn ít nhất 1 tài khoản Zalo để đối chiếu.')
  }
  if (!Array.isArray(body.phones) || body.phones.length > INPUT_DUPLICATES_MAX_PHONES_PER_CALL
    || !body.phones.every(phone => typeof phone === 'string' && phone.length <= 64)) {
    throw new Error(`Mỗi lượt đối chiếu tối đa ${INPUT_DUPLICATES_MAX_PHONES_PER_CALL.toLocaleString('vi-VN')} số điện thoại.`)
  }
  if (body.excludeCampaignId !== undefined && body.excludeCampaignId !== null && !positiveId(body.excludeCampaignId)) {
    throw new Error('Chiến dịch không hợp lệ.')
  }
  return {
    actionId: body.actionId,
    accountIds: Array.from(new Set(body.accountIds as number[])),
    days: body.days,
    phones: body.phones as string[],
    ...(positiveId(body.excludeCampaignId) ? { excludeCampaignId: body.excludeCampaignId } : {})
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : String(value)
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0

/** Kết quả RPC → kiểu dùng chung. Ném Error khi thiếu trường bắt buộc (API báo "chưa đối chiếu được"). */
export function parseInputDuplicatesResult(value: unknown): InputDuplicatesCheckResult {
  const data = record(value)
  if (!Array.isArray(data.items) || typeof data.checkedAt !== 'string' || typeof data.since !== 'string') {
    throw new Error('Kết quả lọc trùng không hợp lệ.')
  }
  return {
    checkedAt: data.checkedAt,
    since: data.since,
    days: count(data.days),
    accountCount: count(data.accountCount),
    phoneCount: count(data.phoneCount),
    items: data.items.map(raw => {
      const item = record(raw)
      const latest = record(item.latest)
      const phone = text(item.phone)
      if (!phone) throw new Error('Kết quả lọc trùng không hợp lệ.')
      return {
        phone,
        matchCount: count(item.matchCount),
        campaignCount: count(item.campaignCount),
        latest: {
          campaignId: count(latest.campaignId),
          campaignName: text(latest.campaignName),
          campaignDeleted: latest.campaignDeleted === true,
          accountId: count(latest.accountId),
          accountName: text(latest.accountName),
          uploadedAt: text(latest.uploadedAt),
          status: text(latest.status),
          processed: latest.processed === true
        }
      }
    })
  }
}

/** Danh sách số (đã chuẩn hóa, không trùng) → các lượt tối đa 2.000 số, giữ thứ tự. */
export function chunkInputDuplicatePhones(phones: readonly string[], size = INPUT_DUPLICATES_MAX_PHONES_PER_CALL): string[][] {
  const unique = Array.from(new Set(phones.filter(Boolean)))
  const chunks: string[][] = []
  for (let index = 0; index < unique.length; index += size) chunks.push(unique.slice(index, index + size))
  return chunks
}

/** Gộp kết quả các lượt (mỗi lượt một phần danh sách số, không giao nhau). */
export function mergeInputDuplicateResults(results: readonly InputDuplicatesCheckResult[]): InputDuplicatesCheckResult | null {
  if (!results.length) return null
  const first = results[0]
  return {
    checkedAt: first.checkedAt,
    since: first.since,
    days: first.days,
    accountCount: first.accountCount,
    phoneCount: results.reduce((total, result) => total + result.phoneCount, 0),
    items: results.flatMap(result => result.items)
  }
}

const VIETNAM_DATE = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })
const VIETNAM_TIME = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })

export const formatVietnamDate = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : VIETNAM_DATE.format(date)
}
export const formatVietnamTime = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : VIETNAM_TIME.format(date)
}

/** Ngày bắt đầu (dd/mm/yyyy) của N ngày lịch Việt Nam tính cả hôm nay — cùng cách tính với V491. */
export function inputDuplicateWindowStart(days: number, now: Date = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(part => [part.type, part.value]))
  const start = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - (Math.max(1, Math.floor(days)) - 1)))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(start.getUTCDate())}/${pad(start.getUTCMonth() + 1)}/${start.getUTCFullYear()}`
}

/** Nhãn trạng thái của dòng đã có (cột "Trạng thái" và file Excel). */
export function inputDuplicateStatusLabel(match: Pick<InputDuplicateMatch, 'status' | 'processed' | 'campaignDeleted'>): string {
  if (match.campaignDeleted) return 'Đã chạy · chiến dịch đã xóa'
  if (match.status === 'đang chạy') return 'Đang chạy'
  if (match.processed) return 'Đã chạy'
  if (match.status === 'tạm dừng') return 'Tạm dừng · chưa chạy'
  return 'Chưa chạy'
}

/** "12 tài khoản Zalo" / "2 tài khoản đang chọn" — dùng trong tóm tắt, hộp xác nhận và ghi chú của form. */
export function inputDuplicateScopeLabel(scope: Exclude<InputDuplicateScope, 'file'>, accountCount: number): string {
  return scope === 'current'
    ? `${accountCount.toLocaleString('vi-VN')} tài khoản đang chọn`
    : `${accountCount.toLocaleString('vi-VN')} tài khoản Zalo`
}
