import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Send, Square, X, RotateCcw, Sparkles, MessageSquarePlus, PanelRightClose, Undo2 } from 'lucide-react'
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
  const [pasting, setPasting] = useState(false)
  const [pendingPaste, setPendingPaste] = useState<{ description: string; data: string } | null>(null)
  const scroller = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), file = useRef<HTMLInputElement>(null)
  const applyPaste = (value: { description: string; data: string }) => {
    // Never write an oversized composer: isAgentDraft must remain valid on save.
    if (value.description.length > 4000) return
    agent.setDraft(value.description)
    if (value.data) void agent.addDataText(value.data).then(ok => { if (!ok) setPasting(true) })
  }
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [agent.turns.length, agent.busy])
  useEffect(() => { if (agent.open) input.current?.focus() }, [agent.open, agent.scope])
  const suggestions = agent.scope === 'content' ? ['Viết ngắn hơn', 'Thêm một biến thể nội dung'] : agent.scope === 'schedule'
    ? ['Chạy thứ 2, 4, 6 lúc 8h', 'Chạy hằng ngày lúc 9h'] : agent.scope === 'limits'
      ? ['Nghỉ 30 giây giữa hai lần', 'Mỗi ngày tối đa 50 lượt'] : ['Tạo chiến dịch nhắn tin Zalo', 'Chạy thứ 2, 4, 6 lúc 8h', 'Không gửi trùng trong 14 ngày']
  return <aside className={`campaign-agent-chat${agent.open ? ' is-open' : ''}${pendingPaste || agent.hasPendingData ? ' is-reviewing-paste' : ''}`} aria-label="Chat thêm chiến dịch bằng Agent" hidden={!agent.open}>
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
        <p role="alert">Phần mô tả sau khi dán vượt 4.000 ký tự. Hãy rút gọn bên dưới hoặc bỏ phần vừa dán. Nội dung hiện tại được giữ nguyên.</p>
        <textarea aria-label="Rút gọn mô tả vừa dán" value={pendingPaste.description} rows={6}
          onChange={event => setPendingPaste({ ...pendingPaste, description: event.target.value })} />
        <small>{pendingPaste.description.length.toLocaleString('vi-VN')} / 4.000 ký tự{pendingPaste.data ? ' · Bảng dữ liệu được giữ tại máy, sẽ đính kèm khi áp dụng.' : ''}</small>
        <div className="agent-paste-review-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={pendingPaste.description.length > 4000 || agent.disabled}
          onClick={() => { const value = pendingPaste; agent.endInputReview(); setPendingPaste(null); applyPaste(value) }}>Áp dụng phần vừa dán</button>
        <button type="button" className="btn btn-ghost btn-sm"
          onClick={() => { agent.endInputReview(); setPendingPaste(null) }}>Bỏ phần vừa dán</button></div>
      </div>}
      {!!agent.dataFiles.length && <div className="agent-data-files">{agent.dataFiles.map(file => <div key={file.id}><span>{file.name}</span>
        <button type="button" aria-label={`Gỡ dữ liệu ${file.name}`} disabled={agent.busy || agent.disabled} onClick={() => agent.removeDataFile(file.id)}><X size={12} /></button></div>)}
        <small>Dữ liệu được nhập tại máy, không gửi danh sách cho AI.</small></div>}
      {(pasting || agent.hasPendingData) && <div className="agent-data-paste agent-paste-review">
        {agent.hasPendingData && <p role="status">Dữ liệu đang chờ đính kèm. Hãy đính kèm thành công hoặc bỏ dữ liệu này trước khi lưu/gửi. Bạn có thể gỡ bớt file đã chọn để thử lại.</p>}
        <textarea aria-label="Dữ liệu cần nhập" value={agent.dataText} rows={5}
        disabled={agent.busy || agent.disabled} onChange={event => agent.setDataText(event.target.value)} placeholder="Dán toàn bộ bảng hoặc danh sách tại đây…" />
        <div className="agent-paste-review-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={agent.busy || agent.disabled || !agent.dataText.trim()}
          onClick={() => { void agent.addDataText(agent.dataText).then(ok => { if (ok) setPasting(false) }) }}>Đính kèm dữ liệu</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={agent.busy}
          onClick={() => { agent.setDataText(''); setPasting(false) }}>{agent.hasPendingData ? 'Bỏ dữ liệu đang chờ' : 'Đóng'}</button></div></div>}
      {!!agent.images.length && <div className="agent-attachments">{agent.images.map(image => <Attachment key={image.id} draftId={agent.draftId} image={image}
        remove={agent.busy || agent.disabled ? undefined : () => agent.removeImage(image.id)} />)}</div>}
      <div className="agent-input-box"><textarea ref={input} value={agent.draft} maxLength={4000} rows={3} aria-label="Yêu cầu cho Agent"
        placeholder="Mô tả chiến dịch hoặc phần bạn muốn thay đổi…" disabled={agent.busy || agent.hasPendingData || agent.disabled}
        onPaste={event => {
          if (event.clipboardData.files.length) { event.preventDefault(); void agent.addDataFiles(Array.from(event.clipboardData.files)); return }
          const text = event.clipboardData.getData('text'), field = event.currentTarget
          const next = field.value.slice(0, field.selectionStart) + text + field.value.slice(field.selectionEnd)
          const split = splitAgentDataMessage(next, agent.scope === 'content')
          if (split.description.length > 4000) {
            event.preventDefault()
            if (agent.beginInputReview()) setPendingPaste(split)
            return
          }
          if (split.data) {
            event.preventDefault()
            applyPaste(split)
          }
        }}
        onChange={event => agent.setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void agent.send() }
        }} />
        <div className="agent-input-actions"><input ref={file} type="file" accept={AGENT_DATA_ACCEPT} multiple hidden
          onChange={event => { void agent.addImages(Array.from(event.target.files || [])); event.target.value = '' }} />
          <button type="button" className="btn-icon" title="Đính kèm Excel, TXT hoặc ảnh dữ liệu" disabled={agent.busy || agent.hasPendingData || agent.disabled} onClick={() => file.current?.click()}><ImagePlus size={18} /></button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={agent.busy || agent.hasPendingData || agent.disabled} onClick={() => setPasting(!pasting)}>Dán data</button>
          <span className="agent-scope">{agent.scopeLabel}{agent.scope && <button type="button" aria-label="Hỏi toàn bộ form" onClick={() => agent.setScope(null)} disabled={agent.busy || agent.hasPendingData}><X size={11} /></button>}</span>
          {pendingPaste ? null : agent.busy ? <button type="button" className="btn btn-secondary btn-icon" aria-label="Dừng Agent" onClick={agent.cancel}><Square size={14} /></button>
            : <button type="button" className="btn btn-primary btn-icon" aria-label="Gửi yêu cầu Agent" disabled={agent.hasPendingData || agent.disabled || !agent.draft.trim() && !agent.dataFiles.length} onClick={() => void agent.send()}><Send size={16} /></button>}
        </div></div>
      <small className="agent-input-hint">Enter để gửi · Shift+Enter xuống dòng</small>
    </div>
  </aside>
}
