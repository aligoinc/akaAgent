import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, ChevronUp, ChevronDown, Check, Upload, Calendar, Image, Users, Sparkles, RefreshCw, FileText, Save, Search, Settings2, Heart, MessageCircle, Loader2 } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import {
  ActionLimitConfig,
  AkaBizCampaignListItem,
  AkaBizCampaignListKind,
  AkaBizIntegrations,
  AutoAccountContact,
  Campaign,
  CampaignInputData,
  CampaignExtraSettings,
  ContentTemplate,
  ZaloLabelOption
} from '../../../../shared/types'
import { read, utils } from 'xlsx'
import DataScanModal, { DataScanAction } from '../DataScan/DataScanModal'
import { useUiStore } from '../../stores/uiStore'
import type { GeneralSettingsMenu } from '../Settings/GeneralSettingsModal'

type FindDataTargetCampaignField =
  | 'findUidTargetCampaignIds'
  | 'findPostLinkTargetCampaignIds'
  | 'findFacebookGroupPostTargetCampaignIds'
  | 'findFacebookGroupCommentTargetCampaignIds'
type CampaignPickerColumn = 'name' | 'account' | 'status' | 'schedule' | 'dataTypes' | 'sourceTypes'
type CampaignPickerSource =
  | { type: 'findDataSource' }
  | { type: 'messageUidTarget' }
  | { type: 'postLinkTarget' }
  | { type: 'groupPostTarget' }
  | { type: 'groupCommentTarget' }
  | { type: 'external'; kind: AkaBizCampaignListKind }
type InternalCampaignPickerSourceType = Exclude<CampaignPickerSource['type'], 'external'>

interface CampaignPickerRow {
  id: number
  name: string
  accountName?: string
  status?: string
  scheduleLabel?: string
  dataTypes?: string[]
  sourceTypes?: string[]
  searchText: string
}

interface CampaignPickerModalState {
  title: string
  source: CampaignPickerSource
  columns: CampaignPickerColumn[]
  emptyText: string
  selectedIds: number[]
  draftIds: number[]
  draftTempIdsAtOpen: number[]
  searchQuery: string
  onConfirm: (ids: number[]) => void
}

interface ContentTemplatePickerModalState {
  target: AiContentTarget
  title: string
  searchQuery: string
}

interface ContentTemplateSaveModalState {
  target: AiContentTarget
  name: string
  content: string
}

interface CampaignSaveBundleItem {
  campaignPayload: Partial<Campaign>
  details: Partial<CampaignInputData>[]
}

interface InternalCampaignDraft {
  tempId: number
  sourceType: InternalCampaignPickerSourceType
  actionId: string
  requiredTargetField?: FindDataTargetCampaignField | null
  items: CampaignSaveBundleItem[]
}

interface CampaignFormModalProps {
  campaign: Campaign | null
  cloneFromId?: number
  onOpenGeneralSettings?: (menu?: GeneralSettingsMenu) => void
  draftMode?: boolean
  draftTempId?: number
  lockedActionId?: string
  initialDetails?: Partial<CampaignInputData>[]
  draftPickerSourceType?: InternalCampaignPickerSourceType
  draftRequiredTargetField?: FindDataTargetCampaignField | null
  onSaveDraft?: (draft: InternalCampaignDraft) => void
  modalZIndex?: number
  onClose: () => void
}

interface StepDef {
  id: string
  title: string
  fields: { key: string; label: string }[]
}

type ActionLimitForm = Required<Pick<ActionLimitConfig, 'dailyLimit' | 'rateLimitCount' | 'rateLimitMinutes'>>
type ImageOption = 'none' | 'all' | 'random'
type CommentImageOption = 'none' | 'all'
type CommentGroupMode = 'all' | 'pending_only' | 'published_only'
type CommentType = 'own' | 'others' | 'all'
type PostBumpMode = 'select' | 'create'
type MessageDateOption = 'today' | 'tomorrow' | 'yesterday'
type MessageDateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY'
type AiContentTarget = 'content' | 'commentContent' | 'postBumpContent'
type AiContentAction = 'multi' | 'rewrite'
type FindDataGoalPriority = NonNullable<CampaignExtraSettings['findDataGoalPriority']>
interface FindDataGoalFlagState {
  isFindPhone: boolean
  isFindLinkGroupZalo: boolean
  isFindUid: boolean
  isFindPostLink: boolean
  isFindFacebookGroup: boolean
}
interface FindDataFlagState {
  isFindPhone: boolean
  isFindLinkGroupZalo: boolean
  isFindUid: boolean
  isFindPostLink: boolean
  isFindFacebookGroup: boolean
  isFindInPost: boolean
  isFindInComment: boolean
  isFindNewInteractors: boolean
  isFindInGroupMembers: boolean
}

const normalizeFindDataFlagState = <T extends FindDataFlagState>(state: T, options: { isSearchCampaign?: boolean } = {}): T => {
  const supportsPost = state.isFindPhone || state.isFindLinkGroupZalo || state.isFindUid || state.isFindPostLink
  const supportsComment = state.isFindPhone || state.isFindLinkGroupZalo || state.isFindUid
  const supportsUidOnlySources = state.isFindUid && !options.isSearchCampaign

  return {
    ...state,
    isFindInPost: supportsPost ? (state.isFindPostLink ? true : state.isFindInPost) : false,
    isFindInComment: supportsComment ? state.isFindInComment : false,
    isFindNewInteractors: supportsUidOnlySources ? state.isFindNewInteractors : false,
    isFindInGroupMembers: supportsUidOnlySources ? state.isFindInGroupMembers : false
  }
}

const CONTENT_TEMPLATE_TARGET_LABELS: Record<AiContentTarget, string> = {
  content: 'nội dung chiến dịch',
  commentContent: 'nội dung comment',
  postBumpContent: 'nội dung up tin'
}

const DEFAULT_RATE_LIMIT_MINUTES = 65

const DEFAULT_ACTION_LIMIT: ActionLimitForm = {
  dailyLimit: 30,
  rateLimitCount: 9,
  rateLimitMinutes: DEFAULT_RATE_LIMIT_MINUTES
}

const ZALO_FIND_PHONE_ACTION_CODE = 'zalo_find_phone_user'
const ZALO_FIND_PHONE_DEFAULT_LIMIT = 1000

const ACTION_CODE_LABELS: Record<string, string> = {
  fb_post_group: 'Đăng bài group',
  fb_post_my_profile: 'Đăng bài trang cá nhân',
  fb_post_page: 'Đăng bài fanpage',
  fb_comment: 'Comment',
  fb_message_stranger: 'Nhắn tin người lạ',
  fb_message_friend: 'Nhắn tin bạn bè',
  fb_message_page_inbox_customer: 'Nhắn tin khách inbox page',
  fb_add_friend: 'Kết bạn',
  fb_like_post: 'Like post',
  zalo_find_phone_user: 'Tìm SĐT',
  zalo_message_friend: 'Nhắn tin bạn bè',
  zalo_message_stranger: 'Nhắn tin người lạ',
  zalo_add_friend: 'Kết bạn',
  zalo_tag_contact: 'Gắn tag Zalo',
  zalo_change_alias: 'Đổi tên Zalo'
}

const getActionCodeLabel = (code: string) => ACTION_CODE_LABELS[code] || code

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

const toActionLimitForm = (
  config?: ActionLimitConfig,
  fallback: ActionLimitForm = DEFAULT_ACTION_LIMIT
): ActionLimitForm => ({
  dailyLimit: config?.dailyLimit ?? fallback.dailyLimit,
  rateLimitCount: config?.rateLimitCount ?? fallback.rateLimitCount,
  rateLimitMinutes: config?.rateLimitMinutes ?? fallback.rateLimitMinutes
})

const isHiddenActionLimitConfig = (actionCode: string): boolean => (
  actionCode === ZALO_FIND_PHONE_ACTION_CODE
)

const getDefaultActionLimitForCode = (
  actionCode: string,
  fallback: ActionLimitForm
): ActionLimitForm => (
  actionCode === ZALO_FIND_PHONE_ACTION_CODE
    ? {
      ...fallback,
      dailyLimit: ZALO_FIND_PHONE_DEFAULT_LIMIT,
      rateLimitCount: ZALO_FIND_PHONE_DEFAULT_LIMIT
    }
    : toActionLimitForm(undefined, fallback)
)

const normalizeRateLimitMinutes = (value: unknown): number => {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_MINUTES
}

const normalizeSuggestedFriendsCount = (value: unknown): number => {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return 10
  return Math.max(1, parsed)
}

const WEEKDAYS = [
  { value: '2', label: 'Thứ 2' },
  { value: '3', label: 'Thứ 3' },
  { value: '4', label: 'Thứ 4' },
  { value: '5', label: 'Thứ 5' },
  { value: '6', label: 'Thứ 6' },
  { value: '7', label: 'Thứ 7' },
  { value: '8', label: 'Chủ nhật' }
]

// Campaign action IDs that don't need detail data (no Section 6) and extra group settings (no Section 5)
const SIMPLE_CAMPAIGN_ACTIONS = new Set([
  'facebook_timeline_post',
  'facebook_newsfeed_interaction'
])

const NEWSFEED_INTERACTION_ACTION_ID = 'facebook_newsfeed_interaction'
const MESSAGE_FRIEND_ACTION_ID = 'facebook_message_friend'
const MESSAGE_UID_ACTION_ID = 'facebook_message_uid'
const PAGE_INBOX_MESSAGE_ACTION_ID = 'facebook_page_to_message'
const FIND_DATA_GROUP_ACTION_ID = 'facebook_find_data_group'
const FIND_DATA_SEARCH_ACTION_ID = 'facebook_find_data_search'
const COMMENT_SEEDING_POST_ACTION_ID = 'facebook_comment_seeding_post'
const COMMENT_SEEDING_FEED_ACTION_ID = 'facebook_comment_seeding'
const GROUP_POST_ACTION_ID = 'facebook_group_post'
const PAGE_POST_ACTION_ID = 'facebook_page_post'
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const MESSAGE_CAMPAIGN_ACTIONS = new Set([
  MESSAGE_FRIEND_ACTION_ID,
  MESSAGE_UID_ACTION_ID,
  PAGE_INBOX_MESSAGE_ACTION_ID,
  ZALO_MESSAGE_PHONE_ACTION_ID
])

// Campaign action IDs for "Đăng bài vào group" type — show "Chọn nhóm" picker in data list
const GROUP_POST_ACTIONS = new Set([
  GROUP_POST_ACTION_ID,
  FIND_DATA_GROUP_ACTION_ID
])

// Campaign action IDs that share timeline/page source-content controls.
const TIMELINE_POST_ACTIONS = new Set([
  'facebook_timeline_post',
  PAGE_POST_ACTION_ID
])

const FIND_DATA_GROUP_ACTIONS = new Set([
  FIND_DATA_GROUP_ACTION_ID
])

const FIND_DATA_SEARCH_ACTIONS = new Set([
  FIND_DATA_SEARCH_ACTION_ID
])

const COMMENT_SEEDING_FEED_ACTIONS = new Set([
  COMMENT_SEEDING_FEED_ACTION_ID
])

const COMMENT_SEEDING_POST_ACTIONS = new Set([
  COMMENT_SEEDING_POST_ACTION_ID
])

const COMMENT_SEEDING_ACTIONS = new Set([
  COMMENT_SEEDING_FEED_ACTION_ID,
  'facebook_comment_seeding_post'
])

const NEWSFEED_SETTINGS_STEP: StepDef = {
  id: 'newsfeedSettings',
  title: 'Lướt newsfeed',
  fields: [
    { key: 'newsfeedTimeMinutes', label: 'Thời gian lướt' },
    { key: 'enablePostLike', label: 'Thực hiện like' },
    { key: 'newsfeedLikeKind', label: 'Like nội dung có tính chất' },
    { key: 'newsfeedLikeLimit', label: 'Like tối đa' },
    { key: 'enableComment', label: 'Thực hiện comment' },
    { key: 'newsfeedCommentKind', label: 'Comment bài post có tính chất' },
    { key: 'newsfeedCommentContent', label: 'Nội dung comment' },
    { key: 'newsfeedCommentLimit', label: 'Comment tối đa' }
  ]
}

const POST_SORT_OPTIONS = [
  { value: 'most_relevant', label: 'Phù hợp nhất' },
  { value: 'recent_activity', label: 'Hoạt động mới đây' },
  { value: 'new_posts', label: 'Bài viết mới' }
] as const

const COMMENT_SORT_OPTIONS = [
  { value: 'most_relevant', label: 'Phù hợp nhất' },
  { value: 'all_comments', label: 'Tất cả bình luận' },
  { value: 'newest', label: 'Mới nhất' }
] as const

const SEARCH_POST_DATE_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'today', label: 'Hôm nay' },
  { value: 'this_week', label: 'Tuần này' },
  { value: 'this_month', label: 'Tháng này' }
] as const

const SEARCH_POST_AUTHOR_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'you', label: 'Bài viết của bạn' },
  { value: 'friends', label: 'Bạn bè' },
  { value: 'groups_pages', label: 'Nhóm và Trang' }
] as const

const SEARCH_POST_TAGGED_LOCATION_OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'near_me', label: 'Gần tôi' }
] as const

const DEFAULT_DAILY_STOP_TIME = '18:00'
const DEFAULT_FIND_DATA_RERUN_AFTER_HOURS = 1
const DEFAULT_FIND_DATA_GOAL_DAILY_LIMIT = 30
const DEFAULT_POST_BUMP_COUNT = 3
const DEFAULT_POST_BUMP_INITIAL_DELAY_MINUTES = 30
const DEFAULT_POST_BUMP_INTERVAL_MINUTES = 10

const FIND_DATA_GOAL_OPTIONS: Array<{
  value: FindDataGoalPriority
  label: string
  isAvailable: (state: FindDataGoalFlagState) => boolean
}> = [
  { value: 'phone', label: 'Số điện thoại', isAvailable: state => state.isFindPhone },
  { value: 'zalo_group_link', label: 'Link group Zalo', isAvailable: state => state.isFindLinkGroupZalo },
  { value: 'facebook_uid', label: 'Uid user facebook', isAvailable: state => state.isFindUid },
  { value: 'post_link', label: 'Link post', isAvailable: state => state.isFindPostLink },
  { value: 'facebook_group', label: 'Link group Facebook', isAvailable: state => state.isFindFacebookGroup }
]

const normalizeFindDataGoalDailyLimit = (value: unknown): number => {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_FIND_DATA_GOAL_DAILY_LIMIT
  return Math.max(1, parsed)
}

const getAvailableFindDataGoalOptions = (state: FindDataGoalFlagState) =>
  FIND_DATA_GOAL_OPTIONS.filter(option => option.isAvailable(state))

const normalizeFindDataGoalPriority = (
  state: FindDataGoalFlagState,
  value?: CampaignExtraSettings['findDataGoalPriority'] | ''
): FindDataGoalPriority | '' => {
  const options = getAvailableFindDataGoalOptions(state)
  if (value && options.some(option => option.value === value)) return value
  return options[0]?.value || ''
}

const MESSAGE_FULL_NAME_TOKEN = '#{FULL_NAME}'
const MESSAGE_PHONE_TOKEN = '#{PHONE}'
const DEFAULT_ZALO_ALIAS_TEMPLATE = `${MESSAGE_FULL_NAME_TOKEN} - ${MESSAGE_PHONE_TOKEN}`
const MESSAGE_DATE_OPTIONS: { value: MessageDateOption; label: string; token: string }[] = [
  { value: 'today', label: 'Hôm nay', token: 'TODAY' },
  { value: 'tomorrow', label: 'Ngày mai', token: 'TOMORROW' },
  { value: 'yesterday', label: 'Hôm qua', token: 'YESTERDAY' }
]
const MESSAGE_DATE_FORMATS: MessageDateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY']

const formatDateTimeLocal = (date: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatDateTimeLocalValue = (value?: string | null): string | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : formatDateTimeLocal(date)
}

const toIsoDateTimeValue = (value?: string | null): string | undefined => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const normalizeTimeInput = (value?: string | null): string => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return ''
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

const parseDailyTimeSlot = (value: string): string | null => {
  const raw = value.trim().toLowerCase().replace(/\s+/g, '')
  if (!raw) return null

  const match = raw.match(/^(\d{1,2})(?::(\d{1,2})|h(\d{1,2})?|h)?$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2] ?? match[3] ?? 0)
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const parseDailyTimeSlots = (value: string): { slots: string[]; invalidItems: string[] } => {
  const items = String(value || '')
    .split(/[,\r\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
  const invalidItems: string[] = []
  const slotMinutes = new Map<string, string>()

  for (const item of items) {
    const slot = parseDailyTimeSlot(item)
    if (!slot) {
      invalidItems.push(item)
      continue
    }
    const [hour, minute] = slot.split(':').map(Number)
    slotMinutes.set(String(hour * 60 + minute), slot)
  }

  const slots = Array.from(slotMinutes.values()).sort((a, b) => {
    const [aHour, aMinute] = a.split(':').map(Number)
    const [bHour, bMinute] = b.split(':').map(Number)
    return (aHour * 60 + aMinute) - (bHour * 60 + bMinute)
  })

  return { slots, invalidItems }
}

const normalizeDailyTimeSlotsText = (value?: string | null): string =>
  parseDailyTimeSlots(String(value || '')).slots.join(', ')

const getDateTimeLocalDate = (value?: string | null): string => String(value || '').split('T')[0] || ''

const getDateTimeLocalTime = (value?: string | null): string => normalizeTimeInput(String(value || '').split('T')[1])

const setDateTimeLocalDate = (value: string, datePart: string): string => {
  const timePart = getDateTimeLocalTime(value) || getDateTimeLocalTime(formatDateTimeLocal(new Date()))
  return `${datePart}T${timePart}`
}

const setDateTimeLocalTime = (value: string, slot: string): string => {
  const datePart = getDateTimeLocalDate(value)
  if (!datePart) return value
  return `${datePart}T${slot}`
}

const clampPostBumpCount = (value: unknown): number => {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_POST_BUMP_COUNT
  return Math.min(10, Math.max(1, parsed))
}

const normalizeMinuteValue = (value: unknown, fallback: number, min = 0): number => {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, parsed)
}

const normalizeHourValue = (value: unknown, fallback = DEFAULT_FIND_DATA_RERUN_AFTER_HOURS, min = 1): number => {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, parsed)
}

const getSourceLinkEntries = (value: string): string[] =>
  value.split(/[,\r\n]+/).map(item => item.trim()).filter(Boolean)

const isDataImagePath = (path: string): boolean => path.trim().startsWith('data:')

const getImageDisplayName = (path: string): string => path.split(/[\\/]/).pop() || path

const OLD_VN_MOBILE_PREFIX_MAP: Record<string, string> = {
  '0162': '032',
  '0163': '033',
  '0164': '034',
  '0165': '035',
  '0166': '036',
  '0167': '037',
  '0168': '038',
  '0169': '039',
  '0120': '070',
  '0121': '079',
  '0122': '077',
  '0126': '076',
  '0128': '078',
  '0123': '083',
  '0124': '084',
  '0125': '085',
  '0127': '081',
  '0129': '082',
  '0186': '056',
  '0188': '058',
  '0199': '059'
}

const getExcelCellText = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value).toString() : ''
  }
  const text = String(value).trim()
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? Math.trunc(parsed).toString() : text
  }
  return text
}

const normalizeVietnamMobilePhone = (value: unknown): string | null => {
  let digits = getExcelCellText(value).replace(/\D+/g, '')
  if (!digits) return null

  if (digits.startsWith('0084') && digits.length >= 13) {
    digits = `0${digits.slice(4)}`
  } else if (digits.startsWith('84') && digits.length >= 11) {
    digits = `0${digits.slice(2)}`
  }
  if (digits.length === 9 && /^[35789]/.test(digits)) {
    digits = `0${digits}`
  }
  if (digits.length === 11) {
    const mappedPrefix = OLD_VN_MOBILE_PREFIX_MAP[digits.slice(0, 4)]
    if (mappedPrefix) digits = `${mappedPrefix}${digits.slice(4)}`
  }

  return /^0[35789]\d{8}$/.test(digits) ? digits : null
}

const formatPickerDateTime = (value?: string | null): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN')
}

const getCampaignScheduleLabel = (campaign: Pick<Campaign, 'schedule' | 'scheduleType' | 'scheduleDays' | 'scheduleWeekDays'>): string => {
  const startLabel = formatPickerDateTime(campaign.schedule)
  if (!startLabel) return ''

  if (campaign.scheduleType === 'weekly') {
    const dayLabels = (campaign.scheduleWeekDays || '')
      .split(',')
      .map(value => WEEKDAYS.find(day => day.value === value.trim())?.label)
      .filter((label): label is string => !!label)
    return dayLabels.length > 0
      ? `Theo tuần - ${startLabel} - ${dayLabels.join(', ')}`
      : `Theo tuần - ${startLabel}`
  }

  if (campaign.scheduleType === 'monthly') {
    const dayNumbers = (campaign.scheduleDays || '')
      .split(',')
      .map(day => day.trim())
      .filter(Boolean)
    return dayNumbers.length > 0
      ? `Theo tháng - ${startLabel} - Ngày ${dayNumbers.join(', ')}`
      : `Theo tháng - ${startLabel}`
  }

  return `Hàng ngày - ${startLabel}`
}

const isEditableFindDataSourceCampaign = (campaign: Campaign): boolean =>
  campaign.status === 'chờ xử lý' || campaign.status === 'tạm dừng'

const getFindDataTargetCampaignField = (actionId: string): FindDataTargetCampaignField | null => {
  if (actionId === MESSAGE_UID_ACTION_ID) return 'findUidTargetCampaignIds'
  if (actionId === COMMENT_SEEDING_POST_ACTION_ID) return 'findPostLinkTargetCampaignIds'
  if (actionId === GROUP_POST_ACTION_ID) return 'findFacebookGroupPostTargetCampaignIds'
  if (actionId === COMMENT_SEEDING_FEED_ACTION_ID) return 'findFacebookGroupCommentTargetCampaignIds'
  return null
}

const getCampaignIdList = (rawIds: unknown): number[] => Array.from(new Set(
  (Array.isArray(rawIds) ? rawIds : [])
    .map(id => Number(id))
    .filter(id => Number.isFinite(id) && id > 0)
))

const getPickerCampaignIdList = (rawIds: unknown): number[] => Array.from(new Set(
  (Array.isArray(rawIds) ? rawIds : [])
    .map(id => Number(id))
    .filter(id => Number.isFinite(id) && id !== 0)
))

const sameNumberList = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

const getIncomingFindDataSourceCampaignIds = (
  targetCampaignId: number | null,
  targetActionId: string,
  sourceCampaigns: Campaign[]
): number[] => {
  const field = getFindDataTargetCampaignField(targetActionId)
  if (!targetCampaignId || !field) return []

  return sourceCampaigns
    .filter(source => getCampaignIdList(source.extraSettings?.[field]).includes(targetCampaignId))
    .map(source => source.id)
}

const getFindDataTypeLabels = (extra: CampaignExtraSettings | undefined): string[] => {
  const labels: string[] = []
  if (extra?.isFindUid) labels.push('UID')
  if (extra?.isFindPhone) labels.push('SĐT')
  if (extra?.isFindLinkGroupZalo) labels.push('Link group Zalo')
  if (extra?.isFindPostLink) labels.push('Link bài post')
  if (extra?.isFindFacebookGroup) labels.push('Link group Facebook')
  return labels
}

const getFindDataSourceLabels = (extra: CampaignExtraSettings | undefined): string[] => {
  const labels: string[] = []
  if (extra?.isFindInPost) labels.push('Bài post')
  if (extra?.isFindInComment) labels.push('Comment')
  if (extra?.isFindNewInteractors) labels.push('Tương tác mới')
  if (extra?.isFindInGroupMembers) labels.push('Thành viên group')
  if (extra?.isFindFacebookGroup) labels.push('Group Facebook')
  return labels
}

const buildCampaignPickerSearchText = (parts: Array<string | string[] | undefined>): string =>
  parts
    .flatMap(part => Array.isArray(part) ? part : [part])
    .filter((part): part is string => !!part)
    .join(' ')
    .toLowerCase()

const ALL_STEPS: StepDef[] = [
  {
    id: 'general',
    title: 'Cài đặt chung',
    fields: [
      { key: 'actionId', label: 'Chiến dịch' },
      { key: 'accountIds', label: 'Tài khoản' },
      { key: 'name', label: 'Tên chiến dịch' }
    ]
  },
  {
    id: 'schedule',
    title: 'Lịch chạy',
    fields: [
      { key: 'scheduleType', label: 'Loại lịch' },
      { key: 'schedule', label: 'Ngày chạy' },
      { key: 'scheduleEndDate', label: 'Ngày kết thúc' },
      { key: 'dailyStopTime', label: 'Giờ dừng' }
    ]
  },
  {
    id: 'limits',
    title: 'Giới hạn hành động',
    fields: [
      { key: 'sleepBetweenActions', label: 'Nghỉ giữa 2 lần' },
      { key: 'dailyLimit', label: 'Giới hạn trong ngày (đến 24h)' },
      { key: 'rateLimitCount', label: 'Giới hạn trong giờ' }
    ]
  },
  {
    id: 'content',
    title: 'Nội dung',
    fields: [
      { key: 'content', label: 'Nội dung chiến dịch' },
      { key: 'images', label: 'Media' }
    ]
  },
  {
    id: 'extra',
    title: 'Cài đặt thêm',
    fields: [
      { key: 'enableComment', label: 'Kiêm comment' },
      { key: 'enablePostBump', label: 'Kiêm up tin' }
    ]
  },
  {
    id: 'details',
    title: 'Danh sách data',
    fields: [
      { key: 'details', label: 'Data' }
    ]
  }
]

const ACTION_OPTIONS_STEP: StepDef = {
  id: 'actionOptions',
  title: 'Tuỳ chọn hành động',
  fields: [{ key: 'messageActions', label: 'Hành động' }]
}

const SOURCE_CONTENT_STEP: StepDef = {
  id: 'sourceContent',
  title: 'Nguồn nội dung',
  fields: [{ key: 'sourceContent', label: 'Nguồn nội dung' }]
}

const PAGE_POST_METHOD_STEP: StepDef = {
  id: 'pagePostMethod',
  title: 'Phương thức đăng',
  fields: [{ key: 'pagePostMode', label: 'Phương thức đăng' }]
}

const FIND_DATA_CONDITIONS_STEP: StepDef = {
  id: 'findDataConditions',
  title: 'Điều kiện chạy',
  fields: [
    { key: 'findDataPostConditions', label: 'Điều kiện bài viết' },
    { key: 'findDataCommentConditions', label: 'Điều kiện comment' }
  ]
}

const COMMENT_POST_SEARCH_STEP: StepDef = {
  id: 'commentPostSearch',
  title: 'Điều kiện tìm kiếm bài post',
  fields: [{ key: 'commentPostSearchConditions', label: 'Điều kiện bài viết' }]
}

const FOUND_DATA_HANDLING_STEP: StepDef = {
  id: 'foundDataHandling',
  title: 'Xử lý data tìm được',
  fields: [{ key: 'foundDataHandling', label: 'Xử lý data' }]
}

const FIND_DATA_SOURCE_STEP: StepDef = {
  id: 'findDataSources',
  title: 'Nguồn chiến dịch tìm kiếm data',
  fields: [{ key: 'findDataSources', label: 'Nguồn chiến dịch tìm kiếm data' }]
}

const GROUP_POST_COMMENT_STEP: StepDef = {
  id: 'groupComment',
  title: 'Kiêm comment',
  fields: [{ key: 'enableComment', label: 'Kiêm comment' }]
}

const GROUP_POST_BUMP_STEP: StepDef = {
  id: 'postBump',
  title: 'Kiêm up tin',
  fields: [{ key: 'enablePostBump', label: 'Kiêm up tin' }]
}

export default function CampaignFormModal({
  campaign,
  cloneFromId,
  onOpenGeneralSettings,
  draftMode = false,
  draftTempId,
  lockedActionId,
  initialDetails,
  draftPickerSourceType,
  draftRequiredTargetField,
  onSaveDraft,
  modalZIndex,
  onClose
}: CampaignFormModalProps) {
  const {
    accounts, campaignActions, campaigns, loadCampaigns,
    createCampaign, updateCampaign,
    createCampaignInputData
  } = useCampaignStore()

  const contentRef = useRef<HTMLDivElement>(null)
  const campaignContentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const txtFileInputRef = useRef<HTMLInputElement>(null)
  const [savingCampaign, setSavingCampaign] = useState(false)

  const initSchedule = () => {
    if (cloneFromId) return formatDateTimeLocal(new Date())
    const savedSchedule = formatDateTimeLocalValue(campaign?.schedule)
    if (savedSchedule) {
      return savedSchedule
    }
    return formatDateTimeLocal(new Date())
  }

  const initEndDate = () => {
    if (campaign?.scheduleEndDate) {
      const d = new Date(campaign.scheduleEndDate)
      const pad = (n: number) => n.toString().padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    // Default to 7 days from now
    const d = new Date()
    d.setDate(d.getDate() + 7)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  const savedCommentImages = (campaign?.extraSettings?.commentImages || []).slice(0, 1)
  const savedCommentImageOption: CommentImageOption =
    (campaign?.extraSettings?.commentImageOption && campaign.extraSettings.commentImageOption !== 'none' && savedCommentImages.length > 0)
      ? 'all'
      : 'none'
  const savedDailyStopTime = normalizeTimeInput(campaign?.dailyStopTime)
  const initialActionId = lockedActionId || campaign?.actionId || ''
  const initialIsFindDataSearchCampaign = FIND_DATA_SEARCH_ACTIONS.has(initialActionId)
  const initialFindDataFlags = normalizeFindDataFlagState({
    isFindPhone: campaign?.extraSettings?.isFindPhone ?? false,
    isFindLinkGroupZalo: campaign?.extraSettings?.isFindLinkGroupZalo ?? false,
    isFindUid: draftRequiredTargetField === 'findUidTargetCampaignIds' ? true : (campaign?.extraSettings?.isFindUid ?? false),
    isFindPostLink: draftRequiredTargetField === 'findPostLinkTargetCampaignIds' ? true : (campaign?.extraSettings?.isFindPostLink ?? false),
    isFindFacebookGroup: campaign?.extraSettings?.isFindFacebookGroup ?? false,
    isFindInPost: Boolean(
      draftRequiredTargetField === 'findPostLinkTargetCampaignIds' ||
      campaign?.extraSettings?.isFindPostLink ||
      campaign?.extraSettings?.isFindInPost
    ),
    isFindInComment: campaign?.extraSettings?.isFindInComment ?? false,
    isFindNewInteractors: campaign?.extraSettings?.isFindNewInteractors ?? false,
    isFindInGroupMembers: campaign?.extraSettings?.isFindInGroupMembers ?? false
  }, { isSearchCampaign: initialIsFindDataSearchCampaign })

  const [formData, setFormData] = useState({
    name: campaign?.name || '',
    actionId: initialActionId,
    accountIds: campaign?.accountId ? [campaign.accountId] : [] as number[],
    schedule: initSchedule(),
    scheduleType: (campaign?.scheduleType || 'daily') as 'daily' | 'weekly' | 'monthly',
    scheduleEndDate: initEndDate(),
    useDailyStopTime: campaign ? !!savedDailyStopTime : false,
    dailyStopTime: savedDailyStopTime || DEFAULT_DAILY_STOP_TIME,
    scheduleDays: campaign?.scheduleDays || '',
    scheduleWeekDays: campaign?.scheduleWeekDays || '',
    continueNextDay: (lockedActionId || campaign?.actionId) === NEWSFEED_INTERACTION_ACTION_ID ? false : (campaign?.continueNextDay ?? true),
    refreshData: campaign?.refreshData ?? true,
    sleepBetweenActions: campaign?.extraSettings?.actionLimits?.sleepBetweenActions ?? 30,
    multiDailyTimeSlotsEnabled: campaign?.extraSettings?.multiDailyTimeSlotsEnabled ?? false,
    multiDailyTimeSlots: normalizeDailyTimeSlotsText(campaign?.extraSettings?.multiDailyTimeSlots),
    content: campaign?.content || '',
    // Extra settings
    sharePost: campaign?.extraSettings?.sharePost ?? false,
    postWithBackground: campaign?.extraSettings?.postWithBackground ?? false,
    rewriteContentEachRun: campaign?.extraSettings?.rewriteContentEachRun ?? false,
    enableComment: campaign?.extraSettings?.enableComment ?? false,
    commentGroupMode: (campaign?.extraSettings?.commentGroupMode || 'all') as CommentGroupMode,
    commentType: (campaign?.extraSettings?.commentType || 'own') as CommentType,
    commentCount: campaign?.extraSettings?.commentCount ?? 3,
    commentContent: campaign?.extraSettings?.commentContent || '',
    rewriteCommentContentEachRun: campaign?.extraSettings?.rewriteCommentContentEachRun ?? false,
    enablePostLike: campaign?.extraSettings?.enablePostLike ?? false,
    postsPerTarget: campaign?.extraSettings?.postsPerTarget ?? campaign?.extraSettings?.commentCount ?? 3,
    newsfeedTimeMinutes: campaign?.extraSettings?.newsfeedTimeMinutes ?? 20,
    newsfeedLikeKind: campaign?.extraSettings?.newsfeedLikeKind || '',
    newsfeedLikeLimit: campaign?.extraSettings?.newsfeedLikeLimit ?? 10,
    newsfeedCommentKind: campaign?.extraSettings?.newsfeedCommentKind || '',
    newsfeedCommentLimit: campaign?.extraSettings?.newsfeedCommentLimit ?? 10,
    newsfeedCommentContent: campaign?.extraSettings?.newsfeedCommentContent || '',
    newsfeedCommentUseAI: campaign?.extraSettings?.newsfeedCommentUseAI ?? false,
    dailyLimit: campaign?.extraSettings?.actionLimits?.dailyLimit ?? 30,
    rateLimitCount: campaign?.extraSettings?.actionLimits?.rateLimitCount ?? 9,
    rateLimitMinutes: campaign?.extraSettings?.actionLimits?.rateLimitMinutes ?? DEFAULT_RATE_LIMIT_MINUTES,
    actionLimitsByCode: Object.fromEntries(
      Object.entries(campaign?.extraSettings?.actionLimits?.byActionCode || {}).map(([code, limit]) => [
        code,
        toActionLimitForm(limit, {
          dailyLimit: campaign?.extraSettings?.actionLimits?.dailyLimit ?? 30,
          rateLimitCount: campaign?.extraSettings?.actionLimits?.rateLimitCount ?? 9,
          rateLimitMinutes: campaign?.extraSettings?.actionLimits?.rateLimitMinutes ?? DEFAULT_RATE_LIMIT_MINUTES
        })
      ])
    ) as Record<string, ActionLimitForm>,
    imageOption: (campaign?.extraSettings?.imageOption || 'none') as 'none' | 'all' | 'random',
    randomImageCount: campaign?.extraSettings?.randomImageCount || 3,
    images: campaign?.images || [] as string[],
    commentImageOption: savedCommentImageOption,
    commentImages: savedCommentImages,
    splitDataAcrossAccounts: false,
    leaveGroupOnPendingApproval: campaign?.extraSettings?.leaveGroupOnPendingApproval ?? false,
    autoJoinGroupAfterPost: campaign?.extraSettings?.autoJoinGroupAfterPost ?? false,
    shuffleGroupList: campaign?.extraSettings?.shuffleGroupList ?? false,
    skipPostIfGroupRequiresApproval: campaign?.extraSettings?.skipPostIfGroupRequiresApproval ?? false,
    enablePostBump: campaign?.extraSettings?.enablePostBump ?? false,
    postBumpCount: clampPostBumpCount(campaign?.extraSettings?.postBumpCount ?? DEFAULT_POST_BUMP_COUNT),
    postBumpInitialDelayMinutes: normalizeMinuteValue(
      campaign?.extraSettings?.postBumpInitialDelayMinutes,
      DEFAULT_POST_BUMP_INITIAL_DELAY_MINUTES,
      0
    ),
    postBumpIntervalMinutes: normalizeMinuteValue(
      campaign?.extraSettings?.postBumpIntervalMinutes,
      DEFAULT_POST_BUMP_INTERVAL_MINUTES,
      1
    ),
    postBumpMode: (campaign?.extraSettings?.postBumpMode || 'create') as PostBumpMode,
    postBumpTargetCampaignIds: [...(campaign?.extraSettings?.postBumpTargetCampaignIds || [])] as number[],
    postBumpAccountIds: [...(campaign?.extraSettings?.postBumpAccountIds || [])] as number[],
    postBumpContent: campaign?.extraSettings?.postBumpContent || '',
    postBumpCreatedCampaignIdsByAccount: cloneFromId
      ? {} as Record<string, number>
      : { ...(campaign?.extraSettings?.postBumpCreatedCampaignIdsByAccount || {}) } as Record<string, number>,
    postBumpRotationIndex: cloneFromId ? 0 : (campaign?.extraSettings?.postBumpRotationIndex ?? 0),
    // Nhắn tin bạn bè / UID
    enableMessage: campaign?.extraSettings?.enableMessage ?? true,
    enableAddFriend: campaign?.extraSettings?.enableAddFriend ?? false,
    useSuggestedFriends: campaign?.extraSettings?.useSuggestedFriends ?? false,
    suggestedFriendsCount: campaign?.extraSettings?.suggestedFriendsCount ?? 10,
    friendRequestMessage: campaign?.extraSettings?.friendRequestMessage || '',
    enableZaloTag: campaign?.extraSettings?.enableZaloTag ?? false,
    zaloTagId: campaign?.extraSettings?.zaloTagId ?? '',
    zaloTagName: campaign?.extraSettings?.zaloTagName || '',
    enableZaloAlias: campaign?.extraSettings?.enableZaloAlias ?? false,
    zaloAliasTemplate: campaign?.extraSettings?.zaloAliasTemplate || DEFAULT_ZALO_ALIAS_TEMPLATE,
    pageInboxPageUid: campaign?.extraSettings?.pageInboxPageUid || '',
    pageInboxPageName: campaign?.extraSettings?.pageInboxPageName || '',
    // Nguồn đăng bài (timeline post)
    copyContentFromSource: campaign?.extraSettings?.copyContentFromSource ?? false,
    includeSourceImages: campaign?.extraSettings?.includeSourceImages ?? false,
    rewriteSourceContentWithAI: campaign?.extraSettings?.rewriteSourceContentWithAI ?? false,
    sourceContentAiPrompt: campaign?.extraSettings?.sourceContentAiPrompt || '',
    postAsReels: campaign?.extraSettings?.postAsReels ?? false,
    sourceLinks: campaign?.extraSettings?.sourceLinks || '',
    pagePostMode: (campaign?.extraSettings?.pagePostMode || 'api') as 'api' | 'ui',
    // Tìm kiếm data trong group
    ...initialFindDataFlags,
    sortTypePost: (campaign?.extraSettings?.sortTypePost || 'most_relevant') as CampaignExtraSettings['sortTypePost'],
    countPostFindData: campaign?.extraSettings?.countPostFindData ?? 10,
    sortTypeComment: (campaign?.extraSettings?.sortTypeComment || 'most_relevant') as CampaignExtraSettings['sortTypeComment'],
    countCommentFindData: campaign?.extraSettings?.countCommentFindData ?? 30,
    countGroupMemberFindData: campaign?.extraSettings?.countGroupMemberFindData ?? 100,
    findDataGoalModeEnabled: campaign?.extraSettings?.findDataGoalModeEnabled ?? false,
    findDataGoalPriority: (campaign?.extraSettings?.findDataGoalPriority || '') as FindDataGoalPriority | '',
    findDataGoalDailyLimit: normalizeFindDataGoalDailyLimit(campaign?.extraSettings?.findDataGoalDailyLimit),
    countSearchPostFindData: campaign?.extraSettings?.countSearchPostFindData ?? campaign?.extraSettings?.countPostFindData ?? 10,
    countSearchGroupFindData: campaign?.extraSettings?.countSearchGroupFindData ?? 20,
    searchPostRecentOnly: campaign?.extraSettings?.searchPostRecentOnly ?? false,
    searchPostSeenOnly: campaign?.extraSettings?.searchPostSeenOnly ?? false,
    searchPostDateFilter: (campaign?.extraSettings?.searchPostDateFilter || 'all') as NonNullable<CampaignExtraSettings['searchPostDateFilter']>,
    searchPostAuthorFilter: (campaign?.extraSettings?.searchPostAuthorFilter || 'all') as NonNullable<CampaignExtraSettings['searchPostAuthorFilter']>,
    searchPostTaggedLocation: (campaign?.extraSettings?.searchPostTaggedLocation || 'all') as NonNullable<CampaignExtraSettings['searchPostTaggedLocation']>,
    searchGroupCity: campaign?.extraSettings?.searchGroupCity || '',
    searchGroupNearMe: campaign?.extraSettings?.searchGroupNearMe ?? false,
    searchGroupPublicOnly: campaign?.extraSettings?.searchGroupPublicOnly ?? false,
    searchGroupMineOnly: campaign?.extraSettings?.searchGroupMineOnly ?? false,
    minSearchGroupMembers: campaign?.extraSettings?.minSearchGroupMembers ?? 0,
    minSearchGroupPostsPerDay: campaign?.extraSettings?.minSearchGroupPostsPerDay ?? 0,
    findDataRerunEnabled: campaign?.extraSettings?.findDataRerunEnabled ?? false,
    findDataRerunAfterHours: normalizeHourValue(campaign?.extraSettings?.findDataRerunAfterHours),
    isFindPostByKeywords: campaign?.extraSettings?.isFindPostByKeywords ?? false,
    postKeywords: campaign?.extraSettings?.postKeywords || '',
    isFindPostByContentAI: campaign?.extraSettings?.isFindPostByContentAI ?? false,
    postContentAI: campaign?.extraSettings?.postContentAI || '',
    isFindCommentByKeywords: campaign?.extraSettings?.isFindCommentByKeywords ?? false,
    commentKeywords: campaign?.extraSettings?.commentKeywords || '',
    isFindCommentByContentAI: campaign?.extraSettings?.isFindCommentByContentAI ?? false,
    commentContentAI: campaign?.extraSettings?.commentContentAI || '',
    findUidTargetCampaignIds: campaign?.extraSettings?.findUidTargetCampaignIds || [] as number[],
    findPostLinkTargetCampaignIds: campaign?.extraSettings?.findPostLinkTargetCampaignIds || [] as number[],
    findPhoneSmsTargetCampaignIds: campaign?.extraSettings?.findPhoneSmsTargetCampaignIds || [] as number[],
    findPhoneZaloWebTargetCampaignIds: campaign?.extraSettings?.findPhoneZaloWebTargetCampaignIds || [] as number[],
    findZaloGroupLinkWebTargetCampaignIds: campaign?.extraSettings?.findZaloGroupLinkWebTargetCampaignIds || [] as number[],
    findPhoneAkaBizDesktopTargetCampaignIds: campaign?.extraSettings?.findPhoneAkaBizDesktopTargetCampaignIds || [] as number[],
    findZaloGroupLinkAkaBizDesktopTargetCampaignIds: campaign?.extraSettings?.findZaloGroupLinkAkaBizDesktopTargetCampaignIds || [] as number[],
    findFacebookGroupPostTargetCampaignIds: campaign?.extraSettings?.findFacebookGroupPostTargetCampaignIds || [] as number[],
    findFacebookGroupCommentTargetCampaignIds: campaign?.extraSettings?.findFacebookGroupCommentTargetCampaignIds || [] as number[]
  })
  const imageInputRef = useRef<HTMLInputElement>(null)
  const commentImageInputRef = useRef<HTMLInputElement>(null)
  const [handleFoundUidData, setHandleFoundUidData] = useState(() =>
    draftRequiredTargetField === 'findUidTargetCampaignIds' || (campaign?.extraSettings?.findUidTargetCampaignIds || []).length > 0
  )
  const [handleFoundPostLinkData, setHandleFoundPostLinkData] = useState(() =>
    draftRequiredTargetField === 'findPostLinkTargetCampaignIds' || (campaign?.extraSettings?.findPostLinkTargetCampaignIds || []).length > 0
  )
  const [handleFoundPhoneSmsData, setHandleFoundPhoneSmsData] = useState(() =>
    (campaign?.extraSettings?.findPhoneSmsTargetCampaignIds || []).length > 0
  )
  const [handleFoundPhoneZaloWebData, setHandleFoundPhoneZaloWebData] = useState(() =>
    (campaign?.extraSettings?.findPhoneZaloWebTargetCampaignIds || []).length > 0
  )
  const [handleFoundZaloGroupLinkWebData, setHandleFoundZaloGroupLinkWebData] = useState(() =>
    (campaign?.extraSettings?.findZaloGroupLinkWebTargetCampaignIds || []).length > 0
  )
  const [handleFoundPhoneAkaBizDesktopData, setHandleFoundPhoneAkaBizDesktopData] = useState(() =>
    (campaign?.extraSettings?.findPhoneAkaBizDesktopTargetCampaignIds || []).length > 0
  )
  const [handleFoundZaloGroupLinkAkaBizDesktopData, setHandleFoundZaloGroupLinkAkaBizDesktopData] = useState(() =>
    (campaign?.extraSettings?.findZaloGroupLinkAkaBizDesktopTargetCampaignIds || []).length > 0
  )
  const [handleFoundFacebookGroupPostData, setHandleFoundFacebookGroupPostData] = useState(() =>
    (campaign?.extraSettings?.findFacebookGroupPostTargetCampaignIds || []).length > 0
  )
  const [handleFoundFacebookGroupCommentData, setHandleFoundFacebookGroupCommentData] = useState(() =>
    (campaign?.extraSettings?.findFacebookGroupCommentTargetCampaignIds || []).length > 0
  )
  const [selectedFindDataSourceCampaignIds, setSelectedFindDataSourceCampaignIds] = useState<number[]>([])
  const findDataSourceSelectionTouchedRef = useRef(false)
  const findDataSourceSelectionScopeRef = useRef('')
  const [campaignPickerModal, setCampaignPickerModal] = useState<CampaignPickerModalState | null>(null)
  const [campaignPickerRefreshing, setCampaignPickerRefreshing] = useState(false)
  const [contentTemplates, setContentTemplates] = useState<ContentTemplate[]>([])
  const [contentTemplatesLoading, setContentTemplatesLoading] = useState(false)
  const [contentTemplatePicker, setContentTemplatePicker] = useState<ContentTemplatePickerModalState | null>(null)
  const [contentTemplateSaveModal, setContentTemplateSaveModal] = useState<ContentTemplateSaveModalState | null>(null)
  const [contentTemplateSaving, setContentTemplateSaving] = useState(false)
  const [zaloLabels, setZaloLabels] = useState<ZaloLabelOption[]>([])
  const [zaloLabelsLoading, setZaloLabelsLoading] = useState(false)
  const [zaloLabelsSyncing, setZaloLabelsSyncing] = useState(false)
  const [zaloLabelsError, setZaloLabelsError] = useState('')
  const [internalCampaignDrafts, setInternalCampaignDrafts] = useState<InternalCampaignDraft[]>([])
  const [draftFormConfig, setDraftFormConfig] = useState<{
    tempId: number
    sourceType: InternalCampaignPickerSourceType
    actionId: string
    requiredTargetField?: FindDataTargetCampaignField | null
  } | null>(null)
  const nextDraftCampaignTempIdRef = useRef(-1)

  // Determine if this is a "simple" campaign (no details/extra sections)
  const isSimpleCampaign = SIMPLE_CAMPAIGN_ACTIONS.has(formData.actionId)
  const isMessageCampaign = MESSAGE_CAMPAIGN_ACTIONS.has(formData.actionId)
  const isMessageFriendCampaign = formData.actionId === MESSAGE_FRIEND_ACTION_ID
  const isMessageUidCampaign = formData.actionId === MESSAGE_UID_ACTION_ID
  const isZaloMessagePhoneCampaign = formData.actionId === ZALO_MESSAGE_PHONE_ACTION_ID
  const isPageInboxMessageCampaign = formData.actionId === PAGE_INBOX_MESSAGE_ACTION_ID
  const isGroupPostCampaign = GROUP_POST_ACTIONS.has(formData.actionId)
  const isFacebookGroupPostCampaign = formData.actionId === 'facebook_group_post'
  const isTimelinePostCampaign = TIMELINE_POST_ACTIONS.has(formData.actionId)
  const isPagePostCampaign = formData.actionId === PAGE_POST_ACTION_ID
  const isNewsfeedInteractionCampaign = formData.actionId === NEWSFEED_INTERACTION_ACTION_ID
  const isFindDataGroupCampaign = FIND_DATA_GROUP_ACTIONS.has(formData.actionId)
  const isFindDataSearchCampaign = FIND_DATA_SEARCH_ACTIONS.has(formData.actionId)
  const isFindDataCampaign = isFindDataGroupCampaign || isFindDataSearchCampaign
  const isCommentSeedingCampaign = COMMENT_SEEDING_ACTIONS.has(formData.actionId)
  const isCommentSeedingFeedCampaign = COMMENT_SEEDING_FEED_ACTIONS.has(formData.actionId)
  const isCommentSeedingPostCampaign = COMMENT_SEEDING_POST_ACTIONS.has(formData.actionId)
  const isEditingSavedCampaign = !!campaign?.id && !cloneFromId
  const isSuggestedFriendsUidCampaign = isMessageUidCampaign && formData.useSuggestedFriends
  const hideDetailsSection = isSuggestedFriendsUidCampaign && !isEditingSavedCampaign
  const targetFindDataField = getFindDataTargetCampaignField(formData.actionId)
  const isDraftTargetFromFindData = draftMode && (draftPickerSourceType === 'messageUidTarget' || draftPickerSourceType === 'postLinkTarget')
  const isDraftSourceForTarget = draftMode && draftPickerSourceType === 'findDataSource'
  const isDraftAutoLinkedFindUid = isDraftSourceForTarget && draftRequiredTargetField === 'findUidTargetCampaignIds'
  const isDraftAutoLinkedPostLink = isDraftSourceForTarget && draftRequiredTargetField === 'findPostLinkTargetCampaignIds'
  const hasSelectedCampaignAction = !!formData.actionId
  const canPickGroups = isGroupPostCampaign || isCommentSeedingFeedCampaign
  const canPickPages = isPagePostCampaign
  const canPickFriends = isMessageFriendCampaign
  const canPickUidData = isMessageUidCampaign && !isSuggestedFriendsUidCampaign
  const canPickPageInboxCustomers = isPageInboxMessageCampaign
  const canUploadData = !isMessageFriendCampaign && !isSuggestedFriendsUidCampaign && !isPagePostCampaign && !isPageInboxMessageCampaign
  const requiresSingleAccount = isPageInboxMessageCampaign
  const showActionOptionsSection = isMessageUidCampaign || isZaloMessagePhoneCampaign
  const showFoundDataHandlingSection = isFindDataGroupCampaign && (
    formData.isFindPhone ||
    formData.isFindLinkGroupZalo ||
    formData.isFindUid ||
    formData.isFindPostLink
  ) || isFindDataSearchCampaign && (
    formData.isFindPhone ||
    formData.isFindLinkGroupZalo ||
    formData.isFindUid ||
    formData.isFindPostLink ||
    formData.isFindFacebookGroup
  )
  const hasFindDataTargetSelection = showFoundDataHandlingSection
  const findDataGoalOptions = getAvailableFindDataGoalOptions(formData)
  const effectiveFindDataGoalPriority = normalizeFindDataGoalPriority(formData, formData.findDataGoalPriority)
  const canUseFindDataPostSource = formData.isFindPhone || formData.isFindLinkGroupZalo || formData.isFindUid || formData.isFindPostLink
  const canUseFindDataCommentSource = formData.isFindPhone || formData.isFindLinkGroupZalo || formData.isFindUid
  const canUseFindDataUidOnlySources = formData.isFindUid && isFindDataGroupCampaign
  const usesFindDataPostFeed = formData.isFindInPost || formData.isFindInComment || formData.isFindPostLink || formData.isFindNewInteractors
  const usesFindDataCommentFeed = formData.isFindInComment || formData.isFindNewInteractors
  const usesFindDataSearchGroup = isFindDataSearchCampaign && formData.isFindFacebookGroup
  const usesFindDataFeed = usesFindDataPostFeed || usesFindDataCommentFeed
  const usesFindDataPostContentConditions = formData.isFindInPost || formData.isFindInComment || formData.isFindPostLink
  const usesFindDataCommentContentConditions = formData.isFindInComment
  const effectiveFindDataPostSort = formData.isFindNewInteractors ? 'recent_activity' : formData.sortTypePost
  const effectiveFindDataCommentSort = formData.isFindNewInteractors ? 'newest' : formData.sortTypeComment
  const showFindDataConditionsSection = isFindDataCampaign && (usesFindDataFeed || formData.isFindInGroupMembers || usesFindDataSearchGroup)
  const showExtraSection = isFacebookGroupPostCampaign || isCommentSeedingCampaign
  const showFindDataSourceSection = !!targetFindDataField && !hideDetailsSection
  const hasSelectedFindDataSourceCampaign = showFindDataSourceSection && (selectedFindDataSourceCampaignIds.length > 0 || isDraftTargetFromFindData)
  const supportsSourceContent = isTimelinePostCampaign || isFacebookGroupPostCampaign
  const supportsSourceSharePost = isTimelinePostCampaign && !isPagePostCampaign
  const supportsSourceReels = isTimelinePostCampaign && !isPagePostCampaign
  const isPostBackgroundCampaign = formData.actionId === 'facebook_timeline_post' || isPagePostCampaign
  const isMultiDailyTimeSlotsCampaign = formData.actionId === 'facebook_timeline_post' || isPagePostCampaign
  const isPostBackgroundApiModeDisabled = isPagePostCampaign && formData.pagePostMode === 'api'
  const hasSourceContentSelection = supportsSourceContent && (formData.copyContentFromSource || (supportsSourceSharePost && formData.sharePost))
  const isPostBackgroundSourceDisabled = isPostBackgroundCampaign && hasSourceContentSelection
  const isPostBackgroundDisabled = isPostBackgroundApiModeDisabled || isPostBackgroundSourceDisabled
  const canUsePostBackground = isPostBackgroundCampaign && !isPostBackgroundDisabled
  const isPostBackgroundActive = canUsePostBackground && formData.postWithBackground
  const requiresSourceLinks = hasSourceContentSelection
  const hasSourceLinks = getSourceLinkEntries(formData.sourceLinks).length > 0
  const isUsingSourceContent = supportsSourceContent && formData.copyContentFromSource
  const usesSourceContentAiPrompt = isUsingSourceContent && formData.rewriteSourceContentWithAI
  const hasSourceContentAiPrompt = formData.sourceContentAiPrompt.trim().length > 0
  const requiresMainContentOrMedia =
    !isFindDataCampaign &&
    !isCommentSeedingCampaign &&
    !isNewsfeedInteractionCampaign &&
    !isUsingSourceContent &&
    (!isMessageUidCampaign || formData.enableMessage) &&
    (!isZaloMessagePhoneCampaign || formData.enableMessage)
  const hasMainContentText = formData.content.trim().length > 0
  const hasSelectedMainMedia = formData.imageOption !== 'none' && formData.images.length > 0
  const hasSelectedCommentMedia = formData.commentImageOption !== 'none' && formData.commentImages.length > 0
  const detailsColumnCount = isCommentSeedingPostCampaign || isFindDataSearchCampaign
    ? (isEditingSavedCampaign ? 1 : 2)
    : isPagePostCampaign
      ? (isEditingSavedCampaign ? 3 : 4)
      : (isEditingSavedCampaign ? 4 : 5)
  const selectedCampaignAction = campaignActions.find(action => action.id === formData.actionId)
  const selectedActionPlatform = selectedCampaignAction?.flatformType || ''
  const selectableAccounts = selectedActionPlatform
    ? accounts.filter(account => account.flatformType === selectedActionPlatform)
    : accounts
  const limitActionCodes = selectedCampaignAction?.limitCheckActionCodes || []
  const limitActionCodesKey = limitActionCodes.join(',')
  const isLimitActionVisible = (actionCode: string) => {
    if (isMessageUidCampaign) {
      if (actionCode === 'fb_message_stranger') return formData.enableMessage
      if (actionCode === 'fb_add_friend') return formData.enableAddFriend
    }
    if (isZaloMessagePhoneCampaign) {
      if (actionCode === 'zalo_find_phone_user') return true
      if (actionCode === 'zalo_message_friend') return false
      if (actionCode === 'zalo_message_stranger') return formData.enableMessage
      if (actionCode === 'zalo_add_friend') return formData.enableAddFriend
      if (actionCode === 'zalo_tag_contact' || actionCode === 'zalo_change_alias') return false
    }
    if (isFacebookGroupPostCampaign && actionCode === 'fb_comment') return formData.enableComment
    if (isCommentSeedingCampaign) {
      if (actionCode === 'fb_comment') return true
      if (actionCode === 'fb_like_post') return formData.enablePostLike
    }
    if (isNewsfeedInteractionCampaign) {
      if (actionCode === 'fb_comment') return formData.enableComment
      if (actionCode === 'fb_like_post') return formData.enablePostLike
    }
    return true
  }
  const checkedLimitActionCodes = limitActionCodes.filter(isLimitActionVisible)
  const checkedLimitActionCodesKey = checkedLimitActionCodes.join(',')
  const visibleLimitActionCodes = checkedLimitActionCodes.filter(actionCode => !isHiddenActionLimitConfig(actionCode))
  const visibleLimitActionCodesKey = visibleLimitActionCodes.join(',')
  const generalLimitActionCodes = isFacebookGroupPostCampaign
    ? visibleLimitActionCodes.filter(code => code !== 'fb_comment')
    : visibleLimitActionCodes
  const showGroupPostCommentLimit = isFacebookGroupPostCampaign && visibleLimitActionCodes.includes('fb_comment')
  const showContentSection = !isFindDataCampaign && !isNewsfeedInteractionCampaign && (!isMessageUidCampaign || formData.enableMessage)
  const visibleScheduleFields: StepDef['fields'] = [
    { key: 'scheduleType', label: 'Loại lịch' },
    { key: 'schedule', label: 'Ngày chạy' },
    ...(formData.scheduleType === 'daily' ? [] : [{ key: 'scheduleEndDate', label: 'Ngày kết thúc' }]),
    ...(formData.scheduleType === 'weekly' ? [{ key: 'scheduleWeekDays', label: 'Lịch tuần' }] : []),
    ...(formData.scheduleType === 'monthly' ? [{ key: 'scheduleDays', label: 'Lịch tháng' }] : []),
    { key: 'dailyStopTime', label: 'Giờ dừng' }
  ]
  const applyVisibleScheduleFields = (steps: StepDef[]) => steps.map(step => {
    if (step.id !== 'schedule') return step
    const hasFindDataRerun = step.fields.some(field => field.key === 'findDataRerun')
    return {
      ...step,
      fields: hasFindDataRerun
        ? [...visibleScheduleFields, { key: 'findDataRerun', label: 'Chạy lại sau mỗi' }]
        : visibleScheduleFields
    }
  })
  const STEPS = applyVisibleScheduleFields((() => {
    if (!hasSelectedCampaignAction) return ALL_STEPS.filter(s => s.id === 'general')
    if (isSimpleCampaign) {
      if (isNewsfeedInteractionCampaign) {
        const generalStep = ALL_STEPS.find(s => s.id === 'general')!
        const scheduleStep = ALL_STEPS.find(s => s.id === 'schedule')!
        const limitStep = ALL_STEPS.find(s => s.id === 'limits')!
        return [generalStep, NEWSFEED_SETTINGS_STEP, scheduleStep, limitStep]
      }
      const simpleSteps = ALL_STEPS.filter(s => s.id !== 'extra' && s.id !== 'details')
      return isTimelinePostCampaign
        ? simpleSteps.flatMap(step => step.id === 'content' ? [SOURCE_CONTENT_STEP, step] : [step])
        : simpleSteps
    }
    if (isPagePostCampaign) {
      return ALL_STEPS
        .filter(s => s.id !== 'extra')
        .flatMap(step => {
          if (step.id === 'content') return [PAGE_POST_METHOD_STEP, SOURCE_CONTENT_STEP, step]
          if (step.id === 'details') {
            return [{
              ...step,
              title: 'Danh sách fanpage',
              fields: [{ key: 'details', label: 'Fanpage' }]
            }]
          }
          return [step]
        })
    }
    if (isCommentSeedingCampaign) {
      const steps = ALL_STEPS
        .filter(s => s.id !== 'extra' || isCommentSeedingFeedCampaign || isCommentSeedingPostCampaign)
        .map(s => {
          if (s.id === 'limits' && isCommentSeedingFeedCampaign) {
            return {
              ...s,
              fields: [
                ...s.fields,
                { key: 'postsPerTarget', label: 'Số bài cần comment trên mỗi group/page/profile' }
              ]
            }
          }
          if (s.id === 'content') {
            return {
              ...s,
              title: 'Nội dung',
              fields: isCommentSeedingPostCampaign
                ? [
                  { key: 'commentContent', label: 'Nội dung comment' },
                  { key: 'commentImages', label: 'Ảnh comment' }
                ]
                : [
                  { key: 'commentContent', label: 'Nội dung comment' },
                  { key: 'commentImages', label: 'Ảnh comment' }
                ]
            }
          }
          if (s.id === 'extra') {
            return {
              ...s,
              fields: [{ key: 'enablePostLike', label: 'Like bài trước khi comment' }]
            }
          }
          if (s.id === 'details') {
            return {
              ...s,
              title: isCommentSeedingPostCampaign ? 'Danh sách bài post' : 'Danh sách group/page/profile',
              fields: [{ key: 'details', label: isCommentSeedingPostCampaign ? 'Link bài post' : 'Mục tiêu' }]
            }
          }
          return s
        })
      const withPostSearch = isCommentSeedingFeedCampaign
        ? steps.flatMap(s => s.id === 'limits' ? [s, COMMENT_POST_SEARCH_STEP] : [s])
        : steps
      return showFindDataSourceSection
        ? withPostSearch.flatMap(s => s.id === 'details' ? [FIND_DATA_SOURCE_STEP, s] : [s])
        : withPostSearch
    }
    if (isFindDataCampaign) {
      const generalStep = ALL_STEPS.find(s => s.id === 'general')!
      const baseScheduleStep = ALL_STEPS.find(s => s.id === 'schedule')!
      const scheduleStep: StepDef = {
        ...baseScheduleStep,
        fields: [
          ...baseScheduleStep.fields,
          { key: 'findDataRerun', label: 'Chạy lại sau mỗi' }
        ]
      }
      const limitStep = ALL_STEPS.find(s => s.id === 'limits')!
      const contentStep: StepDef = {
        ...ALL_STEPS.find(s => s.id === 'content')!,
        title: 'Cấu hình tìm kiếm',
        fields: [
          { key: 'findDataTargets', label: 'Tìm kiếm gì' },
          { key: 'findDataScope', label: 'Tìm kiếm từ đâu' }
        ]
      }
      const detailsStep: StepDef = {
        ...ALL_STEPS.find(s => s.id === 'details')!,
        title: isFindDataSearchCampaign ? 'Danh sách từ khóa' : 'Danh sách group',
        fields: [{ key: 'details', label: isFindDataSearchCampaign ? 'Từ khóa' : 'Group' }]
      }
      return [
        generalStep,
        contentStep,
        ...(showFoundDataHandlingSection ? [FOUND_DATA_HANDLING_STEP] : []),
        ...(showFindDataConditionsSection ? [FIND_DATA_CONDITIONS_STEP] : []),
        scheduleStep,
        limitStep,
        detailsStep
      ]
    }
    if (isMessageCampaign) {
      const steps = ALL_STEPS
        .filter(s => {
          if (s.id === 'extra') return false
          if (hideDetailsSection && s.id === 'details') return false
          if (isMessageUidCampaign && !formData.enableMessage && s.id === 'content') return false
          if (isZaloMessagePhoneCampaign && !formData.enableMessage && s.id === 'content') return false
          return true
        })
        .map(s => {
          if (s.id === 'content') {
            return {
              ...s,
              title: 'Nội dung tin nhắn',
              fields: [
                { key: 'content', label: 'Nội dung tin nhắn' },
                { key: 'images', label: 'Media' }
              ]
            }
          }
          if (s.id === 'extra') {
            return {
              ...s,
              title: 'Chọn hành động',
              fields: [{ key: 'messageActions', label: 'Hành động' }]
            }
          }
          if (s.id === 'details') {
            return {
              ...s,
              title: isMessageFriendCampaign
                ? 'Danh sách bạn bè'
                : isPageInboxMessageCampaign
                  ? 'Danh sách khách inbox Page'
                : isZaloMessagePhoneCampaign
                  ? 'Danh sách SĐT'
                  : 'Danh sách UID',
              fields: [{
                key: 'details',
                label: isMessageFriendCampaign
                  ? 'Bạn bè'
                  : isPageInboxMessageCampaign
                    ? 'Khách inbox Page'
                  : isZaloMessagePhoneCampaign
                    ? 'SĐT'
                    : 'UID'
              }]
            }
          }
          return s
        })
      const orderedSteps = isMessageUidCampaign || isZaloMessagePhoneCampaign
        ? steps.flatMap(s => s.id === 'general' ? [s, ACTION_OPTIONS_STEP] : [s])
        : steps
      return showFindDataSourceSection
        ? orderedSteps.flatMap(s => s.id === 'details' ? [FIND_DATA_SOURCE_STEP, s] : [s])
        : orderedSteps
    }
    if (isFacebookGroupPostCampaign) {
      return ALL_STEPS.flatMap(step => {
        if (step.id === 'content') return [SOURCE_CONTENT_STEP, step, GROUP_POST_COMMENT_STEP, GROUP_POST_BUMP_STEP]
        if (step.id === 'extra') {
          return [{
            ...step,
            fields: [
              { key: 'skipPostIfGroupRequiresApproval', label: 'Không đăng bài vào group bị duyệt bài' },
              { key: 'leaveGroupOnPendingApproval', label: 'Rời group chờ duyệt' },
              { key: 'autoJoinGroupAfterPost', label: 'Tự tham gia group' },
              { key: 'shuffleGroupList', label: 'Xáo trộn danh sách group' }
            ]
          }]
        }
        return [step]
      })
    }
    return ALL_STEPS.filter(s => s.id !== 'extra' || showExtraSection)
  })())
  const getSectionNumber = (stepId: string) => Math.max(1, STEPS.findIndex(s => s.id === stepId) + 1)
  const stepIdsKey = STEPS.map(s => s.id).join('|')

  const messageUidCampaignOptions = campaigns.filter(c =>
    c.actionId === MESSAGE_UID_ACTION_ID &&
    c.id !== campaign?.id &&
    !c.isDelete
  )
  const postLinkCommentCampaignOptions = campaigns.filter(c =>
    c.actionId === COMMENT_SEEDING_POST_ACTION_ID &&
    c.id !== campaign?.id &&
    !c.isDelete
  )
  const groupPostCampaignOptions = campaigns.filter(c =>
    c.actionId === GROUP_POST_ACTION_ID &&
    c.id !== campaign?.id &&
    !c.isDelete
  )
  const groupCommentCampaignOptions = campaigns.filter(c =>
    c.actionId === COMMENT_SEEDING_FEED_ACTION_ID &&
    c.id !== campaign?.id &&
    !c.isDelete
  )
  const findDataSourceCampaignOptions = campaigns.filter(c => {
    if ((!FIND_DATA_GROUP_ACTIONS.has(c.actionId) && !FIND_DATA_SEARCH_ACTIONS.has(c.actionId)) || c.isDelete || !isEditableFindDataSourceCampaign(c)) return false
    if (targetFindDataField === 'findUidTargetCampaignIds') return c.extraSettings?.isFindUid === true
    if (targetFindDataField === 'findPostLinkTargetCampaignIds') return c.extraSettings?.isFindPostLink === true
    if (targetFindDataField === 'findFacebookGroupPostTargetCampaignIds' || targetFindDataField === 'findFacebookGroupCommentTargetCampaignIds') {
      return FIND_DATA_SEARCH_ACTIONS.has(c.actionId) && c.extraSettings?.isFindFacebookGroup === true
    }
    return false
  })
  const findDataSourceCampaignOptionsKey = findDataSourceCampaignOptions
    .map(c => [
      c.id,
      (c.extraSettings?.findUidTargetCampaignIds || []).join(','),
      (c.extraSettings?.findPostLinkTargetCampaignIds || []).join(','),
      (c.extraSettings?.findFacebookGroupPostTargetCampaignIds || []).join(','),
      (c.extraSettings?.findFacebookGroupCommentTargetCampaignIds || []).join(',')
    ].join(':'))
    .join('|')
  const sourceSelectionTargetCampaignId = cloneFromId || (isEditingSavedCampaign && campaign?.id ? campaign.id : null)
  const sourceSelectionScopeKey = `${sourceSelectionTargetCampaignId || 'new'}:${formData.actionId}`
  const getAccountRateLimitMinutes = (accountId: number) =>
    normalizeRateLimitMinutes(accounts.find(account => account.id === accountId)?.rateLimitMinutes)
  const selectedRateLimitMinuteValues = Array.from(new Set(
    formData.accountIds.length > 0
      ? formData.accountIds.map(getAccountRateLimitMinutes)
      : [normalizeRateLimitMinutes(formData.rateLimitMinutes)]
  )).sort((a, b) => a - b)
  const rateLimitMinutesLabel = selectedRateLimitMinuteValues.join('/')
  const selectedAccountGroupNames = Array.from(new Set(
    formData.accountIds
      .map(accountId => accounts.find(account => account.id === accountId)?.accountGroupName)
      .filter((name): name is string => !!name)
  ))

  const normalizeInitialDetails = (rows: Partial<CampaignInputData>[] = []): Partial<CampaignInputData>[] => rows.map(row => ({
    name: row.name || '',
    phone: row.phone || '',
    uid: row.uid || '',
    email: row.email || '',
    note: '',
    status: 'chờ xử lý'
  }))
  const [details, setDetails] = useState<Partial<CampaignInputData>[]>(() => normalizeInitialDetails(initialDetails))
  const [deletedIds, setDeletedIds] = useState<number[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [akabizIntegrations, setAkaBizIntegrations] = useState<AkaBizIntegrations | null>(null)
  const [akabizIntegrationsLoading, setAkaBizIntegrationsLoading] = useState(false)
  const [externalCampaigns, setExternalCampaigns] = useState<Record<AkaBizCampaignListKind, AkaBizCampaignListItem[]>>({
    sms: [],
    zaloPhone: [],
    zaloGroupLink: [],
    desktopZaloPhone: [],
    desktopZaloGroupLink: []
  })
  const [externalCampaignLoading, setExternalCampaignLoading] = useState<Partial<Record<AkaBizCampaignListKind, boolean>>>({})
  const [externalCampaignLoaded, setExternalCampaignLoaded] = useState<Partial<Record<AkaBizCampaignListKind, boolean>>>({})
  const [desktopIntegrationInvalid, setDesktopIntegrationInvalid] = useState(false)
  const [activeStep, setActiveStep] = useState('general')
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false)
  const [messageDateOption, setMessageDateOption] = useState<MessageDateOption>('today')
  const [messageDateFormat, setMessageDateFormat] = useState<MessageDateFormat>('DD/MM/YYYY')
  const [aiContentCounts, setAiContentCounts] = useState<Record<AiContentTarget, number>>({
    content: 3,
    commentContent: 3,
    postBumpContent: 3
  })
  const [aiContentLoading, setAiContentLoading] = useState<Record<AiContentTarget, AiContentAction | null>>({
    content: null,
    commentContent: null,
    postBumpContent: null
  })
  const accountDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setFormData(prev => {
      if (!prev.postWithBackground) return prev

      const supported = prev.actionId === 'facebook_timeline_post' || prev.actionId === PAGE_POST_ACTION_ID
      const pageApiMode = prev.actionId === PAGE_POST_ACTION_ID && prev.pagePostMode === 'api'
      if (!supported || pageApiMode) {
        return { ...prev, postWithBackground: false }
      }

      return prev
    })
  }, [
    formData.actionId,
    formData.pagePostMode,
    formData.postWithBackground
  ])

  useEffect(() => {
    setFormData(prev => {
      if (!prev.findDataGoalModeEnabled) return prev

      const nextPriority = normalizeFindDataGoalPriority(prev, prev.findDataGoalPriority)
      const nextDailyLimit = normalizeFindDataGoalDailyLimit(prev.findDataGoalDailyLimit)
      if (prev.findDataGoalPriority === nextPriority && prev.findDataGoalDailyLimit === nextDailyLimit) return prev
      return {
        ...prev,
        findDataGoalPriority: nextPriority,
        findDataGoalDailyLimit: nextDailyLimit
      }
    })
  }, [
    formData.findDataGoalModeEnabled,
    formData.findDataGoalPriority,
    formData.findDataGoalDailyLimit,
    formData.isFindPhone,
    formData.isFindLinkGroupZalo,
    formData.isFindUid,
    formData.isFindPostLink,
    formData.isFindFacebookGroup
  ])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
        setIsAccountDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!STEPS.some(step => step.id === activeStep)) {
      setActiveStep('general')
    }
  }, [activeStep, stepIdsKey])

  useEffect(() => {
    if (isZaloMessagePhoneCampaign && messageDateOption !== 'today') {
      setMessageDateOption('today')
    }
  }, [isZaloMessagePhoneCampaign, messageDateOption])

  useEffect(() => {
    if (campaigns.length === 0) {
      void loadCampaigns()
    }
  }, [campaigns.length, loadCampaigns])

  useEffect(() => {
    if (findDataSourceSelectionScopeRef.current !== sourceSelectionScopeKey) {
      findDataSourceSelectionScopeRef.current = sourceSelectionScopeKey
      findDataSourceSelectionTouchedRef.current = false
    }
  }, [sourceSelectionScopeKey])

  useEffect(() => {
    if (!requiresSingleAccount || formData.accountIds.length <= 1) return
    setFormData(prev => ({ ...prev, accountIds: prev.accountIds.slice(0, 1) }))
  }, [requiresSingleAccount, formData.accountIds.length])

  useEffect(() => {
    if (!selectedActionPlatform) return
    const allowedIds = new Set(selectableAccounts.map(account => account.id))
    setFormData(prev => {
      const nextAccountIds = prev.accountIds.filter(id => allowedIds.has(id))
      return nextAccountIds.length === prev.accountIds.length
        ? prev
        : { ...prev, accountIds: nextAccountIds }
    })
  }, [selectedActionPlatform, selectableAccounts.map(account => account.id).join(',')])

  useEffect(() => {
    if (!isZaloMessagePhoneCampaign || !formData.enableZaloTag || formData.accountIds.length === 0) {
      setZaloLabels([])
      setZaloLabelsError('')
      return
    }

    let cancelled = false
    const accountId = formData.accountIds[0]
    setZaloLabelsLoading(true)
    setZaloLabelsError('')
    window.electronAPI.listZaloLabels(accountId)
      .then(labels => {
        if (cancelled) return
        setZaloLabels(labels)
        const selectedId = String(formData.zaloTagId || '')
        if (selectedId && !labels.some(label => String(label.id) === selectedId)) {
          setFormData(prev => ({ ...prev, zaloTagId: '', zaloTagName: '' }))
        }
      })
      .catch(err => {
        if (cancelled) return
        setZaloLabels([])
        setZaloLabelsError(formatIpcErrorMessage(err, 'Không tải được danh sách tag Zalo đã lưu.'))
      })
      .finally(() => {
        if (!cancelled) setZaloLabelsLoading(false)
      })

    return () => { cancelled = true }
  }, [
    isZaloMessagePhoneCampaign,
    formData.enableZaloTag,
    formData.accountIds.join(',')
  ])

  useEffect(() => {
    if (!showFindDataSourceSection) {
      setSelectedFindDataSourceCampaignIds(prev => prev.length === 0 ? prev : [])
      return
    }

    if (findDataSourceSelectionTouchedRef.current) return

    const nextIds = getIncomingFindDataSourceCampaignIds(
      sourceSelectionTargetCampaignId,
      formData.actionId,
      findDataSourceCampaignOptions
    )
    setSelectedFindDataSourceCampaignIds(prev => sameNumberList(prev, nextIds) ? prev : nextIds)
  }, [
    formData.actionId,
    findDataSourceCampaignOptionsKey,
    showFindDataSourceSection,
    sourceSelectionTargetCampaignId
  ])

  useEffect(() => {
    if (!formData.actionId || !selectedCampaignAction) {
      return
    }
    setFormData(prev => {
      const fallback = {
        dailyLimit: prev.dailyLimit,
        rateLimitCount: prev.rateLimitCount,
        rateLimitMinutes: prev.rateLimitMinutes
      }
      const next: Record<string, ActionLimitForm> = {}
      for (const code of limitActionCodes) {
        const defaultLimit = getDefaultActionLimitForCode(code, fallback)
        next[code] = isHiddenActionLimitConfig(code)
          ? defaultLimit
          : (prev.actionLimitsByCode[code] || defaultLimit)
      }
      const prevKeys = Object.keys(prev.actionLimitsByCode).sort().join(',')
      const nextKeys = Object.keys(next).sort().join(',')
      if (
        prevKeys === nextKeys &&
        Object.keys(next).every(code => prev.actionLimitsByCode[code] === next[code])
      ) {
        return prev
      }
      return { ...prev, actionLimitsByCode: next }
    })
  }, [formData.actionId, selectedCampaignAction?.id, limitActionCodesKey, checkedLimitActionCodesKey, visibleLimitActionCodesKey])

  const { showAlert, showConfirm } = useUiStore()
  const hasSmsIntegration = !!akabizIntegrations?.sms?.staffId
  const hasZaloWebIntegration = !!akabizIntegrations?.zaloWeb?.staffId
  const hasAkaBizDesktopIntegration = !!akabizIntegrations?.akaBizDesktop?.staffId && !!akabizIntegrations?.akaBizDesktop?.dbPath && !desktopIntegrationInvalid

  const handleSyncZaloLabels = async () => {
    const accountId = formData.accountIds[0]
    if (!accountId) {
      showAlert('Vui lòng chọn tài khoản Zalo trước khi tải tag.', 'error')
      return
    }
    setZaloLabelsSyncing(true)
    setZaloLabelsError('')
    try {
      const labels = await window.electronAPI.syncZaloLabels(accountId)
      setZaloLabels(labels)
      const selectedId = String(formData.zaloTagId || '')
      if (selectedId && !labels.some(label => String(label.id) === selectedId)) {
        setFormData(prev => ({ ...prev, zaloTagId: '', zaloTagName: '' }))
      }
      showAlert(`Đã tải ${labels.length} tag Zalo.`, 'success')
    } catch (err) {
      const message = formatIpcErrorMessage(err, 'Không tải được tag Zalo.')
      setZaloLabelsError(message)
      showAlert(message, 'error')
    } finally {
      setZaloLabelsSyncing(false)
    }
  }

  const loadContentTemplates = async () => {
    if (!window.electronAPI?.listContentTemplates) return
    setContentTemplatesLoading(true)
    try {
      const rows = await window.electronAPI.listContentTemplates()
      setContentTemplates(rows)
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tải mẫu nội dung.'), 'error')
    } finally {
      setContentTemplatesLoading(false)
    }
  }

  const loadAkaBizIntegrations = async () => {
    if (!window.electronAPI?.getAkaBizIntegrations) return
    setAkaBizIntegrationsLoading(true)
    try {
      const data = await window.electronAPI.getAkaBizIntegrations()
      setAkaBizIntegrations(data)
      setDesktopIntegrationInvalid(false)
      setExternalCampaigns({ sms: [], zaloPhone: [], zaloGroupLink: [], desktopZaloPhone: [], desktopZaloGroupLink: [] })
      setExternalCampaignLoaded({})
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tải tích hợp akaBiz.'), 'error')
    } finally {
      setAkaBizIntegrationsLoading(false)
    }
  }

  const loadExternalCampaigns = async (kind: AkaBizCampaignListKind) => {
    if (!window.electronAPI?.listAkaBizExternalCampaigns) return
    setExternalCampaignLoading(prev => ({ ...prev, [kind]: true }))
    try {
      const rows = await window.electronAPI.listAkaBizExternalCampaigns(kind)
      setExternalCampaigns(prev => ({ ...prev, [kind]: rows }))
      setExternalCampaignLoaded(prev => ({ ...prev, [kind]: true }))
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tải danh sách campaign akaBiz.'), 'error')
      if (kind === 'desktopZaloPhone' || kind === 'desktopZaloGroupLink') {
        setDesktopIntegrationInvalid(true)
      }
      setExternalCampaignLoaded(prev => ({ ...prev, [kind]: true }))
    } finally {
      setExternalCampaignLoading(prev => ({ ...prev, [kind]: false }))
    }
  }

  useEffect(() => {
    void loadAkaBizIntegrations()
    const handleUpdated = () => void loadAkaBizIntegrations()
    window.addEventListener('akabiz-integrations-updated', handleUpdated)
    return () => window.removeEventListener('akabiz-integrations-updated', handleUpdated)
  }, [])

  useEffect(() => {
    void loadContentTemplates()
    const handleContentTemplatesUpdated = () => void loadContentTemplates()
    window.addEventListener('content-templates-updated', handleContentTemplatesUpdated)
    return () => window.removeEventListener('content-templates-updated', handleContentTemplatesUpdated)
  }, [])

  useEffect(() => {
    if (
      formData.isFindPhone &&
      handleFoundPhoneSmsData &&
      hasSmsIntegration &&
      !externalCampaignLoaded.sms &&
      !externalCampaignLoading.sms
    ) {
      void loadExternalCampaigns('sms')
    }
  }, [formData.isFindPhone, handleFoundPhoneSmsData, hasSmsIntegration, externalCampaignLoaded.sms, externalCampaignLoading.sms])

  useEffect(() => {
    if (
      formData.isFindPhone &&
      handleFoundPhoneZaloWebData &&
      hasZaloWebIntegration &&
      !externalCampaignLoaded.zaloPhone &&
      !externalCampaignLoading.zaloPhone
    ) {
      void loadExternalCampaigns('zaloPhone')
    }
  }, [formData.isFindPhone, handleFoundPhoneZaloWebData, hasZaloWebIntegration, externalCampaignLoaded.zaloPhone, externalCampaignLoading.zaloPhone])

  useEffect(() => {
    if (
      formData.isFindLinkGroupZalo &&
      handleFoundZaloGroupLinkWebData &&
      hasZaloWebIntegration &&
      !externalCampaignLoaded.zaloGroupLink &&
      !externalCampaignLoading.zaloGroupLink
    ) {
      void loadExternalCampaigns('zaloGroupLink')
    }
  }, [formData.isFindLinkGroupZalo, handleFoundZaloGroupLinkWebData, hasZaloWebIntegration, externalCampaignLoaded.zaloGroupLink, externalCampaignLoading.zaloGroupLink])

  useEffect(() => {
    if (
      formData.isFindPhone &&
      handleFoundPhoneAkaBizDesktopData &&
      hasAkaBizDesktopIntegration &&
      !externalCampaignLoaded.desktopZaloPhone &&
      !externalCampaignLoading.desktopZaloPhone
    ) {
      void loadExternalCampaigns('desktopZaloPhone')
    }
  }, [formData.isFindPhone, handleFoundPhoneAkaBizDesktopData, hasAkaBizDesktopIntegration, externalCampaignLoaded.desktopZaloPhone, externalCampaignLoading.desktopZaloPhone])

  useEffect(() => {
    if (
      formData.isFindLinkGroupZalo &&
      handleFoundZaloGroupLinkAkaBizDesktopData &&
      hasAkaBizDesktopIntegration &&
      !externalCampaignLoaded.desktopZaloGroupLink &&
      !externalCampaignLoading.desktopZaloGroupLink
    ) {
      void loadExternalCampaigns('desktopZaloGroupLink')
    }
  }, [formData.isFindLinkGroupZalo, handleFoundZaloGroupLinkAkaBizDesktopData, hasAkaBizDesktopIntegration, externalCampaignLoaded.desktopZaloGroupLink, externalCampaignLoading.desktopZaloGroupLink])

  useEffect(() => {
    async function fetchDetails() {
      const loadId = cloneFromId || (campaign && campaign.id ? campaign.id : null)
      if (!loadId) {
        setDetails(normalizeInitialDetails(initialDetails))
        setDeletedIds([])
        return
      }
      if (loadId && window.electronAPI) {
        setLoadingDetails(true)
        try {
          const existingDetails = await window.electronAPI.listCampaignInputData(loadId)
          if (cloneFromId) {
            // Clone: strip IDs and reset status, ALSO clear note
            setDetails(existingDetails.map(d => ({ ...d, id: undefined, status: 'chờ xử lý', note: '' })))
          } else {
            setDetails(existingDetails)
            setDeletedIds([])
          }
        } catch (err) {
          console.error(err)
        } finally {
          setLoadingDetails(false)
        }
      }
    }
    fetchDetails()
  }, [campaign, cloneFromId, initialDetails])

  // Check field completion
  const toggleWeekDay = (day: string) => {
    const days = formData.scheduleWeekDays ? formData.scheduleWeekDays.split(',').filter(Boolean) : []
    const idx = days.indexOf(day)
    if (idx >= 0) {
      days.splice(idx, 1)
    } else {
      days.push(day)
    }
    setFormData(p => ({ ...p, scheduleWeekDays: days.join(',') }))
  }

  const isFieldComplete = (key: string): boolean => {
    switch (key) {
      case 'actionId': return !!formData.actionId
      case 'accountIds': return formData.accountIds.length > 0
      case 'name': return formData.name.trim().length > 0
      case 'schedule': return !!formData.schedule
      case 'scheduleType': return !!formData.scheduleType
      case 'scheduleEndDate': return !!formData.scheduleEndDate
      case 'scheduleDays': return formData.scheduleDays.trim().length > 0
      case 'scheduleWeekDays': return formData.scheduleWeekDays.split(',').filter(Boolean).length > 0
      case 'dailyStopTime': return true
      case 'findDataRerun': return !formData.findDataRerunEnabled || formData.findDataRerunAfterHours >= 1
      case 'sleepBetweenActions': return formData.sleepBetweenActions >= 0
      case 'dailyLimit': return formData.dailyLimit >= 0
      case 'rateLimitCount': return formData.rateLimitCount >= 0
      case 'rateLimitMinutes': return formData.rateLimitMinutes >= 0
      case 'content': return !requiresMainContentOrMedia || hasMainContentText || hasSelectedMainMedia
      case 'commentContent': return formData.commentContent.trim().length > 0 || hasSelectedCommentMedia
      case 'postsPerTarget': return formData.postsPerTarget > 0
      case 'commentPostSearchConditions': return true
      case 'enablePostLike': return true
      case 'sharePost': return true  // optional, always "complete"
      case 'pagePostMode': return true
      case 'enableComment': return true  // optional
      case 'enablePostBump': return true  // optional
      case 'skipPostIfGroupRequiresApproval': return true
      case 'leaveGroupOnPendingApproval': return true
      case 'autoJoinGroupAfterPost': return true
      case 'shuffleGroupList': return true
      case 'sourceContent': return (!requiresSourceLinks || hasSourceLinks) && (!usesSourceContentAiPrompt || hasSourceContentAiPrompt)
      case 'images': return true  // optional
      case 'commentImages': return true  // optional
      case 'findDataScope': return formData.isFindInPost || formData.isFindInComment || formData.isFindNewInteractors || formData.isFindInGroupMembers || formData.isFindFacebookGroup
      case 'findDataPostConditions': return true
      case 'findDataCommentConditions': return true
      case 'findDataTargets': return formData.isFindPhone || formData.isFindLinkGroupZalo || formData.isFindUid || formData.isFindPostLink || formData.isFindFacebookGroup
      case 'foundDataHandling': return true
      case 'findDataSources': return true
      case 'messageActions': return isMessageFriendCampaign || formData.enableMessage || formData.enableAddFriend
      case 'details': return hideDetailsSection || details.length > 0 || hasSelectedFindDataSourceCampaign
      default: return false
    }
  }

  const getStepCompletion = (step: StepDef) => {
    const completed = step.fields.filter(f => isFieldComplete(f.key)).length
    return { completed, total: step.fields.length }
  }

  const updateActionLimit = (actionCode: string, key: keyof ActionLimitForm, value: number) => {
    setFormData(prev => ({
      ...prev,
      actionLimitsByCode: {
        ...prev.actionLimitsByCode,
        [actionCode]: {
          ...(prev.actionLimitsByCode[actionCode] || toActionLimitForm(undefined, {
            dailyLimit: prev.dailyLimit,
            rateLimitCount: prev.rateLimitCount,
            rateLimitMinutes: prev.rateLimitMinutes
          })),
          [key]: value
        }
      }
    }))
  }

  const scrollToSection = (stepId: string) => {
    setActiveStep(stepId)
    const el = sectionRefs.current[stepId]
    if (el && contentRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const toggleSection = (stepId: string) => {
    setCollapsedSections(prev => ({ ...prev, [stepId]: !prev[stepId] }))
  }

  const getAiContentValue = (target: AiContentTarget): string => formData[target]

  const setAiContentValue = (target: AiContentTarget, value: string) => {
    setFormData(prev => ({ ...prev, [target]: value }))
  }

  const openContentTemplatePicker = (target: AiContentTarget) => {
    setContentTemplatePicker({
      target,
      title: `Chọn mẫu cho ${CONTENT_TEMPLATE_TARGET_LABELS[target]}`,
      searchQuery: ''
    })
    if (contentTemplates.length === 0) void loadContentTemplates()
  }

  const openSaveContentTemplateModal = (target: AiContentTarget) => {
    const content = getAiContentValue(target).trim()
    if (!content) {
      showAlert('Vui lòng nhập nội dung trước khi lưu mẫu.', 'error')
      return
    }
    setContentTemplateSaveModal({ target, name: '', content })
  }

  const openContentTemplateManager = () => {
    onOpenGeneralSettings?.('templates')
  }

  const applyContentTemplate = (template: ContentTemplate) => {
    if (!contentTemplatePicker) return
    const target = contentTemplatePicker.target
    const currentContent = getAiContentValue(target).trim()
    const nextContent = template.content
    const doApply = () => {
      setAiContentValue(target, nextContent)
      setContentTemplatePicker(null)
      showAlert('Đã áp dụng mẫu nội dung.', 'success')
    }

    if (currentContent && currentContent !== nextContent.trim()) {
      showConfirm(
        'Nội dung hiện tại sẽ được thay bằng mẫu đã chọn.',
        doApply,
        { title: 'Áp dụng mẫu nội dung', confirmText: 'Thay nội dung', variant: 'primary' }
      )
      return
    }

    doApply()
  }

  const saveCurrentContentTemplate = async () => {
    if (!contentTemplateSaveModal) return
    const name = contentTemplateSaveModal.name.trim()
    const content = contentTemplateSaveModal.content.trim()
    if (!name) {
      showAlert('Vui lòng nhập tên mẫu nội dung.', 'error')
      return
    }
    if (!content) {
      showAlert('Vui lòng nhập nội dung mẫu.', 'error')
      return
    }
    if (!window.electronAPI?.createContentTemplate) {
      showAlert('Tính năng mẫu nội dung chưa sẵn sàng.', 'error')
      return
    }

    setContentTemplateSaving(true)
    try {
      await window.electronAPI.createContentTemplate({ name, content })
      setContentTemplateSaveModal(null)
      await loadContentTemplates()
      showAlert('Đã lưu mẫu nội dung.', 'success')
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể lưu mẫu nội dung.'), 'error')
    } finally {
      setContentTemplateSaving(false)
    }
  }

  const renderContentTemplateToolbar = (target: AiContentTarget) => (
    <div className="content-template-inline-toolbar">
      <button
        type="button"
        className="btn btn-ghost content-template-inline-button"
        onClick={() => openContentTemplatePicker(target)}
      >
        <FileText size={15} />
        <span>Chọn mẫu</span>
      </button>
      <button
        type="button"
        className="btn btn-ghost content-template-inline-button"
        onClick={() => openSaveContentTemplateModal(target)}
      >
        <Save size={15} />
        <span>Lưu mẫu</span>
      </button>
      <button
        type="button"
        className="btn btn-ghost content-template-inline-button"
        onClick={openContentTemplateManager}
        disabled={!onOpenGeneralSettings}
        title={onOpenGeneralSettings ? 'Quản lý mẫu nội dung' : 'Không thể mở quản lý mẫu trong form này'}
      >
        <Settings2 size={15} />
        <span>Quản lý mẫu</span>
      </button>
    </div>
  )

  const renderContentToolsRow = (target: AiContentTarget) => (
    <div className="content-editor-toolbar-row">
      {renderAiContentToolbar(target)}
      {renderContentTemplateToolbar(target)}
    </div>
  )

  const splitAiContentVariants = (content: string): string[] =>
    content.trim().split('|').map(item => item.trim()).filter(Boolean)

  const getPostBackgroundValidationError = (): string | null => {
    if (!isPostBackgroundActive) return null

    const variants = splitAiContentVariants(formData.content)
    if (variants.length === 0) return 'Vui lòng nhập nội dung để đăng bài với phông nền.'

    const tooLongIndex = variants.findIndex(variant => variant.length > 130)
    if (tooLongIndex >= 0) {
      return `Nội dung phông nền số ${tooLongIndex + 1} không được quá 130 ký tự.`
    }

    const tooManyLinesIndex = variants.findIndex(variant => variant.split(/\r?\n/).length > 3)
    if (tooManyLinesIndex >= 0) {
      return `Nội dung phông nền số ${tooManyLinesIndex + 1} chỉ được tối đa 3 dòng.`
    }

    if (formData.imageOption !== 'none' && formData.images.length > 0) {
      return 'Đăng bài với phông nền không thể gửi kèm ảnh. Vui lòng chọn Không gửi ảnh trước khi lưu.'
    }

    if (formData.copyContentFromSource || formData.sharePost || formData.postAsReels) {
      return 'Đăng bài với phông nền không hỗ trợ copy/chia sẻ nội dung từ nguồn hoặc đăng Reels.'
    }

    return null
  }

  const formatAiMultiContent = (content: string): string =>
    splitAiContentVariants(content).join(' |\n')

  const getAiErrorMessage = (err: unknown): string => {
    if (err instanceof Error && err.message) return err.message
    if (typeof err === 'string' && err.trim()) return err.trim()
    return 'Không thể gọi AI lúc này.'
  }

  const handleAiContentAction = async (target: AiContentTarget, action: AiContentAction) => {
    if (aiContentLoading[target]) return

    const currentContent = getAiContentValue(target)
    if (!currentContent.trim()) {
      showAlert('Vui lòng soạn 1 nội dung trong form nội dung.', 'error')
      return
    }

    if (splitAiContentVariants(currentContent).length > 1) {
      showAlert('Tính năng này chỉ phù hợp khi chỉ có 1 nội dung duy nhất trong form nội dung.', 'error')
      return
    }

    const countContent = Math.floor(Number(aiContentCounts[target]))
    if (action === 'multi' && (!Number.isFinite(countContent) || countContent < 2)) {
      showAlert('Số lượng nội dung khác nhau phải từ 2 nội dung trở lên.', 'error')
      return
    }

    setAiContentLoading(prev => ({ ...prev, [target]: action }))
    try {
      const nextContent = action === 'multi'
        ? await window.electronAPI.writeMultiOtherContentWithAI({ content: currentContent, countContent })
        : await window.electronAPI.rewriteContentWithAI({ content: currentContent })
      setAiContentValue(target, action === 'multi' ? formatAiMultiContent(nextContent) : nextContent)
    } catch (err) {
      showAlert(`Có lỗi xảy ra: ${getAiErrorMessage(err)}`, 'error')
    } finally {
      setAiContentLoading(prev => ({ ...prev, [target]: null }))
    }
  }

  const renderAiContentToolbar = (target: AiContentTarget) => {
    const loadingAction = aiContentLoading[target]
    const isMultiLoading = loadingAction === 'multi'
    const isRewriteLoading = loadingAction === 'rewrite'

    return (
      <div className="ai-content-toolbar">
        <label className="ai-content-count-label" htmlFor={`ai-content-count-${target}`}>
          Số nội dung khác nhau
        </label>
        <input
          id={`ai-content-count-${target}`}
          className="stepper-input ai-content-count-input"
          type="number"
          min={2}
          value={aiContentCounts[target]}
          disabled={!!loadingAction}
          onChange={e => {
            const nextValue = Math.floor(Number(e.target.value))
            setAiContentCounts(prev => ({
              ...prev,
              [target]: Number.isFinite(nextValue) ? nextValue : 0
            }))
          }}
        />
        <button
          type="button"
          className="btn btn-primary ai-content-action-button"
          onClick={() => handleAiContentAction(target, 'multi')}
          disabled={!!loadingAction}
        >
          {isMultiLoading ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
          <span>Tạo ra các nội dung khác nhau</span>
        </button>
        <button
          type="button"
          className="btn btn-primary ai-content-action-button"
          onClick={() => handleAiContentAction(target, 'rewrite')}
          disabled={!!loadingAction}
        >
          {isRewriteLoading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
          <span>Viết lại nội dung</span>
        </button>
      </div>
    )
  }

  const isUsableImagePath = (path: string): boolean => {
    const trimmed = path.trim()
    if (!trimmed) return false
    if (isDataImagePath(trimmed)) return true
    return window.electronAPI.fileExists(trimmed)
  }

  const validateSelectedImages = (label: string, option: string, images: string[]): boolean => {
    if (option === 'none' || images.length === 0) return true
    const missingImages = images.filter(path => !isUsableImagePath(path))
    if (missingImages.length === 0) return true

    const names = missingImages.slice(0, 3).map(getImageDisplayName).join(', ')
    const suffix = missingImages.length > 3 ? ` và ${missingImages.length - 3} ảnh khác` : ''
    showAlert(`${label} có file không còn tồn tại hoặc đã bị xoá: ${names}${suffix}. Vui lòng xoá file lỗi hoặc chọn lại.`, 'error')
    return false
  }

  const normalizeCampaignInputDataForSave = (rows: Partial<CampaignInputData>[]): Partial<CampaignInputData>[] => {
    return rows
      .map(row => ({
        ...row,
        name: String(row.name || '').trim(),
        phone: isZaloMessagePhoneCampaign
          ? (normalizeVietnamMobilePhone(row.phone) || '')
          : String(row.phone || '').trim(),
        uid: String(row.uid || '').trim(),
        email: String(row.email || '').trim(),
        info1: String(row.info1 || '').trim(),
        info2: String(row.info2 || '').trim(),
        info3: String(row.info3 || '').trim(),
        info4: String(row.info4 || '').trim(),
        info5: String(row.info5 || '').trim(),
        note: String(row.note || '').trim()
      }))
      .filter(row => isZaloMessagePhoneCampaign ? row.phone.length > 0 : row.uid.length > 0)
  }

  const buildCampaignSaveBundleItems = (detailRows: Partial<CampaignInputData>[] = details): CampaignSaveBundleItem[] => {
    const accountChunks: Partial<CampaignInputData>[][] = []
    const numAccounts = formData.accountIds.length
    const shouldDiscardDetailsForSave = formData.actionId === 'facebook_timeline_post' || formData.actionId === NEWSFEED_INTERACTION_ACTION_ID
    const detailSource = shouldDiscardDetailsForSave || hideDetailsSection ? [] : detailRows

    if (formData.splitDataAcrossAccounts && numAccounts > 1 && detailSource.length > 0) {
      for (let i = 0; i < numAccounts; i++) {
        accountChunks.push([])
      }
      for (let i = 0; i < detailSource.length; i++) {
        const accountIndex = i % numAccounts
        accountChunks[accountIndex].push(detailSource[i])
      }
    } else {
      for (let i = 0; i < numAccounts; i++) {
        accountChunks.push(detailSource)
      }
    }

    return formData.accountIds.map((accountId, index) => {
      const accountRateLimitMinutes = getAccountRateLimitMinutes(accountId)
      const defaultLimit = {
        dailyLimit: formData.dailyLimit,
        rateLimitCount: formData.rateLimitCount,
        rateLimitMinutes: accountRateLimitMinutes
      }
      const enabledActionCodes = checkedLimitActionCodes
      const byActionCode = Object.fromEntries(
        checkedLimitActionCodes.map(code => {
          const limit = isHiddenActionLimitConfig(code)
            ? getDefaultActionLimitForCode(code, defaultLimit)
            : (formData.actionLimitsByCode[code] || getDefaultActionLimitForCode(code, defaultLimit))
          return [
            code,
            {
              ...limit,
              rateLimitMinutes: accountRateLimitMinutes
            }
          ]
        })
      )

      const effectivePostsPerTarget = isCommentSeedingPostCampaign ? 1 : formData.postsPerTarget
      const effectiveEnableMessage = (isMessageFriendCampaign || isPageInboxMessageCampaign) ? true : formData.enableMessage
      const effectiveEnableAddFriend = (isMessageFriendCampaign || isPageInboxMessageCampaign) ? false : formData.enableAddFriend
      const effectiveUseSuggestedFriends = isMessageUidCampaign
        ? (isEditingSavedCampaign ? campaign?.extraSettings?.useSuggestedFriends === true : formData.useSuggestedFriends)
        : false
      const effectiveSuggestedFriendsCount = isMessageUidCampaign
        ? normalizeSuggestedFriendsCount(isEditingSavedCampaign
          ? (campaign?.extraSettings?.suggestedFriendsCount ?? formData.suggestedFriendsCount)
          : formData.suggestedFriendsCount)
        : 10
      const normalizedMultiDailySlots = isMultiDailyTimeSlotsCampaign && formData.multiDailyTimeSlotsEnabled
        ? parseDailyTimeSlots(formData.multiDailyTimeSlots).slots
        : []
      const scheduleInput = normalizedMultiDailySlots.length > 0
        ? setDateTimeLocalTime(formData.schedule, normalizedMultiDailySlots[0])
        : formData.schedule
      const formSchedule = toIsoDateTimeValue(scheduleInput)
      const normalizedScheduleEndDate = formData.scheduleType === 'daily'
        ? null
        : (formData.scheduleEndDate ? new Date(formData.scheduleEndDate + 'T23:59:59').toISOString() : null)
      const normalizedScheduleDays = formData.scheduleType === 'monthly' ? formData.scheduleDays.trim() : ''
      const normalizedScheduleWeekDays = formData.scheduleType === 'weekly' ? formData.scheduleWeekDays : ''
      const normalizedFindData = normalizeFindDataFlagState(formData, { isSearchCampaign: isFindDataSearchCampaign })
      const canUseFindDataPostContentConditionsForSave = normalizedFindData.isFindInPost || normalizedFindData.isFindInComment || normalizedFindData.isFindPostLink
      const canUsePostContentConditionsForSave = isCommentSeedingFeedCampaign || canUseFindDataPostContentConditionsForSave
      const canUseFindDataCommentContentConditionsForSave = normalizedFindData.isFindInComment
      const saveFindDataPostSort = normalizedFindData.isFindNewInteractors ? 'recent_activity' : formData.sortTypePost
      const saveFindDataCommentSort = normalizedFindData.isFindNewInteractors ? 'newest' : formData.sortTypeComment
      const saveFindDataGoalPriority = formData.findDataGoalModeEnabled
        ? normalizeFindDataGoalPriority(normalizedFindData, formData.findDataGoalPriority) || undefined
        : undefined

      return {
        campaignPayload: {
          name: formData.name,
          actionId: formData.actionId,
          accountId,
          ...(cloneFromId ? { status: 'tạm dừng' } : {}),
          schedule: formSchedule,
          originalSchedule: formSchedule,
          scheduleType: formData.scheduleType,
          scheduleEndDate: normalizedScheduleEndDate,
          dailyStopTime: formData.useDailyStopTime ? (formData.dailyStopTime || DEFAULT_DAILY_STOP_TIME) : null,
          scheduleDays: normalizedScheduleDays,
          scheduleWeekDays: normalizedScheduleWeekDays,
          continueNextDay: isNewsfeedInteractionCampaign ? false : formData.continueNextDay,
          refreshData: formData.refreshData,
          content: formData.content,
          extraSettings: {
            sharePost: supportsSourceSharePost && !isPostBackgroundActive ? formData.sharePost : false,
            postWithBackground: isPostBackgroundActive,
            rewriteContentEachRun: formData.rewriteContentEachRun,
            enableComment: isCommentSeedingCampaign ? true : formData.enableComment,
            commentGroupMode: formData.commentGroupMode,
            commentType: formData.commentType,
            commentCount: isCommentSeedingCampaign ? effectivePostsPerTarget : formData.commentCount,
            commentContent: formData.commentContent,
            rewriteCommentContentEachRun: formData.rewriteCommentContentEachRun,
            enablePostLike: formData.enablePostLike,
            postsPerTarget: effectivePostsPerTarget,
            newsfeedTimeMinutes: isNewsfeedInteractionCampaign ? Math.max(1, Number(formData.newsfeedTimeMinutes) || 20) : undefined,
            newsfeedLikeKind: isNewsfeedInteractionCampaign ? formData.newsfeedLikeKind.trim() : '',
            newsfeedLikeLimit: isNewsfeedInteractionCampaign ? Math.max(0, Number(formData.newsfeedLikeLimit) || 0) : 0,
            newsfeedCommentKind: isNewsfeedInteractionCampaign ? formData.newsfeedCommentKind.trim() : '',
            newsfeedCommentLimit: isNewsfeedInteractionCampaign ? Math.max(0, Number(formData.newsfeedCommentLimit) || 0) : 0,
            newsfeedCommentContent: isNewsfeedInteractionCampaign ? formData.newsfeedCommentContent : '',
            newsfeedCommentUseAI: isNewsfeedInteractionCampaign ? formData.newsfeedCommentUseAI : false,
            actionLimits: {
              sleepBetweenActions: formData.sleepBetweenActions,
              enabledActionCodes,
              dailyLimit: formData.dailyLimit,
              rateLimitCount: formData.rateLimitCount,
              rateLimitMinutes: accountRateLimitMinutes,
              byActionCode
            },
            imageOption: isPostBackgroundActive ? 'none' : formData.imageOption,
            randomImageCount: formData.randomImageCount,
            commentImageOption: formData.commentImageOption !== 'none' && formData.commentImages.length > 0 ? 'all' : 'none',
            commentImages: formData.commentImages.slice(0, 1),
            leaveGroupOnPendingApproval: formData.leaveGroupOnPendingApproval,
            autoJoinGroupAfterPost: formData.autoJoinGroupAfterPost,
            shuffleGroupList: formData.shuffleGroupList,
            skipPostIfGroupRequiresApproval: formData.skipPostIfGroupRequiresApproval,
            enablePostBump: formData.enablePostBump,
            postBumpCount: clampPostBumpCount(formData.postBumpCount),
            postBumpInitialDelayMinutes: normalizeMinuteValue(
              formData.postBumpInitialDelayMinutes,
              DEFAULT_POST_BUMP_INITIAL_DELAY_MINUTES,
              0
            ),
            postBumpIntervalMinutes: normalizeMinuteValue(
              formData.postBumpIntervalMinutes,
              DEFAULT_POST_BUMP_INTERVAL_MINUTES,
              1
            ),
            postBumpMode: formData.postBumpMode,
            postBumpTargetCampaignIds: formData.postBumpMode === 'select' ? getCampaignIdList(formData.postBumpTargetCampaignIds) : [],
            postBumpAccountIds: formData.postBumpMode === 'create' ? formData.postBumpAccountIds : [],
            postBumpContent: formData.postBumpContent,
            postBumpCreatedCampaignIdsByAccount: formData.postBumpCreatedCampaignIdsByAccount,
            postBumpRotationIndex: formData.postBumpRotationIndex,
            enableMessage: effectiveEnableMessage,
            enableAddFriend: effectiveEnableAddFriend,
            useSuggestedFriends: effectiveUseSuggestedFriends,
            suggestedFriendsCount: effectiveSuggestedFriendsCount,
            friendRequestMessage: isZaloMessagePhoneCampaign ? formData.friendRequestMessage.trim() : '',
            enableZaloTag: isZaloMessagePhoneCampaign ? formData.enableZaloTag : false,
            zaloTagId: isZaloMessagePhoneCampaign && formData.enableZaloTag ? formData.zaloTagId : null,
            zaloTagName: isZaloMessagePhoneCampaign && formData.enableZaloTag ? formData.zaloTagName : '',
            enableZaloAlias: isZaloMessagePhoneCampaign ? formData.enableZaloAlias : false,
            zaloAliasTemplate: isZaloMessagePhoneCampaign && formData.enableZaloAlias ? formData.zaloAliasTemplate.trim() : '',
            pageInboxPageUid: isPageInboxMessageCampaign ? formData.pageInboxPageUid : '',
            pageInboxPageName: isPageInboxMessageCampaign ? formData.pageInboxPageName : '',
            copyContentFromSource: isPostBackgroundActive ? false : formData.copyContentFromSource,
            includeSourceImages: isPostBackgroundActive ? false : formData.includeSourceImages,
            rewriteSourceContentWithAI: !isPostBackgroundActive && formData.copyContentFromSource ? formData.rewriteSourceContentWithAI : false,
            sourceContentAiPrompt: !isPostBackgroundActive && formData.copyContentFromSource && formData.rewriteSourceContentWithAI
              ? formData.sourceContentAiPrompt
              : '',
            postAsReels: supportsSourceReels && !isPostBackgroundActive ? formData.postAsReels : false,
            sourceLinks: formData.sourceLinks,
            sourceLinkIndex: cloneFromId ? 0 : (campaign?.extraSettings?.sourceLinkIndex ?? 0),
            pagePostMode: formData.pagePostMode,
            isFindPhone: normalizedFindData.isFindPhone,
            isFindLinkGroupZalo: normalizedFindData.isFindLinkGroupZalo,
            isFindUid: normalizedFindData.isFindUid,
            isFindPostLink: normalizedFindData.isFindPostLink,
            isFindFacebookGroup: isFindDataSearchCampaign ? normalizedFindData.isFindFacebookGroup : false,
            isFindInPost: normalizedFindData.isFindInPost,
            sortTypePost: saveFindDataPostSort,
            countPostFindData: formData.countPostFindData,
            isFindInComment: normalizedFindData.isFindInComment,
            sortTypeComment: saveFindDataCommentSort,
            countCommentFindData: formData.countCommentFindData,
            isFindNewInteractors: normalizedFindData.isFindNewInteractors,
            isFindInGroupMembers: normalizedFindData.isFindInGroupMembers,
            countGroupMemberFindData: formData.countGroupMemberFindData,
            findDataGoalModeEnabled: isFindDataCampaign ? formData.findDataGoalModeEnabled : false,
            findDataGoalPriority: isFindDataCampaign ? saveFindDataGoalPriority : undefined,
            findDataGoalDailyLimit: isFindDataCampaign
              ? normalizeFindDataGoalDailyLimit(formData.findDataGoalDailyLimit)
              : DEFAULT_FIND_DATA_GOAL_DAILY_LIMIT,
            countSearchPostFindData: isFindDataSearchCampaign ? Math.max(1, Number(formData.countSearchPostFindData) || 1) : undefined,
            countSearchGroupFindData: isFindDataSearchCampaign ? Math.max(1, Number(formData.countSearchGroupFindData) || 1) : undefined,
            searchPostRecentOnly: isFindDataSearchCampaign ? formData.searchPostRecentOnly : false,
            searchPostSeenOnly: isFindDataSearchCampaign ? formData.searchPostSeenOnly : false,
            searchPostDateFilter: isFindDataSearchCampaign ? formData.searchPostDateFilter : 'all',
            searchPostAuthorFilter: isFindDataSearchCampaign ? formData.searchPostAuthorFilter : 'all',
            searchPostTaggedLocation: isFindDataSearchCampaign ? formData.searchPostTaggedLocation : 'all',
            searchGroupCity: isFindDataSearchCampaign ? formData.searchGroupCity.trim() : '',
            searchGroupNearMe: isFindDataSearchCampaign ? formData.searchGroupNearMe : false,
            searchGroupPublicOnly: isFindDataSearchCampaign ? formData.searchGroupPublicOnly : false,
            searchGroupMineOnly: isFindDataSearchCampaign ? formData.searchGroupMineOnly : false,
            minSearchGroupMembers: isFindDataSearchCampaign ? Math.max(0, Number(formData.minSearchGroupMembers) || 0) : 0,
            minSearchGroupPostsPerDay: isFindDataSearchCampaign ? Math.max(0, Number(formData.minSearchGroupPostsPerDay) || 0) : 0,
            findDataRerunEnabled: isFindDataCampaign ? formData.findDataRerunEnabled : false,
            findDataRerunAfterHours: isFindDataCampaign
              ? normalizeHourValue(formData.findDataRerunAfterHours)
              : DEFAULT_FIND_DATA_RERUN_AFTER_HOURS,
            multiDailyTimeSlotsEnabled: isMultiDailyTimeSlotsCampaign ? formData.multiDailyTimeSlotsEnabled : false,
            multiDailyTimeSlots: isMultiDailyTimeSlotsCampaign && formData.multiDailyTimeSlotsEnabled
              ? normalizedMultiDailySlots.join(',')
              : '',
            isFindPostByKeywords: canUsePostContentConditionsForSave ? formData.isFindPostByKeywords : false,
            postKeywords: canUsePostContentConditionsForSave ? formData.postKeywords : '',
            isFindPostByContentAI: canUsePostContentConditionsForSave ? formData.isFindPostByContentAI : false,
            postContentAI: canUsePostContentConditionsForSave ? formData.postContentAI : '',
            isFindCommentByKeywords: canUseFindDataCommentContentConditionsForSave ? formData.isFindCommentByKeywords : false,
            commentKeywords: canUseFindDataCommentContentConditionsForSave ? formData.commentKeywords : '',
            isFindCommentByContentAI: canUseFindDataCommentContentConditionsForSave ? formData.isFindCommentByContentAI : false,
            commentContentAI: canUseFindDataCommentContentConditionsForSave ? formData.commentContentAI : '',
            findUidTargetCampaignIds: normalizedFindData.isFindUid && handleFoundUidData ? getCampaignIdList(formData.findUidTargetCampaignIds) : [],
            findPostLinkTargetCampaignIds: normalizedFindData.isFindPostLink && handleFoundPostLinkData ? getCampaignIdList(formData.findPostLinkTargetCampaignIds) : [],
            findPhoneSmsTargetCampaignIds: normalizedFindData.isFindPhone && handleFoundPhoneSmsData ? getCampaignIdList(formData.findPhoneSmsTargetCampaignIds) : [],
            findPhoneZaloWebTargetCampaignIds: normalizedFindData.isFindPhone && handleFoundPhoneZaloWebData ? getCampaignIdList(formData.findPhoneZaloWebTargetCampaignIds) : [],
            findZaloGroupLinkWebTargetCampaignIds: normalizedFindData.isFindLinkGroupZalo && handleFoundZaloGroupLinkWebData ? getCampaignIdList(formData.findZaloGroupLinkWebTargetCampaignIds) : [],
            findPhoneAkaBizDesktopTargetCampaignIds: normalizedFindData.isFindPhone && handleFoundPhoneAkaBizDesktopData ? getCampaignIdList(formData.findPhoneAkaBizDesktopTargetCampaignIds) : [],
            findZaloGroupLinkAkaBizDesktopTargetCampaignIds: normalizedFindData.isFindLinkGroupZalo && handleFoundZaloGroupLinkAkaBizDesktopData ? getCampaignIdList(formData.findZaloGroupLinkAkaBizDesktopTargetCampaignIds) : [],
            findFacebookGroupPostTargetCampaignIds: isFindDataSearchCampaign && normalizedFindData.isFindFacebookGroup && handleFoundFacebookGroupPostData
              ? getCampaignIdList(formData.findFacebookGroupPostTargetCampaignIds)
              : [],
            findFacebookGroupCommentTargetCampaignIds: isFindDataSearchCampaign && normalizedFindData.isFindFacebookGroup && handleFoundFacebookGroupCommentData
              ? getCampaignIdList(formData.findFacebookGroupCommentTargetCampaignIds)
              : []
          } as CampaignExtraSettings,
          images: formData.images
        },
        details: (accountChunks[index] || []).map(detail => ({ ...detail }))
      }
    })
  }

  const handleSave = async () => {
    if (savingCampaign) return
    if (!formData.name.trim() || !formData.actionId || formData.accountIds.length === 0) {
      showAlert('Vui lòng nhập Tên, Hành động và Tài khoản.', 'error')
      return
    }
    if (requiresSingleAccount && formData.accountIds.length !== 1) {
      showAlert('Chiến dịch gửi tin khách inbox Page chỉ hỗ trợ chọn 1 tài khoản.', 'error')
      return
    }
    if (selectedActionPlatform) {
      const invalidAccount = formData.accountIds
        .map(id => accounts.find(account => account.id === id))
        .find(account => account && account.flatformType !== selectedActionPlatform)
      if (invalidAccount) {
        showAlert('Tài khoản đã chọn không đúng nền tảng của chiến dịch.', 'error')
        return
      }
    }
    if (isZaloMessagePhoneCampaign) {
      if (!formData.enableMessage && !formData.enableAddFriend) {
        showAlert('Vui lòng chọn ít nhất nhắn tin hoặc kết bạn.', 'error')
        return
      }
      if (formData.friendRequestMessage.length > 150) {
        showAlert('Nội dung kết bạn không được quá 150 ký tự.', 'error')
        return
      }
      if (formData.enableZaloTag && !formData.zaloTagId) {
        showAlert('Vui lòng chọn tag Zalo cần gắn.', 'error')
        return
      }
      if (formData.enableZaloAlias && !formData.zaloAliasTemplate.trim()) {
        showAlert('Vui lòng nhập template đổi tên Zalo.', 'error')
        return
      }
    }
    if (showContentSection && !validateSelectedImages('Media', formData.imageOption, formData.images)) {
      return
    }
    if (!validateSelectedImages('Ảnh comment', formData.commentImageOption, formData.commentImages)) {
      return
    }
    if (isNewsfeedInteractionCampaign) {
      const timeMinutes = Math.floor(Number(formData.newsfeedTimeMinutes))
      const likeLimit = Math.floor(Number(formData.newsfeedLikeLimit))
      const commentLimit = Math.floor(Number(formData.newsfeedCommentLimit))
      if (!Number.isFinite(timeMinutes) || timeMinutes <= 0) {
        showAlert('Vui lòng nhập thời gian lướt newsfeed lớn hơn 0 phút.', 'error')
        return
      }
      if (!formData.enablePostLike && !formData.enableComment) {
        showAlert('Vui lòng chọn ít nhất một hành động like hoặc comment cho chiến dịch lướt newsfeed.', 'error')
        return
      }
      if (formData.enablePostLike && !formData.newsfeedLikeKind.trim()) {
        showAlert('Vui lòng nhập tính chất bài viết cần like.', 'error')
        return
      }
      if (formData.enablePostLike && (!Number.isFinite(likeLimit) || likeLimit <= 0)) {
        showAlert('Vui lòng nhập số like tối đa lớn hơn 0.', 'error')
        return
      }
      if (formData.enableComment && !formData.newsfeedCommentKind.trim()) {
        showAlert('Vui lòng nhập tính chất bài viết cần comment.', 'error')
        return
      }
      if (formData.enableComment && (!Number.isFinite(commentLimit) || commentLimit <= 0)) {
        showAlert('Vui lòng nhập số comment tối đa lớn hơn 0.', 'error')
        return
      }
      if (formData.enableComment && !formData.newsfeedCommentUseAI && !formData.newsfeedCommentContent.trim()) {
        showAlert('Vui lòng nhập nội dung comment hoặc bật AI tạo nội dung comment.', 'error')
        return
      }
    }
    if (requiresSourceLinks && !hasSourceLinks) {
      showAlert('Vui lòng nhập ít nhất một uid/link nguồn để copy hoặc chia sẻ nội dung.', 'error')
      return
    }
    if (usesSourceContentAiPrompt && !hasSourceContentAiPrompt) {
      showAlert('Vui lòng nhập lời nhắc AI để edit nội dung nguồn.', 'error')
      return
    }
    if (requiresMainContentOrMedia && !hasMainContentText && !hasSelectedMainMedia) {
      showAlert(
        isMessageCampaign
          ? `Vui lòng nhập nội dung tin nhắn hoặc chọn ít nhất một ${isZaloMessagePhoneCampaign ? 'file' : 'ảnh'}.`
          : 'Vui lòng nhập nội dung chiến dịch hoặc chọn ít nhất một ảnh.',
        'error'
      )
      return
    }
    const postBackgroundError = getPostBackgroundValidationError()
    if (postBackgroundError) {
      showAlert(postBackgroundError, 'error')
      return
    }
    if (isMultiDailyTimeSlotsCampaign && formData.multiDailyTimeSlotsEnabled) {
      const { slots, invalidItems } = parseDailyTimeSlots(formData.multiDailyTimeSlots)
      if (invalidItems.length > 0) {
        showAlert(`Khung giờ không hợp lệ: ${invalidItems.join(', ')}. Vui lòng nhập dạng hh:mm, ví dụ 09:00, 10:30.`, 'error')
        return
      }
      if (slots.length < 2) {
        showAlert('Vui lòng nhập ít nhất 2 khung giờ chạy trong ngày.', 'error')
        return
      }
    }
    const validDetails = isEditingSavedCampaign ? details : normalizeCampaignInputDataForSave(details)
    if (isFindDataCampaign) {
      if (!formData.isFindPhone && !formData.isFindLinkGroupZalo && !formData.isFindUid && !formData.isFindPostLink && !formData.isFindFacebookGroup) {
        showAlert('Vui lòng chọn ít nhất một loại data cần tìm.', 'error')
        return
      }
      const normalizedFindData = normalizeFindDataFlagState(formData, { isSearchCampaign: isFindDataSearchCampaign })
      if (!normalizedFindData.isFindInPost && !normalizedFindData.isFindInComment && !normalizedFindData.isFindNewInteractors && !normalizedFindData.isFindInGroupMembers && !normalizedFindData.isFindFacebookGroup) {
        showAlert(
          isFindDataSearchCampaign
            ? 'Vui lòng chọn ít nhất một nơi tìm: Bài post, Comment hoặc Group Facebook.'
            : 'Vui lòng chọn ít nhất một nơi tìm: Bài post, Comment, Những người tương tác mới hoặc Thành viên group mới.',
          'error'
        )
        return
      }
      const findDataRerunHours = Math.floor(Number(formData.findDataRerunAfterHours))
      if (formData.findDataRerunEnabled && (!Number.isFinite(findDataRerunHours) || findDataRerunHours < 1)) {
        showAlert('Vui lòng nhập số giờ chạy lại lớn hơn hoặc bằng 1.', 'error')
        return
      }
      if (formData.isFindUid && handleFoundUidData && formData.findUidTargetCampaignIds.length === 0 && !isDraftAutoLinkedFindUid) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch nhận UID.', 'error')
        return
      }
      if (formData.isFindPostLink && handleFoundPostLinkData && formData.findPostLinkTargetCampaignIds.length === 0 && !isDraftAutoLinkedPostLink) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch nhận link bài post.', 'error')
        return
      }
      if (isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupPostData && formData.findFacebookGroupPostTargetCampaignIds.length === 0) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch đăng bài vào group để nhận group Facebook.', 'error')
        return
      }
      if (isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupCommentData && formData.findFacebookGroupCommentTargetCampaignIds.length === 0) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch comment seeding để nhận group Facebook.', 'error')
        return
      }
      if (formData.isFindPhone && handleFoundPhoneSmsData) {
        if (!hasSmsIntegration) {
          showAlert('Vui lòng tích hợp akaBiz Sms trước khi đẩy SĐT.', 'error')
          return
        }
        if (formData.findPhoneSmsTargetCampaignIds.length === 0) {
          showAlert('Vui lòng chọn ít nhất một chiến dịch akaBiz Sms nhận SĐT.', 'error')
          return
        }
      }
      if (formData.isFindPhone && handleFoundPhoneZaloWebData) {
        if (!hasZaloWebIntegration) {
          showAlert('Vui lòng tích hợp akaBiz Zalo Web trước khi đẩy SĐT.', 'error')
          return
        }
        if (formData.findPhoneZaloWebTargetCampaignIds.length === 0) {
          showAlert('Vui lòng chọn ít nhất một chiến dịch akaBiz Zalo Web nhận SĐT.', 'error')
          return
        }
      }
      if (formData.isFindLinkGroupZalo && handleFoundZaloGroupLinkWebData) {
        if (!hasZaloWebIntegration) {
          showAlert('Vui lòng tích hợp akaBiz Zalo Web trước khi đẩy link group Zalo.', 'error')
          return
        }
        if (formData.findZaloGroupLinkWebTargetCampaignIds.length === 0) {
          showAlert('Vui lòng chọn ít nhất một chiến dịch akaBiz Zalo Web nhận link group Zalo.', 'error')
          return
        }
      }
      if (formData.isFindPhone && handleFoundPhoneAkaBizDesktopData) {
        if (!hasAkaBizDesktopIntegration) {
          showAlert('Vui lòng tích hợp akaBiz Desktop trước khi đẩy SĐT.', 'error')
          return
        }
        if (formData.findPhoneAkaBizDesktopTargetCampaignIds.length === 0) {
          showAlert('Vui lòng chọn ít nhất một chiến dịch akaBiz Desktop nhận SĐT.', 'error')
          return
        }
      }
      if (formData.isFindLinkGroupZalo && handleFoundZaloGroupLinkAkaBizDesktopData) {
        if (!hasAkaBizDesktopIntegration) {
          showAlert('Vui lòng tích hợp akaBiz Desktop trước khi đẩy link group Zalo.', 'error')
          return
        }
        if (formData.findZaloGroupLinkAkaBizDesktopTargetCampaignIds.length === 0) {
          showAlert('Vui lòng chọn ít nhất một chiến dịch akaBiz Desktop nhận link group Zalo.', 'error')
          return
        }
      }
      if (!isEditingSavedCampaign && validDetails.length === 0) {
        showAlert(isFindDataSearchCampaign ? 'Vui lòng thêm ít nhất một từ khóa vào danh sách data.' : 'Vui lòng thêm ít nhất một group vào danh sách data.', 'error')
        return
      }
    }
    if (!isEditingSavedCampaign && formData.actionId === 'facebook_group_post' && validDetails.length === 0 && !hasSelectedFindDataSourceCampaign) {
      showAlert('Vui lòng thêm ít nhất một group vào danh sách data.', 'error')
      return
    }
    if (!isEditingSavedCampaign && isPagePostCampaign && validDetails.length === 0) {
      showAlert('Vui lòng chọn ít nhất một fanpage.', 'error')
      return
    }
    if (isMessageUidCampaign && !formData.enableMessage && !formData.enableAddFriend) {
      showAlert('Vui lòng chọn ít nhất một hành động nhắn tin hoặc kết bạn.', 'error')
      return
    }
    if (!isEditingSavedCampaign && isMessageCampaign && !hideDetailsSection && validDetails.length === 0 && !hasSelectedFindDataSourceCampaign) {
      showAlert(
        isMessageUidCampaign
          ? 'Vui lòng thêm ít nhất một UID vào danh sách data.'
          : isPageInboxMessageCampaign
            ? 'Vui lòng chọn ít nhất một khách inbox Page.'
          : isZaloMessagePhoneCampaign
            ? 'Vui lòng thêm ít nhất một SĐT hợp lệ vào danh sách data.'
          : 'Vui lòng thêm ít nhất một bạn bè vào danh sách data.',
        'error'
      )
      return
    }
    if (isPageInboxMessageCampaign && !String(formData.pageInboxPageUid || '').trim()) {
      showAlert('Vui lòng chọn khách inbox Page từ form Quét data để xác định Page cần gửi tin.', 'error')
      return
    }
    if (!isEditingSavedCampaign && isSuggestedFriendsUidCampaign && normalizeSuggestedFriendsCount(formData.suggestedFriendsCount) < 1) {
      showAlert('Vui lòng nhập số lượng đề xuất lớn hơn 0.', 'error')
      return
    }
    const hasCommentImages = formData.commentImageOption !== 'none' && formData.commentImages.length > 0
    if (isCommentSeedingCampaign && !formData.commentContent.trim() && !hasCommentImages) {
      showAlert('Vui lòng nhập nội dung comment hoặc chọn ảnh comment.', 'error')
      return
    }
    if (!isEditingSavedCampaign && isCommentSeedingCampaign && validDetails.length === 0 && !hasSelectedFindDataSourceCampaign) {
      showAlert(
        isCommentSeedingPostCampaign
          ? 'Vui lòng thêm ít nhất một link bài post vào danh sách mục tiêu.'
          : 'Vui lòng thêm ít nhất một group/page/profile vào danh sách mục tiêu.',
        'error'
      )
      return
    }
    if (isFacebookGroupPostCampaign && formData.enablePostBump) {
      if (formData.postBumpMode === 'select' && formData.postBumpTargetCampaignIds.length === 0) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch comment vào bài post để up tin.', 'error')
        return
      }
      if (formData.postBumpMode === 'create') {
        if (formData.postBumpAccountIds.length === 0) {
          showAlert('Vui lòng chọn ít nhất một tài khoản để tạo chiến dịch up tin.', 'error')
          return
        }
        if (!formData.postBumpContent.trim()) {
          showAlert('Vui lòng nhập nội dung up tin.', 'error')
          return
        }
      }
    }

    if (!isEditingSavedCampaign && !hideDetailsSection) {
      setDetails(validDetails)
    }

    if (draftMode) {
      if (!onSaveDraft || !draftPickerSourceType) {
        showAlert('Không thể tạo chiến dịch tạm trong ngữ cảnh hiện tại.', 'error')
        return
      }
      onSaveDraft({
        tempId: draftTempId ?? 0,
        sourceType: draftPickerSourceType,
        actionId: formData.actionId,
        requiredTargetField: draftRequiredTargetField,
        items: buildCampaignSaveBundleItems(validDetails)
      })
      return
    }

    setSavingCampaign(true)
    try {
      const { deleteCampaignInputData, updateCampaignInputData, createCampaignInputData, createCampaign, updateCampaign } = useCampaignStore.getState()
      const shouldDiscardDetailsForSave = formData.actionId === 'facebook_timeline_post' || formData.actionId === NEWSFEED_INTERACTION_ACTION_ID
      const detailIdsToDelete = shouldDiscardDetailsForSave
        ? Array.from(new Set([
          ...deletedIds,
          ...details
            .map(item => item.id)
            .filter((id): id is number => typeof id === 'number')
        ]))
        : deletedIds

      if (!isEditingSavedCampaign || shouldDiscardDetailsForSave) {
        for (const id of detailIdsToDelete) {
          await deleteCampaignInputData(id)
        }
      }

      const saveBundleItems = buildCampaignSaveBundleItems(validDetails)
      const savedCampaignIds: number[] = []
      const savedCampaignPayloadById = new Map<number, Partial<Campaign>>()

      const persistDraftCampaign = async (
        draft: InternalCampaignDraft,
        linkTargetIds: number[] = [],
        linkTargetField?: FindDataTargetCampaignField | null
      ): Promise<number[]> => {
        const createdIds: number[] = []

        for (const draftItem of draft.items) {
          const payloadExtraSettings = {
            ...(draftItem.campaignPayload.extraSettings || {})
          } as CampaignExtraSettings
          if (linkTargetField && linkTargetIds.length > 0) {
            payloadExtraSettings[linkTargetField] = Array.from(new Set([
              ...getCampaignIdList(payloadExtraSettings[linkTargetField]),
              ...linkTargetIds
            ]))
          }

          const savedDraftCampaign = await createCampaign({
            ...draftItem.campaignPayload,
            extraSettings: payloadExtraSettings
          })
          createdIds.push(savedDraftCampaign.id)

          for (const draftDetail of draftItem.details) {
            await createCampaignInputData({
              ...draftDetail,
              id: undefined,
              campaignId: savedDraftCampaign.id
            })
          }
        }

        return createdIds
      }

      const createdDraftIdsByTempId = new Map<number, number[]>()
      const persistDraftByTempId = async (
        tempId: number,
        linkTargetIds: number[] = [],
        linkTargetField?: FindDataTargetCampaignField | null
      ): Promise<number[]> => {
        const existingIds = createdDraftIdsByTempId.get(tempId)
        if (existingIds) return existingIds

        const draft = internalCampaignDrafts.find(item => item.tempId === tempId)
        if (!draft) return []

        const createdIds = await persistDraftCampaign(draft, linkTargetIds, linkTargetField)
        createdDraftIdsByTempId.set(tempId, createdIds)
        return createdIds
      }

      const patchSavedSourceCampaignTargets = async (field: FindDataTargetCampaignField, targetIds: number[]) => {
        if (targetIds.length === 0) return

        for (const savedCampaignId of savedCampaignIds) {
          const savedPayload = savedCampaignPayloadById.get(savedCampaignId)
          const baseExtraSettings = {
            ...(savedPayload?.extraSettings || {})
          } as CampaignExtraSettings
          const nextTargetIds = Array.from(new Set([
            ...getCampaignIdList(baseExtraSettings[field]),
            ...targetIds
          ]))

          await updateCampaign(savedCampaignId, {
            extraSettings: {
              ...baseExtraSettings,
              [field]: nextTargetIds
            }
          })
          savedCampaignPayloadById.set(savedCampaignId, {
            ...savedPayload,
            extraSettings: {
              ...baseExtraSettings,
              [field]: nextTargetIds
            } as CampaignExtraSettings
          })
        }
      }

      for (let i = 0; i < saveBundleItems.length; i++) {
        const { campaignPayload, details: currentDetails } = saveBundleItems[i]
        const isFirst = (i === 0)

        let savedCampaign: Campaign

        if (campaign && campaign.id && isFirst) {
          await updateCampaign(campaign.id, campaignPayload)
          savedCampaign = campaign

          if (!isEditingSavedCampaign) {
            for (const d of currentDetails) {
              if (d.id) {
                await updateCampaignInputData(d.id, {
                  name: d.name,
                  phone: d.phone,
                  uid: d.uid,
                  email: d.email,
                  note: d.note,
                })
              } else {
                await createCampaignInputData({
                  ...d,
                  campaignId: savedCampaign.id
                })
              }
            }
          }
        } else {
          savedCampaign = await createCampaign(campaignPayload)

          for (const d of currentDetails) {
            await createCampaignInputData({
              ...d,
              id: undefined,
              campaignId: savedCampaign.id
            })
          }
        }

        savedCampaignIds.push(savedCampaign.id)
        savedCampaignPayloadById.set(savedCampaign.id, campaignPayload)
      }

      const tempUidTargetIds = formData.isFindUid && handleFoundUidData
        ? formData.findUidTargetCampaignIds.filter(id => id < 0)
        : []
      const tempPostLinkTargetIds = formData.isFindPostLink && handleFoundPostLinkData
        ? formData.findPostLinkTargetCampaignIds.filter(id => id < 0)
        : []
      const createdUidTargetIds = (await Promise.all(tempUidTargetIds.map(tempId => persistDraftByTempId(tempId)))).flat()
      const createdPostLinkTargetIds = (await Promise.all(tempPostLinkTargetIds.map(tempId => persistDraftByTempId(tempId)))).flat()

      if (isFindDataCampaign) {
        await patchSavedSourceCampaignTargets('findUidTargetCampaignIds', createdUidTargetIds)
        await patchSavedSourceCampaignTargets('findPostLinkTargetCampaignIds', createdPostLinkTargetIds)
      }

      await syncFindDataSourceCampaignLinks(savedCampaignIds)

      if (targetFindDataField) {
        const tempSourceDraftIds = selectedFindDataSourceCampaignIds.filter(id => id < 0)
        for (const tempId of tempSourceDraftIds) {
          await persistDraftByTempId(tempId, savedCampaignIds, targetFindDataField)
        }
      }

      showAlert('Lưu chiến dịch thành công!', 'success')
      // Delay closing to let user see the toast
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      console.error('Failed to save campaign:', err)
      setSavingCampaign(false)
      showAlert(formatIpcErrorMessage(err, 'Có lỗi xảy ra khi lưu chiến dịch.'), 'error')
    }
  }

  const addDetailRow = () => {
    setDetails(prev => [...prev, { name: '', phone: '', uid: '', email: '', note: '' }])
  }

  const removeDetailRow = (index: number) => {
    setDetails(prev => {
      const copy = [...prev]
      const removed = copy.splice(index, 1)[0]
      if (removed.id) {
        setDeletedIds(d => [...d, removed.id!])
      }
      return copy
    })
  }

  const removeAllDetailRows = () => {
    if (details.length === 0) return

    showConfirm(
      `Xoá hết ${details.length} dòng data trong danh sách?`,
      () => {
        const ids = details
          .map(item => item.id)
          .filter((id): id is number => typeof id === 'number')
        setDeletedIds(prev => Array.from(new Set([...prev, ...ids])))
        setDetails([])
      },
      { title: 'Xoá hết data', confirmText: 'Xoá hết', variant: 'danger' }
    )
  }

  const updateDetailRow = (index: number, field: keyof CampaignInputData, value: string) => {
    setDetails(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (isZaloMessagePhoneCampaign && !/\.(xlsx|xls)$/i.test(file.name)) {
      showAlert('Chiến dịch Zalo chỉ hỗ trợ upload file Excel .xlsx hoặc .xls.', 'error')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]

        // Convert to array of arrays, treating header row as ordinary data for a moment
        // using header: 1 to get raw 2D array
        const data = utils.sheet_to_json<any[]>(ws, { header: 1 })

        if (isZaloMessagePhoneCampaign) {
          const expectedHeaders = ['fullname', 'uid', 'mobile', 'email', 'info1', 'info2', 'info3', 'info4', 'info5']
          const headerRow = Array.isArray(data[0]) ? data[0].map(cell => getExcelCellText(cell).trim().toLowerCase()) : []
          const hasTemplateHeader = expectedHeaders.every((header, index) => headerRow[index] === header)
          if (!hasTemplateHeader) {
            showAlert('File Excel Zalo không đúng template. Vui lòng dùng header: Fullname, Uid, Mobile, Email, Info1, Info2, Info3, Info4, Info5.', 'error')
            return
          }

          const seenPhones = new Set(details.map(row => normalizeVietnamMobilePhone(row.phone)).filter((phone): phone is string => !!phone))
          const newRows: Partial<CampaignInputData>[] = []
          let invalidCount = 0
          let duplicateCount = 0

          for (let i = 1; i < data.length; i++) {
            const row = data[i]
            if (!row || row.length === 0 || row.every((cell: unknown) => !getExcelCellText(cell))) continue
            const phone = normalizeVietnamMobilePhone(row[2])
            if (!phone) {
              invalidCount += 1
              continue
            }
            if (seenPhones.has(phone)) {
              duplicateCount += 1
              continue
            }
            seenPhones.add(phone)
            newRows.push({
              name: getExcelCellText(row[0]).trim(),
              uid: getExcelCellText(row[1]).trim(),
              phone,
              email: getExcelCellText(row[3]).trim(),
              info1: getExcelCellText(row[4]).trim(),
              info2: getExcelCellText(row[5]).trim(),
              info3: getExcelCellText(row[6]).trim(),
              info4: getExcelCellText(row[7]).trim(),
              info5: getExcelCellText(row[8]).trim(),
              note: '',
              status: 'chờ xử lý'
            })
          }

          if (newRows.length === 0) {
            showAlert(`Không có SĐT hợp lệ để thêm. Đã loại ${invalidCount} dòng không hợp lệ và ${duplicateCount} dòng trùng.`, 'error')
            return
          }

          setDetails(prev => [...prev, ...newRows])
          const skippedParts = [
            invalidCount > 0 ? `${invalidCount} không hợp lệ` : '',
            duplicateCount > 0 ? `${duplicateCount} trùng` : ''
          ].filter(Boolean)
          showAlert(`Đã thêm ${newRows.length} SĐT Zalo${skippedParts.length ? `, bỏ qua ${skippedParts.join(', ')}` : ''}.`, 'success')
          return
        }

        // Find index of first data row (skip header if 'Tên', 'Uid', etc. is in A1)
        let startIndex = 0
        const firstRow = Array.isArray(data[0]) ? data[0].map(cell => String(cell || '').toLowerCase()) : []
        if (
          data.length > 0 &&
          (String(data[0][0] || '').toLowerCase().includes('tên') ||
            (isCommentSeedingPostCampaign && firstRow.some(cell => cell.includes('link') || cell.includes('url') || cell.includes('bài'))))
        ) {
          startIndex = 1
        }

        const newRows: Partial<CampaignInputData>[] = []
        for (let i = startIndex; i < data.length; i++) {
          const row = data[i]
          if (!row || row.length === 0 || row.every((c: any) => !c)) continue // skip empty rows

          // A: Tên (0), B: Uid (1), C: Sđt (2), D: Email (3)
          const cells = row.map((cell: any) => String(cell || '').trim())
          const postLink = cells.find(cell => /^https?:\/\//i.test(cell) || /facebook\.com|fb\.watch/i.test(cell)) || cells[1] || cells[0] || ''
          const searchKeyword = cells[0] || cells[1] || ''
          const name = isCommentSeedingPostCampaign || isFindDataSearchCampaign ? '' : String(row[0] || '').trim()
          const uid = isFindDataSearchCampaign ? searchKeyword : isCommentSeedingPostCampaign ? postLink : String(row[1] || '').trim()
          const phone = isCommentSeedingPostCampaign || isFindDataSearchCampaign ? '' : String(row[2] || '').trim()
          const email = isCommentSeedingPostCampaign || isFindDataSearchCampaign ? '' : String(row[3] || '').trim()

          newRows.push({
            name,
            uid,
            phone,
            email,
            note: '',
            status: 'chờ xử lý'
          })
        }

        setDetails(prev => [...prev, ...newRows])
      } catch (err) {
        console.error('Lỗi khi đọc file Excel:', err)
        showAlert('Có lỗi xảy ra khi đọc file Excel. Vui lòng kiểm tra lại định dạng file.', 'error')
      }
    }
    reader.readAsBinaryString(file)
    // Clear input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleTxtFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string
        if (!text) return

        // Mảng chứa các UID cắt bằng dấu phẩy hoặc xuống dòng
        const tokens = text.split(/[\r\n,]+/)

        const newRows: Partial<CampaignInputData>[] = []
        for (const token of tokens) {
          const uid = token.trim()
          if (!uid) continue

          newRows.push({
            name: '',
            uid: uid,
            phone: '',
            email: '',
            note: '',
            status: 'chờ xử lý'
          })
        }

        if (newRows.length > 0) {
          setDetails(prev => [...prev, ...newRows])
          showAlert(`Đã thêm ${newRows.length} ${isFindDataSearchCampaign ? 'từ khóa' : isCommentSeedingPostCampaign ? 'link bài post' : 'UID'} từ file TXT.`, 'success')
        } else {
          showAlert(
            isFindDataSearchCampaign
              ? 'File TXT trống hoặc không có từ khóa hợp lệ.'
              : isCommentSeedingPostCampaign
                ? 'File TXT trống hoặc không có link bài post hợp lệ.'
                : 'File TXT trống hoặc không có UID hợp lệ.',
            'error'
          )
        }
      } catch (err) {
        console.error('Lỗi khi đọc file TXT:', err)
        showAlert('Có lỗi xảy ra khi đọc file TXT.', 'error')
      }
    }
    reader.readAsText(file) // For text files
    if (txtFileInputRef.current) txtFileInputRef.current.value = ''
  }

  const [dataScanPicker, setDataScanPicker] = useState<{
    action: DataScanAction
    mode: 'friends' | 'users' | 'groups' | 'pages' | 'pageInboxCustomers'
    initialStatusFilter?: 'active' | 'inactive' | 'all'
    allowedActions?: DataScanAction[]
  } | null>(null)

  const getDetailDedupeKey = (row: Partial<CampaignInputData>): string => {
    return String(row.uid || row.email || row.phone || row.name || '')
      .trim()
      .replace(/\/+$/g, '')
      .toLowerCase()
  }

  const appendUniqueDetails = (rows: Partial<CampaignInputData>[]): number => {
    const seen = new Set(details.map(getDetailDedupeKey).filter(Boolean))
    const uniqueRows: Partial<CampaignInputData>[] = []
    for (const row of rows) {
      const key = getDetailDedupeKey(row)
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      uniqueRows.push(row)
    }
    if (uniqueRows.length > 0) {
      setDetails(prev => [...prev, ...uniqueRows])
    }
    return uniqueRows.length
  }

  const onFriendsSelected = (contacts: AutoAccountContact[]) => {
    const personContacts = contacts.filter(c => c.contactType === 'person')
    const newRows: Partial<CampaignInputData>[] = personContacts.map(c => ({
      name: c.name,
      uid: c.url || c.uid || '',
      phone: '',
      email: '',
      note: '',
      status: 'chờ xử lý'
    }))
    if (newRows.length === 0) {
      showAlert('Không có data hợp lệ để thêm vào chiến dịch.', 'error')
      return
    }
    const addedCount = appendUniqueDetails(newRows)
    if (addedCount === 0) {
      showAlert('Các data đã chọn đã có trong danh sách.', 'error')
      return
    }
    showAlert(`Đã thêm ${addedCount} data.`, 'success')
  }

  const onUsersSelected = (contacts: AutoAccountContact[]) => {
    const userContacts = contacts.filter(c => c.contactType === 'person')
    const newRows: Partial<CampaignInputData>[] = userContacts.map(c => ({
      name: c.name,
      uid: c.url || c.uid || '',
      phone: '',
      email: '',
      note: '',
      status: 'chờ xử lý'
    }))
    if (newRows.length === 0) {
      showAlert('Không có data hợp lệ để thêm vào chiến dịch.', 'error')
      return
    }
    const addedCount = appendUniqueDetails(newRows)
    if (addedCount === 0) {
      showAlert('Các data đã chọn đã có trong danh sách.', 'error')
      return
    }
    showAlert(`Đã thêm ${addedCount} data.`, 'success')
  }

  const onGroupsSelected = (contacts: AutoAccountContact[]) => {
    const newRows: Partial<CampaignInputData>[] = contacts.map(c => ({
      name: c.name,
      uid: c.url || (c.uid ? `https://www.facebook.com/groups/${c.uid}` : ''),
      phone: '',
      email: '',
      note: '',
      status: 'chờ xử lý'
    }))
    const addedCount = appendUniqueDetails(newRows)
    if (addedCount === 0) {
      showAlert('Các nhóm đã chọn đã có trong danh sách.', 'error')
      return
    }
    showAlert(`Đã thêm ${addedCount} nhóm.`, 'success')
  }

  const onPagesSelected = (contacts: AutoAccountContact[]) => {
    const pageContacts = contacts.filter(c => c.contactType === 'page')
    const newRows: Partial<CampaignInputData>[] = pageContacts.map(c => ({
      name: c.name,
      uid: c.uid || '',
      phone: '',
      email: c.url || '',
      note: '',
      status: 'chờ xử lý'
    }))
    if (newRows.length === 0) {
      showAlert('Không có page hợp lệ để thêm vào chiến dịch.', 'error')
      return
    }
    const addedCount = appendUniqueDetails(newRows)
    if (addedCount === 0) {
      showAlert('Các page đã chọn đã có trong danh sách.', 'error')
      return
    }
    showAlert(`Đã thêm ${addedCount} page.`, 'success')
  }

  const onPageInboxCustomersSelected = (contacts: AutoAccountContact[]) => {
    const pageInboxContacts = contacts.filter(c => c.contactType === 'page_inbox_customer')
    if (pageInboxContacts.length === 0) {
      showAlert('Không có khách inbox Page hợp lệ để thêm vào chiến dịch.', 'error')
      return
    }

    const pageKeys = new Map<string, string>()
    for (const contact of pageInboxContacts) {
      const pageUid = String(contact.extraData?.pageUid || '').trim()
      const pageName = String(contact.extraData?.pageName || '').trim()
      if (pageUid) pageKeys.set(pageUid, pageName)
    }

    if (pageKeys.size !== 1) {
      showAlert('Vui lòng chỉ chọn khách inbox của cùng một Page trong một chiến dịch.', 'error')
      return
    }

    const [[pageUid, pageName]] = Array.from(pageKeys.entries())
    const currentPageUid = String(formData.pageInboxPageUid || '').trim()
    if (details.length > 0 && currentPageUid && currentPageUid !== pageUid) {
      showAlert('Danh sách hiện tại đang thuộc Page khác. Vui lòng xoá hết data trước khi chọn khách của Page mới.', 'error')
      return
    }
    const newRows: Partial<CampaignInputData>[] = pageInboxContacts.map(c => ({
      name: c.name,
      uid: c.uid || '',
      phone: String(c.extraData?.phone || ''),
      email: '',
      note: '',
      status: 'chờ xử lý'
    }))

    setFormData(p => ({
      ...p,
      pageInboxPageUid: pageUid,
      pageInboxPageName: pageName
    }))
    const addedCount = appendUniqueDetails(newRows)
    if (addedCount === 0) {
      showAlert('Các khách inbox Page đã chọn đã có trong danh sách.', 'error')
      return
    }
    showAlert(`Đã thêm ${addedCount} khách inbox Page.`, 'success')
  }

  const syncFindDataSourceCampaignLinks = async (targetCampaignIds: number[]) => {
    if (!showFindDataSourceSection || !targetFindDataField || targetCampaignIds.length === 0) return
    if (!window.electronAPI?.updateCampaign) throw new Error('API not available')

    const targetIds = getCampaignIdList(targetCampaignIds)
    if (targetIds.length === 0) return

    const selectedSourceIds = new Set(selectedFindDataSourceCampaignIds)
    let hasUpdates = false

    for (const sourceCampaign of findDataSourceCampaignOptions) {
      const shouldReceiveTarget = selectedSourceIds.has(sourceCampaign.id)
      const currentTargetIds = getCampaignIdList(sourceCampaign.extraSettings?.[targetFindDataField])
      const nextTargetIds = new Set(currentTargetIds)
      let changed = false

      for (const targetId of targetIds) {
        if (shouldReceiveTarget && !nextTargetIds.has(targetId)) {
          nextTargetIds.add(targetId)
          changed = true
        } else if (!shouldReceiveTarget && nextTargetIds.has(targetId)) {
          nextTargetIds.delete(targetId)
          changed = true
        }
      }

      if (!changed) continue

      const nextExtraSettings: CampaignExtraSettings = {
        ...(sourceCampaign.extraSettings || {}),
        [targetFindDataField]: Array.from(nextTargetIds)
      }
      await window.electronAPI.updateCampaign(sourceCampaign.id, { extraSettings: nextExtraSettings })
      hasUpdates = true
    }

    if (hasUpdates) {
      await loadCampaigns()
    }
  }

  const togglePostBumpTargetCampaign = (campaignId: number) => {
    setFormData(prev => {
      const current = prev.postBumpTargetCampaignIds || []
      const exists = current.includes(campaignId)
      return {
        ...prev,
        postBumpTargetCampaignIds: exists
          ? current.filter(id => id !== campaignId)
          : [...current, campaignId]
      }
    })
  }

  const togglePostBumpAccount = (accountId: number) => {
    setFormData(prev => {
      const current = prev.postBumpAccountIds || []
      const exists = current.includes(accountId)
      return {
        ...prev,
        postBumpAccountIds: exists
          ? current.filter(id => id !== accountId)
          : [...current, accountId]
      }
    })
  }

  const handleImagePickerChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'post' | 'comment'
  ) => {
    const files = Array.from(e.target.files || [])
    const paths = files
      .map(f => {
        try {
          return window.electronAPI.getPathForFile(f)
        } catch {
          return ''
        }
      })
      .filter(Boolean)

    if (paths.length < files.length) {
      showAlert('Một số file không xác định được đường dẫn và đã bị bỏ qua.', 'error')
    }
    if (paths.length > 0) {
      setFormData(p => target === 'comment'
        ? ({ ...p, commentImages: paths.slice(0, 1), commentImageOption: 'all' })
        : ({ ...p, images: [...p.images, ...paths] })
      )
    }
    e.target.value = ''
  }

  const renderNewsfeedInteractionSettings = () => (
    <div className="newsfeed-settings-panel">
      <div className="newsfeed-duration-row">
        <div className="stepper-form-group newsfeed-duration-field">
          <label>Thời gian lướt (phút)</label>
          <input
            type="number"
            min={1}
            value={formData.newsfeedTimeMinutes}
            onChange={e => setFormData(p => ({ ...p, newsfeedTimeMinutes: Math.max(1, Number(e.target.value) || 1) }))}
            className="stepper-input"
          />
        </div>
      </div>

      <div className={`newsfeed-action-card ${formData.enablePostLike ? 'is-enabled' : 'is-disabled'}`}>
        <div className="newsfeed-action-header">
          <label className="newsfeed-action-toggle">
            <input
              type="checkbox"
              checked={formData.enablePostLike}
              onChange={e => setFormData(p => ({ ...p, enablePostLike: e.target.checked }))}
            />
            <span className="newsfeed-action-title">
              <Heart size={16} />
              <span>Like/tim</span>
            </span>
          </label>
          <span className="newsfeed-action-code">fb_like_post</span>
        </div>

        <div className="newsfeed-action-body">
          <div className="newsfeed-action-fields">
            <div className="stepper-form-group">
              <label>Tính chất bài viết</label>
              <input
                type="text"
                value={formData.newsfeedLikeKind}
                onChange={e => setFormData(p => ({ ...p, newsfeedLikeKind: e.target.value }))}
                className="stepper-input"
                disabled={!formData.enablePostLike}
                placeholder="Ví dụ: vui vẻ, tuyển dụng, bán hàng"
              />
            </div>
            <div className="stepper-form-group newsfeed-limit-field">
              <label>Tối đa</label>
              <input
                type="number"
                min={1}
                value={formData.newsfeedLikeLimit}
                onChange={e => setFormData(p => ({ ...p, newsfeedLikeLimit: Math.max(0, Number(e.target.value) || 0) }))}
                className="stepper-input"
                disabled={!formData.enablePostLike}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={`newsfeed-action-card ${formData.enableComment ? 'is-enabled' : 'is-disabled'}`}>
        <div className="newsfeed-action-header">
          <label className="newsfeed-action-toggle">
            <input
              type="checkbox"
              checked={formData.enableComment}
              onChange={e => setFormData(p => ({ ...p, enableComment: e.target.checked }))}
            />
            <span className="newsfeed-action-title">
              <MessageCircle size={16} />
              <span>Comment</span>
            </span>
          </label>
          <span className="newsfeed-action-code">fb_comment</span>
        </div>

        <div className="newsfeed-action-body">
          <div className="newsfeed-action-fields">
            <div className="stepper-form-group">
              <label>Tính chất bài viết</label>
              <input
                type="text"
                value={formData.newsfeedCommentKind}
                onChange={e => setFormData(p => ({ ...p, newsfeedCommentKind: e.target.value }))}
                className="stepper-input"
                disabled={!formData.enableComment}
                placeholder="Ví dụ: hỏi mua sản phẩm, cần tư vấn"
              />
            </div>
            <div className="stepper-form-group newsfeed-limit-field">
              <label>Tối đa</label>
              <input
                type="number"
                min={1}
                value={formData.newsfeedCommentLimit}
                onChange={e => setFormData(p => ({ ...p, newsfeedCommentLimit: Math.max(0, Number(e.target.value) || 0) }))}
                className="stepper-input"
                disabled={!formData.enableComment}
              />
            </div>
          </div>

          <div className="stepper-form-group">
            <label>Nội dung comment</label>
            <textarea
              value={formData.newsfeedCommentContent}
              onChange={e => setFormData(p => ({ ...p, newsfeedCommentContent: e.target.value }))}
              className="stepper-textarea newsfeed-comment-textarea"
              rows={3}
              disabled={!formData.enableComment}
              placeholder="Dùng dấu | để tách nhiều nội dung."
            />
          </div>

          <label className="newsfeed-ai-toggle">
            <input
              type="checkbox"
              checked={formData.newsfeedCommentUseAI}
              onChange={e => setFormData(p => ({ ...p, newsfeedCommentUseAI: e.target.checked }))}
              disabled={!formData.enableComment}
            />
            <span>Hoặc lời nhắc AI tạo nội dung</span>
          </label>
        </div>
      </div>
    </div>
  )

  const insertCampaignContentToken = (token: string) => {
    const textarea = campaignContentTextareaRef.current
    const start = textarea?.selectionStart ?? formData.content.length
    const end = textarea?.selectionEnd ?? start
    const safeStart = Math.max(0, Math.min(start, formData.content.length))
    const safeEnd = Math.max(safeStart, Math.min(end, formData.content.length))
    const nextContent =
      formData.content.slice(0, safeStart) +
      token +
      formData.content.slice(safeEnd)
    const nextCursor = safeStart + token.length

    setFormData(p => ({ ...p, content: nextContent }))
    window.requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const renderMessageInsertPanel = () => {
    const dateOptions = isZaloMessagePhoneCampaign
      ? MESSAGE_DATE_OPTIONS.filter(opt => opt.value === 'today')
      : MESSAGE_DATE_OPTIONS
    const dateTokenName = isZaloMessagePhoneCampaign
      ? 'TODAY'
      : (MESSAGE_DATE_OPTIONS.find(opt => opt.value === messageDateOption)?.token || 'TODAY')
    const dateToken = `#{${dateTokenName}(${messageDateFormat})}`

    return (
      <aside className="message-template-panel" aria-label="Chèn thông tin">
        <div className="message-template-title">Chèn thông tin</div>

        <div className="message-template-section">
          <div className="message-template-section-title">
            <Users size={16} />
            <span>Khách hàng</span>
          </div>
          <label>Tên hiển thị{isZaloMessagePhoneCampaign ? ' Zalo' : ''}</label>
          <button
            type="button"
            className="message-template-token"
            onClick={() => insertCampaignContentToken(MESSAGE_FULL_NAME_TOKEN)}
          >
            {MESSAGE_FULL_NAME_TOKEN}
          </button>
          {isZaloMessagePhoneCampaign && (
          <>
            <label>Tên gốc Zalo</label>
            <button
                type="button"
                className="message-template-token"
                onClick={() => insertCampaignContentToken('#{ORIGINAL_NAME}')}
              >
                {'#{ORIGINAL_NAME}'}
              </button>
              <label>Giới tính</label>
            <button
              type="button"
              className="message-template-token"
              onClick={() => insertCampaignContentToken('#{SEX{anh-chị-anh/chị}}')}
            >
              {'#{SEX{anh-chị-anh/chị}}'}
            </button>
            <label>Thông tin Excel</label>
            <div className="message-template-token-row">
              {['INPUT_FULLNAME', 'PHONE', 'EMAIL', 'INFO1', 'INFO2', 'INFO3', 'INFO4', 'INFO5'].map(token => (
                <button
                  key={token}
                  type="button"
                  className="message-template-token"
                  onClick={() => insertCampaignContentToken(`#{${token}}`)}
                >
                  {`#{${token}}`}
                </button>
              ))}
            </div>
            </>
          )}
        </div>

        <div className="message-template-section">
          <div className="message-template-section-title">
            <Calendar size={16} />
            <span>Chọn thời gian</span>
          </div>
          <div className="message-template-control-row">
            <div className="message-template-control">
              <label>Chọn ngày:</label>
              <select
                className="stepper-input"
                value={messageDateOption}
                onChange={e => setMessageDateOption(e.target.value as MessageDateOption)}
              >
                {dateOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="message-template-control">
              <label>Chọn định dạng:</label>
              <select
                className="stepper-input"
                value={messageDateFormat}
                onChange={e => setMessageDateFormat(e.target.value as MessageDateFormat)}
              >
                {MESSAGE_DATE_FORMATS.map(format => (
                  <option key={format} value={format}>{format}</option>
                ))}
              </select>
            </div>
          </div>
          <label>Chèn định dạng ngày</label>
          <button
            type="button"
            className="message-template-token"
            onClick={() => insertCampaignContentToken(dateToken)}
          >
            {dateToken}
          </button>
        </div>
      </aside>
    )
  }

  const renderImagePicker = (target: 'post' | 'comment', title: string) => {
    const isComment = target === 'comment'
    const isZaloMedia = isZaloMessagePhoneCampaign && !isComment
    const option = isComment ? formData.commentImageOption : formData.imageOption
    const randomCount = formData.randomImageCount
    const images = isComment ? formData.commentImages : formData.images
    const inputRef = isComment ? commentImageInputRef : imageInputRef
    const radioName = isComment ? 'commentImageOption' : 'imageOption'

    const setOption = (value: ImageOption) => {
      setFormData(p => isComment
        ? ({ ...p, commentImageOption: value === 'none' ? 'none' : 'all' })
        : ({ ...p, imageOption: value })
      )
    }

    const setRandomCount = (value: number) => {
      const count = Math.max(1, value || 1)
      setFormData(p => ({ ...p, randomImageCount: count }))
    }

    const removeImage = (index: number) => {
      setFormData(p => isComment
        ? ({ ...p, commentImages: p.commentImages.filter((_, i) => i !== index) })
        : ({ ...p, images: p.images.filter((_, i) => i !== index) })
      )
    }

    return (
      <div style={{ marginTop: 24, borderTop: '1px solid var(--border-default)', paddingTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>{title}</div>
        {isComment && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
            Lưu ý: Facebook chỉ cho phép comment 1 ảnh.
          </div>
        )}
        {!isComment && isPostBackgroundActive && (
          <div className="schedule-hint" style={{ marginTop: -8, marginBottom: 16 }}>
            Đăng bài với phông nền không hỗ trợ gửi media.
          </div>
        )}

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => inputRef.current?.click()}
              style={{ width: 'fit-content', opacity: option === 'none' ? 0.6 : 1 }}
              disabled={option === 'none'}
            >
              {isZaloMedia ? 'Tải hoặc chọn file' : 'Tải hoặc chọn ảnh'}
            </button>
            <input
              type="file"
              ref={inputRef}
              style={{ display: 'none' }}
              accept={isZaloMedia ? undefined : 'image/*'}
              multiple={!isComment}
              onChange={e => handleImagePickerChange(e, target)}
            />

            <div className="schedule-radio-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={option === 'none'}
                  onChange={() => setOption('none')}
                />
                <span>{isZaloMedia ? 'Không gửi file' : 'Không gửi ảnh'}</span>
              </label>
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={option === 'all'}
                  onChange={() => setOption('all')}
                />
                <span>{isZaloMedia ? 'Gửi file đã chọn' : 'Gửi ảnh đã chọn'}</span>
              </label>
              {!isComment && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label className="schedule-radio-label">
                  <input
                    type="radio"
                    name={radioName}
                    checked={option === 'random'}
                    onChange={() => setOption('random')}
                  />
                  <span>{isZaloMedia ? 'Gửi ngẫu nhiên số file trong file đã chọn' : 'Gửi ngẫu nhiên số ảnh trong ảnh đã chọn'}</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={randomCount}
                  onChange={e => setRandomCount(Number(e.target.value))}
                  className="stepper-input"
                  style={{ width: 60, padding: '4px 8px' }}
                  disabled={option !== 'random'}
                />
              </div>}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {isZaloMedia ? 'File đã chọn' : 'Ảnh đã chọn'}
            </div>
            <div className="stepper-grid-container" style={{ margin: 0, maxHeight: 300, overflowY: 'auto' }}>
              <table className="campaign-grid">
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 50, textAlign: 'center' }}>STT</th>
                    <th>Link</th>
                    <th style={{ width: 40, textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {images.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center text-muted" style={{ padding: '24px 0' }}>
                        {isZaloMedia ? 'Chưa có file nào được chọn' : 'Chưa có ảnh nào được chọn'}
                      </td>
                    </tr>
                  ) : (
                    images.map((img, idx) => (
                      <tr key={`${target}-${idx}-${img}`}>
                        <td className="text-center">{idx + 1}</td>
                        <td className="text-truncate" style={{ maxWidth: 200 }} title={img}>{img.split(/[\\/]/).pop() || img}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn-icon text-error action-btn"
                            style={{ display: 'inline-flex' }}
                            onClick={() => removeImage(idx)}
                            title="Xóa"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderMessageUidActionOptions = () => (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Chọn hành động</div>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.enableMessage}
            onChange={e => setFormData(p => ({ ...p, enableMessage: e.target.checked }))}
          />
          <span>Nhắn tin</span>
        </label>
      </div>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.enableAddFriend}
            onChange={e => setFormData(p => ({ ...p, enableAddFriend: e.target.checked }))}
          />
          <span>Kết bạn</span>
        </label>
      </div>
      {!formData.enableMessage && !formData.enableAddFriend && (
        <div style={{ color: 'var(--text-error)', fontSize: 12, marginTop: 4 }}>Vui lòng chọn ít nhất một hành động.</div>
      )}
      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Nguồn UID</div>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.useSuggestedFriends}
            disabled={isEditingSavedCampaign}
            onChange={e => setFormData(p => ({ ...p, useSuggestedFriends: e.target.checked }))}
          />
          <span>Gửi tin/Kết bạn theo đề xuất của Facebook</span>
        </label>
      </div>
      {formData.useSuggestedFriends && (
        <div className="stepper-form-group" style={{ maxWidth: 220 }}>
          <label>Số lượng</label>
          <input
            type="number"
            min={1}
            value={formData.suggestedFriendsCount}
            disabled={isEditingSavedCampaign}
            onChange={e => setFormData(p => ({
              ...p,
              suggestedFriendsCount: normalizeSuggestedFriendsCount(e.target.value)
            }))}
            className="stepper-input"
          />
        </div>
      )}
    </>
  )

  const renderZaloMessagePhoneActionOptions = () => (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Chọn hành động</div>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.enableMessage}
            onChange={e => setFormData(p => ({ ...p, enableMessage: e.target.checked }))}
          />
          <span>Nhắn tin</span>
        </label>
      </div>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.enableAddFriend}
            onChange={e => setFormData(p => ({ ...p, enableAddFriend: e.target.checked }))}
          />
          <span>Kết bạn</span>
        </label>
      </div>
      {!formData.enableMessage && !formData.enableAddFriend && (
        <div style={{ color: 'var(--text-error)', fontSize: 12, marginTop: 4 }}>Vui lòng chọn ít nhất nhắn tin hoặc kết bạn.</div>
      )}

      {formData.enableAddFriend && (
        <div className="stepper-form-group" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <label>Nội dung kết bạn</label>
            <span style={{ fontSize: 12, color: formData.friendRequestMessage.length > 150 ? 'var(--text-error)' : 'var(--text-muted)' }}>
              {formData.friendRequestMessage.length}/150
            </span>
          </div>
          <textarea
            className="stepper-textarea"
            rows={3}
            maxLength={150}
            value={formData.friendRequestMessage}
            onChange={e => setFormData(p => ({ ...p, friendRequestMessage: e.target.value.slice(0, 150) }))}
            placeholder="Có thể để trống"
          />
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.enableZaloTag}
            onChange={e => setFormData(p => ({
              ...p,
              enableZaloTag: e.target.checked,
              zaloTagId: e.target.checked ? p.zaloTagId : '',
              zaloTagName: e.target.checked ? p.zaloTagName : ''
            }))}
          />
          <span>Kiêm gắn tag</span>
        </label>
      </div>
      {formData.enableZaloTag && (
        <div className="stepper-form-group" style={{ maxWidth: 360 }}>
          <label>Tag Zalo</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="stepper-input"
              value={String(formData.zaloTagId || '')}
              disabled={zaloLabelsLoading || zaloLabelsSyncing || formData.accountIds.length === 0}
              onChange={e => {
                const label = zaloLabels.find(item => String(item.id) === e.target.value)
                setFormData(p => ({
                  ...p,
                  zaloTagId: e.target.value,
                  zaloTagName: label?.text || ''
                }))
              }}
            >
              <option value="">{zaloLabelsLoading ? 'Đang tải tag đã lưu...' : '-- Chọn tag --'}</option>
              {zaloLabels.map(label => (
                <option key={label.id} value={label.id}>{label.text}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              disabled={zaloLabelsLoading || zaloLabelsSyncing || formData.accountIds.length === 0}
              onClick={handleSyncZaloLabels}
            >
              {zaloLabelsSyncing ? <Loader2 size={14} /> : <RefreshCw size={14} />}
              {zaloLabelsSyncing ? 'Đang tải' : 'Tải tag'}
            </button>
          </div>
          {zaloLabelsError && <div className="schedule-hint" style={{ color: 'var(--text-error)' }}>{zaloLabelsError}</div>}
          {!zaloLabelsLoading && !zaloLabelsError && zaloLabels.length === 0 && (
            <div className="schedule-hint">Bấm “Tải tag” để lấy tag từ Zalo và lưu vào danh sách.</div>
          )}
        </div>
      )}

      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.enableZaloAlias}
            onChange={e => setFormData(p => ({
              ...p,
              enableZaloAlias: e.target.checked,
              zaloAliasTemplate: e.target.checked && !p.zaloAliasTemplate.trim()
                ? DEFAULT_ZALO_ALIAS_TEMPLATE
                : p.zaloAliasTemplate
            }))}
          />
          <span>Kiêm đổi tên</span>
        </label>
      </div>
      {formData.enableZaloAlias && (
        <div className="stepper-form-group">
          <input
            type="text"
            className="stepper-input"
            value={formData.zaloAliasTemplate}
            onChange={e => setFormData(p => ({ ...p, zaloAliasTemplate: e.target.value }))}
            placeholder={DEFAULT_ZALO_ALIAS_TEMPLATE}
          />
        </div>
      )}
    </>
  )

  const renderPagePostMethodSettings = () => (
    <div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.pagePostMode === 'api'}
            onChange={() => setFormData(p => ({ ...p, pagePostMode: 'api', postWithBackground: false }))}
          />
          <span>Đăng bài bằng API</span>
        </label>
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.pagePostMode === 'ui'}
            onChange={() => setFormData(p => ({ ...p, pagePostMode: 'ui' }))}
          />
          <span>Đăng bài trên giao diện</span>
        </label>
      </div>
    </div>
  )

  const renderSourceContentSettings = () => (
    <div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.copyContentFromSource}
            onChange={e => {
              const checked = e.target.checked
              setFormData(p => ({
                ...p,
                copyContentFromSource: checked,
                postWithBackground: checked ? false : p.postWithBackground,
                includeSourceImages: checked ? p.includeSourceImages : false,
                rewriteSourceContentWithAI: checked ? p.rewriteSourceContentWithAI : false
              }))
            }}
          />
          <span>Copy nội dung từ nguồn</span>
        </label>
        <label className="schedule-checkbox-label" style={{ opacity: formData.copyContentFromSource ? 1 : 0.5 }}>
          <input
            type="checkbox"
            checked={formData.includeSourceImages}
            onChange={e => setFormData(p => ({ ...p, includeSourceImages: e.target.checked }))}
            disabled={!formData.copyContentFromSource}
          />
          <span>Lấy kèm hình ảnh</span>
        </label>
      </div>
      {supportsSourceSharePost && (
        <div style={{ marginBottom: 12 }}>
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.sharePost}
              onChange={e => {
                const checked = e.target.checked
                setFormData(p => ({
                  ...p,
                  sharePost: checked,
                  postWithBackground: checked ? false : p.postWithBackground
                }))
              }}
            />
            <span>Đăng bài bằng cách chia sẻ</span>
          </label>
        </div>
      )}

      <div className="stepper-form-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <label style={{ margin: 0 }}>Danh sách uid/link (page, profile, group, post)</label>
          <span style={{ color: 'var(--text-error)', fontSize: 12 }}>(Mỗi link/uid cách nhau bằng dấu phẩy hoặc xuống dòng)</span>
        </div>
        <textarea
          className="stepper-textarea"
          placeholder={'Ví dụ:\nhttps://facebook.com/abc\nhttps://facebook.com/xyz/posts/12345, 100012345'}
          value={formData.sourceLinks}
          onChange={e => setFormData(p => ({ ...p, sourceLinks: e.target.value }))}
          rows={6}
        />
        <div className="schedule-hint" style={{ marginTop: 4 }}>
          Hệ thống sẽ tự động copy nội dung gần nhất trong link để đăng bài.<br />
          Nếu có nhiều link, hệ thống sẽ lấy nội dung từ 1 link lần lượt trong danh sách, đảm bảo nội dung không bị trùng lặp.
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="schedule-checkbox-label" style={{ opacity: formData.copyContentFromSource ? 1 : 0.5 }}>
          <input
            type="checkbox"
            checked={formData.copyContentFromSource && formData.rewriteSourceContentWithAI}
            onChange={e => setFormData(p => ({ ...p, rewriteSourceContentWithAI: e.target.checked }))}
            disabled={!formData.copyContentFromSource}
          />
          <span>Lời nhắc AI - Edit lại nội dung</span>
        </label>
      </div>
      {formData.copyContentFromSource && formData.rewriteSourceContentWithAI && (
        <div className="stepper-form-group" style={{ marginTop: 12 }}>
          <label>Lời nhắc AI</label>
          <textarea
            className="stepper-textarea"
            placeholder="Viết lại nội dung sau: [content]"
            value={formData.sourceContentAiPrompt}
            onChange={e => setFormData(p => ({ ...p, sourceContentAiPrompt: e.target.value }))}
            rows={4}
          />
        </div>
      )}

      {supportsSourceReels && (
        <div style={{ marginTop: 12 }}>
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.postAsReels}
              onChange={e => setFormData(p => ({ ...p, postAsReels: e.target.checked }))}
            />
            <span>Đăng Reels <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Đăng video trên Reels)</em></span>
          </label>
        </div>
      )}
    </div>
  )

  const sanitizeFindDataSourceSelection = normalizeFindDataFlagState

  const handleFindPhoneTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindPhone: checked,
      findPhoneSmsTargetCampaignIds: checked ? p.findPhoneSmsTargetCampaignIds : [],
      findPhoneZaloWebTargetCampaignIds: checked ? p.findPhoneZaloWebTargetCampaignIds : [],
      findPhoneAkaBizDesktopTargetCampaignIds: checked ? p.findPhoneAkaBizDesktopTargetCampaignIds : []
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) {
      setHandleFoundPhoneSmsData(false)
      setHandleFoundPhoneZaloWebData(false)
      setHandleFoundPhoneAkaBizDesktopData(false)
    }
  }

  const handleFindZaloGroupTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindLinkGroupZalo: checked,
      findZaloGroupLinkWebTargetCampaignIds: checked ? p.findZaloGroupLinkWebTargetCampaignIds : [],
      findZaloGroupLinkAkaBizDesktopTargetCampaignIds: checked ? p.findZaloGroupLinkAkaBizDesktopTargetCampaignIds : []
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) {
      setHandleFoundZaloGroupLinkWebData(false)
      setHandleFoundZaloGroupLinkAkaBizDesktopData(false)
    }
  }

  const handleFindUidTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindUid: checked,
      findUidTargetCampaignIds: checked ? p.findUidTargetCampaignIds : []
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) setHandleFoundUidData(false)
  }

  const handleFindPostLinkTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindPostLink: checked,
      isFindInPost: checked ? true : p.isFindInPost,
      findPostLinkTargetCampaignIds: checked ? p.findPostLinkTargetCampaignIds : []
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) setHandleFoundPostLinkData(false)
  }

  const handleFindFacebookGroupTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindFacebookGroup: checked,
      findFacebookGroupPostTargetCampaignIds: checked ? p.findFacebookGroupPostTargetCampaignIds : [],
      findFacebookGroupCommentTargetCampaignIds: checked ? p.findFacebookGroupCommentTargetCampaignIds : []
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) {
      setHandleFoundFacebookGroupPostData(false)
      setHandleFoundFacebookGroupCommentData(false)
    }
  }

  const renderFindDataSearchConfig = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="extra-comment-options">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Tìm kiếm gì</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.isFindPhone}
              onChange={e => handleFindPhoneTargetChange(e.target.checked)}
            />
            <span>Số điện thoại</span>
          </label>
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.isFindLinkGroupZalo}
              onChange={e => handleFindZaloGroupTargetChange(e.target.checked)}
            />
            <span>Link group Zalo</span>
          </label>
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.isFindUid}
              disabled={isDraftAutoLinkedFindUid}
              onChange={e => handleFindUidTargetChange(e.target.checked)}
            />
            <span>Uid user facebook</span>
          </label>
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.isFindPostLink}
              disabled={isDraftAutoLinkedPostLink}
              onChange={e => handleFindPostLinkTargetChange(e.target.checked)}
            />
            <span>Link post</span>
          </label>
          {isFindDataSearchCampaign && (
            <label className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={formData.isFindFacebookGroup}
                onChange={e => handleFindFacebookGroupTargetChange(e.target.checked)}
              />
              <span>Link group Facebook</span>
            </label>
          )}
        </div>
      </div>

      {hasFindDataTargetSelection && (
        <div className="extra-comment-options">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Tìm kiếm từ đâu</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {canUseFindDataPostSource && (
              <label className="schedule-checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.isFindPostLink || formData.isFindInPost}
                  onChange={e => {
                    const checked = e.target.checked
                    setFormData(p => sanitizeFindDataSourceSelection({ ...p, isFindInPost: checked }, { isSearchCampaign: isFindDataSearchCampaign }))
                  }}
                />
                <span>Bài post</span>
              </label>
            )}
            {canUseFindDataCommentSource && (
              <label className="schedule-checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.isFindInComment}
                  onChange={e => setFormData(p => sanitizeFindDataSourceSelection({ ...p, isFindInComment: e.target.checked }, { isSearchCampaign: isFindDataSearchCampaign }))}
                />
                <span>Comment</span>
              </label>
            )}
            {canUseFindDataUidOnlySources && (
              <label className="schedule-checkbox-label find-data-source-option">
                <input
                  type="checkbox"
                  checked={formData.isFindNewInteractors}
                  onChange={e => {
                    const checked = e.target.checked
                    setFormData(p => sanitizeFindDataSourceSelection({
                      ...p,
                      isFindNewInteractors: checked
                    }, { isSearchCampaign: isFindDataSearchCampaign }))
                  }}
                />
                <span className="find-data-source-option-text">
                  <span className="find-data-source-option-title">Những người tương tác mới</span>
                  <span className="find-data-source-option-description">Là những người đăng bài hoặc comment trong 1 phiên chạy mới hoặc trong 1 ngày</span>
                </span>
              </label>
            )}
            {canUseFindDataUidOnlySources && (
              <label className="schedule-checkbox-label find-data-source-option">
                <input
                  type="checkbox"
                  checked={formData.isFindInGroupMembers}
                  onChange={e => {
                    const checked = e.target.checked
                    setFormData(p => sanitizeFindDataSourceSelection({
                      ...p,
                      isFindInGroupMembers: checked
                    }, { isSearchCampaign: isFindDataSearchCampaign }))
                  }}
                />
                <span className="find-data-source-option-text">
                  <span className="find-data-source-option-title">Thành viên group mới</span>
                  <span className="find-data-source-option-description">Là thành viên tham gia vào group mới nhất theo số lượng cài đặt hoặc theo phiên chạy mới nhất</span>
                </span>
              </label>
            )}
            {isFindDataSearchCampaign && formData.isFindFacebookGroup && (
              <label className="schedule-checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.isFindFacebookGroup}
                  onChange={e => handleFindFacebookGroupTargetChange(e.target.checked)}
                />
                <span>Group Facebook</span>
              </label>
            )}
          </div>
        </div>
      )}

      {hasFindDataTargetSelection && (
        <div className="extra-comment-options">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Mục tiêu tìm kiếm</div>
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.findDataGoalModeEnabled}
              onChange={e => {
                const checked = e.target.checked
                setFormData(p => ({
                  ...p,
                  findDataGoalModeEnabled: checked,
                  findDataGoalPriority: checked
                    ? normalizeFindDataGoalPriority(p, p.findDataGoalPriority)
                    : p.findDataGoalPriority,
                  findDataGoalDailyLimit: normalizeFindDataGoalDailyLimit(p.findDataGoalDailyLimit)
                }))
              }}
            />
            <span>Chế độ theo đuổi mục tiêu</span>
          </label>

          {formData.findDataGoalModeEnabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
              <div className="stepper-form-group">
                <label>Lựa chọn ưu tiên</label>
                {findDataGoalOptions.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {findDataGoalOptions.map(option => (
                      <label key={option.value} className="schedule-radio-label">
                        <input
                          type="radio"
                          name="find-data-goal-priority"
                          checked={effectiveFindDataGoalPriority === option.value}
                          onChange={() => setFormData(p => ({ ...p, findDataGoalPriority: option.value }))}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="schedule-hint">Chọn ít nhất một loại data ở phần Tìm kiếm gì để đặt ưu tiên.</div>
                )}
              </div>

              <div className="stepper-form-group" style={{ maxWidth: 240 }}>
                <label>Số lượng mỗi ngày là</label>
                <input
                  type="number"
                  min={1}
                  value={formData.findDataGoalDailyLimit}
                  onChange={e => setFormData(p => ({
                    ...p,
                    findDataGoalDailyLimit: normalizeFindDataGoalDailyLimit(e.target.value)
                  }))}
                  className="stepper-input"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  const toInternalCampaignPickerRow = (item: Campaign): CampaignPickerRow => {
    const accountName = item.accountName || `Tài khoản #${item.accountId}`
    const scheduleLabel = getCampaignScheduleLabel(item)
    return {
      id: item.id,
      name: item.name || `Campaign #${item.id}`,
      accountName,
      status: item.status || 'Không rõ',
      scheduleLabel,
      searchText: buildCampaignPickerSearchText([item.name, accountName, item.status, scheduleLabel])
    }
  }

  const toFindDataSourcePickerRow = (item: Campaign): CampaignPickerRow => {
    const accountName = item.accountName || `Tài khoản #${item.accountId}`
    const scheduleLabel = getCampaignScheduleLabel(item)
    const dataTypes = getFindDataTypeLabels(item.extraSettings)
    const sourceTypes = getFindDataSourceLabels(item.extraSettings)
    return {
      id: item.id,
      name: item.name || `Campaign #${item.id}`,
      accountName,
      status: item.status || 'Không rõ',
      scheduleLabel,
      dataTypes,
      sourceTypes,
      searchText: buildCampaignPickerSearchText([item.name, accountName, item.status, scheduleLabel, dataTypes, sourceTypes])
    }
  }

  const toExternalCampaignPickerRow = (item: AkaBizCampaignListItem): CampaignPickerRow => {
    const name = item.name || `Campaign #${item.id}`
    const accountName = item.shopName || `Tài khoản #${item.shopId}`
    const status = item.status || 'Không rõ'
    const scheduleLabel = formatPickerDateTime(item.schedule)
    return {
      id: item.id,
      name,
      accountName,
      status,
      scheduleLabel,
      searchText: buildCampaignPickerSearchText([name, accountName, status, scheduleLabel])
    }
  }

  const draftMatchesCampaignPickerSource = (draft: InternalCampaignDraft, source: CampaignPickerSource): boolean => {
    if (source.type === 'external') return false
    if (draft.sourceType !== source.type) return false
    if (source.type === 'findDataSource') {
      return !draft.requiredTargetField || draft.requiredTargetField === targetFindDataField
    }
    return true
  }

  const toDraftCampaignPickerRow = (draft: InternalCampaignDraft): CampaignPickerRow => {
    const firstItem = draft.items[0]
    const payload = firstItem?.campaignPayload || {}
    const accountNames = Array.from(new Set(
      draft.items.map(item => {
        const accountId = Number(item.campaignPayload.accountId)
        return accounts.find(account => account.id === accountId)?.name || (accountId ? `Tài khoản #${accountId}` : '')
      }).filter(Boolean)
    ))
    const name = String(payload.name || `Chiến dịch tạm #${Math.abs(draft.tempId)}`)
    const displayName = draft.items.length > 1 ? `${name} (${draft.items.length} tài khoản)` : name
    const extraSettings = payload.extraSettings as CampaignExtraSettings | undefined
    const dataTypes = draft.sourceType === 'findDataSource' ? getFindDataTypeLabels(extraSettings) : undefined
    const sourceTypes = draft.sourceType === 'findDataSource' ? getFindDataSourceLabels(extraSettings) : undefined
    const scheduleLabel = getCampaignScheduleLabel(payload as Pick<Campaign, 'schedule' | 'scheduleType' | 'scheduleDays' | 'scheduleWeekDays'>)

    return {
      id: draft.tempId,
      name: displayName,
      accountName: accountNames.join(', '),
      status: 'Tạm',
      scheduleLabel,
      dataTypes,
      sourceTypes,
      searchText: buildCampaignPickerSearchText([displayName, accountNames, 'Tạm', scheduleLabel, dataTypes, sourceTypes])
    }
  }

  const getCampaignPickerRows = (source: CampaignPickerSource): CampaignPickerRow[] => {
    const draftRows = internalCampaignDrafts
      .filter(draft => draftMatchesCampaignPickerSource(draft, source))
      .map(toDraftCampaignPickerRow)
    if (source.type === 'findDataSource') return [...findDataSourceCampaignOptions.map(toFindDataSourcePickerRow), ...draftRows]
    if (source.type === 'messageUidTarget') return [...messageUidCampaignOptions.map(toInternalCampaignPickerRow), ...draftRows]
    if (source.type === 'postLinkTarget') return [...postLinkCommentCampaignOptions.map(toInternalCampaignPickerRow), ...draftRows]
    if (source.type === 'groupPostTarget') return groupPostCampaignOptions.map(toInternalCampaignPickerRow)
    if (source.type === 'groupCommentTarget') return groupCommentCampaignOptions.map(toInternalCampaignPickerRow)
    return (externalCampaigns[source.kind] || []).map(toExternalCampaignPickerRow)
  }

  const isCampaignPickerLoading = (source: CampaignPickerSource): boolean =>
    campaignPickerRefreshing || (source.type === 'external' && (!!externalCampaignLoading[source.kind] || !externalCampaignLoaded[source.kind]))

  const getCampaignPickerRowLabel = (row: CampaignPickerRow): string => {
    const parts = [row.name]
    if (row.accountName) parts.push(row.accountName)
    const base = parts.join(' - ')
    return row.status ? `${base} (${row.status})` : base
  }

  const openCampaignPicker = (config: Omit<CampaignPickerModalState, 'draftIds' | 'draftTempIdsAtOpen' | 'searchQuery'>) => {
    const draftTempIdsAtOpen = internalCampaignDrafts
      .filter(draft => draftMatchesCampaignPickerSource(draft, config.source))
      .map(draft => draft.tempId)
    setCampaignPickerModal({
      ...config,
      draftIds: [...config.selectedIds],
      draftTempIdsAtOpen,
      searchQuery: ''
    })
  }

  const toggleCampaignPickerDraftId = (id: number) => {
    setCampaignPickerModal(prev => {
      if (!prev) return prev
      const exists = prev.draftIds.includes(id)
      return {
        ...prev,
        draftIds: exists
          ? prev.draftIds.filter(currentId => currentId !== id)
          : [...prev.draftIds, id]
      }
    })
  }

  const confirmCampaignPicker = () => {
    if (!campaignPickerModal) return
    const confirmedIds = getPickerCampaignIdList(campaignPickerModal.draftIds)
    campaignPickerModal.onConfirm(confirmedIds)
    setInternalCampaignDrafts(prev => prev.filter(draft =>
      !draftMatchesCampaignPickerSource(draft, campaignPickerModal.source) || confirmedIds.includes(draft.tempId)
    ))
    setCampaignPickerModal(null)
  }

  const cancelCampaignPicker = () => {
    if (!campaignPickerModal) return
    const keepDraftIds = new Set(campaignPickerModal.draftTempIdsAtOpen)
    setInternalCampaignDrafts(prev => prev.filter(draft =>
      !draftMatchesCampaignPickerSource(draft, campaignPickerModal.source) || keepDraftIds.has(draft.tempId)
    ))
    setCampaignPickerModal(null)
  }

  const refreshCampaignPicker = async () => {
    if (!campaignPickerModal) return
    setCampaignPickerRefreshing(true)
    try {
      if (campaignPickerModal.source.type === 'external') {
        await loadExternalCampaigns(campaignPickerModal.source.kind)
      } else {
        await loadCampaigns()
      }
    } finally {
      setCampaignPickerRefreshing(false)
    }
  }

  const getDraftActionIdForPickerSource = (source: CampaignPickerSource): string | null => {
    if (source.type === 'messageUidTarget') return MESSAGE_UID_ACTION_ID
    if (source.type === 'postLinkTarget') return COMMENT_SEEDING_POST_ACTION_ID
    if (source.type === 'findDataSource') {
      return targetFindDataField === 'findFacebookGroupPostTargetCampaignIds' || targetFindDataField === 'findFacebookGroupCommentTargetCampaignIds'
        ? FIND_DATA_SEARCH_ACTION_ID
        : FIND_DATA_GROUP_ACTION_ID
    }
    return null
  }

  const openDraftCampaignForm = (source: CampaignPickerSource) => {
    const actionId = getDraftActionIdForPickerSource(source)
    if (!actionId || source.type === 'external') return
    setDraftFormConfig({
      tempId: nextDraftCampaignTempIdRef.current--,
      sourceType: source.type,
      actionId,
      requiredTargetField: source.type === 'findDataSource' ? targetFindDataField : null
    })
  }

  const handleDraftCampaignSaved = (draft: InternalCampaignDraft) => {
    setInternalCampaignDrafts(prev => [...prev.filter(item => item.tempId !== draft.tempId), draft])
    setCampaignPickerModal(prev => prev
      ? { ...prev, draftIds: getPickerCampaignIdList([...prev.draftIds, draft.tempId]) }
      : prev
    )
    setDraftFormConfig(null)
  }

  const renderTextList = (items: string[] | undefined, emptyText = 'Không có') => {
    if (!items || items.length === 0) {
      return <span className="campaign-picker-muted">{emptyText}</span>
    }
    return <span className="campaign-picker-text-list">{items.join(', ')}</span>
  }

  const renderSelectedCampaignSummary = (
    source: CampaignPickerSource,
    selectedIds: number[],
    emptyText: string
  ) => {
    if (selectedIds.length === 0) {
      return <div className="campaign-picker-empty-summary">{emptyText}</div>
    }

    const rows = getCampaignPickerRows(source)
    const rowById = new Map(rows.map(row => [row.id, row]))
    const selectedRows = selectedIds.map(id => rowById.get(id) || {
      id,
      name: `Campaign #${id}`,
      searchText: String(id)
    })
    const columns: CampaignPickerColumn[] = source.type === 'findDataSource'
      ? ['name', 'account', 'status', 'schedule', 'dataTypes', 'sourceTypes']
      : ['name', 'account', 'status', 'schedule']
    const columnLabels: Record<CampaignPickerColumn, string> = {
      name: 'Tên chiến dịch',
      account: source.type === 'external' ? 'Tài khoản/Shop' : 'Tài khoản',
      status: 'Trạng thái',
      schedule: 'Lịch chạy',
      dataTypes: 'Data tìm',
      sourceTypes: 'Nguồn tìm'
    }
    const renderSummaryCell = (row: CampaignPickerRow, column: CampaignPickerColumn) => {
      if (column === 'name') return <span className="campaign-picker-table-name">{row.name}</span>
      if (column === 'account') return row.accountName || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'status') return row.status || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'schedule') return row.scheduleLabel
        ? <span className="campaign-picker-table-schedule">{row.scheduleLabel}</span>
        : <span className="campaign-picker-muted">Chưa có</span>
      if (column === 'dataTypes') return renderTextList(row.dataTypes)
      return renderTextList(row.sourceTypes)
    }

    return (
      <div className="campaign-picker-summary-table-wrap">
        <table className="campaign-picker-summary-table">
          <thead>
            <tr>
              {columns.map(column => (
                <th key={column}>{columnLabels[column]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selectedRows.map(row => (
              <tr key={row.id} title={getCampaignPickerRowLabel(row)}>
                {columns.map(column => (
                  <td key={column}>{renderSummaryCell(row, column)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderDraftRelationNotice = (text: string) => (
    <div className="campaign-picker-readonly-note">{text}</div>
  )

  const renderExternalCampaignPicker = (
    kind: AkaBizCampaignListKind,
    isIntegrated: boolean,
    selectedIds: number[],
    onConfirm: (campaignIds: number[]) => void,
    emptyText: string
  ) => {
    if (akabizIntegrationsLoading || akabizIntegrations === null) {
      return <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>Đang tải tích hợp...</div>
    }

    if (!isIntegrated) {
      return (
        <div className="external-campaign-empty">
          <div>Chưa tích hợp tài khoản akaBiz phù hợp.</div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onOpenGeneralSettings?.()}
            disabled={!onOpenGeneralSettings}
          >
            Mở Cài đặt chung
          </button>
        </div>
      )
    }

    const source: CampaignPickerSource = { type: 'external', kind }
    return (
      <div className="campaign-picker-field">
        <button
          type="button"
          className="btn btn-secondary btn-sm campaign-picker-select-button"
          onClick={() => openCampaignPicker({
            title: 'Chọn chiến dịch',
            source,
            columns: ['name', 'account', 'status', 'schedule'],
            emptyText,
            selectedIds,
            onConfirm
          })}
        >
          Chọn chiến dịch
        </button>
        {renderSelectedCampaignSummary(source, selectedIds, 'Chưa chọn chiến dịch nào.')}
      </div>
    )
  }

  const renderFindDataSourceCampaignPicker = () => {
    const emptyMessage =
      targetFindDataField === 'findUidTargetCampaignIds'
        ? 'Chưa có chiến dịch tìm data phù hợp để làm nguồn UID.'
        : targetFindDataField === 'findPostLinkTargetCampaignIds'
          ? 'Chưa có chiến dịch tìm data phù hợp để làm nguồn link bài post.'
          : 'Chưa có chiến dịch tìm data bằng search phù hợp để làm nguồn link group Facebook.'

    if (isDraftTargetFromFindData) {
      return (
        <div className="stepper-form-group">
          <label>Chiến dịch nguồn</label>
          {renderDraftRelationNotice('Sẽ liên kết với chiến dịch tìm data đang tạo/chỉnh sau khi lưu chiến dịch chính.')}
        </div>
      )
    }

    return (
      <div className="stepper-form-group">
        <label>Chiến dịch nguồn</label>
        <div className="campaign-picker-field">
          <button
            type="button"
            className="btn btn-secondary btn-sm campaign-picker-select-button"
            onClick={() => openCampaignPicker({
              title: 'Chọn nguồn chiến dịch tìm kiếm data',
              source: { type: 'findDataSource' },
              columns: ['name', 'account', 'status', 'schedule', 'dataTypes', 'sourceTypes'],
              emptyText: emptyMessage,
              selectedIds: selectedFindDataSourceCampaignIds,
              onConfirm: ids => {
                findDataSourceSelectionTouchedRef.current = true
                setSelectedFindDataSourceCampaignIds(ids)
              }
            })}
          >
            Chọn chiến dịch
          </button>
          {renderSelectedCampaignSummary({ type: 'findDataSource' }, selectedFindDataSourceCampaignIds, 'Chưa chọn chiến dịch nguồn nào.')}
        </div>
      </div>
    )
  }

  const renderInternalCampaignPicker = (
    source: CampaignPickerSource,
    selectedIds: number[],
    onConfirm: (ids: number[]) => void,
    emptyText: string
  ) => (
    <div className="campaign-picker-field">
      <button
        type="button"
        className="btn btn-secondary btn-sm campaign-picker-select-button"
        onClick={() => openCampaignPicker({
          title: 'Chọn chiến dịch',
          source,
          columns: ['name', 'account', 'status', 'schedule'],
          emptyText,
          selectedIds,
          onConfirm
        })}
      >
        Chọn chiến dịch
      </button>
      {renderSelectedCampaignSummary(source, selectedIds, 'Chưa chọn chiến dịch nào.')}
    </div>
  )

  const renderFoundDataHandling = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {formData.isFindPhone && (
        <div className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundPhoneSmsData}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundPhoneSmsData(checked)
                if (!checked) setFormData(p => ({ ...p, findPhoneSmsTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy SĐT sang akaBiz Sms</span>
          </label>
          {handleFoundPhoneSmsData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderExternalCampaignPicker(
                'sms',
                hasSmsIntegration,
                formData.findPhoneSmsTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findPhoneSmsTargetCampaignIds: ids })),
                'Không có chiến dịch akaBiz Sms phù hợp để nhận SĐT.'
              )}
            </div>
          )}
        </div>
      )}

      {formData.isFindPhone && (
        <div className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundPhoneZaloWebData}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundPhoneZaloWebData(checked)
                if (!checked) setFormData(p => ({ ...p, findPhoneZaloWebTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy SĐT sang akaBiz Zalo Web</span>
          </label>
          {handleFoundPhoneZaloWebData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderExternalCampaignPicker(
                'zaloPhone',
                hasZaloWebIntegration,
                formData.findPhoneZaloWebTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findPhoneZaloWebTargetCampaignIds: ids })),
                'Không có chiến dịch akaBiz Zalo Web phù hợp để nhận SĐT.'
              )}
            </div>
          )}
        </div>
      )}

      {formData.isFindPhone && (
        <div className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundPhoneAkaBizDesktopData}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundPhoneAkaBizDesktopData(checked)
                if (!checked) setFormData(p => ({ ...p, findPhoneAkaBizDesktopTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy SĐT sang akaBiz Desktop</span>
          </label>
          {handleFoundPhoneAkaBizDesktopData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderExternalCampaignPicker(
                'desktopZaloPhone',
                hasAkaBizDesktopIntegration,
                formData.findPhoneAkaBizDesktopTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findPhoneAkaBizDesktopTargetCampaignIds: ids })),
                'Không có chiến dịch akaBiz Desktop phù hợp để nhận SĐT.'
              )}
            </div>
          )}
        </div>
      )}

      {formData.isFindLinkGroupZalo && (
        <div className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundZaloGroupLinkWebData}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundZaloGroupLinkWebData(checked)
                if (!checked) setFormData(p => ({ ...p, findZaloGroupLinkWebTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy link group Zalo sang akaBiz Zalo Web</span>
          </label>
          {handleFoundZaloGroupLinkWebData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderExternalCampaignPicker(
                'zaloGroupLink',
                hasZaloWebIntegration,
                formData.findZaloGroupLinkWebTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findZaloGroupLinkWebTargetCampaignIds: ids })),
                'Không có chiến dịch akaBiz Zalo Web phù hợp để nhận link group Zalo.'
              )}
            </div>
          )}
        </div>
      )}

      {formData.isFindLinkGroupZalo && (
        <div className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundZaloGroupLinkAkaBizDesktopData}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundZaloGroupLinkAkaBizDesktopData(checked)
                if (!checked) setFormData(p => ({ ...p, findZaloGroupLinkAkaBizDesktopTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy link group Zalo sang akaBiz Desktop</span>
          </label>
          {handleFoundZaloGroupLinkAkaBizDesktopData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderExternalCampaignPicker(
                'desktopZaloGroupLink',
                hasAkaBizDesktopIntegration,
                formData.findZaloGroupLinkAkaBizDesktopTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findZaloGroupLinkAkaBizDesktopTargetCampaignIds: ids })),
                'Không có chiến dịch akaBiz Desktop phù hợp để nhận link group Zalo.'
              )}
            </div>
          )}
        </div>
      )}

      {formData.isFindUid && (
        <div className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundUidData}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundUidData(checked)
                if (!checked) setFormData(p => ({ ...p, findUidTargetCampaignIds: [] }))
              }}
            />
            <span>Gửi tin nhắn & kết bạn đến UID</span>
          </label>
          {handleFoundUidData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {isDraftAutoLinkedFindUid
                ? renderDraftRelationNotice('Sẽ liên kết với chiến dịch đích đang tạo/chỉnh sau khi lưu chiến dịch chính.')
                : renderInternalCampaignPicker(
                  { type: 'messageUidTarget' },
                  formData.findUidTargetCampaignIds || [],
                  ids => setFormData(p => ({ ...p, findUidTargetCampaignIds: ids })),
                  'Chưa có chiến dịch Nhắn tin & Kết bạn đến UID để nhận UID.'
                )}
            </div>
          )}
        </div>
      )}

      {formData.isFindPostLink && (
        <div className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundPostLinkData}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundPostLinkData(checked)
                if (!checked) setFormData(p => ({ ...p, findPostLinkTargetCampaignIds: [] }))
              }}
            />
            <span>Comment vào link bài post</span>
          </label>
          {handleFoundPostLinkData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {isDraftAutoLinkedPostLink
                ? renderDraftRelationNotice('Sẽ liên kết với chiến dịch đích đang tạo/chỉnh sau khi lưu chiến dịch chính.')
                : renderInternalCampaignPicker(
                  { type: 'postLinkTarget' },
                  formData.findPostLinkTargetCampaignIds || [],
                  ids => setFormData(p => ({ ...p, findPostLinkTargetCampaignIds: ids })),
                  'Chưa có chiến dịch Comment seeding vào danh sách bài post để nhận link.'
                )}
            </div>
          )}
        </div>
      )}

      {isFindDataSearchCampaign && formData.isFindFacebookGroup && (
        <div className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundFacebookGroupPostData}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundFacebookGroupPostData(checked)
                if (!checked) setFormData(p => ({ ...p, findFacebookGroupPostTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy group sang chiến dịch đăng bài vào group</span>
          </label>
          {handleFoundFacebookGroupPostData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderInternalCampaignPicker(
                { type: 'groupPostTarget' },
                formData.findFacebookGroupPostTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findFacebookGroupPostTargetCampaignIds: ids })),
                'Chưa có chiến dịch Đăng bài vào group để nhận group Facebook.'
              )}
            </div>
          )}
        </div>
      )}

      {isFindDataSearchCampaign && formData.isFindFacebookGroup && (
        <div className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundFacebookGroupCommentData}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundFacebookGroupCommentData(checked)
                if (!checked) setFormData(p => ({ ...p, findFacebookGroupCommentTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy group sang chiến dịch comment seeding vào group</span>
          </label>
          {handleFoundFacebookGroupCommentData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderInternalCampaignPicker(
                { type: 'groupCommentTarget' },
                formData.findFacebookGroupCommentTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findFacebookGroupCommentTargetCampaignIds: ids })),
                'Chưa có chiến dịch Comment seeding group/page/profile để nhận group Facebook.'
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )

  const renderFindDataPostContentConditions = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Điều kiện nội dung bài viết</div>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.isFindPostByKeywords}
            onChange={e => setFormData(p => ({ ...p, isFindPostByKeywords: e.target.checked }))}
          />
          <span>Bài viết phải chứa 1 trong các từ khoá (cách nhau dấu phẩy)</span>
        </label>
        <input
          type="text"
          value={formData.postKeywords}
          onChange={e => setFormData(p => ({ ...p, postKeywords: e.target.value }))}
          className="stepper-input"
          disabled={!formData.isFindPostByKeywords}
        />
      </div>

      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.isFindPostByContentAI}
            onChange={e => setFormData(p => ({ ...p, isFindPostByContentAI: e.target.checked }))}
          />
          <span>Ý nghĩa bài viết là (dùng AI)</span>
        </label>
        <textarea
          className="stepper-textarea"
          value={formData.postContentAI}
          onChange={e => setFormData(p => ({ ...p, postContentAI: e.target.value }))}
          rows={4}
          disabled={!formData.isFindPostByContentAI}
        />
      </div>
    </div>
  )

  const renderFindDataCommentContentConditions = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Điều kiện nội dung comment</div>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.isFindCommentByKeywords}
            onChange={e => setFormData(p => ({ ...p, isFindCommentByKeywords: e.target.checked }))}
          />
          <span>Comment phải chứa 1 trong các từ khoá (cách nhau dấu phẩy)</span>
        </label>
        <input
          type="text"
          value={formData.commentKeywords}
          onChange={e => setFormData(p => ({ ...p, commentKeywords: e.target.value }))}
          className="stepper-input"
          disabled={!formData.isFindCommentByKeywords}
        />
      </div>

      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.isFindCommentByContentAI}
            onChange={e => setFormData(p => ({ ...p, isFindCommentByContentAI: e.target.checked }))}
          />
          <span>Ý nghĩa comment là (dùng AI)</span>
        </label>
        <textarea
          className="stepper-textarea"
          value={formData.commentContentAI}
          onChange={e => setFormData(p => ({ ...p, commentContentAI: e.target.value }))}
          rows={4}
          disabled={!formData.isFindCommentByContentAI}
        />
      </div>
    </div>
  )

  const renderFindDataConditions = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {usesFindDataPostFeed && (
        <div className="extra-comment-options">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Bài viết</div>
          <div className="stepper-form-row">
            <div className="stepper-form-group half">
              <label>{isFindDataSearchCampaign ? 'Cách hiển thị bài post search' : 'Cách hiển thị bài post trong group'}</label>
              <select
                value={effectiveFindDataPostSort}
                onChange={e => setFormData(p => ({ ...p, sortTypePost: e.target.value as CampaignExtraSettings['sortTypePost'] }))}
                disabled={formData.isFindNewInteractors}
                className="stepper-input"
              >
                {POST_SORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="stepper-form-group half">
              <label>{isFindDataSearchCampaign ? 'Số post tối đa / từ khóa' : 'Số post tối đa trong 1 group'}</label>
              <input
                type="number"
                min={1}
                value={isFindDataSearchCampaign ? formData.countSearchPostFindData : formData.countPostFindData}
                onChange={e => {
                  const value = Math.max(1, Number(e.target.value) || 1)
                  setFormData(p => isFindDataSearchCampaign
                    ? { ...p, countSearchPostFindData: value }
                    : { ...p, countPostFindData: value }
                  )
                }}
                className="stepper-input"
              />
            </div>
          </div>
          {isFindDataSearchCampaign && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
              <label className="schedule-checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.searchPostRecentOnly}
                  onChange={e => setFormData(p => ({ ...p, searchPostRecentOnly: e.target.checked }))}
                />
                <span>Bài viết mới đây</span>
              </label>
              <label className="schedule-checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.searchPostSeenOnly}
                  onChange={e => setFormData(p => ({ ...p, searchPostSeenOnly: e.target.checked }))}
                />
                <span>Bài viết bạn đã xem</span>
              </label>
              <div className="stepper-form-row">
                <div className="stepper-form-group third">
                  <label>Ngày đăng</label>
                  <select
                    value={formData.searchPostDateFilter}
                    onChange={e => setFormData(p => ({ ...p, searchPostDateFilter: e.target.value as NonNullable<CampaignExtraSettings['searchPostDateFilter']> }))}
                    className="stepper-input"
                  >
                    {SEARCH_POST_DATE_FILTER_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="stepper-form-group third">
                  <label>Bài viết của</label>
                  <select
                    value={formData.searchPostAuthorFilter}
                    onChange={e => setFormData(p => ({ ...p, searchPostAuthorFilter: e.target.value as NonNullable<CampaignExtraSettings['searchPostAuthorFilter']> }))}
                    className="stepper-input"
                  >
                    {SEARCH_POST_AUTHOR_FILTER_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="stepper-form-group third">
                  <label>Vị trí được gắn thẻ</label>
                  <select
                    value={formData.searchPostTaggedLocation}
                    onChange={e => setFormData(p => ({ ...p, searchPostTaggedLocation: e.target.value as NonNullable<CampaignExtraSettings['searchPostTaggedLocation']> }))}
                    className="stepper-input"
                  >
                    {SEARCH_POST_TAGGED_LOCATION_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
          {usesFindDataPostContentConditions && renderFindDataPostContentConditions()}
        </div>
      )}

      {usesFindDataCommentFeed && (
        <div className="extra-comment-options">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Comment</div>
          <div className="stepper-form-row">
            <div className="stepper-form-group half">
              <label>Cách hiển thị comment trong post</label>
              <select
                value={effectiveFindDataCommentSort}
                onChange={e => setFormData(p => ({ ...p, sortTypeComment: e.target.value as CampaignExtraSettings['sortTypeComment'] }))}
                disabled={formData.isFindNewInteractors}
                className="stepper-input"
              >
                {COMMENT_SORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="stepper-form-group half">
              <label>Số comment tối đa trong 1 post</label>
              <input
                type="number"
                min={1}
                value={formData.countCommentFindData}
                onChange={e => setFormData(p => ({ ...p, countCommentFindData: Math.max(1, Number(e.target.value) || 1) }))}
                className="stepper-input"
              />
            </div>
          </div>
          {usesFindDataCommentContentConditions && renderFindDataCommentContentConditions()}
        </div>
      )}

      {formData.isFindInGroupMembers && (
        <div className="extra-comment-options">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Thành viên group mới</div>
          <div className="stepper-form-group">
            <label>Lấy danh sách thành viên tối đa</label>
            <input
              type="number"
              min={1}
              value={formData.countGroupMemberFindData}
              onChange={e => setFormData(p => ({ ...p, countGroupMemberFindData: Math.max(1, Number(e.target.value) || 1) }))}
              className="stepper-input"
            />
          </div>
        </div>
      )}

      {usesFindDataSearchGroup && (
        <div className="extra-comment-options">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Group Facebook</div>
          <div className="stepper-form-row">
            <div className="stepper-form-group third">
              <label>Số group tối đa / từ khóa</label>
              <input
                type="number"
                min={1}
                value={formData.countSearchGroupFindData}
                onChange={e => setFormData(p => ({ ...p, countSearchGroupFindData: Math.max(1, Number(e.target.value) || 1) }))}
                className="stepper-input"
              />
            </div>
            <div className="stepper-form-group third">
              <label>Số lượng thành viên tối thiểu</label>
              <input
                type="number"
                min={0}
                value={formData.minSearchGroupMembers}
                onChange={e => setFormData(p => ({ ...p, minSearchGroupMembers: Math.max(0, Number(e.target.value) || 0) }))}
                className="stepper-input"
              />
            </div>
            <div className="stepper-form-group third">
              <label>Số bài đăng tối thiểu/ngày</label>
              <input
                type="number"
                min={0}
                value={formData.minSearchGroupPostsPerDay}
                onChange={e => setFormData(p => ({ ...p, minSearchGroupPostsPerDay: Math.max(0, Number(e.target.value) || 0) }))}
                className="stepper-input"
              />
            </div>
          </div>
          <div className="stepper-form-group">
            <label>Tỉnh/Thành phố</label>
            <input
              type="text"
              value={formData.searchGroupCity}
              onChange={e => setFormData(p => ({ ...p, searchGroupCity: e.target.value }))}
              className="stepper-input"
              placeholder="Ví dụ: Hà Nội, Hồ Chí Minh"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={formData.searchGroupNearMe}
                onChange={e => setFormData(p => ({ ...p, searchGroupNearMe: e.target.checked }))}
              />
              <span>Gần tôi</span>
            </label>
            <label className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={formData.searchGroupPublicOnly}
                onChange={e => setFormData(p => ({ ...p, searchGroupPublicOnly: e.target.checked }))}
              />
              <span>Nhóm công khai</span>
            </label>
            <label className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={formData.searchGroupMineOnly}
                onChange={e => setFormData(p => ({ ...p, searchGroupMineOnly: e.target.checked }))}
              />
              <span>Nhóm của tôi</span>
            </label>
          </div>
        </div>
      )}

    </div>
  )

  const renderPostBumpSettings = () => (
    <div className="extra-comment-options">
      <div className="stepper-form-row">
        <div className="stepper-form-group third">
          <label>Số tin up tối đa 1 post</label>
          <input
            type="number"
            min={1}
            max={10}
            value={formData.postBumpCount}
            onChange={e => setFormData(p => ({ ...p, postBumpCount: clampPostBumpCount(e.target.value) }))}
            className="stepper-input"
          />
        </div>
        <div className="stepper-form-group third">
          <label>Up tin sau khi đăng thành công (phút)</label>
          <input
            type="number"
            min={0}
            value={formData.postBumpInitialDelayMinutes}
            onChange={e => setFormData(p => ({
              ...p,
              postBumpInitialDelayMinutes: normalizeMinuteValue(e.target.value, DEFAULT_POST_BUMP_INITIAL_DELAY_MINUTES, 0)
            }))}
            className="stepper-input"
          />
        </div>
        <div className="stepper-form-group third">
          <label>Khoảng cách mỗi lần up (phút)</label>
          <input
            type="number"
            min={1}
            value={formData.postBumpIntervalMinutes}
            onChange={e => setFormData(p => ({
              ...p,
              postBumpIntervalMinutes: normalizeMinuteValue(e.target.value, DEFAULT_POST_BUMP_INTERVAL_MINUTES, 1)
            }))}
            className="stepper-input"
          />
        </div>
      </div>

      <div className="stepper-form-group">
        <label>Chiến dịch up tin</label>
        <div className="schedule-radio-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <label className="schedule-radio-label">
            <input
              type="radio"
              name="postBumpMode"
              value="create"
              checked={formData.postBumpMode === 'create'}
              onChange={() => setFormData(p => ({ ...p, postBumpMode: 'create' }))}
            />
            <span>Tạo mới</span>
          </label>
          <label className="schedule-radio-label">
            <input
              type="radio"
              name="postBumpMode"
              value="select"
              checked={formData.postBumpMode === 'select'}
              onChange={() => setFormData(p => ({ ...p, postBumpMode: 'select' }))}
            />
            <span>Chọn chiến dịch</span>
          </label>
        </div>
      </div>

      {formData.postBumpMode === 'select' ? (
        <div className="stepper-form-group">
          <label>Chọn chiến dịch comment vào bài post</label>
          {postLinkCommentCampaignOptions.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 13 }}>
              Chưa có chiến dịch Comment seeding vào danh sách bài post.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
              {postLinkCommentCampaignOptions.map(target => (
                <label key={target.id} className="schedule-checkbox-label" title={target.name}>
                  <input
                    type="checkbox"
                    checked={(formData.postBumpTargetCampaignIds || []).includes(target.id)}
                    onChange={() => togglePostBumpTargetCampaign(target.id)}
                  />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {target.name} <span style={{ color: 'var(--text-tertiary)' }}>({target.status})</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="stepper-form-group">
            <label>Chọn tài khoản tạo chiến dịch up tin</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
              {accounts.map(account => (
                <label key={account.id} className="schedule-checkbox-label" title={account.name}>
                  <input
                    type="checkbox"
                    checked={(formData.postBumpAccountIds || []).includes(account.id)}
                    onChange={() => togglePostBumpAccount(account.id)}
                  />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {account.name} <span style={{ color: 'var(--text-tertiary)' }}>({account.flatformType})</span>
                  </span>
                </label>
              ))}
              {accounts.length === 0 && (
                <div className="text-muted" style={{ fontSize: 13 }}>Chưa có tài khoản nào.</div>
              )}
            </div>
          </div>
          <div className="stepper-form-group">
            <label>Nội dung up tin</label>
            {renderContentToolsRow('postBumpContent')}
            <textarea
              className="stepper-textarea"
              value={formData.postBumpContent}
              onChange={e => setFormData(p => ({ ...p, postBumpContent: e.target.value }))}
              rows={4}
              placeholder="Nhập nội dung comment up tin. Dùng dấu | để tách nhiều nội dung."
            />
          </div>
        </>
      )}
    </div>
  )

  const renderActionLimitCard = (actionCode: string) => {
    const limit = formData.actionLimitsByCode[actionCode] || toActionLimitForm(undefined, {
      dailyLimit: formData.dailyLimit,
      rateLimitCount: formData.rateLimitCount,
      rateLimitMinutes: formData.rateLimitMinutes
    })

    return (
      <div className="action-limit-card" key={actionCode}>
        <div className="action-limit-card-header">
          <strong>Giới hạn {getActionCodeLabel(actionCode)}</strong>
          <span>{actionCode}</span>
        </div>
        <div className="stepper-form-row">
          <div className="stepper-form-group third">
            <label>Giới hạn trong ngày (đến 24h)</label>
            <input
              type="number"
              value={limit.dailyLimit}
              onChange={e => updateActionLimit(actionCode, 'dailyLimit', parseInt(e.target.value) || 0)}
              className="stepper-input"
            />
          </div>
          <div className="stepper-form-group third">
            <label>Giới hạn trong giờ ({rateLimitMinutesLabel} phút)</label>
            <input
              type="number"
              value={limit.rateLimitCount}
              onChange={e => updateActionLimit(actionCode, 'rateLimitCount', parseInt(e.target.value) || 0)}
              className="stepper-input"
            />
          </div>
        </div>
      </div>
    )
  }

  const renderGroupPostCommentSettings = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.enableComment}
            onChange={e => setFormData(p => ({ ...p, enableComment: e.target.checked }))}
          />
          <span>Kiêm comment</span>
        </label>
      </div>

      {showGroupPostCommentLimit && renderActionLimitCard('fb_comment')}

      {formData.enableComment && (
        <div className="extra-comment-options">
          <div className="stepper-form-group">
            <label>Comment vào group nào</label>
            <div className="schedule-radio-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name="commentGroupMode"
                  value="all"
                  checked={formData.commentGroupMode === 'all'}
                  onChange={() => setFormData(p => ({ ...p, commentGroupMode: 'all' }))}
                />
                <span>Comment vào mọi group</span>
              </label>
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name="commentGroupMode"
                  value="pending_only"
                  checked={formData.commentGroupMode === 'pending_only'}
                  onChange={() => setFormData(p => ({ ...p, commentGroupMode: 'pending_only' }))}
                />
                <span>Chỉ comment vào group bị duyệt đăng bài</span>
              </label>
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name="commentGroupMode"
                  value="published_only"
                  checked={formData.commentGroupMode === 'published_only'}
                  onChange={() => setFormData(p => ({ ...p, commentGroupMode: 'published_only' }))}
                />
                <span>Chỉ comment vào group đăng bài thành công ngay</span>
              </label>
            </div>
          </div>

          <div className="stepper-form-group">
            <label>Comment vào post nào</label>
            <div className="schedule-radio-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name="commentType"
                  value="own"
                  checked={formData.commentType === 'own'}
                  onChange={() => setFormData(p => ({ ...p, commentType: 'own' }))}
                />
                <span>Comment vào post của mình</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <label className="schedule-radio-label">
                  <input
                    type="radio"
                    name="commentType"
                    value="others"
                    checked={formData.commentType === 'others'}
                    onChange={() => setFormData(p => ({ ...p, commentType: 'others' }))}
                  />
                  <span>Không comment vào post của mình</span>
                </label>
                <div style={{ marginLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>Số comment tối đa</label>
                  <input
                    type="number"
                    min={1}
                    value={formData.commentCount}
                    onChange={e => setFormData(p => ({ ...p, commentCount: Number(e.target.value) }))}
                    className="stepper-input"
                    style={{ width: 120 }}
                    disabled={formData.commentType !== 'others'}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <label className="schedule-radio-label">
                  <input
                    type="radio"
                    name="commentType"
                    value="all"
                    checked={formData.commentType === 'all'}
                    onChange={() => setFormData(p => ({ ...p, commentType: 'all' }))}
                  />
                  <span>Comment tất cả</span>
                </label>
                <div style={{ marginLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>Số comment tối đa</label>
                  <input
                    type="number"
                    min={1}
                    value={formData.commentCount}
                    onChange={e => setFormData(p => ({ ...p, commentCount: Number(e.target.value) }))}
                    className="stepper-input"
                    style={{ width: 120 }}
                    disabled={formData.commentType !== 'all'}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="stepper-form-group">
            <label>Nội dung comment</label>
            {renderContentToolsRow('commentContent')}
            <textarea
              className="stepper-textarea"
              placeholder="Nhập nội dung comment. Dùng dấu | để tách nhiều nội dung — comment 1 dùng nội dung 1, comment 2 dùng nội dung 2..."
              value={formData.commentContent}
              onChange={e => setFormData(p => ({ ...p, commentContent: e.target.value }))}
              rows={4}
            />
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
              Mẹo: tách nhiều nội dung bằng dấu <code>|</code> — comment thứ K trong group dùng nội dung thứ K (lặp lại từ đầu khi hết biến thể).
            </div>
          </div>

          {renderImagePicker('comment', 'Ảnh comment')}
        </div>
      )}
    </div>
  )

  const renderGroupPostBumpSettings = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.enablePostBump}
            onChange={e => setFormData(p => ({ ...p, enablePostBump: e.target.checked }))}
          />
          <span>Kiêm up tin</span>
        </label>
      </div>

      {formData.enablePostBump && renderPostBumpSettings()}
    </div>
  )

  const renderCampaignContentHint = () => (
    <div className="campaign-content-hint">
      Mẹo: tách nhiều nội dung bằng dấu <code>|</code> — nội dung thứ N sẽ đăng ở group/tin nhắn thứ N (lặp lại từ đầu khi hết biến thể).
    </div>
  )

  const renderRewriteContentEachRunOption = () => (
    <label className="schedule-checkbox-label campaign-rewrite-run-toggle">
      <input
        type="checkbox"
        checked={formData.rewriteContentEachRun}
        onChange={e => setFormData(p => ({ ...p, rewriteContentEachRun: e.target.checked }))}
      />
      <span>Viết nội dung cho mỗi lượt chạy</span>
    </label>
  )

  const setPostBackgroundEnabled = (checked: boolean) => {
    setFormData(p => ({
      ...p,
      postWithBackground: checked
    }))
  }

  const renderPostBackgroundOption = () => {
    if (!isPostBackgroundCampaign) return null

    return (
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={isPostBackgroundActive}
            disabled={isPostBackgroundDisabled}
            onChange={e => setPostBackgroundEnabled(e.target.checked)}
          />
          <span>Đăng bài với phông nền <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(tối đa 130 ký tự, 3 dòng và KHÔNG đăng ảnh)</em></span>
        </label>
        {isPostBackgroundApiModeDisabled && (
          <div className="schedule-hint" style={{ marginTop: 6 }}>
            Tùy chọn này chỉ áp dụng khi đăng bài trên giao diện.
          </div>
        )}
        {isPostBackgroundSourceDisabled && (
          <div className="schedule-hint" style={{ marginTop: 6 }}>
            Tùy chọn này không áp dụng khi đang dùng nguồn nội dung.
          </div>
        )}
      </div>
    )
  }

  const renderMultiDailyTimeSlotsSection = () => {
    if (!isMultiDailyTimeSlotsCampaign) return null

    return (
      <div className="schedule-multi-window-panel">
        <div className="schedule-multi-window-header">
          <span>Cài đặt chạy nhiều khung giờ trong 1 ngày</span>
        </div>
        <div className="schedule-multi-window-body">
          <label className="schedule-checkbox-label schedule-multi-window-checkbox">
            <input
              type="checkbox"
              checked={formData.multiDailyTimeSlotsEnabled}
              onChange={e => setFormData(p => ({ ...p, multiDailyTimeSlotsEnabled: e.target.checked }))}
            />
            <span>Chạy trong nhiều khung giờ trong 1 ngày</span>
          </label>
          <input
            type="text"
            className="stepper-input schedule-multi-window-input"
            placeholder="hh:mm, hh:mm,..."
            value={formData.multiDailyTimeSlots}
            onChange={e => setFormData(p => ({ ...p, multiDailyTimeSlots: e.target.value }))}
            disabled={!formData.multiDailyTimeSlotsEnabled}
          />
          <div className="schedule-multi-window-notes">
            <div>- Chiến dịch chỉ được kích hoạt chạy khung giờ này khi chiến dịch đã chạy ở khung giờ trước (hoặc chính) là hoàn thành (Đã chạy hết toàn bộ data)</div>
            <div>- Chiến dịch chỉ chạy những data có trạng thái là chờ xử lý</div>
            <div>- Cách viết: hh:mm, hh:mm,... mỗi khung giờ cách nhau bởi dấu phẩy, hh: giờ, mm: phút</div>
          </div>
        </div>
      </div>
    )
  }

  const renderRewriteCommentContentEachRunOption = () => (
    <label className="schedule-checkbox-label campaign-rewrite-run-toggle">
      <input
        type="checkbox"
        checked={formData.rewriteCommentContentEachRun}
        onChange={e => setFormData(p => ({ ...p, rewriteCommentContentEachRun: e.target.checked }))}
      />
      <span>Viết nội dung comment cho mỗi lượt chạy</span>
    </label>
  )

  const renderCampaignContentTextarea = (showHint = true) => (
    <>
      <textarea
        ref={campaignContentTextareaRef}
        className={`stepper-textarea ${isMessageCampaign ? 'message-content-textarea' : ''}`}
        placeholder={supportsSourceContent && formData.copyContentFromSource
          ? "Nội dung nhập ở đây sẽ được nối sau nội dung copy từ nguồn (ngăn bằng dòng mới)..."
          : isMessageCampaign
            ? "Nhập nội dung tin nhắn. Dùng dấu | để tách nhiều nội dung — nội dung 1 chạy ở mục tiêu 1, nội dung 2 ở mục tiêu 2..."
            : "Nhập nội dung chiến dịch ở đây. Dùng dấu | để tách nhiều nội dung — nội dung 1 chạy ở mục tiêu 1, nội dung 2 ở mục tiêu 2..."}
        value={formData.content}
        onChange={e => setFormData(p => ({ ...p, content: e.target.value }))}
        rows={8}
      />
      {showHint && renderCampaignContentHint()}
      {showHint && renderRewriteContentEachRunOption()}
    </>
  )

  const renderCommentSeedingSettings = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="stepper-form-group">
        <label>Nội dung comment <span className="required">*</span></label>
        {renderContentToolsRow('commentContent')}
        <textarea
          className="stepper-textarea"
          placeholder="Nhập nội dung comment. Dùng dấu | để tách nhiều nội dung, hệ thống sẽ xoay vòng theo từng lần comment."
          value={formData.commentContent}
          onChange={e => setFormData(p => ({ ...p, commentContent: e.target.value }))}
          rows={6}
        />
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
          Mẹo: tách nhiều nội dung bằng dấu <code>|</code> để tránh lặp cùng một comment.
        </div>
        {renderRewriteCommentContentEachRunOption()}
      </div>

      {renderImagePicker('comment', 'Ảnh comment')}

    </div>
  )

  const renderCampaignPickerModal = () => {
    if (!campaignPickerModal) return null

    const rows = getCampaignPickerRows(campaignPickerModal.source)
    const searchQuery = campaignPickerModal.searchQuery.trim().toLowerCase()
    const filteredRows = searchQuery
      ? rows.filter(row => row.searchText.includes(searchQuery))
      : rows
    const loading = isCampaignPickerLoading(campaignPickerModal.source)
    const colSpan = campaignPickerModal.columns.length + 1
    const canAddInternalCampaign = !draftMode &&
      campaignPickerModal.source.type !== 'external' &&
      !!getDraftActionIdForPickerSource(campaignPickerModal.source)

    const renderCell = (row: CampaignPickerRow, column: CampaignPickerColumn) => {
      if (column === 'name') return <span className="campaign-picker-table-name">{row.name}</span>
      if (column === 'account') return row.accountName || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'status') return row.status || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'schedule') return row.scheduleLabel
        ? <span className="campaign-picker-table-schedule">{row.scheduleLabel}</span>
        : <span className="campaign-picker-muted">Chưa có</span>
      if (column === 'dataTypes') return renderTextList(row.dataTypes)
      return renderTextList(row.sourceTypes)
    }

    const columnLabels: Record<CampaignPickerColumn, string> = {
      name: 'Tên chiến dịch',
      account: campaignPickerModal.source.type === 'external' ? 'Tài khoản/Shop' : 'Tài khoản',
      status: 'Trạng thái',
      schedule: 'Lịch chạy',
      dataTypes: 'Data tìm',
      sourceTypes: 'Nguồn tìm'
    }

    return (
      <div className="modal-overlay campaign-picker-modal-overlay" style={{ zIndex: 3000 }}>
        <div className="campaign-picker-modal">
          <div className="modal-header">
            <span className="modal-title">{campaignPickerModal.title}</span>
            <button type="button" className="btn-icon" onClick={cancelCampaignPicker}>
              <X size={18} />
            </button>
          </div>
          <div className="campaign-picker-modal-body">
            <div className="campaign-picker-toolbar">
              <input
                type="text"
                className="stepper-input campaign-picker-search-input"
                placeholder="Tìm theo tên chiến dịch, tài khoản, trạng thái hoặc lịch chạy..."
                value={campaignPickerModal.searchQuery}
                onChange={e => setCampaignPickerModal(prev => prev ? { ...prev, searchQuery: e.target.value } : prev)}
              />
              <div className="campaign-picker-toolbar-actions">
                {canAddInternalCampaign && (
                  <button type="button" className="btn btn-secondary campaign-picker-add-button" onClick={() => openDraftCampaignForm(campaignPickerModal.source)}>
                    <Plus size={16} /> Thêm chiến dịch
                  </button>
                )}
                <button type="button" className="btn-icon" onClick={() => void refreshCampaignPicker()} disabled={campaignPickerRefreshing} title="Load lại danh sách">
                  <RefreshCw size={15} className={campaignPickerRefreshing ? 'spin' : ''} />
                </button>
              </div>
            </div>
            <div className="campaign-picker-table-wrap">
              <table className="campaign-picker-table">
                <thead>
                  <tr>
                    <th className="campaign-picker-check-col">Chọn</th>
                    {campaignPickerModal.columns.map(column => (
                      <th key={column}>{columnLabels[column]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={colSpan} className="campaign-picker-empty-cell">Đang tải chiến dịch...</td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={colSpan} className="campaign-picker-empty-cell">{campaignPickerModal.emptyText}</td>
                    </tr>
                  ) : (
                    filteredRows.map(row => (
                      <tr
                        key={row.id}
                        className={campaignPickerModal.draftIds.includes(row.id) ? 'selected' : ''}
                        onClick={() => toggleCampaignPickerDraftId(row.id)}
                      >
                        <td className="campaign-picker-check-col">
                          <input
                            type="checkbox"
                            checked={campaignPickerModal.draftIds.includes(row.id)}
                            onChange={() => toggleCampaignPickerDraftId(row.id)}
                            onClick={event => event.stopPropagation()}
                          />
                        </td>
                        {campaignPickerModal.columns.map(column => (
                          <td key={column}>{renderCell(row, column)}</td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancelCampaignPicker}>Huỷ</button>
            <button type="button" className="btn btn-primary btn-sm campaign-picker-confirm-button" onClick={confirmCampaignPicker}>
              Chọn {campaignPickerModal.draftIds.length > 0 ? `(${campaignPickerModal.draftIds.length})` : ''}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderContentTemplatePickerModal = () => {
    if (!contentTemplatePicker) return null
    const query = contentTemplatePicker.searchQuery.trim().toLowerCase()
    const filteredTemplates = query
      ? contentTemplates.filter(template => `${template.name}\n${template.content}`.toLowerCase().includes(query))
      : contentTemplates

    return (
      <div className="modal-overlay campaign-picker-modal-overlay" style={{ zIndex: 3100 }}>
        <div className="content-template-picker-modal">
          <div className="modal-header">
            <span className="modal-title">{contentTemplatePicker.title}</span>
            <button type="button" className="btn-icon" onClick={() => setContentTemplatePicker(null)}>
              <X size={18} />
            </button>
          </div>
          <div className="content-template-picker-body">
            <div className="content-template-picker-search">
              <Search size={15} />
              <input
                value={contentTemplatePicker.searchQuery}
                onChange={event => setContentTemplatePicker(prev => prev ? { ...prev, searchQuery: event.target.value } : prev)}
                placeholder="Tìm mẫu nội dung"
              />
              <button type="button" className="btn-icon" onClick={() => void loadContentTemplates()} disabled={contentTemplatesLoading} title="Load lại danh sách">
                <RefreshCw size={15} className={contentTemplatesLoading ? 'spin' : ''} />
              </button>
            </div>
            <div className="content-template-picker-list">
              {contentTemplatesLoading ? (
                <div className="content-template-picker-empty">Đang tải mẫu nội dung...</div>
              ) : filteredTemplates.length === 0 ? (
                <div className="content-template-picker-empty">Chưa có mẫu nội dung.</div>
              ) : filteredTemplates.map(template => (
                <button
                  key={template.id}
                  type="button"
                  className="content-template-picker-item"
                  onClick={() => applyContentTemplate(template)}
                >
                  <span>{template.name}</span>
                  <p>{template.content}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContentTemplatePicker(null)}>Huỷ</button>
          </div>
        </div>
      </div>
    )
  }

  const renderContentTemplateSaveModal = () => {
    if (!contentTemplateSaveModal) return null
    return (
      <div className="modal-overlay campaign-picker-modal-overlay" style={{ zIndex: 3100 }}>
        <div className="content-template-save-modal">
          <div className="modal-header">
            <span className="modal-title">Lưu mẫu cho {CONTENT_TEMPLATE_TARGET_LABELS[contentTemplateSaveModal.target]}</span>
            <button type="button" className="btn-icon" onClick={() => setContentTemplateSaveModal(null)} disabled={contentTemplateSaving}>
              <X size={18} />
            </button>
          </div>
          <div className="content-template-save-body">
            <div className="stepper-form-group">
              <label>Tên mẫu</label>
              <input
                className="stepper-input"
                value={contentTemplateSaveModal.name}
                onChange={event => setContentTemplateSaveModal(prev => prev ? { ...prev, name: event.target.value } : prev)}
                placeholder="Nhập tên mẫu nội dung"
                disabled={contentTemplateSaving}
              />
            </div>
            <div className="stepper-form-group">
              <label>Nội dung mẫu</label>
              <textarea
                className="stepper-textarea content-template-save-textarea"
                value={contentTemplateSaveModal.content}
                onChange={event => setContentTemplateSaveModal(prev => prev ? { ...prev, content: event.target.value } : prev)}
                rows={6}
                disabled={contentTemplateSaving}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContentTemplateSaveModal(null)} disabled={contentTemplateSaving}>Huỷ</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={saveCurrentContentTemplate} disabled={contentTemplateSaving}>
              {contentTemplateSaving ? 'Đang lưu...' : 'Lưu mẫu'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" style={modalZIndex ? { zIndex: modalZIndex } : undefined}>
      <div className="campaign-full-modal stepper-modal">
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">
            {draftMode ? 'Thêm chiến dịch' : campaign && campaign.id ? 'Sửa chiến dịch' : campaign ? 'Nhân bản chiến dịch' : 'Thêm chiến dịch'}
          </span>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Stepper Layout */}
        <div className="stepper-layout">
          {/* Left Sidebar - Stepper Navigation */}
          <div className="stepper-sidebar">
            {STEPS.map((step, stepIndex) => {
              const { completed, total } = getStepCompletion(step)
              const isComplete = completed === total
              const isActive = activeStep === step.id

              return (
                <div
                  key={step.id}
                  className={`stepper-step ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}
                  onClick={() => scrollToSection(step.id)}
                >
                  <div className="stepper-step-header">
                    <div className={`stepper-number ${isComplete ? 'complete' : ''}`}>
                      {isComplete ? <Check size={14} /> : stepIndex + 1}
                    </div>
                    <span className="stepper-step-title">{step.title}</span>
                    <span className="stepper-step-count">{completed} / {total}</span>
                  </div>
                  <div className="stepper-step-fields">
                    {step.fields.map(field => (
                      <div key={field.key} className="stepper-field-item">
                        <div className={`stepper-field-dot ${isFieldComplete(field.key) ? 'complete' : ''}`} />
                        <span className="stepper-field-label">{field.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Right Content */}
          <div className="stepper-content" ref={contentRef}>
            {/* Section 1: Cài đặt chung */}
            <div
              className="stepper-section"
              ref={el => { sectionRefs.current['general'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('general')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">{getSectionNumber('general')}</span>
                  <span className="stepper-section-title">Cài đặt chung</span>
                </div>
                {collapsedSections['general'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['general'] && (
                <div className="stepper-section-body">
                  <div className="stepper-form-group">
                    <label>Chiến dịch <span className="required">*</span></label>
                    <select
                      value={formData.actionId}
                      onChange={e => setFormData(p => ({ ...p, actionId: e.target.value }))}
                      className="stepper-input"
                      disabled={draftMode && !!lockedActionId}
                    >
                      <option value="">-- Chọn hành động --</option>
                      {campaignActions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>

                  <div className="stepper-form-group" ref={accountDropdownRef}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ margin: 0 }}>Tài khoản <span className="required">*</span></label>
                      {selectableAccounts.length > 0 && !(campaign && campaign.id) && !requiresSingleAccount && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '2px 8px', fontSize: '12px', height: 'auto' }}
                          onClick={() => {
                            const allSelected = selectableAccounts.length > 0 && formData.accountIds.length === selectableAccounts.length;
                            setFormData(p => ({
                              ...p,
                              accountIds: allSelected ? [] : selectableAccounts.map(a => a.id)
                            }));
                          }}
                        >
                          {formData.accountIds.length === selectableAccounts.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                        </button>
                      )}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <div
                        className="stepper-input"
                        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: isAccountDropdownOpen ? 'var(--bg-secondary)' : 'var(--bg-primary)' }}
                        onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                      >
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
                          {formData.accountIds.length === 0
                            ? '-- Chọn tài khoản --'
                            : formData.accountIds.length === 1
                              ? accounts.find(a => a.id === formData.accountIds[0])?.name || 'Đã chọn 1 tài khoản'
                              : `Đã chọn ${formData.accountIds.length} tài khoản`}
                        </span>
                        <ChevronDown size={16} style={{ flexShrink: 0, transform: isAccountDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>

                      {isAccountDropdownOpen && (
                        <div className="account-select-menu">
                          <div className="account-checkbox-list">
                            {selectableAccounts.map(a => (
                              <label key={a.id} className="account-checkbox-option">
                                <input
                                  type={(campaign && campaign.id) || requiresSingleAccount ? "radio" : "checkbox"}
                                  name={(campaign && campaign.id) || requiresSingleAccount ? "account-selection" : undefined}
                                  checked={formData.accountIds.includes(a.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    if ((campaign && campaign.id) || requiresSingleAccount) {
                                      setFormData(p => ({
                                        ...p,
                                        accountIds: [a.id]
                                      }))
                                      setIsAccountDropdownOpen(false) // auto close if it is a radio select
                                    } else {
                                      setFormData(p => ({
                                        ...p,
                                        accountIds: checked
                                          ? [...p.accountIds, a.id]
                                          : p.accountIds.filter(id => id !== a.id)
                                      }))
                                    }
                                  }}
                                />
                                <span title={`${a.name} (${a.flatformType})`}>
                                  {a.name} ({a.flatformType}){a.accountGroupName ? ` - ${a.accountGroupName}` : ''}
                                </span>
                              </label>
                            ))}
                            {selectableAccounts.length === 0 && (
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '8px 0' }}>
                                {selectedActionPlatform ? 'Chưa có tài khoản phù hợp với nền tảng chiến dịch' : 'Chưa có tài khoản nào'}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="stepper-form-group">
                    <label>Tên chiến dịch <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                      className="stepper-input"
                      placeholder="Nhập tên chiến dịch..."
                    />
                  </div>


                </div>
              )}
            </div>

            {hasSelectedCampaignAction && (
              <>
            {showActionOptionsSection && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['actionOptions'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('actionOptions')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('actionOptions')}</span>
                    <span className="stepper-section-title">Tuỳ chọn hành động</span>
                  </div>
                  {collapsedSections['actionOptions'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['actionOptions'] && (
                  <div className="stepper-section-body">
                    {isZaloMessagePhoneCampaign
                      ? renderZaloMessagePhoneActionOptions()
                      : renderMessageUidActionOptions()}
                  </div>
                )}
              </div>
            )}

            {isFindDataCampaign && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['content'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('content')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('content')}</span>
                    <span className="stepper-section-title">Cấu hình tìm kiếm</span>
                  </div>
                  {collapsedSections['content'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['content'] && (
                  <div className="stepper-section-body">
                    {renderFindDataSearchConfig()}
                  </div>
                )}
              </div>
            )}

            {showFoundDataHandlingSection && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['foundDataHandling'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('foundDataHandling')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('foundDataHandling')}</span>
                    <span className="stepper-section-title">Xử lý data tìm được</span>
                  </div>
                  {collapsedSections['foundDataHandling'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['foundDataHandling'] && (
                  <div className="stepper-section-body">
                    {renderFoundDataHandling()}
                  </div>
                )}
              </div>
            )}

            {showFindDataConditionsSection && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['findDataConditions'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('findDataConditions')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('findDataConditions')}</span>
                    <span className="stepper-section-title">Điều kiện chạy</span>
                  </div>
                  {collapsedSections['findDataConditions'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['findDataConditions'] && (
                  <div className="stepper-section-body">
                    {renderFindDataConditions()}
                  </div>
                )}
              </div>
            )}

            {isNewsfeedInteractionCampaign && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['newsfeedSettings'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('newsfeedSettings')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('newsfeedSettings')}</span>
                    <span className="stepper-section-title">Lướt newsfeed</span>
                  </div>
                  {collapsedSections['newsfeedSettings'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['newsfeedSettings'] && (
                  <div className="stepper-section-body">
                    {renderNewsfeedInteractionSettings()}
                  </div>
                )}
              </div>
            )}

            {/* Section 2: Lịch chạy */}
            <div
              className="stepper-section"
              ref={el => { sectionRefs.current['schedule'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('schedule')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">{getSectionNumber('schedule')}</span>
                  <span className="stepper-section-title">Lịch chạy</span>
                </div>
                {collapsedSections['schedule'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['schedule'] && (
                <div className="stepper-section-body">
                  {/* Schedule Type */}
                  <div className="stepper-form-group">
                    <label>Lịch</label>
                    <div className="schedule-radio-group">
                      {([['daily', 'Hàng ngày'], ['weekly', 'Theo tuần'], ['monthly', 'Theo tháng']] as const).map(([value, label]) => (
                        <label key={value} className="schedule-radio-label">
                          <input
                            type="radio"
                            name="scheduleType"
                            value={value}
                            checked={formData.scheduleType === value}
                            onChange={() => setFormData(p => ({ ...p, scheduleType: value }))}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Start date / End date */}
                  <div className="stepper-form-row schedule-run-row">
                    <div className="stepper-form-group schedule-time-field">
                      <label>Giờ chạy</label>
                      <input
                        type="time"
                        value={getDateTimeLocalTime(formData.schedule)}
                        onChange={e => setFormData(p => ({ ...p, schedule: setDateTimeLocalTime(p.schedule, e.target.value) }))}
                        className="stepper-input"
                      />
                    </div>
                    <div className="stepper-form-group schedule-date-field">
                      <label>Ngày chạy</label>
                      <input
                        type="date"
                        value={getDateTimeLocalDate(formData.schedule)}
                        onChange={e => setFormData(p => ({ ...p, schedule: setDateTimeLocalDate(p.schedule, e.target.value) }))}
                        className="stepper-input"
                      />
                    </div>
                    {formData.scheduleType !== 'daily' && (
                      <div className="stepper-form-group schedule-end-date-field">
                        <label>Ngày kết thúc</label>
                        <input
                          type="date"
                          value={formData.scheduleEndDate}
                          onChange={e => setFormData(p => ({ ...p, scheduleEndDate: e.target.value }))}
                          className="stepper-input"
                        />
                      </div>
                    )}
                    {formData.scheduleType === 'daily' && (
                      <div className="stepper-form-group schedule-end-date-field schedule-placeholder-field" aria-hidden="true" />
                    )}
                  </div>

                  {/* Monthly days */}
                  {formData.scheduleType === 'monthly' && (
                    <div className="stepper-form-group">
                      <label>Lịch tháng</label>
                      <input
                        type="text"
                        value={formData.scheduleDays}
                        onChange={e => setFormData(p => ({ ...p, scheduleDays: e.target.value }))}
                        className="stepper-input"
                        placeholder="Ví dụ: 5,10,19,25"
                      />
                      <span className="schedule-hint">Danh sách ngày chạy, các ngày cách nhau bởi dấu phẩy.</span>
                    </div>
                  )}

                  {/* Weekly days */}
                  {formData.scheduleType === 'weekly' && (
                    <div className="stepper-form-group">
                      <label>Lịch tuần</label>
                      <div className="schedule-weekday-group">
                        {WEEKDAYS.map(day => {
                          const selectedDays = formData.scheduleWeekDays ? formData.scheduleWeekDays.split(',') : []
                          return (
                            <label key={day.value} className="schedule-checkbox-label">
                              <input
                                type="checkbox"
                                checked={selectedDays.includes(day.value)}
                                onChange={() => toggleWeekDay(day.value)}
                              />
                              <span>{day.label}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Conditional checkbox based on schedule type */}
                  {formData.scheduleType === 'daily' && !isNewsfeedInteractionCampaign && (
                    <div className="stepper-form-group">
                      <label className="schedule-checkbox-label schedule-option-label">
                        <input
                          type="checkbox"
                          checked={formData.continueNextDay}
                          onChange={e => setFormData(p => ({ ...p, continueNextDay: e.target.checked }))}
                        />
                        <span>Nếu chưa chạy hết data do đạt giới hạn, 00h ngày hôm sau sẽ tiếp tục chạy. Nếu chạy hết data sẽ hoàn thành chiến dịch.</span>
                      </label>
                    </div>
                  )}

                  {(formData.scheduleType === 'weekly' || formData.scheduleType === 'monthly') && (
                    <div className="stepper-form-group">
                      <label className="schedule-checkbox-label schedule-option-label">
                        <input
                          type="checkbox"
                          checked={formData.refreshData}
                          onChange={e => setFormData(p => ({ ...p, refreshData: e.target.checked }))}
                        />
                        <span>Dữ liệu sẽ được làm mới lại khi chạy hết data <span className="schedule-hint-inline">(Mặc định là chạy hết sẽ hoàn thành chiến dịch)</span></span>
                      </label>
                    </div>
                  )}

                  <div className="stepper-form-group" style={{ maxWidth: 320 }}>
                    <label className="schedule-checkbox-label">
                      <input
                        type="checkbox"
                        checked={formData.useDailyStopTime}
                        onChange={e => setFormData(p => ({
                          ...p,
                          useDailyStopTime: e.target.checked,
                          dailyStopTime: p.dailyStopTime || DEFAULT_DAILY_STOP_TIME
                        }))}
                      />
                      <span>Giờ dừng chạy trong ngày</span>
                    </label>
                    <input
                      type="time"
                      value={formData.dailyStopTime}
                      onChange={e => setFormData(p => ({ ...p, dailyStopTime: e.target.value }))}
                      className="stepper-input"
                      disabled={!formData.useDailyStopTime}
                      title="Để trống nếu không giới hạn"
                    />
                  </div>

                  {isFindDataCampaign && (
                    <div className="stepper-form-group" style={{ maxWidth: 360 }}>
                      <label className="schedule-checkbox-label">
                        <input
                          type="checkbox"
                          checked={formData.findDataRerunEnabled}
                          onChange={e => setFormData(p => ({
                            ...p,
                            findDataRerunEnabled: e.target.checked,
                            findDataRerunAfterHours: normalizeHourValue(p.findDataRerunAfterHours)
                          }))}
                        />
                        <span>Chạy lại sau mỗi (giờ)</span>
                      </label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={formData.findDataRerunAfterHours}
                        onChange={e => setFormData(p => ({
                          ...p,
                          findDataRerunAfterHours: normalizeHourValue(e.target.value)
                        }))}
                        className="stepper-input"
                        disabled={!formData.findDataRerunEnabled}
                      />
                      <span className="schedule-hint">
                        Khi chạy hết data, chiến dịch sẽ hẹn chạy lại sau số giờ đã nhập nếu vẫn còn trong hôm nay.
                      </span>
                    </div>
                  )}

                  {renderMultiDailyTimeSlotsSection()}
                </div>
              )}
            </div>

            {/* Section 3: Giới hạn hành động */}
            <div
              className="stepper-section"
              ref={el => { sectionRefs.current['limits'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('limits')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">{getSectionNumber('limits')}</span>
                  <span className="stepper-section-title">Giới hạn hành động</span>
                </div>
                {collapsedSections['limits'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['limits'] && (
                <div className="stepper-section-body">
                  <div className="stepper-form-row">
                    <div className="stepper-form-group" style={{ maxWidth: 340 }}>
                      <label>Thời gian nghỉ giữa 2 lần gửi (giây)</label>
                      <input
                        type="number"
                        value={formData.sleepBetweenActions}
                        onChange={e => setFormData(p => ({ ...p, sleepBetweenActions: parseInt(e.target.value) || 0 }))}
                        className="stepper-input"
                      />
                    </div>
                  </div>
                  {selectedAccountGroupNames.length > 0 && (
                    <div className="account-group-campaign-note">
                      Các tài khoản thuộc nhóm: {selectedAccountGroupNames.join(', ')}. Khi chạy, hệ thống ưu tiên thời gian nghỉ và giới hạn đã cài trong nhóm.
                    </div>
                  )}
                  {generalLimitActionCodes.length === 0 ? (
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
                      {checkedLimitActionCodes.length === 0
                        ? 'Loại chiến dịch này không check giới hạn hành động trước khi chạy.'
                        : 'Một số giới hạn hành động đang dùng giá trị mặc định.'}
                    </div>
                  ) : (
                    <div className="action-limit-card-list">
                      {generalLimitActionCodes.map(actionCode => renderActionLimitCard(actionCode))}
                    </div>
                  )}
                  {isCommentSeedingFeedCampaign && (
                    <div className="stepper-form-group" style={{ maxWidth: 420, marginTop: 16 }}>
                      <label>Số bài cần comment trên mỗi group/page/profile</label>
                      <input
                        type="number"
                        min={1}
                        value={formData.postsPerTarget}
                        onChange={e => setFormData(p => ({ ...p, postsPerTarget: Math.max(1, Number(e.target.value) || 1) }))}
                        className="stepper-input"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {isCommentSeedingFeedCampaign && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['commentPostSearch'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('commentPostSearch')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('commentPostSearch')}</span>
                    <span className="stepper-section-title">Điều kiện tìm kiếm bài post</span>
                  </div>
                  {collapsedSections['commentPostSearch'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['commentPostSearch'] && (
                  <div className="stepper-section-body">
                    {renderFindDataPostContentConditions()}
                  </div>
                )}
              </div>
            )}

            {isPagePostCampaign && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['pagePostMethod'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('pagePostMethod')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('pagePostMethod')}</span>
                    <span className="stepper-section-title">Phương thức đăng</span>
                  </div>
                  {collapsedSections['pagePostMethod'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['pagePostMethod'] && (
                  <div className="stepper-section-body">
                    {renderPagePostMethodSettings()}
                  </div>
                )}
              </div>
            )}

            {supportsSourceContent && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['sourceContent'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('sourceContent')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('sourceContent')}</span>
                    <span className="stepper-section-title">Nguồn nội dung</span>
                  </div>
                  {collapsedSections['sourceContent'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['sourceContent'] && (
                  <div className="stepper-section-body">
                    {renderSourceContentSettings()}
                  </div>
                )}
              </div>
            )}

            {/* Section 4: Nội dung */}
            {showContentSection && <div
              className="stepper-section"
              ref={el => { sectionRefs.current['content'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('content')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">{getSectionNumber('content')}</span>
                  <span className="stepper-section-title">
                    {isMessageCampaign ? 'Nội dung tin nhắn' : 'Nội dung'}
                  </span>
                </div>
                {collapsedSections['content'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['content'] && (
                <div className="stepper-section-body">
                  {renderPostBackgroundOption()}
	                  {isCommentSeedingCampaign ? renderCommentSeedingSettings() : (
	                    <>
	                  {isMessageCampaign ? (
	                    <div className="campaign-message-content-layout">
                      <div className="stepper-form-group campaign-message-content-tools">
                        <label>Nội dung tin nhắn</label>
                        {renderContentToolsRow('content')}
                      </div>
                      <div className="campaign-content-template-layout">
                        <div className="stepper-form-group">
                          {renderCampaignContentTextarea(false)}
                        </div>
                        {renderMessageInsertPanel()}
                      </div>
                      {renderCampaignContentHint()}
                      {renderRewriteContentEachRunOption()}
                    </div>
                  ) : (
	                    <div className="stepper-form-group">
	                      <label>Nội dung chiến dịch</label>
	                      {renderContentToolsRow('content')}
	                      {renderCampaignContentTextarea()}
	                    </div>
	                  )}

	                  {renderImagePicker('post', 'Media')}
	                    </>
                  )}
                </div>
              )}
            </div>}

            {isFacebookGroupPostCampaign && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['groupComment'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('groupComment')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('groupComment')}</span>
                    <span className="stepper-section-title">Kiêm comment</span>
                  </div>
                  {collapsedSections['groupComment'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['groupComment'] && (
                  <div className="stepper-section-body">
                    {renderGroupPostCommentSettings()}
                  </div>
                )}
              </div>
            )}

            {isFacebookGroupPostCampaign && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['postBump'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('postBump')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('postBump')}</span>
                    <span className="stepper-section-title">Kiêm up tin</span>
                  </div>
                  {collapsedSections['postBump'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['postBump'] && (
                  <div className="stepper-section-body">
                    {renderGroupPostBumpSettings()}
                  </div>
                )}
              </div>
            )}

            {showExtraSection && <div
              className="stepper-section"
              ref={el => { sectionRefs.current['extra'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('extra')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">{getSectionNumber('extra')}</span>
                  <span className="stepper-section-title">Cài đặt thêm</span>
                </div>
                {collapsedSections['extra'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['extra'] && (
                <div className="stepper-section-body">
                  {isCommentSeedingCampaign && (
                    <div className="stepper-form-group">
                      <label className="schedule-checkbox-label">
                        <input
                          type="checkbox"
                          checked={formData.enablePostLike}
                          onChange={e => setFormData(p => ({ ...p, enablePostLike: e.target.checked }))}
                        />
                        <span>Like bài trước khi comment</span>
                      </label>
                    </div>
                  )}

                  {isFacebookGroupPostCampaign && (
                    <>
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.skipPostIfGroupRequiresApproval}
                            onChange={e => setFormData(p => ({ ...p, skipPostIfGroupRequiresApproval: e.target.checked }))}
                          />
                          <span>Không đăng bài vào group bị duyệt bài</span>
                        </label>
                      </div>

                      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.leaveGroupOnPendingApproval}
                            onChange={e => setFormData(p => ({ ...p, leaveGroupOnPendingApproval: e.target.checked }))}
                          />
                          <span>RỜI GROUP chờ duyệt bài đăng <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Nếu đã tham gia)</em></span>
                        </label>
                      </div>

                      {/* Auto join group after post */}
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.autoJoinGroupAfterPost}
                            onChange={e => setFormData(p => ({ ...p, autoJoinGroupAfterPost: e.target.checked }))}
                          />
                          <span>Tự động THAM GIA GROUP sau khi đăng bài thành công và không bị kiểm duyệt <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Nếu chưa tham gia)</em></span>
                        </label>
                      </div>

                      {/* Shuffle group list */}
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.shuffleGroupList}
                            onChange={e => setFormData(p => ({ ...p, shuffleGroupList: e.target.checked }))}
                          />
                          <span>XÁO TRỘN DANH SÁCH GROUP trước khi chạy chiến dịch <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Thay đổi thứ tự sắp xếp của danh sách group)</em></span>
                        </label>
                        <div className="schedule-hint" style={{ marginTop: 4, marginLeft: 24 }}>
                          Thay vì đăng tuần tự hoặc cố định vào 1 danh sách nhóm, hệ thống sẽ tự động trộn danh sách nhóm và chọn ngẫu nhiên để đăng. Cách này giúp nội dung phân tán tự nhiên hơn, tránh việc bị Facebook đánh giá là spam vì đăng quá dầy đặc vào cùng thời điểm và nhóm giống nhau.
                        </div>
                      </div>
                    </>
                  )}

                </div>
              )}
            </div>}


            {showFindDataSourceSection && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['findDataSources'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('findDataSources')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('findDataSources')}</span>
                    <span className="stepper-section-title">Nguồn chiến dịch tìm kiếm data</span>
                    {selectedFindDataSourceCampaignIds.length > 0 && (
                      <span className="stepper-section-badge">{selectedFindDataSourceCampaignIds.length}</span>
                    )}
                  </div>
                  {collapsedSections['findDataSources'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['findDataSources'] && (
                  <div className="stepper-section-body">
                    {renderFindDataSourceCampaignPicker()}
                  </div>
                )}
              </div>
            )}

            {/* Section 6: Danh sách data (hidden for simple campaigns) */}
            {!isSimpleCampaign && !hideDetailsSection && <div
              className="stepper-section"
              ref={el => { sectionRefs.current['details'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('details')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">{getSectionNumber('details')}</span>
                  <span className="stepper-section-title">
                    {isFindDataSearchCampaign
                      ? 'Danh sách từ khóa'
                      : isFindDataGroupCampaign
                        ? 'Danh sách group'
                      : isCommentSeedingPostCampaign
                        ? 'Danh sách bài post'
                        : isPagePostCampaign
                          ? 'Danh sách fanpage'
                          : isCommentSeedingCampaign
                            ? 'Danh sách group/page/profile'
                            : isMessageFriendCampaign
                              ? 'Danh sách bạn bè'
                              : isPageInboxMessageCampaign
                                ? 'Danh sách khách inbox Page'
                              : isZaloMessagePhoneCampaign
                                ? 'Danh sách SĐT'
                              : isMessageUidCampaign
                                ? 'Danh sách UID'
                                : 'Danh sách data'}
                  </span>
                  {details.length > 0 && (
                    <span className="stepper-section-badge">{details.length}</span>
                  )}
                </div>
                {collapsedSections['details'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['details'] && (
                <div className="stepper-section-body">
                  {isEditingSavedCampaign && (
                    <div className="text-muted" style={{ marginBottom: 12, fontSize: 12 }}>
                      Danh sách data đã lưu không chỉnh sửa trong form sửa chiến dịch.
                    </div>
                  )}
                  {!isEditingSavedCampaign && formData.accountIds.length > 1 && (
                    <div className="stepper-form-group" style={{ marginBottom: 12 }}>
                      <label className="schedule-checkbox-label" style={{ fontWeight: 500 }}>
                        <input
                          type="checkbox"
                          checked={formData.splitDataAcrossAccounts}
                          onChange={e => setFormData(p => ({ ...p, splitDataAcrossAccounts: e.target.checked }))}
                        />
                        <span>Chia đều data cho các tài khoản <span className="schedule-hint-inline" style={{ fontWeight: 'normal' }}>(Mặc định là tất cả tài khoản chung 1 data)</span></span>
                      </label>
                    </div>
                  )}
                  {!isEditingSavedCampaign && (
                    <div className="stepper-grid-toolbar" style={{ display: 'flex', gap: 8 }}>
                      {!isPagePostCampaign && !isPageInboxMessageCampaign && (
                        <button className="btn btn-secondary" onClick={addDetailRow}>
                          <Plus size={14} /> {isFindDataSearchCampaign ? 'Thêm từ khóa' : isCommentSeedingPostCampaign ? 'Thêm link' : 'Thêm data'}
                        </button>
                      )}
                      {canUploadData && (
                        <>
                          <button
                            className="btn btn-secondary"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Upload size={14} /> Upload Excel
                          </button>
                          {!isZaloMessagePhoneCampaign && (
                            <button
                              className="btn btn-secondary"
                              onClick={() => txtFileInputRef.current?.click()}
                            >
                              <Upload size={14} /> Upload TXT
                            </button>
                          )}
                        </>
                      )}
                      {canPickFriends && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (formData.accountIds.length === 0) {
                              showAlert('Vui lòng chọn tài khoản trước.', 'error')
                              return
                            }
                            setDataScanPicker({ action: 'facebook_friends', mode: 'friends' })
                          }}
                          title="Chọn bạn bè từ danh sách liên hệ"
                        >
                          <Users size={14} /> Chọn bạn bè
                        </button>
                      )}
                      {canPickUidData && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (formData.accountIds.length === 0) {
                              showAlert('Vui lòng chọn tài khoản trước.', 'error')
                              return
                            }
                            setDataScanPicker({
                              action: 'facebook_friends',
                              mode: 'users',
                              initialStatusFilter: 'all',
                              allowedActions: ['facebook_friends', 'facebook_post_commenters']
                            })
                          }}
                          title="Chọn data từ danh sách user Facebook"
                        >
                          <Users size={14} /> Chọn data
                        </button>
                      )}
                      {canPickPageInboxCustomers && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (formData.accountIds.length === 0) {
                              showAlert('Vui lòng chọn tài khoản trước.', 'error')
                              return
                            }
                            if (formData.accountIds.length !== 1) {
                              showAlert('Chiến dịch này chỉ hỗ trợ chọn 1 tài khoản.', 'error')
                              return
                            }
                            setDataScanPicker({
                              action: 'facebook_page_inbox_customers',
                              mode: 'pageInboxCustomers',
                              initialStatusFilter: 'all',
                              allowedActions: ['facebook_page_inbox_customers']
                            })
                          }}
                          title="Chọn khách từng inbox với Page từ dữ liệu local"
                        >
                          <Users size={14} /> Chọn khách inbox Page
                        </button>
                      )}
                      {canPickGroups && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (formData.accountIds.length === 0) {
                              showAlert('Vui lòng chọn tài khoản trước.', 'error')
                              return
                            }
                            setDataScanPicker({
                              action: 'facebook_groups',
                              mode: 'groups',
                              initialStatusFilter: 'all'
                            })
                          }}
                          title={isCommentSeedingFeedCampaign ? 'Chọn group để comment seeding' : 'Chọn group từ danh sách data'}
                        >
                          <Users size={14} /> Chọn nhóm
                        </button>
                      )}
                      {canPickPages && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (formData.accountIds.length === 0) {
                              showAlert('Vui lòng chọn tài khoản trước.', 'error')
                              return
                            }
                            setDataScanPicker({
                              action: 'facebook_pages',
                              mode: 'pages',
                              initialStatusFilter: 'all',
                              allowedActions: ['facebook_pages']
                            })
                          }}
                          title="Chọn page từ danh sách data"
                        >
                          <Users size={14} /> Chọn page
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={removeAllDetailRows}
                        disabled={loadingDetails || details.length === 0}
                        title="Xoá hết data trong danh sách"
                      >
                        <Trash2 size={14} /> Xoá hết
                      </button>
                      {canUploadData && (
                        <>
                          <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            accept={isZaloMessagePhoneCampaign ? '.xlsx,.xls' : '.xlsx, .xls, .csv'}
                            onChange={handleFileUpload}
                            title="Upload Excel"
                          />
                          {!isZaloMessagePhoneCampaign && (
                            <input
                              type="file"
                              ref={txtFileInputRef}
                              style={{ display: 'none' }}
                              accept=".txt"
                              onChange={handleTxtFileUpload}
                              title="Upload TXT"
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div className="stepper-grid-container">
                    <table className="campaign-grid">
                      <thead>
                        {isCommentSeedingPostCampaign || isFindDataSearchCampaign ? (
                          <tr>
                            <th>{isFindDataSearchCampaign ? 'Từ khóa' : 'Link bài post'}</th>
                            {!isEditingSavedCampaign && <th style={{ width: 40 }}></th>}
                          </tr>
                        ) : isPagePostCampaign ? (
                          <tr>
                            <th>Tên fanpage</th>
                            <th>Page ID</th>
                            <th>Link</th>
                            {!isEditingSavedCampaign && <th style={{ width: 40 }}></th>}
                          </tr>
                        ) : (
                          <tr>
                            <th>Tên</th>
                            <th>Số điện thoại</th>
                            <th>Uid</th>
                            <th>Email</th>
                            {!isEditingSavedCampaign && <th style={{ width: 40 }}></th>}
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {loadingDetails ? (
                          <tr><td colSpan={detailsColumnCount} className="text-center">Đang tải data...</td></tr>
                        ) : details.length === 0 ? (
                          <tr><td colSpan={detailsColumnCount} className="text-center text-muted">Chưa có data nào.</td></tr>
                        ) : (
                          details.map((d, i) => (
                            <tr key={d.id || `new-${i}`}>
                              {isCommentSeedingPostCampaign || isFindDataSearchCampaign ? (
                                <td>
                                  <input
                                    type="text"
                                    value={d.uid || ''}
                                    onChange={e => updateDetailRow(i, 'uid', e.target.value)}
                                    placeholder={isFindDataSearchCampaign ? 'Nhập từ khóa search...' : 'Dán link bài post...'}
                                    disabled={isEditingSavedCampaign}
                                  />
                                </td>
                              ) : isPagePostCampaign ? (
                                <>
                                  <td title={d.name || '-'}>
                                    <span>{d.name || '-'}</span>
                                  </td>
                                  <td title={d.uid || '-'}>
                                    <span>{d.uid || '-'}</span>
                                  </td>
                                  <td title={d.email || '-'}>
                                    <span>{d.email || '-'}</span>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td>
                                    <input type="text" value={d.name || ''} onChange={e => updateDetailRow(i, 'name', e.target.value)} placeholder="Tên..." disabled={isEditingSavedCampaign} />
                                  </td>
                                  <td>
                                    <input type="text" value={d.phone || ''} onChange={e => updateDetailRow(i, 'phone', e.target.value)} placeholder="SĐT..." disabled={isEditingSavedCampaign} />
                                  </td>
                                  <td>
                                    <input type="text" value={d.uid || ''} onChange={e => updateDetailRow(i, 'uid', e.target.value)} placeholder="UID hoặc link..." disabled={isEditingSavedCampaign} />
                                  </td>
                                  <td>
                                    <input type="text" value={d.email || ''} onChange={e => updateDetailRow(i, 'email', e.target.value)} placeholder="Email..." disabled={isEditingSavedCampaign} />
                                  </td>
                                </>
                              )}
                              {!isEditingSavedCampaign && (
                                <td>
                                  <button className="btn-icon text-error" onClick={() => removeDetailRow(i)}><Trash2 size={14} /></button>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!draftMode && savingCampaign}>
            {!draftMode && savingCampaign ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Đang lưu...
              </>
            ) : draftMode ? 'Chọn chiến dịch tạm' : 'Lưu chiến dịch'}
          </button>
        </div>
      </div>
      {dataScanPicker && formData.accountIds.length > 0 && (
        <DataScanModal
          initialAction={dataScanPicker.action}
          initialAccountId={formData.accountIds[0]}
          initialStatusFilter={dataScanPicker.initialStatusFilter}
          allowedActions={dataScanPicker.allowedActions}
          lockAction
          onClose={() => setDataScanPicker(null)}
          onSelect={
            dataScanPicker.mode === 'friends'
              ? onFriendsSelected
              : dataScanPicker.mode === 'users'
                ? onUsersSelected
                : dataScanPicker.mode === 'pages'
                  ? onPagesSelected
                  : dataScanPicker.mode === 'pageInboxCustomers'
                    ? onPageInboxCustomersSelected
                  : onGroupsSelected
          }
        />
      )}
      {!draftFormConfig && renderCampaignPickerModal()}
      {renderContentTemplatePickerModal()}
      {renderContentTemplateSaveModal()}
      {draftFormConfig && (
        <CampaignFormModal
          campaign={null}
          draftMode
          draftTempId={draftFormConfig.tempId}
          lockedActionId={draftFormConfig.actionId}
          draftPickerSourceType={draftFormConfig.sourceType}
          draftRequiredTargetField={draftFormConfig.requiredTargetField}
          onOpenGeneralSettings={onOpenGeneralSettings}
          onSaveDraft={handleDraftCampaignSaved}
          onClose={() => setDraftFormConfig(null)}
        />
      )}
    </div>
  )
}
