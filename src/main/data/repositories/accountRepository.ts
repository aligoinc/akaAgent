import { AutoAccount } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAccountFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()
const DEFAULT_RATE_LIMIT_MINUTES = 65

function normalizeRateLimitMinutes(value: unknown): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_MINUTES
}

export async function getAccount(id: number): Promise<AutoAccount | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_accounts')
    .select('*')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to get account: ${error.message}`)
  return data ? mapAccountFromDB(data) : null
}

export async function listAccounts(): Promise<AutoAccount[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_accounts')
    .select('*')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list accounts: ${error.message}`)
  return (data || []).map(row => mapAccountFromDB(row))
}

export async function createAccount(account: Partial<AutoAccount>): Promise<AutoAccount> {
  const u = requireCurrentUser()
  const payload = {
    name: account.name,
    flatform_type: account.flatformType || 'facebook',
    login_status: account.loginStatus || 'ch\u01b0a \u0111\u0103ng nh\u1eadp',
    status: account.status || 'ch\u1edd x\u1eed l\u00fd',
    is_active: account.isActive ?? true,
    rate_limit_minutes: normalizeRateLimitMinutes(account.rateLimitMinutes),
    staff_id: u.staffId,
    organization_id: u.organizationId
  }

  const { data, error } = await client()
    .from('auto_accounts')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create account: ${error.message}`)
  return mapAccountFromDB(data)
}

export async function updateAccount(id: number, updates: Partial<AutoAccount>): Promise<AutoAccount> {
  const u = requireCurrentUser()
  const payload: any = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.flatformType !== undefined) payload.flatform_type = updates.flatformType
  if (updates.loginStatus !== undefined) payload.login_status = updates.loginStatus
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.isActive !== undefined) payload.is_active = updates.isActive
  if (updates.rateLimitMinutes !== undefined) payload.rate_limit_minutes = normalizeRateLimitMinutes(updates.rateLimitMinutes)

  const { data, error } = await client()
    .from('auto_accounts')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select()
    .single()

  if (error) throw new Error(`Failed to update account: ${error.message}`)
  return mapAccountFromDB(data)
}

export async function deleteAccount(id: number): Promise<void> {
  const u = requireCurrentUser()
  const { error } = await client()
    .from('auto_accounts')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', u.staffId)

  if (error) throw new Error(`Failed to delete account: ${error.message}`)
}

export async function getEligibleAccounts(): Promise<AutoAccount[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_accounts')
    .select('*')
    .eq('staff_id', u.staffId)
    .eq('is_active', true)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to get eligible accounts: ${error.message}`)
  return (data || []).map(row => mapAccountFromDB(row))
}

export async function resetRunningAccountStatuses(staffId: number): Promise<void> {
  const { error } = await client()
    .from('auto_accounts')
    .update({ status: 'ch\u1edd x\u1eed l\u00fd' })
    .eq('staff_id', staffId)
    .eq('status', '\u0111ang ch\u1ea1y')

  if (error) console.error('Failed to reset account statuses:', error.message)
}
