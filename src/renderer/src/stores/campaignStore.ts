import { create } from 'zustand'
import { AddCampaignInputDataToCampaignRequest, AddCampaignInputDataToCampaignResult, AutoAccount, AutoAccountGroup, AutoProxy, BulkUpdateCampaignInputDataStatusResult, Campaign, CampaignAction, CampaignInput, CampaignInputData, CampaignInputStatus, CampaignDetail, CampaignRelationSummary, CampaignRunEvent, CampaignRunEventListOptions, CampaignLogEntry, EmailCampaignLinkTrackingSummary } from '../../../shared/types'

interface CampaignStore {
  // Accounts
  accounts: AutoAccount[]
  loadingAccounts: boolean
  loadAccounts: () => Promise<void>
  createAccount: (data: Partial<AutoAccount>) => Promise<AutoAccount>
  updateAccount: (id: number, updates: Partial<AutoAccount>) => Promise<AutoAccount>
  deleteAccount: (id: number) => Promise<void>
  accountGroups: AutoAccountGroup[]
  loadingAccountGroups: boolean
  loadAccountGroups: (flatformType?: string) => Promise<void>
  createAccountGroup: (data: Partial<AutoAccountGroup>) => Promise<AutoAccountGroup>
  updateAccountGroup: (id: number, updates: Partial<AutoAccountGroup>) => Promise<void>
  deleteAccountGroup: (id: number) => Promise<void>
  proxies: AutoProxy[]
  loadingProxies: boolean
  loadProxies: () => Promise<void>
  createProxy: (data: Partial<AutoProxy>) => Promise<AutoProxy>
  updateProxy: (id: number, updates: Partial<AutoProxy>) => Promise<void>
  deleteProxy: (id: number) => Promise<void>

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

  // Campaign Inputs (pool nguyên liệu thô — e.g. groups → scrape members)
  campaignInputs: CampaignInput[]
  loadingCampaignInputs: boolean
  loadCampaignInputs: (campaignId: number) => Promise<void>
  createCampaignInput: (data: Partial<CampaignInput>) => Promise<CampaignInput>
  updateCampaignInput: (id: number, updates: Partial<CampaignInput>) => Promise<void>
  deleteCampaignInput: (id: number) => Promise<void>

  // Campaign Input Data (việc-cần-làm thực thi)
  campaignInputData: CampaignInputData[]
  loadingCampaignInputData: boolean
  loadCampaignInputData: (campaignId: number) => Promise<void>
  createCampaignInputData: (data: Partial<CampaignInputData>) => Promise<CampaignInputData>
  updateCampaignInputData: (id: number, updates: Partial<CampaignInputData>) => Promise<void>
  bulkUpdateCampaignInputDataStatus: (campaignId: number, ids: number[], status: Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>) => Promise<BulkUpdateCampaignInputDataStatusResult>
  addCampaignInputDataToCampaign: (request: AddCampaignInputDataToCampaignRequest) => Promise<AddCampaignInputDataToCampaignResult>
  deleteCampaignInputData: (id: number) => Promise<void>

  // Campaign Details (per-milestone log) — status: 'thành công' | 'thất bại' | 'lỗi'
  campaignDetails: CampaignDetail[]
  loadingCampaignDetails: boolean
  loadCampaignDetails: (campaignId: number) => Promise<void>

  // Email campaign link tracking
  emailCampaignLinkTrackings: EmailCampaignLinkTrackingSummary[]
  emailCampaignLinkTrackingCampaignId: number | null
  loadingEmailCampaignLinkTrackings: boolean
  loadEmailCampaignLinkTrackings: (campaignId: number) => Promise<void>

  // Campaign run events (fine-grained workflow log)
  campaignRunEvents: CampaignRunEvent[]
  loadingCampaignRunEvents: boolean
  loadCampaignRunEvents: (campaignId: number, options?: CampaignRunEventListOptions) => Promise<void>

  // Linked campaign summaries for find-data source/target tabs
  campaignRelationSummaries: CampaignRelationSummary[]
  loadingCampaignRelationSummaries: boolean
  loadCampaignRelationSummaries: (campaignIds: number[]) => Promise<void>

  // Logs
  logs: CampaignLogEntry[]
  addLog: (log: CampaignLogEntry) => void
  clearLogs: () => void

}

const getCampaignUpdatedAtTime = (campaign: Campaign): number | null => {
  const time = Date.parse(campaign.updatedAt || '')
  return Number.isFinite(time) ? time : null
}

const isIncomingCampaignOlder = (existing: Campaign, incoming: Campaign): boolean => {
  const existingTime = getCampaignUpdatedAtTime(existing)
  const incomingTime = getCampaignUpdatedAtTime(incoming)
  if (existingTime === null || incomingTime === null) return false
  if (incomingTime !== existingTime) return incomingTime < existingTime

  const existingStamp = existing.updatedAt || ''
  const incomingStamp = incoming.updatedAt || ''
  return !!existingStamp && !!incomingStamp && incomingStamp < existingStamp
}

const mergeCampaignPreservingNewest = (existing: Campaign | undefined, incoming: Campaign): Campaign => {
  if (!existing) return incoming
  if (isIncomingCampaignOlder(existing, incoming)) return existing
  return { ...existing, ...incoming }
}

const mergeLoadedCampaignsPreservingNewest = (current: Campaign[], loaded: Campaign[]): Campaign[] => {
  const currentById = new Map(current.map(campaign => [campaign.id, campaign]))
  return loaded.map(campaign => mergeCampaignPreservingNewest(currentById.get(campaign.id), campaign))
}

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  // =========== ACCOUNTS ===========
  accounts: [],
  loadingAccounts: false,
  accountGroups: [],
  loadingAccountGroups: false,
  proxies: [],
  loadingProxies: false,

  loadAccounts: async () => {
    if (!window.electronAPI) return
    set({ loadingAccounts: true })
    try {
      const accounts = await window.electronAPI.listAccounts()
      set({ accounts })
    } catch (err) {
      console.error('Failed to load accounts:', err)
    } finally {
      set({ loadingAccounts: false })
    }
  },

  createAccount: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const account = await window.electronAPI.createAccount(data)
    await get().loadAccounts()
    return account
  },

  updateAccount: async (id, updates) => {
    if (!window.electronAPI) throw new Error('API not available')
    const account = await window.electronAPI.updateAccount(id, updates)
    await get().loadAccounts()
    return account
  },

  deleteAccount: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteAccount(id)
    await get().loadAccounts()
  },

  loadAccountGroups: async (flatformType) => {
    if (!window.electronAPI) return
    set({ loadingAccountGroups: true })
    try {
      const accountGroups = await window.electronAPI.listAccountGroups(flatformType)
      set({ accountGroups })
    } catch (err) {
      console.error('Failed to load account groups:', err)
    } finally {
      set({ loadingAccountGroups: false })
    }
  },

  createAccountGroup: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const group = await window.electronAPI.createAccountGroup(data)
    await get().loadAccountGroups()
    return group
  },

  updateAccountGroup: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateAccountGroup(id, updates)
    await get().loadAccountGroups()
    await get().loadAccounts()
  },

  deleteAccountGroup: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteAccountGroup(id)
    await get().loadAccountGroups()
    await get().loadAccounts()
  },

  loadProxies: async () => {
    if (!window.electronAPI) return
    set({ loadingProxies: true })
    try {
      const proxies = await window.electronAPI.listProxies()
      set({ proxies })
    } catch (err) {
      console.error('Failed to load proxies:', err)
    } finally {
      set({ loadingProxies: false })
    }
  },

  createProxy: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const proxy = await window.electronAPI.createProxy(data)
    await get().loadProxies()
    return proxy
  },

  updateProxy: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateProxy(id, updates)
    await get().loadProxies()
    await get().loadAccounts()
  },

  deleteProxy: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteProxy(id)
    await get().loadProxies()
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
      set(state => ({ campaigns: mergeLoadedCampaignsPreservingNewest(state.campaigns, campaigns) }))
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
      next[idx] = mergeCampaignPreservingNewest(next[idx], campaign)
      return { campaigns: next }
    })
  },

  // =========== SELECTION ===========
  selectedCampaignId: null,

  setSelectedCampaignId: (id) => {
    set({ selectedCampaignId: id })
    if (id) get().loadCampaignInputData(id)
  },

  // =========== CAMPAIGN INPUTS ===========
  campaignInputs: [],
  loadingCampaignInputs: false,

  loadCampaignInputs: async (campaignId) => {
    if (!window.electronAPI) return
    set({ loadingCampaignInputs: true })
    try {
      const inputs = await window.electronAPI.listCampaignInputs(campaignId)
      set({ campaignInputs: inputs })
    } catch (err) {
      console.error('Failed to load campaign inputs:', err)
    } finally {
      set({ loadingCampaignInputs: false })
    }
  },

  createCampaignInput: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const input = await window.electronAPI.createCampaignInput(data)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignInputs(selectedCampaignId)
    return input
  },

  updateCampaignInput: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateCampaignInput(id, updates)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignInputs(selectedCampaignId)
  },

  deleteCampaignInput: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteCampaignInput(id)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignInputs(selectedCampaignId)
  },

  // =========== CAMPAIGN INPUT DATA ===========
  campaignInputData: [],
  loadingCampaignInputData: false,

  loadCampaignInputData: async (campaignId) => {
    if (!window.electronAPI) return
    set({ loadingCampaignInputData: true })
    try {
      const actions = await window.electronAPI.listCampaignInputData(campaignId)
      set({ campaignInputData: actions })
    } catch (err) {
      console.error('Failed to load campaign input data:', err)
    } finally {
      set({ loadingCampaignInputData: false })
    }
  },

  createCampaignInputData: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const action = await window.electronAPI.createCampaignInputData(data)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignInputData(selectedCampaignId)
    return action
  },

  updateCampaignInputData: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateCampaignInputData(id, updates)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignInputData(selectedCampaignId)
  },

  bulkUpdateCampaignInputDataStatus: async (campaignId, ids, status) => {
    if (!window.electronAPI) throw new Error('API not available')
    const result = await window.electronAPI.bulkUpdateCampaignInputDataStatus(campaignId, ids, status)
    await get().loadCampaignInputData(campaignId)
    return result
  },

  addCampaignInputDataToCampaign: async (request) => {
    if (!window.electronAPI) throw new Error('API not available')
    const result = await window.electronAPI.addCampaignInputDataToCampaign(request)
    await get().loadCampaigns()
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignInputData(selectedCampaignId)
    return result
  },

  deleteCampaignInputData: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteCampaignInputData(id)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) await get().loadCampaignInputData(selectedCampaignId)
  },

  // =========== CAMPAIGN DETAILS ===========
  campaignDetails: [],
  loadingCampaignDetails: false,

  loadCampaignDetails: async (campaignId) => {
    if (!window.electronAPI) return
    set({ loadingCampaignDetails: true })
    try {
      const actions = await window.electronAPI.listCampaignDetailsByCampaign(campaignId)
      set({ campaignDetails: actions })
    } catch (err) {
      console.error('Failed to load campaign details:', err)
    } finally {
      set({ loadingCampaignDetails: false })
    }
  },

  // =========== EMAIL CAMPAIGN LINK TRACKINGS ===========
  emailCampaignLinkTrackings: [],
  emailCampaignLinkTrackingCampaignId: null,
  loadingEmailCampaignLinkTrackings: false,

  loadEmailCampaignLinkTrackings: async (campaignId) => {
    if (!window.electronAPI) return
    set({
      emailCampaignLinkTrackings: [],
      emailCampaignLinkTrackingCampaignId: campaignId,
      loadingEmailCampaignLinkTrackings: true
    })
    try {
      const links = await window.electronAPI.listEmailCampaignLinkTrackings(campaignId)
      if (get().emailCampaignLinkTrackingCampaignId === campaignId) {
        set({ emailCampaignLinkTrackings: links })
      }
    } catch (err) {
      console.error('Failed to load email campaign link trackings:', err)
    } finally {
      if (get().emailCampaignLinkTrackingCampaignId === campaignId) {
        set({ loadingEmailCampaignLinkTrackings: false })
      }
    }
  },

  // =========== CAMPAIGN RUN EVENTS ===========
  campaignRunEvents: [],
  loadingCampaignRunEvents: false,

  loadCampaignRunEvents: async (campaignId, options) => {
    if (!window.electronAPI) return
    set({ loadingCampaignRunEvents: true })
    try {
      const events = await window.electronAPI.listCampaignRunEventsByCampaign(campaignId, options)
      set({ campaignRunEvents: events })
    } catch (err) {
      console.error('Failed to load campaign run events:', err)
    } finally {
      set({ loadingCampaignRunEvents: false })
    }
  },

  // =========== LINKED CAMPAIGN SUMMARIES ===========
  campaignRelationSummaries: [],
  loadingCampaignRelationSummaries: false,

  loadCampaignRelationSummaries: async (campaignIds) => {
    if (!window.electronAPI) return
    const ids = Array.from(new Set(campaignIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)))
    if (ids.length === 0) {
      set({ campaignRelationSummaries: [], loadingCampaignRelationSummaries: false })
      return
    }

    set({ loadingCampaignRelationSummaries: true })
    try {
      const summaries = await window.electronAPI.listCampaignRelationSummaries(ids)
      set({ campaignRelationSummaries: summaries })
    } catch (err) {
      console.error('Failed to load campaign relation summaries:', err)
      set({ campaignRelationSummaries: [] })
    } finally {
      set({ loadingCampaignRelationSummaries: false })
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
}))
