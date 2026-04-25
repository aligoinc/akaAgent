import { useEffect, useState } from 'react'
import type { RunListItem } from '../../../shared/ipcChannels'

export function RunsPage(): JSX.Element {
  const [runs, setRuns] = useState<RunListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [steps, setSteps] = useState<Array<Record<string, unknown>>>([])

  useEffect(() => {
    setLoading(true)
    window.akabiz.runs.list({ limit: 50 })
      .then(rs => { setRuns(rs); setError(null) })
      .catch(err => setError(String(err.message ?? err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedRun) { setSteps([]); return }
    window.akabiz.runs.getSteps(selectedRun).then(setSteps).catch(() => setSteps([]))
  }, [selectedRun])

  if (loading) return <div className="empty">Đang tải runs…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>Lỗi: {error}</div>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, height: '100%' }}>
      <div>
        <h2 style={{ marginBottom: 8 }}>Recent runs ({runs.length})</h2>
        <table className="list-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Workflow</th>
              <th>Started</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <tr key={r.id} onClick={() => setSelectedRun(r.id)} style={{ background: r.id === selectedRun ? '#2a3142' : undefined }}>
                <td><span className={`badge ${r.status === 'completed' ? 'success' : r.status === 'failed' ? 'error' : 'pending'}`}>{r.status}</span></td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.workflow_id.slice(0, 8)}…</td>
                <td>{r.started_at ? new Date(r.started_at).toLocaleString() : '-'}</td>
                <td>{r.duration_ms ? `${r.duration_ms}ms` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h2 style={{ marginBottom: 8 }}>Steps {selectedRun && `(${steps.length})`}</h2>
        {!selectedRun && <div className="empty">Click a run to view steps</div>}
        {selectedRun && steps.length === 0 && <div className="empty">No steps</div>}
        {selectedRun && steps.length > 0 && (
          <div style={{ background: '#1a1f2c', padding: 12, borderRadius: 6, fontFamily: 'Consolas, monospace', fontSize: 12, overflow: 'auto', maxHeight: '80vh' }}>
            {steps.map((s) => (
              <div key={String(s.id)} style={{ borderBottom: '1px solid #2a3142', padding: '6px 0' }}>
                <div>
                  <span className={`badge ${s.status === 'success' ? 'success' : s.status === 'error' ? 'error' : 'pending'}`}>{String(s.status)}</span>
                  <span style={{ marginLeft: 8 }}>{String(s.node_id)} ({String(s.manifest_id)})</span>
                  <span style={{ marginLeft: 8, color: '#888' }}>{s.duration_ms ? `${s.duration_ms}ms` : ''}</span>
                </div>
                {Boolean(s.error) && <div style={{ color: '#fca5a5', marginTop: 4 }}>{String(s.error)}</div>}
                {Boolean(s.output) && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', color: '#888' }}>output</summary>
                    <pre style={{ background: '#0f1115', padding: 6, borderRadius: 4, overflow: 'auto', maxHeight: 200, fontSize: 11 }}>
                      {JSON.stringify(s.output, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
