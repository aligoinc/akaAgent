import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { CAMPAIGN_TYPE_VISIBILITY_IPC, type CampaignVisibilityChange } from '../../../shared/campaignTypeVisibility'
import { getCampaignTypeVisibility, patchCampaignTypeVisibility } from '../../data/repositories/campaignTypeVisibilityRepository'

export function registerCampaignTypeVisibilityHandlers(mainWindow: BrowserWindow): void {
  const assertSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Không có quyền truy cập cài đặt.')
    }
  }
  ipcMain.handle(CAMPAIGN_TYPE_VISIBILITY_IPC.get, (event, includeCatalog = false) => {
    assertSender(event)
    if (typeof includeCatalog !== 'boolean') throw new Error('Yêu cầu không hợp lệ.')
    return getCampaignTypeVisibility(includeCatalog)
  })
  ipcMain.handle(CAMPAIGN_TYPE_VISIBILITY_IPC.patch, (event, changes: CampaignVisibilityChange[]) => {
    assertSender(event)
    return patchCampaignTypeVisibility(changes)
  })
}
