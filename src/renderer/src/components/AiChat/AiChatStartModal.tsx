import { Loader2, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AI_CHAT_MAX_QUESTION, aiChatErrorCode, aiChatErrorMessage, newAiChatRequestId, validateAiChatIntake, validateAiChatQuestion,
  type AiChatProject, type AiChatSnapshot
} from '../../../../shared/aiChat'
import { aiChatTransport } from './aiChatTransport'
import '../../styles/aiChat.css'

interface AiChatStartModalProps {
  project: AiChatProject
  campaign: { id: number; name: string; accountName?: string | null } | null
  onClose(): void
  /** Hội thoại đã được tạo (hoặc mở lại hội thoại đang chờ): chuyển sang tab Hỏi đáp với đúng ảnh chụp này. */
  onOpened(snapshot: AiChatSnapshot): void
}

/** Bước xác nhận trước khi hỏi: mô tả agent, chiến dịch được gắn, câu hỏi đầu và các ô thu thêm của agent. */
export function AiChatStartModal({ project, campaign, onClose, onOpened }: AiChatStartModalProps) {
  // Một mã cho cả vòng đời modal: bấm hai lần hoặc gửi lại sau lỗi mạng không tạo hội thoại thứ hai.
  const requestId = useRef(newAiChatRequestId())
  const [question, setQuestion] = useState(project.defaultQuestion)
  const [intake, setIntake] = useState<Record<string, string | boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.setSelectionRange(input.current.value.length, input.current.value.length)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !inFlight.current) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    if (inFlight.current) return
    const invalid = validateAiChatQuestion(question) ?? validateAiChatIntake(project, intake)
    if (invalid) { setError(aiChatErrorMessage(invalid)); return }
    inFlight.current = true
    setSubmitting(true)
    setError(null)
    try {
      onOpened(await aiChatTransport.open({
        requestId: requestId.current, projectId: project.id, campaignId: campaign?.id ?? null, question: question.trim(), intake
      }))
    } catch (failure) {
      const code = aiChatErrorCode(failure)
      setError(code ? aiChatErrorMessage(code) : 'Không gửi được câu hỏi. Kiểm tra mạng rồi bấm Gửi câu hỏi lần nữa.')
      inFlight.current = false
      setSubmitting(false)
    }
  }
  const setField = (key: string, value: string | boolean) => setIntake(current => ({ ...current, [key]: value }))

  return createPortal(<div className="modal-overlay" style={{ zIndex: 2200 }} onMouseDown={() => { if (!inFlight.current) onClose() }}>
    <div className="modal ai-chat-start-modal" role="dialog" aria-modal="true" aria-label={project.name} onMouseDown={event => event.stopPropagation()}>
      <div className="modal-header">
        <div className="modal-title ai-chat-start-title"><Sparkles size={16} /><span>{project.name}</span></div>
        <button type="button" className="btn-icon" onClick={onClose} title="Đóng" disabled={submitting}><X size={18} /></button>
      </div>
      <fieldset className="modal-body ai-chat-start-body" disabled={submitting}>
        {project.description && <p className="ai-chat-start-description">{project.description}</p>}
        {campaign && <dl className="ai-chat-start-context">
          <div><dt>Chiến dịch</dt><dd title={campaign.name}>{campaign.name}</dd></div>
          {campaign.accountName && <div><dt>Tài khoản</dt><dd title={campaign.accountName}>{campaign.accountName}</dd></div>}
        </dl>}
        <label className="ai-chat-field">
          <span>Câu hỏi của bạn</span>
          <textarea ref={input} value={question} rows={4} maxLength={AI_CHAT_MAX_QUESTION} placeholder="Nhập điều bạn muốn hỏi về chiến dịch này..."
            onChange={event => { setQuestion(event.target.value); setError(null) }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit() } }} />
        </label>
        {project.suggestedQuestions.length > 0 && <div className="ai-chat-suggestions" aria-label="Câu hỏi gợi ý">
          {project.suggestedQuestions.map(item => <button type="button" key={item} className={item === question.trim() ? 'active' : ''}
            onClick={() => { setQuestion(item); setError(null); input.current?.focus() }}>{item}</button>)}
        </div>}
        {project.intakeSchema.map(field => field.type === 'checkbox'
          ? <label className="ai-chat-field ai-chat-field-checkbox" key={field.key}>
              <input type="checkbox" checked={intake[field.key] === true} onChange={event => setField(field.key, event.target.checked)} />
              <span>{field.label}{field.required ? ' *' : ''}</span>
            </label>
          : <label className="ai-chat-field" key={field.key}>
              <span>{field.label}{field.required ? ' *' : ''}</span>
              {field.type === 'select'
                ? <select value={String(intake[field.key] ?? '')} onChange={event => setField(field.key, event.target.value)}>
                    <option value="">Chọn...</option>
                    {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                : field.type === 'textarea'
                  ? <textarea rows={3} maxLength={field.maxLength} placeholder={field.placeholder} value={String(intake[field.key] ?? '')}
                      onChange={event => setField(field.key, event.target.value)} />
                  : <input type="text" maxLength={field.maxLength} placeholder={field.placeholder} value={String(intake[field.key] ?? '')}
                      onChange={event => setField(field.key, event.target.value)} />}
            </label>)}
        {error && <div className="assistant-inline-error" role="alert"><span>{error}</span></div>}
      </fieldset>
      <div className="modal-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Huỷ</button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={submitting || !question.trim()}>
          {submitting ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Gửi câu hỏi
        </button>
      </div>
    </div>
  </div>, document.body)
}
