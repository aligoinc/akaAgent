import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCheck, RefreshCw, X } from 'lucide-react'
import type { NotificationEventType, NotificationListItem } from '../../../../shared/types'
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_PAGE_SIZE,
  notificationEventLabel
} from '../../../../shared/notificationCenter'
import { useUiStore } from '../../stores/uiStore'
import { useNotificationCenterStore } from '../../stores/notificationCenterStore'
import {
  formatUnreadCount,
  NotificationDetailBody,
  NotificationDetailTags,
  notificationDisplayTitle,
  useNotificationDetail,
  type NotificationReadHandler
} from '../Notifications/NotificationDetailView'
import { createNotificationTimeFormat, type NotificationTimeFormat } from './notificationTimeFormat'

/**
 * Hộp thư "Thông báo gần đây" trong Cài đặt chung (trang Thông báo đầy đủ mở từ chuông ở thanh
 * bên). Chỉ tải khi mục cài đặt mở hoặc người dùng bấm tải lại; không poll, không hẹn giờ.
 */
export default function NotificationInbox({ timezone }: { timezone: string }) {
  const showAlert = useUiStore(state => state.showAlert)
  const format = useMemo(() => createNotificationTimeFormat(timezone), [timezone])
  const [typeFilter, setTypeFilter] = useState<NotificationEventType | ''>('')
  const [reloadKey, setReloadKey] = useState(0)
  const [items, setItems] = useState<NotificationListItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [markingAll, setMarkingAll] = useState(false)
  const [openItem, setOpenItem] = useState<NotificationListItem | null>(null)
  const listRequest = useRef(0)
  const markAllLock = useRef(false)

  useEffect(() => {
    const request = ++listRequest.current
    setLoading(true)
    setError('')
    window.electronAPI.notificationCenter.list({ limit: NOTIFICATION_PAGE_SIZE, type: typeFilter || null })
      .then(result => {
        if (request !== listRequest.current) return
        if (!result.ok) {
          setError(result.message)
          return
        }
        setItems(result.data.items)
        setUnreadCount(result.data.unreadCount)
        useNotificationCenterStore.getState().setUnreadCount(result.data.unreadCount)
      })
      .catch(() => { if (request === listRequest.current) setError('Không thể tải thông báo. Vui lòng thử lại.') })
      .finally(() => { if (request === listRequest.current) setLoading(false) })
    return () => { listRequest.current++ }
  }, [typeFilter, reloadKey])

  const reload = () => setReloadKey(value => value + 1)

  const handleRead = useCallback<NotificationReadHandler>((id, readAt, count) => {
    setItems(previous => previous.map(item => (item.id === id && !item.readAt ? { ...item, readAt } : item)))
    if (count !== null) setUnreadCount(count)
  }, [])

  const markAllRead = async () => {
    // Mốc là mục đầu danh sách đang hiện (mới nhất theo thứ tự hộp thư); thông báo vào sau đó vẫn giữ chưa đọc.
    // Đang lọc theo loại thì chỉ đánh dấu loại đó.
    const upToId = items[0]?.id ?? 0
    if (markAllLock.current || upToId <= 0) return
    markAllLock.current = true
    setMarkingAll(true)
    try {
      const result = await window.electronAPI.notificationCenter.markRead(typeFilter ? { upToId, type: typeFilter } : { upToId })
      if (!result.ok) {
        showAlert(result.message, 'error')
        return
      }
      const readAt = new Date().toISOString()
      setItems(previous => previous.map(item => (!item.readAt ? { ...item, readAt } : item)))
      setUnreadCount(result.data.unreadCount)
      useNotificationCenterStore.getState().setUnreadCount(result.data.unreadCount)
    } catch {
      showAlert('Không thể đánh dấu đã đọc. Vui lòng thử lại.', 'error')
    } finally {
      markAllLock.current = false
      setMarkingAll(false)
    }
  }

  return (
    <section className="nc-card nc-inbox" aria-labelledby="nc-inbox-title">
      <div className="nc-card-head">
        <div className="nc-card-title">
          <Bell size={15} aria-hidden="true" />
          <h4 id="nc-inbox-title">Thông báo gần đây</h4>
          {unreadCount > 0 && <span className="nc-count-badge">{formatUnreadCount(unreadCount)} chưa đọc</span>}
        </div>
        <div className="nc-inbox-tools">
          <select className="stepper-input nc-select" value={typeFilter} aria-label="Lọc theo loại thông báo"
            onChange={event => setTypeFilter(event.target.value as NotificationEventType | '')}>
            <option value="">Tất cả loại</option>
            {NOTIFICATION_EVENT_TYPES.map(type => <option key={type} value={type}>{NOTIFICATION_EVENT_LABELS[type]}</option>)}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void markAllRead()}
            disabled={markingAll || unreadCount === 0 || items.length === 0}>
            <CheckCheck size={14} />
            <span>{markingAll ? 'Đang đánh dấu...' : 'Đánh dấu đã đọc tất cả'}</span>
          </button>
          <button type="button" className="btn-icon" title="Tải lại thông báo" aria-label="Tải lại thông báo" onClick={reload} disabled={loading}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="nc-empty" role="status">Đang tải...</p>
      ) : error ? (
        <div className="nc-empty">
          <span role="alert">{error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>Thử lại</button>
        </div>
      ) : items.length === 0 ? (
        <p className="nc-empty">{typeFilter ? 'Chưa có thông báo thuộc loại này.' : 'Chưa có thông báo nào.'}</p>
      ) : (
        <ul className="nc-inbox-list">
          {items.map(item => (
            <li key={item.id}>
              <button type="button" className={`nc-inbox-item severity-${item.severity} ${item.readAt ? '' : 'is-unread'}`}
                onClick={() => setOpenItem(item)}>
                <span className="nc-inbox-dot" aria-hidden="true" />
                <span className="nc-inbox-main">
                  <span className="nc-inbox-title">
                    {!item.readAt && <span className="nc-sr-only">Chưa đọc: </span>}
                    {item.title || notificationEventLabel(item.eventType)}
                  </span>
                  {item.body && <span className="nc-inbox-body">{item.body}</span>}
                </span>
                <span className="nc-inbox-meta">
                  <span className="nc-type-tag">{notificationEventLabel(item.eventType)}</span>
                  <time dateTime={item.createdAt}>{format.relative(item.createdAt)}</time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openItem && (
        <NotificationDetailModal item={openItem} format={format} onClose={() => setOpenItem(null)} onRead={handleRead} />
      )}
    </section>
  )
}

function NotificationDetailModal({ item, format, onClose, onRead }: {
  item: NotificationListItem
  format: NotificationTimeFormat
  onClose: () => void
  onRead: NotificationReadHandler
}) {
  const { detail, loading, error } = useNotificationDetail(item.id, onRead)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    const previousFocus = document.activeElement
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    // Giữ focus trong hộp thoại; không để phím Tab rơi về cửa sổ cài đặt phía sau.
    event.stopPropagation()
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex="0"]') ?? [])
      .filter(node => !node.matches(':disabled') && node.getClientRects().length > 0)
    if (controls.length === 0) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const title = notificationDisplayTitle(item, detail)

  return createPortal(
    <div className="modal-overlay nc-detail-overlay" onClick={event => { event.stopPropagation(); onClose() }}>
      <div ref={dialogRef} className="nc-detail-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={event => event.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="nc-detail-header">
          <div className="nc-detail-heading">
            <NotificationDetailTags item={item} detail={detail} format={format} />
            <h3 id={titleId}>{title}</h3>
          </div>
          <button ref={closeRef} type="button" className="btn-icon" title="Đóng" aria-label="Đóng" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="nc-detail-body">
          <NotificationDetailBody detail={detail} loading={loading} error={error} format={format} title={title} />
        </div>
      </div>
    </div>,
    document.body
  )
}
