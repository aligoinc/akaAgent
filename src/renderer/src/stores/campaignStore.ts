import { create } from 'zustand'
import { OrgChannel, Campaign, CampaignAction, CampaignDataInput, CampaignDataAction, CampaignResultAction } from '../../../shared/types'

interface CampaignStore {
  // Channels
  channels: OrgChannel[]
  loadingChannels: boolean
  loadChannels: () => Promise<void>
  createChannel: (data: Partial<OrgChannel>) => Promise<OrgChannel>
  updateChannel: (id: number, updates: Partial<OrgChannel>) => Promise<void>
  deleteChannel: (id: number) => Promise<void>

  // Campaign Actions
  campaignActions: CampaignAction[] // active only
  allCampaignActions: CampaignAction[] // all including inactive
  loadCampaignActions: () => Promise<void>
  loadAllCampaignActions: () => Promise<void>
  createCampaignAction: (data: Partial<CampaignAction>) => Promise<CampaignAction>
  updateCampaignAction: (id: string, updates: Partial<CampaignAction>) => Promise<void>
  deleteCampaignAction: (id: string) => Promise<void>

  // Campaigns
  campaigns: Campaign[]
  loadingCampaigns: boolean
  loadCampaigns: () => Promise<void>
  createCampaign: (data: Partial<Campaign>) => Promise<Campaign>
  updateCampaign: (id: number, updates: Partial<Campaign>) => Promise<void>
  deleteCampaign: (id: number) => Promise<void>
  cloneCampaign: (id: number) => Promise<Campaign>
  bulkUpdateCampaignStatus: (ids: number[], status: string) => Promise<void>
  bulkDeleteCampaigns: (ids: number[]) => Promise<void>
  upsertCampaign: (campaign: Campaign) => void

  // Selection
  selectedCampaignId: number | null
  setSelectedCampaignId: (id: number | null) => void

  // Campaign Data Inputs (pool nguyên liệu thô — e.g. groups → scrape members)
  dataInputs: CampaignDataInput[]
  loadingDataInputs: boolean
  loadDataInputs: (campaignId: number) => Promise<void>
  createDataInput: (data: Partial<CampaignDataInput>) => Promise<CampaignDataInput>
  updateDataInput: (id: number, updates: Partial<CampaignDataInput>) => Promise<void>
  deleteDataInput: (id: number) => Promise<void>

  // Campaign Data Actions (việc-cần-làm thực thi)
  dataActions: CampaignDataAction[]
  loadingDataActions: boolean
  loadDataActions: (campaignId: number) => Promise<void>
  createDataAction: (data: Partial<CampaignDataAction>) => Promise<CampaignDataAction>
  updateDataAction: (id: number, updates: Partial<CampaignDataAction>) => Promise<void>
  deleteDataAction: (id: number) => Promise<void>

  // Result Actions (per-milestone log) — status: 'thành công' | 'thất bại' | 'lỗi'
  resultActions: CampaignResultAction[]
  loadingResultActions: boolean
  loadResultActions: (campaignId: number) => Promise<void>

  // Logs
  logs: { timestamp: string; message: string }[]
  addLog: (log: { timestamp: string; message: string }) => void
  clearLogs: () => void

  // Scheduler
  schedulerRunning: boolean
  setSchedulerRunning: (running: boolean) => void
}

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  // =========== ACCOUNTS ===========
  channels: [],
  loadingChannels: false,

  loadChannels: async () => {
    if (!window.electronAPI) return
    set({ loadingChannels: true })
    try {
      const channels = await window.electronAPI.listChannels()
      set({ channels })
    } catch (err) {
      console.error('Failed to load channels:', err)
    } finally {
      set({ loadingChannels: false })
    }
  },

  createChannel: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const channel = await window.electronAPI.createChannel(data)
    await get().loadChannels()
    return channel
  },

  updateChannel: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateChannel(id, updates)
    await get().loadChannels()
  },

  deleteChannel: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteChannel(id)
    await get().loadChannels()
  },

  // =========== CAMPAIGN ACTIONS ===========
  campaignActions: [],
  allCampaignActions: [],

  loadCampaignActions: async () => {
    if (!window.electronAPI) return
    try {
      const actions = await window.electronAPI.listCampaignActions()
      set({ campaignActions: actions })
    } catch (err) {
      console.error('Failed to load campaign actions:', err)
    }
  },

  loadAllCampaignActions: async () => {
    if (!window.electronAPI) return
    try {
      const actions = await window.electronAPI.getAllCampaignActions()
      set({ allCampaignActions: actions })
    } catch (err) {
      console.error('Failed to load all campaign actions:', err)
    }
  },

  createCampaignAction: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const action = await window.electronAPI.createCampaignAction(data)
    await get().loadAllCampaignActions()
    await get().loadCampaignActions()
    return action
  },

  updateCampaignAction: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateCampaignAction(id, updates)
    await get().loadAllCampaignActions()
    await get().loadCampaignActions()
  },

  deleteCampaignAction: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteCampaignAction(id)
    await get().loadAllCampaignActions()
    await get().loadCampaignActions()
  },

  // =========== CAMPAIGNS ===========
  campaigns: [],
  loadingCampaigns: false,

  loadCampaigns: async () => {
    if (!window.electronAPI) return
    set({ loadingCampaigns: true })
    try {
      const campaigns = await window.electronAPI.listCampaigns()
      set({ campaigns })
    } catch (err) {
      console.error('Failed to load campaigns:', err)
    } finally {
      set({ loadingCampaigns: false })
    }
  },

  createCampaign: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const campaign = await window.electronAPI.createCampaign(data)
    await get().loadCampaigns()
    return campaign
  },

  updateCampaign: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateCampaign(id, updates)
    await get().loadCampaigns()
  },

  deleteCampaign: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteCampaign(id)
    await get().loadCampaigns()
  },

  cloneCampaign: async (id) => {
    if (!window.electronAPI) throw new Error('API not available')
    const cloned = await window.electronAPI.cloneCampaign(id)
    await get().loadCampaigns()
    return cloned
  },

  bulkUpdateCampaignStatus: async (ids, status) => {
    if (!window.electronAPI || ids.length === 0) return
    const api = window.electronAPI
    await Promise.all(ids.map(id => api.updateCampaign(id, { status })))
    await get().loadCampaigns()
  },

  bulkDeleteCampaigns: async (ids) => {
    if (!window.electronAPI || ids.length === 0) return
    const api = window.electronAPI
    await Promise.all(ids.map(id => api.deleteCampaign(id)))
    await get().loadCampaigns()
  },

  upsertCampaign: (campaign) => {
    set(state => {
      const idx = state.campaigns.findIndex(c => c.id === campaign.id)
      if (idx === -1) return { campaigns: [campaign, ...state.campaigns] }
      const next = state.campaigns.slice()
      next[idx] = { ...next[idx], ...campaign }
      return { campaigns: next }
    })
  },

  // =========== SELECTION ===========
  selectedCampaignId: null,

  setSelectedCampaignId: (id) => {
    set({ selectedCampaignId: id })
    if (id) get().loadDataActions(id)
  },

  // =========== CAMPAIGN DATA INPUTS ===========
  dataInputs: [],
  loadingDataInputs: false,

  loadDataInputs: async (campaignId) => {
    if (!window.electronAPI) return
    set({ loadingDataInputs: true })
    try {
      const inputs = await window.electronAPI.listCampaignDataInputs(campaignId)
      set({ dataInputs: inputs })
    } catch (err) {
      console.error('Failed to load campaign data inputs:', err)
    } finally {
      set({ loadingDataInputs: false })
    }
  },

  createDataInput: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const input = await window.electronAPI.createCampaignDataInput(data)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadDataInputs(selectedCampaignId)
    return input
  },

  updateDataInput: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateCampaignDataInput(id, updates)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadDataInputs(selectedCampaignId)
  },

  deleteDataInput: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteCampaignDataInput(id)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadDataInputs(selectedCampaignId)
  },

  // =========== CAMPAIGN DATA ACTIONS ===========
  dataActions: [],
  loadingDataActions: false,

  loadDataActions: async (campaignId) => {
    if (!window.electronAPI) return
    set({ loadingDataActions: true })
    try {
      const actions = await window.electronAPI.listCampaignDataActions(campaignId)
      set({ dataActions: actions })
    } catch (err) {
      console.error('Failed to load campaign data actions:', err)
    } finally {
      set({ loadingDataActions: false })
    }
  },

  createDataAction: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const action = await window.electronAPI.createCampaignDataAction(data)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadDataActions(selectedCampaignId)
    return action
  },

  updateDataAction: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateCampaignDataAction(id, updates)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadDataActions(selectedCampaignId)
  },

  deleteDataAction: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteCampaignDataAction(id)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadDataActions(selectedCampaignId)
  },

  // =========== RESULT ACTIONS ===========
  resultActions: [],
  loadingResultActions: false,

  loadResultActions: async (campaignId) => {
    if (!window.electronAPI) return
    set({ loadingResultActions: true })
    try {
      const actions = await window.electronAPI.listResultActionsByCampaign(campaignId)
      set({ resultActions: actions })
    } catch (err) {
      console.error('Failed to load result actions:', err)
    } finally {
      set({ loadingResultActions: false })
    }
  },

  // =========== LOGS ===========
  logs: [],

  addLog: (log) => {
    set(state => ({
      logs: [...state.logs, log].slice(-500) // Keep last 500 logs
    }))
  },

  clearLogs: () => set({ logs: [] }),

  // =========== SCHEDULER ===========
  schedulerRunning: false,
  setSchedulerRunning: (running) => set({ schedulerRunning: running }),
}))
