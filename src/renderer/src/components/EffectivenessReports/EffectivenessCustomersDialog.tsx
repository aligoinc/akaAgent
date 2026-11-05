import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { utils, writeFile } from 'xlsx'
import {
  ENGAGEMENT_STAGE_LABELS, formatEffectivenessNumber,
  type EffectivenessCustomerPage, type EffectivenessCustomerRow, type EffectivenessListStage, type EffectivenessQuery
} from '../../../../shared/campaignEffectiveness'
import { useUiStore } from '../../stores/uiStore'
import { effectivenessRequest } from './effectivenessApi'

const PAGE_SIZE = 100
const EXPORT_PAGE_SIZE = 500
const EXPORT_LIMIT = 20_000

const formatTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('vi-VN') : ''

async function readAll(query: EffectivenessQuery, stage: EffectivenessListStage, campaignId: number | undefined, signal: AbortSignal) {
  const rows: EffectivenessCustomerRow[] = []
  // Sequential pages (one read at a time), capped like the WebApp export.
  for (let page = 1; ; page++) {
    const result = await effectivenessRequest({ kind: 'customers', query, stage, campaignId, page, pageSize: EXPORT_PAGE_SIZE }, signal)
    rows.push(...result.rows)
    if (result.rows.length < EXPORT_PAGE_SIZE || rows.length >= Math.min(result.total, EXPORT_LIMIT)) return rows.slice(0, EXPORT_LIMIT)
  }
}

/** Customers who reached a stage in the period: browse 100 per page or export to Excel. */
export function EffectivenessCustomersDialog({ query, stage, title, campaignId, onClose }: {
  query: EffectivenessQuery; stage: EffectivenessListStage; title: string; campaignId?: number; onClose(): void
}) {
  const showAlert = useUiStore(state => state.showAlert)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<EffectivenessCustomerPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setError(null)
    effectivenessRequest({ kind: 'customers', query, stage, campaignId, page, pageSize: PAGE_SIZE }, controller.signal)
      .then(data => { if (active) setResult(data) })
      .catch(reason => { if (active && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không thể tải danh sách.') })
    return () => { active = false; controller.abort() }
  }, [query, stage, campaignId, page])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !exporting) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [exporting, onClose])

  const exportExcel = async () => {
    if (exporting) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setExporting(true)
    try {
      const rows = await readAll(query, stage, campaignId, controller.signal)
      if (!rows.length) { showAlert('Không có khách để xuất.', 'info'); return }
      const sheet = utils.json_to_sheet(rows.map(row => ({
        'Tên khách': row.name || '', 'UID Zalo': row.uid || '', 'Số điện thoại': row.phone || '', 'Trạng thái': row.stage ? ENGAGEMENT_STAGE_LABELS[row.stage] : '',
        'Chiến dịch': row.campaignName, 'Tài khoản': row.accountName, 'Thời gian gửi': formatTime(row.sentAt),
        'Đã xem lúc': formatTime(row.seenAt), 'Phản hồi lúc': formatTime(row.respondedAt), 'Thả cảm xúc lúc': formatTime(row.reactedAt), 'Kết bạn lúc': formatTime(row.friendedAt)
      })))
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Khach hang')
      writeFile(workbook, `khach-hang-${stage}-${new Date().toISOString().slice(0, 10)}.xlsx`)
      showAlert(`Đã xuất ${formatEffectivenessNumber(rows.length)} khách ra Excel.`, 'success')
    } catch (reason) {
      if (!controller.signal.aborted) showAlert(reason instanceof Error ? reason.message : 'Không thể xuất Excel.', 'error')
    } finally { setExporting(false) }
  }
  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1

  return <div className="eff-dialog-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !exporting) onClose() }}>
    <div className="eff-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header className="eff-dialog-head">
        <div><h3>{title}</h3>{result && <span>{formatEffectivenessNumber(result.total)} khách</span>}</div>
        <div className="eff-dialog-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={!result?.total || exporting} onClick={() => void exportExcel()}>
            <Download size={14} />{exporting ? 'Đang xuất…' : 'Xuất Excel'}
          </button>
          <button ref={closeRef} type="button" className="btn btn-ghost btn-sm" aria-label="Đóng" disabled={exporting} onClick={onClose}><X size={16} /></button>
        </div>
      </header>
      <div className="eff-dialog-body">
        {error ? <p role="alert">{error}</p> : !result ? <p role="status">Đang tải…</p> : result.rows.length === 0 ? <p className="eff-muted">Chưa có khách trong khoảng thời gian này.</p> :
          <div className="eff-table-wrap"><table className="eff-table">
            <thead><tr><th>Khách</th><th>Liên hệ</th><th>Trạng thái</th><th>Chiến dịch</th><th>Tài khoản</th><th>Thời gian gửi</th></tr></thead>
            <tbody>{result.rows.map(row => <tr key={row.id}>
              <td>{row.name || '—'}</td>
              <td>{row.phone || row.uid || '—'}</td>
              <td>{row.stage ? <span className={`eff-stage is-${row.stage}`}>{ENGAGEMENT_STAGE_LABELS[row.stage]}</span> : ''}</td>
              <td>{row.campaignName}</td>
              <td>{row.accountName}</td>
              <td>{formatTime(row.sentAt)}</td>
            </tr>)}</tbody>
          </table></div>}
      </div>
      {result && result.total > PAGE_SIZE && <footer className="eff-dialog-foot">
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Trang trước" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button>
        <span>Trang {page}/{totalPages}</span>
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Trang sau" disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button>
      </footer>}
    </div>
  </div>
}
