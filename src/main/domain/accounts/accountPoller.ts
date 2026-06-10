import { BrowserWindow, webContents } from 'electron'
import { AutoAccount, IPC_EVENTS } from '../../../shared/types'
import { WebviewRegistry } from '../../playwright/webviewController'
import * as accountRepo from '../../data/repositories/accountRepository'
import { getCurrentUser } from '../../data/currentUser'
import type { ZaloRuntimeService } from '../../services/zaloRuntimeService'

const AUTO_CHECK_INTERVAL = 30_000
const ZALO_AUTO_CHECK_INTERVAL = 30 * 60 * 1000

async function checkAccountLogin(accountId: number, wcId: number): Promise<string | null> {
  try {
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

    return null
  } catch {
    return null
  }
}

async function checkFacebookWebviewAccounts(
  accounts: AutoAccount[],
  webviewRegistry: WebviewRegistry
): Promise<boolean> {
  const registered = webviewRegistry.listRegistered()
  if (registered.length === 0) return false

  let hasChanges = false
  for (const { accountId, connected } of registered) {
    if (!connected) continue
    const wcId = webviewRegistry.getWebContentsId(accountId)
    if (!wcId) continue

    try {
      const newStatus = await checkAccountLogin(accountId, wcId)
      if (!newStatus) continue

      const account = accounts.find(a => a.id === accountId)
      if (account && account.loginStatus !== newStatus) {
        await accountRepo.updateAccount(accountId, { loginStatus: newStatus })
        hasChanges = true
        console.log(`[AutoCheck] Account ${accountId}: ${account.loginStatus} -> ${newStatus}`)
      }
    } catch {
      // Silently ignore per-account errors
    }
  }
  return hasChanges
}

async function checkZaloApiAccounts(
  accounts: AutoAccount[],
  zaloRuntime?: ZaloRuntimeService
): Promise<boolean> {
  if (!zaloRuntime) return false
  let hasChanges = false
  for (const account of accounts) {
    if (account.flatformType !== 'zalo' || !account.hasZaloSession || account.loginStatus !== 'đã đăng nhập') continue

    try {
      const result = await zaloRuntime.checkSession(account.id)
      const newStatus = result.account?.loginStatus || result.status
      if (newStatus && account.loginStatus !== newStatus) {
        hasChanges = true
        console.log(`[AutoCheck] Zalo account ${account.id}: ${account.loginStatus} -> ${newStatus}`)
      } else if (result.success) {
        hasChanges = true
      }
    } catch (err) {
      console.warn('[AutoCheck] Failed to check Zalo account login status:', {
        accountId: account.id,
        err
      })
    }
  }
  return hasChanges
}

export function startAccountPoller(
  webviewRegistry: WebviewRegistry,
  mainWindow: BrowserWindow,
  zaloRuntime?: ZaloRuntimeService
): void {
  let isRunning = false
  let lastZaloAutoCheckAt = Date.now()
  let lastStaffId: number | null = null

  setInterval(async () => {
    const user = getCurrentUser()
    if (isRunning || !user) return
    isRunning = true

    try {
      if (lastStaffId !== user.staffId) {
        lastStaffId = user.staffId
        lastZaloAutoCheckAt = Date.now()
      }

      const accounts = await accountRepo.listAccounts()
      const hasFacebookChanges = await checkFacebookWebviewAccounts(accounts, webviewRegistry)
      const now = Date.now()
      const shouldCheckZalo = now - lastZaloAutoCheckAt >= ZALO_AUTO_CHECK_INTERVAL
      const hasZaloChanges = shouldCheckZalo
        ? await checkZaloApiAccounts(accounts, zaloRuntime)
        : false
      if (shouldCheckZalo) lastZaloAutoCheckAt = now
      if (hasFacebookChanges || hasZaloChanges) {
        mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
      }
    } finally {
      isRunning = false
    }
  }, AUTO_CHECK_INTERVAL)
}
