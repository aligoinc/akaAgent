import { create } from 'zustand'
import { AddCampaignInputDataRowsRequest, AddCampaignInputDataRowsResult, AddCampaignInputDataToCampaignRequest, AddCampaignInputDataToCampaignResult, AutoAccount, AutoAccountGroup, AutoProxy, BulkUpdateCampaignInputDataStatusResult, Campaign, CampaignAction, CampaignInput, CampaignInputData, CampaignInputDataPageQuery, CampaignInputStatus, CampaignDetail, CampaignDetailPageQuery, CampaignRelationSummary, CampaignRunEvent, CampaignRunEventListOptions, CampaignLogEntry, EmailCampaignLinkTrackingSummary } from '../../../shared/types'

interface CampaignStore {
  // Accounts
  accounts: AutoAccount[]
  loadingAccounts: boolean
  loadAccounts: (options?: { silent?: boolean }) => Promise<void>
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
  loadCampaigns: (options?: { silent?: boolean }) => Promise<void>
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
  campaignInputDataTotal: number
  loadingCampaignInputData: boolean
  loadCampaignInputData: (campaignId: number, query?: Omit<CampaignInputDataPageQuery, 'campaignId'>) => Promise<void>
  refreshCampaignInputData: (campaignId: number) => Promise<void>
  createCampaignInputData: (data: Partial<CampaignInputData>) => Promise<CampaignInputData>
  updateCampaignInputData: (id: number, updates: Partial<CampaignInputData>) => Promise<void>
  bulkUpdateCampaignInputDataStatus: (campaignId: number, ids: number[], status: Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>) => Promise<BulkUpdateCampaignInputDataStatusResult>
  addCampaignInputDataToCampaign: (request: AddCampaignInputDataToCampaignRequest) => Promise<AddCampaignInputDataToCampaignResult>
  addCampaignInputDataRows: (request: AddCampaignInputDataRowsRequest) => Promise<AddCampaignInputDataRowsResult>
  deleteCampaignInputData: (id: number) => Promise<void>

  // Campaign Details (per-milestone log) — status: 'thành công' | 'thất bại' | 'lỗi'
  campaignDetails: CampaignDetail[]
  loadingCampaignDetails: boolean
  loadCampaignDetails: (campaignId: number) => Promise<void>
  campaignDetailPageItems: CampaignDetail[]
  campaignDetailPageTotal: number
  loadingCampaignDetailPage: boolean
  loadCampaignDetailPage: (campaignId: number, query?: Omit<CampaignDetailPageQuery, 'campaignId'>) => Promise<void>

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

const BULK_CAMPAIGN_STATUS_CONCURRENCY = 10

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

const mergeLoadedAccountsPreservingNewest = (current: AutoAccount[], loaded: AutoAccount[]): AutoAccount[] => {
  const currentById = new Map(current.map(account => [account.id, account]))
  return loaded.map(account => {
    const existing = currentById.get(account.id)
    if (!existing) return account
    const existingTime = Date.parse(existing.updatedAt || '')
    const incomingTime = Date.parse(account.updatedAt || '')
    return Number.isFinite(existingTime) && Number.isFinite(incomingTime) && incomingTime < existingTime
      ? existing
      : account
  })
}

let accountsLoadInFlight: Promise<void> | null = null
let accountsLoadTrailingRequested = false
let campaignsLoadInFlight: Promise<void> | null = null
let campaignsLoadTrailingRequested = false
let campaignDetailPageRequestVersion = 0
let campaignInputDataRequestVersion = 0
let activeCampaignInputDataQuery: CampaignInputDataPageQuery | null = null

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  // =========== ACCOUNTS ===========
  accounts: [],
  loadingAccounts: false,
  accountGroups: [],
  loadingAccountGroups: false,
  proxies: [],
  loadingProxies: false,

  loadAccounts: (options) => {
    if (!window.electronAPI) return Promise.resolve()
    if (accountsLoadInFlight) {
      accountsLoadTrailingRequested = true
      return accountsLoadInFlight
    }
    const silent = options?.silent === true
    if (!silent) set({ loadingAccounts: true })
    const operation = (async () => {
      let firstRequest = true
      do {
        accountsLoadTrailingRequested = false
        try {
          const accounts = await window.electronAPI.listAccounts()
          set(state => ({ accounts: mergeLoadedAccountsPreservingNewest(state.accounts, accounts) }))
        } catch (err) {
          console.error('Failed to load accounts:', err)
        } finally {
          if (firstRequest && !silent) set({ loadingAccounts: false })
          firstRequest = false
        }
      } while (accountsLoadTrailingRequested)
    })()
    accountsLoadInFlight = operation
    void operation.finally(() => {
      if (accountsLoadInFlight === operation) accountsLoadInFlight = null
    })
    return operation
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
    set(state => {
      const index = state.accounts.findIndex(item => item.id === account.id)
      if (index < 0) return { accounts: [account, ...state.accounts] }
      const accounts = state.accounts.slice()
      accounts[index] = account
      return { accounts }
    })
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

  loadCampaigns: (options) => {
    if (!window.electronAPI) return Promise.resolve()
    if (campaignsLoadInFlight) {
      campaignsLoadTrailingRequested = true
      return campaignsLoadInFlight
    }
    const silent = options?.silent === true
    if (!silent) set({ loadingCampaigns: true })
    const operation = (async () => {
      let firstRequest = true
      do {
        campaignsLoadTrailingRequested = false
        try {
          const campaigns = await window.electronAPI.listCampaigns()
          set(state => ({ campaigns: mergeLoadedCampaignsPreservingNewest(state.campaigns, campaigns) }))
        } catch (err) {
          console.error('Failed to load campaigns:', err)
        } finally {
          if (firstRequest && !silent) set({ loadingCampaigns: false })
          firstRequest = false
        }
      } while (campaignsLoadTrailingRequested)
    })()
    campaignsLoadInFlight = operation
    void operation.finally(() => {
      if (campaignsLoadInFlight === operation) campaignsLoadInFlight = null
    })
    return operation
  },

  createCampaign: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const campaign = await window.electronAPI.createCampaign(data)
    await get().loadCampaigns()
    return campaign
  },

  updateCampaign: async (id, updates) => {
    if (!window.electronAPI) return
    const campaign = await window.electronAPI.updateCampaign(id, updates)
    set(state => {
      const index = state.campaigns.findIndex(item => item.id === campaign.id)
      if (index < 0) return { campaigns: [campaign, ...state.campaigns] }
      const campaigns = state.campaigns.slice()
      campaigns[index] = mergeCampaignPreservingNewest(campaigns[index], campaign)
      return { campaigns }
    })
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
    const results: PromiseSettledResult<Campaign>[] = []
    for (let offset = 0; offset < ids.length; offset += BULK_CAMPAIGN_STATUS_CONCURRENCY) {
      const batch = ids.slice(offset, offset + BULK_CAMPAIGN_STATUS_CONCURRENCY)
      results.push(...await Promise.allSettled(
        batch.map(id => api.updateCampaign(id, { status }))
      ))
    }
    const updatedCampaigns = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    const updatedById = new Map(updatedCampaigns.map(campaign => [campaign.id, campaign]))
    set(state => ({
      campaigns: state.campaigns.map(campaign => {
        const updated = updatedById.get(campaign.id)
        return updated ? mergeCampaignPreservingNewest(campaign, updated) : campaign
      })
    }))
    await get().loadCampaigns({ silent: true })
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed.length > 0) {
      const firstReason = failed[0].reason
      const firstMessage = firstReason instanceof Error ? firstReason.message : ''
      throw new Error(
        failed.length === 1 && firstMessage
          ? firstMessage
          : `Không thể cập nhật ${failed.length}/${ids.length} chiến dịch.`
      )
    }
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
  campaignInputDataTotal: 0,
  loadingCampaignInputData: false,

  loadCampaignInputData: async (campaignId, query = {}) => {
    if (!window.electronAPI) return
    const requestVersion = ++campaignInputDataRequestVersion
    const resolvedQuery: CampaignInputDataPageQuery = {
      campaignId,
      offset: 0,
      limit: 100,
      ...query
    }
    activeCampaignInputDataQuery = resolvedQuery
    set({ loadingCampaignInputData: true })
    try {
      const page = await window.electronAPI.listCampaignInputDataPage(resolvedQuery)
      if (requestVersion === campaignInputDataRequestVersion) {
        set({ campaignInputData: page.items, campaignInputDataTotal: page.total })
      }
    } catch (err) {
      console.error('Failed to load campaign input data:', err)
      if (requestVersion === campaignInputDataRequestVersion) {
        set({ campaignInputData: [], campaignInputDataTotal: 0 })
      }
    } finally {
      if (requestVersion === campaignInputDataRequestVersion) {
        set({ loadingCampaignInputData: false })
      }
    }
  },

  refreshCampaignInputData: async (campaignId) => {
    const activeQuery = activeCampaignInputDataQuery
    const { campaignId: _campaignId, ...query } = activeQuery?.campaignId === campaignId
      ? activeQuery
      : { campaignId }
    await get().loadCampaignInputData(campaignId, query)
  },

  createCampaignInputData: async (data) => {
    if (!window.electronAPI) throw new Error('API not available')
    const action = await window.electronAPI.createCampaignInputData(data)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) {
      const activeQuery = activeCampaignInputDataQuery
      const { campaignId: _campaignId, ...query } = activeQuery?.campaignId === selectedCampaignId
        ? activeQuery
        : { campaignId: selectedCampaignId }
      await get().loadCampaignInputData(selectedCampaignId, query)
    }
    return action
  },

  updateCampaignInputData: async (id, updates) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateCampaignInputData(id, updates)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) {
      const activeQuery = activeCampaignInputDataQuery
      const { campaignId: _campaignId, ...query } = activeQuery?.campaignId === selectedCampaignId
        ? activeQuery
        : { campaignId: selectedCampaignId }
      await get().loadCampaignInputData(selectedCampaignId, query)
    }
  },

  bulkUpdateCampaignInputDataStatus: async (campaignId, ids, status) => {
    if (!window.electronAPI) throw new Error('API not available')
    const result = await window.electronAPI.bulkUpdateCampaignInputDataStatus(campaignId, ids, status)
    const activeQuery = activeCampaignInputDataQuery
    const { campaignId: _campaignId, ...query } = activeQuery?.campaignId === campaignId
      ? activeQuery
      : { campaignId }
    await get().loadCampaignInputData(campaignId, query)
    return result
  },

  addCampaignInputDataToCampaign: async (request) => {
    if (!window.electronAPI) throw new Error('API not available')
    const result = await window.electronAPI.addCampaignInputDataToCampaign(request)
    await get().loadCampaigns()
    const { selectedCampaignId } = get()
    if (selectedCampaignId) {
      const activeQuery = activeCampaignInputDataQuery
      const { campaignId: _campaignId, ...query } = activeQuery?.campaignId === selectedCampaignId
        ? activeQuery
        : { campaignId: selectedCampaignId }
      await get().loadCampaignInputData(selectedCampaignId, query)
    }
    return result
  },

  addCampaignInputDataRows: async (request) => {
    if (!window.electronAPI) throw new Error('API not available')
    const result = await window.electronAPI.addCampaignInputDataRows(request)
    await get().loadCampaigns()
    const { selectedCampaignId } = get()
    if (selectedCampaignId) {
      const activeQuery = activeCampaignInputDataQuery
      const { campaignId: _campaignId, ...query } = activeQuery?.campaignId === selectedCampaignId
        ? activeQuery
        : { campaignId: selectedCampaignId }
      await get().loadCampaignInputData(selectedCampaignId, query)
    }
    return result
  },

  deleteCampaignInputData: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteCampaignInputData(id)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) {
      const activeQuery = activeCampaignInputDataQuery
      const { campaignId: _campaignId, ...query } = activeQuery?.campaignId === selectedCampaignId
        ? activeQuery
        : { campaignId: selectedCampaignId }
      await get().loadCampaignInputData(selectedCampaignId, query)
    }
  },

  // =========== CAMPAIGN DETAILS ===========
  campaignDetails: [],
  loadingCampaignDetails: false,
  campaignDetailPageItems: [],
  campaignDetailPageTotal: 0,
  loadingCampaignDetailPage: false,

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

  loadCampaignDetailPage: async (campaignId, query = {}) => {
    if (!window.electronAPI) return
    const requestVersion = ++campaignDetailPageRequestVersion
    set({ loadingCampaignDetailPage: true })
    try {
      const page = await window.electronAPI.listCampaignDetailsPage({
        campaignId,
        offset: 0,
        limit: 100,
        ...query
      })
      if (requestVersion === campaignDetailPageRequestVersion) {
        set({ campaignDetailPageItems: page.items, campaignDetailPageTotal: page.total })
      }
    } catch (err) {
      console.error('Failed to load campaign detail page:', err)
      if (requestVersion === campaignDetailPageRequestVersion) {
        set({ campaignDetailPageItems: [], campaignDetailPageTotal: 0 })
      }
    } finally {
      if (requestVersion === campaignDetailPageRequestVersion) {
        set({ loadingCampaignDetailPage: false })
      }
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
