import type { AutoAccount, Campaign, CampaignAction } from '../../../shared/types'
import { normalizePositiveActionLimit as positive } from '../../../shared/accountActionLimits'
import { getCampaignExecutableActionDescriptors } from '../../domain/campaigns/campaignActionDescriptors'
import { getSupabaseClient } from '../supabaseClient'
import { getAccountActionDailySendLimit, loadCurrentUserEffectiveEntitlements } from './entitlementRepository'

const combinedActions = new Set(['zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime',
  'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation'])

/** On-click akaChat diagnostics only. Never reset counters, claim or change scheduler behavior. */
export async function readChatPendingLimitReason(
  account: AutoAccount, campaign: Campaign, action: CampaignAction, dbNow: string, signal: AbortSignal
): Promise<string | null> {
  signal.throwIfAborted()
  const executable = getCampaignExecutableActionDescriptors(campaign)
  if (!executable.length) return null
  const limits = campaign.extraSettings?.actionLimits
  const enabled = Array.isArray(limits?.enabledActionCodes) ? new Set(limits.enabledActionCodes.map(String)) : null
  const quota = new Set(action.limitCheckActionCodes.filter(code => !enabled || enabled.has(code)))
  const client = getSupabaseClient()
  const { data, error } = await client.from('auto_account_action_status')
    .select('action_code,count_action_in_day,count_date,is_disable,date_enable,disabled_reason')
    .eq('account_id', account.id).in('action_code', executable.map(item => item.code)).abortSignal(signal)
  signal.throwIfAborted()
  if (error) throw error
  const byCode = new Map((data || []).map(row => [row.action_code, row]))
  const now = Date.parse(dbNow)
  const day = new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const skipped = new Set<string>()
  let firstSkipped: string | null = null
  for (const { code, name } of executable) {
    signal.throwIfAborted()
    const status = byCode.get(code)
    if (status?.count_date && String(status.count_date) > day) throw new Error('Invalid counter date')
    if (status?.is_disable && status.date_enable && !Number.isFinite(Date.parse(status.date_enable))) {
      throw new Error('Invalid enable date')
    }
    if (status?.is_disable && (!status.date_enable || Date.parse(status.date_enable) > now)) {
      return status.disabled_reason || (status.date_enable
        ? `Hành động "${name}" đang tạm dừng, còn khoảng ${Math.ceil((Date.parse(status.date_enable) - now) / 60_000)} phút`
        : `Hành động "${name}" đang tạm dừng`)
    }
    // Disabled actions still block even when their quota check is turned off.
    if (!quota.has(code)) continue
    const override = limits?.byActionCode?.[code]
    const base = code === 'zalo_find_phone_user'
      ? { dailyLimit: 1000, rateLimitCount: 1000, rateLimitMinutes: override?.rateLimitMinutes ?? limits?.rateLimitMinutes }
      : override ?? limits
    // The account reader has already filtered groups using akaChat's tenant/active rules.
    const group = account.accountGroupSettings?.byActionCode?.[code]
    const cap = getAccountActionDailySendLimit(code, null, entitlements)
    const daily = Math.min(positive(group?.dailyLimit) ?? positive(base?.dailyLimit) ?? 30, positive(cap) ?? Infinity)
    const maximum = positive(group?.rateLimitCount) ?? positive(base?.rateLimitCount) ?? 9
    const minutes = positive(group?.rateLimitMinutes) ?? positive(base?.rateLimitMinutes) ?? 65
    const count = status?.count_date === day ? Number(status.count_action_in_day || 0) : 0
    let reason: string | null = count >= daily ? `Đạt giới hạn ngày cho hành động "${name}" (${count}/${daily})` : null
    if (!reason) {
      const { count: total, error: countError } = await client.from('auto_campaign_details')
        .select('id', { count: 'exact', head: true }).eq('account_id', account.id).eq('action_code', code)
        .eq('counts_toward_limit', true).gte('created_at', new Date(now - minutes * 60_000).toISOString()).abortSignal(signal)
      signal.throwIfAborted()
      if (countError || total == null) throw countError || new Error('Missing action count')
      if (total >= maximum) reason = `Đạt tốc độ giới hạn hành động "${name}" (${total}/${maximum} lần / ${minutes} phút)`
    }
    if (!reason) continue
    if (limits?.continueWhenActionLimitReached === true && combinedActions.has(campaign.actionId)
      && (code === 'zalo_message_stranger' || code === 'zalo_add_friend')) {
      skipped.add(code)
      firstSkipped ??= reason
    } else return reason
  }
  // Unmetered enabled business actions can still run; lookup alone cannot.
  return executable.some(({ code }) => code !== 'zalo_find_phone_user' && !skipped.has(code)) ? null : firstSkipped
}
