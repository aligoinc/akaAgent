import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleAlert, ExternalLink, Info, WifiOff } from 'lucide-react'
import type { AppNotification, AppNotificationLevel } from '../../../../shared/types'

const REFRESH_INTERVAL_MS = 60 * 60_000

const notificationIcons: Record<AppNotificationLevel, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: CircleAlert
}

export default function AppNotificationBar() {
  const [notification, setNotification] = useState<AppNotification | null>(null)
  const [isOffline, setIsOffline] = useState(() => !window.navigator.onLine)

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.getActiveAppNotification) return
    if (!window.navigator.onLine) {
      setIsOffline(true)
      return
    }

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
    const handleOnline = () => {
      setIsOffline(false)
      void refresh()
    }
    const handleOffline = () => {
      setIsOffline(true)
    }
    const handleFocus = () => {
      setIsOffline(!window.navigator.onLine)
      void refresh()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setIsOffline(!window.navigator.onLine)
        void refresh()
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refresh])

  if (!isOffline && !notification) return null

  const level = isOffline ? 'error' : notification!.level
  const Icon = isOffline ? WifiOff : notificationIcons[level]
  const title = isOffline ? 'Mất kết nối mạng' : notification!.title
  const message = isOffline
    ? 'Không thể kết nối Internet. Vui lòng kiểm tra Wi-Fi hoặc cáp mạng.'
    : notification!.message
  const linkUrl = isOffline ? null : notification!.linkUrl
  const linkLabel = notification?.linkLabel || 'Xem chi tiết'

  return (
    <div
      className={`app-notification-bar app-notification-bar-${level}`}
      role={level === 'error' || level === 'warning' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <Icon className="app-notification-icon" size={17} aria-hidden="true" />
      <div className="app-notification-content">
        {title && <strong>{title}</strong>}
        <span>{message}</span>
      </div>
      {linkUrl && (
        <a
          className="app-notification-link"
          href={linkUrl}
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
