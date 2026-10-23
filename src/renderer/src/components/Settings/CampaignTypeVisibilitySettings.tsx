import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Info, LoaderCircle, RotateCcw, Search } from 'lucide-react'
import type { CampaignTypeVisibilityResult, CampaignVisibilityChange } from '../../../../shared/campaignTypeVisibility'
import './CampaignTypeVisibilitySettings.css'

export interface CampaignTypeVisibilitySettingsProps {
  organizationName: string
  load: (signal: AbortSignal) => Promise<CampaignTypeVisibilityResult>
  save: (changes: CampaignVisibilityChange[]) => Promise<CampaignTypeVisibilityResult>
  onConfirmed: (result: CampaignTypeVisibilityResult, saved: boolean) => void
  onBusyChange: (busy: boolean) => void
}
const PLATFORMS = [
  { id: 'zalo', label: 'Zalo', color: '#0068ff' },
  { id: 'facebook', label: 'Facebook', color: '#1877f2' },
  { id: 'sms', label: 'SMS', color: '#0ea5e9' },
  { id: 'email', label: 'Email', color: '#10b981' }
]
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()

function VisibilityCheckbox({ checked, partial = false, disabled, label, onChange }: {
  checked: boolean; partial?: boolean; disabled: boolean; label: string; onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial }, [partial])
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled}
    aria-label={label} aria-checked={partial ? 'mixed' : checked} onChange={onChange} />
}

/** Shared presentation/queue; adapters own authenticated reads and confirmed snapshots. */
export default function CampaignTypeVisibilitySettings(props: CampaignTypeVisibilitySettingsProps) {
  const [data, setData] = useState<CampaignTypeVisibilityResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [, renderPending] = useState(0)
  const pending = useRef(new Map<string, boolean>())
  const inFlight = useRef(new Map<string, boolean>())
  const generation = useRef(0)
  const readController = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const failed = useRef(false)
  const callbacks = useRef(props)
  callbacks.current = props
  const searchId = useId()

  const load = async () => {
    const request = ++generation.current
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    setLoading(true); setError('')
    try {
      const result = await callbacks.current.load(controller.signal)
      if (request !== generation.current) return
      if (!Array.isArray(result.catalog)) throw new Error('Không thể tải danh mục loại chiến dịch.')
      setData(result)
      callbacks.current.onConfirmed(result, false)
    } catch (reason) {
      if (request === generation.current) setError(reason instanceof Error ? reason.message : 'Không thể tải cài đặt.')
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    return () => {
      generation.current++
      readController.current?.abort()
      if (timer.current) clearTimeout(timer.current)
      pending.current.clear()
      callbacks.current.onBusyChange(false)
    }
  }, [])

  const flush = async () => {
    if (inFlight.current.size || !pending.current.size || failed.current) return
    const request = generation.current
    const batch = new Map(pending.current)
    pending.current.clear(); inFlight.current = batch
    setSaving(true); callbacks.current.onBusyChange(true)
    try {
      const result = await callbacks.current.save(Array.from(batch, ([actionId, visible]) => ({ actionId, visible })))
      if (request !== generation.current) return
      setData(previous => ({ ...result, catalog: previous?.catalog }))
      callbacks.current.onConfirmed(result, true)
      setSavedAt(new Date(result.updatedAt || Date.now()).toLocaleTimeString('vi-VN'))
      setError('')
    } catch (reason) {
      if (request !== generation.current) return
      for (const [id, visible] of Array.from(batch)) if (!pending.current.has(id)) pending.current.set(id, visible)
      failed.current = true
      setError(reason instanceof Error ? reason.message : 'Chưa xác nhận được kết quả lưu.')
    } finally {
      if (request === generation.current) {
        inFlight.current = new Map()
        renderPending(value => value + 1)
        if (pending.current.size && !failed.current) timer.current = setTimeout(() => { void flush() }, 0)
        else { setSaving(false); callbacks.current.onBusyChange(false) }
      }
    }
  }
  const setMany = (ids: string[], visible: boolean) => {
    if (!data?.canEdit || loading || !ids.length) return
    for (const id of ids) pending.current.set(id, visible)
    renderPending(value => value + 1)
    setSavedAt('')
    if (failed.current) return
    setSaving(true); callbacks.current.onBusyChange(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 300)
  }
  const visible = (id: string) => pending.current.get(id) ?? inFlight.current.get(id) ?? !data?.hiddenActionIds.includes(id)
  const groups = PLATFORMS.map(platform => {
    const items = data?.catalog?.filter(item => item.platform === platform.id) || []
    const count = items.filter(item => visible(item.id)).length
    return { ...platform, items, count, full: items.length > 0 && count === items.length, partial: count > 0 && count < items.length }
  }).filter(group => group.items.length > 0)
  const q = normalize(query.trim())
  const disabled = loading || !data?.canEdit
  const toggleGroup = (group: typeof groups[number]) => setMany(group.items.map(item => item.id), !group.full)

  return <div className="campaign-type-visibility">
    <div className="ctv-heading">
      <div><h3>Hiển thị loại chiến dịch</h3>
        <p>Chọn loại chiến dịch hiện trong danh sách chiến dịch và form thêm chiến dịch. Áp dụng cho toàn tổ chức <strong>{props.organizationName}</strong>. Mặc định hiện tất cả theo loại tài khoản.</p>
      </div>
      <span className={`ctv-save-state ${saving ? 'is-saving' : savedAt && !error ? 'is-saved' : ''}`} role="status" aria-live="polite">
        {saving ? <LoaderCircle size={13} className="ctv-spinner" /> : <Check size={13} />}
        {saving ? 'Đang lưu…' : error && data ? 'Chưa lưu' : savedAt ? `Đã tự lưu lúc ${savedAt}` : 'Tự lưu khi tích chọn'}
      </span>
    </div>
    {loading && <p role="status">Đang tải cài đặt hiển thị…</p>}
    {error && <div className="ctv-error" role="alert"><span>{error}</span>
      <button type="button" disabled={saving || loading} onClick={() => {
        if (!data) void load()
        else { failed.current = false; setError(''); void flush() }
      }}>Thử lại</button>
    </div>}
    {data && <>
      {!data.canEdit && <p className="ctv-readonly">Chỉ quản trị tổ chức được thay đổi cài đặt. Bạn có thể xem cấu hình hiện tại.</p>}
      <section className="ctv-platform-section" aria-label="Loại tài khoản hiển thị">
        <div className="ctv-section-label"><strong>Loại tài khoản hiển thị</strong><span>Bỏ chọn để ẩn toàn bộ chiến dịch của loại đó</span></div>
        <div className="ctv-platforms">
          {groups.map(group => <label key={group.id} className={`ctv-platform ${group.count ? 'is-on' : 'is-off'}`}>
            <VisibilityCheckbox label={`Hiển thị tất cả ${group.label}`} checked={group.full} partial={group.partial} disabled={disabled} onChange={() => toggleGroup(group)} />
            <span className="ctv-dot" style={{ background: group.color }} />
            <span><strong>{group.label}</strong><small>{!group.count ? 'Đang ẩn' : group.full ? `Hiện tất cả ${group.items.length} loại` : `Hiện ${group.count}/${group.items.length} loại`}</small></span>
          </label>)}
        </div>
        {!groups.length && <p>Không có loại chiến dịch được cấp cho tài khoản này.</p>}
      </section>
      <section className="ctv-catalog" aria-label="Loại chiến dịch theo tài khoản">
        <div className="ctv-toolbar">
          <strong>Loại chiến dịch theo tài khoản</strong>
          <label className="ctv-search" htmlFor={searchId}><Search size={14} />
            <input id={searchId} aria-label="Tìm loại chiến dịch" placeholder="Tìm loại chiến dịch" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          <button type="button" className="ctv-reset" disabled={disabled || !groups.length}
            onClick={() => setMany(groups.flatMap(group => group.items.map(item => item.id)), true)}>
            <RotateCcw size={13} />Hiện tất cả
          </button>
        </div>
        {groups.map(group => {
          const closed = !!collapsed[group.id]
          const matches = group.items.filter(item => !q || normalize(item.name).includes(q) || item.id.includes(q))
          return <div className="ctv-group" key={group.id}>
            <div className="ctv-group-heading">
              <label><VisibilityCheckbox label={`Nhóm ${group.label}`} checked={group.full} partial={group.partial} disabled={disabled} onChange={() => toggleGroup(group)} />
                <span className="ctv-dot" style={{ background: group.color }} /><strong>{group.label}</strong>
              </label>
              <span>{group.count}/{group.items.length} hiển thị</span>
              <button type="button" aria-label={`${closed ? 'Mở rộng' : 'Thu gọn'} ${group.label}`} aria-expanded={!closed}
                onClick={() => setCollapsed(previous => ({ ...previous, [group.id]: !closed }))}>
                <ChevronDown size={15} style={{ transform: closed ? 'rotate(-90deg)' : undefined }} />
              </button>
            </div>
            {!closed && (!group.count && !q
              ? <p className="ctv-hidden">Đang ẩn toàn bộ loại chiến dịch {group.label}. Tích ô {group.label} để hiện lại.</p>
              : <div className="ctv-items">{matches.map(item => {
                const on = visible(item.id)
                return <label key={item.id} className={`ctv-item ${on ? '' : 'is-off'}`}>
                  <VisibilityCheckbox label={`Hiển thị ${item.name}`} checked={on} disabled={disabled} onChange={() => setMany([item.id], !on)} />
                  <span className="ctv-item-text"><strong>{item.name.replace(/^(Zalo|Facebook|SMS|Email)\s*-\s*/i, '')}</strong><code>{item.id}</code></span>
                  {item.campaignCount > 0 && <span className="ctv-count" title={`${item.campaignCount} chiến dịch hiện có của bạn${on ? '' : ' — đang ẩn khỏi danh sách'}`}>{item.campaignCount} CD</span>}
                </label>
              })}{!matches.length && <p className="ctv-no-match">Không có loại chiến dịch khớp “{query}”</p>}</div>)}
          </div>
        })}
        <div className="ctv-footnote"><Info size={14} /><span>Ẩn một loại chỉ ảnh hưởng tới hiển thị. Chiến dịch đã tạo thuộc loại bị ẩn vẫn chạy theo lịch; nhãn <strong>CD</strong> là số chiến dịch hiện có của bạn thuộc loại đó.</span></div>
      </section>
    </>}
  </div>
}
