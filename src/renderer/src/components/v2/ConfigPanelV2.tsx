import { useState } from 'react'
import { useWorkflowV2Store } from '../../stores/workflowV2Store'
import { useBlockLibraryStore } from '../../stores/blockLibraryStore'
import { BlockConfigField } from '../../../../shared/v2Types'
import CodeEditorDrawer from './CodeEditorDrawer'

export default function ConfigPanelV2() {
  const { current: workflow, selectedNodeId, updateNodeConfig, updateNodeCodeOverride } = useWorkflowV2Store()
  const { getById } = useBlockLibraryStore()
  const [codeOpen, setCodeOpen] = useState(false)

  const node = workflow?.nodes.find(n => n.id === selectedNodeId)
  const block = node ? getById(node.blockId) : null

  if (!node || !block) {
    return (
      <div style={{
        width: 320, minWidth: 320,
        borderLeft: '1px solid var(--border, #2a2a35)',
        background: 'var(--bg-secondary, #16161e)',
        padding: 12, fontSize: 12, color: '#888'
      }}>
        Chọn 1 node trên canvas để cấu hình.
      </div>
    )
  }

  const setField = (name: string, value: unknown) => {
    updateNodeConfig(node.id, { ...node.config, [name]: value })
  }

  const codeShown = node.codeOverride ?? block.code
  const isOverride = node.codeOverride !== undefined && node.codeOverride !== null

  return (
    <>
      <div style={{
        width: 320, minWidth: 320,
        borderLeft: '1px solid var(--border, #2a2a35)',
        background: 'var(--bg-secondary, #16161e)',
        display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{ padding: 12, borderBottom: '1px solid var(--border, #2a2a35)' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text, #e0e0e0)' }}>{block.name}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{block.description}</div>
        </div>

        {/* Config fields */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Cấu hình</div>
          {block.configSchema.length === 0 && (
            <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic' }}>(Block không có config)</div>
          )}
          {block.configSchema.map(field => (
            <ConfigField key={field.name} field={field} value={node.config?.[field.name]} onChange={(v) => setField(field.name, v)} />
          ))}

          {/* Label */}
          <div style={{ marginTop: 16, marginBottom: 8, fontSize: 11, color: '#888' }}>Hiển thị trên canvas</div>
          <input
            type="text"
            value={node.label ?? ''}
            placeholder={block.name}
            onChange={(e) => useWorkflowV2Store.getState().upsertNode({ ...node, label: e.target.value })}
            style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: 'var(--bg-primary, #0e0e15)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, color: 'var(--text, #e0e0e0)' }}
          />
        </div>

        {/* Footer: Edit code */}
        {block.kind === 'js' && (
          <div style={{ padding: 12, borderTop: '1px solid var(--border, #2a2a35)' }}>
            <button className="btn btn-sm" style={{ width: '100%' }} onClick={() => setCodeOpen(true)}>
              {isOverride ? 'Sửa code (đang override)' : 'Sửa code (dùng mặc định)'}
            </button>
            {isOverride && (
              <button className="btn btn-sm btn-ghost" style={{ width: '100%', marginTop: 4 }} onClick={() => updateNodeCodeOverride(node.id, undefined)}>
                Reset về code mặc định của block
              </button>
            )}
          </div>
        )}
      </div>

      <CodeEditorDrawer
        open={codeOpen}
        title={`Code: ${block.name} (instance ${node.id})`}
        initialCode={codeShown}
        hint="// Có thể dùng: input, vars, page, helpers, signal\n// Trả về object → output. Throws → block fail."
        onClose={() => setCodeOpen(false)}
        onSave={(code) => { updateNodeCodeOverride(node.id, code); setCodeOpen(false) }}
        onClear={isOverride ? () => { updateNodeCodeOverride(node.id, undefined); setCodeOpen(false) } : undefined}
      />
    </>
  )
}

function ConfigField({ field, value, onChange }: { field: BlockConfigField; value: unknown; onChange: (v: unknown) => void }) {
  const id = `cfg-${field.name}`
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 11, color: '#aaa', marginBottom: 4 }}>
        {field.label} {field.required && <span style={{ color: '#ef4444' }}>*</span>}
      </label>
      {(field.type === 'string' || field.type === 'number') && (
        <input
          id={id}
          type={field.type === 'number' ? 'number' : 'text'}
          value={value === undefined || value === null ? '' : String(value)}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
          style={fieldStyle}
        />
      )}
      {field.type === 'boolean' && (
        <input
          id={id}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
      {field.type === 'select' && (
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={fieldStyle}>
          <option value="">--</option>
          {(field.options ?? []).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
      {(field.type === 'textarea' || field.type === 'code') && (
        <textarea
          id={id}
          value={value === undefined || value === null ? '' : String(value)}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          rows={field.type === 'code' ? 3 : 4}
          style={{ ...fieldStyle, fontFamily: field.type === 'code' ? 'monospace' : 'inherit', minHeight: 60 }}
        />
      )}
      {field.type === 'json' && (
        <textarea
          id={id}
          value={value === undefined || value === null ? '' : (typeof value === 'string' ? value : JSON.stringify(value, null, 2))}
          placeholder={field.placeholder}
          onChange={(e) => {
            try { onChange(JSON.parse(e.target.value)) } catch { onChange(e.target.value) }
          }}
          rows={4}
          style={{ ...fieldStyle, fontFamily: 'monospace', minHeight: 80 }}
        />
      )}
      {field.description && (
        <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{field.description}</div>
      )}
    </div>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 12,
  background: 'var(--bg-primary, #0e0e15)',
  border: '1px solid var(--border, #2a2a35)', borderRadius: 4,
  color: 'var(--text, #e0e0e0)'
}
