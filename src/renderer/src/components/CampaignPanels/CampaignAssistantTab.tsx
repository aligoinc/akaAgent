import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, Send, Sparkles } from 'lucide-react'
import type { Campaign, CampaignAssistantContextSnapshot, CampaignAssistantMessage } from '../../../../shared/types'
import {
  clearCampaignAssistantConversation,
  readCampaignAssistantConversation,
  writeCampaignAssistantConversation
} from './campaignAssistantStorage'

type AssistantStatus = 'idle' | 'loading_context' | 'ready' | 'sending' | 'error'

interface AssistantState {
  status: AssistantStatus
  messages: CampaignAssistantMessage[]
  contextSnapshot: CampaignAssistantContextSnapshot | null
  contextLoadedAt: string | null
  error: string | null
}

interface CampaignAssistantTabProps {
  campaign: Pick<Campaign, 'id' | 'name'> | null
}

const initialState: AssistantState = {
  status: 'idle',
  messages: [],
  contextSnapshot: null,
  contextLoadedAt: null,
  error: null
}

const formatIpcErrorMessage = (err: unknown, fallback: string): string => {
  const message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : ''

  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback
}

const isValidCachedConversation = (
  cached: ReturnType<typeof readCampaignAssistantConversation>,
  campaignId: number
) => (
  !!cached &&
  Array.isArray(cached.messages) &&
  !!cached.contextSnapshot &&
  Number(cached.contextSnapshot?.campaign?.id) === Number(campaignId)
)

function AssistantMessageBubble({ message }: { message: CampaignAssistantMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`assistant-message ${isUser ? 'user' : 'assistant'}`}>
      <div className="assistant-message-content">
        {message.content}
      </div>
    </div>
  )
}

function AssistantInputBar({
  disabled,
  onSend
}: {
  disabled: boolean
  onSend: (text: string) => void
}) {
  const [value, setValue] = useState('')

  const submit = () => {
    const text = value.trim()
    if (!text || disabled) return
    setValue('')
    onSend(text)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="assistant-chat-input">
      <textarea
        className="assistant-chat-textarea"
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={2}
        placeholder="Nhập câu hỏi về chiến dịch..."
      />
      <button
        type="button"
        className="assistant-chat-send"
        onClick={submit}
        disabled={disabled || !value.trim()}
        title="Gửi"
      >
        <Send size={16} />
      </button>
    </div>
  )
}

export default function CampaignAssistantTab({ campaign }: CampaignAssistantTabProps) {
  const campaignId = campaign?.id ?? null
  const campaignName = campaign?.name || ''
  const [state, setState] = useState<AssistantState>(initialState)
  const messagesRef = useRef<HTMLDivElement>(null)
  const requestSeqRef = useRef(0)

  useEffect(() => {
    if (!campaignId) {
      setState(initialState)
      return
    }

    const cached = readCampaignAssistantConversation(campaignId)
    if (cached && isValidCachedConversation(cached, campaignId)) {
      setState({
        status: 'ready',
        messages: cached.messages,
        contextSnapshot: cached.contextSnapshot,
        contextLoadedAt: cached.contextLoadedAt,
        error: null
      })
    } else {
      setState(initialState)
    }
  }, [campaignId])

  useEffect(() => {
    if (!messagesRef.current) return
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [state.messages, state.status])

  const persist = useCallback((next: Pick<AssistantState, 'messages' | 'contextSnapshot' | 'contextLoadedAt'>) => {
    if (!campaignId || !next.contextSnapshot || !next.contextLoadedAt) return
    writeCampaignAssistantConversation(campaignId, {
      messages: next.messages,
      contextSnapshot: next.contextSnapshot,
      contextLoadedAt: next.contextLoadedAt
    })
  }, [campaignId])

  const startConversation = useCallback(async () => {
    if (!campaignId) return
    const seq = ++requestSeqRef.current
    setState(prev => ({ ...prev, status: 'loading_context', error: null }))

    try {
      const result = await window.electronAPI.getCampaignAssistantContext(campaignId)
      if (requestSeqRef.current !== seq) return

      const snapshot = result.contextSnapshot
      const next: AssistantState = {
        status: 'ready',
        messages: [],
        contextSnapshot: snapshot,
        contextLoadedAt: snapshot.snapshotAt,
        error: null
      }
      setState(next)
      persist(next)
    } catch (err) {
      if (requestSeqRef.current !== seq) return
      setState(prev => ({
        ...prev,
        status: 'error',
        error: formatIpcErrorMessage(err, 'Không tải được dữ liệu chiến dịch.')
      }))
    }
  }, [campaignId, persist])

  const resetConversation = useCallback(() => {
    requestSeqRef.current += 1
    if (campaignId) clearCampaignAssistantConversation(campaignId)
    setState(initialState)
  }, [campaignId])

  const sendMessage = useCallback(async (text: string) => {
    if (!campaignId || !state.contextSnapshot || state.status === 'sending') return
    const userMessage: CampaignAssistantMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now()
    }
    const messagesForRequest = [...state.messages, userMessage]
    const seq = ++requestSeqRef.current
    const sendingState: AssistantState = {
      ...state,
      status: 'sending',
      messages: messagesForRequest,
      error: null
    }
    setState(sendingState)
    persist(sendingState)

    try {
      const result = await window.electronAPI.chatCampaignAssistant({
        campaignId,
        contextSnapshot: state.contextSnapshot,
        messages: messagesForRequest
      })
      if (requestSeqRef.current !== seq) return

      const assistantMessage: CampaignAssistantMessage = {
        role: 'assistant',
        content: result.content,
        timestamp: Date.now()
      }
      setState(prev => {
        const next: AssistantState = {
          ...prev,
          status: 'ready',
          messages: [...messagesForRequest, assistantMessage],
          error: null
        }
        persist(next)
        return next
      })
    } catch (err) {
      if (requestSeqRef.current !== seq) return
      setState(prev => {
        const next: AssistantState = {
          ...prev,
          status: 'ready',
          error: formatIpcErrorMessage(err, 'Trợ lý chưa trả lời được lúc này.')
        }
        persist(next)
        return next
      })
    }
  }, [campaignId, persist, state])

  const showChat = state.status === 'ready' || state.status === 'sending'
  const sending = state.status === 'sending'
  const contextTimeLabel = useMemo(() => (
    state.contextLoadedAt ? new Date(state.contextLoadedAt).toLocaleString('vi-VN') : ''
  ), [state.contextLoadedAt])

  if (!campaignId) {
    return (
      <div className="assistant-empty">
        <Sparkles className="assistant-empty-icon" size={34} />
        <div className="assistant-empty-title">Chưa chọn chiến dịch</div>
        <p className="assistant-empty-desc">
          Bấm nút Hỏi trợ lý ở một chiến dịch trong bảng để bắt đầu trao đổi.
        </p>
      </div>
    )
  }

  return (
    <div className="assistant-panel">
      {showChat && (
        <div className="assistant-chat-header">
          <div className="assistant-campaign-name" title={campaignName}>
            <Sparkles size={14} />
            <span>{campaignName ? `Trợ lý: ${campaignName}` : 'Trợ lý chiến dịch'}</span>
          </div>
          <button type="button" className="assistant-reset-btn" onClick={resetConversation} title="Tạo mới hội thoại">
            <RotateCcw size={13} />
            <span>Tạo mới</span>
          </button>
        </div>
      )}

      {state.status === 'idle' && (
        <div className="assistant-empty">
          <Sparkles className="assistant-empty-icon" size={34} />
          <div className="assistant-empty-title">Sẵn sàng hỗ trợ chiến dịch</div>
          {campaignName && <div className="assistant-empty-campaign">{campaignName}</div>}
          <p className="assistant-empty-desc">
            Nhấn Bắt đầu để nạp tình trạng chiến dịch trong ngày và mở hộp chat.
          </p>
          <button type="button" className="assistant-start-btn" onClick={startConversation}>
            <Sparkles size={15} />
            <span>Bắt đầu</span>
          </button>
        </div>
      )}

      {state.status === 'loading_context' && (
        <div className="assistant-loading">
          <Loader2 size={16} className="spin" />
          <span>Đang nạp dữ liệu chiến dịch...</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="assistant-error">
          <AlertTriangle size={18} />
          <span>{state.error || 'Không tải được dữ liệu chiến dịch.'}</span>
          <button type="button" className="assistant-start-btn" onClick={startConversation}>
            <RefreshCw size={14} />
            <span>Thử lại</span>
          </button>
        </div>
      )}

      {showChat && (
        <>
          <div className="assistant-messages" ref={messagesRef}>
            {contextTimeLabel && (
              <div className="assistant-context-time">Dữ liệu nạp lúc {contextTimeLabel}</div>
            )}
            {state.messages.length === 0 ? (
              <div className="assistant-messages-empty">Bạn có thể hỏi vì sao chiến dịch chưa chạy, cần làm gì tiếp theo, hoặc dữ liệu hôm nay ra sao.</div>
            ) : (
              state.messages.map((message, index) => (
                <AssistantMessageBubble key={`${message.timestamp || 0}-${index}`} message={message} />
              ))
            )}
            {sending && (
              <div className="assistant-message assistant">
                <div className="assistant-message-content assistant-typing">
                  Trợ lý đang trả lời...
                </div>
              </div>
            )}
            {state.error && (
              <div className="assistant-inline-error">
                <AlertTriangle size={14} />
                <span>{state.error}</span>
              </div>
            )}
          </div>
          <AssistantInputBar disabled={sending} onSend={sendMessage} />
        </>
      )}
    </div>
  )
}
