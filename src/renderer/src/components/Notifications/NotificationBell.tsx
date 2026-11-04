import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import type { NotificationListItem } from '../../../../shared/types'
import {
  NOTIFICATION_CENTER_NOT_READY,
  NOTIFICATION_DEFAULT_TIMEZONE,
  notificationEventLabel
} from '../../../../shared/notificationCenter'
import { useNotificationCenterStore } from '../../stores/notificationCenterStore'
import { useUiStore } from '../../stores/uiStore'
import { createNotificationTimeFormat } from '../Settings/notificationTimeFormat'
import { formatUnreadCount } from './NotificationDetailView'
import '../Settings/notificationCenter.css'
import './notifications.css'

const POPOVER_LIMIT = 6

interface NotificationBellProps {
  /** Đang ở trang Thông báo: tô nút như mục đang chọn. */
  active: boolean
  onOpenAll: () => void
  onOpenNotification: (notificationId: number) => void
}

/**
 * Chuông trên thanh bên: số chưa đọc lấy từ store (không hẹn giờ), bấm mở danh sách mới nhất.
 * Máy chủ chưa có trung tâm thông báo (V457) thì ẩn hẳn chuông.
 */
export default function NotificationBell({ active, onOpenAll, onOpenNotification }: NotificationBellProps) {
  const unreadCount = useNotificationCenterStore(state => state.unreadCount)
  const available = useNotificationCenterStore(state => state.available)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (available === false) setOpen(false)
  }, [available])

  if (available === false) return null

  const badge = unreadCount && unreadCount > 0 ? formatUnreadCount(unreadCount) : null

  return (
    <div className="nc-bell" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`app-sidebar-nav-item nc-bell-button ${active || open ? 'active' : ''}`}
        onClick={() => setOpen(value => !value)}
        title="Thông báo"
        aria-label={badge ? `Thông báo, ${badge} chưa đọc` : 'Thông báo'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="app-sidebar-item-icon nc-bell-icon">
          <Bell size={18} />
          {badge && <span className="nc-bell-badge" aria-hidden="true">{badge}</span>}
        </span>
        <span className="app-sidebar-label">Thông báo</span>
      </button>
      {open && (
        <NotificationPopover
          unreadCount={unreadCount}
          onClose={() => setOpen(false)}
          onOpenAll={() => { setOpen(false); onOpenAll() }}
          onOpenNotification={id => { setOpen(false); onOpenNotification(id) }}
        />
      )}
    </div>
  )
}

function NotificationPopover({ unreadCount, onClose, onOpenAll, onOpenNotification }: {
  unreadCount: number | null
  onClose: () => void
  onOpenAll: () => void
  onOpenNotification: (id: number) => void
}) {
  const showAlert = useUiStore(state => state.showAlert)
  const format = useMemo(() => createNotificationTimeFormat(NOTIFICATION_DEFAULT_TIMEZONE), [])
  const [items, setItems] = useState<NotificationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [markingAll, setMarkingAll] = useState(false)
  const markAllLock = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Mỗi lần mở chuông đọc 1 trang ngắn; không tự tải lại khi đang mở.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    window.electronAPI.notificationCenter.list({ limit: POPOVER_LIMIT })
      .then(result => {
        if (cancelled) return
        if (!result.ok) {
          if (result.code === NOTIFICATION_CENTER_NOT_READY) {
            useNotificationCenterStore.getState().markUnavailable()
            onCloseRef.current()
            return
          }
          setError(result.message)
          return
        }
        setItems(result.data.items)
        useNotificationCenterStore.getState().setUnreadCount(result.data.unreadCount)
      })
      .catch(() => { if (!cancelled) setError('Không thể tải thông báo. Vui lòng thử lại.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  const hasUnread = (unreadCount ?? 0) > 0 || items.some(item => !item.readAt)

  const markAllRead = async () => {
    const upToId = items[0]?.id ?? 0
    if (markAllLock.current || upToId <= 0) return
    markAllLock.current = true
    setMarkingAll(true)
    try {
      const result = await window.electronAPI.notificationCenter.markRead({ upToId })
      if (!result.ok) {
        showAlert(result.message, 'error')
        return
      }
      const readAt = new Date().toISOString()
      setItems(previous => previous.map(item => (item.readAt ? item : { ...item, readAt })))
      useNotificationCenterStore.getState().setUnreadCount(result.data.unreadCount)
    } catch {
      showAlert('Không thể đánh dấu đã đọc. Vui lòng thử lại.', 'error')
    } finally {
      markAllLock.current = false
      setMarkingAll(false)
    }
  }

  return (
    <div className="nc-bell-popover" role="dialog" aria-label="Thông báo mới nhất">
      <div className="nc-bell-popover-head">
        <strong>Thông báo</strong>
        {(unreadCount ?? 0) > 0 && <span className="nc-count-badge">{formatUnreadCount(unreadCount ?? 0)} chưa đọc</span>}
        <button type="button" className="btn btn-secondary btn-sm nc-bell-mark-all" onClick={() => void markAllRead()}
          disabled={markingAll || loading || !hasUnread || items.length === 0}>
          <CheckCheck size={14} />
          <span>{markingAll ? 'Đang đánh dấu...' : 'Đánh dấu đã đọc tất cả'}</span>
        </button>
      </div>
      <div className="nc-bell-popover-body">
        {loading ? (
          <p className="nc-empty" role="status">Đang tải...</p>
        ) : error ? (
          <div className="nc-empty">
            <span role="alert">{error}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReloadKey(value => value + 1)}>Thử lại</button>
          </div>
        ) : items.length === 0 ? (
          <p className="nc-empty">Chưa có thông báo nào.</p>
        ) : (
          <ul className="nc-inbox-list" aria-label="Thông báo mới nhất">
            {items.map(item => (
              <li key={item.id}>
                <button type="button" className={`nc-inbox-item severity-${item.severity} ${item.readAt ? '' : 'is-unread'}`}
                  onClick={() => onOpenNotification(item.id)}>
                  <span className="nc-inbox-dot" aria-hidden="true" />
                  <span className="nc-inbox-main">
                    <span className="nc-inbox-title">
                      {!item.readAt && <span className="nc-sr-only">Chưa đọc: </span>}
                      {item.title || notificationEventLabel(item.eventType)}
                    </span>
                    {item.body && <span className="nc-inbox-body">{item.body}</span>}
                    <span className="nc-bell-item-meta">
                      {notificationEventLabel(item.eventType)} · <time dateTime={item.createdAt}>{format.relative(item.createdAt)}</time>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="nc-bell-popover-foot">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenAll}>Xem tất cả</button>
      </div>
    </div>
  )
}
