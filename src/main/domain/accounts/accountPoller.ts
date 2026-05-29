import { BrowserWindow } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { WebviewRegistry } from '../../playwright/webviewController'
import * as accountRepo from '../../data/repositories/accountRepository'

const AUTO_CHECK_INTERVAL = 30_000

async function checkAccountLogin(accountId: number, wcId: number): Promise<string | null> {
  try {
    const { webContents } = require('electron')
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) return null

    const url = wc.getURL()

    if (url.includes('facebook.com')) {
      const result = await wc.executeJavaScript(`
        (function() {
          try {
            const cookies = document.cookie;
            if (cookies.includes('c_user=')) return { loggedIn: true };
            if (document.querySelector('#checkpoint_title') || window.location.href.includes('checkpoint'))
              return { loggedIn: false, checkpoint: true };
            return { loggedIn: false };
          } catch(e) { return { loggedIn: false }; }
        })()
      `)
      if (result.loggedIn) return 'đã đăng nhập'
      if (result.checkpoint) return 'checkpoint'
      return 'chưa đăng nhập'
    }

    if (url.includes('zalo')) {
      const result = await wc.executeJavaScript(`
        (function() {
          try {
            return !!document.querySelector('[data-id="conversations"]') || !!document.querySelector('.chat-list');
          } catch(e) { return false; }
        })()
      `)
      return result ? 'đã đăng nhập' : 'chưa đăng nhập'
    }

    return null
  } catch {
    return null
  }
}

export function startAccountPoller(webviewRegistry: WebviewRegistry, mainWindow: BrowserWindow): void {
  setInterval(async () => {
    if (!webviewRegistry) return
    const registered = webviewRegistry.listRegistered()
    if (registered.length === 0) return

    let hasChanges = false

    for (const { accountId, connected } of registered) {
      if (!connected) continue
      const wcId = webviewRegistry.getWebContentsId(accountId)
      if (!wcId) continue
      if (!webviewRegistry.isWebContentsForAccount(accountId, wcId)) {
        webviewRegistry.unregister(accountId)
        continue
      }

      try {
        const newStatus = await checkAccountLogin(accountId, wcId)
        if (newStatus) {
          const accounts = await accountRepo.listAccounts()
          const account = accounts.find(a => a.id === accountId)
          if (account && account.loginStatus !== newStatus) {
            await accountRepo.updateAccount(accountId, { loginStatus: newStatus })
            hasChanges = true
            console.log(`[AutoCheck] Account ${accountId}: ${account.loginStatus} -> ${newStatus}`)
          }
        }
      } catch {
        // Silently ignore per-account errors
      }
    }

    if (hasChanges) {
      mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
    }
  }, AUTO_CHECK_INTERVAL)
}
