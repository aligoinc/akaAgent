import { AccountContactListQuery, ActionLimitConfig, AkaBizContactTag, AutoAccount, AutoAccountGroup, AutoProxy, Campaign, CampaignUpdate, CampaignAction, CampaignInput, CampaignInputData, CampaignInputDataPageQuery, CampaignDetail, CampaignDetailPageQuery, CreateCampaignDetailInput, AutoAccountContact, ContactDatasetFinalizeInput, ContactDatasetListQuery, ContactType, CreateContentTemplateGroupInput, CreateContentTemplateInput, UpdateContentTemplateGroupInput, UpdateContentTemplateInput, EmailNotificationSettings, AccountActionReportDetailQuery, AccountActionReportQuery, AddCampaignInputDataRowsRequest, AddCampaignInputDataToCampaignRequest, CampaignInputStatus, CampaignRunEventListOptions, CampaignStatus, SaveUploadDatasetRequest, ZaloGroupMemberContactListQuery, ZaloSessionCredentials, EmailAccountConfig, ZaloRemarketingCustomerListQuery, MediaClipboardImageInput, MediaGroup, MediaStorageSettings, BindCampaignDataGroupSourceRequest, CreateCampaignBundleRequest, CreateDataGroupRequest, DataGroupCampaignTargetPreviewRequest, DataGroupIngestRequest, DataGroupListQuery, DataGroupMemberListQuery, DataGroupMemberMutationRequest, MoveDataGroupMembersRequest, SaveDataGroupDynamicFilterRequest, SnapshotDataGroupToCampaignRequest, UpdateDataGroupRequest } from '../../shared/types'
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
import * as appNotificationRepo from '../data/repositories/appNotificationRepository'
import * as reportRepo from '../data/repositories/reportRepository'
import * as zaloApiErrorLogRepo from '../data/repositories/zaloApiErrorLogRepository'
import * as systemSettingsRepo from '../data/repositories/systemSettingsRepository'
import * as emailTrackingRepo from '../data/repositories/emailTrackingRepository'
import * as dataGroupRepo from '../data/repositories/dataGroupRepository'
import * as runtimeClockRepo from '../data/repositories/runtimeClockRepository'

/**
 * Facade that delegates to individual repositories.
 * Keeps a thin service API so callers do not know repository boundaries.
 */
export class SupabaseService {
  getRuntimeClock() { return runtimeClockRepo.getDatabaseRuntimeClock() }
  invalidateRuntimeClock() { runtimeClockRepo.invalidateDatabaseRuntimeClock() }

  // =========== RECOVERY ===========
  async resetRunningStatuses(staffId: number): Promise<void> {
    console.log(`[Supabase] Resetting "đang chạy" statuses to "chờ xử lý" for staff ${staffId}...`)
    await accountRepo.resetRunningAccountStatuses(staffId)
    await campaignRepo.resetRunningCampaignStatuses(staffId)
    await campaignRepo.resetCampaignNotes(staffId)
    await campaignRepo.resetRunningCampaignInputStatuses(staffId)
    await campaignRepo.resetRunningCampaignInputDataStatuses(staffId)
  }

  recoverServerZaloRunningState(staffId: number, options?: accountRepo.ServerZaloRecoveryOptions) {
    return accountRepo.recoverServerZaloRunningState(staffId, options)
  }

  recoverDesktopZaloRunningState(staffId: number, expectedModeRevision: string) {
    return accountRepo.recoverDesktopZaloRunningState(staffId, expectedModeRevision)
  }

  async resetDesktopRunningStatuses(staffId: number, excludeZalo: boolean, zaloUncertainNoRetry = false) {
    return accountRepo.resetDesktopRunningStatuses(staffId, excludeZalo, zaloUncertainNoRetry)
  }

  // =========== ACCOUNTS ===========
  getAccount(id: number) { return accountRepo.getAccount(id) }
  getAccountIgnoringCapability(id: number) { return accountRepo.getAccountIgnoringCapability(id) }
  listAccounts() { return accountRepo.listAccounts() }
  createAccount(account: Partial<AutoAccount>) { return accountRepo.createAccount(account) }
  updateAccount(id: number, updates: Partial<AutoAccount>, options?: accountRepo.UpdateAccountOptions) {
    return accountRepo.updateAccount(id, updates, options)
  }
  claimNonZaloAccountRuntimeOperation(
    id: number,
    flatformType: string,
    previousStatus: accountRepo.AccountRuntimePreviousStatus,
    requiresLogin = true
  ) {
    return accountRepo.claimNonZaloAccountRuntimeOperation(id, flatformType, previousStatus, requiresLogin)
  }
  releaseNonZaloAccountRuntimeOperation(
    id: number,
    flatformType: string,
    previousStatus: accountRepo.AccountRuntimePreviousStatus,
    claimToken: string,
    staffId?: number
  ) {
    return accountRepo.releaseNonZaloAccountRuntimeOperation(id, flatformType, previousStatus, claimToken, staffId)
  }
  setZaloServerAccountStatus(id: number, status: accountRepo.ZaloServerAccountControlStatus) {
    return accountRepo.setZaloServerAccountStatus(id, status)
  }
  updateClaimedZaloServerAccount(id: number, updates: Partial<AutoAccount>) {
    return accountRepo.updateClaimedZaloServerAccount(id, updates)
  }
  clearAccountMobileDevice(id: number) { return accountRepo.clearAccountMobileDevice(id) }
  deleteAccount(id: number) { return accountRepo.deleteAccount(id) }
  getEligibleAccounts() { return accountRepo.getEligibleAccounts() }
  getAccountZaloSession(id: number) { return accountRepo.getAccountZaloSession(id) }
  listZaloAccountsWithSession(runtimeTarget?: accountRepo.ZaloAccountRuntimeTarget) {
    return accountRepo.listZaloAccountsWithSession(runtimeTarget)
  }
  upsertZaloAccount(input: accountRepo.ZaloAccountUpsertInput) { return accountRepo.upsertZaloAccount(input) }
  updateAccountZaloSession(id: number, input: { zaloAccountId: number; session: ZaloSessionCredentials; verified?: boolean; clearError?: boolean }) {
    return accountRepo.updateAccountZaloSession(id, input)
  }
  markAccountZaloSessionCheck(
    id: number,
    result: { ok: boolean; error?: string | null },
    expectedShowWeb: boolean
  ) {
    return accountRepo.markAccountZaloSessionCheck(id, result, expectedShowWeb)
  }
  updateAccountZaloWebSession(id: number, input: { zaloAccountId: number; verified: boolean; error?: string | null }) {
    return accountRepo.updateAccountZaloWebSession(id, input)
  }
  clearAccountZaloSession(id: number) { return accountRepo.clearAccountZaloSession(id) }
  clearInvalidLocalZaloSession(id: number, expectedSessionUpdatedAt: string | null, verificationError: string) {
    return accountRepo.clearInvalidLocalZaloSession(
      id,
      expectedSessionUpdatedAt,
      verificationError
    )
  }
  claimZaloAccountRuntimeOperation(
    id: number,
    runtimeTarget: accountRepo.ZaloAccountRuntimeTarget,
    requiresLogin = true
  ) {
    return accountRepo.claimZaloAccountRuntimeOperation(id, runtimeTarget, requiresLogin)
  }
  claimZaloAccountTypeChange(
    id: number,
    runtimeTarget: accountRepo.ZaloAccountRuntimeTarget,
    previousStatus: accountRepo.AccountRuntimePreviousStatus
  ) {
    return accountRepo.claimZaloAccountTypeChange(id, runtimeTarget, previousStatus)
  }
  releaseZaloAccountTypeChange(
    id: number,
    runtimeTarget: accountRepo.ZaloAccountRuntimeTarget,
    previousStatus: accountRepo.AccountRuntimePreviousStatus,
    claimToken: string
  ) {
    return accountRepo.releaseZaloAccountTypeChange(id, runtimeTarget, previousStatus, claimToken)
  }
  releaseZaloAccountRuntimeOperation(
    id: number,
    runtimeTarget: accountRepo.ZaloAccountRuntimeTarget,
    previousStatus: 'chờ xử lý' | 'tạm dừng',
    staffId?: number
  ) {
    return accountRepo.releaseZaloAccountRuntimeOperation(id, runtimeTarget, previousStatus, staffId)
  }
  inspectStaffZaloRunningState(staffId: number) { return accountRepo.inspectStaffZaloRunningState(staffId) }
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
  getCampaignConfig(id: number) { return campaignRepo.getCampaignConfig(id) }
  getCampaignLog(id: number) { return campaignRepo.getCampaignLog(id) }
  listCampaignSummaries() { return campaignRepo.listCampaignSummaries() }
  listCampaigns() { return campaignRepo.listCampaigns() }
  createCampaign(campaign: Partial<Campaign>) { return campaignRepo.createCampaign(campaign) }
  updateCampaign(id: number, updates: CampaignUpdate) { return campaignRepo.updateCampaign(id, updates) }
  updateClaimedZaloServerCampaign(id: number, updates: CampaignUpdate) {
    return campaignRepo.updateClaimedZaloServerCampaign(id, updates)
  }
  reopenCompletedCampaignAfterInputInsert(id: number, expectedActionId: string) {
    return campaignRepo.reopenCompletedCampaignAfterInputInsert(id, expectedActionId)
  }
  setZaloServerCampaignStatus(id: number, status: campaignRepo.ZaloServerControlStatus) {
    return campaignRepo.setZaloServerCampaignStatus(id, status)
  }
  getZaloServerRunControlState(campaignId: number, accountId: number) {
    return campaignRepo.getZaloServerRunControlState(campaignId, accountId)
  }
  claimZaloServerRunUnit(campaignId: number, accountId: number, inputDataIds: number[]) {
    return campaignRepo.claimZaloServerRunUnit(campaignId, accountId, inputDataIds)
  }
  finalizeZaloServerCampaign(campaignId: number, note?: string | null) {
    return campaignRepo.finalizeZaloServerCampaign(campaignId, note)
  }
  finalizeCampaign(
    campaignId: number,
    note?: string | null,
    expectedStatus: 'chờ xử lý' | 'đang chạy' = 'đang chạy'
  ) {
    return campaignRepo.finalizeCampaign(campaignId, note, expectedStatus)
  }
  updatePendingUnclaimedCampaignNote(id: number, expectedUpdatedAt: string, note: string) {
    return campaignRepo.updatePendingUnclaimedCampaignNote(id, expectedUpdatedAt, note)
  }
  advanceZaloServerMultiDailySlot(campaignId: number, accountId: number, nextSchedule: string) {
    return campaignRepo.advanceZaloServerMultiDailySlot(campaignId, accountId, nextSchedule)
  }
  deleteCampaign(id: number) { return campaignRepo.deleteCampaign(id) }
  cloneCampaign(id: number) { return campaignRepo.cloneCampaign(id) }
  appendCampaignLog(campaignId: number, logText: string) { return campaignRepo.appendCampaignLog(campaignId, logText) }
  claimCampaignRuntime(campaignId: number, accountId: number, runtimeTarget: campaignRepo.CampaignRuntimeTarget) {
    return campaignRepo.claimCampaignRuntime(campaignId, accountId, runtimeTarget)
  }
  claimCampaignRuntimeV2(
    campaignId: number,
    accountId: number,
    runtimeTarget: campaignRepo.CampaignRuntimeTarget,
    runtimeClaimToken: string
  ) {
    return campaignRepo.claimCampaignRuntimeV2(
      campaignId,
      accountId,
      runtimeTarget,
      runtimeClaimToken
    )
  }
  claimCampaignRunUnitV2(
    campaignId: number,
    accountId: number,
    runtimeTarget: campaignRepo.CampaignRuntimeTarget,
    runtimeClaimToken: string,
    runtimeClaimVietnamDateKey: string,
    runtimeUnitToken: string,
    inputDataIds: number[]
  ) {
    return campaignRepo.claimCampaignRunUnitV2(
      campaignId,
      accountId,
      runtimeTarget,
      runtimeClaimToken,
      runtimeClaimVietnamDateKey,
      runtimeUnitToken,
      inputDataIds
    )
  }
  settleCampaignRunUnitV2(
    campaignId: number,
    accountId: number,
    runtimeTarget: campaignRepo.CampaignRuntimeTarget,
    runtimeUnitToken: string,
    requeueUnstarted: boolean
  ) {
    return campaignRepo.settleCampaignRunUnitV2(
      campaignId,
      accountId,
      runtimeTarget,
      runtimeUnitToken,
      requeueUnstarted
    )
  }
  recoverCampaignRuntimeUnitLeasesV2(
    runtimeTarget: campaignRepo.CampaignRuntimeTarget,
    platformScope: 'all' | 'zalo' = 'all'
  ) {
    return campaignRepo.recoverCampaignRuntimeUnitLeasesV2(runtimeTarget, platformScope)
  }
  setDesktopCampaignStatusV2(
    campaignId: number,
    accountId: number,
    targetStatus: Extract<CampaignStatus, 'chờ xử lý' | 'tạm dừng'>
  ) {
    return campaignRepo.setDesktopCampaignStatusV2(campaignId, accountId, targetStatus)
  }
  checkCampaignDailyBoundary(
    campaignId: number,
    accountId: number,
    runtimeTarget: campaignRepo.CampaignRuntimeTarget,
    claimedVietnamDateKey: string
  ) {
    return campaignRepo.checkCampaignDailyBoundary(
      campaignId,
      accountId,
      runtimeTarget,
      claimedVietnamDateKey
    )
  }
  yieldCampaignDailyBoundary(
    campaignId: number,
    accountId: number,
    runtimeTarget: campaignRepo.CampaignRuntimeTarget,
    runtimeClaimToken: string,
    claimedVietnamDateKey: string
  ) {
    return campaignRepo.yieldCampaignDailyBoundary(
      campaignId,
      accountId,
      runtimeTarget,
      runtimeClaimToken,
      claimedVietnamDateKey
    )
  }
  checkDailyMaintenanceBarrier(runtimeTarget: campaignRepo.CampaignRuntimeTarget, vietnamDateKey: string) {
    return campaignRepo.checkDailyMaintenanceBarrier(runtimeTarget, vietnamDateKey)
  }
  getPendingCampaigns(accountId: number, dbNow: string) { return campaignRepo.getPendingCampaigns(accountId, dbNow) }
  getDueMobileManagedCampaignsForLimitCheck(accountId: number, dbNow: string) {
    return campaignRepo.getDueMobileManagedCampaignsForLimitCheck(accountId, dbNow)
  }
  maintainCampaignSchedules(vietnamDateKey: string) {
    return campaignRepo.maintainCampaignSchedules(vietnamDateKey)
  }
  maintainZaloCampaignSchedules(vietnamDateKey: string) {
    return campaignRepo.maintainZaloCampaignSchedules(vietnamDateKey)
  }
  maintainZaloServerCampaignSchedules(runtimeModeRevision: string, vietnamDateKey: string) {
    return campaignRepo.maintainZaloServerCampaignSchedules(runtimeModeRevision, vietnamDateKey)
  }
  maintainNonZaloCampaignSchedules(vietnamDateKey: string) {
    return campaignRepo.maintainNonZaloCampaignSchedules(vietnamDateKey)
  }
  listZaloRealtimeGroupCampaignSnapshots(runtimeTarget: campaignRepo.CampaignRuntimeTarget = 'desktop') {
    return campaignRepo.listZaloRealtimeGroupCampaignSnapshots(runtimeTarget)
  }
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
  listCampaignInputDataPage(query: CampaignInputDataPageQuery) { return campaignRepo.listCampaignInputDataPage(query) }
  listCampaignRelationSummaries(campaignIds: number[]) { return campaignRepo.listCampaignRelationSummaries(campaignIds) }
  createCampaignInputData(action: Partial<CampaignInputData>) { return campaignRepo.createCampaignInputData(action) }
  createCampaignInputDataBatch(
    actions: Partial<CampaignInputData>[],
    onProgress?: campaignRepo.CampaignInputDataWriteProgressCallback
  ) {
    return campaignRepo.createCampaignInputDataBatch(actions, onProgress)
  }
  createCampaignInputDataBatchWithRollback(actions: Partial<CampaignInputData>[], beforeChunk?: () => void) {
    return campaignRepo.createCampaignInputDataBatchWithRollback(actions, beforeChunk)
  }
  createSmsCampaignInputDataSnapshot(action: Partial<CampaignInputData>) { return campaignRepo.createSmsCampaignInputDataSnapshot(action) }
  updateCampaignInputData(id: number, updates: Partial<CampaignInputData>) { return campaignRepo.updateCampaignInputData(id, updates) }
  bulkUpdateCampaignInputDataStatus(campaignId: number, ids: number[], status: Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>) {
    return campaignRepo.bulkUpdateCampaignInputDataStatus(campaignId, ids, status)
  }
  addCampaignInputDataToCampaign(request: AddCampaignInputDataToCampaignRequest) {
    return campaignRepo.addCampaignInputDataToCampaign(request)
  }
  addCampaignInputDataRows(
    request: AddCampaignInputDataRowsRequest,
    onProgress?: campaignRepo.CampaignInputDataWriteProgressCallback
  ) {
    return campaignRepo.addCampaignInputDataRows(request, onProgress)
  }
  resetCampaignInputDataForRerun(campaignId: number) { return campaignRepo.resetCampaignInputDataForRerun(campaignId) }
  clearCampaignInputData(campaignId: number) { return campaignRepo.clearCampaignInputData(campaignId) }
  deleteCampaignInputData(id: number) { return campaignRepo.deleteCampaignInputData(id) }
  deleteCampaignInputDataBatch(ids: number[]) { return campaignRepo.deleteCampaignInputDataBatch(ids) }
  applyCampaignDeliveryCooldown(campaignId: number, accountId: number, inputDataIds: number[]) {
    return campaignRepo.applyCampaignDeliveryCooldown(campaignId, accountId, inputDataIds)
  }

  // =========== CAMPAIGN DETAILS (per-milestone log) ===========
  listCampaignDetailsByInputData(inputDataId: number) { return campaignRepo.listCampaignDetailsByInputData(inputDataId) }
  listCampaignDetailsByCampaign(campaignId: number) { return campaignRepo.listCampaignDetailsByCampaign(campaignId) }
  listCampaignDetailsPage(query: CampaignDetailPageQuery) { return campaignRepo.listCampaignDetailsPage(query) }
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
  peekAccountRateLimitStatus(accountId: number, actionCode: string, actionName: string, limitConfig?: ActionLimitConfig) {
    return campaignRepo.peekAccountRateLimitStatus(accountId, actionCode, actionName, limitConfig)
  }
  getAccountActionDisabledStatus(accountId: number, actionCode: string, actionName: string) {
    return campaignRepo.getAccountActionDisabledStatus(accountId, actionCode, actionName)
  }
  peekAccountActionDisabledStatus(accountId: number, actionCode: string, actionName: string) {
    return campaignRepo.peekAccountActionDisabledStatus(accountId, actionCode, actionName)
  }

  // =========== CONTENT TEMPLATES ===========
  listContentTemplates() { return contentTemplateRepo.listContentTemplates() }
  createContentTemplate(template: CreateContentTemplateInput) { return contentTemplateRepo.createContentTemplate(template) }
  updateContentTemplate(id: number, updates: UpdateContentTemplateInput) { return contentTemplateRepo.updateContentTemplate(id, updates) }
  deleteContentTemplate(id: number) { return contentTemplateRepo.deleteContentTemplate(id) }
  listContentTemplateGroups() { return contentTemplateRepo.listContentTemplateGroups() }
  createContentTemplateGroup(input: CreateContentTemplateGroupInput) { return contentTemplateRepo.createContentTemplateGroup(input) }
  updateContentTemplateGroup(id: number, updates: UpdateContentTemplateGroupInput) {
    return contentTemplateRepo.updateContentTemplateGroup(id, updates)
  }
  deleteContentTemplateGroup(id: number) { return contentTemplateRepo.deleteContentTemplateGroup(id) }
  listContentTemplateContentTypes() { return contentTemplateRepo.listContentTemplateContentTypes() }

  // =========== MEDIA LIBRARY ===========
  getMediaStorageSettings() { return mediaFileRepo.getMediaStorageSettings() }
  saveMediaStorageSettings(settings: Partial<MediaStorageSettings>) { return mediaFileRepo.saveMediaStorageSettings(settings) }
  testMediaStorageSettings(settings?: Partial<MediaStorageSettings>) { return mediaFileRepo.testMediaStorageSettings(settings) }
  listMediaFiles() { return mediaFileRepo.listMediaFiles() }
  uploadMediaFiles(localPaths: string[]) { return mediaFileRepo.uploadMediaFiles(localPaths) }
  uploadMediaClipboardImages(images: MediaClipboardImageInput[]) { return mediaFileRepo.uploadMediaClipboardImages(images) }
  deleteMediaFile(id: number) { return mediaFileRepo.deleteMediaFile(id) }
  deleteMediaFiles(ids: number[]) { return mediaFileRepo.deleteMediaFiles(ids) }
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

  // =========== APP NOTIFICATIONS ===========
  getActiveAppNotification() { return appNotificationRepo.getActiveAppNotification() }

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
  getZaloErrorPolicyByCode(code: string | number, actionCode?: string | null) {
    return errorPolicyRepo.getZaloErrorPolicyByCode(code, actionCode)
  }
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
  listContactDatasets(query: ContactDatasetListQuery) {
    return accountContactRepo.listContactDatasets(query)
  }
  finalizeContactDataset(input: ContactDatasetFinalizeInput) {
    return accountContactRepo.finalizeContactDataset(input)
  }
  saveUploadDataset(request: SaveUploadDatasetRequest) {
    return accountContactRepo.saveUploadDataset(request)
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
  listContactGroupContacts(groupId: number, accountId: number, contactType?: ContactType) {
    return accountContactRepo.listContactGroupContacts(groupId, undefined, { accountId, contactType })
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
  listDataGroups(query?: DataGroupListQuery) {
    return dataGroupRepo.listDataGroups(query)
  }
  listDataTypeCategoryItems() {
    return dataGroupRepo.listDataTypeCategoryItems()
  }
  createDataGroup(request: CreateDataGroupRequest) {
    return dataGroupRepo.createDataGroup(request)
  }
  updateDataGroup(request: UpdateDataGroupRequest) {
    return dataGroupRepo.updateDataGroup(request)
  }
  deleteDataGroup(groupId: number, requestId: string, detachAutomations = true) {
    return dataGroupRepo.deleteDataGroup(groupId, requestId, detachAutomations)
  }
  duplicateDataGroup(groupId: number, name: string | null, requestId: string) {
    return dataGroupRepo.duplicateDataGroup(groupId, name, requestId)
  }
  listDataGroupMembers(query: DataGroupMemberListQuery) {
    return dataGroupRepo.listDataGroupMembers(query)
  }
  listDataGroupMemberIds(query: DataGroupMemberListQuery) {
    return dataGroupRepo.listDataGroupMemberIds(query)
  }
  listDataGroupDatasets(groupId: number) {
    return dataGroupRepo.listDataGroupDatasets(groupId)
  }
  getDataGroupLatestIngestStats(groupId: number) {
    return dataGroupRepo.getDataGroupLatestIngestStats(groupId)
  }
  getDataGroupPanel(groupId: number) {
    return dataGroupRepo.getDataGroupPanel(groupId)
  }
  getDataGroupDynamicFilter(groupId: number) {
    return dataGroupRepo.getDataGroupDynamicFilter(groupId)
  }
  saveDataGroupDynamicFilter(request: SaveDataGroupDynamicFilterRequest) {
    return dataGroupRepo.saveDataGroupDynamicFilter(request)
  }
  updateDataGroupNote(groupId: number, note: string | null) {
    return dataGroupRepo.updateDataGroupNote(groupId, note)
  }
  exportDataGroupMembers(query: DataGroupMemberListQuery) {
    return dataGroupRepo.exportDataGroupMembers(query)
  }
  ingestDataGroup(request: DataGroupIngestRequest) {
    return dataGroupRepo.ingestDataGroup(request)
  }
  removeDataGroupMembers(request: DataGroupMemberMutationRequest) {
    return dataGroupRepo.removeDataGroupMembers(request)
  }
  moveDataGroupMembers(request: MoveDataGroupMembersRequest) {
    return dataGroupRepo.moveDataGroupMembers(request)
  }
  bindCampaignDataGroupSource(request: BindCampaignDataGroupSourceRequest) {
    return dataGroupRepo.bindCampaignDataGroupSource(request)
  }
  previewDataGroupCampaignTargets(request: DataGroupCampaignTargetPreviewRequest) {
    return dataGroupRepo.previewDataGroupCampaignTargets(request)
  }
  snapshotDataGroupToCampaign(request: SnapshotDataGroupToCampaignRequest) {
    return dataGroupRepo.snapshotDataGroupToCampaign(request)
  }
  preflightCampaignDataGroupChange(campaignId: number, groupId: number) {
    return dataGroupRepo.preflightCampaignDataGroupChange(campaignId, groupId)
  }
  createCampaignCreationBundle(request: CreateCampaignBundleRequest) {
    return dataGroupRepo.createCampaignCreationBundle(request)
  }
  getCampaignDataGroupSource(campaignId: number) {
    return dataGroupRepo.getCampaignDataGroupSource(campaignId)
  }
  stopCampaignDataGroupSource(campaignId: number, requestId: string, reason?: string) {
    return dataGroupRepo.stopCampaignDataGroupSource(campaignId, requestId, reason)
  }
  reactivateCampaignDataGroupSource(campaignId: number, requestId: string) {
    return dataGroupRepo.reactivateCampaignDataGroupSource(campaignId, requestId)
  }
  finalizeDataGroupCampaign(
    campaignId: number,
    note?: string | null,
    runtimeContext?: dataGroupRepo.DataGroupRuntimeContext
  ) {
    return dataGroupRepo.finalizeDataGroupCampaign(campaignId, note, runtimeContext)
  }
  finalizeExpiredDataGroupCampaigns(
    limit?: number,
    runtimeContext?: dataGroupRepo.DataGroupRuntimeContext
  ) {
    return dataGroupRepo.finalizeExpiredDataGroupCampaigns(limit, runtimeContext)
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
