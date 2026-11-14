// Cửa sổ Agent lọc bạn bè Zalo trên Desktop (docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md); bản Desktop của akaAgentWebApp
// apps/web/src/features/dataGroupAgent/DataGroupAgentDialog.tsx. Chọn tài khoản Zalo, mô tả bạn bè bằng tiếng Việt; Agent hỏi
// lại tới khi rõ, cột bên phải luôn hiện bộ lọc hiện tại (code dựng từ JSON). Khi Agent xác nhận thì đếm thử đúng bộ lọc đó.
// - `data_group` (Quản lý nhóm data): chỉ nút "Tạo nhóm" (người dùng bấm) mới ghi DB.
// - `campaign_recipients` (form chiến dịch, "Agent chọn bạn bè"): chỉ các tài khoản của form, không có ô tên nhóm; nút
//   "Thêm N bạn bè vào danh sách" lấy UID và tên (chỉ đọc) rồi trả cho form.
import { useEffect, useId, useRef, useState } from 'react'
import { Lock, RefreshCw, Send, Sparkles, Square, Users } from 'lucide-react'
import {
  DATA_GROUP_AGENT_MAX_MESSAGE, type DataGroupAgentPurpose
} from '../../../../../shared/dataGroupAgent'
import {
  FRIEND_FILTER_NOTE_LABELS, MESSAGE_STAGE_LABELS, friendFilterConditionsText,
  type CreateDataGroupFromFriendFilterResult, type ZaloFriendAccount, type ZaloFriendRecipientsResult
} from '../../../../../shared/zaloFriendFilter'
import DataGroupFormDialog from '../DataGroupFormDialog'
import { useDataGroupAgent, type DataGroupAgentController, type DataGroupAgentTurn } from './useDataGroupAgent'
import '../../CampaignPanels/campaignAgent.css'
import './DataGroupAgent.css'

const SUGGESTIONS = [
  'Bạn bè có tag VIP, 30 ngày nay chưa được nhắn tin',
  'Bạn bè đã xem nhưng chưa trả lời tin nhắn gần nhất',
  'Bạn bè nữ có sinh nhật trong tháng 12'
]

/** Chữ khác nhau theo mục đích; phần còn lại của cửa sổ giống nhau. */
const COPY = {
  data_group: {
    title: 'Thêm nhóm data bằng Agent', subtitle: 'Agent lập bộ lọc bạn bè Zalo từ mô tả của bạn',
    welcome: 'Bạn muốn lấy những bạn bè nào?', placeholder: 'Mô tả nhóm bạn bè bạn muốn lấy…', inputLabel: 'Mô tả nhóm data',
    goFilter: 'Xem bộ lọc và tạo nhóm', empty: 'Chưa có điều kiện nào. Hãy mô tả nhóm bạn bè ở khung hội thoại.'
  },
  campaign_recipients: {
    title: 'Agent chọn bạn bè', subtitle: 'Agent lập bộ lọc từ mô tả của bạn',
    welcome: 'Bạn muốn gửi cho những bạn bè nào?', placeholder: 'Mô tả bạn bè bạn muốn gửi…', inputLabel: 'Mô tả bạn bè muốn gửi',
    goFilter: 'Xem bộ lọc và thêm vào danh sách', empty: 'Chưa có điều kiện nào. Hãy mô tả bạn bè muốn gửi ở khung hội thoại.'
  }
} as const
const STALE_DAYS = 7
const dayFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
const formatDay = (value: string | null | undefined) => value ? dayFormat.format(new Date(value)) : '—'
const formatDateTime = (value: string | null | undefined) => value ? timeFormat.format(new Date(value)) : '—'
const formatCount = (value: number) => value.toLocaleString('vi-VN')
const kindLabel = (kind: ZaloFriendAccount['kind']) => kind === 'server' ? 'Zalo Server' : kind === 'web' ? 'Zalo trình duyệt' : 'Zalo Desktop'

function accountOption(account: ZaloFriendAccount) {
  if (!account.available) return `${account.name} · gói hiện tại chưa dùng được`
  return account.friendCount > 0 ? `${account.name} · ${formatCount(account.friendCount)} bạn bè` : `${account.name} · chưa có danh bạ bạn bè`
}

function Turn({ turn, agent, onAnswer }: { turn: DataGroupAgentTurn; agent: DataGroupAgentController; onAnswer: (text: string) => void }) {
  return <article className={`agent-turn ${turn.role}${turn.error ? ' is-error' : ''}`}>
    <div className="agent-turn-text">{turn.text}</div>
    {!!turn.notes?.length && <ul className="dg-agent-turn-notes">{turn.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    {!!turn.assumptions?.length && <details className="dg-agent-assumptions"><summary>Mình đã giả định</summary>
      <ul>{turn.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {!!turn.questions?.length && <div className="dg-agent-questions">{turn.questions.map((question, index) => <div key={index} className="dg-agent-question">
      <p>{question.text}</p>
      {!!question.options.length && <div className="dg-agent-question-options">{question.options.map(option => <button key={option} type="button"
        disabled={agent.busy} onClick={() => onAnswer(option)}>{option}</button>)}</div>}
    </div>)}</div>}
  </article>
}

/** Hỏi lại ngay trong cửa sổ (phủ cả cửa sổ, kể cả nút Đóng ở đầu); Escape = Ở lại. */
function ConfirmLayer({ message, onCancel, onConfirm }: { message: string; onCancel: () => void; onConfirm: () => void }) {
  const stay = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()
  useEffect(() => { stay.current?.focus() }, [])
  return <div className="dg-agent-confirm-layer" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
  }}>
    <div className="dg-agent-confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
      <h3 id={titleId}>Bỏ cuộc trò chuyện?</h3>
      <p id={messageId}>{message}</p>
      <div className="dg-agent-confirm-actions">
        <button ref={stay} type="button" className="btn btn-secondary" onClick={onCancel}>Ở lại</button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>Đồng ý</button>
      </div>
    </div>
  </div>
}

function FilterPanel({ agent, onEdit, onCreate }: { agent: DataGroupAgentController; onEdit: () => void; onCreate: () => void }) {
  const result = agent.preview.result
  const confirmed = agent.status === 'confirm' && !!agent.filter
  const recipients = agent.purpose === 'campaign_recipients'
  return <section className="dg-agent-filter" aria-label="Bộ lọc hiện tại">
    <div className="dg-agent-filter-scroll">
      <h3>Bộ lọc hiện tại</h3>
      {agent.summaryLines.length ? <ul className="dg-agent-summary">
        {agent.summaryLines.map((line, index) => <li key={index} className={line.level === 1 ? 'is-nested' : undefined}>{line.text}</li>)}
      </ul> : <p className="dg-agent-empty">{COPY[agent.purpose].empty}</p>}
      {confirmed && <div className="dg-agent-preview" aria-live="polite">
        {agent.preview.loading && <p className="dg-agent-count" role="status"><RefreshCw size={14} className="spin" aria-hidden="true" /> Đang đếm bạn bè khớp…</p>}
        {agent.preview.error && <div className="dg-agent-preview-error" role="alert"><span>{agent.preview.error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void agent.recount()}>Đếm lại</button></div>}
        {result && <>
          <p className="dg-agent-count"><strong>Khớp {formatCount(result.matched)}</strong> / {formatCount(result.totalFriends)} bạn bè
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void agent.recount()}>
              <RefreshCw size={13} aria-hidden="true" /> Đếm lại</button></p>
          {!!result.notes.length && <ul className="dg-agent-notes">{result.notes.map(note => <li key={note.code}>{FRIEND_FILTER_NOTE_LABELS[note.code](note.count)}</li>)}</ul>}
          {result.matched === 0 && <p className="dg-agent-zero">Không có bạn bè nào khớp. Hãy nói với Agent để nới điều kiện.</p>}
          {recipients && result.matched > 5000 && <p className="dg-agent-zero">Mỗi lần thêm được tối đa 5.000 người. Hãy thu hẹp điều kiện hoặc nói với Agent "lấy tối đa N người".</p>}
          {!!result.rows?.length && <details className="dg-agent-sample"><summary>Xem {formatCount(result.rows.length)} người đầu</summary>
            <div className="dg-agent-sample-scroll"><table>
              <thead><tr><th scope="col">Tên</th><th scope="col">Tag Zalo</th><th scope="col">Lần nhắn gần nhất</th><th scope="col">Tin gần nhất</th></tr></thead>
              <tbody>{result.rows.map(row => <tr key={row.contactId}>
                <td>{row.name || row.zaloOriginalName || '—'}</td>
                <td>{row.zaloTags.map(tag => tag.name).join(', ') || '—'}</td>
                <td>{row.lastSentAt ? formatDateTime(row.lastSentAt) : 'Chưa nhắn'}</td>
                <td>{MESSAGE_STAGE_LABELS[row.latestStage]}</td>
              </tr>)}</tbody>
            </table></div>
            {result.coverage.factsFrom && <small className="dg-agent-facts">Số liệu tin nhắn tính từ {formatDay(result.coverage.factsFrom)}.</small>}
          </details>}
        </>}
      </div>}
    </div>
    {/* Chân cố định: tên nhóm và nút Tạo nhóm luôn trong tầm nhìn kể cả khi mở bảng mẫu. */}
    {confirmed && <div className="dg-agent-filter-footer">
      {recipients
        ? <p className="dg-agent-footer-note">{result ? `${formatCount(result.matched)} người này` : 'Người khớp'} được thêm vào danh sách data của chiến dịch. Data đã có trong danh sách được bỏ qua.</p>
        : <label className="dg-agent-name"><span>Tên nhóm data</span>
          <input value={agent.groupName} maxLength={255} onChange={event => agent.setGroupName(event.target.value)} disabled={agent.creating}
            aria-label="Tên nhóm data" placeholder="Ví dụ: Khách VIP lâu chưa nhắn" /></label>}
      {agent.createError && <p className="dg-agent-create-error" role="alert">{agent.createError}</p>}
      <div className="dg-agent-actions">
        <button type="button" className="btn btn-secondary" onClick={onEdit} disabled={agent.creating}>Sửa tiếp</button>
        {recipients
          ? <button type="button" className="btn btn-primary" onClick={onCreate} disabled={!agent.canCreate || (result?.matched ?? 0) > 5000}>
            {agent.creating ? 'Đang lấy danh sách…' : result ? `Thêm ${formatCount(result.matched)} bạn bè vào danh sách` : 'Thêm vào danh sách'}</button>
          : <button type="button" className="btn btn-primary" onClick={onCreate} disabled={!agent.canCreate}>
            {agent.creating ? 'Đang tạo nhóm…' : result ? `Tạo nhóm ${formatCount(result.matched)} bạn bè` : 'Tạo nhóm'}</button>}
      </div>
    </div>}
  </section>
}

export interface FriendRecipientsAdded {
  result: ZaloFriendRecipientsResult
  accountName: string
  /** Phần điều kiện của bản tóm tắt trên một dòng (ghi chú nguồn của form). */
  conditions: string
}

export default function DataGroupAgentDialog({ scope, onClose, onCreated, onOpenScan, purpose = 'data_group', accountIds, onRecipients }: {
  /** Đổi khi phiên đổi: bỏ hội thoại và tải lại danh sách tài khoản. */
  scope: string
  onClose: () => void
  /** `data_group`: đã tạo nhóm. */
  onCreated?: (result: CreateDataGroupFromFriendFilterResult, name: string) => void
  /** Mở chỗ lấy danh bạ bạn bè (cửa sổ này đóng lại). Không truyền thì chỉ có dòng nhắc. */
  onOpenScan?: () => void
  purpose?: DataGroupAgentPurpose
  /** `campaign_recipients`: tài khoản đang chọn trong form. */
  accountIds?: readonly number[]
  /** `campaign_recipients`: danh sách đã lấy xong; form thêm vào danh sách data rồi đóng cửa sổ. */
  onRecipients?: (added: FriendRecipientsAdded) => void
}) {
  const agent = useDataGroupAgent(scope, { purpose, accountIds })
  const recipients = purpose === 'campaign_recipients'
  const copy = COPY[purpose]
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<{ message: string; action: () => void; returnFocus: Element | null } | null>(null)
  const [view, setView] = useState<'chat' | 'filter'>('chat')
  const input = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const account = agent.account
  const noFriends = !!account && account.available && account.friendCount === 0
  const stale = !!account?.friendsUpdatedAt && Date.now() - Date.parse(account.friendsUpdatedAt) > STALE_DAYS * 86_400_000
  const lockedAccount = recipients && (agent.accounts?.length ?? 0) <= 1
  const inputDisabled = !account || !account.available || noFriends || agent.creating
  const canSend = !inputDisabled && !agent.busy && !!draft.trim()

  useEffect(() => { scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight }) }, [agent.turns.length, agent.busy])

  const send = (text = draft) => {
    if (!text.trim() || agent.busy || inputDisabled) return
    void agent.send(text)
    setDraft('')
  }
  const confirmLose = (message: string, action: () => void) => {
    if (!agent.turns.length) { action(); return }
    setPending(current => ({ message, action, returnFocus: current?.returnFocus ?? document.activeElement }))
  }
  const cancelPending = () => {
    const target = pending?.returnFocus
    setPending(null)
    if (target instanceof HTMLElement && target.isConnected) queueMicrotask(() => target.focus({ preventScroll: true }))
  }
  const confirmPending = () => {
    const action = pending?.action
    setPending(null)
    action?.()
  }
  const close = () => { if (!agent.creating) confirmLose('Đóng cửa sổ sẽ mất cuộc trò chuyện với Agent.', onClose) }
  const create = async () => {
    if (recipients) {
      const result = await agent.addRecipients()
      if (result && account) onRecipients?.({ result, accountName: account.name, conditions: friendFilterConditionsText(agent.summaryLines, account.name) })
      return
    }
    const name = agent.groupName.trim()
    const result = await agent.create()
    if (result) onCreated?.(result, name)
  }

  return <DataGroupFormDialog title={copy.title} subtitle={copy.subtitle}
    icon={<Sparkles size={20} />} busy={agent.creating} onClose={close} className="dg-agent-modal">
    <div className="dg-agent-content" inert={pending ? true : undefined}>
      <div className={`dg-agent-setup${recipients ? ' is-single' : ''}`}>
        {!recipients && <label><span>Loại dữ liệu</span><select aria-label="Loại dữ liệu" value="zalo_friends" disabled>
          <option value="zalo_friends">Bạn bè Zalo</option></select></label>}
        <label><span>Tài khoản Zalo</span>
          <select aria-label="Tài khoản Zalo" value={agent.accountId ?? ''} disabled={agent.accounts === null || agent.creating || lockedAccount}
            onChange={event => {
              const id = event.target.value ? Number(event.target.value) : null
              confirmLose('Đổi tài khoản sẽ bắt đầu cuộc trò chuyện mới (tag và chiến dịch là của tài khoản cũ).', () => agent.changeAccount(id))
            }}>
            {agent.accounts === null && <option value="">Đang tải tài khoản…</option>}
            {agent.accounts?.length === 0 && <option value="">Chưa có tài khoản Zalo</option>}
            {agent.accounts?.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{accountOption(item)}</option>)}
          </select></label>
      </div>
      {agent.accountsError && <p className="dg-agent-banner is-error" role="alert">{agent.accountsError}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void agent.reloadAccounts()}>Thử lại</button></p>}
      {account && <p className="dg-agent-banner">
        <Users size={14} aria-hidden="true" />
        <span className="dg-agent-banner-text">{kindLabel(account.kind)} · {account.friendCount > 0 ? `${formatCount(account.friendCount)} bạn bè, danh bạ cập nhật ${formatDateTime(account.friendsUpdatedAt)}` : 'Chưa có danh bạ bạn bè'}
          {(noFriends || stale) && <span className="dg-agent-banner-warn">{noFriends
            ? ' Hãy quét danh bạ bạn bè Zalo của tài khoản này trước khi lọc.'
            : ` Danh bạ đã cũ hơn ${STALE_DAYS} ngày, nên quét lại để số liệu đúng hơn.`}</span>}</span>
        {lockedAccount && <span className="dg-agent-banner-lock"><Lock size={13} aria-hidden="true" /> Tài khoản của chiến dịch</span>}
        {(noFriends || stale) && onOpenScan && <button type="button" className="btn btn-secondary btn-sm"
          onClick={() => confirmLose('Mở màn quét bạn bè sẽ đóng cửa sổ này.', onOpenScan)}>
          <RefreshCw size={13} aria-hidden="true" /> {noFriends ? 'Quét bạn bè Zalo' : 'Quét lại bạn bè'}</button>}
      </p>}
      {recipients && (agent.accounts?.length ?? 0) > 1 && <p className="dg-agent-banner is-note" role="note">
        Chiến dịch đang chọn {agent.accounts!.length} tài khoản; ô trên chỉ liệt kê các tài khoản này. Bộ lọc tính theo bạn bè, tag và lịch sử nhắn của riêng tài khoản đang chọn ở ô trên; muốn lấy thêm bạn bè của tài khoản khác, hãy bấm "Agent chọn bạn bè" lần nữa.</p>}
      <div className="dg-agent-tabs" role="tablist" aria-label="Khung của cửa sổ Agent">
        <button type="button" role="tab" aria-selected={view === 'chat'} onClick={() => setView('chat')}>Hội thoại</button>
        <button type="button" role="tab" aria-selected={view === 'filter'} onClick={() => setView('filter')}>Bộ lọc{agent.status === 'confirm' ? ' · sẵn sàng' : ''}</button>
      </div>
      <div className={`dg-agent-body is-${view}`}>
        <section className="dg-agent-chat" aria-label="Hội thoại với Agent">
          <div className="agent-chat-messages" ref={scroller} role="log" aria-live="polite" aria-relevant="additions text">
            {!agent.turns.length && <div className="agent-chat-welcome dg-agent-welcome"><Sparkles size={26} aria-hidden="true" />
              <h3>{copy.welcome}</h3>
              <p>Ví dụ: tag Zalo, giới tính, sinh nhật, đã/chưa được nhắn, đã xem hay phản hồi tin nhắn, đã nhận chiến dịch nào.</p>
              <div className="agent-suggestions">{SUGGESTIONS.map(item => <button type="button" key={item} disabled={inputDisabled || agent.busy}
                onClick={() => send(item)}>{item}</button>)}</div></div>}
            {agent.turns.map(turn => <Turn key={turn.id} turn={turn} agent={agent} onAnswer={send} />)}
            {agent.busy && <div className="agent-working" role="status"><RefreshCw size={14} className="spin" aria-hidden="true" /> Agent đang đọc mô tả…</div>}
            {agent.status === 'confirm' && !agent.busy && <button type="button" className="btn btn-secondary btn-sm dg-agent-go-filter"
              onClick={() => setView('filter')}>{copy.goFilter}</button>}
          </div>
          <div className="agent-chat-composer">
            <div className="agent-input-box">
              <textarea ref={input} value={draft} maxLength={DATA_GROUP_AGENT_MAX_MESSAGE} rows={2} aria-label={copy.inputLabel}
                placeholder={agent.turns.length ? 'Trả lời hoặc mô tả thêm…' : copy.placeholder} disabled={inputDisabled}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) send() }
                }} />
              <div className="dg-agent-input-actions">
                {!!agent.turns.length && <button type="button" className="btn btn-ghost btn-sm" disabled={agent.creating}
                  onClick={() => confirmLose('Bắt đầu lại sẽ xoá cuộc trò chuyện hiện tại.', agent.reset)}>Bắt đầu lại</button>}
                {agent.busy
                  ? <button type="button" className="btn btn-secondary btn-sm" onClick={agent.stop}><Square size={13} aria-hidden="true" /> Dừng</button>
                  : <button type="button" className="btn btn-secondary btn-sm" disabled={!canSend} onClick={() => send()} aria-label="Gửi mô tả">
                    <Send size={13} aria-hidden="true" /> Gửi</button>}
              </div>
            </div>
            <small className="agent-input-hint">Enter để gửi · Shift+Enter xuống dòng · Không gửi tên, số điện thoại của khách cho AI</small>
          </div>
        </section>
        <FilterPanel agent={agent} onEdit={() => { setView('chat'); input.current?.focus() }} onCreate={() => void create()} />
      </div>
    </div>
    {pending && <ConfirmLayer message={pending.message} onCancel={cancelPending} onConfirm={confirmPending} />}
  </DataGroupFormDialog>
}
