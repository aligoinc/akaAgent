import type { ZaloEngagement } from './zaloCampaignEngagement'

/**
 * Ghép dòng của "Đồng bộ trạng thái tin nhắn Zalo" (bảng auto_zalo_message_status, V525) vào mốc tương tác của một kết quả.
 * Hàm đọc của DB (V653) trả dòng đó riêng: `zalo_message_status` ở tab Kết quả chạy, `zaloMessageStatus` ở chế độ gộp theo
 * người nhận. Hai hệ thống theo dõi độc lập (chốt 13/11/2026): mỗi mốc lấy giờ sớm nhất của hai bên; "Đã nhận" chỉ hệ thống
 * mới có. Cùng luật với WebApp `messageStatusToEngagement` (packages/control-api/src/zaloMessageStatusView.ts).
 */
type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const time = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
const earliest = (a: string | null | undefined, b: string | null | undefined): string | null => {
  if (!a) return b || null
  if (!b) return a
  return Date.parse(b) < Date.parse(a) ? b : a
}

export function mergeZaloMessageStatus(engagement: unknown, status: unknown): ZaloEngagement | null {
  const base = isRow(engagement) ? engagement as unknown as ZaloEngagement : null
  if (!isRow(status)) return base
  const sentAt = time(status.sent_at)
  const replyUntil = time(status.reply_until)
  if (!sentAt || !replyUntil) return base
  return {
    ...(base ?? {}),
    sent_at: base?.sent_at ?? sentAt,
    tracking_until: base?.tracking_until ?? replyUntil,
    delivered_at: time(status.delivered_at),
    seen_at: earliest(base?.seen_at, time(status.seen_at)),
    responded_at: earliest(base?.responded_at, time(status.responded_at)),
    reacted_at: earliest(base?.reacted_at, time(status.reacted_at)),
    friended_at: earliest(base?.friended_at, time(status.friended_at)),
    ...(base?.rejected_at ? { rejected_at: base.rejected_at } : {})
  }
}
