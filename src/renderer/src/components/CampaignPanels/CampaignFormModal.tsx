import { useState, useEffect, useMemo, useRef, type ChangeEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Check, Calendar, Image, Users, Sparkles, RefreshCw, FileText, FolderOpen, FolderCog, Save, Search, Settings2, Heart, MessageCircle, Loader2, Eye, Edit3, ListChecks, Braces, Copy, LayoutGrid, List, Rows3, Shuffle, Share2, ThumbsUp, AlertTriangle } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import {
  ActionLimitConfig,
  AkaBizCampaignListItem,
  AkaBizCampaignListKind,
  AkaBizContactTag,
  AkaBizIntegrations,
  AkaBizSmsShopListItem,
  AutoAccountContact,
  AutoAccountContactGroup,
  Campaign,
  CampaignConfig,
  CampaignListItem,
  CAMPAIGN_INPUT_DATA_DEFAULT_MAX_ROWS,
  CampaignDataTargetSourceMode,
  CampaignAction,
  CampaignImportPlatform,
  CampaignInputData,
  CampaignInputDataWriteProgress,
  CampaignAdvancedContentItem,
  CampaignMediaInput,
  CampaignMediaSnapshot,
  CampaignExtraSettings,
  DataGroup,
  DataGroupCampaignTargetPreview,
  FindDataOutputKind,
  FindDataTargetDataGroup,
  ContentTemplate,
  ContentTemplateChannelName,
  ContentTemplateChannels,
  ContentTemplateGroup,
  CreateContentTemplateInput,
  actionSupportsDataGroup,
  isValidEmailInputDataValue,
  ZaloLabelOption
} from '../../../../shared/types'
import { getVietnamMobileCarrier, getVietnamMobileCarrierLabel, normalizeVietnamMobilePhone } from '../../../../shared/phone'
import {
  IMAGE_FILE_ACCEPT,
  IMAGE_VIDEO_FILE_ACCEPT,
  runtimeMediaSourceMatchesSelectionMode,
  VIDEO_FILE_ACCEPT,
  type MediaSelectionMode
} from '../../../../shared/mediaTypes'
import DataScanModal, { DataScanAction } from '../DataScan/DataScanModal'
import DataGroupPickerModal from '../DataGroups/DataGroupPickerModal'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import type { GeneralSettingsMenu } from '../Settings/GeneralSettingsModal'
import CampaignInfoView from './CampaignInfoView'
import CampaignDataUploadModal from './CampaignDataUploadModal'
import MediaLibraryModal from '../Media/MediaLibraryModal'
import MediaPreviewHover from '../Media/MediaPreviewHover'
import { isImageMediaSource, isVideoMediaSource } from '../Media/mediaImage'
import EmailHtmlEditor, { type EmailHtmlEditorHandle } from './EmailHtmlEditor'
import {
  campaignMediaMatchesRuntimeSelectionMode,
  filterCampaignMediaBySelectionMode,
  getUniqueCampaignMediaAdditions,
  isCampaignMediaVideo,
  isLocalOnlyCampaignMedia,
  selectLocalCampaignMedia,
  summarizeLocalCampaignMediaFailures
} from './localCampaignMedia'
import ContentPreviewModal, {
  renderPreviewSampleTokens,
  type ContentPreviewMediaItem,
  type ContentPreviewModalData,
  type ContentPreviewPlatform,
  type ContentPreviewSurface
} from './ContentPreviewModal'
import ContentTemplatePreview from '../ContentTemplates/ContentTemplatePreview'
import {
  canUseCampaignAction,
  clampDailyLimitToEntitlement,
  getAccountActionDailySendLimit,
  getCampaignActionDailySendLimit,
  normalizeEntitlements
} from '../../utils/entitlements'
import { getAccountPlatformLabel, isZaloServerAccount, isZaloWebAccount } from '../../utils/accountLabels'
import {
  countSingleSmsContent,
  countSmsContentVariants,
  MAX_SMS_ADVANCED_CONTENT_ITEMS,
  normalizeSmsContentForSend,
  stripVietnameseDiacritics
} from '../../../../shared/smsContent'
import { renderContentSpin, renderContentSpinMax, serializeContentVariants, splitContentVariants } from '../../../../shared/contentSpin'
import {
  DEFAULT_RECENT_DELIVERY_COOLDOWN_DAYS,
  MAX_RECENT_DELIVERY_COOLDOWN_DAYS,
  MIN_RECENT_DELIVERY_COOLDOWN_DAYS,
  normalizeRecentDeliveryCooldownDays,
  supportsRecentDeliveryCooldown
} from '../../../../shared/campaignDeliveryCooldown'
import {
  findInvalidAdvancedContentItemIndex,
  normalizeAdvancedContentItems
} from '../../../../shared/advancedContent'
import {
  formattedContentToPlainCampaignContent,
  formattedContentToPlainText,
  isFormattedContentEmpty,
  plainTextToFormattedContent,
  sanitizeFormattedContent,
  serializeFormattedContentVariants,
  splitFormattedContentVariants,
  supportsFormattedContent,
  transformFormattedContentTextNodes
} from '../../../../shared/formattedContent'
import {
  buildContentTemplateGroupCandidate,
  contentTemplateImagesToSnapshots,
  getContentTemplateChannelLabel,
  getContentTemplateSearchText,
  isRichContentTemplateChannel,
  resolveContentTemplate
} from './contentTemplateCampaignUtils'
import type { ContentTemplateGroupCandidate } from './contentTemplateCampaignUtils'

const FIND_DATA_TARGET_FIELDS = [
  'findUidTargetCampaignIds',
  'findPostLinkTargetCampaignIds',
  'findPhoneZaloMessagePhoneTargetCampaignIds',
  'findZaloGroupLinkJoinTargetCampaignIds',
  'findFacebookGroupPostTargetCampaignIds',
  'findFacebookGroupCommentTargetCampaignIds',
  'findFacebookGroupJoinTargetCampaignIds'
] as const
type FindDataTargetCampaignField = typeof FIND_DATA_TARGET_FIELDS[number]
type FindDataSourceKind = 'group' | 'search'
type ZaloFriendTargetMode = NonNullable<CampaignExtraSettings['zaloFriendTargetMode']>
type ZaloMessageSendMode = NonNullable<CampaignExtraSettings['zaloMessageSendMode']>
type ZaloRealtimeTrigger = NonNullable<CampaignExtraSettings['zaloRealtimeTriggers']>[number]
type CampaignPickerColumn = 'name' | 'action' | 'account' | 'status' | 'schedule' | 'updatedAt' | 'dataTypes' | 'sourceTypes'
type CampaignPickerSource =
  | { type: 'findDataSource'; sourceKind?: FindDataSourceKind }
  | { type: 'messageUidTarget' }
  | { type: 'postLinkTarget' }
  | { type: 'groupPostTarget' }
  | { type: 'groupCommentTarget' }
  | { type: 'zaloMessagePhoneTarget' }
  | { type: 'zaloJoinGroupLinkTarget' }
  | { type: 'facebookJoinGroupTarget' }
  | { type: 'external'; kind: AkaBizCampaignListKind }

const CAMPAIGN_ACTION_PLATFORM_ORDER: Record<string, number> = {
  facebook: 0,
  zalo: 1,
  email: 2,
  sms: 3
}

const CAMPAIGN_ACTION_PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  zalo: 'Zalo',
  email: 'Email',
  sms: 'SMS'
}

const CAMPAIGN_DETAILS_PAGE_SIZE = 100

const normalizeCampaignActionPlatform = (platform?: string | null): string =>
  String(platform || '').trim().toLowerCase()

const getCampaignActionPlatformLabel = (platform?: string | null): string => {
  const normalized = normalizeCampaignActionPlatform(platform)
  return CAMPAIGN_ACTION_PLATFORM_LABELS[normalized] || (normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Khác')
}

const compareCampaignActionsByPlatform = (left: CampaignAction, right: CampaignAction): number => {
  const leftPlatform = normalizeCampaignActionPlatform(left.flatformType)
  const rightPlatform = normalizeCampaignActionPlatform(right.flatformType)
  const leftOrder = CAMPAIGN_ACTION_PLATFORM_ORDER[leftPlatform] ?? Number.MAX_SAFE_INTEGER
  const rightOrder = CAMPAIGN_ACTION_PLATFORM_ORDER[rightPlatform] ?? Number.MAX_SAFE_INTEGER
  if (leftOrder !== rightOrder) return leftOrder - rightOrder

  const platformCompare = leftPlatform.localeCompare(rightPlatform, 'vi')
  if (platformCompare !== 0) return platformCompare

  const nameCompare = left.name.localeCompare(right.name, 'vi', { sensitivity: 'base' })
  return nameCompare !== 0 ? nameCompare : left.id.localeCompare(right.id, 'vi')
}
type InternalCampaignPickerSourceType = Exclude<CampaignPickerSource['type'], 'external'>

interface CampaignPickerRow {
  id: number
  name: string
  actionLabel?: string
  accountName?: string
  status?: string
  scheduleLabel?: string
  updatedAtLabel?: string
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
  groupId: number | 'ungrouped' | null
  groupSearchQuery: string
  groupStatus: 'all' | 'active' | 'inactive'
  view: 'card' | 'list' | 'detail'
  sort: 'newest' | 'oldest' | 'name' | 'variants'
  selectedTemplateId: number | null
}

const contentTemplateGroupMatchesPickerFilters = (
  group: ContentTemplateGroup,
  status: ContentTemplatePickerModalState['groupStatus'],
  normalizedQuery: string
) => {
  if (group.isDelete) return false
  if (status === 'active' && !group.isActive) return false
  if (status === 'inactive' && group.isActive) return false
  return !normalizedQuery || `${group.name}\n${group.description || ''}`.toLocaleLowerCase('vi').includes(normalizedQuery)
}

interface ContentTemplateSaveModalState {
  target: AiContentTarget
  name: string
  content: string
  groupId: number | null
}

interface CampaignSaveBundleItem {
  campaignPayload: Partial<Campaign>
  details: Partial<CampaignInputData>[]
  dataGroupSnapshots: DirectDataGroupSnapshotIntent[]
}

interface CampaignSaveProgressState {
  percent: number
  label: string
  processedRows?: number
  totalRows?: number
}

interface CampaignSaveProgressRange {
  itemIndex: number
  itemCount: number
}

const waitForNextBrowserPaint = (): Promise<void> => (
  new Promise(resolve => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0)
    })
  })
)

interface CampaignSaveControlsProps {
  starting: boolean
  saving: boolean
  progress: CampaignSaveProgressState | null
  idleLabel: string
  onSave: () => Promise<void>
  onCancel: () => void
  onStartingChange: (starting: boolean) => void
}

function CampaignSaveControls({
  starting,
  saving,
  progress,
  idleLabel,
  onSave,
  onCancel,
  onStartingChange
}: CampaignSaveControlsProps) {
  const saveInFlightRef = useRef(false)
  const busy = starting || saving
  const visibleProgress = saving
    ? (progress || { percent: 1, label: 'Đang chuẩn bị dữ liệu chiến dịch...' })
    : starting
      ? { percent: 1, label: 'Đang chuẩn bị dữ liệu chiến dịch...' }
      : null

  const startSave = async (): Promise<void> => {
    if (saveInFlightRef.current || saving) return

    saveInFlightRef.current = true
    onStartingChange(true)
    try {
      // Paint the lightweight button state before campaign validation normalizes
      // thousands of rows on the renderer thread.
      await waitForNextBrowserPaint()
      await onSave()
    } finally {
      saveInFlightRef.current = false
      onStartingChange(false)
    }
  }

  return (
    <>
      {visibleProgress && (
        <div
          className="campaign-save-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={visibleProgress.percent}
          aria-label="Tiến trình lưu chiến dịch"
          aria-valuetext={`${visibleProgress.percent}%. ${visibleProgress.label}`}
        >
          <div className="campaign-save-progress-header">
            <span className="campaign-save-progress-label" aria-live="polite">
              {visibleProgress.label}
            </span>
            <strong className="campaign-save-progress-percent">{visibleProgress.percent}%</strong>
          </div>
          <div className="campaign-progress-track">
            <span
              className="campaign-progress-fill campaign-save-progress-fill"
              style={{ width: `${visibleProgress.percent}%` }}
            />
          </div>
          {visibleProgress.processedRows !== undefined && visibleProgress.totalRows !== undefined && (
            <span className="campaign-save-progress-count">
              {visibleProgress.processedRows.toLocaleString('vi-VN')}
              {' / '}
              {visibleProgress.totalRows.toLocaleString('vi-VN')} data của bước hiện tại
            </span>
          )}
        </div>
      )}
      <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Huỷ</button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => { void startSave() }}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {saving ? `Đang lưu ${visibleProgress?.percent ?? 0}%` : 'Đang chuẩn bị...'}
          </>
        ) : idleLabel}
      </button>
    </>
  )
}

const createCampaignSaveProgressRequestId = (): string => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `campaign-save-progress-${Date.now()}-${Math.random().toString(36).slice(2)}`
)

async function runCampaignInputDataWriteWithProgress<T>(
  execute: (requestId: string) => Promise<T>,
  onProgress: (progress: CampaignInputDataWriteProgress) => void
): Promise<T> {
  const requestId = createCampaignSaveProgressRequestId()
  const unsubscribe = window.electronAPI.onCampaignInputDataWriteProgress(progress => {
    if (progress.requestId === requestId) onProgress(progress)
  })
  try {
    return await execute(requestId)
  } finally {
    unsubscribe()
  }
}

interface DirectDataGroupSnapshotIntent {
  groupId: number
  groupName: string
  dataTypeCategoryItemId?: number | null
}

const getPositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const getDataGroupSemanticTypeId = (group?: DataGroup | null): number | null => {
  if (!group) return null
  const record = group as unknown as Record<string, unknown>
  const directId = getPositiveInteger(record.dataTypeCategoryItemId)
  if (directId) return directId
  const nested = record.dataType
  return nested && typeof nested === 'object'
    ? getPositiveInteger((nested as Record<string, unknown>).id)
    : null
}

const getDataGroupSemanticTypeName = (group?: DataGroup | null): string => {
  if (!group) return 'Mọi loại dữ liệu'
  const record = group as unknown as Record<string, unknown>
  const directName = String(record.dataTypeName || '').trim()
  if (directName) return directName
  const nested = record.dataType
  return nested && typeof nested === 'object'
    ? String((nested as Record<string, unknown>).name || '').trim() || 'Mọi loại dữ liệu'
    : 'Mọi loại dữ liệu'
}

const getCampaignActionSemanticTypeIds = (action?: CampaignAction | null): number[] => {
  if (!action) return []
  const rawDataTypes = (action as unknown as Record<string, unknown>).dataTypes
  if (!Array.isArray(rawDataTypes)) return []
  return Array.from(new Set(rawDataTypes
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      if (record.canTarget === false) return null
      return getPositiveInteger(record.dataTypeCategoryItemId)
    })
    .filter((id): id is number => id !== null)))
}

const isSemanticDataTypeCompatibleWithCampaignAction = (
  dataTypeCategoryItemId: number | null | undefined,
  action?: CampaignAction | null
): boolean => {
  const groupTypeId = getPositiveInteger(dataTypeCategoryItemId)
  // NULL groups are deliberately wildcard groups. When an older main process
  // does not return semantic action metadata, keep the former permissive UI.
  if (!groupTypeId) return true
  const hasSemanticMetadata = !!action && Array.isArray(
    (action as unknown as Record<string, unknown>).dataTypes
  )
  const actionTypeIds = getCampaignActionSemanticTypeIds(action)
  return !hasSemanticMetadata || actionTypeIds.includes(groupTypeId)
}

const isDataGroupCompatibleWithCampaignAction = (
  group: DataGroup,
  action?: CampaignAction | null
): boolean => (
  isSemanticDataTypeCompatibleWithCampaignAction(
    getDataGroupSemanticTypeId(group),
    action
  )
)

interface InternalCampaignDraft {
  tempId: number
  sourceType: InternalCampaignPickerSourceType
  actionId: string
  requiredTargetField?: FindDataTargetCampaignField | null
  items: CampaignSaveBundleItem[]
}

interface CampaignFormModalProps {
  campaign: CampaignConfig | null
  cloneFromId?: number
  onOpenGeneralSettings?: (menu?: GeneralSettingsMenu) => void
  onOpenContentTemplates?: (initialChannel?: ContentTemplateChannelName) => void
  draftMode?: boolean
  draftTempId?: number
  lockedActionId?: string
  initialAccountIds?: number[]
  initialDetails?: Partial<CampaignInputData>[]
  initialDataGroupSnapshots?: DirectDataGroupSnapshotIntent[]
  initialDataGroup?: DataGroup
  draftPickerSourceType?: InternalCampaignPickerSourceType
  draftRequiredTargetField?: FindDataTargetCampaignField | null
  onSaveDraft?: (draft: InternalCampaignDraft) => void
  modalZIndex?: number
  submitLabel?: string
  onClose: () => void
}

interface StepDef {
  id: string
  title: string
  fields: { key: string; label: string }[]
}

type ActionLimitForm = Required<Pick<ActionLimitConfig, 'dailyLimit' | 'rateLimitCount' | 'rateLimitMinutes'>>
type ImageOption = 'none' | 'all' | 'random'
type CommentImageOption = ImageOption
type MainMediaPickerTarget = 'post' | 'comment' | { kind: 'advanced'; itemId: string }
type CommentGroupMode = 'all' | 'pending_only' | 'published_only'
type CommentType = 'own' | 'others' | 'all'
type PostBumpMode = 'select' | 'create'
type MessageDateOption = 'today' | 'tomorrow' | 'yesterday'
type MessageDateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY'
type MessageTemplateDropdown = 'date' | 'format' | null
type MessagePersonalizationTarget = 'content' | 'friendRequestMessage' | 'zaloAliasTemplate' | 'internalSmsContent' | 'externalSmsContent'
type AiContentTarget = 'content' | 'commentContent' | 'postBumpContent'
type ContentPreviewTarget = AiContentTarget | 'friendRequestMessage' | 'newsfeedCommentContent'
type AiContentAction = 'multi' | 'rewrite'
type AdvancedContentSourceMode = 'manual' | 'group'
type ContentSettingsTab = 'content' | 'source'
type AdvancedContentSource = NonNullable<CampaignExtraSettings['advancedContentSource']>
type AdvancedContentGroupSnapshot = NonNullable<CampaignExtraSettings['advancedContentGroupSnapshot']>
type AdvancedContentManualDraft = NonNullable<CampaignExtraSettings['advancedContentManualDraft']>
interface AdvancedContentSaveOverride {
  source?: AdvancedContentSource
  items: CampaignAdvancedContentItem[]
  groupSnapshot?: AdvancedContentGroupSnapshot
  formattedContentEnabled: boolean
  emailBodyIsHtml: boolean
  emailSubject: string
}
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

const FACEBOOK_POST_TEMPLATE_ACTIONS = new Set([
  'facebook_timeline_post',
  'facebook_page_post',
  'facebook_group_post'
])
const FACEBOOK_MESSAGE_TEMPLATE_ACTIONS = new Set([
  'facebook_message_friend',
  'facebook_message_uid',
  'facebook_page_to_message'
])
const FACEBOOK_COMMENT_TEMPLATE_ACTIONS = new Set([
  'facebook_comment_seeding',
  'facebook_comment_seeding_post'
])
const ZALO_MESSAGE_TEMPLATE_ACTIONS = new Set([
  'zalo_message_phone',
  'zalo_message_friend',
  'zalo_message_birthday',
  'zalo_message_group_member',
  'zalo_message_group_realtime',
  'zalo_message_remarketing_customer',
  'zalo_message_friend_recommendation',
  'zalo_message_group'
])

const getContentTemplateChannelForAction = (actionId?: string | null): ContentTemplateChannelName | null => {
  const normalized = String(actionId || '').trim()
  if (normalized === 'sms_send') return 'sms'
  if (normalized === 'email_send') return 'email'
  if (ZALO_MESSAGE_TEMPLATE_ACTIONS.has(normalized)) return 'zalo_message'
  if (FACEBOOK_POST_TEMPLATE_ACTIONS.has(normalized)) return 'facebook_post'
  if (FACEBOOK_MESSAGE_TEMPLATE_ACTIONS.has(normalized)) return 'facebook_message'
  if (FACEBOOK_COMMENT_TEMPLATE_ACTIONS.has(normalized)) return 'facebook_comment'
  return null
}

const getAdvancedContentCampaignLabel = (channelName: ContentTemplateChannelName): string => {
  const labels: Record<ContentTemplateChannelName, string> = {
    sms: 'SMS',
    zalo_message: 'Tin nhắn Zalo',
    facebook_post: 'Đăng bài Facebook',
    facebook_message: 'Tin nhắn Facebook',
    facebook_comment: 'Comment Facebook',
    email: 'Email'
  }
  return labels[channelName]
}

const CONTENT_TEMPLATE_PREVIEW_CHANNEL_ORDER: readonly ContentTemplateChannelName[] = [
  'sms',
  'zalo_message',
  'facebook_post',
  'facebook_message',
  'facebook_comment',
  'email'
]

const FACEBOOK_CONTENT_TEMPLATE_CHANNELS: readonly ContentTemplateChannelName[] = [
  'facebook_post',
  'facebook_message',
  'facebook_comment'
]

const getInitialContentTemplatePreviewChannel = (
  template: ContentTemplate | null | undefined,
  preferredChannel: ContentTemplateChannelName | null
): ContentTemplateChannelName => {
  if (preferredChannel && template?.channels[preferredChannel]?.enabled) return preferredChannel
  return CONTENT_TEMPLATE_PREVIEW_CHANNEL_ORDER.find(channel => template?.channels[channel]?.enabled) || preferredChannel || 'sms'
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
  fb_join_group: 'Tham gia group',
  fb_group_invite: 'Mời vào group',
  zalo_find_phone_user: 'Tìm SĐT',
  zalo_message_friend: 'Nhắn tin bạn bè',
  zalo_message_group: 'Nhắn tin group',
  zalo_message_stranger: 'Nhắn tin người lạ',
  zalo_add_friend: 'Kết bạn',
  zalo_add_group_member: 'Thêm thành viên vào group',
  zalo_join_group_link: 'Tham gia group',
  zalo_cancel_sent_friend_request: 'Huỷ lời mời kết bạn',
  zalo_tag_contact: 'Gắn tag Zalo',
  zalo_change_alias: 'Đổi tên Zalo',
  email_send: 'Gửi email',
  sms_send: 'Gửi SMS',
  voice_call: 'Gọi tự động qua SIM'
}

const getActionCodeLabel = (code: string) => ACTION_CODE_LABELS[code] || code

const ACTION_LIMIT_UNITS: Record<string, string> = {
  fb_post_group: 'bài đăng',
  fb_post_my_profile: 'bài đăng',
  fb_post_page: 'bài đăng',
  fb_comment: 'comment',
  fb_message_stranger: 'tin nhắn',
  fb_message_friend: 'tin nhắn',
  fb_message_page_inbox_customer: 'tin nhắn',
  fb_add_friend: 'lời mời',
  fb_like_post: 'like',
  fb_join_group: 'group',
  fb_group_invite: 'lời mời',
  zalo_find_phone_user: 'SĐT',
  zalo_message_friend: 'tin nhắn',
  zalo_message_group: 'tin nhắn',
  zalo_message_stranger: 'tin nhắn',
  zalo_add_friend: 'lời mời',
  zalo_add_group_member: 'thành viên',
  zalo_join_group_link: 'group',
  zalo_cancel_sent_friend_request: 'lời mời',
  email_send: 'email',
  sms_send: 'tin nhắn',
  voice_call: 'cuộc gọi'
}

const getActionLimitUnit = (code: string) => ACTION_LIMIT_UNITS[code] || 'lượt'

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

const assertCampaignSaveItemsWithinInputLimit = async (
  items: CampaignSaveBundleItem[]
): Promise<void> => {
  if (items.length === 0) return

  let campaignInputDataLimit = CAMPAIGN_INPUT_DATA_DEFAULT_MAX_ROWS
  try {
    campaignInputDataLimit = await window.electronAPI.getCampaignInputDataLimit()
  } catch (err) {
    throw new Error(formatIpcErrorMessage(err, 'Không thể tải giới hạn data chiến dịch.'))
  }

  const oversizedSaveItem = items.find(
    item => item.details.length > campaignInputDataLimit
  )
  if (!oversizedSaveItem) return

  throw new Error(
    `Mỗi chiến dịch chỉ được lưu tối đa ${campaignInputDataLimit.toLocaleString('vi-VN')} data. ` +
    `Chiến dịch đang có ${oversizedSaveItem.details.length.toLocaleString('vi-VN')} data.`
  )
}

const formatCampaignDataCreationErrorNote = (err: unknown): string => {
  const message = formatIpcErrorMessage(err, 'Lỗi không xác định')
  const note = `Tạo data chiến dịch chưa hoàn tất: ${message}`
  return note.length > 240 ? note.slice(0, 240) : note
}

const toActionLimitForm = (
  config?: ActionLimitConfig,
  fallback: ActionLimitForm = DEFAULT_ACTION_LIMIT
): ActionLimitForm => ({
  dailyLimit: config?.dailyLimit ?? fallback.dailyLimit,
  rateLimitCount: config?.rateLimitCount ?? fallback.rateLimitCount,
  rateLimitMinutes: config?.rateLimitMinutes ?? fallback.rateLimitMinutes
})

const isSameActionLimitForm = (left?: ActionLimitForm, right?: ActionLimitForm): boolean => (
  !!left &&
  !!right &&
  left.dailyLimit === right.dailyLimit &&
  left.rateLimitCount === right.rateLimitCount &&
  left.rateLimitMinutes === right.rateLimitMinutes
)

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

const normalizeZaloFriendRecommendationCount = (value: unknown): number => {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return 10
  return Math.max(1, parsed)
}

const normalizeZaloCancelFriendRequestLimit = (value: unknown): number => {
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
const FACEBOOK_JOIN_GROUP_ACTION_ID = 'facebook_join_group'
const FACEBOOK_GROUP_INVITE_ACTION_ID = 'facebook_group_invite'
const PAGE_POST_ACTION_ID = 'facebook_page_post'
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const ZALO_MESSAGE_FRIEND_ACTION_ID = 'zalo_message_friend'
const ZALO_MESSAGE_BIRTHDAY_ACTION_ID = 'zalo_message_birthday'
const ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID = 'zalo_message_group_member'
const ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID = 'zalo_message_group_realtime'
const ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID = 'zalo_message_remarketing_customer'
const ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID = 'zalo_message_friend_recommendation'
const ZALO_MESSAGE_GROUP_ACTION_ID = 'zalo_message_group'
const ZALO_ADD_GROUP_MEMBER_ACTION_ID = 'zalo_add_group_member'
const ZALO_JOIN_GROUP_LINK_ACTION_ID = 'zalo_join_group_link'
const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID = 'zalo_cancel_sent_friend_request'
const EMAIL_SEND_ACTION_ID = 'email_send'
const SMS_SEND_ACTION_ID = 'sms_send'
const VOICE_CALL_ACTION_ID = 'voice_call'
const VOICE_CALL_AI_DISCLOSURE = 'Đây là cuộc gọi tự động sử dụng giọng nói AI.'
const VOICE_CALL_DEFAULT_RATE_LIMIT_MINUTES = 60
const VOICE_CALL_MAX_TTS_INPUT_CHARS = 4096
const DATA_GROUP_BUNDLE_RETRY_STORAGE_PREFIX = 'aka-agent:data-group-bundle-retry:'

const FIND_DATA_GROUP_DESTINATION_CONFIG: Record<
  FindDataOutputKind,
  { actionId: string; label: string }
> = {
  phone: {
    actionId: ZALO_MESSAGE_PHONE_ACTION_ID,
    label: 'Đẩy SĐT sang Nhóm data'
  },
  zalo_group_link: {
    actionId: ZALO_JOIN_GROUP_LINK_ACTION_ID,
    label: 'Đẩy link group Zalo sang Nhóm data'
  },
  facebook_uid: {
    actionId: MESSAGE_UID_ACTION_ID,
    label: 'Đẩy UID Facebook sang Nhóm data'
  },
  post_link: {
    actionId: COMMENT_SEEDING_POST_ACTION_ID,
    label: 'Đẩy link bài post sang Nhóm data'
  },
  facebook_group: {
    actionId: FACEBOOK_JOIN_GROUP_ACTION_ID,
    label: 'Đẩy group Facebook sang Nhóm data'
  }
}

type FindDataTargetDataGroups = Partial<Record<FindDataOutputKind, FindDataTargetDataGroup>>
type FindDataTargetDataGroupEnabledState = Record<FindDataOutputKind, boolean>
type FindDataTargetDataGroupDetails = Partial<Record<FindDataOutputKind, DataGroup>>

const removeFindDataTargetDataGroup = (
  destinations: FindDataTargetDataGroups,
  kind: FindDataOutputKind
): FindDataTargetDataGroups => {
  const next = { ...destinations }
  delete next[kind]
  return next
}

const getFindDataTargetDataGroupsForSave = (
  destinations: FindDataTargetDataGroups,
  flags: FindDataGoalFlagState,
  isSearchCampaign: boolean
): FindDataTargetDataGroups | undefined => {
  const enabledByKind: Record<FindDataOutputKind, boolean> = {
    phone: flags.isFindPhone,
    zalo_group_link: flags.isFindLinkGroupZalo,
    facebook_uid: flags.isFindUid,
    post_link: flags.isFindPostLink,
    facebook_group: isSearchCampaign && flags.isFindFacebookGroup
  }
  const normalized: FindDataTargetDataGroups = {}

  for (const kind of Object.keys(enabledByKind) as FindDataOutputKind[]) {
    if (!enabledByKind[kind]) continue
    const destination = destinations[kind]
    const groupId = Number(destination?.groupId)
    if (!Number.isSafeInteger(groupId) || groupId <= 0) continue
    normalized[kind] = {
      groupId,
      groupName: String(destination?.groupName || '').trim() || `Nhóm ${groupId}`
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

const stableSerializeForDataGroupBundle = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableSerializeForDataGroupBundle).join(',')}]`
  const record = value as Record<string, unknown>
  // A fresh content-template snapshot gets a new capture timestamp on every
  // Save click even when the user's effective campaign intent is unchanged.
  // Excluding that audit-only value keeps a partial multi-account bundle retry
  // on the original request id instead of creating a second set of children.
  return `{${Object.keys(record).filter(key => key !== 'capturedAt').sort().map(key => (
    `${JSON.stringify(key)}:${stableSerializeForDataGroupBundle(record[key])}`
  )).join(',')}}`
}

const hashDataGroupBundlePayload = async (value: unknown): Promise<string> => {
  const serialized = stableSerializeForDataGroupBundle(value)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  let hash = 2166136261
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const readStoredDataGroupBundleRequestId = (storageKey: string): string | null => {
  try {
    return window.localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

const storeDataGroupBundleRequestId = (storageKey: string, requestId: string): void => {
  try {
    window.localStorage.setItem(storageKey, requestId)
  } catch {
    // The in-memory ref still preserves idempotency for this modal session.
  }
}

const clearStoredDataGroupBundleRequestId = (storageKey: string | null): void => {
  if (!storageKey) return
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // A stale retry hint is harmless: a ready bundle is itself idempotent.
  }
}
const EXTERNAL_SMS_STATUS_OPTIONS = [
  { value: 'thành công', label: 'Thành công' },
  { value: 'thất bại', label: 'Thất bại' },
  { value: 'không tồn tại', label: 'Không tồn tại' }
] as const
const DEFAULT_SLEEP_BETWEEN_ACTIONS = 30
const DEFAULT_SMS_SLEEP_BETWEEN_ACTIONS = 90
const ZALO_FRIEND_TARGET_MODES: Array<{ value: ZaloFriendTargetMode; label: string }> = [
  { value: 'selected', label: 'Chọn bạn bè để gửi' },
  { value: 'all_friends', label: 'Gửi cho tất cả bạn bè' },
  { value: 'tagged_friends', label: 'Gửi cho bạn bè thuộc danh sách tag' }
]
const normalizeZaloTagIdList = (value: unknown): string[] => {
  const rawItems = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of rawItems) {
    const id = String(item ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}
const normalizeZaloTagNameList = (value: unknown): string[] => {
  const rawItems = Array.isArray(value) ? value : []
  return rawItems.map(item => String(item ?? '').trim())
}
const normalizeZaloRealtimeGroupId = (value: unknown): string =>
  String(value || '').trim().replace(/^g/i, '')
const formatZaloGroupMemberCount = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return ''
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? new Intl.NumberFormat('vi-VN').format(parsed) : ''
}
const getZaloGroupDropdownLabel = (group: AutoAccountContact, fallbackId = ''): string => {
  const name = group.name.trim() || fallbackId || '-'
  const countLabel = formatZaloGroupMemberCount(group.extraData?.totalMember)
  return countLabel ? `${name} (${countLabel})` : name
}
const normalizeFacebookGroupInviteGroupUrl = (value: unknown): string => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!/(?:facebook|fb)\.com/i.test(raw) && /^[a-zA-Z0-9._-]+$/.test(raw)) {
    return `https://www.facebook.com/groups/${raw}`
  }
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const url = new URL(withProtocol)
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
      ? `https://www.facebook.com/groups/${groupKey}`
      : ''
  } catch {
    const groupKey = raw.replace(/\/+$/g, '').trim()
    return groupKey && /^[a-zA-Z0-9._-]+$/.test(groupKey)
      ? `https://www.facebook.com/groups/${groupKey}`
      : ''
  }
}
const getFacebookGroupInviteContactUrl = (group: AutoAccountContact): string =>
  normalizeFacebookGroupInviteGroupUrl(group.url || group.uid)
const getFacebookGroupInviteDropdownLabel = (group: AutoAccountContact, fallbackUrl = ''): string =>
  String(group.name || '').trim() || group.uid || fallbackUrl || '-'
const getZaloGroupType = (group: AutoAccountContact): number | null => {
  const parsed = Number(group.extraData?.groupType)
  return Number.isFinite(parsed) ? parsed : null
}
const isZaloCommunityGroup = (group: AutoAccountContact): boolean => getZaloGroupType(group) === 2
const MESSAGE_CAMPAIGN_ACTIONS = new Set([
  MESSAGE_FRIEND_ACTION_ID,
  MESSAGE_UID_ACTION_ID,
  PAGE_INBOX_MESSAGE_ACTION_ID,
  ZALO_MESSAGE_PHONE_ACTION_ID,
  ZALO_MESSAGE_FRIEND_ACTION_ID,
  ZALO_MESSAGE_BIRTHDAY_ACTION_ID,
  ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID,
  ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID,
  ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID,
  ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID,
  ZALO_MESSAGE_GROUP_ACTION_ID,
  EMAIL_SEND_ACTION_ID,
  SMS_SEND_ACTION_ID,
  VOICE_CALL_ACTION_ID
])
const ZALO_REALTIME_TRIGGER_OPTIONS: Array<{ value: ZaloRealtimeTrigger; label: string }> = [
  { value: 'join', label: 'Nhắn tin, kết bạn đến những người THAM GIA vào group theo thời gian thực' },
  { value: 'leave', label: 'Nhắn tin, kết bạn đến những người RỜI group theo thời gian thực' },
  { value: 'interact', label: 'Nhắn tin, kết bạn đến những người NHẮN TIN, TƯƠNG TÁC trong group theo thời gian thực' }
]
const ZALO_REALTIME_TRIGGER_VALUES = new Set<ZaloRealtimeTrigger>(
  ZALO_REALTIME_TRIGGER_OPTIONS.map(option => option.value)
)
const normalizeZaloRealtimeTriggers = (
  value: unknown,
  fallback: ZaloRealtimeTrigger[] = ['join']
): ZaloRealtimeTrigger[] => {
  const items = Array.isArray(value) ? value : []
  const triggers = Array.from(new Set(
    items
      .map(item => String(item || '').trim())
      .filter((item): item is ZaloRealtimeTrigger => ZALO_REALTIME_TRIGGER_VALUES.has(item as ZaloRealtimeTrigger))
  ))
  return triggers.length > 0 ? triggers : fallback
}

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

const getFindDataSourceKindForActionId = (actionId?: string | null): FindDataSourceKind | null => {
  if (!actionId) return null
  if (FIND_DATA_GROUP_ACTIONS.has(actionId)) return 'group'
  if (FIND_DATA_SEARCH_ACTIONS.has(actionId)) return 'search'
  return null
}

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
const DEFAULT_ZALO_PHONE_ALIAS_TEMPLATE = `${MESSAGE_FULL_NAME_TOKEN} - ${MESSAGE_PHONE_TOKEN}`
const DEFAULT_ZALO_PROFILE_ALIAS_TEMPLATE = MESSAGE_FULL_NAME_TOKEN
const DEFAULT_ZALO_ALIAS_TEMPLATES = new Set([
  DEFAULT_ZALO_PHONE_ALIAS_TEMPLATE,
  DEFAULT_ZALO_PROFILE_ALIAS_TEMPLATE
])
const getDefaultZaloAliasTemplate = (actionId?: string | null): string =>
  actionId === ZALO_MESSAGE_PHONE_ACTION_ID
    ? DEFAULT_ZALO_PHONE_ALIAS_TEMPLATE
    : DEFAULT_ZALO_PROFILE_ALIAS_TEMPLATE
const isDefaultZaloAliasTemplate = (value?: string | null): boolean =>
  DEFAULT_ZALO_ALIAS_TEMPLATES.has(String(value || '').trim())
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

const getVietnamDayMonthLabel = (): string => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit'
  }).formatToParts(new Date())
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>
  return `${byType.day || '01'}/${byType.month || '01'}`
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

const getDailyTimeSlotMinutes = (value: string): number | null => {
  const slot = parseDailyTimeSlot(value)
  if (!slot) return null
  const [hour, minute] = slot.split(':').map(Number)
  return hour * 60 + minute
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

const isCampaignMediaSnapshot = (item: CampaignMediaInput): item is CampaignMediaSnapshot =>
  typeof item === 'object' && item !== null

const getCampaignMediaDisplayName = (item: CampaignMediaInput): string => {
  if (typeof item === 'string') return getImageDisplayName(item)
  return item.name ||
    getImageDisplayName(item.localPath || '') ||
    getImageDisplayName((item.cloudUrl || '').split('?')[0]) ||
    'Media'
}

const getCampaignMediaLocalPath = (item: CampaignMediaInput): string =>
  typeof item === 'string' ? item : (item.localPath || '')

const getCampaignMediaCloudUrl = (item: CampaignMediaInput): string =>
  typeof item === 'string' ? '' : (item.cloudUrl || '')

const getCampaignMediaMimeType = (item: CampaignMediaInput): string =>
  typeof item === 'string' ? '' : (item.mimeType || '')

const getCampaignMediaSizeBytes = (item: CampaignMediaInput): number | null =>
  typeof item === 'string' ? null : (item.sizeBytes ?? null)

const isCampaignMediaLocalAvailable = (path: string): boolean => {
  const trimmed = String(path || '').trim()
  if (!trimmed) return false
  if (isDataImagePath(trimmed)) return true
  try {
    return window.electronAPI.fileExists(trimmed)
  } catch {
    return false
  }
}

const isCampaignMediaUsingCloudFallback = (item: CampaignMediaInput): boolean => {
  if (!isCampaignMediaSnapshot(item)) return false
  const cloudUrl = getCampaignMediaCloudUrl(item).trim()
  if (!cloudUrl) return false
  const localPath = getCampaignMediaLocalPath(item).trim()
  return !localPath || !isCampaignMediaLocalAvailable(localPath)
}

const getCampaignMediaPreviewPath = (item: CampaignMediaInput): string => {
  if (typeof item === 'string') return item
  const localPath = getCampaignMediaLocalPath(item).trim()
  if (localPath && isCampaignMediaLocalAvailable(localPath)) return localPath
  return getCampaignMediaCloudUrl(item) || localPath
}

const getCampaignMediaStableKey = (item: CampaignMediaInput): string => {
  if (typeof item === 'string') return item
  return item.cloudUrl || item.localPath || item.name
}

const isDirectCampaignMediaPreviewUrl = (path: string): boolean => /^(https?:|data:)/i.test(path)

const hashCampaignPreviewSeed = (value: string): number => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const createCampaignPreviewRng = (seed: string): (() => number) => {
  let state = hashCampaignPreviewSeed(seed)
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function sampleCampaignPreviewMedia<T>(items: readonly T[], count: number, rng: () => number): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const pickedIndex = Math.floor(rng() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[pickedIndex]
    shuffled[pickedIndex] = current
  }
  return shuffled.slice(0, Math.min(shuffled.length, Math.max(1, count)))
}

function CampaignManualMediaPreview({ media }: { media: CampaignMediaInput }) {
  const path = getCampaignMediaPreviewPath(media).trim()
  const cloudPreviewPath = getCampaignMediaCloudUrl(media).trim()
  const directCloudPreviewPath = isDirectCampaignMediaPreviewUrl(cloudPreviewPath) ? cloudPreviewPath : ''
  const mimeType = getCampaignMediaMimeType(media)
  const label = getCampaignMediaDisplayName(media)
  const isImage = isImageMediaSource(mimeType, path)
  const isVideo = isVideoMediaSource(mimeType, path)
  const [previewSrc, setPreviewSrc] = useState(() => isDirectCampaignMediaPreviewUrl(path) ? path : '')
  const [previewStatus, setPreviewStatus] = useState<'loading' | 'ready' | 'fallback'>(() => (
    isDirectCampaignMediaPreviewUrl(path) ? 'ready' : isImage && path ? 'loading' : 'fallback'
  ))

  useEffect(() => {
    let disposed = false
    if (!path || (!isImage && !isVideo)) {
      setPreviewSrc('')
      setPreviewStatus('fallback')
      return () => { disposed = true }
    }
    if (isDirectCampaignMediaPreviewUrl(path)) {
      setPreviewSrc(path)
      setPreviewStatus('ready')
      return () => { disposed = true }
    }
    if (isVideo) {
      setPreviewSrc(directCloudPreviewPath)
      setPreviewStatus(directCloudPreviewPath ? 'ready' : 'fallback')
      return () => { disposed = true }
    }

    setPreviewSrc('')
    setPreviewStatus('loading')
    window.electronAPI.readCampaignPreviewFileDataUrl(path)
      .then(result => {
        if (disposed) return
        setPreviewSrc(result.dataUrl)
        setPreviewStatus('ready')
      })
      .catch(() => {
        if (disposed) return
        setPreviewSrc(directCloudPreviewPath)
        setPreviewStatus(directCloudPreviewPath ? 'ready' : 'fallback')
      })
    return () => { disposed = true }
  }, [directCloudPreviewPath, isImage, isVideo, path])

  const handlePreviewLoadError = () => {
    if (directCloudPreviewPath && previewSrc !== directCloudPreviewPath) {
      setPreviewSrc(directCloudPreviewPath)
      setPreviewStatus('ready')
      return
    }
    setPreviewSrc('')
    setPreviewStatus('fallback')
  }

  return (
    <span className={`campaign-manual-preview-media-tile is-${previewStatus}`} title={label}>
      {previewStatus === 'ready' && previewSrc ? (
        isVideo
          ? <video src={previewSrc} muted playsInline preload="metadata" aria-label={label} onError={handlePreviewLoadError} />
          : <img src={previewSrc} alt={label} loading="lazy" onError={handlePreviewLoadError} />
      ) : (
        <span className="campaign-manual-preview-media-fallback">
          {isVideo ? <FileText size={20} /> : <Image size={20} />}
          <small>{previewStatus === 'loading' ? 'Đang tải ảnh…' : label}</small>
        </span>
      )}
      {previewStatus === 'ready' && <small className="campaign-manual-preview-media-name">{label}</small>}
    </span>
  )
}

const createAdvancedContentItem = (overrides: Partial<CampaignAdvancedContentItem> = {}): CampaignAdvancedContentItem => ({
  id: overrides.id || `advanced-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  content: overrides.content || '',
  mediaOption: overrides.mediaOption || 'none',
  mediaItems: overrides.mediaItems ? [...overrides.mediaItems] : [],
  randomMediaCount: overrides.randomMediaCount || 3,
  ...(overrides.emailSubject !== undefined ? { emailSubject: overrides.emailSubject } : {}),
  ...(overrides.sourceTemplateId !== undefined ? { sourceTemplateId: overrides.sourceTemplateId } : {}),
  ...(overrides.sourceTemplateName !== undefined ? { sourceTemplateName: overrides.sourceTemplateName } : {}),
  ...(overrides.sourceVariantIndex !== undefined ? { sourceVariantIndex: overrides.sourceVariantIndex } : {})
})

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

const normalizeEmailAddress = (value: unknown): string => getExcelCellText(value).trim()

const isValidEmailAddress = (value: unknown): boolean => isValidEmailInputDataValue(normalizeEmailAddress(value))

const inferInputDataPhoneCarrier = (
  phone: unknown,
  carrier?: CampaignInputData['phoneCarrier']
): CampaignInputData['phoneCarrier'] => (
  carrier || getVietnamMobileCarrier(phone) || null
)

const formatInputDataPhoneCarrier = (row: Partial<CampaignInputData>): string => (
  getVietnamMobileCarrierLabel(inferInputDataPhoneCarrier(row.phone, row.phoneCarrier)) || '-'
)

const parseFindDataSearchKeywordsText = (value: string): string[] =>
  value.split(',').map(item => item.trim()).filter(Boolean)

const formatFindDataSearchKeywordList = (keywords: string[]): string =>
  keywords.join(', ')

const formatFindDataSearchKeywordsText = (rows: Partial<CampaignInputData>[] = []): string =>
  formatFindDataSearchKeywordList(
    rows
      .map(row => String(row.uid || '').trim())
      .filter(Boolean)
  )

const buildFindDataSearchKeywordRows = (value: string): Partial<CampaignInputData>[] =>
  parseFindDataSearchKeywordsText(value).map(keyword => ({
    name: '',
    phone: '',
    uid: keyword,
    email: '',
    note: '',
    status: 'chờ xử lý'
  }))

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

const isEditableFindDataSourceCampaign = (campaign: Pick<Campaign, 'status'>): boolean =>
  campaign.status === 'chờ xử lý' || campaign.status === 'tạm dừng'

const getFindDataTargetCampaignField = (actionId: string): FindDataTargetCampaignField | null => {
  if (actionId === MESSAGE_UID_ACTION_ID) return 'findUidTargetCampaignIds'
  if (actionId === COMMENT_SEEDING_POST_ACTION_ID) return 'findPostLinkTargetCampaignIds'
  if (actionId === GROUP_POST_ACTION_ID) return 'findFacebookGroupPostTargetCampaignIds'
  if (actionId === COMMENT_SEEDING_FEED_ACTION_ID) return 'findFacebookGroupCommentTargetCampaignIds'
  if (actionId === FACEBOOK_JOIN_GROUP_ACTION_ID) return 'findFacebookGroupJoinTargetCampaignIds'
  return null
}

const getFindDataSourceSectionLabel = (actionId: string): string => {
  if (actionId === MESSAGE_UID_ACTION_ID) return 'Chọn chiến dịch: Tìm kiếm UID để nhắn tin/kết bạn'
  if (actionId === COMMENT_SEEDING_POST_ACTION_ID) return 'Chọn chiến dịch: Tìm kiếm bài post để comment'
  if (actionId === GROUP_POST_ACTION_ID) return 'Chọn chiến dịch: Tìm kiếm group để đăng bài'
  if (actionId === COMMENT_SEEDING_FEED_ACTION_ID) return 'Chọn chiến dịch: Tìm kiếm group để comment'
  if (actionId === FACEBOOK_JOIN_GROUP_ACTION_ID) return 'Chọn chiến dịch: Tìm kiếm group để tham gia'
  return 'Nguồn chiến dịch tìm kiếm data'
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
  sourceCampaigns: CampaignListItem[]
): number[] => {
  const field = getFindDataTargetCampaignField(targetActionId)
  if (!targetCampaignId || !field) return []

  return sourceCampaigns
    .filter(source => getCampaignIdList(source.relationSettings[field]).includes(targetCampaignId))
    .map(source => source.id)
}

const removeFindDataTargetCampaignId = (
  extra: CampaignExtraSettings | undefined,
  targetCampaignId: number | null
): CampaignExtraSettings => {
  const next: CampaignExtraSettings = { ...(extra || {}) }
  if (!targetCampaignId) return next

  for (const field of FIND_DATA_TARGET_FIELDS) {
    const ids = getCampaignIdList(next[field]).filter(id => id !== targetCampaignId)
    next[field] = ids
  }

  return next
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
      { key: 'actionId', label: 'Hành động' },
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
    id: 'deliveryCooldown',
    title: 'Kiểm tra trùng lặp',
    fields: [
      { key: 'recentDeliveryCooldownDays', label: 'Không gửi nội dung trùng lặp trong X ngày' }
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

const EXTERNAL_SMS_STEP: StepDef = {
  id: 'externalSms',
  title: 'Gửi tin nhắn Sms',
  fields: [{ key: 'externalSms', label: 'Gửi tin nhắn Sms' }]
}

const ACTION_OPTIONS_STEP: StepDef = {
  id: 'actionOptions',
  title: 'Tuỳ chọn hành động',
  fields: [{ key: 'messageActions', label: 'Hành động' }]
}

const withSourceContentField = (step: StepDef): StepDef => ({
  ...step,
  fields: [...step.fields, { key: 'sourceContent', label: 'Copy nguồn nội dung' }]
})

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

const DATA_TARGET_SOURCE_STEP: StepDef = {
  id: 'dataTargetSource',
  title: 'Cách thêm data vào chiến dịch',
  fields: [{ key: 'dataTargetSourceMode', label: 'Nguồn data' }]
}

const DATA_GROUP_TARGET_STEP: StepDef = {
  id: 'details',
  title: 'Chọn data bằng cách chọn nhóm',
  fields: [{ key: 'dataGroupId', label: 'Nhóm data' }]
}

const getFindDataSourceStep = (label: string): StepDef => ({
  id: 'findDataSources',
  title: label,
  fields: [{ key: 'findDataSources', label }]
})

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
  onOpenContentTemplates,
  draftMode = false,
  draftTempId,
  lockedActionId,
  initialAccountIds,
  initialDetails,
  initialDataGroupSnapshots,
  initialDataGroup,
  draftPickerSourceType,
  draftRequiredTargetField,
  onSaveDraft,
  modalZIndex,
  submitLabel,
  onClose
}: CampaignFormModalProps) {
  const {
    accounts, accountGroups, campaignActions, campaigns, loadAccountGroups, loadCampaigns,
    createCampaign, updateCampaign,
    createCampaignInputData
  } = useCampaignStore()
  const authUser = useAuthStore(state => state.user)
  const { showAlert, showConfirm, alert: uiAlert, confirm: uiConfirm } = useUiStore()
  const entitlements = authUser?.entitlements
  const canUseZaloQrAccount = authUser?.zaloAccountCapabilities?.qr === true
  const canUseEmailFeature = !!entitlements?.email
  const canUseInternalSmsFeature = !!entitlements?.sms
  const canUseFanpageFeature = normalizeEntitlements(entitlements).facebookFanpage
  const canUseZaloFeature = canUseCampaignAction({ id: ZALO_MESSAGE_PHONE_ACTION_ID, flatformType: 'zalo' }, entitlements)
  const zaloEntitlementNote = 'Bạn chưa đăng ký gói Zalo, không thể sử dụng tính năng này'

  const contentRef = useRef<HTMLDivElement>(null)
  const campaignContentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const friendRequestMessageTextareaRef = useRef<HTMLTextAreaElement>(null)
  const internalSmsContentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const externalSmsContentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const zaloAliasTemplateInputRef = useRef<HTMLInputElement>(null)
  const emailHtmlEditorRef = useRef<EmailHtmlEditorHandle | null>(null)
  const advancedContentEditorRefs = useRef<Record<string, EmailHtmlEditorHandle>>({})
  const advancedContentTextareaRefs = useRef<Record<string, HTMLTextAreaElement>>({})
  const activeRichContentEditorRef = useRef<{ itemId: string | null; editor: EmailHtmlEditorHandle } | null>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [saveStarting, setSaveStarting] = useState(false)
  const [savingCampaign, setSavingCampaign] = useState(false)
  const saveBusy = saveStarting || savingCampaign
  const [saveProgress, setSaveProgress] = useState<CampaignSaveProgressState | null>(null)
  const updateSaveProgress = (
    percent: number,
    label: string,
    processedRows?: number,
    totalRows?: number
  ): void => {
    const normalizedPercent = Math.max(0, Math.min(100, Math.round(percent)))
    setSaveProgress(current => ({
      percent: Math.max(current?.percent ?? 0, normalizedPercent),
      label,
      processedRows,
      totalRows
    }))
  }

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

  const initRealtimeEndDate = () => {
    const saved = String(campaign?.extraSettings?.zaloRealtimeEndDate || '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved
    return initEndDate()
  }

  const savedCommentImages = campaign?.extraSettings?.commentImages || []
  const rawSavedCommentImageOption = campaign?.extraSettings?.commentImageOption
  const savedCommentImageOption: CommentImageOption =
    (savedCommentImages.length > 0 && (rawSavedCommentImageOption === 'all' || rawSavedCommentImageOption === 'random'))
      ? rawSavedCommentImageOption
      : 'none'
  const savedDailyStopTime = normalizeTimeInput(campaign?.dailyStopTime)
  const rawInitialActionId = lockedActionId || campaign?.actionId || ''
  const initialActionId = rawInitialActionId && !canUseCampaignAction({ id: rawInitialActionId, flatformType: '' }, entitlements)
    ? ''
    : rawInitialActionId
  const initialIsZaloFriendRecommendationCampaign = initialActionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
  const initialIsFindDataSearchCampaign = FIND_DATA_SEARCH_ACTIONS.has(initialActionId)
  const initialSleepBetweenActions = campaign?.extraSettings?.actionLimits?.sleepBetweenActions
    ?? (initialActionId === SMS_SEND_ACTION_ID ? DEFAULT_SMS_SLEEP_BETWEEN_ACTIONS : DEFAULT_SLEEP_BETWEEN_ACTIONS)
  const hasSavedContinueWhenActionLimitReached = typeof campaign?.extraSettings?.actionLimits?.continueWhenActionLimitReached === 'boolean'
  const initialContinueWhenActionLimitReached = campaign
    ? (hasSavedContinueWhenActionLimitReached ? campaign.extraSettings?.actionLimits?.continueWhenActionLimitReached === true : false)
    : true
  const initialIsDraftFacebookGroupSource =
    draftRequiredTargetField === 'findFacebookGroupPostTargetCampaignIds' ||
    draftRequiredTargetField === 'findFacebookGroupCommentTargetCampaignIds' ||
    draftRequiredTargetField === 'findFacebookGroupJoinTargetCampaignIds'
  const initialFindDataFlags = normalizeFindDataFlagState({
    isFindPhone: campaign?.extraSettings?.isFindPhone ?? false,
    isFindLinkGroupZalo: campaign?.extraSettings?.isFindLinkGroupZalo ?? false,
    isFindUid: draftRequiredTargetField === 'findUidTargetCampaignIds' ? true : (campaign?.extraSettings?.isFindUid ?? false),
    isFindPostLink: draftRequiredTargetField === 'findPostLinkTargetCampaignIds' ? true : (campaign?.extraSettings?.isFindPostLink ?? false),
    isFindFacebookGroup: initialIsDraftFacebookGroupSource ? true : (campaign?.extraSettings?.isFindFacebookGroup ?? false),
    isFindInPost: Boolean(
      draftRequiredTargetField === 'findPostLinkTargetCampaignIds' ||
      campaign?.extraSettings?.isFindPostLink ||
      campaign?.extraSettings?.isFindInPost
    ),
    isFindInComment: campaign?.extraSettings?.isFindInComment ?? false,
    isFindNewInteractors: campaign?.extraSettings?.isFindNewInteractors ?? false,
    isFindInGroupMembers: campaign?.extraSettings?.isFindInGroupMembers ?? false
  }, { isSearchCampaign: initialIsFindDataSearchCampaign })
  const savedAdvancedGroupSnapshot = campaign?.extraSettings?.advancedContentGroupSnapshot
  const savedAdvancedContentSource = campaign?.extraSettings?.advancedContentSource
  const hasSavedAdvancedGroupSnapshot = savedAdvancedContentSource === 'group_snapshot' && !!savedAdvancedGroupSnapshot
  const normalizeInitialAdvancedMedia = (items: CampaignAdvancedContentItem[]): CampaignAdvancedContentItem[] => (
    COMMENT_SEEDING_ACTIONS.has(initialActionId)
      ? items.map(item => ({ ...item, randomMediaCount: 1 }))
      : items
  )
  const initialActiveAdvancedContentItems = normalizeInitialAdvancedMedia(
    normalizeAdvancedContentItems(campaign?.extraSettings?.advancedContentItems)
  )
  const savedManualDraft = campaign?.extraSettings?.advancedContentManualDraft
  const initialManualDraft: AdvancedContentManualDraft = hasSavedAdvancedGroupSnapshot
    ? {
        content: savedManualDraft
          ? String(savedManualDraft.content || '')
          : formattedContentToPlainCampaignContent(campaign?.content || ''),
        advancedContentItems: savedManualDraft
          ? normalizeInitialAdvancedMedia(normalizeAdvancedContentItems(savedManualDraft.advancedContentItems))
          : [],
        formattedContentEnabled: savedManualDraft?.formattedContentEnabled === true,
        emailSubject: savedManualDraft ? String(savedManualDraft.emailSubject || '') : '',
        emailBodyIsHtml: savedManualDraft?.emailBodyIsHtml === true,
        rewriteContentEachRun: savedManualDraft?.rewriteContentEachRun === true
      }
    : {
        content: campaign?.content || '',
        advancedContentItems: initialActiveAdvancedContentItems,
        formattedContentEnabled: campaign?.extraSettings?.formattedContentEnabled === true,
        emailSubject: campaign?.extraSettings?.emailSubject || '',
        emailBodyIsHtml: campaign?.extraSettings?.emailBodyIsHtml === true,
        rewriteContentEachRun: campaign?.extraSettings?.rewriteContentEachRun === true
      }
  const initialAdvancedContentItems = initialManualDraft.advancedContentItems
  const hasPriorManualAdvancedContent = campaign?.extraSettings?.advancedContentEnabled === true ||
    initialAdvancedContentItems.length > 0
  const initialAdvancedContentSourceMode: AdvancedContentSourceMode = campaign
    ? (hasSavedAdvancedGroupSnapshot
        ? 'group'
        : hasPriorManualAdvancedContent
          ? 'manual'
          : 'group')
    : 'group'
  const [formData, setFormData] = useState({
    name: campaign?.name || '',
    actionId: initialActionId,
    accountIds: initialAccountIds?.length ? initialAccountIds : (campaign?.accountId ? [campaign.accountId] : [] as number[]),
    secondaryAccountId: campaign?.secondaryAccountId ?? null as number | null,
    dataTargetSourceMode: (campaign?.dataTargetSourceMode || (initialDataGroup ? 'data_group' : 'direct')) as CampaignDataTargetSourceMode,
    dataGroupId: campaign?.dataGroupId ?? initialDataGroup?.id ?? null as number | null,
    schedule: initSchedule(),
    scheduleType: (campaign?.scheduleType || 'daily') as 'daily' | 'weekly' | 'monthly',
    scheduleEndDate: initEndDate(),
    useDailyStopTime: campaign ? !!savedDailyStopTime : false,
    dailyStopTime: savedDailyStopTime || DEFAULT_DAILY_STOP_TIME,
    scheduleDays: campaign?.scheduleDays || '',
    scheduleWeekDays: campaign?.scheduleWeekDays || '',
    continueNextDay: [NEWSFEED_INTERACTION_ACTION_ID, ZALO_MESSAGE_BIRTHDAY_ACTION_ID].includes(lockedActionId || campaign?.actionId || '')
      ? false
      : (campaign?.continueNextDay ?? true),
    refreshData: campaign?.refreshData ?? true,
    sleepBetweenActions: initialSleepBetweenActions,
    multiDailyTimeSlotsEnabled: campaign?.extraSettings?.multiDailyTimeSlotsEnabled ?? false,
    multiDailyTimeSlots: normalizeDailyTimeSlotsText(campaign?.extraSettings?.multiDailyTimeSlots),
    content: initialManualDraft.content,
    formattedContentEnabled: initialManualDraft.formattedContentEnabled,
    advancedContentEnabled: hasSavedAdvancedGroupSnapshot
      ? true
      : (campaign?.extraSettings?.advancedContentEnabled ?? false),
    advancedContentItems: initialAdvancedContentItems,
    // Email
    emailSubject: initialManualDraft.emailSubject,
    emailBodyIsHtml: initialManualDraft.emailBodyIsHtml,
    emailCheckLinkClicks: campaign?.extraSettings?.emailCheckLinkClicks ?? false,
    smsUseUnicode: campaign ? (campaign.extraSettings?.smsUseUnicode ?? false) : false,
    smsKeepNewLines: campaign ? (campaign.extraSettings?.smsKeepNewLines ?? false) : false,
    internalSmsEnabled: campaign?.extraSettings?.internalSmsEnabled ?? false,
    internalSmsAccountIds: getCampaignIdList(campaign?.extraSettings?.internalSmsAccountIds),
    internalSmsContent: campaign?.extraSettings?.internalSmsContent || '',
    internalSmsStatuses: Array.isArray(campaign?.extraSettings?.internalSmsStatuses)
      ? campaign.extraSettings.internalSmsStatuses.map(status => String(status || '').trim().toLocaleLowerCase('vi-VN')).filter(Boolean)
      : [] as string[],
    internalSmsCreatedCampaignIdsByAccount: cloneFromId
      ? {} as Record<string, number>
      : { ...(campaign?.extraSettings?.internalSmsCreatedCampaignIdsByAccount || {}) } as Record<string, number>,
    externalSmsEnabled: campaign?.extraSettings?.externalSmsEnabled ?? false,
    externalSmsShopIds: getCampaignIdList(campaign?.extraSettings?.externalSmsShopIds),
    externalSmsContent: campaign?.extraSettings?.externalSmsContent || '',
    externalSmsStatuses: Array.isArray(campaign?.extraSettings?.externalSmsStatuses)
      ? campaign.extraSettings.externalSmsStatuses.map(status => String(status || '').trim().toLocaleLowerCase('vi-VN')).filter(Boolean)
      : [] as string[],
    // Extra settings
    sharePost: campaign?.extraSettings?.sharePost ?? false,
    postWithBackground: campaign?.extraSettings?.postWithBackground ?? false,
    rewriteContentEachRun: initialManualDraft.rewriteContentEachRun,
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
    rateLimitMinutes: campaign?.extraSettings?.actionLimits?.rateLimitMinutes
      ?? (initialActionId === VOICE_CALL_ACTION_ID ? VOICE_CALL_DEFAULT_RATE_LIMIT_MINUTES : DEFAULT_RATE_LIMIT_MINUTES),
    continueWhenActionLimitReached: initialContinueWhenActionLimitReached,
    recentDeliveryCooldownEnabled: campaign?.extraSettings?.recentDeliveryCooldownEnabled ?? false,
    recentDeliveryCooldownDays: normalizeRecentDeliveryCooldownDays(
      campaign?.extraSettings?.recentDeliveryCooldownDays ?? DEFAULT_RECENT_DELIVERY_COOLDOWN_DAYS
    ),
    actionLimitsByCode: Object.fromEntries(
      Object.entries(campaign?.extraSettings?.actionLimits?.byActionCode || {}).map(([code, limit]) => [
        code,
        toActionLimitForm(limit, {
          dailyLimit: campaign?.extraSettings?.actionLimits?.dailyLimit ?? 30,
          rateLimitCount: campaign?.extraSettings?.actionLimits?.rateLimitCount ?? 9,
          rateLimitMinutes: campaign?.extraSettings?.actionLimits?.rateLimitMinutes
            ?? (initialActionId === VOICE_CALL_ACTION_ID ? VOICE_CALL_DEFAULT_RATE_LIMIT_MINUTES : DEFAULT_RATE_LIMIT_MINUTES)
        })
      ])
    ) as Record<string, ActionLimitForm>,
    imageOption: (campaign?.extraSettings?.imageOption || 'none') as 'none' | 'all' | 'random',
    randomImageCount: campaign?.extraSettings?.randomImageCount || 3,
    images: (campaign?.images || []) as CampaignMediaInput[],
    commentImageOption: savedCommentImageOption,
    commentImages: savedCommentImages as CampaignMediaInput[],
    splitDataAcrossAccounts: false,
    leaveGroupOnPendingApproval: campaign?.extraSettings?.leaveGroupOnPendingApproval ?? false,
    autoJoinGroupAfterPost: campaign?.extraSettings?.autoJoinGroupAfterPost ?? false,
    shuffleGroupList: campaign?.extraSettings?.shuffleGroupList ?? false,
    skipPostIfGroupRequiresApproval: campaign?.extraSettings?.skipPostIfGroupRequiresApproval ?? false,
    enableGroupPostShareToJoinedGroups: campaign?.extraSettings?.enableGroupPostShareToJoinedGroups ?? false,
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
    enableAddFriend: campaign?.extraSettings?.enableAddFriend ?? initialIsZaloFriendRecommendationCampaign,
    useSuggestedFriends: campaign?.extraSettings?.useSuggestedFriends ?? false,
    suggestedFriendsCount: campaign?.extraSettings?.suggestedFriendsCount ?? 10,
    friendRequestMessage: campaign?.extraSettings?.friendRequestMessage || '',
    zaloFriendRecommendationCount: campaign?.extraSettings?.zaloFriendRecommendationCount ?? 10,
    zaloCancelFriendRequestLimit: campaign?.extraSettings?.zaloCancelFriendRequestLimit ?? 10,
    zaloAddGroupMemberTargetGroupId: campaign?.extraSettings?.zaloAddGroupMemberTargetGroupId || '',
    zaloAddGroupMemberTargetGroupName: campaign?.extraSettings?.zaloAddGroupMemberTargetGroupName || '',
    zaloAddGroupMemberUseShareMethod: campaign?.extraSettings?.zaloAddGroupMemberUseShareMethod ?? false,
    facebookGroupInviteTargetGroupUid: campaign?.extraSettings?.facebookGroupInviteTargetGroupUid || '',
    facebookGroupInviteTargetGroupUrl: campaign?.extraSettings?.facebookGroupInviteTargetGroupUrl || '',
    facebookGroupInviteTargetGroupName: campaign?.extraSettings?.facebookGroupInviteTargetGroupName || '',
    zaloRealtimeTriggers: normalizeZaloRealtimeTriggers(campaign?.extraSettings?.zaloRealtimeTriggers),
    zaloRealtimeGroupIds: Array.isArray(campaign?.extraSettings?.zaloRealtimeGroupIds)
      ? campaign.extraSettings.zaloRealtimeGroupIds.map(id => String(id || '').trim()).filter(Boolean)
      : [] as string[],
    zaloRealtimeGroupNames: Array.isArray(campaign?.extraSettings?.zaloRealtimeGroupNames)
      ? campaign.extraSettings.zaloRealtimeGroupNames.map(name => String(name || '').trim())
      : [] as string[],
    zaloRealtimeEndDate: initRealtimeEndDate(),
    enableZaloTag: campaign?.extraSettings?.enableZaloTag ?? false,
    zaloTagId: campaign?.extraSettings?.zaloTagId ?? '',
    zaloTagName: campaign?.extraSettings?.zaloTagName || '',
    enableAkaBizTag: campaign?.extraSettings?.enableAkaBizTag ?? false,
    akaBizTagIds: getCampaignIdList(campaign?.extraSettings?.akaBizTagIds),
    akaBizTagNames: Array.isArray(campaign?.extraSettings?.akaBizTagNames)
      ? campaign.extraSettings.akaBizTagNames.map(name => String(name || '').trim())
      : [] as string[],
    enableZaloAlias: campaign?.extraSettings?.enableZaloAlias ?? false,
    zaloAliasTemplate: campaign?.extraSettings?.zaloAliasTemplate || getDefaultZaloAliasTemplate(initialActionId),
    zaloMessageSendMode: (campaign?.extraSettings?.zaloMessageSendMode || 'normal') as ZaloMessageSendMode,
    zaloOptOutLinkEnabled: campaign?.extraSettings?.zaloOptOutLinkEnabled ?? false,
    zaloFriendTargetMode: (campaign?.extraSettings?.zaloFriendTargetMode || 'selected') as ZaloFriendTargetMode,
    zaloFriendSourceTagIds: normalizeZaloTagIdList(campaign?.extraSettings?.zaloFriendSourceTagIds),
    zaloFriendSourceTagNames: normalizeZaloTagNameList(campaign?.extraSettings?.zaloFriendSourceTagNames),
    zaloFriendBlocklistEnabled: campaign?.extraSettings?.zaloFriendBlocklistEnabled ?? false,
    zaloFriendBlocklistId: campaign?.extraSettings?.zaloFriendBlocklistId ?? null as number | null,
    zaloFriendBlocklistName: campaign?.extraSettings?.zaloFriendBlocklistName || '',
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
    findPhoneZaloMessagePhoneTargetCampaignIds: campaign?.extraSettings?.findPhoneZaloMessagePhoneTargetCampaignIds || [] as number[],
    findZaloGroupLinkWebTargetCampaignIds: campaign?.extraSettings?.findZaloGroupLinkWebTargetCampaignIds || [] as number[],
    findZaloGroupLinkJoinTargetCampaignIds: campaign?.extraSettings?.findZaloGroupLinkJoinTargetCampaignIds || [] as number[],
    findPhoneAkaBizDesktopTargetCampaignIds: campaign?.extraSettings?.findPhoneAkaBizDesktopTargetCampaignIds || [] as number[],
    findZaloGroupLinkAkaBizDesktopTargetCampaignIds: campaign?.extraSettings?.findZaloGroupLinkAkaBizDesktopTargetCampaignIds || [] as number[],
    findFacebookGroupPostTargetCampaignIds: campaign?.extraSettings?.findFacebookGroupPostTargetCampaignIds || [] as number[],
    findFacebookGroupCommentTargetCampaignIds: campaign?.extraSettings?.findFacebookGroupCommentTargetCampaignIds || [] as number[],
    findFacebookGroupJoinTargetCampaignIds: campaign?.extraSettings?.findFacebookGroupJoinTargetCampaignIds || [] as number[],
    findDataTargetDataGroups: {
      ...(campaign?.extraSettings?.findDataTargetDataGroups || {})
    } as FindDataTargetDataGroups
  })
  const [advancedContentSourceMode, setAdvancedContentSourceMode] = useState<AdvancedContentSourceMode>(
    initialAdvancedContentSourceMode
  )
  const [contentSettingsTab, setContentSettingsTab] = useState<ContentSettingsTab>(
    campaign?.extraSettings?.copyContentFromSource === true ||
    campaign?.extraSettings?.sharePost === true
      ? 'source'
      : 'content'
  )
  const [manualAdvancedContentModalOpen, setManualAdvancedContentModalOpen] = useState(false)
  const [manualAdvancedContentSelectedId, setManualAdvancedContentSelectedId] = useState<string | null>(
    initialAdvancedContentItems[0]?.id ?? null
  )
  const [manualAdvancedPreviewUsesSampleData, setManualAdvancedPreviewUsesSampleData] = useState(true)
  const [manualAdvancedPreviewSeed, setManualAdvancedPreviewSeed] = useState(0)
  const [manualAdvancedTemplatePickerOpen, setManualAdvancedTemplatePickerOpen] = useState(false)
  const [manualAdvancedPickedVariants, setManualAdvancedPickedVariants] = useState<string[]>([])
  const manualAdvancedContentTriggerRef = useRef<HTMLButtonElement>(null)
  const manualAdvancedContentCloseRef = useRef<HTMLButtonElement>(null)
  const manualAdvancedContentModalRef = useRef<HTMLDivElement>(null)
  const manualAdvancedTemplatePickerRef = useRef<HTMLDivElement>(null)
  const manualAdvancedTemplatePickerReturnFocusRef = useRef<HTMLElement | null>(null)
  const [candidateContentTemplateGroupId, setCandidateContentTemplateGroupId] = useState<number | null>(
    savedAdvancedGroupSnapshot?.groupId ?? null
  )
  const [pendingContentTemplateGroupId, setPendingContentTemplateGroupId] = useState<number | null>(null)
  const manualAdvancedContentItemsRef = useRef<CampaignAdvancedContentItem[]>(
    initialAdvancedContentItems
  )
  const savedGroupAdvancedContentItemsRef = useRef<CampaignAdvancedContentItem[]>(
    hasSavedAdvancedGroupSnapshot
      ? initialActiveAdvancedContentItems
      : []
  )
  useEffect(() => {
    if (advancedContentSourceMode === 'manual') {
      manualAdvancedContentItemsRef.current = normalizeAdvancedContentItems(formData.advancedContentItems)
    }
  }, [advancedContentSourceMode, formData.advancedContentItems])
  useEffect(() => {
    if (!manualAdvancedContentModalOpen) return
    const items = formData.advancedContentItems
    if (manualAdvancedContentSelectedId && items.some(item => item.id === manualAdvancedContentSelectedId)) return
    setManualAdvancedContentSelectedId(items[0]?.id ?? null)
  }, [formData.advancedContentItems, manualAdvancedContentModalOpen, manualAdvancedContentSelectedId])
  useEffect(() => {
    if (!manualAdvancedContentModalOpen || uiAlert.isOpen || uiConfirm.isOpen) return

    const focusFrame = window.requestAnimationFrame(() => {
      manualAdvancedContentCloseRef.current?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasNestedOverlay = document.querySelector('.media-library-overlay, .content-preview-overlay, .campaign-manual-template-picker-overlay, .content-template-save-modal') !== null
      if (hasNestedOverlay) return

      if (event.key === 'Escape') {
        event.preventDefault()
        setManualAdvancedContentModalOpen(false)
        if (activeRichContentEditorRef.current?.itemId) activeRichContentEditorRef.current = null
        window.requestAnimationFrame(() => manualAdvancedContentTriggerRef.current?.focus())
        return
      }
      if (event.key !== 'Tab') return

      const modal = manualAdvancedContentModalRef.current
      if (!modal) return
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
      )).filter(element => element.getAttribute('aria-hidden') !== 'true')
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement
      if (event.shiftKey && (activeElement === first || !modal.contains(activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (activeElement === last || !modal.contains(activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [manualAdvancedContentModalOpen, uiAlert.isOpen, uiConfirm.isOpen])
  useEffect(() => {
    if (!manualAdvancedTemplatePickerOpen || uiAlert.isOpen || uiConfirm.isOpen) return

    const focusFrame = window.requestAnimationFrame(() => {
      const picker = manualAdvancedTemplatePickerRef.current
      const firstFocusable = picker?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      const focusTarget = firstFocusable || picker
      focusTarget?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      const picker = manualAdvancedTemplatePickerRef.current
      if (!picker) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setManualAdvancedTemplatePickerOpen(false)
        setManualAdvancedPickedVariants([])
        const returnFocusTarget = manualAdvancedTemplatePickerReturnFocusRef.current
        manualAdvancedTemplatePickerReturnFocusRef.current = null
        window.requestAnimationFrame(() => returnFocusTarget?.focus())
        return
      }
      if (event.key !== 'Tab') return
      event.stopPropagation()

      const focusable = Array.from(picker.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
      )).filter(element => element.getAttribute('aria-hidden') !== 'true')
      if (focusable.length === 0) {
        event.preventDefault()
        picker.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement
      if (event.shiftKey && (activeElement === first || !picker.contains(activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (activeElement === last || !picker.contains(activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [manualAdvancedTemplatePickerOpen, uiAlert.isOpen, uiConfirm.isOpen])
  const campaignNameValueRef = useRef(formData.name)
  const campaignNameUserEditedRef = useRef(Boolean((campaign?.name || '').trim()))
  const lastAiCampaignNameRef = useRef('')
  const campaignNameAiRequestSeqRef = useRef(0)
  const campaignNameAiCacheRef = useRef<Map<string, string>>(new Map())
  const dataGroupBundleRequestIdRef = useRef<string | null>(null)
  const dataGroupBundleFingerprintRef = useRef<string | null>(null)
  const [expandedRateLimitMinuteActions, setExpandedRateLimitMinuteActions] = useState<Record<string, boolean>>({})
  const [editedRateLimitMinuteActions, setEditedRateLimitMinuteActions] = useState<Record<string, boolean>>({})
  const [mediaPickerTarget, setMediaPickerTarget] = useState<MainMediaPickerTarget | null>(null)
  const localMediaPickerTargetRef = useRef<MainMediaPickerTarget | null>(null)
  const localImageInputRef = useRef<HTMLInputElement>(null)
  const localVideoInputRef = useRef<HTMLInputElement>(null)
  const localImageVideoInputRef = useRef<HTMLInputElement>(null)
  const localFileInputRef = useRef<HTMLInputElement>(null)
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
  const [handleFoundPhoneZaloMessagePhoneData, setHandleFoundPhoneZaloMessagePhoneData] = useState(() =>
    (campaign?.extraSettings?.findPhoneZaloMessagePhoneTargetCampaignIds || []).length > 0
  )
  const [handleFoundZaloGroupLinkWebData, setHandleFoundZaloGroupLinkWebData] = useState(() =>
    (campaign?.extraSettings?.findZaloGroupLinkWebTargetCampaignIds || []).length > 0
  )
  const [handleFoundZaloGroupLinkJoinData, setHandleFoundZaloGroupLinkJoinData] = useState(() =>
    (campaign?.extraSettings?.findZaloGroupLinkJoinTargetCampaignIds || []).length > 0
  )
  const [handleFoundPhoneAkaBizDesktopData, setHandleFoundPhoneAkaBizDesktopData] = useState(() =>
    (campaign?.extraSettings?.findPhoneAkaBizDesktopTargetCampaignIds || []).length > 0
  )
  const [handleFoundZaloGroupLinkAkaBizDesktopData, setHandleFoundZaloGroupLinkAkaBizDesktopData] = useState(() =>
    (campaign?.extraSettings?.findZaloGroupLinkAkaBizDesktopTargetCampaignIds || []).length > 0
  )
  const [handleFoundFacebookGroupPostData, setHandleFoundFacebookGroupPostData] = useState(() =>
    draftRequiredTargetField === 'findFacebookGroupPostTargetCampaignIds' ||
    (campaign?.extraSettings?.findFacebookGroupPostTargetCampaignIds || []).length > 0
  )
  const [handleFoundFacebookGroupCommentData, setHandleFoundFacebookGroupCommentData] = useState(() =>
    draftRequiredTargetField === 'findFacebookGroupCommentTargetCampaignIds' ||
    (campaign?.extraSettings?.findFacebookGroupCommentTargetCampaignIds || []).length > 0
  )
  const [handleFoundFacebookGroupJoinData, setHandleFoundFacebookGroupJoinData] = useState(() =>
    draftRequiredTargetField === 'findFacebookGroupJoinTargetCampaignIds' ||
    (campaign?.extraSettings?.findFacebookGroupJoinTargetCampaignIds || []).length > 0
  )
  const [selectedFindDataSourceCampaignIds, setSelectedFindDataSourceCampaignIds] = useState<number[]>([])
  const findDataSourceSelectionTouchedRef = useRef(false)
  const findDataSourceSelectionScopeRef = useRef('')
  const [campaignPickerModal, setCampaignPickerModal] = useState<CampaignPickerModalState | null>(null)
  const [dataGroupPickerOpen, setDataGroupPickerOpen] = useState(false)
  const [dataGroupPickerMode, setDataGroupPickerMode] = useState<'source' | 'append'>('source')
  const [findDataGroupPickerKind, setFindDataGroupPickerKind] = useState<FindDataOutputKind | null>(null)
  const [findDataTargetDataGroupEnabled, setFindDataTargetDataGroupEnabled] = useState<FindDataTargetDataGroupEnabledState>(() => ({
    phone: Boolean(campaign?.extraSettings?.findDataTargetDataGroups?.phone),
    zalo_group_link: Boolean(campaign?.extraSettings?.findDataTargetDataGroups?.zalo_group_link),
    facebook_uid: Boolean(campaign?.extraSettings?.findDataTargetDataGroups?.facebook_uid),
    post_link: Boolean(campaign?.extraSettings?.findDataTargetDataGroups?.post_link),
    facebook_group: Boolean(campaign?.extraSettings?.findDataTargetDataGroups?.facebook_group)
  }))
  const [findDataTargetDataGroupDetails, setFindDataTargetDataGroupDetails] = useState<FindDataTargetDataGroupDetails>({})
  const [resolvedFindDataTargetDataGroupIdsKey, setResolvedFindDataTargetDataGroupIdsKey] = useState('')
  const [failedFindDataTargetDataGroupIdsKey, setFailedFindDataTargetDataGroupIdsKey] = useState('')
  const [findDataTargetDataGroupHydrationRetry, setFindDataTargetDataGroupHydrationRetry] = useState(0)
  const [directDataGroupSnapshots, setDirectDataGroupSnapshots] = useState<DirectDataGroupSnapshotIntent[]>(() => {
    const snapshotsByGroupId = new Map<number, DirectDataGroupSnapshotIntent>()
    for (const snapshot of initialDataGroupSnapshots || []) {
      const groupId = Number(snapshot.groupId)
      if (!Number.isSafeInteger(groupId) || groupId <= 0 || snapshotsByGroupId.has(groupId)) continue
      snapshotsByGroupId.set(groupId, {
        groupId,
        groupName: String(snapshot.groupName || '').trim() || `Nhóm ${groupId}`,
        dataTypeCategoryItemId: getPositiveInteger(snapshot.dataTypeCategoryItemId)
      })
    }
    return Array.from(snapshotsByGroupId.values())
  })
  const [selectedDataGroupName, setSelectedDataGroupName] = useState(initialDataGroup?.name || '')
  const [selectedDataGroup, setSelectedDataGroup] = useState<DataGroup | null>(initialDataGroup || null)
  const [dataGroupTargetPreview, setDataGroupTargetPreview] = useState<DataGroupCampaignTargetPreview[]>([])
  const [dataGroupTargetPreviewStatus, setDataGroupTargetPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [campaignPickerRefreshing, setCampaignPickerRefreshing] = useState(false)
  const [contentTemplates, setContentTemplates] = useState<ContentTemplate[]>([])
  const [contentTemplateGroups, setContentTemplateGroups] = useState<ContentTemplateGroup[]>([])
  const [contentTemplatesLoading, setContentTemplatesLoading] = useState(false)
  const [contentTemplatePicker, setContentTemplatePicker] = useState<ContentTemplatePickerModalState | null>(null)
  const [contentTemplateSaveModal, setContentTemplateSaveModal] = useState<ContentTemplateSaveModalState | null>(null)
  const [previewContentTemplateGroupId, setPreviewContentTemplateGroupId] = useState<number | null>(null)
  const [previewContentTemplateId, setPreviewContentTemplateId] = useState<number | null>(null)
  const [previewContentTemplateChannel, setPreviewContentTemplateChannel] = useState<ContentTemplateChannelName | null>(null)
  const [contentTemplateGroupSearch, setContentTemplateGroupSearch] = useState('')
  const [contentTemplateGroupStatus, setContentTemplateGroupStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [contentTemplateSaving, setContentTemplateSaving] = useState(false)
  const [contentPreviewModal, setContentPreviewModal] = useState<ContentPreviewModalData | null>(null)
  const [zaloLabels, setZaloLabels] = useState<ZaloLabelOption[]>([])
  const [zaloLabelsLoading, setZaloLabelsLoading] = useState(false)
  const [zaloLabelsSyncing, setZaloLabelsSyncing] = useState(false)
  const [zaloLabelsError, setZaloLabelsError] = useState('')
  const [akaBizContactTags, setAkaBizContactTags] = useState<AkaBizContactTag[]>([])
  const [akaBizContactTagsLoading, setAkaBizContactTagsLoading] = useState(false)
  const [zaloFriendBlocklists, setZaloFriendBlocklists] = useState<AutoAccountContactGroup[]>([])
  const [zaloFriendBlocklistsLoading, setZaloFriendBlocklistsLoading] = useState(false)
  const [zaloRealtimeGroups, setZaloRealtimeGroups] = useState<AutoAccountContact[]>([])
  const [zaloRealtimeGroupsLoading, setZaloRealtimeGroupsLoading] = useState(false)
  const [facebookGroupInviteGroups, setFacebookGroupInviteGroups] = useState<AutoAccountContact[]>([])
  const [facebookGroupInviteGroupsLoading, setFacebookGroupInviteGroupsLoading] = useState(false)
  const [internalCampaignDrafts, setInternalCampaignDrafts] = useState<InternalCampaignDraft[]>([])
  const [draftFormConfig, setDraftFormConfig] = useState<{
    tempId: number
    sourceType: InternalCampaignPickerSourceType
    actionId: string
    requiredTargetField?: FindDataTargetCampaignField | null
    initialCampaign?: CampaignConfig | null
    initialAccountIds?: number[]
    initialDetails?: Partial<CampaignInputData>[]
    initialDataGroupSnapshots?: DirectDataGroupSnapshotIntent[]
    submitLabel?: string
    autoSelectOnSave?: boolean
  } | null>(null)
  const [viewingSourceCampaign, setViewingSourceCampaign] = useState<CampaignConfig | null>(null)
  const [editingSourceCampaign, setEditingSourceCampaign] = useState<CampaignConfig | null>(null)
  const [selectedActionPlatformFilter, setSelectedActionPlatformFilter] = useState('')
  const nextDraftCampaignTempIdRef = useRef(-1)
  const previousZaloAliasActionIdRef = useRef(initialActionId)

  // Determine if this is a "simple" campaign (no details/extra sections)
  const isSimpleCampaign = SIMPLE_CAMPAIGN_ACTIONS.has(formData.actionId)
  const canUseDataGroupSource = actionSupportsDataGroup(formData.actionId)
  const isDataGroupSource = canUseDataGroupSource && formData.dataTargetSourceMode === 'data_group'
  const isMessageCampaign = MESSAGE_CAMPAIGN_ACTIONS.has(formData.actionId)
  const isEmailCampaign = formData.actionId === EMAIL_SEND_ACTION_ID
  const isSmsCampaign = formData.actionId === SMS_SEND_ACTION_ID
  const isVoiceCallCampaign = formData.actionId === VOICE_CALL_ACTION_ID
  const isMobileManagedSmsCampaign = isSmsCampaign || isVoiceCallCampaign
  const canUseFormattedContent = supportsFormattedContent(formData.actionId)
  const isFormattedContentEnabled = canUseFormattedContent && formData.formattedContentEnabled
  const isRichContentEditorEnabled = (isEmailCampaign && formData.emailBodyIsHtml) || isFormattedContentEnabled
  const smsContentCounts = useMemo(
    () => countSmsContentVariants(formData.content, {
      useUnicode: formData.smsUseUnicode,
      keepNewLines: formData.smsKeepNewLines
    }),
    [formData.content, formData.smsUseUnicode, formData.smsKeepNewLines]
  )
  const smsContentCountLabels = useMemo(
    () => smsContentCounts.map((item, index) => {
      const prefix = smsContentCounts.length > 1 ? `Mẫu ${index + 1}: ` : ''
      return `${prefix}${item.countChar} ký tự, ${item.countSms} tin`
    }),
    [smsContentCounts]
  )
  const friendRequestMessageMaxLength = useMemo(
    () => renderContentSpinMax(formData.friendRequestMessage).length,
    [formData.friendRequestMessage]
  )
  const isMessageFriendCampaign = formData.actionId === MESSAGE_FRIEND_ACTION_ID
  const isMessageUidCampaign = formData.actionId === MESSAGE_UID_ACTION_ID
  const isZaloMessagePhoneCampaign = formData.actionId === ZALO_MESSAGE_PHONE_ACTION_ID
  const isZaloMessageFriendCampaign = formData.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID
  const isZaloMessageBirthdayCampaign = formData.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID
  const isZaloMessageGroupMemberCampaign = formData.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID
  const isZaloMessageGroupRealtimeCampaign = formData.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID
  const isZaloMessageRemarketingCustomerCampaign = formData.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID
  const isZaloMessageFriendRecommendationCampaign = formData.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
  const isZaloMessageGroupCampaign = formData.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
  const isZaloAddGroupMemberCampaign = formData.actionId === ZALO_ADD_GROUP_MEMBER_ACTION_ID
  const isZaloJoinGroupLinkCampaign = formData.actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID
  const isZaloCancelSentFriendRequestCampaign = formData.actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
  const isZaloMessageCampaign = isZaloMessagePhoneCampaign || isZaloMessageFriendCampaign || isZaloMessageBirthdayCampaign || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign || isZaloMessageGroupCampaign
  const isZaloGroupSelectionCampaign = isZaloMessageGroupRealtimeCampaign || isZaloAddGroupMemberCampaign
  const supportsExternalSmsPush = isZaloMessagePhoneCampaign || isZaloMessageGroupMemberCampaign
  const usesInternalSmsPush = supportsExternalSmsPush && canUseInternalSmsFeature
  const internalSmsAccounts = useMemo(
    () => accounts.filter(account => account.flatformType === 'sms' && !account.isDelete && account.isActive !== false),
    [accounts]
  )
  const isPhoneInputCampaign = isZaloMessagePhoneCampaign || isMobileManagedSmsCampaign
  const isPhoneOrUidInputCampaign = isZaloAddGroupMemberCampaign
  const isZaloShareMessageMode = (isZaloMessageFriendCampaign || isZaloMessageGroupCampaign) && formData.zaloMessageSendMode === 'share' && !isFormattedContentEnabled
  const supportsZaloOptOutLink = isZaloMessageCampaign && !isZaloMessageGroupCampaign && !isZaloShareMessageMode
  const supportsAkaBizContactTags = isZaloMessageCampaign && !isZaloMessageBirthdayCampaign && !isZaloShareMessageMode
  const defaultZaloAliasTemplate = getDefaultZaloAliasTemplate(formData.actionId)
  const isPageInboxMessageCampaign = formData.actionId === PAGE_INBOX_MESSAGE_ACTION_ID
  const isGroupPostCampaign = GROUP_POST_ACTIONS.has(formData.actionId)
  const isFacebookGroupPostCampaign = formData.actionId === 'facebook_group_post'
  const isFacebookJoinGroupCampaign = formData.actionId === FACEBOOK_JOIN_GROUP_ACTION_ID
  const isFacebookGroupInviteCampaign = formData.actionId === FACEBOOK_GROUP_INVITE_ACTION_ID
  const isTimelinePostCampaign = TIMELINE_POST_ACTIONS.has(formData.actionId)
  const isPagePostCampaign = formData.actionId === PAGE_POST_ACTION_ID
  const supportsSourceContent = isTimelinePostCampaign || isFacebookGroupPostCampaign
  const isSourceContentMode = supportsSourceContent && contentSettingsTab === 'source'
  const isNewsfeedInteractionCampaign = formData.actionId === NEWSFEED_INTERACTION_ACTION_ID
  const isFindDataGroupCampaign = FIND_DATA_GROUP_ACTIONS.has(formData.actionId)
  const isFindDataSearchCampaign = FIND_DATA_SEARCH_ACTIONS.has(formData.actionId)
  const isFindDataCampaign = isFindDataGroupCampaign || isFindDataSearchCampaign
  const isCommentSeedingCampaign = COMMENT_SEEDING_ACTIONS.has(formData.actionId)
  const isCommentSeedingFeedCampaign = COMMENT_SEEDING_FEED_ACTIONS.has(formData.actionId)
  const isCommentSeedingPostCampaign = COMMENT_SEEDING_POST_ACTIONS.has(formData.actionId)
  const isReelsMediaMode = formData.actionId === 'facebook_timeline_post' && formData.postAsReels && !isSourceContentMode
  const mainMediaSelectionMode: MediaSelectionMode = isZaloMessageCampaign || isEmailCampaign
    ? 'file'
    : isReelsMediaMode
      ? 'video'
      : formData.actionId.startsWith('facebook_') && !(isPagePostCampaign && formData.pagePostMode === 'api')
        ? 'image-video'
        : 'image'
  const canUseRerunAfterCompletion = isFindDataCampaign || isCommentSeedingFeedCampaign || isNewsfeedInteractionCampaign
  const canUseSleepBetweenActions = formData.actionId !== 'facebook_timeline_post' && !isNewsfeedInteractionCampaign && !isFacebookGroupInviteCampaign
  const isEditingSavedCampaign = !!campaign?.id && !cloneFromId
  const isSavedDataGroupIdentityLocked = isEditingSavedCampaign && campaign?.dataTargetSourceMode === 'data_group'
  const hasPendingDirectDataGroupSnapshots = canUseDataGroupSource && !isDataGroupSource && directDataGroupSnapshots.length > 0
  const hasZaloFriendRecommendationMaterialized = isZaloMessageFriendRecommendationCampaign && isEditingSavedCampaign && Boolean(campaign?.extraSettings?.zaloFriendRecommendationDataMaterializedAt)
  const zaloFriendRecommendationMaterializedCount = campaign?.extraSettings?.zaloFriendRecommendationMaterializedCount ?? 0
  const hasZaloCancelFriendRequestMaterialized = isZaloCancelSentFriendRequestCampaign && isEditingSavedCampaign && Boolean(campaign?.extraSettings?.zaloCancelFriendRequestDataMaterializedAt)
  const zaloCancelFriendRequestMaterializedCount = campaign?.extraSettings?.zaloCancelFriendRequestMaterializedCount ?? 0
  const isSuggestedFriendsUidCampaign = isMessageUidCampaign && formData.useSuggestedFriends
  const isZaloFriendAutoDataMode = isZaloMessageFriendCampaign && formData.zaloFriendTargetMode !== 'selected'
  const hideDetailsSection = (isSuggestedFriendsUidCampaign && !isEditingSavedCampaign) || isZaloFriendAutoDataMode || isZaloMessageBirthdayCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageFriendRecommendationCampaign || isZaloCancelSentFriendRequestCampaign
  const targetFindDataField = getFindDataTargetCampaignField(formData.actionId)
  const findDataSourceSectionLabel = getFindDataSourceSectionLabel(formData.actionId)
  const findDataSourceStep = getFindDataSourceStep(findDataSourceSectionLabel)
  const isDraftTargetFromFindData = draftMode && (
    draftPickerSourceType === 'messageUidTarget' ||
    draftPickerSourceType === 'postLinkTarget' ||
    draftPickerSourceType === 'groupPostTarget' ||
    draftPickerSourceType === 'groupCommentTarget' ||
    draftPickerSourceType === 'zaloMessagePhoneTarget' ||
    draftPickerSourceType === 'zaloJoinGroupLinkTarget' ||
    draftPickerSourceType === 'facebookJoinGroupTarget'
  )
  const isDraftSourceForTarget = draftMode && draftPickerSourceType === 'findDataSource'
  const isDraftAutoLinkedFindUid = isDraftSourceForTarget && draftRequiredTargetField === 'findUidTargetCampaignIds'
  const isDraftAutoLinkedPostLink = isDraftSourceForTarget && draftRequiredTargetField === 'findPostLinkTargetCampaignIds'
  const isDraftAutoLinkedFacebookGroupPost = isDraftSourceForTarget && draftRequiredTargetField === 'findFacebookGroupPostTargetCampaignIds'
  const isDraftAutoLinkedFacebookGroupComment = isDraftSourceForTarget && draftRequiredTargetField === 'findFacebookGroupCommentTargetCampaignIds'
  const isDraftAutoLinkedFacebookGroupJoin = isDraftSourceForTarget && draftRequiredTargetField === 'findFacebookGroupJoinTargetCampaignIds'
  const isDraftAutoLinkedFacebookGroup = isDraftAutoLinkedFacebookGroupPost || isDraftAutoLinkedFacebookGroupComment || isDraftAutoLinkedFacebookGroupJoin
  const hasSelectedCampaignAction = !!formData.actionId
  const canPickGroups = isGroupPostCampaign || isCommentSeedingFeedCampaign || isZaloMessageGroupCampaign
  const canPickPages = isPagePostCampaign
  const canPickFriends = isMessageFriendCampaign || isFacebookGroupInviteCampaign || (isZaloMessageFriendCampaign && formData.zaloFriendTargetMode === 'selected')
  const canPickZaloGroupMembers = isZaloMessageGroupMemberCampaign || isZaloAddGroupMemberCampaign
  const canPickZaloAddGroupMemberFriends = isZaloAddGroupMemberCampaign
  const canPickZaloRemarketingCustomers = isZaloMessageRemarketingCustomerCampaign
  const canPickUidData = isMessageUidCampaign && !isSuggestedFriendsUidCampaign
  const canPickPageInboxCustomers = isPageInboxMessageCampaign
  const canUseOtherDataSources = isZaloMessagePhoneCampaign && !isEditingSavedCampaign
  const canUploadData = !isMessageFriendCampaign && !isFacebookGroupInviteCampaign && !isSuggestedFriendsUidCampaign && !isPagePostCampaign && !isPageInboxMessageCampaign && !isZaloMessageFriendCampaign && !isZaloMessageBirthdayCampaign && !isZaloMessageGroupMemberCampaign && !isZaloMessageGroupRealtimeCampaign && !isZaloMessageRemarketingCustomerCampaign && !isZaloMessageFriendRecommendationCampaign && !isZaloMessageGroupCampaign && !isZaloCancelSentFriendRequestCampaign
  const showActionOptionsSection = isMessageUidCampaign || isFacebookGroupInviteCampaign || isZaloMessagePhoneCampaign || isZaloMessageFriendCampaign || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign || isZaloMessageGroupCampaign || isZaloAddGroupMemberCampaign || isZaloCancelSentFriendRequestCampaign
  const needsZaloLabels =
    ((isZaloMessagePhoneCampaign || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign) && formData.enableZaloTag) ||
    (isZaloMessageFriendCampaign && ((!isZaloShareMessageMode && formData.enableZaloTag) || formData.zaloFriendTargetMode === 'tagged_friends'))
  const selectedZaloFriendBlocklist = zaloFriendBlocklists.find(group => group.id === formData.zaloFriendBlocklistId) || null
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
  const supportsFindDataSourceLink = !!targetFindDataField && !hideDetailsSection
  // Source links are configured from the find-data campaign. Keep relation
  // support for target drafts created there, but hide the reverse picker here.
  const showFindDataSourceSection = false
  const hasSelectedFindDataSourceCampaign = supportsFindDataSourceLink && isDraftTargetFromFindData
  const supportsSourceSharePost = isTimelinePostCampaign && !isPagePostCampaign
  const supportsSourceReels = isTimelinePostCampaign && !isPagePostCampaign
  const isPostBackgroundCampaign = formData.actionId === 'facebook_timeline_post' || isPagePostCampaign || isFacebookGroupPostCampaign
  const isMultiDailyTimeSlotsCampaign =
    formData.actionId === 'facebook_timeline_post' ||
    isPagePostCampaign ||
    isZaloMessageFriendCampaign ||
    isZaloMessageGroupCampaign
  const usesMultiDailyTimeSlots =
    !isDataGroupSource &&
    isMultiDailyTimeSlotsCampaign &&
    formData.multiDailyTimeSlotsEnabled
  const isPostBackgroundApiModeDisabled = isPagePostCampaign && formData.pagePostMode === 'api'
  const hasSourceContentSelection = isSourceContentMode
  const isPostBackgroundSourceDisabled = isPostBackgroundCampaign && hasSourceContentSelection
  const isPostBackgroundDisabled = isPostBackgroundApiModeDisabled || isPostBackgroundSourceDisabled
  const canUsePostBackground = isPostBackgroundCampaign && !isPostBackgroundDisabled
  const isPostBackgroundActive = canUsePostBackground && formData.postWithBackground && !isFormattedContentEnabled
  const requiresSourceLinks = hasSourceContentSelection
  const hasSourceLinks = getSourceLinkEntries(formData.sourceLinks).length > 0
  const isUsingSourceContent = isSourceContentMode
  const usesSourceContentAiPrompt = isUsingSourceContent && formData.rewriteSourceContentWithAI
  const hasSourceContentAiPrompt = formData.sourceContentAiPrompt.trim().length > 0
  const requiresMainContentOrMedia =
    !isFindDataCampaign &&
    !isCommentSeedingCampaign &&
    !isNewsfeedInteractionCampaign &&
    !isUsingSourceContent &&
    (!isMessageUidCampaign || formData.enableMessage) &&
    (!isZaloMessagePhoneCampaign || formData.enableMessage) &&
    (!isZaloMessageGroupMemberCampaign || formData.enableMessage) &&
    (!isZaloMessageGroupRealtimeCampaign || formData.enableMessage) &&
    (!isZaloMessageRemarketingCustomerCampaign || formData.enableMessage) &&
    (!isZaloMessageFriendRecommendationCampaign || formData.enableMessage) &&
    !isFacebookJoinGroupCampaign &&
    !isFacebookGroupInviteCampaign &&
    !isZaloAddGroupMemberCampaign &&
    !isZaloJoinGroupLinkCampaign &&
    !isZaloCancelSentFriendRequestCampaign
  const canShowContentSection =
    !isFindDataCampaign &&
    !isNewsfeedInteractionCampaign &&
    !isFacebookJoinGroupCampaign &&
    !isFacebookGroupInviteCampaign &&
    !isZaloAddGroupMemberCampaign &&
    !isZaloJoinGroupLinkCampaign &&
    !isZaloCancelSentFriendRequestCampaign &&
    (!isMessageUidCampaign || formData.enableMessage) &&
    (!isZaloMessagePhoneCampaign || formData.enableMessage) &&
    (!isZaloMessageGroupMemberCampaign || formData.enableMessage) &&
    (!isZaloMessageGroupRealtimeCampaign || formData.enableMessage) &&
    (!isZaloMessageRemarketingCustomerCampaign || formData.enableMessage) &&
    (!isZaloMessageFriendRecommendationCampaign || formData.enableMessage)
  const normalizedAdvancedContentItems = normalizeAdvancedContentItems(formData.advancedContentItems)
  const resolveLegacyManualEmailSubject = (item: CampaignAdvancedContentItem): string => (
    String(item.emailSubject === undefined || item.emailSubject === null
      ? formData.emailSubject
      : item.emailSubject)
  )
  const advancedContentTargetChannel = getContentTemplateChannelForAction(formData.actionId)
  const savedAdvancedContentTargetChannel = getContentTemplateChannelForAction(campaign?.actionId)
  const savedGroupSnapshotMatchesTargetChannel = savedAdvancedContentTargetChannel !== null &&
    savedAdvancedContentTargetChannel === advancedContentTargetChannel
  const canUseAdvancedContentMode = canShowContentSection && !isVoiceCallCampaign && advancedContentTargetChannel !== null
  const isAdvancedContentMode = canUseAdvancedContentMode && formData.advancedContentEnabled && !isSourceContentMode
  const isAdvancedGroupSource = isAdvancedContentMode && advancedContentSourceMode === 'group'
  const isManualAdvancedSource = isAdvancedContentMode && advancedContentSourceMode === 'manual'
  const candidateContentTemplateGroup = useMemo(
    () => contentTemplateGroups.find(group => group.id === candidateContentTemplateGroupId) || null,
    [candidateContentTemplateGroupId, contentTemplateGroups]
  )
  const contentTemplateGroupCandidate = useMemo<ContentTemplateGroupCandidate | null>(() => {
    if (!candidateContentTemplateGroup || !advancedContentTargetChannel) return null
    return buildContentTemplateGroupCandidate(
      contentTemplates,
      candidateContentTemplateGroup,
      advancedContentTargetChannel,
      mainMediaSelectionMode
    )
  }, [advancedContentTargetChannel, candidateContentTemplateGroup, contentTemplates, mainMediaSelectionMode])
  const showSavedGroupSnapshotItems = isAdvancedGroupSource &&
    pendingContentTemplateGroupId === null &&
    savedAdvancedContentSource === 'group_snapshot' &&
    savedGroupSnapshotMatchesTargetChannel &&
    savedAdvancedGroupSnapshot?.groupId === candidateContentTemplateGroupId
  const savedGroupSnapshotIsRich = savedAdvancedContentTargetChannel === 'email'
    ? campaign?.extraSettings?.emailBodyIsHtml === true
    : campaign?.extraSettings?.formattedContentEnabled === true
  const preserveSavedGroupSnapshotOnSave = advancedContentSourceMode === 'group' &&
    pendingContentTemplateGroupId === null &&
    savedAdvancedContentSource === 'group_snapshot' &&
    !!savedAdvancedGroupSnapshot &&
    savedGroupSnapshotMatchesTargetChannel &&
    savedAdvancedGroupSnapshot.groupId === candidateContentTemplateGroupId
  const selectedContentTemplateGroupId = pendingContentTemplateGroupId
    ?? candidateContentTemplateGroupId
  const groupSnapshotDisplaySourceIsRich = showSavedGroupSnapshotItems
    ? savedGroupSnapshotIsRich
    : (contentTemplateGroupCandidate?.rich ?? savedGroupSnapshotIsRich)
  const groupSnapshotSaveSourceIsRich = preserveSavedGroupSnapshotOnSave
    ? savedGroupSnapshotIsRich
    : (contentTemplateGroupCandidate?.rich ?? false)
  const groupSnapshotTargetSupportsRich = advancedContentTargetChannel === 'email'
    ? isEmailCampaign
    : supportsFormattedContent(formData.actionId)
  const groupSnapshotMustUsePlain = (isAdvancedGroupSource || preserveSavedGroupSnapshotOnSave) && (
    !groupSnapshotTargetSupportsRich ||
    formData.zaloMessageSendMode === 'share' ||
    (canUsePostBackground && formData.postWithBackground)
  )
  const groupSnapshotEffectiveRich = isAdvancedGroupSource &&
    groupSnapshotDisplaySourceIsRich &&
    !groupSnapshotMustUsePlain
  const groupSnapshotSaveEffectiveRich = groupSnapshotSaveSourceIsRich &&
    !groupSnapshotMustUsePlain
  const rawAdvancedContentDisplayItems = isAdvancedGroupSource
    ? (showSavedGroupSnapshotItems
        ? savedGroupAdvancedContentItemsRef.current
        : (contentTemplateGroupCandidate?.items || []))
    : normalizedAdvancedContentItems
  const advancedContentDisplayItems = isAdvancedGroupSource &&
    groupSnapshotDisplaySourceIsRich &&
    groupSnapshotMustUsePlain
    ? rawAdvancedContentDisplayItems.map(item => ({
        ...item,
        content: formattedContentToPlainText(item.content)
      }))
    : rawAdvancedContentDisplayItems
  // Selecting a group in the dropdown is the user's choice. Preview remains
  // optional; save validates the latest group state before creating a snapshot.
  const advancedContentSaveValidationItems = (() => {
    if (!isAdvancedGroupSource) return normalizedAdvancedContentItems

    const usesSelectedCandidate = !preserveSavedGroupSnapshotOnSave &&
      selectedContentTemplateGroupId !== null &&
      contentTemplateGroupCandidate?.groupId === selectedContentTemplateGroupId
    const rawItems = usesSelectedCandidate
      ? (contentTemplateGroupCandidate?.items || [])
      : preserveSavedGroupSnapshotOnSave
        ? savedGroupAdvancedContentItemsRef.current
        : []
    const sourceIsRich = usesSelectedCandidate
      ? contentTemplateGroupCandidate?.rich === true
      : preserveSavedGroupSnapshotOnSave && savedGroupSnapshotIsRich

    return sourceIsRich && groupSnapshotMustUsePlain
      ? rawItems.map(item => ({
          ...item,
          content: formattedContentToPlainText(item.content)
        }))
      : rawItems
  })()
  const advancedContentDisplayIsRich = isAdvancedGroupSource
    ? groupSnapshotEffectiveRich
    : isRichContentEditorEnabled
  const hasMainContentText = isAdvancedContentMode
    ? advancedContentDisplayItems.some(item => advancedContentDisplayIsRich
      ? !isFormattedContentEmpty(item.content)
      : String(item.content || '').trim().length > 0)
    : isCommentSeedingCampaign
      ? formData.commentContent.trim().length > 0
    : isRichContentEditorEnabled
      ? splitFormattedContentVariants(formData.content).length > 0
      : formData.content.trim().length > 0
  const hasSelectedMainMedia = isAdvancedContentMode
    ? !isMobileManagedSmsCampaign && advancedContentDisplayItems.some(item => item.mediaOption !== 'none' && (item.mediaItems || []).length > 0)
    : isCommentSeedingCampaign
      ? formData.commentImageOption !== 'none' && formData.commentImages.length > 0
    : !isMobileManagedSmsCampaign && formData.imageOption !== 'none' && formData.images.length > 0
  const hasSelectedCommentMedia = formData.commentImageOption !== 'none' && formData.commentImages.length > 0
  const detailsColumnCount = isCommentSeedingPostCampaign || isFindDataSearchCampaign || isFacebookJoinGroupCampaign || isZaloJoinGroupLinkCampaign
    ? (isEditingSavedCampaign ? 2 : 3)
    : isPagePostCampaign
      ? (isEditingSavedCampaign ? 4 : 5)
      : isMobileManagedSmsCampaign
        ? (isEditingSavedCampaign ? 9 : 10)
        : (isEditingSavedCampaign ? 5 : 6)
  const availableCampaignActions = useMemo(
    () => campaignActions
      .filter(action => canUseCampaignAction(action, entitlements))
      .filter(action => canUseZaloQrAccount || action.id !== ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID)
      .sort(compareCampaignActionsByPlatform),
    [campaignActions, canUseZaloQrAccount, entitlements]
  )
  const campaignActionPlatformOptions = useMemo(() => {
    const platforms = new Set<string>()
    for (const action of availableCampaignActions) {
      const platform = normalizeCampaignActionPlatform(action.flatformType)
      if (!platform) continue
      platforms.add(platform)
    }

    return Array.from(platforms)
      .map(value => ({
        value,
        label: getCampaignActionPlatformLabel(value)
      }))
      .sort((left, right) => {
        const leftOrder = CAMPAIGN_ACTION_PLATFORM_ORDER[left.value] ?? Number.MAX_SAFE_INTEGER
        const rightOrder = CAMPAIGN_ACTION_PLATFORM_ORDER[right.value] ?? Number.MAX_SAFE_INTEGER
        if (leftOrder !== rightOrder) return leftOrder - rightOrder
        return left.label.localeCompare(right.label, 'vi', { sensitivity: 'base' })
      })
  }, [availableCampaignActions])
  const filteredCampaignActions = useMemo(
    () => selectedActionPlatformFilter
      ? availableCampaignActions.filter(action => normalizeCampaignActionPlatform(action.flatformType) === selectedActionPlatformFilter)
      : availableCampaignActions,
    [availableCampaignActions, selectedActionPlatformFilter]
  )
  const selectedCampaignAction = availableCampaignActions.find(action => action.id === formData.actionId)
  const selectedActionPlatform = normalizeCampaignActionPlatform(selectedCampaignAction?.flatformType)
  const usesZaloServerAccount = selectedActionPlatform === 'zalo' && formData.accountIds.some(accountId => {
    const account = accounts.find(item => item.id === accountId)
    return account ? isZaloServerAccount(account) : false
  })
  const getMediaSelectionMode = (target: MainMediaPickerTarget): MediaSelectionMode => {
    const isCommentMedia = target === 'comment' || (typeof target === 'object' && isCommentSeedingCampaign)
    if (isCommentMedia) return 'image-video'
    return mainMediaSelectionMode
  }
  const actionPlatformForAccountSelection = selectedActionPlatform || selectedActionPlatformFilter
  const requiresSingleAccount = selectedCampaignAction?.allowMultipleAccounts === false
  const allowsSecondaryAccount = selectedCampaignAction?.allowSecondaryAccount === true
  const campaignDailyLimitCap = getCampaignActionDailySendLimit(
    selectedCampaignAction || (formData.actionId ? { id: formData.actionId, flatformType: selectedActionPlatform } : null),
    entitlements
  )
  const getActionDailyLimitCap = (actionCode: string) => (
    getAccountActionDailySendLimit(actionCode, selectedActionPlatform, entitlements)
  )
  const clampActionLimitDailyLimit = (actionCode: string, limit: ActionLimitForm): ActionLimitForm => ({
    ...limit,
    dailyLimit: clampDailyLimitToEntitlement(limit.dailyLimit, getActionDailyLimitCap(actionCode))
  })
  const selectableAccounts = useMemo(
    () => actionPlatformForAccountSelection
      ? accounts.filter(account => (
        normalizeCampaignActionPlatform(account.flatformType) === actionPlatformForAccountSelection
        && (formData.actionId !== ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID || !isZaloWebAccount(account))
      ))
      : accounts,
    [accounts, actionPlatformForAccountSelection, formData.actionId]
  )
  const selectedPrimaryAccount = useMemo(() => {
    if (formData.accountIds.length !== 1) return null
    return accounts.find(account => account.id === formData.accountIds[0]) || null
  }, [accounts, formData.accountIds])
  const selectableSecondaryAccounts = useMemo(() => {
    if (!allowsSecondaryAccount || !selectedPrimaryAccount || !selectedActionPlatform) return []

    return selectableAccounts.filter(account => {
      if (account.id === selectedPrimaryAccount.id) return false
      return selectedActionPlatform !== 'zalo' ||
        (
          isZaloWebAccount(account) === isZaloWebAccount(selectedPrimaryAccount) &&
          isZaloServerAccount(account) === isZaloServerAccount(selectedPrimaryAccount)
        )
    })
  }, [
    allowsSecondaryAccount,
    selectableAccounts,
    selectedActionPlatform,
    selectedPrimaryAccount
  ])
  const selectedCampaignNameAccount = useMemo(() => {
    if (formData.accountIds.length !== 1) return null
    return accounts.find(account => account.id === formData.accountIds[0]) || null
  }, [accounts, formData.accountIds])
  const campaignNameAccountIdsKey = formData.accountIds.join(',')
  const dataGroupPreviewAccountIdsKey = formData.accountIds.join(',')
  const campaignNameCurrentDateLabel = getVietnamDayMonthLabel()
  const selectableAccountGroups = useMemo(
    () => accountGroups.filter(group => !actionPlatformForAccountSelection || normalizeCampaignActionPlatform(group.flatformType) === actionPlatformForAccountSelection),
    [accountGroups, actionPlatformForAccountSelection]
  )
  const groupedSelectableAccounts = useMemo(() => {
    const byGroup = new Map<number, typeof selectableAccounts>()
    const ungrouped: typeof selectableAccounts = []
    const visibleGroupIds = new Set(selectableAccountGroups.map(group => group.id))

    for (const account of selectableAccounts) {
      if (account.accountGroupId && visibleGroupIds.has(account.accountGroupId)) {
        const groupAccounts = byGroup.get(account.accountGroupId) || []
        groupAccounts.push(account)
        byGroup.set(account.accountGroupId, groupAccounts)
      } else {
        ungrouped.push(account)
      }
    }

    return { byGroup, ungrouped }
  }, [selectableAccounts, selectableAccountGroups])
  const isSingleAccountSelection = Boolean(
    (campaign && campaign.id) ||
    requiresSingleAccount ||
    formData.secondaryAccountId !== null
  )
  const selectedAccountIdsSet = useMemo(() => new Set(formData.accountIds), [formData.accountIds])
  const selectedAllSelectableAccounts = selectableAccounts.length > 0 && selectableAccounts.every(account => selectedAccountIdsSet.has(account.id))
  const selectedPostBumpAccountIdsSet = useMemo(
    () => new Set(formData.postBumpAccountIds || []),
    [formData.postBumpAccountIds]
  )
  const selectedPostBumpAccounts = useMemo(
    () => selectableAccounts.filter(account => selectedPostBumpAccountIdsSet.has(account.id)),
    [selectableAccounts, selectedPostBumpAccountIdsSet]
  )
  const validPostBumpAccountIds = useMemo(
    () => selectedPostBumpAccounts.map(account => account.id),
    [selectedPostBumpAccounts]
  )
  const postBumpAccountDropdownLabel = selectedPostBumpAccounts.length === 0
    ? '-- Chọn tài khoản --'
    : selectedPostBumpAccounts.length === 1
      ? selectedPostBumpAccounts[0].name
      : `Đã chọn ${selectedPostBumpAccounts.length} tài khoản`
  const getAccountIdsForPlatform = (accountIds: number[], platform: string, actionId = formData.actionId): number[] => {
    if (!platform) return accountIds
    return accountIds.filter(id => {
      const account = accounts.find(item => item.id === id)
      return normalizeCampaignActionPlatform(account?.flatformType) === platform
        && (actionId !== ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID || !account || !isZaloWebAccount(account))
    })
  }
  const invalidateCampaignNameAiRequest = () => {
    campaignNameAiRequestSeqRef.current += 1
  }
  const handleActionPlatformSelect = (platform: string) => {
    const normalizedPlatform = normalizeCampaignActionPlatform(platform)
    if (!normalizedPlatform || (draftMode && !!lockedActionId) || isSavedDataGroupIdentityLocked) return

    const currentAction = availableCampaignActions.find(action => action.id === formData.actionId)
    const currentPlatform = normalizeCampaignActionPlatform(currentAction?.flatformType)
    const keepCurrentAction = !!formData.actionId && currentPlatform === normalizedPlatform
    const nextAccountIds = getAccountIdsForPlatform(formData.accountIds, normalizedPlatform)
    if (
      !keepCurrentAction ||
      nextAccountIds.length !== formData.accountIds.length ||
      !nextAccountIds.every((id, index) => id === formData.accountIds[index])
    ) {
      invalidateCampaignNameAiRequest()
    }

    setSelectedActionPlatformFilter(normalizedPlatform)
    setIsAccountDropdownOpen(false)
    if (!keepCurrentAction && (formData.formattedContentEnabled || formData.emailBodyIsHtml)) {
      normalizeManualAdvancedContentItemsToPlain()
    }
    setFormData(prev => {
      const currentAction = availableCampaignActions.find(action => action.id === prev.actionId)
      const currentPlatform = normalizeCampaignActionPlatform(currentAction?.flatformType)
      const keepCurrentAction = !!prev.actionId && currentPlatform === normalizedPlatform
      const nextAccountIds = getAccountIdsForPlatform(prev.accountIds, normalizedPlatform)

      if (
        keepCurrentAction &&
        nextAccountIds.length === prev.accountIds.length &&
        nextAccountIds.every((id, index) => id === prev.accountIds[index])
      ) {
        return prev
      }

      const compatibleState = !keepCurrentAction && (
        prev.formattedContentEnabled ||
        prev.emailBodyIsHtml
      )
        ? convertFormattedStateToPlain(prev)
        : prev
      return {
        ...compatibleState,
        actionId: keepCurrentAction ? prev.actionId : '',
        accountIds: nextAccountIds
      }
    })
  }
  const handleActionChange = (actionId: string) => {
    if (isSavedDataGroupIdentityLocked) return
    const actionChanged = actionId !== formData.actionId
    const nextAction = availableCampaignActions.find(action => action.id === actionId)
    const nextPlatform = normalizeCampaignActionPlatform(nextAction?.flatformType)
    const nextAccountIds = getAccountIdsForPlatform(formData.accountIds, nextPlatform || selectedActionPlatformFilter, actionId)
    if (
      actionId !== formData.actionId ||
      nextAccountIds.length !== formData.accountIds.length ||
      !nextAccountIds.every((id, index) => id === formData.accountIds[index])
    ) {
      invalidateCampaignNameAiRequest()
    }
    if (actionChanged) {
      const compatibleSnapshots = directDataGroupSnapshots.filter(snapshot => (
        isSemanticDataTypeCompatibleWithCampaignAction(
          snapshot.dataTypeCategoryItemId,
          nextAction
        )
      ))
      const removedSnapshotCount = directDataGroupSnapshots.length - compatibleSnapshots.length
      if (removedSnapshotCount > 0) {
        setDirectDataGroupSnapshots(compatibleSnapshots)
        showAlert(
          `${removedSnapshotCount} nhóm data chờ thêm không còn tương thích và đã được bỏ chọn.`,
          'info'
        )
      }
    }
    if (
      (formData.formattedContentEnabled && !supportsFormattedContent(actionId)) ||
      (actionId !== EMAIL_SEND_ACTION_ID && formData.emailBodyIsHtml)
    ) {
      normalizeManualAdvancedContentItemsToPlain()
    }
    if (nextPlatform) setSelectedActionPlatformFilter(nextPlatform)
    setFormData(prev => {
      const shouldConvertRichContentToPlain =
        (prev.formattedContentEnabled && !supportsFormattedContent(actionId)) ||
        (actionId !== EMAIL_SEND_ACTION_ID && prev.emailBodyIsHtml)
      const compatibleState = shouldConvertRichContentToPlain
        ? convertFormattedStateToPlain(prev)
        : prev
      return {
        ...compatibleState,
        actionId,
        accountIds: getAccountIdsForPlatform(prev.accountIds, nextPlatform || selectedActionPlatformFilter, actionId),
        ...([SMS_SEND_ACTION_ID, VOICE_CALL_ACTION_ID].includes(actionId)
        ? {
          imageOption: 'none' as const,
          images: [],
          commentImageOption: 'none' as const,
          commentImages: [],
          sleepBetweenActions: actionId === SMS_SEND_ACTION_ID
            ? DEFAULT_SMS_SLEEP_BETWEEN_ACTIONS
            : DEFAULT_SLEEP_BETWEEN_ACTIONS,
          dailyLimit: actionId === VOICE_CALL_ACTION_ID ? 30 : prev.dailyLimit,
          rateLimitCount: actionId === VOICE_CALL_ACTION_ID ? 9 : prev.rateLimitCount,
          rateLimitMinutes: actionId === VOICE_CALL_ACTION_ID
            ? VOICE_CALL_DEFAULT_RATE_LIMIT_MINUTES
            : prev.rateLimitMinutes
        }
        : {})
      }
    })
    setIsAccountDropdownOpen(false)
  }
  const renderActionPlatformSwitcher = () => {
    if (campaignActionPlatformOptions.length === 0) return null

    return (
      <div className="campaign-action-platform-tags" role="group" aria-label="Nền tảng hành động">
        {campaignActionPlatformOptions.map(option => {
          const isSelected = selectedActionPlatformFilter === option.value
          return (
            <button
              key={option.value}
              type="button"
              className={`campaign-action-platform-tag is-${option.value}${isSelected ? ' is-active' : ''}`}
              onClick={() => handleActionPlatformSelect(option.value)}
              disabled={(draftMode && !!lockedActionId) || isSavedDataGroupIdentityLocked}
              aria-pressed={isSelected}
            >
              <span className={`campaign-action-platform-mark is-${option.value}`} />
              <span className="campaign-action-platform-name">{option.label}</span>
            </button>
          )
        })}
      </div>
    )
  }
  const toggleSelectableAccounts = (accountIds: number[]) => {
    if (isSavedDataGroupIdentityLocked || isSingleAccountSelection || accountIds.length === 0) return
    invalidateCampaignNameAiRequest()
    setFormData(prev => {
      const selectedIds = new Set(prev.accountIds)
      const allSelected = accountIds.every(id => selectedIds.has(id))
      for (const id of accountIds) {
        if (allSelected) selectedIds.delete(id)
        else selectedIds.add(id)
      }
      return { ...prev, accountIds: Array.from(selectedIds) }
    })
  }
  const toggleSelectableAccount = (accountId: number, checked: boolean) => {
    if (isSavedDataGroupIdentityLocked) return
    invalidateCampaignNameAiRequest()
    setFormData(prev => ({
      ...prev,
      accountIds: checked
        ? Array.from(new Set([...prev.accountIds, accountId]))
        : prev.accountIds.filter(id => id !== accountId)
    }))
  }
  const selectSingleAccount = (accountId: number) => {
    if (isSavedDataGroupIdentityLocked) return
    if (formData.accountIds.length !== 1 || formData.accountIds[0] !== accountId) {
      invalidateCampaignNameAiRequest()
    }
    setFormData(prev => ({ ...prev, accountIds: [accountId] }))
    setIsAccountDropdownOpen(false)
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
  const limitActionCodes = selectedCampaignAction?.limitCheckActionCodes || []
  const limitActionCodesKey = limitActionCodes.join(',')
  const findDataTargetDataGroupIdsKey = (Object.keys(FIND_DATA_GROUP_DESTINATION_CONFIG) as FindDataOutputKind[])
    .map(kind => {
      const groupId = Number(formData.findDataTargetDataGroups[kind]?.groupId)
      return Number.isSafeInteger(groupId) && groupId > 0 ? `${kind}:${groupId}` : ''
    })
    .filter(Boolean)
    .join('|')

  useEffect(() => {
    const selectedEntries = (Object.keys(FIND_DATA_GROUP_DESTINATION_CONFIG) as FindDataOutputKind[])
      .map(kind => ({
        kind,
        groupId: Number(formData.findDataTargetDataGroups[kind]?.groupId)
      }))
      .filter((entry): entry is { kind: FindDataOutputKind; groupId: number } => (
        Number.isSafeInteger(entry.groupId) && entry.groupId > 0
      ))

    if (selectedEntries.length === 0) {
      setFindDataTargetDataGroupDetails({})
      setResolvedFindDataTargetDataGroupIdsKey(findDataTargetDataGroupIdsKey)
      setFailedFindDataTargetDataGroupIdsKey('')
      return
    }

    let disposed = false
    setResolvedFindDataTargetDataGroupIdsKey('')
    setFailedFindDataTargetDataGroupIdsKey('')
    const hydrateFindDataTargetGroups = async () => {
      const wantedIds = new Set(selectedEntries.map(entry => entry.groupId))
      const foundById = new Map<number, DataGroup>()
      const pageSize = 200
      let offset = 0
      try {
        while (!disposed && foundById.size < wantedIds.size) {
          const page = await window.electronAPI.listDataGroups({ offset, limit: pageSize })
          for (const group of page.groups) {
            if (wantedIds.has(group.id)) foundById.set(group.id, group)
          }
          offset += page.groups.length
          if (page.groups.length === 0 || offset >= page.total) break
        }
        if (disposed) return
        const details: FindDataTargetDataGroupDetails = {}
        for (const entry of selectedEntries) {
          const group = foundById.get(entry.groupId)
          if (group) details[entry.kind] = group
        }
        setFindDataTargetDataGroupDetails(details)
        setResolvedFindDataTargetDataGroupIdsKey(findDataTargetDataGroupIdsKey)
        setFailedFindDataTargetDataGroupIdsKey('')
      } catch (error) {
        console.error('Failed to resolve find-data target groups:', error)
        if (!disposed) setFailedFindDataTargetDataGroupIdsKey(findDataTargetDataGroupIdsKey)
      }
    }

    void hydrateFindDataTargetGroups()
    return () => { disposed = true }
  }, [findDataTargetDataGroupIdsKey, findDataTargetDataGroupHydrationRetry])

  useEffect(() => {
    const groupId = Number(formData.dataGroupId)
    if (!Number.isSafeInteger(groupId) || groupId <= 0) {
      setSelectedDataGroupName('')
      setSelectedDataGroup(null)
      return
    }

    let disposed = false
    const hydrateSelectedGroupName = async () => {
      const pageSize = 200
      let offset = 0
      try {
        while (!disposed) {
          const page = await window.electronAPI.listDataGroups({ offset, limit: pageSize })
          const selectedGroup = page.groups.find(group => group.id === groupId)
          if (selectedGroup) {
            setSelectedDataGroupName(selectedGroup.name)
            setSelectedDataGroup(selectedGroup)
            return
          }
          offset += page.groups.length
          if (page.groups.length === 0 || offset >= page.total) break
        }
        if (!disposed) {
          setSelectedDataGroupName('Nhóm data không còn hoạt động')
          setSelectedDataGroup(null)
        }
      } catch (error) {
        console.error('Failed to resolve selected Data Group name:', error)
        if (!disposed) {
          setSelectedDataGroupName('Nhóm data hiện tại')
          setSelectedDataGroup(null)
        }
      }
    }

    void hydrateSelectedGroupName()
    return () => { disposed = true }
  }, [formData.dataGroupId])

  useEffect(() => {
    const groupId = Number(formData.dataGroupId)
    const accountIds = Array.from(new Set(formData.accountIds))
    if (
      !isDataGroupSource
      || !Number.isSafeInteger(groupId)
      || groupId <= 0
      || !formData.actionId
      || accountIds.length === 0
    ) {
      setDataGroupTargetPreview([])
      setDataGroupTargetPreviewStatus('idle')
      return
    }

    let disposed = false
    setDataGroupTargetPreview([])
    setDataGroupTargetPreviewStatus('loading')
    const loadPreview = async () => {
      try {
        const preview = await window.electronAPI.previewDataGroupCampaignTargets({
          groupId,
          actionId: formData.actionId,
          accountIds
        })
        if (disposed) return
        if (preview.length !== accountIds.length) {
          throw new Error('Data Group target preview did not return every selected account.')
        }
        setDataGroupTargetPreview(preview)
        setDataGroupTargetPreviewStatus('ready')
      } catch (error) {
        console.error('Failed to preview valid Data Group campaign targets:', error)
        if (!disposed) {
          setDataGroupTargetPreview([])
          setDataGroupTargetPreviewStatus('error')
        }
      }
    }

    void loadPreview()
    return () => { disposed = true }
  }, [dataGroupPreviewAccountIdsKey, formData.actionId, formData.dataGroupId, isDataGroupSource])

  const dataGroupTargetPreviewLabel = useMemo(() => {
    if (dataGroupTargetPreviewStatus === 'loading') return 'Đang tính data hợp lệ...'
    if (dataGroupTargetPreviewStatus === 'error') {
      const totalLabel = selectedDataGroup
        ? `${selectedDataGroup.activeMembershipCount.toLocaleString('vi-VN')} data trong nhóm · `
        : ''
      return `${totalLabel}Chưa tính được số data hợp lệ`
    }
    if (formData.accountIds.length === 0) return 'Chọn tài khoản để tính data hợp lệ'
    if (dataGroupTargetPreviewStatus !== 'ready' || dataGroupTargetPreview.length === 0) {
      return 'Chưa tính được số data hợp lệ'
    }

    const counts = dataGroupTargetPreview.map(item => item.validTargetCount)
    const minimum = Math.min(...counts)
    const maximum = Math.max(...counts)
    if (counts.length === 1) {
      return `${minimum.toLocaleString('vi-VN')} data hợp lệ cho chiến dịch`
    }
    if (minimum === maximum) {
      return `${minimum.toLocaleString('vi-VN')} data hợp lệ cho mỗi chiến dịch`
    }
    return `${minimum.toLocaleString('vi-VN')}–${maximum.toLocaleString('vi-VN')} data hợp lệ cho mỗi chiến dịch`
  }, [dataGroupTargetPreview, dataGroupTargetPreviewStatus, formData.accountIds.length, selectedDataGroup])

  useEffect(() => {
    if (
      !formData.actionId ||
      !formData.dataGroupId ||
      !selectedDataGroup ||
      isDataGroupCompatibleWithCampaignAction(selectedDataGroup, selectedCampaignAction)
    ) {
      return
    }

    setFormData(previous => previous.dataGroupId === selectedDataGroup.id
      ? {
          ...previous,
          dataGroupId: null
        }
      : previous)
    setSelectedDataGroupName('')
    setSelectedDataGroup(null)
    showAlert(
      `Nhóm “${selectedDataGroup.name}” không hỗ trợ loại dữ liệu của hành động mới và đã được bỏ chọn.`,
      'info'
    )
  }, [formData.actionId, formData.dataGroupId, selectedCampaignAction, selectedDataGroup, showAlert])

  useEffect(() => {
    if (selectedActionPlatform) {
      if (selectedActionPlatformFilter !== selectedActionPlatform) {
        setSelectedActionPlatformFilter(selectedActionPlatform)
      }
      return
    }

    if (campaignActionPlatformOptions.length === 0) {
      if (selectedActionPlatformFilter) setSelectedActionPlatformFilter('')
      return
    }

    const hasSelectedPlatform = campaignActionPlatformOptions.some(option => option.value === selectedActionPlatformFilter)
    if (!selectedActionPlatformFilter || !hasSelectedPlatform) {
      setSelectedActionPlatformFilter(campaignActionPlatformOptions[0].value)
    }
  }, [campaignActionPlatformOptions, selectedActionPlatform, selectedActionPlatformFilter])

  useEffect(() => {
    if (!formData.actionId || canUseCampaignAction({ id: formData.actionId, flatformType: selectedActionPlatform }, entitlements)) return
    invalidateCampaignNameAiRequest()
    if (formData.formattedContentEnabled || formData.emailBodyIsHtml) {
      normalizeManualAdvancedContentItemsToPlain()
    }
    setFormData(prev => {
      const compatibleState = prev.formattedContentEnabled ||
        prev.emailBodyIsHtml
        ? convertFormattedStateToPlain(prev)
        : prev
      return {
        ...compatibleState,
        actionId: '',
        accountIds: [],
        emailSubject: '',
        emailBodyIsHtml: false,
        emailCheckLinkClicks: false
      }
    })
  }, [entitlements, formData.actionId, selectedActionPlatform])
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
    if (isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign) {
      if (actionCode === 'zalo_message_stranger') return formData.enableMessage
      if (actionCode === 'zalo_add_friend') return formData.enableAddFriend
      if (actionCode === 'zalo_tag_contact' || actionCode === 'zalo_change_alias') return false
    }
    if (isZaloMessageFriendCampaign) {
      if (actionCode === 'zalo_message_friend') return true
      if (actionCode === 'zalo_tag_contact' || actionCode === 'zalo_change_alias') return false
    }
    if (isZaloMessageBirthdayCampaign) {
      if (actionCode === 'zalo_message_friend') return true
      if (actionCode === 'zalo_tag_contact' || actionCode === 'zalo_change_alias') return false
    }
    if (isZaloMessageGroupCampaign) {
      if (actionCode === 'zalo_message_group') return true
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
  const canUseRecentDeliveryCooldown = supportsRecentDeliveryCooldown(formData.actionId, {
    enableMessage: formData.enableMessage
  })
  const showLimitsSection = canUseSleepBetweenActions || generalLimitActionCodes.length > 0 ||
    isCommentSeedingFeedCampaign
  const recentDeliveryCooldownPrompt = isFacebookGroupPostCampaign
    ? 'Không đăng bài vào những group có bài đăng trước đó cách số ngày là:'
    : isPagePostCampaign
      ? 'Không đăng bài lên những Page có bài đăng trước đó cách số ngày là:'
      : isEmailCampaign
        ? 'Không gửi email cho những địa chỉ có email gửi trước đó cách số ngày là:'
        : isSmsCampaign
          ? 'Không gửi SMS cho những số điện thoại có SMS gửi trước đó cách số ngày là:'
          : isZaloMessageGroupCampaign
            ? 'Không gửi tin cho những group có tin gửi trước đó cách số ngày là:'
            : 'Không gửi tin cho những người có tin gửi trước đó cách số ngày là:'
  const showContentSection = canShowContentSection
  const visibleScheduleFields: StepDef['fields'] = [
    ...(isMobileManagedSmsCampaign ? [] : [{ key: 'scheduleType', label: 'Loại lịch' }]),
    { key: 'schedule', label: 'Ngày chạy' },
    ...(isMobileManagedSmsCampaign || formData.scheduleType === 'daily' || isZaloMessageGroupRealtimeCampaign ? [] : [{ key: 'scheduleEndDate', label: 'Ngày kết thúc' }]),
    ...(!isMobileManagedSmsCampaign && formData.scheduleType === 'weekly' ? [{ key: 'scheduleWeekDays', label: 'Lịch tuần' }] : []),
    ...(!isMobileManagedSmsCampaign && formData.scheduleType === 'monthly' ? [{ key: 'scheduleDays', label: 'Lịch tháng' }] : []),
    ...(isMobileManagedSmsCampaign ? [] : [{ key: 'dailyStopTime', label: 'Giờ dừng' }])
  ]
  const visibleLimitFields: StepDef['fields'] = [
    ...(canUseSleepBetweenActions ? [{ key: 'sleepBetweenActions', label: 'Nghỉ giữa 2 lần' }] : []),
    { key: 'dailyLimit', label: 'Giới hạn trong ngày (đến 24h)' },
    { key: 'rateLimitCount', label: 'Giới hạn trong giờ' }
  ]
  const applyVisibleStepFields = (steps: StepDef[]): StepDef[] => steps.flatMap(step => {
    if (step.id === 'schedule') {
      return [{
        ...step,
        fields: canUseRerunAfterCompletion
          ? [...visibleScheduleFields, { key: 'findDataRerun', label: 'Chạy lại sau mỗi' }]
          : visibleScheduleFields
      }]
    }
    if (step.id === 'limits') {
      if (!showLimitsSection) return []
      return [{
        ...step,
        fields: step.fields.some(field => field.key === 'postsPerTarget')
          ? [...visibleLimitFields, { key: 'postsPerTarget', label: 'Số bài cần comment trên mỗi group/page/profile' }]
          : visibleLimitFields
      }]
    }
    if (step.id === 'deliveryCooldown') {
      if (!canUseRecentDeliveryCooldown) return []
      return [{
        ...step,
        fields: [{ key: 'recentDeliveryCooldownDays', label: recentDeliveryCooldownPrompt }]
      }]
    }
    return [step]
  })
  const baseSteps = applyVisibleStepFields((() => {
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
        ? simpleSteps.map(step => step.id === 'content' ? withSourceContentField(step) : step)
        : simpleSteps
    }
    if (isPagePostCampaign) {
      return ALL_STEPS
        .filter(s => s.id !== 'extra')
        .flatMap(step => {
          if (step.id === 'content') return [PAGE_POST_METHOD_STEP, withSourceContentField(step)]
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
                  { key: 'commentImages', label: 'Media comment' }
                ]
                : [
                  { key: 'commentContent', label: 'Nội dung comment' },
                  { key: 'commentImages', label: 'Media comment' }
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
        ? withPostSearch.flatMap(s => s.id === 'details' ? [findDataSourceStep, s] : [s])
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
    if (isZaloJoinGroupLinkCampaign) {
      const generalStep = ALL_STEPS.find(s => s.id === 'general')!
      const scheduleStep = ALL_STEPS.find(s => s.id === 'schedule')!
      const limitStep = ALL_STEPS.find(s => s.id === 'limits')!
      const detailsStep: StepDef = {
        ...ALL_STEPS.find(s => s.id === 'details')!,
        title: 'Danh sách link group Zalo',
        fields: [{ key: 'details', label: 'Link group Zalo' }]
      }
      return [generalStep, scheduleStep, limitStep, detailsStep]
    }
    if (isFacebookJoinGroupCampaign) {
      const generalStep = ALL_STEPS.find(s => s.id === 'general')!
      const scheduleStep = ALL_STEPS.find(s => s.id === 'schedule')!
      const limitStep = ALL_STEPS.find(s => s.id === 'limits')!
      const detailsStep: StepDef = {
        ...ALL_STEPS.find(s => s.id === 'details')!,
        title: 'Danh sách group Facebook',
        fields: [{ key: 'details', label: 'Group URL/UID' }]
      }
      return [generalStep, scheduleStep, limitStep, detailsStep]
    }
    if (isMessageCampaign) {
      const steps = ALL_STEPS
        .filter(s => {
          if (s.id === 'extra') return false
          if (hideDetailsSection && s.id === 'details') return false
          if (isMessageUidCampaign && !formData.enableMessage && s.id === 'content') return false
          if (isZaloMessagePhoneCampaign && !formData.enableMessage && s.id === 'content') return false
          if (isZaloMessageGroupMemberCampaign && !formData.enableMessage && s.id === 'content') return false
          if (isZaloMessageGroupRealtimeCampaign && !formData.enableMessage && s.id === 'content') return false
          if (isZaloMessageRemarketingCustomerCampaign && !formData.enableMessage && s.id === 'content') return false
          if (isZaloMessageFriendRecommendationCampaign && !formData.enableMessage && s.id === 'content') return false
          return true
        })
        .map(s => {
          if (s.id === 'content') {
            return {
              ...s,
              title: isEmailCampaign ? 'Nội dung email' : 'Nội dung tin nhắn',
              fields: isEmailCampaign
                ? [
                  { key: 'emailSubject', label: 'Tiêu đề email' },
                  { key: 'content', label: 'Nội dung email' },
                  { key: 'images', label: 'Tệp đính kèm' }
                ]
                : [
                  { key: 'content', label: 'Nội dung tin nhắn' },
                  ...(isMobileManagedSmsCampaign ? [] : [{ key: 'images', label: 'Media' }])
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
              title: isZaloMessageFriendCampaign
                ? 'Danh sách bạn bè Zalo'
                : isZaloMessageGroupMemberCampaign
                  ? 'Danh sách thành viên group Zalo'
                : isZaloMessageRemarketingCustomerCampaign
                  ? 'Danh sách khách hàng cũ Zalo'
                : isZaloMessageGroupCampaign
                  ? 'Danh sách group Zalo'
                : isZaloAddGroupMemberCampaign
                  ? 'Danh sách thành viên cần thêm'
                : isMessageFriendCampaign
                  ? 'Danh sách bạn bè'
                  : isPageInboxMessageCampaign
                    ? 'Danh sách khách inbox Page'
                : isPhoneInputCampaign
                    ? 'Danh sách SĐT'
                : isEmailCampaign
                    ? 'Danh sách email'
                    : 'Danh sách UID',
              fields: [{
                key: 'details',
                label: isZaloMessageFriendCampaign
                  ? 'Bạn bè Zalo'
                  : isZaloMessageGroupMemberCampaign
                    ? 'Thành viên group Zalo'
                  : isZaloMessageRemarketingCustomerCampaign
                    ? 'Khách hàng cũ Zalo'
                  : isZaloMessageGroupCampaign
                    ? 'Group Zalo'
                  : isZaloAddGroupMemberCampaign
                    ? 'SĐT hoặc UID Zalo'
                  : isMessageFriendCampaign
                    ? 'Bạn bè'
                    : isPageInboxMessageCampaign
                      ? 'Khách inbox Page'
                  : isPhoneInputCampaign
                      ? 'SĐT'
                  : isEmailCampaign
                      ? 'Email'
                      : 'UID'
              }]
            }
          }
          return s
        })
      const orderedSteps = isMessageUidCampaign || isZaloMessagePhoneCampaign || isZaloMessageFriendCampaign || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign || isZaloMessageGroupCampaign || isZaloAddGroupMemberCampaign
        ? steps.flatMap(s => s.id === 'general' ? [s, ACTION_OPTIONS_STEP] : [s])
        : steps
      const withFindDataSource = showFindDataSourceSection
        ? orderedSteps.flatMap(s => s.id === 'details' ? [findDataSourceStep, s] : [s])
        : orderedSteps
      return supportsExternalSmsPush ? [...withFindDataSource, EXTERNAL_SMS_STEP] : withFindDataSource
    }
    if (isFacebookGroupPostCampaign) {
      const steps = ALL_STEPS.flatMap(step => {
        if (step.id === 'content') return [withSourceContentField(step), GROUP_POST_COMMENT_STEP, GROUP_POST_BUMP_STEP]
        if (step.id === 'extra') {
          return [{
            ...step,
            fields: [
              { key: 'skipPostIfGroupRequiresApproval', label: 'Không đăng bài vào group bị duyệt bài' },
              { key: 'enableGroupPostShareToJoinedGroups', label: 'Đăng bài dạng chia sẻ' },
              { key: 'leaveGroupOnPendingApproval', label: 'Rời group chờ duyệt' },
              { key: 'autoJoinGroupAfterPost', label: 'Tự tham gia group' },
              { key: 'shuffleGroupList', label: 'Xáo trộn danh sách group' }
            ]
          }]
        }
        return [step]
      })
      return showFindDataSourceSection
        ? steps.flatMap(step => step.id === 'details' ? [findDataSourceStep, step] : [step])
        : steps
    }
    return ALL_STEPS.filter(s => s.id !== 'extra' || showExtraSection)
  })())
  const STEPS = canUseDataGroupSource && !isSimpleCampaign
    ? baseSteps.flatMap(step => step.id === 'details'
      ? [DATA_TARGET_SOURCE_STEP, isDataGroupSource ? DATA_GROUP_TARGET_STEP : step]
      : [step])
    : baseSteps
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
  const zaloMessagePhoneCampaignOptions = campaigns.filter(c =>
    c.actionId === ZALO_MESSAGE_PHONE_ACTION_ID &&
    c.id !== campaign?.id &&
    !c.isDelete
  )
  const zaloJoinGroupLinkCampaignOptions = campaigns.filter(c =>
    c.actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID &&
    c.id !== campaign?.id &&
    !c.isDelete
  )
  const facebookJoinGroupCampaignOptions = campaigns.filter(c =>
    c.actionId === FACEBOOK_JOIN_GROUP_ACTION_ID &&
    c.id !== campaign?.id &&
    !c.isDelete
  )
  const allFindDataSourceCampaignOptions = campaigns.filter(c => {
    if ((!FIND_DATA_GROUP_ACTIONS.has(c.actionId) && !FIND_DATA_SEARCH_ACTIONS.has(c.actionId)) || c.isDelete) return false
    if (targetFindDataField === 'findUidTargetCampaignIds') return c.relationSettings.isFindUid === true
    if (targetFindDataField === 'findPostLinkTargetCampaignIds') return c.relationSettings.isFindPostLink === true
    if (
      targetFindDataField === 'findFacebookGroupPostTargetCampaignIds' ||
      targetFindDataField === 'findFacebookGroupCommentTargetCampaignIds' ||
      targetFindDataField === 'findFacebookGroupJoinTargetCampaignIds'
    ) {
      return FIND_DATA_SEARCH_ACTIONS.has(c.actionId) && c.relationSettings.isFindFacebookGroup === true
    }
    return false
  })
  const getFindDataSourceCampaignOptions = (source: Extract<CampaignPickerSource, { type: 'findDataSource' }>, editableOnly = false): CampaignListItem[] => {
    const sourceKind = source.sourceKind
    return allFindDataSourceCampaignOptions
      .filter(campaign => !sourceKind || getFindDataSourceKindForActionId(campaign.actionId) === sourceKind)
      .filter(campaign => !editableOnly || isEditableFindDataSourceCampaign(campaign))
  }
  const allFindDataSourceCampaignOptionsKey = allFindDataSourceCampaignOptions
    .map(c => [
      c.id,
      (c.relationSettings.findUidTargetCampaignIds || []).join(','),
      (c.relationSettings.findPostLinkTargetCampaignIds || []).join(','),
      (c.relationSettings.findPhoneZaloMessagePhoneTargetCampaignIds || []).join(','),
      (c.relationSettings.findZaloGroupLinkJoinTargetCampaignIds || []).join(','),
      (c.relationSettings.findFacebookGroupPostTargetCampaignIds || []).join(','),
      (c.relationSettings.findFacebookGroupCommentTargetCampaignIds || []).join(','),
      (c.relationSettings.findFacebookGroupJoinTargetCampaignIds || []).join(',')
    ].join(':'))
    .join('|')
  const sourceSelectionTargetCampaignId = cloneFromId || (isEditingSavedCampaign && campaign?.id ? campaign.id : null)
  const sourceDetachCurrentTargetCampaignId = isEditingSavedCampaign && campaign?.id ? campaign.id : null
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
    phoneCarrier: inferInputDataPhoneCarrier(row.phone, row.phoneCarrier),
    uid: row.uid || '',
    email: row.email || '',
    info1: row.info1 || '',
    info2: row.info2 || '',
    info3: row.info3 || '',
    info4: row.info4 || '',
    info5: row.info5 || '',
    note: '',
    status: 'chờ xử lý'
  }))
  const [details, setDetails] = useState<Partial<CampaignInputData>[]>(() => normalizeInitialDetails(initialDetails))
  const [detailsPage, setDetailsPage] = useState(1)
  const detailsPageCount = Math.max(1, Math.ceil(details.length / CAMPAIGN_DETAILS_PAGE_SIZE))
  const visibleDetailsPage = Math.min(detailsPage, detailsPageCount)
  const detailsPageStartIndex = (visibleDetailsPage - 1) * CAMPAIGN_DETAILS_PAGE_SIZE
  const detailsPageEndIndex = Math.min(details.length, detailsPageStartIndex + CAMPAIGN_DETAILS_PAGE_SIZE)
  const visibleDetails = useMemo(
    () => details.slice(detailsPageStartIndex, detailsPageEndIndex),
    [details, detailsPageEndIndex, detailsPageStartIndex]
  )
  const [findDataSearchKeywordsText, setFindDataSearchKeywordsText] = useState(() =>
    initialIsFindDataSearchCampaign ? formatFindDataSearchKeywordsText(normalizeInitialDetails(initialDetails)) : ''
  )
  const findDataSearchKeywordRows = useMemo(
    () => buildFindDataSearchKeywordRows(findDataSearchKeywordsText),
    [findDataSearchKeywordsText]
  )
  const detailEntryCount = isFindDataSearchCampaign && !isEditingSavedCampaign
    ? findDataSearchKeywordRows.length
    : details.length
  const directDataSourceSelectionCount = detailEntryCount + directDataGroupSnapshots.length
  const [deletedIds, setDeletedIds] = useState<number[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)

  useEffect(() => {
    setDetailsPage(current => Math.min(current, detailsPageCount))
  }, [detailsPageCount])

  const [akabizIntegrations, setAkaBizIntegrations] = useState<AkaBizIntegrations | null>(null)
  const [akabizIntegrationsLoading, setAkaBizIntegrationsLoading] = useState(false)
  const [externalSmsShops, setExternalSmsShops] = useState<AkaBizSmsShopListItem[]>([])
  const [externalSmsShopsLoading, setExternalSmsShopsLoading] = useState(false)
  const [externalSmsShopsLoaded, setExternalSmsShopsLoaded] = useState(false)
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
  const [isPostBumpAccountDropdownOpen, setIsPostBumpAccountDropdownOpen] = useState(false)
  const [isOtherDataSourceOpen, setIsOtherDataSourceOpen] = useState(false)
  const [isZaloAddGroupMemberGroupDropdownOpen, setIsZaloAddGroupMemberGroupDropdownOpen] = useState(false)
  const [zaloAddGroupMemberGroupSearch, setZaloAddGroupMemberGroupSearch] = useState('')
  const [isFacebookGroupInviteGroupDropdownOpen, setIsFacebookGroupInviteGroupDropdownOpen] = useState(false)
  const [facebookGroupInviteGroupSearch, setFacebookGroupInviteGroupSearch] = useState('')
  const [messageDateOption, setMessageDateOption] = useState<MessageDateOption>('today')
  const [messageDateFormat, setMessageDateFormat] = useState<MessageDateFormat>('DD/MM/YYYY')
  const [messageTemplateDropdownOpen, setMessageTemplateDropdownOpen] = useState<MessageTemplateDropdown>(null)
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
  const postBumpAccountDropdownRef = useRef<HTMLDivElement>(null)
  const otherDataSourceDropdownRef = useRef<HTMLDivElement>(null)
  const zaloAddGroupMemberGroupDropdownRef = useRef<HTMLDivElement>(null)
  const facebookGroupInviteGroupDropdownRef = useRef<HTMLDivElement>(null)

  const canReplaceCampaignNameWithAI = (currentName: string, previousAiName: string): boolean => {
    if (!currentName) return true
    if (campaignNameUserEditedRef.current && currentName !== previousAiName) return false
    return !!previousAiName && currentName === previousAiName
  }

  const applyAiCampaignName = (generatedName: string, previousAiName: string) => {
    const nextName = generatedName.replace(/\s+/g, ' ').trim()
    if (!nextName) return

    setFormData(prev => {
      const currentName = prev.name.trim()
      if (!canReplaceCampaignNameWithAI(currentName, previousAiName)) return prev

      lastAiCampaignNameRef.current = nextName
      campaignNameUserEditedRef.current = false
      return prev.name === nextName ? prev : { ...prev, name: nextName }
    })
  }

  const handleCampaignNameChange = (value: string) => {
    const currentAiName = lastAiCampaignNameRef.current.trim()
    const nextName = value.trim()
    campaignNameAiRequestSeqRef.current += 1
    campaignNameUserEditedRef.current = nextName.length > 0 && nextName !== currentAiName
    setFormData(prev => ({ ...prev, name: value }))
  }

  useEffect(() => {
    campaignNameValueRef.current = formData.name
  }, [formData.name])

  useEffect(() => {
    // "Tạo chiến dịch từ nhóm" opens before an action is selected. Preserve
    // that group until the user picks an action, then apply the normal support
    // and semantic-compatibility guards below.
    if (!formData.actionId) return
    if (canUseDataGroupSource) return
    setDirectDataGroupSnapshots([])
    setFormData(previous => previous.dataTargetSourceMode === 'direct' && previous.dataGroupId === null
      ? previous
      : { ...previous, dataTargetSourceMode: 'direct', dataGroupId: null })
  }, [canUseDataGroupSource, formData.actionId])

  useEffect(() => {
    const requestSeq = campaignNameAiRequestSeqRef.current + 1
    campaignNameAiRequestSeqRef.current = requestSeq

    const actionId = String(formData.actionId || '').trim()
    const actionName = String(selectedCampaignAction?.name || '').trim()
    if (!actionId || !actionName || formData.accountIds.length === 0) return

    const previousAiName = lastAiCampaignNameRef.current.trim()
    if (!canReplaceCampaignNameWithAI(campaignNameValueRef.current.trim(), previousAiName)) return

    const isSingleAccount = formData.accountIds.length === 1
    if (isSingleAccount && !selectedCampaignNameAccount) return

    const accountKey = isSingleAccount ? `account:${selectedCampaignNameAccount?.id}` : 'multi'
    const cacheKey = `${actionId}|${accountKey}|${campaignNameCurrentDateLabel}`
    const cachedName = campaignNameAiCacheRef.current.get(cacheKey)
    if (cachedName) {
      applyAiCampaignName(cachedName, previousAiName)
      return
    }

    const generateCampaignNameWithAI = window.electronAPI?.generateCampaignNameWithAI
    if (!generateCampaignNameWithAI) return

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          if (
            requestSeq !== campaignNameAiRequestSeqRef.current ||
            !canReplaceCampaignNameWithAI(campaignNameValueRef.current.trim(), previousAiName)
          ) {
            return
          }

          const generatedName = await generateCampaignNameWithAI({
            actionId,
            actionName,
            accountId: isSingleAccount ? selectedCampaignNameAccount?.id : undefined,
            accountName: isSingleAccount ? selectedCampaignNameAccount?.name : undefined
          })
          if (requestSeq !== campaignNameAiRequestSeqRef.current) return

          const normalizedName = generatedName.replace(/\s+/g, ' ').trim()
          if (!normalizedName) return
          campaignNameAiCacheRef.current.set(cacheKey, normalizedName)
          applyAiCampaignName(normalizedName, previousAiName)
        } catch (err) {
          if (requestSeq === campaignNameAiRequestSeqRef.current) {
            console.warn('Failed to auto-generate campaign name:', err)
          }
        }
      })()
    }, 500)

    return () => window.clearTimeout(timeoutId)
  }, [
    formData.actionId,
    campaignNameAccountIdsKey,
    selectedCampaignAction?.name,
    selectedCampaignNameAccount?.id,
    selectedCampaignNameAccount?.name,
    campaignNameCurrentDateLabel
  ])

  useEffect(() => {
    setFormData(prev => {
      if (!prev.postWithBackground) return prev

      const supported = prev.actionId === 'facebook_timeline_post' || prev.actionId === PAGE_POST_ACTION_ID || prev.actionId === GROUP_POST_ACTION_ID
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
      if (!prev.formattedContentEnabled || !supportsFormattedContent(prev.actionId)) return prev
      if (!prev.rewriteContentEachRun && !prev.postWithBackground && prev.zaloMessageSendMode === 'normal') return prev
      return {
        ...prev,
        rewriteContentEachRun: false,
        postWithBackground: false,
        zaloMessageSendMode: 'normal'
      }
    })
  }, [
    formData.actionId,
    formData.formattedContentEnabled,
    formData.postWithBackground,
    formData.rewriteContentEachRun,
    formData.zaloMessageSendMode
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
      if (
        postBumpAccountDropdownRef.current &&
        !postBumpAccountDropdownRef.current.contains(event.target as Node)
      ) {
        setIsPostBumpAccountDropdownOpen(false)
      }
      if (otherDataSourceDropdownRef.current && !otherDataSourceDropdownRef.current.contains(event.target as Node)) {
        setIsOtherDataSourceOpen(false)
      }
      if (
        zaloAddGroupMemberGroupDropdownRef.current &&
        !zaloAddGroupMemberGroupDropdownRef.current.contains(event.target as Node)
      ) {
        setIsZaloAddGroupMemberGroupDropdownOpen(false)
      }
      if (
        facebookGroupInviteGroupDropdownRef.current &&
        !facebookGroupInviteGroupDropdownRef.current.contains(event.target as Node)
      ) {
        setIsFacebookGroupInviteGroupDropdownOpen(false)
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
    if (previousZaloAliasActionIdRef.current === formData.actionId) return
    previousZaloAliasActionIdRef.current = formData.actionId
    setFormData(prev => {
      const currentTemplate = prev.zaloAliasTemplate.trim()
      if (currentTemplate && !isDefaultZaloAliasTemplate(currentTemplate)) return prev

      const nextTemplate = getDefaultZaloAliasTemplate(prev.actionId)
      return prev.zaloAliasTemplate === nextTemplate
        ? prev
        : { ...prev, zaloAliasTemplate: nextTemplate }
    })
  }, [formData.actionId])

  useEffect(() => {
    if (campaigns.length === 0) {
      void loadCampaigns()
    }
  }, [campaigns.length, loadCampaigns])

  useEffect(() => {
    void loadAccountGroups()
  }, [loadAccountGroups])

  useEffect(() => {
    if (findDataSourceSelectionScopeRef.current !== sourceSelectionScopeKey) {
      findDataSourceSelectionScopeRef.current = sourceSelectionScopeKey
      findDataSourceSelectionTouchedRef.current = false
    }
  }, [sourceSelectionScopeKey])

  useEffect(() => {
    if (!isSingleAccountSelection || formData.accountIds.length <= 1) return
    invalidateCampaignNameAiRequest()
    setFormData(prev => ({ ...prev, accountIds: prev.accountIds.slice(0, 1) }))
  }, [isSingleAccountSelection, formData.accountIds.length])

  useEffect(() => {
    if (formData.secondaryAccountId === null) return
    if (!selectedCampaignAction) return

    if (selectedCampaignAction.allowSecondaryAccount !== false && formData.accountIds.length === 1) {
      const primaryAccount = accounts.find(account => account.id === formData.accountIds[0])
      const secondaryAccount = accounts.find(account => account.id === formData.secondaryAccountId)

      // Preserve hydrated ids while the account catalog is loading or temporarily incomplete.
      // Save validation will surface a missing account if the user submits in this state.
      if (!primaryAccount || !secondaryAccount) return

      const primaryPlatform = normalizeCampaignActionPlatform(primaryAccount.flatformType)
      const secondaryPlatform = normalizeCampaignActionPlatform(secondaryAccount.flatformType)
      const hasPlatformMismatch =
        primaryPlatform !== secondaryPlatform ||
        (!!selectedActionPlatform && (
          primaryPlatform !== selectedActionPlatform ||
          secondaryPlatform !== selectedActionPlatform
        ))
      const hasZaloSubtypeMismatch =
        primaryPlatform === 'zalo' &&
        secondaryPlatform === 'zalo' &&
        (
          isZaloWebAccount(primaryAccount) !== isZaloWebAccount(secondaryAccount) ||
          isZaloServerAccount(primaryAccount) !== isZaloServerAccount(secondaryAccount)
        )
      const isIncompatible =
        primaryAccount.id === secondaryAccount.id ||
        hasPlatformMismatch ||
        hasZaloSubtypeMismatch

      if (!isIncompatible) return
    }

    setFormData(prev => (
      prev.secondaryAccountId === null
        ? prev
        : { ...prev, secondaryAccountId: null }
    ))
  }, [
    accounts,
    formData.accountIds,
    formData.secondaryAccountId,
    selectedActionPlatform,
    selectedCampaignAction
  ])

  useEffect(() => {
    if (!isZaloMessageGroupRealtimeCampaign || formData.scheduleType === 'daily') return
    setFormData(prev => ({
      ...prev,
      scheduleType: 'daily',
      scheduleDays: '',
      scheduleWeekDays: ''
    }))
  }, [isZaloMessageGroupRealtimeCampaign, formData.scheduleType])

  useEffect(() => {
    if (!actionPlatformForAccountSelection) return
    const allowedIds = new Set(selectableAccounts.map(account => account.id))
    setFormData(prev => {
      const nextAccountIds = prev.accountIds.filter(id => {
        const account = accounts.find(item => item.id === id)
        // Do not drop a hydrated id just because the account catalog is still incomplete.
        return !account || allowedIds.has(id)
      })
      if (nextAccountIds.length === prev.accountIds.length) return prev
      invalidateCampaignNameAiRequest()
      return { ...prev, accountIds: nextAccountIds }
    })
  }, [
    accounts,
    actionPlatformForAccountSelection,
    selectableAccounts
  ])

  useEffect(() => {
    if (!needsZaloLabels || formData.accountIds.length === 0) {
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
        const labelById = new Map(labels.map(label => [String(label.id), label]))
        const sourceTagIds = formData.zaloFriendSourceTagIds.map(id => String(id || '').trim()).filter(Boolean)
        const nextSourceTagIds = sourceTagIds.filter(id => labelById.has(id))
        if (sourceTagIds.length !== nextSourceTagIds.length) {
          const nextSourceTagNames = nextSourceTagIds.map(id => labelById.get(id)?.text || '')
          setFormData(prev => ({
            ...prev,
            zaloFriendSourceTagIds: nextSourceTagIds,
            zaloFriendSourceTagNames: nextSourceTagNames
          }))
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
    needsZaloLabels,
    formData.accountIds.join(',')
  ])

  useEffect(() => {
    if (!isZaloMessageFriendCampaign || formData.accountIds.length === 0) {
      setZaloFriendBlocklists([])
      setZaloFriendBlocklistsLoading(false)
      setFormData(prev => (
        prev.zaloFriendBlocklistEnabled || prev.zaloFriendBlocklistId || prev.zaloFriendBlocklistName
          ? {
            ...prev,
            zaloFriendBlocklistEnabled: false,
            zaloFriendBlocklistId: null,
            zaloFriendBlocklistName: ''
          }
          : prev
      ))
      return
    }

    let cancelled = false
    const accountId = formData.accountIds[0]
    setZaloFriendBlocklistsLoading(true)
    window.electronAPI.listZaloFriendBlocklists(accountId)
      .then(groups => {
        if (cancelled) return
        setZaloFriendBlocklists(groups)
        setFormData(prev => {
          if (!prev.zaloFriendBlocklistId) return prev
          const selected = groups.find(group => group.id === prev.zaloFriendBlocklistId)
          return selected
            ? { ...prev, zaloFriendBlocklistName: selected.name }
            : {
              ...prev,
              zaloFriendBlocklistEnabled: false,
              zaloFriendBlocklistId: null,
              zaloFriendBlocklistName: ''
            }
        })
      })
      .catch(err => {
        if (cancelled) return
        setZaloFriendBlocklists([])
        showAlert(formatIpcErrorMessage(err, 'Không tải được danh sách không gửi tin Zalo.'), 'error')
      })
      .finally(() => {
        if (!cancelled) setZaloFriendBlocklistsLoading(false)
      })

    return () => { cancelled = true }
  }, [
    isZaloMessageFriendCampaign,
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
      allFindDataSourceCampaignOptions
    )
    setSelectedFindDataSourceCampaignIds(prev => sameNumberList(prev, nextIds) ? prev : nextIds)
  }, [
    formData.actionId,
    allFindDataSourceCampaignOptionsKey,
    showFindDataSourceSection,
    sourceSelectionTargetCampaignId
  ])

  useEffect(() => {
    if (!formData.actionId || !selectedCampaignAction) {
      return
    }
    setFormData(prev => {
      const fallback = {
        dailyLimit: clampDailyLimitToEntitlement(prev.dailyLimit, campaignDailyLimitCap),
        rateLimitCount: prev.rateLimitCount,
        rateLimitMinutes: prev.rateLimitMinutes
      }
      const next: Record<string, ActionLimitForm> = {}
      for (const code of limitActionCodes) {
        const defaultLimit = clampActionLimitDailyLimit(code, getDefaultActionLimitForCode(code, fallback))
        next[code] = isHiddenActionLimitConfig(code)
          ? defaultLimit
          : clampActionLimitDailyLimit(code, prev.actionLimitsByCode[code] || defaultLimit)
      }
      const dailyLimit = clampDailyLimitToEntitlement(prev.dailyLimit, campaignDailyLimitCap)
      const prevKeys = Object.keys(prev.actionLimitsByCode).sort().join(',')
      const nextKeys = Object.keys(next).sort().join(',')
      if (
        dailyLimit === prev.dailyLimit &&
        prevKeys === nextKeys &&
        Object.keys(next).every(code => isSameActionLimitForm(prev.actionLimitsByCode[code], next[code]))
      ) {
        return prev
      }
      return { ...prev, dailyLimit, actionLimitsByCode: next }
    })
  }, [formData.actionId, selectedCampaignAction?.id, selectedActionPlatform, limitActionCodesKey, checkedLimitActionCodesKey, visibleLimitActionCodesKey, entitlements])

  const hasSmsIntegration = !!akabizIntegrations?.sms?.staffId
  const hasZaloWebIntegration = !!akabizIntegrations?.zaloWeb?.staffId
  const hasAkaBizDesktopIntegration = !!akabizIntegrations?.akaBizDesktop?.staffId && !!akabizIntegrations?.akaBizDesktop?.dbPath && !desktopIntegrationInvalid

  function convertFormattedStateToPlain(current: typeof formData): typeof formData {
    const plainContent = formattedContentToPlainCampaignContent(current.content)
    const plainAdvancedItems = current.advancedContentItems.map(item => ({
      ...item,
      content: formattedContentToPlainText(item.content)
    }))

    return {
      ...current,
      formattedContentEnabled: false,
      emailBodyIsHtml: false,
      content: plainContent,
      advancedContentEnabled: current.advancedContentEnabled,
      advancedContentItems: plainAdvancedItems
    }
  }

  function normalizeManualAdvancedContentItemsToPlain(): void {
    manualAdvancedContentItemsRef.current = manualAdvancedContentItemsRef.current.map(item => ({
      ...item,
      content: formattedContentToPlainText(item.content)
    }))
  }

  const enableFormattedContent = () => {
    setFormData(current => {
      return {
        ...current,
        formattedContentEnabled: true,
        rewriteContentEachRun: false,
        postWithBackground: false,
        zaloMessageSendMode: 'normal',
        content: plainTextToFormattedContent(current.content),
        advancedContentEnabled: current.advancedContentEnabled,
        advancedContentItems: current.advancedContentItems.map(item => ({
          ...item,
          content: plainTextToFormattedContent(item.content)
        }))
      }
    })
  }

  const setFormattedContentEnabled = (checked: boolean) => {
    if (checked) {
      enableFormattedContent()
      return
    }
    normalizeManualAdvancedContentItemsToPlain()
    setFormData(current => convertFormattedStateToPlain(current))
  }

  const getZaloRealtimeGroupNameMap = () => {
    const nameById = new Map<string, string>()
    formData.zaloRealtimeGroupIds.forEach((id, index) => {
      const normalizedId = normalizeZaloRealtimeGroupId(id)
      const name = String(formData.zaloRealtimeGroupNames[index] || '').trim()
      if (normalizedId && name) nameById.set(normalizedId, name)
    })
    for (const group of zaloRealtimeGroups) {
      const normalizedId = normalizeZaloRealtimeGroupId(group.uid || group.url)
      if (normalizedId && group.name) nameById.set(normalizedId, group.name)
    }
    return nameById
  }

  const getZaloRealtimeGroupIdsForSave = () => Array.from(new Set(
    formData.zaloRealtimeGroupIds
      .map(normalizeZaloRealtimeGroupId)
      .filter(Boolean)
  ))

  const getZaloRealtimeGroupNamesForSave = (ids: string[]) => {
    const nameById = getZaloRealtimeGroupNameMap()
    return ids.map(id => nameById.get(id) || '')
  }

  const getZaloRealtimeTriggersForSave = () => normalizeZaloRealtimeTriggers(formData.zaloRealtimeTriggers, [])

  const loadZaloRealtimeGroupsFromLocal = async (options: { silent?: boolean } = {}) => {
    const accountId = formData.accountIds[0]
    if (!isZaloGroupSelectionCampaign || !accountId) {
      setZaloRealtimeGroups([])
      if (!options.silent) showAlert('Vui lòng chọn tài khoản Zalo trước khi load group.', 'error')
      return
    }

    setZaloRealtimeGroupsLoading(true)
    try {
      const rows = await window.electronAPI.listContacts(accountId, 'group')
      const groups = rows.filter(contact => contact.contactType === 'group' && normalizeZaloRealtimeGroupId(contact.uid || contact.url))
      setZaloRealtimeGroups(groups)
      if (!options.silent) showAlert(`Đã load ${groups.length} group đã lưu.`, 'success')
    } catch (err) {
      setZaloRealtimeGroups([])
      if (!options.silent) {
        showAlert(formatIpcErrorMessage(err, 'Không load được group Zalo đã lưu.'), 'error')
      }
    } finally {
      setZaloRealtimeGroupsLoading(false)
    }
  }

  const syncZaloRealtimeGroupsFromZalo = async () => {
    const accountId = formData.accountIds[0]
    if (!isZaloGroupSelectionCampaign || !accountId) {
      showAlert('Vui lòng chọn tài khoản Zalo trước khi tải group.', 'error')
      return
    }

    setZaloRealtimeGroupsLoading(true)
    try {
      const result = await window.electronAPI.loadGroups(accountId)
      if (!result.success) throw new Error(result.error || 'Không tải được group từ Zalo.')
      const rows = await window.electronAPI.listContacts(accountId, 'group')
      const groups = rows.filter(contact => contact.contactType === 'group' && normalizeZaloRealtimeGroupId(contact.uid || contact.url))
      setZaloRealtimeGroups(groups)
      showAlert(`Đã tải group từ Zalo. Tổng group đã lưu: ${groups.length}${result.count ? `, cập nhật ${result.count}` : ''}.`, 'success')
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không tải được group từ Zalo.'), 'error')
    } finally {
      setZaloRealtimeGroupsLoading(false)
    }
  }

  useEffect(() => {
    if (!isZaloGroupSelectionCampaign || formData.accountIds.length !== 1) {
      setZaloRealtimeGroups([])
      setZaloRealtimeGroupsLoading(false)
      return
    }
    void loadZaloRealtimeGroupsFromLocal({ silent: true })
  }, [isZaloGroupSelectionCampaign, formData.accountIds.join(',')])

  const loadFacebookGroupInviteGroupsFromLocal = async (options: { silent?: boolean } = {}) => {
    const accountId = formData.accountIds[0]
    if (!isFacebookGroupInviteCampaign || formData.accountIds.length !== 1 || !accountId) {
      setFacebookGroupInviteGroups([])
      if (!options.silent) showAlert('Vui lòng chọn 1 tài khoản Facebook trước khi load group.', 'error')
      return
    }

    setFacebookGroupInviteGroupsLoading(true)
    try {
      const rows = await window.electronAPI.listContacts(accountId, 'group')
      const groups = rows.filter(contact =>
        contact.contactType === 'group' &&
        contact.isJoined === true &&
        getFacebookGroupInviteContactUrl(contact)
      )
      setFacebookGroupInviteGroups(groups)
      if (!options.silent) showAlert(`Đã load ${groups.length} group Facebook đã tham gia.`, 'success')
    } catch (err) {
      setFacebookGroupInviteGroups([])
      if (!options.silent) {
        showAlert(formatIpcErrorMessage(err, 'Không load được group Facebook đã lưu.'), 'error')
      }
    } finally {
      setFacebookGroupInviteGroupsLoading(false)
    }
  }

  useEffect(() => {
    if (!isFacebookGroupInviteCampaign || formData.accountIds.length !== 1) {
      setFacebookGroupInviteGroups([])
      setFacebookGroupInviteGroupsLoading(false)
      return
    }
    void loadFacebookGroupInviteGroupsFromLocal({ silent: true })
  }, [isFacebookGroupInviteCampaign, formData.accountIds.join(',')])

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
      const labelById = new Map(labels.map(label => [String(label.id), label]))
      const sourceTagIds = formData.zaloFriendSourceTagIds.map(id => String(id || '').trim()).filter(Boolean)
      const nextSourceTagIds = sourceTagIds.filter(id => labelById.has(id))
      if (sourceTagIds.length !== nextSourceTagIds.length) {
        const nextSourceTagNames = nextSourceTagIds.map(id => labelById.get(id)?.text || '')
        setFormData(prev => ({
          ...prev,
          zaloFriendSourceTagIds: nextSourceTagIds,
          zaloFriendSourceTagNames: nextSourceTagNames
        }))
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
      const [rows, groups] = await Promise.all([
        window.electronAPI.listContentTemplates(),
        window.electronAPI.listContentTemplateGroups
          ? window.electronAPI.listContentTemplateGroups()
          : Promise.resolve([] as ContentTemplateGroup[])
      ])
      setContentTemplates(rows)
      setContentTemplateGroups(groups)
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tải mẫu nội dung.'), 'error')
    } finally {
      setContentTemplatesLoading(false)
    }
  }

  const loadAkaBizContactTags = async () => {
    if (!window.electronAPI?.listAkaBizContactTags) return
    setAkaBizContactTagsLoading(true)
    try {
      const rows = await window.electronAPI.listAkaBizContactTags()
      setAkaBizContactTags(rows)
      const activeIds = new Set(rows.map(tag => tag.id))
      setFormData(prev => {
        const currentIds = getCampaignIdList(prev.akaBizTagIds)
        const nextIds = currentIds.filter(id => activeIds.has(id))
        if (sameNumberList(currentIds, nextIds)) return prev
        const nextNames = nextIds.map(id => rows.find(tag => tag.id === id)?.name || '')
        return {
          ...prev,
          akaBizTagIds: nextIds,
          akaBizTagNames: nextNames,
          enableAkaBizTag: nextIds.length > 0 ? prev.enableAkaBizTag : false
        }
      })
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tải tag akaBiz.'), 'error')
    } finally {
      setAkaBizContactTagsLoading(false)
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
      setExternalSmsShops([])
      setExternalSmsShopsLoaded(false)
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tải tích hợp akaBiz.'), 'error')
    } finally {
      setAkaBizIntegrationsLoading(false)
    }
  }

  const loadExternalSmsShops = async () => {
    if (!window.electronAPI?.listAkaBizSmsShops) return
    setExternalSmsShopsLoading(true)
    try {
      const rows = await window.electronAPI.listAkaBizSmsShops()
      setExternalSmsShops(rows)
      setExternalSmsShopsLoaded(true)
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tải danh sách tài khoản akaBiz Sms.'), 'error')
      setExternalSmsShopsLoaded(true)
    } finally {
      setExternalSmsShopsLoading(false)
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
    void loadAkaBizContactTags()
    const handleAkaBizContactTagsUpdated = () => void loadAkaBizContactTags()
    window.addEventListener('akabiz-contact-tags-updated', handleAkaBizContactTagsUpdated)
    return () => window.removeEventListener('akabiz-contact-tags-updated', handleAkaBizContactTagsUpdated)
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
      supportsExternalSmsPush &&
      !usesInternalSmsPush &&
      formData.externalSmsEnabled &&
      hasSmsIntegration &&
      !externalSmsShopsLoaded &&
      !externalSmsShopsLoading
    ) {
      void loadExternalSmsShops()
    }
  }, [supportsExternalSmsPush, usesInternalSmsPush, formData.externalSmsEnabled, hasSmsIntegration, externalSmsShopsLoaded, externalSmsShopsLoading])

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
        const normalizedDetails = normalizeInitialDetails(initialDetails)
        setDetails(normalizedDetails)
        if (FIND_DATA_SEARCH_ACTIONS.has(formData.actionId)) {
          setFindDataSearchKeywordsText(formatFindDataSearchKeywordsText(normalizedDetails))
        }
        setDeletedIds([])
        return
      }
      if (loadId && window.electronAPI) {
        setLoadingDetails(true)
        try {
          const existingDetails = await window.electronAPI.listCampaignInputData(loadId)
          if (cloneFromId) {
            // Clone: strip IDs and reset status, ALSO clear note
            const clonedDetails: Partial<CampaignInputData>[] = existingDetails.map(d => ({ ...d, id: undefined, status: 'chờ xử lý', note: '' }))
            setDetails(clonedDetails)
            if (FIND_DATA_SEARCH_ACTIONS.has(formData.actionId)) {
              setFindDataSearchKeywordsText(formatFindDataSearchKeywordsText(clonedDetails))
            }
          } else {
            setDetails(existingDetails)
            if (FIND_DATA_SEARCH_ACTIONS.has(formData.actionId)) {
              setFindDataSearchKeywordsText(formatFindDataSearchKeywordsText(existingDetails))
            }
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
      case 'recentDeliveryCooldownDays':
        return !formData.recentDeliveryCooldownEnabled || (
          Number.isInteger(formData.recentDeliveryCooldownDays) &&
          formData.recentDeliveryCooldownDays >= MIN_RECENT_DELIVERY_COOLDOWN_DAYS &&
          formData.recentDeliveryCooldownDays <= MAX_RECENT_DELIVERY_COOLDOWN_DAYS
        )
      case 'dailyLimit': return formData.dailyLimit >= 0
      case 'rateLimitCount': return formData.rateLimitCount >= 0
      case 'rateLimitMinutes': return formData.rateLimitMinutes >= 0
      case 'dataTargetSourceMode':
        return !isDataGroupSource || (
          Number.isSafeInteger(Number(formData.dataGroupId)) && Number(formData.dataGroupId) > 0
        )
      case 'dataGroupId':
        return Number.isSafeInteger(Number(formData.dataGroupId)) && Number(formData.dataGroupId) > 0
      case 'content': return !requiresMainContentOrMedia || hasMainContentText || hasSelectedMainMedia
      case 'emailSubject': return isAdvancedContentMode
        ? advancedContentDisplayItems.length > 0 && advancedContentDisplayItems.every(item => String(
            advancedContentSourceMode === 'manual'
              ? resolveLegacyManualEmailSubject(item)
              : (item.emailSubject ?? '')
          ).trim().length > 0)
        : formData.emailSubject.trim().length > 0
      case 'commentContent': return isAdvancedContentMode
        ? advancedContentDisplayItems.length > 0
        : formData.commentContent.trim().length > 0 || hasSelectedCommentMedia
      case 'postsPerTarget': return formData.postsPerTarget > 0
      case 'commentPostSearchConditions': return true
      case 'enablePostLike': return true
      case 'sharePost': return true  // optional, always "complete"
      case 'pagePostMode': return true
      case 'enableComment': return true  // optional
      case 'enablePostBump': return true  // optional
      case 'skipPostIfGroupRequiresApproval': return true
      case 'enableGroupPostShareToJoinedGroups': return true
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
      case 'messageActions':
        if (isZaloCancelSentFriendRequestCampaign) {
          return normalizeZaloCancelFriendRequestLimit(formData.zaloCancelFriendRequestLimit) >= 1
        }
        if (isZaloAddGroupMemberCampaign) {
          return normalizeZaloRealtimeGroupId(formData.zaloAddGroupMemberTargetGroupId).length > 0
        }
        return isMessageFriendCampaign || (
          (formData.enableMessage || formData.enableAddFriend) &&
          (!isZaloMessageGroupRealtimeCampaign ||
            (
              getZaloRealtimeTriggersForSave().length > 0 &&
              getZaloRealtimeGroupIdsForSave().length > 0 &&
              !!formData.zaloRealtimeEndDate
            ))
        )
      case 'externalSms':
        if (!supportsExternalSmsPush) return true
        if (usesInternalSmsPush) {
          if (!formData.internalSmsEnabled) return true
          return getCampaignIdList(formData.internalSmsAccountIds).length > 0 &&
            !!formData.internalSmsContent.trim() &&
            formData.internalSmsStatuses.length > 0
        }
        if (!formData.externalSmsEnabled) return true
        return hasSmsIntegration &&
          getCampaignIdList(formData.externalSmsShopIds).length > 0 &&
          !!formData.externalSmsContent.trim() &&
          formData.externalSmsStatuses.length > 0
      case 'details':
        return isDataGroupSource
          ? Number.isSafeInteger(Number(formData.dataGroupId)) && Number(formData.dataGroupId) > 0
          : hideDetailsSection || detailEntryCount > 0 || hasPendingDirectDataGroupSnapshots || hasSelectedFindDataSourceCampaign
      default: return false
    }
  }

  const getStepCompletion = (step: StepDef) => {
    const completed = step.fields.filter(f => isFieldComplete(f.key)).length
    return { completed, total: step.fields.length }
  }

  const updateActionLimit = (actionCode: string, key: keyof ActionLimitForm, value: number) => {
    if (key === 'rateLimitMinutes') {
      setEditedRateLimitMinuteActions(prev => ({ ...prev, [actionCode]: true }))
    }
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
          [key]: key === 'dailyLimit'
            ? clampDailyLimitToEntitlement(value, getActionDailyLimitCap(actionCode))
            : value
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

  const scrollToAccountSelector = () => {
    setActiveStep('general')
    setCollapsedSections(prev => ({ ...prev, general: false }))
    window.requestAnimationFrame(() => {
      accountDropdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
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
      searchQuery: '',
      groupId: null,
      groupSearchQuery: '',
      groupStatus: 'all',
      view: 'card',
      sort: 'newest',
      selectedTemplateId: null
    })
    if (contentTemplates.length === 0) void loadContentTemplates()
  }

  const openSaveContentTemplateModal = (target: AiContentTarget) => {
    const rawContent = getAiContentValue(target)
    const content = target === 'content' && isAdvancedContentMode
      ? serializeContentVariants(normalizedAdvancedContentItems.map(item => (
        isRichContentEditorEnabled ? formattedContentToPlainText(item.content) : item.content
      )))
      : target === 'content' && isRichContentEditorEnabled
        ? formattedContentToPlainCampaignContent(rawContent)
        : rawContent.trim()
    if (!content) {
      showAlert('Vui lòng nhập nội dung trước khi lưu mẫu.', 'error')
      return
    }
    setContentTemplateSaveModal({
      target,
      name: '',
      content,
      groupId: null
    })
  }

  const openContentTemplateManager = (channel = getContentTemplateTargetChannel('content')) => {
    onOpenContentTemplates?.(channel)
  }

  const getPreviewContentValue = (target: ContentPreviewTarget): string => {
    if (target === 'friendRequestMessage') return formData.friendRequestMessage
    if (target === 'newsfeedCommentContent') return formData.newsfeedCommentContent
    return getAiContentValue(target)
  }

  const getContentPreviewMedia = (target: ContentPreviewTarget): {
    media: ContentPreviewMediaItem[]
    mediaMode: ContentPreviewModalData['mediaMode']
    randomCount?: number
  } => {
    if (target === 'commentContent') {
      const previewCommentImages = formData.commentImageOption === 'all'
        ? formData.commentImages.slice(0, 1)
        : formData.commentImages
      return {
        media: formData.commentImageOption === 'none'
          ? []
          : previewCommentImages.map(item => ({
            path: getCampaignMediaPreviewPath(item),
            label: getCampaignMediaDisplayName(item),
            mimeType: getCampaignMediaMimeType(item)
          })),
        mediaMode: formData.commentImageOption,
        randomCount: formData.commentImageOption === 'random' ? 1 : undefined
      }
    }

    if (target === 'content' && !isFacebookJoinGroupCampaign && !isPostBackgroundActive) {
      return {
        media: formData.imageOption === 'none'
          ? []
          : formData.images.map(item => ({
            path: getCampaignMediaPreviewPath(item),
            label: getCampaignMediaDisplayName(item),
            mimeType: getCampaignMediaMimeType(item)
          })),
        mediaMode: formData.imageOption,
        randomCount: formData.randomImageCount
      }
    }

    return {
      media: [],
      mediaMode: 'none'
    }
  }

  const getContentPreviewKind = (target: ContentPreviewTarget): ContentPreviewModalData['kind'] => {
    if (target === 'friendRequestMessage') return 'friendRequest'
    if (target === 'commentContent' || target === 'newsfeedCommentContent' || target === 'postBumpContent') return 'comment'
    if (target === 'content') {
      if (isEmailCampaign) return 'email'
      if (isMessageCampaign) return 'message'
    }
    return 'post'
  }

  const getContentPreviewPlatform = (target: ContentPreviewTarget): ContentPreviewPlatform => {
    if (target === 'friendRequestMessage') return 'zalo'
    if (target === 'commentContent' || target === 'newsfeedCommentContent' || target === 'postBumpContent') return 'facebook'
    if (target === 'content') {
      if (isEmailCampaign) return 'email'
      if (isZaloMessageCampaign) return 'zalo'
      if (isMobileManagedSmsCampaign) return 'generic'
      if (isMessageCampaign || isFacebookGroupPostCampaign || isTimelinePostCampaign || isPagePostCampaign) return 'facebook'
    }
    return 'generic'
  }

  const getContentPreviewSurface = (target: ContentPreviewTarget): ContentPreviewSurface => {
    if (target === 'friendRequestMessage') return 'chat'
    if (target === 'commentContent' || target === 'newsfeedCommentContent' || target === 'postBumpContent') return 'comment'
    if (target === 'content') {
      if (isEmailCampaign) return 'email'
      if (isMessageCampaign) return 'chat'
    }
    return 'post'
  }

  const getContentPreviewTitle = (target: ContentPreviewTarget): string => {
    if (target === 'friendRequestMessage') return 'Xem trước nội dung kết bạn'
    if (target === 'newsfeedCommentContent') return 'Xem trước comment newsfeed'
    if (target === 'commentContent') return 'Xem trước nội dung comment'
    if (target === 'postBumpContent') return 'Xem trước nội dung up tin'
    return `Xem trước ${getCampaignContentLabel().toLowerCase()}`
  }

  const getContentPreviewSubtitle = (target: ContentPreviewTarget): string => {
    if (target === 'content') {
      if (isEmailCampaign) return 'Email xem trước với dữ liệu mẫu'
      if (isZaloMessageCampaign) return 'Tin nhắn Zalo xem trước với dữ liệu mẫu'
      if (isSmsCampaign) return 'Tin nhắn SMS xem trước với dữ liệu mẫu'
      if (isVoiceCallCampaign) return 'Nội dung cuộc gọi AI xem trước với dữ liệu mẫu'
      if (isMessageCampaign) return 'Tin nhắn Facebook xem trước với dữ liệu mẫu'
      if (isPagePostCampaign) return 'Bài đăng fanpage xem trước với dữ liệu mẫu'
      if (isTimelinePostCampaign) return 'Bài đăng trang cá nhân xem trước với dữ liệu mẫu'
      if (isFacebookGroupPostCampaign) return 'Bài đăng group xem trước với dữ liệu mẫu'
    }
    if (target === 'friendRequestMessage') return 'Lời nhắn kết bạn Zalo xem trước với dữ liệu mẫu'
    return 'Xem trước với dữ liệu mẫu'
  }

  const getContentPreviewNotes = (target: ContentPreviewTarget): string[] => {
    const notes: string[] = []
    if (target === 'content') {
      if (formData.rewriteContentEachRun && !isRichContentEditorEnabled && !isAdvancedGroupSource) {
        notes.push('Bản xem trước chưa chạy AI viết lại; khi runtime chạy, nội dung có thể được AI viết lại.')
      }
      if (isSourceContentMode) notes.push('Bản xem trước chưa hiển thị nội dung được copy từ nguồn.')
      if (isSourceContentMode && supportsSourceSharePost && formData.sharePost) notes.push('Bản xem trước chưa hiển thị phần bài viết được chia sẻ từ nguồn.')
      if (isReelsMediaMode) notes.push('Bản xem trước chưa mô phỏng giao diện Reels.')
      if (isPostBackgroundActive) notes.push('Bản xem trước chưa mô phỏng phông nền Facebook.')
    }
    if (target === 'commentContent' && formData.rewriteCommentContentEachRun) {
      notes.push('Bản xem trước chưa chạy AI viết lại comment; khi runtime chạy, comment có thể được AI viết lại.')
    }
    if (target === 'newsfeedCommentContent' && formData.newsfeedCommentUseAI) {
      notes.push('Đang bật AI tạo comment; bản xem trước chỉ hiển thị nội dung/prompt đang nhập.')
    }
    return notes
  }

  const openContentPreview = (target: ContentPreviewTarget) => {
    const mediaConfig = getContentPreviewMedia(target)
    const previewVariants = target === 'content' && isAdvancedContentMode
      ? normalizedAdvancedContentItems.map(item => item.content)
      : undefined
    setContentPreviewModal({
      title: getContentPreviewTitle(target),
      subtitle: getContentPreviewSubtitle(target),
      kind: getContentPreviewKind(target),
      platform: getContentPreviewPlatform(target),
      surface: getContentPreviewSurface(target),
      content: previewVariants?.[0] ?? getPreviewContentValue(target),
      contentFormat: target === 'content' && isFormattedContentEnabled ? 'rich_text' : 'plain',
      variants: previewVariants,
      subject: target === 'content' && isEmailCampaign ? formData.emailSubject : undefined,
      isHtml: target === 'content' && isEmailCampaign && formData.emailBodyIsHtml,
      media: mediaConfig.media,
      mediaMode: mediaConfig.mediaMode,
      randomCount: mediaConfig.randomCount,
      zaloMessageSendMode: target === 'content' && isZaloMessageCampaign
        ? formData.zaloMessageSendMode
        : undefined,
      notes: getContentPreviewNotes(target)
    })
  }

  const openAdvancedContentPreview = (item: CampaignAdvancedContentItem, itemIndex: number) => {
    const mediaMode = item.mediaOption || 'none'
    const previewMediaItems = isCommentSeedingCampaign && mediaMode === 'all'
      ? (item.mediaItems || []).slice(0, 1)
      : (item.mediaItems || [])
    const media = mediaMode === 'none' || isPostBackgroundActive
      ? []
      : previewMediaItems.map(mediaItem => ({
        path: getCampaignMediaPreviewPath(mediaItem),
        label: getCampaignMediaDisplayName(mediaItem),
        mimeType: getCampaignMediaMimeType(mediaItem)
      }))
    const groupSnapshotRich = advancedContentSourceMode === 'group'
      ? groupSnapshotEffectiveRich
      : isRichContentEditorEnabled
    setContentPreviewModal({
      title: `${getContentPreviewTitle('content')} · Nội dung ${itemIndex + 1}`,
      subtitle: getContentPreviewSubtitle('content'),
      kind: getContentPreviewKind('content'),
      platform: getContentPreviewPlatform('content'),
      surface: getContentPreviewSurface('content'),
      content: item.content,
      contentFormat: groupSnapshotRich ? 'rich_text' : 'plain',
      variants: [item.content],
      subject: isEmailCampaign
        ? (advancedContentSourceMode === 'group'
            ? String(item.emailSubject ?? '')
            : resolveLegacyManualEmailSubject(item))
        : undefined,
      isHtml: isEmailCampaign && groupSnapshotRich,
      media,
      mediaMode,
      randomCount: isCommentSeedingCampaign ? 1 : (item.randomMediaCount || 3),
      zaloMessageSendMode: isZaloMessageCampaign ? formData.zaloMessageSendMode : undefined,
      notes: getContentPreviewNotes('content')
    })
  }

  const renderContentPreviewButton = (target: ContentPreviewTarget, disabled = false) => (
    <button
      type="button"
      className="btn btn-ghost content-template-inline-button"
      onClick={() => openContentPreview(target)}
      disabled={disabled}
    >
      <Eye size={15} />
      <span>Xem trước</span>
    </button>
  )

  const getContentTemplateTargetChannel = (target: AiContentTarget): ContentTemplateChannelName => {
    if (target !== 'content') return 'facebook_comment'
    const actionChannel = getContentTemplateChannelForAction(formData.actionId)
    if (actionChannel) return actionChannel
    if (selectedActionPlatform === 'sms') return 'sms'
    if (selectedActionPlatform === 'zalo') return 'zalo_message'
    if (selectedActionPlatform === 'email') return 'email'
    return 'facebook_post'
  }

  const applyContentTemplate = (template: ContentTemplate) => {
    if (!contentTemplatePicker) return
    const target = contentTemplatePicker.target
    const channelName = getContentTemplateTargetChannel(target)
    const resolved = resolveContentTemplate(template, channelName)
    if (resolved.variants.length === 0) {
      showAlert('Mẫu này chưa có nội dung phù hợp với chiến dịch.', 'error')
      return
    }

    const targetSupportsRich = target === 'content' && (
      channelName === 'email' || supportsFormattedContent(formData.actionId)
    )
    const applyRich = resolved.rich && targetSupportsRich
    const variants = resolved.rich && !applyRich
      ? resolved.variants.map(variant => formattedContentToPlainText(variant)).filter(Boolean)
      : resolved.variants
    if (variants.length === 0) {
      showAlert('Mẫu này không còn nội dung sau khi chuyển sang văn bản thường.', 'error')
      return
    }

    const shouldApplyTemplateMedia = channelName !== 'sms' && (
      target === 'content' || target === 'commentContent'
    )
    const templateMediaMode: MediaSelectionMode = target === 'commentContent'
      ? 'image-video'
      : channelName === 'facebook_post' || channelName === 'facebook_message' || channelName === 'facebook_comment'
        ? mainMediaSelectionMode
        : 'image'
    const { snapshots: resolvedSnapshots, invalidCount } = shouldApplyTemplateMedia
      ? contentTemplateImagesToSnapshots(resolved.imageUrls, templateMediaMode)
      : { snapshots: [] as CampaignMediaSnapshot[], invalidCount: 0 }
    const snapshots = resolvedSnapshots
    const serializedContent = applyRich
      ? serializeFormattedContentVariants(variants)
      : serializeContentVariants(variants)

    const doApply = () => {
      if (target === 'commentContent') {
        setFormData(current => ({
          ...current,
          commentContent: serializeContentVariants(variants),
          commentImages: snapshots,
          commentImageOption: snapshots.length > 1 ? 'random' : snapshots.length === 1 ? 'all' : 'none'
        }))
      } else if (target !== 'content') {
        setAiContentValue(target, serializeContentVariants(variants))
      } else {
        const templateMediaOption: ImageOption = snapshots.length === 0
          ? 'none'
          : isReelsMediaMode && snapshots.length > 1
            ? 'random'
            : 'all'
        setPendingContentTemplateGroupId(null)
        setFormData(current => ({
          ...current,
          content: serializedContent,
          advancedContentEnabled: false,
          advancedContentItems: [],
          images: snapshots,
          imageOption: templateMediaOption,
          randomImageCount: isReelsMediaMode ? 1 : 3,
          formattedContentEnabled: channelName !== 'email' && applyRich && supportsFormattedContent(current.actionId),
          rewriteContentEachRun: applyRich ? false : current.rewriteContentEachRun,
          postWithBackground: applyRich || snapshots.length > 0 ? false : current.postWithBackground,
          zaloMessageSendMode: applyRich ? 'normal' : current.zaloMessageSendMode,
          emailSubject: channelName === 'email' ? String(resolved.subject || '') : current.emailSubject,
          emailBodyIsHtml: channelName === 'email' ? applyRich : current.emailBodyIsHtml
        }))
      }
      setContentTemplatePicker(null)
      showAlert(
        invalidCount > 0
          ? `Đã áp dụng mẫu và bỏ qua ${invalidCount} media không nhận diện được hoặc không phù hợp với chiến dịch.`
          : 'Đã áp dụng mẫu nội dung.',
        invalidCount > 0 ? 'info' : 'success'
      )
    }

    const currentContent = target === 'content' && isAdvancedContentMode
      ? normalizedAdvancedContentItems.map(item => item.content).join('\n')
      : getAiContentValue(target).trim()
    const replacesMedia = target === 'commentContent'
      ? formData.commentImages.length > 0 || snapshots.length > 0
      : target === 'content' && (
          formData.images.length > 0 ||
          normalizedAdvancedContentItems.some(item => (item.mediaItems || []).length > 0) ||
          snapshots.length > 0
        )
    const compatibilityChanges = target === 'content' && (
      (formData.postWithBackground && (applyRich || snapshots.length > 0)) ||
      (formData.zaloMessageSendMode === 'share' && applyRich)
    )

    if (currentContent || replacesMedia || compatibilityChanges) {
      const replacedParts = [
        currentContent ? 'nội dung' : '',
        replacesMedia ? 'media' : '',
        compatibilityChanges ? 'các tùy chọn không tương thích' : ''
      ].filter(Boolean).join(', ')
      showConfirm(
        `Mẫu đã chọn sẽ thay ${replacedParts} hiện tại của chiến dịch.`,
        doApply,
        { title: 'Áp dụng mẫu nội dung', confirmText: 'Áp dụng mẫu', variant: 'primary' }
      )
      return
    }

    doApply()
  }

  const saveCurrentContentTemplate = async () => {
    if (!contentTemplateSaveModal) return
    const name = contentTemplateSaveModal.name.trim()
    const groupId = contentTemplateSaveModal.groupId
    if (!name) {
      showAlert('Vui lòng nhập tên mẫu nội dung.', 'error')
      return
    }
    if (!window.electronAPI?.createContentTemplate) {
      showAlert('Tính năng mẫu nội dung chưa sẵn sàng.', 'error')
      return
    }

    const target = contentTemplateSaveModal.target
    const channelName = getContentTemplateTargetChannel(target)
    const rich = target === 'content' && (
      (channelName === 'email' && formData.emailBodyIsHtml) ||
      (channelName !== 'email' && isFormattedContentEnabled)
    )
    const rawVariants = target === 'content' && isAdvancedContentMode
      ? normalizedAdvancedContentItems.map(item => item.content)
      : rich
        ? splitFormattedContentVariants(getAiContentValue(target))
        : splitContentVariants(getAiContentValue(target), { fallbackToRaw: true })
    const variants = rawVariants.filter(variant => rich
      ? !isFormattedContentEmpty(variant)
      : String(variant || '').trim().length > 0)
    if (variants.length === 0) {
      showAlert('Vui lòng nhập nội dung trước khi lưu mẫu.', 'error')
      return
    }

    const emailSubjects = channelName === 'email' && target === 'content' && isAdvancedContentMode
      ? Array.from(new Set(normalizedAdvancedContentItems.map(item => (
          advancedContentSourceMode === 'manual'
            ? resolveLegacyManualEmailSubject(item).trim()
            : String(item.emailSubject ?? '').trim()
        ))))
      : [formData.emailSubject.trim()]
    if (channelName === 'email' && (emailSubjects.length !== 1 || !emailSubjects[0])) {
      showAlert('Một mẫu email chỉ dùng một tiêu đề. Vui lòng nhập cùng một tiêu đề cho mọi nội dung nâng cao trước khi lưu mẫu.', 'error')
      return
    }

    const templateMediaMode: MediaSelectionMode = target === 'commentContent'
      ? 'image-video'
      : channelName === 'facebook_post' || channelName === 'facebook_message' || channelName === 'facebook_comment'
        ? mainMediaSelectionMode
        : 'image'
    const getCloudMediaUrls = (items: CampaignMediaInput[]): { urls: string[]; skipped: number } => {
      let skipped = 0
      const urls = items.flatMap(item => {
        const cloudUrl = getCampaignMediaCloudUrl(item).trim()
        if (!/^https?:\/\//i.test(cloudUrl)) {
          skipped += 1
          return []
        }
        const supported = runtimeMediaSourceMatchesSelectionMode(templateMediaMode, {
          cloudUrl,
          name: getCampaignMediaDisplayName(item),
          mimeType: getCampaignMediaMimeType(item)
        })
        if (!supported) {
          skipped += 1
          return []
        }
        // Content templates persist only the URL. A video URL without a recognizable
        // extension would round-trip back as an image because its MIME/name are lost.
        if (
          isCampaignMediaVideo(item) &&
          contentTemplateImagesToSnapshots([cloudUrl], 'video').snapshots.length === 0
        ) {
          skipped += 1
          return []
        }
        return [cloudUrl]
      })
      return { urls: Array.from(new Set(urls)).slice(0, 10), skipped }
    }

    let imageUrls: string[] = []
    let mediaWarning = ''
    if (target === 'content' && channelName !== 'sms') {
      if (isAdvancedContentMode) {
        const mediaSets = normalizedAdvancedContentItems.map(item => (
          item.mediaOption === 'none'
            ? { urls: [] as string[], skipped: 0 }
            : getCloudMediaUrls(item.mediaItems || [])
        ))
        const firstKey = JSON.stringify(mediaSets[0]?.urls || [])
        const hasDifferentMedia = mediaSets.some(set => JSON.stringify(set.urls) !== firstKey)
        const skipped = mediaSets.reduce((sum, set) => sum + set.skipped, 0)
        if (hasDifferentMedia) {
          mediaWarning = 'Các nội dung nâng cao đang dùng bộ media khác nhau. Mẫu chỉ lưu một bộ media dùng chung nên lần lưu này sẽ chỉ lưu nội dung.'
        } else {
          imageUrls = mediaSets[0]?.urls || []
          if (skipped > 0) mediaWarning = `Có ${skipped} media không phù hợp hoặc chưa có URL cloud nên sẽ không được lưu vào mẫu.`
        }
      } else if (formData.imageOption !== 'none') {
        const media = getCloudMediaUrls(formData.images)
        imageUrls = media.urls
        if (media.skipped > 0) mediaWarning = `Có ${media.skipped} media chưa có URL cloud hoặc không phù hợp nên sẽ không được lưu vào mẫu.`
      }
    } else if (target === 'commentContent' && formData.commentImageOption !== 'none') {
      const commentImagesForTemplate = formData.commentImageOption === 'random'
        ? formData.commentImages
        : formData.commentImages.slice(0, 1)
      const media = getCloudMediaUrls(commentImagesForTemplate)
      imageUrls = media.urls
      if (media.skipped > 0) mediaWarning = 'Có media comment chưa có URL cloud nên sẽ không được lưu vào mẫu.'
    }

    const channels: ContentTemplateChannels = {}
    channels[channelName] = {
      enabled: true,
      variants: variants.map(text => ({ text: rich ? sanitizeFormattedContent(text) : text })),
      imageUrls: channelName === 'sms' ? [] : imageUrls,
      ...(channelName === 'email' ? { subject: emailSubjects[0], isHtml: rich } : {}),
      ...((channelName === 'zalo_message' || channelName === 'facebook_post')
        ? { formattedContentEnabled: rich }
        : {})
    }

    const payload: CreateContentTemplateInput = {
      name,
      groupId,
      channels
    }
    const persist = async () => {
      setContentTemplateSaving(true)
      try {
        await window.electronAPI.createContentTemplate(payload)
        setContentTemplateSaveModal(null)
        await loadContentTemplates()
        window.dispatchEvent(new Event('content-templates-updated'))
        showAlert('Đã lưu mẫu nội dung.', 'success')
      } catch (err) {
        showAlert(formatIpcErrorMessage(err, 'Không thể lưu mẫu nội dung.'), 'error')
      } finally {
        setContentTemplateSaving(false)
      }
    }

    if (mediaWarning) {
      showConfirm(
        `${mediaWarning}\n\nBạn có muốn tiếp tục lưu mẫu không?`,
        persist,
        { title: 'Media không thể lưu đầy đủ', confirmText: 'Lưu mẫu', variant: 'primary' }
      )
      return
    }
    await persist()
  }

  const renderContentTemplateToolbar = (target: AiContentTarget) => (
    <div className="content-template-inline-toolbar" aria-label="Công cụ mẫu nội dung">
      {target === 'content' && isMessageCampaign && !isZaloShareMessageMode && renderMessagePersonalizationDropdown('content')}
      {renderContentPreviewButton(target)}
      <button
        type="button"
        className="btn btn-ghost content-template-inline-button"
        onClick={() => openContentTemplatePicker(target)}
        title="Chọn mẫu nội dung"
      >
        <FileText size={15} />
        <span>Chọn mẫu</span>
      </button>
      <button
        type="button"
        className="btn btn-ghost content-template-inline-button"
        onClick={() => openSaveContentTemplateModal(target)}
        title="Lưu nội dung hiện tại thành mẫu"
      >
        <Save size={15} />
        <span>Lưu mẫu</span>
      </button>
      <button
        type="button"
        className="btn btn-ghost content-template-inline-button"
        onClick={() => openContentTemplateManager(getContentTemplateTargetChannel(target))}
        disabled={!onOpenContentTemplates}
        title={onOpenContentTemplates ? 'Quản lý mẫu nội dung' : 'Không thể mở quản lý mẫu trong form này'}
      >
        <Settings2 size={15} />
        <span>Quản lý mẫu</span>
      </button>
    </div>
  )

  const renderContentToolsRow = (target: AiContentTarget) => (
    <div className="content-editor-toolbar-row">
      {!(target === 'content' && isFormattedContentEnabled) && renderAiContentToolbar(target)}
      {renderContentTemplateToolbar(target)}
    </div>
  )

  const splitAiContentVariants = (content: string): string[] =>
    splitContentVariants(content)

  const getPostBackgroundValidationError = (): string | null => {
    if (!isPostBackgroundActive) return null

    if (isAdvancedContentMode) {
      const variants = advancedContentSaveValidationItems
      if (variants.length === 0) return 'Vui lòng thêm ít nhất 1 nội dung nâng cao để đăng bài với phông nền.'

      const tooLongIndex = variants.findIndex(item => renderContentSpinMax(item.content).length > 130)
      if (tooLongIndex >= 0) {
        return `Nội dung phông nền nâng cao số ${tooLongIndex + 1} không được quá 130 ký tự.`
      }

      const tooManyLinesIndex = variants.findIndex(item => String(item.content || '').split(/\r?\n/).length > 3)
      if (tooManyLinesIndex >= 0) {
        return `Nội dung phông nền nâng cao số ${tooManyLinesIndex + 1} chỉ được tối đa 3 dòng.`
      }

      const hasAdvancedMedia = variants.some(item => item.mediaOption !== 'none' && (item.mediaItems || []).length > 0)
      if (hasAdvancedMedia) {
        return 'Đăng bài với phông nền không thể gửi kèm media. Vui lòng bỏ media trong nội dung nâng cao trước khi lưu.'
      }

      if (isSourceContentMode || isReelsMediaMode) {
        return 'Đăng bài với phông nền không hỗ trợ copy/chia sẻ nội dung từ nguồn hoặc đăng Reels.'
      }

      return null
    }

    const variants = splitAiContentVariants(formData.content)
    if (variants.length === 0) return 'Vui lòng nhập nội dung để đăng bài với phông nền.'

    const tooLongIndex = variants.findIndex(variant => renderContentSpinMax(variant).length > 130)
    if (tooLongIndex >= 0) {
      return `Nội dung phông nền số ${tooLongIndex + 1} không được quá 130 ký tự.`
    }

    const tooManyLinesIndex = variants.findIndex(variant => variant.split(/\r?\n/).length > 3)
    if (tooManyLinesIndex >= 0) {
      return `Nội dung phông nền số ${tooManyLinesIndex + 1} chỉ được tối đa 3 dòng.`
    }

    if (formData.imageOption !== 'none' && formData.images.length > 0) {
      return 'Đăng bài với phông nền không thể gửi kèm media. Vui lòng chọn Không gửi media trước khi lưu.'
    }

    if (isSourceContentMode || isReelsMediaMode) {
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

  const isUsableCampaignMedia = (item: CampaignMediaInput): boolean => {
    const cloudUrl = getCampaignMediaCloudUrl(item).trim()
    if (cloudUrl) return true
    const trimmed = getCampaignMediaLocalPath(item).trim()
    return isCampaignMediaLocalAvailable(trimmed)
  }

  const validateSelectedImages = (
    label: string,
    option: string,
    images: CampaignMediaInput[],
    mode: MediaSelectionMode
  ): boolean => {
    if (option === 'none' || images.length === 0) return true
    const invalidTypeItems = mode === 'file'
      ? []
      : images.filter(item => !campaignMediaMatchesRuntimeSelectionMode(item, mode))
    if (invalidTypeItems.length > 0) {
      const expected = mode === 'image' ? 'ảnh' : mode === 'video' ? 'video' : 'ảnh/video'
      const names = invalidTypeItems.slice(0, 3).map(getCampaignMediaDisplayName).join(', ')
      const suffix = invalidTypeItems.length > 3 ? ` và ${invalidTypeItems.length - 3} file khác` : ''
      showAlert(`${label} chỉ hỗ trợ ${expected}: ${names}${suffix}. Vui lòng xoá file không phù hợp hoặc chọn lại.`, 'error')
      return false
    }
    if (usesZaloServerAccount) {
      const localOnlyImages = images.filter(isLocalOnlyCampaignMedia)
      if (localOnlyImages.length > 0) {
        const names = localOnlyImages.slice(0, 3).map(getCampaignMediaDisplayName).join(', ')
        const suffix = localOnlyImages.length > 3 ? ` và ${localOnlyImages.length - 3} file khác` : ''
        showAlert(`${label} có file chỉ nằm trên máy local: ${names}${suffix}. Zalo Server chỉ dùng được media đã upload lên cloud.`, 'error')
        return false
      }
    }
    const missingImages = images.filter(item => !isUsableCampaignMedia(item))
    if (missingImages.length === 0) return true

    const names = missingImages.slice(0, 3).map(getCampaignMediaDisplayName).join(', ')
    const suffix = missingImages.length > 3 ? ` và ${missingImages.length - 3} file khác` : ''
    showAlert(`${label} có file không còn tồn tại và không có cloud URL fallback: ${names}${suffix}. Vui lòng xoá file lỗi hoặc chọn lại.`, 'error')
    return false
  }

  const validateCommentMediaPool = (label: string, option: string, images: CampaignMediaInput[]): boolean => {
    if (option !== 'all' || images.length <= 1) return true
    showAlert(`${label} ở chế độ "Gửi media đã chọn" chỉ được chọn tối đa 1 ảnh hoặc video. Vui lòng xoá bớt media hoặc chuyển sang gửi ngẫu nhiên.`, 'error')
    return false
  }

  const validateAdvancedContentItems = (): boolean => {
    if (!isAdvancedContentMode) return true
    if (advancedContentSourceMode === 'group') return true
    if (normalizedAdvancedContentItems.length === 0) {
      setManualAdvancedContentModalOpen(true)
      showAlert('Vui lòng thêm ít nhất 1 nội dung nâng cao hoặc chuyển về chế độ Cơ bản.', 'error')
      return false
    }
    if (isSmsCampaign && normalizedAdvancedContentItems.length > MAX_SMS_ADVANCED_CONTENT_ITEMS) {
      setManualAdvancedContentModalOpen(true)
      showAlert(`Nội dung nâng cao SMS chỉ được tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} mục.`, 'error')
      return false
    }

    const invalidIndex = findInvalidAdvancedContentItemIndex(normalizedAdvancedContentItems, {
      allowMediaOnly: !isMobileManagedSmsCampaign,
      contentIsEmpty: isRichContentEditorEnabled ? isFormattedContentEmpty : undefined
    })
    if (invalidIndex < 0) {
      if (isEmailCampaign) {
        const missingSubjectIndex = normalizedAdvancedContentItems.findIndex(item => (
          !resolveLegacyManualEmailSubject(item).trim()
        ))
        if (missingSubjectIndex >= 0) {
          setManualAdvancedContentModalOpen(true)
          showAlert(`Vui lòng nhập tiêu đề email cho nội dung nâng cao số ${missingSubjectIndex + 1}.`, 'error')
          return false
        }
      }
      return true
    }

    setManualAdvancedContentModalOpen(true)
    showAlert(
      isMobileManagedSmsCampaign
        ? `Nội dung nâng cao số ${invalidIndex + 1} chưa có nội dung SMS.`
        : `Nội dung nâng cao số ${invalidIndex + 1} đang rỗng. Vui lòng nhập nội dung hoặc chọn media, hoặc xoá nội dung này.`,
      'error'
    )
    return false
  }

  const validateAdvancedContentMedia = (): boolean => {
    if (!isAdvancedContentMode || isMobileManagedSmsCampaign) return true
    const itemsToValidate = isAdvancedGroupSource
      ? advancedContentSaveValidationItems
      : normalizedAdvancedContentItems

    for (let index = 0; index < itemsToValidate.length; index += 1) {
      const item = itemsToValidate[index]
      if (isCommentSeedingCampaign && !validateCommentMediaPool(
        `Media nội dung nâng cao ${index + 1}`,
        item.mediaOption || 'none',
        item.mediaItems || []
      )) {
        if (!isAdvancedGroupSource) setManualAdvancedContentModalOpen(true)
        return false
      }
      if (!validateSelectedImages(
        `Media nội dung nâng cao ${index + 1}`,
        item.mediaOption || 'none',
        item.mediaItems || [],
        getMediaSelectionMode({ kind: 'advanced', itemId: item.id })
      )) {
        if (!isAdvancedGroupSource) setManualAdvancedContentModalOpen(true)
        return false
      }
    }

    return true
  }

  const validateReelsMedia = (): boolean => {
    if (!isReelsMediaMode) return true

    const items = isAdvancedContentMode
      ? advancedContentSaveValidationItems
      : [{
          id: 'basic-reels-media',
          content: formData.content,
          mediaOption: formData.imageOption,
          mediaItems: formData.images,
          randomMediaCount: formData.randomImageCount
        }]

    if (items.length === 0) {
      showAlert('Đăng Reels cần ít nhất một video.', 'error')
      return false
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const mediaItems = item.mediaOption === 'none' ? [] : (item.mediaItems || [])
      const label = isAdvancedContentMode ? `Nội dung nâng cao ${index + 1}` : 'Reels'
      if (mediaItems.length === 0) {
        showAlert(`${label} cần chọn ít nhất một video để đăng Reels.`, 'error')
        return false
      }
      if (mediaItems.some(media => !campaignMediaMatchesRuntimeSelectionMode(media, 'video'))) {
        showAlert(`${label} chỉ được dùng video khi bật Đăng Reels. Vui lòng xoá ảnh hoặc file khác.`, 'error')
        return false
      }
      if (item.mediaOption === 'all' && mediaItems.length !== 1) {
        showAlert(`${label} ở chế độ "Đăng video đã chọn" chỉ được chọn đúng 1 video. Hãy xoá bớt hoặc chuyển sang ngẫu nhiên.`, 'error')
        return false
      }
    }

    return true
  }

  const prepareAdvancedContentForSave = async (): Promise<AdvancedContentSaveOverride | null> => {
    if (isSourceContentMode) {
      return {
        items: [],
        formattedContentEnabled: false,
        emailBodyIsHtml: false,
        emailSubject: ''
      }
    }

    const hasSavedGroupSnapshot = advancedContentSourceMode === 'group' &&
      savedAdvancedContentSource === 'group_snapshot' &&
      !!savedAdvancedGroupSnapshot
    const getSavedGroupItemsForCurrentMode = (): CampaignAdvancedContentItem[] => (
      savedGroupSnapshotIsRich && groupSnapshotMustUsePlain
        ? savedGroupAdvancedContentItemsRef.current.map(item => ({
            ...item,
            content: formattedContentToPlainText(item.content)
          }))
        : savedGroupAdvancedContentItemsRef.current
    )
    const savedGroupEffectiveRich = savedGroupSnapshotIsRich && !groupSnapshotMustUsePlain

    if (hasSavedGroupSnapshot && !advancedContentTargetChannel) {
      // Actions such as Voice Call do not support Advanced content. Saving
      // the action change explicitly clears the dormant group snapshot so
      // it can never be executed under an incompatible contract.
      return {
        items: [],
        formattedContentEnabled: false,
        emailBodyIsHtml: false,
        emailSubject: formData.emailSubject.trim()
      }
    }

    if (!isAdvancedContentMode && pendingContentTemplateGroupId === null) {
      const preserveSavedGroup = advancedContentSourceMode === 'group' &&
        savedAdvancedContentSource === 'group_snapshot' &&
        !!savedAdvancedGroupSnapshot &&
        savedGroupSnapshotMatchesTargetChannel
      const preserveManualSource = !preserveSavedGroup && (
        normalizedAdvancedContentItems.length > 0 ||
        (savedAdvancedContentSource === 'manual' && campaign?.extraSettings?.advancedContentEnabled === true)
      )
      return {
        ...(preserveSavedGroup
          ? { source: 'group_snapshot' as const }
          : preserveManualSource
            ? { source: 'manual' as const }
            : {}),
        items: preserveSavedGroup
          ? getSavedGroupItemsForCurrentMode()
          : normalizedAdvancedContentItems,
        ...(preserveSavedGroup ? { groupSnapshot: savedAdvancedGroupSnapshot } : {}),
        formattedContentEnabled: preserveSavedGroup
          ? !isEmailCampaign && savedGroupEffectiveRich
          : canUseFormattedContent && formData.formattedContentEnabled,
        emailBodyIsHtml: preserveSavedGroup
          ? isEmailCampaign && savedGroupEffectiveRich
          : isEmailCampaign && formData.emailBodyIsHtml,
        emailSubject: preserveSavedGroup && isEmailCampaign
          ? String(savedGroupAdvancedContentItemsRef.current[0]?.emailSubject || '').trim()
          : formData.emailSubject.trim()
      }
    }

    if (advancedContentSourceMode === 'manual') {
      return {
        source: 'manual',
        items: normalizedAdvancedContentItems,
        formattedContentEnabled: canUseFormattedContent && formData.formattedContentEnabled,
        emailBodyIsHtml: isEmailCampaign && formData.emailBodyIsHtml,
        emailSubject: isEmailCampaign
          ? String(normalizedAdvancedContentItems[0]?.emailSubject === undefined || normalizedAdvancedContentItems[0]?.emailSubject === null
              ? formData.emailSubject
              : normalizedAdvancedContentItems[0].emailSubject).trim()
          : ''
      }
    }

    if (preserveSavedGroupSnapshotOnSave && savedAdvancedGroupSnapshot) {
      return {
        source: 'group_snapshot',
        items: getSavedGroupItemsForCurrentMode(),
        groupSnapshot: savedAdvancedGroupSnapshot,
        formattedContentEnabled: !isEmailCampaign && savedGroupEffectiveRich,
        emailBodyIsHtml: isEmailCampaign && savedGroupEffectiveRich,
        emailSubject: isEmailCampaign
          ? String(savedGroupAdvancedContentItemsRef.current[0]?.emailSubject || '').trim()
          : ''
      }
    }

    const groupId = selectedContentTemplateGroupId ?? undefined
    if (!groupId) {
      showAlert('Vui lòng chọn Nhóm mẫu nội dung trước khi lưu chiến dịch.', 'error')
      return null
    }
    if (!advancedContentTargetChannel) {
      showAlert('Hành động này chưa có kênh mẫu nội dung tương thích.', 'error')
      return null
    }
    if (!window.electronAPI?.listContentTemplates || !window.electronAPI?.listContentTemplateGroups) {
      showAlert('Kho mẫu nội dung chưa sẵn sàng. Snapshot cũ của chiến dịch chưa bị thay đổi.', 'error')
      return null
    }

    try {
      const [latestTemplates, latestGroups] = await Promise.all([
        window.electronAPI.listContentTemplates(),
        window.electronAPI.listContentTemplateGroups()
      ])
      setContentTemplates(latestTemplates)
      setContentTemplateGroups(latestGroups)

      const latestGroup = latestGroups.find(group => group.id === groupId && !group.isDelete)
      if (!latestGroup) {
        showAlert('Nhóm mẫu đã bị xoá hoặc không còn truy cập được. Snapshot cũ của chiến dịch được giữ nguyên.', 'error')
        return null
      }
      if (latestGroup.isActive === false) {
        showAlert(
          `Nhóm “${latestGroup.name}” đã ngừng hoạt động nên không thể tạo hoặc cập nhật snapshot mới. Snapshot đã lưu trước đó vẫn được giữ nguyên và có thể tiếp tục sử dụng.`,
          'error'
        )
        return null
      }

      const candidate = buildContentTemplateGroupCandidate(
        latestTemplates,
        latestGroup,
        advancedContentTargetChannel,
        mainMediaSelectionMode
      )
      if (candidate.variantCount === 0) {
        showAlert(
          `Không thể dùng nhóm này cho chiến dịch ${getAdvancedContentCampaignLabel(advancedContentTargetChannel)} vì nhóm chưa có mẫu ${getContentTemplateChannelLabel(advancedContentTargetChannel)}.`,
          'error'
        )
        return null
      }
      if (isSmsCampaign && candidate.variantCount > MAX_SMS_ADVANCED_CONTENT_ITEMS) {
        showAlert(
          `Nhóm “${latestGroup.name}” có ${candidate.variantCount} nội dung SMS, vượt giới hạn ${MAX_SMS_ADVANCED_CONTENT_ITEMS} của chiến dịch SMS. Snapshot cũ được giữ nguyên.`,
          'error'
        )
        return null
      }

      const targetSupportsRich = isEmailCampaign || supportsFormattedContent(formData.actionId)
      const useRich = candidate.rich && targetSupportsRich && !groupSnapshotMustUsePlain
      const items = candidate.items.map(item => ({
        ...item,
        content: candidate.rich && !useRich
          ? formattedContentToPlainText(item.content)
          : item.content,
        ...(isSmsCampaign ? { mediaOption: 'none' as const, mediaItems: [] } : {})
      }))

      return {
        source: 'group_snapshot',
        items,
        groupSnapshot: {
          groupId: latestGroup.id,
          groupName: latestGroup.name,
          capturedAt: new Date().toISOString(),
          templateCount: candidate.compatibleTemplateCount,
          itemCount: items.length
        },
        formattedContentEnabled: !isEmailCampaign && useRich,
        emailBodyIsHtml: isEmailCampaign && useRich,
        emailSubject: isEmailCampaign ? String(items[0]?.emailSubject || '').trim() : ''
      }
    } catch (err) {
      showAlert(
        `${formatIpcErrorMessage(err, 'Không thể tải lại kho mẫu nội dung.')} Snapshot cũ của chiến dịch chưa bị thay đổi.`,
        'error'
      )
      return null
    }
  }

  const normalizeCampaignInputDataForSave = (rows: Partial<CampaignInputData>[]): Partial<CampaignInputData>[] => {
    return rows
      .map(row => {
        const phone = isPhoneInputCampaign || isPhoneOrUidInputCampaign
          ? (normalizeVietnamMobilePhone(row.phone) || '')
          : String(row.phone || '').trim()
        return {
          ...row,
          name: String(row.name || '').trim(),
          phone,
          phoneCarrier: inferInputDataPhoneCarrier(phone, row.phoneCarrier),
          uid: String(row.uid || '').trim(),
          email: normalizeEmailAddress(row.email),
          info1: String(row.info1 || '').trim(),
          info2: String(row.info2 || '').trim(),
          info3: String(row.info3 || '').trim(),
          info4: String(row.info4 || '').trim(),
          info5: String(row.info5 || '').trim(),
          note: String(row.note || '').trim()
        }
      })
      .filter(row => isPhoneInputCampaign
        ? row.phone.length > 0
        : isPhoneOrUidInputCampaign
          ? row.phone.length > 0 || row.uid.length > 0
          : isEmailCampaign
            ? isValidEmailAddress(row.email)
            : row.uid.length > 0)
  }

  const buildCampaignSaveBundleItems = (
    detailRows: Partial<CampaignInputData>[] = details,
    advancedContentOverride?: AdvancedContentSaveOverride
  ): CampaignSaveBundleItem[] => {
    const accountChunks: Partial<CampaignInputData>[][] = []
    const numAccounts = formData.accountIds.length
    const shouldDiscardDetailsForSave = formData.actionId === 'facebook_timeline_post' || formData.actionId === NEWSFEED_INTERACTION_ACTION_ID
    const detailSource = isDataGroupSource || shouldDiscardDetailsForSave || hideDetailsSection ? [] : detailRows

    if (!isDataGroupSource && !hasPendingDirectDataGroupSnapshots && formData.splitDataAcrossAccounts && numAccounts > 1 && detailSource.length > 0) {
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
      const accountRateLimitMinutes = isVoiceCallCampaign
        ? VOICE_CALL_DEFAULT_RATE_LIMIT_MINUTES
        : getAccountRateLimitMinutes(accountId)
      const defaultLimit = {
        dailyLimit: clampDailyLimitToEntitlement(formData.dailyLimit, campaignDailyLimitCap),
        rateLimitCount: formData.rateLimitCount,
        rateLimitMinutes: accountRateLimitMinutes
      }
      const enabledActionCodes = checkedLimitActionCodes
      const byActionCode = Object.fromEntries(
        checkedLimitActionCodes.map(code => {
          const limit = isHiddenActionLimitConfig(code)
            ? getDefaultActionLimitForCode(code, defaultLimit)
            : (formData.actionLimitsByCode[code] || getDefaultActionLimitForCode(code, defaultLimit))
          const clampedLimit = clampActionLimitDailyLimit(code, limit)
          const useFormRateLimitMinutes = Boolean(campaign?.id || cloneFromId) || editedRateLimitMinuteActions[code]
          return [
            code,
            {
              ...clampedLimit,
              rateLimitMinutes: useFormRateLimitMinutes
                ? normalizeRateLimitMinutes(clampedLimit.rateLimitMinutes)
                : accountRateLimitMinutes
            }
          ]
        })
      )

      const effectivePostsPerTarget = isCommentSeedingPostCampaign ? 1 : formData.postsPerTarget
      const effectiveEnableMessage = (
        isMessageFriendCampaign ||
        isPageInboxMessageCampaign ||
        isZaloMessageFriendCampaign ||
        isZaloMessageBirthdayCampaign ||
        isZaloMessageGroupCampaign
      ) ? true : formData.enableMessage
      const effectiveEnableAddFriend = (
        isMessageFriendCampaign ||
        isPageInboxMessageCampaign ||
        isZaloMessageFriendCampaign ||
        isZaloMessageBirthdayCampaign ||
        isZaloMessageGroupCampaign
      ) ? false : formData.enableAddFriend
      const effectiveUseSuggestedFriends = isMessageUidCampaign
        ? (isEditingSavedCampaign ? campaign?.extraSettings?.useSuggestedFriends === true : formData.useSuggestedFriends)
        : false
      const effectiveSuggestedFriendsCount = isMessageUidCampaign
        ? normalizeSuggestedFriendsCount(isEditingSavedCampaign
          ? (campaign?.extraSettings?.suggestedFriendsCount ?? formData.suggestedFriendsCount)
          : formData.suggestedFriendsCount)
        : 10
      const normalizedMultiDailySlots = usesMultiDailyTimeSlots
        ? parseDailyTimeSlots(formData.multiDailyTimeSlots).slots
        : []
      const scheduleInput = normalizedMultiDailySlots.length > 0
        ? setDateTimeLocalTime(formData.schedule, normalizedMultiDailySlots[0])
        : formData.schedule
      const formSchedule = toIsoDateTimeValue(scheduleInput)
      const normalizedScheduleEndDate = formData.scheduleType === 'daily' || isZaloMessageGroupRealtimeCampaign || isMobileManagedSmsCampaign
        ? null
        : (formData.scheduleEndDate ? new Date(formData.scheduleEndDate + 'T23:59:59').toISOString() : null)
      const normalizedScheduleType = isZaloMessageGroupRealtimeCampaign || isMobileManagedSmsCampaign ? 'daily' : formData.scheduleType
      const normalizedScheduleDays = normalizedScheduleType === 'monthly' ? formData.scheduleDays.trim() : ''
      const normalizedScheduleWeekDays = normalizedScheduleType === 'weekly' ? formData.scheduleWeekDays : ''
      const normalizedFindData = normalizeFindDataFlagState(formData, { isSearchCampaign: isFindDataSearchCampaign })
      const canUseFindDataPostContentConditionsForSave = normalizedFindData.isFindInPost || normalizedFindData.isFindInComment || normalizedFindData.isFindPostLink
      const canUsePostContentConditionsForSave = isCommentSeedingFeedCampaign || canUseFindDataPostContentConditionsForSave
      const canUseFindDataCommentContentConditionsForSave = normalizedFindData.isFindInComment
      const saveFindDataPostSort = normalizedFindData.isFindNewInteractors ? 'recent_activity' : formData.sortTypePost
      const saveFindDataCommentSort = normalizedFindData.isFindNewInteractors ? 'newest' : formData.sortTypeComment
      const saveFindDataGoalPriority = formData.findDataGoalModeEnabled
        ? normalizeFindDataGoalPriority(normalizedFindData, formData.findDataGoalPriority) || undefined
        : undefined
      const saveFindDataTargetDataGroups = isFindDataCampaign
        ? getFindDataTargetDataGroupsForSave(
          formData.findDataTargetDataGroups,
          normalizedFindData,
          isFindDataSearchCampaign
        )
        : undefined
      const useZaloFriendSourceTags = isZaloMessageFriendCampaign && formData.zaloFriendTargetMode === 'tagged_friends'
      const selectedZaloFriendSourceTagIds = useZaloFriendSourceTags
        ? normalizeZaloTagIdList(formData.zaloFriendSourceTagIds)
        : []
      const selectedZaloFriendSourceTagNames = useZaloFriendSourceTags
        ? selectedZaloFriendSourceTagIds.map((id, tagIndex) => {
          const label = zaloLabels.find(item => String(item.id) === id)
          return label?.text || formData.zaloFriendSourceTagNames[tagIndex] || ''
        })
        : []
      const selectedAkaBizTagIds = supportsAkaBizContactTags && formData.enableAkaBizTag
        ? getCampaignIdList(formData.akaBizTagIds)
        : []
      const selectedAkaBizTagNames = selectedAkaBizTagIds.map((id, tagIndex) => {
        const tag = akaBizContactTags.find(item => item.id === id)
        return tag?.name || formData.akaBizTagNames[tagIndex] || ''
      })
      const selectedZaloRealtimeGroupIds = isZaloMessageGroupRealtimeCampaign
        ? getZaloRealtimeGroupIdsForSave()
        : []
      const selectedZaloRealtimeGroupNames = isZaloMessageGroupRealtimeCampaign
        ? getZaloRealtimeGroupNamesForSave(selectedZaloRealtimeGroupIds)
        : []
      const selectedZaloAddGroupMemberGroupId = isZaloAddGroupMemberCampaign
        ? normalizeZaloRealtimeGroupId(formData.zaloAddGroupMemberTargetGroupId)
        : ''
      const selectedZaloAddGroupMemberGroupName = isZaloAddGroupMemberCampaign
        ? String(formData.zaloAddGroupMemberTargetGroupName || '').trim()
        : ''
      const selectedFacebookGroupInviteTargetGroupUid = isFacebookGroupInviteCampaign
        ? String(formData.facebookGroupInviteTargetGroupUid || '').trim()
        : ''
      const selectedFacebookGroupInviteTargetGroupUrl = isFacebookGroupInviteCampaign
        ? normalizeFacebookGroupInviteGroupUrl(formData.facebookGroupInviteTargetGroupUrl || formData.facebookGroupInviteTargetGroupUid)
        : ''
      const selectedFacebookGroupInviteTargetGroupName = isFacebookGroupInviteCampaign
        ? String(formData.facebookGroupInviteTargetGroupName || '').trim()
        : ''
      const selectedInternalSmsStatuses = usesInternalSmsPush && formData.internalSmsEnabled
        ? EXTERNAL_SMS_STATUS_OPTIONS
          .map(option => option.value)
          .filter(status => formData.internalSmsStatuses.includes(status))
        : []
      const selectedExternalSmsStatuses = supportsExternalSmsPush && formData.externalSmsEnabled
        ? EXTERNAL_SMS_STATUS_OPTIONS
          .map(option => option.value)
          .filter(status => formData.externalSmsStatuses.includes(status))
        : []
      const isSavingGroupSnapshot = advancedContentOverride?.source === 'group_snapshot'
      const canSaveAdvancedContent = !isSourceContentMode && (showContentSection || isSavingGroupSnapshot)
      const manualDraftFormattedContentEnabled = canUseFormattedContent && formData.formattedContentEnabled
      const manualDraftEmailBodyIsHtml = isEmailCampaign && formData.emailBodyIsHtml
      const manualDraftUsesRichContent = isEmailCampaign
        ? manualDraftEmailBodyIsHtml
        : manualDraftFormattedContentEnabled
      const normalizeManualDraftItem = (item: CampaignAdvancedContentItem): CampaignAdvancedContentItem => {
        const manualItem = isEmailCampaign && (item.emailSubject === undefined || item.emailSubject === null)
          ? { ...item, emailSubject: formData.emailSubject.trim() }
          : item
        const content = manualDraftUsesRichContent
          ? sanitizeFormattedContent(manualItem.content)
          : manualItem.content
        if (isCommentSeedingCampaign) {
          const mediaItems = manualItem.mediaItems || []
          return {
            ...manualItem,
            content,
            mediaOption: mediaItems.length > 0 && manualItem.mediaOption !== 'none'
              ? manualItem.mediaOption || 'none'
              : 'none',
            mediaItems,
            randomMediaCount: 1
          }
        }
        if (isReelsMediaMode) {
          return { ...manualItem, content, randomMediaCount: 1 }
        }
        return isMobileManagedSmsCampaign
          ? { ...manualItem, content, mediaOption: 'none', mediaItems: [] }
          : { ...manualItem, content }
      }
      const manualDraftForSave: AdvancedContentManualDraft = {
        content: manualDraftUsesRichContent
          ? sanitizeFormattedContent(formData.content)
          : formData.content,
        advancedContentItems: normalizedAdvancedContentItems.map(normalizeManualDraftItem),
        formattedContentEnabled: manualDraftFormattedContentEnabled,
        emailSubject: isEmailCampaign ? formData.emailSubject.trim() : '',
        emailBodyIsHtml: manualDraftEmailBodyIsHtml,
        rewriteContentEachRun: isMobileManagedSmsCampaign || manualDraftUsesRichContent
          ? false
          : formData.rewriteContentEachRun
      }
      const formattedContentForSave = isSourceContentMode
        ? false
        : (advancedContentOverride?.formattedContentEnabled ?? manualDraftFormattedContentEnabled)
      const emailBodyIsHtmlForSave = isEmailCampaign
        ? (advancedContentOverride?.emailBodyIsHtml ?? manualDraftEmailBodyIsHtml)
        : false
      const preserveExistingGroupSnapshotItems = advancedContentOverride?.source === 'group_snapshot' &&
        preserveSavedGroupSnapshotOnSave
      const advancedContentItemsForSave = canSaveAdvancedContent
        ? preserveExistingGroupSnapshotItems
          ? (advancedContentOverride?.items ?? [])
          : (advancedContentOverride?.items ?? normalizedAdvancedContentItems).map(item => {
              const itemWithLegacyEmailSubject = isEmailCampaign && !isSavingGroupSnapshot &&
                (item.emailSubject === undefined || item.emailSubject === null)
                ? { ...item, emailSubject: formData.emailSubject.trim() }
                : item
              const normalizedItem = formattedContentForSave || emailBodyIsHtmlForSave
                ? { ...itemWithLegacyEmailSubject, content: sanitizeFormattedContent(itemWithLegacyEmailSubject.content) }
                : itemWithLegacyEmailSubject
              if (isCommentSeedingCampaign) {
                const mediaItems = normalizedItem.mediaItems || []
                return {
                  ...normalizedItem,
                  mediaOption: mediaItems.length > 0 && normalizedItem.mediaOption !== 'none'
                    ? normalizedItem.mediaOption || 'none'
                    : 'none',
                  mediaItems,
                  randomMediaCount: 1
                }
              }
              if (isReelsMediaMode) {
                return { ...normalizedItem, randomMediaCount: 1 }
              }
              return isMobileManagedSmsCampaign
                ? { ...normalizedItem, mediaOption: 'none' as const, mediaItems: [] }
                : normalizedItem
            })
        : []
      const contentForSave = isSourceContentMode
        ? ''
        : isSavingGroupSnapshot
          ? String(advancedContentItemsForSave[0]?.content || '')
          : manualDraftForSave.content

      return {
        campaignPayload: {
          name: formData.name,
          actionId: formData.actionId,
          accountId,
          secondaryAccountId: allowsSecondaryAccount ? formData.secondaryAccountId : null,
          dataTargetSourceMode: isDataGroupSource ? 'data_group' : 'direct',
          dataGroupId: isDataGroupSource ? formData.dataGroupId : null,
          ...(cloneFromId ? { status: 'tạm dừng' } : {}),
          schedule: formSchedule,
          originalSchedule: formSchedule,
          scheduleType: normalizedScheduleType,
          scheduleEndDate: normalizedScheduleEndDate,
          dailyStopTime: isMobileManagedSmsCampaign ? null : (formData.useDailyStopTime ? (formData.dailyStopTime || DEFAULT_DAILY_STOP_TIME) : null),
          scheduleDays: normalizedScheduleDays,
          scheduleWeekDays: normalizedScheduleWeekDays,
          continueNextDay: isMobileManagedSmsCampaign ? true : ((isNewsfeedInteractionCampaign || isZaloMessageBirthdayCampaign || isZaloMessageGroupRealtimeCampaign) ? false : formData.continueNextDay),
          refreshData: isDataGroupSource
            ? false
            : (isZaloMessageBirthdayCampaign || isZaloMessageFriendRecommendationCampaign || isZaloCancelSentFriendRequestCampaign)
            ? true
            : (isMobileManagedSmsCampaign ? true : (isZaloMessageGroupRealtimeCampaign ? false : formData.refreshData)),
          content: contentForSave,
          extraSettings: {
            sharePost: isSourceContentMode && supportsSourceSharePost ? formData.sharePost : false,
            postWithBackground: formattedContentForSave ? false : isPostBackgroundActive,
            rewriteContentEachRun: isSavingGroupSnapshot || isMobileManagedSmsCampaign || formattedContentForSave || emailBodyIsHtmlForSave
              ? false
              : manualDraftForSave.rewriteContentEachRun,
            formattedContentEnabled: formattedContentForSave,
            advancedContentEnabled: isSourceContentMode
              ? false
              : isSavingGroupSnapshot
              ? true
              : (canUseAdvancedContentMode ? formData.advancedContentEnabled : false),
            advancedContentItems: advancedContentItemsForSave,
            advancedContentSource: advancedContentOverride?.source,
            advancedContentGroupSnapshot: advancedContentOverride?.source === 'group_snapshot'
              ? advancedContentOverride.groupSnapshot
              : undefined,
            advancedContentManualDraft: isSavingGroupSnapshot ? manualDraftForSave : undefined,
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
              dailyLimit: clampDailyLimitToEntitlement(formData.dailyLimit, campaignDailyLimitCap),
              rateLimitCount: formData.rateLimitCount,
              rateLimitMinutes: (campaign?.id || cloneFromId) ? normalizeRateLimitMinutes(formData.rateLimitMinutes) : accountRateLimitMinutes,
              continueWhenActionLimitReached: formData.continueWhenActionLimitReached,
              byActionCode
            },
            recentDeliveryCooldownEnabled: canUseRecentDeliveryCooldown && formData.recentDeliveryCooldownEnabled,
            recentDeliveryCooldownDays: normalizeRecentDeliveryCooldownDays(formData.recentDeliveryCooldownDays),
            imageOption: (isSourceContentMode || isMobileManagedSmsCampaign || isFacebookJoinGroupCampaign || isFacebookGroupInviteCampaign || isPostBackgroundActive) ? 'none' : formData.imageOption,
            randomImageCount: isReelsMediaMode ? 1 : formData.randomImageCount,
            commentImageOption: formData.commentImages.length > 0 && formData.commentImageOption !== 'none'
              ? formData.commentImageOption
              : 'none',
            commentImages: formData.commentImages,
            leaveGroupOnPendingApproval: formData.leaveGroupOnPendingApproval,
            autoJoinGroupAfterPost: formData.autoJoinGroupAfterPost,
            shuffleGroupList: formData.shuffleGroupList,
            skipPostIfGroupRequiresApproval: formData.skipPostIfGroupRequiresApproval,
            enableGroupPostShareToJoinedGroups: isFacebookGroupPostCampaign ? formData.enableGroupPostShareToJoinedGroups : false,
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
            postBumpAccountIds: formData.postBumpMode === 'create' ? validPostBumpAccountIds : [],
            postBumpContent: formData.postBumpContent,
            postBumpCreatedCampaignIdsByAccount: formData.postBumpCreatedCampaignIdsByAccount,
            postBumpRotationIndex: formData.postBumpRotationIndex,
            enableMessage: effectiveEnableMessage,
            enableAddFriend: effectiveEnableAddFriend,
            useSuggestedFriends: isDataGroupSource ? false : effectiveUseSuggestedFriends,
            suggestedFriendsCount: effectiveSuggestedFriendsCount,
            emailSubject: isEmailCampaign
              ? (isSavingGroupSnapshot
                  ? (advancedContentOverride?.emailSubject || '')
                  : manualDraftForSave.emailSubject)
              : '',
            emailBodyIsHtml: emailBodyIsHtmlForSave,
            emailCheckLinkClicks: isEmailCampaign ? formData.emailCheckLinkClicks : false,
            smsUseUnicode: isSmsCampaign ? formData.smsUseUnicode : undefined,
            smsKeepNewLines: isSmsCampaign ? formData.smsKeepNewLines : undefined,
            voiceCall: isVoiceCallCampaign ? {
              schemaVersion: 1,
              fallbackDelaySeconds: 15,
              maxAudioSeconds: 90,
              noRetry: true
            } : undefined,
            internalSmsEnabled: usesInternalSmsPush ? formData.internalSmsEnabled : false,
            internalSmsAccountIds: usesInternalSmsPush && formData.internalSmsEnabled ? getCampaignIdList(formData.internalSmsAccountIds) : [],
            internalSmsContent: usesInternalSmsPush && formData.internalSmsEnabled ? formData.internalSmsContent.trim() : '',
            internalSmsStatuses: selectedInternalSmsStatuses,
            internalSmsCreatedCampaignIdsByAccount: usesInternalSmsPush
              ? formData.internalSmsCreatedCampaignIdsByAccount
              : {},
            externalSmsEnabled: supportsExternalSmsPush && !usesInternalSmsPush ? formData.externalSmsEnabled : false,
            externalSmsShopIds: supportsExternalSmsPush && !usesInternalSmsPush && formData.externalSmsEnabled ? getCampaignIdList(formData.externalSmsShopIds) : [],
            externalSmsContent: supportsExternalSmsPush && !usesInternalSmsPush && formData.externalSmsEnabled ? formData.externalSmsContent.trim() : '',
            externalSmsStatuses: supportsExternalSmsPush && !usesInternalSmsPush ? selectedExternalSmsStatuses : [],
            friendRequestMessage: (isZaloMessagePhoneCampaign || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign) ? formData.friendRequestMessage.trim() : '',
            zaloAddGroupMemberTargetGroupId: selectedZaloAddGroupMemberGroupId,
            zaloAddGroupMemberTargetGroupName: selectedZaloAddGroupMemberGroupName,
            zaloAddGroupMemberUseShareMethod: isZaloAddGroupMemberCampaign ? formData.zaloAddGroupMemberUseShareMethod : false,
            facebookGroupInviteTargetGroupUid: selectedFacebookGroupInviteTargetGroupUid,
            facebookGroupInviteTargetGroupUrl: selectedFacebookGroupInviteTargetGroupUrl,
            facebookGroupInviteTargetGroupName: selectedFacebookGroupInviteTargetGroupName,
            zaloRealtimeTriggers: isZaloMessageGroupRealtimeCampaign ? getZaloRealtimeTriggersForSave() : [],
            zaloRealtimeGroupIds: selectedZaloRealtimeGroupIds,
            zaloRealtimeGroupNames: selectedZaloRealtimeGroupNames,
            zaloRealtimeEndDate: isZaloMessageGroupRealtimeCampaign ? formData.zaloRealtimeEndDate : null,
            zaloMessageSendMode: (isZaloMessageFriendCampaign || isZaloMessageGroupCampaign) && !formattedContentForSave ? formData.zaloMessageSendMode : 'normal',
            zaloOptOutLinkEnabled: supportsZaloOptOutLink ? formData.zaloOptOutLinkEnabled : false,
            enableZaloTag: (isZaloMessagePhoneCampaign || (isZaloMessageFriendCampaign && !isZaloShareMessageMode) || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign) ? formData.enableZaloTag : false,
            zaloTagId: (isZaloMessagePhoneCampaign || (isZaloMessageFriendCampaign && !isZaloShareMessageMode) || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign) && formData.enableZaloTag ? formData.zaloTagId : null,
            zaloTagName: (isZaloMessagePhoneCampaign || (isZaloMessageFriendCampaign && !isZaloShareMessageMode) || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign) && formData.enableZaloTag ? formData.zaloTagName : '',
            enableAkaBizTag: supportsAkaBizContactTags ? formData.enableAkaBizTag : false,
            akaBizTagIds: selectedAkaBizTagIds,
            akaBizTagNames: selectedAkaBizTagNames,
            enableZaloAlias: (isZaloMessagePhoneCampaign || (isZaloMessageFriendCampaign && !isZaloShareMessageMode) || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign) ? formData.enableZaloAlias : false,
            zaloAliasTemplate: (isZaloMessagePhoneCampaign || (isZaloMessageFriendCampaign && !isZaloShareMessageMode) || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign) && formData.enableZaloAlias ? formData.zaloAliasTemplate.trim() : '',
            zaloFriendRecommendationCount: isZaloMessageFriendRecommendationCampaign
              ? normalizeZaloFriendRecommendationCount(formData.zaloFriendRecommendationCount)
              : 10,
            zaloFriendRecommendationDataMaterializedAt: isZaloMessageFriendRecommendationCampaign && !cloneFromId
              ? (campaign?.extraSettings?.zaloFriendRecommendationDataMaterializedAt ?? null)
              : null,
            zaloFriendRecommendationMaterializedCount: isZaloMessageFriendRecommendationCampaign && !cloneFromId
              ? (campaign?.extraSettings?.zaloFriendRecommendationMaterializedCount ?? 0)
              : 0,
            zaloCancelFriendRequestLimit: isZaloCancelSentFriendRequestCampaign
              ? normalizeZaloCancelFriendRequestLimit(formData.zaloCancelFriendRequestLimit)
              : 10,
            zaloCancelFriendRequestDataMaterializedAt: isZaloCancelSentFriendRequestCampaign && !cloneFromId
              ? (campaign?.extraSettings?.zaloCancelFriendRequestDataMaterializedAt ?? null)
              : null,
            zaloCancelFriendRequestMaterializedCount: isZaloCancelSentFriendRequestCampaign && !cloneFromId
              ? (campaign?.extraSettings?.zaloCancelFriendRequestMaterializedCount ?? 0)
              : 0,
            zaloFriendTargetMode: isDataGroupSource ? 'selected' : (isZaloMessageFriendCampaign ? formData.zaloFriendTargetMode : 'selected'),
            zaloFriendSourceTagIds: selectedZaloFriendSourceTagIds,
            zaloFriendSourceTagNames: selectedZaloFriendSourceTagNames,
            zaloFriendDataMaterializedAt: isZaloMessageFriendCampaign && isZaloFriendAutoDataMode && !cloneFromId
              ? (campaign?.extraSettings?.zaloFriendDataMaterializedAt ?? null)
              : null,
            zaloFriendMaterializedCount: isZaloMessageFriendCampaign && isZaloFriendAutoDataMode && !cloneFromId
              ? (campaign?.extraSettings?.zaloFriendMaterializedCount ?? 0)
              : 0,
            zaloFriendBlocklistEnabled: isZaloMessageFriendCampaign ? formData.zaloFriendBlocklistEnabled : false,
            zaloFriendBlocklistId: isZaloMessageFriendCampaign && formData.zaloFriendBlocklistEnabled ? formData.zaloFriendBlocklistId : null,
            zaloFriendBlocklistName: isZaloMessageFriendCampaign && formData.zaloFriendBlocklistEnabled
              ? (selectedZaloFriendBlocklist?.name || formData.zaloFriendBlocklistName || '')
              : '',
            zaloBirthdayDataMaterializedDate: isZaloMessageBirthdayCampaign && !cloneFromId
              ? (campaign?.extraSettings?.zaloBirthdayDataMaterializedDate ?? null)
              : null,
            zaloBirthdayMaterializedCount: isZaloMessageBirthdayCampaign && !cloneFromId
              ? (campaign?.extraSettings?.zaloBirthdayMaterializedCount ?? 0)
              : 0,
            pageInboxPageUid: isPageInboxMessageCampaign ? formData.pageInboxPageUid : '',
            pageInboxPageName: isPageInboxMessageCampaign ? formData.pageInboxPageName : '',
            copyContentFromSource: isSourceContentMode,
            includeSourceImages: isSourceContentMode ? formData.includeSourceImages : false,
            rewriteSourceContentWithAI: isSourceContentMode ? formData.rewriteSourceContentWithAI : false,
            sourceContentAiPrompt: isSourceContentMode && formData.rewriteSourceContentWithAI
              ? formData.sourceContentAiPrompt
              : '',
            postAsReels: !isSourceContentMode && supportsSourceReels && !isPostBackgroundActive ? formData.postAsReels : false,
            sourceLinks: formData.sourceLinks,
            sourceLinkIndex: cloneFromId ? 0 : (campaign?.extraSettings?.sourceLinkIndex ?? 0),
            contentRotationIndex: cloneFromId ? 0 : (campaign?.extraSettings?.contentRotationIndex ?? 0),
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
            findDataRerunEnabled: !isDataGroupSource && canUseRerunAfterCompletion ? formData.findDataRerunEnabled : false,
            findDataRerunAfterHours: canUseRerunAfterCompletion
              ? normalizeHourValue(formData.findDataRerunAfterHours)
              : DEFAULT_FIND_DATA_RERUN_AFTER_HOURS,
            multiDailyTimeSlotsEnabled: usesMultiDailyTimeSlots,
            multiDailyTimeSlots: usesMultiDailyTimeSlots
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
            findPhoneZaloMessagePhoneTargetCampaignIds: normalizedFindData.isFindPhone && canUseZaloFeature && handleFoundPhoneZaloMessagePhoneData ? getCampaignIdList(formData.findPhoneZaloMessagePhoneTargetCampaignIds) : [],
            findZaloGroupLinkWebTargetCampaignIds: normalizedFindData.isFindLinkGroupZalo && handleFoundZaloGroupLinkWebData ? getCampaignIdList(formData.findZaloGroupLinkWebTargetCampaignIds) : [],
            findZaloGroupLinkJoinTargetCampaignIds: normalizedFindData.isFindLinkGroupZalo && canUseZaloFeature && handleFoundZaloGroupLinkJoinData ? getCampaignIdList(formData.findZaloGroupLinkJoinTargetCampaignIds) : [],
            findPhoneAkaBizDesktopTargetCampaignIds: normalizedFindData.isFindPhone && handleFoundPhoneAkaBizDesktopData ? getCampaignIdList(formData.findPhoneAkaBizDesktopTargetCampaignIds) : [],
            findZaloGroupLinkAkaBizDesktopTargetCampaignIds: normalizedFindData.isFindLinkGroupZalo && handleFoundZaloGroupLinkAkaBizDesktopData ? getCampaignIdList(formData.findZaloGroupLinkAkaBizDesktopTargetCampaignIds) : [],
            findFacebookGroupPostTargetCampaignIds: isFindDataSearchCampaign && normalizedFindData.isFindFacebookGroup && handleFoundFacebookGroupPostData
              ? getCampaignIdList(formData.findFacebookGroupPostTargetCampaignIds)
              : [],
            findFacebookGroupCommentTargetCampaignIds: isFindDataSearchCampaign && normalizedFindData.isFindFacebookGroup && handleFoundFacebookGroupCommentData
              ? getCampaignIdList(formData.findFacebookGroupCommentTargetCampaignIds)
              : [],
            findFacebookGroupJoinTargetCampaignIds: isFindDataSearchCampaign && normalizedFindData.isFindFacebookGroup && handleFoundFacebookGroupJoinData
              ? getCampaignIdList(formData.findFacebookGroupJoinTargetCampaignIds)
              : [],
            findDataTargetDataGroups: saveFindDataTargetDataGroups
          } as CampaignExtraSettings,
          images: isSourceContentMode || isMobileManagedSmsCampaign || isFacebookJoinGroupCampaign || isFacebookGroupInviteCampaign ? [] : formData.images
        },
        details: (accountChunks[index] || []).map(detail => ({ ...detail })),
        dataGroupSnapshots: isDataGroupSource || !canUseDataGroupSource
          ? []
          : directDataGroupSnapshots.map(snapshot => ({ ...snapshot }))
      }
    })
  }

  const handleSave = async () => {
    if (savingCampaign) return
    if (!formData.name.trim() || !formData.actionId || formData.accountIds.length === 0) {
      showAlert('Vui lòng nhập Tên, Hành động và Tài khoản.', 'error')
      return
    }
    if (
      canUseRecentDeliveryCooldown &&
      formData.recentDeliveryCooldownEnabled &&
      (!Number.isInteger(formData.recentDeliveryCooldownDays) ||
        formData.recentDeliveryCooldownDays < MIN_RECENT_DELIVERY_COOLDOWN_DAYS ||
        formData.recentDeliveryCooldownDays > MAX_RECENT_DELIVERY_COOLDOWN_DAYS)
    ) {
      showAlert(`Số ngày không gửi/đăng lặp phải là số nguyên từ ${MIN_RECENT_DELIVERY_COOLDOWN_DAYS} đến ${MAX_RECENT_DELIVERY_COOLDOWN_DAYS}.`, 'error')
      return
    }
    if (isDataGroupSource && (!Number.isSafeInteger(formData.dataGroupId) || Number(formData.dataGroupId) <= 0)) {
      showAlert('Vui lòng chọn Nhóm data cho chiến dịch.', 'error')
      return
    }
    if (isEmailCampaign && !canUseEmailFeature) {
      showAlert('Tính năng Email chưa được kích hoạt hoặc đã hết hạn.', 'error')
      return
    }
    if (!canUseCampaignAction(selectedCampaignAction, entitlements)) {
      showAlert('Tính năng này chưa được kích hoạt hoặc đã hết hạn.', 'error')
      return
    }
    if (requiresSingleAccount && formData.accountIds.length !== 1) {
      showAlert(
        'Hành động chiến dịch này chỉ hỗ trợ chọn 1 tài khoản.',
        'error'
      )
      return
    }
    if (formData.secondaryAccountId !== null) {
      if (!allowsSecondaryAccount) {
        showAlert('Hành động chiến dịch này không hỗ trợ tài khoản phụ.', 'error')
        return
      }
      if (formData.accountIds.length !== 1) {
        showAlert('Khi chọn tài khoản phụ, vui lòng chỉ chọn 1 tài khoản chính.', 'error')
        return
      }

      const primaryAccount = accounts.find(account => account.id === formData.accountIds[0])
      const secondaryAccount = accounts.find(account => account.id === formData.secondaryAccountId)
      if (!primaryAccount || !secondaryAccount) {
        showAlert('Tài khoản chính hoặc tài khoản phụ không còn tồn tại. Vui lòng chọn lại.', 'error')
        return
      }
      if (primaryAccount.id === secondaryAccount.id) {
        showAlert('Tài khoản phụ phải khác tài khoản chính.', 'error')
        return
      }
      if (
        normalizeCampaignActionPlatform(primaryAccount.flatformType) !== selectedActionPlatform ||
        normalizeCampaignActionPlatform(secondaryAccount.flatformType) !== selectedActionPlatform
      ) {
        showAlert('Tài khoản phụ phải cùng nền tảng với tài khoản chính và chiến dịch.', 'error')
        return
      }
      if (
        selectedActionPlatform === 'zalo' &&
        (
          isZaloWebAccount(primaryAccount) !== isZaloWebAccount(secondaryAccount) ||
          isZaloServerAccount(primaryAccount) !== isZaloServerAccount(secondaryAccount)
        )
      ) {
        showAlert('Tài khoản phụ Zalo phải cùng loại QR local, Trình duyệt hoặc Server với tài khoản chính.', 'error')
        return
      }
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
    if (isZaloAddGroupMemberCampaign) {
      if (formData.accountIds.length !== 1) {
        showAlert('Chiến dịch thêm thành viên group Zalo chỉ hỗ trợ chọn 1 tài khoản.', 'error')
        return
      }
      if (!normalizeZaloRealtimeGroupId(formData.zaloAddGroupMemberTargetGroupId)) {
        showAlert('Vui lòng chọn group Zalo cần thêm thành viên.', 'error')
        return
      }
    }
    if (isFacebookGroupInviteCampaign) {
      if (formData.accountIds.length !== 1) {
        showAlert('Chiến dịch mời vào group chỉ hỗ trợ chọn 1 tài khoản Facebook.', 'error')
        return
      }
      if (!normalizeFacebookGroupInviteGroupUrl(formData.facebookGroupInviteTargetGroupUrl || formData.facebookGroupInviteTargetGroupUid)) {
        showAlert('Vui lòng chọn group nhận lời mời.', 'error')
        return
      }
    }
    if (isZaloMessagePhoneCampaign || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign) {
      if (!formData.enableMessage && !formData.enableAddFriend) {
        showAlert('Vui lòng chọn ít nhất nhắn tin hoặc kết bạn.', 'error')
        return
      }
      if (friendRequestMessageMaxLength > 150) {
        showAlert('Nội dung kết bạn không được quá 150 ký tự.', 'error')
        return
      }
      if (supportsAkaBizContactTags && formData.enableAkaBizTag && getCampaignIdList(formData.akaBizTagIds).length === 0) {
        showAlert('Vui lòng chọn tag akaBiz cần gắn.', 'error')
        return
      }
      if (!isZaloShareMessageMode && formData.enableZaloTag && !formData.zaloTagId) {
        showAlert('Vui lòng chọn tag Zalo cần gắn.', 'error')
        return
      }
      if (!isZaloShareMessageMode && formData.enableZaloAlias && !formData.zaloAliasTemplate.trim()) {
        showAlert('Vui lòng nhập template đổi tên Zalo.', 'error')
        return
      }
      if (supportsExternalSmsPush) {
        if (usesInternalSmsPush && formData.internalSmsEnabled) {
          if (getCampaignIdList(formData.internalSmsAccountIds).length === 0) {
            showAlert('Vui lòng chọn ít nhất một tài khoản Sms.', 'error')
            return
          }
          if (!formData.internalSmsContent.trim()) {
            showAlert('Vui lòng nhập nội dung Sms.', 'error')
            return
          }
          if (formData.internalSmsStatuses.length === 0) {
            showAlert('Vui lòng chọn ít nhất một trạng thái để gửi tin nhắn Sms.', 'error')
            return
          }
        } else if (!usesInternalSmsPush && formData.externalSmsEnabled) {
          if (!hasSmsIntegration) {
            showAlert('Vui lòng tích hợp akaBiz Sms trước khi gửi tin nhắn Sms.', 'error')
            return
          }
          if (getCampaignIdList(formData.externalSmsShopIds).length === 0) {
            showAlert('Vui lòng chọn ít nhất một tài khoản akaBiz Sms.', 'error')
            return
          }
          if (!formData.externalSmsContent.trim()) {
            showAlert('Vui lòng nhập nội dung Sms.', 'error')
            return
          }
          if (formData.externalSmsStatuses.length === 0) {
            showAlert('Vui lòng chọn ít nhất một trạng thái để gửi tin nhắn Sms.', 'error')
            return
          }
        }
      }
      if (isZaloMessageFriendRecommendationCampaign && normalizeZaloFriendRecommendationCount(formData.zaloFriendRecommendationCount) < 1) {
        showAlert('Vui lòng nhập số lượng đề xuất lớn hơn 0.', 'error')
        return
      }
    }
    if (isZaloMessageGroupRealtimeCampaign) {
      if (getZaloRealtimeTriggersForSave().length === 0) {
        showAlert('Vui lòng chọn ít nhất một loại data theo thời gian thực cần nhận.', 'error')
        return
      }
      if (getZaloRealtimeGroupIdsForSave().length === 0) {
        showAlert('Vui lòng chọn ít nhất một group Zalo để nhận data theo thời gian thực.', 'error')
        return
      }
      if (!formData.zaloRealtimeEndDate) {
        showAlert('Vui lòng chọn ngày kết thúc không nhận data nữa.', 'error')
        return
      }
    }
    if (isZaloMessageFriendCampaign) {
      if (formData.zaloFriendTargetMode === 'tagged_friends' && normalizeZaloTagIdList(formData.zaloFriendSourceTagIds).length === 0) {
        showAlert('Vui lòng chọn tag nguồn Zalo để lấy danh sách bạn bè.', 'error')
        return
      }
      if (formData.zaloFriendBlocklistEnabled && !formData.zaloFriendBlocklistId) {
        showAlert('Vui lòng chọn danh sách không gửi tin Zalo.', 'error')
        return
      }
      if (supportsAkaBizContactTags && formData.enableAkaBizTag && getCampaignIdList(formData.akaBizTagIds).length === 0) {
        showAlert('Vui lòng chọn tag akaBiz cần gắn.', 'error')
        return
      }
      if (!isZaloShareMessageMode && formData.enableZaloTag && !formData.zaloTagId) {
        showAlert('Vui lòng chọn tag Zalo cần gắn.', 'error')
        return
      }
      if (!isZaloShareMessageMode && formData.enableZaloAlias && !formData.zaloAliasTemplate.trim()) {
        showAlert('Vui lòng nhập template đổi tên Zalo.', 'error')
        return
      }
    }
    if (isZaloMessageGroupCampaign && supportsAkaBizContactTags && formData.enableAkaBizTag && getCampaignIdList(formData.akaBizTagIds).length === 0) {
      showAlert('Vui lòng chọn tag akaBiz cần gắn.', 'error')
      return
    }
    if (isZaloCancelSentFriendRequestCampaign && normalizeZaloCancelFriendRequestLimit(formData.zaloCancelFriendRequestLimit) < 1) {
      showAlert('Vui lòng nhập số lời mời cần huỷ lớn hơn 0.', 'error')
      return
    }
    if (!isSourceContentMode && !isMobileManagedSmsCampaign && showContentSection && !isFacebookJoinGroupCampaign && !isAdvancedContentMode && !validateSelectedImages(
      isEmailCampaign ? 'Tệp đính kèm' : 'Media',
      formData.imageOption,
      formData.images,
      getMediaSelectionMode('post')
    )) {
      return
    }
    if (!validateAdvancedContentItems()) {
      return
    }
    if (!validateAdvancedContentMedia()) {
      return
    }
    if (!validateReelsMedia()) {
      return
    }
    const shouldValidateBasicCommentMedia =
      (isCommentSeedingCampaign && !isAdvancedContentMode) ||
      (isFacebookGroupPostCampaign && formData.enableComment)
    if (shouldValidateBasicCommentMedia) {
      if (!validateCommentMediaPool('Media comment', formData.commentImageOption, formData.commentImages)) return
      if (!validateSelectedImages('Media comment', formData.commentImageOption, formData.commentImages, 'image-video')) return
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
    if (isEmailCampaign && !isAdvancedContentMode && !formData.emailSubject.trim()) {
      showAlert('Vui lòng nhập tiêu đề email.', 'error')
      return
    }
    if (requiresMainContentOrMedia && !isAdvancedGroupSource && !hasMainContentText && !hasSelectedMainMedia) {
      showAlert(
        isEmailCampaign
          ? 'Vui lòng nhập nội dung email hoặc chọn ít nhất một tệp đính kèm.'
        : isSmsCampaign
          ? 'Vui lòng nhập nội dung tin nhắn SMS.'
        : isVoiceCallCampaign
          ? 'Vui lòng nhập nội dung cuộc gọi tự động.'
        : isMessageCampaign
          ? `Vui lòng nhập nội dung tin nhắn hoặc chọn ít nhất một ${isZaloMessageCampaign ? 'file' : selectedActionPlatform === 'facebook' ? 'ảnh/video' : 'ảnh'}.`
          : `Vui lòng nhập nội dung chiến dịch hoặc chọn ít nhất một ${selectedActionPlatform === 'facebook' ? 'ảnh/video' : 'ảnh'}.`,
        'error'
      )
      return
    }
    if (isVoiceCallCampaign) {
      const ttsInputLength = `${VOICE_CALL_AI_DISCLOSURE} ${renderContentSpinMax(formData.content)}`.trim().length
      if (ttsInputLength > VOICE_CALL_MAX_TTS_INPUT_CHARS) {
        showAlert(`Nội dung cuộc gọi sau khi thêm thông báo giọng nói AI không được vượt quá ${VOICE_CALL_MAX_TTS_INPUT_CHARS.toLocaleString('vi-VN')} ký tự.`, 'error')
        return
      }
    }
    const postBackgroundError = getPostBackgroundValidationError()
    if (postBackgroundError) {
      if (isAdvancedContentMode && advancedContentSourceMode === 'manual') {
        setManualAdvancedContentModalOpen(true)
      }
      showAlert(postBackgroundError, 'error')
      return
    }
    let validatedMultiDailyTimeSlots: string[] | null = null
    if (usesMultiDailyTimeSlots) {
      const { slots, invalidItems } = parseDailyTimeSlots(formData.multiDailyTimeSlots)
      if (invalidItems.length > 0) {
        showAlert(`Khung giờ không hợp lệ: ${invalidItems.join(', ')}. Vui lòng nhập dạng hh:mm, ví dụ 09:00, 10:30.`, 'error')
        return
      }
      if (slots.length < 2) {
        showAlert('Vui lòng nhập ít nhất 2 khung giờ chạy trong ngày.', 'error')
        return
      }
      validatedMultiDailyTimeSlots = slots
    }
    if (!isMobileManagedSmsCampaign) {
      const latestRunTime = validatedMultiDailyTimeSlots
        ? validatedMultiDailyTimeSlots[validatedMultiDailyTimeSlots.length - 1]
        : getDateTimeLocalTime(formData.schedule)
      if (getDailyTimeSlotMinutes(latestRunTime) === 23 * 60 + 59) {
        showAlert('23:59 là thời gian hệ thống dừng nhận lượt mới để cập nhật lịch ngày mới. Vui lòng chọn giờ chạy sớm hơn.', 'error')
        return
      }
    }
    if (!isMobileManagedSmsCampaign && formData.useDailyStopTime) {
      const stopTimeMinutes = getDailyTimeSlotMinutes(formData.dailyStopTime)
      if (stopTimeMinutes === null) {
        showAlert('Vui lòng chọn giờ dừng chạy.', 'error')
        return
      }

      const latestRunTime = validatedMultiDailyTimeSlots
        ? validatedMultiDailyTimeSlots[validatedMultiDailyTimeSlots.length - 1]
        : getDateTimeLocalTime(formData.schedule)
      const latestRunTimeMinutes = getDailyTimeSlotMinutes(latestRunTime)
      if (latestRunTimeMinutes === null) {
        showAlert('Vui lòng chọn ngày và giờ chạy trước.', 'error')
        return
      }
      if (stopTimeMinutes <= latestRunTimeMinutes) {
        showAlert(
          validatedMultiDailyTimeSlots
            ? `Giờ dừng chạy trong ngày phải sau khung giờ chạy cuối cùng (${latestRunTime}).`
            : `Giờ dừng chạy trong ngày phải sau giờ chạy (${latestRunTime}).`,
          'error'
        )
        return
      }
    }
    const detailRowsForSave = isFindDataSearchCampaign && !isEditingSavedCampaign
      ? findDataSearchKeywordRows
      : details
    const validDetails = isEditingSavedCampaign ? details : normalizeCampaignInputDataForSave(detailRowsForSave)
    const findDataRerunHours = Math.floor(Number(formData.findDataRerunAfterHours))
    if (!isDataGroupSource && canUseRerunAfterCompletion && formData.findDataRerunEnabled && (!Number.isFinite(findDataRerunHours) || findDataRerunHours < 1)) {
      showAlert('Vui lòng nhập số giờ chạy lại lớn hơn hoặc bằng 1.', 'error')
      return
    }
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
      const requiredDataGroupDestinations: Array<{
        kind: FindDataOutputKind
        label: string
        enabled: boolean
      }> = [
        { kind: 'phone', label: 'SĐT', enabled: normalizedFindData.isFindPhone && findDataTargetDataGroupEnabled.phone },
        { kind: 'zalo_group_link', label: 'link group Zalo', enabled: normalizedFindData.isFindLinkGroupZalo && findDataTargetDataGroupEnabled.zalo_group_link },
        { kind: 'facebook_uid', label: 'UID Facebook', enabled: normalizedFindData.isFindUid && findDataTargetDataGroupEnabled.facebook_uid },
        { kind: 'post_link', label: 'link bài post', enabled: normalizedFindData.isFindPostLink && findDataTargetDataGroupEnabled.post_link },
        {
          kind: 'facebook_group',
          label: 'group Facebook',
          enabled: isFindDataSearchCampaign
            && normalizedFindData.isFindFacebookGroup
            && findDataTargetDataGroupEnabled.facebook_group
        }
      ]
      for (const item of requiredDataGroupDestinations) {
        if (!item.enabled) continue
        const groupId = Number(formData.findDataTargetDataGroups[item.kind]?.groupId)
        if (!Number.isSafeInteger(groupId) || groupId <= 0) {
          showAlert(`Vui lòng chọn Nhóm data nhận ${item.label}.`, 'error')
          return
        }

        const resolvedGroup = findDataTargetDataGroupDetails[item.kind]
        if (!resolvedGroup || resolvedGroup.id !== groupId) {
          if (resolvedFindDataTargetDataGroupIdsKey !== findDataTargetDataGroupIdsKey) {
            if (failedFindDataTargetDataGroupIdsKey === findDataTargetDataGroupIdsKey) {
              setFindDataTargetDataGroupHydrationRetry(previous => previous + 1)
              showAlert(`Không thể kiểm tra Nhóm data nhận ${item.label}. Hệ thống đang tải lại, vui lòng thử lưu lại.`, 'info')
            } else {
              showAlert(`Đang kiểm tra Nhóm data nhận ${item.label}. Vui lòng thử lưu lại.`, 'info')
            }
            return
          }
          setFindDataTargetDataGroup(item.kind, null)
          showAlert(`Nhóm data nhận ${item.label} không còn hoạt động. Vui lòng chọn nhóm khác.`, 'error')
          return
        }

        const targetActionId = FIND_DATA_GROUP_DESTINATION_CONFIG[item.kind].actionId
        const targetAction = campaignActions.find(action => action.id === targetActionId)
        if (!isDataGroupCompatibleWithCampaignAction(resolvedGroup, targetAction)) {
          setFindDataTargetDataGroup(item.kind, null)
          showAlert(`Nhóm data nhận ${item.label} không còn tương thích với loại dữ liệu. Vui lòng chọn nhóm khác.`, 'error')
          return
        }
      }
      if (formData.isFindUid && handleFoundUidData && formData.findUidTargetCampaignIds.length === 0 && !isDraftAutoLinkedFindUid) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch nhận UID.', 'error')
        return
      }
      if (formData.isFindPostLink && handleFoundPostLinkData && formData.findPostLinkTargetCampaignIds.length === 0 && !isDraftAutoLinkedPostLink) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch nhận link bài post.', 'error')
        return
      }
      if (isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupPostData && formData.findFacebookGroupPostTargetCampaignIds.length === 0 && !isDraftAutoLinkedFacebookGroupPost) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch đăng bài vào group để nhận group Facebook.', 'error')
        return
      }
      if (isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupCommentData && formData.findFacebookGroupCommentTargetCampaignIds.length === 0 && !isDraftAutoLinkedFacebookGroupComment) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch comment seeding để nhận group Facebook.', 'error')
        return
      }
      if (isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupJoinData && formData.findFacebookGroupJoinTargetCampaignIds.length === 0 && !isDraftAutoLinkedFacebookGroupJoin) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch tham gia group để nhận group Facebook.', 'error')
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
      if (formData.isFindPhone && canUseZaloFeature && handleFoundPhoneZaloMessagePhoneData && formData.findPhoneZaloMessagePhoneTargetCampaignIds.length === 0) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch Zalo phone nhận SĐT.', 'error')
        return
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
      if (formData.isFindLinkGroupZalo && canUseZaloFeature && handleFoundZaloGroupLinkJoinData && formData.findZaloGroupLinkJoinTargetCampaignIds.length === 0) {
        showAlert('Vui lòng chọn ít nhất một chiến dịch Zalo tham gia group nhận link group Zalo.', 'error')
        return
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
      if (!isDataGroupSource && !isEditingSavedCampaign && validDetails.length === 0 && !hasPendingDirectDataGroupSnapshots) {
        showAlert(isFindDataSearchCampaign ? 'Vui lòng thêm ít nhất một từ khóa vào danh sách data.' : 'Vui lòng thêm ít nhất một group vào danh sách data.', 'error')
        return
      }
    }
    if (!isDataGroupSource && !isEditingSavedCampaign && formData.actionId === 'facebook_group_post' && validDetails.length === 0 && !hasPendingDirectDataGroupSnapshots && !hasSelectedFindDataSourceCampaign) {
      showAlert('Vui lòng thêm ít nhất một group vào danh sách data.', 'error')
      return
    }
    if (!isDataGroupSource && !isEditingSavedCampaign && isFacebookJoinGroupCampaign && validDetails.length === 0 && !hasPendingDirectDataGroupSnapshots && !hasSelectedFindDataSourceCampaign) {
      showAlert('Vui lòng thêm ít nhất một group vào danh sách data.', 'error')
      return
    }
    if (!isDataGroupSource && !isEditingSavedCampaign && isFacebookGroupInviteCampaign && validDetails.length === 0 && !hasPendingDirectDataGroupSnapshots) {
      showAlert('Vui lòng chọn ít nhất một bạn bè cần mời.', 'error')
      return
    }
    if (!isDataGroupSource && !isEditingSavedCampaign && isZaloAddGroupMemberCampaign && validDetails.length === 0 && !hasPendingDirectDataGroupSnapshots) {
      showAlert('Vui lòng thêm ít nhất một SĐT hoặc UID Zalo vào danh sách data.', 'error')
      return
    }
    if (!isDataGroupSource && !isEditingSavedCampaign && isPagePostCampaign && validDetails.length === 0 && !hasPendingDirectDataGroupSnapshots) {
      showAlert('Vui lòng chọn ít nhất một fanpage.', 'error')
      return
    }
    if (isMessageUidCampaign && !formData.enableMessage && !formData.enableAddFriend) {
      showAlert('Vui lòng chọn ít nhất một hành động nhắn tin hoặc kết bạn.', 'error')
      return
    }
    if (!isDataGroupSource && !isEditingSavedCampaign && isMessageCampaign && !hideDetailsSection && validDetails.length === 0 && !hasPendingDirectDataGroupSnapshots && !hasSelectedFindDataSourceCampaign && !isDraftTargetFromFindData) {
      showAlert(
        isMessageUidCampaign
          ? 'Vui lòng thêm ít nhất một UID vào danh sách data.'
          : isPageInboxMessageCampaign
            ? 'Vui lòng chọn ít nhất một khách inbox Page.'
          : isPhoneInputCampaign
            ? 'Vui lòng thêm ít nhất một SĐT hợp lệ vào danh sách data.'
          : isZaloMessageFriendCampaign
            ? 'Vui lòng chọn ít nhất một bạn bè Zalo.'
          : isZaloMessageGroupMemberCampaign
            ? 'Vui lòng chọn ít nhất một thành viên group Zalo.'
          : isZaloMessageRemarketingCustomerCampaign
            ? 'Vui lòng chọn ít nhất một khách hàng cũ Zalo.'
          : isZaloMessageGroupCampaign
            ? 'Vui lòng chọn ít nhất một group Zalo.'
          : isEmailCampaign
            ? 'Vui lòng thêm ít nhất một email hợp lệ vào danh sách data.'
          : 'Vui lòng thêm ít nhất một bạn bè vào danh sách data.',
        'error'
      )
      return
    }
    if (isPageInboxMessageCampaign && !String(formData.pageInboxPageUid || '').trim()) {
      showAlert('Vui lòng chọn khách inbox Page từ form Quét data để xác định Page cần gửi tin.', 'error')
      return
    }
    if (!isDataGroupSource && !isEditingSavedCampaign && isSuggestedFriendsUidCampaign && normalizeSuggestedFriendsCount(formData.suggestedFriendsCount) < 1) {
      showAlert('Vui lòng nhập số lượng đề xuất lớn hơn 0.', 'error')
      return
    }
    const hasCommentImages = formData.commentImageOption !== 'none' && formData.commentImages.length > 0
    if (isCommentSeedingCampaign && !isAdvancedContentMode && !formData.commentContent.trim() && !hasCommentImages) {
      showAlert('Vui lòng nhập nội dung comment hoặc chọn media comment.', 'error')
      return
    }
    if (!isDataGroupSource && !isEditingSavedCampaign && isCommentSeedingCampaign && validDetails.length === 0 && !hasPendingDirectDataGroupSnapshots && !hasSelectedFindDataSourceCampaign) {
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
        if (validPostBumpAccountIds.length === 0) {
          showAlert('Vui lòng chọn ít nhất một tài khoản để tạo chiến dịch up tin.', 'error')
          return
        }
        if (!formData.postBumpContent.trim()) {
          showAlert('Vui lòng nhập nội dung up tin.', 'error')
          return
        }
      }
    }

    if (!isDataGroupSource && !isEditingSavedCampaign && !hideDetailsSection) {
      setDetails(validDetails)
    }

    setSavingCampaign(true)
    setSaveProgress({
      percent: 1,
      label: 'Đang chuẩn bị nội dung chiến dịch...'
    })
    await waitForNextBrowserPaint()
    const advancedContentForSave = await prepareAdvancedContentForSave()
    if (!advancedContentForSave) {
      setSavingCampaign(false)
      setSaveProgress(null)
      return
    }

    if (draftMode) {
      if (!onSaveDraft || !draftPickerSourceType) {
        showAlert('Không thể tạo chiến dịch tạm trong ngữ cảnh hiện tại.', 'error')
        setSavingCampaign(false)
        setSaveProgress(null)
        return
      }
      const draftItems = buildCampaignSaveBundleItems(validDetails, advancedContentForSave)
      try {
        updateSaveProgress(3, 'Đang kiểm tra giới hạn data...')
        await assertCampaignSaveItemsWithinInputLimit(draftItems)
      } catch (err) {
        console.error('Failed to validate campaign draft input limit:', err)
        showAlert(formatIpcErrorMessage(err, 'Không thể kiểm tra giới hạn data chiến dịch.'), 'error')
        setSavingCampaign(false)
        setSaveProgress(null)
        return
      }
      onSaveDraft({
        tempId: draftTempId ?? 0,
        sourceType: draftPickerSourceType,
        actionId: formData.actionId,
        requiredTargetField: draftRequiredTargetField,
        items: draftItems
      })
      setSavingCampaign(false)
      setSaveProgress(null)
      return
    }

    try {
      updateSaveProgress(3, 'Đang kiểm tra và chuẩn hóa dữ liệu...')
      const {
        createCampaign,
        createCampaignInputDataBatch,
        deleteCampaignInputDataBatch,
        updateCampaign,
        updateCampaignInputData
      } = useCampaignStore.getState()
      const saveBundleItems = buildCampaignSaveBundleItems(validDetails, advancedContentForSave)
      const linkedDraftTempIds: number[] = []
      const linkedDraftTempIdSet = new Set<number>()
      const collectLinkedDraftTempIds = (ids: number[], enabled: boolean): void => {
        if (!enabled) return
        for (const id of ids) {
          if (id >= 0 || linkedDraftTempIdSet.has(id)) continue
          linkedDraftTempIdSet.add(id)
          linkedDraftTempIds.push(id)
        }
      }
      if (isFindDataCampaign) {
        collectLinkedDraftTempIds(
          formData.findUidTargetCampaignIds,
          formData.isFindUid && handleFoundUidData
        )
        collectLinkedDraftTempIds(
          formData.findPostLinkTargetCampaignIds,
          formData.isFindPostLink && handleFoundPostLinkData
        )
        collectLinkedDraftTempIds(
          formData.findPhoneZaloMessagePhoneTargetCampaignIds,
          formData.isFindPhone && canUseZaloFeature && handleFoundPhoneZaloMessagePhoneData
        )
        collectLinkedDraftTempIds(
          formData.findZaloGroupLinkJoinTargetCampaignIds,
          formData.isFindLinkGroupZalo && canUseZaloFeature && handleFoundZaloGroupLinkJoinData
        )
        collectLinkedDraftTempIds(
          formData.findFacebookGroupPostTargetCampaignIds,
          isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupPostData
        )
        collectLinkedDraftTempIds(
          formData.findFacebookGroupCommentTargetCampaignIds,
          isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupCommentData
        )
        collectLinkedDraftTempIds(
          formData.findFacebookGroupJoinTargetCampaignIds,
          isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupJoinData
        )
      }
      collectLinkedDraftTempIds(
        selectedFindDataSourceCampaignIds,
        !!targetFindDataField
      )

      const linkedDraftProgressStartIndexByTempId = new Map<number, number>()
      let campaignWorkItemCount = saveBundleItems.length
      const newCampaignItemsToValidate = campaign?.id
        ? []
        : [...saveBundleItems]
      for (const tempId of linkedDraftTempIds) {
        const draft = internalCampaignDrafts.find(item => item.tempId === tempId)
        if (!draft || draft.items.length === 0) continue
        linkedDraftProgressStartIndexByTempId.set(tempId, campaignWorkItemCount)
        campaignWorkItemCount += draft.items.length
        newCampaignItemsToValidate.push(...draft.items)
      }
      await assertCampaignSaveItemsWithinInputLimit(newCampaignItemsToValidate)
      updateSaveProgress(5, 'Đã kiểm tra giới hạn data.')
      const shouldDiscardDetailsForSave = formData.actionId === 'facebook_timeline_post' || formData.actionId === NEWSFEED_INTERACTION_ACTION_ID
      const detailIdsToDelete = shouldDiscardDetailsForSave
        ? Array.from(new Set([
          ...deletedIds,
          ...details
            .map(item => item.id)
            .filter((id): id is number => typeof id === 'number')
        ]))
        : deletedIds

      if ((!isEditingSavedCampaign || shouldDiscardDetailsForSave) && detailIdsToDelete.length > 0) {
        updateSaveProgress(6, 'Đang cập nhật danh sách data...')
        await deleteCampaignInputDataBatch(detailIdsToDelete)
      }

      const generatedSaveRequestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `campaign-data-group-${Date.now()}-${Math.random().toString(36).slice(2)}`
      let dataGroupBundleRetryStorageKey: string | null = null
      let dataGroupBundleFingerprint: string | null = null
      if (isDataGroupSource && !campaign?.id) {
        dataGroupBundleFingerprint = await hashDataGroupBundlePayload({
          version: 1,
          items: saveBundleItems
        })
        dataGroupBundleRetryStorageKey = `${DATA_GROUP_BUNDLE_RETRY_STORAGE_PREFIX}${dataGroupBundleFingerprint}`
      }
      const persistedBundleRequestId = dataGroupBundleRetryStorageKey
        ? readStoredDataGroupBundleRequestId(dataGroupBundleRetryStorageKey)
        : null
      const inMemoryBundleRequestId = dataGroupBundleFingerprintRef.current === dataGroupBundleFingerprint
        ? dataGroupBundleRequestIdRef.current
        : null
      const saveRequestId = isDataGroupSource
        ? (inMemoryBundleRequestId || persistedBundleRequestId || generatedSaveRequestId)
        : generatedSaveRequestId
      if (isDataGroupSource) {
        dataGroupBundleRequestIdRef.current = saveRequestId
        dataGroupBundleFingerprintRef.current = dataGroupBundleFingerprint
        if (dataGroupBundleRetryStorageKey) {
          storeDataGroupBundleRequestId(dataGroupBundleRetryStorageKey, saveRequestId)
        }
      }
      const creationBundle = isDataGroupSource && !campaign?.id
        ? await (async () => {
            updateSaveProgress(7, 'Đang chuẩn bị liên kết Nhóm data...')
            return window.electronAPI.createCampaignCreationBundle({
              requestId: saveRequestId,
              expectedCampaignCount: saveBundleItems.length
            })
          })()
        : null
      updateSaveProgress(8, 'Đang bắt đầu lưu chiến dịch...')
      const savedCampaignIds: number[] = []
      const savedCampaignPayloadById = new Map<number, Partial<Campaign>>()
      const stagedCampaignFinalStatusById = new Map<number, string>()
      const emptySnapshotCampaigns: Array<{ campaignId: number; campaignName: string }> = []
      const campaignWorkProgressByIndex = new Map<number, number>()
      const campaignLinkSyncWeight = 0.1
      let campaignLinkSyncProgress = 0
      const campaignWorkTotalWeight = campaignWorkItemCount + campaignLinkSyncWeight
      const getCampaignWorkPercent = (): number => {
        let completedWeight = campaignLinkSyncProgress * campaignLinkSyncWeight
        campaignWorkProgressByIndex.forEach(ratio => {
          completedWeight += ratio
        })
        return 8 + (87 * (completedWeight / Math.max(campaignLinkSyncWeight, campaignWorkTotalWeight)))
      }
      const updateCampaignWorkProgress = (
        itemIndex: number,
        ratio: number,
        label: string,
        processedRows?: number,
        totalRows?: number
      ): void => {
        const normalizedRatio = Math.max(0, Math.min(1, ratio))
        const currentRatio = campaignWorkProgressByIndex.get(itemIndex) ?? 0
        campaignWorkProgressByIndex.set(itemIndex, Math.max(currentRatio, normalizedRatio))
        updateSaveProgress(
          getCampaignWorkPercent(),
          label,
          processedRows,
          totalRows
        )
      }
      const updateCampaignWorkPhase = (label: string): void => {
        updateSaveProgress(getCampaignWorkPercent(), label)
      }
      const completeCampaignLinkSyncProgress = (label: string): void => {
        campaignLinkSyncProgress = 1
        updateSaveProgress(getCampaignWorkPercent(), label)
      }

      const createCampaignWithInputDataSafely = async (
        campaignPayload: Partial<Campaign>,
        campaignDetails: Partial<CampaignInputData>[],
        dataGroupSnapshots: DirectDataGroupSnapshotIntent[] = [],
        progressRange?: CampaignSaveProgressRange
      ): Promise<Campaign> => {
        const setItemProgress = (
          ratio: number,
          label: string,
          processedRows?: number,
          totalRows?: number
        ): void => {
          if (!progressRange) return
          updateCampaignWorkProgress(
            progressRange.itemIndex,
            ratio,
            label,
            processedRows,
            totalRows
          )
        }
        const campaignNumberLabel = progressRange
          ? `${progressRange.itemIndex + 1}/${progressRange.itemCount}`
          : ''

        const finalStatus = campaignPayload.status ?? 'chờ xử lý'
        const usesAtomicProvisioningBarrier = campaignPayload.dataTargetSourceMode === 'data_group' && !!creationBundle
        setItemProgress(
          0.02,
          campaignNumberLabel
            ? `Đang tạo chiến dịch ${campaignNumberLabel}...`
            : 'Đang tạo chiến dịch liên kết...'
        )
        const savedCampaign = await createCampaign({
          ...campaignPayload,
          status: usesAtomicProvisioningBarrier ? finalStatus : 'tạm dừng'
        }, { refresh: false })
        setItemProgress(
          0.12,
          campaignNumberLabel
            ? `Đã tạo chiến dịch ${campaignNumberLabel}.`
            : 'Đã tạo chiến dịch liên kết.'
        )

        try {
          if (campaignPayload.dataTargetSourceMode === 'direct' && dataGroupSnapshots.length > 0) {
            const campaignSchedule = String(campaignPayload.schedule || savedCampaign.schedule || '').trim()
            if (!campaignSchedule) {
              throw new Error('Không thể xác định lịch chạy để thêm snapshot Nhóm data.')
            }
            let materializedInputCount = 0
            const writeOperationCount = dataGroupSnapshots.length + (campaignDetails.length > 0 ? 1 : 0)
            let writeOperationIndex = 0
            for (let snapshotIndex = 0; snapshotIndex < dataGroupSnapshots.length; snapshotIndex += 1) {
              const snapshot = dataGroupSnapshots[snapshotIndex]
              const operationStart = 0.16 + (0.68 * (writeOperationIndex / writeOperationCount))
              const operationEnd = 0.16 + (0.68 * ((writeOperationIndex + 1) / writeOperationCount))
              setItemProgress(
                operationStart,
                `Đang lấy data từ Nhóm data ${snapshotIndex + 1}/${dataGroupSnapshots.length}...`
              )
              const snapshotResult = await window.electronAPI.snapshotDataGroupToCampaign({
                requestId: `${saveRequestId}:${savedCampaign.id}:snapshot:${snapshot.groupId}`,
                campaignId: savedCampaign.id,
                groupId: snapshot.groupId,
                campaignSchedule,
                campaignStatus: 'tạm dừng'
              })
              materializedInputCount += snapshotResult.insertedCount + snapshotResult.alreadySeenCount
              writeOperationIndex += 1
              setItemProgress(
                operationEnd,
                `Đã lấy ${(
                  snapshotResult.insertedCount + snapshotResult.alreadySeenCount
                ).toLocaleString('vi-VN')} data từ Nhóm data.`
              )
            }

            if (campaignDetails.length > 0) {
              const operationStart = 0.16 + (0.68 * (writeOperationIndex / writeOperationCount))
              const operationEnd = 0.16 + (0.68 * ((writeOperationIndex + 1) / writeOperationCount))
              const appendResult = await runCampaignInputDataWriteWithProgress(
                progressRequestId => window.electronAPI.addCampaignInputDataRows({
                  campaignId: savedCampaign.id,
                  rows: campaignDetails,
                  campaignSchedule,
                  campaignStatus: 'tạm dừng',
                  skipExistingInCampaign: true
                }, progressRequestId),
                progress => {
                  const ratio = progress.totalCount > 0
                    ? progress.processedCount / progress.totalCount
                    : 1
                  setItemProgress(
                    operationStart + ((operationEnd - operationStart) * ratio),
                    'Đang lưu data bổ sung...',
                    progress.processedCount,
                    progress.totalCount
                  )
                }
              )
              materializedInputCount += appendResult.insertedCount
              setItemProgress(
                operationEnd,
                'Đã lưu data bổ sung.',
                appendResult.insertedCount,
                appendResult.insertedCount
              )
            }

            if (materializedInputCount === 0) {
              const emptySnapshotNote = 'Các Nhóm data đã chọn không có data phù hợp với hành động và tài khoản của chiến dịch.'
              await updateCampaign(savedCampaign.id, {
                note: emptySnapshotNote
              }, { refresh: false })
              emptySnapshotCampaigns.push({
                campaignId: savedCampaign.id,
                campaignName: savedCampaign.accountName
                  ? `${savedCampaign.name} (${savedCampaign.accountName})`
                  : savedCampaign.name
              })
              setItemProgress(1, 'Chiến dịch được giữ tạm dừng vì chưa có data phù hợp.')
              return savedCampaign
            }
          } else if (campaignDetails.length > 0) {
            const rowsToCreate = campaignDetails.map(detail => ({
              ...detail,
              id: undefined,
              campaignId: savedCampaign.id
            }))
            await runCampaignInputDataWriteWithProgress(
              progressRequestId => createCampaignInputDataBatch(rowsToCreate, progressRequestId),
              progress => {
                const ratio = progress.totalCount > 0
                  ? progress.processedCount / progress.totalCount
                  : 1
                setItemProgress(
                  0.16 + (0.68 * ratio),
                  'Đang lưu data chiến dịch...',
                  progress.processedCount,
                  progress.totalCount
                )
              }
            )
            setItemProgress(
              0.86,
              'Đã lưu xong data chiến dịch.',
              rowsToCreate.length,
              rowsToCreate.length
            )
          }

          if (campaignPayload.dataTargetSourceMode === 'data_group' && campaignPayload.dataGroupId) {
            setItemProgress(0.52, 'Đang liên kết chiến dịch với Nhóm data...')
            await window.electronAPI.bindCampaignDataGroupSource({
              requestId: `${saveRequestId}:${savedCampaign.id}`,
              campaignId: savedCampaign.id,
              groupId: campaignPayload.dataGroupId,
              bundleId: creationBundle?.id ?? null
            })
            setItemProgress(0.9, 'Đã liên kết chiến dịch với Nhóm data.')
          }

          if (!usesAtomicProvisioningBarrier) {
            stagedCampaignFinalStatusById.set(savedCampaign.id, finalStatus)
          }
          setItemProgress(
            1,
            campaignNumberLabel
              ? `Đã lưu chiến dịch ${campaignNumberLabel}.`
              : 'Đã lưu chiến dịch liên kết.'
          )
          return savedCampaign
        } catch (err) {
          try {
            await updateCampaign(savedCampaign.id, {
              note: formatCampaignDataCreationErrorNote(err)
            }, { refresh: false })
          } catch (noteErr) {
            console.error('Failed to mark campaign data creation error:', noteErr)
          }

          throw err
        }
      }

      const resumeStagedCampaigns = async () => {
        const stagedCampaigns: Array<{ campaignId: number; finalStatus: string }> = []
        stagedCampaignFinalStatusById.forEach((finalStatus, campaignId) => {
          stagedCampaigns.push({ campaignId, finalStatus })
        })

        for (let index = 0; index < stagedCampaigns.length; index += 1) {
          const stagedCampaign = stagedCampaigns[index]
          updateSaveProgress(
            96 + (3 * (index / Math.max(1, stagedCampaigns.length))),
            `Đang kích hoạt chiến dịch ${index + 1}/${stagedCampaigns.length}...`
          )
          if (stagedCampaign.finalStatus !== 'tạm dừng') {
            await updateCampaign(stagedCampaign.campaignId, { status: stagedCampaign.finalStatus }, { refresh: false })
          }
        }
        updateSaveProgress(99, 'Đã kích hoạt các chiến dịch.')
      }

      const persistDraftCampaign = async (
        draft: InternalCampaignDraft,
        linkTargetIds: number[] = [],
        linkTargetField?: FindDataTargetCampaignField | null
      ): Promise<number[]> => {
        const createdIds: number[] = []
        const progressStartIndex = linkedDraftProgressStartIndexByTempId.get(draft.tempId)

        for (let draftItemIndex = 0; draftItemIndex < draft.items.length; draftItemIndex += 1) {
          const draftItem = draft.items[draftItemIndex]
          const payloadExtraSettings = {
            ...(draftItem.campaignPayload.extraSettings || {})
          } as CampaignExtraSettings
          if (linkTargetField && linkTargetIds.length > 0) {
            payloadExtraSettings[linkTargetField] = Array.from(new Set([
              ...getCampaignIdList(payloadExtraSettings[linkTargetField]),
              ...linkTargetIds
            ]))
          }

          const savedDraftCampaign = await createCampaignWithInputDataSafely({
            ...draftItem.campaignPayload,
            extraSettings: payloadExtraSettings
          }, draftItem.details, draftItem.dataGroupSnapshots, progressStartIndex === undefined
            ? undefined
            : {
                itemIndex: progressStartIndex + draftItemIndex,
                itemCount: Math.max(1, campaignWorkItemCount)
              })
          createdIds.push(savedDraftCampaign.id)
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
          }, { refresh: false })
          savedCampaignPayloadById.set(savedCampaignId, {
            ...savedPayload,
            extraSettings: {
              ...baseExtraSettings,
              [field]: nextTargetIds
            } as CampaignExtraSettings
          })
        }
      }

      const mainCampaignCount = Math.max(1, saveBundleItems.length)
      for (let i = 0; i < saveBundleItems.length; i++) {
        const { campaignPayload, details: currentDetails, dataGroupSnapshots: currentDataGroupSnapshots } = saveBundleItems[i]
        const progressRange: CampaignSaveProgressRange = {
          itemIndex: i,
          itemCount: Math.max(1, campaignWorkItemCount)
        }
        const setMainItemProgress = (
          ratio: number,
          label: string,
          processedRows?: number,
          totalRows?: number
        ): void => {
          updateCampaignWorkProgress(
            progressRange.itemIndex,
            ratio,
            label,
            processedRows,
            totalRows
          )
        }
        const effectiveCampaignPayload: Partial<Campaign> = creationBundle
          ? {
              ...campaignPayload,
              creationBundleId: creationBundle.id,
              creationBundleChildIndex: i
            }
          : campaignPayload
        const isFirst = (i === 0)

        let savedCampaign: Pick<Campaign, 'id'>

        if (campaign && campaign.id && isFirst) {
          setMainItemProgress(0.04, `Đang cập nhật chiến dịch ${i + 1}/${mainCampaignCount}...`)
          const changesDataGroup = effectiveCampaignPayload.dataTargetSourceMode === 'data_group' &&
            Number(effectiveCampaignPayload.dataGroupId || 0) > 0 &&
            effectiveCampaignPayload.dataGroupId !== campaign.dataGroupId
          if (changesDataGroup && effectiveCampaignPayload.dataGroupId) {
            const preflight = await window.electronAPI.preflightCampaignDataGroupChange(
              campaign.id,
              effectiveCampaignPayload.dataGroupId
            )
            if (!preflight.allowed) {
              const reason = preflight.reason === 'canonical_inputs_exist'
                ? `Chiến dịch đã có ${preflight.canonicalCount} canonical input nên không thể đổi Nhóm data.`
                : preflight.reason === 'campaign_creation_bundle_immutable'
                  ? 'Chiến dịch thuộc bundle đã tạo nên không thể đổi Nhóm data.'
                  : preflight.reason === 'campaign_action_incompatible'
                    ? 'Loại chiến dịch này không tương thích với Nhóm data.'
                    : preflight.reason === 'campaign_not_bindable'
                      ? 'Chỉ có thể đổi Nhóm data khi chiến dịch chưa chạy và chưa hết hạn.'
                      : 'Không thể đổi sang Nhóm data đã chọn.'
              throw new Error(reason)
            }
          }
          const updatePayload = changesDataGroup
            ? {
                ...effectiveCampaignPayload,
                dataTargetSourceMode: undefined,
                dataGroupId: undefined
              }
            : effectiveCampaignPayload
          await updateCampaign(campaign.id, updatePayload, { refresh: false })
          setMainItemProgress(0.35, `Đã cập nhật chiến dịch ${i + 1}/${mainCampaignCount}.`)
          if (changesDataGroup && effectiveCampaignPayload.dataGroupId) {
            setMainItemProgress(0.45, 'Đang liên kết chiến dịch với Nhóm data...')
            await window.electronAPI.bindCampaignDataGroupSource({
              requestId: `${saveRequestId}:${campaign.id}`,
              campaignId: campaign.id,
              groupId: effectiveCampaignPayload.dataGroupId,
              bundleId: null
            })
            setMainItemProgress(0.8, 'Đã liên kết chiến dịch với Nhóm data.')
          }
          savedCampaign = campaign

          if (!isEditingSavedCampaign) {
            const newDetails: Partial<CampaignInputData>[] = []
            for (let detailIndex = 0; detailIndex < currentDetails.length; detailIndex += 1) {
              const d = currentDetails[detailIndex]
              if (d.id) {
	                await updateCampaignInputData(d.id, {
	                  name: d.name,
	                  phone: d.phone,
	                  phoneCarrier: inferInputDataPhoneCarrier(d.phone, d.phoneCarrier),
	                  uid: d.uid,
	                  email: d.email,
	                  note: d.note,
                })
              } else {
                newDetails.push({
                  ...d,
                  campaignId: savedCampaign.id
                })
              }
              if ((detailIndex + 1) % 100 === 0 || detailIndex === currentDetails.length - 1) {
                setMainItemProgress(
                  0.4 + (0.25 * ((detailIndex + 1) / Math.max(1, currentDetails.length))),
                  'Đang cập nhật data chiến dịch...',
                  detailIndex + 1,
                  currentDetails.length
                )
              }
            }
            if (newDetails.length > 0) {
              await runCampaignInputDataWriteWithProgress(
                progressRequestId => createCampaignInputDataBatch(newDetails, progressRequestId),
                progress => {
                  const ratio = progress.totalCount > 0
                    ? progress.processedCount / progress.totalCount
                    : 1
                  setMainItemProgress(
                    0.65 + (0.25 * ratio),
                    'Đang lưu data mới...',
                    progress.processedCount,
                    progress.totalCount
                  )
                }
              )
            }
          }
          setMainItemProgress(1, `Đã lưu chiến dịch ${i + 1}/${mainCampaignCount}.`)
        } else {
          savedCampaign = await createCampaignWithInputDataSafely(
            effectiveCampaignPayload,
            currentDetails,
            currentDataGroupSnapshots,
            progressRange
          )
        }

        savedCampaignIds.push(savedCampaign.id)
        savedCampaignPayloadById.set(savedCampaign.id, effectiveCampaignPayload)
      }

      updateCampaignWorkPhase('Đang lưu các chiến dịch liên kết...')
      const persistAndPatchFindDataTargetDrafts = async (
        field: FindDataTargetCampaignField,
        rawIds: number[],
        enabled: boolean
      ) => {
        if (!isFindDataCampaign || !enabled) return
        const tempIds = Array.from(new Set(rawIds.filter(id => id < 0)))
        const createdIds = (await Promise.all(tempIds.map(tempId => persistDraftByTempId(tempId)))).flat()
        await patchSavedSourceCampaignTargets(field, createdIds)
      }

      if (isFindDataCampaign) {
        await persistAndPatchFindDataTargetDrafts('findUidTargetCampaignIds', formData.findUidTargetCampaignIds, formData.isFindUid && handleFoundUidData)
        await persistAndPatchFindDataTargetDrafts('findPostLinkTargetCampaignIds', formData.findPostLinkTargetCampaignIds, formData.isFindPostLink && handleFoundPostLinkData)
        await persistAndPatchFindDataTargetDrafts('findPhoneZaloMessagePhoneTargetCampaignIds', formData.findPhoneZaloMessagePhoneTargetCampaignIds, formData.isFindPhone && canUseZaloFeature && handleFoundPhoneZaloMessagePhoneData)
        await persistAndPatchFindDataTargetDrafts('findZaloGroupLinkJoinTargetCampaignIds', formData.findZaloGroupLinkJoinTargetCampaignIds, formData.isFindLinkGroupZalo && canUseZaloFeature && handleFoundZaloGroupLinkJoinData)
        await persistAndPatchFindDataTargetDrafts('findFacebookGroupPostTargetCampaignIds', formData.findFacebookGroupPostTargetCampaignIds, isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupPostData)
        await persistAndPatchFindDataTargetDrafts('findFacebookGroupCommentTargetCampaignIds', formData.findFacebookGroupCommentTargetCampaignIds, isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupCommentData)
        await persistAndPatchFindDataTargetDrafts('findFacebookGroupJoinTargetCampaignIds', formData.findFacebookGroupJoinTargetCampaignIds, isFindDataSearchCampaign && formData.isFindFacebookGroup && handleFoundFacebookGroupJoinData)
      }

      updateCampaignWorkPhase('Đang đồng bộ liên kết chiến dịch...')
      await syncFindDataSourceCampaignLinks(savedCampaignIds)
      completeCampaignLinkSyncProgress('Đã đồng bộ liên kết chiến dịch.')

      if (targetFindDataField) {
        updateCampaignWorkPhase('Đang tạo chiến dịch nguồn liên kết...')
        const tempSourceDraftIds = selectedFindDataSourceCampaignIds.filter(id => id < 0)
        for (const tempId of tempSourceDraftIds) {
          await persistDraftByTempId(tempId, savedCampaignIds, targetFindDataField)
        }
      }

      await resumeStagedCampaigns()
      await loadCampaigns({ silent: true })
      dataGroupBundleRequestIdRef.current = null
      dataGroupBundleFingerprintRef.current = null
      clearStoredDataGroupBundleRequestId(dataGroupBundleRetryStorageKey)
      updateSaveProgress(100, 'Lưu chiến dịch hoàn tất.')

      const emptySnapshotCampaignNames = emptySnapshotCampaigns
        .slice(0, 3)
        .map(item => item.campaignName)
        .join(', ')
      const additionalEmptySnapshotCount = Math.max(0, emptySnapshotCampaigns.length - 3)
      showAlert(
        emptySnapshotCampaigns.length > 0
          ? `Lưu chiến dịch thành công. Giữ tạm dừng ${emptySnapshotCampaigns.length} campaign con chưa có data phù hợp: ${emptySnapshotCampaignNames}${additionalEmptySnapshotCount > 0 ? ` và ${additionalEmptySnapshotCount} campaign khác` : ''}. Các campaign con còn lại vẫn được kích hoạt.`
          : 'Lưu chiến dịch thành công!',
        'success'
      )
      // Delay closing to let user see the toast
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      console.error('Failed to save campaign:', err)
      setSavingCampaign(false)
      setSaveProgress(null)
      showAlert(formatIpcErrorMessage(err, 'Có lỗi xảy ra khi lưu chiến dịch.'), 'error')
    }
  }

  const addDetailRow = () => {
    setDetailsPage(Math.max(1, Math.ceil((details.length + 1) / CAMPAIGN_DETAILS_PAGE_SIZE)))
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

  const appendFindDataSearchKeywords = (values: Array<string | undefined>): number => {
    const keywords = values.map(value => String(value || '').trim()).filter(Boolean)
    if (keywords.length === 0) return 0

    setFindDataSearchKeywordsText(prev => {
      const currentKeywords = parseFindDataSearchKeywordsText(prev)
      return formatFindDataSearchKeywordList([...currentKeywords, ...keywords])
    })
    return keywords.length
  }

  const removeAllDetailRows = () => {
    const count = directDataSourceSelectionCount
    if (count === 0) return

    showConfirm(
      `Xoá toàn bộ data và nhóm đang chờ thêm khỏi danh sách?`,
      () => {
        setDirectDataGroupSnapshots([])
        if (isFindDataSearchCampaign && !isEditingSavedCampaign) {
          setFindDataSearchKeywordsText('')
          return
        }

        const ids = details
          .map(item => item.id)
          .filter((id): id is number => typeof id === 'number')
        setDeletedIds(prev => Array.from(new Set([...prev, ...ids])))
        setDetailsPage(1)
        setDetails([])
      },
      { title: 'Xoá hết data', confirmText: 'Xoá hết', variant: 'danger' }
    )
  }

  const updateDetailRow = (index: number, field: keyof CampaignInputData, value: string) => {
    setDetails(prev => {
      const copy = [...prev]
      const nextRow = { ...copy[index], [field]: value }
      if (field === 'phone') {
        nextRow.phoneCarrier = inferInputDataPhoneCarrier(value)
      }
      copy[index] = nextRow
      return copy
    })
  }

  const [dataScanPicker, setDataScanPicker] = useState<{
    action: DataScanAction
    mode: 'friends' | 'users' | 'groups' | 'pages' | 'pageInboxCustomers' | 'pageInboxPhones' | 'zaloRemarketingCustomers' | 'facebookGroupInviteTarget'
    initialStatusFilter?: 'active' | 'inactive' | 'all'
    allowedActions?: DataScanAction[]
    lockAccount?: boolean
  } | null>(null)
  const [isDataUploadModalOpen, setIsDataUploadModalOpen] = useState(false)

  const dataUploadPlatform: CampaignImportPlatform = selectedActionPlatform === 'zalo'
    ? 'zalo'
    : selectedActionPlatform === 'sms'
      ? 'sms'
    : selectedActionPlatform === 'email'
      ? 'email'
      : 'facebook'

  const getDetailDedupeKeys = (row: Partial<CampaignInputData>): string[] => {
    if (isPhoneOrUidInputCampaign) {
      const uid = String(row.uid || '').trim().replace(/\/+$/g, '').toLowerCase()
      const phone = normalizeVietnamMobilePhone(row.phone)
      return [
        uid ? `uid:${uid}` : '',
        phone ? `phone:${phone}` : ''
      ].filter(Boolean)
    }
    if (isPhoneInputCampaign) {
      const phone = normalizeVietnamMobilePhone(row.phone)
      return phone ? [phone] : []
    }
    if (isEmailCampaign) {
      const email = normalizeEmailAddress(row.email).toLowerCase()
      return email ? [email] : []
    }
    const uid = String(row.uid || '')
      .trim()
      .replace(/\/+$/g, '')
      .toLowerCase()
    return uid ? [uid] : []
  }

  const appendUniqueDetails = (rows: Partial<CampaignInputData>[]): number => {
    const seen = new Set(details.flatMap(getDetailDedupeKeys))
    const uniqueRows: Partial<CampaignInputData>[] = []
    for (const row of rows) {
      const keys = getDetailDedupeKeys(row)
      if (keys.some(key => seen.has(key))) continue
      keys.forEach(key => seen.add(key))
      uniqueRows.push({
        ...row,
        phoneCarrier: inferInputDataPhoneCarrier(row.phone, row.phoneCarrier)
      })
    }
    if (uniqueRows.length > 0) {
      setDetailsPage(Math.max(1, Math.ceil((details.length + uniqueRows.length) / CAMPAIGN_DETAILS_PAGE_SIZE)))
      setDetails(prev => [...prev, ...uniqueRows])
    }
    return uniqueRows.length
  }

  const openPageInboxPhoneSource = () => {
    setIsOtherDataSourceOpen(false)
    if (!canUseFanpageFeature) {
      showAlert('Bạn chưa đăng ký gói Facebook, không thể sử dụng tính năng này', 'error')
      return
    }
    setDataScanPicker({
      action: 'facebook_page_inbox_customers',
      mode: 'pageInboxPhones',
      initialStatusFilter: 'all',
      allowedActions: ['facebook_page_inbox_customers']
    })
  }

  const openDataUploadModal = () => {
    if (formData.accountIds.length === 0) {
      showAlert('Vui lòng chọn ít nhất một tài khoản trước khi upload dữ liệu.', 'error', {
        action: {
          label: 'Đóng',
          onClick: scrollToAccountSelector
        }
      })
      return
    }
    setIsDataUploadModalOpen(true)
  }

  const handleImportedDataRows = (rows: Partial<CampaignInputData>[]) => {
    if (rows.length === 0) {
      showAlert('Không có data hợp lệ để chèn.', 'error')
      return
    }

    if (isFindDataSearchCampaign) {
      const addedCount = appendFindDataSearchKeywords(rows.map(row => row.uid))
      showAlert(
        addedCount > 0 ? `Đã thêm ${addedCount} từ khóa.` : 'Không có từ khóa hợp lệ để chèn.',
        addedCount > 0 ? 'success' : 'error'
      )
      return
    }

    const addedCount = appendUniqueDetails(rows)
    showAlert(
      addedCount > 0 ? `Đã thêm ${addedCount} data.` : 'Các data đã có trong danh sách.',
      addedCount > 0 ? 'success' : 'error'
    )
  }

  const appendDataGroupSnapshot = (
    groupId: number,
    groupName: string,
    dataTypeCategoryItemId?: number | null
  ) => {
    const normalizedGroupId = Number(groupId)
    if (!Number.isSafeInteger(normalizedGroupId) || normalizedGroupId <= 0) {
      showAlert('Nhóm data không hợp lệ.', 'error')
      return
    }

    const alreadySelected = directDataGroupSnapshots.some(item => item.groupId === normalizedGroupId)
    if (!alreadySelected) {
      setDirectDataGroupSnapshots(previous => [
        ...previous,
        {
          groupId: normalizedGroupId,
          groupName: String(groupName || '').trim() || `Nhóm ${normalizedGroupId}`,
          dataTypeCategoryItemId: getPositiveInteger(dataTypeCategoryItemId)
        }
      ])
      setFormData(previous => previous.splitDataAcrossAccounts
        ? { ...previous, splitDataAcrossAccounts: false }
        : previous)
    }
    setDataGroupPickerOpen(false)
    showAlert(
      alreadySelected
        ? `Nhóm "${groupName}" đã có trong danh sách chờ thêm.`
        : `Đã chọn nhóm "${groupName}". Data phù hợp sẽ được DB thêm khi lưu chiến dịch.`,
      'info'
    )
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

  const onZaloRemarketingCustomersSelected = (contacts: AutoAccountContact[]) => {
    const userContacts = contacts.filter(c => c.contactType === 'person')
    const newRows: Partial<CampaignInputData>[] = userContacts.map(c => ({
      name: c.name,
      uid: c.uid || c.url || '',
      phone: String(c.extraData?.phone || '').trim(),
      email: '',
      info1: '',
      info2: '',
      info3: '',
      info4: '',
      info5: '',
      note: '',
      status: 'chờ xử lý'
    }))
    if (newRows.length === 0) {
      showAlert('Không có khách hàng cũ Zalo hợp lệ để thêm vào chiến dịch.', 'error')
      return
    }
    const addedCount = appendUniqueDetails(newRows)
    if (addedCount === 0) {
      showAlert('Các khách hàng cũ Zalo đã chọn đã có trong danh sách.', 'error')
      return
    }
    showAlert(`Đã thêm ${addedCount} khách hàng cũ Zalo.`, 'success')
  }

  const onGroupsSelected = (contacts: AutoAccountContact[]) => {
    const newRows: Partial<CampaignInputData>[] = contacts.map(c => ({
      name: c.name,
      uid: isZaloMessageGroupCampaign
        ? (c.uid || c.url || '')
        : (c.url || (c.uid ? `https://www.facebook.com/groups/${c.uid}` : '')),
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

  const onFacebookGroupInviteTargetSelected = (contacts: AutoAccountContact[]) => {
    const group = contacts.find(c => c.contactType === 'group' && c.isJoined === true)
    if (!group) {
      showAlert('Vui lòng chọn group Facebook đã tham gia.', 'error')
      return
    }
    const groupUrl = getFacebookGroupInviteContactUrl(group)
    if (!groupUrl) {
      showAlert('Group đã chọn chưa có link hợp lệ.', 'error')
      return
    }
    const groupUid = String(group.uid || '').trim()
    const groupName = getFacebookGroupInviteDropdownLabel(group, groupUrl)
    setFormData(prev => ({
      ...prev,
      facebookGroupInviteTargetGroupUid: groupUid,
      facebookGroupInviteTargetGroupUrl: groupUrl,
      facebookGroupInviteTargetGroupName: groupName
    }))
    setFacebookGroupInviteGroups(prev => {
      const knownUrls = new Set(prev.map(getFacebookGroupInviteContactUrl).filter(Boolean))
      return knownUrls.has(groupUrl) ? prev : [group, ...prev]
    })
    setFacebookGroupInviteGroupSearch('')
    setIsFacebookGroupInviteGroupDropdownOpen(false)
    showAlert('Đã chọn group nhận lời mời.', 'success')
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

  const onPageInboxPhonesSelected = (contacts: AutoAccountContact[]) => {
    const newRows: Partial<CampaignInputData>[] = []
    for (const contact of contacts) {
      if (contact.contactType !== 'page_inbox_customer') continue
      const phone = normalizeVietnamMobilePhone(contact.extraData?.phone)
      if (!phone) continue
      newRows.push({
        name: contact.name,
        uid: '',
        phone,
        email: '',
        note: '',
        status: 'chờ xử lý'
      })
    }

    if (newRows.length === 0) {
      showAlert('Không có khách inbox Page có SĐT hợp lệ để thêm vào chiến dịch.', 'error')
      return
    }
    const addedCount = appendUniqueDetails(newRows)
    if (addedCount === 0) {
      showAlert('Các SĐT đã chọn đã có trong danh sách.', 'error')
      return
    }
    showAlert(`Đã thêm ${addedCount} data từ khách inbox Page.`, 'success')
  }

  const syncFindDataSourceCampaignLinks = async (targetCampaignIds: number[]) => {
    if (!showFindDataSourceSection || !targetFindDataField || targetCampaignIds.length === 0) return
    if (!window.electronAPI?.updateCampaign) throw new Error('API not available')

    const targetIds = getCampaignIdList(targetCampaignIds)
    if (targetIds.length === 0) return

    const selectedSourceIds = new Set(selectedFindDataSourceCampaignIds)
    for (const sourceSummary of allFindDataSourceCampaignOptions) {
      const shouldReceiveTarget = selectedSourceIds.has(sourceSummary.id)
      const summaryTargetIds = getCampaignIdList(sourceSummary.relationSettings[targetFindDataField])
      const summaryRequiresUpdate = targetIds.some(targetId =>
        shouldReceiveTarget ? !summaryTargetIds.includes(targetId) : summaryTargetIds.includes(targetId)
      )
      if (!summaryRequiresUpdate) continue

      const sourceCampaign = await window.electronAPI.getCampaignConfig(sourceSummary.id)
      if (!sourceCampaign) {
        throw new Error(`Không thể tải cấu hình chiến dịch nguồn #${sourceSummary.id}.`)
      }

      const nextTargetIds = new Set(getCampaignIdList(sourceCampaign.extraSettings?.[targetFindDataField]))
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

  const usesSingleCommentMediaSelection = (target: MainMediaPickerTarget): boolean => {
    if (target === 'comment') return formData.commentImageOption === 'all'
    if (target === 'post') return isReelsMediaMode && formData.imageOption === 'all'
    const mediaOption = formData.advancedContentItems.find(item => item.id === target.itemId)?.mediaOption
    if (isCommentSeedingCampaign) return mediaOption === 'all'
    return isReelsMediaMode && mediaOption === 'all'
  }

  const addCampaignMedia = (target: MainMediaPickerTarget, items: CampaignMediaSnapshot[]) => {
    if (items.length === 0) return
    const isAdvancedTarget = typeof target === 'object'
    const isCommentTarget = target === 'comment'
    const acceptedItems = filterCampaignMediaBySelectionMode(items, getMediaSelectionMode(target))
    if (acceptedItems.length === 0) return
    setFormData(p => {
      if (isCommentTarget) {
        if (p.commentImageOption === 'all') {
          return { ...p, commentImages: acceptedItems.slice(0, 1) }
        }
        const nextItems = getUniqueCampaignMediaAdditions(p.commentImages, acceptedItems)
        return { ...p, commentImages: [...p.commentImages, ...nextItems] }
      }
      if (!isAdvancedTarget && isReelsMediaMode && p.imageOption === 'all') {
        return { ...p, images: acceptedItems.slice(0, 1) }
      }
      if (isAdvancedTarget) {
        return {
          ...p,
          advancedContentItems: p.advancedContentItems.map(item => {
            if (item.id !== target.itemId) return item
            const current = item.mediaItems || []
            const nextItems = getUniqueCampaignMediaAdditions(current, acceptedItems)
            const mergedItems = [...current, ...nextItems]
            const nextMediaItems = (isCommentSeedingCampaign || isReelsMediaMode) && item.mediaOption === 'all'
              ? acceptedItems.slice(0, 1)
              : mergedItems
            return {
              ...item,
              mediaOption: item.mediaOption === 'none' ? 'all' : item.mediaOption,
              mediaItems: nextMediaItems,
              randomMediaCount: isCommentSeedingCampaign ? 1 : item.randomMediaCount
            }
          })
        }
      }
      const nextItems = getUniqueCampaignMediaAdditions(p.images, acceptedItems)
      return { ...p, images: [...p.images, ...nextItems] }
    })
  }

  const handleMediaPickerConfirm = (items: CampaignMediaSnapshot[]) => {
    if (!mediaPickerTarget) return
    addCampaignMedia(mediaPickerTarget, items)
  }

  const openLocalMediaPicker = (target: MainMediaPickerTarget) => {
    if (usesZaloServerAccount) {
      showAlert('Tài khoản Zalo Server chỉ có thể dùng media đã upload lên cloud.', 'info')
      return
    }
    localMediaPickerTargetRef.current = target
    const mode = getMediaSelectionMode(target)
    const input = mode === 'file'
      ? localFileInputRef.current
      : mode === 'video'
        ? localVideoInputRef.current
        : mode === 'image-video'
          ? localImageVideoInputRef.current
          : localImageInputRef.current
    if (!input) return
    input.multiple = !usesSingleCommentMediaSelection(target)
    input.click()
  }

  const handleLocalMediaChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(event.target.files || [])
    event.target.value = ''
    const target = localMediaPickerTargetRef.current
    localMediaPickerTargetRef.current = null
    if (!target || rawFiles.length === 0) return

    const mode = getMediaSelectionMode(target)
    const maxSelect = usesSingleCommentMediaSelection(target) ? 1 : undefined
    const { snapshots, failures } = selectLocalCampaignMedia(rawFiles, { mode, maxSelect })
    if (failures.length > 0) {
      showAlert(
        summarizeLocalCampaignMediaFailures(failures),
        snapshots.length > 0 ? 'info' : 'error'
      )
    }
    addCampaignMedia(target, snapshots)
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
            <div className="content-preview-field-header">
              <label>Nội dung comment</label>
              {renderContentPreviewButton('newsfeedCommentContent', !formData.enableComment)}
            </div>
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

  const getInsertedText = (
    currentValue: string,
    token: string,
    element: HTMLInputElement | HTMLTextAreaElement | null
  ) => {
    const start = element?.selectionStart ?? currentValue.length
    const end = element?.selectionEnd ?? start
    const safeStart = Math.max(0, Math.min(start, currentValue.length))
    const safeEnd = Math.max(safeStart, Math.min(end, currentValue.length))
    const insertedValue =
      currentValue.slice(0, safeStart) +
      token +
      currentValue.slice(safeEnd)
    const nextValue = insertedValue
    const nextCursor = Math.min(safeStart + token.length, nextValue.length)

    return { nextValue, nextCursor }
  }

  const insertCampaignContentToken = (
    token: string,
    target: MessagePersonalizationTarget = 'content',
    preferredAdvancedItemId?: string
  ) => {
    if (target === 'content' && isAdvancedContentMode && !isRichContentEditorEnabled) {
      const item = preferredAdvancedItemId
        ? formData.advancedContentItems.find(candidate => candidate.id === preferredAdvancedItemId)
        : null
      const textarea = preferredAdvancedItemId
        ? advancedContentTextareaRefs.current[preferredAdvancedItemId]
        : null
      if (!item || !preferredAdvancedItemId) {
        showAlert('Vui lòng chọn nội dung nâng cao cần chèn thông tin.', 'info')
        return
      }

      const { nextValue, nextCursor } = getInsertedText(item.content, token, textarea)
      setFormData(current => {
        const advancedContentItems = current.advancedContentItems.map(candidate => (
          candidate.id === preferredAdvancedItemId
            ? { ...candidate, content: nextValue }
            : candidate
        ))
        manualAdvancedContentItemsRef.current = advancedContentItems
        return { ...current, advancedContentItems }
      })
      window.requestAnimationFrame(() => {
        textarea?.focus()
        textarea?.setSelectionRange(nextCursor, nextCursor)
      })
      return
    }

    if (target === 'content' && isRichContentEditorEnabled) {
      if (isAdvancedContentMode) {
        const editor = preferredAdvancedItemId
          ? advancedContentEditorRefs.current[preferredAdvancedItemId]
          : activeRichContentEditorRef.current?.itemId
            ? advancedContentEditorRefs.current[activeRichContentEditorRef.current.itemId]
            : null
        if (editor) {
          editor.chain().focus().insertContent(token).run()
          return
        }
        showAlert('Vui lòng chọn nội dung nâng cao cần chèn thông tin.', 'info')
        return
      }
      if (emailHtmlEditorRef.current) {
        emailHtmlEditorRef.current.chain().focus().insertContent(token).run()
        return
      }
    }

    if (target === 'friendRequestMessage') {
      const textarea = friendRequestMessageTextareaRef.current
      const { nextValue, nextCursor } = getInsertedText(formData.friendRequestMessage, token, textarea)

      setFormData(p => ({ ...p, friendRequestMessage: nextValue }))
      window.requestAnimationFrame(() => {
        textarea?.focus()
        textarea?.setSelectionRange(nextCursor, nextCursor)
      })
      return
    }

    if (target === 'zaloAliasTemplate') {
      const input = zaloAliasTemplateInputRef.current
      const { nextValue, nextCursor } = getInsertedText(formData.zaloAliasTemplate, token, input)

      setFormData(p => ({ ...p, zaloAliasTemplate: nextValue }))
      window.requestAnimationFrame(() => {
        input?.focus()
        input?.setSelectionRange(nextCursor, nextCursor)
      })
      return
    }

    if (target === 'internalSmsContent') {
      const textarea = internalSmsContentTextareaRef.current
      const { nextValue, nextCursor } = getInsertedText(formData.internalSmsContent, token, textarea)

      setFormData(p => ({ ...p, internalSmsContent: nextValue }))
      window.requestAnimationFrame(() => {
        textarea?.focus()
        textarea?.setSelectionRange(nextCursor, nextCursor)
      })
      return
    }

    if (target === 'externalSmsContent') {
      const textarea = externalSmsContentTextareaRef.current
      const { nextValue, nextCursor } = getInsertedText(formData.externalSmsContent, token, textarea)

      setFormData(p => ({ ...p, externalSmsContent: nextValue }))
      window.requestAnimationFrame(() => {
        textarea?.focus()
        textarea?.setSelectionRange(nextCursor, nextCursor)
      })
      return
    }

    const textarea = campaignContentTextareaRef.current
    const { nextValue, nextCursor } = getInsertedText(formData.content, token, textarea)

    setFormData(p => ({ ...p, content: nextValue }))
    window.requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function renderMessagePersonalizationDropdown(
    target: MessagePersonalizationTarget = 'content',
    placement: 'toolbar' | 'field' | 'action' = 'toolbar',
    advancedItemId?: string
  ) {
    const dateOptions = MESSAGE_DATE_OPTIONS
    const dateTokenName = MESSAGE_DATE_OPTIONS.find(opt => opt.value === messageDateOption)?.token || 'TODAY'
    const dateToken = `#{${dateTokenName}(${messageDateFormat})}`
    const selectedDateLabel = dateOptions.find(opt => opt.value === messageDateOption)?.label || dateOptions[0]?.label || ''
    const excelTokens = isMobileManagedSmsCampaign
      ? ['INPUT_FULLNAME', 'PHONE', 'INFO1', 'INFO2', 'INFO3', 'INFO4', 'INFO5']
      : ['INPUT_FULLNAME', 'PHONE', 'EMAIL', 'INFO1', 'INFO2', 'INFO3', 'INFO4', 'INFO5']
    const showCustomerTokens = isMobileManagedSmsCampaign ? false : (target === 'content' ? !isEmailCampaign : true)
    const showExcelTokens = target === 'content'
      ? isPhoneInputCampaign || isEmailCampaign
      : target === 'internalSmsContent'
        ? usesInternalSmsPush
      : target === 'externalSmsContent'
        ? supportsExternalSmsPush
        : isZaloMessagePhoneCampaign
    const showZaloProfileTokens = isZaloMessagePhoneCampaign || isZaloMessageFriendCampaign || isZaloMessageBirthdayCampaign || isZaloMessageGroupMemberCampaign || isZaloMessageGroupRealtimeCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign
    const showDateTokens = !isSmsCampaign
    const renderExcelTokens = () => (
      <div className="message-template-token-row">
        {excelTokens.map(token => (
          <button
            key={token}
            type="button"
            className="message-template-token"
            onClick={() => insertCampaignContentToken(`#{${token}}`, target, advancedItemId)}
          >
            {`#{${token}}`}
          </button>
        ))}
      </div>
    )

    const sectionCount = (showCustomerTokens ? 1 : 0) + (showExcelTokens ? 1 : 0) + (showDateTokens ? 1 : 0)
    const sectionLayoutClass = sectionCount >= 3
      ? 'three-token-sections'
      : sectionCount === 1
        ? 'single-token-section'
        : 'two-token-sections'
    const tokenAvailabilityClass = showExcelTokens ? 'has-excel-tokens' : 'no-excel-tokens'
    const placementClass =
      placement === 'field'
        ? 'field-token-dropdown'
        : placement === 'action'
          ? 'action-token-dropdown'
          : ''
    const dropdownClassName = [
      'message-personalization-dropdown',
      sectionLayoutClass,
      tokenAvailabilityClass,
      placementClass
    ].filter(Boolean).join(' ')
    const popoverClassName = [
      'message-personalization-popover',
      sectionLayoutClass,
      tokenAvailabilityClass
    ].join(' ')

    return (
      <div className={dropdownClassName}>
        <button
          type="button"
          className="btn btn-ghost content-template-inline-button message-personalization-button"
          aria-haspopup="dialog"
        >
          <Braces size={15} />
          <span>Cá nhân hoá</span>
        </button>
        <div
          className={popoverClassName}
          aria-label="Chèn thông tin cá nhân hoá"
          onMouseLeave={() => setMessageTemplateDropdownOpen(null)}
        >
          <div className="message-template-title">Chèn thông tin</div>

          {showCustomerTokens && (
            <div className="message-template-section">
              <div className="message-template-section-title">
                <Users size={16} />
                <span>Khách hàng</span>
              </div>
              <label>Tên hiển thị{showZaloProfileTokens ? ' Zalo' : ''}</label>
              <button
                type="button"
                className="message-template-token"
                onClick={() => insertCampaignContentToken(MESSAGE_FULL_NAME_TOKEN, target, advancedItemId)}
              >
                {MESSAGE_FULL_NAME_TOKEN}
              </button>
              {showZaloProfileTokens && (
                <>
                  <label>Tên gốc Zalo</label>
                  <button
                    type="button"
                    className="message-template-token"
                    onClick={() => insertCampaignContentToken('#{ORIGINAL_NAME}', target, advancedItemId)}
                  >
                    {'#{ORIGINAL_NAME}'}
                  </button>
                  <label>Giới tính</label>
                  <button
                    type="button"
                    className="message-template-token"
                    onClick={() => insertCampaignContentToken('#{SEX{anh-chị-anh/chị}}', target, advancedItemId)}
                  >
                    {'#{SEX{anh-chị-anh/chị}}'}
                  </button>
                </>
              )}
            </div>
          )}

          {showExcelTokens && (
            <div className="message-template-section">
              <div className="message-template-section-title">
                <FileText size={16} />
                <span>Thông tin Excel</span>
              </div>
              {renderExcelTokens()}
            </div>
          )}

          {showDateTokens && (
            <div className="message-template-section">
              <div className="message-template-section-title">
                <Calendar size={16} />
                <span>Chọn thời gian</span>
              </div>
              <div className="message-template-control-row">
                <div className="message-template-control">
                  <label>Chọn ngày:</label>
                  <div className={`message-template-dropdown ${messageTemplateDropdownOpen === 'date' ? 'open' : ''}`}>
                    <button
                      type="button"
                      className="message-template-dropdown-button"
                      aria-expanded={messageTemplateDropdownOpen === 'date'}
                      onClick={() => setMessageTemplateDropdownOpen(current => current === 'date' ? null : 'date')}
                    >
                      <span>{selectedDateLabel}</span>
                      <ChevronDown size={14} />
                    </button>
                    <div className="message-template-dropdown-list">
                      {dateOptions.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`message-template-dropdown-item ${messageDateOption === opt.value ? 'active' : ''}`}
                          onClick={() => {
                            setMessageDateOption(opt.value)
                            setMessageTemplateDropdownOpen(null)
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="message-template-control">
                  <label>Chọn định dạng:</label>
                  <div className={`message-template-dropdown ${messageTemplateDropdownOpen === 'format' ? 'open' : ''}`}>
                    <button
                      type="button"
                      className="message-template-dropdown-button"
                      aria-expanded={messageTemplateDropdownOpen === 'format'}
                      onClick={() => setMessageTemplateDropdownOpen(current => current === 'format' ? null : 'format')}
                    >
                      <span>{messageDateFormat}</span>
                      <ChevronDown size={14} />
                    </button>
                    <div className="message-template-dropdown-list">
                      {MESSAGE_DATE_FORMATS.map(format => (
                        <button
                          key={format}
                          type="button"
                          className={`message-template-dropdown-item ${messageDateFormat === format ? 'active' : ''}`}
                          onClick={() => {
                            setMessageDateFormat(format)
                            setMessageTemplateDropdownOpen(null)
                          }}
                        >
                          {format}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <label>Chèn định dạng ngày</label>
              <button
                type="button"
                className="message-template-token"
                onClick={() => insertCampaignContentToken(dateToken, target, advancedItemId)}
              >
                {dateToken}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderImagePicker = (target: 'post' | 'comment', title: string) => {
    const isComment = target === 'comment'
    const isZaloMedia = isZaloMessageCampaign && !isComment
    const isEmailAttachment = isEmailCampaign && !isComment
    const isFileMedia = isZaloMedia || isEmailAttachment
    const mediaSelectionMode = getMediaSelectionMode(target)
    const isFacebookImageVideoMedia = mediaSelectionMode === 'image-video'
    const isVideoOnlyMedia = mediaSelectionMode === 'video'
    const option = isComment ? formData.commentImageOption : formData.imageOption
    const randomCount = isComment ? 1 : formData.randomImageCount
    const images = isComment ? formData.commentImages : formData.images
    const radioName = isComment ? 'commentImageOption' : 'imageOption'

    const setOption = (value: ImageOption) => {
      if (isComment && value === 'all' && images.length > 1) {
        showAlert('Chế độ "Gửi media đã chọn" chỉ dùng tối đa 1 ảnh hoặc video cho mỗi comment. Vui lòng xoá bớt còn 1 media hoặc tiếp tục dùng chế độ ngẫu nhiên.', 'info')
        return
      }
      if (!isComment && isReelsMediaMode && value === 'all' && images.length > 1) {
        showAlert('Chế độ "Đăng video đã chọn" chỉ dùng đúng 1 video cho mỗi lượt. Vui lòng xoá bớt còn 1 video hoặc tiếp tục dùng chế độ ngẫu nhiên.', 'info')
        return
      }
      setFormData(p => isComment
        ? ({ ...p, commentImageOption: value })
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
            Mỗi comment gửi tối đa 1 ảnh hoặc video. Chế độ gửi media đã chọn dùng 1 media; chế độ ngẫu nhiên chọn 1 media từ kho.
          </div>
        )}
        {!isComment && isPostBackgroundActive && (
          <div className="schedule-hint" style={{ marginTop: -8, marginBottom: 16 }}>
            Đăng bài với phông nền không hỗ trợ gửi media.
          </div>
        )}

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setMediaPickerTarget(target)}
                style={{ width: 'fit-content', opacity: option === 'none' ? 0.6 : 1 }}
                disabled={option === 'none'}
              >
                <Image size={14} />
                <span>Chọn từ Media</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openLocalMediaPicker(target)}
                style={{ width: 'fit-content', opacity: option === 'none' ? 0.6 : 1 }}
                disabled={option === 'none' || usesZaloServerAccount}
                title={usesZaloServerAccount ? 'Zalo Server chỉ dùng được media đã upload lên cloud' : 'Chọn file trực tiếp từ máy'}
              >
                <FolderOpen size={14} />
                <span>Chọn từ máy tính</span>
              </button>
            </div>

            <div className="schedule-radio-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={option === 'none'}
                  onChange={() => setOption('none')}
                />
                <span>{isEmailAttachment ? 'Không đính kèm file' : isZaloMedia ? 'Không gửi file' : isVideoOnlyMedia ? 'Không đăng video' : isFacebookImageVideoMedia ? 'Không gửi ảnh/video' : 'Không gửi ảnh'}</span>
              </label>
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={option === 'all'}
                  onChange={() => setOption('all')}
                />
                <span>{isComment ? 'Gửi media đã chọn' : isEmailAttachment ? 'Đính kèm file đã chọn' : isZaloMedia ? 'Gửi file đã chọn' : isVideoOnlyMedia ? 'Đăng video đã chọn' : isFacebookImageVideoMedia ? 'Gửi ảnh/video đã chọn' : 'Gửi ảnh đã chọn'}</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label className="schedule-radio-label">
                  <input
                    type="radio"
                    name={radioName}
                    checked={option === 'random'}
                    onChange={() => setOption('random')}
                  />
                  <span>{isComment ? 'Gửi ngẫu nhiên 1 ảnh/video trong các media đã chọn' : isFileMedia ? 'Gửi ngẫu nhiên số file trong file đã chọn' : isVideoOnlyMedia ? 'Đăng ngẫu nhiên 1 video trong các video đã chọn' : isFacebookImageVideoMedia ? 'Gửi ngẫu nhiên số media trong các media đã chọn' : 'Gửi ngẫu nhiên số ảnh trong ảnh đã chọn'}</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={isComment || isVideoOnlyMedia ? 1 : undefined}
                  value={isVideoOnlyMedia ? 1 : randomCount}
                  onChange={e => setRandomCount(Number(e.target.value))}
                  className="stepper-input"
                  style={{ width: 60, padding: '4px 8px' }}
                  disabled={isComment || isVideoOnlyMedia || option !== 'random'}
                />
              </div>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {isComment ? 'Kho ảnh/video đã chọn' : isEmailAttachment ? 'Tệp đính kèm đã chọn' : isZaloMedia ? 'File đã chọn' : isVideoOnlyMedia ? 'Video đã chọn' : isFacebookImageVideoMedia ? 'Ảnh/video đã chọn' : 'Ảnh đã chọn'}
            </div>
            <div className="stepper-grid-container" style={{ margin: 0, maxHeight: 300, overflowY: 'auto' }}>
              <table className="campaign-grid">
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 50, textAlign: 'center' }}>STT</th>
                    <th style={{ width: 44, textAlign: 'center' }}></th>
                    <th>Link</th>
                    <th style={{ width: 40, textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {images.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center text-muted" style={{ padding: '24px 0' }}>
                        {isFileMedia ? 'Chưa có file nào được chọn' : isVideoOnlyMedia ? 'Chưa có video nào được chọn' : isFacebookImageVideoMedia ? 'Chưa có ảnh/video nào được chọn' : 'Chưa có ảnh nào được chọn'}
                      </td>
                    </tr>
                  ) : (
                    images.map((img, idx) => {
                      const localPath = getCampaignMediaLocalPath(img)
                      const cloudUrl = getCampaignMediaCloudUrl(img)
                      const usingCloudFallback = isCampaignMediaUsingCloudFallback(img)
                      const mediaTitle = [localPath, cloudUrl].filter(Boolean).join('\n') || getCampaignMediaDisplayName(img)
                      return (
                        <tr key={`${target}-${idx}-${getCampaignMediaStableKey(img)}`}>
                          <td className="text-center">{idx + 1}</td>
                          <td className="text-center">
                            <MediaPreviewHover
                              name={getCampaignMediaDisplayName(img)}
                              path={getCampaignMediaPreviewPath(img)}
                              mimeType={getCampaignMediaMimeType(img)}
                              sizeBytes={getCampaignMediaSizeBytes(img)}
                            />
                          </td>
                          <td className="text-truncate" style={{ maxWidth: 200 }} title={mediaTitle}>
                            {getCampaignMediaDisplayName(img)}
                            {usingCloudFallback && (
                              <span className="media-inline-source">cloud</span>
                            )}
                          </td>
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
                      )
                    })
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
            disabled={isEditingSavedCampaign || isDataGroupSource}
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

  const renderZaloTagSelector = ({
    label,
    value,
    onChange,
    emptyHint = 'Bấm “Tải tag” để lấy tag từ Zalo và lưu vào danh sách.'
  }: {
    label: string
    value: number | string | null | undefined
    onChange: (id: string, name: string) => void
    emptyHint?: string
  }) => (
    <div className="stepper-form-group" style={{ maxWidth: 360 }}>
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          className="stepper-input"
          value={String(value || '')}
          disabled={zaloLabelsLoading || zaloLabelsSyncing || formData.accountIds.length === 0}
          onChange={e => {
            const item = zaloLabels.find(labelItem => String(labelItem.id) === e.target.value)
            onChange(e.target.value, item?.text || '')
          }}
        >
          <option value="">{zaloLabelsLoading ? 'Đang tải tag đã lưu...' : '-- Chọn tag --'}</option>
          {zaloLabels.map(labelItem => (
            <option key={labelItem.id} value={labelItem.id}>{labelItem.text}</option>
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
        <div className="schedule-hint">{emptyHint}</div>
      )}
    </div>
  )

  const renderZaloTagMultiSelector = ({
    label,
    values,
    onChange,
    emptyHint = 'Bấm “Tải tag” để lấy tag từ Zalo.'
  }: {
    label: string
    values: string[]
    onChange: (ids: string[], names: string[]) => void
    emptyHint?: string
  }) => {
    const selected = new Set(values.map(id => String(id || '').trim()).filter(Boolean))
    const disabled = zaloLabelsLoading || zaloLabelsSyncing || formData.accountIds.length === 0
    const updateSelection = (id: string, checked: boolean) => {
      const next = new Set(selected)
      if (checked) next.add(id)
      else next.delete(id)
      const ids = zaloLabels
        .map(item => String(item.id))
        .filter(itemId => next.has(itemId))
      const names = ids.map(idValue => zaloLabels.find(item => String(item.id) === idValue)?.text || '')
      onChange(ids, names)
    }

    return (
      <div className="stepper-form-group" style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <label style={{ marginBottom: 0 }}>{label}</label>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            disabled={disabled}
            onClick={handleSyncZaloLabels}
          >
            {zaloLabelsSyncing ? <Loader2 size={14} /> : <RefreshCw size={14} />}
            {zaloLabelsSyncing ? 'Đang tải' : 'Tải tag'}
          </button>
        </div>
        {zaloLabelsError && <div className="schedule-hint" style={{ color: 'var(--text-error)' }}>{zaloLabelsError}</div>}
        {!zaloLabelsLoading && !zaloLabelsError && zaloLabels.length === 0 && (
          <div className="schedule-hint">{emptyHint}</div>
        )}
        {zaloLabels.length > 0 && (
          <div
            style={{
              display: 'grid',
              gap: 8,
              marginTop: 8,
              padding: 10,
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              maxHeight: 180,
              overflowY: 'auto'
            }}
          >
            {zaloLabels.map(labelItem => {
              const id = String(labelItem.id)
              return (
                <label key={id} className="schedule-checkbox-label">
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    disabled={disabled}
                    onChange={e => updateSelection(id, e.target.checked)}
                  />
                  <span>{labelItem.text}</span>
                </label>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const renderAkaBizContactTagOption = () => {
    if (!supportsAkaBizContactTags) return null

    const selected = new Set(getCampaignIdList(formData.akaBizTagIds))
    const updateSelection = (id: number, checked: boolean) => {
      const next = new Set(selected)
      if (checked) next.add(id)
      else next.delete(id)
      const ids = akaBizContactTags
        .map(tag => tag.id)
        .filter(tagId => next.has(tagId))
      const names = ids.map(tagId => akaBizContactTags.find(tag => tag.id === tagId)?.name || '')
      setFormData(p => ({ ...p, akaBizTagIds: ids, akaBizTagNames: names }))
    }

    return (
      <>
        <div className="stepper-form-group">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.enableAkaBizTag}
              onChange={e => setFormData(p => ({
                ...p,
                enableAkaBizTag: e.target.checked,
                akaBizTagIds: e.target.checked ? p.akaBizTagIds : [],
                akaBizTagNames: e.target.checked ? p.akaBizTagNames : []
              }))}
            />
            <span>Kiêm gắn tag akaBiz</span>
          </label>
        </div>

        {formData.enableAkaBizTag && (
          <div className="stepper-form-group" style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <label style={{ marginBottom: 0 }}>Tag akaBiz</label>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                onClick={() => onOpenGeneralSettings?.('akabizTags')}
                disabled={!onOpenGeneralSettings}
                title={onOpenGeneralSettings ? 'Quản lý tag akaBiz' : 'Không thể mở quản lý tag akaBiz trong form này'}
              >
                <Settings2 size={14} />
                <span>Quản lý</span>
              </button>
            </div>

            {akaBizContactTagsLoading ? (
              <div className="schedule-hint">Đang tải tag akaBiz...</div>
            ) : akaBizContactTags.length === 0 ? (
              <div className="schedule-hint">Chưa có tag akaBiz.</div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  marginTop: 8,
                  padding: 10,
                  border: '1px solid var(--border-default)',
                  borderRadius: 6,
                  maxHeight: 180,
                  overflowY: 'auto'
                }}
              >
                {akaBizContactTags.map(tag => (
                  <label key={tag.id} className="schedule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={selected.has(tag.id)}
                      disabled={akaBizContactTagsLoading}
                      onChange={e => updateSelection(tag.id, e.target.checked)}
                    />
                    <span>{tag.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </>
    )
  }

  const renderExternalSmsPushOption = () => {
    if (!supportsExternalSmsPush) return null

    if (usesInternalSmsPush) {
      const selectedAccountIds = new Set(getCampaignIdList(formData.internalSmsAccountIds))
      const selectedStatuses = new Set(formData.internalSmsStatuses.map(status => String(status || '').trim().toLocaleLowerCase('vi-VN')).filter(Boolean))
      const updateAccountSelection = (id: number, checked: boolean) => {
        const next = new Set(selectedAccountIds)
        if (checked) next.add(id)
        else next.delete(id)
        const ids = internalSmsAccounts
          .map(account => account.id)
          .filter(accountId => next.has(accountId))
        setFormData(p => ({ ...p, internalSmsAccountIds: ids }))
      }
      const updateStatusSelection = (status: string, checked: boolean) => {
        const next = new Set(selectedStatuses)
        if (checked) next.add(status)
        else next.delete(status)
        const statuses = EXTERNAL_SMS_STATUS_OPTIONS
          .map(option => option.value)
          .filter(optionStatus => next.has(optionStatus))
        setFormData(p => ({ ...p, internalSmsStatuses: statuses }))
      }

      return (
        <div className="external-sms-section-body">
          <div className="external-sms-section-note">
            <strong>Khách hàng cần có tài khoản Sms để sử dụng tính năng này</strong>
          </div>

          <div className="stepper-form-group">
            <label className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={formData.internalSmsEnabled}
                onChange={e => setFormData(p => ({
                  ...p,
                  internalSmsEnabled: e.target.checked,
                  internalSmsAccountIds: e.target.checked ? p.internalSmsAccountIds : [],
                  internalSmsContent: e.target.checked ? p.internalSmsContent : '',
                  internalSmsStatuses: e.target.checked ? p.internalSmsStatuses : []
                }))}
              />
              <span>Gửi tin nhắn Sms</span>
            </label>
          </div>

          {formData.internalSmsEnabled && (
            <div className="external-sms-section-fields">
              <div className="stepper-form-group">
                <label>Chọn tài khoản Sms</label>
                {internalSmsAccounts.length === 0 ? (
                  <div className="schedule-hint">Chưa có tài khoản Sms phù hợp.</div>
                ) : (
                  <div className="external-sms-option-list">
                    {internalSmsAccounts.map(account => (
                      <label key={account.id} className="schedule-checkbox-label">
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.has(account.id)}
                          onChange={e => updateAccountSelection(account.id, e.target.checked)}
                        />
                        <span>{account.name || account.username || `Sms #${account.id}`}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="stepper-form-group">
                <div className="message-personalization-field-header">
                  <div className="message-personalization-field-title">
                    <label>Nội dung</label>
                    {renderMessagePersonalizationDropdown('internalSmsContent', 'field')}
                  </div>
                </div>
                <textarea
                  ref={internalSmsContentTextareaRef}
                  className="stepper-textarea"
                  rows={6}
                  value={formData.internalSmsContent}
                  onChange={e => setFormData(p => ({ ...p, internalSmsContent: e.target.value }))}
                />
              </div>

              <div className="stepper-form-group">
                <label>Gửi tin nhắn Sms khi trạng thái Zalo chứa 1 trong các điều kiện</label>
                <div className="external-sms-option-list compact">
                  {EXTERNAL_SMS_STATUS_OPTIONS.map(option => (
                    <label key={option.value} className="schedule-checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedStatuses.has(option.value)}
                        onChange={e => updateStatusSelection(option.value, e.target.checked)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )
    }

    const selectedShopIds = new Set(getCampaignIdList(formData.externalSmsShopIds))
    const selectedStatuses = new Set(formData.externalSmsStatuses.map(status => String(status || '').trim().toLocaleLowerCase('vi-VN')).filter(Boolean))
    const updateShopSelection = (id: number, checked: boolean) => {
      const next = new Set(selectedShopIds)
      if (checked) next.add(id)
      else next.delete(id)
      const ids = externalSmsShops
        .map(shop => shop.id)
        .filter(shopId => next.has(shopId))
      setFormData(p => ({ ...p, externalSmsShopIds: ids }))
    }
    const updateStatusSelection = (status: string, checked: boolean) => {
      const next = new Set(selectedStatuses)
      if (checked) next.add(status)
      else next.delete(status)
      const statuses = EXTERNAL_SMS_STATUS_OPTIONS
        .map(option => option.value)
        .filter(optionStatus => next.has(optionStatus))
      setFormData(p => ({ ...p, externalSmsStatuses: statuses }))
    }

    return (
      <div className="external-sms-section-body">
        <div className="external-sms-section-note">
          <strong>Khách hàng cần có tài khoản của akaBiz Sms để sử dụng tính năng này</strong>
          {!hasSmsIntegration && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onOpenGeneralSettings?.('akabiz')}
              disabled={!onOpenGeneralSettings}
            >
              <Settings2 size={14} />
              <span>Tích hợp</span>
            </button>
          )}
        </div>

        <div className="stepper-form-group">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.externalSmsEnabled}
              onChange={e => setFormData(p => ({
                ...p,
                externalSmsEnabled: e.target.checked,
                externalSmsShopIds: e.target.checked ? p.externalSmsShopIds : [],
                externalSmsContent: e.target.checked ? p.externalSmsContent : '',
                externalSmsStatuses: e.target.checked ? p.externalSmsStatuses : []
              }))}
            />
            <span>Gửi tin nhắn Sms</span>
          </label>
        </div>

        {formData.externalSmsEnabled && (
          <div className="external-sms-section-fields">
            {!hasSmsIntegration && (
              <div className="schedule-hint" style={{ color: 'var(--text-error)' }}>Chưa tích hợp akaBiz Sms.</div>
            )}

            <div className="stepper-form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <label style={{ marginBottom: 0 }}>Chọn tài khoản Sms</label>
                {hasSmsIntegration && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                    disabled={externalSmsShopsLoading}
                    onClick={() => void loadExternalSmsShops()}
                  >
                    {externalSmsShopsLoading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
                    <span>{externalSmsShopsLoading ? 'Đang tải' : 'Tải lại'}</span>
                  </button>
                )}
              </div>
              {externalSmsShopsLoading ? (
                <div className="schedule-hint">Đang tải tài khoản akaBiz Sms...</div>
              ) : !hasSmsIntegration ? (
                <div className="schedule-hint">Bấm Tích hợp để kết nối tài khoản akaBiz Sms.</div>
              ) : externalSmsShops.length === 0 ? (
                <div className="schedule-hint">Chưa có tài khoản akaBiz Sms phù hợp.</div>
              ) : (
                <div
                  className="external-sms-option-list"
                >
                  {externalSmsShops.map(shop => (
                    <label key={shop.id} className="schedule-checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedShopIds.has(shop.id)}
                        disabled={externalSmsShopsLoading}
                        onChange={e => updateShopSelection(shop.id, e.target.checked)}
                      />
                      <span>{shop.name || `Sms #${shop.id}`}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="stepper-form-group">
              <div className="message-personalization-field-header">
                <div className="message-personalization-field-title">
                  <label>Nội dung</label>
                  {renderMessagePersonalizationDropdown('externalSmsContent', 'field')}
                </div>
              </div>
              <textarea
                ref={externalSmsContentTextareaRef}
                className="stepper-textarea"
                rows={6}
                value={formData.externalSmsContent}
                onChange={e => setFormData(p => ({ ...p, externalSmsContent: e.target.value }))}
              />
            </div>

            <div className="stepper-form-group">
              <label>Gửi tin nhắn Sms khi trạng thái Zalo chứa 1 trong các điều kiện</label>
              <div className="external-sms-option-list compact">
                {EXTERNAL_SMS_STATUS_OPTIONS.map(option => (
                  <label key={option.value} className="schedule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.has(option.value)}
                      onChange={e => updateStatusSelection(option.value, e.target.checked)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderZaloRealtimeGroupSettings = () => {
    const selectedTriggers = new Set(formData.zaloRealtimeTriggers)
    const selectedGroupIds = new Set(getZaloRealtimeGroupIdsForSave())
    const groupNameById = getZaloRealtimeGroupNameMap()
    const loadedGroupIds = new Set(
      zaloRealtimeGroups
        .map(group => normalizeZaloRealtimeGroupId(group.uid || group.url))
        .filter(Boolean)
    )
    const missingLoadedSelectionIds = Array.from(selectedGroupIds).filter(id => !loadedGroupIds.has(id))
    const toggleTrigger = (trigger: ZaloRealtimeTrigger, checked: boolean) => {
      setFormData(p => {
        const next = new Set(p.zaloRealtimeTriggers)
        if (checked) next.add(trigger)
        else next.delete(trigger)
        return { ...p, zaloRealtimeTriggers: Array.from(next) }
      })
    }
    const toggleGroup = (group: AutoAccountContact, checked: boolean) => {
      const groupId = normalizeZaloRealtimeGroupId(group.uid || group.url)
      if (!groupId) return
      setFormData(p => {
        const existingNameById = new Map<string, string>()
        p.zaloRealtimeGroupIds.forEach((id, index) => {
          const normalizedId = normalizeZaloRealtimeGroupId(id)
          if (normalizedId) existingNameById.set(normalizedId, String(p.zaloRealtimeGroupNames[index] || '').trim())
        })
        existingNameById.set(groupId, group.name || existingNameById.get(groupId) || '')

        const next = new Set(p.zaloRealtimeGroupIds.map(normalizeZaloRealtimeGroupId).filter(Boolean))
        if (checked) next.add(groupId)
        else next.delete(groupId)
        const ids = Array.from(next)
        return {
          ...p,
          zaloRealtimeGroupIds: ids,
          zaloRealtimeGroupNames: ids.map(id => existingNameById.get(id) || groupNameById.get(id) || '')
        }
      })
    }

    return (
      <>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Nhận data theo thời gian thực</div>
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {ZALO_REALTIME_TRIGGER_OPTIONS.map(option => (
            <label key={option.value} className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={selectedTriggers.has(option.value)}
                onChange={e => toggleTrigger(option.value, e.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {getZaloRealtimeTriggersForSave().length === 0 && (
          <div style={{ color: 'var(--text-error)', fontSize: 12, marginTop: -8, marginBottom: 12 }}>
            Vui lòng chọn ít nhất một loại data theo thời gian thực cần nhận.
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

        <div className="stepper-form-row" style={{ alignItems: 'flex-end' }}>
          <div className="stepper-form-group" style={{ minWidth: 360, flex: '1 1 360px' }}>
            <label>Chọn group</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={zaloRealtimeGroupsLoading || formData.accountIds.length !== 1}
                onClick={() => void loadZaloRealtimeGroupsFromLocal()}
              >
                {zaloRealtimeGroupsLoading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
                <span>Load</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={zaloRealtimeGroupsLoading || formData.accountIds.length !== 1}
                onClick={() => void syncZaloRealtimeGroupsFromZalo()}
              >
                {zaloRealtimeGroupsLoading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
                <span>Tải group từ Zalo</span>
              </button>
            </div>
            {formData.accountIds.length !== 1 && (
              <div className="schedule-hint">Vui lòng chọn 1 tài khoản Zalo để load group.</div>
            )}
          </div>

          <div className="stepper-form-group" style={{ maxWidth: 280, flex: '0 0 280px' }}>
            <label>Ngày kết thúc không nhận data nữa</label>
            <input
              type="date"
              value={formData.zaloRealtimeEndDate}
              onChange={e => setFormData(p => ({ ...p, zaloRealtimeEndDate: e.target.value }))}
              className="stepper-input"
            />
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gap: 8,
            marginTop: 8,
            padding: 10,
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            maxHeight: 220,
            overflowY: 'auto'
          }}
        >
          {zaloRealtimeGroupsLoading ? (
            <div className="text-muted" style={{ fontSize: 13 }}>Đang load group Zalo...</div>
          ) : zaloRealtimeGroups.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 13 }}>Chưa có group Zalo đã lưu.</div>
          ) : (
            zaloRealtimeGroups.map(group => {
              const groupId = normalizeZaloRealtimeGroupId(group.uid || group.url)
              if (!groupId) return null
              return (
                <label key={group.id || groupId} className="schedule-checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.has(groupId)}
                    onChange={e => toggleGroup(group, e.target.checked)}
                  />
                  <span>{group.name || groupId}</span>
                </label>
              )
            })
          )}
        </div>

        {missingLoadedSelectionIds.length > 0 && (
          <div className="schedule-hint" style={{ marginTop: 8 }}>
            Đang giữ {missingLoadedSelectionIds.length} group đã chọn trước đó: {missingLoadedSelectionIds.map(id => groupNameById.get(id) || id).join(', ')}
          </div>
        )}
        {selectedGroupIds.size === 0 && (
          <div style={{ color: 'var(--text-error)', fontSize: 12, marginTop: 8 }}>Vui lòng chọn ít nhất một group Zalo.</div>
        )}

        <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)', marginTop: 16 }}>
          Mỗi ngày chiến dịch sẽ lấy danh sách những người mới tham gia/rời/tương tác (nhắn tin, like, tim,...) trong group và sẽ gửi vào ngày hôm sau theo thời gian cài đặt
        </div>
      </>
    )
  }

  const renderFacebookGroupInviteSettings = () => {
    const selectedGroupUrl = normalizeFacebookGroupInviteGroupUrl(
      formData.facebookGroupInviteTargetGroupUrl || formData.facebookGroupInviteTargetGroupUid
    )
    const groupOptions = facebookGroupInviteGroups.flatMap(group => {
      const groupUrl = getFacebookGroupInviteContactUrl(group)
      if (!groupUrl) return []
      const label = getFacebookGroupInviteDropdownLabel(group, groupUrl)
      return [{
        url: groupUrl,
        group,
        label,
        searchText: `${label} ${group.uid || ''} ${groupUrl}`.toLowerCase()
      }]
    })
    const loadedGroupUrls = new Set(groupOptions.map(option => option.url))
    const missingSelectedGroup = Boolean(selectedGroupUrl && !loadedGroupUrls.has(selectedGroupUrl))
    const selectedGroupOption = groupOptions.find(option => option.url === selectedGroupUrl)
    const selectedGroupLabel = selectedGroupOption?.label || formData.facebookGroupInviteTargetGroupName || selectedGroupUrl
    const normalizedGroupSearch = facebookGroupInviteGroupSearch.trim().toLowerCase()
    const filteredGroupOptions = normalizedGroupSearch
      ? groupOptions.filter(option => option.searchText.includes(normalizedGroupSearch))
      : groupOptions
    const dropdownInputValue = isFacebookGroupInviteGroupDropdownOpen
      ? facebookGroupInviteGroupSearch
      : selectedGroupLabel
    const selectGroup = (group: AutoAccountContact) => {
      const groupUrl = getFacebookGroupInviteContactUrl(group)
      if (!groupUrl) return
      const groupUid = String(group.uid || '').trim()
      setFormData(p => ({
        ...p,
        facebookGroupInviteTargetGroupUid: groupUid,
        facebookGroupInviteTargetGroupUrl: groupUrl,
        facebookGroupInviteTargetGroupName: getFacebookGroupInviteDropdownLabel(group, groupUrl)
      }))
      setFacebookGroupInviteGroupSearch('')
      setIsFacebookGroupInviteGroupDropdownOpen(false)
    }

    return (
      <>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Group nhận lời mời</div>
        <div className="stepper-form-row" style={{ alignItems: 'flex-end' }}>
          <div className="stepper-form-group" style={{ minWidth: 360, flex: '1 1 520px' }}>
            <label>Chọn group đích</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div className="zalo-group-combobox" ref={facebookGroupInviteGroupDropdownRef}>
                <div className="zalo-group-combobox-input-wrap">
                  <Search size={14} className="zalo-group-combobox-search-icon" />
                  <input
                    type="text"
                    className="stepper-input zalo-group-combobox-input"
                    value={dropdownInputValue}
                    placeholder="Chọn hoặc tìm group Facebook"
                    disabled={facebookGroupInviteGroupsLoading || formData.accountIds.length !== 1}
                    onFocus={() => {
                      setFacebookGroupInviteGroupSearch('')
                      setIsFacebookGroupInviteGroupDropdownOpen(true)
                    }}
                    onChange={e => {
                      setFacebookGroupInviteGroupSearch(e.target.value)
                      setIsFacebookGroupInviteGroupDropdownOpen(true)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        setFacebookGroupInviteGroupSearch('')
                        setIsFacebookGroupInviteGroupDropdownOpen(false)
                      }
                      if (e.key === 'Enter' && isFacebookGroupInviteGroupDropdownOpen && filteredGroupOptions.length > 0) {
                        e.preventDefault()
                        selectGroup(filteredGroupOptions[0].group)
                      }
                      if (e.key === 'ArrowDown') {
                        setIsFacebookGroupInviteGroupDropdownOpen(true)
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-icon zalo-group-combobox-toggle"
                    disabled={facebookGroupInviteGroupsLoading || formData.accountIds.length !== 1}
                    title="Mở danh sách group"
                    aria-label="Mở danh sách group"
                    aria-expanded={isFacebookGroupInviteGroupDropdownOpen}
                    onClick={() => {
                      const nextOpen = !isFacebookGroupInviteGroupDropdownOpen
                      setFacebookGroupInviteGroupSearch('')
                      setIsFacebookGroupInviteGroupDropdownOpen(nextOpen)
                    }}
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>

                {isFacebookGroupInviteGroupDropdownOpen && (
                  <div className="zalo-group-combobox-menu">
                    {facebookGroupInviteGroupsLoading ? (
                      <div className="zalo-group-combobox-empty">Đang load group Facebook...</div>
                    ) : groupOptions.length === 0 ? (
                      <div className="zalo-group-combobox-empty">Chưa có group Facebook đã tham gia.</div>
                    ) : filteredGroupOptions.length === 0 ? (
                      <div className="zalo-group-combobox-empty">Không tìm thấy group phù hợp.</div>
                    ) : (
                      filteredGroupOptions.map(option => {
                        const isSelected = selectedGroupUrl === option.url
                        return (
                          <button
                            key={option.group.id || option.url}
                            type="button"
                            className={`zalo-group-combobox-option${isSelected ? ' is-selected' : ''}`}
                            onClick={() => selectGroup(option.group)}
                            title={option.label}
                          >
                            <span className="zalo-group-combobox-option-label">{option.label}</span>
                            {isSelected && <Check size={14} />}
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={facebookGroupInviteGroupsLoading || formData.accountIds.length !== 1}
                onClick={() => void loadFacebookGroupInviteGroupsFromLocal()}
              >
                {facebookGroupInviteGroupsLoading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
                <span>Load</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={formData.accountIds.length !== 1}
                onClick={() => {
                  if (formData.accountIds.length !== 1) {
                    showAlert('Vui lòng chọn đúng 1 tài khoản Facebook trước.', 'error')
                    return
                  }
                  setDataScanPicker({
                    action: 'facebook_groups',
                    mode: 'facebookGroupInviteTarget',
                    initialStatusFilter: 'active',
                    allowedActions: ['facebook_groups'],
                    lockAccount: true
                  })
                }}
              >
                <RefreshCw size={14} />
                <span>Tải group từ Facebook</span>
              </button>
            </div>
            {formData.accountIds.length !== 1 && (
              <div className="schedule-hint">Vui lòng chọn 1 tài khoản Facebook để load group.</div>
            )}
          </div>
        </div>

        {missingSelectedGroup && (
          <div className="schedule-hint" style={{ marginTop: 8 }}>
            Đang giữ group đã chọn trước đó: {formData.facebookGroupInviteTargetGroupName || selectedGroupUrl}
          </div>
        )}
        {!selectedGroupUrl && (
          <div style={{ color: 'var(--text-error)', fontSize: 12, marginTop: 8 }}>Vui lòng chọn group nhận lời mời.</div>
        )}
      </>
    )
  }

  const renderZaloAddGroupMemberSettings = () => {
    const selectedGroupId = normalizeZaloRealtimeGroupId(formData.zaloAddGroupMemberTargetGroupId)
    const groupOptions = zaloRealtimeGroups.flatMap(group => {
      const groupId = normalizeZaloRealtimeGroupId(group.uid || group.url)
      if (!groupId) return []
      const label = getZaloGroupDropdownLabel(group, groupId)
      return [{
        id: groupId,
        group,
        label,
        searchText: `${label} ${groupId}`.toLowerCase()
      }]
    })
    const loadedGroupIds = new Set(groupOptions.map(option => option.id))
    const missingSelectedGroup = selectedGroupId && !loadedGroupIds.has(selectedGroupId)
    const selectedGroupOption = groupOptions.find(option => option.id === selectedGroupId)
    const selectedGroupLabel = selectedGroupOption?.label || formData.zaloAddGroupMemberTargetGroupName || selectedGroupId
    const normalizedGroupSearch = zaloAddGroupMemberGroupSearch.trim().toLowerCase()
    const filteredGroupOptions = normalizedGroupSearch
      ? groupOptions.filter(option => option.searchText.includes(normalizedGroupSearch))
      : groupOptions
    const dropdownInputValue = isZaloAddGroupMemberGroupDropdownOpen
      ? zaloAddGroupMemberGroupSearch
      : selectedGroupLabel
    const selectGroup = (group: AutoAccountContact) => {
      const groupId = normalizeZaloRealtimeGroupId(group.uid || group.url)
      if (!groupId) return
      setFormData(p => ({
        ...p,
        zaloAddGroupMemberTargetGroupId: groupId,
        zaloAddGroupMemberTargetGroupName: group.name || groupId,
        zaloAddGroupMemberUseShareMethod: getZaloGroupType(group) === null
          ? p.zaloAddGroupMemberUseShareMethod
          : isZaloCommunityGroup(group)
      }))
      setZaloAddGroupMemberGroupSearch('')
      setIsZaloAddGroupMemberGroupDropdownOpen(false)
    }

    return (
      <>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Group thêm thành viên</div>
        <div className="stepper-form-row" style={{ alignItems: 'flex-end' }}>
          <div className="stepper-form-group" style={{ minWidth: 360, flex: '1 1 520px' }}>
            <label>Chọn group đích</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div className="zalo-group-combobox" ref={zaloAddGroupMemberGroupDropdownRef}>
                <div className="zalo-group-combobox-input-wrap">
                  <Search size={14} className="zalo-group-combobox-search-icon" />
                  <input
                    type="text"
                    className="stepper-input zalo-group-combobox-input"
                    value={dropdownInputValue}
                    placeholder="Chọn hoặc tìm group Zalo"
                    disabled={zaloRealtimeGroupsLoading || formData.accountIds.length !== 1}
                    onFocus={() => {
                      setZaloAddGroupMemberGroupSearch('')
                      setIsZaloAddGroupMemberGroupDropdownOpen(true)
                    }}
                    onChange={e => {
                      setZaloAddGroupMemberGroupSearch(e.target.value)
                      setIsZaloAddGroupMemberGroupDropdownOpen(true)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        setZaloAddGroupMemberGroupSearch('')
                        setIsZaloAddGroupMemberGroupDropdownOpen(false)
                      }
                      if (e.key === 'Enter' && isZaloAddGroupMemberGroupDropdownOpen && filteredGroupOptions.length > 0) {
                        e.preventDefault()
                        selectGroup(filteredGroupOptions[0].group)
                      }
                      if (e.key === 'ArrowDown') {
                        setIsZaloAddGroupMemberGroupDropdownOpen(true)
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-icon zalo-group-combobox-toggle"
                    disabled={zaloRealtimeGroupsLoading || formData.accountIds.length !== 1}
                    title="Mở danh sách group"
                    aria-label="Mở danh sách group"
                    aria-expanded={isZaloAddGroupMemberGroupDropdownOpen}
                    onClick={() => {
                      const nextOpen = !isZaloAddGroupMemberGroupDropdownOpen
                      setZaloAddGroupMemberGroupSearch('')
                      setIsZaloAddGroupMemberGroupDropdownOpen(nextOpen)
                    }}
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>

                {isZaloAddGroupMemberGroupDropdownOpen && (
                  <div className="zalo-group-combobox-menu">
                    {zaloRealtimeGroupsLoading ? (
                      <div className="zalo-group-combobox-empty">Đang load group Zalo...</div>
                    ) : groupOptions.length === 0 ? (
                      <div className="zalo-group-combobox-empty">Chưa có group Zalo đã lưu.</div>
                    ) : filteredGroupOptions.length === 0 ? (
                      <div className="zalo-group-combobox-empty">Không tìm thấy group phù hợp.</div>
                    ) : (
                      filteredGroupOptions.map(option => {
                        const isSelected = selectedGroupId === option.id
                        return (
                          <button
                            key={option.group.id || option.id}
                            type="button"
                            className={`zalo-group-combobox-option${isSelected ? ' is-selected' : ''}`}
                            onClick={() => selectGroup(option.group)}
                            title={option.label}
                          >
                            <span className="zalo-group-combobox-option-label">{option.label}</span>
                            {isSelected && <Check size={14} />}
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={zaloRealtimeGroupsLoading || formData.accountIds.length !== 1}
                onClick={() => void loadZaloRealtimeGroupsFromLocal()}
              >
                {zaloRealtimeGroupsLoading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
                <span>Load</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={zaloRealtimeGroupsLoading || formData.accountIds.length !== 1}
                onClick={() => void syncZaloRealtimeGroupsFromZalo()}
              >
                {zaloRealtimeGroupsLoading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
                <span>Tải group từ Zalo</span>
              </button>
            </div>
            {formData.accountIds.length !== 1 && (
              <div className="schedule-hint">Vui lòng chọn 1 tài khoản Zalo để load group.</div>
            )}
          </div>
        </div>

        {missingSelectedGroup && (
          <div className="schedule-hint" style={{ marginTop: 8 }}>
            Đang giữ group đã chọn trước đó: {formData.zaloAddGroupMemberTargetGroupName || selectedGroupId}
          </div>
        )}
        {!selectedGroupId && (
          <div style={{ color: 'var(--text-error)', fontSize: 12, marginTop: 8 }}>Vui lòng chọn group Zalo cần thêm thành viên.</div>
        )}

        <label className="schedule-checkbox-label" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={formData.zaloAddGroupMemberUseShareMethod}
            onChange={e => setFormData(p => ({ ...p, zaloAddGroupMemberUseShareMethod: e.target.checked }))}
          />
          <span>Thêm bằng cách chia sẻ group</span>
        </label>
      </>
    )
  }

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

      {isZaloMessageFriendRecommendationCampaign && (
        <div className="stepper-form-group" style={{ maxWidth: 240, marginTop: 14 }}>
          <label>Số lượng đề xuất</label>
          <input
            type="number"
            min={1}
            value={formData.zaloFriendRecommendationCount}
            onChange={e => setFormData(p => ({
              ...p,
              zaloFriendRecommendationCount: normalizeZaloFriendRecommendationCount(e.target.value)
            }))}
            className="stepper-input"
          />
          {hasZaloFriendRecommendationMaterialized && (
            <div className="schedule-hint" style={{ marginTop: 6 }}>
              Lượt hiện tại đã lấy {zaloFriendRecommendationMaterializedCount} đề xuất. Số mới sẽ áp dụng ở lượt lấy đề xuất tiếp theo.
            </div>
          )}
        </div>
      )}

      {formData.enableAddFriend && (
        <div className="stepper-form-group" style={{ marginTop: 14 }}>
          <div className="message-personalization-field-header">
            <div className="message-personalization-field-title">
              <label>Nội dung kết bạn</label>
              {renderMessagePersonalizationDropdown('friendRequestMessage', 'field')}
              {renderContentPreviewButton('friendRequestMessage')}
            </div>
            <span className="message-personalization-field-count" style={{ color: friendRequestMessageMaxLength > 150 ? 'var(--text-error)' : 'var(--text-muted)' }}>
              {friendRequestMessageMaxLength}/150
            </span>
          </div>
          <textarea
            ref={friendRequestMessageTextareaRef}
            className="stepper-textarea"
            rows={3}
            value={formData.friendRequestMessage}
            onChange={e => setFormData(p => ({ ...p, friendRequestMessage: e.target.value }))}
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
          <span>Kiêm gắn tag Zalo</span>
        </label>
      </div>
      {formData.enableZaloTag && (
        renderZaloTagSelector({
          label: 'Tag Zalo',
          value: formData.zaloTagId,
          onChange: (id, name) => setFormData(p => ({ ...p, zaloTagId: id, zaloTagName: name }))
        })
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
                ? getDefaultZaloAliasTemplate(p.actionId)
                : p.zaloAliasTemplate
            }))}
          />
          <span>Kiêm đổi tên</span>
        </label>
      </div>
      {formData.enableZaloAlias && (
        <div className="stepper-form-group">
          <div className="message-personalization-field-header">
            <div className="message-personalization-field-title">
              <label>Mẫu đổi tên</label>
              {renderMessagePersonalizationDropdown('zaloAliasTemplate', 'field')}
            </div>
          </div>
          <input
            ref={zaloAliasTemplateInputRef}
            type="text"
            className="stepper-input"
            value={formData.zaloAliasTemplate}
            onChange={e => setFormData(p => ({ ...p, zaloAliasTemplate: e.target.value }))}
            placeholder={defaultZaloAliasTemplate}
          />
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

      {renderAkaBizContactTagOption()}
    </>
  )

  const renderZaloCancelSentFriendRequestActionOptions = () => (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Cấu hình huỷ lời mời</div>
      <div className="stepper-form-group" style={{ maxWidth: 260 }}>
        <label>Số lời mời cần huỷ</label>
        <input
          type="number"
          min={1}
          value={formData.zaloCancelFriendRequestLimit}
          onChange={e => setFormData(p => ({
            ...p,
            zaloCancelFriendRequestLimit: normalizeZaloCancelFriendRequestLimit(e.target.value)
          }))}
          className="stepper-input"
        />
        {hasZaloCancelFriendRequestMaterialized && (
          <div className="schedule-hint" style={{ marginTop: 6 }}>
            Lượt hiện tại đã lấy {zaloCancelFriendRequestMaterializedCount} lời mời. Số mới sẽ áp dụng ở lượt lấy snapshot tiếp theo.
          </div>
        )}
      </div>
    </>
  )

  const renderZaloMessageShareModeOption = () => (
    <div className="stepper-form-group">
      <label className="schedule-checkbox-label">
        <input
          type="checkbox"
          checked={formData.zaloMessageSendMode === 'share'}
          onChange={e => {
            const checked = e.target.checked
            const applyMode = () => {
              if (checked && formData.formattedContentEnabled) {
                normalizeManualAdvancedContentItemsToPlain()
              }
              setFormData(current => {
                const compatibleState = checked && current.formattedContentEnabled
                  ? convertFormattedStateToPlain(current)
                  : current
                return {
                  ...compatibleState,
                  zaloMessageSendMode: checked ? 'share' : 'normal',
                  zaloOptOutLinkEnabled: checked ? false : compatibleState.zaloOptOutLinkEnabled,
                  enableZaloTag: checked ? false : compatibleState.enableZaloTag,
                  zaloTagId: checked ? '' : compatibleState.zaloTagId,
                  zaloTagName: checked ? '' : compatibleState.zaloTagName,
                  enableZaloAlias: checked ? false : compatibleState.enableZaloAlias,
                  enableAkaBizTag: checked ? false : compatibleState.enableAkaBizTag,
                  akaBizTagIds: checked ? [] : compatibleState.akaBizTagIds,
                  akaBizTagNames: checked ? [] : compatibleState.akaBizTagNames
                }
              })
            }

            if (checked && (isFormattedContentEnabled || groupSnapshotSaveEffectiveRich)) {
              showConfirm(
                'Gửi dạng chia sẻ không hỗ trợ nội dung có định dạng. Nội dung sẽ được chuyển sang văn bản thường.',
                applyMode,
                { title: 'Chuyển sang nội dung thường', confirmText: 'Chuyển và bật', variant: 'primary' }
              )
              return
            }
            applyMode()
          }}
        />
        <span>Gửi dạng chia sẻ tin nhắn, gửi nhanh cho 50 người mỗi lần (không áp dụng cá nhân hoá nội dung tin nhắn)</span>
      </label>
    </div>
  )

  const renderZaloFriendBlocklistOption = () => (
    <div className="stepper-form-group">
      <label className="schedule-checkbox-label">
        <input
          type="checkbox"
          checked={formData.zaloFriendBlocklistEnabled}
          onChange={e => {
            const checked = e.target.checked
            const fallback = checked
              ? (selectedZaloFriendBlocklist || zaloFriendBlocklists[0] || null)
              : null
            setFormData(p => ({
              ...p,
              zaloFriendBlocklistEnabled: checked,
              zaloFriendBlocklistId: checked ? (fallback?.id ?? p.zaloFriendBlocklistId ?? null) : null,
              zaloFriendBlocklistName: checked ? (fallback?.name || p.zaloFriendBlocklistName || '') : ''
            }))
          }}
        />
        <span>Không gửi tin cho những người trong danh sách</span>
      </label>

      {formData.zaloFriendBlocklistEnabled && (
        <div className="zalo-friend-blocklist-picker">
          <div className="zalo-friend-blocklist-select-wrap">
            <select
              className="zalo-friend-blocklist-select"
              value={formData.zaloFriendBlocklistId || ''}
              onChange={e => {
                const nextId = Number(e.target.value) || null
                const selected = zaloFriendBlocklists.find(group => group.id === nextId) || null
                setFormData(p => ({
                  ...p,
                  zaloFriendBlocklistId: nextId,
                  zaloFriendBlocklistName: selected?.name || ''
                }))
              }}
              disabled={zaloFriendBlocklistsLoading || zaloFriendBlocklists.length === 0}
            >
              <option value="">{zaloFriendBlocklistsLoading ? 'Đang tải danh sách không gửi tin...' : '-- Chọn danh sách không gửi tin --'}</option>
              {zaloFriendBlocklists.map(group => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-secondary zalo-friend-blocklist-manage-btn"
            onClick={() => onOpenGeneralSettings?.('zaloBlocklists')}
            disabled={!onOpenGeneralSettings}
            title={onOpenGeneralSettings ? 'Quản lý danh sách không gửi tin' : 'Không thể mở quản lý danh sách không gửi tin trong form này'}
          >
            <ListChecks size={14} />
            <span>Quản lý</span>
          </button>
        </div>
      )}
    </div>
  )

  const renderZaloMessageFriendActionOptions = () => (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Nguồn bạn bè</div>
      <div className="stepper-form-group">
        <div style={{ display: 'grid', gap: 8 }}>
          {ZALO_FRIEND_TARGET_MODES.map(mode => (
            <label key={mode.value} className="schedule-checkbox-label">
              <input
                type="radio"
                name="zalo-friend-target-mode"
                checked={formData.zaloFriendTargetMode === mode.value}
                disabled={isDataGroupSource}
                onChange={() => setFormData(p => ({
                  ...p,
                  zaloFriendTargetMode: mode.value,
                  zaloFriendSourceTagIds: mode.value === 'tagged_friends' ? p.zaloFriendSourceTagIds : [],
                  zaloFriendSourceTagNames: mode.value === 'tagged_friends' ? p.zaloFriendSourceTagNames : []
                }))}
              />
              <span>{mode.label}</span>
            </label>
          ))}
        </div>
      </div>

      {formData.zaloFriendTargetMode === 'tagged_friends' && renderZaloTagMultiSelector({
        label: 'Tag nguồn',
        values: formData.zaloFriendSourceTagIds,
        onChange: (ids, names) => setFormData(p => ({
          ...p,
          zaloFriendSourceTagIds: ids,
          zaloFriendSourceTagNames: names
        })),
        emptyHint: 'Bấm “Tải tag” để lấy tag từ Zalo.'
      })}

      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

      {renderZaloFriendBlocklistOption()}

      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

      {renderZaloMessageShareModeOption()}

      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

      {renderAkaBizContactTagOption()}

      {!isZaloShareMessageMode && (
        <>
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
              <span>Kiêm gắn tag Zalo</span>
            </label>
          </div>
          {formData.enableZaloTag && renderZaloTagSelector({
            label: 'Tag Zalo',
            value: formData.zaloTagId,
            onChange: (id, name) => setFormData(p => ({ ...p, zaloTagId: id, zaloTagName: name }))
          })}

          <div className="stepper-form-group">
            <label className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={formData.enableZaloAlias}
                onChange={e => setFormData(p => ({
                  ...p,
                  enableZaloAlias: e.target.checked,
                  zaloAliasTemplate: e.target.checked && !p.zaloAliasTemplate.trim()
                    ? getDefaultZaloAliasTemplate(p.actionId)
                    : p.zaloAliasTemplate
                }))}
              />
              <span>Kiêm đổi tên</span>
            </label>
          </div>
          {formData.enableZaloAlias && (
            <div className="stepper-form-group">
              <div className="message-personalization-field-header">
                <div className="message-personalization-field-title">
                  <label>Mẫu đổi tên</label>
                  {renderMessagePersonalizationDropdown('zaloAliasTemplate', 'field')}
                </div>
              </div>
              <input
                ref={zaloAliasTemplateInputRef}
                type="text"
                className="stepper-input"
                value={formData.zaloAliasTemplate}
                onChange={e => setFormData(p => ({ ...p, zaloAliasTemplate: e.target.value }))}
                placeholder={defaultZaloAliasTemplate}
              />
            </div>
          )}
        </>
      )}
    </>
  )

  const renderZaloMessageGroupActionOptions = () => (
    <>
      {renderZaloMessageShareModeOption()}

      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

      {renderAkaBizContactTagOption()}
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

  const renderPostAsReelsOption = () => supportsSourceReels ? (
    <div style={{ marginBottom: 12 }}>
      <label className="schedule-checkbox-label">
        <input
          type="checkbox"
          checked={formData.postAsReels}
          onChange={e => {
            const checked = e.target.checked
            setFormData(p => ({
              ...p,
              postAsReels: checked,
              postWithBackground: checked ? false : p.postWithBackground,
              randomImageCount: checked ? 1 : p.randomImageCount,
              advancedContentItems: checked
                ? p.advancedContentItems.map(item => ({ ...item, randomMediaCount: 1 }))
                : p.advancedContentItems
            }))
          }}
        />
        <span>Đăng Reels <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Đăng video trên Reels)</em></span>
      </label>
    </div>
  ) : null

  const renderSourceContentSettings = () => (
    <div>
      <div className="schedule-hint" style={{ marginBottom: 12 }}>
        Chế độ này chỉ dùng nội dung lấy từ nguồn. Nội dung và media ở các tab Cơ bản, Nâng cao hoặc Nhóm mẫu nội dung sẽ không được sử dụng.
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.includeSourceImages}
            onChange={e => setFormData(p => ({ ...p, includeSourceImages: e.target.checked }))}
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
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.rewriteSourceContentWithAI}
            onChange={e => setFormData(p => ({ ...p, rewriteSourceContentWithAI: e.target.checked }))}
          />
          <span>Lời nhắc AI - Edit lại nội dung</span>
        </label>
      </div>
      {formData.rewriteSourceContentWithAI && (
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
    </div>
  )

  const sanitizeFindDataSourceSelection = normalizeFindDataFlagState

  const handleFindPhoneTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindPhone: checked,
      findPhoneSmsTargetCampaignIds: checked ? p.findPhoneSmsTargetCampaignIds : [],
      findPhoneZaloWebTargetCampaignIds: checked ? p.findPhoneZaloWebTargetCampaignIds : [],
      findPhoneZaloMessagePhoneTargetCampaignIds: checked ? p.findPhoneZaloMessagePhoneTargetCampaignIds : [],
      findPhoneAkaBizDesktopTargetCampaignIds: checked ? p.findPhoneAkaBizDesktopTargetCampaignIds : [],
      findDataTargetDataGroups: checked
        ? p.findDataTargetDataGroups
        : removeFindDataTargetDataGroup(p.findDataTargetDataGroups, 'phone')
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) {
      setHandleFoundPhoneSmsData(false)
      setHandleFoundPhoneZaloWebData(false)
      setHandleFoundPhoneZaloMessagePhoneData(false)
      setHandleFoundPhoneAkaBizDesktopData(false)
      setFindDataTargetDataGroupEnabled(previous => ({ ...previous, phone: false }))
    }
  }

  const handleFindZaloGroupTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindLinkGroupZalo: checked,
      findZaloGroupLinkWebTargetCampaignIds: checked ? p.findZaloGroupLinkWebTargetCampaignIds : [],
      findZaloGroupLinkJoinTargetCampaignIds: checked ? p.findZaloGroupLinkJoinTargetCampaignIds : [],
      findZaloGroupLinkAkaBizDesktopTargetCampaignIds: checked ? p.findZaloGroupLinkAkaBizDesktopTargetCampaignIds : [],
      findDataTargetDataGroups: checked
        ? p.findDataTargetDataGroups
        : removeFindDataTargetDataGroup(p.findDataTargetDataGroups, 'zalo_group_link')
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) {
      setHandleFoundZaloGroupLinkWebData(false)
      setHandleFoundZaloGroupLinkJoinData(false)
      setHandleFoundZaloGroupLinkAkaBizDesktopData(false)
      setFindDataTargetDataGroupEnabled(previous => ({ ...previous, zalo_group_link: false }))
    }
  }

  const handleFindUidTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindUid: checked,
      findUidTargetCampaignIds: checked ? p.findUidTargetCampaignIds : [],
      findDataTargetDataGroups: checked
        ? p.findDataTargetDataGroups
        : removeFindDataTargetDataGroup(p.findDataTargetDataGroups, 'facebook_uid')
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) {
      setHandleFoundUidData(false)
      setFindDataTargetDataGroupEnabled(previous => ({ ...previous, facebook_uid: false }))
    }
  }

  const handleFindPostLinkTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindPostLink: checked,
      isFindInPost: checked ? true : p.isFindInPost,
      findPostLinkTargetCampaignIds: checked ? p.findPostLinkTargetCampaignIds : [],
      findDataTargetDataGroups: checked
        ? p.findDataTargetDataGroups
        : removeFindDataTargetDataGroup(p.findDataTargetDataGroups, 'post_link')
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) {
      setHandleFoundPostLinkData(false)
      setFindDataTargetDataGroupEnabled(previous => ({ ...previous, post_link: false }))
    }
  }

  const handleFindFacebookGroupTargetChange = (checked: boolean) => {
    setFormData(p => sanitizeFindDataSourceSelection({
      ...p,
      isFindFacebookGroup: checked,
      findFacebookGroupPostTargetCampaignIds: checked ? p.findFacebookGroupPostTargetCampaignIds : [],
      findFacebookGroupCommentTargetCampaignIds: checked ? p.findFacebookGroupCommentTargetCampaignIds : [],
      findFacebookGroupJoinTargetCampaignIds: checked ? p.findFacebookGroupJoinTargetCampaignIds : [],
      findDataTargetDataGroups: checked
        ? p.findDataTargetDataGroups
        : removeFindDataTargetDataGroup(p.findDataTargetDataGroups, 'facebook_group')
    }, { isSearchCampaign: isFindDataSearchCampaign }))
    if (!checked) {
      setHandleFoundFacebookGroupPostData(false)
      setHandleFoundFacebookGroupCommentData(false)
      setHandleFoundFacebookGroupJoinData(false)
      setFindDataTargetDataGroupEnabled(previous => ({ ...previous, facebook_group: false }))
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
                disabled={isDraftAutoLinkedFacebookGroup}
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

  const toInternalCampaignPickerRow = (item: CampaignListItem): CampaignPickerRow => {
    const accountName = item.accountName || `Tài khoản #${item.accountId}`
    const actionLabel = item.actionName || item.actionId
    const scheduleLabel = getCampaignScheduleLabel(item)
    const updatedAtLabel = formatPickerDateTime(item.updatedAt)
    return {
      id: item.id,
      name: item.name || `Campaign #${item.id}`,
      actionLabel,
      accountName,
      status: item.status || 'Không rõ',
      scheduleLabel,
      updatedAtLabel,
      searchText: buildCampaignPickerSearchText([item.name, actionLabel, accountName, item.status, scheduleLabel, updatedAtLabel])
    }
  }

  const toFindDataSourcePickerRow = (item: CampaignListItem): CampaignPickerRow => {
    const accountName = item.accountName || `Tài khoản #${item.accountId}`
    const actionLabel = item.actionName || item.actionId
    const scheduleLabel = getCampaignScheduleLabel(item)
    const updatedAtLabel = formatPickerDateTime(item.updatedAt)
    const dataTypes = getFindDataTypeLabels(item.relationSettings)
    const sourceTypes = getFindDataSourceLabels(item.relationSettings)
    return {
      id: item.id,
      name: item.name || `Campaign #${item.id}`,
      actionLabel,
      accountName,
      status: item.status || 'Không rõ',
      scheduleLabel,
      updatedAtLabel,
      dataTypes,
      sourceTypes,
      searchText: buildCampaignPickerSearchText([item.name, actionLabel, accountName, item.status, scheduleLabel, updatedAtLabel, dataTypes, sourceTypes])
    }
  }

  const toExternalCampaignPickerRow = (item: AkaBizCampaignListItem): CampaignPickerRow => {
    const name = item.name || `Campaign #${item.id}`
    const actionLabel = item.campaignActionId || undefined
    const accountName = item.shopName || `Tài khoản #${item.shopId}`
    const status = item.status || 'Không rõ'
    const scheduleLabel = formatPickerDateTime(item.schedule)
    return {
      id: item.id,
      name,
      actionLabel,
      accountName,
      status,
      scheduleLabel,
      searchText: buildCampaignPickerSearchText([name, actionLabel, accountName, status, scheduleLabel])
    }
  }

  const getFindDataSourceKindForDraft = (draft: InternalCampaignDraft): FindDataSourceKind | null => {
    const firstActionId = String(draft.items[0]?.campaignPayload.actionId || draft.actionId || '')
    return getFindDataSourceKindForActionId(firstActionId)
  }

  const getFindDataSourceKindForSelectedId = (id: number): FindDataSourceKind | null => {
    const draft = internalCampaignDrafts.find(item => item.tempId === id)
    if (draft) return getFindDataSourceKindForDraft(draft)

    const sourceCampaign = allFindDataSourceCampaignOptions.find(item => item.id === id) || campaigns.find(item => item.id === id)
    return getFindDataSourceKindForActionId(sourceCampaign?.actionId)
  }

  const draftMatchesCampaignPickerSource = (draft: InternalCampaignDraft, source: CampaignPickerSource): boolean => {
    if (source.type === 'external') return false
    if (draft.sourceType !== source.type) return false
    if (source.type === 'findDataSource') {
      const matchesTargetField = !draft.requiredTargetField || draft.requiredTargetField === targetFindDataField
      const matchesSourceKind = !source.sourceKind || getFindDataSourceKindForDraft(draft) === source.sourceKind
      return matchesTargetField && matchesSourceKind
    }
    return true
  }

  const getSelectedFindDataSourceCampaignIdsForSource = (source: Extract<CampaignPickerSource, { type: 'findDataSource' }>): number[] => {
    if (!source.sourceKind) return selectedFindDataSourceCampaignIds
    return selectedFindDataSourceCampaignIds.filter(id => getFindDataSourceKindForSelectedId(id) === source.sourceKind)
  }

  const setSelectedFindDataSourceCampaignIdsForSource = (
    source: Extract<CampaignPickerSource, { type: 'findDataSource' }>,
    ids: number[]
  ) => {
    findDataSourceSelectionTouchedRef.current = true
    const nextIds = getPickerCampaignIdList(ids)
    if (!source.sourceKind) {
      setSelectedFindDataSourceCampaignIds(nextIds)
      return
    }

    setSelectedFindDataSourceCampaignIds(prev => {
      const preservedIds = prev.filter(id => getFindDataSourceKindForSelectedId(id) !== source.sourceKind)
      return getPickerCampaignIdList([...preservedIds, ...nextIds])
    })
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
    const actionId = String(payload.actionId || draft.actionId || '')
    const actionLabel = campaignActions.find(action => action.id === actionId)?.name || actionId
    const extraSettings = payload.extraSettings as CampaignExtraSettings | undefined
    const dataTypes = draft.sourceType === 'findDataSource' ? getFindDataTypeLabels(extraSettings) : undefined
    const sourceTypes = draft.sourceType === 'findDataSource' ? getFindDataSourceLabels(extraSettings) : undefined
    const scheduleLabel = getCampaignScheduleLabel(payload as Pick<Campaign, 'schedule' | 'scheduleType' | 'scheduleDays' | 'scheduleWeekDays'>)
    const updatedAtLabel = formatPickerDateTime(payload.updatedAt)

    return {
      id: draft.tempId,
      name: displayName,
      actionLabel,
      accountName: accountNames.join(', '),
      status: 'Tạm',
      scheduleLabel,
      updatedAtLabel,
      dataTypes,
      sourceTypes,
      searchText: buildCampaignPickerSearchText([displayName, actionLabel, accountNames, 'Tạm', scheduleLabel, updatedAtLabel, dataTypes, sourceTypes])
    }
  }

  const getDraftCampaignAccountIds = (draft: InternalCampaignDraft): number[] => Array.from(new Set(
    draft.items
      .map(item => Number(item.campaignPayload.accountId))
      .filter(id => Number.isFinite(id) && id > 0)
  ))

  const getDraftCampaignDetails = (draft: InternalCampaignDraft): Partial<CampaignInputData>[] =>
    draft.items.flatMap(item => item.details.map(detail => ({ ...detail })))

  const getDraftCampaignDataGroupSnapshots = (draft: InternalCampaignDraft): DirectDataGroupSnapshotIntent[] => {
    const snapshotsByGroupId = new Map<number, DirectDataGroupSnapshotIntent>()
    for (const snapshot of draft.items.flatMap(item => item.dataGroupSnapshots || [])) {
      if (!snapshotsByGroupId.has(snapshot.groupId)) snapshotsByGroupId.set(snapshot.groupId, { ...snapshot })
    }
    return Array.from(snapshotsByGroupId.values())
  }

  const buildDraftCampaignPreview = (draft: InternalCampaignDraft, id = draft.tempId): CampaignConfig => {
    const firstItem = draft.items[0]
    const payload = firstItem?.campaignPayload || {}
    const accountIds = getDraftCampaignAccountIds(draft)
    const accountNames = accountIds
      .map(accountId => accounts.find(account => account.id === accountId)?.name || `Tài khoản #${accountId}`)
      .filter(Boolean)
    const actionId = String(payload.actionId || draft.actionId || '')
    const actionName = campaignActions.find(action => action.id === actionId)?.name
    const name = String(payload.name || `Chiến dịch tạm #${Math.abs(draft.tempId)}`)
    const displayName = draft.items.length > 1 && id !== 0 ? `${name} (${draft.items.length} tài khoản)` : name

    return {
      id,
      name: displayName,
      actionId,
      accountId: accountIds[0] || Number(payload.accountId) || 0,
      secondaryAccountId: payload.secondaryAccountId ?? null,
      secondaryAccountName: payload.secondaryAccountId
        ? accounts.find(account => account.id === payload.secondaryAccountId)?.name
        : undefined,
      status: 'Tạm',
      schedule: payload.schedule,
      originalSchedule: payload.originalSchedule || payload.schedule || null,
      scheduleType: payload.scheduleType,
      scheduleEndDate: payload.scheduleEndDate,
      dailyStopTime: payload.dailyStopTime,
      scheduleDays: payload.scheduleDays,
      scheduleWeekDays: payload.scheduleWeekDays,
      continueNextDay: payload.continueNextDay,
      refreshData: payload.refreshData,
      note: payload.note,
      content: payload.content,
      extraSettings: payload.extraSettings as CampaignExtraSettings | undefined,
      images: payload.images,
      isDelete: false,
      actionName,
      accountName: accountNames.join(', ')
    }
  }

  const getCampaignPickerRows = (source: CampaignPickerSource): CampaignPickerRow[] => {
    const draftRows = internalCampaignDrafts
      .filter(draft => draftMatchesCampaignPickerSource(draft, source))
      .map(toDraftCampaignPickerRow)
    if (source.type === 'findDataSource') {
      return [
        ...getFindDataSourceCampaignOptions(source, true).map(toFindDataSourcePickerRow),
        ...draftRows
      ]
    }
    if (source.type === 'messageUidTarget') return [...messageUidCampaignOptions.map(toInternalCampaignPickerRow), ...draftRows]
    if (source.type === 'postLinkTarget') return [...postLinkCommentCampaignOptions.map(toInternalCampaignPickerRow), ...draftRows]
    if (source.type === 'groupPostTarget') return [...groupPostCampaignOptions.map(toInternalCampaignPickerRow), ...draftRows]
    if (source.type === 'groupCommentTarget') return [...groupCommentCampaignOptions.map(toInternalCampaignPickerRow), ...draftRows]
    if (source.type === 'zaloMessagePhoneTarget') return [...zaloMessagePhoneCampaignOptions.map(toInternalCampaignPickerRow), ...draftRows]
    if (source.type === 'zaloJoinGroupLinkTarget') return [...zaloJoinGroupLinkCampaignOptions.map(toInternalCampaignPickerRow), ...draftRows]
    if (source.type === 'facebookJoinGroupTarget') return [...facebookJoinGroupCampaignOptions.map(toInternalCampaignPickerRow), ...draftRows]
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
    if (source.type === 'groupPostTarget') return GROUP_POST_ACTION_ID
    if (source.type === 'groupCommentTarget') return COMMENT_SEEDING_FEED_ACTION_ID
    if (source.type === 'zaloMessagePhoneTarget') return ZALO_MESSAGE_PHONE_ACTION_ID
    if (source.type === 'zaloJoinGroupLinkTarget') return ZALO_JOIN_GROUP_LINK_ACTION_ID
    if (source.type === 'facebookJoinGroupTarget') return FACEBOOK_JOIN_GROUP_ACTION_ID
    if (source.type === 'findDataSource') {
      if (source.sourceKind === 'group') return FIND_DATA_GROUP_ACTION_ID
      if (source.sourceKind === 'search') return FIND_DATA_SEARCH_ACTION_ID
      return targetFindDataField === 'findFacebookGroupPostTargetCampaignIds' ||
        targetFindDataField === 'findFacebookGroupCommentTargetCampaignIds' ||
        targetFindDataField === 'findFacebookGroupJoinTargetCampaignIds'
        ? FIND_DATA_SEARCH_ACTION_ID
        : FIND_DATA_GROUP_ACTION_ID
    }
    return null
  }

  const getFindDataTargetFieldForDraftSourceType = (sourceType: InternalCampaignPickerSourceType): FindDataTargetCampaignField | null => {
    if (sourceType === 'messageUidTarget') return 'findUidTargetCampaignIds'
    if (sourceType === 'postLinkTarget') return 'findPostLinkTargetCampaignIds'
    if (sourceType === 'groupPostTarget') return 'findFacebookGroupPostTargetCampaignIds'
    if (sourceType === 'groupCommentTarget') return 'findFacebookGroupCommentTargetCampaignIds'
    if (sourceType === 'zaloMessagePhoneTarget') return 'findPhoneZaloMessagePhoneTargetCampaignIds'
    if (sourceType === 'zaloJoinGroupLinkTarget') return 'findZaloGroupLinkJoinTargetCampaignIds'
    if (sourceType === 'facebookJoinGroupTarget') return 'findFacebookGroupJoinTargetCampaignIds'
    return null
  }

  const appendDraftTargetSelection = (sourceType: InternalCampaignPickerSourceType, tempId: number) => {
    const field = getFindDataTargetFieldForDraftSourceType(sourceType)
    if (!field) return
    setFormData(prev => ({
      ...prev,
      [field]: getPickerCampaignIdList([...(prev[field] || []), tempId])
    }))
  }

  const openDraftCampaignForm = (
    source: CampaignPickerSource,
    draft?: InternalCampaignDraft,
    overrideSubmitLabel?: string,
    autoSelectOnSave = false
  ) => {
    const actionId = getDraftActionIdForPickerSource(source)
    if (!actionId || source.type === 'external') return
    setDraftFormConfig({
      tempId: draft?.tempId ?? nextDraftCampaignTempIdRef.current--,
      sourceType: source.type,
      actionId: draft?.actionId || actionId,
      requiredTargetField: draft?.requiredTargetField ?? (source.type === 'findDataSource' ? targetFindDataField : null),
      initialCampaign: draft ? buildDraftCampaignPreview(draft, 0) : null,
      initialAccountIds: draft ? getDraftCampaignAccountIds(draft) : undefined,
      initialDetails: draft ? getDraftCampaignDetails(draft) : undefined,
      initialDataGroupSnapshots: draft ? getDraftCampaignDataGroupSnapshots(draft) : undefined,
      submitLabel: overrideSubmitLabel || (draft ? 'Sửa' : source.type === 'findDataSource' ? 'Thêm' : undefined),
      autoSelectOnSave
    })
  }

  const handleDraftCampaignSaved = (draft: InternalCampaignDraft) => {
    setInternalCampaignDrafts(prev => [...prev.filter(item => item.tempId !== draft.tempId), draft])
    setCampaignPickerModal(prev => prev
      ? { ...prev, draftIds: getPickerCampaignIdList([...prev.draftIds, draft.tempId]) }
      : prev
    )
    if (draft.sourceType === 'findDataSource' && draftMatchesCampaignPickerSource(draft, { type: 'findDataSource' })) {
      findDataSourceSelectionTouchedRef.current = true
      setSelectedFindDataSourceCampaignIds(prev => getPickerCampaignIdList([...prev, draft.tempId]))
    }
    if (draftFormConfig?.autoSelectOnSave) {
      appendDraftTargetSelection(draft.sourceType, draft.tempId)
    }
    setDraftFormConfig(null)
  }

  const renderTextList = (items: string[] | undefined, emptyText = 'Không có') => {
    if (!items || items.length === 0) {
      return <span className="campaign-picker-muted">{emptyText}</span>
    }
    return <span className="campaign-picker-text-list">{items.join(', ')}</span>
  }

  const isInternalTargetCampaignPickerSource = (source: CampaignPickerSource): boolean =>
    source.type !== 'external' && source.type !== 'findDataSource'

  const renderSelectedCampaignSummary = (
    source: CampaignPickerSource,
    selectedIds: number[],
    emptyText: string,
    onSelectedIdsChange?: (ids: number[]) => void
  ) => {
    if (selectedIds.length === 0) {
      return <div className="campaign-picker-empty-summary">{emptyText}</div>
    }

    const showTargetActions = isInternalTargetCampaignPickerSource(source) && !!onSelectedIdsChange
    const rows = getCampaignPickerRows(source)
    const rowById = new Map(rows.map(row => [row.id, row]))
    const selectedItems = selectedIds.map(id => {
      const draft = internalCampaignDrafts.find(item => item.tempId === id && draftMatchesCampaignPickerSource(item, source))
      const campaign = campaigns.find(item => item.id === id)
      return {
        id,
        draft,
        campaign,
        row: rowById.get(id) || {
          id,
          name: `Campaign #${id}`,
          searchText: String(id)
        }
      }
    })
    const columns: CampaignPickerColumn[] = source.type === 'findDataSource'
      ? ['name', 'account', 'status', 'schedule', 'updatedAt', 'dataTypes', 'sourceTypes']
      : isInternalTargetCampaignPickerSource(source)
        ? ['name', 'action', 'account', 'status', 'schedule', 'updatedAt']
        : ['name', 'account', 'status', 'schedule']
    const columnLabels: Record<CampaignPickerColumn, string> = {
      name: 'Tên chiến dịch',
      action: 'Hành động',
      account: source.type === 'external' ? 'Tài khoản/Shop' : 'Tài khoản',
      status: 'Trạng thái',
      schedule: 'Lịch chạy',
      updatedAt: 'Ngày update',
      dataTypes: 'Data tìm',
      sourceTypes: 'Nguồn tìm'
    }
    const renderSummaryCell = (row: CampaignPickerRow, column: CampaignPickerColumn) => {
      if (column === 'name') return <span className="campaign-picker-table-name">{row.name}</span>
      if (column === 'action') return row.actionLabel || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'account') return row.accountName || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'status') return row.status || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'schedule') return row.scheduleLabel
        ? <span className="campaign-picker-table-schedule">{row.scheduleLabel}</span>
        : <span className="campaign-picker-muted">Chưa có</span>
      if (column === 'updatedAt') return row.updatedAtLabel
        ? <span className="campaign-picker-table-schedule">{row.updatedAtLabel}</span>
        : <span className="campaign-picker-muted">Chưa có</span>
      if (column === 'dataTypes') return renderTextList(row.dataTypes)
      return renderTextList(row.sourceTypes)
    }

    const viewTargetCampaign = async (item: typeof selectedItems[number]) => {
      if (item.draft) {
        setViewingSourceCampaign(buildDraftCampaignPreview(item.draft))
        return
      }
      if (!item.campaign) return
      try {
        const fullCampaign = await useCampaignStore.getState().loadCampaignConfig(item.campaign.id)
        if (!fullCampaign) throw new Error('Không tìm thấy cấu hình chiến dịch.')
        setViewingSourceCampaign(fullCampaign)
      } catch (err) {
        showAlert(formatIpcErrorMessage(err, 'Không thể tải cấu hình chiến dịch.'), 'error')
      }
    }

    const editTargetCampaign = async (item: typeof selectedItems[number]) => {
      if (item.draft) {
        openDraftCampaignForm(source, item.draft, 'Sửa')
        return
      }
      if (!item.campaign) return
      if (!isEditableFindDataSourceCampaign(item.campaign)) {
        showAlert('Chỉ có thể sửa chiến dịch khi trạng thái là "chờ xử lý" hoặc "tạm dừng".', 'info')
        return
      }
      try {
        const fullCampaign = await useCampaignStore.getState().loadCampaignConfig(item.campaign.id, { force: true })
        if (!fullCampaign) throw new Error('Không tìm thấy cấu hình chiến dịch.')
        if (!isEditableFindDataSourceCampaign(fullCampaign)) {
          showAlert('Chỉ có thể sửa chiến dịch khi trạng thái là "chờ xử lý" hoặc "tạm dừng".', 'info')
          return
        }
        setEditingSourceCampaign(fullCampaign)
      } catch (err) {
        showAlert(formatIpcErrorMessage(err, 'Không thể tải cấu hình chiến dịch.'), 'error')
      }
    }

    const detachTargetCampaign = (item: typeof selectedItems[number]) => {
      showConfirm(
        `Gỡ chiến dịch "${item.row.name}" khỏi danh sách?`,
        () => {
          onSelectedIdsChange?.(selectedIds.filter(id => id !== item.id))
          setInternalCampaignDrafts(prev => prev.filter(draft => draft.tempId !== item.id))
        },
        { title: 'Gỡ chiến dịch', confirmText: 'Gỡ' }
      )
    }

    return (
      <div className="campaign-picker-summary-table-wrap">
        <table className={`campaign-picker-summary-table${showTargetActions ? ' campaign-picker-target-table' : ''}`}>
          <thead>
            <tr>
              {showTargetActions && <th className="campaign-picker-summary-actions-col">Thao tác</th>}
              {columns.map(column => (
                <th key={column}>{columnLabels[column]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selectedItems.map(item => {
              const editDisabled = item.campaign ? !isEditableFindDataSourceCampaign(item.campaign) : !item.draft
              return (
                <tr key={item.id} title={getCampaignPickerRowLabel(item.row)}>
                  {showTargetActions && (
                    <td className="campaign-picker-summary-actions-col">
                      <div className="campaign-picker-summary-row-actions">
                        <button type="button" className="btn-icon" onClick={() => { void viewTargetCampaign(item) }} title="Xem">
                          <Eye size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => { void editTargetCampaign(item) }}
                          disabled={editDisabled}
                          title={editDisabled ? 'Chỉ sửa được chiến dịch chờ xử lý hoặc tạm dừng' : 'Sửa'}
                        >
                          <Edit3 size={13} />
                        </button>
                        <button type="button" className="btn-icon" onClick={() => detachTargetCampaign(item)} title="Gỡ">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                  {columns.map(column => (
                    <td key={column}>{renderSummaryCell(item.row, column)}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const renderDraftRelationNotice = (text: string) => (
    <div className="campaign-picker-readonly-note">{text}</div>
  )

  const getFindDataSourceDetachBlockReason = (sourceCampaign: Pick<Campaign, 'status'>): string =>
    isEditableFindDataSourceCampaign(sourceCampaign)
      ? ''
      : 'Chỉ có thể gỡ chiến dịch nguồn khi trạng thái là "chờ xử lý" hoặc "tạm dừng".'

  const getFindDataSourceListItems = (
    source: Extract<CampaignPickerSource, { type: 'findDataSource' }>,
    selectedIds = selectedFindDataSourceCampaignIds
  ) => {
    const sourceById = new Map(getFindDataSourceCampaignOptions(source).map(item => [item.id, item]))
    const draftById = new Map(internalCampaignDrafts
      .filter(draft => draftMatchesCampaignPickerSource(draft, source))
      .map(draft => [draft.tempId, draft])
    )

    return selectedIds.map(id => {
      const draft = draftById.get(id)
      if (draft) {
        return {
          id,
          draft,
          row: toDraftCampaignPickerRow(draft)
        }
      }

      const sourceCampaign = sourceById.get(id) || campaigns.find(item => item.id === id)
      return {
        id,
        campaign: sourceCampaign,
        row: sourceCampaign ? toFindDataSourcePickerRow(sourceCampaign) : {
          id,
          name: `Campaign #${id}`,
          status: 'Không rõ',
          searchText: String(id)
        } as CampaignPickerRow
      }
    })
  }

  const removeFindDataSourceSelection = (sourceId: number) => {
    findDataSourceSelectionTouchedRef.current = true
    setSelectedFindDataSourceCampaignIds(prev => prev.filter(id => id !== sourceId))
    setInternalCampaignDrafts(prev => prev.filter(draft => draft.tempId !== sourceId))
  }

  const viewFindDataSourceCampaign = async (sourceId: number) => {
    const draft = internalCampaignDrafts.find(item => item.tempId === sourceId)
    if (draft) {
      setViewingSourceCampaign(buildDraftCampaignPreview(draft))
      return
    }

    const sourceCampaign = campaigns.find(item => item.id === sourceId)
    if (!sourceCampaign) return
    try {
      const fullCampaign = await useCampaignStore.getState().loadCampaignConfig(sourceCampaign.id)
      if (!fullCampaign) throw new Error('Không tìm thấy cấu hình chiến dịch nguồn.')
      setViewingSourceCampaign(fullCampaign)
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tải cấu hình chiến dịch nguồn.'), 'error')
    }
  }

  const editFindDataSourceCampaign = async (sourceId: number) => {
    const draft = internalCampaignDrafts.find(item => item.tempId === sourceId)
    if (draft) {
      openDraftCampaignForm({ type: 'findDataSource' }, draft, 'Sửa')
      return
    }

    const sourceCampaign = campaigns.find(item => item.id === sourceId)
    if (!sourceCampaign) return
    if (!isEditableFindDataSourceCampaign(sourceCampaign)) {
      showAlert('Chỉ có thể sửa chiến dịch nguồn khi trạng thái là "chờ xử lý" hoặc "tạm dừng".', 'info')
      return
    }
    try {
      const fullCampaign = await useCampaignStore.getState().loadCampaignConfig(sourceCampaign.id, { force: true })
      if (!fullCampaign) throw new Error('Không tìm thấy cấu hình chiến dịch nguồn.')
      if (!isEditableFindDataSourceCampaign(fullCampaign)) {
        showAlert('Chỉ có thể sửa chiến dịch nguồn khi trạng thái là "chờ xử lý" hoặc "tạm dừng".', 'info')
        return
      }
      setEditingSourceCampaign(fullCampaign)
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tải cấu hình chiến dịch nguồn.'), 'error')
    }
  }

  const detachFindDataSourceCampaign = (sourceId: number) => {
    const draft = internalCampaignDrafts.find(item => item.tempId === sourceId)
    if (draft) {
      const row = toDraftCampaignPickerRow(draft)
      showConfirm(
        `Gỡ chiến dịch nguồn tạm "${row.name}" khỏi danh sách?`,
        () => removeFindDataSourceSelection(sourceId),
        { title: 'Gỡ chiến dịch nguồn tạm', confirmText: 'Gỡ' }
      )
      return
    }

    const sourceCampaign = campaigns.find(item => item.id === sourceId)
    if (!sourceCampaign) {
      removeFindDataSourceSelection(sourceId)
      return
    }

    const blockReason = getFindDataSourceDetachBlockReason(sourceCampaign)
    if (blockReason) {
      showAlert(blockReason, 'info')
      return
    }

    showConfirm(
      `Gỡ chiến dịch nguồn "${sourceCampaign.name}" khỏi chiến dịch hiện tại?`,
      async () => {
        try {
          if (sourceDetachCurrentTargetCampaignId) {
            const fullCampaign = await useCampaignStore.getState().loadCampaignConfig(sourceCampaign.id, { force: true })
            if (!fullCampaign) throw new Error('Không tìm thấy cấu hình chiến dịch nguồn.')
            const latestBlockReason = getFindDataSourceDetachBlockReason(fullCampaign)
            if (latestBlockReason) {
              showAlert(latestBlockReason, 'info')
              return
            }
            await updateCampaign(fullCampaign.id, {
              extraSettings: removeFindDataTargetCampaignId(fullCampaign.extraSettings, sourceDetachCurrentTargetCampaignId)
            })
          }
          removeFindDataSourceSelection(sourceCampaign.id)
          showAlert('Đã gỡ chiến dịch nguồn.', 'success')
        } catch (err) {
          showAlert(formatIpcErrorMessage(err, 'Không thể gỡ chiến dịch nguồn.'), 'error')
        }
      },
      { title: 'Gỡ chiến dịch nguồn', confirmText: 'Gỡ' }
    )
  }

  const renderFindDataSourceCampaignList = (
    emptyText: string,
    source: Extract<CampaignPickerSource, { type: 'findDataSource' }> = { type: 'findDataSource' },
    selectedIds = selectedFindDataSourceCampaignIds
  ) => {
    const items = getFindDataSourceListItems(source, selectedIds)
    if (items.length === 0) {
      return <div className="campaign-picker-empty-summary">{emptyText}</div>
    }

    return (
      <div className="campaign-picker-summary-table-wrap source-campaign-table-wrap">
        <table className="campaign-picker-summary-table source-campaign-table">
          <thead>
            <tr>
              <th className="source-campaign-actions-col">Thao tác</th>
              <th>Tên chiến dịch</th>
              <th>Tài khoản</th>
              <th>Trạng thái</th>
              <th>Lịch chạy</th>
              <th>Ngày update</th>
              <th>Data tìm</th>
              <th>Nguồn tìm</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const { row, campaign: sourceCampaign } = item
              const detachBlockReason = sourceCampaign ? getFindDataSourceDetachBlockReason(sourceCampaign) : ''
              const editDisabled = sourceCampaign ? !isEditableFindDataSourceCampaign(sourceCampaign) : !item.draft
              const detachDisabled = !!detachBlockReason
              return (
                <tr key={item.id} title={getCampaignPickerRowLabel(row)}>
                  <td className="source-campaign-actions-col">
                    <div className="source-campaign-row-actions">
                      <button type="button" className="btn-icon" onClick={() => { void viewFindDataSourceCampaign(item.id) }} title="Xem">
                        <Eye size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => { void editFindDataSourceCampaign(item.id) }}
                        disabled={editDisabled}
                        title={editDisabled ? 'Chỉ sửa được chiến dịch chờ xử lý hoặc tạm dừng' : 'Sửa'}
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => detachFindDataSourceCampaign(item.id)}
                        disabled={detachDisabled}
                        title={detachBlockReason || 'Gỡ'}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                  <td><span className="campaign-picker-table-name">{row.name}</span></td>
                  <td>{row.accountName || <span className="campaign-picker-muted">Không rõ</span>}</td>
                  <td>{row.status || <span className="campaign-picker-muted">Không rõ</span>}</td>
                  <td>{row.scheduleLabel
                    ? <span className="campaign-picker-table-schedule">{row.scheduleLabel}</span>
                    : <span className="campaign-picker-muted">Chưa có</span>}</td>
                  <td>{row.updatedAtLabel
                    ? <span className="campaign-picker-table-schedule">{row.updatedAtLabel}</span>
                    : <span className="campaign-picker-muted">Chưa có</span>}</td>
                  <td>{renderTextList(row.dataTypes)}</td>
                  <td>{renderTextList(row.sourceTypes)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

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
    const renderFindDataSourceKindBlock = (
      sourceKind: FindDataSourceKind,
      title: string,
      emptyPickerText: string,
      emptyListText: string
    ) => {
      const source: Extract<CampaignPickerSource, { type: 'findDataSource' }> = { type: 'findDataSource', sourceKind }
      const selectedIds = getSelectedFindDataSourceCampaignIdsForSource(source)
      return (
        <div className="source-campaign-kind-block">
          <div className="source-campaign-kind-title">{title}</div>
          <div className="source-campaign-toolbar">
            <button
              type="button"
              className="btn btn-secondary btn-sm campaign-picker-select-button"
              onClick={() => openCampaignPicker({
                title: `Chọn nguồn chiến dịch: ${title}`,
                source,
                columns: ['name', 'account', 'status', 'schedule', 'updatedAt', 'dataTypes', 'sourceTypes'],
                emptyText: emptyPickerText,
                selectedIds,
                onConfirm: ids => setSelectedFindDataSourceCampaignIdsForSource(source, ids)
              })}
            >
              Chọn chiến dịch
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm source-campaign-add-button"
              onClick={() => openDraftCampaignForm(source, undefined, 'Thêm')}
            >
              <Plus size={15} /> Thêm chiến dịch
            </button>
          </div>
          <div className="source-campaign-list-title">Danh sách chiến dịch</div>
          {renderFindDataSourceCampaignList(emptyListText, source, selectedIds)}
        </div>
      )
    }

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

    if (targetFindDataField === 'findUidTargetCampaignIds') {
      return (
        <div className="stepper-form-group">
          <label>Chiến dịch nguồn</label>
          <div className="campaign-picker-field source-campaign-kind-list">
            {renderFindDataSourceKindBlock(
              'group',
              'Tìm trong group',
              'Chưa có chiến dịch tìm trong group phù hợp để làm nguồn UID.',
              'Chưa chọn chiến dịch nguồn tìm trong group nào.'
            )}
            {renderFindDataSourceKindBlock(
              'search',
              'Tìm bằng search',
              'Chưa có chiến dịch tìm bằng search phù hợp để làm nguồn UID.',
              'Chưa chọn chiến dịch nguồn tìm bằng search nào.'
            )}
          </div>
        </div>
      )
    }

    const source: Extract<CampaignPickerSource, { type: 'findDataSource' }> = { type: 'findDataSource' }
    return (
      <div className="stepper-form-group">
        <label>Chiến dịch nguồn</label>
        <div className="campaign-picker-field">
          <div className="source-campaign-toolbar">
            <button
              type="button"
              className="btn btn-secondary btn-sm campaign-picker-select-button"
              onClick={() => openCampaignPicker({
                title: 'Chọn nguồn chiến dịch tìm kiếm data',
                source,
                columns: ['name', 'account', 'status', 'schedule', 'updatedAt', 'dataTypes', 'sourceTypes'],
                emptyText: emptyMessage,
                selectedIds: selectedFindDataSourceCampaignIds,
                onConfirm: ids => setSelectedFindDataSourceCampaignIdsForSource(source, ids)
              })}
            >
              Chọn chiến dịch
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm source-campaign-add-button"
              onClick={() => openDraftCampaignForm(source, undefined, 'Thêm')}
            >
              <Plus size={15} /> Thêm chiến dịch
            </button>
          </div>
          <div className="source-campaign-list-title">Danh sách chiến dịch</div>
          {renderFindDataSourceCampaignList('Chưa chọn chiến dịch nguồn nào.')}
        </div>
      </div>
    )
  }

  const renderInternalCampaignPicker = (
    source: CampaignPickerSource,
    selectedIds: number[],
    onConfirm: (ids: number[]) => void,
    emptyText: string
  ) => {
    const canAddInternalCampaign = !draftMode && !!getDraftActionIdForPickerSource(source)

    return (
      <div className="campaign-picker-field">
        <div className="source-campaign-toolbar">
          <button
            type="button"
            className="btn btn-secondary btn-sm campaign-picker-select-button"
            onClick={() => openCampaignPicker({
              title: 'Chọn chiến dịch',
              source,
              columns: ['name', 'action', 'account', 'status', 'schedule', 'updatedAt'],
              emptyText,
              selectedIds,
              onConfirm
            })}
          >
            Chọn chiến dịch
          </button>
          {canAddInternalCampaign && (
            <button
              type="button"
              className="btn btn-secondary btn-sm source-campaign-add-button"
              onClick={() => openDraftCampaignForm(source, undefined, undefined, true)}
            >
              <Plus size={15} /> Thêm chiến dịch
            </button>
          )}
        </div>
        {renderSelectedCampaignSummary(source, selectedIds, 'Chưa chọn chiến dịch nào.', onConfirm)}
      </div>
    )
  }

  const renderFoundDataHandlingGroup = (title: string, items: ReactNode[]) => {
    const visibleItems = items.filter(Boolean)
    if (visibleItems.length === 0) return null

    return (
      <div className="found-data-handling-group">
        <div className="found-data-handling-group-title">{title}</div>
        <div className="found-data-handling-group-options">{visibleItems}</div>
      </div>
    )
  }

  const setFindDataTargetDataGroup = (
    kind: FindDataOutputKind,
    destination: FindDataTargetDataGroup | null
  ) => {
    if (!destination) {
      setFindDataTargetDataGroupDetails(previous => {
        const next = { ...previous }
        delete next[kind]
        return next
      })
    }
    setFormData(previous => ({
      ...previous,
      findDataTargetDataGroups: destination
        ? {
          ...previous.findDataTargetDataGroups,
          [kind]: destination
        }
        : removeFindDataTargetDataGroup(previous.findDataTargetDataGroups, kind)
    }))
  }

  const renderFindDataGroupDestinationOption = (kind: FindDataOutputKind) => {
    const config = FIND_DATA_GROUP_DESTINATION_CONFIG[kind]
    const destination = formData.findDataTargetDataGroups[kind]
    const selectedGroup = findDataTargetDataGroupDetails[kind]
    const enabled = findDataTargetDataGroupEnabled[kind]
    const hasSelection = Number.isSafeInteger(Number(destination?.groupId)) && Number(destination?.groupId) > 0
    const openPicker = () => setFindDataGroupPickerKind(kind)

    return (
      <div key={`data-group-${kind}`} className="extra-comment-options">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={event => {
              const checked = event.target.checked
              setFindDataTargetDataGroupEnabled(previous => ({
                ...previous,
                [kind]: checked
              }))
              if (!checked) {
                setFindDataTargetDataGroup(kind, null)
              }
            }}
          />
          <span>{config.label}</span>
        </label>
        {enabled && (
          <div style={{ marginTop: 12 }}>
            <div className="campaign-data-group-label">Chọn nhóm data</div>
            <div className="campaign-data-group-picker-row">
              <button
                type="button"
                className="campaign-data-group-control"
                onClick={openPicker}
              >
                {selectedGroup ? (
                  <>
                    <span
                      className="campaign-data-group-dot"
                      style={{ background: selectedGroup.color || 'var(--accent-primary)' }}
                    />
                    <span className="campaign-data-group-control-copy">
                      <strong>{selectedGroup.name}</strong>
                      <small>
                        {selectedGroup.activeMembershipCount.toLocaleString('vi-VN')} data
                        {' · '}
                        {getDataGroupSemanticTypeName(selectedGroup)}
                      </small>
                    </span>
                  </>
                ) : hasSelection ? (
                  <>
                    <span className="campaign-data-group-dot" style={{ background: 'var(--accent-primary)' }} />
                    <span className="campaign-data-group-control-copy">
                      <strong>{destination?.groupName || `Nhóm ${destination?.groupId}`}</strong>
                      <small>Nhóm data đã chọn</small>
                    </span>
                  </>
                ) : (
                  <>
                    <FolderOpen size={16} />
                    <span className="campaign-data-group-control-placeholder">Chọn nhóm data...</span>
                  </>
                )}
                <ChevronDown size={17} />
              </button>
              <button
                type="button"
                className="btn btn-primary campaign-data-group-pick-button"
                onClick={openPicker}
              >
                <Plus size={15} /> {hasSelection ? 'Đổi nhóm' : 'Chọn nhóm'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderFoundDataHandling = () => {
    const externalOptions: ReactNode[] = [
      formData.isFindPhone && (
        <div key="phone-sms" className="extra-comment-options">
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
      ),
      formData.isFindPhone && (
        <div key="phone-zalo-web" className="extra-comment-options">
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
      ),
      formData.isFindPhone && (
        <div key="phone-desktop" className="extra-comment-options">
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
      ),
      formData.isFindLinkGroupZalo && (
        <div key="zalo-link-web" className="extra-comment-options">
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
      ),
      formData.isFindLinkGroupZalo && (
        <div key="zalo-link-desktop" className="extra-comment-options">
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
      )
    ]

    const facebookOptions: ReactNode[] = [
      formData.isFindUid && (
        <div key="uid-message" className="extra-comment-options">
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
      ),
      formData.isFindPostLink && (
        <div key="post-link-comment" className="extra-comment-options">
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
      ),
      isFindDataSearchCampaign && formData.isFindFacebookGroup && (
        <div key="fb-group-join" className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundFacebookGroupJoinData}
              disabled={isDraftAutoLinkedFacebookGroupJoin}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundFacebookGroupJoinData(checked)
                if (!checked) setFormData(p => ({ ...p, findFacebookGroupJoinTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy group sang chiến dịch tham gia group</span>
          </label>
          {handleFoundFacebookGroupJoinData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderInternalCampaignPicker(
                { type: 'facebookJoinGroupTarget' },
                formData.findFacebookGroupJoinTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findFacebookGroupJoinTargetCampaignIds: ids })),
                'Chưa có chiến dịch Tham gia group để nhận group Facebook.'
              )}
            </div>
          )}
        </div>
      ),
      isFindDataSearchCampaign && formData.isFindFacebookGroup && (
        <div key="fb-group-post" className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundFacebookGroupPostData}
              disabled={isDraftAutoLinkedFacebookGroupPost}
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
      ),
      isFindDataSearchCampaign && formData.isFindFacebookGroup && (
        <div key="fb-group-comment" className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={handleFoundFacebookGroupCommentData}
              disabled={isDraftAutoLinkedFacebookGroupComment}
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
      )
    ]

    const zaloOptions: ReactNode[] = [
      formData.isFindPhone && (
        <div key="zalo-message-phone" className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={canUseZaloFeature && handleFoundPhoneZaloMessagePhoneData}
              disabled={!canUseZaloFeature}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundPhoneZaloMessagePhoneData(checked)
                if (!checked) setFormData(p => ({ ...p, findPhoneZaloMessagePhoneTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy SĐT sang chiến dịch Zalo gửi tin nhắn, kết bạn</span>
          </label>
          {!canUseZaloFeature && <div className="schedule-hint found-data-entitlement-note">{zaloEntitlementNote}</div>}
          {canUseZaloFeature && handleFoundPhoneZaloMessagePhoneData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderInternalCampaignPicker(
                { type: 'zaloMessagePhoneTarget' },
                formData.findPhoneZaloMessagePhoneTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findPhoneZaloMessagePhoneTargetCampaignIds: ids })),
                'Chưa có chiến dịch Zalo phone để nhận SĐT.'
              )}
            </div>
          )}
        </div>
      ),
      formData.isFindLinkGroupZalo && (
        <div key="zalo-link-join" className="extra-comment-options">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={canUseZaloFeature && handleFoundZaloGroupLinkJoinData}
              disabled={!canUseZaloFeature}
              onChange={e => {
                const checked = e.target.checked
                setHandleFoundZaloGroupLinkJoinData(checked)
                if (!checked) setFormData(p => ({ ...p, findZaloGroupLinkJoinTargetCampaignIds: [] }))
              }}
            />
            <span>Đẩy link group Zalo sang chiến dịch tham gia group</span>
          </label>
          {!canUseZaloFeature && <div className="schedule-hint found-data-entitlement-note">{zaloEntitlementNote}</div>}
          {canUseZaloFeature && handleFoundZaloGroupLinkJoinData && (
            <div className="stepper-form-group" style={{ marginTop: 12 }}>
              <label>Chọn chiến dịch</label>
              {renderInternalCampaignPicker(
                { type: 'zaloJoinGroupLinkTarget' },
                formData.findZaloGroupLinkJoinTargetCampaignIds || [],
                ids => setFormData(p => ({ ...p, findZaloGroupLinkJoinTargetCampaignIds: ids })),
                'Chưa có chiến dịch Zalo tham gia group để nhận link group Zalo.'
              )}
            </div>
          )}
        </div>
      )
    ]

    const dataGroupOptions: ReactNode[] = [
      formData.isFindPhone && renderFindDataGroupDestinationOption('phone'),
      formData.isFindLinkGroupZalo && renderFindDataGroupDestinationOption('zalo_group_link'),
      formData.isFindUid && renderFindDataGroupDestinationOption('facebook_uid'),
      formData.isFindPostLink && renderFindDataGroupDestinationOption('post_link'),
      isFindDataSearchCampaign && formData.isFindFacebookGroup &&
        renderFindDataGroupDestinationOption('facebook_group')
    ]

    return (
      <div className="found-data-handling-groups">
        {renderFoundDataHandlingGroup('Hệ thống ngoài (akaBiz)', externalOptions)}
        {renderFoundDataHandlingGroup('Chiến dịch Facebook', facebookOptions)}
        {renderFoundDataHandlingGroup('Chiến dịch Zalo', zaloOptions)}
        {renderFoundDataHandlingGroup('Nhóm data', dataGroupOptions)}
      </div>
    )
  }

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
              onChange={() => {
                setIsPostBumpAccountDropdownOpen(false)
                setFormData(p => ({ ...p, postBumpMode: 'select' }))
              }}
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
          <div
            className="stepper-form-group"
            ref={postBumpAccountDropdownRef}
            onKeyDown={event => {
              if (event.key === 'Escape') setIsPostBumpAccountDropdownOpen(false)
            }}
          >
            <label>Chọn tài khoản tạo chiến dịch up tin</label>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="stepper-input"
                aria-expanded={isPostBumpAccountDropdownOpen}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  backgroundColor: isPostBumpAccountDropdownOpen ? 'var(--bg-secondary)' : 'var(--bg-primary)'
                }}
                onClick={() => setIsPostBumpAccountDropdownOpen(current => !current)}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {postBumpAccountDropdownLabel}
                </span>
                <ChevronDown
                  size={16}
                  style={{
                    flexShrink: 0,
                    transform: isPostBumpAccountDropdownOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s'
                  }}
                />
              </button>

              {isPostBumpAccountDropdownOpen && (
                <div className="account-select-menu">
                  <div className="account-checkbox-list" role="group" aria-label="Tài khoản tạo chiến dịch up tin">
                    {selectableAccounts.map(account => (
                      <label key={account.id} className="account-checkbox-option" title={account.name}>
                        <input
                          type="checkbox"
                          checked={selectedPostBumpAccountIdsSet.has(account.id)}
                          onChange={() => togglePostBumpAccount(account.id)}
                        />
                        <span>
                          {account.name} <span style={{ color: 'var(--text-tertiary)' }}>({account.flatformType})</span>
                        </span>
                      </label>
                    ))}
                    {selectableAccounts.length === 0 && (
                      <div className="text-muted" style={{ fontSize: 13, textAlign: 'center', padding: '8px 0' }}>
                        Chưa có tài khoản Facebook nào.
                      </div>
                    )}
                  </div>
                </div>
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
    const dailyLimitCap = getActionDailyLimitCap(actionCode)
    const hasSavedRateLimitMinutes = Boolean(campaign?.id || cloneFromId)
    const hasEditedRateLimitMinutes = hasSavedRateLimitMinutes || editedRateLimitMinuteActions[actionCode]
    const defaultRateLimitMinutes = selectedRateLimitMinuteValues.length === 1
      ? selectedRateLimitMinuteValues[0]
      : normalizeRateLimitMinutes(formData.rateLimitMinutes)
    const actionRateLimitMinutes = hasEditedRateLimitMinutes
      ? normalizeRateLimitMinutes(limit.rateLimitMinutes)
      : defaultRateLimitMinutes
    const actionRateLimitMinutesLabel = hasEditedRateLimitMinutes || selectedRateLimitMinuteValues.length === 1
      ? String(actionRateLimitMinutes)
      : rateLimitMinutesLabel
    const isRateLimitMinuteEditorOpen = expandedRateLimitMinuteActions[actionCode] === true
    const actionLimitUnit = getActionLimitUnit(actionCode)

    return (
      <div className="action-limit-card" key={actionCode}>
        <div className="action-limit-card-header">
          <strong>Giới hạn {getActionCodeLabel(actionCode)}</strong>
        </div>
        <div className="stepper-form-row">
          <div className="stepper-form-group third">
            <label>Giới hạn trong ngày (đến 24h)</label>
            <div className="stepper-input-unit-wrap">
              <input
                type="number"
                max={dailyLimitCap ?? undefined}
                value={limit.dailyLimit}
                onChange={e => updateActionLimit(actionCode, 'dailyLimit', parseInt(e.target.value) || 0)}
                className="stepper-input stepper-input-with-unit"
              />
              <span className="stepper-input-unit">{actionLimitUnit}</span>
            </div>
          </div>
          <div className="stepper-form-group third action-limit-hour-group">
            <div className="action-limit-hour-label-row">
              <label>Giới hạn trong giờ ({actionRateLimitMinutesLabel} phút)</label>
              <button
                type="button"
                className="action-limit-minute-toggle"
                onClick={() => setExpandedRateLimitMinuteActions(prev => ({
                  ...prev,
                  [actionCode]: !prev[actionCode]
                }))}
              >
                Đổi số phút/giờ
              </button>
            </div>
            <div className="stepper-input-unit-wrap">
              <input
                type="number"
                value={limit.rateLimitCount}
                onChange={e => updateActionLimit(actionCode, 'rateLimitCount', parseInt(e.target.value) || 0)}
                className="stepper-input stepper-input-with-unit"
              />
              <span className="stepper-input-unit">{actionLimitUnit}</span>
            </div>
          </div>
          <div className={`stepper-form-group third action-limit-minute-field${isRateLimitMinuteEditorOpen ? '' : ' is-hidden'}`}>
            <label>Trong số phút:</label>
            <div className="stepper-input-unit-wrap">
              <input
                type="number"
                min={1}
                value={actionRateLimitMinutes}
                onChange={e => updateActionLimit(actionCode, 'rateLimitMinutes', parseInt(e.target.value) || 0)}
                className="stepper-input stepper-input-with-unit"
                disabled={!isRateLimitMinuteEditorOpen}
              />
              <span className="stepper-input-unit">phút</span>
            </div>
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

          {renderImagePicker('comment', 'Media comment')}
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
            onChange={e => {
              if (!e.target.checked) setIsPostBumpAccountDropdownOpen(false)
              setFormData(p => ({ ...p, enablePostBump: e.target.checked }))
            }}
          />
          <span>Kiêm up tin</span>
        </label>
      </div>

      {formData.enablePostBump && renderPostBumpSettings()}
    </div>
  )

  const renderCampaignContentHint = () => (
    <div className="campaign-content-hint">
      Mẹo: dấu <code>|</code> ngoài cùng tách nhiều nội dung; dùng <code>{'{a|b|c}'}</code> để spin ngẫu nhiên trong một câu.
    </div>
  )

  const renderSmsContentMeta = (showCounts = true) => {
    if (isVoiceCallCampaign) {
      return (
        <div className="sms-content-meta">
          <div className="schedule-hint">
            <strong>Thông báo bắt buộc:</strong> “{VOICE_CALL_AI_DISCLOSURE}” sẽ được hệ thống tự thêm trước nội dung và không thể tắt.
          </div>
          <div className="schedule-hint" style={{ marginTop: 6 }}>
            Thiết bị đã chứng nhận sẽ nhận biết lúc bắt máy; thiết bị khác tự phát sau 15 giây. Audio TTS tối đa 90 giây và mỗi SĐT chỉ gọi một lần.
          </div>
        </div>
      )
    }
    if (!isSmsCampaign) return null

    return (
      <div className="sms-content-meta">
        {showCounts && (
          <div className="sms-content-counts">
            {smsContentCountLabels.map((label, index) => (
              <span key={`${index}:${label}`} className="sms-content-count-chip">{label}</span>
            ))}
          </div>
        )}
        <div className="sms-content-options">
          <label className="schedule-checkbox-label sms-content-option">
            <input
              type="checkbox"
              checked={formData.smsUseUnicode}
              onChange={e => setFormData(p => ({ ...p, smsUseUnicode: e.target.checked }))}
            />
            <span>Tiếng Việt có dấu</span>
          </label>
          <label className="schedule-checkbox-label sms-content-option">
            <input
              type="checkbox"
              checked={formData.smsKeepNewLines}
              onChange={e => setFormData(p => ({ ...p, smsKeepNewLines: e.target.checked }))}
            />
            <span>Không loại bỏ xuống dòng</span>
          </label>
        </div>
      </div>
    )
  }

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

  const renderZaloOptOutLinkOption = () => {
    if (!supportsZaloOptOutLink) return null
    return (
      <div className="stepper-form-group campaign-zalo-opt-out-option">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.zaloOptOutLinkEnabled}
            onChange={e => setFormData(current => ({
              ...current,
              zaloOptOutLinkEnabled: e.target.checked
            }))}
          />
          <span>Thêm link từ chối nhận tin nhắn</span>
        </label>
        <div className="schedule-hint" style={{ marginTop: 6 }}>
          Hệ thống chỉ thêm link khi lấy được Zalo global ID của người nhận.
        </div>
      </div>
    )
  }

  const renderFormattedContentOption = () => {
    if (!canUseFormattedContent) return null
    return (
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={isAdvancedGroupSource
              ? groupSnapshotEffectiveRich
              : isFormattedContentEnabled}
            disabled={isAdvancedGroupSource}
            onChange={e => setFormattedContentEnabled(e.target.checked)}
          />
          <span>Nội dung có định dạng</span>
        </label>
        {isFormattedContentEnabled && !isAdvancedContentMode && (
          <div className="schedule-hint" style={{ marginTop: 6 }}>
            Dấu | phân tách các nội dung gửi luân phiên. Nhập \| nếu muốn hiển thị dấu |.
          </div>
        )}
      </div>
    )
  }

  const renderEmailBodyHtmlOption = () => {
    if (!isEmailCampaign) return null
    return (
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={isAdvancedGroupSource
              ? groupSnapshotEffectiveRich
              : formData.emailBodyIsHtml}
            disabled={isAdvancedGroupSource}
            onChange={e => {
              const checked = e.target.checked
              if (!checked) normalizeManualAdvancedContentItemsToPlain()
              setFormData(current => checked
                ? {
                    ...current,
                    emailBodyIsHtml: true,
                    rewriteContentEachRun: false
                  }
                : convertFormattedStateToPlain(current))
            }}
          />
          <span>Nội dung dạng HTML</span>
        </label>
      </div>
    )
  }

  const setPostBackgroundEnabled = (checked: boolean) => {
    const apply = () => {
      if (checked && formData.formattedContentEnabled) {
        normalizeManualAdvancedContentItemsToPlain()
      }
      setFormData(current => {
        const compatibleState = checked && current.formattedContentEnabled
          ? convertFormattedStateToPlain(current)
          : current
        return {
          ...compatibleState,
          postWithBackground: checked
        }
      })
    }
    if (checked && (isFormattedContentEnabled || groupSnapshotSaveEffectiveRich)) {
      showConfirm(
        'Đăng bài với phông nền không hỗ trợ nội dung có định dạng. Nội dung sẽ được chuyển sang văn bản thường.',
        apply,
        { title: 'Chuyển sang nội dung thường', confirmText: 'Chuyển và bật', variant: 'primary' }
      )
      return
    }
    apply()
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
          <span>Đăng bài với phông nền <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(tối đa 130 ký tự, 3 dòng và KHÔNG gửi media)</em></span>
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
    if (!isMultiDailyTimeSlotsCampaign || isDataGroupSource) return null

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

  const getCampaignContentLabel = (): string => {
    if (isEmailCampaign) return formData.emailBodyIsHtml ? 'Nội dung HTML' : 'Nội dung email'
    if (isVoiceCallCampaign) return 'Nội dung cuộc gọi tự động'
    if (isFormattedContentEnabled) return 'Nội dung có định dạng'
    if (isMessageCampaign) return 'Nội dung tin nhắn'
    return 'Nội dung chiến dịch'
  }

  const getCampaignContentPlaceholder = (): string => {
    if (isEmailCampaign) {
      return 'Nhập nội dung email. Dùng dấu | để tách nhiều nội dung — nội dung 1 chạy ở email 1, nội dung 2 ở email 2...'
    }
    if (isVoiceCallCampaign) {
      return 'Nhập nội dung sẽ được chuyển thành giọng nói. Dùng dấu | để luân phiên nội dung và token để cá nhân hoá từng người nhận.'
    }
    if (isMessageCampaign) {
      return 'Nhập nội dung tin nhắn. Dùng dấu | để tách nhiều nội dung — nội dung 1 chạy ở mục tiêu 1, nội dung 2 ở mục tiêu 2...'
    }
    return 'Nhập nội dung chiến dịch ở đây. Dùng dấu | để tách nhiều nội dung — nội dung 1 chạy ở mục tiêu 1, nội dung 2 ở mục tiêu 2...'
  }

  const renderCampaignContentTextarea = (showHint = true) => (
    <>
      {isRichContentEditorEnabled ? (
        <EmailHtmlEditor
          value={formData.content}
          onChange={html => setFormData(p => ({ ...p, content: html }))}
          editorRef={emailHtmlEditorRef}
          onFocus={editor => {
            activeRichContentEditorRef.current = { itemId: null, editor }
          }}
        />
      ) : (
        <textarea
          ref={campaignContentTextareaRef}
          className={`stepper-textarea ${isMessageCampaign ? 'message-content-textarea' : ''}`}
          placeholder={getCampaignContentPlaceholder()}
          value={formData.content}
          onChange={e => setFormData(p => ({ ...p, content: e.target.value }))}
          rows={8}
        />
      )}
      {showHint && renderSmsContentMeta()}
      {showHint && !isRichContentEditorEnabled && renderCampaignContentHint()}
      {showHint && !isMobileManagedSmsCampaign && !isFacebookJoinGroupCampaign && !isRichContentEditorEnabled && renderRewriteContentEachRunOption()}
    </>
  )

  const setAdvancedContentItem = (itemId: string, patch: Partial<CampaignAdvancedContentItem>) => {
    if (isCommentSeedingCampaign && patch.mediaOption === 'all') {
      const currentItem = formData.advancedContentItems.find(item => item.id === itemId)
      const mediaItems = patch.mediaItems || currentItem?.mediaItems || []
      if (mediaItems.length > 1) {
        showAlert('Chế độ "Gửi media đã chọn" chỉ dùng tối đa 1 ảnh hoặc video cho mỗi comment. Vui lòng xoá bớt còn 1 media hoặc tiếp tục dùng chế độ ngẫu nhiên.', 'info')
        return
      }
    }
    if (isReelsMediaMode && patch.mediaOption === 'all') {
      const currentItem = formData.advancedContentItems.find(item => item.id === itemId)
      const mediaItems = patch.mediaItems || currentItem?.mediaItems || []
      if (mediaItems.length > 1) {
        showAlert('Chế độ "Đăng video đã chọn" chỉ dùng đúng 1 video cho mỗi lượt. Vui lòng xoá bớt còn 1 video hoặc tiếp tục dùng chế độ ngẫu nhiên.', 'info')
        return
      }
    }
    const normalizedPatch = isCommentSeedingCampaign
      ? { ...patch, randomMediaCount: 1 }
      : patch
    setFormData(prev => ({
      ...prev,
      advancedContentItems: (() => {
        const nextItems = prev.advancedContentItems.map(item => (
          item.id === itemId ? { ...item, ...normalizedPatch } : item
        ))
        manualAdvancedContentItemsRef.current = nextItems
        return nextItems
      })()
    }))
  }

  const addAdvancedContentItem = () => {
    if (isSmsCampaign && formData.advancedContentItems.length >= MAX_SMS_ADVANCED_CONTENT_ITEMS) {
      showAlert(`Nội dung nâng cao SMS chỉ được tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} mục.`, 'error')
      return
    }
    const nextItem = createAdvancedContentItem({
      ...(isEmailCampaign ? { emailSubject: formData.emailSubject } : {}),
      ...(isCommentSeedingCampaign ? { randomMediaCount: 1 } : {})
    })
    setManualAdvancedContentSelectedId(nextItem.id)
    setFormData(prev => {
      const nextItems = [
        ...prev.advancedContentItems,
        nextItem
      ]
      manualAdvancedContentItemsRef.current = nextItems
      return { ...prev, advancedContentItems: nextItems }
    })
  }

  const duplicateAdvancedContentItem = (item: CampaignAdvancedContentItem) => {
    if (isSmsCampaign && formData.advancedContentItems.length >= MAX_SMS_ADVANCED_CONTENT_ITEMS) {
      showAlert(`Nội dung nâng cao SMS chỉ được tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} mục.`, 'error')
      return
    }
    const duplicateItem = createAdvancedContentItem({
      content: item.content,
      mediaOption: item.mediaOption || 'none',
      mediaItems: [...(item.mediaItems || [])],
      randomMediaCount: isCommentSeedingCampaign ? 1 : (item.randomMediaCount || 3),
      emailSubject: item.emailSubject
    })
    setManualAdvancedContentSelectedId(duplicateItem.id)
    setFormData(prev => {
      const nextItems = [
        ...prev.advancedContentItems,
        duplicateItem
      ]
      manualAdvancedContentItemsRef.current = nextItems
      return { ...prev, advancedContentItems: nextItems }
    })
  }

  const removeAdvancedContentItem = (itemId: string) => {
    delete advancedContentEditorRefs.current[itemId]
    delete advancedContentTextareaRefs.current[itemId]
    if (activeRichContentEditorRef.current?.itemId === itemId) activeRichContentEditorRef.current = null
    if (manualAdvancedContentSelectedId === itemId) {
      const currentIndex = formData.advancedContentItems.findIndex(item => item.id === itemId)
      const remainingItems = formData.advancedContentItems.filter(item => item.id !== itemId)
      setManualAdvancedContentSelectedId(
        remainingItems[Math.min(Math.max(0, currentIndex), remainingItems.length - 1)]?.id ?? null
      )
    }
    setFormData(prev => {
      const nextItems = prev.advancedContentItems.filter(item => item.id !== itemId)
      manualAdvancedContentItemsRef.current = nextItems
      return { ...prev, advancedContentItems: nextItems }
    })
  }

  const removeAdvancedContentMedia = (itemId: string, mediaIndex: number) => {
    setFormData(prev => {
      const nextItems = prev.advancedContentItems.map(item => (
        item.id === itemId
          ? { ...item, mediaItems: (item.mediaItems || []).filter((_, index) => index !== mediaIndex) }
          : item
      ))
      manualAdvancedContentItemsRef.current = nextItems
      return { ...prev, advancedContentItems: nextItems }
    })
  }

  const closeManualAdvancedContentModal = () => {
    setManualAdvancedContentModalOpen(false)
    setManualAdvancedTemplatePickerOpen(false)
    setManualAdvancedPickedVariants([])
    manualAdvancedTemplatePickerReturnFocusRef.current = null
    if (activeRichContentEditorRef.current?.itemId) activeRichContentEditorRef.current = null
    window.requestAnimationFrame(() => manualAdvancedContentTriggerRef.current?.focus())
  }

  const openManualAdvancedContentModal = () => {
    const selectedExists = manualAdvancedContentSelectedId && formData.advancedContentItems.some(item => (
      item.id === manualAdvancedContentSelectedId
    ))
    if (!selectedExists) setManualAdvancedContentSelectedId(formData.advancedContentItems[0]?.id ?? null)
    setManualAdvancedContentModalOpen(true)
  }

  const openManualAdvancedTemplatePicker = () => {
    manualAdvancedTemplatePickerReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setManualAdvancedPickedVariants([])
    setManualAdvancedTemplatePickerOpen(true)
    if (contentTemplates.length === 0) void loadContentTemplates()
  }

  const closeManualAdvancedTemplatePicker = () => {
    setManualAdvancedTemplatePickerOpen(false)
    setManualAdvancedPickedVariants([])
    const returnFocusTarget = manualAdvancedTemplatePickerReturnFocusRef.current
    manualAdvancedTemplatePickerReturnFocusRef.current = null
    window.requestAnimationFrame(() => returnFocusTarget?.focus())
  }

  const insertAdvancedContentSnippet = (item: CampaignAdvancedContentItem, snippet: string) => {
    const richEditor = advancedContentEditorRefs.current[item.id]
    if (richEditor) {
      richEditor.chain().focus().insertContent(snippet).run()
      return
    }

    const textarea = advancedContentTextareaRefs.current[item.id]
    const selectionStart = textarea?.selectionStart ?? item.content.length
    const selectionEnd = textarea?.selectionEnd ?? selectionStart
    const spacer = selectionStart > 0 && !/\s$/.test(item.content.slice(0, selectionStart)) ? ' ' : ''
    const inserted = `${spacer}${snippet}`
    const nextContent = `${item.content.slice(0, selectionStart)}${inserted}${item.content.slice(selectionEnd)}`
    setAdvancedContentItem(item.id, { content: nextContent })
    window.requestAnimationFrame(() => {
      const nextTextarea = advancedContentTextareaRefs.current[item.id]
      if (!nextTextarea) return
      const nextCursor = selectionStart + inserted.length
      nextTextarea.focus()
      nextTextarea.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const switchToSimpleContentMode = () => {
    setManualAdvancedContentModalOpen(false)
    setContentSettingsTab('content')
    setAdvancedContentSourceMode('manual')
    setPendingContentTemplateGroupId(null)
    setFormData(current => ({
      ...current,
      advancedContentEnabled: false,
      // Never copy immutable group snapshot items into the separate
      // Basic/manual draft when changing modes.
      advancedContentItems: manualAdvancedContentItemsRef.current
    }))
  }

  const switchToManualAdvancedContentMode = () => {
    setContentSettingsTab('content')
    setPendingContentTemplateGroupId(null)
    setAdvancedContentSourceMode('manual')
    setFormData(prev => ({
      ...prev,
      advancedContentEnabled: true,
      // The immutable group snapshot is deliberately not copied into Manual.
      advancedContentItems: manualAdvancedContentItemsRef.current
    }))
  }

  const switchToDataGroupContentMode = () => {
    manualAdvancedContentItemsRef.current = normalizeAdvancedContentItems(formData.advancedContentItems)
    setManualAdvancedContentModalOpen(false)
    setContentSettingsTab('content')
    setAdvancedContentSourceMode('group')
    const nextGroupId = candidateContentTemplateGroupId ?? savedAdvancedGroupSnapshot?.groupId ?? null
    setCandidateContentTemplateGroupId(nextGroupId)
    setPendingContentTemplateGroupId(
      nextGroupId !== null && (
        !savedAdvancedGroupSnapshot ||
        savedAdvancedGroupSnapshot.groupId !== nextGroupId ||
        !savedGroupSnapshotMatchesTargetChannel
      )
        ? nextGroupId
        : null
    )
    setFormData(prev => ({ ...prev, advancedContentEnabled: true }))
  }

  const switchToSourceContentTab = () => {
    setManualAdvancedContentModalOpen(false)
    setContentSettingsTab('source')
  }

  const closeContentTemplateGroupPreview = () => {
    setPreviewContentTemplateGroupId(null)
    setPreviewContentTemplateId(null)
    setPreviewContentTemplateChannel(null)
  }

  const openContentTemplateGroupPreview = (groupId: number) => {
    const groupTemplates = contentTemplates.filter(template => template.groupId === groupId && !template.isDelete)
    const initialTemplate = advancedContentTargetChannel
      ? groupTemplates.find(template => resolveContentTemplate(template, advancedContentTargetChannel).variants.length > 0) || groupTemplates[0] || null
      : groupTemplates[0] || null
    setPreviewContentTemplateGroupId(groupId)
    setPreviewContentTemplateId(initialTemplate?.id ?? null)
    setPreviewContentTemplateChannel(getInitialContentTemplatePreviewChannel(initialTemplate, advancedContentTargetChannel))
  }

  const openContentTemplateGroupPicker = () => {
    setContentTemplateGroupSearch('')
    setContentTemplateGroupStatus('all')
    const initialGroup = contentTemplateGroups.find(group => group.id === candidateContentTemplateGroupId && !group.isDelete)
      || contentTemplateGroups.find(group => group.isActive && !group.isDelete)
      || contentTemplateGroups.find(group => !group.isDelete)
    if (initialGroup) {
      openContentTemplateGroupPreview(initialGroup.id)
      return
    }
    if (advancedContentTargetChannel) openContentTemplateManager(advancedContentTargetChannel)
  }

  const clearCandidateContentTemplateGroup = () => {
    setCandidateContentTemplateGroupId(null)
    setPendingContentTemplateGroupId(null)
    closeContentTemplateGroupPreview()
  }

  const renderAdvancedContentSourceSelector = () => {
    const channel = advancedContentTargetChannel
    const candidate = contentTemplateGroupCandidate
    const isInactiveCandidate = candidateContentTemplateGroup?.isActive === false
    const hasZeroCompatibleItems = !!candidate && candidate.variantCount === 0
    const exceedsSmsSnapshotLimit = isSmsCampaign && !!candidate && candidate.variantCount > MAX_SMS_ADVANCED_CONTENT_ITEMS
    const candidateCanBeUsed = !!candidate && !isInactiveCandidate && !hasZeroCompatibleItems && !exceedsSmsSnapshotLimit
    const isPendingCandidate = candidateCanBeUsed &&
      selectedContentTemplateGroupId === candidate.groupId &&
      !preserveSavedGroupSnapshotOnSave
    const pendingCandidateNeedsAttention = !!candidate &&
      !candidateCanBeUsed &&
      selectedContentTemplateGroupId === candidate.groupId &&
      !preserveSavedGroupSnapshotOnSave
    const isSavedCandidate = !!candidate &&
      preserveSavedGroupSnapshotOnSave &&
      savedAdvancedGroupSnapshot?.groupId === candidate.groupId

    const warning = isInactiveCandidate
      ? 'Nhóm này đã ngừng hoạt động nên không thể tạo hoặc cập nhật snapshot mới. Snapshot đã lưu trước đó (nếu có) vẫn dùng được.'
      : hasZeroCompatibleItems
        ? (channel
            ? `Không thể dùng nhóm này cho chiến dịch ${getAdvancedContentCampaignLabel(channel)} vì nhóm chưa có mẫu ${getContentTemplateChannelLabel(channel)}.`
            : 'Không thể dùng nhóm này cho chiến dịch hiện tại vì nhóm chưa có mẫu phù hợp.')
        : exceedsSmsSnapshotLimit
          ? `Nhóm có ${candidate?.variantCount || 0} nội dung SMS, vượt giới hạn ${MAX_SMS_ADVANCED_CONTENT_ITEMS} của chiến dịch SMS. Hãy giảm số biến thể trước khi dùng.`
          : null

    return (
      <div className="campaign-advanced-content-source">
        <div className="campaign-advanced-source-card">
          <div className="campaign-advanced-source-card-header">
            <span className="campaign-advanced-source-card-icon"><FolderOpen size={17} /></span>
            <div className="campaign-advanced-source-card-copy">
              <strong>Nhóm mẫu nội dung</strong>
              <span>Chọn nhóm mẫu có sẵn để tạo snapshot nội dung cho chiến dịch.</span>
            </div>
          </div>

          <div className="campaign-advanced-source-card-body">
            {advancedContentSourceMode === 'group' ? (
              <div className="campaign-advanced-group-picker">
                <label>Chọn nhóm mẫu cho {channel ? getContentTemplateChannelLabel(channel) : 'hành động đã chọn'} <span className="required">*</span></label>
                <div className="campaign-advanced-group-picker-row">
                  <div className="campaign-advanced-group-select-wrap">
                    <button
                      type="button"
                      className="campaign-advanced-group-select"
                      aria-label={`Chọn nhóm mẫu cho ${channel ? getContentTemplateChannelLabel(channel) : 'hành động đã chọn'}`}
                      onClick={openContentTemplateGroupPicker}
                      disabled={contentTemplatesLoading}
                    >
                      {candidate ? `${candidate.groupName} · ${candidate.compatibleTemplateCount} mẫu phù hợp` : '— Chọn một nhóm mẫu —'}
                    </button>
                    <ChevronDown size={17} aria-hidden="true" />
                  </div>
                  <button
                    type="button"
                    className="btn-icon content-template-picker-refresh campaign-advanced-group-refresh"
                    onClick={() => void loadContentTemplates()}
                    disabled={contentTemplatesLoading}
                    title="Tải lại nhóm và mẫu"
                    aria-label="Tải lại nhóm và mẫu"
                  >
                    <RefreshCw size={15} className={contentTemplatesLoading ? 'spin' : ''} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost campaign-advanced-group-row-action"
                    onClick={openContentTemplateGroupPicker}
                    disabled={contentTemplatesLoading || contentTemplateGroups.filter(group => !group.isDelete).length === 0}
                  >
                    <FolderOpen size={16} /> Chọn nhóm
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost campaign-advanced-group-manage"
                    onClick={() => channel && openContentTemplateManager(channel)}
                    disabled={!onOpenContentTemplates}
                  >
                    <Plus size={16} /> Tạo / quản lý nhóm mẫu
                  </button>
                </div>

                {preserveSavedGroupSnapshotOnSave && savedAdvancedGroupSnapshot && (
                  <div className="campaign-advanced-saved-snapshot">
                    <Check size={14} />
                    <span>Snapshot đang dùng: <strong>{savedAdvancedGroupSnapshot.groupName}</strong> · {savedAdvancedGroupSnapshot.templateCount} mẫu · {savedAdvancedGroupSnapshot.itemCount} nội dung · {new Date(savedAdvancedGroupSnapshot.capturedAt).toLocaleString('vi-VN')}</span>
                  </div>
                )}

                {candidate ? (
                  <div className={`campaign-advanced-group-summary${warning ? ' has-warning' : ''}`}>
                    <div className="campaign-advanced-group-summary-header">
                      <span className="campaign-advanced-group-summary-icon"><FolderOpen size={20} /></span>
                      <div className="campaign-advanced-group-summary-copy">
                        <div className="campaign-advanced-group-summary-title">
                          <strong>{candidate.groupName}</strong>
                        </div>
                        <div>{candidate.totalTemplateCount} mẫu · {candidate.variantCount} biến thể phù hợp</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openContentTemplateGroupPreview(candidate.groupId)}
                      >
                        <Eye size={14} /> Xem nội dung
                      </button>
                    </div>

                    <div className="campaign-advanced-group-badges">
                      <span className={`content-template-picker-channel-badge ${channel || ''}`}>
                        {channel ? getContentTemplateChannelLabel(channel) : 'Kênh phù hợp'}
                      </span>
                      <span>{candidate.compatibleTemplateCount}/{candidate.totalTemplateCount} {candidateCanBeUsed ? 'mẫu sẽ dùng' : 'mẫu phù hợp'}</span>
                      <span>{candidate.variantCount} biến thể</span>
                      {candidate.skippedTemplateCount > 0 && <span>Bỏ qua {candidate.skippedTemplateCount} mẫu</span>}
                      {isPendingCandidate && <span className="active">Đã chọn</span>}
                      {pendingCandidateNeedsAttention && <span className="error">Cần xử lý trước khi lưu</span>}
                      {!isPendingCandidate && isSavedCandidate && <span className="active">Snapshot hiện tại</span>}
                    </div>

                    <div className={`campaign-advanced-group-summary-detail${warning ? ' error' : ''}`}>
                      {warning ? <X size={16} /> : <Check size={16} />}
                      <span>
                        {candidateCanBeUsed
                          ? `Dùng ${candidate.compatibleTemplateCount}/${candidate.totalTemplateCount} mẫu · ${candidate.variantCount} biến thể · bỏ qua ${candidate.skippedTemplateCount} mẫu không có ${channel ? getContentTemplateChannelLabel(channel) : 'kênh phù hợp'}${candidate.skippedVariantCount > 0 ? ` · ${candidate.skippedVariantCount} biến thể rỗng` : ''}${candidate.invalidMediaCount > 0 ? ` · ${candidate.invalidMediaCount} media không nhận diện được hoặc không phù hợp` : ''}.`
                          : 'Không thể dùng nhóm này ở trạng thái hiện tại. Xem lý do và cách xử lý bên dưới.'}
                      </span>
                    </div>

                    {warning && <div className="campaign-advanced-group-warning">{warning}</div>}
                  </div>
                ) : !contentTemplatesLoading && contentTemplateGroups.length === 0 ? (
                  <div className="campaign-advanced-group-empty">
                    <span>Chưa có nhóm mẫu nào.</span>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => channel && openContentTemplateManager(channel)} disabled={!onOpenContentTemplates}>
                      <FileText size={14} /> Mở kho mẫu nội dung
                    </button>
                  </div>
                ) : (
                  <div className="campaign-advanced-group-empty">
                    Chọn một nhóm trong thư viện để xem mức độ phù hợp trước khi áp dụng.
                  </div>
                )}
              </div>
            ) : (
              <div className="campaign-advanced-source-manual-note">
                Nội dung thủ công được giữ riêng với snapshot nhóm mẫu. Chuyển nguồn không sao chép hoặc xoá nội dung của nguồn còn lại.
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderContentModeSegmented = () => {
    if (!canUseAdvancedContentMode && !supportsSourceContent) return null

    const isBasicMode = !isSourceContentMode && !formData.advancedContentEnabled
    const isManualAdvancedMode = !isSourceContentMode && formData.advancedContentEnabled && advancedContentSourceMode === 'manual'
    const isDataGroupMode = !isSourceContentMode && formData.advancedContentEnabled && advancedContentSourceMode === 'group'
    const note = isSourceContentMode
      ? 'Chỉ dùng nội dung từ bài viết nguồn; có thể lấy kèm hình ảnh hoặc đăng bài bằng cách chia sẻ.'
      : isManualAdvancedMode
        ? isSmsCampaign
          ? 'Tạo nhiều nội dung SMS thủ công, mỗi nội dung là một biến thể hoàn chỉnh.'
          : 'Tạo nhiều nội dung thủ công, mỗi nội dung là một biến thể hoàn chỉnh với media riêng.'
        : isDataGroupMode
          ? 'Dùng snapshot từ một nhóm mẫu có sẵn. Mỗi lượt chạy sẽ xoay vòng qua các nội dung phù hợp trong nhóm.'
          : isRichContentEditorEnabled
            ? 'Dùng dấu | để phân tách các nội dung có định dạng gửi luân phiên. Nhập \\| nếu muốn hiển thị dấu |.'
            : isSmsCampaign
              ? 'Dùng một nội dung SMS cho chiến dịch. Có thể nhập nhiều biến thể bằng dấu | để xoay vòng khi gửi.'
              : 'Dùng một nội dung và bộ media chung cho chiến dịch. Có thể nhập nhiều biến thể bằng dấu |. Mỗi lượt chạy sẽ xoay vòng qua các biến thể.'

    return (
      <div className="campaign-content-mode-row">
        <div className="campaign-content-mode-segmented" role="group" aria-label="Chế độ nội dung">
          <button
            type="button"
            aria-pressed={isBasicMode}
            className={isBasicMode ? 'active' : ''}
            onClick={switchToSimpleContentMode}
          >
            Cơ bản
          </button>
          {canUseAdvancedContentMode && (
            <button
              type="button"
              aria-pressed={isManualAdvancedMode}
              className={isManualAdvancedMode ? 'active' : ''}
              onClick={switchToManualAdvancedContentMode}
            >
              Nâng cao
            </button>
          )}
          {canUseAdvancedContentMode && (
            <button
              type="button"
              aria-pressed={isDataGroupMode}
              className={isDataGroupMode ? 'active' : ''}
              onClick={switchToDataGroupContentMode}
            >
              Nhóm mẫu nội dung
            </button>
          )}
          {supportsSourceContent && (
            <button
              type="button"
              aria-pressed={isSourceContentMode}
              className={isSourceContentMode ? 'active' : ''}
              onClick={switchToSourceContentTab}
            >
              Copy nguồn nội dung
            </button>
          )}
        </div>
        <div className="campaign-content-mode-note">{note}</div>
      </div>
    )
  }

  const renderAdvancedContentItemMedia = (item: CampaignAdvancedContentItem) => {
    if (isMobileManagedSmsCampaign) return null

    const mediaItems = item.mediaItems || []
    const mediaOption = item.mediaOption || 'none'
    const mediaBlocked = isPostBackgroundActive
    const randomMediaCount = isCommentSeedingCampaign ? 1 : (item.randomMediaCount || 3)
    const radioName = `advanced-media-${item.id}`
    const isFileMedia = isZaloMessageCampaign || isEmailCampaign
    const mediaSelectionMode = getMediaSelectionMode({ kind: 'advanced', itemId: item.id })
    const isFacebookImageVideoMedia = mediaSelectionMode === 'image-video'
    const isVideoOnlyMedia = mediaSelectionMode === 'video'
    const mediaTitle = isCommentSeedingCampaign ? 'Kho ảnh/video đã chọn' : isEmailCampaign ? 'Tệp đính kèm đã chọn' : isZaloMessageCampaign ? 'File đã chọn' : isVideoOnlyMedia ? 'Video đã chọn' : isFacebookImageVideoMedia ? 'Ảnh/video đã chọn' : 'Ảnh đã chọn'

    return (
      <div className={`campaign-advanced-media-panel${mediaBlocked ? ' is-blocked' : ''}`}>
        {mediaBlocked && (
          <div className="schedule-hint campaign-advanced-media-blocked-hint">
            Đăng bài với phông nền không gửi kèm media. Các media đã chọn vẫn được giữ lại khi bạn tắt phông nền.
          </div>
        )}
        {isCommentSeedingCampaign && (
          <div className="schedule-hint">Mỗi comment gửi tối đa 1 ảnh hoặc video. Chế độ gửi media đã chọn dùng 1 media; chế độ ngẫu nhiên chọn 1 media từ kho.</div>
        )}
        <div className="campaign-advanced-media-layout">
          <div className="campaign-advanced-media-options">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setMediaPickerTarget({ kind: 'advanced', itemId: item.id })}
                disabled={mediaBlocked || mediaOption === 'none'}
              >
                <Image size={14} />
                <span>Chọn từ Media</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openLocalMediaPicker({ kind: 'advanced', itemId: item.id })}
                disabled={mediaBlocked || mediaOption === 'none' || usesZaloServerAccount}
                title={usesZaloServerAccount ? 'Zalo Server chỉ dùng được media đã upload lên cloud' : 'Chọn file trực tiếp từ máy'}
              >
                <FolderOpen size={14} />
                <span>Chọn từ máy tính</span>
              </button>
            </div>
            <label className="schedule-radio-label">
              <input
                type="radio"
                name={radioName}
                checked={mediaOption === 'none'}
                disabled={mediaBlocked}
                onChange={() => setAdvancedContentItem(item.id, { mediaOption: 'none' })}
              />
              <span>{isEmailCampaign ? 'Không đính kèm file' : isZaloMessageCampaign ? 'Không gửi file' : isVideoOnlyMedia ? 'Không đăng video' : isFacebookImageVideoMedia ? 'Không gửi ảnh/video' : 'Không gửi ảnh'}</span>
            </label>
            <label className="schedule-radio-label">
              <input
                type="radio"
                name={radioName}
                checked={mediaOption === 'all'}
                disabled={mediaBlocked}
                onChange={() => setAdvancedContentItem(item.id, { mediaOption: 'all' })}
              />
              <span>{isCommentSeedingCampaign ? 'Gửi media đã chọn' : isEmailCampaign ? 'Đính kèm file đã chọn' : isZaloMessageCampaign ? 'Gửi file đã chọn' : isVideoOnlyMedia ? 'Đăng video đã chọn' : isFacebookImageVideoMedia ? 'Gửi ảnh/video đã chọn' : 'Gửi ảnh đã chọn'}</span>
            </label>
            <div className="campaign-advanced-random-media-row">
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={mediaOption === 'random'}
                  disabled={mediaBlocked}
                  onChange={() => setAdvancedContentItem(item.id, { mediaOption: 'random', randomMediaCount: 1 })}
                />
                <span>{isCommentSeedingCampaign ? 'Gửi ngẫu nhiên 1 ảnh/video trong các media đã chọn' : isFileMedia ? 'Gửi ngẫu nhiên số file trong file đã chọn' : isVideoOnlyMedia ? 'Đăng ngẫu nhiên 1 video trong các video đã chọn' : isFacebookImageVideoMedia ? 'Gửi ngẫu nhiên số media trong các media đã chọn' : 'Gửi ngẫu nhiên số ảnh trong ảnh đã chọn'}</span>
              </label>
              <input
                type="number"
                min={1}
                max={isCommentSeedingCampaign || isVideoOnlyMedia ? 1 : undefined}
                value={isVideoOnlyMedia ? 1 : randomMediaCount}
                onChange={event => setAdvancedContentItem(item.id, { randomMediaCount: Math.max(1, Number(event.target.value) || 1) })}
                className="stepper-input"
                disabled={mediaBlocked || isCommentSeedingCampaign || isVideoOnlyMedia || mediaOption !== 'random'}
              />
            </div>
          </div>
          <div className="campaign-advanced-media-selected">
            <div className="campaign-advanced-media-selected-title">{mediaTitle}</div>
            <div className="stepper-grid-container campaign-advanced-media-table-wrap">
              <table className="campaign-grid">
                <thead>
                  <tr>
                    <th style={{ width: 50, textAlign: 'center' }}>STT</th>
                    <th style={{ width: 44, textAlign: 'center' }}></th>
                    <th>Media</th>
                    <th style={{ width: 44, textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {mediaItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center text-muted">
                        {isFileMedia ? 'Chưa có file nào được chọn' : isVideoOnlyMedia ? 'Chưa có video nào được chọn' : isFacebookImageVideoMedia ? 'Chưa có ảnh/video nào được chọn' : 'Chưa có ảnh nào được chọn'}
                      </td>
                    </tr>
                  ) : mediaItems.map((media, mediaIndex) => {
                    const localPath = getCampaignMediaLocalPath(media)
                    const cloudUrl = getCampaignMediaCloudUrl(media)
                    const mediaTitle = [localPath, cloudUrl].filter(Boolean).join('\n') || getCampaignMediaDisplayName(media)
                    return (
                      <tr key={`advanced-${item.id}-${mediaIndex}-${getCampaignMediaStableKey(media)}`}>
                        <td className="text-center">{mediaIndex + 1}</td>
                        <td className="text-center">
                          <MediaPreviewHover
                            name={getCampaignMediaDisplayName(media)}
                            path={getCampaignMediaPreviewPath(media)}
                            mimeType={getCampaignMediaMimeType(media)}
                            sizeBytes={getCampaignMediaSizeBytes(media)}
                          />
                        </td>
                        <td className="text-truncate" title={mediaTitle}>
                          {getCampaignMediaDisplayName(media)}
                          {isCampaignMediaUsingCloudFallback(media) && (
                            <span className="media-inline-source">cloud</span>
                          )}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn-icon text-error action-btn"
                            onClick={() => removeAdvancedContentMedia(item.id, mediaIndex)}
                            disabled={mediaBlocked}
                            title="Xóa media"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderAdvancedContentEditor = () => {
    if (advancedContentSourceMode === 'group') {
      return (
        <div className="campaign-advanced-content-editor">
          {renderAdvancedContentSourceSelector()}
        </div>
      )
    }

    const items = formData.advancedContentItems

    return (
      <div className="campaign-advanced-content-editor">
        <div className="campaign-manual-content-launcher">
          <div className="campaign-manual-content-launcher-copy">
            <span className="campaign-manual-content-launcher-icon"><Edit3 size={18} /></span>
            <div>
              <strong>Nội dung nâng cao</strong>
              <span>
                {items.length > 0
                  ? `Đã thêm ${items.length} nội dung. Mở modal để thêm hoặc chỉnh sửa biến thể.`
                  : isSmsCampaign
                    ? 'Thêm các biến thể nội dung SMS riêng trong modal.'
                    : 'Thêm các biến thể nội dung và media riêng trong modal.'}
              </span>
            </div>
          </div>
          <div className="campaign-manual-content-launcher-actions">
            {items.length > 0 && (
              <span className="campaign-advanced-content-count">{items.length} nội dung</span>
            )}
            <button
              ref={manualAdvancedContentTriggerRef}
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openManualAdvancedContentModal}
            >
              <Plus size={14} />
              <span>Thêm nội dung</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  const getManualAdvancedItemPlainText = (item: CampaignAdvancedContentItem): string => (
    isRichContentEditorEnabled ? formattedContentToPlainText(item.content) : item.content
  )

  const getManualAdvancedItemWarning = (item: CampaignAdvancedContentItem): string => {
    const plainText = getManualAdvancedItemPlainText(item)
    const mediaItems = item.mediaItems || []
    const hasSendableMedia = !isMobileManagedSmsCampaign && !isPostBackgroundActive && item.mediaOption !== 'none' && mediaItems.length > 0
    const randomMediaCount = isCommentSeedingCampaign ? 1 : (item.randomMediaCount || 3)
    if (isPostBackgroundActive && renderContentSpinMax(plainText).length > 130) return 'Vượt 130 ký tự của phông nền'
    if (isPostBackgroundActive && plainText.split(/\r?\n/).length > 3) return 'Phông nền chỉ hiển thị tối đa 3 dòng'
    if (isPostBackgroundActive && mediaItems.length > 0) return 'Phông nền không gửi kèm media'
    if (item.mediaOption === 'random' && randomMediaCount > mediaItems.length) {
      return `Chọn ngẫu nhiên ${randomMediaCount} nhưng kho chỉ có ${mediaItems.length}`
    }
    if (!plainText.trim() && !hasSendableMedia) {
      return isSmsCampaign
        ? 'Biến thể đang rỗng — nhập nội dung SMS'
        : 'Biến thể đang rỗng — nhập nội dung hoặc chọn media'
    }
    return ''
  }

  const renderManualAdvancedItemSettings = () => (
    <div className="campaign-manual-content-item-settings">
      {canUseFormattedContent && (
        <label className="campaign-manual-content-setting-row">
          <input
            type="checkbox"
            checked={isFormattedContentEnabled}
            onChange={event => setFormattedContentEnabled(event.target.checked)}
          />
          <span>
            <strong>Nội dung có định dạng</strong>
            <small>
              {isZaloMessageCampaign
                ? 'In đậm, in nghiêng và danh sách được giữ nguyên khi gửi Zalo.'
                : 'Định dạng được áp dụng riêng cho từng biến thể nội dung.'}
            </small>
          </span>
        </label>
      )}
      {isPostBackgroundCampaign && (
        <label className={`campaign-manual-content-setting-row${isPostBackgroundDisabled ? ' is-disabled' : ''}`}>
          <input
            type="checkbox"
            checked={isPostBackgroundActive}
            disabled={isPostBackgroundDisabled}
            onChange={event => setPostBackgroundEnabled(event.target.checked)}
          />
          <span>
            <strong>Đăng bài với phông nền</strong>
            <small>
              {isFormattedContentEnabled
                ? 'Tắt “Nội dung có định dạng” để dùng phông nền.'
                : 'Tối đa 130 ký tự, 3 dòng và không gửi media.'}
            </small>
          </span>
        </label>
      )}
      {isEmailCampaign && (
        <label className="campaign-manual-content-setting-row">
          <input
            type="checkbox"
            checked={formData.emailBodyIsHtml}
            onChange={event => {
              const checked = event.target.checked
              if (!checked) normalizeManualAdvancedContentItemsToPlain()
              setFormData(current => checked
                ? { ...current, emailBodyIsHtml: true, rewriteContentEachRun: false }
                : convertFormattedStateToPlain(current))
            }}
          />
          <span>
            <strong>Nội dung dạng HTML</strong>
            <small>Bật trình soạn thảo có định dạng cho nội dung email.</small>
          </span>
        </label>
      )}
      {isSmsCampaign && (
        <>
          <label className="campaign-manual-content-setting-row compact">
            <input
              type="checkbox"
              checked={formData.smsUseUnicode}
              onChange={event => setFormData(current => ({ ...current, smsUseUnicode: event.target.checked }))}
            />
            <span><strong>Gửi có dấu (Unicode)</strong><small>70 ký tự mỗi tin khi có dấu.</small></span>
          </label>
          <label className="campaign-manual-content-setting-row compact">
            <input
              type="checkbox"
              checked={formData.smsKeepNewLines}
              onChange={event => setFormData(current => ({ ...current, smsKeepNewLines: event.target.checked }))}
            />
            <span><strong>Giữ xuống dòng</strong><small>Không gộp các dòng trước khi gửi.</small></span>
          </label>
        </>
      )}
    </div>
  )

  const renderManualAdvancedItemEditor = (item: CampaignAdvancedContentItem, itemIndex: number) => {
    const plainText = getManualAdvancedItemPlainText(item)
    const mediaCount = (item.mediaItems || []).length
    const warning = getManualAdvancedItemWarning(item)
    const smsPreviewText = isSmsCampaign
      ? normalizeSmsContentForSend(renderContentSpinMax(plainText), {
          useUnicode: formData.smsUseUnicode,
          keepNewLines: formData.smsKeepNewLines
        })
      : ''
    const smsCount = countSingleSmsContent(smsPreviewText, formData.smsUseUnicode)
    const sourceLabel = item.sourceTemplateName
      ? `${item.sourceTemplateName}${item.sourceVariantIndex !== undefined ? ` · biến thể ${item.sourceVariantIndex + 1}` : ''}`
      : 'Tự soạn'

    return (
      <div className="campaign-manual-content-editor-scroll">
        <div className="campaign-manual-content-editor-heading">
          <div>
            <strong>Nội dung {itemIndex + 1}</strong>
            <span className={item.sourceTemplateName ? 'is-template' : ''}><FileText size={11} />{sourceLabel}</span>
          </div>
          <div className="campaign-manual-content-editor-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => duplicateAdvancedContentItem(item)}>
              <Copy size={13} /> Nhân bản
            </button>
            <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => removeAdvancedContentItem(item.id)}>
              <Trash2 size={13} /> Xoá
            </button>
          </div>
        </div>

        {renderManualAdvancedItemSettings()}

        {isEmailCampaign && (
          <div className="stepper-form-group campaign-manual-content-email-subject">
            <label>Tiêu đề email <span className="required">*</span></label>
            <input
              type="text"
              className="stepper-input"
              value={resolveLegacyManualEmailSubject(item)}
              onChange={event => setAdvancedContentItem(item.id, { emailSubject: event.target.value })}
              placeholder="Nhập tiêu đề cho nội dung email này..."
            />
          </div>
        )}

        <div className="campaign-manual-content-composer">
          <div className="campaign-manual-content-editor-toolbar">
            {(isMessageCampaign || isSmsCampaign) && !isZaloShareMessageMode && (
              renderMessagePersonalizationDropdown('content', 'action', item.id)
            )}
            {isSmsCampaign && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAdvancedContentItem(item.id, { content: stripVietnameseDiacritics(item.content) })}
              >
                Bỏ dấu ngay
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => insertAdvancedContentSnippet(item, '{chào|xin chào|kính chào}')}
              title="Chèn cụm xoay vòng ngẫu nhiên"
            >
              <Shuffle size={13} /> Spin {'{a|b|c}'}
            </button>
            <span className="campaign-manual-content-toolbar-hint">
              {isPostBackgroundActive
                ? 'Phông nền: chữ căn giữa, không định dạng'
                : isSmsCampaign
                  ? (formData.smsUseUnicode ? 'Đang giữ dấu tiếng Việt' : 'Sẽ gửi bản không dấu')
                  : isRichContentEditorEnabled ? 'Định dạng đang bật' : 'Nội dung văn bản thường'}
            </span>
          </div>
          {isRichContentEditorEnabled ? (
            <EmailHtmlEditor
              value={item.content}
              onChange={html => setAdvancedContentItem(item.id, { content: html })}
              onEditorReady={editor => {
                if (editor) advancedContentEditorRefs.current[item.id] = editor
                else delete advancedContentEditorRefs.current[item.id]
              }}
              onFocus={editor => {
                activeRichContentEditorRef.current = { itemId: item.id, editor }
              }}
            />
          ) : (
            <textarea
              ref={textarea => {
                if (textarea) advancedContentTextareaRefs.current[item.id] = textarea
                else delete advancedContentTextareaRefs.current[item.id]
              }}
              className="stepper-textarea campaign-manual-content-textarea"
              placeholder={isSmsCampaign ? 'Nhập nội dung SMS...' : isEmailCampaign ? 'Nhập nội dung email...' : 'Nhập nội dung...'}
              value={item.content}
              onChange={event => setAdvancedContentItem(item.id, { content: event.target.value })}
              rows={7}
            />
          )}
        </div>

        <div className="campaign-manual-content-item-meta">
          <span>
            {isSmsCampaign
              ? `${smsCount.countChar} ký tự · ${smsCount.countSms} tin · ${formData.smsUseUnicode ? 'Unicode' : 'GSM không dấu'}`
              : isPostBackgroundActive
                ? `${renderContentSpinMax(plainText).length}/130 ký tự · ${plainText.split(/\r?\n/).length}/3 dòng`
                : `${plainText.length} ký tự · ${plainText ? plainText.split(/\r?\n/).length : 0} dòng · ${mediaCount > 0 ? `${mediaCount} media` : 'chưa có media'}`}
          </span>
          {warning && <span className="campaign-manual-content-warning"><AlertTriangle size={12} />{warning}</span>}
        </div>

        {renderAdvancedContentItemMedia(item)}
      </div>
    )
  }

  const renderManualAdvancedPreview = (item: CampaignAdvancedContentItem, itemIndex: number) => {
    const itemPlainText = getManualAdvancedItemPlainText(item)
    const previewSeed = `${item.id}:${manualAdvancedPreviewSeed}`
    const spunPlainText = renderContentSpin(itemPlainText, {
      rng: createCampaignPreviewRng(`${previewSeed}:plain`)
    })
    const sampledPlainText = manualAdvancedPreviewUsesSampleData
      ? renderPreviewSampleTokens(spunPlainText)
      : spunPlainText
    const previewText = isSmsCampaign
      ? normalizeSmsContentForSend(sampledPlainText, {
          useUnicode: formData.smsUseUnicode,
          keepNewLines: formData.smsKeepNewLines
        })
      : sampledPlainText
    const spunSubject = renderContentSpin(resolveLegacyManualEmailSubject(item), {
      rng: createCampaignPreviewRng(`${previewSeed}:subject`)
    })
    const renderedSubject = manualAdvancedPreviewUsesSampleData
      ? renderPreviewSampleTokens(spunSubject)
      : spunSubject
    const richContentRng = createCampaignPreviewRng(`${previewSeed}:rich`)
    const renderedRichContent = isRichContentEditorEnabled
      ? transformFormattedContentTextNodes(
          sanitizeFormattedContent(item.content),
          text => {
            const spun = renderContentSpin(text, { rng: richContentRng })
            return manualAdvancedPreviewUsesSampleData ? renderPreviewSampleTokens(spun) : spun
          }
        )
      : ''
    const selectedMediaItems = item.mediaItems || []
    const mediaItems = item.mediaOption === 'none' || isPostBackgroundActive
      ? []
      : item.mediaOption === 'random'
        ? sampleCampaignPreviewMedia(
            selectedMediaItems,
            Math.max(1, item.randomMediaCount || 1),
            createCampaignPreviewRng(`${previewSeed}:media`)
          )
        : selectedMediaItems
    const smsCount = countSingleSmsContent(previewText, formData.smsUseUnicode)
    const isFacebookChat = advancedContentTargetChannel === 'facebook_message'
    const isFacebookComment = advancedContentTargetChannel === 'facebook_comment'
    const isZaloGroupChat = isZaloMessageGroupCampaign
    const notes: string[] = []
    if (isPostBackgroundActive) notes.push('Phông nền giới hạn 130 ký tự, 3 dòng và không gửi media.')
    if (!isPostBackgroundActive && item.mediaOption === 'random') notes.push(`Mỗi lượt lấy ngẫu nhiên ${Math.max(1, item.randomMediaCount || 1)} media trong ${item.mediaItems?.length || 0} đã chọn.`)
    if (item.mediaOption === 'all' && mediaItems.length > 0) notes.push(`Gửi đủ ${mediaItems.length} media đã chọn theo thứ tự.`)
    if (/\{[^{}]*\|[^{}]*\}/.test(itemPlainText)) notes.push('Cụm {a|b} được bốc ngẫu nhiên ở từng lượt gửi.')
    if (isSmsCampaign) notes.push(formData.smsUseUnicode ? 'Gửi có dấu: mỗi tin 70 ký tự khi có dấu.' : 'Tự bỏ dấu khi gửi: mỗi tin 160 ký tự.')
    if (isZaloMessageCampaign && usesZaloServerAccount) notes.push('Zalo Server chỉ gửi media đã upload lên cloud.')
    if (isReelsMediaMode) notes.push('Reels dùng một video cho mỗi lượt đăng.')
    notes.push('Các biến thể chạy xoay vòng theo thứ tự qua từng mục tiêu.')

    const previewContent = isRichContentEditorEnabled
      ? <div className="campaign-manual-preview-rich" dangerouslySetInnerHTML={{ __html: renderedRichContent }} />
      : <>{previewText || 'Nội dung xem trước sẽ hiển thị tại đây.'}</>

    return (
      <aside className="campaign-manual-content-preview-pane">
        <div className="campaign-manual-content-preview-header">
          <div><strong>Xem trước</strong><span>{getAdvancedContentCampaignLabel(advancedContentTargetChannel || 'facebook_post')} · {manualAdvancedPreviewUsesSampleData ? 'dữ liệu khách mẫu' : 'giữ nguyên biến'}</span></div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManualAdvancedPreviewSeed(seed => seed + 1)}>
            <RefreshCw size={13} /> Đổi mẫu ngẫu nhiên
          </button>
        </div>
        <div className="campaign-manual-content-preview-nav">
          <button
            type="button"
            className="btn-icon"
            onClick={() => {
              const items = formData.advancedContentItems
              const previousItem = items[(itemIndex - 1 + items.length) % items.length]
              if (previousItem) setManualAdvancedContentSelectedId(previousItem.id)
            }}
            aria-label="Nội dung trước"
          ><ChevronLeft size={14} /></button>
          <strong>Nội dung {itemIndex + 1} / {formData.advancedContentItems.length}</strong>
          <button
            type="button"
            className="btn-icon"
            onClick={() => {
              const items = formData.advancedContentItems
              const nextItem = items[(itemIndex + 1) % items.length]
              if (nextItem) setManualAdvancedContentSelectedId(nextItem.id)
            }}
            aria-label="Nội dung tiếp theo"
          ><ChevronRight size={14} /></button>
          <label className="campaign-manual-content-sample-toggle">
            <input
              type="checkbox"
              checked={manualAdvancedPreviewUsesSampleData}
              onChange={event => setManualAdvancedPreviewUsesSampleData(event.target.checked)}
            />
            <span>Điền dữ liệu khách mẫu</span>
          </label>
        </div>
        <div className="campaign-manual-content-preview-scroll">
          {isEmailCampaign ? (
            <div className="campaign-manual-preview-card email">
              <div className="campaign-manual-preview-email-head">
                <small>Tiêu đề</small><strong>{renderedSubject || 'Chưa có tiêu đề'}</strong>
                <span>Từ: akaBiz &lt;cskh@akabiz.vn&gt; · Tới: lan.nguyen@gmail.com</span>
              </div>
              <div className="campaign-manual-preview-body">{previewContent}</div>
              {mediaItems.length > 0 && <div className="campaign-manual-preview-files">{mediaItems.map((media, index) => <span key={`${index}-${getCampaignMediaStableKey(media)}`}><FileText size={13} />{getCampaignMediaDisplayName(media)}</span>)}</div>}
            </div>
          ) : isSmsCampaign ? (
            <div className="campaign-manual-preview-card sms">
              <div className="campaign-manual-preview-sms-head"><MessageCircle size={15} /><span><strong>AKABIZ</strong><small>Brandname · 0938 xxx 214</small></span></div>
              <div className="campaign-manual-preview-sms-bubble">{previewContent}</div>
              <div className="campaign-manual-preview-sms-meta">{smsCount.countChar} ký tự · {smsCount.countSms} tin · {formData.smsUseUnicode ? 'Unicode (70/tin)' : 'GSM (160/tin)'}</div>
            </div>
          ) : isFacebookComment ? (
            <div className="campaign-manual-preview-card comment">
              <div className="campaign-manual-preview-post-head"><span className="campaign-manual-preview-avatar">B</span><span><strong>Bài viết mẫu</strong><small>Vừa xong · Facebook</small></span></div>
              <div className="campaign-manual-preview-comment-source">Nội dung bài viết sẽ xuất hiện phía trên bình luận.</div>
              <div className="campaign-manual-preview-comment-thread">
                <span className="campaign-manual-preview-avatar small">a</span>
                <div>
                  <strong>akaBiz Automation</strong>
                  <div className="campaign-manual-preview-comment-bubble">{previewContent}</div>
                  {mediaItems.length > 0 && <div className="campaign-manual-preview-media-grid compact count-1">{mediaItems.map((media, index) => <CampaignManualMediaPreview media={media} key={`${index}-${getCampaignMediaStableKey(media)}`} />)}</div>}
                  <small>Vừa xong · Thích · Trả lời</small>
                </div>
              </div>
            </div>
          ) : isReelsMediaMode ? (
            <div className="campaign-manual-preview-card reels">
              <div className="campaign-manual-preview-reels-stage">
                {mediaItems[0]
                  ? <CampaignManualMediaPreview media={mediaItems[0]} />
                  : <div className="campaign-manual-preview-reels-empty"><Image size={28} /><span>Video Reels sẽ hiển thị tại đây</span></div>}
                <div className="campaign-manual-preview-reels-shade" />
                <div className="campaign-manual-preview-reels-copy"><strong>@akaBiz Automation</strong><div>{previewContent}</div><small>Âm thanh gốc · akaBiz</small></div>
                <div className="campaign-manual-preview-reels-actions"><span><ThumbsUp size={16} />0</span><span><MessageCircle size={16} />0</span><span><Share2 size={16} /></span></div>
              </div>
            </div>
          ) : isZaloMessageCampaign || isFacebookChat ? (
            <div className={`campaign-manual-preview-card chat${isFacebookChat ? ' facebook' : isZaloGroupChat ? ' zalo group' : ' zalo'}`}>
              <div className="campaign-manual-preview-chat-head">
                <span className="campaign-manual-preview-avatar">{isFacebookChat ? 'f' : isZaloGroupChat ? <Users size={15} /> : 'Z'}</span>
                <span><strong>{isZaloGroupChat ? 'Nhóm kinh doanh akaBiz' : 'Nguyễn Thị Lan'}</strong><small>{isFacebookChat ? 'Tin nhắn Facebook' : isZaloGroupChat ? 'Nhóm Zalo · 24 thành viên' : 'Tin nhắn Zalo cá nhân'}</small></span>
              </div>
              <div className="campaign-manual-preview-chat-bubble">{previewContent}</div>
              {mediaItems.length > 0 && <div className={`campaign-manual-preview-media-grid compact count-${Math.min(mediaItems.length, 4)}`}>{mediaItems.map((media, index) => <CampaignManualMediaPreview media={media} key={`${index}-${getCampaignMediaStableKey(media)}`} />)}</div>}
              <small className="campaign-manual-preview-sent">Đã gửi · 10:42</small>
            </div>
          ) : (
            <div className="campaign-manual-preview-card post">
              <div className="campaign-manual-preview-post-head"><span className="campaign-manual-preview-avatar">a</span><span><strong>akaBiz Automation</strong><small>Vừa xong · Facebook</small></span></div>
              <div className={`campaign-manual-preview-body${isPostBackgroundActive ? ' is-background' : ''}`}>{previewContent}</div>
              {mediaItems.length > 0 && <div className={`campaign-manual-preview-media-grid count-${Math.min(mediaItems.length, 4)}`}>{mediaItems.map((media, index) => <CampaignManualMediaPreview media={media} key={`${index}-${getCampaignMediaStableKey(media)}`} />)}</div>}
              <div className="campaign-manual-preview-post-actions"><span><ThumbsUp size={13} />Thích</span><span><MessageCircle size={13} />Bình luận</span><span><Share2 size={13} />Chia sẻ</span></div>
            </div>
          )}

          <div className="campaign-manual-preview-notes">
            <strong>Khi chạy thật</strong>
            {notes.map((note, index) => <span key={`${index}-${note}`}><i>•</i>{note}</span>)}
          </div>
        </div>
      </aside>
    )
  }

  const renderManualAdvancedTemplatePicker = () => {
    if (!manualAdvancedTemplatePickerOpen || !advancedContentTargetChannel) return null

    const targetChannel = advancedContentTargetChannel
    const targetMediaMode: MediaSelectionMode = targetChannel === 'facebook_post' || targetChannel === 'facebook_message' || targetChannel === 'facebook_comment'
      ? mainMediaSelectionMode
      : 'image'
    const compatibleTemplates = contentTemplates.flatMap(template => {
      const resolved = resolveContentTemplate(template, targetChannel)
      return !template.isDelete && resolved.variants.length > 0 ? [{ template, resolved }] : []
    })
    const selectedVariantCount = manualAdvancedPickedVariants.length
    const isPicked = (templateId: number, variantIndex: number) => manualAdvancedPickedVariants.includes(`${templateId}:${variantIndex}`)
    const toggleVariant = (templateId: number, variantIndex: number) => {
      const key = `${templateId}:${variantIndex}`
      setManualAdvancedPickedVariants(current => current.includes(key)
        ? current.filter(item => item !== key)
        : [...current, key])
    }
    const addPickedVariants = () => {
      const pickedEntries = compatibleTemplates.flatMap(({ template, resolved }) => (
        resolved.variants.flatMap((variant, variantIndex) => isPicked(template.id, variantIndex)
          ? [{ template, resolved, variant, variantIndex }]
          : [])
      ))
      if (pickedEntries.length === 0) return
      if (isSmsCampaign && formData.advancedContentItems.length + pickedEntries.length > MAX_SMS_ADVANCED_CONTENT_ITEMS) {
        showAlert(`Nội dung nâng cao SMS chỉ được tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} mục.`, 'error')
        return
      }

      const targetSupportsRich = targetChannel === 'email' || supportsFormattedContent(formData.actionId)
      const shouldUseRich = !isPostBackgroundActive && (
        isRichContentEditorEnabled || (targetSupportsRich && pickedEntries.some(entry => entry.resolved.rich))
      )
      const newItems = pickedEntries.map(({ template, resolved, variant, variantIndex }) => {
        const content = shouldUseRich
          ? (resolved.rich ? sanitizeFormattedContent(variant) : plainTextToFormattedContent(variant))
          : (resolved.rich ? formattedContentToPlainText(variant) : variant)
        const snapshots = targetChannel === 'sms'
          ? []
          : contentTemplateImagesToSnapshots(resolved.imageUrls, targetMediaMode).snapshots
        const mediaOption: ImageOption = snapshots.length === 0
          ? 'none'
          : (isCommentSeedingCampaign || isReelsMediaMode) && snapshots.length > 1
            ? 'random'
            : 'all'
        return createAdvancedContentItem({
          content,
          mediaOption,
          mediaItems: snapshots,
          randomMediaCount: isCommentSeedingCampaign || isReelsMediaMode ? 1 : 3,
          emailSubject: targetChannel === 'email' ? String(resolved.subject || '') : undefined,
          sourceTemplateId: template.id,
          sourceTemplateName: template.name,
          sourceVariantIndex: variantIndex
        })
      })

      setManualAdvancedContentSelectedId(newItems[0]?.id ?? null)
      setFormData(current => {
        const existingItems = shouldUseRich && !isRichContentEditorEnabled
          ? current.advancedContentItems.map(item => ({ ...item, content: plainTextToFormattedContent(item.content) }))
          : current.advancedContentItems
        const nextItems = [...existingItems, ...newItems]
        manualAdvancedContentItemsRef.current = nextItems
        return {
          ...current,
          advancedContentEnabled: true,
          advancedContentItems: nextItems,
          formattedContentEnabled: targetChannel !== 'email' && shouldUseRich && supportsFormattedContent(current.actionId),
          emailBodyIsHtml: targetChannel === 'email' ? shouldUseRich : current.emailBodyIsHtml,
          rewriteContentEachRun: shouldUseRich ? false : current.rewriteContentEachRun,
          postWithBackground: shouldUseRich ? false : current.postWithBackground,
          zaloMessageSendMode: shouldUseRich ? 'normal' : current.zaloMessageSendMode
        }
      })
      setManualAdvancedPickedVariants([])
      setManualAdvancedTemplatePickerOpen(false)
      manualAdvancedTemplatePickerReturnFocusRef.current = null
      showAlert(`Đã thêm ${newItems.length} biến thể từ mẫu nội dung.`, 'success')
    }

    return (
      <div
        className="campaign-manual-template-picker-overlay"
        onMouseDown={event => {
          if (event.target === event.currentTarget) closeManualAdvancedTemplatePicker()
        }}
      >
        <div
          ref={manualAdvancedTemplatePickerRef}
          className="campaign-manual-template-picker"
          role="dialog"
          aria-modal="true"
          aria-label="Chọn từ mẫu nội dung"
          tabIndex={-1}
        >
          <div className="modal-header">
            <div><span className="modal-title">Chọn từ mẫu nội dung</span><small>Chỉ hiện mẫu có {getContentTemplateChannelLabel(targetChannel)} · mỗi biến thể chọn thành một nội dung nâng cao.</small></div>
            <button type="button" className="btn-icon" onClick={closeManualAdvancedTemplatePicker} aria-label="Đóng danh sách mẫu"><X size={18} /></button>
          </div>
          <div className="campaign-manual-template-picker-body">
            {contentTemplatesLoading ? (
              <div className="campaign-manual-template-picker-empty"><Loader2 size={20} className="animate-spin" />Đang tải mẫu nội dung...</div>
            ) : compatibleTemplates.length === 0 ? (
              <div className="campaign-manual-template-picker-empty"><FileText size={26} />Chưa có mẫu phù hợp với chiến dịch này.</div>
            ) : compatibleTemplates.map(({ template, resolved }) => {
              const pickedCount = resolved.variants.filter((_, index) => isPicked(template.id, index)).length
              return (
                <section className="campaign-manual-template-card" key={template.id}>
                  <div className="campaign-manual-template-card-head">
                    <span><strong>{template.name}</strong><small>{template.groupName || 'Chưa phân nhóm'} · {resolved.variants.length} biến thể · {resolved.imageUrls.length} media</small></span>
                    {pickedCount > 0 && <em>Đã chọn {pickedCount}</em>}
                  </div>
                  <div className="campaign-manual-template-variants">
                    {resolved.variants.map((variant, variantIndex) => {
                      const picked = isPicked(template.id, variantIndex)
                      const excerpt = resolved.rich ? formattedContentToPlainText(variant) : variant
                      return (
                        <button type="button" className={picked ? 'is-picked' : ''} key={variantIndex} onClick={() => toggleVariant(template.id, variantIndex)}>
                          <span className="campaign-manual-template-check">{picked && <Check size={11} />}</span>
                          <em>BT {variantIndex + 1}</em>
                          <span>{excerpt}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
          <div className="modal-footer">
            <span>{selectedVariantCount > 0 ? `Đã chọn ${selectedVariantCount} biến thể` : 'Chưa chọn biến thể nào'}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeManualAdvancedTemplatePicker}>Huỷ</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={addPickedVariants} disabled={selectedVariantCount === 0}>
              <Plus size={14} /> Thêm {selectedVariantCount > 0 ? `${selectedVariantCount} biến thể` : 'biến thể'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderManualAdvancedContentModal = () => {
    if (!manualAdvancedContentModalOpen) return null

    const items = formData.advancedContentItems
    const selectedItem = items.find(item => item.id === manualAdvancedContentSelectedId) || items[0] || null
    const selectedIndex = selectedItem ? items.indexOf(selectedItem) : -1
    const itemCount = items.length
    const titleId = `campaign-manual-content-title-${modalZIndex || 3000}`
    const channelLabel = getAdvancedContentCampaignLabel(advancedContentTargetChannel || 'facebook_post')

    return (
      <div
        className="modal-overlay campaign-picker-modal-overlay campaign-manual-content-modal-overlay"
        style={{ zIndex: Math.max(3050, (modalZIndex || 3000) + 50) }}
        onMouseDown={event => {
          if (event.target === event.currentTarget) closeManualAdvancedContentModal()
        }}
      >
        <div
          ref={manualAdvancedContentModalRef}
          className="campaign-manual-content-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          inert={manualAdvancedTemplatePickerOpen || undefined}
        >
          <div className="modal-header campaign-manual-content-modal-header">
            <div className="campaign-manual-content-modal-title">
              <span className="campaign-manual-content-launcher-icon"><Edit3 size={17} /></span>
              <div>
                <span className="modal-title" id={titleId}>Nội dung nâng cao</span>
                <span>{itemCount} biến thể · {channelLabel} · {isSmsCampaign ? 'mỗi biến thể có nội dung riêng' : 'mỗi biến thể có nội dung và media riêng'}</span>
              </div>
            </div>
            <div className="campaign-manual-content-modal-header-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={openManualAdvancedTemplatePicker}>
                <FileText size={14} /> Chọn từ mẫu
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openSaveContentTemplateModal('content')} disabled={itemCount === 0}>
                <Save size={14} /> Lưu thành mẫu
              </button>
              <button
                ref={manualAdvancedContentCloseRef}
                type="button"
                className="btn-icon"
                onClick={closeManualAdvancedContentModal}
                title="Đóng"
                aria-label="Đóng modal nội dung nâng cao"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="campaign-manual-content-modal-body">
            <aside className="campaign-manual-content-rail">
              <div className="campaign-manual-content-rail-head"><strong>Biến thể</strong><span>{itemCount}</span></div>
              <div className="campaign-manual-content-rail-list">
                {items.length === 0 ? (
                  <div className="campaign-manual-content-rail-empty">Chưa có biến thể nào.<br />Thêm mới hoặc lấy từ mẫu nội dung.</div>
                ) : items.map((item, index) => {
                  const plainText = getManualAdvancedItemPlainText(item)
                  const selected = selectedItem?.id === item.id
                  return (
                    <div
                      className={`campaign-manual-content-rail-item${selected ? ' is-selected' : ''}`}
                      key={item.id}
                    >
                      <button
                        type="button"
                        className="campaign-manual-content-rail-select"
                        onClick={() => setManualAdvancedContentSelectedId(item.id)}
                        aria-pressed={selected}
                      >
                        <span className="campaign-manual-content-rail-number">{index + 1}</span>
                        <span className="campaign-manual-content-rail-copy">
                          <strong>{plainText.split(/\r?\n/)[0] || 'Biến thể rỗng'}</strong>
                          <small>{plainText.length} ký tự{item.sourceTemplateName ? <em>mẫu</em> : null}</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="campaign-manual-content-rail-delete"
                        title="Xoá biến thể"
                        aria-label={`Xoá nội dung ${index + 1}`}
                        onClick={() => removeAdvancedContentItem(item.id)}
                      ><Trash2 size={12} /></button>
                    </div>
                  )
                })}
              </div>
              <div className="campaign-manual-content-rail-footer">
                <button type="button" className="btn btn-primary btn-sm" onClick={addAdvancedContentItem} disabled={isSmsCampaign && itemCount >= MAX_SMS_ADVANCED_CONTENT_ITEMS}>
                  <Plus size={14} /> Thêm biến thể
                </button>
                <small>{isSmsCampaign ? `SMS tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} biến thể` : 'Chạy xoay vòng theo thứ tự'}</small>
              </div>
            </aside>

            <main className="campaign-manual-content-editor-pane">
              {selectedItem ? renderManualAdvancedItemEditor(selectedItem, selectedIndex) : (
                <div className="campaign-manual-content-empty-state">
                  <span><FileText size={23} /></span>
                  <div><strong>Chưa có biến thể nội dung nào</strong><small>Mỗi lượt chạy sẽ xoay vòng qua các biến thể. Lấy sẵn từ mẫu nội dung hoặc tự soạn mới.</small></div>
                  <div><button type="button" className="btn btn-primary btn-sm" onClick={openManualAdvancedTemplatePicker}>Chọn từ mẫu nội dung</button><button type="button" className="btn btn-ghost btn-sm" onClick={addAdvancedContentItem}>Soạn biến thể mới</button></div>
                </div>
              )}
            </main>

            {selectedItem ? renderManualAdvancedPreview(selectedItem, selectedIndex) : (
              <aside className="campaign-manual-content-preview-pane is-empty"><Eye size={24} /><span>Thêm một biến thể để xem trước.</span></aside>
            )}
          </div>

          <div className="modal-footer campaign-manual-content-modal-footer">
            <span className="campaign-manual-content-modal-footer-note">Các thay đổi sẽ được lưu khi bạn lưu chiến dịch.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={closeManualAdvancedContentModal}>Xong</button>
          </div>
        </div>
        {renderManualAdvancedTemplatePicker()}
      </div>
    )
  }

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

      {renderImagePicker('comment', 'Media comment')}

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
      if (column === 'action') return row.actionLabel || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'account') return row.accountName || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'status') return row.status || <span className="campaign-picker-muted">Không rõ</span>
      if (column === 'schedule') return row.scheduleLabel
        ? <span className="campaign-picker-table-schedule">{row.scheduleLabel}</span>
        : <span className="campaign-picker-muted">Chưa có</span>
      if (column === 'updatedAt') return row.updatedAtLabel
        ? <span className="campaign-picker-table-schedule">{row.updatedAtLabel}</span>
        : <span className="campaign-picker-muted">Chưa có</span>
      if (column === 'dataTypes') return renderTextList(row.dataTypes)
      return renderTextList(row.sourceTypes)
    }

    const columnLabels: Record<CampaignPickerColumn, string> = {
      name: 'Tên chiến dịch',
      action: 'Hành động',
      account: campaignPickerModal.source.type === 'external' ? 'Tài khoản/Shop' : 'Tài khoản',
      status: 'Trạng thái',
      schedule: 'Lịch chạy',
      updatedAt: 'Ngày update',
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
                  <button
                    type="button"
                    className="btn btn-secondary campaign-picker-add-button"
                    onClick={() => openDraftCampaignForm(
                      campaignPickerModal.source,
                      undefined,
                      campaignPickerModal.source.type === 'findDataSource' ? 'Thêm' : undefined
                    )}
                  >
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

  const renderSourceCampaignViewModal = () => {
    if (!viewingSourceCampaign) return null
    const sourceAccount = viewingSourceCampaign.accountId
      ? accounts.find(account => account.id === viewingSourceCampaign.accountId) || null
      : null
    const sourceAction = campaignActions.find(action => action.id === viewingSourceCampaign.actionId)

    return (
      <div className="modal-overlay campaign-picker-modal-overlay" style={{ zIndex: 3200 }}>
        <div className="source-campaign-view-modal">
          <div className="modal-header">
            <span className="modal-title">Xem chiến dịch</span>
            <button type="button" className="btn-icon" onClick={() => setViewingSourceCampaign(null)}>
              <X size={18} />
            </button>
          </div>
          <div className="source-campaign-view-body">
            <CampaignInfoView
              campaign={viewingSourceCampaign}
              account={sourceAccount}
              action={sourceAction}
              campaigns={campaigns}
              accounts={accounts}
            />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewingSourceCampaign(null)}>Đóng</button>
          </div>
        </div>
      </div>
    )
  }

  const renderContentTemplatePickerModal = () => {
    if (!contentTemplatePicker) return null
    const query = contentTemplatePicker.searchQuery.trim().toLowerCase()
    const groupQuery = contentTemplatePicker.groupSearchQuery.trim().toLocaleLowerCase('vi')
    const targetChannel = getContentTemplateTargetChannel(contentTemplatePicker.target)
    const targetMediaMode: MediaSelectionMode = contentTemplatePicker.target === 'commentContent'
      ? 'image-video'
      : targetChannel === 'facebook_post' || targetChannel === 'facebook_message' || targetChannel === 'facebook_comment'
        ? mainMediaSelectionMode
        : 'image'
    const filterTargetTemplateMediaUrls = (urls: string[]): string[] => (
      contentTemplateImagesToSnapshots(urls, targetMediaMode).snapshots.flatMap(snapshot => (
        snapshot.cloudUrl ? [snapshot.cloudUrl] : []
      ))
    )
    const compatibleTemplates = contentTemplates.flatMap(template => {
      const resolved = resolveContentTemplate(template, targetChannel)
      return !template.isDelete && resolved.variants.length > 0
        ? [{ template, resolved }]
        : []
    })
    const filteredTemplates = compatibleTemplates.filter(({ template }) => {
      const matchesGroup = contentTemplatePicker.groupId === null
        ? true
        : contentTemplatePicker.groupId === 'ungrouped'
          ? template.groupId === null
          : template.groupId === contentTemplatePicker.groupId
      return matchesGroup && (!query || getContentTemplateSearchText(template).includes(query))
    })
    const dateValue = (template: ContentTemplate) => {
      const value = new Date(template.updatedAt || template.createdAt || 0).getTime()
      return Number.isNaN(value) ? 0 : value
    }
    const sortedTemplates = [...filteredTemplates].sort((left, right) => {
      if (contentTemplatePicker.sort === 'oldest') return dateValue(left.template) - dateValue(right.template)
      if (contentTemplatePicker.sort === 'name') return left.template.name.localeCompare(right.template.name, 'vi')
      if (contentTemplatePicker.sort === 'variants') return right.resolved.variants.length - left.resolved.variants.length
      return dateValue(right.template) - dateValue(left.template)
    })
    const selectedEntry = sortedTemplates.find(({ template }) => (
      template.id === contentTemplatePicker.selectedTemplateId
    )) || sortedTemplates[0] || null
    const selectedTemplate = selectedEntry?.template || null
    const selectedResolved = selectedEntry?.resolved || null
    const targetSupportsRich = contentTemplatePicker.target === 'content' && (
      targetChannel === 'email' || supportsFormattedContent(formData.actionId)
    )
    const previewFormatted = !!selectedResolved?.rich && targetSupportsRich
    const previewVariants = !selectedResolved
      ? []
      : selectedResolved.rich && !previewFormatted
        ? selectedResolved.variants.map(variant => formattedContentToPlainText(variant)).filter(Boolean)
        : selectedResolved.variants
    const previewImageUrls = !selectedResolved || targetChannel === 'sms'
      ? []
      : contentTemplatePicker.target === 'postBumpContent'
        ? []
        : filterTargetTemplateMediaUrls(selectedResolved.imageUrls)
    const visibleGroups = contentTemplateGroups
      .filter(group => contentTemplateGroupMatchesPickerFilters(group, contentTemplatePicker.groupStatus, groupQuery))
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, 'vi'))
    const groupCompatibleCount = (groupId: number | 'ungrouped' | null) => compatibleTemplates.filter(({ template }) => (
      groupId === null
        ? true
        : groupId === 'ungrouped'
          ? template.groupId === null
          : template.groupId === groupId
    )).length
    const selectGroup = (groupId: number | 'ungrouped' | null) => setContentTemplatePicker(previous => previous
      ? { ...previous, groupId, selectedTemplateId: null }
      : previous)
    const updateGroupFilters = (
      updates: Partial<Pick<ContentTemplatePickerModalState, 'groupSearchQuery' | 'groupStatus'>>
    ) => setContentTemplatePicker(previous => {
      if (!previous) return previous
      const next = { ...previous, ...updates }
      if (typeof next.groupId !== 'number') return next
      const nextQuery = next.groupSearchQuery.trim().toLocaleLowerCase('vi')
      const selectedGroupIsVisible = contentTemplateGroups.some(group => (
        group.id === next.groupId && contentTemplateGroupMatchesPickerFilters(group, next.groupStatus, nextQuery)
      ))
      return selectedGroupIsVisible
        ? next
        : { ...next, groupId: null, selectedTemplateId: null }
    })
    const selectTemplate = (templateId: number) => setContentTemplatePicker(previous => previous
      ? { ...previous, selectedTemplateId: templateId }
      : previous)
    const formatUpdatedAt = (template: ContentTemplate) => {
      const value = template.updatedAt || template.createdAt
      if (!value) return ''
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN')
    }
    const renderChannelBadges = (template: ContentTemplate) => (
      CONTENT_TEMPLATE_PREVIEW_CHANNEL_ORDER.map(channelName => (
        template.channels[channelName]?.enabled
          ? <span className={`content-template-picker-channel-badge ${channelName}`} key={channelName}>{getContentTemplateChannelLabel(channelName)}</span>
          : null
      ))
    )
    const renderTemplateCard = ({ template, resolved }: typeof sortedTemplates[number]) => {
      const excerpt = resolved.rich
        ? formattedContentToPlainText(resolved.variants[0])
        : resolved.variants[0]
      const selected = selectedTemplate?.id === template.id
      const mediaCount = targetChannel === 'sms' || contentTemplatePicker.target === 'postBumpContent'
        ? 0
        : filterTargetTemplateMediaUrls(resolved.imageUrls).length
      return (
        <button
          key={template.id}
          type="button"
          className={`content-template-picker-v2-card${selected ? ' is-selected' : ''}`}
          onClick={() => selectTemplate(template.id)}
          aria-pressed={selected}
        >
          <div className="content-template-picker-v2-card-head">
            <span className={`content-template-picker-v2-mark${selected ? ' is-selected' : ''}`}>
              {selected && <Check size={11} />}
            </span>
            <span className="content-template-picker-v2-card-title">{template.name}</span>
          </div>
          <div className="content-template-picker-item-meta">
            <span className="content-template-picker-group-badge">{template.groupName || 'Chưa phân nhóm'}</span>
            {renderChannelBadges(template)}
          </div>
          <p className="content-template-picker-item-excerpt">{excerpt}</p>
          <div className="content-template-picker-item-footer">
            <span>{resolved.variants.length} biến thể</span>
            <span>{mediaCount} media</span>
            {formatUpdatedAt(template) && <span>Cập nhật {formatUpdatedAt(template)}</span>}
          </div>
        </button>
      )
    }

    return (
      <div className="modal-overlay campaign-picker-modal-overlay" style={{ zIndex: Math.max(3100, (modalZIndex || 3000) + 100) }}>
        <div className="content-template-picker-modal content-template-picker-v2" role="dialog" aria-modal="true" aria-label={contentTemplatePicker.title}>
          <div className="modal-header content-template-picker-v2-header">
            <div className="content-template-picker-v2-heading">
              <span className="content-template-picker-v2-heading-icon"><FileText size={19} /></span>
              <div>
                <span className="modal-title">{contentTemplatePicker.title}</span>
                <span>Chọn một mẫu, xem trước rồi áp dụng vào bước Nội dung.</span>
              </div>
            </div>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setContentTemplatePicker(null)}
              title="Đóng"
              aria-label="Đóng danh sách mẫu nội dung"
            >
              <X size={18} />
            </button>
          </div>
          <div className="content-template-picker-body content-template-picker-v2-body">
            <aside className="content-template-picker-v2-groups" aria-label="Nhóm nội dung">
              <div className="content-template-picker-v2-panel-title">
                <strong>NHÓM NỘI DUNG</strong>
                <span>{visibleGroups.length}</span>
              </div>
              <label className="content-template-picker-v2-compact-search">
                <Search size={14} />
                <input
                  value={contentTemplatePicker.groupSearchQuery}
                  onChange={event => updateGroupFilters({ groupSearchQuery: event.target.value })}
                  placeholder="Tìm nhóm..."
                  aria-label="Tìm nhóm mẫu nội dung"
                />
              </label>
              <div className="content-template-picker-v2-segments" role="group" aria-label="Trạng thái nhóm">
                {([
                  ['all', 'Tất cả'],
                  ['active', 'Đang bật'],
                  ['inactive', 'Đã tắt']
                ] as const).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={contentTemplatePicker.groupStatus === value ? 'active' : ''}
                    aria-pressed={contentTemplatePicker.groupStatus === value}
                    onClick={() => updateGroupFilters({ groupStatus: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="content-template-picker-v2-match-chip"><Braces size={13} />{getContentTemplateChannelLabel(targetChannel)}</div>
              <div className="content-template-picker-v2-group-list">
                <button type="button" className={contentTemplatePicker.groupId === null ? 'active' : ''} aria-pressed={contentTemplatePicker.groupId === null} onClick={() => selectGroup(null)}>
                  <FolderOpen size={15} />
                  <span><strong>Tất cả mẫu</strong><small>Mẫu phù hợp chiến dịch</small></span>
                  <em>{groupCompatibleCount(null)}</em>
                </button>
                <button type="button" className={contentTemplatePicker.groupId === 'ungrouped' ? 'active' : ''} aria-pressed={contentTemplatePicker.groupId === 'ungrouped'} onClick={() => selectGroup('ungrouped')}>
                  <FileText size={15} />
                  <span><strong>Chưa phân nhóm</strong><small>Mẫu chưa gắn nhóm</small></span>
                  <em>{groupCompatibleCount('ungrouped')}</em>
                </button>
                {visibleGroups.map(group => (
                  <button
                    type="button"
                    key={group.id}
                    className={`${contentTemplatePicker.groupId === group.id ? 'active' : ''}${group.isActive ? '' : ' inactive'}`}
                    aria-pressed={contentTemplatePicker.groupId === group.id}
                    onClick={() => selectGroup(group.id)}
                  >
                    <FolderCog size={15} />
                    <span><strong>{group.name}</strong><small>{group.isActive ? (group.description || 'Nhóm mẫu nội dung') : 'Ngừng hoạt động'}</small></span>
                    <em>{groupCompatibleCount(group.id)}</em>
                  </button>
                ))}
              </div>
              <div className="content-template-picker-v2-groups-note">Chỉ hiển thị mẫu có nội dung phù hợp với hành động đang chọn.</div>
            </aside>

            <section className="content-template-picker-v2-library" aria-label="Danh sách mẫu phù hợp">
              <div className="content-template-picker-v2-toolbar">
                <label className="content-template-picker-search">
                  <Search size={15} />
                  <input
                    value={contentTemplatePicker.searchQuery}
                    onChange={event => setContentTemplatePicker(previous => previous ? {
                      ...previous,
                      searchQuery: event.target.value,
                      selectedTemplateId: null
                    } : previous)}
                    placeholder="Tìm theo tên mẫu hoặc nội dung..."
                    aria-label="Tìm mẫu nội dung"
                  />
                </label>
                <div className="content-template-picker-v2-channel-filter"><Braces size={14} /><span>{getContentTemplateChannelLabel(targetChannel)}</span></div>
                <button
                  type="button"
                  className="btn-icon content-template-picker-refresh"
                  onClick={() => void loadContentTemplates()}
                  disabled={contentTemplatesLoading}
                  title="Tải lại danh sách"
                  aria-label="Tải lại danh sách mẫu nội dung"
                >
                  <RefreshCw size={15} className={contentTemplatesLoading ? 'spin' : ''} />
                </button>
              </div>
              <div className="content-template-picker-v2-listbar">
                <div><strong>{sortedTemplates.length} mẫu nội dung</strong><span>Đã lọc theo {getContentTemplateChannelLabel(targetChannel)}</span></div>
                <select
                  value={contentTemplatePicker.sort}
                  onChange={event => setContentTemplatePicker(previous => previous ? {
                    ...previous,
                    sort: event.target.value as ContentTemplatePickerModalState['sort']
                  } : previous)}
                  aria-label="Sắp xếp mẫu nội dung"
                >
                  <option value="newest">Mới cập nhật</option>
                  <option value="oldest">Cũ nhất</option>
                  <option value="name">Tên A → Z</option>
                  <option value="variants">Nhiều biến thể nhất</option>
                </select>
                <div className="content-template-picker-v2-view-switch" role="group" aria-label="Kiểu hiển thị">
                  <button type="button" className={contentTemplatePicker.view === 'card' ? 'active' : ''} aria-label="Xem dạng thẻ" aria-pressed={contentTemplatePicker.view === 'card'} onClick={() => setContentTemplatePicker(previous => previous ? { ...previous, view: 'card' } : previous)} title="Xem dạng thẻ"><LayoutGrid size={15} /></button>
                  <button type="button" className={contentTemplatePicker.view === 'list' ? 'active' : ''} aria-label="Xem dạng danh sách" aria-pressed={contentTemplatePicker.view === 'list'} onClick={() => setContentTemplatePicker(previous => previous ? { ...previous, view: 'list' } : previous)} title="Xem dạng danh sách"><List size={15} /></button>
                  <button type="button" className={contentTemplatePicker.view === 'detail' ? 'active' : ''} aria-label="Xem chi tiết biến thể" aria-pressed={contentTemplatePicker.view === 'detail'} onClick={() => setContentTemplatePicker(previous => previous ? { ...previous, view: 'detail' } : previous)} title="Xem chi tiết biến thể"><Rows3 size={15} /></button>
                </div>
              </div>
              <div className={`content-template-picker-v2-results ${contentTemplatePicker.view}`}>
                {contentTemplatesLoading ? (
                  <div className="content-template-picker-empty">Đang tải mẫu nội dung...</div>
                ) : sortedTemplates.length === 0 ? (
                  <div className="content-template-picker-empty">
                    {contentTemplates.length === 0
                      ? 'Chưa có mẫu nội dung.'
                      : 'Không có mẫu nội dung phù hợp với chiến dịch và bộ lọc hiện tại.'}
                  </div>
                ) : contentTemplatePicker.view === 'card' ? (
                  <div className="content-template-picker-v2-card-grid">{sortedTemplates.map(renderTemplateCard)}</div>
                ) : contentTemplatePicker.view === 'list' ? (
                  <div className="content-template-picker-v2-table">
                    <div className="content-template-picker-v2-table-head"><span>Mẫu nội dung</span><span>Nhóm</span><span>Biến thể</span><span>Media</span></div>
                    {sortedTemplates.map(({ template, resolved }) => {
                      const selected = selectedTemplate?.id === template.id
                      const mediaCount = targetChannel === 'sms' || contentTemplatePicker.target === 'postBumpContent'
                        ? 0
                        : filterTargetTemplateMediaUrls(resolved.imageUrls).length
                      return (
                        <button type="button" key={template.id} className={selected ? 'is-selected' : ''} aria-pressed={selected} onClick={() => selectTemplate(template.id)}>
                          <span className="content-template-picker-v2-table-name"><span className={`content-template-picker-v2-mark${selected ? ' is-selected' : ''}`}>{selected && <Check size={11} />}</span><strong>{template.name}</strong></span>
                          <span>{template.groupName || 'Chưa phân nhóm'}</span>
                          <span>{resolved.variants.length}</span>
                          <span>{mediaCount}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="content-template-picker-v2-detail-list">
                    {sortedTemplates.map(({ template, resolved }) => {
                      const selected = selectedTemplate?.id === template.id
                      return (
                        <button type="button" key={template.id} className={selected ? 'is-selected' : ''} aria-pressed={selected} onClick={() => selectTemplate(template.id)}>
                          <div className="content-template-picker-v2-detail-head">
                            <span className={`content-template-picker-v2-mark${selected ? ' is-selected' : ''}`}>{selected && <Check size={11} />}</span>
                            <strong>{template.name}</strong>
                            <span>{template.groupName || 'Chưa phân nhóm'}</span>
                          </div>
                          <div className="content-template-picker-v2-variant-lines">
                            {resolved.variants.slice(0, 3).map((variant, index) => (
                              <span key={index}><em>BT {index + 1}</em>{resolved.rich ? formattedContentToPlainText(variant) : variant}</span>
                            ))}
                            {resolved.variants.length > 3 && <small>+{resolved.variants.length - 3} biến thể khác</small>}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>

            <section className="content-template-picker-preview content-template-picker-v2-preview" aria-label="Xem trước mẫu nội dung">
                {selectedTemplate && selectedResolved ? (
                  <>
                    <div className="content-template-picker-preview-header">
                      <div>
                        <strong>{selectedTemplate.name}</strong>
                        <span>Mẫu này có nội dung phù hợp với chiến dịch</span>
                      </div>
                    </div>
                    <div className="content-template-picker-v2-platform-chip"><span>{getContentTemplateChannelLabel(targetChannel)}</span><em>Mẫu phù hợp</em></div>
                    <div className="content-template-picker-preview-meta">
                      <strong>{getContentTemplateChannelLabel(targetChannel)}</strong>
                      <span>
                        Đang bật · {previewVariants.length} biến thể · {previewImageUrls.length} media
                      </span>
                    </div>
                    <div className="content-template-picker-preview-scroll">
                      <ContentTemplatePreview
                        key={`${selectedTemplate.id}:${targetChannel}`}
                        channel={targetChannel}
                        variants={previewVariants}
                        formatted={previewFormatted}
                        subject={selectedResolved.subject}
                        imageUrls={previewImageUrls}
                        showSampleData
                      />
                    </div>
                    <div className="content-template-picker-v2-sample-data">
                      <strong>DỮ LIỆU THAY THẾ KHI GỬI</strong>
                      <span><code>{'#{FULL_NAME}'}</code> Nguyễn Thị Lan</span>
                      <span><code>{'#{PHONE}'}</code> 0938 xxx 214</span>
                    </div>
                  </>
                ) : (
                  <div className="content-template-picker-preview-empty">
                    <FileText size={32} />
                    <strong>Chưa có mẫu để xem trước</strong>
                    <span>Thay đổi bộ lọc hoặc tạo thêm mẫu phù hợp với chiến dịch.</span>
                  </div>
                )}
            </section>
          </div>
          <div className="modal-footer content-template-picker-v2-footer">
            <span>{selectedTemplate ? `Đã chọn: ${selectedTemplate.name}` : 'Chưa chọn mẫu nội dung'}</span>
            <div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContentTemplatePicker(null)}>Huỷ</button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => selectedTemplate && applyContentTemplate(selectedTemplate)}
                disabled={!selectedTemplate || contentTemplatesLoading}
              >
                <Check size={14} /> Áp dụng mẫu
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderContentTemplateGroupPickerModal = () => {
    if (previewContentTemplateGroupId === null) return null

    const query = contentTemplateGroupSearch.trim().toLocaleLowerCase('vi')
    const visibleGroups = contentTemplateGroups
      .filter(group => !group.isDelete)
      .filter(group => contentTemplateGroupStatus === 'all' || (contentTemplateGroupStatus === 'active' ? group.isActive : !group.isActive))
      .filter(group => !query || `${group.name}\n${group.description || ''}`.toLocaleLowerCase('vi').includes(query))
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, 'vi'))
    const selectedGroup = contentTemplateGroups.find(item => item.id === previewContentTemplateGroupId && !item.isDelete) || null
    const group = visibleGroups.find(item => item.id === previewContentTemplateGroupId) || null
    const selectedGroupHiddenByFilter = !!selectedGroup && !group
    const templates = group
      ? contentTemplates.filter(template => template.groupId === group.id && !template.isDelete)
      : []
    const groupCandidate = group && advancedContentTargetChannel
      ? buildContentTemplateGroupCandidate(contentTemplates, group, advancedContentTargetChannel, mainMediaSelectionMode)
      : null
    const groupIsInactive = group?.isActive === false
    const groupHasNoCompatibleItems = !!groupCandidate && groupCandidate.variantCount === 0
    const groupExceedsSmsSnapshotLimit = isSmsCampaign && !!groupCandidate && groupCandidate.variantCount > MAX_SMS_ADVANCED_CONTENT_ITEMS
    const groupCanBeUsed = !!groupCandidate && !groupIsInactive && !groupHasNoCompatibleItems && !groupExceedsSmsSnapshotLimit
    const invalidGroupMessage = groupIsInactive
      ? 'Nhóm này đã ngừng hoạt động nên chưa thể dùng cho snapshot mới.'
      : groupHasNoCompatibleItems
        ? `Nhóm chưa có mẫu ${advancedContentTargetChannel ? getContentTemplateChannelLabel(advancedContentTargetChannel) : ''} phù hợp với chiến dịch.`
        : groupExceedsSmsSnapshotLimit
          ? `Nhóm có ${groupCandidate?.variantCount || 0} nội dung SMS, vượt giới hạn ${MAX_SMS_ADVANCED_CONTENT_ITEMS}.`
          : null
    const titleId = `campaign-group-picker-title-${modalZIndex || 3000}`

    const selectGroup = (nextGroup: ContentTemplateGroup) => {
      const groupTemplates = contentTemplates.filter(template => template.groupId === nextGroup.id && !template.isDelete)
      const initialTemplate = advancedContentTargetChannel
        ? groupTemplates.find(template => resolveContentTemplate(template, advancedContentTargetChannel).variants.length > 0) || groupTemplates[0] || null
        : groupTemplates[0] || null
      setPreviewContentTemplateGroupId(nextGroup.id)
      setPreviewContentTemplateId(initialTemplate?.id ?? null)
      setPreviewContentTemplateChannel(getInitialContentTemplatePreviewChannel(initialTemplate, advancedContentTargetChannel))
    }

    const useSelectedGroup = () => {
      if (!groupCanBeUsed || !groupCandidate) return
      setCandidateContentTemplateGroupId(groupCandidate.groupId)
      setPendingContentTemplateGroupId(groupCandidate.groupId)
      closeContentTemplateGroupPreview()
    }

    return (
      <div className="modal-overlay campaign-picker-modal-overlay" style={{ zIndex: Math.max(3150, (modalZIndex || 3000) + 150) }}>
        <div className="campaign-group-picker-v2-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="modal-header content-template-picker-v2-header">
            <div className="content-template-picker-v2-heading">
              <span className="content-template-picker-v2-heading-icon"><FolderOpen size={19} /></span>
              <div>
                <span className="modal-title" id={titleId}>Chọn nhóm mẫu cho chiến dịch</span>
                <span>Mỗi lượt chạy sẽ xoay vòng qua các mẫu phù hợp trong nhóm.</span>
              </div>
            </div>
            <button type="button" className="btn-icon" onClick={closeContentTemplateGroupPreview} title="Đóng" aria-label="Đóng hộp chọn nhóm mẫu"><X size={18} /></button>
          </div>

          <div className="campaign-group-picker-v2-body">
            <aside className="content-template-picker-v2-groups campaign-group-picker-v2-groups">
              <div className="content-template-picker-v2-panel-title"><strong>NHÓM MẪU</strong><span>{contentTemplateGroups.filter(item => !item.isDelete).length}</span></div>
              <label className="content-template-picker-v2-compact-search">
                <Search size={14} />
                <input value={contentTemplateGroupSearch} onChange={event => setContentTemplateGroupSearch(event.target.value)} placeholder="Tìm nhóm..." aria-label="Tìm nhóm mẫu cho chiến dịch" />
              </label>
              <div className="content-template-picker-v2-segments" role="group" aria-label="Trạng thái nhóm mẫu">
                {(['all', 'active', 'inactive'] as const).map(status => (
                  <button type="button" key={status} className={contentTemplateGroupStatus === status ? 'active' : ''} aria-pressed={contentTemplateGroupStatus === status} onClick={() => setContentTemplateGroupStatus(status)}>
                    {status === 'all' ? 'Tất cả' : status === 'active' ? 'Đang dùng' : 'Đã tắt'}
                  </button>
                ))}
              </div>
              {advancedContentTargetChannel && (
                <div className="content-template-picker-v2-match-chip"><Check size={13} /> Phù hợp: {getContentTemplateChannelLabel(advancedContentTargetChannel)}</div>
              )}
              <div className="content-template-picker-v2-group-list campaign-group-picker-v2-group-list" role="group" aria-label="Chọn nhóm mẫu cho chiến dịch">
                {visibleGroups.map(item => {
                  const candidate = advancedContentTargetChannel
                    ? buildContentTemplateGroupCandidate(contentTemplates, item, advancedContentTargetChannel, mainMediaSelectionMode)
                    : null
                  const active = item.id === previewContentTemplateGroupId
                  return (
                    <button type="button" key={item.id} className={`${active ? 'active' : ''}${item.isActive ? '' : ' inactive'}`} aria-pressed={active} onClick={() => selectGroup(item)}>
                      <span className={`campaign-group-picker-v2-radio${active ? ' active' : ''}`}>{active && <Check size={10} />}</span>
                      <span><strong>{item.name}</strong><small>{item.isActive ? `${candidate?.compatibleTemplateCount || 0} mẫu phù hợp` : 'Ngừng hoạt động'}</small></span>
                      <em>{candidate?.compatibleTemplateCount || 0}</em>
                    </button>
                  )
                })}
                {visibleGroups.length === 0 && <div className="campaign-group-picker-v2-no-groups">Không tìm thấy nhóm phù hợp.</div>}
              </div>
              <button type="button" className="campaign-group-picker-v2-manage" onClick={() => advancedContentTargetChannel && openContentTemplateManager(advancedContentTargetChannel)} disabled={!onOpenContentTemplates}><Plus size={14} /> Tạo / quản lý nhóm</button>
            </aside>

            <main className="campaign-group-picker-v2-main">
              {group && groupCandidate ? (
                <>
                  <div className="campaign-group-picker-v2-hero">
                    <span className="campaign-group-picker-v2-hero-icon"><FolderOpen size={23} /></span>
                    <div><strong>{group.name}</strong><span>{group.description || 'Nhóm mẫu nội dung dùng lại cho chiến dịch.'}</span></div>
                    <span className={`campaign-group-picker-v2-status${group.isActive ? ' active' : ''}`}>{group.isActive ? 'Đang dùng' : 'Đã tắt'}</span>
                  </div>

                  <div className="campaign-group-picker-v2-stats">
                    <article><strong>{groupCandidate.totalTemplateCount}</strong><span>Tổng số mẫu</span></article>
                    <article className="success"><strong>{groupCandidate.compatibleTemplateCount}</strong><span>Sẽ sử dụng</span></article>
                    <article className={groupCandidate.skippedTemplateCount > 0 ? 'warning' : ''}><strong>{groupCandidate.skippedTemplateCount}</strong><span>Sẽ bỏ qua</span></article>
                    <article><strong>{groupCandidate.variantCount}</strong><span>Biến thể phù hợp</span></article>
                  </div>

                  {invalidGroupMessage ? (
                    <div className="campaign-group-picker-v2-warning"><X size={15} /><span>{invalidGroupMessage}</span></div>
                  ) : (
                    <div className="campaign-group-picker-v2-ready"><Check size={15} /><span>Nhóm sẵn sàng cho chiến dịch {advancedContentTargetChannel ? getAdvancedContentCampaignLabel(advancedContentTargetChannel) : 'hiện tại'}.</span></div>
                  )}

                  <section className="campaign-group-picker-v2-section">
                    <div className="campaign-group-picker-v2-section-heading"><div><strong>MẪU TRONG NHÓM</strong><span>Chỉ mẫu có nội dung đúng kênh mới được đưa vào snapshot.</span></div><span>{templates.length} mẫu</span></div>
                    <div className="campaign-group-picker-v2-template-list">
                      {templates.map((template, index) => {
                        const resolved = advancedContentTargetChannel
                          ? resolveContentTemplate(template, advancedContentTargetChannel)
                          : null
                        const compatibleMediaCount = resolved
                          ? contentTemplateImagesToSnapshots(resolved.imageUrls, mainMediaSelectionMode).snapshots.length
                          : 0
                        const willUse = !!resolved && resolved.variants.length > 0 && (mainMediaSelectionMode !== 'video' || compatibleMediaCount > 0)
                        const firstVariant = resolved?.variants[0] || ''
                        const excerpt = firstVariant
                          ? (resolved?.rich ? formattedContentToPlainText(firstVariant) : firstVariant)
                          : 'Không có nội dung phù hợp với chiến dịch.'
                        return (
                          <article key={template.id} className={willUse ? 'will-use' : 'skipped'}>
                            <span className="campaign-group-picker-v2-order">{index + 1}</span>
                            <div><strong>{template.name}</strong><p>{excerpt}</p><span>{resolved?.variants.length || 0} biến thể · {compatibleMediaCount} media</span></div>
                            <span className="campaign-group-picker-v2-template-status">{willUse ? <><Check size={13} /> Sẽ dùng</> : <><X size={13} /> Bỏ qua</>}</span>
                          </article>
                        )
                      })}
                      {templates.length === 0 && <div className="campaign-group-picker-v2-empty"><FileText size={30} /><strong>Nhóm chưa có mẫu nội dung</strong><span>Mở kho mẫu để thêm nội dung vào nhóm này.</span></div>}
                    </div>
                  </section>

                  <section className="campaign-group-picker-v2-rotation">
                    <div><RefreshCw size={16} /><span><strong>Cách phân phối nội dung</strong><small>Xoay vòng tự động theo thứ tự mẫu và biến thể trong snapshot.</small></span></div>
                    <span>Tuần tự</span>
                  </section>
                </>
              ) : (
                <div className="campaign-group-picker-v2-empty">
                  <FolderOpen size={34} />
                  <strong>{selectedGroupHiddenByFilter ? 'Nhóm đang chọn bị ẩn bởi bộ lọc' : 'Chọn một nhóm mẫu'}</strong>
                  <span>{selectedGroupHiddenByFilter ? 'Đổi bộ lọc hoặc chọn một nhóm đang hiển thị để tiếp tục.' : 'Thông tin phù hợp với chiến dịch sẽ hiển thị tại đây.'}</span>
                </div>
              )}
            </main>
          </div>

          <div className="modal-footer content-template-picker-v2-footer campaign-group-picker-v2-footer">
            <span>{groupCandidate ? `Sẽ dùng ${groupCandidate.compatibleTemplateCount}/${groupCandidate.totalTemplateCount} mẫu · ${groupCandidate.variantCount} biến thể` : selectedGroupHiddenByFilter ? 'Nhóm đang chọn không nằm trong bộ lọc hiện tại' : 'Chưa chọn nhóm mẫu'}</span>
            <div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={closeContentTemplateGroupPreview}>Huỷ</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={useSelectedGroup} disabled={!groupCanBeUsed}><Check size={14} /> Dùng nhóm này</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderContentTemplateSaveModal = () => {
    if (!contentTemplateSaveModal) return null
    return (
      <div className="modal-overlay campaign-picker-modal-overlay" style={{ zIndex: Math.max(3100, (modalZIndex || 3000) + 100) }}>
        <div className="content-template-save-modal">
          <div className="modal-header">
            <span className="modal-title">Lưu mẫu cho {CONTENT_TEMPLATE_TARGET_LABELS[contentTemplateSaveModal.target]}</span>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setContentTemplateSaveModal(null)}
              disabled={contentTemplateSaving}
              title="Đóng"
              aria-label="Đóng form lưu mẫu"
            >
              <X size={18} />
            </button>
          </div>
          <div className="content-template-save-body content-template-save-form">
            <div className="stepper-form-group">
              <label>Tên mẫu <span className="required">*</span></label>
              <input
                className="stepper-input"
                value={contentTemplateSaveModal.name}
                onChange={event => setContentTemplateSaveModal(prev => prev ? { ...prev, name: event.target.value } : prev)}
                placeholder="Nhập tên mẫu nội dung"
                disabled={contentTemplateSaving}
                autoFocus
              />
            </div>
            <div className="stepper-form-group">
              <label>Nhóm mẫu</label>
              <select
                className="stepper-select"
                value={contentTemplateSaveModal.groupId ?? ''}
                onChange={event => setContentTemplateSaveModal(prev => prev
                  ? { ...prev, groupId: event.target.value ? Number(event.target.value) : null }
                  : prev)}
                disabled={contentTemplateSaving}
                aria-label="Chọn nhóm mẫu nội dung (không bắt buộc)"
              >
                <option value="">Không chọn nhóm</option>
                {contentTemplateGroups.filter(group => group.isActive).map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
              {contentTemplateGroups.filter(group => group.isActive).length === 0 && (
                <div className="schedule-hint">Chưa có nhóm hoạt động. Bạn vẫn có thể lưu mẫu mà không chọn nhóm.</div>
              )}
            </div>
            <div className="stepper-form-group">
              <label>Nội dung sẽ lưu</label>
              <textarea
                className="stepper-textarea content-template-save-textarea"
                value={contentTemplateSaveModal.content}
                rows={6}
                readOnly
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

  return createPortal(
    <div className="modal-overlay campaign-form-modal-overlay" style={modalZIndex ? { zIndex: modalZIndex } : undefined}>
      <div className="campaign-full-modal stepper-modal">
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">
            {draftMode ? 'Thêm chiến dịch' : campaign && campaign.id ? 'Sửa chiến dịch' : campaign ? 'Nhân bản chiến dịch' : 'Thêm chiến dịch'}
          </span>
          <button className="btn-icon" onClick={onClose} disabled={saveBusy} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        {/* Stepper Layout */}
        {saveBusy ? (
          <div className="campaign-save-loading-body" aria-hidden="true">
            <Loader2 size={28} className="animate-spin" />
            <span>{saveProgress?.label || 'Đang chuẩn bị dữ liệu chiến dịch...'}</span>
          </div>
        ) : (
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
                  {renderActionPlatformSwitcher()}

                  <div className="stepper-form-group">
                    <label>Hành động <span className="required">*</span></label>
                    <select
                      value={formData.actionId}
                      onChange={e => handleActionChange(e.target.value)}
                      className="stepper-input"
                      disabled={(draftMode && !!lockedActionId) || isSavedDataGroupIdentityLocked}
                    >
                      <option value="">
                        {filteredCampaignActions.length === 0 ? 'Chưa có hành động cho nền tảng này' : '-- Chọn hành động --'}
                      </option>
                      {filteredCampaignActions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>

                  <div className="stepper-form-group" ref={accountDropdownRef}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ margin: 0 }}>
                        {allowsSecondaryAccount ? 'Tài khoản chính' : 'Tài khoản'} <span className="required">*</span>
                      </label>
                      {selectableAccounts.length > 0 && !isSingleAccountSelection && !isSavedDataGroupIdentityLocked && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '2px 8px', fontSize: '12px', height: 'auto' }}
                          onClick={() => {
                            invalidateCampaignNameAiRequest()
                            setFormData(p => ({
                              ...p,
                              accountIds: selectedAllSelectableAccounts ? [] : selectableAccounts.map(a => a.id)
                            }))
                          }}
                        >
                          {selectedAllSelectableAccounts ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                        </button>
                      )}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <div
                        className="stepper-input"
                        style={{
                          cursor: isSavedDataGroupIdentityLocked ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          opacity: isSavedDataGroupIdentityLocked ? 0.65 : 1,
                          backgroundColor: isAccountDropdownOpen ? 'var(--bg-secondary)' : 'var(--bg-primary)'
                        }}
                        aria-disabled={isSavedDataGroupIdentityLocked}
                        onClick={() => {
                          if (!isSavedDataGroupIdentityLocked) setIsAccountDropdownOpen(!isAccountDropdownOpen)
                        }}
                      >
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
                          {formData.accountIds.length === 0
                            ? '-- Chọn tài khoản --'
                            : formData.accountIds.length === 1
                              ? (() => {
                                const account = accounts.find(a => a.id === formData.accountIds[0])
                                if (!account) return 'Đã chọn 1 tài khoản'
                                return account.flatformType === 'zalo'
                                  ? `${account.name} — ${getAccountPlatformLabel(account)}`
                                  : account.name
                              })()
                              : `Đã chọn ${formData.accountIds.length} tài khoản`}
                        </span>
                        <ChevronDown size={16} style={{ flexShrink: 0, transform: isAccountDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>

                      {isAccountDropdownOpen && !isSavedDataGroupIdentityLocked && (
                        <div className="account-select-menu">
                          <div className="account-checkbox-list account-select-tree">
                            {selectableAccountGroups.map(group => {
                              const groupAccounts = groupedSelectableAccounts.byGroup.get(group.id) || []
                              if (groupAccounts.length === 0) return null
                              const groupSelected = groupAccounts.every(account => selectedAccountIdsSet.has(account.id))
                              return (
                                <div className="account-select-group" key={group.id}>
                                  <label className="account-checkbox-option account-select-group-row">
                                    {!isSingleAccountSelection && (
                                      <input
                                        type="checkbox"
                                        checked={groupSelected}
                                        onChange={() => toggleSelectableAccounts(groupAccounts.map(account => account.id))}
                                      />
                                    )}
                                    <span title={`${group.name} (${groupAccounts.length})`}>{group.name} ({groupAccounts.length})</span>
                                  </label>
                                  <div className="account-select-group-items">
                                    {groupAccounts.map(a => {
                                      const isSmsAccount = a.flatformType === 'sms'

                                      return (
                                        <label key={a.id} className="account-checkbox-option account-select-account-row">
                                          <input
                                            type={isSingleAccountSelection ? "radio" : "checkbox"}
                                            name={isSingleAccountSelection ? "account-selection" : undefined}
                                            checked={selectedAccountIdsSet.has(a.id)}
                                            onChange={(e) => {
                                              if (isSingleAccountSelection) {
                                                selectSingleAccount(a.id)
                                              } else {
                                                toggleSelectableAccount(a.id, e.target.checked)
                                              }
                                            }}
                                          />
                                          <span className="account-select-account-label" title={isSmsAccount ? a.name : `${a.name} — ${getAccountPlatformLabel(a)} (${a.loginStatus || '-'})`}>
                                            <span className="account-select-account-name">{a.name}</span>
                                            {a.flatformType === 'zalo' && (
                                              <span className="account-select-login-status"> — {getAccountPlatformLabel(a)}</span>
                                            )}
                                            {!isSmsAccount && (
                                              <span className={`account-select-login-status ${getAccountLoginStatusClass(a.loginStatus || '')}`}>
                                                {' '}({a.loginStatus || '-'})
                                              </span>
                                            )}
                                          </span>
                                        </label>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            })}
                            {groupedSelectableAccounts.ungrouped.length > 0 && (
                              <div className="account-select-group">
                                <label className="account-checkbox-option account-select-group-row">
                                  {!isSingleAccountSelection && (
                                    <input
                                      type="checkbox"
                                      checked={groupedSelectableAccounts.ungrouped.every(account => selectedAccountIdsSet.has(account.id))}
                                      onChange={() => toggleSelectableAccounts(groupedSelectableAccounts.ungrouped.map(account => account.id))}
                                    />
                                  )}
                                  <span>Chưa có nhóm ({groupedSelectableAccounts.ungrouped.length})</span>
                                </label>
                                <div className="account-select-group-items">
                                  {groupedSelectableAccounts.ungrouped.map(a => {
                                    const isSmsAccount = a.flatformType === 'sms'

                                    return (
                                      <label key={a.id} className="account-checkbox-option account-select-account-row">
                                        <input
                                          type={isSingleAccountSelection ? "radio" : "checkbox"}
                                          name={isSingleAccountSelection ? "account-selection" : undefined}
                                          checked={selectedAccountIdsSet.has(a.id)}
                                          onChange={(e) => {
                                            if (isSingleAccountSelection) {
                                              selectSingleAccount(a.id)
                                            } else {
                                              toggleSelectableAccount(a.id, e.target.checked)
                                            }
                                          }}
                                        />
                                        <span className="account-select-account-label" title={isSmsAccount ? a.name : `${a.name} — ${getAccountPlatformLabel(a)} (${a.loginStatus || '-'})`}>
                                          <span className="account-select-account-name">{a.name}</span>
                                          {a.flatformType === 'zalo' && (
                                            <span className="account-select-login-status"> — {getAccountPlatformLabel(a)}</span>
                                          )}
                                          {!isSmsAccount && (
                                            <span className={`account-select-login-status ${getAccountLoginStatusClass(a.loginStatus || '')}`}>
                                              {' '}({a.loginStatus || '-'})
                                            </span>
                                          )}
                                        </span>
                                      </label>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                            {selectableAccounts.length === 0 && (
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '8px 0' }}>
                                {actionPlatformForAccountSelection ? 'Chưa có tài khoản phù hợp với nền tảng chiến dịch' : 'Chưa có tài khoản nào'}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {allowsSecondaryAccount && (
                    <div className="stepper-form-group">
                      <label>
                        Tài khoản phụ <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(không bắt buộc)</span>
                      </label>
                      <select
                        className="stepper-input"
                        value={formData.secondaryAccountId ?? ''}
                        disabled={formData.accountIds.length !== 1}
                        onChange={event => {
                          const value = event.target.value
                          setFormData(prev => ({
                            ...prev,
                            secondaryAccountId: value ? Number(value) : null
                          }))
                        }}
                      >
                        <option value="">-- Không sử dụng tài khoản phụ --</option>
                        {selectableSecondaryAccounts.map(account => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                            {account.flatformType === 'zalo' ? ` — ${getAccountPlatformLabel(account)}` : ''}
                            {account.flatformType !== 'sms' ? ` (${account.loginStatus || '-'})` : ''}
                          </option>
                        ))}
                      </select>
                      {formData.accountIds.length !== 1 && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                          Chọn đúng 1 tài khoản chính để cài đặt tài khoản phụ.
                        </div>
                      )}
                      {formData.accountIds.length === 1 && selectableSecondaryAccounts.length === 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                          Chưa có tài khoản phụ cùng nền tảng
                          {selectedActionPlatform === 'zalo' ? ' và cùng loại Zalo' : ''} phù hợp.
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
                        Tài khoản phụ sẽ được dùng để chạy chiến dịch khi hành động của tài khoản chính bị Facebook/Zalo tạm hạn chế.
                      </div>
                    </div>
                  )}

                  <div className="stepper-form-group">
                    <label>Tên chiến dịch <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => handleCampaignNameChange(e.target.value)}
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
                className={`stepper-section${isZaloMessageCampaign && !isZaloShareMessageMode ? ' has-message-personalization' : ''}${isZaloAddGroupMemberCampaign || isFacebookGroupInviteCampaign ? ' has-floating-dropdown' : ''}`}
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
                    {isZaloMessageGroupRealtimeCampaign
                      ? (
                        <>
                          {renderZaloRealtimeGroupSettings()}
                          <div style={{ borderTop: '1px solid var(--border-default)', margin: '18px 0' }} />
                          {renderZaloMessagePhoneActionOptions()}
                        </>
                      )
                      : isZaloCancelSentFriendRequestCampaign
                        ? renderZaloCancelSentFriendRequestActionOptions()
                      : isZaloAddGroupMemberCampaign
                        ? renderZaloAddGroupMemberSettings()
                      : isFacebookGroupInviteCampaign
                        ? renderFacebookGroupInviteSettings()
                      : isZaloMessagePhoneCampaign || isZaloMessageGroupMemberCampaign || isZaloMessageRemarketingCustomerCampaign || isZaloMessageFriendRecommendationCampaign
                      ? renderZaloMessagePhoneActionOptions()
                      : isZaloMessageFriendCampaign
                        ? renderZaloMessageFriendActionOptions()
                        : isZaloMessageGroupCampaign
                          ? renderZaloMessageGroupActionOptions()
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
                  {!isMobileManagedSmsCampaign && <div className="stepper-form-group">
                    <label>Lịch</label>
                    <div className="schedule-radio-group">
                      {([['daily', 'Hàng ngày'], ['weekly', 'Theo tuần'], ['monthly', 'Theo tháng']] as const).map(([value, label]) => (
                        <label key={value} className="schedule-radio-label">
                          <input
                            type="radio"
                            name="scheduleType"
                            value={value}
                            checked={formData.scheduleType === value}
                            disabled={isZaloMessageGroupRealtimeCampaign && value !== 'daily'}
                            onChange={() => setFormData(p => ({ ...p, scheduleType: value }))}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>}

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
                    {formData.scheduleType !== 'daily' && !isZaloMessageGroupRealtimeCampaign && !isMobileManagedSmsCampaign && (
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
                    {(formData.scheduleType === 'daily' || isZaloMessageGroupRealtimeCampaign || isMobileManagedSmsCampaign) && (
                      <div className="stepper-form-group schedule-end-date-field schedule-placeholder-field" aria-hidden="true" />
                    )}
                  </div>

                  {/* Monthly days */}
                  {formData.scheduleType === 'monthly' && !isMobileManagedSmsCampaign && (
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
                  {formData.scheduleType === 'weekly' && !isMobileManagedSmsCampaign && (
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
                  {formData.scheduleType === 'daily' && !isMobileManagedSmsCampaign && !isNewsfeedInteractionCampaign && !isZaloMessageBirthdayCampaign && !isZaloMessageGroupRealtimeCampaign && (
                    <div className="stepper-form-group">
                      <label className="schedule-checkbox-label schedule-option-label">
                        <input
                          type="checkbox"
                          checked={formData.continueNextDay}
                          onChange={e => setFormData(p => ({ ...p, continueNextDay: e.target.checked }))}
                        />
                        <span>Nếu chưa chạy hết data, hôm sau chiến dịch sẽ tiếp tục chạy theo thời gian hẹn giờ.</span>
                      </label>
                    </div>
                  )}

                  {!isDataGroupSource && (formData.scheduleType === 'weekly' || formData.scheduleType === 'monthly') && !isMobileManagedSmsCampaign && !isZaloMessageBirthdayCampaign && !isZaloMessageGroupRealtimeCampaign && !isZaloMessageFriendRecommendationCampaign && !isZaloCancelSentFriendRequestCampaign && (
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

                  {!isMobileManagedSmsCampaign && <div className="stepper-form-group" style={{ maxWidth: 320 }}>
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
                      <span>
                        Giờ dừng chạy trong ngày{' '}
                        <span className="schedule-hint-inline">(Không bật: dừng nhận lượt mới lúc 23:59 để cập nhật lịch ngày mới)</span>
                      </span>
                    </label>
                    <input
                      type="time"
                      value={formData.dailyStopTime}
                      onChange={e => setFormData(p => ({ ...p, dailyStopTime: e.target.value }))}
                      className="stepper-input"
                      disabled={!formData.useDailyStopTime}
                      title="Không bật thì chiến dịch vẫn dừng nhận lượt mới lúc 23:59 để cập nhật lịch ngày mới"
                    />
                  </div>}

                  {!isDataGroupSource && canUseRerunAfterCompletion && (
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
                        {isNewsfeedInteractionCampaign
                          ? 'Khi lướt xong, chiến dịch sẽ hẹn chạy lại sau số giờ đã nhập nếu vẫn còn trong hôm nay.'
                          : 'Khi chạy hết danh sách, chiến dịch sẽ hẹn chạy lại sau số giờ đã nhập nếu vẫn còn trong hôm nay.'}
                      </span>
                    </div>
                  )}

                  {!isMobileManagedSmsCampaign && renderMultiDailyTimeSlotsSection()}
                </div>
              )}
            </div>

            {/* Section 3: Giới hạn hành động */}
            {showLimitsSection && (
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
                    {canUseSleepBetweenActions && (
                      <div className="stepper-form-row">
                        <div className="stepper-form-group" style={{ maxWidth: 340 }}>
                          <label>Thời gian nghỉ giữa 2 lần gửi</label>
                          <div className="stepper-input-unit-wrap">
                            <input
                              type="number"
                              value={formData.sleepBetweenActions}
                              onChange={e => setFormData(p => ({ ...p, sleepBetweenActions: parseInt(e.target.value) || 0 }))}
                              className="stepper-input stepper-input-with-unit"
                            />
                            <span className="stepper-input-unit">giây</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {selectedAccountGroupNames.length > 0 && (
                      <div className="account-group-campaign-note">
                        Các tài khoản thuộc nhóm: {selectedAccountGroupNames.join(', ')}. Khi chạy, hệ thống ưu tiên {canUseSleepBetweenActions ? 'thời gian nghỉ và giới hạn' : 'giới hạn'} đã cài trong nhóm.
                      </div>
                    )}
                    {generalLimitActionCodes.length > 0 && (
                      <div className="action-limit-card-list">
                        {generalLimitActionCodes.map(actionCode => renderActionLimitCard(actionCode))}
                      </div>
                    )}
                    <label className="schedule-checkbox-label action-limit-continue-option">
                      <input
                        type="checkbox"
                        checked={formData.continueWhenActionLimitReached}
                        onChange={e => setFormData(p => ({ ...p, continueWhenActionLimitReached: e.target.checked }))}
                      />
                      <span>Chiến dịch sẽ tiếp tục chạy khi 1 trong các hành động đạt giới hạn</span>
                    </label>
                    <div className="schedule-hint action-limit-continue-note">
                      Mặc định là chỉ cần 1 trong các hành động đạt giới hạn là chiến dịch sẽ không chạy và tự động lại khi giới hạn được mở.
                    </div>
                    {isCommentSeedingFeedCampaign && (
                      <div className="stepper-form-group" style={{ maxWidth: 420, marginTop: 16 }}>
                        <label>Số bài cần comment trên mỗi group/page/profile</label>
                        <div className="stepper-input-unit-wrap">
                          <input
                            type="number"
                            min={1}
                            value={formData.postsPerTarget}
                            onChange={e => setFormData(p => ({ ...p, postsPerTarget: Math.max(1, Number(e.target.value) || 1) }))}
                            className="stepper-input stepper-input-with-unit"
                          />
                          <span className="stepper-input-unit">bài</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {canUseRecentDeliveryCooldown && (
              <div
                className="stepper-section"
                ref={el => { sectionRefs.current['deliveryCooldown'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('deliveryCooldown')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('deliveryCooldown')}</span>
                    <span className="stepper-section-title">Kiểm tra trùng lặp</span>
                  </div>
                  {collapsedSections['deliveryCooldown'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['deliveryCooldown'] && (
                  <div className="stepper-section-body">
                    <div className="stepper-form-group" style={{ maxWidth: 620 }}>
                      <label className="schedule-checkbox-label">
                        <input
                          type="checkbox"
                          checked={formData.recentDeliveryCooldownEnabled}
                          onChange={e => setFormData(p => ({
                            ...p,
                            recentDeliveryCooldownEnabled: e.target.checked,
                            recentDeliveryCooldownDays: e.target.checked && !Number.isInteger(p.recentDeliveryCooldownDays)
                              ? DEFAULT_RECENT_DELIVERY_COOLDOWN_DAYS
                              : p.recentDeliveryCooldownDays
                          }))}
                        />
                        <span>{recentDeliveryCooldownPrompt}</span>
                      </label>
                      <div className="stepper-input-unit-wrap" style={{ maxWidth: 220, marginTop: 10 }}>
                        <input
                          type="number"
                          min={MIN_RECENT_DELIVERY_COOLDOWN_DAYS}
                          max={MAX_RECENT_DELIVERY_COOLDOWN_DAYS}
                          step={1}
                          value={formData.recentDeliveryCooldownDays}
                          onChange={e => setFormData(p => ({
                            ...p,
                            recentDeliveryCooldownDays: Number(e.target.value)
                          }))}
                          className="stepper-input stepper-input-with-unit"
                          disabled={!formData.recentDeliveryCooldownEnabled}
                        />
                        <span className="stepper-input-unit">ngày</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

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

            {/* Section 4: Nội dung */}
            {showContentSection && <div
              className={`stepper-section${isMessageCampaign && !isZaloShareMessageMode ? ' has-message-personalization' : ''}`}
              ref={el => { sectionRefs.current['content'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('content')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">{getSectionNumber('content')}</span>
                  <span className="stepper-section-title">
                    {isEmailCampaign ? 'Nội dung email' : isMessageCampaign ? 'Nội dung tin nhắn' : 'Nội dung'}
                  </span>
                </div>
                {collapsedSections['content'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['content'] && (
                <div className="stepper-section-body">
                  {renderContentModeSegmented()}
                  {isSourceContentMode ? (
                    renderSourceContentSettings()
                  ) : (
                    <>
                      {renderPostBackgroundOption()}
                      {renderPostAsReelsOption()}
                      {isEmailCampaign && (
                        <>
                          {!isAdvancedContentMode && (
                            <div className="stepper-form-group">
                              <label>Tiêu đề email <span className="required">*</span></label>
                              <input
                                type="text"
                                className="stepper-input"
                                placeholder="Nhập tiêu đề email..."
                                value={formData.emailSubject}
                                onChange={e => setFormData(p => ({ ...p, emailSubject: e.target.value }))}
                              />
                            </div>
                          )}
                          {!isManualAdvancedSource && renderEmailBodyHtmlOption()}
                          <div className="stepper-form-group">
                            <label className="schedule-checkbox-label">
                              <input
                                type="checkbox"
                                checked={formData.emailCheckLinkClicks}
                                onChange={e => setFormData(p => ({ ...p, emailCheckLinkClicks: e.target.checked }))}
                              />
                              <span>Kiểm tra click vào link</span>
                            </label>
                          </div>
                        </>
                      )}
                      {isCommentSeedingCampaign ? (
                        isAdvancedContentMode
                          ? renderAdvancedContentEditor()
                          : renderCommentSeedingSettings()
                      ) : (
                        <>
                          {!isManualAdvancedSource && renderFormattedContentOption()}
                          {isAdvancedContentMode ? (
                            <>
                              {renderAdvancedContentEditor()}
                              {renderSmsContentMeta(false)}
                              {!isMobileManagedSmsCampaign && !isRichContentEditorEnabled && renderRewriteContentEachRunOption()}
                              {renderZaloOptOutLinkOption()}
                            </>
                          ) : (
                            <>
                              {isMessageCampaign ? (
                                <div className="campaign-message-content-layout">
                                  <div className="stepper-form-group campaign-message-content-tools">
                                    <label>{getCampaignContentLabel()}</label>
                                    {renderContentToolsRow('content')}
                                  </div>
                                  <div className="campaign-content-template-layout">
                                    <div className="stepper-form-group">
                                      {renderCampaignContentTextarea(false)}
                                    </div>
                                  </div>
                                  {renderSmsContentMeta()}
                                  {!isRichContentEditorEnabled && renderCampaignContentHint()}
                                  {!isMobileManagedSmsCampaign && !isRichContentEditorEnabled && renderRewriteContentEachRunOption()}
                                  {renderZaloOptOutLinkOption()}
                                </div>
                              ) : (
                                <div className="stepper-form-group">
                                  <label>{getCampaignContentLabel()}</label>
                                  {renderContentToolsRow('content')}
                                  {renderCampaignContentTextarea()}
                                </div>
                              )}

                              {!isMobileManagedSmsCampaign && !isFacebookJoinGroupCampaign && renderImagePicker('post', 'Media')}
                            </>
                          )}
                        </>
                      )}
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
                            checked={formData.enableGroupPostShareToJoinedGroups}
                            onChange={e => setFormData(p => ({ ...p, enableGroupPostShareToJoinedGroups: e.target.checked }))}
                          />
                          <span>Đăng bài dạng chia sẻ <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(mỗi lần đăng thì chia sẻ thêm cho 3 nhóm) - Chỉ dành cho nhóm mà bạn đã tham gia</em></span>
                        </label>
                      </div>

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
                    <span className="stepper-section-title">{findDataSourceSectionLabel}</span>
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

            {canUseDataGroupSource && !isSimpleCampaign && (
              <div
                className="stepper-section campaign-data-source-section"
                ref={el => { sectionRefs.current['dataTargetSource'] = el }}
              >
                <div
                  className="stepper-section-header campaign-data-source-header"
                  onClick={() => toggleSection('dataTargetSource')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('dataTargetSource')}</span>
                    <span className="stepper-section-title">Cách thêm data vào chiến dịch</span>
                    <span className="stepper-section-summary">
                      · {isDataGroupSource ? 'Chọn nhóm data' : 'Thêm trực tiếp'}
                    </span>
                  </div>
                  {collapsedSections['dataTargetSource'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>
                {!collapsedSections['dataTargetSource'] && (
                  <div className="stepper-section-body">
                    <div className="campaign-data-source-modes" role="radiogroup" aria-label="Cách thêm data vào chiến dịch">
                      <label className={`campaign-data-source-mode ${!isDataGroupSource ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="campaign-data-target-source"
                          checked={!isDataGroupSource}
                          disabled={Boolean(campaign?.id && campaign.dataTargetSourceMode === 'data_group')}
                          onChange={() => setFormData(previous => ({
                            ...previous,
                            dataTargetSourceMode: 'direct',
                            dataGroupId: null
                          }))}
                        />
                        <span className="campaign-data-source-radio" aria-hidden="true" />
                        <span>
                          <strong>Thêm trực tiếp data vào chiến dịch</strong>
                          <small>Nhập/import hoặc thêm từ nhóm vào danh sách data của chiến dịch.</small>
                        </span>
                      </label>
                      <label className={`campaign-data-source-mode ${isDataGroupSource ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="campaign-data-target-source"
                          checked={isDataGroupSource}
                          disabled={Boolean(campaign?.id && campaign.dataTargetSourceMode !== 'data_group')}
                          onChange={() => setFormData(previous => ({
                            ...previous,
                            dataTargetSourceMode: 'data_group',
                            splitDataAcrossAccounts: false,
                            refreshData: false,
                            findDataRerunEnabled: false,
                            multiDailyTimeSlotsEnabled: false,
                            useSuggestedFriends: false,
                            zaloFriendTargetMode: 'selected'
                          }))}
                        />
                        <span className="campaign-data-source-radio" aria-hidden="true" />
                        <span>
                          <strong>Chọn nhóm data để chạy</strong>
                          <small>Hệ thống tự lấy data hợp lệ theo hành động và tài khoản đã chọn.</small>
                        </span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {canUseDataGroupSource && !isSimpleCampaign && isDataGroupSource && (
              <div
                className="stepper-section campaign-data-group-section"
                ref={el => { sectionRefs.current['details'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('details')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('details')}</span>
                    <span className="stepper-section-title">Chọn data bằng cách chọn nhóm</span>
                    {selectedDataGroupName && (
                      <span className="stepper-section-summary">· {selectedDataGroupName}</span>
                    )}
                  </div>
                  {collapsedSections['details'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>
                {!collapsedSections['details'] && (
                  <div className="stepper-section-body campaign-data-group-section-body">
                    <div className="campaign-data-group-label">Chọn nhóm data</div>
                    <div className="campaign-data-group-picker-row">
                      <button
                        type="button"
                        className="campaign-data-group-control"
                        onClick={() => {
                          setDataGroupPickerMode('source')
                          setDataGroupPickerOpen(true)
                        }}
                      >
                        {selectedDataGroup ? (
                          <>
                            <span className="campaign-data-group-dot" style={{ background: selectedDataGroup.color || 'var(--accent-primary)' }} />
                            <span className="campaign-data-group-control-copy">
                              <strong>{selectedDataGroup.name}</strong>
                              <small>
                                {dataGroupTargetPreviewLabel}
                                {' · '}
                                {getDataGroupSemanticTypeName(selectedDataGroup)}
                              </small>
                            </span>
                          </>
                        ) : (
                          <>
                            <FolderOpen size={16} />
                            <span className="campaign-data-group-control-placeholder">{selectedDataGroupName || 'Chọn nhóm data...'}</span>
                          </>
                        )}
                        <ChevronDown size={17} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary campaign-data-group-pick-button"
                        onClick={() => {
                          setDataGroupPickerMode('source')
                          setDataGroupPickerOpen(true)
                        }}
                      >
                        <Plus size={15} /> {formData.dataGroupId ? 'Đổi nhóm' : 'Chọn nhóm'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Section 6: Danh sách data (hidden for simple campaigns) */}
            {!isSimpleCampaign && !hideDetailsSection && !isDataGroupSource && <div
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
                        : isFacebookJoinGroupCampaign
                          ? 'Danh sách group Facebook'
                          : isCommentSeedingPostCampaign
                            ? 'Danh sách bài post'
                            : isPagePostCampaign
                              ? 'Danh sách fanpage'
                              : isCommentSeedingCampaign
                                ? 'Danh sách group/page/profile'
                                : isZaloMessageFriendCampaign
                                  ? 'Danh sách bạn bè Zalo'
                                  : isZaloMessageGroupMemberCampaign
                                    ? 'Danh sách thành viên group Zalo'
                                    : isZaloMessageRemarketingCustomerCampaign
                                      ? 'Danh sách khách hàng cũ Zalo'
                                      : isZaloMessageGroupCampaign
                                        ? 'Danh sách group Zalo'
                                        : isZaloJoinGroupLinkCampaign
                                          ? 'Danh sách link group Zalo'
                                          : isFacebookGroupInviteCampaign
                                            ? 'Danh sách bạn bè cần mời'
                                            : isMessageFriendCampaign
                                              ? 'Danh sách bạn bè'
                                              : isPageInboxMessageCampaign
                                                ? 'Danh sách khách inbox Page'
                                                : isZaloMessagePhoneCampaign
                                                  ? 'Danh sách SĐT'
                                                  : isZaloAddGroupMemberCampaign
                                                    ? 'Danh sách thành viên cần thêm'
                                                    : isMessageUidCampaign
                                                      ? 'Danh sách UID'
                                                      : 'Danh sách data'}
                  </span>
                  {detailEntryCount > 0 && (
                    <span className="stepper-section-badge">{detailEntryCount}</span>
                  )}
                  {directDataGroupSnapshots.length > 0 && (
                    <span className="stepper-section-summary">· {directDataGroupSnapshots.length} nhóm chờ thêm</span>
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
                  {!isEditingSavedCampaign && formData.accountIds.length > 1 && !hasPendingDirectDataGroupSnapshots && (
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
                  {!isEditingSavedCampaign && formData.accountIds.length > 1 && hasPendingDirectDataGroupSnapshots && (
                    <div className="text-muted" style={{ marginBottom: 12, fontSize: 12 }}>
                      Khi thêm bằng nhóm, mỗi campaign con nhận toàn bộ data phù hợp với tài khoản của nó; không áp dụng Chia đều.
                    </div>
                  )}
                  {!isEditingSavedCampaign && (
                    <div className="stepper-grid-toolbar" style={{ display: 'flex', gap: 8 }}>
                      {canUploadData ? (
                        <button className="btn btn-secondary" onClick={openDataUploadModal}>
                          <Plus size={14} /> {isCommentSeedingPostCampaign ? 'Thêm link' : 'Thêm data'}
                        </button>
                      ) : !isFindDataSearchCampaign && !isFacebookGroupInviteCampaign && !isPagePostCampaign && !isPageInboxMessageCampaign && !isZaloMessageFriendCampaign && !isZaloMessageGroupMemberCampaign && !isZaloMessageRemarketingCustomerCampaign && !isZaloMessageFriendRecommendationCampaign && !isZaloMessageGroupCampaign && (
                        <button className="btn btn-secondary" onClick={addDetailRow}>
                          <Plus size={14} /> {isCommentSeedingPostCampaign ? 'Thêm link' : 'Thêm data'}
                        </button>
                      )}
                      {canUseDataGroupSource && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setDataGroupPickerMode('append')
                            setDataGroupPickerOpen(true)
                          }}
                          title="Chọn Nhóm data; DB sẽ thêm snapshot phù hợp khi lưu chiến dịch"
                        >
                          <FolderOpen size={14} />
                          Thêm bằng nhóm
                        </button>
                      )}
                      {canUseOtherDataSources && (
                        <div className="campaign-other-data-source" ref={otherDataSourceDropdownRef}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setIsOtherDataSourceOpen(prev => !prev)}
                          >
                            <ListChecks size={14} /> Nguồn khác <ChevronDown size={14} />
                          </button>
                          {isOtherDataSourceOpen && (
                            <div className="campaign-other-data-source-menu">
                              <button
                                type="button"
                                className="campaign-other-data-source-item"
                                onClick={openPageInboxPhoneSource}
                              >
                                <Users size={14} />
                                <span>Từ những người inbox fanpage</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {canPickFriends && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (formData.accountIds.length === 0) {
                              showAlert('Vui lòng chọn tài khoản trước.', 'error')
                              return
                            }
                            if (isFacebookGroupInviteCampaign && formData.accountIds.length !== 1) {
                              showAlert('Vui lòng chọn đúng 1 tài khoản Facebook trước.', 'error')
                              return
                            }
                            setDataScanPicker(isFacebookGroupInviteCampaign
                              ? {
                                action: 'facebook_friends',
                                mode: 'friends',
                                initialStatusFilter: 'active',
                                allowedActions: ['facebook_friends'],
                                lockAccount: true
                              }
                              : isZaloMessageFriendCampaign
                              ? {
                                action: 'zalo_friends',
                                mode: 'friends',
                                initialStatusFilter: 'active',
                                allowedActions: ['zalo_friends'],
                                lockAccount: true
                              }
                              : {
                                action: 'facebook_friends',
                                mode: 'friends',
                                allowedActions: ['facebook_friends']
                              })
                          }}
                          title="Chọn bạn bè từ danh sách liên hệ"
                        >
                          <Users size={14} /> {isZaloMessageFriendCampaign ? 'Chọn bạn bè Zalo' : isFacebookGroupInviteCampaign ? 'Chọn bạn bè cần mời' : 'Chọn bạn bè'}
                        </button>
                      )}
                      {canPickZaloAddGroupMemberFriends && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (formData.accountIds.length === 0) {
                              showAlert('Vui lòng chọn tài khoản trước.', 'error')
                              return
                            }
                            setDataScanPicker({
                              action: 'zalo_friends',
                              mode: 'friends',
                              initialStatusFilter: 'active',
                              allowedActions: ['zalo_friends'],
                              lockAccount: true
                            })
                          }}
                          title="Chọn bạn bè Zalo từ danh sách liên hệ"
                        >
                          <Users size={14} /> Chọn bạn bè Zalo
                        </button>
                      )}
                      {canPickZaloGroupMembers && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (formData.accountIds.length === 0) {
                              showAlert('Vui lòng chọn tài khoản trước.', 'error')
                              return
                            }
                            setDataScanPicker({
                              action: 'zalo_group_members',
                              mode: 'users',
                              initialStatusFilter: 'all',
                              allowedActions: ['zalo_group_members'],
                              lockAccount: true
                            })
                          }}
                          title="Chọn thành viên group Zalo từ danh sách data đã quét"
                        >
                          <Users size={14} /> Chọn thành viên group Zalo
                        </button>
                      )}
                      {canPickZaloRemarketingCustomers && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (formData.accountIds.length !== 1) {
                              showAlert('Vui lòng chọn tài khoản gửi để load danh sách khách hàng cũ Zalo.', 'error')
                              return
                            }
                            setDataScanPicker({
                              action: 'zalo_remarketing_customers',
                              mode: 'zaloRemarketingCustomers',
                              initialStatusFilter: 'all',
                              allowedActions: ['zalo_remarketing_customers'],
                              lockAccount: true
                            })
                          }}
                          title="Chọn khách hàng cũ Zalo từ lịch sử đã từng gửi tin"
                        >
                          <Users size={14} /> Chọn khách hàng cũ Zalo
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
                              allowedActions: ['facebook_friends', 'facebook_post_commenters', 'facebook_post_likes', 'facebook_profile_friends', 'facebook_group_members']
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
                            setDataScanPicker(isZaloMessageGroupCampaign
                              ? {
                                action: 'zalo_groups',
                                mode: 'groups',
                                initialStatusFilter: 'active',
                                allowedActions: ['zalo_groups'],
                                lockAccount: true
                              }
                              : {
                                action: 'facebook_groups',
                                mode: 'groups',
                                initialStatusFilter: 'all'
                              })
                          }}
                          title={isZaloMessageGroupCampaign ? 'Chọn group Zalo từ danh sách data' : isCommentSeedingFeedCampaign ? 'Chọn group để comment seeding' : 'Chọn group từ danh sách data'}
                        >
                          <Users size={14} /> {isZaloMessageGroupCampaign ? 'Chọn group Zalo' : 'Chọn nhóm'}
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
                        disabled={loadingDetails || directDataSourceSelectionCount === 0}
                        title="Xoá hết data trong danh sách"
                      >
                        <Trash2 size={14} /> Xoá hết
                      </button>
                    </div>
                  )}

                  {!isEditingSavedCampaign && directDataGroupSnapshots.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 10 }}>
                      {directDataGroupSnapshots.map(snapshot => (
                        <span
                          key={snapshot.groupId}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 8px',
                            border: '1px solid var(--border-color)',
                            borderRadius: 6,
                            color: 'var(--text-secondary)',
                            background: 'var(--bg-secondary)'
                          }}
                        >
                          <FolderOpen size={13} />
                          <span>{snapshot.groupName}</span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: 0, width: 18, minWidth: 18, height: 18 }}
                            aria-label={`Bỏ nhóm ${snapshot.groupName}`}
                            onClick={() => setDirectDataGroupSnapshots(previous => (
                              previous.filter(item => item.groupId !== snapshot.groupId)
                            ))}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {isFindDataSearchCampaign && !isEditingSavedCampaign ? (
                    <div className="stepper-form-group">
                      <label>Từ khóa search</label>
                      <textarea
                        className="stepper-textarea"
                        value={findDataSearchKeywordsText}
                        onChange={e => setFindDataSearchKeywordsText(e.target.value)}
                        placeholder="spa Hà Nội, thẩm mỹ viện, chăm sóc da"
                        rows={5}
                      />
                    </div>
                  ) : (
                    <div className="campaign-details-grid">
                      <div className="stepper-grid-container">
                        <table className="campaign-grid">
                          <thead>
                          {isCommentSeedingPostCampaign || isFindDataSearchCampaign || isFacebookJoinGroupCampaign || isZaloJoinGroupLinkCampaign ? (
                            <tr>
                              <th className="campaign-grid-index-col">STT</th>
                              <th>{isFindDataSearchCampaign ? 'Từ khóa' : isFacebookJoinGroupCampaign ? 'Group URL/UID' : isZaloJoinGroupLinkCampaign ? 'Link group Zalo' : 'Link bài post'}</th>
                              {!isEditingSavedCampaign && <th style={{ width: 40 }}></th>}
                            </tr>
                          ) : isPagePostCampaign ? (
                            <tr>
                              <th className="campaign-grid-index-col">STT</th>
                              <th>Tên fanpage</th>
                              <th>Page ID</th>
                              <th>Link</th>
                              {!isEditingSavedCampaign && <th style={{ width: 40 }}></th>}
                            </tr>
                          ) : (
                            <tr>
                              <th className="campaign-grid-index-col">STT</th>
                              <th>Tên</th>
                              <th>Số điện thoại</th>
                              {isMobileManagedSmsCampaign ? (
                                <>
                                  <th>Nhà mạng</th>
                                  <th>Info1</th>
                                  <th>Info2</th>
                                  <th>Info3</th>
                                  <th>Info4</th>
                                  <th>Info5</th>
                                </>
                              ) : (
                                <>
                                  <th>Uid</th>
                                  <th>Email</th>
                                </>
                              )}
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
                            visibleDetails.map((d, pageIndex) => {
                              const i = detailsPageStartIndex + pageIndex
                              return (
                                <tr key={d.id || `new-${i}`}>
                                <td className="campaign-grid-index-col">{i + 1}</td>
                                {isCommentSeedingPostCampaign || isFindDataSearchCampaign || isFacebookJoinGroupCampaign || isZaloJoinGroupLinkCampaign ? (
                                  <td>
                                    <input
                                      type="text"
                                      value={d.uid || ''}
                                      onChange={e => updateDetailRow(i, 'uid', e.target.value)}
                                      placeholder={isFindDataSearchCampaign ? 'Nhập từ khóa search...' : isFacebookJoinGroupCampaign ? 'Dán link hoặc UID group...' : isZaloJoinGroupLinkCampaign ? 'Dán link group Zalo...' : 'Dán link bài post...'}
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
                                    {isMobileManagedSmsCampaign ? (
                                      <>
                                        <td title={formatInputDataPhoneCarrier(d)}>
                                          <span>{formatInputDataPhoneCarrier(d)}</span>
                                        </td>
                                        <td>
                                          <input type="text" value={d.info1 || ''} onChange={e => updateDetailRow(i, 'info1', e.target.value)} placeholder="Info1..." disabled={isEditingSavedCampaign} />
                                        </td>
                                        <td>
                                          <input type="text" value={d.info2 || ''} onChange={e => updateDetailRow(i, 'info2', e.target.value)} placeholder="Info2..." disabled={isEditingSavedCampaign} />
                                        </td>
                                        <td>
                                          <input type="text" value={d.info3 || ''} onChange={e => updateDetailRow(i, 'info3', e.target.value)} placeholder="Info3..." disabled={isEditingSavedCampaign} />
                                        </td>
                                        <td>
                                          <input type="text" value={d.info4 || ''} onChange={e => updateDetailRow(i, 'info4', e.target.value)} placeholder="Info4..." disabled={isEditingSavedCampaign} />
                                        </td>
                                        <td>
                                          <input type="text" value={d.info5 || ''} onChange={e => updateDetailRow(i, 'info5', e.target.value)} placeholder="Info5..." disabled={isEditingSavedCampaign} />
                                        </td>
                                      </>
                                    ) : (
                                      <>
                                        <td>
                                          <input type="text" value={d.uid || ''} onChange={e => updateDetailRow(i, 'uid', e.target.value)} placeholder={isZaloJoinGroupLinkCampaign ? 'Dán link group Zalo...' : isZaloAddGroupMemberCampaign ? 'UID từ data quét...' : 'UID hoặc link...'} disabled={isEditingSavedCampaign || isZaloAddGroupMemberCampaign} />
                                        </td>
                                        <td>
                                          <input type="text" value={d.email || ''} onChange={e => updateDetailRow(i, 'email', e.target.value)} placeholder="Email..." disabled={isEditingSavedCampaign} />
                                        </td>
                                      </>
                                    )}
                                  </>
                                )}
                                {!isEditingSavedCampaign && (
                                  <td>
                                    <button className="btn-icon text-error" onClick={() => removeDetailRow(i)}><Trash2 size={14} /></button>
                                  </td>
                                )}
                                </tr>
                              )
                            })
                          )}
                          </tbody>
                        </table>
                      </div>
                      {details.length > 0 && (
                        <div className="campaign-local-data-pager">
                          <span>
                            Hiển thị {detailsPageStartIndex + 1}–{detailsPageEndIndex} / {details.length.toLocaleString('vi-VN')} data
                          </span>
                          <div>
                            <button
                              type="button"
                              className="btn-icon"
                              onClick={() => setDetailsPage(page => Math.max(1, page - 1))}
                              disabled={visibleDetailsPage <= 1 || loadingDetails}
                              title="Trang trước"
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <span>Trang {visibleDetailsPage}/{detailsPageCount}</span>
                            <button
                              type="button"
                              className="btn-icon"
                              onClick={() => setDetailsPage(page => Math.min(detailsPageCount, page + 1))}
                              disabled={visibleDetailsPage >= detailsPageCount || loadingDetails}
                              title="Trang sau"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>}

            {supportsExternalSmsPush && (
              <div
                className="stepper-section has-message-personalization"
                ref={el => { sectionRefs.current['externalSms'] = el }}
              >
                <div
                  className="stepper-section-header"
                  onClick={() => toggleSection('externalSms')}
                >
                  <div className="stepper-section-header-left">
                    <span className="stepper-section-num">{getSectionNumber('externalSms')}</span>
                    <span className="stepper-section-title">Gửi tin nhắn Sms</span>
                  </div>
                  {collapsedSections['externalSms'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!collapsedSections['externalSms'] && (
                  <div className="stepper-section-body">
                    {renderExternalSmsPushOption()}
                  </div>
                )}
              </div>
            )}
              </>
            )}
          </div>
          </div>
        )}

        {/* Footer */}
        <div className="modal-footer campaign-form-save-footer">
          <CampaignSaveControls
            starting={saveStarting}
            saving={savingCampaign}
            progress={saveProgress}
            idleLabel={submitLabel || (draftMode ? 'Chọn chiến dịch tạm' : 'Lưu chiến dịch')}
            onSave={handleSave}
            onCancel={onClose}
            onStartingChange={setSaveStarting}
          />
        </div>
      </div>
      {dataScanPicker && (formData.accountIds.length > 0 || dataScanPicker.mode === 'pageInboxPhones') && (
        <DataScanModal
          initialAction={dataScanPicker.action}
          initialAccountId={dataScanPicker.mode === 'pageInboxPhones' ? undefined : formData.accountIds[0]}
          initialStatusFilter={dataScanPicker.initialStatusFilter}
          allowedActions={dataScanPicker.allowedActions}
          lockAction
          lockAccount={!!dataScanPicker.lockAccount}
          showExcludeZaloGroupLeadershipOption={isZaloMessageGroupMemberCampaign}
          onClose={() => {
            const shouldReloadFacebookGroupInviteGroups = dataScanPicker.mode === 'facebookGroupInviteTarget'
            setDataScanPicker(null)
            if (shouldReloadFacebookGroupInviteGroups) {
              void loadFacebookGroupInviteGroupsFromLocal({ silent: true })
            }
          }}
          onSelect={
            dataScanPicker.mode === 'friends'
              ? onFriendsSelected
              : dataScanPicker.mode === 'users'
                ? onUsersSelected
                : dataScanPicker.mode === 'pages'
                  ? onPagesSelected
                  : dataScanPicker.mode === 'pageInboxCustomers'
                    ? onPageInboxCustomersSelected
                    : dataScanPicker.mode === 'pageInboxPhones'
                      ? onPageInboxPhonesSelected
                      : dataScanPicker.mode === 'zaloRemarketingCustomers'
                        ? onZaloRemarketingCustomersSelected
                        : dataScanPicker.mode === 'facebookGroupInviteTarget'
                          ? onFacebookGroupInviteTargetSelected
                        : onGroupsSelected
          }
        />
      )}
      {isDataUploadModalOpen && (
        <CampaignDataUploadModal
          platform={dataUploadPlatform}
          actionId={formData.actionId}
          actionName={selectedCampaignAction?.name}
          accountIds={formData.accountIds}
          showDatasetName={false}
          onClose={() => setIsDataUploadModalOpen(false)}
          onInsert={handleImportedDataRows}
          onSubmitRows={({ rows }) => handleImportedDataRows(rows)}
        />
      )}

      {dataGroupPickerOpen && (
        <DataGroupPickerModal
          selectedGroupId={dataGroupPickerMode === 'source' ? formData.dataGroupId : null}
          actionId={formData.actionId || undefined}
          onSelect={group => {
            if (!isDataGroupCompatibleWithCampaignAction(group, selectedCampaignAction)) {
              showAlert('Nhóm data này không tương thích với loại dữ liệu của hành động đã chọn.', 'error')
              return
            }
            if (dataGroupPickerMode === 'append') {
              appendDataGroupSnapshot(
                group.id,
                group.name,
                getDataGroupSemanticTypeId(group)
              )
              return
            }
            setFormData(previous => ({
              ...previous,
              dataTargetSourceMode: 'data_group',
              dataGroupId: group.id,
              splitDataAcrossAccounts: false,
              refreshData: false
            }))
            setSelectedDataGroupName(group.name)
            setSelectedDataGroup(group)
            setDataGroupPickerOpen(false)
          }}
          onClose={() => setDataGroupPickerOpen(false)}
        />
      )}
      {findDataGroupPickerKind && (
        <DataGroupPickerModal
          selectedGroupId={formData.findDataTargetDataGroups[findDataGroupPickerKind]?.groupId ?? null}
          actionId={FIND_DATA_GROUP_DESTINATION_CONFIG[findDataGroupPickerKind].actionId}
          onSelect={group => {
            const kind = findDataGroupPickerKind
            const targetActionId = FIND_DATA_GROUP_DESTINATION_CONFIG[kind].actionId
            const targetAction = campaignActions.find(action => action.id === targetActionId)
            if (!isDataGroupCompatibleWithCampaignAction(group, targetAction)) {
              showAlert('Nhóm data này không tương thích với loại dữ liệu đang tìm.', 'error')
              return
            }
            setFindDataTargetDataGroup(findDataGroupPickerKind, {
              groupId: group.id,
              groupName: group.name
            })
            setFindDataTargetDataGroupEnabled(previous => ({ ...previous, [kind]: true }))
            setFindDataTargetDataGroupDetails(previous => ({ ...previous, [kind]: group }))
            setFindDataGroupPickerKind(null)
          }}
          onClose={() => setFindDataGroupPickerKind(null)}
        />
      )}
      {!draftFormConfig && renderCampaignPickerModal()}
      {renderSourceCampaignViewModal()}
      {renderManualAdvancedContentModal()}
      {renderContentTemplatePickerModal()}
      {renderContentTemplateGroupPickerModal()}
      {renderContentTemplateSaveModal()}
      {contentPreviewModal && (
        <ContentPreviewModal
          data={contentPreviewModal}
          onClose={() => setContentPreviewModal(null)}
        />
      )}
      <input
        ref={localImageInputRef}
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={handleLocalMediaChange}
      />
      <input
        ref={localImageVideoInputRef}
        type="file"
        accept={IMAGE_VIDEO_FILE_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={handleLocalMediaChange}
      />
      <input
        ref={localVideoInputRef}
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={handleLocalMediaChange}
      />
      <input
        ref={localFileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleLocalMediaChange}
      />
      {mediaPickerTarget && (
        <MediaLibraryModal
          pickerMode={getMediaSelectionMode(mediaPickerTarget)}
          maxSelect={usesSingleCommentMediaSelection(mediaPickerTarget) ? 1 : undefined}
          onConfirm={handleMediaPickerConfirm}
          onClose={() => setMediaPickerTarget(null)}
        />
      )}
      {editingSourceCampaign && (
        <CampaignFormModal
          campaign={editingSourceCampaign}
          onOpenGeneralSettings={onOpenGeneralSettings}
          onOpenContentTemplates={onOpenContentTemplates}
          modalZIndex={3200}
          submitLabel="Sửa"
          onClose={() => {
            setEditingSourceCampaign(null)
            void loadCampaigns()
          }}
        />
      )}
      {draftFormConfig && (
        <CampaignFormModal
          campaign={draftFormConfig.initialCampaign || null}
          draftMode
          draftTempId={draftFormConfig.tempId}
          lockedActionId={draftFormConfig.actionId}
          initialAccountIds={draftFormConfig.initialAccountIds}
          initialDetails={draftFormConfig.initialDetails}
          initialDataGroupSnapshots={draftFormConfig.initialDataGroupSnapshots}
          draftPickerSourceType={draftFormConfig.sourceType}
          draftRequiredTargetField={draftFormConfig.requiredTargetField}
          onOpenGeneralSettings={onOpenGeneralSettings}
          onOpenContentTemplates={onOpenContentTemplates}
          onSaveDraft={handleDraftCampaignSaved}
          modalZIndex={3200}
          submitLabel={draftFormConfig.submitLabel}
          onClose={() => setDraftFormConfig(null)}
        />
      )}
    </div>,
    document.body
  )
}
