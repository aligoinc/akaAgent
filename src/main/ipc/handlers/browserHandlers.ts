import { ipcMain, webContents } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { WebviewRegistry } from '../../playwright/webviewController'
import { PageControllerRegistry } from '../../v2/runtime/pageController'

/**
 * Webview register/unregister/status handlers.
 * Each Electron <webview> tag (one per account) registers its webContentsId here
 * so engine v2 can dispatch JS via PageController and the scheduler can verify
 * the tab is still mounted before kicking off a campaign.
 */
export function registerBrowserHandlers(
  webviewRegistry: WebviewRegistry,
  pageRegistry: PageControllerRegistry
): void {
  ipcMain.handle(IPC_EVENTS.WEBVIEW_REGISTER, (_, accountId: number, webContentsId: number) => {
    const registration = webviewRegistry.register(accountId, webContentsId)
    if (!registration.success) {
      pageRegistry.unregister(accountId)
      return registration
    }

    try {
      const wc = webContents.fromId(webContentsId)
      if (wc && !wc.isDestroyed()) {
        wc.setBackgroundThrottling(false)
        // v2 engine: register PageController cùng lúc để workflow v2 dùng được
        pageRegistry.register(accountId, wc)
      }
    } catch {}

    return registration
  })

  ipcMain.handle(IPC_EVENTS.WEBVIEW_UNREGISTER, (_, accountId: number) => {
    webviewRegistry.unregister(accountId)
    pageRegistry.unregister(accountId)
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.WEBVIEW_STATUS, (_, accountId: number) => {
    return { connected: webviewRegistry.isRegistered(accountId) }
  })
}
