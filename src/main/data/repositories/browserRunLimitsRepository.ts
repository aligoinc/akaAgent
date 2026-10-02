import { isBrowserRunLimits, type BrowserRunLimits, type SaveBrowserRunLimitsResult } from '../../../shared/browserRunLimits'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

async function callBrowserRunLimits(action: 'get' | 'save', settings?: BrowserRunLimits): Promise<SaveBrowserRunLimitsResult> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  if (action === 'save' && !isBrowserRunLimits(settings)) throw new Error('Giới hạn tài khoản chạy không hợp lệ.')
  const { data, error } = await getSupabaseClient().rpc('aka_agent_browser_run_limits', {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_auth_username: credentials.username,
    p_auth_password: credentials.password,
    p_action: action,
    p_data: settings ? { zaloWebMax: settings.zaloWebMax, facebookMax: settings.facebookMax, revision: settings.revision } : {}
  }).abortSignal(AbortSignal.timeout(15_000))
  const current = getCurrentUser()
  if (current?.staffId !== user.staffId || current.organizationId !== user.organizationId
    || getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi. Vui lòng mở lại cài đặt.')
  if (error) throw new Error(action === 'get'
    ? 'Không thể tải giới hạn tài khoản chạy. Vui lòng thử lại.'
    : 'Chưa xác nhận được kết quả lưu. Vui lòng thử lại hoặc tải lại cấu hình.')
  if (action === 'save' && data?.ok === false && data.reason === 'conflict') return { ok: false, reason: 'conflict' }
  if (data?.ok !== true || !isBrowserRunLimits(data.settings)) throw new Error('Dữ liệu giới hạn tài khoản chạy không hợp lệ.')
  return { ok: true, settings: data.settings }
}

export async function getBrowserRunLimits(): Promise<BrowserRunLimits> {
  const result = await callBrowserRunLimits('get')
  if (!result.ok) throw new Error('Không thể tải giới hạn tài khoản chạy.')
  return result.settings
}

export function saveBrowserRunLimits(settings: BrowserRunLimits): Promise<SaveBrowserRunLimitsResult> {
  return callBrowserRunLimits('save', settings)
}
