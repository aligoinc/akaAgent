import type { AutoAccount, Campaign, CampaignAction } from '../../../shared/types'
import type { DiagnosticQuota } from '../../../shared/campaignDiagnostics'
import { normalizePositiveActionLimit as positive, resolveAccountActionLimitConfig } from '../../../shared/accountActionLimits'
import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { mapCampaignFromDB } from '../mappers'
import { getCampaignActionDescriptors, getCampaignExecutableActionDescriptors } from '../../domain/campaigns/campaignActionDescriptors'
import { getAccountActionDailySendLimit, loadCurrentUserEffectiveEntitlements } from './entitlementRepository'

export async function readDiagnosticsCampaign(id: number, signal: AbortSignal): Promise<(Campaign & { diagnosticHasClaim: boolean }) | null> {
  const user = requireCurrentUser()
  const { data, error } = await getSupabaseClient().from('auto_campaigns')
    .select('id,name,account_id,action_id,status,note,is_delete,staff_id,organization_id,schedule,original_schedule,schedule_type,schedule_days,schedule_week_days,schedule_end_date,daily_stop_time,continue_next_day,refresh_data,extra_settings,data_target_source_mode,data_group_id,provisioning_state,updated_at,content,images,last_run_at,completed_at,secondary_account_id,runtime_claim_token,runtime_unit_token')
    .eq('id', id).eq('staff_id', user.staffId).eq('is_delete', false)
    .or(`organization_id.is.null,organization_id.eq.${user.organizationId}`).abortSignal(signal).maybeSingle()
  if (error) throw error
  return data ? { ...mapCampaignFromDB({ ...data, log: '' }), diagnosticHasClaim: !!(data.runtime_claim_token || data.runtime_unit_token) } : null
}

export interface DiagnosticEvidence {
  accountHistory: Record<string, unknown>[]
  campaignHistory: string[]
  results: Record<string, unknown>[]
  inputSummary: Record<string, number>
  inputs: Record<string, unknown>[]
}
export async function readDiagnosticsEvidence(campaignId: number, signal: AbortSignal): Promise<DiagnosticEvidence> {
  const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
  const { data, error } = await getSupabaseClient().rpc('aka_agent_campaign_diagnostics_evidence', {
    p_staff_id: user.staffId, p_organization_id: user.organizationId, p_campaign_id: campaignId,
    p_auth_username: credentials.username, p_auth_password: credentials.password
  }).abortSignal(signal)
  if (error) throw error
  if (!data || !['accountHistory', 'campaignHistory', 'results', 'inputs'].every(key => Array.isArray(data[key]))
    || !data.inputSummary || typeof data.inputSummary !== 'object') throw new Error('Incomplete evidence')
  return data as DiagnosticEvidence
}

/** Read-only display measurements. The overall stop/continue decision remains the existing runtime preflight. */
export async function readDiagnosticsQuotas(
  account: AutoAccount, campaign: Campaign, action: CampaignAction, dbNow: string, isChatManaged: boolean, signal: AbortSignal
): Promise<DiagnosticQuota[]> {
  const executable = getCampaignExecutableActionDescriptors(campaign, action)
  if (!executable.length) return []
  const limits = campaign.extraSettings?.actionLimits
  const selected = Array.isArray(limits?.enabledActionCodes) ? new Set(limits.enabledActionCodes) : null
  const quotaCodes = isChatManaged
    ? new Set(action.limitCheckActionCodes.filter(code => !selected || selected.has(code)))
    : new Set(getCampaignActionDescriptors(campaign, action).map(item => item.code))
  const client = getSupabaseClient()
  const { data, error } = await client.from('auto_account_action_status')
    .select('action_code,count_action_in_day,count_date,is_disable,date_enable,disabled_reason,disabled_error_code')
    .eq('account_id', account.id).in('action_code', executable.map(item => item.code)).abortSignal(signal)
  if (error) throw error
  const rows = new Map((data || []).map(row => [row.action_code, row]))
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  signal.throwIfAborted()
  const now = Date.parse(dbNow)
  if (!Number.isFinite(now)) throw new Error('Invalid database clock')
  const day = new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
  const output: DiagnosticQuota[] = []
  for (const { code, name } of executable) {
    signal.throwIfAborted()
    const row = rows.get(code)
    if (row?.count_date && row.count_date > day) throw new Error('Invalid counter date')
    if (row?.date_enable && !Number.isFinite(Date.parse(row.date_enable))) throw new Error('Invalid enable date')
    const base = code === 'zalo_find_phone_user'
      ? { dailyLimit: 1000, rateLimitCount: 1000, rateLimitMinutes: limits?.byActionCode?.[code]?.rateLimitMinutes ?? limits?.rateLimitMinutes }
      : limits?.byActionCode?.[code] ?? limits
    const config = resolveAccountActionLimitConfig(base, account.accountGroupSettings?.byActionCode?.[code],
      getAccountActionDailySendLimit(code, null, entitlements))
    const minutes = positive(config?.rateLimitMinutes) ?? 65
    const checked = quotaCodes.has(code)
    let windowUsed: number | null = null
    if (checked) {
      const since = new Date(now - minutes * 60_000).toISOString()
      const countBase = () => client.from('auto_campaign_details').select('id', { count: 'exact', head: true })
        .eq('account_id', account.id).eq('action_code', code).gte('created_at', since)
      const results = await Promise.all([
        countBase().eq('counts_toward_limit', true).abortSignal(signal),
        isChatManaged ? Promise.resolve({ count: 0, error: null })
          : countBase().is('counts_toward_limit', null).in('status', ['thành công', 'thất bại']).abortSignal(signal)
      ])
      if (results.some(item => item.error || item.count == null)) throw new Error('Missing quota count')
      windowUsed = results.reduce((sum, item) => sum + item.count!, 0)
    }
    output.push({ code, name, checked,
      disabled: !!row?.is_disable && (!row.date_enable || Date.parse(row.date_enable) > now),
      reason: row?.disabled_reason || row?.disabled_error_code || null, enableAt: row?.date_enable || null,
      dayUsed: row?.count_date === day ? Number(row.count_action_in_day) : 0,
      dayLimit: positive(config?.dailyLimit) ?? 30, windowUsed,
      windowLimit: positive(config?.rateLimitCount) ?? 9, windowMinutes: minutes })
  }
  return output
}
