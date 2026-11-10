import {
  INPUT_DUPLICATES_RPC, INPUT_DUPLICATES_SETTING_KEY, parseInputDuplicatesResult, parseInputDuplicatesSetting,
  type InputDuplicatesCheckRequest, type InputDuplicatesCheckResult, type InputDuplicatesSetting
} from '../../../shared/campaignInputDuplicates'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

export const INPUT_DUPLICATES_NOT_READY = 'Lọc trùng với chiến dịch khác đang được cập nhật. Vui lòng chọn "Chỉ trong file này" hoặc thử lại sau.'
export const INPUT_DUPLICATES_TIMEOUT = 'Đối chiếu với dữ liệu đã tải lên quá thời gian. Chưa có dữ liệu nào được nhập, vui lòng thử lại.'
export const INPUT_DUPLICATES_UNAVAILABLE = 'Chưa đối chiếu được với dữ liệu đã tải lên. Vui lòng thử lại.'
export const INPUT_DUPLICATES_ACCOUNT_DENIED = 'Có tài khoản không thuộc quyền của bạn trong tổ chức này. Vui lòng chọn lại tài khoản.'
export const SESSION_INVALID = 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.'

/** Lỗi đối chiếu có mã ổn định để renderer hiện câu tiếng Việt, không lộ SQL. */
export class InputDuplicatesReadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'InputDuplicatesReadError'
  }
}

export const inputDuplicatesTimeout = () => new InputDuplicatesReadError('input_duplicates_timeout', INPUT_DUPLICATES_TIMEOUT)
export const inputDuplicatesUnavailable = () => new InputDuplicatesReadError('input_duplicates_unavailable', INPUT_DUPLICATES_UNAVAILABLE)

/**
 * V491/V493 trả lỗi bằng mã Postgres. DB chưa có hàm (PGRST202/42883) hoặc token Desktop chưa được cấp quyền
 * (V493 chưa apply/đã rollback: "permission denied for function") thì báo "đang được cập nhật".
 */
export function inputDuplicatesError(error: { code?: string; message?: string }): InputDuplicatesReadError {
  const code = String(error.code || '')
  const message = String(error.message || '')
  if (code === 'PGRST202' || code === '42883' || (code === '42501' && /permission denied for function/i.test(message))) {
    return new InputDuplicatesReadError('input_duplicates_not_ready', INPUT_DUPLICATES_NOT_READY)
  }
  if (message.includes('input_duplicates_account_scope_denied')) {
    return new InputDuplicatesReadError('input_duplicates_account_denied', INPUT_DUPLICATES_ACCOUNT_DENIED)
  }
  if (/automation_auth/.test(message)) return new InputDuplicatesReadError('session_invalid', SESSION_INVALID)
  if (code === '42501') return new InputDuplicatesReadError('input_duplicates_access_denied', 'Không có quyền đối chiếu dữ liệu này.')
  if (code === '57014') return inputDuplicatesTimeout()
  if (code === '22023') {
    return new InputDuplicatesReadError('invalid_input_duplicates_request', 'Yêu cầu lọc trùng không hợp lệ. Vui lòng mở lại cửa sổ Upload rồi thử lại.')
  }
  return inputDuplicatesUnavailable()
}

/** Công tắc chung với Web (`web.campaign_input_duplicates`), một dòng không bí mật; thiếu hoặc đọc lỗi = tắt. */
export async function readInputDuplicatesSetting(signal: AbortSignal): Promise<InputDuplicatesSetting> {
  requireCurrentUser()
  const { data, error } = await client().from('auto_system_settings')
    .select('value').eq('key', INPUT_DUPLICATES_SETTING_KEY).eq('is_active', true).eq('is_secret', false)
    .abortSignal(signal).maybeSingle()
  if (signal.aborted) throw inputDuplicatesTimeout()
  if (error) throw inputDuplicatesUnavailable()
  return parseInputDuplicatesSetting(data?.value)
}

/** Một lượt RPC chỉ đọc V491 bằng token Desktop và mật khẩu tự động hóa (cùng chuỗi xác thực với V489). */
export async function readInputDuplicatesRpc(request: InputDuplicatesCheckRequest, signal: AbortSignal): Promise<InputDuplicatesCheckResult> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const { data, error } = await client().rpc(INPUT_DUPLICATES_RPC, {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password,
    p_query: {
      actionId: request.actionId, accountIds: request.accountIds, days: request.days, phones: request.phones,
      ...(request.excludeCampaignId ? { excludeCampaignId: request.excludeCampaignId } : {})
    }
  }).abortSignal(signal)
  if (signal.aborted) throw inputDuplicatesTimeout()
  if (error) throw inputDuplicatesError(error)
  try {
    return parseInputDuplicatesResult(data)
  } catch {
    throw inputDuplicatesUnavailable()
  }
}
