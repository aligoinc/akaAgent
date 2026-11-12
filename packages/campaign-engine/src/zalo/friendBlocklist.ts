/**
 * Danh sách không gửi tin Zalo kiểu cũ (loadZaloFriendBlocklistContext + isZaloFriendBlockedByBlocklist của Desktop): chỉ nhắn bạn bè,
 * chỉ khi chiến dịch chưa có cấu hình loại trừ gửi mới (zaloSendExclusionsByAccountId) và bật zaloFriendBlocklistEnabled. Kiểm trước
 * mọi lần đọc Zalo của data, như Desktop (trước từ chối nhận tin). Zalo ID của danh sách đọc qua RPC V504 ('friend_blocklist') một lần
 * mỗi lượt chạy.
 *
 * Như Desktop: người nằm trong danh sách thì data hoàn thành kèm câu, không gửi (EXC03). Khác Desktop: danh sách không dùng được
 * (chưa chọn, đã xoá, của tài khoản khác) thì tạm dừng chiến dịch một lần (CFG19) thay vì để "chờ xử lý" kèm câu và thử lại mỗi vòng;
 * DB của mình lỗi khi đọc danh sách thì chưa gửi, data về hàng đợi (SYS08).
 */
import type { RawOutcome } from '../contracts.js'
import type { StepContext } from '../runUnit.js'
import { CancelledError, errorMessage, withDeadline } from '../boundary.js'
import type { ConfigIssue } from '../validation.js'
import { SendExclusionRpcError } from './sendExclusion.js'

type JsonObject = Record<string, unknown>

const ZALO_MESSAGE_FRIEND = 'zalo_message_friend'
export const FRIEND_BLOCKLIST_GATE = 'friend_blocklist'
export const FRIEND_BLOCKLISTED_ERROR_CODE = 'err_engine_friend_blocklisted'
export const FRIEND_BLOCKLIST_CONFIG_ERROR_CODE = 'err_cfg_friend_blocklist_invalid'

export interface ZaloFriendBlocklistPort {
  /** V504 'friend_blocklist': Zalo ID của danh sách không gửi tin. Cấu hình hỏng ném SendExclusionRpcError('config_invalid'). */
  friendBlocklist(ctx: StepContext): Promise<{ groupId: number; groupName: string; uids: string[] }>
}

interface BlocklistCampaign { id: number; actionId: string; extraSettings: JsonObject }

/** Như điều kiện đầu loadZaloFriendBlocklistContext. */
export function friendBlocklistActive(campaign: BlocklistCampaign): boolean {
  const extra = campaign.extraSettings
  return campaign.actionId === ZALO_MESSAGE_FRIEND && extra.zaloSendExclusionsByAccountId === undefined && extra.zaloFriendBlocklistEnabled === true
}

const PREFIX = 'Danh sách không gửi tin Zalo không hợp lệ'

/** Chưa chọn danh sách (zaloFriendBlocklistId) thì không cần đọc DB: tạm dừng chiến dịch ngay đầu lượt (CFG19). */
export function validateFriendBlocklistConfig(campaign: BlocklistCampaign): ConfigIssue[] {
  if (!friendBlocklistActive(campaign)) return []
  const id = Number(campaign.extraSettings.zaloFriendBlocklistId)
  if (Number.isFinite(id) && id > 0) return []
  return [{ errorCode: FRIEND_BLOCKLIST_CONFIG_ERROR_CODE, publicCode: 'CFG19', scope: 'campaign', message: `${PREFIX}: Chưa chọn danh sách không gửi tin Zalo` }]
}

/** Như normalizeUidForCompare của Desktop. */
const uidKey = (uid: unknown): string => String(uid ?? '').trim().replace(/\/+$/g, '').toLowerCase()

// Danh sách đọc một lần cho mỗi lượt chạy (theo lease + chiến dịch), như ngữ cảnh blocklist của Desktop.
const LIMIT = 64
const lists = new Map<string, { groupName: string; uids: Set<string> }>()

export type FriendBlocklistResult = { kind: 'allowed' } | { kind: 'blocked'; outcome: RawOutcome }

const blocked = (code: string, message: string, data: JsonObject, errorCode?: string): FriendBlocklistResult =>
  ({ kind: 'blocked', outcome: { ok: false, phase: 'before_send',
    signal: { kind: 'engine', code, message, ...(errorCode ? { errorCode } : {}) }, data: { gate: FRIEND_BLOCKLIST_GATE, ...data } } })

export async function checkZaloFriendBlocklist(port: ZaloFriendBlocklistPort, ctx: StepContext, campaign: BlocklistCampaign, uid: string,
  readTimeoutMs = 60_000): Promise<FriendBlocklistResult> {
  const key = `${ctx.leaseToken}:${campaign.id}`
  let list = lists.get(key)
  if (!list) {
    try {
      const loaded = await withDeadline('friend_blocklist', readTimeoutMs, ctx.signal, s => port.friendBlocklist({ ...ctx, signal: s }))
      list = { groupName: String(loaded.groupName || '').trim(), uids: new Set((loaded.uids ?? []).map(uidKey).filter(Boolean)) }
    } catch (error) {
      if (error instanceof CancelledError || ctx.signal.aborted) throw error instanceof CancelledError ? error : new CancelledError('friend_blocklist')
      if (error instanceof SendExclusionRpcError && error.reason === 'config_invalid') {
        return blocked('friend_blocklist_invalid', `${PREFIX}: ${errorMessage(error)}`, {}, FRIEND_BLOCKLIST_CONFIG_ERROR_CODE)
      }
      // DB của mình lỗi khi đọc danh sách: chưa gửi gì, data về hàng đợi rồi thử lại (luật gate_unavailable).
      return blocked('gate_unavailable', `Không đọc được danh sách không gửi tin Zalo: ${errorMessage(error) || 'Lỗi không xác định'}`, {})
    }
    lists.set(key, list)
    while (lists.size > LIMIT) {
      const oldest = lists.keys().next().value
      if (oldest === undefined) break
      lists.delete(oldest)
    }
  }
  const target = uidKey(uid)
  if (!target || !list.uids.has(target)) return { kind: 'allowed' }
  return blocked('friend_blocklisted', `Nằm trong danh sách không gửi tin: ${list.groupName || 'danh sách không gửi tin'}`, {})
}
