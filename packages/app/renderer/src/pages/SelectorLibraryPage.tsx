import { useEffect, useState, useCallback } from 'react'
import type { NamedSelectorRow, ChannelListItem } from '../../../shared/ipcChannels'

export function SelectorLibraryPage(): JSX.Element {
  const [selectors, setSelectors] = useState<NamedSelectorRow[]>([])
  const [channels, setChannels] = useState<ChannelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingSelector, setEditingSelector] = useState<NamedSelectorRow | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [sels, chs] = await Promise.all([
        window.akabiz.selectors.list(),
        window.akabiz.channels.list()
      ])
      setSelectors(sels)
      setChannels(chs)
      setError(null)
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (!confirm(`Delete selector "${name}"?`)) return
    try {
      await window.akabiz.selectors.delete(id)
      await reload()
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`)
    }
  }

  if (loading) return <div className="empty">Loading…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>Error: {error}</div>

  return (
    <div>
      <div className="row">
        <h2>Named Selectors ({selectors.length})</h2>
        <button className="primary" onClick={() => setShowCreate(true)}>+ New selector</button>
      </div>

      {selectors.length === 0 && !showCreate && (
        <div className="empty">
          Chưa có named selector. Tạo selector để reuse trong workflow nhiều chỗ.
        </div>
      )}

      {(showCreate || editingSelector) && (
        <SelectorForm
          initial={editingSelector ?? undefined}
          channels={channels}
          onCancel={() => { setEditingSelector(null); setShowCreate(false) }}
          onSaved={async () => { setEditingSelector(null); setShowCreate(false); await reload() }}
        />
      )}

      {selectors.length > 0 && (
        <table className="list-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Domain</th>
              <th>Type</th>
              <th>Expression</th>
              <th>Verified</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {selectors.map(s => (
              <tr key={s.id}>
                <td><code>{s.name}</code></td>
                <td>{s.domain ?? '-'}</td>
                <td><span className="badge pending">{s.selector_type}</span></td>
                <td style={{ fontFamily: 'monospace', fontSize: 11, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.expression}
                </td>
                <td style={{ fontSize: 11 }}>{s.last_verified_at ? new Date(s.last_verified_at).toLocaleDateString() : '—'}</td>
                <td>
                  <button onClick={() => setEditingSelector(s)} style={{ marginRight: 4, padding: '4px 8px', fontSize: 11 }}>Edit</button>
                  <button
                    onClick={() => handleDelete(s.id, s.name)}
                    style={{ background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b', padding: '4px 8px', fontSize: 11 }}
                  >🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface SelectorFormProps {
  initial?: NamedSelectorRow
  channels: ChannelListItem[]
  onCancel: () => void
  onSaved: () => void
}

function SelectorForm({ initial, channels, onCancel, onSaved }: SelectorFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [domain, setDomain] = useState(initial?.domain ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [selectorType, setSelectorType] = useState<'css' | 'xpath' | 'text-match'>(initial?.selector_type ?? 'xpath')
  const [expression, setExpression] = useState(initial?.expression ?? '')
  const [picking, setPicking] = useState(false)
  const [pickerChannel, setPickerChannel] = useState('')
  const [pickerUrl, setPickerUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handlePick = async (): Promise<void> => {
    if (!pickerChannel) {
      setErr('Choose a channel first')
      return
    }
    setPicking(true)
    setErr(null)
    try {
      await window.akabiz.channels.register(pickerChannel)
      const result = await window.akabiz.picker.start({ channelId: pickerChannel, ...(pickerUrl ? { url: pickerUrl } : {}) })
      if (result) {
        setSelectorType(result.selectorType)
        setExpression(result.expression)
        if (result.url && !domain) {
          try { setDomain(new URL(result.url).hostname) } catch {}
        }
      }
    } catch (e) {
      setErr(`Pick failed: ${(e as Error).message}`)
    } finally {
      setPicking(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!name.trim() || !expression.trim()) {
      setErr('Name and expression required')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const args: Parameters<typeof window.akabiz.selectors.save>[0] = {
        name: name.trim(),
        domain: domain.trim() || null,
        description: description.trim() || null,
        selectorType,
        expression: expression.trim()
      }
      if (initial) args.id = initial.id
      await window.akabiz.selectors.save(args)
      onSaved()
    } catch (e) {
      setErr(`Save failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ background: '#1a1f2c', padding: 16, borderRadius: 6, marginTop: 12, border: '1px solid #2a3142' }}>
      <h3 style={{ marginBottom: 12 }}>{initial ? `Edit "${initial.name}"` : 'New selector'}</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="vd: fb_group_composer" style={{ width: '100%' }} disabled={!!initial} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Domain (optional)</label>
          <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="facebook.com" style={{ width: '100%' }} />
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Description</label>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this selector targets" style={{ width: '100%' }} />
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Type</label>
        <select value={selectorType} onChange={e => setSelectorType(e.target.value as 'css' | 'xpath' | 'text-match')}>
          <option value="xpath">xpath</option>
          <option value="css">css</option>
          <option value="text-match">text-match</option>
        </select>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Expression *</label>
        <textarea value={expression} onChange={e => setExpression(e.target.value)} style={{ width: '100%', minHeight: 60, fontFamily: 'monospace' }} />
      </div>

      <div style={{ marginTop: 12, padding: 12, background: '#0f1115', borderRadius: 4 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>🎯 Pick element from a channel browser:</div>
        <div className="row">
          <select value={pickerChannel} onChange={e => setPickerChannel(e.target.value)} style={{ flex: 1 }}>
            <option value="">— Choose channel —</option>
            {channels.filter(c => c.channel_type !== 'headless_node').map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.channel_type})</option>
            ))}
          </select>
          <input value={pickerUrl} onChange={e => setPickerUrl(e.target.value)} placeholder="URL (optional)" style={{ flex: 2 }} />
          <button onClick={handlePick} disabled={picking || !pickerChannel}>
            {picking ? 'Waiting click...' : '🎯 Pick'}
          </button>
        </div>
      </div>

      {err && <div style={{ color: '#fca5a5', marginTop: 8, fontSize: 12 }}>{err}</div>}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : '💾 Save'}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
