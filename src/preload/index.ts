import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS, FlowData, ExecutionStep, ActionDefinition, FlatformAccount, Campaign, CampaignAction, CampaignDetail, CampaignDetailAction, FlatformContact, ContactType, AuthUser } from '../shared/types'

export type ElectronAPI = typeof electronAPI

const electronAPI = {
  // Auth
  login: (username: string, password: string): Promise<AuthUser> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, username, password),

  logout: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),

  getCurrentUser: (): Promise<AuthUser | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_ME),

  // Theme
  setTheme: (theme: 'light' | 'dark'): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.THEME_CHANGE, theme),

  // Actions
  listActions: (): Promise<ActionDefinition[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.ACTIONS_LIST),

  // Browser (legacy single browser for workflow editor)
  launchBrowser: (options?: { headless?: boolean; profileName?: string }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_LAUNCH, options),

  closeBrowser: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLOSE),

  getBrowserStatus: (): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_STATUS),

  // Webview registration (embedded browser tabs)
  registerWebview: (accountId: number, webContentsId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_REGISTER, accountId, webContentsId),

  unregisterWebview: (accountId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_UNREGISTER, accountId),

  getWebviewStatus: (accountId: number): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_STATUS, accountId),

  // Flow execution
  runFlow: (flowData: FlowData): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLOW_RUN, flowData),

  stopFlow: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLOW_STOP),

  onFlowProgress: (callback: (step: ExecutionStep) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, step: ExecutionStep) => callback(step)
    ipcRenderer.on(IPC_CHANNELS.FLOW_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FLOW_PROGRESS, handler)
  },

  // Database - Flows
  saveFlow: (flowData: FlowData): Promise<FlowData> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_SAVE_FLOW, flowData),

  loadFlow: (flowId: string): Promise<FlowData | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LOAD_FLOW, flowId),

  listFlows: (): Promise<FlowData[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_FLOWS),

  deleteFlow: (flowId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_FLOW, flowId),

  saveRun: (runData: unknown): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_SAVE_RUN, runData),

  listRuns: (flowId?: string): Promise<import('../shared/types').ExecutionRun[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_RUNS, flowId),

  listRunSteps: (runId: string): Promise<ExecutionStep[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_RUN_STEPS, runId),

  // Elements
  saveElement: (elementData: Omit<import('../shared/types').ElementDefinition, 'createdAt' | 'updatedAt'>): Promise<import('../shared/types').ElementDefinition> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_SAVE_ELEMENT, elementData),

  listElements: (): Promise<import('../shared/types').ElementDefinition[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_ELEMENTS),

  deleteElement: (elementId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_ELEMENT, elementId),

  // Flatform Accounts
  listAccounts: (): Promise<FlatformAccount[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_ACCOUNTS),

  createAccount: (data: Partial<FlatformAccount>): Promise<FlatformAccount> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_ACCOUNT, data),

  updateAccount: (id: number, updates: Partial<FlatformAccount>): Promise<FlatformAccount> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_ACCOUNT, id, updates),

  deleteAccount: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_ACCOUNT, id),

  // Campaign Actions
  listCampaignActions: (): Promise<CampaignAction[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_CAMPAIGN_ACTIONS),

  getAllCampaignActions: (): Promise<CampaignAction[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_GET_ALL_CAMPAIGN_ACTIONS),

  createCampaignAction: (data: Partial<CampaignAction>): Promise<CampaignAction> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_CAMPAIGN_ACTION, data),

  updateCampaignAction: (id: string, updates: Partial<CampaignAction>): Promise<CampaignAction> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_CAMPAIGN_ACTION, id, updates),

  deleteCampaignAction: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_CAMPAIGN_ACTION, id),

  // Campaigns
  listCampaigns: (): Promise<Campaign[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_CAMPAIGNS),

  createCampaign: (data: Partial<Campaign>): Promise<Campaign> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_CAMPAIGN, data),

  updateCampaign: (id: number, updates: Partial<Campaign>): Promise<Campaign> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_CAMPAIGN, id, updates),

  deleteCampaign: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_CAMPAIGN, id),

  cloneCampaign: (id: number): Promise<Campaign> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CLONE_CAMPAIGN, id),

  // Campaign Details
  listCampaignDetails: (campaignId: number): Promise<CampaignDetail[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_CAMPAIGN_DETAILS, campaignId),

  createCampaignDetail: (data: Partial<CampaignDetail>): Promise<CampaignDetail> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_CAMPAIGN_DETAIL, data),

  updateCampaignDetail: (id: number, updates: Partial<CampaignDetail>): Promise<CampaignDetail> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_CAMPAIGN_DETAIL, id, updates),

  deleteCampaignDetail: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_CAMPAIGN_DETAIL, id),

  // Campaign Detail Actions (Action Logs)
  listDetailActions: (detailId: number): Promise<CampaignDetailAction[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_DETAIL_ACTIONS, detailId),

  listDetailActionsByCampaign: (campaignId: number): Promise<CampaignDetailAction[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_DETAIL_ACTIONS_BY_CAMPAIGN, campaignId),

  createDetailAction: (data: Partial<CampaignDetailAction>): Promise<CampaignDetailAction> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_DETAIL_ACTION, data),

  deleteDetailAction: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_DETAIL_ACTION, id),

  // Campaign Scheduler
  startScheduler: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULER_START),

  stopScheduler: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULER_STOP),

  getSchedulerStatus: (): Promise<{ running: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULER_STATUS),

  // Campaign Log (real-time)
  onCampaignLog: (callback: (log: { timestamp: string; message: string }) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, log: { timestamp: string; message: string }) => callback(log)
    ipcRenderer.on(IPC_CHANNELS.CAMPAIGN_LOG, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CAMPAIGN_LOG, handler)
  },

  // Campaign Status (real-time)
  onCampaignStatusUpdated: (callback: (campaign: Campaign) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, campaign: Campaign) => callback(campaign)
    ipcRenderer.on(IPC_CHANNELS.CAMPAIGN_STATUS_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CAMPAIGN_STATUS_UPDATED, handler)
  },

  // Account Actions
  checkFacebookLogin: (accountId: number): Promise<{ loggedIn: boolean; status: string; reason?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_CHECK_FB_LOGIN, accountId),

  reloadAccountPage: (accountId: number, flatformType: string): Promise<{ success: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_RELOAD_PAGE, accountId, flatformType),

  onAccountStatusUpdated: (callback: () => void): () => void => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.ACCOUNT_STATUS_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ACCOUNT_STATUS_UPDATED, handler)
  },

  // Contacts (Load data)
  loadFriends: (flatformAccountId: number): Promise<{ success: boolean; count: number; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTACTS_LOAD_FRIENDS, flatformAccountId),

  loadGroups: (flatformAccountId: number): Promise<{ success: boolean; count: number; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTACTS_LOAD_GROUPS, flatformAccountId),

  listContacts: (flatformAccountId: number, contactType?: ContactType): Promise<FlatformContact[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTACTS_LIST, flatformAccountId, contactType),

  deleteContacts: (flatformAccountId: number, contactType: ContactType): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTACTS_DELETE, flatformAccountId, contactType),

  onContactsProgress: (callback: (data: { message: string }) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.CONTACTS_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CONTACTS_PROGRESS, handler)
  },

  // Resolve absolute disk path for a File object selected via <input type="file">.
  // Electron 32+ removed File.path; webUtils.getPathForFile is the replacement.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
