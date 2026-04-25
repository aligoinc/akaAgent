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

  if (loading) return <div className="empty">Đang tải workflows…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>Lỗi: {error}</div>
  if (workflows.length === 0) return <div className="empty">Chưa có workflow nào. Seed bằng CLI: <code>node packages/app/dist/cli/seed-workflow.js &lt;path&gt;</code></div>

  return (
    <div>
      <div className="row">
        <h2>Workflows ({workflows.length})</h2>
      </div>
      <table className="list-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Version</th>
            <th>Updated</th>
            <th>ID</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
