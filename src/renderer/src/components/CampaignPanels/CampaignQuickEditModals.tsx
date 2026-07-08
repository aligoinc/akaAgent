import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Image as ImageIcon, Save, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type {
  ActionLimitConfig,
  Campaign,
  CampaignAction,
  CampaignExtraSettings,
  CampaignMediaInput,
  CampaignMediaSnapshot
} from '../../../../shared/types'
import { renderContentSpinMax, splitContentVariants } from '../../../../shared/contentSpin'
import { useAuthStore } from '../../stores/authStore'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import {
  clampDailyLimitToEntitlement,
  getAccountActionDailySendLimit,
  getCampaignActionDailySendLimit
} from '../../utils/entitlements'
import MediaLibraryModal from '../Media/MediaLibraryModal'
import MediaPreviewHover from '../Media/MediaPreviewHover'
import EmailHtmlEditor from './EmailHtmlEditor'

type ActionLimitForm = Required<Pick<ActionLimitConfig, 'dailyLimit' | 'rateLimitCount' | 'rateLimitMinutes'>>
type ImageOption = 'none' | 'all' | 'random'
type CommentImageOption = 'none' | 'all'

interface CampaignQuickEditModalProps {
  campaign: Campaign
  action?: CampaignAction
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
  emailSubject: string
  emailBodyIsHtml: boolean
  emailCheckLinkClicks: boolean
  smsUseUnicode: boolean
  smsKeepNewLines: boolean
  rewriteContentEachRun: boolean
  postWithBackground: boolean
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
const PAGE_POST_ACTION_ID = 'facebook_page_post'
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const ZALO_MESSAGE_FRIEND_ACTION_ID = 'zalo_message_friend'
const ZALO_MESSAGE_BIRTHDAY_ACTION_ID = 'zalo_message_birthday'
const ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID = 'zalo_message_group_member'
const ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID = 'zalo_message_group_realtime'
const ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID = 'zalo_message_remarketing_customer'
const ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID = 'zalo_message_friend_recommendation'
const ZALO_MESSAGE_GROUP_ACTION_ID = 'zalo_message_group'
const ZALO_JOIN_GROUP_LINK_ACTION_ID = 'zalo_join_group_link'
const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID = 'zalo_cancel_sent_friend_request'
const EMAIL_SEND_ACTION_ID = 'email_send'
const SMS_SEND_ACTION_ID = 'sms_send'

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
  SMS_SEND_ACTION_ID
])
const MESSAGE_CONTENT_TOGGLE_ACTION_IDS = new Set([
  MESSAGE_UID_ACTION_ID,
  ZALO_MESSAGE_PHONE_ACTION_ID,
  ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID,
  ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID,
  ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID,
  ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
])

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
  zalo_find_phone_user: 'Tìm SĐT',
  zalo_message_friend: 'Nhắn tin bạn bè',
  zalo_message_group: 'Nhắn tin group',
  zalo_message_stranger: 'Nhắn tin người lạ',
  zalo_add_friend: 'Kết bạn',
  zalo_join_group_link: 'Tham gia group',
  zalo_cancel_sent_friend_request: 'Huỷ lời mời kết bạn',
  zalo_tag_contact: 'Gắn tag Zalo',
  zalo_change_alias: 'Đổi tên Zalo',
  email_send: 'Gửi email',
  sms_send: 'Gửi SMS'
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
  zalo_find_phone_user: 'SĐT',
  zalo_message_friend: 'tin nhắn',
  zalo_message_group: 'tin nhắn',
  zalo_message_stranger: 'tin nhắn',
  zalo_add_friend: 'lời mời',
  zalo_join_group_link: 'group',
  zalo_cancel_sent_friend_request: 'lời mời',
  email_send: 'email',
  sms_send: 'tin nhắn'
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

const isCampaignMediaImage = (item: CampaignMediaInput): boolean => {
  if (isCampaignMediaSnapshot(item)) {
    const mimeType = String(item.mimeType || '').toLowerCase()
    if (mimeType) return mimeType.startsWith('image/')
    const candidate = item.localPath || item.cloudUrl || item.name || ''
    return /\.(apng|avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(candidate)
  }
  return isDataImagePath(item) || /\.(apng|avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(item)
}

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
      campaign.actionId === SMS_SEND_ACTION_ID ? 'sms' : 'facebook')

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
    rateLimitMinutes: actionLimits.rateLimitMinutes ?? DEFAULT_RATE_LIMIT_MINUTES
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
  const savedCommentImages = (extra.commentImages || []).slice(0, 1)
  const savedCommentImageOption: CommentImageOption =
    extra.commentImageOption && extra.commentImageOption !== 'none' && savedCommentImages.length > 0 ? 'all' : 'none'
  return {
    content: campaign.content || '',
    emailSubject: extra.emailSubject || '',
    emailBodyIsHtml: extra.emailBodyIsHtml ?? false,
    emailCheckLinkClicks: extra.emailCheckLinkClicks ?? false,
    smsUseUnicode: extra.smsUseUnicode ?? false,
    smsKeepNewLines: extra.smsKeepNewLines ?? false,
    rewriteContentEachRun: extra.rewriteContentEachRun ?? false,
    postWithBackground: extra.postWithBackground ?? false,
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
  const canUseSleepBetweenActions = campaign.actionId !== 'facebook_timeline_post' && campaign.actionId !== NEWSFEED_INTERACTION_ACTION_ID

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

export function CampaignContentMediaUpdateModal({ campaign, action, onClose }: CampaignQuickEditModalProps) {
  const updateCampaign = useCampaignStore(state => state.updateCampaign)
  const showAlert = useUiStore(state => state.showAlert)
  const [saving, setSaving] = useState(false)
  const [mediaPickerTarget, setMediaPickerTarget] = useState<'post' | 'comment' | null>(null)
  const [formData, setFormData] = useState<CampaignContentFormState>(() => getInitialContentFormState(campaign))
  const actionId = campaign.actionId
  const extra = campaign.extraSettings || {}
  const isEmailCampaign = actionId === EMAIL_SEND_ACTION_ID
  const isSmsCampaign = actionId === SMS_SEND_ACTION_ID
  const isCommentSeedingCampaign = COMMENT_SEEDING_ACTION_IDS.has(actionId)
  const isNewsfeedInteractionCampaign = actionId === NEWSFEED_INTERACTION_ACTION_ID
  const isFacebookGroupPostCampaign = actionId === FACEBOOK_GROUP_POST_ACTION_ID
  const isFacebookJoinGroupCampaign = actionId === FACEBOOK_JOIN_GROUP_ACTION_ID
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
    actionId !== ZALO_JOIN_GROUP_LINK_ACTION_ID &&
    actionId !== ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID &&
    (!isToggleableMessageContentCampaign || hasMessageEnabled) &&
    !isCommentSeedingCampaign
  const canUsePostBackground = (actionId === 'facebook_timeline_post' || actionId === PAGE_POST_ACTION_ID) &&
    !(actionId === PAGE_POST_ACTION_ID && extra.pagePostMode === 'api') &&
    !extra.copyContentFromSource &&
    !extra.sharePost &&
    !extra.postAsReels
  const isPostBackgroundActive = canUsePostBackground && formData.postWithBackground
  const showMainMedia = showMainContentSection && !isSmsCampaign && !isFacebookJoinGroupCampaign
  const showCommentContent = isCommentSeedingCampaign || (isFacebookGroupPostCampaign && extra.enableComment === true)
  const showPostBumpContent = isFacebookGroupPostCampaign && extra.enablePostBump === true
  const showNewsfeedCommentContent = isNewsfeedInteractionCampaign && extra.enableComment === true
  const showFriendRequestMessage = (
    actionId === ZALO_MESSAGE_PHONE_ACTION_ID ||
    actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
    actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID ||
    actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
    actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
  ) && extra.enableAddFriend === true
  const hasAnyEditableField = showMainContentSection || showCommentContent || showPostBumpContent || showNewsfeedCommentContent || showFriendRequestMessage

  const validateSelectedMedia = (label: string, option: string, images: CampaignMediaInput[]): boolean => {
    if (option === 'none' || images.length === 0) return true
    const missingImages = images.filter(item => !isUsableCampaignMedia(item))
    if (missingImages.length === 0) return true

    const names = missingImages.slice(0, 3).map(getCampaignMediaDisplayName).join(', ')
    const suffix = missingImages.length > 3 ? ` và ${missingImages.length - 3} file khác` : ''
    showAlert(`${label} có file không còn tồn tại và không có cloud URL fallback: ${names}${suffix}. Vui lòng xoá file lỗi hoặc chọn lại.`, 'error')
    return false
  }

  const getPostBackgroundValidationError = (): string | null => {
    if (!isPostBackgroundActive) return null

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

  const handleMediaPickerConfirm = (items: CampaignMediaSnapshot[]) => {
    if (!mediaPickerTarget || items.length === 0) return
    const acceptedItems = mediaPickerTarget === 'comment' || !(isZaloMessageCampaign || isEmailCampaign)
      ? items.filter(isCampaignMediaImage)
      : items
    if (acceptedItems.length === 0) return
    setFormData(prev => {
      if (mediaPickerTarget === 'comment') {
        return { ...prev, commentImages: acceptedItems.slice(0, 1), commentImageOption: 'all' }
      }
      const currentKeys = new Set(prev.images.map(getCampaignMediaStableKey))
      const nextItems = acceptedItems.filter(item => !currentKeys.has(getCampaignMediaStableKey(item)))
      return { ...prev, images: [...prev.images, ...nextItems] }
    })
  }

  const removeMedia = (target: 'post' | 'comment', index: number) => {
    setFormData(prev => target === 'comment'
      ? { ...prev, commentImages: prev.commentImages.filter((_, itemIndex) => itemIndex !== index) }
      : { ...prev, images: prev.images.filter((_, itemIndex) => itemIndex !== index) }
    )
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
      setFormData(prev => isComment
        ? { ...prev, commentImageOption: value === 'none' ? 'none' : 'all' }
        : { ...prev, imageOption: value }
      )
    }

    return (
      <div className="campaign-quick-media-panel">
        <div className="campaign-quick-media-header">
          <strong>{title}</strong>
          {isComment && <span>Facebook chỉ cho phép comment 1 ảnh.</span>}
          {!isComment && isPostBackgroundActive && <span>Đăng bài với phông nền không hỗ trợ gửi media.</span>}
        </div>
        <div className="campaign-quick-media-layout">
          <div className="campaign-quick-media-options">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setMediaPickerTarget(target)}
              disabled={option === 'none'}
            >
              <ImageIcon size={14} />
              <span>{isEmailAttachment ? 'Chọn tệp đính kèm' : isZaloMedia ? 'Chọn file' : 'Chọn ảnh'}</span>
            </button>
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
              <span>{isEmailAttachment ? 'Đính kèm file đã chọn' : isZaloMedia ? 'Gửi file đã chọn' : 'Gửi ảnh đã chọn'}</span>
            </label>
            {!isComment && (
              <div className="campaign-quick-random-media-row">
                <label className="schedule-radio-label">
                  <input
                    type="radio"
                    name={radioName}
                    checked={option === 'random'}
                    onChange={() => setOption('random')}
                  />
                  <span>{isFileMedia ? 'Gửi ngẫu nhiên số file' : 'Gửi ngẫu nhiên số ảnh'}</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={formData.randomImageCount}
                  onChange={event => setFormData(prev => ({
                    ...prev,
                    randomImageCount: normalizePositiveInteger(event.target.value, 1, 1)
                  }))}
                  className="stepper-input"
                  disabled={option !== 'random'}
                />
              </div>
            )}
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

  const handleSave = async () => {
    if (!hasAnyEditableField) {
      showAlert('Loại chiến dịch này không có nội dung hoặc media để cập nhật.', 'info')
      return
    }
    if (isEmailCampaign && !formData.emailSubject.trim()) {
      showAlert('Vui lòng nhập tiêu đề email.', 'error')
      return
    }
    if (showMainContentSection) {
      const hasMainContentText = formData.content.trim().length > 0
      const hasSelectedMainMedia = !isSmsCampaign && formData.imageOption !== 'none' && formData.images.length > 0
      if (!isUsingSourceContent && !hasMainContentText && !hasSelectedMainMedia) {
        showAlert(
          isEmailCampaign
            ? 'Vui lòng nhập nội dung email hoặc chọn ít nhất một tệp đính kèm.'
            : isSmsCampaign
              ? 'Vui lòng nhập nội dung tin nhắn SMS.'
              : isMessageCampaign
                ? `Vui lòng nhập nội dung tin nhắn hoặc chọn ít nhất một ${isZaloMessageCampaign ? 'file' : 'ảnh'}.`
                : 'Vui lòng nhập nội dung chiến dịch hoặc chọn ít nhất một ảnh.',
          'error'
        )
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
    const postBackgroundError = getPostBackgroundValidationError()
    if (postBackgroundError) {
      showAlert(postBackgroundError, 'error')
      return
    }
    if (showMainMedia && !validateSelectedMedia(isEmailCampaign ? 'Tệp đính kèm' : 'Media', formData.imageOption, formData.images)) return
    if (showCommentContent && !validateSelectedMedia('Ảnh comment', formData.commentImageOption, formData.commentImages)) return

    setSaving(true)
    let shouldClose = false
    try {
      const nextExtraSettings: CampaignExtraSettings = {
        ...(campaign.extraSettings || {})
      }

      if (showMainContentSection) {
        nextExtraSettings.rewriteContentEachRun = isSmsCampaign || (isEmailCampaign && formData.emailBodyIsHtml)
          ? false
          : formData.rewriteContentEachRun
        nextExtraSettings.imageOption = (isSmsCampaign || isFacebookJoinGroupCampaign || isPostBackgroundActive) ? 'none' : formData.imageOption
        nextExtraSettings.randomImageCount = formData.randomImageCount
      }
      if (isEmailCampaign) {
        nextExtraSettings.emailSubject = formData.emailSubject.trim()
        nextExtraSettings.emailBodyIsHtml = formData.emailBodyIsHtml
        nextExtraSettings.emailCheckLinkClicks = formData.emailCheckLinkClicks
      }
      if (isSmsCampaign) {
        nextExtraSettings.smsUseUnicode = formData.smsUseUnicode
        nextExtraSettings.smsKeepNewLines = formData.smsKeepNewLines
      }
      if (canUsePostBackground) {
        nextExtraSettings.postWithBackground = isPostBackgroundActive
        if (isPostBackgroundActive) {
          nextExtraSettings.copyContentFromSource = false
          nextExtraSettings.includeSourceImages = false
          nextExtraSettings.rewriteSourceContentWithAI = false
          nextExtraSettings.sharePost = false
          nextExtraSettings.postAsReels = false
        }
      }
      if (showCommentContent) {
        nextExtraSettings.commentContent = formData.commentContent
        nextExtraSettings.rewriteCommentContentEachRun = formData.rewriteCommentContentEachRun
        nextExtraSettings.commentImageOption = formData.commentImageOption !== 'none' && formData.commentImages.length > 0 ? 'all' : 'none'
        nextExtraSettings.commentImages = formData.commentImages.slice(0, 1)
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
        ...(showMainContentSection ? { content: formData.content } : {}),
        extraSettings: nextExtraSettings,
        ...(showMainMedia ? { images: isSmsCampaign || isFacebookJoinGroupCampaign ? [] : formData.images } : {})
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
              {canUsePostBackground && (
                <div className="stepper-form-group">
                  <label className="schedule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.postWithBackground}
                      onChange={event => setFormData(prev => ({ ...prev, postWithBackground: event.target.checked }))}
                    />
                    <span>Đăng bài với phông nền <em>(tối đa 130 ký tự, 3 dòng và không đăng ảnh)</em></span>
                  </label>
                </div>
              )}

              {isEmailCampaign && (
                <>
                  <div className="stepper-form-group">
                    <label>Tiêu đề email <span className="required">*</span></label>
                    <input
                      type="text"
                      className="stepper-input"
                      value={formData.emailSubject}
                      onChange={event => setFormData(prev => ({ ...prev, emailSubject: event.target.value }))}
                    />
                  </div>
                  <div className="campaign-quick-toggle-row">
                    <label className="schedule-checkbox-label">
                      <input
                        type="checkbox"
                        checked={formData.emailBodyIsHtml}
                        onChange={event => setFormData(prev => ({
                          ...prev,
                          emailBodyIsHtml: event.target.checked,
                          rewriteContentEachRun: event.target.checked ? false : prev.rewriteContentEachRun
                        }))}
                      />
                      <span>Nội dung dạng HTML</span>
                    </label>
                    <label className="schedule-checkbox-label">
                      <input
                        type="checkbox"
                        checked={formData.emailCheckLinkClicks}
                        onChange={event => setFormData(prev => ({ ...prev, emailCheckLinkClicks: event.target.checked }))}
                      />
                      <span>Kiểm tra click vào link</span>
                    </label>
                  </div>
                </>
              )}

              <div className="stepper-form-group">
                <label>{isEmailCampaign ? (formData.emailBodyIsHtml ? 'Nội dung HTML' : 'Nội dung email') : isMessageCampaign ? 'Nội dung tin nhắn' : 'Nội dung chiến dịch'}</label>
                {isEmailCampaign && formData.emailBodyIsHtml ? (
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
              </div>

              {isSmsCampaign && (
                <div className="campaign-quick-toggle-row">
                  <label className="schedule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.smsUseUnicode}
                      onChange={event => setFormData(prev => ({ ...prev, smsUseUnicode: event.target.checked }))}
                    />
                    <span>Tiếng Việt có dấu</span>
                  </label>
                  <label className="schedule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.smsKeepNewLines}
                      onChange={event => setFormData(prev => ({ ...prev, smsKeepNewLines: event.target.checked }))}
                    />
                    <span>Không loại bỏ xuống dòng</span>
                  </label>
                </div>
              )}

              {!isSmsCampaign && !(isEmailCampaign && formData.emailBodyIsHtml) && (
                <label className="schedule-checkbox-label campaign-rewrite-run-toggle">
                  <input
                    type="checkbox"
                    checked={formData.rewriteContentEachRun}
                    onChange={event => setFormData(prev => ({ ...prev, rewriteContentEachRun: event.target.checked }))}
                  />
                  <span>Viết nội dung cho mỗi lượt chạy</span>
                </label>
              )}

              {showMainMedia && renderMediaPicker('post', isEmailCampaign ? 'Tệp đính kèm' : 'Media')}
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

      {mediaPickerTarget && (
        <MediaLibraryModal
          pickerMode={mediaPickerTarget === 'post' && (isZaloMessageCampaign || isEmailCampaign) ? 'file' : 'image'}
          maxSelect={mediaPickerTarget === 'comment' ? 1 : undefined}
          onConfirm={handleMediaPickerConfirm}
          onClose={() => setMediaPickerTarget(null)}
        />
      )}
    </>,
    document.body
  )
}
