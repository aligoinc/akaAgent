/**
 * "Lặp lại sau khi chạy xong": chiến dịch lịch Hàng ngày chạy hết danh sách thì tự chạy lại sau x phút / giờ / ngày (tính từ
 * lúc chạy xong), tới khi đủ số lượt tối đa (tính cả lượt đầu) hoặc tới ngày kết thúc.
 *
 * Lưu trong `auto_campaigns.extra_settings`: `repeatAfterCompletionEnabled`, `repeatAfterCompletionEvery`,
 * `repeatAfterCompletionUnit`, `repeatAfterCompletionMaxRuns`; ngày kết thúc ở `schedule_end_date`.
 *
 * File này chỉ phục vụ phần CÀI ĐẶT: ô trên form, kiểm tra và chuẩn hoá lúc lưu, dòng hiển thị ở chi tiết chiến dịch. Phần làm
 * cho chiến dịch thật sự chạy lại (bộ chạy, bộ đếm lượt) chưa có. Hợp đồng dùng chung Web / API / iOS ở file này; akaAgent chép
 * nguyên văn sang `src/shared/campaignRepeat.ts` (sửa ở WebApp trước rồi chép lại). Xem docs/CAMPAIGN_REPEAT.md.
 */

/**
 * Công tắc hiển thị: `auto_system_settings` key này, value JSON `{"audience":"off"|"admin_akabiz"|"all"}`.
 * Thiếu dòng, `is_active=false` hoặc sai định dạng = ẩn với mọi tài khoản.
 */
export const CAMPAIGN_REPEAT_SETTING_KEY = 'campaign.repeat_after_completion'
export type CampaignRepeatAudience = 'off' | 'admin_akabiz' | 'all'
export type CampaignRepeatUnit = 'minute' | 'hour' | 'day'

export const CAMPAIGN_REPEAT_UNITS: readonly CampaignRepeatUnit[] = ['minute', 'hour', 'day']
export const CAMPAIGN_REPEAT_UNIT_LABELS: Record<CampaignRepeatUnit, string> = { minute: 'phút', hour: 'giờ', day: 'ngày' }
/** Giới hạn của "x" theo đơn vị. */
export const CAMPAIGN_REPEAT_EVERY_LIMITS: Record<CampaignRepeatUnit, { min: number; max: number }> = {
  minute: { min: 5, max: 1439 },
  hour: { min: 1, max: 168 },
  day: { min: 1, max: 90 },
}
/** Số lượt tối đa, tính cả lượt đầu. */
export const CAMPAIGN_REPEAT_MIN_RUNS = 2
export const CAMPAIGN_REPEAT_MAX_RUNS = 100
export const CAMPAIGN_REPEAT_DEFAULTS = { every: 1, unit: 'day' as CampaignRepeatUnit, maxRuns: 2 }

/** Đăng bài, nhắn group: lặp theo giờ hoặc ngày. */
export const CAMPAIGN_REPEAT_BROADCAST_ACTIONS: readonly string[] = [
  'facebook_group_post', 'facebook_timeline_post', 'facebook_page_post', 'zalo_message_group',
]
/** Nhắn tin, kết bạn tới cá nhân: khoảng lặp tối thiểu 1 ngày. */
export const CAMPAIGN_REPEAT_PERSONAL_ACTIONS: readonly string[] = [
  'zalo_message_phone', 'zalo_message_friend', 'zalo_message_group_member', 'zalo_message_remarketing_customer',
  'zalo_add_group_member', 'zalo_join_group_link', 'facebook_message_uid', 'facebook_message_friend',
  'facebook_page_to_message', 'facebook_join_group', 'facebook_group_invite', 'email_send',
]
/** Nhắn bạn bè / group đang gửi dạng chia sẻ được lặp theo phút (gộp từ "Gửi lặp lại sau mỗi x phút"). */
export const CAMPAIGN_REPEAT_SHARE_ACTIONS: readonly string[] = ['zalo_message_friend', 'zalo_message_group']
/**
 * Bốn loại Facebook trước đây chỉ có "Chạy lại sau mỗi x giờ" (`findDataRerun*`): lặp theo phút, giờ hoặc ngày. Chiến dịch lịch tuần /
 * tháng của bốn loại này vẫn dùng cài đặt cũ.
 */
export const CAMPAIGN_REPEAT_FIND_DATA_ACTIONS: readonly string[] = [
  'facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction',
]
/** Loại chạy được mà không cần data trong danh sách (không có data vẫn lặp). */
export const CAMPAIGN_REPEAT_NO_DATA_ACTIONS: readonly string[] = ['facebook_timeline_post', 'facebook_newsfeed_interaction']

export function parseCampaignRepeatAudience(value: unknown): CampaignRepeatAudience {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    const audience = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).audience : undefined
    return audience === 'all' || audience === 'admin_akabiz' ? audience : 'off'
  } catch { return 'off' }
}

export function campaignRepeatVisible(audience: CampaignRepeatAudience | undefined, isAdminAkabiz: boolean | undefined): boolean {
  return audience === 'all' || (audience === 'admin_akabiz' && isAdminAkabiz === true)
}

export interface CampaignRepeatContext {
  /** `extra_settings.zaloMessageSendMode` ('share' khi gửi dạng chia sẻ). */
  zaloMessageSendMode?: unknown
  /** 'data_group' = nguồn Nhóm data (không lặp). */
  dataTargetSourceMode?: unknown
  /** Chỉ lịch Hàng ngày ('daily' hoặc thiếu). */
  scheduleType?: unknown
}

/**
 * Các đơn vị chiến dịch này được chọn; mảng rỗng = không có "Lặp lại sau khi chạy xong" (sai loại, lịch tuần / tháng,
 * nguồn Nhóm data).
 */
export function campaignRepeatUnits(actionId: string | null | undefined, context: CampaignRepeatContext = {}): CampaignRepeatUnit[] {
  const action = String(actionId || '')
  if (!action || context.dataTargetSourceMode === 'data_group') return []
  if (context.scheduleType != null && context.scheduleType !== 'daily') return []
  if (CAMPAIGN_REPEAT_SHARE_ACTIONS.includes(action) && context.zaloMessageSendMode === 'share') return ['minute', 'hour', 'day']
  if (CAMPAIGN_REPEAT_FIND_DATA_ACTIONS.includes(action)) return ['minute', 'hour', 'day']
  if (CAMPAIGN_REPEAT_BROADCAST_ACTIONS.includes(action)) return ['hour', 'day']
  if (CAMPAIGN_REPEAT_PERSONAL_ACTIONS.includes(action)) return ['day']
  return []
}

/** Số nguyên trong khoảng (nhận số hoặc chuỗi chỉ gồm chữ số) hoặc null. */
export function parseCampaignRepeatInteger(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : NaN
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

export function parseCampaignRepeatUnit(value: unknown): CampaignRepeatUnit | null {
  return value === 'minute' || value === 'hour' || value === 'day' ? value : null
}

export interface CampaignRepeatConfig {
  enabled: boolean
  /** null khi thiếu hoặc ngoài khoảng của đơn vị. */
  every: number | null
  unit: CampaignRepeatUnit | null
  maxRuns: number | null
}

/** Đọc bốn khoá từ `extra_settings` đã lưu (không xét loại chiến dịch). */
export function readCampaignRepeat(settings: Record<string, unknown> | null | undefined): CampaignRepeatConfig {
  const unit = parseCampaignRepeatUnit(settings?.repeatAfterCompletionUnit)
  const limits = unit ? CAMPAIGN_REPEAT_EVERY_LIMITS[unit] : null
  return {
    enabled: settings?.repeatAfterCompletionEnabled === true,
    every: limits ? parseCampaignRepeatInteger(settings?.repeatAfterCompletionEvery, limits.min, limits.max) : null,
    unit,
    maxRuns: parseCampaignRepeatInteger(settings?.repeatAfterCompletionMaxRuns, CAMPAIGN_REPEAT_MIN_RUNS, CAMPAIGN_REPEAT_MAX_RUNS),
  }
}

/** "2 ngày", "30 phút". */
export const campaignRepeatIntervalLabel = (every: number, unit: CampaignRepeatUnit) => `${every} ${CAMPAIGN_REPEAT_UNIT_LABELS[unit]}`

/** Số ngày của "không gửi lặp trong N ngày" khi đang bật; null khi tắt. */
function cooldownDays(settings: Record<string, unknown>): number | null {
  if (settings.recentDeliveryCooldownEnabled !== true) return null
  const days = Math.floor(Number(settings.recentDeliveryCooldownDays))
  return Number.isFinite(days) && days >= 1 ? days : 1
}

/**
 * Kiểm một cài đặt lặp đang bật; null là hợp lệ. `units` là kết quả `campaignRepeatUnits` của chiến dịch.
 * `settings` là `extra_settings` sẽ lưu (để đối chiếu "không gửi lặp trong N ngày").
 */
export function campaignRepeatError(
  config: Pick<CampaignRepeatConfig, 'every' | 'unit' | 'maxRuns'> & { rawEvery?: unknown },
  units: readonly CampaignRepeatUnit[],
  settings: Record<string, unknown> = {},
): string | null {
  if (!config.unit || !units.includes(config.unit)) {
    return units.length === 1
      ? `Loại chiến dịch này chỉ lặp lại theo ${CAMPAIGN_REPEAT_UNIT_LABELS[units[0]]}.`
      : `Vui lòng chọn đơn vị lặp lại: ${units.map((unit) => CAMPAIGN_REPEAT_UNIT_LABELS[unit]).join(', ')}.`
  }
  const limits = CAMPAIGN_REPEAT_EVERY_LIMITS[config.unit]
  if (config.every === null) {
    return `Khoảng lặp lại phải là số nguyên từ ${limits.min} đến ${limits.max} ${CAMPAIGN_REPEAT_UNIT_LABELS[config.unit]}.`
  }
  if (config.maxRuns === null) {
    return `Số lượt tối đa phải là số nguyên từ ${CAMPAIGN_REPEAT_MIN_RUNS} đến ${CAMPAIGN_REPEAT_MAX_RUNS} (tính cả lượt đầu).`
  }
  const days = cooldownDays(settings)
  if (days !== null && !(config.unit === 'day' && config.every > days)) {
    return `Đang bật "không gửi lặp trong ${days} ngày": khoảng lặp lại phải dài hơn ${days} ngày, nếu không từ lượt thứ hai mọi người nhận sẽ bị bỏ qua. Tăng khoảng lặp lại hoặc tắt tuỳ chọn đó.`
  }
  return null
}

export interface CampaignRepeatResolveInput {
  actionId: string
  dataTargetSourceMode?: unknown
  /** Loại lịch sẽ lưu. */
  scheduleType?: unknown
  /** `extraSettings` client gửi lên (tạo hoặc sửa). */
  settings: Record<string, unknown>
  /** `extraSettings` đang lưu khi sửa; client chưa biết tính năng không gửi bốn khoá thì giữ giá trị đang có. */
  currentSettings?: Record<string, unknown> | null
  /** Công tắc cho phép tài khoản này dùng tính năng (`campaignRepeatVisible`). */
  featureEnabled: boolean
}

/**
 * Chuẩn hoá bốn khoá lặp trước khi lưu (API gọi ở cả tạo và sửa).
 *
 * - Công tắc không mở cho tài khoản, sai loại chiến dịch, lịch tuần / tháng, nguồn Nhóm data hoặc đang bật nhiều khung
 *   giờ: tự tắt lặp, không báo lỗi (client chưa biết tính năng vẫn mang theo cài đặt cũ và không có ô nào để tự gỡ).
 * - Client gửi rõ là bật mà số / đơn vị sai, hoặc xung đột với "không gửi lặp trong N ngày": trả `error` để API từ chối.
 *   Cài đặt được mang theo từ bản đang lưu (client không gửi khoá) mà thành xung đột: tự tắt.
 * - Không đụng tới `settings` gốc; payload không có khoá và chiến dịch chưa từng bật thì trả nguyên như cũ.
 */
export function resolveCampaignRepeatSettings(input: CampaignRepeatResolveInput): { settings: Record<string, unknown>; error: string | null } {
  const settings = { ...input.settings }
  const explicit = Object.prototype.hasOwnProperty.call(input.settings, 'repeatAfterCompletionEnabled')
  if (!explicit) {
    if (input.currentSettings?.repeatAfterCompletionEnabled !== true) return { settings, error: null }
    settings.repeatAfterCompletionEnabled = true
    settings.repeatAfterCompletionEvery = input.currentSettings.repeatAfterCompletionEvery
    settings.repeatAfterCompletionUnit = input.currentSettings.repeatAfterCompletionUnit
    settings.repeatAfterCompletionMaxRuns = input.currentSettings.repeatAfterCompletionMaxRuns
  }
  const config = readCampaignRepeat(settings)
  const off = () => {
    settings.repeatAfterCompletionEnabled = false
    settings.repeatAfterCompletionUnit = config.unit ?? CAMPAIGN_REPEAT_DEFAULTS.unit
    settings.repeatAfterCompletionEvery = config.every ?? CAMPAIGN_REPEAT_DEFAULTS.every
    settings.repeatAfterCompletionMaxRuns = config.maxRuns ?? CAMPAIGN_REPEAT_DEFAULTS.maxRuns
    return { settings, error: null }
  }
  if (!config.enabled) return off()
  const units = campaignRepeatUnits(input.actionId, {
    zaloMessageSendMode: settings.zaloMessageSendMode,
    dataTargetSourceMode: input.dataTargetSourceMode,
    scheduleType: input.scheduleType,
  })
  if (!input.featureEnabled || units.length === 0 || settings.multiDailyTimeSlotsEnabled === true) return off()
  const error = campaignRepeatError(config, units, settings)
  if (error) return explicit ? { settings, error } : off()
  settings.repeatAfterCompletionEvery = config.every
  settings.repeatAfterCompletionUnit = config.unit
  settings.repeatAfterCompletionMaxRuns = config.maxRuns
  return { settings, error: null }
}
