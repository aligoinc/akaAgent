import { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, CheckCircle2, Sun, X } from 'lucide-react'
import type { NotificationListItem } from '../../../../shared/types'
import { useNotificationCenterStore } from '../../stores/notificationCenterStore'
import { useCampaignStore } from '../../stores/campaignStore'
import { notificationDisplayTitle } from './NotificationDetailView'
import {
  NOTIFICATION_TOAST_CAMPAIGN_DELAY_MS,
  NOTIFICATION_TOAST_DURATION_MS,
  NOTIFICATION_TOAST_SCHEDULE_HORIZON_MS,
  newlyCompletedCampaignIds,
  pickToastNotification,
  readLastShownToastId,
  shouldCheckForToast,
  toastActionLabel,
  toastRefreshDelays,
  writeLastShownToastId
} from './notificationToastModel'
import './notificationToast.css'

interface Props {
  /** `${organizationId}:${staffId}` của phiên đang đăng nhập. */
  scope: string
  /** Đang ở trang Thông báo: không hiện (khách đang xem chính danh sách đó). */
  suppressed: boolean
  /** Mở thông báo ở trang Thông báo (chi tiết tự đánh dấu đã đọc và có nút mở nhanh chiến dịch). */
  onOpen: (notificationId: number) => void
}

function ToastIcon({ eventType }: { eventType: string }) {
  if (eventType === 'report.morning') return <Sun size={18} />
  if (eventType === 'campaign.status_changed') return <CheckCircle2 size={18} />
  return <BarChart3 size={18} />
}

/**
 * Thông báo nổi góc phải khi có Chào ngày mới, báo cáo 12:00 / 18:00 hoặc chiến dịch hoàn thành mới. Chuông vẫn như cũ.
 * Đọc DB: một lượt danh sách (3 dòng) khi số chưa đọc của chuông tăng; hỏi số chưa đọc ở mốc báo cáo + 1 và + 5 phút, và 1 phút
 * sau khi một chiến dịch đang hiện chuyển sang "hoàn thành"; đọc cài đặt thông báo khi đăng nhập và sau mỗi đợt mốc báo cáo.
 * Cửa sổ đang thu nhỏ / khóa màn hình thì để dành, hiện khi khách quay lại.
 */
export default function NotificationToast({ scope, suppressed, onOpen }: Props) {
  const unreadCount = useNotificationCenterStore(state => state.unreadCount)
  const available = useNotificationCenterStore(state => state.available)
  const refreshUnread = useNotificationCenterStore(state => state.refreshUnread)
  const campaigns = useCampaignStore(state => state.campaigns)
  const [item, setItem] = useState<NotificationListItem | null>(null)
  const [paused, setPaused] = useState(false)
  const [scheduleRound, setScheduleRound] = useState(0)
  const previousCountRef = useRef<number | null>(null)
  const pendingRef = useRef(false)
  const checkingRef = useRef(false)
  const scopeRef = useRef(scope)
  const campaignStatusRef = useRef<Map<number, string> | null>(null)
  const campaignTimerRef = useRef<number | null>(null)

  useEffect(() => {
    scopeRef.current = scope
    previousCountRef.current = null
    pendingRef.current = false
    campaignStatusRef.current = null
    setItem(null)
  }, [scope])

  const check = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    const run = scopeRef.current
    try {
      const attention = await Promise.resolve()
        .then(() => window.electronAPI.getDesktopUiAttention())
        .catch(() => null)
      if (run !== scopeRef.current) return
      if (attention?.hidden) {
        pendingRef.current = true
        return
      }
      pendingRef.current = false
      const result = await window.electronAPI.notificationCenter.list({ limit: 3, unreadOnly: true })
      if (run !== scopeRef.current || !result.ok) return
      const pick = pickToastNotification(result.data.items, readLastShownToastId(run))
      if (!pick) return
      writeLastShownToastId(run, pick.id)
      setPaused(false)
      setItem(pick)
    } catch {
      // Lỗi đọc: chuông vẫn có số chưa đọc, không cần thông báo nổi.
    } finally {
      checkingRef.current = false
    }
  }, [])

  // Số chưa đọc của chuông tăng: xem có thông báo đáng nổi lên không.
  useEffect(() => {
    const previous = previousCountRef.current
    previousCountRef.current = unreadCount
    if (suppressed || !shouldCheckForToast(previous, unreadCount)) return
    void check()
  }, [unreadCount, suppressed, check])

  // Cửa sổ được mở lại / focus mà đang để dành một lần kiểm: kiểm ngay.
  useEffect(() => {
    const resume = () => { if (pendingRef.current && !suppressed) void check() }
    window.addEventListener('focus', resume)
    const off = window.electronAPI.onDesktopUiAttentionChanged?.(resume)
    return () => {
      window.removeEventListener('focus', resume)
      off?.()
    }
  }, [suppressed, check])

  // Hỏi số chưa đọc đúng lúc có báo cáo theo lịch (không poll): đọc mốc `nextRunAt` của cài đặt, hẹn + 1 và + 5 phút.
  useEffect(() => {
    if (available !== true) return
    let cancelled = false
    const timers: number[] = []
    window.electronAPI.notificationCenter.getSettings()
      .then(result => {
        if (cancelled || !result.ok) return
        const now = Date.now()
        const delays = toastRefreshDelays(result.data.upcomingRunAts, now)
        for (const delay of delays) timers.push(window.setTimeout(() => { void refreshUnread({ force: true }) }, delay))
        if (delays.length > 0) {
          // Sau lần hỏi cuối thì đọc lại cài đặt để hẹn đợt kế tiếp.
          timers.push(window.setTimeout(() => setScheduleRound(round => round + 1), delays[delays.length - 1] + 5_000))
          return
        }
        const later = (result.data.upcomingRunAts ?? []).map(value => Date.parse(value)).filter(at => at > now)
        if (later.length > 0) {
          const wait = Math.min(Math.max(Math.min(...later) - now - NOTIFICATION_TOAST_SCHEDULE_HORIZON_MS / 2, 60 * 60_000), 24 * 60 * 60_000)
          timers.push(window.setTimeout(() => setScheduleRound(round => round + 1), wait))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [scope, available, scheduleRound, refreshUnread])

  // Chiến dịch đang hiện trên trang vừa chuyển sang "hoàn thành": 1 phút sau hỏi số chưa đọc (thông báo hoàn thành đã dựng xong).
  useEffect(() => {
    const previous = campaignStatusRef.current
    campaignStatusRef.current = new Map(campaigns.map(row => [row.id, row.status]))
    if (!previous || available !== true || campaignTimerRef.current !== null) return
    if (newlyCompletedCampaignIds(previous, campaigns).length === 0) return
    campaignTimerRef.current = window.setTimeout(() => {
      campaignTimerRef.current = null
      void refreshUnread({ force: true })
    }, NOTIFICATION_TOAST_CAMPAIGN_DELAY_MS)
  }, [campaigns, available, refreshUnread])

  useEffect(() => () => {
    if (campaignTimerRef.current !== null) window.clearTimeout(campaignTimerRef.current)
  }, [])

  useEffect(() => {
    if (!item || paused) return
    const timer = window.setTimeout(() => setItem(null), NOTIFICATION_TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [item, paused])

  useEffect(() => { if (suppressed) setItem(null) }, [suppressed])

  if (!item || suppressed) return null
  const open = () => {
    setItem(null)
    onOpen(item.id)
  }
  return (
    <div className="nc-toast" role="status" aria-live="polite"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="nc-toast-icon"><ToastIcon eventType={item.eventType} /></span>
      <div className="nc-toast-copy">
        <strong>{notificationDisplayTitle(item)}</strong>
        {item.body && <span>{item.body}</span>}
        <div className="nc-toast-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={open}>{toastActionLabel(item)}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setItem(null)}>Để sau</button>
        </div>
      </div>
      <button type="button" className="nc-toast-close" aria-label="Đóng thông báo" onClick={() => setItem(null)}><X size={15} /></button>
    </div>
  )
}

