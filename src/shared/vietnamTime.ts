export const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000

/** Start of the calendar day in Vietnam, independent of the host machine timezone. */
export function getVietnamDayStart(date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = new Map(parts.map(part => [part.type, Number(part.value)]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')
  if (!year || !month || !day) throw new Error('Không thể xác định ngày hiện tại theo giờ Việt Nam')
  return new Date(Date.UTC(year, month - 1, day) - VIETNAM_UTC_OFFSET_MS)
}
