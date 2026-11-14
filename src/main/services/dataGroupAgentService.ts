import { randomUUID } from 'node:crypto'
import {
  DATA_GROUP_AGENT_CATALOG_LIMITS, DATA_GROUP_AGENT_MESSAGES, dataGroupAgentContext, parseDataGroupAgentResponse,
  redactDataGroupAgentText, validateDataGroupAgentRequest,
  type DataGroupAgentCatalog, type DataGroupAgentPurpose, type DataGroupAgentResult
} from '../../shared/dataGroupAgent'
import type { DataGroupAgentSetting } from '../../shared/dataGroupAgentIpc'
import {
  ZALO_FRIEND_FILTER_ACCOUNTS_RPC, ZALO_FRIEND_FILTER_CREATE_RPC, ZALO_FRIEND_FILTER_LIMITS, ZALO_FRIEND_FILTER_MESSAGES,
  ZALO_FRIEND_FILTER_READ_RPC, ZALO_FRIEND_RECIPIENTS_READ_BATCH, ZaloFriendFilterError, friendFilterTooManyMessagesText,
  parseZaloFriendFilterResult, validateCreateDataGroupFromFriendFilter, validateZaloFriendFilterRequest,
  validateZaloFriendRecipientsRequest, vietnamToday,
  type CreateDataGroupFromFriendFilterResult, type ZaloFriendAccount, type ZaloFriendFilterResult, type ZaloFriendRecipient,
  type ZaloFriendRecipientsResult
} from '../../shared/zaloFriendFilter'
import { requireCurrentUser } from '../data/currentUser'
import { getDataGroupAgentAiConfig } from '../data/repositories/aiRepository'
import * as repo from '../data/repositories/zaloFriendFilterRepository'
import { FriendRpcFailure, type FriendRpcError } from '../data/repositories/zaloFriendFilterRepository'
import { callAiUsing } from './aiRuntimeService'
import { compileDataGroupAgentSchema, dataGroupAgentStructuredOptions } from './formAiSchema'

/**
 * "Thêm nhóm data bằng Agent" và "Agent chọn bạn bè" trên Desktop (docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md). Bản Desktop
 * của module API Web `dataGroupFriendFilter.ts` + lượt chat `dataGroupAgent` của `aka-agent-control.formAi.ts`: cùng hợp
 * đồng (src/shared, chép nguyên văn), cùng hàm DB, cùng công tắc, cùng dòng cấu hình AI (qua proxy AI của API Web).
 *
 * Tải: lượt lọc (đếm thử, lấy danh sách người nhận) tối đa 2 lượt cùng lúc mỗi tiến trình, chờ chỗ tối đa 20 giây. Lượt bị
 * hủy hoặc lỗi đường truyền vẫn giữ chỗ tới hết ngân sách của DB (65 giây) vì không chứng minh được DB đã dừng (như bộ
 * điều phối của API Web). Danh sách tài khoản và danh mục là lượt nhỏ (hạn 35 giây). Không cache, không hẹn giờ.
 */
export const DATA_GROUP_AGENT_SECTION_DESKTOP = 'data_group.friend_agent'
export const FRIEND_READ_BUDGET_MS = 65_000
export const FRIEND_READ_MAX_ACTIVE = 2
export const FRIEND_READ_WAIT_MS = 20_000
const SMALL_READ_MS = 35_000
const CREATE_MS = 65_000

export class DataGroupAgentError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message)
    this.name = 'DataGroupAgentError'
  }
}

export const DATA_GROUP_AGENT_SESSION_INVALID = 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.'
const CANCELLED = 'Đã hủy lượt lọc bạn bè.'
const cancelled = () => new DataGroupAgentError('friend_filter_cancelled', CANCELLED)
const timeout = () => new DataGroupAgentError('friend_filter_timeout', ZALO_FRIEND_FILTER_MESSAGES.friend_filter_timeout)
const busy = () => new DataGroupAgentError('friend_filter_busy', ZALO_FRIEND_FILTER_MESSAGES.friend_filter_busy)
const invalid = (error?: unknown) => new DataGroupAgentError('invalid_friend_filter', ZALO_FRIEND_FILTER_MESSAGES.invalid_friend_filter,
  error instanceof ZaloFriendFilterError ? { path: error.path, reason: error.reason } : undefined)

/** Lỗi do hàm DB ném (mã cố định trong message) thành mã IPC; cùng bảng với API Web, thêm hai trường hợp riêng Desktop. */
export function mapFriendRpcError(error: FriendRpcError): DataGroupAgentError {
  const message = String(error.message ?? '')
  const code = String(error.code ?? '')
  const detail = typeof error.details === 'string' ? error.details : null
  if (message.includes('invalid_friend_filter')) {
    return new DataGroupAgentError('invalid_friend_filter', ZALO_FRIEND_FILTER_MESSAGES.invalid_friend_filter, { path: detail, reason: error.hint ?? null })
  }
  if (message.includes('friend_filter_too_many_messages')) {
    const maxDays = detail !== null && /^\d+$/.test(detail) ? Number(detail) : null
    return new DataGroupAgentError('friend_filter_too_many_messages', friendFilterTooManyMessagesText(maxDays), { maxDays })
  }
  for (const fixed of ['friend_filter_catalog_changed', 'friend_filter_account_unavailable', 'friend_filter_empty', 'friend_filter_request_conflict'] as const) {
    if (message.includes(fixed)) return new DataGroupAgentError(fixed, ZALO_FRIEND_FILTER_MESSAGES[fixed])
  }
  // Riêng Desktop: token gắn sai nhân viên hoặc mật khẩu tự động hóa không còn đúng (đổi mật khẩu ở máy khác).
  if (/automation_auth|desktop_staff_scope_denied/.test(message)) return new DataGroupAgentError('session_invalid', DATA_GROUP_AGENT_SESSION_INVALID)
  // Riêng Desktop: DB chưa có hàm hoặc token Desktop chưa được cấp quyền (V539 chưa apply/đã gỡ).
  if (code === 'PGRST202' || code === '42883' || (code === '42501' && /permission denied for function/i.test(message))) {
    return new DataGroupAgentError('friend_filter_unavailable', ZALO_FRIEND_FILTER_MESSAGES.friend_filter_unavailable)
  }
  if (message.includes('data_group_tenant_not_found') || code === '42501') {
    return new DataGroupAgentError('friend_filter_forbidden', 'Bạn không có quyền dùng tài khoản này.')
  }
  if (code === '57014') return timeout()
  return new DataGroupAgentError('friend_filter_failed', 'Không thể lọc bạn bè lúc này. Vui lòng thử lại.')
}

function rpcError(error: unknown, signal: AbortSignal): DataGroupAgentError {
  if (error instanceof DataGroupAgentError) return error
  if (signal.aborted) return cancelled()
  if (error instanceof FriendRpcFailure) return error.transport ? timeout() : mapFriendRpcError(error.error)
  return new DataGroupAgentError('friend_filter_failed', 'Không thể lọc bạn bè lúc này. Vui lòng thử lại.')
}

// ---------------------------------------------------------------------------------------------------------------
// Công tắc

/** Mở cửa sổ/form: đọc lỗi thì coi như tắt (nút ẩn), không chặn việc khác. */
export async function readDataGroupAgentSettingSafe(): Promise<DataGroupAgentSetting> {
  try {
    return await repo.readDataGroupAgentSetting(AbortSignal.timeout(SMALL_READ_MS))
  } catch {
    return { audience: 'off', campaignForm: false }
  }
}

/** Đọc lại công tắc ở mỗi lượt (như API Web): `off`, thiếu quyền admin akaBiz, hay tắt riêng form chiến dịch thì từ chối. */
export async function assertDataGroupAgentAccess(signal: AbortSignal, purpose: DataGroupAgentPurpose = 'data_group'): Promise<void> {
  const user = requireCurrentUser()
  let setting: DataGroupAgentSetting
  try { setting = await repo.readDataGroupAgentSetting(signal) }
  catch {
    if (signal.aborted) throw cancelled()
    throw new DataGroupAgentError('data_group_agent_unavailable', 'Không thể kiểm tra cấu hình Agent. Vui lòng thử lại.')
  }
  if (setting.audience === 'off') throw new DataGroupAgentError('data_group_agent_forbidden', 'Agent tạo nhóm data đang tạm tắt.')
  if (purpose === 'campaign_recipients' && !setting.campaignForm) {
    throw new DataGroupAgentError('data_group_agent_forbidden', 'Agent chọn bạn bè trong form chiến dịch đang tạm tắt.')
  }
  if (setting.audience === 'admin_akabiz' && user.isAdminAkabiz !== true) {
    throw new DataGroupAgentError('data_group_agent_forbidden', 'Tài khoản này chưa được dùng Agent tạo nhóm data.')
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Giới hạn lượt lọc nặng

let active = 0
const waiters: Array<() => void> = []

function release(): void {
  active--
  waiters.shift()?.()
}

/** Chờ chỗ (tối đa 20 giây, hủy được); quá thì báo bận, không xếp hàng vô hạn. */
async function acquire(signal: AbortSignal): Promise<void> {
  if (active < FRIEND_READ_MAX_ACTIVE) { active++; return }
  await new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); active++; resolve() }
    const drop = (error: DataGroupAgentError) => {
      const index = waiters.indexOf(done)
      if (index >= 0) waiters.splice(index, 1)
      clearTimeout(timer); signal.removeEventListener('abort', onAbort)
      reject(error)
    }
    const onAbort = () => drop(cancelled())
    const timer = setTimeout(() => drop(busy()), FRIEND_READ_WAIT_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    waiters.push(done)
  })
}

async function heavyRead<T>(signal: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  await acquire(signal)
  const started = Date.now()
  let hold = false
  try {
    return await run(signal)
  } catch (error) {
    hold = signal.aborted || error instanceof FriendRpcFailure && error.transport
    throw error
  } finally {
    if (hold) {
      const timer = setTimeout(release, Math.max(0, started + FRIEND_READ_BUDGET_MS - Date.now()))
      timer.unref?.()
    } else {
      release()
    }
  }
}

/** Chỉ cho bộ kiểm: số lượt đang giữ chỗ. */
export function friendReadSlotsInUse(): number {
  return active
}

// ---------------------------------------------------------------------------------------------------------------
// Ánh xạ phản hồi (cùng luật với API Web)

type Row = Record<string, unknown>
const record = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 255): string => typeof value === 'string' ? value.trim().slice(0, max) : ''
const iso = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
const positiveId = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
const badResponse = () => new DataGroupAgentError('friend_filter_response', 'Phản hồi lọc bạn bè không hợp lệ.')

export function mapFriendAccount(row: unknown): ZaloFriendAccount | null {
  if (!record(row) || positiveId(row.id) === null) return null
  return {
    id: positiveId(row.id)!,
    name: text(row.name) || `Tài khoản #${row.id}`,
    kind: row.kind === 'server' || row.kind === 'web' ? row.kind : 'desktop',
    available: row.available === true,
    friendCount: count(row.friendCount),
    friendsUpdatedAt: iso(row.friendsUpdatedAt)
  }
}

export function mapFriendCatalog(value: unknown): DataGroupAgentCatalog {
  if (!record(value) || value.version !== 1 || !record(value.account)) throw badResponse()
  const account = mapFriendAccount(value.account)
  if (!account) throw badResponse()
  const list = (input: unknown) => Array.isArray(input) ? input.filter(record) : []
  const coverage = record(value.coverage) ? value.coverage : {}
  const maxDays = typeof coverage.maxMessageDays === 'number' && Number.isSafeInteger(coverage.maxMessageDays)
    ? Math.min(365, Math.max(0, coverage.maxMessageDays)) : 365
  return {
    account,
    zaloTags: list(value.zaloTags).slice(0, DATA_GROUP_AGENT_CATALOG_LIMITS.zaloTags)
      .flatMap(tag => typeof tag.id === 'string' && tag.id ? [{ id: tag.id, name: text(tag.name, 200) || tag.id, count: count(tag.count) }] : []),
    akaBizTags: list(value.akaBizTags).slice(0, DATA_GROUP_AGENT_CATALOG_LIMITS.akaBizTags)
      .flatMap(tag => positiveId(tag.id) ? [{ id: positiveId(tag.id)!, name: text(tag.name, 200) }] : []),
    dataGroups: list(value.dataGroups).slice(0, DATA_GROUP_AGENT_CATALOG_LIMITS.dataGroups)
      .flatMap(group => positiveId(group.id) ? [{ id: positiveId(group.id)!, name: text(group.name) }] : []),
    dataGroupsIncomplete: value.dataGroupsIncomplete === true,
    campaigns: list(value.campaigns).slice(0, DATA_GROUP_AGENT_CATALOG_LIMITS.campaigns)
      .flatMap(campaign => positiveId(campaign.id) ? [{ id: positiveId(campaign.id)!, name: text(campaign.name) }] : []),
    campaignsIncomplete: value.campaignsIncomplete === true,
    coverage: {
      messagesSince: iso(coverage.messagesSince), trackingSince: iso(coverage.trackingSince),
      deliveredAvailable: coverage.deliveredAvailable === true, maxMessageDays: maxDays
    }
  }
}

const filterSize = (filter: unknown) => Buffer.byteLength(JSON.stringify(filter)) > 64 * 1024

async function smallRpc(name: string, params: Row, signal: AbortSignal): Promise<unknown> {
  const inner = AbortSignal.any([signal, AbortSignal.timeout(SMALL_READ_MS)])
  try { return await repo.callFriendRpc(name, params, inner) }
  catch (error) { throw rpcError(error, signal) }
}

// ---------------------------------------------------------------------------------------------------------------
// Các lượt của cửa sổ Agent

/** Tài khoản Zalo của nhân viên kèm số bạn bè (một lượt khi mở cửa sổ). */
export async function listFriendAccounts(signal: AbortSignal): Promise<{ accounts: ZaloFriendAccount[] }> {
  await assertDataGroupAgentAccess(signal)
  const data = await smallRpc(ZALO_FRIEND_FILTER_ACCOUNTS_RPC, {}, signal)
  if (!record(data) || !Array.isArray(data.accounts)) throw badResponse()
  return { accounts: data.accounts.map(mapFriendAccount).filter((item): item is ZaloFriendAccount => item !== null) }
}

async function readCatalog(accountId: number, signal: AbortSignal): Promise<DataGroupAgentCatalog> {
  return mapFriendCatalog(await smallRpc('aka_agent_read_zalo_friend_catalog_v1', { p_account_id: accountId }, signal))
}

/**
 * Một lượt chat = một lần gọi AI. Danh mục (tag, nhóm, chiến dịch) đọc theo đúng tài khoản; mô tả của người dùng được che
 * SĐT/UID/email lần nữa ở main. Lỗi trả về dạng `{ ok: false }` của hợp đồng (như API Web).
 */
export async function runDataGroupAgentTurn(input: unknown, signal: AbortSignal): Promise<DataGroupAgentResult> {
  let request
  try { request = validateDataGroupAgentRequest(input) }
  catch { return { ok: false, code: 'invalid', message: DATA_GROUP_AGENT_MESSAGES.invalid } }
  try {
    await assertDataGroupAgentAccess(signal, request.purpose)
    const catalog = await readCatalog(request.accountId, signal)
    signal.throwIfAborted()
    if (catalog.account.friendCount === 0) return { ok: false, code: 'no_friends', message: DATA_GROUP_AGENT_MESSAGES.noFriends }
    const config = await getDataGroupAgentAiConfig(DATA_GROUP_AGENT_SECTION_DESKTOP, AbortSignal.any([signal, AbortSignal.timeout(SMALL_READ_MS)]))
    signal.throwIfAborted()
    if (!config) return { ok: false, code: 'not_configured', message: DATA_GROUP_AGENT_MESSAGES.notConfigured }
    let validateContent: (content: string) => boolean
    let structured: Record<string, unknown>
    try {
      validateContent = compileDataGroupAgentSchema(config.outputSchema)
      structured = dataGroupAgentStructuredOptions(config.model.provider, config.model.endpoint, config.outputSchema)
    } catch {
      return { ok: false, code: 'not_configured', message: DATA_GROUP_AGENT_MESSAGES.notConfigured }
    }
    const safe = { ...request, message: redactDataGroupAgentText(request.message),
      history: request.history.map(turn => ({ role: turn.role, text: redactDataGroupAgentText(turn.text) })) }
    const user = requireCurrentUser()
    const result = await callAiUsing(config.using.code, {
      dataGroupAgentContext: JSON.stringify(dataGroupAgentContext(safe, catalog)),
      bodyOverrides: structured
    }, { organizationId: user.organizationId, accountId: request.accountId }, { signal, formConfig: config, validateContent })
    signal.throwIfAborted()
    if (!result.ok) return { ok: false, code: 'unavailable', message: DATA_GROUP_AGENT_MESSAGES.unavailable }
    return parseDataGroupAgentResponse(result.content, request, catalog, { makeSeed: () => randomUUID() })
  } catch (error) {
    if (signal.aborted) return { ok: false, code: 'cancelled', message: '' }
    if (error instanceof DataGroupAgentError) {
      if (error.code === 'data_group_agent_forbidden') return { ok: false, code: 'forbidden', message: error.message }
      if (error.code === 'friend_filter_account_unavailable' || error.code === 'friend_filter_forbidden') {
        return { ok: false, code: 'account_unavailable', message: DATA_GROUP_AGENT_MESSAGES.accountUnavailable }
      }
      if (error.code === 'friend_filter_unavailable' || error.code === 'session_invalid') {
        return { ok: false, code: 'unavailable', message: error.message }
      }
    }
    return { ok: false, code: 'unavailable', message: DATA_GROUP_AGENT_MESSAGES.unavailable }
  }
}

/** Đếm thử / 20 người đầu / lấy mã (chỉ đọc). */
export async function filterZaloFriends(input: unknown, signal: AbortSignal): Promise<ZaloFriendFilterResult> {
  let request
  try { request = validateZaloFriendFilterRequest(input, vietnamToday()) }
  catch (error) { throw invalid(error) }
  if (filterSize(request.filter)) throw invalid()
  await assertDataGroupAgentAccess(signal)
  return heavyRead(signal, async inner => {
    const deadline = AbortSignal.any([inner, AbortSignal.timeout(FRIEND_READ_BUDGET_MS)])
    let data: unknown
    try {
      data = await repo.callFriendRpc(ZALO_FRIEND_FILTER_READ_RPC, {
        p_request: { mode: request.mode, filter: request.filter, offset: request.offset, limit: request.limit }
      }, deadline)
    } catch (error) {
      if (error instanceof FriendRpcFailure && error.transport) throw error
      throw rpcError(error, inner)
    }
    if (inner.aborted) throw cancelled()
    try { return parseZaloFriendFilterResult(data, request.mode) }
    catch { throw badResponse() }
  }).catch(error => { throw rpcError(error, signal) })
}

/**
 * "Agent chọn bạn bè": một lượt lọc chế độ `ids` (cùng hàm DB, cùng giới hạn lượt với đếm thử) rồi đọc UID và tên theo khóa
 * chính, từng lô 500 tuần tự. Hơn 5.000 người thì từ chối. Không ghi gì; form tự thêm vào danh sách người nhận.
 */
export async function readZaloFriendRecipients(input: unknown, signal: AbortSignal): Promise<ZaloFriendRecipientsResult> {
  let request
  try { request = validateZaloFriendRecipientsRequest(input, vietnamToday()) }
  catch (error) { throw invalid(error) }
  if (filterSize(request.filter)) throw invalid()
  await assertDataGroupAgentAccess(signal, 'campaign_recipients')
  return heavyRead(signal, async inner => {
    const deadline = AbortSignal.any([inner, AbortSignal.timeout(FRIEND_READ_BUDGET_MS)])
    let data: unknown
    try {
      data = await repo.callFriendRpc(ZALO_FRIEND_FILTER_READ_RPC, { p_request: { mode: 'ids', filter: request.filter, offset: null, limit: null } }, deadline)
    } catch (error) {
      if (error instanceof FriendRpcFailure && error.transport) throw error
      throw rpcError(error, inner)
    }
    if (inner.aborted) throw cancelled()
    if (record(data) && count(data.matched) > ZALO_FRIEND_FILTER_LIMITS.resultLimit) {
      throw new DataGroupAgentError('friend_recipients_too_many', ZALO_FRIEND_FILTER_MESSAGES.friend_recipients_too_many,
        { matched: count(data.matched), max: ZALO_FRIEND_FILTER_LIMITS.resultLimit })
    }
    let result: ZaloFriendFilterResult
    try { result = parseZaloFriendFilterResult(data, 'ids') }
    catch { throw badResponse() }
    const ids = result.contactIds ?? []
    const found = new Map<number, ZaloFriendRecipient>()
    for (let start = 0; start < ids.length; start += ZALO_FRIEND_RECIPIENTS_READ_BATCH) {
      if (inner.aborted) throw cancelled()
      const batch = await repo.readFriendRecipientBatch(result.accountId, ids.slice(start, start + ZALO_FRIEND_RECIPIENTS_READ_BATCH),
        AbortSignal.any([inner, AbortSignal.timeout(SMALL_READ_MS)]))
      for (const row of batch) found.set(row.contactId, row)
    }
    const recipients = ids.flatMap(contactId => found.get(contactId) ?? [])
    return { version: 1 as const, accountId: result.accountId, totalFriends: result.totalFriends, matched: result.matched,
      recipients, missing: ids.length - recipients.length, notes: result.notes, evaluatedAt: result.evaluatedAt }
  }).catch(error => { throw rpcError(error, signal) })
}

let creating = false

/** Tạo nhóm data + nạp thành viên trong một giao dịch của DB; một lượt mỗi tiến trình; cùng requestId thì DB trả kết quả cũ. */
export async function createDataGroupFromFriendFilter(input: unknown, signal: AbortSignal): Promise<CreateDataGroupFromFriendFilterResult> {
  let request
  try { request = validateCreateDataGroupFromFriendFilter(input, vietnamToday()) }
  catch (error) { throw invalid(error) }
  await assertDataGroupAgentAccess(signal)
  if (creating) throw new DataGroupAgentError('friend_filter_busy', 'Đang tạo nhóm, vui lòng chờ.')
  creating = true
  try {
    let data: unknown
    try { data = await repo.callFriendRpc(ZALO_FRIEND_FILTER_CREATE_RPC, { p_request: request }, AbortSignal.any([signal, AbortSignal.timeout(CREATE_MS)])) }
    catch (error) {
      // Lỗi đường truyền khi tạo nhóm: không biết DB đã ghi chưa. Bấm lại dùng cùng requestId nên không tạo nhóm thứ hai.
      if (error instanceof FriendRpcFailure && error.transport) {
        throw new DataGroupAgentError('friend_filter_timeout', 'Chưa nhận được kết quả tạo nhóm. Bấm Tạo nhóm lại để kiểm tra (không tạo trùng).')
      }
      throw rpcError(error, signal)
    }
    if (!record(data) || positiveId(data.groupId) === null || positiveId(data.filterId) === null) throw badResponse()
    return { groupId: positiveId(data.groupId)!, filterId: positiveId(data.filterId)!, matched: count(data.matched),
      inserted: count(data.inserted), replayed: data.replayed === true }
  } finally {
    creating = false
  }
}
