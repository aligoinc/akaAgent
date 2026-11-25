import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'
import {
  emailPromptErrorMessage,
  parseEmailPromptDismiss,
  parseEmailPromptProfile,
  parseEmailPromptSave,
  parseEmailPromptState,
  type EmailPromptErrorCode,
  type EmailPromptResult
} from '../../../shared/emailPrompt'
import { buildEmailPromptRpcRequest, type EmailPromptAction } from '../../../shared/emailPromptDesktop'

const client = () => getSupabaseClient()
const EMAIL_PROMPT_TIMEOUT_MS = 15_000

const failure = (code: EmailPromptErrorCode): EmailPromptResult<never> => ({ ok: false, code, message: emailPromptErrorMessage(code) })

const PARSERS: Record<EmailPromptAction, (raw: unknown) => EmailPromptResult<unknown>> = {
  state: parseEmailPromptState,
  dismiss: parseEmailPromptDismiss,
  save: parseEmailPromptSave,
  profile: parseEmailPromptProfile
}

/**
 * Form xin email sau khi đăng nhập (V652): `aka_agent_email_prompt(p_action, p_payload)`, nhân viên lấy từ phiên Desktop.
 * Một lượt RPC mỗi lần gọi, không cache, không thử lại. Không ném lỗi: lệnh lạ → `invalid_action`, chưa đăng nhập →
 * `no_session`, DB chưa có hàm (PGRST202 / 42883) → `not_installed`, lỗi mạng / hết giờ / dữ liệu sai dạng → `unavailable`.
 */
export async function callEmailPrompt(action: unknown, payload?: unknown): Promise<EmailPromptResult<unknown>> {
  const request = buildEmailPromptRpcRequest(action, payload)
  if (!request.ok) return failure(request.code)
  try {
    requireCurrentUser()
  } catch {
    return failure('no_session')
  }
  try {
    const { data, error } = await client()
      .rpc('aka_agent_email_prompt', { p_action: request.action, p_payload: request.payload })
      .abortSignal(AbortSignal.timeout(EMAIL_PROMPT_TIMEOUT_MS))
    if (error) {
      const code = typeof error.code === 'string' ? error.code : ''
      if (code === 'PGRST202' || code === '42883') return failure('not_installed')
      console.warn(`[EmailPrompt] ${request.action} thất bại:`, code || 'unknown')
      return failure('unavailable')
    }
    return PARSERS[request.action](data)
  } catch (error) {
    console.warn(`[EmailPrompt] ${request.action} thất bại:`, error instanceof Error ? error.name : typeof error)
    return failure('unavailable')
  }
}
