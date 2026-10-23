import { FACEBOOK_AI_MESSAGES, type FacebookAiRequest, type FacebookAiPatch } from '../../../../shared/campaignFacebookAi'
import CampaignFormAiPopover, { type CampaignFormAiProps } from './CampaignFormAiPopover'
type Props = CampaignFormAiProps<FacebookAiPatch> & { title: string; snapshot: Omit<FacebookAiRequest, 'requestId' | 'description'> }
export default function CampaignFacebookAi({ title, snapshot, ...props }: Props) {
  return <CampaignFormAiPopover {...props} authScope={`${props.authScope}:${JSON.stringify(snapshot)}`}
    title={`AI điền ${title}`} label="Mô tả cấu hình bạn muốn" placeholder="Nhập yêu cầu bằng ngôn ngữ tự nhiên…"
    hint="AI điền bản nháp để bạn kiểm tra. Chỉ thay đổi các trường thuộc phần này."
    closeLabel={`Đóng AI ${title}`} submitLabel="Điền cấu hình" unavailableMessage={FACEBOOK_AI_MESSAGES.unavailable}
    generateRequest={(requestId, description) => window.electronAPI.generateCampaignFacebookAi({ ...snapshot, requestId, description })}
    cancelRequest={requestId => window.electronAPI.cancelCampaignFacebookAi(requestId)} />
}
