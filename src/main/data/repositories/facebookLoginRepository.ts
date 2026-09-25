import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const messages: Record<string, string> = {
  facebook_access_denied: 'Tài khoản không có quyền Facebook hoặc đã hết hạn.',
  facebook_batch_limit: 'Vượt giới hạn số tài khoản mỗi lượt import.',
  facebook_account_quota: 'Đã đạt giới hạn tài khoản Facebook của gói.',
  facebook_invalid_group: 'Nhóm tài khoản không còn hợp lệ.',
  facebook_invalid_proxy: 'Proxy không còn hợp lệ.',
  facebook_not_found: 'Tài khoản đã bị xóa hoặc không còn thuộc phiên này.',
  facebook_not_managed: 'Tài khoản này không được tạo từ chức năng import tự động.',
  facebook_conflict: 'Phiên đã thay đổi. Hãy tải lại trước khi tiếp tục.',
  facebook_unverified: 'Chưa xác định được trạng thái trình duyệt. Hãy đợi trang tải xong.',
  facebook_uid_mismatch: 'UID nhập vào khác UID đang đăng nhập trong trình duyệt.',
  facebook_invalid_input: 'Thông tin Facebook không hợp lệ.'
}
export class FacebookDataError extends Error {
  constructor(readonly code: string) { super(messages[code] || 'Không thể đồng bộ thông tin Facebook. Vui lòng thử lại.'); this.name = 'FacebookDataError' }
}
/** All secrets remain in the main process. Never relay SQL error/details to UI or logs. */
export async function facebookRpc<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
  const { data, error } = await getSupabaseClient().rpc('aka_agent_facebook_login', {
    p_staff_id: user.staffId, p_username: credentials.username, p_password: credentials.password,
    p_action: action, p_data: payload
  }).abortSignal(AbortSignal.timeout(18_000))
  if (getCurrentUser()?.staffId !== user.staffId || getCurrentUser()?.organizationId !== user.organizationId ||
    getCurrentUserCredentials() !== credentials) throw new FacebookDataError('facebook_conflict')
  if (error) throw new FacebookDataError(Object.keys(messages).find(code => error.message?.includes(code)) || 'unavailable')
  return data as T
}
