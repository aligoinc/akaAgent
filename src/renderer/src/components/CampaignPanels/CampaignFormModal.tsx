import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, ChevronUp, ChevronDown, Check, Upload, Calendar, Image, Users } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { ActionLimitConfig, AutoAccountContact, Campaign, CampaignInputData, CampaignExtraSettings } from '../../../../shared/types'
import { read, utils } from 'xlsx'
import DataScanModal, { DataScanAction } from '../DataScan/DataScanModal'
import { useUiStore } from '../../stores/uiStore'

interface CampaignFormModalProps {
  campaign: Campaign | null
  cloneFromId?: number
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
type MessageDateOption = 'today' | 'tomorrow' | 'yesterday'
type MessageDateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY'

const DEFAULT_ACTION_LIMIT: ActionLimitForm = {
  dailyLimit: 30,
  rateLimitCount: 9,
  rateLimitMinutes: 60
}

const ACTION_CODE_LABELS: Record<string, string> = {
  fb_post_group: 'Đăng bài group',
  fb_post_my_profile: 'Đăng bài trang cá nhân',
  fb_comment: 'Comment',
  fb_message_stranger: 'Nhắn tin người lạ',
  fb_message_friend: 'Nhắn tin bạn bè',
  fb_add_friend: 'Kết bạn',
  fb_like_post: 'Like post'
}

const getActionCodeLabel = (code: string) => ACTION_CODE_LABELS[code] || code

const toActionLimitForm = (
  config?: ActionLimitConfig,
  fallback: ActionLimitForm = DEFAULT_ACTION_LIMIT
): ActionLimitForm => ({
  dailyLimit: config?.dailyLimit ?? fallback.dailyLimit,
  rateLimitCount: config?.rateLimitCount ?? fallback.rateLimitCount,
  rateLimitMinutes: config?.rateLimitMinutes ?? fallback.rateLimitMinutes
})

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
  'facebook_timeline_post'
])

const MESSAGE_FRIEND_ACTION_ID = 'facebook_message_friend'
const MESSAGE_UID_ACTION_ID = 'facebook_message_uid'
const MESSAGE_CAMPAIGN_ACTIONS = new Set([
  MESSAGE_FRIEND_ACTION_ID,
  MESSAGE_UID_ACTION_ID
])

// Campaign action IDs for "Đăng bài vào group" type — show "Chọn nhóm" picker in data list
const GROUP_POST_ACTIONS = new Set([
  'facebook_group_post',
  'facebook_find_data_group'
])

// Campaign action IDs that show the "Nguồn đăng bài" section (source links, copy content, share, reels)
const TIMELINE_POST_ACTIONS = new Set([
  'facebook_timeline_post'
])

const FIND_DATA_GROUP_ACTIONS = new Set([
  'facebook_find_data_group'
])

const COMMENT_SEEDING_FEED_ACTIONS = new Set([
  'facebook_comment_seeding'
])

const COMMENT_SEEDING_POST_ACTIONS = new Set([
  'facebook_comment_seeding_post'
])

const COMMENT_SEEDING_ACTIONS = new Set([
  'facebook_comment_seeding',
  'facebook_comment_seeding_post'
])

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

const DEFAULT_DAILY_STOP_TIME = '18:00'

const MESSAGE_FULL_NAME_TOKEN = '#{FULL_NAME}'
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

const normalizeTimeInput = (value?: string | null): string => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return ''
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

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
      { key: 'timeSleepBetween2', label: 'Nghỉ giữa 2 lần' },
      { key: 'dailyLimit', label: 'Giới hạn ngày' },
      { key: 'rateLimitCount', label: 'Số lần chờ' },
      { key: 'rateLimitMinutes', label: 'Khung thời gian' }
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
      { key: 'enableComment', label: 'Kiêm comment' }
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

export default function CampaignFormModal({ campaign, cloneFromId, onClose }: CampaignFormModalProps) {
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

  const initSchedule = () => {
    if (cloneFromId) return formatDateTimeLocal(new Date())
    if (campaign?.schedule) {
      return formatDateTimeLocal(new Date(campaign.schedule))
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

  const [formData, setFormData] = useState({
    name: campaign?.name || '',
    actionId: campaign?.actionId || '',
    accountIds: campaign?.accountId ? [campaign.accountId] : [] as number[],
    schedule: initSchedule(),
    scheduleType: (campaign?.scheduleType || 'daily') as 'daily' | 'weekly' | 'monthly',
    scheduleEndDate: initEndDate(),
    useDailyStopTime: campaign ? !!savedDailyStopTime : true,
    dailyStopTime: savedDailyStopTime || DEFAULT_DAILY_STOP_TIME,
    scheduleDays: campaign?.scheduleDays || '',
    scheduleWeekDays: campaign?.scheduleWeekDays || '',
    continueNextDay: campaign?.continueNextDay ?? true,
    refreshData: campaign?.refreshData ?? true,
    timeSleepBetween2: campaign?.timeSleepBetween2 ?? 30,
    content: campaign?.content || '',
    // Extra settings
    sharePost: campaign?.extraSettings?.sharePost ?? false,
    enableComment: campaign?.extraSettings?.enableComment ?? false,
    commentType: (campaign?.extraSettings?.commentType || 'own') as 'own' | 'others',
    commentCount: campaign?.extraSettings?.commentCount ?? 3,
    commentContent: campaign?.extraSettings?.commentContent || '',
    enablePostLike: campaign?.extraSettings?.enablePostLike ?? false,
    postsPerTarget: campaign?.extraSettings?.postsPerTarget ?? campaign?.extraSettings?.commentCount ?? 3,
    postKeywordFilter: campaign?.extraSettings?.postKeywordFilter ?? campaign?.extraSettings?.keywordFilter ?? '',
    dailyLimit: campaign?.extraSettings?.actionLimits?.dailyLimit ?? 30,
    rateLimitCount: campaign?.extraSettings?.actionLimits?.rateLimitCount ?? 9,
    rateLimitMinutes: campaign?.extraSettings?.actionLimits?.rateLimitMinutes ?? 60,
    actionLimitsByCode: Object.fromEntries(
      Object.entries(campaign?.extraSettings?.actionLimits?.byActionCode || {}).map(([code, limit]) => [
        code,
        toActionLimitForm(limit, {
          dailyLimit: campaign?.extraSettings?.actionLimits?.dailyLimit ?? 30,
          rateLimitCount: campaign?.extraSettings?.actionLimits?.rateLimitCount ?? 9,
          rateLimitMinutes: campaign?.extraSettings?.actionLimits?.rateLimitMinutes ?? 60
        })
      ])
    ) as Record<string, ActionLimitForm>,
    limitCheckActionCodes: [...(campaign?.extraSettings?.actionLimits?.enabledActionCodes || [])] as string[],
    hasCustomLimitCheckActionCodes: Array.isArray(campaign?.extraSettings?.actionLimits?.enabledActionCodes),
    imageOption: (campaign?.extraSettings?.imageOption || 'none') as 'none' | 'all' | 'random',
    randomImageCount: campaign?.extraSettings?.randomImageCount || 3,
    images: campaign?.images || [] as string[],
    commentImageOption: savedCommentImageOption,
    commentImages: savedCommentImages,
    splitDataAcrossAccounts: false,
    leaveGroupOnPendingApproval: campaign?.extraSettings?.leaveGroupOnPendingApproval ?? false,
    autoJoinGroupAfterPost: campaign?.extraSettings?.autoJoinGroupAfterPost ?? false,
    shuffleGroupList: campaign?.extraSettings?.shuffleGroupList ?? false,
    // Nhắn tin bạn bè / UID
    enableMessage: campaign?.extraSettings?.enableMessage ?? true,
    enableAddFriend: campaign?.extraSettings?.enableAddFriend ?? false,
    // Nguồn đăng bài (timeline post)
    copyContentFromSource: campaign?.extraSettings?.copyContentFromSource ?? false,
    includeSourceImages: campaign?.extraSettings?.includeSourceImages ?? false,
    postAsReels: campaign?.extraSettings?.postAsReels ?? false,
    sourceLinks: campaign?.extraSettings?.sourceLinks || '',
    // Tìm kiếm data trong group
    isFindPhone: campaign?.extraSettings?.isFindPhone ?? false,
    isFindLinkGroupZalo: campaign?.extraSettings?.isFindLinkGroupZalo ?? false,
    isFindUid: campaign?.extraSettings?.isFindUid ?? false,
    isFindPostLink: campaign?.extraSettings?.isFindPostLink ?? false,
    isFindInPost: campaign?.extraSettings?.isFindInPost ?? false,
    sortTypePost: (campaign?.extraSettings?.sortTypePost || 'most_relevant') as CampaignExtraSettings['sortTypePost'],
    countPostFindData: campaign?.extraSettings?.countPostFindData ?? 10,
    isFindInComment: campaign?.extraSettings?.isFindInComment ?? false,
    sortTypeComment: (campaign?.extraSettings?.sortTypeComment || 'most_relevant') as CampaignExtraSettings['sortTypeComment'],
    countCommentFindData: campaign?.extraSettings?.countCommentFindData ?? 30,
    isFindByKeywords: campaign?.extraSettings?.isFindByKeywords ?? false,
    keywords: campaign?.extraSettings?.keywords || '',
    isFindByContentAI: campaign?.extraSettings?.isFindByContentAI ?? false,
    contentAI: campaign?.extraSettings?.contentAI || '',
    findUidTargetCampaignIds: campaign?.extraSettings?.findUidTargetCampaignIds || [] as number[],
    findPostLinkTargetCampaignIds: campaign?.extraSettings?.findPostLinkTargetCampaignIds || [] as number[]
  })
  const imageInputRef = useRef<HTMLInputElement>(null)
  const commentImageInputRef = useRef<HTMLInputElement>(null)

  // Determine if this is a "simple" campaign (no details/extra sections)
  const isSimpleCampaign = SIMPLE_CAMPAIGN_ACTIONS.has(formData.actionId)
  const isMessageCampaign = MESSAGE_CAMPAIGN_ACTIONS.has(formData.actionId)
  const isMessageFriendCampaign = formData.actionId === MESSAGE_FRIEND_ACTION_ID
  const isMessageUidCampaign = formData.actionId === MESSAGE_UID_ACTION_ID
  const isGroupPostCampaign = GROUP_POST_ACTIONS.has(formData.actionId)
  const isTimelinePostCampaign = TIMELINE_POST_ACTIONS.has(formData.actionId)
  const isFindDataGroupCampaign = FIND_DATA_GROUP_ACTIONS.has(formData.actionId)
  const isCommentSeedingCampaign = COMMENT_SEEDING_ACTIONS.has(formData.actionId)
  const isCommentSeedingFeedCampaign = COMMENT_SEEDING_FEED_ACTIONS.has(formData.actionId)
  const isCommentSeedingPostCampaign = COMMENT_SEEDING_POST_ACTIONS.has(formData.actionId)
  const canPickGroups = isGroupPostCampaign || isCommentSeedingFeedCampaign
  const canPickFriends = isMessageFriendCampaign
  const canUploadData = !isMessageFriendCampaign
  const showExtraSection = !isSimpleCampaign && !isFindDataGroupCampaign && !isCommentSeedingCampaign && !isMessageFriendCampaign
  const isEditingSavedCampaign = !!campaign?.id && !cloneFromId
  const detailsColumnCount = isCommentSeedingPostCampaign
    ? (isEditingSavedCampaign ? 1 : 2)
    : (isEditingSavedCampaign ? 4 : 5)
  const selectedCampaignAction = campaignActions.find(action => action.id === formData.actionId)
  const limitActionCodes = selectedCampaignAction?.limitCheckActionCodes || []
  const limitActionCodesKey = limitActionCodes.join(',')
  const STEPS = (() => {
    if (isSimpleCampaign) return ALL_STEPS.filter(s => s.id !== 'extra' && s.id !== 'details')
    if (isCommentSeedingCampaign) {
      return ALL_STEPS
        .filter(s => s.id !== 'extra')
        .map(s => {
          if (s.id === 'content') {
            return {
              ...s,
              title: 'Cấu hình comment',
              fields: isCommentSeedingPostCampaign
                ? [
                  { key: 'commentContent', label: 'Nội dung comment' },
                  { key: 'commentImages', label: 'Ảnh comment' },
                  { key: 'enablePostLike', label: 'Like bài' }
                ]
                : [
                  { key: 'commentContent', label: 'Nội dung comment' },
                  { key: 'commentImages', label: 'Ảnh comment' },
                  { key: 'postsPerTarget', label: 'Số bài mỗi mục tiêu' },
                  { key: 'postKeywordFilter', label: 'Lọc từ khoá' },
                  { key: 'enablePostLike', label: 'Like bài' }
                ]
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
    }
    if (isFindDataGroupCampaign) {
      return ALL_STEPS
        .filter(s => s.id !== 'extra')
        .map(s => {
          if (s.id === 'content') {
            return {
              ...s,
              title: 'Cấu hình tìm kiếm',
              fields: [
                { key: 'findDataScope', label: 'Nơi tìm kiếm' },
                { key: 'findDataContent', label: 'Điều kiện nội dung' },
                { key: 'findDataTargets', label: 'Dữ liệu cần lấy' }
              ]
            }
          }
          if (s.id === 'details') {
            return {
              ...s,
              title: 'Danh sách group',
              fields: [{ key: 'details', label: 'Group' }]
            }
          }
          return s
        })
    }
    if (isMessageCampaign) {
      return ALL_STEPS
        .filter(s => isMessageFriendCampaign ? s.id !== 'extra' : true)
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
              title: isMessageFriendCampaign ? 'Danh sách bạn bè' : 'Danh sách UID',
              fields: [{ key: 'details', label: isMessageFriendCampaign ? 'Bạn bè' : 'UID' }]
            }
          }
          return s
        })
    }
    return ALL_STEPS
  })()
  const getSectionNumber = (stepId: string) => Math.max(1, STEPS.findIndex(s => s.id === stepId) + 1)

  const messageUidCampaignOptions = campaigns.filter(c =>
    c.actionId === MESSAGE_UID_ACTION_ID &&
    c.id !== campaign?.id &&
    !c.isDelete
  )
  const postLinkCommentCampaignOptions = campaigns.filter(c =>
    c.actionId === 'facebook_comment_seeding_post' &&
    c.id !== campaign?.id &&
    !c.isDelete
  )

  const [details, setDetails] = useState<Partial<CampaignInputData>[]>([])
  const [deletedIds, setDeletedIds] = useState<number[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [activeStep, setActiveStep] = useState('general')
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false)
  const [messageDateOption, setMessageDateOption] = useState<MessageDateOption>('today')
  const [messageDateFormat, setMessageDateFormat] = useState<MessageDateFormat>('DD/MM/YYYY')
  const accountDropdownRef = useRef<HTMLDivElement>(null)

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
    if (campaigns.length === 0) {
      void loadCampaigns()
    }
  }, [campaigns.length, loadCampaigns])

  useEffect(() => {
    if (!formData.actionId || !selectedCampaignAction) return
    setFormData(prev => {
      const fallback = {
        dailyLimit: prev.dailyLimit,
        rateLimitCount: prev.rateLimitCount,
        rateLimitMinutes: prev.rateLimitMinutes
      }
      const next: Record<string, ActionLimitForm> = {}
      for (const code of limitActionCodes) {
        next[code] = prev.actionLimitsByCode[code] || toActionLimitForm(undefined, fallback)
      }
      const enabledCodes = prev.hasCustomLimitCheckActionCodes
        ? prev.limitCheckActionCodes.filter(code => limitActionCodes.includes(code))
        : [...limitActionCodes]
      const prevKeys = Object.keys(prev.actionLimitsByCode).sort().join(',')
      const nextKeys = Object.keys(next).sort().join(',')
      if (
        prevKeys === nextKeys &&
        Object.keys(next).every(code => prev.actionLimitsByCode[code] === next[code]) &&
        prev.limitCheckActionCodes.join(',') === enabledCodes.join(',')
      ) {
        return prev
      }
      return { ...prev, actionLimitsByCode: next, limitCheckActionCodes: enabledCodes }
    })
  }, [formData.actionId, selectedCampaignAction?.id, limitActionCodesKey])

  const { showAlert, showConfirm } = useUiStore()

  useEffect(() => {
    async function fetchDetails() {
      const loadId = cloneFromId || (campaign && campaign.id ? campaign.id : null)
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
  }, [campaign, cloneFromId])

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
      case 'dailyStopTime': return true
      case 'timeSleepBetween2': return formData.timeSleepBetween2 >= 0
      case 'dailyLimit': return formData.dailyLimit >= 0
      case 'rateLimitCount': return formData.rateLimitCount >= 0
      case 'rateLimitMinutes': return formData.rateLimitMinutes >= 0
      case 'content': return isFindDataGroupCampaign ? true : formData.content.trim().length > 0
      case 'commentContent': return formData.commentContent.trim().length > 0 || (formData.commentImageOption !== 'none' && formData.commentImages.length > 0)
      case 'postsPerTarget': return formData.postsPerTarget > 0
      case 'postKeywordFilter': return true
      case 'enablePostLike': return true
      case 'sharePost': return true  // optional, always "complete"
      case 'enableComment': return true  // optional
      case 'images': return true  // optional
      case 'commentImages': return true  // optional
      case 'findDataScope': return formData.isFindInPost || formData.isFindInComment || formData.isFindPostLink
      case 'findDataContent': return true
      case 'findDataTargets': return formData.isFindPhone || formData.isFindLinkGroupZalo || formData.isFindUid || formData.isFindPostLink
      case 'messageActions': return isMessageFriendCampaign || formData.enableMessage || formData.enableAddFriend
      case 'details': return details.length > 0
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

  const toggleLimitCheckActionCode = (actionCode: string) => {
    setFormData(prev => {
      const exists = prev.limitCheckActionCodes.includes(actionCode)
      return {
        ...prev,
        hasCustomLimitCheckActionCodes: true,
        limitCheckActionCodes: exists
          ? prev.limitCheckActionCodes.filter(code => code !== actionCode)
          : [...prev.limitCheckActionCodes, actionCode]
      }
    })
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

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.actionId || formData.accountIds.length === 0) {
      showAlert('Vui lòng nhập Tên, Hành động và Tài khoản.', 'error')
      return
    }
    if (isFindDataGroupCampaign) {
      if (!formData.isFindInPost && !formData.isFindInComment && !formData.isFindPostLink) {
        showAlert('Vui lòng chọn tìm trên bài post hoặc trong comment.', 'error')
        return
      }
      if (!formData.isFindPhone && !formData.isFindLinkGroupZalo && !formData.isFindUid && !formData.isFindPostLink) {
        showAlert('Vui lòng chọn ít nhất một loại data cần tìm.', 'error')
        return
      }
      if (!isEditingSavedCampaign && details.length === 0) {
        showAlert('Vui lòng thêm ít nhất một group vào danh sách data.', 'error')
        return
      }
    }
    if (!isEditingSavedCampaign && formData.actionId === 'facebook_group_post' && details.length === 0) {
      showAlert('Vui lòng thêm ít nhất một group vào danh sách data.', 'error')
      return
    }
    if (isMessageUidCampaign && !formData.enableMessage && !formData.enableAddFriend) {
      showAlert('Vui lòng chọn ít nhất một hành động nhắn tin hoặc kết bạn.', 'error')
      return
    }
    if (!isEditingSavedCampaign && isMessageCampaign && details.length === 0) {
      showAlert(
        isMessageUidCampaign
          ? 'Vui lòng thêm ít nhất một UID vào danh sách data.'
          : 'Vui lòng thêm ít nhất một bạn bè vào danh sách data.',
        'error'
      )
      return
    }
    const hasCommentImages = formData.commentImageOption !== 'none' && formData.commentImages.length > 0
    if (isCommentSeedingCampaign && !formData.commentContent.trim() && !hasCommentImages) {
      showAlert('Vui lòng nhập nội dung comment hoặc chọn ảnh comment.', 'error')
      return
    }
    if (!isEditingSavedCampaign && isCommentSeedingCampaign && details.length === 0) {
      showAlert(
        isCommentSeedingPostCampaign
          ? 'Vui lòng thêm ít nhất một link bài post vào danh sách mục tiêu.'
          : 'Vui lòng thêm ít nhất một group/page/profile vào danh sách mục tiêu.',
        'error'
      )
      return
    }
    if (!isEditingSavedCampaign && (isGroupPostCampaign || isCommentSeedingCampaign || isMessageCampaign) && details.some(d => !String(d.uid || '').trim())) {
      showAlert(
        isCommentSeedingPostCampaign
          ? 'Vui lòng nhập link bài post cho tất cả dòng trong danh sách data.'
          : 'Vui lòng nhập UID hoặc link cho tất cả dòng trong danh sách data.',
        'error'
      )
      return
    }

    try {
      const { deleteCampaignInputData, updateCampaignInputData, createCampaignInputData, createCampaign, updateCampaign } = useCampaignStore.getState()

      if (!isEditingSavedCampaign) {
        for (const id of deletedIds) {
          await deleteCampaignInputData(id)
        }
      }

      let accountChunks: Partial<CampaignInputData>[][] = [];
      const numAccounts = formData.accountIds.length;

      if (formData.splitDataAcrossAccounts && numAccounts > 1 && details.length > 0) {
        // Khởi tạo mảng con cho mỗi tài khoản
        for (let i = 0; i < numAccounts; i++) {
          accountChunks.push([]);
        }
        // Chia data lần lượt (round-robin)
        for (let i = 0; i < details.length; i++) {
          const accountIndex = i % numAccounts;
          accountChunks[accountIndex].push(details[i]);
        }
      } else {
        for (let i = 0; i < numAccounts; i++) {
          accountChunks.push(details);
        }
      }

      for (let i = 0; i < numAccounts; i++) {
        const accountId = formData.accountIds[i]
        const isFirst = (i === 0)
        const currentDetails = accountChunks[i] || [];
        const defaultLimit = {
          dailyLimit: formData.dailyLimit,
          rateLimitCount: formData.rateLimitCount,
          rateLimitMinutes: formData.rateLimitMinutes
        }
        const byActionCode = Object.fromEntries(
          limitActionCodes.map(code => [
            code,
            formData.actionLimitsByCode[code] || toActionLimitForm(undefined, defaultLimit)
          ])
        )

        const effectivePostsPerTarget = isCommentSeedingPostCampaign ? 1 : formData.postsPerTarget
        const effectivePostKeywordFilter = isCommentSeedingPostCampaign ? '' : formData.postKeywordFilter
        const effectiveEnableMessage = isMessageFriendCampaign ? true : formData.enableMessage
        const effectiveEnableAddFriend = isMessageFriendCampaign ? false : formData.enableAddFriend

        const campaignPayload = {
          name: formData.name,
          actionId: formData.actionId,
          accountId: accountId,
          schedule: formData.schedule ? new Date(formData.schedule).toISOString() : undefined,
          scheduleType: formData.scheduleType,
          scheduleEndDate: formData.scheduleType === 'daily'
            ? null
            : (formData.scheduleEndDate ? new Date(formData.scheduleEndDate + 'T23:59:59').toISOString() : null),
          dailyStopTime: formData.useDailyStopTime ? (formData.dailyStopTime || DEFAULT_DAILY_STOP_TIME) : null,
          scheduleDays: formData.scheduleDays || undefined,
          scheduleWeekDays: formData.scheduleWeekDays || undefined,
          continueNextDay: formData.continueNextDay,
          refreshData: formData.refreshData,
          timeSleepBetween2: formData.timeSleepBetween2,
          content: formData.content,
          extraSettings: {
            sharePost: formData.sharePost,
            enableComment: isCommentSeedingCampaign ? true : formData.enableComment,
            commentType: formData.commentType,
            commentCount: isCommentSeedingCampaign ? effectivePostsPerTarget : formData.commentCount,
            commentContent: formData.commentContent,
            enablePostLike: formData.enablePostLike,
            postsPerTarget: effectivePostsPerTarget,
            postKeywordFilter: effectivePostKeywordFilter,
            keywordFilter: effectivePostKeywordFilter,
            actionLimits: {
              sleepBetweenActions: formData.timeSleepBetween2,
              enabledActionCodes: formData.limitCheckActionCodes,
              dailyLimit: formData.dailyLimit,
              rateLimitCount: formData.rateLimitCount,
              rateLimitMinutes: formData.rateLimitMinutes,
              byActionCode
            },
            imageOption: formData.imageOption,
            randomImageCount: formData.randomImageCount,
            commentImageOption: formData.commentImageOption !== 'none' && formData.commentImages.length > 0 ? 'all' : 'none',
            commentImages: formData.commentImages.slice(0, 1),
            leaveGroupOnPendingApproval: formData.leaveGroupOnPendingApproval,
            autoJoinGroupAfterPost: formData.autoJoinGroupAfterPost,
            shuffleGroupList: formData.shuffleGroupList,
            enableMessage: effectiveEnableMessage,
            enableAddFriend: effectiveEnableAddFriend,
            // Nguồn đăng bài (timeline post only)
            copyContentFromSource: formData.copyContentFromSource,
            includeSourceImages: formData.includeSourceImages,
            postAsReels: formData.postAsReels,
            sourceLinks: formData.sourceLinks,
            // Giữ nguyên con trỏ rotation hiện tại (scheduler cập nhật mỗi lần chạy)
            sourceLinkIndex: campaign?.extraSettings?.sourceLinkIndex ?? 0,
            // Tìm kiếm data trong group
            isFindPhone: formData.isFindPhone,
            isFindLinkGroupZalo: formData.isFindLinkGroupZalo,
            isFindUid: formData.isFindUid,
            isFindPostLink: formData.isFindPostLink,
            isFindInPost: formData.isFindInPost,
            sortTypePost: formData.sortTypePost,
            countPostFindData: formData.countPostFindData,
            isFindInComment: formData.isFindInComment,
            sortTypeComment: formData.sortTypeComment,
            countCommentFindData: formData.countCommentFindData,
            isFindByKeywords: formData.isFindByKeywords,
            keywords: formData.keywords,
            isFindByContentAI: formData.isFindByContentAI,
            contentAI: formData.contentAI,
            findUidTargetCampaignIds: formData.findUidTargetCampaignIds,
            findPostLinkTargetCampaignIds: formData.findPostLinkTargetCampaignIds
          } as CampaignExtraSettings,
          images: formData.images
        }

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
      }

      showAlert('Lưu chiến dịch thành công!', 'success')
      // Delay closing to let user see the toast
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      console.error('Failed to save campaign:', err)
      showAlert('Có lỗi xảy ra khi lưu chiến dịch.', 'error')
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
          const name = isCommentSeedingPostCampaign ? '' : String(row[0] || '').trim()
          const uid = isCommentSeedingPostCampaign ? postLink : String(row[1] || '').trim()
          const phone = isCommentSeedingPostCampaign ? '' : String(row[2] || '').trim()
          const email = isCommentSeedingPostCampaign ? '' : String(row[3] || '').trim()

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
          showAlert(`Đã thêm ${newRows.length} ${isCommentSeedingPostCampaign ? 'link bài post' : 'UID'} từ file TXT.`, 'success')
        } else {
          showAlert(isCommentSeedingPostCampaign ? 'File TXT trống hoặc không có link bài post hợp lệ.' : 'File TXT trống hoặc không có UID hợp lệ.', 'error')
        }
      } catch (err) {
        console.error('Lỗi khi đọc file TXT:', err)
        showAlert('Có lỗi xảy ra khi đọc file TXT.', 'error')
      }
    }
    reader.readAsText(file) // For text files
    if (txtFileInputRef.current) txtFileInputRef.current.value = ''
  }

  const [dataScanPicker, setDataScanPicker] = useState<{ action: DataScanAction } | null>(null)

  const onFriendsSelected = (contacts: AutoAccountContact[]) => {
    const newRows: Partial<CampaignInputData>[] = contacts.map(c => ({
      name: c.name,
      uid: c.url || c.uid || '',
      phone: '',
      email: '',
      note: '',
      status: 'chờ xử lý'
    }))
    setDetails(prev => [...prev, ...newRows])
    showAlert(`Đã thêm ${newRows.length} bạn bè.`, 'success')
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
    setDetails(prev => [...prev, ...newRows])
    showAlert(`Đã thêm ${newRows.length} nhóm.`, 'success')
  }

  const toggleFindUidTargetCampaign = (campaignId: number) => {
    setFormData(prev => {
      const current = prev.findUidTargetCampaignIds || []
      const exists = current.includes(campaignId)
      return {
        ...prev,
        findUidTargetCampaignIds: exists
          ? current.filter(id => id !== campaignId)
          : [...current, campaignId]
      }
    })
  }

  const toggleFindPostLinkTargetCampaign = (campaignId: number) => {
    setFormData(prev => {
      const current = prev.findPostLinkTargetCampaignIds || []
      const exists = current.includes(campaignId)
      return {
        ...prev,
        findPostLinkTargetCampaignIds: exists
          ? current.filter(id => id !== campaignId)
          : [...current, campaignId]
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
      showAlert('Một số ảnh không xác định được đường dẫn và đã bị bỏ qua.', 'error')
    }
    if (paths.length > 0) {
      setFormData(p => target === 'comment'
        ? ({ ...p, commentImages: paths.slice(0, 1), commentImageOption: 'all' })
        : ({ ...p, images: [...p.images, ...paths] })
      )
    }
    e.target.value = ''
  }

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
    const dateTokenName = MESSAGE_DATE_OPTIONS.find(opt => opt.value === messageDateOption)?.token || 'TODAY'
    const dateToken = `#{${dateTokenName}(${messageDateFormat})}`

    return (
      <aside className="message-template-panel" aria-label="Chèn thông tin">
        <div className="message-template-title">Chèn thông tin</div>

        <div className="message-template-section">
          <div className="message-template-section-title">
            <Users size={16} />
            <span>Khách hàng</span>
          </div>
          <label>Tên hiển thị</label>
          <button
            type="button"
            className="message-template-token"
            onClick={() => insertCampaignContentToken(MESSAGE_FULL_NAME_TOKEN)}
          >
            {MESSAGE_FULL_NAME_TOKEN}
          </button>
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
                {MESSAGE_DATE_OPTIONS.map(opt => (
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

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => inputRef.current?.click()}
              style={{ width: 'fit-content', opacity: option === 'none' ? 0.6 : 1 }}
              disabled={option === 'none'}
            >
              Tải hoặc chọn ảnh
            </button>
            <input
              type="file"
              ref={inputRef}
              style={{ display: 'none' }}
              accept="image/*"
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
                <span>Không gửi ảnh</span>
              </label>
              <label className="schedule-radio-label">
                <input
                  type="radio"
                  name={radioName}
                  checked={option === 'all'}
                  onChange={() => setOption('all')}
                />
                <span>Gửi ảnh đã chọn</span>
              </label>
              {!isComment && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label className="schedule-radio-label">
                  <input
                    type="radio"
                    name={radioName}
                    checked={option === 'random'}
                    onChange={() => setOption('random')}
                  />
                  <span>Gửi ngẫu nhiên số ảnh trong ảnh đã chọn</span>
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
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Ảnh đã chọn</div>
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
                      <td colSpan={3} className="text-center text-muted" style={{ padding: '24px 0' }}>Chưa có ảnh nào được chọn</td>
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

  const renderFindDataGroupSettings = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="extra-comment-options">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Tìm kiếm trên post</div>
        <div className="stepper-form-group">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.isFindInPost}
              onChange={e => setFormData(p => ({ ...p, isFindInPost: e.target.checked }))}
            />
            <span>Tìm kiếm trên bài post</span>
          </label>
        </div>
        <div className="stepper-form-row">
          <div className="stepper-form-group half">
            <label>Cách hiển thị bài post trong group</label>
            <select
              value={formData.sortTypePost}
              onChange={e => setFormData(p => ({ ...p, sortTypePost: e.target.value as CampaignExtraSettings['sortTypePost'] }))}
              className="stepper-input"
              disabled={!formData.isFindInPost}
            >
              {POST_SORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          <div className="stepper-form-group half">
            <label>Số post tối đa trong 1 group</label>
            <input
              type="number"
              min={1}
              value={formData.countPostFindData}
              onChange={e => setFormData(p => ({ ...p, countPostFindData: Math.max(1, Number(e.target.value) || 1) }))}
              className="stepper-input"
              disabled={!formData.isFindInPost && !formData.isFindInComment}
            />
          </div>
        </div>
      </div>

      <div className="extra-comment-options">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Tìm kiếm trong comment của post</div>
        <div className="stepper-form-group">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.isFindInComment}
              onChange={e => setFormData(p => ({ ...p, isFindInComment: e.target.checked }))}
            />
            <span>Tìm kiếm trong comment</span>
          </label>
        </div>
        <div className="stepper-form-row">
          <div className="stepper-form-group half">
            <label>Cách hiển thị comment trong post</label>
            <select
              value={formData.sortTypeComment}
              onChange={e => setFormData(p => ({ ...p, sortTypeComment: e.target.value as CampaignExtraSettings['sortTypeComment'] }))}
              className="stepper-input"
              disabled={!formData.isFindInComment}
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
              disabled={!formData.isFindInComment}
            />
          </div>
        </div>
      </div>

      <div className="extra-comment-options">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Điều kiện nội dung</div>
        <div className="stepper-form-group">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.isFindByKeywords}
              onChange={e => setFormData(p => ({ ...p, isFindByKeywords: e.target.checked }))}
            />
            <span>Nội dung phải chứa 1 trong các từ khoá (cách nhau dấu phẩy)</span>
          </label>
          <input
            type="text"
            value={formData.keywords}
            onChange={e => setFormData(p => ({ ...p, keywords: e.target.value }))}
            className="stepper-input"
            disabled={!formData.isFindByKeywords}
          />
        </div>

        <div className="stepper-form-group">
          <label className="schedule-checkbox-label">
            <input
              type="checkbox"
              checked={formData.isFindByContentAI}
              onChange={e => setFormData(p => ({ ...p, isFindByContentAI: e.target.checked }))}
            />
            <span>Ý nghĩa của nội dung là (dùng AI)</span>
          </label>
          <textarea
            className="stepper-textarea"
            value={formData.contentAI}
            onChange={e => setFormData(p => ({ ...p, contentAI: e.target.value }))}
            rows={4}
            disabled={!formData.isFindByContentAI}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.isFindPhone}
            onChange={e => setFormData(p => ({ ...p, isFindPhone: e.target.checked }))}
          />
          <span>Tìm số điện thoại</span>
        </label>
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.isFindLinkGroupZalo}
            onChange={e => setFormData(p => ({ ...p, isFindLinkGroupZalo: e.target.checked }))}
          />
          <span>Tìm link group Zalo</span>
        </label>
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.isFindUid}
            onChange={e => {
              const checked = e.target.checked
              setFormData(p => ({
                ...p,
                isFindUid: checked,
                findUidTargetCampaignIds: checked ? p.findUidTargetCampaignIds : []
              }))
            }}
          />
          <span>Tìm UID của người đăng bài hoặc comment</span>
        </label>
        <label className="schedule-checkbox-label">
          <input
            type="checkbox"
            checked={formData.isFindPostLink}
            onChange={e => {
              const checked = e.target.checked
              setFormData(p => ({
                ...p,
                isFindPostLink: checked,
                isFindInPost: checked ? true : p.isFindInPost,
                findPostLinkTargetCampaignIds: checked ? p.findPostLinkTargetCampaignIds : []
              }))
            }}
          />
          <span>Tìm link bài post</span>
        </label>
      </div>

      {formData.isFindUid && (
        <div className="extra-comment-options">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Đẩy UID sang chiến dịch</div>
          {messageUidCampaignOptions.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
              Chưa có chiến dịch Nhắn tin & Kết bạn đến UID để nhận UID.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
              {messageUidCampaignOptions.map(target => (
                <label key={target.id} className="schedule-checkbox-label" title={target.name}>
                  <input
                    type="checkbox"
                    checked={(formData.findUidTargetCampaignIds || []).includes(target.id)}
                    onChange={() => toggleFindUidTargetCampaign(target.id)}
                  />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {target.name} <span style={{ color: 'var(--text-tertiary)' }}>({target.status})</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {formData.isFindPostLink && (
        <div className="extra-comment-options">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Đẩy link bài post sang chiến dịch</div>
          {postLinkCommentCampaignOptions.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
              Chưa có chiến dịch Comment seeding vào danh sách bài post để nhận link.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
              {postLinkCommentCampaignOptions.map(target => (
                <label key={target.id} className="schedule-checkbox-label" title={target.name}>
                  <input
                    type="checkbox"
                    checked={(formData.findPostLinkTargetCampaignIds || []).includes(target.id)}
                    onChange={() => toggleFindPostLinkTargetCampaign(target.id)}
                  />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {target.name} <span style={{ color: 'var(--text-tertiary)' }}>({target.status})</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )

  const renderCommentSeedingSettings = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="stepper-form-group">
        <label>Nội dung comment <span className="required">*</span></label>
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
      </div>

      {renderImagePicker('comment', 'Ảnh comment')}

      {!isCommentSeedingPostCampaign && (
        <div className="stepper-form-row">
          <div className="stepper-form-group half">
            <label>Số bài cần comment trên mỗi mục tiêu</label>
            <input
              type="number"
              min={1}
              value={formData.postsPerTarget}
              onChange={e => setFormData(p => ({ ...p, postsPerTarget: Math.max(1, Number(e.target.value) || 1) }))}
              className="stepper-input"
            />
          </div>
          <div className="stepper-form-group half">
            <label>Lọc bài theo từ khoá</label>
            <input
              type="text"
              value={formData.postKeywordFilter}
              onChange={e => setFormData(p => ({ ...p, postKeywordFilter: e.target.value }))}
              className="stepper-input"
              placeholder="Ví dụ: tuyển dụng, cần mua, hỏi giá"
            />
          </div>
        </div>
      )}

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
    </div>
  )

  return (
    <div className="modal-overlay">
      <div className="campaign-full-modal stepper-modal">
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">
            {campaign && campaign.id ? 'Sửa chiến dịch' : campaign ? 'Nhân bản chiến dịch' : 'Thêm chiến dịch'}
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
                    >
                      <option value="">-- Chọn hành động --</option>
                      {campaignActions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>

                  <div className="stepper-form-group" ref={accountDropdownRef}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ margin: 0 }}>Tài khoản <span className="required">*</span></label>
                      {accounts.length > 0 && !(campaign && campaign.id) && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '2px 8px', fontSize: '12px', height: 'auto' }}
                          onClick={() => {
                            const allSelected = formData.accountIds.length === accounts.length;
                            setFormData(p => ({
                              ...p,
                              accountIds: allSelected ? [] : accounts.map(a => a.id)
                            }));
                          }}
                        >
                          {formData.accountIds.length === accounts.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
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
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 10, background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                          <div className="account-checkbox-list" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', padding: '12px', maxHeight: '250px', overflowY: 'auto' }}>
                            {accounts.map(a => (
                              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                                <input
                                  type={campaign && campaign.id ? "radio" : "checkbox"}
                                  name={campaign && campaign.id ? "account-selection" : undefined}
                                  checked={formData.accountIds.includes(a.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    if (campaign && campaign.id) {
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
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${a.name} (${a.flatformType})`}>{a.name} ({a.flatformType})</span>
                              </label>
                            ))}
                            {accounts.length === 0 && (
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '8px 0' }}>Chưa có tài khoản nào</div>
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
                  <div className="stepper-form-row">
                    <div className="stepper-form-group half">
                      <label>Ngày chạy</label>
                      <input
                        type="datetime-local"
                        value={formData.schedule}
                        onChange={e => setFormData(p => ({ ...p, schedule: e.target.value }))}
                        className="stepper-input"
                      />
                    </div>
                    <div className="stepper-form-group half">
                      <label>Ngày kết thúc</label>
                      <input
                        type="date"
                        value={formData.scheduleEndDate}
                        onChange={e => setFormData(p => ({ ...p, scheduleEndDate: e.target.value }))}
                        className="stepper-input"
                        disabled={formData.scheduleType === 'daily'}
                      />
                    </div>
                  </div>

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

                  {/* Monthly days */}
                  <div className="stepper-form-group">
                    <label>Lịch tháng</label>
                    <input
                      type="text"
                      value={formData.scheduleDays}
                      onChange={e => setFormData(p => ({ ...p, scheduleDays: e.target.value }))}
                      className="stepper-input"
                      placeholder="Ví dụ: 5,10,19,25"
                      disabled={formData.scheduleType !== 'monthly'}
                    />
                    <span className="schedule-hint">Danh sách ngày chạy, các ngày cách nhau bởi dấu phẩy.</span>
                  </div>

                  {/* Weekly days */}
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
                              disabled={formData.scheduleType !== 'weekly'}
                            />
                            <span>{day.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* Conditional checkbox based on schedule type */}
                  {formData.scheduleType === 'daily' && (
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
                        value={formData.timeSleepBetween2}
                        onChange={e => setFormData(p => ({ ...p, timeSleepBetween2: parseInt(e.target.value) || 0 }))}
                        className="stepper-input"
                      />
                    </div>
                  </div>
                  {limitActionCodes.length === 0 ? (
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
                      Loại chiến dịch này không check giới hạn hành động trước khi chạy.
                    </div>
                  ) : (
                    <div className="action-limit-card-list">
                      {limitActionCodes.map(actionCode => {
                        const limit = formData.actionLimitsByCode[actionCode] || toActionLimitForm(undefined, {
                          dailyLimit: formData.dailyLimit,
                          rateLimitCount: formData.rateLimitCount,
                          rateLimitMinutes: formData.rateLimitMinutes
                        })
                        const isLimitCheckEnabled = formData.limitCheckActionCodes.includes(actionCode)
                        return (
                          <div className={`action-limit-card ${!isLimitCheckEnabled ? 'disabled' : ''}`} key={actionCode}>
                            <div className="action-limit-card-header">
                              <label className="action-limit-check-toggle">
                                <input
                                  type="checkbox"
                                  checked={isLimitCheckEnabled}
                                  onChange={() => toggleLimitCheckActionCode(actionCode)}
                                />
                                <strong>{getActionCodeLabel(actionCode)}</strong>
                              </label>
                              <span>{actionCode}</span>
                            </div>
                            <div className="stepper-form-row">
                              <div className="stepper-form-group third">
                                <label>Giới hạn trong ngày</label>
                                <input
                                  type="number"
                                  value={limit.dailyLimit}
                                  onChange={e => updateActionLimit(actionCode, 'dailyLimit', parseInt(e.target.value) || 0)}
                                  className="stepper-input"
                                  disabled={!isLimitCheckEnabled}
                                />
                              </div>
                              <div className="stepper-form-group third">
                                <label>Giới hạn số hành động</label>
                                <input
                                  type="number"
                                  value={limit.rateLimitCount}
                                  onChange={e => updateActionLimit(actionCode, 'rateLimitCount', parseInt(e.target.value) || 0)}
                                  className="stepper-input"
                                  disabled={!isLimitCheckEnabled}
                                />
                              </div>
                              <div className="stepper-form-group third">
                                <label>Trong khoảng (phút)</label>
                                <input
                                  type="number"
                                  value={limit.rateLimitMinutes}
                                  onChange={e => updateActionLimit(actionCode, 'rateLimitMinutes', parseInt(e.target.value) || 0)}
                                  className="stepper-input"
                                  disabled={!isLimitCheckEnabled}
                                />
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section 4: Nội dung */}
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
                  <span className="stepper-section-title">
                    {isFindDataGroupCampaign ? 'Cấu hình tìm kiếm' : isCommentSeedingCampaign ? 'Cấu hình comment' : 'Nội dung'}
                  </span>
                </div>
                {collapsedSections['content'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['content'] && (
                <div className="stepper-section-body">
                  {isFindDataGroupCampaign ? renderFindDataGroupSettings() : isCommentSeedingCampaign ? renderCommentSeedingSettings() : (
                    <>
                  {/* === Nguồn đăng bài (chỉ hiện cho đăng trang cá nhân) === */}
                  {isTimelinePostCampaign && (
                    <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
                      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.copyContentFromSource}
                            onChange={e => setFormData(p => ({ ...p, copyContentFromSource: e.target.checked }))}
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
                      <div style={{ marginBottom: 12 }}>
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.sharePost}
                            onChange={e => setFormData(p => ({ ...p, sharePost: e.target.checked }))}
                          />
                          <span>Đăng bài bằng cách chia sẻ</span>
                        </label>
                      </div>

                      <div className="stepper-form-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <label style={{ margin: 0 }}>Danh sách uid/link (page, profile, group, post)</label>
                          <span style={{ color: 'var(--text-error)', fontSize: 12 }}>(Mỗi link/uid cách nhau bằng dấu phẩy)</span>
                        </div>
                        <textarea
                          className="stepper-textarea"
                          placeholder="Ví dụ: https://facebook.com/abc, https://facebook.com/xyz/posts/12345, 100012345"
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
                            checked={formData.postAsReels}
                            onChange={e => setFormData(p => ({ ...p, postAsReels: e.target.checked }))}
                          />
                          <span>Đăng Reels <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Đăng video trên Reels)</em></span>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className={isMessageCampaign ? 'campaign-content-template-layout' : undefined}>
                    <div className="stepper-form-group">
                      <label>{isMessageCampaign ? 'Nội dung tin nhắn' : 'Nội dung chiến dịch'}</label>
                      <textarea
                        ref={campaignContentTextareaRef}
                        className="stepper-textarea"
                        placeholder={isTimelinePostCampaign && formData.copyContentFromSource
                          ? "Nội dung nhập ở đây sẽ được nối sau nội dung copy từ nguồn (ngăn bằng dòng mới)..."
                          : isMessageCampaign
                            ? "Nhập nội dung tin nhắn. Dùng dấu | để tách nhiều nội dung — nội dung 1 chạy ở mục tiêu 1, nội dung 2 ở mục tiêu 2..."
                            : "Nhập nội dung chiến dịch ở đây. Dùng dấu | để tách nhiều nội dung — nội dung 1 chạy ở mục tiêu 1, nội dung 2 ở mục tiêu 2..."}
                        value={formData.content}
                        onChange={e => setFormData(p => ({ ...p, content: e.target.value }))}
                        rows={8}
                      />
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                        Mẹo: tách nhiều nội dung bằng dấu <code>|</code> — nội dung thứ N sẽ đăng ở group/tin nhắn thứ N (lặp lại từ đầu khi hết biến thể).
                      </div>
                    </div>
                    {isMessageCampaign && renderMessageInsertPanel()}
                  </div>

                  {renderImagePicker('post', 'Media')}
                    </>
                  )}
                </div>
              )}
            </div>

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

                  {/* === Nhắn tin & Kết bạn toggles (chỉ hiện cho UID campaigns) === */}
                  {isMessageUidCampaign && (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Chọn hành động</div>
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.enableMessage}
                            onChange={e => setFormData(p => ({ ...p, enableMessage: e.target.checked }))}
                          />
                          <span>💬 Nhắn tin cho bạn bè / UID</span>
                        </label>
                      </div>
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.enableAddFriend}
                            onChange={e => setFormData(p => ({ ...p, enableAddFriend: e.target.checked }))}
                          />
                          <span>🤝 Kết bạn với UID</span>
                        </label>
                      </div>
                      {!formData.enableMessage && !formData.enableAddFriend && (
                        <div style={{ color: 'var(--text-error)', fontSize: 12, marginTop: 4 }}>⚠️ Vui lòng chọn ít nhất một hành động.</div>
                      )}
                    </>
                  )}

                  {/* === Group campaign options (ẩn cho message campaigns) === */}
                  {!isMessageCampaign && (
                    <>
                      {/* Share post - tạm ẩn, sẽ mở lại khi implement đầy đủ */}

                      {/* Enable comment */}
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

                      {/* Comment options - only when enableComment */}
                      {formData.enableComment && (
                        <div className="extra-comment-options">
                          <div className="stepper-form-group">
                            <div className="schedule-radio-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                              <label className="schedule-radio-label">
                                <input
                                  type="radio"
                                  name="commentType"
                                  value="own"
                                  checked={formData.commentType === 'own'}
                                  onChange={() => setFormData(p => ({ ...p, commentType: 'own' }))}
                                />
                                <span>Chỉ comment vào bài post của mình</span>
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label className="schedule-radio-label">
                                  <input
                                    type="radio"
                                    name="commentType"
                                    value="others"
                                    checked={formData.commentType === 'others'}
                                    onChange={() => setFormData(p => ({ ...p, commentType: 'others' }))}
                                  />
                                  <span>Comment vào các bài khác trừ bài post của mình với số lượng</span>
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  value={formData.commentCount}
                                  onChange={e => setFormData(p => ({ ...p, commentCount: Number(e.target.value) }))}
                                  className="stepper-input"
                                  style={{ width: 60 }}
                                  disabled={formData.commentType !== 'others'}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="stepper-form-group">
                            <label>Nội dung comment</label>
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

                      {/* Divider */}
                      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

                      {/* Leave group on pending approval */}
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


            {/* Section 6: Danh sách data (hidden for simple campaigns) */}
            {!isSimpleCampaign && <div
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
                    {isFindDataGroupCampaign
                      ? 'Danh sách group'
                      : isCommentSeedingPostCampaign
                        ? 'Danh sách bài post'
                        : isCommentSeedingCampaign
                          ? 'Danh sách group/page/profile'
                          : isMessageFriendCampaign
                            ? 'Danh sách bạn bè'
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
                      <button className="btn btn-secondary" onClick={addDetailRow}>
                        <Plus size={14} /> {isCommentSeedingPostCampaign ? 'Thêm link' : 'Thêm data'}
                      </button>
                      {canUploadData && (
                        <>
                          <button
                            className="btn btn-secondary"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Upload size={14} /> Upload Excel
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => txtFileInputRef.current?.click()}
                          >
                            <Upload size={14} /> Upload TXT
                          </button>
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
                            setDataScanPicker({ action: 'facebook_friends' })
                          }}
                          title="Chọn bạn bè từ danh sách liên hệ"
                        >
                          <Users size={14} /> Chọn bạn bè
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
                            setDataScanPicker({ action: 'facebook_groups' })
                          }}
                          title={isCommentSeedingFeedCampaign ? 'Chọn group để comment seeding' : 'Chọn nhóm từ danh sách đã tham gia'}
                        >
                          <Users size={14} /> Chọn nhóm
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
                            accept=".xlsx, .xls, .csv"
                            onChange={handleFileUpload}
                            title="Upload Excel"
                          />
                          <input
                            type="file"
                            ref={txtFileInputRef}
                            style={{ display: 'none' }}
                            accept=".txt"
                            onChange={handleTxtFileUpload}
                            title="Upload TXT"
                          />
                        </>
                      )}
                    </div>
                  )}

                  <div className="stepper-grid-container">
                    <table className="campaign-grid">
                      <thead>
                        {isCommentSeedingPostCampaign ? (
                          <tr>
                            <th>Link bài post</th>
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
                              {isCommentSeedingPostCampaign ? (
                                <td>
                                  <input
                                    type="text"
                                    value={d.uid || ''}
                                    onChange={e => updateDetailRow(i, 'uid', e.target.value)}
                                    placeholder="Dán link bài post..."
                                    disabled={isEditingSavedCampaign}
                                  />
                                </td>
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
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleSave}>Lưu chiến dịch</button>
        </div>
      </div>
      {dataScanPicker && formData.accountIds.length > 0 && (
        <DataScanModal
          initialAction={dataScanPicker.action}
          initialAccountId={formData.accountIds[0]}
          lockAction
          onClose={() => setDataScanPicker(null)}
          onSelect={dataScanPicker.action === 'facebook_friends' ? onFriendsSelected : onGroupsSelected}
        />
      )}
    </div>
  )
}
