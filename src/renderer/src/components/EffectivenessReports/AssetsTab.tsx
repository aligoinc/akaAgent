import { BookOpen, Clock, Contact, Layers, MessageCircleHeart, Tags, Trophy, UserPlus, Users } from 'lucide-react'
import {
  REACH_MILESTONES, describeTimeSaved, formatEffectivenessNumber,
  type EffectivenessAssets, type EffectivenessLifetime
} from '../../../../shared/campaignEffectiveness'
import { effectivenessRequest } from './effectivenessApi'
import { CumulativeLine, KpiTile } from './EffectivenessCharts'
import { useEffectivenessData } from './useEffectivenessData'
import type { EffectivenessTabProps } from './EffectivenessReportsHub'

const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`

/** "Tài sản của bạn": what the customer has accumulated in the software (always growing). */
export function AssetsTab({ query, scopeKey, authKey, cache, onNavigate }: EffectivenessTabProps) {
  const lifetime = useEffectivenessData<EffectivenessLifetime>(`lifetime|${scopeKey}`,
    signal => effectivenessRequest({ kind: 'lifetime', flatformType: query.flatformType, accountIds: query.accountIds }, signal), cache)
  const assets = useEffectivenessData<EffectivenessAssets>(`assets|${authKey}`, signal => effectivenessRequest({ kind: 'assets' }, signal), cache)
  const life = lifetime.data
  const reached = life ? life.totals.uniqueReached ?? life.totals.reached : 0
  const sinceDays = life?.since ? Math.max(1, Math.round((Date.now() - Date.parse(life.since)) / 86_400_000)) : null
  const nextMilestone = life?.milestones.next ?? null

  return <div className="eff-tab">
    <section className="eff-card" aria-labelledby="eff-journey-life">
      <h3 id="eff-journey-life"><Trophy size={16} aria-hidden="true" /> Hành trình cùng akaBiz · 12 tháng gần nhất</h3>
      {lifetime.status === 'error' ? <p role="alert">{lifetime.error} <button type="button" className="btn btn-ghost btn-sm" onClick={lifetime.reload}>Thử lại</button></p>
        : !life ? <p role="status">Đang tổng hợp hành trình…</p> : <>
          <div className="eff-kpis">
            <KpiTile icon={<Users size={16} />} label="Khách đã tiếp cận" value={formatEffectivenessNumber(reached)}
              note={life.totals.uniqueReached !== null ? `${formatEffectivenessNumber(life.totals.reached)} lượt gửi thành công` : null} />
            {life.totals.friended > 0 && <KpiTile icon={<UserPlus size={16} />} label="Bạn mới" value={formatEffectivenessNumber(life.totals.friended)} />}
            {life.totals.interacted > 0 && <KpiTile icon={<MessageCircleHeart size={16} />} label="Lượt khách tương tác" value={formatEffectivenessNumber(life.totals.interacted)} />}
            <KpiTile icon={<Clock size={16} />} label="Thời gian tiết kiệm" value={describeTimeSaved(life.timeSavedSeconds).label} note="Ước tính so với thao tác tay" />
            {sinceDays && <KpiTile icon={<Trophy size={16} />} label="Ngày đồng hành" value={formatEffectivenessNumber(sinceDays)}
              note={`Từ ${new Date(life.since!).toLocaleDateString('vi-VN')}`} />}
          </div>
          <CumulativeLine ariaLabel="Khách tiếp cận cộng dồn theo tháng" points={life.monthly.map(month => ({ label: monthLabel(month.month), value: month.reached }))} />
          <div className="eff-milestones" aria-label="Cột mốc">
            {REACH_MILESTONES.map(value => <span key={value} className={`eff-milestone${life.milestones.achieved.includes(value) ? ' is-achieved' : ''}`}>
              {formatEffectivenessNumber(value)} khách
            </span>)}
          </div>
          {nextMilestone && <div className="eff-progress" aria-label={`Tiến tới cột mốc ${formatEffectivenessNumber(nextMilestone)} khách`}>
            <span style={{ width: `${Math.round(life.milestones.progress * 100)}%` }} />
            <em>Còn {formatEffectivenessNumber(Math.max(0, nextMilestone - reached))} khách nữa để đạt cột mốc {formatEffectivenessNumber(nextMilestone)} khách</em>
          </div>}
        </>}
    </section>
    <section className="eff-card" aria-labelledby="eff-data-assets">
      <h3 id="eff-data-assets"><Layers size={16} aria-hidden="true" /> Kho data của bạn</h3>
      {assets.status === 'error' ? <p role="alert">{assets.error} <button type="button" className="btn btn-ghost btn-sm" onClick={assets.reload}>Thử lại</button></p>
        : !assets.data ? <p role="status">Đang đếm kho data…</p> : <>
          <div className="eff-kpis">
            <KpiTile icon={<Layers size={16} />} label="Nhóm data" value={formatEffectivenessNumber(assets.data.dataGroups)} />
            <KpiTile icon={<Contact size={16} />} label="Liên hệ đã quét" value={formatEffectivenessNumber(assets.data.zaloContacts)} note="Bạn bè và nhóm từ các tài khoản" />
            <KpiTile icon={<Tags size={16} />} label="Thẻ phân loại" value={formatEffectivenessNumber(assets.data.tags)} />
            <KpiTile icon={<BookOpen size={16} />} label="Mẫu nội dung" value={formatEffectivenessNumber(assets.data.contentTemplates)} />
          </div>
          <p className="eff-footnote">Kho data được lưu và cập nhật trong akaBiz để bạn dùng lại cho các chiến dịch tiếp theo.</p>
          <div className="eff-inline-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ kind: 'dataGroups' })}>Mở nhóm data</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ kind: 'contentTemplates' })}>Mở mẫu nội dung</button>
          </div>
        </>}
    </section>
  </div>
}
