import { AlertTriangle, ImagePlus, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import {
  AI_CHAT_IMAGE_MAX_BYTES, AI_CHAT_IMAGE_TYPES, aiChatErrorCode, aiChatErrorMessage, validateAiChatImage, type AiChatImage
} from '../../../../shared/aiChat'
import { aiChatTransport } from './aiChatTransport'

/**
 * Ảnh đính kèm câu hỏi của Hỏi đáp AI (chép từ akaAgentWebApp `apps/web/src/features/aiChat/AiChatImages.tsx`, sửa ở WebApp trước).
 * Chọn ảnh là tải ngay lên (từng ảnh một): tiến trình chính cất ảnh vào kho media của hệ thống; câu hỏi chỉ mang URL của các
 * ảnh đã tải xong. Giao diện không gửi ảnh đi đâu khác và không tự đọc nội dung ảnh.
 */

export interface AiChatAttachment {
  id: string
  fileName: string
  /** URL tạm của trình duyệt để xem trước (thu hồi khi bỏ ảnh hoặc đóng form). */
  previewUrl: string
  status: 'uploading' | 'ready' | 'error'
  image: AiChatImage | null
  error: string | null
}

const RESIZE_MAX_EDGE = 2400

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read_failed'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Ảnh đúng định dạng và vừa dung lượng thì gửi nguyên tệp. Ảnh quá lớn hoặc định dạng khác (BMP, GIF, ảnh chụp điện thoại nặng)
 * được thu nhỏ và lưu lại thành JPG ngay trong app; không thu được thì báo lỗi của tệp gốc.
 */
async function prepareImage(file: File): Promise<{ blob: Blob; mimeType: string }> {
  const type = file.type.toLowerCase()
  const original = validateAiChatImage({ mimeType: type, sizeBytes: file.size })
  if (!original) return { blob: file, mimeType: type }
  const fail = () => Object.assign(new Error(original), { code: original })
  if (!type.startsWith('image/') || typeof createImageBitmap !== 'function') throw fail()
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw fail()
  }
  try {
    const scale = Math.min(1, RESIZE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw fail()
    // Nền trắng cho ảnh có vùng trong suốt (JPG không giữ được độ trong suốt).
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    if (!blob || blob.size > AI_CHAT_IMAGE_MAX_BYTES) throw fail()
    return { blob, mimeType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}

let nextAttachmentId = 1

/** Danh sách ảnh đang đính kèm một câu hỏi. `maxImages` = 0 thì không nhận ảnh (server chưa hỗ trợ). */
export function useAiChatAttachments(maxImages: number) {
  const [items, setItems] = useState<AiChatAttachment[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const aborts = useRef(new Map<string, AbortController>())

  const release = (item: AiChatAttachment) => {
    aborts.current.get(item.id)?.abort()
    aborts.current.delete(item.id)
    URL.revokeObjectURL(item.previewUrl)
  }
  // Đóng form: dừng các lượt tải còn dở và thu hồi ảnh xem trước.
  useEffect(() => () => { itemsRef.current.forEach(release) }, [])

  const add = useCallback((files: readonly File[]) => {
    if (maxImages <= 0 || !files.length) return
    const upload = aiChatTransport.uploadImage
    if (!upload) return
    const room = maxImages - itemsRef.current.length
    const accepted = files.slice(0, Math.max(0, room))
    setNotice(files.length > accepted.length ? `Mỗi câu hỏi đính kèm tối đa ${maxImages} ảnh.` : null)
    if (!accepted.length) return
    const created = accepted.map(file => ({
      file, item: { id: `anh-${nextAttachmentId++}`, fileName: file.name || 'Ảnh', previewUrl: URL.createObjectURL(file), status: 'uploading', image: null, error: null } as AiChatAttachment
    }))
    const next = [...itemsRef.current, ...created.map(entry => entry.item)]
    itemsRef.current = next
    setItems(next)
    for (const { file, item } of created) {
      const controller = new AbortController()
      aborts.current.set(item.id, controller)
      const patch = (change: Partial<AiChatAttachment>) => {
        if (controller.signal.aborted) return
        setItems(current => current.map(existing => existing.id === item.id ? { ...existing, ...change } : existing))
      }
      void (async () => {
        try {
          const prepared = await prepareImage(file)
          if (controller.signal.aborted) return
          const image = await upload({ mimeType: prepared.mimeType, dataBase64: await readBase64(prepared.blob) }, controller.signal)
          patch({ status: 'ready', image })
        } catch (failure) {
          const code = aiChatErrorCode(failure)
          patch({ status: 'error', error: code ? aiChatErrorMessage(code) : 'Không tải được ảnh lên. Kiểm tra mạng rồi chọn lại ảnh.' })
        } finally {
          aborts.current.delete(item.id)
        }
      })()
    }
  }, [maxImages])

  const remove = useCallback((id: string) => {
    const target = itemsRef.current.find(item => item.id === id)
    if (!target) return
    release(target)
    itemsRef.current = itemsRef.current.filter(item => item.id !== id)
    setItems(itemsRef.current)
    setNotice(null)
  }, [])

  const clear = useCallback(() => {
    itemsRef.current.forEach(release)
    itemsRef.current = []
    setItems([])
    setNotice(null)
  }, [])

  /** Dán ảnh từ bộ nhớ tạm (ảnh chụp màn hình) vào ô câu hỏi. */
  const onPaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
    if (maxImages <= 0) return
    const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'))
    // Chép chữ từ Excel, Word... thường kèm một bản ảnh của vùng chọn: có chữ thì để trình duyệt dán chữ như thường, không đính ảnh.
    if (!files.length || event.clipboardData?.getData('text/plain')) return
    event.preventDefault()
    add(files)
  }, [add, maxImages])

  return useMemo(() => ({
    items, notice, add, remove, clear, onPaste,
    enabled: maxImages > 0 && !!aiChatTransport.uploadImage,
    canAdd: items.length < maxImages,
    uploading: items.some(item => item.status === 'uploading'),
    failed: items.some(item => item.status === 'error'),
    /** URL các ảnh đã tải xong, đúng thứ tự người dùng chọn. */
    urls: items.filter(item => item.status === 'ready' && item.image).map(item => (item.image as AiChatImage).url)
  }), [items, notice, add, remove, clear, onPaste, maxImages])
}

export type AiChatAttachments = ReturnType<typeof useAiChatAttachments>

/** Nút chọn ảnh (kèm ô chọn tệp ẩn). */
export function AiChatImageButton({ attachments, disabled, compact, maxImages }: { attachments: AiChatAttachments; disabled?: boolean; compact?: boolean; maxImages: number }) {
  const input = useRef<HTMLInputElement>(null)
  if (!attachments.enabled) return null
  const full = !attachments.canAdd
  const title = full ? `Đã đủ ${maxImages} ảnh` : `Đính kèm ảnh (tối đa ${maxImages} ảnh, mỗi ảnh 5 MB)`
  return <>
    <input ref={input} type="file" hidden multiple accept={[...AI_CHAT_IMAGE_TYPES, 'image/*'].join(',')} aria-label="Chọn ảnh đính kèm"
      onChange={event => { attachments.add(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <button type="button" className={compact ? 'ai-chat-attach-button compact' : 'ai-chat-attach-button'} disabled={disabled || full} title={title}
      aria-label="Đính kèm ảnh" onClick={() => input.current?.click()}>
      <ImagePlus size={compact ? 16 : 14} />{!compact && <span>Đính kèm ảnh</span>}
    </button>
  </>
}

/** Các ảnh đang đính kèm: xem trước, trạng thái tải lên, nút bỏ. */
export function AiChatAttachmentList({ attachments, disabled }: { attachments: AiChatAttachments; disabled?: boolean }) {
  if (!attachments.items.length && !attachments.notice) return null
  return <div className="ai-chat-attachments">
    {attachments.items.length > 0 && <ul aria-label="Ảnh đính kèm">
      {attachments.items.map(item => <li key={item.id} className={`ai-chat-attachment ${item.status}`} title={item.error ?? item.fileName}>
        <img src={item.previewUrl} alt={item.fileName} />
        {item.status === 'uploading' && <span className="ai-chat-attachment-state" role="status" aria-label="Đang tải ảnh lên"><Loader2 size={14} className="spin" /></span>}
        {item.status === 'error' && <span className="ai-chat-attachment-state error" aria-hidden="true"><AlertTriangle size={14} /></span>}
        <button type="button" disabled={disabled} aria-label={`Bỏ ảnh ${item.fileName}`} title="Bỏ ảnh này" onClick={() => attachments.remove(item.id)}><X size={11} /></button>
      </li>)}
    </ul>}
    {attachments.items.filter(item => item.status === 'error').slice(0, 1).map(item =>
      <p key={item.id} className="ai-chat-attachment-note error" role="alert">{item.error} Bỏ ảnh lỗi rồi chọn lại.</p>)}
    {attachments.notice && <p className="ai-chat-attachment-note">{attachments.notice}</p>}
  </div>
}

/** Ảnh của một câu hỏi đã gửi. Ảnh không tải được (đã bị dọn, mất mạng) thì ẩn, không làm vỡ khung hội thoại. */
export function AiChatMessageImages({ images }: { images: readonly string[] }) {
  const [broken, setBroken] = useState<readonly string[]>([])
  const shown = images.filter(url => !broken.includes(url))
  if (!shown.length) return null
  return <div className="ai-chat-message-images">
    {shown.map((url, index) =>
      // Bấm mở ảnh bằng trình duyệt của máy (cửa sổ chính chuyển mọi liên kết mở tab mới ra ngoài).
      <a key={url} href={url} target="_blank" rel="noreferrer noopener" title="Mở ảnh">
        <img src={url} alt={`Ảnh đính kèm ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(current => [...current, url])} />
      </a>)}
  </div>
}
