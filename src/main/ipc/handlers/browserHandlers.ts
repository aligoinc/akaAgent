import { ipcMain, webContents, type WebContents } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { WebviewRegistry } from '../../playwright/webviewController'
import { PageControllerRegistry } from '../../v2/runtime/pageController'

export interface BrowserWebviewLifecycleHooks {
  onRegister?: (
    accountId: number,
    webContents: WebContents,
    platformType?: string
  ) => void | Promise<void>
  onUnregister?: (accountId: number, webContents: WebContents | null) => void | Promise<void>
}

/**
 * Webview register/unregister/status handlers.
 * Zalo Web uses the same persistent account partition and registration flow as
 * Facebook; the optional hook only lets its API runtime observe that webview.
 */
export function registerBrowserHandlers(
  webviewRegistry: WebviewRegistry,
  pageRegistry: PageControllerRegistry,
  lifecycleHooks: BrowserWebviewLifecycleHooks = {}
): void {
  ipcMain.handle(IPC_EVENTS.WEBVIEW_REGISTER, async (
    _,
    accountId: number,
    webContentsId: number,
    platformType?: string
  ) => {
    const wc = webContents.fromId(webContentsId)
    if (!wc || wc.isDestroyed()) throw new Error('Tab trình duyệt không khả dụng')

    webviewRegistry.register(accountId, webContentsId)
    wc.setBackgroundThrottling(false)
    pageRegistry.register(accountId, wc)

    try {
      await lifecycleHooks.onRegister?.(accountId, wc, platformType)
    } catch (error) {
      webviewRegistry.unregister(accountId)
      pageRegistry.unregister(accountId)
      throw error
    }

    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.WEBVIEW_UNREGISTER, async (_, accountId: number) => {
    const webContentsId = webviewRegistry.getWebContentsId(accountId)
    const wc = webContentsId ? (webContents.fromId(webContentsId) || null) : null
    await lifecycleHooks.onUnregister?.(accountId, wc)
    webviewRegistry.unregister(accountId)
    pageRegistry.unregister(accountId)
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.WEBVIEW_STATUS, (_, accountId: number) => {
    return { connected: webviewRegistry.isRegistered(accountId) }
  })
}
