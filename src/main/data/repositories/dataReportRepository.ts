import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

/** Data report reads failing with a stable code the renderer can show without technical details. */
export class DataReportReadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'DataReportReadError'
  }
}

function readError(error: { code?: string; message?: string }): DataReportReadError {
  const code = String(error.code || '')
  const message = String(error.message || '')
  if (code === 'PGRST202' || code === '42883' || (/aka_agent_read_data_report/.test(message) && /not find|does not exist/i.test(message))) {
    return new DataReportReadError('data_report_not_ready', 'Báo cáo dữ liệu đang được cập nhật. Vui lòng thử lại sau.')
  }
  if (code === '42501') return new DataReportReadError('report_access_denied', 'Không có quyền xem báo cáo này.')
  if (code === '22023') return new DataReportReadError('invalid_report_query', 'Số điện thoại không hợp lệ.')
  if (code === '57014') return new DataReportReadError('report_timeout', 'Báo cáo đang bận. Vui lòng thử lại sau ít phút.')
  if (/automation_auth/.test(message)) {
    return new DataReportReadError('session_invalid', 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.')
  }
  return new DataReportReadError('report_failed', 'Không thể tải báo cáo dữ liệu. Vui lòng thử lại.')
}

/**
 * V469 reader (snapshot of the nightly build, or one phone's journey) with the logged-in Desktop token and the
 * automation credentials, the same identity rule as the effectiveness and report pages. Read-only.
 */
export async function readDataReport(query: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const { data, error } = await getSupabaseClient().rpc('aka_agent_read_data_report', {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password, p_query: query
  }).abortSignal(signal)
  if (error) throw readError(error)
  return data
}
