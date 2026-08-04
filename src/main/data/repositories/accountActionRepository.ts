import { AccountActionOverview, AccountGroupSettings, AutoAccountAction, AutoAccountActionStatus } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAutoAccountActionFromDB, mapAutoAccountActionStatusFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'
import {
  canUseAccountActionWithEntitlements,
  canUseAccountPlatformWithEntitlements,
  emptyAuthEntitlements,
  loadCurrentUserEffectiveEntitlements
} from './entitlementRepository'
import {
  getDatabaseRuntimeClock,
  parseDatabaseRuntimeClock,
  type DatabaseRuntimeClock
} from './runtimeClockRepository'

const client = () => getSupabaseClient()
const DEFAULT_RATE_LIMIT_MINUTES = 65
const SMS_SEND_ACTION_CODE = 'sms_send'
const VOICE_CALL_ACTION_CODE = 'voice_call'
const VOICE_CALL_RATE_LIMIT_MINUTES = 60
const RATED_ACTION_STATUSES = ['thành công', 'thất bại']
const TRANSIENT_RETRY_DELAY_MS = 300

export interface DisableAccountActionContext {
  errorCode?: string | null
  reason?: string | null
  dateEnable?: string | null
}

function normalizeRateLimitMinutes(value: unknown): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_MINUTES
}

function isMobileManagedSmsActionCode(actionCode?: string | null): boolean {
  const normalized = String(actionCode || '').trim()
  return normalized === SMS_SEND_ACTION_CODE || normalized === VOICE_CALL_ACTION_CODE
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function getErrorMessage(error: unknown): string {
  if (!error) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '')
  }
  return String(error)
}

function isTransientFetchFailure(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes('fetch failed')
}

async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (err) {
    if (!isTransientFetchFailure(err)) throw err
    await sleep(TRANSIENT_RETRY_DELAY_MS)
    return operation()
  }
}

async function runOverviewQuery<T>(
  label: string,
  query: () => PromiseLike<T>
): Promise<T> {
  let result = await query()
  let error = (result as { error?: unknown }).error
  if (error && isTransientFetchFailure(error)) {
    await sleep(TRANSIENT_RETRY_DELAY_MS)
    result = await query()
    error = (result as { error?: unknown }).error
  }
  if (error) throw new Error(`${label}: ${getErrorMessage(error)}`)
  return result
}

export interface AccountActionStatusSnapshot {
  status: AutoAccountActionStatus
  clock: DatabaseRuntimeClock
}

export async function getAccountActionStatusSnapshot(
  accountId: number,
  actionCode: string
): Promise<AccountActionStatusSnapshot> {
  const normalizedCode = actionCode.trim()
  if (!normalizedCode) throw new Error('Mã hành động không hợp lệ')

  const { data, error } = await client().rpc('aka_agent_get_account_action_status_today', {
    p_account_id: accountId,
    p_action_code: normalizedCode
  })
  if (error) {
    throw new Error(
      `Failed to get account action status from DB clock: ${error.message}. ` +
      'Ensure migration v223 is applied.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row || !row.action_status || typeof row.action_status !== 'object') {
    throw new Error('DB account action status returned an invalid payload')
  }

  return {
    status: mapAutoAccountActionStatusFromDB(row.action_status as Record<string, unknown>),
    clock: parseDatabaseRuntimeClock(row)
  }
}

export async function getAccountActionStatus(accountId: number, actionCode: string): Promise<AutoAccountActionStatus> {
  return (await getAccountActionStatusSnapshot(accountId, actionCode)).status
}

export async function listAccountActions(flatformType?: string, includeRestricted = false): Promise<AutoAccountAction[]> {
  const entitlements = includeRestricted
    ? {
      facebookCore: true,
      facebookFanpage: true,
      email: true,
      zalo: true,
      sms: true,
      dailySendLimits: {
        facebookCore: null,
        facebookFanpage: null,
        email: null,
        zalo: null,
        sms: null
      },
      accountLimits: {
        facebookCore: null,
        facebookFanpage: null,
        email: null,
        zalo: null,
        sms: null
      }
    }
    : await loadCurrentUserEffectiveEntitlements()
  if (flatformType && !canUseAccountPlatformWithEntitlements(flatformType, entitlements)) return []

  let query = client()
    .from('auto_account_actions')
    .select('*')
    .eq('is_active', true)
    .eq('is_delete', false)
    .order('id', { ascending: true })

  if (flatformType) {
    query = query.eq('flatform_type', flatformType)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list account actions: ${error.message}`)
  const effectiveEntitlements = includeRestricted ? entitlements : { ...emptyAuthEntitlements(), ...entitlements }
  return (data || [])
    .map(row => mapAutoAccountActionFromDB(row))
    .filter(action => canUseAccountActionWithEntitlements(action.code, action.flatformType, effectiveEntitlements))
}

async function loadOverviewActionStatuses(
  accountId: number,
  actionCodes: string[],
  clock: DatabaseRuntimeClock
): Promise<Map<string, AutoAccountActionStatus>> {
  if (actionCodes.length === 0) return new Map()

  const today = clock.vietnamDateKey
  const readStatusRows = async (): Promise<Record<string, unknown>[]> => {
    const { data } = await runOverviewQuery(
      'Failed to list account action statuses',
      () => client()
        .from('auto_account_action_status')
        .select('*')
        .eq('account_id', accountId)
        .in('action_code', actionCodes)
    )
    return (data || []) as Record<string, unknown>[]
  }

  let rows = await readStatusRows()
  const rowCodes = new Set(rows.map(row => String(row.action_code || '').trim()).filter(Boolean))
  const missingCodes = actionCodes.filter(code => !rowCodes.has(code))
  const futureRows = rows.filter(row => String(row.count_date || '') > today)
  if (futureRows.length > 0) {
    throw new Error(
      `Account action status date is ahead of DB Vietnam date for ${futureRows.length} row(s)`
    )
  }
  const staleIds = rows
    .filter(row => String(row.count_date || '') < today)
    .map(row => row.id as number)
    .filter(id => typeof id === 'number')

  if (missingCodes.length > 0) {
    await runOverviewQuery(
      'Failed to create account action statuses',
      () => client()
        .from('auto_account_action_status')
        .upsert(
          missingCodes.map(actionCode => ({
            account_id: accountId,
            action_code: actionCode,
            count_action_in_day: 0,
            count_date: today,
            updated_at: clock.dbNow
          })),
          { onConflict: 'account_id,action_code', ignoreDuplicates: true }
        )
    )
  }

  if (staleIds.length > 0) {
    await runOverviewQuery(
      'Failed to reset stale account action statuses',
      () => client()
        .from('auto_account_action_status')
        .update({
          count_action_in_day: 0,
          count_date: today,
          updated_at: clock.dbNow
        })
        .in('id', staleIds)
        .lt('count_date', today)
    )
  }

  if (missingCodes.length > 0 || staleIds.length > 0) {
    rows = await readStatusRows()
  }

  return new Map(rows.map(row => [
    String(row.action_code || ''),
    mapAutoAccountActionStatusFromDB(row)
  ]))
}

async function loadWindowActionCounts(
  accountId: number,
  actionWindowMinutes: Map<string, number>,
  dbNowMs: number
): Promise<Map<string, number>> {
  if (actionWindowMinutes.size === 0) return new Map()

  const counts = new Map<string, number>()
  for (const [actionCode, windowMinutes] of actionWindowMinutes.entries()) {
    const timeFrameStart = new Date(dbNowMs - windowMinutes * 60 * 1000).toISOString()
    const buildLegacyWindowCountQuery = () => {
      const query = client()
        .from('auto_campaign_details')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('action_code', actionCode)
        .is('counts_toward_limit', null)
        .gte('created_at', timeFrameStart)
      return isMobileManagedSmsActionCode(actionCode) ? query : query.in('status', RATED_ACTION_STATUSES)
    }

    const [explicitResult, legacyResult] = await Promise.all([
      runOverviewQuery(
        'Failed to count explicit account action window',
        () => client()
          .from('auto_campaign_details')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('action_code', actionCode)
          .eq('counts_toward_limit', true)
          .gte('created_at', timeFrameStart)
      ),
      runOverviewQuery(
        'Failed to count legacy account action window',
        buildLegacyWindowCountQuery
      )
    ])
    counts.set(actionCode, (explicitResult.count || 0) + (legacyResult.count || 0))
  }

  return counts
}

function getOverviewWindowMinutes(
  actionCode: string,
  accountRateLimitMinutes: unknown,
  groupSettings: AccountGroupSettings | null
): number {
  return normalizeRateLimitMinutes(
    groupSettings?.byActionCode?.[actionCode]?.rateLimitMinutes
      ?? (actionCode === VOICE_CALL_ACTION_CODE ? VOICE_CALL_RATE_LIMIT_MINUTES : accountRateLimitMinutes)
  )
}

export async function listAccountActionOverview(accountId: number): Promise<AccountActionOverview[]> {
  const u = requireCurrentUser()
  const { data: account } = await runOverviewQuery(
    'Failed to get account for action overview',
    () => client()
      .from('auto_accounts')
      .select('id, flatform_type, rate_limit_minutes, auto_account_groups(settings)')
      .eq('id', accountId)
      .eq('staff_id', u.staffId)
      .eq('is_delete', false)
      .maybeSingle()
  )
  if (!account) throw new Error('Không tìm thấy tài khoản')

  await withTransientRetry(() => enableDueAccountActions())

  const actions = await withTransientRetry(() => listAccountActions(account.flatform_type as string))
  const actionCodes = actions.map(action => action.code).filter(Boolean)
  const groupSettings = ((account as any).auto_account_groups?.settings as AccountGroupSettings | null) ?? null
  const actionWindowMinutes = new Map(actionCodes.map(actionCode => [
    actionCode,
    getOverviewWindowMinutes(actionCode, account.rate_limit_minutes, groupSettings)
  ]))
  const clock = await getDatabaseRuntimeClock()
  const dbNowMs = new Date(clock.dbNow).getTime()
  const statusByActionCode = await loadOverviewActionStatuses(accountId, actionCodes, clock)
  const windowCountByActionCode = await loadWindowActionCounts(accountId, actionWindowMinutes, dbNowMs)

  return actions.map(action => {
    const status = statusByActionCode.get(action.code)
    if (!status) throw new Error(`Không tìm thấy trạng thái hành động "${action.name}"`)
    return {
      action,
      status,
      windowActionCount: windowCountByActionCode.get(action.code) || 0,
      windowMinutes: actionWindowMinutes.get(action.code) || DEFAULT_RATE_LIMIT_MINUTES
    }
  })
}

export async function incrementAccountActionCount(
  accountId: number,
  actionCode: string,
  amount = 1
): Promise<AutoAccountActionStatus> {
  const { data, error } = await client().rpc('increment_auto_account_action_count', {
    p_account_id: accountId,
    p_action_code: actionCode,
    p_amount: amount
  })

  if (error) throw new Error(`Failed to increment account action count: ${error.message}`)
  return mapAutoAccountActionStatusFromDB(data as Record<string, unknown>)
}

export async function disableAccountActions(
  accountId: number,
  actionCodes: string[],
  minutes?: number | null,
  context?: DisableAccountActionContext
): Promise<void> {
  const codes = Array.from(new Set(actionCodes.map(code => code.trim()).filter(Boolean)))
  if (codes.length === 0) return

  const snapshots = await Promise.all(codes.map(actionCode =>
    getAccountActionStatusSnapshot(accountId, actionCode)
  ))
  const dbNow = snapshots[0].clock.dbNow
  const dateEnable = context?.dateEnable !== undefined
    ? context.dateEnable
    : minutes && minutes > 0
      ? new Date(new Date(dbNow).getTime() + minutes * 60 * 1000).toISOString()
      : null
  const disabledAt = dbNow

  for (const actionCode of codes) {
    const { error } = await client()
      .from('auto_account_action_status')
      .update({
        is_disable: true,
        date_enable: dateEnable,
        disabled_error_code: context?.errorCode || null,
        disabled_reason: context?.reason || null,
        disabled_at: disabledAt,
        updated_at: dbNow
      })
      .eq('account_id', accountId)
      .eq('action_code', actionCode)

    if (error) throw new Error(`Failed to disable account action "${actionCode}": ${error.message}`)
  }
}

export async function enableAccountActionNow(
  accountId: number,
  actionCode: string
): Promise<AutoAccountActionStatus> {
  const normalizedCode = actionCode.trim()
  if (!normalizedCode) throw new Error('Mã hành động không hợp lệ')

  const snapshot = await getAccountActionStatusSnapshot(accountId, normalizedCode)

  const { data, error } = await client()
    .from('auto_account_action_status')
    .update({
      is_disable: false,
      date_enable: null,
      disabled_error_code: null,
      disabled_reason: null,
      disabled_at: null,
      updated_at: snapshot.clock.dbNow
    })
    .eq('account_id', accountId)
    .eq('action_code', normalizedCode)
    .select()
    .single()

  if (error) throw new Error(`Failed to enable account action "${normalizedCode}": ${error.message}`)
  return mapAutoAccountActionStatusFromDB(data as Record<string, unknown>)
}

export async function enableDueAccountActions(): Promise<void> {
  const { error } = await client().rpc('enable_due_auto_account_actions')
  if (error) throw new Error(`Failed to enable due account actions: ${error.message}`)
}

export async function resetDailyActionCounts(): Promise<void> {
  const { error } = await client().rpc('reset_auto_account_action_status_daily')
  if (error) throw new Error(`Failed to reset daily action counts: ${error.message}`)
}
