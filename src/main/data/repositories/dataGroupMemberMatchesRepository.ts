import {
  DATA_GROUP_MATCHES_SETTING_KEY, DATA_GROUP_MEMBER_MATCHES_RPC, parseDataGroupMemberMatchesEnabled,
  parseDataGroupMemberMatchesResult, type DataGroupMemberMatchesRequest, type DataGroupMemberMatchesResult
} from '../../../shared/dataGroupMemberMatches'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

export const DATA_GROUP_MATCHES_DISABLED = 'Đối chiếu với data đã có trong nhóm đang tắt.'
export const DATA_GROUP_MATCHES_NOT_READY = 'Đối chiếu với data đã có trong nhóm đang được cập nhật.'
export const DATA_GROUP_MATCHES_TIMEOUT = 'Đối chiếu với data đã có trong nhóm quá thời gian. Chưa có data nào được thêm, vui lòng thử lại.'
export const DATA_GROUP_MATCHES_UNAVAILABLE = 'Chưa đối chiếu được với data đã có trong nhóm. Vui lòng thử lại.'
export const DATA_GROUP_MATCHES_GROUP_DENIED = 'Nhóm data không còn hoặc không thuộc quyền của bạn. Vui lòng tải lại danh sách nhóm.'
export const DATA_GROUP_MATCHES_INVALID = 'Yêu cầu đối chiếu nhóm data không hợp lệ. Vui lòng mở lại cửa sổ thêm data rồi thử lại.'
export const SESSION_INVALID = 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.'

/** Lỗi đối chiếu có mã ổn định để renderer hiện câu tiếng Việt, không lộ SQL. */
export class DataGroupMatchesReadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'DataGroupMatchesReadError'
  }
}

export const dataGroupMatchesTimeout = () => new DataGroupMatchesReadError('data_group_matches_timeout', DATA_GROUP_MATCHES_TIMEOUT)
export const dataGroupMatchesUnavailable = () => new DataGroupMatchesReadError('data_group_matches_unavailable', DATA_GROUP_MATCHES_UNAVAILABLE)

/**
 * V519 trả lỗi bằng mã Postgres. DB chưa có hàm (PGRST202/42883) hoặc token Desktop chưa được cấp quyền (V522 chưa
 * apply/đã rollback: "permission denied for function") thì báo "đang được cập nhật": cửa sổ nhập thêm như trước V522.
 */
export function dataGroupMatchesError(error: { code?: string; message?: string }): DataGroupMatchesReadError {
  const code = String(error.code || '')
  const message = String(error.message || '')
  if (code === 'PGRST202' || code === '42883' || (code === '42501' && /permission denied for function/i.test(message))) {
    return new DataGroupMatchesReadError('data_group_matches_not_ready', DATA_GROUP_MATCHES_NOT_READY)
  }
  if (message.includes('data_group_matches_group_denied')) {
    return new DataGroupMatchesReadError('data_group_matches_group_denied', DATA_GROUP_MATCHES_GROUP_DENIED)
  }
  if (/automation_auth|desktop_staff_scope_denied/.test(message)) return new DataGroupMatchesReadError('session_invalid', SESSION_INVALID)
  if (code === '42501') return new DataGroupMatchesReadError('data_group_matches_access_denied', 'Không có quyền đối chiếu nhóm data này.')
  if (code === '57014') return dataGroupMatchesTimeout()
  if (code === '22023') return new DataGroupMatchesReadError('invalid_data_group_matches_request', DATA_GROUP_MATCHES_INVALID)
  return dataGroupMatchesUnavailable()
}

/**
 * Công tắc tắt nhanh chung với Web: trường tùy chọn `groupMatches` của dòng `web.campaign_input_duplicates` (một dòng
 * không bí mật). Thiếu dòng hoặc thiếu trường = bật; chỉ `false` mới tắt. Đọc lỗi thì ném để nơi gọi quyết định.
 */
export async function readDataGroupMemberMatchesEnabled(signal: AbortSignal): Promise<boolean> {
  requireCurrentUser()
  const { data, error } = await client().from('auto_system_settings')
    .select('value').eq('key', DATA_GROUP_MATCHES_SETTING_KEY).eq('is_active', true).eq('is_secret', false)
    .abortSignal(signal).maybeSingle()
  if (signal.aborted) throw dataGroupMatchesTimeout()
  if (error) throw dataGroupMatchesUnavailable()
  return parseDataGroupMemberMatchesEnabled(data?.value)
}

/** Một lượt RPC chỉ đọc V519 bằng token Desktop và mật khẩu tự động hóa (cùng chuỗi xác thực với V493/V489). */
export async function readDataGroupMemberMatchesRpc(
  groupId: number, request: DataGroupMemberMatchesRequest, signal: AbortSignal
): Promise<DataGroupMemberMatchesResult> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const { data, error } = await client().rpc(DATA_GROUP_MEMBER_MATCHES_RPC, {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password,
    // Desktop chỉ bật đối chiếu cho SĐT và danh sách Zalo (UID, link group), như Web.
    p_query: { groupId, contactType: request.contactType, platform: 'zalo', values: request.values, otherGroups: request.otherGroups }
  }).abortSignal(signal)
  if (signal.aborted) throw dataGroupMatchesTimeout()
  if (error) throw dataGroupMatchesError(error)
  let parsed: DataGroupMemberMatchesResult
  try {
    parsed = parseDataGroupMemberMatchesResult(data)
  } catch {
    throw dataGroupMatchesUnavailable()
  }
  // Kết quả không khớp số giá trị đã hỏi thì không dùng được (index trỏ sai dòng): coi là lượt hỏng.
  if (parsed.valueCount !== request.values.length) throw dataGroupMatchesUnavailable()
  return parsed
}
