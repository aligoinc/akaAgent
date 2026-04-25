import { useEffect, useState, useCallback } from 'react'
import type { TriggerRow, WorkflowListItem, ChannelListItem, DataTableRow } from '../../../shared/ipcChannels'

export function TriggersPage(): JSX.Element {
  const [triggers, setTriggers] = useState<TriggerRow[]>([])
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([])
  const [channels, setChannels] = useState<ChannelListItem[]>([])
  const [datatables, setDatatables] = useState<DataTableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<TriggerRow | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [tg, wf, ch, dt] = await Promise.all([
        window.akabiz.triggers.list(),
        window.akabiz.workflows.list(),
        window.akabiz.channels.list(),
        window.akabiz.datatables.list()
      ])
      setTriggers(tg)
      setWorkflows(wf)
      setChannels(ch)
      setDatatables(dt)
      setError(null)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('Delete trigger?')) return
    await window.akabiz.triggers.delete(id)
    await reload()
  }

  const handleRunNow = async (id: string): Promise<void> => {
    try {
      await window.akabiz.triggers.runNow(id)
      alert('Trigger fired. Check Runs tab for progress.')
    } catch (e) {
      alert((e as Error).message)
    }
  }

  if (loading) return <div className="empty">Loading…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>{error}</div>

  return (
    <div>
      <div className="row">
        <h2>Triggers ({triggers.length})</h2>
        <button className="primary" onClick={() => { setEditing(null); setShowForm(true) }}>+ New trigger</button>
      </div>

      {(showForm || editing) && (
        <TriggerForm
          initial={editing}
          workflows={workflows}
          channels={channels}
          datatables={datatables}
          onCancel={() => { setShowForm(false); setEditing(null) }}
          onSaved={async () => { setShowForm(false); setEditing(null); await reload() }}
        />
      )}

      {triggers.length === 0 && !showForm && <div className="empty">No triggers.</div>}
      {triggers.length > 0 && (
        <table className="list-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Kind</th>
              <th>Schedule</th>
              <th>Channel</th>
              <th>DataTable</th>
              <th>Active</th>
              <th>Next run</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {triggers.map(t => {
              const wf = workflows.find(w => w.id === t.workflow_id)
              const ch = channels.find(c => c.id === t.channel_id)
              const dt = datatables.find(d => d.id === t.datatable_id)
              return (
                <tr key={t.id}>
                  <td>{wf?.name ?? t.workflow_id.slice(0, 8)}</td>
                  <td><span className="badge pending">{t.kind}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{String(t.config.cron ?? '-')}</td>
                  <td>{ch?.name ?? '-'}</td>
                  <td>{dt?.name ?? '-'}</td>
                  <td>{t.is_active ? '✅' : '⏸'}</td>
                  <td style={{ fontSize: 11 }}>{t.next_run_at ? new Date(t.next_run_at).toLocaleString() : '-'}</td>
                  <td>
                    <button onClick={() => void handleRunNow(t.id)} style={{ padding: '4px 8px', fontSize: 11, marginRight: 4 }}>▶ Run now</button>
                    <button onClick={() => setEditing(t)} style={{ padding: '4px 8px', fontSize: 11, marginRight: 4 }}>Edit</button>
                    <button onClick={() => void handleDelete(t.id)} style={{ background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b', padding: '4px 8px', fontSize: 11 }}>🗑</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface FormProps {
  initial: TriggerRow | null
  workflows: WorkflowListItem[]
  channels: ChannelListItem[]
  datatables: DataTableRow[]
  onCancel: () => void
  onSaved: () => Promise<void>
}

function TriggerForm({ initial, workflows, channels, datatables, onCancel, onSaved }: FormProps): JSX.Element {
  const [workflowId, setWorkflowId] = useState(initial?.workflow_id ?? '')
  const [channelId, setChannelId] = useState(initial?.channel_id ?? '')
  const [datatableId, setDatatableId] = useState(initial?.datatable_id ?? '')
  const [datatableFilter, setDatatableFilter] = useState(JSON.stringify(initial?.datatable_filter ?? { where: { status: 'pending' }, limit: 50 }, null, 2))
  const [kind, setKind] = useState<'manual' | 'schedule' | 'webhook' | 'event'>(initial?.kind ?? 'schedule')
  const [cron, setCron] = useState(String(initial?.config?.cron ?? '0 8 * * *'))
  const [timezone, setTimezone] = useState(String(initial?.config?.timezone ?? 'Asia/Ho_Chi_Minh'))
  const [eventName, setEventName] = useState(String(initial?.config?.eventName ?? ''))
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = async (): Promise<void> => {
    if (!workflowId) { setErr('Workflow required'); return }
    setSaving(true)
    setErr(null)
    try {
      let config: Record<string, unknown>
      if (kind === 'schedule') config = { cron, timezone }
      else if (kind === 'event') config = { eventName }
      else config = {}

      let filter: Record<string, unknown> | null = null
      if (datatableFilter && datatableId) {
        try { filter = JSON.parse(datatableFilter) } catch (e) { setErr(`Invalid filter: ${(e as Error).message}`); setSaving(false); return }
      }

      const args: Record<string, unknown> = {
        workflow_id: workflowId,
        channel_id: channelId || null,
        datatable_id: datatableId || null,
        datatable_filter: filter,
        kind,
        config,
        is_active: isActive
      }
      if (initial) args.id = initial.id

      await window.akabiz.triggers.save(args)
      await onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <div style={{ background: '#1a1f2c', padding: 16, borderRadius: 6, marginTop: 12, border: '1px solid #2a3142' }}>
      <h3 style={{ marginBottom: 12 }}>{initial ? 'Edit trigger' : 'New trigger'}</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Workflow *</label>
          <select value={workflowId} onChange={e => setWorkflowId(e.target.value)} style={{ width: '100%' }}>
            <option value="">— Choose —</option>
            {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Kind</label>
          <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} style={{ width: '100%' }}>
            <option value="manual">manual</option>
            <option value="schedule">schedule</option>
            <option value="webhook">webhook (Phase later)</option>
            <option value="event">event</option>
          </select>
        </div>
      </div>

      {kind === 'schedule' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 8 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Cron</label>
            <input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 8 * * *" style={{ width: '100%', fontFamily: 'monospace' }} />
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              vd: <code>0 8 * * *</code> 8h sáng mỗi ngày | <code>*/30 * * * *</code> mỗi 30 phút
            </div>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Timezone</label>
            <input value={timezone} onChange={e => setTimezone(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
      )}

      {kind === 'event' && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Event name</label>
          <input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="leads.scraped" style={{ width: '100%' }} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Channel (optional)</label>
          <select value={channelId} onChange={e => setChannelId(e.target.value)} style={{ width: '100%' }}>
            <option value="">— No channel —</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>DataTable (fan-out, optional)</label>
          <select value={datatableId} onChange={e => setDatatableId(e.target.value)} style={{ width: '100%' }}>
            <option value="">— No fan-out —</option>
            {datatables.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      {datatableId && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>DataTable filter (JSON)</label>
          <textarea value={datatableFilter} onChange={e => setDatatableFilter(e.target.value)} style={{ width: '100%', minHeight: 60, fontFamily: 'monospace' }} />
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <label><input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Active</label>
      </div>

      {err && <div style={{ color: '#fca5a5', marginTop: 8, fontSize: 12 }}>{err}</div>}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : '💾 Save'}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
