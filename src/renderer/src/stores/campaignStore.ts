import { create } from 'zustand'
import { AddCampaignInputDataRowsRequest, AddCampaignInputDataRowsResult, AddCampaignInputDataToCampaignRequest, AddCampaignInputDataToCampaignResult, AutoAccount, AutoAccountGroup, AutoProxy, BulkDeleteCampaignInputDataResult, BulkUpdateCampaignInputDataStatusResult, Campaign, CampaignAction, CampaignConfig, CampaignUpdate, CampaignInput, CampaignInputData, CampaignInputDataPageQuery, CampaignInputStatus, CampaignDetail, CampaignDetailPageQuery, CampaignListItem, CampaignLogSnapshot, CampaignRelationSummary, CampaignRunEvent, CampaignRunEventListOptions, CampaignLogEntry, CampaignSummaryRefreshSignal, EmailCampaignLinkTrackingSummary } from '../../../shared/types'
import { useAuthStore } from './authStore'

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
  campaigns: CampaignListItem[]
  loadingCampaigns: boolean
  loadCampaigns: (options?: { silent?: boolean }) => Promise<void>
  campaignConfigs: Record<number, CampaignConfig>
  campaignLogs: Record<number, CampaignLogSnapshot>
  loadingCampaignConfigIds: Record<number, true>
  loadingCampaignLogIds: Record<number, true>
  loadCampaignConfig: (id: number, options?: { force?: boolean }) => Promise<CampaignConfig | null>
  loadCampaignLog: (id: number, options?: { force?: boolean }) => Promise<CampaignLogSnapshot | null>
  createCampaign: (data: Partial<Campaign>, options?: { refresh?: boolean }) => Promise<Campaign>
  updateCampaign: (id: number, updates: CampaignUpdate, options?: { refresh?: boolean }) => Promise<void>
  deleteCampaign: (id: number) => Promise<void>
  cloneCampaign: (id: number) => Promise<Campaign>
  bulkUpdateCampaignStatus: (ids: number[], status: string) => Promise<void>
  bulkDeleteCampaigns: (ids: number[]) => Promise<void>
  upsertCampaign: (signal: CampaignSummaryRefreshSignal) => void
  resetCampaignSession: () => void

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
  createCampaignInputDataBatch: (
    actions: Partial<CampaignInputData>[],
    progressRequestId?: string
  ) => Promise<number>
  updateCampaignInputData: (id: number, updates: Partial<CampaignInputData>) => Promise<void>
  bulkUpdateCampaignInputDataStatus: (campaignId: number, ids: number[], status: Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>) => Promise<BulkUpdateCampaignInputDataStatusResult>
  addCampaignInputDataToCampaign: (request: AddCampaignInputDataToCampaignRequest) => Promise<AddCampaignInputDataToCampaignResult>
  addCampaignInputDataRows: (request: AddCampaignInputDataRowsRequest) => Promise<AddCampaignInputDataRowsResult>
  deleteCampaignInputData: (id: number) => Promise<void>
  deleteCampaignInputDataBatch: (ids: number[]) => Promise<BulkDeleteCampaignInputDataResult>

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
const CAMPAIGN_CONFIG_CACHE_LIMIT = 12
const CAMPAIGN_LOG_CACHE_LIMIT = 3

const pruneCampaignSnapshotCache = <T>(cache: Record<number, T>, keepId: number, limit: number): void => {
  let excess = Object.keys(cache).length - limit
  if (excess <= 0) return
  for (const idText of Object.keys(cache)) {
    const id = Number(idText)
    if (id === keepId) continue
    delete cache[id]
    excess -= 1
    if (excess <= 0) return
  }
}

const getCampaignUpdatedAtTime = (campaign: Pick<CampaignListItem, 'updatedAt'>): number | null => {
  const time = Date.parse(campaign.updatedAt || '')
  return Number.isFinite(time) ? time : null
}

const isIncomingCampaignOlder = (existing: CampaignListItem, incoming: CampaignListItem): boolean => {
  const existingTime = getCampaignUpdatedAtTime(existing)
  const incomingTime = getCampaignUpdatedAtTime(incoming)
  if (existingTime === null || incomingTime === null) return false
  if (incomingTime !== existingTime) return incomingTime < existingTime

  const existingStamp = existing.updatedAt || ''
  const incomingStamp = incoming.updatedAt || ''
  return !!existingStamp && !!incomingStamp && incomingStamp < existingStamp
}

const mergeCampaignPreservingNewest = (existing: CampaignListItem | undefined, incoming: CampaignListItem): CampaignListItem => {
  if (!existing) return incoming
  if (isIncomingCampaignOlder(existing, incoming)) return existing
  return { ...existing, ...incoming }
}

const mergeLoadedCampaignsPreservingNewest = (current: CampaignListItem[], loaded: CampaignListItem[]): CampaignListItem[] => {
  const currentById = new Map(current.map(campaign => [campaign.id, campaign]))
  return loaded.map(campaign => mergeCampaignPreservingNewest(currentById.get(campaign.id), campaign))
}

const isSnapshotOlderThanSummary = (
  snapshot: Pick<CampaignConfig | CampaignLogSnapshot, 'updatedAt'> | undefined,
  summary: Pick<CampaignListItem, 'updatedAt'>
): boolean => {
  if (!snapshot) return false
  const snapshotTime = Date.parse(snapshot.updatedAt || '')
  const summaryTime = Date.parse(summary.updatedAt || '')
  return Number.isFinite(snapshotTime) && Number.isFinite(summaryTime) && snapshotTime < summaryTime
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

interface SessionListLoadState {
  operation: Promise<void>
  trailingRequested: boolean
}
const accountListLoads = new Map<string, SessionListLoadState>()
const campaignListLoads = new Map<string, SessionListLoadState>()
const campaignConfigLoadsInFlight = new Map<number, Promise<CampaignConfig | null>>()
const campaignLogLoadsInFlight = new Map<number, Promise<CampaignLogSnapshot | null>>()
const campaignConfigInvalidationVersions = new Map<number, number>()
const campaignLogInvalidationVersions = new Map<number, number>()
let campaignSummaryRefreshTimer: ReturnType<typeof setTimeout> | null = null
const pendingCampaignLogInvalidationIds = new Set<number>()
let campaignLogInvalidationTimer: ReturnType<typeof setTimeout> | null = null
let campaignDetailPageRequestVersion = 0
let campaignInputDataRequestVersion = 0
let activeCampaignInputDataQuery: CampaignInputDataPageQuery | null = null
let storeSessionEpoch = 0

const getStoreAuthScopeKey = (): string | null => {
  const user = useAuthStore.getState().user
  return user ? `${user.organizationId}:${user.staffId}` : null
}

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
    const authScope = getStoreAuthScopeKey()
    if (!authScope) return Promise.resolve()
    const requestEpoch = storeSessionEpoch
    const loadKey = `${requestEpoch}:${authScope}`
    const existingLoad = accountListLoads.get(loadKey)
    if (existingLoad) {
      existingLoad.trailingRequested = true
      return existingLoad.operation
    }
    const silent = options?.silent === true
    if (!silent) set({ loadingAccounts: true })
    const loadState: SessionListLoadState = {
      operation: Promise.resolve(),
      trailingRequested: false
    }
    const operation = (async () => {
      let firstRequest = true
      do {
        loadState.trailingRequested = false
        try {
          const accounts = await window.electronAPI.listAccounts()
          if (storeSessionEpoch !== requestEpoch || getStoreAuthScopeKey() !== authScope) break
          set(state => ({ accounts: mergeLoadedAccountsPreservingNewest(state.accounts, accounts) }))
        } catch (err) {
          if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
            console.error('Failed to load accounts:', err)
          }
        } finally {
          if (
            firstRequest &&
            !silent &&
            storeSessionEpoch === requestEpoch &&
            getStoreAuthScopeKey() === authScope
          ) {
            set({ loadingAccounts: false })
          }
          firstRequest = false
        }
      } while (
        loadState.trailingRequested &&
        storeSessionEpoch === requestEpoch &&
        getStoreAuthScopeKey() === authScope
      )
    })()
    loadState.operation = operation
    accountListLoads.set(loadKey, loadState)
    void operation.finally(() => {
      if (accountListLoads.get(loadKey)?.operation === operation) accountListLoads.delete(loadKey)
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
      accounts[index] = {
        ...account,
        hasDisabledActions: account.hasDisabledActions ?? accounts[index].hasDisabledActions
      }
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
    const authScope = getStoreAuthScopeKey()
    if (!authScope) return
    const requestEpoch = storeSessionEpoch
    set({ loadingAccountGroups: true })
    try {
      const accountGroups = await window.electronAPI.listAccountGroups(flatformType)
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        set({ accountGroups })
      }
    } catch (err) {
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        console.error('Failed to load account groups:', err)
      }
    } finally {
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        set({ loadingAccountGroups: false })
      }
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
    const authScope = getStoreAuthScopeKey()
    if (!authScope) return
    const requestEpoch = storeSessionEpoch
    set({ loadingProxies: true })
    try {
      const proxies = await window.electronAPI.listProxies()
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        set({ proxies })
      }
    } catch (err) {
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        console.error('Failed to load proxies:', err)
      }
    } finally {
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        set({ loadingProxies: false })
      }
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
    const authScope = getStoreAuthScopeKey()
    if (!authScope) return
    const requestEpoch = storeSessionEpoch
    try {
      const actions = await window.electronAPI.listCampaignActions()
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        set({ campaignActions: actions })
      }
    } catch (err) {
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        console.error('Failed to load campaign actions:', err)
      }
    }
  },

  loadAllCampaignActions: async () => {
    if (!window.electronAPI) return
    const authScope = getStoreAuthScopeKey()
    if (!authScope) return
    const requestEpoch = storeSessionEpoch
    try {
      const actions = await window.electronAPI.getAllCampaignActions()
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        set({ allCampaignActions: actions })
      }
    } catch (err) {
      if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
        console.error('Failed to load all campaign actions:', err)
      }
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
  campaignConfigs: {},
  campaignLogs: {},
  loadingCampaignConfigIds: {},
  loadingCampaignLogIds: {},

  loadCampaigns: (options) => {
    if (!window.electronAPI) return Promise.resolve()
    const authScope = getStoreAuthScopeKey()
    if (!authScope) return Promise.resolve()
    const requestEpoch = storeSessionEpoch
    const loadKey = `${requestEpoch}:${authScope}`
    const existingLoad = campaignListLoads.get(loadKey)
    if (existingLoad) {
      existingLoad.trailingRequested = true
      return existingLoad.operation
    }
    const silent = options?.silent === true
    if (!silent) set({ loadingCampaigns: true })
    const loadState: SessionListLoadState = {
      operation: Promise.resolve(),
      trailingRequested: false
    }
    const operation = (async () => {
      let firstRequest = true
      do {
        loadState.trailingRequested = false
        try {
          const loaded = await window.electronAPI.listCampaignSummaries()
          if (storeSessionEpoch !== requestEpoch || getStoreAuthScopeKey() !== authScope) break
          set(state => {
            const campaigns = mergeLoadedCampaignsPreservingNewest(state.campaigns, loaded)
            const liveIds = new Set(campaigns.map(campaign => campaign.id))
            const campaignConfigs = { ...state.campaignConfigs }
            const campaignLogs = { ...state.campaignLogs }

            for (const [idText, config] of Object.entries(campaignConfigs)) {
              const id = Number(idText)
              const summary = campaigns.find(campaign => campaign.id === id)
              if (!liveIds.has(id) || (summary && isSnapshotOlderThanSummary(config, summary))) {
                delete campaignConfigs[id]
              }
            }
            for (const [idText, log] of Object.entries(campaignLogs)) {
              const id = Number(idText)
              const summary = campaigns.find(campaign => campaign.id === id)
              if (!liveIds.has(id) || (summary && isSnapshotOlderThanSummary(log, summary))) {
                delete campaignLogs[id]
              }
            }

            return { campaigns, campaignConfigs, campaignLogs }
          })
        } catch (err) {
          if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
            console.error('Failed to load campaign summaries:', err)
          }
        } finally {
          if (
            firstRequest &&
            !silent &&
            storeSessionEpoch === requestEpoch &&
            getStoreAuthScopeKey() === authScope
          ) {
            set({ loadingCampaigns: false })
          }
          firstRequest = false
        }
      } while (
        loadState.trailingRequested &&
        storeSessionEpoch === requestEpoch &&
        getStoreAuthScopeKey() === authScope
      )
    })()
    loadState.operation = operation
    campaignListLoads.set(loadKey, loadState)
    void operation.finally(() => {
      if (campaignListLoads.get(loadKey)?.operation === operation) campaignListLoads.delete(loadKey)
    })
    return operation
  },

  loadCampaignConfig: (id, options) => {
    if (!window.electronAPI) return Promise.resolve(null)
    const authScope = getStoreAuthScopeKey()
    if (!authScope) return Promise.resolve(null)
    const requestEpoch = storeSessionEpoch
    const cached = get().campaignConfigs[id]
    const summary = get().campaigns.find(campaign => campaign.id === id)
    if (cached && options?.force !== true && (!summary || !isSnapshotOlderThanSummary(cached, summary))) {
      return Promise.resolve(cached)
    }
    const inFlight = campaignConfigLoadsInFlight.get(id)
    if (inFlight) {
      if (options?.force !== true) return inFlight
      return inFlight.catch(() => null).then(() => (
        storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope
          ? get().loadCampaignConfig(id, { force: true })
          : null
      ))
    }

    set(state => ({
      loadingCampaignConfigIds: { ...state.loadingCampaignConfigIds, [id]: true }
    }))
    const fetchLatestConfig = async (): Promise<CampaignConfig | null> => {
      let staleRetriesRemaining = 1
      while (true) {
        const requestInvalidationVersion = campaignConfigInvalidationVersions.get(id) || 0
        const config = await window.electronAPI.getCampaignConfig(id)
        if (storeSessionEpoch !== requestEpoch || getStoreAuthScopeKey() !== authScope) return null

        // A runtime update may change a non-summary configuration field while
        // this request is in flight. Retry before committing so an old response
        // cannot repopulate the cache after it was invalidated.
        if ((campaignConfigInvalidationVersions.get(id) || 0) !== requestInvalidationVersion) {
          staleRetriesRemaining = 1
          continue
        }

        const latestSummary = get().campaigns.find(campaign => campaign.id === id)
        if (
          config &&
          latestSummary &&
          isSnapshotOlderThanSummary(config, latestSummary) &&
          staleRetriesRemaining > 0
        ) {
          staleRetriesRemaining -= 1
          continue
        }

        set(state => {
          const campaignConfigs = { ...state.campaignConfigs }
          if (config) {
            campaignConfigs[id] = config
            pruneCampaignSnapshotCache(campaignConfigs, id, CAMPAIGN_CONFIG_CACHE_LIMIT)
          } else {
            delete campaignConfigs[id]
          }
          return { campaignConfigs }
        })
        return config
      }
    }
    const operation = fetchLatestConfig()
      .finally(() => {
        if (campaignConfigLoadsInFlight.get(id) !== operation) return
        campaignConfigLoadsInFlight.delete(id)
        set(state => {
          const loadingCampaignConfigIds = { ...state.loadingCampaignConfigIds }
          delete loadingCampaignConfigIds[id]
          return { loadingCampaignConfigIds }
        })
      })
    campaignConfigLoadsInFlight.set(id, operation)
    return operation
  },

  loadCampaignLog: (id, options) => {
    if (!window.electronAPI) return Promise.resolve(null)
    const authScope = getStoreAuthScopeKey()
    if (!authScope) return Promise.resolve(null)
    const requestEpoch = storeSessionEpoch
    const requestInvalidationVersion = campaignLogInvalidationVersions.get(id) || 0
    const cached = get().campaignLogs[id]
    const summary = get().campaigns.find(campaign => campaign.id === id)
    if (cached && options?.force !== true && (!summary || !isSnapshotOlderThanSummary(cached, summary))) {
      return Promise.resolve(cached)
    }
    const inFlight = campaignLogLoadsInFlight.get(id)
    if (inFlight) {
      if (options?.force !== true) return inFlight
      return inFlight.catch(() => null).then(() => (
        storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope
          ? get().loadCampaignLog(id, { force: true })
          : null
      ))
    }

    set(state => ({
      loadingCampaignLogIds: { ...state.loadingCampaignLogIds, [id]: true }
    }))
    const fetchLatestLog = async (staleRetriesRemaining: number): Promise<CampaignLogSnapshot | null> => {
      const log = await window.electronAPI.getCampaignLog(id)
      if (storeSessionEpoch !== requestEpoch || getStoreAuthScopeKey() !== authScope) return null
      const latestSummary = get().campaigns.find(campaign => campaign.id === id)
      if (
        log &&
        latestSummary &&
        isSnapshotOlderThanSummary(log, latestSummary) &&
        staleRetriesRemaining > 0
      ) {
        return fetchLatestLog(staleRetriesRemaining - 1)
      }
      return log
    }
    const operation = fetchLatestLog(1)
      .then(log => {
        if (storeSessionEpoch !== requestEpoch || getStoreAuthScopeKey() !== authScope) return null
        if ((campaignLogInvalidationVersions.get(id) || 0) !== requestInvalidationVersion) {
          // Wait until this operation's finally block removes the in-flight
          // entry; recursively awaiting it here would create a promise cycle.
          setTimeout(() => {
            if (storeSessionEpoch === requestEpoch && getStoreAuthScopeKey() === authScope) {
              void get().loadCampaignLog(id, { force: true })
            }
          }, 0)
          return null
        }
        set(state => {
          const campaignLogs = { ...state.campaignLogs }
          if (log) {
            campaignLogs[id] = log
            pruneCampaignSnapshotCache(campaignLogs, id, CAMPAIGN_LOG_CACHE_LIMIT)
          } else {
            delete campaignLogs[id]
          }
          return { campaignLogs }
        })
        return log
      })
      .finally(() => {
        if (campaignLogLoadsInFlight.get(id) !== operation) return
        campaignLogLoadsInFlight.delete(id)
        set(state => {
          const loadingCampaignLogIds = { ...state.loadingCampaignLogIds }
          delete loadingCampaignLogIds[id]
          return { loadingCampaignLogIds }
        })
      })
    campaignLogLoadsInFlight.set(id, operation)
    return operation
  },

  createCampaign: async (data, options) => {
    if (!window.electronAPI) throw new Error('API not available')
    const campaign = await window.electronAPI.createCampaign(data)
    if (options?.refresh !== false) await get().loadCampaigns()
    return campaign
  },

  updateCampaign: async (id, updates, options) => {
    if (!window.electronAPI) return
    await window.electronAPI.updateCampaign(id, updates)
    set(state => {
      const campaignConfigs = { ...state.campaignConfigs }
      const campaignLogs = { ...state.campaignLogs }
      delete campaignConfigs[id]
      delete campaignLogs[id]
      return { campaignConfigs, campaignLogs }
    })
    if (options?.refresh !== false) await get().loadCampaigns({ silent: true })
  },

  deleteCampaign: async (id) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteCampaign(id)
    set(state => {
      const campaignConfigs = { ...state.campaignConfigs }
      const campaignLogs = { ...state.campaignLogs }
      delete campaignConfigs[id]
      delete campaignLogs[id]
      return { campaignConfigs, campaignLogs }
    })
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
    set(state => {
      const campaignConfigs = { ...state.campaignConfigs }
      const campaignLogs = { ...state.campaignLogs }
      ids.forEach(id => {
        delete campaignConfigs[id]
        delete campaignLogs[id]
      })
      return { campaignConfigs, campaignLogs }
    })
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
    set(state => {
      const campaignConfigs = { ...state.campaignConfigs }
      const campaignLogs = { ...state.campaignLogs }
      ids.forEach(id => {
        delete campaignConfigs[id]
        delete campaignLogs[id]
      })
      return { campaignConfigs, campaignLogs }
    })
    await get().loadCampaigns()
  },

  upsertCampaign: (signal) => {
    const id = Number(signal.id)
    if (Number.isSafeInteger(id) && id > 0) {
      if (signal.invalidateConfig === true) {
        campaignConfigInvalidationVersions.set(
          id,
          (campaignConfigInvalidationVersions.get(id) || 0) + 1
        )
        set(state => {
          if (!state.campaignConfigs[id]) return state
          const campaignConfigs = { ...state.campaignConfigs }
          delete campaignConfigs[id]
          return { campaignConfigs }
        })
      }

      const existing = get().campaigns.find(campaign => campaign.id === id)
      if (existing) {
        const incomingUpdatedAt = typeof signal.updatedAt === 'string' ? signal.updatedAt : undefined
        const incomingTime = Date.parse(incomingUpdatedAt || '')
        const existingTime = Date.parse(existing.updatedAt || '')
        if (!Number.isFinite(incomingTime) || !Number.isFinite(existingTime) || incomingTime >= existingTime) {
          set(state => {
            const campaignConfigs = { ...state.campaignConfigs }
            const cachedConfig = campaignConfigs[id]
            if (cachedConfig) {
              campaignConfigs[id] = {
                ...cachedConfig,
                ...(incomingUpdatedAt ? { updatedAt: incomingUpdatedAt } : {}),
                ...(typeof signal.status === 'string' ? { status: signal.status } : {}),
                ...('note' in signal ? { note: signal.note ?? null } : {}),
                ...('schedule' in signal ? { schedule: signal.schedule ?? undefined } : {}),
                ...('lastRunAt' in signal ? { lastRunAt: signal.lastRunAt ?? null } : {})
              }
            }
            return {
              campaignConfigs,
              campaigns: state.campaigns.map(campaign => campaign.id === id
                ? {
                  ...campaign,
                  ...(incomingUpdatedAt ? { updatedAt: incomingUpdatedAt } : {}),
                  ...(typeof signal.status === 'string' ? { status: signal.status } : {}),
                  ...('note' in signal ? { note: signal.note ?? null } : {}),
                  ...('schedule' in signal ? { schedule: signal.schedule ?? undefined } : {}),
                  ...('lastRunAt' in signal ? { lastRunAt: signal.lastRunAt ?? null } : {})
                }
                : campaign)
            }
          })
          // Queue invalidation even while a log read is in flight. Otherwise a
          // signal that lands just before the snapshot is cached can leave the
          // active Run Log tab stale until the next periodic list refresh.
          campaignLogInvalidationVersions.set(
            id,
            (campaignLogInvalidationVersions.get(id) || 0) + 1
          )
          pendingCampaignLogInvalidationIds.add(id)
          if (!campaignLogInvalidationTimer) {
            campaignLogInvalidationTimer = setTimeout(() => {
              campaignLogInvalidationTimer = null
              const invalidatedIds = Array.from(pendingCampaignLogInvalidationIds)
              pendingCampaignLogInvalidationIds.clear()
              set(state => {
                const campaignLogs = { ...state.campaignLogs }
                invalidatedIds.forEach(invalidatedId => delete campaignLogs[invalidatedId])
                return { campaignLogs }
              })
            }, 2_000)
          }
        }
        return
      }
    }
    if (campaignSummaryRefreshTimer) return
    campaignSummaryRefreshTimer = setTimeout(() => {
      campaignSummaryRefreshTimer = null
      void get().loadCampaigns({ silent: true })
    }, 400)
  },

  resetCampaignSession: () => {
    storeSessionEpoch += 1
    accountListLoads.clear()
    campaignListLoads.clear()
    campaignConfigLoadsInFlight.clear()
    campaignLogLoadsInFlight.clear()
    campaignConfigInvalidationVersions.clear()
    campaignLogInvalidationVersions.clear()
    pendingCampaignLogInvalidationIds.clear()
    if (campaignSummaryRefreshTimer) clearTimeout(campaignSummaryRefreshTimer)
    if (campaignLogInvalidationTimer) clearTimeout(campaignLogInvalidationTimer)
    campaignSummaryRefreshTimer = null
    campaignLogInvalidationTimer = null
    campaignDetailPageRequestVersion += 1
    campaignInputDataRequestVersion += 1
    activeCampaignInputDataQuery = null
    set({
      accounts: [],
      loadingAccounts: false,
      accountGroups: [],
      loadingAccountGroups: false,
      proxies: [],
      loadingProxies: false,
      campaignActions: [],
      allCampaignActions: [],
      campaigns: [],
      loadingCampaigns: false,
      campaignConfigs: {},
      campaignLogs: {},
      loadingCampaignConfigIds: {},
      loadingCampaignLogIds: {},
      selectedCampaignId: null,
      campaignInputs: [],
      loadingCampaignInputs: false,
      campaignInputData: [],
      campaignInputDataTotal: 0,
      loadingCampaignInputData: false,
      campaignDetails: [],
      loadingCampaignDetails: false,
      campaignDetailPageItems: [],
      campaignDetailPageTotal: 0,
      loadingCampaignDetailPage: false,
      emailCampaignLinkTrackings: [],
      emailCampaignLinkTrackingCampaignId: null,
      loadingEmailCampaignLinkTrackings: false,
      campaignRunEvents: [],
      loadingCampaignRunEvents: false,
      campaignRelationSummaries: [],
      loadingCampaignRelationSummaries: false,
      logs: []
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

  createCampaignInputDataBatch: async (actions, progressRequestId) => {
    if (!window.electronAPI) throw new Error('API not available')
    const insertedCount = await window.electronAPI.createCampaignInputDataBatch(actions, progressRequestId)
    const { selectedCampaignId } = get()
    if (selectedCampaignId) {
      const activeQuery = activeCampaignInputDataQuery
      const { campaignId: _campaignId, ...query } = activeQuery?.campaignId === selectedCampaignId
        ? activeQuery
        : { campaignId: selectedCampaignId }
      await get().loadCampaignInputData(selectedCampaignId, query)
    }
    return insertedCount
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

  deleteCampaignInputDataBatch: async (ids) => {
    if (!window.electronAPI) throw new Error('API not available')
    const result = await window.electronAPI.deleteCampaignInputDataBatch(ids)
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

useAuthStore.subscribe((state, previousState) => {
  const nextScope = state.user ? `${state.user.organizationId}:${state.user.staffId}` : null
  const previousScope = previousState.user
    ? `${previousState.user.organizationId}:${previousState.user.staffId}`
    : null
  if (nextScope !== previousScope) useCampaignStore.getState().resetCampaignSession()
})
