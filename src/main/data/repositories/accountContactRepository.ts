import { AutoAccountContact, AutoAccountContactGroup, ContactGroupMutationResult, ContactType } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAccountContactFromDB, mapAccountContactGroupFromDB } from '../mappers'
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

function contactUpsertKey(accountId: unknown, contactType: unknown, uid: unknown): string {
  return `${String(accountId)}:${String(contactType)}:${String(uid || '').trim()}`
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []
}

function mergeContactExtraData(
  existingExtraData: unknown,
  nextExtraData: unknown
): Record<string, unknown> {
  const existing = toRecord(existingExtraData)
  const next = toRecord(nextExtraData)
  const merged: Record<string, unknown> = { ...existing, ...next }
  const sourcePostUrls = [
    ...toStringArray(existing.sourcePostUrls),
    existing.sourcePostUrl,
    ...toStringArray(next.sourcePostUrls),
    next.sourcePostUrl
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)

  if (sourcePostUrls.length > 0) {
    merged.sourcePostUrls = Array.from(new Set(sourcePostUrls))
  }

  return merged
}

async function loadExistingContactExtraData(
  contacts: Partial<AutoAccountContact>[],
  staffId: number
): Promise<Map<string, Record<string, unknown>>> {
  const groups = new Map<string, { accountId: number; contactType: ContactType; uids: Set<string> }>()

  for (const contact of contacts) {
    const accountId = contact.accountId as number
    const contactType = contact.contactType as ContactType
    const uid = String(contact.uid || '').trim()
    const groupKey = `${accountId}:${contactType}`
    const group = groups.get(groupKey) || { accountId, contactType, uids: new Set<string>() }
    group.uids.add(uid)
    groups.set(groupKey, group)
  }

  const existingByKey = new Map<string, Record<string, unknown>>()
  const chunkSize = 100

  for (const group of groups.values()) {
    const uids = Array.from(group.uids)
    for (let i = 0; i < uids.length; i += chunkSize) {
      const chunk = uids.slice(i, i + chunkSize)
      const { data, error } = await client()
        .from('auto_account_contacts')
        .select('account_id, contact_type, uid, extra_data')
        .eq('account_id', group.accountId)
        .eq('staff_id', staffId)
        .eq('contact_type', group.contactType)
        .in('uid', chunk)

      if (error) throw new Error(`Failed to list existing contact metadata: ${error.message}`)

      for (const row of data || []) {
        existingByKey.set(
          contactUpsertKey(row.account_id, row.contact_type, row.uid),
          toRecord(row.extra_data)
        )
      }
    }
  }

  return existingByKey
}

function getMissingSnapshotUpdates(contactType: ContactType) {
  if (contactType === 'group') {
    return { is_joined: false, is_delete: false, updated_at: new Date().toISOString() }
  }
  if (contactType === 'person') {
    return { is_friend: false, is_delete: false, updated_at: new Date().toISOString() }
  }
  return { is_delete: true, updated_at: new Date().toISOString() }
}

async function updateMissingContactsFromSnapshot(
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
      const { error: updateError } = await client()
        .from('auto_account_contacts')
        .update(getMissingSnapshotUpdates(snapshot.contactType))
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

export async function getGroupContactByTarget(
  accountId: number,
  targetUrl: string | undefined | null
): Promise<AutoAccountContact | null> {
  const u = requireCurrentUser()
  const uid = extractGroupUidForStatus(targetUrl)
  if (!uid) return null

  const { data, error } = await client()
    .from('auto_account_contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('contact_type', 'group')
    .eq('uid', uid)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to find group contact: ${error.message}`)
  return data ? mapAccountContactFromDB(data) : null
}

export async function upsertContacts(
  contacts: Partial<AutoAccountContact>[],
  options: UpsertContactsOptions = {}
): Promise<number> {
  if (contacts.length === 0) return 0

  const u = requireCurrentUser()
  const validContacts = dedupeValidContacts(contacts)
  if (validContacts.length === 0) return 0
  const existingExtraDataByKey = await loadExistingContactExtraData(validContacts, u.staffId)

  let totalSaved = 0
  const chunkSize = 100

  for (let i = 0; i < validContacts.length; i += chunkSize) {
    const chunk = validContacts.slice(i, i + chunkSize)
    const payloads = chunk.map(c => {
      const existingExtraData = existingExtraDataByKey.get(contactUpsertKey(c.accountId, c.contactType, c.uid))
      const payload: any = {
        account_id: c.accountId,
        contact_type: c.contactType,
        name: c.name,
        uid: c.uid,
        url: c.url || null,
        extra_data: mergeContactExtraData(existingExtraData, c.extraData),
        is_delete: false,
        staff_id: u.staffId,
        organization_id: u.organizationId,
        updated_at: new Date().toISOString()
      }
      if (c.contactType === 'group') {
        payload.is_joined = c.isJoined ?? true
      } else if (c.contactType === 'person') {
        payload.is_friend = c.isFriend ?? true
      } else if (c.isJoined !== undefined) {
        payload.is_joined = c.isJoined
      }
      if (c.isFriend !== undefined) {
        payload.is_friend = c.isFriend
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
    await updateMissingContactsFromSnapshot(validContacts, u.staffId)
  }

  return totalSaved
}

export async function deleteContacts(accountId: number, contactType: ContactType): Promise<void> {
  const u = requireCurrentUser()

  const { error } = await client()
    .from('auto_account_contacts')
    .update(getMissingSnapshotUpdates(contactType))
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('contact_type', contactType)

  if (error) throw new Error(`Failed to delete contacts: ${error.message}`)
}

function normalizeGroupName(name: string): string {
  return String(name || '').replace(/\s+/g, ' ').trim()
}

function uniqueIds(ids: number[]): number[] {
  return Array.from(new Set(
    ids
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && id > 0)
  ))
}

async function getContactGroup(groupId: number): Promise<AutoAccountContactGroup> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_account_contact_groups')
    .select('*')
    .eq('id', groupId)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .single()

  if (error) throw new Error(`Failed to get contact group: ${error.message}`)
  return mapAccountContactGroupFromDB(data)
}

async function getActiveContactIds(contactIds: number[], staffId: number): Promise<Set<number>> {
  const ids = uniqueIds(contactIds)
  if (ids.length === 0) return new Set()

  const { data, error } = await client()
    .from('auto_account_contacts')
    .select('id')
    .in('id', ids)
    .eq('staff_id', staffId)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to list active contacts: ${error.message}`)
  return new Set((data || []).map(row => row.id as number))
}

export async function listContactGroups(
  accountId: number,
  contactType?: ContactType
): Promise<AutoAccountContactGroup[]> {
  const u = requireCurrentUser()
  let query = client()
    .from('auto_account_contact_groups')
    .select('*')
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)

  if (contactType) query = query.eq('contact_type', contactType)

  const { data, error } = await query
    .order('name', { ascending: true })

  if (error) throw new Error(`Failed to list contact groups: ${error.message}`)

  const groups = (data || []).map(row => mapAccountContactGroupFromDB(row))
  if (groups.length === 0) return groups

  const groupIds = groups.map(group => group.id)
  const { data: members, error: memberError } = await client()
    .from('auto_account_contact_group_members')
    .select('group_id, contact_id')
    .in('group_id', groupIds)

  if (memberError) throw new Error(`Failed to list contact group members: ${memberError.message}`)

  const activeContactIds = await getActiveContactIds(
    (members || []).map(row => row.contact_id as number),
    u.staffId
  )
  const counts = new Map<number, number>()
  for (const member of members || []) {
    const contactId = member.contact_id as number
    if (!activeContactIds.has(contactId)) continue
    const groupId = member.group_id as number
    counts.set(groupId, (counts.get(groupId) || 0) + 1)
  }

  return groups.map(group => ({
    ...group,
    contactCount: counts.get(group.id) || 0
  }))
}

export async function createContactGroup(
  accountId: number,
  contactType: ContactType,
  name: string
): Promise<AutoAccountContactGroup> {
  const u = requireCurrentUser()
  const normalizedName = normalizeGroupName(name)
  if (!normalizedName) throw new Error('Vui lòng nhập tên nhóm.')

  const { data, error } = await client()
    .from('auto_account_contact_groups')
    .insert({
      account_id: accountId,
      contact_type: contactType,
      name: normalizedName,
      is_delete: false,
      staff_id: u.staffId,
      organization_id: u.organizationId,
      updated_at: new Date().toISOString()
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') throw new Error('Tên nhóm đã tồn tại.')
    throw new Error(`Failed to create contact group: ${error.message}`)
  }
  return { ...mapAccountContactGroupFromDB(data), contactCount: 0 }
}

export async function updateContactGroup(
  groupId: number,
  name: string
): Promise<AutoAccountContactGroup> {
  const u = requireCurrentUser()
  const normalizedName = normalizeGroupName(name)
  if (!normalizedName) throw new Error('Vui lòng nhập tên nhóm.')

  const { data, error } = await client()
    .from('auto_account_contact_groups')
    .update({
      name: normalizedName,
      updated_at: new Date().toISOString()
    })
    .eq('id', groupId)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') throw new Error('Tên nhóm đã tồn tại.')
    throw new Error(`Failed to update contact group: ${error.message}`)
  }
  return mapAccountContactGroupFromDB(data)
}

export async function deleteContactGroup(groupId: number): Promise<void> {
  const u = requireCurrentUser()
  const { error } = await client()
    .from('auto_account_contact_groups')
    .update({
      is_delete: true,
      updated_at: new Date().toISOString()
    })
    .eq('id', groupId)
    .eq('staff_id', u.staffId)

  if (error) throw new Error(`Failed to delete contact group: ${error.message}`)
}

export async function listContactGroupContacts(groupId: number): Promise<AutoAccountContact[]> {
  const u = requireCurrentUser()
  const group = await getContactGroup(groupId)

  const { data: members, error: memberError } = await client()
    .from('auto_account_contact_group_members')
    .select('contact_id')
    .eq('group_id', groupId)

  if (memberError) throw new Error(`Failed to list contact group members: ${memberError.message}`)

  const contactIds = uniqueIds((members || []).map(row => row.contact_id as number))
  if (contactIds.length === 0) return []

  const { data, error } = await client()
    .from('auto_account_contacts')
    .select('*')
    .in('id', contactIds)
    .eq('account_id', group.accountId)
    .eq('contact_type', group.contactType)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('name', { ascending: true })

  if (error) throw new Error(`Failed to list contacts in group: ${error.message}`)
  return (data || []).map(row => mapAccountContactFromDB(row))
}

export async function addContactsToGroup(
  groupId: number,
  contactIds: number[]
): Promise<ContactGroupMutationResult> {
  const u = requireCurrentUser()
  const group = await getContactGroup(groupId)
  const ids = uniqueIds(contactIds)
  if (ids.length === 0) return { success: true, count: 0 }

  const { data: contacts, error: contactError } = await client()
    .from('auto_account_contacts')
    .select('id')
    .in('id', ids)
    .eq('account_id', group.accountId)
    .eq('contact_type', group.contactType)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)

  if (contactError) throw new Error(`Failed to validate contacts: ${contactError.message}`)

  const validIds = uniqueIds((contacts || []).map(row => row.id as number))
  if (validIds.length === 0) return { success: true, count: 0 }

  const { data: existing, error: existingError } = await client()
    .from('auto_account_contact_group_members')
    .select('contact_id')
    .eq('group_id', groupId)
    .in('contact_id', validIds)

  if (existingError) throw new Error(`Failed to list existing group members: ${existingError.message}`)

  const existingIds = new Set((existing || []).map(row => row.contact_id as number))
  const idsToInsert = validIds.filter(id => !existingIds.has(id))
  if (idsToInsert.length === 0) return { success: true, count: 0 }

  const { error } = await client()
    .from('auto_account_contact_group_members')
    .upsert(idsToInsert.map(contactId => ({
      group_id: groupId,
      contact_id: contactId
    })), { onConflict: 'group_id,contact_id', ignoreDuplicates: true })

  if (error) throw new Error(`Failed to add contacts to group: ${error.message}`)
  return { success: true, count: idsToInsert.length }
}

export async function removeContactsFromGroup(
  groupId: number,
  contactIds: number[]
): Promise<ContactGroupMutationResult> {
  await getContactGroup(groupId)
  const ids = uniqueIds(contactIds)
  if (ids.length === 0) return { success: true, count: 0 }

  const { data, error } = await client()
    .from('auto_account_contact_group_members')
    .delete()
    .eq('group_id', groupId)
    .in('contact_id', ids)
    .select('id')

  if (error) throw new Error(`Failed to remove contacts from group: ${error.message}`)
  return { success: true, count: data?.length || 0 }
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
