import { AlertTriangle, ArrowLeft, History, Loader2, RefreshCw, Send, Sparkles, Square, ThumbsDown, ThumbsUp, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  AI_CHAT_MAX_QUESTION, aiChatAnswerSections, aiChatCanAsk, aiChatElapsedMs, aiChatLastMessage, aiChatStatusLabel, formatAiChatElapsed,
  isAiChatStatusActive,
  type AiChatControllerState, type AiChatMessage, type AiChatSnapshot, type AiChatThread, type AiChatThreadCursor
} from '../../../../shared/aiChat'
import { aiChatTransport } from './aiChatTransport'
import { useAiChatThread } from './aiChatStore'
import '../../styles/aiChat.css'

/** Yêu cầu mở hội thoại từ bên ngoài (menu Trợ lý, modal bắt đầu). `key` đổi = một yêu cầu mới. */
export interface AiChatPanelRequest {
  key: number | string
  /** Ảnh chụp vừa nhận từ `open`: hiện ngay, không gọi lại server. */
  snapshot?: AiChatSnapshot
  threadId?: number
}

interface AiChatTabProps {
  request: AiChatPanelRequest | null
  /** Tab Trợ lý đang hiện. Ẩn tab thì vẫn giữ hội thoại và hỏi lại thưa hơn. */
  active: boolean
  onThreadChange?(thread: AiChatThread | null): void
}

function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return now
}

function Answer({ message }: { message: AiChatMessage }) {
  const sections = aiChatAnswerSections(message)
  return <div className="ai-chat-answer">
    {sections.map((section, index) => {
      if (section.kind === 'summary') return <p key={index} className="ai-chat-answer-summary">{section.text}</p>
      if (section.kind === 'causes') return <div key={index} className="ai-chat-answer-block">
        <strong>{section.title}</strong>
        <ul>{section.items.map((item, itemIndex) => <li key={itemIndex}>{item.text}{item.evidence && <small>{item.evidence}</small>}</li>)}</ul>
      </div>
      if (section.kind === 'steps') return <div key={index} className="ai-chat-answer-block">
        <strong>{section.title}</strong>
        <ol>{section.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol>
      </div>
      if (section.kind === 'clarify') return <p key={index} className="ai-chat-answer-clarify">{section.text}</p>
      if (section.kind === 'escalate') return <p key={index} className="ai-chat-answer-escalate"><AlertTriangle size={13} />{section.text}</p>
      return <p key={index} className="ai-chat-answer-note">{section.text}</p>
    })}
  </div>
}

function threadBadge(thread: AiChatThread): { label: string; tone: string } | null {
  if (thread.pending) return { label: 'Đang chờ', tone: 'pending' }
  if (thread.unread) return thread.lastMessageStatus === 'lỗi' ? { label: 'Chưa trả lời được', tone: 'error' } : { label: 'Có trả lời mới', tone: 'unread' }
  return null
}

function ThreadList({ active, onOpen }: { active: boolean; onOpen(thread: AiChatThread): void }) {
  const [items, setItems] = useState<AiChatThread[] | null>(null)
  const [cursor, setCursor] = useState<AiChatThreadCursor | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const generation = useRef(0)
  const load = useCallback(async (after: AiChatThreadCursor | null) => {
    const current = ++generation.current
    setLoading(true)
    setError(false)
    try {
      const page = await aiChatTransport.threads({ limit: 20, cursor: after })
      if (current !== generation.current) return
      setItems(existing => after && existing ? [...existing, ...page.items.filter(item => !existing.some(known => known.id === item.id))] : page.items)
      setCursor(page.nextCursor)
    } catch {
      if (current === generation.current) setError(true)
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [])
  // Tải mỗi lần danh sách được mở ra; không hẹn giờ.
  useEffect(() => {
    if (active) void load(null)
    return () => { generation.current++ }
  }, [active, load])

  if (items === null) {
    return <div className="assistant-loading">
      {error
        ? <><AlertTriangle size={18} /><span>Không tải được danh sách hội thoại.</span>
            <button type="button" className="assistant-start-btn" onClick={() => void load(null)}><RefreshCw size={14} /><span>Thử lại</span></button></>
        : <><Loader2 size={16} className="spin" /><span>Đang tải hội thoại...</span></>}
    </div>
  }
  if (!items.length) {
    return <div className="assistant-empty">
      <Sparkles className="assistant-empty-icon" size={34} />
      <div className="assistant-empty-title">Chưa có hội thoại</div>
      <p className="assistant-empty-desc">Bấm nút Trợ lý ở một chiến dịch trong bảng rồi chọn trợ lý để bắt đầu hỏi đáp.</p>
    </div>
  }
  return <div className="ai-chat-thread-list">
    <div className="ai-chat-thread-list-title">Hội thoại gần đây</div>
    {items.map(thread => {
      const badge = threadBadge(thread)
      return <button type="button" key={thread.id} className="ai-chat-thread-item" onClick={() => onOpen(thread)}>
        <span className="ai-chat-thread-item-top">
          <strong title={thread.campaignName || thread.projectName}>{thread.campaignName || thread.projectName}</strong>
          {badge && <span className={`ai-chat-badge ${badge.tone}`}>{badge.tone === 'pending' && <Loader2 size={11} className="spin" />}{badge.label}</span>}
        </span>
        <span className="ai-chat-thread-item-question">{thread.name}</span>
        <span className="ai-chat-thread-item-meta">{thread.projectName} · {new Date(thread.lastMessageAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </button>
    })}
    {cursor && <button type="button" className="assistant-reset-btn ai-chat-load-more" disabled={loading} onClick={() => void load(cursor)}>
      {loading ? <Loader2 size={13} className="spin" /> : null}Xem thêm
    </button>}
    {error && <div className="assistant-inline-error"><AlertTriangle size={14} /><span>Không tải thêm được. Vui lòng thử lại.</span></div>}
  </div>
}

function MessageItem({ message, last, state, now, onCancel, onRetry, onRate }: {
  message: AiChatMessage
  last: boolean
  state: AiChatControllerState
  now: number
  onCancel(): void
  onRetry(): void
  onRate(rating: 1 | -1 | null): void
}) {
  const pending = isAiChatStatusActive(message.status)
  return <div className="ai-chat-turn">
    <div className="assistant-message user"><div className="assistant-message-content">{message.question}</div></div>
    {message.status === 'hoàn thành' && <div className="assistant-message assistant">
      <div className="assistant-message-content ai-chat-answer-content">
        <Answer message={message} />
        <div className="ai-chat-rating" aria-label="Đánh giá câu trả lời">
          <button type="button" className={message.rating === 1 ? 'active' : ''} disabled={state.busy} title="Hữu ích" aria-pressed={message.rating === 1}
            onClick={() => onRate(message.rating === 1 ? null : 1)}><ThumbsUp size={13} /></button>
          <button type="button" className={message.rating === -1 ? 'active down' : ''} disabled={state.busy} title="Chưa hữu ích" aria-pressed={message.rating === -1}
            onClick={() => onRate(message.rating === -1 ? null : -1)}><ThumbsDown size={13} /></button>
        </div>
      </div>
    </div>}
    {pending && <div className="ai-chat-status" role="status" aria-live="polite">
      <div className="ai-chat-status-line">
        <Loader2 size={14} className="spin" />
        <strong>{aiChatStatusLabel(message.status)}</strong>
        <span className="ai-chat-elapsed">{formatAiChatElapsed(aiChatElapsedMs(message, now, state.serverOffsetMs))}</span>
      </div>
      {message.progressNote && <p>{message.progressNote}</p>}
      {state.offline && <p className="ai-chat-offline"><WifiOff size={12} />Mất kết nối, đang thử lại. Câu hỏi của bạn vẫn được xử lý.</p>}
      {last && <button type="button" className="assistant-reset-btn" disabled={state.busy} onClick={onCancel}><Square size={11} />Dừng</button>}
    </div>}
    {message.status === 'lỗi' && <div className="assistant-inline-error ai-chat-result-error" role="alert">
      <AlertTriangle size={14} /><span>{message.errorMessage || 'Trợ lý chưa trả lời được câu hỏi này.'}</span>
      {last && <button type="button" className="assistant-reset-btn" disabled={state.busy} onClick={onRetry}><RefreshCw size={12} />Thử lại</button>}
    </div>}
    {message.status === 'đã hủy' && <div className="ai-chat-cancelled">
      <span>{message.errorMessage || 'Đã dừng câu hỏi này.'}</span>
      {last && <button type="button" className="assistant-reset-btn" disabled={state.busy} onClick={onRetry}><RefreshCw size={12} />Hỏi lại</button>}
    </div>}
  </div>
}

/**
 * Tab Hỏi đáp AI. Toàn bộ việc chờ/đồng bộ do `AiChatThreadController` (dùng chung với Desktop/mobile) đảm nhiệm;
 * component này chỉ hiển thị trạng thái từ server và khóa ô nhập khi câu cuối còn đang được xử lý.
 */
export function AiChatTab({ request, active, onThreadChange }: AiChatTabProps) {
  const { controller, state } = useAiChatThread(active)
  const [view, setView] = useState<'thread' | 'list'>(request ? 'thread' : 'list')
  const [draft, setDraft] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const handledRequest = useRef<number | string | null>(null)
  const last = aiChatLastMessage(state)
  const pending = isAiChatStatusActive(last?.status)
  const canAsk = aiChatCanAsk(state)
  const now = useNow(view === 'thread' && pending && active)

  useEffect(() => {
    if (!request || handledRequest.current === request.key) return
    handledRequest.current = request.key
    setView('thread')
    setDraft('')
    if (request.snapshot) controller.adopt(request.snapshot)
    else if (request.threadId) void controller.load(request.threadId)
  }, [request, controller])

  const thread = view === 'thread' ? state.thread : null
  useEffect(() => { onThreadChange?.(thread) }, [thread?.id, thread?.campaignName, onThreadChange]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [state.messages.length, last?.status, last?.progressNote, view])

  // Người dùng đang nhìn hội thoại thì kết quả mới coi như đã xem.
  useEffect(() => {
    if (view === 'thread' && active && state.thread?.unread && document.visibilityState === 'visible') void controller.markRead()
  }, [view, active, state.thread?.unread, state.thread?.lastMessageSeq, controller])

  // Có kết quả thì đưa con trỏ về ô nhập để hỏi tiếp.
  const wasPending = useRef(false)
  useEffect(() => {
    if (wasPending.current && !pending && active && view === 'thread') inputRef.current?.focus({ preventScroll: true })
    wasPending.current = pending
  }, [pending, active, view])

  const send = async () => {
    if (!canAsk || !draft.trim()) return
    if (await controller.ask(draft)) setDraft('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
  }
  const openFromList = (item: AiChatThread) => {
    setView('thread')
    setDraft('')
    void controller.load(item.id)
  }

  if (view === 'list') return <div className="assistant-panel ai-chat-panel"><ThreadList active={active} onOpen={openFromList} /></div>

  return <div className="assistant-panel ai-chat-panel">
    <div className="assistant-chat-header">
      <button type="button" className="assistant-reset-btn" onClick={() => setView('list')} title="Xem các hội thoại khác"><ArrowLeft size={13} /><History size={13} /><span>Lịch sử</span></button>
      <div className="assistant-campaign-name" title={state.thread?.projectName || ''}><Sparkles size={14} /><span>{state.thread?.projectName || 'Hỏi đáp'}</span></div>
    </div>

    {state.status === 'loading' && <div className="assistant-loading"><Loader2 size={16} className="spin" /><span>Đang mở hội thoại...</span></div>}
    {state.status === 'error' && <div className="assistant-error">
      <AlertTriangle size={18} /><span>{state.error || 'Không tải được hội thoại.'}</span>
      <button type="button" className="assistant-start-btn" onClick={() => setView('list')}><History size={14} /><span>Về danh sách hội thoại</span></button>
    </div>}

    {state.status === 'ready' && <>
      <div className="assistant-messages" ref={messagesRef}>
        {state.hasMore && <button type="button" className="assistant-reset-btn ai-chat-load-more" onClick={() => void controller.loadOlder()}>Xem các câu hỏi trước</button>}
        {state.messages.map(message => <MessageItem key={message.id} message={message} last={message.id === last?.id} state={state} now={now}
          onCancel={() => void controller.cancel()} onRetry={() => void controller.retry()} onRate={rating => void controller.rate(message.id, rating)} />)}
      </div>
      {state.actionError && <div className="assistant-inline-error ai-chat-action-error" role="alert"><AlertTriangle size={14} /><span>{state.actionError}</span></div>}
      <div className="assistant-chat-input ai-chat-input">
        <textarea ref={inputRef} className="assistant-chat-textarea" value={draft} rows={2} maxLength={AI_CHAT_MAX_QUESTION} disabled={!canAsk}
          aria-label="Câu hỏi tiếp theo"
          placeholder={pending ? 'Đang chờ câu trả lời...' : state.thread?.status === 'đã đóng' ? 'Hội thoại đã đóng.' : 'Nhập câu hỏi tiếp theo...'}
          onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} />
        <button type="button" className="assistant-chat-send" onClick={() => void send()} disabled={!canAsk || !draft.trim()} title={pending ? 'Đang chờ câu trả lời' : 'Gửi'}>
          {state.busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        </button>
      </div>
    </>}
  </div>
}
