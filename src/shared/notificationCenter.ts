// Trung tâm thông báo akaBiz (DB V457): hằng số, nhãn, kiểm tra và chuẩn hóa dữ liệu RPC.
// Nhãn/quy tắc/thông báo lỗi chép từ akaAgentWebApp packages/control-api/src/notifications.ts
// (Desktop không import được package WebApp); phần bổ sung riêng cho Desktop ghi rõ bên dưới.
import type {
  AccountStatusSubscription,
  CampaignStatusSubscription,
  DataGroupMembershipSubscription,
  NotificationAccountRunStatus,
  NotificationCampaignStatus,
  NotificationChannelState,
  NotificationContent,
  NotificationContentSection,
  NotificationCursor,
  NotificationDeliverySummary,
  NotificationDetail,
  NotificationDevice,
  NotificationEventType,
  NotificationGroupAction,
  NotificationListItem,
  NotificationListPage,
  NotificationListQuery,
  NotificationLoginEvent,
  NotificationReadRequest,
  NotificationReadResult,
  NotificationSettings,
  NotificationSeverity,
  NotificationSubscriptions,
  SaveNotificationSettingsRequest,
  ScheduledReportSubscription
} from './types'

export const NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] = [
  'campaign.status_changed',
  'account.status_changed',
  'report.scheduled',
  'data_group.membership_changed',
  'system.test'
]
export const NOTIFICATION_CAMPAIGN_STATUSES: readonly NotificationCampaignStatus[] = ['hoàn thành', 'tạm dừng', 'đang chạy', 'chờ xử lý']
export const NOTIFICATION_LOGIN_EVENTS: readonly NotificationLoginEvent[] = ['logout', 'checkpoint', 'login']
export const NOTIFICATION_ACCOUNT_RUN_STATUSES: readonly NotificationAccountRunStatus[] = ['chờ xử lý', 'đang chạy', 'tạm dừng']
export const NOTIFICATION_GROUP_ACTIONS: readonly NotificationGroupAction[] = ['added', 'removed']
export const NOTIFICATION_BUCKET_MINUTES: readonly number[] = [5, 15, 30, 60]
export const NOTIFICATION_WEEK_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7]
export const NOTIFICATION_MAX_EMAILS = 5
export const NOTIFICATION_MAX_REPORT_TIMES = 6
export const NOTIFICATION_MAX_FILTER_IDS = 200
export const NOTIFICATION_UNREAD_CAP = 100
export const NOTIFICATION_PAGE_SIZE = 20
export const NOTIFICATION_DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh'

/**
 * Server chưa có trung tâm thông báo (DB chưa có RPC V457): giao diện quay về form
 * "Thông báo email" cũ thay vì báo lỗi. Các lỗi khác vẫn hiện nút Thử lại.
 */
export const NOTIFICATION_CENTER_NOT_READY = 'notification_center_not_ready'
/** Lỗi mạng, hết thời gian chờ hoặc dữ liệu trả về không đọc được (riêng Desktop). */
export const NOTIFICATION_CENTER_UNAVAILABLE = 'notification_unavailable'

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  'campaign.status_changed': 'Chiến dịch',
  'account.status_changed': 'Tài khoản',
  'report.scheduled': 'Báo cáo',
  'data_group.membership_changed': 'Nhóm data',
  'system.test': 'Gửi thử'
}

export const NOTIFICATION_LOGIN_EVENT_LABELS: Record<NotificationLoginEvent, string> = {
  logout: 'Đăng xuất',
  checkpoint: 'Checkpoint',
  login: 'Đăng nhập'
}

// --- Nhãn bổ sung cho Desktop ---
export const NOTIFICATION_STATUS_LABELS: Record<NotificationCampaignStatus, string> = {
  'hoàn thành': 'Hoàn thành',
  'tạm dừng': 'Tạm dừng',
  'đang chạy': 'Đang chạy',
  'chờ xử lý': 'Chờ xử lý'
}

export const NOTIFICATION_GROUP_ACTION_LABELS: Record<NotificationGroupAction, string> = {
  added: 'Vào nhóm',
  removed: 'Rời nhóm'
}

/** 1 = Thứ Hai … 7 = Chủ nhật */
export const NOTIFICATION_WEEK_DAY_LABELS: Record<number, string> = {
  1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN'
}

export const NOTIFICATION_DELIVERY_STATUS_LABELS: Record<NotificationDeliverySummary['status'], string> = {
  pending: 'Đang chờ gửi',
  sending: 'Đang gửi',
  retrying: 'Đang thử lại',
  sent: 'Đã gửi',
  failed: 'Gửi lỗi',
  skipped: 'Không gửi',
  cancelled: 'Đã hủy'
}

export function notificationDeliveryReason(errorCode: string | null | undefined): string | null {
  switch (errorCode) {
    case null:
    case undefined:
    case '': return null
    case 'dry_run': return 'Đang chạy thử, chưa gửi thật'
    case 'hourly_cap': return 'Vượt giới hạn số thông báo mỗi giờ'
    case 'invalid_token':
    case 'token_invalid': return 'iPhone không còn nhận được thông báo'
    case 'link_secret_missing': return 'Hệ thống chưa sẵn sàng gửi email xác nhận'
    default: return 'Không gửi được'
  }
}

export function notificationEventLabel(type: string | null | undefined): string {
  return (NOTIFICATION_EVENT_LABELS as Record<string, string>)[type ?? ''] ?? 'Thông báo'
}

export function normalizeNotificationEmails(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const email = String(raw ?? '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    result.push(email)
  }
  return result
}

const EMAIL_PATTERN = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/

export function isValidNotificationEmail(value: string): boolean {
  const email = value.trim().toLowerCase()
  return email.length <= 254 && EMAIL_PATTERN.test(email)
}

export function isValidNotificationTime(value: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
}

/** Phần cài đặt người dùng sửa được (NotificationSettings cũng thỏa kiểu này). */
export interface NotificationSettingsDraftInput {
  channels: { email: { enabled: boolean; recipients: readonly string[] } }
  subscriptions: NotificationSubscriptions
}

/** Lỗi kiểm tra phía client, cùng quy tắc với RPC save_settings (để báo sớm, server vẫn kiểm lại). */
export function validateNotificationSettingsDraft(draft: NotificationSettingsDraftInput): string | null {
  const recipients = normalizeNotificationEmails(draft.channels.email.recipients)
  if (recipients.length > NOTIFICATION_MAX_EMAILS) return `Tối đa ${NOTIFICATION_MAX_EMAILS} email nhận thông báo.`
  if (recipients.some(email => !isValidNotificationEmail(email))) return 'Email nhận thông báo không hợp lệ.'
  if (draft.channels.email.enabled && recipients.length === 0) return 'Vui lòng nhập ít nhất một email nhận thông báo.'
  const { campaignStatus, accountStatus, scheduledReport, dataGroupMembership } = draft.subscriptions
  if (campaignStatus.enabled && campaignStatus.toStatuses.length === 0) return 'Chọn ít nhất một trạng thái chiến dịch cần báo.'
  if (accountStatus.enabled && accountStatus.loginEvents.length + accountStatus.runStatuses.length === 0) {
    return 'Chọn ít nhất một sự kiện tài khoản cần báo.'
  }
  if (scheduledReport.weekDays.length === 0) return 'Chọn ít nhất một ngày gửi báo cáo.'
  if (scheduledReport.times.length === 0 || scheduledReport.times.length > NOTIFICATION_MAX_REPORT_TIMES) {
    return `Báo cáo cần 1–${NOTIFICATION_MAX_REPORT_TIMES} mốc giờ.`
  }
  if (scheduledReport.times.some(time => !isValidNotificationTime(time))) return 'Giờ gửi báo cáo phải có dạng HH:MM.'
  if (new Set(scheduledReport.times).size !== scheduledReport.times.length) return 'Các mốc giờ báo cáo không được trùng nhau.'
  if (dataGroupMembership.enabled && dataGroupMembership.actions.length === 0) return 'Chọn ít nhất một loại thay đổi của nhóm data.'
  // Bổ sung Desktop: RPC từ chối danh sách "đã chọn" rỗng hoặc quá 200 mục (notification_invalid_ids).
  const idLists: Array<[number[] | null, string]> = [
    [campaignStatus.campaignIds, 'chiến dịch'],
    [accountStatus.accountIds, 'tài khoản'],
    [dataGroupMembership.groupIds, 'nhóm data']
  ]
  for (const [ids, label] of idLists) {
    if (ids === null) continue
    if (ids.length === 0) return `Chọn ít nhất một ${label}, hoặc chọn Tất cả ${label}.`
    if (ids.length > NOTIFICATION_MAX_FILTER_IDS) return `Chọn tối đa ${NOTIFICATION_MAX_FILTER_IDS} ${label}.`
  }
  return null
}

export function notificationErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'notification_settings_conflict': return 'Cài đặt vừa được thay đổi ở nơi khác. Hãy tải lại rồi lưu lần nữa.'
    case 'notification_email_required': return 'Vui lòng nhập ít nhất một email nhận thông báo.'
    case 'notification_invalid_email': return 'Email nhận thông báo không hợp lệ (tối đa 5 email).'
    case 'notification_invalid_schedule': return 'Lịch gửi báo cáo không hợp lệ.'
    case 'notification_ids_not_owned': return 'Có chiến dịch, tài khoản hoặc nhóm không còn thuộc bạn. Hãy chọn lại.'
    case 'notification_test_rate_limited': return 'Bạn đã gửi thử 3 lần trong 10 phút. Vui lòng thử lại sau.'
    case 'notification_center_disabled': return 'Trung tâm thông báo đang tạm tắt.'
    case 'notification_center_not_ready': return 'Trung tâm thông báo chưa sẵn sàng. Bạn vẫn dùng được cài đặt email như trước.'
    case 'notification_session_invalid': return 'Phiên đăng nhập trên máy này không còn hiệu lực.'
    // Bổ sung Desktop (WebApp gom các mã này vào câu mặc định).
    case 'notification_invalid_filter': return 'Lựa chọn loại thông báo chưa hợp lệ. Hãy kiểm tra lại phần Tùy chỉnh.'
    case 'notification_invalid_ids': return 'Danh sách đã chọn không hợp lệ (tối đa 200 mục).'
    case 'notification_invalid_cooldown': return 'Thời gian chờ giữa hai thông báo không hợp lệ.'
    case 'notification_invalid_flag': return 'Cài đặt thông báo không hợp lệ. Hãy tải lại rồi thử lại.'
    case 'notification_revision_required': return 'Thiếu phiên bản cài đặt. Hãy tải lại rồi lưu lần nữa.'
    case 'notification_not_found': return 'Không tìm thấy thông báo.'
    case 'notification_device_not_found': return 'Không tìm thấy iPhone này. Hãy tải lại cài đặt.'
    case 'notification_invalid_device': return 'Thông tin thiết bị không hợp lệ.'
    case 'notification_invalid_channel': return 'Kênh gửi thử không hợp lệ.'
    case 'notification_access_denied': return 'Không có quyền truy cập thông báo.'
    case 'notification_action_not_allowed': return 'Thao tác này chỉ thực hiện được trên web hoặc iPhone.'
    case 'notification_session_changed': return 'Phiên đăng nhập đã thay đổi. Hãy mở lại cài đặt.'
    case 'notification_invalid_request': return 'Yêu cầu không hợp lệ. Hãy tải lại cài đặt.'
    case 'notification_unavailable': return 'Không thể tải thông báo. Vui lòng kiểm tra kết nối và thử lại.'
    default: return 'Không thể xử lý cài đặt thông báo. Vui lòng thử lại.'
  }
}

// ---------------------------------------------------------------------------
// Chuẩn hóa JSON trả về từ RPC (main process dùng trước khi gửi sang renderer).
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>
const isObject = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const flag = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback)
const integer = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^-?\d{1,15}$/.test(value)) return Number(value)
  return null
}
const positiveId = (value: unknown): number | null => {
  const id = integer(value)
  return id !== null && id > 0 ? id : null
}

function parseIdList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const ids: number[] = []
  for (const item of value) {
    const id = positiveId(item)
    if (id !== null && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** Giữ các giá trị hợp lệ theo đúng thứ tự chuẩn; không phải mảng thì dùng mặc định. */
function pickAllowed<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[]): T[] {
  if (!Array.isArray(value)) return [...fallback]
  const present = new Set(value.filter((item): item is string => typeof item === 'string'))
  return allowed.filter(item => present.has(item))
}

function parseCooldown(value: unknown): number | null {
  const minutes = integer(value)
  return minutes !== null && minutes >= 0 && minutes <= 1440 ? minutes : null
}

function parseSubscriptions(raw: unknown): NotificationSubscriptions {
  const root = isObject(raw) ? raw : {}
  const base = (value: unknown) => {
    const row = isObject(value) ? value : {}
    return { row, enabled: flag(row.enabled), email: flag(row.email), push: flag(row.push), cooldownMinutes: parseCooldown(row.cooldownMinutes) }
  }
  const c = base(root.campaignStatus)
  const a = base(root.accountStatus)
  const r = base(root.scheduledReport)
  const g = base(root.dataGroupMembership)
  const weekDays = Array.isArray(r.row.weekDays)
    ? NOTIFICATION_WEEK_DAYS.filter(day => (r.row.weekDays as unknown[]).some(item => integer(item) === day))
    : [...NOTIFICATION_WEEK_DAYS]
  const times = Array.isArray(r.row.times)
    ? Array.from(new Set((r.row.times as unknown[]).filter((item): item is string => typeof item === 'string' && isValidNotificationTime(item)))).sort()
    : ['18:00']
  const bucket = integer(g.row.bucketMinutes)
  const campaignStatus: CampaignStatusSubscription = {
    enabled: c.enabled, email: c.email, push: c.push, cooldownMinutes: c.cooldownMinutes,
    toStatuses: pickAllowed(c.row.toStatuses, NOTIFICATION_CAMPAIGN_STATUSES, ['hoàn thành', 'tạm dừng']),
    campaignIds: parseIdList(c.row.campaignIds)
  }
  const accountStatus: AccountStatusSubscription = {
    enabled: a.enabled, email: a.email, push: a.push, cooldownMinutes: a.cooldownMinutes,
    loginEvents: pickAllowed(a.row.loginEvents, NOTIFICATION_LOGIN_EVENTS, NOTIFICATION_LOGIN_EVENTS),
    runStatuses: pickAllowed(a.row.runStatuses, NOTIFICATION_ACCOUNT_RUN_STATUSES, []),
    accountIds: parseIdList(a.row.accountIds)
  }
  const scheduledReport: ScheduledReportSubscription = {
    enabled: r.enabled, email: r.email, push: r.push, cooldownMinutes: r.cooldownMinutes,
    weekDays: weekDays.length > 0 ? weekDays : [...NOTIFICATION_WEEK_DAYS],
    times: times.length > 0 ? times.slice(0, NOTIFICATION_MAX_REPORT_TIMES) : ['18:00'],
    skipWhenIdle: flag(r.row.skipWhenIdle),
    nextRunAt: text(r.row.nextRunAt)
  }
  const dataGroupMembership: DataGroupMembershipSubscription = {
    enabled: g.enabled, email: g.email, push: g.push, cooldownMinutes: g.cooldownMinutes,
    groupIds: parseIdList(g.row.groupIds),
    actions: pickAllowed(g.row.actions, NOTIFICATION_GROUP_ACTIONS, NOTIFICATION_GROUP_ACTIONS),
    bucketMinutes: bucket !== null && NOTIFICATION_BUCKET_MINUTES.includes(bucket) ? bucket : 5,
    includeSharedGroups: flag(g.row.includeSharedGroups)
  }
  return { campaignStatus, accountStatus, scheduledReport, dataGroupMembership }
}

const PERMISSION_STATUSES = ['granted', 'denied', 'undetermined', 'provisional'] as const

function parseDevice(raw: unknown): NotificationDevice | null {
  if (!isObject(raw)) return null
  const id = positiveId(raw.id)
  if (id === null) return null
  const permission = text(raw.permissionStatus)
  return {
    id,
    name: text(raw.name),
    model: text(raw.model),
    osVersion: text(raw.osVersion),
    appVersion: text(raw.appVersion),
    enabled: flag(raw.enabled, true),
    hasToken: flag(raw.hasToken),
    permissionStatus: (PERMISSION_STATUSES as readonly string[]).includes(permission ?? '') ? permission as NotificationDevice['permissionStatus'] : null,
    lastRegisteredAt: text(raw.lastRegisteredAt) ?? '',
    lastSuccessAt: text(raw.lastSuccessAt),
    isCurrentDevice: flag(raw.isCurrentDevice)
  }
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

export function parseNotificationSettings(raw: unknown): NotificationSettings | null {
  if (!isObject(raw)) return null
  const revision = integer(raw.revision)
  if (revision === null || revision < 0 || !isObject(raw.channels) || !isObject(raw.subscriptions)) return null
  const email = isObject(raw.channels.email) ? raw.channels.email : {}
  const push = isObject(raw.channels.push) ? raw.channels.push : {}
  const recipients = normalizeNotificationEmails(stringList(email.recipients))
  const unverified = normalizeNotificationEmails(stringList(email.unverified)).filter(item => recipients.includes(item))
  return {
    revision,
    timezone: text(raw.timezone) || NOTIFICATION_DEFAULT_TIMEZONE,
    updatedAt: text(raw.updatedAt),
    updatedByClient: text(raw.updatedByClient),
    centerEnabled: flag(raw.centerEnabled),
    deliveryMode: text(raw.deliveryMode) === 'live' ? 'live' : 'dry_run',
    channels: {
      email: { enabled: flag(email.enabled), recipients, unverified },
      push: {
        enabled: flag(push.enabled),
        devices: Array.isArray(push.devices) ? push.devices.map(parseDevice).filter((item): item is NotificationDevice => item !== null) : []
      }
    },
    subscriptions: parseSubscriptions(raw.subscriptions)
  }
}

const SEVERITIES: readonly NotificationSeverity[] = ['info', 'warning', 'critical']
const CHANNEL_STATES: readonly NotificationChannelState[] = ['none', 'pending', 'sent', 'partial', 'failed', 'skipped']
const severity = (value: unknown): NotificationSeverity => (SEVERITIES as readonly unknown[]).includes(value) ? value as NotificationSeverity : 'info'
const channelState = (value: unknown): NotificationChannelState => (CHANNEL_STATES as readonly unknown[]).includes(value) ? value as NotificationChannelState : 'none'

function parseListItem(raw: unknown): NotificationListItem | null {
  if (!isObject(raw)) return null
  const id = positiveId(raw.id)
  const eventType = text(raw.eventType)
  const createdAt = text(raw.createdAt)
  if (id === null || !eventType || !createdAt) return null
  return {
    id,
    // Loại mới từ server vẫn hiển thị (nhãn chung "Thông báo"), không làm hỏng danh sách.
    eventType: eventType as NotificationEventType,
    severity: severity(raw.severity),
    title: text(raw.title),
    body: text(raw.body),
    occurredAt: text(raw.occurredAt) ?? createdAt,
    createdAt,
    readAt: text(raw.readAt),
    emailState: channelState(raw.emailState),
    pushState: channelState(raw.pushState),
    campaignId: positiveId(raw.campaignId),
    accountId: positiveId(raw.accountId),
    dataGroupId: positiveId(raw.dataGroupId),
    entityKey: text(raw.entityKey) ?? ''
  }
}

function parseCursor(raw: unknown): NotificationCursor | null {
  if (!isObject(raw)) return null
  const createdAt = text(raw.createdAt)
  const id = positiveId(raw.id)
  return createdAt && id !== null ? { createdAt, id } : null
}

export function parseNotificationListPage(raw: unknown): NotificationListPage | null {
  if (!isObject(raw) || !Array.isArray(raw.items)) return null
  return {
    items: raw.items.map(parseListItem).filter((item): item is NotificationListItem => item !== null),
    nextCursor: parseCursor(raw.nextCursor),
    unreadCount: Math.max(0, integer(raw.unreadCount) ?? 0)
  }
}

const SECTION_TONES = ['activity', 'result', 'issue', 'info'] as const
const ROW_TONES = ['ok', 'warn', 'bad', 'muted'] as const
const cell = (value: unknown): string => (value === null || value === undefined ? '' : typeof value === 'object' ? '' : String(value))

function parseSection(raw: unknown): NotificationContentSection | null {
  if (!isObject(raw)) return null
  const section: NotificationContentSection = { title: cell(raw.title) }
  if ((SECTION_TONES as readonly unknown[]).includes(raw.tone)) section.tone = raw.tone as NotificationContentSection['tone']
  if (Array.isArray(raw.rows)) {
    section.rows = raw.rows.filter(isObject).map(row => {
      const item: NonNullable<NotificationContentSection['rows']>[number] = { label: cell(row.label), value: cell(row.value) }
      if ((ROW_TONES as readonly unknown[]).includes(row.tone)) item.tone = row.tone as typeof item.tone
      return item
    })
  }
  if (isObject(raw.table) && Array.isArray(raw.table.columns) && Array.isArray(raw.table.rows)) {
    section.table = {
      columns: raw.table.columns.map(cell),
      rows: raw.table.rows.filter(Array.isArray).map(row => (row as unknown[]).map(cell))
    }
  }
  const note = text(raw.note)
  if (note) section.note = note
  return section
}

const CONTENT_KINDS: readonly NotificationContent['kind'][] = ['campaign', 'account', 'report', 'data_group', 'test', 'verify_email']

function parseContent(raw: unknown): NotificationContent | null {
  if (!isObject(raw)) return null
  return {
    kind: (CONTENT_KINDS as readonly unknown[]).includes(raw.kind) ? raw.kind as NotificationContent['kind'] : 'test',
    headline: cell(raw.headline),
    countedAt: text(raw.countedAt),
    sections: Array.isArray(raw.sections) ? raw.sections.map(parseSection).filter((item): item is NotificationContentSection => item !== null) : []
  }
}

const DELIVERY_STATUSES: readonly NotificationDeliverySummary['status'][] = ['pending', 'sending', 'retrying', 'sent', 'failed', 'skipped', 'cancelled']

function parseDelivery(raw: unknown): NotificationDeliverySummary | null {
  if (!isObject(raw) || (raw.channel !== 'email' && raw.channel !== 'push')) return null
  return {
    channel: raw.channel,
    status: (DELIVERY_STATUSES as readonly unknown[]).includes(raw.status) ? raw.status as NotificationDeliverySummary['status'] : 'pending',
    sentAt: text(raw.sentAt),
    attempts: Math.max(0, integer(raw.attempts) ?? 0),
    errorCode: text(raw.errorCode),
    destination: text(raw.destination) ?? ''
  }
}

export function parseNotificationDetail(raw: unknown): NotificationDetail | null {
  const item = parseListItem(raw)
  if (!item || !isObject(raw)) return null
  return {
    ...item,
    emailSubject: text(raw.emailSubject),
    content: parseContent(raw.content),
    templateVersion: integer(raw.templateVersion),
    suppressedCount: Math.max(0, integer(raw.suppressedCount) ?? 0),
    mergedCount: Math.max(0, integer(raw.mergedCount) ?? 0),
    deliveries: Array.isArray(raw.deliveries) ? raw.deliveries.map(parseDelivery).filter((entry): entry is NotificationDeliverySummary => entry !== null) : []
  }
}

export function parseNotificationReadResult(raw: unknown): NotificationReadResult | null {
  if (!isObject(raw)) return null
  const unreadCount = integer(raw.unreadCount)
  if (unreadCount === null) return null
  return { ok: true, updated: Math.max(0, integer(raw.updated) ?? 0), unreadCount: Math.max(0, unreadCount) }
}

// ---------------------------------------------------------------------------
// Kiểm tra dữ liệu renderer gửi sang main (chỉ cho qua đúng khóa và kiểu đã biết).
// ---------------------------------------------------------------------------

const isPositiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function sanitizeIds(value: unknown): number[] | null | undefined {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > NOTIFICATION_MAX_FILTER_IDS || !value.every(isPositiveId)) return undefined
  return [...value]
}

function sanitizeStrings<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value) || value.length > allowed.length) return undefined
  if (!value.every(item => typeof item === 'string' && (allowed as readonly string[]).includes(item))) return undefined
  return [...value] as T[]
}

function sanitizeBase(value: unknown) {
  if (!isObject(value) || typeof value.enabled !== 'boolean' || typeof value.email !== 'boolean' || typeof value.push !== 'boolean') return null
  const cooldown = value.cooldownMinutes === undefined ? null : value.cooldownMinutes
  if (cooldown !== null && !(typeof cooldown === 'number' && Number.isInteger(cooldown) && cooldown >= 0 && cooldown <= 1440)) return null
  return { row: value, base: { enabled: value.enabled, email: value.email, push: value.push, cooldownMinutes: cooldown as number | null } }
}

/** Trả `null` khi yêu cầu lưu không đúng hợp đồng; server vẫn kiểm tra giá trị lần nữa. */
export function sanitizeSaveNotificationSettingsRequest(input: unknown): SaveNotificationSettingsRequest | null {
  if (!isObject(input) || typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0) return null
  const request: SaveNotificationSettingsRequest = { revision: input.revision }
  if (input.channels !== undefined) {
    if (!isObject(input.channels)) return null
    const channels: NonNullable<SaveNotificationSettingsRequest['channels']> = {}
    const { email, push } = input.channels
    if (email !== undefined) {
      if (!isObject(email)) return null
      const next: { enabled?: boolean; recipients?: string[] } = {}
      if (email.enabled !== undefined) {
        if (typeof email.enabled !== 'boolean') return null
        next.enabled = email.enabled
      }
      if (email.recipients !== undefined) {
        if (!Array.isArray(email.recipients) || email.recipients.length > NOTIFICATION_MAX_EMAILS
          || !email.recipients.every(item => typeof item === 'string' && item.length <= 254)) return null
        next.recipients = [...email.recipients] as string[]
      }
      channels.email = next
    }
    if (push !== undefined) {
      if (!isObject(push)) return null
      if (push.enabled !== undefined && typeof push.enabled !== 'boolean') return null
      channels.push = push.enabled === undefined ? {} : { enabled: push.enabled as boolean }
    }
    request.channels = channels
  }
  if (input.subscriptions !== undefined) {
    if (!isObject(input.subscriptions)) return null
    const subscriptions: NonNullable<SaveNotificationSettingsRequest['subscriptions']> = {}
    const { campaignStatus, accountStatus, scheduledReport, dataGroupMembership } = input.subscriptions
    if (campaignStatus !== undefined) {
      const parsed = sanitizeBase(campaignStatus)
      const toStatuses = parsed && sanitizeStrings(parsed.row.toStatuses, NOTIFICATION_CAMPAIGN_STATUSES)
      const campaignIds = parsed && sanitizeIds(parsed.row.campaignIds)
      if (!parsed || !toStatuses || campaignIds === undefined) return null
      subscriptions.campaignStatus = { ...parsed.base, toStatuses, campaignIds }
    }
    if (accountStatus !== undefined) {
      const parsed = sanitizeBase(accountStatus)
      const loginEvents = parsed && sanitizeStrings(parsed.row.loginEvents, NOTIFICATION_LOGIN_EVENTS)
      const runStatuses = parsed && sanitizeStrings(parsed.row.runStatuses, NOTIFICATION_ACCOUNT_RUN_STATUSES)
      const accountIds = parsed && sanitizeIds(parsed.row.accountIds)
      if (!parsed || !loginEvents || !runStatuses || accountIds === undefined) return null
      subscriptions.accountStatus = { ...parsed.base, loginEvents, runStatuses, accountIds }
    }
    if (scheduledReport !== undefined) {
      const parsed = sanitizeBase(scheduledReport)
      if (!parsed) return null
      const { weekDays, times, skipWhenIdle } = parsed.row
      if (!Array.isArray(weekDays) || weekDays.length > 7 || !weekDays.every(day => typeof day === 'number' && NOTIFICATION_WEEK_DAYS.includes(day))) return null
      if (!Array.isArray(times) || times.length > NOTIFICATION_MAX_REPORT_TIMES || !times.every(time => typeof time === 'string' && time.length <= 5)) return null
      if (typeof skipWhenIdle !== 'boolean') return null
      subscriptions.scheduledReport = { ...parsed.base, weekDays: [...weekDays] as number[], times: [...times] as string[], skipWhenIdle }
    }
    if (dataGroupMembership !== undefined) {
      const parsed = sanitizeBase(dataGroupMembership)
      const actions = parsed && sanitizeStrings(parsed.row.actions, NOTIFICATION_GROUP_ACTIONS)
      const groupIds = parsed && sanitizeIds(parsed.row.groupIds)
      if (!parsed || !actions || groupIds === undefined) return null
      const { bucketMinutes, includeSharedGroups } = parsed.row
      if (typeof bucketMinutes !== 'number' || !NOTIFICATION_BUCKET_MINUTES.includes(bucketMinutes) || typeof includeSharedGroups !== 'boolean') return null
      subscriptions.dataGroupMembership = { ...parsed.base, groupIds, actions, bucketMinutes, includeSharedGroups }
    }
    request.subscriptions = subscriptions
  }
  return request
}

/** Bỏ khóa lạ/sai kiểu (giống API WebApp), không báo lỗi. */
export function sanitizeNotificationListQuery(input: unknown): NotificationListQuery {
  const query: NotificationListQuery = {}
  if (!isObject(input)) return query
  if (typeof input.limit === 'number' && Number.isSafeInteger(input.limit) && input.limit > 0) query.limit = Math.min(input.limit, 50)
  if (typeof input.type === 'string' && (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(input.type)) query.type = input.type as NotificationEventType
  if (input.unreadOnly === true) query.unreadOnly = true
  if (isObject(input.cursor) && typeof input.cursor.createdAt === 'string' && !Number.isNaN(Date.parse(input.cursor.createdAt))
    && isPositiveId(input.cursor.id)) {
    query.cursor = { createdAt: input.cursor.createdAt, id: input.cursor.id }
  }
  return query
}

export function sanitizeNotificationReadRequest(input: unknown): NotificationReadRequest | null {
  if (!isObject(input)) return null
  if (Array.isArray(input.ids) && input.ids.length > 0 && input.ids.length <= NOTIFICATION_MAX_FILTER_IDS && input.ids.every(isPositiveId)) {
    return { ids: [...input.ids] }
  }
  if (input.ids === undefined && isPositiveId(input.upToId)) {
    if (input.type === undefined || input.type === null) return { upToId: input.upToId }
    if (typeof input.type === 'string' && (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(input.type)) {
      return { upToId: input.upToId, type: input.type as NotificationEventType }
    }
  }
  return null
}
