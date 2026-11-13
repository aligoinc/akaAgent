/**
 * Đồng bộ trạng thái tin nhắn Zalo cho tài khoản KHÔNG có akaChat: đã nhận, đã xem, đã tương tác, đã phản hồi.
 *
 * Hợp đồng dùng chung cho mọi runtime (App Server, Desktop, runtime Chat) và cho Web. File này không import gì và
 * không bao giờ gọi API Zalo, để bản sao ở các repo khác giữ được giống hệt.
 *
 * Độc lập với `zaloCampaignEngagement.ts` (cơ chế theo dõi tương tác V339): khoá cấu hình riêng
 * (`zalo.message_status_sync.*`), dấu tham chiếu riêng trong kết quả gửi (`zaloStatusRef`) và bảng riêng trong DB.
 * Ngoài mốc thời gian, DB còn đưa bậc đã đạt vào trạng thái phụ của kết quả chiến dịch qua các bảng quản lý trạng thái
 * của hệ thống (`auto_status`, `auto_status_event_rules`; xem `updateResultStatus`, `messageStatusResultEventKind`);
 * runtime không tham gia việc đó.
 * Phương án: docs/ZALO_MESSAGE_STATUS_SYNC_PLAN.md. Phần đã làm: docs/ZALO_MESSAGE_STATUS_SYNC.md.
 */

// ---------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------

export const MESSAGE_STATUS_SYNC_PREFIX = 'zalo.message_status_sync.'

export const MESSAGE_STATUS_SYNC_SETTING_NAMES = [
  'enabled', 'capture_enabled', 'reconcile_enabled', 'organization_ids', 'realtime_kinds', 'keep_raw_events',
  'reply_window_days', 'reply_ignored_kinds', 'seen_match_mode', 'track_friend_accept', 'reconcile_window',
  'reconcile_every_minutes', 'retention_days', 'flush_interval_seconds', 'flush_max_rows', 'max_events_per_day',
  'update_result_status', 'result_status_max_per_minute'
] as const

export type MessageStatusSyncSettingName = (typeof MESSAGE_STATUS_SYNC_SETTING_NAMES)[number]

export const MESSAGE_STATUS_SYNC_KEYS: readonly string[] = MESSAGE_STATUS_SYNC_SETTING_NAMES.map(name => MESSAGE_STATUS_SYNC_PREFIX + name)

/** Công tắc tổng: `auto_system_settings` key này, value `true` | `false`. Thiếu dòng hoặc sai định dạng = tắt. */
export const MESSAGE_STATUS_SYNC_ENABLED_KEY = MESSAGE_STATUS_SYNC_PREFIX + 'enabled'

export type MessageStatusEventKind = 'delivered' | 'seen' | 'reaction' | 'reply' | 'friend'
export const MESSAGE_STATUS_EVENT_KINDS: readonly MessageStatusEventKind[] = ['delivered', 'seen', 'reaction', 'reply', 'friend']

/** Loại tin đến dùng để quyết định có tính là "đã phản hồi" hay không. */
export type MessageStatusReplyKind = 'message' | 'sticker' | 'call' | 'ecard' | 'system'
export const MESSAGE_STATUS_REPLY_KINDS: readonly MessageStatusReplyKind[] = ['message', 'sticker', 'call', 'ecard', 'system']

export interface MessageStatusSyncConfig {
  /** Công tắc tổng. Tắt: runtime không thu, không ghi dấu tham chiếu, job thoát ngay. */
  enabled: boolean
  captureEnabled: boolean
  reconcileEnabled: boolean
  /** null = mọi tổ chức; mảng rỗng = không tổ chức nào. */
  organizationIds: number[] | null
  /** Loại sự kiện được khớp ngay khi DB nhận lô. Rỗng = chỉ lưu, chờ job đối soát. */
  realtimeKinds: MessageStatusEventKind[]
  /** Giữ bản thô của mọi sự kiện trong `retentionDays` để kiểm quy tắc và chạy lại. */
  keepRawEvents: boolean
  /** Số ngày tính "đã phản hồi" kể từ giờ gửi. Đã nhận / đã xem / đã tương tác không có hạn. */
  replyWindowDays: number
  /** Loại tin đến KHÔNG tính là phản hồi. Mặc định chỉ loại thông báo do Zalo tự sinh. */
  replyIgnoredKinds: MessageStatusReplyKind[]
  /** `message`: khớp đúng mã tin. `thread`: biên nhận đã xem tính cho mọi tin gửi trước đó trong hội thoại. */
  seenMatchMode: 'message' | 'thread'
  trackFriendAccept: boolean
  /** Khung giờ Việt Nam cho job phụ (khớp lại, dọn dẹp), tính bằng phút trong ngày; `endMinute` có thể là 1440. */
  reconcileWindow: { startMinute: number; endMinute: number }
  reconcileEveryMinutes: number
  retentionDays: number
  flushIntervalSeconds: number
  flushMaxRows: number
  maxEventsPerDay: number
  /**
   * Đưa bậc cao nhất đã đạt vào trạng thái phụ của kết quả chiến dịch (`auto_campaign_details.sub_status_id`), bằng chính cơ
   * chế của email "đã mở / đã click" và SMS "đã nhận": bảng quy tắc `auto_status_event_rules` và hàm
   * `aka_agent_engine_apply_status_event_v1`. DB làm việc này mỗi phút; runtime không phải làm gì thêm.
   * Bậc nào ứng với trạng thái nào do bảng quy tắc quyết định (xem `messageStatusResultEventKind`), không nằm trong cấu hình.
   */
  updateResultStatus: boolean
  /** Trần số kết quả chiến dịch được ghi cột trạng thái mỗi phút. 0 = tạm ngừng ghi, vẫn xếp hàng. */
  resultStatusMaxPerMinute: number
}

/**
 * Loại sự kiện của một bậc trong bảng quy tắc trạng thái `auto_status_event_rules` (cột `event_kind`): `zalo.delivered`,
 * `zalo.seen`, `zalo.reaction`, `zalo.reply`, `zalo.friend`. Bậc chưa có quy tắc đang bật thì không được đưa vào cột trạng thái.
 */
export function messageStatusResultEventKind(kind: MessageStatusEventKind): string {
  return `zalo.${kind}`
}

export const DEFAULT_MESSAGE_STATUS_SYNC_CONFIG: MessageStatusSyncConfig = {
  enabled: false,
  captureEnabled: true,
  reconcileEnabled: true,
  organizationIds: null,
  realtimeKinds: ['delivered', 'seen', 'reaction', 'reply', 'friend'],
  keepRawEvents: true,
  replyWindowDays: 7,
  replyIgnoredKinds: ['ecard', 'system'],
  seenMatchMode: 'message',
  trackFriendAccept: false,
  reconcileWindow: { startMinute: 120, endMinute: 360 },
  reconcileEveryMinutes: 5,
  retentionDays: 4,
  flushIntervalSeconds: 60,
  flushMaxRows: 500,
  maxEventsPerDay: 1_000_000,
  updateResultStatus: true,
  resultStatusMaxPerMinute: 600
}

export interface MessageStatusSyncSettingRow {
  key: string
  value: unknown
  is_active?: boolean | null
  is_secret?: boolean | null
}

const settingText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined

function settingBoolean(value: unknown, fallback: boolean): boolean {
  const text = settingText(value)?.toLowerCase()
  return text === 'true' ? true : text === 'false' ? false : fallback
}

function settingInteger(value: unknown, fallback: number, min: number, max: number): number {
  const text = settingText(value) ?? ''
  const parsed = /^\d{1,9}$/.test(text) ? Number(text) : NaN
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function settingList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(item => settingText(item) ?? '').filter(Boolean)
  const text = settingText(value)
  if (text === undefined) return undefined
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text)
      return Array.isArray(parsed) ? parsed.map(item => settingText(item) ?? '').filter(Boolean) : []
    } catch { return [] }
  }
  return text.split(',').map(item => item.trim()).filter(Boolean)
}

/** `all` hoặc thiếu dòng = mọi tổ chức; danh sách id (JSON hoặc cách nhau bằng dấu phẩy); sai định dạng = không ai. */
function settingOrganizationIds(value: unknown, fallback: number[] | null): number[] | null {
  if (value === undefined) return fallback
  if (value === null) return null
  const text = settingText(value)
  if (text !== undefined && (text === '' || text.toLowerCase() === 'all' || text.toLowerCase() === 'null')) return null
  const items = settingList(value)
  if (!items) return []
  const ids = items.map(item => /^\d{1,15}$/.test(item) ? Number(item) : NaN)
  return ids.some(id => !Number.isSafeInteger(id) || id <= 0) ? [] : Array.from(new Set(ids))
}

/** `HH:MM-HH:MM` theo giờ Việt Nam. Bắt đầu lớn hơn kết thúc là khung vắt qua nửa đêm. */
export function parseReconcileWindow(value: unknown): { startMinute: number; endMinute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(settingText(value) ?? '')
  if (!match) return undefined
  const [startHour, startMinutes, endHour, endMinutes] = match.slice(1).map(Number) as [number, number, number, number]
  const startMinute = startHour * 60 + startMinutes
  const endMinute = endHour * 60 + endMinutes
  if (startMinutes > 59 || endMinutes > 59 || startMinute > 1439 || endMinute > 1440 || startMinute === endMinute) return undefined
  return { startMinute, endMinute }
}

/** Dòng không hoạt động hoặc đánh dấu bí mật bị bỏ qua; giá trị thiếu hoặc sai dùng mặc định. */
export function parseMessageStatusSyncConfig(rows: readonly MessageStatusSyncSettingRow[]): MessageStatusSyncConfig {
  const byKey = new Map(rows.filter(row => row.is_active !== false && row.is_secret !== true).map(row => [row.key, row.value]))
  const value = (name: MessageStatusSyncSettingName): unknown => byKey.get(MESSAGE_STATUS_SYNC_PREFIX + name)
  const defaults = DEFAULT_MESSAGE_STATUS_SYNC_CONFIG
  const kinds = settingList(value('realtime_kinds'))
  const ignored = settingList(value('reply_ignored_kinds'))
  const seenMode = settingText(value('seen_match_mode'))?.toLowerCase()
  return {
    enabled: settingBoolean(value('enabled'), false),
    captureEnabled: settingBoolean(value('capture_enabled'), defaults.captureEnabled),
    reconcileEnabled: settingBoolean(value('reconcile_enabled'), defaults.reconcileEnabled),
    organizationIds: settingOrganizationIds(value('organization_ids'), defaults.organizationIds),
    realtimeKinds: kinds
      ? MESSAGE_STATUS_EVENT_KINDS.filter(kind => kinds.includes(kind))
      : [...defaults.realtimeKinds],
    keepRawEvents: settingBoolean(value('keep_raw_events'), defaults.keepRawEvents),
    replyWindowDays: settingInteger(value('reply_window_days'), defaults.replyWindowDays, 1, 30),
    replyIgnoredKinds: ignored
      ? MESSAGE_STATUS_REPLY_KINDS.filter(kind => ignored.includes(kind))
      : [...defaults.replyIgnoredKinds],
    seenMatchMode: seenMode === 'thread' ? 'thread' : 'message',
    trackFriendAccept: settingBoolean(value('track_friend_accept'), defaults.trackFriendAccept),
    reconcileWindow: parseReconcileWindow(value('reconcile_window')) ?? { ...defaults.reconcileWindow },
    reconcileEveryMinutes: settingInteger(value('reconcile_every_minutes'), defaults.reconcileEveryMinutes, 5, 1440),
    retentionDays: settingInteger(value('retention_days'), defaults.retentionDays, 1, 30),
    flushIntervalSeconds: settingInteger(value('flush_interval_seconds'), defaults.flushIntervalSeconds, 30, 600),
    flushMaxRows: settingInteger(value('flush_max_rows'), defaults.flushMaxRows, 50, 2000),
    maxEventsPerDay: settingInteger(value('max_events_per_day'), defaults.maxEventsPerDay, 1000, 50_000_000),
    updateResultStatus: settingBoolean(value('update_result_status'), defaults.updateResultStatus),
    resultStatusMaxPerMinute: settingInteger(value('result_status_max_per_minute'), defaults.resultStatusMaxPerMinute, 0, 6000)
  }
}

/** Việt Nam không đổi giờ mùa: UTC+7 quanh năm. */
export function vietnamMinuteOfDay(at: Date): number {
  return ((at.getUTCHours() * 60 + at.getUTCMinutes() + 7 * 60) % 1440 + 1440) % 1440
}

export function isWithinReconcileWindow(window: { startMinute: number; endMinute: number }, at: Date): boolean {
  const minute = vietnamMinuteOfDay(at)
  return window.startMinute < window.endMinute
    ? minute >= window.startMinute && minute < window.endMinute
    : minute >= window.startMinute || minute < window.endMinute
}

/** Tài khoản thuộc phạm vi cấu hình (chưa xét akaChat; phần đó do DB quyết định). */
export function messageStatusSyncCoversOrganization(config: Pick<MessageStatusSyncConfig, 'enabled' | 'organizationIds'>, organizationId: number | string | null | undefined): boolean {
  if (!config.enabled) return false
  if (config.organizationIds === null) return true
  const id = Number(organizationId)
  return Number.isSafeInteger(id) && config.organizationIds.includes(id)
}

// ---------------------------------------------------------------------------
// Dấu tham chiếu ghi kèm kết quả gửi
// ---------------------------------------------------------------------------

/** Khoá trong `auto_campaign_details.data`. Trigger trong DB đọc khoá này để đăng ký lượt gửi. */
export const ZALO_STATUS_REF_KEY = 'zaloStatusRef'

export interface ZaloStatusRef {
  v: 1
  /** UID Zalo của tài khoản gửi. */
  a: string
  /** UID Zalo của người nhận. */
  t: string
  /** Giờ gửi (ISO). */
  s: string
  /** Mã tin do Zalo trả về khi gửi; rỗng với lời mời kết bạn. */
  m: string[]
  k: 'message' | 'friend_request'
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const idText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : ''

/** Chỉ đọc các vùng chứa kết quả gửi của SDK, không đọc nội dung tin hay mã phía máy khách. */
export function messageIdsFromSendResult(result: unknown): string[] {
  const out = new Set<string>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6) return
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
    const row = record(value)
    for (const key of ['msgId', 'msgID', 'globalMsgId']) {
      const id = idText(row[key])
      if (id) out.add(id)
    }
    for (const key of ['message', 'attachment', 'response', 'mediaResponse', 'contentResponse', 'data']) {
      if (row[key] !== undefined) visit(row[key], depth + 1)
    }
  }
  visit(result, 0)
  return Array.from(out)
}

/**
 * Dựng dấu tham chiếu từ dữ liệu đang có trong tay lúc gửi xong. Không đọc cấu hình, không chờ IO: nơi gọi tự quyết
 * định có ghi hay không theo cấu hình đã đệm. Trả `undefined` khi thiếu định danh.
 */
export function makeZaloStatusRef(
  ownUid: string | null | undefined,
  targetUid: string | null | undefined,
  kind: ZaloStatusRef['k'],
  sentAt: string,
  sendResults?: unknown
): ZaloStatusRef | undefined {
  const account = idText(ownUid)
  const target = idText(targetUid)
  const sentMs = Date.parse(sentAt)
  if (!account || !target || account === target || target === '0' || !Number.isFinite(sentMs)) return undefined
  return {
    v: 1, a: account, t: target, s: new Date(sentMs).toISOString(),
    m: kind === 'message' ? messageIdsFromSendResult(sendResults).slice(0, 50) : [], k: kind
  }
}

// ---------------------------------------------------------------------------
// Rút gọn sự kiện Zalo
// ---------------------------------------------------------------------------

export interface MessageStatusEvent {
  /** `auto_accounts.id` của tài khoản đang nghe. */
  accountId: string
  /** UID Zalo của người kia trong hội thoại 1-1. */
  peerUid: string
  kind: MessageStatusEventKind
  /** Giờ sự kiện (ISO). Tin đến và cảm xúc: giờ Zalo ghi trên sự kiện. Biên nhận đã nhận / đã xem: giờ runtime nhận. */
  eventAt: string
  /** Mã tin được nhận / xem / thả cảm xúc; với `reply` là mã của chính tin đến; với `friend` là rỗng. */
  refMsgId: string
}

const CALL_ACTIONS = new Set(['recommened.calltime', 'recommened.misscall', 'recommened.calling', 'recommened.receivecall'])
/** Xoá hoặc thu hồi một tin cũ cũng tới dưới dạng sự kiện `message`; đó là thao tác, không phải tin trả lời. */
const MESSAGE_ACTION_TYPES = new Set(['chat.delete', 'chat.undo'])

/** Cùng cách phân loại với bộ chuẩn hoá của Chat cho ba loại không phải nội dung khách tự gõ. */
export function messageStatusReplyKind(msgType: unknown, content: unknown): MessageStatusReplyKind {
  const type = typeof msgType === 'string' ? msgType.trim().toLowerCase() : ''
  const body = record(content)
  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
  if (type === 'webchat' && action === 'msginfo.actionlist') return 'system'
  if (type === 'chat.ecard') return 'ecard'
  if (type === 'chat.recommended' && CALL_ACTIONS.has(action)) return 'call'
  if (type === 'chat.sticker') return 'sticker'
  return 'message'
}

/** Zalo trả mốc thời gian bằng mili giây; số nhỏ hơn 1e11 (mili giây thì là trước năm 1973) được hiểu là giây. */
function eventTime(value: unknown, receivedAt: string): string {
  if (value === undefined || value === null || value === '') return receivedAt
  const n = Number(value)
  const ms = Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : Date.parse(String(value))
  const date = new Date(ms)
  return Number.isFinite(date.getTime()) && ms > 0 ? date.toISOString() : receivedAt
}

const isUserThread = (row: Record<string, unknown>): boolean => row.type === 0 || row.type === 'user'

export interface NormalizeMessageStatusOptions {
  replyIgnoredKinds?: readonly MessageStatusReplyKind[]
  trackFriendAccept?: boolean
}

/**
 * Một sự kiện của bộ nghe Zalo (đã được thư viện giải mã) thành các bản ghi gọn. Chỉ giữ hội thoại 1-1 và năm loại
 * cần cho trạng thái tin nhắn; tin nhóm, tin tự gửi, "đang gõ", gỡ cảm xúc... trả mảng rỗng. Không mang nội dung tin.
 */
export function normalizeMessageStatusEvents(
  type: string,
  payload: unknown,
  accountId: string | number,
  ownUid: string,
  receivedAt: string,
  options: NormalizeMessageStatusOptions = {}
): MessageStatusEvent[] {
  const account = idText(accountId)
  const own = idText(ownUid)
  if (!account || !own) return []
  if ((type === 'seen_messages' || type === 'delivered_messages') && Array.isArray(payload)) {
    return payload.flatMap(item => normalizeMessageStatusEvents(type, item, account, own, receivedAt, options))
  }
  const row = record(payload)
  const data = record(row.data)
  if (row.isSelf === true || row.isGroup === true) return []
  const valid = (peer: string): boolean => !!peer && peer !== own && peer !== '0'
  const event = (kind: MessageStatusEventKind, peerUid: string, at: unknown, refMsgId: string): MessageStatusEvent =>
    ({ accountId: account, peerUid, kind, eventAt: eventTime(at, receivedAt), refMsgId })

  if (type === 'message') {
    if (!isUserThread(row)) return []
    const peer = idText(data.uidFrom)
    const to = idText(data.idTo)
    if (!valid(peer) || (to && to !== own)) return []
    if (MESSAGE_ACTION_TYPES.has(typeof data.msgType === 'string' ? data.msgType.trim().toLowerCase() : '')) return []
    const ignored = options.replyIgnoredKinds ?? DEFAULT_MESSAGE_STATUS_SYNC_CONFIG.replyIgnoredKinds
    if (ignored.includes(messageStatusReplyKind(data.msgType, data.content))) return []
    const at = eventTime(data.ts, receivedAt)
    return [{ accountId: account, peerUid: peer, kind: 'reply', eventAt: at, refMsgId: idText(data.msgId) || idText(data.cliMsgId) || `t${Date.parse(at)}` }]
  }

  if (type === 'reaction') {
    if (row.isGroup !== false) return []
    const peer = idText(data.uidFrom)
    const content = record(data.content)
    if (!valid(peer) || !content.rIcon || content.rType === -1) return []
    const targets = Array.isArray(content.rMsg) ? content.rMsg.map(item => idText(record(item).gMsgID)).filter(Boolean) : []
    return Array.from(new Set(targets)).map(target => event('reaction', peer, data.ts, target))
  }

  if (type === 'seen_messages' || type === 'delivered_messages') {
    if (!isUserThread(row)) return []
    const peer = idText(row.threadId) || idText(data.idTo)
    const messageId = idText(data.msgId)
    if (!valid(peer) || !messageId) return []
    // Giờ của biên nhận là giờ runtime nhận được nó. Trường `mSTs` đi kèm chưa xác định được là giờ đổi trạng thái hay
    // giờ của chính tin nhắn; cơ chế theo dõi tương tác cũ và bảng biên nhận của Chat cũng dùng giờ nhận.
    if (type === 'seen_messages') {
      const seenBy = idText(data.idTo)
      return seenBy && seenBy !== peer ? [] : [event('seen', peer, undefined, messageId)]
    }
    const uids = (value: unknown): string[] => Array.isArray(value) ? value.map(idText) : []
    return [
      ...(uids(data.deliveredUids).includes(peer) ? [event('delivered', peer, undefined, messageId)] : []),
      ...(uids(data.seenUids).includes(peer) ? [event('seen', peer, undefined, messageId)] : [])
    ]
  }

  if (type === 'friend_event') {
    // Loại 0 là "thêm bạn". Thư viện không cho biết ai là người đồng ý, nên DB chỉ khớp với lời mời do chiến dịch gửi.
    if (!options.trackFriendAccept || row.type !== 0) return []
    const peer = idText(row.data) || idText(row.threadId)
    return valid(peer) ? [event('friend', peer, row.ts, '')] : []
  }

  return []
}

// ---------------------------------------------------------------------------
// Ghi theo lô xuống DB
// ---------------------------------------------------------------------------

/** Hàm DB nhận một lô sự kiện (`p_source`, `p_events`); chỉ `service_role` và vai trò backend được gọi. */
export const MESSAGE_STATUS_INGEST_RPC = 'aka_agent_ingest_zalo_message_status'

/**
 * Hàm DB nhận lô của app Desktop, chỉ một tham số `p_events`. App Desktop chạy trên máy của khách nên không được gọi hàm ở
 * trên: hàm này lấy nhân viên từ phiên đăng nhập, chỉ nhận sự kiện của tài khoản do nhân viên đó phụ trách (tài khoản khác
 * trả về trong `rejectedAccountIds`) và có trần sự kiện theo nhân viên mỗi ngày (chạm trần: `enabled = false`, `paused = true`).
 * Kết quả cùng dạng với hàm chung.
 */
export const MESSAGE_STATUS_DESKTOP_INGEST_RPC = 'aka_agent_desktop_ingest_zalo_message_status'

/** Dạng nén gửi cho hàm DB: a = tài khoản, p = người kia, k = loại, t = giờ sự kiện, m = mã tin tham chiếu. */
export interface MessageStatusIngestItem { a: string; p: string; k: MessageStatusEventKind; t: string; m: string }

export const toMessageStatusIngestItems = (events: readonly MessageStatusEvent[]): MessageStatusIngestItem[] =>
  events.map(event => ({ a: event.accountId, p: event.peerUid, k: event.kind, t: event.eventAt, m: event.refMsgId }))

/** Phản hồi của hàm nhận lô. Runtime dùng nó thay cho một lượt đọc cấu hình riêng. */
export interface MessageStatusIngestResult {
  /** false: tính năng đang tắt hoặc tạm ngừng nhận; runtime ngừng thu và hỏi lại ở lượt ghi sau. */
  enabled: boolean
  /** DB tạm ngừng nhận (job lỗi liên tiếp hoặc chạm trần sự kiện trong ngày). Không phải lỗi của runtime. */
  paused: boolean
  accepted: number
  matched: number
  stored: number
  /** Tài khoản bị từ chối (có akaChat, ngoài phạm vi, không tồn tại): runtime ngừng thu cho các tài khoản này. */
  rejectedAccountIds: string[]
  flushIntervalSeconds: number
  flushMaxRows: number
  trackFriendAccept: boolean
  replyIgnoredKinds: MessageStatusReplyKind[]
}

export function parseMessageStatusIngestResult(value: unknown): MessageStatusIngestResult {
  const row = record(value)
  const defaults = DEFAULT_MESSAGE_STATUS_SYNC_CONFIG
  const count = (input: unknown): number => typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? input : 0
  const bounded = (input: unknown, fallback: number, min: number, max: number): number =>
    typeof input === 'number' && Number.isInteger(input) && input >= min && input <= max ? input : fallback
  const ignored = Array.isArray(row.replyIgnoredKinds) ? row.replyIgnoredKinds : undefined
  return {
    enabled: row.enabled === true,
    paused: row.paused === true,
    accepted: count(row.accepted), matched: count(row.matched), stored: count(row.stored),
    rejectedAccountIds: Array.isArray(row.rejectedAccountIds) ? row.rejectedAccountIds.map(idText).filter(Boolean) : [],
    flushIntervalSeconds: bounded(row.flushIntervalSeconds, defaults.flushIntervalSeconds, 30, 600),
    flushMaxRows: bounded(row.flushMaxRows, defaults.flushMaxRows, 50, 2000),
    trackFriendAccept: row.trackFriendAccept === true,
    replyIgnoredKinds: ignored
      ? MESSAGE_STATUS_REPLY_KINDS.filter(kind => ignored.includes(kind))
      : [...defaults.replyIgnoredKinds]
  }
}

const eventKey = (event: MessageStatusEvent): string => JSON.stringify([event.accountId, event.peerUid, event.kind, event.refMsgId])

/**
 * Bộ đệm trong RAM của runtime giữa hai lần ghi lô. Có trần: đầy thì bỏ sự kiện mới và đếm, không bao giờ chặn luồng
 * nhận tin. Mất bộ đệm khi tiến trình dừng là chấp nhận được ("cố gắng hết mức").
 */
export class MessageStatusEventBuffer {
  private readonly events = new Map<string, MessageStatusEvent>()
  private readonly blockedAccounts = new Map<string, number>()
  dropped = 0

  constructor(readonly maxRows = 5000, private readonly now: () => number = Date.now) {}

  get size(): number { return this.events.size }

  /** Tài khoản bị DB từ chối không được thu lại cho tới `untilMs`. */
  blockAccounts(accountIds: readonly string[], untilMs: number): void {
    for (const id of accountIds) this.blockedAccounts.set(id, untilMs)
    // forEach thay cho for...of trên Map: bản chép ở akaAgent còn được biên dịch với đích cũ của phần giao diện.
    this.events.forEach((event, key) => { if (accountIds.includes(event.accountId)) this.events.delete(key) })
  }

  isBlocked(accountId: string): boolean {
    const until = this.blockedAccounts.get(accountId)
    if (until === undefined) return false
    if (until > this.now()) return true
    this.blockedAccounts.delete(accountId)
    return false
  }

  push(events: readonly MessageStatusEvent[]): void {
    for (const event of events) {
      if (this.isBlocked(event.accountId)) continue
      const key = eventKey(event)
      const existing = this.events.get(key)
      if (existing) {
        // Cùng một mốc: giữ giờ sớm nhất.
        if (Date.parse(event.eventAt) < Date.parse(existing.eventAt)) this.events.set(key, event)
        continue
      }
      if (this.events.size >= this.maxRows) { this.dropped += 1; continue }
      this.events.set(key, event)
    }
  }

  /** Lấy tối đa `maxRows` sự kiện cũ nhất ra khỏi bộ đệm để ghi một lô. */
  take(maxRows: number): MessageStatusEvent[] {
    const out: MessageStatusEvent[] = []
    this.events.forEach((event, key) => {
      if (out.length >= maxRows) return
      out.push(event)
      this.events.delete(key)
    })
    return out
  }

  clear(): void { this.events.clear(); this.blockedAccounts.clear(); this.dropped = 0 }
}
