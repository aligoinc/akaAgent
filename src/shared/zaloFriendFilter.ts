/**
 * Lọc bạn bè Zalo của MỘT tài khoản theo một bộ lọc JSON có phiên bản (`ZaloFriendFilter`).
 * Phương án: docs/DATA_GROUP_FRIEND_AGENT_PLAN.md (mục 3). Hướng dẫn và kiểm chứng: docs/DATA_GROUP_FRIEND_AGENT.md.
 *
 * Một hợp đồng cho ba nơi: AI của "Thêm nhóm bằng Agent" trả đúng cấu trúc này (Structured Outputs, không có `accountId`),
 * API `POST /data/zalo-friends/filter` nhận nó làm body, và hàm DB `aka_agent_read_zalo_friend_filter_v1` đánh giá nó.
 * Mọi khóa luôn có mặt; khóa không dùng để `null` hoặc mảng rỗng (đúng yêu cầu của Structured Outputs strict).
 *
 * Kiểm hợp lệ ba lớp: schema strict của model, `parseZaloFriendFilter` ở đây (API dùng cho mọi lượt gọi) và hàm DB.
 * Luật đánh giá (bạn bè là ai, lượt nhắn nào được tính, bậc của một lượt tin) nằm trong hàm DB; tệp này chỉ giữ giới
 * hạn, kiểu, chuẩn hóa, tóm tắt tiếng Việt và cách hiểu khoảng thời gian theo lịch Việt Nam.
 *
 * Hợp đồng dùng chung Web/API/Desktop/iOS: sửa ở đây trước rồi chép nguyên văn sang nơi khác (Desktop: akaAgent
 * src/shared/zaloFriendFilter.ts). Không import gì. Kiểm kiểu renderer Desktop không bật downlevelIteration: đừng trải
 * Set/Map bằng `...` hay lặp chúng bằng for…of, dùng Array.from.
 */

export const ZALO_FRIEND_FILTER_VERSION = 1 as const
export const ZALO_FRIEND_FILTER_SOURCE = 'zalo_friends' as const
export const ZALO_FRIEND_FILTER_TIME_ZONE = 'Asia/Ho_Chi_Minh'
export const ZALO_FRIEND_FILTER_READ_RPC = 'aka_agent_read_zalo_friend_filter_v1'
export const ZALO_FRIEND_FILTER_CREATE_RPC = 'aka_agent_create_data_group_from_friend_filter_v1'
export const ZALO_FRIEND_FILTER_ACCOUNTS_RPC = 'aka_agent_list_zalo_friend_accounts_v1'
export const ZALO_FRIEND_FILTER_GROUP_RPC = 'aka_agent_get_data_group_friend_filter_v1'
/** Nguồn của khách hàng do Agent nạp vào nhóm (cột "Nguồn khách hàng chính"). */
export const ZALO_FRIEND_FILTER_SOURCE_NAME = 'Agent lọc bạn bè'

export const ZALO_FRIEND_FILTER_LIMITS = {
  /** Số khối điều kiện (HOẶC/VÀ giữa các khối). 0 khối = mọi bạn bè của tài khoản. */
  groups: 5,
  conditionsPerGroup: 10,
  conditions: 20,
  tagIds: 50,
  tagIdLength: 100,
  groupIds: 20,
  campaignIds: 20,
  /** Khoảng thời gian xét tối đa (ngày, tính cả hôm nay). */
  lookbackDays: 365,
  nextDays: 31,
  sentCount: 1000,
  nameText: 100,
  seed: 64,
  /** "Lấy N người" và số mã liên hệ mà mode `ids` trả về. */
  resultLimit: 5000,
  pageLimit: 100,
  pageOffset: 5000,
  requestBytes: 64 * 1024,
  /** Mỗi lượt lọc đọc tối đa từng này lượt nhắn của tài khoản; vượt thì báo số ngày tối đa thay vì trả kết quả thiếu. */
  messagesPerRead: 30000,
  summaryLines: 40,
  summaryLineLength: 300,
  groupName: 255
} as const

// ---------------------------------------------------------------------------------------------------------------
// Kiểu dữ liệu

/** Khoảng thời gian theo lịch Việt Nam. Khóa không dùng của từng kiểu để null. */
export interface FriendPeriod {
  /** last_days: N ngày gần nhất (tính cả hôm nay); range: từ ngày tới ngày (tính cả hai ngày); all: 365 ngày gần nhất. */
  type: 'last_days' | 'range' | 'all'
  days: number | null
  from: string | null
  to: string | null
}

/** Bậc của một lượt tin, từ thấp tới cao: sent < delivered < seen < reacted < replied. */
export type MessageStage = 'never_sent' | 'failed' | 'unknown' | 'sent' | 'delivered' | 'seen' | 'reacted' | 'replied'
export const MESSAGE_STAGES: readonly MessageStage[] = ['never_sent', 'failed', 'unknown', 'sent', 'delivered', 'seen', 'reacted', 'replied']

export type FriendSetOp = 'has_any' | 'has_all' | 'has_none' | 'tagged' | 'untagged'
export const FRIEND_SET_OPS: readonly FriendSetOp[] = ['has_any', 'has_all', 'has_none', 'tagged', 'untagged']
export type FriendGender = 'male' | 'female' | 'unknown'
export const FRIEND_GENDERS: readonly FriendGender[] = ['male', 'female', 'unknown']
export type FriendInteractionKind = 'seen' | 'reacted' | 'replied'
export const FRIEND_INTERACTION_KINDS: readonly FriendInteractionKind[] = ['seen', 'reacted', 'replied']
export type FriendMessageStatus = 'sent' | 'failed' | 'seen' | 'reacted' | 'replied'
export const FRIEND_MESSAGE_STATUSES: readonly FriendMessageStatus[] = ['sent', 'failed', 'seen', 'reacted', 'replied']

export type FriendCondition =
  | { field: 'zalo_tag'; op: FriendSetOp; tagIds: string[] }
  | { field: 'akabiz_tag'; op: FriendSetOp; tagIds: number[] }
  | { field: 'gender'; values: FriendGender[] }
  | { field: 'birthday'; op: 'in_months' | 'in_next_days' | 'unknown'; months: number[]; days: number | null }
  | { field: 'phone'; op: 'has' | 'missing' }
  | { field: 'name'; op: 'contains' | 'not_contains' | 'starts_with'; text: string }
  | { field: 'sent_count'; period: FriendPeriod; op: 'eq' | 'gte' | 'lte' | 'between'; value: number; valueTo: number | null }
  | { field: 'latest_message'; op: 'in' | 'not_in'; stages: MessageStage[]; period: FriendPeriod | null }
  | { field: 'messages_in_period'; period: FriendPeriod; quantifier: 'any' | 'none'; status: FriendMessageStatus; amongSent: boolean }
  | { field: 'interaction'; kinds: FriendInteractionKind[]; op: 'within' | 'not_within'; period: FriendPeriod }
  | { field: 'campaign'; op: 'received' | 'not_received'; campaignIds: number[]; period: FriendPeriod | null }
  | { field: 'data_group'; op: 'in' | 'not_in'; groupIds: number[] }

export type FriendConditionField = FriendCondition['field']
export const FRIEND_CONDITION_FIELDS: readonly FriendConditionField[] = [
  'zalo_tag', 'akabiz_tag', 'gender', 'birthday', 'phone', 'name', 'sent_count', 'latest_message', 'messages_in_period',
  'interaction', 'campaign', 'data_group'
]
/** Điều kiện cần lịch sử tin nhắn (đọc thêm bảng kết quả chiến dịch). */
export const FRIEND_MESSAGE_FIELDS: readonly FriendConditionField[] = ['sent_count', 'latest_message', 'messages_in_period', 'interaction', 'campaign']

export interface FriendConditionGroup {
  /** VÀ / HOẶC giữa các điều kiện trong khối. */
  match: 'all' | 'any'
  conditions: FriendCondition[]
}

export interface FriendFilterSort {
  by: 'last_sent_at' | 'last_interaction_at' | 'name' | 'random'
  direction: 'asc' | 'desc'
  /** Chỉ dùng với `random`: cùng seed thì cùng thứ tự (đếm thử và tạo nhóm ra cùng người). */
  seed: string | null
}

export interface ZaloFriendFilter {
  version: 1
  source: 'zalo_friends'
  /** Server gắn theo tài khoản người dùng chọn trên form; AI không có khóa này. */
  accountId: number
  /** VÀ / HOẶC giữa các khối. */
  match: 'all' | 'any'
  groups: FriendConditionGroup[]
  /** Bản đầu luôn true: khách đã xác nhận từ chối nhận tin không bao giờ vào nhóm. */
  excludeOptedOut: boolean
  excludeBlocked: boolean
  sort: FriendFilterSort | null
  /** 1–5.000, chỉ khi người dùng nói "lấy N người". */
  limit: number | null
}

/** Bộ lọc AI trả về (chưa gắn tài khoản). */
export type ZaloFriendFilterDraft = Omit<ZaloFriendFilter, 'accountId'>

export type ZaloFriendFilterMode = 'count' | 'page' | 'ids'

export interface ZaloFriendFilterRequest {
  /** Mã lượt (hủy lượt cũ, bỏ kết quả muộn). */
  requestId: string
  mode: ZaloFriendFilterMode
  filter: ZaloFriendFilter
  /** page: 0–5.000; mode khác: null. */
  offset: number | null
  /** page: 1–100; mode khác: null. */
  limit: number | null
}

export interface ZaloFriendFilterCoverage {
  /** Lần cập nhật danh bạ bạn bè gần nhất của tài khoản. */
  friendsUpdatedAt: string | null
  /** Lượt nhắn sớm nhất có trong khoảng đã xét (null khi bộ lọc không cần lịch sử tin). */
  messagesSince: string | null
  /** Lượt nhắn đầu tiên có theo dõi xem/cảm xúc/phản hồi của tài khoản. */
  trackingSince: string | null
  /** false tới khi có nguồn "đã nhận". */
  deliveredAvailable: boolean
  /** Tin nhắn tay/tin đến của akaChat (giai đoạn sau). */
  chatHistory: boolean
  /**
   * mode page: các cột số lần nhắn/lần nhắn gần nhất của dòng xem trước tính từ mốc này (thường 365 ngày trước; tài khoản gửi
   * quá nhiều tin thì chỉ tính các lượt mới nhất). Mode khác: null.
   */
  factsFrom?: string | null
}

export type ZaloFriendFilterNoteCode = 'untracked_latest' | 'tracking_partial' | 'friends_stale' | 'limit_applied'
  | 'opted_out_removed' | 'blocked_removed'

export interface ZaloFriendFilterNote { code: ZaloFriendFilterNoteCode; count: number }

export interface ZaloFriendFilterRow {
  contactId: number
  name: string | null
  zaloOriginalName: string | null
  uid: string
  phone: string | null
  gender: FriendGender
  zaloTags: Array<{ id: string; name: string }>
  akaBizTagIds: number[]
  /** Lượt nhắn thành công trong 365 ngày gần nhất. */
  sentCount: number
  lastSentAt: string | null
  latestStage: MessageStage
  lastInteractionAt: string | null
}

export interface ZaloFriendFilterResult {
  version: 1
  accountId: number
  /** Tổng bạn bè của tài khoản (trước điều kiện). */
  totalFriends: number
  /** Số người sẽ vào nhóm: sau điều kiện, loại trừ và giới hạn số người. */
  matched: number
  rows: ZaloFriendFilterRow[] | null
  contactIds: number[] | null
  coverage: ZaloFriendFilterCoverage
  notes: ZaloFriendFilterNote[]
  evaluatedAt: string
}

/** Tài khoản Zalo có thể lọc bạn bè (`GET /data/zalo-friends/accounts`). */
export interface ZaloFriendAccount {
  id: number
  name: string
  /** server: Zalo Server; desktop: Zalo Desktop (QR); web: Zalo trình duyệt. */
  kind: 'server' | 'desktop' | 'web'
  /** Gói hiện tại cho dùng loại tài khoản này với nhóm khách hàng. */
  available: boolean
  friendCount: number
  friendsUpdatedAt: string | null
}

export interface CreateDataGroupFromFriendFilterRequest {
  requestId: string
  name: string
  color: string | null
  filter: ZaloFriendFilter
  /** Các dòng tóm tắt người dùng đã xác nhận (lưu kèm nhóm). */
  summary: string[]
}

export interface CreateDataGroupFromFriendFilterResult {
  groupId: number
  filterId: number
  /** Số người khớp lúc tạo (có thể khác số lúc đếm thử nếu dữ liệu vừa đổi). */
  matched: number
  /** Số khách hàng đã vào nhóm. */
  inserted: number
  /** true khi trả lại kết quả của cùng `requestId` đã chạy trước đó. */
  replayed: boolean
}

/** Bộ lọc đã lưu của một nhóm tạo bằng Agent (`GET /data/v2/groups/:groupId/friend-filter`). */
export interface DataGroupFriendFilterInfo {
  groupId: number
  filterId: number
  accountId: number
  filter: ZaloFriendFilter
  summary: string[]
  matchedCount: number
  insertedCount: number
  createdAt: string
  lastRunAt: string
  runCount: number
}

// ---------------------------------------------------------------------------------------------------------------
// Lỗi

export type ZaloFriendFilterErrorCode = 'invalid_friend_filter' | 'friend_filter_catalog_changed' | 'friend_list_empty'
  | 'friend_filter_empty' | 'friend_filter_timeout' | 'friend_filter_unavailable' | 'friend_filter_busy'
  | 'friend_filter_request_conflict' | 'friend_filter_account_unavailable' | 'friend_filter_too_many_messages'
  | 'friend_recipients_too_many'

export const ZALO_FRIEND_FILTER_MESSAGES: Record<ZaloFriendFilterErrorCode, string> = {
  invalid_friend_filter: 'Bộ lọc bạn bè không hợp lệ.',
  friend_filter_catalog_changed: 'Tag, nhóm khách hàng hoặc chiến dịch trong bộ lọc không còn nữa. Hãy mô tả lại hoặc chọn lại.',
  friend_list_empty: 'Tài khoản này chưa có danh bạ bạn bè. Hãy Lấy danh bạ Zalo trước.',
  friend_filter_empty: 'Không có bạn bè nào khớp bộ lọc, nên chưa tạo nhóm.',
  friend_filter_timeout: 'Lọc bạn bè quá thời gian chờ. Hãy thu hẹp khoảng thời gian hoặc bớt điều kiện rồi thử lại.',
  friend_filter_unavailable: 'Chức năng lọc bạn bè đang được cập nhật. Vui lòng thử lại sau.',
  friend_filter_busy: 'Đang có nhiều yêu cầu lọc dữ liệu. Vui lòng thử lại sau ít giây.',
  friend_filter_request_conflict: 'Yêu cầu tạo nhóm bị trùng mã nhưng khác nội dung. Vui lòng bấm Tạo nhóm lại.',
  friend_filter_account_unavailable: 'Không dùng được tài khoản Zalo này để tạo nhóm khách hàng.',
  friend_filter_too_many_messages: 'Tài khoản này gửi rất nhiều tin nhắn nên điều kiện về tin nhắn chưa xét được khoảng thời gian dài như vậy.',
  friend_recipients_too_many: 'Có hơn 5.000 bạn bè khớp, nhiều hơn số người thêm được một lần. Hãy thu hẹp điều kiện hoặc nói với Agent "lấy tối đa N người".'
}

/** Câu báo khi khoảng thời gian về tin nhắn vượt khối lượng đọc được một lượt (`maxDays` từ hàm DB). */
export function friendFilterTooManyMessagesText(maxDays: number | null | undefined): string {
  if (maxDays === null || maxDays === undefined || !Number.isFinite(maxDays)) return ZALO_FRIEND_FILTER_MESSAGES.friend_filter_too_many_messages
  if (maxDays < 1) return 'Tài khoản này gửi rất nhiều tin nhắn mỗi ngày nên chưa lọc được theo lịch sử tin nhắn. Hãy dùng điều kiện khác (tag, giới tính, sinh nhật…).'
  return `Tài khoản này gửi rất nhiều tin nhắn nên điều kiện về tin nhắn chỉ xét được tối đa ${maxDays} ngày gần nhất. Hãy chọn khoảng ngắn hơn.`
}

export class ZaloFriendFilterError extends Error {
  readonly code = 'invalid_friend_filter' as const
  constructor(readonly path: string, readonly reason: string) {
    super(`${ZALO_FRIEND_FILTER_MESSAGES.invalid_friend_filter} (${path}: ${reason})`)
    this.name = 'ZaloFriendFilterError'
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Ngày theo lịch Việt Nam (không có giờ mùa hè: UTC+7 cố định)

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 'YYYY-MM-DD' của ngày hiện tại theo giờ Việt Nam. */
export function vietnamToday(now: Date = new Date()): string {
  return new Date(now.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10)
}

export function isFriendFilterDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value
}

export function addFriendFilterDays(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date) + delta * DAY_MS).toISOString().slice(0, 10)
}

/** Ngày đầu tiên còn được xét (khoảng 365 ngày tính cả hôm nay). */
export function friendFilterEarliestDay(today: string): string {
  return addFriendFilterDays(today, -(ZALO_FRIEND_FILTER_LIMITS.lookbackDays - 1))
}

/** Ngày đầu và ngày cuối (tính cả hai) của một khoảng, theo lịch Việt Nam. */
export function friendPeriodDays(period: FriendPeriod, today: string): { from: string; to: string } {
  if (period.type === 'last_days') return { from: addFriendFilterDays(today, -((period.days ?? 1) - 1)), to: today }
  if (period.type === 'range') return { from: period.from ?? today, to: period.to ?? today }
  return { from: friendFilterEarliestDay(today), to: today }
}

export function formatFriendFilterDay(day: string): string {
  const [year, month, date] = day.split('-')
  return `${date}/${month}/${year}`
}

// ---------------------------------------------------------------------------------------------------------------
// Kiểm hợp lệ và chuẩn hóa

type Row = Record<string, unknown>
const isRecord = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function exactKeys(value: Row, keys: readonly string[], path: string): void {
  const actual = Object.keys(value)
  for (const key of actual) if (!keys.includes(key)) throw new ZaloFriendFilterError(`${path}.${key}`, 'khóa không hợp lệ')
  for (const key of keys) if (!(key in value)) throw new ZaloFriendFilterError(`${path}.${key}`, 'thiếu khóa')
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new ZaloFriendFilterError(path, 'giá trị không hợp lệ')
  return value as T
}

function integer(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ZaloFriendFilterError(path, `phải là số nguyên ${min}–${max}`)
  }
  return value
}

function nullValue(value: unknown, path: string): null {
  if (value !== null) throw new ZaloFriendFilterError(path, 'phải là null')
  return null
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ZaloFriendFilterError(path, 'phải là true/false')
  return value
}

function array(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ZaloFriendFilterError(path, 'phải là mảng')
  if (value.length > max) throw new ZaloFriendFilterError(path, `tối đa ${max} phần tử`)
  return value
}

function uniqueIds(value: unknown, max: number, path: string): number[] {
  const ids = array(value, max, path).map((item, index) => integer(item, 1, Number.MAX_SAFE_INTEGER, `${path}[${index}]`))
  return Array.from(new Set(ids))
}

function uniqueTagIds(value: unknown, path: string): string[] {
  const ids = array(value, ZALO_FRIEND_FILTER_LIMITS.tagIds, path).map((item, index) => {
    if (typeof item !== 'string') throw new ZaloFriendFilterError(`${path}[${index}]`, 'phải là chuỗi')
    const id = item.trim()
    if (!id || id.length > ZALO_FRIEND_FILTER_LIMITS.tagIdLength || CONTROL_CHARS.test(id)) {
      throw new ZaloFriendFilterError(`${path}[${index}]`, 'mã tag không hợp lệ')
    }
    return id
  })
  return Array.from(new Set(ids))
}

function orderedSubset<T extends string>(value: unknown, allowed: readonly T[], max: number, path: string): T[] {
  const items = array(value, max, path).map((item, index) => oneOf(item, allowed, `${path}[${index}]`))
  return allowed.filter(item => items.includes(item))
}

export function parseFriendPeriod(value: unknown, today: string, path: string): FriendPeriod {
  if (!isRecord(value)) throw new ZaloFriendFilterError(path, 'phải là object')
  exactKeys(value, ['type', 'days', 'from', 'to'], path)
  const type = oneOf(value.type, ['last_days', 'range', 'all'] as const, `${path}.type`)
  if (type === 'last_days') {
    nullValue(value.from, `${path}.from`); nullValue(value.to, `${path}.to`)
    return { type, days: integer(value.days, 1, ZALO_FRIEND_FILTER_LIMITS.lookbackDays, `${path}.days`), from: null, to: null }
  }
  if (type === 'all') {
    nullValue(value.days, `${path}.days`); nullValue(value.from, `${path}.from`); nullValue(value.to, `${path}.to`)
    return { type, days: null, from: null, to: null }
  }
  nullValue(value.days, `${path}.days`)
  if (!isFriendFilterDate(value.from)) throw new ZaloFriendFilterError(`${path}.from`, 'phải là ngày YYYY-MM-DD')
  if (!isFriendFilterDate(value.to)) throw new ZaloFriendFilterError(`${path}.to`, 'phải là ngày YYYY-MM-DD')
  if (value.from > value.to) throw new ZaloFriendFilterError(path, 'ngày bắt đầu sau ngày kết thúc')
  if (value.to > today) throw new ZaloFriendFilterError(`${path}.to`, 'không được sau hôm nay')
  if (value.from < friendFilterEarliestDay(today)) {
    throw new ZaloFriendFilterError(`${path}.from`, `chỉ xét trong ${ZALO_FRIEND_FILTER_LIMITS.lookbackDays} ngày gần nhất`)
  }
  return { type, days: null, from: value.from, to: value.to }
}

function parseNullablePeriod(value: unknown, today: string, path: string): FriendPeriod | null {
  return value === null ? null : parseFriendPeriod(value, today, path)
}

function setCondition<T extends string | number>(op: FriendSetOp, ids: T[], path: string): T[] {
  if (op === 'tagged' || op === 'untagged') return []
  if (!ids.length) throw new ZaloFriendFilterError(`${path}.tagIds`, 'cần ít nhất một tag')
  return ids
}

export function parseFriendCondition(value: unknown, today: string, path: string): FriendCondition {
  if (!isRecord(value)) throw new ZaloFriendFilterError(path, 'phải là object')
  const field = oneOf(value.field, FRIEND_CONDITION_FIELDS, `${path}.field`)
  switch (field) {
    case 'zalo_tag': {
      exactKeys(value, ['field', 'op', 'tagIds'], path)
      const op = oneOf(value.op, FRIEND_SET_OPS, `${path}.op`)
      return { field, op, tagIds: setCondition(op, uniqueTagIds(value.tagIds, `${path}.tagIds`), path) }
    }
    case 'akabiz_tag': {
      exactKeys(value, ['field', 'op', 'tagIds'], path)
      const op = oneOf(value.op, FRIEND_SET_OPS, `${path}.op`)
      return { field, op, tagIds: setCondition(op, uniqueIds(value.tagIds, ZALO_FRIEND_FILTER_LIMITS.tagIds, `${path}.tagIds`), path) }
    }
    case 'gender': {
      exactKeys(value, ['field', 'values'], path)
      const values = orderedSubset(value.values, FRIEND_GENDERS, 3, `${path}.values`)
      if (!values.length) throw new ZaloFriendFilterError(`${path}.values`, 'cần ít nhất một giới tính')
      return { field, values }
    }
    case 'birthday': {
      exactKeys(value, ['field', 'op', 'months', 'days'], path)
      const op = oneOf(value.op, ['in_months', 'in_next_days', 'unknown'] as const, `${path}.op`)
      if (op === 'in_months') {
        const months = Array.from(new Set(array(value.months, 12, `${path}.months`)
          .map((item, index) => integer(item, 1, 12, `${path}.months[${index}]`)))).sort((a, b) => a - b)
        if (!months.length) throw new ZaloFriendFilterError(`${path}.months`, 'cần ít nhất một tháng')
        return { field, op, months, days: null }
      }
      if (op === 'in_next_days') {
        return { field, op, months: [], days: integer(value.days, 0, ZALO_FRIEND_FILTER_LIMITS.nextDays, `${path}.days`) }
      }
      return { field, op, months: [], days: null }
    }
    case 'phone': {
      exactKeys(value, ['field', 'op'], path)
      return { field, op: oneOf(value.op, ['has', 'missing'] as const, `${path}.op`) }
    }
    case 'name': {
      exactKeys(value, ['field', 'op', 'text'], path)
      const op = oneOf(value.op, ['contains', 'not_contains', 'starts_with'] as const, `${path}.op`)
      if (typeof value.text !== 'string') throw new ZaloFriendFilterError(`${path}.text`, 'phải là chuỗi')
      const text = value.text.normalize('NFC').trim()
      if (!text || text.length > ZALO_FRIEND_FILTER_LIMITS.nameText || CONTROL_CHARS.test(text)) {
        throw new ZaloFriendFilterError(`${path}.text`, `1–${ZALO_FRIEND_FILTER_LIMITS.nameText} ký tự`)
      }
      return { field, op, text }
    }
    case 'sent_count': {
      exactKeys(value, ['field', 'period', 'op', 'value', 'valueTo'], path)
      const period = parseFriendPeriod(value.period, today, `${path}.period`)
      const op = oneOf(value.op, ['eq', 'gte', 'lte', 'between'] as const, `${path}.op`)
      const count = integer(value.value, 0, ZALO_FRIEND_FILTER_LIMITS.sentCount, `${path}.value`)
      if (op !== 'between') return { field, period, op, value: count, valueTo: null }
      const valueTo = integer(value.valueTo, count, ZALO_FRIEND_FILTER_LIMITS.sentCount, `${path}.valueTo`)
      return { field, period, op, value: count, valueTo }
    }
    case 'latest_message': {
      exactKeys(value, ['field', 'op', 'stages', 'period'], path)
      const op = oneOf(value.op, ['in', 'not_in'] as const, `${path}.op`)
      const stages = orderedSubset(value.stages, MESSAGE_STAGES, MESSAGE_STAGES.length, `${path}.stages`)
      if (!stages.length) throw new ZaloFriendFilterError(`${path}.stages`, 'cần ít nhất một trạng thái')
      return { field, op, stages, period: parseNullablePeriod(value.period, today, `${path}.period`) }
    }
    case 'messages_in_period': {
      exactKeys(value, ['field', 'period', 'quantifier', 'status', 'amongSent'], path)
      return {
        field, period: parseFriendPeriod(value.period, today, `${path}.period`),
        quantifier: oneOf(value.quantifier, ['any', 'none'] as const, `${path}.quantifier`),
        status: oneOf(value.status, FRIEND_MESSAGE_STATUSES, `${path}.status`),
        amongSent: bool(value.amongSent, `${path}.amongSent`)
      }
    }
    case 'interaction': {
      exactKeys(value, ['field', 'kinds', 'op', 'period'], path)
      const kinds = orderedSubset(value.kinds, FRIEND_INTERACTION_KINDS, 3, `${path}.kinds`)
      if (!kinds.length) throw new ZaloFriendFilterError(`${path}.kinds`, 'cần ít nhất một loại tương tác')
      return { field, kinds, op: oneOf(value.op, ['within', 'not_within'] as const, `${path}.op`),
        period: parseFriendPeriod(value.period, today, `${path}.period`) }
    }
    case 'campaign': {
      exactKeys(value, ['field', 'op', 'campaignIds', 'period'], path)
      const campaignIds = uniqueIds(value.campaignIds, ZALO_FRIEND_FILTER_LIMITS.campaignIds, `${path}.campaignIds`)
      if (!campaignIds.length) throw new ZaloFriendFilterError(`${path}.campaignIds`, 'cần ít nhất một chiến dịch')
      return { field, op: oneOf(value.op, ['received', 'not_received'] as const, `${path}.op`), campaignIds,
        period: parseNullablePeriod(value.period, today, `${path}.period`) }
    }
    case 'data_group': {
      exactKeys(value, ['field', 'op', 'groupIds'], path)
      const groupIds = uniqueIds(value.groupIds, ZALO_FRIEND_FILTER_LIMITS.groupIds, `${path}.groupIds`)
      if (!groupIds.length) throw new ZaloFriendFilterError(`${path}.groupIds`, 'cần ít nhất một nhóm')
      return { field, op: oneOf(value.op, ['in', 'not_in'] as const, `${path}.op`), groupIds }
    }
  }
}

function parseSort(value: unknown, path: string): FriendFilterSort | null {
  if (value === null) return null
  if (!isRecord(value)) throw new ZaloFriendFilterError(path, 'phải là object hoặc null')
  exactKeys(value, ['by', 'direction', 'seed'], path)
  const by = oneOf(value.by, ['last_sent_at', 'last_interaction_at', 'name', 'random'] as const, `${path}.by`)
  const direction = oneOf(value.direction, ['asc', 'desc'] as const, `${path}.direction`)
  if (by !== 'random') return { by, direction, seed: null }
  if (value.seed === null) return { by, direction: 'asc', seed: null }
  if (typeof value.seed !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.seed)) {
    throw new ZaloFriendFilterError(`${path}.seed`, 'chỉ gồm chữ, số, - và _, tối đa 64 ký tự')
  }
  return { by, direction: 'asc', seed: value.seed }
}

function parseFilterBody(value: unknown, today: string, withAccount: boolean): ZaloFriendFilter | ZaloFriendFilterDraft {
  if (!isRecord(value)) throw new ZaloFriendFilterError('filter', 'phải là object')
  const keys = ['version', 'source', 'match', 'groups', 'excludeOptedOut', 'excludeBlocked', 'sort', 'limit']
  exactKeys(value, withAccount ? [...keys, 'accountId'] : keys, 'filter')
  if (value.version !== ZALO_FRIEND_FILTER_VERSION) throw new ZaloFriendFilterError('filter.version', 'chỉ hỗ trợ phiên bản 1')
  if (value.source !== ZALO_FRIEND_FILTER_SOURCE) throw new ZaloFriendFilterError('filter.source', 'chỉ hỗ trợ zalo_friends')
  const match = oneOf(value.match, ['all', 'any'] as const, 'filter.match')
  const rawGroups = array(value.groups, ZALO_FRIEND_FILTER_LIMITS.groups, 'filter.groups')
  let total = 0
  const groups = rawGroups.map((group, index): FriendConditionGroup => {
    const path = `filter.groups[${index}]`
    if (!isRecord(group)) throw new ZaloFriendFilterError(path, 'phải là object')
    exactKeys(group, ['match', 'conditions'], path)
    const conditions = array(group.conditions, ZALO_FRIEND_FILTER_LIMITS.conditionsPerGroup, `${path}.conditions`)
      .map((condition, conditionIndex) => parseFriendCondition(condition, today, `${path}.conditions[${conditionIndex}]`))
    if (!conditions.length) throw new ZaloFriendFilterError(`${path}.conditions`, 'cần ít nhất một điều kiện')
    total += conditions.length
    return { match: oneOf(group.match, ['all', 'any'] as const, `${path}.match`), conditions }
  })
  if (total > ZALO_FRIEND_FILTER_LIMITS.conditions) {
    throw new ZaloFriendFilterError('filter.groups', `tối đa ${ZALO_FRIEND_FILTER_LIMITS.conditions} điều kiện`)
  }
  bool(value.excludeOptedOut, 'filter.excludeOptedOut')
  const draft: ZaloFriendFilterDraft = {
    version: 1, source: 'zalo_friends', match, groups,
    // Bản đầu không cho tắt loại khách đã từ chối nhận tin.
    excludeOptedOut: true,
    excludeBlocked: bool(value.excludeBlocked, 'filter.excludeBlocked'),
    sort: parseSort(value.sort, 'filter.sort'),
    limit: value.limit === null ? null : integer(value.limit, 1, ZALO_FRIEND_FILTER_LIMITS.resultLimit, 'filter.limit')
  }
  if (!withAccount) return draft
  return { ...draft, accountId: integer(value.accountId, 1, Number.MAX_SAFE_INTEGER, 'filter.accountId') }
}

/** Kiểm và chuẩn hóa bộ lọc đầy đủ (có `accountId`). Ném `ZaloFriendFilterError` khi sai. */
export function parseZaloFriendFilter(value: unknown, today: string = vietnamToday()): ZaloFriendFilter {
  return parseFilterBody(value, today, true) as ZaloFriendFilter
}

/** Kiểm và chuẩn hóa bộ lọc AI trả về (không có `accountId`). */
export function parseZaloFriendFilterDraft(value: unknown, today: string = vietnamToday()): ZaloFriendFilterDraft {
  return parseFilterBody(value, today, false) as ZaloFriendFilterDraft
}

export function attachFriendFilterAccount(draft: ZaloFriendFilterDraft, accountId: number): ZaloFriendFilter {
  return {
    version: draft.version, source: draft.source, accountId, match: draft.match, groups: draft.groups,
    excludeOptedOut: draft.excludeOptedOut, excludeBlocked: draft.excludeBlocked, sort: draft.sort, limit: draft.limit
  }
}

/** Sắp xếp ngẫu nhiên chưa có seed thì cấp seed, để đếm thử và tạo nhóm ra cùng người. */
export function ensureFriendFilterSeed<T extends ZaloFriendFilterDraft>(filter: T, makeSeed: () => string): T {
  if (filter.sort?.by !== 'random' || filter.sort.seed) return filter
  const seed = makeSeed().replace(/[^A-Za-z0-9_-]/g, '').slice(0, ZALO_FRIEND_FILTER_LIMITS.seed) || 'seed'
  return { ...filter, sort: { by: 'random', direction: 'asc', seed } }
}

export function friendFilterConditions(filter: ZaloFriendFilterDraft): FriendCondition[] {
  return filter.groups.flatMap(group => group.conditions)
}

export function friendFilterUsesMessages(filter: ZaloFriendFilterDraft): boolean {
  return friendFilterConditions(filter).some(condition => FRIEND_MESSAGE_FIELDS.includes(condition.field))
    || filter.sort?.by === 'last_sent_at' || filter.sort?.by === 'last_interaction_at'
}

/** Điều kiện dùng dữ liệu theo dõi xem/cảm xúc/phản hồi (chỉ có từ khi bật theo dõi tương tác). */
export function friendFilterUsesTracking(filter: ZaloFriendFilterDraft): boolean {
  return friendFilterConditions(filter).some(condition =>
    condition.field === 'interaction'
    || condition.field === 'messages_in_period' && ['seen', 'reacted', 'replied'].includes(condition.status)
    || condition.field === 'latest_message' && condition.stages.some(stage => ['sent', 'delivered', 'seen', 'reacted', 'replied', 'unknown'].includes(stage)))
}

export function validateZaloFriendFilterRequest(input: unknown, today: string = vietnamToday()): ZaloFriendFilterRequest {
  if (!isRecord(input)) throw new ZaloFriendFilterError('request', 'phải là object')
  exactKeys(input, ['requestId', 'mode', 'filter', 'offset', 'limit'], 'request')
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(input.requestId)) {
    throw new ZaloFriendFilterError('request.requestId', 'mã lượt không hợp lệ')
  }
  const mode = oneOf(input.mode, ['count', 'page', 'ids'] as const, 'request.mode')
  const filter = parseZaloFriendFilter(input.filter, today)
  if (mode === 'page') {
    return { requestId: input.requestId, mode, filter,
      offset: integer(input.offset, 0, ZALO_FRIEND_FILTER_LIMITS.pageOffset, 'request.offset'),
      limit: integer(input.limit, 1, ZALO_FRIEND_FILTER_LIMITS.pageLimit, 'request.limit') }
  }
  nullValue(input.offset, 'request.offset'); nullValue(input.limit, 'request.limit')
  return { requestId: input.requestId, mode, filter, offset: null, limit: null }
}

export function validateCreateDataGroupFromFriendFilter(input: unknown, today: string = vietnamToday()): CreateDataGroupFromFriendFilterRequest {
  if (!isRecord(input)) throw new ZaloFriendFilterError('request', 'phải là object')
  exactKeys(input, ['requestId', 'name', 'color', 'filter', 'summary'], 'request')
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9:_-]{8,80}$/.test(input.requestId)) {
    throw new ZaloFriendFilterError('request.requestId', 'mã yêu cầu không hợp lệ')
  }
  if (typeof input.name !== 'string') throw new ZaloFriendFilterError('request.name', 'phải là chuỗi')
  const name = input.name.normalize('NFC').trim()
  if (!name || name.length > ZALO_FRIEND_FILTER_LIMITS.groupName || CONTROL_CHARS.test(name)) {
    throw new ZaloFriendFilterError('request.name', `tên nhóm 1–${ZALO_FRIEND_FILTER_LIMITS.groupName} ký tự`)
  }
  let color: string | null = null
  if (input.color !== null) {
    if (typeof input.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(input.color)) throw new ZaloFriendFilterError('request.color', 'màu dạng #RRGGBB')
    color = input.color.toUpperCase()
  }
  const summary = array(input.summary, ZALO_FRIEND_FILTER_LIMITS.summaryLines, 'request.summary').map((line, index) => {
    if (typeof line !== 'string' || line.length > ZALO_FRIEND_FILTER_LIMITS.summaryLineLength || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(line)) {
      throw new ZaloFriendFilterError(`request.summary[${index}]`, 'dòng tóm tắt không hợp lệ')
    }
    return line
  })
  return { requestId: input.requestId, name, color, filter: parseZaloFriendFilter(input.filter, today), summary }
}

// ---------------------------------------------------------------------------------------------------------------
// Danh sách người nhận cho form chiến dịch ("Agent chọn bạn bè", docs/CAMPAIGN_FRIEND_AGENT_PLAN.md)

/**
 * `POST /data/zalo-friends/filter/recipients`: chỉ đọc. Lọc đúng bộ lọc người dùng vừa xác nhận rồi trả UID và tên của mọi
 * người khớp (theo thứ tự của bộ lọc), để form chiến dịch thêm vào danh sách người nhận. Không ghi gì vào DB.
 */
export interface ZaloFriendRecipientsRequest {
  requestId: string
  filter: ZaloFriendFilter
}

export interface ZaloFriendRecipient {
  contactId: number
  /** UID Zalo trong danh bạ (cùng giá trị nút "Chọn bạn bè Zalo" đưa vào danh sách). */
  uid: string
  /** Tên trong danh bạ; null khi trống. */
  name: string | null
}

export interface ZaloFriendRecipientsResult {
  version: 1
  accountId: number
  totalFriends: number
  /** Số người khớp lúc lọc. */
  matched: number
  /** Người khớp còn trong danh bạ lúc đọc tên, theo thứ tự của bộ lọc. */
  recipients: ZaloFriendRecipient[]
  /** Khớp lúc lọc nhưng đã hủy kết bạn hoặc bị xóa khỏi danh bạ ngay sau đó. */
  missing: number
  notes: ZaloFriendFilterNote[]
  evaluatedAt: string
}

/** Máy chủ đọc tên/UID theo khóa chính, từng lô này, tuần tự. */
export const ZALO_FRIEND_RECIPIENTS_READ_BATCH = 500

export function validateZaloFriendRecipientsRequest(input: unknown, today: string = vietnamToday()): ZaloFriendRecipientsRequest {
  if (!isRecord(input)) throw new ZaloFriendFilterError('request', 'phải là object')
  exactKeys(input, ['requestId', 'filter'], 'request')
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(input.requestId)) {
    throw new ZaloFriendFilterError('request.requestId', 'mã lượt không hợp lệ')
  }
  return { requestId: input.requestId, filter: parseZaloFriendFilter(input.filter, today) }
}

export function parseZaloFriendRecipientsResult(value: unknown): ZaloFriendRecipientsResult {
  if (!isRecord(value) || value.version !== 1) throw new ZaloFriendFilterError('result', 'phản hồi không hợp lệ')
  const notes = Array.isArray(value.notes) ? value.notes : []
  const recipients = array(value.recipients, ZALO_FRIEND_FILTER_LIMITS.resultLimit, 'result.recipients').map((row, index): ZaloFriendRecipient => {
    const path = `result.recipients[${index}]`
    if (!isRecord(row) || typeof row.uid !== 'string' || !row.uid.trim()) throw new ZaloFriendFilterError(path, 'dòng không hợp lệ')
    return {
      contactId: integer(row.contactId, 1, Number.MAX_SAFE_INTEGER, `${path}.contactId`),
      uid: row.uid.trim(),
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : null
    }
  })
  return {
    version: 1,
    accountId: integer(value.accountId, 1, Number.MAX_SAFE_INTEGER, 'result.accountId'),
    totalFriends: integer(value.totalFriends, 0, Number.MAX_SAFE_INTEGER, 'result.totalFriends'),
    matched: integer(value.matched, 0, Number.MAX_SAFE_INTEGER, 'result.matched'),
    recipients,
    missing: integer(value.missing, 0, Number.MAX_SAFE_INTEGER, 'result.missing'),
    notes: notes.flatMap(note => isRecord(note) && typeof note.code === 'string' && note.code in FRIEND_FILTER_NOTE_LABELS
      && typeof note.count === 'number' && Number.isSafeInteger(note.count) && note.count >= 0
      ? [{ code: note.code as ZaloFriendFilterNoteCode, count: note.count }] : []),
    evaluatedAt: typeof value.evaluatedAt === 'string' && Number.isFinite(Date.parse(value.evaluatedAt)) ? value.evaluatedAt : new Date(0).toISOString()
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Danh mục của tài khoản (tag, nhóm, chiến dịch) và đối chiếu mã

export interface ZaloFriendFilterCatalog {
  zaloTags: Array<{ id: string; name: string; count?: number }>
  akaBizTags: Array<{ id: number; name: string }>
  dataGroups: Array<{ id: number; name: string; count?: number }>
  campaigns: Array<{ id: number; name: string }>
}

export interface ZaloFriendFilterCatalogIssue {
  path: string
  field: 'zalo_tag' | 'akabiz_tag' | 'campaign' | 'data_group'
  unknownIds: Array<string | number>
}

/** Mã tag/nhóm/chiến dịch không có trong danh mục (AI không được bịa mã). */
export function friendFilterCatalogIssues(filter: ZaloFriendFilterDraft, catalog: ZaloFriendFilterCatalog): ZaloFriendFilterCatalogIssue[] {
  const issues: ZaloFriendFilterCatalogIssue[] = []
  const zaloTags = new Set(catalog.zaloTags.map(tag => tag.id))
  const akaBizTags = new Set(catalog.akaBizTags.map(tag => tag.id))
  const groups = new Set(catalog.dataGroups.map(group => group.id))
  const campaigns = new Set(catalog.campaigns.map(campaign => campaign.id))
  filter.groups.forEach((group, groupIndex) => group.conditions.forEach((condition, conditionIndex) => {
    const path = `filter.groups[${groupIndex}].conditions[${conditionIndex}]`
    let unknownIds: Array<string | number> = []
    if (condition.field === 'zalo_tag') unknownIds = condition.tagIds.filter(id => !zaloTags.has(id))
    else if (condition.field === 'akabiz_tag') unknownIds = condition.tagIds.filter(id => !akaBizTags.has(id))
    else if (condition.field === 'campaign') unknownIds = condition.campaignIds.filter(id => !campaigns.has(id))
    else if (condition.field === 'data_group') unknownIds = condition.groupIds.filter(id => !groups.has(id))
    else return
    if (unknownIds.length) issues.push({ path, field: condition.field, unknownIds })
  }))
  return issues
}

/**
 * Bỏ mã không có trong danh mục; điều kiện hết mã thì bỏ cả điều kiện, khối hết điều kiện thì bỏ khối.
 * Trả thêm số điều kiện đã bỏ để báo cho người dùng (không âm thầm đổi nghĩa: bản tóm tắt dựng lại từ kết quả).
 */
export function pruneFriendFilterToCatalog<T extends ZaloFriendFilterDraft>(filter: T, catalog: ZaloFriendFilterCatalog): { filter: T; removedConditions: number; removedIds: number } {
  const zaloTags = new Set(catalog.zaloTags.map(tag => tag.id))
  const akaBizTags = new Set(catalog.akaBizTags.map(tag => tag.id))
  const groups = new Set(catalog.dataGroups.map(group => group.id))
  const campaigns = new Set(catalog.campaigns.map(campaign => campaign.id))
  let removedConditions = 0, removedIds = 0
  const keep = <V>(ids: V[], known: Set<V>): V[] => {
    const kept = ids.filter(id => known.has(id))
    removedIds += ids.length - kept.length
    return kept
  }
  const nextGroups = filter.groups.map(group => ({
    match: group.match,
    conditions: group.conditions.flatMap((condition): FriendCondition[] => {
      if (condition.field === 'zalo_tag' && condition.tagIds.length) {
        const tagIds = keep(condition.tagIds, zaloTags)
        if (!tagIds.length) { removedConditions++; return [] }
        return [{ ...condition, tagIds }]
      }
      if (condition.field === 'akabiz_tag' && condition.tagIds.length) {
        const tagIds = keep(condition.tagIds, akaBizTags)
        if (!tagIds.length) { removedConditions++; return [] }
        return [{ ...condition, tagIds }]
      }
      if (condition.field === 'campaign') {
        const campaignIds = keep(condition.campaignIds, campaigns)
        if (!campaignIds.length) { removedConditions++; return [] }
        return [{ ...condition, campaignIds }]
      }
      if (condition.field === 'data_group') {
        const groupIds = keep(condition.groupIds, groups)
        if (!groupIds.length) { removedConditions++; return [] }
        return [{ ...condition, groupIds }]
      }
      return [condition]
    })
  })).filter(group => group.conditions.length > 0)
  return { filter: { ...filter, groups: nextGroups }, removedConditions, removedIds }
}

// ---------------------------------------------------------------------------------------------------------------
// Tóm tắt tiếng Việt (code dựng từ chính JSON: điều người dùng xác nhận đúng là điều sẽ chạy)

export const MESSAGE_STAGE_LABELS: Record<MessageStage, string> = {
  never_sent: 'Chưa được nhắn',
  failed: 'Gửi lỗi',
  unknown: 'Đã gửi, không rõ trạng thái',
  sent: 'Đã gửi, chưa xem',
  delivered: 'Đã nhận',
  seen: 'Đã xem',
  reacted: 'Đã thả cảm xúc',
  replied: 'Đã phản hồi'
}
const GENDER_LABELS: Record<FriendGender, string> = { male: 'Nam', female: 'Nữ', unknown: 'Chưa rõ' }
const STATUS_PHRASES: Record<FriendMessageStatus, string> = {
  sent: 'gửi thành công', failed: 'gửi lỗi', seen: 'đã được xem', reacted: 'được thả cảm xúc', replied: 'được phản hồi'
}
const INTERACTION_PHRASES: Record<FriendInteractionKind, string> = { seen: 'xem tin', reacted: 'thả cảm xúc', replied: 'phản hồi' }

export interface FriendFilterSummaryLine {
  text: string
  /** 0: dòng chính; 1: một ý trong khối "một trong các ý sau". */
  level: 0 | 1
}

export interface FriendFilterSummaryOptions {
  today: string
  accountName?: string | null
  /** Ngày bắt đầu có dữ liệu theo dõi tương tác của tài khoản ('YYYY-MM-DD' hoặc ISO), null nếu chưa có. */
  trackingSince?: string | null
}

const joinOr = (items: string[]) => items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} hoặc ${items[items.length - 1]}`
const joinAnd = (items: string[]) => items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} và ${items[items.length - 1]}`
const quote = (value: string) => `"${value}"`
const MAX_LISTED = 6

function names<T extends string | number>(ids: T[], lookup: Map<T, string>, unknownLabel: (id: T) => string): string[] {
  const listed = ids.slice(0, MAX_LISTED).map(id => {
    const name = lookup.get(id)
    return name ? quote(name) : unknownLabel(id)
  })
  return ids.length > MAX_LISTED ? [...listed, `${ids.length - MAX_LISTED} mục khác`] : listed
}

export function describeFriendPeriod(period: FriendPeriod, today: string): string {
  if (period.type === 'all') return `từ trước tới nay (tối đa ${ZALO_FRIEND_FILTER_LIMITS.lookbackDays} ngày)`
  if (period.type === 'last_days') {
    if (period.days === 1) return 'trong hôm nay'
    return `trong ${period.days} ngày gần nhất`
  }
  const { from, to } = friendPeriodDays(period, today)
  return from === to ? `trong ngày ${formatFriendFilterDay(from)}` : `từ ${formatFriendFilterDay(from)} tới ${formatFriendFilterDay(to)}`
}

export function describeFriendCondition(condition: FriendCondition, catalog: ZaloFriendFilterCatalog, today: string): string {
  switch (condition.field) {
    case 'zalo_tag':
    case 'akabiz_tag': {
      const label = condition.field === 'zalo_tag' ? 'tag Zalo' : 'tag akaBiz'
      if (condition.op === 'tagged') return `Có ít nhất một ${label}`
      if (condition.op === 'untagged') return `Chưa gắn ${label} nào`
      const tagNames = condition.field === 'zalo_tag'
        ? names(condition.tagIds, new Map(catalog.zaloTags.map(tag => [tag.id, tag.name])), id => `tag mã ${id}`)
        : names(condition.tagIds, new Map(catalog.akaBizTags.map(tag => [tag.id, tag.name])), id => `tag mã ${id}`)
      if (condition.op === 'has_any') return `Có ${label}: ${joinOr(tagNames)}`
      if (condition.op === 'has_all') return `Có đủ các ${label}: ${joinAnd(tagNames)}`
      return `Không có ${label} nào trong: ${tagNames.join(', ')}`
    }
    case 'gender':
      return `Giới tính: ${joinOr(condition.values.map(value => GENDER_LABELS[value]))}`
    case 'birthday':
      if (condition.op === 'unknown') return 'Chưa có ngày sinh trên Zalo'
      if (condition.op === 'in_next_days') {
        return condition.days === 0 ? 'Sinh nhật hôm nay' : `Sinh nhật trong ${condition.days} ngày tới (tính cả hôm nay)`
      }
      return `Sinh nhật trong tháng ${joinOr(condition.months.map(String))}`
    case 'phone':
      return condition.op === 'has' ? 'Có số điện thoại' : 'Chưa có số điện thoại'
    case 'name':
      if (condition.op === 'contains') return `Tên có chữ ${quote(condition.text)}`
      if (condition.op === 'not_contains') return `Tên không có chữ ${quote(condition.text)}`
      return `Tên bắt đầu bằng ${quote(condition.text)}`
    case 'sent_count': {
      const period = describeFriendPeriod(condition.period, today)
      if (condition.op === 'eq') return condition.value === 0 ? `Chưa được nhắn lần nào ${period}` : `Được nhắn đúng ${condition.value} lần ${period}`
      if (condition.op === 'gte') return condition.value <= 1 ? `Đã được nhắn ít nhất 1 lần ${period}` : `Được nhắn từ ${condition.value} lần trở lên ${period}`
      if (condition.op === 'lte') return `Được nhắn không quá ${condition.value} lần ${period} (kể cả chưa nhắn)`
      return `Được nhắn từ ${condition.value} tới ${condition.valueTo} lần ${period}`
    }
    case 'latest_message': {
      const stages = joinOr(condition.stages.map(stage => MESSAGE_STAGE_LABELS[stage]))
      const scope = condition.period ? ` ${describeFriendPeriod(condition.period, today)}` : ''
      return condition.op === 'in' ? `Tin nhắn gần nhất${scope}: ${stages}` : `Tin nhắn gần nhất${scope} không phải: ${stages}`
    }
    case 'messages_in_period': {
      const period = describeFriendPeriod(condition.period, today)
      const status = STATUS_PHRASES[condition.status]
      const text = condition.quantifier === 'any' ? `Có ít nhất một tin ${status} ${period}` : `Không có tin nào ${status} ${period}`
      return condition.amongSent ? `${text} (chỉ xét người đã được nhắn trong khoảng này)` : text
    }
    case 'interaction': {
      const kinds = joinOr(condition.kinds.map(kind => INTERACTION_PHRASES[kind]))
      const period = describeFriendPeriod(condition.period, today)
      return condition.op === 'within' ? `Có ${kinds} ${period}` : `Không có ${kinds} ${period} (kể cả chưa từng)`
    }
    case 'campaign': {
      const campaignNames = names(condition.campaignIds, new Map(catalog.campaigns.map(item => [item.id, item.name])), id => `chiến dịch mã ${id}`)
      const scope = condition.period ? ` ${describeFriendPeriod(condition.period, today)}` : ''
      return condition.op === 'received'
        ? `Đã nhận tin của chiến dịch ${joinOr(campaignNames)}${scope}`
        : `Chưa nhận tin của chiến dịch ${campaignNames.join(', ')}${scope}`
    }
    case 'data_group': {
      const groupNames = names(condition.groupIds, new Map(catalog.dataGroups.map(item => [item.id, item.name])), id => `nhóm mã ${id}`)
      return condition.op === 'in' ? `Đang thuộc nhóm khách hàng ${joinOr(groupNames)}` : `Không thuộc nhóm khách hàng ${groupNames.join(', ')}`
    }
  }
}

function describeSort(filter: ZaloFriendFilterDraft): string {
  const sort = filter.sort
  if (!sort) return 'theo thứ tự trong danh bạ'
  if (sort.by === 'random') return 'chọn ngẫu nhiên'
  if (sort.by === 'name') return sort.direction === 'asc' ? 'theo tên A–Z' : 'theo tên Z–A'
  if (sort.by === 'last_sent_at') return sort.direction === 'asc' ? 'ưu tiên người lâu chưa được nhắn nhất' : 'ưu tiên người vừa được nhắn gần nhất'
  return sort.direction === 'asc' ? 'ưu tiên người lâu chưa tương tác nhất' : 'ưu tiên người vừa tương tác gần nhất'
}

/** Các dòng tóm tắt có cấp (giao diện vẽ dấu đầu dòng theo cấp). */
export function describeZaloFriendFilterLines(filter: ZaloFriendFilterDraft, catalog: ZaloFriendFilterCatalog, options: FriendFilterSummaryOptions): FriendFilterSummaryLine[] {
  const lines: FriendFilterSummaryLine[] = []
  const today = options.today
  if (options.accountName) lines.push({ text: `Bạn bè của ${options.accountName}`, level: 0 })
  if (!filter.groups.length) lines.push({ text: 'Mọi bạn bè của tài khoản', level: 0 })
  const multipleGroups = filter.groups.length > 1
  filter.groups.forEach((group, index) => {
    const texts = group.conditions.map(condition => describeFriendCondition(condition, catalog, today))
    if (multipleGroups) {
      const prefix = filter.match === 'any' ? (index === 0 ? 'Nhóm điều kiện 1' : `HOẶC nhóm điều kiện ${index + 1}`) : `Nhóm điều kiện ${index + 1}`
      lines.push({ text: `${prefix}${group.match === 'any' && texts.length > 1 ? ' (chỉ cần một ý)' : ''}:`, level: 0 })
      texts.forEach(text => lines.push({ text, level: 1 }))
    } else if (group.match === 'any' && texts.length > 1) {
      lines.push({ text: 'Thỏa ít nhất một ý sau:', level: 0 })
      texts.forEach(text => lines.push({ text, level: 1 }))
    } else {
      texts.forEach(text => lines.push({ text, level: 0 }))
    }
  })
  if (filter.limit !== null) lines.push({ text: `Lấy tối đa ${filter.limit.toLocaleString('vi-VN')} người, ${describeSort(filter)}`, level: 0 })
  lines.push({ text: `Luôn loại: khách đã từ chối nhận tin${filter.excludeBlocked ? ', người đã bị chặn' : ''}`, level: 0 })
  if (friendFilterUsesTracking(filter)) {
    const since = options.trackingSince ? formatFriendFilterDay(options.trackingSince.slice(0, 10)) : null
    lines.push({ text: since
      ? `Xem/thả cảm xúc/phản hồi chỉ tính với tin gửi qua chiến dịch, có dữ liệu từ ${since}`
      : 'Xem/thả cảm xúc/phản hồi chỉ tính với tin gửi qua chiến dịch có theo dõi tương tác', level: 0 })
  }
  return lines
}

/**
 * Phần điều kiện của bản tóm tắt, viết gọn trên một dòng (ghi chú nguồn trên danh sách người nhận của form chiến dịch):
 * bỏ dòng tài khoản ở đầu và các dòng "Luôn loại…", "Xem/thả cảm xúc/phản hồi…" ở cuối. Dòng cấp 1 nối bằng "hoặc"/dấu phẩy
 * như khi đọc thành câu, các ý cấp 0 nối bằng dấu chấm phẩy.
 */
export function friendFilterConditionsText(lines: readonly FriendFilterSummaryLine[], accountName?: string | null): string {
  const kept = lines.filter((line, index) => !(index === 0 && accountName && line.text === `Bạn bè của ${accountName}`)
    && !line.text.startsWith('Luôn loại:') && !line.text.startsWith('Xem/thả cảm xúc/phản hồi chỉ tính'))
  const parts: string[] = []
  for (const line of kept) {
    const text = line.text.charAt(0).toLocaleLowerCase('vi-VN') + line.text.slice(1)
    if (line.level === 1 && parts.length) parts[parts.length - 1] += `${parts[parts.length - 1].endsWith(':') ? ' ' : ', '}${text}`
    else parts.push(text)
  }
  return parts.join('; ')
}

/** Tóm tắt dạng chuỗi (lưu kèm nhóm, ghi chú nhóm): ý trong khối "một trong" có gạch đầu dòng thụt vào. */
export function describeZaloFriendFilter(filter: ZaloFriendFilterDraft, catalog: ZaloFriendFilterCatalog, options: FriendFilterSummaryOptions): string[] {
  return describeZaloFriendFilterLines(filter, catalog, options)
    .map(line => (line.level === 1 ? `  - ${line.text}` : line.text).slice(0, ZALO_FRIEND_FILTER_LIMITS.summaryLineLength))
    .slice(0, ZALO_FRIEND_FILTER_LIMITS.summaryLines)
}

export const FRIEND_FILTER_NOTE_LABELS: Record<ZaloFriendFilterNoteCode, (count: number) => string> = {
  untracked_latest: count => `${count.toLocaleString('vi-VN')} bạn bè có tin nhắn gần nhất không theo dõi được trạng thái, nên không được tính là "chưa xem".`,
  tracking_partial: () => 'Khoảng thời gian bắt đầu trước khi có dữ liệu xem/thả cảm xúc/phản hồi, nên số liệu tương tác chỉ tính phần có dữ liệu.',
  friends_stale: count => `Danh bạ bạn bè đã cập nhật cách đây ${count} ngày. Nên Lấy lại danh bạ trước khi tạo nhóm.`,
  limit_applied: count => `Đã bỏ ${count.toLocaleString('vi-VN')} người vượt quá giới hạn số người.`,
  opted_out_removed: count => `Đã loại ${count.toLocaleString('vi-VN')} khách đã từ chối nhận tin.`,
  blocked_removed: count => `Đã loại ${count.toLocaleString('vi-VN')} người đã bị chặn.`
}

// ---------------------------------------------------------------------------------------------------------------
// Kết quả của hàm DB (API kiểm trước khi trả cho trình duyệt)

const isoOrNull = (value: unknown, path: string): string | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new ZaloFriendFilterError(path, 'thời điểm không hợp lệ')
  return value
}
const count = (value: unknown, path: string) => integer(value, 0, Number.MAX_SAFE_INTEGER, path)
const textOrNull = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null

export function parseZaloFriendFilterResult(value: unknown, mode: ZaloFriendFilterMode): ZaloFriendFilterResult {
  if (!isRecord(value) || value.version !== 1) throw new ZaloFriendFilterError('result', 'phản hồi không hợp lệ')
  const coverage = isRecord(value.coverage) ? value.coverage : {}
  const notes = Array.isArray(value.notes) ? value.notes : []
  const result: ZaloFriendFilterResult = {
    version: 1,
    accountId: integer(value.accountId, 1, Number.MAX_SAFE_INTEGER, 'result.accountId'),
    totalFriends: count(value.totalFriends, 'result.totalFriends'),
    matched: count(value.matched, 'result.matched'),
    rows: null,
    contactIds: null,
    coverage: {
      friendsUpdatedAt: isoOrNull(coverage.friendsUpdatedAt, 'result.coverage.friendsUpdatedAt'),
      messagesSince: isoOrNull(coverage.messagesSince, 'result.coverage.messagesSince'),
      trackingSince: isoOrNull(coverage.trackingSince, 'result.coverage.trackingSince'),
      deliveredAvailable: coverage.deliveredAvailable === true,
      chatHistory: coverage.chatHistory === true,
      factsFrom: isoOrNull(coverage.factsFrom, 'result.coverage.factsFrom')
    },
    notes: notes.flatMap(note => isRecord(note) && typeof note.code === 'string' && note.code in FRIEND_FILTER_NOTE_LABELS
      && typeof note.count === 'number' && Number.isSafeInteger(note.count) && note.count >= 0
      ? [{ code: note.code as ZaloFriendFilterNoteCode, count: note.count }] : []),
    evaluatedAt: isoOrNull(value.evaluatedAt, 'result.evaluatedAt') ?? new Date(0).toISOString()
  }
  if (mode === 'ids') {
    result.contactIds = array(value.contactIds, ZALO_FRIEND_FILTER_LIMITS.resultLimit, 'result.contactIds')
      .map((id, index) => integer(id, 1, Number.MAX_SAFE_INTEGER, `result.contactIds[${index}]`))
  }
  if (mode === 'page') {
    result.rows = array(value.rows, ZALO_FRIEND_FILTER_LIMITS.pageLimit, 'result.rows').map((row, index): ZaloFriendFilterRow => {
      const path = `result.rows[${index}]`
      if (!isRecord(row)) throw new ZaloFriendFilterError(path, 'dòng không hợp lệ')
      const tags = Array.isArray(row.zaloTags) ? row.zaloTags : []
      return {
        contactId: integer(row.contactId, 1, Number.MAX_SAFE_INTEGER, `${path}.contactId`),
        name: textOrNull(row.name),
        zaloOriginalName: textOrNull(row.zaloOriginalName),
        uid: typeof row.uid === 'string' ? row.uid : '',
        phone: textOrNull(row.phone),
        gender: FRIEND_GENDERS.includes(row.gender as FriendGender) ? row.gender as FriendGender : 'unknown',
        zaloTags: tags.flatMap(tag => isRecord(tag) && typeof tag.id === 'string'
          ? [{ id: tag.id, name: typeof tag.name === 'string' && tag.name ? tag.name : tag.id }] : []),
        akaBizTagIds: Array.isArray(row.akaBizTagIds) ? row.akaBizTagIds.filter((id): id is number => Number.isSafeInteger(id)) : [],
        sentCount: count(row.sentCount ?? 0, `${path}.sentCount`),
        lastSentAt: isoOrNull(row.lastSentAt, `${path}.lastSentAt`),
        latestStage: MESSAGE_STAGES.includes(row.latestStage as MessageStage) ? row.latestStage as MessageStage : 'never_sent',
        lastInteractionAt: isoOrNull(row.lastInteractionAt, `${path}.lastInteractionAt`)
      }
    })
  }
  return result
}
