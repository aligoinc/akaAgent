import {
  UID_ACCOUNT_GUARD_DEADLINE_MS, UID_ACCOUNT_GUARD_DESKTOP_RPC, UID_ACCOUNT_GUARD_MAX_ACCOUNTS,
  chunkGuardUids, collectGuardUids, dropGuardBlockedRows, mergeUidGuardChunks, parseUidGuardCampaignResult, parseUidGuardUidsResult,
  uidAccountGuardApplies, uidGuardDetails, uidGuardResumeVerdict, uidGuardSaveVerdict,
  type UidAccountGuardCheckResponse, type UidGuardAccountResult, type UidGuardCampaignResult
} from '../../shared/campaignUidAccountGuard'
import { getSupabaseClient } from '../data/supabaseClient'
import type { UidAccountGuardIpcResult } from '../../shared/campaignUidAccountGuardIpc'

/**
 * Chặn lưu chiến dịch Zalo khi danh sách người nhận được quét bằng tài khoản khác (DAT04, V679;
 * docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md). Luật nằm ở DB (aka_agent_campaign_uid_account_check_v1, nhân viên lấy từ phiên).
 * - Renderer hỏi trước khi lưu qua IPC `campaign:uid-account-guard` để hiện hộp báo có nút.
 * - Handler của tiến trình chính kiểm lại ở đường lưu từ giao diện (đổi tài khoản, Thêm data, Tiếp tục), như contentSyntaxGuard.
 *   Không đặt trong repository: bộ lập lịch và App Server gọi thẳng repository.
 * Không kiểm được (DB chưa có hàm, lỗi, hết giờ, công tắc tắt) thì cho lưu: lúc chạy người nhận sai tài khoản vẫn được giữ lại.
 */

type Rpc = (payload: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>

const defaultRpc: Rpc = async (payload, signal) => {
  const { data, error } = await getSupabaseClient().rpc(UID_ACCOUNT_GUARD_DESKTOP_RPC, { p_payload: payload }).abortSignal(signal)
  if (error) throw Object.assign(new Error(error.message || 'rpc_error'), { code: error.code })
  return data
}

let rpc: Rpc = defaultRpc
/** Chỉ dùng trong bài kiểm. */
export function setUidAccountGuardRpcForTest(next: Rpc | null): void {
  rpc = next ?? defaultRpc
}

function warn(where: string, error: unknown): void {
  const code = (error as { code?: unknown })?.code
  // Thiếu hàm = DB chưa apply V679: không ghi log mỗi lần lưu.
  if (code === 'PGRST202' || code === '42883') return
  console.warn(`[uid-account-guard] ${where}: không kiểm được, cho lưu như cũ`, error)
}

export async function checkUidsForAccounts(accountIds: readonly number[], rows: readonly { uid?: unknown }[]): Promise<UidGuardAccountResult[] | null> {
  const uids = collectGuardUids(rows)
  if (uids.length === 0 || accountIds.length === 0) return null
  const signal = AbortSignal.timeout(UID_ACCOUNT_GUARD_DEADLINE_MS)
  try {
    const chunks: UidGuardAccountResult[][] = []
    for (const chunk of chunkGuardUids(uids)) {
      const parsed = parseUidGuardUidsResult(await rpc({ mode: 'uids', accountIds: [...accountIds], uids: chunk }, signal))
      if (!parsed) return null
      chunks.push(parsed)
    }
    const merged = mergeUidGuardChunks(chunks)
    return accountIds.flatMap(id => merged.filter(result => result.accountId === id))
  } catch (error) {
    warn('uids', error)
    return null
  }
}

export async function checkCampaignAccount(campaignId: number, accountId?: number | null): Promise<UidGuardCampaignResult | null> {
  try {
    return parseUidGuardCampaignResult(await rpc({ mode: 'campaign', campaignId, ...(accountId ? { accountId } : {}) },
      AbortSignal.timeout(UID_ACCOUNT_GUARD_DEADLINE_MS)))
  } catch (error) {
    warn('campaign', error)
    return null
  }
}

export async function holdCampaignBlocked(campaignId: number): Promise<number> {
  try {
    const data = await rpc({ mode: 'hold', campaignId }, AbortSignal.timeout(UID_ACCOUNT_GUARD_DEADLINE_MS))
    const held = data && typeof data === 'object' ? Number((data as Record<string, unknown>).held) : 0
    return Number.isFinite(held) ? held : 0
  } catch (error) {
    warn('hold', error)
    return 0
  }
}

// Khách bấm "Bỏ N người này" ở hộp báo: lần lưu / Tiếp tục kế tiếp của đúng chiến dịch + tài khoản được đi qua (rồi giữ lại người
// sai). Chỉ trong RAM của tiến trình, dùng một lần, hết hạn sau 2 phút.
const SKIP_TTL_MS = 120_000
const skipAllowances = new Map<string, number>()
const skipKey = (campaignId: number, accountId?: number | null) => `${campaignId}:${accountId ?? 'current'}`

export function allowSkipOnce(campaignId: number, accountId?: number | null, now = Date.now()): void {
  for (const [key, expiresAt] of skipAllowances) if (expiresAt <= now) skipAllowances.delete(key)
  skipAllowances.set(skipKey(campaignId, accountId), now + SKIP_TTL_MS)
}

function takeSkip(campaignId: number, accountId?: number | null, now = Date.now()): boolean {
  const key = skipKey(campaignId, accountId)
  const expiresAt = skipAllowances.get(key)
  skipAllowances.delete(key)
  return expiresAt !== undefined && expiresAt > now
}

export class UidAccountGuardBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UidAccountGuardBlockedError'
  }
}

interface GuardCampaign {
  id: number
  actionId?: string | null
  accountId?: number | null
  dataTargetSourceMode?: string | null
  status?: string | null
}

/** Đổi tài khoản khi sửa chiến dịch. Trả true khi khách đã chọn "Bỏ N người này": gọi `holdCampaignBlocked` sau khi lưu. */
export async function guardAccountChange(campaign: GuardCampaign, nextAccountId: number, nextActionId?: string | null): Promise<boolean> {
  if (!nextAccountId || nextAccountId === campaign.accountId) return false
  if (!uidAccountGuardApplies(nextActionId ?? campaign.actionId, campaign.dataTargetSourceMode)) return false
  const result = await checkCampaignAccount(campaign.id, nextAccountId)
  const verdict = result?.account ? uidGuardSaveVerdict([result.account], { blocked: result.blockedRows, total: result.checkedRows }) : null
  if (!verdict) return false
  if (verdict.canSkip && takeSkip(campaign.id, nextAccountId)) return true
  throw new UidAccountGuardBlockedError(`${verdict.title} ${verdict.message}`)
}

/** Bấm Tiếp tục: danh sách lẫn mà khách đã chọn "Bỏ N người này" thì giữ lại người sai rồi cho chạy tiếp. */
export async function guardResume(campaign: GuardCampaign): Promise<void> {
  if (campaign.status === 'chờ xử lý' || campaign.status === 'đang chạy') return
  if (!uidAccountGuardApplies(campaign.actionId, campaign.dataTargetSourceMode)) return
  const verdict = uidGuardResumeVerdict(await checkCampaignAccount(campaign.id))
  if (!verdict) return
  if (verdict.canSkip && takeSkip(campaign.id)) {
    await holdCampaignBlocked(campaign.id)
    return
  }
  throw new UidAccountGuardBlockedError(verdict.message)
}

/** Thêm data: trả lại danh sách (đã bỏ người sai nếu khách chọn "Bỏ N người này"). */
export async function guardAppendRows<T extends { uid?: unknown }>(campaign: GuardCampaign, rows: T[]): Promise<T[]> {
  if (!campaign.accountId || !uidAccountGuardApplies(campaign.actionId, campaign.dataTargetSourceMode)) return rows
  const results = await checkUidsForAccounts([campaign.accountId], rows)
  const verdict = results ? uidGuardSaveVerdict(results) : null
  if (!verdict || !results) return rows
  if (verdict.canSkip && takeSkip(campaign.id)) return dropGuardBlockedRows(rows, results.flatMap(result => result.blockedUids))
  throw new UidAccountGuardBlockedError(`${verdict.title} ${verdict.message}`)
}

const positive = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

/** IPC `campaign:uid-account-guard`. Không ném lỗi; không kiểm được thì `verdict: null`. */
export async function handleUidAccountGuardIpc(request: unknown): Promise<UidAccountGuardIpcResult> {
  const body = request && typeof request === 'object' ? request as Record<string, unknown> : {}
  const none: UidAccountGuardCheckResponse = { verdict: null, blockedUids: [] }
  if (body.action === 'allow-skip') {
    const campaignId = positive(body.campaignId)
    if (!campaignId) return { ok: false, message: 'Chiến dịch không hợp lệ.' }
    allowSkipOnce(campaignId, positive(body.accountId) || null)
    return { ok: true, data: none }
  }
  if (body.action === 'check-resume') {
    const campaignId = positive(body.campaignId)
    if (!campaignId) return { ok: false, message: 'Chiến dịch không hợp lệ.' }
    const verdict = uidGuardResumeVerdict(await checkCampaignAccount(campaignId))
    return { ok: true, data: verdict ? { verdict: { ...uidGuardDetails(verdict, campaignId), message: verdict.message }, blockedUids: [] } : none }
  }
  if (body.action !== 'check') return { ok: false, message: 'Yêu cầu không hợp lệ.' }
  if (body.campaignId !== undefined) {
    const campaignId = positive(body.campaignId)
    const accountId = positive(body.accountId)
    if (!campaignId || !accountId) return { ok: false, message: 'Yêu cầu không hợp lệ.' }
    const result = await checkCampaignAccount(campaignId, accountId)
    const verdict = result?.account ? uidGuardSaveVerdict([result.account], { blocked: result.blockedRows, total: result.checkedRows }) : null
    return { ok: true, data: verdict ? { verdict: { ...uidGuardDetails(verdict, campaignId), message: verdict.message }, blockedUids: [] } : none }
  }
  if (!uidAccountGuardApplies(body.actionId)) return { ok: true, data: none }
  let results: UidGuardAccountResult[] | null
  if (Array.isArray(body.assignments)) {
    const assignments = body.assignments.slice(0, UID_ACCOUNT_GUARD_MAX_ACCOUNTS).flatMap(item => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const accountId = positive(row.accountId)
      return accountId && Array.isArray(row.uids) ? [{ accountId, rows: row.uids.slice(0, 100_000).map(uid => ({ uid })) }] : []
    })
    if (assignments.length === 0) return { ok: false, message: 'Yêu cầu không hợp lệ.' }
    const parts = await Promise.all(assignments.map(item => checkUidsForAccounts([item.accountId], item.rows)))
    results = parts.flatMap(part => part ?? [])
  } else {
    const accountIds = Array.isArray(body.accountIds)
      ? [...new Set(body.accountIds.map(positive).filter(id => id > 0))].slice(0, UID_ACCOUNT_GUARD_MAX_ACCOUNTS)
      : []
    if (accountIds.length === 0 || !Array.isArray(body.uids) || body.uids.length > 100_000) return { ok: false, message: 'Yêu cầu không hợp lệ.' }
    results = await checkUidsForAccounts(accountIds, body.uids.map(uid => ({ uid })))
  }
  const verdict = results ? uidGuardSaveVerdict(results) : null
  if (!verdict || !results) return { ok: true, data: none }
  return {
    ok: true,
    data: { verdict: { ...uidGuardDetails(verdict), message: verdict.message }, blockedUids: [...new Set(results.flatMap(result => result.blockedUids))] }
  }
}
