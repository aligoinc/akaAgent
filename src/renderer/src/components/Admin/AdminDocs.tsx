import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Plus, Pencil, Trash2, Globe } from 'lucide-react'
import type { AdminApiDoc, AdminDocDescriptor, AdminDocInput } from '../../../../shared/admin'
import { api, Empty, ErrorNote, message, Modal, Reload, useAdminAction, useAdminQuery } from './common'

function DocForm({ doc, onClose, onSaved }: { doc?: AdminApiDoc; onClose: () => void; onSaved: () => void }) {
  const [input, setInput] = useState<AdminDocInput>(() => ({ id: doc?.id, name: doc?.name || '', url: doc?.url || '',
    description: doc?.description || '', sortOrder: doc?.sortOrder || 0, isActive: doc?.isActive ?? true, expectedVersion: doc?.version }))
  const action = useAdminAction()
  return <Modal title={doc ? 'Sửa tài liệu API' : 'Thêm tài liệu API'} onClose={onClose} busy={action.busy}>
    <form className="admin-form" onSubmit={event => { event.preventDefault(); void action.run(async () => { await api().saveDoc(input); onSaved() }) }}>
      <label>Tên hiển thị<input autoFocus required maxLength={200} value={input.name} onChange={e => setInput({ ...input, name: e.target.value })} /></label>
      <label>URL<input required type="url" placeholder="https://…" value={input.url} onChange={e => setInput({ ...input, url: e.target.value })} /></label>
      <label>Mô tả<textarea aria-label="Mô tả" rows={3} value={input.description} onChange={e => setInput({ ...input, description: e.target.value })} /></label>
      <label>Thứ tự<input required type="number" step="1" min={-2147483648} max={2147483647} value={input.sortOrder} onChange={e => setInput({ ...input, sortOrder: Number(e.target.value) })} /></label>
      <label className="admin-check"><input type="checkbox" checked={input.isActive} onChange={e => setInput({ ...input, isActive: e.target.checked })} /> Bật tài liệu</label>
      <ErrorNote error={action.error} />
      <footer><button type="button" className="btn btn-secondary" disabled={action.busy} onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={action.busy}>{action.busy ? 'Đang lưu…' : 'Lưu'}</button></footer>
    </form>
  </Modal>
}

function DocBrowser({ doc }: { doc: AdminApiDoc }) {
  const [descriptor, setDescriptor] = useState<AdminDocDescriptor | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const webview = useRef<Electron.WebviewTag | null>(null)
  const cleanupEvents = useRef<(() => void) | null>(null)
  useEffect(() => {
    let alive = true
    const token = crypto.randomUUID()
    setDescriptor(null); setLoading(true); setError('')
    void api().prepareDoc(doc.id, token).then(result => { if (alive) setDescriptor(result) })
      .catch(cause => { if (alive) { setError(message(cause)); setLoading(false) } })
    return () => { alive = false; void api().closeDoc(token).catch(() => {}) }
  }, [doc.id, doc.url, attempt])
  const attach = useCallback((view: Electron.WebviewTag | null) => {
    cleanupEvents.current?.(); webview.current = view
    if (!view) return
    const start = (event: Electron.DidStartNavigationEvent) => { if (event.isMainFrame && !event.isInPlace) { setLoading(true); setError('') } }
    const stop = () => setLoading(false)
    const failed = (event: Electron.DidFailLoadEvent) => { if (event.isMainFrame && event.errorCode !== -3) { setError('Không thể tải tài liệu. Vui lòng thử lại hoặc mở trong trình duyệt.'); setLoading(false) } }
    const crashed = () => { setDescriptor(null); setLoading(false); setError('Trang tài liệu đã dừng. Bấm thử lại để mở trang mới.') }
    view.addEventListener('did-start-navigation', start); view.addEventListener('did-stop-loading', stop)
    view.addEventListener('did-fail-load', failed); view.addEventListener('render-process-gone', crashed)
    cleanupEvents.current = () => {
      view.removeEventListener('did-start-navigation', start); view.removeEventListener('did-stop-loading', stop)
      view.removeEventListener('did-fail-load', failed); view.removeEventListener('render-process-gone', crashed)
    }
  }, [])
  const reload = () => {
    if (error || !descriptor || !webview.current) { setAttempt(value => value + 1); return }
    try { setLoading(true); webview.current.reload() } catch { setDescriptor(null); setAttempt(value => value + 1) }
  }
  return <div className="admin-doc-browser">
    <div className="admin-toolbar"><div className="admin-truncate"><strong>{doc.name}</strong><small>{doc.url}</small></div>
      <button className="btn btn-secondary" onClick={() => void api().openDocExternal(doc.id).catch(cause => setError(message(cause)))}><ExternalLink size={14} /> Mở trong trình duyệt</button>
      <Reload busy={loading} onClick={reload} />
    </div>
    <div className="admin-webview-container">
      {descriptor && <webview key={descriptor.token} ref={attach} src={descriptor.url} partition={descriptor.partition}
        style={{ display: 'flex', width: '100%', height: '100%' }}
        /* @ts-ignore Electron custom attributes are not in React DOM types. */
        allowpopups="true" webpreferences="sandbox=yes,contextIsolation=yes,nodeIntegration=no,webSecurity=yes" />}
      {(loading || error) && <div className="admin-webview-cover" role={error ? 'alert' : 'status'}><p>{error || 'Đang tải tài liệu…'}</p>{error && <button className="btn btn-primary" onClick={reload}>Thử lại</button>}</div>}
    </div>
  </div>
}

export function AdminDocs() {
  const query = useAdminQuery(() => api().listDocs())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [form, setForm] = useState<AdminApiDoc | 'new' | null>(null)
  const [deleting, setDeleting] = useState<AdminApiDoc | null>(null)
  const action = useAdminAction()
  const rows = query.data || []
  const selected = rows.find(row => row.id === selectedId) || (selectedId === null ? rows.find(row => row.isActive) : undefined)
  const saved = () => { setForm(null); setSelectedId(null); void query.reload() }
  return <section className="admin-section admin-docs">
    <div className="admin-toolbar"><div><h2>Doc API</h2><p>Danh mục tài liệu nội bộ</p></div><Reload busy={query.busy} onClick={() => void query.reload()} /><button className="btn btn-primary" onClick={() => setForm('new')}><Plus size={14} /> Thêm</button></div>
    <ErrorNote error={query.error || action.error} />
    <div className="admin-doc-layout">
      <aside className="admin-doc-list" aria-label="Mục lục tài liệu API">
        {rows.map(row => <div className={`admin-doc-item ${selected?.id === row.id ? 'selected' : ''}`} key={row.id}>
          <button className="admin-doc-select" aria-pressed={selected?.id === row.id} onClick={() => setSelectedId(row.id)}><Globe size={16} /><span>{row.name}<small>{row.description || row.url}{!row.isActive ? ' · Đã tắt' : ''}</small></span></button>
          <div className="admin-row-actions"><button className="btn-icon" title={`Sửa ${row.name}`} aria-label={`Sửa ${row.name}`} onClick={() => setForm(row)}><Pencil size={13} /></button><button className="btn-icon" title={`Xóa ${row.name}`} aria-label={`Xóa ${row.name}`} onClick={() => setDeleting(row)}><Trash2 size={13} /></button></div>
        </div>)}
        {!rows.length && <Empty busy={query.busy}>Chưa có tài liệu. Bấm Thêm để tạo mục đầu tiên.</Empty>}
      </aside>
      {selected?.isActive && !form && !deleting && !query.busy ? <DocBrowser key={`${selected.id}:${selected.version}`} doc={selected} /> : <Empty busy={query.busy}>{selected && !selected.isActive ? 'Tài liệu đang tắt. Chọn Sửa để bật lại.' : 'Chọn một tài liệu trong mục lục.'}</Empty>}
    </div>
    {form && <DocForm doc={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={saved} />}
    {deleting && <Modal title="Xóa tài liệu API" busy={action.busy} onClose={() => setDeleting(null)}><p>Xóa mục “{deleting.name}” khỏi danh sách?</p><ErrorNote error={action.error} /><div className="admin-footer"><button className="btn btn-secondary" disabled={action.busy} onClick={() => setDeleting(null)}>Hủy</button><button className="btn btn-danger" disabled={action.busy} onClick={() => void action.run(async () => { await api().deleteDoc(deleting.id, deleting.version); setDeleting(null); setSelectedId(null); await query.reload() })}>Xóa</button></div></Modal>}
  </section>
}
