/**
 * "Gửi lặp lại sau mỗi x phút": chiến dịch Zalo nhắn bạn bè/nhóm đang gửi dạng chia sẻ, gửi xong toàn bộ danh sách
 * thì nghỉ x phút (tính từ lúc hoàn thành lượt trước) rồi gửi lại từ đầu. Chọn một trong hai với "nhiều khung giờ".
 *
 * Lưu trong `auto_campaigns.extra_settings`: `zaloShareRepeatEnabled`, `zaloShareRepeatAfterMinutes`.
 * Bộ chạy (akaAgent `campaignScheduler.ts`) đọc hai khoá này; hợp đồng dùng chung Web/API/iOS ở file này.
 * Xem docs/ZALO_SHARE_REPEAT.md.
 */

/**
 * Công tắc hiển thị cho MỌI tài khoản: `auto_system_settings` key này, value `true` | `false`
 * (cũng nhận `{"enabled":true}`). Thiếu dòng, `is_active=false` hoặc sai định dạng = tắt.
 * Web đọc cùng lượt chu kỳ tải (ẩn/hiện ô chọn), API đọc lại ở mỗi lượt tạo/sửa chiến dịch.
 */
export const ZALO_SHARE_REPEAT_SETTING_KEY = 'web.zalo_share_repeat.enabled'

export const ZALO_SHARE_REPEAT_MIN_MINUTES = 5
/** Lượt kế tiếp phải nằm trong cùng ngày (trước 23:59), nên tối đa 1439 phút. */
export const ZALO_SHARE_REPEAT_MAX_MINUTES = 1439
export const ZALO_SHARE_REPEAT_DEFAULT_MINUTES = 60
export const ZALO_SHARE_REPEAT_ACTIONS: readonly string[] = ['zalo_message_friend', 'zalo_message_group']

export const ZALO_SHARE_REPEAT_MINUTES_ERROR =
  `Số phút gửi lặp lại phải là số nguyên từ ${ZALO_SHARE_REPEAT_MIN_MINUTES} đến ${ZALO_SHARE_REPEAT_MAX_MINUTES}.`

export function parseZaloShareRepeatSetting(value: unknown): boolean {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value.trim()) : value
    if (parsed === true) return true
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).enabled === true)
  } catch { return false }
}

/** Chỉ nhắn bạn bè/nhóm, đang gửi dạng chia sẻ, data nhập trực tiếp (không phải Nhóm data). */
export function supportsZaloShareRepeat(
  actionId: string | null | undefined,
  zaloMessageSendMode: unknown,
  dataTargetSourceMode?: unknown,
): boolean {
  return Boolean(actionId) && ZALO_SHARE_REPEAT_ACTIONS.includes(String(actionId))
    && zaloMessageSendMode === 'share' && dataTargetSourceMode !== 'data_group'
}

/** Số phút hợp lệ (số nguyên trong khoảng cho phép) hoặc null. Nhận số hoặc chuỗi chỉ gồm chữ số. */
export function parseZaloShareRepeatMinutes(value: unknown): number | null {
  const minutes = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : NaN
  return Number.isInteger(minutes) && minutes >= ZALO_SHARE_REPEAT_MIN_MINUTES && minutes <= ZALO_SHARE_REPEAT_MAX_MINUTES
    ? minutes : null
}

export interface ZaloShareRepeatResolveInput {
  actionId: string
  dataTargetSourceMode?: unknown
  /** `extraSettings` client gửi lên (tạo hoặc sửa). */
  settings: Record<string, unknown>
  /** `extraSettings` đang lưu khi sửa; client cũ không gửi hai khoá thì giữ giá trị đang có. */
  currentSettings?: Record<string, unknown> | null
  /** Công tắc `web.zalo_share_repeat.enabled`. */
  featureEnabled: boolean
}

/**
 * Chuẩn hoá hai khoá gửi lặp trước khi lưu (API gọi ở cả tạo và sửa).
 *
 * - Công tắc tắt, sai loại chiến dịch, không gửi dạng chia sẻ, hoặc đang bật nhiều khung giờ / "không gửi lặp trong
 *   N ngày": tự tắt gửi lặp, không báo lỗi. Client chưa biết tính năng (iOS cũ, Desktop) vẫn mang theo cài đặt cũ khi
 *   người dùng bật một tuỳ chọn xung đột, và họ không có ô nào để tự gỡ.
 * - Đang bật mà số phút sai: trả `error` để API từ chối.
 * - Không đụng tới `settings` gốc; payload không có khoá và chiến dịch chưa từng bật thì trả nguyên như cũ.
 */
export function resolveZaloShareRepeatSettings(input: ZaloShareRepeatResolveInput): { settings: Record<string, unknown>; error: string | null } {
  const settings = { ...input.settings }
  const explicit = Object.prototype.hasOwnProperty.call(input.settings, 'zaloShareRepeatEnabled')
  if (!explicit) {
    if (input.currentSettings?.zaloShareRepeatEnabled !== true) return { settings, error: null }
    settings.zaloShareRepeatEnabled = true
    settings.zaloShareRepeatAfterMinutes = input.currentSettings.zaloShareRepeatAfterMinutes
  }
  const minutes = parseZaloShareRepeatMinutes(settings.zaloShareRepeatAfterMinutes)
  const off = () => {
    settings.zaloShareRepeatEnabled = false
    settings.zaloShareRepeatAfterMinutes = minutes ?? ZALO_SHARE_REPEAT_DEFAULT_MINUTES
    return { settings, error: null }
  }
  if (settings.zaloShareRepeatEnabled !== true) return off()
  if (!input.featureEnabled
    || !supportsZaloShareRepeat(input.actionId, settings.zaloMessageSendMode, input.dataTargetSourceMode)
    || settings.multiDailyTimeSlotsEnabled === true
    || settings.recentDeliveryCooldownEnabled === true) return off()
  if (minutes === null) return { settings, error: ZALO_SHARE_REPEAT_MINUTES_ERROR }
  settings.zaloShareRepeatAfterMinutes = minutes
  return { settings, error: null }
}
