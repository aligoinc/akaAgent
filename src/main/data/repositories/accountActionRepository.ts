import { AccountActionOverview, AutoAccountAction, AutoAccountActionStatus } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAutoAccountActionFromDB, mapAutoAccountActionStatusFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()

function todayInVietnam(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

async function selectAccountActionStatus(
  accountId: number,
  actionCode: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client()
    .from('auto_account_action_status')
    .select('*')
    .eq('account_id', accountId)
    .eq('action_code', actionCode)
    .maybeSingle()

  if (error) throw new Error(`Failed to get account action status: ${error.message}`)
  return (data as Record<string, unknown> | null) ?? null
}

export async function getAccountActionStatus(accountId: number, actionCode: string): Promise<AutoAccountActionStatus> {
  const normalizedCode = actionCode.trim()
  const today = todayInVietnam()

  let existing = await selectAccountActionStatus(accountId, normalizedCode)

  if (!existing) {
    const { data, error } = await client()
      .from('auto_account_action_status')
      .insert({
        account_id: accountId,
        action_code: normalizedCode,
        count_action_in_day: 0,
        count_date: today
      })
      .select()
      .single()

    if (error) {
      if (error.code !== '23505') {
        throw new Error(`Failed to create account action status: ${error.message}`)
      }
      existing = await selectAccountActionStatus(accountId, normalizedCode)
      if (!existing) throw new Error(`Failed to create account action status: ${error.message}`)
    } else {
      return mapAutoAccountActionStatusFromDB(data)
    }
  }

  if (!existing) {
    throw new Error('Không tìm thấy trạng thái hành động tài khoản')
  }

  if (existing.count_date !== today) {
    const { data, error } = await client()
      .from('auto_account_action_status')
      .update({
        count_action_in_day: 0,
        count_date: today,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw new Error(`Failed to reset stale account action status: ${error.message}`)
    return mapAutoAccountActionStatusFromDB(data)
  }

  return mapAutoAccountActionStatusFromDB(existing)
}

export async function listAccountActions(flatformType?: string): Promise<AutoAccountAction[]> {
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
  return (data || []).map(row => mapAutoAccountActionFromDB(row))
}

export async function listAccountActionOverview(accountId: number): Promise<AccountActionOverview[]> {
  const u = requireCurrentUser()
  const { data: account, error: accountError } = await client()
    .from('auto_accounts')
    .select('id, flatform_type')
    .eq('id', accountId)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (accountError) throw new Error(`Failed to get account for action overview: ${accountError.message}`)
  if (!account) throw new Error('Không tìm thấy tài khoản')

  await enableDueAccountActions()

  const actions = await listAccountActions(account.flatform_type as string)
  return Promise.all(actions.map(async action => ({
    action,
    status: await getAccountActionStatus(accountId, action.code)
  })))
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
  minutes?: number | null
): Promise<void> {
  const codes = Array.from(new Set(actionCodes.map(code => code.trim()).filter(Boolean)))
  if (codes.length === 0) return

  const dateEnable = minutes && minutes > 0
    ? new Date(Date.now() + minutes * 60 * 1000).toISOString()
    : null

  for (const actionCode of codes) {
    await getAccountActionStatus(accountId, actionCode)

    const { error } = await client()
      .from('auto_account_action_status')
      .update({
        is_disable: true,
        date_enable: dateEnable,
        updated_at: new Date().toISOString()
      })
      .eq('account_id', accountId)
      .eq('action_code', actionCode)

    if (error) throw new Error(`Failed to disable account action "${actionCode}": ${error.message}`)
  }
}

export async function enableDueAccountActions(): Promise<void> {
  const { error } = await client().rpc('enable_due_auto_account_actions')
  if (error) throw new Error(`Failed to enable due account actions: ${error.message}`)
}

export async function resetDailyActionCounts(): Promise<void> {
  const { error } = await client().rpc('reset_auto_account_action_status_daily')
  if (error) throw new Error(`Failed to reset daily action counts: ${error.message}`)
}
