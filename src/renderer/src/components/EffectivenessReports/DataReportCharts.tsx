// Ported from akaAgentWebApp apps/web/src/features/reports (same layout and wording); data comes over IPC.
import { useState } from 'react'
import {
  DATA_REPORT_SOURCES, DATA_REPORT_SOURCE_LABELS, DATA_REPORT_SOURCE_SHORT_LABELS, formatDataReportDate, formatDataReportNumber,
  type DataReportSource, type DataReportView
} from '../../../../shared/dataReports'

/**
 * Charts of "Báo cáo dữ liệu". Colors follow the validated three-slot palette (dataviz check, light and dark):
 * identity is never color-only — a legend, direct values and a table view always come with it.
 */
const SOURCE_CLASS: Readonly<Record<DataReportSource, string>> = { member: 'is-member', phone: 'is-phone', friend: 'is-friend' }

const weekLabel = (week: string) => formatDataReportDate(week).slice(0, 5)

/** Bar path with 4px rounded top corners anchored to the baseline. */
function topRounded(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.min(radius, width / 2, height)
  return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`
}

export function SourceLegend({ sources }: { sources: readonly DataReportSource[] }) {
  return <div className="dr-legend" aria-hidden="true">
    {sources.map(source => <span key={source}><i className={SOURCE_CLASS[source]} />{DATA_REPORT_SOURCE_LABELS[source]}</span>)}
  </div>
}

/** "Kho lớn dần theo tuần": cumulative store by first source (only rises), with hover details and a table view. */
export function StoreWeeklyChart({ weeks }: { weeks: DataReportView['store']['weekly'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const sources = DATA_REPORT_SOURCES.filter(source => weeks.some(week => week[source] > 0))
  if (weeks.length < 2 || !sources.length) return null
  const width = 640, height = 168, top = 8
  const max = Math.max(1, ...weeks.map(week => week.total))
  const step = width / weeks.length
  const bar = Math.max(6, Math.min(30, step * 0.56))
  const scale = (value: number) => (value / max) * (height - top)
  const labels = weeks.length <= 7 ? weeks.map((_, index) => index) : [0, Math.floor((weeks.length - 1) / 2), weeks.length - 1]
  const active = hover === null ? null : weeks[hover]

  return <div className="dr-weekly">
    {table ? <div className="eff-table-wrap">
      <table className="eff-table">
        <thead><tr><th>Tuần từ</th>{sources.map(source => <th key={source} className="is-num">{DATA_REPORT_SOURCE_SHORT_LABELS[source]}</th>)}<th className="is-num">Tổng</th></tr></thead>
        <tbody>{weeks.map(week => <tr key={week.week}>
          <td>{formatDataReportDate(week.week)}</td>
          {sources.map(source => <td key={source} className="is-num">{week[source] > 0 ? formatDataReportNumber(week[source]) : ''}</td>)}
          <td className="is-num"><strong>{week.total > 0 ? formatDataReportNumber(week.total) : ''}</strong></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="dr-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
        aria-label={`Kho khách hàng theo tuần, từ ${formatDataReportNumber(weeks[0].total)} lên ${formatDataReportNumber(weeks[weeks.length - 1].total)} khách`}>
        <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="dr-baseline" />
        {weeks.map((week, index) => {
          const x = (index + 0.5) * step - bar / 2
          let base = height
          const segments = sources.map(source => ({ source, h: scale(week[source]) })).filter(segment => segment.h > 0)
          return <g key={week.week} className={hover !== null && hover !== index ? 'is-dim' : undefined}>
            {segments.map((segment, position) => {
              const last = position === segments.length - 1
              // A 2px surface gap separates stacked parts; the top part gets the rounded data end.
              const gap = last ? 0 : Math.min(2, segment.h / 2)
              const y = base - segment.h
              base = y
              return last
                ? <path key={segment.source} d={topRounded(x, y, bar, segment.h)} className={`dr-fill ${SOURCE_CLASS[segment.source]}`} />
                : <rect key={segment.source} x={x} y={y + gap} width={bar} height={Math.max(0, segment.h - gap)} className={`dr-fill ${SOURCE_CLASS[segment.source]}`} />
            })}
            {/* Hit target wider and taller than the mark. */}
            <rect x={index * step} y={0} width={step} height={height} className="dr-hit" onMouseEnter={() => setHover(index)} />
          </g>
        })}
      </svg>
      {active && hover !== null && <div className="dr-tooltip" role="status"
        style={{ left: `${Math.min(82, Math.max(18, ((hover + 0.5) / weeks.length) * 100))}%` }}>
        <strong>Tuần từ {formatDataReportDate(active.week)}</strong>
        {sources.slice().reverse().map(source => active[source] > 0 && <span key={source}><i className={SOURCE_CLASS[source]} />{DATA_REPORT_SOURCE_SHORT_LABELS[source]}<b>{formatDataReportNumber(active[source])}</b></span>)}
        <span className="dr-tooltip-total">Tổng kho<b>{formatDataReportNumber(active.total)}</b></span>
      </div>}
      <div className="eff-trend-axis">{labels.map(index => <span key={index} style={{ left: `${((index + 0.5) / weeks.length) * 100}%` }}>{weekLabel(weeks[index].week)}</span>)}</div>
    </div>}
    <div className="dr-chart-foot">
      {!table && <SourceLegend sources={sources} />}
      <button type="button" className="eff-link" aria-pressed={table} onClick={() => setTable(value => !value)}>{table ? 'Xem biểu đồ' : 'Xem dạng bảng'}</button>
    </div>
  </div>
}

/** Parts of the store (the only shares the report prints). */
export function CompositionBar({ items }: { items: DataReportView['store']['composition'] }) {
  if (!items.length) return null
  return <div className="dr-composition">
    <div className="dr-stack" role="img" aria-label={items.map(item => `${item.label}: ${formatDataReportNumber(item.value)} khách`).join(', ')}>
      {items.map(item => <span key={item.key} className={`dr-fill ${SOURCE_CLASS[item.key]}`} style={{ flexGrow: Math.max(item.share, 0.01) }} />)}
    </div>
    <ul className="dr-composition-list">
      {items.map(item => <li key={item.key}>
        <i className={SOURCE_CLASS[item.key]} aria-hidden="true" />
        <span>{item.label}</span>
        <strong>{formatDataReportNumber(item.value)}</strong>
        <em>{Math.max(1, Math.round(item.share * 100))}%</em>
      </li>)}
    </ul>
  </div>
}

/** Friends per week (cumulative, so it only rises or stays level). */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2 || !values.some(value => value > 0)) return null
  const width = 96, height = 28
  const max = Math.max(1, ...values), min = Math.min(...values)
  const span = Math.max(1, max - min)
  // 4px inset keeps the end dot (r 2.5 + 1.5 stroke) inside the box.
  const points = values.map((value, index) => [4 + index * ((width - 8) / (values.length - 1)), height - 4 - ((value - min) / span) * (height - 8)])
  return <svg className="dr-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <polyline points={points.map(([x, y]) => `${x},${y}`).join(' ')} vectorEffect="non-scaling-stroke" />
    <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={2.5} />
  </svg>
}

/** Two positive parts of one data group: already cared for, and ready to care for. */
export function CoverageBar({ cared, ready, label }: { cared: number; ready: number; label: string }) {
  const total = Math.max(1, cared + ready)
  return <div className="dr-coverage-bar" role="img"
    aria-label={`${label}: ${formatDataReportNumber(cared)} khách đã được chăm sóc${ready > 0 ? `, ${formatDataReportNumber(ready)} khách sẵn sàng` : ''}`}>
    <span className="is-cared" style={{ flexGrow: Math.max(cared / total, 0.02) }} />
    {ready > 0 && <span className="is-ready" style={{ flexGrow: ready / total }} />}
  </div>
}
