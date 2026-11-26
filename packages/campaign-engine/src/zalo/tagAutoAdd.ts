/**
 * Tự thêm người được gắn tag Zalo vào chiến dịch "Nhắn tin bạn bè" (V660, docs/ZALO_TAG_AUTO_SEND_PLAN.md).
 *
 * DB thêm dòng data với `control_append_idempotency_key = 'zalotag:<chiến dịch>:<uid>'`. Dòng như vậy gửi như mọi dòng khác, kể cả
 * khi người đó chưa là bạn bè (anh chốt 26/11/2026 "Cách A": chỉ cần gắn tag là gửi). Zalo hạn chế nhắn người lạ (120 / 802) thì
 * chính sách V669 hẹn riêng data đó chạy lại sau 24 / 48 giờ, không dừng chiến dịch.
 */
import type { TargetRow } from '../contracts.js'

export const ZALO_TAG_AUTO_ADD_KEY_PREFIX = 'zalotag:'

/** Dòng data do DB thêm khi người đó vừa được gắn tag. */
export function isZaloTagAutoAddTarget(target: TargetRow): boolean {
  return String(target.control_append_idempotency_key ?? '').startsWith(ZALO_TAG_AUTO_ADD_KEY_PREFIX)
}
