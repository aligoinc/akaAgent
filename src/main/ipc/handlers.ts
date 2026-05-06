import { ipcMain, BrowserWindow } from 'electron'
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

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const supabase = new SupabaseService()
  const webviewRegistry = new WebviewRegistry()
  const pageRegistry = new PageControllerRegistry()
  const campaignScheduler = new CampaignScheduler(supabase, webviewRegistry, mainWindow)
  campaignScheduler.setPageRegistry(pageRegistry)
  const contactLoader = new ContactLoader(supabase, webviewRegistry, mainWindow)

  // Startup reset
  supabase.resetRunningStatuses().catch(err => {
    console.error('Failed to reset running statuses:', err)
  })

  // Theme
  ipcMain.handle(IPC_EVENTS.THEME_CHANGE, (_, theme: 'light' | 'dark') => {
    if (theme === 'light') {
      mainWindow.setTitleBarOverlay({ color: '#7c3aed', symbolColor: '#ffffff' })
    } else {
      mainWindow.setTitleBarOverlay({ color: '#0a0a0f', symbolColor: '#a0a0b0' })
    }
  })

  // Register domain handlers
  registerAuthHandlers()
  registerUpdateHandlers(mainWindow)
  registerBrowserHandlers(webviewRegistry, pageRegistry)
  registerCampaignHandlers(supabase, campaignScheduler)
  registerAccountHandlers(supabase, webviewRegistry)
  registerAccountContactHandlers(supabase, contactLoader)
  registerV2Handlers(mainWindow, pageRegistry)

  // Start account login poller
  startAccountPoller(webviewRegistry, mainWindow)
}
