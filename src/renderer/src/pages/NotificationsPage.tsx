import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Bell, CheckCheck, RefreshCw } from 'lucide-react'
import type { NotificationCursor, NotificationEventType, NotificationListItem } from '../../../shared/types'
import {
  NOTIFICATION_CENTER_NOT_READY,
  NOTIFICATION_DEFAULT_TIMEZONE,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_PAGE_SIZE,
  notificationEventLabel
} from '../../../shared/notificationCenter'
import { useUiStore } from '../stores/uiStore'
import { useNotificationCenterStore } from '../stores/notificationCenterStore'
import { createNotificationTimeFormat } from '../components/Settings/notificationTimeFormat'
import {
  formatUnreadCount,
  NotificationDetailBody,
  NotificationDetailTags,
  notificationDisplayTitle,
  useNotificationDetail,
  type NotificationReadHandler
} from '../components/Notifications/NotificationDetailView'
import {
  notificationTarget,
  notificationTargetLabel,
  type NotificationTarget
} from '../components/Notifications/notificationTargets'
import { useRenewalReminderStore } from '../stores/renewalReminderStore'
import '../components/Settings/notificationCenter.css'
import '../components/Notifications/notifications.css'

/** Bộ lọc như WebApp: không có chip riêng cho "Gửi thử" (vẫn hiện trong Tất cả). */
const FILTER_TYPES: NotificationEventType[] = [
  'campaign.status_changed',
  'account.status_changed',
  'report.scheduled',
  'data_group.membership_changed'
]

export interface NotificationSelectRequest {
  notificationId: number
  requestId: number
}

interface NotificationsPageProps {
  /** Mở sẵn một thông báo (bấm từ chuông). */
  selectRequest: NotificationSelectRequest | null
  onOpenTarget: (target: NotificationTarget) => void
}

interface Selection {
  id: number
  /** Thông báo có thể chưa nằm trong trang đang tải (ví dụ đang lọc loại khác). */
  item: NotificationListItem | null
}

function mergeItems(previous: NotificationListItem[], next: NotificationListItem[]): NotificationListItem[] {
  const seen = new Set(previous.map(item => item.id))
  return [...previous, ...next.filter(item => !seen.has(item.id))]
}

/**
 * Trang Thông báo của Desktop, cùng chức năng trang /notifications của WebApp: lọc theo loại,
 * chỉ chưa đọc, tải thêm theo con trỏ, đánh dấu đã đọc tất cả, xem chi tiết và mở nhanh đối tượng.
 * Chỉ tải khi trang mở hoặc khi người dùng thao tác; không poll.
 */
export default function NotificationsPage({ selectRequest, onOpenTarget }: NotificationsPageProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const format = useMemo(() => createNotificationTimeFormat(NOTIFICATION_DEFAULT_TIMEZONE), [])
  const [typeFilter, setTypeFilter] = useState<NotificationEventType | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [items, setItems] = useState<NotificationListItem[]>([])
  const [nextCursor, setNextCursor] = useState<NotificationCursor | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [notReady, setNotReady] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const listRequest = useRef(0)
  const markAllLock = useRef(false)
  const handledSelectRequest = useRef<number | null>(null)

  const applyUnreadCount = useCallback((count: number) => {
    setUnreadCount(count)
    useNotificationCenterStore.getState().setUnreadCount(count)
  }, [])

  const handleFailure = useCallback((code: string, message: string) => {
    if (code === NOTIFICATION_CENTER_NOT_READY) {
      useNotificationCenterStore.getState().markUnavailable()
      setNotReady(true)
      return
    }
    setError(message)
  }, [])

  useEffect(() => {
    const request = ++listRequest.current
    setLoading(true)
    setLoadingMore(false)
    setError('')
    setNotReady(false)
    window.electronAPI.notificationCenter.list({ limit: NOTIFICATION_PAGE_SIZE, type: typeFilter, unreadOnly })
      .then(result => {
        if (request !== listRequest.current) return
        if (!result.ok) {
          handleFailure(result.code, result.message)
          return
        }
        setItems(result.data.items)
        setNextCursor(result.data.nextCursor)
        applyUnreadCount(result.data.unreadCount)
      })
      .catch(() => { if (request === listRequest.current) setError('Không thể tải thông báo. Vui lòng thử lại.') })
      .finally(() => { if (request === listRequest.current) setLoading(false) })
    return () => { listRequest.current++ }
  }, [typeFilter, unreadOnly, reloadKey, applyUnreadCount, handleFailure])

  // Mở sẵn thông báo được chọn từ chuông.
  useEffect(() => {
    if (!selectRequest || handledSelectRequest.current === selectRequest.requestId) return
    handledSelectRequest.current = selectRequest.requestId
    setSelection({ id: selectRequest.notificationId, item: null })
  }, [selectRequest])

  // Khi danh sách có thông báo đang xem thì dùng bản trong danh sách (để tô dòng đang chọn).
  useEffect(() => {
    setSelection(previous => {
      if (!previous || previous.item) return previous
      const found = items.find(item => item.id === previous.id)
      return found ? { id: previous.id, item: found } : previous
    })
  }, [items])

  const reload = () => setReloadKey(value => value + 1)

  const loadMore = async () => {
    if (!nextCursor || loadingMore || loading) return
    const request = listRequest.current
    setLoadingMore(true)
    try {
      const result = await window.electronAPI.notificationCenter.list({ limit: NOTIFICATION_PAGE_SIZE, type: typeFilter, unreadOnly, cursor: nextCursor })
      if (request !== listRequest.current) return
      if (!result.ok) {
        if (result.code === NOTIFICATION_CENTER_NOT_READY) handleFailure(result.code, result.message)
        else showAlert(result.message, 'error')
        return
      }
      setItems(previous => mergeItems(previous, result.data.items))
      setNextCursor(result.data.nextCursor)
      applyUnreadCount(result.data.unreadCount)
    } catch {
      if (request === listRequest.current) showAlert('Không thể tải thêm thông báo. Vui lòng thử lại.', 'error')
    } finally {
      if (request === listRequest.current) setLoadingMore(false)
    }
  }

  const markAllRead = async () => {
    // Mốc là mục đầu danh sách đang hiện (mới nhất theo thứ tự hộp thư); thông báo vào sau đó vẫn giữ
    // chưa đọc. Đang lọc theo loại thì chỉ đánh dấu loại đó.
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
      applyUnreadCount(result.data.unreadCount)
      if (unreadOnly) {
        reload()
        return
      }
      const readAt = new Date().toISOString()
      setItems(previous => previous.map(item => (item.readAt ? item : { ...item, readAt })))
      setSelection(previous => (previous?.item && !previous.item.readAt ? { ...previous, item: { ...previous.item, readAt } } : previous))
    } catch {
      showAlert('Không thể đánh dấu đã đọc. Vui lòng thử lại.', 'error')
    } finally {
      markAllLock.current = false
      setMarkingAll(false)
    }
  }

  const handleRead = useCallback<NotificationReadHandler>((id, readAt, count) => {
    setItems(previous => previous.map(item => (item.id === id && !item.readAt ? { ...item, readAt } : item)))
    setSelection(previous => (previous?.id === id && previous.item && !previous.item.readAt ? { ...previous, item: { ...previous.item, readAt } } : previous))
    if (count !== null) setUnreadCount(count)
  }, [])

  const emptyText = unreadOnly
    ? 'Không có thông báo chưa đọc.'
    : typeFilter ? 'Chưa có thông báo thuộc loại này.' : 'Chưa có thông báo nào.'

  if (notReady) {
    return (
      <div className="nc-page">
        <section className="nc-card nc-page-unavailable">
          <Bell size={18} aria-hidden="true" />
          <p>Máy chủ chưa bật trung tâm thông báo. Khi bật, thông báo sẽ hiện ở đây.</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>Thử lại</button>
        </section>
      </div>
    )
  }

  return (
    <div className="nc-page">
      <section className="nc-card nc-page-list" aria-labelledby="nc-page-title">
        <div className="nc-page-head">
          <div className="nc-card-title">
            <h2 id="nc-page-title">Thông báo</h2>
            {unreadCount > 0 && <span className="nc-count-badge">{formatUnreadCount(unreadCount)} chưa đọc</span>}
          </div>
          <div className="nc-inbox-tools">
            <button type="button" className="btn-icon" title="Tải lại" aria-label="Tải lại thông báo" onClick={reload} disabled={loading}>
              <RefreshCw size={14} />
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void markAllRead()}
              disabled={markingAll || loading || unreadCount === 0 || items.length === 0}>
              <CheckCheck size={14} />
              <span>{markingAll ? 'Đang đánh dấu...' : 'Đánh dấu đã đọc tất cả'}</span>
            </button>
          </div>
        </div>
        <div className="nc-page-filters">
          <div className="nc-chip-row" role="group" aria-label="Lọc theo loại thông báo">
            <button type="button" className={`nc-filter-chip ${typeFilter === null ? 'is-on' : ''}`} aria-pressed={typeFilter === null}
              onClick={() => setTypeFilter(null)}>Tất cả</button>
            {FILTER_TYPES.map(type => (
              <button key={type} type="button" className={`nc-filter-chip ${typeFilter === type ? 'is-on' : ''}`} aria-pressed={typeFilter === type}
                onClick={() => setTypeFilter(type)}>{NOTIFICATION_EVENT_LABELS[type]}</button>
            ))}
          </div>
          <label className="nc-unread-toggle">
            <input type="checkbox" checked={unreadOnly} onChange={event => setUnreadOnly(event.target.checked)} />
            <span>Chỉ chưa đọc</span>
          </label>
        </div>
        <div className="nc-page-scroll" aria-busy={loading}>
          {loading ? (
            <p className="nc-empty" role="status">Đang tải...</p>
          ) : error ? (
            <div className="nc-empty">
              <span role="alert">{error}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>Thử lại</button>
            </div>
          ) : items.length === 0 ? (
            <p className="nc-empty">{emptyText}</p>
          ) : (
            <>
              <ul className="nc-inbox-list" aria-label="Danh sách thông báo">
                {items.map(item => (
                  <li key={item.id}>
                    <button type="button"
                      className={`nc-inbox-item severity-${item.severity} ${item.readAt ? '' : 'is-unread'} ${selection?.id === item.id ? 'is-selected' : ''}`}
                      aria-current={selection?.id === item.id ? 'true' : undefined}
                      onClick={() => setSelection({ id: item.id, item })}>
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
              {nextCursor && (
                <div className="nc-load-more">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? 'Đang tải...' : 'Tải thêm'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="nc-card nc-page-detail" aria-label="Chi tiết thông báo">
        {selection ? (
          <NotificationDetailPanel key={selection.id} selection={selection} format={format} onRead={handleRead} onOpenTarget={onOpenTarget} />
        ) : (
          <p className="nc-empty nc-page-placeholder">Chọn một thông báo để xem chi tiết.</p>
        )}
      </section>
    </div>
  )
}

function NotificationDetailPanel({ selection, format, onRead, onOpenTarget }: {
  selection: Selection
  format: ReturnType<typeof createNotificationTimeFormat>
  onRead: NotificationReadHandler
  onOpenTarget: (target: NotificationTarget) => void
}) {
  const { detail, loading, error, reload } = useNotificationDetail(selection.id, onRead)
  const title = notificationDisplayTitle(selection.item, detail)
  const source = detail ?? selection.item
  // "Gói sắp hết hạn": nút Gia hạn chỉ khi đang có lời nhắc gia hạn (trạng thái do tiến trình chính tính).
  const renewalState = useRenewalReminderStore(store => store.state)
  const target = source ? notificationTarget(source, renewalState) : null

  // Bấm mở nhanh trước khi chi tiết tải xong thì lượt đánh dấu trong lúc tải bị hủy theo trang;
  // đánh dấu đã đọc ngay tại đây, kết quả cập nhật số trên chuông kể cả khi đã rời trang.
  const openTarget = (value: NotificationTarget) => {
    if (!(detail?.readAt ?? selection.item?.readAt)) {
      window.electronAPI.notificationCenter.markRead({ ids: [selection.id] })
        .then(result => { if (result.ok) useNotificationCenterStore.getState().setUnreadCount(result.data.unreadCount) })
        .catch(() => {})
    }
    onOpenTarget(value)
  }

  return (
    <div className="nc-page-detail-inner">
      <div className="nc-page-detail-head">
        <div className="nc-detail-heading">
          <NotificationDetailTags item={selection.item} detail={detail} format={format} />
          <h3>{loading && !selection.item ? 'Đang tải...' : title}</h3>
        </div>
        {target && (
          <button type="button" className="btn btn-primary btn-sm nc-open-target" onClick={() => openTarget(target)}>
            <ArrowUpRight size={14} />
            <span>{notificationTargetLabel(target)}</span>
          </button>
        )}
      </div>
      <div className="nc-page-detail-body">
        <NotificationDetailBody detail={detail} loading={loading} error={error} format={format} title={title} onRetry={reload} />
      </div>
    </div>
  )
}
