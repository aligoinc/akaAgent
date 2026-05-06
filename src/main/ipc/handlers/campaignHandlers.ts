import { ipcMain } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { CampaignScheduler } from '../../services/campaignScheduler'

export function registerCampaignHandlers(supabase: SupabaseService, campaignScheduler: CampaignScheduler): void {
  // Campaign Actions
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_ACTIONS, async () => {
    return supabase.listCampaignActions()
  })

  ipcMain.handle(IPC_EVENTS.DB_GET_ALL_CAMPAIGN_ACTIONS, async () => {
    return supabase.getAllCampaignActions()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN_ACTION, async (_, actionData) => {
    return supabase.createCampaignAction(actionData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CAMPAIGN_ACTION, async (_, id: string, updates) => {
    return supabase.updateCampaignAction(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN_ACTION, async (_, id: string) => {
    return supabase.deleteCampaignAction(id)
  })

  // Campaigns
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGNS, async () => {
    return supabase.listCampaigns()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN, async (_, campaignData) => {
    return supabase.createCampaign(campaignData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CAMPAIGN, async (_, id: number, updates) => {
    return supabase.updateCampaign(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN, async (_, id: number) => {
    return supabase.deleteCampaign(id)
  })

  ipcMain.handle(IPC_EVENTS.DB_CLONE_CAMPAIGN, async (_, id: number) => {
    return supabase.cloneCampaign(id)
  })

  // Campaign Inputs (pool nguyên liệu)
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_INPUTS, async (_, campaignId: number) => {
    return supabase.listCampaignInputs(campaignId)
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN_INPUT, async (_, inputData) => {
    return supabase.createCampaignInput(inputData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CAMPAIGN_INPUT, async (_, id: number, updates) => {
    return supabase.updateCampaignInput(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN_INPUT, async (_, id: number) => {
    return supabase.deleteCampaignInput(id)
  })

  // Campaign Input Data (việc-cần-làm)
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_INPUT_DATA, async (_, campaignId: number) => {
    return supabase.listCampaignInputData(campaignId)
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN_INPUT_DATA, async (_, actionData) => {
    return supabase.createCampaignInputData(actionData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CAMPAIGN_INPUT_DATA, async (_, id: number, updates) => {
    return supabase.updateCampaignInputData(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN_INPUT_DATA, async (_, id: number) => {
    return supabase.deleteCampaignInputData(id)
  })

  // Campaign Details (per-milestone log)
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_DETAILS_BY_INPUT_DATA, async (_, inputDataId: number) => {
    return supabase.listCampaignDetailsByInputData(inputDataId)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_DETAILS_BY_CAMPAIGN, async (_, campaignId: number) => {
    return supabase.listCampaignDetailsByCampaign(campaignId)
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN_DETAIL, async (_, actionData) => {
    return supabase.createCampaignDetail(actionData)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN_DETAIL, async (_, id: number) => {
    return supabase.deleteCampaignDetail(id)
  })

  // Scheduler
  ipcMain.handle(IPC_EVENTS.SCHEDULER_START, () => {
    campaignScheduler.start()
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.SCHEDULER_STOP, () => {
    campaignScheduler.stop()
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.SCHEDULER_STATUS, () => {
    return { running: campaignScheduler.isRunning() }
  })
}
