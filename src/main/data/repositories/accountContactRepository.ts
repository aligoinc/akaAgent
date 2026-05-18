import { AutoAccountContact, ContactType } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAccountContactFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

interface UpsertContactsOptions {
  markMissingDeleted?: boolean
}

interface UpsertGroupPostContactStatusInput {
  accountId: number
  targetUrl?: string | null
  targetName?: string | null
  requiresPostApproval?: boolean
}

const client = () => getSupabaseClient()
const GROUP_ACTIVITY_RE = /\s*(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i

function parseFacebookUrl(value: string): URL | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
}

function extractUid(value: string | undefined, contactType: ContactType): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const cleaned = raw.replace(/^\/+|\/+$/g, '')
  if (contactType === 'group' && /^groups\//i.test(cleaned)) {
    return cleaned.split('/').filter(Boolean)[1] || cleaned
  }
  if (contactType === 'page' && /^pages\//i.test(cleaned)) {
    const parts = cleaned.split('/').filter(Boolean)
    return parts[parts.length - 1] || cleaned
  }
  const url = parseFacebookUrl(raw)
  if (!url) return cleaned

  if (contactType === 'group') {
    const parts = url.pathname.split('/').filter(Boolean)
    const groupIdx = parts.findIndex(part => part.toLowerCase() === 'groups')
    return groupIdx >= 0 && parts[groupIdx + 1] ? parts[groupIdx + 1] : raw
  }

  const idParam = url.searchParams.get('id')
  if (idParam) return idParam
  const parts = url.pathname.split('/').filter(Boolean)
  if (contactType === 'page' && parts[0]?.toLowerCase() === 'pages' && parts.length > 1) {
    return parts[parts.length - 1] || raw
  }
  return parts[0] || raw
}

function extractGroupUidForStatus(value: string | undefined | null): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const cleaned = raw.replace(/^\/+|\/+$/g, '')
  if (/^groups\//i.test(cleaned)) {
    return cleaned.split('/').filter(Boolean)[1] || ''
  }

  const url = parseFacebookUrl(raw)
  if (url) {
    const parts = url.pathname.split('/').filter(Boolean)
    const groupIdx = parts.findIndex(part => part.toLowerCase() === 'groups')
    return groupIdx >= 0 && parts[groupIdx + 1] ? parts[groupIdx + 1] : ''
  }

  return /^[a-zA-Z0-9._-]+$/.test(cleaned) ? cleaned : ''
}

function normalizeContactUrl(uid: string, url: string | undefined, contactType: ContactType): string | null {
  const rawUrl = String(url || '').trim()
  if (rawUrl) return rawUrl
  if (!uid) return null
  if (contactType === 'group') return `https://www.facebook.com/groups/${uid}`
  if (contactType === 'page') return `https://www.facebook.com/${uid}`
  if (/^\d+$/.test(uid)) return `https://www.facebook.com/profile.php?id=${uid}`
  return `https://www.facebook.com/${uid}`
}

function normalizeContact(contact: Partial<AutoAccountContact>): Partial<AutoAccountContact> {
  const contactType = contact.contactType as ContactType
  const uid = extractUid(contact.uid || contact.url, contactType)
  let name = String(contact.name || '').replace(/\s+/g, ' ').trim()
  let lastActivityText = ''

  if (contactType === 'group') {
    const activityMatch = name.match(/(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i)
    lastActivityText = activityMatch ? activityMatch[0].trim() : ''
    name = name.replace(GROUP_ACTIVITY_RE, '').trim()
  }

  return {
    ...contact,
    uid,
    name,
    url: normalizeContactUrl(uid, contact.url, contactType) || undefined,
    extraData: lastActivityText
      ? { ...(contact.extraData || {}), lastActivityText }
      : contact.extraData
  }
}

function dedupeValidContacts(contacts: Partial<AutoAccountContact>[]): Partial<AutoAccountContact>[] {
  const byKey = new Map<string, Partial<AutoAccountContact>>()
  for (const contact of contacts) {
    const normalized = normalizeContact(contact)
    if (typeof normalized.accountId !== 'number' || !normalized.contactType || !normalized.uid || !normalized.name) {
      continue
    }
    byKey.set(`${normalized.accountId}:${normalized.contactType}:${normalized.uid}`, normalized)
  }
  return Array.from(byKey.values())
}

async function markMissingContactsDeleted(
  contacts: Partial<AutoAccountContact>[],
  staffId: number
): Promise<void> {
  const snapshots = new Map<string, { accountId: number; contactType: ContactType; uids: Set<string> }>()

  for (const contact of contacts) {
    const accountId = contact.accountId as number
    const contactType = contact.contactType as ContactType
    const uid = String(contact.uid || '').trim()
    const key = `${accountId}:${contactType}`
    const snapshot = snapshots.get(key) || { accountId, contactType, uids: new Set<string>() }
    snapshot.uids.add(uid)
    snapshots.set(key, snapshot)
  }

  for (const snapshot of snapshots.values()) {
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('id, uid')
      .eq('account_id', snapshot.accountId)
      .eq('staff_id', staffId)
      .eq('contact_type', snapshot.contactType)
      .eq('is_delete', false)

    if (error) throw new Error(`Failed to list existing contacts for cleanup: ${error.message}`)

    const idsToUpdate = (data || [])
      .filter(row => !snapshot.uids.has(String(row.uid || '').trim()))
      .map(row => row.id as number)

    const chunkSize = 100
    for (let i = 0; i < idsToUpdate.length; i += chunkSize) {
      const chunk = idsToUpdate.slice(i, i + chunkSize)
      const updates = snapshot.contactType === 'group'
        ? { is_joined: false, is_delete: false, updated_at: new Date().toISOString() }
        : { is_delete: true, updated_at: new Date().toISOString() }
      const { error: updateError } = await client()
        .from('auto_account_contacts')
        .update(updates)
        .in('id', chunk)

      if (updateError) throw new Error(`Failed to update missing contacts: ${updateError.message}`)
    }
  }
}

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

export async function upsertContacts(
  contacts: Partial<AutoAccountContact>[],
  options: UpsertContactsOptions = {}
): Promise<number> {
  if (contacts.length === 0) return 0

  const u = requireCurrentUser()
  const validContacts = dedupeValidContacts(contacts)
  if (validContacts.length === 0) return 0

  let totalSaved = 0
  const chunkSize = 100

  for (let i = 0; i < validContacts.length; i += chunkSize) {
    const chunk = validContacts.slice(i, i + chunkSize)
    const payloads = chunk.map(c => {
      const payload: any = {
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
      }
      if (c.contactType === 'group') {
        payload.is_joined = c.isJoined ?? true
      } else if (c.isJoined !== undefined) {
        payload.is_joined = c.isJoined
      }
      if (c.requiresPostApproval !== undefined) {
        payload.requires_post_approval = c.requiresPostApproval
      }
      return payload
    })

    const { data, error } = await client()
      .from('auto_account_contacts')
      .upsert(payloads, { onConflict: 'account_id,contact_type,uid' })
      .select()

    if (error) throw new Error(`Failed to upsert contacts: ${error.message}`)
    totalSaved += data?.length || 0
  }

  if (options.markMissingDeleted !== false) {
    await markMissingContactsDeleted(validContacts, u.staffId)
  }

  return totalSaved
}

export async function deleteContacts(accountId: number, contactType: ContactType): Promise<void> {
  const u = requireCurrentUser()
  const updates = contactType === 'group'
    ? { is_joined: false, is_delete: false, updated_at: new Date().toISOString() }
    : { is_delete: true, updated_at: new Date().toISOString() }

  const { error } = await client()
    .from('auto_account_contacts')
    .update(updates)
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('contact_type', contactType)

  if (error) throw new Error(`Failed to delete contacts: ${error.message}`)
}

export async function upsertGroupPostContactStatus(
  input: UpsertGroupPostContactStatusInput
): Promise<AutoAccountContact | null> {
  const u = requireCurrentUser()
  const uid = extractGroupUidForStatus(input.targetUrl)
  if (!uid) return null

  const now = new Date().toISOString()
  const url = normalizeContactUrl(uid, input.targetUrl || undefined, 'group') || `https://www.facebook.com/groups/${uid}`
  const name = String(input.targetName || '').replace(/\s+/g, ' ').trim() || uid

  const { data: existing, error: existingError } = await client()
    .from('auto_account_contacts')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('staff_id', u.staffId)
    .eq('contact_type', 'group')
    .eq('uid', uid)
    .maybeSingle()

  if (existingError) {
    throw new Error(`Failed to find group contact: ${existingError.message}`)
  }

  if (existing) {
    const payload: any = {
      name,
      url,
      is_delete: false,
      updated_at: now
    }
    if (input.requiresPostApproval !== undefined) {
      payload.requires_post_approval = input.requiresPostApproval
    }

    const { data, error } = await client()
      .from('auto_account_contacts')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update group contact status: ${error.message}`)
    return mapAccountContactFromDB(data)
  }

  const { data, error } = await client()
    .from('auto_account_contacts')
    .insert({
      account_id: input.accountId,
      contact_type: 'group',
      name,
      uid,
      url,
      extra_data: { source: 'facebook_group_post_campaign' },
      requires_post_approval: input.requiresPostApproval ?? null,
      is_joined: false,
      is_delete: false,
      staff_id: u.staffId,
      organization_id: u.organizationId,
      updated_at: now
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to insert group contact status: ${error.message}`)
  return mapAccountContactFromDB(data)
}
