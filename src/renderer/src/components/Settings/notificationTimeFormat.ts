import { NOTIFICATION_DEFAULT_TIMEZONE } from '../../../../shared/notificationCenter'

export interface NotificationTimeFormat {
  /** "Hôm nay 14:05", "Hôm qua 09:30" hoặc "14:05 03/11/2026" */
  relative: (iso: string | null | undefined) => string
  /** "14:05:09 04/11/2026" */
  dateTime: (iso: string | null | undefined) => string
  /** "14:05:09" */
  time: (iso: string | null | undefined) => string
}

type Parts = Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>

function createFormatter(timezone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timezone })
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: NOTIFICATION_DEFAULT_TIMEZONE })
  }
}

/** Định dạng thời gian theo múi giờ cài đặt thông báo (mặc định giờ Việt Nam). */
export function createNotificationTimeFormat(timezone: string): NotificationTimeFormat {
  const formatter = createFormatter(timezone || NOTIFICATION_DEFAULT_TIMEZONE)
  const parts = (value: Date): Parts => {
    const result: Parts = { year: '', month: '', day: '', hour: '', minute: '', second: '' }
    for (const part of formatter.formatToParts(value)) {
      if (part.type in result) result[part.type as keyof Parts] = part.value
    }
    return result
  }
  const parse = (iso: string | null | undefined): Date | null => {
    if (!iso) return null
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const dayKey = (p: Parts) => `${p.year}-${p.month}-${p.day}`
  return {
    relative(iso) {
      const date = parse(iso)
      if (!date) return '—'
      const p = parts(date)
      const now = new Date()
      const hhmm = `${p.hour}:${p.minute}`
      if (dayKey(p) === dayKey(parts(now))) return `Hôm nay ${hhmm}`
      if (dayKey(p) === dayKey(parts(new Date(now.getTime() - 86_400_000)))) return `Hôm qua ${hhmm}`
      return `${hhmm} ${p.day}/${p.month}/${p.year}`
    },
    dateTime(iso) {
      const date = parse(iso)
      if (!date) return '—'
      const p = parts(date)
      return `${p.hour}:${p.minute}:${p.second} ${p.day}/${p.month}/${p.year}`
    },
    time(iso) {
      const date = parse(iso)
      if (!date) return '—'
      const p = parts(date)
      return `${p.hour}:${p.minute}:${p.second}`
    }
  }
}
