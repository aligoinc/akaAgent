import { useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, Mail, MessageCircle, Send } from 'lucide-react'
import { renderContentSpin } from '../../../../shared/contentSpin'
import {
  formattedContentToZaloPreviewHtml,
  isFormattedContentEmpty,
  sanitizeFormattedContent,
  transformFormattedContentTextNodes
} from '../../../../shared/formattedContent'
import { renderPreviewSampleTokens } from '../CampaignPanels/ContentPreviewModal'

export type TemplatePreviewChannel = 'base' | 'sms' | 'zalo' | 'facebook' | 'email'

interface ContentTemplatePreviewProps {
  channel: TemplatePreviewChannel
  variants: string[]
  formatted?: boolean
  subject?: string
  imageUrls?: string[]
}

const CHANNEL_LABELS: Record<TemplatePreviewChannel, string> = {
  base: 'Nội dung cơ bản',
  sms: 'SMS',
  zalo: 'Zalo',
  facebook: 'Facebook',
  email: 'Email'
}

const renderPlainSample = (value: string): string =>
  renderPreviewSampleTokens(renderContentSpin(String(value || '')))

const renderRichSample = (value: string, channel: TemplatePreviewChannel): string => {
  const transformed = transformFormattedContentTextNodes(
    sanitizeFormattedContent(value),
    text => renderPreviewSampleTokens(renderContentSpin(text))
  )
  return channel === 'zalo' ? formattedContentToZaloPreviewHtml(transformed) : transformed
}

function SharedImagePreview({ imageUrls }: { imageUrls: string[] }) {
  if (imageUrls.length === 0) return null
  const visible = imageUrls.slice(0, 4)

  return (
    <div className={`ctw-preview-images count-${Math.min(visible.length, 4)}`}>
      {visible.map((url, index) => (
        <div className="ctw-preview-image" key={`${url}-${index}`}>
          <img src={url} alt={`Ảnh ${index + 1}`} />
          {index === 3 && imageUrls.length > 4 && (
            <span>+{imageUrls.length - 4}</span>
          )}
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
              Biến thể {index + 1}
            </button>
          ))}
        </div>
      )}

      <div className={`ctw-preview-stage ${channel}`}>
        {channel === 'sms' && (
          <div className="ctw-preview-phone sms">
            <div className="ctw-preview-phone-bar">Tin nhắn</div>
            <div className="ctw-preview-chat-date">Hôm nay, 09:41</div>
            <div className="ctw-preview-message-row">
              <div className="ctw-preview-message-bubble">{contentNode}</div>
            </div>
            <div className="ctw-preview-composer"><span>Tin nhắn văn bản</span><Send size={15} /></div>
          </div>
        )}

        {channel === 'zalo' && (
          <div className="ctw-preview-phone zalo">
            <div className="ctw-preview-phone-bar">
              <span className="ctw-preview-avatar zalo">MA</span>
              <strong>Nguyễn Minh Anh</strong>
            </div>
            <div className="ctw-preview-chat-date">Hôm nay</div>
            <div className="ctw-preview-message-row">
              <div className="ctw-preview-message-bubble">
                <SharedImagePreview imageUrls={imageUrls} />
                {contentNode}
              </div>
            </div>
            <div className="ctw-preview-composer"><MessageCircle size={15} /><span>Nhập tin nhắn</span><Send size={15} /></div>
          </div>
        )}

        {channel === 'facebook' && (
          <div className="ctw-preview-facebook-card">
            <div className="ctw-preview-facebook-head">
              <span className="ctw-preview-avatar facebook">MA</span>
              <div><strong>Nguyễn Minh Anh</strong><span>Vừa xong · 🌐</span></div>
            </div>
            <div className="ctw-preview-facebook-content">{contentNode}</div>
            <SharedImagePreview imageUrls={imageUrls} />
            <div className="ctw-preview-facebook-actions"><span>Thích</span><span>Bình luận</span><span>Chia sẻ</span></div>
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
              <div className="ctw-preview-attachments">
                <ImageIcon size={15} /> {imageUrls.length} ảnh đính kèm
              </div>
            )}
          </div>
        )}

        {channel === 'base' && (
          <div className="ctw-preview-base-card">
            <div className="ctw-preview-base-label">{CHANNEL_LABELS[channel]}</div>
            <div className="ctw-preview-base-content">{contentNode}</div>
            <SharedImagePreview imageUrls={imageUrls} />
          </div>
        )}
      </div>
    </div>
  )
}
