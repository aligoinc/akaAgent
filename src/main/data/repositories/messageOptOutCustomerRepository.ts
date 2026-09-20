import type { MessageOptOutCustomerPage, MessageOptOutCustomerQuery } from '../../../shared/messageOptOutCustomers'
import { requireCurrentUser, requireCurrentUserCredentials, getCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

export async function listMessageOptOutCustomers(query: MessageOptOutCustomerQuery = {}): Promise<MessageOptOutCustomerPage> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const page = Number.isSafeInteger(query.page) && Number(query.page) > 0 ? Math.min(Number(query.page), 1000000) : 1
  const { data, error } = await getSupabaseClient().rpc('aka_agent_list_message_opt_out_customers', {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_auth_username: credentials.username,
    p_auth_password: credentials.password,
    p_search: typeof query.search === 'string' ? query.search.trim().slice(0, 200) : '',
    p_page: page
  })
  const current = getCurrentUser()
  if (current?.staffId !== user.staffId || current?.organizationId !== user.organizationId) {
    throw new Error('Phiên đăng nhập đã thay đổi. Vui lòng mở lại danh sách.')
  }
  if (error) throw new Error('Không thể tải khách hàng từ chối nhận tin. Vui lòng thử lại.')
  if (!data || !Array.isArray(data.items)) throw new Error('Dữ liệu khách hàng từ chối nhận tin không hợp lệ.')
  return data as MessageOptOutCustomerPage
}
