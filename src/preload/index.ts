import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_EVENTS, AutoAccount, Campaign, CampaignAction, CampaignInput, CampaignInputData, CampaignDetail, AutoAccountContact, ContactType, AuthUser } from '../shared/types'
import { IPC_EVENTS_V2, BlockDef, WorkflowDef, ElementDef, RunStepV2, BlockResult } from '../shared/v2Types'

export type ElectronAPI = typeof electronAPI

const electronAPI = {
  // Auth
  login: (username: string, password: string): Promise<AuthUser> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_LOGIN, username, password),

  logout: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_LOGOUT),

  getCurrentUser: (): Promise<AuthUser | null> =>
    ipcRenderer.invoke(IPC_EVENTS.AUTH_ME),

  // Theme
  setTheme: (theme: 'light' | 'dark'): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.THEME_CHANGE, theme),

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

  createCampaignInputData: (data: Partial<CampaignInputData>): Promise<CampaignInputData> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_CAMPAIGN_INPUT_DATA, data),

  updateCampaignInputData: (id: number, updates: Partial<CampaignInputData>): Promise<CampaignInputData> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_UPDATE_CAMPAIGN_INPUT_DATA, id, updates),

  deleteCampaignInputData: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_CAMPAIGN_INPUT_DATA, id),

  // Campaign Details (per-milestone log)
  listCampaignDetailsByInputData: (inputDataId: number): Promise<CampaignDetail[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGN_DETAILS_BY_INPUT_DATA, inputDataId),

  listCampaignDetailsByCampaign: (campaignId: number): Promise<CampaignDetail[]> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_LIST_CAMPAIGN_DETAILS_BY_CAMPAIGN, campaignId),

  createCampaignDetail: (data: Partial<CampaignDetail>): Promise<CampaignDetail> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_CREATE_CAMPAIGN_DETAIL, data),

  deleteCampaignDetail: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.DB_DELETE_CAMPAIGN_DETAIL, id),

  // Campaign Scheduler
  startScheduler: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.SCHEDULER_START),

  stopScheduler: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.SCHEDULER_STOP),

  getSchedulerStatus: (): Promise<{ running: boolean }> =>
    ipcRenderer.invoke(IPC_EVENTS.SCHEDULER_STATUS),

  // Campaign Log (real-time)
  onCampaignLog: (callback: (log: { timestamp: string; message: string }) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, log: { timestamp: string; message: string }) => callback(log)
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
    callback: (payload: { accountId: number; campaignId: number }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { accountId: number; campaignId: number }
    ): void => callback(payload)
    ipcRenderer.on(IPC_EVENTS.CAMPAIGN_BROWSER_SELECT, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.CAMPAIGN_BROWSER_SELECT, handler)
  },

  onCampaignBrowserPreview: (
    callback: (payload: {
      accountId: number
      campaignId: number
      active: boolean
      image?: string
      timestamp: string
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        accountId: number
        campaignId: number
        active: boolean
        image?: string
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

  onAccountStatusUpdated: (callback: () => void): () => void => {
    const handler = () => callback()
    ipcRenderer.on(IPC_EVENTS.ACCOUNT_STATUS_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.ACCOUNT_STATUS_UPDATED, handler)
  },

  // Contacts (Load data)
  loadFriends: (accountId: number): Promise<{ success: boolean; count: number; error?: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_FRIENDS, accountId),

  loadGroups: (accountId: number): Promise<{ success: boolean; count: number; error?: string }> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LOAD_GROUPS, accountId),

  listContacts: (accountId: number, contactType?: ContactType): Promise<AutoAccountContact[]> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_LIST, accountId, contactType),

  deleteContacts: (accountId: number, contactType: ContactType): Promise<void> =>
    ipcRenderer.invoke(IPC_EVENTS.CONTACTS_DELETE, accountId, contactType),

  onContactsProgress: (callback: (data: { message: string }) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    ipcRenderer.on(IPC_EVENTS.CONTACTS_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.CONTACTS_PROGRESS, handler)
  },

  // Resolve absolute disk path for a File object selected via <input type="file">.
  // Electron 32+ removed File.path; webUtils.getPathForFile is the replacement.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // Auto-update
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
