import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  ENGINE_ERROR_REVIEW_ACTIONS, ENGINE_ERROR_REVIEW_IPC, EngineErrorReviewError,
  parseEngineErrorCase, parseEngineErrorDecision, parseEngineErrorList, sanitizeEngineErrorReviewPayload,
  type EngineErrorCaseResponse, type EngineErrorDecision, type EngineErrorList,
  type EngineErrorReviewAction, type EngineErrorReviewIpcResult
} from '../../../shared/engineErrorReview'
import { callEngineErrorReview } from '../../data/repositories/engineErrorReviewRepository'

type EngineErrorReviewData = EngineErrorList | EngineErrorCaseResponse | EngineErrorDecision

/**
 * Tab "Lỗi không xác định" (V588, admin akaBiz). Một kênh, trả `EngineErrorReviewIpcResult` thay vì ném lỗi.
 * Chỉ đọc DB khi admin mở tab hoặc bấm nút; không hẹn giờ.
 */
export function registerEngineErrorReviewHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(
    ENGINE_ERROR_REVIEW_IPC.call,
    async (event: IpcMainInvokeEvent, action: unknown, payload: unknown): Promise<EngineErrorReviewIpcResult<EngineErrorReviewData>> => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('Yêu cầu không hợp lệ.')
      }
      try {
        if (!(ENGINE_ERROR_REVIEW_ACTIONS as readonly unknown[]).includes(action)) throw new EngineErrorReviewError('bad_action')
        const name = action as EngineErrorReviewAction
        const clean = sanitizeEngineErrorReviewPayload(name, payload)
        if (!clean) throw new EngineErrorReviewError(name === 'mark' ? 'bad_status' : name === 'case' ? 'case_required' : 'bad_decision')
        const raw = await callEngineErrorReview(name, clean)
        const data = name === 'list' ? parseEngineErrorList(raw) : name === 'case' ? parseEngineErrorCase(raw) : parseEngineErrorDecision(raw)
        return { ok: true, data }
      } catch (error) {
        const failure = error instanceof EngineErrorReviewError ? error : new EngineErrorReviewError('unavailable')
        if (!(error instanceof EngineErrorReviewError)) {
          console.warn(`[EngineErrorReview] unexpected failure: ${error instanceof Error ? error.name : typeof error}`)
        }
        return { ok: false, code: failure.code, message: failure.message }
      }
    }
  )
}
