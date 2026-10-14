import type { Campaign } from '../../shared/types'
import type { DiagnosticScheduleContext } from '../../shared/campaignDiagnostics'

// Describe the existing scheduler contract; never use this context to dispatch or mutate a campaign.
export function describeDiagnosticSchedule(
  campaign: Pick<Campaign, 'dataTargetSourceMode' | 'scheduleEndDate'>,
  dbNow: string | null
): DiagnosticScheduleContext {
  const now = Date.parse(dbNow || '')
  const end = Date.parse(campaign.scheduleEndDate || '')
  const sourceMode = campaign.dataTargetSourceMode === 'data_group' ? 'data_group'
    : campaign.dataTargetSourceMode === 'direct' ? 'direct' : 'unknown'
  return {
    evaluatedAt: Number.isFinite(now) ? dbNow : null,
    timeZone: 'Asia/Ho_Chi_Minh',
    sourceMode,
    endDatePolicy: sourceMode === 'data_group' ? 'hard_end'
      : sourceMode === 'direct' ? 'completion_and_recurrence' : 'unknown',
    endDateState: !campaign.scheduleEndDate ? 'not_set'
      : !Number.isFinite(now) || !Number.isFinite(end) ? 'unknown' : now >= end ? 'reached' : 'future',
    explanation: sourceMode === 'data_group'
      ? 'Với nguồn Nhóm data, ngày kết thúc là mốc dừng nhận lượt thực thi mới, kể cả khi còn data chờ.'
      : sourceMode === 'direct'
        ? 'Với data trực tiếp, ngày kết thúc được xét khi chuyển kỳ và hoàn tất chiến dịch; ngày kết thúc cũ không tự chặn data còn chờ. Lượt chạy vẫn phải đáp ứng lịch, giờ dừng và trạng thái chiến dịch.'
        : 'Chưa xác minh được nguồn data nên chưa thể kết luận cách áp dụng ngày kết thúc.'
  }
}
