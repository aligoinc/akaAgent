import { utils, type WorkBook } from 'xlsx'

export type FoundDataKind = 'phone' | 'zalo' | 'uid' | 'postLink' | 'facebookGroup'

export interface FoundFacebookGroup {
  url: string
  name: string
  privacy?: string
  memberCount?: number
  postsPerDay?: number
}

interface FoundDataExportItem {
  kind: FoundDataKind
  value: string
  name?: string
  facebookGroup?: FoundFacebookGroup
}

const TEMPLATE_HEADERS = ['Tên', 'Uid', 'Sđt', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
const GROUP_HEADERS = ['Tên', 'UID', 'Số thành viên', 'Số bài', 'Đơn vị bài', 'Privacy', 'Loại nhóm AI']

// The search payload also uses 0 for missing/unparsed activity, without retaining evidence.
const knownPostsPerDay = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined

export const toFacebookGroupList = (value: unknown): FoundFacebookGroup[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const groups: FoundFacebookGroup[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const group = item as Record<string, unknown>
    const url = String(group.url || '').trim()
    const key = url.replace(/\/+$/g, '').toLowerCase()
    if (!url || seen.has(key)) continue
    seen.add(key)
    const numberOrUndefined = (raw: unknown): number | undefined => {
      if (typeof raw !== 'number' && typeof raw !== 'string') return undefined
      if (typeof raw === 'string' && !raw.trim()) return undefined
      const number = Number(raw)
      return Number.isFinite(number) && number >= 0 ? number : undefined
    }
    groups.push({
      url,
      name: String(group.name || '').trim(),
      privacy: String(group.privacy || '').trim() || undefined,
      memberCount: numberOrUndefined(group.memberCount),
      postsPerDay: knownPostsPerDay(numberOrUndefined(group.postsPerDay))
    })
  }
  return groups
}

const getUniqueItems = (items: readonly FoundDataExportItem[]): FoundDataExportItem[] => {
  const map = new Map<string, FoundDataExportItem>()
  for (const item of items) {
    const value = item.value.trim()
    const normalizedValue = item.kind === 'phone'
      ? value.replace(/[\s.\-()+]/g, '')
      : (item.kind === 'postLink' || item.kind === 'facebookGroup')
        ? value.replace(/\/+$/g, '').toLowerCase()
        : value.toLowerCase()
    if (!normalizedValue) continue
    const key = `${item.kind}:${normalizedValue}`
    const existing = map.get(key)
    const preferred = !existing || (!existing.name && item.name) ? item : existing
    if (existing && item.kind === 'facebookGroup') {
      // Filling a missing name must not replace metadata from an earlier row.
      const primary = existing.facebookGroup
      const secondary = item.facebookGroup
      map.set(key, {
        ...preferred,
        facebookGroup: {
          url: preferred.value,
          name: preferred.name || '',
          privacy: primary?.privacy || secondary?.privacy,
          memberCount: primary?.memberCount ?? secondary?.memberCount,
          postsPerDay: knownPostsPerDay(primary?.postsPerDay) ?? knownPostsPerDay(secondary?.postsPerDay)
        }
      })
    } else {
      map.set(key, preferred)
    }
  }
  return Array.from(map.values())
}

export const buildFoundDataWorkbook = (
  items: readonly FoundDataExportItem[],
  actionId: string
): WorkBook => {
  const uniqueItems = getUniqueItems(items)
  const groups = actionId === 'facebook_find_data_search'
    ? uniqueItems.filter(item => item.kind === 'facebookGroup')
    : []
  const templateItems = groups.length > 0
    ? uniqueItems.filter(item => item.kind !== 'facebookGroup')
    : uniqueItems
  const workbook = utils.book_new()

  if (templateItems.length > 0 || groups.length === 0) {
    const sheet = utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ...templateItems.map(item => [
        item.name || '',
        item.kind === 'phone' ? '' : item.value,
        item.kind === 'phone' ? item.value : '',
        '', '', '', '', '', ''
      ])
    ])
    sheet['!cols'] = [24, 48, 18, 28, 14, 14, 14, 14, 14].map(wch => ({ wch }))
    utils.book_append_sheet(workbook, sheet, 'Sheet1')
  }

  if (groups.length > 0) {
    const sheet = utils.aoa_to_sheet([
      GROUP_HEADERS,
      ...groups.map(item => {
        const group = item.facebookGroup
        const privacy = group?.privacy || ''
        const postsPerDay = knownPostsPerDay(group?.postsPerDay)
        return [
          item.name || '',
          item.value,
          group?.memberCount ?? '',
          postsPerDay ?? '',
          postsPerDay == null ? '' : 'ngày',
          privacy.toLowerCase() === 'public' ? 'Công khai' : privacy.toLowerCase() === 'private' ? 'Riêng tư' : privacy,
          // The search workflow does not classify group types with AI.
          'Không biết'
        ]
      })
    ])
    sheet['!cols'] = [40, 60, 16, 12, 14, 16, 22].map(wch => ({ wch }))
    sheet['!autofilter'] = { ref: sheet['!ref']! }
    utils.book_append_sheet(workbook, sheet, templateItems.length > 0 ? 'Group Facebook' : 'Sheet1')
  }

  return workbook
}
