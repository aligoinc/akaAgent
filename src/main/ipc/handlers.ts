import { app, ipcMain, BrowserWindow } from 'electron'
import { IPC_EVENTS } from '../../shared/types'
import { WebviewRegistry } from '../playwright/webviewController'
import { PageControllerRegistry } from '../v2/runtime/pageController'
import { SupabaseService } from '../services/supabase'
import { CampaignScheduler } from '../services/campaignScheduler'
import { ContactLoader } from '../services/contactLoader'
import { startAccountPoller } from '../domain/accounts/accountPoller'

import { registerBrowserHandlers } from './handlers/browserHandlers'
import { registerCampaignHandlers } from './handlers/campaignHandlers'
import { registerAccountHandlers } from './handlers/accountHandlers'
import { registerAccountContactHandlers } from './handlers/accountContactHandlers'
import { registerAuthHandlers } from './handlers/authHandlers'
import { registerUpdateHandlers } from './handlers/updateHandlers'
import { registerV2Handlers } from './handlers/v2Handlers'
import { getCurrentUser } from '../data/currentUser'

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
  const campaignScheduler = new CampaignScheduler(supabase, webviewRegistry, mainWindow)
  campaignScheduler.setPageRegistry(pageRegistry)
  const contactLoader = new ContactLoader(supabase, webviewRegistry, mainWindow)

  // Startup reset
  const startupReset = supabase.resetRunningStatuses().catch(err => {
    console.error('Failed to reset running statuses:', err)
  })

  let lastScheduleMaintenanceDay = getVietnamDateKey()
  let scheduleMaintenanceRunning = false
  const runScheduleMaintenance = async (reason: 'login' | 'new-day'): Promise<void> => {
    if (!getCurrentUser() || scheduleMaintenanceRunning) return
    scheduleMaintenanceRunning = true
    try {
      await startupReset
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
  ipcMain.handle(IPC_EVENTS.APP_GET_STARTUP_SETTING, () => {
    return { enabled: app.getLoginItemSettings().openAtLogin }
  })

  ipcMain.handle(IPC_EVENTS.APP_SET_STARTUP_SETTING, (_, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled })
    return { enabled: app.getLoginItemSettings().openAtLogin }
  })

  // Register domain handlers
  registerAuthHandlers(() => runScheduleMaintenance('login'))
  registerUpdateHandlers(mainWindow)
  registerBrowserHandlers(webviewRegistry, pageRegistry)
  registerCampaignHandlers(supabase, campaignScheduler)
  registerAccountHandlers(supabase, webviewRegistry)
  registerAccountContactHandlers(supabase, contactLoader)
  registerV2Handlers(mainWindow, pageRegistry)

  // Start account login poller
  startAccountPoller(webviewRegistry, mainWindow)
}
