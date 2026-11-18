import { utils, type WorkBook } from 'xlsx'
import {
  cleanFacebookGroupName, facebookGroupUrlKey, readFacebookSearchGroupCardFields,
  type FacebookGroupJoinState, type FacebookSearchGroupCard, type FacebookSearchGroupCardFields
} from '../../../../shared/facebookSearchGroupCard'
import {
  describeFacebookGroupAdminScan, readFacebookGroupAdminFields,
  type FacebookGroupAdmin, type FacebookGroupAdminFields, type FacebookGroupAdminScan
} from '../../../../shared/facebookGroupAdmins'
import type { FoundFacebookGroupCardEntry } from '../../../../shared/foundFacebookGroupCardsIpc'

export type FoundDataKind = 'phone' | 'zalo' | 'uid' | 'postLink' | 'facebookGroup'

export interface FoundFacebookGroup extends FacebookSearchGroupCardFields, FacebookGroupAdminFields {
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
// Chỉ có khi chiến dịch bật "Lấy thông tin quản trị viên của group" (docs/FACEBOOK_SEARCH_GROUP_ADMINS.md).
const GROUP_ADMIN_HEADER = 'Quản trị viên'
const ADMIN_SHEET_NAME = 'Admin group'
const ADMIN_HEADERS = ['Tên group', 'Link group', 'Tên quản trị viên', 'Link trang cá nhân', 'UID', 'Số điện thoại', 'Email', 'Từ khóa']
const ADMIN_COLUMN_WIDTHS = [40, 50, 32, 50, 20, 26, 34, 30]
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
      ...readFacebookSearchGroupCardFields(group),
      ...readFacebookGroupAdminFields(group)
    })
  }
  return groups
}

const hasCardFields = (group: FoundFacebookGroup): boolean => (group.cardVersion ?? 0) >= 2

/** Kết quả chạy cũ (chưa lưu trường thêm) cần đọc thẻ nhóm trong log chạy. */
export const needsFacebookGroupCard = (group: FoundFacebookGroup): boolean => !hasCardFields(group)

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
  items.some(item => item.kind === 'facebookGroup' && item.facebookGroup && needsFacebookGroupCard(item.facebookGroup))

export interface FacebookGroupDisplay {
  memberCount?: number
  postsPerDay?: number
  /** Nguyên văn số bài Facebook hiển thị ("90+"); rỗng khi không khớp số bài của cùng nhóm. */
  postsText: string
  privacy: string
  joinState: string
  memberSince: string
  unreadPosts?: number
  friendMemberCount?: number
  /** Chưa quét quản trị viên (chiến dịch không bật, hoặc kết quả chạy cũ) thì không có. */
  adminScan?: FacebookGroupAdminScan
  admins: FacebookGroupAdmin[]
  /** Số quản trị viên, hoặc lý do không có danh sách; rỗng khi chưa quét. */
  adminSummary: string
}

/** Giá trị hiển thị của một nhóm, dùng chung cho bảng ở tab và file Excel. */
export const describeFacebookGroup = (group: FoundFacebookGroup | undefined): FacebookGroupDisplay => {
  const privacy = (group?.privacy || '').trim()
  const postsPerDay = knownPostsPerDay(group?.postsPerDay)
  return {
    memberCount: group?.memberCount,
    postsPerDay,
    postsText: postsPerDay !== undefined && group?.postsText && Number.parseInt(group.postsText, 10) === postsPerDay
      ? group.postsText
      : '',
    privacy: privacy.toLowerCase() === 'public' ? 'Công khai' : privacy.toLowerCase() === 'private' ? 'Riêng tư' : privacy,
    joinState: group?.joinState ? JOIN_STATE_LABELS[group.joinState] : '',
    memberSince: group?.memberSince || '',
    unreadPosts: group?.unreadPosts,
    friendMemberCount: group?.friendMemberCount,
    adminScan: group?.adminScan,
    admins: group?.adminScan === 'listed' ? group.admins ?? [] : [],
    adminSummary: group ? describeFacebookGroupAdminScan(group) : ''
  }
}

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
  // Quản trị viên: lấy lượt đã đọc được danh sách; không lượt nào đọc được thì giữ lý do của lượt đến trước.
  const adminSource = primary?.adminScan === 'listed' ? primary : secondary?.adminScan === 'listed' ? secondary : primary?.adminScan ? primary : secondary
  return {
    ...(adminSource?.adminScan ? { adminScan: adminSource.adminScan, admins: adminSource.admins ?? [] } : {}),
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

const groupKeywords = (item: FoundDataExportItem): string =>
  mergeList(item.keywords, item.facebookGroup?.keyword ? [item.facebookGroup.keyword] : []).join(', ')

/** Mỗi quản trị viên một dòng; nhiều SĐT / email của một người ghi chung một ô, cách nhau bằng dấu phẩy. */
const adminRows = (item: FoundDataExportItem): string[][] =>
  describeFacebookGroup(item.facebookGroup).admins.map(admin => [
    item.name || '', item.value, admin.name, admin.url, admin.uid || '', admin.phones.join(', '), admin.emails.join(', '), groupKeywords(item)
  ])

const groupRow = (item: FoundDataExportItem, withAdmins: boolean): Array<string | number> => {
  const group = item.facebookGroup
  const display = describeFacebookGroup(group)
  const keywords = mergeList(item.keywords, group?.keyword ? [group.keyword] : [])
  const adminCell = display.adminScan === 'listed' ? display.admins.length : display.adminSummary
  return [
    item.name || '',
    item.value,
    display.memberCount ?? '',
    display.postsPerDay ?? '',
    display.postsPerDay == null ? '' : 'ngày',
    display.privacy,
    display.postsText,
    display.unreadPosts ?? '',
    display.joinState,
    display.memberSince,
    display.friendMemberCount ?? '',
    keywords.join(', '),
    (item.accountNames || []).join(', '),
    formatFoundAt(item.foundAt),
    ...(withAdmins ? [adminCell] : [])
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
    // Cột / sheet quản trị viên chỉ thêm khi có nhóm đã quét quản trị viên: file của chiến dịch không bật giữ nguyên mẫu 14 cột.
    const withAdmins = groups.some(item => item.facebookGroup?.adminScan)
    const sheet = utils.aoa_to_sheet([withAdmins ? [...GROUP_HEADERS, GROUP_ADMIN_HEADER] : GROUP_HEADERS, ...groups.map(item => groupRow(item, withAdmins))])
    sheet['!cols'] = (withAdmins ? [...GROUP_COLUMN_WIDTHS, 18] : GROUP_COLUMN_WIDTHS).map(wch => ({ wch }))
    sheet['!autofilter'] = { ref: sheet['!ref']! }
    utils.book_append_sheet(workbook, sheet, templateItems.length > 0 ? 'Group Facebook' : 'Sheet1')
    const admins = groups.flatMap(adminRows)
    if (admins.length > 0) {
      const adminSheet = utils.aoa_to_sheet([ADMIN_HEADERS, ...admins])
      adminSheet['!cols'] = ADMIN_COLUMN_WIDTHS.map(wch => ({ wch }))
      adminSheet['!autofilter'] = { ref: adminSheet['!ref']! }
      utils.book_append_sheet(workbook, adminSheet, ADMIN_SHEET_NAME)
    }
  }

  return workbook
}
