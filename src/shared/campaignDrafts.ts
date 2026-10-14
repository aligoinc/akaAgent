import type { CampaignConfig } from './types'
import { formatScheduleVietnam, getScheduleAiCapabilities, isScheduleDate, scheduleVietnamToIso } from './campaignScheduleAi'
import { parseDailyTimeSlots } from './campaignTimeSlots'

export const CAMPAIGN_DRAFT_VERSION = 1
export const CAMPAIGN_DRAFT_SCHEDULE_TIME_ZONE = 'Asia/Ho_Chi_Minh'
/** Business state only. New form fields are captured without a DB column migration. */
export interface CampaignDraftPayload {
  version: number
  values: Record<string, unknown>
  /** Missing on legacy drafts, whose start date/time was interpreted in the host timezone. */
  scheduleTimeZone?: typeof CAMPAIGN_DRAFT_SCHEDULE_TIME_ZONE
  /** Exact legacy instants retained only while their corresponding controls are unchanged. */
  preservedSchedule?: CampaignDraftPreservedSchedule
  baseCampaign?: Partial<CampaignConfig>
  cloneSourceCampaignId?: number
}

export interface CampaignDraftPreservedSchedule {
  multiSlotStart?: { iso: string; schedule: string; actionId: string; slots: string[] }
  end?: { iso: string; date: string }
}

export interface CampaignDraftSummary {
  id: string
  name: string
  actionId: string
  accountIds: number[]
  schedule: string
  updatedAt: string
  revision: number
}

export interface CampaignDraft extends CampaignDraftSummary {
  payload: CampaignDraftPayload
  isDelete: boolean
  deletionReason: 'user_deleted' | 'converted' | null
  campaignIds: number[]
}

export interface SaveCampaignDraftRequest {
  id: string
  revision: number
  payload: CampaignDraftPayload
}

export interface CampaignDraftPage {
  items: CampaignDraftSummary[]
  total: number
}

/** Metadata only; campaigns have already been created by the normal save flow. */
export interface CompleteCampaignDraftRequest {
  id: string
  revision: number
  campaignIds: number[]
}

export function isDraftRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function activeDraftTimeSlots(form: Record<string, unknown>): string[] {
  const cap = getScheduleAiCapabilities({ actionId: String(form.actionId || ''),
    dataTargetSourceMode: form.dataTargetSourceMode === 'data_group' ? 'data_group' : 'direct' })
  if (!cap.multiSlots || form.multiDailyTimeSlotsEnabled !== true) return []
  const parsed = parseDailyTimeSlots(String(form.multiDailyTimeSlots || ''))
  return parsed.invalidItems.length ? [] : parsed.slots
}

/** A date control cannot represent an existing cutoff that is not Vietnam end-of-day. */
export function preserveCampaignEndDate(value?: string | null): CampaignDraftPreservedSchedule['end'] {
  if (!value) return undefined
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return undefined
  const iso = parsed.toISOString(), date = formatScheduleVietnam(parsed).slice(0, 10)
  return iso === scheduleVietnamToIso(`${date}T23:59:59`) ? undefined : { iso, date }
}

export function preserveCampaignSchedule(
  form: Record<string, unknown>, startIso?: string | null, endIso?: string | null
): CampaignDraftPreservedSchedule | undefined {
  const slots = activeDraftTimeSlots(form)
  const start = startIso ? new Date(startIso) : undefined
  const schedule = start ? formatScheduleVietnam(start) : ''
  const multiSlotStart = schedule && form.schedule === schedule && slots.length
    && start!.toISOString() !== scheduleVietnamToIso(`${schedule.split('T')[0]}T${slots[0]}`)
    ? { iso: start!.toISOString(), schedule, actionId: String(form.actionId), slots } : undefined
  const end = preserveCampaignEndDate(endIso)
  return multiSlotStart || end ? { multiSlotStart, end } : undefined
}

/** Drop obsolete overrides when dates, times, slots, action or source are edited. */
export function getPreservedCampaignDraftSchedule(
  saved: CampaignDraftPreservedSchedule | undefined,
  form: Record<string, unknown>
): CampaignDraftPreservedSchedule | undefined {
  if (!saved) return undefined
  const start = saved.multiSlotStart
  const slots = activeDraftTimeSlots(form)
  const multiSlotStart = start && slots.length > 0 && start.actionId === form.actionId
    && start.schedule === form.schedule && start.slots.join(',') === slots.join(',') ? start : undefined
  const end = saved.end?.date === form.scheduleEndDate ? saved.end : undefined
  return multiSlotStart || end ? { multiSlotStart, end } : undefined
}

/** Normalize once at form initialization; never mutate or automatically persist the saved draft. */
export function restoreCampaignDraftSchedule(payload: CampaignDraftPayload | undefined): CampaignDraftPayload | undefined {
  if (!payload || payload.scheduleTimeZone === CAMPAIGN_DRAFT_SCHEDULE_TIME_ZONE) return payload
  const form = payload.values.formData
  if (!isDraftRecord(form) || typeof form.schedule !== 'string' || !form.schedule.trim()) return payload
  // Match the old form's conversion before rendering the same instant in Vietnam time.
  // Legacy drafts did not record their originating timezone; retain the existing host-local interpretation.
  const slots = activeDraftTimeSlots(form)
  // The old Save path replaced the displayed time with the first slot before converting to ISO.
  const legacyStart = slots.length ? `${form.schedule.split('T')[0]}T${slots[0]}` : form.schedule
  const startDate = new Date(legacyStart)
  const schedule = formatScheduleVietnam(startDate)
  if (!schedule) return payload
  const oldEnd = typeof form.scheduleEndDate === 'string' && isScheduleDate(form.scheduleEndDate)
    ? new Date(`${form.scheduleEndDate}T23:59:59`) : undefined
  const restored = { ...form, schedule,
    ...(oldEnd ? { scheduleEndDate: formatScheduleVietnam(oldEnd).slice(0, 10) } : {}) }
  return {
    ...payload,
    scheduleTimeZone: CAMPAIGN_DRAFT_SCHEDULE_TIME_ZONE,
    preservedSchedule: preserveCampaignSchedule(restored, startDate.toISOString(), oldEnd?.toISOString()),
    values: { ...payload.values, formData: restored }
  }
}

/** Merge missing nested defaults; arrays and explicit false/0/empty/null are preserved. */
export function restoreCampaignDraftValue<T>(defaults: T, saved: unknown): T {
  if (saved === undefined) return defaults
  if (!isDraftRecord(defaults) || !isDraftRecord(saved)) return saved as T
  const result: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(saved)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    result[key] = restoreCampaignDraftValue(result[key], value)
  }
  return result as T
}

export function validateCampaignDraftPayload(payload: CampaignDraftPayload): void {
  if (!payload || payload.version !== CAMPAIGN_DRAFT_VERSION || !isDraftRecord(payload.values)) {
    throw new Error('Phiên bản bản nháp chưa được hỗ trợ. Vui lòng cập nhật ứng dụng.')
  }
  const form = payload.values.formData
  if (!isDraftRecord(form) || typeof form.name !== 'string' || !form.name.trim()
    || typeof form.actionId !== 'string' || !form.actionId.trim()
    || !Array.isArray(form.accountIds) || form.accountIds.length === 0
    || form.accountIds.some(id => !Number.isSafeInteger(id) || Number(id) <= 0)) {
    throw new Error('Vui lòng nhập Tên, Hành động và Tài khoản để lưu nháp.')
  }
  if (typeof form.schedule !== 'string' || !form.schedule.trim() || !Number.isFinite(Date.parse(form.schedule))) {
    throw new Error('Vui lòng chọn lịch gửi hợp lệ để lưu nháp.')
  }
}

export const CAMPAIGN_DRAFT_IPC = {
  list: 'campaign-drafts:list',
  get: 'campaign-drafts:get',
  save: 'campaign-drafts:save',
  delete: 'campaign-drafts:delete',
  complete: 'campaign-drafts:complete'
} as const
