import { useEffect, useState } from 'react'
import type { WorkflowListItem } from '../../../shared/ipcChannels'
import { WorkflowDetail } from './WorkflowDetail'

interface Props {
  selectedId: string | null
  onSelect: (id: string) => void
  onBack: () => void
}

export function WorkflowsPage({ selectedId, onSelect, onBack }: Props): JSX.Element {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (selectedId) return
    setLoading(true)
    window.akabiz.workflows.list()
      .then((list) => { setWorkflows(list); setError(null) })
      .catch((err) => setError(String(err.message ?? err)))
      .finally(() => setLoading(false))
  }, [selectedId])

  if (selectedId) {
    return <WorkflowDetail workflowId={selectedId} onBack={onBack} />
  }

  const handleNew = async (): Promise<void> => {
    const name = prompt('Workflow name:', 'New workflow')
    if (!name) return
    try {
      const result = await window.akabiz.workflows.create({ name })
      onSelect(result.id)
    } catch (err) {
      alert(`Create failed: ${(err as Error).message}`)
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: string, name: string): Promise<void> => {
    e.stopPropagation()
    if (!confirm(`Delete workflow "${name}"?`)) return
    try {
      await window.akabiz.workflows.delete(id)
      setWorkflows(ws => ws.filter(w => w.id !== id))
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`)
    }
  }

  if (loading) return <div className="empty">Đang tải workflows…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>Lỗi: {error}</div>

  return (
    <div>
      <div className="row">
        <h2>Workflows ({workflows.length})</h2>
        <button className="primary" onClick={handleNew}>+ New workflow</button>
      </div>
      {workflows.length === 0 && (
        <div className="empty">
          Chưa có workflow. Click "+ New workflow" hoặc seed CLI:
          <pre style={{ marginTop: 8, fontSize: 11 }}>node packages/app/dist/cli/seed-workflow.js &lt;path&gt;</pre>
        </div>
      )}
      {workflows.length > 0 && (
      <table className="list-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Version</th>
            <th>Updated</th>
            <th>ID</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((wf) => (
            <tr key={wf.id} onClick={() => onSelect(wf.id)}>
              <td>{wf.name}</td>
              <td>
                <span className={`badge ${wf.is_block ? 'pending' : 'success'}`}>
                  {wf.is_block ? 'Block' : 'Workflow'}
                </span>
              </td>
              <td>v{wf.current_version}</td>
              <td>{wf.updated_at ? new Date(wf.updated_at).toLocaleString() : '-'}</td>
              <td style={{ fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{wf.id.slice(0, 8)}…</td>
              <td>
                <button
                  onClick={(e) => handleDelete(e, wf.id, wf.name)}
                  style={{ background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b', padding: '4px 8px', fontSize: 11 }}
                >
                  🗑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </div>
  )
}
