import { create } from 'zustand'
import { OrgChannel, Campaign, CampaignAction, CampaignDetail, CampaignDetailAction } from '../../../shared/types'

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

  // Campaign Details
  campaignDetails: CampaignDetail[]
  loadingDetails: boolean
  selectedCampaignId: number | null
  setSelectedCampaignId: (id: number | null) => void
  loadCampaignDetails: (campaignId: number) => Promise<void>
  createCampaignDetail: (data: Partial<CampaignDetail>) => Promise<CampaignDetail>
  updateCampaignDetail: (id: number, updates: Partial<CampaignDetail>) => Promise<void>
  deleteCampaignDetail: (id: number) => Promise<void>

  // Detail Actions (action logs)
  detailActions: CampaignDetailAction[]
  loadingDetailActions: boolean
  loadDetailActionsByCampaign: (campaignId: number) => Promise<void>

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

  // =========== CAMPAIGN DETAILS ===========
  campaignDetails: [],
  loadingDetails: false,
  selectedCampaignId: null,

  setSelectedCampaignId: (id) => {
    set({ selectedCampaignId: id })
    if (id) get().loadCampaignDetails(id)
  },

  loadCampaignDetails: async (campaignId) => {
    if (!window.electronAPI) return
    set({ loadingDetails: true })
    try {
      const details = await window.electronAPI.listCampaignDetails(campaignId)
      set({ campaignDetails: details })
    } catch (err) {
      console.error('Failed to load campaign details:', err)
    } finally {
      set({ loadingDetails: false })
    }
  },

  createCampaignDetail: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const detail = await window.electronAPI.createCampaignDetail(data)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignDetails(selectedCampaignId)
    return detail
  },

  updateCampaignDetail: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateCampaignDetail(id, updates)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignDetails(selectedCampaignId)
  },

  deleteCampaignDetail: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteCampaignDetail(id)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignDetails(selectedCampaignId)
  },

  // =========== DETAIL ACTIONS ===========
  detailActions: [],
  loadingDetailActions: false,

  loadDetailActionsByCampaign: async (campaignId) => {
    if (!window.electronAPI) return
    set({ loadingDetailActions: true })
    try {
      const actions = await window.electronAPI.listDetailActionsByCampaign(campaignId)
      set({ detailActions: actions })
    } catch (err) {
      console.error('Failed to load detail actions:', err)
    } finally {
      set({ loadingDetailActions: false })
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
