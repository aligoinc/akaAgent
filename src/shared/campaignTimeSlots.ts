export const parseDailyTimeSlot = (value: string): string | null => {
  const raw = value.trim().toLowerCase().replace(/\s+/g, '')
  if (!raw) return null

  const match = raw.match(/^(\d{1,2})(?::(\d{1,2})|h(\d{1,2})?|h)?$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2] ?? match[3] ?? 0)
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export const getDailyTimeSlotMinutes = (value: string): number | null => {
  const slot = parseDailyTimeSlot(value)
  if (!slot) return null
  const [hour, minute] = slot.split(':').map(Number)
  return hour * 60 + minute
}

export const parseDailyTimeSlots = (value: string): { slots: string[]; invalidItems: string[] } => {
  const items = String(value || '')
    .split(/[,\r\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
  const invalidItems: string[] = []
  const slotMinutes = new Map<string, string>()

  for (const item of items) {
    const slot = parseDailyTimeSlot(item)
    if (!slot) {
      invalidItems.push(item)
      continue
    }
    const [hour, minute] = slot.split(':').map(Number)
    slotMinutes.set(String(hour * 60 + minute), slot)
  }

  const slots = Array.from(slotMinutes.values()).sort((a, b) => {
    const [aHour, aMinute] = a.split(':').map(Number)
    const [bHour, bMinute] = b.split(':').map(Number)
    return (aHour * 60 + aMinute) - (bHour * 60 + bMinute)
  })

  return { slots, invalidItems }
}
