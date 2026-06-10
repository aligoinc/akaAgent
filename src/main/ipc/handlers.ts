import { app, ipcMain, BrowserWindow } from 'electron'
import { IPC_EVENTS } from '../../shared/types'
import { WebviewRegistry } from '../playwright/webviewController'
import { PageControllerRegistry } from '../v2/runtime/pageController'
import { SupabaseService } from '../services/supabase'
import { CampaignScheduler } from '../services/campaignScheduler'
import { ContactLoader } from '../services/contactLoader'
import { ProxyRuntimeService } from '../services/proxyRuntimeService'
import { ZaloRuntimeService } from '../services/zaloRuntimeService'
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
import { registerContentTemplateHandlers } from './handlers/contentTemplateHandlers'
import { registerEmailNotificationHandlers } from './handlers/emailNotificationHandlers'
import { registerReportHandlers } from './handlers/reportHandlers'
import { getCurrentUser } from '../data/currentUser'
import { loadLoginSettingsForCurrentDevice, updateStartupSettingForCurrentDevice } from '../data/repositories/authRepository'
import { readBlockScreenshotDataUrl } from '../services/blockScreenshotService'

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

function getVietnamDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const supabase = new SupabaseService()
  const webviewRegistry = new WebviewRegistry()
  const pageRegistry = new PageControllerRegistry()
  const proxyRuntime = new ProxyRuntimeService((id) => supabase.getProxy(id))
  const zaloRuntime = new ZaloRuntimeService(
    supabase,
    (id) => supabase.getProxy(id),
    (event) => {
      try {
        mainWindow.webContents.send(IPC_EVENTS.ZALO_LOGIN_QR_EVENT, event)
        if (event.status === 'success' || event.status === 'error' || event.status === 'cancelled') {
          mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
        }
      } catch {
        // Window may be closed
      }
    }
  )
  const campaignScheduler = new CampaignScheduler(supabase, webviewRegistry, mainWindow, proxyRuntime)
  campaignScheduler.setPageRegistry(pageRegistry)
  const contactLoader = new ContactLoader(supabase, webviewRegistry, mainWindow, proxyRuntime)

  const runScopedRecovery = async (reason: 'login' | 'logout' | 'quit'): Promise<void> => {
    const user = getCurrentUser()
    if (!user) return
    try {
      await supabase.resetRunningStatuses(user.staffId)
    } catch (err) {
      console.error(`[Recovery] ${reason}: failed to reset running statuses:`, err)
    }
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
      quitCleanupCompleted = true
      return
    }

    event.preventDefault()
    quitCleanupStarted = true
    void (async () => {
      try {
        contactLoader.stopAll()
        campaignScheduler.stop()
        zaloRuntime.clearAll()
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

  // Register domain handlers
  registerAuthHandlers({
    afterLogin: async () => {
      try {
        await runScopedRecovery('login')
        await runScheduleMaintenance('login')
      } finally {
        warmZaloSessions()
        campaignScheduler.start()
      }
    },
    beforeLogout: async () => {
      contactLoader.stopAll()
      campaignScheduler.stop()
      zaloRuntime.clearAll()
      await runScopedRecovery('logout')
    }
  })
  registerUpdateHandlers(mainWindow)
  registerAiHandlers()
  registerAkaBizIntegrationHandlers()
  registerContentTemplateHandlers(supabase)
  registerEmailNotificationHandlers(supabase)
  registerReportHandlers(supabase)
  registerBrowserHandlers(webviewRegistry, pageRegistry)
  registerCampaignHandlers(supabase, campaignScheduler)
  registerAccountHandlers(supabase, webviewRegistry, proxyRuntime, zaloRuntime, mainWindow)
  registerAccountContactHandlers(supabase, contactLoader)
  registerV2Handlers(mainWindow, pageRegistry)

  // Start account login poller
  startAccountPoller(webviewRegistry, mainWindow, zaloRuntime)
}
