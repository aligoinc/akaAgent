import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { builtinActions } from '../../shared/actions'
import { WebviewRegistry } from '../playwright/webviewController'
import { SupabaseService } from '../services/supabase'
import { CampaignScheduler } from '../services/campaignScheduler'
import { ContactLoader } from '../services/contactLoader'
import { startChannelPoller } from '../domain/channels/channelPoller'

import { registerFlowHandlers } from './handlers/flowHandlers'
import { registerBrowserHandlers } from './handlers/browserHandlers'
import { registerCampaignHandlers } from './handlers/campaignHandlers'
import { registerChannelHandlers } from './handlers/channelHandlers'
import { registerChannelContactHandlers } from './handlers/channelContactHandlers'
import { registerElementHandlers } from './handlers/elementHandlers'
import { registerRunHandlers } from './handlers/runHandlers'
import { registerAuthHandlers } from './handlers/authHandlers'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const supabase = new SupabaseService()
  const webviewRegistry = new WebviewRegistry()
  const campaignScheduler = new CampaignScheduler(supabase, webviewRegistry, mainWindow)
  const contactLoader = new ContactLoader(supabase, webviewRegistry, mainWindow)

  // Startup reset
  supabase.resetRunningStatuses().catch(err => {
    console.error('Failed to reset running statuses:', err)
  })

  // Seed built-in data
  supabase.seedBuiltinCampaignActions().catch(err => {
    console.error('Failed to seed built-in campaign actions:', err)
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
  registerFlowHandlers(mainWindow, supabase)
  registerBrowserHandlers(webviewRegistry)
  registerCampaignHandlers(supabase, campaignScheduler)
  registerChannelHandlers(supabase, webviewRegistry)
  registerChannelContactHandlers(supabase, contactLoader)
  registerElementHandlers(supabase)
  registerRunHandlers(supabase)

  // Start channel login poller
  startChannelPoller(webviewRegistry, mainWindow)
}
