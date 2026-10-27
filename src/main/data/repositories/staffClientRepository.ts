import type { DeviceV3Decision } from '../../../shared/deviceIdentity'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials, type ProcessAuthCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

/** Only explicit profile fields leave the credential-verifying RPC. Never includes password. */
export interface StaffClientProfile {
  id: number
  organization_id: number
  name: string
  phone: string | null
  username: string
  is_active: boolean
  is_admin: boolean | null
  is_admin_akabiz: boolean
  use_test_workflow: boolean
  is_policy_accepted: boolean
  policy_accepted_at: string | null
  aka_agent_device_identity_version?: 2 | 3
  deviceV3?: DeviceV3Decision | null
  aka_agent_device_fingerprint_hash: string | null
  device_label: string | null
  device_platform: string | null
  device_bound_at: string | null
  device_last_seen_at: string | null
  app_notification: string | null
  akabiz_integrations: unknown
  updated_at: string
}

type StaffClientAction = 'prepare_device_v3' | 'bind_device_v3' | 'read' | 'bind_device' | 'accept_policy' | 'change_password' | 'set_test_workflow' | 'save_integration' | 'register_recovery'
const messages: Record<string, string> = {
  staff_client_auth_invalid: 'Tên đăng nhập hoặc mật khẩu không đúng.',
  staff_client_inactive: 'Tài khoản đã bị khoá.',
  staff_client_expired: 'Tài khoản nhân viên đã hết hạn sử dụng.',
  staff_client_device_locked: 'Tài khoản này đang liên kết với máy tính khác. Vui lòng chọn Đổi máy tính trên trang đăng nhập hoặc liên hệ hỗ trợ.',
  staff_client_forbidden: 'Bạn không có quyền thực hiện thao tác này.',
  staff_client_policy_required: 'Vui lòng xác nhận chính sách sử dụng để tiếp tục.',
  staff_client_invalid_input: 'Thông tin nhập chưa hợp lệ. Vui lòng kiểm tra lại.'
}

export async function callStaffClient(
  credentials: ProcessAuthCredentials,
  action: StaffClientAction,
  input: Record<string, unknown> = {}
): Promise<StaffClientProfile> {
  const { data, error } = await getSupabaseClient().rpc('aka_agent_staff_client', {
    p_username: credentials.username.trim(), p_password: credentials.password,
    p_action: action, p_data: input
  }).abortSignal(AbortSignal.timeout(15_000))
  if (error) {
    // Never log/relay raw PostgREST errors: they can include credentials or SQL.
    for (const [code, message] of Object.entries(messages)) if (error.message?.includes(code)) throw new Error(message)
    if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Máy chủ chưa sẵn sàng cho phiên bản này. Vui lòng liên hệ hỗ trợ.')
    throw new Error('Không thể xác nhận thao tác tài khoản. Vui lòng kiểm tra kết nối và thử lại.')
  }
  if (!data || !Number.isSafeInteger(data.id) || data.id <= 0 || !Number.isSafeInteger(data.organization_id)
    || data.username !== credentials.username.trim() || typeof data.is_active !== 'boolean'
    || Object.prototype.hasOwnProperty.call(data, 'password')) throw new Error('Không thể xác minh thông tin tài khoản.')
  if (input.staffId !== undefined && data.id !== input.staffId) throw new Error('Phiên đăng nhập đã thay đổi.')
  if (action === 'prepare_device_v3' || action === 'bind_device_v3') {
    const d = data.deviceV3
    if (!d || !['allowed', 'manual_login_required', 'device_locked'].includes(d.decision)
      || typeof d.automaticAllowed !== 'boolean' || typeof d.needsBinding !== 'boolean'
      || !d.binding || ![2, 3].includes(d.binding.version) || !/^[0-9]+$/.test(d.binding.revision)
      || !(d.binding.hash === null || (typeof d.binding.hash === 'string' && /^[a-f0-9]{64}$/.test(d.binding.hash)))) {
      throw new Error('Không thể xác minh liên kết máy tính.')
    }
  }
  return data as StaffClientProfile
}

export async function callCurrentStaffClient(action: StaffClientAction, input: Record<string, unknown> = {}): Promise<StaffClientProfile> {
  const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
  const data = await callStaffClient(credentials, action, { ...input, staffId: user.staffId })
  const current = getCurrentUser()
  if (current?.staffId !== user.staffId || current.organizationId !== user.organizationId
    || getCurrentUserCredentials() !== credentials || data.organization_id !== user.organizationId) throw new Error('Phiên đăng nhập đã thay đổi.')
  return data
}
