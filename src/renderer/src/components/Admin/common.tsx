import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type DependencyList, type ReactNode } from 'react'
import { RefreshCw, X } from 'lucide-react'

export const AdminBusyContext = createContext<(busy: boolean) => void>(() => {})
export const api = () => window.electronAPI.admin
export const message = (error: unknown): string => error instanceof Error
  ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Không thể hoàn tất thao tác. Vui lòng thử lại.'

export function useAdminQuery<T>(load: () => Promise<T>, dependencies: DependencyList = []) {
  const [data, setData] = useState<T | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const loader = useRef(load)
  loader.current = load
  const reload = useCallback(async () => {
    const request = ++sequence.current
    setBusy(true); setError('')
    try {
      const result = await loader.current()
      if (request === sequence.current) setData(result)
    } catch (cause) { if (request === sequence.current) setError(message(cause)) }
    finally { if (request === sequence.current) setBusy(false) }
  }, [])
  useEffect(() => { setData(null); void reload(); return () => { sequence.current++ } }, [reload, ...dependencies])
  return { data, busy, error, reload }
}

export function useAdminAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mutex = useRef(false)
  const mounted = useRef(false)
  const setPageBusy = useContext(AdminBusyContext)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; setPageBusy(false) } }, [setPageBusy])
  const run = async (operation: () => Promise<void>): Promise<boolean> => {
    if (mutex.current) return false
    mutex.current = true; setBusy(true); setError(''); setPageBusy(true)
    try { await operation(); return mounted.current }
    catch (cause) { if (mounted.current) setError(message(cause)); return false }
    finally {
      mutex.current = false
      if (mounted.current) { setBusy(false); setPageBusy(false) }
    }
  }
  return { run, busy, error }
}

export function ErrorNote({ error }: { error: string }) { return error ? <p className="admin-error" role="alert">{error}</p> : null }
export function Reload({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClick}><RefreshCw size={14} /> {busy ? 'Đang tải…' : 'Làm mới'}</button>
}
export function Empty({ busy = false, children = 'Chưa có dữ liệu.' }: { busy?: boolean; children?: ReactNode }) {
  return <div className="admin-empty" role="status">{busy ? 'Đang tải dữ liệu…' : children}</div>
}
export function Modal({ title, children, onClose, busy = false, wide = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className={`admin-dialog ${wide ? 'admin-dialog-wide' : ''}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header><h3 id={titleId}>{title}</h3><button type="button" className="btn-icon" aria-label="Đóng" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <div className="admin-dialog-content">{children}</div>
  </dialog>
}
export function Pagination({ cursor, nextCursor, onChange, busy }: { cursor: string | null; nextCursor?: string | null; onChange: (cursor: string | null) => void; busy: boolean }) {
  return <div className="admin-pagination">
    <button className="btn btn-secondary" disabled={busy || !cursor} onClick={() => onChange(null)}>Về đầu</button>
    <span>Tối đa 100 dòng / trang</span>
    <button className="btn btn-secondary" disabled={busy || !nextCursor} onClick={() => onChange(nextCursor!)}>Trang tiếp</button>
  </div>
}
export function vietnamTime(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value))
}
