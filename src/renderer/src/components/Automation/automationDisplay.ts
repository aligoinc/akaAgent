import type {
  AutomationDelayUnit,
  AutomationScheduleMode,
  AutomationTriggerCondition
} from './automationTypes'

type AutomationTriggerDisplayValue = Pick<
  AutomationTriggerCondition,
  'actionCode' | 'actionName' | 'isWildcard' | 'status' | 'statusLabel'
> & {
  statusMappingId?: number | null
  semanticStatusId?: number | null
}

type AutomationTriggerIdentityValue = Pick<
  AutomationTriggerCondition,
  'actionCode' | 'isWildcard' | 'status'
> & {
  statusMappingId?: number | null
  semanticStatusId?: number | null
}

export interface AutomationScheduleDisplayValue {
  scheduleMode: AutomationScheduleMode
  delayValue?: number | string | null
  delayUnit?: AutomationDelayUnit | null
  delayDays?: number | null
  delayHours?: number | null
  delayExactTime?: string | null
  dailyTime?: string | null
  fixedAt?: string | null
}

const DELAY_UNIT_LABELS: Record<AutomationDelayUnit, string> = {
  minute: 'phút',
  hour: 'giờ',
  day: 'ngày'
}

const normalizePositiveId = (value: unknown): number | null => {
  const numberValue = Number(value)
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null
}

const normalizeTime = (value?: string | null): string | null => (
  /^([01]\d|2[0-3]):[0-5]\d/.exec(value || '')?.[0] || null
)

export const normalizeAutomationStatus = (value: unknown): string => (
  String(value || '').trim().toLocaleLowerCase('vi-VN')
)

export const getAutomationTriggerSemanticKey = (
  trigger: AutomationTriggerIdentityValue
): string => {
  const semanticStatusId = normalizePositiveId(trigger.semanticStatusId)
  return semanticStatusId
    ? `semantic:${semanticStatusId}`
    : `status:${normalizeAutomationStatus(trigger.status)}`
}

export const getAutomationTriggerIdentityKey = (
  trigger: AutomationTriggerIdentityValue
): string => {
  const statusMappingId = normalizePositiveId(trigger.statusMappingId)
  if (statusMappingId) return `mapping:${statusMappingId}`
  return `condition:${String(trigger.actionCode || '').trim()}\u001f${normalizeAutomationStatus(trigger.status)}`
}

export const isAutomationTriggerWildcard = (
  trigger: Pick<AutomationTriggerCondition, 'actionCode' | 'isWildcard'>
): boolean => trigger.isWildcard ?? !String(trigger.actionCode || '').trim()

export const getAutomationTriggerScopeLabel = (
  trigger: AutomationTriggerDisplayValue
): string => {
  const actionCode = String(trigger.actionCode || '').trim()
  if (isAutomationTriggerWildcard(trigger)) return 'Tất cả hành động'
  return String(trigger.actionName || '').trim() || actionCode
}

export const formatAutomationTriggerLabel = (
  trigger: AutomationTriggerDisplayValue
): string => {
  const statusLabel = String(trigger.statusLabel || trigger.status || '').trim() || 'Không rõ trạng thái'
  return `${statusLabel} — ${getAutomationTriggerScopeLabel(trigger)}`
}

const formatFixedAt = (value?: string | null): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh'
  }).format(date)
}

const formatDelay = (schedule: AutomationScheduleDisplayValue): string => {
  const delayValue = Number(schedule.delayValue)
  if (
    Number.isSafeInteger(delayValue)
    && delayValue > 0
    && schedule.delayUnit
  ) {
    return `Sau ${delayValue} ${DELAY_UNIT_LABELS[schedule.delayUnit]}`
  }

  const parts: string[] = []
  if (schedule.delayDays) parts.push(`${schedule.delayDays} ngày`)
  if (schedule.delayHours) parts.push(`${schedule.delayHours} giờ`)
  return `Sau ${parts.join(' ') || '0 giờ'}`
}

export const formatAutomationScheduleLabel = (
  schedule: AutomationScheduleDisplayValue
): string => {
  if (schedule.scheduleMode === 'after_delay') {
    const delayLabel = formatDelay(schedule)
    const exactTime = normalizeTime(schedule.delayExactTime)
    return exactTime ? `${delayLabel}, chạy lúc ${exactTime} gần nhất` : delayLabel
  }

  if (schedule.scheduleMode === 'daily_time') {
    const dailyTime = normalizeTime(schedule.dailyTime)
    return dailyTime ? `Chạy lúc ${dailyTime}` : 'Chưa cấu hình giờ chạy'
  }

  if (schedule.scheduleMode === 'fixed_at') {
    return `Ngày giờ cụ thể: ${formatFixedAt(schedule.fixedAt)}`
  }

  return 'Chạy ngay'
}
