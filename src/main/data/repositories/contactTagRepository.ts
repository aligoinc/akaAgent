import { AkaBizContactTag, ContactType } from '../../../shared/types'
import { mapAkaBizContactTagFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

export interface AkaBizContactTagTarget {
  accountId: number
  contactType: ContactType
  uid: string
}

export interface ContactTagMutationResult {
  success: boolean
  count: number
}

const client = () => getSupabaseClient()

function normalizeName(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeTagIds(values: unknown): number[] {
  const raw = Array.isArray(values) ? values : []
  const seen = new Set<number>()
  const ids: number[] = []
  for (const value of raw) {
    const id = Number(value)
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function sameNumberArray(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

async function listActiveTagIds(tagIds: number[], staffId: number): Promise<number[]> {
  const ids = normalizeTagIds(tagIds)
  if (ids.length === 0) return []

  const { data, error } = await client()
    .from('auto_contact_tags')
    .select('id')
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .in('id', ids)

  if (error) throw new Error(`Failed to validate akaBiz contact tags: ${error.message}`)
  const active = new Set((data || []).map(row => Number(row.id)).filter(id => Number.isFinite(id) && id > 0))
  return ids.filter(id => active.has(id))
}

async function getTag(tagId: number, staffId: number): Promise<AkaBizContactTag> {
  const { data, error } = await client()
    .from('auto_contact_tags')
    .select('*')
    .eq('id', tagId)
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .single()

  if (error) throw new Error(`Failed to get akaBiz contact tag: ${error.message}`)
  return mapAkaBizContactTagFromDB(data)
}

async function countContactsForTag(tagId: number, staffId: number): Promise<number> {
  const { count, error } = await client()
    .from('auto_account_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .contains('akabiz_tag_ids', [tagId])

  if (error) throw new Error(`Failed to count akaBiz tagged contacts: ${error.message}`)
  return count || 0
}

export async function listAkaBizContactTags(): Promise<AkaBizContactTag[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_contact_tags')
    .select('*')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('name', { ascending: true })

  if (error) throw new Error(`Failed to list akaBiz contact tags: ${error.message}`)

  const tags = (data || []).map(row => mapAkaBizContactTagFromDB(row))
  const withCounts: AkaBizContactTag[] = []
  for (const tag of tags) {
    withCounts.push({
      ...tag,
      contactCount: await countContactsForTag(tag.id, u.staffId)
    })
  }
  return withCounts
}

export async function createAkaBizContactTag(name: string): Promise<AkaBizContactTag> {
  const u = requireCurrentUser()
  const normalizedName = normalizeName(name)
  if (!normalizedName) throw new Error('Vui lòng nhập tên tag akaBiz.')

  const { data, error } = await client()
    .from('auto_contact_tags')
    .insert({
      name: normalizedName,
      staff_id: u.staffId,
      organization_id: u.organizationId,
      is_delete: false
    })
    .select('*')
    .single()

  if (error) throw new Error(`Failed to create akaBiz contact tag: ${error.message}`)
  return { ...mapAkaBizContactTagFromDB(data), contactCount: 0 }
}

export async function updateAkaBizContactTag(tagId: number, name: string): Promise<AkaBizContactTag> {
  const u = requireCurrentUser()
  const id = Number(tagId)
  const normalizedName = normalizeName(name)
  if (!Number.isFinite(id) || id <= 0) throw new Error('Tag akaBiz không hợp lệ.')
  if (!normalizedName) throw new Error('Vui lòng nhập tên tag akaBiz.')

  await getTag(id, u.staffId)
  const { data, error } = await client()
    .from('auto_contact_tags')
    .update({ name: normalizedName, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .select('*')
    .single()

  if (error) throw new Error(`Failed to update akaBiz contact tag: ${error.message}`)
  return { ...mapAkaBizContactTagFromDB(data), contactCount: await countContactsForTag(id, u.staffId) }
}

async function removeTagFromContacts(tagId: number, staffId: number): Promise<void> {
  const { data, error } = await client()
    .from('auto_account_contacts')
    .select('id, akabiz_tag_ids')
    .eq('staff_id', staffId)
    .contains('akabiz_tag_ids', [tagId])

  if (error) throw new Error(`Failed to list contacts for akaBiz tag cleanup: ${error.message}`)
  const now = new Date().toISOString()
  for (const row of data || []) {
    const current = normalizeTagIds(row.akabiz_tag_ids)
    const next = current.filter(id => id !== tagId)
    const { error: updateError } = await client()
      .from('auto_account_contacts')
      .update({ akabiz_tag_ids: next, updated_at: now })
      .eq('id', row.id)
      .eq('staff_id', staffId)

    if (updateError) throw new Error(`Failed to cleanup deleted akaBiz tag from contacts: ${updateError.message}`)
  }
}

export async function deleteAkaBizContactTag(tagId: number): Promise<void> {
  const u = requireCurrentUser()
  const id = Number(tagId)
  if (!Number.isFinite(id) || id <= 0) throw new Error('Tag akaBiz không hợp lệ.')

  await getTag(id, u.staffId)
  const { error } = await client()
    .from('auto_contact_tags')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to delete akaBiz contact tag: ${error.message}`)
  await removeTagFromContacts(id, u.staffId)
}

async function applyTagsToRows(
  rows: Array<{ id: unknown; akabiz_tag_ids?: unknown }>,
  tagIds: number[],
  staffId: number
): Promise<number> {
  const activeTagIds = await listActiveTagIds(tagIds, staffId)
  if (activeTagIds.length === 0 || rows.length === 0) return 0

  const now = new Date().toISOString()
  let changedCount = 0
  for (const row of rows) {
    const current = normalizeTagIds(row.akabiz_tag_ids)
    const next = normalizeTagIds([...current, ...activeTagIds])
    if (sameNumberArray(current, next)) continue

    const { error } = await client()
      .from('auto_account_contacts')
      .update({ akabiz_tag_ids: next, updated_at: now })
      .eq('id', row.id)
      .eq('staff_id', staffId)

    if (error) throw new Error(`Failed to apply akaBiz contact tags: ${error.message}`)
    changedCount += 1
  }

  return changedCount
}

export async function applyAkaBizTagsToContactIds(
  contactIds: number[],
  tagIds: number[]
): Promise<ContactTagMutationResult> {
  const u = requireCurrentUser()
  const ids = normalizeTagIds(contactIds)
  if (ids.length === 0) return { success: true, count: 0 }

  const { data, error } = await client()
    .from('auto_account_contacts')
    .select('id, akabiz_tag_ids')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .in('id', ids)

  if (error) throw new Error(`Failed to list contacts for akaBiz tags: ${error.message}`)
  const count = await applyTagsToRows(data || [], tagIds, u.staffId)
  return { success: true, count }
}

export async function applyAkaBizTagsToContactTargets(
  targets: AkaBizContactTagTarget[],
  tagIds: number[]
): Promise<ContactTagMutationResult> {
  const u = requireCurrentUser()
  const normalizedTargets = targets
    .map(target => ({
      accountId: Number(target.accountId),
      contactType: target.contactType,
      uid: String(target.uid || '').trim()
    }))
    .filter(target => Number.isFinite(target.accountId) && target.accountId > 0 && target.contactType && target.uid)

  if (normalizedTargets.length === 0) return { success: true, count: 0 }

  const rowsById = new Map<number, { id: unknown; akabiz_tag_ids?: unknown }>()
  for (const target of normalizedTargets) {
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('id, akabiz_tag_ids')
      .eq('account_id', target.accountId)
      .eq('staff_id', u.staffId)
      .eq('contact_type', target.contactType)
      .eq('uid', target.uid)
      .eq('is_delete', false)

    if (error) throw new Error(`Failed to find contacts for akaBiz tags: ${error.message}`)
    for (const row of data || []) rowsById.set(Number(row.id), row)
  }

  const count = await applyTagsToRows(Array.from(rowsById.values()), tagIds, u.staffId)
  return { success: true, count }
}
