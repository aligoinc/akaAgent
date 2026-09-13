import { useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, Mail, MessageCircle, Send } from 'lucide-react'
import type { ContentTemplateChannelName } from '../../../../shared/types'
import { renderContentSpin } from '../../../../shared/contentSpin'
import {
  escapeFormattedContentText,
  formattedContentToZaloPreviewHtml,
  isFormattedContentEmpty,
  sanitizeFormattedContent,
  transformFormattedContentTextNodes
} from '../../../../shared/formattedContent'
import { renderPreviewSampleTokens } from '../CampaignPanels/ContentPreviewModal'
import { isVideoMediaSource } from '../Media/mediaImage'
import './contentTemplateWorkspace.css'

export type TemplatePreviewChannel = ContentTemplateChannelName

interface ContentTemplatePreviewProps {
  channel: TemplatePreviewChannel
  variants: string[]
  formatted?: boolean
  subject?: string
  imageUrls?: string[]
  mediaMimeTypes?: Record<string, string>
  showSampleData?: boolean
  renderTokens?: (value: string) => string
  recipientName?: string
  recipientPhone?: string
  senderName?: string
  footer?: string
  emailHtml?: boolean
  emptyContentText?: string
  activeVariantIndex?: number
  onActiveVariantChange?: (index: number) => void
}

const renderSpunRichContent = (value: string): string =>
  transformFormattedContentTextNodes(
    sanitizeFormattedContent(value),
    text => renderContentSpin(text)
  )

const renderRichPreview = (
  spunContent: string,
  channel: TemplatePreviewChannel,
  showSampleData: boolean,
  renderTokens: (value: string) => string
): string => {
  const rendered = showSampleData
    ? transformFormattedContentTextNodes(spunContent, renderTokens)
    : spunContent
  return channel === 'zalo_message' ? formattedContentToZaloPreviewHtml(rendered) : rendered
}

function ChannelImagePreview({
  imageUrls,
  mediaMimeTypes = {},
  facebookPost = false
}: {
  imageUrls: string[]
  mediaMimeTypes?: Record<string, string>
  facebookPost?: boolean
}) {
  if (imageUrls.length === 0) return null
  const visibleLimit = facebookPost ? 5 : 4
  const visible = imageUrls.slice(0, visibleLimit)
  const hiddenCount = imageUrls.length - visible.length

  return (
    <div className={`ctw-preview-images${facebookPost ? ' facebook-post' : ''} count-${visible.length}`}>
      {visible.map((url, index) => (
        <div className="ctw-preview-image" key={`${url}-${index}`}>
          {isVideoMediaSource(mediaMimeTypes[url], url)
            ? <video src={url} aria-label={`Video ${index + 1}`} muted controls preload="metadata" />
            : <img src={url} alt={`Ảnh ${index + 1}`} />}
          {index === visible.length - 1 && hiddenCount > 0 && <span>+{hiddenCount}</span>}
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
  imageUrls = [],
  mediaMimeTypes = {},
  showSampleData = true,
  renderTokens = renderPreviewSampleTokens,
  recipientName = 'Nguyễn Minh Anh',
  recipientPhone = '0987 654 321',
  senderName,
  footer,
  emailHtml = false,
  emptyContentText = 'Nội dung xem trước sẽ hiển thị tại đây.',
  activeVariantIndex,
  onActiveVariantChange
}: ContentTemplatePreviewProps) {
  const normalizedVariants = variants.length > 0 ? variants : ['']
  const supportsVideo = channel === 'facebook_post' || channel === 'facebook_message' || channel === 'facebook_comment'
  const compatibleMediaUrls = supportsVideo
    ? imageUrls
    : imageUrls.filter(url => !isVideoMediaSource(mediaMimeTypes[url], url))
  const [internalVariantIndex, setInternalVariantIndex] = useState(0)
  const resolvedVariantIndex = Math.max(
    0,
    Math.min(activeVariantIndex ?? internalVariantIndex, normalizedVariants.length - 1)
  )

  useEffect(() => {
    if (activeVariantIndex === undefined) setInternalVariantIndex(0)
  }, [channel, variants.length])

  const selectedVariant = normalizedVariants[resolvedVariantIndex] || ''
  const spunPlain = useMemo(
    () => renderContentSpin(String(selectedVariant || '')),
    [selectedVariant]
  )
  const spunRich = useMemo(
    () => formatted ? renderSpunRichContent(selectedVariant) : '',
    [formatted, selectedVariant]
  )
  const spunSubject = useMemo(
    () => renderContentSpin(String(subject || '')),
    [subject]
  )
  const renderedPlain = useMemo(
    () => showSampleData ? renderTokens(spunPlain) : spunPlain,
    [showSampleData, spunPlain, renderTokens]
  )
  const renderedRich = useMemo(
    () => formatted ? renderRichPreview(spunRich, channel, showSampleData, renderTokens) : '',
    [channel, formatted, showSampleData, spunRich, renderTokens]
  )
  const renderedSubject = useMemo(
    () => showSampleData ? renderTokens(spunSubject) : spunSubject,
    [showSampleData, spunSubject, renderTokens]
  )
  const richIsEmpty = formatted && isFormattedContentEmpty(renderedRich)
  const renderedEmailHtml = useMemo(() => {
    if (!emailHtml) return ''
    if (!showSampleData) return spunPlain
    // Preserve email layouts and escape interpolated data in text/attributes.
    return spunPlain.replace(/#\{(?:SEX\{[^}]*\}|[^{}]*)\}/g, token => escapeFormattedContentText(renderTokens(token)))
  }, [emailHtml, showSampleData, spunPlain, renderTokens])
  const plainText = formatted ? '' : renderedPlain
  const bodyNode = formatted && !richIsEmpty
    ? <div className="ctw-preview-rich" dangerouslySetInnerHTML={{ __html: renderedRich }} />
    : plainText || emptyContentText ? <div className="ctw-preview-plain">{plainText || emptyContentText}</div> : null

  const contentNode = <>{bodyNode}{footer && <div className="ctw-preview-plain ctw-preview-footer">{footer}</div>}</>
  const initials = (name: string) => name.trim().split(/\s+/).slice(-2).map(part => part[0]).join('').toUpperCase() || 'KH'
  const authorName = senderName || 'Nguyễn Minh Anh'

  const chatPreview = channel === 'sms' || channel === 'zalo_message' || channel === 'facebook_message'

  return (
    <div className="ctw-preview-panel">
      {normalizedVariants.length > 1 && (
        <div className="ctw-preview-variant-tabs" role="tablist" aria-label="Biến thể xem trước">
          {normalizedVariants.map((_, index) => (
            <button
              type="button"
              key={index}
              className={resolvedVariantIndex === index ? 'active' : ''}
              onClick={() => {
                if (activeVariantIndex === undefined) setInternalVariantIndex(index)
                onActiveVariantChange?.(index)
              }}
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
                <><span className="ctw-preview-avatar sms">KH</span><div><strong>{recipientPhone}</strong><small>SMS/MMS</small></div></>
              ) : (
                <><span className={`ctw-preview-avatar ${channel}`}>{initials(recipientName)}</span><div><strong>{recipientName}</strong><small>Đang hoạt động</small></div></>
              )}
            </div>
            <div className="ctw-preview-chat-date">Hôm nay, 09:41</div>
            <div className="ctw-preview-message-row">
              <div className="ctw-preview-message-bubble">
                {channel !== 'sms' && <ChannelImagePreview mediaMimeTypes={mediaMimeTypes} imageUrls={compatibleMediaUrls} />}
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
              <span className="ctw-preview-avatar facebook">{initials(authorName)}</span>
              <div><strong>{authorName}</strong><span>Vừa xong · 🌐</span></div>
            </div>
            <div className="ctw-preview-facebook-content">{contentNode}</div>
            <ChannelImagePreview mediaMimeTypes={mediaMimeTypes} imageUrls={compatibleMediaUrls} facebookPost />
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
              <span className="ctw-preview-avatar facebook">{initials(authorName)}</span>
              <div className="ctw-preview-comment-bubble"><strong>{authorName}</strong>{contentNode}</div>
            </div>
            <ChannelImagePreview mediaMimeTypes={mediaMimeTypes} imageUrls={compatibleMediaUrls.slice(0, 1)} />
            {compatibleMediaUrls.length > 1 && (
              <div className="ctw-preview-comment-media-note">
                Ngẫu nhiên 1 trong {compatibleMediaUrls.length} media
              </div>
            )}
          </div>
        )}

        {channel === 'email' && (
          <div className="ctw-preview-email-card">
            <div className="ctw-preview-email-toolbar"><Mail size={16} /><strong>Thư mới</strong></div>
            <div className="ctw-preview-email-meta"><span>Từ:</span><strong> {senderName || 'AkaAgent <hello@example.com>'}</strong></div>
            <div className="ctw-preview-email-meta"><span>Đến:</span><strong> {recipientName}</strong></div>
            <div className="ctw-preview-email-subject">{renderedSubject || 'Chưa có tiêu đề email'}</div>
            <div className="ctw-preview-email-body">{emailHtml
              ? <iframe title="Xem trước Email HTML" sandbox="" srcDoc={renderedEmailHtml} style={{ width: '100%', minHeight: 300, border: 0 }} />
              : contentNode}</div>
            {compatibleMediaUrls.length > 0 && (
              <div className="ctw-preview-attachments"><ImageIcon size={15} /> {compatibleMediaUrls.length} ảnh đính kèm</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
