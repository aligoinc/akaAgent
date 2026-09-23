import { Loader2, RefreshCw } from 'lucide-react'

interface Props {
  label: string
  values: string[]
  labels: Array<{ id: number | string; text: string }>
  disabled: boolean
  loading?: boolean
  syncing?: boolean
  error?: string
  emptyHint?: string
  compact?: boolean
  onSync?: () => void
  onChange: (ids: string[], names: string[]) => void
}

export default function ZaloTagMultiSelector({ label, values, labels, disabled, loading, syncing, error,
  emptyHint = 'Bấm “Tải tag” để lấy tag từ Zalo.', compact = false, onSync, onChange }: Props) {
  const selected = new Set(values)
  const updateSelection = (id: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    const ids = labels.map(item => String(item.id)).filter(itemId => next.has(itemId))
    const byId = new Map(labels.map(item => [String(item.id), item.text]))
    onChange(ids, ids.map(value => byId.get(value) || ''))
  }
  if (compact) return <div className="zalo-tag-choices" role="group" aria-label={label}>
    <div className="zalo-tag-choices-heading">
      <span>{label}</span>
      <span className="zalo-auxiliary-hint">{values.length > 0 ? `Đã chọn ${values.length}` : 'Chọn ít nhất 1 tag'}</span>
    </div>
    {error && <div className="zalo-auxiliary-error" role="alert">{error}</div>}
    {!loading && !error && labels.length === 0 && <p className="zalo-auxiliary-hint">{emptyHint}</p>}
    {labels.length > 0 && <div className="zalo-tag-choices-list">
      {labels.map(item => <label key={item.id} className="zalo-tag-choice">
        <input type="checkbox" checked={selected.has(String(item.id))} disabled={disabled}
          onChange={event => updateSelection(String(item.id), event.target.checked)} />
        <span>{item.text}</span>
      </label>)}
    </div>}
  </div>
  return <div className="stepper-form-group" style={{ maxWidth: 420 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <label style={{ marginBottom: 0 }}>{label}</label>
      {onSync && <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onSync}>
        {syncing ? <Loader2 size={14} /> : <RefreshCw size={14} />}
        {syncing ? 'Đang tải' : 'Tải tag'}
      </button>}
    </div>
    {error && <div className="schedule-hint" role="alert" style={{ color: 'var(--text-error)' }}>{error}</div>}
    {!loading && !error && labels.length === 0 && <div className="schedule-hint">{emptyHint}</div>}
    {labels.length > 0 && <div style={{ display: 'grid', gap: 8, marginTop: 8, padding: 10,
      border: '1px solid var(--border-default)', borderRadius: 6, maxHeight: 180, overflowY: 'auto' }}>
      {labels.map(item => <label key={item.id} className="schedule-checkbox-label">
        <input type="checkbox" checked={selected.has(String(item.id))} disabled={disabled}
          onChange={event => updateSelection(String(item.id), event.target.checked)} />
        <span>{item.text}</span>
      </label>)}
    </div>}
  </div>
}
