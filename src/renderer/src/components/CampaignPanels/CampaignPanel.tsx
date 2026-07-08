import { useState, useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, RefreshCw, Settings2, Copy, ChevronDown, ChevronUp, Pause, Play, X, Download, Check, Search, Sparkles, Eye, LogIn, Info, History, CalendarDays, CircleDot, Monitor, Tags, AtSign, ListTodo, Upload, Users } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import {
  CAMPAIGN_STATUSES,
  getCampaignInputDataRequirement,
  type AddCampaignInputDataRowsResult,
  type AddCampaignInputDataToCampaignRequest,
  type AutoAccountContact,
  type AutoAccount,
  type Campaign,
  type CampaignAction,
  type CampaignImportPlatform,
  type CampaignDetail,
  type CampaignInputData,
  type CampaignInputStatus,
  type CampaignRelationSummary,
  type CampaignRunEvent,
  type EmailCampaignLinkTrackingSummary,
  type ZaloLoginQrEvent
} from '../../../../shared/types'
import { parseCampaignLogLine } from '../../../../shared/campaignLogFormat'
import { getVietnamMobileCarrier, getVietnamMobileCarrierLabel, normalizeVietnamMobilePhone } from '../../../../shared/phone'
import { utils, writeFile } from 'xlsx'
import CampaignFormModal from './CampaignFormModal'
import CampaignDataUploadModal from './CampaignDataUploadModal'
import ActionManagerModal from './ActionManagerModal'
import AccountInfoView from './AccountInfoView'
import CampaignInfoView from './CampaignInfoView'
import DataScanModal, { type DataScanAction } from '../DataScan/DataScanModal'
import type { GeneralSettingsMenu } from '../Settings/GeneralSettingsModal'
import { canUsePlatform } from '../../utils/entitlements'

interface CampaignPanelProps {
  isActive: boolean
  filterAccountId?: number | null
  onClearFilter?: () => void
  onOpenGeneralSettings?: (menu?: GeneralSettingsMenu) => void
  onOpenContentTemplates?: () => void
  onAskAssistant?: (campaignId: number) => void
}

type DetailTab = 'info' | 'data' | 'actions' | 'emailLinks' | 'runLog' | 'accountInfo' | 'foundData' | 'findDataLog' | 'postSearchLog' | 'findDataCampaigns' | 'sourceCampaigns'
type FoundDataKind = 'phone' | 'zalo' | 'uid' | 'postLink' | 'facebookGroup'
type CampaignTimePreset = 'all' | 'today' | 'yesterday' | '7_days' | '30_days' | 'this_month' | 'last_month' | '60_days' | '90_days' | 'custom'
type CampaignFilterDropdown = 'time' | 'account' | 'status' | 'platform' | 'action'
type DetailFilterDropdown = 'inputDataTime' | 'inputDataStatus' | 'actionsTime' | 'actionsStatus' | 'findDataLogScope'
type DetailTimePreset = 'all' | 'today' | 'yesterday' | '7_days' | '30_days' | 'custom'
type InputDataBatchStatus = Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>
type FindDataLogScope = 'visible' | 'all'

interface CampaignFilterOption {
  value: string
  label: string
  platform?: string
}

interface DetailFilterState {
  timePreset: DetailTimePreset
  dateFrom: string
  dateTo: string
  status: string
}

interface DetailPopoverPosition {
  top?: number
  bottom?: number
  left: number
  width: number
}

interface CampaignActionMenuPosition {
  top: number
  left: number
  maxHeight: number
}

interface CampaignActionMenuAnchorRect {
  top: number
  right: number
  bottom: number
}

interface RunLogEntry {
  key: string
  timestamp: string | undefined
  message: string
  screenshotEventId?: number
}

interface FoundDataPayload {
  phones: string[]
  linkGroupZalos: string[]
  uids: string[]
  postLinks: string[]
  groupMembers: FoundGroupMember[]
  facebookGroups: FoundFacebookGroup[]
  uidProfiles: FoundUidProfile[]
  phoneProfiles: FoundPhoneProfile[]
  groupUrl: string
  total: number
}

interface FoundGroupMember {
  uid: string
  name: string
  url: string
}

interface FoundUidProfile {
  uid: string
  name: string
  url: string
  source: string
}

interface FoundPhoneProfile {
  phone: string
  name: string
  uid: string
  url: string
  source: string
}

interface FoundFacebookGroup {
  url: string
  name: string
  privacy?: string
  memberCount?: number
  postsPerDay?: number
}

interface FoundDataItem {
  key: string
  kind: FoundDataKind
  label: string
  value: string
  name?: string
  groupUrl: string
  createdAt?: string
}

interface FindDataLogRow {
  key: string
  event: CampaignRunEvent
  timeLabel: string
  source: string
  action: string
  statusLabel: string
  statusColor: string
  elementCount: string
  itemIndex: string
  link: string
  name: string
  uid: string
  contentText: string
  phones: string
  zaloGroupLinks: string
  postLinks: string
  keyword: string
  matchedKeyword: string
  aiFinalPrompt: string
  aiRawResult: string
  aiMeaningCheck: string
}

const FOUND_DATA_TEMPLATE_HEADERS = ['Tên', 'Uid', 'Sđt', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
const CAMPAIGN_INPUT_DATA_EXPORT_HEADERS = ['Tên', 'Uid', 'Sđt', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
const SMS_CAMPAIGN_INPUT_DATA_EXPORT_HEADERS = ['Tên', 'Sđt', 'Nhà mạng', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5', 'Nội dung SMS', 'Lịch gửi']
const BLOCK_SCREENSHOT_EVENT_TYPE = 'browser_screenshot'
const FIND_DATA_LOG_EXPORT_HEADERS = [
  'Thời gian',
  'Nguồn',
  'Hành động',
  'Trạng thái',
  'Số lượng',
  'STT',
  'Link',
  'Tên',
  'UID',
  'Nội dung',
  'SĐT',
  'Link Zalo',
  'Link post',
  'Keyword',
  'Chứa keyword',
  'Prompt gửi AI',
  'Kết quả AI',
  'Kiểm tra ý nghĩa AI'
]

const formatInputDataPhoneCarrier = (row: Partial<Pick<CampaignInputData, 'phone' | 'phoneCarrier'>>): string => (
  getVietnamMobileCarrierLabel(row.phoneCarrier || getVietnamMobileCarrier(row.phone)) || '-'
)

interface SmsCampaignDetailInfo {
  phone: string
  carrier: string
  carrierLabel: string
  simSlot: string
  content: string
  providerMessageId: string
  errorCode: string
  errorMessage: string
  sentAt: string
  deliveredAt: string
  deviceId: string
}

const readDetailText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

const readDetailDataText = (data: Record<string, unknown> | undefined, ...keys: string[]): string => {
  if (!data) return ''
  for (const key of keys) {
    const value = readDetailText(data[key])
    if (value) return value
  }
  return ''
}

const getSmsCampaignDetailInfo = (detail: CampaignDetail): SmsCampaignDetailInfo => {
  const data = detail.data
  const phone = readDetailDataText(data, 'phone', 'targetPhone')
  const carrier = readDetailDataText(data, 'phoneCarrier', 'carrier')
  const simSlot = readDetailDataText(data, 'simSlot')
  return {
    phone,
    carrier,
    carrierLabel: getVietnamMobileCarrierLabel(carrier) || carrier || '-',
    simSlot: simSlot ? `SIM ${simSlot}` : '-',
    content: readDetailDataText(data, 'content', 'messageContent'),
    providerMessageId: readDetailDataText(data, 'providerMessageId'),
    errorCode: readDetailDataText(data, 'errorCode'),
    errorMessage: readDetailDataText(data, 'errorMessage'),
    sentAt: readDetailDataText(data, 'sentAt'),
    deliveredAt: readDetailDataText(data, 'deliveredAt'),
    deviceId: readDetailDataText(data, 'deviceId')
  }
}

const getSmsCampaignDetailTitle = (detail: CampaignDetail): string => {
  const sms = getSmsCampaignDetailInfo(detail)
  return [
    detail.log || '',
    sms.phone ? `SĐT: ${sms.phone}` : '',
    sms.carrierLabel !== '-' ? `Nhà mạng: ${sms.carrierLabel}` : '',
    sms.simSlot !== '-' ? `SIM: ${sms.simSlot}` : '',
    sms.content ? `Nội dung: ${sms.content}` : '',
    sms.sentAt ? `Đã gửi lúc: ${formatDisplayDateTime(sms.sentAt)}` : '',
    sms.deliveredAt ? `Đã nhận lúc: ${formatDisplayDateTime(sms.deliveredAt)}` : '',
    sms.errorMessage ? `Lỗi: ${sms.errorMessage}` : '',
    sms.errorCode ? `Mã lỗi: ${sms.errorCode}` : '',
    sms.providerMessageId ? `Provider ID: ${sms.providerMessageId}` : ''
  ].filter(Boolean).join('\n') || '-'
}

const POST_SEARCH_LOG_EXPORT_HEADERS = [
  'Thời gian',
  'Hành động',
  'Trạng thái',
  'STT',
  'Link bài',
  'Nội dung bài',
  'Keyword',
  'Chứa keyword',
  'Prompt gửi AI',
  'Kết quả AI',
  'Kiểm tra ý nghĩa AI'
]

const FOUND_DATA_EXPORT_OPTIONS: { kind: FoundDataKind; label: string }[] = [
  { kind: 'phone', label: 'SĐT' },
  { kind: 'uid', label: 'UID' },
  { kind: 'zalo', label: 'Link group Zalo' },
  { kind: 'postLink', label: 'Link bài post' },
  { kind: 'facebookGroup', label: 'Link group Facebook' }
]

const CAMPAIGN_TIME_PRESETS: Array<{ value: CampaignTimePreset; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'today', label: 'Hôm nay' },
  { value: 'yesterday', label: 'Hôm qua' },
  { value: '7_days', label: '7 ngày' },
  { value: '30_days', label: '30 ngày' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: '60_days', label: '60 ngày' },
  { value: '90_days', label: '90 ngày' },
  { value: 'custom', label: 'Tùy chọn' }
]

const ADD_INPUT_DATA_TIME_PRESETS: Array<{ value: CampaignTimePreset; label: string }> = CAMPAIGN_TIME_PRESETS

const DETAIL_TIME_PRESETS: Array<{ value: DetailTimePreset; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'today', label: 'Hôm nay' },
  { value: 'yesterday', label: 'Hôm qua' },
  { value: '7_days', label: '7 ngày' },
  { value: '30_days', label: '30 ngày' },
  { value: 'custom', label: 'Tùy chọn' }
]

const DEFAULT_CAMPAIGN_TIME_PRESET: CampaignTimePreset = '7_days'
const DEFAULT_DETAIL_TIME_PRESET: DetailTimePreset = 'all'
const DETAIL_POPOVER_GAP = 8
const DETAIL_POPOVER_MARGIN = 8
const DETAIL_POPOVER_MIN_WIDTH = 180
const DETAIL_OPTION_HEIGHT = 30
const DETAIL_OPTION_GAP = 4
const DETAIL_POPOVER_PADDING_Y = 16
const DETAIL_CUSTOM_DATE_GRID_HEIGHT = 92
const CAMPAIGN_ACTION_MENU_WIDTH = 230
const CAMPAIGN_ACTION_MENU_GAP = 6
const CAMPAIGN_ACTION_MENU_MARGIN = 8
const CAMPAIGN_ACTION_MENU_FALLBACK_HEIGHT = 260
const CAMPAIGN_ACTION_MENU_MIN_MAX_HEIGHT = 80
const FIND_DATA_GROUP_ACTION_ID = 'facebook_find_data_group'
const FIND_DATA_SEARCH_ACTION_ID = 'facebook_find_data_search'
const FIND_DATA_ACTION_IDS = new Set([FIND_DATA_GROUP_ACTION_ID, FIND_DATA_SEARCH_ACTION_ID])
const EMAIL_SEND_ACTION_ID = 'email_send'
const SMS_SEND_ACTION_ID = 'sms_send'
const FACEBOOK_GROUP_POST_ACTION_ID = 'facebook_group_post'
const FACEBOOK_PAGE_POST_ACTION_ID = 'facebook_page_post'
const FACEBOOK_MESSAGE_FRIEND_ACTION_ID = 'facebook_message_friend'
const FACEBOOK_MESSAGE_UID_ACTION_ID = 'facebook_message_uid'
const FACEBOOK_JOIN_GROUP_ACTION_ID = 'facebook_join_group'
const FACEBOOK_PAGE_INBOX_MESSAGE_ACTION_ID = 'facebook_page_to_message'
const COMMENT_SEEDING_FEED_ACTION_ID = 'facebook_comment_seeding'
const COMMENT_SEEDING_POST_ACTION_ID = 'facebook_comment_seeding_post'
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const ZALO_MESSAGE_FRIEND_ACTION_ID = 'zalo_message_friend'
const ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID = 'zalo_message_group_member'
const ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID = 'zalo_message_group_realtime'
const ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID = 'zalo_message_remarketing_customer'
const ZALO_MESSAGE_GROUP_ACTION_ID = 'zalo_message_group'
const ZALO_JOIN_GROUP_LINK_ACTION_ID = 'zalo_join_group_link'
const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID = 'zalo_cancel_sent_friend_request'
const ADD_DATA_UNSUPPORTED_ACTION_IDS = new Set([
  ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID,
  ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
])
const POST_SEARCH_LOG_EVENT_TYPES = ['extract_post_data', 'comment_seeding_post_search_summary']
const FIND_DATA_TARGET_FIELDS = [
  'findUidTargetCampaignIds',
  'findPostLinkTargetCampaignIds',
  'findPhoneZaloMessagePhoneTargetCampaignIds',
  'findZaloGroupLinkJoinTargetCampaignIds',
  'findFacebookGroupPostTargetCampaignIds',
  'findFacebookGroupCommentTargetCampaignIds',
  'findFacebookGroupJoinTargetCampaignIds'
] as const

const CAMPAIGN_STATUS_FILTER_OPTIONS: CampaignFilterOption[] = CAMPAIGN_STATUSES.map(status => ({
  value: status,
  label: status
}))

const INPUT_DATA_STATUS_FILTER_OPTIONS: CampaignFilterOption[] = CAMPAIGN_STATUSES.map(status => ({
  value: status,
  label: status
}))

const CAMPAIGN_DETAIL_STATUS_FILTER_OPTIONS: CampaignFilterOption[] = [
  { value: 'thành công', label: 'thành công' },
  { value: 'đã gửi', label: 'đã gửi' },
  { value: 'đã nhận', label: 'đã nhận' },
  { value: 'đã xem', label: 'đã xem' },
  { value: 'đã click', label: 'đã click' },
  { value: 'thất bại', label: 'thất bại' },
  { value: 'lỗi', label: 'lỗi' },
  { value: 'không tồn tại', label: 'không tồn tại' }
]

const CAMPAIGN_STATUS_SORT_ORDER = new Map<string, number>([
  ['đang chạy', 0],
  ['chờ xử lý', 1],
  ['tạm dừng', 2],
  ['hoàn thành', 3]
])

const CAMPAIGN_PLATFORM_OPTIONS: CampaignFilterOption[] = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'zalo', label: 'Zalo' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' }
]

const CAMPAIGN_PLATFORM_SORT_ORDER = new Map<string, number>([
  ['facebook', 0],
  ['zalo', 1],
  ['email', 2],
  ['sms', 3]
])

const DETAIL_DOCK_MIN_HEIGHT = 220
const DETAIL_DOCK_LIST_MIN_HEIGHT = 220
const DETAIL_DOCK_MAX_HEIGHT_RESERVE = 16
const CAMPAIGN_LIST_REFRESH_INTERVAL_MS = 10_000

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const canEditCampaign = (status: string) => status === 'chờ xử lý' || status === 'tạm dừng'
const canPauseCampaign = (status: string) => status === 'chờ xử lý' || status === 'đang chạy'
const canResumeCampaign = (status: string) => status === 'tạm dừng'
const canDeleteCampaign = (status: string) => status !== 'đang chạy'
const isAppWindowVisible = () => document.visibilityState === 'visible'

const formatIpcErrorMessage = (err: unknown, fallback: string): string => {
  const message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : ''

  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback
}

const toStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item || '').trim()).filter(Boolean)
}

const toNumberList = (value: unknown): number[] => {
  if (!Array.isArray(value)) return []
  return value
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && item > 0)
}

const uniqueNumbers = (values: number[]): number[] => Array.from(new Set(values))

const toGroupMemberList = (value: unknown): FoundGroupMember[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const members: FoundGroupMember[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const member = item as { uid?: unknown; name?: unknown; url?: unknown }
    const uid = String(member.uid || '').trim()
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    members.push({
      uid,
      name: String(member.name || '').trim(),
      url: String(member.url || '').trim()
    })
  }
  return members
}

const toUidProfileList = (value: unknown): FoundUidProfile[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const profiles: FoundUidProfile[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const profile = item as { uid?: unknown; name?: unknown; url?: unknown; source?: unknown }
    const uid = String(profile.uid || '').trim()
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    profiles.push({
      uid,
      name: String(profile.name || '').trim(),
      url: String(profile.url || '').trim(),
      source: String(profile.source || '').trim()
    })
  }
  return profiles
}

const toPhoneProfileList = (value: unknown): FoundPhoneProfile[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const profiles: FoundPhoneProfile[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const profile = item as { phone?: unknown; name?: unknown; uid?: unknown; url?: unknown; source?: unknown }
    const phone = String(profile.phone || '').trim()
    const key = phone.toLowerCase()
    if (!phone || seen.has(key)) continue
    seen.add(key)
    profiles.push({
      phone,
      name: String(profile.name || '').trim(),
      uid: String(profile.uid || '').trim(),
      url: String(profile.url || '').trim(),
      source: String(profile.source || '').trim()
    })
  }
  return profiles
}

const toFacebookGroupList = (value: unknown): FoundFacebookGroup[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const groups: FoundFacebookGroup[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const group = item as {
      url?: unknown
      name?: unknown
      privacy?: unknown
      memberCount?: unknown
      postsPerDay?: unknown
    }
    const url = String(group.url || '').trim()
    const key = url.replace(/\/+$/g, '').toLowerCase()
    if (!url || seen.has(key)) continue
    seen.add(key)
    const numberOrUndefined = (raw: unknown): number | undefined => {
      const value = Number(raw)
      return Number.isFinite(value) && value >= 0 ? value : undefined
    }
    groups.push({
      url,
      name: String(group.name || '').trim(),
      privacy: String(group.privacy || '').trim() || undefined,
      memberCount: numberOrUndefined(group.memberCount),
      postsPerDay: numberOrUndefined(group.postsPerDay)
    })
  }
  return groups
}

const getFindDataPayload = (detail: CampaignDetail): FoundDataPayload => {
  const data = detail.data || {}
  const phones = toStringList(data.phones)
  const linkGroupZalos = toStringList(data.linkGroupZalos)
  const uids = toStringList(data.uids)
  const postLinks = toStringList(data.postLinks)
  const groupMembers = toGroupMemberList(data.groupMembers)
  const facebookGroups = toFacebookGroupList(data.facebookGroups)
  const uidProfiles = toUidProfileList(data.uidProfiles)
  const phoneProfiles = toPhoneProfileList(data.phoneProfiles)
  const groupUrl = typeof data.groupUrl === 'string' ? data.groupUrl : ''
  return {
    phones,
    linkGroupZalos,
    uids,
    postLinks,
    groupMembers,
    facebookGroups,
    uidProfiles,
    phoneProfiles,
    groupUrl,
    total: phones.length + linkGroupZalos.length + uids.length + postLinks.length + groupMembers.length + facebookGroups.length
  }
}

const getFoundDataKindLabel = (kind: FoundDataKind) => {
  switch (kind) {
    case 'phone': return 'Số điện thoại'
    case 'zalo': return 'Link group Zalo'
    case 'uid': return 'UID'
    case 'postLink': return 'Link bài post'
    case 'facebookGroup': return 'Link group Facebook'
  }
}

const getJsonObject = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const getNestedJsonObject = (value: unknown, key: string): Record<string, unknown> => (
  getJsonObject(getJsonObject(value)[key])
)

const getStringValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

const getNestedStringValue = (value: unknown, ...keys: string[]): string => {
  let current: unknown = value
  for (const key of keys) {
    current = getJsonObject(current)[key]
  }
  return getStringValue(current)
}

const getScreenshotPath = (event: CampaignRunEvent): string => (
  getStringValue(getJsonObject(event.debugData).screenshotPath)
)

const getScreenshotResultLabel = (event: CampaignRunEvent): string => {
  const debug = getJsonObject(event.debugData)
  const display = getStringValue(debug.runResultDisplay) || getStringValue(event.message)
  if (display) return display

  const reason = getStringValue(debug.captureReason)
  switch (reason || String(event.status || '').toLowerCase()) {
    case 'success': return 'Thành công'
    case 'failure': return 'Lỗi/thất bại'
    case 'failed': return 'Lỗi/thất bại'
    case 'error': return 'Lỗi'
    default: return '-'
  }
}

const SCREENSHOT_EVENT_MARKER_RE = /\s*<!--\s*screenshotEventId:(\d+)\s*-->\s*$/i

const stripScreenshotEventMarker = (message: string): { message: string; screenshotEventId?: number } => {
  const text = String(message || '')
  const match = text.match(SCREENSHOT_EVENT_MARKER_RE)
  if (!match) return { message: text }
  const id = Number(match[1])
  return {
    message: text.replace(SCREENSHOT_EVENT_MARKER_RE, '').trimEnd(),
    screenshotEventId: Number.isFinite(id) && id > 0 ? id : undefined
  }
}

const getStringArrayValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map(item => getStringValue(item))
      .filter(Boolean)
  }
  const singleValue = getStringValue(value)
  return singleValue ? [singleValue] : []
}

const formatFindDataLogStatus = (status?: string | null) => {
  switch (String(status || '').toLowerCase()) {
    case 'success': return 'Thành công'
    case 'failed': return 'Lỗi'
    case 'skipped': return 'Bỏ qua'
    default: return status || '-'
  }
}

const getFindDataLogStatusColor = (status?: string | null) => {
  switch (String(status || '').toLowerCase()) {
    case 'success': return 'var(--accent-success)'
    case 'failed': return 'var(--accent-error)'
    case 'skipped': return 'var(--accent-warning)'
    default: return 'var(--text-tertiary)'
  }
}

const formatFindDataLogBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  const normalized = getStringValue(value).toLowerCase()
  if (!normalized) return '-'
  if (['true', '1', 'yes', 'co', 'có'].includes(normalized)) return 'Có'
  if (['false', '0', 'no', 'khong', 'không'].includes(normalized)) return 'Không'
  return getStringValue(value)
}

const isTruthyLogValue = (value: unknown) => {
  if (typeof value === 'boolean') return value
  const normalized = getStringValue(value).toLowerCase()
  return ['true', '1', 'yes', 'co', 'có'].includes(normalized)
}

const formatFindDataLogAiCheck = (value: unknown) => {
  const normalized = getStringValue(value).toLowerCase()
  switch (normalized) {
    case 'matched': return 'Đúng ý nghĩa'
    case 'not_matched': return 'Không đúng ý nghĩa'
    case 'error': return 'Lỗi AI'
    default: return getStringValue(value) || '-'
  }
}

const getFindDataLogSource = (event: CampaignRunEvent) => {
  const targetType = String(event.targetType || '').toLowerCase()
  const eventType = String(event.eventType || '').toLowerCase()
  const entityType = getNestedStringValue(event.extractedData, 'entity', 'type').toLowerCase()
  const sourceKey = entityType || targetType

  if (eventType === 'find_data_source_summary') return 'Tổng kết'
  if (sourceKey === 'post' || sourceKey === 'feed' || eventType.includes('post')) return 'Bài viết'
  if (sourceKey === 'comment' || eventType.includes('comment')) return 'Comment'
  if (sourceKey === 'member' || eventType.includes('member')) return 'Thành viên'
  if (sourceKey === 'group') return 'Group Facebook'
  return ''
}

const buildFindDataLogRow = (event: CampaignRunEvent): FindDataLogRow => {
  const extractedData = getJsonObject(event.extractedData)
  const filters = getNestedJsonObject(extractedData, 'filters')
  const values = getNestedJsonObject(extractedData, 'values')
  const debugData = getJsonObject(event.debugData)
  const eventType = String(event.eventType || '').toLowerCase()
  const link = getNestedStringValue(extractedData, 'entity', 'url') || event.targetUrl || ''
  const valueUids = getStringArrayValue(values.uids)
  const canHaveKeywordCheck = eventType === 'extract_post_data' || eventType === 'extract_comment_data'
  const keywordEnabled = canHaveKeywordCheck && isTruthyLogValue(filters.keywordEnabled)
  const aiFinalPrompt = getStringValue(filters.aiFinalPrompt) || getStringValue(debugData.aiFinalPrompt)
  const aiRawResult = getStringValue(filters.aiRawResult)
    || getStringValue(filters.aiResult)
    || getStringValue(debugData.aiRawResult)
    || getStringValue(debugData.aiResult)
  const aiMeaningCheck = formatFindDataLogAiCheck(filters.aiCheckResult ?? debugData.aiCheckResult)

  return {
    key: String(event.id),
    event,
    timeLabel: formatDisplayDateTime(event.createdAt),
    source: getFindDataLogSource(event),
    action: event.eventName || event.eventType || '-',
    statusLabel: formatFindDataLogStatus(event.status),
    statusColor: getFindDataLogStatusColor(event.status),
    elementCount: event.elementCount === null || event.elementCount === undefined ? '-' : String(event.elementCount),
    itemIndex: event.itemIndex === null || event.itemIndex === undefined ? '-' : String(event.itemIndex),
    link,
    name: getNestedStringValue(extractedData, 'entity', 'name'),
    uid: getNestedStringValue(extractedData, 'entity', 'uid') || valueUids[0] || '',
    contentText: getNestedStringValue(extractedData, 'entity', 'contentText'),
    phones: getStringArrayValue(values.phones).join(', '),
    zaloGroupLinks: getStringArrayValue(values.zaloGroupLinks).join(', '),
    postLinks: getStringArrayValue(values.postLinks).join(', '),
    keyword: keywordEnabled ? getStringValue(filters.keyword) : '',
    matchedKeyword: keywordEnabled ? formatFindDataLogBoolean(filters.matchedKeyword) : '-',
    aiFinalPrompt: aiFinalPrompt || '-',
    aiRawResult: aiRawResult || '-',
    aiMeaningCheck
  }
}

const normalizeFoundDataExportValue = (item: FoundDataItem) => {
  const value = String(item.value || '').trim()
  if (item.kind === 'phone') return value.replace(/[\s.\-()+]/g, '')
  if (item.kind === 'postLink') return value.replace(/\/+$/g, '').toLowerCase()
  if (item.kind === 'facebookGroup') return value.replace(/\/+$/g, '').toLowerCase()
  return value.toLowerCase()
}

const getUniqueFoundDataItems = (items: FoundDataItem[]) => {
  const map = new Map<string, FoundDataItem>()
  for (const item of items) {
    const normalizedValue = normalizeFoundDataExportValue(item)
    if (!normalizedValue) continue
    const key = `${item.kind}:${normalizedValue}`
    const existing = map.get(key)
    if (!existing || (!existing.name && item.name)) {
      map.set(key, item)
    }
  }
  return Array.from(map.values())
}

const formatDisplayDateTime = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const formatCount = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

const formatCompactDateTime = (value?: string | null): string => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (numberValue: number) => String(numberValue).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

const formatDateTimeLocal = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const toIsoDateTimeValue = (value?: string | null): string | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const cloneInputDataForNewCampaign = (row: CampaignInputData): Partial<CampaignInputData> => ({
  name: row.name || '',
  phone: row.phone || '',
  phoneCarrier: row.phoneCarrier || getVietnamMobileCarrier(row.phone) || null,
  uid: row.uid || '',
  email: row.email || '',
  content: row.content || '',
  status: 'chờ xử lý',
  note: ''
})

const formatDateInput = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const getCampaignDateRange = (preset: CampaignTimePreset, now = new Date()) => {
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
    case 'custom':
      fromDate.setDate(day.getDate() - 7)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(toDate) }
  }
}

const getDetailDateRange = (preset: DetailTimePreset, now = new Date()) => {
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
    case 'custom':
      fromDate.setDate(day.getDate() - 6)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(toDate) }
    case '30_days':
      fromDate.setDate(day.getDate() - 29)
      return { fromDate: formatDateInput(fromDate), toDate: formatDateInput(toDate) }
  }
}

const createDefaultDetailFilters = (): DetailFilterState => {
  const range = getDetailDateRange(DEFAULT_DETAIL_TIME_PRESET)
  return {
    timePreset: DEFAULT_DETAIL_TIME_PRESET,
    dateFrom: range.fromDate,
    dateTo: range.toDate,
    status: ''
  }
}

const parseDateInputBoundary = (value: string, boundary: 'start' | 'end') => {
  if (!value) return null
  const date = new Date(`${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}`)
  return Number.isNaN(date.getTime()) ? null : date
}

const parseCampaignListDateToBoundary = (value: string) => {
  const date = parseDateInputBoundary(value, 'end')
  if (!date) return null
  date.setDate(date.getDate() + 1)
  return date
}

const isWithinDateFilter = (value: string | undefined | null, dateStart: Date | null, dateEnd: Date | null) => {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  if (dateStart && date < dateStart) return false
  if (dateEnd && date > dateEnd) return false
  return true
}

const getCampaignInputDataFilterTime = (item: CampaignInputData, campaign: Campaign | null | undefined) => (
  item.dateAction || item.schedule || campaign?.schedule || ''
)

const toggleStringValue = (values: string[], value: string) => (
  values.includes(value)
    ? values.filter(item => item !== value)
    : [...values, value]
)

const getMultiSelectLabel = (options: CampaignFilterOption[], values: string[]) => {
  if (values.length === 0) return 'Tất cả'
  if (values.length === 1) {
    return options.find(option => option.value === values[0])?.label || values[0]
  }
  return `${values.length} đã chọn`
}

const renderCampaignFilterIcon = (key: CampaignFilterDropdown) => {
  if (key === 'time') return <CalendarDays size={17} />
  if (key === 'account') return <AtSign size={17} />
  if (key === 'status') return <CircleDot size={17} />
  if (key === 'platform') return <Monitor size={17} />
  return <Tags size={17} />
}

const formatDetailRangeDate = (value: string) => {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

const getCampaignRangeLabel = (preset: CampaignTimePreset, dateFrom: string, dateTo: string) => {
  if (preset === 'custom') {
    const startDate = formatDetailRangeDate(dateFrom)
    const endDate = formatDetailRangeDate(dateTo)
    if (startDate && endDate) return `${startDate} - ${endDate}`
    return 'Tùy chọn'
  }

  return CAMPAIGN_TIME_PRESETS.find(option => option.value === preset)?.label || 'Tất cả'
}

const getDetailRangeLabel = (filters: DetailFilterState) => {
  if (filters.timePreset === 'custom') {
    const startDate = formatDetailRangeDate(filters.dateFrom)
    const endDate = formatDetailRangeDate(filters.dateTo)
    if (startDate && endDate) return `${startDate} - ${endDate}`
    return 'Tùy chọn'
  }

  return DETAIL_TIME_PRESETS.find(option => option.value === filters.timePreset)?.label || 'Tất cả'
}

const getDetailStatusFilterLabel = (options: CampaignFilterOption[], status: string) => {
  if (!status) return 'Tất cả'
  return options.find(option => option.value === status)?.label || status
}

const getFindDataLogScopeLabel = (scope: FindDataLogScope) => (
  scope === 'all' ? 'Tất cả log' : 'Log tìm kiếm'
)

const getDetailOptionPopoverHeight = (optionCount: number, includesDateGrid = false) => (
  DETAIL_POPOVER_PADDING_Y
  + (optionCount * DETAIL_OPTION_HEIGHT)
  + (Math.max(0, optionCount - 1) * DETAIL_OPTION_GAP)
  + (includesDateGrid ? DETAIL_CUSTOM_DATE_GRID_HEIGHT : 0)
)

const DETAIL_TIME_POPOVER_HEIGHT = getDetailOptionPopoverHeight(DETAIL_TIME_PRESETS.length, true)

const getDetailPopoverPosition = (
  anchor: HTMLElement,
  minWidth = DETAIL_POPOVER_MIN_WIDTH,
  expectedHeight = getDetailOptionPopoverHeight(4)
): DetailPopoverPosition => {
  const rect = anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const maxWidth = Math.max(160, viewportWidth - DETAIL_POPOVER_MARGIN * 2)
  const width = Math.min(Math.max(rect.width, minWidth), maxWidth)
  const left = Math.min(
    Math.max(DETAIL_POPOVER_MARGIN, rect.left),
    Math.max(DETAIL_POPOVER_MARGIN, viewportWidth - width - DETAIL_POPOVER_MARGIN)
  )
  const spaceBelow = viewportHeight - rect.bottom - DETAIL_POPOVER_GAP - DETAIL_POPOVER_MARGIN
  const spaceAbove = rect.top - DETAIL_POPOVER_GAP - DETAIL_POPOVER_MARGIN
  if (spaceBelow < expectedHeight && spaceAbove > spaceBelow) {
    return {
      bottom: viewportHeight - rect.top + DETAIL_POPOVER_GAP,
      left,
      width
    }
  }

  return { top: rect.bottom + DETAIL_POPOVER_GAP, left, width }
}

const getCampaignActionMenuAnchorRect = (rect: DOMRect): CampaignActionMenuAnchorRect => ({
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom
})

const getCampaignActionMenuPosition = (
  anchor: CampaignActionMenuAnchorRect,
  menuSize: { width?: number; height?: number } = {}
): CampaignActionMenuPosition => {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const menuWidth = Math.max(CAMPAIGN_ACTION_MENU_WIDTH, menuSize.width || CAMPAIGN_ACTION_MENU_WIDTH)
  const expectedHeight = Math.max(0, menuSize.height || CAMPAIGN_ACTION_MENU_FALLBACK_HEIGHT)
  const maxLeft = Math.max(CAMPAIGN_ACTION_MENU_MARGIN, viewportWidth - menuWidth - CAMPAIGN_ACTION_MENU_MARGIN)
  const left = Math.min(
    Math.max(CAMPAIGN_ACTION_MENU_MARGIN, anchor.right - menuWidth),
    maxLeft
  )
  const spaceBelow = Math.max(0, viewportHeight - anchor.bottom - CAMPAIGN_ACTION_MENU_GAP - CAMPAIGN_ACTION_MENU_MARGIN)
  const spaceAbove = Math.max(0, anchor.top - CAMPAIGN_ACTION_MENU_GAP - CAMPAIGN_ACTION_MENU_MARGIN)
  const opensAbove = expectedHeight > spaceBelow && spaceAbove > spaceBelow
  const availableHeight = Math.max(
    CAMPAIGN_ACTION_MENU_MIN_MAX_HEIGHT,
    opensAbove ? spaceAbove : spaceBelow
  )
  const renderedHeight = Math.min(expectedHeight, availableHeight)
  const top = opensAbove
    ? Math.max(CAMPAIGN_ACTION_MENU_MARGIN, anchor.top - CAMPAIGN_ACTION_MENU_GAP - renderedHeight)
    : Math.min(
      Math.max(CAMPAIGN_ACTION_MENU_MARGIN, anchor.bottom + CAMPAIGN_ACTION_MENU_GAP),
      Math.max(CAMPAIGN_ACTION_MENU_MARGIN, viewportHeight - renderedHeight - CAMPAIGN_ACTION_MENU_MARGIN)
    )

  return { top, left, maxHeight: availableHeight }
}

const normalizeCampaignPlatform = (value: string | undefined | null) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  if (raw.includes('facebook') || raw === 'fb') return 'facebook'
  if (raw.includes('zalo')) return 'zalo'
  if (raw.includes('sms')) return 'sms'
  return raw
}

const inferCampaignPlatformFromActionId = (actionId: string) => {
  const normalized = actionId.toLowerCase()
  if (normalized.startsWith('facebook_')) return 'facebook'
  if (normalized.startsWith('zalo_')) return 'zalo'
  if (normalized.startsWith('sms_')) return 'sms'
  if (normalized.startsWith('email_')) return 'email'
  return ''
}

const getCampaignPlatformSortOrder = (platform: string | undefined | null) => {
  const normalized = normalizeCampaignPlatform(platform)
  return CAMPAIGN_PLATFORM_SORT_ORDER.get(normalized) ?? Number.MAX_SAFE_INTEGER
}

const compareCampaignFilterOptionsByPlatform = (left: CampaignFilterOption, right: CampaignFilterOption) => {
  const leftOrder = getCampaignPlatformSortOrder(left.platform)
  const rightOrder = getCampaignPlatformSortOrder(right.platform)
  if (leftOrder !== rightOrder) return leftOrder - rightOrder

  const leftPlatform = normalizeCampaignPlatform(left.platform)
  const rightPlatform = normalizeCampaignPlatform(right.platform)
  const platformCompare = leftPlatform.localeCompare(rightPlatform, 'vi')
  if (platformCompare !== 0) return platformCompare

  const labelCompare = left.label.localeCompare(right.label, 'vi', { sensitivity: 'base' })
  return labelCompare !== 0 ? labelCompare : left.value.localeCompare(right.value, 'vi')
}

const normalizeFilterText = (value: string | undefined | null) => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
)

const getCampaignListScheduleTypeLabel = (type: Campaign['scheduleType'] | undefined) => {
  if (type === 'weekly') return 'Hàng tuần'
  if (type === 'monthly') return 'Hàng tháng'
  return '1 lần'
}

const getCampaignInputProgress = (campaign: Campaign) => {
  const total = Math.max(0, Number(campaign.inputDataTotalCount ?? 0))
  const completed = Math.min(Math.max(0, Number(campaign.inputDataCompletedCount ?? 0)), total)
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
  return { completed, total, percentage }
}

const getCampaignTimeSortValue = (value: string | undefined | null) => {
  if (!value) return Number.POSITIVE_INFINITY
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

const shouldSortCampaignByLastRun = (status: string) => (
  status === 'tạm dừng' || status === 'hoàn thành'
)

const getCampaignListSortTime = (campaign: Campaign) => {
  if (shouldSortCampaignByLastRun(campaign.status)) {
    const lastRunTime = getCampaignTimeSortValue(campaign.lastRunAt)
    if (Number.isFinite(lastRunTime)) return lastRunTime
  }

  return getCampaignTimeSortValue(campaign.schedule)
}

const compareCampaignListOrder = (a: Campaign, b: Campaign) => {
  const statusA = CAMPAIGN_STATUS_SORT_ORDER.get(a.status) ?? CAMPAIGN_STATUS_SORT_ORDER.size
  const statusB = CAMPAIGN_STATUS_SORT_ORDER.get(b.status) ?? CAMPAIGN_STATUS_SORT_ORDER.size
  if (statusA !== statusB) return statusA - statusB

  const timeA = getCampaignListSortTime(a)
  const timeB = getCampaignListSortTime(b)
  if (timeA !== timeB) {
    if (!Number.isFinite(timeA)) return 1
    if (!Number.isFinite(timeB)) return -1
    return timeB - timeA
  }

  return b.id - a.id
}

const formatExportTimestamp = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('')
}

const sanitizeFileSegment = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'campaign'
}

const parseCampaignRunLog = (log: string): RunLogEntry[] => {
  const entries: RunLogEntry[] = []
  const lines = (log || '').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const text = line.trimEnd()
    if (!text.trim()) {
      const lastEntry = entries[entries.length - 1]
      if (lastEntry) lastEntry.message = `${lastEntry.message}\n`
      continue
    }
    const parsedLine = parseCampaignLogLine(text)
    if (parsedLine?.timestamp || (parsedLine && entries.length === 0)) {
      const parsedMessage = stripScreenshotEventMarker(parsedLine.message)
      entries.push({
        key: `${index}-${text}`,
        timestamp: parsedLine.timestamp,
        message: parsedMessage.message,
        screenshotEventId: parsedMessage.screenshotEventId
      })
      continue
    }

    const lastEntry = entries[entries.length - 1]
    if (lastEntry) {
      const parsedMessage = stripScreenshotEventMarker(`${lastEntry.message}\n${text.trimEnd()}`)
      lastEntry.message = parsedMessage.message
      if (parsedMessage.screenshotEventId) lastEntry.screenshotEventId = parsedMessage.screenshotEventId
    } else {
      const parsedMessage = stripScreenshotEventMarker(text.trim())
      entries.push({
        key: `${index}-${text}`,
        timestamp: undefined,
        message: parsedMessage.message,
        screenshotEventId: parsedMessage.screenshotEventId
      })
    }
  }
  return entries
}

interface AddInputDataModalSubmit {
  targetCampaignIds: number[]
  campaignSchedule: string
  campaignStatus: InputDataBatchStatus
}

interface AddInputDataToCampaignModalProps {
  campaigns: Campaign[]
  campaignActions: CampaignAction[]
  selectedCount: number
  onLoadCampaigns: () => Promise<void>
  onSubmit: (data: AddInputDataModalSubmit) => Promise<void>
  onClose: () => void
}

function AddInputDataToCampaignModal({
  campaigns,
  campaignActions,
  selectedCount,
  onLoadCampaigns,
  onSubmit,
  onClose
}: AddInputDataToCampaignModalProps) {
  const defaultRange = useMemo(() => getCampaignDateRange(DEFAULT_CAMPAIGN_TIME_PRESET), [])
  const [timePreset, setTimePreset] = useState<CampaignTimePreset>(DEFAULT_CAMPAIGN_TIME_PRESET)
  const [dateFrom, setDateFrom] = useState(defaultRange.fromDate)
  const [dateTo, setDateTo] = useState(defaultRange.toDate)
  const [actionId, setActionId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<number>>(new Set())
  const [campaignSchedule, setCampaignSchedule] = useState(() => formatDateTimeLocal(new Date()))
  const [campaignStatus, setCampaignStatus] = useState<InputDataBatchStatus>('chờ xử lý')
  const [submitting, setSubmitting] = useState(false)

  const actionOptions = useMemo(() => (
    campaignActions
      .filter(action => !!getCampaignInputDataRequirement(action.id))
      .map(action => ({ value: action.id, label: action.name || action.id }))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi'))
  ), [campaignActions])

  const targetCampaigns = useMemo(() => {
    if (!loaded || !actionId) return []
    const dateStart = parseDateInputBoundary(dateFrom, 'start')
    const dateEnd = parseDateInputBoundary(dateTo, 'end')
    const hasDateFilter = timePreset !== 'all' && (!!dateStart || !!dateEnd)

    return campaigns
      .filter(campaign => {
        if (campaign.actionId !== actionId) return false
        if (campaign.status === 'đang chạy') return false
        if (!getCampaignInputDataRequirement(campaign.actionId)) return false
        if (hasDateFilter) {
          if (!campaign.schedule) return false
          const scheduleDate = new Date(campaign.schedule)
          if (Number.isNaN(scheduleDate.getTime())) return false
          if (dateStart && scheduleDate < dateStart) return false
          if (dateEnd && scheduleDate > dateEnd) return false
        }
        return true
      })
      .sort(compareCampaignListOrder)
  }, [actionId, campaigns, dateFrom, dateTo, loaded, timePreset])

  useEffect(() => {
    setLoaded(false)
    setSelectedTargetIds(new Set())
  }, [actionId, timePreset, dateFrom, dateTo])

  const handleTimePresetChange = (value: CampaignTimePreset) => {
    if (value === 'custom') {
      if (!dateFrom || !dateTo) {
        const range = getCampaignDateRange(value)
        setDateFrom(range.fromDate)
        setDateTo(range.toDate)
      }
      setTimePreset(value)
      return
    }
    const range = getCampaignDateRange(value)
    setTimePreset(value)
    setDateFrom(range.fromDate)
    setDateTo(range.toDate)
  }

  const toggleTarget = (id: number) => {
    setSelectedTargetIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleLoad = async () => {
    if (!actionId) return
    setLoading(true)
    try {
      await onLoadCampaigns()
      setLoaded(true)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    const scheduleIso = toIsoDateTimeValue(campaignSchedule)
    if (!scheduleIso || selectedTargetIds.size === 0) return

    setSubmitting(true)
    try {
      await onSubmit({
        targetCampaignIds: Array.from(selectedTargetIds),
        campaignSchedule: scheduleIso,
        campaignStatus
      })
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = selectedTargetIds.size > 0 && !!toIsoDateTimeValue(campaignSchedule) && !submitting

  return (
    <div className="modal-overlay" style={{ zIndex: 2200 }} onMouseDown={onClose}>
      <div className="modal add-input-data-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Thêm data vào chiến dịch</div>
          <button className="btn-icon" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body add-input-data-modal-body">
          <div className="add-input-data-selected-count">
            Đã chọn <strong>{selectedCount}</strong> data nguồn
          </div>

          <div className="add-input-data-grid">
            <label className="stepper-form-group">
              <span>Khung thời gian</span>
              <select className="stepper-input" value={timePreset} onChange={event => handleTimePresetChange(event.target.value as CampaignTimePreset)}>
                {ADD_INPUT_DATA_TIME_PRESETS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="stepper-form-group">
              <span>Từ ngày</span>
              <input className="stepper-input" type="date" value={dateFrom} disabled={timePreset === 'all'} onChange={event => setDateFrom(event.target.value)} />
            </label>

            <label className="stepper-form-group">
              <span>Đến ngày</span>
              <input className="stepper-input" type="date" value={dateTo} disabled={timePreset === 'all'} onChange={event => setDateTo(event.target.value)} />
            </label>

            <label className="stepper-form-group add-input-data-full-row">
              <span>Loại chiến dịch</span>
              <select className="stepper-input" value={actionId} onChange={event => setActionId(event.target.value)}>
                <option value="">Chọn loại chiến dịch</option>
                {actionOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="add-input-data-load-row">
            <button className="btn btn-secondary" onClick={handleLoad} disabled={!actionId || loading}>
              {loading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
              Load chiến dịch
            </button>
          </div>

          <div className="stepper-form-group">
	            <span>Danh sách chiến dịch</span>
            <div className="add-input-data-target-list">
              {!loaded ? (
                <div className="text-muted add-input-data-empty">Bấm Load chiến dịch để xem danh sách chiến dịch.</div>
	              ) : targetCampaigns.length === 0 ? (
	                <div className="text-muted add-input-data-empty">Không có chiến dịch phù hợp.</div>
	              ) : (
	                <div className="add-input-data-target-table">
		                  <div className="add-input-data-target-header">
		                    <span></span>
		                    <span>Tên chiến dịch</span>
		                    <span>Tài khoản</span>
		                    <span>Trạng thái</span>
		                    <span>Lịch chạy</span>
		                  </div>
	                  {targetCampaigns.map(campaign => {
	                    const selected = selectedTargetIds.has(campaign.id)
	                    return (
	                      <div
	                        key={campaign.id}
	                        className={`add-input-data-target-row${selected ? ' is-selected' : ''}`}
	                        role="checkbox"
	                        aria-checked={selected}
	                        tabIndex={0}
	                        onClick={() => toggleTarget(campaign.id)}
	                        onKeyDown={event => {
	                          if (event.key === 'Enter' || event.key === ' ') {
	                            event.preventDefault()
	                            toggleTarget(campaign.id)
	                          }
	                        }}
	                      >
	                        <span className="add-input-data-target-check">
	                          <input
	                            type="checkbox"
	                            checked={selected}
	                            onClick={event => event.stopPropagation()}
	                            onKeyDown={event => event.stopPropagation()}
	                            onChange={() => toggleTarget(campaign.id)}
	                          />
		                        </span>
		                        <span className="add-input-data-target-main">
		                          <span className="add-input-data-target-name" title={campaign.name}>{campaign.name}</span>
		                        </span>
		                        <span className="add-input-data-target-account" title={campaign.accountName || '-'}>
		                          {campaign.accountName || 'Không rõ tài khoản'}
		                        </span>
		                        <span className="add-input-data-target-status-badge">{campaign.status}</span>
	                        <span className="add-input-data-target-schedule" title={formatCompactDateTime(campaign.schedule)}>
	                          {formatCompactDateTime(campaign.schedule)}
	                        </span>
	                      </div>
	                    )
	                  })}
	                </div>
	              )}
            </div>
          </div>

          <div className="add-input-data-grid">
            <label className="stepper-form-group">
              <span>Lịch chạy</span>
              <input className="stepper-input" type="datetime-local" value={campaignSchedule} onChange={event => setCampaignSchedule(event.target.value)} />
            </label>

            <label className="stepper-form-group">
              <span>Trạng thái chiến dịch</span>
              <select className="stepper-input" value={campaignStatus} onChange={event => setCampaignStatus(event.target.value as InputDataBatchStatus)}>
                <option value="chờ xử lý">chờ xử lý</option>
                <option value="tạm dừng">tạm dừng</option>
              </select>
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
            Thêm
          </button>
        </div>
      </div>
    </div>
  )
}

type AddCampaignDataScanMode = 'friends' | 'users' | 'groups' | 'pages' | 'pageInboxCustomers' | 'pageInboxPhones' | 'zaloRemarketingCustomers'

interface AddCampaignDataScanSource {
  key: string
  label: string
  action: DataScanAction
  mode: AddCampaignDataScanMode
  initialStatusFilter?: 'active' | 'inactive' | 'all'
  initialPageInboxPageUid?: string
  initialPageInboxPageName?: string
  allowedActions?: DataScanAction[]
  lockAccount?: boolean
  lockPageInboxPage?: boolean
}

interface AddDataToCurrentCampaignModalProps {
  campaign: Campaign
  campaignAction?: CampaignAction
  account?: AutoAccount | null
  onSubmit: (request: {
    campaignId: number
    rows: Partial<CampaignInputData>[]
    campaignSchedule: string
    campaignStatus: InputDataBatchStatus
    skipExistingInCampaign: boolean
  }) => Promise<AddCampaignInputDataRowsResult>
  onClose: () => void
}

const isAddDataSupportedForCampaign = (campaign?: Campaign | null): boolean => (
  !!campaign &&
  !!getCampaignInputDataRequirement(campaign.actionId) &&
  !ADD_DATA_UNSUPPORTED_ACTION_IDS.has(campaign.actionId)
)

const getAddDataImportPlatform = (campaign: Campaign, action?: CampaignAction): CampaignImportPlatform => {
  if (campaign.actionId === SMS_SEND_ACTION_ID) return 'sms'
  if (campaign.actionId === EMAIL_SEND_ACTION_ID) return 'email'
  if (action?.flatformType === 'zalo') return 'zalo'
  return 'facebook'
}

const canImportDataForCampaign = (campaign: Campaign, action?: CampaignAction): boolean => {
  if (!isAddDataSupportedForCampaign(campaign)) return false
  if (campaign.actionId === FACEBOOK_PAGE_INBOX_MESSAGE_ACTION_ID) return false
  if ([
    ZALO_MESSAGE_FRIEND_ACTION_ID,
    ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID,
    ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID,
    ZALO_MESSAGE_GROUP_ACTION_ID
  ].includes(campaign.actionId)) return false
  if (campaign.actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID) return true
  return action?.flatformType !== 'zalo' || campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID
}

const getAddDataScanSources = (campaign: Campaign): AddCampaignDataScanSource[] => {
  switch (campaign.actionId) {
    case FACEBOOK_MESSAGE_FRIEND_ACTION_ID:
      return [{
        key: 'facebook_friends',
        label: 'Chọn bạn bè',
        action: 'facebook_friends',
        mode: 'friends',
        allowedActions: ['facebook_friends']
      }]
    case ZALO_MESSAGE_FRIEND_ACTION_ID:
      return [{
        key: 'zalo_friends',
        label: 'Chọn bạn bè Zalo',
        action: 'zalo_friends',
        mode: 'friends',
        initialStatusFilter: 'active',
        allowedActions: ['zalo_friends'],
        lockAccount: true
      }]
    case FACEBOOK_MESSAGE_UID_ACTION_ID:
      return [{
        key: 'facebook_users',
        label: 'Chọn data',
        action: 'facebook_friends',
        mode: 'users',
        initialStatusFilter: 'all',
        allowedActions: ['facebook_friends', 'facebook_post_commenters', 'facebook_post_likes', 'facebook_profile_friends', 'facebook_group_members']
      }]
    case FACEBOOK_PAGE_INBOX_MESSAGE_ACTION_ID:
      return [{
        key: 'page_inbox_customers',
        label: 'Chọn khách inbox Page',
        action: 'facebook_page_inbox_customers',
        mode: 'pageInboxCustomers',
        initialStatusFilter: 'all',
        initialPageInboxPageUid: String(campaign.extraSettings?.pageInboxPageUid || ''),
        initialPageInboxPageName: String(campaign.extraSettings?.pageInboxPageName || ''),
        allowedActions: ['facebook_page_inbox_customers'],
        lockAccount: true,
        lockPageInboxPage: true
      }]
    case ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID:
      return [{
        key: 'zalo_group_members',
        label: 'Chọn thành viên group Zalo',
        action: 'zalo_group_members',
        mode: 'users',
        initialStatusFilter: 'all',
        allowedActions: ['zalo_group_members'],
        lockAccount: true
      }]
    case ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID:
      return [{
        key: 'zalo_remarketing_customers',
        label: 'Chọn khách hàng cũ Zalo',
        action: 'zalo_remarketing_customers',
        mode: 'zaloRemarketingCustomers',
        initialStatusFilter: 'all',
        allowedActions: ['zalo_remarketing_customers'],
        lockAccount: true
      }]
    case ZALO_MESSAGE_GROUP_ACTION_ID:
      return [{
        key: 'zalo_groups',
        label: 'Chọn group Zalo',
        action: 'zalo_groups',
        mode: 'groups',
        initialStatusFilter: 'active',
        allowedActions: ['zalo_groups'],
        lockAccount: true
      }]
    case FACEBOOK_GROUP_POST_ACTION_ID:
    case FACEBOOK_JOIN_GROUP_ACTION_ID:
    case FIND_DATA_GROUP_ACTION_ID:
    case COMMENT_SEEDING_FEED_ACTION_ID:
      return [{
        key: 'facebook_groups',
        label: 'Chọn nhóm',
        action: 'facebook_groups',
        mode: 'groups',
        initialStatusFilter: 'all',
        allowedActions: ['facebook_groups']
      }]
    case FACEBOOK_PAGE_POST_ACTION_ID:
      return [{
        key: 'facebook_pages',
        label: 'Chọn page',
        action: 'facebook_pages',
        mode: 'pages',
        initialStatusFilter: 'all',
        allowedActions: ['facebook_pages']
      }]
    case ZALO_MESSAGE_PHONE_ACTION_ID:
    case SMS_SEND_ACTION_ID:
      return [{
        key: 'page_inbox_phones',
        label: 'Từ người inbox fanpage',
        action: 'facebook_page_inbox_customers',
        mode: 'pageInboxPhones',
        initialStatusFilter: 'all',
        allowedActions: ['facebook_page_inbox_customers']
      }]
    default:
      return []
  }
}

function AddDataToCurrentCampaignModal({
  campaign,
  campaignAction,
  account,
  onSubmit,
  onClose
}: AddDataToCurrentCampaignModalProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const [rows, setRows] = useState<Partial<CampaignInputData>[]>([])
  const [showDataUploadModal, setShowDataUploadModal] = useState(false)
  const [dataScanPicker, setDataScanPicker] = useState<AddCampaignDataScanSource | null>(null)
  const [campaignSchedule, setCampaignSchedule] = useState(() => {
    const date = new Date(campaign.schedule || campaign.originalSchedule || Date.now())
    return formatDateTimeLocal(Number.isNaN(date.getTime()) ? new Date() : date)
  })
  const [campaignStatus, setCampaignStatus] = useState<InputDataBatchStatus>(
    campaign.status === 'tạm dừng' ? 'tạm dừng' : 'chờ xử lý'
  )
  const [skipExistingInCampaign, setSkipExistingInCampaign] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const importPlatform = useMemo(() => getAddDataImportPlatform(campaign, campaignAction), [campaign, campaignAction])
  const canImportData = useMemo(() => canImportDataForCampaign(campaign, campaignAction), [campaign, campaignAction])
  const scanSources = useMemo(() => getAddDataScanSources(campaign), [campaign])

  const appendRows = (nextRows: Partial<CampaignInputData>[]) => {
    if (nextRows.length === 0) {
      showAlert('Không có data hợp lệ để thêm.', 'error')
      return
    }
    setRows(prev => [
      ...prev,
      ...nextRows.map(row => ({
        ...row,
        phoneCarrier: row.phoneCarrier || getVietnamMobileCarrier(row.phone) || null,
        status: 'chờ xử lý' as CampaignInputStatus,
        note: ''
      }))
    ])
    showAlert(`Đã thêm ${nextRows.length} data vào danh sách chờ thêm.`, 'success')
  }

  const removeRow = (index: number) => {
    setRows(prev => prev.filter((_, rowIndex) => rowIndex !== index))
  }

  const clearRows = () => {
    if (rows.length === 0) return
    setRows([])
    showAlert('Đã xoá tất cả data chờ thêm.', 'success')
  }

  const validatePageInboxContacts = (contacts: AutoAccountContact[]): boolean => {
    const campaignPageUid = String(campaign.extraSettings?.pageInboxPageUid || '').trim()
    if (!campaignPageUid) {
      showAlert('Chiến dịch này chưa có Page nhận inbox. Vui lòng kiểm tra lại cấu hình chiến dịch.', 'error')
      return false
    }
    const pageUids = new Set(
      contacts
        .filter(contact => contact.contactType === 'page_inbox_customer')
        .map(contact => String(contact.extraData?.pageUid || '').trim())
        .filter(Boolean)
    )
    if (pageUids.size !== 1 || !pageUids.has(campaignPageUid)) {
      showAlert('Vui lòng chỉ chọn khách inbox đúng Page của chiến dịch hiện tại.', 'error')
      return false
    }
    return true
  }

  const handleScanSelected = (contacts: AutoAccountContact[]) => {
    if (!dataScanPicker) return
    if (dataScanPicker.mode === 'pageInboxCustomers' && !validatePageInboxContacts(contacts)) return

    let nextRows: Partial<CampaignInputData>[] = []
    if (dataScanPicker.mode === 'friends' || dataScanPicker.mode === 'users') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'person')
        .map(contact => ({
          name: contact.name,
          uid: dataScanPicker.action.startsWith('zalo_') ? (contact.uid || contact.url || '') : (contact.url || contact.uid || ''),
          phone: String(contact.extraData?.phone || ''),
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    } else if (dataScanPicker.mode === 'groups') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'group')
        .map(contact => ({
          name: contact.name,
          uid: dataScanPicker.action.startsWith('zalo_')
            ? (contact.uid || contact.url || '')
            : (contact.url || (contact.uid ? `https://www.facebook.com/groups/${contact.uid}` : '')),
          phone: '',
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    } else if (dataScanPicker.mode === 'pages') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'page')
        .map(contact => ({
          name: contact.name,
          uid: contact.uid || '',
          phone: '',
          email: contact.url || '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    } else if (dataScanPicker.mode === 'pageInboxCustomers') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'page_inbox_customer')
        .map(contact => ({
          name: contact.name,
          uid: contact.uid || '',
          phone: String(contact.extraData?.phone || ''),
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    } else if (dataScanPicker.mode === 'pageInboxPhones') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'page_inbox_customer')
        .map(contact => ({
          name: contact.name,
          uid: '',
          phone: normalizeVietnamMobilePhone(contact.extraData?.phone),
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
        .filter(row => !!row.phone)
    } else if (dataScanPicker.mode === 'zaloRemarketingCustomers') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'person')
        .map(contact => ({
          name: contact.name,
          uid: contact.uid || contact.url || '',
          phone: String(contact.extraData?.phone || '').trim(),
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    }

    appendRows(nextRows)
  }

  const handleSubmit = async () => {
    const scheduleIso = toIsoDateTimeValue(campaignSchedule)
    if (!scheduleIso) {
      showAlert('Lịch chạy không hợp lệ.', 'error')
      return
    }
    if (rows.length === 0) {
      showAlert('Vui lòng thêm ít nhất một data.', 'error')
      return
    }
    setSubmitting(true)
    try {
      const result = await onSubmit({
        campaignId: campaign.id,
        rows,
        campaignSchedule: scheduleIso,
        campaignStatus,
        skipExistingInCampaign
      })
      const skippedParts = [
        result.skippedBatchDuplicateCount > 0 ? `${result.skippedBatchDuplicateCount} trùng trong danh sách vừa chọn` : '',
        result.skippedExistingCount > 0 ? `${result.skippedExistingCount} đã có trong chiến dịch` : '',
        result.skippedInvalidCount > 0 ? `${result.skippedInvalidCount} không hợp lệ` : ''
      ].filter(Boolean)
      const skippedText = skippedParts.length > 0 ? ` Bỏ qua ${skippedParts.join(', ')}.` : ''
      if (result.insertedCount === 0) {
        showAlert(`Không có data nào được thêm.${skippedText}`, 'error')
        return
      }
      showAlert(`Đã thêm ${result.insertedCount} data vào chiến dịch.${skippedText}`, 'success')
      onClose()
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể thêm data vào chiến dịch.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 2200 }} onMouseDown={onClose}>
      <div className="modal add-current-data-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Thêm data</div>
          <button className="btn-icon" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body add-current-data-modal-body">
          <div className="add-current-data-campaign-name" title={campaign.name}>
            Chiến dịch: <strong>{campaign.name}</strong>
          </div>

          <div className="add-current-data-source-row">
            {canImportData && (
              <button className="btn btn-secondary" type="button" onClick={() => setShowDataUploadModal(true)}>
                <Upload size={14} /> Nhập/import data
              </button>
            )}
            {scanSources.map(source => (
              <button
                key={source.key}
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  if (!account?.id && source.mode !== 'pageInboxPhones') {
                    showAlert('Chiến dịch chưa có tài khoản hợp lệ để chọn data.', 'error')
                    return
                  }
                  setDataScanPicker(source)
                }}
              >
                <Users size={14} /> {source.label}
              </button>
            ))}
          </div>

          <div className="stepper-form-group">
            <div className="add-current-data-preview-header">
              <span>Data chờ thêm</span>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={clearRows}
                disabled={rows.length === 0}
                title="Xoá tất cả data chờ thêm"
              >
                <Trash2 size={13} /> Xoá tất cả
              </button>
            </div>
            <div className="add-current-data-preview">
              {rows.length === 0 ? (
                <div className="text-muted add-input-data-empty">Chưa có data nào. Hãy nhập/import hoặc chọn từ kho data đã quét.</div>
              ) : (
                <table className="campaign-grid">
                  <thead>
                    <tr>
                      <th className="campaign-grid-index-col">STT</th>
                      <th>Tên</th>
                      <th>Số điện thoại</th>
                      <th>UID/link</th>
                      <th>Email</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${index}-${row.uid || row.phone || row.email || row.name || 'row'}`}>
                        <td className="campaign-grid-index-col">{index + 1}</td>
                        <td title={row.name || ''}>{row.name || '-'}</td>
                        <td title={row.phone || ''}>{row.phone || '-'}</td>
                        <td title={row.uid || ''}>{row.uid || '-'}</td>
                        <td title={row.email || ''}>{row.email || '-'}</td>
                        <td>
                          <button className="btn-icon text-error" onClick={() => removeRow(index)} title="Xoá data">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="add-input-data-grid">
            <label className="stepper-form-group">
              <span>Lịch chạy</span>
              <input className="stepper-input" type="datetime-local" value={campaignSchedule} onChange={event => setCampaignSchedule(event.target.value)} />
            </label>

            <label className="stepper-form-group">
              <span>Trạng thái chiến dịch</span>
              <select className="stepper-input" value={campaignStatus} onChange={event => setCampaignStatus(event.target.value as InputDataBatchStatus)}>
                <option value="chờ xử lý">chờ xử lý</option>
                <option value="tạm dừng">tạm dừng</option>
              </select>
            </label>
          </div>

          <label className="schedule-checkbox-label add-current-data-checkbox">
            <input
              type="checkbox"
              checked={skipExistingInCampaign}
              onChange={event => setSkipExistingInCampaign(event.target.checked)}
            />
            <span>Bỏ qua data đã có trong chiến dịch</span>
          </label>
          <div className="text-muted add-current-data-checkbox-hint">
            Khi bật, hệ thống sẽ không thêm lại UID/SĐT/email/link đã tồn tại trong chiến dịch này. Khi tắt, chỉ lọc trùng trong danh sách data vừa chọn.
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || rows.length === 0}>
            {submitting ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
            Thêm
          </button>
        </div>
      </div>
      {showDataUploadModal && (
        <div onMouseDown={event => event.stopPropagation()}>
          <CampaignDataUploadModal
            platform={importPlatform}
            actionId={campaign.actionId}
            onClose={() => setShowDataUploadModal(false)}
            onInsert={appendRows}
          />
        </div>
      )}
      {dataScanPicker && (account?.id || dataScanPicker.mode === 'pageInboxPhones') && (
        <div onMouseDown={event => event.stopPropagation()}>
          <DataScanModal
            initialAction={dataScanPicker.action}
            initialAccountId={dataScanPicker.mode === 'pageInboxPhones' ? undefined : account?.id}
            initialStatusFilter={dataScanPicker.initialStatusFilter}
            initialPageInboxPageUid={dataScanPicker.initialPageInboxPageUid}
            initialPageInboxPageName={dataScanPicker.initialPageInboxPageName}
            allowedActions={dataScanPicker.allowedActions}
            lockAccount={dataScanPicker.lockAccount}
            lockPageInboxPage={dataScanPicker.lockPageInboxPage}
            onClose={() => setDataScanPicker(null)}
            onSelect={handleScanSelected}
          />
        </div>
      )}
    </div>
  )
}

export default function CampaignPanel({ isActive, filterAccountId, onClearFilter, onOpenGeneralSettings, onOpenContentTemplates, onAskAssistant }: CampaignPanelProps) {
  const {
    accounts, campaigns, campaignActions,
    campaignInputData, loadingCampaignInputData,
    campaignDetails, loadingCampaignDetails,
    emailCampaignLinkTrackings, emailCampaignLinkTrackingCampaignId, loadingEmailCampaignLinkTrackings,
    campaignRunEvents, loadingCampaignRunEvents,
    campaignRelationSummaries, loadingCampaignRelationSummaries,
    loadCampaigns, loadCampaignActions, loadAccounts,
    updateCampaign, deleteCampaign,
    bulkUpdateCampaignStatus, bulkDeleteCampaigns,
    bulkUpdateCampaignInputDataStatus, addCampaignInputDataToCampaign, addCampaignInputDataRows,
    loadCampaignInputData, loadCampaignDetails, loadEmailCampaignLinkTrackings, loadCampaignRunEvents, loadCampaignRelationSummaries
  } = useCampaignStore()
  const isAdminAkabiz = useAuthStore(s => !!s.user?.isAdminAkabiz)
  const entitlements = useAuthStore(s => s.user?.entitlements)
  const canManageCampaignActions = isAdminAkabiz
  const canViewAllFindDataLogs = isAdminAkabiz
  const showAlert = useUiStore(s => s.showAlert)

  const [showForm, setShowForm] = useState(false)
  const [showActionManager, setShowActionManager] = useState(false)
  const [showAddInputDataModal, setShowAddInputDataModal] = useState(false)
  const [addDataCampaign, setAddDataCampaign] = useState<Campaign | null>(null)
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)
  const [cloneFromId, setCloneFromId] = useState<number | undefined>(undefined)
  const [campaignFormInitialActionId, setCampaignFormInitialActionId] = useState<string | undefined>(undefined)
  const [campaignFormInitialDetails, setCampaignFormInitialDetails] = useState<Partial<CampaignInputData>[] | undefined>(undefined)
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null)
  const [detailDockOpen, setDetailDockOpen] = useState(true)
  const [detailTab, setDetailTab] = useState<DetailTab>('info')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectedInputDataIds, setSelectedInputDataIds] = useState<Set<number>>(new Set())
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [inputDataActionLoading, setInputDataActionLoading] = useState(false)
  const [openInputDataActionMenu, setOpenInputDataActionMenu] = useState(false)
  const [openCampaignActionMenuId, setOpenCampaignActionMenuId] = useState<number | null>(null)
  const [campaignActionMenuPosition, setCampaignActionMenuPosition] = useState<CampaignActionMenuPosition | null>(null)
  const [zaloLoginAccount, setZaloLoginAccount] = useState<AutoAccount | null>(null)
  const [zaloLoginEvent, setZaloLoginEvent] = useState<ZaloLoginQrEvent | null>(null)
  const [zaloLoginStarting, setZaloLoginStarting] = useState(false)
  const [detailDockHeight, setDetailDockHeight] = useState<number | null>(null)
  const [foundDataExportKinds, setFoundDataExportKinds] = useState<Set<FoundDataKind>>(
    () => new Set(FOUND_DATA_EXPORT_OPTIONS.map(option => option.kind))
  )
  const defaultTimeRange = useMemo(() => getCampaignDateRange(DEFAULT_CAMPAIGN_TIME_PRESET), [])
  const [timePreset, setTimePreset] = useState<CampaignTimePreset>(DEFAULT_CAMPAIGN_TIME_PRESET)
  const [dateFrom, setDateFrom] = useState(defaultTimeRange.fromDate)
  const [dateTo, setDateTo] = useState(defaultTimeRange.toDate)
  const [campaignNameSearch, setCampaignNameSearch] = useState('')
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [accountFilters, setAccountFilters] = useState<string[]>([])
  const [platformFilters, setPlatformFilters] = useState<string[]>([])
  const [actionFilters, setActionFilters] = useState<string[]>([])
  const [inputDataFilters, setInputDataFilters] = useState<DetailFilterState>(() => createDefaultDetailFilters())
  const [actionDetailFilters, setActionDetailFilters] = useState<DetailFilterState>(() => createDefaultDetailFilters())
  const [findDataLogScope, setFindDataLogScope] = useState<FindDataLogScope>('visible')
  const [screenshotPreview, setScreenshotPreview] = useState<{ dataUrl: string; title: string } | null>(null)
  const [openFilterDropdown, setOpenFilterDropdown] = useState<CampaignFilterDropdown | null>(null)
  const [openDetailDropdown, setOpenDetailDropdown] = useState<DetailFilterDropdown | null>(null)
  const [detailPopoverPosition, setDetailPopoverPosition] = useState<DetailPopoverPosition | null>(null)
  const [showInitialCampaignLoading, setShowInitialCampaignLoading] = useState(true)
  const [showManualCampaignLoading, setShowManualCampaignLoading] = useState(false)
  const campaignPlatformOptions = useMemo(
    () => CAMPAIGN_PLATFORM_OPTIONS.filter(option => canUsePlatform(option.value, entitlements)),
    [entitlements]
  )
  const accountFilterOptions = useMemo<CampaignFilterOption[]>(() => {
    const optionMap = new Map<string, CampaignFilterOption>()
    accounts.forEach(account => {
      const value = String(account.id)
      optionMap.set(value, {
        value,
        label: account.name || `ID: ${account.id}`,
        platform: account.flatformType
      })
    })
    campaigns.forEach(campaign => {
      const value = String(campaign.accountId)
      if (!optionMap.has(value)) {
        optionMap.set(value, {
          value,
          label: campaign.accountName || `ID: ${campaign.accountId}`,
          platform: ''
        })
      }
    })
    return Array.from(optionMap.values()).sort(compareCampaignFilterOptionsByPlatform)
  }, [accounts, campaigns])
  const workAreaRef = useRef<HTMLDivElement>(null)
  const detailDockRef = useRef<HTMLDivElement>(null)
  const findDataLogTableWrapRef = useRef<HTMLDivElement>(null)
  const findDataLogXScrollRef = useRef<HTMLDivElement>(null)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const inputDataActionMenuRef = useRef<HTMLDivElement>(null)
  const campaignActionMenuAnchorRef = useRef<CampaignActionMenuAnchorRect | null>(null)
  const campaignActionMenuRef = useRef<HTMLDivElement | null>(null)
  const initialCampaignLoadSettledRef = useRef(false)

  useEffect(() => {
    loadCampaignActions()
    loadAccounts()
  }, [loadCampaignActions, loadAccounts])

  useEffect(() => {
    if (!isActive) return

    let isDisposed = false
    let refreshInFlight = false

    const markInitialCampaignLoadSettled = () => {
      if (initialCampaignLoadSettledRef.current || isDisposed) return
      initialCampaignLoadSettledRef.current = true
      setShowInitialCampaignLoading(false)
    }

    const refreshCampaignsIfVisible = async () => {
      if (isDisposed || refreshInFlight) return
      if (!isAppWindowVisible()) {
        markInitialCampaignLoadSettled()
        return
      }

      refreshInFlight = true
      try {
        await loadCampaigns()
      } finally {
        refreshInFlight = false
        markInitialCampaignLoadSettled()
      }
    }

    void refreshCampaignsIfVisible()

    const intervalId = window.setInterval(() => {
      void refreshCampaignsIfVisible()
    }, CAMPAIGN_LIST_REFRESH_INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (isAppWindowVisible()) {
        void refreshCampaignsIfVisible()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isDisposed = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isActive, loadCampaigns])

  useEffect(() => {
    if (!window.electronAPI?.onZaloLoginQrEvent) return
    return window.electronAPI.onZaloLoginQrEvent((event) => {
      const activeAccountId = zaloLoginAccount?.id
      if (!activeAccountId || event.accountId !== activeAccountId) return

      setZaloLoginEvent(event)
      if (event.status === 'success') {
        setZaloLoginAccount(null)
        setZaloLoginEvent(null)
        loadAccounts()
        loadCampaigns()
        showAlert(event.message || 'Đăng nhập Zalo thành công', 'success')
      } else if (event.status === 'error') {
        loadAccounts()
        showAlert(event.message || 'Đăng nhập Zalo thất bại', 'error')
      }
    })
  }, [zaloLoginAccount?.id, loadAccounts, loadCampaigns, showAlert])

  // Load only the data needed by the active campaign detail tab.
  useEffect(() => {
    if (!selectedCampaignId) return
    if (detailTab === 'data') {
      loadCampaignInputData(selectedCampaignId)
      return
    }
    if (detailTab === 'actions' || detailTab === 'foundData') {
      loadCampaignDetails(selectedCampaignId)
      return
    }
    if (detailTab === 'emailLinks') {
      return
    }
    if (detailTab === 'runLog') {
      loadCampaignRunEvents(selectedCampaignId, {
        userVisibleOnly: true,
        eventTypes: [BLOCK_SCREENSHOT_EVENT_TYPE],
        limit: 500
      })
      return
    }
    if (detailTab === 'findDataLog') {
      loadCampaignRunEvents(selectedCampaignId, {
        userVisibleOnly: !canViewAllFindDataLogs || findDataLogScope === 'visible',
        limit: 500
      })
      return
    }
    if (detailTab === 'postSearchLog') {
      loadCampaignRunEvents(selectedCampaignId, {
        userVisibleOnly: true,
        eventTypes: POST_SEARCH_LOG_EVENT_TYPES,
        limit: 500
      })
    }
  }, [
    selectedCampaignId,
    detailTab,
    loadCampaignInputData,
    loadCampaignDetails,
    loadCampaignRunEvents,
    findDataLogScope,
    canViewAllFindDataLogs
  ])

  useEffect(() => {
    setInputDataFilters(createDefaultDetailFilters())
    setActionDetailFilters(createDefaultDetailFilters())
    setFindDataLogScope('visible')
    setScreenshotPreview(null)
    setOpenDetailDropdown(null)
    setDetailPopoverPosition(null)
  }, [selectedCampaignId])

  useEffect(() => {
    if (!canViewAllFindDataLogs) {
      if (findDataLogScope !== 'visible') setFindDataLogScope('visible')
      setOpenDetailDropdown(null)
      setDetailPopoverPosition(null)
    }
  }, [canViewAllFindDataLogs, findDataLogScope])

  useEffect(() => {
    setOpenDetailDropdown(null)
    setDetailPopoverPosition(null)
  }, [detailTab])

  useEffect(() => {
    if (!openFilterDropdown) return

    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!filterPanelRef.current?.contains(event.target as Node)) {
        setOpenFilterDropdown(null)
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [openFilterDropdown])

  useEffect(() => {
    if (!openDetailDropdown) return

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('.detail-filter-dropdown-field')) {
        setOpenDetailDropdown(null)
        setDetailPopoverPosition(null)
      }
    }
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenDetailDropdown(null)
        setDetailPopoverPosition(null)
      }
    }
    const handleViewportChange = () => {
      setOpenDetailDropdown(null)
      setDetailPopoverPosition(null)
    }
    const handleDocumentScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.detail-filter-popover')) return
      handleViewportChange()
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    document.addEventListener('keydown', handleDocumentKeyDown)
    document.addEventListener('scroll', handleDocumentScroll, true)
    window.addEventListener('resize', handleViewportChange)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown)
      document.removeEventListener('keydown', handleDocumentKeyDown)
      document.removeEventListener('scroll', handleDocumentScroll, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [openDetailDropdown])

  useEffect(() => {
    if (!openInputDataActionMenu) return

    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!inputDataActionMenuRef.current?.contains(event.target as Node)) {
        setOpenInputDataActionMenu(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [openInputDataActionMenu])

  useEffect(() => {
    if (!openCampaignActionMenuId) return

    const closeOpenCampaignActionMenu = () => {
      setOpenCampaignActionMenuId(null)
      setCampaignActionMenuPosition(null)
      campaignActionMenuAnchorRef.current = null
    }
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('.campaign-action-dropdown, .campaign-action-menu')) {
        closeOpenCampaignActionMenu()
      }
    }
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOpenCampaignActionMenu()
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    document.addEventListener('keydown', handleDocumentKeyDown)
    document.addEventListener('scroll', closeOpenCampaignActionMenu, true)
    window.addEventListener('resize', closeOpenCampaignActionMenu)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown)
      document.removeEventListener('keydown', handleDocumentKeyDown)
      document.removeEventListener('scroll', closeOpenCampaignActionMenu, true)
      window.removeEventListener('resize', closeOpenCampaignActionMenu)
    }
  }, [openCampaignActionMenuId])

  useLayoutEffect(() => {
    if (!openCampaignActionMenuId || !campaignActionMenuAnchorRef.current || !campaignActionMenuRef.current) return
    const menuRect = campaignActionMenuRef.current.getBoundingClientRect()
    const nextPosition = getCampaignActionMenuPosition(campaignActionMenuAnchorRef.current, {
      width: menuRect.width,
      height: campaignActionMenuRef.current.scrollHeight
    })
    setCampaignActionMenuPosition(current => {
      if (
        current &&
        Math.abs(current.top - nextPosition.top) < 1 &&
        Math.abs(current.left - nextPosition.left) < 1 &&
        Math.abs(current.maxHeight - nextPosition.maxHeight) < 1
      ) {
        return current
      }
      return nextPosition
    })
  }, [openCampaignActionMenuId])

  // Clear bulk selection when any list filter changes.
  useEffect(() => {
    setSelectedIds(new Set())
    setOpenCampaignActionMenuId(null)
    setCampaignActionMenuPosition(null)
    campaignActionMenuAnchorRef.current = null
  }, [filterAccountId, timePreset, dateFrom, dateTo, campaignNameSearch, statusFilters, accountFilters, platformFilters, actionFilters])

  useEffect(() => {
    const allowedPlatforms = new Set(campaignPlatformOptions.map(option => option.value))
    setPlatformFilters(prev => {
      const next = prev.filter(value => allowedPlatforms.has(value))
      return next.length === prev.length ? prev : next
    })
  }, [campaignPlatformOptions, platformFilters])

  useEffect(() => {
    const allowedAccounts = new Set(accountFilterOptions.map(option => option.value))
    setAccountFilters(prev => {
      const next = prev.filter(value => allowedAccounts.has(value))
      return next.length === prev.length ? prev : next
    })
  }, [accountFilterOptions, accountFilters])

  useEffect(() => {
    setSelectedInputDataIds(new Set())
    setOpenInputDataActionMenu(false)
  }, [
    selectedCampaignId,
    detailTab,
    inputDataFilters.timePreset,
    inputDataFilters.dateFrom,
    inputDataFilters.dateTo,
    inputDataFilters.status,
    campaignInputData
  ])

  const handleEdit = (campaign: Campaign) => {
    if (!canEditCampaign(campaign.status)) {
      showAlert('Chỉ có thể sửa chiến dịch khi trạng thái là "chờ xử lý" hoặc "tạm dừng".', 'info')
      return
    }
    setCampaignFormInitialActionId(undefined)
    setCampaignFormInitialDetails(undefined)
    setEditingCampaign(campaign)
    setCloneFromId(undefined)
    setShowForm(true)
  }

  const handleDelete = (campaign: Campaign) => {
    if (!canDeleteCampaign(campaign.status)) {
      showAlert('Không thể xoá chiến dịch đang chạy.', 'info')
      return
    }
    useUiStore.getState().showConfirm(
      `Xoá chiến dịch "${campaign.name}"?`,
      async () => {
        try {
          await deleteCampaign(campaign.id)
          if (selectedCampaignId === campaign.id) {
            setSelectedCampaignId(null)
          }
        } catch (err) {
          showAlert(formatIpcErrorMessage(err, 'Không thể xoá chiến dịch.'), 'error')
        }
      },
      { title: 'Xoá chiến dịch', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleClone = (campaign: Campaign) => {
    const cloneData: Campaign = {
      ...campaign,
      id: 0,
      name: campaign.name + ' (Copy)',
      status: 'tạm dừng',
      log: ''
    }
    setCampaignFormInitialActionId(undefined)
    setCampaignFormInitialDetails(undefined)
    setCloneFromId(campaign.id)
    setEditingCampaign(cloneData)
    setShowForm(true)
  }

  const handleRowClick = (campaign: Campaign) => {
    const nextSelectedId = selectedCampaignId === campaign.id ? null : campaign.id
    setSelectedCampaignId(nextSelectedId)
    if (nextSelectedId) setDetailTab('info')
    if (!detailDockOpen) setDetailDockOpen(true)
  }

  const handlePause = async (campaign: Campaign) => {
    if (!canPauseCampaign(campaign.status)) {
      showAlert('Chỉ có thể tạm dừng chiến dịch khi trạng thái là "chờ xử lý" hoặc "đang chạy".', 'info')
      return
    }
    try {
      await updateCampaign(campaign.id, { status: 'tạm dừng' })
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tạm dừng chiến dịch.'), 'error')
    }
  }

  const handleResume = async (campaign: Campaign) => {
    if (!canResumeCampaign(campaign.status)) {
      showAlert('Chỉ có thể tiếp tục chiến dịch khi trạng thái là "tạm dừng".', 'info')
      return
    }
    try {
      await updateCampaign(campaign.id, { status: 'chờ xử lý' })
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tiếp tục chiến dịch.'), 'error')
    }
  }

  const toggleSelectOne = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const allFilteredSelected = filteredCampaigns.length > 0 && filteredCampaigns.every(c => prev.has(c.id))
      const next = new Set(prev)
      filteredCampaigns.forEach(c => {
        if (allFilteredSelected) next.delete(c.id)
        else next.add(c.id)
      })
      return next
    })
  }

  const handleTimePresetChange = (value: CampaignTimePreset) => {
    if (value === 'custom') {
      if (!dateFrom || !dateTo) {
        const range = getCampaignDateRange(value)
        setDateFrom(range.fromDate)
        setDateTo(range.toDate)
      }
      setTimePreset(value)
      return
    }
    const range = getCampaignDateRange(value)
    setTimePreset(value)
    setDateFrom(range.fromDate)
    setDateTo(range.toDate)
  }

  const handleInputDataTimePresetChange = (value: DetailTimePreset) => {
    const range = getDetailDateRange(value)
    setInputDataFilters(prev => ({
      ...prev,
      timePreset: value,
      dateFrom: range.fromDate,
      dateTo: range.toDate
    }))
  }

  const handleActionDetailTimePresetChange = (value: DetailTimePreset) => {
    const range = getDetailDateRange(value)
    setActionDetailFilters(prev => ({
      ...prev,
      timePreset: value,
      dateFrom: range.fromDate,
      dateTo: range.toDate
    }))
  }

  const handleDetailDropdownToggle = (
    dropdown: DetailFilterDropdown,
    anchor: HTMLElement,
    minWidth = DETAIL_POPOVER_MIN_WIDTH,
    expectedHeight = getDetailOptionPopoverHeight(4)
  ) => {
    setOpenDetailDropdown(current => {
      if (current === dropdown) {
        setDetailPopoverPosition(null)
        return null
      }

      setDetailPopoverPosition(getDetailPopoverPosition(anchor, minWidth, expectedHeight))
      return dropdown
    })
  }

  const closeDetailDropdown = () => {
    setOpenDetailDropdown(null)
    setDetailPopoverPosition(null)
  }

  const handleBulkPause = async () => {
    const eligible = filteredCampaigns
      .filter(c => selectedIds.has(c.id))
      .filter(c => canPauseCampaign(c.status))
      .map(c => c.id)
    if (eligible.length === 0) {
      showAlert('Không có chiến dịch nào có thể tạm dừng. Chỉ có thể tạm dừng chiến dịch "chờ xử lý" hoặc "đang chạy".', 'info')
      return
    }
    setBulkActionLoading(true)
    try {
      await bulkUpdateCampaignStatus(eligible, 'tạm dừng')
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tạm dừng các chiến dịch đã chọn.'), 'error')
    } finally {
      setBulkActionLoading(false)
      setSelectedIds(new Set())
    }
  }

  const handleBulkResume = async () => {
    const eligible = filteredCampaigns
      .filter(c => selectedIds.has(c.id) && canResumeCampaign(c.status))
      .map(c => c.id)
    if (eligible.length === 0) {
      showAlert('Không có chiến dịch nào có thể tiếp tục. Chỉ có thể tiếp tục chiến dịch "tạm dừng".', 'info')
      return
    }
    setBulkActionLoading(true)
    try {
      await bulkUpdateCampaignStatus(eligible, 'chờ xử lý')
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tiếp tục các chiến dịch đã chọn.'), 'error')
    } finally {
      setBulkActionLoading(false)
      setSelectedIds(new Set())
    }
  }

  const handleBulkDelete = () => {
    const allIds = Array.from(selectedIds)
    const blockedRunningCount = allIds.filter(id => {
      const campaign = campaigns.find(item => item.id === id)
      return campaign && !canDeleteCampaign(campaign.status)
    }).length
    const ids = allIds.filter(id => {
      const campaign = campaigns.find(item => item.id === id)
      return !campaign || canDeleteCampaign(campaign.status)
    })
    if (ids.length === 0) {
      showAlert('Không có chiến dịch nào có thể xoá. Chiến dịch đang chạy không được xoá.', 'info')
      return
    }
    useUiStore.getState().showConfirm(
      `Xoá ${ids.length} chiến dịch đã chọn${blockedRunningCount > 0 ? `, bỏ qua ${blockedRunningCount} chiến dịch đang chạy` : ''}?`,
      async () => {
        setBulkActionLoading(true)
        try {
          await bulkDeleteCampaigns(ids)
          if (selectedCampaignId && ids.includes(selectedCampaignId)) {
            setSelectedCampaignId(null)
          }
        } catch (err) {
          showAlert(formatIpcErrorMessage(err, 'Không thể xoá các chiến dịch đã chọn.'), 'error')
          await loadCampaigns()
        } finally {
          setBulkActionLoading(false)
          setSelectedIds(new Set())
        }
      },
      { title: 'Xoá chiến dịch', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const toggleSelectInputData = (id: number) => {
    setSelectedInputDataIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllInputData = () => {
    setSelectedInputDataIds(prev => {
      const allFilteredSelected = filteredCampaignInputData.length > 0 && filteredCampaignInputData.every(item => prev.has(item.id))
      const next = new Set(prev)
      filteredCampaignInputData.forEach(item => {
        if (allFilteredSelected) next.delete(item.id)
        else next.add(item.id)
      })
      return next
    })
  }

  const handleInputDataBatchStatus = async (status: InputDataBatchStatus) => {
    if (inputDataActionLoading) {
      showAlert('Đang xử lý thao tác trước đó, vui lòng chờ.', 'info')
      return
    }
    if (loadingCampaignInputData) {
      showAlert('Đang tải data, vui lòng chờ.', 'info')
      return
    }
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (selectedInputDataRows.length === 0) {
      showAlert('Vui lòng chọn data', 'info')
      return
    }

    const eligibleStatus: InputDataBatchStatus = status === 'tạm dừng' ? 'chờ xử lý' : 'tạm dừng'
    const eligibleCount = selectedInputDataRows.filter(row => row.status === eligibleStatus).length
    if (eligibleCount === 0) {
      showAlert(status === 'tạm dừng'
        ? 'Không có data nào có thể tạm dừng. Chỉ data "chờ xử lý" mới được tạm dừng.'
        : 'Không có data nào có thể tiếp tục. Chỉ data "tạm dừng" mới được tiếp tục.', 'info')
      return
    }

    setInputDataActionLoading(true)
    try {
      const result = await bulkUpdateCampaignInputDataStatus(
        selectedCampaign.id,
        Array.from(selectedInputDataIds),
        status
      )
      showAlert(
        `Đã cập nhật ${result.updatedCount} data${result.skippedCount > 0 ? `, bỏ qua ${result.skippedCount} data không phù hợp.` : '.'}`,
        'success'
      )
      setSelectedInputDataIds(new Set())
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể cập nhật trạng thái data đã chọn.'), 'error')
    } finally {
      setInputDataActionLoading(false)
    }
  }

  const handleInputDataActionMenuToggle = () => {
    setOpenInputDataActionMenu(prev => !prev)
  }

  const closeCampaignActionMenu = () => {
    setOpenCampaignActionMenuId(null)
    setCampaignActionMenuPosition(null)
    campaignActionMenuAnchorRef.current = null
  }

  const handleCampaignActionMenuToggle = (campaignId: number, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (openCampaignActionMenuId === campaignId) {
      closeCampaignActionMenu()
      return
    }

    const anchor = getCampaignActionMenuAnchorRect(event.currentTarget.getBoundingClientRect())
    campaignActionMenuAnchorRef.current = anchor
    setCampaignActionMenuPosition(getCampaignActionMenuPosition(anchor))
    setOpenCampaignActionMenuId(campaignId)
  }

  const handleCreateCampaignFromInputData = () => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (selectedInputDataRows.length === 0) {
      showAlert('Vui lòng chọn data', 'info')
      return
    }

    setEditingCampaign(null)
    setCloneFromId(undefined)
    setCampaignFormInitialActionId(selectedCampaign.actionId)
    setCampaignFormInitialDetails(selectedInputDataRows.map(cloneInputDataForNewCampaign))
    setOpenInputDataActionMenu(false)
    setShowForm(true)
  }

  const handleOpenAddInputDataModal = () => {
    if (selectedInputDataRows.length === 0) {
      showAlert('Vui lòng chọn data', 'info')
      return
    }
    setOpenInputDataActionMenu(false)
    setShowAddInputDataModal(true)
  }

  const handleOpenAddDataToCurrentCampaignModal = (campaign?: Campaign | null) => {
    if (!campaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (campaign.status === 'đang chạy') {
      setOpenInputDataActionMenu(false)
      closeCampaignActionMenu()
      showAlert('Chiến dịch đang chạy, vui lòng tạm dừng trước khi thêm data.', 'error')
      return
    }
    if (!isAddDataSupportedForCampaign(campaign)) {
      setOpenInputDataActionMenu(false)
      closeCampaignActionMenu()
      showAlert('Loại chiến dịch này không hỗ trợ thêm data.', 'error')
      return
    }
    setOpenInputDataActionMenu(false)
    closeCampaignActionMenu()
    setAddDataCampaign(campaign)
  }

  const handleAddDataToCurrentCampaignSubmit = async (request: Parameters<typeof addCampaignInputDataRows>[0]) => {
    return await addCampaignInputDataRows(request)
  }

  const handleAddInputDataToCampaignSubmit = async (data: AddInputDataModalSubmit) => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch nguồn.', 'error')
      return
    }
    const request: AddCampaignInputDataToCampaignRequest = {
      sourceCampaignId: selectedCampaign.id,
      sourceInputDataIds: Array.from(selectedInputDataIds),
      targetCampaignIds: data.targetCampaignIds,
      campaignSchedule: data.campaignSchedule,
      campaignStatus: data.campaignStatus
    }

    try {
      const result = await addCampaignInputDataToCampaign(request)
      if (result.totalInsertedCount === 0) {
        const firstError = result.targets.find(target => target.error)?.error
        showAlert(firstError || 'Không có data hợp lệ để thêm vào chiến dịch.', 'error')
        return
      }

      const successTargets = result.targets.filter(target => target.insertedCount > 0)
      const skippedText = result.totalSkippedInvalidCount > 0
        ? ` Bỏ qua ${result.totalSkippedInvalidCount} data không phù hợp.`
        : ''
      showAlert(`Đã thêm ${result.totalInsertedCount} data vào ${successTargets.length} chiến dịch.${skippedText}`, 'success')
      setSelectedInputDataIds(new Set())
      setShowAddInputDataModal(false)
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể thêm data vào chiến dịch.'), 'error')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      // Campaign / data layer status
      case 'đang chạy': return 'var(--accent-warning)'
      case 'hoàn thành': return 'var(--accent-success)'
      case 'tạm dừng': return 'var(--accent-error)'
      // Result actions status (per-milestone)
      case 'thành công': return 'var(--accent-success)'
      case 'đã gửi': return 'var(--accent-success)'
      case 'đã nhận': return 'var(--accent-success)'
      case 'đã xem': return 'var(--accent-success)'
      case 'đã click': return 'var(--accent-success)'
      case 'thất bại': return 'var(--accent-warning)'   // vàng — nghiệp vụ FB từ chối
      case 'không tồn tại': return 'var(--accent-warning)'
      case 'lỗi': return 'var(--accent-error)'           // đỏ — exception/crash code
      default: return 'var(--text-tertiary)'
    }
  }

  const getDetailStatusLabel = (status: string) => (
    status === 'thành công' ? '✅ Thành công'
      : status === 'đã gửi' ? 'Đã gửi'
        : status === 'đã nhận' ? 'Đã nhận'
          : status === 'đã xem' ? 'Đã xem'
            : status === 'đã click' ? 'Đã click'
              : status === 'thất bại' ? '⚠️ Thất bại'
                : status === 'không tồn tại' ? '⚠️ Không tồn tại'
                  : status === 'lỗi' ? '❌ Lỗi'
                    : status
  )

  const getCampaignStatusClass = (status: string) => {
    switch (status) {
      case 'chờ xử lý': return 'status-pending'
      case 'đang chạy': return 'status-running'
      case 'hoàn thành': return 'status-completed'
      case 'tạm dừng': return 'status-paused'
      default: return 'status-unknown'
    }
  }

  const getAccountLoginStatusClass = (status: string) => {
    const normalized = status.trim().toLowerCase()
    if (normalized === 'đã đăng nhập') return 'is-success'
    if (!normalized || normalized === '-') return 'is-muted'
    if (normalized.includes('checkpoint')) return 'is-warning'
    if (
      normalized.includes('chưa') ||
      normalized.includes('đăng xuất') ||
      normalized.includes('hết hạn') ||
      normalized.includes('lỗi')
    ) {
      return 'is-danger'
    }
    return 'is-muted'
  }

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)
  const selectedCampaignAccount = selectedCampaign?.accountId
    ? accounts.find(account => account.id === selectedCampaign.accountId) || null
    : null
  const selectedCampaignAction = selectedCampaign
    ? campaignActions.find(action => action.id === selectedCampaign.actionId)
    : undefined
  const addDataCampaignAction = addDataCampaign
    ? campaignActions.find(action => action.id === addDataCampaign.actionId)
    : undefined
  const addDataCampaignAccount = addDataCampaign?.accountId
    ? accounts.find(account => account.id === addDataCampaign.accountId) || null
    : null
  const isSelectedFindDataCampaign = !!selectedCampaign && FIND_DATA_ACTION_IDS.has(selectedCampaign.actionId)
  const isSelectedEmailCampaign = selectedCampaign?.actionId === EMAIL_SEND_ACTION_ID
  const isSelectedSmsCampaign = selectedCampaign?.actionId === SMS_SEND_ACTION_ID
  const isSelectedEmailClickTrackingCampaign = isSelectedEmailCampaign && selectedCampaign?.extraSettings?.emailCheckLinkClicks === true
  const isSelectedCommentSeedingFeedCampaign = selectedCampaign?.actionId === COMMENT_SEEDING_FEED_ACTION_ID
  const filteredCampaignInputData = useMemo(() => {
    const dateStart = parseDateInputBoundary(inputDataFilters.dateFrom, 'start')
    const dateEnd = parseDateInputBoundary(inputDataFilters.dateTo, 'end')
    const hasDateFilter = inputDataFilters.timePreset !== 'all' && (!!dateStart || !!dateEnd)

    return campaignInputData.filter(item => {
      if (inputDataFilters.status && item.status !== inputDataFilters.status) return false
      if (hasDateFilter) {
        const filterTime = getCampaignInputDataFilterTime(item, selectedCampaign)
        if (!isWithinDateFilter(filterTime, dateStart, dateEnd)) return false
      }
      return true
    })
  }, [
    campaignInputData,
    inputDataFilters.dateFrom,
    inputDataFilters.dateTo,
    inputDataFilters.status,
    inputDataFilters.timePreset,
    selectedCampaign
  ])
  const selectedInputDataRows = useMemo(
    () => campaignInputData.filter(item => selectedInputDataIds.has(item.id)),
    [campaignInputData, selectedInputDataIds]
  )
  const selectedFilteredInputDataCount = useMemo(
    () => filteredCampaignInputData.reduce((count, item) => count + (selectedInputDataIds.has(item.id) ? 1 : 0), 0),
    [filteredCampaignInputData, selectedInputDataIds]
  )
  const filteredCampaignDetails = useMemo(() => {
    const dateStart = parseDateInputBoundary(actionDetailFilters.dateFrom, 'start')
    const dateEnd = parseDateInputBoundary(actionDetailFilters.dateTo, 'end')
    const hasDateFilter = actionDetailFilters.timePreset !== 'all' && (!!dateStart || !!dateEnd)

    return campaignDetails.filter(detail => {
      if (actionDetailFilters.status && detail.status !== actionDetailFilters.status) return false
      if (hasDateFilter && !isWithinDateFilter(detail.createdAt, dateStart, dateEnd)) return false
      return true
    })
  }, [
    actionDetailFilters.dateFrom,
    actionDetailFilters.dateTo,
    actionDetailFilters.status,
    actionDetailFilters.timePreset,
    campaignDetails
  ])
  const actionDetailStatusOptions = useMemo<CampaignFilterOption[]>(() => {
    const optionMap = new Map(CAMPAIGN_DETAIL_STATUS_FILTER_OPTIONS.map(option => [option.value, option]))
    campaignDetails.forEach(detail => {
      const status = String(detail.status || '').trim()
      if (status && !optionMap.has(status)) {
        optionMap.set(status, { value: status, label: status })
      }
    })
    return Array.from(optionMap.values())
  }, [campaignDetails])
  const linkedFindDataSourceCampaignIds = useMemo(() => {
    if (!selectedCampaign) return []
    return uniqueNumbers(
      campaigns
        .filter(source => FIND_DATA_ACTION_IDS.has(source.actionId))
        .filter(source => FIND_DATA_TARGET_FIELDS.some(field =>
          toNumberList(source.extraSettings?.[field]).includes(selectedCampaign.id)
        ))
        .map(source => source.id)
    )
  }, [campaigns, selectedCampaign])
  const linkedFindDataTargetCampaignIds = useMemo(() => {
    if (!selectedCampaign || !FIND_DATA_ACTION_IDS.has(selectedCampaign.actionId)) return []
    return uniqueNumbers(FIND_DATA_TARGET_FIELDS.flatMap(field => toNumberList(selectedCampaign.extraSettings?.[field])))
  }, [selectedCampaign])
  const runLogEntries = useMemo(
    () => parseCampaignRunLog(selectedCampaign?.log || ''),
    [selectedCampaign?.log]
  )
  const runLogScreenshotEvents = useMemo(
    () => detailTab === 'runLog'
      ? campaignRunEvents.filter(event => event.eventType === BLOCK_SCREENSHOT_EVENT_TYPE)
      : [],
    [campaignRunEvents, detailTab]
  )
  const screenshotEventById = useMemo(() => {
    const map = new Map<number, CampaignRunEvent>()
    for (const event of runLogScreenshotEvents) {
      map.set(event.id, event)
    }
    return map
  }, [runLogScreenshotEvents])

  const foundDataItems = useMemo<FoundDataItem[]>(() => {
    return campaignDetails.flatMap(detail => {
      const payload = getFindDataPayload(detail)
      if (payload.total === 0) return []
      const groupUrl = payload.groupUrl || '-'
      const createdAt = detail.createdAt
      const memberNameByUid = new Map(payload.groupMembers.map(member => [member.uid, member.name]))
      const memberUidSet = new Set(payload.groupMembers.map(member => member.uid))
      const uidProfileNameByUid = new Map(payload.uidProfiles.map(profile => [profile.uid, profile.name]))
      const phoneProfileNameByPhone = new Map(payload.phoneProfiles.map(profile => [profile.phone.toLowerCase(), profile.name]))
      const uidItems = [
        ...[...payload.groupMembers]
          .sort((a, b) => Number(!a.name) - Number(!b.name))
          .map((member, index) => ({
            key: `${detail.id}-uid-member-${index}`,
            kind: 'uid' as const,
            label: getFoundDataKindLabel('uid'),
            value: member.uid,
            name: member.name,
            groupUrl,
            createdAt
          })),
        ...payload.uids
          .filter(value => !memberUidSet.has(value))
          .map((value, index) => ({
            key: `${detail.id}-uid-${index}`,
            kind: 'uid' as const,
            label: getFoundDataKindLabel('uid'),
            value,
            name: memberNameByUid.get(value) || uidProfileNameByUid.get(value) || '',
            groupUrl,
            createdAt
          }))
      ]
      return [
        ...payload.phones.map((value, index) => ({
          key: `${detail.id}-phone-${index}`,
          kind: 'phone' as const,
          label: getFoundDataKindLabel('phone'),
          value,
          name: phoneProfileNameByPhone.get(value.toLowerCase()) || '',
          groupUrl,
          createdAt
        })),
        ...payload.linkGroupZalos.map((value, index) => ({
          key: `${detail.id}-zalo-${index}`,
          kind: 'zalo' as const,
          label: getFoundDataKindLabel('zalo'),
          value,
          groupUrl,
          createdAt
        })),
        ...uidItems,
        ...payload.postLinks.map((value, index) => ({
          key: `${detail.id}-post-link-${index}`,
          kind: 'postLink' as const,
          label: getFoundDataKindLabel('postLink'),
          value,
          groupUrl,
          createdAt
        })),
        ...payload.facebookGroups.map((group, index) => ({
          key: `${detail.id}-facebook-group-${index}`,
          kind: 'facebookGroup' as const,
          label: getFoundDataKindLabel('facebookGroup'),
          value: group.url,
          name: group.name,
          groupUrl,
          createdAt
        }))
      ]
    })
  }, [campaignDetails])

  const selectedFoundDataItems = useMemo(() => {
    return foundDataItems.filter(item => foundDataExportKinds.has(item.kind))
  }, [foundDataItems, foundDataExportKinds])

  const findDataLogRows = useMemo(() => (
    campaignRunEvents.map(buildFindDataLogRow)
  ), [campaignRunEvents])
  const postSearchLogRows = useMemo(() => (
    campaignRunEvents
      .filter(event => POST_SEARCH_LOG_EVENT_TYPES.includes(event.eventType))
      .map(buildFindDataLogRow)
  ), [campaignRunEvents])
  const selectedCampaignEmailLinkTrackings = useMemo(() => {
    if (!selectedCampaignId || emailCampaignLinkTrackingCampaignId !== selectedCampaignId) return []
    return emailCampaignLinkTrackings
  }, [emailCampaignLinkTrackingCampaignId, emailCampaignLinkTrackings, selectedCampaignId])
  const totalEmailLinkClicks = useMemo(
    () => selectedCampaignEmailLinkTrackings.reduce((total, item) => total + item.clickCount, 0),
    [selectedCampaignEmailLinkTrackings]
  )
  const emailLinkTabLoading = loadingEmailCampaignLinkTrackings || (
    detailTab === 'emailLinks' &&
    selectedCampaignId !== null &&
    emailCampaignLinkTrackingCampaignId !== selectedCampaignId
  )

  useEffect(() => {
    if (detailTab === 'foundData' && !isSelectedFindDataCampaign) {
      setDetailTab('actions')
      return
    }
    if (detailTab === 'findDataLog' && !isSelectedFindDataCampaign) {
      setDetailTab('actions')
      return
    }
    if (detailTab === 'emailLinks' && !isSelectedEmailClickTrackingCampaign) {
      setDetailTab('actions')
      return
    }
    if (detailTab === 'postSearchLog' && !isSelectedCommentSeedingFeedCampaign) {
      setDetailTab('actions')
      return
    }
    if (detailTab === 'findDataCampaigns' && linkedFindDataSourceCampaignIds.length === 0) {
      setDetailTab('info')
      return
    }
    if (detailTab === 'sourceCampaigns' && linkedFindDataTargetCampaignIds.length === 0) {
      setDetailTab('info')
    }
  }, [detailTab, isSelectedFindDataCampaign, isSelectedEmailClickTrackingCampaign, isSelectedCommentSeedingFeedCampaign, linkedFindDataSourceCampaignIds.length, linkedFindDataTargetCampaignIds.length])

  useEffect(() => {
    if (!selectedCampaignId) return
    if (detailTab === 'findDataCampaigns') {
      loadCampaignRelationSummaries(linkedFindDataSourceCampaignIds)
    } else if (detailTab === 'sourceCampaigns') {
      loadCampaignRelationSummaries(linkedFindDataTargetCampaignIds)
    }
  }, [
    selectedCampaignId,
    detailTab,
    linkedFindDataSourceCampaignIds,
    linkedFindDataTargetCampaignIds,
    loadCampaignRelationSummaries
  ])

  const toggleFoundDataExportKind = (kind: FoundDataKind) => {
    setFoundDataExportKinds(prev => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const handleFindDataLogTableScroll = () => {
    const tableWrap = findDataLogTableWrapRef.current
    const xScroll = findDataLogXScrollRef.current
    if (!tableWrap || !xScroll || xScroll.scrollLeft === tableWrap.scrollLeft) return
    xScroll.scrollLeft = tableWrap.scrollLeft
  }

  const handleFindDataLogXScroll = () => {
    const tableWrap = findDataLogTableWrapRef.current
    const xScroll = findDataLogXScrollRef.current
    if (!tableWrap || !xScroll || tableWrap.scrollLeft === xScroll.scrollLeft) return
    tableWrap.scrollLeft = xScroll.scrollLeft
  }

  const getDetailDockMaxHeight = () => {
    const workAreaHeight = workAreaRef.current?.getBoundingClientRect().height || window.innerHeight
    return Math.max(DETAIL_DOCK_MIN_HEIGHT, workAreaHeight - DETAIL_DOCK_MAX_HEIGHT_RESERVE)
  }

  const handleDetailDockResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()

    const startY = event.clientY
    const startHeight = detailDockRef.current?.getBoundingClientRect().height || detailDockHeight || DETAIL_DOCK_MIN_HEIGHT
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault()
      const deltaY = moveEvent.clientY - startY
      setDetailDockHeight(clamp(
        startHeight - deltaY,
        DETAIL_DOCK_MIN_HEIGHT,
        getDetailDockMaxHeight()
      ))
    }

    const stopResize = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize, { once: true })
    window.addEventListener('pointercancel', stopResize, { once: true })
  }

  const renderCampaignDetailLog = (detail: CampaignDetail) => {
    if (isSelectedSmsCampaign) {
      const sms = getSmsCampaignDetailInfo(detail)
      return (
        <div className="sms-detail-history-cell">
          <div className="campaign-detail-log-text">{detail.log || '-'}</div>
          {(sms.sentAt || sms.deliveredAt || sms.errorMessage || sms.providerMessageId) && (
            <div className="sms-detail-meta">
              {sms.sentAt && <span>Gửi: {formatDisplayDateTime(sms.sentAt)}</span>}
              {sms.deliveredAt && <span>Nhận: {formatDisplayDateTime(sms.deliveredAt)}</span>}
              {sms.errorMessage && <span>Lỗi: {sms.errorMessage}</span>}
              {sms.providerMessageId && <span>Provider: {sms.providerMessageId}</span>}
            </div>
          )}
        </div>
      )
    }

    const payload = getFindDataPayload(detail)
    const postUrl = typeof detail.postUrl === 'string' ? detail.postUrl.trim() : ''
    const isFindDataDetail = isSelectedFindDataCampaign && detail.actionName === 'Tìm data'
    if (!isFindDataDetail && payload.total === 0 && !postUrl) {
      return <span className="campaign-detail-log-text">{detail.log || '-'}</span>
    }

    return (
      <div className="find-data-history-cell">
        <div className="campaign-detail-log-text">{detail.log || '-'}</div>
        {postUrl && (
          <a
            className="campaign-detail-post-link"
            href={postUrl}
            target="_blank"
            rel="noreferrer"
            title={postUrl}
          >
            {postUrl}
          </a>
        )}
        {(isFindDataDetail || payload.total > 0) && (
          <div className="find-data-result-chips">
            <span className="find-data-chip find-data-chip-phone">SĐT: {payload.phones.length}</span>
            <span className="find-data-chip find-data-chip-zalo">Link group Zalo: {payload.linkGroupZalos.length}</span>
            <span className="find-data-chip find-data-chip-uid">UID: {payload.uids.length + payload.groupMembers.length}</span>
            <span className="find-data-chip find-data-chip-postLink">Link Post: {payload.postLinks.length}</span>
            <span className="find-data-chip find-data-chip-facebookGroup">Link group Facebook: {payload.facebookGroups.length}</span>
          </div>
        )}
      </div>
    )
  }

  const getRelationBreakdownTitle = (
    breakdown: CampaignRelationSummary['successBreakdown'],
    includeStatus: boolean
  ) => {
    if (breakdown.length === 0) return '0'
    return breakdown
      .map(item => `${item.actionName}${includeStatus ? ` (${item.status})` : ''}: ${item.count}`)
      .join('\n')
  }

  const renderRelationBreakdownCell = (
    total: number,
    breakdown: CampaignRelationSummary['successBreakdown'],
    includeStatus: boolean,
    tone: 'success' | 'failure'
  ) => {
    if (total === 0) return <span className="campaign-relation-count muted">0</span>

    return (
      <div
        className="campaign-relation-breakdown"
        title={getRelationBreakdownTitle(breakdown, includeStatus)}
      >
        <strong className={`campaign-relation-count ${tone}`}>{total}</strong>
        <div className="campaign-relation-breakdown-list">
          {breakdown.map(item => (
            <span
              key={`${item.actionName}-${item.status}`}
              className={`campaign-relation-breakdown-chip ${item.status === 'lỗi' ? 'error' : tone}`}
            >
              {item.actionName}{includeStatus ? ` (${item.status})` : ''}: {item.count}
            </span>
          ))}
        </div>
      </div>
    )
  }

  const renderCampaignRelationSummaries = (emptyMessage: string) => {
    if (loadingCampaignRelationSummaries) {
      return <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
    }
    if (campaignRelationSummaries.length === 0) {
      return <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>{emptyMessage}</div>
    }

    return (
      <table className="campaign-grid campaign-relation-grid" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>Loại chiến dịch</th>
            <th>Tên chiến dịch</th>
            <th>Tài khoản</th>
            <th>Chờ gửi</th>
            <th>Thành công</th>
            <th>Thất bại</th>
          </tr>
        </thead>
        <tbody>
          {campaignRelationSummaries.map(summary => {
            const actionLabel = summary.actionName || summary.actionId || '-'
            const accountLabel = summary.accountName || (summary.accountId ? `#${summary.accountId}` : '-')
            return (
              <tr key={summary.campaignId}>
                <td title={actionLabel}>{actionLabel}</td>
                <td title={summary.campaignName || '-'}>
                  <strong>{summary.campaignName || `#${summary.campaignId}`}</strong>
                </td>
                <td title={accountLabel}>{accountLabel}</td>
                <td title={`${summary.pendingInputCount} data input đang chờ xử lý`}>
                  <span className="campaign-relation-count pending">{summary.pendingInputCount}</span>
                </td>
                <td>
                  {renderRelationBreakdownCell(summary.successCount, summary.successBreakdown, false, 'success')}
                </td>
                <td>
                  {renderRelationBreakdownCell(summary.failureCount, summary.failureBreakdown, true, 'failure')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  const getCampaignDetailLogTitle = (detail: CampaignDetail) => {
    if (isSelectedSmsCampaign) return getSmsCampaignDetailTitle(detail)
    const postUrl = typeof detail.postUrl === 'string' ? detail.postUrl.trim() : ''
    return [detail.log || '', postUrl].filter(Boolean).join('\n') || '-'
  }

  const handleExportCampaignDetails = () => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (campaignDetails.length === 0) {
      showAlert('Chưa có lịch sử hành động để xuất.', 'info')
      return
    }
    if (filteredCampaignDetails.length === 0) {
      showAlert('Không có lịch sử hành động phù hợp bộ lọc để xuất.', 'info')
      return
    }

    try {
      const rows = filteredCampaignDetails.map((detail, index) => {
        if (isSelectedSmsCampaign) {
          const sms = getSmsCampaignDetailInfo(detail)
          return {
            STT: index + 1,
            'Thời gian': detail.createdAt ? new Date(detail.createdAt).toLocaleString('vi-VN') : '',
            'SĐT': sms.phone,
            'Nhà mạng': sms.carrierLabel === '-' ? '' : sms.carrierLabel,
            'SIM': sms.simSlot === '-' ? '' : sms.simSlot,
            'Hành động': detail.actionName || '',
            'Trạng thái': detail.status,
            'Nội dung SMS': sms.content,
            'Chi tiết': detail.log || '',
            'Đã gửi lúc': sms.sentAt ? new Date(sms.sentAt).toLocaleString('vi-VN') : '',
            'Đã nhận lúc': sms.deliveredAt ? new Date(sms.deliveredAt).toLocaleString('vi-VN') : '',
            'Mã lỗi': sms.errorCode,
            'Lỗi': sms.errorMessage,
            'Provider ID': sms.providerMessageId,
            'Device ID': sms.deviceId
          }
        }

        return {
          STT: index + 1,
          'Thời gian': detail.createdAt ? new Date(detail.createdAt).toLocaleString('vi-VN') : '',
          'Hành động': detail.actionName || '',
          'Trạng thái': detail.status,
          'Chi tiết': detail.log || '',
          'Link bài viết': detail.postUrl || ''
        }
      })
      const sheet = utils.json_to_sheet(rows)
      sheet['!cols'] = isSelectedSmsCampaign
        ? [
          { wch: 6 },
          { wch: 22 },
          { wch: 14 },
          { wch: 14 },
          { wch: 10 },
          { wch: 18 },
          { wch: 14 },
          { wch: 70 },
          { wch: 50 },
          { wch: 22 },
          { wch: 22 },
          { wch: 18 },
          { wch: 40 },
          { wch: 30 },
          { wch: 36 }
        ]
        : [
          { wch: 6 },
          { wch: 22 },
          { wch: 18 },
          { wch: 14 },
          { wch: 70 },
          { wch: 40 }
        ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Lich su hanh dong')
      const name = sanitizeFileSegment(selectedCampaign.name || `campaign-${selectedCampaign.id}`)
      writeFile(workbook, `campaign-history-${selectedCampaign.id}-${name}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất lịch sử hành động ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export campaign details:', err)
      showAlert('Không thể xuất file Excel lịch sử hành động.', 'error')
    }
  }

  const handleExportFoundData = () => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (foundDataExportKinds.size === 0) {
      showAlert('Vui lòng chọn ít nhất một loại data để xuất.', 'error')
      return
    }
    if (selectedFoundDataItems.length === 0) {
      showAlert('Không có data phù hợp với tuỳ chọn xuất.', 'info')
      return
    }

    try {
      const uniqueItems = getUniqueFoundDataItems(selectedFoundDataItems)
      const rows = [
        FOUND_DATA_TEMPLATE_HEADERS,
        ...uniqueItems.map(item => {
          const isPhone = item.kind === 'phone'
          return [
            item.name || '',
            isPhone ? '' : item.value,
            isPhone ? item.value : '',
            '',
            '',
            '',
            '',
            '',
            ''
          ]
        })
      ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = [
        { wch: 24 },
        { wch: 48 },
        { wch: 18 },
        { wch: 28 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 }
      ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Sheet1')
      const name = sanitizeFileSegment(selectedCampaign.name || `campaign-${selectedCampaign.id}`)
      writeFile(workbook, `found-data-${selectedCampaign.id}-${name}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất data tìm được ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export found data:', err)
      showAlert('Không thể xuất file Excel data tìm được.', 'error')
    }
  }

  const handleExportFindDataLog = () => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (!isSelectedFindDataCampaign) {
      showAlert('Tab Log tìm data chỉ hỗ trợ chiến dịch tìm data.', 'info')
      return
    }
    if (campaignRunEvents.length === 0) {
      showAlert('Chưa có log tìm data để xuất.', 'info')
      return
    }
    if (findDataLogRows.length === 0) {
      showAlert('Chưa có log tìm data để xuất.', 'info')
      return
    }

    try {
      const rows = [
        FIND_DATA_LOG_EXPORT_HEADERS,
        ...findDataLogRows.map(row => [
          row.timeLabel === '-' ? '' : row.timeLabel,
          row.source,
          row.action,
          row.statusLabel,
          row.elementCount === '-' ? '' : row.elementCount,
          row.itemIndex === '-' ? '' : row.itemIndex,
          row.link,
          row.name,
          row.uid,
          row.contentText,
          row.phones,
          row.zaloGroupLinks,
          row.postLinks,
          row.keyword,
          row.matchedKeyword === '-' ? '' : row.matchedKeyword,
          row.aiFinalPrompt === '-' ? '' : row.aiFinalPrompt,
          row.aiRawResult === '-' ? '' : row.aiRawResult,
          row.aiMeaningCheck === '-' ? '' : row.aiMeaningCheck
        ])
      ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = [
        { wch: 22 },
        { wch: 14 },
        { wch: 22 },
        { wch: 14 },
        { wch: 10 },
        { wch: 8 },
        { wch: 46 },
        { wch: 24 },
        { wch: 22 },
        { wch: 70 },
        { wch: 24 },
        { wch: 46 },
        { wch: 46 },
        { wch: 18 },
        { wch: 14 },
        { wch: 60 },
        { wch: 60 },
        { wch: 20 }
      ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Log tim data')
      const name = sanitizeFileSegment(selectedCampaign.name || `campaign-${selectedCampaign.id}`)
      writeFile(workbook, `find-data-log-${selectedCampaign.id}-${name}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất log tìm data ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export find data log:', err)
      showAlert('Không thể xuất file Excel log tìm data.', 'error')
    }
  }

  const handleExportPostSearchLog = () => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (!isSelectedCommentSeedingFeedCampaign) {
      showAlert('Tab Log tìm bài chỉ hỗ trợ chiến dịch comment seeding group/page/profile.', 'info')
      return
    }
    if (postSearchLogRows.length === 0) {
      showAlert('Chưa có log tìm bài để xuất.', 'info')
      return
    }

    try {
      const rows = [
        POST_SEARCH_LOG_EXPORT_HEADERS,
        ...postSearchLogRows.map(row => [
          row.timeLabel === '-' ? '' : row.timeLabel,
          row.action,
          row.statusLabel,
          row.itemIndex === '-' ? '' : row.itemIndex,
          row.link,
          row.contentText,
          row.keyword,
          row.matchedKeyword === '-' ? '' : row.matchedKeyword,
          row.aiFinalPrompt === '-' ? '' : row.aiFinalPrompt,
          row.aiRawResult === '-' ? '' : row.aiRawResult,
          row.aiMeaningCheck === '-' ? '' : row.aiMeaningCheck
        ])
      ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = [
        { wch: 22 },
        { wch: 24 },
        { wch: 14 },
        { wch: 8 },
        { wch: 46 },
        { wch: 70 },
        { wch: 22 },
        { wch: 14 },
        { wch: 60 },
        { wch: 60 },
        { wch: 20 }
      ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Log tim bai')
      const name = sanitizeFileSegment(selectedCampaign.name || `campaign-${selectedCampaign.id}`)
      writeFile(workbook, `post-search-log-${selectedCampaign.id}-${name}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất log tìm bài ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export post search log:', err)
      showAlert('Không thể xuất file Excel log tìm bài.', 'error')
    }
  }

  const handleLoadCampaignDetails = () => {
    if (!selectedCampaignId) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    loadCampaignDetails(selectedCampaignId)
  }

  const handleLoadEmailCampaignLinks = () => {
    if (!selectedCampaignId) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (!isSelectedEmailCampaign) {
      showAlert('Tab Link email chỉ hỗ trợ chiến dịch email.', 'info')
      return
    }
    if (!isSelectedEmailClickTrackingCampaign) {
      showAlert('Chiến dịch email này chưa bật kiểm tra click vào link.', 'info')
      return
    }
    loadEmailCampaignLinkTrackings(selectedCampaignId)
  }

  const handleLoadFindDataLog = () => {
    if (!selectedCampaignId) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (!isSelectedFindDataCampaign) {
      showAlert('Tab Log tìm kiếm chỉ hỗ trợ chiến dịch tìm data.', 'info')
      return
    }
    loadCampaignRunEvents(selectedCampaignId, {
      userVisibleOnly: !canViewAllFindDataLogs || findDataLogScope === 'visible',
      limit: 500
    })
  }

  const handleLoadPostSearchLog = () => {
    if (!selectedCampaignId) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (!isSelectedCommentSeedingFeedCampaign) {
      showAlert('Tab Log tìm bài chỉ hỗ trợ chiến dịch comment seeding group/page/profile.', 'info')
      return
    }
    loadCampaignRunEvents(selectedCampaignId, {
      userVisibleOnly: true,
      eventTypes: POST_SEARCH_LOG_EVENT_TYPES,
      limit: 500
    })
  }

  const handlePreviewScreenshot = async (event: CampaignRunEvent) => {
    const title = `${formatDisplayDateTime(event.createdAt)} - ${getScreenshotResultLabel(event) || 'Ảnh chụp màn hình'}`
    const filePath = getScreenshotPath(event)
    if (!filePath || !window.electronAPI?.readBlockScreenshotDataUrl) return
    try {
      const result = await window.electronAPI.readBlockScreenshotDataUrl(filePath)
      setScreenshotPreview({ dataUrl: result.dataUrl, title })
    } catch {
      showAlert('Không thể tải ảnh screenshot.', 'error')
    }
  }

  const handleExportCampaignInputData = () => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (selectedInputDataRows.length === 0) {
      showAlert('Vui lòng chọn data', 'info')
      return
    }

    try {
      const headers = isSelectedSmsCampaign ? SMS_CAMPAIGN_INPUT_DATA_EXPORT_HEADERS : CAMPAIGN_INPUT_DATA_EXPORT_HEADERS
      const rows = isSelectedSmsCampaign
        ? [
          headers,
          ...selectedInputDataRows.map(item => [
            item.name || '',
            item.phone || '',
            formatInputDataPhoneCarrier(item),
            item.info1 || '',
            item.info2 || '',
            item.info3 || '',
            item.info4 || '',
            item.info5 || '',
            item.content || '',
            formatCompactDateTime(item.schedule)
          ])
        ]
        : [
          headers,
          ...selectedInputDataRows.map(item => [
            item.name || '',
            item.uid || '',
            item.phone || '',
            item.email || '',
            item.info1 || '',
            item.info2 || '',
            item.info3 || '',
            item.info4 || '',
            item.info5 || ''
          ])
        ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = isSelectedSmsCampaign
        ? [
          { wch: 24 },
          { wch: 18 },
          { wch: 16 },
          { wch: 18 },
          { wch: 18 },
          { wch: 18 },
          { wch: 18 },
          { wch: 18 },
          { wch: 48 },
          { wch: 18 }
        ]
        : [
          { wch: 24 },
          { wch: 48 },
          { wch: 18 },
          { wch: 28 },
          { wch: 18 },
          { wch: 18 },
          { wch: 18 },
          { wch: 18 },
          { wch: 18 }
        ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Sheet1')
      const name = sanitizeFileSegment(selectedCampaign.name || `campaign-${selectedCampaign.id}`)
      writeFile(workbook, `campaign-data-${selectedCampaign.id}-${name}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất dữ liệu ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export campaign input data:', err)
      showAlert('Không thể xuất file Excel dữ liệu.', 'error')
    }
  }

  const handleAskAssistant = (campaign: Campaign) => {
    setSelectedCampaignId(campaign.id)
    onAskAssistant?.(campaign.id)
  }

  const openCampaignDetailTab = (campaign: Campaign, tab: DetailTab) => {
    setSelectedCampaignId(campaign.id)
    setDetailTab(tab)
    setDetailDockOpen(true)
    if (tab === 'actions') loadCampaignDetails(campaign.id)
    if (
      tab === 'emailLinks' &&
      campaign.actionId === EMAIL_SEND_ACTION_ID &&
      campaign.extraSettings?.emailCheckLinkClicks === true
    ) {
      loadEmailCampaignLinkTrackings(campaign.id)
    }
  }

  const handleZaloLoginQr = async (campaign: Campaign, account: AutoAccount | undefined) => {
    if (!account) {
      showAlert('Không tìm thấy tài khoản của chiến dịch.', 'error')
      return
    }
    if (!canUsePlatform('zalo', entitlements)) {
      showAlert('Tính năng Zalo chưa được kích hoạt hoặc đã hết hạn.', 'error')
      return
    }
    if (!window.electronAPI?.startZaloLoginQr) {
      showAlert('Tính năng này cần Electron API.', 'error')
      return
    }

    setOpenCampaignActionMenuId(null)
    setSelectedCampaignId(campaign.id)
    setZaloLoginAccount(account)
    setZaloLoginEvent({ accountId: account.id, status: 'qr', message: 'Đang tạo mã QR...' })
    setZaloLoginStarting(true)
    try {
      const result = await window.electronAPI.startZaloLoginQr(account.id)
      if (!result.success) {
        setZaloLoginAccount(null)
        setZaloLoginEvent(null)
        showAlert(result.reason || 'Không thể bắt đầu đăng nhập Zalo.', 'error')
      }
    } catch (err) {
      setZaloLoginAccount(null)
      setZaloLoginEvent(null)
      showAlert(formatIpcErrorMessage(err, 'Không thể bắt đầu đăng nhập Zalo.'), 'error')
    } finally {
      setZaloLoginStarting(false)
    }
  }

  const handleCloseZaloLogin = async () => {
    const accountId = zaloLoginAccount?.id
    const shouldCancel = !!accountId && zaloLoginEvent?.status !== 'success' && zaloLoginEvent?.status !== 'error'
    setZaloLoginAccount(null)
    setZaloLoginEvent(null)
    setZaloLoginStarting(false)
    if (shouldCancel) {
      await window.electronAPI?.cancelZaloLoginQr?.(accountId).catch(() => {})
    }
  }

  const actionById = useMemo(
    () => new Map(campaignActions.map(action => [action.id, action])),
    [campaignActions]
  )

  const accountById = useMemo(
    () => new Map(accounts.map(account => [account.id, account])),
    [accounts]
  )

  const actionFilterOptions = useMemo<CampaignFilterOption[]>(() => {
    const optionMap = new Map<string, CampaignFilterOption>()
    campaignActions.forEach(action => {
      optionMap.set(action.id, {
        value: action.id,
        label: action.name || action.id,
        platform: normalizeCampaignPlatform(action.flatformType) || inferCampaignPlatformFromActionId(action.id)
      })
    })
    campaigns.forEach(campaign => {
      if (!optionMap.has(campaign.actionId)) {
        const actionPlatform = normalizeCampaignPlatform(actionById.get(campaign.actionId)?.flatformType)
        const accountPlatform = normalizeCampaignPlatform(accountById.get(campaign.accountId)?.flatformType)
        optionMap.set(campaign.actionId, {
          value: campaign.actionId,
          label: campaign.actionName || campaign.actionId,
          platform: actionPlatform || inferCampaignPlatformFromActionId(campaign.actionId) || accountPlatform
        })
      }
    })
    return Array.from(optionMap.values()).sort(compareCampaignFilterOptionsByPlatform)
  }, [campaignActions, campaigns, actionById, accountById])

  // Filter campaigns by account and the local list filters.
  const filteredCampaigns = useMemo(() => {
    const dateStart = parseDateInputBoundary(dateFrom, 'start')
    const dateEnd = parseCampaignListDateToBoundary(dateTo)
    const hasDateFilter = timePreset !== 'all' && (!!dateStart || !!dateEnd)
    const searchQuery = normalizeFilterText(campaignNameSearch)

    return campaigns.filter(campaign => {
      if (filterAccountId && campaign.accountId !== filterAccountId) return false

      if (searchQuery && !normalizeFilterText(campaign.name).includes(searchQuery)) return false

      if (hasDateFilter) {
        if (!campaign.schedule) return false
        const scheduleDate = new Date(campaign.schedule)
        if (Number.isNaN(scheduleDate.getTime())) return false
        if (dateStart && scheduleDate < dateStart) return false
        if (dateEnd && scheduleDate > dateEnd) return false
      }

      if (statusFilters.length > 0 && !statusFilters.includes(campaign.status)) return false

      if (accountFilters.length > 0 && !accountFilters.includes(String(campaign.accountId))) return false

      if (platformFilters.length > 0) {
        const actionPlatform = normalizeCampaignPlatform(actionById.get(campaign.actionId)?.flatformType)
        const accountPlatform = normalizeCampaignPlatform(accountById.get(campaign.accountId)?.flatformType)
        const campaignPlatform = actionPlatform || accountPlatform || inferCampaignPlatformFromActionId(campaign.actionId)
        if (!platformFilters.includes(campaignPlatform)) return false
      }

      if (actionFilters.length > 0 && !actionFilters.includes(campaign.actionId)) return false

      return true
    }).sort(compareCampaignListOrder)
  }, [
    campaigns,
    filterAccountId,
    dateFrom,
    dateTo,
    timePreset,
    campaignNameSearch,
    statusFilters,
    accountFilters,
    platformFilters,
    actionFilters,
    actionById,
    accountById
  ])

  const selectedFilteredCount = useMemo(
    () => filteredCampaigns.reduce((count, campaign) => count + (selectedIds.has(campaign.id) ? 1 : 0), 0),
    [filteredCampaigns, selectedIds]
  )

  const filterAccountName = filterAccountId
    ? accounts.find(a => a.id === filterAccountId)?.name || `ID: ${filterAccountId}`
    : null

  const emptyCampaignText = campaigns.length === 0
    ? 'Chưa có chiến dịch'
    : 'Không có chiến dịch phù hợp bộ lọc'

  const showCampaignTableLoading = showInitialCampaignLoading || showManualCampaignLoading
  const campaignRangeLabel = getCampaignRangeLabel(timePreset, dateFrom, dateTo)

  const handleReloadCampaigns = () => {
    setShowManualCampaignLoading(true)
    loadCampaigns().finally(() => setShowManualCampaignLoading(false))
  }

  const renderDetailFilters = (
    timeDropdown: DetailFilterDropdown,
    statusDropdown: DetailFilterDropdown,
    filters: DetailFilterState,
    onTimePresetChange: (value: DetailTimePreset) => void,
    onDateFromChange: (value: string) => void,
    onDateToChange: (value: string) => void,
    statusOptions: CampaignFilterOption[],
    onStatusChange: (value: string) => void
  ) => (
    <div className="detail-filter-controls">
      <div className="report-dropdown-field detail-filter-dropdown-field detail-filter-range-field">
        <span>Khoảng thời gian</span>
        <button
          type="button"
          className={`report-filter-button detail-filter-button ${openDetailDropdown === timeDropdown ? 'active' : ''}`}
          onClick={event => handleDetailDropdownToggle(
            timeDropdown,
            event.currentTarget,
            260,
            DETAIL_TIME_POPOVER_HEIGHT
          )}
        >
          <strong>{getDetailRangeLabel(filters)}</strong>
          <ChevronDown size={14} />
        </button>
        {openDetailDropdown === timeDropdown && detailPopoverPosition && (
          <div
            className="report-filter-popover detail-filter-popover"
            style={{
              top: detailPopoverPosition.top ?? 'auto',
              bottom: detailPopoverPosition.bottom ?? 'auto',
              left: detailPopoverPosition.left,
              width: detailPopoverPosition.width
            }}
          >
            <div className="report-option-list">
              {DETAIL_TIME_PRESETS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={`report-option-button ${filters.timePreset === option.value ? 'selected' : ''}`}
                  onClick={event => {
                    const anchor = event.currentTarget.closest('.detail-filter-dropdown-field')?.querySelector('.detail-filter-button')
                    if (anchor instanceof HTMLElement) {
                      setDetailPopoverPosition(getDetailPopoverPosition(
                        anchor,
                        260,
                        DETAIL_TIME_POPOVER_HEIGHT
                      ))
                    }
                    onTimePresetChange(option.value)
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {filters.timePreset === 'custom' && (
              <div className="report-date-grid">
                <label>
                  <span>Từ ngày</span>
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={event => onDateFromChange(event.target.value)}
                  />
                </label>
                <label>
                  <span>Đến ngày</span>
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={event => onDateToChange(event.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="report-dropdown-field detail-filter-dropdown-field detail-filter-status-field">
        <span>Trạng thái</span>
        <button
          type="button"
          className={`report-filter-button detail-filter-button ${openDetailDropdown === statusDropdown ? 'active' : ''}`}
          onClick={event => handleDetailDropdownToggle(
            statusDropdown,
            event.currentTarget,
            DETAIL_POPOVER_MIN_WIDTH,
            getDetailOptionPopoverHeight(statusOptions.length + 1)
          )}
        >
          <strong>{getDetailStatusFilterLabel(statusOptions, filters.status)}</strong>
          <ChevronDown size={14} />
        </button>
        {openDetailDropdown === statusDropdown && detailPopoverPosition && (
          <div
            className="report-filter-popover detail-filter-popover"
            style={{
              top: detailPopoverPosition.top ?? 'auto',
              bottom: detailPopoverPosition.bottom ?? 'auto',
              left: detailPopoverPosition.left,
              width: detailPopoverPosition.width
            }}
          >
            <div className="report-option-list">
              <button
                type="button"
                className={`report-option-button ${!filters.status ? 'selected' : ''}`}
                onClick={() => {
                  onStatusChange('')
                  closeDetailDropdown()
                }}
              >
                Tất cả
              </button>
              {statusOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={`report-option-button ${filters.status === option.value ? 'selected' : ''}`}
                  onClick={() => {
                    onStatusChange(option.value)
                    closeDetailDropdown()
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const renderMultiSelectFilter = (
    key: CampaignFilterDropdown,
    label: string,
    options: CampaignFilterOption[],
    values: string[],
    onToggle: (value: string) => void,
    onClear: () => void,
    wide = false
  ) => {
    const isOpen = openFilterDropdown === key
    const triggerLabel = getMultiSelectLabel(options, values)

    return (
      <div className={`campaign-filter-field campaign-filter-multiselect campaign-filter-${key} ${wide ? 'is-wide' : ''}`}>
        <div className="campaign-multi-select">
          <button
            type="button"
            className={`campaign-multi-select-trigger ${isOpen ? 'is-open' : ''}`}
            onClick={() => setOpenFilterDropdown(prev => prev === key ? null : key)}
            aria-expanded={isOpen}
            title={`${label}: ${triggerLabel}`}
          >
            {renderCampaignFilterIcon(key)}
            <span className="campaign-filter-trigger-copy">
              <span className="campaign-filter-trigger-label">{label}:</span>
              <strong>{triggerLabel}</strong>
            </span>
            <ChevronDown size={14} />
          </button>

          {isOpen && (
            <div className="campaign-filter-menu">
              <button
                type="button"
                className={`campaign-filter-option ${values.length === 0 ? 'selected' : ''}`}
                onClick={onClear}
              >
                <span className="campaign-filter-option-check">
                  {values.length === 0 && <Check size={12} />}
                </span>
                <span className="campaign-filter-option-label">Tất cả</span>
              </button>

              {options.length > 0 && <div className="campaign-filter-menu-divider" />}

              {options.map(option => {
                const selected = values.includes(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`campaign-filter-option ${selected ? 'selected' : ''}`}
                    onClick={() => onToggle(option.value)}
                    title={option.label}
                  >
                    <span className="campaign-filter-option-check">
                      {selected && <Check size={12} />}
                    </span>
                    <span className="campaign-filter-option-label">{option.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="campaign-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      {screenshotPreview && (
        <div
          className="modal-overlay"
          style={{ zIndex: 2600, padding: 24 }}
          onMouseDown={() => setScreenshotPreview(null)}
        >
          <div
            onMouseDown={event => event.stopPropagation()}
            style={{
              width: 'min(1200px, 96vw)',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              overflow: 'hidden',
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                borderBottom: '1px solid var(--border-default)'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {screenshotPreview.title}
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setScreenshotPreview(null)}
                title="Đóng"
              >
                <X size={14} />
              </button>
            </div>
            <div
              style={{
                padding: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'auto',
                background: 'var(--bg-primary)'
              }}
            >
              <img
                src={screenshotPreview.dataUrl}
                alt="Browser screenshot"
                style={{
                  maxWidth: '100%',
                  maxHeight: 'calc(92vh - 74px)',
                  objectFit: 'contain',
                  borderRadius: 4,
                  border: '1px solid var(--border-default)'
                }}
              />
            </div>
          </div>
        </div>
      )}
      {zaloLoginAccount && (
        <div className="campaign-zalo-login-overlay">
          <div className="campaign-zalo-login-modal">
            <div className="campaign-zalo-login-header">
              <div>
                <strong>Đăng nhập Zalo</strong>
                <div>{zaloLoginAccount.name}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleCloseZaloLogin}>Đóng</button>
            </div>
            <div className="campaign-zalo-login-body">
              {zaloLoginEvent?.qrImage ? (
                <img src={zaloLoginEvent.qrImage} alt="Zalo QR" className="campaign-zalo-login-qr" />
              ) : (
                <div className="campaign-zalo-login-placeholder">
                  {zaloLoginStarting && <RefreshCw size={18} className="spin" />}
                </div>
              )}
              {zaloLoginEvent?.avatarUrl && (
                <img src={zaloLoginEvent.avatarUrl} alt="" className="campaign-zalo-login-avatar" />
              )}
              <div className="campaign-zalo-login-message">
                {zaloLoginEvent?.displayName && <strong>{zaloLoginEvent.displayName}</strong>}
                <span>{zaloLoginEvent?.message || 'Đang chờ trạng thái đăng nhập Zalo...'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="campaign-panel-top">
        <div className="campaign-panel-header">
          <span className="campaign-panel-title">Chiến dịch</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {canManageCampaignActions && (
              <button className="btn btn-ghost btn-icon" onClick={() => setShowActionManager(true)} title="Quản lý Hành động">
                <Settings2 size={14} />
              </button>
            )}
            <button
              className="btn btn-ghost btn-icon"
              onClick={handleReloadCampaigns}
              disabled={showCampaignTableLoading}
              title="Làm mới"
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditingCampaign(null)
                setCloneFromId(undefined)
                setCampaignFormInitialActionId(undefined)
                setCampaignFormInitialDetails(undefined)
                setShowForm(true)
              }}
              title="Thêm chiến dịch"
            >
              <Plus size={14} />
              <span>Thêm chiến dịch</span>
            </button>
          </div>
        </div>

        <div className="campaign-list-filter-panel" ref={filterPanelRef}>
          <div className="campaign-filter-row campaign-filter-compact-row">
            <div className="campaign-filter-field campaign-filter-search-field">
              <div className="campaign-filter-search-box">
                <Search size={17} />
                <input
                  value={campaignNameSearch}
                  onChange={event => setCampaignNameSearch(event.target.value)}
                  placeholder="Tìm tên chiến dịch..."
                />
              </div>
            </div>

            <div className="report-dropdown-field campaign-filter-time-preset">
              <button
                type="button"
                className={`report-filter-button campaign-filter-inline-button ${openFilterDropdown === 'time' ? 'active' : ''}`}
                onClick={() => setOpenFilterDropdown(prev => prev === 'time' ? null : 'time')}
                title={`Thời gian: ${campaignRangeLabel}`}
              >
                {renderCampaignFilterIcon('time')}
                <span className="campaign-filter-trigger-copy">
                  <span className="campaign-filter-trigger-label">Thời gian:</span>
                  <strong>{campaignRangeLabel}</strong>
                </span>
                <ChevronDown size={14} />
              </button>
              {openFilterDropdown === 'time' && (
                <div className="report-filter-popover campaign-time-filter-popover">
                  <div className="report-option-list">
                    {CAMPAIGN_TIME_PRESETS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        className={`report-option-button ${timePreset === option.value ? 'selected' : ''}`}
                        onClick={() => handleTimePresetChange(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {timePreset === 'custom' && (
                    <div className="report-date-grid">
                      <label>
                        <span>Từ ngày</span>
                        <input
                          type="date"
                          value={dateFrom}
                          onChange={event => setDateFrom(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Đến ngày</span>
                        <input
                          type="date"
                          value={dateTo}
                          onChange={event => setDateTo(event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>

            {renderMultiSelectFilter(
              'status',
              'Trạng thái',
              CAMPAIGN_STATUS_FILTER_OPTIONS,
              statusFilters,
              value => setStatusFilters(prev => toggleStringValue(prev, value)),
              () => setStatusFilters([])
            )}
            {renderMultiSelectFilter(
              'account',
              'Tài khoản',
              accountFilterOptions,
              accountFilters,
              value => setAccountFilters(prev => toggleStringValue(prev, value)),
              () => setAccountFilters([])
            )}
            {renderMultiSelectFilter(
              'platform',
              'Nền tảng',
              campaignPlatformOptions,
              platformFilters,
              value => setPlatformFilters(prev => toggleStringValue(prev, value)),
              () => setPlatformFilters([])
            )}
            {renderMultiSelectFilter(
              'action',
              'Loại chiến dịch',
              actionFilterOptions,
              actionFilters,
              value => setActionFilters(prev => toggleStringValue(prev, value)),
              () => setActionFilters([]),
              true
            )}
          </div>
        </div>

        {/* Filter indicator */}
        {filterAccountId && (
          <div className="campaign-filter-bar">
            <span>Lọc theo: <strong>{filterAccountName}</strong></span>
            <button className="btn-icon" onClick={onClearFilter} title="Bỏ lọc">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="campaign-bulk-action-bar">
            <span>Đã chọn <strong>{selectedIds.size}</strong> chiến dịch</span>
            <div className="bulk-action-buttons">
              <button className="btn btn-secondary btn-sm" disabled={bulkActionLoading} onClick={handleBulkResume} title="Tiếp tục các chiến dịch đang tạm dừng">
                <Play size={12} /> Tiếp tục
              </button>
              <button className="btn btn-secondary btn-sm" disabled={bulkActionLoading} onClick={handleBulkPause} title="Tạm dừng các chiến dịch đang chạy/chờ">
                <Pause size={12} /> Tạm dừng
              </button>
              <button className="btn btn-danger btn-sm" disabled={bulkActionLoading} onClick={handleBulkDelete} title="Xoá các chiến dịch đã chọn">
                <Trash2 size={12} /> Xoá
              </button>
              <button className="btn-icon" onClick={() => setSelectedIds(new Set())} title="Bỏ chọn tất cả">
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {showForm && (
          <CampaignFormModal
            campaign={editingCampaign}
            cloneFromId={cloneFromId}
            lockedActionId={campaignFormInitialActionId}
            initialDetails={campaignFormInitialDetails}
            onOpenGeneralSettings={onOpenGeneralSettings}
            onOpenContentTemplates={onOpenContentTemplates}
            onClose={() => {
              setShowForm(false)
              setEditingCampaign(null)
              setCloneFromId(undefined)
              setCampaignFormInitialActionId(undefined)
              setCampaignFormInitialDetails(undefined)
              loadCampaigns()
              if (selectedCampaignId) loadCampaignInputData(selectedCampaignId)
            }}
          />
        )}

        {showAddInputDataModal && (
          <AddInputDataToCampaignModal
            campaigns={campaigns}
            campaignActions={campaignActions}
            selectedCount={selectedInputDataRows.length}
            onLoadCampaigns={loadCampaigns}
            onSubmit={handleAddInputDataToCampaignSubmit}
            onClose={() => setShowAddInputDataModal(false)}
          />
        )}

        {addDataCampaign && (
          <AddDataToCurrentCampaignModal
            campaign={addDataCampaign}
            campaignAction={addDataCampaignAction}
            account={addDataCampaignAccount}
            onSubmit={handleAddDataToCurrentCampaignSubmit}
            onClose={() => setAddDataCampaign(null)}
          />
        )}

        {showActionManager && canManageCampaignActions && (
          <ActionManagerModal onClose={() => {
            setShowActionManager(false)
            loadCampaignActions()
          }} />
        )}

      </div>

      <div className="campaign-work-area" ref={workAreaRef}>
        {/* Campaign Table */}
        <div className="campaign-panel-content campaign-table-scroll" style={{ flex: 1, minHeight: 0 }}>
          {!showCampaignTableLoading && filteredCampaigns.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">{emptyCampaignText}</div></div>
          ) : (
            <div className="campaign-table">
              <div className="campaign-table-header">
                <div className="campaign-col col-campaign">
                  <input
                    className="campaign-list-select-checkbox"
                    aria-label="Chọn tất cả chiến dịch"
                    type="checkbox"
                    checked={!showCampaignTableLoading && filteredCampaigns.length > 0 && selectedFilteredCount === filteredCampaigns.length}
                    disabled={showCampaignTableLoading}
                    ref={el => { if (el) el.indeterminate = !showCampaignTableLoading && selectedFilteredCount > 0 && selectedFilteredCount < filteredCampaigns.length }}
                    onChange={toggleSelectAll}
                  />
                  <span>Chiến dịch</span>
                </div>
                <div className="campaign-col col-toggle">Dừng/Chạy</div>
                <div className="campaign-col col-progress">Trạng thái</div>
                <div className="campaign-col col-assistant">Trợ lý aka</div>
                <div className="campaign-col col-actions">Hành động</div>
                <div className="campaign-col col-account">Tài khoản</div>
                <div className="campaign-col col-send-date">Ngày gửi</div>
                <div className="campaign-col col-update-date">Ngày update</div>
              </div>
              {showCampaignTableLoading ? (
                <div className="campaign-table-loading-row">
                  <RefreshCw size={15} className="spin" />
                  <span>Đang tải danh sách chiến dịch...</span>
                </div>
              ) : filteredCampaigns.map(campaign => {
                const actionLabel = campaign.actionName || actionById.get(campaign.actionId)?.name || campaign.actionId
	                const account = accountById.get(campaign.accountId)
	                const accountLabel = campaign.accountName || account?.name || '-'
	                const campaignPlatform = normalizeCampaignPlatform(actionById.get(campaign.actionId)?.flatformType)
	                  || normalizeCampaignPlatform(account?.flatformType)
	                  || inferCampaignPlatformFromActionId(campaign.actionId)
	                const isSmsAccount = campaignPlatform === 'sms' || account?.flatformType === 'sms'
	                const accountLoginStatus = isSmsAccount ? '' : (account?.loginStatus || '-')
	                const isZaloCampaign = campaignPlatform === 'zalo'
                const scheduleTypeLabel = getCampaignListScheduleTypeLabel(campaign.scheduleType)
                const scheduleTimeLabel = formatCompactDateTime(campaign.schedule)
                const updatedLabel = formatCompactDateTime(campaign.updatedAt)
                const progress = getCampaignInputProgress(campaign)

                return (
                  <div
                    key={campaign.id}
                    className={`campaign-table-row ${getCampaignStatusClass(campaign.status)} ${selectedCampaignId === campaign.id ? 'selected' : ''} ${selectedIds.has(campaign.id) ? 'multi-selected' : ''}`}
                    onClick={() => handleRowClick(campaign)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="campaign-col col-campaign" title={[campaign.name, actionLabel, campaign.note || ''].filter(Boolean).join('\n')}>
                      <div className="campaign-row-select" onClick={e => e.stopPropagation()}>
                        <input
                          className="campaign-list-select-checkbox"
                          aria-label={`Chọn chiến dịch ${campaign.name}`}
                          type="checkbox"
                          checked={selectedIds.has(campaign.id)}
                          onChange={() => toggleSelectOne(campaign.id)}
                        />
                      </div>
                      <div className="campaign-main-cell">
                        <div className="campaign-name-line">{campaign.name}</div>
                        <div className="campaign-meta-line">{actionLabel}</div>
                        {campaign.note && <div className="campaign-note-line">{campaign.note}</div>}
                      </div>
                    </div>
                    <div className="campaign-col col-toggle" onClick={e => e.stopPropagation()}>
                      {canPauseCampaign(campaign.status) ? (
                        <button className="btn-icon campaign-control-button" onClick={() => handlePause(campaign)} title="Tạm dừng chiến dịch">
                          <Pause size={14} />
                        </button>
                      ) : canResumeCampaign(campaign.status) ? (
                        <button className="btn-icon campaign-control-button" onClick={() => handleResume(campaign)} title="Tiếp tục chiến dịch">
                          <Play size={14} />
                        </button>
                      ) : (
                        <span className="campaign-cell-muted">-</span>
                      )}
                    </div>
                    <div className="campaign-col col-progress" title={`${campaign.status}\n${progress.completed}/${progress.total}`}>
                      <div className="campaign-status-stack">
                        <span className="status-badge">{campaign.status}</span>
                        <div className="campaign-progress-count">{progress.completed}/{progress.total}</div>
                        <div className="campaign-progress-track" aria-label={`Tiến độ ${progress.completed}/${progress.total}`}>
                          <span className="campaign-progress-fill" style={{ width: `${progress.percentage}%` }} />
                        </div>
                      </div>
                    </div>
                    <div className="campaign-col col-assistant" onClick={e => e.stopPropagation()}>
                      <button className="btn-icon assistant campaign-control-button campaign-label-button" onClick={() => handleAskAssistant(campaign)} title="Hỏi trợ lý aka">
                        <Sparkles size={14} />
                        <span>Trợ lý</span>
                      </button>
                    </div>
                    <div className="campaign-col col-actions" onClick={e => e.stopPropagation()}>
                      <div className="campaign-action-dropdown">
                        <button
                          className="btn-icon campaign-control-button campaign-label-button"
                          onClick={event => handleCampaignActionMenuToggle(campaign.id, event)}
                          title="Mở hành động"
                          aria-haspopup="menu"
                          aria-expanded={openCampaignActionMenuId === campaign.id}
                        >
                          <ListTodo size={15} />
                          <span>Hành động</span>
                        </button>
                        {openCampaignActionMenuId === campaign.id && campaignActionMenuPosition && createPortal(
                          <div ref={campaignActionMenuRef} className="campaign-action-menu" style={campaignActionMenuPosition} role="menu">
                            <button
                              type="button"
                              className="campaign-action-menu-item"
                              onClick={() => {
                                setOpenCampaignActionMenuId(null)
                                handleEdit(campaign)
                              }}
                              disabled={!canEditCampaign(campaign.status)}
                              title={canEditCampaign(campaign.status) ? 'Sửa chiến dịch' : 'Chỉ sửa được chiến dịch chờ xử lý hoặc tạm dừng'}
                              role="menuitem"
                            >
                              <Edit3 size={14} />
                              <span>Sửa</span>
                            </button>
                            <button
                              type="button"
                              className="campaign-action-menu-item"
                              onClick={() => {
                                setOpenCampaignActionMenuId(null)
                                handleClone(campaign)
                              }}
                              role="menuitem"
                            >
                              <Copy size={14} />
                              <span>Nhân bản</span>
                            </button>
                            <button
                              type="button"
                              className="campaign-action-menu-item"
                              onClick={() => handleOpenAddDataToCurrentCampaignModal(campaign)}
                              role="menuitem"
                            >
                              <Plus size={14} />
                              <span>Thêm data</span>
                            </button>
                            <button
                              type="button"
                              className="campaign-action-menu-item"
                              onClick={() => {
                                setOpenCampaignActionMenuId(null)
                                openCampaignDetailTab(campaign, 'actions')
                              }}
                              role="menuitem"
                            >
                              <Eye size={14} />
                              <span>Xem báo cáo chi tiết</span>
                            </button>
                            <div className="campaign-action-menu-separator" />
                            {isZaloCampaign && (
                              <button
                                type="button"
                                className="campaign-action-menu-item"
                                onClick={() => handleZaloLoginQr(campaign, account)}
                                role="menuitem"
                              >
                                <LogIn size={14} />
                                <span>Đăng nhập lại Zalo</span>
                              </button>
                            )}
                            <button
                              type="button"
                              className="campaign-action-menu-item"
                              onClick={() => {
                                setOpenCampaignActionMenuId(null)
                                openCampaignDetailTab(campaign, 'accountInfo')
                              }}
                              role="menuitem"
                            >
                              <Info size={14} />
                              <span>Thông tin tài khoản</span>
                            </button>
                            <button
                              type="button"
                              className="campaign-action-menu-item"
                              onClick={() => {
                                setOpenCampaignActionMenuId(null)
                                openCampaignDetailTab(campaign, 'runLog')
                              }}
                              role="menuitem"
                            >
                              <History size={14} />
                              <span>Lịch sử chạy</span>
                            </button>
                            <div className="campaign-action-menu-separator" />
                            <button
                              type="button"
                              className="campaign-action-menu-item danger"
                              onClick={() => {
                                setOpenCampaignActionMenuId(null)
                                handleDelete(campaign)
                              }}
                              disabled={!canDeleteCampaign(campaign.status)}
                              title={canDeleteCampaign(campaign.status) ? 'Xoá chiến dịch' : 'Không thể xoá chiến dịch đang chạy'}
                              role="menuitem"
                            >
                              <Trash2 size={14} />
                              <span>Xoá</span>
                            </button>
                          </div>,
                          document.body
                        )}
                      </div>
                    </div>
	                    <div className="campaign-col col-account" title={isSmsAccount ? accountLabel : `${accountLabel}\n${accountLoginStatus}`}>
	                      <div className="campaign-two-line-cell">
	                        <div className="campaign-strong-line">{accountLabel}</div>
	                        {!isSmsAccount && (
	                          <div className={`campaign-account-login-badge ${getAccountLoginStatusClass(accountLoginStatus)}`}>
	                            {accountLoginStatus}
	                          </div>
	                        )}
	                      </div>
	                    </div>
                    <div className="campaign-col col-send-date" title={`${scheduleTypeLabel}\n${scheduleTimeLabel}`}>
                      <div className="campaign-two-line-cell">
                        <div className="campaign-send-time-line">{scheduleTimeLabel}</div>
                        <div className="campaign-schedule-type-badge">{scheduleTypeLabel}</div>
                      </div>
                    </div>
                    <div className="campaign-col col-update-date" title={updatedLabel}>
                      <div className="campaign-two-line-cell">
                        <div className="campaign-strong-line">{updatedLabel}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Bottom Detail Dock */}
        <div
          className={`campaign-detail-dock ${detailDockOpen ? 'is-open' : 'is-collapsed'}`}
          ref={detailDockRef}
          style={detailDockOpen && detailDockHeight !== null ? { height: detailDockHeight, flexBasis: detailDockHeight } : undefined}
        >
          {detailDockOpen && (
            <div
              className="detail-dock-resize-handle"
              onPointerDown={handleDetailDockResizeStart}
              role="separator"
              aria-orientation="horizontal"
              title="Kéo để thay đổi chiều cao"
            />
          )}
          <div className="detail-dock-header" onClick={() => setDetailDockOpen(!detailDockOpen)}>
            <span className="detail-dock-title">
              {selectedCampaign ? <>Chi tiết: <strong>{selectedCampaign.name || ''}</strong></> : 'Chi tiết chiến dịch'}
            </span>
            <button className="btn-icon">
              {detailDockOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>

          {detailDockOpen && (
            <div className="detail-dock-body">
              {!selectedCampaign ? (
                <div className="campaign-detail-empty-state">Chọn một chiến dịch để xem chi tiết.</div>
              ) : (
                <>
              {/* Tabs */}
              <div className="detail-dock-tabs">
                <button
                  className={`detail-dock-tab ${detailTab === 'info' ? 'active' : ''}`}
                  onClick={() => setDetailTab('info')}
                >
                  Thông tin
                </button>
                <button
                  className={`detail-dock-tab ${detailTab === 'data' ? 'active' : ''}`}
                  onClick={() => setDetailTab('data')}
                >
                  Data ban đầu ({filteredCampaignInputData.length})
                </button>
                <button
                  className={`detail-dock-tab ${detailTab === 'actions' ? 'active' : ''}`}
                  onClick={() => {
                    setDetailTab('actions')
                    if (selectedCampaignId) loadCampaignDetails(selectedCampaignId)
                  }}
                >
                  Kết quả chạy ({filteredCampaignDetails.length})
                </button>
                {isSelectedEmailClickTrackingCampaign && (
                  <button
                    className={`detail-dock-tab ${detailTab === 'emailLinks' ? 'active' : ''}`}
                    onClick={() => {
                      setDetailTab('emailLinks')
                      if (selectedCampaignId) loadEmailCampaignLinkTrackings(selectedCampaignId)
                    }}
                  >
                    Link email
                  </button>
                )}
                {isSelectedFindDataCampaign && (
                  <button
                    className={`detail-dock-tab ${detailTab === 'foundData' ? 'active' : ''}`}
                    onClick={() => {
                      setDetailTab('foundData')
                      if (selectedCampaignId) loadCampaignDetails(selectedCampaignId)
                    }}
                  >
                    Data tìm được ({foundDataItems.length})
                  </button>
                )}
                {linkedFindDataSourceCampaignIds.length > 0 && (
                  <button
                    className={`detail-dock-tab ${detailTab === 'findDataCampaigns' ? 'active' : ''}`}
                    onClick={() => setDetailTab('findDataCampaigns')}
                  >
                    Chiến dịch tìm data ({linkedFindDataSourceCampaignIds.length})
                  </button>
                )}
                {linkedFindDataTargetCampaignIds.length > 0 && (
                  <button
                    className={`detail-dock-tab ${detailTab === 'sourceCampaigns' ? 'active' : ''}`}
                    onClick={() => setDetailTab('sourceCampaigns')}
                  >
                    Chiến dịch nguồn ({linkedFindDataTargetCampaignIds.length})
                  </button>
                )}
                <button
                  className={`detail-dock-tab ${detailTab === 'runLog' ? 'active' : ''}`}
                  onClick={() => setDetailTab('runLog')}
                >
                  Lịch sử chạy ({runLogEntries.length})
                </button>
                {isSelectedFindDataCampaign && (
                  <button
                    className={`detail-dock-tab ${detailTab === 'findDataLog' ? 'active' : ''}`}
                    onClick={() => setDetailTab('findDataLog')}
                  >
                    Log tìm data ({findDataLogRows.length})
                  </button>
                )}
                {isSelectedCommentSeedingFeedCampaign && (
                  <button
                    className={`detail-dock-tab ${detailTab === 'postSearchLog' ? 'active' : ''}`}
                    onClick={() => setDetailTab('postSearchLog')}
                  >
                    Log tìm bài ({postSearchLogRows.length})
                  </button>
                )}
                <button
                  className={`detail-dock-tab ${detailTab === 'accountInfo' ? 'active' : ''}`}
                  onClick={() => setDetailTab('accountInfo')}
                >
                  Thông tin tài khoản
                </button>
              </div>

              <div className={`detail-dock-tab-content ${detailTab === 'findDataLog' || detailTab === 'postSearchLog' ? 'find-data-log-tab-content' : ''}`}>
              {/* Tab: Campaign info */}
              {detailTab === 'info' && selectedCampaign && (
                <CampaignInfoView
                  campaign={selectedCampaign}
                  account={selectedCampaignAccount}
                  action={selectedCampaignAction}
                  campaigns={campaigns}
                  accounts={accounts}
                />
              )}

              {/* Tab: Campaign Input Data */}
              {detailTab === 'data' && (
                <>
                  <div className="detail-export-bar detail-filter-bar">
                    {renderDetailFilters(
                      'inputDataTime',
                      'inputDataStatus',
                      inputDataFilters,
                      handleInputDataTimePresetChange,
                      value => setInputDataFilters(prev => ({ ...prev, dateFrom: value })),
                      value => setInputDataFilters(prev => ({ ...prev, dateTo: value })),
                      INPUT_DATA_STATUS_FILTER_OPTIONS,
                      value => setInputDataFilters(prev => ({ ...prev, status: value }))
	                    )}
	                    <div className="detail-filter-actions input-data-filter-actions">
	                      <button
	                        className="btn btn-secondary btn-sm"
	                        onClick={() => handleInputDataBatchStatus('chờ xử lý')}
	                        title="Tiếp tục data đã chọn"
	                      >
	                        <Play size={12} /> Tiếp tục
	                      </button>
	                      <button
	                        className="btn btn-secondary btn-sm"
	                        onClick={() => handleInputDataBatchStatus('tạm dừng')}
	                        title="Tạm dừng data đã chọn"
	                      >
	                        <Pause size={12} /> Tạm dừng
	                      </button>
	                      <div className="input-data-action-menu" ref={inputDataActionMenuRef}>
                        <button
                          className="btn btn-secondary"
                          onClick={handleInputDataActionMenuToggle}
                          title="Hành động với data đã chọn"
                        >
                          Hành động <ChevronDown size={14} />
                        </button>
                        {openInputDataActionMenu && (
                          <div className="input-data-action-menu-list">
                            <button type="button" onClick={handleCreateCampaignFromInputData}>
                              <Plus size={14} /> Tạo chiến dịch
                            </button>
                            <button type="button" onClick={handleOpenAddInputDataModal}>
                              <Plus size={14} /> Thêm vào chiến dịch
                            </button>
                            <button type="button" onClick={() => handleOpenAddDataToCurrentCampaignModal(selectedCampaign)}>
                              <Plus size={14} /> Thêm data
                            </button>
                            <button type="button" onClick={() => { setOpenInputDataActionMenu(false); handleExportCampaignInputData() }}>
                              <Download size={14} /> Xuất Excel
                            </button>
                          </div>
                        )}
                      </div>
                      {inputDataActionLoading && (
                        <RefreshCw size={14} className="spin input-data-action-spinner" />
                      )}
                    </div>
                  </div>
                  {loadingCampaignInputData ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : campaignInputData.length === 0 ? (
                    <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Chưa có dữ liệu nào</div>
                  ) : filteredCampaignInputData.length === 0 ? (
                    <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Không có dữ liệu phù hợp bộ lọc</div>
                  ) : (
                    <table className="campaign-grid" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
	                          <th style={{ width: 36, minWidth: 36 }}>
                            <input
                              type="checkbox"
                              checked={filteredCampaignInputData.length > 0 && selectedFilteredInputDataCount === filteredCampaignInputData.length}
                              ref={el => {
                                if (el) el.indeterminate = selectedFilteredInputDataCount > 0 && selectedFilteredInputDataCount < filteredCampaignInputData.length
                              }}
                              onChange={toggleSelectAllInputData}
                            />
                          </th>
	                          <th style={{ minWidth: 120, whiteSpace: 'nowrap' }}>Tên</th>
	                          {isSelectedSmsCampaign ? (
	                            <>
		                              <th style={{ minWidth: 96, whiteSpace: 'nowrap' }}>SĐT</th>
		                              <th style={{ minWidth: 88, whiteSpace: 'nowrap' }}>Nhà mạng</th>
		                              <th style={{ minWidth: 64, whiteSpace: 'nowrap' }}>Info1</th>
		                              <th style={{ minWidth: 64, whiteSpace: 'nowrap' }}>Info2</th>
		                              <th style={{ minWidth: 64, whiteSpace: 'nowrap' }}>Info3</th>
		                              <th style={{ minWidth: 64, whiteSpace: 'nowrap' }}>Info4</th>
		                              <th style={{ minWidth: 64, whiteSpace: 'nowrap' }}>Info5</th>
		                              <th style={{ minWidth: 160, whiteSpace: 'nowrap' }}>Nội dung SMS</th>
		                              <th style={{ minWidth: 120, whiteSpace: 'nowrap' }}>Lịch gửi</th>
	                            </>
	                          ) : (
	                            <>
	                              <th style={{ minWidth: 180, whiteSpace: 'nowrap' }}>UID</th>
	                              <th style={{ minWidth: 96, whiteSpace: 'nowrap' }}>SĐT</th>
	                              <th style={{ minWidth: 160, whiteSpace: 'nowrap' }}>Email</th>
	                            </>
	                          )}
	                          <th style={{ minWidth: 96, whiteSpace: 'nowrap' }}>Trạng thái</th>
	                          <th style={{ minWidth: 120, whiteSpace: 'nowrap' }}>Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCampaignInputData.map(d => (
                          <tr key={d.id} className={selectedInputDataIds.has(d.id) ? 'input-data-selected-row' : ''}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedInputDataIds.has(d.id)}
                                onChange={() => toggleSelectInputData(d.id)}
                              />
                            </td>
	                            <td title={d.name || '-'} style={{ minWidth: 120 }}>{d.name || '-'}</td>
	                            {isSelectedSmsCampaign ? (
	                              <>
		                                <td title={d.phone || '-'} style={{ minWidth: 96 }}>{d.phone || '-'}</td>
		                                <td title={formatInputDataPhoneCarrier(d)} style={{ minWidth: 88 }}>{formatInputDataPhoneCarrier(d)}</td>
		                                <td title={d.info1 || '-'} style={{ minWidth: 64 }}>{d.info1 || '-'}</td>
		                                <td title={d.info2 || '-'} style={{ minWidth: 64 }}>{d.info2 || '-'}</td>
		                                <td title={d.info3 || '-'} style={{ minWidth: 64 }}>{d.info3 || '-'}</td>
		                                <td title={d.info4 || '-'} style={{ minWidth: 64 }}>{d.info4 || '-'}</td>
		                                <td title={d.info5 || '-'} style={{ minWidth: 64 }}>{d.info5 || '-'}</td>
			                                <td title={d.content || '-'} style={{ minWidth: 160, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.content || '-'}</td>
		                                <td title={formatCompactDateTime(d.schedule)} style={{ minWidth: 120, whiteSpace: 'nowrap' }}>{formatCompactDateTime(d.schedule)}</td>
	                              </>
	                            ) : (
	                              <>
	                                <td title={d.uid || '-'} style={{ minWidth: 180, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.uid || '-'}</td>
	                                <td title={d.phone || '-'} style={{ minWidth: 96 }}>{d.phone || '-'}</td>
	                                <td title={d.email || '-'} style={{ minWidth: 160 }}>{d.email || '-'}</td>
	                              </>
	                            )}
	                            <td title={d.status} style={{ minWidth: 96, whiteSpace: 'nowrap' }}>
	                              <span style={{ color: getStatusColor(d.status) }}>{d.status}</span>
	                            </td>
	                            <td title={d.note || '-'} style={{ minWidth: 120, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.note || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {/* Tab: Campaign Details (per-milestone log) */}
              {detailTab === 'actions' && (
                <>
                  <div className="detail-export-bar detail-filter-bar">
                    {renderDetailFilters(
                      'actionsTime',
                      'actionsStatus',
                      actionDetailFilters,
                      handleActionDetailTimePresetChange,
                      value => setActionDetailFilters(prev => ({ ...prev, dateFrom: value })),
                      value => setActionDetailFilters(prev => ({ ...prev, dateTo: value })),
                      actionDetailStatusOptions,
                      value => setActionDetailFilters(prev => ({ ...prev, status: value }))
                    )}
                    <div className="detail-filter-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={handleLoadCampaignDetails}
                        disabled={loadingCampaignDetails}
                        title="Tải lại kết quả chạy"
                      >
                        <RefreshCw size={14} className={loadingCampaignDetails ? 'spin' : ''} /> Tải lại
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={handleExportCampaignDetails}
                        disabled={loadingCampaignDetails || filteredCampaignDetails.length === 0}
                        title="Xuất lịch sử hành động ra Excel"
                      >
                        <Download size={14} /> Xuất Excel
                      </button>
                    </div>
                  </div>
                  {loadingCampaignDetails ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : campaignDetails.length === 0 ? (
                    <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Chưa có hành động nào được ghi nhận</div>
                  ) : filteredCampaignDetails.length === 0 ? (
                    <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Không có kết quả chạy phù hợp bộ lọc</div>
                  ) : (
                    <table className="campaign-grid" style={{ fontSize: 12 }}>
                      <thead>
                        {isSelectedSmsCampaign ? (
                          <tr>
                            <th style={{ minWidth: 150, whiteSpace: 'nowrap' }}>Thời gian</th>
                            <th style={{ minWidth: 120, whiteSpace: 'nowrap' }}>SĐT</th>
                            <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>Nhà mạng</th>
                            <th style={{ minWidth: 80, whiteSpace: 'nowrap' }}>SIM</th>
                            <th style={{ minWidth: 130, whiteSpace: 'nowrap' }}>Trạng thái</th>
                            <th style={{ minWidth: 160, whiteSpace: 'nowrap' }}>Nội dung SMS</th>
                            <th style={{ minWidth: 260, whiteSpace: 'nowrap' }}>Chi tiết</th>
                          </tr>
                        ) : (
                          <tr>
                            <th>Thời gian</th>
                            <th>Hành động</th>
                            <th>Trạng thái</th>
                            <th>Chi tiết</th>
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {filteredCampaignDetails.map(a => {
                          const createdAtLabel = formatDisplayDateTime(a.createdAt)
                          const statusLabel = getDetailStatusLabel(a.status)
                          const detailLogTitle = getCampaignDetailLogTitle(a)
                          const smsDetail = isSelectedSmsCampaign ? getSmsCampaignDetailInfo(a) : null
                          return (
                            <tr key={a.id}>
                              <td title={createdAtLabel} style={{ whiteSpace: 'nowrap' }}>
                                {createdAtLabel}
                              </td>
                              {isSelectedSmsCampaign ? (
                                <>
                                  <td title={smsDetail?.phone || '-'} style={{ whiteSpace: 'nowrap' }}>
                                    {smsDetail?.phone || '-'}
                                  </td>
                                  <td title={smsDetail?.carrierLabel || '-'} style={{ whiteSpace: 'nowrap' }}>
                                    {smsDetail?.carrierLabel || '-'}
                                  </td>
                                  <td title={smsDetail?.simSlot || '-'} style={{ whiteSpace: 'nowrap' }}>
                                    {smsDetail?.simSlot || '-'}
                                  </td>
                                </>
                              ) : (
                                <td title={a.actionName || '-'}>
                                  <strong>{a.actionName}</strong>
                                </td>
                              )}
                              <td title={statusLabel}>
                                <span style={{ color: getStatusColor(a.status) }}>
                                  {statusLabel}
                                </span>
                              </td>
                              {isSelectedSmsCampaign && (
                                <td className="campaign-detail-sms-content-cell" title={smsDetail?.content || '-'}>
                                  {smsDetail?.content || '-'}
                                </td>
                              )}
                              <td className="campaign-detail-log-cell" title={detailLogTitle}>
                                {renderCampaignDetailLog(a)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {/* Tab: Email link tracking */}
              {detailTab === 'emailLinks' && (
                <div className="find-data-log-panel">
                  <div className="detail-export-bar detail-filter-bar find-data-log-toolbar">
                    <div className="find-data-log-toolbar-left">
                      <button
                        className="btn btn-secondary"
                        onClick={handleLoadEmailCampaignLinks}
                        disabled={emailLinkTabLoading}
                        title="Tải lại link email"
                      >
                        <RefreshCw size={14} className={emailLinkTabLoading ? 'spin' : ''} /> Tải lại
                      </button>
                    </div>
                    <div className="detail-filter-actions">
                      <span className="campaign-relation-breakdown-chip success">
                        Tổng click: {formatCount(totalEmailLinkClicks)}
                      </span>
                    </div>
                  </div>
                  {emailLinkTabLoading ? (
                    <div className="find-data-log-empty text-center text-secondary">Đang tải...</div>
                  ) : selectedCampaignEmailLinkTrackings.length === 0 ? (
                    <div className="find-data-log-empty text-center text-muted">Chưa có link email</div>
                  ) : (
                    <table className="campaign-grid" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 48 }}>STT</th>
                          <th>Link</th>
                          <th>Số click</th>
                          <th>Số email</th>
                          <th>Số link</th>
                          <th>Click đầu</th>
                          <th>Click cuối</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCampaignEmailLinkTrackings.map((item: EmailCampaignLinkTrackingSummary, index: number) => (
                          <tr key={item.url}>
                            <td>{index + 1}</td>
                            <td className="find-data-log-link-cell" title={item.url}>
                              <a
                                className="find-data-log-link"
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {item.url}
                              </a>
                            </td>
                            <td title={formatCount(item.clickCount)}>
                              <strong>{formatCount(item.clickCount)}</strong>
                            </td>
                            <td title={formatCount(item.emailCount)}>{formatCount(item.emailCount)}</td>
                            <td title={formatCount(item.linkCount)}>{formatCount(item.linkCount)}</td>
                            <td title={formatDisplayDateTime(item.firstClickedAt || undefined)} style={{ whiteSpace: 'nowrap' }}>
                              {formatDisplayDateTime(item.firstClickedAt || undefined)}
                            </td>
                            <td title={formatDisplayDateTime(item.lastClickedAt || undefined)} style={{ whiteSpace: 'nowrap' }}>
                              {formatDisplayDateTime(item.lastClickedAt || undefined)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Tab: Find-data run events */}
              {detailTab === 'findDataLog' && (
                <div className="find-data-log-panel">
                  <div className="detail-export-bar detail-filter-bar find-data-log-toolbar">
                    <div className="find-data-log-toolbar-left">
                      <button
                        className="btn btn-secondary"
                        onClick={handleLoadFindDataLog}
                        disabled={loadingCampaignRunEvents}
                        title="Tải lại log tìm kiếm"
                      >
                        <RefreshCw size={14} className={loadingCampaignRunEvents ? 'spin' : ''} /> Tải lại
                      </button>
                    </div>
                    <div className="detail-filter-actions">
                      {canViewAllFindDataLogs && (
                        <div className="report-dropdown-field detail-filter-dropdown-field find-data-log-scope-field">
                          <button
                            type="button"
                            className={`report-filter-button detail-filter-button ${openDetailDropdown === 'findDataLogScope' ? 'active' : ''}`}
                            onClick={event => handleDetailDropdownToggle(
                              'findDataLogScope',
                              event.currentTarget,
                              180,
                              getDetailOptionPopoverHeight(2)
                            )}
                            disabled={loadingCampaignRunEvents}
                            title="Chọn phạm vi log tìm data"
                          >
                            <strong>{getFindDataLogScopeLabel(findDataLogScope)}</strong>
                            <ChevronDown size={14} />
                          </button>
                          {openDetailDropdown === 'findDataLogScope' && detailPopoverPosition && (
                            <div
                              className="report-filter-popover detail-filter-popover"
                              style={{
                                top: detailPopoverPosition.top ?? 'auto',
                                bottom: detailPopoverPosition.bottom ?? 'auto',
                                left: detailPopoverPosition.left,
                                width: detailPopoverPosition.width
                              }}
                            >
                              <div className="report-option-list">
                                {([
                                  { value: 'visible', label: 'Log tìm kiếm' },
                                  { value: 'all', label: 'Tất cả log' }
                                ] as Array<{ value: FindDataLogScope; label: string }>).map(option => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    className={`report-option-button ${findDataLogScope === option.value ? 'selected' : ''}`}
                                    onClick={() => {
                                      setFindDataLogScope(option.value)
                                      closeDetailDropdown()
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        className="btn btn-secondary"
                        onClick={handleExportFindDataLog}
                        disabled={loadingCampaignRunEvents || findDataLogRows.length === 0}
                        title="Xuất log tìm data ra Excel"
                      >
                        <Download size={14} /> Xuất Excel
                      </button>
                    </div>
                  </div>
                  {loadingCampaignRunEvents ? (
                    <div className="find-data-log-empty text-center text-secondary">Đang tải...</div>
                  ) : campaignRunEvents.length === 0 ? (
                    <div className="find-data-log-empty text-center text-muted">Chưa có log tìm data</div>
                  ) : (
                    <div className="find-data-log-table-shell">
                      <div
                        className="find-data-log-table-wrap"
                        ref={findDataLogTableWrapRef}
                        onScroll={handleFindDataLogTableScroll}
                      >
                        <table className="campaign-grid find-data-log-grid" style={{ fontSize: 12 }}>
                          <colgroup>
                            <col className="find-data-log-col-time" />
                            <col className="find-data-log-col-source" />
                            <col className="find-data-log-col-action" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>Thời gian</th>
                              <th>Nguồn</th>
                              <th>Hành động</th>
                              <th>Trạng thái</th>
                              <th>Số lượng</th>
                              <th>STT</th>
                              <th>Link</th>
                              <th>Tên</th>
                              <th>UID</th>
                              <th>Nội dung</th>
                              <th>SĐT</th>
                              <th>Link Zalo</th>
                              <th>Link post</th>
                              <th>Keyword</th>
                              <th>Chứa keyword</th>
                              <th>Prompt gửi AI</th>
                              <th>Kết quả AI</th>
                              <th>Kiểm tra ý nghĩa AI</th>
                            </tr>
                          </thead>
                          <tbody>
                            {findDataLogRows.map(row => (
                              <tr key={row.key}>
                                <td title={row.timeLabel} style={{ whiteSpace: 'nowrap' }}>{row.timeLabel}</td>
                                <td title={row.source}>{row.source}</td>
                                <td className="find-data-log-cell-text" title={row.action}>{row.action}</td>
                                <td title={row.statusLabel}>
                                  <span style={{ color: row.statusColor }}>{row.statusLabel}</span>
                                </td>
                                <td title={row.elementCount}>{row.elementCount}</td>
                                <td title={row.itemIndex}>{row.itemIndex}</td>
                                <td className="find-data-log-link-cell" title={row.link || '-'}>
                                  {row.link ? (
                                    <a
                                      className="find-data-log-link"
                                      href={row.link}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {row.link}
                                    </a>
                                  ) : '-'}
                                </td>
                                <td className="find-data-log-cell-text" title={row.name || '-'}>{row.name || '-'}</td>
                                <td className="find-data-log-cell-text" title={row.uid || '-'}>{row.uid || '-'}</td>
                                <td className="find-data-log-content-cell" title={row.contentText || '-'}>{row.contentText || '-'}</td>
                                <td className="find-data-log-cell-text" title={row.phones || '-'}>{row.phones || '-'}</td>
                                <td className="find-data-log-link-cell" title={row.zaloGroupLinks || '-'}>{row.zaloGroupLinks || '-'}</td>
                                <td className="find-data-log-link-cell" title={row.postLinks || '-'}>{row.postLinks || '-'}</td>
                                <td className="find-data-log-cell-text" title={row.keyword || '-'}>{row.keyword || '-'}</td>
                                <td title={row.matchedKeyword}>{row.matchedKeyword}</td>
                                <td className="find-data-log-content-cell" title={row.aiFinalPrompt || '-'}>{row.aiFinalPrompt || '-'}</td>
                                <td className="find-data-log-content-cell" title={row.aiRawResult || '-'}>{row.aiRawResult || '-'}</td>
                                <td className="find-data-log-cell-text" title={row.aiMeaningCheck}>{row.aiMeaningCheck}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div
                        className="find-data-log-x-scroll"
                        ref={findDataLogXScrollRef}
                        onScroll={handleFindDataLogXScroll}
                      >
                        <div className="find-data-log-x-scroll-spacer" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Comment seeding post-search run events */}
              {detailTab === 'postSearchLog' && (
                <div className="find-data-log-panel">
                  <div className="detail-export-bar detail-filter-bar find-data-log-toolbar">
                    <div className="find-data-log-toolbar-left">
                      <button
                        className="btn btn-secondary"
                        onClick={handleLoadPostSearchLog}
                        disabled={loadingCampaignRunEvents}
                        title="Tải lại log tìm bài"
                      >
                        <RefreshCw size={14} className={loadingCampaignRunEvents ? 'spin' : ''} /> Tải lại
                      </button>
                    </div>
                    <div className="detail-filter-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={handleExportPostSearchLog}
                        disabled={loadingCampaignRunEvents || postSearchLogRows.length === 0}
                        title="Xuất log tìm bài ra Excel"
                      >
                        <Download size={14} /> Xuất Excel
                      </button>
                    </div>
                  </div>
                  {loadingCampaignRunEvents ? (
                    <div className="find-data-log-empty text-center text-secondary">Đang tải...</div>
                  ) : postSearchLogRows.length === 0 ? (
                    <div className="find-data-log-empty text-center text-muted">Chưa có log tìm bài</div>
                  ) : (
                    <div className="find-data-log-table-shell">
                      <div
                        className="find-data-log-table-wrap"
                        ref={findDataLogTableWrapRef}
                        onScroll={handleFindDataLogTableScroll}
                      >
                        <table className="campaign-grid find-data-log-grid" style={{ fontSize: 12 }}>
                          <colgroup>
                            <col className="find-data-log-col-time" />
                            <col className="find-data-log-col-action" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>Thời gian</th>
                              <th>Hành động</th>
                              <th>Trạng thái</th>
                              <th>STT</th>
                              <th>Link bài</th>
                              <th>Nội dung bài</th>
                              <th>Keyword</th>
                              <th>Chứa keyword</th>
                              <th>Prompt gửi AI</th>
                              <th>Kết quả AI</th>
                              <th>Kiểm tra ý nghĩa AI</th>
                            </tr>
                          </thead>
                          <tbody>
                            {postSearchLogRows.map(row => (
                              <tr key={row.key}>
                                <td title={row.timeLabel} style={{ whiteSpace: 'nowrap' }}>{row.timeLabel}</td>
                                <td className="find-data-log-cell-text" title={row.action}>{row.action}</td>
                                <td title={row.statusLabel}>
                                  <span style={{ color: row.statusColor }}>{row.statusLabel}</span>
                                </td>
                                <td title={row.itemIndex}>{row.itemIndex}</td>
                                <td className="find-data-log-link-cell" title={row.link || '-'}>
                                  {row.link ? (
                                    <a
                                      className="find-data-log-link"
                                      href={row.link}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {row.link}
                                    </a>
                                  ) : '-'}
                                </td>
                                <td className="find-data-log-content-cell" title={row.contentText || '-'}>{row.contentText || '-'}</td>
                                <td className="find-data-log-cell-text" title={row.keyword || '-'}>{row.keyword || '-'}</td>
                                <td title={row.matchedKeyword}>{row.matchedKeyword}</td>
                                <td className="find-data-log-content-cell" title={row.aiFinalPrompt || '-'}>{row.aiFinalPrompt || '-'}</td>
                                <td className="find-data-log-content-cell" title={row.aiRawResult || '-'}>{row.aiRawResult || '-'}</td>
                                <td className="find-data-log-cell-text" title={row.aiMeaningCheck}>{row.aiMeaningCheck}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div
                        className="find-data-log-x-scroll"
                        ref={findDataLogXScrollRef}
                        onScroll={handleFindDataLogXScroll}
                      >
                        <div className="find-data-log-x-scroll-spacer" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Find-data campaigns feeding this campaign */}
              {detailTab === 'findDataCampaigns' && (
                renderCampaignRelationSummaries('Chưa có chiến dịch tìm data liên kết.')
              )}

              {/* Tab: Campaigns receiving data from this find-data campaign */}
              {detailTab === 'sourceCampaigns' && (
                renderCampaignRelationSummaries('Chưa có chiến dịch nguồn liên kết.')
              )}

              {/* Tab: Campaign run log from auto_campaigns.log */}
              {detailTab === 'runLog' && (
                runLogEntries.length === 0 && !loadingCampaignRunEvents ? (
                  <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Chưa có lịch sử chạy</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {runLogEntries.length > 0 && (
                      <table className="campaign-grid" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th>Thời gian</th>
                            <th>Nội dung</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runLogEntries.map(entry => {
                            const screenshotEvent = entry.screenshotEventId
                              ? screenshotEventById.get(entry.screenshotEventId)
                              : undefined
                            const canPreviewScreenshot = !!screenshotEvent && !!getScreenshotPath(screenshotEvent)
                            return (
                              <tr key={entry.key}>
                                <td title={entry.timestamp || '-'} style={{ whiteSpace: 'nowrap' }}>{entry.timestamp || '-'}</td>
                                <td className="campaign-detail-log-cell" title={entry.message || '-'}>
                                  <span>{entry.message}</span>
                                  {screenshotEvent && (
                                    <button
                                      type="button"
                                      className="run-log-screenshot-button"
                                      onClick={() => handlePreviewScreenshot(screenshotEvent)}
                                      disabled={!canPreviewScreenshot}
                                      title={canPreviewScreenshot ? 'Xem ảnh screenshot' : 'Không tìm thấy file ảnh'}
                                    >
                                      Xem
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}

                    {loadingCampaignRunEvents && (
                      <div className="text-center text-secondary" style={{ padding: 12, fontSize: 12 }}>Đang tải screenshot...</div>
                    )}
                  </div>
                )
              )}

              {/* Tab: Account info for the selected campaign */}
              {detailTab === 'accountInfo' && (
                selectedCampaignAccount ? (
                  <AccountInfoView account={selectedCampaignAccount} mode="dock" />
                ) : (
                  <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>
                    Không tìm thấy tài khoản của chiến dịch này
                  </div>
                )
              )}

              {/* Tab: Found data extracted by facebook_find_data_group */}
              {detailTab === 'foundData' && (
                <>
                  <div className="find-data-export-bar">
                    <div className="find-data-export-options">
                      {FOUND_DATA_EXPORT_OPTIONS.map(option => (
                        <label key={option.kind} className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={foundDataExportKinds.has(option.kind)}
                            onChange={() => toggleFoundDataExportKind(option.kind)}
                            disabled={loadingCampaignDetails}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={handleExportFoundData}
                      disabled={loadingCampaignDetails || selectedFoundDataItems.length === 0}
                      title="Xuất data tìm được ra Excel"
                    >
                      <Download size={14} /> Xuất Excel
                    </button>
                  </div>
                  {loadingCampaignDetails ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : foundDataItems.length === 0 ? (
                    <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Chưa tìm thấy data nào</div>
                  ) : (
                    <table className="campaign-grid find-data-result-grid" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Loại data</th>
                          <th>Giá trị</th>
                          <th>Tên</th>
                          <th>Group</th>
                          <th>Thời gian</th>
                        </tr>
                      </thead>
                      <tbody>
                        {foundDataItems.map(item => {
                          const createdAtLabel = formatDisplayDateTime(item.createdAt)
                          return (
                            <tr key={item.key}>
                              <td title={item.label}>
                                <span className={`find-data-kind find-data-kind-${item.kind}`}>
                                  {item.label}
                                </span>
                              </td>
                              <td className="find-data-value-cell" title={item.value}>{item.value}</td>
                              <td title={item.name || '-'}>{item.name || '-'}</td>
                              <td className="find-data-group-cell" title={item.groupUrl}>{item.groupUrl}</td>
                              <td title={createdAtLabel} style={{ whiteSpace: 'nowrap' }}>
                                {createdAtLabel}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              )}
              </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
