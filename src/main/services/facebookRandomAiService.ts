import { randomUUID } from 'node:crypto'
import { getSupabaseClient } from '../data/supabaseClient'
import { onCurrentUserSessionChanged, requireCurrentUser } from '../data/currentUser'
import { listCampaignActions } from '../data/repositories/campaignActionRepository'
import { randomRunRpc } from '../data/repositories/facebookRandomRunRepository'
import { callAiUsing } from './aiRuntimeService'
import { withRequestDeadline } from './requestDeadline'
import { parseFacebookRandomAiRules, randomRuleUnit, type FacebookRandomAiContext, type FacebookRandomAiState, type FacebookRandomRule } from '../../shared/facebookRandomRun'
import type { AutoAccount } from '../../shared/types'

const controllers = new Map<number, AbortController>()
interface PendingCommit { requestId: string; leaseToken: string; date: string; revision: number; rules: FacebookRandomRule[] }
const pendingCommits = new Map<number, PendingCommit>()
let sessionGeneration = 0
onCurrentUserSessionChanged(() => { sessionGeneration++; cancelFacebookRandomAi() })
interface AiStatus { date: string; canAttempt: boolean; owned?: boolean; leaseToken?: string; ai: FacebookRandomAiState | null }

export function cancelFacebookRandomAi(accountId?: number): void {
  for (const [id, controller] of controllers) if (accountId == null || accountId === id) controller.abort()
  if (accountId == null) pendingCommits.clear()
}

/** Only whitelisted numeric limit summaries enter the AI context. No campaign body or identity. */
export async function buildFacebookRandomAiContext(account: AutoAccount, dbNow: string, signal: AbortSignal): Promise<FacebookRandomAiContext> {
  const user = requireCurrentUser()
  const now = Date.parse(dbNow)
  if (!Number.isFinite(now)) throw new Error('Chưa xác định được ngày chạy từ máy chủ.')
  const date = new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
  const end = Date.parse(date + 'T23:59:00+07:00')
  const catalog = (await listCampaignActions()).filter(a => a.flatformType === 'facebook')
  signal.throwIfAborted()
  const actions = catalog.map(a => ({ campaignActionId: a.id, name: a.name, unit: randomRuleUnit(a.id), waitingCount: 0, pausedCount: 0,
    limits: {} as Record<string, { min: number; max: number }> }))
  const byId = new Map(actions.map(a => [a.campaignActionId, a]))
  const codesById = new Map(catalog.map(a => [a.id, a.limitCheckActionCodes]))
  const aggregate = (dest: Record<string, { min: number; max: number }>, key: string, value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return
    const old = dest[key]
    dest[key] = { min: Math.min(old?.min ?? value, value), max: Math.max(old?.max ?? value, value) }
  }
  let afterId = 0
  // Keyset paging remains complete above the Data API row limit.
  for (;;) {
    signal.throwIfAborted()
    const { data, error } = await getSupabaseClient().from('auto_campaigns')
      .select('id,action_id,status,schedule,daily_stop_time,schedule_end_date,data_target_source_mode,limits:extra_settings->actionLimits')
      .eq('account_id', account.id).eq('staff_id', user.staffId).eq('organization_id', user.organizationId)
      .eq('is_delete', false).eq('provisioning_state', 'ready').in('status', ['chờ xử lý', 'tạm dừng'])
      .lt('schedule', new Date(end).toISOString()).gt('id', afterId).order('id').limit(500).abortSignal(signal)
    if (error) throw new Error('Không tải được thống kê chiến dịch trong ngày.')
    if (!data?.length) break
    for (const row of data) {
      const action = byId.get(row.action_id)
      if (!action) continue
      const start = Math.max(now, Date.parse(row.schedule))
      const cutoff = row.daily_stop_time ? Math.min(end, Date.parse(date + 'T' + row.daily_stop_time + '+07:00')) : end
      if (!Number.isFinite(start) || !(start < cutoff) || (row.data_target_source_mode === 'data_group'
        && row.schedule_end_date && Date.parse(row.schedule_end_date) <= start)) continue
      if (row.status === 'tạm dừng') { action.pausedCount++; continue }
      action.waitingCount++
      const limits = row.limits as Record<string, unknown> | null
      aggregate(action.limits, 'sleepBetweenActions', limits?.sleepBetweenActions)
      const configs = limits?.byActionCode as Record<string, unknown> | undefined
      const actionCodes = new Set([...(codesById.get(row.action_id) || []), ...Object.keys(configs || {})])
      for (const code of actionCodes) {
        // Match runtime's whole-entry fallback: a partial/empty per-action
        // config does not inherit missing fields from the legacy base limits.
        const limit = configs?.[code] || limits
        if (!/^[a-z0-9_]{1,100}$/.test(code) || !limit || typeof limit !== 'object') continue
        const values = limit as Record<string, unknown>
        for (const key of ['dailyLimit', 'rateLimitCount', 'rateLimitMinutes']) aggregate(action.limits, code + '.' + key, values[key])
      }
    }
    afterId = Number(data[data.length - 1].id)
  }
  const { data: usage, error } = await getSupabaseClient().from('auto_account_action_status')
    .select('action_code,count_action_in_day,count_date,is_disable,date_enable').eq('account_id', account.id).abortSignal(signal)
  if (error) throw new Error('Không tải được giới hạn hành động.')
  const codes = new Set(catalog.flatMap(a => a.limitCheckActionCodes))
  const groupLimits: Record<string, unknown> = {}
  for (const [code, limit] of Object.entries(account.accountGroupSettings?.byActionCode || {})) {
    if (!codes.has(code)) continue
    groupLimits[code] = { dailyLimit: limit.dailyLimit, rateLimitCount: limit.rateLimitCount, rateLimitMinutes: limit.rateLimitMinutes }
  }
  if ((usage || []).some(row => row.count_date > date)) throw new Error('Ngày thống kê chưa đồng bộ với máy chủ.')
  return { date, actions, accountLimits: {
    dailySendLimits: {
      facebookCore: user.entitlements?.dailySendLimits.facebookCore ?? null,
      facebookFanpage: user.entitlements?.dailySendLimits.facebookFanpage ?? null
    },
    rateLimitMinutes: account.rateLimitMinutes, sleepBetweenActions: account.accountGroupSettings?.sleepBetweenActions,
    groupLimits, usage: (usage || []).filter(row => codes.has(row.action_code)).map(row => ({
      actionCode: row.action_code, count: row.count_date === date ? row.count_action_in_day : 0,
      disabled: row.is_disable, enabledAt: row.date_enable
    }))
  } }
}

/** One durable daily lease. A lost commit response is reconciled before any further provider call. */
export async function ensureFacebookRandomAiPlan(account: AutoAccount, revision: number, dbNow: string): Promise<boolean> {
  if (controllers.has(account.id)) return false
  const controller = new AbortController()
  controllers.set(account.id, controller)
  const signal = controller.signal
  const session = sessionGeneration
  let lease: PendingCommit | undefined
  try {
    const pending = pendingCommits.get(account.id)
    if (pending) {
      const saved = await randomRunRpc<AiStatus>(account.id, 'ai_commit', { ...pending })
      pendingCommits.delete(account.id)
      signal.throwIfAborted()
      if (saved.ai?.status === 'ready' && saved.date === new Date(Date.parse(dbNow) + 7 * 3600_000).toISOString().slice(0, 10)) return true
    }
    const status = await randomRunRpc<AiStatus>(account.id, 'ai_status')
    signal.throwIfAborted()
    if (status.ai?.status === 'ready') return true
    if (!status.canAttempt) return false
    const context = await buildFacebookRandomAiContext(account, dbNow, signal)
    signal.throwIfAborted()
    const requestId = randomUUID()
    const acquired = await randomRunRpc<AiStatus>(account.id, 'ai_acquire', { revision, requestId, context })
    if (!acquired.owned || !acquired.leaseToken || !acquired.ai) return acquired.ai?.status === 'ready'
    const planContext = acquired.ai.context
    lease = { requestId, leaseToken: acquired.leaseToken, revision, date: acquired.date, rules: [] }
    signal.throwIfAborted()
    const result = await withRequestDeadline(signal, requestSignal => callAiUsing('app_facebook_random_run_plan', {
      planContext: JSON.stringify(planContext)
    }, { organizationId: requireCurrentUser().organizationId, accountId: account.id }, {
      signal: requestSignal,
      validateContent: content => { try { parseFacebookRandomAiRules(content, planContext); return true } catch { return false } }
    }), 120_000)
    signal.throwIfAborted()
    if (!result.ok) throw new Error('Chưa lập được kế hoạch AI.')
    lease.rules = parseFacebookRandomAiRules(result.content, planContext)
    pendingCommits.set(account.id, lease)
    const saved = await randomRunRpc<AiStatus>(account.id, 'ai_commit', { ...lease })
    signal.throwIfAborted()
    pendingCommits.delete(account.id)
    return saved.ai?.status === 'ready'
  } catch (error) {
    // Do not overwrite an uncertain successful commit with a failure or issue another AI call.
    if (session === sessionGeneration && lease && !pendingCommits.has(account.id)) {
      try { await randomRunRpc(account.id, 'ai_fail', { ...lease, cancelled: signal.aborted }) } catch { /* DB lease expiry schedules the bounded retry. */ }
    }
    if (!signal.aborted) console.warn('Facebook random AI planning deferred:', error instanceof Error ? error.message : 'unavailable')
    return false
  } finally {
    if (controllers.get(account.id) === controller) controllers.delete(account.id)
  }
}
