import {
  validateAppendPreviewRequest, type CampaignAddDataPreviewRequest, type CampaignAddDataPreviewResponse
} from '../../shared/campaignAppendData'
import { requireCurrentUser, runWithCurrentUser } from '../data/currentUser'
import { CampaignAddDataPreviewError, previewCampaignInputDataAppend } from '../data/repositories/campaignRepository'
import { readAppendPreviewEnabled, SESSION_INVALID } from '../data/repositories/campaignInputDuplicatesRepository'

/**
 * "Thêm data" → xem trước data đã có trong chiến dịch này (Desktop). Chỉ đọc: một dòng công tắc + khóa định danh của data
 * chiến dịch (trang 1.000 dòng theo id, chỉ cột định danh) rồi phân loại bằng đúng luật của đường ghi. Không cache, không
 * hẹn giờ, không client mới. Hạn cả lượt 20 s; tối đa 2 lượt cùng lúc mỗi tiến trình (renderer gửi tuần tự), quá thì báo
 * bận, không xếp hàng. Trả {ok,data}|{ok:false,code,message}, không ném lỗi.
 */
export const ADD_DATA_PREVIEW_DEADLINE_MS = 20_000
export const ADD_DATA_PREVIEW_MAX_FLIGHTS = 2
export const ADD_DATA_PREVIEW_DISABLED = 'Xem trước data đã có trong chiến dịch đang tắt. Khi bấm Thêm, hệ thống vẫn bỏ qua data đã có nếu bạn bật lựa chọn này.'
export const ADD_DATA_PREVIEW_BUSY = 'Hệ thống đang kiểm tra nhiều dữ liệu. Vui lòng thử lại sau ít giây.'
export const ADD_DATA_PREVIEW_TIMEOUT = 'Kiểm tra data đã có trong chiến dịch quá thời gian. Vui lòng thử lại.'
export const ADD_DATA_PREVIEW_FAILED = 'Chưa kiểm tra được data đã có trong chiến dịch. Vui lòng thử lại.'

let flights = 0

export async function handleCampaignAddDataPreviewRequest(body: unknown): Promise<CampaignAddDataPreviewResponse> {
  let request: CampaignAddDataPreviewRequest
  let user: ReturnType<typeof requireCurrentUser>
  try {
    user = requireCurrentUser()
  } catch {
    return { ok: false, code: 'session_invalid', message: SESSION_INVALID }
  }
  try {
    request = validateAppendPreviewRequest(body)
  } catch (error) {
    return { ok: false, code: 'invalid_append_preview_request', message: error instanceof Error ? error.message : 'Dữ liệu xem trước không hợp lệ.' }
  }
  if (flights >= ADD_DATA_PREVIEW_MAX_FLIGHTS) return { ok: false, code: 'append_preview_busy', message: ADD_DATA_PREVIEW_BUSY }
  flights++
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ADD_DATA_PREVIEW_DEADLINE_MS)
  try {
    return await runWithCurrentUser(user, async (): Promise<CampaignAddDataPreviewResponse> => {
      // Công tắc đọc lại mỗi lượt (không cache): đổi appendPreview có hiệu lực ngay như API Web.
      if (!await readAppendPreviewEnabled(controller.signal)) {
        return { ok: false, code: 'append_preview_disabled', message: ADD_DATA_PREVIEW_DISABLED }
      }
      return { ok: true, data: await previewCampaignInputDataAppend(request, controller.signal) }
    })
  } catch (error) {
    if (error instanceof CampaignAddDataPreviewError) return { ok: false, code: error.code, message: error.message }
    if (controller.signal.aborted) return { ok: false, code: 'append_preview_timeout', message: ADD_DATA_PREVIEW_TIMEOUT }
    const message = error instanceof Error ? error.message : String(error)
    if (/chưa đăng nhập|đăng nhập lại|Not logged in/i.test(message)) return { ok: false, code: 'session_invalid', message: SESSION_INVALID }
    console.warn('[campaignAddDataPreview] request failed:', message)
    return { ok: false, code: 'append_preview_failed', message: ADD_DATA_PREVIEW_FAILED }
  } finally {
    clearTimeout(timer)
    flights--
  }
}
