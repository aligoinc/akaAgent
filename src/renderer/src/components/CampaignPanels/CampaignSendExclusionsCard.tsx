/**
 * Thẻ "Không gửi cho" (V654, thiết kế https://claude.ai/artifact/UztLQqYHAPrd4zwJxiG5tB): một danh sách dòng loại trừ đọc như câu —
 * chiến dịch đã gửi, Nhóm data, nhóm điều kiện theo nhiều Zalo, danh sách bạn bè/Zalo ID của mọi Zalo. Khách thuộc 1 dòng bất kỳ
 * thì không gửi. Mặc định một lựa chọn dùng cho mọi Zalo gửi của chiến dịch; "Đặt riêng cho từng Zalo gửi" mở chế độ cũ.
 * Chỉ hiện khi công tắc campaign.send_exclusion_multi_zalo bật cho tài khoản; tắt thì form dùng CampaignSendExclusions (cũ).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Check, ListChecks, LockKeyhole, Plus, RefreshCw, Search, Send, SlidersHorizontal, Users, X } from 'lucide-react'
import CampaignExclusionAi from './CampaignExclusionAi'
import { PENDING_BLOCKLIST_MESSAGE } from '../../../../shared/campaignSendExclusionDraft'
import { validateExclusionAiPatch, type ExclusionAiPatch } from '../../../../shared/campaignExclusionAi'
import {
  validateExclusionGroup, type ExclusionRule, type FilterField, type FilterOption, type SendExclusionSelection, type SendExclusionsByAccount
} from '../../../../shared/campaignSendExclusion'
import {
  FRIEND_STATUS_CHOICES, SEND_EXCLUSION_MULTI_LIMITS, SEND_EXCLUSION_PREVIEW_MAX_TARGETS, applySelection, describeBlock, describeSendExclusionPreview,
  mergeSendExclusionPreview, normalizeSelection, selectionOf, selectionsShared, type SendExclusionPreview,
  type SaveSendExclusionGroupV2, type SendExclusionCampaignInfo, type SendExclusionDataGroupInfo, type SendExclusionGroupV2, type SendExclusionV2Page
} from '../../../../shared/campaignSendExclusionMulti'
import './CampaignSendExclusions.css'
import './CampaignSendExclusionsCard.css'

type Props = {
  /** Zalo gửi tin của chiến dịch (chính + phụ). */
  accounts: Array<{ id: number; name: string }>
  value: SendExclusionsByAccount
  onChange: (value: SendExclusionsByAccount) => void
  onEditing: (editing: boolean) => void
  campaignId?: number | null
  /** V657: data chưa lưu của form (SĐT / UID) để xem trước khi chiến dịch chưa có id. */
  previewTargets?: Array<{ phone?: string | null; uid?: string | null }>
  refreshKey?: number
  onManage?: () => void
  pendingBlocklistAccountId?: number | null
  onResolvePendingBlocklist?: () => void
  ai?: {
    available: boolean; actionId: string; enableMessage: boolean; authScope: string
    disabled: boolean; zIndex: number; onBusyChange: (busy: boolean) => void
  }
  /** Form Agent: bản nháp điều kiện do Agent đề xuất cho một Zalo, mở thẳng trình sửa nhóm. */
  agentDraft?: { id: string; accountId: number; patch: ExclusionAiPatch }
  onAgentAsk?: () => void
  onAgentDraftClosed?: () => void
}
type Dialog = null | { kind: 'campaigns' } | { kind: 'dataGroups' } | { kind: 'blocklists' } | { kind: 'groups' } | { kind: 'editor'; draft: SaveSendExclusionGroupV2 }
/** Kiểm trước khi lưu chiến dịch (một lượt đọc cho mọi Zalo gửi); Nhóm data / chiến dịch đã gửi do trigger lưu chiến dịch kiểm. */
export async function verifySendExclusionsBeforeSave(accountIds: number[], value: SendExclusionsByAccount): Promise<void> {
  const selections = accountIds.map(id => selectionOf(value, id)).filter(s => s.groupId || s.blocklistIds.length)
  if (!selections.length) return
  const page = await window.electronAPI.getSendExclusionV2Page()
  for (const selection of selections) {
    if (selection.groupId) {
      const group = page.groups.find(g => g.id === selection.groupId)
      if (!group) throw new Error('Nhóm điều kiện loại trừ không còn tồn tại. Hãy chọn lại.')
      for (const block of group.blocks.filter(b => !b.accountDeleted)) validateExclusionGroup(page.catalog, { name: group.name, matchMode: block.matchMode, rules: block.rules })
    }
    if (selection.blocklistIds.some(listId => !page.blocklists.some(list => list.id === listId))) throw new Error('Danh sách loại trừ không còn tồn tại. Hãy chọn lại.')
  }
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Không thể tải dữ liệu. Vui lòng thử lại.'
const vn = (n: number) => n.toLocaleString('vi-VN')

function Modal({ title, subtitle, onClose, children, footer, busy, wide }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer: ReactNode; busy?: boolean; wide?: boolean
}) {
  const titleId = useId(), dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('input, select, button:not(.exclusion-close)')?.focus()
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); if (!busy) onClose() }
      if (event.key !== 'Tab') return
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handle, true)
    return () => { document.removeEventListener('keydown', handle, true); previous?.focus() }
  }, [busy])
  return createPortal(<div className="exclusion-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <div className={`exclusion-modal${wide ? ' sx-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
      <header className="exclusion-header"><div className="exclusion-heading-copy"><h3 id={titleId}>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className="exclusion-close" disabled={busy} aria-label="Đóng" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="exclusion-modal-body">{children}</div>
      <footer>{footer}</footer>
    </div>
  </div>, document.body)
}

function Row({ icon, title, children, onEdit, onRemove, removeLabel }: { icon: ReactNode; title: string; children?: ReactNode; onEdit?: () => void; onRemove?: () => void; removeLabel: string }) {
  return <div className="sx-row">
    <span className="sx-row-icon" aria-hidden="true">{icon}</span>
    <div className="sx-row-body"><span className="sx-row-title">{title}</span>{children}</div>
    <span className="sx-row-actions">
      {onEdit && <button type="button" className="sx-text-button" onClick={onEdit}>Sửa</button>}
      {onRemove && <button type="button" className="sx-icon-button" aria-label={removeLabel} onClick={onRemove}><X size={15} /></button>}
    </span>
  </div>
}

/** Chọn nhiều mục từ danh sách có tìm kiếm (chiến dịch / Nhóm data). */
function ListPicker<T extends { id: number; name: string }>({ title, subtitle, initial, max, load, describe, right, filters, onDone, onClose, emptyText }: {
  title: string; subtitle: string; initial: number[]; max: number
  load: (query: string) => Promise<T[]>; describe: (item: T) => string; right: (item: T) => string
  filters?: Array<{ label: string; test: (item: T) => boolean }>
  onDone: (ids: number[], items: T[]) => void; onClose: () => void; emptyText: string
}) {
  const [query, setQuery] = useState(''), [items, setItems] = useState<T[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [picked, setPicked] = useState<number[]>(initial), [filter, setFilter] = useState(0), [known, setKnown] = useState<Map<number, T>>(new Map())
  const request = useRef(0)
  useEffect(() => {
    const id = ++request.current
    const timer = setTimeout(() => {
      setLoading(true); setError('')
      load(query.trim()).then(rows => {
        if (id !== request.current) return
        setItems(rows); setKnown(old => { const next = new Map(old); rows.forEach(row => next.set(row.id, row)); return next })
      }).catch(e => { if (id === request.current) setError(message(e)) }).finally(() => { if (id === request.current) setLoading(false) })
    }, query ? 300 : 0)
    return () => clearTimeout(timer)
  }, [query])
  const visible = items.filter(item => !filters || filters[filter].test(item))
  const total = picked.reduce((sum, id) => sum + Number((known.get(id) as { count?: number; sentCount?: number } | undefined)?.sentCount ?? (known.get(id) as { count?: number } | undefined)?.count ?? 0), 0)
  return <Modal title={title} subtitle={subtitle} onClose={onClose} wide footer={<>
    <span className="exclusion-footnote"><b>Đã chọn {picked.length}</b>{picked.length > 0 && ` · ${vn(total)}`}{picked.length >= max && ` (tối đa ${max})`}</span>
    <button type="button" onClick={onClose}>Hủy</button>
    <button type="button" className="exclusion-primary" onClick={() => onDone(picked, picked.map(id => known.get(id)).filter((item): item is T => !!item))}>Xong</button>
  </>}>
    <div className="sx-picker-tools">
      <label className="sx-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label="Tìm theo tên" placeholder="Tìm theo tên" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {filters && <div className="sx-chips" role="group" aria-label="Lọc">{filters.map((f, index) => <button type="button" key={f.label} aria-pressed={filter === index} onClick={() => setFilter(index)}>{f.label}</button>)}</div>}
    </div>
    {error && <div className="exclusion-error" role="alert">{error}</div>}
    <div className="sx-pick-list">
      {visible.map(item => <label className={`sx-pick ${picked.includes(item.id) ? 'selected' : ''}`} key={item.id}>
        <input className="exclusion-checkbox" type="checkbox" checked={picked.includes(item.id)} disabled={!picked.includes(item.id) && picked.length >= max}
          onChange={e => setPicked(e.target.checked ? [...picked, item.id] : picked.filter(id => id !== item.id))} />
        <span className="exclusion-picker-copy"><span>{item.name}</span><small>{describe(item)}</small></span>
        <span className="sx-pick-right">{right(item)}</span>
      </label>)}
      {!visible.length && <p className="exclusion-menu-empty">{loading ? 'Đang tải…' : emptyText}</p>}
    </div>
  </Modal>
}

function newRule(catalog: SendExclusionV2Page['catalog'], field: FilterField): ExclusionRule {
  const mappings = catalog.fieldOperators.filter(m => m.fieldId === field.id && catalog.operators.some(o => o.id === m.operatorId && o.isActive))
  const pick = (code: string) => mappings.find(m => catalog.operators.find(o => o.id === m.operatorId)?.code === code) ?? mappings[0]
  const mapping = field.sourceKey === 'zalo_friendship' ? pick('equals') : field.sourceKey === 'campaign_delivery' ? pick('within_days') : pick('contains')
  return {
    fieldId: field.id, operatorId: mapping?.operatorId ?? 0, isEnabled: true, sortOrder: field.sortOrder,
    value: field.sourceKey === 'zalo_friendship' ? 'friend' : mapping?.valueType === 'number' ? 30 : []
  }
}

/** Nhóm điều kiện theo Zalo: bước 1 chọn Zalo, bước 2 điều kiện của từng Zalo viết thành câu. */
function GroupEditor({ page, draft: initial, loadOptions, options, onSaved, onClose, onSynced }: {
  page: SendExclusionV2Page; draft: SaveSendExclusionGroupV2; options: Record<number, FilterOption[] | undefined>
  loadOptions: (accountId: number, force?: boolean) => Promise<void>; onSynced: (accountId: number) => Promise<void>
  onSaved: (group: SendExclusionGroupV2) => void; onClose: () => void
}) {
  const [draft, setDraft] = useState(initial), [saving, setSaving] = useState(false), [error, setError] = useState(''), [tagPicker, setTagPicker] = useState('')
  const [addMenu, setAddMenu] = useState<number | null>(null)
  useEffect(() => {
    if (!tagPicker && addMenu === null) return
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.sx-tag-menu, .sx-add-tag, .sx-menu, .sx-add-wrap')) { setTagPicker(''); setAddMenu(null) }
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [tagPicker, addMenu])
  const { catalog } = page
  const accounts = page.accounts
  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? `Zalo #${id}`
  const liveIds = new Set(accounts.map(a => a.id))
  const deleted = draft.blocks.filter(b => !liveIds.has(b.accountId))
  const blocks = draft.blocks.filter(b => liveIds.has(b.accountId))
  useEffect(() => { for (const block of blocks) void loadOptions(block.accountId) }, [blocks.map(b => b.accountId).join()])
  const fields = catalog.fields.filter(f => f.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
  const toggleAccount = (id: number, on: boolean) => setDraft(d => ({ ...d, blocks: on ? [...d.blocks, { accountId: id, matchMode: 'and', rules: [] }] : d.blocks.filter(b => b.accountId !== id) }))
  const patchBlock = (accountId: number, patch: (block: SaveSendExclusionGroupV2['blocks'][number]) => SaveSendExclusionGroupV2['blocks'][number]) =>
    setDraft(d => ({ ...d, blocks: d.blocks.map(b => b.accountId === accountId ? patch(b) : b) }))
  const patchRule = (accountId: number, fieldId: number, patch: Partial<ExclusionRule> | null) => patchBlock(accountId, b => ({
    ...b, rules: patch === null ? b.rules.filter(r => r.fieldId !== fieldId) : b.rules.map(r => r.fieldId === fieldId ? { ...r, ...patch } : r)
  }))
  const operatorId = (code: string) => catalog.operators.find(o => o.code === code)?.id ?? 0
  const blockErrors = blocks.map(block => {
    if (!block.rules.length) return `Thêm điều kiện cho ${accountName(block.accountId)}, hoặc bỏ chọn Zalo này.`
    try { validateExclusionGroup(catalog, { name: draft.name || 'x', matchMode: block.matchMode, rules: block.rules }); return '' }
    catch (e) { return `${accountName(block.accountId)}: ${message(e)}` }
  })
  const firstError = !draft.name.trim() ? 'Nhập tên nhóm để tiếp tục.' : !blocks.length ? 'Chọn ít nhất một Zalo.' : blockErrors.find(Boolean) ?? ''
  const save = async () => {
    if (saving || firstError) return
    setSaving(true); setError('')
    try {
      const saved = await window.electronAPI.saveSendExclusionGroupV2({ ...draft, name: draft.name.trim(), blocks: blocks.map(b => ({ accountId: b.accountId, matchMode: b.matchMode, rules: b.rules })) })
      onSaved(saved)
    } catch (e) { setError(message(e)) } finally { setSaving(false) }
  }
  const copyFrom = (target: number, source: number) => {
    const from = blocks.find(b => b.accountId === source)
    if (!from) return
    const targetOptions = options[target] ?? []
    patchBlock(target, b => ({ ...b, matchMode: from.matchMode, rules: from.rules.map(rule => {
      const field = catalog.fields.find(f => f.id === rule.fieldId)
      if (field?.optionsSource !== 'zalo_labels') return { ...rule }
      // Tag Zalo khác nhau giữa các Zalo: chỉ chép tag cùng tên có ở Zalo mới.
      const names = (Array.isArray(rule.value) ? rule.value : []).map(v => (options[source] ?? []).find(o => o.fieldId === rule.fieldId && o.value === v)?.label)
      return { ...rule, value: targetOptions.filter(o => o.fieldId === rule.fieldId && names.includes(o.label)).map(o => o.value) }
    }).filter(rule => !Array.isArray(rule.value) || rule.value.length > 0 || catalog.fields.find(f => f.id === rule.fieldId)?.optionsSource !== 'zalo_labels') }))
  }
  const renderRule = (accountId: number, rule: ExclusionRule) => {
    const field = catalog.fields.find(f => f.id === rule.fieldId)
    const remove = <button type="button" className="sx-icon-button" aria-label={`Bỏ điều kiện ${field?.name ?? ''}`} onClick={() => patchRule(accountId, rule.fieldId, null)}><X size={14} /></button>
    if (!field) return <div className="sx-rule" key={rule.fieldId}><span className="exclusion-error">Điều kiện không còn hỗ trợ</span><span className="sx-grow" />{remove}</div>
    const operator = catalog.operators.find(o => o.id === rule.operatorId)
    if (field.sourceKey === 'zalo_friendship') {
      const index = FRIEND_STATUS_CHOICES.findIndex(([, code, value]) => code === operator?.code && value === rule.value)
      return <div className="sx-rule" key={rule.fieldId}><span>Khách</span>
        <select aria-label="Trạng thái bạn bè" value={index < 0 ? 'other' : String(index)} onChange={e => {
          const choice = FRIEND_STATUS_CHOICES[Number(e.target.value)]
          if (choice) patchRule(accountId, rule.fieldId, { operatorId: operatorId(choice[1]), value: choice[2], isEnabled: true })
        }}>
          {FRIEND_STATUS_CHOICES.map(([label], i) => <option key={label} value={i}>{label}</option>)}
          {index < 0 && <option value="other">{operator?.code === 'not_equals' ? 'không ' : ''}{String(rule.value) === 'request_received' ? 'đã gửi lời mời kết bạn cho mình' : String(rule.value)}</option>}
        </select><span className="sx-grow" />{remove}</div>
    }
    if (field.sourceKey === 'campaign_delivery') {
      return <div className="sx-rule" key={rule.fieldId}><span>Khách đã được Zalo này gửi tin trong</span>
        <input type="number" className="exclusion-number" aria-label="Số ngày" min={1} max={3650} value={String(rule.value ?? '')}
          onChange={e => patchRule(accountId, rule.fieldId, { value: e.target.value === '' ? '' : Number(e.target.value), isEnabled: true })} />
        <span>ngày gần nhất</span><span className="sx-grow" />{remove}</div>
    }
    const isTag = field.optionsSource === 'zalo_labels'
    const choices = (options[accountId] ?? []).filter(o => o.fieldId === field.id && o.isActive)
    const selected = Array.isArray(rule.value) ? rule.value : []
    const key = `${accountId}:${field.id}`
    return <div className="sx-rule sx-rule-wrap" key={rule.fieldId}><span>Khách</span>
      <select aria-label={`Có hoặc không có ${field.name}`} value={operator?.evaluatorKey === 'contains_none' ? 'none' : 'any'}
        onChange={e => patchRule(accountId, rule.fieldId, { operatorId: operatorId(e.target.value === 'none' ? 'not_contains' : 'contains'), isEnabled: true })}>
        <option value="any">có {isTag ? 'tag Zalo' : 'tag akaBiz'}</option><option value="none">không có {isTag ? 'tag Zalo' : 'tag akaBiz'}</option>
      </select>
      {selected.map(v => { const label = choices.find(o => o.value === v)?.label
        return <span className={`sx-tag ${label ? '' : 'missing'}`} key={String(v)}>{label ?? `${String(v)} (không còn tồn tại)`}
          <button type="button" aria-label={`Bỏ ${label ?? String(v)}`} onClick={() => patchRule(accountId, rule.fieldId, { value: selected.filter(x => x !== v) })}><X size={11} /></button></span> })}
      <button type="button" className="sx-add-tag" aria-expanded={tagPicker === key} onClick={() => setTagPicker(tagPicker === key ? '' : key)}>Chọn tag</button>
      <span className="sx-grow" />{remove}
      {tagPicker === key && <div className="sx-tag-menu">
        {choices.map(o => <label key={String(o.value)}><input className="exclusion-checkbox" type="checkbox" checked={selected.includes(o.value)}
          onChange={e => patchRule(accountId, rule.fieldId, { value: e.target.checked ? [...selected, o.value] : selected.filter(x => x !== o.value), isEnabled: true })} />{o.label}</label>)}
        {!choices.length && <small>{options[accountId] ? 'Zalo này chưa có tag.' : 'Đang tải tag…'}</small>}
        {isTag && <button type="button" className="sx-text-button" onClick={() => void onSynced(accountId)}><RefreshCw size={12} />Đồng bộ tag</button>}
      </div>}
    </div>
  }
  const ctx = (accountId: number) => ({ catalog, options: options[accountId] ?? [] })
  return <Modal title={draft.id ? 'Sửa nhóm điều kiện' : 'Khách theo điều kiện ở Zalo'} onClose={onClose} busy={saving} wide footer={<>
    <span className={`exclusion-footnote ${firstError ? 'invalid' : ''}`}>{firstError || 'Nhóm đã sẵn sàng để lưu.'}</span>
    <button type="button" disabled={saving} onClick={onClose}>Hủy</button>
    <button type="button" className="exclusion-primary" disabled={saving || !!firstError} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Lưu và dùng'}</button>
  </>}>
    <fieldset disabled={saving} className="sx-editor">
      <label className="sx-field"><span>Tên nhóm</span>
        <input aria-label="Tên nhóm" value={draft.name} maxLength={200} placeholder="Ví dụ: Khách đã chăm sóc" onChange={e => setDraft({ ...draft, name: e.target.value })} />
        <small>Lưu lại để dùng ở chiến dịch khác.</small></label>
      <div className="sx-step"><span className="sx-step-num">1</span><strong>Xét khách ở những Zalo nào?</strong></div>
      <div className="sx-account-grid">{accounts.map(account => {
        const on = draft.blocks.some(b => b.accountId === account.id)
        return <label key={account.id} className={`sx-account ${on ? 'selected' : ''}`}>
          <input className="exclusion-checkbox" type="checkbox" checked={on} disabled={!on && blocks.length >= SEND_EXCLUSION_MULTI_LIMITS.accounts} onChange={e => toggleAccount(account.id, e.target.checked)} />
          <span className="exclusion-picker-copy"><span>{account.name}</span>
            <small>{!account.synced ? 'Chưa đồng bộ bạn bè' : account.syncedAt ? `Đồng bộ ${new Date(account.syncedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : 'Đã có dữ liệu'}</small></span>
        </label>
      })}</div>
      {deleted.length > 0 && <p className="sx-warning">{deleted.map(b => b.accountName || `Zalo #${b.accountId}`).join(', ')} đã bị xoá nên điều kiện của Zalo này không còn được xét và sẽ bỏ khi lưu.</p>}
      <div className="sx-step"><span className="sx-step-num">2</span><strong>Điều kiện ở từng Zalo</strong></div>
      {!blocks.length && <p className="exclusion-helper">Chọn Zalo ở bước 1.</p>}
      {blocks.map((block, index) => {
        const used = new Set(block.rules.map(r => r.fieldId))
        const free = fields.filter(f => !used.has(f.id))
        const account = accounts.find(a => a.id === block.accountId)
        return <div key={block.accountId}>
          {index > 0 && <p className="sx-or">hoặc</p>}
          <section className="sx-block" aria-label={`Điều kiện ở ${accountName(block.accountId)}`}>
            <header><strong>{accountName(block.accountId)}</strong>
              {block.rules.length > 1 && <label className="sx-mode">Khách thỏa<select aria-label={`Cách kết hợp ở ${accountName(block.accountId)}`} value={block.matchMode}
                onChange={e => patchBlock(block.accountId, b => ({ ...b, matchMode: e.target.value as 'and' | 'or' }))}>
                <option value="and">tất cả điều kiện</option><option value="or">1 điều kiện bất kỳ</option></select></label>}
            </header>
            <div className="sx-block-body">
              {account && !account.synced && <p className="sx-warning">Zalo này chưa đồng bộ bạn bè nên khi gửi bằng Zalo khác, điều kiện của Zalo này chưa xét được.</p>}
              {block.rules.map(rule => renderRule(block.accountId, rule))}
              {!block.rules.length && blocks.some(b => b.accountId !== block.accountId && b.rules.length) && (() => {
                const source = blocks.find(b => b.accountId !== block.accountId && b.rules.length)!
                return <button type="button" className="sx-text-button" onClick={() => copyFrom(block.accountId, source.accountId)}>Chép điều kiện từ {accountName(source.accountId)}</button>
              })()}
              {free.length > 0 && <div className="sx-add-wrap">
                <button type="button" className="sx-text-button" aria-haspopup="menu" aria-expanded={addMenu === block.accountId} onClick={() => setAddMenu(addMenu === block.accountId ? null : block.accountId)}><Plus size={13} />Thêm điều kiện</button>
                {addMenu === block.accountId && <div className="sx-menu" role="menu">{free.map(field => <button type="button" role="menuitem" key={field.id} onClick={() => {
                  patchBlock(block.accountId, b => ({ ...b, rules: [...b.rules, newRule(catalog, field)] })); setAddMenu(null)
                }}>{field.sourceKey === 'campaign_delivery' ? 'Đã được gửi tin trong … ngày' : field.name}</button>)}</div>}
              </div>}
              {blockErrors[index] && block.rules.length > 0 && <p className="exclusion-error">{blockErrors[index]}</p>}
            </div>
          </section>
        </div>
      })}
      {blocks.some(b => b.rules.length) && <div className="sx-summary"><strong>Sẽ không gửi cho khách:</strong>
        {blocks.filter(b => b.rules.length).map((b, i) => <span key={b.accountId}>• {i > 0 ? 'hoặc ' : ''}{describeBlock(ctx(b.accountId), b)} ở {accountName(b.accountId)}</span>)}
      </div>}
    </fieldset>
    {error && <div role="alert" className="exclusion-error">{error}</div>}
  </Modal>
}

/** V657: xem trước số data sẽ không được gửi theo danh sách / Nhóm data / chiến dịch (cùng hàm so khớp của bộ chạy, chỉ đọc). */
function SendExclusionPreviewLine({ accountId, selection, campaignId, targets }: {
  accountId: number; selection: SendExclusionSelection; campaignId?: number | null; targets?: Array<{ phone?: string | null; uid?: string | null }>
}) {
  const lists = selection.blocklistIds.length > 0 || !!selection.dataGroupIds?.length || !!selection.sentCampaignIds?.length
  const limited = useMemo(() => (targets ?? []).slice(0, SEND_EXCLUSION_PREVIEW_MAX_TARGETS)
    .map(t => ({ phone: t.phone ? String(t.phone).slice(0, 40) : null, uid: t.uid ? String(t.uid).slice(0, 64) : null }))
    .filter(t => t.phone || t.uid), [targets])
  const usable = lists && (!!campaignId || limited.length > 0)
  const key = JSON.stringify([accountId, normalizeSelection(selection), campaignId ?? null, campaignId ? null : limited])
  const [state, setState] = useState<{ preview: SendExclusionPreview | null; busy: boolean; error: string }>({ preview: null, busy: false, error: '' })
  const keyRef = useRef(key)
  const run = (afterId: number | null, base: SendExclusionPreview | null) => {
    const runKey = keyRef.current
    setState(s => ({ ...s, busy: true, error: '' }))
    window.electronAPI.getSendExclusionV2Preview({ accountId, selection: normalizeSelection(selection), campaignId: campaignId ?? null,
      targets: campaignId ? undefined : limited, afterId, limit: 200 })
      .then(page => { if (keyRef.current === runKey) setState({ preview: mergeSendExclusionPreview(base, page), busy: false, error: '' }) })
      .catch(e => { if (keyRef.current === runKey) setState(s => ({ ...s, busy: false, error: message(e) })) })
  }
  useEffect(() => {
    keyRef.current = key
    setState({ preview: null, busy: false, error: '' })
    if (!usable) return
    const timer = setTimeout(() => run(null, null), 600)
    return () => clearTimeout(timer)
  }, [key, usable])
  if (!usable) return null
  const { preview, busy, error } = state
  const partial = !!preview?.nextAfterId || (!campaignId && (targets?.length ?? 0) > limited.length)
  return <div className="sx-preview" aria-live="polite">
    <span className="sx-muted">Xem trước:</span>{' '}
    {error ? <span className="exclusion-error-inline">{error}</span> : preview ? describeSendExclusionPreview(preview, partial) : busy ? 'Đang đếm…' : ''}
    {preview?.nextAfterId && !busy && <> <button type="button" className="exclusion-link" onClick={() => run(preview.nextAfterId, preview)}>Đếm tiếp</button></>}
    {error && <> <button type="button" className="exclusion-link" onClick={() => run(null, null)}>Thử lại</button></>}
  </div>
}

export default function CampaignSendExclusionsCard({ accounts, value, onChange, onEditing, campaignId, previewTargets, refreshKey, onManage, pendingBlocklistAccountId, onResolvePendingBlocklist, ai, agentDraft, onAgentAsk, onAgentDraftClosed }: Props) {
  const accountIds = accounts.map(a => a.id)
  const [separate, setSeparate] = useState(() => accountIds.length > 1 && !selectionsShared(value, accountIds))
  const [editingAccount, setEditingAccount] = useState(accountIds[0])
  const current = separate && accountIds.includes(editingAccount ?? -1) ? editingAccount! : accountIds[0]
  const selection = current ? selectionOf(value, current) : { groupId: null, blocklistIds: [] }
  const [page, setPage] = useState<SendExclusionV2Page | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0)
  const [options, setOptions] = useState<Record<number, FilterOption[] | undefined>>({})
  const [dataGroups, setDataGroups] = useState<Map<number, SendExclusionDataGroupInfo>>(new Map())
  const [campaigns, setCampaigns] = useState<Map<number, SendExclusionCampaignInfo>>(new Map())
  const [dialog, setDialog] = useState<Dialog>(null), [menu, setMenu] = useState(false)
  const optionsLoading = useRef(new Set<number>())
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    window.electronAPI.getSendExclusionV2Page().then(data => { if (alive) setPage(data) })
      .catch(e => { if (alive) setError(message(e)) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [reload, refreshKey])
  useEffect(() => { onEditing(!!dialog); return () => onEditing(false) }, [!!dialog])
  // Chế độ dùng chung: Zalo gửi mới thêm vào chiến dịch nhận cùng lựa chọn.
  useEffect(() => {
    if (!separate && accountIds.length > 1 && !selectionsShared(value, accountIds)) onChange(applySelection(value, accountIds, selectionOf(value, accountIds[0])))
  }, [accountIds.join(), separate])
  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menu])
  const dataGroupIds = selection.dataGroupIds ?? [], sentCampaignIds = selection.sentCampaignIds ?? []
  // Tên / số của Nhóm data và chiến dịch đã chọn (một lượt mỗi lần lựa chọn đổi).
  useEffect(() => {
    const missingGroups = dataGroupIds.filter(id => !dataGroups.has(id)), missingCampaigns = sentCampaignIds.filter(id => !campaigns.has(id))
    if (!missingGroups.length && !missingCampaigns.length) return
    let alive = true
    window.electronAPI.getSendExclusionV2Lists({ kind: missingGroups.length && missingCampaigns.length ? 'all' : missingGroups.length ? 'dataGroups' : 'campaigns',
      dataGroupIds: missingGroups, sentCampaignIds: missingCampaigns, excludeCampaignId: campaignId ?? undefined }).then(lists => {
      if (!alive) return
      if (lists.dataGroups) setDataGroups(old => { const next = new Map(old); lists.dataGroups!.forEach(g => next.set(g.id, g)); return next })
      if (lists.campaigns) setCampaigns(old => { const next = new Map(old); lists.campaigns!.forEach(c => next.set(c.id, c)); return next })
    }).catch(() => { /* Thẻ vẫn hiện mã; lưu chiến dịch DB kiểm lại. */ })
    return () => { alive = false }
  }, [dataGroupIds.join(), sentCampaignIds.join()])
  const loadOptions = async (accountId: number, force = false) => {
    if (!force && (options[accountId] || optionsLoading.current.has(accountId))) return
    optionsLoading.current.add(accountId)
    try { const data = await window.electronAPI.getSendExclusionV2Options(accountId); setOptions(old => ({ ...old, [accountId]: data.options })) }
    catch { /* Hiện mã tag; mở lại form để thử lại. */ } finally { optionsLoading.current.delete(accountId) }
  }
  const group = page?.groups.find(g => g.id === selection.groupId) ?? null
  useEffect(() => { for (const block of group?.blocks ?? []) void loadOptions(block.accountId) }, [group?.id, group?.revision])
  const update = (patch: Partial<SendExclusionSelection>) => {
    const next = normalizeSelection({ ...selection, ...patch })
    onChange(separate ? { ...value, [String(current)]: next } : applySelection(value, accountIds, next))
    if (patch.blocklistIds?.length && pendingBlocklistAccountId !== undefined && pendingBlocklistAccountId !== null) onResolvePendingBlocklist?.()
  }
  const accountName = (id: number) => page?.accounts.find(a => a.id === id)?.name ?? accounts.find(a => a.id === id)?.name ?? `Zalo #${id}`
  const openEditor = (existing?: SendExclusionGroupV2 | null) => {
    setDialog({ kind: 'editor', draft: existing
      ? { id: existing.id, name: existing.name, revision: existing.revision, blocks: existing.blocks.map(b => ({ accountId: b.accountId, accountName: b.accountName, matchMode: b.matchMode, rules: structuredClone(b.rules) })) }
      : { requestId: crypto.randomUUID(), name: '', revision: 0, blocks: current ? [{ accountId: current, matchMode: 'and', rules: [] }] : [] } })
  }
  // Bản nháp của Agent: chờ có danh mục + tag của Zalo đó rồi mở trình sửa nhóm một lần.
  const appliedAgentDraft = useRef('')
  const closeDialog = () => {
    setDialog(null)
    if (appliedAgentDraft.current) { appliedAgentDraft.current = ''; onAgentDraftClosed?.() }
  }
  useEffect(() => { if (!agentDraft && appliedAgentDraft.current) { appliedAgentDraft.current = ''; setDialog(null) } }, [agentDraft])
  useEffect(() => {
    if (!agentDraft || appliedAgentDraft.current === agentDraft.id || !page) return
    if (!options[agentDraft.accountId]) { void loadOptions(agentDraft.accountId); return }
    try {
      const checked = validateExclusionAiPatch(agentDraft.patch, { catalog: page.catalog, options: options[agentDraft.accountId] ?? [], groups: [], blocklists: [] })
      appliedAgentDraft.current = agentDraft.id
      setDialog({ kind: 'editor', draft: { requestId: crypto.randomUUID(), name: checked.name, revision: 0, blocks: [{ accountId: agentDraft.accountId, matchMode: checked.matchMode, rules: checked.rules }] } })
    } catch (e) { setError(message(e)); onAgentDraftClosed?.() }
  }, [agentDraft, page, options])
  const blocklists = page?.blocklists ?? []
  const hasAny = !!selection.groupId || selection.blocklistIds.length > 0 || dataGroupIds.length > 0 || sentCampaignIds.length > 0
  const menuItems: Array<{ key: string; title: string; hint: string; disabled: boolean; onClick: () => void }> = [
    { key: 'campaigns', title: 'Khách đã được gửi tin ở chiến dịch', hint: 'Chọn 1 hoặc nhiều chiến dịch. Ví dụ: không gửi lại cho khách đã nhận tin khuyến mãi tháng trước.', disabled: sentCampaignIds.length > 0, onClick: () => setDialog({ kind: 'campaigns' }) },
    { key: 'dataGroups', title: 'Khách có trong Nhóm data', hint: 'Ví dụ: nhóm khách đã mua, nhóm khách nội bộ.', disabled: dataGroupIds.length > 0, onClick: () => setDialog({ kind: 'dataGroups' }) },
    { key: 'group', title: 'Khách theo điều kiện ở Zalo', hint: 'Ví dụ: đã là bạn bè, có tag "Đã mua" ở 1 trong các Zalo của bạn.', disabled: !!selection.groupId, onClick: () => page?.groups.length ? setDialog({ kind: 'groups' }) : openEditor() },
    { key: 'blocklists', title: 'Khách trong danh sách bạn bè/Zalo ID', hint: 'Danh sách bạn bè hoặc Zalo ID bạn đã lưu.', disabled: selection.blocklistIds.length > 0, onClick: () => setDialog({ kind: 'blocklists' }) }
  ]
  const chip = (key: number | string, label: string, meta?: string, missing?: boolean) =>
    <span className={`sx-chip ${missing ? 'missing' : ''}`} key={key}>{label}{meta && <span> · {meta}</span>}</span>
  const pseudoPage = (accountId: number) => page ? { catalog: page.catalog, options: options[accountId] ?? [], groups: [], blocklists: [] } : null
  return <section className="send-exclusions sx-card" aria-label="Không gửi cho">
    <header className="exclusion-header"><span className="exclusion-icon"><Ban size={15} /></span>
      <div className="exclusion-heading-copy">
        <div className="exclusion-title-row"><strong>Không gửi cho</strong>
          {onAgentAsk && <button type="button" className="agent-ask-section" onClick={onAgentAsk} disabled={ai?.disabled || accounts.length !== 1}>Hỏi Agent</button>}
          {ai?.available && current && <CampaignExclusionAi
            context={{ actionId: ai.actionId, accountId: current, enableMessage: ai.enableMessage }}
            authScope={`${ai.authScope}:${refreshKey}:${current}:${JSON.stringify([page?.catalog, options[current]])}`}
            disabled={ai.disabled || !!dialog || loading || !page || !options[current]}
            zIndex={ai.zIndex} onBusyChange={ai.onBusyChange}
            onApply={patch => {
              const p = pseudoPage(current)
              if (!p || dialog) throw new Error('Tài khoản đã thay đổi.')
              const checked = validateExclusionAiPatch(patch, p)
              setDialog({ kind: 'editor', draft: { requestId: crypto.randomUUID(), name: checked.name, revision: 0, blocks: [{ accountId: current, matchMode: checked.matchMode, rules: checked.rules }] } })
            }} />}
        </div>
        <p>Khách thuộc 1 dòng bất kỳ dưới đây sẽ được bỏ qua.</p>
      </div>
    </header>
    {separate && accounts.length > 1 && <label className="exclusion-account-label">Zalo gửi<select aria-label="Zalo gửi" value={current} onChange={e => setEditingAccount(Number(e.target.value))}>
      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    <div className="sx-row sx-row-locked"><span className="sx-row-icon" aria-hidden="true"><LockKeyhole size={14} /></span>
      <div className="sx-row-body"><span>Khách đã từ chối nhận tin</span></div><small>Luôn áp dụng</small></div>
    {error && <div className="exclusion-error" role="alert">{error} <button type="button" className="exclusion-link" onClick={() => setReload(n => n + 1)}>Thử lại</button></div>}
    {sentCampaignIds.length > 0 && <Row icon={<Send size={14} />} title="Đã được gửi tin ở chiến dịch" removeLabel="Bỏ loại trừ theo chiến dịch"
      onEdit={() => setDialog({ kind: 'campaigns' })} onRemove={() => update({ sentCampaignIds: [] })}>
      <span className="sx-chips-line">{sentCampaignIds.map(id => { const c = campaigns.get(id)
        return chip(id, c?.name ?? `Chiến dịch #${id}`, c ? `${vn(c.sentCount)} khách${c.deleted ? ' · đã xoá' : ''}` : undefined) })}</span>
    </Row>}
    {dataGroupIds.length > 0 && <Row icon={<Users size={14} />} title="Có trong Nhóm data" removeLabel="Bỏ loại trừ theo Nhóm data"
      onEdit={() => setDialog({ kind: 'dataGroups' })} onRemove={() => update({ dataGroupIds: [] })}>
      <span className="sx-chips-line">{dataGroupIds.map(id => { const g = dataGroups.get(id)
        return chip(id, g?.name ?? `Nhóm data #${id}`, g ? (g.deleted ? 'đã xoá, không còn loại trừ' : `${vn(g.count)} data`) : undefined, g?.deleted) })}</span>
    </Row>}
    {selection.groupId && <Row icon={<SlidersHorizontal size={14} />} title={group ? `Khớp nhóm điều kiện “${group.name}”` : `Nhóm điều kiện #${selection.groupId}`}
      removeLabel="Bỏ nhóm điều kiện" onEdit={group ? () => openEditor(group) : undefined} onRemove={() => update({ groupId: null })}>
      {group && page ? <span className="sx-block-lines">{group.blocks.map(block => <span key={block.accountId} className={block.accountDeleted ? 'missing' : ''}>
        <span className="sx-muted">{block.accountName || accountName(block.accountId)}:</span> {block.accountDeleted ? 'Zalo đã bị xoá, không còn được xét' : describeBlock({ catalog: page.catalog, options: options[block.accountId] ?? [] }, block)}
      </span>)}</span> : <small>{loading ? 'Đang tải…' : 'Nhóm không còn tồn tại. Hãy chọn lại.'}</small>}
      {page && page.groups.length > 1 && <button type="button" className="sx-text-button" onClick={() => setDialog({ kind: 'groups' })}>Đổi nhóm</button>}
    </Row>}
    {selection.blocklistIds.length > 0 && <Row icon={<ListChecks size={14} />} title="Trong danh sách bạn bè/Zalo ID" removeLabel="Bỏ loại trừ theo danh sách"
      onEdit={() => setDialog({ kind: 'blocklists' })} onRemove={() => update({ blocklistIds: [] })}>
      <span className="sx-chips-line">{selection.blocklistIds.map(id => { const b = blocklists.find(l => l.id === id)
        return chip(id, b?.name ?? `Danh sách #${id}`, b ? `${b.accountName} · ${vn(b.count)}` : undefined) })}</span>
    </Row>}
    {current === pendingBlocklistAccountId && <div className="exclusion-error" role="alert">{PENDING_BLOCKLIST_MESSAGE} <button type="button" className="exclusion-link" onClick={onResolvePendingBlocklist}>Bỏ yêu cầu loại trừ danh sách</button></div>}
    {current ? <SendExclusionPreviewLine accountId={current} selection={selection} campaignId={campaignId} targets={previewTargets} /> : null}
    <div className="sx-add-wrap" ref={menuRef}>
      <button type="button" className="sx-add" aria-haspopup="menu" aria-expanded={menu} disabled={!page || !current} onClick={() => setMenu(v => !v)}><Plus size={15} />Thêm loại trừ</button>
      {menu && <div className="sx-menu sx-menu-wide" role="menu">{menuItems.map(item => <button type="button" role="menuitem" key={item.key} disabled={item.disabled}
        onClick={() => { setMenu(false); item.onClick() }}><span>{item.title}{item.disabled && <small> · đã thêm</small>}</span><small>{item.hint}</small></button>)}</div>}
    </div>
    {!hasAny && !loading && <p className="exclusion-helper">Chưa có loại trừ nào ngoài khách đã từ chối nhận tin.</p>}
    <div className="sx-footer-links">
      {accounts.length > 1 && <button type="button" className="exclusion-link" onClick={() => {
        if (separate) onChange(applySelection(value, accountIds, selectionOf(value, current ?? accountIds[0])))
        setSeparate(!separate)
      }}>{separate ? 'Dùng chung cho mọi Zalo gửi' : 'Đặt riêng cho từng Zalo gửi của chiến dịch'}</button>}
      {onManage && <button type="button" className="exclusion-link" onClick={onManage}>Quản lý danh sách</button>}
    </div>

    {dialog?.kind === 'campaigns' && <ListPicker<SendExclusionCampaignInfo> title="Không gửi cho khách đã được gửi ở chiến dịch"
      subtitle="Chọn 1 hoặc nhiều chiến dịch. Khách đã nhận tin ở chiến dịch nào trong số này sẽ không được gửi lại."
      initial={sentCampaignIds} max={SEND_EXCLUSION_MULTI_LIMITS.campaigns} emptyText="Không có chiến dịch nhắn tin Zalo nào."
      load={async query => (await window.electronAPI.getSendExclusionV2Lists({ kind: 'campaigns', query, sentCampaignIds, excludeCampaignId: campaignId ?? undefined })).campaigns ?? []}
      describe={c => [c.status, c.accountName, c.deleted ? 'đã xoá' : ''].filter(Boolean).join(' · ')}
      right={c => `Đã gửi ${vn(c.sentCount)} khách`}
      filters={[{ label: 'Tất cả', test: () => true }, { label: 'Đang chạy', test: c => c.status === 'đang chạy' }, { label: 'Hoàn thành', test: c => c.status === 'hoàn thành' }, { label: 'Tạm dừng', test: c => c.status === 'tạm dừng' }]}
      onClose={closeDialog} onDone={(ids, items) => { setCampaigns(old => { const next = new Map(old); items.forEach(i => next.set(i.id, i)); return next }); update({ sentCampaignIds: ids }); setDialog(null) }} />}
    {dialog?.kind === 'dataGroups' && <ListPicker<SendExclusionDataGroupInfo> title="Không gửi cho khách có trong Nhóm data"
      subtitle="Chọn 1 hoặc nhiều Nhóm data số điện thoại hoặc Zalo UID."
      initial={dataGroupIds} max={SEND_EXCLUSION_MULTI_LIMITS.dataGroups} emptyText="Không có Nhóm data số điện thoại hoặc Zalo UID nào."
      load={async query => (await window.electronAPI.getSendExclusionV2Lists({ kind: 'dataGroups', query, dataGroupIds })).dataGroups ?? []}
      describe={g => [g.dataType === 'phone' ? 'Số điện thoại' : 'Zalo UID', g.shared ? 'được chia sẻ cho bạn' : '', g.deleted ? 'đã xoá' : ''].filter(Boolean).join(' · ')}
      right={g => `${vn(g.count)} data`}
      filters={[{ label: 'Tất cả', test: () => true }, { label: 'Số điện thoại', test: g => g.dataType === 'phone' }, { label: 'Zalo UID', test: g => g.dataType === 'zalo_person' }]}
      onClose={closeDialog} onDone={(ids, items) => { setDataGroups(old => { const next = new Map(old); items.forEach(i => next.set(i.id, i)); return next }); update({ dataGroupIds: ids }); setDialog(null) }} />}
    {dialog?.kind === 'blocklists' && <BlocklistPicker initial={selection.blocklistIds} lists={blocklists} onClose={closeDialog}
      onDone={ids => { update({ blocklistIds: ids }); setDialog(null) }} />}
    {dialog?.kind === 'groups' && page && <GroupPicker page={page} options={options} loadOptions={loadOptions} selectedId={selection.groupId}
      onClose={closeDialog} onPick={id => { update({ groupId: id }); setDialog(null) }} onCreate={() => openEditor()} />}
    {dialog?.kind === 'editor' && page && <GroupEditor page={page} draft={dialog.draft} options={options} loadOptions={loadOptions}
      onSynced={async accountId => { await window.electronAPI.syncZaloLabels(accountId); await loadOptions(accountId, true) }}
      onClose={closeDialog} onSaved={saved => {
        setPage(p => p ? { ...p, groups: [...p.groups.filter(g => g.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)) } : p)
        update({ groupId: saved.id }); closeDialog()
      }} />}
  </section>
}

function BlocklistPicker({ initial, lists, onDone, onClose }: { initial: number[]; lists: SendExclusionV2Page['blocklists']; onDone: (ids: number[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState(initial)
  const byAccount = useMemo(() => Array.from(new Set(lists.map(l => l.accountName))), [lists])
  return <Modal title="Không gửi cho khách trong danh sách bạn bè/Zalo ID" subtitle="Chọn được danh sách của mọi Zalo của bạn." onClose={onClose} footer={<>
    <span className="exclusion-footnote"><b>Đã chọn {picked.length}</b></span>
    <button type="button" onClick={onClose}>Hủy</button><button type="button" className="exclusion-primary" onClick={() => onDone(picked)}>Xong</button>
  </>}>
    {byAccount.map(name => <div key={name} className="sx-pick-list"><p className="sx-group-label">{name}</p>
      {lists.filter(l => l.accountName === name).map(list => <label className={`sx-pick ${picked.includes(list.id) ? 'selected' : ''}`} key={list.id}>
        <input className="exclusion-checkbox" type="checkbox" checked={picked.includes(list.id)} onChange={e => setPicked(e.target.checked ? [...picked, list.id] : picked.filter(id => id !== list.id))} />
        <span className="exclusion-picker-copy"><span>{list.name}</span></span><span className="sx-pick-right">{vn(list.count)} khách</span>
      </label>)}
    </div>)}
    {!lists.length && <p className="exclusion-menu-empty">Chưa có danh sách. Tạo danh sách trong phần quản lý.</p>}
  </Modal>
}

function GroupPicker({ page, options, loadOptions, selectedId, onPick, onCreate, onClose }: {
  page: SendExclusionV2Page; options: Record<number, FilterOption[] | undefined>; loadOptions: (id: number) => Promise<void>
  selectedId: number | null; onPick: (id: number) => void; onCreate: () => void; onClose: () => void
}) {
  useEffect(() => { for (const g of page.groups) for (const b of g.blocks) void loadOptions(b.accountId) }, [])
  return <Modal title="Chọn nhóm điều kiện" subtitle="Nhóm điều kiện xét khách ở một hoặc nhiều Zalo của bạn." onClose={onClose} wide footer={<>
    <span className="exclusion-footnote" /><button type="button" onClick={onClose}>Hủy</button>
    <button type="button" className="exclusion-primary" onClick={onCreate}><Plus size={14} />Tạo nhóm mới</button>
  </>}>
    <div className="sx-pick-list">{page.groups.map(group => <button type="button" key={group.id} className={`sx-pick sx-pick-button ${selectedId === group.id ? 'selected' : ''}`} onClick={() => onPick(group.id)}>
      <span className="exclusion-picker-copy"><span>{group.name}</span>
        {group.blocks.map(block => <small key={block.accountId}>{block.accountName || `Zalo #${block.accountId}`}: {block.accountDeleted ? 'đã bị xoá' : describeBlock({ catalog: page.catalog, options: options[block.accountId] ?? [] }, block)}</small>)}</span>
      {selectedId === group.id && <Check size={15} />}
    </button>)}</div>
  </Modal>
}
