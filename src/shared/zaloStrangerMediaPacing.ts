// Cảnh báo trên form: chiến dịch có thể nhắn người lạ, mỗi tin gửi từ 3 tệp trở lên mà "Nghỉ giữa 2 lần" dưới 300 giây.
// Zalo gửi album trước rồi chữ thành tin riêng (planZaloSend, packages/campaign-engine/src/zalo/media.ts) và hay chặn phần chữ (mã 127)
// khi gửi nhanh. Số đo 24/11/2026 (docs/ZALO_PARTIAL_TEXT_V647.md): 3–5 ảnh mất chữ 15,7% khi nghỉ dưới 60 giây, 3,9% khi 60–299 giây,
// 0% từ 300 giây; 2 ảnh dưới 1,5%. Chỉ cảnh báo, không chặn lưu (anh chốt 24/11/2026).

export const ZALO_STRANGER_MEDIA_PACING_MIN_FILES = 3
export const ZALO_STRANGER_MEDIA_PACING_MIN_SLEEP_SECONDS = 300

export const ZALO_STRANGER_MEDIA_PACING_WARNING =
  'Gửi từ 3 ảnh trở lên cho người lạ mà nghỉ dưới 300 giây thì Zalo hay chặn phần chữ gửi sau ảnh. Nên đặt từ 300 giây.'

/** Loại chiến dịch Zalo mà bước nhắn tin có thể tới người chưa là bạn bè (thao tác zalo_message_stranger). */
export const ZALO_STRANGER_MESSAGE_ACTION_IDS: ReadonlySet<string> = new Set([
  'zalo_message_phone',
  'zalo_message_group_member',
  'zalo_message_group_realtime',
  'zalo_message_remarketing_customer',
  'zalo_message_friend_recommendation'
])

interface MediaItemLike { mediaOption?: string | null; mediaItems?: readonly unknown[] | null; randomMediaCount?: number | null }

export interface ZaloStrangerMediaPacingInput {
  actionId: string | null | undefined
  sleepSeconds: number | null | undefined
  imageOption?: string | null
  images?: readonly unknown[] | null
  randomImageCount?: number | null
  advancedContentEnabled?: boolean
  advancedContentItems?: readonly MediaItemLike[] | null
}

/** Số tệp lớn nhất một tin có thể gửi, theo đúng cách bộ chạy chọn tệp (selectZaloCampaignMedia / selectAdvancedContentMedia). */
export function maxZaloFilesPerMessage(input: ZaloStrangerMediaPacingInput): number {
  const pick = (option: string, count: number, randomCount: number, randomDefault: number): number => {
    if (option === 'none' || count <= 0) return 0
    if (option !== 'random') return count
    return Math.min(count, Math.max(1, Number(randomCount || randomDefault) || 1))
  }
  if (input.advancedContentEnabled) {
    return (input.advancedContentItems ?? []).reduce((max, item) => Math.max(max,
      pick(String(item.mediaOption || 'all'), (item.mediaItems ?? []).length, Number(item.randomMediaCount || 0), 1)), 0)
  }
  return pick(String(input.imageOption || 'all'), (input.images ?? []).length, Number(input.randomImageCount || 0), 3)
}

export function shouldWarnZaloStrangerMediaPacing(input: ZaloStrangerMediaPacingInput): boolean {
  if (!ZALO_STRANGER_MESSAGE_ACTION_IDS.has(String(input.actionId || ''))) return false
  const sleep = Number(input.sleepSeconds)
  if (Number.isFinite(sleep) && sleep >= ZALO_STRANGER_MEDIA_PACING_MIN_SLEEP_SECONDS) return false
  return maxZaloFilesPerMessage(input) >= ZALO_STRANGER_MEDIA_PACING_MIN_FILES
}
