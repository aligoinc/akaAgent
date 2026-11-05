import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, ChevronDown, RefreshCw } from 'lucide-react'
import {
  DEFAULT_EFFECTIVENESS_LIFETIME_WINDOW, REPORT_RANGE_PRESETS, buildVietnamReportRange, vietnamDateKey,
  type EffectivenessLifetimeWindow, type EffectivenessPlatform, type EffectivenessQuery, type ReportRangePreset
} from '../../../../shared/campaignEffectiveness'
import type { AutoAccount } from '../../../../shared/types'
import { useAuthStore } from '../../stores/authStore'
import ReportPage from '../../pages/ReportPage'
import { effectivenessRequest, type EffectivenessNavigation } from './effectivenessApi'
import { AchievementsTab } from './AchievementsTab'
import { CampaignEffectivenessTab } from './CampaignEffectivenessTab'
import { InsightsTab } from './InsightsTab'
import { AssetsTab } from './AssetsTab'
import './effectivenessReports.css'

export type ReportHubTab = 'achievements' | 'campaigns' | 'insights' | 'assets' | 'accounts'
type PlatformFilter = EffectivenessPlatform | 'all'

const TABS: ReadonlyArray<{ value: ReportHubTab; label: string }> = [
  { value: 'achievements', label: 'Thành quả' },
  { value: 'campaigns', label: 'Theo chiến dịch' },
  { value: 'insights', label: 'Bí quyết hiệu quả' },
  { value: 'assets', label: 'Tài sản của bạn' },
  { value: 'accounts', label: 'Chi tiết theo tài khoản' }
]
const TAB_STORAGE_KEY = 'aka.reports.tab'
const PLATFORM_LABELS: Record<PlatformFilter, string> = { all: 'Tất cả', facebook: 'Facebook', zalo: 'Zalo', email: 'Email', sms: 'SMS' }

function readStoredTab(): ReportHubTab {
  try {
    const value = window.localStorage.getItem(TAB_STORAGE_KEY)
    return TABS.some(tab => tab.value === value) ? value as ReportHubTab : 'achievements'
  } catch { return 'achievements' }
}

interface FilterState {
  platform: PlatformFilter
  accountIds: number[] | null
  preset: ReportRangePreset
  customStart: string
  customEnd: string
  compare: boolean
}

export interface EffectivenessTabProps {
  query: EffectivenessQuery
  /** Changes with login, refresh, platform, accounts and period. */
  queryKey: string
  /** Login + refresh + platform/accounts (period-independent reads such as the lũy kế journey). */
  scopeKey: string
  /** Login + refresh only (data assets). */
  authKey: string
  compare: boolean
  cache: Map<string, unknown>
  rangeLabel: string
  /** "Lũy kế" window of the journey banner/card; starts at 7 days. */
  lifetimeWindow: EffectivenessLifetimeWindow
  onLifetimeWindowChange: (window: EffectivenessLifetimeWindow) => void
  onOpenAccountDetails: () => void
  onNavigate: (target: EffectivenessNavigation) => void
}

/**
 * Báo cáo page: effectiveness tabs (same numbers as WebApp/iOS through the shared assembly) plus the existing
 * account report kept as "Chi tiết theo tài khoản". Nothing loads until the page is opened; no polling.
 */
export default function EffectivenessReportsHub({ isActive, onNavigate }: {
  isActive: boolean
  onNavigate: (target: EffectivenessNavigation) => void
}) {
  const authScope = useAuthStore(state => state.user ? `${state.user.organizationId}:${state.user.staffId}:${state.user.chatWebSessionId || ''}` : '')
  const [tab, setTab] = useState<ReportHubTab>(readStoredTab)
  const [activatedScope, setActivatedScope] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AutoAccount[]>([])
  const [platforms, setPlatforms] = useState<EffectivenessPlatform[]>([])
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const today = vietnamDateKey(new Date())
  const initial: FilterState = { platform: 'all', accountIds: null, preset: '7_days', customStart: today, customEnd: today, compare: false }
  const [draft, setDraft] = useState<FilterState>(initial)
  const [applied, setApplied] = useState<FilterState>(initial)
  const [revision, setRevision] = useState(0)
  // Not stored: a longer window is an explicit choice, so a fresh start reads only 7 days.
  const [lifetimeWindow, setLifetimeWindow] = useState<EffectivenessLifetimeWindow>(DEFAULT_EFFECTIVENESS_LIFETIME_WINDOW)
  // A new login or a manual refresh never reuses earlier numbers.
  const cache = useMemo(() => new Map<string, unknown>(), [authScope, revision])
  const [openMenu, setOpenMenu] = useState<'platform' | 'accounts' | 'range' | null>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const activated = !!authScope && activatedScope === authScope

  // The page stays mounted while hidden: start reading only once it is opened for this login.
  useEffect(() => {
    if (isActive && authScope) setActivatedScope(authScope)
  }, [isActive, authScope])

  useEffect(() => {
    setDraft(initial)
    setApplied(initial)
    setAccounts([])
    setPlatforms([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authScope])

  useEffect(() => {
    if (!activated || !window.electronAPI) return
    let active = true
    setOptionsError(null)
    Promise.all([effectivenessRequest({ kind: 'platforms' }), window.electronAPI.listAccounts()]).then(([allowed, list]) => {
      if (!active) return
      setPlatforms(allowed)
      setAccounts(list.filter(account => (allowed as string[]).includes(account.flatformType))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi')))
    }).catch(error => { if (active) setOptionsError(error instanceof Error ? error.message : 'Không thể tải tài khoản.') })
    return () => { active = false }
  }, [activated, authScope])

  useEffect(() => {
    try { window.localStorage.setItem(TAB_STORAGE_KEY, tab) } catch { /* storage may be unavailable */ }
  }, [tab])

  useEffect(() => {
    if (!openMenu) return
    const onDown = (event: MouseEvent) => { if (!filterRef.current?.contains(event.target as Node)) setOpenMenu(null) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [openMenu])

  const platformAccounts = accounts.filter(account => draft.platform === 'all' || account.flatformType === draft.platform)
  const selectedIds = draft.accountIds ?? platformAccounts.map(account => account.id)
  const rangeError = draft.preset === 'custom' && draft.customStart > draft.customEnd ? 'Ngày bắt đầu phải trước ngày kết thúc.' : null

  const { query, queryKey, scopeKey, authKey, rangeLabel } = useMemo(() => {
    const range = buildVietnamReportRange(applied.preset, applied.customStart, applied.customEnd)
    const effectivenessQuery: EffectivenessQuery = {
      ...range,
      ...(applied.platform !== 'all' ? { flatformType: applied.platform } : {}),
      ...(applied.accountIds ? { accountIds: applied.accountIds } : {})
    }
    const label = applied.preset === 'custom'
      ? `${applied.customStart.split('-').reverse().join('/')} – ${applied.customEnd.split('-').reverse().join('/')}`
      : REPORT_RANGE_PRESETS.find(item => item.value === applied.preset)?.label || ''
    const auth = `${authScope}|${revision}`
    return {
      query: effectivenessQuery, queryKey: `${auth}|${JSON.stringify(effectivenessQuery)}`, authKey: auth,
      scopeKey: `${auth}|${applied.platform}|${applied.accountIds?.join(',') || 'all'}`, rangeLabel: label
    }
  }, [applied, authScope, revision])

  const apply = () => {
    if (rangeError) return
    setOpenMenu(null)
    setApplied(draft)
  }
  const refresh = () => {
    setRevision(value => value + 1)
    setApplied(draft)
  }
  const toggleAccount = (id: number) => setDraft(current => {
    const base = current.accountIds ?? platformAccounts.map(account => account.id)
    const next = base.includes(id) ? base.filter(item => item !== id) : [...base, id]
    return { ...current, accountIds: next.length === platformAccounts.length ? null : next }
  })
  const accountSummary = draft.accountIds === null ? `Tất cả (${platformAccounts.length})` : `${selectedIds.length} tài khoản`
  const draftRangeLabel = REPORT_RANGE_PRESETS.find(item => item.value === draft.preset)?.label || ''
  const platformOptions: PlatformFilter[] = ['all', ...platforms]
  const tabProps: EffectivenessTabProps = {
    query, queryKey, scopeKey, authKey, compare: applied.compare, cache, rangeLabel,
    lifetimeWindow, onLifetimeWindowChange: setLifetimeWindow,
    onOpenAccountDetails: () => setTab('accounts'), onNavigate
  }

  return <div className="report-hub">
    <div className="report-hub-tabs" role="tablist" aria-label="Loại báo cáo">
      {TABS.map(item => <button key={item.value} type="button" role="tab" id={`report-hub-tab-${item.value}`}
        aria-selected={tab === item.value} aria-controls="report-hub-panel" onClick={() => setTab(item.value)}>{item.label}</button>)}
    </div>
    {tab === 'accounts' ? <ReportPage isActive={isActive} /> : !activated ? null : <div className="report-hub-body" id="report-hub-panel" role="tabpanel" aria-labelledby={`report-hub-tab-${tab}`}>
      <section className="eff-filter-card" aria-label="Bộ lọc báo cáo">
        <div className="eff-filter-fields" ref={filterRef}>
          <div className="eff-filter-field">
            <span>Loại tài khoản</span>
            <button type="button" className="eff-filter-button" aria-expanded={openMenu === 'platform'} onClick={() => setOpenMenu(openMenu === 'platform' ? null : 'platform')}>
              <strong>{PLATFORM_LABELS[draft.platform]}</strong><ChevronDown size={14} />
            </button>
            {openMenu === 'platform' && <div className="eff-popover">
              {platformOptions.map(platform => <button key={platform} type="button" className={`eff-option${draft.platform === platform ? ' is-selected' : ''}`}
                onClick={() => { setDraft(current => ({ ...current, platform, accountIds: null })); setOpenMenu(null) }}>{PLATFORM_LABELS[platform]}</button>)}
            </div>}
          </div>
          <div className="eff-filter-field">
            <span>Tài khoản</span>
            <button type="button" className="eff-filter-button" aria-expanded={openMenu === 'accounts'} onClick={() => setOpenMenu(openMenu === 'accounts' ? null : 'accounts')}>
              <strong>{optionsError ? 'Không tải được' : accountSummary}</strong><ChevronDown size={14} />
            </button>
            {openMenu === 'accounts' && <div className="eff-popover is-wide">
              <div className="eff-popover-head">
                <span>{selectedIds.length}/{platformAccounts.length} tài khoản</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(current => ({
                  ...current, accountIds: current.accountIds === null ? [] : null
                }))}>{draft.accountIds === null ? 'Bỏ chọn' : 'Chọn tất cả'}</button>
              </div>
              <div className="eff-account-list">
                {platformAccounts.map(account => <label key={account.id} className="eff-check">
                  <input type="checkbox" checked={selectedIds.includes(account.id)} onChange={() => toggleAccount(account.id)} />
                  <span title={account.name}>{account.name}</span>
                  {draft.platform === 'all' && <em>{PLATFORM_LABELS[account.flatformType as EffectivenessPlatform] || account.flatformType}</em>}
                </label>)}
                {!platformAccounts.length && <p className="eff-muted">{optionsError || 'Không có tài khoản.'}</p>}
              </div>
            </div>}
          </div>
          <div className="eff-filter-field">
            <span>Khoảng thời gian</span>
            <button type="button" className="eff-filter-button" aria-expanded={openMenu === 'range'} onClick={() => setOpenMenu(openMenu === 'range' ? null : 'range')}>
              <strong>{draftRangeLabel}</strong><ChevronDown size={14} />
            </button>
            {openMenu === 'range' && <div className="eff-popover">
              <div className="eff-option-grid">
                {REPORT_RANGE_PRESETS.map(item => <button key={item.value} type="button" className={`eff-option${draft.preset === item.value ? ' is-selected' : ''}`}
                  onClick={() => setDraft(current => ({ ...current, preset: item.value }))}>{item.label}</button>)}
              </div>
              {draft.preset === 'custom' && <div className="eff-date-grid">
                <label><span>Từ ngày</span><input type="date" value={draft.customStart} max={today} onChange={event => setDraft(current => ({ ...current, customStart: event.target.value }))} /></label>
                <label><span>Đến ngày</span><input type="date" value={draft.customEnd} max={today} onChange={event => setDraft(current => ({ ...current, customEnd: event.target.value }))} /></label>
                {rangeError && <p className="eff-field-error" role="alert">{rangeError}</p>}
              </div>}
            </div>}
          </div>
          {tab === 'achievements' && <label className="eff-compare">
            <input type="checkbox" checked={draft.compare} onChange={event => setDraft(current => ({ ...current, compare: event.target.checked }))} />
            <span>So với kỳ trước</span>
          </label>}
        </div>
        <div className="eff-filter-actions">
          <button type="button" className="btn btn-primary" onClick={apply} disabled={!!rangeError || (draft.accountIds !== null && draft.accountIds.length === 0)}>
            <BarChart3 size={14} />Xem báo cáo
          </button>
          <button type="button" className="btn btn-ghost" onClick={refresh} title="Tải lại số liệu mới nhất"><RefreshCw size={14} />Làm mới</button>
        </div>
      </section>
      {tab === 'achievements' && <AchievementsTab {...tabProps} />}
      {tab === 'campaigns' && <CampaignEffectivenessTab {...tabProps} />}
      {tab === 'insights' && <InsightsTab {...tabProps} />}
      {tab === 'assets' && <AssetsTab {...tabProps} />}
    </div>}
  </div>
}
