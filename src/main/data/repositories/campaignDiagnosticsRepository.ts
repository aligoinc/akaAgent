import type { ActionLimitConfig, AutoAccount, Campaign, CampaignAction, CampaignActionLimitSettings } from '../../../shared/types'
import type { DiagnosticQuota } from '../../../shared/campaignDiagnostics'
import type { CampaignAccountActionRow, CampaignActionLimitSource } from '../../../shared/campaignAccountActions'
import { normalizePositiveActionLimit as positive, resolveAccountActionLimitConfig } from '../../../shared/accountActionLimits'
import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { mapCampaignFromDB } from '../mappers'
import { getCampaignAccountOverviewActionDescriptors, getCampaignActionDescriptors, getCampaignExecutableActionDescriptors } from '../../domain/campaigns/campaignActionDescriptors'
import { getAccountActionDailySendLimit, loadCurrentUserEffectiveEntitlements } from './entitlementRepository'
import type { DatabaseRuntimeClock } from './runtimeClockRepository'

const FIND_PHONE_ACTION_CODE = 'zalo_find_phone_user'
const FIND_PHONE_LIMIT = 1000
// Giống `countLimitDetailsInWindow` của bộ chạy: dòng cũ NULL chỉ tính thành công/thất bại, trừ SMS/gọi qua app điện thoại.
const LIMIT_COUNT_STATUSES = ['thành công', 'thất bại']
const MOBILE_LIMIT_ACTION_CODES = new Set(['sms_send', 'voice_call'])

export interface ResolvedCampaignActionLimit {
  dailyLimit: number
  dailySource: CampaignActionLimitSource
  /** Trần gói nhỏ hơn giới hạn ngày đã cài nên giới hạn bị cắt về trần. */
  dailyCapped: boolean
  packageDailyLimit: number | null
  campaignDailyLimit: number | null
  rateLimitCount: number
  rateLimitMinutes: number
  windowSource: CampaignActionLimitSource
  campaignRateLimitCount: number | null
  campaignRateLimitMinutes: number | null
}

/**
 * Giới hạn hiệu lực của một hành động như bộ chạy: `getActionLimitConfig` (Tìm SĐT cố định 1.000; cài theo mã,
 * thiếu thì khối chung) → `resolveAccountActionLimitConfig` (nhóm → chiến dịch → trần gói) → mặc định của
 * `resolveAccountRateLimitStatus` (30/ngày, 9 lượt/65 phút). Dùng chung cho Chẩn đoán và tab Hành động.
 */
export function resolveCampaignActionQuotaLimit(
  code: string, limits: CampaignActionLimitSettings | undefined, groupLimit: ActionLimitConfig | undefined, cap: number | null
): ResolvedCampaignActionLimit {
  const findPhone = code === FIND_PHONE_ACTION_CODE
  const base: ActionLimitConfig | undefined = findPhone
    ? { dailyLimit: FIND_PHONE_LIMIT, rateLimitCount: FIND_PHONE_LIMIT, rateLimitMinutes: limits?.byActionCode?.[code]?.rateLimitMinutes ?? limits?.rateLimitMinutes }
    : limits?.byActionCode?.[code] ?? limits
  const config = resolveAccountActionLimitConfig(base, groupLimit, cap)
  const dailyLimit = positive(config?.dailyLimit) ?? 30
  const uncappedDaily = positive(resolveAccountActionLimitConfig(base, groupLimit, null)?.dailyLimit) ?? 30
  const groupDaily = groupLimit ? positive(groupLimit.dailyLimit) : undefined
  const groupCount = groupLimit ? positive(groupLimit.rateLimitCount) : undefined
  const groupMinutes = groupLimit ? positive(groupLimit.rateLimitMinutes) : undefined
  const campaignDaily = findPhone ? undefined : positive(base?.dailyLimit)
  const campaignCount = findPhone ? undefined : positive(base?.rateLimitCount)
  const campaignMinutes = positive(base?.rateLimitMinutes)
  return {
    dailyLimit,
    dailySource: groupDaily ? 'group' : campaignDaily ? 'campaign' : 'default',
    dailyCapped: dailyLimit < uncappedDaily,
    packageDailyLimit: positive(cap) ?? null,
    campaignDailyLimit: campaignDaily ?? null,
    rateLimitCount: positive(config?.rateLimitCount) ?? 9,
    rateLimitMinutes: positive(config?.rateLimitMinutes) ?? 65,
    windowSource: groupCount || groupMinutes ? 'group' : campaignCount || campaignMinutes ? 'campaign' : 'default',
    campaignRateLimitCount: campaignCount ?? null,
    campaignRateLimitMinutes: campaignMinutes ?? null
  }
}

/** Số lượt trong khung giờ: akaChat chỉ đếm `counts_toward_limit = true`; bộ chạy akaAgent cộng dòng cũ NULL. */
async function countCampaignActionWindow(
  accountId: number, code: string, sinceIso: string, isChatManaged: boolean, signal: AbortSignal
): Promise<number> {
  const client = getSupabaseClient()
  const countBase = () => client.from('auto_campaign_details').select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('action_code', code).gte('created_at', sinceIso)
  const legacy = () => {
    const query = countBase().is('counts_toward_limit', null)
    return (MOBILE_LIMIT_ACTION_CODES.has(code) ? query : query.in('status', LIMIT_COUNT_STATUSES)).abortSignal(signal)
  }
  const results = await Promise.all([
    countBase().eq('counts_toward_limit', true).abortSignal(signal),
    isChatManaged ? Promise.resolve({ count: 0, error: null }) : legacy()
  ])
  if (results.some(item => item.error || item.count == null)) throw new Error('Missing quota count')
  return results.reduce((sum, item) => sum + item.count!, 0)
}

/** Mã bộ chạy kiểm tra giới hạn lượt: akaChat theo `limit_check_action_codes` đã chọn; bộ chạy akaAgent theo descriptor quota. */
export function campaignQuotaCodes(campaign: Campaign, action: CampaignAction | null, isChatManaged: boolean): Set<string> {
  const limits = campaign.extraSettings?.actionLimits
  const selected = Array.isArray(limits?.enabledActionCodes) ? new Set(limits.enabledActionCodes) : null
  return isChatManaged
    ? new Set((action?.limitCheckActionCodes || []).filter(code => !selected || selected.has(code)))
    : new Set(getCampaignActionDescriptors(campaign, action ?? undefined).map(item => item.code))
}

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
  const quotaCodes = campaignQuotaCodes(campaign, action, isChatManaged)
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
    const limit = resolveCampaignActionQuotaLimit(code, limits, account.accountGroupSettings?.byActionCode?.[code],
      getAccountActionDailySendLimit(code, null, entitlements))
    const minutes = limit.rateLimitMinutes
    const checked = quotaCodes.has(code)
    const windowUsed = checked
      ? await countCampaignActionWindow(account.id, code, new Date(now - minutes * 60_000).toISOString(), isChatManaged, signal)
      : null
    output.push({ code, name, checked,
      disabled: !!row?.is_disable && (!row.date_enable || Date.parse(row.date_enable) > now),
      reason: row?.disabled_reason || row?.disabled_error_code || null, enableAt: row?.date_enable || null,
      dayUsed: row?.count_date === day ? Number(row.count_action_in_day) : 0,
      dayLimit: limit.dailyLimit, windowUsed,
      windowLimit: limit.rateLimitCount, windowMinutes: minutes })
  }
  return output
}

/**
 * Tab "Hành động" của chi tiết chiến dịch: đúng danh sách menu "Hành động của tài khoản" (hành động chạy theo cài
 * đặt đã lưu, kèm gắn tag/đổi tên), cùng công thức và cách đếm với Chẩn đoán/bộ chạy. Chỉ đọc: không tạo/reset
 * trạng thái, không gọi RPC mở khóa đến hạn. Bộ đếm ngày ghi sau hôm nay hiện "không xác minh" thay vì làm lỗi cả bảng.
 */
export async function readCampaignAccountActionRows(
  account: AutoAccount, campaign: Campaign, action: CampaignAction | null, clock: DatabaseRuntimeClock, isChatManaged: boolean, signal: AbortSignal
): Promise<CampaignAccountActionRow[]> {
  const seen = new Set<string>()
  const display = getCampaignAccountOverviewActionDescriptors(campaign).filter(item => !seen.has(item.code) && !!seen.add(item.code))
  if (!display.length) return []
  const now = Date.parse(clock.dbNow)
  if (!Number.isFinite(now)) throw new Error('Invalid database clock')
  const today = clock.vietnamDateKey
  const limits = campaign.extraSettings?.actionLimits
  const quotaCodes = campaignQuotaCodes(campaign, action, isChatManaged)
  const { data, error } = await getSupabaseClient().from('auto_account_action_status')
    .select('action_code,count_action_in_day,count_date,is_disable,date_enable,disabled_reason,disabled_error_code')
    .eq('account_id', account.id).in('action_code', display.map(item => item.code)).abortSignal(signal)
  if (error) throw error
  const statuses = new Map((data || []).map(row => [row.action_code, row]))
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  signal.throwIfAborted()
  const output: CampaignAccountActionRow[] = []
  for (const { code, name } of display) {
    signal.throwIfAborted()
    const status = statuses.get(code)
    const enableAt = status?.date_enable ? String(status.date_enable) : ''
    const enableMs = enableAt ? Date.parse(enableAt) : Number.NaN
    // Khóa đã tới giờ mở lại coi như bình thường (bộ chạy tự mở), không ghi DB.
    const disabled = status?.is_disable === true && (!enableAt || !Number.isFinite(enableMs) || enableMs > now)
    const countDate = status?.count_date ? String(status.count_date) : ''
    const dayUsed = !status ? 0 : countDate > today ? null : countDate === today ? Math.max(0, Number(status.count_action_in_day) || 0) : 0
    const limited = quotaCodes.has(code)
    const limit = limited ? resolveCampaignActionQuotaLimit(code, limits, account.accountGroupSettings?.byActionCode?.[code],
      getAccountActionDailySendLimit(code, null, entitlements)) : null
    const windowUsed = limit
      ? await countCampaignActionWindow(account.id, code, new Date(now - limit.rateLimitMinutes * 60_000).toISOString(), isChatManaged, signal)
      : null
    output.push({
      code, name, limited, disabled,
      enableAt: disabled && Number.isFinite(enableMs) ? enableAt : null,
      remainingMinutes: disabled && Number.isFinite(enableMs) ? Math.ceil((enableMs - now) / 60_000) : null,
      disabledReason: disabled ? String(status?.disabled_reason || '').trim() || String(status?.disabled_error_code || '').trim() || null : null,
      dayUsed,
      dayLimit: limit?.dailyLimit ?? null,
      dayLimitSource: limit?.dailySource ?? null,
      dayLimitCapped: limit?.dailyCapped ?? false,
      packageDailyLimit: limit?.packageDailyLimit ?? null,
      campaignDayLimit: limit?.campaignDailyLimit ?? null,
      windowUsed,
      windowLimit: limit?.rateLimitCount ?? null,
      windowMinutes: limit?.rateLimitMinutes ?? null,
      windowLimitSource: limit?.windowSource ?? null,
      campaignWindowLimit: limit?.campaignRateLimitCount ?? null,
      campaignWindowMinutes: limit?.campaignRateLimitMinutes ?? null
    })
  }
  return output
}
