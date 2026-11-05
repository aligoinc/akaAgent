// Báo cáo hiệu quả chiến dịch: định nghĩa chỉ số, nhãn và quy tắc trình bày dùng chung.
// Chép nguyên văn từ akaAgentWebApp packages/control-api/src/campaignEffectiveness.ts (Desktop không import được
// package WebApp); chỉ khác loại nền tảng: Desktop có thêm Facebook và Email. Sửa ở WebApp trước rồi chép lại.
export type EffectivenessPlatform = 'facebook' | 'zalo' | 'email' | 'sms'
type ControlPlatform = EffectivenessPlatform

/**
 * Campaign effectiveness reports ("Thành quả", "Theo chiến dịch", "Bí quyết hiệu quả",
 * "Tài sản của bạn"). One definition for Web, iOS, Excel and the API so every surface
 * shows the same numbers. Engagement marks are best effort (see zaloCampaignEngagement.ts)
 * and are only derived at read time: execution status is never rewritten.
 */

export const EFFECTIVENESS_TIME_ZONE = 'Asia/Ho_Chi_Minh'
/** Vietnam has no daylight saving time; a fixed offset is exact. */
export const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Time ranges (always Vietnam calendar days, independent of the browser zone)
// ---------------------------------------------------------------------------

export type ReportRangePreset =
  | 'today' | 'yesterday' | '7_days' | '14_days' | '30_days'
  | 'this_week' | 'last_week' | 'this_month' | 'last_month' | '3_months' | 'custom'

export const REPORT_RANGE_PRESETS: ReadonlyArray<{ value: ReportRangePreset; label: string }> = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'yesterday', label: 'Hôm qua' },
  { value: '7_days', label: '7 ngày qua' },
  { value: '14_days', label: '14 ngày qua' },
  { value: '30_days', label: '30 ngày qua' },
  { value: 'this_week', label: 'Tuần này' },
  { value: 'last_week', label: 'Tuần trước' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: '3_months', label: '3 tháng qua' },
  { value: 'custom', label: 'Tùy chọn' }
]

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** YYYY-MM-DD of an instant in Vietnam. */
export function vietnamDateKey(instant: number | string | Date): string {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === 'number' ? instant : Date.parse(instant)
  return new Date(ms + VIETNAM_UTC_OFFSET_MS).toISOString().slice(0, 10)
}

function dateKeyParts(dateKey: string): [number, number, number] {
  const match = DATE_KEY.exec(dateKey)
  if (!match) throw new Error('Ngày báo cáo không hợp lệ.')
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error('Ngày báo cáo không hợp lệ.')
  }
  return [year, month, day]
}

/** ISO instant of 00:00 on a Vietnam calendar day. */
export function vietnamDayStartIso(dateKey: string): string {
  const [year, month, day] = dateKeyParts(dateKey)
  return new Date(Date.UTC(year, month - 1, day) - VIETNAM_UTC_OFFSET_MS).toISOString()
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKeyParts(dateKey)
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10)
}

function startOfWeekKey(dateKey: string): string {
  const [year, month, day] = dateKeyParts(dateKey)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0 = Sunday
  return shiftDateKey(dateKey, -((weekday + 6) % 7)) // Monday starts the week in Vietnam
}

function monthKey(dateKey: string, offsetMonths = 0): string {
  const [year, month] = dateKeyParts(dateKey)
  return new Date(Date.UTC(year, month - 1 + offsetMonths, 1)).toISOString().slice(0, 10)
}

export interface ReportRange { startIso: string; endIso: string }

/**
 * Inclusive Vietnam calendar ranges; the end is the next day's 00:00 so "today"
 * covers the whole day. Custom ranges take YYYY-MM-DD inputs.
 */
export function buildVietnamReportRange(
  preset: ReportRangePreset, customStartDate?: string, customEndDate?: string, now: Date = new Date()
): ReportRange {
  const today = vietnamDateKey(now)
  const tomorrow = shiftDateKey(today, 1)
  let start = today
  let end = tomorrow
  switch (preset) {
    case 'yesterday': start = shiftDateKey(today, -1); end = today; break
    case '7_days': start = shiftDateKey(today, -6); break
    case '14_days': start = shiftDateKey(today, -13); break
    case '30_days': start = shiftDateKey(today, -29); break
    case '3_months': start = shiftDateKey(today, -89); break
    case 'this_week': start = startOfWeekKey(today); break
    case 'last_week': end = startOfWeekKey(today); start = shiftDateKey(end, -7); break
    case 'this_month': start = monthKey(today); break
    case 'last_month': start = monthKey(today, -1); end = monthKey(today); break
    case 'custom': {
      start = customStartDate || today
      end = shiftDateKey(customEndDate || start, 1)
      if (start >= end) throw new Error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.')
      break
    }
    case 'today':
    default:
      break
  }
  return { startIso: vietnamDayStartIso(start), endIso: vietnamDayStartIso(end) }
}

/** The equally long period just before a range (used for growth badges). */
export function previousReportRange(range: ReportRange): ReportRange {
  const start = Date.parse(range.startIso)
  const end = Date.parse(range.endIso)
  return { startIso: new Date(start - (end - start)).toISOString(), endIso: range.startIso }
}

/** Every Vietnam calendar day touched by [startIso, endIso). */
export function vietnamDateKeysInRange(range: ReportRange): string[] {
  const keys: string[] = []
  const last = vietnamDateKey(Date.parse(range.endIso) - 1)
  for (let key = vietnamDateKey(range.startIso); key <= last; key = shiftDateKey(key, 1)) keys.push(key)
  return keys
}

// ---------------------------------------------------------------------------
// Actions, engagement stages and the single final status
// ---------------------------------------------------------------------------

export const MESSAGE_ENGAGEMENT_ACTIONS = ['zalo_message_friend', 'zalo_message_stranger'] as const
export const FRIEND_ENGAGEMENT_ACTION = 'zalo_add_friend'
export const PHONE_LOOKUP_ACTION = 'zalo_find_phone_user'
/**
 * Results that put a message, call or invitation in front of one customer. Engagement (seen/replied) is tracked
 * only for Zalo; Facebook, email, SMS and calls count as reached on a successful result.
 */
export const REACH_ACTIONS: readonly string[] = [
  ...MESSAGE_ENGAGEMENT_ACTIONS, FRIEND_ENGAGEMENT_ACTION, 'sms_send', 'voice_call', 'email_send',
  'fb_message_friend', 'fb_message_stranger', 'fb_message_page_inbox_customer', 'fb_add_friend'
]

/** Community/content work (Facebook posts, comments, groups...): shown as activity, never as "customers reached". */
export const COMMUNITY_ACTIVITY_GROUPS = {
  posts: ['fb_post_group', 'fb_post_my_profile', 'fb_post_page'],
  comments: ['fb_comment'],
  likes: ['fb_like_post'],
  groupsJoined: ['fb_join_group', 'zalo_join_group', 'zalo_join_group_link'],
  groupInvites: ['fb_group_invite', 'zalo_add_group_member'],
  groupMessages: ['zalo_message_group']
} as const satisfies Record<string, readonly string[]>

export type CommunityActivity = { -readonly [K in keyof typeof COMMUNITY_ACTIVITY_GROUPS]: number }

export const COMMUNITY_ACTIVITY_LABELS: Readonly<Record<keyof CommunityActivity, string>> = {
  posts: 'Bài đã đăng',
  comments: 'Bình luận',
  likes: 'Lượt thích',
  groupsJoined: 'Nhóm đã tham gia',
  groupInvites: 'Lời mời vào nhóm',
  groupMessages: 'Tin gửi vào nhóm'
}

/** Successful community/content results by group (from per-action success counts). */
export function communityActivity(successByAction: Readonly<Record<string, number>>): CommunityActivity {
  const result = {} as CommunityActivity
  for (const [key, codes] of Object.entries(COMMUNITY_ACTIVITY_GROUPS) as Array<[keyof CommunityActivity, readonly string[]]>) {
    result[key] = codes.reduce((sum, code) => sum + (Number(successByAction[code]) || 0), 0)
  }
  return result
}

export const isMessageEngagementAction = (code?: string | null): boolean =>
  (MESSAGE_ENGAGEMENT_ACTIONS as readonly string[]).includes(code || '')

/** Legacy rows (report_group NULL) keep the established success text values. */
export const LEGACY_SUCCESS_DETAIL_STATUSES = ['thành công', 'đã xem', 'đã click', 'đã gửi', 'đã nhận'] as const

export type EngagementStage = 'responded' | 'reacted' | 'seen' | 'received' | 'sent' | 'friended' | 'requested'

/** Highest first. Approved order: a reply outranks a reaction. */
export const MESSAGE_STAGE_ORDER: readonly EngagementStage[] = ['responded', 'reacted', 'seen', 'received', 'sent']
export const FRIEND_STAGE_ORDER: readonly EngagementStage[] = ['friended', 'requested']

export const ENGAGEMENT_STAGE_LABELS: Record<EngagementStage, string> = {
  responded: 'Đã phản hồi',
  reacted: 'Đã thả cảm xúc',
  seen: 'Đã xem',
  received: 'Đã nhận',
  sent: 'Đã gửi',
  friended: 'Đã đồng ý kết bạn',
  requested: 'Đã gửi lời mời'
}

export interface EngagementMarks {
  seen_at?: string | null
  responded_at?: string | null
  reacted_at?: string | null
  friended_at?: string | null
  /** Reserved for delivery receipts; absent until runtimes record them. */
  delivered_at?: string | null
}

export function isSuccessfulResult(reportGroup?: string | null, status?: string | null): boolean {
  if (reportGroup) return reportGroup === 'success'
  return (LEGACY_SUCCESS_DETAIL_STATUSES as readonly string[]).includes((status || '').trim().toLocaleLowerCase('vi-VN'))
}

/**
 * One final status per successful message/friend-request result. Other actions and
 * unsuccessful results keep their stored status (null here).
 */
export function finalEngagementStage(input: {
  actionCode?: string | null
  reportGroup?: string | null
  status?: string | null
  engagement?: EngagementMarks | null
}): EngagementStage | null {
  if (!isSuccessfulResult(input.reportGroup, input.status)) return null
  const marks = input.engagement || {}
  if (isMessageEngagementAction(input.actionCode)) {
    if (marks.responded_at) return 'responded'
    if (marks.reacted_at) return 'reacted'
    if (marks.seen_at) return 'seen'
    if (marks.delivered_at) return 'received'
    return 'sent'
  }
  if (input.actionCode === FRIEND_ENGAGEMENT_ACTION) return marks.friended_at ? 'friended' : 'requested'
  return null
}

// ---------------------------------------------------------------------------
// Aggregated counts and funnels
// ---------------------------------------------------------------------------

/** Stage counts are exclusive (each successful result counted once at its final stage). */
export interface EffectivenessCounts {
  success: number
  failure: number
  skipped: number
  pending: number
  /** Successful results registered for engagement tracking. */
  tracked: number
  responded: number
  reacted: number
  seen: number
  received: number
  friended: number
}

export const emptyEffectivenessCounts = (): EffectivenessCounts => ({
  success: 0, failure: 0, skipped: 0, pending: 0, tracked: 0, responded: 0, reacted: 0, seen: 0, received: 0, friended: 0
})

export function addEffectivenessCounts(target: EffectivenessCounts, source: Partial<EffectivenessCounts>): EffectivenessCounts {
  for (const key of Object.keys(target) as Array<keyof EffectivenessCounts>) target[key] += Number(source[key]) || 0
  return target
}

export interface MessageFunnel {
  /** Successful sends (customers reached by a message). */
  sent: number
  tracked: number
  /** Cumulative: delivered ∨ seen ∨ reacted ∨ responded. */
  received: number
  /** Cumulative: seen ∨ reacted ∨ responded. */
  seen: number
  /** Cumulative: reacted ∨ responded. */
  interacted: number
  responded: number
  reacted: number
  /** True until delivery receipts are recorded: "received" is then a lower bound. */
  receivedIsMinimum: boolean
}

export function messageFunnel(counts: EffectivenessCounts): MessageFunnel {
  const interacted = counts.responded + counts.reacted
  const seen = interacted + counts.seen
  return {
    sent: counts.success,
    tracked: counts.tracked,
    received: seen + counts.received,
    seen,
    interacted,
    responded: counts.responded,
    reacted: counts.reacted,
    receivedIsMinimum: counts.received === 0
  }
}

export interface FriendFunnel { requested: number; tracked: number; friended: number }

export const friendFunnel = (counts: EffectivenessCounts): FriendFunnel =>
  ({ requested: counts.success, tracked: counts.tracked, friended: counts.friended })

/** Share of a value; null below the minimum sample so tiny groups never show misleading rates. */
export function effectivenessRate(value: number, total: number, minSample = MIN_RATE_SAMPLE): number | null {
  if (!Number.isFinite(total) || total < minSample || total <= 0) return null
  return Math.max(0, Math.min(1, value / total))
}

export const MIN_RATE_SAMPLE = 30

export function wilsonInterval(successes: number, total: number, z = 1.96): { low: number; high: number } {
  if (total <= 0) return { low: 0, high: 0 }
  const p = successes / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
  return { low: Math.max(0, (centre - margin) / denominator), high: Math.min(1, (centre + margin) / denominator) }
}

// ---------------------------------------------------------------------------
// Time saved (approved manual seconds per successful action; estimate only)
// ---------------------------------------------------------------------------

/**
 * Estimated manual seconds per successful result. Approved 05/11/2026: 30 s per message, 20 s per friend request,
 * 15 s per phone lookup. Other actions use conservative estimates (to confirm with the business owner).
 */
export const MANUAL_SECONDS_PER_ACTION: Readonly<Record<string, number>> = {
  zalo_message_friend: 30,
  zalo_message_stranger: 30,
  zalo_message_group: 30,
  sms_send: 30,
  fb_message_friend: 30,
  fb_message_stranger: 30,
  fb_message_page_inbox_customer: 30,
  zalo_add_friend: 20,
  fb_add_friend: 20,
  zalo_find_phone_user: 15,
  email_send: 60,
  voice_call: 60,
  fb_post_group: 60,
  fb_post_my_profile: 60,
  fb_post_page: 60,
  fb_comment: 30,
  fb_like_post: 5,
  fb_join_group: 15,
  zalo_join_group: 15,
  zalo_join_group_link: 15,
  fb_group_invite: 10,
  zalo_add_group_member: 15,
  zalo_tag_contact: 10,
  zalo_change_alias: 10,
  zalo_cancel_sent_friend_request: 10
}

export function estimateTimeSavedSeconds(successByAction: Readonly<Record<string, number>>): number {
  let seconds = 0
  for (const [code, count] of Object.entries(successByAction)) seconds += (MANUAL_SECONDS_PER_ACTION[code] || 0) * (Number(count) || 0)
  return seconds
}

const WORK_DAY_HOURS = 8

export function describeTimeSaved(seconds: number): { hours: number; workDays: number; label: string } {
  const hours = seconds / 3600
  const workDays = hours / WORK_DAY_HOURS
  const label = hours < 1
    ? `≈ ${Math.max(0, Math.round(seconds / 60))} phút`
    : workDays >= 2
      ? `≈ ${formatEffectivenessNumber(Math.round(hours))} giờ (${formatEffectivenessNumber(Math.round(workDays))} ngày công)`
      : `≈ ${formatEffectivenessNumber(Math.round(hours))} giờ`
  return { hours, workDays, label }
}

export function formatEffectivenessNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(Number(value) || 0))
}

export function formatEffectivenessRate(rate: number | null, digits = 0): string {
  if (rate === null || !Number.isFinite(rate)) return ''
  return `${(rate * 100).toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`
}

/** Growth badge only when a period grows; a decline renders nothing (numbers stay visible). */
export function growthBadge(current: number, previous: number | null | undefined): string | null {
  if (previous === null || previous === undefined || previous <= 0 || current <= previous) return null
  const pct = Math.round(((current - previous) / previous) * 100)
  return pct >= 1 ? `▲ ${pct}%` : null
}

// ---------------------------------------------------------------------------
// Milestones (lifetime reach)
// ---------------------------------------------------------------------------

export const REACH_MILESTONES = [1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000] as const

export function reachMilestones(total: number): { achieved: number[]; next: number | null; progress: number } {
  const achieved = REACH_MILESTONES.filter(value => total >= value)
  const next = REACH_MILESTONES.find(value => total < value) ?? null
  const previous = achieved.length ? achieved[achieved.length - 1] : 0
  const progress = next === null ? 1 : Math.max(0, Math.min(1, (total - previous) / (next - previous)))
  return { achieved: [...achieved], next, progress }
}

// ---------------------------------------------------------------------------
// Golden hours
// ---------------------------------------------------------------------------

export interface EffectivenessHourCell {
  /** ISO weekday: 1 = Monday … 7 = Sunday (Vietnam time). */
  dow: number
  hour: number
  family: 'message' | 'friend'
  tracked: number
  seen: number
  interacted: number
  friended: number
}

export type GoldenHourMetric = 'seen' | 'interacted' | 'friended'

export interface GoldenHourSlot { startHour: number; endHour: number; label: string; rate: number; sample: number }

const hourLabel = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`

/**
 * Best two-hour windows of the day (all weekdays together), only from windows with enough
 * tracked sends. Returned best first; windows never overlap.
 */
export function goldenHourSlots(
  cells: readonly EffectivenessHourCell[], family: 'message' | 'friend', metric: GoldenHourMetric,
  limit = 3, minSample = MIN_RATE_SAMPLE
): GoldenHourSlot[] {
  const byHour = Array.from({ length: 24 }, () => ({ tracked: 0, value: 0 }))
  for (const cell of cells) {
    if (cell.family !== family || cell.hour < 0 || cell.hour > 23) continue
    byHour[cell.hour].tracked += cell.tracked
    byHour[cell.hour].value += cell[metric]
  }
  const windows: GoldenHourSlot[] = []
  for (let hour = 0; hour < 24; hour++) {
    const next = (hour + 1) % 24
    // Both hours need data: an empty neighbour must not stretch a single hour's rate.
    if (byHour[hour].tracked <= 0 || byHour[next].tracked <= 0) continue
    const sample = byHour[hour].tracked + byHour[next].tracked
    if (sample < minSample) continue
    const rate = (byHour[hour].value + byHour[next].value) / sample
    windows.push({ startHour: hour, endHour: hour + 2, label: `${hourLabel(hour)}–${hourLabel(hour + 2)}`, rate, sample })
  }
  windows.sort((a, b) => b.rate - a.rate || b.sample - a.sample || a.startHour - b.startHour)
  const chosen: GoldenHourSlot[] = []
  const used = new Set<number>()
  for (const window of windows) {
    if (chosen.length >= limit) break
    if (used.has(window.startHour) || used.has((window.startHour + 1) % 24)) continue
    used.add(window.startHour); used.add((window.startHour + 1) % 24)
    chosen.push(window)
  }
  return chosen
}

// ---------------------------------------------------------------------------
// Suggestions (rule based, positive wording, never show error codes)
// ---------------------------------------------------------------------------

export type EffectivenessSuggestionId =
  | 'add_variants' | 'friend_first' | 'check_phone' | 'cancel_requests' | 'golden_hours' | 'winning_variant' | 'use_capacity'

export type EffectivenessSuggestionTarget =
  | 'campaigns' | 'new_friend_campaign' | 'phone_check' | 'new_cancel_request_campaign' | 'new_campaign'

export interface EffectivenessSuggestion {
  id: EffectivenessSuggestionId
  title: string
  actionLabel: string
  target: EffectivenessSuggestionTarget
}

/** Internal signal groups. Only the resulting suggestion text is ever displayed. */
export const SUGGESTION_STATUS_SIGNALS: Readonly<Record<'add_variants' | 'friend_first' | 'check_phone' | 'cancel_requests', readonly string[]>> = {
  add_variants: [
    'err_zalo_duplicate_or_fast_message', 'err_zalo_123_message_friend', 'err_zalo_123_message_stranger',
    'err_zalo_123_message_group', 'err_zalo_127_message_friend', 'err_zalo_127_message_stranger', 'err_zalo_126_127_message_group'
  ],
  friend_first: [
    'err_zalo_120_message_stranger', 'err_zalo_802_message_stranger', 'err_zalo_message_stranger_limited',
    'err_zalo_receiver_blocks_stranger_message'
  ],
  check_phone: ['err_zalo_user_not_found', 'err_zalo_219_find_phone_invalid', 'err_zalo_210_target_unavailable'],
  cancel_requests: ['err_zalo_223_add_friend_pause', 'err_zalo_224_add_friend_full']
}

export interface SuggestionSignals {
  /** Status code → count, from unsuccessful/skipped results of the period. */
  statusCounts: Readonly<Record<string, number>>
  /** All results of the period used as the base for "often". */
  attempts: number
  messageGoldenHours?: GoldenHourSlot | null
  /** Share of message sends already inside the golden window (0..1). */
  sendsInGoldenWindow?: number | null
  winningVariant?: { index: number } | null
  remainingCapacity?: number | null
}

export function selectEffectivenessSuggestions(signals: SuggestionSignals, limit = 3): EffectivenessSuggestion[] {
  const often = (codes: readonly string[]) => {
    const count = codes.reduce((sum, code) => sum + (Number(signals.statusCounts[code]) || 0), 0)
    return count >= Math.max(5, Math.ceil(signals.attempts * 0.03)) ? count : 0
  }
  const ranked: Array<{ weight: number; suggestion: EffectivenessSuggestion }> = []
  const push = (weight: number, suggestion: EffectivenessSuggestion) => { if (weight > 0) ranked.push({ weight, suggestion }) }
  push(often(SUGGESTION_STATUS_SIGNALS.add_variants), {
    id: 'add_variants', title: 'Thêm 2–3 biến thể nội dung giúp tin đến được nhiều khách hơn.',
    actionLabel: 'Chỉnh nội dung', target: 'campaigns'
  })
  push(often(SUGGESTION_STATUS_SIGNALS.friend_first), {
    id: 'friend_first', title: 'Kết bạn trước rồi nhắn tin giúp khách dễ nhận tin hơn.',
    actionLabel: 'Tạo chiến dịch kết bạn', target: 'new_friend_campaign'
  })
  push(often(SUGGESTION_STATUS_SIGNALS.check_phone), {
    id: 'check_phone', title: 'Lọc SĐT có Zalo trước khi chạy để dồn lượt gửi vào khách thật.',
    actionLabel: 'Kiểm tra SĐT có Zalo', target: 'phone_check'
  })
  push(often(SUGGESTION_STATUS_SIGNALS.cancel_requests), {
    id: 'cancel_requests', title: 'Dọn lời mời cũ để tiếp tục kết bạn mới.',
    actionLabel: 'Tạo chiến dịch Hủy lời mời', target: 'new_cancel_request_campaign'
  })
  const golden = signals.messageGoldenHours
  if (golden && (signals.sendsInGoldenWindow ?? 0) < 0.5) {
    push(Math.max(1, Math.round(golden.sample * 0.05)), {
      id: 'golden_hours', title: `Khách của bạn xem tin nhiều nhất ${golden.label}.`,
      actionLabel: 'Đặt lịch giờ vàng', target: 'campaigns'
    })
  }
  if (signals.winningVariant) {
    push(10, {
      id: 'winning_variant', title: `Biến thể #${signals.winningVariant.index + 1} được khách phản hồi nhiều nhất.`,
      actionLabel: 'Dùng làm nội dung chính', target: 'campaigns'
    })
  }
  const capacity = Math.floor(Number(signals.remainingCapacity) || 0)
  if (capacity > 0) {
    push(Math.min(4, capacity), {
      id: 'use_capacity', title: `Tài khoản còn có thể gửi thêm ${formatEffectivenessNumber(capacity)} lượt hôm nay.`,
      actionLabel: 'Tạo chiến dịch', target: 'new_campaign'
    })
  }
  ranked.sort((a, b) => b.weight - a.weight)
  return ranked.slice(0, limit).map(item => item.suggestion)
}

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

export interface EffectivenessQuery {
  flatformType?: ControlPlatform
  accountIds?: number[]
  startIso: string
  endIso: string
}

export interface EffectivenessActionTotals { code: string; name: string; counts: EffectivenessCounts }

export interface EffectivenessDailyPoint {
  date: string
  /** Successful sends of reach actions (messages, invitations, SMS). */
  reached: number
  seen: number
  interacted: number
  friended: number
  /** All successful actions (any type). */
  success: number
}

export interface EffectivenessUniqueCounts {
  reached: number
  seen: number
  interacted: number
  friended: number
}

export interface EffectivenessCapacity { accountId: number; accountName: string; remaining: number }

export interface EffectivenessOpportunities {
  /** Customers who replied or reacted in the period (unique when known). */
  engagedCustomers: number
  newFriends: number
  remainingCapacity: EffectivenessCapacity[]
}

export interface EffectivenessOverview {
  query: EffectivenessQuery
  generatedAt: string
  totals: EffectivenessCounts
  previousTotals: EffectivenessCounts | null
  /** Successful reach actions in the period. */
  reached: number
  previousReached: number | null
  unique: EffectivenessUniqueCounts | null
  message: MessageFunnel
  friend: FriendFunnel
  phoneLookup: { attempts: number; found: number }
  actions: EffectivenessActionTotals[]
  daily: EffectivenessDailyPoint[]
  timeSavedSeconds: number
  /** Share of trackable successful sends registered for engagement tracking. */
  trackingCoverage: number | null
  /** Sends after this instant are still inside the tracking window. */
  stillTrackingSince: string | null
  suggestions: EffectivenessSuggestion[]
  /** Internal inputs for client-side suggestion merging; never rendered. */
  signals: Pick<SuggestionSignals, 'statusCounts' | 'attempts'>
  opportunities: EffectivenessOpportunities
}

export interface CampaignEffectivenessRow {
  campaignId: number
  name: string
  actionId: string
  actionName: string
  status: string
  accountId: number
  accountName: string
  isDeleted: boolean
  counts: EffectivenessCounts
  reached: number
  seen: number
  interacted: number
  friended: number
  firstAt: string | null
  lastAt: string | null
}

export interface CampaignEffectivenessList {
  query: EffectivenessQuery
  rows: CampaignEffectivenessRow[]
  generatedAt: string
}

export interface CampaignActionProgress {
  code: string
  name: string
  done: number
  pending: number
  notDone: number
  stages: Partial<Record<EngagementStage, number>>
}

export interface CampaignEffectivenessDetail {
  query: EffectivenessQuery
  campaign: Omit<CampaignEffectivenessRow, 'counts' | 'reached' | 'seen' | 'interacted' | 'friended' | 'firstAt' | 'lastAt'>
  totals: EffectivenessCounts
  message: MessageFunnel
  friend: FriendFunnel
  daily: EffectivenessDailyPoint[]
  actions: CampaignActionProgress[]
  generatedAt: string
}

export interface EffectivenessActivityPoint { hour: number; seen: number; responded: number; reacted: number; friended: number }

export interface EffectivenessHours {
  query: EffectivenessQuery
  cells: EffectivenessHourCell[]
  activity: EffectivenessActivityPoint[]
  medianResponseMinutes: number | null
  medianSeenMinutes: number | null
  messageGolden: GoldenHourSlot[]
  friendGolden: GoldenHourSlot[]
  generatedAt: string
}

export interface EffectivenessDataGroupRow {
  groupId: number
  name: string
  reached: number
  tracked: number
  seen: number
  interacted: number
  friended: number
}

export interface EffectivenessDataGroups {
  query: EffectivenessQuery
  rows: EffectivenessDataGroupRow[]
  generatedAt: string
}

export type EffectivenessListStage = EngagementStage | 'interacted' | 'engaged'

export interface EffectivenessCustomerRow {
  id: number
  campaignId: number
  campaignName: string
  accountId: number
  accountName: string
  actionCode: string
  sentAt: string
  stage: EngagementStage | null
  seenAt: string | null
  respondedAt: string | null
  reactedAt: string | null
  friendedAt: string | null
  name: string | null
  uid: string | null
  phone: string | null
}

export interface EffectivenessCustomerQuery extends EffectivenessQuery {
  stage: EffectivenessListStage
  actionCodes?: string[]
  campaignId?: number
  page?: number
  pageSize?: number
}

export interface EffectivenessCustomerPage {
  query: EffectivenessCustomerQuery
  rows: EffectivenessCustomerRow[]
  total: number
  page: number
  pageSize: number
  generatedAt: string
}

export interface EffectivenessLifetimeMonth { month: string; reached: number; seen: number; interacted: number; friended: number; success: number }

export interface EffectivenessLifetime {
  /** First campaign of this staff member (any time), for "ngày đồng hành". */
  since: string | null
  rangeStartIso: string
  monthly: EffectivenessLifetimeMonth[]
  totals: { reached: number; uniqueReached: number | null; seen: number; interacted: number; friended: number; success: number }
  milestones: { achieved: number[]; next: number | null; progress: number }
  timeSavedSeconds: number
  generatedAt: string
}

/** Data the customer has built inside the software (HEAD counts only). */
export interface EffectivenessAssets {
  dataGroups: number
  zaloContacts: number
  tags: number
  contentTemplates: number
  generatedAt: string
}

/** Final-stage split of successful message/friend results per account, for the account report. */
export interface EffectivenessAccountStages {
  query: EffectivenessQuery
  rows: Array<{ accountId: number; actionCode: string; stages: Partial<Record<EngagementStage, number>> }>
  generatedAt: string
}

/** Stage columns shown after "Thành công" in the account report (sum equals success). */
export function accountStageColumns(actionCode: string): EngagementStage[] {
  if (isMessageEngagementAction(actionCode)) return ['responded', 'reacted', 'seen', 'sent']
  if (actionCode === FRIEND_ENGAGEMENT_ACTION) return ['friended', 'requested']
  return []
}

/**
 * Engaged customers → data group rows (same row shape as other Zalo ingest flows).
 * Phone groups need a phone; Zalo UID groups need a UID from a single account.
 */
export function effectivenessCustomerGroupRows(
  rows: ReadonlyArray<Pick<EffectivenessCustomerRow, 'accountId' | 'name' | 'uid' | 'phone'>>, type: 'phone' | 'zalo_person'
): Array<{ contactType: 'phone' | 'person'; flatformType: 'zalo'; sourceAccountId: number | null; phone: string | null; name: string | null; uid: string | null; extraData: Record<string, unknown> }> {
  const usable = rows.filter(row => type === 'phone' ? !!row.phone?.trim() : !!row.uid?.trim())
  if (!usable.length) {
    throw new Error(type === 'phone' ? 'Không có khách nào có số điện thoại để lưu.' : 'Không có khách nào có Zalo UID để lưu.')
  }
  if (type === 'zalo_person' && new Set(usable.map(row => row.accountId)).size > 1) {
    throw new Error('Nhóm Zalo UID chỉ nhận khách của cùng một tài khoản. Vui lòng lọc theo một tài khoản hoặc chọn nhóm SĐT.')
  }
  const seen = new Set<string>()
  return usable.flatMap(row => {
    const key = type === 'phone' ? `p:${row.phone!.trim()}` : `u:${row.accountId}:${row.uid!.trim()}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      contactType: type === 'phone' ? 'phone' as const : 'person' as const, flatformType: 'zalo' as const,
      sourceAccountId: row.accountId ?? null, phone: row.phone?.trim() || null, name: row.name?.trim() || null,
      uid: type === 'zalo_person' ? row.uid!.trim() : null,
      extraData: { source: 'campaign_effectiveness', zaloUid: row.uid || null }
    }]
  })
}

export const EFFECTIVENESS_ENDPOINTS = {
  accountStages: '/reports/effectiveness/account-stages',
  overview: '/reports/effectiveness/overview',
  campaigns: '/reports/effectiveness/campaigns',
  hours: '/reports/effectiveness/hours',
  dataGroups: '/reports/effectiveness/data-groups',
  customers: '/reports/effectiveness/customers',
  lifetime: '/reports/effectiveness/lifetime',
  assets: '/reports/effectiveness/assets',
  aiSummary: '/reports/effectiveness/ai-summary'
} as const

// ---------------------------------------------------------------------------
// AI summary (on explicit request; aggregates only, no customer data)
// ---------------------------------------------------------------------------

/** `ai_using.code` of the summary prompt (akaAgent migration V463). */
export const REPORT_SUMMARY_AI_CODE = 'app_report_effectiveness_summary'
/** The configured model; the API refuses another binding instead of silently changing behaviour. */
export const REPORT_SUMMARY_AI_MODEL = 'gpt-6.1-sol'

export const EFFECTIVENESS_SUGGESTION_TARGETS: readonly EffectivenessSuggestionTarget[] = [
  'campaigns', 'new_friend_campaign', 'phone_check', 'new_cancel_request_campaign', 'new_campaign'
]

export interface EffectivenessAiSummary {
  headline: string
  achievements: string[]
  opportunities: string[]
  suggestions: Array<{ title: string; target: EffectivenessSuggestionTarget | null }>
  generatedAt: string
}

/** Strict JSON schema the model must follow. */
export const EFFECTIVENESS_AI_SUMMARY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['headline', 'achievements', 'opportunities', 'suggestions'],
  properties: {
    headline: { type: 'string' },
    achievements: { type: 'array', maxItems: 3, items: { type: 'string' } },
    opportunities: { type: 'array', maxItems: 3, items: { type: 'string' } },
    suggestions: { type: 'array', maxItems: 3, items: {
      type: 'object', additionalProperties: false, required: ['title', 'target'],
      // 'none' instead of null keeps the schema valid for strict structured output on every provider.
      properties: { title: { type: 'string' }, target: { type: 'string', enum: [...EFFECTIVENESS_SUGGESTION_TARGETS, 'none'] } }
    } }
  }
} as const

/** Wording the effectiveness reports never show (risk, failure, blocking). */
export const NEGATIVE_REPORT_WORDING = /thất bại|lỗi|bị chặn|hạn chế|rủi ro|khóa|khoá|cấm|nguy cơ/i

const AI_TEXT_MAX = 280

function cleanAiText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text || NEGATIVE_REPORT_WORDING.test(text)) return null
  return Array.from(text).length > AI_TEXT_MAX ? `${Array.from(text).slice(0, AI_TEXT_MAX - 1).join('')}…` : text
}

/**
 * Validates model output against the contract and drops any line with negative wording, so the summary keeps
 * the positive-report rule even if the model slips. Returns null when nothing usable remains.
 */
export function sanitizeEffectivenessAiSummary(value: unknown, generatedAt: string): EffectivenessAiSummary | null {
  let raw = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return null }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const list = (items: unknown) => (Array.isArray(items) ? items : []).map(cleanAiText).filter((item): item is string => !!item).slice(0, 3)
  const achievements = list(record.achievements)
  const opportunities = list(record.opportunities)
  const suggestions = (Array.isArray(record.suggestions) ? record.suggestions : []).flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const title = cleanAiText((item as Record<string, unknown>).title)
    const target = (item as Record<string, unknown>).target
    return title ? [{ title, target: EFFECTIVENESS_SUGGESTION_TARGETS.includes(target as EffectivenessSuggestionTarget) ? target as EffectivenessSuggestionTarget : null }] : []
  }).slice(0, 3)
  const headline = cleanAiText(record.headline) ?? achievements[0] ?? null
  if (!headline && !opportunities.length && !suggestions.length) return null
  return { headline: headline ?? 'Tóm tắt thành quả', achievements, opportunities, suggestions, generatedAt }
}
