import { app, ipcMain, BrowserWindow, powerMonitor } from 'electron'
import { AuthEntitlements, AuthUser, IPC_EVENTS, ZaloLoginQrEvent } from '../../shared/types'
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
import { ZaloChatApiClient } from '../services/zaloChatApiClient'
import { DesktopZaloHandoffStore } from '../services/desktopZaloHandoffStore'
import { DailyMaintenanceCoordinator } from '../services/dailyMaintenanceCoordinator'
import { AutomationProcessor } from '../services/automationProcessor'
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
import { registerAppNotificationHandlers } from './handlers/appNotificationHandlers'
import { registerReportHandlers } from './handlers/reportHandlers'
import { emitAutomationUpdated, registerAutomationHandlers } from './handlers/automationHandlers'
import {
  getCurrentUser,
  setCurrentUser,
  setCurrentUserCredentials
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
  markZaloRuntimeRestartRequired
} from '../data/repositories/zaloRuntimeModeRepository'
import {
  ACCOUNT_EXPIRED_MESSAGE,
  getUserZaloAccountCapabilities,
  loadOrganizationAccountProducts,
  loadOrganizationEntitlementAccess
} from '../data/repositories/entitlementRepository'
import { readBlockScreenshotDataUrl } from '../services/blockScreenshotService'
import { readCampaignPreviewFileDataUrl } from '../services/campaignPreviewFileService'

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CAMPAIGN_SCHEDULER_START_DELAY_MS = 30 * 1000
const RUNTIME_ENTITLEMENT_REFRESH_INTERVAL_MS = 30 * 1000
const LOCAL_ZALO_HANDOFF_RETRY_INTERVAL_MS = 30 * 1000
const DESKTOP_HANDOFF_ACK_RETRY_INTERVAL_MS = 30 * 1000
const SESSION_EXPIRY_DAILY_CHECK_HOUR = 0
const SESSION_EXPIRY_DAILY_CHECK_MINUTE = 5
const LOGIN_RECOVERY_MAX_ATTEMPTS = 3
const LOGIN_RECOVERY_RETRY_DELAYS_MS = [1000, 3000] as const
const LOGIN_RECOVERY_FAILED_MESSAGE = 'Không thể khôi phục trạng thái tác vụ sau 3 lần thử. Ứng dụng chưa khởi chạy automation để tránh chạy trùng. Vui lòng kiểm tra kết nối và đăng nhập lại.'

const waitForRecoveryRetry = (delayMs: number): Promise<void> => (
  new Promise(resolve => setTimeout(resolve, delayMs))
)

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
  ipcMain.handle(IPC_EVENTS.ZALO_SERVER_OPERATION_STATE_GET, () => (
    zaloServerClient.getOperationState()
  ))
  const desktopZaloHandoffStore = new DesktopZaloHandoffStore()
  let runtimeCredentials: { username: string; password: string } | null = null
  let forceFullDesktopMaintenance = false
  let zaloRealtimeGroupManager: ZaloRealtimeGroupCampaignManager | null = null
  const emitZaloLoginQrEvent = (event: ZaloLoginQrEvent): void => {
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
  const zaloChatApiClient = new ZaloChatApiClient(emitZaloLoginQrEvent)
  const startZaloRemoteClients = (user: AuthUser, username: string, password: string): void => {
    if (user.organizationId === 1) {
      zaloServerClient.stop()
      zaloChatApiClient.start(user, username, password)
      return
    }
    zaloChatApiClient.stop()
    zaloServerClient.start(user, username, password)
  }
  const stopZaloRemoteClients = (): void => {
    zaloServerClient.stop()
    zaloChatApiClient.stop()
  }
  const zaloRuntime = new ZaloRuntimeService(
    supabase,
    (id) => supabase.getProxy(id),
    emitZaloLoginQrEvent,
    () => {
      try { mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch {}
    }
  )
  const emailRuntime = new EmailRuntimeService(supabase)
  const dailyMaintenance = new DailyMaintenanceCoordinator(async (dateKey) => {
    const user = getCurrentUser()
    if (!user) return
    const updatedCampaigns = await supabase.maintainCampaignSchedules(dateKey)
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
    loadClock: () => supabase.getRuntimeClock(),
    scopeKey: () => {
      const user = getCurrentUser()
      if (!user) return 'signed-out'
      return `${user.staffId}:desktop-owned`
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
  const automationProcessor = new AutomationProcessor({
    runtimeTarget: 'desktop',
    onUpdated: event => emitAutomationUpdated(mainWindow, event)
  })
  campaignScheduler.setPageRegistry(pageRegistry)
  const contactLoader = new ContactLoader(supabase, webviewRegistry, mainWindow, proxyRuntime, zaloRuntime)
  zaloRealtimeGroupManager = new ZaloRealtimeGroupCampaignManager(supabase, zaloRuntime, mainWindow)

  let restartRequiredActivation: Promise<void> | null = null
  let desktopZaloOwnershipRelinquished = false
  let accountZaloOperations: AccountZaloOperationController | null = null
  let accountPollerController: AccountPollerController | null = null
  let localHandoffGeneration = 0
  let localHandoffRetryTimer: ReturnType<typeof setTimeout> | null = null
  let localHandoffRetryRunningGeneration: number | null = null
  let desktopHandoffAckGeneration = 0
  let desktopHandoffAckRetryTimer: ReturnType<typeof setTimeout> | null = null

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

  const acknowledgeDesktopHandoffMarker = async (
    staffId: number,
    organizationId: number,
    credentials: { username: string; password: string }
  ): Promise<boolean> => {
    const marker = desktopZaloHandoffStore.get(staffId, organizationId)
    if (!marker) return false

    try {
      const liveMode = await loadStaffZaloServerModeSnapshot(staffId)
      if (!liveMode.isZaloServer || liveMode.revision !== marker.expectedModeRevision) {
        desktopZaloHandoffStore.clear(staffId, organizationId, marker.expectedModeRevision)
        console.info('[RuntimeHandoff] Removed stale desktop handoff marker.')
        return false
      }

      const result = await zaloServerClient.requestDesktopHandoffReady(
        credentials.username,
        credentials.password,
        marker.expectedModeRevision
      )
      if (!result.success || !result.serverReady) {
        console.warn('[RuntimeHandoff] Zalo Server has not accepted the desktop handoff yet:', result)
        return false
      }
      desktopZaloHandoffStore.clear(staffId, organizationId, marker.expectedModeRevision)
      return true
    } catch (error) {
      console.warn('[RuntimeHandoff] Failed to acknowledge desktop-to-server handoff:', error)
      // Distinguish a live revision race from a transient endpoint failure.
      // During the old desktop's live activation, clearing a stale marker lets
      // the caller immediately save fresh proof for the new exact revision.
      try {
        const liveMode = await loadStaffZaloServerModeSnapshot(staffId)
        if (!liveMode.isZaloServer || liveMode.revision !== marker.expectedModeRevision) {
          desktopZaloHandoffStore.clear(staffId, organizationId, marker.expectedModeRevision)
        }
      } catch {
        // Keep the durable marker when live state cannot be revalidated. It is
        // retried conservatively after the next server-mode login.
      }
      return false
    }
  }

  const canDeferDesktopHandoffAcknowledgement = async (staffId: number): Promise<boolean> => {
    try {
      const runningState = await supabase.inspectStaffZaloRunningState(staffId)
      if (runningState.hasRunningState) {
        console.warn('[RuntimeHandoff] VPS acknowledgement is still required because Zalo rows are running:', runningState)
        return false
      }
      return true
    } catch (error) {
      // Without either a VPS acknowledgement or a clean DB snapshot, a local
      // marker is not sufficient proof for a future server process.
      console.warn('[RuntimeHandoff] Cannot prove the Zalo database is clean yet:', error)
      return false
    }
  }

  const settleDesktopHandoffMarkerBeforeExit = async (
    staffId: number,
    organizationId: number
  ): Promise<void> => {
    while (desktopZaloHandoffStore.get(staffId, organizationId)) {
      const credentials = runtimeCredentials
      if (!credentials) return
      const acknowledged = await acknowledgeDesktopHandoffMarker(
        staffId,
        organizationId,
        { ...credentials }
      )
      if (acknowledged || !desktopZaloHandoffStore.get(staffId, organizationId)) return
      if (await canDeferDesktopHandoffAcknowledgement(staffId)) return
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  const cancelDesktopHandoffAckRetry = (): void => {
    desktopHandoffAckGeneration += 1
    if (desktopHandoffAckRetryTimer) clearTimeout(desktopHandoffAckRetryTimer)
    desktopHandoffAckRetryTimer = null
  }

  const scheduleDesktopHandoffAckRetry = (
    staffId: number,
    organizationId: number,
    generation: number,
    delayMs = DESKTOP_HANDOFF_ACK_RETRY_INTERVAL_MS
  ): void => {
    if (
      generation !== desktopHandoffAckGeneration ||
      desktopHandoffAckRetryTimer ||
      !desktopZaloHandoffStore.get(staffId, organizationId)
    ) {
      return
    }
    desktopHandoffAckRetryTimer = setTimeout(() => {
      desktopHandoffAckRetryTimer = null
      void (async () => {
        const user = getCurrentUser()
        const credentials = runtimeCredentials
        if (
          generation !== desktopHandoffAckGeneration ||
          !user ||
          user.staffId !== staffId ||
          user.organizationId !== organizationId ||
          !user.isZaloServer ||
          !credentials
        ) {
          return
        }
        const acknowledged = await acknowledgeDesktopHandoffMarker(
          staffId,
          organizationId,
          { ...credentials }
        )
        if (
          !acknowledged &&
          generation === desktopHandoffAckGeneration &&
          desktopZaloHandoffStore.get(staffId, organizationId)
        ) {
          scheduleDesktopHandoffAckRetry(staffId, organizationId, generation)
        }
      })()
    }, delayMs)
  }

  const activateZaloRuntimeRestartRequired = (
    liveIsZaloServer: boolean,
    liveIsZaloShowWeb = false
  ): Promise<void> => {
    const activationUser = getCurrentUser()
    const activationCredentials = runtimeCredentials ? { ...runtimeCredentials } : null
    const payload = markZaloRuntimeRestartRequired(liveIsZaloServer, liveIsZaloShowWeb)
    notifyRendererZaloRuntimeRestartRequired(payload)
    if (restartRequiredActivation) return restartRequiredActivation

    // Show Web is intentionally a restart-only setting. Do not add handoff,
    // ownership, cleanup or "mode changed while running" coordination here;
    // the user closes and reopens the app to apply the new browser mode.
    if (activationUser?.isZaloShowWeb !== liveIsZaloShowWeb) {
      restartRequiredActivation = Promise.resolve()
      return restartRequiredActivation
    }

    cancelLocalHandoffRetry()
    cancelDesktopHandoffAckRetry()
    clearZaloLocalStartupHandoffBlock()
    campaignScheduler.blockZaloRuntimeForRestart(null)
    contactLoader.blockZaloRuntimeForRestart()
    accountPollerController?.blockZaloRuntime()
    zaloRealtimeGroupManager?.stop()
    stopZaloRemoteClients()

    const activation = (async () => {
      if (!activationUser) return
      while (true) {
        const currentUser = getCurrentUser()
        if (!currentUser || currentUser.staffId !== activationUser.staffId) return
        try {
          const qrSettled = await (accountZaloOperations?.stopAll() ?? zaloRuntime.cancelAllLoginQrAndWait())
          // Keep an unresolved QR entry visible to the final quit cleanup. The
          // cache/version invalidation still prevents that old login from
          // publishing a success or caching an API after the mode changed.
          zaloRuntime.clearAll({ preserveActiveQrLogins: !qrSettled })

          const [schedulerIdle, contactLoaderIdle, realtimeIdle, directOperationsIdle, accountPollerIdle, warmSessionsIdle] = await Promise.all([
            campaignScheduler.waitForZaloIdle(30_000),
            contactLoader.waitForIdle(30_000, 'zalo'),
            zaloRealtimeGroupManager?.waitForIdle(30_000) ?? Promise.resolve(true),
            accountZaloOperations?.waitForIdle(30_000) ?? Promise.resolve(true),
            accountPollerController?.waitForZaloIdle(30_000) ?? Promise.resolve(true),
            zaloRuntime.waitForWarmSessionsIdle(30_000)
          ])
          if (qrSettled && schedulerIdle && contactLoaderIdle && realtimeIdle && directOperationsIdle && accountPollerIdle && warmSessionsIdle) {
            break
          }
          console.warn('[RuntimeMode] Waiting for every desktop Zalo producer to settle before handoff.')
        } catch (error) {
          // A rejected stop/wait is not evidence of idle. Keep the app alive
          // and retry so quit/logout cannot silently abandon unproven work.
          console.warn('[RuntimeMode] Failed to settle desktop Zalo producers; retrying:', error)
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      if (!liveIsZaloServer || activationUser.isZaloServer || !activationCredentials) return

      // From this point the old local session must never bulk-reset Zalo again,
      // even if the product flag flips back to local before the process exits.
      // A later local session performs the revision-guarded recovery instead.
      desktopZaloOwnershipRelinquished = true
      campaignScheduler.abandonZaloRuntimeClaims()
      contactLoader.abandonZaloRuntimeClaims()
      zaloRealtimeGroupManager?.abandonZaloRuntimeClaims()
      zaloRuntime.abandonWarmSessionClaims()
      accountZaloOperations?.abandonClaims()
      accountPollerController?.abandonZaloClaims()

      while (true) {
        try {
          const currentUser = getCurrentUser()
          if (!currentUser || currentUser.staffId !== activationUser.staffId) return
          const liveMode = await loadStaffZaloServerModeSnapshot(activationUser.staffId)
          if (!liveMode.isZaloServer) return

          // Save proof before contacting the VPS. If the endpoint is offline or
          // the app closes immediately, the next server-mode login may retry only
          // this exact entitlement revision.
          desktopZaloHandoffStore.save({
            staffId: activationUser.staffId,
            organizationId: activationUser.organizationId,
            expectedModeRevision: liveMode.revision
          })
          const latestCredentials = runtimeCredentials
            ? { ...runtimeCredentials }
            : activationCredentials
          const acknowledged = await acknowledgeDesktopHandoffMarker(
            activationUser.staffId,
            activationUser.organizationId,
            latestCredentials
          )
          if (acknowledged) return
          // A preserved marker means only the endpoint failed. A cleared marker
          // means the revision changed, so this still-idle desktop loops and
          // creates proof for the new live server transition.
          if (desktopZaloHandoffStore.get(activationUser.staffId, activationUser.organizationId)) {
            // A local marker is only a retry aid. The VPS cannot read it, so a
            // graceful exit may defer acknowledgement only when DB is clean.
            if (await canDeferDesktopHandoffAcknowledgement(activationUser.staffId)) return
            await new Promise(resolve => setTimeout(resolve, 5000))
            continue
          }
          await new Promise(resolve => setTimeout(resolve, 1000))
        } catch (error) {
          // Do not authorize server recovery unless the durable proof was saved.
          // Quit/logout waits for this activation, so retry a failed disk write.
          console.warn('[RuntimeMode] Cannot persist desktop handoff proof yet; retrying:', error)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
    })()
    restartRequiredActivation = activation
    return activation
  }

  const ensureDesktopZaloHandoffBeforeExit = async (): Promise<void> => {
    const sessionUser = getCurrentUser()
    // Server control clients do not own local Zalo work. A session with Web
    // capability also owns QR accounts locally, so it must not skip the
    // existing local<->server handoff checks.
    if (sessionUser?.isZaloServer) return
    if (sessionUser) {
      await settleDesktopHandoffMarkerBeforeExit(
        sessionUser.staffId,
        sessionUser.organizationId
      )
    }
    if (
      !sessionUser ||
      sessionUser.isZaloServer ||
      !sessionUser.entitlements.zalo ||
      desktopZaloOwnershipRelinquished
    ) {
      return
    }
    if (restartRequiredActivation) {
      await restartRequiredActivation
      return
    }

    try {
      const pendingRestart = getZaloRuntimeRestartRequired()
      if (pendingRestart?.databaseIsZaloServer) {
        await activateZaloRuntimeRestartRequired(true)
        return
      }
      const liveMode = await loadStaffZaloServerModeSnapshot(sessionUser.staffId)
      const currentUser = getCurrentUser()
      if (!currentUser || currentUser.staffId !== sessionUser.staffId) return
      if (liveMode.isZaloServer) {
        await activateZaloRuntimeRestartRequired(true)
      }
    } catch (error) {
      // Do not make every local quit depend on network availability. The
      // following reset RPC is the atomic second check and will trigger the
      // handoff if it observes server mode after this read failed/raced.
      console.warn('[RuntimeHandoff] Cannot preflight desktop ownership before exit:', error)
    }
  }

  const runScopedRecovery = async (
    reason: 'login' | 'logout' | 'quit',
    options: { excludeZalo?: boolean; zaloUncertainNoRetry?: boolean } = {}
  ): Promise<boolean> => {
    const maxAttempts = reason === 'login' ? LOGIN_RECOVERY_MAX_ATTEMPTS : 1

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
          throw new Error('Các tiến trình automation chưa dừng hoàn toàn; recovery đã được hoãn để tránh chạy trùng.')
        }

        campaignScheduler.abandonZaloRuntimeClaims()
        contactLoader.abandonZaloRuntimeClaims()
        zaloRealtimeGroupManager?.abandonZaloRuntimeClaims()
        zaloRuntime.abandonWarmSessionClaims()
        accountZaloOperations?.abandonClaims()
        accountPollerController?.abandonZaloClaims()
        // Migration v219 resolves Zalo ownership from each account. The legacy
        // flag remains in the RPC contract, but this desktop must never exclude
        // every Zalo row merely because the old global snapshot says Server.
        const excludeZalo = options.excludeZalo === true
        const zaloUncertainNoRetry = options.zaloUncertainNoRetry ?? true
        await supabase.resetDesktopRunningStatuses(
          user.staffId,
          excludeZalo,
          zaloUncertainNoRetry
        )
        try {
          await supabase.enableDueAccountActions()
        } catch (error) {
          console.warn(`[Recovery] ${reason}: status recovery succeeded but due account actions could not be enabled:`, error)
        }
        return true
      } catch (err) {
        console.error(`[Recovery] ${reason}: attempt ${attempt}/${maxAttempts} failed:`, err)
        if (attempt < maxAttempts) {
          const retryDelay = LOGIN_RECOVERY_RETRY_DELAYS_MS[attempt - 1] ?? LOGIN_RECOVERY_RETRY_DELAYS_MS.at(-1)!
          await waitForRecoveryRetry(retryDelay)
        }
      }
    }

    return false
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
    cancelDesktopHandoffAckRetry()
    try {
      contactLoader.stopAll()
      campaignScheduler.stop()
      await automationProcessor.stop()
      accountPollerController?.blockZaloRuntime()
      stopZaloRemoteClients()
      zaloRealtimeGroupManager?.stop()
      await (accountZaloOperations?.stopAll() ?? zaloRuntime.cancelAllLoginQrAndWait())
      await restartRequiredActivation?.catch(() => {})
      zaloRuntime.clearAll()
      emailRuntime.clearAll()
      await runScopedRecovery('logout')
      runtimeCredentials = null
    } catch (err) {
      console.error(`[AuthSessionExpiry] ${reason}: failed to clean up expired session:`, err)
    } finally {
      runtimeCredentials = null
      clearZaloLocalStartupHandoffBlock()
      setCurrentUserCredentials(null)
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
      const [liveEntitlementAccess, liveAccountProducts] = await Promise.all([
        loadOrganizationEntitlementAccess(checkedUser.organizationId),
        loadOrganizationAccountProducts(checkedUser.organizationId)
      ])
      const liveEntitlements = liveEntitlementAccess.entitlements
      const currentUser = getCurrentUser()
      if (!currentUser || currentUser.staffId !== checkedUser.staffId) return

      if (!hasAnyEntitlement(liveEntitlements)) {
        await expireCurrentSession(reason)
        return
      }

      // Web and Server are additive capabilities in v219, not global runtime
      // modes. Apply changes immediately; stored account subtypes stay intact.
      const nextZaloAccountCapabilities = liveEntitlementAccess.zaloAccountCapabilities
      const updatedUser = {
        ...currentUser,
        entitlements: liveEntitlements,
        accountProducts: liveAccountProducts,
        zaloAccountCapabilities: nextZaloAccountCapabilities
      }
      const entitlementsChanged = !authEntitlementsEqual(currentUser.entitlements, liveEntitlements)
      const accountProductsChanged = JSON.stringify(currentUser.accountProducts || []) !== JSON.stringify(liveAccountProducts)
      const zaloCapabilitiesChanged = JSON.stringify(currentUser.zaloAccountCapabilities)
        !== JSON.stringify(nextZaloAccountCapabilities)
      if (reason !== 'login' && (
        entitlementsChanged ||
        accountProductsChanged ||
        zaloCapabilitiesChanged
      )) {
        setCurrentUser(updatedUser)
        if (runtimeCredentials) {
          startZaloRemoteClients(updatedUser, runtimeCredentials.username, runtimeCredentials.password)
        }
        syncZaloBackgroundForCurrentUser(`${reason}-entitlement-refresh`)
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
    const zaloCapabilities = getUserZaloAccountCapabilities(user)
    if (user?.entitlements?.zalo && zaloCapabilities.qr) {
      // Only QR accounts use stored zca-js sessions and realtime. Web accounts
      // remain attached independently through their visible browser tabs.
      warmZaloSessions()
      zaloRealtimeGroupManager?.start()
      return
    }

    zaloRealtimeGroupManager?.stop()
    zaloRuntime.clearAll()
    stopZaloRemoteClients()
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

  const runScheduleMaintenance = async (reason: 'login' | 'resume'): Promise<void> => {
    if (!getCurrentUser()) return
    try {
      await dailyMaintenance.ensureReady()
    } catch (err) {
      console.error(`[ScheduleMaintenance] ${reason} failed:`, err)
      throw err
    }
  }

  powerMonitor.on('suspend', () => {
    supabase.invalidateRuntimeClock()
  })

  powerMonitor.on('resume', () => {
    supabase.invalidateRuntimeClock()
    if (!getCurrentUser()) return
    void runScheduleMaintenance('resume').catch(() => {})
  })

  setInterval(() => {
    if (!getCurrentUser()) return
    void runSessionExpiryCheck('runtime')
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
        cancelDesktopHandoffAckRetry()
        contactLoader.stopAll()
        campaignScheduler.stop()
        await automationProcessor.stop()
        accountPollerController?.blockZaloRuntime()
        stopZaloRemoteClients()
        zaloRealtimeGroupManager?.stop()
        await (accountZaloOperations?.stopAll() ?? zaloRuntime.cancelAllLoginQrAndWait())
        await restartRequiredActivation?.catch(() => {})
        zaloRuntime.clearAll()
        emailRuntime.clearAll()
        await runScopedRecovery('quit')
        runtimeCredentials = null
      } catch (err) {
        console.error('[Recovery] quit: failed to reset running statuses:', err)
      } finally {
        runtimeCredentials = null
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
      cancelDesktopHandoffAckRetry()
      const handoffAckGeneration = desktopHandoffAckGeneration
      clearZaloLocalStartupHandoffBlock()
      clearZaloRuntimeRestartRequired()
      restartRequiredActivation = null
      desktopZaloOwnershipRelinquished = false
      campaignScheduler.resetZaloRuntimeRestartBlock()
      contactLoader.resetZaloRuntimeRestartBlock()
      accountPollerController?.resetZaloRuntimeBlock()
      runtimeCredentials = { username, password }
      const loginUser = getCurrentUser()
      try {
        if (loginUser && getUserZaloAccountCapabilities(loginUser).server) {
          // Do not put the login screen behind VPS availability. A marker from
          // an older local runtime is acknowledged in the bounded background
          // retry loop while this desktop remains a DB-backed control client.
          if (desktopZaloHandoffStore.get(loginUser.staffId, loginUser.organizationId)) {
            scheduleDesktopHandoffAckRetry(
              loginUser.staffId,
              loginUser.organizationId,
              handoffAckGeneration,
              0
            )
          }
        }
        const recovered = await runScopedRecovery('login')
        if (!recovered) throw new Error(LOGIN_RECOVERY_FAILED_MESSAGE)

        try {
          await runScheduleMaintenance('login')
        } catch (error) {
          console.warn('[Maintenance] login: recovery succeeded but schedule maintenance failed:', error)
        }
        await runSessionExpiryCheck('login')
        const user = getCurrentUser()
        if (!user) throw new Error(ACCOUNT_EXPIRED_MESSAGE)
        campaignScheduler.resetZaloRuntimeClaims()
        contactLoader.resetZaloRuntimeClaims()
        zaloRealtimeGroupManager?.resetZaloRuntimeClaims()
        zaloRuntime.resetWarmSessionClaims()
        accountZaloOperations?.resetClaims()
        accountPollerController?.resetZaloClaims()
        startZaloRemoteClients(user, username, password)
        syncZaloBackgroundForCurrentUser('login')
        campaignScheduler.start({ initialDelayMs: CAMPAIGN_SCHEDULER_START_DELAY_MS })
        await automationProcessor.start()
      } catch (error) {
        cancelLocalHandoffRetry()
        cancelDesktopHandoffAckRetry()
        contactLoader.stopAll()
        campaignScheduler.stop()
        await automationProcessor.stop().catch(() => {})
        accountPollerController?.blockZaloRuntime()
        stopZaloRemoteClients()
        zaloRealtimeGroupManager?.stop()
        await (accountZaloOperations?.stopAll() ?? zaloRuntime.cancelAllLoginQrAndWait()).catch(() => {})
        const cleanupIdle = await Promise.all([
          campaignScheduler.waitForIdle(30_000),
          contactLoader.waitForIdle(30_000),
          automationProcessor.waitForIdle(30_000),
          zaloRealtimeGroupManager?.waitForIdle(30_000) ?? Promise.resolve(true),
          accountZaloOperations?.waitForIdle(30_000) ?? Promise.resolve(true),
          accountPollerController?.waitForZaloIdle(30_000) ?? Promise.resolve(true),
          zaloRuntime.waitForWarmSessionsIdle(30_000)
        ])
        if (cleanupIdle.some(idle => !idle)) {
          console.warn('[Recovery] login cleanup did not become fully idle before auth was cleared.')
        }
        zaloRuntime.clearAll()
        emailRuntime.clearAll()
        runtimeCredentials = null
        clearZaloLocalStartupHandoffBlock()
        throw error
      }
    },
    beforeLogout: async () => {
      clearSessionExpiryTimer()
      cancelLocalHandoffRetry()
      cancelDesktopHandoffAckRetry()
      contactLoader.stopAll()
      campaignScheduler.stop()
      await automationProcessor.stop()
      accountPollerController?.blockZaloRuntime()
      stopZaloRemoteClients()
      zaloRealtimeGroupManager?.stop()
      await (accountZaloOperations?.stopAll() ?? zaloRuntime.cancelAllLoginQrAndWait())
      await restartRequiredActivation?.catch(() => {})
      zaloRuntime.clearAll()
      emailRuntime.clearAll()
      await runScopedRecovery('logout')
      runtimeCredentials = null
      clearZaloLocalStartupHandoffBlock()
    },
    afterPasswordChange: async ({ newPassword }) => {
      if (!runtimeCredentials) return
      runtimeCredentials = { ...runtimeCredentials, password: newPassword }
      const user = getCurrentUser()
      if (user) startZaloRemoteClients(user, runtimeCredentials.username, newPassword)
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
  registerAppNotificationHandlers(supabase)
  registerReportHandlers(supabase)
  registerAutomationHandlers(mainWindow)
  registerBrowserHandlers(webviewRegistry, pageRegistry, {
    onRegister: async (accountId, webContents, platformType) => {
      // Facebook and other browser platforms must not depend on an extra DB
      // round trip before their initial URL can load. ZaloRuntimeService still
      // verifies the account/platform server-side before attaching Web mode.
      if (platformType !== 'zalo') return
      await zaloRuntime.attachWebSession(accountId, webContents)
    },
    onUnregister: (accountId) => {
      zaloRuntime.detachWebSession(accountId)
    }
  })
  registerCampaignHandlers(supabase, {
    requestCampaignStatus: async (campaignId, status) => {
      const campaign = await supabase.getCampaign(campaignId)
      if (!campaign) throw new Error('Không tìm thấy chiến dịch.')

      const account = await supabase.getAccount(campaign.accountId)
      if (!account && String(campaign.actionId || '').startsWith('zalo_')) {
        throw new Error('Tài khoản Zalo của chiến dịch không còn phù hợp với gói hiện tại.')
      }
      if (account?.flatformType === 'zalo') {
        if (account.isZaloServer) {
          const result = await supabase.setZaloServerCampaignStatus(campaignId, status)
          if (!result.ok) {
            if (result.reason === 'runtime_not_owner') {
              throw new Error('Organization không còn chạy Zalo Server. Vui lòng tắt và mở lại ứng dụng.')
            }
            if (result.reason === 'not_found') throw new Error('Không tìm thấy chiến dịch.')
            if (result.reason === 'invalid_transition') {
              throw new Error('Trạng thái chiến dịch đã thay đổi. Vui lòng thử lại.')
            }
            throw new Error('Không thể cập nhật trạng thái chiến dịch Zalo Server.')
          }
          const updated = await supabase.getCampaign(campaignId)
          if (!updated) throw new Error('Không tìm thấy chiến dịch.')
          return updated
        }
      }

      if (status === 'tạm dừng') {
        return campaignScheduler.requestPauseCampaign(campaignId)
      }
      return supabase.updateCampaign(campaignId, { status: 'chờ xử lý' })
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
    zaloServerClient,
    zaloChatApiClient
  )
  registerAccountContactHandlers(supabase, contactLoader, zaloServerClient)
  registerV2Handlers(mainWindow, pageRegistry)

  // Start account login poller
  accountPollerController = startAccountPoller(webviewRegistry, mainWindow, zaloRuntime)
}
