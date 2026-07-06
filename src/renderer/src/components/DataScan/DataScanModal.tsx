import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import jsQR from 'jsqr'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, Folder, Info, Link2, Maximize2, Minimize2, Plus, QrCode, RefreshCw, Search, Square, X } from 'lucide-react'
import { utils, writeFile } from 'xlsx'
import { AccountContactListQuery, AkaBizContactTag, AutoAccountContact, AutoAccountContactGroup, ContactStatusFilter, ContactType, PageInboxMessageFilterMode, PageInboxPhoneFilter, ZaloGroupMemberContactListQuery, ZaloGroupMemberScanMode, ZaloRemarketingCustomerListQuery } from '../../../../shared/types'
import { normalizeVietnamMobilePhone } from '../../../../shared/phone'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import DataGroupManagerModal from './DataGroupManagerModal'
import DataScanGroupSelectionModal from './DataScanGroupSelectionModal'
import { useAuthStore } from '../../stores/authStore'
import { normalizeEntitlements } from '../../utils/entitlements'
import type { AuthEntitlements } from '../../../../shared/types'

export type DataScanAction = 'facebook_friends' | 'facebook_groups' | 'facebook_pages' | 'facebook_post_commenters' | 'facebook_post_likes' | 'facebook_profile_friends' | 'facebook_group_members' | 'facebook_page_inbox_customers' | 'zalo_friends' | 'zalo_groups' | 'zalo_group_members' | 'zalo_remarketing_customers'
type DataScanPlatform = 'facebook' | 'zalo'
type PageInboxTimePreset = 'all' | 'today' | 'yesterday' | '7_days' | '30_days' | 'this_month' | 'last_month' | '60_days' | '90_days'
interface PageInboxAppliedFilters {
  pageUid: string
  search: string
  phoneFilter: PageInboxPhoneFilter
  dateFrom: string
  dateTo: string
  messageFilterMode: PageInboxMessageFilterMode
  messageKeywords: string
}

interface PageInboxSelectedRange {
  start: number
  end: number
}

const POST_COMMENTERS_ACTION_ID: DataScanAction = 'facebook_post_commenters'
const POST_LIKES_ACTION_ID: DataScanAction = 'facebook_post_likes'
const PROFILE_FRIENDS_ACTION_ID: DataScanAction = 'facebook_profile_friends'
const GROUP_MEMBERS_ACTION_ID: DataScanAction = 'facebook_group_members'
const PAGE_INBOX_CUSTOMERS_ACTION_ID: DataScanAction = 'facebook_page_inbox_customers'
const ZALO_GROUP_MEMBERS_ACTION_ID: DataScanAction = 'zalo_group_members'
const ZALO_REMARKETING_CUSTOMERS_ACTION_ID: DataScanAction = 'zalo_remarketing_customers'
const DEFAULT_POST_COMMENTER_LIMIT = 100
const DEFAULT_POST_LIKE_LIMIT = 1000
const DEFAULT_PROFILE_FRIEND_LIMIT = 1000
const DEFAULT_GROUP_MEMBER_LIMIT = 1000
const PAGE_INBOX_PAGE_SIZE = 100
const DEFAULT_PAGE_INBOX_TIME_PRESET: PageInboxTimePreset = '30_days'

const ZALO_REMARKETING_ACTION_FILTER_OPTIONS = [
  { value: 'zalo_message_phone', label: 'Zalo - Gửi tin nhắn đến SĐT (Kiêm kết bạn)' },
  { value: 'zalo_message_friend', label: 'Zalo - Gửi tin nhắn đến bạn bè' },
  { value: 'zalo_message_group_member', label: 'Zalo - Nhắn tin, kết bạn đến thành viên group' }
]
const DEFAULT_ZALO_REMARKETING_ACTION_IDS = ZALO_REMARKETING_ACTION_FILTER_OPTIONS.map(option => option.value)

const PAGE_INBOX_TIME_PRESETS: Array<{ value: PageInboxTimePreset; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'today', label: 'Hôm nay' },
  { value: 'yesterday', label: 'Hôm qua' },
  { value: '7_days', label: '7 ngày' },
  { value: '30_days', label: '30 ngày' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: '60_days', label: '60 ngày' },
  { value: '90_days', label: '90 ngày' }
]

interface DataScanActionDef {
  id: DataScanAction
  label: string
  platform: DataScanPlatform
  contactType: ContactType
  emptyText: string
  loadingText: string
}

interface DataScanModalProps {
  initialAction?: DataScanAction
  initialAccountId?: number
  initialShowGroupPanel?: boolean
  initialStatusFilter?: ContactStatusFilter
  allowedActions?: DataScanAction[]
  lockAction?: boolean
  lockAccount?: boolean
  onClose: () => void
  onSelect?: (contacts: AutoAccountContact[]) => void
}

const DATA_SCAN_ACTIONS: DataScanActionDef[] = [
  {
    id: 'facebook_friends',
    label: 'Facebook - Lấy danh sách bạn bè',
    platform: 'facebook',
    contactType: 'person',
    emptyText: 'Chưa có dữ liệu bạn bè',
    loadingText: 'Đang tải danh sách bạn bè...'
  },
  {
    id: 'facebook_groups',
    label: 'Facebook - Lấy danh sách group',
    platform: 'facebook',
    contactType: 'group',
    emptyText: 'Chưa có dữ liệu group',
    loadingText: 'Đang tải danh sách group...'
  },
  {
    id: 'facebook_pages',
    label: 'Facebook - Lấy danh sách page',
    platform: 'facebook',
    contactType: 'page',
    emptyText: 'Chưa có dữ liệu page',
    loadingText: 'Đang tải danh sách page...'
  },
  {
    id: POST_COMMENTERS_ACTION_ID,
    label: 'Facebook - Lấy người comment bài post',
    platform: 'facebook',
    contactType: 'person',
    emptyText: 'Nhập link bài post rồi tải data',
    loadingText: 'Đang tải người comment bài post...'
  },
  {
    id: POST_LIKES_ACTION_ID,
    label: 'Facebook - Lấy người like bài post',
    platform: 'facebook',
    contactType: 'person',
    emptyText: 'Nhập link bài post rồi tải data',
    loadingText: 'Đang tải người like bài post...'
  },
  {
    id: PROFILE_FRIENDS_ACTION_ID,
    label: 'Facebook - Lấy danh sách bạn bè của 1 profile',
    platform: 'facebook',
    contactType: 'person',
    emptyText: 'Nhập link profile rồi tải data',
    loadingText: 'Đang tải bạn bè của profile...'
  },
  {
    id: GROUP_MEMBERS_ACTION_ID,
    label: 'Facebook - Lấy thành viên group',
    platform: 'facebook',
    contactType: 'person',
    emptyText: 'Nhập link group rồi tải data',
    loadingText: 'Đang tải thành viên group...'
  },
  {
    id: PAGE_INBOX_CUSTOMERS_ACTION_ID,
    label: 'Facebook - Lấy người từng nhắn tin với page',
    platform: 'facebook',
    contactType: 'page_inbox_customer',
    emptyText: 'Chọn page rồi tải data',
    loadingText: 'Đang tải người nhắn tin với page...'
  },
  {
    id: 'zalo_friends',
    label: 'Zalo - Lấy danh sách bạn bè',
    platform: 'zalo',
    contactType: 'person',
    emptyText: 'Chưa có dữ liệu bạn bè Zalo',
    loadingText: 'Đang tải danh sách bạn bè Zalo...'
  },
  {
    id: 'zalo_groups',
    label: 'Zalo - Lấy danh sách group',
    platform: 'zalo',
    contactType: 'group',
    emptyText: 'Chưa có dữ liệu group Zalo',
    loadingText: 'Đang tải danh sách group Zalo...'
  },
  {
    id: ZALO_GROUP_MEMBERS_ACTION_ID,
    label: 'Zalo - Lấy thành viên group',
    platform: 'zalo',
    contactType: 'person',
    emptyText: 'Chọn group hoặc nhập link rồi tải data',
    loadingText: 'Đang tải thành viên group Zalo...'
  },
  {
    id: ZALO_REMARKETING_CUSTOMERS_ACTION_ID,
    label: 'Zalo - Load khách hàng cũ từng gửi tin',
    platform: 'zalo',
    contactType: 'person',
    emptyText: 'Chọn bộ lọc rồi tải data',
    loadingText: 'Đang tải khách hàng cũ Zalo...'
  }
]

const canUseDataScanAction = (
  actionId: DataScanAction,
  entitlements?: Partial<AuthEntitlements> | null
): boolean => {
  const normalized = normalizeEntitlements(entitlements)
  if (actionId === 'facebook_pages' || actionId === PAGE_INBOX_CUSTOMERS_ACTION_ID) {
    return normalized.facebookFanpage
  }
  if (actionId.startsWith('zalo_')) return normalized.zalo
  return normalized.facebookCore
}

const getAvailableDataScanActions = (
  allowedActions?: DataScanAction[],
  entitlements?: Partial<AuthEntitlements> | null
) => {
  const entitlementAllowed = DATA_SCAN_ACTIONS.filter(item => canUseDataScanAction(item.id, entitlements))
  if (!allowedActions || allowedActions.length === 0) return entitlementAllowed
  const allowed = new Set(allowedActions)
  return entitlementAllowed.filter(item => allowed.has(item.id))
}

const getInitialDataScanAction = (
  initialAction: DataScanAction,
  allowedActions?: DataScanAction[],
  entitlements?: Partial<AuthEntitlements> | null
) => {
  const available = getAvailableDataScanActions(allowedActions, entitlements)
  if (available.length === 0) return initialAction
  return available.some(item => item.id === initialAction) ? initialAction : available[0].id
}

const EXPORT_HEADERS = ['Tên', 'Uid']

const formatExportTimestamp = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('')
}

const formatCount = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

const formatDateInput = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const getPageInboxDateRange = (preset: PageInboxTimePreset, now = new Date()) => {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const toDate = new Date(day)
  const fromDate = new Date(day)

  switch (preset) {
    case 'all':
      return { fromDate: '', toDate: '' }
    case 'today':
      return { fromDate: formatDateInput(day), toDate: formatDateInput(day) }
    case 'yesterday':
      fromDate.setDate(day.getDate() - 1)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(fromDate) }
    case '7_days':
      fromDate.setDate(day.getDate() - 7)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(toDate) }
    case '30_days':
      fromDate.setDate(day.getDate() - 30)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(toDate) }
    case 'this_month':
      fromDate.setDate(1)
      toDate.setMonth(day.getMonth() + 1)
      toDate.setDate(0)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(toDate) }
    case 'last_month':
      toDate.setDate(0)
      fromDate.setFullYear(toDate.getFullYear(), toDate.getMonth(), 1)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(toDate) }
    case '60_days':
      fromDate.setDate(day.getDate() - 60)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(toDate) }
    case '90_days':
      fromDate.setDate(day.getDate() - 90)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(toDate) }
  }
}

const getDefaultPageInboxAppliedFilters = (): PageInboxAppliedFilters => {
  const range = getPageInboxDateRange(DEFAULT_PAGE_INBOX_TIME_PRESET)
  return {
    pageUid: '',
    search: '',
    phoneFilter: 'all',
    dateFrom: range.fromDate,
    dateTo: range.toDate,
    messageFilterMode: 'all',
    messageKeywords: ''
  }
}

const arePageInboxFiltersEqual = (a: PageInboxAppliedFilters, b: PageInboxAppliedFilters) => (
  a.pageUid === b.pageUid &&
  a.search === b.search &&
  a.phoneFilter === b.phoneFilter &&
  a.dateFrom === b.dateFrom &&
  a.dateTo === b.dateTo &&
  a.messageFilterMode === b.messageFilterMode &&
  a.messageKeywords === b.messageKeywords
)

const sanitizeFileSegment = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'data'
}

const getContactValue = (contact: AutoAccountContact) => contact.url || contact.uid || ''

const getContactAvatarUrl = (contact: AutoAccountContact) => {
  const extra = contact.extraData || {}
  return String(
    extra.avatarUrl ||
    extra.avatar ||
    extra.avatar_url ||
    extra.fullAvatar ||
    extra.full_avatar ||
    ''
  ).trim()
}

const getContactInitial = (contact: AutoAccountContact) => {
  return String(contact.name || contact.uid || '?').trim().charAt(0).toLocaleUpperCase('vi-VN') || '?'
}

const renderContactAvatar = (contact: AutoAccountContact) => {
  const avatarUrl = getContactAvatarUrl(contact)
  return (
    <div className="data-scan-avatar" title={contact.name || contact.uid || undefined}>
      {avatarUrl ? (
        <img src={avatarUrl} alt="" loading="lazy" />
      ) : (
        <span>{getContactInitial(contact)}</span>
      )}
    </div>
  )
}

const normalizeContactAkaBizTagIds = (contact: AutoAccountContact) => (
  Array.isArray(contact.akaBizTagIds)
    ? Array.from(new Set(
      contact.akaBizTagIds
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id > 0)
    ))
    : []
)

const getContactAkaBizTagLabels = (
  contact: AutoAccountContact,
  tagNameById: Map<number, string>
) => normalizeContactAkaBizTagIds(contact).map(id => tagNameById.get(id) || `#${id}`)

const formatContactAkaBizTags = (
  contact: AutoAccountContact,
  tagNameById: Map<number, string>
) => getContactAkaBizTagLabels(contact, tagNameById).join(', ')

const renderAkaBizTagCell = (
  contact: AutoAccountContact,
  tagNameById: Map<number, string>
) => {
  const labels = getContactAkaBizTagLabels(contact, tagNameById)
  if (labels.length === 0) return <span className="data-scan-tag-empty">-</span>
  const visibleLabels = labels.slice(0, 2)
  const hiddenCount = labels.length - visibleLabels.length
  return (
    <div className="data-scan-tag-list" title={labels.join(', ')}>
      {visibleLabels.map(label => (
        <span key={label} className="data-scan-tag-chip">{label}</span>
      ))}
      {hiddenCount > 0 && <span className="data-scan-tag-chip is-more">+{hiddenCount}</span>}
    </div>
  )
}

const toRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const splitTagText = (value: string) => value
  .split(/[,\n;]/)
  .map(item => item.trim())
  .filter(Boolean)

const addZaloTagLabel = (labels: string[], seen: Set<string>, value: unknown) => {
  const text = String(value || '').trim()
  if (!text) return
  const key = text.toLocaleLowerCase('vi-VN')
  if (seen.has(key)) return
  seen.add(key)
  labels.push(text)
}

const collectZaloTagLabelsFromValue = (
  value: unknown,
  tagNameById: Map<string, string>,
  labels: string[],
  seen: Set<string>
) => {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) collectZaloTagLabelsFromValue(item, tagNameById, labels, seen)
    return
  }
  if (typeof value === 'object') {
    const item = toRecord(value)
    const id = String(item.id || item.labelId || item.label_id || item.tagId || item.tag_id || '').trim()
    const mapped = id ? tagNameById.get(id) : ''
    const name = String(item.text || item.name || item.labelName || item.label_name || item.tagName || item.tag_name || '').trim()
    addZaloTagLabel(labels, seen, mapped || name || (id ? `#${id}` : ''))
    return
  }

  const raw = String(value || '').trim()
  if (!raw) return
  const pieces = splitTagText(raw)
  for (const piece of pieces.length > 0 ? pieces : [raw]) {
    addZaloTagLabel(labels, seen, tagNameById.get(piece) || piece)
  }
}

const getContactZaloTagLabels = (
  contact: AutoAccountContact,
  tagNameById: Map<string, string>
) => {
  const extra = toRecord(contact.extraData)
  const sources = [
    extra.zaloTagIds,
    extra.zalo_tag_ids,
    extra.labelIds,
    extra.label_ids,
    extra.tagIds,
    extra.tag_ids,
    extra.zaloTags,
    extra.zalo_tags,
    extra.labels,
    extra.tagNames,
    extra.tag_names,
    extra.zaloTagNames,
    extra.zalo_tag_names,
    extra.labelNames,
    extra.label_names,
    toRecord(extra.rawPayload).labelIds,
    toRecord(extra.rawPayload).labels,
    toRecord(extra.rawPayload).tagIds,
    toRecord(extra.rawPayload).tags
  ]
  const labels: string[] = []
  const seen = new Set<string>()
  for (const source of sources) collectZaloTagLabelsFromValue(source, tagNameById, labels, seen)
  return labels
}

const formatContactZaloTags = (
  contact: AutoAccountContact,
  tagNameById: Map<string, string>
) => getContactZaloTagLabels(contact, tagNameById).join(', ')

const renderZaloTagCell = (
  contact: AutoAccountContact,
  tagNameById: Map<string, string>
) => {
  const labels = getContactZaloTagLabels(contact, tagNameById)
  if (labels.length === 0) return <span className="data-scan-tag-empty">-</span>
  const visibleLabels = labels.slice(0, 2)
  const hiddenCount = labels.length - visibleLabels.length
  return (
    <div className="data-scan-tag-list" title={labels.join(', ')}>
      {visibleLabels.map(label => (
        <span key={label} className="data-scan-tag-chip is-zalo">{label}</span>
      ))}
      {hiddenCount > 0 && <span className="data-scan-tag-chip is-more">+{hiddenCount}</span>}
    </div>
  )
}

const normalizeFacebookPostUrlForCompare = (value: unknown) => {
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

const normalizeFacebookProfileUrlForCompare = (value: unknown) => {
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

const normalizeFacebookGroupUrlForCompare = (value: unknown) => {
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

const normalizePositiveNumber = (value: unknown, fallback = DEFAULT_POST_COMMENTER_LIMIT) => {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const normalizeZaloGroupLink = (value: unknown) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withProtocol)
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    let groupCode = ''
    if (hostname === 'zalo.me' || hostname.endsWith('.zalo.me')) {
      if (parts[0]?.toLowerCase() !== 'g') return ''
      groupCode = parts[1] || ''
    } else if (hostname === 'zaloapp.com' || hostname.endsWith('.zaloapp.com')) {
      if (parts[0]?.toLowerCase() !== 'qr' || parts[1]?.toLowerCase() !== 'g') return ''
      groupCode = parts[2] || ''
    } else {
      return ''
    }
    return groupCode ? `https://zalo.me/g/${groupCode}` : ''
  } catch {
    return ''
  }
}

const extractZaloGroupLink = (value: unknown) => {
  const raw = String(value || '').trim()
  const direct = normalizeZaloGroupLink(raw)
  if (direct) return direct
  const match = raw.match(/(?:https?:\/\/)?(?:[\w-]+\.)?(?:zalo\.me\/g\/|zaloapp\.com\/qr\/g\/)[^\s"'<>]+/i)
  return match ? normalizeZaloGroupLink(match[0]) : ''
}

const getContactInfo = (contact: AutoAccountContact) => {
  const extra = contact.extraData || {}
  if (contact.contactType === 'page_inbox_customer') {
    return [
      typeof extra.phone === 'string' ? extra.phone : '',
      typeof extra.lastMessageText === 'string' ? extra.lastMessageText : '',
      typeof extra.messageHistory === 'string' ? extra.messageHistory : ''
    ].filter(Boolean).join(' ')
  }
  const category = typeof extra.category === 'string' ? extra.category : ''
  const lastActivityText = typeof extra.lastActivityText === 'string' ? extra.lastActivityText : ''
  return category || lastActivityText || ''
}

const getZaloGroupMemberRoleLabel = (contact: AutoAccountContact) => {
  const label = contact.extraData?.zaloGroupRoleLabel
  return typeof label === 'string' && label.trim() ? label.trim() : 'Thành viên'
}

const getZaloGroupTotalMember = (contact: AutoAccountContact) => {
  const parsed = Number(contact.extraData?.totalMember)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const formatZaloGroupTotalMember = (contact: AutoAccountContact) => {
  const totalMember = getZaloGroupTotalMember(contact)
  return totalMember === null ? '-' : formatCount(totalMember)
}

const getZaloGroupOptionLabel = (group: AutoAccountContact) => {
  const name = group.name || group.uid || '-'
  const totalMember = getZaloGroupTotalMember(group)
  return totalMember === null
    ? name
    : `${name} (${formatCount(totalMember)})`
}

const getZaloGroupContactLink = (group: AutoAccountContact) => normalizeZaloGroupLink(group.url)

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(reader.error || new Error('Không thể đọc ảnh QR.'))
  reader.readAsDataURL(file)
})

const loadImageFromDataUrl = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Không thể mở ảnh QR.'))
  image.src = dataUrl
})

const decodeQrDataFromImage = (image: HTMLImageElement) => {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) return ''

  const minSide = Math.min(width, height)
  const attempts = [
    { sx: 0, sy: 0, sw: width, sh: height },
    ...[0.78, 0.68, 0.58, 0.48].map(ratio => {
      const side = Math.round(minSide * ratio)
      return {
        sx: Math.max(0, Math.round((width - side) / 2)),
        sy: Math.max(0, Math.round((height - side) / 2)),
        sw: side,
        sh: side
      }
    })
  ]

  for (const attempt of attempts) {
    const canvas = document.createElement('canvas')
    canvas.width = attempt.sw
    canvas.height = attempt.sh
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(
      image,
      attempt.sx,
      attempt.sy,
      attempt.sw,
      attempt.sh,
      0,
      0,
      attempt.sw,
      attempt.sh
    )
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const qr = jsQR(imageData.data, imageData.width, imageData.height)
    if (qr?.data) return qr.data
  }

  return ''
}

const getPageInboxPhone = (contact: AutoAccountContact) => {
  const phone = contact.extraData?.phone
  return typeof phone === 'string' && phone.trim() ? phone.trim() : ''
}

const getPageInboxLastMessage = (contact: AutoAccountContact) => {
  const text = contact.extraData?.lastMessageText
  return typeof text === 'string' && text.trim() ? text.trim() : ''
}

const getPageInboxLastMessageAt = (contact: AutoAccountContact) => {
  const raw = contact.extraData?.lastMessageAt
  if (typeof raw !== 'string' || !raw.trim()) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

const getExtraText = (contact: AutoAccountContact, key: string) => {
  const value = contact.extraData?.[key]
  return value === null || value === undefined ? '' : String(value).trim()
}

const getContactPhoneText = (contact: AutoAccountContact) => {
  const extra = toRecord(contact.extraData)
  const rawPayload = toRecord(extra.rawPayload)
  const value = [
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
  ].find(item => String(item || '').trim())
  return normalizeVietnamMobilePhone(value)
}

const getExtraNumber = (contact: AutoAccountContact, key: string) => {
  const value = Number(contact.extraData?.[key])
  return Number.isFinite(value) ? value : null
}

const getZaloRemarketingPhone = (contact: AutoAccountContact) => getContactPhoneText(contact)
const getZaloRemarketingGroupName = (contact: AutoAccountContact) => getExtraText(contact, 'groupName')
const getZaloRemarketingActionName = (contact: AutoAccountContact) => getExtraText(contact, 'latestCampaignActionName')
const getZaloRemarketingSentCount = (contact: AutoAccountContact) => getExtraNumber(contact, 'sentCount') ?? 0
const getZaloRemarketingLatestDate = (contact: AutoAccountContact) => getExtraText(contact, 'latestSentDate')
const getZaloRemarketingDaysSinceLatest = (contact: AutoAccountContact) => {
  const value = getExtraNumber(contact, 'daysSinceLatest')
  return value === null ? '' : formatCount(value)
}
const getZaloRemarketingLatestStatus = (contact: AutoAccountContact) => getExtraText(contact, 'latestStatus')
const getZaloRemarketingLatestLog = (contact: AutoAccountContact) => getExtraText(contact, 'latestLog')
const getZaloRemarketingRecipientStatus = (contact: AutoAccountContact) => getExtraText(contact, 'recipientStatus')

const getGroupApprovalStatus = (contact: AutoAccountContact) => {
  if (contact.requiresPostApproval === true) return 'Chờ duyệt bài'
  if (contact.requiresPostApproval === false) return 'Không cần duyệt'
  return 'Chưa biết'
}

const getContactStatusLabel = (contact: AutoAccountContact) => {
  if (contact.contactType === 'person') {
    if (contact.isFriend === true) return 'Bạn bè'
    if (contact.isFriend === false) return 'Người lạ'
    return 'Chưa xác định'
  }
  if (contact.contactType === 'group') return contact.isJoined ? 'Đã tham gia' : 'Chưa tham gia'
  return ''
}

const getContactTypeLabel = (contactType: ContactType, platform: string = 'facebook') => {
  const isZalo = platform === 'zalo'
  if (contactType === 'person') return isZalo ? 'User Zalo' : 'User Facebook'
  if (contactType === 'group') return isZalo ? 'Group Zalo' : 'Group Facebook'
  if (contactType === 'page_inbox_customer') return 'Khách inbox Page'
  return 'Page Facebook'
}

const getPlatformLabel = (platform: DataScanPlatform) => platform === 'zalo' ? 'Zalo' : 'Facebook'

const getStatusFilterOptions = (contactType: ContactType): Array<{ value: ContactStatusFilter; label: string }> => {
  if (contactType === 'person') {
    return [
      { value: 'active', label: 'Bạn bè' },
      { value: 'inactive', label: 'Người lạ / chưa xác định' },
      { value: 'all', label: 'Tất cả' }
    ]
  }
  if (contactType === 'group') {
    return [
      { value: 'active', label: 'Đã tham gia' },
      { value: 'inactive', label: 'Chưa tham gia' },
      { value: 'all', label: 'Tất cả' }
    ]
  }
  return [{ value: 'all', label: 'Tất cả' }]
}

const getDedupeKey = (contact: AutoAccountContact) => {
  const value = getContactValue(contact) || contact.name || String(contact.id)
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./i, '').replace(/^web\./i, '').replace(/^m\./i, '').toLowerCase()
    if (url.pathname === '/profile.php' && url.searchParams.get('id')) {
      return `${host}/profile.php?id=${url.searchParams.get('id')}`
    }
    return `${host}${url.pathname.replace(/\/+$/g, '')}`.toLowerCase()
  } catch {
    return value.trim().replace(/\/+$/g, '').toLowerCase()
  }
}

const dedupeContacts = (contacts: AutoAccountContact[]) => {
  const seen = new Set<string>()
  const result: AutoAccountContact[] = []
  for (const contact of contacts) {
    const key = getDedupeKey(contact)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(contact)
  }
  return result
}

export default function DataScanModal({
  initialAction = 'facebook_friends',
  initialAccountId,
  initialShowGroupPanel = false,
  initialStatusFilter,
  allowedActions,
  lockAction = false,
  lockAccount = false,
  onClose,
  onSelect
}: DataScanModalProps) {
  const { accounts, loadAccounts } = useCampaignStore()
  const entitlements = useAuthStore(state => state.user?.entitlements)
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const mountedRef = useRef(true)
  const scanRunIdRef = useRef(0)
  const stoppedScanIdsRef = useRef<Set<number>>(new Set())
  const completedScanIdsRef = useRef<Set<number>>(new Set())
  const contactsLoadIdRef = useRef(0)
  const pageInboxOptionsAccountRef = useRef<number | ''>('')
  const pageInboxPageUidRef = useRef('')
  const zaloQrFileInputRef = useRef<HTMLInputElement | null>(null)
  const zaloRemarketingActionDropdownRef = useRef<HTMLDivElement | null>(null)
  const zaloTagFilterDropdownRef = useRef<HTMLDivElement | null>(null)
  const akaBizTagFilterDropdownRef = useRef<HTMLDivElement | null>(null)
  const [action, setAction] = useState<DataScanAction>(() => getInitialDataScanAction(initialAction, allowedActions, entitlements))
  const [accountId, setAccountId] = useState<number | ''>(initialAccountId || '')
  const [contacts, setContacts] = useState<AutoAccountContact[]>([])
  const [loading, setLoading] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set())
  const [statusFilter, setStatusFilter] = useState<ContactStatusFilter>(initialStatusFilter || 'active')
  const [dedupeOnOutput, setDedupeOnOutput] = useState(true)
  const [rangeStart, setRangeStart] = useState(1)
  const [rangeEnd, setRangeEnd] = useState(100)
  const [postCommentersUrl, setPostCommentersUrl] = useState('')
  const [postCommentersLimit, setPostCommentersLimit] = useState(DEFAULT_POST_COMMENTER_LIMIT)
  const [postLikesUrl, setPostLikesUrl] = useState('')
  const [postLikesLimit, setPostLikesLimit] = useState(DEFAULT_POST_LIKE_LIMIT)
  const [profileFriendsUrl, setProfileFriendsUrl] = useState('')
  const [profileFriendsLimit, setProfileFriendsLimit] = useState(DEFAULT_PROFILE_FRIEND_LIMIT)
  const [groupMembersUrl, setGroupMembersUrl] = useState('')
  const [groupMembersLimit, setGroupMembersLimit] = useState(DEFAULT_GROUP_MEMBER_LIMIT)
  const [pageInboxPages, setPageInboxPages] = useState<AutoAccountContact[]>([])
  const [pageInboxPageUid, setPageInboxPageUid] = useState('')
  const [pageInboxTimePreset, setPageInboxTimePreset] = useState<PageInboxTimePreset>(DEFAULT_PAGE_INBOX_TIME_PRESET)
  const [pageInboxPhoneFilter, setPageInboxPhoneFilter] = useState<PageInboxPhoneFilter>('all')
  const [pageInboxDateFrom, setPageInboxDateFrom] = useState(() => getPageInboxDateRange(DEFAULT_PAGE_INBOX_TIME_PRESET).fromDate)
  const [pageInboxDateTo, setPageInboxDateTo] = useState(() => getPageInboxDateRange(DEFAULT_PAGE_INBOX_TIME_PRESET).toDate)
  const [pageInboxMessageFilterMode, setPageInboxMessageFilterMode] = useState<PageInboxMessageFilterMode>('all')
  const [pageInboxMessageKeywords, setPageInboxMessageKeywords] = useState('')
  const [pageInboxPage, setPageInboxPage] = useState(1)
  const [pageInboxTotal, setPageInboxTotal] = useState(0)
  const [pageInboxAppliedFilters, setPageInboxAppliedFilters] = useState<PageInboxAppliedFilters>(() => getDefaultPageInboxAppliedFilters())
  const [pageInboxSelectAllMatching, setPageInboxSelectAllMatching] = useState(false)
  const [pageInboxSelectedRange, setPageInboxSelectedRange] = useState<PageInboxSelectedRange | null>(null)
  const [pageInboxExcludedIds, setPageInboxExcludedIds] = useState<Set<number>>(new Set())
  const [zaloGroupMemberMode, setZaloGroupMemberMode] = useState<ZaloGroupMemberScanMode>('joined_group')
  const [zaloGroupMemberGroupId, setZaloGroupMemberGroupId] = useState('')
  const [zaloGroupMemberLink, setZaloGroupMemberLink] = useState('')
  const [zaloGroupOptions, setZaloGroupOptions] = useState<AutoAccountContact[]>([])
  const [zaloRemarketingActionIds, setZaloRemarketingActionIds] = useState<string[]>(() => [...DEFAULT_ZALO_REMARKETING_ACTION_IDS])
  const [zaloRemarketingActionDropdownOpen, setZaloRemarketingActionDropdownOpen] = useState(false)
  const [zaloRemarketingDateFrom, setZaloRemarketingDateFrom] = useState(() => getPageInboxDateRange('7_days').fromDate)
  const [zaloRemarketingDateTo, setZaloRemarketingDateTo] = useState(() => getPageInboxDateRange('7_days').toDate)
  const [zaloQrReading, setZaloQrReading] = useState(false)
  const [zaloTagContacts, setZaloTagContacts] = useState<AutoAccountContact[]>([])
  const [akaBizContactTags, setAkaBizContactTags] = useState<AkaBizContactTag[]>([])
  const [zaloTagFilterIds, setZaloTagFilterIds] = useState<string[]>([])
  const [akaBizTagFilterIds, setAkaBizTagFilterIds] = useState<number[]>([])
  const [zaloNoTagFilter, setZaloNoTagFilter] = useState(false)
  const [akaBizNoTagFilter, setAkaBizNoTagFilter] = useState(false)
  const [zaloTagFilterDropdownOpen, setZaloTagFilterDropdownOpen] = useState(false)
  const [akaBizTagFilterDropdownOpen, setAkaBizTagFilterDropdownOpen] = useState(false)
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const [progressExpanded, setProgressExpanded] = useState(true)
  const [minimized, setMinimized] = useState(false)
  const [contactGroups, setContactGroups] = useState<AutoAccountContactGroup[]>([])
  const [allContactGroups, setAllContactGroups] = useState<AutoAccountContactGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [showAddGroupModal, setShowAddGroupModal] = useState(false)
  const [showNewGroupInput, setShowNewGroupInput] = useState(false)
  const [modalSelectedGroupIds, setModalSelectedGroupIds] = useState<Set<number>>(new Set())
  const [savingGroupMembers, setSavingGroupMembers] = useState(false)
  const [showGroupPanel, setShowGroupPanel] = useState(initialShowGroupPanel)
  const [showGroupSelectionModal, setShowGroupSelectionModal] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null)
  const [groupContacts, setGroupContacts] = useState<AutoAccountContact[]>([])
  const [groupContactsLoading, setGroupContactsLoading] = useState(false)
  const [groupContactCache, setGroupContactCache] = useState<Record<number, AutoAccountContact[]>>({})

  const availableActions = useMemo(
    () => getAvailableDataScanActions(allowedActions, entitlements),
    [allowedActions, entitlements]
  )
  const actionDef = useMemo(
    () => DATA_SCAN_ACTIONS.find(item => item.id === action) || DATA_SCAN_ACTIONS[0],
    [action]
  )
  const canSwitchLockedAction = !!allowedActions?.length && availableActions.length > 1
  const isPostCommentersAction = action === POST_COMMENTERS_ACTION_ID
  const isPostLikesAction = action === POST_LIKES_ACTION_ID
  const isProfileFriendsAction = action === PROFILE_FRIENDS_ACTION_ID
  const isGroupMembersAction = action === GROUP_MEMBERS_ACTION_ID
  const isPageInboxAction = action === PAGE_INBOX_CUSTOMERS_ACTION_ID
  const isZaloGroupMembersAction = action === ZALO_GROUP_MEMBERS_ACTION_ID
  const isZaloRemarketingCustomersAction = action === ZALO_REMARKETING_CUSTOMERS_ACTION_ID
  const supportsContactGroups = !isPageInboxAction && !isZaloRemarketingCustomersAction
  const normalizedPostCommentersUrl = useMemo(
    () => normalizeFacebookPostUrlForCompare(postCommentersUrl),
    [postCommentersUrl]
  )
  const normalizedPostLikesUrl = useMemo(
    () => normalizeFacebookPostUrlForCompare(postLikesUrl),
    [postLikesUrl]
  )
  const normalizedProfileFriendsUrl = useMemo(
    () => normalizeFacebookProfileUrlForCompare(profileFriendsUrl),
    [profileFriendsUrl]
  )
  const normalizedGroupMembersUrl = useMemo(
    () => normalizeFacebookGroupUrlForCompare(groupMembersUrl),
    [groupMembersUrl]
  )
  const selectedAccount = useMemo(
    () => accounts.find(account => account.id === accountId),
    [accounts, accountId]
  )
  const platformAccounts = useMemo(
    () => accounts.filter(account => account.flatformType === actionDef.platform),
    [accounts, actionDef.platform]
  )
  const selectedPlatform = (selectedAccount?.flatformType || actionDef.platform) as DataScanPlatform
  const showGroupApprovalColumn = actionDef.contactType === 'group' && actionDef.platform === 'facebook'
  const showAvatarColumn = actionDef.platform === 'zalo' && !isZaloRemarketingCustomersAction
  const showLinkColumn = !isPageInboxAction && (actionDef.platform === 'facebook' || actionDef.id === 'zalo_groups')
  const showZaloGroupMemberCountColumn = actionDef.id === 'zalo_groups'
  const showGroupMemberRoleColumn = isZaloGroupMembersAction
  const showFriendStatusColumn = actionDef.contactType === 'person' && !isZaloGroupMembersAction && !isZaloRemarketingCustomersAction
  const showZaloPhoneColumn = actionDef.platform === 'zalo' && !isZaloRemarketingCustomersAction
  const showZaloTagColumn = actionDef.platform === 'zalo'
  const showAkaBizTagColumn = actionDef.platform === 'zalo'
  const statusFilterOptions = useMemo(
    () => getStatusFilterOptions(actionDef.contactType),
    [actionDef.contactType]
  )
  const hasStatusFilter = !isZaloGroupMembersAction && !isZaloRemarketingCustomersAction && (actionDef.contactType === 'person' || actionDef.contactType === 'group')
  const selectedPageInboxPage = useMemo(
    () => pageInboxPages.find(page => page.uid === pageInboxPageUid) || null,
    [pageInboxPageUid, pageInboxPages]
  )
  const pageInboxPageCount = Math.max(1, Math.ceil(pageInboxTotal / PAGE_INBOX_PAGE_SIZE))
  const joinedZaloGroupOptions = useMemo(
    () => zaloGroupOptions.filter(group => group.isJoined === true),
    [zaloGroupOptions]
  )
  const linkedZaloGroupOptions = useMemo(
    () => zaloGroupOptions.filter(group => !!getZaloGroupContactLink(group)),
    [zaloGroupOptions]
  )
  const akaBizTagNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const tag of akaBizContactTags) map.set(tag.id, tag.name)
    return map
  }, [akaBizContactTags])
  const zaloTagNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const tag of zaloTagContacts) {
      const uid = String(tag.uid || '').trim()
      if (uid && tag.name) map.set(uid, tag.name)
    }
    return map
  }, [zaloTagContacts])
  const zaloTagFilterOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const tag of zaloTagContacts) {
      const id = String(tag.uid || '').trim()
      const name = String(tag.name || id).trim()
      if (id && !byId.has(id)) byId.set(id, name || id)
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }))
  }, [zaloTagContacts])
  const akaBizTagFilterOptions = useMemo(
    () => akaBizContactTags.map(tag => ({ id: tag.id, name: tag.name })),
    [akaBizContactTags]
  )
  const hasZaloTagFilters = actionDef.platform === 'zalo'
  const zaloTagFilterLabel = useMemo(() => {
    const selectedCount = zaloTagFilterIds.length + (zaloNoTagFilter ? 1 : 0)
    if (selectedCount === 0) return 'Tất cả'
    if (selectedCount === 1 && zaloNoTagFilter) return 'Chưa gắn tag'
    if (selectedCount === 1) {
      return zaloTagFilterOptions.find(option => option.id === zaloTagFilterIds[0])?.name || '1 tag đã chọn'
    }
    return `${selectedCount} lựa chọn`
  }, [zaloNoTagFilter, zaloTagFilterIds, zaloTagFilterOptions])
  const akaBizTagFilterLabel = useMemo(() => {
    const selectedCount = akaBizTagFilterIds.length + (akaBizNoTagFilter ? 1 : 0)
    if (selectedCount === 0) return 'Tất cả'
    if (selectedCount === 1 && akaBizNoTagFilter) return 'Chưa gắn tag'
    if (selectedCount === 1) {
      return akaBizTagFilterOptions.find(option => option.id === akaBizTagFilterIds[0])?.name || '1 tag đã chọn'
    }
    return `${selectedCount} lựa chọn`
  }, [akaBizNoTagFilter, akaBizTagFilterIds, akaBizTagFilterOptions])
  const zaloRemarketingActionFilterLabel = useMemo(() => {
    if (zaloRemarketingActionIds.length === 0) return 'Chọn hành động'
    if (zaloRemarketingActionIds.length === ZALO_REMARKETING_ACTION_FILTER_OPTIONS.length) {
      return 'Tất cả'
    }
    if (zaloRemarketingActionIds.length === 1) {
      return ZALO_REMARKETING_ACTION_FILTER_OPTIONS.find(option => option.value === zaloRemarketingActionIds[0])?.label || '1 hành động đã chọn'
    }
    return `${zaloRemarketingActionIds.length} hành động đã chọn`
  }, [zaloRemarketingActionIds])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const loadAkaBizContactTags = useCallback(async () => {
    if (!window.electronAPI?.listAkaBizContactTags) return
    try {
      const rows = await window.electronAPI.listAkaBizContactTags()
      if (mountedRef.current) setAkaBizContactTags(rows)
    } catch (err: any) {
      console.error('Failed to load akaBiz contact tags:', err)
      if (mountedRef.current) showAlert(err?.message || 'Không thể tải tag akaBiz.', 'error')
    }
  }, [showAlert])

  useEffect(() => {
    void loadAkaBizContactTags()
    const handleAkaBizContactTagsUpdated = () => void loadAkaBizContactTags()
    window.addEventListener('akabiz-contact-tags-updated', handleAkaBizContactTagsUpdated)
    return () => window.removeEventListener('akabiz-contact-tags-updated', handleAkaBizContactTagsUpdated)
  }, [loadAkaBizContactTags])

  const loadZaloTagContacts = useCallback(async () => {
    if (!window.electronAPI?.listContacts || !accountId || actionDef.platform !== 'zalo') {
      setZaloTagContacts([])
      return
    }
    try {
      const rows = await window.electronAPI.listContacts(accountId, 'zalo_tag')
      if (mountedRef.current) setZaloTagContacts(rows)
    } catch (err: any) {
      console.error('Failed to load Zalo tags:', err)
      if (mountedRef.current) showAlert(err?.message || 'Không thể tải tag Zalo.', 'error')
    }
  }, [accountId, actionDef.platform, showAlert])

  useEffect(() => {
    void loadZaloTagContacts()
  }, [loadZaloTagContacts])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!zaloRemarketingActionDropdownOpen) return

    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!zaloRemarketingActionDropdownRef.current?.contains(event.target as Node)) {
        setZaloRemarketingActionDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [zaloRemarketingActionDropdownOpen])

  useEffect(() => {
    if (!zaloTagFilterDropdownOpen && !akaBizTagFilterDropdownOpen) return

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (zaloTagFilterDropdownOpen && !zaloTagFilterDropdownRef.current?.contains(target)) {
        setZaloTagFilterDropdownOpen(false)
      }
      if (akaBizTagFilterDropdownOpen && !akaBizTagFilterDropdownRef.current?.contains(target)) {
        setAkaBizTagFilterDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [akaBizTagFilterDropdownOpen, zaloTagFilterDropdownOpen])

  useEffect(() => {
    if (actionDef.platform !== 'zalo') {
      setZaloTagFilterIds([])
      setAkaBizTagFilterIds([])
      setZaloNoTagFilter(false)
      setAkaBizNoTagFilter(false)
      setZaloTagFilterDropdownOpen(false)
      setAkaBizTagFilterDropdownOpen(false)
    }
  }, [actionDef.platform])

  useEffect(() => {
    const availableIds = new Set(zaloTagFilterOptions.map(option => option.id))
    setZaloTagFilterIds(prev => prev.filter(id => availableIds.has(id)))
  }, [zaloTagFilterOptions])

  useEffect(() => {
    const availableIds = new Set(akaBizTagFilterOptions.map(option => option.id))
    setAkaBizTagFilterIds(prev => prev.filter(id => availableIds.has(id)))
  }, [akaBizTagFilterOptions])

  useEffect(() => {
    if (accountId !== '') return
    const preferred = initialAccountId
      ? accounts.find(account => account.id === initialAccountId && account.flatformType === actionDef.platform)
      : accounts.find(account => account.flatformType === actionDef.platform)
    if (preferred) setAccountId(preferred.id)
  }, [accountId, accounts, actionDef.platform, initialAccountId])

  useEffect(() => {
    if (accountId === '') return
    const current = accounts.find(account => account.id === accountId)
    if (!current || current.flatformType === actionDef.platform) return
    const preferred = accounts.find(account => account.flatformType === actionDef.platform)
    setAccountId(preferred?.id || '')
  }, [accountId, accounts, actionDef.platform])

  useEffect(() => {
    if (availableActions.length === 0) return
    if (!availableActions.some(item => item.id === action)) {
      setAction(availableActions[0].id)
    }
  }, [action, availableActions])

  const getAccountContactListQuery = useCallback((overrides: Partial<AccountContactListQuery> = {}): AccountContactListQuery => ({
    contactType: actionDef.contactType,
    statusFilter: hasStatusFilter ? statusFilter : 'all',
    search,
    source: isPostCommentersAction
      ? 'facebook_post_commenters'
      : isPostLikesAction
        ? 'facebook_post_likes'
        : isGroupMembersAction
          ? 'facebook_group_members'
          : undefined,
    sourcePostUrl: isPostCommentersAction
      ? normalizedPostCommentersUrl
      : isPostLikesAction
        ? normalizedPostLikesUrl
        : undefined,
    sourceProfileUrl: isProfileFriendsAction ? normalizedProfileFriendsUrl : undefined,
    sourceGroupUrl: isGroupMembersAction ? normalizedGroupMembersUrl : undefined,
    ...(hasZaloTagFilters ? { zaloTagIds: zaloTagFilterIds, zaloNoTag: zaloNoTagFilter, akaBizTagIds: akaBizTagFilterIds, akaBizNoTag: akaBizNoTagFilter } : {}),
    ...overrides
  }), [actionDef.contactType, akaBizNoTagFilter, akaBizTagFilterIds, hasStatusFilter, hasZaloTagFilters, isGroupMembersAction, isPostCommentersAction, isPostLikesAction, isProfileFriendsAction, normalizedGroupMembersUrl, normalizedPostCommentersUrl, normalizedPostLikesUrl, normalizedProfileFriendsUrl, search, statusFilter, zaloNoTagFilter, zaloTagFilterIds])

  const getZaloGroupMemberListQuery = useCallback((overrides: Partial<ZaloGroupMemberContactListQuery> = {}): ZaloGroupMemberContactListQuery => ({
    zaloGroupId: zaloGroupMemberGroupId,
    search,
    ...(hasZaloTagFilters ? { zaloTagIds: zaloTagFilterIds, zaloNoTag: zaloNoTagFilter, akaBizTagIds: akaBizTagFilterIds, akaBizNoTag: akaBizNoTagFilter } : {}),
    ...overrides
  }), [akaBizNoTagFilter, akaBizTagFilterIds, hasZaloTagFilters, search, zaloGroupMemberGroupId, zaloNoTagFilter, zaloTagFilterIds])

  const getZaloRemarketingListQuery = useCallback((overrides: Partial<ZaloRemarketingCustomerListQuery> = {}): ZaloRemarketingCustomerListQuery => ({
    campaignActionIds: zaloRemarketingActionIds,
    dateFrom: zaloRemarketingDateFrom,
    dateTo: zaloRemarketingDateTo,
    search,
    ...(hasZaloTagFilters ? { zaloTagIds: zaloTagFilterIds, zaloNoTag: zaloNoTagFilter, akaBizTagIds: akaBizTagFilterIds, akaBizNoTag: akaBizNoTagFilter } : {}),
    ...overrides
  }), [akaBizNoTagFilter, akaBizTagFilterIds, hasZaloTagFilters, search, zaloRemarketingActionIds, zaloRemarketingDateFrom, zaloRemarketingDateTo, zaloNoTagFilter, zaloTagFilterIds])

  const resetPagedContactSelection = useCallback(() => {
    setSelectedIds(new Set())
    setPageInboxSelectAllMatching(false)
    setPageInboxSelectedRange(null)
    setPageInboxExcludedIds(new Set())
  }, [])

  const loadZaloGroupMemberContactsForGroup = useCallback(async (groupId: string) => {
    if (!window.electronAPI || !accountId || !groupId) {
      setContacts([])
      setPageInboxTotal(0)
      return
    }
    setLoading(true)
    try {
      setPageInboxPage(1)
      const result = await window.electronAPI.listZaloGroupMemberContacts(accountId, getZaloGroupMemberListQuery({
        zaloGroupId: groupId,
        limit: PAGE_INBOX_PAGE_SIZE,
        offset: 0
      }))
      if (!mountedRef.current) return
      setContacts(result.contacts)
      setPageInboxTotal(result.total)
      setGroupContactCache({})
    } catch (err: any) {
      console.error('Failed to load Zalo group members:', err)
      if (mountedRef.current) {
        showAlert(err?.message || 'Không thể tải danh sách thành viên group Zalo.', 'error')
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [accountId, getZaloGroupMemberListQuery, showAlert])

  const findLinkedZaloGroupByLink = useCallback((link: string) => {
    const normalized = normalizeZaloGroupLink(link)
    if (!normalized) return null
    return linkedZaloGroupOptions.find(group => getZaloGroupContactLink(group) === normalized) || null
  }, [linkedZaloGroupOptions])

  const applyZaloGroupMemberLink = useCallback((value: unknown) => {
    const normalizedLink = extractZaloGroupLink(value)
    if (!normalizedLink) return ''
    const matchedGroup = findLinkedZaloGroupByLink(normalizedLink)
    setZaloGroupMemberMode('group_link')
    setZaloGroupMemberLink(normalizedLink)
    setZaloGroupMemberGroupId(matchedGroup?.uid || '')
    setSelectedIds(new Set())
    return normalizedLink
  }, [findLinkedZaloGroupByLink])

  const decodeZaloQrImage = useCallback(async (file: File | null | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showAlert('Vui lòng chọn ảnh QR hợp lệ.', 'error')
      return
    }
    setZaloQrReading(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const image = await loadImageFromDataUrl(dataUrl)
      const link = applyZaloGroupMemberLink(decodeQrDataFromImage(image))
      if (!link) {
        showAlert('Ảnh QR không chứa link group Zalo hợp lệ.', 'error')
        return
      }
      showAlert('Đã nhận link group từ QR.', 'success')
    } catch (err: any) {
      showAlert(err?.message || 'Không thể đọc ảnh QR.', 'error')
    } finally {
      if (mountedRef.current) setZaloQrReading(false)
    }
  }, [applyZaloGroupMemberLink, showAlert])

  const handleZaloQrFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    void decodeZaloQrImage(file)
  }, [decodeZaloQrImage])

  const handleZaloGroupLinkPaste = useCallback((event: ClipboardEvent<HTMLInputElement>) => {
    const item = Array.from(event.clipboardData.items).find(clipboardItem => clipboardItem.type.startsWith('image/'))
    if (!item) return
    event.preventDefault()
    void decodeZaloQrImage(item.getAsFile())
  }, [decodeZaloQrImage])

  const toggleZaloRemarketingActionFilter = useCallback((actionId: string) => {
    setZaloRemarketingActionIds(prev => {
      const checked = prev.includes(actionId)
      if (!checked) return [...prev, actionId]
      return prev.filter(item => item !== actionId)
    })
  }, [])

  const toggleAllZaloRemarketingActionFilters = useCallback(() => {
    setZaloRemarketingActionIds(prev => (
      prev.length === ZALO_REMARKETING_ACTION_FILTER_OPTIONS.length
        ? []
        : [...DEFAULT_ZALO_REMARKETING_ACTION_IDS]
    ))
  }, [])

  const toggleZaloTagFilter = useCallback((tagId: string) => {
    setZaloTagFilterIds(prev => (
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    ))
  }, [])

  const toggleAkaBizTagFilter = useCallback((tagId: number) => {
    setAkaBizTagFilterIds(prev => (
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    ))
  }, [])

  const loadZaloRemarketingCustomers = useCallback(async () => {
    if (!window.electronAPI || !accountId) {
      setContacts([])
      setPageInboxTotal(0)
      return null
    }
    if (zaloRemarketingActionIds.length === 0) {
      showAlert('Vui lòng chọn ít nhất một hành động gửi tin nhắn.', 'error')
      return null
    }
    if (zaloRemarketingDateFrom && zaloRemarketingDateTo && zaloRemarketingDateFrom > zaloRemarketingDateTo) {
      showAlert('Từ ngày phải nhỏ hơn hoặc bằng đến ngày.', 'error')
      return null
    }
    const loadId = contactsLoadIdRef.current + 1
    contactsLoadIdRef.current = loadId
    setLoading(true)
    try {
      const result = await window.electronAPI.listZaloRemarketingCustomers(accountId, {
        ...getZaloRemarketingListQuery(),
        limit: PAGE_INBOX_PAGE_SIZE,
        offset: (pageInboxPage - 1) * PAGE_INBOX_PAGE_SIZE
      })
      if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return null
      setContacts(result.contacts)
      setPageInboxTotal(result.total)
      setGroupContactCache({})
      return result.total
    } catch (err: any) {
      console.error('Failed to load Zalo remarketing customers:', err)
      if (mountedRef.current && contactsLoadIdRef.current === loadId) {
        showAlert(err?.message || 'Không thể tải danh sách khách hàng cũ Zalo.', 'error')
      }
      return null
    } finally {
      if (mountedRef.current && contactsLoadIdRef.current === loadId) {
        setLoading(false)
      }
    }
  }, [
    accountId,
    getZaloRemarketingListQuery,
    pageInboxPage,
    showAlert,
    zaloRemarketingActionIds,
    zaloRemarketingDateFrom,
    zaloRemarketingDateTo
  ])

  const loadCachedContacts = useCallback(async (pageOverride?: number, pageInboxFiltersOverride?: PageInboxAppliedFilters) => {
    if (!window.electronAPI || !accountId) {
      contactsLoadIdRef.current += 1
      setContacts([])
      setPageInboxTotal(0)
      setLoading(false)
      return
    }
    const pageToLoad = pageOverride ?? pageInboxPage
    const loadId = contactsLoadIdRef.current + 1
    contactsLoadIdRef.current = loadId
    setLoading(true)
    try {
      if (isPageInboxAction) {
        const pageInboxFilters = pageInboxFiltersOverride || pageInboxAppliedFilters
        if (!pageInboxFilters.pageUid) {
          if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
          setContacts([])
          setPageInboxTotal(0)
          return
        }
        const result = await window.electronAPI.listPageInboxContacts(accountId, {
          pageUid: pageInboxFilters.pageUid,
          search: pageInboxFilters.search,
          phoneFilter: pageInboxFilters.phoneFilter,
          dateFrom: pageInboxFilters.dateFrom,
          dateTo: pageInboxFilters.dateTo,
          messageFilterMode: pageInboxFilters.messageFilterMode,
          messageKeywords: pageInboxFilters.messageKeywords,
          limit: PAGE_INBOX_PAGE_SIZE,
          offset: (pageToLoad - 1) * PAGE_INBOX_PAGE_SIZE
        })
        if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
        setContacts(result.contacts)
        setPageInboxTotal(result.total)
      } else if (isZaloGroupMembersAction) {
        if (!zaloGroupMemberGroupId) {
          if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
          setContacts([])
          setPageInboxTotal(0)
          return
        }
        const result = await window.electronAPI.listZaloGroupMemberContacts(accountId, {
          ...getZaloGroupMemberListQuery(),
          limit: PAGE_INBOX_PAGE_SIZE,
          offset: (pageToLoad - 1) * PAGE_INBOX_PAGE_SIZE
        })
        if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
        setContacts(result.contacts)
        setPageInboxTotal(result.total)
      } else if (isZaloRemarketingCustomersAction) {
        const result = await window.electronAPI.listZaloRemarketingCustomers(accountId, {
          ...getZaloRemarketingListQuery(),
          limit: PAGE_INBOX_PAGE_SIZE,
          offset: (pageToLoad - 1) * PAGE_INBOX_PAGE_SIZE
        })
        if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
        setContacts(result.contacts)
        setPageInboxTotal(result.total)
      } else {
        if (isPostCommentersAction && !normalizedPostCommentersUrl) {
          if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
          setContacts([])
          setPageInboxTotal(0)
          return
        }
        if (isPostLikesAction && !normalizedPostLikesUrl) {
          if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
          setContacts([])
          setPageInboxTotal(0)
          return
        }
        if (isProfileFriendsAction && !normalizedProfileFriendsUrl) {
          if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
          setContacts([])
          setPageInboxTotal(0)
          return
        }
        if (isGroupMembersAction && !normalizedGroupMembersUrl) {
          if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
          setContacts([])
          setPageInboxTotal(0)
          return
        }
        const result = await window.electronAPI.listContactsPage(accountId, {
          ...getAccountContactListQuery(),
          limit: PAGE_INBOX_PAGE_SIZE,
          offset: (pageToLoad - 1) * PAGE_INBOX_PAGE_SIZE
        })
        if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
        setContacts(result.contacts)
        setPageInboxTotal(result.total)
      }
      setGroupContactCache({})
    } catch (err: any) {
      console.error('Failed to load scan contacts:', err)
      if (mountedRef.current && contactsLoadIdRef.current === loadId) {
        showAlert(err?.message || 'Không thể tải danh sách data.', 'error')
      }
    } finally {
      if (mountedRef.current && contactsLoadIdRef.current === loadId) {
        setLoading(false)
      }
    }
  }, [
    accountId,
    actionDef.contactType,
    getAccountContactListQuery,
    getZaloGroupMemberListQuery,
    getZaloRemarketingListQuery,
    isPageInboxAction,
    isGroupMembersAction,
    isPostCommentersAction,
    isPostLikesAction,
    isProfileFriendsAction,
    isZaloGroupMembersAction,
    isZaloRemarketingCustomersAction,
    normalizedPostCommentersUrl,
    normalizedGroupMembersUrl,
    normalizedPostLikesUrl,
    normalizedProfileFriendsUrl,
    pageInboxAppliedFilters,
    pageInboxPage,
    showAlert,
    zaloGroupMemberGroupId
  ])

  const loadContactGroups = useCallback(async () => {
    if (!window.electronAPI || !accountId) {
      setContactGroups([])
      setAllContactGroups([])
      setActiveGroupId(null)
      return
    }
    if (!supportsContactGroups) {
      setContactGroups([])
      setAllContactGroups([])
      setActiveGroupId(null)
      return
    }
    setGroupsLoading(true)
    try {
      const [groups, allGroups] = await Promise.all([
        window.electronAPI.listContactGroups(accountId, actionDef.contactType),
        window.electronAPI.listContactGroups(accountId)
      ])
      setContactGroups(groups)
      setAllContactGroups(allGroups)
      setActiveGroupId(prev => prev && allGroups.some(group => group.id === prev) ? prev : allGroups[0]?.id || null)
    } catch (err: any) {
      console.error('Failed to load contact groups:', err)
      showAlert(err?.message || 'Không thể tải danh sách nhóm data.', 'error')
    } finally {
      setGroupsLoading(false)
    }
  }, [accountId, actionDef.contactType, showAlert, supportsContactGroups])

  const loadContactsForGroup = useCallback(async (groupId: number, force = false): Promise<AutoAccountContact[]> => {
    if (!window.electronAPI) return []
    if (!force && groupContactCache[groupId]) return groupContactCache[groupId]
    const data = await window.electronAPI.listContactGroupContacts(groupId)
    setGroupContactCache(prev => ({ ...prev, [groupId]: data }))
    return data
  }, [groupContactCache])

  const handleManagedContactGroupsChanged = useCallback(async () => {
    if (!window.electronAPI || !accountId || !supportsContactGroups) {
      setSelectedGroupIds(new Set())
      setGroupContactCache({})
      await loadContactGroups()
      return
    }

    setGroupsLoading(true)
    try {
      const [groups, allGroups] = await Promise.all([
        window.electronAPI.listContactGroups(accountId, actionDef.contactType),
        window.electronAPI.listContactGroups(accountId)
      ])
      const currentGroupIds = new Set(groups.map(group => group.id))
      const nextSelectedGroupIds = Array.from(selectedGroupIds).filter(groupId => currentGroupIds.has(groupId))
      const nextGroupContactCache: Record<number, AutoAccountContact[]> = {}
      await Promise.all(nextSelectedGroupIds.map(async groupId => {
        nextGroupContactCache[groupId] = await window.electronAPI.listContactGroupContacts(groupId)
      }))

      setContactGroups(groups)
      setAllContactGroups(allGroups)
      setActiveGroupId(prev => prev && allGroups.some(group => group.id === prev) ? prev : allGroups[0]?.id || null)
      setSelectedGroupIds(new Set(nextSelectedGroupIds))
      setGroupContactCache(nextGroupContactCache)
    } catch (err: any) {
      console.error('Failed to refresh managed contact groups:', err)
      showAlert(err?.message || 'Không thể tải lại nhóm data sau khi cập nhật.', 'error')
    } finally {
      setGroupsLoading(false)
    }
  }, [accountId, actionDef.contactType, loadContactGroups, selectedGroupIds, showAlert, supportsContactGroups])

  useEffect(() => {
    pageInboxPageUidRef.current = pageInboxPageUid
  }, [pageInboxPageUid])

  const getPageInboxDraftFilters = useCallback((overrides: Partial<PageInboxAppliedFilters> = {}): PageInboxAppliedFilters => ({
    pageUid: pageInboxPageUid,
    search: search.trim(),
    phoneFilter: pageInboxPhoneFilter,
    dateFrom: pageInboxDateFrom,
    dateTo: pageInboxDateTo,
    messageFilterMode: pageInboxMessageFilterMode,
    messageKeywords: pageInboxMessageKeywords,
    ...overrides
  }), [
    pageInboxDateFrom,
    pageInboxDateTo,
    pageInboxMessageFilterMode,
    pageInboxMessageKeywords,
    pageInboxPageUid,
    pageInboxPhoneFilter,
    search
  ])

  const applyPageInboxDraftFilters = useCallback((overrides: Partial<PageInboxAppliedFilters> = {}) => {
    const nextFilters = getPageInboxDraftFilters(overrides)
    setSelectedIds(new Set())
    setPageInboxSelectAllMatching(false)
    setPageInboxSelectedRange(null)
    setPageInboxExcludedIds(new Set())
    setPageInboxPage(1)
    setPageInboxAppliedFilters(prev => arePageInboxFiltersEqual(prev, nextFilters) ? prev : nextFilters)
    return nextFilters
  }, [getPageInboxDraftFilters])

  const refreshPageInboxContactsAfterScan = useCallback(async () => {
    const nextFilters = applyPageInboxDraftFilters()
    await loadCachedContacts(1, nextFilters)
  }, [applyPageInboxDraftFilters, loadCachedContacts])

  useEffect(() => {
    if (!isPageInboxAction) return
    const nextFilters = getPageInboxDraftFilters()
    const timer = window.setTimeout(() => {
      setSelectedIds(new Set())
      setPageInboxSelectAllMatching(false)
      setPageInboxSelectedRange(null)
      setPageInboxExcludedIds(new Set())
      setPageInboxPage(1)
      setPageInboxAppliedFilters(prev => arePageInboxFiltersEqual(prev, nextFilters) ? prev : nextFilters)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [
    getPageInboxDraftFilters,
    isPageInboxAction,
    pageInboxDateFrom,
    pageInboxDateTo,
    pageInboxMessageFilterMode,
    pageInboxMessageKeywords,
    pageInboxPageUid,
    pageInboxPhoneFilter,
    search
  ])

  useEffect(() => {
    setSelectedIds(new Set())
    setSelectedGroupIds(new Set())
    setModalSelectedGroupIds(new Set())
    setStatusFilter((isPostCommentersAction || isPostLikesAction || isProfileFriendsAction || isGroupMembersAction) ? 'all' : (hasStatusFilter ? (initialStatusFilter || 'active') : 'all'))
    setNewGroupName('')
    setShowNewGroupInput(false)
    setShowAddGroupModal(false)
    setShowGroupPanel(initialShowGroupPanel)
    setShowGroupSelectionModal(false)
    setActiveGroupId(null)
    setGroupContacts([])
    setGroupContactCache({})
    setAllContactGroups([])
    setPageInboxPage(1)
    setPageInboxSelectAllMatching(false)
    setPageInboxSelectedRange(null)
    setPageInboxExcludedIds(new Set())
    if (action === PAGE_INBOX_CUSTOMERS_ACTION_ID) {
      const defaults = getDefaultPageInboxAppliedFilters()
      setPageInboxTimePreset(DEFAULT_PAGE_INBOX_TIME_PRESET)
      setPageInboxPhoneFilter(defaults.phoneFilter)
      setPageInboxDateFrom(defaults.dateFrom)
      setPageInboxDateTo(defaults.dateTo)
      setPageInboxMessageFilterMode(defaults.messageFilterMode)
      setPageInboxMessageKeywords(defaults.messageKeywords)
      setPageInboxAppliedFilters(defaults)
    }
    if (action === ZALO_REMARKETING_CUSTOMERS_ACTION_ID) {
      const defaults = getPageInboxDateRange('7_days')
      setZaloRemarketingActionIds([...DEFAULT_ZALO_REMARKETING_ACTION_IDS])
      setZaloRemarketingActionDropdownOpen(false)
      setZaloRemarketingDateFrom(defaults.fromDate)
      setZaloRemarketingDateTo(defaults.toDate)
    }
  }, [action, hasStatusFilter, initialShowGroupPanel, initialStatusFilter, isGroupMembersAction, isPostCommentersAction, isPostLikesAction, isProfileFriendsAction])

  useEffect(() => {
    if (!isZaloRemarketingCustomersAction) return
    setContacts([])
    setSelectedIds(new Set())
  }, [
    accountId,
    akaBizNoTagFilter,
    akaBizTagFilterIds,
    isZaloRemarketingCustomersAction,
    zaloRemarketingActionIds,
    zaloRemarketingDateFrom,
    zaloRemarketingDateTo,
    zaloNoTagFilter,
    zaloTagFilterIds
  ])

  useEffect(() => {
    setPageInboxPage(1)
    setSelectedIds(new Set())
    setPageInboxSelectAllMatching(false)
    setPageInboxSelectedRange(null)
    setPageInboxExcludedIds(new Set())
  }, [
    search,
    statusFilter,
    normalizedPostCommentersUrl,
    normalizedPostLikesUrl,
    normalizedProfileFriendsUrl,
    normalizedGroupMembersUrl,
    akaBizNoTagFilter,
    akaBizTagFilterIds,
    zaloGroupMemberGroupId,
    zaloRemarketingActionIds,
    zaloRemarketingDateFrom,
    zaloRemarketingDateTo,
    zaloNoTagFilter,
    zaloTagFilterIds
  ])

  useEffect(() => {
    loadCachedContacts()
  }, [loadCachedContacts])

  useEffect(() => {
    loadContactGroups()
  }, [loadContactGroups])

  useEffect(() => {
    let cancelled = false
    async function loadPageOptions() {
      if (!window.electronAPI || !accountId || !isPageInboxAction) {
        setPageInboxPages([])
        setPageInboxPageUid('')
        pageInboxPageUidRef.current = ''
        pageInboxOptionsAccountRef.current = ''
        setPageInboxSelectAllMatching(false)
        setPageInboxSelectedRange(null)
        setPageInboxExcludedIds(new Set())
        return
      }
      try {
        const accountChanged = pageInboxOptionsAccountRef.current !== accountId
        const pages = await window.electronAPI.listContacts(accountId, 'page')
        if (cancelled) return
        pageInboxOptionsAccountRef.current = accountId
        setPageInboxPages(pages)
        const firstPageUid = pages[0]?.uid || ''
        const currentPageUid = pageInboxPageUidRef.current
        const nextPageUid = !accountChanged && currentPageUid && pages.some(page => page.uid === currentPageUid)
          ? currentPageUid
          : firstPageUid
        setPageInboxPageUid(nextPageUid)
        setSelectedIds(new Set())
        setPageInboxSelectAllMatching(false)
        setPageInboxSelectedRange(null)
        setPageInboxExcludedIds(new Set())
        setPageInboxPage(1)
        setPageInboxAppliedFilters(prev => ({ ...prev, pageUid: nextPageUid }))
      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to load page options for inbox scan:', err)
          showAlert(err?.message || 'Không thể tải danh sách page.', 'error')
        }
      }
    }
    loadPageOptions()
    return () => {
      cancelled = true
    }
  }, [accountId, isPageInboxAction, showAlert])

  const loadZaloGroupOptions = useCallback(async () => {
    if (!window.electronAPI || !accountId || !isZaloGroupMembersAction) {
      setZaloGroupOptions([])
      setZaloGroupMemberGroupId('')
      return
    }
    try {
      const groups = await window.electronAPI.exportContactsPage(accountId, { contactType: 'group' })
      const zaloGroups = groups.filter(group => group.extraData?.platform === 'zalo')
      setZaloGroupOptions(zaloGroups)
    } catch (err: any) {
      console.error('Failed to load Zalo group options:', err)
      showAlert(err?.message || 'Không thể tải danh sách group Zalo.', 'error')
    }
  }, [accountId, isZaloGroupMembersAction, showAlert])

  useEffect(() => {
    void loadZaloGroupOptions()
  }, [loadZaloGroupOptions])

  useEffect(() => {
    if (!isZaloGroupMembersAction) return
    if (zaloGroupMemberMode === 'joined_group') {
      setZaloGroupMemberGroupId(prev => (
        prev && joinedZaloGroupOptions.some(group => group.uid === prev)
          ? prev
          : joinedZaloGroupOptions[0]?.uid || ''
      ))
      return
    }

    const normalizedLink = normalizeZaloGroupLink(zaloGroupMemberLink)
    const matchedGroup = normalizedLink
      ? linkedZaloGroupOptions.find(group => getZaloGroupContactLink(group) === normalizedLink)
      : null

    setZaloGroupMemberGroupId(prev => {
      if (prev && linkedZaloGroupOptions.some(group => group.uid === prev)) return prev
      if (matchedGroup?.uid) return matchedGroup.uid
      return normalizedLink ? prev : ''
    })
  }, [
    isZaloGroupMembersAction,
    joinedZaloGroupOptions,
    linkedZaloGroupOptions,
    zaloGroupMemberLink,
    zaloGroupMemberMode
  ])

  useEffect(() => {
    let cancelled = false
    async function loadActiveGroupContacts() {
      if (!activeGroupId) {
        setGroupContacts([])
        return
      }
      setGroupContactsLoading(true)
      try {
        const data = await loadContactsForGroup(activeGroupId)
        if (!cancelled) setGroupContacts(data)
      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to load contacts in group:', err)
          showAlert(err?.message || 'Không thể tải data trong nhóm.', 'error')
        }
      } finally {
        if (!cancelled) setGroupContactsLoading(false)
      }
    }
    loadActiveGroupContacts()
    return () => {
      cancelled = true
    }
  }, [activeGroupId, loadContactsForGroup, showAlert])

  useEffect(() => {
    if (!window.electronAPI?.onContactsProgress) return
    const unsubscribe = window.electronAPI.onContactsProgress(({ accountId: progressAccountId, contactType, message }) => {
      if (progressAccountId !== undefined && accountId !== '' && progressAccountId !== accountId) return
      if (contactType !== undefined && contactType !== actionDef.contactType) return
      setProgressMessages(prev => [...prev.slice(-4), message])
    })
    return unsubscribe
  }, [accountId, actionDef.contactType])

  useEffect(() => {
    if (!window.electronAPI?.onContactsCompleted || accountId === '') return
    const unsubscribe = window.electronAPI.onContactsCompleted(({ accountId: completedAccountId, contactType, result }) => {
      if (completedAccountId !== accountId || contactType !== actionDef.contactType) return

      const scanId = scanRunIdRef.current
      if (scanId === 0) return
      if (completedScanIdsRef.current.has(scanId)) return

      const wasStopped = stoppedScanIdsRef.current.has(scanId) || result.stopped
      if (isPostCommentersAction) {
        const completedPostUrl = normalizeFacebookPostUrlForCompare(result.sourcePostUrl)
        if (!completedPostUrl || completedPostUrl !== normalizedPostCommentersUrl) return
      }
      if (isPostLikesAction) {
        const completedPostUrl = normalizeFacebookPostUrlForCompare(result.sourcePostUrl)
        if (!completedPostUrl || completedPostUrl !== normalizedPostLikesUrl) return
      }
      if (isProfileFriendsAction) {
        const completedProfileUrl = normalizeFacebookProfileUrlForCompare(result.sourceProfileUrl)
        if (!completedProfileUrl || completedProfileUrl !== normalizedProfileFriendsUrl) return
      }
      if (isGroupMembersAction) {
        const completedGroupUrl = normalizeFacebookGroupUrlForCompare(result.sourceGroupUrl)
        if (!completedGroupUrl || completedGroupUrl !== normalizedGroupMembersUrl) return
      }
      completedScanIdsRef.current.add(scanId)
      setScanLoading(false)
      setMinimized(false)
      if (isPostCommentersAction && result.sourcePostUrl) {
        setPostCommentersUrl(String(result.sourcePostUrl))
      }
      if (isPostLikesAction && result.sourcePostUrl) {
        setPostLikesUrl(String(result.sourcePostUrl))
      }
      if (isProfileFriendsAction && result.sourceProfileUrl) {
        setProfileFriendsUrl(String(result.sourceProfileUrl))
      }
      if (isGroupMembersAction && result.sourceGroupUrl) {
        setGroupMembersUrl(String(result.sourceGroupUrl))
      }
      if (isZaloGroupMembersAction && result.zaloGroupId) {
        setZaloGroupMemberGroupId(String(result.zaloGroupId))
      }
      if (result.success) {
        resetPagedContactSelection()
        setPageInboxPage(1)
      }
      if (isPageInboxAction) {
        void refreshPageInboxContactsAfterScan()
      } else if (isZaloGroupMembersAction && result.zaloGroupId) {
        loadZaloGroupMemberContactsForGroup(String(result.zaloGroupId))
        void loadZaloGroupOptions()
      } else {
        loadCachedContacts(result.success ? 1 : undefined)
      }
      loadContactGroups()

      if (!result.success) {
        if (!wasStopped) showAlert(result.error || 'Tải data thất bại.', 'error')
        return
      }
      if (!wasStopped) showAlert(`Đã tải ${result.count} data.`, 'success')
    })
    return unsubscribe
  }, [
    accountId,
    actionDef.contactType,
    isGroupMembersAction,
    isPageInboxAction,
    isPostCommentersAction,
    isPostLikesAction,
    isProfileFriendsAction,
    isZaloGroupMembersAction,
    loadCachedContacts,
    loadContactGroups,
    loadZaloGroupMemberContactsForGroup,
    loadZaloGroupOptions,
    refreshPageInboxContactsAfterScan,
    resetPagedContactSelection,
    normalizedGroupMembersUrl,
    normalizedPostCommentersUrl,
    normalizedPostLikesUrl,
    normalizedProfileFriendsUrl,
    showAlert
  ])

  const matchesStatusFilter = useCallback((contact: AutoAccountContact) => {
    if (isZaloGroupMembersAction) return true
    if (statusFilter === 'all') return true
    if (actionDef.contactType === 'person') {
      return statusFilter === 'active' ? contact.isFriend === true : contact.isFriend !== true
    }
    if (actionDef.contactType === 'group') {
      return statusFilter === 'active' ? contact.isJoined === true : contact.isJoined !== true
    }
    return true
  }, [actionDef.contactType, isZaloGroupMembersAction, statusFilter])

  const actionContacts = useMemo(() => {
    return contacts
  }, [contacts])

  const visibleContacts = useMemo(() => {
    return actionContacts
  }, [actionContacts])

  const filteredContacts = useMemo(() => {
    return visibleContacts
  }, [visibleContacts])

  const getContactRowNumber = useCallback((index: number) => (
    (pageInboxPage - 1) * PAGE_INBOX_PAGE_SIZE + index + 1
  ), [pageInboxPage])
  const isContactSelected = useCallback((contactId: number, rowNumber?: number) => {
    if (pageInboxSelectAllMatching) return !pageInboxExcludedIds.has(contactId)
    if (pageInboxSelectedRange && rowNumber !== undefined) {
      const inRange = rowNumber >= pageInboxSelectedRange.start && rowNumber <= pageInboxSelectedRange.end
      return inRange ? !pageInboxExcludedIds.has(contactId) : selectedIds.has(contactId)
    }
    return selectedIds.has(contactId)
  }, [
    pageInboxExcludedIds,
    pageInboxSelectAllMatching,
    pageInboxSelectedRange,
    selectedIds
  ])
  const allMatchingSelected = pageInboxTotal > 0 && pageInboxSelectAllMatching && pageInboxExcludedIds.size === 0
  const pagedSelectedCount = pageInboxSelectAllMatching
    ? Math.max(0, pageInboxTotal - pageInboxExcludedIds.size)
    : pageInboxSelectedRange
      ? Math.max(0, pageInboxSelectedRange.end - pageInboxSelectedRange.start + 1 - pageInboxExcludedIds.size) + selectedIds.size
      : selectedIds.size
  const currentTotalCount = pageInboxTotal
  const selectedGroupContacts = useMemo(() => {
    const rows: AutoAccountContact[] = []
    selectedGroupIds.forEach(groupId => {
      rows.push(...(groupContactCache[groupId] || []).filter(matchesStatusFilter))
    })
    return rows
  }, [groupContactCache, matchesStatusFilter, selectedGroupIds])
  const activeContactGroup = useMemo(
    () => allContactGroups.find(group => group.id === activeGroupId) || null,
    [activeGroupId, allContactGroups]
  )
  const activeGroupContactType = activeContactGroup?.contactType || actionDef.contactType
  const activeGroupShowApprovalColumn = activeGroupContactType === 'group' && selectedPlatform === 'facebook'
  const activeGroupShowAvatarColumn = selectedPlatform === 'zalo'
  const activeGroupShowLinkColumn = selectedPlatform === 'facebook' || (activeGroupContactType === 'group' && selectedPlatform === 'zalo')
  const activeGroupShowPhoneColumn = selectedPlatform === 'zalo'
  const activeGroupShowZaloTagColumn = selectedPlatform === 'zalo'
  const activeGroupShowAkaBizTagColumn = selectedPlatform === 'zalo'
  const groupContactsByStatus = useMemo(
    () => activeGroupContactType === actionDef.contactType ? groupContacts.filter(matchesStatusFilter) : groupContacts,
    [activeGroupContactType, actionDef.contactType, groupContacts, matchesStatusFilter]
  )
  const filteredGroupContacts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN')
    if (!query) return groupContactsByStatus
    return groupContactsByStatus.filter(contact => [
      contact.name,
      contact.uid,
      getContactPhoneText(contact),
      contact.url,
      getContactInfo(contact),
      getContactStatusLabel(contact),
      activeGroupShowZaloTagColumn ? formatContactZaloTags(contact, zaloTagNameById) : '',
      activeGroupShowAkaBizTagColumn ? formatContactAkaBizTags(contact, akaBizTagNameById) : '',
      showZaloGroupMemberCountColumn ? formatZaloGroupTotalMember(contact) : '',
      contact.contactType === 'group' && selectedPlatform === 'facebook' ? getGroupApprovalStatus(contact) : ''
    ].some(value => String(value || '').toLocaleLowerCase('vi-VN').includes(query)))
  }, [activeGroupShowAkaBizTagColumn, activeGroupShowZaloTagColumn, akaBizTagNameById, groupContactsByStatus, search, selectedPlatform, showZaloGroupMemberCountColumn, zaloTagNameById])
  const tableColSpan = isPageInboxAction
    ? 7
    : isZaloRemarketingCustomersAction
      ? 13 + (showZaloTagColumn ? 1 : 0) + (showAkaBizTagColumn ? 1 : 0)
    : 4
      + (showAvatarColumn ? 1 : 0)
      + (showZaloPhoneColumn ? 1 : 0)
      + (showZaloTagColumn ? 1 : 0)
      + (showAkaBizTagColumn ? 1 : 0)
      + (showFriendStatusColumn ? 1 : 0)
      + (actionDef.contactType === 'group' ? 1 : 0)
      + (showGroupApprovalColumn ? 1 : 0)
      + (showGroupMemberRoleColumn ? 1 : 0)
      + (showLinkColumn ? 1 : 0)
      + (showZaloGroupMemberCountColumn ? 1 : 0)
  const groupTableColSpan = 4
    + (activeGroupShowAvatarColumn ? 1 : 0)
    + (activeGroupShowPhoneColumn ? 1 : 0)
    + (activeGroupContactType === 'person' ? 1 : 0)
    + (activeGroupContactType === 'group' ? 1 : 0)
    + (activeGroupShowApprovalColumn ? 1 : 0)
    + (activeGroupShowLinkColumn ? 1 : 0)
    + (activeGroupShowZaloTagColumn ? 1 : 0)
    + (activeGroupShowAkaBizTagColumn ? 1 : 0)
  const currentRenderStart = currentTotalCount > 0 && filteredContacts.length > 0
    ? getContactRowNumber(0)
    : 0
  const currentRenderEnd = currentRenderStart > 0
    ? currentRenderStart + filteredContacts.length - 1
    : 0
  const currentRenderText = currentRenderStart > 0
    ? `Hiển thị ${formatCount(currentRenderStart)}-${formatCount(currentRenderEnd)}/${formatCount(currentTotalCount)} data`
    : `Hiển thị 0/${formatCount(currentTotalCount)} data`
  const effectiveSearchText = isPageInboxAction ? pageInboxAppliedFilters.search : search
  const emptyTableText = actionContacts.length === 0
    ? actionDef.emptyText
    : visibleContacts.length === 0 && effectiveSearchText.trim().length === 0
      ? 'Không có data phù hợp với bộ lọc.'
      : 'Không tìm thấy data phù hợp.'
  const canSaveGroupModal = modalSelectedGroupIds.size > 0 || (showNewGroupInput && newGroupName.trim().length > 0)

  const toggleContact = (id: number, rowNumber?: number) => {
    if (pageInboxSelectAllMatching) {
      setPageInboxExcludedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      return
    }

    if (pageInboxSelectedRange && rowNumber !== undefined) {
      const inRange = rowNumber >= pageInboxSelectedRange.start && rowNumber <= pageInboxSelectedRange.end
      if (inRange) {
        setPageInboxExcludedIds(prev => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        return
      }
    }

    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    if (pageInboxSelectAllMatching && pageInboxExcludedIds.size === 0) {
      handleClearPageInboxSelection()
    } else {
      handleSelectAllPageInboxMatching()
    }
  }

  const selectRange = async () => {
    if (currentTotalCount === 0) return
    const rawStart = Math.max(1, Math.floor(Number(rangeStart) || 1))
    const rawEnd = Math.max(1, Math.floor(Number(rangeEnd) || 1))
    const start = Math.min(rawStart, rawEnd)
    let end = Math.max(rawStart, rawEnd)
    if (start > currentTotalCount) {
      showAlert(`STT chỉ có từ 1 đến ${formatCount(currentTotalCount)}.`, 'error')
      setRangeStart(currentTotalCount)
      setRangeEnd(currentTotalCount)
      return
    }
    if (end > currentTotalCount) {
      end = currentTotalCount
    }
    setRangeStart(start)
    setRangeEnd(end)

    setPageInboxExcludedIds(new Set())
    setSelectedIds(new Set())
    if (start === 1 && end === pageInboxTotal) {
      setPageInboxSelectedRange(null)
      setPageInboxSelectAllMatching(true)
    } else {
      setPageInboxSelectAllMatching(false)
      setPageInboxSelectedRange({ start, end })
    }
  }

  const handlePageInboxTimePresetChange = (value: PageInboxTimePreset) => {
    const range = getPageInboxDateRange(value)
    setPageInboxTimePreset(value)
    setPageInboxDateFrom(range.fromDate)
    setPageInboxDateTo(range.toDate)
  }

  const handlePageInboxPageChange = (value: string) => {
    setPageInboxPageUid(value)
  }

  const handleSelectAllPageInboxMatching = () => {
    setSelectedIds(new Set())
    setPageInboxExcludedIds(new Set())
    setPageInboxSelectedRange(null)
    setPageInboxSelectAllMatching(true)
  }

  const handleClearPageInboxSelection = () => {
    setSelectedIds(new Set())
    setPageInboxExcludedIds(new Set())
    setPageInboxSelectedRange(null)
    setPageInboxSelectAllMatching(false)
  }

  const exportCurrentSelection = async (overrides: any = {}) => {
    if (!window.electronAPI || !accountId) return []
    if (isPageInboxAction) {
      return window.electronAPI.exportPageInboxContacts(accountId, {
        ...pageInboxAppliedFilters,
        ...overrides
      })
    }
    if (isZaloGroupMembersAction) {
      return window.electronAPI.exportZaloGroupMemberContacts(accountId, {
        ...getZaloGroupMemberListQuery(),
        ...overrides
      })
    }
    if (isZaloRemarketingCustomersAction) {
      return window.electronAPI.exportZaloRemarketingCustomers(accountId, {
        ...getZaloRemarketingListQuery(),
        ...overrides
      })
    }
    return window.electronAPI.exportContactsPage(accountId, {
      ...getAccountContactListQuery(),
      ...overrides
    })
  }

  const loadSelectedContacts = async () => {
    if (!window.electronAPI || !accountId) return []
    if (pageInboxSelectAllMatching) {
      return exportCurrentSelection({
        excludeIds: Array.from(pageInboxExcludedIds)
      })
    }
    if (pageInboxSelectedRange) {
      const rangeContacts = await exportCurrentSelection({
        excludeIds: Array.from(pageInboxExcludedIds),
        offset: pageInboxSelectedRange.start - 1,
        limit: pageInboxSelectedRange.end - pageInboxSelectedRange.start + 1
      })
      const extraIds = Array.from(selectedIds)
      if (extraIds.length === 0) return rangeContacts
      const extraContacts = await exportCurrentSelection({ ids: extraIds })
      return dedupeContacts([...rangeContacts, ...extraContacts])
    }
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return []
    return exportCurrentSelection({ ids })
  }

  const loadOutputContacts = async () => {
    const selectedContacts = await loadSelectedContacts()
    const rawContacts = [...selectedContacts, ...selectedGroupContacts]
    return dedupeOnOutput ? dedupeContacts(rawContacts) : rawContacts
  }

  const handleRenameContactGroup = async (group: AutoAccountContactGroup, name: string) => {
    if (!window.electronAPI) return
    const normalizedName = name.trim()
    if (!normalizedName || normalizedName === group.name) return
    try {
      const updated = await window.electronAPI.updateContactGroup(group.id, normalizedName)
      setContactGroups(prev => prev.map(item => item.id === group.id ? { ...item, ...updated } : item))
      setAllContactGroups(prev => prev.map(item => item.id === group.id ? { ...item, ...updated } : item))
      showAlert('Đã đổi tên nhóm data.', 'success')
    } catch (err: any) {
      console.error('Failed to rename contact group:', err)
      showAlert(err?.message || 'Không thể đổi tên nhóm data.', 'error')
      throw err
    }
  }

  const handleDeleteContactGroup = (group: AutoAccountContactGroup) => {
    if (!window.electronAPI) return
    showConfirm(
      `Xoá nhóm "${group.name}"? Data gốc sẽ không bị xoá.`,
      async () => {
        try {
          await window.electronAPI.deleteContactGroup(group.id)
          setContactGroups(prev => prev.filter(item => item.id !== group.id))
          setAllContactGroups(prev => prev.filter(item => item.id !== group.id))
          setSelectedGroupIds(prev => {
            const next = new Set(prev)
            next.delete(group.id)
            return next
          })
          setGroupContactCache(prev => {
            const next = { ...prev }
            delete next[group.id]
            return next
          })
          setActiveGroupId(prev => prev === group.id ? null : prev)
          setModalSelectedGroupIds(prev => {
            const next = new Set(prev)
            next.delete(group.id)
            return next
          })
          showAlert('Đã xoá nhóm data.', 'success')
        } catch (err: any) {
          console.error('Failed to delete contact group:', err)
          showAlert(err?.message || 'Không thể xoá nhóm data.', 'error')
        }
      },
      { title: 'Xoá nhóm data', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleToggleGroupOutput = async (groupId: number) => {
    if (selectedGroupIds.has(groupId)) {
      setSelectedGroupIds(prev => {
        const next = new Set(prev)
        next.delete(groupId)
        return next
      })
      return
    }

    const group = allContactGroups.find(item => item.id === groupId)
    if (!group || group.contactType !== actionDef.contactType) {
      showAlert('Nhóm này không đúng loại data hiện tại nên không thể đưa vào danh sách chọn.', 'error')
      return
    }

    try {
      await loadContactsForGroup(groupId)
      setSelectedGroupIds(prev => {
        const next = new Set(prev)
        next.add(groupId)
        return next
      })
    } catch (err: any) {
      console.error('Failed to select contact group:', err)
      showAlert(err?.message || 'Không thể chọn nhóm data.', 'error')
    }
  }

  const handleActivateGroup = (groupId: number) => {
    setActiveGroupId(groupId)
  }

  const handleOpenAddGroupModal = () => {
    if (pagedSelectedCount === 0) {
      showAlert('Vui lòng tích chọn data trước khi thêm vào nhóm.', 'error')
      return
    }
    setModalSelectedGroupIds(new Set())
    setNewGroupName('')
    setShowNewGroupInput(false)
    setShowAddGroupModal(true)
  }

  const handleToggleModalGroup = (group: AutoAccountContactGroup) => {
    if (group.contactType !== actionDef.contactType) return
    setModalSelectedGroupIds(prev => {
      const next = new Set(prev)
      if (next.has(group.id)) next.delete(group.id)
      else next.add(group.id)
      return next
    })
  }

  const closeAddGroupModal = () => {
    setShowAddGroupModal(false)
    setNewGroupName('')
    setShowNewGroupInput(false)
    setModalSelectedGroupIds(new Set())
  }

  const handleSaveSelectedToGroups = async () => {
    if (!window.electronAPI || !accountId) return
    const selectedContacts = await loadSelectedContacts()
    const contactIds = selectedContacts.map(contact => contact.id)
    if (contactIds.length === 0) {
      showAlert('Vui lòng tích chọn data trước khi thêm vào nhóm.', 'error')
      return
    }

    const newName = newGroupName.trim()
    const shouldCreateGroup = showNewGroupInput && newName.length > 0
    if (modalSelectedGroupIds.size === 0 && !shouldCreateGroup) {
      showAlert('Vui lòng chọn nhóm hoặc nhập tên nhóm mới.', 'error')
      return
    }

    setSavingGroupMembers(true)
    try {
      const groupIds = Array.from(modalSelectedGroupIds).filter(groupId => {
        const group = allContactGroups.find(item => item.id === groupId)
        return group?.contactType === actionDef.contactType
      })
      let createdGroup: AutoAccountContactGroup | null = null
      if (shouldCreateGroup) {
        createdGroup = await window.electronAPI.createContactGroup(accountId, actionDef.contactType, newName)
        groupIds.push(createdGroup.id)
      }

      let addedCount = 0
      for (const groupId of groupIds) {
        const result = await window.electronAPI.addContactsToGroup(groupId, contactIds)
        addedCount += result.count
      }

      setGroupContactCache(prev => {
        const next = { ...prev }
        for (const groupId of groupIds) delete next[groupId]
        return next
      })
      await loadContactGroups()
      if (createdGroup) {
        setActiveGroupId(createdGroup.id)
        setShowGroupPanel(true)
        const data = await loadContactsForGroup(createdGroup.id, true)
        setGroupContacts(data)
      }
      if (!createdGroup && activeGroupId && groupIds.includes(activeGroupId)) {
        const data = await loadContactsForGroup(activeGroupId, true)
        setGroupContacts(data)
      }
      showAlert(
        addedCount > 0
          ? `Đã thêm ${addedCount} data mới vào nhóm.`
          : 'Các data đã chọn đã có trong nhóm.',
        'success'
      )
      closeAddGroupModal()
    } catch (err: any) {
      console.error('Failed to add contacts to group:', err)
      showAlert(err?.message || 'Không thể thêm data vào nhóm.', 'error')
    } finally {
      setSavingGroupMembers(false)
    }
  }

  const handleRemoveFromActiveGroup = (contactsToRemove: AutoAccountContact | AutoAccountContact[], onSuccess?: () => void) => {
    if (!window.electronAPI || !activeGroupId) return
    const contacts = Array.isArray(contactsToRemove) ? contactsToRemove : [contactsToRemove]
    const contactIds = Array.from(new Set(contacts.map(contact => contact.id)))
    if (contactIds.length === 0) return
    const label = contactIds.length === 1
      ? `"${contacts[0]?.name || contacts[0]?.uid || 'data'}"`
      : `${contactIds.length} data đã chọn`
    showConfirm(
      `Xoá ${label} khỏi nhóm? Data gốc sẽ không bị xoá.`,
      async () => {
        try {
          await window.electronAPI.removeContactsFromGroup(activeGroupId, contactIds)
          const contactIdSet = new Set(contactIds)
          setGroupContacts(prev => prev.filter(item => !contactIdSet.has(item.id)))
          setGroupContactCache(prev => ({
            ...prev,
            [activeGroupId]: (prev[activeGroupId] || []).filter(item => !contactIdSet.has(item.id))
          }))
          await loadContactGroups()
          onSuccess?.()
          showAlert('Đã xoá data khỏi nhóm.', 'success')
        } catch (err: any) {
          console.error('Failed to remove contact from group:', err)
          showAlert(err?.message || 'Không thể xoá data khỏi nhóm.', 'error')
        }
      },
      { title: 'Xoá data khỏi nhóm', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleZaloGroupMemberModeChange = (mode: ZaloGroupMemberScanMode) => {
    setZaloGroupMemberMode(mode)
    setSelectedIds(new Set())
    if (mode === 'joined_group') {
      setZaloGroupMemberGroupId(prev => (
        prev && joinedZaloGroupOptions.some(group => group.uid === prev)
          ? prev
          : joinedZaloGroupOptions[0]?.uid || ''
      ))
      return
    }

    const normalizedLink = normalizeZaloGroupLink(zaloGroupMemberLink)
    const matchedGroup = normalizedLink ? findLinkedZaloGroupByLink(normalizedLink) : null
    const fallbackGroup = matchedGroup || linkedZaloGroupOptions[0] || null
    setZaloGroupMemberGroupId(fallbackGroup?.uid || '')
    if (!normalizedLink && fallbackGroup) {
      setZaloGroupMemberLink(getZaloGroupContactLink(fallbackGroup))
    }
  }

  const handleJoinedZaloGroupChange = (groupId: string) => {
    setZaloGroupMemberGroupId(groupId)
    setSelectedIds(new Set())
  }

  const handleLinkedZaloGroupChange = (groupId: string) => {
    setZaloGroupMemberGroupId(groupId)
    setSelectedIds(new Set())
    const group = linkedZaloGroupOptions.find(item => item.uid === groupId)
    setZaloGroupMemberLink(group ? getZaloGroupContactLink(group) : '')
  }

  const handleZaloGroupMemberLinkChange = (value: string) => {
    setZaloGroupMemberLink(value)
    setSelectedIds(new Set())
    const normalizedLink = normalizeZaloGroupLink(value)
    const matchedGroup = normalizedLink ? findLinkedZaloGroupByLink(normalizedLink) : null
    setZaloGroupMemberGroupId(matchedGroup?.uid || '')
  }

  const handleLoadData = async () => {
    if (!canUseDataScanAction(action, entitlements)) {
      showAlert('Tính năng này chưa được kích hoạt hoặc đã hết hạn.', 'error')
      return
    }
    if (!window.electronAPI || !accountId) {
      showAlert('Vui lòng chọn tài khoản trước.', 'error')
      return
    }
    if (selectedAccount?.flatformType !== actionDef.platform) {
      showAlert(`Hành động này chỉ hỗ trợ tài khoản ${getPlatformLabel(actionDef.platform)}.`, 'error')
      return
    }
    if (isPostCommentersAction) {
      if (!postCommentersUrl.trim()) {
        showAlert('Vui lòng nhập link bài post.', 'error')
        return
      }
      if (!normalizeFacebookPostUrlForCompare(postCommentersUrl)) {
        showAlert('Link bài post Facebook không hợp lệ.', 'error')
        return
      }
      if (postCommentersLimit < 1) {
        showAlert('Số lượng phải lớn hơn 0.', 'error')
        return
      }
    }
    if (isPostLikesAction) {
      if (!postLikesUrl.trim()) {
        showAlert('Vui lòng nhập link bài post.', 'error')
        return
      }
      if (!normalizeFacebookPostUrlForCompare(postLikesUrl)) {
        showAlert('Link bài post Facebook không hợp lệ.', 'error')
        return
      }
      if (postLikesLimit < 1) {
        showAlert('Số lượng phải lớn hơn 0.', 'error')
        return
      }
    }
    if (isProfileFriendsAction) {
      if (!profileFriendsUrl.trim()) {
        showAlert('Vui lòng nhập link profile.', 'error')
        return
      }
      if (!normalizeFacebookProfileUrlForCompare(profileFriendsUrl)) {
        showAlert('Link/UID profile Facebook không hợp lệ.', 'error')
        return
      }
      if (profileFriendsLimit < 1) {
        showAlert('Số lượng phải lớn hơn 0.', 'error')
        return
      }
    }
    if (isGroupMembersAction) {
      if (!groupMembersUrl.trim()) {
        showAlert('Vui lòng nhập link group.', 'error')
        return
      }
      if (!normalizeFacebookGroupUrlForCompare(groupMembersUrl)) {
        showAlert('Link/UID group Facebook không hợp lệ.', 'error')
        return
      }
      if (groupMembersLimit < 1) {
        showAlert('Số lượng phải lớn hơn 0.', 'error')
        return
      }
    }
    if (isPageInboxAction && !pageInboxPageUid) {
      showAlert('Vui lòng chọn page cần quét.', 'error')
      return
    }
    if (isZaloGroupMembersAction) {
      if (zaloGroupMemberMode === 'joined_group' && !zaloGroupMemberGroupId) {
        showAlert('Vui lòng chọn group Zalo đã tham gia.', 'error')
        return
      }
      if (zaloGroupMemberMode === 'group_link' && !normalizeZaloGroupLink(zaloGroupMemberLink)) {
        showAlert('Link group Zalo không hợp lệ.', 'error')
        return
      }
    }
    if (isZaloRemarketingCustomersAction) {
      const count = await loadZaloRemarketingCustomers()
      if (count === null) return
      showAlert(`Đã tải ${formatCount(count)} data.`, 'success')
      return
    }

    setScanLoading(true)
    setProgressMessages([])
    setProgressExpanded(true)
    const scanId = scanRunIdRef.current + 1
    scanRunIdRef.current = scanId
    stoppedScanIdsRef.current.delete(scanId)
    completedScanIdsRef.current.delete(scanId)
    try {
      const result = isPostCommentersAction
        ? await window.electronAPI.loadPostCommenters(accountId, postCommentersUrl, postCommentersLimit)
        : isPostLikesAction
          ? await window.electronAPI.loadPostLikes(accountId, postLikesUrl, postLikesLimit)
        : isProfileFriendsAction
          ? await window.electronAPI.loadProfileFriends(accountId, profileFriendsUrl, profileFriendsLimit)
        : isGroupMembersAction
          ? await window.electronAPI.loadGroupMembers(accountId, groupMembersUrl, groupMembersLimit)
        : isPageInboxAction
          ? await window.electronAPI.loadPageInboxCustomers(accountId, pageInboxPageUid, selectedPageInboxPage?.name)
          : isZaloGroupMembersAction
            ? await window.electronAPI.loadZaloGroupMembers(accountId, {
              mode: zaloGroupMemberMode,
              zaloGroupId: zaloGroupMemberMode === 'joined_group' ? zaloGroupMemberGroupId : undefined,
              link: zaloGroupMemberMode === 'group_link' ? normalizeZaloGroupLink(zaloGroupMemberLink) : undefined
            })
          : await (actionDef.contactType === 'person'
          ? window.electronAPI.loadFriends
          : actionDef.contactType === 'group'
            ? window.electronAPI.loadGroups
            : window.electronAPI.loadPages)(accountId)
      if (!mountedRef.current) return
      if (scanRunIdRef.current !== scanId) return
      if (completedScanIdsRef.current.has(scanId)) return

      const wasStopped = stoppedScanIdsRef.current.has(scanId) || result.stopped
      setScanLoading(false)
      setMinimized(false)
      if (isPostCommentersAction && result.sourcePostUrl) {
        setPostCommentersUrl(String(result.sourcePostUrl))
      }
      if (isPostLikesAction && result.sourcePostUrl) {
        setPostLikesUrl(String(result.sourcePostUrl))
      }
      if (isProfileFriendsAction && result.sourceProfileUrl) {
        setProfileFriendsUrl(String(result.sourceProfileUrl))
      }
      if (isGroupMembersAction && result.sourceGroupUrl) {
        setGroupMembersUrl(String(result.sourceGroupUrl))
      }
      if (isZaloGroupMembersAction && result.zaloGroupId) {
        setZaloGroupMemberGroupId(String(result.zaloGroupId))
      }

      if (!result.success) {
        if (wasStopped) return
        showAlert(result.error || 'Tải data thất bại.', 'error')
        return
      }
      resetPagedContactSelection()
      setPageInboxPage(1)
      if (isPageInboxAction) {
        await refreshPageInboxContactsAfterScan()
      } else if (isZaloGroupMembersAction && result.zaloGroupId) {
        await loadZaloGroupMemberContactsForGroup(String(result.zaloGroupId))
        await loadZaloGroupOptions()
      } else {
        await loadCachedContacts(1)
      }
      await loadContactGroups()
      if (wasStopped) return

      showAlert(`Đã tải ${result.count} data.`, 'success')
    } catch (err: any) {
      if (!mountedRef.current) return
      if (scanRunIdRef.current !== scanId || stoppedScanIdsRef.current.has(scanId)) return
      console.error('Failed to scan data:', err)
      showAlert(err?.message || 'Tải data thất bại.', 'error')
    } finally {
      const wasStopped = stoppedScanIdsRef.current.has(scanId)
      stoppedScanIdsRef.current.delete(scanId)
      if (mountedRef.current && scanRunIdRef.current === scanId && !wasStopped) {
        setScanLoading(false)
        setMinimized(false)
      }
    }
  }

  const cancelScan = async () => {
    if (!accountId || !window.electronAPI?.cancelContactLoad) return
    try {
      await window.electronAPI.cancelContactLoad(accountId)
    } catch (err) {
      console.warn('Failed to cancel contact load:', err)
    }
  }

  const handleStopScan = () => {
    stoppedScanIdsRef.current.add(scanRunIdRef.current)
    setScanLoading(false)
    setMinimized(false)
    cancelScan()
  }

  const handleClose = () => {
    if (!scanLoading) {
      onClose()
      return
    }

    showConfirm(
      'Tắt form sẽ dừng quá trình quét data đang chạy. Bạn có chắc muốn tắt form không?',
      async () => {
        await cancelScan()
        onClose()
      },
      { title: 'Dừng quét data', confirmText: 'Dừng và tắt', variant: 'danger' }
    )
  }

  const handleExport = async () => {
    try {
      const exportContacts = await loadOutputContacts()
      if (exportContacts.length === 0) {
        showAlert('Vui lòng tích chọn data trước khi xuất Excel.', 'error')
        return
      }
      const getAkaBizTagExportText = (contact: AutoAccountContact) => formatContactAkaBizTags(contact, akaBizTagNameById)
      const getZaloTagExportText = (contact: AutoAccountContact) => formatContactZaloTags(contact, zaloTagNameById)
      const headers = isPageInboxAction
        ? ['Tên', 'PSID', 'SĐT', 'Ngày nhắn cuối', 'Tin nhắn cuối']
        : isZaloRemarketingCustomersAction
          ? [
            'Tên Zalo',
            'Số điện thoại',
            'Zalo Id',
            ...(showZaloTagColumn ? ['Tag Zalo'] : []),
            ...(showAkaBizTagColumn ? ['Tag akaBiz'] : []),
            'Tên group',
            'Hành động của chiến dịch gần nhất',
            'Số tin đã gửi',
            'Ngày gửi',
            'Ngày gửi gần nhất cách hôm nay số ngày',
            'Trạng thái gửi tin gần nhất',
            'Ghi chú gửi tin gần nhất',
            'Trạng thái của người nhận trong tin nhắn gần nhất'
          ]
          : [
            ...(actionDef.platform === 'zalo' ? ['Tên', 'Số điện thoại', 'UID'] : EXPORT_HEADERS),
            ...(showZaloTagColumn ? ['Tag Zalo'] : []),
            ...(showAkaBizTagColumn ? ['Tag akaBiz'] : [])
          ]
      const rows = [
        headers,
        ...exportContacts.map(contact => {
          if (isPageInboxAction) {
            return [
              contact.name || '',
              contact.uid || '',
              getPageInboxPhone(contact),
              getPageInboxLastMessageAt(contact),
              getPageInboxLastMessage(contact)
            ]
          }
          if (isZaloRemarketingCustomersAction) {
            return [
              contact.name || '',
              getZaloRemarketingPhone(contact),
              contact.uid || '',
              ...(showZaloTagColumn ? [getZaloTagExportText(contact)] : []),
              ...(showAkaBizTagColumn ? [getAkaBizTagExportText(contact)] : []),
              getZaloRemarketingGroupName(contact),
              getZaloRemarketingActionName(contact),
              getZaloRemarketingSentCount(contact),
              getZaloRemarketingLatestDate(contact),
              getZaloRemarketingDaysSinceLatest(contact),
              getZaloRemarketingLatestStatus(contact),
              getZaloRemarketingLatestLog(contact),
              getZaloRemarketingRecipientStatus(contact)
            ]
          }
          return [
            contact.name || '',
            ...(actionDef.platform === 'zalo'
              ? [getContactPhoneText(contact), contact.uid || contact.url || '']
              : [contact.uid || contact.url || '']),
            ...(showZaloTagColumn ? [getZaloTagExportText(contact)] : []),
            ...(showAkaBizTagColumn ? [getAkaBizTagExportText(contact)] : [])
          ]
        })
      ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = isPageInboxAction
        ? [
          { wch: 24 },
          { wch: 28 },
          { wch: 16 },
          { wch: 20 },
          { wch: 60 }
        ]
        : isZaloRemarketingCustomersAction
          ? [
            { wch: 24 },
            { wch: 16 },
            { wch: 28 },
            ...(showZaloTagColumn ? [{ wch: 28 }] : []),
            ...(showAkaBizTagColumn ? [{ wch: 28 }] : []),
            { wch: 24 },
            { wch: 32 },
            { wch: 12 },
            { wch: 18 },
            { wch: 18 },
            { wch: 20 },
            { wch: 40 },
            { wch: 34 }
          ]
          : [
            { wch: 24 },
            ...(actionDef.platform === 'zalo'
              ? [{ wch: 16 }, { wch: 48 }]
              : [{ wch: 48 }]),
            ...(showZaloTagColumn ? [{ wch: 28 }] : []),
            ...(showAkaBizTagColumn ? [{ wch: 28 }] : [])
          ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Sheet1')
      const accountName = sanitizeFileSegment(selectedAccount?.name || 'account')
      const actionName = sanitizeFileSegment(actionDef.label)
      writeFile(workbook, `scan-data-${accountName}-${actionName}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất data ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export scan data:', err)
      showAlert('Không thể xuất file Excel.', 'error')
    }
  }

  const handleSelect = async () => {
    if (!onSelect) return
    try {
      const selected = await loadOutputContacts()
      if (selected.length === 0) {
        showAlert('Vui lòng tích chọn data trước khi chọn.', 'error')
        return
      }
      onSelect(selected)
      onClose()
    } catch (err) {
      console.error('Failed to select scan data:', err)
      showAlert('Không thể chọn data.', 'error')
    }
  }

  return (
    <div className={`modal-overlay data-scan-overlay ${minimized ? 'minimized' : ''}`}>
      <div className={`campaign-full-modal data-scan-modal ${minimized ? 'minimized' : ''}`}>
        <div className="modal-header data-scan-header">
          <div>
            <div className="modal-title">Quét data</div>
            <div className="data-scan-subtitle">
              Tổng {formatCount(currentTotalCount)} data
            </div>
          </div>
          <div className="data-scan-header-actions">
            {scanLoading && (
              <button
                className="btn-icon"
                onClick={() => setMinimized(prev => !prev)}
                title={minimized ? 'Mở rộng form' : 'Thu nhỏ form'}
              >
                {minimized ? <Maximize2 size={17} /> : <Minimize2 size={17} />}
              </button>
            )}
            <button className="btn-icon" onClick={handleClose} title="Đóng">
              <X size={18} />
            </button>
          </div>
        </div>

        {minimized ? (
          <div className="data-scan-minimized-body">
            <div className="data-scan-minimized-title">
              <RefreshCw size={14} className="spin" />
              Đang tải data
            </div>
            <div className="data-scan-minimized-message">
              {progressMessages[progressMessages.length - 1] || actionDef.loadingText}
            </div>
            <div className="data-scan-minimized-actions">
              <button
                className="btn btn-danger btn-sm"
                onClick={handleStopScan}
              >
                <Square size={13} />
                Dừng
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className={`data-scan-body ${isPageInboxAction ? 'is-page-inbox' : ''}`}>
          <div className="data-scan-load-section">
            <div className="data-scan-load-fields">
              <div className="data-scan-controls">
                <div className="stepper-form-group">
                  <label>Hành động</label>
                  <select
                    className="stepper-input"
                    value={action}
                    onChange={event => setAction(event.target.value as DataScanAction)}
                    disabled={scanLoading || (lockAction && !canSwitchLockedAction)}
                  >
                    {availableActions.map(item => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </div>

                <div className="stepper-form-group">
                  <label>Tài khoản</label>
                  <select
                    className="stepper-input"
                    value={accountId}
                    onChange={event => setAccountId(event.target.value ? Number(event.target.value) : '')}
                    disabled={scanLoading || lockAccount}
                  >
                    <option value="">Chọn tài khoản</option>
                    {platformAccounts.map(account => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                </div>

                <div className="stepper-form-group">
                  <label>Loại tài khoản</label>
                  <input className="stepper-input" value={selectedAccount?.flatformType || ''} disabled />
                </div>
              </div>

              {isPostCommentersAction && (
                <div className="data-scan-post-commenters-controls">
                  <div className="stepper-form-group">
                    <label>Link bài post</label>
                    <input
                      className="stepper-input"
                      value={postCommentersUrl}
                      onChange={event => setPostCommentersUrl(event.target.value)}
                      placeholder="Dán link bài post Facebook..."
                      disabled={scanLoading}
                    />
                  </div>

                  <div className="stepper-form-group">
                    <label>Số lượng</label>
                    <input
                      type="number"
                      min={1}
                      className="stepper-input"
                      value={postCommentersLimit}
                      onChange={event => setPostCommentersLimit(normalizePositiveNumber(event.target.value))}
                      disabled={scanLoading}
                    />
                  </div>
                </div>
              )}

              {isPostLikesAction && (
                <div className="data-scan-post-commenters-controls">
                  <div className="stepper-form-group">
                    <label>Link bài post</label>
                    <input
                      className="stepper-input"
                      value={postLikesUrl}
                      onChange={event => setPostLikesUrl(event.target.value)}
                      placeholder="Dán link bài post Facebook..."
                      disabled={scanLoading}
                    />
                  </div>

                  <div className="stepper-form-group">
                    <label>Số lượng</label>
                    <input
                      type="number"
                      min={1}
                      className="stepper-input"
                      value={postLikesLimit}
                      onChange={event => setPostLikesLimit(normalizePositiveNumber(event.target.value, DEFAULT_POST_LIKE_LIMIT))}
                      disabled={scanLoading}
                    />
                  </div>
                </div>
              )}

              {isProfileFriendsAction && (
                <div className="data-scan-post-commenters-controls">
                  <div className="stepper-form-group">
                    <label>Link profile</label>
                    <input
                      className="stepper-input"
                      value={profileFriendsUrl}
                      onChange={event => setProfileFriendsUrl(event.target.value)}
                      placeholder="Dán link/UID profile Facebook..."
                      disabled={scanLoading}
                    />
                  </div>

                  <div className="stepper-form-group">
                    <label>Số lượng</label>
                    <input
                      type="number"
                      min={1}
                      className="stepper-input"
                      value={profileFriendsLimit}
                      onChange={event => setProfileFriendsLimit(normalizePositiveNumber(event.target.value, DEFAULT_PROFILE_FRIEND_LIMIT))}
                      disabled={scanLoading}
                    />
                  </div>
                </div>
              )}

              {isGroupMembersAction && (
                <div className="data-scan-post-commenters-controls">
                  <div className="stepper-form-group">
                    <label>Link group</label>
                    <input
                      className="stepper-input"
                      value={groupMembersUrl}
                      onChange={event => setGroupMembersUrl(event.target.value)}
                      placeholder="Dán link/UID group Facebook..."
                      disabled={scanLoading}
                    />
                  </div>

                  <div className="stepper-form-group">
                    <label>Số lượng</label>
                    <input
                      type="number"
                      min={1}
                      className="stepper-input"
                      value={groupMembersLimit}
                      onChange={event => setGroupMembersLimit(normalizePositiveNumber(event.target.value, DEFAULT_GROUP_MEMBER_LIMIT))}
                      disabled={scanLoading}
                    />
                  </div>
                </div>
              )}

              {isPageInboxAction && (
                <div className="data-scan-page-inbox-load-controls">
                  <div className="stepper-form-group">
                    <label>Page</label>
                    <select
                      className="stepper-input"
                      value={pageInboxPageUid}
                      onChange={event => handlePageInboxPageChange(event.target.value)}
                      disabled={scanLoading || pageInboxPages.length === 0}
                    >
                      {pageInboxPages.length === 0 ? (
                        <option value="">Chưa có page đã quét</option>
                      ) : (
                        pageInboxPages.map(page => (
                          <option key={page.id} value={page.uid || ''}>
                            {page.name || page.uid}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              )}

              {isZaloGroupMembersAction && (
                <div className="data-scan-zalo-group-member-controls">
                  <div className="stepper-form-group data-scan-zalo-member-mode">
                    <label>Tuỳ chọn</label>
                    <select
                      className="stepper-input"
                      value={zaloGroupMemberMode}
                      onChange={event => handleZaloGroupMemberModeChange(event.target.value as ZaloGroupMemberScanMode)}
                      disabled={scanLoading}
                    >
                      <option value="joined_group">Group đã tham gia</option>
                      <option value="group_link">Link group</option>
                    </select>
                  </div>

                  {zaloGroupMemberMode === 'joined_group' ? (
                    <div className="stepper-form-group data-scan-zalo-member-group">
                      <label>Group Zalo</label>
                      <select
                        className="stepper-input"
                        value={zaloGroupMemberGroupId}
                        onChange={event => handleJoinedZaloGroupChange(event.target.value)}
                        disabled={scanLoading || joinedZaloGroupOptions.length === 0}
                      >
                        {joinedZaloGroupOptions.length === 0 ? (
                          <option value="">Chưa có group Zalo đã tham gia</option>
                        ) : (
                          joinedZaloGroupOptions.map(group => (
                            <option key={group.id} value={group.uid || ''}>
                              {getZaloGroupOptionLabel(group)}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  ) : (
                    <div className="data-scan-zalo-member-link-row">
                      <div className="stepper-form-group data-scan-zalo-member-linked-group">
                        <label>Link group</label>
                        <select
                          className="stepper-input"
                          value={zaloGroupMemberGroupId}
                          onChange={event => handleLinkedZaloGroupChange(event.target.value)}
                          disabled={scanLoading}
                        >
                          <option value="">Nhập link mới</option>
                          {linkedZaloGroupOptions.map(group => (
                            <option key={group.id} value={group.uid || ''}>
                              {getZaloGroupOptionLabel(group)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="stepper-form-group data-scan-zalo-member-link">
                        <label>Link group</label>
                        <div className={`data-scan-zalo-link-input-wrap${scanLoading ? ' is-disabled' : ''}`}>
                          <Link2 size={16} className="data-scan-zalo-link-icon" />
                          <input
                            className="data-scan-zalo-link-input"
                            value={zaloGroupMemberLink}
                            onChange={event => handleZaloGroupMemberLinkChange(event.target.value)}
                            onPaste={handleZaloGroupLinkPaste}
                            placeholder="https://zalo.me/g/..."
                            disabled={scanLoading}
                          />
                          <button
                            type="button"
                            className="data-scan-zalo-qr-button"
                            onClick={() => zaloQrFileInputRef.current?.click()}
                            disabled={scanLoading || zaloQrReading}
                            title="Đọc link group từ ảnh QR"
                          >
                            <QrCode size={15} />
                            {zaloQrReading ? 'Đang đọc' : 'Từ QR'}
                          </button>
                          <input
                            ref={zaloQrFileInputRef}
                            className="data-scan-hidden-file-input"
                            type="file"
                            accept="image/*"
                            onChange={handleZaloQrFileChange}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="data-scan-load-actions">
              {scanLoading ? (
                <button
                  className="btn btn-danger data-scan-load-button"
                  onClick={handleStopScan}
                >
                  <Square size={14} />
                  Dừng
                </button>
              ) : (
                <button
                  className="btn btn-primary data-scan-load-button"
                  onClick={handleLoadData}
                  disabled={
                    loading
                    ||
                    !accountId
                    || (isPostCommentersAction && !postCommentersUrl.trim())
                    || (isPostLikesAction && !postLikesUrl.trim())
                    || (isProfileFriendsAction && !profileFriendsUrl.trim())
                    || (isGroupMembersAction && !groupMembersUrl.trim())
                    || (isPageInboxAction && !pageInboxPageUid)
                    || (isZaloGroupMembersAction && zaloGroupMemberMode === 'joined_group' && !zaloGroupMemberGroupId)
                    || (isZaloGroupMembersAction && zaloGroupMemberMode === 'group_link' && !normalizeZaloGroupLink(zaloGroupMemberLink))
                  }
                >
                  <RefreshCw size={14} />
                  Tải data
                </button>
              )}
            </div>
          </div>

          <div className="data-scan-filter-section">
            <div className={`data-scan-filter-header${hasZaloTagFilters ? ' has-zalo-tags' : ''}${hasStatusFilter ? ' has-status-filter' : ''}`}>
              <div className="stepper-form-group data-scan-search-group">
                <label aria-hidden="true">&nbsp;</label>
                <label className="data-scan-search">
                  <Search size={14} />
                  <input
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder={
                      isPageInboxAction
                        ? 'Tìm theo tên, PSID hoặc SĐT...'
                        : 'Tìm theo tên, UID hoặc SĐT...'
                    }
                  />
                </label>
              </div>
              {hasZaloTagFilters && (
                <>
                  <div className="stepper-form-group">
                    <label>Tag Zalo</label>
                    <div className="data-scan-tag-filter-dropdown" ref={zaloTagFilterDropdownRef}>
                      <button
                        type="button"
                        className={`data-scan-tag-filter-trigger${zaloTagFilterDropdownOpen ? ' is-open' : ''}`}
                        onClick={() => setZaloTagFilterDropdownOpen(prev => !prev)}
                        aria-expanded={zaloTagFilterDropdownOpen}
                        title={zaloTagFilterLabel}
                      >
                        <span>{zaloTagFilterLabel}</span>
                        <ChevronDown size={15} />
                      </button>

                      {zaloTagFilterDropdownOpen && (
                        <div className="data-scan-tag-filter-menu">
                          <button
                            type="button"
                            className={`data-scan-tag-filter-option is-all${zaloTagFilterIds.length === 0 && !zaloNoTagFilter ? ' selected' : ''}`}
                            onClick={() => {
                              setZaloTagFilterIds([])
                              setZaloNoTagFilter(false)
                            }}
                            role="menuitemcheckbox"
                            aria-checked={zaloTagFilterIds.length === 0 && !zaloNoTagFilter}
                          >
                            <span className="data-scan-tag-filter-check">
                              {zaloTagFilterIds.length === 0 && !zaloNoTagFilter && <Check size={14} />}
                            </span>
                            <span className="data-scan-tag-filter-label">Tất cả</span>
                          </button>
                          <button
                            type="button"
                            className={`data-scan-tag-filter-option${zaloNoTagFilter ? ' selected' : ''}`}
                            onClick={() => setZaloNoTagFilter(prev => !prev)}
                            role="menuitemcheckbox"
                            aria-checked={zaloNoTagFilter}
                          >
                            <span className="data-scan-tag-filter-check">
                              {zaloNoTagFilter && <Check size={12} />}
                            </span>
                            <span className="data-scan-tag-filter-label">Chưa gắn tag</span>
                          </button>
                          {zaloTagFilterOptions.length > 0 && <div className="data-scan-tag-filter-divider" />}
                          {zaloTagFilterOptions.map(option => {
                            const selected = zaloTagFilterIds.includes(option.id)
                            return (
                              <button
                                key={option.id}
                                type="button"
                                className={`data-scan-tag-filter-option${selected ? ' selected' : ''}`}
                                onClick={() => toggleZaloTagFilter(option.id)}
                                role="menuitemcheckbox"
                                aria-checked={selected}
                              >
                                <span className="data-scan-tag-filter-check">
                                  {selected && <Check size={12} />}
                                </span>
                                <span className="data-scan-tag-filter-label">{option.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="stepper-form-group">
                    <label>Tag akaBiz</label>
                    <div className="data-scan-tag-filter-dropdown" ref={akaBizTagFilterDropdownRef}>
                      <button
                        type="button"
                        className={`data-scan-tag-filter-trigger${akaBizTagFilterDropdownOpen ? ' is-open' : ''}`}
                        onClick={() => setAkaBizTagFilterDropdownOpen(prev => !prev)}
                        aria-expanded={akaBizTagFilterDropdownOpen}
                        title={akaBizTagFilterLabel}
                      >
                        <span>{akaBizTagFilterLabel}</span>
                        <ChevronDown size={15} />
                      </button>

                      {akaBizTagFilterDropdownOpen && (
                        <div className="data-scan-tag-filter-menu">
                          <button
                            type="button"
                            className={`data-scan-tag-filter-option is-all${akaBizTagFilterIds.length === 0 && !akaBizNoTagFilter ? ' selected' : ''}`}
                            onClick={() => {
                              setAkaBizTagFilterIds([])
                              setAkaBizNoTagFilter(false)
                            }}
                            role="menuitemcheckbox"
                            aria-checked={akaBizTagFilterIds.length === 0 && !akaBizNoTagFilter}
                          >
                            <span className="data-scan-tag-filter-check">
                              {akaBizTagFilterIds.length === 0 && !akaBizNoTagFilter && <Check size={14} />}
                            </span>
                            <span className="data-scan-tag-filter-label">Tất cả</span>
                          </button>
                          <button
                            type="button"
                            className={`data-scan-tag-filter-option${akaBizNoTagFilter ? ' selected' : ''}`}
                            onClick={() => setAkaBizNoTagFilter(prev => !prev)}
                            role="menuitemcheckbox"
                            aria-checked={akaBizNoTagFilter}
                          >
                            <span className="data-scan-tag-filter-check">
                              {akaBizNoTagFilter && <Check size={12} />}
                            </span>
                            <span className="data-scan-tag-filter-label">Chưa gắn tag</span>
                          </button>
                          {akaBizTagFilterOptions.length > 0 && <div className="data-scan-tag-filter-divider" />}
                          {akaBizTagFilterOptions.map(option => {
                            const selected = akaBizTagFilterIds.includes(option.id)
                            return (
                              <button
                                key={option.id}
                                type="button"
                                className={`data-scan-tag-filter-option${selected ? ' selected' : ''}`}
                                onClick={() => toggleAkaBizTagFilter(option.id)}
                                role="menuitemcheckbox"
                                aria-checked={selected}
                              >
                                <span className="data-scan-tag-filter-check">
                                  {selected && <Check size={12} />}
                                </span>
                                <span className="data-scan-tag-filter-label">{option.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
              {hasStatusFilter && (
                <div className="stepper-form-group data-scan-filter-status">
                  <label>Hiển thị</label>
                  <select
                    className="stepper-input"
                    value={statusFilter}
                    onChange={event => setStatusFilter(event.target.value as ContactStatusFilter)}
                  >
                    {statusFilterOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {isPageInboxAction && (
              <>
                <div className="data-scan-page-inbox-controls">
                  <div className="stepper-form-group">
                    <label>Số điện thoại</label>
                    <select
                      className="stepper-input"
                      value={pageInboxPhoneFilter}
                      onChange={event => setPageInboxPhoneFilter(event.target.value as PageInboxPhoneFilter)}
                    >
                      <option value="all">Tất cả</option>
                      <option value="has_phone">Có SĐT</option>
                      <option value="no_phone">Không có SĐT</option>
                    </select>
                  </div>

                  <div className="stepper-form-group">
                    <label>Thời gian nhắn tin gần nhất</label>
                    <select
                      className="stepper-input"
                      value={pageInboxTimePreset}
                      onChange={event => handlePageInboxTimePresetChange(event.target.value as PageInboxTimePreset)}
                    >
                      {PAGE_INBOX_TIME_PRESETS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  {pageInboxTimePreset === 'all' ? (
                    <div className="stepper-form-group data-scan-page-inbox-time-status">
                      <label>Khoảng thời gian</label>
                      <div className="stepper-input data-scan-readonly-field" aria-readonly="true">
                        Không giới hạn thời gian
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="stepper-form-group">
                        <label>Từ ngày</label>
                        <input
                          type="date"
                          className="stepper-input"
                          value={pageInboxDateFrom}
                          onChange={event => setPageInboxDateFrom(event.target.value)}
                        />
                      </div>

                      <div className="stepper-form-group">
                        <label>Đến ngày</label>
                        <input
                          type="date"
                          className="stepper-input"
                          value={pageInboxDateTo}
                          onChange={event => setPageInboxDateTo(event.target.value)}
                        />
                      </div>
                    </>
                  )}

                  <div className="stepper-form-group">
                    <label>Nội dung</label>
                    <select
                      className="stepper-input"
                      value={pageInboxMessageFilterMode}
                      onChange={event => setPageInboxMessageFilterMode(event.target.value as PageInboxMessageFilterMode)}
                    >
                      <option value="all">Tất cả</option>
                      <option value="contain_all">Chứa tất cả từ khoá</option>
                      <option value="contain_any">Chứa một trong các từ khoá</option>
                      <option value="not_contain_all">Không chứa tất cả từ khoá</option>
                      <option value="not_contain_any">Không chứa một trong các từ khoá</option>
                    </select>
                  </div>

                  <div className="stepper-form-group data-scan-page-inbox-keywords">
                    <label>Từ khoá</label>
                    <input
                      className="stepper-input"
                      value={pageInboxMessageKeywords}
                      onChange={event => setPageInboxMessageKeywords(event.target.value)}
                      placeholder="Mỗi từ khoá cách nhau bằng dấu phẩy"
                      disabled={pageInboxMessageFilterMode === 'all'}
                    />
                  </div>
                </div>

                <div className="data-scan-page-inbox-note">
                  <Info size={15} />
                  <span>
                    Facebook chỉ cho phép quét dữ liệu từ hôm nay trở về trước và không hỗ trợ bộ lọc khi quét. akaBiz sẽ quét tối đa là 100.000 data.
                  </span>
                </div>
              </>
            )}

            {isZaloRemarketingCustomersAction && (
              <div className="data-scan-zalo-remarketing-controls">
                <div className="stepper-form-group">
                  <label>Chọn hành động gửi tin nhắn</label>
                  <div className="data-scan-zalo-remarketing-action-dropdown" ref={zaloRemarketingActionDropdownRef}>
                    <button
                      type="button"
                      className={`data-scan-zalo-remarketing-action-trigger${zaloRemarketingActionDropdownOpen ? ' is-open' : ''}`}
                      onClick={() => setZaloRemarketingActionDropdownOpen(prev => !prev)}
                      disabled={loading}
                      aria-expanded={zaloRemarketingActionDropdownOpen}
                      title={zaloRemarketingActionFilterLabel}
                    >
                      <span>{zaloRemarketingActionFilterLabel}</span>
                      <ChevronDown size={15} />
                    </button>

                    {zaloRemarketingActionDropdownOpen && (
                      <div className="data-scan-zalo-remarketing-action-menu">
                        <button
                          type="button"
                          className={`data-scan-zalo-remarketing-action-option is-all${zaloRemarketingActionIds.length === ZALO_REMARKETING_ACTION_FILTER_OPTIONS.length ? ' selected' : ''}`}
                          onClick={toggleAllZaloRemarketingActionFilters}
                          role="menuitemcheckbox"
                          aria-checked={zaloRemarketingActionIds.length === ZALO_REMARKETING_ACTION_FILTER_OPTIONS.length}
                        >
                          <span className="data-scan-zalo-remarketing-action-check">
                            {zaloRemarketingActionIds.length === ZALO_REMARKETING_ACTION_FILTER_OPTIONS.length && <Check size={14} />}
                          </span>
                          <span className="data-scan-zalo-remarketing-action-label">Tất cả</span>
                        </button>
                        <div className="data-scan-zalo-remarketing-action-divider" />
                        {ZALO_REMARKETING_ACTION_FILTER_OPTIONS.map(option => {
                          const selected = zaloRemarketingActionIds.includes(option.value)
                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={`data-scan-zalo-remarketing-action-option${selected ? ' selected' : ''}`}
                              onClick={() => toggleZaloRemarketingActionFilter(option.value)}
                              role="menuitemcheckbox"
                              aria-checked={selected}
                            >
                              <span className="data-scan-zalo-remarketing-action-check">
                                {selected && <Check size={12} />}
                              </span>
                              <span className="data-scan-zalo-remarketing-action-label">{option.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="stepper-form-group">
                  <label>Từ ngày</label>
                  <input
                    type="date"
                    className="stepper-input"
                    value={zaloRemarketingDateFrom}
                    onChange={event => setZaloRemarketingDateFrom(event.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="stepper-form-group">
                  <label>Đến ngày</label>
                  <input
                    type="date"
                    className="stepper-input"
                    value={zaloRemarketingDateTo}
                    onChange={event => setZaloRemarketingDateTo(event.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            <div className="data-scan-options">
              <label className="schedule-checkbox-label">
                <input
                  type="checkbox"
                  checked={dedupeOnOutput}
                  onChange={event => setDedupeOnOutput(event.target.checked)}
                />
                <span>Lọc trùng dữ liệu khi chọn, xuất excel</span>
              </label>
              <span>
                {`${formatCount(pagedSelectedCount)} đã tích chọn`}
              </span>
              {selectedGroupIds.size > 0 && <span>{selectedGroupIds.size} nhóm đã chọn</span>}
            </div>
          </div>

          <div className="data-scan-pagination">
            <span className="data-scan-pagination-summary">{currentRenderText}</span>
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPageInboxPage(page => Math.max(1, page - 1))}
                disabled={pageInboxPage <= 1 || loading}
                title="Trang trước"
              >
                <ChevronLeft size={14} />
              </button>
              <span>Trang {Math.min(pageInboxPage, pageInboxPageCount)}/{pageInboxPageCount}</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPageInboxPage(page => Math.min(pageInboxPageCount, page + 1))}
                disabled={pageInboxPage >= pageInboxPageCount || loading}
                title="Trang sau"
              >
                <ChevronRight size={14} />
              </button>
            </>
          </div>

          {progressMessages.length > 0 && (
            <div className={`data-scan-progress${progressExpanded ? '' : ' is-collapsed'}`}>
              <button
                type="button"
                className="data-scan-progress-toggle"
                onClick={() => setProgressExpanded(prev => !prev)}
                title={progressExpanded ? 'Thu nhỏ nhật ký' : 'Phóng to nhật ký'}
                aria-label={progressExpanded ? 'Thu nhỏ nhật ký' : 'Phóng to nhật ký'}
              >
                {progressExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
              <div className="data-scan-progress-messages">
                {(progressExpanded ? progressMessages : progressMessages.slice(-1)).map((message, index) => (
                  <div key={`${message}-${index}`}>{message}</div>
                ))}
              </div>
            </div>
          )}

          <div className="stepper-grid-container data-scan-table-wrap">
            <table className="campaign-grid data-scan-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <input
                      type="checkbox"
                      checked={allMatchingSelected}
                      onChange={toggleAllVisible}
                      disabled={filteredContacts.length === 0}
                      title="Chọn hoặc bỏ chọn tất cả data phù hợp bộ lọc"
                      aria-label="Chọn hoặc bỏ chọn tất cả data phù hợp bộ lọc"
                    />
                  </th>
                  <th style={{ width: 64 }}>STT</th>
                  {isZaloRemarketingCustomersAction ? (
                    <>
                      <th>Tên Zalo</th>
                      <th>Số điện thoại</th>
                      <th>Zalo Id</th>
                      {showZaloTagColumn && <th>Tag Zalo</th>}
                      {showAkaBizTagColumn && <th>Tag akaBiz</th>}
                      <th>Tên group</th>
                      <th>Hành động của chiến dịch gần nhất</th>
                      <th>Số tin đã gửi</th>
                      <th>Ngày gửi</th>
                      <th>Ngày gửi gần nhất cách hôm nay số ngày</th>
                      <th>Trạng thái gửi tin gần nhất</th>
                      <th>Ghi chú gửi tin gần nhất</th>
                      <th>Trạng thái của người nhận trong tin nhắn gần nhất</th>
                    </>
                  ) : (
                    <>
                  {showAvatarColumn && <th className="data-scan-avatar-col">Ảnh đại diện</th>}
                  <th>Tên</th>
                  {showZaloPhoneColumn && <th>Số điện thoại</th>}
                  <th>{isPageInboxAction ? 'PSID' : 'UID'}</th>
                  {showZaloTagColumn && <th>Tag Zalo</th>}
                  {showAkaBizTagColumn && <th>Tag akaBiz</th>}
                  {isPageInboxAction ? (
                    <>
                      <th>SĐT</th>
                      <th>Tin nhắn cuối</th>
                      <th>Thời gian nhắn gần nhất</th>
                    </>
                  ) : null}
                  {showLinkColumn && <th>Link</th>}
                  {showZaloGroupMemberCountColumn && <th>Số thành viên</th>}
                  {showGroupMemberRoleColumn && <th>Vai trò</th>}
                  {showFriendStatusColumn && <th>Bạn bè</th>}
                  {actionDef.contactType === 'group' && <th>Tham gia</th>}
                  {showGroupApprovalColumn && <th>Duyệt bài</th>}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={tableColSpan} className="text-center">
                      <span className="data-scan-loading-cell">
                        <RefreshCw size={14} className="spin" />
                        {actionDef.loadingText}
                      </span>
                    </td>
                  </tr>
                ) : filteredContacts.length === 0 ? (
                  <tr><td colSpan={tableColSpan} className="text-center text-muted">{emptyTableText}</td></tr>
                ) : (
                  filteredContacts.map((contact, index) => {
                    const rowNumber = getContactRowNumber(index)
                    const selected = isContactSelected(contact.id, rowNumber)
                    return (
                    <tr
                      key={contact.id}
                      className={selected ? 'data-scan-selected-row' : undefined}
                      onClick={() => toggleContact(contact.id, rowNumber)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleContact(contact.id, rowNumber)}
                          onClick={event => event.stopPropagation()}
                        />
                      </td>
                      <td>{rowNumber}</td>
                      {isZaloRemarketingCustomersAction ? (
                        <>
                          <td className="data-scan-text-cell data-scan-name-cell" title={contact.name || undefined}>
                            {contact.name || '-'}
                          </td>
                          <td className="data-scan-text-cell data-scan-phone-cell" title={getZaloRemarketingPhone(contact) || undefined}>
                            {getZaloRemarketingPhone(contact) || '-'}
                          </td>
                          <td className="data-scan-text-cell data-scan-uid-cell" title={contact.uid || undefined}>
                            {contact.uid || '-'}
                          </td>
                          {showZaloTagColumn && (
                            <td className="data-scan-tag-cell">
                              {renderZaloTagCell(contact, zaloTagNameById)}
                            </td>
                          )}
                          {showAkaBizTagColumn && (
                            <td className="data-scan-tag-cell">
                              {renderAkaBizTagCell(contact, akaBizTagNameById)}
                            </td>
                          )}
                          <td className="data-scan-text-cell" title={getZaloRemarketingGroupName(contact) || undefined}>
                            {getZaloRemarketingGroupName(contact) || '-'}
                          </td>
                          <td className="data-scan-text-cell" title={getZaloRemarketingActionName(contact) || undefined}>
                            {getZaloRemarketingActionName(contact) || '-'}
                          </td>
                          <td className="data-scan-text-cell data-scan-number-cell">
                            {formatCount(getZaloRemarketingSentCount(contact))}
                          </td>
                          <td className="data-scan-text-cell data-scan-date-cell" title={getZaloRemarketingLatestDate(contact) || undefined}>
                            {getZaloRemarketingLatestDate(contact) || '-'}
                          </td>
                          <td className="data-scan-text-cell data-scan-number-cell">
                            {getZaloRemarketingDaysSinceLatest(contact) || '-'}
                          </td>
                          <td className="data-scan-text-cell" title={getZaloRemarketingLatestStatus(contact) || undefined}>
                            {getZaloRemarketingLatestStatus(contact) || '-'}
                          </td>
                          <td className="data-scan-text-cell data-scan-message-cell" title={getZaloRemarketingLatestLog(contact) || undefined}>
                            {getZaloRemarketingLatestLog(contact) || '-'}
                          </td>
                          <td className="data-scan-text-cell" title={getZaloRemarketingRecipientStatus(contact) || undefined}>
                            {getZaloRemarketingRecipientStatus(contact) || '-'}
                          </td>
                        </>
                      ) : (
                        <>
                          {showAvatarColumn && <td className="data-scan-avatar-col">{renderContactAvatar(contact)}</td>}
                          <td className="data-scan-text-cell data-scan-name-cell" title={contact.name || undefined}>
                            {contact.name || '-'}
                          </td>
                          {showZaloPhoneColumn && (
                            <td className="data-scan-text-cell data-scan-phone-cell" title={getContactPhoneText(contact) || undefined}>
                              {getContactPhoneText(contact) || '-'}
                            </td>
                          )}
                          <td className="data-scan-text-cell data-scan-uid-cell" title={contact.uid || undefined}>
                            {contact.uid || '-'}
                          </td>
                          {showZaloTagColumn && (
                            <td className="data-scan-tag-cell">
                              {renderZaloTagCell(contact, zaloTagNameById)}
                            </td>
                          )}
                          {showAkaBizTagColumn && (
                            <td className="data-scan-tag-cell">
                              {renderAkaBizTagCell(contact, akaBizTagNameById)}
                            </td>
                          )}
                          {isPageInboxAction ? (
                            <>
                              <td className="data-scan-text-cell data-scan-phone-cell" title={getPageInboxPhone(contact) || undefined}>
                                {getPageInboxPhone(contact) || '-'}
                              </td>
                              <td className="data-scan-text-cell data-scan-message-cell" title={getPageInboxLastMessage(contact) || undefined}>
                                {getPageInboxLastMessage(contact) || '-'}
                              </td>
                              <td className="data-scan-text-cell data-scan-date-cell" title={getPageInboxLastMessageAt(contact) || undefined}>
                                {getPageInboxLastMessageAt(contact) || '-'}
                              </td>
                            </>
                          ) : null}
                          {showLinkColumn && (
                            <td className="data-scan-text-cell data-scan-link-cell" title={contact.url || undefined}>
                              {contact.url || '-'}
                            </td>
                          )}
                          {showZaloGroupMemberCountColumn && (
                            <td className="data-scan-text-cell data-scan-number-cell" title={formatZaloGroupTotalMember(contact)}>
                              {formatZaloGroupTotalMember(contact)}
                            </td>
                          )}
                          {showGroupMemberRoleColumn && (
                            <td>
                              <span className="data-scan-status-badge">
                                {getZaloGroupMemberRoleLabel(contact)}
                              </span>
                            </td>
                          )}
                          {showFriendStatusColumn && (
                            <td>
                              <span className={`data-scan-status-badge ${contact.isFriend ? 'is-active' : 'is-muted'}`}>
                                {getContactStatusLabel(contact)}
                              </span>
                            </td>
                          )}
                          {actionDef.contactType === 'group' && (
                            <td>
                              <span className={`data-scan-status-badge ${contact.isJoined ? 'is-active' : 'is-muted'}`}>
                                {getContactStatusLabel(contact)}
                              </span>
                            </td>
                          )}
                          {showGroupApprovalColumn && (
                            <td>
                              <span className="data-scan-status-badge">{getGroupApprovalStatus(contact)}</span>
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="data-scan-below-actions">
            <div className="data-scan-range">
              <span>Chọn từ STT</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, currentTotalCount)}
                value={rangeStart}
                onChange={event => setRangeStart(Number(event.target.value) || 1)}
                className="stepper-input"
              />
              <span>đến</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, currentTotalCount)}
                value={rangeEnd}
                onChange={event => setRangeEnd(Number(event.target.value) || 1)}
                className="stepper-input"
              />
              <button className="btn btn-secondary" onClick={selectRange} disabled={currentTotalCount === 0}>Tích chọn</button>
            </div>
            {supportsContactGroups && (
              <div className="data-scan-group-actions">
                <button
                  className="btn btn-secondary data-scan-group-action-button"
                  onClick={() => setShowGroupPanel(true)}
                >
                  <Folder size={14} />
                  Xem nhóm data
                </button>
                <button
                  className="btn btn-secondary data-scan-group-action-button"
                  onClick={handleOpenAddGroupModal}
                  disabled={scanLoading}
                >
                  <Folder size={14} />
                  Thêm vào nhóm
                </button>
              </div>
            )}
          </div>

        </div>

        {supportsContactGroups && showGroupPanel && (
          <DataGroupManagerModal
            initialAccountId={typeof accountId === 'number' ? accountId : null}
            initialGroupId={activeContactGroup?.contactType === actionDef.contactType ? activeGroupId : null}
            initialPlatform={selectedPlatform}
            initialContactType={actionDef.contactType}
            lockContext
            zaloTagNameById={zaloTagNameById}
            akaBizTagNameById={akaBizTagNameById}
            onGroupsChanged={handleManagedContactGroupsChanged}
            onClose={() => setShowGroupPanel(false)}
          />
        )}

        {supportsContactGroups && showGroupSelectionModal && (
          <DataScanGroupSelectionModal
            contactType={actionDef.contactType}
            platform={selectedPlatform}
            groupsLoading={groupsLoading}
            contactGroups={allContactGroups}
            selectedGroupIds={selectedGroupIds}
            onClose={() => setShowGroupSelectionModal(false)}
            onToggleGroup={handleToggleGroupOutput}
            onConfirm={handleSelect}
          />
        )}

        {supportsContactGroups && showAddGroupModal && (
          <div
            className="data-scan-group-modal-backdrop"
            onClick={() => {
              if (!savingGroupMembers) closeAddGroupModal()
            }}
          >
            <div className="data-scan-group-modal" onClick={event => event.stopPropagation()}>
              <div className="data-scan-group-modal-header">
                <div>
                  <div className="data-scan-group-modal-title">Chọn nhóm</div>
                  <div className="data-scan-group-modal-subtitle">{formatCount(pagedSelectedCount)} data đã chọn</div>
                </div>
                <button
                  className="btn-icon"
                  onClick={closeAddGroupModal}
                  disabled={savingGroupMembers}
                  title="Đóng"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="data-scan-group-modal-body">
                <div className="data-scan-group-modal-label">Chọn nhóm</div>
                <div className="data-scan-group-modal-list">
                  {groupsLoading ? (
                    <div className="data-scan-group-empty">Đang tải nhóm data...</div>
                  ) : allContactGroups.length === 0 ? (
                    <div className="data-scan-group-empty">Chưa có nhóm data.</div>
                  ) : (
                    allContactGroups.map(group => {
                      const isCompatible = group.contactType === actionDef.contactType
                      return (
                      <label
                        key={group.id}
                        className={`data-scan-group-modal-option ${isCompatible ? '' : 'is-disabled'}`}
                      >
                        <input
                          type="checkbox"
                          checked={modalSelectedGroupIds.has(group.id)}
                          onChange={() => handleToggleModalGroup(group)}
                          disabled={savingGroupMembers || !isCompatible}
                        />
                        <span className="data-scan-group-modal-option-main">
                          <span className="data-scan-group-modal-option-name">{group.name}</span>
                          <span className="data-scan-contact-type-badge">{getContactTypeLabel(group.contactType, selectedPlatform)}</span>
                        </span>
                        <span className="data-scan-group-count">
                          {isCompatible ? `${group.contactCount || 0} data` : 'Không đúng loại'}
                        </span>
                      </label>
                      )
                    })
                  )}
                </div>

                {!showNewGroupInput ? (
                  <button
                    className="btn btn-secondary data-scan-new-group-toggle"
                    onClick={() => setShowNewGroupInput(true)}
                    disabled={savingGroupMembers}
                  >
                    <Plus size={14} />
                    Hoặc thêm mới nhóm
                  </button>
                ) : (
                  <div className="data-scan-new-group-row">
                    <input
                      className="stepper-input"
                      value={newGroupName}
                      onChange={event => setNewGroupName(event.target.value)}
                      placeholder="Tên nhóm mới..."
                      disabled={savingGroupMembers}
                      autoFocus
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setShowNewGroupInput(false)
                        setNewGroupName('')
                      }}
                      disabled={savingGroupMembers}
                    >
                      Chọn nhóm có sẵn
                    </button>
                  </div>
                )}
              </div>

              <div className="data-scan-group-modal-footer">
                <button className="btn btn-ghost" onClick={closeAddGroupModal} disabled={savingGroupMembers}>
                  Huỷ
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveSelectedToGroups}
                  disabled={!canSaveGroupModal || savingGroupMembers}
                >
                  <Folder size={14} />
                  {savingGroupMembers ? 'Đang lưu...' : 'Thêm vào nhóm và lưu'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer data-scan-footer">
          <button className="btn btn-secondary" onClick={handleExport}>
            <Download size={14} />
            Xuất Excel
          </button>
          <div className="data-scan-footer-right">
            <button className="btn btn-ghost" onClick={handleClose}>{onSelect ? 'Huỷ' : 'Đóng'}</button>
            {onSelect && supportsContactGroups && (
              <button
                className="btn btn-secondary"
                onClick={() => setShowGroupSelectionModal(true)}
              >
                <Folder size={14} />
                Chọn nhóm data
              </button>
            )}
            {onSelect && (
              <button className="btn btn-primary" onClick={handleSelect}>
                <Check size={14} />
                Chọn
              </button>
            )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
