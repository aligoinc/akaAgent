import { useEffect, useMemo, useRef, useState } from 'react'
import { useElementLibraryStore } from '../../stores/elementLibraryStore'
import { ElementDef } from '../../../../shared/v2Types'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ElementCrudModal({ open, onClose }: Props) {
  const { elements, loadElements, upsertElement, removeElement } = useElementLibraryStore()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Partial<ElementDef> | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    if (open) loadElements()
  }, [open, loadElements])

  const filtered = useMemo(() => {
    if (!search.trim()) return elements
    const q = search.toLowerCase()
    return elements.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.xpath.toLowerCase().includes(q) ||
      (e.description ?? '').toLowerCase().includes(q)
    )
  }, [elements, search])

  if (!open) return null

  const onSave = async () => {
    if (busyRef.current) return
    if (!editing?.name || !editing?.xpath) { alert('Cần name + xpath'); return }
    busyRef.current = true
    setBusy(true)
    try {
      const saved = await window.electronAPI.v2.saveElement({
        name: editing.name,
        xpath: editing.xpath,
        description: editing.description,
        category: editing.category
      })
      upsertElement(saved)
      setEditing(null)
    } catch (err: any) {
      alert('Lỗi: ' + err.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const onDelete = async (el: ElementDef) => {
    if (busyRef.current) return
    if (el.isBuiltin) { alert('Không xóa được element built-in'); return }
    if (!confirm(`Xóa element "${el.name}"?`)) return
    busyRef.current = true
    setBusy(true)
    try {
      await window.electronAPI.v2.deleteElement(el.id)
      removeElement(el.id)
    } catch (err: any) {
      alert('Lỗi xóa: ' + err.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!busyRef.current) onClose() }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 800, maxWidth: '95vw', height: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <span className="modal-title">XPath Elements ({elements.length})</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'center', borderBottom: '1px solid var(--border, #2a2a35)' }}>
          <input
            type="text" placeholder="Tìm element..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, padding: '6px 8px', fontSize: 12, background: 'var(--bg-primary, #0e0e15)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, color: 'var(--text, #e0e0e0)' }}
          />
          <button className="btn btn-sm" onClick={() => setEditing({ name: '', xpath: '', category: 'custom' })} disabled={busy}>+ Tạo mới</button>
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: editing ? '1fr 360px' : '1fr', minHeight: 0 }}>
          <div style={{ overflowY: 'auto', padding: 12 }}>
            {filtered.length === 0 && <div style={{ color: '#666', fontSize: 12, textAlign: 'center', padding: 20 }}>Không có element nào.</div>}
            {filtered.map(el => (
              <div key={el.id} style={{
                padding: 8, marginBottom: 6, fontSize: 12,
                background: 'var(--bg-primary, #0e0e15)',
                border: '1px solid var(--border, #2a2a35)', borderRadius: 4,
                cursor: 'pointer'
              }} onClick={() => setEditing(el)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 500, color: 'var(--text, #e0e0e0)' }}>{el.name}</span>
                  {el.isBuiltin && <span style={{ fontSize: 10, color: '#7c3aed' }}>builtin</span>}
                  {el.category && <span style={{ fontSize: 10, color: '#888' }}>· {el.category}</span>}
                  <div style={{ flex: 1 }} />
                  {!el.isBuiltin && (
                    <button className="btn btn-sm btn-ghost" onClick={(ev) => { ev.stopPropagation(); onDelete(el) }} disabled={busy}>Xóa</button>
                  )}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#888', wordBreak: 'break-all', marginTop: 4 }}>{el.xpath}</div>
                {el.description && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{el.description}</div>}
              </div>
            ))}
          </div>

          {editing && (
            <div style={{ padding: 12, borderLeft: '1px solid var(--border, #2a2a35)', overflowY: 'auto' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text, #e0e0e0)', marginBottom: 12 }}>
                {editing.id ? 'Edit' : 'Tạo mới'}
              </div>
              <Field label="Name (UNIQUE, snake_case)">
                <input value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} disabled={!!editing.isBuiltin} style={fieldStyle} />
              </Field>
              <Field label="XPath / CSS selector">
                <textarea value={editing.xpath ?? ''} onChange={e => setEditing({ ...editing, xpath: e.target.value })} rows={4} style={{ ...fieldStyle, fontFamily: 'monospace' }} />
                <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>Có thể chứa placeholder dạng <code>{"${n}"}</code>, dùng <code>helpers.elementWith('name', {"{ n: 3 }"})</code>.</div>
              </Field>
              <Field label="Description">
                <input value={editing.description ?? ''} onChange={e => setEditing({ ...editing, description: e.target.value })} style={fieldStyle} />
              </Field>
              <Field label="Category">
                <input value={editing.category ?? ''} onChange={e => setEditing({ ...editing, category: e.target.value })} placeholder="facebook | common | custom" style={fieldStyle} />
              </Field>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Hủy</button>
                <button className="btn btn-sm" onClick={onSave} disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
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
