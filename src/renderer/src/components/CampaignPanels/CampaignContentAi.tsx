import CampaignFormAiPopover, { type CampaignFormAiProps } from './CampaignFormAiPopover'
import { CONTENT_AI_MESSAGES, type ContentAiContext, type ContentAiItem, type ContentAiPatch } from '../../../../shared/campaignContentAi'

interface Props extends CampaignFormAiProps<ContentAiPatch> { context: ContentAiContext; items: ContentAiItem[] }
export default function CampaignContentAi({ context, items, ...props }: Props) {
  return <CampaignFormAiPopover {...props} authScope={`${props.authScope}:${context.actionId}:${context.mode}:${context.format}:${JSON.stringify(items)}`}
    title="Viết nội dung bằng AI" closeLabel="Đóng nhập nội dung AI"
    label="Mô tả nội dung muốn viết hoặc sửa" placeholder="Ví dụ: viết ngắn gọn hơn và thêm 3 biến thể với giọng thân thiện"
    hint="Chỉ viết/sửa chữ và thêm biến thể. Giữ media và tùy chọn gửi; bạn kiểm tra rồi bấm Lưu." submitLabel="Điền nội dung"
    unavailableMessage={CONTENT_AI_MESSAGES.unavailable}
    generateRequest={(requestId, description) => window.electronAPI.generateCampaignContentAi({ requestId, description, context, items })}
    cancelRequest={requestId => window.electronAPI.cancelCampaignContentAi(requestId)} />
}
