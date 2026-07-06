import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { FileText, Image, Mail, MessageCircle, Paperclip, Send, Share2, ThumbsUp, X } from 'lucide-react'
import { renderContentSpin, renderContentSpinMax, splitContentVariants } from '../../../../shared/contentSpin'

export type ContentPreviewKind = 'post' | 'comment' | 'message' | 'email' | 'answer' | 'friendRequest'
export type ContentPreviewPlatform = 'facebook' | 'zalo' | 'email' | 'generic'
export type ContentPreviewSurface = 'post' | 'comment' | 'chat' | 'story' | 'email' | 'answer'

export interface ContentPreviewMediaItem {
  path: string
  label?: string
  mimeType?: string | null
}

export interface ContentPreviewModalData {
  title: string
  subtitle?: string
  kind: ContentPreviewKind
  platform?: ContentPreviewPlatform
  surface?: ContentPreviewSurface
  content: string
  subject?: string
  isHtml?: boolean
  media?: ContentPreviewMediaItem[]
  mediaMode?: 'none' | 'all' | 'random'
  randomCount?: number
  notes?: string[]
}

interface ContentPreviewModalProps {
  data: ContentPreviewModalData
  onClose: () => void
}

interface PreviewMediaState {
  key: string
  path: string
  label: string
  dataUrl?: string
  status: 'loading' | 'ready' | 'file' | 'error'
  message?: string
}

const SAMPLE_TOKEN_VALUES: Record<string, string> = {
  FULL_NAME: 'Nguyễn Minh Anh',
  ORIGINAL_NAME: 'Minh Anh',
  INPUT_FULLNAME: 'Trần Quốc Bảo',
  PHONE: '0987654321',
  MOBILE: '0987654321',
  EMAIL: 'bao@example.com',
  INFO1: 'Khách VIP',
  INFO2: 'Quận 1',
  INFO3: 'Quan tâm sản phẩm A',
  INFO4: 'Nguồn Facebook',
  INFO5: 'Hẹn tư vấn chiều nay',
  UID: '100012345678901'
}

const IMAGE_EXTENSIONS = new Set(['.apng', '.avif', '.gif', '.jpg', '.jpeg', '.png', '.webp'])

const getFileName = (path: string, fallback = 'File') => {
  if (!path) return fallback
  if (path.startsWith('data:image/')) return fallback
  return path.split(/[\\/]/).pop() || fallback
}

const isLikelyImagePath = (path: string) => {
  if (path.startsWith('data:image/')) return true
  const cleanPath = path.split('?')[0].split('#')[0]
  const dotIndex = cleanPath.lastIndexOf('.')
  if (dotIndex < 0) return false
  return IMAGE_EXTENSIONS.has(cleanPath.slice(dotIndex).toLowerCase())
}

const isRemoteUrl = (path: string) => /^https?:\/\//i.test(path)

const isImageMime = (mimeType?: string | null) =>
  String(mimeType || '').toLowerCase().startsWith('image/')

const getDataImageMimeType = (path: string) => {
  const match = path.match(/^data:([^;,]+)[;,]/i)
  return match?.[1] || 'image/*'
}

const pad2 = (value: number) => String(value).padStart(2, '0')

const formatPreviewDate = (format: string, offsetDays: number) => {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return String(format || 'DD/MM/YYYY')
    .replace(/DD/g, pad2(date.getDate()))
    .replace(/MM/g, pad2(date.getMonth() + 1))
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/YY/g, String(date.getFullYear()).slice(-2))
}

export const renderPreviewSampleTokens = (raw: string): string => (
  String(raw || '')
    .replace(/#\{(TODAY|TOMORROW|YESTERDAY)\(([^}]*)\)\}/g, (_, token, format) => {
      const offsetDays = token === 'TOMORROW' ? 1 : token === 'YESTERDAY' ? -1 : 0
      return formatPreviewDate(String(format || 'DD/MM/YYYY'), offsetDays)
    })
    .replace(/#\{SEX\{([^}]*)\}\}/g, (_, body) => {
      const parts = String(body || '').split('-')
      return parts[1] || parts[0] || parts[2] || ''
    })
    .replace(/#\{(FULL_NAME|ORIGINAL_NAME|INPUT_FULLNAME|PHONE|MOBILE|EMAIL|INFO1|INFO2|INFO3|INFO4|INFO5|UID)\}/g, (_, key) => SAMPLE_TOKEN_VALUES[key] || '')
)

const splitPreviewVariants = (content: string): string[] => {
  return splitContentVariants(content, { fallbackToRaw: true })
}

const mediaKey = (item: ContentPreviewMediaItem, index: number) => `${index}-${item.path}`

const getFallbackPlatform = (kind: ContentPreviewKind): ContentPreviewPlatform => {
  if (kind === 'email') return 'email'
  if (kind === 'message' || kind === 'friendRequest') return 'facebook'
  if (kind === 'answer') return 'facebook'
  return 'facebook'
}

const getFallbackSurface = (kind: ContentPreviewKind): ContentPreviewSurface => {
  if (kind === 'email') return 'email'
  if (kind === 'message' || kind === 'friendRequest') return 'chat'
  if (kind === 'comment') return 'comment'
  if (kind === 'answer') return 'answer'
  return 'post'
}

const getInitials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(-2)
  .map(part => part[0])
  .join('')
  .toUpperCase() || 'MA'

export default function ContentPreviewModal({ data, onClose }: ContentPreviewModalProps) {
  const variants = useMemo(() => splitPreviewVariants(data.content), [data.content])
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0)
  const [mediaItems, setMediaItems] = useState<PreviewMediaState[]>([])

  useEffect(() => {
    setSelectedVariantIndex(0)
  }, [data.content])

  const selectedVariant = variants[Math.min(selectedVariantIndex, variants.length - 1)] || ''
  const selectedSpinSample = useMemo(
    () => data.kind === 'friendRequest' ? renderContentSpinMax(selectedVariant) : renderContentSpin(selectedVariant),
    [data.kind, selectedVariant]
  )
  const subjectSpinSample = useMemo(() => renderContentSpin(data.subject || ''), [data.subject])
  const renderedContent = renderPreviewSampleTokens(selectedSpinSample)
  const renderedSubject = renderPreviewSampleTokens(subjectSpinSample)
  const platform = data.platform || getFallbackPlatform(data.kind)
  const surface = data.surface || getFallbackSurface(data.kind)
  const isEmail = platform === 'email' || surface === 'email'
  const isZalo = platform === 'zalo'
  const isFriendRequest = data.kind === 'friendRequest'
  const displayName = isFriendRequest ? 'Trần Quốc Bảo' : 'Nguyễn Minh Anh'
  const displayInitials = getInitials(displayName)

  const selectedMedia = useMemo(() => {
    const media = (data.media || []).filter(item => item.path)
    if (data.mediaMode === 'none') return []
    if (data.mediaMode === 'random') {
      const count = Math.max(1, data.randomCount || 1)
      return media.slice(0, count)
    }
    return media
  }, [data.media, data.mediaMode, data.randomCount])

  useEffect(() => {
    let disposed = false
    const initialItems: PreviewMediaState[] = selectedMedia.map((item, index) => {
      const label = item.label || getFileName(item.path, `Media ${index + 1}`)
      const remoteImage = isRemoteUrl(item.path) && (isLikelyImagePath(item.path) || isImageMime(item.mimeType))
      if (item.path.startsWith('data:image/')) {
        return {
          key: mediaKey(item, index),
          path: item.path,
          label,
          dataUrl: item.path,
          status: 'ready',
          message: getDataImageMimeType(item.path)
        }
      }
      if (remoteImage) {
        return {
          key: mediaKey(item, index),
          path: item.path,
          label,
          dataUrl: item.path,
          status: 'ready'
        }
      }
      if (!isLikelyImagePath(item.path)) {
        return {
          key: mediaKey(item, index),
          path: item.path,
          label,
          status: 'file'
        }
      }
      return {
        key: mediaKey(item, index),
        path: item.path,
        label,
        status: 'loading'
      }
    })
    setMediaItems(initialItems)

    initialItems.forEach((item, index) => {
      if (item.status !== 'loading') return
      window.electronAPI.readCampaignPreviewFileDataUrl(item.path)
        .then(result => {
          if (disposed) return
          setMediaItems(current => current.map((media, mediaIndex) => mediaIndex === index
            ? {
              ...media,
              path: result.filePath,
              dataUrl: result.dataUrl,
              status: 'ready'
            }
            : media
          ))
        })
        .catch(err => {
          if (disposed) return
          const message = err instanceof Error ? err.message : 'Không thể tải ảnh xem trước.'
          setMediaItems(current => current.map((media, mediaIndex) => mediaIndex === index
            ? { ...media, status: 'error', message }
            : media
          ))
        })
    })

    return () => {
      disposed = true
    }
  }, [selectedMedia])

  const renderMediaTile = (item: PreviewMediaState) => {
    const isImageReady = item.status === 'ready' && item.dataUrl
    return (
      <div key={item.key} className={`content-preview-media-tile ${item.status}`}>
        {isImageReady ? (
          <img src={item.dataUrl} alt={item.label} />
        ) : (
          <div className="content-preview-file-chip">
            {item.status === 'file' ? <FileText size={18} /> : <Image size={18} />}
            <span>{item.status === 'loading' ? 'Đang tải...' : item.label}</span>
            {item.status === 'error' && <small>{item.message || 'Không thể tải ảnh'}</small>}
          </div>
        )}
      </div>
    )
  }

  const renderMediaGrid = (variant: 'feed' | 'bubble' | 'email' = 'feed') => {
    if (mediaItems.length === 0) return null
    const countClass = `count-${Math.min(mediaItems.length, 4)}`
    return (
      <div className={`content-preview-media-grid ${variant} ${countClass}`}>
        {mediaItems.map(renderMediaTile)}
      </div>
    )
  }

  const renderVariantPicker = () => {
    if (variants.length <= 1) return null

    return (
      <div className="content-preview-variant-tabs" aria-label="Chọn biến thể nội dung xem trước">
        {variants.map((_, index) => (
          <button
            key={index}
            type="button"
            className={selectedVariantIndex === index ? 'active' : ''}
            onClick={() => setSelectedVariantIndex(index)}
          >
            Nội dung {index + 1}
          </button>
        ))}
      </div>
    )
  }

  const renderPhoneFrame = (children: ReactNode) => (
    <div className={`content-preview-phone ${platform} ${surface}`}>
      <div className="content-preview-phone-speaker" />
      {children}
    </div>
  )

  const renderFacebookTopbar = (label: string) => (
    <div className="content-preview-platform-bar facebook">
      <strong>Facebook</strong>
      <span>{label}</span>
    </div>
  )

  const renderZaloTopbar = () => (
    <div className="content-preview-platform-bar zalo">
      <div className="content-preview-zalo-avatar">{displayInitials}</div>
      <div>
        <strong>{displayName}</strong>
        <span>Đang hoạt động</span>
      </div>
    </div>
  )

  const renderPostPreview = () => renderPhoneFrame(
    <>
      {renderFacebookTopbar('Bảng tin')}
      <div className="content-preview-feed-screen">
        <article className="content-preview-fb-post">
          <div className="content-preview-fb-post-head">
            <div className="content-preview-avatar facebook">{displayInitials}</div>
            <div>
              <strong>{displayName}</strong>
              <span>Vừa xong</span>
            </div>
          </div>
          <div className="content-preview-fb-text">{renderedContent || 'Chưa có nội dung để xem trước.'}</div>
          {renderMediaGrid('feed')}
          <div className="content-preview-fb-actions">
            <span><ThumbsUp size={14} /> Thích</span>
            <span><MessageCircle size={14} /> Bình luận</span>
            <span><Share2 size={14} /> Chia sẻ</span>
          </div>
        </article>
      </div>
    </>
  )

  const renderCommentPreview = () => renderPhoneFrame(
    <>
      {renderFacebookTopbar(surface === 'story' ? 'Up tin' : 'Bình luận')}
      <div className="content-preview-feed-screen">
        <article className="content-preview-fb-post compact">
          <div className="content-preview-fb-post-head">
            <div className="content-preview-avatar facebook">BA</div>
            <div>
              <strong>Bài viết mẫu</strong>
              <span>Vừa xong</span>
            </div>
          </div>
          <div className="content-preview-fb-text muted">Nội dung bài viết sẽ xuất hiện phía trên comment.</div>
          <div className="content-preview-comment-preview">
            <div className="content-preview-avatar facebook small">{displayInitials}</div>
            <div className="content-preview-comment-bubble">
              <strong>{displayName}</strong>
              <p>{renderedContent || 'Chưa có nội dung comment để xem trước.'}</p>
              {renderMediaGrid('bubble')}
            </div>
          </div>
        </article>
      </div>
    </>
  )

  const renderStoryPreview = () => renderPhoneFrame(
    <>
      {renderFacebookTopbar('Tin')}
      <div className="content-preview-story-screen">
        <div className="content-preview-story-card">
          <div className="content-preview-fb-post-head story">
            <div className="content-preview-avatar facebook">{displayInitials}</div>
            <div>
              <strong>{displayName}</strong>
              <span>Vừa xong</span>
            </div>
          </div>
          <div className="content-preview-story-text">{renderedContent || 'Chưa có nội dung để xem trước.'}</div>
          {renderMediaGrid('bubble')}
        </div>
      </div>
    </>
  )

  const renderChatPreview = () => renderPhoneFrame(
    <>
      {isZalo ? renderZaloTopbar() : (
        <div className="content-preview-platform-bar messenger">
          <div className="content-preview-avatar messenger">{displayInitials}</div>
          <div>
            <strong>{displayName}</strong>
            <span>Đang hoạt động</span>
          </div>
        </div>
      )}
      <div className={`content-preview-chat-screen ${isZalo ? 'zalo' : 'messenger'}`}>
        <div className="content-preview-chat-day">Hôm nay</div>
        {isFriendRequest && (
          <div className="content-preview-chat-system">Lời mời kết bạn</div>
        )}
        <div className="content-preview-outgoing-row">
          <div className="content-preview-chat-bubble outgoing">
            <div>{renderedContent || (isFriendRequest ? 'Không nhập lời nhắn kết bạn.' : 'Chưa có nội dung tin nhắn để xem trước.')}</div>
            {renderMediaGrid('bubble')}
          </div>
        </div>
      </div>
      <div className={`content-preview-chat-composer ${isZalo ? 'zalo' : 'messenger'}`}>
        <Paperclip size={15} />
        <span>Nhập tin nhắn...</span>
        <Send size={15} />
      </div>
    </>
  )

  const renderEmailPreview = () => (
    <div className="content-preview-email-client">
      <div className="content-preview-email-toolbar">
        <Mail size={18} />
        <div>
          <span>Email</span>
          <strong>{renderedSubject || 'Chưa có tiêu đề email'}</strong>
        </div>
      </div>
      <div className="content-preview-email-meta">
        <div><span>Từ</span><strong>akaAgent</strong></div>
        <div><span>Đến</span><strong>{SAMPLE_TOKEN_VALUES.EMAIL}</strong></div>
      </div>
      <div className="content-preview-email-body">
        {data.isHtml ? (
          <iframe
            title="Xem trước Email HTML"
            sandbox=""
            srcDoc={renderPreviewSampleTokens(selectedVariant) || '<p>Chưa có nội dung HTML để xem trước.</p>'}
          />
        ) : (
          <div className="content-preview-email-text">{renderedContent || 'Chưa có nội dung email để xem trước.'}</div>
        )}
      </div>
      {renderMediaGrid('email')}
    </div>
  )

  const renderAnswerPreview = () => renderPhoneFrame(
    <>
      {renderFacebookTopbar('Tham gia group')}
      <div className="content-preview-feed-screen">
        <article className="content-preview-fb-post">
          <div className="content-preview-answer-label">Câu hỏi của quản trị viên</div>
          <div className="content-preview-answer-question">Bạn muốn tham gia nhóm vì lý do gì?</div>
          <div className="content-preview-answer-box">
            {renderedContent || 'Có thể để trống nếu group không hỏi.'}
          </div>
        </article>
      </div>
    </>
  )

  const renderPreviewBody = () => {
    if (isEmail) return renderEmailPreview()
    if (surface === 'chat') return renderChatPreview()
    if (surface === 'comment') return renderCommentPreview()
    if (surface === 'story') return renderStoryPreview()
    if (surface === 'answer') return renderAnswerPreview()
    return renderPostPreview()
  }

  const notes = [
    ...(data.notes || []),
    ...(data.mediaMode === 'random' && selectedMedia.length > 0 ? [`Xem trước đang lấy ${selectedMedia.length} file đầu tiên; khi chạy thật hệ thống sẽ chọn ngẫu nhiên.`] : [])
  ]

  return (
    <div className="modal-overlay campaign-picker-modal-overlay content-preview-overlay" style={{ zIndex: 3300 }}>
      <div className="content-preview-modal">
        <div className="modal-header">
          <div>
            <span className="modal-title">{data.title}</span>
            {data.subtitle && <div className="content-preview-subtitle">{data.subtitle}</div>}
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Đóng xem trước nội dung">
            <X size={20} />
          </button>
        </div>
        <div className="content-preview-body">
          {renderVariantPicker()}
          {notes.length > 0 && (
            <div className="content-preview-notes">
              {notes.map((note, index) => <span key={index}>{note}</span>)}
            </div>
          )}
          <div className={`content-preview-showcase ${isEmail ? 'email' : 'phone'}`}>
            {renderPreviewBody()}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  )
}
