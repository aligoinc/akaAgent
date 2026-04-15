import { FlowData, ExecutionRun, ExecutionStep, FlatformAccount, Campaign, CampaignAction, CampaignDetail, CampaignDetailAction, FlatformContact, ContactType, ElementDefinition } from '../../shared/types'
import * as flowRepo from '../data/repositories/flowRepository'
import * as elementRepo from '../data/repositories/elementRepository'
import * as accountRepo from '../data/repositories/accountRepository'
import * as campaignRepo from '../data/repositories/campaignRepository'
import * as campaignActionRepo from '../data/repositories/campaignActionRepository'
import * as contactRepo from '../data/repositories/contactRepository'
import { seedBuiltinCampaignActions as _seedBuiltin } from '../data/seed/builtinCampaignActions'

/**
 * Facade that delegates to individual repositories.
 * Keeps backward-compatible API so existing callers (campaignScheduler,
 * contactLoader, flowRunner, handlers) continue to work unchanged.
 */
export class SupabaseService {
  // =========== STARTUP ===========
  async resetRunningStatuses(): Promise<void> {
    console.log('[Supabase] Resetting "đang chạy" statuses to "chờ xử lý"...')
    await accountRepo.resetRunningAccountStatuses()
    await campaignRepo.resetRunningCampaignStatuses()
  }

  // =========== FLOWS ===========
  saveFlow(flowData: FlowData) { return flowRepo.saveFlow(flowData) }
  loadFlow(flowId: string) { return flowRepo.loadFlow(flowId) }
  listFlows() { return flowRepo.listFlows() }
  deleteFlow(flowId: string) { return flowRepo.deleteFlow(flowId) }

  // =========== RUNS ===========
  createRun(run: ExecutionRun) { return flowRepo.createRun(run) }
  updateRun(runId: string, status: string, output: Record<string, unknown>, errorStr?: string, completedAt?: string) { return flowRepo.updateRun(runId, status, output, errorStr, completedAt) }
  createRunStep(runId: string, step: ExecutionStep) { return flowRepo.createRunStep(runId, step) }
  listRuns(flowId?: string) { return flowRepo.listRuns(flowId) }
  listRunSteps(runId: string) { return flowRepo.listRunSteps(runId) }

  // =========== ELEMENTS ===========
  saveElement(element: Omit<ElementDefinition, 'createdAt' | 'updatedAt'>) { return elementRepo.saveElement(element) }
  listElements() { return elementRepo.listElements() }
  deleteElement(elementId: string) { return elementRepo.deleteElement(elementId) }

  // =========== ACCOUNTS ===========
  listAccounts() { return accountRepo.listAccounts() }
  createAccount(account: Partial<FlatformAccount>) { return accountRepo.createAccount(account) }
  updateAccount(id: number, updates: Partial<FlatformAccount>) { return accountRepo.updateAccount(id, updates) }
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

  // =========== CAMPAIGN DETAILS ===========
  listCampaignDetails(campaignId: number) { return campaignRepo.listCampaignDetails(campaignId) }
  createCampaignDetail(detail: Partial<CampaignDetail>) { return campaignRepo.createCampaignDetail(detail) }
  updateCampaignDetail(id: number, updates: Partial<CampaignDetail>) { return campaignRepo.updateCampaignDetail(id, updates) }
  deleteCampaignDetail(id: number) { return campaignRepo.deleteCampaignDetail(id) }

  // =========== DETAIL ACTIONS ===========
  listDetailActions(detailId: number) { return campaignRepo.listDetailActions(detailId) }
  listDetailActionsByCampaign(campaignId: number) { return campaignRepo.listDetailActionsByCampaign(campaignId) }
  createDetailAction(action: Partial<CampaignDetailAction>) { return campaignRepo.createDetailAction(action) }
  deleteDetailAction(id: number) { return campaignRepo.deleteDetailAction(id) }
  getAccountRateLimitStatus(accountId: number, actionName: string, limitConfig?: { dailyLimit?: number; rateLimitCount?: number; rateLimitMinutes?: number }) { return campaignRepo.getAccountRateLimitStatus(accountId, actionName, limitConfig) }

  // =========== CONTACTS ===========
  listContacts(flatformAccountId: number, contactType?: ContactType) { return contactRepo.listContacts(flatformAccountId, contactType) }
  upsertContacts(contacts: Partial<FlatformContact>[]) { return contactRepo.upsertContacts(contacts) }
  deleteContacts(flatformAccountId: number, contactType: ContactType) { return contactRepo.deleteContacts(flatformAccountId, contactType) }

  // =========== SEED ===========
  seedBuiltinCampaignActions() { return _seedBuiltin() }
}
