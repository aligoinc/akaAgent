import { AI_CHAT_UNAVAILABLE } from '../../../../shared/aiChat'
import { createAiChatIpcTransport } from '../../../../shared/aiChatDesktop'

/** Hỏi đáp AI (V488) trên Desktop: mọi lời gọi đi qua main process tới RPC `aka_agent_ai_chat`. */
export const aiChatTransport = createAiChatIpcTransport(async (action, payload) => {
  const call = window.electronAPI?.aiChatCall
  if (!call) return { ok: false, code: AI_CHAT_UNAVAILABLE, message: 'Trợ lý hỏi đáp chưa sẵn sàng.' }
  return call(action, payload)
})
