import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Bug,
  Image as ImageIcon,
  Lightbulb,
  MessageCircleQuestion,
  RefreshCw,
  Send,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import {
  CUSTOMER_FEEDBACK_MAX_IMAGES,
  CustomerFeedbackProduct,
  CustomerFeedbackReportType,
  MEDIA_IMAGE_MAX_SIZE_BYTES
} from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'

type FeedbackFormKind = 'support_rating' | 'report_feature'

interface FeedbackImageDraft {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  previewUrl: string
  localPath?: string
  dataUrl?: string
}

const IMAGE_FILE_EXTENSION_RE = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i
const REPORT_TYPE_OPTIONS: CustomerFeedbackReportType[] = ['báo lỗi', 'đề xuất tính năng']
const PRODUCT_OPTIONS: CustomerFeedbackProduct[] = ['sms', 'zalo', 'facebook', 'email', 'khác']
const LAUNCHER_SIZE = 36
const LAUNCHER_MARGIN = 12
interface LauncherPosition { x: number; y: number }

function launcherTopMargin(): number {
  return (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-height')) || 36) + LAUNCHER_MARGIN
}

function clampLauncherPosition(position: LauncherPosition): LauncherPosition {
  const maxX = Math.max(LAUNCHER_MARGIN, window.innerWidth - LAUNCHER_SIZE - LAUNCHER_MARGIN)
  const maxY = Math.max(LAUNCHER_MARGIN, window.innerHeight - LAUNCHER_SIZE - LAUNCHER_MARGIN)
  return {
    x: Math.min(maxX, Math.max(LAUNCHER_MARGIN, position.x)),
    y: Math.min(maxY, Math.max(Math.min(launcherTopMargin(), maxY), position.y))
  }
}

function defaultLauncherPosition(): LauncherPosition {
  const inset = window.innerWidth <= 640 ? 14 : 22
  return clampLauncherPosition({ x: window.innerWidth - LAUNCHER_SIZE - inset, y: window.innerHeight - LAUNCHER_SIZE - inset })
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function getImageInputError(file: File): string | null {
  const isImage = file.type.startsWith('image/') || IMAGE_FILE_EXTENSION_RE.test(file.name)
  if (!isImage) return `${file.name || 'File'} không phải ảnh.`
  if (file.size > MEDIA_IMAGE_MAX_SIZE_BYTES) {
    return `${file.name || 'Ảnh'} vượt quá dung lượng tối đa ${formatBytes(MEDIA_IMAGE_MAX_SIZE_BYTES)}.`
  }
  return null
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(String(event.target?.result || ''))
    reader.onerror = () => reject(new Error('Không thể đọc ảnh.'))
    reader.readAsDataURL(file)
  })
}

function createImageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function CustomerFeedbackLauncher() {
  const showAlert = useUiStore(s => s.showAlert)
  const launcherRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: LauncherPosition; moved: boolean } | null>(null)
  const hasMovedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const closeMenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [position, setPosition] = useState(defaultLauncherPosition)
  const [dragging, setDragging] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const [activeForm, setActiveForm] = useState<FeedbackFormKind | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [supportContent, setSupportContent] = useState('')
  const [supportRating, setSupportRating] = useState(5)
  const [reportType, setReportType] = useState<CustomerFeedbackReportType>('báo lỗi')
  const [reportProduct, setReportProduct] = useState<CustomerFeedbackProduct>('khác')
  const [reportContent, setReportContent] = useState('')
  const [reportDescription, setReportDescription] = useState('')
  const [images, setImages] = useState<FeedbackImageDraft[]>([])

  const modalTitle = activeForm === 'support_rating'
    ? 'Đánh giá hỗ trợ khách hàng'
    : 'Báo cáo/đề xuất tính năng'

  const submitDisabled = useMemo(() => {
    if (submitting) return true
    if (activeForm === 'support_rating') return supportContent.trim().length === 0
    if (activeForm === 'report_feature') return reportContent.trim().length === 0
    return true
  }, [activeForm, reportContent, submitting, supportContent])

  const clearCloseMenuTimer = useCallback(() => {
    if (!closeMenuTimer.current) return
    clearTimeout(closeMenuTimer.current)
    closeMenuTimer.current = null
  }, [])

  const openMenu = useCallback(() => {
    if (dragRef.current?.moved || suppressClickRef.current) return
    clearCloseMenuTimer()
    setMenuOpen(true)
  }, [clearCloseMenuTimer])

  const scheduleCloseMenu = useCallback(() => {
    clearCloseMenuTimer()
    closeMenuTimer.current = setTimeout(() => {
      setMenuOpen(false)
      closeMenuTimer.current = null
    }, 160)
  }, [clearCloseMenuTimer])

  useEffect(() => {
    return () => clearCloseMenuTimer()
  }, [clearCloseMenuTimer])

  useEffect(() => {
    const resize = () => setPosition(current => hasMovedRef.current ? clampLauncherPosition(current) : defaultLauncherPosition())
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useLayoutEffect(() => {
    if (!menuOpen || activeForm || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const preferredTop = position.y - rect.height - 10 >= launcherTopMargin()
      ? position.y - rect.height - 10 : position.y + LAUNCHER_SIZE + 10
    setMenuPosition({
      left: Math.max(LAUNCHER_MARGIN, Math.min(position.x + LAUNCHER_SIZE - rect.width, window.innerWidth - rect.width - LAUNCHER_MARGIN)) - position.x,
      top: Math.max(launcherTopMargin(), Math.min(preferredTop, window.innerHeight - rect.height - LAUNCHER_MARGIN)) - position.y
    })
  }, [menuOpen, activeForm, position])

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    event.preventDefault()
    suppressClickRef.current = false
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      origin: position, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    drag.moved = true
    hasMovedRef.current = true
    suppressClickRef.current = true
    clearCloseMenuTimer()
    setMenuOpen(false)
    setDragging(true)
    setPosition(clampLauncherPosition({ x: drag.origin.x + dx, y: drag.origin.y + dy }))
  }

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag.moved && event.type === 'pointerup') event.currentTarget.focus({ preventScroll: true })
  }

  const resetForm = useCallback((kind?: FeedbackFormKind) => {
    if (!kind || kind === 'support_rating') {
      setSupportContent('')
      setSupportRating(5)
    }
    if (!kind || kind === 'report_feature') {
      setReportType('báo lỗi')
      setReportProduct('khác')
      setReportContent('')
      setReportDescription('')
    }
    setImages([])
  }, [])

  const openForm = useCallback((kind: FeedbackFormKind) => {
    resetForm(kind)
    setActiveForm(kind)
    setMenuOpen(false)
  }, [resetForm])

  const closeForm = useCallback(() => {
    if (submitting) return
    setActiveForm(null)
    resetForm()
  }, [resetForm, submitting])

  useEffect(() => {
    if (!menuOpen) return

    const handleMouseDown = (event: MouseEvent) => {
      if (!launcherRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [menuOpen])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (activeForm) {
        closeForm()
      } else {
        setMenuOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeForm, closeForm])

  const addImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const availableSlots = CUSTOMER_FEEDBACK_MAX_IMAGES - images.length
    if (availableSlots <= 0) {
      showAlert(`Chỉ được gửi tối đa ${CUSTOMER_FEEDBACK_MAX_IMAGES} ảnh mỗi lần.`, 'error')
      return
    }

    const nextImages: FeedbackImageDraft[] = []
    const errors: string[] = files.length > availableSlots
      ? [`Chỉ thêm được ${availableSlots} ảnh nữa; tối đa ${CUSTOMER_FEEDBACK_MAX_IMAGES} ảnh mỗi lần.`]
      : []

    for (const file of files.slice(0, availableSlots)) {
      const error = getImageInputError(file)
      if (error) {
        errors.push(error)
        continue
      }

      try {
        const dataUrl = await readFileAsDataUrl(file)
        let localPath = ''
        try {
          localPath = window.electronAPI.getPathForFile(file)
        } catch {
          localPath = ''
        }

        nextImages.push({
          id: createImageId(),
          name: file.name || `pasted-image-${Date.now()}.png`,
          mimeType: file.type || 'image/png',
          sizeBytes: file.size,
          previewUrl: dataUrl,
          localPath: localPath || undefined,
          dataUrl: localPath ? undefined : dataUrl
        })
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Không thể đọc ảnh ${file.name || ''}.`)
      }
    }

    if (nextImages.length > 0) {
      setImages(current => [...current, ...nextImages])
    }
    if (errors.length > 0) {
      const suffix = errors.length > 3 ? `\n...và ${errors.length - 3} ảnh khác` : ''
      showAlert(`${errors.slice(0, 3).join('\n')}${suffix}`, 'error')
    }
  }, [images.length, showAlert])

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    void addImageFiles(files)
  }, [addImageFiles])

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.clipboardData?.items || [])
    const files = items
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((file): file is File => !!file)

    if (files.length === 0) return
    event.preventDefault()
    void addImageFiles(files)
  }, [addImageFiles])

  const removeImage = useCallback((id: string) => {
    setImages(current => current.filter(image => image.id !== id))
  }, [])

  const handleSubmit = async () => {
    if (!activeForm || submitting) return

    const imageInputs = images.map(image => ({
      name: image.name,
      localPath: image.localPath || null,
      dataUrl: image.localPath ? null : image.dataUrl || null,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes
    }))

    setSubmitting(true)
    try {
      if (activeForm === 'support_rating') {
        await window.electronAPI.submitCustomerFeedback({
          kind: 'support_rating',
          content: supportContent.trim(),
          rating: supportRating,
          images: imageInputs
        })
      } else {
        await window.electronAPI.submitCustomerFeedback({
          kind: 'report_feature',
          type: reportType,
          product: reportProduct,
          content: reportContent.trim(),
          description: reportDescription.trim(),
          images: imageInputs
        })
      }

      showAlert('Đã gửi thông tin. Cảm ơn bạn!', 'success')
      setActiveForm(null)
      resetForm()
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể gửi thông tin.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const renderImages = () => (
    <div className="customer-feedback-image-list">
      {images.map(image => (
        <div key={image.id} className="customer-feedback-image-item">
          <img src={image.previewUrl} alt={image.name} />
          <div className="customer-feedback-image-meta">
            <span title={image.name}>{image.name}</span>
            <small>{formatBytes(image.sizeBytes)}</small>
          </div>
          <button
            type="button"
            className="btn-icon customer-feedback-image-remove"
            onClick={() => removeImage(image.id)}
            disabled={submitting}
            title="Xoá ảnh"
            aria-label={`Xoá ảnh ${image.name}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )

  const renderSupportForm = () => (
    <>
      <div className="stepper-form-group">
        <label>Rating <span className="required">*</span></label>
        <div className="customer-feedback-rating" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map(value => (
            <button
              key={value}
              type="button"
              className={value <= supportRating ? 'active' : ''}
              onClick={() => setSupportRating(value)}
              disabled={submitting}
              role="radio"
              aria-checked={supportRating === value}
              title={`${value} sao`}
            >
              <Star size={20} fill="currentColor" />
            </button>
          ))}
        </div>
      </div>

      <div className="stepper-form-group">
        <label>Nội dung đánh giá <span className="required">*</span></label>
        <textarea
          className="stepper-textarea customer-feedback-textarea"
          value={supportContent}
          onChange={event => setSupportContent(event.target.value)}
          disabled={submitting}
          rows={5}
        />
      </div>
    </>
  )

  const renderReportForm = () => (
    <>
      <div className="stepper-form-group">
        <label>Loại <span className="required">*</span></label>
        <div className="customer-feedback-segmented" role="radiogroup" aria-label="Loại">
          {REPORT_TYPE_OPTIONS.map(type => (
            <button
              key={type}
              type="button"
              className={reportType === type ? 'active' : ''}
              onClick={() => setReportType(type)}
              disabled={submitting}
              role="radio"
              aria-checked={reportType === type}
            >
              {type === 'báo lỗi' ? <Bug size={15} /> : <Lightbulb size={15} />}
              <span>{type}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="stepper-form-group">
        <label>Sản phẩm <span className="required">*</span></label>
        <select
          className="stepper-input"
          value={reportProduct}
          onChange={event => setReportProduct(event.target.value as CustomerFeedbackProduct)}
          disabled={submitting}
        >
          {PRODUCT_OPTIONS.map(product => (
            <option key={product} value={product}>{product}</option>
          ))}
        </select>
      </div>

      <div className="stepper-form-group">
        <label>{reportType === 'báo lỗi' ? 'Nội dung báo cáo' : 'Đề xuất'} <span className="required">*</span></label>
        <textarea
          className="stepper-textarea customer-feedback-textarea"
          value={reportContent}
          onChange={event => setReportContent(event.target.value)}
          disabled={submitting}
          rows={5}
        />
      </div>

      <div className="stepper-form-group">
        <label>Mô tả thêm</label>
        <textarea
          className="stepper-textarea customer-feedback-textarea compact"
          value={reportDescription}
          onChange={event => setReportDescription(event.target.value)}
          disabled={submitting}
          rows={3}
        />
      </div>
    </>
  )

  return createPortal(
    <>
      <div
        ref={launcherRef}
        className={`customer-feedback-launcher${dragging ? ' is-dragging' : ''}`}
        style={{ left: position.x, top: position.y }}
        onMouseEnter={openMenu}
        onMouseLeave={() => {
          if (!dragRef.current) suppressClickRef.current = false
          scheduleCloseMenu()
        }}
      >
        {menuOpen && !activeForm && (
          <div ref={menuRef} className="customer-feedback-menu" role="menu" style={menuPosition}>
            <button type="button" onClick={() => openForm('support_rating')} role="menuitem">
              <Star size={16} />
              <span>Đánh giá hỗ trợ khách hàng</span>
            </button>
            <button type="button" onClick={() => openForm('report_feature')} role="menuitem">
              <Lightbulb size={16} />
              <span>Báo cáo/đề xuất tính năng</span>
            </button>
          </div>
        )}

        <button
          type="button"
          className="customer-feedback-button"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          onClick={event => {
            if (event.detail === 0) suppressClickRef.current = false
            if (!suppressClickRef.current) openMenu()
          }}
          onFocus={openMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Gửi đánh giá hoặc báo cáo"
          title="Kéo để di chuyển · Bấm để gửi đánh giá hoặc báo cáo"
        >
          <MessageCircleQuestion size={18} />
        </button>
      </div>

      {activeForm && (
        <div className="modal-overlay customer-feedback-overlay" onClick={closeForm}>
          <div className="modal customer-feedback-modal" onClick={event => event.stopPropagation()} onPaste={handlePaste}>
            <div className="modal-header">
              <span className="modal-title">{modalTitle}</span>
              <button type="button" className="btn-icon" onClick={closeForm} disabled={submitting} title="Đóng">
                <X size={18} />
              </button>
            </div>

            <div className="modal-body customer-feedback-body">
              {activeForm === 'support_rating' ? renderSupportForm() : renderReportForm()}

              <div className="stepper-form-group">
                <label>Ảnh</label>
                <div className="customer-feedback-image-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitting}
                  >
                    <Upload size={14} />
                    <span>Chọn ảnh</span>
                  </button>
                  <span className="customer-feedback-image-count">
                    <ImageIcon size={14} />
                    <span>{images.length}/{CUSTOMER_FEEDBACK_MAX_IMAGES}</span>
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                {images.length > 0 && renderImages()}
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={closeForm} disabled={submitting}>Huỷ</button>
              <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitDisabled}>
                {submitting ? <RefreshCw size={15} className="spin" /> : <Send size={15} />}
                <span>{submitting ? 'Đang gửi' : 'Gửi'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
