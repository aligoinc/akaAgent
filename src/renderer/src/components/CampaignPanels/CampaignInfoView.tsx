import { useEffect, useState, type ReactNode } from 'react'
import type {
  AutoAccount,
  Campaign,
  CampaignAction,
  CampaignConfig,
  CampaignExtraSettings,
  CampaignListItem,
  CampaignMediaInput,
  CampaignRelationSettings,
  DataGroupLatestIngestStats
} from '../../../../shared/types'
import {
  formattedContentToPlainText,
  splitFormattedContentVariants,
  supportsFormattedContent
} from '../../../../shared/formattedContent'
import { normalizeAdvancedContentItems } from '../../../../shared/advancedContent'

interface CampaignInfoViewProps {
  campaign: CampaignConfig
  account: AutoAccount | null
  action?: CampaignAction
  campaigns: CampaignListItem[]
  accounts: AutoAccount[]
}

interface InfoRow {
  label: string
  value: ReactNode
  hidden?: boolean
  fullWidth?: boolean
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
  zalo_message_stranger: 'Zalo - Nhắn tin người lạ',
  zalo_message_friend: 'Zalo - Nhắn tin bạn bè',
  zalo_message_group: 'Zalo - Nhắn tin group',
  zalo_add_friend: 'Zalo - Kết bạn',
  zalo_add_group_member: 'Zalo - Thêm thành viên vào group',
  zalo_join_group_link: 'Zalo - Tham gia group',
  zalo_cancel_sent_friend_request: 'Zalo - Huỷ lời mời kết bạn',
  zalo_tag_contact: 'Zalo - Gắn tag',
  zalo_change_alias: 'Zalo - Đổi tên'
}

const POST_SORT_LABELS: Record<NonNullable<CampaignExtraSettings['sortTypePost']>, string> = {
  most_relevant: 'Phù hợp nhất',
  recent_activity: 'Hoạt động mới đây',
  new_posts: 'Bài viết mới'
}

const COMMENT_SORT_LABELS: Record<NonNullable<CampaignExtraSettings['sortTypeComment']>, string> = {
  most_relevant: 'Phù hợp nhất',
  all_comments: 'Tất cả bình luận',
  newest: 'Mới nhất'
}

const SEARCH_POST_DATE_FILTER_LABELS: Record<NonNullable<CampaignExtraSettings['searchPostDateFilter']>, string> = {
  all: 'Tất cả',
  today: 'Hôm nay',
  this_week: 'Tuần này',
  this_month: 'Tháng này'
}

const SEARCH_POST_AUTHOR_FILTER_LABELS: Record<NonNullable<CampaignExtraSettings['searchPostAuthorFilter']>, string> = {
  all: 'Tất cả',
  you: 'Bài viết của bạn',
  friends: 'Bạn bè',
  groups_pages: 'Nhóm và Trang'
}

const SEARCH_POST_TAGGED_LOCATION_LABELS: Record<NonNullable<CampaignExtraSettings['searchPostTaggedLocation']>, string> = {
  all: 'Tất cả',
  near_me: 'Gần tôi'
}

const FIND_DATA_GOAL_PRIORITY_LABELS: Record<NonNullable<CampaignExtraSettings['findDataGoalPriority']>, string> = {
  phone: 'Số điện thoại',
  zalo_group_link: 'Link group Zalo',
  facebook_uid: 'Uid user facebook',
  post_link: 'Link post',
  facebook_group: 'Link group Facebook'
}

const DEFAULT_RATE_LIMIT_MINUTES = 65
const NEWSFEED_INTERACTION_ACTION_ID = 'facebook_newsfeed_interaction'
const FACEBOOK_GROUP_INVITE_ACTION_ID = 'facebook_group_invite'
const POST_ACTIONS_WITH_SOURCE = new Set(['facebook_timeline_post', 'facebook_page_post', 'facebook_group_post'])
const COMMENT_ACTIONS = new Set(['facebook_group_post', 'facebook_comment_seeding', 'facebook_comment_seeding_post'])
const COMMENT_SEEDING_ACTIONS = new Set(['facebook_comment_seeding', 'facebook_comment_seeding_post'])
const ACTIONS_WITHOUT_MAIN_CONTENT = new Set([
  'facebook_find_data_group',
  'facebook_find_data_search',
  'facebook_comment_seeding',
  'facebook_comment_seeding_post',
  NEWSFEED_INTERACTION_ACTION_ID,
  'facebook_join_group',
  FACEBOOK_GROUP_INVITE_ACTION_ID,
  'zalo_add_group_member',
  'zalo_join_group_link',
  'zalo_cancel_sent_friend_request',
  'voice_call'
])
const MESSAGE_ACTIONS_REQUIRING_ENABLE = new Set([
  'facebook_message_uid',
  'zalo_message_phone',
  'zalo_message_group_member',
  'zalo_message_group_realtime',
  'zalo_message_remarketing_customer',
  'zalo_message_friend_recommendation'
])
const MESSAGE_ACTIONS = new Set(['facebook_message_friend', 'facebook_message_uid', 'facebook_page_to_message'])
const ZALO_FRIEND_RECOMMENDATION_ACTION_ID = 'zalo_message_friend_recommendation'
const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID = 'zalo_cancel_sent_friend_request'
const EXTERNAL_SMS_STATUS_LABELS: Record<string, string> = {
  'thành công': 'Thành công',
  'thất bại': 'Thất bại',
  'không tồn tại': 'Không tồn tại'
}

const pad2 = (value: number) => String(value).padStart(2, '0')

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-'
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) return `00:00 ${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())} ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`
}

const formatTime = (value?: string | null): string => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return 'Không giới hạn'
  return `${pad2(Number(match[1]))}:${match[2]}`
}

const textOrDash = (value: unknown): string => {
  if (value === null || value === undefined) return '-'
  const text = String(value).trim()
  return text || '-'
}

const onOff = (value?: boolean) => value ? 'Bật' : 'Tắt'

const getNumberList = (value: unknown): number[] => {
  if (!Array.isArray(value)) return []
  return value
    .map(item => Number(item))
    .filter(item => Number.isFinite(item))
}

const getStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item || '').trim()).filter(Boolean)
}

const formatExternalSmsStatuses = (value: unknown): string => {
  const statuses = getStringList(value)
    .map(status => status.toLocaleLowerCase('vi-VN'))
    .map(status => EXTERNAL_SMS_STATUS_LABELS[status] || status)
  return statuses.length > 0 ? statuses.join(', ') : '-'
}

const getActionCodeLabel = (code: string) => ACTION_CODE_LABELS[code] || code

const formatScheduleType = (type: Campaign['scheduleType']) => {
  if (type === 'weekly') return 'Theo tuần'
  if (type === 'monthly') return 'Theo tháng'
  return 'Hàng ngày'
}

const formatWeekDays = (value?: string) => {
  const selected = new Set((value || '').split(',').map(item => item.trim()).filter(Boolean))
  const labels = WEEKDAYS.filter(day => selected.has(day.value)).map(day => day.label)
  return labels.length > 0 ? labels.join(', ') : '-'
}

const formatMonthDays = (value?: string) => {
  const days = (value || '').split(',').map(day => day.trim()).filter(Boolean)
  return days.length > 0 ? `Ngày ${days.join(', ')}` : '-'
}

const getMediaDisplayName = (media: CampaignMediaInput, index: number): string => {
  if (typeof media === 'string') {
    const value = String(media || '').trim()
    if (!value || value.startsWith('data:')) return `Media ${index + 1}`
    return value.split(/[\\/]/).pop() || `Media ${index + 1}`
  }
  return media.name ||
    media.localPath?.split(/[\\/]/).pop() ||
    media.cloudUrl?.split('/').pop()?.split('?')[0] ||
    `Media ${index + 1}`
}

const formatImageSummary = (images?: CampaignMediaInput[]) => {
  const list = Array.isArray(images) ? images.filter(Boolean) : []
  if (list.length === 0) return 'Không có'
  const names = list.slice(0, 5).map(getMediaDisplayName)
  return `${list.length} media: ${names.join(', ')}${list.length > names.length ? '...' : ''}`
}

const formatImageOption = (extra: CampaignExtraSettings, images?: CampaignMediaInput[]) => {
  if ((images || []).length === 0 && !extra.imageOption) return 'Không dùng media'
  if (extra.imageOption === 'random') return `Ngẫu nhiên ${extra.randomImageCount || '-'} media`
  if (extra.imageOption === 'all') return 'Dùng tất cả media'
  return 'Không dùng media'
}

const formatCommentImageOption = (extra: CampaignExtraSettings) => {
  if (extra.commentImageOption === 'random') return 'Ngẫu nhiên 1 ảnh/video'
  if (extra.commentImageOption === 'all') return 'Gửi media đã chọn'
  return 'Không gửi media'
}

const getDeclaredMedia = (images?: CampaignMediaInput[]): CampaignMediaInput[] => (
  Array.isArray(images)
    ? images.filter(item => {
        if (typeof item === 'string') return item.trim().length > 0
        return Boolean(String(item?.localPath || '').trim() || String(item?.cloudUrl || '').trim())
      })
    : []
)

const formatCampaignRefs = (ids: unknown, campaigns: CampaignListItem[]) => {
  const list = getNumberList(ids)
  if (list.length === 0) return '-'
  return (
    <span className="campaign-info-chip-list">
      {list.map(id => {
        const campaign = campaigns.find(item => item.id === id)
        return <span key={id} className="campaign-info-chip">{campaign ? `${campaign.name} (#${id})` : `#${id}`}</span>
      })}
    </span>
  )
}

const formatAccountRefs = (ids: unknown, accounts: AutoAccount[]) => {
  const list = getNumberList(ids)
  if (list.length === 0) return '-'
  return (
    <span className="campaign-info-chip-list">
      {list.map(id => {
        const account = accounts.find(item => item.id === id)
        return <span key={id} className="campaign-info-chip">{account ? `${account.name} (#${id})` : `#${id}`}</span>
      })}
    </span>
  )
}

const formatActionCodeChips = (codes: string[]) => {
  if (codes.length === 0) return '-'
  return (
    <span className="campaign-info-chip-list">
      {codes.map(code => <span key={code} className="campaign-info-chip">{getActionCodeLabel(code)}</span>)}
    </span>
  )
}

const formatLimitValue = (
  config: { dailyLimit?: number; rateLimitCount?: number; rateLimitMinutes?: number } | undefined,
  fallbackWindowMinutes: number
) => {
  const dailyLimit = config?.dailyLimit ?? '-'
  const rateLimitCount = config?.rateLimitCount ?? '-'
  const windowMinutes = config?.rateLimitMinutes ?? fallbackWindowMinutes
  return `${dailyLimit}/ngày, ${rateLimitCount}/${windowMinutes} phút`
}

const formatCommentGroupMode = (value?: CampaignExtraSettings['commentGroupMode']) => {
  if (value === 'pending_only') return 'Chỉ group bị duyệt đăng bài'
  if (value === 'published_only') return 'Chỉ group đăng bài thành công ngay'
  return 'Mọi group'
}

const formatCommentType = (value?: CampaignExtraSettings['commentType']) => {
  if (value === 'others') return 'Không comment vào post của mình'
  if (value === 'all') return 'Tất cả post'
  return 'Post của mình'
}

const formatPostBumpMode = (value?: CampaignExtraSettings['postBumpMode']) => (
  value === 'select' ? 'Chọn chiến dịch có sẵn' : 'Tạo mới theo tài khoản'
)

const getFindDataTypeLabels = (extra: CampaignExtraSettings): string[] => {
  const labels: string[] = []
  if (extra.isFindUid) labels.push('UID')
  if (extra.isFindPhone) labels.push('SĐT')
  if (extra.isFindLinkGroupZalo) labels.push('Link group Zalo')
  if (extra.isFindPostLink) labels.push('Link bài post')
  if (extra.isFindFacebookGroup) labels.push('Link group Facebook')
  return labels
}

const getFindDataSourceLabels = (extra: CampaignExtraSettings): string[] => {
  const labels: string[] = []
  if (extra.isFindInPost) labels.push('Bài post')
  if (extra.isFindInComment) labels.push('Comment')
  if (extra.isFindNewInteractors) labels.push('Tương tác mới')
  if (extra.isFindInGroupMembers) labels.push('Thành viên group')
  if (extra.isFindFacebookGroup) labels.push('Group Facebook')
  return labels
}

const findLinkedSourceCampaigns = (
  campaign: CampaignConfig,
  campaigns: CampaignListItem[]
): CampaignListItem[] => {
  const targetFields: (keyof CampaignRelationSettings)[] = campaign.actionId === 'facebook_message_uid'
    ? ['findUidTargetCampaignIds']
    : campaign.actionId === 'facebook_comment_seeding_post'
      ? ['findPostLinkTargetCampaignIds']
      : campaign.actionId === 'zalo_message_phone'
        ? ['findPhoneZaloMessagePhoneTargetCampaignIds']
      : campaign.actionId === 'zalo_join_group_link'
        ? ['findZaloGroupLinkJoinTargetCampaignIds']
      : campaign.actionId === 'facebook_group_post'
        ? ['findFacebookGroupPostTargetCampaignIds']
        : campaign.actionId === 'facebook_comment_seeding'
          ? ['findFacebookGroupCommentTargetCampaignIds']
        : campaign.actionId === 'facebook_join_group'
          ? ['findFacebookGroupJoinTargetCampaignIds']
          : []
  if (targetFields.length === 0) return []
  return campaigns.filter(source => targetFields.some(field =>
    getNumberList(source.relationSettings[field]).includes(campaign.id)
  ))
}

const formatLinkedCampaigns = (items: CampaignListItem[]) => {
  if (items.length === 0) return '-'
  return (
    <span className="campaign-info-chip-list">
      {items.map(item => <span key={item.id} className="campaign-info-chip">{item.name} (#{item.id})</span>)}
    </span>
  )
}

const renderSection = (title: string, rows: InfoRow[]) => {
  const visibleRows = rows.filter(row => !row.hidden)
  if (visibleRows.length === 0) return null

  return (
    <section className="campaign-info-card">
      <h4>{title}</h4>
      <div className="campaign-info-card-body">
        {visibleRows.map(row => (
          <div key={row.label} className={`campaign-info-row ${row.fullWidth ? 'full-width' : ''}`}>
            <div className="campaign-info-label">{row.label}</div>
            <div className="campaign-info-value">{row.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function CampaignInfoView({ campaign, account, action, campaigns, accounts }: CampaignInfoViewProps) {
  const [dataGroupDisplay, setDataGroupDisplay] = useState<{ name: string; sourceStatus: string } | null>(null)
  const [dataGroupStats, setDataGroupStats] = useState<DataGroupLatestIngestStats | null>(null)
  const secondaryAccountName = campaign.secondaryAccountName
    || accounts.find(item => item.id === campaign.secondaryAccountId)?.name
    || (campaign.secondaryAccountId ? `#${campaign.secondaryAccountId}` : '')
  const campaignSummary = campaigns.find(item => item.id === campaign.id)
  const dataGroupNameHint = campaignSummary?.dataGroupName ?? campaign.dataGroupName ?? null
  const dataGroupRefreshRevision = campaignSummary?.dataGroupSourceUpdatedAt
    ?? campaign.dataGroupSourceUpdatedAt
    ?? null

  useEffect(() => {
    let disposed = false
    setDataGroupDisplay(null)
    setDataGroupStats(null)
    if (campaign.dataTargetSourceMode !== 'data_group' || !campaign.dataGroupId) {
      return () => { disposed = true }
    }

    void Promise.all([
      window.electronAPI.getCampaignDataGroupSource(campaign.id),
      dataGroupNameHint
        ? Promise.resolve(dataGroupNameHint)
        : (async () => {
          let offset = 0
          while (true) {
            const page = await window.electronAPI.listDataGroups({ offset, limit: 200 })
            const found = page.groups.find(group => group.id === campaign.dataGroupId)
            if (found) return found.name
            offset += page.groups.length
            if (page.groups.length === 0 || offset >= page.total) return null
          }
        })(),
      window.electronAPI.getDataGroupLatestIngestStats(campaign.dataGroupId).catch(() => null)
    ]).then(([source, groupName, stats]) => {
      if (disposed) return
      setDataGroupStats(stats)
      setDataGroupDisplay({
        name: groupName || (source?.stopReason === 'group_deleted' ? 'Nhóm đã xoá' : 'Nhóm data'),
        sourceStatus: source?.status === 'active'
          ? 'Đang nhận data mới'
          : source?.status === 'baselining'
            ? 'Đang nạp dữ liệu ban đầu'
            : source?.status === 'stopped'
              ? 'Đã dừng nhận data mới'
              : 'Không xác định'
      })
    }).catch(() => {
      if (!disposed) setDataGroupDisplay({ name: 'Nhóm data', sourceStatus: 'Không tải được trạng thái' })
    })

    return () => { disposed = true }
  }, [
    campaign.dataGroupId,
    campaign.dataTargetSourceMode,
    campaign.id,
    dataGroupNameHint,
    dataGroupRefreshRevision
  ])
  const extra = campaign.extraSettings || {}
  const actionId = campaign.actionId
  const isFormattedContent = supportsFormattedContent(actionId) && extra.formattedContentEnabled === true
  const isRichCampaignContent = isFormattedContent || (actionId === 'email_send' && extra.emailBodyIsHtml === true)
  const advancedContentItems = Array.isArray(extra.advancedContentItems) ? extra.advancedContentItems : []
  const normalizedAdvancedMediaItems = normalizeAdvancedContentItems(extra.advancedContentItems)
  const displayCampaignContent = extra.advancedContentEnabled && advancedContentItems.length > 0
    ? advancedContentItems
      .map(item => isRichCampaignContent ? formattedContentToPlainText(item.content) : String(item.content || '').trim())
      .filter(Boolean)
      .join('\n\n———\n\n')
    : isRichCampaignContent
      ? splitFormattedContentVariants(campaign.content)
        .map(formattedContentToPlainText)
        .filter(Boolean)
        .join('\n\n———\n\n')
      : campaign.content
  const advancedContentSourceLabel = extra.advancedContentSource === 'group_snapshot'
    ? 'Nhóm mẫu nội dung (snapshot chỉ đọc)'
    : 'Nâng cao'
  const advancedItemSourceSummary = advancedContentItems
    .map((item, index) => item.sourceTemplateName
      ? `${index + 1}. ${item.sourceTemplateName}${item.sourceVariantIndex !== undefined ? ` — biến thể ${item.sourceVariantIndex + 1}` : ''}`
      : '')
    .filter(Boolean)
    .join('\n')
  const advancedEmailSubjectSummary = actionId === 'email_send'
    ? advancedContentItems
      .map((item, index) => `${index + 1}. ${textOrDash(item.emailSubject ?? (
        extra.advancedContentSource === 'group_snapshot' ? '' : extra.emailSubject
      ))}`)
      .join('\n')
    : ''
  const isFacebookGroupPostAction = actionId === 'facebook_group_post'
  const isCommentSeedingAction = COMMENT_SEEDING_ACTIONS.has(actionId)
  const actionUsesMainContent = !ACTIONS_WITHOUT_MAIN_CONTENT.has(actionId) && (
    !MESSAGE_ACTIONS_REQUIRING_ENABLE.has(actionId) || extra.enableMessage === true
  )
  const actionUsesMainMedia = actionUsesMainContent && actionId !== 'sms_send'
  const usesAdvancedMainMedia = extra.advancedContentEnabled === true &&
    actionUsesMainMedia
  const usesAdvancedCommentMedia = extra.advancedContentEnabled === true && isCommentSeedingAction
  const advancedMainMediaItemsSummary = usesAdvancedMainMedia
    ? normalizedAdvancedMediaItems.length > 0
      ? normalizedAdvancedMediaItems.map((item, index) => {
          const mediaItems = item.mediaOption === 'none' ? [] : getDeclaredMedia(item.mediaItems)
          return `${index + 1}. ${mediaItems.length > 0 ? formatImageSummary(mediaItems) : 'Không có media được gửi'}`
        }).join('\n')
      : 'Không có nội dung nâng cao'
    : ''
  const advancedMainMediaOptionSummary = usesAdvancedMainMedia
    ? normalizedAdvancedMediaItems.length > 0
      ? normalizedAdvancedMediaItems.map((item, index) => {
          const mediaItems = item.mediaOption === 'none' ? [] : getDeclaredMedia(item.mediaItems)
          if (mediaItems.length === 0) return `${index + 1}. Không dùng media`
          if (item.mediaOption === 'random') {
            const selectedCount = Math.min(item.randomMediaCount || 3, mediaItems.length)
            return `${index + 1}. Ngẫu nhiên ${selectedCount} trong ${mediaItems.length} media`
          }
          return `${index + 1}. Dùng tất cả ${mediaItems.length} media`
        }).join('\n')
      : 'Không có nội dung nâng cao'
    : ''
  const advancedCommentMediaSummary = usesAdvancedCommentMedia
    ? normalizedAdvancedMediaItems.length > 0
      ? normalizedAdvancedMediaItems.map((item, index) => {
          const mediaItems = getDeclaredMedia(item.mediaItems)
          if (item.mediaOption === 'random' && mediaItems.length > 0) {
            return `${index + 1}. Ngẫu nhiên 1 trong ${mediaItems.length} media`
          }
          if (item.mediaOption === 'all' && mediaItems.length > 0) {
            return mediaItems.length > 1
              ? `${index + 1}. Gửi media đầu tiên (1 trong ${mediaItems.length} media)`
              : `${index + 1}. Gửi media đã chọn`
          }
          return `${index + 1}. Không gửi media`
        }).join('\n')
      : 'Không có nội dung nâng cao'
    : ''
  const scheduleType = campaign.scheduleType || 'daily'
  const linkedSourceCampaigns = findLinkedSourceCampaigns(campaign, campaigns)
  const rawEnabledActionCodes = extra.actionLimits?.enabledActionCodes
  const enabledActionCodes = getStringList(rawEnabledActionCodes)
  const defaultActionCodes = getStringList(action?.limitCheckActionCodes)
  const limitCodes = Array.isArray(rawEnabledActionCodes) ? enabledActionCodes : defaultActionCodes
  const limitWindowMinutes = extra.actionLimits?.rateLimitMinutes ?? DEFAULT_RATE_LIMIT_MINUTES
  const continueWhenActionLimitReached = extra.actionLimits?.continueWhenActionLimitReached === true
  const byActionCode = Object.entries(extra.actionLimits?.byActionCode || {})
  const hasSourceSettings = POST_ACTIONS_WITH_SOURCE.has(actionId)
    || !!extra.copyContentFromSource
    || !!extra.sourceLinks
    || !!extra.includeSourceImages
    || !!extra.rewriteSourceContentWithAI
    || !!extra.sharePost
    || !!extra.postWithBackground
    || !!extra.postAsReels
    || !!extra.pagePostMode
  const hasCommentSettings = COMMENT_ACTIONS.has(actionId)
  const groupPostCommentEnabled = isFacebookGroupPostAction && extra.enableComment === true
  const commentSettingsEnabled = isCommentSeedingAction || groupPostCommentEnabled
  const hasMessageSettings = MESSAGE_ACTIONS.has(actionId)
    || actionId === ZALO_FRIEND_RECOMMENDATION_ACTION_ID
    || actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
    || actionId === 'zalo_add_group_member'
    || actionId === FACEBOOK_GROUP_INVITE_ACTION_ID
    || extra.enableMessage !== undefined
    || extra.enableAddFriend !== undefined
    || !!extra.useSuggestedFriends
    || !!extra.pageInboxPageUid
    || !!extra.zaloFriendBlocklistEnabled
    || extra.zaloFriendRecommendationCount !== undefined
    || !!extra.zaloFriendRecommendationDataMaterializedAt
    || extra.zaloCancelFriendRequestLimit !== undefined
    || !!extra.zaloCancelFriendRequestDataMaterializedAt
    || extra.internalSmsEnabled === true
    || extra.externalSmsEnabled === true
  const hasFindDataSettings = actionId === 'facebook_find_data_group' || actionId === 'facebook_find_data_search'
    || getFindDataTypeLabels(extra).length > 0
    || getFindDataSourceLabels(extra).length > 0
    || !!extra.findDataGoalModeEnabled
    || linkedSourceCampaigns.length > 0
  const hasEmailSettings = actionId === 'email_send'
    || !!extra.emailSubject
    || extra.emailBodyIsHtml === true
    || extra.emailCheckLinkClicks === true
  const supportsRerunAfterCompletion = ['facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding'].includes(actionId)
  const supportsMultiDailyTimeSlots = ['facebook_timeline_post', 'facebook_page_post', 'zalo_message_friend', 'zalo_message_group'].includes(actionId)
  const hasPostBump = actionId === 'facebook_group_post' || !!extra.enablePostBump
  const hasNewsfeedSettings = actionId === NEWSFEED_INTERACTION_ACTION_ID

  const sourceRows: InfoRow[] = [
    { label: 'Copy nội dung từ nguồn', value: onOff(extra.copyContentFromSource) },
    { label: 'Lấy kèm hình ảnh nguồn', value: onOff(extra.includeSourceImages) },
    { label: 'Danh sách nguồn', value: textOrDash(extra.sourceLinks), fullWidth: true },
    { label: 'Vị trí nguồn kế tiếp', value: extra.sourceLinkIndex ?? '-', hidden: extra.sourceLinkIndex === undefined },
    { label: 'Chia sẻ bài viết', value: onOff(extra.sharePost), hidden: actionId !== 'facebook_timeline_post' && !extra.sharePost },
    { label: 'Đăng bài với phông nền', value: onOff(extra.postWithBackground), hidden: !['facebook_timeline_post', 'facebook_page_post', 'facebook_group_post'].includes(actionId) && !extra.postWithBackground },
    { label: 'Đăng Reels', value: onOff(extra.postAsReels), hidden: actionId !== 'facebook_timeline_post' && !extra.postAsReels },
    { label: 'Mode đăng fanpage', value: extra.pagePostMode === 'ui' ? 'Giao diện Facebook' : 'Graph API', hidden: actionId !== 'facebook_page_post' && !extra.pagePostMode },
    { label: 'AI edit nội dung nguồn', value: onOff(extra.rewriteSourceContentWithAI) },
    { label: 'Prompt AI nguồn', value: textOrDash(extra.sourceContentAiPrompt), fullWidth: true, hidden: !extra.rewriteSourceContentWithAI && !extra.sourceContentAiPrompt }
  ]

  const commentRows: InfoRow[] = [
    { label: 'Kiêm comment', value: onOff(groupPostCommentEnabled), hidden: !isFacebookGroupPostAction },
    { label: 'Group được comment', value: formatCommentGroupMode(extra.commentGroupMode), hidden: !groupPostCommentEnabled },
    { label: 'Post được comment', value: formatCommentType(extra.commentType), hidden: !commentSettingsEnabled },
    { label: 'Số comment / bài tối đa', value: extra.commentCount ?? '-', hidden: !commentSettingsEnabled },
    { label: 'Số bài mỗi mục tiêu', value: extra.postsPerTarget ?? '-', hidden: !commentSettingsEnabled || (actionId !== 'facebook_comment_seeding' && extra.postsPerTarget === undefined) },
    { label: 'Like trước khi comment', value: onOff(extra.enablePostLike), hidden: !isCommentSeedingAction },
    { label: 'Lọc từ khóa bài viết', value: extra.isFindPostByKeywords ? textOrDash(extra.postKeywords) : 'Tắt', fullWidth: true, hidden: actionId !== 'facebook_comment_seeding' || (!extra.isFindPostByKeywords && !extra.postKeywords) },
    { label: 'Lọc AI bài viết', value: extra.isFindPostByContentAI ? textOrDash(extra.postContentAI) : 'Tắt', fullWidth: true, hidden: actionId !== 'facebook_comment_seeding' || (!extra.isFindPostByContentAI && !extra.postContentAI) },
    {
      label: 'Nội dung comment',
      value: usesAdvancedCommentMedia ? 'Theo nội dung nâng cao ở phần Nội dung & nguồn' : textOrDash(extra.commentContent),
      fullWidth: true,
      hidden: !commentSettingsEnabled
    },
    {
      label: usesAdvancedCommentMedia ? 'Media comment theo nội dung nâng cao' : 'Cách gửi media comment',
      value: usesAdvancedCommentMedia ? advancedCommentMediaSummary : formatCommentImageOption(extra),
      fullWidth: usesAdvancedCommentMedia,
      hidden: !commentSettingsEnabled
    },
    {
      label: 'Media comment',
      value: formatImageSummary(extra.commentImages),
      hidden: usesAdvancedCommentMedia || !commentSettingsEnabled
    },
    { label: 'AI viết lại comment', value: onOff(extra.rewriteCommentContentEachRun), hidden: !commentSettingsEnabled }
  ]

  const groupPostRows: InfoRow[] = [
    { label: 'Đăng bài dạng chia sẻ', value: onOff(extra.enableGroupPostShareToJoinedGroups) },
    { label: 'Rời group khi chờ duyệt', value: onOff(extra.leaveGroupOnPendingApproval) },
    { label: 'Tự tham gia group sau đăng', value: onOff(extra.autoJoinGroupAfterPost) },
    { label: 'Xáo trộn danh sách group', value: onOff(extra.shuffleGroupList) },
    { label: 'Bỏ đăng group đã biết cần duyệt', value: onOff(extra.skipPostIfGroupRequiresApproval) }
  ]

  const emailRows: InfoRow[] = [
    { label: 'Tiêu đề email', value: textOrDash(extra.emailSubject), fullWidth: true },
    { label: 'Nội dung HTML', value: onOff(extra.emailBodyIsHtml) },
    { label: 'Kiểm tra click vào link', value: onOff(extra.emailCheckLinkClicks) }
  ]

  const postBumpRows: InfoRow[] = [
    { label: 'Kiêm up tin', value: onOff(extra.enablePostBump) },
    { label: 'Số tin up tối đa / post', value: extra.postBumpCount ?? '-', hidden: !extra.enablePostBump },
    { label: 'Up tin sau khi đăng', value: `${extra.postBumpInitialDelayMinutes ?? '-'} phút`, hidden: !extra.enablePostBump },
    { label: 'Khoảng cách mỗi lần up', value: `${extra.postBumpIntervalMinutes ?? '-'} phút`, hidden: !extra.enablePostBump },
    { label: 'Cách tạo chiến dịch up tin', value: formatPostBumpMode(extra.postBumpMode), hidden: !extra.enablePostBump },
    { label: 'Chiến dịch nhận link', value: formatCampaignRefs(extra.postBumpTargetCampaignIds, campaigns), hidden: !extra.enablePostBump || extra.postBumpMode !== 'select' },
    { label: 'Tài khoản tạo campaign up tin', value: formatAccountRefs(extra.postBumpAccountIds, accounts), hidden: !extra.enablePostBump || extra.postBumpMode === 'select' },
    { label: 'Nội dung up tin', value: textOrDash(extra.postBumpContent), fullWidth: true, hidden: !extra.enablePostBump || !extra.postBumpContent },
    { label: 'Vòng chia target hiện tại', value: extra.postBumpRotationIndex ?? '-', hidden: !extra.enablePostBump || extra.postBumpRotationIndex === undefined }
  ]

  const messageRows: InfoRow[] = [
    { label: 'Gửi tin nhắn', value: onOff(actionId === 'facebook_message_friend' || actionId === 'facebook_page_to_message' || extra.enableMessage), hidden: actionId === 'zalo_add_group_member' },
    { label: 'Kết bạn', value: onOff(extra.enableAddFriend), hidden: actionId !== 'facebook_message_uid' && !extra.enableAddFriend },
    { label: 'Dùng bạn bè đề xuất', value: onOff(extra.useSuggestedFriends), hidden: actionId !== 'facebook_message_uid' && !extra.useSuggestedFriends },
    { label: 'Số bạn bè đề xuất', value: extra.suggestedFriendsCount ?? '-', hidden: !extra.useSuggestedFriends },
    { label: 'Số lượng đề xuất Zalo', value: extra.zaloFriendRecommendationCount ?? 10, hidden: actionId !== ZALO_FRIEND_RECOMMENDATION_ACTION_ID && extra.zaloFriendRecommendationCount === undefined },
    {
      label: 'Data đề xuất đã lấy',
      value: extra.zaloFriendRecommendationDataMaterializedAt
        ? `${extra.zaloFriendRecommendationMaterializedCount ?? 0} đề xuất, ${formatDateTime(extra.zaloFriendRecommendationDataMaterializedAt)}`
        : 'Chưa lấy',
      hidden: actionId !== ZALO_FRIEND_RECOMMENDATION_ACTION_ID && !extra.zaloFriendRecommendationDataMaterializedAt
    },
    { label: 'Số lời mời cần huỷ', value: extra.zaloCancelFriendRequestLimit ?? 10, hidden: actionId !== ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID && extra.zaloCancelFriendRequestLimit === undefined },
    { label: 'Group cần thêm thành viên', value: textOrDash(extra.zaloAddGroupMemberTargetGroupName || extra.zaloAddGroupMemberTargetGroupId), hidden: actionId !== 'zalo_add_group_member' && !extra.zaloAddGroupMemberTargetGroupId },
    { label: 'Thêm bằng chia sẻ group', value: onOff(extra.zaloAddGroupMemberUseShareMethod), hidden: actionId !== 'zalo_add_group_member' && extra.zaloAddGroupMemberUseShareMethod !== true },
    { label: 'Group nhận lời mời', value: textOrDash(extra.facebookGroupInviteTargetGroupName || extra.facebookGroupInviteTargetGroupUrl || extra.facebookGroupInviteTargetGroupUid), hidden: actionId !== FACEBOOK_GROUP_INVITE_ACTION_ID && !extra.facebookGroupInviteTargetGroupUrl },
    { label: 'Link group nhận lời mời', value: textOrDash(extra.facebookGroupInviteTargetGroupUrl), fullWidth: true, hidden: actionId !== FACEBOOK_GROUP_INVITE_ACTION_ID && !extra.facebookGroupInviteTargetGroupUrl },
    {
      label: 'Data lời mời đã lấy',
      value: extra.zaloCancelFriendRequestDataMaterializedAt
        ? `${extra.zaloCancelFriendRequestMaterializedCount ?? 0} lời mời, ${formatDateTime(extra.zaloCancelFriendRequestDataMaterializedAt)}`
        : 'Chưa lấy',
      hidden: actionId !== ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID && !extra.zaloCancelFriendRequestDataMaterializedAt
    },
    { label: 'Không gửi tin theo danh sách', value: onOff(extra.zaloFriendBlocklistEnabled), hidden: actionId !== 'zalo_message_friend' && !extra.zaloFriendBlocklistEnabled },
    { label: 'Danh sách không gửi tin', value: textOrDash(extra.zaloFriendBlocklistName || extra.zaloFriendBlocklistId), hidden: actionId !== 'zalo_message_friend' || !extra.zaloFriendBlocklistEnabled },
    { label: 'Gửi tin nhắn Sms', value: onOff(extra.internalSmsEnabled), hidden: !extra.internalSmsEnabled },
    { label: 'Tài khoản Sms', value: formatAccountRefs(extra.internalSmsAccountIds, accounts), hidden: !extra.internalSmsEnabled },
    { label: 'Trạng thái gửi Sms', value: formatExternalSmsStatuses(extra.internalSmsStatuses), hidden: !extra.internalSmsEnabled },
    { label: 'Nội dung Sms', value: textOrDash(extra.internalSmsContent), fullWidth: true, hidden: !extra.internalSmsEnabled },
    { label: 'Gửi tin nhắn Sms', value: onOff(extra.externalSmsEnabled), hidden: !extra.externalSmsEnabled },
    { label: 'Tài khoản Sms', value: textOrDash(getNumberList(extra.externalSmsShopIds).join(', ')), hidden: !extra.externalSmsEnabled },
    { label: 'Trạng thái gửi Sms', value: formatExternalSmsStatuses(extra.externalSmsStatuses), hidden: !extra.externalSmsEnabled },
    { label: 'Nội dung Sms', value: textOrDash(extra.externalSmsContent), fullWidth: true, hidden: !extra.externalSmsEnabled },
    { label: 'Page inbox', value: textOrDash(extra.pageInboxPageName || extra.pageInboxPageUid), hidden: actionId !== 'facebook_page_to_message' && !extra.pageInboxPageUid },
    { label: 'Page UID', value: textOrDash(extra.pageInboxPageUid), hidden: actionId !== 'facebook_page_to_message' && !extra.pageInboxPageUid }
  ]

  const newsfeedRows: InfoRow[] = [
    { label: 'Thời gian lướt', value: `${extra.newsfeedTimeMinutes ?? 20} phút` },
    { label: 'Thực hiện like', value: onOff(extra.enablePostLike) },
    { label: 'Like nội dung có tính chất', value: textOrDash(extra.newsfeedLikeKind), hidden: !extra.enablePostLike },
    { label: 'Like tối đa', value: extra.newsfeedLikeLimit ?? 0, hidden: !extra.enablePostLike },
    { label: 'Thực hiện comment', value: onOff(extra.enableComment) },
    { label: 'Comment bài post có tính chất', value: textOrDash(extra.newsfeedCommentKind), hidden: !extra.enableComment },
    { label: 'Comment tối đa', value: extra.newsfeedCommentLimit ?? 0, hidden: !extra.enableComment },
    { label: 'AI tạo comment', value: onOff(extra.newsfeedCommentUseAI), hidden: !extra.enableComment },
    { label: 'Nội dung comment', value: textOrDash(extra.newsfeedCommentContent), fullWidth: true, hidden: !extra.enableComment }
  ]

  const findDataRows: InfoRow[] = [
    { label: 'Nguồn tìm', value: formatActionCodeChips(getFindDataSourceLabels(extra)) },
    { label: 'Loại data cần tìm', value: formatActionCodeChips(getFindDataTypeLabels(extra)) },
    { label: 'Chế độ theo đuổi mục tiêu', value: onOff(extra.findDataGoalModeEnabled), hidden: !extra.findDataGoalModeEnabled },
    { label: 'Ưu tiên mục tiêu', value: extra.findDataGoalPriority ? FIND_DATA_GOAL_PRIORITY_LABELS[extra.findDataGoalPriority] : '-', hidden: !extra.findDataGoalModeEnabled },
    { label: 'Số lượng mục tiêu/ngày', value: extra.findDataGoalDailyLimit ?? 30, hidden: !extra.findDataGoalModeEnabled },
    { label: 'Sort bài post', value: POST_SORT_LABELS[extra.sortTypePost || 'most_relevant'], hidden: !extra.isFindInPost && !extra.isFindNewInteractors },
    { label: 'Số post tối đa / group', value: extra.countPostFindData ?? '-', hidden: !extra.isFindInPost && !extra.isFindNewInteractors },
    { label: 'Sort comment', value: COMMENT_SORT_LABELS[extra.sortTypeComment || 'most_relevant'], hidden: !extra.isFindInComment && !extra.isFindNewInteractors },
    { label: 'Số comment tối đa / post', value: extra.countCommentFindData ?? '-', hidden: !extra.isFindInComment && !extra.isFindNewInteractors },
    { label: 'Số thành viên group tối đa', value: extra.countGroupMemberFindData ?? '-', hidden: !extra.isFindInGroupMembers },
    { label: 'Số post search tối đa / từ khóa', value: extra.countSearchPostFindData ?? '-', hidden: actionId !== 'facebook_find_data_search' || !extra.isFindInPost },
    { label: 'Bài viết mới đây', value: onOff(extra.searchPostRecentOnly), hidden: actionId !== 'facebook_find_data_search' || !extra.isFindInPost },
    { label: 'Bài viết đã xem', value: onOff(extra.searchPostSeenOnly), hidden: actionId !== 'facebook_find_data_search' || !extra.isFindInPost },
    { label: 'Ngày đăng search', value: SEARCH_POST_DATE_FILTER_LABELS[extra.searchPostDateFilter || 'all'], hidden: actionId !== 'facebook_find_data_search' || !extra.isFindInPost },
    { label: 'Bài viết của', value: SEARCH_POST_AUTHOR_FILTER_LABELS[extra.searchPostAuthorFilter || 'all'], hidden: actionId !== 'facebook_find_data_search' || !extra.isFindInPost },
    { label: 'Vị trí được gắn thẻ', value: SEARCH_POST_TAGGED_LOCATION_LABELS[extra.searchPostTaggedLocation || 'all'], hidden: actionId !== 'facebook_find_data_search' || !extra.isFindInPost },
    { label: 'Số group search tối đa / từ khóa', value: extra.countSearchGroupFindData ?? '-', hidden: actionId !== 'facebook_find_data_search' || !extra.isFindFacebookGroup },
    { label: 'Tỉnh/Thành phố group', value: textOrDash(extra.searchGroupCity), hidden: actionId !== 'facebook_find_data_search' || !extra.isFindFacebookGroup || !extra.searchGroupCity },
    { label: 'Group gần tôi', value: onOff(extra.searchGroupNearMe), hidden: actionId !== 'facebook_find_data_search' || !extra.isFindFacebookGroup },
    { label: 'Chỉ group công khai', value: onOff(extra.searchGroupPublicOnly), hidden: actionId !== 'facebook_find_data_search' || !extra.isFindFacebookGroup },
    { label: 'Chỉ group của tôi', value: onOff(extra.searchGroupMineOnly), hidden: actionId !== 'facebook_find_data_search' || !extra.isFindFacebookGroup },
    { label: 'Thành viên tối thiểu', value: extra.minSearchGroupMembers ?? 0, hidden: actionId !== 'facebook_find_data_search' || !extra.isFindFacebookGroup },
    { label: 'Bài đăng tối thiểu/ngày', value: extra.minSearchGroupPostsPerDay ?? 0, hidden: actionId !== 'facebook_find_data_search' || !extra.isFindFacebookGroup },
    { label: 'Lọc từ khóa bài viết', value: extra.isFindPostByKeywords ? textOrDash(extra.postKeywords) : 'Tắt', fullWidth: true, hidden: !extra.isFindPostByKeywords && !extra.postKeywords },
    { label: 'Lọc AI bài viết', value: extra.isFindPostByContentAI ? textOrDash(extra.postContentAI) : 'Tắt', fullWidth: true, hidden: !extra.isFindPostByContentAI && !extra.postContentAI },
    { label: 'Lọc từ khóa comment', value: extra.isFindCommentByKeywords ? textOrDash(extra.commentKeywords) : 'Tắt', fullWidth: true, hidden: !extra.isFindCommentByKeywords && !extra.commentKeywords },
    { label: 'Lọc AI comment', value: extra.isFindCommentByContentAI ? textOrDash(extra.commentContentAI) : 'Tắt', fullWidth: true, hidden: !extra.isFindCommentByContentAI && !extra.commentContentAI },
    { label: 'Đẩy UID sang campaign', value: formatCampaignRefs(extra.findUidTargetCampaignIds, campaigns), hidden: !extra.findUidTargetCampaignIds?.length },
    { label: 'Đẩy link post sang campaign', value: formatCampaignRefs(extra.findPostLinkTargetCampaignIds, campaigns), hidden: !extra.findPostLinkTargetCampaignIds?.length },
    { label: 'Đẩy SĐT sang SMS', value: textOrDash(getNumberList(extra.findPhoneSmsTargetCampaignIds).join(', ')), hidden: !extra.findPhoneSmsTargetCampaignIds?.length },
    { label: 'Đẩy SĐT sang Zalo Web', value: textOrDash(getNumberList(extra.findPhoneZaloWebTargetCampaignIds).join(', ')), hidden: !extra.findPhoneZaloWebTargetCampaignIds?.length },
    { label: 'Đẩy SĐT sang Zalo phone', value: formatCampaignRefs(extra.findPhoneZaloMessagePhoneTargetCampaignIds, campaigns), hidden: !extra.findPhoneZaloMessagePhoneTargetCampaignIds?.length },
    { label: 'Đẩy link Zalo sang Zalo Web', value: textOrDash(getNumberList(extra.findZaloGroupLinkWebTargetCampaignIds).join(', ')), hidden: !extra.findZaloGroupLinkWebTargetCampaignIds?.length },
    { label: 'Đẩy link Zalo sang campaign tham gia group', value: formatCampaignRefs(extra.findZaloGroupLinkJoinTargetCampaignIds, campaigns), hidden: !extra.findZaloGroupLinkJoinTargetCampaignIds?.length },
    { label: 'Đẩy SĐT sang akaBiz Desktop', value: textOrDash(getNumberList(extra.findPhoneAkaBizDesktopTargetCampaignIds).join(', ')), hidden: !extra.findPhoneAkaBizDesktopTargetCampaignIds?.length },
    { label: 'Đẩy link Zalo sang akaBiz Desktop', value: textOrDash(getNumberList(extra.findZaloGroupLinkAkaBizDesktopTargetCampaignIds).join(', ')), hidden: !extra.findZaloGroupLinkAkaBizDesktopTargetCampaignIds?.length },
    { label: 'Đẩy group sang campaign đăng bài', value: formatCampaignRefs(extra.findFacebookGroupPostTargetCampaignIds, campaigns), hidden: !extra.findFacebookGroupPostTargetCampaignIds?.length },
    { label: 'Đẩy group sang campaign comment seeding', value: formatCampaignRefs(extra.findFacebookGroupCommentTargetCampaignIds, campaigns), hidden: !extra.findFacebookGroupCommentTargetCampaignIds?.length },
    { label: 'Đẩy group sang campaign tham gia group', value: formatCampaignRefs(extra.findFacebookGroupJoinTargetCampaignIds, campaigns), hidden: !extra.findFacebookGroupJoinTargetCampaignIds?.length },
    { label: 'Đẩy SĐT sang Nhóm data', value: textOrDash(extra.findDataTargetDataGroups?.phone?.groupName), hidden: !extra.findDataTargetDataGroups?.phone },
    { label: 'Đẩy link group Zalo sang Nhóm data', value: textOrDash(extra.findDataTargetDataGroups?.zalo_group_link?.groupName), hidden: !extra.findDataTargetDataGroups?.zalo_group_link },
    { label: 'Đẩy UID Facebook sang Nhóm data', value: textOrDash(extra.findDataTargetDataGroups?.facebook_uid?.groupName), hidden: !extra.findDataTargetDataGroups?.facebook_uid },
    { label: 'Đẩy link bài post sang Nhóm data', value: textOrDash(extra.findDataTargetDataGroups?.post_link?.groupName), hidden: !extra.findDataTargetDataGroups?.post_link },
    { label: 'Đẩy group Facebook sang Nhóm data', value: textOrDash(extra.findDataTargetDataGroups?.facebook_group?.groupName), hidden: !extra.findDataTargetDataGroups?.facebook_group },
    { label: 'Nguồn tìm data liên kết', value: formatLinkedCampaigns(linkedSourceCampaigns), hidden: linkedSourceCampaigns.length === 0 }
  ]

  const limitRows: InfoRow[] = [
    { label: 'Hành động kiểm tra quota ngày/giờ', value: formatActionCodeChips(limitCodes) },
    { label: 'Khi một action đạt giới hạn', value: continueWhenActionLimitReached ? 'Tiếp tục chạy action còn quota' : 'Dừng khi một action đạt giới hạn' },
    { label: 'Nghỉ giữa actions', value: `${extra.actionLimits?.sleepBetweenActions ?? 0} giây`, hidden: actionId === FACEBOOK_GROUP_INVITE_ACTION_ID },
    ...byActionCode.map(([code, limit]) => ({
      label: `Giới hạn ${getActionCodeLabel(code)}`,
      value: formatLimitValue(limit, limitWindowMinutes)
    }))
  ]

  return (
    <div className="campaign-info-view">
      <div className="campaign-info-section-grid">
        {renderSection('Tổng quan', [
          { label: 'Tên chiến dịch', value: textOrDash(campaign.name), fullWidth: true },
          { label: 'Loại chiến dịch', value: textOrDash(action?.name || campaign.actionName || campaign.actionId) },
          { label: 'Tài khoản chính', value: textOrDash(account?.name || campaign.accountName) },
          { label: 'Tài khoản phụ', value: textOrDash(secondaryAccountName) },
          { label: 'Trạng thái', value: campaign.status },
          {
            label: 'Nguồn data mục tiêu',
            value: campaign.dataTargetSourceMode === 'data_group'
              ? `${dataGroupDisplay?.name || 'Nhóm data'} · đồng bộ tăng dần`
              : 'Nhập trực tiếp'
          },
          {
            label: 'Nhận data mới',
            value: dataGroupDisplay?.sourceStatus || 'Đang tải...',
            hidden: campaign.dataTargetSourceMode !== 'data_group'
          },
          {
            label: 'Trạng thái nguồn',
            value: campaign.provisioningState === 'staged'
              ? 'Đang nạp dữ liệu ban đầu'
              : campaign.provisioningState === 'failed'
                ? 'Khởi tạo lỗi'
                : 'Sẵn sàng',
            hidden: campaign.dataTargetSourceMode !== 'data_group'
          },
          {
            label: 'Membership thô hiện hành',
            value: dataGroupStats?.activeMembershipCount ?? '-',
            hidden: campaign.dataTargetSourceMode !== 'data_group'
          },
          {
            label: 'Target phù hợp duy nhất',
            value: dataGroupStats?.uniqueCompatibleTargetCount ?? '-',
            hidden: campaign.dataTargetSourceMode !== 'data_group'
          },
          {
            label: 'Campaign input đã tạo (toàn kỳ)',
            value: dataGroupStats?.campaignInputCount ?? '-',
            hidden: campaign.dataTargetSourceMode !== 'data_group'
          },
          {
            label: 'Input mới (lần ingest gần nhất)',
            value: dataGroupStats?.insertedInputCount ?? '-',
            hidden: campaign.dataTargetSourceMode !== 'data_group'
          },
          {
            label: 'Đã thấy / không tương thích',
            value: dataGroupStats ? `${dataGroupStats.alreadySeenInputCount} / ${dataGroupStats.incompatibleCount}` : '-',
            hidden: campaign.dataTargetSourceMode !== 'data_group'
          },
          { label: 'Ghi chú', value: textOrDash(campaign.note), fullWidth: true },
          { label: 'Ngày tạo', value: formatDateTime(campaign.createdAt) },
          { label: 'Cập nhật', value: formatDateTime(campaign.updatedAt) },
          { label: 'Lần chạy gần nhất', value: formatDateTime(campaign.lastRunAt) }
        ])}

        {renderSection('Lịch chạy', [
          { label: 'Bắt đầu', value: formatDateTime(campaign.originalSchedule || campaign.schedule) },
          { label: 'Lần chạy kế tiếp', value: formatDateTime(campaign.schedule) },
          { label: 'Loại lịch', value: formatScheduleType(scheduleType) },
          { label: 'Ngày chạy trong tuần', value: formatWeekDays(campaign.scheduleWeekDays), hidden: scheduleType !== 'weekly' },
          { label: 'Ngày chạy trong tháng', value: formatMonthDays(campaign.scheduleDays), hidden: scheduleType !== 'monthly' },
          { label: 'Ngày kết thúc', value: campaign.scheduleEndDate ? formatDateTime(campaign.scheduleEndDate) : 'Không giới hạn' },
          { label: 'Giờ dừng trong ngày', value: formatTime(campaign.dailyStopTime) },
          { label: 'Chạy nhiều khung giờ', value: onOff(extra.multiDailyTimeSlotsEnabled), hidden: !supportsMultiDailyTimeSlots && !extra.multiDailyTimeSlotsEnabled },
          {
            label: 'Các khung giờ trong ngày',
            value: textOrDash(String(extra.multiDailyTimeSlots || '').split(',').map(item => item.trim()).filter(Boolean).join(', ')),
            hidden: !extra.multiDailyTimeSlotsEnabled && !extra.multiDailyTimeSlots
          },
          { label: 'Chạy lại sau mỗi', value: extra.findDataRerunEnabled ? `${extra.findDataRerunAfterHours || 1} giờ` : 'Tắt', hidden: !supportsRerunAfterCompletion && !extra.findDataRerunEnabled },
          { label: 'Lặp cùng giờ ngày mới', value: onOff(campaign.continueNextDay), hidden: scheduleType !== 'daily' },
          { label: 'Reset data chu kỳ mới', value: onOff(campaign.refreshData), hidden: scheduleType === 'daily' }
        ])}
      </div>

      <div className="campaign-info-section-grid">
        {renderSection('Nội dung & nguồn', [
          {
            label: 'Định dạng nội dung',
            value: <span className="campaign-info-chip">Có định dạng</span>,
            hidden: !isRichCampaignContent
          },
          {
            label: 'Nguồn nội dung nâng cao',
            value: advancedContentSourceLabel,
            hidden: !extra.advancedContentEnabled
          },
          {
            label: 'Nhóm snapshot',
            value: extra.advancedContentGroupSnapshot
              ? `${extra.advancedContentGroupSnapshot.groupName} (#${extra.advancedContentGroupSnapshot.groupId}) · ${extra.advancedContentGroupSnapshot.templateCount} mẫu · ${extra.advancedContentGroupSnapshot.itemCount} nội dung · ${formatDateTime(extra.advancedContentGroupSnapshot.capturedAt)}`
              : '-',
            fullWidth: true,
            hidden: extra.advancedContentSource !== 'group_snapshot'
          },
          {
            label: 'Nguồn từng nội dung',
            value: textOrDash(advancedItemSourceSummary),
            fullWidth: true,
            hidden: !advancedItemSourceSummary
          },
          {
            label: 'Tiêu đề theo nội dung',
            value: textOrDash(advancedEmailSubjectSummary),
            fullWidth: true,
            hidden: !extra.advancedContentEnabled || actionId !== 'email_send'
          },
          { label: 'Nội dung chính', value: textOrDash(displayCampaignContent), fullWidth: true },
          {
            label: usesAdvancedMainMedia ? 'Media theo nội dung nâng cao' : 'Media bài đăng',
            value: usesAdvancedMainMedia ? advancedMainMediaItemsSummary : formatImageSummary(campaign.images),
            fullWidth: usesAdvancedMainMedia,
            hidden: !actionUsesMainMedia
          },
          {
            label: usesAdvancedMainMedia ? 'Cách dùng media theo nội dung' : 'Cách dùng media',
            value: usesAdvancedMainMedia ? advancedMainMediaOptionSummary : formatImageOption(extra, campaign.images),
            fullWidth: usesAdvancedMainMedia,
            hidden: !actionUsesMainMedia
          },
          { label: 'AI viết lại nội dung', value: onOff(extra.rewriteContentEachRun), hidden: isFormattedContent || (actionId === 'email_send' && extra.emailBodyIsHtml === true) },
          ...emailRows.map(row => ({ ...row, hidden: row.hidden || !hasEmailSettings })),
          ...sourceRows.map(row => ({ ...row, hidden: row.hidden || !hasSourceSettings }))
        ])}

        {renderSection('Cài đặt hành động', [
          ...newsfeedRows.map(row => ({ ...row, hidden: row.hidden || !hasNewsfeedSettings })),
          ...commentRows.map(row => ({ ...row, hidden: row.hidden || !hasCommentSettings })),
          ...groupPostRows.map(row => ({ ...row, hidden: row.hidden || actionId !== 'facebook_group_post' })),
          ...postBumpRows.map(row => ({ ...row, hidden: row.hidden || !hasPostBump })),
          ...messageRows.map(row => ({ ...row, hidden: row.hidden || !hasMessageSettings }))
        ])}
      </div>

      <div className="campaign-info-section-grid">
        {renderSection('Tìm data', findDataRows.map(row => ({ ...row, hidden: row.hidden || !hasFindDataSettings })))}
        {renderSection('Giới hạn', limitRows)}
      </div>
    </div>
  )
}
