import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { AI_CHAT_UNAVAILABLE } from '../../../shared/aiChat'
import { AI_CHAT_IPC, AiChatDesktopError, isAiChatDesktopAction, type AiChatIpcResult } from '../../../shared/aiChatDesktop'
import { callAiChat } from '../../data/repositories/aiChatRepository'

const MAX_PAYLOAD_CHARS = 64_000

/**
 * Hỏi đáp AI (V488). Một kênh, trả `AiChatIpcResult` thay vì ném lỗi để renderer phân nhánh theo mã
 * (`ai_chat_not_ready` → ẩn mục hỏi đáp). RPC tự kiểm quyền và dữ liệu; ở đây chỉ chặn action lạ và payload quá lớn.
 */
export function registerAiChatHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(AI_CHAT_IPC.call, async (event: IpcMainInvokeEvent, action: unknown, payload: unknown): Promise<AiChatIpcResult> => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Không có quyền truy cập trợ lý.')
    }
    try {
      if (!isAiChatDesktopAction(action) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new AiChatDesktopError('ai_chat_invalid_request')
      }
      if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) throw new AiChatDesktopError('ai_chat_invalid_request')
      return { ok: true, data: await callAiChat(action, payload as Record<string, unknown>) }
    } catch (error) {
      if (error instanceof AiChatDesktopError) return { ok: false, code: error.code, message: error.message }
      console.warn(`[ai-chat] unexpected failure: ${error instanceof Error ? error.name : typeof error}`)
      const failure = new AiChatDesktopError(AI_CHAT_UNAVAILABLE)
      return { ok: false, code: failure.code, message: failure.message }
    }
  })
}
