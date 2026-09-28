import { ipcMain, type BrowserWindow } from 'electron'
import { SEND_EXCLUSION_IPC, type SaveSendExclusionGroup } from '../../../shared/campaignSendExclusion'
import { listSendExclusionGroups, saveSendExclusionGroup } from '../../data/repositories/campaignSendExclusionRepository'

export function registerSendExclusionHandlers(window: BrowserWindow): void {
  const check = (event: Electron.IpcMainInvokeEvent, id: number) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !Number.isSafeInteger(id) || id <= 0) throw new Error('Yêu cầu không hợp lệ.')
  }
  ipcMain.handle(SEND_EXCLUSION_IPC.page, (event, id: number) => { check(event, id); return listSendExclusionGroups(id) })
  ipcMain.handle(SEND_EXCLUSION_IPC.save, (event, group: SaveSendExclusionGroup) => { check(event, group?.accountId); return saveSendExclusionGroup(group) })
}
