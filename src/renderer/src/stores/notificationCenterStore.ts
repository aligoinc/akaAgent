import { useEffect } from 'react'
import { create } from 'zustand'
import { NOTIFICATION_CENTER_NOT_READY } from '../../../shared/notificationCenter'

/**
 * Số thông báo chưa đọc cho chuông trên thanh bên. Không có hẹn giờ hay poll: chỉ đọc khi đăng
 * nhập, khi cửa sổ được focus lại, khi đổi trang (tối đa 1 lần/phút) và nhận số mới từ danh sách
 * hoặc lượt đánh dấu đã đọc. DB chưa có V457 thì ẩn chuông và chỉ hỏi lại sau 10 phút.
 */
const UNREAD_MIN_INTERVAL_MS = 60_000
const NOT_READY_RETRY_MS = 10 * 60_000
const ERROR_RETRY_MS = 60_000

interface NotificationCenterState {
  /** `${organizationId}:${staffId}` của phiên đang đăng nhập; null khi chưa đăng nhập. */
  scope: string | null
  unreadCount: number | null
  /** false: máy chủ chưa có trung tâm thông báo (ẩn chuông); null: chưa biết. */
  available: boolean | null
  setScope: (scope: string | null) => void
  setUnreadCount: (count: number) => void
  markUnavailable: () => void
  refreshUnread: (options?: { force?: boolean }) => Promise<void>
}

let generation = 0
let lastCheckedAt = 0
let retryAfter = 0
let inflight: Promise<void> | null = null

export const useNotificationCenterStore = create<NotificationCenterState>((set, get) => ({
  scope: null,
  unreadCount: null,
  available: null,

  setScope: (scope) => {
    if (get().scope === scope) return
    generation += 1
    lastCheckedAt = 0
    retryAfter = 0
    inflight = null
    set({ scope, unreadCount: null, available: null })
  },

  setUnreadCount: (count) => {
    if (!Number.isSafeInteger(count) || count < 0 || !get().scope) return
    lastCheckedAt = Date.now()
    retryAfter = 0
    set({ unreadCount: count, available: true })
  },

  markUnavailable: () => {
    retryAfter = Date.now() + NOT_READY_RETRY_MS
    set({ available: false, unreadCount: null })
  },

  refreshUnread: async ({ force = false } = {}) => {
    if (!get().scope) return
    if (inflight) return inflight
    const now = Date.now()
    if (!force && (now < retryAfter || now - lastCheckedAt < UNREAD_MIN_INTERVAL_MS)) return
    const api = window.electronAPI?.notificationCenter
    if (!api?.unreadCount) return
    const run = generation
    lastCheckedAt = now
    const request = api.unreadCount()
      .then(result => {
        if (run !== generation) return
        if (result.ok) {
          retryAfter = 0
          set({ unreadCount: result.data, available: true })
          return
        }
        if (result.code === NOTIFICATION_CENTER_NOT_READY) {
          retryAfter = Date.now() + NOT_READY_RETRY_MS
          set({ available: false, unreadCount: null })
          return
        }
        retryAfter = Date.now() + ERROR_RETRY_MS
      })
      .catch(() => {
        if (run === generation) retryAfter = Date.now() + ERROR_RETRY_MS
      })
      .finally(() => {
        if (run === generation && inflight === request) inflight = null
      })
    inflight = request
    return request
  }
}))

/** Gắn ở App: đổi phiên thì đọc lại ngay; focus cửa sổ hoặc đổi trang thì đọc lại có giới hạn. */
export function useNotificationUnreadSync(scope: string | null, pageKey: string): void {
  const setScope = useNotificationCenterStore(state => state.setScope)
  const refreshUnread = useNotificationCenterStore(state => state.refreshUnread)

  useEffect(() => {
    setScope(scope)
    if (scope) void refreshUnread({ force: true })
  }, [scope, setScope, refreshUnread])

  useEffect(() => {
    if (!scope) return
    const handleFocus = () => { void refreshUnread() }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshUnread()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [scope, refreshUnread])

  useEffect(() => {
    if (scope) void refreshUnread()
  }, [scope, pageKey, refreshUnread])
}
