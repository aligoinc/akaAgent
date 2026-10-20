import CampaignFormAiPopover, { type CampaignFormAiProps } from './CampaignFormAiPopover'
import { EXCLUSION_AI_MESSAGES, type ExclusionAiContext, type ExclusionAiPatch } from '../../../../shared/campaignExclusionAi'

interface Props extends CampaignFormAiProps<ExclusionAiPatch> { context: ExclusionAiContext }
export default function CampaignExclusionAi({ context, ...props }: Props) {
  return <CampaignFormAiPopover {...props} authScope={`${props.authScope}:${JSON.stringify(context)}`}
    title="Tạo nhóm loại trừ bằng AI" closeLabel="Đóng nhập điều kiện AI"
    label="Mô tả khách hàng muốn loại trừ" placeholder="Ví dụ: loại trừ người có tag VIP hoặc đã nhận tin trong 7 ngày gần nhất"
    hint="AI mở form Thêm nhóm và điền điều kiện cho tài khoản đang chọn. Bạn kiểm tra rồi bấm Lưu nhóm."
    submitLabel="Điền nhóm điều kiện" unavailableMessage={EXCLUSION_AI_MESSAGES.unavailable}
    generateRequest={(requestId, description) => window.electronAPI.generateCampaignExclusionAi({ requestId, description, context })}
    cancelRequest={requestId => window.electronAPI.cancelCampaignExclusionAi(requestId)} />
}
