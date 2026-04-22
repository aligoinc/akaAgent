import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { checkForUpdate, downloadAndInstall } from '../../services/updater'

export function registerUpdateHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    return checkForUpdate()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD_INSTALL, async () => {
    return downloadAndInstall(mainWindow)
  })
}
