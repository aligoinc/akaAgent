/**
 * Phần dùng chung cho các loại chiến dịch Zalo trong lõi, tách từ bộ chạy Desktop/VPS (campaignScheduler.ts,
 * zaloRuntimeService.ts). Giữ đúng cách chuẩn hoá hồ sơ, nhãn và dựng mẫu nội dung của Desktop.
 */
import type { Evidence, Phase, RawOutcome, Signal } from '../contracts.js'
import { CancelledError, DeadlineError, errorMessage, isTransientDbError } from '../boundary.js'
import { renderCampaignTemplateText } from '../content/campaignContentTemplate.js'
import { renderContentSpin } from '../content/contentSpin.js'
import { normalizeVietnamMobilePhone } from '../content/phone.js'
import { replaceStopMessagesLink, type StopMessagesRenderState } from '../content/zaloMessageOptOut.js'

/** Hồ sơ Zalo đã chuẩn hoá (ZaloFoundUser của zaloRuntimeService). */
export interface ZaloFoundUser {
  uid: string
  phone?: string
  globalId?: string
  displayName?: string
  originalName?: string
  gender?: number | string | null
  avatar?: string
  raw: Record<string, unknown>
}

/** Mục tiêu đã xác định (ZaloResolvedTarget của Desktop). */
export interface ZaloResolvedTarget {
  uid: string
  phone: string
  globalId?: string
  displayName?: string
  originalName?: string
  gender?: number | string | null
  isFriend?: boolean | null
  raw?: Record<string, unknown>
}

export function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = String(value || '').trim()
    if (trimmed) return trimmed
  }
  return null
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return { ...(value as Record<string, unknown>) }
}

/** Như normalizeFoundUser của zaloRuntimeService: hồ sơ thô (zca-js, runtime Fly) → ZaloFoundUser; không có UID thì null. */
export function normalizeZaloFoundUser(user: unknown): ZaloFoundUser | null {
  if (!user || typeof user !== 'object') return null
  const u = user as Record<string, unknown>
  const raw = record(user)
  const uid = firstString(u.uid, u.userId, u.globalId)
  if (!uid) return null
  const result: ZaloFoundUser = { uid, gender: (u.gender as number | string | null | undefined) ?? null, raw }
  const phone = firstString(u.phoneNumber, u.phone)
  const globalId = firstString(u.globalId, u.global_id)
  const displayName = firstString(u.display_name, u.displayName, u.zalo_name, u.zaloName)
  const originalName = firstString(u.zalo_name, u.zaloName, u.display_name, u.displayName)
  const avatar = firstString(u.avatar)
  if (phone) result.phone = phone
  if (globalId) result.globalId = globalId
  if (displayName) result.displayName = displayName
  if (originalName) result.originalName = originalName
  if (avatar) result.avatar = avatar
  return result
}

/** Như normalizeZaloTarget của campaignScheduler (mục tiêu tìm được bằng SĐT). */
export function zaloTargetFromFoundUser(phone: string, user: ZaloFoundUser, isFriend?: boolean): ZaloResolvedTarget {
  const target: ZaloResolvedTarget = {
    uid: user.uid,
    phone,
    displayName: user.displayName || user.originalName || '',
    originalName: user.originalName || user.displayName || '',
    gender: user.gender ?? null,
    raw: { ...user.raw, profileAvatar: user.avatar || null }
  }
  const globalId = firstString(user.globalId, user.raw?.globalId, user.raw?.global_id)
  if (globalId) target.globalId = globalId
  if (isFriend !== undefined) target.isFriend = isFriend
  return target
}

/**
 * Như normalizeZaloTargetFromInputData của Desktop: mục tiêu theo UID của data (thành viên nhóm, khách cũ…). Tên hiển thị lấy
 * tên của data, không có thì UID; isFriend=false cho người lạ.
 */
export function zaloTargetFromInput(uid: string, input: Record<string, unknown>, raw: Record<string, unknown>, isFriend: boolean): ZaloResolvedTarget {
  const target: ZaloResolvedTarget = {
    uid,
    phone: firstString(input.phone) ?? '',
    displayName: firstString(input.name, uid) ?? uid,
    gender: null,
    isFriend,
    raw: { ...raw, inputData: input }
  }
  const originalName = firstString(input.originalName, input.zaloName, input.zalo_name)
  if (originalName) target.originalName = originalName
  return target
}

/** Như mergeZaloFriendProfileTarget của Desktop: ghép hồ sơ đọc theo UID vào mục tiêu (SĐT, global ID, tên). */
export function mergeZaloProfileTarget(target: ZaloResolvedTarget, profile: ZaloFoundUser | null): ZaloResolvedTarget {
  if (!profile) return target
  const merged: ZaloResolvedTarget = {
    ...target,
    phone: firstString(profile.phone, profile.raw?.phoneNumber, profile.raw?.phone, target.phone) ?? '',
    gender: profile.gender ?? null,
    raw: { ...(target.raw || {}), profileUid: profile.uid, profileAvatar: profile.avatar || null, profile: profile.raw }
  }
  const displayName = firstString(profile.displayName, target.displayName)
  if (displayName) merged.displayName = displayName; else delete merged.displayName
  const originalName = firstString(profile.raw?.zaloName, profile.raw?.zalo_name, profile.originalName)
  if (originalName) merged.originalName = originalName; else delete merged.originalName
  const globalId = firstString(profile.globalId, profile.raw?.globalId, profile.raw?.global_id, target.globalId)
  if (globalId) merged.globalId = globalId; else delete merged.globalId
  return merged
}

/** Như getZaloTargetLabel. */
export function zaloTargetLabel(target: ZaloResolvedTarget | null | undefined): string {
  return target?.displayName || target?.originalName || target?.phone || target?.uid || 'target'
}

/** Như firstNormalizedVietnamMobilePhone. */
export function firstNormalizedVietnamMobilePhone(...values: unknown[]): string {
  for (const value of values) {
    const phone = normalizeVietnamMobilePhone(value)
    if (phone) return phone
  }
  return ''
}

/** Như templateUsesDatabaseDate: mẫu có ngày tương đối thì cần giờ nghiệp vụ của DB. */
export function templateUsesDatabaseDate(template: string | undefined | null): boolean {
  return /#\{(?:TODAY|TOMORROW|YESTERDAY)\([^}]*\)\}/.test(String(template || ''))
}

/**
 * Như renderZaloTemplateText (nội dung không định dạng): xoay chữ, biến mẫu, SĐT chuẩn hoá; có optOut thì
 * thay #{STOP_MESSAGES_LINK} sau bước xoay chữ.
 */
export function renderZaloTemplateText(
  template: string | undefined | null,
  inputData: Record<string, unknown> | undefined,
  target: ZaloResolvedTarget | null | undefined,
  businessNow: Date | undefined,
  optOut?: { linkId: string | null; enabled: boolean; state: StopMessagesRenderState }
): string {
  return renderCampaignTemplateText(template, inputData, target, businessNow, {
    spin: text => renderContentSpin(text),
    phone: (...values) => firstNormalizedVietnamMobilePhone(...values),
    ...(optOut ? { afterSpin: (text: string) => replaceStopMessagesLink(text, optOut.linkId, optOut.enabled, optOut.state) } : {})
  })
}

/**
 * Lỗi của cổng Zalo, đã đổi thành tín hiệu thô. `code` là mã mà bước tra số dùng để quyết định thử reqSrc 40
 * (mã Zalo, errno, mã lệnh Fly); rỗng khi không có mã.
 */
export class ZaloPortError extends Error {
  readonly code: string
  readonly signal: Signal
  readonly phase: Phase | undefined
  readonly evidence: Evidence | undefined
  constructor(message: string, init: { code?: string | null; signal: Signal; phase?: Phase; evidence?: Evidence }) {
    super(message)
    this.name = 'ZaloPortError'
    this.code = String(init.code ?? '').trim()
    this.signal = init.signal
    this.phase = init.phase
    this.evidence = init.evidence
  }
}

/**
 * Loại thao tác của lời gọi Zalo: 'read' (tra số, đọc hồ sơ, kiểm lời mời…) không giao gì cho người nhận nên lỗi
 * không phải câu trả lời của Zalo luôn là "chưa gửi"; 'send' (gửi tin, kết bạn…) thì lỗi đường truyền sau khi
 * kết nối đã mở có thể là đã tới.
 */
export type ZaloOperation = 'read' | 'send'

/** errno của lỗi mở kết nối (DNS, từ chối, không có đường): yêu cầu chưa tới máy chủ, chắc chắn chưa gửi gì. */
const PRE_CONNECT_ERRNO = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN',
  'ENETDOWN', 'EADDRNOTAVAIL', 'UND_ERR_CONNECT_TIMEOUT'])
/** errno của lỗi đường truyền có thể xảy ra sau khi yêu cầu đã đi (đứt giữa chừng, hết giờ chờ trả lời). */
const IN_TRANSIT_ERRNO = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'EPROTO', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED', 'UND_ERR_ABORTED', 'ERR_STREAM_PREMATURE_CLOSE'])
/** Câu lỗi đường truyền không kèm errno (fetch của Node/undici, runtime Fly chỉ chuyển câu lỗi). */
const TRANSPORT_MESSAGE = /^(?:fetch failed|terminated|socket hang up|other side closed)\b|\b(?:ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE)\b|network error|socket hang up/i
/** Câu lỗi mở kết nối (syscall connect/getaddrinfo) khi chỉ có câu, không có errno. */
const PRE_CONNECT_MESSAGE = /^(?:connect|getaddrinfo) E[A-Z_]+\b|\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b/
/** zca-js: máy chủ trả HTTP lỗi (handleZaloResponse), không có mã Zalo. */
const HTTP_STATUS_MESSAGE = /Request failed with status code (\d{3})\b/
/** zca-js: có phản hồi nhưng không đọc được, không biết yêu cầu đã được xử lý chưa. */
const UNREADABLE_RESPONSE_MESSAGE = /Failed to parse response data/i

/**
 * Câu lỗi Zalo dùng trong tín hiệu và nhật ký cho khách. Zalo trả mã mà câu rỗng (ZaloApiError("")) thì không lấy tên lớp lỗi
 * ("ZcaApiError" là chữ kỹ thuật) mà dùng câu chung, như runtime Fly vẫn làm.
 */
function zaloErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : errorMessage(error)
  return String(text ?? '').trim() || 'Lỗi Zalo chưa xác định'
}

function errnoOf(error: unknown): { code: string; syscall: string } | null {
  let current = error as { code?: unknown; syscall?: unknown; cause?: unknown } | null
  for (let depth = 0; current && depth < 4; depth++) {
    const code = typeof current.code === 'string' ? current.code.trim() : ''
    if (code && !/^-?\d+$/.test(code)) return { code, syscall: typeof current.syscall === 'string' ? current.syscall : '' }
    current = (current.cause ?? null) as typeof current
  }
  return null
}

function causeMessage(error: unknown): string {
  const cause = (error as { cause?: unknown } | null)?.cause
  return cause ? errorMessage(cause).trim() : ''
}

/**
 * Lỗi của một lời gọi Zalo → tín hiệu và pha, theo loại thao tác:
 * - mã số là câu trả lời của Zalo: after_send;
 * - HTTP lỗi: thao tác đọc là chưa gửi; gửi thì 429 là chưa xử lý, 5xx không rõ, 4xx khác là bị từ chối;
 * - lỗi đường truyền: thao tác đọc là chưa gửi; gửi thì lỗi mở kết nối là chưa gửi, còn lại không rõ;
 * - phản hồi không đọc được: thao tác đọc là chưa gửi, gửi thì không rõ;
 * - câu lỗi khác: Zalo trả lời không kèm mã (answered) thì after_send; không phải câu trả lời của Zalo (hết giờ
 *   chờ, chưa có phiên…) thì thao tác đọc là chưa gửi, còn gửi thì không rõ (không biết lỗi xảy ra trước hay sau
 *   khi yêu cầu đi, như cổng Desktop trước đây; chỉ lỗi chắc chắn trước khi gửi mới được trả về hàng đợi).
 * Pha before_send/in_flight để DB xếp lỗi hạ tầng (NET01, UNK01) thay vì lỗi nghiệp vụ Zalo.
 */
export function classifyZaloError(error: unknown, operation: ZaloOperation, answered: boolean):
  { signal: Signal; phase: Phase; deliveryUnknown: boolean } {
  const message = zaloErrorText(error)
  const rawCode = (error as { code?: unknown } | null)?.code
  const ownCode = rawCode === null || rawCode === undefined ? '' : String(rawCode).trim()
  const read = operation === 'read'
  const unknown = { phase: 'in_flight' as const, deliveryUnknown: true }
  const notSent = { phase: 'before_send' as const, deliveryUnknown: false }
  const rejected = { phase: 'after_send' as const, deliveryUnknown: false }

  if (/^-?\d+$/.test(ownCode)) return { signal: { kind: 'zalo_code', code: ownCode, message }, ...rejected }

  const http = HTTP_STATUS_MESSAGE.exec(message)
  const status = http ? Number(http[1]) : Number((error as { status?: unknown; response?: { status?: unknown } } | null)?.status
    ?? (error as { response?: { status?: unknown } } | null)?.response?.status)
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    const signal: Signal = { kind: 'http_status', code: String(status), message }
    if (read || status === 429) return { signal, ...notSent }
    return { signal, ...(status >= 500 ? unknown : rejected) }
  }

  const errno = errnoOf(error)
  const detail = causeMessage(error)
  const text = detail && detail !== message ? `${message} (${detail})` : message
  const transport = errno !== null && (PRE_CONNECT_ERRNO.has(errno.code) || IN_TRANSIT_ERRNO.has(errno.code))
    || TRANSPORT_MESSAGE.test(message) || (detail !== '' && TRANSPORT_MESSAGE.test(detail))
  if (transport) {
    const signal: Signal = errno ? { kind: 'errno', code: errno.code, message: text } : { kind: 'message_like', message: text }
    const preConnect = errno !== null && (PRE_CONNECT_ERRNO.has(errno.code) || errno.syscall === 'connect' || errno.syscall === 'getaddrinfo')
      || PRE_CONNECT_MESSAGE.test(message) || PRE_CONNECT_MESSAGE.test(detail)
    return { signal, ...(read || preConnect ? notSent : unknown) }
  }

  if (UNREADABLE_RESPONSE_MESSAGE.test(message)) {
    return { signal: { kind: 'message_like', message }, ...(read ? notSent : unknown) }
  }
  const signal: Signal = errno ? { kind: 'errno', code: errno.code, message: text } : { kind: 'message_like', message }
  if (answered) return { signal, ...rejected }
  return { signal, ...(read ? notSent : unknown) }
}

/**
 * Lỗi gốc của nền tảng → ZaloPortError theo đúng cách Desktop đọc mã (getZaloErrorCode): mã số là mã Zalo,
 * mã chữ là errno (không có luật riêng thì về luật bắt-tất-cả như hôm nay), không có mã thì là câu lỗi.
 * Có `operation` thì pha theo classifyZaloError (`answered`: lỗi do Zalo trả về, như ZaloApiError của zca-js).
 * Huỷ / hết giờ của lõi được ném tiếp nguyên vẹn.
 */
export function zaloPortErrorFrom(error: unknown,
  options: { phase?: Phase; deliveryUncertain?: boolean; operation?: ZaloOperation; answered?: boolean } = {}): Error {
  if (error instanceof ZaloPortError || error instanceof CancelledError || error instanceof DeadlineError) return error as Error
  // Huỷ từ AbortSignal (fetch, zca-js) không phải kết quả của Zalo.
  if ((error as { name?: unknown } | null)?.name === 'AbortError') return new CancelledError('zalo')
  const message = zaloErrorText(error)
  const rawCode = (error as { code?: unknown } | null)?.code
  const code = rawCode === null || rawCode === undefined ? '' : String(rawCode).trim()
  if (options.operation) {
    const classified = classifyZaloError(error, options.operation, options.answered === true)
    // `code` giữ đúng mã của lỗi gốc (không lấy errno của cause): bước tra số dùng nó để quyết định thử reqSrc 40 như Desktop.
    return new ZaloPortError(message, {
      code, signal: classified.signal, phase: classified.phase,
      ...(classified.deliveryUnknown ? { evidence: { deliveryState: 'unknown' as const } } : {})
    })
  }
  const signal: Signal = /^-?\d+$/.test(code)
    ? { kind: 'zalo_code', code, message }
    : code ? { kind: 'errno', code, message } : { kind: 'message_like', message }
  return new ZaloPortError(message, {
    code, signal,
    ...(options.deliveryUncertain ? { phase: 'in_flight' as const, evidence: { deliveryState: 'unknown' as const } }
      : options.phase ? { phase: options.phase } : {})
  })
}

/** Ngoại lệ của cổng → kết quả thô. Lỗi khác (lỗi code, huỷ) ném tiếp để runUnit xử lý. */
export function zaloFailure(error: unknown, fallbackPhase: Phase, data?: Record<string, unknown>): RawOutcome {
  if (!(error instanceof ZaloPortError)) throw error
  return {
    ok: false, phase: error.phase ?? fallbackPhase, signal: error.signal,
    ...(error.evidence ? { evidence: error.evidence } : {}), ...(data ? { data } : {})
  }
}

/**
 * Lỗi khi chuẩn bị nội dung (lấy vị trí xoay vòng, giờ nghiệp vụ): chưa gửi gì. DB của mình lỗi tạm thời thì tín hiệu
 * engine db_unavailable (luật DB quyết định mã và hệ quả); lỗi khác là lỗi hệ thống. Truyền lỗi gốc, không truyền
 * CampaignContentRotationError (lớp bọc này làm mất mã lỗi DB).
 */
export function preparationFailure(error: unknown, data?: Record<string, unknown>): RawOutcome {
  if (error instanceof CancelledError) throw error
  if (error instanceof ZaloPortError) return zaloFailure(error, 'before_send', data)
  const signal: Signal = isTransientDbError(error)
    ? { kind: 'engine', code: 'db_unavailable', message: errorMessage(error) }
    : { kind: 'exception', message: errorMessage(error).slice(0, 500) }
  return { ok: false, phase: 'before_send', signal, ...(data ? { data } : {}) }
}
