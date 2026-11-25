import type { ZaloEngagement } from './zaloCampaignEngagement'

/**
 * Ghép dòng của "Đồng bộ trạng thái tin nhắn Zalo" (bảng auto_zalo_message_status, V525) vào mốc tương tác của một kết quả.
 * Hàm đọc của DB (V653) trả dòng đó riêng: `zalo_message_status` ở tab Kết quả chạy, `zaloMessageStatus` ở chế độ gộp theo
 * người nhận. Hai hệ thống theo dõi độc lập (chốt 13/11/2026): mỗi mốc lấy giờ sớm nhất của hai bên; "Đã nhận" chỉ hệ thống
 * mới có. Cùng luật với WebApp `messageStatusToEngagement` (packages/control-api/src/zaloMessageStatusView.ts):
 * - giờ gửi và hạn lấy theo dòng trạng thái (hạn là hạn tính "đã phản hồi");
 * - "Đã nhận" không muộn hơn mốc xem / thả cảm xúc / phản hồi sớm nhất (hai hệ ghi giờ theo nguồn khác nhau, nên biên nhận
 *   có thể tới sau giờ "đã xem" của hệ cũ; người nhận chắc chắn đã có tin từ lúc xem);
 * - giờ không đọc được thì coi như chưa có mốc.
 */
type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const time = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
const earliest = (a: string | null, b: string | null): string | null => {
  if (!a) return b
  if (!b) return a
  return Date.parse(b) < Date.parse(a) ? b : a
}

/** Giờ "đã nhận" hiển thị: không muộn hơn mốc sớm nhất chứng tỏ người nhận đã có tin. Không có biên nhận thì không tự thêm. */
export function receivedAtNotAfter(delivered: string | null, ...later: Array<string | null>): string | null {
  return delivered ? later.reduce<string | null>((acc, at) => earliest(acc, at), delivered) : null
}

export function mergeZaloMessageStatus(engagement: unknown, status: unknown): ZaloEngagement | null {
  const base = isRow(engagement) ? engagement as unknown as ZaloEngagement : null
  if (!isRow(status)) return base
  const sentAt = time(status.sent_at)
  const replyUntil = time(status.reply_until)
  if (!sentAt || !replyUntil) return base
  const seen = earliest(time(base?.seen_at), time(status.seen_at))
  const responded = earliest(time(base?.responded_at), time(status.responded_at))
  const reacted = earliest(time(base?.reacted_at), time(status.reacted_at))
  return {
    ...(base ?? {}),
    sent_at: sentAt,
    tracking_until: replyUntil,
    delivered_at: receivedAtNotAfter(time(status.delivered_at), seen, reacted, responded),
    seen_at: seen,
    responded_at: responded,
    reacted_at: reacted,
    friended_at: earliest(time(base?.friended_at), time(status.friended_at)),
    ...(base?.rejected_at !== undefined ? { rejected_at: time(base.rejected_at) } : {})
  }
}
