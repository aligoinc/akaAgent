export const CAMPAIGN_SCHEDULE_AI_CODE = 'app_campaign_schedule'
export { CAMPAIGN_FORM_AI_MODEL as CAMPAIGN_SCHEDULE_AI_MODEL, CAMPAIGN_FORM_AI_TIMEOUT as CAMPAIGN_SCHEDULE_AI_TIMEOUT } from './campaignFormAi'
import { CAMPAIGN_FORM_AI_MAX_PROMPT as CAMPAIGN_SCHEDULE_AI_MAX_PROMPT } from './campaignFormAi'
export { CAMPAIGN_SCHEDULE_AI_MAX_PROMPT }
export const CAMPAIGN_SCHEDULE_AI_IPC = {
  generate: 'campaign-schedule-ai:generate', cancel: 'campaign-schedule-ai:cancel'
} as const

export const SCHEDULE_AI_MESSAGES = {
  unclear: 'Chưa hiểu yêu cầu của bạn. Vui lòng mô tả rõ hơn lịch muốn chạy.',
  unsupported: 'Lịch bạn yêu cầu chưa được hỗ trợ cho loại chiến dịch này.',
  invalid: 'AI chưa xử lý được yêu cầu. Vui lòng thử lại.',
  unavailable: 'AI tạm thời chưa phản hồi. Vui lòng thử lại sau.'
} as const

export interface ScheduleAiFields {
  scheduleType: 'daily' | 'weekly' | 'monthly'
  startDate: string
  startTime: string
  scheduleEndDate: string
  scheduleDays: string
  scheduleWeekDays: string
  useDailyStopTime: boolean
  dailyStopTime: string
  continueNextDay: boolean
  refreshData: boolean
  findDataRerunEnabled: boolean
  findDataRerunAfterHours: number
  multiDailyTimeSlotsEnabled: boolean
  multiDailyTimeSlots: string
}
export interface ScheduleAiContext {
  actionId: string
  dataTargetSourceMode: 'direct' | 'data_group'
}
export interface ScheduleAiRequest {
  requestId: string
  description: string
  context: ScheduleAiContext
  schedule: ScheduleAiFields
}
export type ScheduleAiPatch = Partial<ScheduleAiFields>
export type ScheduleAiResult =
  | { ok: true; patch: ScheduleAiPatch }
  | { ok: false; code: keyof typeof SCHEDULE_AI_MESSAGES | 'cancelled'; message: string }

// These are form capabilities, not scheduler or save-time business validation.
export function getScheduleAiCapabilities(context: ScheduleAiContext) {
  const id = context.actionId
  const mobile = id === 'sms_send' || id === 'voice_call'
  const realtime = id === 'zalo_message_group_realtime'
  const birthday = id === 'zalo_message_birthday'
  const newsfeed = id === 'facebook_newsfeed_interaction'
  const group = context.dataTargetSourceMode === 'data_group'
  return {
    scheduleTypes: mobile || realtime ? ['daily'] : ['daily', 'weekly', 'monthly'],
    endDate: !mobile && !realtime,
    stopTime: !mobile,
    continueNextDay: !mobile && !newsfeed && !birthday && !realtime,
    refreshData: !group && !mobile && !birthday && !realtime
      && id !== 'zalo_message_friend_recommendation' && id !== 'zalo_cancel_sent_friend_request',
    rerun: !group && ['facebook_find_data_group', 'facebook_find_data_search',
      'facebook_comment_seeding', 'facebook_newsfeed_interaction'].includes(id),
    multiSlots: !group && ['facebook_timeline_post', 'facebook_page_post',
      'zalo_message_friend', 'zalo_message_group'].includes(id)
  }
}

const fieldTypes = {
  scheduleType: 'string', startDate: 'string', startTime: 'string', scheduleEndDate: 'string',
  scheduleDays: 'string', scheduleWeekDays: 'string', useDailyStopTime: 'boolean', dailyStopTime: 'string',
  continueNextDay: 'boolean', refreshData: 'boolean', findDataRerunEnabled: 'boolean',
  findDataRerunAfterHours: 'number', multiDailyTimeSlotsEnabled: 'boolean', multiDailyTimeSlots: 'string'
} as const
const fields = Object.keys(fieldTypes) as (keyof ScheduleAiFields)[]

export const SCHEDULE_AI_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['status', 'reason', 'changes'],
  properties: {
    status: { type: 'string', enum: ['ok', 'unclear', 'unsupported'] },
    reason: { type: 'string', maxLength: 300 },
    changes: {
      type: 'object', additionalProperties: false, required: fields,
      properties: Object.fromEntries(fields.map(key => [key, key === 'scheduleType'
        ? { type: ['string', 'null'], enum: ['daily', 'weekly', 'monthly', null] }
        : { type: [fieldTypes[key], 'null'] }]))
    }
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const time = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
export function isScheduleDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateScheduleAiRequest(value: unknown): ScheduleAiRequest {
  if (!record(value) || typeof value.requestId !== 'string'
    || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.requestId)
    || typeof value.description !== 'string' || !value.description.trim()
    || value.description.length > CAMPAIGN_SCHEDULE_AI_MAX_PROMPT
    || !record(value.context) || typeof value.context.actionId !== 'string'
    || !/^[a-z][a-z0-9_]{0,119}$/.test(value.context.actionId)
    || !['direct', 'data_group'].includes(String(value.context.dataTargetSourceMode))
    || !record(value.schedule)) throw new Error(SCHEDULE_AI_MESSAGES.invalid)
  const schedule: Record<string, unknown> = {}
  for (const key of fields) {
    const item = value.schedule[key]
    if (typeof item !== fieldTypes[key] || typeof item === 'string' && item.length > 2000
      || typeof item === 'number' && !Number.isFinite(item)) throw new Error(SCHEDULE_AI_MESSAGES.invalid)
    schedule[key] = item
  }
  if (!['daily', 'weekly', 'monthly'].includes(String(schedule.scheduleType))) throw new Error(SCHEDULE_AI_MESSAGES.invalid)
  // Explicitly project input: renderer data cannot override prompts, models or credentials.
  return { requestId: value.requestId, description: value.description.trim(),
    context: { actionId: value.context.actionId, dataTargetSourceMode: value.context.dataTargetSourceMode as ScheduleAiContext['dataTargetSourceMode'] },
    schedule: schedule as unknown as ScheduleAiFields }
}

function normalizeDayList(value: string, min: number, max: number): string {
  if (!value) return ''
  const days = value.split(',').map(item => item.trim())
  if (days.some(day => !/^\d{1,2}$/.test(day) || Number(day) < min || Number(day) > max)) throw new Error(SCHEDULE_AI_MESSAGES.invalid)
  return Array.from(new Set(days.map(Number))).sort((a, b) => a - b).join(',')
}

export function parseScheduleAiResponse(content: string, request: Pick<ScheduleAiRequest, 'context' | 'schedule'>): ScheduleAiResult {
  const invalid = (): ScheduleAiResult => ({ ok: false, code: 'invalid', message: SCHEDULE_AI_MESSAGES.invalid })
  try {
    if (content.length > 16_000) return invalid()
    const result: unknown = JSON.parse(content)
    if (!record(result) || Object.keys(result).sort().join(',') !== 'changes,reason,status'
      || !['ok', 'unclear', 'unsupported'].includes(String(result.status))
      || typeof result.reason !== 'string' || result.reason.length > 300 || !record(result.changes)
      || Object.keys(result.changes).sort().join(',') !== [...fields].sort().join(',')) return invalid()
    const patch: ScheduleAiPatch = {}
    for (const key of fields) {
      const value = result.changes[key]
      if (value === null) continue // null means leave this field unchanged; empty string explicitly clears it.
      if (typeof value !== fieldTypes[key] || typeof value === 'string' && value.length > 2000
        || typeof value === 'number' && !Number.isFinite(value)) return invalid()
      Object.assign(patch, { [key]: value })
    }
    if (result.status !== 'ok') {
      if (Object.keys(patch).length) return invalid()
      const code = result.status as 'unclear' | 'unsupported'
      return { ok: false, code, message: SCHEDULE_AI_MESSAGES[code]
        + (result.reason.trim() ? ` ${result.reason.trim()}` : '') }
    }
    // An understood request may already match the form; no fields need capability checks then.
    if (!Object.keys(patch).length) return { ok: true, patch }
    const cap = getScheduleAiCapabilities(request.context)
    const targetType = patch.scheduleType ?? request.schedule.scheduleType
    if (patch.scheduleType !== undefined && !['daily', 'weekly', 'monthly'].includes(patch.scheduleType)) return invalid()
    const supported = cap.scheduleTypes.includes(targetType)
      && (patch.scheduleEndDate === undefined || cap.endDate && targetType !== 'daily')
      && (patch.scheduleDays === undefined || targetType === 'monthly')
      && (patch.scheduleWeekDays === undefined || targetType === 'weekly')
      && (patch.useDailyStopTime === undefined && patch.dailyStopTime === undefined || cap.stopTime)
      && (patch.continueNextDay === undefined || cap.continueNextDay && targetType === 'daily')
      && (patch.refreshData === undefined || cap.refreshData && targetType !== 'daily')
      && (patch.findDataRerunEnabled === undefined && patch.findDataRerunAfterHours === undefined || cap.rerun)
      && (patch.multiDailyTimeSlotsEnabled === undefined && patch.multiDailyTimeSlots === undefined || cap.multiSlots)
    if (!supported) return { ok: false, code: 'unsupported', message: SCHEDULE_AI_MESSAGES.unsupported }
    if (patch.startDate !== undefined && !isScheduleDate(patch.startDate)
      || patch.scheduleEndDate && !isScheduleDate(patch.scheduleEndDate)
      || patch.startTime !== undefined && !time(patch.startTime)
      || patch.dailyStopTime !== undefined && !time(patch.dailyStopTime)) return invalid()
    if (patch.scheduleDays !== undefined) patch.scheduleDays = normalizeDayList(patch.scheduleDays, 1, 31)
    if (patch.scheduleWeekDays !== undefined) patch.scheduleWeekDays = normalizeDayList(patch.scheduleWeekDays, 2, 8)
    if (patch.multiDailyTimeSlots !== undefined) {
      const slots = patch.multiDailyTimeSlots.split(',').map(item => item.trim()).filter(Boolean)
      if (slots.some(slot => !time(slot))) return invalid()
      patch.multiDailyTimeSlots = Array.from(new Set(slots)).sort().join(', ')
      if (patch.multiDailyTimeSlots && patch.multiDailyTimeSlotsEnabled === undefined) patch.multiDailyTimeSlotsEnabled = true
    }
    if (patch.dailyStopTime !== undefined && patch.useDailyStopTime === undefined) patch.useDailyStopTime = true
    if (patch.findDataRerunAfterHours !== undefined && patch.findDataRerunEnabled === undefined) patch.findDataRerunEnabled = true
    // Do not compare start/end, stop/run, 23:59, slot count or rerun interval here.
    // The existing Save flow owns these business rules, exactly as for manual input.
    return { ok: true, patch }
  } catch { return invalid() }
}

export function scheduleAiSnapshot(form: Omit<ScheduleAiFields, 'startDate' | 'startTime'> & { schedule: string }): ScheduleAiFields {
  return Object.fromEntries(fields.map(key => [key,
    key === 'startDate' ? form.schedule.split('T')[0] || ''
      : key === 'startTime' ? form.schedule.split('T')[1]?.slice(0, 5) || '' : form[key]
  ])) as unknown as ScheduleAiFields
}

export function applyScheduleAiPatch<T extends { schedule: string }>(form: T, patch: ScheduleAiPatch): T {
  const { startDate, startTime, ...rest } = patch
  return { ...form, ...rest, schedule: startDate !== undefined || startTime !== undefined
    ? `${startDate ?? form.schedule.split('T')[0]}T${startTime ?? form.schedule.split('T')[1]?.slice(0, 5)}` : form.schedule }
}

export function formatScheduleVietnam(date: Date): string {
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16)
}
export function scheduleVietnamToIso(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(`${value}+07:00`)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}
