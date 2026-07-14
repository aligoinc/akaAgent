import { app, ipcMain, BrowserWindow } from 'electron'
import { AuthEntitlements, AuthUser, IPC_EVENTS } from '../../shared/types'
import { WebviewRegistry } from '../playwright/webviewController'
import { PageControllerRegistry } from '../v2/runtime/pageController'
import { SupabaseService } from '../services/supabase'
import { CampaignScheduler } from '../services/campaignScheduler'
import { ContactLoader } from '../services/contactLoader'
import { ProxyRuntimeService } from '../services/proxyRuntimeService'
import { ZaloRuntimeService } from '../services/zaloRuntimeService'
import { ZaloRealtimeGroupCampaignManager } from '../services/zaloRealtimeGroupCampaignManager'
import { EmailRuntimeService } from '../services/emailRuntimeService'
import { ZaloServerClient } from '../services/zaloServerClient'
import { DailyMaintenanceCoordinator } from '../services/dailyMaintenanceCoordinator'
import { startAccountPoller, type AccountPollerController } from '../domain/accounts/accountPoller'

import { registerBrowserHandlers } from './handlers/browserHandlers'
import { registerCampaignHandlers } from './handlers/campaignHandlers'
import { registerAccountHandlers, type AccountZaloOperationController } from './handlers/accountHandlers'
import { registerAccountContactHandlers } from './handlers/accountContactHandlers'
import { registerAuthHandlers } from './handlers/authHandlers'
import { registerUpdateHandlers } from './handlers/updateHandlers'
import { registerV2Handlers } from './handlers/v2Handlers'
import { registerAiHandlers } from './handlers/aiHandlers'
import { registerAkaBizIntegrationHandlers } from './handlers/akaBizIntegrationHandlers'
import { registerCampaignImportHandlers } from './handlers/campaignImportHandlers'
import { registerContentTemplateHandlers } from './handlers/contentTemplateHandlers'
import { registerMediaHandlers } from './handlers/mediaHandlers'
import { registerCustomerFeedbackHandlers } from './handlers/customerFeedbackHandlers'
import { registerEmailNotificationHandlers } from './handlers/emailNotificationHandlers'
import { registerReportHandlers } from './handlers/reportHandlers'
import {
  getCurrentUser,
  isCurrentUserZaloServerEnabled,
  setCurrentUser
} from '../data/currentUser'
import {
  loadLoginSettingsForCurrentDevice,
  updateStartupSettingForCurrentDevice
} from '../data/repositories/authRepository'
import {
  blockZaloLocalStartupHandoff,
  clearZaloLocalStartupHandoffBlock,
  clearZaloRuntimeRestartRequired,
  getZaloRuntimeRestartRequired,
  isZaloLocalStartupHandoffBlocked,
  loadStaffZaloServerMode,
  loadStaffZaloServerModeSnapshot,
  markZaloRuntimeRestartRequired,
  shouldRouteCurrentUserZaloCleanupToServer,
  ZALO_LOCAL_STARTUP_HANDOFF_MESSAGE
} from '../data/repositories/zaloRuntimeModeRepository'
import {
  ACCOUNT_EXPIRED_MESSAGE,
  loadOrganizationAccountProducts,
  loadOrganizationEntitlements
} from '../data/repositories/entitlementRepository'
import { readBlockScreenshotDataUrl } from '../services/blockScreenshotService'
import { readCampaignPreviewFileDataUrl } from '../services/campaignPreviewFileService'

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CAMPAIGN_SCHEDULER_START_DELAY_MS = 30 * 1000
const RUNTIME_ENTITLEMENT_REFRESH_INTERVAL_MS = 30 * 1000
const LOCAL_ZALO_HANDOFF_RETRY_INTERVAL_MS = 30 * 1000
const SESSION_EXPIRY_DAILY_CHECK_HOUR = 0
const SESSION_EXPIRY_DAILY_CHECK_MINUTE = 5

function getNextVietnamSessionExpiryCheckDelayMs(now = new Date()): number {
  const vietnamNowMs = now.getTime() + VIETNAM_UTC_OFFSET_MS
  const vietnamNow = new Date(vietnamNowMs)
  const todayCheckVietnamMs = Date.UTC(
    vietnamNow.getUTCFullYear(),
    vietnamNow.getUTCMonth(),
    vietnamNow.getUTCDate(),
    SESSION_EXPIRY_DAILY_CHECK_HOUR,
    SESSION_EXPIRY_DAILY_CHECK_MINUTE,
    0,
    0
  )
  const nextCheckVietnamMs = todayCheckVietnamMs > vietnamNowMs
    ? todayCheckVietnamMs
    : todayCheckVietnamMs + ONE_DAY_MS
  return Math.max(1000, nextCheckVietnamMs - vietnamNowMs)
}

function hasAnyEntitlement(entitlements: Partial<AuthEntitlements> | null | undefined): boolean {
  return !!(
    entitlements?.facebookCore ||
    entitlements?.facebookFanpage ||
    entitlements?.email ||
    entitlements?.zalo ||
    entitlements?.sms
  )
}

function authEntitlementsEqual(
  left: Partial<AuthEntitlements> | null | undefined,
  right: Partial<AuthEntitlements> | null | undefined
): boolean {
  return !!left?.facebookCore === !!right?.facebookCore &&
    !!left?.facebookFanpage === !!right?.facebookFanpage &&
    !!left?.email === !!right?.email &&
    !!left?.zalo === !!right?.zalo &&
    !!left?.sms === !!right?.sms &&
    (left?.dailySendLimits?.facebookCore ?? null) === (right?.dailySendLimits?.facebookCore ?? null) &&
    (left?.dailySendLimits?.facebookFanpage ?? null) === (right?.dailySendLimits?.facebookFanpage ?? null) &&
    (left?.dailySendLimits?.email ?? null) === (right?.dailySendLimits?.email ?? null) &&
    (left?.dailySendLimits?.zalo ?? null) === (right?.dailySendLimits?.zalo ?? null) &&
    (left?.dailySendLimits?.sms ?? null) === (right?.dailySendLimits?.sms ?? null) &&
    (left?.accountLimits?.facebookCore ?? null) === (right?.accountLimits?.facebookCore ?? null) &&
    (left?.accountLimits?.facebookFanpage ?? null) === (right?.accountLimits?.facebookFanpage ?? null) &&
    (left?.accountLimits?.email ?? null) === (right?.accountLimits?.email ?? null) &&
    (left?.accountLimits?.zalo ?? null) === (right?.accountLimits?.zalo ?? null) &&
    (left?.accountLimits?.sms ?? null) === (right?.accountLimits?.sms ?? null)
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const supabase = new SupabaseService()
  const webviewRegistry = new WebviewRegistry()
  const pageRegistry = new PageControllerRegistry()
  const proxyRuntime = new ProxyRuntimeService((id) => supabase.getProxy(id))
  const zaloServerClient = new ZaloServerClient(mainWindow)
  let runtimeCredentials: { username: string; password: string } | null = null
  let forceFullDesktopMaintenance = false
  let zaloRealtimeGroupManager: ZaloRealtimeGroupCampaignManager | null = null
  const zaloRuntime = new ZaloRuntimeService(
    supabase,
    (id) => supabase.getProxy(id),
    (event) => {
      try {
        mainWindow.webContents.send(IPC_EVENTS.ZALO_LOGIN_QR_EVENT, event)
        if (event.status === 'success' || event.status === 'error' || event.status === 'cancelled') {
          mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
          zaloRealtimeGroupManager?.refreshSoon(`zalo-login-${event.status}`)
        }
      } catch {
        // Window may be closed
      }
    }
  )
  const emailRuntime = new EmailRuntimeService(supabase)
  const dailyMaintenance = new DailyMaintenanceCoordinator(async () => {
    const user = getCurrentUser()
    if (!user) return
    const updatedCampaigns = !forceFullDesktopMaintenance && (
      getZaloRuntimeRestartRequired() ||
      isZaloLocalStartupHandoffBlocked() ||
      isCurrentUserZaloServerEnabled()
    )
      ? await supabase.maintainNonZaloCampaignSchedules()
      : await supabase.maintainCampaignSchedules()
    for (const campaign of updatedCampaigns) {
      try {
        mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, campaign)
      } catch {
        // Window may be closed
      }
    }
    if (updatedCampaigns.length > 0) {
      console.log(`[ScheduleMaintenance] updated ${updatedCampaigns.length} campaign schedules.`)
    }
  }, {
    scopeKey: () => {
      const user = getCurrentUser()
      if (!user) return 'signed-out'
      const scope = forceFullDesktopMaintenance
        ? 'desktop-all'
        : user.isZaloServer
        ? 'server-zalo'
        : isZaloLocalStartupHandoffBlocked()
          ? 'desktop-non-zalo-handoff'
          : 'desktop-all'
      return `${user.staffId}:${scope}`
    }
  })
  const campaignScheduler = new CampaignScheduler(
    supabase,
    webviewRegistry,
    mainWindow,
    proxyRuntime,
    zaloRuntime,
    emailRuntime,
    { runtimeTarget: 'desktop', maintenanceCoordinator: dailyMaintenance }
  )
  campaignScheduler.setPageRegistry(pageRegistry)
  const contactLoader = new ContactLoader(supabase, webviewRegistry, mainWindow, proxyRuntime, zaloRuntime)
  zaloRealtimeGroupManager = new ZaloRealtimeGroupCampaignManager(supabase, zaloRuntime, mainWindow)

  let restartRequiredActivation: Promise<void> | null = null
  let accountZaloOperations: AccountZaloOperationController | null = null
  let accountPollerController: AccountPollerController | null = null
  let localHandoffGeneration = 0
  let localHandoffRetryTimer: ReturnType<typeof setTimeout> | null = null
  let localHandoffRetryRunningGeneration: number | null = null

  const cancelLocalHandoffRetry = (): void => {
    localHandoffGeneration += 1
    if (localHandoffRetryTimer) clearTimeout(localHandoffRetryTimer)
    localHandoffRetryTimer = null
    localHandoffRetryRunningGeneration = null
  }

  const notifyRendererZaloRuntimeRestartRequired = (payload: ReturnType<typeof markZaloRuntimeRestartRequired>): void => {
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_EVENTS.AUTH_ZALO_RUNTIME_RESTART_REQUIRED, payload)
      }
    } catch {
      // Window may be closed
    }
  }

  const activateZaloRuntimeRestartRequired = (
    liveIsZaloServer: boolean
  ): Promise<void> => {
    const payload = markZaloRuntimeRestartRequired(liveIsZaloServer)
    notifyRendererZaloRuntimeRestartRequired(payload)
    if (restartRequiredActivation) return restartRequiredActivation

    cancelLocalHandoffRetry()
    clearZaloLocalStartupHandoffBlock()
    campaignScheduler.blockZaloRuntimeForRestart(null)
    contactLoader.blockZaloRuntimeForRestart()
    accountPollerController?.blockZaloRuntime()
    zaloRealtimeGroupManager?.stop()
    zaloServerClient.stop()

    const activation = (accountZaloOperations?.stopAll() ?? zaloRuntime.cancelAllLoginQrAndWait())
      .then((qrSettled) => {
        // Keep an unresolved QR entry visible to the final quit cleanup. The
        // cache/version invalidation still prevents that old login from
        // publishing a success or caching an API after the mode changed.
        zaloRuntime.clearAll({ preserveActiveQrLogins: !qrSettled })
      })
      .catch(err => {
        console.error('[RuntimeMode] Failed to settle direct Zalo operations during restart handoff:', err)
      })
    restartRequiredActivation = activation
    return activation
  }

  const runScopedRecovery = async (
    reason: 'login' | 'logout' | 'quit',
    options: { excludeZalo?: boolean; zaloUncertainNoRetry?: boolean } = {}
  ): Promise<boolean> => {
    const user = getCurrentUser()
    if (!user) return false
    try {
      const [schedulerIdle, contactLoaderIdle, realtimeIdle, directOperationsIdle, accountPollerIdle, warmSessionsIdle] = await Promise.all([
        campaignScheduler.waitForIdle(30_000),
        contactLoader.waitForIdle(30_000),
        zaloRealtimeGroupManager?.waitForIdle(30_000) ?? Promise.resolve(true),
        accountZaloOperations?.waitForIdle(30_000) ?? Promise.resolve(true),
        accountPollerController?.waitForZaloIdle(30_000) ?? Promise.resolve(true),
        zaloRuntime.waitForWarmSessionsIdle(30_000)
      ])
      if (!schedulerIdle || !contactLoaderIdle || !realtimeIdle || !directOperationsIdle || !accountPollerIdle || !warmSessionsIdle) {
        // Every producer has already been blocked/aborted before logout/quit.
        // Finish with the atomic DB barrier so the next runtime cannot wait on
        // orphaned rows forever. Running Zalo inputs are completed no-retry.
        console.warn(`[Recovery] ${reason}: cleanup timeout; applying final atomic DB recovery barrier.`)
      }
      campaignScheduler.abandonZaloRuntimeClaims()
      contactLoader.abandonZaloRuntimeClaims()
      zaloRealtimeGroupManager?.abandonZaloRuntimeClaims()
      zaloRuntime.abandonWarmSessionClaims()
      accountZaloOperations?.abandonClaims()
      accountPollerController?.abandonZaloClaims()
      const excludeZalo = options.excludeZalo ?? (
        user.isZaloServer || isZaloLocalStartupHandoffBlocked()
      )
      // Whenever this desktop is responsible for Zalo cleanup, a running
      // input/input-data row has an unknown outcome and must never be queued
      // again automatically. Server-owned or handoff-blocked Zalo stays intact.
      const zaloUncertainNoRetry = options.zaloUncertainNoRetry ?? !excludeZalo
      await supabase.resetDesktopRunningStatuses(
        user.staffId,
        excludeZalo,
        zaloUncertainNoRetry
      )
      return true
    } catch (err) {
      console.error(`[Recovery] ${reason}: failed to reset running statuses:`, err)
      return false
    }
  }

  let sessionExpiryTimer: ReturnType<typeof setTimeout> | null = null
  let sessionExpiryCheckRunning = false

  const clearSessionExpiryTimer = (): void => {
    if (!sessionExpiryTimer) return
    clearTimeout(sessionExpiryTimer)
    sessionExpiryTimer = null
  }

  const notifyRendererSessionExpired = (): void => {
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_EVENTS.AUTH_SESSION_EXPIRED, { message: ACCOUNT_EXPIRED_MESSAGE })
      }
    } catch {
      // Window may be closed
    }
  }

  const notifyRendererUserUpdated = (user: AuthUser): void => {
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_EVENTS.AUTH_USER_UPDATED, user)
      }
    } catch {
      // Window may be closed
    }
  }

  const expireCurrentSession = async (reason: 'login' | 'daily' | 'runtime'): Promise<void> => {
    const user = getCurrentUser()
    if (!user) return

    clearSessionExpiryTimer()
    cancelLocalHandoffRetry()
    try {
      contactLoader.stopAll()
      campaignScheduler.stop()
      accountPollerController?.blockZaloRuntime()
      zaloServerClient.stop()
      runtimeCredentials = null
      zaloRealtimeGroupManager?.stop()
      await (accountZaloOperations?.stopAll() ?? zaloRuntime.cancelAllLoginQrAndWait())
      zaloRuntime.clearAll()
      emailRuntime.clearAll()
      await runScopedRecovery('logout')
    } catch (err) {
      console.error(`[AuthSessionExpiry] ${reason}: failed to clean up expired session:`, err)
    } finally {
      clearZaloLocalStartupHandoffBlock()
      setCurrentUser(null)
      notifyRendererSessionExpired()
    }
  }

  const runSessionExpiryCheck = async (reason: 'login' | 'daily' | 'runtime'): Promise<void> => {
    if (sessionExpiryCheckRunning) return

    const checkedUser = getCurrentUser()
    if (!checkedUser) return

    sessionExpiryCheckRunning = true
    try {
      const [liveEntitlements, liveAccountProducts] = await Promise.all([
        loadOrganizationEntitlements(checkedUser.organizationId),
        loadOrganizationAccountProducts(checkedUser.organizationId)
      ])
      const currentUser = getCurrentUser()
      if (!currentUser || currentUser.staffId !== checkedUser.staffId) return

      if (!hasAnyEntitlement(liveEntitlements)) {
        await expireCurrentSession(reason)
        return
      }

      const updatedUser = {
        ...currentUser,
        entitlements: liveEntitlements,
        accountProducts: liveAccountProducts
      }
      const entitlementsChanged = !authEntitlementsEqual(currentUser.entitlements, liveEntitlements)
      const accountProductsChanged = JSON.stringify(currentUser.accountProducts || []) !== JSON.stringify(liveAccountProducts)
      const pendingRuntimeRestart = getZaloRuntimeRestartRequired()
      const runtimeModeChanged = !!pendingRuntimeRestart
      if (reason !== 'login' && (entitlementsChanged || accountProductsChanged || runtimeModeChanged)) {
        if (pendingRuntimeRestart) {
          void activateZaloRuntimeRestartRequired(
            pendingRuntimeRestart.databaseIsZaloServer
          )
        }

        setCurrentUser(updatedUser)
        if (!runtimeModeChanged && runtimeCredentials) {
          zaloServerClient.start(updatedUser, runtimeCredentials.username, runtimeCredentials.password)
        }
        if (!runtimeModeChanged) syncZaloBackgroundForCurrentUser(`${reason}-entitlement-refresh`)
        notifyRendererUserUpdated(updatedUser)
      } else {
        setCurrentUser(updatedUser)
      }
    } catch (err) {
      console.error(`[AuthSessionExpiry] ${reason}: failed to refresh entitlements:`, err)
    } finally {
      sessionExpiryCheckRunning = false
      if (getCurrentUser()) scheduleSessionExpiryCheck()
    }
  }

  function scheduleSessionExpiryCheck(): void {
    clearSessionExpiryTimer()
    if (!getCurrentUser()) return

    const delayMs = getNextVietnamSessionExpiryCheckDelayMs()
    sessionExpiryTimer = setTimeout(() => {
      sessionExpiryTimer = null
      void runSessionExpiryCheck('daily')
    }, delayMs)
  }

  const runZaloRuntimeModeCheck = async (): Promise<void> => {
    const checkedUser = getCurrentUser()
    if (!checkedUser) return
    const pendingRestart = getZaloRuntimeRestartRequired()
    if (pendingRestart) {
      // A direct QR/scan/session IPC can discover the mismatch before this
      // poll. Activate cleanup/modal here instead of waiting for entitlement
      // refresh to succeed.
      void activateZaloRuntimeRestartRequired(pendingRestart.databaseIsZaloServer)
      return
    }
    try {
      const liveIsZaloServer = await loadStaffZaloServerMode(checkedUser.staffId)
      const currentUser = getCurrentUser()
      if (!currentUser || currentUser.staffId !== checkedUser.staffId) return
      if (currentUser.isZaloServer !== liveIsZaloServer) {
        void activateZaloRuntimeRestartRequired(liveIsZaloServer)
      }
    } catch (error) {
      console.error('[RuntimeMode] Failed to refresh Zalo runtime mode:', error)
    }
  }

  const warmZaloSessions = (): void => {
    void zaloRuntime.warmStoredSessions('desktop')
      .then(() => {
        try {
          mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
        } catch {
          // Window may be closed
        }
      })
      .catch((err) => {
        console.error('[ZaloRuntime] Failed to warm stored sessions:', err)
      })
  }

  const syncZaloBackgroundForCurrentUser = (_reason: string): void => {
    const user = getCurrentUser()
    if (isZaloLocalStartupHandoffBlocked()) {
      zaloRealtimeGroupManager?.stop()
      zaloRuntime.clearAll()
      return
    }
    if (user?.entitlements?.zalo && user.isZaloServer) {
      zaloRealtimeGroupManager?.stop()
      zaloRuntime.clearAll()
      return
    }
    if (user?.entitlements?.zalo) {
      warmZaloSessions()
      zaloRealtimeGroupManager?.start()
      return
    }

    zaloRealtimeGroupManager?.stop()
    zaloRuntime.clearAll()
    zaloServerClient.stop()
  }

  const beginLocalZaloHandoff = (): number => {
    cancelLocalHandoffRetry()
    blockZaloLocalStartupHandoff()
    campaignScheduler.blockZaloRuntimeForRestart(null)
    contactLoader.blockZaloRuntimeForRestart()
    accountPollerController?.blockZaloRuntime()
    zaloRealtimeGroupManager?.stop()
    zaloRuntime.clearAll()
    console.info('[RuntimeHandoff] Zalo local is waiting for the app server to hand off safely.')
    return localHandoffGeneration
  }

  const completeLocalZaloHandoff = async (generation: number): Promise<boolean> => {
    const user = getCurrentUser()
    if (!user || user.isZaloServer || generation !== localHandoffGeneration) return false
    try {
      const liveIsZaloServer = await loadStaffZaloServerMode(user.staffId)
      if (generation !== localHandoffGeneration || getCurrentUser()?.staffId !== user.staffId) return false
      if (liveIsZaloServer) {
        clearZaloLocalStartupHandoffBlock()
        void activateZaloRuntimeRestartRequired(true)
        return false
      }
    } catch (error) {
      console.warn('[RuntimeHandoff] Cannot verify the live Zalo mode before enabling local runtime:', error)
      return false
    }
    if (getZaloRuntimeRestartRequired()) {
      clearZaloLocalStartupHandoffBlock()
      return false
    }

    forceFullDesktopMaintenance = true
    dailyMaintenance.invalidate()
    try {
      await dailyMaintenance.ensureReady()
    } catch (error) {
      console.warn('[RuntimeHandoff] Full Zalo maintenance failed; local runtime remains blocked:', error)
      return false
    } finally {
      forceFullDesktopMaintenance = false
    }

    const currentUser = getCurrentUser()
    if (
      !currentUser ||
      currentUser.staffId !== user.staffId ||
      currentUser.isZaloServer ||
      generation !== localHandoffGeneration ||
      !isZaloLocalStartupHandoffBlocked() ||
      getZaloRuntimeRestartRequired()
    ) {
      return false
    }
    try {
      const liveIsZaloServer = await loadStaffZaloServerMode(user.staffId)
      if (
        generation !== localHandoffGeneration ||
        getCurrentUser()?.staffId !== user.staffId ||
        !isZaloLocalStartupHandoffBlocked()
      ) {
        return false
      }
      if (liveIsZaloServer) {
        void activateZaloRuntimeRestartRequired(true)
        return false
      }
    } catch (error) {
      console.warn('[RuntimeHandoff] Cannot recheck the live Zalo mode after maintenance:', error)
      return false
    }

    clearZaloLocalStartupHandoffBlock()
    campaignScheduler.resetZaloRuntimeRestartBlock()
    contactLoader.resetZaloRuntimeRestartBlock()
    accountPollerController?.resetZaloRuntimeBlock()
    syncZaloBackgroundForCurrentUser('server-to-local-handoff-complete')
    console.info('[RuntimeHandoff] App server handoff completed; local Zalo runtime is ready.')
    return true
  }

  const attemptLocalZaloHandoff = async (generation: number): Promise<boolean> => {
    const user = getCurrentUser()
    const credentials = runtimeCredentials
    if (
      !user ||
      user.isZaloServer ||
      !credentials ||
      generation !== localHandoffGeneration ||
      !isZaloLocalStartupHandoffBlocked() ||
      getZaloRuntimeRestartRequired()
    ) {
      return false
    }

    let stateBeforeRequest: Awaited<ReturnType<typeof supabase.inspectStaffZaloRunningState>> | null = null
    try {
      stateBeforeRequest = await supabase.inspectStaffZaloRunningState(user.staffId)
      if (generation !== localHandoffGeneration || getCurrentUser()?.staffId !== user.staffId) return false
      if (stateBeforeRequest.hasRunningState) {
        console.warn('[RuntimeHandoff] DB still has running Zalo work; requesting server settlement:', stateBeforeRequest)
      }
    } catch (inspectError) {
      // The endpoint may still be able to settle and return an authoritative
      // response. If it is also unreachable, the catch below keeps Zalo blocked.
      console.warn('[RuntimeHandoff] Cannot inspect DB before server handoff:', inspectError)
    }

    let receivedHandoffResponse = false
    try {
      const response = await zaloServerClient.requestRuntimeHandoff(credentials.username, credentials.password)
      receivedHandoffResponse = true
      if (generation !== localHandoffGeneration || getCurrentUser()?.staffId !== user.staffId) return false
      if (
        !response.success ||
        !response.serverStopped ||
        response.serverOwned ||
        response.ownership === 'server'
      ) {
        console.warn('[RuntimeHandoff] Server has not settled the staff runtime yet:', response)
        return false
      }

      if (
        response.ownership === 'desktop-or-unknown' &&
        response.requiresDesktopRecovery &&
        !response.settled
      ) {
        // The live VPS has crossed its serialized lifecycle barrier and proved
        // it no longer owns these rows. Recover only Zalo under the current
        // false-mode row revision; uncertain inputs are completed no-retry.
        const modeSnapshot = await loadStaffZaloServerModeSnapshot(user.staffId)
        if (generation !== localHandoffGeneration || getCurrentUser()?.staffId !== user.staffId) return false
        if (modeSnapshot.isZaloServer) {
          void activateZaloRuntimeRestartRequired(true)
          return false
        }
        await supabase.recoverDesktopZaloRunningState(user.staffId, modeSnapshot.revision)
      } else if (
        response.ownership !== 'none' ||
        response.requiresDesktopRecovery ||
        !response.settled
      ) {
        console.warn('[RuntimeHandoff] Server returned an inconsistent handoff state:', response)
        return false
      }

      const stateAfterRequest = await supabase.inspectStaffZaloRunningState(user.staffId)
      if (generation !== localHandoffGeneration || getCurrentUser()?.staffId !== user.staffId) return false
      if (stateAfterRequest.hasRunningState) {
        console.warn('[RuntimeHandoff] Zalo rows are still running after handoff:', stateAfterRequest)
        return false
      }
      return await completeLocalZaloHandoff(generation)
    } catch (handoffError) {
      // If the VPS application is genuinely offline, a clean DB plus the live
      // false mode is sufficient: atomic claims prevent that offline runtime
      // from creating new work. Any running row still needs an online server
      // acknowledgement before desktop may classify/recover it.
      if (!receivedHandoffResponse && stateBeforeRequest && !stateBeforeRequest.hasRunningState) {
        console.warn('[RuntimeHandoff] Server endpoint is unavailable but DB is clean; enabling local runtime:', handoffError)
        return await completeLocalZaloHandoff(generation)
      }
      console.warn('[RuntimeHandoff] Cannot prove ownership of running Zalo work; Zalo remains blocked:', handoffError)
      return false
    }
  }

  const scheduleLocalZaloHandoffRetry = (generation: number, delayMs = LOCAL_ZALO_HANDOFF_RETRY_INTERVAL_MS): void => {
    if (
      generation !== localHandoffGeneration ||
      !isZaloLocalStartupHandoffBlocked() ||
      getZaloRuntimeRestartRequired() ||
      localHandoffRetryTimer
    ) {
      return
    }
    localHandoffRetryTimer = setTimeout(() => {
      localHandoffRetryTimer = null
      if (localHandoffRetryRunningGeneration !== null || generation !== localHandoffGeneration) return
      localHandoffRetryRunningGeneration = generation
      void (async () => {
        let ready = false
        try {
          ready = await attemptLocalZaloHandoff(generation)
        } catch (error) {
          console.warn('[RuntimeHandoff] Unexpected handoff retry failure:', error)
        } finally {
          if (localHandoffRetryRunningGeneration === generation) {
            localHandoffRetryRunningGeneration = null
          }
          if (!ready) scheduleLocalZaloHandoffRetry(generation)
        }
      })()
    }, Math.max(0, delayMs))
  }

  const runScheduleMaintenance = async (reason: 'login' | 'new-day'): Promise<void> => {
    if (!getCurrentUser()) return
    try {
      await dailyMaintenance.ensureReady()
    } catch (err) {
      console.error(`[ScheduleMaintenance] ${reason} failed:`, err)
      throw err
    }
  }

  setInterval(() => {
    if (!getCurrentUser()) return
    void runScheduleMaintenance('new-day').catch(() => {})
  }, 60 * 1000)

  setInterval(() => {
    if (!getCurrentUser()) return
    void runSessionExpiryCheck('runtime')
  }, RUNTIME_ENTITLEMENT_REFRESH_INTERVAL_MS)

  // Keep this independent from entitlement refresh. Slow product queries must
  // not postpone the mandatory mode-change modal beyond the next 30s poll.
  setInterval(() => {
    if (!getCurrentUser()) return
    void runZaloRuntimeModeCheck()
  }, RUNTIME_ENTITLEMENT_REFRESH_INTERVAL_MS)

  let quitCleanupStarted = false
  let quitCleanupCompleted = false
  app.on('before-quit', (event) => {
    if (quitCleanupCompleted) return
    if (quitCleanupStarted) {
      event.preventDefault()
      return
    }

    const user = getCurrentUser()
    if (!user) {
      clearSessionExpiryTimer()
      quitCleanupCompleted = true
      return
    }

    event.preventDefault()
    quitCleanupStarted = true
    void (async () => {
      try {
        clearSessionExpiryTimer()
        cancelLocalHandoffRetry()
        contactLoader.stopAll()
        campaignScheduler.stop()
        accountPollerController?.blockZaloRuntime()
        zaloServerClient.stop()
        runtimeCredentials = null
        zaloRealtimeGroupManager?.stop()
        await (accountZaloOperations?.stopAll() ?? zaloRuntime.cancelAllLoginQrAndWait())
        zaloRuntime.clearAll()
        emailRuntime.clearAll()
        await runScopedRecovery('quit')
      } catch (err) {
        console.error('[Recovery] quit: failed to reset running statuses:', err)
      } finally {
        clearZaloLocalStartupHandoffBlock()
        quitCleanupCompleted = true
        app.quit()
      }
    })()
  })

  // Theme
  ipcMain.handle(IPC_EVENTS.THEME_CHANGE, (_, theme: 'light' | 'dark') => {
    if (typeof mainWindow.setTitleBarOverlay !== 'function') return
    if (theme === 'light') {
      mainWindow.setTitleBarOverlay({ color: '#edf3fa', symbolColor: '#64748b' })
    } else {
      mainWindow.setTitleBarOverlay({ color: '#0a0a0f', symbolColor: '#a0a0b8' })
    }
  })

  // App settings
  ipcMain.handle(IPC_EVENTS.APP_GET_STARTUP_SETTING, async () => {
    const snapshot = await loadLoginSettingsForCurrentDevice()
    app.setLoginItemSettings({ openAtLogin: snapshot.loginOptions.startupEnabled })
    return { enabled: app.getLoginItemSettings().openAtLogin }
  })

  ipcMain.handle(IPC_EVENTS.APP_SET_STARTUP_SETTING, async (_, enabled: boolean) => {
    const loginOptions = await updateStartupSettingForCurrentDevice(!!enabled, getCurrentUser())
    app.setLoginItemSettings({ openAtLogin: loginOptions.startupEnabled })
    return { enabled: app.getLoginItemSettings().openAtLogin }
  })

  ipcMain.handle(IPC_EVENTS.APP_READ_BLOCK_SCREENSHOT, async (_, filePath: string) => {
    return readBlockScreenshotDataUrl(filePath)
  })

  ipcMain.handle(IPC_EVENTS.APP_READ_CAMPAIGN_PREVIEW_FILE, async (_, filePath: string) => {
    return readCampaignPreviewFileDataUrl(filePath)
  })

  ipcMain.on(IPC_EVENTS.APP_QUIT, () => {
    app.quit()
  })

  // Register domain handlers
  registerAuthHandlers({
    afterLogin: async ({ username, password }) => {
      cancelLocalHandoffRetry()
      clearZaloLocalStartupHandoffBlock()
      clearZaloRuntimeRestartRequired()
      restartRequiredActivation = null
      campaignScheduler.resetZaloRuntimeRestartBlock()
      contactLoader.resetZaloRuntimeRestartBlock()
      accountPollerController?.resetZaloRuntimeBlock()
      runtimeCredentials = { username, password }
      const loginUser = getCurrentUser()
      const requiresLocalHandoff = !!(
        loginUser &&
        !loginUser.isZaloServer &&
        loginUser.entitlements.zalo
      )
      const handoffGeneration = requiresLocalHandoff
        ? beginLocalZaloHandoff()
        : localHandoffGeneration
      try {
        await runScopedRecovery('login', requiresLocalHandoff ? { excludeZalo: true } : undefined)
        await runScheduleMaintenance('login')
      } finally {
        await runSessionExpiryCheck('login')
        const user = getCurrentUser()
        if (!user) return
        campaignScheduler.resetZaloRuntimeClaims()
        contactLoader.resetZaloRuntimeClaims()
        zaloRealtimeGroupManager?.resetZaloRuntimeClaims()
        zaloRuntime.resetWarmSessionClaims()
        accountZaloOperations?.resetClaims()
        accountPollerController?.resetZaloClaims()
        zaloServerClient.start(user, username, password)
        syncZaloBackgroundForCurrentUser('login')
        campaignScheduler.start({ initialDelayMs: CAMPAIGN_SCHEDULER_START_DELAY_MS })
        if (requiresLocalHandoff) scheduleLocalZaloHandoffRetry(handoffGeneration, 0)
      }
    },
    beforeLogout: async () => {
      clearSessionExpiryTimer()
      cancelLocalHandoffRetry()
      contactLoader.stopAll()
      campaignScheduler.stop()
      accountPollerController?.blockZaloRuntime()
      zaloServerClient.stop()
      runtimeCredentials = null
      zaloRealtimeGroupManager?.stop()
      await (accountZaloOperations?.stopAll() ?? zaloRuntime.cancelAllLoginQrAndWait())
      zaloRuntime.clearAll()
      emailRuntime.clearAll()
      await runScopedRecovery('logout')
      clearZaloLocalStartupHandoffBlock()
    },
    afterPasswordChange: async ({ newPassword }) => {
      if (!runtimeCredentials) return
      runtimeCredentials = { ...runtimeCredentials, password: newPassword }
      const user = getCurrentUser()
      if (user) zaloServerClient.start(user, runtimeCredentials.username, newPassword)
      if (isZaloLocalStartupHandoffBlocked()) {
        if (localHandoffRetryTimer) clearTimeout(localHandoffRetryTimer)
        localHandoffRetryTimer = null
        scheduleLocalZaloHandoffRetry(localHandoffGeneration, 0)
      }
    }
  })
  registerUpdateHandlers(mainWindow)
  registerAiHandlers()
  registerAkaBizIntegrationHandlers()
  registerCampaignImportHandlers()
  registerContentTemplateHandlers(supabase)
  registerMediaHandlers(supabase)
  registerCustomerFeedbackHandlers()
  registerEmailNotificationHandlers(supabase)
  registerReportHandlers(supabase)
  registerBrowserHandlers(webviewRegistry, pageRegistry)
  registerCampaignHandlers(supabase, {
    requestPauseCampaign: async (campaignId) => {
      const campaign = await supabase.getCampaign(campaignId)
      if (campaign) {
        const account = await supabase.getAccount(campaign.accountId)
        if (account?.flatformType === 'zalo') {
          if (isZaloLocalStartupHandoffBlocked()) {
            throw new Error(ZALO_LOCAL_STARTUP_HANDOFF_MESSAGE)
          }
          if (shouldRouteCurrentUserZaloCleanupToServer()) {
            return await zaloServerClient.executeCommand('campaign.pause', campaignId)
          }
        }
      }
      return campaignScheduler.requestPauseCampaign(campaignId)
    }
  }, zaloRealtimeGroupManager || undefined)
  accountZaloOperations = registerAccountHandlers(
    supabase,
    webviewRegistry,
    proxyRuntime,
    zaloRuntime,
    emailRuntime,
    mainWindow,
    zaloRealtimeGroupManager || undefined,
    zaloServerClient
  )
  registerAccountContactHandlers(supabase, contactLoader, zaloServerClient)
  registerV2Handlers(mainWindow, pageRegistry)

  // Start account login poller
  accountPollerController = startAccountPoller(webviewRegistry, mainWindow, zaloRuntime)
}
