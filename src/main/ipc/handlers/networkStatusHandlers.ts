import { ipcMain, type BrowserWindow } from 'electron'
import { NETWORK_STATUS_IPC } from '../../../shared/networkStatus'
import { probeDesktopBackend } from '../../data/supabaseClient'
import { setNetworkSignalListener } from '../../services/networkStatusSignals'

/** Dòng báo mất mạng: lượt thử kết nối theo yêu cầu của renderer và chuyển tín hiệu request sang cửa sổ chính. */
export function registerNetworkStatusHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(NETWORK_STATUS_IPC.PROBE, () => probeDesktopBackend())
  setNetworkSignalListener(signal => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(NETWORK_STATUS_IPC.REQUEST_SIGNAL, signal)
  })
  mainWindow.once('closed', () => setNetworkSignalListener(null))
}
