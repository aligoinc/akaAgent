import { AccountContactListQuery, ActionLimitConfig, AkaBizContactTag, AutoAccount, AutoAccountGroup, AutoProxy, Campaign, CampaignAction, CampaignInput, CampaignInputData, CampaignDetail, CreateCampaignDetailInput, AutoAccountContact, ContactType, ContentTemplate, EmailNotificationSettings, AccountActionReportDetailQuery, AccountActionReportQuery, AddCampaignInputDataToCampaignRequest, CampaignInputStatus, CampaignRunEventListOptions, ZaloGroupMemberContactListQuery, ZaloSessionCredentials, EmailAccountConfig, ZaloRemarketingCustomerListQuery, MediaGroup, MediaStorageSettings } from '../../shared/types'
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
import * as mediaFileRepo from '../data/repositories/mediaFileRepository'
import * as contactTagRepo from '../data/repositories/contactTagRepository'
import * as emailNotificationRepo from '../data/repositories/emailNotificationRepository'
import * as reportRepo from '../data/repositories/reportRepository'
import * as zaloApiErrorLogRepo from '../data/repositories/zaloApiErrorLogRepository'
import * as systemSettingsRepo from '../data/repositories/systemSettingsRepository'
import * as emailTrackingRepo from '../data/repositories/emailTrackingRepository'

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
  clearAccountMobileDevice(id: number) { return accountRepo.clearAccountMobileDevice(id) }
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
  getDueSmsCampaignsForLimitCheck(accountId: number) { return campaignRepo.getDueSmsCampaignsForLimitCheck(accountId) }
  maintainCampaignSchedules() { return campaignRepo.maintainCampaignSchedules() }
  listZaloRealtimeGroupCampaignSnapshots() { return campaignRepo.listZaloRealtimeGroupCampaignSnapshots() }
  enqueueZaloRealtimeGroupEvent(request: campaignRepo.EnqueueZaloRealtimeGroupEventRequest) {
    return campaignRepo.enqueueZaloRealtimeGroupEvent(request)
  }

  // =========== CAMPAIGN INPUTS (pool nguyên liệu) ===========
  listCampaignInputs(campaignId: number) { return campaignRepo.listCampaignInputs(campaignId) }
  createCampaignInput(input: Partial<CampaignInput>) { return campaignRepo.createCampaignInput(input) }
  updateCampaignInput(id: number, updates: Partial<CampaignInput>) { return campaignRepo.updateCampaignInput(id, updates) }
  deleteCampaignInput(id: number) { return campaignRepo.deleteCampaignInput(id) }

  // =========== CAMPAIGN INPUT DATA (việc-cần-làm) ===========
  listCampaignInputData(campaignId: number) { return campaignRepo.listCampaignInputData(campaignId) }
  listCampaignRelationSummaries(campaignIds: number[]) { return campaignRepo.listCampaignRelationSummaries(campaignIds) }
  createCampaignInputData(action: Partial<CampaignInputData>) { return campaignRepo.createCampaignInputData(action) }
  createSmsCampaignInputDataSnapshot(action: Partial<CampaignInputData>) { return campaignRepo.createSmsCampaignInputDataSnapshot(action) }
  updateCampaignInputData(id: number, updates: Partial<CampaignInputData>) { return campaignRepo.updateCampaignInputData(id, updates) }
  bulkUpdateCampaignInputDataStatus(campaignId: number, ids: number[], status: Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>) {
    return campaignRepo.bulkUpdateCampaignInputDataStatus(campaignId, ids, status)
  }
  addCampaignInputDataToCampaign(request: AddCampaignInputDataToCampaignRequest) {
    return campaignRepo.addCampaignInputDataToCampaign(request)
  }
  resetCampaignInputDataForRerun(campaignId: number) { return campaignRepo.resetCampaignInputDataForRerun(campaignId) }
  clearCampaignInputData(campaignId: number) { return campaignRepo.clearCampaignInputData(campaignId) }
  deleteCampaignInputData(id: number) { return campaignRepo.deleteCampaignInputData(id) }

  // =========== CAMPAIGN DETAILS (per-milestone log) ===========
  listCampaignDetailsByInputData(inputDataId: number) { return campaignRepo.listCampaignDetailsByInputData(inputDataId) }
  listCampaignDetailsByCampaign(campaignId: number) { return campaignRepo.listCampaignDetailsByCampaign(campaignId) }
  createCampaignDetail(action: CreateCampaignDetailInput) { return campaignRepo.createCampaignDetail(action) }
  deleteCampaignDetail(id: number) { return campaignRepo.deleteCampaignDetail(id) }
  createEmailMessageTracking(input: emailTrackingRepo.CreateEmailMessageTrackingInput) {
    return emailTrackingRepo.createEmailMessageTracking(input)
  }
  createEmailLinkTrackings(rows: emailTrackingRepo.CreateEmailLinkTrackingInput[]) {
    return emailTrackingRepo.createEmailLinkTrackings(rows)
  }
  markEmailMessageTrackingSent(messageTrackingId: number, messageId?: string | null) {
    return emailTrackingRepo.markEmailMessageTrackingSent(messageTrackingId, messageId)
  }
  softDeleteEmailMessageTracking(messageTrackingId: number) {
    return emailTrackingRepo.softDeleteEmailMessageTracking(messageTrackingId)
  }
  linkEmailMessageTrackingToDetail(messageTrackingId: number, campaignDetailId: number) {
    return emailTrackingRepo.linkEmailMessageTrackingToDetail(messageTrackingId, campaignDetailId)
  }
  listEmailCampaignLinkTrackingSummaries(campaignId: number) {
    return emailTrackingRepo.listEmailCampaignLinkTrackingSummaries(campaignId)
  }
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
  getAccountActionDisabledStatus(accountId: number, actionCode: string, actionName: string) {
    return campaignRepo.getAccountActionDisabledStatus(accountId, actionCode, actionName)
  }

  // =========== CONTENT TEMPLATES ===========
  listContentTemplates() { return contentTemplateRepo.listContentTemplates() }
  createContentTemplate(template: Partial<ContentTemplate>) { return contentTemplateRepo.createContentTemplate(template) }
  updateContentTemplate(id: number, updates: Partial<ContentTemplate>) { return contentTemplateRepo.updateContentTemplate(id, updates) }
  deleteContentTemplate(id: number) { return contentTemplateRepo.deleteContentTemplate(id) }

  // =========== MEDIA LIBRARY ===========
  getMediaStorageSettings() { return mediaFileRepo.getMediaStorageSettings() }
  saveMediaStorageSettings(settings: Partial<MediaStorageSettings>) { return mediaFileRepo.saveMediaStorageSettings(settings) }
  testMediaStorageSettings(settings?: Partial<MediaStorageSettings>) { return mediaFileRepo.testMediaStorageSettings(settings) }
  listMediaFiles() { return mediaFileRepo.listMediaFiles() }
  uploadMediaFiles(localPaths: string[]) { return mediaFileRepo.uploadMediaFiles(localPaths) }
  deleteMediaFile(id: number) { return mediaFileRepo.deleteMediaFile(id) }
  listMediaGroups() { return mediaFileRepo.listMediaGroups() }
  createMediaGroup(group: Partial<MediaGroup>) { return mediaFileRepo.createMediaGroup(group) }
  updateMediaGroup(id: number, updates: Partial<MediaGroup>) { return mediaFileRepo.updateMediaGroup(id, updates) }
  deleteMediaGroup(id: number) { return mediaFileRepo.deleteMediaGroup(id) }
  listMediaGroupFileIds(groupId: number) { return mediaFileRepo.listMediaGroupFileIds(groupId) }
  addMediaGroupFiles(groupId: number, mediaFileIds: number[]) { return mediaFileRepo.addMediaGroupFiles(groupId, mediaFileIds) }
  removeMediaGroupFiles(groupId: number, mediaFileIds: number[]) { return mediaFileRepo.removeMediaGroupFiles(groupId, mediaFileIds) }

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
  listContactsPage(accountId: number, query?: AccountContactListQuery) {
    return accountContactRepo.listContactsPage(accountId, query)
  }
  exportContactsPage(accountId: number, query?: AccountContactListQuery) {
    return accountContactRepo.exportContactsPage(accountId, query)
  }
  appendZaloTagsToExistingContacts(
    accountId: number,
    contactType: ContactType,
    uids: string[],
    tags: Array<{ id: number | string; name?: string | null }>
  ) { return accountContactRepo.appendZaloTagsToExistingContacts(accountId, contactType, uids, tags) }
  syncZaloLabelMemberships(accountId: number, labels: Parameters<typeof accountContactRepo.syncZaloLabelMemberships>[1]) {
    return accountContactRepo.syncZaloLabelMemberships(accountId, labels)
  }
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
  upsertZaloCampaignUserContacts(
    contacts: accountContactRepo.ZaloUserContactInput[]
  ) { return accountContactRepo.upsertZaloCampaignUserContacts(contacts) }
  upsertZaloGroupContacts(
    contacts: accountContactRepo.ZaloGroupContactInput[],
    options?: Parameters<typeof accountContactRepo.upsertZaloGroupContacts>[1]
  ) { return accountContactRepo.upsertZaloGroupContacts(contacts, options) }
  upsertZaloGroupMemberContacts(
    input: accountContactRepo.ZaloGroupMemberUpsertInput
  ) { return accountContactRepo.upsertZaloGroupMemberContacts(input) }
  listZaloGroupMemberContacts(accountId: number, query: ZaloGroupMemberContactListQuery) {
    return accountContactRepo.listZaloGroupMemberContacts(accountId, query)
  }
  exportZaloGroupMemberContacts(accountId: number, query: ZaloGroupMemberContactListQuery) {
    return accountContactRepo.exportZaloGroupMemberContacts(accountId, query)
  }
  listZaloRemarketingCustomers(accountId: number, query?: ZaloRemarketingCustomerListQuery) {
    return campaignRepo.listZaloRemarketingCustomers(accountId, query)
  }
  exportZaloRemarketingCustomers(accountId: number, query?: ZaloRemarketingCustomerListQuery) {
    return campaignRepo.exportZaloRemarketingCustomers(accountId, query)
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
  listAkaBizContactTags() {
    return contactTagRepo.listAkaBizContactTags()
  }
  createAkaBizContactTag(name: string): Promise<AkaBizContactTag> {
    return contactTagRepo.createAkaBizContactTag(name)
  }
  updateAkaBizContactTag(tagId: number, name: string): Promise<AkaBizContactTag> {
    return contactTagRepo.updateAkaBizContactTag(tagId, name)
  }
  deleteAkaBizContactTag(tagId: number) {
    return contactTagRepo.deleteAkaBizContactTag(tagId)
  }
  applyAkaBizTagsToContactTargets(
    targets: contactTagRepo.AkaBizContactTagTarget[],
    tagIds: number[]
  ) {
    return contactTagRepo.applyAkaBizTagsToContactTargets(targets, tagIds)
  }
  addContactsToGroup(groupId: number, contactIds: number[]) {
    return accountContactRepo.addContactsToGroup(groupId, contactIds)
  }
  removeContactsFromGroup(groupId: number, contactIds: number[]) {
    return accountContactRepo.removeContactsFromGroup(groupId, contactIds)
  }
  listZaloFriendBlocklists(accountId: number) {
    return accountContactRepo.listZaloFriendBlocklists(accountId)
  }
  createZaloFriendBlocklist(accountId: number, name: string) {
    return accountContactRepo.createZaloFriendBlocklist(accountId, name)
  }
  updateZaloFriendBlocklist(groupId: number, name: string) {
    return accountContactRepo.updateZaloFriendBlocklist(groupId, name)
  }
  deleteZaloFriendBlocklist(groupId: number) {
    return accountContactRepo.deleteZaloFriendBlocklist(groupId)
  }
  listZaloFriendBlocklistFriends(groupId: number) {
    return accountContactRepo.listZaloFriendBlocklistFriends(groupId)
  }
  addFriendsToZaloFriendBlocklist(groupId: number, contactIds: number[]) {
    return accountContactRepo.addFriendsToZaloFriendBlocklist(groupId, contactIds)
  }
  removeFriendsFromZaloFriendBlocklist(groupId: number, contactIds: number[]) {
    return accountContactRepo.removeFriendsFromZaloFriendBlocklist(groupId, contactIds)
  }
  getZaloFriendBlocklistUidSnapshot(accountId: number, groupId: number) {
    return accountContactRepo.getZaloFriendBlocklistUidSnapshot(accountId, groupId)
  }

  // =========== SYSTEM SETTINGS ===========
  async getSystemSettingValue(key: string): Promise<string> {
    const settings = await systemSettingsRepo.listActiveSystemSettingsByKeys([key])
    return systemSettingsRepo.getSettingValue(settings, key)
  }
}
