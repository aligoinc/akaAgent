import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Paperclip, Send, Square, X, RotateCcw, Sparkles, MessageSquarePlus, PanelRightClose, Undo2 } from 'lucide-react'
import type { AgentImage } from '../../../../shared/campaignAgent'
import type { useCampaignAgent } from './useCampaignAgent'
import { agentChangeRows } from './campaignAgentPresentation'
import { AGENT_DATA_ACCEPT, splitAgentDataMessage } from '../../../../shared/campaignAgentData'
type Controller = ReturnType<typeof useCampaignAgent>
function Attachment({ image, draftId, remove }: { image: AgentImage; draftId: string; remove?: () => void }) {
  const [url, setUrl] = useState<string | null>(), [expanded, setExpanded] = useState(false)
  useEffect(() => { let active = true
    window.electronAPI.readCampaignAgentImage(draftId, image.id).then(value => { if (active) setUrl(value) }).catch(() => { if (active) setUrl(null) })
    return () => { active = false }
  }, [draftId, image.id])
  return <div className={`agent-attachment${expanded ? ' expanded' : ''}`}>
    <button type="button" title={image.name} onClick={() => setExpanded(!expanded)} disabled={!url}>
      {url ? <img src={url} alt={image.name} /> : <span>{url === undefined ? 'Đang đọc ảnh…' : 'Ảnh gốc không có trên thiết bị này'}</span>}
      <small>{image.name}</small>
    </button>
    {remove && <button type="button" className="agent-remove-image" aria-label={`Gỡ ảnh ${image.name}`} onClick={remove}><X size={12} /></button>}
  </div>
}
export default function CampaignAgentChat({ agent }: { agent: Controller }) {
  const [draggingFiles, setDraggingFiles] = useState(false)
  const dragDepth = useRef(0)
  const [pendingPaste, setPendingPaste] = useState<{
    description: string; data: string; pastedText: string; remainingDraft: string
  } | null>(null)
  const scroller = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), file = useRef<HTMLInputElement>(null)
  const applyPaste = (value: { description: string; data: string }) => {
    // Never write an oversized composer: isAgentDraft must remain valid on save.
    if (value.description.length > 4000) return
    agent.setDraft(value.description)
    if (value.data) void agent.addDataText(value.data)
  }
  const attachmentsDisabled = agent.busy || agent.hasPendingData || agent.disabled
  const composerText = agent.hasPendingData ? agent.dataText : agent.draft
  useLayoutEffect(() => {
    if (!agent.open || !input.current) return
    input.current.style.height = '0px'
    input.current.style.height = `${Math.max(40, Math.min(120, input.current.scrollHeight))}px`
  }, [composerText, agent.open])
  useEffect(() => { if (!agent.open || attachmentsDisabled) { dragDepth.current = 0; setDraggingFiles(false) } }, [agent.open, attachmentsDisabled])
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [agent.turns.length, agent.busy])
  useEffect(() => { if (agent.open) input.current?.focus() }, [agent.open, agent.scope])
  const suggestions = agent.scope === 'content' ? ['Viết ngắn hơn', 'Thêm một biến thể nội dung'] : agent.scope === 'schedule'
    ? ['Chạy thứ 2, 4, 6 lúc 8h', 'Chạy hằng ngày lúc 9h'] : agent.scope === 'limits'
      ? ['Nghỉ 30 giây giữa hai lần', 'Mỗi ngày tối đa 50 lượt'] : ['Tạo chiến dịch nhắn tin Zalo', 'Chạy thứ 2, 4, 6 lúc 8h', 'Không gửi trùng trong 14 ngày']
  return <aside className={`campaign-agent-chat${agent.open ? ' is-open' : ''}${pendingPaste || agent.hasPendingData ? ' is-reviewing-paste' : ''}${draggingFiles ? ' is-dragging-files' : ''}`} aria-label="Chat thêm chiến dịch bằng Agent" hidden={!agent.open}
    onDragEnter={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault(); dragDepth.current++
      if (!attachmentsDisabled) setDraggingFiles(true)
    }}
    onDragOver={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault(); event.dataTransfer.dropEffect = attachmentsDisabled ? 'none' : 'copy'
    }}
    onDragLeave={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDraggingFiles(false)
    }}
    onDrop={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDraggingFiles(false)
      if (!attachmentsDisabled) void agent.addDataFiles(Array.from(event.dataTransfer.files))
    }}>
    <header className="agent-chat-header"><Sparkles size={19} /><div><strong>akaAgent</strong><small>Điền chiến dịch bằng hội thoại</small></div>
      <button type="button" className="btn-icon" title="Hội thoại mới" disabled={agent.busy || agent.hasPendingData || agent.disabled} onClick={agent.newChat}><MessageSquarePlus size={17} /></button>
      <button type="button" className="btn-icon" title="Thu gọn Agent" onClick={() => agent.setOpen(false)}><PanelRightClose size={17} /></button>
    </header>
    <div className="agent-chat-messages" ref={scroller} role="log" aria-live="polite" aria-relevant="additions text">
      {!agent.turns.length && <div className="agent-chat-welcome"><Sparkles size={28} /><h3>Bạn muốn tạo chiến dịch gì?</h3>
        <p>Mô tả chiến dịch, dán data hoặc đính kèm Excel, TXT, ảnh dữ liệu. Agent chọn nơi nhập; bạn kiểm tra dữ liệu trong Upload trước khi chèn.</p><p>Bạn tự bấm Lưu khi đã sẵn sàng.</p></div>}
      {agent.turns.map(turn => {
        const rows = (turn.changes || []).flatMap(change => agentChangeRows(change).map(row => ({ ...row, section: change.section, targetKey: row.targetKey || change.key })))
        return <article key={turn.id} className={`agent-turn ${turn.role}`}>
        <div className="agent-turn-text">{turn.text}</div>
        {!!turn.images?.length && <div className="agent-attachments">{turn.images.map(image => <Attachment key={image.id} draftId={agent.draftId} image={image} />)}</div>}
        {!!turn.dataFiles?.length && <div className="agent-data-files">{turn.dataFiles.map(file => <small key={file.id}>{file.name}</small>)}</div>}
        {turn.dataImport && <button type="button" className="btn btn-secondary btn-sm" disabled={agent.busy || agent.hasPendingData || agent.disabled}
          onClick={() => agent.openDataImport(turn.dataImport!)}>Mở Upload dữ liệu</button>}
        {!!rows.length && <div className="agent-changes"><strong>{turn.undone ? 'Đã hoàn tác' : 'Đã điền vào form'} · {rows.length} thay đổi</strong>
          {rows.map(row => <button key={row.key} type="button" className="agent-change" onClick={() => agent.jump(row.section, row.targetKey)}>
            <span>{row.label}</span><div><del>{row.beforeText}</del><span aria-hidden="true"> → </span><b>{row.afterText}</b></div>
          </button>)}
          <div className="agent-undo"><button type="button" className="btn btn-secondary btn-sm" disabled={!agent.canUndo(turn)} onClick={() => void agent.undo(turn)}><Undo2 size={13} /> Hoàn tác</button>
            {!turn.undone && !agent.canUndo(turn) && !agent.busy && !agent.hasPendingData && <small>Trường liên quan đã được sửa tiếp.</small>}</div>
        </div>}
        {turn.extractedText && <details className="agent-image-text"><summary>Nội dung đã đọc từ ảnh</summary><p>{turn.extractedText}</p></details>}
      </article>})}
      {agent.pendingAction && <div className="agent-action-confirm" role="alert"><strong>Đổi sang {agent.pendingAction}?</strong>
        <p>Đổi loại có thể bỏ tài khoản/nhóm data không tương thích, chuyển nội dung định dạng về văn bản và bỏ media khi chuyển sang SMS/Gọi. Toàn bộ thay đổi sẽ hiện trong bảng trước → sau; bạn có thể hoàn tác cả lượt.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => agent.confirmAction(true)}>Đổi loại và tiếp tục</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => agent.confirmAction(false)}>Giữ nguyên</button></div>}
      {agent.busy && !agent.pendingAction && !pendingPaste && <div className="agent-working"><RotateCcw size={14} className="spin" /> Đang đọc yêu cầu và chuẩn bị form…</div>}
    </div>
    <div className="agent-chat-composer">
      <div className="agent-suggestions">{suggestions.map(suggestion => <button type="button" key={suggestion} disabled={agent.busy || agent.hasPendingData || agent.disabled}
        onClick={() => { agent.setDraft(suggestion); input.current?.focus() }}>{suggestion}</button>)}</div>
      {agent.error && <div className="agent-chat-error" role="alert">{agent.error}</div>}
      {pendingPaste && <div className="agent-data-paste agent-paste-review">
        <p role="alert">Phần mô tả sau khi dán vượt 4.000 ký tự. Hãy rút gọn bên dưới hoặc bỏ phần vừa dán. Nếu đây là danh sách dữ liệu, bạn có thể đính kèm nguyên phần vừa dán mà không cần rút gọn.</p>
        <textarea aria-label="Rút gọn mô tả vừa dán" value={pendingPaste.description} rows={6}
          onChange={event => setPendingPaste({ ...pendingPaste, description: event.target.value })} />
        <small>{pendingPaste.description.length.toLocaleString('vi-VN')} / 4.000 ký tự{pendingPaste.data ? ' · Bảng dữ liệu được giữ tại máy, sẽ đính kèm khi áp dụng.' : ''}</small>
        <div className="agent-paste-review-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={pendingPaste.description.length > 4000 || agent.disabled}
          onClick={() => { const value = pendingPaste; agent.endInputReview(); setPendingPaste(null); applyPaste(value) }}>Áp dụng phần vừa dán</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={agent.disabled || !pendingPaste.pastedText.trim()}
          onClick={() => {
            const value = pendingPaste
            agent.endInputReview(); setPendingPaste(null)
            // Attach the exact clipboard source, including rows already recognized by
            // the splitter. Keep instructions outside the replaced selection in chat.
            agent.setDraft(value.remainingDraft)
            void agent.addDataText(value.pastedText)
          }}>Đính kèm nguyên phần vừa dán</button>
        <button type="button" className="btn btn-ghost btn-sm"
          onClick={() => { agent.endInputReview(); setPendingPaste(null) }}>Bỏ phần vừa dán</button></div>
      </div>}
      {!!agent.dataFiles.length && <div className="agent-data-files">{agent.dataFiles.map(file => <div key={file.id}><span>{file.name}</span>
        <button type="button" aria-label={`Gỡ dữ liệu ${file.name}`} disabled={agent.busy || agent.disabled} onClick={() => agent.removeDataFile(file.id)}><X size={12} /></button></div>)}
        <small>Dữ liệu được nhập tại máy, không gửi danh sách cho AI.</small></div>}
      {!!agent.images.length && <div className="agent-attachments">{agent.images.map(image => <Attachment key={image.id} draftId={agent.draftId} image={image}
        remove={agent.busy || agent.disabled ? undefined : () => agent.removeImage(image.id)} />)}</div>}
      <div className="agent-input-box">
        {draggingFiles && <div className="agent-drop-hint" role="status">Thả file Excel, CSV, TXT hoặc ảnh vào đây</div>}
        {agent.hasPendingData && <p className="agent-pending-data-hint" role="status">Dữ liệu chưa đính kèm được. Bạn có thể sửa bên dưới, gỡ bớt file rồi thử lại. Mô tả yêu cầu đã được giữ lại.</p>}
        <textarea ref={input} value={composerText} maxLength={agent.hasPendingData ? undefined : 4000} rows={2}
        aria-label={agent.hasPendingData ? 'Dữ liệu cần nhập' : 'Yêu cầu cho Agent'}
        placeholder="Nhập yêu cầu hoặc dán dữ liệu…" disabled={agent.busy || agent.disabled}
        onPaste={event => {
          if (event.clipboardData.files.length) { event.preventDefault(); if (!attachmentsDisabled) void agent.addDataFiles(Array.from(event.clipboardData.files)); return }
          if (agent.hasPendingData) return
          const text = event.clipboardData.getData('text'), field = event.currentTarget
          const next = field.value.slice(0, field.selectionStart) + text + field.value.slice(field.selectionEnd)
          const split = splitAgentDataMessage(next, agent.scope === 'content')
          if (split.description.length > 4000) {
            event.preventDefault()
            if (agent.beginInputReview()) setPendingPaste({ ...split, pastedText: text,
              remainingDraft: field.value.slice(0, field.selectionStart) + field.value.slice(field.selectionEnd) })
            return
          }
          if (split.data) {
            event.preventDefault()
            applyPaste(split)
          }
        }}
        onChange={event => agent.hasPendingData ? agent.setDataText(event.target.value) : agent.setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (agent.hasPendingData) void agent.addDataText(agent.dataText)
            else void agent.send()
          }
        }} />
        {agent.hasPendingData && <div className="agent-paste-review-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={agent.busy || agent.disabled}
            onClick={() => void agent.addDataText(agent.dataText)}>Đính kèm dữ liệu</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={agent.busy}
            onClick={() => agent.setDataText('')}>Bỏ dữ liệu đang chờ</button>
        </div>}
        <div className="agent-input-actions"><input ref={file} type="file" accept={AGENT_DATA_ACCEPT} multiple hidden
          disabled={attachmentsDisabled}
          onChange={event => { void agent.addDataFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
          <button type="button" className="btn btn-ghost btn-sm agent-choose-file" title="Chọn file Excel, CSV, TXT hoặc ảnh dữ liệu" disabled={attachmentsDisabled} onClick={() => file.current?.click()}><Paperclip size={16} /> Chọn file</button>
          <span className="agent-scope">{agent.scopeLabel}{agent.scope && <button type="button" aria-label="Hỏi toàn bộ form" onClick={() => agent.setScope(null)} disabled={agent.busy || agent.hasPendingData}><X size={11} /></button>}</span>
          {pendingPaste ? null : agent.busy ? <button type="button" className="btn btn-secondary btn-icon" aria-label="Dừng Agent" onClick={agent.cancel}><Square size={14} /></button>
            : <button type="button" className="btn btn-primary btn-icon" aria-label="Gửi yêu cầu Agent" disabled={agent.hasPendingData || agent.disabled || !agent.draft.trim() && !agent.dataFiles.length} onClick={() => void agent.send()}><Send size={16} /></button>}
        </div></div>
      {!agent.hasPendingData && !!agent.draft.trim() && <button type="button" className="agent-use-as-data" disabled={agent.busy || agent.disabled}
        onClick={() => { const text = agent.draft; agent.setDraft(''); void agent.addDataText(text) }}>Dùng nội dung ô nhập làm dữ liệu</button>}
      <small className="agent-input-hint">Kéo file vào chat · Enter để {agent.hasPendingData ? 'đính kèm' : 'gửi'} · Shift+Enter xuống dòng</small>
    </div>
  </aside>
}
