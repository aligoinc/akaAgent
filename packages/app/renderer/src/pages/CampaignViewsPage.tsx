import { useEffect, useState, useCallback } from 'react'
import type { CampaignViewRow, WorkflowListItem, TriggerRow, DataTableRow } from '../../../shared/ipcChannels'

export function CampaignViewsPage(): JSX.Element {
  const [views, setViews] = useState<CampaignViewRow[]>([])
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([])
  const [triggers, setTriggers] = useState<TriggerRow[]>([])
  const [datatables, setDatatables] = useState<DataTableRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CampaignViewRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [v, wf, tg, dt] = await Promise.all([
        window.akabiz.campaignViews.list(),
        window.akabiz.workflows.list(),
        window.akabiz.triggers.list(),
        window.akabiz.datatables.list()
      ])
      setViews(v)
      setWorkflows(wf)
      setTriggers(tg)
      setDatatables(dt)
      setError(null)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('Delete campaign view?')) return
    await window.akabiz.campaignViews.delete(id)
    await reload()
  }

  if (loading) return <div className="empty">Loading…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>{error}</div>

  return (
    <div>
      <div className="row">
        <h2>Chiến dịch (Campaign Views) — {views.length}</h2>
        <button className="primary" onClick={() => { setEditing(null); setShowForm(true) }}>+ New campaign</button>
      </div>
      <p style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
        Chiến dịch chỉ là "view wrapper" gom Workflow + Trigger + DataTable lại để báo cáo. Logic 100% nằm trong Workflow.
      </p>

      {(showForm || editing) && (
        <CampaignForm
          initial={editing}
          workflows={workflows}
          triggers={triggers}
          datatables={datatables}
          onCancel={() => { setShowForm(false); setEditing(null) }}
          onSaved={async () => { setShowForm(false); setEditing(null); await reload() }}
        />
      )}

      {views.length === 0 && !showForm && <div className="empty">No campaigns.</div>}
      {views.length > 0 && (
        <table className="list-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Name</th><th>Workflow</th><th>Trigger</th><th>DataTable</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {views.map(v => (
              <tr key={v.id}>
                <td><strong>{v.name}</strong>{v.description && <div style={{ color: '#888', fontSize: 11 }}>{v.description}</div>}</td>
                <td>{workflows.find(w => w.id === v.workflow_id)?.name ?? '—'}</td>
                <td style={{ fontSize: 11, fontFamily: 'monospace' }}>{v.trigger_id ? v.trigger_id.slice(0, 8) : '—'}</td>
                <td>{datatables.find(d => d.id === v.datatable_id)?.name ?? '—'}</td>
                <td style={{ fontSize: 11 }}>{new Date(v.created_at).toLocaleDateString()}</td>
                <td>
                  <button onClick={() => setEditing(v)} style={{ padding: '4px 8px', fontSize: 11, marginRight: 4 }}>Edit</button>
                  <button onClick={() => void handleDelete(v.id)} style={{ background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b', padding: '4px 8px', fontSize: 11 }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface FormProps {
  initial: CampaignViewRow | null
  workflows: WorkflowListItem[]
  triggers: TriggerRow[]
  datatables: DataTableRow[]
  onCancel: () => void
  onSaved: () => Promise<void>
}

function CampaignForm({ initial, workflows, triggers, datatables, onCancel, onSaved }: FormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [workflowId, setWorkflowId] = useState(initial?.workflow_id ?? '')
  const [triggerId, setTriggerId] = useState(initial?.trigger_id ?? '')
  const [datatableId, setDatatableId] = useState(initial?.datatable_id ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) { setErr('Name required'); return }
    setSaving(true)
    setErr(null)
    try {
      const args: Parameters<typeof window.akabiz.campaignViews.save>[0] = {
        name: name.trim(),
        description: description.trim() || null,
        workflow_id: workflowId || null,
        trigger_id: triggerId || null,
        datatable_id: datatableId || null
      }
      if (initial) args.id = initial.id
      await window.akabiz.campaignViews.save(args)
      await onSaved()
    } catch (e) { setErr((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: '#1a1f2c', padding: 16, borderRadius: 6, marginTop: 12, border: '1px solid #2a3142' }}>
      <h3 style={{ marginBottom: 12 }}>{initial ? 'Edit campaign' : 'New campaign'}</h3>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Description</label>
        <input value={description} onChange={e => setDescription(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Workflow</label>
          <select value={workflowId} onChange={e => setWorkflowId(e.target.value)} style={{ width: '100%' }}>
            <option value="">—</option>
            {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Trigger</label>
          <select value={triggerId} onChange={e => setTriggerId(e.target.value)} style={{ width: '100%' }}>
            <option value="">—</option>
            {triggers.map(t => <option key={t.id} value={t.id}>{t.kind} ({t.id.slice(0, 8)})</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>DataTable</label>
          <select value={datatableId} onChange={e => setDatatableId(e.target.value)} style={{ width: '100%' }}>
            <option value="">—</option>
            {datatables.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
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
