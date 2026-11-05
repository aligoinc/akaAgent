import { CalendarClock, Layers, Sparkles } from 'lucide-react'
import {
  MIN_RATE_SAMPLE, formatEffectivenessNumber, formatEffectivenessRate,
  type EffectivenessDataGroups, type EffectivenessHours, type GoldenHourSlot
} from '../../../../shared/campaignEffectiveness'
import { effectivenessRequest } from './effectivenessApi'
import { ActivityColumns, BarList, HourHeatmap } from './EffectivenessCharts'
import { useEffectivenessData } from './useEffectivenessData'
import type { EffectivenessTabProps } from './EffectivenessReportsHub'

const MAX_HOURS_RANGE_MS = 92 * 24 * 60 * 60 * 1000

function describeMinutes(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes)) return null
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} phút`
  const hours = minutes / 60
  return hours < 24 ? `${hours.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ` : `${Math.round(hours / 24)} ngày`
}

function GoldenList({ slots, metricLabel }: { slots: GoldenHourSlot[]; metricLabel: string }) {
  if (!slots.length) return <p className="eff-muted">Cần thêm dữ liệu để xác định giờ vàng; số liệu sẽ rõ dần khi chiến dịch chạy đều.</p>
  return <ol className="eff-golden">{slots.map((slot, index) => <li key={slot.startHour}>
    <strong>{slot.label}</strong><span>{formatEffectivenessRate(slot.rate)} {metricLabel} · {formatEffectivenessNumber(slot.sample)} lượt</span>
    {index === 0 ? <em>Tốt nhất</em> : null}
  </li>)}</ol>
}

/** "Bí quyết hiệu quả": what works best (golden hours, active hours, best data groups). */
export function InsightsTab({ query, queryKey, cache, onNavigate }: EffectivenessTabProps) {
  const tooLong = Date.parse(query.endIso) - Date.parse(query.startIso) > MAX_HOURS_RANGE_MS
  const hours = useEffectivenessData<EffectivenessHours>(tooLong ? null : `hours|${queryKey}`,
    signal => effectivenessRequest({ kind: 'hours', query }, signal), cache)
  const groups = useEffectivenessData<EffectivenessDataGroups>(`groups|${queryKey}`,
    signal => effectivenessRequest({ kind: 'dataGroups', query }, signal), cache)
  const topGroups = (groups.data?.rows || [])
    .filter(row => row.reached >= MIN_RATE_SAMPLE && (row.interacted + row.friended) > 0)
    .map(row => ({ ...row, rate: (row.interacted + row.friended) / row.reached }))
    .sort((a, b) => b.rate - a.rate || b.reached - a.reached).slice(0, 5)
  const data = hours.data
  const hasMessageHours = !!data?.cells.some(cell => cell.family === 'message')
  const hasFriendHours = !!data?.cells.some(cell => cell.family === 'friend')
  const reply = describeMinutes(data?.medianResponseMinutes ?? null)
  const seen = describeMinutes(data?.medianSeenMinutes ?? null)

  return <div className="eff-tab">
    {tooLong ? <div className="eff-card eff-muted" role="note">Chọn khoảng tối đa 3 tháng để xem giờ vàng và giờ khách hoạt động.</div>
      : hours.status === 'error' ? <div className="eff-state" role="alert">{hours.error}<button type="button" className="btn btn-secondary btn-sm" onClick={hours.reload}>Thử lại</button></div>
      : !data ? <div className="eff-state" role="status">Đang tìm giờ vàng của khách…</div> : <>
        <div className="eff-grid-2">
          <section className="eff-card" aria-labelledby="eff-golden-message">
            <h3 id="eff-golden-message"><CalendarClock size={16} aria-hidden="true" /> Giờ vàng gửi tin</h3>
            {hasMessageHours && <HourHeatmap label="Tỷ lệ khách xem tin theo thứ và giờ gửi" cells={data.cells} family="message" metric="seen" golden={data.messageGolden} />}
            <GoldenList slots={data.messageGolden} metricLabel="khách xem tin" />
            {data.messageGolden[0] && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ kind: 'campaigns' })}>Đặt lịch vào giờ vàng</button>}
          </section>
          <section className="eff-card" aria-labelledby="eff-golden-friend">
            <h3 id="eff-golden-friend"><CalendarClock size={16} aria-hidden="true" /> Giờ vàng kết bạn</h3>
            {hasFriendHours && <HourHeatmap label="Tỷ lệ đồng ý kết bạn theo thứ và giờ gửi lời mời" cells={data.cells} family="friend" metric="friended" golden={data.friendGolden} />}
            <GoldenList slots={data.friendGolden} metricLabel="đồng ý kết bạn" />
          </section>
        </div>
        <section className="eff-card" aria-labelledby="eff-active-hours">
          <h3 id="eff-active-hours"><Sparkles size={16} aria-hidden="true" /> Giờ khách hoạt động</h3>
          {data.activity.length ? <ActivityColumns activity={data.activity} /> : <p className="eff-muted">Giờ hoạt động sẽ hiện khi khách bắt đầu xem và phản hồi tin.</p>}
          {(reply || seen) && <p className="eff-insight">
            {seen ? <>Khách thường xem tin trong khoảng <strong>{seen}</strong> sau khi gửi. </> : null}
            {reply ? <>Khách thường phản hồi trong khoảng <strong>{reply}</strong>.</> : null}
          </p>}
          <p className="eff-footnote">Giờ vàng và giờ hoạt động tính từ tin nhắn và lời mời kết bạn Zalo.</p>
        </section>
      </>}
    <section className="eff-card" aria-labelledby="eff-groups">
      <h3 id="eff-groups"><Layers size={16} aria-hidden="true" /> Nhóm data mang lại nhiều tương tác nhất</h3>
      {groups.status === 'error' ? <p role="alert">{groups.error} <button type="button" className="btn btn-ghost btn-sm" onClick={groups.reload}>Thử lại</button></p>
        : !groups.data ? <p role="status">Đang tải…</p>
        : topGroups.length ? <>
          <BarList ariaLabel="Nhóm data hiệu quả" max={1} items={topGroups.map(row => ({
            key: String(row.groupId), label: row.name, value: row.rate, tone: 'success', display: formatEffectivenessRate(row.rate),
            detail: ` · ${formatEffectivenessNumber(row.reached)} khách`
          }))} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ kind: 'dataGroups' })}>Chạy tiếp với nhóm hiệu quả</button>
        </> : <p className="eff-muted">Khi chiến dịch chạy từ nhóm data, nhóm mang lại nhiều tương tác nhất sẽ hiện ở đây.</p>}
    </section>
  </div>
}
