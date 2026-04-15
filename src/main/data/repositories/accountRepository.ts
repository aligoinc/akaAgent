import { FlatformAccount } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAccountFromDB } from '../mappers'

const client = () => getSupabaseClient()

export async function listAccounts(): Promise<FlatformAccount[]> {
  const { data, error } = await client()
    .from('auto_flatform_accounts')
    .select('*')
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list accounts: ${error.message}`)
  return (data || []).map(row => mapAccountFromDB(row))
}

export async function createAccount(account: Partial<FlatformAccount>): Promise<FlatformAccount> {
  const payload = {
    name: account.name,
    flatform_type: account.flatformType || 'facebook',
    login_status: account.loginStatus || 'ch\u01b0a \u0111\u0103ng nh\u1eadp',
    status: account.status || 'ch\u1edd x\u1eed l\u00fd',
    is_active: account.isActive ?? true
  }

  const { data, error } = await client()
    .from('auto_flatform_accounts')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create account: ${error.message}`)
  return mapAccountFromDB(data)
}

export async function updateAccount(id: number, updates: Partial<FlatformAccount>): Promise<FlatformAccount> {
  const payload: any = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.flatformType !== undefined) payload.flatform_type = updates.flatformType
  if (updates.loginStatus !== undefined) payload.login_status = updates.loginStatus
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.isActive !== undefined) payload.is_active = updates.isActive

  const { data, error } = await client()
    .from('auto_flatform_accounts')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update account: ${error.message}`)
  return mapAccountFromDB(data)
}

export async function deleteAccount(id: number): Promise<void> {
  const { error } = await client()
    .from('auto_flatform_accounts')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete account: ${error.message}`)
}

export async function getEligibleAccounts(): Promise<FlatformAccount[]> {
  const { data, error } = await client()
    .from('auto_flatform_accounts')
    .select('*')
    .eq('is_active', true)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to get eligible accounts: ${error.message}`)
  return (data || []).map(row => mapAccountFromDB(row))
}

export async function resetRunningAccountStatuses(): Promise<void> {
  const { error } = await client()
    .from('auto_flatform_accounts')
    .update({ status: 'ch\u1edd x\u1eed l\u00fd' })
    .eq('status', '\u0111ang ch\u1ea1y')

  if (error) console.error('Failed to reset account statuses:', error.message)
}
