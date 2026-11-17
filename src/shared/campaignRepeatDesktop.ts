import {
  CAMPAIGN_REPEAT_EVERY_LIMITS, CAMPAIGN_REPEAT_FIND_DATA_ACTIONS, CAMPAIGN_REPEAT_MAX_RUNS, CAMPAIGN_REPEAT_MIN_RUNS,
  readCampaignRepeat, type CampaignRepeatUnit
} from './campaignRepeat'

/**
 * Phần riêng Desktop của "Lặp lại sau khi chạy xong" (hợp đồng dùng chung ở `campaignRepeat.ts`, chép nguyên văn từ WebApp).
 *
 * Bốn loại Facebook (tìm data theo group, tìm data theo search, comment seeding, lướt newsfeed) trước đây chỉ có "Chạy lại sau mỗi
 * x giờ" (`findDataRerunEnabled` / `findDataRerunAfterHours`). Với lịch Hàng ngày, form nay dùng cài đặt mới (phút / giờ / ngày, số
 * lượt tối đa, ngày kết thúc). Chiến dịch đang lưu cài đặt cũ vẫn chạy theo cách cũ cho tới khi người dùng mở ra sửa; lúc đó form
 * đổi "x giờ" cũ sang cài đặt mới bằng hàm này. Lịch tuần / tháng giữ cài đặt cũ.
 */
export interface LegacyRerunConversion {
  every: number
  unit: CampaignRepeatUnit
  maxRuns: number
}

export function campaignRepeatFromLegacyRerun(campaign: {
  actionId?: string | null
  scheduleType?: string | null
  dataTargetSourceMode?: string | null
  extraSettings?: Record<string, unknown> | null
} | null | undefined): LegacyRerunConversion | null {
  if (!campaign || !CAMPAIGN_REPEAT_FIND_DATA_ACTIONS.includes(String(campaign.actionId || ''))) return null
  if ((campaign.scheduleType || 'daily') !== 'daily' || campaign.dataTargetSourceMode === 'data_group') return null
  const extra = campaign.extraSettings || {}
  if (extra.findDataRerunEnabled !== true || readCampaignRepeat(extra).enabled) return null
  const hours = Math.floor(Number(extra.findDataRerunAfterHours))
  if (!Number.isFinite(hours) || hours < 1) return null
  const every = Math.min(hours, CAMPAIGN_REPEAT_EVERY_LIMITS.hour.max)
  // Cài đặt cũ chỉ lặp trong ngày và không có số lượt tối đa: lấy số lượt chạy vừa một ngày làm giá trị đề xuất, người dùng sửa được.
  const maxRuns = Math.min(CAMPAIGN_REPEAT_MAX_RUNS, Math.max(CAMPAIGN_REPEAT_MIN_RUNS, Math.ceil(24 / every)))
  return { every, unit: 'hour', maxRuns }
}
