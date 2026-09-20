import { useCallback, useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, LoaderCircle, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { DataGroup } from '../../../../shared/types'
import { SHEET_DATA_TYPES, type DataGroupExternalSyncSource, type DataGroupExternalSyncPanel as PanelData } from '../../../../shared/googleSheetSync'
import GoogleSheetSyncDialog from './GoogleSheetSyncDialog'
import '../../styles/dataGroupExternalSync.css'

const statusLabels: Record<string, string> = { pending: 'Chờ đồng bộ', running: 'Đang đồng bộ', paused: 'Tạm dừng', success: 'Đang bật', retry: 'Chờ thử lại', error: 'Cần kiểm tra', expired: 'Hết lịch' }
const formatDate = (date: string | null) => date ? new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Chưa chạy'
const isWaiting = (source: DataGroupExternalSyncSource) => source.isEnabled && (source.status === 'pending' || source.status === 'running')
const WATCH_INTERVAL_MS = 10_000
const WATCH_DURATION_MS = 5 * 60_000

export default function DataGroupExternalSyncPanel({ group, active = true, onCountChange, onChanged, onSynced }: {
  group: DataGroup
  active?: boolean
  onCountChange: (count: number) => void
  onChanged: () => void
  onSynced: () => void
}) {
  const api = window.electronAPI.dataGroupExternalSync
  const [data, setData] = useState<PanelData>({ sources: [], runs: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [editor, setEditor] = useState<{ source: DataGroupExternalSyncSource | null } | null>(null)
  const [removeId, setRemoveId] = useState<number | null>(null)
  const [addMenu, setAddMenu] = useState(false)
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden')
  const [watchUntil, setWatchUntil] = useState<number | null>(null)
  const [watchExpired, setWatchExpired] = useState(false)
  const sequence = useRef(0)
  const mounted = useRef(true)
  const mutating = useRef(false)
  const latestData = useRef(data)
  const callbacks = useRef({ onCountChange, onChanged, onSynced }); callbacks.current = { onCountChange, onChanged, onSynced }
  const supported = !group.dataTypeCode || SHEET_DATA_TYPES.some(t => t.code === group.dataTypeCode)
  const load = useCallback(async (automatic = false) => {
    if (!mounted.current || (automatic && mutating.current)) return
    const seq = ++sequence.current
    if (!automatic) setLoading(true)
    setError('')
    try {
      if (!api) throw new Error('Phiên bản ứng dụng chưa hỗ trợ đồng bộ Sheet.')
      const result = await api.list(group.id)
      if (seq !== sequence.current) return
      const completed = result.sources.some(source => {
        const previous = latestData.current.sources.find(item => item.id === source.id)
        return source.status === 'success' && (previous?.status !== 'success'
          || previous.lastRunAt !== source.lastRunAt || previous.addedCount !== source.addedCount)
      })
      latestData.current = result
      setData(result); callbacks.current.onCountChange(result.sources.length)
      setWatchUntil(previous => result.sources.some(isWaiting)
        ? (!automatic || previous === null ? Date.now() + WATCH_DURATION_MS : previous) : null)
      if (!automatic || !result.sources.some(isWaiting)) setWatchExpired(false)
      if (completed) callbacks.current.onSynced()
    } catch (err) {
      if (seq === sequence.current) {
        setError(err instanceof Error ? err.message : 'Không thể tải nguồn đồng bộ.')
        setWatchUntil(null)
      }
    } finally { if (!automatic && seq === sequence.current) setLoading(false) }
  }, [api, group.id])
  useEffect(() => {
    mounted.current = true
    const visibilityChanged = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => { mounted.current = false; sequence.current++; document.removeEventListener('visibilitychange', visibilityChanged) }
  }, [])
  useEffect(() => {
    if (active && visible) void load()
    return () => { sequence.current++ }
  }, [active, visible, load])
  useEffect(() => {
    if (!active || !visible || editor || busyId !== null || loading || watchUntil === null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      if (cancelled) return
      if (Date.now() >= watchUntil) { setWatchUntil(null); setWatchExpired(true); return }
      timer = setTimeout(async () => { await load(true); schedule() }, Math.min(WATCH_INTERVAL_MS, watchUntil - Date.now()))
    }
    schedule()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [active, visible, editor, busyId, loading, watchUntil, load])
  const changed = async () => { await load(); if (mounted.current) callbacks.current.onChanged() }
  const saved = async (source: DataGroupExternalSyncSource) => {
    if (!mounted.current) return
    const next = { ...latestData.current, sources: [...latestData.current.sources.filter(item => item.id !== source.id), source] }
    latestData.current = next; setData(next)
    await changed()
  }
  const mutate = async (source: DataGroupExternalSyncSource, remove: boolean) => {
    if (mutating.current) return
    mutating.current = true; sequence.current++; setBusyId(source.id); setError('')
    try {
      if (remove) await api.remove(group.id, source.id, source.revision)
      else await api.toggle(group.id, source.id, source.revision, !source.isEnabled)
      if (!mounted.current) return
      setRemoveId(null); await changed()
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Không thể lưu nguồn đồng bộ.') }
    finally { mutating.current = false; if (mounted.current) setBusyId(null) }
  }
  return <div className="data-group-external-sync-panel">
    <div className="sheet-sync-banner"><RefreshCw size={15} /><div><strong>Nhóm nhận data từ nguồn ngoài</strong><p>{supported ? <>Loại dữ liệu <b>{group.dataTypeName || 'Mọi loại dữ liệu'}</b> hỗ trợ đồng bộ. Data mới được thêm vào nhóm, giữ nguyên data cũ.</> : 'Loại dữ liệu này chưa hỗ trợ nhập từ Google Sheet.'}</p></div></div>
    <div className="sheet-sync-section-heading"><strong>Nguồn đồng bộ</strong><button className="btn-icon" type="button" title="Làm mới nguồn đồng bộ" aria-label="Làm mới nguồn đồng bộ" disabled={loading || busyId !== null} onClick={() => void load()}><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
      <div className="sheet-sync-add-menu" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setAddMenu(false) }} onKeyDown={e => { if (e.key === 'Escape') setAddMenu(false) }}>
        <button type="button" className="sheet-sync-add" aria-expanded={addMenu} disabled={!supported || loading || busyId !== null || !!error} onClick={() => setAddMenu(!addMenu)}><Plus size={12} />Thêm nguồn</button>
        {addMenu && <div className="sheet-sync-add-options"><button type="button" onClick={() => { setAddMenu(false); setEditor({ source: null }) }}><FileSpreadsheet size={15} />Từ Google Sheet</button></div>}
      </div></div>
    {error && <div className="sheet-sync-error" role="alert">{error}</div>}
    {data.sources.some(isWaiting) && !error && <p className="sheet-sync-help" role="status">{watchExpired
      ? 'Chưa nhận được kết quả đồng bộ. Bấm Làm mới để kiểm tra; lịch đồng bộ vẫn tiếp tục.'
      : 'Danh sách data sẽ tự cập nhật khi lượt đồng bộ hoàn tất.'}</p>}
    {loading && data.sources.length === 0 ? <div className="sheet-sync-empty"><LoaderCircle size={22} className="spin" />Đang tải nguồn đồng bộ…</div> : data.sources.map(source => <article key={source.id} className={`sheet-sync-source ${source.isEnabled ? 'is-enabled' : ''}`}>
      <div className="sheet-sync-source-top"><span className="sheet-sync-source-icon"><FileSpreadsheet size={16} /></span>
        <button type="button" className="sheet-sync-source-open" onClick={() => setEditor({ source })} disabled={loading || busyId !== null}>
          <strong>{source.name}</strong><span className={`sheet-sync-badge is-${source.status}`}>{statusLabels[source.status]}{source.isEnabled ? ` · ${source.everyHours}h` : ''}</span><small>{source.config.url.replace('https://', '')}</small>
        </button>
        <button type="button" className="btn-icon" aria-label={`Xóa nguồn ${source.name}`} title="Xóa nguồn" disabled={loading || busyId !== null} onClick={() => setRemoveId(source.id)}><Trash2 size={13} /></button></div>
      <div className="sheet-sync-source-metrics"><span><b>{source.rowCount.toLocaleString('vi-VN')}</b> dòng nguồn</span><span><b className="sheet-sync-added">+{source.addedCount.toLocaleString('vi-VN')}</b> data đã thêm</span><small>{formatDate(source.lastRunAt)}</small></div>
      {source.lastError && <p className="sheet-sync-source-error">{source.lastError}</p>}
      <div className="sheet-sync-source-actions"><small>{source.status === 'pending' ? (source.lastRunAt ? 'Đang chờ đồng bộ' : 'Đang chờ đồng bộ lần đầu')
        : source.status === 'running' ? 'Đang đọc và nhập data'
        : source.isEnabled && source.nextRunAt ? `Lịch tiếp: ${formatDate(source.nextRunAt)}` : source.endDate ? `Ngày dừng: ${source.endDate.split('-').reverse().join('/')}` : 'Lịch đang tắt'}</small>
        {source.status === 'error' || source.status === 'expired' ? <button type="button" className="sheet-sync-small-button" disabled={loading || busyId !== null} onClick={() => setEditor({ source })}>Sửa nguồn</button> : <button type="button" className="sheet-sync-small-button" disabled={loading || busyId !== null} onClick={() => void mutate(source, false)}>{busyId === source.id ? <LoaderCircle size={12} className="spin" /> : source.isEnabled ? <Pause size={12} /> : <Play size={12} />}{source.isEnabled ? 'Tạm dừng' : 'Bật lại'}</button>}</div>
      {removeId === source.id && <div className="sheet-sync-remove-confirm"><p>Xóa nguồn này? Data đã nhập vẫn được giữ lại.</p><button type="button" disabled={loading || busyId !== null} onClick={() => setRemoveId(null)}>Hủy</button><button type="button" disabled={loading || busyId !== null} onClick={() => void mutate(source, true)}>Xóa nguồn</button></div>}
    </article>)}
    {!loading && !error && !data.sources.length && <div className="sheet-sync-empty"><strong>Chưa có nguồn đồng bộ</strong><span>Bấm “Thêm nguồn” để nối Google Sheet</span></div>}
    <section className="sheet-sync-log"><h4>Nhật ký đồng bộ</h4>{data.runs.length ? data.runs.map(run => <div className="sheet-sync-log-row" key={run.id}><span className={`sheet-sync-log-dot is-${run.status}`} /><div><strong>{run.sourceName} · {run.status === 'success' ? `thêm ${run.addedCount} data` : run.status === 'running' ? 'đang đồng bộ' : run.status === 'cancelled' ? 'đã hủy lượt' : 'chưa hoàn tất'}</strong><p>{run.error || (run.status === 'success' ? `Bỏ qua ${run.duplicateCount} dòng trùng · ${run.invalidCount} dòng không hợp lệ` : 'Đang đọc và kiểm tra dữ liệu')}</p></div><time>{formatDate(run.startedAt)}</time></div>) : <p className="sheet-sync-help">Chưa có lượt đồng bộ.</p>}</section>
    {editor && <GoogleSheetSyncDialog group={group} source={editor.source} api={api} onClose={() => setEditor(null)} onSaved={saved} />}
  </div>
}
