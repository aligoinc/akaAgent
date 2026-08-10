import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, FileText, FolderOpen, Image as ImageIcon, Plus, Save, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type {
  ActionLimitConfig,
  Campaign,
  CampaignAction,
  CampaignAdvancedContentItem,
  CampaignExtraSettings,
  CampaignMediaInput,
  CampaignMediaSnapshot,
  ContentTemplateChannelName
} from '../../../../shared/types'
import { renderContentSpinMax, splitContentVariants } from '../../../../shared/contentSpin'
import { MAX_SMS_ADVANCED_CONTENT_ITEMS } from '../../../../shared/smsContent'
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
  splitFormattedContentVariants,
  supportsFormattedContent
} from '../../../../shared/formattedContent'
import { useAuthStore } from '../../stores/authStore'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import {
  clampDailyLimitToEntitlement,
  getAccountActionDailySendLimit,
  getCampaignActionDailySendLimit
} from '../../utils/entitlements'
import { isZaloServerAccount } from '../../utils/accountLabels'
import MediaLibraryModal from '../Media/MediaLibraryModal'
import MediaPreviewHover from '../Media/MediaPreviewHover'
import EmailHtmlEditor from './EmailHtmlEditor'
import {
  getUniqueCampaignMediaAdditions,
  isCampaignMediaImage,
  isLocalOnlyCampaignMedia,
  selectLocalCampaignMedia,
  summarizeLocalCampaignMediaFailures
} from './localCampaignMedia'

type ActionLimitForm = Required<Pick<ActionLimitConfig, 'dailyLimit' | 'rateLimitCount' | 'rateLimitMinutes'>>
type ImageOption = 'none' | 'all' | 'random'
type CommentImageOption = ImageOption
type QuickMediaPickerTarget = 'post' | 'comment' | { kind: 'advanced'; itemId: string }

interface CampaignQuickEditModalProps {
  campaign: Campaign
  action?: CampaignAction
  onOpenContentTemplates?: (initialChannel?: ContentTemplateChannelName) => void
  onClose: () => void
}

interface CampaignLimitFormState {
  sleepBetweenActions: number
  dailyLimit: number
  rateLimitCount: number
  rateLimitMinutes: number
  continueWhenActionLimitReached: boolean
  actionLimitsByCode: Record<string, ActionLimitForm>
}

interface CampaignContentFormState {
  content: string
  formattedContentEnabled: boolean
  advancedContentEnabled: boolean
  advancedContentItems: CampaignAdvancedContentItem[]
  emailSubject: string
  emailBodyIsHtml: boolean
  emailCheckLinkClicks: boolean
  smsUseUnicode: boolean
  smsKeepNewLines: boolean
  rewriteContentEachRun: boolean
  postWithBackground: boolean
  zaloMessageSendMode: NonNullable<CampaignExtraSettings['zaloMessageSendMode']>
  imageOption: ImageOption
  randomImageCount: number
  images: CampaignMediaInput[]
  commentContent: string
  rewriteCommentContentEachRun: boolean
  commentImageOption: CommentImageOption
  commentImages: CampaignMediaInput[]
  friendRequestMessage: string
  postBumpContent: string
  newsfeedCommentContent: string
}

type AdvancedContentManualDraft = NonNullable<CampaignExtraSettings['advancedContentManualDraft']>

const projectAdvancedContentManualDraftToPlain = (
  draft: AdvancedContentManualDraft | undefined
): AdvancedContentManualDraft | undefined => {
  if (!draft) return undefined
  const wasRich = draft.formattedContentEnabled === true || draft.emailBodyIsHtml === true
  return {
    ...draft,
    content: wasRich
      ? formattedContentToPlainCampaignContent(draft.content)
      : String(draft.content || ''),
    advancedContentItems: normalizeAdvancedContentItems(draft.advancedContentItems).map(item => ({
      ...item,
      content: wasRich ? formattedContentToPlainText(item.content) : item.content
    })),
    formattedContentEnabled: false,
    emailBodyIsHtml: false
  }
}

const DEFAULT_RATE_LIMIT_MINUTES = 65
const DEFAULT_SLEEP_BETWEEN_ACTIONS = 30
const DEFAULT_SMS_SLEEP_BETWEEN_ACTIONS = 90
const ZALO_FIND_PHONE_ACTION_CODE = 'zalo_find_phone_user'
const ZALO_FIND_PHONE_DEFAULT_LIMIT = 1000
const NEWSFEED_INTERACTION_ACTION_ID = 'facebook_newsfeed_interaction'
const MESSAGE_UID_ACTION_ID = 'facebook_message_uid'
const FIND_DATA_GROUP_ACTION_ID = 'facebook_find_data_group'
const FIND_DATA_SEARCH_ACTION_ID = 'facebook_find_data_search'
const COMMENT_SEEDING_POST_ACTION_ID = 'facebook_comment_seeding_post'
const COMMENT_SEEDING_FEED_ACTION_ID = 'facebook_comment_seeding'
const FACEBOOK_GROUP_POST_ACTION_ID = 'facebook_group_post'
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
const VOICE_CALL_DEFAULT_RATE_LIMIT_MINUTES = 60
const VOICE_CALL_AI_DISCLOSURE = 'Đây là cuộc gọi tự động sử dụng giọng nói AI.'
const VOICE_CALL_MAX_TTS_INPUT_CHARS = 4096

const FIND_DATA_ACTION_IDS = new Set([FIND_DATA_GROUP_ACTION_ID, FIND_DATA_SEARCH_ACTION_ID])
const COMMENT_SEEDING_ACTION_IDS = new Set([COMMENT_SEEDING_FEED_ACTION_ID, COMMENT_SEEDING_POST_ACTION_ID])
const MESSAGE_CAMPAIGN_ACTION_IDS = new Set([
  'facebook_message_friend',
  MESSAGE_UID_ACTION_ID,
  'facebook_page_to_message',
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
const MESSAGE_CONTENT_TOGGLE_ACTION_IDS = new Set([
  MESSAGE_UID_ACTION_ID,
  ZALO_MESSAGE_PHONE_ACTION_ID,
  ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID,
  ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID,
  ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID,
  ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
])

const getQuickEditContentTemplateChannel = (actionId: string): ContentTemplateChannelName | undefined => {
  if (actionId === SMS_SEND_ACTION_ID) return 'sms'
  if (actionId === EMAIL_SEND_ACTION_ID) return 'email'
  if (COMMENT_SEEDING_ACTION_IDS.has(actionId)) return 'facebook_comment'
  if (actionId.startsWith('zalo_message_')) return 'zalo_message'
  if (['facebook_message_friend', MESSAGE_UID_ACTION_ID, 'facebook_page_to_message'].includes(actionId)) return 'facebook_message'
  if (['facebook_timeline_post', PAGE_POST_ACTION_ID, FACEBOOK_GROUP_POST_ACTION_ID].includes(actionId)) return 'facebook_post'
  return undefined
}

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

const getActionCodeLabel = (code: string) => ACTION_CODE_LABELS[code] || code
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

const normalizePositiveInteger = (value: unknown, fallback: number, min = 0): number => {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, parsed)
}

const normalizeRateLimitMinutes = (value: unknown): number => {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_MINUTES
}

const toActionLimitForm = (
  config?: ActionLimitConfig,
  fallback: ActionLimitForm = {
    dailyLimit: 30,
    rateLimitCount: 9,
    rateLimitMinutes: DEFAULT_RATE_LIMIT_MINUTES
  }
): ActionLimitForm => ({
  dailyLimit: config?.dailyLimit ?? fallback.dailyLimit,
  rateLimitCount: config?.rateLimitCount ?? fallback.rateLimitCount,
  rateLimitMinutes: config?.rateLimitMinutes ?? fallback.rateLimitMinutes
})

const isHiddenActionLimitConfig = (actionCode: string): boolean => actionCode === ZALO_FIND_PHONE_ACTION_CODE

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

const getImageDisplayName = (path: string): string => path.split(/[\\/]/).pop() || path
const isDataImagePath = (path: string): boolean => path.trim().startsWith('data:')
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

const isUsableCampaignMedia = (item: CampaignMediaInput): boolean => {
  const cloudUrl = getCampaignMediaCloudUrl(item).trim()
  if (cloudUrl) return true
  const localPath = getCampaignMediaLocalPath(item).trim()
  return isCampaignMediaLocalAvailable(localPath)
}

const getCampaignPlatform = (campaign: Campaign, action?: CampaignAction): string =>
  String(action?.flatformType || '').trim().toLowerCase() ||
  (campaign.actionId.startsWith('zalo_') ? 'zalo' :
    campaign.actionId === EMAIL_SEND_ACTION_ID ? 'email' :
      (campaign.actionId === SMS_SEND_ACTION_ID || campaign.actionId === VOICE_CALL_ACTION_ID) ? 'sms' : 'facebook')

const getLimitActionCodes = (campaign: Campaign, action?: CampaignAction): string[] => {
  const configuredCodes = action?.limitCheckActionCodes || []
  if (configuredCodes.length > 0) return configuredCodes
  return Object.keys(campaign.extraSettings?.actionLimits?.byActionCode || {})
}

const isLimitActionVisibleForCampaign = (campaign: Campaign, actionCode: string): boolean => {
  const extra = campaign.extraSettings || {}
  const actionId = campaign.actionId
  const enableMessage = extra.enableMessage !== false
  const enableAddFriend = extra.enableAddFriend === true

  if (actionId === MESSAGE_UID_ACTION_ID) {
    if (actionCode === 'fb_message_stranger') return enableMessage
    if (actionCode === 'fb_add_friend') return enableAddFriend
  }
  if (actionId === ZALO_MESSAGE_PHONE_ACTION_ID) {
    if (actionCode === ZALO_FIND_PHONE_ACTION_CODE) return true
    if (actionCode === 'zalo_message_friend') return false
    if (actionCode === 'zalo_message_stranger') return enableMessage
    if (actionCode === 'zalo_add_friend') return enableAddFriend
    if (actionCode === 'zalo_tag_contact' || actionCode === 'zalo_change_alias') return false
  }
  if (
    actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
    actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID ||
    actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
    actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
  ) {
    if (actionCode === 'zalo_message_stranger') return enableMessage
    if (actionCode === 'zalo_add_friend') return enableAddFriend
    if (actionCode === 'zalo_tag_contact' || actionCode === 'zalo_change_alias') return false
  }
  if (actionId === ZALO_MESSAGE_FRIEND_ACTION_ID || actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID) {
    if (actionCode === 'zalo_message_friend') return true
    if (actionCode === 'zalo_tag_contact' || actionCode === 'zalo_change_alias') return false
  }
  if (actionId === ZALO_MESSAGE_GROUP_ACTION_ID && actionCode === 'zalo_message_group') return true
  if (actionId === FACEBOOK_GROUP_POST_ACTION_ID && actionCode === 'fb_comment') return extra.enableComment === true
  if (COMMENT_SEEDING_ACTION_IDS.has(actionId)) {
    if (actionCode === 'fb_comment') return true
    if (actionCode === 'fb_like_post') return extra.enablePostLike === true
  }
  if (actionId === NEWSFEED_INTERACTION_ACTION_ID) {
    if (actionCode === 'fb_comment') return extra.enableComment === true
    if (actionCode === 'fb_like_post') return extra.enablePostLike === true
  }
  return true
}

const getInitialLimitFormState = (campaign: Campaign): CampaignLimitFormState => {
  const actionLimits = campaign.extraSettings?.actionLimits || {}
  const fallback: ActionLimitForm = {
    dailyLimit: actionLimits.dailyLimit ?? 30,
    rateLimitCount: actionLimits.rateLimitCount ?? 9,
    rateLimitMinutes: actionLimits.rateLimitMinutes
      ?? (campaign.actionId === VOICE_CALL_ACTION_ID ? VOICE_CALL_DEFAULT_RATE_LIMIT_MINUTES : DEFAULT_RATE_LIMIT_MINUTES)
  }
  const byActionCode = Object.fromEntries(
    Object.entries(actionLimits.byActionCode || {}).map(([code, limit]) => [
      code,
      toActionLimitForm(limit, fallback)
    ])
  )
  return {
    sleepBetweenActions: actionLimits.sleepBetweenActions ??
      (campaign.actionId === SMS_SEND_ACTION_ID ? DEFAULT_SMS_SLEEP_BETWEEN_ACTIONS : DEFAULT_SLEEP_BETWEEN_ACTIONS),
    dailyLimit: fallback.dailyLimit,
    rateLimitCount: fallback.rateLimitCount,
    rateLimitMinutes: fallback.rateLimitMinutes,
    continueWhenActionLimitReached: typeof actionLimits.continueWhenActionLimitReached === 'boolean'
      ? actionLimits.continueWhenActionLimitReached
      : false,
    actionLimitsByCode: byActionCode
  }
}

const getInitialContentFormState = (campaign: Campaign): CampaignContentFormState => {
  const extra = campaign.extraSettings || {}
  const savedCommentImages = extra.commentImages || []
  const rawSavedCommentImageOption = extra.commentImageOption
  const savedCommentImageOption: CommentImageOption =
    savedCommentImages.length > 0 && (rawSavedCommentImageOption === 'all' || rawSavedCommentImageOption === 'random')
      ? rawSavedCommentImageOption
      : 'none'
  const isCommentSeedingCampaign = COMMENT_SEEDING_ACTION_IDS.has(campaign.actionId)
  return {
    content: campaign.content || '',
    formattedContentEnabled: extra.formattedContentEnabled ?? false,
    advancedContentEnabled: extra.advancedContentSource === 'group_snapshot' && !!extra.advancedContentGroupSnapshot
      ? true
      : (extra.advancedContentEnabled ?? false),
    advancedContentItems: normalizeAdvancedContentItems(extra.advancedContentItems).map(item => (
      isCommentSeedingCampaign ? { ...item, randomMediaCount: 1 } : item
    )),
    emailSubject: extra.emailSubject || '',
    emailBodyIsHtml: extra.emailBodyIsHtml ?? false,
    emailCheckLinkClicks: extra.emailCheckLinkClicks ?? false,
    smsUseUnicode: extra.smsUseUnicode ?? false,
    smsKeepNewLines: extra.smsKeepNewLines ?? false,
    rewriteContentEachRun: extra.rewriteContentEachRun ?? false,
    postWithBackground: extra.postWithBackground ?? false,
    zaloMessageSendMode: extra.zaloMessageSendMode || 'normal',
    imageOption: (extra.imageOption || 'none') as ImageOption,
    randomImageCount: extra.randomImageCount || 3,
    images: (campaign.images || []) as CampaignMediaInput[],
    commentContent: extra.commentContent || '',
    rewriteCommentContentEachRun: extra.rewriteCommentContentEachRun ?? false,
    commentImageOption: savedCommentImageOption,
    commentImages: savedCommentImages,
    friendRequestMessage: extra.friendRequestMessage || '',
    postBumpContent: extra.postBumpContent || '',
    newsfeedCommentContent: extra.newsfeedCommentContent || ''
  }
}

function QuickEditShell({
  title,
  icon,
  saving,
  saveDisabled = false,
  onClose,
  onSave,
  children
}: {
  title: string
  icon: ReactNode
  saving: boolean
  saveDisabled?: boolean
  onClose: () => void
  onSave: () => void
  children: ReactNode
}) {
  const handleBackdropMouseDown = () => {
    if (!saving) onClose()
  }

  return (
    <div className="modal-overlay campaign-quick-edit-overlay" style={{ zIndex: 2200 }} onMouseDown={handleBackdropMouseDown}>
      <div className="campaign-quick-edit-modal stepper-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title campaign-quick-edit-title">
            {icon}
            <span>{title}</span>
          </span>
          <button type="button" className="btn-icon" onClick={onClose} disabled={saving}>
            <X size={18} />
          </button>
        </div>
        <div className="stepper-content campaign-quick-edit-content">
          {children}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Huỷ</button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || saveDisabled}>
            <Save size={14} />
            <span>{saving ? 'Đang lưu...' : 'Lưu'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export function CampaignLimitUpdateModal({ campaign, action, onClose }: CampaignQuickEditModalProps) {
  const updateCampaign = useCampaignStore(state => state.updateCampaign)
  const entitlements = useAuthStore(state => state.user?.entitlements)
  const showAlert = useUiStore(state => state.showAlert)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState<CampaignLimitFormState>(() => getInitialLimitFormState(campaign))
  const actionPlatform = getCampaignPlatform(campaign, action)
  const limitActionCodes = useMemo(() => getLimitActionCodes(campaign, action), [campaign, action])
  const checkedLimitActionCodes = useMemo(
    () => limitActionCodes.filter(code => isLimitActionVisibleForCampaign(campaign, code)),
    [campaign, limitActionCodes]
  )
  const visibleLimitActionCodes = checkedLimitActionCodes.filter(code => !isHiddenActionLimitConfig(code))
  const campaignDailyLimitCap = getCampaignActionDailySendLimit(
    action || { id: campaign.actionId, flatformType: actionPlatform },
    entitlements
  )
  const canUseSleepBetweenActions = campaign.actionId !== 'facebook_timeline_post' && campaign.actionId !== NEWSFEED_INTERACTION_ACTION_ID && campaign.actionId !== FACEBOOK_GROUP_INVITE_ACTION_ID

  const getActionDailyLimitCap = (actionCode: string) => (
    getAccountActionDailySendLimit(actionCode, actionPlatform, entitlements)
  )

  const updateActionLimit = (actionCode: string, key: keyof ActionLimitForm, value: number) => {
    setFormData(prev => {
      const fallback = {
        dailyLimit: clampDailyLimitToEntitlement(prev.dailyLimit, campaignDailyLimitCap),
        rateLimitCount: prev.rateLimitCount,
        rateLimitMinutes: normalizeRateLimitMinutes(prev.rateLimitMinutes)
      }
      const current = prev.actionLimitsByCode[actionCode] || getDefaultActionLimitForCode(actionCode, fallback)
      return {
        ...prev,
        actionLimitsByCode: {
          ...prev.actionLimitsByCode,
          [actionCode]: {
            ...current,
            [key]: key === 'dailyLimit'
              ? clampDailyLimitToEntitlement(value, getActionDailyLimitCap(actionCode))
              : value
          }
        }
      }
    })
  }

  const handleSave = async () => {
    setSaving(true)
    let shouldClose = false
    try {
      const fallback = {
        dailyLimit: clampDailyLimitToEntitlement(normalizePositiveInteger(formData.dailyLimit, 30), campaignDailyLimitCap),
        rateLimitCount: normalizePositiveInteger(formData.rateLimitCount, 9),
        rateLimitMinutes: normalizeRateLimitMinutes(formData.rateLimitMinutes)
      }
      const byActionCode = Object.fromEntries(
        checkedLimitActionCodes.map(code => {
          const rawLimit = isHiddenActionLimitConfig(code)
            ? getDefaultActionLimitForCode(code, fallback)
            : (formData.actionLimitsByCode[code] || getDefaultActionLimitForCode(code, fallback))
          return [
            code,
            {
              dailyLimit: clampDailyLimitToEntitlement(
                normalizePositiveInteger(rawLimit.dailyLimit, fallback.dailyLimit),
                getActionDailyLimitCap(code)
              ),
              rateLimitCount: normalizePositiveInteger(rawLimit.rateLimitCount, fallback.rateLimitCount),
              rateLimitMinutes: normalizeRateLimitMinutes(rawLimit.rateLimitMinutes)
            }
          ]
        })
      )
      const nextExtraSettings: CampaignExtraSettings = {
        ...(campaign.extraSettings || {}),
        actionLimits: {
          ...(campaign.extraSettings?.actionLimits || {}),
          sleepBetweenActions: normalizePositiveInteger(formData.sleepBetweenActions, canUseSleepBetweenActions ? DEFAULT_SLEEP_BETWEEN_ACTIONS : 0),
          enabledActionCodes: checkedLimitActionCodes,
          dailyLimit: fallback.dailyLimit,
          rateLimitCount: fallback.rateLimitCount,
          rateLimitMinutes: fallback.rateLimitMinutes,
          continueWhenActionLimitReached: formData.continueWhenActionLimitReached,
          byActionCode
        }
      }
      await updateCampaign(campaign.id, { extraSettings: nextExtraSettings })
      showAlert('Đã cập nhật giới hạn gửi.', 'success')
      shouldClose = true
      onClose()
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể cập nhật giới hạn gửi.'), 'error')
    } finally {
      if (!shouldClose) setSaving(false)
    }
  }

  return createPortal(
    <QuickEditShell
      title="Cập nhật giới hạn gửi"
      icon={<SlidersHorizontal size={18} />}
      saving={saving}
      onClose={onClose}
      onSave={handleSave}
    >
      <div className="campaign-quick-edit-summary">
        <strong>{campaign.name}</strong>
        <span>{action?.name || campaign.actionName || campaign.actionId}</span>
      </div>

      {canUseSleepBetweenActions && (
        <div className="stepper-section">
          <div className="stepper-section-header static">
            <div className="stepper-section-header-left">
              <span className="stepper-section-title">Thời gian nghỉ</span>
            </div>
          </div>
          <div className="stepper-section-body">
            <div className="stepper-form-group campaign-quick-edit-number-field">
              <label>Thời gian nghỉ giữa 2 lần gửi</label>
              <div className="stepper-input-unit-wrap">
                <input
                  type="number"
                  min={0}
                  value={formData.sleepBetweenActions}
                  onChange={event => setFormData(prev => ({
                    ...prev,
                    sleepBetweenActions: normalizePositiveInteger(event.target.value, 0)
                  }))}
                  className="stepper-input stepper-input-with-unit"
                />
                <span className="stepper-input-unit">giây</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="stepper-section">
        <div className="stepper-section-header static">
          <div className="stepper-section-header-left">
            <span className="stepper-section-title">Giới hạn hành động</span>
          </div>
        </div>
        <div className="stepper-section-body">
          {visibleLimitActionCodes.length === 0 ? (
            <div className="campaign-quick-edit-empty">Loại chiến dịch này chưa có action giới hạn để cấu hình.</div>
          ) : (
            <div className="action-limit-card-list">
              {visibleLimitActionCodes.map(actionCode => {
                const fallback = {
                  dailyLimit: clampDailyLimitToEntitlement(formData.dailyLimit, campaignDailyLimitCap),
                  rateLimitCount: formData.rateLimitCount,
                  rateLimitMinutes: normalizeRateLimitMinutes(formData.rateLimitMinutes)
                }
                const limit = formData.actionLimitsByCode[actionCode] || getDefaultActionLimitForCode(actionCode, fallback)
                const actionLimitUnit = getActionLimitUnit(actionCode)
                const actionDailyLimitCap = getActionDailyLimitCap(actionCode)
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
                            min={0}
                            max={actionDailyLimitCap ?? undefined}
                            value={limit.dailyLimit}
                            onChange={event => updateActionLimit(actionCode, 'dailyLimit', normalizePositiveInteger(event.target.value, 0))}
                            className="stepper-input stepper-input-with-unit"
                          />
                          <span className="stepper-input-unit">{actionLimitUnit}</span>
                        </div>
                      </div>
                      <div className="stepper-form-group third">
                        <label>Giới hạn trong giờ</label>
                        <div className="stepper-input-unit-wrap">
                          <input
                            type="number"
                            min={0}
                            value={limit.rateLimitCount}
                            onChange={event => updateActionLimit(actionCode, 'rateLimitCount', normalizePositiveInteger(event.target.value, 0))}
                            className="stepper-input stepper-input-with-unit"
                          />
                          <span className="stepper-input-unit">{actionLimitUnit}</span>
                        </div>
                      </div>
                      <div className="stepper-form-group third">
                        <label>Trong số phút</label>
                        <div className="stepper-input-unit-wrap">
                          <input
                            type="number"
                            min={1}
                            value={normalizeRateLimitMinutes(limit.rateLimitMinutes)}
                            onChange={event => updateActionLimit(actionCode, 'rateLimitMinutes', normalizeRateLimitMinutes(event.target.value))}
                            className="stepper-input stepper-input-with-unit"
                          />
                          <span className="stepper-input-unit">phút</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <label className="schedule-checkbox-label action-limit-continue-option">
            <input
              type="checkbox"
              checked={formData.continueWhenActionLimitReached}
              onChange={event => setFormData(prev => ({ ...prev, continueWhenActionLimitReached: event.target.checked }))}
            />
            <span>Chiến dịch sẽ tiếp tục chạy khi 1 trong các hành động đạt giới hạn</span>
          </label>
          <div className="schedule-hint action-limit-continue-note">
            Mặc định là chỉ cần 1 trong các hành động đạt giới hạn là chiến dịch sẽ không chạy và tự động lại khi giới hạn được mở.
          </div>
        </div>
      </div>
    </QuickEditShell>,
    document.body
  )
}

export function CampaignContentMediaUpdateModal({ campaign, action, onOpenContentTemplates, onClose }: CampaignQuickEditModalProps) {
  const updateCampaign = useCampaignStore(state => state.updateCampaign)
  const accounts = useCampaignStore(state => state.accounts)
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const [saving, setSaving] = useState(false)
  const [mediaPickerTarget, setMediaPickerTarget] = useState<QuickMediaPickerTarget | null>(null)
  const localMediaPickerTargetRef = useRef<QuickMediaPickerTarget | null>(null)
  const localImageInputRef = useRef<HTMLInputElement>(null)
  const localFileInputRef = useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState<CampaignContentFormState>(() => getInitialContentFormState(campaign))
  const actionId = campaign.actionId
  const campaignAccount = accounts.find(account => account.id === campaign.accountId)
  const usesZaloServerAccount = !!campaignAccount && isZaloServerAccount(campaignAccount)
  const contentTemplateChannel = getQuickEditContentTemplateChannel(actionId)
  const extra = campaign.extraSettings || {}
  const isEmailCampaign = actionId === EMAIL_SEND_ACTION_ID
  const isSmsCampaign = actionId === SMS_SEND_ACTION_ID
  const isVoiceCallCampaign = actionId === VOICE_CALL_ACTION_ID
  const isMobileManagedSmsCampaign = isSmsCampaign || isVoiceCallCampaign
  const isGroupSnapshotSource = extra.advancedContentSource === 'group_snapshot' && !!extra.advancedContentGroupSnapshot
  const isLegacyManualAdvancedSource = extra.advancedContentEnabled === true && !isGroupSnapshotSource
  const isAdvancedContentReadOnly = isGroupSnapshotSource || isLegacyManualAdvancedSource
  const canUseFormattedContent = supportsFormattedContent(actionId)
  const isFormattedContentEnabled = canUseFormattedContent && formData.formattedContentEnabled
  const isRichContentEditorEnabled = (isEmailCampaign && formData.emailBodyIsHtml) || isFormattedContentEnabled
  const isCommentSeedingCampaign = COMMENT_SEEDING_ACTION_IDS.has(actionId)
  const isNewsfeedInteractionCampaign = actionId === NEWSFEED_INTERACTION_ACTION_ID
  const isFacebookGroupPostCampaign = actionId === FACEBOOK_GROUP_POST_ACTION_ID
  const isFacebookJoinGroupCampaign = actionId === FACEBOOK_JOIN_GROUP_ACTION_ID
  const isFacebookGroupInviteCampaign = actionId === FACEBOOK_GROUP_INVITE_ACTION_ID
  const isZaloMessageCampaign = [
    ZALO_MESSAGE_PHONE_ACTION_ID,
    ZALO_MESSAGE_FRIEND_ACTION_ID,
    ZALO_MESSAGE_BIRTHDAY_ACTION_ID,
    ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID,
    ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID,
    ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID,
    ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID,
    ZALO_MESSAGE_GROUP_ACTION_ID
  ].includes(actionId)
  const isMessageCampaign = MESSAGE_CAMPAIGN_ACTION_IDS.has(actionId)
  const isToggleableMessageContentCampaign = MESSAGE_CONTENT_TOGGLE_ACTION_IDS.has(actionId)
  const hasMessageEnabled = extra.enableMessage !== false
  const isUsingSourceContent = (actionId === 'facebook_timeline_post' || actionId === FACEBOOK_GROUP_POST_ACTION_ID || actionId === PAGE_POST_ACTION_ID) &&
    extra.copyContentFromSource === true
  const isPostBumpCreateMode = (extra.postBumpMode || 'create') === 'create'
  const usesNewsfeedCommentAi = extra.newsfeedCommentUseAI === true
  const showMainContentSection =
    !FIND_DATA_ACTION_IDS.has(actionId) &&
    !isNewsfeedInteractionCampaign &&
    !isFacebookJoinGroupCampaign &&
    !isFacebookGroupInviteCampaign &&
    actionId !== ZALO_ADD_GROUP_MEMBER_ACTION_ID &&
    actionId !== ZALO_JOIN_GROUP_LINK_ACTION_ID &&
    actionId !== ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID &&
    (!isToggleableMessageContentCampaign || hasMessageEnabled)
  const isPostBackgroundCampaign = actionId === 'facebook_timeline_post' || actionId === PAGE_POST_ACTION_ID || actionId === FACEBOOK_GROUP_POST_ACTION_ID
  const isPostBackgroundDisabled =
    (actionId === PAGE_POST_ACTION_ID && extra.pagePostMode === 'api') ||
    extra.copyContentFromSource === true ||
    extra.sharePost === true ||
    extra.postAsReels === true
  const canUsePostBackground = isPostBackgroundCampaign && !isPostBackgroundDisabled
  const isPostBackgroundActive = canUsePostBackground && formData.postWithBackground && !isFormattedContentEnabled
  const showMainMedia = showMainContentSection && !isCommentSeedingCampaign && !isMobileManagedSmsCampaign && !isFacebookJoinGroupCampaign && !isFacebookGroupInviteCampaign
  const showCommentContent = isFacebookGroupPostCampaign && extra.enableComment === true
  const showPostBumpContent = isFacebookGroupPostCampaign && extra.enablePostBump === true
  const showNewsfeedCommentContent = isNewsfeedInteractionCampaign && extra.enableComment === true
  const showFriendRequestMessage = (
    actionId === ZALO_MESSAGE_PHONE_ACTION_ID ||
    actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
    actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID ||
    actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
    actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
  ) && extra.enableAddFriend === true
  const hasAnyEditableField = (!isLegacyManualAdvancedSource && showMainContentSection) || showCommentContent || showPostBumpContent || showNewsfeedCommentContent || showFriendRequestMessage
  const normalizedAdvancedContentItems = normalizeAdvancedContentItems(formData.advancedContentItems)
  const canUseAdvancedContentMode = showMainContentSection && !isVoiceCallCampaign && contentTemplateChannel !== undefined
  const isAdvancedContentMode = canUseAdvancedContentMode && formData.advancedContentEnabled
  const getAdvancedEmailSubject = (item: CampaignAdvancedContentItem): string => (
    item.emailSubject == null && !isGroupSnapshotSource
      ? formData.emailSubject
      : String(item.emailSubject ?? '')
  )

  const convertFormattedStateToPlain = (current: CampaignContentFormState): CampaignContentFormState => {
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

  const setFormattedContentEnabled = (checked: boolean) => {
    if (!checked) {
      setFormData(current => convertFormattedStateToPlain(current))
      return
    }
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

  const validateSelectedMedia = (label: string, option: string, images: CampaignMediaInput[]): boolean => {
    if (option === 'none' || images.length === 0) return true
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

  const validateCommentImagePool = (label: string, option: string, images: CampaignMediaInput[]): boolean => {
    if (option !== 'all' || images.length <= 1) return true
    showAlert(`${label} ở chế độ "Gửi ảnh đã chọn" chỉ được chọn tối đa 1 ảnh. Vui lòng xoá bớt ảnh hoặc chuyển sang gửi ngẫu nhiên.`, 'error')
    return false
  }

  const validateAdvancedContentItems = (): boolean => {
    if (!isAdvancedContentMode) return true
    if (isGroupSnapshotSource) return true
    if (normalizedAdvancedContentItems.length === 0) {
      showAlert('Vui lòng thêm ít nhất 1 nội dung nâng cao hoặc chuyển về chế độ Cơ bản.', 'error')
      return false
    }
    if (isSmsCampaign && normalizedAdvancedContentItems.length > MAX_SMS_ADVANCED_CONTENT_ITEMS) {
      showAlert(`Nội dung nâng cao SMS chỉ được tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} mục.`, 'error')
      return false
    }

    const invalidIndex = findInvalidAdvancedContentItemIndex(normalizedAdvancedContentItems, {
      allowMediaOnly: !isMobileManagedSmsCampaign,
      contentIsEmpty: isRichContentEditorEnabled ? isFormattedContentEmpty : undefined
    })
    if (invalidIndex < 0) {
      if (isEmailCampaign) {
        const missingSubjectIndex = normalizedAdvancedContentItems.findIndex(item => !getAdvancedEmailSubject(item).trim())
        if (missingSubjectIndex >= 0) {
          showAlert(`Vui lòng nhập tiêu đề email cho nội dung nâng cao số ${missingSubjectIndex + 1}.`, 'error')
          return false
        }
      }
      return true
    }

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
    if (isGroupSnapshotSource) return true

    for (let index = 0; index < normalizedAdvancedContentItems.length; index += 1) {
      const item = normalizedAdvancedContentItems[index]
      if (isCommentSeedingCampaign && !validateCommentImagePool(
        `Media nội dung nâng cao ${index + 1}`,
        item.mediaOption || 'none',
        item.mediaItems || []
      )) {
        return false
      }
      if (!validateSelectedMedia(`Media nội dung nâng cao ${index + 1}`, item.mediaOption || 'none', item.mediaItems || [])) {
        return false
      }
    }

    return true
  }

  const getPostBackgroundValidationError = (): string | null => {
    if (!isPostBackgroundActive) return null

    if (isAdvancedContentMode) {
      if (normalizedAdvancedContentItems.length === 0) return 'Vui lòng thêm ít nhất 1 nội dung nâng cao để đăng bài với phông nền.'

      const tooLongIndex = normalizedAdvancedContentItems.findIndex(item => renderContentSpinMax(item.content).length > 130)
      if (tooLongIndex >= 0) {
        return `Nội dung phông nền nâng cao số ${tooLongIndex + 1} không được quá 130 ký tự.`
      }

      const tooManyLinesIndex = normalizedAdvancedContentItems.findIndex(item => String(item.content || '').split(/\r?\n/).length > 3)
      if (tooManyLinesIndex >= 0) {
        return `Nội dung phông nền nâng cao số ${tooManyLinesIndex + 1} chỉ được tối đa 3 dòng.`
      }

      const hasAdvancedMedia = normalizedAdvancedContentItems.some(item => item.mediaOption !== 'none' && (item.mediaItems || []).length > 0)
      if (hasAdvancedMedia) {
        return 'Đăng bài với phông nền không thể gửi kèm ảnh. Vui lòng bỏ media trong nội dung nâng cao trước khi lưu.'
      }

      return null
    }

    const variants = splitContentVariants(formData.content)
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
      return 'Đăng bài với phông nền không thể gửi kèm ảnh. Vui lòng chọn Không gửi ảnh trước khi lưu.'
    }

    return null
  }

  const usesSingleCommentMediaSelection = (target: QuickMediaPickerTarget): boolean => {
    if (target === 'comment') return formData.commentImageOption === 'all'
    if (typeof target !== 'object' || !isCommentSeedingCampaign) return false
    return formData.advancedContentItems.find(item => item.id === target.itemId)?.mediaOption === 'all'
  }

  const addCampaignMedia = (target: QuickMediaPickerTarget, items: CampaignMediaSnapshot[]) => {
    if (items.length === 0) return
    const isAdvancedTarget = typeof target === 'object'
    const isCommentTarget = target === 'comment'
    const acceptedItems = isCommentTarget || !(isZaloMessageCampaign || isEmailCampaign)
      ? items.filter(isCampaignMediaImage)
      : items
    if (acceptedItems.length === 0) return
    setFormData(prev => {
      if (isCommentTarget) {
        if (prev.commentImageOption === 'all') {
          return { ...prev, commentImages: acceptedItems.slice(0, 1) }
        }
        const nextItems = getUniqueCampaignMediaAdditions(prev.commentImages, acceptedItems)
        return { ...prev, commentImages: [...prev.commentImages, ...nextItems] }
      }
      if (isAdvancedTarget) {
        return {
          ...prev,
          advancedContentItems: prev.advancedContentItems.map(item => {
            if (item.id !== target.itemId) return item
            const currentItems = item.mediaItems || []
            const nextItems = getUniqueCampaignMediaAdditions(currentItems, acceptedItems)
            const mergedItems = [...currentItems, ...nextItems]
            const nextMediaItems = isCommentSeedingCampaign && item.mediaOption === 'all'
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
      const nextItems = getUniqueCampaignMediaAdditions(prev.images, acceptedItems)
      return { ...prev, images: [...prev.images, ...nextItems] }
    })
  }

  const handleMediaPickerConfirm = (items: CampaignMediaSnapshot[]) => {
    if (!mediaPickerTarget) return
    addCampaignMedia(mediaPickerTarget, items)
  }

  const openLocalMediaPicker = (target: QuickMediaPickerTarget) => {
    if (usesZaloServerAccount) {
      showAlert('Tài khoản Zalo Server chỉ có thể dùng media đã upload lên cloud.', 'info')
      return
    }
    localMediaPickerTargetRef.current = target
    const acceptsFiles = target !== 'comment' && (isZaloMessageCampaign || isEmailCampaign)
    const input = acceptsFiles ? localFileInputRef.current : localImageInputRef.current
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

    const onlyImages = target === 'comment' || !(isZaloMessageCampaign || isEmailCampaign)
    const maxSelect = usesSingleCommentMediaSelection(target) ? 1 : undefined
    const { snapshots, failures } = selectLocalCampaignMedia(rawFiles, { onlyImages, maxSelect })
    if (failures.length > 0) {
      showAlert(
        summarizeLocalCampaignMediaFailures(failures),
        snapshots.length > 0 ? 'info' : 'error'
      )
    }
    addCampaignMedia(target, snapshots)
  }

  const removeMedia = (target: 'post' | 'comment', index: number) => {
    setFormData(prev => target === 'comment'
      ? { ...prev, commentImages: prev.commentImages.filter((_, itemIndex) => itemIndex !== index) }
      : { ...prev, images: prev.images.filter((_, itemIndex) => itemIndex !== index) }
    )
  }

  const removeAdvancedContentMedia = (itemId: string, mediaIndex: number) => {
    setFormData(prev => ({
      ...prev,
      advancedContentItems: prev.advancedContentItems.map(item => (
        item.id === itemId
          ? { ...item, mediaItems: (item.mediaItems || []).filter((_, index) => index !== mediaIndex) }
          : item
      ))
    }))
  }

  const renderMediaPicker = (target: 'post' | 'comment', title: string) => {
    const isComment = target === 'comment'
    const isZaloMedia = isZaloMessageCampaign && !isComment
    const isEmailAttachment = isEmailCampaign && !isComment
    const isFileMedia = isZaloMedia || isEmailAttachment
    const option = isComment ? formData.commentImageOption : formData.imageOption
    const images = isComment ? formData.commentImages : formData.images
    const radioName = isComment ? 'quickCommentImageOption' : 'quickImageOption'

    const setOption = (value: ImageOption) => {
      if (isComment && value === 'all' && images.length > 1) {
        showAlert('Chế độ "Gửi ảnh đã chọn" chỉ dùng tối đa 1 ảnh cho mỗi comment. Vui lòng xoá bớt còn 1 ảnh hoặc tiếp tục dùng chế độ ngẫu nhiên.', 'info')
        return
      }
      setFormData(prev => isComment
        ? { ...prev, commentImageOption: value }
        : { ...prev, imageOption: value }
      )
    }

    return (
      <div className="campaign-quick-media-panel">
        <div className="campaign-quick-media-header">
          <strong>{title}</strong>
          {isComment && <span>Facebook chỉ cho phép mỗi comment 1 ảnh. Chế độ gửi ảnh đã chọn dùng 1 ảnh; chế độ ngẫu nhiên chọn 1 ảnh từ kho.</span>}
          {!isComment && isPostBackgroundActive && <span>Đăng bài với phông nền không hỗ trợ gửi media.</span>}
        </div>
        <div className="campaign-quick-media-layout">
          <div className="campaign-quick-media-options">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setMediaPickerTarget(target)}
                disabled={option === 'none'}
              >
                <ImageIcon size={14} />
                <span>Chọn từ Media</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openLocalMediaPicker(target)}
                disabled={option === 'none' || usesZaloServerAccount}
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
                checked={option === 'none'}
                onChange={() => setOption('none')}
              />
              <span>{isEmailAttachment ? 'Không đính kèm file' : isZaloMedia ? 'Không gửi file' : 'Không gửi ảnh'}</span>
            </label>
            <label className="schedule-radio-label">
              <input
                type="radio"
                name={radioName}
                checked={option === 'all'}
                onChange={() => setOption('all')}
              />
              <span>{isComment ? 'Gửi ảnh đã chọn' : isEmailAttachment ? 'Đính kèm file đã chọn' : isZaloMedia ? 'Gửi file đã chọn' : 'Gửi ảnh đã chọn'}</span>
            </label>
            <div className="campaign-quick-random-media-row">
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={option === 'random'}
                  onChange={() => setOption('random')}
                />
                <span>{isComment ? 'Gửi ngẫu nhiên 1 ảnh trong các ảnh đã chọn' : isFileMedia ? 'Gửi ngẫu nhiên số file' : 'Gửi ngẫu nhiên số ảnh'}</span>
              </label>
              <input
                type="number"
                min={1}
                max={isComment ? 1 : undefined}
                value={isComment ? 1 : formData.randomImageCount}
                onChange={event => {
                  if (isComment) return
                  setFormData(prev => ({
                    ...prev,
                    randomImageCount: normalizePositiveInteger(event.target.value, 1, 1)
                  }))
                }}
                className="stepper-input"
                disabled={isComment || option !== 'random'}
              />
            </div>
          </div>
          <div className="stepper-grid-container campaign-quick-media-table-wrap">
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
                {images.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-muted">
                      {isFileMedia ? 'Chưa có file nào được chọn' : 'Chưa có ảnh nào được chọn'}
                    </td>
                  </tr>
                ) : images.map((item, index) => {
                  const localPath = getCampaignMediaLocalPath(item)
                  const cloudUrl = getCampaignMediaCloudUrl(item)
                  const titleText = [localPath, cloudUrl].filter(Boolean).join('\n') || getCampaignMediaDisplayName(item)
                  return (
                    <tr key={`${target}-${index}-${getCampaignMediaStableKey(item)}`}>
                      <td className="text-center">{index + 1}</td>
                      <td className="text-center">
                        <MediaPreviewHover
                          name={getCampaignMediaDisplayName(item)}
                          path={getCampaignMediaPreviewPath(item)}
                          mimeType={getCampaignMediaMimeType(item)}
                          sizeBytes={getCampaignMediaSizeBytes(item)}
                        />
                      </td>
                      <td className="text-truncate" title={titleText}>
                        {getCampaignMediaDisplayName(item)}
                        {isCampaignMediaUsingCloudFallback(item) && (
                          <span className="media-inline-source">cloud</span>
                        )}
                      </td>
                      <td className="text-center">
                        <button
                          type="button"
                          className="btn-icon text-error action-btn"
                          onClick={() => removeMedia(target, index)}
                          title="Xóa"
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
    )
  }

  const setAdvancedContentItem = (itemId: string, patch: Partial<CampaignAdvancedContentItem>) => {
    if (isCommentSeedingCampaign && patch.mediaOption === 'all') {
      const currentItem = formData.advancedContentItems.find(item => item.id === itemId)
      const mediaItems = patch.mediaItems || currentItem?.mediaItems || []
      if (mediaItems.length > 1) {
        showAlert('Chế độ "Gửi ảnh đã chọn" chỉ dùng tối đa 1 ảnh cho mỗi comment. Vui lòng xoá bớt còn 1 ảnh hoặc tiếp tục dùng chế độ ngẫu nhiên.', 'info')
        return
      }
    }
    const normalizedPatch = isCommentSeedingCampaign
      ? { ...patch, randomMediaCount: 1 }
      : patch
    setFormData(prev => ({
      ...prev,
      advancedContentItems: prev.advancedContentItems.map(item => (
        item.id === itemId ? { ...item, ...normalizedPatch } : item
      ))
    }))
  }

  const addAdvancedContentItem = () => {
    if (isSmsCampaign && formData.advancedContentItems.length >= MAX_SMS_ADVANCED_CONTENT_ITEMS) {
      showAlert(`Nội dung nâng cao SMS chỉ được tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} mục.`, 'error')
      return
    }
    setFormData(prev => ({
      ...prev,
      advancedContentItems: [
        ...prev.advancedContentItems,
        createAdvancedContentItem({
          ...(isEmailCampaign ? { emailSubject: prev.emailSubject } : {}),
          ...(isCommentSeedingCampaign ? { randomMediaCount: 1 } : {})
        })
      ]
    }))
  }

  const duplicateAdvancedContentItem = (item: CampaignAdvancedContentItem) => {
    if (isSmsCampaign && formData.advancedContentItems.length >= MAX_SMS_ADVANCED_CONTENT_ITEMS) {
      showAlert(`Nội dung nâng cao SMS chỉ được tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} mục.`, 'error')
      return
    }
    setFormData(prev => ({
      ...prev,
      advancedContentItems: [
        ...prev.advancedContentItems,
        createAdvancedContentItem({
          content: item.content,
          mediaOption: item.mediaOption || 'none',
          mediaItems: [...(item.mediaItems || [])],
          randomMediaCount: isCommentSeedingCampaign ? 1 : (item.randomMediaCount || 3),
          emailSubject: item.emailSubject
        })
      ]
    }))
  }

  const removeAdvancedContentItem = (itemId: string) => {
    setFormData(prev => ({
      ...prev,
      advancedContentItems: prev.advancedContentItems.filter(item => item.id !== itemId)
    }))
  }

  const renderContentModeSegmented = () => {
    if (!canUseAdvancedContentMode) return null

    const isBasicContentMode = !formData.advancedContentEnabled
    const isManualAdvancedContentMode = formData.advancedContentEnabled && !isGroupSnapshotSource
    const isDataGroupContentMode = formData.advancedContentEnabled && isGroupSnapshotSource
    const note = formData.advancedContentEnabled
      ? 'Tạo nhiều nội dung riêng, mỗi nội dung là một biến thể hoàn chỉnh với media riêng. Mỗi lượt chạy sẽ xoay vòng qua các nội dung trong danh sách.'
      : isRichContentEditorEnabled
        ? 'Dùng dấu | để phân tách các nội dung có định dạng gửi luân phiên. Nhập \\| nếu muốn hiển thị dấu |.'
        : 'Dùng một nội dung và bộ media chung cho chiến dịch. Có thể nhập nhiều biến thể bằng dấu |. Mỗi lượt chạy sẽ xoay vòng qua các biến thể.'

    return (
      <div className="campaign-content-mode-row">
        <div className="campaign-content-mode-segmented" role="group" aria-label="Chế độ nội dung">
          <button
            type="button"
            aria-pressed={isBasicContentMode}
            className={isBasicContentMode ? 'active' : ''}
            onClick={() => setFormData(prev => ({ ...prev, advancedContentEnabled: false }))}
            disabled={isAdvancedContentReadOnly}
          >
            Cơ bản
          </button>
          <button
            type="button"
            aria-pressed={isManualAdvancedContentMode}
            className={isManualAdvancedContentMode ? 'active' : ''}
            onClick={() => setFormData(prev => ({ ...prev, advancedContentEnabled: true }))}
            disabled={isAdvancedContentReadOnly}
          >
            Nâng cao
          </button>
          <button
            type="button"
            aria-pressed={isDataGroupContentMode}
            className={isDataGroupContentMode ? 'active' : ''}
            disabled
            title="Mở form sửa đầy đủ để chọn hoặc cập nhật Nhóm mẫu nội dung"
          >
            Nhóm mẫu nội dung
          </button>
        </div>
        <div className="campaign-content-mode-note">
          {isGroupSnapshotSource
            ? `Nhóm mẫu nội dung “${extra.advancedContentGroupSnapshot?.groupName || '-'}” là snapshot chỉ đọc. Hãy mở form sửa đầy đủ để đổi hoặc cập nhật nhóm.`
            : isLegacyManualAdvancedSource
              ? 'Nội dung nâng cao chỉ đọc trong sửa nhanh. Hãy mở form sửa đầy đủ để thay đổi nội dung.'
              : note}
        </div>
      </div>
    )
  }

  const renderSmsContentOptions = () => {
    if (isVoiceCallCampaign) {
      return (
        <div className="schedule-hint">
          Hệ thống luôn thêm câu “Đây là cuộc gọi tự động sử dụng giọng nói AI.” trước nội dung; audio tối đa 90 giây và không tự gọi lại.
        </div>
      )
    }
    if (!isSmsCampaign) return null

    return (
      <div className="campaign-quick-toggle-row">
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.smsUseUnicode}
            disabled={isLegacyManualAdvancedSource}
            onChange={event => setFormData(prev => ({ ...prev, smsUseUnicode: event.target.checked }))}
          />
          <span>Tiếng Việt có dấu</span>
        </label>
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.smsKeepNewLines}
            disabled={isLegacyManualAdvancedSource}
            onChange={event => setFormData(prev => ({ ...prev, smsKeepNewLines: event.target.checked }))}
          />
          <span>Không loại bỏ xuống dòng</span>
        </label>
      </div>
    )
  }

  const renderAdvancedContentItemMedia = (item: CampaignAdvancedContentItem) => {
    if (isMobileManagedSmsCampaign) return null
    if (isAdvancedContentReadOnly) {
      const mediaCount = (item.mediaItems || []).length
      return mediaCount > 0
        ? <div className="schedule-hint" style={{ marginTop: 8 }}>{mediaCount} media chỉ đọc.</div>
        : null
    }

    const mediaItems = item.mediaItems || []
    const mediaOption = item.mediaOption || 'none'
    const isFileMedia = isZaloMessageCampaign || isEmailCampaign
    const mediaTitle = isCommentSeedingCampaign ? 'Kho ảnh đã chọn' : isEmailCampaign ? 'Tệp đính kèm đã chọn' : isZaloMessageCampaign ? 'File đã chọn' : 'Ảnh đã chọn'
    const mediaDisabled = isPostBackgroundActive
    const radioName = `quick-advanced-media-${item.id}`

    return (
      <div className="campaign-advanced-media-panel">
        {isCommentSeedingCampaign && (
          <div className="schedule-hint">Facebook chỉ cho phép mỗi comment 1 ảnh. Chế độ gửi ảnh đã chọn dùng 1 ảnh; chế độ ngẫu nhiên chọn 1 ảnh từ kho.</div>
        )}
        {mediaDisabled && (
          <div className="schedule-hint">Đăng bài với phông nền không hỗ trợ gửi media.</div>
        )}
        <div className="campaign-advanced-media-layout">
          <div className="campaign-advanced-media-options">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setMediaPickerTarget({ kind: 'advanced', itemId: item.id })}
                disabled={mediaOption === 'none' || mediaDisabled}
              >
                <ImageIcon size={14} />
                <span>Chọn từ Media</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openLocalMediaPicker({ kind: 'advanced', itemId: item.id })}
                disabled={mediaOption === 'none' || mediaDisabled || usesZaloServerAccount}
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
                onChange={() => setAdvancedContentItem(item.id, { mediaOption: 'none' })}
              />
              <span>{isEmailCampaign ? 'Không đính kèm file' : isZaloMessageCampaign ? 'Không gửi file' : 'Không gửi ảnh'}</span>
            </label>
            <label className="schedule-radio-label">
              <input
                type="radio"
                name={radioName}
                checked={mediaOption === 'all'}
                onChange={() => setAdvancedContentItem(item.id, { mediaOption: 'all' })}
                disabled={mediaDisabled}
              />
              <span>{isCommentSeedingCampaign ? 'Gửi ảnh đã chọn' : isEmailCampaign ? 'Đính kèm file đã chọn' : isZaloMessageCampaign ? 'Gửi file đã chọn' : 'Gửi ảnh đã chọn'}</span>
            </label>
            <div className="campaign-advanced-random-media-row">
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={mediaOption === 'random'}
                  onChange={() => setAdvancedContentItem(item.id, { mediaOption: 'random', randomMediaCount: 1 })}
                  disabled={mediaDisabled}
                />
                <span>{isCommentSeedingCampaign ? 'Gửi ngẫu nhiên 1 ảnh trong các ảnh đã chọn' : isFileMedia ? 'Gửi ngẫu nhiên số file trong file đã chọn' : 'Gửi ngẫu nhiên số ảnh trong ảnh đã chọn'}</span>
              </label>
              <input
                type="number"
                min={1}
                max={isCommentSeedingCampaign ? 1 : undefined}
                value={isCommentSeedingCampaign ? 1 : (item.randomMediaCount || 3)}
                onChange={event => setAdvancedContentItem(item.id, {
                  randomMediaCount: normalizePositiveInteger(event.target.value, 1, 1)
                })}
                className="stepper-input"
                disabled={isCommentSeedingCampaign || mediaOption !== 'random' || mediaDisabled}
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
                        {isFileMedia ? 'Chưa có file nào được chọn' : 'Chưa có ảnh nào được chọn'}
                      </td>
                    </tr>
                  ) : mediaItems.map((itemMedia, index) => {
                    const localPath = getCampaignMediaLocalPath(itemMedia)
                    const cloudUrl = getCampaignMediaCloudUrl(itemMedia)
                    const titleText = [localPath, cloudUrl].filter(Boolean).join('\n') || getCampaignMediaDisplayName(itemMedia)
                    return (
                      <tr key={`quick-advanced-${item.id}-${index}-${getCampaignMediaStableKey(itemMedia)}`}>
                        <td className="text-center">{index + 1}</td>
                        <td className="text-center">
                          <MediaPreviewHover
                            name={getCampaignMediaDisplayName(itemMedia)}
                            path={getCampaignMediaPreviewPath(itemMedia)}
                            mimeType={getCampaignMediaMimeType(itemMedia)}
                            sizeBytes={getCampaignMediaSizeBytes(itemMedia)}
                          />
                        </td>
                        <td className="text-truncate" title={titleText}>
                          {getCampaignMediaDisplayName(itemMedia)}
                          {isCampaignMediaUsingCloudFallback(itemMedia) && (
                            <span className="media-inline-source">cloud</span>
                          )}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn-icon text-error action-btn"
                            onClick={() => removeAdvancedContentMedia(item.id, index)}
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

  const renderAdvancedContentEditor = () => (
    <div className="campaign-advanced-content-editor">
      <div className="campaign-advanced-content-header">
        <div>
          <strong>{isGroupSnapshotSource ? 'Snapshot nội dung từ nhóm mẫu' : isLegacyManualAdvancedSource ? 'Nội dung nâng cao (chỉ đọc)' : 'Nội dung nâng cao'}</strong>
          <span className="campaign-advanced-content-count">{normalizedAdvancedContentItems.length} nội dung</span>
        </div>
      </div>

      {isGroupSnapshotSource && extra.advancedContentGroupSnapshot && (
        <div style={{ marginBottom: 10 }}>
          <div className="schedule-hint">
            {extra.advancedContentGroupSnapshot.groupName} · {extra.advancedContentGroupSnapshot.templateCount} mẫu · {extra.advancedContentGroupSnapshot.itemCount} nội dung · {new Date(extra.advancedContentGroupSnapshot.capturedAt).toLocaleString('vi-VN')}. Nguồn này chỉ đọc trong sửa nhanh.
          </div>
          {onOpenContentTemplates && contentTemplateChannel && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 8 }}
              onClick={() => onOpenContentTemplates(contentTemplateChannel)}
            >
              <FileText size={14} /> Mở kho mẫu đúng kênh
            </button>
          )}
        </div>
      )}

      {isLegacyManualAdvancedSource && (
        <div className="schedule-hint" style={{ marginBottom: 10 }}>
          Chiến dịch vẫn tiếp tục chạy bằng nội dung nâng cao đã lưu. Muốn thay đổi nội dung, hãy mở form sửa đầy đủ.
        </div>
      )}

      {formData.advancedContentItems.length === 0 ? (
        <div className="campaign-advanced-content-entry">
          <div className="campaign-advanced-content-empty">Chưa có nội dung nâng cao.</div>
          {!isAdvancedContentReadOnly && <div className="campaign-advanced-content-add-row">
            <button type="button" className="btn btn-primary btn-sm" onClick={addAdvancedContentItem}>
              <Plus size={14} />
              <span>Thêm nội dung</span>
            </button>
          </div>}
        </div>
      ) : formData.advancedContentItems.map((item, index) => (
        <div className="campaign-advanced-content-entry" key={item.id}>
          <div className="campaign-advanced-content-card">
            <div className="campaign-advanced-content-card-header">
              <strong>
                Nội dung {index + 1}
                {item.sourceTemplateName ? ` · ${item.sourceTemplateName}` : ''}
                {item.sourceVariantIndex !== undefined ? ` · biến thể ${item.sourceVariantIndex + 1}` : ''}
              </strong>
              {!isAdvancedContentReadOnly && <div className="campaign-advanced-content-actions">
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => duplicateAdvancedContentItem(item)}
                  title="Nhân bản nội dung"
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  className="btn-icon text-error"
                  onClick={() => removeAdvancedContentItem(item.id)}
                  title="Xóa nội dung"
                >
                  <Trash2 size={14} />
                </button>
              </div>}
            </div>
            {isEmailCampaign && (
              <div className="stepper-form-group" style={{ marginBottom: 10 }}>
                <label>Tiêu đề email <span className="required">*</span></label>
                <input
                  type="text"
                  className="stepper-input"
                  value={getAdvancedEmailSubject(item)}
                  onChange={event => setAdvancedContentItem(item.id, { emailSubject: event.target.value })}
                  readOnly={isAdvancedContentReadOnly}
                />
              </div>
            )}
            {isAdvancedContentReadOnly ? (
              <textarea
                className="stepper-textarea"
                value={isRichContentEditorEnabled ? formattedContentToPlainText(item.content) : item.content}
                rows={5}
                readOnly
              />
            ) : isRichContentEditorEnabled ? (
              <EmailHtmlEditor
                value={item.content}
                onChange={html => setAdvancedContentItem(item.id, { content: html })}
              />
            ) : (
              <textarea
                className={`stepper-textarea ${isMessageCampaign ? 'message-content-textarea' : ''}`}
                placeholder="Nhập nội dung..."
                value={item.content}
                onChange={event => setAdvancedContentItem(item.id, { content: event.target.value })}
                rows={5}
              />
            )}
            {renderAdvancedContentItemMedia(item)}
          </div>
          {!isAdvancedContentReadOnly && index === formData.advancedContentItems.length - 1 && (
            <div className="campaign-advanced-content-add-row">
              <button type="button" className="btn btn-primary btn-sm" onClick={addAdvancedContentItem}>
                <Plus size={14} />
                <span>Thêm nội dung</span>
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )

  const handleSave = async () => {
    if (!hasAnyEditableField) {
      showAlert('Loại chiến dịch này không có nội dung hoặc media để cập nhật.', 'info')
      return
    }
    if (!isLegacyManualAdvancedSource && isEmailCampaign && !isAdvancedContentMode && !formData.emailSubject.trim()) {
      showAlert('Vui lòng nhập tiêu đề email.', 'error')
      return
    }
    if (showMainContentSection && !isLegacyManualAdvancedSource) {
      const hasMainContentText = isAdvancedContentMode
        ? normalizedAdvancedContentItems.some(item => isRichContentEditorEnabled
          ? !isFormattedContentEmpty(item.content)
          : String(item.content || '').trim().length > 0)
        : isCommentSeedingCampaign
          ? formData.commentContent.trim().length > 0
        : isRichContentEditorEnabled
          ? splitFormattedContentVariants(formData.content).length > 0
          : formData.content.trim().length > 0
      const hasSelectedMainMedia = isAdvancedContentMode
        ? !isMobileManagedSmsCampaign && normalizedAdvancedContentItems.some(item => item.mediaOption !== 'none' && (item.mediaItems || []).length > 0)
        : isCommentSeedingCampaign
          ? formData.commentImageOption !== 'none' && formData.commentImages.length > 0
        : !isMobileManagedSmsCampaign && formData.imageOption !== 'none' && formData.images.length > 0
      if (!isUsingSourceContent && !hasMainContentText && !hasSelectedMainMedia) {
        showAlert(
          isEmailCampaign
            ? 'Vui lòng nhập nội dung email hoặc chọn ít nhất một tệp đính kèm.'
            : isSmsCampaign
              ? 'Vui lòng nhập nội dung tin nhắn SMS.'
              : isVoiceCallCampaign
                ? 'Vui lòng nhập nội dung cuộc gọi tự động.'
              : isMessageCampaign
                ? `Vui lòng nhập nội dung tin nhắn hoặc chọn ít nhất một ${isZaloMessageCampaign ? 'file' : 'ảnh'}.`
                : 'Vui lòng nhập nội dung chiến dịch hoặc chọn ít nhất một ảnh.',
          'error'
        )
        return
      }
    }
    if (isVoiceCallCampaign) {
      const ttsInputLength = `${VOICE_CALL_AI_DISCLOSURE} ${renderContentSpinMax(formData.content)}`.trim().length
      if (ttsInputLength > VOICE_CALL_MAX_TTS_INPUT_CHARS) {
        showAlert(`Nội dung cuộc gọi sau khi thêm thông báo giọng nói AI không được vượt quá ${VOICE_CALL_MAX_TTS_INPUT_CHARS.toLocaleString('vi-VN')} ký tự.`, 'error')
        return
      }
    }
    const hasSelectedCommentMedia = formData.commentImageOption !== 'none' && formData.commentImages.length > 0
    if (showCommentContent && !formData.commentContent.trim() && !hasSelectedCommentMedia) {
      showAlert('Vui lòng nhập nội dung comment hoặc chọn ảnh comment.', 'error')
      return
    }
    if (showPostBumpContent && isPostBumpCreateMode && !formData.postBumpContent.trim()) {
      showAlert('Vui lòng nhập nội dung up tin.', 'error')
      return
    }
    if (showNewsfeedCommentContent && !usesNewsfeedCommentAi && !formData.newsfeedCommentContent.trim()) {
      showAlert('Vui lòng nhập nội dung comment hoặc bật AI tạo nội dung comment.', 'error')
      return
    }
    if (showFriendRequestMessage && renderContentSpinMax(formData.friendRequestMessage).length > 150) {
      showAlert('Nội dung kết bạn không được quá 150 ký tự.', 'error')
      return
    }
    const postBackgroundError = isLegacyManualAdvancedSource ? null : getPostBackgroundValidationError()
    if (postBackgroundError) {
      showAlert(postBackgroundError, 'error')
      return
    }
    if (!isLegacyManualAdvancedSource && showMainMedia && !isAdvancedContentMode && !validateSelectedMedia(isEmailCampaign ? 'Tệp đính kèm' : 'Media', formData.imageOption, formData.images)) return
    if (!isLegacyManualAdvancedSource && !validateAdvancedContentItems()) return
    if (!isLegacyManualAdvancedSource && !validateAdvancedContentMedia()) return
    if (isCommentSeedingCampaign && !isAdvancedContentMode && !validateCommentImagePool('Ảnh comment', formData.commentImageOption, formData.commentImages)) return
    if (showCommentContent && !validateCommentImagePool('Ảnh comment', formData.commentImageOption, formData.commentImages)) return
    if (isCommentSeedingCampaign && !isAdvancedContentMode && !validateSelectedMedia('Ảnh comment', formData.commentImageOption, formData.commentImages)) return
    if (showCommentContent && !validateSelectedMedia('Ảnh comment', formData.commentImageOption, formData.commentImages)) return

    setSaving(true)
    let shouldClose = false
    try {
      const nextExtraSettings: CampaignExtraSettings = {
        ...(campaign.extraSettings || {})
      }

      if (showMainContentSection && !isLegacyManualAdvancedSource) {
        nextExtraSettings.advancedContentEnabled = canUseAdvancedContentMode ? formData.advancedContentEnabled : false
        const convertedGroupSnapshotItems = isGroupSnapshotSource &&
          extra.formattedContentEnabled === true &&
          !isFormattedContentEnabled
          ? (extra.advancedContentItems || []).map(item => ({
              ...item,
              content: formattedContentToPlainText(item.content)
            }))
          : extra.advancedContentItems
        nextExtraSettings.advancedContentItems = isGroupSnapshotSource
          ? convertedGroupSnapshotItems
          : normalizedAdvancedContentItems.map(item => {
            const itemWithLegacyEmailSubject = isEmailCampaign && item.emailSubject == null
              ? { ...item, emailSubject: formData.emailSubject.trim() }
              : item
            const normalizedItem = isFormattedContentEnabled
              ? { ...itemWithLegacyEmailSubject, content: sanitizeFormattedContent(item.content) }
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
            return isMobileManagedSmsCampaign
              ? { ...normalizedItem, mediaOption: 'none' as const, mediaItems: [] }
              : normalizedItem
          })
        nextExtraSettings.formattedContentEnabled = isFormattedContentEnabled
        nextExtraSettings.rewriteContentEachRun = isMobileManagedSmsCampaign || isFormattedContentEnabled || (isEmailCampaign && formData.emailBodyIsHtml)
          ? false
          : formData.rewriteContentEachRun
        nextExtraSettings.imageOption = (isMobileManagedSmsCampaign || isFacebookJoinGroupCampaign || isFacebookGroupInviteCampaign || isPostBackgroundActive) ? 'none' : formData.imageOption
        nextExtraSettings.randomImageCount = formData.randomImageCount
        if (isAdvancedContentMode) {
          nextExtraSettings.advancedContentSource = isGroupSnapshotSource ? 'group_snapshot' : 'manual'
          nextExtraSettings.advancedContentGroupSnapshot = isGroupSnapshotSource
            ? extra.advancedContentGroupSnapshot
            : undefined
        }
        const groupSnapshotMustUsePlain = isGroupSnapshotSource && (
          (!isEmailCampaign && !canUseFormattedContent) ||
          isPostBackgroundActive ||
          formData.zaloMessageSendMode === 'share'
        )
        if (groupSnapshotMustUsePlain) {
          nextExtraSettings.advancedContentManualDraft = projectAdvancedContentManualDraftToPlain(
            extra.advancedContentManualDraft
          )
        }
      }
      if (isEmailCampaign) {
        if (!isLegacyManualAdvancedSource) {
          const firstAdvancedEmailSubject = normalizedAdvancedContentItems[0]?.emailSubject
          nextExtraSettings.emailSubject = isAdvancedContentMode
            ? String(firstAdvancedEmailSubject == null && !isGroupSnapshotSource
              ? formData.emailSubject
              : firstAdvancedEmailSubject ?? '').trim()
            : formData.emailSubject.trim()
          nextExtraSettings.emailBodyIsHtml = formData.emailBodyIsHtml
        }
        if (!isLegacyManualAdvancedSource) {
          nextExtraSettings.emailCheckLinkClicks = formData.emailCheckLinkClicks
        }
      }
      if (isSmsCampaign && !isLegacyManualAdvancedSource) {
        nextExtraSettings.smsUseUnicode = formData.smsUseUnicode
        nextExtraSettings.smsKeepNewLines = formData.smsKeepNewLines
      }
      if (isPostBackgroundCampaign && !isLegacyManualAdvancedSource) {
        nextExtraSettings.postWithBackground = isFormattedContentEnabled ? false : isPostBackgroundActive
        if (isPostBackgroundActive) {
          nextExtraSettings.copyContentFromSource = false
          nextExtraSettings.includeSourceImages = false
          nextExtraSettings.rewriteSourceContentWithAI = false
          nextExtraSettings.sharePost = false
          nextExtraSettings.postAsReels = false
        }
      }
      if (isZaloMessageCampaign && !isLegacyManualAdvancedSource) {
        nextExtraSettings.zaloMessageSendMode = isFormattedContentEnabled ? 'normal' : formData.zaloMessageSendMode
      }
      if (showCommentContent || (isCommentSeedingCampaign && !isLegacyManualAdvancedSource)) {
        nextExtraSettings.commentContent = formData.commentContent
        nextExtraSettings.rewriteCommentContentEachRun = formData.rewriteCommentContentEachRun
        nextExtraSettings.commentImageOption = formData.commentImages.length > 0 && formData.commentImageOption !== 'none'
          ? formData.commentImageOption
          : 'none'
        nextExtraSettings.commentImages = formData.commentImages
      }
      if (showFriendRequestMessage) {
        nextExtraSettings.friendRequestMessage = formData.friendRequestMessage.trim()
      }
      if (showPostBumpContent) {
        nextExtraSettings.postBumpContent = formData.postBumpContent
      }
      if (showNewsfeedCommentContent) {
        nextExtraSettings.newsfeedCommentContent = formData.newsfeedCommentContent
      }

      await updateCampaign(campaign.id, {
        ...(showMainContentSection && !isCommentSeedingCampaign && !isLegacyManualAdvancedSource ? { content: isFormattedContentEnabled ? sanitizeFormattedContent(formData.content) : formData.content } : {}),
        extraSettings: nextExtraSettings,
        ...(showMainMedia && !isLegacyManualAdvancedSource ? { images: isMobileManagedSmsCampaign || isFacebookJoinGroupCampaign || isFacebookGroupInviteCampaign ? [] : formData.images } : {})
      })
      showAlert('Đã cập nhật nội dung và media.', 'success')
      shouldClose = true
      onClose()
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể cập nhật nội dung và media.'), 'error')
    } finally {
      if (!shouldClose) setSaving(false)
    }
  }

  return createPortal(
    <>
      <QuickEditShell
        title="Cập nhật nội dung + media"
        icon={<FileText size={18} />}
        saving={saving}
        saveDisabled={!hasAnyEditableField}
        onClose={onClose}
        onSave={handleSave}
      >
        <div className="campaign-quick-edit-summary">
          <strong>{campaign.name}</strong>
          <span>{action?.name || campaign.actionName || campaign.actionId}</span>
        </div>

        {!hasAnyEditableField && (
          <div className="stepper-section">
            <div className="stepper-section-body">
              <div className="campaign-quick-edit-empty">Loại chiến dịch này không có nội dung hoặc media để cập nhật.</div>
            </div>
          </div>
        )}

        {showMainContentSection && (
          <div className="stepper-section">
            <div className="stepper-section-header static">
              <div className="stepper-section-header-left">
                <span className="stepper-section-title">
                  {isEmailCampaign ? 'Nội dung email' : isMessageCampaign ? 'Nội dung tin nhắn' : 'Nội dung'}
                </span>
              </div>
            </div>
            <div className="stepper-section-body">
              {isPostBackgroundCampaign && (
                <div className="stepper-form-group">
                  <label className="schedule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={isPostBackgroundActive}
                      disabled={isPostBackgroundDisabled || isLegacyManualAdvancedSource}
                      onChange={event => {
                        const checked = event.target.checked
                        const apply = () => setFormData(current => {
                          const compatibleState = checked && current.formattedContentEnabled
                            ? convertFormattedStateToPlain(current)
                            : current
                          return { ...compatibleState, postWithBackground: checked }
                        })
                        if (checked && isFormattedContentEnabled) {
                          showConfirm(
                            'Đăng bài với phông nền không hỗ trợ nội dung có định dạng. Nội dung sẽ được chuyển sang văn bản thường.',
                            apply,
                            { title: 'Chuyển sang nội dung thường', confirmText: 'Chuyển và bật', variant: 'primary' }
                          )
                          return
                        }
                        apply()
                      }}
                    />
                    <span>Đăng bài với phông nền <em>(tối đa 130 ký tự, 3 dòng và không đăng ảnh)</em></span>
                  </label>
                </div>
              )}

              {isEmailCampaign && (
                <>
                  {!isAdvancedContentMode && (
                    <div className="stepper-form-group">
                      <label>Tiêu đề email <span className="required">*</span></label>
                      <input
                        type="text"
                        className="stepper-input"
                        value={formData.emailSubject}
                        onChange={event => setFormData(prev => ({ ...prev, emailSubject: event.target.value }))}
                      />
                    </div>
                  )}
                  <div className="campaign-quick-toggle-row">
                    <label className="schedule-checkbox-label">
                      <input
                        type="checkbox"
                        checked={formData.emailBodyIsHtml}
                        disabled={isAdvancedContentReadOnly}
                        onChange={event => {
                          const checked = event.target.checked
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
                    <label className="schedule-checkbox-label">
                      <input
                        type="checkbox"
                        checked={formData.emailCheckLinkClicks}
                        disabled={isLegacyManualAdvancedSource}
                        onChange={event => setFormData(prev => ({ ...prev, emailCheckLinkClicks: event.target.checked }))}
                      />
                      <span>Kiểm tra click vào link</span>
                    </label>
                  </div>
                </>
              )}

              {renderContentModeSegmented()}

              {canUseFormattedContent && !isAdvancedContentReadOnly && (
                <div className="stepper-form-group">
                  <label className="schedule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={isFormattedContentEnabled}
                      onChange={event => setFormattedContentEnabled(event.target.checked)}
                    />
                    <span>Nội dung có định dạng</span>
                  </label>
                  {isFormattedContentEnabled && !isAdvancedContentMode && (
                    <div className="schedule-hint" style={{ marginTop: 6 }}>
                      Dấu | phân tách các nội dung gửi luân phiên. Nhập \| nếu muốn hiển thị dấu |.
                    </div>
                  )}
                </div>
              )}
              {isAdvancedContentMode ? (
                <>
                  {renderAdvancedContentEditor()}
                  {renderSmsContentOptions()}
                  {!isAdvancedContentReadOnly && !isMobileManagedSmsCampaign && !isRichContentEditorEnabled && (
                    <label className="schedule-checkbox-label campaign-rewrite-run-toggle">
                      <input
                        type="checkbox"
                        checked={isCommentSeedingCampaign
                          ? formData.rewriteCommentContentEachRun
                          : formData.rewriteContentEachRun}
                        onChange={event => setFormData(prev => isCommentSeedingCampaign
                          ? { ...prev, rewriteCommentContentEachRun: event.target.checked }
                          : { ...prev, rewriteContentEachRun: event.target.checked })}
                      />
                      <span>{isCommentSeedingCampaign
                        ? 'Viết nội dung comment cho mỗi lượt chạy'
                        : 'Viết nội dung cho mỗi lượt chạy'}</span>
                    </label>
                  )}
                </>
              ) : (
                <>
                  {isCommentSeedingCampaign ? (
                    <>
                      <div className="stepper-form-group">
                        <label>Nội dung comment</label>
                        <textarea
                          className="stepper-textarea"
                          value={formData.commentContent}
                          onChange={event => setFormData(prev => ({ ...prev, commentContent: event.target.value }))}
                          rows={6}
                        />
                      </div>
                      <label className="schedule-checkbox-label campaign-rewrite-run-toggle">
                        <input
                          type="checkbox"
                          checked={formData.rewriteCommentContentEachRun}
                          onChange={event => setFormData(prev => ({ ...prev, rewriteCommentContentEachRun: event.target.checked }))}
                        />
                        <span>Viết nội dung comment cho mỗi lượt chạy</span>
                      </label>
                      {renderMediaPicker('comment', 'Ảnh comment')}
                    </>
                  ) : <div className="stepper-form-group">
                    <label>{isEmailCampaign ? (formData.emailBodyIsHtml ? 'Nội dung HTML' : 'Nội dung email') : isFormattedContentEnabled ? 'Nội dung có định dạng' : isMessageCampaign ? 'Nội dung tin nhắn' : 'Nội dung chiến dịch'}</label>
                    {isRichContentEditorEnabled ? (
                      <EmailHtmlEditor
                        value={formData.content}
                        onChange={html => setFormData(prev => ({ ...prev, content: html }))}
                      />
                    ) : (
                      <textarea
                        className={`stepper-textarea ${isMessageCampaign ? 'message-content-textarea' : ''}`}
                        value={formData.content}
                        onChange={event => setFormData(prev => ({ ...prev, content: event.target.value }))}
                        rows={8}
                      />
                    )}
                  </div>}

                  {renderSmsContentOptions()}

                  {!isCommentSeedingCampaign && !isMobileManagedSmsCampaign && !isRichContentEditorEnabled && (
                    <label className="schedule-checkbox-label campaign-rewrite-run-toggle">
                      <input
                        type="checkbox"
                        checked={formData.rewriteContentEachRun}
                        onChange={event => setFormData(prev => ({ ...prev, rewriteContentEachRun: event.target.checked }))}
                      />
                      <span>Viết nội dung cho mỗi lượt chạy</span>
                    </label>
                  )}

                  {!isCommentSeedingCampaign && showMainMedia && renderMediaPicker('post', isEmailCampaign ? 'Tệp đính kèm' : 'Media')}
                </>
              )}
            </div>
          </div>
        )}

        {showCommentContent && (
          <div className="stepper-section">
            <div className="stepper-section-header static">
              <div className="stepper-section-header-left">
                <span className="stepper-section-title">{isCommentSeedingCampaign ? 'Nội dung comment' : 'Kiêm comment'}</span>
              </div>
            </div>
            <div className="stepper-section-body">
              <div className="stepper-form-group">
                <label>Nội dung comment</label>
                <textarea
                  className="stepper-textarea"
                  value={formData.commentContent}
                  onChange={event => setFormData(prev => ({ ...prev, commentContent: event.target.value }))}
                  rows={5}
                />
              </div>
              <label className="schedule-checkbox-label campaign-rewrite-run-toggle">
                <input
                  type="checkbox"
                  checked={formData.rewriteCommentContentEachRun}
                  onChange={event => setFormData(prev => ({ ...prev, rewriteCommentContentEachRun: event.target.checked }))}
                />
                <span>Viết nội dung comment cho mỗi lượt chạy</span>
              </label>
              {renderMediaPicker('comment', 'Ảnh comment')}
            </div>
          </div>
        )}

        {showFriendRequestMessage && (
          <div className="stepper-section">
            <div className="stepper-section-header static">
              <div className="stepper-section-header-left">
                <span className="stepper-section-title">Nội dung kết bạn</span>
              </div>
            </div>
            <div className="stepper-section-body">
              <div className="stepper-form-group">
                <label>Nội dung kết bạn</label>
                <textarea
                  className="stepper-textarea"
                  value={formData.friendRequestMessage}
                  onChange={event => setFormData(prev => ({ ...prev, friendRequestMessage: event.target.value }))}
                  rows={3}
                />
                <div className="schedule-hint">{renderContentSpinMax(formData.friendRequestMessage).length}/150 ký tự</div>
              </div>
            </div>
          </div>
        )}

        {showPostBumpContent && (
          <div className="stepper-section">
            <div className="stepper-section-header static">
              <div className="stepper-section-header-left">
                <span className="stepper-section-title">Nội dung up tin</span>
              </div>
            </div>
            <div className="stepper-section-body">
              <div className="stepper-form-group">
                <label>Nội dung up tin</label>
                <textarea
                  className="stepper-textarea"
                  value={formData.postBumpContent}
                  onChange={event => setFormData(prev => ({ ...prev, postBumpContent: event.target.value }))}
                  rows={4}
                />
              </div>
            </div>
          </div>
        )}

        {showNewsfeedCommentContent && (
          <div className="stepper-section">
            <div className="stepper-section-header static">
              <div className="stepper-section-header-left">
                <span className="stepper-section-title">Nội dung comment newsfeed</span>
              </div>
            </div>
            <div className="stepper-section-body">
              <div className="stepper-form-group">
                <label>Nội dung comment</label>
                <textarea
                  className="stepper-textarea"
                  value={formData.newsfeedCommentContent}
                  onChange={event => setFormData(prev => ({ ...prev, newsfeedCommentContent: event.target.value }))}
                  rows={4}
                />
              </div>
            </div>
          </div>
        )}
      </QuickEditShell>

      <input
        ref={localImageInputRef}
        type="file"
        accept="image/*"
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
          pickerMode={mediaPickerTarget !== 'comment' && (isZaloMessageCampaign || isEmailCampaign) ? 'file' : 'image'}
          maxSelect={usesSingleCommentMediaSelection(mediaPickerTarget) ? 1 : undefined}
          onConfirm={handleMediaPickerConfirm}
          onClose={() => setMediaPickerTarget(null)}
        />
      )}
    </>,
    document.body
  )
}
