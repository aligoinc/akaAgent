/**
 * Lấy data đầu lượt cho các loại chiến dịch Zalo không có data nhập sẵn, tách từ bộ chạy Desktop/VPS (campaignScheduler.ts, đầu
 * executeCampaignV2):
 * - nhắn bạn bè chế độ "toàn bộ bạn bè" / "theo tag" (materializeZaloFriendInputData): lấy một lần, khi chưa có dòng data nào và chưa
 *   có dấu zaloFriendDataMaterializedAt;
 * - chúc mừng sinh nhật (materializeZaloBirthdayInputData): bạn bè có sdob là hôm nay (ngày VN theo giờ DB), mỗi ngày một lần;
 * - nhắn tin / kết bạn theo đề xuất Zalo (materializeZaloFriendRecommendationInputData): N đề xuất, khi chưa có data và chưa có dấu;
 * - huỷ lời mời kết bạn đã gửi (materializeZaloCancelSentFriendRequestInputData): N lời mời cũ nhất, mỗi lượt khi chưa có data hoặc mọi
 *   data đã hoàn thành (xoá data cũ trước).
 *
 * runUnit gọi khi lượt chưa chạy data nào mà claim không còn data đến hạn (UnitConfig.prepareTargets). Mỗi lần đọc Zalo nghỉ 2–5 giây
 * trước, Zalo báo 429 thì thử lại sau 15/30/60 giây; câu tiến trình như Desktop. Data và dấu "đã lấy" ghi qua RPC V505
 * (aka_agent_engine_materialize_v1, xác thực bằng lease) trong một giao dịch, chỉ khi chiến dịch chưa có dòng data nào.
 *
 * Khác Desktop (ghi trong docs/CAMPAIGN_OUTCOME_ENGINE_ZALO_COVERAGE.md):
 * - lỗi đường truyền / runtime chưa sẵn sàng / Zalo 429 sau 3 lần thử khi đọc danh sách: chiến dịch về chờ kèm ghi chú, tự thử lại
 *   sau 10 phút (Desktop: lượt chạy lỗi; đề xuất / huỷ lời mời còn hoàn thành chiến dịch với mọi lỗi không phải 429). Zalo trả lời lỗi
 *   khi đọc đề xuất / lời mời đã gửi thì vẫn hoàn thành kèm câu như Desktop; khi đọc bạn bè thì cũng về chờ, thử lại sau 10 phút;
 * - tag nguồn không tồn tại / không hợp lệ: tạm dừng chiến dịch kèm ghi chú (Desktop: lượt chạy lỗi, thử lại mỗi nhịp);
 * - câu chờ không đổi (chưa chọn tag, không lấy được bạn bè nào) thì không in lại mỗi lần quét;
 * - đọc Zalo trước khi kiểm khoá / hạn mức của thao tác gửi (claim chỉ kiểm khi đã có data); data lấy được chờ tới lúc mở.
 */
import type { PrepareTargetsApi, PrepareTargetsResult, UnitEndReason } from '../runUnit.js'
import { CancelledError, DeadlineError, errorMessage, withDeadline } from '../boundary.js'
import { firstString, ZaloPortError } from './common.js'

type JsonObject = Record<string, unknown>

export const ZALO_MESSAGE_BIRTHDAY = 'zalo_message_birthday'
export const ZALO_MESSAGE_FRIEND_RECOMMENDATION = 'zalo_message_friend_recommendation'
export const ZALO_CANCEL_SENT_FRIEND_REQUEST = 'zalo_cancel_sent_friend_request'
const ZALO_MESSAGE_FRIEND = 'zalo_message_friend'

/** Như ZALO_FRIEND_PAGE_SIZE, ZALO_CAMPAIGN_READ_MIN/MAX_DELAY_MS, ZALO_CAMPAIGN_READ_429_RETRY_DELAYS_MS của Desktop. */
export const ZALO_FRIEND_PAGE_SIZE = 500
const READ_MIN_DELAY_MS = 2_000
const READ_MAX_DELAY_MS = 5_000
const READ_429_RETRY_DELAYS_MS = [15_000, 30_000, 60_000] as const
/** Trần số trang bạn bè (Desktop không có): runtime trả mãi trang đầy thì dừng, không đọc vô hạn. */
const FRIEND_PAGE_LIMIT = 200
/** Lỗi đọc tạm thời: chiến dịch về chờ, thử lại sau chừng này phút. */
export const MATERIALIZE_RETRY_MINUTES = 10

export const NO_FRIEND_DATA_NOTE = 'Không lấy được bạn bè Zalo nào để gửi tin'
const NO_BIRTHDAY_NOTE = 'Không có bạn bè sinh nhật hôm nay'
const NO_RECOMMENDATION_NOTE = 'Zalo không có danh sách đề xuất để chạy'
const NO_SENT_REQUEST_NOTE = 'Zalo không có lời mời kết bạn đã gửi để huỷ'
const ZALO_429_MESSAGE = 'Zalo đang giới hạn tần suất request (HTTP 429)'

export interface MaterializeContext {
  leaseToken: string
  signal: AbortSignal
}

/** V505 'state': số data theo trạng thái (không tính dòng đã xoá), các dấu "đã lấy" đọc từ DB, ngày VN theo giờ DB. */
export interface MaterializeState {
  vnDate: string
  total: number
  pending: number
  running: number
  done: number
  markers: JsonObject
  note: string | null
}

export interface MaterializedRow {
  name: string
  uid: string
  phone?: string
  info1?: string
  info2?: string
  info3?: string
}

/** Như ZaloFriendRecommendationSnapshot của Desktop (runtime Fly trả cùng dạng). */
export interface ZaloFriendRecommendationSnapshot {
  profiles: Array<{ uid: string; name?: string; displayName?: string; zaloName?: string; phone?: string; raw?: JsonObject }>
  totalItems: number
  recommendedItems: number
  missingUidItems: number
  hasRecommendationList: boolean
}

/** Như ZaloSentFriendRequestSnapshot của Desktop (runtime Fly trả cùng dạng; Zalo 112 = danh sách rỗng). */
export interface ZaloSentFriendRequestSnapshot {
  profiles: Array<{ uid: string; name?: string; displayName?: string; zaloName?: string; globalId?: string; requestMessage?: string;
    sentAt?: number | null }>
  totalItems: number
  missingUidItems: number
}

/** Kết quả 'state' của V505 → MaterializeState (cổng Desktop và Fly dùng chung). */
export function materializeStateFrom(raw: Record<string, unknown>): MaterializeState {
  const count = (value: unknown): number => Math.max(0, Math.floor(Number(value)) || 0)
  const markers = raw.markers && typeof raw.markers === 'object' && !Array.isArray(raw.markers) ? raw.markers as JsonObject : {}
  return {
    vnDate: typeof raw.vnDate === 'string' ? raw.vnDate : '',
    total: count(raw.total), pending: count(raw.pending), running: count(raw.running), done: count(raw.done),
    markers, note: typeof raw.note === 'string' ? raw.note : null
  }
}

/** Tag nguồn không dùng được (Desktop ném "Tag Zalo không tồn tại" / "Tag Zalo không hợp lệ"): tạm dừng chiến dịch. */
export class ZaloSourceTagError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZaloSourceTagError'
  }
}

/** RPC V505 từ chối (mất lease, chiến dịch đổi trạng thái…). */
export class MaterializeRpcError extends Error {
  constructor(readonly reason: string, message?: string) {
    super(message || reason)
    this.name = 'MaterializeRpcError'
  }
}

export interface ZaloMaterializePort {
  materializeState(ctx: MaterializeContext): Promise<MaterializeState>
  /** Xoá mềm (is_delete) mọi data của chiến dịch huỷ lời mời khi tất cả đã hoàn thành. */
  materializeClear(ctx: MaterializeContext): Promise<{ cleared: number }>
  /** Thêm data và dấu "đã lấy" (số dòng; ngày với sinh nhật) trong một giao dịch; chiến dịch đã có data thì từ chối ('not_empty'). */
  materializeInsert(ctx: MaterializeContext, rows: readonly MaterializedRow[], opts: { vnDate?: string }): Promise<{ inserted: number }>
  /** Chiến dịch về chờ (hoặc tạm dừng) kèm ghi chú; retryAfterMinutes: hẹn lịch chạy lại. */
  materializeHold(ctx: MaterializeContext, hold: { note: string; status: 'chờ xử lý' | 'tạm dừng'; retryAfterMinutes?: number }): Promise<void>
  /** api.getAllFriends(count, page) (Desktop getAllFriendsPage; Fly lệnh get_all_friends_page). */
  getAllFriendsPage(ctx: MaterializeContext, count: number, page: number): Promise<JsonObject[]>
  /** UID hội thoại của các tag (Desktop: một lần listLabels; Fly: get_label_conversation_uids từng tag). Tag hỏng: ZaloSourceTagError. */
  friendTagConversations(ctx: MaterializeContext, tagIds: readonly string[]): Promise<string[]>
  getFriendRecommendations(ctx: MaterializeContext): Promise<ZaloFriendRecommendationSnapshot>
  getSentFriendRequests(ctx: MaterializeContext): Promise<ZaloSentFriendRequestSnapshot>
  /** Lưu danh bạ bạn bè vừa đọc (Desktop: mapZaloApiRawUserContact + upsertZaloCampaignUserContacts; source = loại chiến dịch). */
  saveFriendContacts(ctx: MaterializeContext, raws: readonly JsonObject[], source: string): Promise<void>
}

interface MaterializeCampaign {
  id: number
  actionId: string
  extraSettings: JsonObject
}

export interface ZaloMaterializeOptions {
  campaignName: string
  /** Ghi chú hiện tại của chiến dịch: câu chờ không đổi thì không in lại. */
  campaignNote?: string | null
  /** Hạn giờ mỗi lần đọc Zalo / mỗi lời gọi DB. */
  readTimeoutMs?: number
  callTimeoutMs?: number
  random?: () => number
}

/** Như getZaloFriendTargetMode của Desktop: chế độ lạ coi như "selected". */
export function zaloFriendTargetMode(extra: JsonObject): 'selected' | 'all_friends' | 'tagged_friends' {
  const mode = String(extra.zaloFriendTargetMode || 'selected')
  return mode === 'all_friends' || mode === 'tagged_friends' ? mode : 'selected'
}

/** Loại chiến dịch có bước lấy data đầu lượt (bạn bè chỉ khi chế độ "toàn bộ" / "theo tag"). */
export function zaloCampaignMaterializes(campaign: { actionId: string; extraSettings: JsonObject }): boolean {
  if (campaign.actionId === ZALO_MESSAGE_FRIEND) return zaloFriendTargetMode(campaign.extraSettings) !== 'selected'
  return campaign.actionId === ZALO_MESSAGE_BIRTHDAY || campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION
    || campaign.actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST
}

/** Như normalizeUidForCompare của Desktop. */
const uidKey = (uid: unknown): string => String(uid ?? '').trim().replace(/\/+$/g, '').toLowerCase()

/** Như normalizeZaloFriendRecommendationCount / normalizeZaloCancelFriendRequestLimit: số nguyên ≥ 1, mặc định 10. */
function positiveCount(value: unknown): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return 10
  return Math.max(1, parsed)
}

/** Như normalizeZaloFriendProfile của Desktop. */
function friendProfile(raw: JsonObject): { uid: string; name: string; phone: string; sdob: string; raw: JsonObject } | null {
  const uid = firstString(raw.userId, raw.uid, raw.id)
  if (!uid) return null
  return {
    uid,
    name: firstString(raw.displayName, raw.zaloName, raw.username, raw.name, uid) ?? uid,
    phone: firstString(raw.phoneNumber, raw.phone) ?? '',
    sdob: firstString(raw.sdob) ?? '',
    raw
  }
}

/** Như isZalo429Error của Desktop, cộng tín hiệu HTTP 429 mà cổng đã đổi sang ZaloPortError. */
export function isZalo429Error(value: unknown, depth = 0): boolean {
  if (depth > 4) return false
  if (typeof value === 'string') return /\b429\b|too many requests/i.test(value)
  if (!value || typeof value !== 'object') return false
  if (value instanceof ZaloPortError && value.signal.kind === 'http_status' && String(value.signal.code) === '429') return true
  const error = value as { code?: unknown; message?: unknown; status?: unknown; statusCode?: unknown;
    response?: { status?: unknown; statusCode?: unknown }; cause?: unknown; originalError?: unknown }
  if ([error.code, error.status, error.statusCode, error.response?.status, error.response?.statusCode].some(v => Number(v) === 429)) return true
  if (typeof error.message === 'string' && isZalo429Error(error.message, depth + 1)) return true
  if (error.cause !== value && isZalo429Error(error.cause, depth + 1)) return true
  return error.originalError !== value && isZalo429Error(error.originalError, depth + 1)
}

/** Như getSafeZaloCampaignReadMessage của Desktop: ẩn token, cookie, URL; tối đa 500 ký tự. */
export function safeZaloReadMessage(error: unknown): string {
  if (isZalo429Error(error)) return ZALO_429_MESSAGE
  const sanitized = errorMessage(error)
    .replace(/\s+/g, ' ')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [đã ẩn]')
    .replace(/https?:\/\/[^\s]+/gi, '[URL đã ẩn]')
    .replace(/\b(cookie|authorization)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,}]+)/gi, '$1=[đã ẩn]')
    .replace(/\b(token|zpsid|zpw_sek|imei|session(?:[_-]?key)?|proxy(?:[_-]?url)?)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1=[đã ẩn]')
    .trim()
    .slice(0, 500)
  return sanitized || 'Lỗi không xác định'
}

/**
 * Zalo đã trả lời lỗi (mã Zalo, hoặc câu lỗi Zalo trả về): không phải lỗi tạm thời của đường truyền / runtime / hạn giờ. Cổng đổi lỗi đọc
 * sang ZaloPortError theo classifyZaloError (thao tác đọc): câu trả lời của Zalo là after_send, còn lại là before_send.
 */
function zaloAnswered(error: unknown): boolean {
  if (isZalo429Error(error) || !(error instanceof ZaloPortError)) return false
  return error.signal.kind === 'zalo_code' || (error.signal.kind === 'message_like' && error.phase === 'after_send')
}

/** Dừng lượt vì lý do RPC V505 trả về. */
function rpcEnd(error: MaterializeRpcError): PrepareTargetsResult {
  const reasons: Record<string, UnitEndReason> = {
    ownership_lost: 'ownership_lost', campaign_not_runnable: 'campaign_not_runnable', legacy_busy: 'legacy_busy',
    campaign_deleted: 'campaign_not_runnable', data_group: 'config_invalid', action_not_supported: 'config_invalid'
  }
  return { kind: 'end', reason: reasons[error.reason] ?? 'error', detail: { materialize: error.reason, message: error.message } }
}

/** Bước lấy data đầu lượt của chiến dịch; null khi loại / chế độ không cần. */
export function buildZaloPrepareTargets(campaign: MaterializeCampaign, port: ZaloMaterializePort, options: ZaloMaterializeOptions):
  ((api: PrepareTargetsApi) => Promise<PrepareTargetsResult>) | null {
  if (!zaloCampaignMaterializes(campaign)) return null
  const extra = campaign.extraSettings
  const readTimeoutMs = options.readTimeoutMs ?? 120_000
  const callTimeoutMs = options.callTimeoutMs ?? 30_000
  const random = options.random ?? Math.random
  const name = `"${options.campaignName}"`

  return async api => {
    const ctx = (signal: AbortSignal): MaterializeContext => ({ leaseToken: api.leaseToken, signal })
    const db = <T>(label: string, fn: (c: MaterializeContext) => Promise<T>): Promise<T> =>
      withDeadline(label, callTimeoutMs, api.signal, s => fn(ctx(s)))
    const cancelled = (): never => { throw new CancelledError('materialize') }

    /** Như paceZaloCampaignRead: "⏳ Chờ x,y giây trước khi …" rồi nghỉ. */
    const pace = async (label: string): Promise<void> => {
      const delayMs = Math.floor(random() * (READ_MAX_DELAY_MS - READ_MIN_DELAY_MS + 1)) + READ_MIN_DELAY_MS
      api.progress(`⏳ Chờ ${(delayMs / 1000).toFixed(1)} giây trước khi ${label}...`)
      if (!await api.sleep(delayMs)) cancelled()
    }
    /** Như runZaloCampaignReadWith429Retry: 429 thì thử lại sau 15/30/60 giây kèm câu; lỗi khác ném tiếp. */
    const read = async <T>(label: string, fn: (c: MaterializeContext) => Promise<T>): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await withDeadline(label, readTimeoutMs, api.signal, s => fn(ctx(s)))
        } catch (error) {
          if (error instanceof CancelledError || api.signal.aborted) cancelled()
          if (!isZalo429Error(error) || attempt >= READ_429_RETRY_DELAYS_MS.length) throw error
        }
        const delay = READ_429_RETRY_DELAYS_MS[attempt]!
        api.progress(`⚠️ Zalo đang giới hạn request khi ${label}. Tự thử lại sau ${delay / 1000} giây (${attempt + 1}/${READ_429_RETRY_DELAYS_MS.length})...`, 'warning')
        if (!await api.sleep(delay)) cancelled()
      }
    }
    /** Chiến dịch về chờ kèm câu (in khi câu đổi), có thể hẹn chạy lại. */
    const hold = async (note: string, opts: { retryAfterMinutes?: number; lines?: readonly string[] } = {}): Promise<PrepareTargetsResult> => {
      if (opts.retryAfterMinutes === undefined && String(options.campaignNote ?? '').trim() === note) return { kind: 'end', reason: 'wait' }
      api.markStarted()
      for (const text of opts.lines ?? [`⚠️ ${note}`]) api.progress(text, 'warning')
      await db('materialize_hold', c => port.materializeHold(c, { note, status: 'chờ xử lý',
        ...(opts.retryAfterMinutes !== undefined ? { retryAfterMinutes: opts.retryAfterMinutes } : {}) }))
      return { kind: 'end', reason: 'wait', detail: { note } }
    }
    /** Lỗi đọc tạm thời: về chờ, thử lại sau 10 phút. */
    const retryLater = (what: string, error: unknown): Promise<PrepareTargetsResult> => {
      const note = `Chưa lấy được ${what}: ${safeZaloReadMessage(error)}. Tự thử lại sau ${MATERIALIZE_RETRY_MINUTES} phút`
      api.trace({ type: 'materialize_read_failed', error: errorMessage(error) })
      return hold(note, { retryAfterMinutes: MATERIALIZE_RETRY_MINUTES })
    }
    const insert = async (rows: readonly MaterializedRow[], vnDate?: string): Promise<'ok' | 'not_empty'> => {
      try {
        await db('materialize_insert', c => port.materializeInsert(c, rows, vnDate ? { vnDate } : {}))
        return 'ok'
      } catch (error) {
        if (error instanceof MaterializeRpcError && error.reason === 'not_empty') return 'not_empty'
        throw error
      }
    }
    /** Như loadAllFriends trong các hàm lấy bạn bè / sinh nhật của Desktop (trang 1 đã nghỉ trước khi gọi). */
    const loadFriends = async (keep: (profile: NonNullable<ReturnType<typeof friendProfile>>, key: string) => boolean) => {
      const profiles: Array<NonNullable<ReturnType<typeof friendProfile>>> = []
      const seen = new Set<string>()
      for (let page = 1; ; page++) {
        const rows = await read(`đọc trang ${page} danh sách bạn bè Zalo`, c => port.getAllFriendsPage(c, ZALO_FRIEND_PAGE_SIZE, page))
        for (const row of Array.isArray(rows) ? rows : []) {
          const profile = friendProfile(row && typeof row === 'object' ? row as JsonObject : {})
          if (!profile) continue
          const key = uidKey(profile.uid)
          if (!key || seen.has(key) || !keep(profile, key)) continue
          seen.add(key)
          profiles.push(profile)
        }
        if (!Array.isArray(rows) || rows.length < ZALO_FRIEND_PAGE_SIZE) break
        if (page >= FRIEND_PAGE_LIMIT) {
          api.trace({ type: 'materialize_friend_page_limit', pages: page })
          break
        }
        await pace(`đọc trang ${page + 1} danh sách bạn bè Zalo`)
      }
      return profiles
    }
    const saveContacts = async (raws: readonly JsonObject[]): Promise<void> => {
      if (raws.length === 0) return
      try {
        await db('materialize_contacts', c => port.saveFriendContacts(c, raws, campaign.actionId))
      } catch (error) {
        if (error instanceof CancelledError || api.signal.aborted) throw error
        // Danh bạ chỉ là ghi thêm: lỗi không chặn việc thêm data (lỗi ghi DB của mình không đổi kết quả Zalo).
        api.trace({ type: 'materialize_contacts_failed', error: errorMessage(error) })
      }
    }

    try {
      const state = await db('materialize_state', c => port.materializeState(c))
      const markers = state.markers ?? {}

      // ---------- Nhắn bạn bè "toàn bộ" / "theo tag": một lần ----------
      if (campaign.actionId === ZALO_MESSAGE_FRIEND) {
        if (state.total > 0 || markers.zaloFriendDataMaterializedAt) return { kind: 'none' }
        const tagged = zaloFriendTargetMode(extra) === 'tagged_friends'
        let allowed: Set<string> | null = null
        if (tagged) {
          const tagIds: string[] = []
          for (const raw of Array.isArray(extra.zaloFriendSourceTagIds) ? extra.zaloFriendSourceTagIds : []) {
            const id = String(raw ?? '').trim()
            if (id && !tagIds.includes(id)) tagIds.push(id)
          }
          if (tagIds.length === 0) {
            return await hold(NO_FRIEND_DATA_NOTE, { lines: ['⚠️ Chưa chọn tag nguồn Zalo để lấy danh sách bạn bè', `⚠️ ${NO_FRIEND_DATA_NOTE}`] })
          }
          api.markStarted()
          const names = Array.isArray(extra.zaloFriendSourceTagNames) ? extra.zaloFriendSourceTagNames : []
          const tagLabel = tagIds.map((id, index) => String(names[index] || id).trim() || id).join(', ')
          api.progress(`🔄 Đang lấy danh sách hội thoại trong ${tagIds.length} tag Zalo: ${tagLabel}`)
          let uids: string[]
          try {
            await pace('đọc danh sách tag Zalo')
            uids = await read('đọc danh sách tag Zalo', c => port.friendTagConversations(c, tagIds))
          } catch (error) {
            if (error instanceof CancelledError || api.signal.aborted) throw error
            if (error instanceof ZaloSourceTagError) {
              // Desktop: lượt chạy lỗi với câu "Lượt chạy gặp lỗi: Tag Zalo không tồn tại". Cấu hình sai: tạm dừng chiến dịch một lần.
              const note = `Lượt chạy gặp lỗi: ${error.message}`
              api.progress(`⚠️ ${note}`, 'warning')
              await db('materialize_hold', c => port.materializeHold(c, { note, status: 'tạm dừng' }))
              return { kind: 'end', reason: 'config_invalid', detail: { note } }
            }
            return await retryLater('danh sách tag Zalo', error)
          }
          allowed = new Set(uids.map(uidKey).filter(Boolean))
          if (allowed.size === 0) {
            if (await insert([]) === 'not_empty') return { kind: 'retry' }
            api.progress('⚠️ Các tag Zalo đã chọn chưa có bạn bè nào', 'warning')
            return await hold(NO_FRIEND_DATA_NOTE, { lines: [`⚠️ ${NO_FRIEND_DATA_NOTE}`] })
          }
        }
        api.markStarted()
        api.progress(tagged ? '🔄 Đang quét danh sách bạn bè Zalo live để lọc theo tag' : '🔄 Đang quét toàn bộ danh sách bạn bè Zalo live')
        let profiles: Awaited<ReturnType<typeof loadFriends>>
        try {
          await pace('đọc trang 1 danh sách bạn bè Zalo')
          profiles = await loadFriends((_, key) => !allowed || allowed.has(key))
        } catch (error) {
          if (error instanceof CancelledError || api.signal.aborted) throw error
          return await retryLater('danh sách bạn bè Zalo', error)
        }
        await saveContacts(profiles.map(profile => profile.raw))
        if (await insert(profiles.map(p => ({ name: p.name, uid: p.uid, phone: p.phone }))) === 'not_empty') return { kind: 'retry' }
        api.progress(`✅ Đã thêm ${profiles.length} bạn bè Zalo vào chiến dịch ${name}`, 'success')
        if (profiles.length === 0) return await hold(NO_FRIEND_DATA_NOTE, { lines: [`⚠️ ${NO_FRIEND_DATA_NOTE}`] })
        return { kind: 'retry' }
      }

      // ---------- Chúc mừng sinh nhật: mỗi ngày một lần ----------
      if (campaign.actionId === ZALO_MESSAGE_BIRTHDAY) {
        if (state.total > 0) return { kind: 'none' }
        const vnDate = /^\d{4}-\d{2}-\d{2}$/.test(state.vnDate) ? state.vnDate : ''
        if (!vnDate) throw new Error('Không đọc được ngày hiện tại từ máy chủ')
        api.markStarted()
        if (markers.zaloBirthdayDataMaterializedDate === vnDate) {
          api.progress(`🎂 ${NO_BIRTHDAY_NOTE}`)
          return { kind: 'none', note: NO_BIRTHDAY_NOTE }
        }
        const ddmm = `${vnDate.slice(8, 10)}/${vnDate.slice(5, 7)}`
        api.progress(`🔄 Đang quét danh sách bạn bè Zalo live để lọc sinh nhật ${ddmm}`)
        let profiles: Awaited<ReturnType<typeof loadFriends>>
        try {
          await pace('đọc trang 1 danh sách bạn bè Zalo')
          profiles = await loadFriends(profile => profile.sdob.length >= 5 && profile.sdob.slice(0, 5) === ddmm)
        } catch (error) {
          if (error instanceof CancelledError || api.signal.aborted) throw error
          return await retryLater('danh sách bạn bè Zalo', error)
        }
        await saveContacts(profiles.map(profile => profile.raw))
        if (await insert(profiles.map(p => ({ name: p.name, uid: p.uid, phone: p.phone })), vnDate) === 'not_empty') return { kind: 'retry' }
        if (profiles.length === 0) {
          api.progress(`🎂 ${NO_BIRTHDAY_NOTE}`)
          return { kind: 'none', note: NO_BIRTHDAY_NOTE }
        }
        api.progress(`✅ Đã thêm ${profiles.length} bạn bè sinh nhật hôm nay vào chiến dịch ${name}`, 'success')
        return { kind: 'retry' }
      }

      // ---------- Đề xuất Zalo: khi chưa có data và chưa lấy lần nào trong lịch này ----------
      if (campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION) {
        if (state.total > 0) return { kind: 'none' }
        api.markStarted()
        if (markers.zaloFriendRecommendationDataMaterializedAt) {
          api.progress(`⚠️ ${NO_RECOMMENDATION_NOTE}`, 'warning')
          return { kind: 'none', note: NO_RECOMMENDATION_NOTE }
        }
        const count = positiveCount(extra.zaloFriendRecommendationCount)
        api.progress(`🔄 Đang lấy ${count} đề xuất Zalo`)
        let snapshot: ZaloFriendRecommendationSnapshot
        try {
          await pace('đọc danh sách đề xuất Zalo')
          snapshot = await read('đọc danh sách đề xuất Zalo', c => port.getFriendRecommendations(c))
        } catch (error) {
          if (error instanceof CancelledError || api.signal.aborted) throw error
          if (!zaloAnswered(error)) return await retryLater('đề xuất Zalo', error)
          // Như Desktop: Zalo trả lỗi thì đánh dấu đã lấy (0) và hoàn thành chiến dịch kèm câu.
          if (await insert([]) === 'not_empty') return { kind: 'retry' }
          const note = `Không lấy được đề xuất Zalo: ${safeZaloReadMessage(error)}`
          api.progress(`⚠️ ${note}`, 'warning')
          return { kind: 'none', note }
        }
        const selected: MaterializedRow[] = []
        const seen = new Set<string>()
        for (const profile of Array.isArray(snapshot.profiles) ? snapshot.profiles : []) {
          const uid = String(profile?.uid ?? '').trim()
          const key = uidKey(uid)
          if (!key || seen.has(key)) continue
          seen.add(key)
          // Desktop: name = displayName → zaloName (không lùi về UID), SĐT nếu có; không lưu danh bạ.
          selected.push({ name: firstString(profile.displayName, profile.zaloName) ?? '', uid, phone: firstString(profile.phone) ?? '' })
          if (selected.length >= count) break
        }
        const missing = Math.max(0, Number(snapshot.missingUidItems) || 0)
        if (missing > 0) api.progress(`⚠️ Bỏ qua ${missing} đề xuất Zalo thiếu UID`, 'warning')
        if (selected.length === 0) {
          if (await insert([]) === 'not_empty') return { kind: 'retry' }
          const recommended = Math.max(0, Number(snapshot.recommendedItems) || 0)
          const note = snapshot.hasRecommendationList !== true ? 'Zalo không trả danh sách đề xuất để chạy'
            : (Number(snapshot.totalItems) || 0) === 0 || recommended === 0 ? NO_RECOMMENDATION_NOTE
              : missing >= recommended ? 'Danh sách đề xuất Zalo không có UID hợp lệ để chạy'
                : 'Không lấy được đề xuất Zalo để chạy'
          api.progress(`⚠️ ${note}`, 'warning')
          return { kind: 'none', note }
        }
        if (selected.length < count) api.progress(`⚠️ Chỉ lấy được ${selected.length}/${count} đề xuất Zalo`, 'warning')
        if (await insert(selected) === 'not_empty') return { kind: 'retry' }
        api.progress(`✅ Đã thêm ${selected.length} đề xuất Zalo vào chiến dịch ${name}`, 'success')
        return { kind: 'retry' }
      }

      // ---------- Huỷ lời mời kết bạn đã gửi: mỗi lượt khi chưa có data hoặc mọi data đã xong ----------
      if (state.total > 0 && state.done < state.total) return { kind: 'none' }
      api.markStarted()
      if (state.total > 0) {
        try {
          await db('materialize_clear', c => port.materializeClear(c))
        } catch (error) {
          // Data vừa đổi (còn data chưa xong): chạy như thường.
          if (error instanceof MaterializeRpcError && error.reason === 'not_all_done') return { kind: 'none' }
          throw error
        }
      }
      const limit = positiveCount(extra.zaloCancelFriendRequestLimit)
      api.progress(`🔄 Đang lấy danh sách lời mời kết bạn đã gửi từ Zalo để huỷ ${limit} lời mời cũ nhất`)
      let snapshot: ZaloSentFriendRequestSnapshot
      try {
        await pace('đọc danh sách lời mời kết bạn đã gửi')
        snapshot = await read('đọc danh sách lời mời kết bạn đã gửi', c => port.getSentFriendRequests(c))
      } catch (error) {
        if (error instanceof CancelledError || api.signal.aborted) throw error
        if (!zaloAnswered(error)) return await retryLater('danh sách lời mời kết bạn đã gửi từ Zalo', error)
        if (await insert([]) === 'not_empty') return { kind: 'retry' }
        const note = `Không lấy được danh sách lời mời kết bạn đã gửi từ Zalo: ${safeZaloReadMessage(error)}`
        api.progress(`⚠️ ${note}`, 'warning')
        return { kind: 'none', note }
      }
      const missing = Math.max(0, Number(snapshot.missingUidItems) || 0)
      if (missing > 0) api.progress(`⚠️ Bỏ qua ${missing} lời mời Zalo thiếu UID`, 'warning')
      // Như sortZaloSentFriendRequestsOldestFirst: sentAt tăng dần (không có thì cuối), rồi UID.
      const time = (value: unknown): number => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER
      const selected = [...(Array.isArray(snapshot.profiles) ? snapshot.profiles : [])]
        .filter(profile => String(profile?.uid ?? '').trim())
        .sort((left, right) => (time(left.sentAt) - time(right.sentAt)) || String(left.uid).localeCompare(String(right.uid), 'vi'))
        .slice(0, limit)
      if (selected.length === 0) {
        if (await insert([]) === 'not_empty') return { kind: 'retry' }
        api.progress(`⚠️ ${NO_SENT_REQUEST_NOTE}`, 'warning')
        return { kind: 'none', note: NO_SENT_REQUEST_NOTE }
      }
      if (selected.length < limit) api.progress(`⚠️ Chỉ lấy được ${selected.length}/${limit} lời mời kết bạn đã gửi`, 'warning')
      const rows = selected.map(profile => {
        const uid = String(profile.uid).trim()
        return {
          name: firstString(profile.name, profile.displayName, profile.zaloName, uid) ?? uid,
          uid,
          info1: profile.sentAt === null || profile.sentAt === undefined ? '' : String(profile.sentAt),
          info2: firstString(profile.requestMessage) ?? '',
          info3: firstString(profile.globalId) ?? ''
        }
      })
      if (await insert(rows) === 'not_empty') return { kind: 'retry' }
      api.progress(`✅ Đã thêm ${rows.length} lời mời kết bạn đã gửi vào chiến dịch ${name}`, 'success')
      return { kind: 'retry' }
    } catch (error) {
      if (error instanceof MaterializeRpcError) return rpcEnd(error)
      if (error instanceof DeadlineError && !api.signal.aborted) {
        api.trace({ type: 'materialize_deadline', label: error.label })
        return { kind: 'end', reason: 'error', detail: { error: errorMessage(error) } }
      }
      throw error
    }
  }
}
