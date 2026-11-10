// Chép nguyên văn từ akaAgentWebApp apps/web/src/features/campaignReport/CampaignReportCharts.tsx (chỉ khác import).
import { useState } from 'react'
import {
  CheckCircle2, CircleDashed, Clock3, Database, Flag, MinusCircle, PauseCircle, PlayCircle, XCircle, Zap,
  type LucideIcon
} from 'lucide-react'
import {
  CAMPAIGN_REPORT_GROUPS, type CampaignReportTimelineUnit, type CampaignRunReportTimelinePoint
} from '../../../../../shared/campaignRunReport'
import {
  GROUP_STYLE, formatReportNumber, formatReportPercent, groupLabel, niceTicks, tickIndexes, timelineTick, timelineTitle,
  type ReportIcon, type ReportTone
} from './campaignRunReportModel'

const ICONS: Readonly<Record<ReportIcon, LucideIcon>> = {
  check: CheckCircle2, play: PlayCircle, pause: PauseCircle, x: XCircle, dashed: CircleDashed, minus: MinusCircle,
  clock: Clock3, db: Database, flag: Flag, zap: Zap
}

/** Biểu tượng trạng thái: màu luôn đi kèm hình và chữ (không chỉ dựa vào màu). */
export function ReportGlyph({ icon, tone, size = 16 }: { icon: ReportIcon; tone: ReportTone; size?: number }) {
  const Icon = ICONS[icon]
  return <span className={`rpt-glyph rpt-i-${tone}`}><Icon size={size} aria-hidden="true" /></span>
}

export interface ReportSegment { key: string; label: string; count: number; tone: ReportTone }

/**
 * Thanh phân đoạn: phần bằng 0 không vẽ, khe 2px giữa các phần, `role="img"` kèm nhãn đủ các phần.
 * Bản cao in % trong khối khi đủ chỗ (≥ 6%); `highlight` làm mờ các phần khác khi rê vào dòng chú thích.
 */
export function SegmentedBar({ segments, total, ariaLabel, tall = false, unit, highlight = null }: {
  segments: readonly ReportSegment[]
  total: number
  ariaLabel: string
  tall?: boolean
  unit: string
  highlight?: string | null
}) {
  const visible = segments.filter(segment => segment.count > 0)
  return <div className={`rpt-bar ${tall ? 'is-tall' : 'is-thin'}`} role="img" aria-label={ariaLabel}>
    {visible.length === 0 && <span className="rpt-bar-empty" />}
    {visible.map(segment => <span
      key={segment.key}
      className={`rpt-seg rpt-f-${segment.tone}${highlight && highlight !== segment.key ? ' is-dimmed' : ''}`}
      style={{ flexGrow: segment.count }}
      title={`${segment.label}: ${formatReportNumber(segment.count)} ${unit} (${formatReportPercent(segment.count, total)})`}
    >{tall && total > 0 && segment.count / total >= 0.1 && <span className={`rpt-seg-label rpt-l-${segment.tone}`}>{formatReportPercent(segment.count, total)}</span>}</span>)}
  </div>
}

/** Chú thích màu cho các nhóm đang có lượt. */
export function GroupLegend({ groups }: { groups: readonly (typeof CAMPAIGN_REPORT_GROUPS)[number][] }) {
  return <ul className="rpt-legend" aria-label="Chú thích màu">
    {groups.map(group => <li key={group}><span className={`rpt-swatch rpt-f-${GROUP_STYLE[group].tone}`} aria-hidden="true" />{groupLabel(group)}</li>)}
  </ul>
}

/**
 * Cột chồng theo thời gian (một trục: số lượt). Tooltip khi rê chuột hoặc đưa bàn phím vào cột;
 * vùng bấm là cả chiều cao cột. Hơn 31 cột thì khung cuộn ngang bên trong (không tràn trang).
 */
export function TimelineChart({ points, unit }: { points: readonly CampaignRunReportTimelinePoint[]; unit: CampaignReportTimelineUnit }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(0, ...points.map(point => point.total))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const tickList = tickIndexes(points.length)
  const labels = new Set(tickList)
  const previousLabel = (index: number) => tickList[tickList.indexOf(index) - 1] ?? -1
  const active = hover !== null ? points[hover] : null
  const scroll = points.length > 31
  // Tooltip bên phải cột ở nửa trái, bên trái cột ở nửa phải.
  const tooltipPlace = (index: number) => {
    const center = (index + 0.5) / points.length * 100
    return center < 50 ? { left: `calc(${center}% + 14px)` } : { right: `calc(${100 - center}% + 14px)` }
  }
  return <div className="rpt-timeline">
    <div className="rpt-timeline-y" aria-hidden="true">
      {ticks.map(tick => <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>{formatReportNumber(tick)}</span>)}
    </div>
    <div className={`rpt-timeline-scroll${scroll ? ' is-scroll' : ''}`}>
      <div className="rpt-timeline-inner" style={scroll ? { minWidth: `${points.length * 16}px` } : undefined}>
        <div className="rpt-timeline-plot" onMouseLeave={() => setHover(null)}>
          {ticks.map(tick => <span key={tick} className="rpt-timeline-grid" aria-hidden="true" style={{ bottom: `${(tick / top) * 100}%` }} />)}
          <div className="rpt-timeline-cols">
            {points.map((point, index) => {
              const groups = CAMPAIGN_REPORT_GROUPS.filter(group => point.counts[group] > 0)
              const aria = `${timelineTitle(point.at, unit)}: ${formatReportNumber(point.total)} lượt${groups.length
                ? `, ${groups.map(group => `${groupLabel(group)} ${formatReportNumber(point.counts[group])}`).join(', ')}` : ''}`
              return <button
                key={point.at}
                type="button"
                className={`rpt-col${hover !== null && hover !== index ? ' is-dimmed' : ''}`}
                aria-label={aria}
                onMouseEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(current => current === index ? null : current)}
              >
                <span className="rpt-col-stack" style={{ height: `${(point.total / top) * 100}%` }}>
                  {groups.map(group => <span key={group} className={`rpt-col-seg rpt-f-${GROUP_STYLE[group].tone}`} style={{ flexGrow: point.counts[group] }} />)}
                </span>
              </button>
            })}
          </div>
          {active && hover !== null && <div className="rpt-tooltip" role="status" style={tooltipPlace(hover)}>
            <strong>{timelineTitle(active.at, unit)}</strong>
            {CAMPAIGN_REPORT_GROUPS.filter(group => active.counts[group] > 0).map(group => <span key={group} className="rpt-tooltip-row">
              <span className={`rpt-swatch rpt-f-${GROUP_STYLE[group].tone}`} aria-hidden="true" />
              <span>{groupLabel(group)}</span><b>{formatReportNumber(active.counts[group])}</b>
            </span>)}
            <span className="rpt-tooltip-row is-total"><span /><span>Tổng</span><b>{formatReportNumber(active.total)}</b></span>
          </div>}
        </div>
        <div className="rpt-timeline-x" aria-hidden="true">
          {points.map((point, index) => labels.has(index) && <span key={point.at}
            className={index === 0 ? 'is-first' : index === points.length - 1 ? 'is-last' : ''}
            style={{ left: `${((index + 0.5) / points.length) * 100}%` }}>{timelineTick(point.at, unit, index === 0 ? null : points[previousLabel(index)]?.at ?? null)}</span>)}
        </div>
      </div>
    </div>
  </div>
}
