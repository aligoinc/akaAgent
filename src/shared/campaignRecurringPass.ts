// Luật chung cho lịch tuần / tháng có "làm mới data" (refresh_data) và lịch hằng ngày không tích
// "hôm sau tiếp tục" (continue_next_day = false). Dùng ở bước bảo trì lịch đầu ngày và lúc chạy xong
// danh sách (Desktop + App Server). Engine v2 trong DB làm theo cùng luật (migration V648).

export interface RecurringPassInputRow {
  status: string
  isDelete?: boolean
}

/**
 * Danh sách đã chạy xong để làm mới cho lượt sau chưa. Data "tạm dừng" (vd. nhóm Zalo đã mất, mã 161 với
 * input_effect = pause) không bao giờ tự xong và câu đặt lại cũng bỏ qua nó, nên coi là đã xong; nhưng phải
 * còn ít nhất một dòng "hoàn thành", không thì làm mới cũng không có gì để chạy.
 */
export function isRefreshablePassDone(rows: readonly RecurringPassInputRow[]): boolean {
  let done = 0
  for (const row of rows) {
    if (row.isDelete) continue
    if (row.status === 'hoàn thành') {
      done += 1
      continue
    }
    if (row.status === 'tạm dừng') continue
    return false
  }
  return done > 0
}

export interface RecurringCampaignShape {
  scheduleType?: string | null
  refreshData?: boolean | null
  continueNextDay?: boolean | null
  dailyStopTime?: string | null
}

/** Lịch tuần / tháng có làm mới data: chạy xong danh sách thì hẹn lượt kế thay vì "hoàn thành". */
export function isRecurringRefreshCampaign(campaign: RecurringCampaignShape): boolean {
  const type = campaign.scheduleType || 'daily'
  return (type === 'weekly' || type === 'monthly') && campaign.refreshData === true
}

/**
 * Hằng ngày, có giờ dừng, không tích "hôm sau tiếp tục": chỉ chạy trong ngày đầu, hết giờ dừng là dừng hẳn
 * (anh chốt 24/11/2026; trước đó app chạy tiếp ngay từ 00:00 hôm sau, ngoài khung giờ khách đặt).
 * Không có giờ dừng thì giữ như cũ: chạy liên tục tới khi hết data.
 */
export function isSingleDayStopCampaign(campaign: RecurringCampaignShape): boolean {
  const type = campaign.scheduleType || 'daily'
  return type === 'daily' && campaign.continueNextDay !== true && Boolean(String(campaign.dailyStopTime || '').trim())
}

export const SINGLE_DAY_STOP_INPUT_NOTE = 'Chưa gửi vì chiến dịch chỉ chạy trong ngày đầu (không chọn "hôm sau tiếp tục")'
export const SINGLE_DAY_STOP_CAMPAIGN_NOTE = 'Đã dừng sau ngày đầu theo cài đặt: không chọn "hôm sau tiếp tục chạy theo thời gian hẹn giờ".'
