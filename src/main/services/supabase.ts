import { AutoAccount, Campaign, CampaignAction, CampaignInput, CampaignInputData, CampaignDetail, AutoAccountContact, ContactType } from '../../shared/types'
import * as accountRepo from '../data/repositories/accountRepository'
import * as campaignRepo from '../data/repositories/campaignRepository'
import * as campaignActionRepo from '../data/repositories/campaignActionRepository'
import * as accountContactRepo from '../data/repositories/accountContactRepository'

/**
 * Facade that delegates to individual repositories.
 * Keeps a thin service API so callers do not know repository boundaries.
 */
export class SupabaseService {
  // =========== STARTUP ===========
  async resetRunningStatuses(): Promise<void> {
    console.log('[Supabase] Resetting "đang chạy" statuses to "chờ xử lý"...')
    await accountRepo.resetRunningAccountStatuses()
    await campaignRepo.resetRunningCampaignStatuses()
    await campaignRepo.resetRunningCampaignInputStatuses()
    await campaignRepo.resetRunningCampaignInputDataStatuses()
  }

  // =========== ACCOUNTS ===========
  listAccounts() { return accountRepo.listAccounts() }
  createAccount(account: Partial<AutoAccount>) { return accountRepo.createAccount(account) }
  updateAccount(id: number, updates: Partial<AutoAccount>) { return accountRepo.updateAccount(id, updates) }
  deleteAccount(id: number) { return accountRepo.deleteAccount(id) }
  getEligibleAccounts() { return accountRepo.getEligibleAccounts() }

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
  getPendingCampaigns(accountId: number) { return campaignRepo.getPendingCampaigns(accountId) }

  // =========== CAMPAIGN INPUTS (pool nguyên liệu) ===========
  listCampaignInputs(campaignId: number) { return campaignRepo.listCampaignInputs(campaignId) }
  createCampaignInput(input: Partial<CampaignInput>) { return campaignRepo.createCampaignInput(input) }
  updateCampaignInput(id: number, updates: Partial<CampaignInput>) { return campaignRepo.updateCampaignInput(id, updates) }
  deleteCampaignInput(id: number) { return campaignRepo.deleteCampaignInput(id) }

  // =========== CAMPAIGN INPUT DATA (việc-cần-làm) ===========
  listCampaignInputData(campaignId: number) { return campaignRepo.listCampaignInputData(campaignId) }
  createCampaignInputData(action: Partial<CampaignInputData>) { return campaignRepo.createCampaignInputData(action) }
  updateCampaignInputData(id: number, updates: Partial<CampaignInputData>) { return campaignRepo.updateCampaignInputData(id, updates) }
  deleteCampaignInputData(id: number) { return campaignRepo.deleteCampaignInputData(id) }

  // =========== CAMPAIGN DETAILS (per-milestone log) ===========
  listCampaignDetailsByInputData(inputDataId: number) { return campaignRepo.listCampaignDetailsByInputData(inputDataId) }
  listCampaignDetailsByCampaign(campaignId: number) { return campaignRepo.listCampaignDetailsByCampaign(campaignId) }
  createCampaignDetail(action: Partial<CampaignDetail>) { return campaignRepo.createCampaignDetail(action) }
  deleteCampaignDetail(id: number) { return campaignRepo.deleteCampaignDetail(id) }
  getAccountRateLimitStatus(accountId: number, actionName: string, limitConfig?: { dailyLimit?: number; rateLimitCount?: number; rateLimitMinutes?: number }) { return campaignRepo.getAccountRateLimitStatus(accountId, actionName, limitConfig) }

  // =========== CONTACTS ===========
  listContacts(accountId: number, contactType?: ContactType) { return accountContactRepo.listContacts(accountId, contactType) }
  upsertContacts(contacts: Partial<AutoAccountContact>[]) { return accountContactRepo.upsertContacts(contacts) }
  deleteContacts(accountId: number, contactType: ContactType) { return accountContactRepo.deleteContacts(accountId, contactType) }
}
