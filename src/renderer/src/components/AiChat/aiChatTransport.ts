import { AI_CHAT_UNAVAILABLE } from '../../../../shared/aiChat'
import { createAiChatIpcTransport, type AiChatIpcResult } from '../../../../shared/aiChatDesktop'

const unavailable = (): AiChatIpcResult => ({ ok: false, code: AI_CHAT_UNAVAILABLE, message: 'Trợ lý hỏi đáp chưa sẵn sàng.' })

/**
 * Hỏi đáp AI (V488) trên Desktop: mọi lời gọi đi qua main process tới RPC `aka_agent_ai_chat`. Ảnh đính kèm câu hỏi cũng đi qua
 * main process (kênh riêng): main cất ảnh vào kho media của hệ thống rồi trả URL.
 */
export const aiChatTransport = createAiChatIpcTransport(async (action, payload) => {
  const call = window.electronAPI?.aiChatCall
  return call ? call(action, payload) : unavailable()
}, async image => {
  const upload = window.electronAPI?.aiChatUploadImage
  return upload ? upload(image) : unavailable()
})
