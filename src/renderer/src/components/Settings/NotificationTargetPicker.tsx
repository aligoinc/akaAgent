import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, X } from 'lucide-react'
import type { DataGroup } from '../../../../shared/types'
import { NOTIFICATION_MAX_FILTER_IDS } from '../../../../shared/notificationCenter'
import { useCampaignStore } from '../../stores/campaignStore'

interface PickerOption {
  id: number
  label: string
  meta?: string
}

interface PickerProps {
  selected: number[]
  onChange: (ids: number[]) => void
}

const MAX_RENDERED_OPTIONS = 300
const MAX_LOADED_GROUPS = 1000

const STATUS_LABELS: Record<string, string> = {
  'hoàn thành': 'Hoàn thành',
  'tạm dừng': 'Tạm dừng',
  'đang chạy': 'Đang chạy',
  'chờ xử lý': 'Chờ xử lý',
  'đã đăng nhập': 'Đã đăng nhập',
  'chưa đăng nhập': 'Chưa đăng nhập',
  checkpoint: 'Checkpoint'
}
const PLATFORM_LABELS: Record<string, string> = { facebook: 'Facebook', zalo: 'Zalo', sms: 'SMS', email: 'Email', tiktok: 'TikTok' }

const statusLabel = (value: string | null | undefined): string => {
  const text = String(value || '').trim()
  return STATUS_LABELS[text.toLowerCase()] ?? text
}
const platformLabel = (value: string | null | undefined): string => {
  const text = String(value || '').trim()
  return PLATFORM_LABELS[text.toLowerCase()] ?? text
}

function TargetChecklist({ options, selected, onChange, loading, error, onReload, itemLabel, emptyText, hint }: PickerProps & {
  options: PickerOption[]
  loading: boolean
  error: string
  onReload: () => void
  itemLabel: string
  emptyText: string
  hint?: string
}) {
  const [search, setSearch] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const known = useMemo(() => new Set(options.map(option => option.id)), [options])
  const keyword = search.trim().toLowerCase()
  const filtered = useMemo(() => (keyword
    ? options.filter(option => option.label.toLowerCase().includes(keyword) || String(option.id) === keyword)
    : options), [options, keyword])
  const shown = filtered.slice(0, MAX_RENDERED_OPTIONS)
  const missing = loading || error ? [] : selected.filter(id => !known.has(id))
  const full = selected.length >= NOTIFICATION_MAX_FILTER_IDS

  const toggle = (id: number) => {
    if (selectedSet.has(id)) onChange(selected.filter(item => item !== id))
    else if (!full) onChange([...selected, id])
  }

  return (
    <div className="nc-picker">
      <div className="nc-picker-toolbar">
        <label className="nc-picker-search">
          <Search size={14} aria-hidden="true" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Tìm ${itemLabel}`} aria-label={`Tìm ${itemLabel}`} />
        </label>
        <span className="nc-picker-count">Đã chọn {selected.length}/{NOTIFICATION_MAX_FILTER_IDS}</span>
        {selected.length > 0 && (
          <button type="button" className="nc-link-button" onClick={() => onChange([])}>Bỏ chọn</button>
        )}
        <button type="button" className="btn-icon" title="Tải lại danh sách" aria-label="Tải lại danh sách" onClick={onReload} disabled={loading}>
          <RefreshCw size={14} />
        </button>
      </div>
      {missing.length > 0 && (
        <div className="nc-picker-missing">
          {missing.map(id => (
            <span key={id} className="nc-missing-chip">
              {itemLabel} #{id} không còn trong danh sách
              <button type="button" aria-label={`Bỏ ${itemLabel} #${id}`} onClick={() => onChange(selected.filter(item => item !== id))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="nc-picker-list" role="group" aria-label={`Chọn ${itemLabel}`} aria-busy={loading}>
        {loading ? (
          <p className="nc-picker-empty" role="status">Đang tải...</p>
        ) : error ? (
          <p className="nc-picker-empty" role="alert">
            {error} <button type="button" className="nc-link-button" onClick={onReload}>Thử lại</button>
          </p>
        ) : shown.length === 0 ? (
          <p className="nc-picker-empty">{keyword ? `Không tìm thấy ${itemLabel} phù hợp.` : emptyText}</p>
        ) : shown.map(option => {
          const checked = selectedSet.has(option.id)
          return (
            <label key={option.id} className={`nc-picker-item ${checked ? 'is-checked' : ''}`}>
              <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(option.id)} />
              <span className="nc-picker-name" title={option.label}>{option.label}</span>
              {option.meta && <span className="nc-picker-meta">{option.meta}</span>}
            </label>
          )
        })}
        {!loading && !error && filtered.length > shown.length && (
          <p className="nc-picker-empty">Đang hiện {shown.length}/{filtered.length}. Nhập từ khóa để thu hẹp danh sách.</p>
        )}
      </div>
      {hint && <p className="nc-hint">{hint}</p>}
    </div>
  )
}

/** Dùng danh mục chiến dịch đã có trong store; chỉ tải khi store chưa có hoặc người dùng bấm tải lại. */
export function CampaignTargetPicker({ selected, onChange }: PickerProps) {
  const catalog = useCampaignStore(state => state.campaignCatalog)
  const loadCampaignCatalog = useCampaignStore(state => state.loadCampaignCatalog)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    loadCampaignCatalog()
      .catch(() => setError('Không thể tải danh sách chiến dịch.'))
      .finally(() => setLoading(false))
  }, [loadCampaignCatalog])
  useEffect(() => {
    if (useCampaignStore.getState().campaignCatalog.length === 0) reload()
  }, [reload])
  const options = useMemo(() => catalog.map(campaign => ({
    id: campaign.id,
    label: campaign.name || `Chiến dịch #${campaign.id}`,
    meta: [statusLabel(campaign.status), campaign.accountName].filter(Boolean).join(' · ')
  })), [catalog])
  return (
    <TargetChecklist options={options} selected={selected} onChange={onChange} loading={loading} error={error} onReload={reload}
      itemLabel="chiến dịch" emptyText="Bạn chưa có chiến dịch nào." />
  )
}

/** Dùng danh sách tài khoản đã có trong store (tài khoản của chính nhân viên). */
export function AccountTargetPicker({ selected, onChange }: PickerProps) {
  const accounts = useCampaignStore(state => state.accounts)
  const loadAccounts = useCampaignStore(state => state.loadAccounts)
  const [loading, setLoading] = useState(false)
  // Lần đầu chỉ nhập vào lượt tải đang chạy (nếu có); bấm tải lại mới yêu cầu đọc mới.
  const load = useCallback((invalidate: boolean) => {
    setLoading(true)
    loadAccounts({ silent: true, invalidate }).finally(() => setLoading(false))
  }, [loadAccounts])
  useEffect(() => {
    if (useCampaignStore.getState().accounts.length === 0) load(false)
  }, [load])
  const options = useMemo(() => accounts.map(account => ({
    id: account.id,
    label: account.name || `Tài khoản #${account.id}`,
    meta: [platformLabel(account.flatformType), statusLabel(account.loginStatus)].filter(Boolean).join(' · ')
  })), [accounts])
  return (
    <TargetChecklist options={options} selected={selected} onChange={onChange} loading={loading} error="" onReload={() => load(true)}
      itemLabel="tài khoản" emptyText="Bạn chưa có tài khoản nào." />
  )
}

/**
 * Chỉ liệt kê nhóm do chính nhân viên tạo: RPC V457 chỉ nhận nhóm sở hữu hoặc được chia sẻ đích danh,
 * còn danh sách nhóm của Desktop không phân biệt chia sẻ toàn tổ chức với chia sẻ đích danh.
 */
export function DataGroupTargetPicker({ selected, onChange }: PickerProps) {
  const [groups, setGroups] = useState<DataGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void (async () => {
      const loaded: DataGroup[] = []
      let offset = 0
      while (loaded.length < MAX_LOADED_GROUPS) {
        const page = await window.electronAPI.listDataGroups({ offset, limit: 200, ownedOnly: true })
        loaded.push(...page.groups)
        offset += page.groups.length
        if (page.groups.length === 0 || offset >= page.total) break
      }
      return loaded
    })()
      .then(loaded => { if (!cancelled) setGroups(loaded) })
      .catch(() => { if (!cancelled) setError('Không thể tải danh sách nhóm data.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])
  const options = useMemo(() => groups.filter(group => !group.isDelete).map(group => ({
    id: group.id,
    label: group.name || `Nhóm #${group.id}`,
    meta: `${new Intl.NumberFormat('vi-VN').format(group.activeMembershipCount || 0)} data`
  })), [groups])
  return (
    <TargetChecklist options={options} selected={selected} onChange={onChange} loading={loading} error={error}
      onReload={() => setReloadKey(value => value + 1)} itemLabel="nhóm" emptyText="Bạn chưa tạo nhóm data nào."
      hint="Danh sách gồm các nhóm bạn tạo." />
  )
}
