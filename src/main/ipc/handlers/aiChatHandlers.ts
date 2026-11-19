import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { AI_CHAT_UNAVAILABLE } from '../../../shared/aiChat'
import {
  AI_CHAT_IMAGE_BASE64_MAX, AI_CHAT_IPC, AiChatDesktopError, isAiChatDesktopAction, type AiChatIpcResult
} from '../../../shared/aiChatDesktop'
import { callAiChat } from '../../data/repositories/aiChatRepository'
import { getCurrentUser } from '../../data/currentUser'
import { resolveMediaStorageSettings } from '../../data/repositories/mediaFileRepository'
import { AiChatImageService } from '../../services/aiChatImageService'
import { mediaStorageService, type ResolvedMediaStorageSettings } from '../../services/mediaStorageService'

const MAX_PAYLOAD_CHARS = 64_000

/**
 * Ảnh đính kèm câu hỏi: cất vào kho media của hệ thống bằng đúng cấu hình và đường ghi của thư viện media (không pool,
 * không kết nối giữ lâu, không hẹn giờ). Tệp ảnh là bất biến (tên là UUID) nên cho trình duyệt giữ lâu.
 */
const aiChatImages = new AiChatImageService<ResolvedMediaStorageSettings>({
  identity: () => {
    const user = getCurrentUser()
    return user ? { staffId: user.staffId, organizationId: user.organizationId } : null
  },
  settings: () => resolveMediaStorageSettings(),
  put: (settings, input) => mediaStorageService.uploadBuffer(settings, { ...input, cacheControl: 'public, max-age=31536000, immutable' })
})

function toIpcFailure(error: unknown, label: string): AiChatIpcResult {
  if (error instanceof AiChatDesktopError) return { ok: false, code: error.code, message: error.message }
  console.warn(`[ai-chat] ${label} unexpected failure: ${error instanceof Error ? error.name : typeof error}`)
  const failure = new AiChatDesktopError(AI_CHAT_UNAVAILABLE)
  return { ok: false, code: failure.code, message: failure.message }
}

/**
 * Hỏi đáp AI (V488). Trả `AiChatIpcResult` thay vì ném lỗi để renderer phân nhánh theo mã (`ai_chat_not_ready` → ẩn mục hỏi đáp).
 * RPC tự kiểm quyền và dữ liệu; ở đây chỉ chặn action lạ, payload quá lớn và ảnh không phải của phiên đang đăng nhập.
 */
export function registerAiChatHandlers(mainWindow: BrowserWindow): void {
  const assertSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Không có quyền truy cập trợ lý.')
    }
  }

  ipcMain.handle(AI_CHAT_IPC.call, async (event: IpcMainInvokeEvent, action: unknown, payload: unknown): Promise<AiChatIpcResult> => {
    assertSender(event)
    try {
      if (!isAiChatDesktopAction(action) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new AiChatDesktopError('ai_chat_invalid_request')
      }
      if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) throw new AiChatDesktopError('ai_chat_invalid_request')
      return { ok: true, data: await aiChatImages.call(action, payload as Record<string, unknown>, callAiChat) }
    } catch (error) {
      return toIpcFailure(error, 'call')
    }
  })

  // Một ảnh mỗi lượt gọi (base64 của tối đa 5 MB); dịch vụ kiểm định dạng thật, dung lượng và nhịp tải rồi mới ghi kho.
  ipcMain.handle(AI_CHAT_IPC.uploadImage, async (event: IpcMainInvokeEvent, image: unknown): Promise<AiChatIpcResult> => {
    assertSender(event)
    try {
      const data = image && typeof image === 'object' && !Array.isArray(image) ? (image as Record<string, unknown>).dataBase64 : null
      if (typeof data === 'string' && data.length > AI_CHAT_IMAGE_BASE64_MAX) throw new AiChatDesktopError('ai_chat_image_too_large')
      return { ok: true, data: await aiChatImages.upload(image) }
    } catch (error) {
      return toIpcFailure(error, 'upload-image')
    }
  })
}
