import { useEffect, useState } from 'react'
import { AlertTriangle, CircleAlert, Clock } from 'lucide-react'
import type { RenewalReminder, RenewalReminderLevel } from '../../../../shared/renewalReminder'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'

/** Mỗi mức khác nhau cả màu, biểu tượng và câu chữ (câu chữ lấy từ `renewalReminderTexts`). */
export const RENEWAL_LEVEL_ICONS: Record<RenewalReminderLevel, typeof Clock> = {
  mild: Clock,
  medium: AlertTriangle,
  strong: CircleAlert
}

export const renewalToneClass = (level: RenewalReminderLevel): string => `renewal-reminder-tone-${level}`

/** Hiện đồng hồ đếm ngược: ngày cuối của gói trả phí, và mọi lúc với bản dùng thử. */
export const renewalShowsCountdown = (reminder: RenewalReminder): boolean => reminder.countdown || reminder.kind === 'trial'

/**
 * "Bây giờ" theo giờ máy chủ: `Date.now() + (serverTimeMs − lúc nhận)`. Khi `active`, vẽ lại mỗi giây lúc cửa sổ đang
 * hiện; không đọc DB.
 */
export function useRenewalNow(active: boolean): number {
  const serverTimeMs = useRenewalReminderStore(state => state.state?.serverTimeMs ?? 0)
  const receivedAtMs = useRenewalReminderStore(state => state.receivedAtMs)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const tick = () => { if (document.visibilityState === 'visible') setTick(value => value + 1) }
    const timer = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [active])
  const offset = serverTimeMs && receivedAtMs ? serverTimeMs - receivedAtMs : 0
  return Date.now() + offset
}

const two = (value: number): string => String(value).padStart(2, '0')
export const formatCountdownPart = two
