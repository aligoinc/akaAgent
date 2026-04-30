import { OrgChannel } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapChannelFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()

export async function listChannels(): Promise<OrgChannel[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('org_channels')
    .select('*')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list channels: ${error.message}`)
  return (data || []).map(row => mapChannelFromDB(row))
}

export async function createChannel(channel: Partial<OrgChannel>): Promise<OrgChannel> {
  const u = requireCurrentUser()
  const payload = {
    name: channel.name,
    flatform_type: channel.flatformType || 'facebook',
    login_status: channel.loginStatus || 'ch\u01b0a \u0111\u0103ng nh\u1eadp',
    status: channel.status || 'ch\u1edd x\u1eed l\u00fd',
    is_active: channel.isActive ?? true,
    staff_id: u.staffId,
    organization_id: u.organizationId
  }

  const { data, error } = await client()
    .from('org_channels')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create channel: ${error.message}`)
  return mapChannelFromDB(data)
}

export async function updateChannel(id: number, updates: Partial<OrgChannel>): Promise<OrgChannel> {
  const u = requireCurrentUser()
  const payload: any = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.flatformType !== undefined) payload.flatform_type = updates.flatformType
  if (updates.loginStatus !== undefined) payload.login_status = updates.loginStatus
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.isActive !== undefined) payload.is_active = updates.isActive

  const { data, error } = await client()
    .from('org_channels')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select()
    .single()

  if (error) throw new Error(`Failed to update channel: ${error.message}`)
  return mapChannelFromDB(data)
}

export async function deleteChannel(id: number): Promise<void> {
  const u = requireCurrentUser()
  const { error } = await client()
    .from('org_channels')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', u.staffId)

  if (error) throw new Error(`Failed to delete channel: ${error.message}`)
}

export async function getEligibleChannels(): Promise<OrgChannel[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('org_channels')
    .select('*')
    .eq('staff_id', u.staffId)
    .eq('is_active', true)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to get eligible channels: ${error.message}`)
  return (data || []).map(row => mapChannelFromDB(row))
}

export async function resetRunningChannelStatuses(): Promise<void> {
  const { error } = await client()
    .from('org_channels')
    .update({ status: 'ch\u1edd x\u1eed l\u00fd' })
    .eq('status', '\u0111ang ch\u1ea1y')

  if (error) console.error('Failed to reset channel statuses:', error.message)
}
