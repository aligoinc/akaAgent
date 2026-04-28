import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { builtinActions } from '../../shared/actions'
import { WebviewRegistry } from '../playwright/webviewController'
import { PageControllerRegistry } from '../v2/runtime/pageController'
import { SupabaseService } from '../services/supabase'
import { CampaignScheduler } from '../services/campaignScheduler'
import { ContactLoader } from '../services/contactLoader'
import { startChannelPoller } from '../domain/channels/channelPoller'
import { seedV2 } from '../data/seed/seedV2'

import { registerFlowHandlers } from './handlers/flowHandlers'
import { registerBrowserHandlers } from './handlers/browserHandlers'
import { registerCampaignHandlers } from './handlers/campaignHandlers'
import { registerChannelHandlers } from './handlers/channelHandlers'
import { registerChannelContactHandlers } from './handlers/channelContactHandlers'
import { registerElementHandlers } from './handlers/elementHandlers'
import { registerRunHandlers } from './handlers/runHandlers'
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

  // Seed built-in data
  supabase.seedBuiltinCampaignActions().catch(err => {
    console.error('Failed to seed built-in campaign actions:', err)
  })

  // Seed v2 (idempotent — UPSERT theo name UNIQUE)
  seedV2().catch(err => {
    console.error('Failed to seed v2 blocks/workflows:', err)
  })

  // Theme
  ipcMain.handle(IPC_CHANNELS.THEME_CHANGE, (_, theme: 'light' | 'dark') => {
    if (theme === 'light') {
      mainWindow.setTitleBarOverlay({ color: '#7c3aed', symbolColor: '#ffffff' })
    } else {
      mainWindow.setTitleBarOverlay({ color: '#0a0a0f', symbolColor: '#a0a0b0' })
    }
  })

  // Actions
  ipcMain.handle(IPC_CHANNELS.ACTIONS_LIST, () => builtinActions)

  // DB Flow handlers
  ipcMain.handle(IPC_CHANNELS.DB_SAVE_FLOW, async (_, flowData) => supabase.saveFlow(flowData))
  ipcMain.handle(IPC_CHANNELS.DB_LOAD_FLOW, async (_, flowId: string) => supabase.loadFlow(flowId))
  ipcMain.handle(IPC_CHANNELS.DB_LIST_FLOWS, async () => supabase.listFlows())
  ipcMain.handle(IPC_CHANNELS.DB_DELETE_FLOW, async (_, flowId: string) => supabase.deleteFlow(flowId))

  // Register domain handlers
  registerAuthHandlers()
  registerUpdateHandlers(mainWindow)
  registerFlowHandlers(mainWindow, supabase)
  registerBrowserHandlers(webviewRegistry, pageRegistry)
  registerCampaignHandlers(supabase, campaignScheduler)
  registerChannelHandlers(supabase, webviewRegistry)
  registerChannelContactHandlers(supabase, contactLoader)
  registerElementHandlers(supabase)
  registerRunHandlers(supabase)
  registerV2Handlers(mainWindow, pageRegistry)

  // Start channel login poller
  startChannelPoller(webviewRegistry, mainWindow)
}
