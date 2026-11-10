import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Activity, AlertTriangle, BarChart3, ChevronRight, Download, Info, MessageSquare, PenLine, Phone, Plus, RefreshCw, Search,
  Table2, Tag, UserMinus, UserPlus, Users, type LucideIcon
} from 'lucide-react'
import {
  CAMPAIGN_INPUT_OUTCOMES, CAMPAIGN_INPUT_OUTCOME_LABELS, CAMPAIGN_REPORT_GROUPS, CAMPAIGN_REPORT_GROUP_LABELS,
  CAMPAIGN_RUN_REPORT_UNAVAILABLE,
  type CampaignRunReport, type CampaignRunReportAction, type CampaignRunReportAttention
} from '../../../../../shared/campaignRunReport'
import { effectivenessRate } from '../../../../../shared/campaignEffectiveness'
import type { CampaignListItem } from '../../../../../shared/types'
import { GroupLegend, ReportGlyph, SegmentedBar, TimelineChart } from './CampaignRunReportCharts'
import {
  GROUP_STYLE, INPUT_STATUS_STYLE, OUTCOME_STYLE, TIMELINE_UNIT_LABELS, formatReportClock, formatReportNumber, formatReportPercent,
  formatReportRate, presentGroups, reportKpis, reportStaleMessage, segmentsAria, timelineRange, timelineSingleSentence, timelineTitle,
  type ReportTone
} from './campaignRunReportModel'
import { downloadCampaignReport } from './campaignRunReportExcel'
import './CampaignRunReportTab.css'

export type CampaignReportDrillTarget = 'data' | 'results'

interface CampaignReportViewProps {
  campaign: CampaignListItem
  /** Tab đang hiện và khung chi tiết đang mở: chỉ tải khi true. */
  active: boolean
  /** Phạm vi phiên đăng nhập: đổi phiên thì bỏ dữ liệu và kết quả muộn của phiên cũ. */
  sessionKey?: string
  /** Mở tab Data ban đầu/Kết quả chạy đã lọc theo trạng thái (null = không lọc). */
  onOpenTab?(tab: CampaignReportDrillTarget, status: string | null): void
  onAddData?(campaign: CampaignListItem): void
}

interface ViewState {
  key: string
  loading: boolean
  data: CampaignRunReport | null
  error: string
}

const n = formatReportNumber
const CAMPAIGN_STATUS_TONE: Readonly<Record<string, ReportTone>> = {
  'đang chạy': 'progress', 'hoàn thành': 'good', 'tạm dừng': 'wait', 'lỗi': 'bad', 'chờ xử lý': 'neutral'
}
const capitalize = (value: string) => value ? value[0].toLocaleUpperCase('vi-VN') + value.slice(1) : value

function actionIcon(code: string | null): LucideIcon {
  if (!code) return Activity
  if (code === 'zalo_find_phone_user') return Search
  if (code === 'zalo_add_friend') return UserPlus
  if (code === 'zalo_cancel_sent_friend_request') return UserMinus
  if (code === 'zalo_tag_contact') return Tag
  if (code === 'zalo_change_alias') return PenLine
  if (code === 'voice_call') return Phone
  if (code === 'zalo_add_group_member' || code === 'zalo_join_group_link') return Users
  if (code.startsWith('zalo_message') || code === 'sms_send') return MessageSquare
  return Activity
}

function ViewToggle({ table, onToggle }: { table: boolean; onToggle(): void }) {
  return <button type="button" className="rpt-link-btn" aria-pressed={table} onClick={onToggle}>
    {table ? <BarChart3 size={15} aria-hidden="true" /> : <Table2 size={15} aria-hidden="true" />}
    {table ? 'Xem biểu đồ' : 'Xem dạng bảng'}
  </button>
}

function Section({ id, title, meta, actions, children, className = '' }: {
  id: string; title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string
}) {
  return <section className={`rpt-card ${className}`} aria-labelledby={id}>
    <header className="rpt-card-header">
      <div className="rpt-card-title"><h3 id={id}>{title}</h3>{meta && <span>{meta}</span>}</div>
      {actions && <div className="rpt-card-actions">{actions}</div>}
    </header>
    {children}
  </section>
}

function Num({ value, dim = false }: { value: number | null; dim?: boolean }) {
  if (value === null) return <td className="is-dim" data-dash="true">–</td>
  return <td className={value === 0 || dim ? 'is-dim' : undefined}>{n(value)}</td>
}

function KpiGrid({ report }: { report: CampaignRunReport }) {
  const kpis = reportKpis(report)
  return <div className={`rpt-kpis${kpis.length === 3 ? ' is-3' : ''}`}>{kpis.map(kpi => <div key={kpi.key} className="rpt-kpi" role="group"
    aria-label={`${kpi.label}: ${kpi.value}${kpi.suffix}. ${kpi.sub}`}>
    <div className="rpt-kpi-label"><ReportGlyph icon={kpi.icon} tone={kpi.tone} size={15} /><span>{kpi.label}</span></div>
    <div className="rpt-kpi-value">{kpi.value}<span>{kpi.suffix}</span></div>
    {kpi.meter !== undefined && <div className="rpt-meter" role="progressbar" aria-label="Tiến độ hoàn thành" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(kpi.meter * 100)}><span className="rpt-f-good" style={{ width: `${Math.min(100, kpi.meter * 100)}%` }} /></div>}
    <div className="rpt-kpi-sub" title={kpi.sub}>{kpi.sub}</div>
  </div>)}</div>
}

function AttentionStrip({ items, onOpen }: { items: readonly CampaignRunReportAttention[]; onOpen?(item: CampaignRunReportAttention): void }) {
  if (!items.length) return null
  return <section className="rpt-attention" aria-labelledby="rpt-attention-title">
    <h3 id="rpt-attention-title">Cần chú ý</h3>
    {items.map(item => <div key={item.key} className="rpt-attention-item">
      <ReportGlyph icon={item.icon} tone={item.tone} size={18} />
      <div className="rpt-attention-text"><strong>{item.title}</strong><span title={item.detail}>{item.detail}</span></div>
      {onOpen && <button type="button" className="rpt-link-btn" onClick={() => onOpen(item)}>{item.cta}<ChevronRight size={14} aria-hidden="true" /></button>}
    </div>)}
  </section>
}

function DataSection({ report, onOpenTab }: { report: CampaignRunReport; onOpenTab?: CampaignReportViewProps['onOpenTab'] }) {
  const [table, setTable] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const { inputs } = report
  const statusSegments = inputs.byStatus.map(status => ({ key: status.status, label: status.label, count: status.count, tone: INPUT_STATUS_STYLE[status.key].tone }))
  const outcomes = inputs.completedOutcomes.filter(outcome => outcome.count > 0)
  const outcomeSegments = outcomes.map(outcome => ({ key: outcome.outcome, label: outcome.label, count: outcome.count, tone: OUTCOME_STYLE[outcome.outcome].tone }))
  const totals = Object.fromEntries(CAMPAIGN_INPUT_OUTCOMES.map(outcome => [outcome, inputs.matrix.reduce((sum, row) => sum + row.counts[outcome], 0)])) as Record<(typeof CAMPAIGN_INPUT_OUTCOMES)[number], number>
  // Bảng chỉ giữ cột có số (Thành công, Không thành công, Chưa có kết quả luôn hiện); Excel có đủ cột.
  const matrixOutcomes = CAMPAIGN_INPUT_OUTCOMES.filter(outcome => outcome === 'success' || outcome === 'failure' || outcome === 'none' || totals[outcome] > 0)
  return <Section id="rpt-data-title" title="Data theo trạng thái" meta={`${n(inputs.total)} data`} className="rpt-data"
    actions={<ViewToggle table={table} onToggle={() => setTable(value => !value)} />}>
    {!table ? <>
      <SegmentedBar tall segments={statusSegments} total={inputs.total} unit="data" highlight={highlight}
        ariaLabel={segmentsAria('Data theo trạng thái', statusSegments, inputs.total, 'data')} />
      <ul className="rpt-rows">{inputs.byStatus.map(status => {
        const style = INPUT_STATUS_STYLE[status.key]
        const content = <>
          <ReportGlyph icon={style.icon} tone={style.tone} />
          <span className="rpt-row-label">{status.label}</span>
          <strong>{n(status.count)}</strong>
          <span className="rpt-row-pct">{formatReportPercent(status.count, inputs.total)}</span>
          {onOpenTab ? <ChevronRight size={16} className="rpt-row-chevron" aria-hidden="true" /> : <span />}
        </>
        return <li key={status.status}>{onOpenTab
          ? <button type="button" className="rpt-row is-button" onClick={() => onOpenTab('data', status.status)}
            aria-label={`${status.label}: ${n(status.count)} data (${formatReportPercent(status.count, inputs.total)}). Mở Data ban đầu đã lọc`}
            onMouseEnter={() => setHighlight(status.status)} onMouseLeave={() => setHighlight(null)}
            onFocus={() => setHighlight(status.status)} onBlur={() => setHighlight(null)}>{content}</button>
          : <div className="rpt-row">{content}</div>}</li>
      })}</ul>
      <div className="rpt-outcomes">
        <h4>Kết quả của {n(inputs.completed)} data đã hoàn thành</h4>
        {inputs.completed === 0 ? <p className="rpt-muted">Chưa có data nào hoàn thành.</p> : <>
          <SegmentedBar segments={outcomeSegments} total={inputs.completed} unit="data"
            ariaLabel={segmentsAria(`Kết quả của ${n(inputs.completed)} data đã hoàn thành`, outcomeSegments, inputs.completed, 'data')} />
          <ul className="rpt-rows is-static">{outcomes.map(outcome => {
            const style = OUTCOME_STYLE[outcome.outcome]
            const sub = outcome.outcome === 'failure' && outcome.notFound > 0 ? `trong đó ${n(outcome.notFound)} không tồn tại`
              : outcome.outcome === 'none' ? 'Thường do bị bỏ qua trước khi chạy; lý do ở cột Ghi chú của Data ban đầu' : ''
            return <li key={outcome.outcome} className="rpt-row">
              <ReportGlyph icon={style.icon} tone={style.tone} />
              <span className="rpt-row-label">{outcome.label}{sub && <small>{sub}</small>}</span>
              <strong>{n(outcome.count)}</strong>
              <span className="rpt-row-pct">{formatReportPercent(outcome.count, inputs.completed)}</span>
              <span />
            </li>
          })}</ul>
        </>}
        <p className="rpt-note">Thành công = có ít nhất một hành động chính thành công (không tính Tìm SĐT, Gắn tag, Đổi tên). Data “hoàn thành” vẫn có thể không thành công: app ghi data lỗi thành hoàn thành kèm ghi chú.</p>
      </div>
    </> : <>
      <div className="rpt-table-scroll"><table className="rpt-table">
        <thead><tr><th scope="col">Trạng thái data</th>{matrixOutcomes.map(outcome => <th key={outcome} scope="col">{CAMPAIGN_INPUT_OUTCOME_LABELS[outcome]}</th>)}<th scope="col">Tổng</th></tr></thead>
        <tbody>
          {inputs.matrix.map(row => <tr key={row.status}><th scope="row">{row.label}</th>
            {matrixOutcomes.map(outcome => <Num key={outcome} value={row.counts[outcome]} />)}<Num value={row.total} /></tr>)}
          <tr className="is-total"><th scope="row">Tổng</th>{matrixOutcomes.map(outcome => <Num key={outcome} value={totals[outcome]} />)}<Num value={inputs.total} /></tr>
        </tbody>
      </table></div>
      <p className="rpt-note">Kết quả của data tính từ các lượt chạy đã ghi. Data chạy lại vẫn giữ kết quả cũ cho tới lượt mới.{inputs.matrix.some(row => row.notFound > 0)
        ? ` Trong cột Không thành công có ${n(inputs.matrix.reduce((sum, row) => sum + row.notFound, 0))} data không tồn tại.` : ''}</p>
    </>}
  </Section>
}

function ActionRow({ action, first, onOpenTab }: { action: CampaignRunReportAction; first: boolean; onOpenTab?: CampaignReportViewProps['onOpenTab'] }) {
  const Icon = actionIcon(action.code)
  const segments = presentGroups(action.groups).map(group => ({ key: group, label: CAMPAIGN_REPORT_GROUP_LABELS[group], count: action.groups[group], tone: GROUP_STYLE[group].tone }))
  return <li className={`rpt-action${first ? ' is-first' : ''}`}>
    <div className="rpt-action-head">
      <span className="rpt-action-icon" aria-hidden="true"><Icon size={16} /></span>
      <div className="rpt-action-name">
        <div><strong>{action.name}</strong>
          {action.auxiliary && <span className="rpt-badge">Hành động phụ</span>}
          {!action.configured && action.code && <span className="rpt-badge" title="Hành động đã chạy nhưng hiện không còn bật trong cấu hình chiến dịch">Không còn bật</span>}
        </div>
        <span>{action.total ? `${n(action.total)} lượt` : 'Chưa có kết quả'}</span>
      </div>
      {action.total > 0 && <div className="rpt-action-rate"><strong>{formatReportRate(action.successRate)}</strong><span>thành công</span></div>}
    </div>
    {action.total > 0 && <>
      <SegmentedBar segments={segments} total={action.total} unit="lượt" ariaLabel={segmentsAria(action.name, segments, action.total, 'lượt')} />
      <div className="rpt-chips">{action.statuses.map(status => {
        const style = GROUP_STYLE[status.group]
        const filterable = !!onOpenTab && (status.filterStatus !== null || status.key === 'pending')
        const title = status.key === 'pending'
          ? 'Mở tab Kết quả chạy (không lọc được riêng lượt chờ xác nhận)'
          : `Mở tab Kết quả chạy lọc "${status.filterStatus}". Bộ lọc ở đó không tách theo hành động và khớp cả trạng thái phụ, nên số dòng có thể nhiều hơn.`
        const body = <><ReportGlyph icon={style.icon} tone={style.tone} size={14} /><span>{status.label}</span><strong>{n(status.count)}</strong></>
        return <span key={status.key} className="rpt-chip-wrap">
          {filterable
            ? <button type="button" className="rpt-chip" title={title} onClick={() => onOpenTab!('results', status.key === 'pending' ? null : status.filterStatus)}>{body}</button>
            : <span className="rpt-chip is-static">{body}</span>}
          {status.subStatuses.map(sub => <span key={sub.label} className="rpt-sub-status">↳ {sub.label} {n(sub.count)}</span>)}
        </span>
      })}</div>
    </>}
  </li>
}

function ActionsSection({ report, onOpenTab }: { report: CampaignRunReport; onOpenTab?: CampaignReportViewProps['onOpenTab'] }) {
  const [table, setTable] = useState(false)
  const totals = report.columns.map(column => report.actions.reduce((sum, action) => sum + (action.cells[column.key] || 0), 0))
  return <Section id="rpt-actions-title" title="Trạng thái theo hành động" className="rpt-actions"
    meta={`${n(report.results.total)} lượt · tỷ lệ thành công không tính bỏ qua`}
    actions={report.actions.length > 0 && <ViewToggle table={table} onToggle={() => setTable(value => !value)} />}>
    {report.actions.length === 0 ? <p className="rpt-muted">Chưa có kết quả.</p> : !table
      ? <ol className="rpt-action-list">{report.actions.map((action, index) => <ActionRow key={action.key} action={action} first={index === 0} onOpenTab={onOpenTab} />)}</ol>
      : <>
        <div className="rpt-table-scroll is-cards"><table className="rpt-table rpt-action-table">
          <thead><tr><th scope="col">Hành động</th>{report.columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}<th scope="col">Tổng</th></tr></thead>
          <tbody>
            {report.actions.map(action => <tr key={action.key}><th scope="row">{action.name}</th>
              {report.columns.map(column => {
                const value = action.cells[column.key]
                return value === null ? <td key={column.key} className="is-dim is-na" data-label={column.label}>–</td>
                  : <td key={column.key} className={value === 0 ? 'is-dim' : undefined} data-label={column.label}>{n(value)}</td>
              })}
              <td data-label="Tổng" className="is-strong">{n(action.total)}</td></tr>)}
            <tr className="is-total"><th scope="row">Tổng</th>{totals.map((total, index) => <td key={report.columns[index].key} data-label={report.columns[index].label}
              className={total === 0 ? 'is-dim' : undefined}>{n(total)}</td>)}<td data-label="Tổng">{n(report.results.total)}</td></tr>
          </tbody>
        </table></div>
        <p className="rpt-note">“–”: trạng thái không thuộc hành động đó. “0”: có trong cấu hình nhưng chưa có lượt nào. Trạng thái phụ chỉ ghi “trong đó”, không cộng thêm.</p>
      </>}
  </Section>
}

function TimelineSection({ report }: { report: CampaignRunReport }) {
  const [table, setTable] = useState(false)
  const { unit, points } = report.timeline
  const groups = CAMPAIGN_REPORT_GROUPS.filter(group => report.results.groups[group] > 0)
  const single = points.length === 1
  return <Section id="rpt-time-title" title="Kết quả theo thời gian" className="rpt-time"
    meta={`${TIMELINE_UNIT_LABELS[unit]} · ${timelineRange(points, unit)} · ${n(report.results.total)} lượt`}
    actions={!single && <><GroupLegend groups={groups} /><ViewToggle table={table} onToggle={() => setTable(value => !value)} /></>}>
    {single ? <p className="rpt-single">{timelineSingleSentence(points[0], unit)}</p> : !table
      ? <TimelineChart points={points} unit={unit} />
      : <div className="rpt-table-scroll is-tall"><table className="rpt-table">
        <thead><tr><th scope="col">Thời gian</th>{groups.map(group => <th key={group} scope="col">{CAMPAIGN_REPORT_GROUP_LABELS[group]}</th>)}<th scope="col">Tổng</th></tr></thead>
        <tbody>{points.map(point => <tr key={point.at}><th scope="row">{timelineTitle(point.at, unit)}</th>
          {groups.map(group => <Num key={group} value={point.counts[group]} />)}<Num value={point.total} /></tr>)}</tbody>
      </table></div>}
  </Section>
}

function FunnelRow({ label, value, base, tone }: { label: string; value: number; base: number | null; tone: 1 | 2 | 3 }) {
  const rate = base === null ? null : effectivenessRate(value, base)
  return <li className="rpt-funnel-row">
    <span className="rpt-funnel-label">{label}</span>
    <span className="rpt-funnel-track"><span className={`rpt-funnel-fill is-${tone}`} style={{ width: `${base ? Math.min(100, value / Math.max(1, base) * 100) : 100}%` }} /></span>
    <strong>{n(value)}</strong>
    <span className="rpt-row-pct">{rate === null ? '' : formatReportPercent(Math.round(rate * 1000), 1000)}</span>
  </li>
}

function EngagementSection({ report }: { report: CampaignRunReport }) {
  const engagement = report.engagement
  if (!engagement || (engagement.message.tracked === 0 && engagement.friend.tracked === 0)) return null
  const { message, friend } = engagement
  return <Section id="rpt-engagement-title" title="Tương tác Zalo" className="rpt-engagement"
    meta="Lượt thành công được theo dõi trong 48 giờ sau khi gửi">
    <div className="rpt-funnels">
      {message.tracked > 0 && <div><h4>Tin nhắn</h4><ul className="rpt-funnel">
        <FunnelRow label="Được theo dõi" value={message.tracked} base={null} tone={1} />
        <FunnelRow label="Đã xem" value={message.seen} base={message.tracked} tone={2} />
        <FunnelRow label="Có tương tác" value={message.interacted} base={message.tracked} tone={3} />
      </ul><p className="rpt-note">{n(message.responded)} phản hồi · {n(message.reacted)} thả cảm xúc · trên {n(message.sent)} tin đã gửi</p></div>}
      {friend.tracked > 0 && <div><h4>Kết bạn</h4><ul className="rpt-funnel">
        <FunnelRow label="Được theo dõi" value={friend.tracked} base={null} tone={1} />
        <FunnelRow label="Đã đồng ý" value={friend.friended} base={friend.tracked} tone={2} />
      </ul><p className="rpt-note">Trên {n(friend.requested)} lời mời đã gửi</p></div>}
    </div>
    <p className="rpt-note">Tỷ lệ chỉ hiện khi có từ 30 lượt được theo dõi.</p>
  </Section>
}

function ReportSkeleton() {
  return <div className="rpt-skeleton" role="status" aria-label="Đang tải báo cáo của chiến dịch">
    <div className="rpt-kpis">{Array.from({ length: 6 }, (_, index) => <span key={index} className="rpt-skeleton-block is-kpi" />)}</div>
    <div className="rpt-columns"><span className="rpt-skeleton-block is-card" /><span className="rpt-skeleton-block is-card is-wide" /></div>
    <span className="rpt-skeleton-block is-chart" />
  </div>
}

/**
 * Tab "Báo cáo" của chi tiết chiến dịch (Desktop 10/11/2026, chép từ WebApp CampaignReportView.tsx; khác phần tải qua IPC
 * `report:campaign-run`, dòng chiến dịch kiểu Desktop và điều kiện nút Thêm data). Bản Web 09/11/2026: KPI, cần chú ý, data theo trạng thái kèm kết quả
 * thật của data đã hoàn thành, trạng thái theo hành động và kết quả theo thời gian. Một lượt đọc khi mở tab
 * hoặc bấm Làm mới; không polling, không tự thử lại. Gợi ý "Có số liệu mới" so với dòng danh sách sẵn có.
 */
export function CampaignRunReportTab({ campaign, active, sessionKey = '', onOpenTab, onAddData }: CampaignReportViewProps) {
  const key = JSON.stringify([sessionKey, campaign.id])
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<ViewState>({ key: '', loading: false, data: null, error: '' })
  const [exportError, setExportError] = useState('')
  const requestKey = `${key}#${revision}`
  const completedRequest = useRef('')

  useEffect(() => {
    if (!active || completedRequest.current === requestKey) return
    let cancelled = false
    setState(current => current.key === key ? { ...current, loading: true } : { key, loading: true, data: null, error: '' })
    // Gửi ở microtask: lượt dựng/hủy thử của StrictMode bị hủy trước khi có IPC nào.
    queueMicrotask(() => {
      if (cancelled) return
      void window.electronAPI.campaignRunReport({ campaignId: campaign.id }).then(result => {
        if (cancelled) return
        completedRequest.current = requestKey
        setState(current => result.ok
          ? { key, loading: false, data: result.data, error: '' }
          : { key, loading: false, data: current.key === key ? current.data : null, error: result.message || CAMPAIGN_RUN_REPORT_UNAVAILABLE })
      }, () => {
        if (cancelled) return
        completedRequest.current = requestKey
        setState(current => ({ key, loading: false, data: current.key === key ? current.data : null, error: CAMPAIGN_RUN_REPORT_UNAVAILABLE }))
      })
    })
    // Đóng tab/đổi chiến dịch/đổi phiên khi đang tải: bỏ kết quả muộn (IPC không hủy được; main gộp lượt trùng), lần hiện sau tải lại.
    return () => { cancelled = true }
  }, [active, requestKey, key, campaign.id])

  const view = state.key === key ? state : null
  const data = view?.data ?? null
  const loading = !view || view.loading
  const refresh = () => { setExportError(''); setRevision(value => value + 1) }
  const exportExcel = () => {
    if (!data) return
    setExportError('')
    try {
      downloadCampaignReport(data, campaign)
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'Không xuất được file Excel.')
    }
  }
  const stale = data && !view?.loading ? reportStaleMessage(data, campaign) : null
  const openAttention = onOpenTab ? (item: CampaignRunReportAttention) => onOpenTab(item.target.tab, item.target.status) : undefined
  const statusTone = data ? CAMPAIGN_STATUS_TONE[data.campaignStatus] || 'neutral' : 'neutral'
  const empty = !!data && data.inputs.total === 0 && data.results.total === 0
  // Như menu "Thêm data" của danh sách Desktop: không có khi chiến dịch nhận data từ nhóm.
  const canAddData = !!onAddData && campaign.dataTargetSourceMode !== 'data_group' && data?.usesInputData !== false

  return <div className={`campaign-report-view${view?.loading && data ? ' is-refreshing' : ''}`}>
    <div className="rpt-toolbar">
      <div className="rpt-heading">
        <h2>Báo cáo kết quả chạy</h2>
        {data && <span className={`rpt-status rpt-status-${statusTone}`}><span aria-hidden="true" />{capitalize(data.campaignStatus) || 'Không rõ'}</span>}
        <span className="rpt-updated">{data
          ? `Cập nhật lúc ${formatReportClock(data.generatedAt)} · Tính trên toàn bộ data và kết quả của chiến dịch${data.campaignStatus === 'đang chạy' ? ' · Chiến dịch đang chạy, số liệu thay đổi liên tục' : ''}`
          : loading ? 'Đang tổng hợp số liệu… Chiến dịch nhiều kết quả có thể mất tới 1 phút ở lần mở đầu, các lần sau nhanh hơn.' : ''}</span>
      </div>
      <div className="rpt-toolbar-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={exportExcel} disabled={!data || empty}><Download size={14} aria-hidden="true" /> Xuất Excel</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} className={view?.loading ? 'spin' : ''} aria-hidden="true" /> {view?.loading && data ? 'Đang làm mới…' : 'Làm mới'}
        </button>
      </div>
    </div>
    {stale && <div className="rpt-stale" role="status"><Info size={16} aria-hidden="true" /><span>{stale}</span>
      <button type="button" className="rpt-link-btn" onClick={refresh}>Làm mới</button></div>}
    {(view?.error || exportError) && <div role="alert" className="account-info-error rpt-error"><AlertTriangle size={14} aria-hidden="true" /><span>{view?.error || exportError}</span>
      {view?.error && <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>Thử lại</button>}</div>}
    {!data ? (!view?.error && <ReportSkeleton />)
      : empty ? <div className="rpt-empty">
        <p>{data.usesInputData ? 'Chiến dịch chưa có data.' : 'Chiến dịch chưa có kết quả chạy.'}</p>
        {canAddData && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAddData!(campaign)}><Plus size={14} aria-hidden="true" /> Thêm data</button>}
      </div>
      : <div className="rpt-body">
        <KpiGrid report={data} />
        <AttentionStrip items={data.attention} onOpen={openAttention} />
        <div className="rpt-columns">
          {data.usesInputData && <DataSection report={data} onOpenTab={onOpenTab} />}
          <ActionsSection report={data} onOpenTab={onOpenTab} />
        </div>
        {data.results.total > 0 && data.timeline.points.length > 0 && <TimelineSection report={data} />}
        <EngagementSection report={data} />
      </div>}
  </div>
}
