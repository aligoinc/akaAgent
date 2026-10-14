import CampaignFormAiPopover, { type CampaignFormAiProps } from './CampaignFormAiPopover'
import { LIMITS_AI_MESSAGES, type LimitsAiContext, type LimitsAiFields, type LimitsAiPatch } from '../../../../shared/campaignLimitsAi'

interface Props extends CampaignFormAiProps<LimitsAiPatch> { context: LimitsAiContext; limits: LimitsAiFields }
export default function CampaignLimitsAi({ context, limits, ...props }: Props) {
  return <CampaignFormAiPopover {...props} title="Điền giới hạn bằng AI" closeLabel="Đóng nhập giới hạn AI"
    label="Mô tả giới hạn muốn đặt" placeholder="Ví dụ: mỗi ngày gửi tối đa 50 tin, mỗi giờ 10 tin, nghỉ 30 giây giữa hai lần gửi"
    hint="Chỉ điền giới hạn trong phần này. Thông tin không nhắc đến sẽ giữ nguyên." submitLabel="Điền giới hạn"
    unavailableMessage={LIMITS_AI_MESSAGES.unavailable}
    generateRequest={(requestId, description) => window.electronAPI.generateCampaignLimitsAi({ requestId, description, context, limits })}
    cancelRequest={requestId => window.electronAPI.cancelCampaignLimitsAi(requestId)} />
}
