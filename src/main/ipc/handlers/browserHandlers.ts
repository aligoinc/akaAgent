import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { WebviewRegistry } from '../../playwright/webviewController'
import { PageControllerRegistry } from '../../v2/runtime/pageController'

/**
 * Webview register/unregister/status handlers.
 * Each Electron <webview> tag (one per channel) registers its webContentsId here
 * so engine v2 can dispatch JS via PageController and the scheduler can verify
 * the tab is still mounted before kicking off a campaign.
 */
export function registerBrowserHandlers(
  webviewRegistry: WebviewRegistry,
  pageRegistry: PageControllerRegistry
): void {
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
