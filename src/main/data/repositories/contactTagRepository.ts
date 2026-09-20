import { AkaBizContactTag, ContactType } from '../../../shared/types'
import { mapAkaBizContactTagFromDB } from '../mappers'
import { getCurrentUserCredentials, requireCurrentUser } from '../currentUser'
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
const CONTACT_TAG_QUERY_CHUNK_SIZE = 100
const CONTACT_TAG_CLEANUP_PAGE_SIZE = 1000
const CONTACT_TAG_WRITE_CHUNK_SIZE = 100

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
  let lastId = 0
  while (true) {
    let query = client()
      .from('auto_account_contacts')
      .select('id')
      .eq('is_delete', false)
      .eq('staff_id', staffId)
      .contains('akabiz_tag_ids', [tagId])
      .order('id', { ascending: true })
      .limit(CONTACT_TAG_CLEANUP_PAGE_SIZE)
    if (lastId > 0) query = query.gt('id', lastId)

    const { data, error } = await query
    if (error) throw new Error(`Failed to list contacts for akaBiz tag cleanup: ${error.message}`)

    const rows = data || []
    if (rows.length === 0) break
    lastId = Number(rows[rows.length - 1].id)
    await mutateContactTags(rows.map(row => Number(row.id)), [tagId], 'remove')
    if (rows.length < CONTACT_TAG_CLEANUP_PAGE_SIZE) break
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

async function mutateContactTags(
  ids: number[],
  tagIds: number[],
  mode: 'add' | 'remove'
): Promise<number> {
  const contactIds = normalizeTagIds(ids)
  const tags = normalizeTagIds(tagIds)
  if (tags.length === 0 || contactIds.length === 0) return 0
  const user = requireCurrentUser()
  // Service-role Server callers have no Desktop login credentials.
  const credentials = getCurrentUserCredentials()
  let count = 0
  for (let from = 0; from < contactIds.length; from += CONTACT_TAG_WRITE_CHUNK_SIZE) {
    const params = {
      p_staff_id: user.staffId,
      p_organization_id: user.organizationId,
      p_contact_ids: contactIds.slice(from, from + CONTACT_TAG_WRITE_CHUNK_SIZE),
      p_tag_ids: tags,
      p_auth_username: credentials?.username ?? null,
      p_auth_password: credentials?.password ?? null,
      p_mode: mode
    }
    // Retry only transactions PostgreSQL has already rolled back in full.
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await client().rpc('aka_agent_mutate_contact_tags', params)
      if (error && ['40P01', '40001'].includes(error.code) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
        continue
      }
      if (error) throw new Error(`Failed to update akaBiz contact tags: ${error.message}`)
      count += Number(data?.count) || 0
      break
    }
  }
  return count
}

export async function applyAkaBizTagsToContactIds(
  contactIds: number[],
  tagIds: number[]
): Promise<ContactTagMutationResult> {
  const u = requireCurrentUser()
  const ids = normalizeTagIds(contactIds)
  if (ids.length === 0) return { success: true, count: 0 }

  const rowsById = new Map<number, { id: unknown }>()
  for (let from = 0; from < ids.length; from += CONTACT_TAG_QUERY_CHUNK_SIZE) {
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('id')
      .eq('staff_id', u.staffId)
      .eq('is_delete', false)
      .in('id', ids.slice(from, from + CONTACT_TAG_QUERY_CHUNK_SIZE))

    if (error) throw new Error(`Failed to list contacts for akaBiz tags: ${error.message}`)
    for (const row of data || []) rowsById.set(Number(row.id), row)
  }

  const count = await mutateContactTags(Array.from(rowsById.keys()), tagIds, 'add')
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

  const targetsByScope = new Map<string, {
    accountId: number
    contactType: ContactType
    uids: Set<string>
  }>()
  for (const target of normalizedTargets) {
    const key = `${target.accountId}:${target.contactType}`
    const scope = targetsByScope.get(key) || {
      accountId: target.accountId,
      contactType: target.contactType,
      uids: new Set<string>()
    }
    scope.uids.add(target.uid)
    targetsByScope.set(key, scope)
  }

  const rowsById = new Map<number, { id: unknown }>()
  for (const scope of targetsByScope.values()) {
    const uids = Array.from(scope.uids)
    for (let from = 0; from < uids.length; from += CONTACT_TAG_QUERY_CHUNK_SIZE) {
      const { data, error } = await client()
        .from('auto_account_contacts')
        .select('id')
        .eq('account_id', scope.accountId)
        .eq('staff_id', u.staffId)
        .eq('contact_type', scope.contactType)
        .in('uid', uids.slice(from, from + CONTACT_TAG_QUERY_CHUNK_SIZE))
        .eq('is_delete', false)

      if (error) throw new Error(`Failed to find contacts for akaBiz tags: ${error.message}`)
      for (const row of data || []) rowsById.set(Number(row.id), row)
    }
  }

  const count = await mutateContactTags(Array.from(rowsById.keys()), tagIds, 'add')
  return { success: true, count }
}
