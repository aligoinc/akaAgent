import { useEffect, useState } from 'react'
import CodeEditorDrawer from './CodeEditorDrawer'
import { useBlockLibraryStore } from '../../stores/blockLibraryStore'
import { BlockDef, BlockCategory } from '../../../../shared/v2Types'

interface Props {
  open: boolean
  initialBlock: BlockDef | null
  onClose: () => void
}

const CATEGORIES: BlockCategory[] = ['navigation', 'interaction', 'data', 'utility', 'control', 'facebook', 'custom', 'file']

export default function BlockCrudModal({ open, initialBlock, onClose }: Props) {
  const { upsertBlock, removeBlock } = useBlockLibraryStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('Code')
  const [category, setCategory] = useState<BlockCategory>('custom')
  const [code, setCode] = useState('')
  const [configJson, setConfigJson] = useState('[]')
  const [outputJson, setOutputJson] = useState('[]')
  const [defaultJson, setDefaultJson] = useState('{}')
  const [codeOpen, setCodeOpen] = useState(false)

  useEffect(() => {
    if (open) {
      if (initialBlock) {
        setName(initialBlock.name)
        setDescription(initialBlock.description ?? '')
        setIcon(initialBlock.icon ?? 'Code')
        setCategory(initialBlock.category)
        setCode(initialBlock.code)
        setConfigJson(JSON.stringify(initialBlock.configSchema, null, 2))
        setOutputJson(JSON.stringify(initialBlock.outputSchema, null, 2))
        setDefaultJson(JSON.stringify(initialBlock.defaultConfig, null, 2))
      } else {
        setName('')
        setDescription('')
        setIcon('Code')
        setCategory('custom')
        setCode(`// Truy cập: input, vars, page, helpers, signal\nreturn {}\n`)
        setConfigJson('[]')
        setOutputJson('[]')
        setDefaultJson('{}')
      }
    }
  }, [open, initialBlock])

  if (!open) return null

  const onSave = async () => {
    let configSchema, outputSchema, defaultConfig
    try { configSchema = JSON.parse(configJson) } catch { alert('configSchema không hợp lệ'); return }
    try { outputSchema = JSON.parse(outputJson) } catch { alert('outputSchema không hợp lệ'); return }
    try { defaultConfig = JSON.parse(defaultJson) } catch { alert('defaultConfig không hợp lệ'); return }
    if (!name.trim()) { alert('Phải có name'); return }

    try {
      const saved = await window.electronAPI.v2.saveBlock({
        name, description, icon, category, kind: 'js',
        code, configSchema, outputSchema, defaultConfig
      })
      upsertBlock(saved)
      onClose()
    } catch (err: any) {
      alert('Lỗi save block: ' + err.message)
    }
  }

  const onDelete = async () => {
    if (!initialBlock || initialBlock.isBuiltin) return
    if (!confirm(`Xóa block "${initialBlock.name}"? Workflow đang dùng sẽ bị broken.`)) return
    try {
      await window.electronAPI.v2.deleteBlock(initialBlock.id)
      removeBlock(initialBlock.id)
      onClose()
    } catch (err: any) {
      alert('Lỗi xóa: ' + err.message)
    }
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 600, maxWidth: '90vw' }}>
          <div className="modal-header">
            <span className="modal-title">{initialBlock ? `Edit block: ${initialBlock.name}` : 'Tạo block custom'}</span>
            <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <FieldRow label="Name (UNIQUE, snake_case)">
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={!!initialBlock?.isBuiltin} style={fieldStyle} />
            </FieldRow>
            <FieldRow label="Description">
              <input value={description} onChange={(e) => setDescription(e.target.value)} style={fieldStyle} />
            </FieldRow>
            <FieldRow label="Icon (lucide-react name)">
              <input value={icon} onChange={(e) => setIcon(e.target.value)} style={fieldStyle} />
            </FieldRow>
            <FieldRow label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value as BlockCategory)} style={fieldStyle} disabled={!!initialBlock?.isBuiltin}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Code">
              <button className="btn btn-sm" onClick={() => setCodeOpen(true)}>Sửa code (Monaco)</button>
            </FieldRow>
            <FieldRow label="configSchema (JSON array)">
              <textarea value={configJson} onChange={(e) => setConfigJson(e.target.value)} style={{ ...fieldStyle, fontFamily: 'monospace', minHeight: 80 }} />
            </FieldRow>
            <FieldRow label="outputSchema (JSON array)">
              <textarea value={outputJson} onChange={(e) => setOutputJson(e.target.value)} style={{ ...fieldStyle, fontFamily: 'monospace', minHeight: 60 }} />
            </FieldRow>
            <FieldRow label="defaultConfig (JSON)">
              <textarea value={defaultJson} onChange={(e) => setDefaultJson(e.target.value)} style={{ ...fieldStyle, fontFamily: 'monospace', minHeight: 60 }} />
            </FieldRow>
          </div>
          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border, #2a2a35)' }}>
            {initialBlock && !initialBlock.isBuiltin && (
              <button className="btn btn-sm" onClick={onDelete} style={{ background: '#ef4444' }}>Xóa</button>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm btn-ghost" onClick={onClose}>Hủy</button>
            <button className="btn btn-sm" onClick={onSave}>Lưu</button>
          </div>
        </div>
      </div>

      <CodeEditorDrawer
        open={codeOpen}
        title={`Code: ${name || 'block'}`}
        initialCode={code}
        hint="// Block code: truy cập input, vars, page, helpers, signal\n// Trả về object → output. Throws → block fail."
        onClose={() => setCodeOpen(false)}
        onSave={(c) => { setCode(c); setCodeOpen(false) }}
      />
    </>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#aaa', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 12,
  background: 'var(--bg-primary, #0e0e15)',
  border: '1px solid var(--border, #2a2a35)', borderRadius: 4,
  color: 'var(--text, #e0e0e0)'
}
