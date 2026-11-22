import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  CAMPAIGN_RESULT_GROUPS_IPC, CAMPAIGN_RESULT_GROUPS_UNAVAILABLE, CampaignResultGroupsDesktopError,
  isCampaignResultGroupsDesktopAction, type CampaignResultGroupsIpcResult
} from '../../../shared/campaignResultGroupsDesktop'
import { getCurrentUser } from '../../data/currentUser'
import { desktopSession } from '../../data/supabaseClient'
import { CAMPAIGN_RESULT_GROUPS_API_URL, callCampaignResultGroupsApi } from '../../services/campaignResultGroupsApi'

const MAX_PAYLOAD_CHARS = 32_000

/**
 * Khung "Sau khi chạy: đưa khách vào nhóm" và thẻ Tự động hóa › Từ chiến dịch. Một kênh, trả kết quả thay vì ném lỗi để
 * renderer phân nhánh theo mã (`campaign_result_groups_not_ready` → ẩn khung). Nhân viên / tổ chức do API lấy từ token phiên.
 */
export function registerCampaignResultGroupsHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(CAMPAIGN_RESULT_GROUPS_IPC, async (event: IpcMainInvokeEvent, action: unknown, payload: unknown): Promise<CampaignResultGroupsIpcResult> => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      return { ok: false, code: 'access_denied', message: 'Không có quyền truy cập.' }
    }
    try {
      if (!getCurrentUser()) throw new CampaignResultGroupsDesktopError('access_denied')
      if (!isCampaignResultGroupsDesktopAction(action) || (payload !== undefined && JSON.stringify(payload).length > MAX_PAYLOAD_CHARS)) {
        throw new CampaignResultGroupsDesktopError('campaign_result_groups_invalid_request')
      }
      const data = await callCampaignResultGroupsApi({
        url: CAMPAIGN_RESULT_GROUPS_API_URL, token: signal => desktopSession.token(signal), fetch: (...args) => fetch(...args)
      }, action, payload)
      return { ok: true, data }
    } catch (error) {
      if (error instanceof CampaignResultGroupsDesktopError) return { ok: false, code: error.code, message: error.message }
      console.warn(`[campaign-result-groups] ${String(action)} unexpected failure: ${error instanceof Error ? error.name : typeof error}`)
      const failure = new CampaignResultGroupsDesktopError(CAMPAIGN_RESULT_GROUPS_UNAVAILABLE)
      return { ok: false, code: failure.code, message: failure.message }
    }
  })
}
