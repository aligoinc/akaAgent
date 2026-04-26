import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { PlaywrightController } from '../../playwright/controller'
import { WebviewRegistry } from '../../playwright/webviewController'
import { PageControllerRegistry } from '../../v2/runtime/pageController'
import { getPlaywrightController, setPlaywrightController } from './flowHandlers'

export function registerBrowserHandlers(
  webviewRegistry: WebviewRegistry,
  pageRegistry: PageControllerRegistry
): void {
  ipcMain.handle(IPC_CHANNELS.BROWSER_LAUNCH, async (_, options?: { headless?: boolean; profileName?: string }) => {
    let ctrl = getPlaywrightController()
    if (!ctrl) {
      ctrl = new PlaywrightController()
      setPlaywrightController(ctrl)
    }
    await ctrl.launch(options?.headless ?? false, options?.profileName ?? 'default')
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLOSE, async () => {
    const ctrl = getPlaywrightController()
    if (ctrl) {
      await ctrl.close()
      setPlaywrightController(null)
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_STATUS, () => {
    return { connected: getPlaywrightController()?.isConnected() ?? false }
  })

  ipcMain.handle(IPC_CHANNELS.WEBVIEW_REGISTER, (_, channelId: number, webContentsId: number) => {
    webviewRegistry.register(channelId, webContentsId)

    try {
      const { webContents } = require('electron')
      const wc = webContents.fromId(webContentsId)
      if (wc && !wc.isDestroyed()) {
        wc.setBackgroundThrottling(false)
        // v2 engine: register PageController cùng lúc để workflow v2 dùng được
        pageRegistry.register(channelId, wc)
      }
    } catch {}

    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.WEBVIEW_UNREGISTER, (_, channelId: number) => {
    webviewRegistry.unregister(channelId)
    pageRegistry.unregister(channelId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.WEBVIEW_STATUS, (_, channelId: number) => {
    return { connected: webviewRegistry.isRegistered(channelId) }
  })
}
