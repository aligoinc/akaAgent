import { ActionLimitConfig, AutoAccount, AutoAccountGroup, AutoProxy, Campaign, CampaignAction, CampaignInput, CampaignInputData, CampaignDetail, CreateCampaignDetailInput, AutoAccountContact, ContactType, ContentTemplate, EmailNotificationSettings, AccountActionReportDetailQuery, AccountActionReportQuery, AddCampaignInputDataToCampaignRequest, CampaignInputStatus, CampaignRunEventListOptions, ZaloSessionCredentials, EmailAccountConfig } from '../../shared/types'
import * as accountRepo from '../data/repositories/accountRepository'
import * as accountGroupRepo from '../data/repositories/accountGroupRepository'
import * as proxyRepo from '../data/repositories/proxyRepository'
import * as campaignRepo from '../data/repositories/campaignRepository'
import * as campaignRunEventRepo from '../data/repositories/campaignRunEventRepository'
import * as campaignActionRepo from '../data/repositories/campaignActionRepository'
import * as accountContactRepo from '../data/repositories/accountContactRepository'
import * as accountActionRepo from '../data/repositories/accountActionRepository'
import * as errorPolicyRepo from '../data/repositories/errorPolicyRepository'
import * as contentTemplateRepo from '../data/repositories/contentTemplateRepository'
import * as emailNotificationRepo from '../data/repositories/emailNotificationRepository'
import * as reportRepo from '../data/repositories/reportRepository'
import * as zaloApiErrorLogRepo from '../data/repositories/zaloApiErrorLogRepository'
import * as systemSettingsRepo from '../data/repositories/systemSettingsRepository'

/**
 * Facade that delegates to individual repositories.
 * Keeps a thin service API so callers do not know repository boundaries.
 */
export class SupabaseService {
  // =========== RECOVERY ===========
  async resetRunningStatuses(staffId: number): Promise<void> {
    console.log(`[Supabase] Resetting "đang chạy" statuses to "chờ xử lý" for staff ${staffId}...`)
    await accountRepo.resetRunningAccountStatuses(staffId)
    await campaignRepo.resetRunningCampaignStatuses(staffId)
    await campaignRepo.resetCampaignNotes(staffId)
    await campaignRepo.resetRunningCampaignInputStatuses(staffId)
    await campaignRepo.resetRunningCampaignInputDataStatuses(staffId)
    await accountActionRepo.enableDueAccountActions()
  }

  // =========== ACCOUNTS ===========
  getAccount(id: number) { return accountRepo.getAccount(id) }
  listAccounts() { return accountRepo.listAccounts() }
  createAccount(account: Partial<AutoAccount>) { return accountRepo.createAccount(account) }
  updateAccount(id: number, updates: Partial<AutoAccount>) { return accountRepo.updateAccount(id, updates) }
  deleteAccount(id: number) { return accountRepo.deleteAccount(id) }
  getEligibleAccounts() { return accountRepo.getEligibleAccounts() }
  getAccountZaloSession(id: number) { return accountRepo.getAccountZaloSession(id) }
  listZaloAccountsWithSession() { return accountRepo.listZaloAccountsWithSession() }
  upsertZaloAccount(input: accountRepo.ZaloAccountUpsertInput) { return accountRepo.upsertZaloAccount(input) }
  updateAccountZaloSession(id: number, input: { zaloAccountId: number; session: ZaloSessionCredentials; verified?: boolean; clearError?: boolean }) {
    return accountRepo.updateAccountZaloSession(id, input)
  }
  markAccountZaloSessionCheck(id: number, result: { ok: boolean; error?: string | null }) {
    return accountRepo.markAccountZaloSessionCheck(id, result)
  }
  clearAccountZaloSession(id: number) { return accountRepo.clearAccountZaloSession(id) }
  getAccountEmailSession(id: number) { return accountRepo.getAccountEmailSession(id) }
  updateAccountEmailSession(id: number, input: { session: EmailAccountConfig; verified?: boolean; clearError?: boolean }) {
    return accountRepo.updateAccountEmailSession(id, input)
  }
  markAccountEmailSessionCheck(id: number, result: { ok: boolean; error?: string | null }) {
    return accountRepo.markAccountEmailSessionCheck(id, result)
  }
  clearAccountEmailSession(id: number) { return accountRepo.clearAccountEmailSession(id) }
  listAccountGroups(flatformType?: string) { return accountGroupRepo.listAccountGroups(flatformType) }
  createAccountGroup(group: Partial<AutoAccountGroup>) { return accountGroupRepo.createAccountGroup(group) }
  updateAccountGroup(id: number, updates: Partial<AutoAccountGroup>) { return accountGroupRepo.updateAccountGroup(id, updates) }
  deleteAccountGroup(id: number) { return accountGroupRepo.deleteAccountGroup(id) }
  listProxies() { return proxyRepo.listProxies() }
  getProxy(id: number) { return proxyRepo.getProxy(id) }
  createProxy(proxy: Partial<AutoProxy>) { return proxyRepo.createProxy(proxy) }
  updateProxy(id: number, updates: Partial<AutoProxy>) { return proxyRepo.updateProxy(id, updates) }
  deleteProxy(id: number) { return proxyRepo.deleteProxy(id) }

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
  maintainCampaignSchedules() { return campaignRepo.maintainCampaignSchedules() }

  // =========== CAMPAIGN INPUTS (pool nguyên liệu) ===========
  listCampaignInputs(campaignId: number) { return campaignRepo.listCampaignInputs(campaignId) }
  createCampaignInput(input: Partial<CampaignInput>) { return campaignRepo.createCampaignInput(input) }
  updateCampaignInput(id: number, updates: Partial<CampaignInput>) { return campaignRepo.updateCampaignInput(id, updates) }
  deleteCampaignInput(id: number) { return campaignRepo.deleteCampaignInput(id) }

  // =========== CAMPAIGN INPUT DATA (việc-cần-làm) ===========
  listCampaignInputData(campaignId: number) { return campaignRepo.listCampaignInputData(campaignId) }
  listCampaignRelationSummaries(campaignIds: number[]) { return campaignRepo.listCampaignRelationSummaries(campaignIds) }
  createCampaignInputData(action: Partial<CampaignInputData>) { return campaignRepo.createCampaignInputData(action) }
  updateCampaignInputData(id: number, updates: Partial<CampaignInputData>) { return campaignRepo.updateCampaignInputData(id, updates) }
  bulkUpdateCampaignInputDataStatus(campaignId: number, ids: number[], status: Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>) {
    return campaignRepo.bulkUpdateCampaignInputDataStatus(campaignId, ids, status)
  }
  addCampaignInputDataToCampaign(request: AddCampaignInputDataToCampaignRequest) {
    return campaignRepo.addCampaignInputDataToCampaign(request)
  }
  resetCampaignInputDataForRerun(campaignId: number) { return campaignRepo.resetCampaignInputDataForRerun(campaignId) }
  deleteCampaignInputData(id: number) { return campaignRepo.deleteCampaignInputData(id) }

  // =========== CAMPAIGN DETAILS (per-milestone log) ===========
  listCampaignDetailsByInputData(inputDataId: number) { return campaignRepo.listCampaignDetailsByInputData(inputDataId) }
  listCampaignDetailsByCampaign(campaignId: number) { return campaignRepo.listCampaignDetailsByCampaign(campaignId) }
  createCampaignDetail(action: CreateCampaignDetailInput) { return campaignRepo.createCampaignDetail(action) }
  deleteCampaignDetail(id: number) { return campaignRepo.deleteCampaignDetail(id) }
  listCampaignRunEventsByCampaign(campaignId: number, options?: CampaignRunEventListOptions) {
    return campaignRunEventRepo.listCampaignRunEventsByCampaign(campaignId, options)
  }
  listCampaignRunEventsByInputData(inputDataId: number, limit?: number) {
    return campaignRunEventRepo.listCampaignRunEventsByInputData(inputDataId, limit)
  }
  incrementCampaignBadTargetCount(campaignId: number, inputDataId: number | null | undefined, reason: string) {
    return campaignRepo.incrementCampaignBadTargetCount(campaignId, inputDataId, reason)
  }
  resetCampaignBadTargetCount(campaignId: number) { return campaignRepo.resetCampaignBadTargetCount(campaignId) }
  getAccountRateLimitStatus(accountId: number, actionCode: string, actionName: string, limitConfig?: ActionLimitConfig) {
    return campaignRepo.getAccountRateLimitStatus(accountId, actionCode, actionName, limitConfig)
  }

  // =========== CONTENT TEMPLATES ===========
  listContentTemplates() { return contentTemplateRepo.listContentTemplates() }
  createContentTemplate(template: Partial<ContentTemplate>) { return contentTemplateRepo.createContentTemplate(template) }
  updateContentTemplate(id: number, updates: Partial<ContentTemplate>) { return contentTemplateRepo.updateContentTemplate(id, updates) }
  deleteContentTemplate(id: number) { return contentTemplateRepo.deleteContentTemplate(id) }

  // =========== EMAIL NOTIFICATIONS ===========
  getEmailNotificationSettings() { return emailNotificationRepo.getEmailNotificationSettings() }
  saveEmailNotificationSettings(settings: Partial<EmailNotificationSettings>) {
    return emailNotificationRepo.saveEmailNotificationSettings(settings)
  }

  // =========== REPORTS ===========
  getAccountActionReport(query: AccountActionReportQuery) { return reportRepo.getAccountActionReport(query) }
  getAccountActionReportDetails(query: AccountActionReportDetailQuery) { return reportRepo.getAccountActionReportDetails(query) }

  // =========== ACCOUNT ACTION LIMITS / ERRORS ===========
  listAccountActions(flatformType?: string, includeRestricted?: boolean) {
    return accountActionRepo.listAccountActions(flatformType, includeRestricted)
  }
  listAccountActionOverview(accountId: number) { return accountActionRepo.listAccountActionOverview(accountId) }
  getAccountActionStatus(accountId: number, actionCode: string) { return accountActionRepo.getAccountActionStatus(accountId, actionCode) }
  disableAccountActions(accountId: number, actionCodes: string[], minutes?: number | null, context?: accountActionRepo.DisableAccountActionContext) {
    return accountActionRepo.disableAccountActions(accountId, actionCodes, minutes, context)
  }
  enableAccountActionNow(accountId: number, actionCode: string) { return accountActionRepo.enableAccountActionNow(accountId, actionCode) }
  enableDueAccountActions() { return accountActionRepo.enableDueAccountActions() }
  getErrorPolicy(errorCode: string) { return errorPolicyRepo.getErrorPolicy(errorCode) }
  getZaloErrorPolicyByCode(code: string | number) { return errorPolicyRepo.getZaloErrorPolicyByCode(code) }
  createZaloApiErrorLog(input: zaloApiErrorLogRepo.ZaloApiErrorLogInput) { return zaloApiErrorLogRepo.createZaloApiErrorLog(input) }
  listErrorPolicies() { return errorPolicyRepo.listErrorPolicies() }
  incrementConsecutiveError(accountId: number, actionCode: string | null | undefined, errorCode: string) {
    return errorPolicyRepo.incrementConsecutiveError(accountId, actionCode, errorCode)
  }
  resetConsecutiveErrors(accountId: number, actionCode?: string | null) {
    return errorPolicyRepo.resetConsecutiveErrors(accountId, actionCode)
  }

  // =========== CONTACTS ===========
  listContacts(accountId: number, contactType?: ContactType) { return accountContactRepo.listContacts(accountId, contactType) }
  getGroupContactByTarget(accountId: number, targetUrl: string | undefined | null) {
    return accountContactRepo.getGroupContactByTarget(accountId, targetUrl)
  }
  upsertContacts(
    contacts: Partial<AutoAccountContact>[],
    options?: Parameters<typeof accountContactRepo.upsertContacts>[1]
  ) { return accountContactRepo.upsertContacts(contacts, options) }
  upsertZaloUserContacts(
    contacts: accountContactRepo.ZaloUserContactInput[],
    options?: Parameters<typeof accountContactRepo.upsertZaloUserContacts>[1]
  ) { return accountContactRepo.upsertZaloUserContacts(contacts, options) }
  upsertZaloGroupContacts(
    contacts: accountContactRepo.ZaloGroupContactInput[],
    options?: Parameters<typeof accountContactRepo.upsertZaloGroupContacts>[1]
  ) { return accountContactRepo.upsertZaloGroupContacts(contacts, options) }
  upsertZaloGroupMemberContacts(
    input: accountContactRepo.ZaloGroupMemberUpsertInput
  ) { return accountContactRepo.upsertZaloGroupMemberContacts(input) }
  listZaloGroupMemberContacts(accountId: number, zaloGroupId: string) {
    return accountContactRepo.listZaloGroupMemberContacts(accountId, zaloGroupId)
  }
  upsertGroupPostContactStatus(
    input: Parameters<typeof accountContactRepo.upsertGroupPostContactStatus>[0]
  ) { return accountContactRepo.upsertGroupPostContactStatus(input) }
  deleteContacts(accountId: number, contactType: ContactType) { return accountContactRepo.deleteContacts(accountId, contactType) }
  listContactGroups(accountId: number, contactType?: ContactType) {
    return accountContactRepo.listContactGroups(accountId, contactType)
  }
  createContactGroup(accountId: number, contactType: ContactType, name: string) {
    return accountContactRepo.createContactGroup(accountId, contactType, name)
  }
  updateContactGroup(groupId: number, name: string) {
    return accountContactRepo.updateContactGroup(groupId, name)
  }
  deleteContactGroup(groupId: number) {
    return accountContactRepo.deleteContactGroup(groupId)
  }
  listContactGroupContacts(groupId: number) {
    return accountContactRepo.listContactGroupContacts(groupId)
  }
  addContactsToGroup(groupId: number, contactIds: number[]) {
    return accountContactRepo.addContactsToGroup(groupId, contactIds)
  }
  removeContactsFromGroup(groupId: number, contactIds: number[]) {
    return accountContactRepo.removeContactsFromGroup(groupId, contactIds)
  }

  // =========== SYSTEM SETTINGS ===========
  async getSystemSettingValue(key: string): Promise<string> {
    const settings = await systemSettingsRepo.listActiveSystemSettingsByKeys([key])
    return systemSettingsRepo.getSettingValue(settings, key)
  }
}
