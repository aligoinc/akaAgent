import type { CSSProperties, ReactNode } from 'react'
import {
  MIN_RATE_SAMPLE, formatEffectivenessNumber, formatEffectivenessRate,
  type EffectivenessActivityPoint, type EffectivenessHourCell, type GoldenHourSlot
} from '../../../../shared/campaignEffectiveness'

/** Lightweight SVG/HTML charts shared by the effectiveness tabs (no chart library). */

export function KpiTile({ icon, label, value, note, badge }: {
  icon: ReactNode; label: string; value: string; note?: string | null; badge?: string | null
}) {
  return <div className="eff-kpi" role="group" aria-label={label}>
    <div className="eff-kpi-head"><span className="eff-kpi-icon" aria-hidden="true">{icon}</span><span>{label}</span></div>
    <div className="eff-kpi-value">{value}{badge ? <span className="eff-growth">{badge}</span> : null}</div>
    {note ? <div className="eff-kpi-note">{note}</div> : null}
  </div>
}

export interface BarItem { key: string; label: string; value: number; display?: string; detail?: string | null; tone?: 'primary' | 'info' | 'success' | 'muted' }

/** Horizontal bars with absolute numbers (used for the customer journey and top lists). */
export function BarList({ items, ariaLabel, max }: { items: BarItem[]; ariaLabel: string; max?: number }) {
  const top = Math.max(1, max ?? Math.max(0, ...items.map(item => item.value)))
  return <ul className="eff-bars" aria-label={ariaLabel}>
    {items.map(item => <li key={item.key} className="eff-bar-row">
      <span className="eff-bar-label" title={item.label}>{item.label}</span>
      <span className="eff-bar-track"><span className={`eff-bar-fill is-${item.tone || 'primary'}`}
        style={{ width: `${Math.max(item.value > 0 ? 2 : 0, Math.min(100, (item.value / top) * 100))}%` }} /></span>
      <span className="eff-bar-value">{item.display ?? formatEffectivenessNumber(item.value)}{item.detail ? <em>{item.detail}</em> : null}</span>
    </li>)}
  </ul>
}

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

/** Daily reach columns with a separate interaction line underneath (no dual axis). */
export function DailyTrend({ points }: { points: Array<{ date: string; reached: number; interacted: number }> }) {
  if (!points.length) return null
  const width = 640, height = 120, lineHeight = 56
  const maxReach = Math.max(1, ...points.map(point => point.reached))
  const maxInteract = Math.max(1, ...points.map(point => point.interacted))
  const step = width / points.length
  const bar = Math.max(2, Math.min(28, step * 0.62))
  const linePath = points.map((point, index) => `${index ? 'L' : 'M'}${(index + 0.5) * step},${lineHeight - 6 - (point.interacted / maxInteract) * (lineHeight - 14)}`).join(' ')
  const labels = points.length <= 8 ? points.map((_, index) => index) : [0, Math.floor((points.length - 1) / 2), points.length - 1]
  return <div className="eff-trend">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Khách tiếp cận theo ngày" className="eff-trend-columns">
      {points.map((point, index) => {
        const h = (point.reached / maxReach) * (height - 8)
        return <rect key={point.date} x={(index + 0.5) * step - bar / 2} y={height - h} width={bar} height={h} rx={2} className="eff-col">
          <title>{`${shortDate(point.date)}: ${formatEffectivenessNumber(point.reached)} lượt tiếp cận`}</title>
        </rect>
      })}
    </svg>
    <svg viewBox={`0 0 ${width} ${lineHeight}`} preserveAspectRatio="none" role="img" aria-label="Khách tương tác theo ngày" className="eff-trend-line">
      <path d={linePath} className="eff-line" vectorEffect="non-scaling-stroke" />
      {points.map((point, index) => <circle key={point.date} cx={(index + 0.5) * step} r={2.5}
        cy={lineHeight - 6 - (point.interacted / maxInteract) * (lineHeight - 14)} className="eff-dot">
        <title>{`${shortDate(point.date)}: ${formatEffectivenessNumber(point.interacted)} khách tương tác`}</title>
      </circle>)}
    </svg>
    <div className="eff-trend-axis">{labels.map(index => <span key={index} style={{ left: `${((index + 0.5) / points.length) * 100}%` }}>{shortDate(points[index].date)}</span>)}</div>
    <div className="eff-legend"><span className="is-primary">Lượt tiếp cận</span><span className="is-info">Khách tương tác</span></div>
  </div>
}

/** Always-rising cumulative line for lifetime achievements. */
export function CumulativeLine({ points, ariaLabel }: { points: Array<{ label: string; value: number }>; ariaLabel: string }) {
  if (!points.length) return null
  const width = 640, height = 110
  let running = 0
  const cumulative = points.map(point => (running += point.value))
  const max = Math.max(1, running)
  const step = points.length > 1 ? width / (points.length - 1) : width
  const coords = cumulative.map((value, index) => [points.length > 1 ? index * step : width / 2, height - 6 - (value / max) * (height - 16)])
  const line = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ')
  return <div className="eff-cumulative">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
      <path d={`${line} L${coords.at(-1)![0]},${height} L${coords[0][0]},${height} Z`} className="eff-area" />
      <path d={line} className="eff-line" vectorEffect="non-scaling-stroke" />
      {coords.map(([x, y], index) => <circle key={points[index].label} cx={x} cy={y} r={2.5} className="eff-dot">
        <title>{`${points[index].label}: ${formatEffectivenessNumber(cumulative[index])}`}</title>
      </circle>)}
    </svg>
    <div className="eff-cumulative-axis"><span>{points[0].label}</span><span>{points.at(-1)!.label}</span></div>
  </div>
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

/**
 * Weekday × hour heatmap of a rate (single-colour scale). Cells without enough sends stay
 * empty; the golden slots get an outline. `bucketHours=3` folds 24 hours into 8 columns.
 */
export function HourHeatmap({ cells, family, metric, golden, bucketHours = 1, label }: {
  cells: EffectivenessHourCell[]; family: 'message' | 'friend'; metric: 'seen' | 'interacted' | 'friended'
  golden: GoldenHourSlot[]; bucketHours?: 1 | 3; label: string
}) {
  const columns = 24 / bucketHours
  const grid = Array.from({ length: 7 }, () => Array.from({ length: columns }, () => ({ tracked: 0, value: 0 })))
  for (const cell of cells) {
    if (cell.family !== family || cell.dow < 1 || cell.dow > 7) continue
    const target = grid[cell.dow - 1][Math.floor(cell.hour / bucketHours)]
    target.tracked += cell.tracked
    target.value += cell[metric]
  }
  const minSample = Math.max(5, Math.round(MIN_RATE_SAMPLE / 6))
  const rates = grid.flat().filter(cell => cell.tracked >= minSample).map(cell => cell.value / cell.tracked)
  const maxRate = Math.max(0.0001, ...rates)
  const goldenHours = new Set(golden.flatMap(slot => [slot.startHour, (slot.startHour + 1) % 24]))
  const isGolden = (column: number) => Array.from({ length: bucketHours }, (_, offset) => column * bucketHours + offset).some(hour => goldenHours.has(hour))
  return <div className="eff-heatmap" role="table" aria-label={label} style={{ ['--eff-columns' as string]: columns } as CSSProperties}>
    <div className="eff-heatmap-row is-head" role="row">
      <span role="columnheader" />
      {Array.from({ length: columns }, (_, column) => <span key={column} role="columnheader" className={isGolden(column) ? 'is-golden' : ''}>
        {column % (bucketHours === 1 ? 3 : 1) === 0 ? `${column * bucketHours}h` : ''}
      </span>)}
    </div>
    {grid.map((row, dayIndex) => <div key={WEEKDAYS[dayIndex]} className="eff-heatmap-row" role="row">
      <span role="rowheader">{WEEKDAYS[dayIndex]}</span>
      {row.map((cell, column) => {
        const enough = cell.tracked >= minSample
        const rate = enough ? cell.value / cell.tracked : null
        const hour = column * bucketHours
        const title = `${WEEKDAYS[dayIndex]} ${String(hour).padStart(2, '0')}:00–${String(hour + bucketHours).padStart(2, '0')}:00 · ${enough
          ? `${formatEffectivenessRate(rate)} · ${formatEffectivenessNumber(cell.tracked)} lượt` : 'chưa đủ dữ liệu'}`
        return <span key={column} role="cell" title={title} className={`eff-heat-cell${rate !== null && isGolden(column) ? ' is-golden' : ''}`}>
          {rate !== null ? <i style={{ opacity: 0.12 + 0.88 * (rate / maxRate) }} /> : null}
        </span>
      })}
    </div>)}
  </div>
}

/** Hours of the day when customers see, reply and accept friend requests. */
export function ActivityColumns({ activity }: { activity: EffectivenessActivityPoint[] }) {
  const byHour = Array.from({ length: 24 }, (_, hour) => activity.find(point => point.hour === hour))
  const totals = byHour.map(point => (point?.seen || 0) + (point?.responded || 0) + (point?.reacted || 0) + (point?.friended || 0))
  const max = Math.max(1, ...totals)
  return <div className="eff-activity" role="img" aria-label="Giờ khách hoạt động">
    {totals.map((total, hour) => <span key={hour} className="eff-activity-col" title={`${String(hour).padStart(2, '0')}:00 · ${formatEffectivenessNumber(total)} lượt khách xem/phản hồi/kết bạn`}>
      <i style={{ height: `${Math.max(total > 0 ? 3 : 0, (total / max) * 100)}%` }} />
      <em>{hour % 3 === 0 ? `${hour}h` : ''}</em>
    </span>)}
  </div>
}
