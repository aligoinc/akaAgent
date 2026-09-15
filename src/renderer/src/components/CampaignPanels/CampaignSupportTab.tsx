import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ImagePlus, Loader2, Pause, Play, RefreshCw, RotateCcw, Send, X } from 'lucide-react'
import {
  CAMPAIGN_SUPPORT_IMAGE_BYTES, CAMPAIGN_SUPPORT_IMAGE_TYPES, CAMPAIGN_SUPPORT_MAX_IMAGES, CAMPAIGN_SUPPORT_MAX_IMAGE_NAME,
  CAMPAIGN_SUPPORT_MAX_QUESTION, CAMPAIGN_SUPPORT_TOTAL_IMAGE_BYTES,
  isCampaignSupportTurnBusy, type CampaignSupportConversation, type CampaignSupportImage,
  type CampaignSupportStatus, type CampaignSupportTurn
} from '../../../../shared/campaignSupport'
import { useAuthStore } from '../../stores/authStore'

const STATUS_LABELS: Record<CampaignSupportStatus, string> = {
  queued: 'Đang chờ phân tích', working: 'Đang phân tích chiến dịch', waiting_dependency: 'Đang chờ dịch vụ phản hồi',
  completed: 'Đã phân tích xong', needs_input: 'Cần bổ sung thông tin', cancelled: 'Đã dừng phân tích'
}
type DraftImage = CampaignSupportImage & { id: string; size: number; preview: string }
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  .replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '').trim()
const readImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
  reader.onerror = () => reject(new Error('Không đọc được ảnh.'))
  reader.readAsDataURL(file)
})

export default function CampaignSupportTab({ campaign, startRequestId }: {
  campaign: { id: number; name: string } | null
  startRequestId?: string
}) {
  const owner = useAuthStore(state => state.user)
  const campaignId = campaign?.id
  const [conversation, setConversation] = useState<CampaignSupportConversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [images, setImages] = useState<DraftImage[]>([])
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  const [reload, setReload] = useState(0)
  const lock = useRef(false)
  const addingLock = useRef(false)
  const epoch = useRef(0)
  const imageRef = useRef<DraftImage[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const questionInput = useRef<HTMLTextAreaElement>(null)
  const messages = useRef<HTMLDivElement>(null)

  const clearImages = useCallback(() => {
    imageRef.current.forEach(image => URL.revokeObjectURL(image.preview))
    imageRef.current = []
    setImages([])
  }, [])
  const accept = useCallback((value: CampaignSupportConversation) => {
    if (value.campaignId !== campaignId || value.organizationId !== owner?.organizationId || value.staffId !== owner?.staffId) return
    setConversation(current => !current || value.revision >= current.revision ? value : current)
  }, [campaignId, owner?.organizationId, owner?.staffId])

  useEffect(() => {
    const generation = ++epoch.current
    setConversation(null); setQuestion(''); clearImages(); setPreview(null); setError(null)
    setLoading(true); setPending(false); setAdding(false); lock.current = false; addingLock.current = false
    if (!campaignId || !owner) { setLoading(false); return }
    const unsubscribe = window.electronAPI.onCampaignSupportUpdated(value => {
      if (epoch.current === generation) accept(value)
    })
    window.electronAPI.openCampaignSupport(campaignId, startRequestId).then(value => {
      if (epoch.current === generation) accept(value)
    }).catch(error => {
      if (epoch.current === generation) setError(errorMessage(error))
    }).finally(() => { if (epoch.current === generation) setLoading(false) })
    return () => { epoch.current++; unsubscribe() }
  }, [campaignId, startRequestId, owner?.organizationId, owner?.staffId, accept, clearImages, reload])
  useEffect(() => () => { imageRef.current.forEach(image => URL.revokeObjectURL(image.preview)) }, [])
  useEffect(() => {
    if (messages.current) messages.current.scrollTop = messages.current.scrollHeight
  }, [conversation?.turns.length, conversation?.turns.at(-1)?.result?.status, conversation?.turns.at(-1)?.result?.answer])
  useEffect(() => {
    if (!preview) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [preview])

  const command = async (action: () => Promise<CampaignSupportConversation>, onSuccess?: () => void) => {
    if (lock.current) return
    lock.current = true
    setPending(true); setError(null)
    const generation = epoch.current
    try {
      const value = await action()
      if (generation !== epoch.current) return
      accept(value)
      onSuccess?.()
    } catch (error) { if (generation === epoch.current) setError(errorMessage(error)) }
    finally { if (generation === epoch.current) { lock.current = false; setPending(false) } }
  }
  const last = conversation?.turns.at(-1)
  const restarting = !!conversation?.pendingStartRequestId
  const restartFailed = restarting && !!last?.error && !last.retryable
  const busy = restarting || isCampaignSupportTurnBusy(last)
  const canSend = !!conversation && !loading && !pending && !adding && !busy && !last?.error
    && (!last || ['completed', 'needs_input'].includes(last.result?.status ?? ''))
  useEffect(() => {
    if (!loading && conversation && !conversation.turns.length) questionInput.current?.focus()
  }, [loading, conversation?.id])
  const send = () => {
    if (!conversation || !campaignId || !canSend || (!question.trim() && !images.length)) return
    void command(() => window.electronAPI.sendCampaignSupport({ campaignId, conversationKey: conversation.id,
      question, images: images.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 })) }),
    () => { setQuestion(''); clearImages() })
  }
  const addImages = async (files: File[]) => {
    if (addingLock.current || lock.current || !canSend || !files.length) return
    addingLock.current = true; setAdding(true); setError(null)
    const generation = epoch.current
    const added: DraftImage[] = []
    try {
      if (files.length + imageRef.current.length > CAMPAIGN_SUPPORT_MAX_IMAGES) throw new Error('Chỉ được gửi tối đa 5 ảnh.')
      let total = imageRef.current.reduce((sum, image) => sum + image.size, 0)
      for (const file of files) {
        if (file.name.length > CAMPAIGN_SUPPORT_MAX_IMAGE_NAME) throw new Error('Tên ảnh tối đa 200 ký tự. Đổi tên ảnh rồi thử lại.')
        if (!(CAMPAIGN_SUPPORT_IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error('Chỉ hỗ trợ ảnh PNG, JPEG và WebP tĩnh.')
        if (file.size > CAMPAIGN_SUPPORT_IMAGE_BYTES) throw new Error(`${file.name}: vượt giới hạn 5 MB/ảnh.`)
        total += file.size
        if (total > CAMPAIGN_SUPPORT_TOTAL_IMAGE_BYTES) throw new Error('Tổng dung lượng ảnh không được vượt quá 15 MB.')
        const dataBase64 = await readImage(file)
        if (generation !== epoch.current) return
        added.push({ id: crypto.randomUUID(), name: file.name || 'anh.png', mimeType: file.type as CampaignSupportImage['mimeType'],
          dataBase64, size: file.size, preview: URL.createObjectURL(file) })
      }
      imageRef.current = [...imageRef.current, ...added]
      setImages(imageRef.current)
    } catch (error) {
      added.forEach(image => URL.revokeObjectURL(image.preview))
      if (generation === epoch.current) setError(errorMessage(error))
    } finally {
      if (generation !== epoch.current) added.forEach(image => URL.revokeObjectURL(image.preview))
      else { addingLock.current = false; setAdding(false) }
    }
  }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length) { event.preventDefault(); void addImages(files) }
  }
  const showImage = async (turn: CampaignSupportTurn, index: number) => {
    if (!campaignId || !conversation) return
    const generation = epoch.current
    const key = conversation.id
    try {
      const url = await window.electronAPI.readCampaignSupportImage({ campaignId, conversationKey: key, requestId: turn.requestId, index })
      if (generation === epoch.current) setPreview({ url, name: turn.images[index].name })
    } catch (error) { if (generation === epoch.current) setError(errorMessage(error)) }
  }
  const control = (action: 'cancel' | 'resume') => {
    if (!campaignId || !conversation || !last) return
    void command(() => window.electronAPI.controlCampaignSupport({ campaignId, conversationKey: conversation.id, requestId: last.requestId, action }))
  }

  if (!campaign || !owner) return <div className="assistant-empty">Chọn một chiến dịch để kiểm tra nguyên nhân.</div>
  return <div className="assistant-panel campaign-support-panel">
    <div className="campaign-support-heading">
      <span title={campaign.name}>{campaign.name}</span>
      <button type="button" className="assistant-reset-btn" disabled={!conversation || loading || pending || busy || adding}
        onClick={() => {
          if (!conversation) return
          void command(() => window.electronAPI.resetCampaignSupport(campaign.id, conversation.id), () => {
            epoch.current++
            setQuestion(''); clearImages(); setPreview(null)
            // Resubscribe with a new generation so late image reads cannot reopen the old conversation.
            setReload(value => value + 1)
          })
        }}><RotateCcw size={13} />Tạo mới</button>
    </div>
    {loading && <div className="campaign-support-notice" role="status"><Loader2 size={15} className="spin" />Đang mở hội thoại...</div>}
    <div className="assistant-messages" ref={messages}>
      {!loading && conversation && !last && <div className="campaign-support-notice">
        Nhập nội dung hoặc thêm ảnh, rồi bấm Gửi để bắt đầu hội thoại mới.
      </div>}
      {conversation?.turns.map(turn => <div className="campaign-support-turn" key={turn.requestId}>
        <div className="assistant-message user"><div className="assistant-message-content">
          {turn.question}
          {turn.images.map((image, index) => <button type="button" className="campaign-support-sent-image" key={index}
            onClick={() => void showImage(turn, index)} title={`Xem ảnh ${image.name}`}><ImagePlus size={14} />{image.name}</button>)}
        </div></div>
        {turn.result?.answer && <div className="assistant-message assistant"><div className="assistant-message-content">{turn.result.answer}</div></div>}
        {turn.result?.status === 'needs_input' && <div className="campaign-support-notice">
          {turn.result.progress.reason || 'Bổ sung câu hỏi hoặc ảnh để trợ lý kiểm tra tiếp.'}
        </div>}
      </div>)}
    </div>
    {last && <div className="campaign-support-status" role="status">
      <div>{busy && !restartFailed && <Loader2 size={14} className="spin" />}
        <strong>{restartFailed ? 'Chưa thể hỏi lại' : restarting ? 'Đang dừng lượt cũ để hỏi lại' : last.runNotFound ? 'Không tìm thấy lượt phân tích' : last.controlPending === 'cancel' ? 'Đang dừng phân tích'
          : last.controlPending === 'resume' ? 'Đang tiếp tục phân tích'
            : last.result ? STATUS_LABELS[last.result.status] : last.error ? 'Chưa nhận được kết quả' : 'Đang gửi câu hỏi'}</strong>
      </div>
      {!last.runNotFound && last.result?.progress.reason && last.result.status !== 'needs_input' && <p>{last.result.progress.reason}</p>}
      {busy && !restarting && <button type="button" className="assistant-reset-btn" disabled={pending || !!last.controlPending}
        onClick={() => control('cancel')}><Pause size={13} />Dừng phân tích</button>}
      {!restarting && !last.runNotFound && last.result?.status === 'cancelled' && <button type="button" className="assistant-reset-btn" disabled={pending || !!last.controlPending}
        onClick={() => control('resume')}><Play size={13} />Tiếp tục phân tích</button>}
    </div>}
    {(error || last?.error) && <div className="assistant-inline-error campaign-support-error" role="alert">
      <AlertTriangle size={15} /><span>{error || last?.error}</span>
      {!conversation && !loading && <button type="button" className="assistant-reset-btn" onClick={() => setReload(value => value + 1)}><RefreshCw size={13} />Thử lại</button>}
      {conversation && last?.retryable && <button type="button" className="assistant-reset-btn" disabled={pending}
        onClick={() => void command(() => window.electronAPI.retryCampaignSupport(campaign.id, conversation.id))}><RefreshCw size={13} />Thử lại</button>}
    </div>}
    <div className="campaign-support-composer">
      {images.length > 0 && <div className="campaign-support-images">
        {images.map(image => <div className="campaign-support-image" key={image.id}>
          <button type="button" title={`Xem ảnh ${image.name}`} onClick={() => setPreview({ url: image.preview, name: image.name })}><img src={image.preview} alt={image.name} /></button>
          <button type="button" className="campaign-support-remove-image" title={`Bỏ ảnh ${image.name}`} disabled={pending || adding}
            onClick={() => { URL.revokeObjectURL(image.preview); imageRef.current = imageRef.current.filter(item => item.id !== image.id); setImages(imageRef.current) }}><X size={12} /></button>
        </div>)}
      </div>}
      <textarea ref={questionInput} className="assistant-chat-textarea" aria-label="Câu hỏi chẩn đoán" value={question} rows={3} maxLength={CAMPAIGN_SUPPORT_MAX_QUESTION}
        disabled={!canSend} placeholder={last ? 'Nhập câu hỏi tiếp hoặc dán ảnh lỗi...' : 'Nhập nội dung cần hỏi hoặc dán ảnh...'} onChange={event => setQuestion(event.target.value)} onPaste={onPaste}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} />
      <div className="campaign-support-composer-actions">
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => {
          void addImages(Array.from(event.target.files ?? [])); event.target.value = ''
        }} />
        <button type="button" className="assistant-reset-btn" onClick={() => fileInput.current?.click()} disabled={!canSend || images.length >= CAMPAIGN_SUPPORT_MAX_IMAGES}
          title="Thêm tối đa 5 ảnh PNG/JPEG/WebP, 5 MB/ảnh, tổng 15 MB"><ImagePlus size={15} />Thêm ảnh</button>
        <small>{question.length}/{CAMPAIGN_SUPPORT_MAX_QUESTION}</small>
        <button type="button" className="assistant-chat-send" title="Gửi câu hỏi chẩn đoán" disabled={!canSend || (!question.trim() && !images.length)} onClick={send}>
          {pending || adding ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
    {preview && createPortal(<div className="campaign-support-preview" role="dialog" aria-modal="true" aria-label="Xem ảnh chẩn đoán" onClick={() => setPreview(null)}>
      <button type="button" title="Đóng ảnh" onClick={() => setPreview(null)} autoFocus><X size={22} /></button>
      <img src={preview.url} alt={preview.name} onClick={event => event.stopPropagation()} />
    </div>, document.body)}
  </div>
}
