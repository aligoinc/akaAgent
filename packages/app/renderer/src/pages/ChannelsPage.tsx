import { useEffect, useState, useCallback } from 'react'
import type { ChannelListItem } from '../../../shared/ipcChannels'

export function ChannelsPage(): JSX.Element {
  const [channels, setChannels] = useState<ChannelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.akabiz.channels.list()
      setChannels(list)
      setError(null)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (!confirm(`Delete channel "${name}"?`)) return
    await window.akabiz.channelsAdmin.delete(id)
    await reload()
  }

  const handleOpen = async (id: string): Promise<void> => {
    try {
      await window.akabiz.channels.register(id)
      // Trigger picker với URL trống → browser mở
      await window.akabiz.picker.start({ channelId: id })
      // Picker stays open until user clicks element OR cancels
    } catch (e) {
      alert((e as Error).message)
    }
  }

  if (loading) return <div className="empty">Loading…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>{error}</div>

  return (
    <div>
      <div className="row">
        <h2>Channels ({channels.length})</h2>
        <button className="primary" onClick={() => setShowForm(true)}>+ New channel</button>
      </div>
      <p style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
        Channel = browser session với cookie/profile. Click "Login" để mở browser, đăng nhập website một lần — cookie giữ lại cho workflow runs.
      </p>

      {showForm && <ChannelForm onCancel={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await reload() }} />}

      {channels.length === 0 && !showForm && <div className="empty">Chưa có channel.</div>}
      {channels.length > 0 && (
        <table className="list-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>ID</th><th></th></tr></thead>
          <tbody>
            {channels.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><span className="badge pending">{c.channel_type}</span></td>
                <td><span className={`badge ${c.status === 'idle' ? 'success' : c.status === 'busy' ? 'running' : 'pending'}`}>{c.status}</span></td>
                <td style={{ fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{c.id.slice(0, 8)}…</td>
                <td>
                  <button onClick={() => void handleOpen(c.id)} style={{ padding: '4px 8px', fontSize: 11, marginRight: 4 }}>Login</button>
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

function ChannelForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => Promise<void> }): JSX.Element {
  const [name, setName] = useState('')
  const [channelType, setChannelType] = useState<'browser_persistent' | 'browser_ephemeral' | 'headless_node'>('browser_persistent')
  const [profilePath, setProfilePath] = useState('')
  const [userAgent, setUserAgent] = useState('')
  const [locale, setLocale] = useState('vi-VN')
  const [timezone, setTimezone] = useState('Asia/Ho_Chi_Minh')
  const [proxyUrl, setProxyUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) { setErr('Name required'); return }
    setSaving(true)
    setErr(null)
    try {
      await window.akabiz.channelsAdmin.save({
        name: name.trim(),
        channel_type: channelType,
        profile_path: profilePath.trim() || null,
        user_agent: userAgent.trim() || null,
        locale: locale.trim() || null,
        timezone: timezone.trim() || null,
        proxy_url: proxyUrl.trim() || null
      })
      await onSaved()
    } catch (e) { setErr((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: '#1a1f2c', padding: 16, borderRadius: 6, marginTop: 12, border: '1px solid #2a3142' }}>
      <h3 style={{ marginBottom: 12 }}>New channel</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="vd: FB Acc Marketing" style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Type</label>
          <select value={channelType} onChange={e => setChannelType(e.target.value as typeof channelType)} style={{ width: '100%' }}>
            <option value="browser_persistent">browser_persistent</option>
            <option value="browser_ephemeral">browser_ephemeral</option>
            <option value="headless_node">headless_node</option>
          </select>
        </div>
      </div>
      {channelType === 'browser_persistent' && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Profile path</label>
          <input value={profilePath} onChange={e => setProfilePath(e.target.value)} placeholder="/tmp/akabiz-profile-1 (auto-generate nếu để trống)" style={{ width: '100%' }} />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Locale</label>
          <input value={locale} onChange={e => setLocale(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Timezone</label>
          <input value={timezone} onChange={e => setTimezone(e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>User agent (optional)</label>
        <input value={userAgent} onChange={e => setUserAgent(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Proxy URL (optional)</label>
        <input value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder="http://user:pass@host:port" style={{ width: '100%' }} />
      </div>
      {err && <div style={{ color: '#fca5a5', marginTop: 8, fontSize: 12 }}>{err}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : '💾 Save'}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
