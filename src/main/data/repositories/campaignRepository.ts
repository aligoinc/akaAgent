import { Campaign, CampaignDetail, CampaignDetailAction } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapCampaignFromDB, mapCampaignDetailFromDB, mapDetailActionFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()

// =========== CAMPAIGNS ===========

export async function getCampaign(id: number): Promise<Campaign | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), org_channels(name)')
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
    .select('*, auto_campaign_actions(name), org_channels(name)')
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
    channel_id: campaign.channelId,
    status: campaign.status || 'chờ xử lý',
    schedule: campaign.schedule || null,
    schedule_type: campaign.scheduleType || 'daily',
    schedule_end_date: campaign.scheduleEndDate || null,
    schedule_days: campaign.scheduleDays || null,
    schedule_week_days: campaign.scheduleWeekDays || null,
    continue_next_day: campaign.continueNextDay ?? false,
    refresh_data: campaign.refreshData ?? false,
    time_sleep_between_2: campaign.timeSleepBetween2 || 30,
    content: campaign.content || '',
    extra_settings: campaign.extraSettings || {},
    images: campaign.images || [],
    log: '',
    staff_id: u.staffId,
    organization_id: u.organizationId
  }

  const { data, error } = await client()
    .from('auto_campaigns')
    .insert(payload)
    .select('*, auto_campaign_actions(name), org_channels(name)')
    .single()

  if (error) throw new Error(`Failed to create campaign: ${error.message}`)
  return mapCampaignFromDB(data)
}

export async function updateCampaign(id: number, updates: Partial<Campaign>): Promise<Campaign> {
  const u = requireCurrentUser()
  const payload: any = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.actionId !== undefined) payload.action_id = updates.actionId
  if (updates.channelId !== undefined) payload.channel_id = updates.channelId
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.schedule !== undefined) payload.schedule = updates.schedule
  if (updates.scheduleType !== undefined) payload.schedule_type = updates.scheduleType
  if (updates.scheduleEndDate !== undefined) payload.schedule_end_date = updates.scheduleEndDate
  if (updates.scheduleDays !== undefined) payload.schedule_days = updates.scheduleDays
  if (updates.scheduleWeekDays !== undefined) payload.schedule_week_days = updates.scheduleWeekDays
  if (updates.continueNextDay !== undefined) payload.continue_next_day = updates.continueNextDay
  if (updates.refreshData !== undefined) payload.refresh_data = updates.refreshData
  if (updates.timeSleepBetween2 !== undefined) payload.time_sleep_between_2 = updates.timeSleepBetween2
  if (updates.content !== undefined) payload.content = updates.content
  if (updates.extraSettings !== undefined) payload.extra_settings = updates.extraSettings
  if (updates.images !== undefined) payload.images = updates.images
  if (updates.log !== undefined) payload.log = updates.log

  const { data, error } = await client()
    .from('auto_campaigns')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select('*, auto_campaign_actions(name), org_channels(name)')
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
      channel_id: origCamp.channel_id,
      status: 'chờ xử lý',
      schedule: origCamp.schedule,
      schedule_type: origCamp.schedule_type,
      schedule_end_date: origCamp.schedule_end_date,
      schedule_days: origCamp.schedule_days,
      schedule_week_days: origCamp.schedule_week_days,
      continue_next_day: origCamp.continue_next_day,
      refresh_data: origCamp.refresh_data,
      time_sleep_between_2: origCamp.time_sleep_between_2,
      content: origCamp.content,
      extra_settings: origCamp.extra_settings,
      images: origCamp.images,
      log: '',
      staff_id: u.staffId,
      organization_id: u.organizationId
    })
    .select('*, auto_campaign_actions(name), org_channels(name)')
    .single()

  if (errInsert || !newCamp) throw new Error(`Failed to insert cloned campaign: ${errInsert?.message}`)

  const { data: origDetails, error: errDetails } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', id)
    .eq('is_delete', false)

  if (errDetails) throw new Error(`Failed to fetch original details: ${errDetails.message}`)

  if (origDetails && origDetails.length > 0) {
    const detailsToInsert = origDetails.map(d => ({
      campaign_id: newCamp.id,
      name: d.name,
      phone: d.phone,
      uid: d.uid,
      email: d.email,
      note: d.note,
      status: 'chờ xử lý',
      schedule: d.schedule
    }))

    const { error: errInsertDetails } = await client()
      .from('auto_campaign_details')
      .insert(detailsToInsert)

    if (errInsertDetails) {
      console.warn('Failed to clone campaign details:', errInsertDetails)
    }
  }

  return mapCampaignFromDB(newCamp)
}

export async function appendCampaignLog(campaignId: number, logText: string): Promise<void> {
  const { data: current } = await client()
    .from('auto_campaigns')
    .select('log')
    .eq('id', campaignId)
    .single()

  const timestamp = new Date().toLocaleString('vi-VN')
  const newLog = `[${timestamp}] ${logText}`
  const fullLog = current?.log ? `${current.log}\n${newLog}` : newLog

  const { error } = await client()
    .from('auto_campaigns')
    .update({ log: fullLog, updated_at: new Date().toISOString() })
    .eq('id', campaignId)

  if (error) throw new Error(`Failed to append campaign log: ${error.message}`)
}

export async function getPendingCampaigns(channelId: number): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), org_channels(name)')
    .eq('channel_id', channelId)
    .eq('staff_id', u.staffId)
    .eq('status', 'chờ xử lý')
    .eq('is_delete', false)
    .lte('schedule', new Date().toISOString())

  if (error) throw new Error(`Failed to get pending campaigns: ${error.message}`)
  return (data || []).map(row => mapCampaignFromDB(row))
}

export async function resetRunningCampaignStatuses(): Promise<void> {
  const { error } = await client()
    .from('auto_campaigns')
    .update({ status: 'chờ xử lý' })
    .eq('status', 'đang chạy')

  if (error) console.error('Failed to reset campaign statuses:', error.message)
}

export async function resetRunningDetailStatuses(): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_details')
    .update({ status: 'chờ xử lý' })
    .eq('status', 'đang chạy')

  if (error) console.error('Failed to reset detail statuses:', error.message)
}

// =========== CAMPAIGN DETAILS ===========

export async function listCampaignDetails(campaignId: number): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list campaign details: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function createCampaignDetail(detail: Partial<CampaignDetail>): Promise<CampaignDetail> {
  const payload = {
    campaign_id: detail.campaignId,
    name: detail.name || null,
    phone: detail.phone || null,
    uid: detail.uid || null,
    email: detail.email || null,
    status: detail.status || 'chờ xử lý',
    note: detail.note || null,
    schedule: detail.schedule || null
  }

  const { data, error } = await client()
    .from('auto_campaign_details')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign detail: ${error.message}`)
  return mapCampaignDetailFromDB(data)
}

export async function updateCampaignDetail(id: number, updates: Partial<CampaignDetail>): Promise<CampaignDetail> {
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
    .from('auto_campaign_details')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update campaign detail: ${error.message}`)
  return mapCampaignDetailFromDB(data)
}

export async function deleteCampaignDetail(id: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_details')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete campaign detail: ${error.message}`)
}

// =========== CAMPAIGN DETAIL ACTIONS ===========

export async function listDetailActions(detailId: number): Promise<CampaignDetailAction[]> {
  const { data, error } = await client()
    .from('auto_campaign_detail_actions')
    .select('*')
    .eq('campaign_detail_id', detailId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list detail actions: ${error.message}`)
  return (data || []).map(row => mapDetailActionFromDB(row))
}

export async function listDetailActionsByCampaign(campaignId: number): Promise<CampaignDetailAction[]> {
  const { data, error } = await client()
    .from('auto_campaign_detail_actions')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw new Error(`Failed to list detail actions by campaign: ${error.message}`)
  return (data || []).map(row => mapDetailActionFromDB(row))
}

export async function createDetailAction(action: Partial<CampaignDetailAction>): Promise<CampaignDetailAction> {
  const payload = {
    campaign_detail_id: action.campaignDetailId,
    campaign_id: action.campaignId,
    channel_id: action.channelId,
    action_name: action.actionName,
    status: action.status || 'success',
    log: action.log || null,
    data: action.data || null,
    post_url: action.postUrl || null
  }

  const { data, error } = await client()
    .from('auto_campaign_detail_actions')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create detail action: ${error.message}`)
  return mapDetailActionFromDB(data)
}

export async function deleteDetailAction(id: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_detail_actions')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete detail action: ${error.message}`)
}

export async function getChannelRateLimitStatus(
  channelId: number,
  actionName: string,
  limitConfig?: { dailyLimit?: number; rateLimitCount?: number; rateLimitMinutes?: number }
): Promise<{ ok: boolean, reason?: string }> {
  const dailyLimit = limitConfig?.dailyLimit && limitConfig.dailyLimit > 0 ? limitConfig.dailyLimit : 30
  const rateLimitCount = limitConfig?.rateLimitCount && limitConfig.rateLimitCount > 0 ? limitConfig.rateLimitCount : 9
  const rateLimitMinutes = limitConfig?.rateLimitMinutes && limitConfig.rateLimitMinutes > 0 ? limitConfig.rateLimitMinutes : 60

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { count: dailyActionCount, error: dailyErr } = await client()
    .from('auto_campaign_detail_actions')
    .select('*', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .eq('action_name', actionName)
    .gte('created_at', today.toISOString())

  if (dailyErr) throw new Error(`Daily count query error: ${dailyErr.message}`)

  if ((dailyActionCount ?? 0) >= dailyLimit) {
    return { ok: false, reason: `Đạt giới hạn ngày cho hành động "${actionName}" (${dailyActionCount}/${dailyLimit})` }
  }

  const timeFrameStart = new Date(new Date().getTime() - rateLimitMinutes * 60 * 1000)

  const { count: windowActionCount, error: winErr } = await client()
    .from('auto_campaign_detail_actions')
    .select('*', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .eq('action_name', actionName)
    .gte('created_at', timeFrameStart.toISOString())

  if (winErr) throw new Error(`Window count query error: ${winErr.message}`)

  if ((windowActionCount ?? 0) >= rateLimitCount) {
    return { ok: false, reason: `Đạt tốc độ giới hạn hành động "${actionName}" (${windowActionCount}/${rateLimitCount} lần / ${rateLimitMinutes} phút)` }
  }

  return { ok: true }
}
