import {
  CAMPAIGN_RUN_REPORT_NOT_READY, CAMPAIGN_RUN_REPORT_TIMEOUT, CAMPAIGN_RUN_REPORT_UNAVAILABLE, campaignRunReportQuery,
  parseCampaignRunReportRpc, type CampaignRunReportRpcResult
} from '../../../shared/campaignRunReport'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()
type Row = Record<string, unknown>
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const relation = (value: unknown): Row => object(Array.isArray(value) ? value[0] : value)

export const CAMPAIGN_RUN_REPORT_RPC = 'aka_agent_read_campaign_run_report'

/** Lỗi đọc báo cáo có mã ổn định để renderer hiện câu tiếng Việt, không lộ SQL. */
export class CampaignRunReportReadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CampaignRunReportReadError'
  }
}

export const campaignNotFound = () => new CampaignRunReportReadError('campaign_not_found', 'Không tìm thấy chiến dịch.')
export const reportUnavailable = () => new CampaignRunReportReadError('campaign_report_unavailable', CAMPAIGN_RUN_REPORT_UNAVAILABLE)
export const reportTimeout = () => new CampaignRunReportReadError('report_timeout', CAMPAIGN_RUN_REPORT_TIMEOUT)

/**
 * V487/V489 trả lỗi bằng mã Postgres. DB chưa có hàm (PGRST202/42883) hoặc token Desktop chưa được cấp quyền
 * (V489 chưa apply/đã rollback: "permission denied for function") thì báo "đang được cập nhật".
 */
export function campaignRunReportError(error: { code?: string; message?: string }): CampaignRunReportReadError {
  const code = String(error.code || '')
  const message = String(error.message || '')
  if (code === 'PGRST202' || code === '42883' || (code === '42501' && /permission denied for function/i.test(message))) {
    return new CampaignRunReportReadError('campaign_report_not_ready', CAMPAIGN_RUN_REPORT_NOT_READY)
  }
  if (code === 'P0002' || message.includes('campaign_report_not_found')) return campaignNotFound()
  if (/automation_auth/.test(message)) {
    return new CampaignRunReportReadError('session_invalid', 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.')
  }
  if (code === '42501') return new CampaignRunReportReadError('report_access_denied', 'Không có quyền xem báo cáo này.')
  if (code === '57014') return reportTimeout()
  return reportUnavailable()
}

export interface CampaignRunReportCampaign {
  id: number
  actionId: string
  extraSettings: Record<string, unknown>
  /** `flatform_type` của tài khoản chạy chiến dịch; rỗng khi không đọc được tài khoản. */
  platform: string
}

/** Chiến dịch của staff hiện tại (chưa xoá) kèm loại tài khoản; tài khoản đã xoá vẫn xem được như tab Kết quả chạy. */
export async function readCampaignRunReportCampaign(campaignId: number, signal: AbortSignal): Promise<CampaignRunReportCampaign> {
  const user = requireCurrentUser()
  const { data, error } = await client().from('auto_campaigns')
    .select('id,action_id,extra_settings,primary_account:auto_accounts!auto_campaigns_account_id_fkey(flatform_type)')
    .eq('id', campaignId).eq('staff_id', user.staffId).eq('organization_id', user.organizationId).eq('is_delete', false)
    .abortSignal(signal).maybeSingle()
  if (signal.aborted) throw reportTimeout()
  if (error) throw reportUnavailable()
  if (!data) throw campaignNotFound()
  const row = object(data)
  return {
    id: Number(row.id),
    actionId: String(row.action_id ?? ''),
    extraSettings: object(row.extra_settings),
    platform: String(relation(row.primary_account).flatform_type ?? '')
  }
}

/** Một lượt gọi RPC chỉ đọc V487 bằng token Desktop và mật khẩu tự động hóa (cùng chuỗi xác thực với V462). */
export async function readCampaignRunReportRpc(campaignId: number, signal: AbortSignal): Promise<CampaignRunReportRpcResult> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const { data, error } = await client().rpc(CAMPAIGN_RUN_REPORT_RPC, {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password,
    p_campaign_id: campaignId, p_query: campaignRunReportQuery()
  }).abortSignal(signal)
  if (signal.aborted) throw reportTimeout()
  if (error) throw campaignRunReportError(error)
  try {
    return parseCampaignRunReportRpc(data)
  } catch {
    throw reportUnavailable()
  }
}
