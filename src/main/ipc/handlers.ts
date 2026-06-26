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
import { startAccountPoller } from '../domain/accounts/accountPoller'

import { registerBrowserHandlers } from './handlers/browserHandlers'
import { registerCampaignHandlers } from './handlers/campaignHandlers'
import { registerAccountHandlers } from './handlers/accountHandlers'
import { registerAccountContactHandlers } from './handlers/accountContactHandlers'
import { registerAuthHandlers } from './handlers/authHandlers'
import { registerUpdateHandlers } from './handlers/updateHandlers'
import { registerV2Handlers } from './handlers/v2Handlers'
import { registerAiHandlers } from './handlers/aiHandlers'
import { registerAkaBizIntegrationHandlers } from './handlers/akaBizIntegrationHandlers'
import { registerCampaignImportHandlers } from './handlers/campaignImportHandlers'
import { registerContentTemplateHandlers } from './handlers/contentTemplateHandlers'
import { registerEmailNotificationHandlers } from './handlers/emailNotificationHandlers'
import { registerReportHandlers } from './handlers/reportHandlers'
import { getCurrentUser, setCurrentUser } from '../data/currentUser'
import { loadLoginSettingsForCurrentDevice, updateStartupSettingForCurrentDevice } from '../data/repositories/authRepository'
import {
  ACCOUNT_EXPIRED_MESSAGE,
  loadOrganizationAccountProducts,
  loadOrganizationEntitlements
} from '../data/repositories/entitlementRepository'
import { readBlockScreenshotDataUrl } from '../services/blockScreenshotService'
import { readCampaignPreviewFileDataUrl } from '../services/campaignPreviewFileService'

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CAMPAIGN_SCHEDULER_START_DELAY_MS = 30 * 1000
const SESSION_EXPIRY_DAILY_CHECK_HOUR = 0
const SESSION_EXPIRY_DAILY_CHECK_MINUTE = 5

function getVietnamDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

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
    entitlements?.zalo
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
    (left?.dailySendLimits?.facebookCore ?? null) === (right?.dailySendLimits?.facebookCore ?? null) &&
    (left?.dailySendLimits?.facebookFanpage ?? null) === (right?.dailySendLimits?.facebookFanpage ?? null) &&
    (left?.dailySendLimits?.email ?? null) === (right?.dailySendLimits?.email ?? null) &&
    (left?.dailySendLimits?.zalo ?? null) === (right?.dailySendLimits?.zalo ?? null)
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const supabase = new SupabaseService()
  const webviewRegistry = new WebviewRegistry()
  const pageRegistry = new PageControllerRegistry()
  const proxyRuntime = new ProxyRuntimeService((id) => supabase.getProxy(id))
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
  const campaignScheduler = new CampaignScheduler(supabase, webviewRegistry, mainWindow, proxyRuntime, zaloRuntime, emailRuntime)
  campaignScheduler.setPageRegistry(pageRegistry)
  const contactLoader = new ContactLoader(supabase, webviewRegistry, mainWindow, proxyRuntime, zaloRuntime)
  zaloRealtimeGroupManager = new ZaloRealtimeGroupCampaignManager(supabase, zaloRuntime, mainWindow)

  const runScopedRecovery = async (reason: 'login' | 'logout' | 'quit'): Promise<void> => {
    const user = getCurrentUser()
    if (!user) return
    try {
      await supabase.resetRunningStatuses(user.staffId)
    } catch (err) {
      console.error(`[Recovery] ${reason}: failed to reset running statuses:`, err)
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

  const expireCurrentSession = async (reason: 'login' | 'daily'): Promise<void> => {
    const user = getCurrentUser()
    if (!user) return

    clearSessionExpiryTimer()
    try {
      contactLoader.stopAll()
      campaignScheduler.stop()
      zaloRealtimeGroupManager?.stop()
      zaloRuntime.clearAll()
      emailRuntime.clearAll()
      await supabase.resetRunningStatuses(user.staffId)
    } catch (err) {
      console.error(`[AuthSessionExpiry] ${reason}: failed to clean up expired session:`, err)
    } finally {
      setCurrentUser(null)
      notifyRendererSessionExpired()
    }
  }

  const runSessionExpiryCheck = async (reason: 'login' | 'daily'): Promise<void> => {
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

      const updatedUser = { ...currentUser, entitlements: liveEntitlements, accountProducts: liveAccountProducts }
      const entitlementsChanged = !authEntitlementsEqual(currentUser.entitlements, liveEntitlements)
      const accountProductsChanged = JSON.stringify(currentUser.accountProducts || []) !== JSON.stringify(liveAccountProducts)
      setCurrentUser(updatedUser)
      if (reason === 'daily') {
        syncZaloBackgroundForCurrentUser('daily-entitlement-refresh')
        if (entitlementsChanged || accountProductsChanged) notifyRendererUserUpdated(updatedUser)
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
    void zaloRuntime.warmStoredSessions()
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
    if (user?.entitlements?.zalo) {
      warmZaloSessions()
      zaloRealtimeGroupManager?.start()
      return
    }

    zaloRealtimeGroupManager?.stop()
    zaloRuntime.clearAll()
  }

  let lastScheduleMaintenanceDay = getVietnamDateKey()
  let scheduleMaintenanceRunning = false
  const runScheduleMaintenance = async (reason: 'login' | 'new-day'): Promise<void> => {
    if (!getCurrentUser() || scheduleMaintenanceRunning) return
    scheduleMaintenanceRunning = true
    try {
      const updatedCampaigns = await supabase.maintainCampaignSchedules()
      for (const campaign of updatedCampaigns) {
        try {
          mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, campaign)
        } catch {
          // Window may be closed
        }
      }
      if (updatedCampaigns.length > 0) {
        console.log(`[ScheduleMaintenance] ${reason}: updated ${updatedCampaigns.length} campaign schedules.`)
      }
    } catch (err) {
      console.error('Failed to maintain campaign schedules:', err)
    } finally {
      lastScheduleMaintenanceDay = getVietnamDateKey()
      scheduleMaintenanceRunning = false
    }
  }

  setInterval(() => {
    const todayKey = getVietnamDateKey()
    if (todayKey === lastScheduleMaintenanceDay) return
    if (!getCurrentUser()) {
      lastScheduleMaintenanceDay = todayKey
      return
    }
    void runScheduleMaintenance('new-day')
  }, 60 * 1000)

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
        contactLoader.stopAll()
        campaignScheduler.stop()
        zaloRealtimeGroupManager?.stop()
        zaloRuntime.clearAll()
        emailRuntime.clearAll()
        await supabase.resetRunningStatuses(user.staffId)
      } catch (err) {
        console.error('[Recovery] quit: failed to reset running statuses:', err)
      } finally {
        quitCleanupCompleted = true
        app.quit()
      }
    })()
  })

  // Theme
  ipcMain.handle(IPC_EVENTS.THEME_CHANGE, (_, theme: 'light' | 'dark') => {
    if (typeof mainWindow.setTitleBarOverlay !== 'function') return
    if (theme === 'light') {
      mainWindow.setTitleBarOverlay({ color: '#7c3aed', symbolColor: '#ffffff' })
    } else {
      mainWindow.setTitleBarOverlay({ color: '#0a0a0f', symbolColor: '#a0a0b0' })
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

  // Register domain handlers
  registerAuthHandlers({
    afterLogin: async () => {
      try {
        await runScopedRecovery('login')
        await runScheduleMaintenance('login')
      } finally {
        await runSessionExpiryCheck('login')
        if (!getCurrentUser()) return
        syncZaloBackgroundForCurrentUser('login')
        campaignScheduler.start({ initialDelayMs: CAMPAIGN_SCHEDULER_START_DELAY_MS })
      }
    },
    beforeLogout: async () => {
      clearSessionExpiryTimer()
      contactLoader.stopAll()
      campaignScheduler.stop()
      zaloRealtimeGroupManager?.stop()
      zaloRuntime.clearAll()
      emailRuntime.clearAll()
      await runScopedRecovery('logout')
    }
  })
  registerUpdateHandlers(mainWindow)
  registerAiHandlers()
  registerAkaBizIntegrationHandlers()
  registerCampaignImportHandlers()
  registerContentTemplateHandlers(supabase)
  registerEmailNotificationHandlers(supabase)
  registerReportHandlers(supabase)
  registerBrowserHandlers(webviewRegistry, pageRegistry)
  registerCampaignHandlers(supabase, campaignScheduler, zaloRealtimeGroupManager || undefined)
  registerAccountHandlers(supabase, webviewRegistry, proxyRuntime, zaloRuntime, emailRuntime, mainWindow, zaloRealtimeGroupManager || undefined)
  registerAccountContactHandlers(supabase, contactLoader)
  registerV2Handlers(mainWindow, pageRegistry)

  // Start account login poller
  startAccountPoller(webviewRegistry, mainWindow, zaloRuntime)
}
