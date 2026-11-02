import { appAccessErrorMessage, type AppAccessChange, type AppAccessChangeResult, type AppAccessSnapshot } from '../../../shared/appAccess'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

export async function loadAppAccessForStaff(staffId: number, username: string, password: string, accountIds: number[] = []): Promise<AppAccessSnapshot> {
  const { data, error } = await getSupabaseClient().rpc('aka_agent_app_access', {
    p_actor_id: staffId, p_username: username, p_password: password, p_action: 'snapshot', p_data: { accountIds }
  }).abortSignal(AbortSignal.timeout(15_000))
  if (error || !data || typeof data.separateAccess !== 'boolean') throw new Error('Không thể kiểm tra quyền sử dụng ứng dụng.')
  return data as AppAccessSnapshot
}

export async function readAppAccess(accountIds: number[] = []): Promise<AppAccessSnapshot> {
  const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
  const result = await loadAppAccessForStaff(user.staffId, credentials.username, credentials.password, accountIds)
  if (getCurrentUser()?.staffId !== user.staffId || getCurrentUser()?.organizationId !== user.organizationId || getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi.')
  return result
}

export async function setAppAccess(input: AppAccessChange): Promise<AppAccessChangeResult> {
  const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
  const { data, error } = await getSupabaseClient().rpc('aka_agent_app_access', {
    p_actor_id: user.staffId, p_username: credentials.username, p_password: credentials.password,
    p_action: 'set', p_data: input
  }).abortSignal(AbortSignal.timeout(15_000))
  if (getCurrentUser()?.staffId !== user.staffId || getCurrentUser()?.organizationId !== user.organizationId || getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi.')
  if (error) throw new Error(appAccessErrorMessage(error.message.match(/(?:app_access|zalo_already_linked)[a-z_]*/)?.[0] ?? ''))
  if (!data || data.requestId !== input.requestId) throw new Error('Không thể xác nhận thay đổi. Hãy thử lại với yêu cầu đang lưu.')
  return data as AppAccessChangeResult
}
