import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS, OrgChannel, Campaign, CampaignAction, CampaignDataInput, CampaignDataAction, CampaignResultAction, OrgChannelContact, ContactType, AuthUser } from '../shared/types'
import { IPC_CHANNELS_V2, BlockDef, WorkflowDef, ElementDef, RunStepV2, BlockResult } from '../shared/v2Types'

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

  // Webview registration (embedded browser tabs)
  registerWebview: (channelId: number, webContentsId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_REGISTER, channelId, webContentsId),

  unregisterWebview: (channelId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_UNREGISTER, channelId),

  getWebviewStatus: (channelId: number): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_STATUS, channelId),

  // Flatform Channels
  listChannels: (): Promise<OrgChannel[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_CHANNELS),

  createChannel: (data: Partial<OrgChannel>): Promise<OrgChannel> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_CHANNEL, data),

  updateChannel: (id: number, updates: Partial<OrgChannel>): Promise<OrgChannel> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_CHANNEL, id, updates),

  deleteChannel: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_CHANNEL, id),

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

  // Campaign Data Inputs (pool nguyên liệu thô)
  listCampaignDataInputs: (campaignId: number): Promise<CampaignDataInput[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_DATA_INPUTS, campaignId),

  createCampaignDataInput: (data: Partial<CampaignDataInput>): Promise<CampaignDataInput> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_DATA_INPUT, data),

  updateCampaignDataInput: (id: number, updates: Partial<CampaignDataInput>): Promise<CampaignDataInput> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_DATA_INPUT, id, updates),

  deleteCampaignDataInput: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_DATA_INPUT, id),

  // Campaign Data Actions (việc-cần-làm)
  listCampaignDataActions: (campaignId: number): Promise<CampaignDataAction[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_DATA_ACTIONS, campaignId),

  createCampaignDataAction: (data: Partial<CampaignDataAction>): Promise<CampaignDataAction> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_DATA_ACTION, data),

  updateCampaignDataAction: (id: number, updates: Partial<CampaignDataAction>): Promise<CampaignDataAction> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_DATA_ACTION, id, updates),

  deleteCampaignDataAction: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_DATA_ACTION, id),

  // Campaign Result Actions (per-milestone log)
  listResultActionsByDataAction: (dataActionId: number): Promise<CampaignResultAction[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_RESULT_ACTIONS_BY_DATA_ACTION, dataActionId),

  listResultActionsByCampaign: (campaignId: number): Promise<CampaignResultAction[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_RESULT_ACTIONS_BY_CAMPAIGN, campaignId),

  createResultAction: (data: Partial<CampaignResultAction>): Promise<CampaignResultAction> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_RESULT_ACTION, data),

  deleteResultAction: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_RESULT_ACTION, id),

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

  // Channel Actions
  checkFacebookLogin: (channelId: number): Promise<{ loggedIn: boolean; status: string; reason?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CHANNEL_CHECK_FB_LOGIN, channelId),

  reloadChannelPage: (channelId: number, flatformType: string): Promise<{ success: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CHANNEL_RELOAD_PAGE, channelId, flatformType),

  onChannelStatusUpdated: (callback: () => void): () => void => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.CHANNEL_STATUS_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHANNEL_STATUS_UPDATED, handler)
  },

  // Contacts (Load data)
  loadFriends: (channelId: number): Promise<{ success: boolean; count: number; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTACTS_LOAD_FRIENDS, channelId),

  loadGroups: (channelId: number): Promise<{ success: boolean; count: number; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTACTS_LOAD_GROUPS, channelId),

  listContacts: (channelId: number, contactType?: ContactType): Promise<OrgChannelContact[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTACTS_LIST, channelId, contactType),

  deleteContacts: (channelId: number, contactType: ContactType): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTACTS_DELETE, channelId, contactType),

  onContactsProgress: (callback: (data: { message: string }) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.CONTACTS_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CONTACTS_PROGRESS, handler)
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
  }> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),

  downloadAndInstallUpdate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD_INSTALL),

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
    ipcRenderer.on(IPC_CHANNELS.UPDATE_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_PROGRESS, handler)
  },

  // ============================================================
  // v2: Workflow / Block / Element library
  // ============================================================
  v2: {
    // Block CRUD
    listBlocks: (): Promise<BlockDef[]> => ipcRenderer.invoke(IPC_CHANNELS_V2.BLOCK_LIST),
    getBlock: (id: number): Promise<BlockDef | null> => ipcRenderer.invoke(IPC_CHANNELS_V2.BLOCK_GET, id),
    saveBlock: (payload: Partial<BlockDef> & { name: string; category: BlockDef['category']; kind: BlockDef['kind'] }): Promise<BlockDef> =>
      ipcRenderer.invoke(IPC_CHANNELS_V2.BLOCK_SAVE, payload),
    deleteBlock: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS_V2.BLOCK_DELETE, id),

    // Workflow CRUD
    listWorkflows: (): Promise<WorkflowDef[]> => ipcRenderer.invoke(IPC_CHANNELS_V2.WORKFLOW_LIST),
    getWorkflow: (id: number): Promise<WorkflowDef | null> => ipcRenderer.invoke(IPC_CHANNELS_V2.WORKFLOW_GET, id),
    saveWorkflow: (payload: Partial<WorkflowDef> & { name: string }): Promise<WorkflowDef> =>
      ipcRenderer.invoke(IPC_CHANNELS_V2.WORKFLOW_SAVE, payload),
    deleteWorkflow: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS_V2.WORKFLOW_DELETE, id),

    // Element CRUD
    listElements: (): Promise<ElementDef[]> => ipcRenderer.invoke(IPC_CHANNELS_V2.ELEMENT_LIST),
    getElement: (id: number): Promise<ElementDef | null> => ipcRenderer.invoke(IPC_CHANNELS_V2.ELEMENT_GET, id),
    saveElement: (payload: Partial<ElementDef> & { name: string; xpath: string }): Promise<ElementDef> =>
      ipcRenderer.invoke(IPC_CHANNELS_V2.ELEMENT_SAVE, payload),
    deleteElement: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS_V2.ELEMENT_DELETE, id),

    // Test runs
    testRunWorkflow: (args: {
      runKey: string
      workflowId?: number
      workflow?: WorkflowDef
      channelId: number
      variables: Record<string, unknown>
    }): Promise<{ runId?: number; status: string; output: Record<string, unknown>; error?: string; steps: RunStepV2[] }> =>
      ipcRenderer.invoke(IPC_CHANNELS_V2.WORKFLOW_TEST_RUN, args),

    testRunBlock: (args: {
      runKey: string
      blockId?: number
      code?: string
      blockName?: string
      config: Record<string, unknown>
      channelId: number
      variables: Record<string, unknown>
    }): Promise<BlockResult> =>
      ipcRenderer.invoke(IPC_CHANNELS_V2.BLOCK_TEST_RUN, args),

    stopRun: (runKey: string): Promise<{ success: boolean; reason?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS_V2.RUN_STOP, runKey),

    // Run history
    listRunsByWorkflow: (workflowId: number) => ipcRenderer.invoke('v2:run:list-by-workflow', workflowId),
    listRunSteps: (runId: number): Promise<RunStepV2[]> => ipcRenderer.invoke('v2:run:list-steps', runId),

    // Realtime listeners
    onRunProgress: (callback: (payload: { runKey: string; step: RunStepV2 }) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { runKey: string; step: RunStepV2 }): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS_V2.RUN_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS_V2.RUN_PROGRESS, handler)
    },
    onRunLog: (callback: (payload: { runKey: string; nodeId: string; line: string }) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { runKey: string; nodeId: string; line: string }): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS_V2.RUN_LOG, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS_V2.RUN_LOG, handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
