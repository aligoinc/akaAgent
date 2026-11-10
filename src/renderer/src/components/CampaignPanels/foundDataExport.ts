import { utils, type WorkBook } from 'xlsx'
import {
  cleanFacebookGroupName, facebookGroupUrlKey, readFacebookSearchGroupCardFields,
  type FacebookGroupJoinState, type FacebookSearchGroupCard, type FacebookSearchGroupCardFields
} from '../../../../shared/facebookSearchGroupCard'
import type { FoundFacebookGroupCardEntry } from '../../../../shared/foundFacebookGroupCardsIpc'

export type FoundDataKind = 'phone' | 'zalo' | 'uid' | 'postLink' | 'facebookGroup'

export interface FoundFacebookGroup extends FacebookSearchGroupCardFields {
  url: string
  name: string
  privacy?: string
  memberCount?: number
  postsPerDay?: number
  keyword?: string
}

export interface FoundDataExportItem {
  kind: FoundDataKind
  value: string
  name?: string
  facebookGroup?: FoundFacebookGroup
  /** Từ khóa của các lượt tìm ra data (chiến dịch tìm bằng search). */
  keywords?: string[]
  /** Tài khoản của các lượt tìm ra data. */
  accountNames?: string[]
  /** Thời điểm lượt chạy sớm nhất tìm ra data (ISO). */
  foundAt?: string
}

const TEMPLATE_HEADERS = ['Tên', 'Uid', 'Sđt', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
// Sáu cột đầu giữ đúng mẫu akaBizAuto; các cột sau là dữ liệu thêm (docs/FACEBOOK_SEARCH_GROUP_EXPORT_PLAN.md).
const GROUP_HEADERS = [
  'Tên', 'UID', 'Số thành viên', 'Số bài', 'Đơn vị bài', 'Privacy',
  'Số bài Facebook hiển thị', 'Bài chưa đọc', 'Trạng thái tham gia', 'Tham gia từ', 'Bạn bè trong nhóm',
  'Từ khóa', 'Tài khoản tìm', 'Thời gian tìm'
]
const GROUP_COLUMN_WIDTHS = [40, 60, 16, 10, 12, 12, 22, 14, 20, 14, 18, 30, 26, 22]
const JOIN_STATE_LABELS: Record<FacebookGroupJoinState, string> = {
  joined: 'Đã tham gia',
  not_joined: 'Chưa tham gia',
  requested: 'Đã gửi yêu cầu'
}

// Payload cũ dùng 0 cho số bài không đọc được, không giữ bằng chứng.
const knownPostsPerDay = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined

const numberOrUndefined = (raw: unknown): number | undefined => {
  if (typeof raw !== 'number' && typeof raw !== 'string') return undefined
  if (typeof raw === 'string' && !raw.trim()) return undefined
  const number = Number(raw)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

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
    groups.push({
      url,
      // Block cũ lấy tên từ link ảnh đại diện ở giao diện tiếng Anh ("Profile photo of …").
      name: cleanFacebookGroupName(group.name),
      privacy: String(group.privacy || '').trim() || undefined,
      memberCount: numberOrUndefined(group.memberCount),
      postsPerDay: knownPostsPerDay(numberOrUndefined(group.postsPerDay)),
      keyword: String(group.keyword || '').trim() || undefined,
      ...readFacebookSearchGroupCardFields(group)
    })
  }
  return groups
}

const hasCardFields = (group: FoundFacebookGroup): boolean => (group.cardVersion ?? 0) >= 2

/**
 * Bổ sung dữ liệu từ chữ gốc của thẻ nhóm trong log chạy cho kết quả chạy cũ (chưa có `cardVersion` 2): số liệu lấy
 * theo thẻ (mỗi trường theo thẻ mới nhất có giá trị) để số bài và nguyên văn số bài cùng một lần đọc; thẻ thiếu trường
 * nào thì giữ số đã lưu. Kết quả đã lưu đủ trường thêm thì giữ nguyên, không trộn với thẻ khác thời điểm. Tên đã lưu
 * ưu tiên hơn tên cắt từ thẻ.
 */
export const applyFacebookGroupCard = (group: FoundFacebookGroup, card: FacebookSearchGroupCard | undefined): FoundFacebookGroup => {
  if (!card) return group
  if (hasCardFields(group)) return group.name || !card.name ? group : { ...group, name: card.name }
  const postsFromCard = card.postsPerDay !== undefined
  return {
    ...group,
    name: group.name || card.name || '',
    privacy: card.privacy ?? group.privacy,
    memberCount: card.memberCount ?? group.memberCount,
    postsPerDay: postsFromCard ? card.postsPerDay : knownPostsPerDay(group.postsPerDay),
    postsText: postsFromCard ? card.postsText : undefined,
    unreadPosts: card.unreadPosts,
    friendMemberCount: card.friendMemberCount,
    joinState: card.joinState,
    memberSince: card.memberSince
  }
}

export const applyFacebookGroupCards = (
  items: readonly FoundDataExportItem[],
  cards: readonly FoundFacebookGroupCardEntry[]
): FoundDataExportItem[] => {
  if (cards.length === 0) return [...items]
  const byKey = new Map(cards.map(entry => [entry.key, entry.card]))
  return items.map(item => {
    if (item.kind !== 'facebookGroup' || !item.facebookGroup) return item
    const group = applyFacebookGroupCard(item.facebookGroup, byKey.get(facebookGroupUrlKey(item.value)))
    return { ...item, name: item.name || group.name || '', facebookGroup: group }
  })
}

/** Nhóm nào chưa mang trường thêm thì cần đọc thẻ trong log chạy. */
export const needsFacebookGroupCards = (items: readonly FoundDataExportItem[]): boolean =>
  items.some(item => item.kind === 'facebookGroup' && item.facebookGroup && !hasCardFields(item.facebookGroup))

const mergeList = (first: readonly string[] | undefined, second: readonly string[] | undefined): string[] =>
  Array.from(new Set([...(first || []), ...(second || [])].map(value => value.trim()).filter(Boolean)))

const isEarlier = (value: string | undefined, than: string | undefined): boolean => {
  const a = value ? Date.parse(value) : NaN
  const b = than ? Date.parse(than) : NaN
  return !Number.isNaN(a) && (Number.isNaN(b) || a < b)
}

const earliest = (first: string | undefined, second: string | undefined): string | undefined => {
  const a = first ? Date.parse(first) : NaN
  const b = second ? Date.parse(second) : NaN
  if (Number.isNaN(a)) return Number.isNaN(b) ? undefined : second
  if (Number.isNaN(b)) return first
  return b < a ? second : first
}

const mergeFacebookGroups = (url: string, name: string, primary: FoundFacebookGroup | undefined, secondary: FoundFacebookGroup | undefined): FoundFacebookGroup => {
  const primaryPosts = knownPostsPerDay(primary?.postsPerDay)
  const postsSource = primaryPosts !== undefined ? primary : secondary
  return {
    url,
    name,
    privacy: primary?.privacy || secondary?.privacy,
    memberCount: primary?.memberCount ?? secondary?.memberCount,
    postsPerDay: knownPostsPerDay(postsSource?.postsPerDay),
    postsText: postsSource?.postsText,
    unreadPosts: primary?.unreadPosts ?? secondary?.unreadPosts,
    friendMemberCount: primary?.friendMemberCount ?? secondary?.friendMemberCount,
    joinState: primary?.joinState ?? secondary?.joinState,
    memberSince: primary?.memberSince ?? secondary?.memberSince,
    keyword: primary?.keyword || secondary?.keyword
  }
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
    if (!existing) {
      map.set(key, item)
      continue
    }
    const preferred = !existing.name && item.name ? item : existing
    // Từ khóa/tài khoản theo thứ tự tìm ra (cũ trước); danh sách lượt chạy thường đến mới → cũ.
    const [first, second] = isEarlier(item.foundAt, existing.foundAt) ? [item, existing] : [existing, item]
    const merged: FoundDataExportItem = {
      ...preferred,
      keywords: mergeList(first.keywords, second.keywords),
      accountNames: mergeList(first.accountNames, second.accountNames),
      foundAt: earliest(existing.foundAt, item.foundAt)
    }
    if (item.kind === 'facebookGroup') {
      // Bổ sung tên không được thay số liệu của dòng mới hơn (dòng đến trước).
      merged.facebookGroup = mergeFacebookGroups(preferred.value, preferred.name || '', existing.facebookGroup, item.facebookGroup)
    }
    map.set(key, merged)
  }
  return Array.from(map.values())
}

const formatFoundAt = (value: string | undefined): string => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN')
}

const groupRow = (item: FoundDataExportItem): Array<string | number> => {
  const group = item.facebookGroup
  const privacy = group?.privacy || ''
  const postsPerDay = knownPostsPerDay(group?.postsPerDay)
  // Nguyên văn chỉ hiện khi khớp số bài của cùng dòng.
  const postsText = postsPerDay !== undefined && group?.postsText && Number.parseInt(group.postsText, 10) === postsPerDay
    ? group.postsText
    : ''
  const keywords = mergeList(item.keywords, group?.keyword ? [group.keyword] : [])
  return [
    item.name || '',
    item.value,
    group?.memberCount ?? '',
    postsPerDay ?? '',
    postsPerDay == null ? '' : 'ngày',
    privacy.toLowerCase() === 'public' ? 'Công khai' : privacy.toLowerCase() === 'private' ? 'Riêng tư' : privacy,
    postsText,
    group?.unreadPosts ?? '',
    group?.joinState ? JOIN_STATE_LABELS[group.joinState] : '',
    group?.memberSince || '',
    group?.friendMemberCount ?? '',
    keywords.join(', '),
    (item.accountNames || []).join(', '),
    formatFoundAt(item.foundAt)
  ]
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
    const sheet = utils.aoa_to_sheet([GROUP_HEADERS, ...groups.map(groupRow)])
    sheet['!cols'] = GROUP_COLUMN_WIDTHS.map(wch => ({ wch }))
    sheet['!autofilter'] = { ref: sheet['!ref']! }
    utils.book_append_sheet(workbook, sheet, templateItems.length > 0 ? 'Group Facebook' : 'Sheet1')
  }

  return workbook
}
