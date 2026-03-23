import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS, FlowData, ExecutionStep } from '../../shared/types'
import { builtinActions } from '../../shared/actions'
import { PlaywrightController } from '../playwright/controller'
import { BrowserProfileManager } from '../playwright/browserProfileManager'
import { FlowRunner } from '../playwright/flowRunner'
import { SupabaseService } from '../services/supabase'
import { CampaignScheduler } from '../services/campaignScheduler'

let playwrightController: PlaywrightController | null = null
let flowRunner: FlowRunner | null = null
let profileManager: BrowserProfileManager | null = null
let campaignScheduler: CampaignScheduler | null = null

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const supabase = new SupabaseService()
  profileManager = new BrowserProfileManager()
  campaignScheduler = new CampaignScheduler(supabase, profileManager, mainWindow)

  // =========== ACTIONS ===========
  ipcMain.handle(IPC_CHANNELS.ACTIONS_LIST, () => {
    return builtinActions
  })

  // =========== BROWSER CONTROL (legacy single browser for workflow editor) ===========
  ipcMain.handle(IPC_CHANNELS.BROWSER_LAUNCH, async (_, options?: { headless?: boolean; profileName?: string }) => {
    if (!playwrightController) {
      playwrightController = new PlaywrightController()
    }
    await playwrightController.launch(options?.headless ?? false, options?.profileName ?? 'default')
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLOSE, async () => {
    if (playwrightController) {
      await playwrightController.close()
      playwrightController = null
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_STATUS, () => {
    return { connected: playwrightController?.isConnected() ?? false }
  })

  // =========== MULTI-BROWSER PROFILE MANAGEMENT ===========
  ipcMain.handle(IPC_CHANNELS.PROFILE_LAUNCH, async (_, accountId: number, profileName: string) => {
    if (!profileManager) throw new Error('Profile manager not initialized')
    await profileManager.launchProfile(accountId, profileName)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.PROFILE_CLOSE, async (_, accountId: number) => {
    if (!profileManager) throw new Error('Profile manager not initialized')
    await profileManager.closeProfile(accountId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.PROFILE_STATUS, (_, accountId: number) => {
    return { connected: profileManager?.isProfileConnected(accountId) ?? false }
  })

  ipcMain.handle(IPC_CHANNELS.PROFILE_LIST, () => {
    return profileManager?.listProfiles() ?? []
  })

  ipcMain.handle(IPC_CHANNELS.PROFILE_FOCUS, async (_, accountId: number) => {
    if (profileManager) await profileManager.focusProfile(accountId)
    return { success: true }
  })

  // =========== FLOW EXECUTION ===========
  ipcMain.handle(IPC_CHANNELS.FLOW_RUN, async (_, flowData: FlowData) => {
    if (!playwrightController || !playwrightController.isConnected()) {
      throw new Error('Browser not launched. Please launch browser first.')
    }

    flowRunner = new FlowRunner(playwrightController, supabase, (step: ExecutionStep) => {
      mainWindow.webContents.send(IPC_CHANNELS.FLOW_PROGRESS, step)
    })

    try {
      const result = await flowRunner.run(flowData)
      return result
    } catch (error) {
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.FLOW_STOP, async () => {
    if (flowRunner) {
      flowRunner.stop()
      flowRunner = null
    }
    return { success: true }
  })

  // =========== DATABASE - FLOWS ===========
  ipcMain.handle(IPC_CHANNELS.DB_SAVE_FLOW, async (_, flowData: FlowData) => {
    return supabase.saveFlow(flowData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LOAD_FLOW, async (_, flowId: string) => {
    return supabase.loadFlow(flowId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_FLOWS, async () => {
    return supabase.listFlows()
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_FLOW, async (_, flowId: string) => {
    return supabase.deleteFlow(flowId)
  })

  // =========== DATABASE - RUNS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_RUNS, async (_, flowId?: string) => {
    return supabase.listRuns(flowId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_RUN_STEPS, async (_, runId: string) => {
    return supabase.listRunSteps(runId)
  })

  // =========== DATABASE - ELEMENTS ===========
  ipcMain.handle(IPC_CHANNELS.DB_SAVE_ELEMENT, async (_, element) => {
    return supabase.saveElement(element)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_ELEMENTS, async () => {
    return supabase.listElements()
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_ELEMENT, async (_, elementId: string) => {
    return supabase.deleteElement(elementId)
  })

  // =========== DATABASE - FLATFORM ACCOUNTS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_ACCOUNTS, async () => {
    return supabase.listAccounts()
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_ACCOUNT, async (_, accountData) => {
    return supabase.createAccount(accountData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_ACCOUNT, async (_, id: number, updates) => {
    return supabase.updateAccount(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_ACCOUNT, async (_, id: number) => {
    // Also close browser profile if open
    if (profileManager?.isProfileConnected(id)) {
      await profileManager.closeProfile(id)
    }
    return supabase.deleteAccount(id)
  })

  // =========== DATABASE - CAMPAIGN ACTIONS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_CAMPAIGN_ACTIONS, async () => {
    return supabase.listCampaignActions()
  })

  ipcMain.handle(IPC_CHANNELS.DB_GET_ALL_CAMPAIGN_ACTIONS, async () => {
    return supabase.getAllCampaignActions()
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_CAMPAIGN_ACTION, async (_, actionData) => {
    return supabase.createCampaignAction(actionData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_CAMPAIGN_ACTION, async (_, id: string, updates) => {
    return supabase.updateCampaignAction(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_CAMPAIGN_ACTION, async (_, id: string) => {
    return supabase.deleteCampaignAction(id)
  })

  // =========== DATABASE - CAMPAIGNS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_CAMPAIGNS, async () => {
    return supabase.listCampaigns()
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_CAMPAIGN, async (_, campaignData) => {
    return supabase.createCampaign(campaignData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_CAMPAIGN, async (_, id: number, updates) => {
    return supabase.updateCampaign(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_CAMPAIGN, async (_, id: number) => {
    return supabase.deleteCampaign(id)
  })

  ipcMain.handle(IPC_CHANNELS.DB_CLONE_CAMPAIGN, async (_, id: number) => {
    return supabase.cloneCampaign(id)
  })

  // =========== DATABASE - CAMPAIGN DETAILS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_CAMPAIGN_DETAILS, async (_, campaignId: number) => {
    return supabase.listCampaignDetails(campaignId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_CAMPAIGN_DETAIL, async (_, detailData) => {
    return supabase.createCampaignDetail(detailData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_CAMPAIGN_DETAIL, async (_, id: number, updates) => {
    return supabase.updateCampaignDetail(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_CAMPAIGN_DETAIL, async (_, id: number) => {
    return supabase.deleteCampaignDetail(id)
  })

  // =========== CAMPAIGN SCHEDULER ===========
  ipcMain.handle(IPC_CHANNELS.SCHEDULER_START, () => {
    campaignScheduler?.start()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STOP, () => {
    campaignScheduler?.stop()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STATUS, () => {
    return { running: campaignScheduler?.isRunning() ?? false }
  })
}
