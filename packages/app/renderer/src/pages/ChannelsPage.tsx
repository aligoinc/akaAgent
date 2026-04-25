import { useEffect, useState } from 'react'
import type { ChannelListItem } from '../../../shared/ipcChannels'

export function ChannelsPage(): JSX.Element {
  const [channels, setChannels] = useState<ChannelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    window.akabiz.channels.list()
      .then(cs => { setChannels(cs); setError(null) })
      .catch(err => setError(String(err.message ?? err)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="empty">Đang tải channels…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>Lỗi: {error}</div>

  return (
    <div>
      <h2 style={{ marginBottom: 12 }}>Channels ({channels.length})</h2>
      <p style={{ color: '#888', marginBottom: 12, fontSize: 12 }}>
        Phase 7a chỉ hiển thị danh sách. Tạo/sửa channel bằng SQL trên Supabase Dashboard.
        Phase 9 sẽ có UI tạo channel + login flow.
      </p>
      {channels.length === 0 && <div className="empty">Chưa có channel</div>}
      {channels.length > 0 && (
        <table className="list-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {channels.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.channel_type}</td>
                <td>
                  <span className={`badge ${c.status === 'idle' ? 'success' : c.status === 'busy' ? 'running' : 'pending'}`}>
                    {c.status}
                  </span>
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{c.id.slice(0, 8)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
