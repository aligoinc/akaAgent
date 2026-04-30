import { OrgChannelContact, ContactType } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapChannelContactFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()

export async function listContacts(channelId: number, contactType?: ContactType): Promise<OrgChannelContact[]> {
  const u = requireCurrentUser()
  let query = client()
    .from('org_channel_contacts')
    .select('*')
    .eq('channel_id', channelId)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('name', { ascending: true })

  if (contactType) {
    query = query.eq('contact_type', contactType)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list contacts: ${error.message}`)
  return (data || []).map(row => mapChannelContactFromDB(row))
}

export async function upsertContacts(contacts: Partial<OrgChannelContact>[]): Promise<number> {
  if (contacts.length === 0) return 0

  const u = requireCurrentUser()
  const validContacts = contacts.filter(c => c.uid)
  if (validContacts.length === 0) return 0

  let totalSaved = 0
  const chunkSize = 100

  for (let i = 0; i < validContacts.length; i += chunkSize) {
    const chunk = validContacts.slice(i, i + chunkSize)
    const payloads = chunk.map(c => ({
      channel_id: c.channelId,
      contact_type: c.contactType,
      name: c.name,
      uid: c.uid,
      url: c.url || null,
      extra_data: c.extraData || {},
      is_delete: false,
      staff_id: u.staffId,
      organization_id: u.organizationId,
      updated_at: new Date().toISOString()
    }))

    const { data, error } = await client()
      .from('org_channel_contacts')
      .upsert(payloads, { onConflict: 'channel_id,contact_type,uid' })
      .select()

    if (error) throw new Error(`Failed to upsert contacts: ${error.message}`)
    totalSaved += data?.length || 0
  }

  return totalSaved
}

export async function deleteContacts(channelId: number, contactType: ContactType): Promise<void> {
  const u = requireCurrentUser()
  const { error } = await client()
    .from('org_channel_contacts')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('channel_id', channelId)
    .eq('staff_id', u.staffId)
    .eq('contact_type', contactType)

  if (error) throw new Error(`Failed to delete contacts: ${error.message}`)
}
