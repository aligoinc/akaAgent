import { useMemo, useState } from 'react'
import { ArrowLeft, Download, ExternalLink, Search, Trophy } from 'lucide-react'
import { utils, writeFile } from 'xlsx'
import {
  ENGAGEMENT_STAGE_LABELS, MIN_RATE_SAMPLE, effectivenessRate, formatEffectivenessNumber, formatEffectivenessRate,
  type CampaignEffectivenessDetail, type CampaignEffectivenessList, type CampaignEffectivenessRow, type EngagementStage
} from '../../../../shared/campaignEffectiveness'
import { useUiStore } from '../../stores/uiStore'
import { effectivenessRequest } from './effectivenessApi'
import { BarList, DailyTrend } from './EffectivenessCharts'
import { EffectivenessCustomersDialog } from './EffectivenessCustomersDialog'
import { useEffectivenessData } from './useEffectivenessData'
import type { EffectivenessTabProps } from './EffectivenessReportsHub'

type SortKey = 'done' | 'reached' | 'seen' | 'interacted' | 'friended' | 'lastAt' | 'name'
const formatDate = (iso: string | null) => iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—'
const interactionRate = (row: CampaignEffectivenessRow) => effectivenessRate(row.interacted + row.friended, row.reached)
const sortValue = (row: CampaignEffectivenessRow, key: Exclude<SortKey, 'name' | 'lastAt'>) => key === 'done' ? row.counts.success : row[key]
/**
 * Desktop also lists Facebook/group work: reach applies to person-targeted sends only and seen/replied/friend
 * results to Zalo sends that are tracked, so a metric that does not apply shows "—" instead of a zero.
 */
const metricCell = (value: number, applies: boolean) => applies || value > 0 ? formatEffectivenessNumber(value) : '—'

export function CampaignEffectivenessTab(props: EffectivenessTabProps) {
  const { query, queryKey, cache, onNavigate } = props
  const showAlert = useUiStore(state => state.showAlert)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'reached', desc: true })
  const [selected, setSelected] = useState<CampaignEffectivenessRow | null>(null)
  const list = useEffectivenessData<CampaignEffectivenessList>(`campaigns|${queryKey}`,
    signal => effectivenessRequest({ kind: 'campaigns', query }, signal), cache)

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi-VN')
    const filtered = (list.data?.rows || []).filter(row => !term || `${row.name} ${row.accountName} ${row.actionName}`.toLocaleLowerCase('vi-VN').includes(term))
    const direction = sort.desc ? -1 : 1
    return [...filtered].sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name, 'vi') * direction
      if (sort.key === 'lastAt') return (a.lastAt || '').localeCompare(b.lastAt || '') * direction
      return (sortValue(a, sort.key) - sortValue(b, sort.key)) * direction || a.campaignId - b.campaignId
    })
  }, [list.data, search, sort])
  const top = useMemo(() => (list.data?.rows || [])
    .filter(row => row.reached >= MIN_RATE_SAMPLE && (row.interacted + row.friended) > 0)
    .sort((a, b) => (interactionRate(b) ?? 0) - (interactionRate(a) ?? 0) || b.reached - a.reached).slice(0, 3), [list.data])

  if (selected) return <CampaignDetail {...props} row={selected} onBack={() => setSelected(null)} />
  if (list.status === 'loading' || list.status === 'idle') return <div className="eff-state" role="status">Đang tổng hợp theo chiến dịch…</div>
  if (list.status === 'error') return <div className="eff-state" role="alert">{list.error}<button type="button" className="btn btn-secondary btn-sm" onClick={list.reload}>Thử lại</button></div>

  const exportExcel = () => {
    if (!rows.length) { showAlert('Chưa có dữ liệu để xuất.', 'info'); return }
    try {
      const sheet = utils.json_to_sheet(rows.map(row => ({
        'Chiến dịch': row.name, 'Loại': row.actionName, 'Tài khoản': row.accountName, 'Trạng thái': row.isDeleted ? `${row.status} (đã xóa)` : row.status,
        'Lượt tiếp cận': row.reached, 'Đã xem': row.seen, 'Tương tác': row.interacted, 'Bạn mới': row.friended,
        'Đã thực hiện': row.counts.success, 'Chưa thực hiện được': row.counts.failure + row.counts.skipped,
        'Lần chạy đầu': formatDate(row.firstAt), 'Lần chạy gần nhất': formatDate(row.lastAt)
      })))
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Theo chien dich')
      writeFile(workbook, `bao-cao-theo-chien-dich-${new Date().toISOString().slice(0, 10)}.xlsx`)
      showAlert('Đã xuất báo cáo theo chiến dịch.', 'success')
    } catch { showAlert('Không thể xuất file Excel.', 'error') }
  }
  const header = (key: SortKey, label: string) => <th aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
    <button type="button" onClick={() => setSort(current => ({ key, desc: current.key === key ? !current.desc : key !== 'name' }))}>{label}</button>
  </th>

  return <div className="eff-tab">
    {top.length > 0 && <section className="eff-card" aria-labelledby="eff-top-title">
      <h3 id="eff-top-title"><Trophy size={16} aria-hidden="true" /> Chiến dịch hiệu quả nhất</h3>
      <ol className="eff-top-list">{top.map(row => <li key={row.campaignId}>
        <button type="button" className="eff-link" onClick={() => setSelected(row)}>{row.name}</button>
        <span>{formatEffectivenessRate(interactionRate(row))} khách tương tác/kết bạn · {formatEffectivenessNumber(row.reached)} lượt tiếp cận</span>
        {!row.isDeleted && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ kind: 'campaign', campaignId: row.campaignId })}>
          <ExternalLink size={14} />Mở chiến dịch</button>}
      </li>)}</ol>
    </section>}
    <section className="eff-card">
      <div className="eff-card-toolbar">
        <h3>Báo cáo theo chiến dịch</h3>
        <label className="eff-search"><Search size={14} aria-hidden="true" /><input type="search" placeholder="Tìm chiến dịch, tài khoản" value={search}
          onChange={event => setSearch(event.target.value)} aria-label="Tìm chiến dịch" /></label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={exportExcel}><Download size={14} />Xuất Excel</button>
      </div>
      {!rows.length ? <p className="eff-muted">{search.trim() ? 'Không tìm thấy chiến dịch phù hợp.' : 'Không có chiến dịch nào chạy trong khoảng thời gian này.'}</p>
        : <div className="eff-table-wrap"><table className="eff-table is-sortable">
          <thead><tr>{header('name', 'Chiến dịch')}<th>Tài khoản</th>{header('done', 'Đã thực hiện')}{header('reached', 'Lượt tiếp cận')}{header('seen', 'Đã xem')}
            {header('interacted', 'Tương tác')}{header('friended', 'Bạn mới')}{header('lastAt', 'Lần chạy gần nhất')}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.campaignId}>
            <td><button type="button" className="eff-link" onClick={() => setSelected(row)}>{row.name}</button>
              <small>{row.actionName}{row.isDeleted ? ' · đã xóa' : ''}</small></td>
            <td>{row.accountName || '—'}</td>
            <td className="is-num">{formatEffectivenessNumber(row.counts.success)}</td>
            <td className="is-num">{metricCell(row.reached, row.counts.success === 0)}</td>
            <td className="is-num">{metricCell(row.seen, row.counts.tracked > 0)}</td>
            <td className="is-num">{metricCell(row.interacted, row.counts.tracked > 0)}</td>
            <td className="is-num">{metricCell(row.friended, row.counts.tracked > 0)}</td>
            <td>{formatDate(row.lastAt)}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </div>
}

function CampaignDetail(props: EffectivenessTabProps & { row: CampaignEffectivenessRow; onBack(): void }) {
  const { query, queryKey, cache, row, onBack, onOpenAccountDetails, onNavigate } = props
  const showAlert = useUiStore(state => state.showAlert)
  const [customers, setCustomers] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const detail = useEffectivenessData<CampaignEffectivenessDetail>(`campaign|${row.campaignId}|${queryKey}`,
    signal => effectivenessRequest({ kind: 'campaign', campaignId: row.campaignId, query }, signal), cache)
  const data = detail.data
  const exportExcel = () => {
    if (!data) return
    try {
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, utils.json_to_sheet([
        { 'Chỉ số': 'Đã gửi', 'Số lượng': data.message.sent }, { 'Chỉ số': 'Đã xem', 'Số lượng': data.message.seen },
        { 'Chỉ số': 'Tương tác + phản hồi', 'Số lượng': data.message.interacted }, { 'Chỉ số': 'Đã gửi lời mời', 'Số lượng': data.friend.requested },
        { 'Chỉ số': 'Đồng ý kết bạn', 'Số lượng': data.friend.friended }, { 'Chỉ số': 'Đang chờ gửi', 'Số lượng': data.totals.pending }
      ]), 'Tong quan')
      utils.book_append_sheet(workbook, utils.json_to_sheet(data.actions.map(action => ({
        'Hành động': action.name, 'Đã thực hiện': action.done, 'Đang chờ': action.pending, 'Chưa thực hiện được': action.notDone,
        ...Object.fromEntries(Object.entries(action.stages).map(([stage, count]) => [ENGAGEMENT_STAGE_LABELS[stage as EngagementStage], count]))
      }))), 'Tung hanh dong')
      utils.book_append_sheet(workbook, utils.json_to_sheet(data.daily.map(point => ({
        'Ngày': point.date, 'Lượt tiếp cận': point.reached, 'Đã xem': point.seen, 'Tương tác': point.interacted, 'Bạn mới': point.friended
      }))), 'Theo ngay')
      writeFile(workbook, `bao-cao-chien-dich-${row.campaignId}-${new Date().toISOString().slice(0, 10)}.xlsx`)
      showAlert('Đã xuất báo cáo chiến dịch.', 'success')
    } catch { showAlert('Không thể xuất file Excel.', 'error') }
  }
  const doneActions = data?.actions.filter(action => action.done > 0) || []
  return <div className="eff-tab">
    <div className="eff-detail-head">
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} />Tất cả chiến dịch</button>
      <div><h3>{row.name}</h3><span>{row.actionName} · {row.accountName || 'Tài khoản đã xóa'}</span></div>
      <div className="eff-detail-actions">
        {!row.isDeleted && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ kind: 'campaign', campaignId: row.campaignId })}>
          <ExternalLink size={14} />Mở chiến dịch</button>}
        <button type="button" className="btn btn-secondary btn-sm" disabled={!data} onClick={exportExcel}><Download size={14} />Xuất Excel</button>
      </div>
    </div>
    {detail.status === 'error' ? <div className="eff-state" role="alert">{detail.error}<button type="button" className="btn btn-secondary btn-sm" onClick={detail.reload}>Thử lại</button></div>
      : !data ? <div className="eff-state" role="status">Đang tải chiến dịch…</div> : <>
        <div className="eff-grid-2">
          <section className="eff-card" aria-labelledby="eff-campaign-journey">
            <h3 id="eff-campaign-journey">Hành trình khách hàng</h3>
            {data.message.sent > 0 && <BarList ariaLabel="Hành trình tin nhắn" items={[
              { key: 'sent', label: 'Đã gửi', value: data.message.sent },
              { key: 'seen', label: 'Đã xem', value: data.message.seen, tone: 'info' },
              { key: 'interacted', label: 'Tương tác + phản hồi', value: data.message.interacted, tone: 'success' }
            ]} />}
            {data.friend.requested > 0 && <BarList ariaLabel="Hành trình kết bạn" items={[
              { key: 'requested', label: 'Đã gửi lời mời', value: data.friend.requested },
              { key: 'friended', label: 'Đồng ý kết bạn', value: data.friend.friended, tone: 'success' }
            ]} />}
            {!data.message.sent && !data.friend.requested && (doneActions.length
              ? <BarList ariaLabel="Kết quả theo hành động" items={doneActions.map(action => ({ key: action.code, label: action.name, value: action.done, tone: 'success' as const }))} />
              : <p className="eff-muted">Chiến dịch này chưa có lượt gửi trong khoảng thời gian đã chọn.</p>)}
            {(data.message.interacted > 0 || data.friend.friended > 0) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCustomers(true)}>Xem khách đã tương tác</button>}
          </section>
          <section className="eff-card" aria-labelledby="eff-campaign-trend">
            <h3 id="eff-campaign-trend">Xu hướng theo ngày</h3>
            <DailyTrend points={data.daily} />
          </section>
        </div>
        <section className="eff-card">
          <button type="button" className="eff-collapse" aria-expanded={showActions} onClick={() => setShowActions(value => !value)}>
            Chi tiết từng hành động
          </button>
          {showActions && <>
            <div className="eff-table-wrap"><table className="eff-table">
              <thead><tr><th>Hành động</th><th className="is-num">Đã thực hiện</th><th className="is-num">Đang chờ</th><th className="is-num">Chưa thực hiện được</th><th>Trạng thái cuối</th></tr></thead>
              <tbody>{data.actions.map(action => <tr key={action.code}>
                <td>{action.name}</td>
                <td className="is-num">{formatEffectivenessNumber(action.done)}</td>
                <td className="is-num">{formatEffectivenessNumber(action.pending)}</td>
                <td className="is-num">{formatEffectivenessNumber(action.notDone)}</td>
                <td>{Object.entries(action.stages).filter(([, count]) => (count || 0) > 0)
                  .map(([stage, count]) => `${ENGAGEMENT_STAGE_LABELS[stage as EngagementStage]} ${formatEffectivenessNumber(count || 0)}`).join(' · ') || '—'}</td>
              </tr>)}</tbody>
            </table></div>
            <button type="button" className="eff-link" onClick={onOpenAccountDetails}>Xem trạng thái đầy đủ theo tài khoản</button>
          </>}
        </section>
      </>}
    {customers && <EffectivenessCustomersDialog query={query} stage="engaged" campaignId={row.campaignId} title={`Khách đã tương tác · ${row.name}`} onClose={() => setCustomers(false)} />}
  </div>
}
