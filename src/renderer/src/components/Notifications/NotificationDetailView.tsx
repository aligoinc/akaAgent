import { useEffect, useState } from 'react'
import { Mail, Smartphone } from 'lucide-react'
import type {
  NotificationContent,
  NotificationContentSection,
  NotificationDeliverySummary,
  NotificationDetail,
  NotificationListItem
} from '../../../../shared/types'
import {
  NOTIFICATION_CENTER_NOT_READY,
  NOTIFICATION_DELIVERY_STATUS_LABELS,
  NOTIFICATION_UNREAD_CAP,
  notificationDeliveryReason,
  notificationEventLabel
} from '../../../../shared/notificationCenter'
import { useNotificationCenterStore } from '../../stores/notificationCenterStore'
import type { NotificationTimeFormat } from '../Settings/notificationTimeFormat'
import '../Settings/notificationCenter.css'
import './notifications.css'

/** Một thông báo vừa được đọc: id, thời điểm đọc và số chưa đọc mới (null nếu không biết). */
export type NotificationReadHandler = (id: number, readAt: string, unreadCount: number | null) => void

export function formatUnreadCount(count: number): string {
  return count >= NOTIFICATION_UNREAD_CAP ? `${NOTIFICATION_UNREAD_CAP - 1}+` : String(count)
}

/** Tiêu đề hiển thị: tiêu đề thông báo, rồi tiêu đề nội dung, rồi tên loại. */
export function notificationDisplayTitle(item: Pick<NotificationListItem, 'title' | 'eventType'> | null, detail?: NotificationDetail | null): string {
  return detail?.title || detail?.content?.headline || item?.title || notificationEventLabel(detail?.eventType ?? item?.eventType)
}

/**
 * Tải chi tiết một thông báo và đánh dấu đã đọc khi mở. Lỗi đánh dấu không che nội dung đang
 * xem: thông báo vẫn chưa đọc và được đánh dấu ở lần mở sau. Cập nhật số chưa đọc cho chuông.
 */
export function useNotificationDetail(notificationId: number | null, onRead: NotificationReadHandler) {
  const [detail, setDetail] = useState<NotificationDetail | null>(null)
  const [loading, setLoading] = useState(() => notificationId !== null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!notificationId) {
      setDetail(null)
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    setDetail(null)
    setLoading(true)
    setError('')
    const api = window.electronAPI.notificationCenter
    api.detail(notificationId)
      .then(async result => {
        if (cancelled) return
        if (!result.ok) {
          if (result.code === NOTIFICATION_CENTER_NOT_READY) useNotificationCenterStore.getState().markUnavailable()
          setError(result.message)
          return
        }
        setDetail(result.data)
        if (result.data.readAt) {
          onRead(notificationId, result.data.readAt, null)
          return
        }
        try {
          const read = await api.markRead({ ids: [notificationId] })
          if (!read.ok) return
          useNotificationCenterStore.getState().setUnreadCount(read.data.unreadCount)
          onRead(notificationId, new Date().toISOString(), read.data.unreadCount)
        } catch {
          // Giữ trạng thái chưa đọc.
        }
      })
      .catch(() => { if (!cancelled) setError('Không thể tải chi tiết thông báo. Vui lòng thử lại.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [notificationId, onRead, reloadKey])

  return { detail, loading, error, reload: () => setReloadKey(value => value + 1) }
}

/** Nhãn loại, mức độ và thời điểm xảy ra ở đầu phần chi tiết. */
export function NotificationDetailTags({ item, detail, format }: {
  item: NotificationListItem | null
  detail: NotificationDetail | null
  format: NotificationTimeFormat
}) {
  const severity = detail?.severity ?? item?.severity
  const occurredAt = detail?.occurredAt ?? item?.occurredAt
  return (
    <div className="nc-detail-tags">
      <span className="nc-type-tag">{notificationEventLabel(detail?.eventType ?? item?.eventType)}</span>
      {severity === 'critical' && <span className="nc-badge bad">Quan trọng</span>}
      {severity === 'warning' && <span className="nc-badge warn">Cần chú ý</span>}
      {occurredAt && <time dateTime={occurredAt}>{format.dateTime(occurredAt)}</time>}
    </div>
  )
}

/** Nội dung chi tiết: các phần số liệu đã chốt lúc dựng, ghi chú gộp và trạng thái gửi từng kênh. */
export function NotificationDetailBody({ detail, loading, error, format, title, onRetry }: {
  detail: NotificationDetail | null
  loading: boolean
  error: string
  format: NotificationTimeFormat
  title: string
  onRetry?: () => void
}) {
  if (loading) return <p className="nc-empty" role="status">Đang tải...</p>
  if (error) {
    return (
      <div className="nc-empty">
        <span role="alert">{error}</span>
        {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Thử lại</button>}
      </div>
    )
  }
  if (!detail) return null
  return (
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
