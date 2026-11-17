import {
  CAMPAIGN_RESULT_ACTIONS_NOT_READY, CAMPAIGN_RESULT_RECIPIENTS_TIMEOUT, CAMPAIGN_RESULT_RECIPIENTS_UNAVAILABLE
} from '../../../shared/campaignResultActions'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

export const CAMPAIGN_RESULT_RECIPIENTS_RPC = 'aka_agent_read_campaign_result_recipients'

/** Lỗi đọc có mã ổn định để renderer hiện câu tiếng Việt, không lộ SQL. */
export class CampaignResultActionsReadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CampaignResultActionsReadError'
  }
}

export const resultActionsNotReady = () => new CampaignResultActionsReadError('campaign_result_actions_not_ready', CAMPAIGN_RESULT_ACTIONS_NOT_READY)
export const resultRecipientsUnavailable = () =>
  new CampaignResultActionsReadError('campaign_result_recipients_unavailable', CAMPAIGN_RESULT_RECIPIENTS_UNAVAILABLE)
export const resultRecipientsTimeout = () => new CampaignResultActionsReadError('campaign_result_recipients_timeout', CAMPAIGN_RESULT_RECIPIENTS_TIMEOUT)
export const invalidResultQuery = (message = 'Bộ lọc không hợp lệ.') => new CampaignResultActionsReadError('invalid_campaign_result_query', message)

/**
 * Lỗi của hai hàm V539 (cả `aka_agent_list_campaign_details_page_v3`). DB chưa có hàm (PGRST202/42883) hoặc token Desktop
 * chưa được cấp quyền (V540 chưa apply/đã rollback: "permission denied for function") thì báo "đang được cập nhật" để
 * bộ lọc chỉ còn "Tất cả"; danh sách "Tất cả" vẫn đọc v2 nên không bị ảnh hưởng.
 */
export function campaignResultActionsError(error: { code?: string; message?: string }): CampaignResultActionsReadError {
  const code = String(error.code || '')
  const message = String(error.message || '')
  if (code === 'PGRST202' || code === '42883' || (code === '42501' && /permission denied for function/i.test(message))) {
    return resultActionsNotReady()
  }
  if (message.includes('campaign_not_found')) return new CampaignResultActionsReadError('campaign_not_found', 'Không tìm thấy chiến dịch.')
  if (/automation_auth/.test(message)) {
    return new CampaignResultActionsReadError('session_invalid', 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.')
  }
  if (code === '42501') return new CampaignResultActionsReadError('report_access_denied', 'Không có quyền xem kết quả này.')
  if (code === '22023' || /invalid_campaign_details_action/.test(message)) return invalidResultQuery()
  if (code === '57014') return resultRecipientsTimeout()
  return resultRecipientsUnavailable()
}

/** Một lượt gọi hàm chỉ đọc V539 bằng token Desktop và mật khẩu tự động hóa (cùng chuỗi xác thực với V487/V489). */
export async function readCampaignResultRecipientsRpc(campaignId: number, query: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const { data, error } = await getSupabaseClient().rpc(CAMPAIGN_RESULT_RECIPIENTS_RPC, {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password,
    p_campaign_id: campaignId, p_query: query
  }).abortSignal(signal)
  if (signal.aborted) throw resultRecipientsTimeout()
  if (error) throw campaignResultActionsError(error)
  return data
}
