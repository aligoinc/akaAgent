// "aka Cài đặt" (ô nổi AI điền box của form chiến dịch): danh sách ô đã đổi (cũ → mới) dựng từ giá trị đang có trên form và
// bản vá AI trả về. Chỉ để hiển thị; việc điền vẫn do từng form làm như trước (docs/FB_AI_FILTER_PLAN.md mục 2.2).
import { FACEBOOK_AI_FIELDS, type FacebookAiKind, type FacebookAiPatch, type FacebookAiValue } from '../../../../shared/campaignFacebookAi'
import type { ScheduleAiFields, ScheduleAiPatch } from '../../../../shared/campaignScheduleAi'
import type { LimitsAiFields, LimitsAiPatch } from '../../../../shared/campaignLimitsAi'

export interface AkaSettingsChange { label: string; before: string; after: string }
export interface AkaSettingsExample { label: string; text: string }

const MAX_VALUE_CHARS = 120
const CHOICE_LABELS: Record<string, string> = {
  most_relevant: 'Phù hợp nhất', recent_activity: 'Hoạt động mới đây', new_posts: 'Bài viết mới',
  all_comments: 'Tất cả bình luận', newest: 'Mới nhất', all: 'Tất cả', today: 'Hôm nay', this_week: 'Tuần này',
  this_month: 'Tháng này', you: 'Bạn', friends: 'Bạn bè', groups_pages: 'Nhóm và trang', near_me: 'Gần tôi',
  pending_only: 'Group bị duyệt', published_only: 'Group đăng thành công', own: 'Bài của mình', others: 'Bài của người khác',
  phone: 'SĐT', zalo_group_link: 'Link group Zalo', facebook_uid: 'UID Facebook', post_link: 'Link bài', facebook_group: 'Group Facebook',
  daily: 'Hằng ngày', weekly: 'Hằng tuần', monthly: 'Hằng tháng'
}

function shorten(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' · ').trim()
  return flat.length > MAX_VALUE_CHARS ? `${flat.slice(0, MAX_VALUE_CHARS - 1)}…` : flat
}

export function formatAkaSettingsValue(value: unknown, options: { choices?: boolean; idsUnit?: string } = {}): string {
  if (value === undefined || value === null) return '(trống)'
  if (typeof value === 'boolean') return value ? 'Bật' : 'Tắt'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '(trống)'
  if (Array.isArray(value)) {
    if (options.idsUnit) return value.length ? `${value.length} ${options.idsUnit}` : '(trống)'
    return value.length ? shorten(value.map(item => String(item)).join(', ')) : '(trống)'
  }
  const text = String(value)
  if (!text.trim()) return '(trống)'
  return options.choices && CHOICE_LABELS[text] ? CHOICE_LABELS[text] : shorten(text)
}

// Nhãn trong FACEBOOK_AI_FIELDS viết cho AI ("Sắp xếp bài viết: liên quan/..."); khách chỉ cần phần trước dấu hai chấm.
const fieldLabel = (label: string) => label.split(/[:;]/)[0].trim()

export function describeFacebookAiChanges(kind: FacebookAiKind, current: FacebookAiPatch, patch: FacebookAiPatch): AkaSettingsChange[] {
  const fields = FACEBOOK_AI_FIELDS[kind] || {}
  const changes: AkaSettingsChange[] = []
  for (const [key, after] of Object.entries(patch)) {
    const field = fields[key]
    if (!field) continue
    const before: FacebookAiValue | undefined = current[key]
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue
    const options = { choices: Boolean(field.choices), idsUnit: field.type === 'ids' ? 'tài khoản' : undefined }
    const label = key === 'keywords' ? 'Danh sách từ khóa' : fieldLabel(field.label)
    const beforeText = formatAkaSettingsValue(before, options)
    const afterText = formatAkaSettingsValue(after, options)
    if (beforeText !== afterText || key === 'accountIds') changes.push({ label, before: beforeText, after: afterText })
  }
  return changes
}

const SCHEDULE_LABELS: Record<keyof ScheduleAiFields, string> = {
  scheduleType: 'Kiểu lịch', startDate: 'Ngày bắt đầu', startTime: 'Giờ chạy', scheduleEndDate: 'Ngày kết thúc',
  scheduleDays: 'Ngày trong tháng', scheduleWeekDays: 'Thứ trong tuần', useDailyStopTime: 'Dừng trong ngày',
  dailyStopTime: 'Giờ dừng', continueNextDay: 'Chạy tiếp ngày hôm sau', refreshData: 'Làm mới data',
  findDataRerunEnabled: 'Chạy lại tìm data', findDataRerunAfterHours: 'Chạy lại sau (giờ)',
  multiDailyTimeSlotsEnabled: 'Chạy nhiều khung giờ', multiDailyTimeSlots: 'Các khung giờ'
}

export function describeScheduleAiChanges(current: ScheduleAiFields, patch: ScheduleAiPatch): AkaSettingsChange[] {
  const changes: AkaSettingsChange[] = []
  for (const key of Object.keys(patch) as Array<keyof ScheduleAiFields>) {
    if (!(key in SCHEDULE_LABELS)) continue
    const options = { choices: key === 'scheduleType' }
    const before = formatAkaSettingsValue(current[key], options)
    const after = formatAkaSettingsValue(patch[key], options)
    if (before !== after) changes.push({ label: SCHEDULE_LABELS[key], before, after })
  }
  return changes
}

const LIMIT_VALUE_LABELS = { dailyLimit: 'mỗi ngày', rateLimitCount: 'số lượt mỗi khung giờ', rateLimitMinutes: 'khung giờ (phút)' } as const

export function describeLimitsAiChanges(current: LimitsAiFields, patch: LimitsAiPatch): AkaSettingsChange[] {
  const changes: AkaSettingsChange[] = []
  const push = (label: string, beforeValue: unknown, afterValue: unknown) => {
    const before = formatAkaSettingsValue(beforeValue), after = formatAkaSettingsValue(afterValue)
    if (before !== after) changes.push({ label, before, after })
  }
  if (patch.sleepBetweenActions !== undefined) push('Nghỉ giữa hai lần (giây)', current.sleepBetweenActions, patch.sleepBetweenActions)
  if (patch.continueWhenActionLimitReached !== undefined) {
    push('Tiếp tục khi chạm giới hạn', current.continueWhenActionLimitReached, patch.continueWhenActionLimitReached)
  }
  if (patch.postsPerTarget !== undefined) push('Số bài cần comment', current.postsPerTarget, patch.postsPerTarget)
  for (const item of patch.actions || []) {
    const action = current.actions.find(candidate => candidate.actionCode === item.actionCode)
    const name = action?.label || item.actionCode
    for (const key of Object.keys(LIMIT_VALUE_LABELS) as Array<keyof typeof LIMIT_VALUE_LABELS>) {
      if (item[key] === undefined) continue
      push(`${name}: ${LIMIT_VALUE_LABELS[key]}`, action ? action[key] : undefined, item[key])
    }
  }
  return changes
}

// "Thử nhanh": câu mẫu khách bấm vào là điền sẵn ô mô tả (không gửi ngay).
export const FACEBOOK_AI_EXAMPLES: Record<FacebookAiKind, AkaSettingsExample[]> = {
  general: [{ label: 'Đặt tên chiến dịch', text: 'đặt tên chiến dịch là Tìm khách tháng 12' }],
  search: [
    { label: 'Tìm SĐT trong bài và comment', text: 'tìm số điện thoại trong bài viết và comment, mỗi group quét 20 bài' },
    { label: 'Người cần mua, bỏ môi giới', text: 'chỉ lấy bài của người đang cần mua nhà cho mình, loại bỏ bài của môi giới' }
  ],
  keywords: [{ label: 'Từ khoá nhà đất', text: 'cần mua nhà quận 7, mua căn hộ giá rẻ, tìm nhà thuê nguyên căn' }],
  postSearch: [
    { label: 'Người cần thuê trọ, bỏ môi giới', text: 'tìm bài người đang cần thuê phòng trọ ở Hà Nội, bỏ bài môi giới và bài tìm người ở ghép, chỉ comment bài mới' },
    { label: 'Chỉ vài từ khoá', text: 'chỉ comment bài có một trong các từ khoá: thuê trọ, tìm phòng, cần phòng' }
  ],
  newsfeed: [{ label: 'Lướt 30 phút, like 10 bài', text: 'lướt newsfeed 30 phút, like tối đa 10 bài, không comment' }],
  groupComment: [{ label: 'Comment bài của mình', text: 'kiêm comment vào bài của mình, tối đa 2 comment: Inbox nhé | Ib mình nha' }]
}

export const SCHEDULE_AI_EXAMPLES: AkaSettingsExample[] = [
  { label: 'Thứ 2, 4, 6 lúc 8h', text: 'chạy vào thứ 2, 4, 6 hằng tuần lúc 8h sáng' },
  { label: 'Mỗi ngày, dừng lúc 17h', text: 'chạy mỗi ngày từ 8h sáng, dừng lúc 17h, hôm sau chạy tiếp' }
]

export const LIMITS_AI_EXAMPLES: AkaSettingsExample[] = [
  { label: 'Mỗi ngày 50 lượt', text: 'mỗi ngày tối đa 50 lượt, mỗi giờ 10 lượt, nghỉ 30 giây giữa hai lần' }
]
