import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleAlert, ExternalLink, Info } from 'lucide-react'
import type { AppNotification, AppNotificationLevel } from '../../../../shared/types'

const REFRESH_INTERVAL_MS = 60 * 60_000

const notificationIcons: Record<AppNotificationLevel, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: CircleAlert
}

/** Thông báo chung do DB điều khiển. Báo mất mạng nằm ở NetworkStatusBar (có đếm ngược và kiểm tra lại). */
export default function AppNotificationBar() {
  const [notification, setNotification] = useState<AppNotification | null>(null)

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.getActiveAppNotification) return
    if (!window.navigator.onLine) return

    try {
      setNotification(await window.electronAPI.getActiveAppNotification())
    } catch (error) {
      console.warn('Get app notification failed:', error)
    }
  }, [])

  useEffect(() => {
    void refresh()

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, REFRESH_INTERVAL_MS)
    const handleOnline = () => { void refresh() }
    const handleFocus = () => { void refresh() }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refresh])

  if (!notification) return null

  const level = notification.level
  const Icon = notificationIcons[level]
  const linkLabel = notification.linkLabel || 'Xem chi tiết'

  return (
    <div
      className={`app-notification-bar app-notification-bar-${level}`}
      role={level === 'error' || level === 'warning' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <Icon className="app-notification-icon" size={17} aria-hidden="true" />
      <div className="app-notification-content">
        {notification.title && <strong>{notification.title}</strong>}
        <span>{notification.message}</span>
      </div>
      {notification.linkUrl && (
        <a
          className="app-notification-link"
          href={notification.linkUrl}
          target="_blank"
          rel="noreferrer"
        >
          <span>{linkLabel}</span>
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      )}
    </div>
  )
}
