import { AI_CHAT_DESKTOP_IMAGE_PATH, AI_CHAT_UNAVAILABLE, parseAiChatImage, type AiChatImage, type AiChatImageUpload } from '../../shared/aiChat'
import { AiChatDesktopError } from '../../shared/aiChatDesktop'

/**
 * Tải ảnh đính kèm câu hỏi Hỏi đáp AI lên API Web (akaAgentWebApp, đường `AI_CHAT_DESKTOP_IMAGE_PATH`). API xác minh phiên
 * Desktop rồi cất ảnh vào kho media của hệ thống; app Desktop không tự ghi kho và không cần khóa ghi của kho cho việc này.
 * Hợp đồng: POST JSON `AiChatImageUpload` kèm `Authorization: Bearer <token phiên>`; trả `{ ok: true, data: AiChatImage }`
 * hoặc `{ ok: false, code, message }`. Tệp này không nhập Electron hay Supabase: nơi gọi truyền cách lấy token và `fetch`.
 */

/** `AKA_AGENT_AI_CHAT_IMAGE_API_URL` chỉ để kiểm thử hoặc triển khai riêng, như `AKA_AGENT_AI_API_URL` của đường AI. */
export const AI_CHAT_IMAGE_API_URL = process.env.AKA_AGENT_AI_CHAT_IMAGE_API_URL || `https://agent.akabiz.net${AI_CHAT_DESKTOP_IMAGE_PATH}`

/** Một ảnh tối đa ~7 MB base64; quá hạn này thì bỏ lượt tải để không giữ bộ nhớ và ô ảnh "đang tải" mãi. */
const UPLOAD_TIMEOUT_MS = 60_000

export interface AiChatImageApiDeps {
  url: string
  /** Token phiên Desktop đang đăng nhập. */
  token(signal: AbortSignal): Promise<string>
  fetch: typeof fetch
  timeoutMs?: number
}

const fail = (code: string) => new AiChatDesktopError(code)

/** Câu trả lời không theo hợp đồng (API chưa có đường này, cổng trung gian trả lỗi): suy theo mã HTTP. */
function codeForStatus(status: number): string {
  // API Web chưa deploy bản có đường tải ảnh của Desktop.
  if (status === 404 || status === 405) return 'ai_chat_images_not_ready'
  if (status === 401 || status === 403) return 'ai_chat_access_denied'
  if (status === 413) return 'ai_chat_image_too_large'
  if (status === 429) return 'ai_chat_image_rate_limited'
  return 'ai_chat_image_upload_failed'
}

/** Một lượt gửi, không tự gửi lại: người dùng bấm thử lại ở ô ảnh lỗi. */
export async function uploadAiChatImageToApi(deps: AiChatImageApiDeps, image: AiChatImageUpload): Promise<AiChatImage> {
  const signal = AbortSignal.timeout(deps.timeoutMs ?? UPLOAD_TIMEOUT_MS)
  let token: string
  try {
    token = await deps.token(signal)
  } catch {
    throw fail(AI_CHAT_UNAVAILABLE)
  }
  let response: Response
  try {
    response = await deps.fetch(deps.url, {
      method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mimeType: image.mimeType, dataBase64: image.dataBase64 })
    })
  } catch {
    throw fail('ai_chat_image_upload_failed')
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const result = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  if (response.ok && result.ok === true) {
    try {
      return parseAiChatImage(result.data)
    } catch {
      throw fail('ai_chat_image_upload_failed')
    }
  }
  if (result.ok === false && typeof result.code === 'string' && /^ai_chat_[a-z_]{1,60}$/.test(result.code)) throw fail(result.code)
  throw fail(codeForStatus(response.status))
}
