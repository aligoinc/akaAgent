import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Check, ChevronDown, Info, LockKeyhole, Plus, RefreshCw, X } from 'lucide-react'
import {
  ruleDefinition, validateExclusionGroup,
  type FilterField, type ExclusionRule, type SaveSendExclusionGroup,
  type SendExclusionPage, type SendExclusionGroup, type SendExclusionsByAccount
} from '../../../../shared/campaignSendExclusion'
import './CampaignSendExclusions.css'

type Props = {
  accounts: Array<{ id: number; name: string }>
  value: SendExclusionsByAccount
  onChange: (value: SendExclusionsByAccount) => void
  onEditing: (editing: boolean) => void
  onManage?: () => void
  refreshKey?: number
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Không thể tải dữ liệu. Vui lòng thử lại.'
const empty = { groupId: null, blocklistIds: [] }
const enabledRules = (group: SaveSendExclusionGroup) => group.rules.filter(rule => rule.isEnabled).sort((a, b) => a.sortOrder - b.sortOrder)
function ruleDescription(page: SendExclusionPage, rule: ExclusionRule): string {
  const field = page.catalog.fields.find(f => f.id === rule.fieldId)
  const operator = page.catalog.operators.find(o => o.id === rule.operatorId)
  const values = (Array.isArray(rule.value) ? rule.value : [rule.value]).map(value =>
    page.options.find(option => option.fieldId === rule.fieldId && option.value === value)?.label ?? String(value ?? '…'))
  return field?.optionsConfig.operatorPlacement === 'afterValue'
    ? `${field.name} ${values.join(', ')} ${operator?.name ?? ''}`
    : `${field?.name ?? 'Điều kiện không còn hỗ trợ'} ${operator?.name ?? ''} ${values.join(', ')}`
}
function newRule(page: SendExclusionPage, field: FilterField): ExclusionRule {
  const mapping = page.catalog.fieldOperators.find(m => m.fieldId === field.id && page.catalog.operators.some(o => o.id === m.operatorId && o.isActive))
  return {
    fieldId: field.id, operatorId: mapping?.operatorId ?? 0,
    value: mapping && mapping.maxValues > 1 ? [] : mapping?.valueType === 'number' ? mapping.validationConfig.min ?? 1 : '',
    isEnabled: true, sortOrder: field.sortOrder
  }
}
function JoinBadge({ mode, index, enabled = true }: { mode: 'and' | 'or'; index: number; enabled?: boolean }) {
  return <span className={`exclusion-join ${enabled && index > 0 ? mode : ''}`} aria-hidden="true">
    {!enabled ? '—' : index === 0 ? 'Khi' : mode === 'and' ? 'VÀ' : 'HOẶC'}
  </span>
}

function GroupPicker({ page, selectedId, accountName, loading, onSelect, onAdd }: {
  page: SendExclusionPage | null; selectedId: number | null; accountName: string; loading: boolean
  onSelect: (id: number | null) => void; onAdd: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const group = page?.groups.find(g => g.id === selectedId)
  useEffect(() => { setExpanded(false) }, [page, accountName])
  useEffect(() => {
    if (!expanded) return
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [expanded])
  const close = () => { setExpanded(false); trigger.current?.focus() }
  const pick = (id: number | null) => { onSelect(id); close() }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expanded) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const options = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const current = options.indexOf(document.activeElement as HTMLElement)
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
    options[index]?.focus()
  }
  const subtitle = (g: SendExclusionGroup) => `${accountName} · ${enabledRules(g).length} điều kiện · ${g.matchMode === 'and' ? 'VÀ' : 'HOẶC'}`
  return <div className="exclusion-dropdown" ref={root} onKeyDown={keyDown}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false) }}>
    <button type="button" className="exclusion-group-trigger" ref={trigger} aria-label="Nhóm điều kiện loại trừ"
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      disabled={loading || !page} onClick={() => setExpanded(v => !v)}
      onKeyDown={event => { if (!expanded && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setExpanded(true) } }}>
      <span className="exclusion-picker-copy"><span className={selectedId ? 'exclusion-picker-name' : 'exclusion-placeholder'}>
        {loading ? 'Đang tải nhóm…' : group?.name ?? (selectedId ? `Nhóm #${selectedId} — chưa xác minh` : 'Chọn nhóm điều kiện loại trừ')}
      </span>{group && <small>{subtitle(group)}</small>}</span><ChevronDown size={17} />
    </button>
    {expanded && <div className="exclusion-menu">
      <div role="listbox" id={listId} aria-label="Nhóm điều kiện loại trừ">
        <button type="button" role="option" aria-selected={!selectedId} onClick={() => pick(null)}>
          <span className="exclusion-picker-copy"><span>Không chọn nhóm</span><small>Chỉ áp dụng các danh sách đã chọn bên dưới</small></span>
          {!selectedId && <Check size={15} />}
        </button>
        {page?.groups.map(g => <button type="button" role="option" aria-selected={selectedId === g.id} key={g.id} onClick={() => pick(g.id)}>
          <span className="exclusion-picker-copy"><span>{g.name}</span><small>{subtitle(g)}</small></span>{selectedId === g.id && <Check size={15} />}
        </button>)}
        {!page?.groups.length && <p className="exclusion-menu-empty">Chưa có nhóm điều kiện.</p>}
      </div>
      <button type="button" className="exclusion-menu-add" onClick={() => { close(); onAdd() }}><Plus size={15} />Thêm nhóm mới</button>
    </div>}
  </div>
}

function ConditionRow({ page, field, rule, index, mode, onPatch, onSync }: {
  page: SendExclusionPage; field: FilterField; rule?: ExclusionRule; index: number; mode: 'and' | 'or'
  onPatch: (patch: Partial<ExclusionRule>) => void; onSync: () => void
}) {
  const id = useId()
  const current = rule ?? newRule(page, field)
  const mappings = page.catalog.fieldOperators.filter(m => m.fieldId === field.id)
  const mapping = mappings.find(m => m.operatorId === current.operatorId)
  const operators = mappings.flatMap(m => page.catalog.operators.filter(o => o.id === m.operatorId && o.isActive)).sort((a, b) => a.sortOrder - b.sortOrder)
  let unsupported = ''
  try { ruleDefinition(page.catalog, current) } catch (e) { unsupported = message(e) }
  const opts = page.options.filter(o => o.fieldId === field.id && o.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
  const selected = Array.isArray(current.value) ? current.value : current.value == null || current.value === '' ? [] : [current.value]
  const afterValue = field.optionsConfig.operatorPlacement === 'afterValue'
  const input = mapping && <input className={mapping.valueType === 'number' ? 'exclusion-number' : 'exclusion-text-value'}
    aria-label={`Giá trị ${field.name}`} type={mapping.valueType === 'number' ? 'number' : field.dataType === 'date' ? 'date' : 'text'}
    min={mapping.validationConfig.min} max={mapping.validationConfig.max} step={mapping.validationConfig.integer ? 1 : 'any'}
    value={String(current.value ?? '')} onChange={e => onPatch({ isEnabled: true, value: mapping.valueType === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value })} />
  const operatorControls = <div className="exclusion-operators" role="group" aria-label={`Toán tử ${field.name}`}>
    {operators.map(operator => <button type="button" key={operator.id} aria-pressed={current.operatorId === operator.id}
      onClick={() => onPatch({ isEnabled: true, operatorId: operator.id })}>{operator.name}</button>)}
  </div>
  return <div className={`exclusion-condition ${rule?.isEnabled ? 'enabled' : ''}`}>
    <input className="exclusion-checkbox" id={id} type="checkbox" checked={!!rule?.isEnabled}
      disabled={!!unsupported && !rule?.isEnabled} onChange={e => onPatch({ isEnabled: e.target.checked })} />
    <JoinBadge mode={mode} index={index} enabled={!!rule?.isEnabled} />
    <div className="exclusion-condition-body">
      <div className="exclusion-condition-heading"><label htmlFor={id}>{field.name}</label>
        {!unsupported && (!afterValue ? operatorControls : <span className="exclusion-inline-value">{input}
          {operators.length === 1 ? <span>{operators[0].name}</span> : operatorControls}</span>)}
        {!unsupported && field.optionsSource !== 'none' && <small className="exclusion-value-hint">{mapping?.maxValues === 1 ? 'chọn 1 giá trị' : 'chọn 1 hoặc nhiều'}</small>}
      </div>
      {unsupported ? <div className="exclusion-error">{unsupported}{rule && !rule.isEnabled && <button type="button" className="exclusion-link" onClick={() => onPatch({ isEnabled: false })}>Bỏ điều kiện {field.name}</button>}</div>
        : field.optionsSource !== 'none' ? <div className="exclusion-option-list">
          {opts.map(option => <button type="button" key={option.code} aria-pressed={selected.includes(option.value)}
            onClick={() => onPatch({ isEnabled: true, value: mapping?.maxValues === 1 ? option.value : selected.includes(option.value) ? selected.filter(v => v !== option.value) : [...selected, option.value] })}>{option.label}</button>)}
          {!opts.length && <small>Chưa có giá trị để chọn.</small>}
          {selected.filter(v => !opts.some(o => o.value === v)).map(v => <button className="exclusion-error" type="button" key={String(v)}
            onClick={() => onPatch({ value: mapping?.maxValues === 1 ? '' : selected.filter(x => x !== v) })}>{String(v)} (không còn tồn tại)<X size={12} /></button>)}
          {field.optionsSource === 'zalo_labels' && <button type="button" className="exclusion-sync" onClick={onSync}><RefreshCw size={12} />Đồng bộ tag</button>}
        </div> : !afterValue && <div className="exclusion-input-value">{mapping?.valueType === 'boolean'
          ? <select aria-label={`Giá trị ${field.name}`} value={String(current.value)} onChange={e => onPatch({ isEnabled: true, value: e.target.value === 'true' })}><option value="" disabled>Chọn giá trị</option><option value="true">Có</option><option value="false">Không</option></select>
          : input}</div>}
    </div>
  </div>
}

export default function CampaignSendExclusions({ accounts, value, onChange, onEditing, onManage, refreshKey }: Props) {
  const [chosen, setChosen] = useState(accounts[0]?.id)
  const accountId = accounts.some(a => a.id === chosen) ? chosen : accounts[0]?.id
  const accountName = accounts.find(a => a.id === accountId)?.name ?? ''
  const [page, setPage] = useState<SendExclusionPage | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [reload, setReload] = useState(0)
  const [draft, setDraft] = useState<SaveSendExclusionGroup | null>(null)
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState('')
  const busy = useRef(false), request = useRef(0), dialog = useRef<HTMLDivElement>(null), titleId = useId()
  const lists = useRef<HTMLDetailsElement>(null)
  const selection = value[String(accountId)] ?? empty
  const group = page?.groups.find(g => g.id === selection.groupId)
  useEffect(() => {
    const id = ++request.current
    setPage(null); setError('')
    if (lists.current) lists.current.open = false
    if (!accountId) return
    setLoading(true)
    window.electronAPI.listSendExclusionGroups(accountId).then(data => { if (id === request.current) setPage(data) })
      .catch(e => { if (id === request.current) setError(message(e)) }).finally(() => { if (id === request.current) setLoading(false) })
    return () => { request.current++ }
  }, [accountId, reload, refreshKey])
  useEffect(() => { onEditing(!!draft); return () => onEditing(false) }, [!!draft])
  useEffect(() => {
    const closeLists = (event: PointerEvent) => {
      if (lists.current && !lists.current.contains(event.target as Node)) lists.current.open = false
    }
    document.addEventListener('pointerdown', closeLists)
    return () => document.removeEventListener('pointerdown', closeLists)
  }, [])
  useEffect(() => {
    if (!draft) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    const handle = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); if (!busy.current) setDraft(null) }
      if (event.key !== 'Tab') return
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? []).filter(node => !node.matches(':disabled'))
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handle, true)
    return () => { document.removeEventListener('keydown', handle, true); previous?.focus() }
  }, [!!draft])
  const choose = (patch: Partial<typeof selection>) => onChange({ ...value, [String(accountId)]: { ...selection, ...patch } })
  const open = (current?: SendExclusionGroup) => {
    if (!page || !accountId) return
    setSaveError('')
    setDraft(current ? structuredClone(current) : { accountId, requestId: crypto.randomUUID(), name: '', matchMode: 'and', revision: 0, rules: [] })
  }
  const patchRule = (fieldId: number, patch: Partial<ExclusionRule>) => setDraft(current => {
    if (!current || !page) return current
    const old = current.rules.find(rule => rule.fieldId === fieldId)
    // Retired/unsupported rules must be removable even when no active operator remains.
    if (patch.isEnabled === false && old) {
      try { ruleDefinition(page.catalog, old) } catch {
        return { ...current, rules: current.rules.filter(rule => rule.fieldId !== fieldId) }
      }
    }
    const field = page.catalog.fields.find(f => f.id === fieldId)
    if (!field) return current
    return { ...current, rules: [...current.rules.filter(rule => rule.fieldId !== fieldId), { ...(old ?? newRule(page, field)), ...patch }] }
  })
  const save = async () => {
    if (busy.current || !draft || !page) return
    setSaveError('')
    try { validateExclusionGroup(page.catalog, draft) } catch (e) { setSaveError(message(e)); return }
    busy.current = true; setSaving(true)
    try {
      const saved = await window.electronAPI.saveSendExclusionGroup(draft)
      setPage({ ...page, groups: [...page.groups.filter(g => g.id !== saved.id), saved] })
      onChange({ ...value, [String(draft.accountId)]: { ...(value[String(draft.accountId)] ?? empty), groupId: saved.id } }); setDraft(null)
    } catch (e) { setSaveError(message(e)) } finally { busy.current = false; setSaving(false) }
  }
  const syncLabels = async () => {
    if (busy.current || !draft) return
    busy.current = true; setSaving(true)
    try { await window.electronAPI.syncZaloLabels(draft.accountId); setPage(await window.electronAPI.listSendExclusionGroups(draft.accountId)) }
    catch (e) { setSaveError(message(e)) } finally { busy.current = false; setSaving(false) }
  }
  const reloadGroup = async () => {
    if (busy.current || !draft) return
    busy.current = true; setSaving(true)
    try {
      const fresh = await window.electronAPI.listSendExclusionGroups(draft.accountId)
      setPage(fresh)
      const latest = fresh.groups.find(g => draft.id ? g.id === draft.id : g.requestId === draft.requestId)
      if (latest) { setDraft(structuredClone(latest)); setSaveError('') }
      else setSaveError(draft.id ? 'Nhóm không còn tồn tại.' : 'Chưa có nhóm được lưu. Bạn có thể thử lưu lại.')
    } catch (e) { setSaveError(message(e)) } finally { busy.current = false; setSaving(false) }
  }
  let groupError = '', draftError = ''
  if (group && page) { try { validateExclusionGroup(page.catalog, group) } catch (e) { groupError = message(e) } }
  if (draft && page) {
    try { validateExclusionGroup(page.catalog, draft) } catch (e) { draftError = draft.name.trim() ? message(e) : 'Nhập tên nhóm để tiếp tục.' }
  }
  const draftRules = draft ? enabledRules(draft) : []
  const draftAccountName = accounts.find(a => a.id === draft?.accountId)?.name ?? String(draft?.accountId ?? '')
  const selectedLists = selection.blocklistIds.map(id => page?.blocklists.find(list => list.id === id))
  return <section className="send-exclusions" aria-label="Loại trừ gửi cho khách hàng">
    <header className="exclusion-header"><span className="exclusion-icon"><Ban size={15} /></span>
      <div className="exclusion-heading-copy"><strong>Loại trừ gửi cho khách hàng</strong><p>Chọn nhóm điều kiện hoặc danh sách khách hàng không gửi tin.</p></div><span className="exclusion-badge">Tùy chọn</span>
    </header>
    <div className="exclusion-default"><Check size={14} /><span>Khách hàng đã từ chối nhận tin luôn được loại trừ</span><small><LockKeyhole size={11} />Mặc định</small></div>
    {accounts.length > 1 && <label className="exclusion-account-label">Từ Zalo nào<select aria-label="Từ Zalo nào" value={accountId} onChange={e => setChosen(Number(e.target.value))}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    {!accounts.length ? <p>Chọn tài khoản Zalo để cấu hình loại trừ.</p> : <>
      <div className="exclusion-control-group">
        <div className="exclusion-label-row"><span>Loại trừ gửi tin</span><small>{page ? `${page.groups.length} nhóm của ${accountName}` : loading ? 'Đang tải…' : 'Chưa tải được nhóm'}</small></div>
        <div className="exclusion-picker"><GroupPicker page={page} selectedId={selection.groupId} accountName={accountName} loading={loading} onSelect={id => choose({ groupId: id })} onAdd={() => open()} />
          <button type="button" className="exclusion-add" disabled={!page || loading} aria-label="Thêm nhóm loại trừ" onClick={() => open()}><Plus size={18} /></button>
        </div>
        {error && <div className="exclusion-error" role="alert">{error} <button type="button" className="exclusion-link" onClick={() => setReload(n => n + 1)}>Thử lại</button></div>}
        {page && !page.groups.length && <p className="exclusion-helper">Chưa có nhóm điều kiện. Bấm + để tạo nhóm đầu tiên.</p>}
      </div>
      {selection.groupId && <div className="exclusion-summary">
        <div className="exclusion-summary-heading"><span>Không gửi đến data trên <b>{accountName}</b> khi</span><div className="exclusion-summary-actions">
          <button type="button" className="exclusion-link" disabled={!group} onClick={() => open(group)}>Sửa nhóm</button><button type="button" className="exclusion-link" onClick={() => choose({ groupId: null })}>Bỏ chọn</button>
        </div></div>
        {group && page ? <div className="exclusion-summary-rules">{enabledRules(group).map((rule, index) => <div key={rule.fieldId}>
          <JoinBadge mode={group.matchMode} index={index} /><span>{ruleDescription(page, rule)}</span>
        </div>)}</div> : <p>Chưa xác minh được nhóm đã chọn. Hãy tải lại trước khi lưu.</p>}
        {groupError && <p role="alert" className="exclusion-error">{groupError}</p>}
      </div>}
      <div className="exclusion-divider" />
      <div className="exclusion-control-group">
        <div className="exclusion-label-row"><span>Loại trừ danh sách bạn bè/Zalo ID cụ thể</span><small>{selection.blocklistIds.length
          ? `${selection.blocklistIds.length} danh sách${selectedLists.every(Boolean) ? ` · ${selectedLists.reduce((sum, list) => sum + (list?.count ?? 0), 0).toLocaleString('vi-VN')} bạn bè` : ''}` : 'Không bắt buộc'}</small></div>
        <details className="exclusion-lists" ref={lists} onKeyDown={event => {
          if (event.key === 'Escape' && lists.current?.open) { event.preventDefault(); event.stopPropagation(); lists.current.open = false; lists.current.querySelector('summary')?.focus() }
        }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && lists.current) lists.current.open = false }}>
          <summary aria-label="Chọn danh sách loại trừ"><span className="exclusion-chips">{selection.blocklistIds.length ? selection.blocklistIds.map((id, index) => <span className="exclusion-list-chip" key={id}>
            <span>{selectedLists[index]?.name ?? `Danh sách #${id} — chưa xác minh`}</span>{selectedLists[index] && <small>{selectedLists[index]!.count.toLocaleString('vi-VN')}</small>}
            <button type="button" aria-label={`Bỏ danh sách ${id}`} onClick={event => { event.preventDefault(); choose({ blocklistIds: selection.blocklistIds.filter(v => v !== id) }) }}><X size={11} /></button>
          </span>) : <span className="exclusion-placeholder">Chọn một hoặc nhiều danh sách</span>}</span><ChevronDown size={17} /></summary>
          <div className="exclusion-menu">
            {page?.blocklists.map(list => <label className="exclusion-list-option" key={list.id}>
              <input className="exclusion-checkbox" type="checkbox" checked={selection.blocklistIds.includes(list.id)} onChange={e => choose({ blocklistIds: e.target.checked ? [...selection.blocklistIds, list.id] : selection.blocklistIds.filter(id => id !== list.id) })} />
              <span className="exclusion-picker-copy"><span>{list.name}</span><small>{list.count.toLocaleString('vi-VN')} bạn bè / Zalo ID</small></span>
            </label>)}
            {(!page || !page.blocklists.length) && <p className="exclusion-menu-empty">{loading ? 'Đang tải danh sách…' : page ? 'Chưa có danh sách. Tạo danh sách trong phần quản lý.' : 'Chưa tải được danh sách. Hãy thử tải lại.'}</p>}
          </div>
        </details>
        <div className="exclusion-list-help"><p>Khách hàng trong các danh sách đã chọn sẽ được loại trừ.</p>{onManage && <button type="button" className="exclusion-link" onClick={onManage}>Quản lý danh sách</button>}</div>
      </div>
    </>}
    {draft && page && createPortal(<div className="exclusion-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !saving) setDraft(null) }}>
      <div className="exclusion-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <header className="exclusion-header"><span className="exclusion-icon"><Ban size={15} /></span><div className="exclusion-heading-copy"><h3 id={titleId}>{draft.id ? 'Sửa nhóm loại trừ' : 'Thêm nhóm loại trừ'}</h3><p>Thiết lập điều kiện để bỏ qua khách hàng không phù hợp.</p></div>
          <button type="button" className="exclusion-close" disabled={saving} aria-label="Đóng" onClick={() => setDraft(null)}><X size={16} /></button>
        </header>
        <div className="exclusion-modal-body"><fieldset disabled={saving}>
          <div className="exclusion-identity"><label><span>Tên nhóm <i aria-hidden="true">*</i></span><input aria-label="Tên nhóm" value={draft.name} maxLength={200} placeholder="Ví dụ: Khách hàng không gửi tin" onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <div><label><span>Tài khoản <i aria-hidden="true">*</i></span><input readOnly value={draftAccountName} /></label><small className="exclusion-account-note"><Check size={12} />Khớp mặc định theo tài khoản chiến dịch</small></div>
          </div>
          <div className="exclusion-filter-section">
            <div className="exclusion-mode"><strong>Không gửi đến data khi</strong><div className="exclusion-mode-control"><span>Bộ lọc</span><div className="exclusion-segment">
              {(['and', 'or'] as const).map(mode => <button type="button" key={mode} aria-label={mode === 'and' ? 'VÀ — Tất cả điều kiện' : 'HOẶC — Một điều kiện'} aria-pressed={draft.matchMode === mode} onClick={() => setDraft({ ...draft, matchMode: mode })}>{mode === 'and' ? 'Và' : 'Hoặc'}</button>)}
            </div></div></div>
            <p className="exclusion-mode-hint">{draft.matchMode === 'and' ? 'Và — data phải khớp tất cả điều kiện đang bật.' : 'Hoặc — data khớp 1 điều kiện bất kỳ là bị loại trừ.'}</p>
            <div className="exclusion-source"><span>Từ Zalo nào</span><small>Bắt buộc</small><span className="exclusion-source-account" title={draftAccountName}>{draftAccountName}</span></div>
            <div className="exclusion-fields">{page.catalog.fields.filter(f => f.isActive || draft.rules.some(r => r.fieldId === f.id)).sort((a, b) => a.sortOrder - b.sortOrder).map(field => {
              const rule = draft.rules.find(r => r.fieldId === field.id)
              return <ConditionRow key={field.id} page={page} field={field} rule={rule} index={draftRules.findIndex(r => r.fieldId === field.id)} mode={draft.matchMode} onPatch={patch => patchRule(field.id, patch)} onSync={() => void syncLabels()} />
            })}</div>
          </div>
          <div className="exclusion-sentence"><Info size={14} /><span>{draftRules.length
            ? <>Không gửi đến data trên <b>{draftAccountName}</b> khi {draftRules.map((rule, index) => <span key={rule.fieldId}>{index > 0 && <b> {draft.matchMode === 'and' ? 'VÀ' : 'HOẶC'} </b>}{ruleDescription(page, rule)}</span>)}.</>
            : 'Bật ít nhất một điều kiện để tạo nhóm loại trừ.'}</span></div>
        </fieldset>
        {saveError && <div role="alert" className="exclusion-error">{saveError} <button type="button" className="exclusion-link" disabled={saving} title="Thay nội dung đang sửa bằng bản nhóm đã lưu" onClick={() => void reloadGroup()}>Tải lại nhóm</button></div>}
        </div>
        <footer><span className={`exclusion-footnote ${draftError ? 'invalid' : ''}`}>{draftError || 'Nhóm đã sẵn sàng để lưu.'}</span><button type="button" disabled={saving} onClick={() => setDraft(null)}>Hủy</button><button type="button" className="exclusion-primary" disabled={saving || !!draftError} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Lưu nhóm'}</button></footer>
      </div>
    </div>, document.body)}
  </section>
}
