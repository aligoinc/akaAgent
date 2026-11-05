import { useState, type ReactElement } from 'react'
import {
  Clock, Eye, Heart, Lightbulb, MessageCircleHeart, MessagesSquare, PenSquare, Rocket, Send, Trophy, UserPlus, Users, UsersRound
} from 'lucide-react'
import {
  COMMUNITY_ACTIVITY_LABELS, communityActivity, describeTimeSaved, effectivenessRate, formatEffectivenessNumber,
  formatEffectivenessRate, growthBadge, selectEffectivenessSuggestions,
  type CommunityActivity, type EffectivenessHours, type EffectivenessLifetime, type EffectivenessListStage, type EffectivenessOverview
} from '../../../../shared/campaignEffectiveness'
import { effectivenessRequest } from './effectivenessApi'
import { BarList, DailyTrend, KpiTile } from './EffectivenessCharts'
import { EffectivenessCustomersDialog } from './EffectivenessCustomersDialog'
import { EffectivenessAiSummary } from './EffectivenessAiSummary'
import { suggestionNavigation } from './effectivenessPaths'
import { useEffectivenessData } from './useEffectivenessData'
import type { EffectivenessTabProps } from './EffectivenessReportsHub'

const ACTIVITY_ICONS: Record<keyof CommunityActivity, ReactElement> = {
  posts: <PenSquare size={16} />, comments: <MessagesSquare size={16} />, likes: <Heart size={16} />,
  groupsJoined: <UsersRound size={16} />, groupInvites: <UserPlus size={16} />, groupMessages: <Send size={16} />
}

/** "Thành quả": achievements first, then a few positive suggestions and next opportunities. */
export function AchievementsTab(props: EffectivenessTabProps) {
  const { query, queryKey, scopeKey, compare, cache, rangeLabel, onNavigate } = props
  const [customers, setCustomers] = useState<{ stage: EffectivenessListStage; title: string } | null>(null)
  const overview = useEffectivenessData<EffectivenessOverview>(`overview|${queryKey}|${compare}`,
    signal => effectivenessRequest({ kind: 'overview', query, compare }, signal), cache)
  const lifetime = useEffectivenessData<EffectivenessLifetime>(`lifetime|${scopeKey}`,
    signal => effectivenessRequest({ kind: 'lifetime', flatformType: query.flatformType, accountIds: query.accountIds }, signal), cache)
  const hours = cache.get(`hours|${queryKey}`) as EffectivenessHours | undefined

  if (overview.status === 'loading' || overview.status === 'idle') return <div className="eff-state" role="status">Đang tổng hợp thành quả…</div>
  if (overview.status === 'error' || !overview.data) {
    return <div className="eff-state" role="alert">{overview.error || 'Không thể tải báo cáo.'}
      <button type="button" className="btn btn-secondary btn-sm" onClick={overview.reload}>Thử lại</button></div>
  }
  const data = overview.data
  const unique = data.unique
  const reached = unique?.reached ?? data.reached
  const seen = unique?.seen ?? data.message.seen
  const interacted = unique?.interacted ?? data.message.interacted
  const friended = unique?.friended ?? data.friend.friended
  const seenRate = effectivenessRate(data.message.seen, data.message.tracked)
  const time = describeTimeSaved(data.timeSavedSeconds)
  // Seen/replied/friend results exist for Zalo messages and friend requests only; other channels show their own results.
  const showsMessageJourney = data.message.sent > 0
  const showsFriendJourney = data.friend.requested > 0
  const activity = communityActivity(Object.fromEntries(data.actions.map(action => [action.code, action.counts.success])))
  const activityItems = (Object.keys(COMMUNITY_ACTIVITY_LABELS) as Array<keyof CommunityActivity>)
    .filter(key => activity[key] > 0).map(key => ({ key, label: COMMUNITY_ACTIVITY_LABELS[key], value: activity[key] }))
  const suggestions = selectEffectivenessSuggestions({
    ...data.signals,
    messageGoldenHours: hours?.messageGolden[0] ?? null,
    sendsInGoldenWindow: hours ? goldenShare(hours) : null,
    remainingCapacity: null
  })
  const life = lifetime.data
  const lifeReached = life ? life.totals.uniqueReached ?? life.totals.reached : null
  const sinceDays = life?.since ? Math.max(1, Math.round((Date.now() - Date.parse(life.since)) / 86_400_000)) : null
  const nothingYet = data.totals.success === 0 && data.totals.pending === 0

  return <div className="eff-tab" aria-live="polite">
    {life && lifeReached !== null && lifeReached > 0 && <section className="eff-banner" aria-label="Hành trình cùng akaBiz">
      <Trophy size={18} aria-hidden="true" />
      <div>
        <strong>12 tháng qua cùng akaBiz: {formatEffectivenessNumber(lifeReached)} khách đã được tiếp cận</strong>
        <span>{life.totals.friended > 0 ? ` · ${formatEffectivenessNumber(life.totals.friended)} bạn mới` : ''}
          {life.totals.interacted > 0 ? ` · ${formatEffectivenessNumber(life.totals.interacted)} lượt khách tương tác` : ''}
          {sinceDays ? ` · ${formatEffectivenessNumber(sinceDays)} ngày đồng hành` : ''}</span>
      </div>
      {life.milestones.achieved.length > 0 && <span className="eff-badge">Huy hiệu {formatEffectivenessNumber(life.milestones.achieved.at(-1)!)} khách</span>}
    </section>}

    {nothingYet ? <section className="eff-card eff-empty">
      <Rocket size={20} aria-hidden="true" />
      <div><strong>Chưa có kết quả trong {rangeLabel.toLowerCase()}.</strong><p>Chạy một chiến dịch để bắt đầu ghi nhận thành quả cho khách hàng của bạn.</p></div>
      <button type="button" className="btn btn-primary" onClick={() => onNavigate({ kind: 'campaigns' })}>Tạo chiến dịch</button>
    </section> : <>
      <section className="eff-kpis" aria-label="Thành quả kỳ này">
        <KpiTile icon={<Users size={16} />} label="Khách đã tiếp cận" value={formatEffectivenessNumber(reached)}
          badge={compare ? growthBadge(data.reached, data.previousReached) : null}
          note={unique ? `${formatEffectivenessNumber(data.reached)} lượt gửi thành công` : 'Lượt gửi thành công'} />
        {showsMessageJourney && <KpiTile icon={<Eye size={16} />} label="Khách đã xem" value={formatEffectivenessNumber(seen)}
          note={seenRate !== null ? `${formatEffectivenessRate(seenRate)} tin được xem` : null} />}
        {showsMessageJourney && <KpiTile icon={<MessageCircleHeart size={16} />} label="Khách tương tác" value={formatEffectivenessNumber(interacted)}
          note="Phản hồi hoặc thả cảm xúc" />}
        {showsFriendJourney && <KpiTile icon={<UserPlus size={16} />} label="Bạn mới" value={formatEffectivenessNumber(friended)} note="Đồng ý kết bạn" />}
        <KpiTile icon={<Clock size={16} />} label="Thời gian tiết kiệm" value={time.label} note="Ước tính so với thao tác tay" />
      </section>

      {activityItems.length > 0 && <section className="eff-card" aria-labelledby="eff-activity-title">
        <h3 id="eff-activity-title">Hoạt động đã thực hiện</h3>
        <div className="eff-kpis is-compact">
          {activityItems.map(item => <KpiTile key={item.key} icon={ACTIVITY_ICONS[item.key]} label={item.label} value={formatEffectivenessNumber(item.value)} />)}
        </div>
      </section>}

      <EffectivenessAiSummary query={query} scopeKey={queryKey} onNavigate={onNavigate} />

      <div className="eff-grid-2">
        <section className="eff-card" aria-labelledby="eff-journey-title">
          <h3 id="eff-journey-title">Hành trình khách hàng</h3>
          {showsMessageJourney && <BarList ariaLabel="Hành trình tin nhắn" items={[
            { key: 'sent', label: 'Đã gửi', value: data.message.sent },
            { key: 'received', label: data.message.receivedIsMinimum ? 'Đã nhận*' : 'Đã nhận', value: data.message.received, tone: 'info' },
            { key: 'seen', label: 'Đã xem', value: data.message.seen, tone: 'info' },
            { key: 'interacted', label: 'Tương tác + phản hồi', value: data.message.interacted, tone: 'success',
              detail: data.message.interacted ? ` · ${formatEffectivenessNumber(data.message.responded)} phản hồi` : null }
          ]} />}
          {showsFriendJourney && <BarList ariaLabel="Hành trình kết bạn" max={Math.max(data.message.sent, data.friend.requested)} items={[
            { key: 'requested', label: 'Đã gửi lời mời', value: data.friend.requested },
            { key: 'friended', label: 'Đồng ý kết bạn', value: data.friend.friended, tone: 'success' }
          ]} />}
          {!showsMessageJourney && !showsFriendJourney && <BarList ariaLabel="Kết quả theo hành động" items={data.actions
            .filter(action => action.counts.success > 0).sort((a, b) => b.counts.success - a.counts.success).slice(0, 6)
            .map(action => ({ key: action.code, label: action.name, value: action.counts.success, tone: 'success' as const }))} />}
          <p className="eff-footnote">
            {showsMessageJourney && data.message.receivedIsMinimum ? '* Đã nhận tính theo khách đã xem hoặc tương tác. ' : ''}
            {data.totals.pending > 0 ? `${formatEffectivenessNumber(data.totals.pending)} lượt đang chờ gửi. ` : ''}
            {showsMessageJourney && data.stillTrackingSince ? 'Tương tác của các tin gửi trong 48 giờ gần đây vẫn đang được cập nhật.' : ''}
          </p>
        </section>
        <section className="eff-card" aria-labelledby="eff-trend-title">
          <h3 id="eff-trend-title">Xu hướng theo ngày</h3>
          <DailyTrend points={data.daily} />
        </section>
      </div>

      <div className="eff-grid-2">
        <section className="eff-card" aria-labelledby="eff-suggest-title">
          <h3 id="eff-suggest-title"><Lightbulb size={16} aria-hidden="true" /> Gợi ý để tăng kết quả</h3>
          {suggestions.length ? <ol className="eff-suggestions">
            {suggestions.map(item => <li key={item.id}>
              <span>{item.title}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate(suggestionNavigation(item.target))}>{item.actionLabel}</button>
            </li>)}
          </ol> : <p className="eff-muted">Chiến dịch đang chạy tốt. Hãy tiếp tục duy trì nhịp gửi đều đặn.</p>}
        </section>
        <section className="eff-card" aria-labelledby="eff-next-title">
          <h3 id="eff-next-title"><Rocket size={16} aria-hidden="true" /> Cơ hội tiếp theo</h3>
          <ul className="eff-opportunities">
            {data.opportunities.engagedCustomers > 0 && <li>
              <span><strong>{formatEffectivenessNumber(data.opportunities.engagedCustomers)}</strong> khách đã phản hồi hoặc thả cảm xúc — sẵn sàng để chăm sóc tiếp.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCustomers({ stage: 'interacted', title: 'Khách đã tương tác' })}>Xem danh sách</button>
            </li>}
            {data.opportunities.newFriends > 0 && <li>
              <span><strong>{formatEffectivenessNumber(data.opportunities.newFriends)}</strong> bạn mới — gửi lời chào để giữ kết nối.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCustomers({ stage: 'friended', title: 'Bạn mới' })}>Xem danh sách</button>
            </li>}
            {!data.opportunities.engagedCustomers && !data.opportunities.newFriends && <li>
              <span>Khi khách bắt đầu tương tác, danh sách chăm sóc tiếp theo sẽ xuất hiện ở đây.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ kind: 'dataGroups' })}>Mở nhóm data</button>
            </li>}
          </ul>
        </section>
      </div>
    </>}
    {customers && <EffectivenessCustomersDialog query={query} stage={customers.stage} title={customers.title} onClose={() => setCustomers(null)} />}
  </div>
}

function goldenShare(hours: EffectivenessHours): number | null {
  const slot = hours.messageGolden[0]
  if (!slot) return null
  const inside = new Set([slot.startHour, (slot.startHour + 1) % 24])
  let total = 0, within = 0
  for (const cell of hours.cells) {
    if (cell.family !== 'message') continue
    total += cell.tracked
    if (inside.has(cell.hour)) within += cell.tracked
  }
  return total ? within / total : null
}
