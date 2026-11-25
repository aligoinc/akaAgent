import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { emailPromptErrorMessage, type EmailPromptResult } from '../../../shared/emailPrompt'
import { EMAIL_PROMPT_IPC } from '../../../shared/emailPromptDesktop'
import { callEmailPrompt } from '../../data/repositories/emailPromptRepository'

/**
 * Form xin email sau khi đăng nhập (V652, docs/STAFF_EMAIL_PROMPT_PLAN.md mục 5.2). Một kênh nhận `{ action, payload }`
 * (`state` | `dismiss` | `save` | `profile`); tiến trình chính tự gắn `client: 'desktop'`. Trả `EmailPromptResult`, không ném lỗi.
 */
export function registerEmailPromptHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(EMAIL_PROMPT_IPC, async (event: IpcMainInvokeEvent, request: unknown): Promise<EmailPromptResult<unknown>> => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Yêu cầu không hợp lệ.')
    }
    const input = request && typeof request === 'object' && !Array.isArray(request) ? request as Record<string, unknown> : {}
    try {
      return await callEmailPrompt(input.action, input.payload)
    } catch {
      return { ok: false, code: 'unavailable', message: emailPromptErrorMessage('unavailable') }
    }
  })
}
