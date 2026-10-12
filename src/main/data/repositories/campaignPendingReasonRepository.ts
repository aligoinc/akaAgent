import type { AutoAccount, Campaign, CampaignAction } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'
import { mapAccountFromDB, mapCampaignActionFromDB, mapCampaignFromDB } from '../mappers'

// On-demand diagnostics use the existing HTTP client. Never load log/session/password fields.
const campaignFields = 'id,name,account_id,action_id,status,note,is_delete,staff_id,organization_id,schedule,original_schedule,schedule_type,schedule_days,schedule_week_days,schedule_end_date,daily_stop_time,continue_next_day,extra_settings,data_target_source_mode,data_group_id,provisioning_state,updated_at,runtime_claim_token,runtime_unit_token'
const accountFields = 'id,name,flatform_type,status,login_status,is_active,is_delete,is_zalo_show_web,is_zalo_server,facebook_login_managed,staff_id,organization_id,rate_limit_minutes,runtime_operation_claim_token,auto_account_groups(organization_id,is_active,is_delete,settings)'

export async function readPendingReasonCampaign(id: number, signal: AbortSignal): Promise<{ campaign: Campaign; hasClaim: boolean } | null> {
  signal.throwIfAborted()
  const user = requireCurrentUser()
  const { data, error } = await getSupabaseClient().from('auto_campaigns').select(campaignFields)
    .eq('id', id).eq('staff_id', user.staffId)
    .or(`organization_id.is.null,organization_id.eq.${user.organizationId}`).abortSignal(signal).maybeSingle()
  if (error) throw error
  if (!data) return null
  return { campaign: mapCampaignFromDB({ ...data, log: '' }), hasClaim: !!(data.runtime_claim_token || data.runtime_unit_token) }
}

export async function readPendingReasonAccount(id: number, signal: AbortSignal): Promise<{ account: AutoAccount; hasOperation: boolean; isChatManaged: boolean } | null> {
  signal.throwIfAborted()
  const user = requireCurrentUser()
  const { data, error } = await getSupabaseClient().from('auto_accounts').select(accountFields)
    .eq('id', id).eq('staff_id', user.staffId)
    .or(`organization_id.is.null,organization_id.eq.${user.organizationId}`).abortSignal(signal).maybeSingle()
  if (error) throw error
  if (!data) return null
  const account = mapAccountFromDB(data)
  const isChatManaged = user.isChatSync === true && Number(data.organization_id) === user.organizationId
    && account.flatformType === 'zalo' && account.isZaloServer === true && !account.isZaloShowWeb
  const group = data.auto_account_groups as unknown as Record<string, unknown> | null
  // akaChat's executor only joins active, nondeleted groups from the same tenant.
  // Leave the legacy scheduler's diagnostic snapshot unchanged.
  if (isChatManaged && (!group || group.is_active !== true || group.is_delete === true
    || Number(group.organization_id) !== user.organizationId)) account.accountGroupSettings = null
  return { account, hasOperation: !!data.runtime_operation_claim_token, isChatManaged }
}

export async function readPendingReasonAction(id: string, signal: AbortSignal): Promise<CampaignAction | null> {
  signal.throwIfAborted()
  const { data, error } = await getSupabaseClient().from('auto_campaign_actions')
    .select('id,name,flatform_type,is_active,is_delete,workflow_id,test_workflow_id,limit_check_action_codes')
    .eq('id', id).abortSignal(signal).maybeSingle()
  if (error) throw error
  return data ? mapCampaignActionFromDB(data) : null
}

export async function readBusyCampaign(campaign: Campaign, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted()
  const user = requireCurrentUser()
  const { data, error } = await getSupabaseClient().from('auto_campaigns').select('id,name')
    .eq('account_id', campaign.accountId).eq('staff_id', user.staffId).neq('id', campaign.id)
    .or(`organization_id.is.null,organization_id.eq.${user.organizationId}`)
    .or('status.eq.đang chạy,runtime_claim_token.not.is.null,runtime_unit_token.not.is.null')
    .order('id').limit(1).abortSignal(signal)
  if (error) throw error
  return data?.[0]?.name || null
}

export type PendingInputAvailability =
  | { state: 'due' | 'paused' | 'finished' | 'empty' }
  | { state: 'future'; scheduledAt: string }

export async function readPendingInputAvailability(campaignId: number, dbNow: string, signal: AbortSignal): Promise<PendingInputAvailability> {
  // Bounded probes only; retain the nearest future schedule for the full note.
  const base = () => {
    signal.throwIfAborted()
    return getSupabaseClient().from('auto_campaign_input_data').select('id')
      .eq('campaign_id', campaignId).eq('is_delete', false)
  }
  const due = await base().eq('status', 'chờ xử lý').or(`schedule.is.null,schedule.lte.${dbNow}`).limit(1).abortSignal(signal)
  if (due.error) throw due.error
  if (due.data?.length) return { state: 'due' }
  const future = await base().select('id,schedule').eq('status', 'chờ xử lý').gt('schedule', dbNow)
    .order('schedule', { ascending: true }).limit(1).abortSignal(signal)
  if (future.error) throw future.error
  if (future.data?.length) return { state: 'future', scheduledAt: future.data[0].schedule }
  const paused = await base().eq('status', 'tạm dừng').limit(1).abortSignal(signal)
  if (paused.error) throw paused.error
  if (paused.data?.length) return { state: 'paused' }
  const any = await base().limit(1).abortSignal(signal)
  if (any.error) throw any.error
  return { state: any.data?.length ? 'finished' : 'empty' }
}

const findDataLinks: Record<string, [string, string]> = {
  facebook_message_uid: ['findUidTargetCampaignIds', 'isFindUid'],
  facebook_comment_seeding_post: ['findPostLinkTargetCampaignIds', 'isFindPostLink'],
  zalo_message_phone: ['findPhoneZaloMessagePhoneTargetCampaignIds', 'isFindPhone'],
  zalo_join_group_link: ['findZaloGroupLinkJoinTargetCampaignIds', 'isFindLinkGroupZalo'],
  facebook_group_post: ['findFacebookGroupPostTargetCampaignIds', 'isFindFacebookGroup'],
  facebook_comment_seeding: ['findFacebookGroupCommentTargetCampaignIds', 'isFindFacebookGroup'],
  facebook_join_group: ['findFacebookGroupJoinTargetCampaignIds', 'isFindFacebookGroup']
}

export async function hasPendingFindDataSource(campaign: Campaign, signal: AbortSignal): Promise<boolean> {
  const fields = findDataLinks[campaign.actionId]
  if (!fields) return false
  signal.throwIfAborted()
  const user = requireCurrentUser()
  const [field, enabled] = fields
  const { data, error } = await getSupabaseClient().from('auto_campaigns').select('id')
    .eq('staff_id', user.staffId).eq('is_delete', false)
    .or(`organization_id.is.null,organization_id.eq.${user.organizationId}`)
    .in('action_id', enabled === 'isFindFacebookGroup' ? ['facebook_find_data_search'] : ['facebook_find_data_group', 'facebook_find_data_search'])
    .eq(`extra_settings->>${enabled}`, 'true')
    .or(`extra_settings->${field}.cs.${JSON.stringify([campaign.id])},extra_settings->${field}.cs.${JSON.stringify([String(campaign.id)])}`)
    .limit(1).abortSignal(signal)
  if (error) throw error
  return !!data?.length
}

export async function countBusyBrowserAccounts(account: AutoAccount, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted()
  const user = requireCurrentUser()
  // Count root account rows (distinct accounts), including paused/draining owners.
  let query = getSupabaseClient().from('auto_accounts')
    .select('id,campaigns:auto_campaigns!auto_campaigns_account_id_fkey!inner(id)', { count: 'exact', head: true })
    .eq('staff_id', user.staffId).neq('id', account.id).eq('flatform_type', account.flatformType)
    .or(`organization_id.is.null,organization_id.eq.${user.organizationId}`)
    .eq('campaigns.staff_id', user.staffId)
    .or(`organization_id.is.null,organization_id.eq.${user.organizationId}`, { referencedTable: 'campaigns' })
    .or('status.eq.đang chạy,runtime_claim_token.not.is.null,runtime_unit_token.not.is.null', { referencedTable: 'campaigns' })
  if (account.flatformType === 'zalo') query = query.eq('is_zalo_show_web', true).eq('is_zalo_server', false)
  const { count, error } = await query.abortSignal(signal)
  if (error || count == null) throw error || new Error('Missing concurrency count')
  return count
}

export async function hasPendingReasonWorkflow(workflowId: number, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  const { data, error } = await getSupabaseClient().from('auto_workflows').select('id')
    .eq('id', workflowId).limit(1).abortSignal(signal)
  if (error) throw error
  return !!data?.length
}
