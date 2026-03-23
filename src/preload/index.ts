import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, FlowData, ExecutionStep, ActionDefinition, FlatformAccount, Campaign, CampaignAction, CampaignDetail } from '../shared/types'

export type ElectronAPI = typeof electronAPI

const electronAPI = {
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

  // Multi-browser profiles
  launchProfile: (accountId: number, profileName: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LAUNCH, accountId, profileName),

  closeProfile: (accountId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_CLOSE, accountId),

  getProfileStatus: (accountId: number): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_STATUS, accountId),

  listProfiles: (): Promise<{ accountId: number; profileName: string; connected: boolean }[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LIST),

  focusProfile: (accountId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_FOCUS, accountId),

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
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
