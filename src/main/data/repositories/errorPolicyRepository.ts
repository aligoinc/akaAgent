import { AutoErrorPolicy } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAutoErrorPolicyFromDB } from '../mappers'

const client = () => getSupabaseClient()

export interface AccountErrorState {
  id: number
  accountId: number
  actionCode: string
  errorCode: string
  countConsecutiveErrors: number
  lastErrorAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AccountErrorStateWithPolicy {
  state: AccountErrorState
  policy: AutoErrorPolicy | null
}

function mapAccountErrorStateFromDB(row: Record<string, unknown>): AccountErrorState {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    actionCode: (row.action_code as string) || '',
    errorCode: row.error_code as string,
    countConsecutiveErrors: row.count_consecutive_errors as number,
    lastErrorAt: (row.last_error_at as string | null) ?? null,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

export async function getErrorPolicy(errorCode: string): Promise<AutoErrorPolicy | null> {
  const { data, error } = await client()
    .from('auto_error')
    .select('*')
    .eq('error_code', errorCode)
    .eq('is_active', true)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to get error policy: ${error.message}`)
  return data ? mapAutoErrorPolicyFromDB(data) : null
}

export async function getZaloErrorPolicyByCode(code: string | number): Promise<AutoErrorPolicy | null> {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode) return null

  const { data, error } = await client()
    .from('auto_error')
    .select('*')
    .contains('zalo_error_codes', [normalizedCode])
    .eq('is_active', true)
    .eq('is_delete', false)
    .limit(1)

  if (error) throw new Error(`Failed to get Zalo error policy: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : null
  return row ? mapAutoErrorPolicyFromDB(row) : null
}

export async function listErrorPolicies(): Promise<AutoErrorPolicy[]> {
  const { data, error } = await client()
    .from('auto_error')
    .select('*')
    .eq('is_active', true)
    .eq('is_delete', false)
    .order('id', { ascending: true })

  if (error) throw new Error(`Failed to list error policies: ${error.message}`)
  return (data || []).map(row => mapAutoErrorPolicyFromDB(row))
}

async function attachPolicies(rows: Record<string, unknown>[]): Promise<AccountErrorStateWithPolicy[]> {
  const states = rows.map(mapAccountErrorStateFromDB)
  const errorCodes = Array.from(new Set(states.map(state => state.errorCode).filter(Boolean)))
  if (errorCodes.length === 0) {
    return states.map(state => ({ state, policy: null }))
  }

  const { data, error } = await client()
    .from('auto_error')
    .select('*')
    .in('error_code', errorCodes)
    .eq('is_active', true)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to list error policies for states: ${error.message}`)
  const policyByCode = new Map((data || []).map(row => {
    const policy = mapAutoErrorPolicyFromDB(row)
    return [policy.errorCode, policy]
  }))

  return states.map(state => ({
    state,
    policy: policyByCode.get(state.errorCode) || null
  }))
}

export async function listAccountErrorStatesWithPolicies(
  accountId: number,
  actionCodes: string[],
  options: { startIso?: string; endIso?: string; limit: number }
): Promise<AccountErrorStateWithPolicy[]> {
  const normalizedActionCodes = Array.from(new Set([
    ...actionCodes.map(code => code.trim()).filter(Boolean),
    ''
  ]))

  const readRows = async (withDateRange: boolean): Promise<Record<string, unknown>[]> => {
    let query = client()
      .from('auto_account_error_state')
      .select('*')
      .eq('account_id', accountId)
      .order('last_error_at', { ascending: false })
      .limit(options.limit)

    if (normalizedActionCodes.length > 0) {
      query = query.in('action_code', normalizedActionCodes)
    }
    if (withDateRange && options.startIso && options.endIso) {
      query = query
        .gte('last_error_at', options.startIso)
        .lt('last_error_at', options.endIso)
    }

    const { data, error } = await query
    if (error) throw new Error(`Failed to list account error states: ${error.message}`)
    return (data || []) as Record<string, unknown>[]
  }

  let rows = await readRows(Boolean(options.startIso && options.endIso))
  if (rows.length === 0 && options.startIso && options.endIso) {
    rows = await readRows(false)
  }

  return attachPolicies(rows)
}

export async function incrementConsecutiveError(
  accountId: number,
  actionCode: string | null | undefined,
  errorCode: string
): Promise<number> {
  const normalizedActionCode = actionCode?.trim() || ''
  const { data: existing, error: selectError } = await client()
    .from('auto_account_error_state')
    .select('*')
    .eq('account_id', accountId)
    .eq('action_code', normalizedActionCode)
    .eq('error_code', errorCode)
    .maybeSingle()

  if (selectError) throw new Error(`Failed to get consecutive error state: ${selectError.message}`)

  const nextCount = Number(existing?.count_consecutive_errors || 0) + 1
  if (existing) {
    const { error } = await client()
      .from('auto_account_error_state')
      .update({
        count_consecutive_errors: nextCount,
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id)

    if (error) throw new Error(`Failed to update consecutive error state: ${error.message}`)
    return nextCount
  }

  const { error } = await client()
    .from('auto_account_error_state')
    .insert({
      account_id: accountId,
      action_code: normalizedActionCode,
      error_code: errorCode,
      count_consecutive_errors: nextCount,
      last_error_at: new Date().toISOString()
    })

  if (error) throw new Error(`Failed to create consecutive error state: ${error.message}`)
  return nextCount
}

export async function resetConsecutiveErrors(accountId: number, actionCode?: string | null): Promise<void> {
  let query = client()
    .from('auto_account_error_state')
    .update({
      count_consecutive_errors: 0,
      updated_at: new Date().toISOString()
    })
    .eq('account_id', accountId)

  if (actionCode !== undefined) query = query.eq('action_code', actionCode?.trim() || '')

  const { error } = await query
  if (error) throw new Error(`Failed to reset consecutive error state: ${error.message}`)
}
