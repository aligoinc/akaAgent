import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Search, UserRound } from 'lucide-react'
import type { MessageOptOutCustomerPage } from '../../../../shared/messageOptOutCustomers'
import './messageOptOutCustomers.css'

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
})

function formatDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—'
  const parts = dateFormat.formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || ''
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`
}

function CustomerAvatar({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false)
  return <span className="message-opt-out-avatar">
    {url && /^https?:\/\//i.test(url) && !failed
      ? <img src={url} alt="Ảnh đại diện" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <UserRound size={19} aria-label="Không có ảnh đại diện" />}
  </span>
}

export default function MessageOptOutCustomersSettings() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<MessageOptOutCustomerPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignored = false
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      void window.electronAPI.listMessageOptOutCustomers({ search: search.trim(), page })
        .then(data => { if (!ignored) setResult(data) })
        .catch(() => { if (!ignored) setError('Không thể tải khách hàng từ chối nhận tin. Vui lòng thử lại.') })
        .finally(() => { if (!ignored) setLoading(false) })
    }, search.trim() ? 300 : 0)
    return () => { ignored = true; clearTimeout(timer) }
  }, [search, page, revision])

  const currentPage = result?.page || 1
  const totalPages = Math.max(1, Math.ceil((result?.total || 0) / (result?.pageSize || 50)))
  const reload = () => setRevision(value => value + 1)
  return <div className="message-opt-out-settings">
    <div className="message-opt-out-heading">
      <h3>Khách hàng từ chối nhận tin</h3>
      <button type="button" className="btn btn-secondary" onClick={reload} disabled={loading}>
        <RefreshCw size={14} /> Tải lại
      </button>
    </div>
    <label className="message-opt-out-search">
      <Search size={16} aria-hidden="true" />
      <input aria-label="Tìm khách hàng từ chối nhận tin" placeholder="Tìm tên, SĐT, Email, Zalo global ID, chiến dịch…"
        maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
    </label>
    <div className="message-opt-out-table-wrap" aria-busy={loading}>
      <table className="message-opt-out-table" aria-label="Khách hàng từ chối nhận tin">
        <thead><tr>
          {['STT', 'Ảnh đại diện', 'Tên Zalo', 'SĐT', 'Email', 'Zalo global ID', 'Ngày từ chối', 'Từ chiến dịch', 'Từ chi tiết chiến dịch'].map(label => <th scope="col" key={label}>{label}</th>)}
        </tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={9} className="message-opt-out-empty" role="status">Đang tải...</td></tr>
            : error ? <tr><td colSpan={9} className="message-opt-out-empty">
              <div role="alert">{error}</div><button type="button" className="btn btn-secondary" onClick={reload}>Thử lại</button>
            </td></tr>
              : !result?.items.length ? <tr><td colSpan={9} className="message-opt-out-empty">{search.trim() ? 'Không tìm thấy khách hàng phù hợp.' : 'Chưa có khách hàng từ chối nhận tin.'}</td></tr>
                : result.items.map((item, index) => <tr key={item.id}>
                  <td>{(currentPage - 1) * result.pageSize + index + 1}</td>
                  <td><CustomerAvatar key={item.zaloAvatar} url={item.zaloAvatar} /></td>
                  <td>{item.zaloName || '—'}</td>
                  <td className="message-opt-out-nowrap">{item.phone || '—'}</td>
                  <td>{item.email || '—'}</td>
                  <td>{item.zaloGlobalId || '—'}</td>
                  <td className="message-opt-out-nowrap">{formatDate(item.confirmedAt)}</td>
                  <td>{item.sourceCampaignName || '—'}</td>
                  <td>{item.sourceDetailId ? <div className="message-opt-out-detail">
                    <span>{item.sourceActionName || '—'}</span>
                    <span>{formatDate(item.sourceSentAt)}</span>
                    <span className="message-opt-out-success">{item.sourceStatus || '—'}</span>
                  </div> : '—'}</td>
                </tr>)}
        </tbody>
      </table>
    </div>
    <div className="message-opt-out-pagination">
      <span>{error || loading ? '—' : `${result?.total || 0} khách hàng`}</span>
      <div>
        <button type="button" className="btn-icon" aria-label="Trang trước" disabled={loading || !!error || currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button>
        <span>Trang {currentPage}/{totalPages}</span>
        <button type="button" className="btn-icon" aria-label="Trang sau" disabled={loading || !!error || currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button>
      </div>
    </div>
  </div>
}
