import { AccountContactListQuery, AutoAccountContact, AutoAccountContactGroup, ContactGroupMutationResult, ContactGroupPurpose, ContactListResult, ContactType, ZaloGroupMemberContactListQuery, ZaloLabelOption } from '../../../shared/types'
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

export interface ZaloUserContactInput {
  accountId: number
  zaloUid: string
  contactSource?: string | null
  contactExtraData?: Record<string, unknown>
  userId?: string | null
  username?: string | null
  displayName?: string | null
  zaloName?: string | null
  avatar?: string | null
  bgavatar?: string | null
  cover?: string | null
  gender?: number | null
  dob?: number | null
  sdob?: string | null
  status?: string | null
  phoneNumber?: string | null
  isFr?: number | null
  isBlocked?: number | null
  lastActionTime?: number | null
  lastUpdateTime?: number | null
  isActive?: number | null
  key?: number | null
  type?: number | null
  isActivePC?: number | null
  isActiveWeb?: number | null
  isValid?: number | null
  userKey?: string | null
  accountStatus?: number | null
  oaInfo?: unknown
  userMode?: number | null
  globalId?: string | null
  bizPkg?: unknown
  createdTs?: number | null
  oaStatus?: unknown
  rawPayload?: Record<string, unknown>
}

export interface ZaloGroupContactInput {
  accountId: number
  zaloGroupId: string
  isJoined?: boolean
  name?: string | null
  description?: string | null
  link?: string | null
  groupType?: number | null
  creatorUid?: string | null
  version?: string | null
  avatar?: string | null
  fullAvatar?: string | null
  memberIds?: string[]
  adminIds?: string[]
  currentMems?: unknown
  updateMems?: unknown
  admins?: unknown
  hasMoreMember?: number | null
  subType?: number | null
  totalMember?: number | null
  maxMember?: number | null
  setting?: unknown
  createdTime?: number | null
  visibility?: number | null
  globalId?: string | null
  e2ee?: number | null
  status?: number | null
  extraInfo?: unknown
  memVerList?: string[]
  pendingApprove?: unknown
  rawPayload?: Record<string, unknown>
}

export interface ZaloGroupMemberContactInput {
  zaloGroupId: string
  zaloUid: string
  displayName?: string | null
  zaloName?: string | null
  avatar?: string | null
  accountStatus?: number | null
  type?: number | null
  lastUpdateTime?: number | null
  globalId?: string | null
  role: 'owner' | 'admin' | 'member'
  roleRank: 1 | 2 | 3
  isCreator: boolean
  isAdmin: boolean
  rawPayload?: Record<string, unknown>
}

export interface ZaloGroupMemberUpsertInput {
  accountId: number
  zaloGroupId: string
  group?: ZaloGroupContactInput | null
  members: ZaloGroupMemberContactInput[]
}

const client = () => getSupabaseClient()
const GROUP_ACTIVITY_RE = /\s*(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i
const CONTACT_GROUP_PURPOSE_DATA: ContactGroupPurpose = 'data_group'
const CONTACT_GROUP_PURPOSE_ZALO_FRIEND_BLOCKLIST: ContactGroupPurpose = 'zalo_friend_blocklist'

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

function normalizeContactUrl(uid: string, url: string | undefined, contactType: ContactType, platform?: string): string | null {
  const rawUrl = String(url || '').trim()
  if (rawUrl) return rawUrl
  if (!uid) return null
  if (platform === 'zalo') return null
  if (contactType === 'zalo_tag') return null
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
  const extraData = toRecord(contact.extraData)
  const platform = String(extraData.platform || '').trim()

  if (contactType === 'group') {
    const activityMatch = name.match(/(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i)
    lastActivityText = activityMatch ? activityMatch[0].trim() : ''
    name = name.replace(GROUP_ACTIVITY_RE, '').trim()
  }

  return {
    ...contact,
    uid,
    name,
    url: normalizeContactUrl(uid, contact.url, contactType, platform) || undefined,
    extraData: lastActivityText
      ? { ...extraData, lastActivityText }
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

function toSourcePostRefs(value: unknown): Array<{ source: string; url: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      const ref = toRecord(item)
      return {
        source: String(ref.source || '').trim(),
        url: String(ref.url || ref.sourcePostUrl || '').trim()
      }
    })
    .filter(ref => !!ref.source && !!ref.url)
}

function collectIncomingSourcePostRefs(extra: Record<string, unknown>): Array<{ source: string; url: string }> {
  const source = String(extra.source || '').trim()
  if (!source) return []
  const urls = [
    extra.sourcePostUrl,
    ...toStringArray(extra.sourcePostUrls)
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)

  return Array.from(new Set(urls)).map(url => ({ source, url }))
}

function mergeSourcePostRefs(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): Array<{ source: string; url: string }> {
  const byKey = new Map<string, { source: string; url: string }>()
  for (const ref of [
    ...toSourcePostRefs(existing.sourcePostRefs),
    ...collectIncomingSourcePostRefs(existing),
    ...toSourcePostRefs(next.sourcePostRefs),
    ...collectIncomingSourcePostRefs(next)
  ]) {
    byKey.set(`${ref.source}\u0000${ref.url}`, ref)
  }
  return Array.from(byKey.values())
}

function normalizeNullableString(value: unknown): string | null {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstNullableNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = normalizeNullableNumber(value)
    if (parsed !== null) return parsed
  }
  return null
}

function normalizeJsonValue(value: unknown): unknown {
  return value === undefined ? null : value
}

function firstNullableString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = normalizeNullableString(value)
    if (parsed) return parsed
  }
  return null
}

function isNonEmptyRecord(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && value.trim() === '') continue
    compacted[key] = value
  }
  return compacted
}

function hasKnownZaloFriendStatus(contact: ZaloUserContactInput): boolean {
  return contact.isFr !== undefined && contact.isFr !== null && normalizeNullableNumber(contact.isFr) !== null
}

function getZaloFriendStatus(contact: ZaloUserContactInput): boolean | undefined {
  const isFr = normalizeNullableNumber(contact.isFr)
  return isFr === null ? undefined : isFr === 1
}

function zaloMetaKey(accountId: unknown, uid: unknown): string {
  return `${String(accountId)}:${String(uid || '').trim()}`
}

function dedupeZaloUserContacts(contacts: ZaloUserContactInput[]): ZaloUserContactInput[] {
  const byKey = new Map<string, ZaloUserContactInput>()
  for (const contact of contacts) {
    const accountId = Number(contact.accountId)
    const zaloUid = String(contact.zaloUid || '').trim()
    if (!Number.isFinite(accountId) || accountId <= 0 || !zaloUid) continue
    byKey.set(zaloMetaKey(accountId, zaloUid), {
      ...contact,
      accountId,
      zaloUid
    })
  }
  return Array.from(byKey.values())
}

function dedupeZaloGroupContacts(groups: ZaloGroupContactInput[]): ZaloGroupContactInput[] {
  const byKey = new Map<string, ZaloGroupContactInput>()
  for (const group of groups) {
    const accountId = Number(group.accountId)
    const zaloGroupId = String(group.zaloGroupId || '').trim()
    if (!Number.isFinite(accountId) || accountId <= 0 || !zaloGroupId) continue
    byKey.set(zaloMetaKey(accountId, zaloGroupId), {
      ...group,
      accountId,
      zaloGroupId
    })
  }
  return Array.from(byKey.values())
}

function mergeContactExtraData(
  existingExtraData: unknown,
  nextExtraData: unknown
): Record<string, unknown> {
  const existing = toRecord(existingExtraData)
  const next = toRecord(nextExtraData)
  const merged: Record<string, unknown> = { ...existing, ...next }
  const sources = [
    ...toStringArray(existing.sources),
    existing.source,
    ...toStringArray(next.sources),
    next.source
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)

  if (sources.length > 0) {
    merged.sources = Array.from(new Set(sources))
  }

  const sourcePostRefs = mergeSourcePostRefs(existing, next)
  if (sourcePostRefs.length > 0) {
    merged.sourcePostRefs = sourcePostRefs
  }

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

  const sourceProfileUrls = [
    ...toStringArray(existing.sourceProfileUrls),
    existing.sourceProfileUrl,
    ...toStringArray(next.sourceProfileUrls),
    next.sourceProfileUrl
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)

  if (sourceProfileUrls.length > 0) {
    merged.sourceProfileUrls = Array.from(new Set(sourceProfileUrls))
  }

  const sourceGroupUrls = [
    ...toStringArray(existing.sourceGroupUrls),
    existing.sourceGroupUrl,
    ...toStringArray(next.sourceGroupUrls),
    next.sourceGroupUrl
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)

  if (sourceGroupUrls.length > 0) {
    merged.sourceGroupUrls = Array.from(new Set(sourceGroupUrls))
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
  const contacts = (data || []).map(row => mapAccountContactFromDB(row))
  return contactType === 'group' || !contactType
    ? enrichZaloGroupContactCounts(contacts, accountId, u.staffId)
    : contacts
}

const CONTACT_LIST_DEFAULT_LIMIT = 100
const CONTACT_LIST_MAX_LIMIT = 20000
const CONTACT_LIST_FETCH_CHUNK = 1000
const CONTACT_LIST_MUTATION_CHUNK = 500

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function clampContactListLimit(value: unknown, fallback = CONTACT_LIST_DEFAULT_LIMIT): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(CONTACT_LIST_MAX_LIMIT, parsed)
}

function normalizeOptionalContactListLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  return clampContactListLimit(value)
}

function clampContactListOffset(value: unknown): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeContactIdList(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(
    values
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)
  ))
}

function normalizeSearchText(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('vi-VN')
}

function getContactPhoneSearchText(contact: AutoAccountContact): string {
  const extra = toRecord(contact.extraData)
  const rawPayload = toRecord(extra.rawPayload)
  return [
    extra.phone,
    extra.phoneNumber,
    extra.phone_number,
    extra.mobilePhone,
    extra.mobile_phone,
    rawPayload.phone,
    rawPayload.phoneNumber,
    rawPayload.phone_number,
    rawPayload.mobilePhone,
    rawPayload.mobile_phone
  ].filter(Boolean).join(' ')
}

function normalizeFacebookPostUrlForCompare(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = url.hostname.replace(/^www\./i, '').replace(/^web\./i, '').replace(/^m\./i, '').toLowerCase()
    if (host !== 'facebook.com' && host !== 'fb.com') return ''
    url.hostname = 'www.facebook.com'
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        key.startsWith('__') ||
        key === 'mibextid' ||
        key === 'ref' ||
        key === 'locale' ||
        key === 'comment_id' ||
        key === 'reply_comment_id'
      ) {
        url.searchParams.delete(key)
      }
    }
    return url.toString().replace(/\/+$/g, '').toLowerCase()
  } catch {
    return raw.replace(/\/+$/g, '').toLowerCase()
  }
}

function contactMatchesSourcePostUrl(contact: AutoAccountContact, normalizedPostUrl: string): boolean {
  if (!normalizedPostUrl) return true
  const extra = toRecord(contact.extraData)
  if (normalizeFacebookPostUrlForCompare(extra.sourcePostUrl) === normalizedPostUrl) return true
  return toStringArray(extra.sourcePostUrls).some(value => normalizeFacebookPostUrlForCompare(value) === normalizedPostUrl)
}

function contactMatchesSource(contact: AutoAccountContact, source: string): boolean {
  if (!source) return true
  const extra = toRecord(contact.extraData)
  if (String(extra.source || '').trim() === source) return true
  return toStringArray(extra.sources).some(value => String(value || '').trim() === source)
}

function contactMatchesSourcePostPair(contact: AutoAccountContact, source: string, normalizedPostUrl: string): boolean {
  if (!source || !normalizedPostUrl) {
    return contactMatchesSource(contact, source) && contactMatchesSourcePostUrl(contact, normalizedPostUrl)
  }

  const extra = toRecord(contact.extraData)
  const refs = toSourcePostRefs(extra.sourcePostRefs)
  if (refs.length > 0) {
    return refs.some(ref => (
      ref.source === source &&
      normalizeFacebookPostUrlForCompare(ref.url) === normalizedPostUrl
    ))
  }

  return contactMatchesSource(contact, source) && contactMatchesSourcePostUrl(contact, normalizedPostUrl)
}

function normalizeFacebookProfileUrlForCompare(value: unknown): string {
  const raw = String(value || '').trim().replace(/^@+/, '')
  if (!raw) return ''
  if (!/facebook\.com|fb\.com/i.test(raw)) {
    return /^[a-zA-Z0-9._-]+$/.test(raw)
      ? `https://www.facebook.com/${raw}`.toLowerCase()
      : ''
  }
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = url.hostname
      .replace(/^www\./i, '')
      .replace(/^web\./i, '')
      .replace(/^m\./i, '')
      .replace(/^mobile\./i, '')
      .replace(/^mbasic\./i, '')
      .toLowerCase()
    if (host !== 'facebook.com' && host !== 'fb.com') return ''
    if (url.pathname === '/profile.php') {
      const id = String(url.searchParams.get('id') || '').trim()
      return id ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}`.toLowerCase() : ''
    }
    const parts = url.pathname.split('/').filter(Boolean)
    while (parts.length > 0 && parts[parts.length - 1].toLowerCase() === 'friends') {
      parts.pop()
    }
    if (parts.length !== 1) return ''
    const slug = decodeURIComponent(parts[0] || '').trim()
    return slug && /^[a-zA-Z0-9._-]+$/.test(slug)
      ? `https://www.facebook.com/${slug}`.toLowerCase()
      : ''
  } catch {
    return raw.replace(/\/+$/g, '').toLowerCase()
  }
}

function contactMatchesSourceProfileUrl(contact: AutoAccountContact, normalizedProfileUrl: string): boolean {
  if (!normalizedProfileUrl) return true
  const extra = toRecord(contact.extraData)
  if (normalizeFacebookProfileUrlForCompare(extra.sourceProfileUrl) === normalizedProfileUrl) return true
  return toStringArray(extra.sourceProfileUrls).some(value => normalizeFacebookProfileUrlForCompare(value) === normalizedProfileUrl)
}

function normalizeFacebookGroupUrlForCompare(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!/facebook\.com|fb\.com/i.test(raw)) {
    const cleaned = raw.replace(/^\/+|\/+$/g, '')
    const parts = cleaned.split('/').filter(Boolean)
    const groupKey = parts[0]?.toLowerCase() === 'groups' && parts[1] ? parts[1] : cleaned
    return /^[a-zA-Z0-9._-]+$/.test(groupKey || '')
      ? `https://www.facebook.com/groups/${groupKey}`.toLowerCase()
      : ''
  }
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = url.hostname
      .replace(/^www\./i, '')
      .replace(/^web\./i, '')
      .replace(/^m\./i, '')
      .replace(/^mobile\./i, '')
      .replace(/^mbasic\./i, '')
      .toLowerCase()
    if (host !== 'facebook.com' && host !== 'fb.com') return ''
    const parts = url.pathname.split('/').filter(Boolean)
    const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups')
    if (groupIndex < 0 || !parts[groupIndex + 1]) return ''
    const groupKey = decodeURIComponent(parts[groupIndex + 1] || '').trim()
    return groupKey && /^[a-zA-Z0-9._-]+$/.test(groupKey)
      ? `https://www.facebook.com/groups/${groupKey}`.toLowerCase()
      : ''
  } catch {
    return raw.replace(/\/+$/g, '').toLowerCase()
  }
}

function contactMatchesSourceGroupUrl(contact: AutoAccountContact, normalizedGroupUrl: string): boolean {
  if (!normalizedGroupUrl) return true
  const extra = toRecord(contact.extraData)
  if (normalizeFacebookGroupUrlForCompare(extra.sourceGroupUrl) === normalizedGroupUrl) return true
  return toStringArray(extra.sourceGroupUrls).some(value => normalizeFacebookGroupUrlForCompare(value) === normalizedGroupUrl)
}

function contactMatchesStatusFilter(contact: AutoAccountContact, statusFilter: AccountContactListQuery['statusFilter']): boolean {
  if (!statusFilter || statusFilter === 'all') return true
  if (contact.contactType === 'person') {
    return statusFilter === 'active' ? contact.isFriend === true : contact.isFriend !== true
  }
  if (contact.contactType === 'group') {
    return statusFilter === 'active' ? contact.isJoined === true : contact.isJoined !== true
  }
  return true
}

function contactMatchesSearch(contact: AutoAccountContact, search: string): boolean {
  if (!search) return true
  const haystack = [
    contact.name,
    contact.uid,
    getContactPhoneSearchText(contact)
  ].join(' ').toLocaleLowerCase('vi-VN')
  return haystack.includes(search)
}

function extractZaloTagIdsFromValue(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap(item => extractZaloTagIdsFromValue(item))
  if (typeof value === 'object') {
    const item = toRecord(value)
    const id = normalizeNullableString(item.id || item.labelId || item.label_id || item.tagId || item.tag_id)
    return id ? [id] : []
  }
  const raw = normalizeNullableString(value)
  return raw ? [raw] : []
}

function getContactZaloTagIds(contact: AutoAccountContact): string[] {
  const extra = toRecord(contact.extraData)
  const rawPayload = toRecord(extra.rawPayload)
  return normalizeZaloTagIdList([
    ...toStringArray(extra.zaloTagIds),
    ...toStringArray(extra.zalo_tag_ids),
    ...toStringArray(extra.labelIds),
    ...toStringArray(extra.label_ids),
    ...toStringArray(extra.tagIds),
    ...toStringArray(extra.tag_ids),
    ...extractZaloTagsFromExtra(extra).map(tag => tag.id),
    ...extractZaloTagIdsFromValue(extra.labels),
    ...extractZaloTagIdsFromValue(extra.tags),
    ...toStringArray(rawPayload.labelIds),
    ...toStringArray(rawPayload.label_ids),
    ...toStringArray(rawPayload.tagIds),
    ...toStringArray(rawPayload.tag_ids),
    ...extractZaloTagsFromExtra(rawPayload).map(tag => tag.id),
    ...extractZaloTagIdsFromValue(rawPayload.labels),
    ...extractZaloTagIdsFromValue(rawPayload.tags)
  ])
}

function contactMatchesZaloTagFilter(contact: AutoAccountContact, tagIds: string[], includeNoTag: boolean): boolean {
  if (tagIds.length === 0 && !includeNoTag) return true
  const contactTagIds = new Set(getContactZaloTagIds(contact))
  if (includeNoTag && contactTagIds.size === 0) return true
  return tagIds.some(tagId => contactTagIds.has(tagId))
}

function contactMatchesAkaBizTagFilter(contact: AutoAccountContact, tagIds: number[], includeNoTag: boolean): boolean {
  if (tagIds.length === 0 && !includeNoTag) return true
  const contactTagIds = new Set(
    (contact.akaBizTagIds || [])
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && id > 0)
  )
  if (includeNoTag && contactTagIds.size === 0) return true
  return tagIds.some(tagId => contactTagIds.has(tagId))
}

function canUseDbPagedContactList(query: AccountContactListQuery): boolean {
  const ids = normalizeContactIdList(query.ids)
  const excludeIds = normalizeContactIdList(query.excludeIds)
  const statusFilter = query.statusFilter || 'all'
  if (ids.length > 0 || excludeIds.length > 0) return false
  if (normalizeSearchText(query.search)) return false
  if (String(query.source || '').trim()) return false
  if (String(query.sourcePostUrl || '').trim()) return false
  if (String(query.sourceProfileUrl || '').trim()) return false
  if (String(query.sourceGroupUrl || '').trim()) return false
  if (normalizeZaloTagIdList(query.zaloTagIds).length > 0) return false
  if (query.zaloNoTag) return false
  if (normalizeContactIdList(query.akaBizTagIds).length > 0) return false
  if (query.akaBizNoTag) return false
  if (statusFilter !== 'all' && !query.contactType) return false
  return true
}

function applyDbContactStatusFilter(dbQuery: any, contactType: ContactType | undefined, statusFilter: AccountContactListQuery['statusFilter']): any {
  if (!statusFilter || statusFilter === 'all') return dbQuery
  if (contactType === 'person') {
    return statusFilter === 'active'
      ? dbQuery.eq('is_friend', true)
      : dbQuery.or('is_friend.is.null,is_friend.eq.false')
  }
  if (contactType === 'group') {
    return statusFilter === 'active'
      ? dbQuery.eq('is_joined', true)
      : dbQuery.or('is_joined.is.null,is_joined.eq.false')
  }
  return dbQuery
}

async function listContactsPageFromDb(
  accountId: number,
  staffId: number,
  query: AccountContactListQuery,
  offset: number,
  limit: number
): Promise<ContactListResult> {
  let dbQuery: any = client()
    .from('auto_account_contacts')
    .select('*', { count: 'exact' })
    .eq('account_id', accountId)
    .eq('staff_id', staffId)
    .eq('is_delete', false)

  if (query.contactType) dbQuery = dbQuery.eq('contact_type', query.contactType)
  dbQuery = applyDbContactStatusFilter(dbQuery, query.contactType, query.statusFilter)

  const { data, error, count } = await dbQuery
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(`Failed to list paged contacts: ${error.message}`)
  const contacts = (data || []).map((row: Record<string, unknown>) => mapAccountContactFromDB(row))
  return {
    contacts: await enrichContactListResult(contacts, accountId, staffId, query.contactType),
    total: count ?? 0
  }
}

async function fetchContactRowsForList(
  accountId: number,
  staffId: number,
  contactType?: ContactType,
  ids: number[] = []
): Promise<AutoAccountContact[]> {
  const rows: Record<string, unknown>[] = []
  if (ids.length > 0) {
    const idChunkSize = 1000
    for (let i = 0; i < ids.length; i += idChunkSize) {
      const chunk = ids.slice(i, i + idChunkSize)
      let query = client()
        .from('auto_account_contacts')
        .select('*')
        .eq('account_id', accountId)
        .eq('staff_id', staffId)
        .eq('is_delete', false)
        .in('id', chunk)
        .order('name', { ascending: true })

      if (contactType) query = query.eq('contact_type', contactType)

      const { data, error } = await query
      if (error) throw new Error(`Failed to list selected contacts: ${error.message}`)
      rows.push(...(data || []))
    }
  } else {
    let from = 0
    while (true) {
      let query = client()
        .from('auto_account_contacts')
        .select('*')
        .eq('account_id', accountId)
        .eq('staff_id', staffId)
        .eq('is_delete', false)
        .order('name', { ascending: true })
        .range(from, from + CONTACT_LIST_FETCH_CHUNK - 1)

      if (contactType) query = query.eq('contact_type', contactType)

      const { data, error } = await query
      if (error) throw new Error(`Failed to list paged contacts: ${error.message}`)
      rows.push(...(data || []))
      if (!data || data.length < CONTACT_LIST_FETCH_CHUNK) break
      from += CONTACT_LIST_FETCH_CHUNK
    }
  }

  return rows.map(row => mapAccountContactFromDB(row))
}

async function filterContactsForList(
  accountId: number,
  staffId: number,
  query: AccountContactListQuery = {}
): Promise<AutoAccountContact[]> {
  const ids = normalizeContactIdList(query.ids)
  const excludeIds = new Set(normalizeContactIdList(query.excludeIds))
  const search = normalizeSearchText(query.search)
  const source = String(query.source || '').trim()
  const normalizedPostUrl = normalizeFacebookPostUrlForCompare(query.sourcePostUrl)
  const normalizedProfileUrl = normalizeFacebookProfileUrlForCompare(query.sourceProfileUrl)
  const normalizedGroupUrl = normalizeFacebookGroupUrlForCompare(query.sourceGroupUrl)
  const zaloTagIds = normalizeZaloTagIdList(query.zaloTagIds)
  const akaBizTagIds = normalizeContactIdList(query.akaBizTagIds)
  const includeNoZaloTag = query.zaloNoTag === true
  const includeNoAkaBizTag = query.akaBizNoTag === true
  const contacts = await fetchContactRowsForList(accountId, staffId, query.contactType, ids)

  return contacts.filter(contact => {
    if (excludeIds.has(contact.id)) return false
    if (!contactMatchesStatusFilter(contact, query.statusFilter)) return false
    if (!contactMatchesSourcePostPair(contact, source, normalizedPostUrl)) return false
    if (!contactMatchesSourceProfileUrl(contact, normalizedProfileUrl)) return false
    if (!contactMatchesSourceGroupUrl(contact, normalizedGroupUrl)) return false
    if (!contactMatchesSearch(contact, search)) return false
    if (!contactMatchesZaloTagFilter(contact, zaloTagIds, includeNoZaloTag)) return false
    if (!contactMatchesAkaBizTagFilter(contact, akaBizTagIds, includeNoAkaBizTag)) return false
    return true
  })
}

async function enrichContactListResult(
  contacts: AutoAccountContact[],
  accountId: number,
  staffId: number,
  contactType?: ContactType
): Promise<AutoAccountContact[]> {
  return contactType === 'group' || !contactType
    ? enrichZaloGroupContactCounts(contacts, accountId, staffId)
    : contacts
}

export async function listContactsPage(
  accountId: number,
  query: AccountContactListQuery = {}
): Promise<ContactListResult> {
  const u = requireCurrentUser()
  const offset = clampContactListOffset(query.offset)
  const limit = clampContactListLimit(query.limit)
  if (canUseDbPagedContactList(query)) {
    return listContactsPageFromDb(accountId, u.staffId, query, offset, limit)
  }

  const filtered = await filterContactsForList(accountId, u.staffId, query)
  const contacts = filtered.slice(offset, offset + limit)
  return {
    contacts: await enrichContactListResult(contacts, accountId, u.staffId, query.contactType),
    total: filtered.length
  }
}

export async function exportContactsPage(
  accountId: number,
  query: AccountContactListQuery = {}
): Promise<AutoAccountContact[]> {
  const u = requireCurrentUser()
  const offset = clampContactListOffset(query.offset)
  const limit = normalizeOptionalContactListLimit(query.limit)
  if (limit !== null && canUseDbPagedContactList(query)) {
    const result = await listContactsPageFromDb(accountId, u.staffId, query, offset, limit)
    return result.contacts
  }

  const filtered = await filterContactsForList(accountId, u.staffId, query)
  const contacts = limit === null ? filtered : filtered.slice(offset, offset + limit)
  return enrichContactListResult(contacts, accountId, u.staffId, query.contactType)
}

function normalizeZaloTagIdList(values: unknown): string[] {
  return Array.from(new Set(
    toStringArray(values).filter(Boolean)
  ))
}

function normalizeZaloTagNameList(values: unknown): string[] {
  return Array.from(new Set(
    toStringArray(values).filter(Boolean)
  ))
}

function extractZaloTagsFromExtra(extra: Record<string, unknown>): Array<{ id: string; name: string }> {
  const tags: Array<{ id: string; name: string }> = []
  const rawTags = Array.isArray(extra.zaloTags)
    ? extra.zaloTags
    : Array.isArray(extra.zalo_tags)
      ? extra.zalo_tags
      : []
  for (const rawTag of rawTags) {
    const tag = toRecord(rawTag)
    const id = normalizeNullableString(tag.id || tag.labelId || tag.label_id || tag.tagId || tag.tag_id)
    const name = normalizeNullableString(tag.name || tag.text || tag.labelName || tag.label_name || tag.tagName || tag.tag_name)
    if (id) tags.push({ id, name: name || '' })
  }
  return tags
}

export async function appendZaloTagsToExistingContacts(
  accountId: number,
  contactType: ContactType,
  uids: string[],
  tags: Array<{ id: number | string; name?: string | null }>
): Promise<number> {
  const u = requireCurrentUser()
  const normalizedAccountId = Number(accountId)
  if (!Number.isFinite(normalizedAccountId) || normalizedAccountId <= 0) return 0
  if (contactType !== 'person' && contactType !== 'group') return 0

  const normalizedUids = Array.from(new Set(
    uids.map(uid => String(uid || '').trim()).filter(Boolean)
  ))
  const normalizedTags = tags
    .map(tag => ({
      id: String(tag.id || '').trim(),
      name: String(tag.name || '').trim()
    }))
    .filter(tag => tag.id)

  if (normalizedUids.length === 0 || normalizedTags.length === 0) return 0

  let updatedCount = 0
  const chunkSize = 100
  const now = new Date().toISOString()

  for (let i = 0; i < normalizedUids.length; i += chunkSize) {
    const chunk = normalizedUids.slice(i, i + chunkSize)
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('id, extra_data')
      .eq('account_id', normalizedAccountId)
      .eq('staff_id', u.staffId)
      .eq('contact_type', contactType)
      .eq('is_delete', false)
      .in('uid', chunk)

    if (error) throw new Error(`Failed to list contacts for Zalo tag mirror: ${error.message}`)

    for (const row of data || []) {
      const extra = toRecord(row.extra_data)
      const tagById = new Map<string, string>()
      for (const existingTag of extractZaloTagsFromExtra(extra)) {
        tagById.set(existingTag.id, existingTag.name)
      }
      const ids = normalizeZaloTagIdList(extra.zaloTagIds || extra.zalo_tag_ids || extra.labelIds || extra.label_ids)
      const names = normalizeZaloTagNameList(extra.zaloTagNames || extra.zalo_tag_names || extra.labelNames || extra.label_names)
      ids.forEach((id, index) => tagById.set(id, tagById.get(id) || names[index] || ''))
      for (const tag of normalizedTags) {
        tagById.set(tag.id, tag.name || tagById.get(tag.id) || '')
      }

      const nextTags = Array.from(tagById.entries()).map(([id, name]) => ({ id, name }))
      const nextExtra = {
        ...extra,
        zaloTagIds: nextTags.map(tag => tag.id),
        zaloTagNames: nextTags.map(tag => tag.name).filter(Boolean),
        zaloTags: nextTags
      }

      const { error: updateError } = await client()
        .from('auto_account_contacts')
        .update({ extra_data: nextExtra, updated_at: now })
        .eq('id', row.id as number)
        .eq('staff_id', u.staffId)

      if (updateError) throw new Error(`Failed to mirror Zalo tags to contact: ${updateError.message}`)
      updatedCount += 1
    }
  }

  return updatedCount
}

type NormalizedZaloTag = { id: string; name: string }

function normalizeZaloLabelMemberships(labels: ZaloLabelOption[]): Map<string, NormalizedZaloTag[]> {
  const tagsByConversation = new Map<string, Map<string, string>>()

  for (const label of labels) {
    const id = String(label.id || '').trim()
    const name = String(label.text || '').trim()
    if (!id || !name) continue
    const conversations = Array.isArray(label.conversations) ? label.conversations : []
    for (const rawConversation of conversations) {
      const conversation = String(rawConversation || '').trim()
      if (!conversation) continue
      const existing = tagsByConversation.get(conversation) || new Map<string, string>()
      existing.set(id, name)
      tagsByConversation.set(conversation, existing)
    }
  }

  const result = new Map<string, NormalizedZaloTag[]>()
  for (const [conversation, tagMap] of tagsByConversation.entries()) {
    result.set(conversation, Array.from(tagMap.entries()).map(([id, name]) => ({ id, name })))
  }
  return result
}

function getZaloConversationLookupKeys(uid: unknown, contactType: ContactType): string[] {
  const raw = String(uid || '').trim()
  if (!raw) return []
  if (contactType !== 'group') return [raw]

  const withoutPrefix = raw.replace(/^g/i, '')
  return Array.from(new Set([
    raw,
    withoutPrefix,
    withoutPrefix ? `g${withoutPrefix}` : ''
  ].filter(Boolean)))
}

function getZaloTagsForContactUid(
  uid: unknown,
  contactType: ContactType,
  tagsByConversation: Map<string, NormalizedZaloTag[]>
): NormalizedZaloTag[] {
  const tagById = new Map<string, string>()
  for (const key of getZaloConversationLookupKeys(uid, contactType)) {
    for (const tag of tagsByConversation.get(key) || []) {
      tagById.set(tag.id, tag.name || tagById.get(tag.id) || '')
    }
  }
  return Array.from(tagById.entries()).map(([id, name]) => ({ id, name }))
}

function stripZaloTagExtraFields(extra: Record<string, unknown>): Record<string, unknown> {
  const {
    zaloTagIds: _zaloTagIds,
    zalo_tag_ids: _zaloTagIdsSnake,
    zaloTagNames: _zaloTagNames,
    zalo_tag_names: _zaloTagNamesSnake,
    zaloTags: _zaloTags,
    zalo_tags: _zaloTagsSnake,
    labelIds: _labelIds,
    label_ids: _labelIdsSnake,
    labelNames: _labelNames,
    label_names: _labelNamesSnake,
    labels: _labels,
    tagIds: _tagIds,
    tag_ids: _tagIdsSnake,
    tagNames: _tagNames,
    tag_names: _tagNamesSnake,
    ...rest
  } = extra
  return rest
}

function applyZaloTagsToExtra(
  extraData: unknown,
  tags: NormalizedZaloTag[]
): Record<string, unknown> {
  const stripped = stripZaloTagExtraFields(toRecord(extraData))
  if (tags.length === 0) return stripped
  return {
    ...stripped,
    zaloTagIds: tags.map(tag => tag.id),
    zaloTagNames: tags.map(tag => tag.name).filter(Boolean),
    zaloTags: tags
  }
}

function getZaloTagExtraSignature(extraData: unknown): string {
  const extra = toRecord(extraData)
  const tags = extractZaloTagsFromExtra(extra)
  const tagById = new Map<string, string>()
  for (const tag of tags) tagById.set(tag.id, tag.name)

  const ids = normalizeZaloTagIdList(extra.zaloTagIds || extra.zalo_tag_ids || extra.labelIds || extra.label_ids || extra.tagIds || extra.tag_ids)
  const names = normalizeZaloTagNameList(extra.zaloTagNames || extra.zalo_tag_names || extra.labelNames || extra.label_names || extra.tagNames || extra.tag_names)
  ids.forEach((id, index) => tagById.set(id, tagById.get(id) || names[index] || ''))

  return Array.from(tagById.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, name]) => `${id}:${name}`)
    .join('|')
}

function getNormalizedZaloTagSignature(tags: NormalizedZaloTag[]): string {
  return [...tags]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(tag => `${tag.id}:${tag.name}`)
    .join('|')
}

export async function syncZaloLabelMemberships(
  accountId: number,
  labels: ZaloLabelOption[]
): Promise<number> {
  const u = requireCurrentUser()
  const normalizedAccountId = Number(accountId)
  if (!Number.isFinite(normalizedAccountId) || normalizedAccountId <= 0) return 0

  const tagsByConversation = normalizeZaloLabelMemberships(labels)
  const contactTypes: ContactType[] = ['person', 'group']
  let updatedCount = 0
  const now = new Date().toISOString()

  for (const contactType of contactTypes) {
    let from = 0
    while (true) {
      const { data, error } = await client()
        .from('auto_account_contacts')
        .select('id, uid, extra_data')
        .eq('account_id', normalizedAccountId)
        .eq('staff_id', u.staffId)
        .eq('contact_type', contactType)
        .eq('is_delete', false)
        .order('id', { ascending: true })
        .range(from, from + CONTACT_LIST_FETCH_CHUNK - 1)

      if (error) throw new Error(`Failed to list contacts for Zalo label sync: ${error.message}`)
      const rows = data || []
      for (const row of rows) {
        const tags = getZaloTagsForContactUid(row.uid, contactType, tagsByConversation)
        if (getZaloTagExtraSignature(row.extra_data) === getNormalizedZaloTagSignature(tags)) continue

        const { error: updateError } = await client()
          .from('auto_account_contacts')
          .update({
            extra_data: applyZaloTagsToExtra(row.extra_data, tags),
            updated_at: now
          })
          .eq('id', row.id as number)
          .eq('staff_id', u.staffId)

        if (updateError) throw new Error(`Failed to sync Zalo labels to contact: ${updateError.message}`)
        updatedCount += 1
      }

      if (rows.length < CONTACT_LIST_FETCH_CHUNK) break
      from += CONTACT_LIST_FETCH_CHUNK
    }
  }

  return updatedCount
}

async function enrichZaloGroupContactCounts(
  contacts: AutoAccountContact[],
  accountId: number,
  staffId: number
): Promise<AutoAccountContact[]> {
  const zaloGroupUids = Array.from(new Set(
    contacts
      .filter(contact => contact.contactType === 'group' && contact.extraData?.platform === 'zalo')
      .map(contact => String(contact.uid || '').trim())
      .filter(Boolean)
  ))
  if (zaloGroupUids.length === 0) return contacts

  const groupMetaByGroupId = new Map<string, { totalMember: number | null; groupType: number | null }>()
  const chunkSize = 100
  for (let i = 0; i < zaloGroupUids.length; i += chunkSize) {
    const chunk = zaloGroupUids.slice(i, i + chunkSize)
    const { data, error } = await client()
      .from('zalo_groups')
      .select('zalo_group_id, total_member, group_type')
      .eq('account_id', accountId)
      .eq('staff_id', staffId)
      .in('zalo_group_id', chunk)

    if (error) throw new Error(`Failed to enrich Zalo group contacts: ${error.message}`)
    for (const row of data || []) {
      groupMetaByGroupId.set(
        String(row.zalo_group_id || '').trim(),
        {
          totalMember: normalizeNullableNumber(row.total_member),
          groupType: normalizeNullableNumber(row.group_type)
        }
      )
    }
  }

  return contacts.map(contact => {
    const groupMeta = groupMetaByGroupId.get(String(contact.uid || '').trim())
    if (groupMeta === undefined) return contact
    return {
      ...contact,
      extraData: {
        ...(contact.extraData || {}),
        totalMember: groupMeta.totalMember,
        groupType: groupMeta.groupType
      }
    }
  })
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
        payload.is_friend = Object.prototype.hasOwnProperty.call(c, 'isFriend')
          ? c.isFriend ?? null
          : true
      } else if (c.isJoined !== undefined) {
        payload.is_joined = c.isJoined
      }
      if (c.isFriend !== undefined) {
        payload.is_friend = c.isFriend
      }
      if (c.requiresPostApproval !== undefined) {
        payload.requires_post_approval = c.requiresPostApproval
      }
      if (c.zaloUserId !== undefined) {
        payload.zalo_user_id = c.zaloUserId
      }
      if (c.zaloGroupId !== undefined) {
        payload.zalo_group_id = c.zaloGroupId
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

export async function upsertZaloUserContacts(
  contacts: ZaloUserContactInput[],
  options: UpsertContactsOptions = {}
): Promise<number> {
  const u = requireCurrentUser()
  const normalized = dedupeZaloUserContacts(contacts)
  if (normalized.length === 0) return 0

  const now = new Date().toISOString()
  const metaByKey = new Map<string, { id: number }>()
  const chunkSize = 100

  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize)
    const payloads = chunk.map(contact => ({
      account_id: contact.accountId,
      zalo_uid: contact.zaloUid,
      user_id: normalizeNullableString(contact.userId),
      username: normalizeNullableString(contact.username),
      display_name: normalizeNullableString(contact.displayName),
      zalo_name: normalizeNullableString(contact.zaloName),
      avatar: normalizeNullableString(contact.avatar),
      bgavatar: normalizeNullableString(contact.bgavatar),
      cover: normalizeNullableString(contact.cover),
      gender: normalizeNullableNumber(contact.gender),
      dob: normalizeNullableNumber(contact.dob),
      sdob: normalizeNullableString(contact.sdob),
      status: normalizeNullableString(contact.status),
      phone_number: normalizeNullableString(contact.phoneNumber),
      is_fr: normalizeNullableNumber(contact.isFr),
      is_blocked: normalizeNullableNumber(contact.isBlocked),
      last_action_time: normalizeNullableNumber(contact.lastActionTime),
      last_update_time: normalizeNullableNumber(contact.lastUpdateTime),
      is_active: normalizeNullableNumber(contact.isActive),
      key: normalizeNullableNumber(contact.key),
      type: normalizeNullableNumber(contact.type),
      is_active_pc: normalizeNullableNumber(contact.isActivePC),
      is_active_web: normalizeNullableNumber(contact.isActiveWeb),
      is_valid: normalizeNullableNumber(contact.isValid),
      user_key: normalizeNullableString(contact.userKey),
      account_status: normalizeNullableNumber(contact.accountStatus),
      oa_info: normalizeJsonValue(contact.oaInfo),
      user_mode: normalizeNullableNumber(contact.userMode),
      global_id: normalizeNullableString(contact.globalId),
      biz_pkg: normalizeJsonValue(contact.bizPkg),
      created_ts: normalizeNullableNumber(contact.createdTs),
      oa_status: normalizeJsonValue(contact.oaStatus),
      raw_payload: contact.rawPayload || {},
      last_seen_at: now,
      staff_id: u.staffId,
      organization_id: u.organizationId,
      updated_at: now
    }))

    const { data, error } = await client()
      .from('zalo_users')
      .upsert(payloads, { onConflict: 'account_id,zalo_uid' })
      .select('id, account_id, zalo_uid')

    if (error) throw new Error(`Failed to upsert Zalo users: ${error.message}`)

    for (const row of data || []) {
      metaByKey.set(zaloMetaKey(row.account_id, row.zalo_uid), { id: row.id as number })
    }
  }

  const accountContacts = normalized
    .map<Partial<AutoAccountContact> | null>(contact => {
      const meta = metaByKey.get(zaloMetaKey(contact.accountId, contact.zaloUid))
      if (!meta) return null
      return {
        accountId: contact.accountId,
        contactType: 'person' as ContactType,
        uid: contact.zaloUid,
        name: normalizeNullableString(contact.displayName)
          || normalizeNullableString(contact.zaloName)
          || normalizeNullableString(contact.username)
          || contact.zaloUid,
        extraData: {
          platform: 'zalo',
          source: 'zalo_get_all_friends',
          avatarUrl: normalizeNullableString(contact.avatar),
          bgavatar: normalizeNullableString(contact.bgavatar),
          cover: normalizeNullableString(contact.cover)
        },
        isFriend: true,
        zaloUserId: meta.id
      }
    })
    .filter((contact): contact is Partial<AutoAccountContact> => !!contact)

  return upsertContacts(accountContacts, options)
}

function buildZaloUserPayload(
  contact: ZaloUserContactInput,
  existing: Record<string, unknown>,
  staffId: number,
  organizationId: number,
  now: string
): Record<string, unknown> {
  const rawPayload = isNonEmptyRecord(contact.rawPayload)
    ? { ...toRecord(existing.raw_payload), ...(contact.rawPayload || {}) }
    : toRecord(existing.raw_payload)
  const isFr = contact.isFr !== undefined
    ? normalizeNullableNumber(contact.isFr)
    : normalizeNullableNumber(existing.is_fr)

  return {
    account_id: contact.accountId,
    zalo_uid: contact.zaloUid,
    user_id: firstNullableString(contact.userId, existing.user_id),
    username: firstNullableString(contact.username, existing.username),
    display_name: firstNullableString(contact.displayName, existing.display_name),
    zalo_name: firstNullableString(contact.zaloName, existing.zalo_name),
    avatar: firstNullableString(contact.avatar, existing.avatar),
    bgavatar: firstNullableString(contact.bgavatar, existing.bgavatar),
    cover: firstNullableString(contact.cover, existing.cover),
    gender: firstNullableNumber(contact.gender, existing.gender),
    dob: firstNullableNumber(contact.dob, existing.dob),
    sdob: firstNullableString(contact.sdob, existing.sdob),
    status: firstNullableString(contact.status, existing.status),
    phone_number: firstNullableString(contact.phoneNumber, existing.phone_number),
    is_fr: isFr,
    is_blocked: firstNullableNumber(contact.isBlocked, existing.is_blocked),
    last_action_time: firstNullableNumber(contact.lastActionTime, existing.last_action_time),
    last_update_time: firstNullableNumber(contact.lastUpdateTime, existing.last_update_time),
    is_active: firstNullableNumber(contact.isActive, existing.is_active),
    key: firstNullableNumber(contact.key, existing.key),
    type: firstNullableNumber(contact.type, existing.type),
    is_active_pc: firstNullableNumber(contact.isActivePC, existing.is_active_pc),
    is_active_web: firstNullableNumber(contact.isActiveWeb, existing.is_active_web),
    is_valid: firstNullableNumber(contact.isValid, existing.is_valid),
    user_key: firstNullableString(contact.userKey, existing.user_key),
    account_status: firstNullableNumber(contact.accountStatus, existing.account_status),
    oa_info: contact.oaInfo !== undefined ? normalizeJsonValue(contact.oaInfo) : normalizeJsonValue(existing.oa_info),
    user_mode: firstNullableNumber(contact.userMode, existing.user_mode),
    global_id: firstNullableString(contact.globalId, existing.global_id),
    biz_pkg: contact.bizPkg !== undefined ? normalizeJsonValue(contact.bizPkg) : normalizeJsonValue(existing.biz_pkg),
    created_ts: firstNullableNumber(contact.createdTs, existing.created_ts),
    oa_status: contact.oaStatus !== undefined ? normalizeJsonValue(contact.oaStatus) : normalizeJsonValue(existing.oa_status),
    raw_payload: rawPayload,
    last_seen_at: now,
    staff_id: staffId,
    organization_id: organizationId,
    updated_at: now
  }
}

async function getExistingPersonContactRows(
  accountId: number,
  zaloUids: string[],
  staffId: number
): Promise<Map<string, Record<string, unknown>>> {
  const existing = new Map<string, Record<string, unknown>>()
  const chunkSize = 100
  for (let i = 0; i < zaloUids.length; i += chunkSize) {
    const chunk = zaloUids.slice(i, i + chunkSize)
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('*')
      .eq('account_id', accountId)
      .eq('staff_id', staffId)
      .eq('contact_type', 'person')
      .in('uid', chunk)

    if (error) throw new Error(`Failed to list existing Zalo campaign contacts: ${error.message}`)
    for (const row of data || []) {
      existing.set(String(row.uid || '').trim(), row)
    }
  }
  return existing
}

export async function upsertZaloCampaignUserContacts(
  contacts: ZaloUserContactInput[]
): Promise<number> {
  const u = requireCurrentUser()
  const normalized = dedupeZaloUserContacts(contacts)
  if (normalized.length === 0) return 0

  const now = new Date().toISOString()
  const chunkSize = 100
  const metaByKey = new Map<string, { id: number }>()

  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize)
    const accountIds = Array.from(new Set(chunk.map(contact => contact.accountId)))
    const existingByKey = new Map<string, Record<string, unknown>>()
    for (const accountId of accountIds) {
      const accountContacts = chunk.filter(contact => contact.accountId === accountId)
      const existing = await getExistingZaloUsers(
        accountId,
        accountContacts.map(contact => contact.zaloUid),
        u.staffId
      )
      for (const [zaloUid, row] of existing.entries()) {
        existingByKey.set(zaloMetaKey(accountId, zaloUid), row)
      }
    }

    const payloads = chunk.map(contact => buildZaloUserPayload(
      contact,
      existingByKey.get(zaloMetaKey(contact.accountId, contact.zaloUid)) || {},
      u.staffId,
      u.organizationId,
      now
    ))

    const { data, error } = await client()
      .from('zalo_users')
      .upsert(payloads, { onConflict: 'account_id,zalo_uid' })
      .select('id, account_id, zalo_uid')

    if (error) throw new Error(`Failed to upsert Zalo campaign users: ${error.message}`)

    for (const row of data || []) {
      metaByKey.set(zaloMetaKey(row.account_id, row.zalo_uid), { id: row.id as number })
    }
  }

  let totalSaved = 0
  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize)
    const accountIds = Array.from(new Set(chunk.map(contact => contact.accountId)))
    const existingContactByKey = new Map<string, Record<string, unknown>>()
    for (const accountId of accountIds) {
      const accountContacts = chunk.filter(contact => contact.accountId === accountId)
      const existing = await getExistingPersonContactRows(
        accountId,
        accountContacts.map(contact => contact.zaloUid),
        u.staffId
      )
      for (const [zaloUid, row] of existing.entries()) {
        existingContactByKey.set(zaloMetaKey(accountId, zaloUid), row)
      }
    }

    const knownFriendPayloads: Record<string, unknown>[] = []
    const unknownFriendPayloads: Record<string, unknown>[] = []

    for (const contact of chunk) {
      const meta = metaByKey.get(zaloMetaKey(contact.accountId, contact.zaloUid))
      if (!meta) continue
      const existing = existingContactByKey.get(zaloMetaKey(contact.accountId, contact.zaloUid)) || {}
      const source = normalizeNullableString(contact.contactSource)
      const extraData = mergeContactExtraData(
        existing.extra_data,
        compactRecord({
          platform: 'zalo',
          source,
          avatarUrl: contact.avatar,
          bgavatar: contact.bgavatar,
          cover: contact.cover,
          phone: contact.phoneNumber,
          ...(contact.contactExtraData || {})
        })
      )
      const payload: Record<string, unknown> = {
        account_id: contact.accountId,
        contact_type: 'person',
        uid: contact.zaloUid,
        name: firstNullableString(
          contact.displayName,
          contact.zaloName,
          contact.username,
          existing.name,
          contact.zaloUid
        ),
        url: firstNullableString(existing.url),
        extra_data: extraData,
        is_delete: false,
        zalo_user_id: meta.id,
        staff_id: u.staffId,
        organization_id: u.organizationId,
        updated_at: now
      }

      if (hasKnownZaloFriendStatus(contact)) {
        payload.is_friend = getZaloFriendStatus(contact) === true
        knownFriendPayloads.push(payload)
      } else {
        unknownFriendPayloads.push(payload)
      }
    }

    const upsertContactPayloads = async (payloads: Record<string, unknown>[]): Promise<void> => {
      if (payloads.length === 0) return
      const { data, error } = await client()
        .from('auto_account_contacts')
        .upsert(payloads, { onConflict: 'account_id,contact_type,uid' })
        .select('id')

      if (error) throw new Error(`Failed to upsert Zalo campaign contacts: ${error.message}`)
      totalSaved += data?.length || 0
    }

    await upsertContactPayloads(knownFriendPayloads)
    await upsertContactPayloads(unknownFriendPayloads)
  }

  return totalSaved
}

export async function upsertZaloGroupContacts(
  groups: ZaloGroupContactInput[],
  options: UpsertContactsOptions = {}
): Promise<number> {
  const u = requireCurrentUser()
  const normalized = dedupeZaloGroupContacts(groups)
  if (normalized.length === 0) return 0

  const now = new Date().toISOString()
  const metaByKey = new Map<string, { id: number }>()
  const chunkSize = 100

  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize)
    const payloads = chunk.map(group => ({
      account_id: group.accountId,
      zalo_group_id: group.zaloGroupId,
      name: normalizeNullableString(group.name),
      description: normalizeNullableString(group.description),
      link: normalizeNullableString(group.link),
      group_type: normalizeNullableNumber(group.groupType),
      creator_uid: normalizeNullableString(group.creatorUid),
      version: normalizeNullableString(group.version),
      avatar: normalizeNullableString(group.avatar),
      full_avatar: normalizeNullableString(group.fullAvatar),
      member_ids: toStringArray(group.memberIds),
      admin_ids: toStringArray(group.adminIds),
      current_mems: normalizeJsonValue(group.currentMems),
      update_mems: normalizeJsonValue(group.updateMems),
      admins: normalizeJsonValue(group.admins),
      has_more_member: normalizeNullableNumber(group.hasMoreMember),
      sub_type: normalizeNullableNumber(group.subType),
      total_member: normalizeNullableNumber(group.totalMember),
      max_member: normalizeNullableNumber(group.maxMember),
      setting: normalizeJsonValue(group.setting),
      created_time: normalizeNullableNumber(group.createdTime),
      visibility: normalizeNullableNumber(group.visibility),
      global_id: normalizeNullableString(group.globalId),
      e2ee: normalizeNullableNumber(group.e2ee),
      status: normalizeNullableNumber(group.status),
      extra_info: normalizeJsonValue(group.extraInfo),
      mem_ver_list: toStringArray(group.memVerList),
      pending_approve: normalizeJsonValue(group.pendingApprove),
      raw_payload: group.rawPayload || {},
      last_seen_at: now,
      staff_id: u.staffId,
      organization_id: u.organizationId,
      updated_at: now
    }))

    const { data, error } = await client()
      .from('zalo_groups')
      .upsert(payloads, { onConflict: 'account_id,zalo_group_id' })
      .select('id, account_id, zalo_group_id')

    if (error) throw new Error(`Failed to upsert Zalo groups: ${error.message}`)

    for (const row of data || []) {
      metaByKey.set(zaloMetaKey(row.account_id, row.zalo_group_id), { id: row.id as number })
    }
  }

  const accountContacts = normalized
    .map<Partial<AutoAccountContact> | null>(group => {
      const meta = metaByKey.get(zaloMetaKey(group.accountId, group.zaloGroupId))
      if (!meta) return null
      return {
        accountId: group.accountId,
        contactType: 'group' as ContactType,
        uid: group.zaloGroupId,
        url: normalizeNullableString(group.link) || undefined,
        name: normalizeNullableString(group.name) || group.zaloGroupId,
        extraData: {
          platform: 'zalo',
          source: 'zalo_get_all_groups',
          avatarUrl: normalizeNullableString(group.avatar),
          fullAvatar: normalizeNullableString(group.fullAvatar),
          totalMember: normalizeNullableNumber(group.totalMember),
          groupType: normalizeNullableNumber(group.groupType)
        },
        isJoined: group.isJoined ?? true,
        zaloGroupId: meta.id
      }
    })
    .filter((contact): contact is Partial<AutoAccountContact> => !!contact)

  return upsertContacts(accountContacts, options)
}

function normalizeZaloGroupMemberInput(input: ZaloGroupMemberUpsertInput): ZaloGroupMemberUpsertInput {
  const accountId = Number(input.accountId)
  const zaloGroupId = String(input.zaloGroupId || '').trim()
  const byUid = new Map<string, ZaloGroupMemberContactInput>()
  for (const member of input.members || []) {
    const zaloUid = String(member.zaloUid || '').trim()
    if (!zaloUid) continue
    byUid.set(zaloUid, {
      ...member,
      zaloGroupId,
      zaloUid,
      role: member.role || 'member',
      roleRank: member.roleRank || 3,
      isCreator: member.isCreator === true,
      isAdmin: member.isAdmin === true
    })
  }
  return {
    ...input,
    accountId,
    zaloGroupId,
    members: Array.from(byUid.values())
  }
}

async function getExistingZaloUsers(
  accountId: number,
  zaloUids: string[],
  staffId: number
): Promise<Map<string, Record<string, unknown>>> {
  const existing = new Map<string, Record<string, unknown>>()
  const chunkSize = 100
  for (let i = 0; i < zaloUids.length; i += chunkSize) {
    const chunk = zaloUids.slice(i, i + chunkSize)
    const { data, error } = await client()
      .from('zalo_users')
      .select('*')
      .eq('account_id', accountId)
      .eq('staff_id', staffId)
      .in('zalo_uid', chunk)

    if (error) throw new Error(`Failed to list existing Zalo users: ${error.message}`)
    for (const row of data || []) existing.set(String(row.zalo_uid || '').trim(), row)
  }
  return existing
}

async function getExistingPersonContacts(
  accountId: number,
  zaloUids: string[],
  staffId: number
): Promise<Map<string, AutoAccountContact>> {
  const existing = new Map<string, AutoAccountContact>()
  const chunkSize = 100
  for (let i = 0; i < zaloUids.length; i += chunkSize) {
    const chunk = zaloUids.slice(i, i + chunkSize)
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('*')
      .eq('account_id', accountId)
      .eq('staff_id', staffId)
      .eq('contact_type', 'person')
      .in('uid', chunk)

    if (error) throw new Error(`Failed to list existing Zalo member contacts: ${error.message}`)
    for (const row of data || []) {
      const contact = mapAccountContactFromDB(row)
      existing.set(String(contact.uid || '').trim(), contact)
    }
  }
  return existing
}

async function upsertZaloUsersForGroupMembers(
  accountId: number,
  members: ZaloGroupMemberContactInput[],
  staffId: number,
  organizationId: number
): Promise<Map<string, number>> {
  const now = new Date().toISOString()
  const zaloUids = members.map(member => member.zaloUid)
  const existing = await getExistingZaloUsers(accountId, zaloUids, staffId)
  const idByUid = new Map<string, number>()
  const chunkSize = 100

  for (let i = 0; i < members.length; i += chunkSize) {
    const chunk = members.slice(i, i + chunkSize)
    const payloads = chunk.map(member => {
      const row = existing.get(member.zaloUid) || {}
      const rawPayload = isNonEmptyRecord(row.raw_payload)
        ? row.raw_payload
        : (member.rawPayload || {})
      return {
        account_id: accountId,
        zalo_uid: member.zaloUid,
        user_id: normalizeNullableString(row.user_id),
        username: normalizeNullableString(row.username),
        display_name: normalizeNullableString(member.displayName) || normalizeNullableString(row.display_name),
        zalo_name: normalizeNullableString(member.zaloName) || normalizeNullableString(row.zalo_name),
        avatar: normalizeNullableString(member.avatar) || normalizeNullableString(row.avatar),
        bgavatar: normalizeNullableString(row.bgavatar),
        cover: normalizeNullableString(row.cover),
        gender: normalizeNullableNumber(row.gender),
        dob: normalizeNullableNumber(row.dob),
        sdob: normalizeNullableString(row.sdob),
        status: normalizeNullableString(row.status),
        phone_number: normalizeNullableString(row.phone_number),
        is_fr: normalizeNullableNumber(row.is_fr),
        is_blocked: normalizeNullableNumber(row.is_blocked),
        last_action_time: normalizeNullableNumber(row.last_action_time),
        last_update_time: firstNullableNumber(member.lastUpdateTime, row.last_update_time),
        is_active: normalizeNullableNumber(row.is_active),
        key: normalizeNullableNumber(row.key),
        type: firstNullableNumber(member.type, row.type),
        is_active_pc: normalizeNullableNumber(row.is_active_pc),
        is_active_web: normalizeNullableNumber(row.is_active_web),
        is_valid: normalizeNullableNumber(row.is_valid),
        user_key: normalizeNullableString(row.user_key),
        account_status: firstNullableNumber(member.accountStatus, row.account_status),
        oa_info: normalizeJsonValue(row.oa_info),
        user_mode: normalizeNullableNumber(row.user_mode),
        global_id: normalizeNullableString(member.globalId) || normalizeNullableString(row.global_id),
        biz_pkg: normalizeJsonValue(row.biz_pkg),
        created_ts: normalizeNullableNumber(row.created_ts),
        oa_status: normalizeJsonValue(row.oa_status),
        raw_payload: rawPayload,
        last_seen_at: now,
        staff_id: staffId,
        organization_id: organizationId,
        updated_at: now
      }
    })

    const { data, error } = await client()
      .from('zalo_users')
      .upsert(payloads, { onConflict: 'account_id,zalo_uid' })
      .select('id, zalo_uid')

    if (error) throw new Error(`Failed to upsert Zalo group member users: ${error.message}`)
    for (const row of data || []) idByUid.set(String(row.zalo_uid || '').trim(), row.id as number)
  }

  return idByUid
}

async function upsertZaloGroupMetaOnly(
  group: ZaloGroupContactInput,
  staffId: number,
  organizationId: number
): Promise<{ id: number; groupType?: number | null }> {
  const accountId = Number(group.accountId)
  const zaloGroupId = String(group.zaloGroupId || '').trim()
  if (!Number.isFinite(accountId) || accountId <= 0 || !zaloGroupId) {
    throw new Error('Thông tin group Zalo không hợp lệ')
  }

  const now = new Date().toISOString()
  const { data: existing, error: existingError } = await client()
    .from('zalo_groups')
    .select('*')
    .eq('account_id', accountId)
    .eq('staff_id', staffId)
    .eq('zalo_group_id', zaloGroupId)
    .maybeSingle()

  if (existingError) throw new Error(`Failed to get existing Zalo group: ${existingError.message}`)

  const payload = {
    account_id: accountId,
    zalo_group_id: zaloGroupId,
    name: normalizeNullableString(group.name) || normalizeNullableString(existing?.name),
    description: normalizeNullableString(group.description) || normalizeNullableString(existing?.description),
    link: normalizeNullableString(group.link) || normalizeNullableString(existing?.link),
    group_type: firstNullableNumber(group.groupType, existing?.group_type),
    creator_uid: normalizeNullableString(group.creatorUid) || normalizeNullableString(existing?.creator_uid),
    version: normalizeNullableString(group.version) || normalizeNullableString(existing?.version),
    avatar: normalizeNullableString(group.avatar) || normalizeNullableString(existing?.avatar),
    full_avatar: normalizeNullableString(group.fullAvatar) || normalizeNullableString(existing?.full_avatar),
    member_ids: group.memberIds !== undefined ? toStringArray(group.memberIds) : toStringArray(existing?.member_ids),
    admin_ids: group.adminIds !== undefined ? toStringArray(group.adminIds) : toStringArray(existing?.admin_ids),
    current_mems: group.currentMems !== undefined ? normalizeJsonValue(group.currentMems) : normalizeJsonValue(existing?.current_mems),
    update_mems: group.updateMems !== undefined ? normalizeJsonValue(group.updateMems) : normalizeJsonValue(existing?.update_mems),
    admins: group.admins !== undefined ? normalizeJsonValue(group.admins) : normalizeJsonValue(existing?.admins),
    has_more_member: firstNullableNumber(group.hasMoreMember, existing?.has_more_member),
    sub_type: firstNullableNumber(group.subType, existing?.sub_type),
    total_member: firstNullableNumber(group.totalMember, existing?.total_member),
    max_member: firstNullableNumber(group.maxMember, existing?.max_member),
    setting: group.setting !== undefined ? normalizeJsonValue(group.setting) : normalizeJsonValue(existing?.setting),
    created_time: firstNullableNumber(group.createdTime, existing?.created_time),
    visibility: firstNullableNumber(group.visibility, existing?.visibility),
    global_id: normalizeNullableString(group.globalId) || normalizeNullableString(existing?.global_id),
    e2ee: firstNullableNumber(group.e2ee, existing?.e2ee),
    status: firstNullableNumber(group.status, existing?.status),
    extra_info: group.extraInfo !== undefined ? normalizeJsonValue(group.extraInfo) : normalizeJsonValue(existing?.extra_info),
    mem_ver_list: group.memVerList !== undefined ? toStringArray(group.memVerList) : toStringArray(existing?.mem_ver_list),
    pending_approve: group.pendingApprove !== undefined ? normalizeJsonValue(group.pendingApprove) : normalizeJsonValue(existing?.pending_approve),
    raw_payload: isNonEmptyRecord(existing?.raw_payload) ? existing?.raw_payload : (group.rawPayload || {}),
    last_seen_at: now,
    staff_id: staffId,
    organization_id: organizationId,
    updated_at: now
  }

  const { data, error } = await client()
    .from('zalo_groups')
    .upsert(payload, { onConflict: 'account_id,zalo_group_id' })
    .select('id, group_type')
    .single()

  if (error) throw new Error(`Failed to upsert Zalo group meta: ${error.message}`)
  return { id: data.id as number, groupType: normalizeNullableNumber(data.group_type) }
}

async function getExistingZaloGroupAccountContact(
  accountId: number,
  zaloGroupId: string,
  staffId: number
): Promise<AutoAccountContact | null> {
  const { data, error } = await client()
    .from('auto_account_contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('staff_id', staffId)
    .eq('contact_type', 'group')
    .eq('uid', zaloGroupId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to get existing Zalo group contact: ${error.message}`)
  return data ? mapAccountContactFromDB(data) : null
}

async function upsertZaloGroupLinkContact(
  group: ZaloGroupContactInput,
  zaloGroupMetaId: number,
  staffId: number
): Promise<void> {
  const accountId = Number(group.accountId)
  const zaloGroupId = String(group.zaloGroupId || '').trim()
  if (!Number.isFinite(accountId) || accountId <= 0 || !zaloGroupId) return

  const existing = await getExistingZaloGroupAccountContact(accountId, zaloGroupId, staffId)
  await upsertContacts([{
    accountId,
    contactType: 'group',
    uid: zaloGroupId,
    url: normalizeNullableString(group.link) || existing?.url || undefined,
    name: normalizeNullableString(group.name) || existing?.name || zaloGroupId,
    extraData: {
      platform: 'zalo',
      source: 'zalo_group_link_members',
      avatarUrl: normalizeNullableString(group.avatar),
      fullAvatar: normalizeNullableString(group.fullAvatar),
      totalMember: normalizeNullableNumber(group.totalMember)
    },
    isJoined: group.isJoined !== undefined ? group.isJoined : existing?.isJoined === true,
    zaloGroupId: zaloGroupMetaId
  }], { markMissingDeleted: false })
}

async function getZaloGroupMetaForMembers(
  accountId: number,
  zaloGroupId: string,
  staffId: number
): Promise<{ id: number; groupType?: number | null } | null> {
  const { data, error } = await client()
    .from('zalo_groups')
    .select('id, group_type')
    .eq('account_id', accountId)
    .eq('staff_id', staffId)
    .eq('zalo_group_id', zaloGroupId)
    .maybeSingle()

  if (error) throw new Error(`Failed to get Zalo group meta: ${error.message}`)
  return data ? { id: data.id as number, groupType: normalizeNullableNumber(data.group_type) } : null
}

function getZaloGroupRoleLabel(role: unknown, groupType?: number | null): string {
  const isCommunity = Number(groupType) === 2
  if (role === 'owner') return isCommunity ? 'Trưởng cộng đồng' : 'Trưởng nhóm'
  if (role === 'admin') return isCommunity ? 'Phó cộng đồng' : 'Phó nhóm'
  return 'Thành viên'
}

async function markMissingZaloGroupMembers(
  accountId: number,
  zaloGroupId: string,
  seenUids: Set<string>,
  staffId: number
): Promise<void> {
  const { data, error } = await client()
    .from('zalo_group_members')
    .select('id, zalo_uid')
    .eq('account_id', accountId)
    .eq('staff_id', staffId)
    .eq('zalo_group_id', zaloGroupId)
    .eq('is_current', true)

  if (error) throw new Error(`Failed to list existing Zalo group members: ${error.message}`)
  const idsToMark = (data || [])
    .filter(row => !seenUids.has(String(row.zalo_uid || '').trim()))
    .map(row => row.id as number)

  const chunkSize = 100
  for (let i = 0; i < idsToMark.length; i += chunkSize) {
    const chunk = idsToMark.slice(i, i + chunkSize)
    const { error: updateError } = await client()
      .from('zalo_group_members')
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .in('id', chunk)

    if (updateError) throw new Error(`Failed to mark missing Zalo group members: ${updateError.message}`)
  }
}

export async function upsertZaloGroupMemberContacts(input: ZaloGroupMemberUpsertInput): Promise<number> {
  const u = requireCurrentUser()
  const normalized = normalizeZaloGroupMemberInput(input)
  if (!Number.isFinite(normalized.accountId) || normalized.accountId <= 0 || !normalized.zaloGroupId) {
    throw new Error('Thông tin quét thành viên group Zalo không hợp lệ')
  }

  const members = normalized.members
  const normalizedGroup = normalized.group
    ? { ...normalized.group, accountId: normalized.accountId, zaloGroupId: normalized.zaloGroupId }
    : null
  const groupMeta = normalizedGroup
    ? await upsertZaloGroupMetaOnly(
      normalizedGroup,
      u.staffId,
      u.organizationId
    )
    : await getZaloGroupMetaForMembers(normalized.accountId, normalized.zaloGroupId, u.staffId)

  if (!groupMeta) {
    throw new Error('Vui lòng quét danh sách group Zalo trước khi quét thành viên group đã tham gia.')
  }

  if (normalizedGroup) {
    await upsertZaloGroupLinkContact(normalizedGroup, groupMeta.id, u.staffId)
  }

  if (members.length === 0) {
    await markMissingZaloGroupMembers(normalized.accountId, normalized.zaloGroupId, new Set(), u.staffId)
    return 0
  }

  const userIdByUid = await upsertZaloUsersForGroupMembers(
    normalized.accountId,
    members,
    u.staffId,
    u.organizationId
  )

  const existingContacts = await getExistingPersonContacts(
    normalized.accountId,
    members.map(member => member.zaloUid),
    u.staffId
  )
  const roleLabelByUid = new Map(members.map(member => [
    member.zaloUid,
    getZaloGroupRoleLabel(member.role, groupMeta.groupType)
  ]))
  const contactsToSave = members.map<Partial<AutoAccountContact>>(member => {
    const existing = existingContacts.get(member.zaloUid)
    return {
      accountId: normalized.accountId,
      contactType: 'person',
      uid: member.zaloUid,
      name: normalizeNullableString(member.displayName)
        || normalizeNullableString(member.zaloName)
        || member.zaloUid,
      extraData: {
        platform: 'zalo',
        source: 'zalo_group_members',
        avatarUrl: normalizeNullableString(member.avatar),
        zaloGroupId: normalized.zaloGroupId,
        zaloGroupRole: member.role,
        zaloGroupRoleRank: member.roleRank,
        zaloGroupRoleLabel: roleLabelByUid.get(member.zaloUid)
      },
      isFriend: existing?.isFriend === true,
      zaloUserId: userIdByUid.get(member.zaloUid) || undefined
    }
  })

  await upsertContacts(contactsToSave, { markMissingDeleted: false })

  const seenUids = new Set(members.map(member => member.zaloUid))
  await markMissingZaloGroupMembers(normalized.accountId, normalized.zaloGroupId, seenUids, u.staffId)

  const now = new Date().toISOString()
  const chunkSize = 100
  let totalSaved = 0
  for (let i = 0; i < members.length; i += chunkSize) {
    const chunk = members.slice(i, i + chunkSize)
    const payloads = chunk.map(member => ({
      account_id: normalized.accountId,
      user_id: userIdByUid.get(member.zaloUid) || null,
      group_id: groupMeta.id,
      zalo_uid: member.zaloUid,
      zalo_group_id: normalized.zaloGroupId,
      role: member.role,
      role_rank: member.roleRank,
      is_creator: member.isCreator,
      is_admin: member.isAdmin,
      is_current: true,
      raw_payload: member.rawPayload || {},
      last_seen_at: now,
      staff_id: u.staffId,
      organization_id: u.organizationId,
      updated_at: now
    }))

    const { data, error } = await client()
      .from('zalo_group_members')
      .upsert(payloads, { onConflict: 'account_id,zalo_group_id,zalo_uid' })
      .select('id')

    if (error) throw new Error(`Failed to upsert Zalo group members: ${error.message}`)
    totalSaved += data?.length || 0
  }

  return totalSaved
}

async function fetchZaloGroupMemberContactsForList(
  accountId: number,
  query: ZaloGroupMemberContactListQuery = {}
): Promise<AutoAccountContact[]> {
  const u = requireCurrentUser()
  const normalizedGroupId = String(query.zaloGroupId || '').trim()
  if (!normalizedGroupId) return []

  const groupType = await getZaloGroupTypeForMemberList(accountId, u.staffId, normalizedGroupId)

  const members: Record<string, unknown>[] = []
  let from = 0
  while (true) {
    const { data, error: memberError } = await client()
      .from('zalo_group_members')
      .select('*')
      .eq('account_id', accountId)
      .eq('staff_id', u.staffId)
      .eq('zalo_group_id', normalizedGroupId)
      .eq('is_current', true)
      .order('role_rank', { ascending: true })
      .order('updated_at', { ascending: false })
      .range(from, from + CONTACT_LIST_FETCH_CHUNK - 1)

    if (memberError) throw new Error(`Failed to list Zalo group members: ${memberError.message}`)
    members.push(...(data || []))
    if (!data || data.length < CONTACT_LIST_FETCH_CHUNK) break
    from += CONTACT_LIST_FETCH_CHUNK
  }

  if (members.length === 0) return []

  const result = await mapZaloGroupMemberRowsToContacts(accountId, u.staffId, normalizedGroupId, groupType, members)
  const ids = normalizeContactIdList(query.ids)
  const idSet = ids.length > 0 ? new Set(ids) : null
  const excludeIds = new Set(normalizeContactIdList(query.excludeIds))
  const search = normalizeSearchText(query.search)
  const zaloTagIds = normalizeZaloTagIdList(query.zaloTagIds)
  const akaBizTagIds = normalizeContactIdList(query.akaBizTagIds)
  const includeNoZaloTag = query.zaloNoTag === true
  const includeNoAkaBizTag = query.akaBizNoTag === true

  return result.filter(contact => {
    if (idSet && !idSet.has(contact.id)) return false
    if (excludeIds.has(contact.id)) return false
    if (!contactMatchesSearch(contact, search)) return false
    if (!contactMatchesZaloTagFilter(contact, zaloTagIds, includeNoZaloTag)) return false
    if (!contactMatchesAkaBizTagFilter(contact, akaBizTagIds, includeNoAkaBizTag)) return false
    return true
  })
}

async function getZaloGroupTypeForMemberList(
  accountId: number,
  staffId: number,
  normalizedGroupId: string
): Promise<number | null> {
  const { data: groupRow, error: groupError } = await client()
    .from('zalo_groups')
    .select('group_type')
    .eq('account_id', accountId)
    .eq('staff_id', staffId)
    .eq('zalo_group_id', normalizedGroupId)
    .maybeSingle()

  if (groupError) throw new Error(`Failed to get Zalo group for members: ${groupError.message}`)
  return normalizeNullableNumber(groupRow?.group_type)
}

async function mapZaloGroupMemberRowsToContacts(
  accountId: number,
  staffId: number,
  normalizedGroupId: string,
  groupType: number | null,
  members: Record<string, unknown>[]
): Promise<AutoAccountContact[]> {
  const memberByUid = new Map<string, Record<string, unknown>>()
  for (const member of members) memberByUid.set(String(member.zalo_uid || '').trim(), member)
  const uids = Array.from(memberByUid.keys())
  const contactsByUid = new Map<string, AutoAccountContact>()
  for (const chunk of chunkArray(uids, 100)) {
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('*')
      .eq('account_id', accountId)
      .eq('staff_id', staffId)
      .eq('contact_type', 'person')
      .eq('is_delete', false)
      .in('uid', chunk)

    if (error) throw new Error(`Failed to list Zalo group member contacts: ${error.message}`)
    for (const row of data || []) {
      const contact = mapAccountContactFromDB(row)
      contactsByUid.set(String(contact.uid || '').trim(), contact)
    }
  }

  const result: AutoAccountContact[] = []
  for (const uid of uids) {
    const contact = contactsByUid.get(uid)
    const member = memberByUid.get(uid)
    if (!contact || !member) continue
    result.push({
      ...contact,
      extraData: {
        ...(contact.extraData || {}),
        zaloGroupId: normalizedGroupId,
        zaloGroupRole: member.role,
        zaloGroupRoleRank: member.role_rank,
        zaloGroupRoleLabel: getZaloGroupRoleLabel(member.role, groupType),
        isCreator: member.is_creator,
        isAdmin: member.is_admin
      }
    })
  }

  return result
}

function canUseDbPagedZaloGroupMemberContacts(query: ZaloGroupMemberContactListQuery): boolean {
  if (!String(query.zaloGroupId || '').trim()) return false
  if (normalizeContactIdList(query.ids).length > 0) return false
  if (normalizeContactIdList(query.excludeIds).length > 0) return false
  if (normalizeSearchText(query.search)) return false
  if (normalizeZaloTagIdList(query.zaloTagIds).length > 0) return false
  if (query.zaloNoTag) return false
  if (normalizeContactIdList(query.akaBizTagIds).length > 0) return false
  if (query.akaBizNoTag) return false
  return true
}

async function listZaloGroupMemberContactsPageFromDb(
  accountId: number,
  query: ZaloGroupMemberContactListQuery,
  offset: number,
  limit: number
): Promise<ContactListResult> {
  const u = requireCurrentUser()
  const normalizedGroupId = String(query.zaloGroupId || '').trim()
  if (!normalizedGroupId) return { contacts: [], total: 0 }

  const groupType = await getZaloGroupTypeForMemberList(accountId, u.staffId, normalizedGroupId)
  const { data, error, count } = await client()
    .from('zalo_group_members')
    .select('*', { count: 'exact' })
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('zalo_group_id', normalizedGroupId)
    .eq('is_current', true)
    .order('role_rank', { ascending: true })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(`Failed to list Zalo group members: ${error.message}`)
  return {
    contacts: await mapZaloGroupMemberRowsToContacts(
      accountId,
      u.staffId,
      normalizedGroupId,
      groupType,
      (data || []) as Record<string, unknown>[]
    ),
    total: count ?? 0
  }
}

export async function listZaloGroupMemberContacts(
  accountId: number,
  query: ZaloGroupMemberContactListQuery = {}
): Promise<ContactListResult> {
  const offset = clampContactListOffset(query.offset)
  const limit = clampContactListLimit(query.limit)
  if (canUseDbPagedZaloGroupMemberContacts(query)) {
    return listZaloGroupMemberContactsPageFromDb(accountId, query, offset, limit)
  }

  const filtered = await fetchZaloGroupMemberContactsForList(accountId, query)
  return {
    contacts: filtered.slice(offset, offset + limit),
    total: filtered.length
  }
}

export async function exportZaloGroupMemberContacts(
  accountId: number,
  query: ZaloGroupMemberContactListQuery = {}
): Promise<AutoAccountContact[]> {
  const offset = clampContactListOffset(query.offset)
  const limit = normalizeOptionalContactListLimit(query.limit)
  if (limit !== null && canUseDbPagedZaloGroupMemberContacts(query)) {
    const result = await listZaloGroupMemberContactsPageFromDb(accountId, query, offset, limit)
    return result.contacts
  }

  const filtered = await fetchZaloGroupMemberContactsForList(accountId, query)
  return limit === null ? filtered : filtered.slice(offset, offset + limit)
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

async function getContactGroup(
  groupId: number,
  purpose: ContactGroupPurpose = CONTACT_GROUP_PURPOSE_DATA
): Promise<AutoAccountContactGroup> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_account_contact_groups')
    .select('*')
    .eq('id', groupId)
    .eq('staff_id', u.staffId)
    .eq('purpose', purpose)
    .eq('is_delete', false)
    .single()

  if (error) throw new Error(`Failed to get contact group: ${error.message}`)
  return mapAccountContactGroupFromDB(data)
}

async function getActiveContactIds(contactIds: number[], staffId: number): Promise<Set<number>> {
  const ids = uniqueIds(contactIds)
  if (ids.length === 0) return new Set()

  const activeIds = new Set<number>()
  for (const chunk of chunkArray(ids, CONTACT_LIST_FETCH_CHUNK)) {
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('id')
      .in('id', chunk)
      .eq('staff_id', staffId)
      .eq('is_delete', false)

    if (error) throw new Error(`Failed to list active contacts: ${error.message}`)
    for (const row of data || []) activeIds.add(row.id as number)
  }
  return activeIds
}

export async function listContactGroups(
  accountId: number,
  contactType?: ContactType,
  purpose: ContactGroupPurpose = CONTACT_GROUP_PURPOSE_DATA
): Promise<AutoAccountContactGroup[]> {
  const u = requireCurrentUser()
  let query = client()
    .from('auto_account_contact_groups')
    .select('*')
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('purpose', purpose)
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
  name: string,
  purpose: ContactGroupPurpose = CONTACT_GROUP_PURPOSE_DATA
): Promise<AutoAccountContactGroup> {
  const u = requireCurrentUser()
  const normalizedName = normalizeGroupName(name)
  if (!normalizedName) throw new Error('Vui lòng nhập tên nhóm.')

  const { data, error } = await client()
    .from('auto_account_contact_groups')
    .insert({
      account_id: accountId,
      contact_type: contactType,
      purpose,
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
  name: string,
  purpose: ContactGroupPurpose = CONTACT_GROUP_PURPOSE_DATA
): Promise<AutoAccountContactGroup> {
  const u = requireCurrentUser()
  await getContactGroup(groupId, purpose)
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
    .eq('purpose', purpose)
    .eq('is_delete', false)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') throw new Error('Tên nhóm đã tồn tại.')
    throw new Error(`Failed to update contact group: ${error.message}`)
  }
  return mapAccountContactGroupFromDB(data)
}

export async function deleteContactGroup(
  groupId: number,
  purpose: ContactGroupPurpose = CONTACT_GROUP_PURPOSE_DATA
): Promise<void> {
  const u = requireCurrentUser()
  await getContactGroup(groupId, purpose)
  const { error } = await client()
    .from('auto_account_contact_groups')
    .update({
      is_delete: true,
      updated_at: new Date().toISOString()
    })
    .eq('id', groupId)
    .eq('staff_id', u.staffId)
    .eq('purpose', purpose)

  if (error) throw new Error(`Failed to delete contact group: ${error.message}`)
}

export async function listContactGroupContacts(
  groupId: number,
  purpose: ContactGroupPurpose = CONTACT_GROUP_PURPOSE_DATA
): Promise<AutoAccountContact[]> {
  const u = requireCurrentUser()
  const group = await getContactGroup(groupId, purpose)

  const members: Record<string, unknown>[] = []
  let memberFrom = 0
  while (true) {
    const { data, error: memberError } = await client()
      .from('auto_account_contact_group_members')
      .select('contact_id')
      .eq('group_id', groupId)
      .range(memberFrom, memberFrom + CONTACT_LIST_FETCH_CHUNK - 1)

    if (memberError) throw new Error(`Failed to list contact group members: ${memberError.message}`)
    members.push(...(data || []))
    if (!data || data.length < CONTACT_LIST_FETCH_CHUNK) break
    memberFrom += CONTACT_LIST_FETCH_CHUNK
  }

  const contactIds = uniqueIds(members.map(row => row.contact_id as number))
  if (contactIds.length === 0) return []

  const rows: Record<string, unknown>[] = []
  const contactChunkSize = 1000
  for (let i = 0; i < contactIds.length; i += contactChunkSize) {
    const chunk = contactIds.slice(i, i + contactChunkSize)
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('*')
      .in('id', chunk)
      .eq('account_id', group.accountId)
      .eq('contact_type', group.contactType)
      .eq('staff_id', u.staffId)
      .eq('is_delete', false)
      .order('name', { ascending: true })

    if (error) throw new Error(`Failed to list contacts in group: ${error.message}`)
    rows.push(...(data || []))
  }

  return rows
    .map(row => mapAccountContactFromDB(row))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi-VN'))
}

export async function addContactsToGroup(
  groupId: number,
  contactIds: number[],
  purpose: ContactGroupPurpose = CONTACT_GROUP_PURPOSE_DATA
): Promise<ContactGroupMutationResult> {
  const u = requireCurrentUser()
  const group = await getContactGroup(groupId, purpose)
  const ids = uniqueIds(contactIds)
  if (ids.length === 0) return { success: true, count: 0 }

  const validIdSet = new Set<number>()
  for (const chunk of chunkArray(ids, CONTACT_LIST_FETCH_CHUNK)) {
    const { data: contacts, error: contactError } = await client()
      .from('auto_account_contacts')
      .select('id')
      .in('id', chunk)
      .eq('account_id', group.accountId)
      .eq('contact_type', group.contactType)
      .eq('staff_id', u.staffId)
      .eq('is_delete', false)

    if (contactError) throw new Error(`Failed to validate contacts: ${contactError.message}`)
    for (const row of contacts || []) validIdSet.add(row.id as number)
  }

  const validIds = ids.filter(id => validIdSet.has(id))
  if (validIds.length === 0) return { success: true, count: 0 }

  const existingIds = new Set<number>()
  for (const chunk of chunkArray(validIds, CONTACT_LIST_FETCH_CHUNK)) {
    const { data: existing, error: existingError } = await client()
      .from('auto_account_contact_group_members')
      .select('contact_id')
      .eq('group_id', groupId)
      .in('contact_id', chunk)

    if (existingError) throw new Error(`Failed to list existing group members: ${existingError.message}`)
    for (const row of existing || []) existingIds.add(row.contact_id as number)
  }

  const idsToInsert = validIds.filter(id => !existingIds.has(id))
  if (idsToInsert.length === 0) return { success: true, count: 0 }

  for (const chunk of chunkArray(idsToInsert, CONTACT_LIST_MUTATION_CHUNK)) {
    const { error } = await client()
      .from('auto_account_contact_group_members')
      .upsert(chunk.map(contactId => ({
        group_id: groupId,
        contact_id: contactId
      })), { onConflict: 'group_id,contact_id', ignoreDuplicates: true })

    if (error) throw new Error(`Failed to add contacts to group: ${error.message}`)
  }
  return { success: true, count: idsToInsert.length }
}

export async function removeContactsFromGroup(
  groupId: number,
  contactIds: number[],
  purpose: ContactGroupPurpose = CONTACT_GROUP_PURPOSE_DATA
): Promise<ContactGroupMutationResult> {
  await getContactGroup(groupId, purpose)
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

export interface ZaloFriendBlocklistUidSnapshot {
  group: AutoAccountContactGroup
  uids: string[]
}

export async function listZaloFriendBlocklists(accountId: number): Promise<AutoAccountContactGroup[]> {
  return listContactGroups(accountId, 'person', CONTACT_GROUP_PURPOSE_ZALO_FRIEND_BLOCKLIST)
}

export async function createZaloFriendBlocklist(
  accountId: number,
  name: string
): Promise<AutoAccountContactGroup> {
  return createContactGroup(accountId, 'person', name, CONTACT_GROUP_PURPOSE_ZALO_FRIEND_BLOCKLIST)
}

export async function updateZaloFriendBlocklist(
  groupId: number,
  name: string
): Promise<AutoAccountContactGroup> {
  return updateContactGroup(groupId, name, CONTACT_GROUP_PURPOSE_ZALO_FRIEND_BLOCKLIST)
}

export async function deleteZaloFriendBlocklist(groupId: number): Promise<void> {
  return deleteContactGroup(groupId, CONTACT_GROUP_PURPOSE_ZALO_FRIEND_BLOCKLIST)
}

export async function listZaloFriendBlocklistFriends(groupId: number): Promise<AutoAccountContact[]> {
  return listContactGroupContacts(groupId, CONTACT_GROUP_PURPOSE_ZALO_FRIEND_BLOCKLIST)
}

export async function addFriendsToZaloFriendBlocklist(
  groupId: number,
  contactIds: number[]
): Promise<ContactGroupMutationResult> {
  const u = requireCurrentUser()
  const group = await getContactGroup(groupId, CONTACT_GROUP_PURPOSE_ZALO_FRIEND_BLOCKLIST)
  if (group.contactType !== 'person') throw new Error('Danh sách không gửi tin không đúng loại bạn bè Zalo.')

  const ids = uniqueIds(contactIds)
  if (ids.length === 0) return { success: true, count: 0 }

  const { data: contacts, error: contactError } = await client()
    .from('auto_account_contacts')
    .select('id')
    .in('id', ids)
    .eq('account_id', group.accountId)
    .eq('contact_type', 'person')
    .eq('staff_id', u.staffId)
    .eq('is_friend', true)
    .eq('is_delete', false)

  if (contactError) throw new Error(`Failed to validate Zalo friend blocklist contacts: ${contactError.message}`)

  const validIds = uniqueIds((contacts || []).map(row => row.id as number))
  if (validIds.length === 0) return { success: true, count: 0 }

  const { data: existing, error: existingError } = await client()
    .from('auto_account_contact_group_members')
    .select('contact_id')
    .eq('group_id', groupId)
    .in('contact_id', validIds)

  if (existingError) throw new Error(`Failed to list existing Zalo friend blocklist members: ${existingError.message}`)

  const existingIds = new Set((existing || []).map(row => row.contact_id as number))
  const idsToInsert = validIds.filter(id => !existingIds.has(id))
  if (idsToInsert.length === 0) return { success: true, count: 0 }

  const { error } = await client()
    .from('auto_account_contact_group_members')
    .upsert(idsToInsert.map(contactId => ({
      group_id: groupId,
      contact_id: contactId
    })), { onConflict: 'group_id,contact_id', ignoreDuplicates: true })

  if (error) throw new Error(`Failed to add friends to Zalo friend blocklist: ${error.message}`)
  return { success: true, count: idsToInsert.length }
}

export async function removeFriendsFromZaloFriendBlocklist(
  groupId: number,
  contactIds: number[]
): Promise<ContactGroupMutationResult> {
  return removeContactsFromGroup(groupId, contactIds, CONTACT_GROUP_PURPOSE_ZALO_FRIEND_BLOCKLIST)
}

export async function getZaloFriendBlocklistUidSnapshot(
  accountId: number,
  groupId: number
): Promise<ZaloFriendBlocklistUidSnapshot> {
  const u = requireCurrentUser()
  const group = await getContactGroup(groupId, CONTACT_GROUP_PURPOSE_ZALO_FRIEND_BLOCKLIST)
  if (group.accountId !== accountId || group.contactType !== 'person') {
    throw new Error('Danh sách không gửi tin không thuộc tài khoản Zalo của chiến dịch.')
  }

  const { data: members, error: memberError } = await client()
    .from('auto_account_contact_group_members')
    .select('contact_id')
    .eq('group_id', groupId)

  if (memberError) throw new Error(`Failed to list Zalo friend blocklist members: ${memberError.message}`)

  const contactIds = uniqueIds((members || []).map(row => row.contact_id as number))
  if (contactIds.length === 0) return { group, uids: [] }

  const { data, error } = await client()
    .from('auto_account_contacts')
    .select('uid')
    .in('id', contactIds)
    .eq('account_id', accountId)
    .eq('contact_type', 'person')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to list Zalo friend blocklist UIDs: ${error.message}`)

  return {
    group,
    uids: Array.from(new Set(
      (data || [])
        .map(row => String(row.uid || '').trim())
        .filter(Boolean)
    ))
  }
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
