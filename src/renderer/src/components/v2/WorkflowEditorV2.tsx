import { useEffect, useState } from 'react'
import BlockLibraryPanel from './BlockLibraryPanel'
import WorkflowCanvasV2 from './WorkflowCanvasV2'
import ConfigPanelV2 from './ConfigPanelV2'
import TestPanelV2 from './TestPanelV2'
import BlockCrudModal from './BlockCrudModal'
import ElementCrudModal from './ElementCrudModal'
import { useWorkflowV2Store } from '../../stores/workflowV2Store'
import { useBlockLibraryStore } from '../../stores/blockLibraryStore'
import { BlockDef, WorkflowDef } from '../../../../shared/v2Types'
import { FileText, Save, Search, X } from 'lucide-react'

export default function WorkflowEditorV2() {
  const { current: workflow, workflows, loadWorkflows, loadWorkflow, newWorkflow, saveCurrent, selectedNodeId, setVariables, setDefaultVariables } = useWorkflowV2Store()
  const { loadBlocks } = useBlockLibraryStore()
  const [editingBlock, setEditingBlock] = useState<BlockDef | null | undefined>(undefined)
  const [showWorkflowList, setShowWorkflowList] = useState(false)
  const [showElementModal, setShowElementModal] = useState(false)
  const [editingMeta, setEditingMeta] = useState(false)

  useEffect(() => {
    loadBlocks()
    loadWorkflows()
  }, [loadBlocks, loadWorkflows])

  const handleSave = async () => {
    if (!workflow) return
    try {
      await saveCurrent()
      alert('Lưu workflow thành công')
    } catch (err: any) {
      alert('Lỗi lưu: ' + err.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border, #2a2a35)', background: 'var(--bg-primary, #0e0e15)', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text, #e0e0e0)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {workflow && <FileText size={14} />}
          {workflow ? workflow.name : 'Workflow Editor v2'}
        </span>
        {workflow && (
          <button className="btn btn-sm btn-ghost" onClick={() => setEditingMeta(true)}>Sửa meta</button>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => setShowElementModal(true)}><Search size={13} /> Elements</button>
        <button className="btn btn-sm" onClick={handleSave} disabled={!workflow}><Save size={13} /> Lưu</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <BlockLibraryPanel
          onOpenBlockEditor={(b) => setEditingBlock(b)}
          onOpenWorkflowList={() => { loadWorkflows(); setShowWorkflowList(true) }}
          onNewWorkflow={() => newWorkflow()}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <WorkflowCanvasV2 />
          <TestPanelV2 />
        </div>
        {selectedNodeId && <ConfigPanelV2 />}
      </div>

      {/* Modals */}
      <BlockCrudModal
        open={editingBlock !== undefined}
        initialBlock={editingBlock ?? null}
        onClose={() => setEditingBlock(undefined)}
      />
      <ElementCrudModal open={showElementModal} onClose={() => setShowElementModal(false)} />

      {showWorkflowList && (
        <div className="modal-overlay" onClick={() => setShowWorkflowList(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 500 }}>
            <div className="modal-header">
              <span className="modal-title">Mở workflow ({workflows.length})</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowWorkflowList(false)} title="Đóng"><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: 500, overflowY: 'auto' }}>
              {workflows.length === 0 && <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>Chưa có workflow nào.</div>}
              {workflows.map(wf => (
                <div key={wf.id} style={{
                  padding: 8, marginBottom: 6, fontSize: 12,
                  background: 'var(--bg-primary, #0e0e15)',
                  border: '1px solid var(--border, #2a2a35)', borderRadius: 4, cursor: 'pointer'
                }} onClick={async () => { await loadWorkflow(wf.id); setShowWorkflowList(false) }}>
                  <div style={{ fontWeight: 500, color: 'var(--text, #e0e0e0)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {wf.name}
                    {wf.isBuiltin && <span style={{ fontSize: 10, color: '#7c3aed' }}>builtin</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#888' }}>
                    {wf.nodes.length} nodes · {wf.edges.length} edges
                    {wf.updatedAt && ` · ${new Date(wf.updatedAt).toLocaleString()}`}
                  </div>
                  {wf.description && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{wf.description}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingMeta && workflow && (
        <WorkflowMetaModal workflow={workflow} onClose={() => setEditingMeta(false)} onSave={(meta) => {
          if (meta.variablesSchema) setVariables(meta.variablesSchema)
          if (meta.defaultVariables) setDefaultVariables(meta.defaultVariables)
          setEditingMeta(false)
        }} />
      )}
    </div>
  )
}

function WorkflowMetaModal({ workflow, onClose, onSave }: {
  workflow: WorkflowDef
  onClose: () => void
  onSave: (m: { variablesSchema?: WorkflowDef['variablesSchema']; defaultVariables?: Record<string, unknown> }) => void
}) {
  const [varsSchemaJson, setVarsSchemaJson] = useState(JSON.stringify(workflow.variablesSchema, null, 2))
  const [defaultVarsJson, setDefaultVarsJson] = useState(JSON.stringify(workflow.defaultVariables, null, 2))
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 600 }}>
        <div className="modal-header">
          <span className="modal-title">Meta: {workflow.name}</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Đóng"><X size={14} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#aaa', marginBottom: 4 }}>variables_schema (JSON array of fields)</label>
            <textarea value={varsSchemaJson} onChange={e => setVarsSchemaJson(e.target.value)} rows={8} style={{ width: '100%', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-primary, #0e0e15)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, color: 'var(--text, #e0e0e0)', padding: 6 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#aaa', marginBottom: 4 }}>default_variables (JSON, dùng cho test)</label>
            <textarea value={defaultVarsJson} onChange={e => setDefaultVarsJson(e.target.value)} rows={6} style={{ width: '100%', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-primary, #0e0e15)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, color: 'var(--text, #e0e0e0)', padding: 6 }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border, #2a2a35)', justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Hủy</button>
          <button className="btn btn-sm" onClick={() => {
            let varsSchema, defaultVars
            try { varsSchema = JSON.parse(varsSchemaJson) } catch { alert('variables_schema không hợp lệ'); return }
            try { defaultVars = JSON.parse(defaultVarsJson) } catch { alert('default_variables không hợp lệ'); return }
            onSave({ variablesSchema: varsSchema, defaultVariables: defaultVars })
          }}>Lưu</button>
        </div>
      </div>
    </div>
  )
}
