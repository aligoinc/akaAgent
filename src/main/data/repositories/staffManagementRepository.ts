import { canManageStaff, type StaffAccess, type StaffManagementAction } from '../../../shared/staffManagement'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

export class StaffManagementAccessError extends Error {
  constructor() { super('Bạn không có quyền quản lý nhân viên.'); this.name = 'StaffManagementAccessError' }
}

const messages: Record<string, string> = {
  staff_invalid_input: 'Thông tin nhập chưa hợp lệ. Vui lòng kiểm tra lại.',
  staff_not_found: 'Dữ liệu không còn tồn tại hoặc không thuộc tổ chức của bạn. Hãy tải lại.',
  staff_conflict: 'Dữ liệu đã thay đổi. Hãy tải lại trước khi lưu.',
  staff_phone_exists: 'Số điện thoại đã tồn tại trong tổ chức.',
  staff_quota_full: 'Đã đạt số lượng nhân viên tối đa của tổ chức.',
  staff_group_cycle: 'Không thể chọn chính phòng ban này hoặc phòng ban con làm cấp trên.',
  staff_group_multiple_roots: 'Tổ chức đang có nhiều phòng ban gốc. Cần chuẩn hóa dữ liệu phòng ban trước khi tiếp tục.',
  staff_group_root_read_only: 'Dòng tổ chức không chỉnh sửa tại màn hình quản lý phòng ban.',
  staff_admin_required: 'Không thể tự khóa tài khoản hoặc khóa quản trị viên hoạt động cuối cùng.'
}

export async function callStaffManagement(action: StaffManagementAction, input: Record<string, unknown>): Promise<unknown> {
  const user = requireCurrentUser()
  if (!canManageStaff(user)) throw new StaffManagementAccessError()
  const credentials = requireCurrentUserCredentials()
  const { data, error } = await getSupabaseClient().rpc('aka_agent_staff_management', {
    p_actor_id: user.staffId, p_username: credentials.username, p_password: credentials.password,
    p_action: action, p_data: input
  }).abortSignal(AbortSignal.timeout(15_000))
  const current = getCurrentUser()
  if (current?.staffId !== user.staffId || current.organizationId !== user.organizationId || getCurrentUserCredentials() !== credentials) {
    throw new Error('Phiên đăng nhập đã thay đổi.')
  }
  if (!canManageStaff(current)) throw new StaffManagementAccessError()
  if (error) {
    if (error.message?.includes('staff_access_denied')) throw new StaffManagementAccessError()
    for (const [code, message] of Object.entries(messages)) if (error.message?.includes(code)) throw new Error(message)
    if (['22P02', '22023', '22003'].includes(error.code)) throw new Error(messages.staff_invalid_input)
    if (error.code === '23505') throw new Error('Tên đăng nhập tạo từ số điện thoại này đã tồn tại. Vui lòng dùng số điện thoại khác.')
    // Do not expose SQL/details or log a response containing a password.
    throw new Error('Không thể xác nhận thao tác. Hãy thử lại; yêu cầu đang lưu sẽ giữ nguyên để tránh thực hiện trùng.')
  }
  return data
}

export async function readStaffAccess(staffId: number, username: string, password: string): Promise<StaffAccess> {
  const { data, error } = await getSupabaseClient().rpc('aka_agent_staff_access', {
    p_staff_id: staffId, p_username: username, p_password: password
  }).abortSignal(AbortSignal.timeout(5000))
  if (error) {
    if (error.message?.includes('staff_auth_invalid')) return { isAdmin: false, isActive: false, timeAllowed: false, expirationDate: null, useOrganizationExpiration: false }
    throw new Error('Không thể kiểm tra quyền sử dụng nhân viên. Vui lòng thử lại.')
  }
  if (!data || typeof data.isActive !== 'boolean' || typeof data.timeAllowed !== 'boolean' || typeof data.isAdmin !== 'boolean') {
    throw new Error('Không thể xác minh quyền sử dụng nhân viên.')
  }
  return data as StaffAccess
}
