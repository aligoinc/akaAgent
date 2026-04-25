import { useEffect, useState, useCallback } from 'react'
import type { DataTableRow, DataTableRowItem } from '../../../shared/ipcChannels'

export function DataTablesPage(): JSX.Element {
  const [tables, setTables] = useState<DataTableRow[]>([])
  const [selected, setSelected] = useState<DataTableRow | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.akabiz.datatables.list()
      setTables(list)
      setError(null)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const handleNew = async (): Promise<void> => {
    const name = prompt('DataTable name:', 'New table')
    if (!name) return
    try {
      const dt = await window.akabiz.datatables.save({ name, schema: [] })
      await reload()
      setSelected(dt)
    } catch (e) { alert((e as Error).message) }
  }

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (!confirm(`Delete datatable "${name}"? Rows will cascade.`)) return
    try {
      await window.akabiz.datatables.delete(id)
      if (selected?.id === id) setSelected(null)
      await reload()
    } catch (e) { alert((e as Error).message) }
  }

  if (selected) {
    return <DataTableDetail dt={selected} onBack={() => setSelected(null)} onUpdate={reload} />
  }

  if (loading) return <div className="empty">Loading…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>{error}</div>

  return (
    <div>
      <div className="row">
        <h2>DataTables ({tables.length})</h2>
        <button className="primary" onClick={handleNew}>+ New DataTable</button>
      </div>
      {tables.length === 0 && <div className="empty">Chưa có DataTable.</div>}
      {tables.length > 0 && (
        <table className="list-table">
          <thead><tr><th>Name</th><th>Description</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {tables.map(t => (
              <tr key={t.id} onClick={() => setSelected(t)}>
                <td>{t.name}</td>
                <td style={{ color: '#888', fontSize: 12 }}>{t.description ?? '—'}</td>
                <td style={{ fontSize: 11 }}>{new Date(t.created_at).toLocaleDateString()}</td>
                <td><button onClick={(e) => { e.stopPropagation(); void handleDelete(t.id, t.name) }} style={{ background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b', padding: '4px 8px', fontSize: 11 }}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface DetailProps { dt: DataTableRow; onBack: () => void; onUpdate: () => Promise<void> }

function DataTableDetail({ dt, onBack, onUpdate }: DetailProps): JSX.Element {
  const [rows, setRows] = useState<DataTableRowItem[]>([])
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [showAddRow, setShowAddRow] = useState(false)
  const [newRowJson, setNewRowJson] = useState('{}')

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const args: { datatableId: string; status?: string; limit: number } = { datatableId: dt.id, limit: 200 }
      if (filterStatus) args.status = filterStatus
      const list = await window.akabiz.datatables.rowsList(args)
      setRows(list)
    } finally { setLoading(false) }
  }, [dt.id, filterStatus])

  useEffect(() => { void loadRows() }, [loadRows])

  const handleAddRow = async (): Promise<void> => {
    let data: Record<string, unknown>
    try { data = JSON.parse(newRowJson) } catch { alert('Invalid JSON'); return }
    await window.akabiz.datatables.rowSave({ datatableId: dt.id, data, status: 'pending' })
    setNewRowJson('{}')
    setShowAddRow(false)
    await loadRows()
  }

  const handleResetRow = async (id: string): Promise<void> => {
    await window.akabiz.datatables.rowReset(id)
    await loadRows()
  }

  const handleDeleteRow = async (id: string): Promise<void> => {
    if (!confirm('Delete row?')) return
    await window.akabiz.datatables.rowDelete(id)
    await loadRows()
  }

  const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {} as Record<string, number>)

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0 }}>{dt.name}</h2>
        <span style={{ color: '#888', fontSize: 12 }}>{dt.description ?? ''}</span>
      </div>

      <div className="row">
        <strong>Rows:</strong>
        <span className="badge pending">pending {counts.pending ?? 0}</span>
        <span className="badge running">in_progress {counts.in_progress ?? 0}</span>
        <span className="badge success">done {counts.done ?? 0}</span>
        <span className="badge error">failed {counts.failed ?? 0}</span>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ marginLeft: 'auto' }}>
          <option value="">All</option>
          <option value="pending">pending</option>
          <option value="in_progress">in_progress</option>
          <option value="done">done</option>
          <option value="failed">failed</option>
        </select>
        <button className="primary" onClick={() => setShowAddRow(true)}>+ Row</button>
      </div>

      {showAddRow && (
        <div style={{ background: '#1a1f2c', padding: 12, borderRadius: 6, marginBottom: 12, border: '1px solid #2a3142' }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Row data (JSON)</label>
          <textarea value={newRowJson} onChange={e => setNewRowJson(e.target.value)} style={{ width: '100%', minHeight: 80, fontFamily: 'monospace' }} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={handleAddRow}>💾 Add</button>
            <button onClick={() => setShowAddRow(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading && <div className="empty">Loading rows…</div>}
      {!loading && rows.length === 0 && <div className="empty">No rows.</div>}
      {!loading && rows.length > 0 && (
        <table className="list-table">
          <thead><tr><th>Status</th><th>Data</th><th>Retry</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><span className={`badge ${r.status === 'done' ? 'success' : r.status === 'failed' ? 'error' : r.status === 'in_progress' ? 'running' : 'pending'}`}>{r.status}</span></td>
                <td style={{ fontFamily: 'monospace', fontSize: 11, maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {JSON.stringify(r.data)}
                </td>
                <td>{r.retry_count}</td>
                <td style={{ fontSize: 11, color: '#888' }}>{r.updated_at ? new Date(r.updated_at).toLocaleString() : '-'}</td>
                <td>
                  <button onClick={() => void handleResetRow(r.id)} style={{ padding: '4px 8px', fontSize: 11, marginRight: 4 }}>↺ Reset</button>
                  <button onClick={() => void handleDeleteRow(r.id)} style={{ background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b', padding: '4px 8px', fontSize: 11 }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'none' }}>{onUpdate.toString()}</div>
    </div>
  )
}
