import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Eye, FileText, Image } from 'lucide-react'

interface MediaPreviewHoverProps {
  name: string
  path?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
}

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'file' | 'error'
type PreviewPlacement = 'top' | 'bottom'

interface PreviewPosition {
  left: number
  top: number
  placement: PreviewPlacement
}

const IMAGE_EXTENSION_RE = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i
const POPOVER_WIDTH_FALLBACK = 308
const POPOVER_HEIGHT_FALLBACK = 260
const POPOVER_GAP = 8
const VIEWPORT_PADDING = 12

const isImageMime = (mimeType?: string | null): boolean =>
  String(mimeType || '').toLowerCase().startsWith('image/')

const isRemoteUrl = (path: string): boolean => /^https?:\/\//i.test(path)

const isDataImage = (path: string): boolean => /^data:image\//i.test(path)

const isPreviewableImage = (path: string, mimeType?: string | null): boolean =>
  isImageMime(mimeType) || isDataImage(path) || IMAGE_EXTENSION_RE.test(path)

const formatBytes = (value?: number | null): string => {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

const getPopoverPosition = (anchor: DOMRect, popoverWidth: number, popoverHeight: number): PreviewPosition => {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = popoverWidth || POPOVER_WIDTH_FALLBACK
  const height = popoverHeight || POPOVER_HEIGHT_FALLBACK
  const spaceBelow = viewportHeight - anchor.bottom - POPOVER_GAP - VIEWPORT_PADDING
  const spaceAbove = anchor.top - POPOVER_GAP - VIEWPORT_PADDING
  const placement: PreviewPlacement = spaceBelow >= height || spaceBelow >= spaceAbove ? 'bottom' : 'top'
  const rawTop = placement === 'bottom'
    ? anchor.bottom + POPOVER_GAP
    : anchor.top - POPOVER_GAP - height

  return {
    left: clamp(anchor.left, VIEWPORT_PADDING, viewportWidth - VIEWPORT_PADDING - width),
    top: clamp(rawTop, VIEWPORT_PADDING, viewportHeight - VIEWPORT_PADDING - height),
    placement
  }
}

export default function MediaPreviewHover({ name, path, mimeType, sizeBytes }: MediaPreviewHoverProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [position, setPosition] = useState<PreviewPosition | null>(null)
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [previewSrc, setPreviewSrc] = useState('')
  const [message, setMessage] = useState('')

  const cleanPath = String(path || '').trim()
  const canPreviewImage = Boolean(cleanPath && isPreviewableImage(cleanPath, mimeType))

  useEffect(() => {
    setStatus('idle')
    setPreviewSrc('')
    setMessage('')
  }, [cleanPath, mimeType])

  const ensurePreview = async () => {
    if (!cleanPath || !canPreviewImage) {
      setStatus('file')
      return
    }

    if (status === 'ready' || status === 'loading') return
    if (isDataImage(cleanPath) || isRemoteUrl(cleanPath)) {
      setPreviewSrc(cleanPath)
      setStatus('ready')
      return
    }

    setStatus('loading')
    try {
      const result = await window.electronAPI.readCampaignPreviewFileDataUrl(cleanPath)
      setPreviewSrc(result.dataUrl)
      setStatus('ready')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không thể tải preview.')
      setStatus('error')
    }
  }

  const updatePopoverPosition = useCallback(() => {
    if (!open || !anchor || !popoverRef.current) return
    const rect = popoverRef.current.getBoundingClientRect()
    const next = getPopoverPosition(anchor, rect.width, rect.height)
    setPosition(prev => (
      prev && prev.left === next.left && prev.top === next.top && prev.placement === next.placement
        ? prev
        : next
    ))
  }, [anchor, open])

  useLayoutEffect(() => {
    updatePopoverPosition()
  }, [updatePopoverPosition, status, previewSrc, message, name, mimeType, sizeBytes, canPreviewImage])

  useEffect(() => {
    if (!open) return undefined

    const refreshAnchor = () => {
      if (!buttonRef.current) return
      setAnchor(buttonRef.current.getBoundingClientRect())
    }

    window.addEventListener('resize', refreshAnchor)
    window.addEventListener('scroll', refreshAnchor, true)
    return () => {
      window.removeEventListener('resize', refreshAnchor)
      window.removeEventListener('scroll', refreshAnchor, true)
    }
  }, [open])

  const openPreview = (event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) => {
    setAnchor(event.currentTarget.getBoundingClientRect())
    setPosition(null)
    setOpen(true)
    void ensurePreview()
  }

  const closePreview = () => {
    setOpen(false)
    setPosition(null)
  }

  const popover = open && anchor ? createPortal(
    <div
      ref={popoverRef}
      className="media-hover-preview-popover"
      data-placement={position?.placement || 'bottom'}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden'
      }}
    >
      <div className="media-hover-preview-title" title={name}>{name}</div>
      {status === 'ready' && previewSrc ? (
        <img
          src={previewSrc}
          alt={name}
          onLoad={updatePopoverPosition}
          onError={() => {
            setPreviewSrc('')
            setMessage('Không thể tải preview.')
            setStatus('error')
          }}
        />
      ) : (
        <div className="media-hover-preview-file">
          {canPreviewImage && status !== 'file' ? <Image size={22} /> : <FileText size={22} />}
          <span>
            {status === 'loading'
              ? 'Đang tải preview...'
              : status === 'error'
                ? message || 'Không thể tải preview.'
                : 'File không có preview ảnh.'}
          </span>
          {(mimeType || sizeBytes) && (
            <small>{[mimeType || '', formatBytes(sizeBytes)].filter(Boolean).join(' • ')}</small>
          )}
        </div>
      )}
    </div>,
    document.body
  ) : null

  return (
    <span className="media-hover-preview">
      <button
        ref={buttonRef}
        type="button"
        className="btn-icon media-hover-preview-button"
        title="Xem trước"
        onMouseEnter={openPreview}
        onMouseLeave={closePreview}
        onFocus={openPreview}
        onBlur={closePreview}
      >
        <Eye size={14} />
      </button>
      {popover}
    </span>
  )
}
