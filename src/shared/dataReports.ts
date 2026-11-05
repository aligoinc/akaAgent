// Báo cáo dữ liệu: hợp đồng dùng chung. Chép nguyên văn từ akaAgentWebApp packages/control-api/src/dataReports.ts
// (Desktop không import được package WebApp); chỉ khác đường import không có đuôi .js. Sửa ở WebApp trước rồi chép lại.
/**
 * Báo cáo dữ liệu (data reports): shared contract for the WebApp API, Web, iOS and the akaAgent Desktop.
 * Desktop copies this file verbatim to src/shared/dataReports.ts: change it here first, then copy it.
 *
 * The database builds one snapshot per staff every night (akaAgent V469). Clients read that snapshot once
 * and build every view from it, so switching the period never reads the database again.
 *
 * Positive-only rule (business requirement): the report never shows a number that reads as a loss.
 *  - no failure, skip, block or decline counts (the snapshot does not even contain them);
 *  - a value of 0 is hidden instead of printed; growth is shown only when it is above 0;
 *  - no conversion rates that can read low: the only shares are the parts of the customer store;
 *  - rankings list the best items only; milestones list reached ones and the next target;
 *  - "how long the store lasts" is shown only when it is comfortably long.
 */
import { describeTimeSaved, estimateTimeSavedSeconds, formatEffectivenessNumber } from './campaignEffectiveness'

export const DATA_REPORT_ENDPOINTS = {
  snapshot: '/reports/data',
  journey: '/reports/data/journey'
} as const

export type DataReportPeriod = '7' | '30' | '90'
export const DATA_REPORT_PERIODS: ReadonlyArray<{ value: DataReportPeriod; label: string; days: number }> = [
  { value: '7', label: '7 ngày', days: 7 },
  { value: '30', label: '30 ngày', days: 30 },
  { value: '90', label: '90 ngày', days: 90 }
]
export const DEFAULT_DATA_REPORT_PERIOD: DataReportPeriod = '30'
export const isDataReportPeriod = (value: unknown): value is DataReportPeriod =>
  DATA_REPORT_PERIODS.some(item => item.value === value)

/** The API keeps a snapshot for this long; it only changes once a night. */
export const DATA_REPORT_CACHE_MS = 10 * 60_000

/** Runway is printed only when the store comfortably lasts this many days at the current pace. */
export const DATA_REPORT_MIN_RUNWAY_DAYS = 14

export const DATA_REPORT_MILESTONES: readonly number[] = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]

// ---------------------------------------------------------------------------
// Snapshot as stored by V469 (payload version 1)
// ---------------------------------------------------------------------------

export type DataReportSource = 'member' | 'phone' | 'friend'
export const DATA_REPORT_SOURCES: readonly DataReportSource[] = ['member', 'phone', 'friend']
export const DATA_REPORT_SOURCE_LABELS: Readonly<Record<DataReportSource, string>> = {
  member: 'Thành viên nhóm và người Zalo',
  phone: 'Số điện thoại',
  friend: 'Bạn bè Zalo'
}
export const DATA_REPORT_SOURCE_SHORT_LABELS: Readonly<Record<DataReportSource, string>> = {
  member: 'Người Zalo',
  phone: 'Số điện thoại',
  friend: 'Bạn bè'
}

export type DataReportSourceCounts = Record<DataReportSource, number>
export type DataReportPeriodValues = Record<DataReportPeriod, number>

export interface DataReportPeriodCounts {
  storeGrowth: number
  verifiedGrowth: number
  cared: number
  firstCared: number
  /** Customers cared for in the period by their total care touches: 1, 2, 3-5, 6+. */
  careHistogram: [number, number, number, number]
  medianGapDays: number | null
  seen: number
  interacted: number
  friended: number
  caredBySource: DataReportSourceCounts
  interactedBySource: DataReportSourceCounts
}

export interface DataReportActivity {
  careActions: number
  messages: number
  invites: number
  lookups: number
  groupMessages: number
  seen: number
  interacted: number
  friended: number
}

export interface DataReportAllTimeActivity {
  careActions: number
  messages: number
  invites: number
  sms: number
  calls: number
  lookups: number
  groupMessages: number
  firstDay: string | null
}

export interface DataReportAccountRaw {
  accountId: number
  name: string
  kind: 'server' | 'web' | 'app'
  friends: { total: number; growth: DataReportPeriodValues; weekly: number[] }
  groupsJoined: { total: number; growth: DataReportPeriodValues }
  activity: Partial<Record<DataReportPeriod, { careActions: number; lookups: number; interacted: number }>>
}

export interface DataReportListRaw {
  id: number
  name: string
  size: number
  zalo: number
  caredEver: number
  cared: DataReportPeriodValues
  interacted: DataReportPeriodValues
}

export interface DataReportPayload {
  version: 1
  reportDate: string
  store: {
    store: number
    bySource: DataReportSourceCounts
    zaloPeople: number
    phoneOnly: number
    verified: number
    caredEver: number
    seenEver: number
    interactedEver: number
    friendedEver: number
    firstSeenOn: string | null
    firstCaredOn: string | null
  }
  periods: Record<DataReportPeriod, DataReportPeriodCounts>
  weekly: Array<{ week: string } & DataReportSourceCounts>
  milestones: Array<{ value: number; reachedOn: string | null }>
  activity: { allTime: DataReportAllTimeActivity } & Record<DataReportPeriod, DataReportActivity>
  accounts: DataReportAccountRaw[]
  dataGroups: { count: number; members: number; growth: DataReportPeriodValues; firstCreatedAt: string | null; top: DataReportListRaw[] }
  scans: DataReportListRaw[]
  uploads: DataReportListRaw[]
  groupMessages: Record<DataReportPeriod, { groups: number; messages: number }> & { top30: Array<{ name: string; messages: number }> }
  cooldownAvoided: number
  firstCampaignAt: string | null
}

export interface DataReportSnapshot {
  /** "preparing" until the first nightly snapshot of this staff exists. */
  status: 'ready' | 'preparing'
  reportDate: string | null
  builtAt: string | null
  payload: DataReportPayload | null
}

export interface DataReportJourneyEvent {
  id: number
  actionCode: string
  at: string
  accountId: number | null
  accountName: string | null
  campaignId: number | null
  campaignName: string | null
  seenAt: string | null
  respondedAt: string | null
  reactedAt: string | null
  friendedAt: string | null
}

export interface DataReportJourney {
  found: boolean
  phone: string | null
  name: string | null
  customer: {
    firstSeenOn: string | null
    firstCaredOn: string | null
    lastCaredOn: string | null
    careCount: number
    verifiedOn: string | null
    seenOn: string | null
    interactedOn: string | null
    friendedOn: string | null
  } | null
  events: DataReportJourneyEvent[]
  dataGroups: Array<{ id: number; name: string }>
}

// ---------------------------------------------------------------------------
// Parsing (the payload comes from the database; never trust its shape)
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const dateText = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
const record = (value: unknown): Raw => (isRecord(value) ? value : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const periodValues = (value: unknown): DataReportPeriodValues => {
  const source = record(value)
  return { '7': count(source['7']), '30': count(source['30']), '90': count(source['90']) }
}
const sourceCounts = (value: unknown): DataReportSourceCounts => {
  const source = record(value)
  return { member: count(source.member), phone: count(source.phone), friend: count(source.friend) }
}

function parsePeriod(value: unknown): DataReportPeriodCounts {
  const source = record(value)
  const histogram = list(source.careHistogram)
  const gap = Number(source.medianGapDays)
  return {
    storeGrowth: count(source.storeGrowth),
    verifiedGrowth: count(source.verifiedGrowth),
    cared: count(source.cared),
    firstCared: count(source.firstCared),
    careHistogram: [count(histogram[0]), count(histogram[1]), count(histogram[2]), count(histogram[3])],
    medianGapDays: source.medianGapDays === null || source.medianGapDays === undefined || !Number.isFinite(gap) || gap <= 0 ? null : gap,
    seen: count(source.seen),
    interacted: count(source.interacted),
    friended: count(source.friended),
    caredBySource: sourceCounts(source.caredBySource),
    interactedBySource: sourceCounts(source.interactedBySource)
  }
}

function parseActivity(value: unknown): DataReportActivity {
  const source = record(value)
  return {
    careActions: count(source.careActions), messages: count(source.messages), invites: count(source.invites),
    lookups: count(source.lookups), groupMessages: count(source.groupMessages), seen: count(source.seen),
    interacted: count(source.interacted), friended: count(source.friended)
  }
}

function parseList(value: unknown): DataReportListRaw[] {
  return list(value).filter(isRecord).map(item => ({
    id: count(item.id),
    name: text(item.name).trim(),
    size: count(item.size),
    zalo: count(item.zalo),
    caredEver: count(item.caredEver),
    cared: periodValues(item.cared),
    interacted: periodValues(item.interacted)
  }))
}

export function parseDataReportPayload(value: unknown): DataReportPayload | null {
  if (!isRecord(value) || Number(value.version) !== 1) return null
  const store = record(value.store)
  const periods = record(value.periods)
  const activity = record(value.activity)
  const allTime = record(activity.allTime)
  const dataGroups = record(value.dataGroups)
  const groupMessages = record(value.groupMessages)
  return {
    version: 1,
    reportDate: text(value.reportDate),
    store: {
      store: count(store.store),
      bySource: sourceCounts(store.bySource),
      zaloPeople: count(store.zaloPeople),
      phoneOnly: count(store.phoneOnly),
      verified: count(store.verified),
      caredEver: count(store.caredEver),
      seenEver: count(store.seenEver),
      interactedEver: count(store.interactedEver),
      friendedEver: count(store.friendedEver),
      firstSeenOn: dateText(store.firstSeenOn),
      firstCaredOn: dateText(store.firstCaredOn)
    },
    periods: { '7': parsePeriod(periods['7']), '30': parsePeriod(periods['30']), '90': parsePeriod(periods['90']) },
    weekly: list(value.weekly).filter(isRecord).map(week => ({ week: text(week.week), ...sourceCounts(week) })),
    milestones: list(value.milestones).filter(isRecord).map(item => ({ value: count(item.value), reachedOn: dateText(item.reachedOn) })),
    activity: {
      allTime: {
        careActions: count(allTime.careActions), messages: count(allTime.messages), invites: count(allTime.invites),
        sms: count(allTime.sms), calls: count(allTime.calls), lookups: count(allTime.lookups),
        groupMessages: count(allTime.groupMessages), firstDay: dateText(allTime.firstDay)
      },
      '7': parseActivity(activity['7']), '30': parseActivity(activity['30']), '90': parseActivity(activity['90'])
    },
    accounts: list(value.accounts).filter(isRecord).map(account => {
      const friends = record(account.friends)
      const groups = record(account.groupsJoined)
      const accountActivity = record(account.activity)
      const kind = account.kind === 'server' || account.kind === 'web' ? account.kind : 'app'
      const periodActivity = (key: DataReportPeriod) => {
        const item = record(accountActivity[key])
        return { careActions: count(item.careActions), lookups: count(item.lookups), interacted: count(item.interacted) }
      }
      return {
        accountId: count(account.accountId),
        name: text(account.name).trim(),
        kind,
        friends: { total: count(friends.total), growth: periodValues(friends.growth), weekly: list(friends.weekly).map(count) },
        groupsJoined: { total: count(groups.total), growth: periodValues(groups.growth) },
        activity: { '7': periodActivity('7'), '30': periodActivity('30'), '90': periodActivity('90') }
      }
    }),
    dataGroups: {
      count: count(dataGroups.count),
      members: count(dataGroups.members),
      growth: periodValues(dataGroups.growth),
      firstCreatedAt: dateText(dataGroups.firstCreatedAt),
      top: parseList(dataGroups.top)
    },
    scans: parseList(value.scans),
    uploads: parseList(value.uploads),
    groupMessages: {
      '7': { groups: count(record(groupMessages['7']).groups), messages: count(record(groupMessages['7']).messages) },
      '30': { groups: count(record(groupMessages['30']).groups), messages: count(record(groupMessages['30']).messages) },
      '90': { groups: count(record(groupMessages['90']).groups), messages: count(record(groupMessages['90']).messages) },
      top30: list(groupMessages.top30).filter(isRecord).map(item => ({ name: text(item.name).trim(), messages: count(item.messages) }))
    },
    cooldownAvoided: count(value.cooldownAvoided),
    firstCampaignAt: dateText(value.firstCampaignAt)
  }
}

/** Reader answer (V469 snapshot mode) → snapshot. A missing payload means the first night has not run yet. */
export function parseDataReportSnapshot(value: unknown): DataReportSnapshot {
  const source = record(value)
  const payload = parseDataReportPayload(source.payload)
  return {
    status: payload ? 'ready' : 'preparing',
    reportDate: payload ? dateText(source.reportDate) ?? payload.reportDate : null,
    builtAt: payload ? dateText(source.builtAt) : null,
    payload
  }
}

export function parseDataReportJourney(value: unknown): DataReportJourney {
  const source = record(value)
  const customer = isRecord(source.customer) ? source.customer : null
  return {
    found: source.found === true,
    phone: dateText(source.phone),
    name: dateText(source.name),
    customer: customer ? {
      firstSeenOn: dateText(customer.firstSeenOn),
      firstCaredOn: dateText(customer.firstCaredOn),
      lastCaredOn: dateText(customer.lastCaredOn),
      careCount: count(customer.careCount),
      verifiedOn: dateText(customer.verifiedOn),
      seenOn: dateText(customer.seenOn),
      interactedOn: dateText(customer.interactedOn),
      friendedOn: dateText(customer.friendedOn)
    } : null,
    events: list(source.events).filter(isRecord).map(event => ({
      id: count(event.id),
      actionCode: text(event.actionCode),
      at: text(event.at),
      accountId: count(event.accountId) || null,
      accountName: dateText(event.accountName),
      campaignId: count(event.campaignId) || null,
      campaignName: dateText(event.campaignName),
      seenAt: dateText(event.seenAt),
      respondedAt: dateText(event.respondedAt),
      reactedAt: dateText(event.reactedAt),
      friendedAt: dateText(event.friendedAt)
    })).filter(event => event.id > 0 && event.at),
    dataGroups: list(source.dataGroups).filter(isRecord).map(group => ({ id: count(group.id), name: text(group.name).trim() }))
      .filter(group => group.id > 0)
  }
}

// ---------------------------------------------------------------------------
// View (what Web, iOS and Desktop render)
// ---------------------------------------------------------------------------

export const formatDataReportNumber = formatEffectivenessNumber

/** "dd/mm/yyyy" for a "yyyy-mm-dd" (or ISO) date; empty when unknown. */
export function formatDataReportDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

const plus = (value: number): string | null => (value > 0 ? `+${formatEffectivenessNumber(value)}` : null)

export interface DataReportTile {
  key: 'friends' | 'groupsJoined' | 'zaloPeople' | 'verified' | 'dataGroups'
  label: string
  value: number
  note: string | null
  /** Growth in the period ("+412"), only when above 0. */
  delta: string | null
}

export interface DataReportStep {
  key: 'store' | 'cared' | 'seen' | 'interacted' | 'friended'
  label: string
  value: number
  note: string
  /** Counted only on accounts with engagement tracking (footnote *). */
  tracked: boolean
}

export interface DataReportRankRow {
  id: string
  name: string
  size: number
  cared: number
  zalo: number
  interacted: number
}

export type DataReportSourceTab = 'groups' | 'scans' | 'uploads' | 'types'
export const DATA_REPORT_SOURCE_TABS: ReadonlyArray<{ value: DataReportSourceTab; label: string }> = [
  { value: 'groups', label: 'Nhóm data' },
  { value: 'scans', label: 'Bộ quét nhóm Zalo' },
  { value: 'uploads', label: 'Danh sách tải lên' },
  { value: 'types', label: 'Loại dữ liệu' }
]

export interface DataReportAccountRow {
  accountId: number
  name: string
  kindLabel: string
  friends: number
  friendsWeekly: number[]
  newFriends: number | null
  groupsJoined: number
  careActions: number | null
  interacted: number | null
}

export interface DataReportView {
  reportDate: string
  period: DataReportPeriod
  periodLabel: string
  /** No Zalo/phone customer yet: show the getting-started state instead of numbers. */
  empty: boolean
  store: {
    total: number
    growth: string | null
    composition: Array<{ key: DataReportSource; label: string; shortLabel: string; value: number; share: number }>
    weekly: Array<{ week: string; total: number } & DataReportSourceCounts>
  }
  tiles: DataReportTile[]
  steps: DataReportStep[]
  opportunity: { ready: number; runwayDays: number | null; perDay: number | null } | null
  rhythm: {
    histogram: Array<{ label: string; value: number }>
    caredInPeriod: number
    medianGapDays: number | null
    cooldownAvoided: number | null
    groupMessages: { groups: number; messages: number; perGroupPerWeek: number | null; top: Array<{ name: string; messages: number }> } | null
  } | null
  sources: Record<DataReportSourceTab, { rows: DataReportRankRow[]; metric: 'interacted' | 'cared' }>
  coverage: Array<{ id: string; name: string; size: number; caredEver: number; ready: number }>
  accounts: DataReportAccountRow[]
  assets: {
    since: string | null
    months: number | null
    items: Array<{ key: string; value: string; label: string; tracked: boolean }>
    milestones: { reached: Array<{ value: number; reachedOn: string }>; next: { value: number; remaining: number; progress: number } | null }
  }
  /** At least one engagement number is shown, so the "*" footnote is needed. */
  engagementShown: boolean
}

const ACCOUNT_KIND_LABELS: Readonly<Record<DataReportAccountRaw['kind'], string>> = {
  server: 'Zalo Server',
  web: 'Zalo Web',
  app: 'Zalo'
}

function monthsBetween(from: string | null, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(from || '')
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(to)
  if (!a || !b) return null
  const months = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2])) - (Number(b[3]) < Number(a[3]) ? 1 : 0)
  return months >= 1 ? months : null
}

function rankRows(items: DataReportListRaw[], period: DataReportPeriod, idPrefix: string): DataReportRankRow[] {
  return items.map(item => ({
    id: `${idPrefix}${item.id}`, name: item.name || 'Không tên', size: item.size, cared: item.cared[period], zalo: item.zalo,
    interacted: item.interacted[period]
  }))
}

/** Best items first, positive metric only; never lists the weakest ones. */
function topRows(rows: DataReportRankRow[], limit = 5): { rows: DataReportRankRow[]; metric: 'interacted' | 'cared' } {
  const metric: 'interacted' | 'cared' = rows.some(row => row.interacted > 0) ? 'interacted' : 'cared'
  const ranked = rows
    .filter(row => row[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || b.cared - a.cared || b.size - a.size || a.name.localeCompare(b.name, 'vi'))
    .slice(0, limit)
  return { rows: ranked, metric }
}

export function buildDataReportView(payload: DataReportPayload, period: DataReportPeriod = DEFAULT_DATA_REPORT_PERIOD): DataReportView {
  const periodLabel = DATA_REPORT_PERIODS.find(item => item.value === period)?.label || ''
  const days = DATA_REPORT_PERIODS.find(item => item.value === period)?.days || 30
  const counts = payload.periods[period]
  const activity = payload.activity[period]
  const store = payload.store
  const total = store.store

  const composition = DATA_REPORT_SOURCES
    .map(key => ({ key, label: DATA_REPORT_SOURCE_LABELS[key], shortLabel: DATA_REPORT_SOURCE_SHORT_LABELS[key], value: store.bySource[key], share: 0 }))
    .filter(item => item.value > 0)
  const compositionTotal = composition.reduce((sum, item) => sum + item.value, 0)
  for (const item of composition) item.share = compositionTotal ? item.value / compositionTotal : 0

  const friendsTotal = payload.accounts.reduce((sum, account) => sum + account.friends.total, 0)
  const friendsGrowth = payload.accounts.reduce((sum, account) => sum + account.friends.growth[period], 0)
  const groupsTotal = payload.accounts.reduce((sum, account) => sum + account.groupsJoined.total, 0)
  const groupsGrowth = payload.accounts.reduce((sum, account) => sum + account.groupsJoined.growth[period], 0)
  const tiles: DataReportTile[] = [
    { key: 'friends' as const, label: 'Bạn bè Zalo', value: friendsTotal, note: payload.accounts.length > 1 ? `trên ${formatEffectivenessNumber(payload.accounts.length)} tài khoản` : null, delta: plus(friendsGrowth) ? `${plus(friendsGrowth)} bạn mới` : null },
    { key: 'groupsJoined' as const, label: 'Nhóm Zalo đã tham gia', value: groupsTotal, note: null, delta: plus(groupsGrowth) ? `${plus(groupsGrowth)} nhóm` : null },
    { key: 'zaloPeople' as const, label: 'Người Zalo đã thu thập', value: store.zaloPeople, note: 'không trùng giữa các tài khoản', delta: null },
    { key: 'verified' as const, label: 'SĐT đã xác minh có Zalo', value: store.verified, note: null, delta: plus(counts.verifiedGrowth) },
    { key: 'dataGroups' as const, label: 'Nhóm data', value: payload.dataGroups.count,
      note: payload.dataGroups.members > 0 ? `${formatEffectivenessNumber(payload.dataGroups.members)} thành viên đã phân loại` : null,
      delta: plus(payload.dataGroups.growth[period]) ? `${plus(payload.dataGroups.growth[period])} nhóm` : null }
  ].filter(tile => tile.value > 0)

  const steps: DataReportStep[] = ([
    { key: 'store', label: 'Khách trong kho', value: total, note: 'toàn bộ tới hôm qua', tracked: false },
    { key: 'cared', label: 'Đã được chăm sóc', value: counts.cared, note: `trong ${periodLabel} qua`, tracked: false },
    { key: 'seen', label: 'Đã xem tin', value: counts.seen, note: `trong ${periodLabel} qua`, tracked: true },
    { key: 'interacted', label: 'Đã tương tác', value: counts.interacted, note: 'phản hồi hoặc thả cảm xúc', tracked: true },
    { key: 'friended', label: 'Đồng ý kết bạn', value: counts.friended, note: 'từ lời mời của chiến dịch', tracked: true }
  ] as DataReportStep[]).filter(step => step.value > 0)

  const ready = Math.max(0, total - store.caredEver)
  const perDay = counts.firstCared > 0 ? counts.firstCared / days : null
  const runway = perDay ? Math.floor(ready / perDay) : null
  const opportunity = ready > 0 ? {
    ready,
    perDay: perDay !== null && perDay >= 1 ? Math.round(perDay) : null,
    runwayDays: runway !== null && runway >= DATA_REPORT_MIN_RUNWAY_DAYS ? runway : null
  } : null

  const histogramLabels = ['1 lần', '2 lần', '3–5 lần', '6+ lần']
  const groupPeriod = payload.groupMessages[period]
  const perGroupPerWeek = groupPeriod.groups > 0 ? Math.round((groupPeriod.messages / groupPeriod.groups / (days / 7)) * 10) / 10 : null
  const rhythm = counts.cared > 0 || groupPeriod.messages > 0 || payload.cooldownAvoided > 0 ? {
    histogram: counts.careHistogram.map((value, index) => ({ label: histogramLabels[index], value })).filter(item => item.value > 0),
    caredInPeriod: counts.cared,
    // Under a day would read as "too often": the typical gap is printed from one day on.
    medianGapDays: counts.medianGapDays !== null && counts.medianGapDays >= 1 ? counts.medianGapDays : null,
    cooldownAvoided: payload.cooldownAvoided > 0 ? payload.cooldownAvoided : null,
    groupMessages: groupPeriod.messages > 0 ? {
      groups: groupPeriod.groups,
      messages: groupPeriod.messages,
      // A low weekly average reads as "little happens": printed from one message per group per week on.
      perGroupPerWeek: perGroupPerWeek !== null && perGroupPerWeek >= 1 ? perGroupPerWeek : null,
      top: period === '30' || period === '90' ? payload.groupMessages.top30.filter(item => item.messages > 0 && item.name) : []
    } : null
  } : null

  const types: DataReportRankRow[] = DATA_REPORT_SOURCES.map(key => ({
    id: `type:${key}`, name: DATA_REPORT_SOURCE_LABELS[key], size: store.bySource[key], cared: counts.caredBySource[key],
    zalo: key === 'phone' ? 0 : store.bySource[key], interacted: counts.interactedBySource[key]
  }))
  const sources: DataReportView['sources'] = {
    groups: topRows(rankRows(payload.dataGroups.top, period, 'group:')),
    scans: topRows(rankRows(payload.scans, period, 'scan:')),
    uploads: topRows(rankRows(payload.uploads, period, 'upload:')),
    types: topRows(types)
  }

  const coverage = payload.dataGroups.top
    .filter(group => group.size > 0 && group.caredEver > 0)
    .slice(0, 5)
    .map(group => ({ id: `group:${group.id}`, name: group.name || 'Không tên', size: group.size, caredEver: group.caredEver,
      ready: Math.max(0, group.size - group.caredEver) }))

  const accounts: DataReportAccountRow[] = payload.accounts.map(account => {
    const accountActivity = account.activity[period]
    return {
      accountId: account.accountId,
      name: account.name || 'Tài khoản Zalo',
      kindLabel: ACCOUNT_KIND_LABELS[account.kind],
      friends: account.friends.total,
      friendsWeekly: account.friends.weekly,
      newFriends: account.friends.growth[period] > 0 ? account.friends.growth[period] : null,
      groupsJoined: account.groupsJoined.total,
      careActions: accountActivity && accountActivity.careActions > 0 ? accountActivity.careActions : null,
      interacted: accountActivity && accountActivity.interacted > 0 ? accountActivity.interacted : null
    }
  }).sort((a, b) => (b.careActions || 0) - (a.careActions || 0) || b.friends - a.friends || a.name.localeCompare(b.name, 'vi'))

  const allTime = payload.activity.allTime
  const savedSeconds = estimateTimeSavedSeconds({
    zalo_message_stranger: allTime.messages, zalo_add_friend: allTime.invites, zalo_find_phone_user: allTime.lookups,
    sms_send: allTime.sms, voice_call: allTime.calls, zalo_message_group: allTime.groupMessages
  })
  const since = [store.firstCaredOn, allTime.firstDay, payload.firstCampaignAt?.slice(0, 10) || null]
    .filter((value): value is string => !!value).sort()[0] || null
  const assetItems = [
    { key: 'caredEver', count: store.caredEver, label: 'khách đã được chăm sóc', tracked: false },
    { key: 'interactedEver', count: store.interactedEver, label: 'khách đã tương tác (khách nóng)', tracked: true },
    { key: 'friendedEver', count: store.friendedEver, label: 'bạn bè có được nhờ chiến dịch', tracked: true },
    { key: 'verified', count: store.verified, label: 'số điện thoại đã xác minh có Zalo', tracked: false },
    { key: 'dataGroups', count: payload.dataGroups.count, label: payload.dataGroups.members > 0
      ? `nhóm data, ${formatEffectivenessNumber(payload.dataGroups.members)} thành viên đã phân loại` : 'nhóm data đã phân loại', tracked: false },
    { key: 'cooldownAvoided', count: payload.cooldownAvoided, label: 'lần nhắn trùng akaBiz đã tự tránh', tracked: false }
  ].filter(item => item.count > 0).map(item => ({ key: item.key, value: formatEffectivenessNumber(item.count), label: item.label, tracked: item.tracked }))
  if (savedSeconds >= 3600) assetItems.push({ key: 'timeSaved', value: describeTimeSaved(savedSeconds).label, label: 'làm tay đã tiết kiệm (ước tính)', tracked: false })

  const reached = payload.milestones
    .filter((item): item is { value: number; reachedOn: string } => !!item.reachedOn && total >= item.value)
    .map(item => ({ value: item.value, reachedOn: item.reachedOn }))
  const nextValue = DATA_REPORT_MILESTONES.find(value => total < value) ?? null
  const previousValue = [...DATA_REPORT_MILESTONES].reverse().find(value => total >= value) ?? 0
  const next = nextValue === null || total <= 0 ? null : {
    value: nextValue,
    remaining: nextValue - total,
    progress: Math.max(0, Math.min(1, (total - previousValue) / (nextValue - previousValue)))
  }

  const engagementShown = steps.some(step => step.tracked) || assetItems.some(item => item.tracked)
    || Object.values(sources).some(source => source.metric === 'interacted' && source.rows.length > 0)
    || accounts.some(account => account.interacted !== null)

  return {
    reportDate: payload.reportDate,
    period,
    periodLabel,
    empty: total <= 0,
    store: {
      total,
      growth: plus(counts.storeGrowth),
      composition,
      weekly: payload.weekly.map(week => ({ ...week, total: week.member + week.phone + week.friend }))
    },
    tiles,
    steps,
    opportunity,
    rhythm,
    sources,
    coverage,
    accounts,
    assets: { since, months: since ? monthsBetween(since, payload.reportDate) : null, items: assetItems, milestones: { reached, next } },
    engagementShown
  }
}

// ---------------------------------------------------------------------------
// Journey of one customer
// ---------------------------------------------------------------------------

const JOURNEY_ACTION_LABELS: Readonly<Record<string, string>> = {
  zalo_message_stranger: 'Nhận tin nhắn',
  zalo_message_friend: 'Nhận tin nhắn',
  zalo_add_friend: 'Nhận lời mời kết bạn',
  zalo_find_phone_user: 'Xác minh có Zalo',
  sms_send: 'Nhận SMS',
  voice_call: 'Nhận cuộc gọi'
}

export interface DataReportJourneyStep {
  id: string
  at: string
  title: string
  detail: string
  /** Positive outcome only (seen, replied, reacted, accepted); never a failure. */
  outcome: string | null
  tracked: boolean
}

export interface DataReportJourneyView {
  found: boolean
  phone: string | null
  name: string | null
  summary: Array<{ key: string; value: string; label: string }>
  steps: DataReportJourneyStep[]
  dataGroups: Array<{ id: number; name: string }>
}

const elapsedLabel = (from: string, to: string | null): string | null => {
  if (!to) return null
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60000)
  if (!Number.isFinite(minutes) || minutes < 0) return null
  if (minutes < 60) return `${Math.max(1, minutes)} phút`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} giờ`
  return `${Math.round(minutes / 1440)} ngày`
}

export function buildDataReportJourneyView(journey: DataReportJourney): DataReportJourneyView {
  const steps: DataReportJourneyStep[] = journey.events.map(event => {
    const responded = elapsedLabel(event.at, event.respondedAt)
    const accepted = elapsedLabel(event.at, event.friendedAt)
    const outcome = responded ? `Phản hồi sau ${responded}`
      : event.reactedAt ? 'Thả cảm xúc'
        : accepted ? `Đồng ý kết bạn sau ${accepted}`
          : event.seenAt ? 'Đã xem' : null
    return {
      id: `event:${event.id}`,
      at: event.at,
      title: JOURNEY_ACTION_LABELS[event.actionCode] || 'Được chăm sóc',
      detail: [event.campaignName ? `Chiến dịch "${event.campaignName}"` : null, event.accountName].filter(Boolean).join(' · '),
      outcome,
      tracked: outcome !== null
    }
  })
  const customer = journey.customer
  const accounts = new Set(journey.events.map(event => event.accountId).filter(Boolean)).size
  const campaigns = new Set(journey.events.map(event => event.campaignId).filter(Boolean)).size
  const summary = [
    { key: 'care', count: customer?.careCount || 0, label: 'lần chăm sóc' },
    { key: 'campaigns', count: campaigns, label: 'chiến dịch' },
    { key: 'accounts', count: accounts, label: 'tài khoản' },
    { key: 'groups', count: journey.dataGroups.length, label: 'nhóm data' }
  ].filter(item => item.count > 0).map(item => ({ key: item.key, value: formatEffectivenessNumber(item.count), label: item.label }))
  if (customer?.firstSeenOn) summary.push({ key: 'since', value: formatDataReportDate(customer.firstSeenOn), label: 'vào kho dữ liệu' })
  return { found: journey.found, phone: journey.phone, name: journey.name, summary, steps, dataGroups: journey.dataGroups }
}
