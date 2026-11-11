import {
  INPUT_DUPLICATES_SETTING_OFF, inputDuplicatesVisible, validateInputDuplicatesRequest,
  type InputDuplicatesCheckRequest, type InputDuplicatesCheckResult, type InputDuplicatesSetting
} from '../../shared/campaignInputDuplicates'
import type {
  CampaignInputDuplicatesIpcRequest, CampaignInputDuplicatesIpcResponses, CampaignInputDuplicatesIpcResult
} from '../../shared/campaignInputDuplicatesIpc'
import { requireCurrentUser, runWithCurrentUser } from '../data/currentUser'
import * as repo from '../data/repositories/campaignInputDuplicatesRepository'
import { InputDuplicatesReadError, SESSION_INVALID } from '../data/repositories/campaignInputDuplicatesRepository'

/**
 * "Lọc trùng dữ liệu" của cửa sổ Upload dữ liệu trên Desktop (V491 + V493). Chỉ chạy khi khách chọn đối chiếu với
 * chiến dịch khác: mỗi lượt đọc lại công tắc (một dòng) rồi một lượt RPC chỉ đọc ≤ 2.000 SĐT (giới hạn RPC; renderer
 * gửi lượt 1.000) qua client HTTP sẵn có của tiến trình. DB đặt trần 20 s cho hàm; hạn cả lượt ở đây 25 s. Tối đa 2
 * lượt cùng lúc mỗi tiến trình (renderer gửi tuần tự từng lượt), quá thì báo bận, không xếp hàng. Không cache, không
 * hẹn giờ, không client/kết nối mới.
 */
export const INPUT_DUPLICATES_DEADLINE_MS = 25_000
export const INPUT_DUPLICATES_MAX_FLIGHTS = 2
export const INPUT_DUPLICATES_DISABLED = 'Lọc trùng với chiến dịch khác chưa mở cho tài khoản này. Vui lòng chọn "Chỉ trong file này".'
export const INPUT_DUPLICATES_BUSY = 'Hệ thống đang đối chiếu nhiều dữ liệu. Vui lòng thử lại sau ít giây.'

let flights = 0

async function readSetting(): Promise<InputDuplicatesSetting> {
  try {
    return await repo.readInputDuplicatesSetting(AbortSignal.timeout(INPUT_DUPLICATES_DEADLINE_MS))
  } catch (error) {
    if (error instanceof InputDuplicatesReadError) return INPUT_DUPLICATES_SETTING_OFF
    throw error
  }
}

async function check(body: unknown): Promise<InputDuplicatesCheckResult> {
  const user = requireCurrentUser()
  // Công tắc đọc lại mỗi lượt (không cache): đổi audience/off có hiệu lực ngay như API Web.
  const setting = await repo.readInputDuplicatesSetting(AbortSignal.timeout(INPUT_DUPLICATES_DEADLINE_MS))
  if (!inputDuplicatesVisible(setting, user.isAdminAkabiz)) {
    throw new InputDuplicatesReadError('input_duplicates_disabled', INPUT_DUPLICATES_DISABLED)
  }
  let request: InputDuplicatesCheckRequest
  try {
    request = validateInputDuplicatesRequest(body, setting.maxDays)
  } catch (error) {
    throw new InputDuplicatesReadError('invalid_input_duplicates_request', error instanceof Error ? error.message : 'Yêu cầu lọc trùng không hợp lệ.')
  }
  if (flights >= INPUT_DUPLICATES_MAX_FLIGHTS) throw new InputDuplicatesReadError('input_duplicates_busy', INPUT_DUPLICATES_BUSY)
  flights++
  try {
    return await repo.readInputDuplicatesRpc(request, AbortSignal.timeout(INPUT_DUPLICATES_DEADLINE_MS))
  } finally {
    flights--
  }
}

export async function handleCampaignInputDuplicatesRequest<R extends CampaignInputDuplicatesIpcRequest>(request: R):
  Promise<CampaignInputDuplicatesIpcResult<CampaignInputDuplicatesIpcResponses[R['kind']]>> {
  type Data = CampaignInputDuplicatesIpcResponses[R['kind']]
  try {
    const user = requireCurrentUser()
    if (request?.kind === 'setting') return { ok: true, data: await runWithCurrentUser(user, readSetting) as Data }
    if (request?.kind === 'check') return { ok: true, data: await runWithCurrentUser(user, () => check(request.request)) as Data }
    return { ok: false, code: 'invalid_input_duplicates_request', message: 'Yêu cầu lọc trùng không hợp lệ.' }
  } catch (error) {
    if (error instanceof InputDuplicatesReadError) return { ok: false, code: error.code, message: error.message }
    const message = error instanceof Error ? error.message : String(error)
    if (/chưa đăng nhập|đăng nhập lại|Not logged in/i.test(message)) return { ok: false, code: 'session_invalid', message: SESSION_INVALID }
    console.warn('[campaignInputDuplicates] request failed:', message)
    return { ok: false, code: 'input_duplicates_unavailable', message: repo.INPUT_DUPLICATES_UNAVAILABLE }
  }
}
