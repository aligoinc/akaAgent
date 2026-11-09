import { AlertTriangle, ChevronLeft, ChevronRight, Info, Search } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import {
  FRIEND_REQUEST_MAX_LENGTH,
  renderRecipientFriendRequest,
  renderRecipientMessage,
  type RecipientPreviewScreenModel,
  type RecipientRenderContext,
  type RecipientRenderedFriendRequest,
  type RecipientRenderedMessage,
  type RecipientScreen,
  type RecipientTextPart,
  type RecipientVersion,
  type RecipientWarning,
} from '../../../../../shared/recipientPreview'
import { formattedContentToPlainText } from '../../../../../shared/formattedContent'
import { RecipientPhone } from './RecipientPhone'
import { recipientMediaSummary } from './RecipientBubbles'
import { recipientScreenLabel, recipientVersionLabel } from './recipientPreviewModel'

export const RECIPIENT_GALLERY_PAGE_SIZE = 24

type BrowserFilter = 'all' | 'warn' | 'media'

export interface RecipientVersionBrowserProps {
  screens: RecipientPreviewScreenModel[]
  ctx: RecipientRenderContext
  warnings: RecipientWarning[]
  initialScreen: RecipientScreen
  senderName: string
  senderPhone?: string | null
  groupName: string
  stranger: boolean
  busy?: boolean
  /** Có thì mỗi thẻ có nút "Xem trong khung". */
  onSelect?: (screen: RecipientScreen, index: number) => void
  /** Có thì mỗi thẻ có nút "Sửa". */
  onEdit?: (target: RecipientWarning['target']) => void
  /** Nằm thẳng trong trang (tab chi tiết chiến dịch): không có vùng cuộn riêng. */
  inline?: boolean
  footerAction?: ReactNode
}

interface BrowserCard {
  version: RecipientVersion
  message: RecipientRenderedMessage | null
  friend: RecipientRenderedFriendRequest | null
  warnings: RecipientWarning[]
  text: string
}

const partsText = (parts: RecipientTextPart[]) => parts.map((part) => part.text).join('')

const originLabel = (version: RecipientVersion) => {
  if (version.origin.templateName) {
    return `${version.origin.kind === 'group' ? 'Nhóm mẫu' : 'Mẫu'} “${version.origin.templateName}”${version.origin.templateVariant !== undefined ? ` · biến thể ${version.origin.templateVariant + 1}` : ''}`
  }
  return version.origin.kind === 'group' ? 'Nhóm mẫu' : version.origin.kind === 'advanced' ? 'Nâng cao' : 'Tự soạn'
}

/** Lưới thẻ "mỗi phiên bản khách có thể nhận": dùng cho lớp phủ "Xem tất cả" và tab Preview nội dung của chi tiết chiến dịch. */
export function RecipientVersionBrowser({
  screens, ctx, warnings, initialScreen, senderName, senderPhone, groupName, stranger, busy = false, onSelect, onEdit, inline = false, footerAction,
}: RecipientVersionBrowserProps) {
  const baseId = useId()
  const searchId = `${baseId}-search`
  const channel = ctx.channel
  const [screen, setScreen] = useState<RecipientScreen>(screens.some((item) => item.screen === initialScreen) ? initialScreen : screens[0]?.screen || 'message')
  const [filter, setFilter] = useState<BrowserFilter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const activeScreen: RecipientScreen = screens.some((item) => item.screen === screen) ? screen : screens[0]?.screen || 'message'
  const model = screens.find((item) => item.screen === activeScreen)

  const cards = useMemo<BrowserCard[]>(() => (model?.versions || []).map((version) => {
    const message = activeScreen === 'message' ? renderRecipientMessage(version, ctx) : null
    const friend = activeScreen === 'friend_request' ? renderRecipientFriendRequest(version, ctx) : null
    const text = friend ? partsText(friend.parts)
      : version.formatted ? formattedContentToPlainText(version.raw) : version.raw
    return {
      version,
      message,
      friend,
      warnings: warnings.filter((item) => item.target.screen === activeScreen && item.target.version === version.index),
      text,
    }
  }), [model, activeScreen, ctx, warnings])

  const normalizedQuery = query.trim().toLocaleLowerCase('vi')
  const filtered = cards.filter((card) => {
    if (filter === 'warn' && !card.warnings.length) return false
    if (filter === 'media' && !card.version.media.pool.length) return false
    return !normalizedQuery || card.text.toLocaleLowerCase('vi').includes(normalizedQuery)
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / RECIPIENT_GALLERY_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * RECIPIENT_GALLERY_PAGE_SIZE, (currentPage + 1) * RECIPIENT_GALLERY_PAGE_SIZE)
  const warnCount = cards.filter((card) => card.warnings.length).length
  const mediaCount = cards.filter((card) => card.version.media.pool.length).length
  const changeFilter = (next: BrowserFilter) => { setFilter(next); setPage(0) }
  const showMediaFilter = activeScreen === 'message' && channel !== 'sms' && channel !== 'voice' && mediaCount > 0
  // Ít phiên bản (vừa một hàng thẻ) thì không cần ô tìm.
  const showSearch = cards.length > 6

  return <div className={`rp-browser${inline ? ' is-inline' : ''}`}>
    {(screens.length > 1 || warnCount > 0 || showMediaFilter || showSearch) && <div className="rp-gallery-toolbar">
      {screens.length > 1 && <div className="rp-segmented" role="group" aria-label="Loại tin">
        {screens.map((item) => <button key={item.screen} type="button" aria-pressed={item.screen === activeScreen} className={item.screen === activeScreen ? 'is-active' : ''} onClick={() => { setScreen(item.screen); setPage(0) }}>
          {recipientScreenLabel(item.screen, channel)} · {item.versions.length}
        </button>)}
      </div>}
      {(warnCount > 0 || showMediaFilter) && <div className="rp-segmented" role="group" aria-label="Lọc">
        <button type="button" aria-pressed={filter === 'all'} className={filter === 'all' ? 'is-active' : ''} onClick={() => changeFilter('all')}>Tất cả</button>
        {warnCount > 0 && <button type="button" aria-pressed={filter === 'warn'} className={filter === 'warn' ? 'is-active' : ''} onClick={() => changeFilter('warn')}>Có cảnh báo · {warnCount}</button>}
        {showMediaFilter && <button type="button" aria-pressed={filter === 'media'} className={filter === 'media' ? 'is-active' : ''} onClick={() => changeFilter('media')}>Có media · {mediaCount}</button>}
      </div>}
      {showSearch && <div className="rp-search">
        <Search size={14} aria-hidden="true" />
        <label htmlFor={searchId} className="rp-visually-hidden">Tìm trong nội dung</label>
        {/* Lưới có thể nằm trong <form> chiến dịch: Enter ở ô tìm không được gửi form. */}
        <input id={searchId} type="search" value={query} placeholder="Tìm trong nội dung…" onChange={(event) => { setQuery(event.target.value); setPage(0) }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} />
      </div>}
    </div>}

    <div className="rp-gallery-body">
      {visible.length === 0 && <p className="rp-gallery-empty">Không có phiên bản nào khớp bộ lọc.</p>}
      <div className="rp-gallery-grid">
        {visible.map((card) => {
          const label = recipientVersionLabel(activeScreen, card.version.index)
          const headingId = `${baseId}-${activeScreen}-${card.version.index}`
          const meta = card.friend
            ? card.friend.length === null ? 'Độ dài biết khi có tên Zalo' : `${card.friend.length}/${FRIEND_REQUEST_MAX_LENGTH} ký tự${card.friend.cut ? ' · bị cắt' : ''}`
            : card.message
              ? [`${card.message.chars.toLocaleString('vi-VN')} ký tự`, card.message.smsSegments ? `${card.message.smsSegments} tin` : '', card.message.media.length ? recipientMediaSummary(card.message.media) : '',
                card.version.spinOptions > 1 ? `${card.version.spinOptions > 10_000 ? 'hơn 10.000' : card.version.spinOptions.toLocaleString('vi-VN')} cách viết` : ''].filter(Boolean).join(' · ')
              : ''
          return <article key={card.version.index} className={`rp-card${card.warnings.some((item) => item.level === 'warn') ? ' has-warning' : ''}`} aria-labelledby={headingId}>
            <div className="rp-card-head">
              <span className="rp-card-number">{card.version.index + 1}</span>
              <h3 id={headingId}>{label}</h3>
              <small>{originLabel(card.version)}</small>
            </div>
            <RecipientPhone
              compact
              channel={channel}
              screen={activeScreen}
              senderName={senderName}
              senderPhone={senderPhone}
              groupName={groupName}
              stranger={stranger}
              message={card.message}
              friend={card.friend}
            />
            <span className="rp-card-meta">{meta}</span>
            {card.warnings.map((item, index) => <p key={`${item.code}-${index}`} className={`rp-card-warning is-${item.level}`}>
              {item.level === 'warn' ? <AlertTriangle size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />}<span>{item.text}</span>
            </p>)}
            {(onSelect || onEdit) && <div className="rp-card-actions">
              {onSelect && <button type="button" className="rp-button" onClick={() => onSelect(activeScreen, card.version.index)}>Xem trong khung</button>}
              {onEdit && <button type="button" className="rp-button is-soft" disabled={busy} onClick={() => onEdit({ section: activeScreen === 'message' ? 'content' : 'actionOptions', screen: activeScreen, version: card.version.index })}>Sửa</button>}
            </div>}
          </article>
        })}
      </div>
    </div>

    <div className="rp-gallery-foot">
      <span>Hiển thị {visible.length ? currentPage * RECIPIENT_GALLERY_PAGE_SIZE + 1 : 0}–{currentPage * RECIPIENT_GALLERY_PAGE_SIZE + visible.length} / {filtered.length} phiên bản{filtered.length !== cards.length ? ` (tổng ${cards.length})` : ''}</span>
      {pageCount > 1 && <div className="rp-pager">
        <button type="button" className="rp-icon-button" aria-label="Trang trước" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
        <span>Trang {currentPage + 1} / {pageCount}</span>
        <button type="button" className="rp-icon-button" aria-label="Trang sau" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>}
      {footerAction}
    </div>
  </div>
}
