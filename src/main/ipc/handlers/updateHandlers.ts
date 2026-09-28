import { ipcMain, BrowserWindow } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { checkForUpdate, downloadAndInstall, getLocalVersion } from '../../services/updater'

export function registerUpdateHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_EVENTS.APP_GET_VERSION, async () => {
    return getLocalVersion()
  })

  ipcMain.handle(IPC_EVENTS.UPDATE_CHECK, async (_event, isStartupCheck?: boolean) => {
    return checkForUpdate(isStartupCheck === true)
  })

  ipcMain.handle(IPC_EVENTS.UPDATE_DOWNLOAD_INSTALL, async () => {
    return downloadAndInstall(mainWindow)
  })
}
