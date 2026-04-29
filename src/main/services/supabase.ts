import { OrgChannel, Campaign, CampaignAction, CampaignDataInput, CampaignDataAction, CampaignResultAction, OrgChannelContact, ContactType } from '../../shared/types'
import * as channelRepo from '../data/repositories/channelRepository'
import * as campaignRepo from '../data/repositories/campaignRepository'
import * as campaignActionRepo from '../data/repositories/campaignActionRepository'
import * as channelContactRepo from '../data/repositories/channelContactRepository'

/**
 * Facade that delegates to individual repositories.
 * Keeps backward-compatible API so existing callers (campaignScheduler,
 * contactLoader, handlers) continue to work unchanged.
 */
export class SupabaseService {
  // =========== STARTUP ===========
  async resetRunningStatuses(): Promise<void> {
    console.log('[Supabase] Resetting "đang chạy" statuses to "chờ xử lý"...')
    await channelRepo.resetRunningChannelStatuses()
    await campaignRepo.resetRunningCampaignStatuses()
    await campaignRepo.resetRunningDataInputStatuses()
    await campaignRepo.resetRunningDataActionStatuses()
  }

  // =========== CHANNELS ===========
  listChannels() { return channelRepo.listChannels() }
  createChannel(channel: Partial<OrgChannel>) { return channelRepo.createChannel(channel) }
  updateChannel(id: number, updates: Partial<OrgChannel>) { return channelRepo.updateChannel(id, updates) }
  deleteChannel(id: number) { return channelRepo.deleteChannel(id) }
  getEligibleChannels() { return channelRepo.getEligibleChannels() }

  // =========== CAMPAIGN ACTIONS ===========
  listCampaignActions() { return campaignActionRepo.listCampaignActions() }
  getAllCampaignActions() { return campaignActionRepo.getAllCampaignActions() }
  getCampaignAction(actionId: string) { return campaignActionRepo.getCampaignAction(actionId) }
  createCampaignAction(action: Partial<CampaignAction>) { return campaignActionRepo.createCampaignAction(action) }
  updateCampaignAction(id: string, updates: Partial<CampaignAction>) { return campaignActionRepo.updateCampaignAction(id, updates) }
  deleteCampaignAction(id: string) { return campaignActionRepo.deleteCampaignAction(id) }

  // =========== CAMPAIGNS ===========
  getCampaign(id: number) { return campaignRepo.getCampaign(id) }
  listCampaigns() { return campaignRepo.listCampaigns() }
  createCampaign(campaign: Partial<Campaign>) { return campaignRepo.createCampaign(campaign) }
  updateCampaign(id: number, updates: Partial<Campaign>) { return campaignRepo.updateCampaign(id, updates) }
  deleteCampaign(id: number) { return campaignRepo.deleteCampaign(id) }
  cloneCampaign(id: number) { return campaignRepo.cloneCampaign(id) }
  appendCampaignLog(campaignId: number, logText: string) { return campaignRepo.appendCampaignLog(campaignId, logText) }
  getPendingCampaigns(channelId: number) { return campaignRepo.getPendingCampaigns(channelId) }

  // =========== CAMPAIGN DATA INPUTS (pool nguyên liệu) ===========
  listCampaignDataInputs(campaignId: number) { return campaignRepo.listCampaignDataInputs(campaignId) }
  createCampaignDataInput(input: Partial<CampaignDataInput>) { return campaignRepo.createCampaignDataInput(input) }
  updateCampaignDataInput(id: number, updates: Partial<CampaignDataInput>) { return campaignRepo.updateCampaignDataInput(id, updates) }
  deleteCampaignDataInput(id: number) { return campaignRepo.deleteCampaignDataInput(id) }

  // =========== CAMPAIGN DATA ACTIONS (việc-cần-làm) ===========
  listCampaignDataActions(campaignId: number) { return campaignRepo.listCampaignDataActions(campaignId) }
  createCampaignDataAction(action: Partial<CampaignDataAction>) { return campaignRepo.createCampaignDataAction(action) }
  updateCampaignDataAction(id: number, updates: Partial<CampaignDataAction>) { return campaignRepo.updateCampaignDataAction(id, updates) }
  deleteCampaignDataAction(id: number) { return campaignRepo.deleteCampaignDataAction(id) }

  // =========== RESULT ACTIONS (per-milestone log) ===========
  listResultActionsByDataAction(dataActionId: number) { return campaignRepo.listResultActionsByDataAction(dataActionId) }
  listResultActionsByCampaign(campaignId: number) { return campaignRepo.listResultActionsByCampaign(campaignId) }
  createResultAction(action: Partial<CampaignResultAction>) { return campaignRepo.createResultAction(action) }
  deleteResultAction(id: number) { return campaignRepo.deleteResultAction(id) }
  getChannelRateLimitStatus(channelId: number, actionName: string, limitConfig?: { dailyLimit?: number; rateLimitCount?: number; rateLimitMinutes?: number }) { return campaignRepo.getChannelRateLimitStatus(channelId, actionName, limitConfig) }

  // =========== CONTACTS ===========
  listContacts(channelId: number, contactType?: ContactType) { return channelContactRepo.listContacts(channelId, contactType) }
  upsertContacts(contacts: Partial<OrgChannelContact>[]) { return channelContactRepo.upsertContacts(contacts) }
  deleteContacts(channelId: number, contactType: ContactType) { return channelContactRepo.deleteContacts(channelId, contactType) }
}
