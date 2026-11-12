import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'

/**
 * Số liệu thô cho cột "Giới hạn lượt" của danh sách chiến dịch và tab "Hành động" (12/11/2026).
 *
 * Một lượt gọi RPC chỉ đọc `aka_agent_read_campaign_limit_progress` (akaAgent V502, bản Desktop của hàm WebApp
 * dùng): token Desktop gắn với nhân viên + tài khoản/mật khẩu tự động hóa, rồi trả cài đặt giới hạn, nhóm tài
 * khoản, bộ đếm ngày, khóa, giờ các lượt trong khung giờ, chiến dịch cùng tài khoản chạy hôm nay và (chi tiết)
 * kết quả hôm nay. Giới hạn hiệu lực và cách đếm theo bộ chạy tính ở `campaignLimitProgressService`.
 * Không ghi DB, không cache, không tự thử lại. DB chưa có hàm (PGRST202/42883) thì trả null.
 */
export const LIMIT_PROGRESS_DESKTOP_RPC = 'aka_agent_read_campaign_limit_progress'
/** Cờ trong extra_settings quyết định chiến dịch chạy những hành động nào (campaignActionDescriptors). */
export const LIMIT_PROGRESS_EXTRA_KEYS = [
  'enableMessage', 'enableAddFriend', 'enableZaloTag', 'enableZaloAlias', 'zaloMessageSendMode',
  'enableComment', 'enablePostLike', 'newsfeedLikeKind', 'newsfeedLikeLimit', 'newsfeedCommentKind',
  'newsfeedCommentLimit', 'groupPostShareFromPost'
] as const

export type LimitRow = Record<string, unknown>
const object = (value: unknown): LimitRow => value && typeof value === 'object' && !Array.isArray(value) ? value as LimitRow : {}
const rows = (value: unknown): LimitRow[] => Array.isArray(value) ? value.map(object) : []
const text = (value: unknown) => String(value ?? '')
const times = (value: unknown): number[] => Array.isArray(value)
  ? value.map(item => Date.parse(text(item))).filter(Number.isFinite) : []
const iso = (value: unknown): string | null => {
  const raw = text(value)
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString() : null
}
const positive = (value: unknown): number | undefined => {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export interface LimitWindowFact { lookbackMinutes: number; explicit: number[]; legacy: number[]; other: number[]; truncated: boolean }
export interface LimitFacts {
  nowMs: number
  checkedAt: string
  /** Ngày Việt Nam (YYYY-MM-DD) theo giờ DB. */
  today: string
  nextDayStartsAt: string
  campaigns: LimitRow[]
  statuses: Map<string, LimitRow>
  windows: Map<string, LimitWindowFact>
  siblings: LimitRow[]
  todayRows: LimitRow[] | null
}
export const limitPairKey = (accountId: unknown, code: unknown) => `${Number(accountId)}:${text(code)}`

/** Hàm chưa có trong DB (chưa apply V502 hoặc PostgREST chưa nạp lại schema). */
const functionMissing = (error: unknown) => {
  const code = text(object(error).code)
  return code === 'PGRST202' || code === '42883'
}

/** Phản hồi sai dạng: báo lỗi chung, không coi là "chưa sẵn sàng". */
export class CampaignLimitFactsInvalid extends Error {}

export async function readCampaignLimitFacts(ids: readonly number[], detail: boolean, signal: AbortSignal): Promise<LimitFacts | null> {
  signal.throwIfAborted()
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const { data, error } = await getSupabaseClient().rpc(LIMIT_PROGRESS_DESKTOP_RPC, {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password,
    p_campaign_ids: [...ids], p_extra_keys: [...LIMIT_PROGRESS_EXTRA_KEYS], p_detail: detail
  }).abortSignal(signal)
  signal.throwIfAborted()
  if (error) {
    if (functionMissing(error)) return null
    throw error
  }
  const result = object(data)
  const checkedAt = iso(result.now), nextDayStartsAt = iso(result.nextDayStartsAt), today = text(result.vietnamDate)
  if (!checkedAt || !nextDayStartsAt || !/^\d{4}-\d{2}-\d{2}$/.test(today) || !Array.isArray(result.campaigns)) {
    throw new CampaignLimitFactsInvalid('Invalid limit progress facts')
  }
  return {
    nowMs: Date.parse(checkedAt), checkedAt, today, nextDayStartsAt,
    campaigns: rows(result.campaigns),
    statuses: new Map(rows(result.statuses).map(item => [limitPairKey(item.accountId, item.actionCode), item])),
    windows: new Map(rows(result.windows).map(item => [limitPairKey(item.accountId, item.actionCode), {
      lookbackMinutes: positive(item.lookbackMinutes) ?? 65, explicit: times(item.e), legacy: times(item.l), other: times(item.o),
      truncated: item.truncated === true
    }])),
    siblings: rows(result.siblings),
    todayRows: Array.isArray(result.today) ? rows(result.today) : null
  }
}
