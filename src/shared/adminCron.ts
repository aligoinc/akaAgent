/** A readable label alongside the original pg_cron expression. Times use cron's timezone. */
export function describeCronSchedule(schedule: string): string {
  const expression = schedule.trim()
  if (!expression) return 'Chưa có lịch chạy'
  const seconds = /^(\d+)\s+seconds?$/.exec(expression)
  if (seconds) return `Mỗi ${seconds[1]} giây`
  const aliases: Record<string, string> = { '@hourly': 'Mỗi giờ', '@daily': '00:00 hằng ngày', '@midnight': '00:00 hằng ngày', '@weekly': '00:00 mỗi Chủ nhật', '@monthly': '00:00 ngày 1 mỗi tháng', '@yearly': '00:00 ngày 1 tháng 1', '@annually': '00:00 ngày 1 tháng 1', '@reboot': 'Khi khởi động cron' }
  if (aliases[expression]) return aliases[expression]
  const fields = expression.split(/\s+/)
  if (fields.length !== 5) return 'Theo biểu thức bên dưới'
  const [minute, hour, day, month, weekday] = fields
  const numbers = (field: string, maximum: number): number[] | null => {
    if (!/^\d+(?:,\d+)*$/.test(field)) return null
    const values = field.split(',').map(Number)
    return values.every(value => value <= maximum) ? values : null
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  const minutes = numbers(minute, 59)
  const hours = numbers(hour, 23)
  let days = 'hằng ngày'
  if (weekday !== '*') {
    const selected = new Set<number>()
    for (const part of weekday.split(',')) {
      const range = /^(\d)(?:-(\d))?$/.exec(part)
      if (!range) return `Phút ${minute} · giờ ${hour} · ngày ${day} · tháng ${month} · thứ ${weekday}`
      const start = Number(range[1]), end = Number(range[2] || range[1])
      if (start > end || end > 7) return 'Theo biểu thức bên dưới'
      for (let value = start; value <= end; value++) selected.add(value % 7)
    }
    days = Array.from(selected).map(value => value === 0 ? 'Chủ nhật' : `Thứ ${value + 1}`).join(', ')
  }
  if (day === '*' && month === '*') {
    if (hour === '*') {
      const every = /^\*\/(\d+)$/.exec(minute)
      const step = every ? Number(every[1]) : 0
      const suffix = weekday === '*' ? '' : ` · ${days}`
      if (minute === '*') return `Mỗi phút${suffix}`
      if (step > 0 && step <= 59 && 60 % step === 0) return `Mỗi ${step} phút${suffix}`
      if (minutes?.length === 1 && minutes[0] === 0) return `Mỗi giờ, vào phút 00${suffix}`
      if (minutes) return `Vào phút ${minutes.map(pad).join(', ')} của mỗi giờ${suffix}`
    }
    if (minutes && hours && minutes.length * hours.length <= 12) {
      return `${hours.flatMap(h => minutes.map(m => `${pad(h)}:${pad(m)}`)).join(', ')} · ${days}`
    }
  }
  return `Phút ${minute} · giờ ${hour} · ngày ${day} · tháng ${month} · thứ ${weekday}`
}
