import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCheck, Mail, RefreshCw, Smartphone, X } from 'lucide-react'
import type {
  NotificationContent,
  NotificationContentSection,
  NotificationDeliverySummary,
  NotificationDetail,
  NotificationEventType,
  NotificationListItem
} from '../../../../shared/types'
import {
  NOTIFICATION_DELIVERY_STATUS_LABELS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_UNREAD_CAP,
  notificationDeliveryReason,
  notificationEventLabel
} from '../../../../shared/notificationCenter'
import { useUiStore } from '../../stores/uiStore'
import { createNotificationTimeFormat, type NotificationTimeFormat } from './notificationTimeFormat'

type ReadHandler = (id: number, readAt: string, unreadCount: number | null) => void

export function formatUnreadCount(count: number): string {
  return count >= NOTIFICATION_UNREAD_CAP ? `${NOTIFICATION_UNREAD_CAP - 1}+` : String(count)
}

/**
 * Hộp thư "Thông báo gần đây" của Desktop (chưa có chuông). Chỉ tải khi mục cài đặt mở hoặc
 * người dùng bấm tải lại; không poll, không hẹn giờ.
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
      })
      .catch(() => { if (request === listRequest.current) setError('Không thể tải thông báo. Vui lòng thử lại.') })
      .finally(() => { if (request === listRequest.current) setLoading(false) })
    return () => { listRequest.current++ }
  }, [typeFilter, reloadKey])

  const reload = () => setReloadKey(value => value + 1)

  const handleRead = useCallback<ReadHandler>((id, readAt, count) => {
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
  onRead: ReadHandler
}) {
  const [detail, setDetail] = useState<NotificationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const api = window.electronAPI.notificationCenter
    api.detail(item.id)
      .then(async result => {
        if (cancelled) return
        if (!result.ok) {
          setError(result.message)
          return
        }
        setDetail(result.data)
        if (result.data.readAt) {
          onRead(item.id, result.data.readAt, null)
          return
        }
        // Mở chi tiết là đã đọc; cập nhật danh sách cả khi hộp thoại đã đóng. Lỗi đánh dấu
        // không che nội dung đang xem: thông báo vẫn chưa đọc và được đánh dấu ở lần mở sau.
        try {
          const read = await api.markRead({ ids: [item.id] })
          if (read.ok) onRead(item.id, new Date().toISOString(), read.data.unreadCount)
        } catch {
          // Giữ trạng thái chưa đọc.
        }
      })
      .catch(() => { if (!cancelled) setError('Không thể tải chi tiết thông báo. Vui lòng thử lại.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [item.id, onRead])

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

  const title = detail?.title || detail?.content?.headline || item.title || notificationEventLabel(item.eventType)
  const severity = detail?.severity ?? item.severity

  return createPortal(
    <div className="modal-overlay nc-detail-overlay" onClick={event => { event.stopPropagation(); onClose() }}>
      <div ref={dialogRef} className="nc-detail-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={event => event.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="nc-detail-header">
          <div className="nc-detail-heading">
            <div className="nc-detail-tags">
              <span className="nc-type-tag">{notificationEventLabel(detail?.eventType ?? item.eventType)}</span>
              {severity === 'critical' && <span className="nc-badge bad">Quan trọng</span>}
              {severity === 'warning' && <span className="nc-badge warn">Cần chú ý</span>}
              <time dateTime={detail?.occurredAt ?? item.occurredAt}>{format.dateTime(detail?.occurredAt ?? item.occurredAt)}</time>
            </div>
            <h3 id={titleId}>{title}</h3>
          </div>
          <button ref={closeRef} type="button" className="btn-icon" title="Đóng" aria-label="Đóng" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="nc-detail-body">
          {loading ? (
            <p className="nc-empty" role="status">Đang tải...</p>
          ) : error ? (
            <p className="nc-empty" role="alert">{error}</p>
          ) : detail ? (
            <>
              {detail.content ? (
                <NotificationContentView content={detail.content} format={format} title={title} />
              ) : (
                <>
                  <p className="nc-detail-fallback">{detail.body || 'Thông báo này không có nội dung chi tiết.'}</p>
                  {detail.eventType === 'report.scheduled' && (
                    <p className="nc-hint">Nội dung chi tiết của báo cáo chỉ được lưu trong 30 ngày.</p>
                  )}
                </>
              )}
              {detail.mergedCount > 1 && (
                <p className="nc-hint">Thông báo này gộp {detail.mergedCount} thay đổi xảy ra cùng lúc.</p>
              )}
              <DeliverySummary deliveries={detail.deliveries} format={format} />
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}

function NotificationContentView({ content, format, title }: { content: NotificationContent; format: NotificationTimeFormat; title: string }) {
  return (
    <div className="nc-content">
      {content.headline && content.headline !== title && <div className="nc-content-headline">{content.headline}</div>}
      {content.countedAt && <div className="nc-content-counted">Số liệu lúc {format.time(content.countedAt)}</div>}
      {content.sections.map((section, index) => (
        <section key={`${index}:${section.title}`} className={`nc-detail-section tone-${section.tone ?? 'info'}`}>
          {section.title && <h4>{section.title}</h4>}
          {section.rows && section.rows.length > 0 && (
            <dl className="nc-detail-rows">
              {section.rows.map((row, rowIndex) => (
                <div key={rowIndex} className={`nc-detail-row ${row.tone ? `tone-${row.tone}` : ''}`}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.table && <ContentTable table={section.table} />}
          {section.note && <p className="nc-detail-note">{section.note}</p>}
        </section>
      ))}
    </div>
  )
}

/** Bảng có cột đầu trống và nhãn kỳ ở đầu mỗi dòng (Hôm nay / Lũy kế) hiển thị thành thẻ số liệu. */
function ContentTable({ table }: { table: NonNullable<NotificationContentSection['table']> }) {
  const periodCards = table.columns.length > 1 && table.columns[0] === '' && table.rows.length > 0 && table.rows.every(row => row[0])
  if (periodCards) {
    return (
      <div className="nc-period-cards">
        {table.rows.map((row, rowIndex) => {
          const label = row[0]
          const period = label === 'Hôm nay' ? 'is-today' : label === 'Lũy kế' ? 'is-total' : rowIndex === 0 ? 'is-today' : 'is-total'
          return (
            <div key={rowIndex} className={`nc-period-card ${period}`}>
              <div className="nc-period-title">{label}</div>
              <dl>
                {table.columns.slice(1).map((column, columnIndex) => (
                  <div key={columnIndex}>
                    <dt>{column}</dt>
                    <dd>{row[columnIndex + 1] ?? ''}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="nc-table-wrap">
      <table className="nc-table">
        {table.columns.length > 0 && (
          <thead>
            <tr>{table.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((value, index) => <td key={index}>{value}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DeliverySummary({ deliveries, format }: { deliveries: NotificationDeliverySummary[]; format: NotificationTimeFormat }) {
  return (
    <section className="nc-detail-section nc-deliveries">
      <h4>Gửi đi</h4>
      {deliveries.length === 0 ? (
        <p className="nc-hint">Thông báo chỉ lưu trong ứng dụng, không gửi qua email hoặc iPhone.</p>
      ) : (
        <ul>
          {deliveries.map((delivery, index) => {
            const reason = notificationDeliveryReason(delivery.errorCode)
            const details = [
              NOTIFICATION_DELIVERY_STATUS_LABELS[delivery.status],
              reason,
              delivery.sentAt ? `lúc ${format.dateTime(delivery.sentAt)}` : null,
              delivery.attempts > 1 ? `${delivery.attempts} lần thử` : null
            ].filter(Boolean).join(' · ')
            return (
              <li key={index} className={`nc-delivery status-${delivery.status}`}>
                <span className="nc-delivery-channel">
                  {delivery.channel === 'email' ? <Mail size={13} aria-hidden="true" /> : <Smartphone size={13} aria-hidden="true" />}
                  {delivery.channel === 'email' ? 'Email' : 'iPhone'}
                </span>
                <span className="nc-delivery-destination" title={delivery.destination}>{delivery.destination || '—'}</span>
                <span className="nc-delivery-status">{details}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
