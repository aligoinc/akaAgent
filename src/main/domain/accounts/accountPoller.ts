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
import type { FacebookLoginService } from '../../services/facebookLoginService'
import { accountOperationRegistry } from '../../services/accountOperationRegistry'

const AUTO_CHECK_INTERVAL = 30_000
const ZALO_AUTO_CHECK_INTERVAL = 30 * 60 * 1000
const ZALO_WEB_AUTH_COOKIE_NAMES = ['zpsid', 'zpw_sek'] as const

// Existing visible-tab check for accounts created manually. Keep its original
// cookie/DOM rules; HTTP verification belongs to the automatic-import accounts.
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
  webviewRegistry: WebviewRegistry,
  facebookLogin?: FacebookLoginService
): Promise<boolean> {
  const registered = webviewRegistry.listRegistered()
  if (registered.length === 0) return false

  let hasChanges = false
  for (const { accountId, connected } of registered) {
    if (!connected) continue
    const wcId = webviewRegistry.getWebContentsId(accountId)
    if (!wcId) continue

    try {
      const account = accounts.find(a => a.id === accountId)
      if (account?.flatformType === 'facebook' && facebookLogin?.isLoggingIn(accountId)) continue
      if (account?.flatformType === 'facebook' && account.facebookLoginManaged) {
        const wc = webContents.fromId(wcId)
        if (facebookLogin && wc && !wc.isDestroyed()) hasChanges = await facebookLogin.observe(account, wc) || hasChanges
        continue
      }
      const newStatus = await checkAccountLogin(accountId, wcId)
      if (newStatus && account && account.loginStatus !== newStatus) {
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
  if (!wc || wc.isDestroyed() || wc.isCrashed()) return null
  const cookies = await wc.session.cookies.get({ url: 'https://chat.zalo.me/' })
  const names = new Set(
    cookies
      .filter(cookie => String(cookie.value || '').length > 0)
      .map(cookie => cookie.name.toLowerCase())
  )
  if (wc.isDestroyed() || wc.isCrashed()) return null
  if (ZALO_WEB_AUTH_COOKIE_NAMES.every(name => names.has(name))) return true
  return wc.isLoadingMainFrame() ? null : false
}

async function checkZaloWebviewAccounts(
  accounts: AutoAccount[],
  webviewRegistry: WebviewRegistry,
  zaloRuntime: ZaloRuntimeService | undefined,
  canContinue: () => boolean,
  startRecovery: (account: AutoAccount) => boolean
): Promise<boolean> {
  if (!zaloRuntime) return false
  const accountById = new Map(accounts.map(account => [account.id, account]))
  let hasChanges = false
  let recoveryStarted = false

  for (const { accountId, connected } of webviewRegistry.listRegistered()) {
    if (!canContinue()) break
    if (!connected) continue
    const account = accountById.get(accountId)
    if (
      account?.flatformType !== 'zalo' ||
      !account.isZaloShowWeb || account.isZaloServer
    ) continue
    const wcId = webviewRegistry.getWebContentsId(accountId)
    if (!wcId) continue

    try {
      const hasAuthCookies = await hasZaloWebAuthenticationCookies(wcId)
      if (!canContinue()) break
      if (hasAuthCookies === true) {
        if (recoveryStarted || !account.isActive || account.isDelete || account.status === 'đang chạy'
          || accountOperationRegistry.has(accountId)) continue
        recoveryStarted = startRecovery(account)
        continue
      }
      if (hasAuthCookies !== false || account.loginStatus !== 'đã đăng nhập') continue
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

/** Runs outside the poller tick, but remains tracked until token cleanup settles. */
async function recoverZaloWebAccount(
  account: AutoAccount,
  zaloRuntime: ZaloRuntimeService,
  canContinue: () => boolean,
  canReleaseClaim: () => boolean,
  notifyChanged: () => void,
  reportFailure: (account: AutoAccount, reason: string) => void
): Promise<void> {
  try {
    if (!canContinue()) return
    const claim = await accountRepo.claimZaloAccountRuntimeOperation(account.id, 'desktop', false, 'zalo.web.recover')
    if (!claim.claimed || !claim.previousStatus || !claim.claimToken) {
      if (canContinue()) reportFailure(account, 'Chưa thể nhận lượt kiểm tra. Hãy bấm Kiểm tra đăng nhập khi tài khoản đã rảnh.')
      return
    }
    try {
      if (!canContinue()) return
      const result = await zaloRuntime.checkSession(account.id, { recoverWebSession: true })
      if (canContinue() && !result.success) {
        reportFailure(account, result.reason || 'Chưa xác minh được phiên; hãy bấm Kiểm tra đăng nhập để thử lại.')
      }
    } finally {
      if (canReleaseClaim()) await accountRepo.releaseZaloAccountRuntimeOperation(
        account.id, 'desktop', claim.previousStatus, claim.staffId, claim.claimToken
      )
      if (canContinue()) notifyChanged()
    }
  } catch (error) {
    console.warn('[AutoCheck] Zalo Web recovery incomplete:', { accountId: account.id, error })
    if (canContinue()) reportFailure(account, 'Chưa hoàn tất phục hồi phiên Zalo Web. Hãy bấm Kiểm tra đăng nhập để thử lại.')
  }
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
      const claim = await accountRepo.claimZaloAccountRuntimeOperation(account.id, 'desktop', true, 'zalo.session.poll')
      if (!claim.claimed || !claim.previousStatus || !claim.claimToken) continue
      let result: Awaited<ReturnType<ZaloRuntimeService['checkSession']>>
      try {
        if (!canContinue()) continue
        result = await zaloRuntime.checkSession(account.id)
      } finally {
        if (canReleaseClaim()) {
          await accountRepo.releaseZaloAccountRuntimeOperation(account.id, 'desktop', claim.previousStatus, claim.staffId, claim.claimToken)
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
  zaloRuntime?: ZaloRuntimeService,
  facebookLogin?: FacebookLoginService
): AccountPollerController {
  let isRunning = false
  let zaloRuntimeBlocked = false
  let zaloClaimsAbandoned = false
  let activeZaloCheck: Promise<boolean> | null = null
  let activeWebRecovery: Promise<void> | null = null
  let zaloWorkGeneration = 0
  let zaloClaimGeneration = 0
  let lastZaloAutoCheckAt = Date.now()
  let lastStaffId: number | null = null

  setInterval(async () => {
    const user = getCurrentUser()
    if (!user) return
    // Cleanup must not depend on a visible tab or a previous list/observation finishing.
    facebookLogin?.recoverPending()
    if (isRunning) return
    isRunning = true

    try {
      if (lastStaffId !== user.staffId) {
        lastStaffId = user.staffId
        lastZaloAutoCheckAt = Date.now()
      }

      const accounts = await accountRepo.listAccounts()
      const hasFacebookChanges = await checkFacebookWebviewAccounts(accounts, webviewRegistry, facebookLogin)
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
        const workGeneration = zaloWorkGeneration
        const claimGeneration = zaloClaimGeneration
        const canContinue = () => !zaloRuntimeBlocked && !zaloClaimsAbandoned
          && workGeneration === zaloWorkGeneration && claimGeneration === zaloClaimGeneration
          && getCurrentUser()?.staffId === user.staffId
        const canReleaseClaim = () => !zaloClaimsAbandoned && claimGeneration === zaloClaimGeneration
        const notifyChanged = (): void => {
          try { mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch { /* Window closed. */ }
        }
        const reportRecoveryFailure = (account: AutoAccount, reason: string): void => {
          try {
            mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_LOG, {
              timestamp: new Date().toISOString(), accountId: account.id, accountName: account.name,
              message: `Zalo Web "${account.name}": ${reason}`
            })
          } catch { /* The window may have closed during recovery. */ }
        }
        const operation = (async () => {
          let changed = false
          if (shouldCheckZaloWeb) {
            changed = await checkZaloWebviewAccounts(
              accounts,
              webviewRegistry,
              zaloRuntime,
              canContinue,
              account => {
                if (activeWebRecovery || !canContinue() || !zaloRuntime
                  || !zaloRuntime.takeWebSessionRecovery(account.id)) return false
                // One background recovery at a time, with no new timer. Consume
                // its local budget before claiming, and keep it tracked through
                // slow claims/cleanup without holding the shared poller tick.
                const runtime = zaloRuntime
                const recovery = Promise.resolve().then(() => recoverZaloWebAccount(
                  account, runtime, canContinue, canReleaseClaim, notifyChanged, reportRecoveryFailure
                )).finally(() => {
                  if (activeWebRecovery === recovery) activeWebRecovery = null
                })
                activeWebRecovery = recovery
                void recovery.catch(() => {})
                return true
              }
            )
          }
          if (shouldCheckZaloApi && canContinue()) {
            changed = await checkZaloApiAccounts(
              accounts,
              zaloRuntime,
              canContinue,
              canReleaseClaim
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
      zaloWorkGeneration += 1
    },
    resetZaloRuntimeBlock(): void {
      zaloRuntimeBlocked = false
      zaloWorkGeneration += 1
    },
    abandonZaloClaims(): void {
      zaloClaimsAbandoned = true
      zaloClaimGeneration += 1
    },
    resetZaloClaims(): void {
      zaloClaimsAbandoned = false
      zaloClaimGeneration += 1
    },
    async waitForZaloIdle(timeoutMs = 30_000): Promise<boolean> {
      const pending = [activeZaloCheck, activeWebRecovery].filter(work => work !== null)
      if (pending.length === 0) return true
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          Promise.allSettled(pending).then(() => true),
          new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs)) })
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  }
}
