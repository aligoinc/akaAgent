import { ipcMain, BrowserWindow } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { checkForUpdate, downloadAndInstall } from '../../services/updater'

export function registerUpdateHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_EVENTS.UPDATE_CHECK, async () => {
    return checkForUpdate()
  })

  ipcMain.handle(IPC_EVENTS.UPDATE_DOWNLOAD_INSTALL, async () => {
    return downloadAndInstall(mainWindow)
  })
}
