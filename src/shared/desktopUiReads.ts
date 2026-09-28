import type { AutoAccount, CampaignListItem } from './types'

export const DESKTOP_POLL_KEYS = {
  campaigns: 'desktop.campaigns.poll_interval_seconds',
  accounts: 'desktop.accounts.poll_interval_seconds'
} as const
export interface DesktopPollingSettings { campaigns: number; accounts: number }
export const DEFAULT_DESKTOP_POLLING: DesktopPollingSettings = { campaigns: 30, accounts: 30 }
export function parseDesktopPollSeconds(value: unknown): number {
  const text = String(value ?? '').trim()
  const seconds = Number(text)
  return /^\d+$/.test(text) && Number.isSafeInteger(seconds) && seconds >= 5 && seconds <= 3600 ? seconds : 30
}

export interface DesktopCampaignFilters {
  search?: string
  dateFrom?: string
  dateTo?: string
  statuses?: string[]
  accountIds?: number[]
  filterAccountId?: number
  actionIds?: string[]
  platforms?: string[]
}
export interface DesktopCampaignPageQuery {
  filters: DesktopCampaignFilters
  page: number
  selectedId?: number | null
  drafts?: Array<{ id: string; schedule: string }>
}
export interface DesktopCampaignPage {
  configVersion?: { id: number; version: string } | null
  items: CampaignListItem[]
  selected: CampaignListItem | null
  order: Array<{ kind: 'campaign' | 'draft'; id: string }>
  total: number
  runningCampaigns: Array<{ id: number; accountId: number; name: string }>
  extraAccounts: Array<{ id: number; name: string }>
  actionOptions: Array<{ id: string; name: string; platform: string }>
  campaignTotal: number
  page: number
  pageSize: number
}
export interface DesktopCampaignSelectionQuery {
  filters: DesktopCampaignFilters
  afterId?: number
  ids?: number[]
}
export interface DesktopCampaignSelection { id: number; status: string }
export interface DesktopAccountSnapshot {
  version: string
  catalog: AutoAccount[] | null
  states: Array<Pick<AutoAccount, 'id' | 'status' | 'loginStatus' | 'updatedAt' | 'hasDisabledActions'> & Partial<AutoAccount>>
}

export const DESKTOP_UI_IPC = {
  settings: 'desktop-ui:polling-settings',
  campaignPage: 'desktop-ui:campaign-page',
  campaignCatalog: 'desktop-ui:campaign-catalog',
  campaignSelection: 'desktop-ui:campaign-selection',
  campaignSources: 'desktop-ui:campaign-sources',
  campaignConfig: 'desktop-ui:campaign-config',
  campaignLog: 'desktop-ui:campaign-log',
  accountSnapshot: 'desktop-ui:account-snapshot'
} as const
