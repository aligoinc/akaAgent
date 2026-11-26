import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { CAMPAIGN_SHEET_SYNC_IPC, campaignSheetSyncErrorMessage, type CampaignSheetSyncResult } from '../../../shared/campaignSheetSync'
import { callCampaignSheetSync } from '../../data/repositories/campaignSheetSyncRepository'

/** Đồng bộ Google Sheet vào data chiến dịch (V662). Một kênh nhận payload `{ action, ... }`, trả kết quả, không ném lỗi. */
export function registerCampaignSheetSyncHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(CAMPAIGN_SHEET_SYNC_IPC, async (event: IpcMainInvokeEvent, payload: unknown): Promise<CampaignSheetSyncResult<unknown>> => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      return { ok: false, code: 'sheet_sync_unauthorized', message: campaignSheetSyncErrorMessage('sheet_sync_unauthorized') }
    }
    return callCampaignSheetSync(payload)
  })
}
