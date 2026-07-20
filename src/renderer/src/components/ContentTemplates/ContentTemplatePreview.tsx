import { useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, Mail, MessageCircle, Send } from 'lucide-react'
import type { ContentTemplateChannelName } from '../../../../shared/types'
import { renderContentSpin } from '../../../../shared/contentSpin'
import {
  formattedContentToZaloPreviewHtml,
  isFormattedContentEmpty,
  sanitizeFormattedContent,
  transformFormattedContentTextNodes
} from '../../../../shared/formattedContent'
import { renderPreviewSampleTokens } from '../CampaignPanels/ContentPreviewModal'

export type TemplatePreviewChannel = ContentTemplateChannelName

interface ContentTemplatePreviewProps {
  channel: TemplatePreviewChannel
  variants: string[]
  formatted?: boolean
  subject?: string
  imageUrls?: string[]
}

const renderPlainSample = (value: string): string =>
  renderPreviewSampleTokens(renderContentSpin(String(value || '')))

const renderRichSample = (value: string, channel: TemplatePreviewChannel): string => {
  const transformed = transformFormattedContentTextNodes(
    sanitizeFormattedContent(value),
    text => renderPreviewSampleTokens(renderContentSpin(text))
  )
  return channel === 'zalo_message' ? formattedContentToZaloPreviewHtml(transformed) : transformed
}

function ChannelImagePreview({ imageUrls }: { imageUrls: string[] }) {
  if (imageUrls.length === 0) return null
  const visible = imageUrls.slice(0, 4)

  return (
    <div className={`ctw-preview-images count-${Math.min(visible.length, 4)}`}>
      {visible.map((url, index) => (
        <div className="ctw-preview-image" key={`${url}-${index}`}>
          <img src={url} alt={`Ảnh ${index + 1}`} />
          {index === 3 && imageUrls.length > 4 && <span>+{imageUrls.length - 4}</span>}
        </div>
      ))}
    </div>
  )
}

export default function ContentTemplatePreview({
  channel,
  variants,
  formatted = false,
  subject = '',
  imageUrls = []
}: ContentTemplatePreviewProps) {
  const normalizedVariants = variants.length > 0 ? variants : ['']
  const [variantIndex, setVariantIndex] = useState(0)

  useEffect(() => {
    setVariantIndex(0)
  }, [channel, variants.length])

  const selectedVariant = normalizedVariants[Math.min(variantIndex, normalizedVariants.length - 1)] || ''
  const renderedPlain = useMemo(() => renderPlainSample(selectedVariant), [selectedVariant])
  const renderedRich = useMemo(
    () => formatted ? renderRichSample(selectedVariant, channel) : '',
    [channel, formatted, selectedVariant]
  )
  const renderedSubject = useMemo(() => renderPlainSample(subject), [subject])
  const richIsEmpty = formatted && isFormattedContentEmpty(renderedRich)
  const contentNode = formatted && !richIsEmpty
    ? <div className="ctw-preview-rich" dangerouslySetInnerHTML={{ __html: renderedRich }} />
    : <div className="ctw-preview-plain">{renderedPlain || 'Nội dung xem trước sẽ hiển thị tại đây.'}</div>

  const chatPreview = channel === 'sms' || channel === 'zalo_message' || channel === 'facebook_message'

  return (
    <div className="ctw-preview-panel">
      {normalizedVariants.length > 1 && (
        <div className="ctw-preview-variant-tabs" role="tablist" aria-label="Biến thể xem trước">
          {normalizedVariants.map((_, index) => (
            <button
              type="button"
              key={index}
              className={variantIndex === index ? 'active' : ''}
              onClick={() => setVariantIndex(index)}
            >
              Nội dung {index + 1}
            </button>
          ))}
        </div>
      )}

      <div className={`ctw-preview-stage ${channel}`}>
        {chatPreview && (
          <div className={`ctw-preview-phone ${channel}`}>
            <div className="ctw-preview-phone-bar">
              {channel === 'sms' ? (
                <><span className="ctw-preview-avatar sms">KH</span><div><strong>0987 654 321</strong><small>SMS/MMS</small></div></>
              ) : (
                <><span className={`ctw-preview-avatar ${channel}`}>MA</span><div><strong>Nguyễn Minh Anh</strong><small>Đang hoạt động</small></div></>
              )}
            </div>
            <div className="ctw-preview-chat-date">Hôm nay, 09:41</div>
            <div className="ctw-preview-message-row">
              <div className="ctw-preview-message-bubble">
                {channel !== 'sms' && <ChannelImagePreview imageUrls={imageUrls} />}
                {contentNode}
              </div>
            </div>
            <div className="ctw-preview-composer">
              {channel !== 'sms' && <MessageCircle size={15} />}
              <span>{channel === 'sms' ? 'Tin nhắn văn bản' : 'Nhập tin nhắn'}</span>
              <Send size={15} />
            </div>
          </div>
        )}

        {channel === 'facebook_post' && (
          <div className="ctw-preview-facebook-card">
            <div className="ctw-preview-facebook-head">
              <span className="ctw-preview-avatar facebook">MA</span>
              <div><strong>Nguyễn Minh Anh</strong><span>Vừa xong · 🌐</span></div>
            </div>
            <div className="ctw-preview-facebook-content">{contentNode}</div>
            <ChannelImagePreview imageUrls={imageUrls} />
            <div className="ctw-preview-facebook-actions"><span>Thích</span><span>Bình luận</span><span>Chia sẻ</span></div>
          </div>
        )}

        {channel === 'facebook_comment' && (
          <div className="ctw-preview-facebook-card comment">
            <div className="ctw-preview-facebook-head muted">
              <span className="ctw-preview-avatar facebook">BA</span>
              <div><strong>Bài đăng mẫu</strong><span>Vừa xong · 🌐</span></div>
            </div>
            <div className="ctw-preview-comment-row">
              <span className="ctw-preview-avatar facebook">MA</span>
              <div className="ctw-preview-comment-bubble"><strong>Nguyễn Minh Anh</strong>{contentNode}</div>
            </div>
            <ChannelImagePreview imageUrls={imageUrls} />
          </div>
        )}

        {channel === 'email' && (
          <div className="ctw-preview-email-card">
            <div className="ctw-preview-email-toolbar"><Mail size={16} /><strong>Thư mới</strong></div>
            <div className="ctw-preview-email-meta"><span>Từ:</span><strong> AkaAgent &lt;hello@example.com&gt;</strong></div>
            <div className="ctw-preview-email-meta"><span>Đến:</span><strong> Nguyễn Minh Anh</strong></div>
            <div className="ctw-preview-email-subject">{renderedSubject || 'Chưa có tiêu đề email'}</div>
            <div className="ctw-preview-email-body">{contentNode}</div>
            {imageUrls.length > 0 && (
              <div className="ctw-preview-attachments"><ImageIcon size={15} /> {imageUrls.length} ảnh đính kèm</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
