import type { SaveSendExclusionGroup, SendExclusionGroup, SendExclusionPage } from '../../../shared/campaignSendExclusion'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

async function call<T>(accountId: number, operation: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
  const {data, error} = await getSupabaseClient().rpc('aka_agent_send_exclusion_groups', {
    p_staff_id: user.staffId, p_organization_id: user.organizationId, p_account_id: accountId,
    p_operation: operation, p_payload: payload,
    p_auth_username: credentials.username, p_auth_password: credentials.password
  }).abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000))
  const current = getCurrentUser()
  if (current?.staffId !== user.staffId || current.organizationId !== user.organizationId || getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi.')
  if (error) {
    if (error.message.includes('revision_conflict')) throw new Error('Nhóm đã được thay đổi. Hãy tải lại trước khi sửa.')
    if (error.message.includes('not_found')) throw new Error('Nhóm, tài khoản hoặc giá trị đã bị xóa. Hãy tải lại.')
    throw new Error('Không thể tải hoặc lưu điều kiện loại trừ. Kiểm tra dữ liệu và thử lại.')
  }
  return data as T
}
export const listSendExclusionGroups = (accountId: number, signal?: AbortSignal) => call<SendExclusionPage>(accountId, 'list', {}, signal)
export const saveSendExclusionGroup = (group: SaveSendExclusionGroup) => call<SendExclusionGroup>(group.accountId, 'save', group)

/** Câu cho khách theo mã lỗi của DB (V330/V653); mã khác giữ câu chung. */
const RUNTIME_ERROR_MESSAGES: Array<[string, string]> = [
  ['send_exclusion_group_not_found', 'Nhóm điều kiện loại trừ đã bị xoá.'],
  ['send_exclusion_blocklist_not_found', 'Danh sách Zalo ID loại trừ đã bị xoá.'],
  ['send_exclusion_data_group_not_found', 'Nhóm data loại trừ không còn dùng được.'],
  ['send_exclusion_campaign_not_found', 'Chiến dịch dùng để loại trừ không còn dùng được.'],
  ['send_exclusion_account_not_found', 'Tài khoản trong cấu hình loại trừ không còn.'],
  ['send_exclusion_account_configuration_missing', 'Chưa cấu hình loại trừ cho tài khoản thực hiện.'],
  ['send_exclusion_client_outdated', 'Cập nhật akaAgent để chạy loại trừ theo nhiều Zalo.'],
  ['send_exclusion_option_unavailable', 'Nhóm điều kiện loại trừ còn chọn giá trị không còn tồn tại.']
]
export function sendExclusionRuntimeErrorMessage(message: string | undefined): string {
  return RUNTIME_ERROR_MESSAGES.find(([code]) => message?.includes(code))?.[1] ?? 'Không thể xác minh điều kiện loại trừ hoặc quyền thực hiện chiến dịch.'
}

/** Uses the existing HTTP client and the scheduler's lease; never renderer credentials. */
export async function callSendExclusionRuntime<T>(campaignId: number, accountId: number, staffId: number, claimToken: string, operation: 'snapshot' | 'facts' | 'remote' | 'pause', payload: Record<string, unknown> = {}): Promise<T> {
  const {data, error} = await getSupabaseClient().rpc('aka_agent_campaign_send_exclusion_runtime', {
    p_campaign_id: campaignId, p_account_id: accountId, p_staff_id: staffId,
    p_claim_token: claimToken, p_operation: operation, p_payload: payload
  }).abortSignal(AbortSignal.timeout(20_000))
  if (error) throw new Error(sendExclusionRuntimeErrorMessage(error.message))
  return data as T
}
