// Chép nguyên văn từ akaAgentWebApp packages/control-api/src/campaignEffectivenessAssembly.ts.
import {
  FRIEND_ENGAGEMENT_ACTION, LEGACY_SUCCESS_DETAIL_STATUSES, MESSAGE_ENGAGEMENT_ACTIONS, PHONE_LOOKUP_ACTION, REACH_ACTIONS,
  addEffectivenessCounts, communityActivity, describeTimeSaved, effectivenessRate, emptyEffectivenessCounts,
  estimateTimeSavedSeconds, finalEngagementStage, friendFunnel, vietnamDateKey,
  goldenHourSlots, messageFunnel, reachMilestones, selectEffectivenessSuggestions, vietnamDateKeysInRange,
  type CampaignActionProgress, type CampaignEffectivenessDetail, type CampaignEffectivenessList, type CampaignEffectivenessRow,
  type EffectivenessAccountStages, type GoldenHourSlot,
  type EffectivenessActivityPoint, type EffectivenessCounts, type EffectivenessCustomerRow, type EffectivenessDailyPoint,
  type EffectivenessHourCell, type EffectivenessHours,
  type EffectivenessLifetime, type EffectivenessLifetimeMonth, type EffectivenessListStage,
  type EffectivenessOverview, type EffectivenessQuery, type EngagementStage
} from './campaignEffectiveness'

/**
 * Pure assembly of effectiveness reports from V462 rows: the WebApp API, iOS (through the API) and the Desktop
 * (akaAgent copies this file to src/shared) compute every number with the same code. Map/Set iteration goes
 * through Array.from: the Desktop renderer typechecks src/shared without downlevelIteration.
 */

export interface EffectivenessCampaignMeta {
  id: number; name: string; actionId: string; actionName: string; status: string; accountId: number; isDeleted: boolean
}

export type EffectivenessResultGroup = 'success' | 'failure' | 'skipped' | 'pending'
export interface EffectivenessStageColumns { count: number; tracked: number; responded: number; reacted: number; seen: number; friended: number }
export interface EffectivenessSummaryRow extends EffectivenessStageColumns {
  day: string; accountId: number; actionCode: string; group: EffectivenessResultGroup; statusId: number | null; pendingInputIds: number[] | null
}
export interface EffectivenessSummaryResult {
  rows: EffectivenessSummaryRow[]
  statusCodes: Record<string, string>
  unique: { reached: number; seen: number; interacted: number; friended: number } | null
}
export interface EffectivenessCampaignResultRow extends EffectivenessStageColumns {
  campaignId: number; actionCode: string; group: EffectivenessResultGroup; firstAt: string | null; lastAt: string | null; pendingInputIds: number[] | null
}
export interface EffectivenessHoursResult {
  cells: EffectivenessHourCell[]; activity: EffectivenessActivityPoint[]
  medianResponseMinutes: number | null; medianSeenMinutes: number | null
}
export interface EffectivenessListRow {
  id: number; campaignId: number; campaignName: string; accountId: number; actionCode: string; sentAt: string
  seenAt: string | null; respondedAt: string | null; reactedAt: string | null; friendedAt: string | null
  name: string | null; uid: string | null; phone: string | null
}
export interface EffectivenessLifetimeResult {
  monthly: Array<{ month: string; actionCode: string; count: number; tracked: number; seen: number; interacted: number; friended: number }>
  unique: { reached: number } | null
  firstCampaignAt: string | null
}

export const EFFECTIVENESS_TRACKING_WINDOW_MS = 48 * 60 * 60 * 1000
export const EFFECTIVENESS_HOURS_MAX_RANGE_MS = 92 * 24 * 60 * 60 * 1000
export const EFFECTIVENESS_LONG_CACHE_MS = 10 * 60 * 1000
export const EFFECTIVENESS_LIST_STAGES: readonly EffectivenessListStage[] = ['responded', 'reacted', 'seen', 'received', 'sent', 'friended', 'requested', 'interacted', 'engaged']
/**
 * Legacy detail rows (report_group NULL): text statuses the reader maps to success/skipped/failure.
 * WebApp, iOS (via the API) and Desktop send the same lists so every surface shows identical numbers.
 */
export const EFFECTIVENESS_LEGACY_STATUSES = {
  success: [...LEGACY_SUCCESS_DETAIL_STATUSES] as string[],
  skipped: ['đã gửi lời mời', 'đã là thành viên'] as string[],
  failure: ['thất bại', 'lỗi', 'không tồn tại'] as string[]
} as const
export const isEffectivenessMessageAction = (code: string) => (MESSAGE_ENGAGEMENT_ACTIONS as readonly string[]).includes(code)

export function effectivenessCountsFromRow(row: { group: EffectivenessResultGroup } & EffectivenessStageColumns): EffectivenessCounts {
  const counts = emptyEffectivenessCounts()
  counts[row.group] = Number(row.count) || 0
  if (row.group === 'success') {
    counts.tracked = Number(row.tracked) || 0
    counts.responded = Number(row.responded) || 0
    counts.reacted = Number(row.reacted) || 0
    counts.seen = Number(row.seen) || 0
    counts.friended = Number(row.friended) || 0
  }
  return counts
}

export function effectivenessPendingPairs(rows: ReadonlyArray<{ group: EffectivenessResultGroup; actionCode: string; pendingInputIds: number[] | null }>): Set<string> {
  const pairs = new Set<string>()
  for (const row of rows) {
    if (row.group !== 'pending') continue
    for (const id of row.pendingInputIds || []) pairs.add(`${id}:${row.actionCode}`)
  }
  return pairs
}

export function sumEffectivenessCounts(rows: Iterable<EffectivenessCounts>): EffectivenessCounts {
  const total = emptyEffectivenessCounts()
  for (const row of Array.from(rows)) addEffectivenessCounts(total, row)
  return total
}

export function effectivenessCountsByAction(rows: ReadonlyArray<{ actionCode: string; group: EffectivenessResultGroup } & EffectivenessStageColumns>): Map<string, EffectivenessCounts> {
  const byAction = new Map<string, EffectivenessCounts>()
  for (const row of rows) {
    const counts = byAction.get(row.actionCode) || emptyEffectivenessCounts()
    addEffectivenessCounts(counts, effectivenessCountsFromRow(row))
    byAction.set(row.actionCode, counts)
  }
  return byAction
}

export const effectivenessReached = (byAction: Map<string, EffectivenessCounts>) =>
  REACH_ACTIONS.reduce((sum, code) => sum + (byAction.get(code)?.success || 0), 0)

export const sumEffectivenessActions = (byAction: Map<string, EffectivenessCounts>, codes: readonly string[]) =>
  sumEffectivenessCounts(codes.map(code => byAction.get(code) || emptyEffectivenessCounts()))

export function effectivenessSuccessByAction(byAction: Map<string, EffectivenessCounts>): Record<string, number> {
  return Object.fromEntries(Array.from(byAction, ([code, counts]) => [code, counts.success]))
}

export function effectivenessDailySeries(query: EffectivenessQuery, rows: readonly EffectivenessSummaryRow[]): EffectivenessDailyPoint[] {
  const days = new Map(vietnamDateKeysInRange(query).map(date => [date, { date, reached: 0, seen: 0, interacted: 0, friended: 0, success: 0 }]))
  for (const row of rows) {
    if (row.group !== 'success') continue
    const point = days.get(row.day)
    if (!point) continue
    point.success += row.count
    if (REACH_ACTIONS.includes(row.actionCode)) point.reached += row.count
    point.seen += row.responded + row.reacted + row.seen
    point.interacted += row.responded + row.reacted
    point.friended += row.friended
  }
  return Array.from(days.values())
}

/** Pure overview assembly from V462 rows (exported for tests). */
export function buildEffectivenessOverview(input: {
  query: EffectivenessQuery
  actions: ReadonlyArray<{ code: string; name: string }>
  summary: EffectivenessSummaryResult
  pendingInputsByAction: Map<string, number>
  previous: EffectivenessSummaryResult | null
  now: Date
}): EffectivenessOverview {
  const { query, summary } = input
  const byAction = effectivenessCountsByAction(summary.rows)
  for (const [code, pending] of Array.from(input.pendingInputsByAction)) {
    const counts = byAction.get(code) || emptyEffectivenessCounts()
    counts.pending += pending
    byAction.set(code, counts)
  }
  const totals = sumEffectivenessCounts(byAction.values())
  const statusCounts: Record<string, number> = {}
  for (const row of summary.rows) {
    if (row.statusId === null || row.statusId === undefined) continue
    const code = summary.statusCodes[String(row.statusId)]
    if (code) statusCounts[code] = (statusCounts[code] || 0) + row.count
  }
  const messageCounts = sumEffectivenessActions(byAction, MESSAGE_ENGAGEMENT_ACTIONS)
  const friendCounts = byAction.get(FRIEND_ENGAGEMENT_ACTION) || emptyEffectivenessCounts()
  const phone = byAction.get(PHONE_LOOKUP_ACTION) || emptyEffectivenessCounts()
  const trackable = messageCounts.success + friendCounts.success
  const tracked = messageCounts.tracked + friendCounts.tracked
  const message = messageFunnel(messageCounts)
  const friend = friendFunnel(friendCounts)
  const windowStart = input.now.getTime() - EFFECTIVENESS_TRACKING_WINDOW_MS
  const previousByAction = input.previous ? effectivenessCountsByAction(input.previous.rows) : null
  const attempts = totals.success + totals.failure + totals.skipped
  const names = new Map(input.actions.map(action => [action.code, action.name]))
  return {
    query,
    generatedAt: input.now.toISOString(),
    totals,
    previousTotals: previousByAction ? sumEffectivenessCounts(previousByAction.values()) : null,
    reached: effectivenessReached(byAction),
    previousReached: previousByAction ? effectivenessReached(previousByAction) : null,
    unique: summary.unique,
    message,
    friend,
    phoneLookup: { attempts: phone.success + phone.failure, found: phone.success },
    actions: Array.from(byAction, ([code, counts]) => ({ code, name: names.get(code) || code, counts }))
      .sort((a, b) => b.counts.success - a.counts.success || a.code.localeCompare(b.code)),
    daily: effectivenessDailySeries(query, summary.rows),
    timeSavedSeconds: estimateTimeSavedSeconds(effectivenessSuccessByAction(byAction)),
    trackingCoverage: trackable > 0 ? Math.min(1, tracked / trackable) : null,
    stillTrackingSince: Date.parse(query.endIso) > windowStart
      ? new Date(Math.max(Date.parse(query.startIso), windowStart)).toISOString() : null,
    suggestions: selectEffectivenessSuggestions({ statusCounts, attempts }),
    signals: { statusCounts, attempts },
    opportunities: {
      engagedCustomers: summary.unique?.interacted ?? message.interacted,
      newFriends: summary.unique?.friended ?? friend.friended,
      remainingCapacity: []
    }
  }
}

export function engagementStagesFor(code: string, counts: EffectivenessCounts): Partial<Record<EngagementStage, number>> {
  if (isEffectivenessMessageAction(code)) {
    return { responded: counts.responded, reacted: counts.reacted, seen: counts.seen,
      sent: Math.max(0, counts.success - counts.responded - counts.reacted - counts.seen - counts.received) }
  }
  if (code === FRIEND_ENGAGEMENT_ACTION) return { friended: counts.friended, requested: Math.max(0, counts.success - counts.friended) }
  return {}
}

export function buildCampaignRows(input: {
  rows: EffectivenessCampaignResultRow[]
  campaigns: readonly EffectivenessCampaignMeta[]
  accounts: ReadonlyArray<{ id: number; name: string }>
}): CampaignEffectivenessRow[] {
  const accountNames = new Map(input.accounts.map(account => [account.id, account.name]))
  const meta = new Map(input.campaigns.map(campaign => [campaign.id, campaign]))
  const grouped = new Map<number, EffectivenessCampaignResultRow[]>()
  for (const row of input.rows) grouped.set(row.campaignId, [...(grouped.get(row.campaignId) || []), row])
  const result: CampaignEffectivenessRow[] = []
  for (const [campaignId, rows] of Array.from(grouped)) {
    const campaign = meta.get(campaignId)
    if (!campaign) continue
    const byAction = effectivenessCountsByAction(rows)
    const counts = sumEffectivenessCounts(byAction.values())
    const firstAt = rows.map(row => row.firstAt).filter((value): value is string => !!value).sort()[0] || null
    const lastAt = rows.map(row => row.lastAt).filter((value): value is string => !!value).sort().at(-1) || null
    const message = messageFunnel(sumEffectivenessActions(byAction, MESSAGE_ENGAGEMENT_ACTIONS))
    result.push({
      campaignId, name: campaign.name, actionId: campaign.actionId, actionName: campaign.actionName, status: campaign.status,
      accountId: campaign.accountId, accountName: accountNames.get(campaign.accountId) || '', isDeleted: campaign.isDeleted,
      counts, reached: effectivenessReached(byAction), seen: message.seen, interacted: message.interacted,
      friended: byAction.get(FRIEND_ENGAGEMENT_ACTION)?.friended || 0, firstAt, lastAt
    })
  }
  return result.sort((a, b) => b.reached - a.reached || (b.lastAt || '').localeCompare(a.lastAt || '') || a.campaignId - b.campaignId)
}

export function shiftEffectivenessMonthKey(dateKey: string, months: number): string {
  const [year, month] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, 1))
  return date.toISOString().slice(0, 7)
}

export function buildLifetime(result: EffectivenessLifetimeResult, startKey: string, today: string, rangeStartIso: string, now: Date): EffectivenessLifetime {
  const months = new Map<string, EffectivenessLifetimeMonth>()
  for (let key = startKey.slice(0, 7); key <= today.slice(0, 7); key = shiftEffectivenessMonthKey(`${key}-01`, 1)) {
    months.set(key, { month: key, reached: 0, seen: 0, interacted: 0, friended: 0, success: 0 })
  }
  const success: Record<string, number> = {}
  for (const row of result.monthly) {
    const month = months.get(row.month)
    if (!month) continue
    month.success += row.count
    if (REACH_ACTIONS.includes(row.actionCode)) month.reached += row.count
    month.seen += row.seen
    month.interacted += row.interacted
    month.friended += row.friended
    success[row.actionCode] = (success[row.actionCode] || 0) + row.count
  }
  const monthly = Array.from(months.values())
  const totals = monthly.reduce((sum, month) => ({
    reached: sum.reached + month.reached, seen: sum.seen + month.seen, interacted: sum.interacted + month.interacted,
    friended: sum.friended + month.friended, success: sum.success + month.success
  }), { reached: 0, seen: 0, interacted: 0, friended: 0, success: 0 })
  const uniqueReached = result.unique ? Number(result.unique.reached) : null
  return {
    since: result.firstCampaignAt, rangeStartIso, monthly,
    totals: { ...totals, uniqueReached },
    milestones: reachMilestones(uniqueReached ?? totals.reached),
    timeSavedSeconds: estimateTimeSavedSeconds(success),
    generatedAt: now.toISOString()
  }
}

/** One campaign: totals, funnels, daily series and per-action progress (pending = results + inputs still waiting). */
export function buildCampaignDetail(input: {
  query: EffectivenessQuery
  campaign: EffectivenessCampaignMeta
  accountName: string
  summary: EffectivenessSummaryResult
  actionNames: ReadonlyMap<string, string>
  pendingInputsByAction?: ReadonlyMap<string, number>
  now: Date
}): CampaignEffectivenessDetail {
  const byAction = effectivenessCountsByAction(input.summary.rows)
  for (const [code, value] of Array.from(input.pendingInputsByAction || [])) {
    const counts = byAction.get(code) || emptyEffectivenessCounts()
    counts.pending += value
    byAction.set(code, counts)
  }
  const actions: CampaignActionProgress[] = Array.from(byAction, ([code, counts]) => ({
    code, name: input.actionNames.get(code) || code, done: counts.success, pending: counts.pending,
    notDone: counts.failure + counts.skipped, stages: engagementStagesFor(code, counts)
  })).sort((a, b) => b.done - a.done || a.code.localeCompare(b.code))
  const campaign = input.campaign
  return {
    query: input.query, generatedAt: input.now.toISOString(),
    campaign: {
      campaignId: campaign.id, name: campaign.name, actionId: campaign.actionId, actionName: campaign.actionName, status: campaign.status,
      accountId: campaign.accountId, accountName: input.accountName, isDeleted: campaign.isDeleted
    },
    totals: sumEffectivenessCounts(byAction.values()),
    message: messageFunnel(sumEffectivenessActions(byAction, MESSAGE_ENGAGEMENT_ACTIONS)),
    friend: friendFunnel(byAction.get(FRIEND_ENGAGEMENT_ACTION) || emptyEffectivenessCounts()),
    daily: effectivenessDailySeries(input.query, input.summary.rows),
    actions
  }
}

/** Golden hours and customer activity from the V462 hours mode. */
export function buildHoursReport(query: EffectivenessQuery, result: EffectivenessHoursResult, now: Date): EffectivenessHours {
  return {
    query, cells: result.cells, activity: result.activity,
    medianResponseMinutes: result.medianResponseMinutes === null ? null : Number(result.medianResponseMinutes),
    medianSeenMinutes: result.medianSeenMinutes === null ? null : Number(result.medianSeenMinutes),
    messageGolden: goldenHourSlots(result.cells, 'message', 'seen'),
    friendGolden: goldenHourSlots(result.cells, 'friend', 'friended'),
    generatedAt: now.toISOString()
  }
}

/** Customer rows with account names and the single final stage. */
export function buildCustomerRows(rows: readonly EffectivenessListRow[], accountNames: ReadonlyMap<number, string>): EffectivenessCustomerRow[] {
  return rows.map(row => ({
    ...row, accountName: accountNames.get(row.accountId) || '',
    stage: finalEngagementStage({ actionCode: row.actionCode, reportGroup: 'success', engagement: {
      seen_at: row.seenAt, responded_at: row.respondedAt, reacted_at: row.reactedAt, friended_at: row.friendedAt
    } })
  })) as EffectivenessCustomerRow[]
}

/** Final-stage split per account x action for message/friend actions. */
export function buildAccountStages(query: EffectivenessQuery, summary: EffectivenessSummaryResult, codes: readonly string[], now: Date): EffectivenessAccountStages {
  const byKey = new Map<string, { accountId: number; actionCode: string; counts: EffectivenessCounts }>()
  for (const row of summary.rows) {
    if (row.group !== 'success' || !codes.includes(row.actionCode)) continue
    const key = `${row.accountId}:${row.actionCode}`
    const item = byKey.get(key) || { accountId: row.accountId, actionCode: row.actionCode, counts: emptyEffectivenessCounts() }
    addEffectivenessCounts(item.counts, effectivenessCountsFromRow(row))
    byKey.set(key, item)
  }
  return {
    query, generatedAt: now.toISOString(),
    rows: Array.from(byKey.values()).map(item => ({ accountId: item.accountId, actionCode: item.actionCode, stages: engagementStagesFor(item.actionCode, item.counts) }))
  }
}

// ---------------------------------------------------------------------------
// AI summary input (aggregate numbers only)
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Readonly<Record<string, string>> = { facebook: 'Facebook', zalo: 'Zalo', email: 'Email', sms: 'SMS' }
const aiDayLabel = (dateKey: string) => `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}/${dateKey.slice(0, 4)}`
const aiPct = (rate: number | null) => (rate === null ? null : Math.round(rate * 100))
const aiGoldenLabel = (slot: GoldenHourSlot) => ({ window: slot.label, ratePct: aiPct(slot.rate), sample: slot.sample })

/**
 * Builds the model input from aggregate numbers only: counts, rates, golden hours, the campaign names the staff
 * gave their own campaigns and the positive suggestions. It never contains customers, phones, UIDs, failure
 * counts or status codes, so the model has nothing negative or personal to repeat.
 */
export function buildEffectivenessAiContext(input: {
  overview: EffectivenessOverview
  hours: EffectivenessHours | null
  campaigns: CampaignEffectivenessList | null
}): Record<string, unknown> {
  const { overview, hours, campaigns } = input
  const unique = overview.unique
  const reached = unique?.reached ?? overview.reached
  const growth = overview.previousReached && overview.previousReached >= 30 && overview.reached > overview.previousReached
    ? Math.round(((overview.reached - overview.previousReached) / overview.previousReached) * 100) : null
  const from = vietnamDateKey(overview.query.startIso)
  const to = vietnamDateKey(Date.parse(overview.query.endIso) - 1)
  const platform = overview.query.flatformType ? PLATFORM_LABELS[overview.query.flatformType] || overview.query.flatformType : 'Tất cả kênh đang dùng'
  const community = Object.fromEntries(Object.entries(communityActivity(Object.fromEntries(
    overview.actions.map(action => [action.code, action.counts.success])))).filter(([, value]) => value > 0))
  return {
    period: { from: aiDayLabel(from), to: aiDayLabel(to) },
    platform,
    achievements: {
      customersReached: reached,
      successfulSends: overview.reached,
      customersSeen: unique?.seen ?? overview.message.seen,
      customersInteracted: unique?.interacted ?? overview.message.interacted,
      replies: overview.message.responded,
      reactions: overview.message.reacted,
      newFriends: unique?.friended ?? overview.friend.friended,
      friendRequestsSent: overview.friend.requested,
      seenRatePct: aiPct(effectivenessRate(overview.message.seen, overview.message.tracked)),
      timeSaved: describeTimeSaved(overview.timeSavedSeconds).label,
      waitingToSend: overview.totals.pending
    },
    ...(Object.keys(community).length ? { communityActivity: community } : {}),
    ...(growth && growth >= 1 ? { reachGrowthPctVsPreviousPeriod: growth } : {}),
    goldenHours: {
      seenMessages: (hours?.messageGolden ?? []).slice(0, 2).map(aiGoldenLabel),
      acceptedFriendRequests: (hours?.friendGolden ?? []).slice(0, 2).map(aiGoldenLabel)
    },
    topCampaigns: (campaigns?.rows ?? []).filter(row => row.reached > 0).slice(0, 3).map(row => ({
      name: row.name.slice(0, 120), customersReached: row.reached, customersInteracted: row.interacted, newFriends: row.friended
    })),
    nextOpportunities: { readyToCareCustomers: overview.opportunities.engagedCustomers, newFriendsToGreet: overview.opportunities.newFriends },
    appSuggestions: overview.suggestions.map(item => ({ title: item.title, target: item.target }))
  }
}
