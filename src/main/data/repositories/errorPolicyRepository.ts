import { AutoErrorPolicy } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAutoErrorPolicyFromDB } from '../mappers'

const client = () => getSupabaseClient()

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
