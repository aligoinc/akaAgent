import { getVietnamDayStart } from './vietnamTime'

export interface DaysAtTimeActionDisable {
  days?: number | null
  time?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Uses the same DB instant as disabled_at; never the host's wall clock/timezone. */
export function resolveDaysAtTimeDateEnable(dbNow: string, schedule: DaysAtTimeActionDisable): string {
  const { days, time } = schedule
  if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 0) {
    throw new Error('Số ngày khóa hành động phải là số nguyên không âm')
  }
  const disabledMs = new Date(dbNow).getTime()
  if (!Number.isFinite(disabledMs)) throw new Error('Thời điểm khóa từ DB không hợp lệ')

  let enableMs: number
  if (time == null) {
    enableMs = disabledMs + days * DAY_MS
  } else {
    // PostgreSQL time may include seconds and fractional seconds. 24:00 is rejected.
    const match = typeof time === 'string'
      ? /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/.exec(time)
      : null
    if (!match) throw new Error('Giờ mở khóa hành động không hợp lệ')
    const timeMs = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0)) * 1000
      + Math.floor(Number('0.' + (match[4] || '0')) * 1000)
    enableMs = getVietnamDayStart(new Date(disabledMs)).getTime() + days * DAY_MS + timeMs
  }
  if (!Number.isFinite(new Date(enableMs).getTime()) || enableMs <= disabledMs) {
    throw new Error('Thời điểm mở khóa phải sau thời điểm bị khóa')
  }
  return new Date(enableMs).toISOString()
}
