import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import jsQR from 'jsqr'
import { Check, ChevronLeft, ChevronRight, Download, Folder, Info, Link2, Maximize2, Minimize2, Plus, QrCode, RefreshCw, Search, Square, X } from 'lucide-react'
import { utils, writeFile } from 'xlsx'
import { AutoAccountContact, AutoAccountContactGroup, ContactType, PageInboxMessageFilterMode, PageInboxPhoneFilter, ZaloGroupMemberScanMode } from '../../../../shared/types'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import DataScanGroupManagementModal from './DataScanGroupManagementModal'
import DataScanGroupSelectionModal from './DataScanGroupSelectionModal'

export type DataScanAction = 'facebook_friends' | 'facebook_groups' | 'facebook_pages' | 'facebook_post_commenters' | 'facebook_page_inbox_customers' | 'zalo_friends' | 'zalo_groups' | 'zalo_group_members'
type DataScanPlatform = 'facebook' | 'zalo'
type ContactStatusFilter = 'active' | 'inactive' | 'all'
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
const PAGE_INBOX_CUSTOMERS_ACTION_ID: DataScanAction = 'facebook_page_inbox_customers'
const ZALO_GROUP_MEMBERS_ACTION_ID: DataScanAction = 'zalo_group_members'
const DEFAULT_POST_COMMENTER_LIMIT = 100
const PAGE_INBOX_PAGE_SIZE = 100
const DEFAULT_PAGE_INBOX_TIME_PRESET: PageInboxTimePreset = '30_days'

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
  }
]

const getAvailableDataScanActions = (allowedActions?: DataScanAction[]) => {
  if (!allowedActions || allowedActions.length === 0) return DATA_SCAN_ACTIONS
  const allowed = new Set(allowedActions)
  const available = DATA_SCAN_ACTIONS.filter(item => allowed.has(item.id))
  return available.length > 0 ? available : DATA_SCAN_ACTIONS
}

const getInitialDataScanAction = (initialAction: DataScanAction, allowedActions?: DataScanAction[]) => {
  const available = getAvailableDataScanActions(allowedActions)
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

const getGroupApprovalStatus = (contact: AutoAccountContact) => {
  if (contact.requiresPostApproval === true) return 'Chờ duyệt bài'
  if (contact.requiresPostApproval === false) return 'Không cần duyệt'
  return 'Chưa biết'
}

const contactHasSourcePostUrl = (contact: AutoAccountContact, normalizedPostUrl: string) => {
  const extra = contact.extraData || {}
  if (normalizeFacebookPostUrlForCompare(extra.sourcePostUrl) === normalizedPostUrl) return true
  if (!Array.isArray(extra.sourcePostUrls)) return false
  return extra.sourcePostUrls.some(value => normalizeFacebookPostUrlForCompare(value) === normalizedPostUrl)
}

const getContactStatusLabel = (contact: AutoAccountContact) => {
  if (contact.contactType === 'person' && contact.extraData?.source === 'facebook_post_commenters') {
    return contact.isFriend ? 'Bạn bè' : 'Chưa xác định'
  }
  if (contact.contactType === 'person') return contact.isFriend ? 'Bạn bè' : 'Không còn bạn bè'
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
      { value: 'inactive', label: 'Không còn bạn bè' },
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
  onClose,
  onSelect
}: DataScanModalProps) {
  const { accounts, loadAccounts } = useCampaignStore()
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
  const [action, setAction] = useState<DataScanAction>(() => getInitialDataScanAction(initialAction, allowedActions))
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
  const [zaloQrReading, setZaloQrReading] = useState(false)
  const [progressMessages, setProgressMessages] = useState<string[]>([])
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
    () => getAvailableDataScanActions(allowedActions),
    [allowedActions]
  )
  const actionDef = useMemo(
    () => DATA_SCAN_ACTIONS.find(item => item.id === action) || DATA_SCAN_ACTIONS[0],
    [action]
  )
  const canSwitchLockedAction = !!allowedActions?.length && availableActions.length > 1
  const isPostCommentersAction = action === POST_COMMENTERS_ACTION_ID
  const isPageInboxAction = action === PAGE_INBOX_CUSTOMERS_ACTION_ID
  const isZaloGroupMembersAction = action === ZALO_GROUP_MEMBERS_ACTION_ID
  const supportsContactGroups = !isPageInboxAction
  const normalizedPostCommentersUrl = useMemo(
    () => normalizeFacebookPostUrlForCompare(postCommentersUrl),
    [postCommentersUrl]
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
  const showAvatarColumn = actionDef.platform === 'zalo'
  const showLinkColumn = !isPageInboxAction && (actionDef.platform === 'facebook' || actionDef.id === 'zalo_groups')
  const showZaloGroupMemberCountColumn = actionDef.id === 'zalo_groups'
  const showGroupMemberRoleColumn = isZaloGroupMembersAction
  const showFriendStatusColumn = actionDef.contactType === 'person' && !isZaloGroupMembersAction
  const statusFilterOptions = useMemo(
    () => getStatusFilterOptions(actionDef.contactType),
    [actionDef.contactType]
  )
  const hasStatusFilter = !isZaloGroupMembersAction && (actionDef.contactType === 'person' || actionDef.contactType === 'group')
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

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
    if (!availableActions.some(item => item.id === action)) {
      setAction(availableActions[0].id)
    }
  }, [action, availableActions])

  const loadZaloGroupMemberContactsForGroup = useCallback(async (groupId: string) => {
    if (!window.electronAPI || !accountId || !groupId) {
      setContacts([])
      setPageInboxTotal(0)
      return
    }
    setLoading(true)
    try {
      const data = await window.electronAPI.listZaloGroupMemberContacts(accountId, groupId)
      if (!mountedRef.current) return
      setContacts(data)
      setPageInboxTotal(0)
      setGroupContactCache({})
    } catch (err: any) {
      console.error('Failed to load Zalo group members:', err)
      if (mountedRef.current) {
        showAlert(err?.message || 'Không thể tải danh sách thành viên group Zalo.', 'error')
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [accountId, showAlert])

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

  const loadCachedContacts = useCallback(async () => {
    if (!window.electronAPI || !accountId) {
      contactsLoadIdRef.current += 1
      setContacts([])
      setPageInboxTotal(0)
      setLoading(false)
      return
    }
    const loadId = contactsLoadIdRef.current + 1
    contactsLoadIdRef.current = loadId
    setLoading(true)
    try {
      if (isPageInboxAction) {
        if (!pageInboxAppliedFilters.pageUid) {
          if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
          setContacts([])
          setPageInboxTotal(0)
          return
        }
        const result = await window.electronAPI.listPageInboxContacts(accountId, {
          pageUid: pageInboxAppliedFilters.pageUid,
          search: pageInboxAppliedFilters.search,
          phoneFilter: pageInboxAppliedFilters.phoneFilter,
          dateFrom: pageInboxAppliedFilters.dateFrom,
          dateTo: pageInboxAppliedFilters.dateTo,
          messageFilterMode: pageInboxAppliedFilters.messageFilterMode,
          messageKeywords: pageInboxAppliedFilters.messageKeywords,
          limit: PAGE_INBOX_PAGE_SIZE,
          offset: (pageInboxPage - 1) * PAGE_INBOX_PAGE_SIZE
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
        const data = await window.electronAPI.listZaloGroupMemberContacts(accountId, zaloGroupMemberGroupId)
        if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
        setContacts(data)
        setPageInboxTotal(0)
      } else {
        const data = await window.electronAPI.listContacts(accountId, actionDef.contactType)
        if (!mountedRef.current || contactsLoadIdRef.current !== loadId) return
        setContacts(data)
        setPageInboxTotal(0)
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
    isPageInboxAction,
    isZaloGroupMembersAction,
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
  }, [getPageInboxDraftFilters])

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
    setStatusFilter(isPostCommentersAction ? 'all' : (hasStatusFilter ? (initialStatusFilter || 'active') : 'all'))
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
  }, [action, hasStatusFilter, initialShowGroupPanel, initialStatusFilter, isPostCommentersAction])

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
      const groups = await window.electronAPI.listContacts(accountId, 'group')
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
      completedScanIdsRef.current.add(scanId)

      const wasStopped = stoppedScanIdsRef.current.has(scanId) || result.stopped
      setScanLoading(false)
      setMinimized(false)
      if (isPostCommentersAction && result.sourcePostUrl) {
        setPostCommentersUrl(String(result.sourcePostUrl))
      }
      if (isZaloGroupMembersAction && result.zaloGroupId) {
        setZaloGroupMemberGroupId(String(result.zaloGroupId))
      }
      if (isPageInboxAction) {
        applyPageInboxDraftFilters()
      } else if (isZaloGroupMembersAction && result.zaloGroupId) {
        loadZaloGroupMemberContactsForGroup(String(result.zaloGroupId))
        void loadZaloGroupOptions()
      } else {
        loadCachedContacts()
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
    applyPageInboxDraftFilters,
    isPageInboxAction,
    isPostCommentersAction,
    isZaloGroupMembersAction,
    loadCachedContacts,
    loadContactGroups,
    loadZaloGroupMemberContactsForGroup,
    loadZaloGroupOptions,
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
    if (!isPostCommentersAction) return contacts
    if (!normalizedPostCommentersUrl) return []
    return contacts.filter(contact => contactHasSourcePostUrl(contact, normalizedPostCommentersUrl))
  }, [contacts, isPostCommentersAction, normalizedPostCommentersUrl])

  const visibleContacts = useMemo(() => {
    return actionContacts.filter(matchesStatusFilter)
  }, [actionContacts, matchesStatusFilter])

  const filteredContacts = useMemo(() => {
    if (isPageInboxAction) return visibleContacts
    const query = search.trim().toLocaleLowerCase('vi-VN')
    if (!query) return visibleContacts
    return visibleContacts.filter(contact => [
      contact.name,
      contact.uid,
      contact.url,
      getContactInfo(contact),
      getContactStatusLabel(contact),
      isZaloGroupMembersAction ? getZaloGroupMemberRoleLabel(contact) : '',
      showGroupApprovalColumn ? getGroupApprovalStatus(contact) : ''
    ].some(value => String(value || '').toLocaleLowerCase('vi-VN').includes(query)))
  }, [isPageInboxAction, isZaloGroupMembersAction, search, showGroupApprovalColumn, visibleContacts])

  const getContactRowNumber = useCallback((index: number) => (
    isPageInboxAction ? (pageInboxPage - 1) * PAGE_INBOX_PAGE_SIZE + index + 1 : index + 1
  ), [isPageInboxAction, pageInboxPage])
  const isContactSelected = useCallback((contactId: number, rowNumber?: number) => {
    if (!isPageInboxAction) return selectedIds.has(contactId)
    if (pageInboxSelectAllMatching) return !pageInboxExcludedIds.has(contactId)
    if (pageInboxSelectedRange && rowNumber !== undefined) {
      const inRange = rowNumber >= pageInboxSelectedRange.start && rowNumber <= pageInboxSelectedRange.end
      return inRange ? !pageInboxExcludedIds.has(contactId) : selectedIds.has(contactId)
    }
    return selectedIds.has(contactId)
  }, [
    isPageInboxAction,
    pageInboxExcludedIds,
    pageInboxSelectAllMatching,
    pageInboxSelectedRange,
    selectedIds
  ])
  const allPageInboxMatchingSelected = isPageInboxAction && pageInboxTotal > 0 && pageInboxSelectAllMatching && pageInboxExcludedIds.size === 0
  const allVisibleSelected = filteredContacts.length > 0 && filteredContacts.every((contact, index) => (
    isContactSelected(contact.id, getContactRowNumber(index))
  ))
  const pageInboxSelectedCount = pageInboxSelectAllMatching
    ? Math.max(0, pageInboxTotal - pageInboxExcludedIds.size)
    : pageInboxSelectedRange
      ? Math.max(0, pageInboxSelectedRange.end - pageInboxSelectedRange.start + 1 - pageInboxExcludedIds.size) + selectedIds.size
      : selectedIds.size
  const currentTotalCount = isPageInboxAction ? pageInboxTotal : filteredContacts.length
  const selectedContacts = useMemo(
    () => visibleContacts.filter(contact => selectedIds.has(contact.id)),
    [selectedIds, visibleContacts]
  )
  const selectedGroupContacts = useMemo(() => {
    const rows: AutoAccountContact[] = []
    selectedGroupIds.forEach(groupId => {
      rows.push(...(groupContactCache[groupId] || []).filter(matchesStatusFilter))
    })
    return rows
  }, [groupContactCache, matchesStatusFilter, selectedGroupIds])
  const rawOutputContacts = useMemo(
    () => [...selectedContacts, ...selectedGroupContacts],
    [selectedContacts, selectedGroupContacts]
  )
  const outputContacts = useMemo(
    () => dedupeOnOutput ? dedupeContacts(rawOutputContacts) : rawOutputContacts,
    [dedupeOnOutput, rawOutputContacts]
  )
  const activeContactGroup = useMemo(
    () => allContactGroups.find(group => group.id === activeGroupId) || null,
    [activeGroupId, allContactGroups]
  )
  const activeGroupContactType = activeContactGroup?.contactType || actionDef.contactType
  const activeGroupShowApprovalColumn = activeGroupContactType === 'group' && selectedPlatform === 'facebook'
  const activeGroupShowAvatarColumn = selectedPlatform === 'zalo'
  const activeGroupShowLinkColumn = selectedPlatform === 'facebook' || (activeGroupContactType === 'group' && selectedPlatform === 'zalo')
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
      contact.url,
      getContactInfo(contact),
      getContactStatusLabel(contact),
      showZaloGroupMemberCountColumn ? formatZaloGroupTotalMember(contact) : '',
      contact.contactType === 'group' && selectedPlatform === 'facebook' ? getGroupApprovalStatus(contact) : ''
    ].some(value => String(value || '').toLocaleLowerCase('vi-VN').includes(query)))
  }, [groupContactsByStatus, search, selectedPlatform, showZaloGroupMemberCountColumn])
  const tableColSpan = isPageInboxAction
    ? 7
    : 4
      + (showAvatarColumn ? 1 : 0)
      + (showFriendStatusColumn ? 1 : 0)
      + (actionDef.contactType === 'group' ? 1 : 0)
      + (showGroupApprovalColumn ? 1 : 0)
      + (showGroupMemberRoleColumn ? 1 : 0)
      + (showLinkColumn ? 1 : 0)
      + (showZaloGroupMemberCountColumn ? 1 : 0)
  const groupTableColSpan = 4
    + (activeGroupShowAvatarColumn ? 1 : 0)
    + (activeGroupContactType === 'person' ? 1 : 0)
    + (activeGroupContactType === 'group' ? 1 : 0)
    + (activeGroupShowApprovalColumn ? 1 : 0)
    + (activeGroupShowLinkColumn ? 1 : 0)
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
    if (isPageInboxAction) {
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
    }

    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    if (isPageInboxAction) {
      if (pageInboxSelectAllMatching && pageInboxExcludedIds.size === 0) {
        handleClearPageInboxSelection()
      } else {
        handleSelectAllPageInboxMatching()
      }
      return
    }
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const contact of filteredContacts) next.delete(contact.id)
      } else {
        for (const contact of filteredContacts) next.add(contact.id)
      }
      return next
    })
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

    if (isPageInboxAction) {
      setPageInboxExcludedIds(new Set())
      setSelectedIds(new Set())
      if (start === 1 && end === pageInboxTotal) {
        setPageInboxSelectedRange(null)
        setPageInboxSelectAllMatching(true)
      } else {
        setPageInboxSelectAllMatching(false)
        setPageInboxSelectedRange({ start, end })
      }
      return
    }

    const contactsInRange = filteredContacts.slice(start - 1, end)
    setSelectedIds(new Set(contactsInRange.map(contact => contact.id)))
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

  const loadPageInboxSelectedContacts = async () => {
    if (!window.electronAPI || !accountId) return []
    if (pageInboxSelectAllMatching) {
      return window.electronAPI.exportPageInboxContacts(accountId, {
        ...pageInboxAppliedFilters,
        excludeIds: Array.from(pageInboxExcludedIds)
      })
    }
    if (pageInboxSelectedRange) {
      const rangeContacts = await window.electronAPI.exportPageInboxContacts(accountId, {
        ...pageInboxAppliedFilters,
        excludeIds: Array.from(pageInboxExcludedIds),
        offset: pageInboxSelectedRange.start - 1,
        limit: pageInboxSelectedRange.end - pageInboxSelectedRange.start + 1
      })
      const extraIds = Array.from(selectedIds)
      if (extraIds.length === 0) return rangeContacts
      const extraContacts = await window.electronAPI.exportPageInboxContacts(accountId, { ids: extraIds })
      return dedupeContacts([...rangeContacts, ...extraContacts])
    }
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return []
    return window.electronAPI.exportPageInboxContacts(accountId, { ids })
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
    if (selectedContacts.length === 0) {
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

    setScanLoading(true)
    setProgressMessages([])
    const scanId = scanRunIdRef.current + 1
    scanRunIdRef.current = scanId
    stoppedScanIdsRef.current.delete(scanId)
    completedScanIdsRef.current.delete(scanId)
    try {
      const result = isPostCommentersAction
        ? await window.electronAPI.loadPostCommenters(accountId, postCommentersUrl, postCommentersLimit)
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
      if (isZaloGroupMembersAction && result.zaloGroupId) {
        setZaloGroupMemberGroupId(String(result.zaloGroupId))
      }

      if (!result.success) {
        if (wasStopped) return
        showAlert(result.error || 'Tải data thất bại.', 'error')
        return
      }
      if (isPageInboxAction) {
        applyPageInboxDraftFilters()
      } else if (isZaloGroupMembersAction && result.zaloGroupId) {
        await loadZaloGroupMemberContactsForGroup(String(result.zaloGroupId))
        await loadZaloGroupOptions()
      } else {
        await loadCachedContacts()
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
      const exportContacts = isPageInboxAction ? await loadPageInboxSelectedContacts() : outputContacts
      if (exportContacts.length === 0) {
        showAlert('Vui lòng tích chọn data trước khi xuất Excel.', 'error')
        return
      }
      const rows = [
        isPageInboxAction ? ['Tên', 'PSID', 'SĐT', 'Ngày nhắn cuối', 'Tin nhắn cuối'] : EXPORT_HEADERS,
        ...exportContacts.map(contact => isPageInboxAction
          ? [
            contact.name || '',
            contact.uid || '',
            getPageInboxPhone(contact),
            getPageInboxLastMessageAt(contact),
            getPageInboxLastMessage(contact)
          ]
          : [
            contact.name || '',
            contact.uid || contact.url || ''
          ])
      ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = [
        { wch: 24 },
        { wch: isPageInboxAction ? 28 : 48 },
        ...(isPageInboxAction
          ? [
            { wch: 16 },
            { wch: 20 },
            { wch: 60 }
          ]
          : [])
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
      const selected = isPageInboxAction ? await loadPageInboxSelectedContacts() : outputContacts
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
                disabled={scanLoading}
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

            {hasStatusFilter && (
              <div className="stepper-form-group">
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

          {isPageInboxAction && (
            <>
              <div className="data-scan-page-inbox-controls">
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

          <div className="data-scan-toolbar">
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

            <div className="data-scan-toolbar-right">
              <label className="data-scan-search">
                <Search size={14} />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder={
                    isPageInboxAction
                      ? 'Tìm theo tên, PSID hoặc SĐT...'
                      : showLinkColumn
                        ? 'Tìm theo tên, UID hoặc link...'
                        : 'Tìm theo tên hoặc UID...'
                  }
                />
              </label>
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
                    !accountId
                    || (isPostCommentersAction && !postCommentersUrl.trim())
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
              {isPageInboxAction
                ? `${formatCount(pageInboxSelectedCount)} đã tích chọn`
                : `${formatCount(selectedIds.size)} đã tích chọn`}
            </span>
            {selectedGroupIds.size > 0 && <span>{selectedGroupIds.size} nhóm đã chọn</span>}
          </div>

          <div className="data-scan-pagination">
            <span className="data-scan-pagination-summary">{currentRenderText}</span>
            {isPageInboxAction && (
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
            )}
          </div>

          {progressMessages.length > 0 && (
            <div className="data-scan-progress">
              {progressMessages.map((message, index) => (
                <div key={`${message}-${index}`}>{message}</div>
              ))}
            </div>
          )}

          <div className="stepper-grid-container data-scan-table-wrap">
            <table className="campaign-grid data-scan-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <input
                      type="checkbox"
                      checked={isPageInboxAction ? allPageInboxMatchingSelected : allVisibleSelected}
                      onChange={toggleAllVisible}
                      disabled={filteredContacts.length === 0}
                      title={isPageInboxAction ? 'Chọn hoặc bỏ chọn tất cả data' : 'Chọn tất cả data đang hiển thị'}
                      aria-label={isPageInboxAction ? 'Chọn hoặc bỏ chọn tất cả data' : 'Chọn tất cả data đang hiển thị'}
                    />
                  </th>
                  <th style={{ width: 64 }}>STT</th>
                  {showAvatarColumn && <th className="data-scan-avatar-col">Ảnh đại diện</th>}
                  <th>Tên</th>
                  <th>{isPageInboxAction ? 'PSID' : 'UID'}</th>
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
                      {showAvatarColumn && <td className="data-scan-avatar-col">{renderContactAvatar(contact)}</td>}
                      <td className="data-scan-text-cell data-scan-name-cell" title={contact.name || undefined}>
                        {contact.name || '-'}
                      </td>
                      <td className="data-scan-text-cell data-scan-uid-cell" title={contact.uid || undefined}>
                        {contact.uid || '-'}
                      </td>
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
                    </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {supportsContactGroups && (
            <div className="data-scan-below-actions">
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

        {supportsContactGroups && showGroupPanel && (
          <DataScanGroupManagementModal
            activeContactType={activeGroupContactType}
            platform={selectedPlatform}
            groupsLoading={groupsLoading}
            contactGroups={allContactGroups}
            activeGroupId={activeGroupId}
            groupContactsLoading={groupContactsLoading}
            filteredGroupContacts={filteredGroupContacts}
            groupContactsByStatusCount={groupContactsByStatus.length}
            groupTableColSpan={groupTableColSpan}
            onClose={() => setShowGroupPanel(false)}
            onActivateGroup={handleActivateGroup}
            onRenameGroup={handleRenameContactGroup}
            onDeleteGroup={handleDeleteContactGroup}
            onRemoveContacts={handleRemoveFromActiveGroup}
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
                  <div className="data-scan-group-modal-subtitle">{selectedContacts.length} data đã chọn</div>
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
