import CampaignFormAiPopover, { type CampaignFormAiProps } from './CampaignFormAiPopover'
import { SCHEDULE_AI_MESSAGES, type ScheduleAiContext, type ScheduleAiFields, type ScheduleAiPatch } from '../../../../shared/campaignScheduleAi'

interface Props extends CampaignFormAiProps<ScheduleAiPatch> { context: ScheduleAiContext; schedule: ScheduleAiFields }
export default function CampaignScheduleAi({ context, schedule, ...props }: Props) {
  return <CampaignFormAiPopover {...props} title="Điền lịch bằng AI" closeLabel="Đóng nhập lịch AI"
    label="Mô tả lịch muốn chạy" placeholder="Ví dụ: gửi vào thứ 2, 4, 6 hằng tuần lúc 8h"
    hint="Giờ Việt Nam · Có thể đặt lịch mới hoặc chỉ đổi một phần lịch." submitLabel="Điền lịch"
    unavailableMessage={SCHEDULE_AI_MESSAGES.unavailable}
    generateRequest={(requestId, description) => window.electronAPI.generateCampaignScheduleAi({ requestId, description, context, schedule })}
    cancelRequest={requestId => window.electronAPI.cancelCampaignScheduleAi(requestId)} />
}
