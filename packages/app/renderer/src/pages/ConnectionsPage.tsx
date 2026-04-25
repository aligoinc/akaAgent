import { useEffect, useState, useCallback } from 'react'
import type { ConnectionRow } from '../../../shared/ipcChannels'

export function ConnectionsPage(): JSX.Element {
  const [connections, setConnections] = useState<ConnectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.akabiz.connections.list()
      setConnections(list)
      setError(null)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (!confirm(`Delete connection "${name}"?`)) return
    await window.akabiz.connections.delete(id)
    await reload()
  }

  if (loading) return <div className="empty">Loading…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>{error}</div>

  return (
    <div>
      <div className="row">
        <h2>Connections ({connections.length})</h2>
        <button className="primary" onClick={() => setShowForm(true)}>+ New connection</button>
      </div>
      <p style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
        Secrets được mã hoá AES-256-GCM với <code>CONN_VAULT_KEY</code> trước khi lưu DB.
      </p>

      {showForm && <ConnectionForm onCancel={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await reload() }} />}

      {connections.length === 0 && !showForm && <div className="empty">No connections.</div>}
      {connections.length > 0 && (
        <table className="list-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Name</th><th>Type</th><th>Scope</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {connections.map(c => (
              <tr key={c.id}>
                <td><code>{c.name}</code></td>
                <td><span className="badge pending">{c.conn_type}</span></td>
                <td style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                  {c.scope ? JSON.stringify(c.scope).slice(0, 60) : '—'}
                </td>
                <td style={{ fontSize: 11 }}>{new Date(c.created_at).toLocaleDateString()}</td>
                <td>
                  <button onClick={() => void handleDelete(c.id, c.name)} style={{ background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b', padding: '4px 8px', fontSize: 11 }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ConnectionForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => Promise<void> }): JSX.Element {
  const [name, setName] = useState('')
  const [connType, setConnType] = useState<'oauth2' | 'apikey' | 'basicauth' | 'cookie' | 'custom'>('apikey')
  const [secretsJson, setSecretsJson] = useState('{\n  "token": ""\n}')
  const [scopeJson, setScopeJson] = useState('{}')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) { setErr('Name required'); return }
    let secrets: Record<string, string>, scope: Record<string, unknown> | null = null
    try { secrets = JSON.parse(secretsJson) } catch { setErr('Invalid secrets JSON'); return }
    try { if (scopeJson.trim()) scope = JSON.parse(scopeJson) } catch { setErr('Invalid scope JSON'); return }

    setSaving(true)
    setErr(null)
    try {
      await window.akabiz.connections.save({
        name: name.trim(),
        conn_type: connType,
        secrets,
        scope
      })
      await onSaved()
    } catch (e) { setErr((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: '#1a1f2c', padding: 16, borderRadius: 6, marginTop: 12, border: '1px solid #2a3142' }}>
      <h3 style={{ marginBottom: 12 }}>New connection</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="vd: stripe_main, telegram_bot" style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Type</label>
          <select value={connType} onChange={e => setConnType(e.target.value as typeof connType)} style={{ width: '100%' }}>
            <option value="apikey">apikey</option>
            <option value="oauth2">oauth2</option>
            <option value="basicauth">basicauth</option>
            <option value="cookie">cookie</option>
            <option value="custom">custom</option>
          </select>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Secrets (JSON, encrypted)</label>
        <textarea value={secretsJson} onChange={e => setSecretsJson(e.target.value)} style={{ width: '100%', minHeight: 100, fontFamily: 'monospace' }} />
        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
          vd apikey: <code>{`{ "token": "sk-..." }`}</code>; basicauth: <code>{`{ "username": "...", "password": "..." }`}</code>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Scope (JSON, non-secret)</label>
        <textarea value={scopeJson} onChange={e => setScopeJson(e.target.value)} style={{ width: '100%', minHeight: 60, fontFamily: 'monospace' }} placeholder='{ "account": "user@example.com" }' />
      </div>
      {err && <div style={{ color: '#fca5a5', marginTop: 8, fontSize: 12 }}>{err}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : '💾 Save'}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
