import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { BROWSER_RUN_LIMITS_IPC, type BrowserRunLimits } from '../../../shared/browserRunLimits'
import { getBrowserRunLimits, saveBrowserRunLimits } from '../../data/repositories/browserRunLimitsRepository'

export function registerBrowserRunLimitsHandlers(mainWindow: BrowserWindow): void {
  const assertSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Không có quyền truy cập cài đặt.')
    }
  }
  ipcMain.handle(BROWSER_RUN_LIMITS_IPC.get, event => {
    assertSender(event)
    return getBrowserRunLimits()
  })
  ipcMain.handle(BROWSER_RUN_LIMITS_IPC.save, (event, settings: BrowserRunLimits) => {
    assertSender(event)
    return saveBrowserRunLimits(settings)
  })
}
