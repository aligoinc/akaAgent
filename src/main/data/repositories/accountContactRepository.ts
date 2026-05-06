import { AutoAccountContact, ContactType } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAccountContactFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()

export async function listContacts(accountId: number, contactType?: ContactType): Promise<AutoAccountContact[]> {
  const u = requireCurrentUser()
  let query = client()
    .from('auto_account_contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('name', { ascending: true })

  if (contactType) {
    query = query.eq('contact_type', contactType)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list contacts: ${error.message}`)
  return (data || []).map(row => mapAccountContactFromDB(row))
}

export async function upsertContacts(contacts: Partial<AutoAccountContact>[]): Promise<number> {
  if (contacts.length === 0) return 0

  const u = requireCurrentUser()
  const validContacts = contacts.filter(c => c.uid)
  if (validContacts.length === 0) return 0

  let totalSaved = 0
  const chunkSize = 100

  for (let i = 0; i < validContacts.length; i += chunkSize) {
    const chunk = validContacts.slice(i, i + chunkSize)
    const payloads = chunk.map(c => ({
      account_id: c.accountId,
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
      .from('auto_account_contacts')
      .upsert(payloads, { onConflict: 'account_id,contact_type,uid' })
      .select()

    if (error) throw new Error(`Failed to upsert contacts: ${error.message}`)
    totalSaved += data?.length || 0
  }

  return totalSaved
}

export async function deleteContacts(accountId: number, contactType: ContactType): Promise<void> {
  const u = requireCurrentUser()
  const { error } = await client()
    .from('auto_account_contacts')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('contact_type', contactType)

  if (error) throw new Error(`Failed to delete contacts: ${error.message}`)
}
