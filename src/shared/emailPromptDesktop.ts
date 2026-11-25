// Phần riêng của Desktop cho form xin email sau khi đăng nhập (V652, docs/STAFF_EMAIL_PROMPT_PLAN.md mục 5.2).
// `emailPrompt.ts` chép nguyên văn từ akaAgentWebApp `packages/control-api/src/emailPrompt.ts` (sửa ở WebApp trước rồi
// chép lại); tệp này chỉ nối hợp đồng đó với một kênh IPC.

import type {
  EmailPromptProfile,
  EmailPromptResult,
  EmailPromptSaveResult,
  EmailPromptState
} from './emailPrompt'

/** Một kênh duy nhất: renderer gửi `{ action, payload }`, tiến trình chính gọi RPC `aka_agent_email_prompt`. */
export const EMAIL_PROMPT_IPC = 'email-prompt:call'

export const EMAIL_PROMPT_ACTIONS = ['state', 'dismiss', 'save', 'profile'] as const
export type EmailPromptAction = typeof EMAIL_PROMPT_ACTIONS[number]

/** Renderer chỉ gửi phần khách chọn; `client: 'desktop'` do tiến trình chính tự gắn. */
export interface EmailPromptSaveRequest {
  email?: string
  confirm?: boolean
  allowTypo?: boolean
}

export interface EmailPromptActionData {
  state: EmailPromptState
  dismiss: { dismissed: true }
  save: EmailPromptSaveResult
  profile: EmailPromptProfile
}

export type EmailPromptIpcResult<A extends EmailPromptAction> = EmailPromptResult<EmailPromptActionData[A]>

const EMAIL_MAX_CHARS = 320

export type EmailPromptRpcRequest =
  | { ok: true; action: EmailPromptAction; payload: Record<string, unknown> }
  | { ok: false; code: 'invalid_action' | 'email_invalid' }

/**
 * Dựng tham số RPC từ yêu cầu của renderer. Lệnh lạ → `invalid_action`; `save` không có email (hoặc quá dài) và không
 * `confirm` → `email_invalid` (không gọi DB). Chỉ giữ đúng các khóa DB đọc (`client`, `email`, `confirm`, `allowTypo`).
 */
export function buildEmailPromptRpcRequest(action: unknown, payload: unknown): EmailPromptRpcRequest {
  if (typeof action !== 'string' || !(EMAIL_PROMPT_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, code: 'invalid_action' }
  }
  const name = action as EmailPromptAction
  if (name === 'state' || name === 'profile') return { ok: true, action: name, payload: {} }
  if (name === 'dismiss') return { ok: true, action: name, payload: { client: 'desktop' } }
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  if (input.confirm === true) return { ok: true, action: name, payload: { client: 'desktop', confirm: true } }
  const email = typeof input.email === 'string' ? input.email.trim() : ''
  if (!email || email.length > EMAIL_MAX_CHARS) return { ok: false, code: 'email_invalid' }
  return {
    ok: true,
    action: name,
    payload: { client: 'desktop', email, ...(input.allowTypo === true ? { allowTypo: true } : {}) }
  }
}
