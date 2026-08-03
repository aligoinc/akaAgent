import { BrowserWindow, webContents } from 'electron'
import { AutoAccount, IPC_EVENTS } from '../../../shared/types'
import { WebviewRegistry } from '../../playwright/webviewController'
import * as accountRepo from '../../data/repositories/accountRepository'
import { getCurrentUser } from '../../data/currentUser'
import {
  getZaloRuntimeRestartRequired,
  isZaloLocalStartupHandoffBlocked
} from '../../data/repositories/zaloRuntimeModeRepository'
import type { ZaloRuntimeService } from '../../services/zaloRuntimeService'

const AUTO_CHECK_INTERVAL = 30_000
const ZALO_AUTO_CHECK_INTERVAL = 30 * 60 * 1000
const ZALO_WEB_AUTH_COOKIE_NAMES = ['zpsid', 'zpw_sek'] as const

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

async function hasZaloWebAuthenticationCookies(wcId: number): Promise<boolean | null> {
  const wc = webContents.fromId(wcId)
  if (!wc || wc.isDestroyed()) return null
  const cookies = await wc.session.cookies.get({ url: 'https://chat.zalo.me/' })
  const names = new Set(
    cookies
      .filter(cookie => String(cookie.value || '').length > 0)
      .map(cookie => cookie.name.toLowerCase())
  )
  return ZALO_WEB_AUTH_COOKIE_NAMES.every(name => names.has(name))
}

async function checkZaloWebviewAccounts(
  accounts: AutoAccount[],
  webviewRegistry: WebviewRegistry,
  zaloRuntime: ZaloRuntimeService | undefined,
  canContinue: () => boolean
): Promise<boolean> {
  if (!zaloRuntime) return false
  const accountById = new Map(accounts.map(account => [account.id, account]))
  let hasChanges = false

  for (const { accountId, connected } of webviewRegistry.listRegistered()) {
    if (!canContinue()) break
    if (!connected) continue
    const account = accountById.get(accountId)
    if (
      account?.flatformType !== 'zalo' ||
      !account.isZaloShowWeb ||
      account.loginStatus !== 'đã đăng nhập'
    ) continue
    const wcId = webviewRegistry.getWebContentsId(accountId)
    if (!wcId) continue

    try {
      const hasAuthCookies = await hasZaloWebAuthenticationCookies(wcId)
      if (hasAuthCookies !== false || !canContinue()) continue
      zaloRuntime.invalidateWebSession(accountId)
      await accountRepo.markAccountZaloSessionCheck(accountId, {
        ok: false,
        error: 'Zalo Web đã đăng xuất'
      }, true)
      hasChanges = true
      console.log(`[AutoCheck] Zalo Web account ${accountId}: đã đăng nhập -> chưa đăng nhập`)
    } catch (err) {
      console.warn('[AutoCheck] Failed to check Zalo Web login cookies:', { accountId, err })
    }
  }

  return hasChanges
}

async function checkZaloApiAccounts(
  accounts: AutoAccount[],
  zaloRuntime: ZaloRuntimeService | undefined,
  canContinue: () => boolean,
  canReleaseClaim: () => boolean
): Promise<boolean> {
  if (!zaloRuntime) return false
  let hasChanges = false
  for (const account of accounts) {
    if (!canContinue()) break
    if (account.flatformType !== 'zalo' || account.loginStatus !== 'đã đăng nhập') continue
    if (account.isZaloServer) continue
    if (account.isZaloShowWeb) {
      if (!zaloRuntime.hasVerifiedWebSession(account.id)) continue
    } else if (!account.hasZaloSession) {
      continue
    }

    try {
      const claim = await accountRepo.claimZaloAccountRuntimeOperation(account.id, 'desktop', true)
      if (!claim.claimed || !claim.previousStatus) continue
      let result: Awaited<ReturnType<ZaloRuntimeService['checkSession']>>
      try {
        if (!canContinue()) continue
        result = await zaloRuntime.checkSession(account.id)
      } finally {
        if (canReleaseClaim()) {
          await accountRepo.releaseZaloAccountRuntimeOperation(account.id, 'desktop', claim.previousStatus)
        }
      }
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

export interface AccountPollerController {
  blockZaloRuntime(): void
  resetZaloRuntimeBlock(): void
  waitForZaloIdle(timeoutMs?: number): Promise<boolean>
  abandonZaloClaims(): void
  resetZaloClaims(): void
}

export function startAccountPoller(
  webviewRegistry: WebviewRegistry,
  mainWindow: BrowserWindow,
  zaloRuntime?: ZaloRuntimeService
): AccountPollerController {
  let isRunning = false
  let zaloRuntimeBlocked = false
  let zaloClaimsAbandoned = false
  let activeZaloCheck: Promise<boolean> | null = null
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
      const canCheckZalo = !getZaloRuntimeRestartRequired() &&
        !isZaloLocalStartupHandoffBlocked()
      const shouldCheckZaloWeb = canCheckZalo && accounts.some(account => (
        account.flatformType === 'zalo' && account.isZaloShowWeb
      ))
      const shouldCheckZaloApi = canCheckZalo &&
        now - lastZaloAutoCheckAt >= ZALO_AUTO_CHECK_INTERVAL
      let hasZaloChanges = false
      if ((shouldCheckZaloWeb || shouldCheckZaloApi) && !zaloRuntimeBlocked) {
        const canContinue = () => !zaloRuntimeBlocked && !zaloClaimsAbandoned
        const operation = (async () => {
          let changed = false
          if (shouldCheckZaloWeb) {
            changed = await checkZaloWebviewAccounts(
              accounts,
              webviewRegistry,
              zaloRuntime,
              canContinue
            )
          }
          if (shouldCheckZaloApi && canContinue()) {
            changed = await checkZaloApiAccounts(
              accounts,
              zaloRuntime,
              canContinue,
              () => !zaloClaimsAbandoned
            ) || changed
          }
          return changed
        })()
        activeZaloCheck = operation
        try {
          hasZaloChanges = await operation
        } finally {
          if (activeZaloCheck === operation) activeZaloCheck = null
        }
      }
      if (shouldCheckZaloApi) lastZaloAutoCheckAt = now
      if (hasFacebookChanges || hasZaloChanges) {
        mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
      }
    } finally {
      isRunning = false
    }
  }, AUTO_CHECK_INTERVAL)

  return {
    blockZaloRuntime(): void {
      zaloRuntimeBlocked = true
    },
    resetZaloRuntimeBlock(): void {
      zaloRuntimeBlocked = false
    },
    abandonZaloClaims(): void {
      zaloClaimsAbandoned = true
    },
    resetZaloClaims(): void {
      zaloClaimsAbandoned = false
    },
    async waitForZaloIdle(timeoutMs = 30_000): Promise<boolean> {
      const pending = activeZaloCheck
      if (!pending) return true
      return await Promise.race([
        pending.then(() => true, () => true),
        new Promise<false>(resolve => setTimeout(() => resolve(false), Math.max(0, timeoutMs)))
      ])
    }
  }
}
