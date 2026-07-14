import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { existsSync } from 'fs'
import { IPC_EVENTS, AccountContactListQuery, AutoAccount, AutoAccountGroup, AutoProxy, ProxyTestRequest, ProxyTestResult, Campaign, CampaignAction, CampaignInput, CampaignInputData, CampaignDetail, CampaignRelationSummary, CampaignRunEvent, CampaignRunEventListOptions, CampaignLogEntry, AutoAccountContact, AutoAccountContactGroup, ContactGroupMutationResult, ContactType, ContactLoadResult, ContactLoadCompleted, ContactLoadProgress, AuthBootstrapResult, AuthSessionExpiredPayload, AuthUser, ZaloRuntimeRestartRequiredPayload, AccountActionOverview, AutoAccountAction, DeviceLockResetResult, LoginPreferences, SavedLoginCredentials, StartupSettingResult, AiRewriteContentRequest, AiWriteMultiOtherContentRequest, AiGenerateCampaignNameRequest, CampaignAssistantChatRequest, CampaignAssistantChatResponse, CampaignAssistantContextResult, CampaignImportDataRow, CampaignImportImageRequest, CampaignImportSheetRequest, AkaBizCampaignListItem, AkaBizCampaignListKind, AkaBizIntegrationKind, AkaBizIntegrations, AkaBizStaffBasic, AkaBizSmsShopListItem, AkaBizDesktopPathValidationResult, AkaBizContactTag, ContentTemplate, ContactListResult, PageInboxContactListQuery, ZaloGroupMemberContactListQuery, ZaloGroupMemberScanRequest, ZaloRemarketingCustomerListQuery, EmailNotificationSettings, AccountActionReportDetailQuery, AccountActionReportDetailResult, AccountActionReportQuery, AccountActionReportResult, AddCampaignInputDataRowsRequest, AddCampaignInputDataRowsResult, AddCampaignInputDataToCampaignRequest, AddCampaignInputDataToCampaignResult, BulkUpdateCampaignInputDataStatusResult, CampaignInputStatus, ZaloLabelOption, ZaloLoginQrEvent, ZaloLoginQrStartResult, ZaloSessionCheckResult, EmailAccountConfig, EmailCampaignLinkTrackingSummary, MediaClipboardImageInput, MediaFile, MediaGroup, MediaStorageSettings, MediaUploadResult, CustomerFeedbackSubmitRequest, CustomerFeedbackSubmitResult } from '../shared/types'
import { IPC_EVENTS_V2, BlockDef, WorkflowDef, ElementDef, RunStepV2, BlockResult } from '../shared/v2Types'

export type ElectronAPI = typeof electronAPI

const electronAPI = {
  platform: process.platform,

  // Auth
  bootstrapAuth: (): Promise<AuthBootstrapResult> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_BOOTSTRAP),

  login: (username: string, password: string, options?: Partial<LoginPreferences>): Promise<AuthUser> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_LOGIN, username, password, options),

  revokeRememberedLogin: (): Promise<AuthBootstrapResult> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_REVOKE_REMEMBERED_LOGIN),

  updateLoginPreferences: (updates: Partial<LoginPreferences>): Promise<AuthBootstrapResult> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_UPDATE_LOGIN_PREFERENCES, updates),

  recoverDeviceCredentials: (): Promise<SavedLoginCredentials> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_RECOVER_DEVICE_CREDENTIALS),

  logout: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_LOGOUT),

  getCurrentUser: (): Promise<AuthUser | null> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_ME),

  resetDeviceLock: (): Promise<DeviceLockResetResult> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_RESET_DEVICE_LOCK),

  changePassword: (oldPassword: string, newPassword: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_CHANGE_PASSWORD, oldPassword, newPassword),

  updateUseTestWorkflow: (useTestWorkflow: boolean): Promise<AuthUser> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_UPDATE_USE_TEST_WORKFLOW, useTestWorkflow),

  onAuthSessionExpired: (callback: (payload: AuthSessionExpiredPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AuthSessionExpiredPayload) => callback(payload)
    ipcRenderer.on(IPC_EVENTS.AUTH_SESSION_EXPIRED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.AUTH_SESSION_EXPIRED, handler)
  },

  onAuthUserUpdated: (callback: (user: AuthUser) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, user: AuthUser) => callback(user)
    ipcRenderer.on(IPC_EVENTS.AUTH_USER_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.AUTH_USER_UPDATED, handler)
  },

  onZaloRuntimeRestartRequired: (callback: (payload: ZaloRuntimeRestartRequiredPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ZaloRuntimeRestartRequiredPayload) => callback(payload)
    ipcRenderer.on(IPC_EVENTS.AUTH_ZALO_RUNTIME_RESTART_REQUIRED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.AUTH_ZALO_RUNTIME_RESTART_REQUIRED, handler)
  },

  // Theme
  setTheme: (theme: 'light' | 'dark'): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.THEME_CHANGE, theme),

  // App settings
  getStartupSetting: (): Promise<StartupSettingResult> =>
    ipcRenderer.invoke(IPC_EVENTS.APP_GET_STARTUP_SETTING),

  setStartupSetting: (enabled: boolean): Promise<StartupSettingResult> =>
    ipcRenderer.invoke(IPC_EVENTS.APP_SET_STARTUP_SETTING, enabled),

  quitApp: (): void => {
    ipcRenderer.send(IPC_EVENTS.APP_QUIT)
  },

  // AI content tools
  rewriteContentWithAI: (data: AiRewriteContentRequest): Promise<string> =>
    ipcRenderer.invoke(IPC_EVENTS.AI_REWRITE_CONTENT, data),

  writeMultiOtherContentWithAI: (data: AiWriteMultiOtherContentRequest): Promise<string> =>
    ipcRenderer.invoke(IPC_EVENTS.AI_WRITE_MULTI_OTHER_CONTENT, data),

  generateCampaignNameWithAI: (data: AiGenerateCampaignNameRequest): Promise<string> =>
    ipcRenderer.invoke(IPC_EVENTS.AI_GENERATE_CAMPAIGN_NAME, data),

  getCampaignAssistantContext: (campaignId: number): Promise<CampaignAssistantContextResult> =>
    ipcRenderer.invoke(IPC_EVENTS.AI_CAMPAIGN_ASSISTANT_CONTEXT, campaignId),

  chatCampaignAssistant: (request: CampaignAssistantChatRequest): Promise<CampaignAssistantChatResponse> =>
    ipcRenderer.invoke(IPC_EVENTS.AI_CAMPAIGN_ASSISTANT_CHAT, request),

  extractCampaignDataFromImage: (request: CampaignImportImageRequest): Promise<CampaignImportDataRow[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CAMPAIGN_IMPORT_EXTRACT_IMAGE, request),

  loadCampaignDataFromSheet: (request: CampaignImportSheetRequest): Promise<CampaignImportDataRow[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET, request),

  // akaBiz external integrations
  getAkaBizIntegrations: (): Promise<AkaBizIntegrations> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_INTEGRATIONS_GET),

  lookupAkaBizIntegration: (kind: AkaBizIntegrationKind, username: string): Promise<AkaBizStaffBasic> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_INTEGRATION_LOOKUP, kind, username),

  saveAkaBizIntegration: (kind: AkaBizIntegrationKind, staff: AkaBizStaffBasic): Promise<AkaBizIntegrations> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_INTEGRATION_SAVE, kind, staff),

  listAkaBizExternalCampaigns: (kind: AkaBizCampaignListKind): Promise<AkaBizCampaignListItem[]> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_EXTERNAL_CAMPAIGNS_LIST, kind),

  listAkaBizSmsShops: (): Promise<AkaBizSmsShopListItem[]> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_SMS_SHOPS_LIST),

  selectAkaBizDesktopInstallPath: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_DESKTOP_INSTALL_PATH_SELECT),

  validateAkaBizDesktopInstallPath: (installPath: string): Promise<AkaBizDesktopPathValidationResult> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_DESKTOP_INSTALL_PATH_VALIDATE, installPath),

  // Webview registration (embedded browser tabs)
  registerWebview: (accountId: number, webContentsId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.WEBVIEW_REGISTER, accountId, webContentsId),

  unregisterWebview: (accountId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.WEBVIEW_UNREGISTER, accountId),

  getWebviewStatus: (accountId: number): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.WEBVIEW_STATUS, accountId),

  // Auto Accounts
  listAccounts: (): Promise<AutoAccount[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_ACCOUNTS),

  createAccount: (data: Partial<AutoAccount>): Promise<AutoAccount> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_ACCOUNT, data),

  updateAccount: (id: number, updates: Partial<AutoAccount>): Promise<AutoAccount> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_UPDATE_ACCOUNT, id, updates),

  deleteAccount: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_ACCOUNT, id),

  listAccountGroups: (flatformType?: string): Promise<AutoAccountGroup[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_ACCOUNT_GROUPS, flatformType),

  createAccountGroup: (data: Partial<AutoAccountGroup>): Promise<AutoAccountGroup> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_ACCOUNT_GROUP, data),

  updateAccountGroup: (id: number, updates: Partial<AutoAccountGroup>): Promise<AutoAccountGroup> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_UPDATE_ACCOUNT_GROUP, id, updates),

  deleteAccountGroup: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_ACCOUNT_GROUP, id),

  listProxies: (): Promise<AutoProxy[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_PROXIES),

  createProxy: (data: Partial<AutoProxy>): Promise<AutoProxy> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_PROXY, data),

  updateProxy: (id: number, updates: Partial<AutoProxy>): Promise<AutoProxy> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_UPDATE_PROXY, id, updates),

  deleteProxy: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_PROXY, id),

  testProxy: (request: ProxyTestRequest): Promise<ProxyTestResult> =>
    ipcRenderer.invoke(IPC_EVENTS.PROXY_TEST, request),

  prepareAccountBrowserSession: (accountId: number): Promise<{ success: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.ACCOUNT_PREPARE_BROWSER_SESSION, accountId),

  listAccountActions: (flatformType?: string, includeRestricted?: boolean): Promise<AutoAccountAction[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_ACCOUNT_ACTIONS, flatformType, includeRestricted),

  // Campaign Actions
  listCampaignActions: (): Promise<CampaignAction[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGN_ACTIONS),

  getAllCampaignActions: (): Promise<CampaignAction[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_GET_ALL_CAMPAIGN_ACTIONS),

  createCampaignAction: (data: Partial<CampaignAction>): Promise<CampaignAction> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_CAMPAIGN_ACTION, data),

  updateCampaignAction: (id: string, updates: Partial<CampaignAction>): Promise<CampaignAction> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_UPDATE_CAMPAIGN_ACTION, id, updates),

  deleteCampaignAction: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_CAMPAIGN_ACTION, id),

  // Campaigns
  listCampaigns: (): Promise<Campaign[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGNS),

  createCampaign: (data: Partial<Campaign>): Promise<Campaign> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_CAMPAIGN, data),

  updateCampaign: (id: number, updates: Partial<Campaign>): Promise<Campaign> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_UPDATE_CAMPAIGN, id, updates),

  deleteCampaign: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_CAMPAIGN, id),

  cloneCampaign: (id: number): Promise<Campaign> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CLONE_CAMPAIGN, id),

  // Campaign Inputs (pool nguyên liệu thô)
  listCampaignInputs: (campaignId: number): Promise<CampaignInput[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGN_INPUTS, campaignId),

  createCampaignInput: (data: Partial<CampaignInput>): Promise<CampaignInput> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_CAMPAIGN_INPUT, data),

  updateCampaignInput: (id: number, updates: Partial<CampaignInput>): Promise<CampaignInput> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_UPDATE_CAMPAIGN_INPUT, id, updates),

  deleteCampaignInput: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_CAMPAIGN_INPUT, id),

  // Campaign Input Data (việc-cần-làm)
  listCampaignInputData: (campaignId: number): Promise<CampaignInputData[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGN_INPUT_DATA, campaignId),

  listCampaignRelationSummaries: (campaignIds: number[]): Promise<CampaignRelationSummary[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGN_RELATION_SUMMARIES, campaignIds),

  createCampaignInputData: (data: Partial<CampaignInputData>): Promise<CampaignInputData> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_CAMPAIGN_INPUT_DATA, data),

  updateCampaignInputData: (id: number, updates: Partial<CampaignInputData>): Promise<CampaignInputData> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_UPDATE_CAMPAIGN_INPUT_DATA, id, updates),

  bulkUpdateCampaignInputDataStatus: (
    campaignId: number,
    ids: number[],
    status: Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>
  ): Promise<BulkUpdateCampaignInputDataStatusResult> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_BULK_UPDATE_CAMPAIGN_INPUT_DATA_STATUS, campaignId, ids, status),

  addCampaignInputDataToCampaign: (
    request: AddCampaignInputDataToCampaignRequest
  ): Promise<AddCampaignInputDataToCampaignResult> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_ADD_CAMPAIGN_INPUT_DATA_TO_CAMPAIGNS, request),

  addCampaignInputDataRows: (
    request: AddCampaignInputDataRowsRequest
  ): Promise<AddCampaignInputDataRowsResult> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_ADD_CAMPAIGN_INPUT_DATA_ROWS, request),

  deleteCampaignInputData: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_CAMPAIGN_INPUT_DATA, id),

  // Campaign Details (per-milestone log)
  listCampaignDetailsByInputData: (inputDataId: number): Promise<CampaignDetail[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGN_DETAILS_BY_INPUT_DATA, inputDataId),

  listCampaignDetailsByCampaign: (campaignId: number): Promise<CampaignDetail[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGN_DETAILS_BY_CAMPAIGN, campaignId),

  listEmailCampaignLinkTrackings: (campaignId: number): Promise<EmailCampaignLinkTrackingSummary[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_EMAIL_CAMPAIGN_LINK_TRACKINGS, campaignId),

  listCampaignRunEventsByCampaign: (
    campaignId: number,
    options?: CampaignRunEventListOptions
  ): Promise<CampaignRunEvent[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGN_RUN_EVENTS_BY_CAMPAIGN, campaignId, options),

  createCampaignDetail: (data: Partial<CampaignDetail>): Promise<CampaignDetail> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_CAMPAIGN_DETAIL, data),

  deleteCampaignDetail: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_CAMPAIGN_DETAIL, id),

  // Content Templates
  listContentTemplates: (): Promise<ContentTemplate[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CONTENT_TEMPLATES),

  createContentTemplate: (data: Partial<ContentTemplate>): Promise<ContentTemplate> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_CONTENT_TEMPLATE, data),

  updateContentTemplate: (id: number, updates: Partial<ContentTemplate>): Promise<ContentTemplate> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_UPDATE_CONTENT_TEMPLATE, id, updates),

  deleteContentTemplate: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_CONTENT_TEMPLATE, id),

  getMediaStorageSettings: (): Promise<MediaStorageSettings> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_STORAGE_SETTINGS_GET),

  saveMediaStorageSettings: (settings: Partial<MediaStorageSettings>): Promise<MediaStorageSettings> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_STORAGE_SETTINGS_SAVE, settings),

  testMediaStorageSettings: (settings?: Partial<MediaStorageSettings>): Promise<{ ok: boolean; cloudUrl?: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_STORAGE_SETTINGS_TEST, settings),

  listMediaFiles: (): Promise<MediaFile[]> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_FILES_LIST),

  uploadMediaFiles: (localPaths: string[]): Promise<MediaUploadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_FILES_UPLOAD, localPaths),

  uploadMediaClipboardImages: (images: MediaClipboardImageInput[]): Promise<MediaUploadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_CLIPBOARD_IMAGES_UPLOAD, images),

  deleteMediaFile: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_FILES_DELETE, id),

  listMediaGroups: (): Promise<MediaGroup[]> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_GROUPS_LIST),

  createMediaGroup: (data: Partial<MediaGroup>): Promise<MediaGroup> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_GROUPS_CREATE, data),

  updateMediaGroup: (id: number, updates: Partial<MediaGroup>): Promise<MediaGroup> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_GROUPS_UPDATE, id, updates),

  deleteMediaGroup: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_GROUPS_DELETE, id),

  listMediaGroupFileIds: (groupId: number): Promise<number[]> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_GROUP_FILE_IDS_LIST, groupId),

  addMediaGroupFiles: (groupId: number, mediaFileIds: number[]): Promise<number[]> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_GROUP_FILES_ADD, groupId, mediaFileIds),

  removeMediaGroupFiles: (groupId: number, mediaFileIds: number[]): Promise<number[]> =>
    ipcRenderer.invoke(IPC_EVENTS.MEDIA_GROUP_FILES_REMOVE, groupId, mediaFileIds),

  submitCustomerFeedback: (request: CustomerFeedbackSubmitRequest): Promise<CustomerFeedbackSubmitResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CUSTOMER_FEEDBACK_SUBMIT, request),

  // Email Notifications
  getEmailNotificationSettings: (): Promise<EmailNotificationSettings> =>
    ipcRenderer.invoke(IPC_EVENTS.EMAIL_NOTIFICATION_SETTINGS_GET),

  saveEmailNotificationSettings: (settings: Partial<EmailNotificationSettings>): Promise<EmailNotificationSettings> =>
    ipcRenderer.invoke(IPC_EVENTS.EMAIL_NOTIFICATION_SETTINGS_SAVE, settings),

  // Reports
  getAccountActionReport: (query: AccountActionReportQuery): Promise<AccountActionReportResult> =>
    ipcRenderer.invoke(IPC_EVENTS.REPORT_ACCOUNT_ACTION_SUMMARY, query),

  getAccountActionReportDetails: (query: AccountActionReportDetailQuery): Promise<AccountActionReportDetailResult> =>
    ipcRenderer.invoke(IPC_EVENTS.REPORT_ACCOUNT_ACTION_DETAILS, query),

  // Campaign Log (real-time)
  onCampaignLog: (callback: (log: CampaignLogEntry) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, log: CampaignLogEntry) => callback(log)
    ipcRenderer.on(IPC_EVENTS.CAMPAIGN_LOG, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.CAMPAIGN_LOG, handler)
  },

  // Campaign Status (real-time)
  onCampaignStatusUpdated: (callback: (campaign: Campaign) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, campaign: Campaign) => callback(campaign)
    ipcRenderer.on(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, handler)
  },

  onCampaignBrowserSelect: (
    callback: (payload: { accountId: number; campaignId?: number; context?: 'campaign' | 'contact-scan' }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { accountId: number; campaignId?: number; context?: 'campaign' | 'contact-scan' }
    ): void => callback(payload)
    ipcRenderer.on(IPC_EVENTS.CAMPAIGN_BROWSER_SELECT, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.CAMPAIGN_BROWSER_SELECT, handler)
  },

  onCampaignBrowserPreview: (
    callback: (payload: {
      accountId: number
      campaignId?: number
      context?: 'campaign' | 'contact-scan'
      active: boolean
      image?: string
      title?: string
      timestamp: string
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        accountId: number
        campaignId?: number
        context?: 'campaign' | 'contact-scan'
        active: boolean
        image?: string
        title?: string
        timestamp: string
      }
    ): void => callback(payload)
    ipcRenderer.on(IPC_EVENTS.CAMPAIGN_BROWSER_PREVIEW, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.CAMPAIGN_BROWSER_PREVIEW, handler)
  },

  // Account Actions
  checkFacebookLogin: (accountId: number): Promise<{ loggedIn: boolean; status: string; reason?: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.ACCOUNT_CHECK_FB_LOGIN, accountId),

  reloadAccountPage: (accountId: number, flatformType: string): Promise<{ success: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.ACCOUNT_RELOAD_PAGE, accountId, flatformType),

  getAccountActionOverview: (accountId: number): Promise<AccountActionOverview[]> =>
    ipcRenderer.invoke(IPC_EVENTS.ACCOUNT_ACTION_OVERVIEW, accountId),

  enableAccountActionNow: (accountId: number, actionCode: string) =>
    ipcRenderer.invoke(IPC_EVENTS.ACCOUNT_ACTION_ENABLE_NOW, accountId, actionCode),

  resetSmsAccountMobileDevice: (accountId: number): Promise<AutoAccount> =>
    ipcRenderer.invoke(IPC_EVENTS.ACCOUNT_SMS_RESET_MOBILE_DEVICE, accountId),

  startZaloLoginQr: (accountId: number): Promise<ZaloLoginQrStartResult> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_LOGIN_QR_START, accountId),

  cancelZaloLoginQr: (accountId: number): Promise<{ success: boolean; accountId: number; reason?: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_LOGIN_QR_CANCEL, accountId),

  checkZaloSession: (accountId: number): Promise<ZaloSessionCheckResult> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_CHECK_SESSION, accountId),

  logoutZalo: (accountId: number): Promise<ZaloSessionCheckResult> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_LOGOUT, accountId),

  listZaloLabels: (accountId: number): Promise<ZaloLabelOption[]> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_LIST_LABELS, accountId),

  syncZaloLabels: (accountId: number): Promise<ZaloLabelOption[]> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_SYNC_LABELS, accountId),

  getEmailConfig: (accountId: number): Promise<EmailAccountConfig | null> =>
    ipcRenderer.invoke(IPC_EVENTS.EMAIL_GET_CONFIG, accountId),

  verifyEmailConfig: (config: EmailAccountConfig): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.EMAIL_VERIFY, config),

  saveEmailConfig: (accountId: number, config: EmailAccountConfig): Promise<{ success: boolean; verified: boolean; error?: string; account: AutoAccount }> =>
    ipcRenderer.invoke(IPC_EVENTS.EMAIL_SAVE_CONFIG, accountId, config),

  logoutEmail: (accountId: number): Promise<{ success: boolean; account: AutoAccount }> =>
    ipcRenderer.invoke(IPC_EVENTS.EMAIL_LOGOUT, accountId),

  onZaloLoginQrEvent: (callback: (event: ZaloLoginQrEvent) => void): () => void => {
    const handler = (_: unknown, event: ZaloLoginQrEvent) => callback(event)
    ipcRenderer.on(IPC_EVENTS.ZALO_LOGIN_QR_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.ZALO_LOGIN_QR_EVENT, handler)
  },

  onAccountStatusUpdated: (callback: () => void): () => void => {
    const handler = () => callback()
    ipcRenderer.on(IPC_EVENTS.ACCOUNT_STATUS_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.ACCOUNT_STATUS_UPDATED, handler)
  },

  // Contacts (Load data)
  loadFriends: (accountId: number): Promise<ContactLoadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_FRIENDS, accountId),

  loadGroups: (accountId: number): Promise<ContactLoadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_GROUPS, accountId),

  loadPages: (accountId: number): Promise<ContactLoadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_PAGES, accountId),

  loadPostCommenters: (accountId: number, postUrl: string, maxCommenters: number): Promise<ContactLoadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_POST_COMMENTERS, accountId, postUrl, maxCommenters),

  loadPostLikes: (accountId: number, postUrl: string, maxLikes: number): Promise<ContactLoadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_POST_LIKES, accountId, postUrl, maxLikes),

  loadProfileFriends: (accountId: number, profileUrl: string, maxFriends: number): Promise<ContactLoadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_PROFILE_FRIENDS, accountId, profileUrl, maxFriends),

  loadGroupMembers: (accountId: number, groupUrl: string, maxGroupMembers: number): Promise<ContactLoadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_GROUP_MEMBERS, accountId, groupUrl, maxGroupMembers),

  loadPageInboxCustomers: (accountId: number, pageUid: string, pageName?: string): Promise<ContactLoadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_PAGE_INBOX_CUSTOMERS, accountId, pageUid, pageName),

  loadZaloGroupMembers: (accountId: number, request: ZaloGroupMemberScanRequest): Promise<ContactLoadResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_ZALO_GROUP_MEMBERS, accountId, request),

  cancelContactLoad: (accountId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_CANCEL_LOAD, accountId),

  listContacts: (accountId: number, contactType?: ContactType): Promise<AutoAccountContact[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LIST, accountId, contactType),

  listContactsPage: (accountId: number, query?: AccountContactListQuery): Promise<ContactListResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LIST_PAGED, accountId, query),

  listPageInboxContacts: (accountId: number, query?: PageInboxContactListQuery): Promise<ContactListResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LIST_PAGE_INBOX, accountId, query),

  listZaloGroupMemberContacts: (accountId: number, query?: ZaloGroupMemberContactListQuery): Promise<ContactListResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LIST_ZALO_GROUP_MEMBERS, accountId, query),

  listZaloRemarketingCustomers: (accountId: number, query?: ZaloRemarketingCustomerListQuery): Promise<ContactListResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LIST_ZALO_REMARKETING_CUSTOMERS, accountId, query),

  exportPageInboxContacts: (accountId: number, query?: PageInboxContactListQuery): Promise<AutoAccountContact[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_EXPORT_PAGE_INBOX, accountId, query),

  exportContactsPage: (accountId: number, query?: AccountContactListQuery): Promise<AutoAccountContact[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_EXPORT_PAGED, accountId, query),

  exportZaloGroupMemberContacts: (accountId: number, query?: ZaloGroupMemberContactListQuery): Promise<AutoAccountContact[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_EXPORT_ZALO_GROUP_MEMBERS, accountId, query),

  exportZaloRemarketingCustomers: (accountId: number, query?: ZaloRemarketingCustomerListQuery): Promise<AutoAccountContact[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_EXPORT_ZALO_REMARKETING_CUSTOMERS, accountId, query),

  deleteContacts: (accountId: number, contactType: ContactType): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_DELETE, accountId, contactType),

  listContactGroups: (accountId: number, contactType?: ContactType): Promise<AutoAccountContactGroup[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACT_GROUPS_LIST, accountId, contactType),

  createContactGroup: (accountId: number, contactType: ContactType, name: string): Promise<AutoAccountContactGroup> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACT_GROUPS_CREATE, accountId, contactType, name),

  updateContactGroup: (groupId: number, name: string): Promise<AutoAccountContactGroup> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACT_GROUPS_UPDATE, groupId, name),

  deleteContactGroup: (groupId: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACT_GROUPS_DELETE, groupId),

  listContactGroupContacts: (groupId: number): Promise<AutoAccountContact[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACT_GROUPS_LIST_CONTACTS, groupId),

  listAkaBizContactTags: (): Promise<AkaBizContactTag[]> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_CONTACT_TAGS_LIST),

  createAkaBizContactTag: (name: string): Promise<AkaBizContactTag> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_CONTACT_TAGS_CREATE, name),

  updateAkaBizContactTag: (tagId: number, name: string): Promise<AkaBizContactTag> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_CONTACT_TAGS_UPDATE, tagId, name),

  deleteAkaBizContactTag: (tagId: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.AKABIZ_CONTACT_TAGS_DELETE, tagId),

  addContactsToGroup: (groupId: number, contactIds: number[]): Promise<ContactGroupMutationResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACT_GROUPS_ADD_CONTACTS, groupId, contactIds),

  removeContactsFromGroup: (groupId: number, contactIds: number[]): Promise<ContactGroupMutationResult> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACT_GROUPS_REMOVE_CONTACTS, groupId, contactIds),

  listZaloFriendBlocklists: (accountId: number): Promise<AutoAccountContactGroup[]> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_LIST, accountId),

  createZaloFriendBlocklist: (accountId: number, name: string): Promise<AutoAccountContactGroup> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_CREATE, accountId, name),

  updateZaloFriendBlocklist: (groupId: number, name: string): Promise<AutoAccountContactGroup> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_UPDATE, groupId, name),

  deleteZaloFriendBlocklist: (groupId: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_DELETE, groupId),

  listZaloFriendBlocklistFriends: (groupId: number): Promise<AutoAccountContact[]> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_LIST_FRIENDS, groupId),

  addFriendsToZaloFriendBlocklist: (groupId: number, contactIds: number[]): Promise<ContactGroupMutationResult> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_ADD_FRIENDS, groupId, contactIds),

  removeFriendsFromZaloFriendBlocklist: (groupId: number, contactIds: number[]): Promise<ContactGroupMutationResult> =>
    ipcRenderer.invoke(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_REMOVE_FRIENDS, groupId, contactIds),

  onContactsProgress: (callback: (data: ContactLoadProgress) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, data: ContactLoadProgress) => callback(data)
    ipcRenderer.on(IPC_EVENTS.CONTACTS_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.CONTACTS_PROGRESS, handler)
  },

  onContactsCompleted: (callback: (data: ContactLoadCompleted) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, data: ContactLoadCompleted) => callback(data)
    ipcRenderer.on(IPC_EVENTS.CONTACTS_COMPLETED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.CONTACTS_COMPLETED, handler)
  },

  // Resolve absolute disk path for a File object selected via <input type="file">.
  // Electron 32+ removed File.path; webUtils.getPathForFile is the replacement.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  fileExists: (filePath: string): boolean => {
    try {
      return existsSync(filePath)
    } catch {
      return false
    }
  },

  readBlockScreenshotDataUrl: (filePath: string): Promise<{ filePath: string; dataUrl: string; sizeBytes: number }> =>
    ipcRenderer.invoke(IPC_EVENTS.APP_READ_BLOCK_SCREENSHOT, filePath),

  readCampaignPreviewFileDataUrl: (filePath: string): Promise<{ filePath: string; dataUrl: string; sizeBytes: number; mimeType: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.APP_READ_CAMPAIGN_PREVIEW_FILE, filePath),

  // Auto-update
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_EVENTS.APP_GET_VERSION),

  checkForUpdate: (): Promise<{
    hasUpdate: boolean
    localVersion: string
    remoteVersion: string
    error?: string
  }> => ipcRenderer.invoke(IPC_EVENTS.UPDATE_CHECK),

  downloadAndInstallUpdate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.UPDATE_DOWNLOAD_INSTALL),

  onUpdateProgress: (
    callback: (p: {
      phase: 'downloading' | 'installing' | 'done' | 'error'
      percent?: number
      transferred?: number
      total?: number
      message?: string
    }) => void
  ): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, p: {
      phase: 'downloading' | 'installing' | 'done' | 'error'
      percent?: number
      transferred?: number
      total?: number
      message?: string
    }): void => callback(p)
    ipcRenderer.on(IPC_EVENTS.UPDATE_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.UPDATE_PROGRESS, handler)
  },

  // ============================================================
  // v2: Workflow / Block / Element library
  // ============================================================
  v2: {
    // Block CRUD
    listBlocks: (): Promise<BlockDef[]> => ipcRenderer.invoke(IPC_EVENTS_V2.BLOCK_LIST),
    getBlock: (id: number): Promise<BlockDef | null> => ipcRenderer.invoke(IPC_EVENTS_V2.BLOCK_GET, id),
    saveBlock: (payload: Partial<BlockDef> & { name: string; category: BlockDef['category']; kind: BlockDef['kind'] }): Promise<BlockDef> =>
      ipcRenderer.invoke(IPC_EVENTS_V2.BLOCK_SAVE, payload),
    deleteBlock: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_EVENTS_V2.BLOCK_DELETE, id),

    // Workflow CRUD
    listWorkflows: (): Promise<WorkflowDef[]> => ipcRenderer.invoke(IPC_EVENTS_V2.WORKFLOW_LIST),
    getWorkflow: (id: number): Promise<WorkflowDef | null> => ipcRenderer.invoke(IPC_EVENTS_V2.WORKFLOW_GET, id),
    saveWorkflow: (payload: Partial<WorkflowDef> & { name: string }): Promise<WorkflowDef> =>
      ipcRenderer.invoke(IPC_EVENTS_V2.WORKFLOW_SAVE, payload),
    deleteWorkflow: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_EVENTS_V2.WORKFLOW_DELETE, id),

    // Element CRUD
    listElements: (): Promise<ElementDef[]> => ipcRenderer.invoke(IPC_EVENTS_V2.ELEMENT_LIST),
    getElement: (id: number): Promise<ElementDef | null> => ipcRenderer.invoke(IPC_EVENTS_V2.ELEMENT_GET, id),
    saveElement: (payload: Partial<ElementDef> & { name: string; xpath: string }): Promise<ElementDef> =>
      ipcRenderer.invoke(IPC_EVENTS_V2.ELEMENT_SAVE, payload),
    deleteElement: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_EVENTS_V2.ELEMENT_DELETE, id),

    // Test runs
    testRunWorkflow: (args: {
      runKey: string
      workflowId?: number
      workflow?: WorkflowDef
      accountId: number
      variables: Record<string, unknown>
    }): Promise<{ runId?: number; status: string; output: Record<string, unknown>; error?: string; steps: RunStepV2[] }> =>
      ipcRenderer.invoke(IPC_EVENTS_V2.WORKFLOW_TEST_RUN, args),

    testRunBlock: (args: {
      runKey: string
      blockId?: number
      code?: string
      blockName?: string
      config: Record<string, unknown>
      accountId: number
      variables: Record<string, unknown>
    }): Promise<BlockResult> =>
      ipcRenderer.invoke(IPC_EVENTS_V2.BLOCK_TEST_RUN, args),

    stopRun: (runKey: string): Promise<{ success: boolean; reason?: string }> =>
      ipcRenderer.invoke(IPC_EVENTS_V2.RUN_STOP, runKey),

    // Run history
    listRunsByWorkflow: (workflowId: number) => ipcRenderer.invoke('v2:run:list-by-workflow', workflowId),
    listRunSteps: (runId: number): Promise<RunStepV2[]> => ipcRenderer.invoke('v2:run:list-steps', runId),

    // Realtime listeners
    onRunProgress: (callback: (payload: { runKey: string; step: RunStepV2 }) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { runKey: string; step: RunStepV2 }): void => callback(payload)
      ipcRenderer.on(IPC_EVENTS_V2.RUN_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS_V2.RUN_PROGRESS, handler)
    },
    onRunLog: (callback: (payload: { runKey: string; nodeId: string; line: string }) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { runKey: string; nodeId: string; line: string }): void => callback(payload)
      ipcRenderer.on(IPC_EVENTS_V2.RUN_LOG, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS_V2.RUN_LOG, handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
