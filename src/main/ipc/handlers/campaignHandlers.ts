import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { CampaignScheduler } from '../../services/campaignScheduler'

export function registerCampaignHandlers(supabase: SupabaseService, campaignScheduler: CampaignScheduler): void {
  // Campaign Actions
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

  // Campaigns
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

  // Campaign Data Inputs (pool nguyên liệu)
  ipcMain.handle(IPC_CHANNELS.DB_LIST_DATA_INPUTS, async (_, campaignId: number) => {
    return supabase.listCampaignDataInputs(campaignId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_DATA_INPUT, async (_, inputData) => {
    return supabase.createCampaignDataInput(inputData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_DATA_INPUT, async (_, id: number, updates) => {
    return supabase.updateCampaignDataInput(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_DATA_INPUT, async (_, id: number) => {
    return supabase.deleteCampaignDataInput(id)
  })

  // Campaign Data Actions (việc-cần-làm)
  ipcMain.handle(IPC_CHANNELS.DB_LIST_DATA_ACTIONS, async (_, campaignId: number) => {
    return supabase.listCampaignDataActions(campaignId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_DATA_ACTION, async (_, actionData) => {
    return supabase.createCampaignDataAction(actionData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_DATA_ACTION, async (_, id: number, updates) => {
    return supabase.updateCampaignDataAction(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_DATA_ACTION, async (_, id: number) => {
    return supabase.deleteCampaignDataAction(id)
  })

  // Result Actions (per-milestone log)
  ipcMain.handle(IPC_CHANNELS.DB_LIST_RESULT_ACTIONS_BY_DATA_ACTION, async (_, dataActionId: number) => {
    return supabase.listResultActionsByDataAction(dataActionId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_RESULT_ACTIONS_BY_CAMPAIGN, async (_, campaignId: number) => {
    return supabase.listResultActionsByCampaign(campaignId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_RESULT_ACTION, async (_, actionData) => {
    return supabase.createResultAction(actionData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_RESULT_ACTION, async (_, id: number) => {
    return supabase.deleteResultAction(id)
  })

  // Scheduler
  ipcMain.handle(IPC_CHANNELS.SCHEDULER_START, () => {
    campaignScheduler.start()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STOP, () => {
    campaignScheduler.stop()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STATUS, () => {
    return { running: campaignScheduler.isRunning() }
  })
}
