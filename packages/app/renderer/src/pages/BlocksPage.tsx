import { useEffect, useState, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import type { WorkflowListItem } from '../../../shared/ipcChannels'

interface BlockRow {
  manifest_id: string
  name: string
  version: string
  kind: 'core' | 'adapter' | 'code' | 'composite'
  runtime: 'control' | 'page' | 'node' | 'composite'
  requires: 'browser' | 'none'
  manifest: Record<string, unknown>
  code: string | null
  workflow_ref: string | null
  source: string | null
  created_at: string
  updated_at: string | null
}

export function BlocksPage(): JSX.Element {
  const [blocks, setBlocks] = useState<BlockRow[]>([])
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<BlockRow | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [createMode, setCreateMode] = useState<'code' | 'composite' | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [bs, wfs] = await Promise.all([
        window.akabiz.customBlocks.list() as Promise<BlockRow[]>,
        window.akabiz.workflows.list()
      ])
      setBlocks(bs)
      setWorkflows(wfs)
      setError(null)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const handleDelete = async (manifestId: string): Promise<void> => {
    if (!confirm(`Delete block "${manifestId}"?`)) return
    await window.akabiz.customBlocks.delete(manifestId)
    await reload()
  }

  const userBlocks = blocks.filter(b => b.kind === 'code' || b.kind === 'composite')

  if (loading) return <div className="empty">Loading…</div>
  if (error) return <div className="empty" style={{ color: '#fca5a5' }}>{error}</div>

  return (
    <div>
      <div className="row">
        <h2>Custom Blocks ({userBlocks.length})</h2>
        <div style={{ position: 'relative' }}>
          <button className="primary" onClick={() => setShowCreateMenu(s => !s)}>+ New block ▾</button>
          {showCreateMenu && (
            <div style={{ position: 'absolute', top: '100%', right: 0, background: '#1a1f2c', border: '1px solid #2a3142', borderRadius: 6, padding: 4, minWidth: 200, zIndex: 10, marginTop: 4 }}>
              <button style={{ width: '100%', textAlign: 'left', marginBottom: 2 }} onClick={() => { setCreateMode('code'); setShowCreateMenu(false) }}>
                💻 Code block (JS)
              </button>
              <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { setCreateMode('composite'); setShowCreateMenu(false) }}>
                📦 Composite block (sub-workflow)
              </button>
            </div>
          )}
        </div>
      </div>
      <p style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
        Custom blocks reuse được trong nhiều workflow. Code block: JS với schema input/output, runtime page (DOM) hoặc node (sandbox isolated-vm).
        Composite block: wrap 1 workflow thành block tái dùng.
      </p>

      {createMode === 'code' && (
        <CodeBlockForm onCancel={() => setCreateMode(null)} onSaved={async () => { setCreateMode(null); await reload() }} />
      )}
      {createMode === 'composite' && (
        <CompositeBlockForm
          workflows={workflows}
          onCancel={() => setCreateMode(null)}
          onSaved={async () => { setCreateMode(null); await reload() }}
        />
      )}
      {editing && editing.kind === 'code' && (
        <CodeBlockForm initial={editing} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} />
      )}

      {userBlocks.length === 0 && !createMode && !editing && (
        <div className="empty">Chưa có custom block. Click "+ New block".</div>
      )}

      {userBlocks.length > 0 && (
        <table className="list-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Manifest ID</th><th>Name</th><th>Kind</th><th>Runtime</th><th>Requires</th><th>Version</th><th></th></tr></thead>
          <tbody>
            {userBlocks.map(b => (
              <tr key={b.manifest_id}>
                <td><code>{b.manifest_id}</code></td>
                <td>{b.name}</td>
                <td><span className={`badge ${b.kind === 'code' ? 'pending' : 'success'}`}>{b.kind}</span></td>
                <td><span className="badge running">{b.runtime}</span></td>
                <td>{b.requires === 'browser' ? '🌐' : '—'}</td>
                <td>{b.version}</td>
                <td>
                  {b.kind === 'code' && (
                    <button onClick={() => setEditing(b)} style={{ padding: '4px 8px', fontSize: 11, marginRight: 4 }}>Edit</button>
                  )}
                  <button onClick={() => void handleDelete(b.manifest_id)} style={{ background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b', padding: '4px 8px', fontSize: 11 }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ========== Code Block Form ==========

interface CodeFormProps {
  initial?: BlockRow
  onCancel: () => void
  onSaved: () => Promise<void>
}

function CodeBlockForm({ initial, onCancel, onSaved }: CodeFormProps): JSX.Element {
  const [manifestId, setManifestId] = useState(initial?.manifest_id ?? 'user.')
  const [name, setName] = useState(initial?.name ?? '')
  const [runtime, setRuntime] = useState<'page' | 'node'>(initial?.runtime === 'page' ? 'page' : 'node')
  const [code, setCode] = useState(initial?.code ?? `async function main(input, ctx) {
  // input: { ... }
  // ctx: { secrets, console, fetch (page-runtime only) }
  return { result: input.x }
}
`)
  const [inputSchemaJson, setInputSchemaJson] = useState(
    JSON.stringify(initial?.manifest.inputSchema ?? [{ name: 'x', type: 'string', label: 'X', required: true }], null, 2)
  )
  const [outputSchemaJson, setOutputSchemaJson] = useState(
    JSON.stringify(initial?.manifest.outputSchema ?? [{ name: 'result', type: 'any', label: 'Result' }], null, 2)
  )
  const [requires, setRequires] = useState<'browser' | 'none'>(initial?.requires ?? 'none')
  const [permissionsJson, setPermissionsJson] = useState(
    JSON.stringify(initial?.manifest.permissions ?? { modules: [], timeoutMs: 30000 }, null, 2)
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = async (): Promise<void> => {
    if (!manifestId.trim() || !name.trim() || !code.trim()) {
      setErr('manifest_id, name, code đều bắt buộc')
      return
    }
    let inputSchema, outputSchema, permissions
    try {
      inputSchema = JSON.parse(inputSchemaJson)
      outputSchema = JSON.parse(outputSchemaJson)
      permissions = permissionsJson.trim() ? JSON.parse(permissionsJson) : undefined
    } catch (e) {
      setErr(`Schema/permissions JSON invalid: ${(e as Error).message}`)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await window.akabiz.customBlocks.save({
        manifest_id: manifestId.trim(),
        name: name.trim(),
        version: initial?.version ?? '1.0.0',
        kind: 'code',
        runtime,
        requires: requires === 'browser' || runtime === 'page' ? 'browser' : 'none',
        manifest: {
          ui: { icon: 'Code', category: 'custom', description: name.trim() },
          inputSchema,
          outputSchema,
          permissions
        },
        code,
        source: 'user'
      })
      await onSaved()
    } catch (e) { setErr((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: '#1a1f2c', padding: 16, borderRadius: 6, marginTop: 12, border: '1px solid #2a3142' }}>
      <h3 style={{ marginBottom: 12 }}>{initial ? `Edit code block "${initial.manifest_id}"` : 'New code block'}</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Manifest ID *</label>
          <input value={manifestId} onChange={e => setManifestId(e.target.value)} disabled={!!initial} placeholder="user.parseEmoji" style={{ width: '100%', fontFamily: 'monospace' }} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Parse Emoji" style={{ width: '100%' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Runtime</label>
          <select value={runtime} onChange={e => { const v = e.target.value as 'page' | 'node'; setRuntime(v); if (v === 'page') setRequires('browser') }} style={{ width: '100%' }}>
            <option value="node">node (isolated-vm sandbox, no DOM)</option>
            <option value="page">page (executeJavaScript trong webview)</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Requires</label>
          <select value={requires} onChange={e => setRequires(e.target.value as 'browser' | 'none')} disabled={runtime === 'page'} style={{ width: '100%' }}>
            <option value="none">none</option>
            <option value="browser">browser (cần channel)</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Code (JavaScript)</label>
        <div style={{ height: 280, border: '1px solid #2a3142', borderRadius: 4, overflow: 'hidden' }}>
          <Editor
            height="100%"
            language="javascript"
            theme="vs-dark"
            value={code}
            onChange={(v) => setCode(v ?? '')}
            options={{ minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
          />
        </div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
          Phải khai báo <code>async function main(input, ctx) &#123; ... &#125;</code>. Return value sẽ là output của block.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Input schema (JSON)</label>
          <textarea value={inputSchemaJson} onChange={e => setInputSchemaJson(e.target.value)} style={{ width: '100%', minHeight: 80, fontFamily: 'monospace', fontSize: 11 }} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Output schema (JSON)</label>
          <textarea value={outputSchemaJson} onChange={e => setOutputSchemaJson(e.target.value)} style={{ width: '100%', minHeight: 80, fontFamily: 'monospace', fontSize: 11 }} />
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Permissions (JSON, optional)</label>
        <textarea value={permissionsJson} onChange={e => setPermissionsJson(e.target.value)} style={{ width: '100%', minHeight: 60, fontFamily: 'monospace', fontSize: 11 }} placeholder='{ "modules": ["axios"], "timeoutMs": 30000 }' />
        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
          Allowed modules (node-runtime): axios, lodash, dayjs, uuid, crypto-js, jsonata
        </div>
      </div>

      {err && <div style={{ color: '#fca5a5', marginTop: 8, fontSize: 12 }}>{err}</div>}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : '💾 Save block'}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ========== Composite Block Form ==========

interface CompositeFormProps {
  workflows: WorkflowListItem[]
  onCancel: () => void
  onSaved: () => Promise<void>
}

function CompositeBlockForm({ workflows, onCancel, onSaved }: CompositeFormProps): JSX.Element {
  const [manifestId, setManifestId] = useState('user.')
  const [name, setName] = useState('')
  const [workflowId, setWorkflowId] = useState('')
  const [requires, setRequires] = useState<'browser' | 'none'>('none')
  const [inputSchemaJson, setInputSchemaJson] = useState('[]')
  const [outputSchemaJson, setOutputSchemaJson] = useState('[]')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = async (): Promise<void> => {
    if (!manifestId.trim() || !name.trim() || !workflowId) {
      setErr('manifest_id, name, workflow đều bắt buộc')
      return
    }
    let inputSchema, outputSchema
    try {
      inputSchema = JSON.parse(inputSchemaJson)
      outputSchema = JSON.parse(outputSchemaJson)
    } catch (e) {
      setErr(`Schema JSON invalid: ${(e as Error).message}`)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await window.akabiz.customBlocks.save({
        manifest_id: manifestId.trim(),
        name: name.trim(),
        version: '1.0.0',
        kind: 'composite',
        runtime: 'composite',
        requires,
        manifest: {
          ui: { icon: 'Box', category: 'custom', description: name.trim() },
          inputSchema,
          outputSchema
        },
        workflow_ref: workflowId,
        source: 'user'
      })
      await onSaved()
    } catch (e) { setErr((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background: '#1a1f2c', padding: 16, borderRadius: 6, marginTop: 12, border: '1px solid #2a3142' }}>
      <h3 style={{ marginBottom: 12 }}>New composite block</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Manifest ID *</label>
          <input value={manifestId} onChange={e => setManifestId(e.target.value)} placeholder="user.fb_post_comment" style={{ width: '100%', fontFamily: 'monospace' }} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="FB Post Comment" style={{ width: '100%' }} />
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Wraps workflow *</label>
        <select value={workflowId} onChange={e => setWorkflowId(e.target.value)} style={{ width: '100%' }}>
          <option value="">— Choose workflow —</option>
          {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
          Composite block sẽ chạy workflow này khi được kéo vào workflow khác. Input/output schema phải match.
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Requires</label>
        <select value={requires} onChange={e => setRequires(e.target.value as 'browser' | 'none')} style={{ width: '100%' }}>
          <option value="none">none</option>
          <option value="browser">browser (cần channel)</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Input schema (JSON)</label>
          <textarea value={inputSchemaJson} onChange={e => setInputSchemaJson(e.target.value)} style={{ width: '100%', minHeight: 80, fontFamily: 'monospace', fontSize: 11 }} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#888' }}>Output schema (JSON)</label>
          <textarea value={outputSchemaJson} onChange={e => setOutputSchemaJson(e.target.value)} style={{ width: '100%', minHeight: 80, fontFamily: 'monospace', fontSize: 11 }} />
        </div>
      </div>

      {err && <div style={{ color: '#fca5a5', marginTop: 8, fontSize: 12 }}>{err}</div>}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : '💾 Save block'}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
