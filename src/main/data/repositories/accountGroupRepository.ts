import { AccountGroupSettings, AutoAccountGroup } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAccountGroupFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function normalizeSettings(settings?: AccountGroupSettings | null): AccountGroupSettings {
  const sleepBetweenActions = normalizeOptionalNonNegativeInteger(settings?.sleepBetweenActions)
  const byActionCode: NonNullable<AccountGroupSettings['byActionCode']> = {}

  for (const [actionCode, limit] of Object.entries(settings?.byActionCode || {})) {
    const code = actionCode.trim()
    if (!code) continue
    const dailyLimit = normalizePositiveInteger(limit?.dailyLimit)
    const rateLimitCount = normalizePositiveInteger(limit?.rateLimitCount)
    const rateLimitMinutes = normalizePositiveInteger(limit?.rateLimitMinutes)
    if (dailyLimit || rateLimitCount || rateLimitMinutes) {
      byActionCode[code] = {
        ...(dailyLimit ? { dailyLimit } : {}),
        ...(rateLimitCount ? { rateLimitCount } : {}),
        ...(rateLimitMinutes ? { rateLimitMinutes } : {})
      }
    }
  }

  return {
    ...(sleepBetweenActions !== undefined ? { sleepBetweenActions } : {}),
    ...(Object.keys(byActionCode).length > 0 ? { byActionCode } : {})
  }
}

export async function listAccountGroups(flatformType?: string): Promise<AutoAccountGroup[]> {
  const u = requireCurrentUser()
  let query = client()
    .from('auto_account_groups')
    .select('*')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (flatformType) {
    query = query.eq('flatform_type', flatformType)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list account groups: ${error.message}`)
  return (data || []).map(row => mapAccountGroupFromDB(row))
}

export async function getAccountGroup(id: number): Promise<AutoAccountGroup | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_account_groups')
    .select('*')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to get account group: ${error.message}`)
  return data ? mapAccountGroupFromDB(data) : null
}

export async function createAccountGroup(group: Partial<AutoAccountGroup>): Promise<AutoAccountGroup> {
  const u = requireCurrentUser()
  const name = String(group.name || '').trim()
  if (!name) throw new Error('Tên nhóm không được để trống')

  const payload = {
    name,
    flatform_type: group.flatformType || 'facebook',
    settings: normalizeSettings(group.settings),
    is_active: group.isActive ?? true,
    staff_id: u.staffId,
    organization_id: u.organizationId
  }

  const { data, error } = await client()
    .from('auto_account_groups')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create account group: ${error.message}`)
  return mapAccountGroupFromDB(data)
}

export async function updateAccountGroup(id: number, updates: Partial<AutoAccountGroup>): Promise<AutoAccountGroup> {
  const u = requireCurrentUser()
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) {
    const name = String(updates.name || '').trim()
    if (!name) throw new Error('Tên nhóm không được để trống')
    payload.name = name
  }
  if (updates.flatformType !== undefined) {
    const existing = await getAccountGroup(id)
    if (!existing) throw new Error('Không tìm thấy nhóm account')
    if (existing.flatformType !== updates.flatformType) {
      const { count, error: countError } = await client()
        .from('auto_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('account_group_id', id)
        .eq('staff_id', u.staffId)
        .eq('is_delete', false)
      if (countError) throw new Error(`Failed to check account group usage: ${countError.message}`)
      if ((count || 0) > 0) {
        throw new Error('Không thể đổi nền tảng nhóm khi còn tài khoản đang dùng nhóm này')
      }
    }
    payload.flatform_type = updates.flatformType
  }
  if (updates.settings !== undefined) payload.settings = normalizeSettings(updates.settings)
  if (updates.isActive !== undefined) payload.is_active = updates.isActive

  const { data, error } = await client()
    .from('auto_account_groups')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .select()
    .single()

  if (error) throw new Error(`Failed to update account group: ${error.message}`)
  return mapAccountGroupFromDB(data)
}

export async function deleteAccountGroup(id: number): Promise<void> {
  const u = requireCurrentUser()
  const { count, error: countError } = await client()
    .from('auto_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('account_group_id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)

  if (countError) throw new Error(`Failed to check account group usage: ${countError.message}`)
  if ((count || 0) > 0) {
    throw new Error('Không thể xoá nhóm account khi còn tài khoản đang dùng nhóm này')
  }

  const { error } = await client()
    .from('auto_account_groups')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', u.staffId)

  if (error) throw new Error(`Failed to delete account group: ${error.message}`)
}

export async function validateAccountGroupForAccount(
  groupId: number | null | undefined,
  flatformType: string
): Promise<number | null> {
  if (groupId === undefined || groupId === null) return null

  const group = await getAccountGroup(groupId)
  if (!group || !group.isActive) throw new Error('Không tìm thấy nhóm account')
  if (group.flatformType !== flatformType) {
    throw new Error('Nhóm account không cùng nền tảng với tài khoản')
  }
  return group.id
}
