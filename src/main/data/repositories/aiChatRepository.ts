import { AI_CHAT_NOT_READY, AI_CHAT_UNAVAILABLE } from '../../../shared/aiChat'
import { AiChatDesktopError, type AiChatDesktopAction } from '../../../shared/aiChatDesktop'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

// Hỏi đáp AI (V488): một RPC Desktop `aka_agent_ai_chat`, staff/tổ chức lấy từ phiên đăng nhập, đi qua Supabase
// client sẵn có (không thêm pool/kết nối). Hợp đồng: akaAgentWebApp docs/AI_CHAT.md.
const RPC_TIMEOUT_MS = 15_000

/**
 * Không chuyển SQL/chi tiết PostgREST sang renderer: chỉ giữ mã `ai_chat_*`. RPC chưa có (PGRST202/42883) thành
 * `ai_chat_not_ready` để renderer ẩn mục hỏi đáp.
 */
export function toAiChatDesktopError(error: { message?: unknown; code?: unknown } | null | undefined): AiChatDesktopError {
  const sqlState = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  if (sqlState === 'PGRST202' || sqlState === '42883') return new AiChatDesktopError(AI_CHAT_NOT_READY)
  // Mã do RPC tự RAISE (vd. `ai_chat_message_pending`); bỏ qua tên hàm `aka_agent_ai_chat*` trong lỗi quyền/PostgREST.
  const code = /(?:^|[^a-z_])(ai_chat_[a-z_]+)/.exec(message)?.[1]
  if (code) return new AiChatDesktopError(code)
  if (/automation_auth_(?:required|invalid)|desktop_[a-z_]+_denied/.test(message)) return new AiChatDesktopError('ai_chat_access_denied')
  return new AiChatDesktopError(AI_CHAT_UNAVAILABLE)
}

export async function callAiChat(action: AiChatDesktopAction, payload: Record<string, unknown>): Promise<unknown> {
  let user: ReturnType<typeof requireCurrentUser>
  let credentials: ReturnType<typeof requireCurrentUserCredentials>
  try {
    user = requireCurrentUser()
    credentials = requireCurrentUserCredentials()
  } catch {
    throw new AiChatDesktopError('ai_chat_access_denied')
  }
  let result: { data: unknown; error: { message?: unknown; code?: unknown } | null }
  try {
    result = await getSupabaseClient().rpc('aka_agent_ai_chat', {
      p_staff_id: user.staffId,
      p_organization_id: user.organizationId,
      p_auth_username: credentials.username,
      p_auth_password: credentials.password,
      p_action: action,
      p_payload: payload
    }).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
  } catch (error) {
    // Lỗi ném ra từ client (mạng, hủy): chỉ lấy tên lỗi để phân loại, không chuyển nội dung đi.
    result = { data: null, error: { message: error instanceof Error ? error.name : '', code: '' } }
  }
  // Đổi tài khoản trong lúc chờ: không trả hội thoại của phiên cũ cho phiên mới.
  const current = getCurrentUser()
  if (current?.staffId !== user.staffId || current.organizationId !== user.organizationId
    || getCurrentUserCredentials() !== credentials) {
    throw new AiChatDesktopError(AI_CHAT_UNAVAILABLE)
  }
  if (result.error) {
    const failure = toAiChatDesktopError(result.error)
    if (failure.code !== AI_CHAT_NOT_READY) {
      const sqlState = typeof result.error.code === 'string' && result.error.code ? ` (${result.error.code})` : ''
      console.warn(`[ai-chat] ${action} failed: ${failure.code}${sqlState}`)
    }
    throw failure
  }
  return result.data
}
