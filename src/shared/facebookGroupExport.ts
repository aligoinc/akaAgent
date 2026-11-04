/** Only these actions take a Facebook group as a target (possibly mixed with profiles/pages). */
export const canExportFacebookGroupMetadata = (actionId: string | null | undefined): boolean =>
  ['facebook_group_post', 'facebook_join_group', 'facebook_find_data_group', 'facebook_comment_seeding'].includes(actionId || '')

export interface FacebookGroupMetadata {
  memberCount?: number
  postsPerDay?: number
  privacy?: string
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const nonNegativeNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export function normalizeFacebookGroupMetadata(value: unknown): FacebookGroupMetadata {
  const row = object(value)
  const posts = nonNegativeNumber(row.postsPerDay)
  const privacy = typeof row.privacy === 'string' ? row.privacy.trim() : ''
  return {
    memberCount: nonNegativeNumber(row.memberCount),
    // The collector also uses 0 for unknown activity; it is not a verified zero.
    postsPerDay: posts !== undefined && posts > 0 ? posts : undefined,
    privacy: /^(public|công khai)$/i.test(privacy) ? 'Công khai'
      : /^(private|riêng tư)$/i.test(privacy) ? 'Riêng tư' : undefined
  }
}

/** Identity validation only, never a lookup by URL/name. Post links are not group targets. */
export function facebookGroupIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (/^\d+$/.test(text)) return text
  try {
    const url = new URL(text)
    if (!['http:', 'https:'].includes(url.protocol)
      || !['facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'web.facebook.com'].includes(url.hostname.toLowerCase())) return undefined
    if (['multi_permalinks', 'story_fbid', 'post_id', 'permalink'].some(key => url.searchParams.has(key))) return undefined
    return /^\/groups\/([^/]+)\/?$/.exec(url.pathname)?.[1].toLowerCase()
  } catch { return undefined }
}

interface GroupTarget {
  dataTypeCode?: string | null
  groupDataTypeCode?: string | null
  flatformType?: string | null
  contactType?: string | null
  uid?: string | null
  url?: string | null
}

export function isFacebookGroupTarget(target: GroupTarget): boolean {
  const type = target.dataTypeCode || target.groupDataTypeCode
  if (type && type !== 'facebook_group') return false
  if (target.flatformType && target.flatformType !== 'facebook') return false
  if (target.contactType && !['group', 'campaign_input'].includes(target.contactType)) return false
  if (type === 'facebook_group') return true
  if (target.flatformType === 'facebook' && target.contactType === 'group') return true
  // A bare numeric UID cannot establish a semantic type for legacy mixed input.
  return [target.uid, target.url].some(value => value && /^https?:\/\//i.test(value) && !!facebookGroupIdentity(value))
}

/** Multiple provenance routes may converge on one target. Conflicting fields stay blank. */
export function resolveCampaignGroupMetadata(row: unknown): FacebookGroupMetadata | undefined {
  const input = object(row)
  const type = typeof input.data_type_code === 'string' ? input.data_type_code : undefined
  if (type && type !== 'facebook_group') return undefined
  const identity = facebookGroupIdentity(input.uid)
  if (!identity) return undefined
  const sources = (Array.isArray(input.sources) ? input.sources : []).map(object).filter(source =>
    isFacebookGroupTarget({ dataTypeCode: type, flatformType: source.flatform_type as string,
      contactType: source.contact_type as string, uid: source.uid as string, url: source.url as string })
    && [source.uid, source.url].some(value => facebookGroupIdentity(value) === identity))
  if (!sources.length) return undefined
  const metadata = sources.map(source => normalizeFacebookGroupMetadata(source.metadata))
  const agree = <K extends keyof FacebookGroupMetadata>(key: K): FacebookGroupMetadata[K] => {
    const values = Array.from(new Set(metadata.map(item => item[key]).filter(value => value !== undefined)))
    return values.length === 1 ? values[0] : undefined
  }
  return { memberCount: agree('memberCount'), postsPerDay: agree('postsPerDay'), privacy: agree('privacy') }
}

export const FACEBOOK_GROUP_EXPORT_COLUMNS = ['Số thành viên', 'Số bài', 'Đơn vị bài', 'Privacy'] as const

export function facebookGroupExportValues(value: FacebookGroupMetadata | undefined): Array<string | number> {
  const data = normalizeFacebookGroupMetadata(value)
  return [data.memberCount ?? '', data.postsPerDay ?? '', data.postsPerDay === undefined ? '' : 'ngày', data.privacy ?? '']
}

/** Decide headers across the whole filtered/selected export, not just the current page. */
export function appendFacebookGroupExportColumns(
  rows: Record<string, unknown>[], metadata: Array<FacebookGroupMetadata | undefined>
): Record<string, unknown>[] {
  if (!metadata.some(Boolean)) return rows
  const cells = metadata.map(facebookGroupExportValues)
  const columns = FACEBOOK_GROUP_EXPORT_COLUMNS.map((name, index) => ({ name, index }))
    .filter(column => cells.some(row => row[column.index] !== ''))
  if (!columns.length) return rows
  return rows.map((row, index) => ({ ...row,
    ...Object.fromEntries(columns.map(column => [column.name, cells[index]?.[column.index] ?? ''])) }))
}
