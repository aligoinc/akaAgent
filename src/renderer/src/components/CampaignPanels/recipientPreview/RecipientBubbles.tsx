import { useEffect, useState } from 'react'
import { FileText, ImageOff, Play } from 'lucide-react'
import type { RecipientBubble, RecipientPreviewMedia, RecipientTextPart } from '../../../../../shared/recipientPreview'

const formatSize = (bytes: number | null) => {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`
}

const TOKEN_TITLES: Record<string, string> = {
  runtime: 'Điền lúc gửi',
  empty: 'Trống trong data: khách thấy chỗ trống',
  unknown: 'Biến không hợp lệ: khách thấy nguyên chữ',
  unrendered: 'Gửi dạng chia sẻ không điền biến',
  raw: 'Biến sẽ được điền khi gửi',
}

export function RecipientTextParts({ parts }: { parts: RecipientTextPart[] }) {
  return <>{parts.map((part, index) => {
    if (part.kind === 'disclosure') return <span key={index} className="rp-disclosure">{part.text}</span>
    if (part.kind === 'cut') return <span key={index} className="rp-cut" title="Bị cắt sau 150 ký tự, khách không thấy">{part.text}</span>
    if (part.kind === 'link') return <span key={index} className="rp-token is-link">{part.text}</span>
    if (part.kind === 'text' || !part.state) return <span key={index}>{part.text}</span>
    if (part.state === 'filled') return <span key={index} className="rp-token is-filled" title={part.label ? `${part.label} (${part.token})` : part.token}>{part.text}</span>
    const title = `${TOKEN_TITLES[part.state] || ''}${part.label && part.label !== part.text ? ` · ${part.label}` : ''}`
    return <span key={index} className={`rp-token is-${part.state}`} title={title}>{part.state === 'empty' ? '(trống)' : part.text}</span>
  })}</>
}

/**
 * Ảnh trên máy đọc qua IPC sẵn có (`readCampaignPreviewFileDataUrl`: chỉ ảnh, tối đa 8 MB), như các bản xem
 * trước khác của form. Không mạng, không DB. Một ảnh thường lặp ở nhiều thẻ "Xem tất cả" nên giữ một bộ đệm
 * nhỏ theo đường dẫn; quá giới hạn thì bỏ mục cũ nhất.
 */
const LOCAL_IMAGE_CACHE_LIMIT = 24
type LocalImageResult = { src: string; error: null } | { src: null; error: string }
const localImageCache = new Map<string, Promise<LocalImageResult>>()

const isRemotePath = (path: string) => /^(https?:|data:)/i.test(path)

function loadLocalImage(path: string): Promise<LocalImageResult> {
  const cached = localImageCache.get(path)
  if (cached) return cached
  const pending = window.electronAPI.readCampaignPreviewFileDataUrl(path)
    .then((result): LocalImageResult => ({ src: result.dataUrl, error: null }))
    .catch((error: unknown): LocalImageResult => {
      // File đổi/xoá sau này vẫn đọc lại được ở lần mở sau.
      localImageCache.delete(path)
      const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '')
        .replace(/^Error invoking remote method '[^']+':\s*/i, '')
        .replace(/^Error:\s*/i, '')
        .trim()
      return { src: null, error: message || 'Không đọc được ảnh trên máy.' }
    })
  localImageCache.set(path, pending)
  if (localImageCache.size > LOCAL_IMAGE_CACHE_LIMIT) {
    const oldest = localImageCache.keys().next().value
    if (oldest !== undefined) localImageCache.delete(oldest)
  }
  return pending
}

type LocalImageState = { status: 'idle' | 'loading' | 'ready' | 'failed'; src: string | null; error: string | null }

function useLocalImage(path: string | null): LocalImageState {
  const [state, setState] = useState<LocalImageState>({ status: path ? 'loading' : 'idle', src: null, error: null })
  useEffect(() => {
    if (!path) { setState({ status: 'idle', src: null, error: null }); return }
    let disposed = false
    setState({ status: 'loading', src: null, error: null })
    void loadLocalImage(path).then((result) => {
      if (disposed) return
      setState(result.src ? { status: 'ready', src: result.src, error: null } : { status: 'failed', src: null, error: result.error })
    })
    return () => { disposed = true }
  }, [path])
  return state
}

function MediaTile({ media, compact }: { media: RecipientPreviewMedia; compact?: boolean }) {
  const localImagePath = media.kind === 'image' && media.localPath && !isRemotePath(media.localPath) ? media.localPath : null
  const local = useLocalImage(localImagePath)
  if (media.kind === 'image') {
    // File trên máy trước (như bản xem trước cũ của form), thiếu file thì dùng bản cloud nếu có.
    const src = local.src || (local.status === 'loading' ? null : media.url)
    if (src) return <span className="rp-media-tile"><img src={src} alt={media.name} loading="lazy" decoding="async" /></span>
    if (local.status === 'loading') return <span className="rp-media-tile is-loading" aria-label={`Đang tải ${media.name}`} />
    return <span className="rp-media-tile is-local" title={`${media.name}: ${local.error || 'chưa có bản xem trước'}`}>
      <ImageOff size={compact ? 14 : 18} aria-hidden="true" />
      <small>{compact ? 'Không xem được' : local.error || 'Chưa xem trước được ảnh này'}</small>
    </span>
  }
  if (media.kind === 'video' && media.url) {
    return <span className="rp-media-tile is-video">
      <video src={media.url} muted playsInline preload="metadata" aria-label={media.name} />
      <span className="rp-media-play" aria-hidden="true"><Play size={compact ? 12 : 16} /></span>
    </span>
  }
  if (media.kind === 'video') {
    return <span className="rp-media-tile is-local-video" title={media.name}>
      <span className="rp-media-play" aria-hidden="true"><Play size={compact ? 12 : 16} /></span>
      <small>{media.name}</small>
    </span>
  }
  return <span className="rp-media-file" title={media.name}>
    <FileText size={compact ? 14 : 18} aria-hidden="true" />
    <span><strong>{media.name}</strong>{formatSize(media.sizeBytes) && <small>{formatSize(media.sizeBytes)}</small>}</span>
  </span>
}

function MediaGroup({ media, compact }: { media: RecipientPreviewMedia[]; compact?: boolean }) {
  const visual = media.filter((item) => item.kind !== 'file')
  const files = media.filter((item) => item.kind === 'file')
  const shown = visual.slice(0, 4)
  const hidden = visual.length - shown.length
  return <>
    {shown.length > 0 && <span className={`rp-album count-${shown.length}`}>
      {shown.map((item, index) => <span className="rp-album-cell" key={item.key}>
        <MediaTile media={item} compact={compact} />
        {index === shown.length - 1 && hidden > 0 && <span className="rp-album-more">+{hidden}</span>}
      </span>)}
    </span>}
    {files.map((item) => <MediaTile key={item.key} media={item} compact={compact} />)}
  </>
}

export function RecipientBubbleView({ bubble, compact }: { bubble: RecipientBubble; compact?: boolean }) {
  if (bubble.kind === 'rich') {
    // HTML đã qua sanitize và chiếu về tập style Zalo hỗ trợ; nhãn biến được thêm sau khi escape.
    return <div className="rp-bubble rp-rich" dangerouslySetInnerHTML={{ __html: bubble.html }} />
  }
  if (bubble.kind === 'text') return <div className="rp-bubble"><RecipientTextParts parts={bubble.parts} /></div>
  return <div className={`rp-bubble is-media${bubble.caption ? ' has-caption' : ''}`}>
    <MediaGroup media={bubble.media} compact={compact} />
    {bubble.caption && (bubble.caption.kind === 'rich'
      ? <div className="rp-caption rp-rich" dangerouslySetInnerHTML={{ __html: bubble.caption.html }} />
      : bubble.caption.kind === 'text' ? <div className="rp-caption"><RecipientTextParts parts={bubble.caption.parts} /></div> : null)}
  </div>
}

export const recipientMediaSummary = (media: RecipientPreviewMedia[]): string => {
  const images = media.filter((item) => item.kind === 'image').length
  const videos = media.filter((item) => item.kind === 'video').length
  const files = media.length - images - videos
  return [images && `${images} ảnh`, videos && `${videos} video`, files && `${files} file`].filter(Boolean).join(', ')
}
