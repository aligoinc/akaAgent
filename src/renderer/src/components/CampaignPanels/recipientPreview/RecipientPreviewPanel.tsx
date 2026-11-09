import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Eye, Info, LayoutGrid, Pencil, RefreshCw, Shuffle, TextCursorInput, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  FRIEND_REQUEST_MAX_LENGTH,
  RECIPIENT_SAMPLE,
  analyzeRecipientPreview,
  recipientPreviewChannel,
  recipientPreviewNotes,
  recipientPreviewScreens,
  recipientVersionForRow,
  renderRecipientFriendRequest,
  renderRecipientMessage,
  type RecipientScreen,
  type RecipientViewMode,
  type RecipientWarning,
} from '../../../../../shared/recipientPreview'
import { listContentSpinOptions } from '../../../../../shared/contentSpin'
import { formattedContentToPlainText } from '../../../../../shared/formattedContent'
import { VOICE_CALL_MAX_TTS_INPUT_CHARS } from '../../../../../shared/voiceCall'
import { RecipientPhone } from './RecipientPhone'
import { recipientMediaSummary } from './RecipientBubbles'
import { RecipientPreviewGallery } from './RecipientPreviewGallery'
import {
  DEFAULT_RECIPIENT_VIEW,
  MAX_RECIPIENT_ROW_OPTIONS,
  recipientChannelLabel,
  recipientIsStranger,
  recipientRenderContext,
  recipientRowLabel,
  recipientScreenLabel,
  recipientSequenceLabel,
  recipientShareMode,
  recipientVersionLabel,
  type RecipientCaretStore,
  type RecipientPreviewFocus,
  type RecipientPreviewInput,
  type RecipientViewState,
} from './recipientPreviewModel'
import type { CampaignContentStore } from '../useCampaignContentFormData'
import './RecipientPreview.css'

/** Theo dõi media query (cửa sổ app có thể thu hẹp); không hẹn giờ, chỉ nghe sự kiện `change`. */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((listener: () => void) => {
    const list = window.matchMedia(query)
    list.addEventListener('change', listener)
    return () => list.removeEventListener('change', listener)
  }, [query])
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot)
}

const GENDERS = [['female', 'Nữ'], ['male', 'Nam'], ['unknown', 'Không rõ']] as const
const WARNING_PREVIEW_COUNT = 3

interface RecipientPreviewPanelProps {
  input: RecipientPreviewInput
  /** Nút Xem trước hoặc nút Sửa của form yêu cầu hiện một màn/phiên bản. */
  focus?: RecipientPreviewFocus | null
  /** Con trỏ trong ô nội dung thường đang ở phiên bản nào (khung đi theo khi bật). */
  caret?: { version: number; nonce: number } | null
  /** Theo con trỏ chỉ có ở ô nội dung thường của chế độ Cơ bản. */
  followAvailable: boolean
  busy?: boolean
  /** dock: cột cạnh form; overlay: lớp nổi trong form (form Agent); drawer: ngăn kéo cạnh hộp Sửa nhanh. Dưới 760 px luôn toàn màn. */
  layout: 'dock' | 'overlay' | 'drawer'
  onJump: (target: RecipientWarning['target']) => void
  onClose: () => void
}

export function RecipientPreviewPanel({ input, focus, caret, followAvailable, busy = false, layout, onJump, onClose }: RecipientPreviewPanelProps) {
  const deferred = useDeferredValue(input)
  const [today] = useState(() => new Date())
  const narrow = useMediaQuery('(max-width: 1279px)')
  const titleId = useId()
  const modeId = useId()
  const senderSelectId = useId()
  const channel = recipientPreviewChannel(deferred.source.actionCode)
  const share = recipientShareMode(deferred.source)
  const screens = useMemo(() => recipientPreviewScreens(deferred.source), [deferred.source])
  const [screen, setScreen] = useState<RecipientScreen>('message')
  const [versionByScreen, setVersionByScreen] = useState<Record<RecipientScreen, number>>({ message: 0, friend_request: 0 })
  const [view, setView] = useState<RecipientViewState>(DEFAULT_RECIPIENT_VIEW)
  const [follow, setFollow] = useState(true)
  const [senderId, setSenderId] = useState<number | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [spinListOpen, setSpinListOpen] = useState(false)
  const [showAllWarnings, setShowAllWarnings] = useState(false)

  const focusNonce = focus?.nonce
  useEffect(() => {
    if (!focus) return
    setScreen(focus.screen)
    if (focus.version !== undefined) setVersionByScreen((current) => ({ ...current, [focus.screen]: focus.version! }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])
  const caretNonce = caret?.nonce
  useEffect(() => {
    // Bật lại "Theo con trỏ" thì nhảy ngay tới phiên bản đang soạn.
    if (!caret || !follow || !followAvailable) return
    setScreen('message')
    setVersionByScreen((current) => current.message === caret.version ? current : { ...current, message: caret.version })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretNonce, follow, followAvailable])

  const activeScreen: RecipientScreen = screens.some((item) => item.screen === screen) ? screen : screens[0]?.screen || 'message'
  const model = screens.find((item) => item.screen === activeScreen)
  const versions = model?.versions || []
  const versionIndex = versions.length ? Math.min(Math.max(versionByScreen[activeScreen] || 0, 0), versions.length - 1) : 0
  const version = versions[versionIndex]
  const rows = deferred.rows
  const rowMode = view.mode === 'row' && Boolean(rows[view.rowIndex]) && !share
  const mode: RecipientViewMode = share ? 'sample' : view.mode === 'row' && !rowMode ? 'sample' : view.mode
  const hasNameToken = /#\{(?:FULL_NAME|ORIGINAL_NAME)\}/.test(version?.raw || '')
  const longName = activeScreen === 'friend_request' && mode === 'sample' && view.longName && hasNameToken
  const ctx = useMemo(
    () => recipientRenderContext(deferred, { ...view, mode, longName }, today),
    [deferred, view, mode, longName, today],
  )
  const message = useMemo(() => activeScreen === 'message' && version ? renderRecipientMessage(version, ctx) : null, [activeScreen, version, ctx])
  const friend = useMemo(() => activeScreen === 'friend_request' && version ? renderRecipientFriendRequest(version, ctx) : null, [activeScreen, version, ctx])
  const sampleCtx = useMemo(() => recipientRenderContext(deferred, DEFAULT_RECIPIENT_VIEW, today), [deferred, today])
  const warnings = useMemo(() => analyzeRecipientPreview({
    source: deferred.source,
    screens,
    rows: deferred.rows,
    zaloWebSenders: deferred.senders.filter((sender) => sender.zaloWeb).length,
    ctx: sampleCtx,
  }), [deferred, screens, sampleCtx])
  const notes = useMemo(() => recipientPreviewNotes({ source: deferred.source, screens, liveSource: deferred.liveSource }), [deferred, screens])
  const spinList = useMemo(() => spinListOpen && version
    ? listContentSpinOptions(version.formatted ? formattedContentToPlainText(version.raw) : version.raw, 200)
    : [], [spinListOpen, version])

  if (!channel || screens.length === 0) return null

  const sender = deferred.senders.find((item) => item.id === senderId) || deferred.senders[0]
  const senderName = sender?.name || 'Tài khoản của bạn'
  const groupName = rowMode ? String(rows[view.rowIndex]?.name || '').trim() || RECIPIENT_SAMPLE.groupName : RECIPIENT_SAMPLE.groupName
  const rowVersion = rowMode ? recipientVersionForRow({ channel, share, rowIndex: view.rowIndex, versionCount: versions.length }) : null
  const visibleWarnings = showAllWarnings ? warnings : warnings.slice(0, WARNING_PREVIEW_COUNT)
  const mobile = channel === 'sms' || channel === 'voice'

  const selectVersion = (target: RecipientScreen, index: number) => {
    setScreen(target)
    setVersionByScreen((current) => ({ ...current, [target]: index }))
  }
  const move = (delta: number) => {
    if (!versions.length) return
    selectVersion(activeScreen, (versionIndex + delta + versions.length) % versions.length)
    if (activeScreen === 'message') setFollow(false)
  }
  const jump = (target: RecipientWarning['target']) => {
    if (target.version !== undefined) selectVersion(target.screen, target.version)
    else setScreen(target.screen)
    if (target.screen === 'message') setFollow(false)
    onJump(target)
  }
  const changeMode = (value: string) => {
    if (!value.startsWith('row:')) {
      setView((current) => ({ ...current, mode: value as RecipientViewMode }))
      return
    }
    const rowIndex = Number(value.slice(4)) || 0
    setView((current) => ({ ...current, mode: 'row', rowIndex }))
    const next: Partial<Record<RecipientScreen, number>> = {}
    for (const item of screens) {
      const mapped = recipientVersionForRow({ channel, share, rowIndex, versionCount: item.versions.length })
      if (mapped !== null) next[item.screen] = mapped
    }
    setVersionByScreen((current) => ({ ...current, ...next }))
    setFollow(false)
  }

  const meta = activeScreen === 'friend_request'
    ? friend?.length === null || !friend
      ? 'Độ dài biết khi có tên Zalo của khách'
      : `${friend.length}/${FRIEND_REQUEST_MAX_LENGTH} ký tự sau khi điền${friend.cut ? ' · bị cắt' : ''}`
    : !message ? ''
      : channel === 'sms'
        ? `${message.chars.toLocaleString('vi-VN')} ký tự · ${message.smsSegments || 0} tin · ${message.smsUnicode ? 'Unicode có dấu' : 'không dấu'}`
        : channel === 'voice'
          ? `${message.chars.toLocaleString('vi-VN')}/${VOICE_CALL_MAX_TTS_INPUT_CHARS.toLocaleString('vi-VN')} ký tự kể cả thông báo AI`
          : `${message.chars.toLocaleString('vi-VN')} ký tự${message.media.length ? ` · ${recipientMediaSummary(message.media)}` : ''}`
  const sequenceText = message ? recipientSequenceLabel(message.sequence, message.media.length, share) : ''
  const randomPool = activeScreen === 'message' && version?.media.option === 'random' ? version.media.pool.length : 0

  return <aside
    className={`rp-panel is-${layout}`}
    aria-labelledby={titleId}
    onKeyDown={(event) => {
      if (event.key !== 'Escape' || galleryOpen || (!narrow && layout === 'dock')) return
      // Không để Esc đi tiếp tới form (bước Quy trình đóng form khi nhận Esc).
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }}
  >
    <div className="rp-head">
      <button type="button" className="rp-back" onClick={onClose}><ChevronLeft size={16} aria-hidden="true" />Về form</button>
      <h2 id={titleId}>Khách sẽ nhận</h2>
      <span className={`rp-channel is-${channel}`}>{recipientChannelLabel(channel, share)}</span>
      <button type="button" className="rp-icon-button rp-close" aria-label="Đóng khung xem trước" onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </div>

    {screens.length > 1 && <div className="rp-steps" role="group" aria-label="Theo thứ tự khách nhận">
      {screens.map((item, index) => <button
        key={item.screen}
        type="button"
        className={item.screen === activeScreen ? 'is-active' : ''}
        aria-pressed={item.screen === activeScreen}
        onClick={() => setScreen(item.screen)}
      >
        <span className="rp-step-number">{index + 1}</span>
        <span className="rp-step-label">{recipientScreenLabel(item.screen, channel)}</span>
        <span className="rp-step-count">{item.versions.length}</span>
      </button>)}
    </div>}

    <div className="rp-controls">
      {share
        ? <p className="rp-hint">Gửi dạng chia sẻ không điền biến: mọi người trong lượt nhận cùng một nội dung.</p>
        : <div className="rp-control-row">
          <label htmlFor={modeId}>Xem như</label>
          <select id={modeId} value={rowMode ? `row:${view.rowIndex}` : mode} onChange={(event) => changeMode(event.target.value)}>
            <option value="sample">Khách mẫu</option>
            <option value="raw">Giữ nguyên biến</option>
            {rows.slice(0, MAX_RECIPIENT_ROW_OPTIONS).map((row, index) => <option key={index} value={`row:${index}`}>{recipientRowLabel(row, index)}</option>)}
          </select>
        </div>}
      {!share && mode === 'sample' && channel === 'zalo' && <div className="rp-control-row">
        <span id={`${modeId}-gender`}>Giới tính</span>
        <div className="rp-segmented" role="group" aria-labelledby={`${modeId}-gender`}>
          {GENDERS.map(([value, label]) => <button key={value} type="button" aria-pressed={view.gender === value} className={view.gender === value ? 'is-active' : ''} onClick={() => setView((current) => ({ ...current, gender: value }))}>{label}</button>)}
        </div>
      </div>}
      {rowMode && <p className="rp-hint is-accent">{rowVersion === null
        ? 'Chia sẻ theo lượt: cả lượt nhận cùng một nội dung.'
        : channel === 'sms'
          ? `Dòng ${view.rowIndex + 1} nhận ${recipientVersionLabel('message', rowVersion)}, cố định khi thêm data.`
          : `Dòng ${view.rowIndex + 1} nhận ${recipientVersionLabel(activeScreen, rowVersion)} ở lần gửi đầu${deferred.savedRows ? ' (dự kiến cho dòng chưa gửi)' : ''}.`}
      {channel === 'zalo' && ' Tên Zalo và xưng hô được điền lúc gửi.'}</p>}
      {!rowMode && deferred.liveSource && !share && <p className="rp-hint">Khách được lấy khi chạy, nên dùng khách mẫu.</p>}
      {activeScreen === 'friend_request' && mode === 'sample' && hasNameToken && <label className="rp-check">
        <input type="checkbox" checked={view.longName} onChange={(event) => setView((current) => ({ ...current, longName: event.target.checked }))} />
        <span>Thử với tên Zalo dài ({RECIPIENT_SAMPLE.longDisplayName.length} ký tự)</span>
      </label>}
      {deferred.senders.length > 1 && <div className="rp-control-row">
        <label htmlFor={senderSelectId}>Gửi từ</label>
        <select id={senderSelectId} value={sender?.id ?? ''} onChange={(event) => setSenderId(Number(event.target.value) || null)}>
          {deferred.senders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>}
    </div>

    <RecipientPhone
      channel={channel}
      screen={activeScreen}
      senderName={senderName}
      senderPhone={mobile ? sender?.phone : null}
      groupName={groupName}
      stranger={recipientIsStranger(deferred.source) && !share}
      message={message}
      friend={friend}
    />
    {(sequenceText || activeScreen === 'friend_request') && <p className="rp-caption-line">{activeScreen === 'friend_request'
      ? `Lời nhắn hiện trên màn Lời mời kết bạn, tối đa ${FRIEND_REQUEST_MAX_LENGTH} ký tự.`
      : sequenceText}</p>}

    <div className="rp-nav">
      <div className="rp-pager">
        <button type="button" className="rp-icon-button" aria-label="Phiên bản trước" onClick={() => move(-1)} disabled={versions.length < 2}><ChevronLeft size={16} aria-hidden="true" /></button>
        <span>{recipientVersionLabel(activeScreen, versionIndex)} / {versions.length}</span>
        <button type="button" className="rp-icon-button" aria-label="Phiên bản sau" onClick={() => move(1)} disabled={versions.length < 2}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <button type="button" className="rp-button" onClick={() => setGalleryOpen(true)}><LayoutGrid size={14} aria-hidden="true" />Xem tất cả</button>
    </div>
    <div className="rp-meta-row">
      <span>{meta}</span>
      <button type="button" className="rp-link-button" disabled={busy} onClick={() => jump({ section: activeScreen === 'message' ? 'content' : 'actionOptions', screen: activeScreen, version: versionIndex })}><Pencil size={13} aria-hidden="true" />Sửa</button>
    </div>
    <div className="rp-chip-row">
      {activeScreen === 'message' && followAvailable && <button type="button" className="rp-chip" aria-pressed={follow} onClick={() => setFollow((current) => !current)}>
        <TextCursorInput size={13} aria-hidden="true" />Theo con trỏ: {follow ? 'bật' : 'tắt'}
      </button>}
      {(version?.spinOptions || 0) > 1 && <button type="button" className="rp-chip" onClick={() => setView((current) => ({ ...current, seed: current.seed + 1 }))}>
        <Shuffle size={13} aria-hidden="true" />Đổi cách trộn · {version!.spinOptions > 10_000 ? 'hơn 10.000' : version!.spinOptions.toLocaleString('vi-VN')} cách viết
      </button>}
      {(version?.spinOptions || 0) > 1 && <button type="button" className="rp-chip" aria-expanded={spinListOpen} onClick={() => setSpinListOpen((current) => !current)}>{spinListOpen ? 'Ẩn các cách viết' : 'Xem các cách viết'}</button>}
      {randomPool > 1 && <button type="button" className="rp-chip" onClick={() => setView((current) => ({ ...current, mediaSeed: current.mediaSeed + 1 }))}>
        <RefreshCw size={13} aria-hidden="true" />Đổi media · ngẫu nhiên {Math.min(version!.media.randomCount, randomPool)} trong {randomPool}
      </button>}
    </div>
    {spinListOpen && spinList.length > 0 && <ol className="rp-spin-list" aria-label="Các cách viết">
      {spinList.map((item, index) => <li key={index}>{item}</li>)}
      {(version?.spinOptions || 0) > spinList.length && <li className="rp-spin-more">… còn {((version?.spinOptions || 0) > 10_000 ? 'hơn 10.000' : ((version?.spinOptions || 0) - spinList.length).toLocaleString('vi-VN'))} cách khác</li>}
    </ol>}

    <section className="rp-section" aria-label="Cần kiểm tra">
      <h3>{warnings.some((item) => item.level === 'warn')
        ? <AlertTriangle size={14} className="rp-icon-warn" aria-hidden="true" />
        : <CheckCircle2 size={14} className="rp-icon-ok" aria-hidden="true" />}
      Cần kiểm tra <span className="rp-count">{warnings.length}</span></h3>
      {warnings.length === 0 && <p className="rp-ok">Không có gì cần kiểm tra.</p>}
      {visibleWarnings.map((item, index) => <div className={`rp-warning is-${item.level}`} key={`${item.code}-${index}`}>
        {item.level === 'warn' ? <AlertTriangle size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />}
        <span>{item.text}</span>
        <button type="button" className="rp-link-button" disabled={busy} onClick={() => jump(item.target)}>Sửa</button>
      </div>)}
      {warnings.length > WARNING_PREVIEW_COUNT && <button type="button" className="rp-link-button rp-more" onClick={() => setShowAllWarnings((current) => !current)}>
        {showAllWarnings ? 'Thu gọn' : `Xem thêm ${warnings.length - WARNING_PREVIEW_COUNT}`}
      </button>}
    </section>

    {notes.length > 0 && <section className="rp-section" aria-label="Khi chạy thật">
      <h3><Info size={14} className="rp-icon-info" aria-hidden="true" />Khi chạy thật</h3>
      <ul className="rp-notes">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </section>}

    {galleryOpen && <RecipientPreviewGallery
      input={deferred}
      screens={screens}
      ctx={ctx}
      warnings={warnings}
      initialScreen={activeScreen}
      senderName={senderName}
      senderPhone={mobile ? sender?.phone : null}
      groupName={groupName}
      stranger={recipientIsStranger(deferred.source) && !share}
      busy={busy}
      onSelect={(target, index) => { selectVersion(target, index); if (target === 'message') setFollow(false); setGalleryOpen(false) }}
      onEdit={(target) => { setGalleryOpen(false); jump(target) }}
      onClose={() => setGalleryOpen(false)}
    />}
  </aside>
}

const noCaretSubscribe = () => () => {}
const noCaret = () => null

type RecipientPreviewLiveProps = Omit<RecipientPreviewPanelProps, 'input' | 'caret'> & {
  /** Dữ liệu form, trừ nội dung chính (đọc từ `contentStore`). */
  base: RecipientPreviewInput
  contentStore: CampaignContentStore
  caretStore?: RecipientCaretStore
}

/**
 * Khung gắn vào form Desktop. Form không vẽ lại khi gõ nội dung (docs/CAMPAIGN_CONTENT_TYPING.md), nên khung tự
 * đăng ký `contentStore` như ô nội dung, và đăng ký vị trí con trỏ riêng; gõ phím chỉ vẽ lại khung này.
 */
export function RecipientPreviewLive({ base, contentStore, caretStore, ...props }: RecipientPreviewLiveProps) {
  const content = useSyncExternalStore(contentStore.subscribe, contentStore.getContent)
  const caret = useSyncExternalStore(caretStore?.subscribe || noCaretSubscribe, caretStore?.get || noCaret)
  const input = useMemo<RecipientPreviewInput>(() => ({ ...base, source: { ...base.source, content } }), [base, content])
  return <RecipientPreviewPanel {...props} input={input} caret={caret} />
}

interface RecipientPreviewToggleProps {
  shown: boolean
  contentStore: CampaignContentStore
  /** Các phần khác nội dung chính khách nhận (hành động, lời mời, nâng cao, media). */
  fingerprint: string
  onToggle: () => void
}

/**
 * Nút "Xem trước" của form Agent: khung mặc định đóng; Agent (hoặc người dùng) đổi thứ khách nhận khi khung đóng
 * thì nút có chấm báo. Tự đăng ký `contentStore` để chấm hiện ngay cả khi chỉ nội dung chính đổi.
 */
export function RecipientPreviewToggle({ shown, contentStore, fingerprint, onToggle }: RecipientPreviewToggleProps) {
  const content = useSyncExternalStore(contentStore.subscribe, contentStore.getContent)
  const current = `${fingerprint}\u0000${content}`
  const seen = useRef<string | null>(null)
  if (seen.current === null) seen.current = current
  useEffect(() => { if (shown) seen.current = current }, [shown, current])
  const changed = !shown && seen.current !== current
  return <button type="button" className="rp-toggle" aria-label={`Xem trước khách sẽ nhận${changed ? ', có thay đổi chưa xem' : ''}`} aria-pressed={shown} onClick={onToggle}>
    <Eye size={15} aria-hidden="true" />Xem trước{changed && <span className="rp-toggle-dot" aria-hidden="true" />}
  </button>
}
