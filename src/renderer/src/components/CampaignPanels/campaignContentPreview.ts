import type { CampaignConfig, CampaignInputData, CampaignMediaInput, ContentTemplateChannelName } from '../../../../shared/types'
import { getAdvancedContentItems } from '../../../../shared/advancedContent'
import { splitContentVariants } from '../../../../shared/contentSpin'
import { isFormattedContentEmpty, splitFormattedContentVariants, supportsFormattedContent } from '../../../../shared/formattedContent'
import { normalizeSmsContentForSend } from '../../../../shared/smsContent'
import { renderPreviewSampleTokens } from './ContentPreviewModal'
import { getContentTemplateChannelForAction } from './contentTemplateCampaignUtils'

export const MAX_CAMPAIGN_CONTENT_PREVIEWS = 3

export interface CampaignContentPreviewItem {
  id: string
  title: string
  content: string
  subject: string
  media: CampaignMediaInput[]
  randomMedia: boolean
}

export interface CampaignContentPreviewModel {
  channel: ContentTemplateChannelName
  formatted: boolean
  items: CampaignContentPreviewItem[]
  notes: string[]
}

export function buildCampaignContentPreview(campaign: CampaignConfig): CampaignContentPreviewModel | null {
  const channel = getContentTemplateChannelForAction(campaign.actionId)
  if (!channel) return null
  const extra = campaign.extraSettings || {}
  const formatted = channel === 'email'
    ? extra.emailBodyIsHtml === true
    : supportsFormattedContent(campaign.actionId) && extra.formattedContentEnabled === true
  const selectMedia = (media: CampaignMediaInput[], mode: 'none' | 'all' | 'random', count = 3) => {
    if (channel === 'sms' || mode === 'none' || extra.postWithBackground) return []
    const limit = channel === 'facebook_comment' ? 1 : mode === 'random' ? Math.max(1, count) : media.length
    return media.slice(0, limit)
  }
  const hasContent = (text: string) => formatted && channel !== 'email' ? !isFormattedContentEmpty(text) : !!text.trim()
  // Advanced items are atomic, including pipes. Group contents come exclusively
  // from the saved snapshot; never resolve live templates in this read-only tab.
  const items: CampaignContentPreviewItem[] = extra.advancedContentEnabled
    ? getAdvancedContentItems(extra).slice(0, MAX_CAMPAIGN_CONTENT_PREVIEWS).map((item, index) => ({
      id: `${index}-${item.id}`,
      title: item.sourceTemplateName || `Nội dung ${index + 1}`,
      content: item.content,
      subject: item.emailSubject ?? (extra.advancedContentSource === 'group_snapshot' ? '' : extra.emailSubject || ''),
      media: selectMedia(item.mediaItems || [], item.mediaOption || 'none', item.randomMediaCount),
      randomMedia: item.mediaOption === 'random'
    }))
    : (() => {
      const content = campaign.content || ''
      const variants = formatted
        ? channel === 'email' ? [content] : splitFormattedContentVariants(content)
        : splitContentVariants(content)
      const media = selectMedia(campaign.images || [], extra.imageOption || 'all', extra.randomImageCount)
      if (!variants.some(hasContent) && media.length === 0) return []
      return (variants.length ? variants : ['']).slice(0, MAX_CAMPAIGN_CONTENT_PREVIEWS).map((text, index) => ({
        id: `basic-${index}`,
        title: `Nội dung ${index + 1}`,
        content: text,
        subject: extra.emailSubject || '',
        media,
        randomMedia: extra.imageOption === 'random'
      }))
    })()
  const notes: string[] = []
  if (extra.enableMessage === false && (channel === 'zalo_message' || channel === 'facebook_message')) notes.push('Đang tắt gửi tin nhắn; preview hiển thị nội dung đã lưu trong cấu hình.')
  if (extra.copyContentFromSource || extra.sharePost) notes.push('Nội dung từ link nguồn được lấy khi chạy chiến dịch; preview chỉ hiển thị phần đã lưu.')
  if (extra.rewriteContentEachRun) notes.push('Đang bật AI viết lại nội dung khi chạy; preview hiển thị nội dung trước khi viết lại.')
  if (items.some(item => item.randomMedia)) notes.push('Media ngẫu nhiên: preview dùng các file đầu tiên trong kho media của từng nội dung.')
  if (extra.postWithBackground) notes.push('Phông nền Facebook được chọn khi đăng bài.')
  return { channel, formatted, items, notes }
}

/** Leave profile-only tokens visible: input rows do not contain verified Zalo/FB profiles. */
export function renderCampaignPreviewTokens(raw: string, input: CampaignInputData): string {
  const values: Record<string, string | undefined> = {
    INPUT_FULLNAME: input.name, PHONE: input.phone, MOBILE: input.phone, EMAIL: input.email,
    UID: input.uid, INFO1: input.info1, INFO2: input.info2, INFO3: input.info3, INFO4: input.info4, INFO5: input.info5
  }
  return raw.replace(/#\{(?:TODAY|TOMORROW|YESTERDAY)\([^}]*\)\}|#\{[A-Z0-9_]+\}/g, token => {
    if (/^#\{(?:TODAY|TOMORROW|YESTERDAY)\(/.test(token) || token === '#{STOP_MESSAGES_LINK}') return renderPreviewSampleTokens(token)
    return values[token.slice(2, -1)] ?? token
  })
}

export function normalizeCampaignPreviewText(text: string, campaign: CampaignConfig): string {
  return campaign.actionId === 'sms_send'
    ? normalizeSmsContentForSend(text, {
      useUnicode: campaign.extraSettings?.smsUseUnicode ?? false,
      keepNewLines: campaign.extraSettings?.smsKeepNewLines ?? false
    })
    : text
}
