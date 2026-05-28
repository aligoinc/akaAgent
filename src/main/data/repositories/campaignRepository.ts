import {
  AccountActionLimitStatus,
  ActionLimitConfig,
  Campaign,
  CampaignInput,
  CampaignInputData,
  CampaignDetail,
  CampaignDetailStatus,
  CampaignRelationSummary
} from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapCampaignFromDB, mapCampaignInputFromDB, mapCampaignInputDataFromDB, mapCampaignDetailFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'
import * as accountActionRepo from './accountActionRepository'
import * as errorPolicyRepo from './errorPolicyRepository'

const client = () => getSupabaseClient()
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const VIETNAM_UTC_OFFSET = '+07:00'
const NEWSFEED_INTERACTION_ACTION_ID = 'facebook_newsfeed_interaction'

type CampaignScheduleType = NonNullable<Campaign['scheduleType']>

interface CampaignRelationDetailRow {
  campaign_id: number
  action_name: string | null
  status: CampaignDetailStatus
}

interface VietnamDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const vietnamDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: VIETNAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

const vietnamWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: VIETNAM_TIME_ZONE,
  weekday: 'short'
})

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function parseVietnamParts(date: Date): VietnamDateTimeParts {
  const parts = Object.fromEntries(
    vietnamDateTimeFormatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  ) as Record<string, string>

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  }
}

function makeVietnamDate(parts: Partial<VietnamDateTimeParts> & Pick<VietnamDateTimeParts, 'year' | 'month' | 'day'>): Date {
  const hour = parts.hour ?? 0
  const minute = parts.minute ?? 0
  const second = parts.second ?? 0
  return new Date(
    `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${VIETNAM_UTC_OFFSET}`
  )
}

function startOfVietnamDay(date = new Date()): Date {
  const parts = parseVietnamParts(date)
  return makeVietnamDate({ year: parts.year, month: parts.month, day: parts.day })
}

function addVietnamDays(day: Date, amount: number): Date {
  return new Date(day.getTime() + amount * 24 * 60 * 60 * 1000)
}

function withVietnamTime(day: Date, time: Pick<VietnamDateTimeParts, 'hour' | 'minute' | 'second'>): Date {
  const parts = parseVietnamParts(day)
  return makeVietnamDate({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second
  })
}

function formatVietnamTimeForQuery(date = new Date()): string {
  const parts = parseVietnamParts(date)
  return `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`
}

function getVietnamWeekdayNumber(date: Date): number {
  const weekday = vietnamWeekdayFormatter.format(date)
  switch (weekday) {
    case 'Mon': return 2
    case 'Tue': return 3
    case 'Wed': return 4
    case 'Thu': return 5
    case 'Fri': return 6
    case 'Sat': return 7
    case 'Sun': return 8
    default: return 0
  }
}

function parseNumberList(value: string | undefined, min: number, max: number): number[] {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map(item => Number(item.trim()))
      .filter(item => Number.isInteger(item) && item >= min && item <= max)
  )).sort((a, b) => a - b)
}

function resolveNextSchedule(campaign: Campaign, todayStart: Date): Date | null {
  if (!campaign.schedule) return null

  const scheduleType: CampaignScheduleType = campaign.scheduleType || 'daily'
  const timeSource = campaign.originalSchedule || campaign.schedule
  const timeDate = new Date(timeSource)
  if (Number.isNaN(timeDate.getTime())) return null
  const scheduleTime = parseVietnamParts(timeDate)

  if (scheduleType === 'daily') {
    return withVietnamTime(todayStart, scheduleTime)
  }

  if (scheduleType === 'weekly') {
    const weekDays = parseNumberList(campaign.scheduleWeekDays, 2, 8)
    if (weekDays.length === 0) return null

    for (let i = 0; i < 14; i++) {
      const candidateDay = addVietnamDays(todayStart, i)
      if (weekDays.includes(getVietnamWeekdayNumber(candidateDay))) {
        return withVietnamTime(candidateDay, scheduleTime)
      }
    }
    return null
  }

  if (scheduleType === 'monthly') {
    const monthDays = parseNumberList(campaign.scheduleDays, 1, 31)
    if (monthDays.length === 0) return null

    for (let i = 0; i < 370; i++) {
      const candidateDay = addVietnamDays(todayStart, i)
      const dayOfMonth = parseVietnamParts(candidateDay).day
      if (monthDays.includes(dayOfMonth)) {
        return withVietnamTime(candidateDay, scheduleTime)
      }
    }
    return null
  }

  return null
}

function isPastScheduleEnd(campaign: Campaign, schedule: Date): boolean {
  if (!campaign.scheduleEndDate) return false
  return schedule.getTime() > new Date(campaign.scheduleEndDate).getTime()
}

// =========== CAMPAIGNS ===========

export async function getCampaign(id: number): Promise<Campaign | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .single()

  if (error) return null
  return mapCampaignFromDB(data)
}

export async function listCampaigns(): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list campaigns: ${error.message}`)
  return (data || []).map(row => mapCampaignFromDB(row))
}

export async function createCampaign(campaign: Partial<Campaign>): Promise<Campaign> {
  const u = requireCurrentUser()
  const payload = {
    name: campaign.name,
    action_id: campaign.actionId,
    account_id: campaign.accountId,
    status: campaign.status || 'chờ xử lý',
    schedule: campaign.schedule || null,
    original_schedule: campaign.originalSchedule ?? campaign.schedule ?? null,
    schedule_type: campaign.scheduleType || 'daily',
    schedule_end_date: campaign.scheduleEndDate || null,
    daily_stop_time: campaign.dailyStopTime || null,
    schedule_days: campaign.scheduleDays || null,
    schedule_week_days: campaign.scheduleWeekDays || null,
    continue_next_day: campaign.continueNextDay ?? false,
    refresh_data: campaign.refreshData ?? false,
    time_sleep_between_2: campaign.timeSleepBetween2 ?? 30,
    content: campaign.content || '',
    extra_settings: campaign.extraSettings || {},
    images: campaign.images || [],
    log: '',
    note: campaign.note ?? null,
    staff_id: u.staffId,
    organization_id: u.organizationId
  }

  const { data, error } = await client()
    .from('auto_campaigns')
    .insert(payload)
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .single()

  if (error) throw new Error(`Failed to create campaign: ${error.message}`)
  return mapCampaignFromDB(data)
}

export async function updateCampaign(id: number, updates: Partial<Campaign>): Promise<Campaign> {
  const u = requireCurrentUser()
  const payload: any = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.actionId !== undefined) payload.action_id = updates.actionId
  if (updates.accountId !== undefined) payload.account_id = updates.accountId
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.schedule !== undefined) payload.schedule = updates.schedule
  if (updates.originalSchedule !== undefined) payload.original_schedule = updates.originalSchedule
  if (updates.scheduleType !== undefined) payload.schedule_type = updates.scheduleType
  if (updates.scheduleEndDate !== undefined) payload.schedule_end_date = updates.scheduleEndDate
  if (updates.dailyStopTime !== undefined) payload.daily_stop_time = updates.dailyStopTime || null
  if (updates.scheduleDays !== undefined) payload.schedule_days = updates.scheduleDays
  if (updates.scheduleWeekDays !== undefined) payload.schedule_week_days = updates.scheduleWeekDays
  if (updates.continueNextDay !== undefined) payload.continue_next_day = updates.continueNextDay
  if (updates.refreshData !== undefined) payload.refresh_data = updates.refreshData
  if (updates.timeSleepBetween2 !== undefined) payload.time_sleep_between_2 = updates.timeSleepBetween2
  if (updates.content !== undefined) payload.content = updates.content
  if (updates.extraSettings !== undefined) payload.extra_settings = updates.extraSettings
  if (updates.images !== undefined) payload.images = updates.images
  if (updates.log !== undefined) payload.log = updates.log
  if (updates.note !== undefined) payload.note = updates.note

  const { data, error } = await client()
    .from('auto_campaigns')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .single()

  if (error) throw new Error(`Failed to update campaign: ${error.message}`)
  return mapCampaignFromDB(data)
}

export async function deleteCampaign(id: number): Promise<void> {
  const u = requireCurrentUser()
  const { error } = await client()
    .from('auto_campaigns')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', u.staffId)

  if (error) throw new Error(`Failed to delete campaign: ${error.message}`)
}

export async function cloneCampaign(id: number): Promise<Campaign> {
  const u = requireCurrentUser()
  const { data: origCamp, error: errC } = await client()
    .from('auto_campaigns')
    .select('*')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .single()

  if (errC || !origCamp) throw new Error(`Campaign not found: ${errC?.message}`)

  const { data: newCamp, error: errInsert } = await client()
    .from('auto_campaigns')
    .insert({
      name: origCamp.name + ' (Copy)',
      action_id: origCamp.action_id,
      account_id: origCamp.account_id,
      status: 'tạm dừng',
      schedule: origCamp.schedule,
      original_schedule: origCamp.schedule,
      schedule_type: origCamp.schedule_type,
      schedule_end_date: origCamp.schedule_end_date,
      daily_stop_time: origCamp.daily_stop_time,
      schedule_days: origCamp.schedule_days,
      schedule_week_days: origCamp.schedule_week_days,
      continue_next_day: origCamp.continue_next_day,
      refresh_data: origCamp.refresh_data,
      time_sleep_between_2: origCamp.time_sleep_between_2,
      content: origCamp.content,
      extra_settings: origCamp.extra_settings,
      images: origCamp.images,
      log: '',
      note: null,
      staff_id: u.staffId,
      organization_id: u.organizationId
    })
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .single()

  if (errInsert || !newCamp) throw new Error(`Failed to insert cloned campaign: ${errInsert?.message}`)

  // Clone campaign_inputs trước (để build map oldInputId → newInputId cho input_data tham chiếu)
  const inputIdMap = new Map<number, number>()
  const { data: origInputs, error: errInputs } = await client()
    .from('auto_campaign_inputs')
    .select('*')
    .eq('campaign_id', id)
    .eq('is_delete', false)

  if (errInputs) throw new Error(`Failed to fetch original campaign inputs: ${errInputs.message}`)

  if (origInputs && origInputs.length > 0) {
    for (const inp of origInputs) {
      const { data: newInp, error: errInsertInp } = await client()
        .from('auto_campaign_inputs')
        .insert({
          campaign_id: newCamp.id,
          name: inp.name,
          phone: inp.phone,
          uid: inp.uid,
          email: inp.email,
          note: inp.note,
          status: 'chờ xử lý',
          schedule: inp.schedule
        })
        .select('id')
        .single()
      if (errInsertInp || !newInp) {
        console.warn('Failed to clone campaign input:', errInsertInp)
        continue
      }
      inputIdMap.set(inp.id as number, newInp.id as number)
    }
  }

  // Clone campaign_input_data, map input_id qua inputIdMap
  const { data: origActions, error: errActions } = await client()
    .from('auto_campaign_input_data')
    .select('*')
    .eq('campaign_id', id)
    .eq('is_delete', false)

  if (errActions) throw new Error(`Failed to fetch original campaign input data: ${errActions.message}`)

  if (origActions && origActions.length > 0) {
    const actionsToInsert = origActions.map(d => ({
      campaign_id: newCamp.id,
      input_id: d.input_id != null ? (inputIdMap.get(d.input_id as number) ?? null) : null,
      name: d.name,
      phone: d.phone,
      uid: d.uid,
      email: d.email,
      note: d.note,
      status: 'chờ xử lý',
      schedule: d.schedule
    }))

    const { error: errInsertActions } = await client()
      .from('auto_campaign_input_data')
      .insert(actionsToInsert)

    if (errInsertActions) {
      console.warn('Failed to clone campaign input data:', errInsertActions)
    }
  }

  return mapCampaignFromDB(newCamp)
}

export async function appendCampaignLog(campaignId: number, logText: string): Promise<Campaign> {
  const { data: current } = await client()
    .from('auto_campaigns')
    .select('log')
    .eq('id', campaignId)
    .single()

  const timestamp = new Date().toLocaleString('vi-VN')
  const newLog = `[${timestamp}] ${logText}`
  const fullLog = current?.log ? `${current.log}\n${newLog}` : newLog

  const { data, error } = await client()
    .from('auto_campaigns')
    .update({ log: fullLog, updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .single()

  if (error) throw new Error(`Failed to append campaign log: ${error.message}`)
  return mapCampaignFromDB(data)
}

export async function getPendingCampaigns(accountId: number): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const now = new Date()
  const currentVietnamTime = formatVietnamTimeForQuery(now)
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('status', 'chờ xử lý')
    .eq('is_delete', false)
    .lte('schedule', now.toISOString())
    .or(`daily_stop_time.is.null,daily_stop_time.gte.${currentVietnamTime}`)

  if (error) throw new Error(`Failed to get pending campaigns: ${error.message}`)
  return (data || []).map(row => mapCampaignFromDB(row))
}

export async function maintainCampaignSchedules(): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const todayStart = startOfVietnamDay()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .not('schedule', 'is', null)
    .lt('schedule', todayStart.toISOString())
    .in('status', ['chờ xử lý', 'hoàn thành'])

  if (error) throw new Error(`Failed to list stale campaign schedules: ${error.message}`)

  const updatedCampaigns: Campaign[] = []
  const campaigns = (data || []).map(row => mapCampaignFromDB(row))

  for (const campaign of campaigns) {
    try {
      const scheduleType = campaign.scheduleType || 'daily'
      const nextSchedule = resolveNextSchedule(campaign, todayStart)
      if (!nextSchedule) continue

      if (isPastScheduleEnd(campaign, nextSchedule)) {
        const updated = await updateCampaign(campaign.id, {
          schedule: nextSchedule.toISOString(),
          ...(campaign.status !== 'hoàn thành'
            ? {
              status: 'hoàn thành',
              note: 'Chiến dịch đã hết ngày kết thúc'
            }
            : {})
        })
        updatedCampaigns.push(updated)
        continue
      }

      if (scheduleType === 'daily') {
        if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
          if (campaign.status !== 'hoàn thành') {
            const updated = await updateCampaign(campaign.id, {
              status: 'hoàn thành',
              note: 'Chiến dịch lướt newsfeed không chạy tiếp qua ngày'
            })
            updatedCampaigns.push(updated)
          }
          continue
        }

        if (campaign.status !== 'chờ xử lý') continue

        if (campaign.continueNextDay) {
          const updated = await updateCampaign(campaign.id, {
            schedule: nextSchedule.toISOString()
          })
          updatedCampaigns.push(updated)
        }
        continue
      }

      const details = await listCampaignInputData(campaign.id)
      const allDataDone = details.length > 0 && details.every(detail => detail.status === 'hoàn thành')
      const shouldRefreshData = campaign.refreshData && (allDataDone || details.length === 0)

      if (shouldRefreshData) {
        if (details.length > 0) {
          const { error: resetError } = await client()
            .from('auto_campaign_input_data')
            .update({
              status: 'chờ xử lý',
              note: '',
              date_action: null
            })
            .eq('campaign_id', campaign.id)
            .eq('is_delete', false)
            .neq('status', 'tạm dừng')

          if (resetError) throw new Error(`Failed to reset campaign input data: ${resetError.message}`)
        }

        const updated = await updateCampaign(campaign.id, {
          status: 'chờ xử lý',
          schedule: nextSchedule.toISOString(),
          note: null
        })
        updatedCampaigns.push(updated)
        continue
      }

      const updated = await updateCampaign(campaign.id, {
        schedule: nextSchedule.toISOString()
      })
      updatedCampaigns.push(updated)
    } catch (err) {
      console.error(`Failed to maintain campaign schedule ${campaign.id}:`, err)
    }
  }

  return updatedCampaigns
}

async function listStaffCampaignIds(staffId: number, context: string): Promise<number[]> {
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('id')
    .eq('staff_id', staffId)

  if (error) {
    console.error(`Failed to list staff campaign ids for ${context}:`, error.message)
    return []
  }

  return (data || []).map(row => row.id as number)
}

export async function resetRunningCampaignStatuses(staffId: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaigns')
    .update({ status: 'chờ xử lý' })
    .eq('staff_id', staffId)
    .eq('status', 'đang chạy')

  if (error) console.error('Failed to reset campaign statuses:', error.message)
}

export async function resetCampaignNotes(staffId: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaigns')
    .update({ note: null, updated_at: new Date().toISOString() })
    .eq('staff_id', staffId)
    .not('note', 'is', null)

  if (error) console.error('Failed to reset campaign notes:', error.message)
}

export async function resetRunningCampaignInputStatuses(staffId: number): Promise<void> {
  const campaignIds = await listStaffCampaignIds(staffId, 'campaign input reset')
  if (campaignIds.length === 0) return

  const { error } = await client()
    .from('auto_campaign_inputs')
    .update({ status: 'chờ xử lý' })
    .in('campaign_id', campaignIds)
    .eq('status', 'đang chạy')

  if (error) console.error('Failed to reset campaign input statuses:', error.message)
}

export async function resetRunningCampaignInputDataStatuses(staffId: number): Promise<void> {
  const campaignIds = await listStaffCampaignIds(staffId, 'campaign input data reset')
  if (campaignIds.length === 0) return

  const { error } = await client()
    .from('auto_campaign_input_data')
    .update({ status: 'chờ xử lý' })
    .in('campaign_id', campaignIds)
    .eq('status', 'đang chạy')

  if (error) console.error('Failed to reset campaign input data statuses:', error.message)
}

// =========== CAMPAIGN INPUTS (pool nguyên liệu) ===========

export async function listCampaignInputs(campaignId: number): Promise<CampaignInput[]> {
  const { data, error } = await client()
    .from('auto_campaign_inputs')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list campaign inputs: ${error.message}`)
  return (data || []).map(row => mapCampaignInputFromDB(row))
}

export async function createCampaignInput(input: Partial<CampaignInput>): Promise<CampaignInput> {
  const payload = {
    campaign_id: input.campaignId,
    name: input.name || null,
    phone: input.phone || null,
    uid: input.uid || null,
    email: input.email || null,
    status: input.status || 'chờ xử lý',
    note: input.note || null,
    schedule: input.schedule || null
  }

  const { data, error } = await client()
    .from('auto_campaign_inputs')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign input: ${error.message}`)
  return mapCampaignInputFromDB(data)
}

export async function updateCampaignInput(id: number, updates: Partial<CampaignInput>): Promise<CampaignInput> {
  const payload: any = {}
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.phone !== undefined) payload.phone = updates.phone
  if (updates.uid !== undefined) payload.uid = updates.uid
  if (updates.email !== undefined) payload.email = updates.email
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.note !== undefined) payload.note = updates.note
  if (updates.schedule !== undefined) payload.schedule = updates.schedule
  if (updates.dateAction !== undefined) payload.date_action = updates.dateAction

  const { data, error } = await client()
    .from('auto_campaign_inputs')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update campaign input: ${error.message}`)
  return mapCampaignInputFromDB(data)
}

export async function deleteCampaignInput(id: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_inputs')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete campaign input: ${error.message}`)
}

// =========== CAMPAIGN INPUT DATA (việc-cần-làm) ===========

export async function listCampaignInputData(campaignId: number): Promise<CampaignInputData[]> {
  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list campaign input data: ${error.message}`)
  return (data || []).map(row => mapCampaignInputDataFromDB(row))
}

export async function listCampaignInputDataByDateActionRange(
  campaignId: number,
  startIso: string,
  endIso: string,
  limit: number
): Promise<CampaignInputData[]> {
  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .gte('date_action', startIso)
    .lt('date_action', endIso)
    .order('date_action', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list campaign input data by date_action: ${error.message}`)
  return (data || []).map(row => mapCampaignInputDataFromDB(row))
}

export async function getCampaignInputDataStatusCounts(campaignId: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const statuses: CampaignInput['status'][] = ['chờ xử lý', 'đang chạy', 'hoàn thành', 'tạm dừng', 'lỗi']

  await Promise.all(statuses.map(async status => {
    const { count, error } = await client()
      .from('auto_campaign_input_data')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('is_delete', false)
      .eq('status', status)

    if (error) throw new Error(`Failed to count campaign input data status "${status}": ${error.message}`)
    if ((count ?? 0) > 0) counts[status] = count ?? 0
  }))

  return counts
}

async function countPendingCampaignInputData(campaignId: number): Promise<number> {
  const { count, error } = await client()
    .from('auto_campaign_input_data')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .eq('status', 'chờ xử lý')

  if (error) throw new Error(`Failed to count pending campaign input data: ${error.message}`)
  return count ?? 0
}

async function listRelationDetailRows(campaignIds: number[]): Promise<CampaignRelationDetailRow[]> {
  const rows: CampaignRelationDetailRow[] = []
  const pageSize = 1000
  let from = 0

  while (true) {
    const { data, error } = await client()
      .from('auto_campaign_details')
      .select('campaign_id, action_name, status')
      .in('campaign_id', campaignIds)
      .eq('is_delete', false)
      .in('status', ['thành công', 'thất bại', 'lỗi'])
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Failed to list campaign relation details: ${error.message}`)

    const page = (data || []) as CampaignRelationDetailRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }

  return rows
}

const incrementRelationBreakdown = (
  breakdown: CampaignRelationSummary['successBreakdown'],
  actionName: string,
  status: CampaignDetailStatus
): void => {
  const existing = breakdown.find(item => item.actionName === actionName && item.status === status)
  if (existing) {
    existing.count += 1
    return
  }
  breakdown.push({ actionName, status, count: 1 })
}

const sortRelationBreakdown = (breakdown: CampaignRelationSummary['successBreakdown']): void => {
  breakdown.sort((a, b) =>
    b.count - a.count ||
    a.actionName.localeCompare(b.actionName, 'vi') ||
    a.status.localeCompare(b.status, 'vi')
  )
}

export async function listCampaignRelationSummaries(campaignIds: number[]): Promise<CampaignRelationSummary[]> {
  const u = requireCurrentUser()
  const ids = Array.from(new Set(
    campaignIds
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && id > 0)
  ))

  if (ids.length === 0) return []

  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .in('id', ids)

  if (error) throw new Error(`Failed to list campaign relation summaries: ${error.message}`)

  const campaigns = (data || []).map(row => mapCampaignFromDB(row))
  const pendingCounts = await Promise.all(
    campaigns.map(campaign => countPendingCampaignInputData(campaign.id))
  )
  const summaryById = new Map<number, CampaignRelationSummary>()

  campaigns.forEach((campaign, index) => {
    summaryById.set(campaign.id, {
      campaignId: campaign.id,
      campaignName: campaign.name,
      actionId: campaign.actionId,
      actionName: campaign.actionName,
      accountId: campaign.accountId,
      accountName: campaign.accountName,
      pendingInputCount: pendingCounts[index] ?? 0,
      successCount: 0,
      failureCount: 0,
      errorCount: 0,
      successBreakdown: [],
      failureBreakdown: []
    })
  })

  const ownedIds = Array.from(summaryById.keys())
  const details = ownedIds.length > 0 ? await listRelationDetailRows(ownedIds) : []
  for (const detail of details) {
    const summary = summaryById.get(detail.campaign_id)
    if (!summary) continue

    const actionName = String(detail.action_name || '').trim() || 'Không rõ'
    if (detail.status === 'thành công') {
      summary.successCount += 1
      incrementRelationBreakdown(summary.successBreakdown, actionName, detail.status)
    } else {
      summary.failureCount += 1
      if (detail.status === 'lỗi') summary.errorCount += 1
      incrementRelationBreakdown(summary.failureBreakdown, actionName, detail.status)
    }
  }

  for (const summary of summaryById.values()) {
    sortRelationBreakdown(summary.successBreakdown)
    sortRelationBreakdown(summary.failureBreakdown)
  }

  return ids
    .map(id => summaryById.get(id))
    .filter((summary): summary is CampaignRelationSummary => !!summary)
}

export async function createCampaignInputData(action: Partial<CampaignInputData>): Promise<CampaignInputData> {
  const payload = {
    campaign_id: action.campaignId,
    input_id: action.inputId ?? null,
    name: action.name || null,
    phone: action.phone || null,
    uid: action.uid || null,
    email: action.email || null,
    status: action.status || 'chờ xử lý',
    note: action.note || null,
    schedule: action.schedule || null
  }

  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign input data: ${error.message}`)
  return mapCampaignInputDataFromDB(data)
}

export async function updateCampaignInputData(id: number, updates: Partial<CampaignInputData>): Promise<CampaignInputData> {
  const payload: any = {}
  if (updates.inputId !== undefined) payload.input_id = updates.inputId
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.phone !== undefined) payload.phone = updates.phone
  if (updates.uid !== undefined) payload.uid = updates.uid
  if (updates.email !== undefined) payload.email = updates.email
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.note !== undefined) payload.note = updates.note
  if (updates.schedule !== undefined) payload.schedule = updates.schedule
  if (updates.dateAction !== undefined) payload.date_action = updates.dateAction

  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update campaign input data: ${error.message}`)
  return mapCampaignInputDataFromDB(data)
}

export async function resetCampaignInputDataForRerun(campaignId: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_input_data')
    .update({
      status: 'chờ xử lý',
      note: '',
      date_action: null
    })
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .neq('status', 'tạm dừng')

  if (error) throw new Error(`Failed to reset campaign input data for rerun: ${error.message}`)
}

export async function deleteCampaignInputData(id: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_input_data')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete campaign input data: ${error.message}`)
}

// =========== CAMPAIGN DETAILS (per-milestone log) ===========

export async function listCampaignDetailsByInputData(inputDataId: number): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('input_data_id', inputDataId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list campaign details: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function listCampaignDetailsByCampaign(campaignId: number): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw new Error(`Failed to list campaign details by campaign: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function listAllCampaignDetailsByCampaign(campaignId: number): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list all campaign details by campaign: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function listCampaignDetailsByCreatedAtRange(
  campaignId: number,
  startIso: string,
  endIso: string,
  limit: number
): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list campaign details by created_at: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function listCampaignErrorDetailsByCreatedAtRange(
  campaignId: number,
  startIso: string,
  endIso: string,
  limit: number
): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .or('status.eq.lỗi,error_code.not.is.null')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list campaign error details by created_at: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function listLatestCampaignErrorDetails(
  campaignId: number,
  limit: number
): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .or('status.eq.lỗi,error_code.not.is.null')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list latest campaign error details: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function createCampaignDetail(action: Partial<CampaignDetail>): Promise<CampaignDetail> {
  const payload = {
    input_data_id: action.inputDataId ?? null,
    campaign_id: action.campaignId,
    account_id: action.accountId,
    action_code: action.actionCode ?? null,
    action_name: action.actionName,
    status: action.status || 'thành công',
    error_code: action.errorCode ?? null,
    log: action.log || null,
    data: action.data || null,
    post_url: action.postUrl || null
  }

  const { data, error } = await client()
    .from('auto_campaign_details')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign detail: ${error.message}`)
  const detail = mapCampaignDetailFromDB(data)
  const shouldCountAction = detail.accountId && detail.actionCode && (
    detail.status === 'thành công' || detail.status === 'thất bại'
  )

  if (shouldCountAction) {
    try {
      await accountActionRepo.incrementAccountActionCount(detail.accountId as number, detail.actionCode as string, 1)
      await errorPolicyRepo.resetConsecutiveErrors(detail.accountId as number, detail.actionCode as string)
    } catch (countErr) {
      console.error('Failed to update account action counters:', countErr)
    }
  }

  return detail
}

export async function deleteCampaignDetail(id: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_details')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete campaign detail: ${error.message}`)
}

export async function getAccountRateLimitStatus(
  accountId: number,
  actionCode: string,
  actionName: string,
  limitConfig?: ActionLimitConfig
): Promise<AccountActionLimitStatus> {
  const normalizedActionCode = actionCode.trim()
  if (!normalizedActionCode) return { ok: true }

  const dailyLimit = limitConfig?.dailyLimit && limitConfig.dailyLimit > 0 ? limitConfig.dailyLimit : 30
  const rateLimitCount = limitConfig?.rateLimitCount && limitConfig.rateLimitCount > 0 ? limitConfig.rateLimitCount : 9
  const rateLimitMinutes = limitConfig?.rateLimitMinutes && limitConfig.rateLimitMinutes > 0 ? limitConfig.rateLimitMinutes : 65
  const actionStatus = await accountActionRepo.getAccountActionStatus(accountId, normalizedActionCode)

  if (actionStatus.isDisable) {
    const retryAfterMs = actionStatus.dateEnable
      ? Math.max(0, new Date(actionStatus.dateEnable).getTime() - Date.now())
      : undefined
    if (!actionStatus.dateEnable || retryAfterMs === undefined || retryAfterMs > 0) {
      return {
        ok: false,
        actionCode: normalizedActionCode,
        actionName,
        retryAfterMs,
        reason: retryAfterMs
          ? `Hành động "${actionName}" đang tạm dừng, còn khoảng ${Math.ceil(retryAfterMs / 60000)} phút`
          : `Hành động "${actionName}" đang tạm dừng`
      }
    }
  }

  // Chỉ đếm 'thành công' + 'thất bại' (action chạm tới FB).
  // 'lỗi' = exception code → action chưa xảy ra với FB → không tốn rate limit.
  const ratedStatuses = ['thành công', 'thất bại']
  const dailyActionCount = actionStatus.countActionInDay

  if (dailyActionCount >= dailyLimit) {
    // Daily limit → đợi tới 00:00 ngày mai mới reset
    const tomorrow = addVietnamDays(startOfVietnamDay(), 1)
    return {
      ok: false,
      actionCode: normalizedActionCode,
      actionName,
      errorCode: 'error_limit_in_day',
      isDailyLimit: true,
      retryAfterMs: tomorrow.getTime() - Date.now(),
      currentCount: dailyActionCount,
      limit: dailyLimit,
      reason: `Đạt giới hạn ngày cho hành động "${actionName}" (${dailyActionCount}/${dailyLimit})`
    }
  }

  const timeFrameStart = new Date(new Date().getTime() - rateLimitMinutes * 60 * 1000)

  const { count: windowActionCount, error: winErr } = await client()
    .from('auto_campaign_details')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('action_code', normalizedActionCode)
    .in('status', ratedStatuses)
    .gte('created_at', timeFrameStart.toISOString())

  if (winErr) throw new Error(`Window count query error: ${winErr.message}`)

  if ((windowActionCount ?? 0) >= rateLimitCount) {
    // Hourly limit → đợi tới khi row cũ nhất trong window > rateLimitMinutes phút
    const { data: oldestRow } = await client()
      .from('auto_campaign_details')
      .select('created_at')
      .eq('account_id', accountId)
      .eq('action_code', normalizedActionCode)
      .in('status', ratedStatuses)
      .gte('created_at', timeFrameStart.toISOString())
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    let retryAfterMs = rateLimitMinutes * 60 * 1000
    if (oldestRow?.created_at) {
      const oldestTime = new Date(oldestRow.created_at as string).getTime()
      retryAfterMs = Math.max(60 * 1000, (oldestTime + rateLimitMinutes * 60 * 1000) - Date.now())
    }
    return {
      ok: false,
      actionCode: normalizedActionCode,
      actionName,
      errorCode: 'error_limit_in_hour',
      isDailyLimit: false,
      retryAfterMs,
      currentCount: windowActionCount ?? 0,
      limit: rateLimitCount,
      reason: `Đạt tốc độ giới hạn hành động "${actionName}" (${windowActionCount}/${rateLimitCount} lần / ${rateLimitMinutes} phút)`
    }
  }

  return { ok: true }
}
