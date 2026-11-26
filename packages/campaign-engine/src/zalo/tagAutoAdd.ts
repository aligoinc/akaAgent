/**
 * Tự thêm người được gắn tag Zalo vào chiến dịch "Nhắn tin bạn bè" (V660, docs/ZALO_TAG_AUTO_SEND_PLAN.md).
 *
 * DB thêm dòng data với `control_append_idempotency_key = 'zalotag:<chiến dịch>:<uid>'`. Danh sách tag của Zalo không cho biết ai
 * là bạn bè, nên ngay trước khi gửi, dòng như vậy được kiểm trạng thái bạn bè (anh chốt 26/11/2026: đợt này chỉ gửi cho bạn bè):
 *   - đã là bạn bè: gửi như thường;
 *   - chưa là bạn bè: không gửi, dòng lịch sử "Bỏ qua: Chưa là bạn bè nên không gửi" (EXC04, không tính lượt, không cộng chuỗi);
 *   - không đọc được: chưa gửi gì, data hẹn chạy lại sau 30 phút (EXC05), lượt chạy tiếp data khác. Không dùng gate_unavailable:
 *     luật đó kết thúc lượt, nên một người mà Zalo luôn lỗi sẽ chặn cả chiến dịch.
 * Dòng lấy từ danh sách lần đầu không bị kiểm (đã lọc trên danh sách bạn bè).
 */
import type { RawOutcome, TargetRow } from '../contracts.js'
import type { StepContext } from '../runUnit.js'
import { CancelledError, errorMessage, withDeadline } from '../boundary.js'

export const ZALO_TAG_AUTO_ADD_KEY_PREFIX = 'zalotag:'
export const ZALO_TAG_NOT_FRIEND_ERROR_CODE = 'err_engine_zalo_tag_not_friend'
export const ZALO_TAG_FRIEND_UNAVAILABLE_CODE = 'zalo_tag_friend_unavailable'
export const ZALO_TAG_FRIEND_GATE = 'zalo_tag_friend'
export const ZALO_TAG_NOT_FRIEND_MESSAGE = 'Chưa là bạn bè nên không gửi'

export interface ZaloTagFriendPort {
  /** true / false theo Zalo; null khi Zalo không trả lời rõ. */
  friendStatus(ctx: StepContext, uid: string): Promise<boolean | null>
}

/** Dòng data do DB thêm khi người đó vừa được gắn tag. */
export function isZaloTagAutoAddTarget(target: TargetRow): boolean {
  return String(target.control_append_idempotency_key ?? '').startsWith(ZALO_TAG_AUTO_ADD_KEY_PREFIX)
}

export type ZaloTagFriendResult = { kind: 'allowed' } | { kind: 'blocked'; outcome: RawOutcome }

const blocked = (code: string, message: string): ZaloTagFriendResult =>
  ({ kind: 'blocked', outcome: { ok: false, phase: 'before_send', signal: { kind: 'engine', code, message },
    data: { gate: ZALO_TAG_FRIEND_GATE } } })

export async function checkZaloTagAutoAddFriend(port: ZaloTagFriendPort, ctx: StepContext, target: TargetRow,
  readTimeoutMs = 60_000): Promise<ZaloTagFriendResult> {
  if (!isZaloTagAutoAddTarget(target)) return { kind: 'allowed' }
  const uid = String(target.uid ?? '').trim()
  if (!uid) return { kind: 'allowed' } // Bước sau tự báo thiếu UID.
  let status: boolean | null
  try {
    status = await withDeadline('zalo_tag_friend', readTimeoutMs, ctx.signal, s => port.friendStatus({ ...ctx, signal: s }, uid))
  } catch (error) {
    if (error instanceof CancelledError || ctx.signal.aborted) throw error instanceof CancelledError ? error : new CancelledError('zalo_tag_friend')
    return blocked(ZALO_TAG_FRIEND_UNAVAILABLE_CODE, `Không kiểm tra được trạng thái bạn bè: ${errorMessage(error) || 'Lỗi không xác định'}`)
  }
  if (status === true) return { kind: 'allowed' }
  if (status === false) return blocked('zalo_tag_not_friend', ZALO_TAG_NOT_FRIEND_MESSAGE)
  return blocked(ZALO_TAG_FRIEND_UNAVAILABLE_CODE, 'Không kiểm tra được trạng thái bạn bè')
}
