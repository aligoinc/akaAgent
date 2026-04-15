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

  // Campaign Details
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

  // Detail Actions
  ipcMain.handle(IPC_CHANNELS.DB_LIST_DETAIL_ACTIONS, async (_, detailId: number) => {
    return supabase.listDetailActions(detailId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_DETAIL_ACTIONS_BY_CAMPAIGN, async (_, campaignId: number) => {
    return supabase.listDetailActionsByCampaign(campaignId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_DETAIL_ACTION, async (_, actionData) => {
    return supabase.createDetailAction(actionData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_DETAIL_ACTION, async (_, id: number) => {
    return supabase.deleteDetailAction(id)
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
