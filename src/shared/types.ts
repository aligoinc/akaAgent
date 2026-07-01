// ============================================
// Campaign Automation Types
// ============================================

export interface AutoAccount {
  id: number
  name: string
  flatformType: string
  loginStatus: string
  status: string
  isActive: boolean
  rateLimitMinutes?: number | null
  accountGroupId?: number | null
  accountGroupName?: string | null
  accountGroupSettings?: AccountGroupSettings | null
  proxyId?: number | null
  proxyName?: string | null
  proxyProtocol?: ProxyProtocol | null
  proxyHost?: string | null
  proxyPort?: number | null
  zaloAccountId?: number | null
  zaloUid?: string | null
  zaloDisplayName?: string | null
  zaloPhone?: string | null
  zaloAvatarUrl?: string | null
  hasZaloSession?: boolean
  zaloSessionUpdatedAt?: string | null
  zaloSessionLastVerifiedAt?: string | null
  zaloSessionLastError?: string | null
  hasEmailSession?: boolean
  emailSessionUpdatedAt?: string | null
  emailSessionLastVerifiedAt?: string | null
  emailSessionLastError?: string | null
  isDelete: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export interface ZaloAccount {
  id: number
  zaloUid: string
  displayName?: string | null
  phone?: string | null
  avatarUrl?: string | null
  metadata?: Record<string, unknown>
  lastSeenAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface ZaloSessionCredentials {
  cookie: unknown
  imei: string
  userAgent: string
  language?: string
}

/** SMTP config cho 1 tài khoản email (lưu trong auto_accounts.email_session jsonb). */
export interface EmailAccountConfig {
  brandName?: string   // Thương hiệu — tên hiển thị người gửi
  host: string         // Server name
  port: number         // mặc định 587 (STARTTLS); 465 khi secure
  secure: boolean      // ô SSL
  user: string         // Username (auth)
  pass: string         // Password (auth)
  fromEmail: string    // Email gửi (địa chỉ From, có thể khác user)
  replyTo?: string     // Email nhận phản hồi
  cc?: string          // Email CC
}

export interface EmailSessionCheckResult {
  success: boolean
  loggedIn: boolean
  status: string
  reason?: string
  account?: AutoAccount
}

export interface CampaignMediaSnapshot {
  name: string
  localPath?: string | null
  cloudUrl?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  provider?: string | null
}

export type CampaignMediaInput = string | CampaignMediaSnapshot

export const MEDIA_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024
export const MEDIA_FILE_MAX_SIZE_BYTES = 25 * 1024 * 1024
export const MEDIA_LIBRARY_MAX_FILES_PER_STAFF = 100

export interface MediaFile {
  id: number
  provider: string
  originalName: string
  localPath?: string | null
  cloudUrl: string
  objectKey?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  isDelete: boolean
  staffId?: number
  organizationId?: number | null
  createdAt?: string
  updatedAt?: string
}

export interface MediaStorageSettings {
  provider: string
  endpointUrl: string
  accessKeyId: string
  secretAccessKey?: string
  bucket: string
  publicBaseUrl: string
  keyPrefix?: string
  isConfigured?: boolean
  secretAccessKeyMasked?: boolean
}

export interface MediaUploadFailure {
  localPath: string
  error: string
}

export interface MediaUploadResult {
  files: MediaFile[]
  failures: MediaUploadFailure[]
}

export interface ZaloLoginQrStartResult {
  success: boolean
  accountId: number
  reason?: string
}

export interface ZaloLoginQrEvent {
  accountId: number
  status: 'qr' | 'expired' | 'scanned' | 'declined' | 'success' | 'cancelled' | 'error'
  message?: string
  qrImage?: string
  displayName?: string
  avatarUrl?: string
  zaloAccountId?: number
  zaloUid?: string
}

export interface ZaloSessionCheckResult {
  success: boolean
  loggedIn: boolean
  status: string
  reason?: string
  account?: AutoAccount
}

export interface AccountGroupSettings {
  sleepBetweenActions?: number | null
  byActionCode?: Record<string, ActionLimitConfig>
}

export interface AutoAccountGroup {
  id: number
  name: string
  flatformType: string
  settings: AccountGroupSettings
  isActive: boolean
  isDelete: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export type ProxyProtocol = 'http' | 'https' | 'socks5'

export interface AutoProxy {
  id: number
  name: string
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string | null
  password?: string | null
  isActive: boolean
  isDelete: boolean
  usageCount?: number
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export interface ProxyTestRequest {
  proxyId?: number | null
  proxy?: Partial<AutoProxy> | null
  platform?: string
  testUrl?: string
}

export interface ProxyTestResult {
  ok: boolean
  platform?: string
  testUrl: string
  status?: number
  statusText?: string
  ip?: string
  latencyMs: number
  error?: string
}

export interface CampaignAction {
  id: string         // TEXT id e.g. 'facebook_group_post'
  name: string
  flatformType: string
  isActive: boolean
  workflowId?: number       // engine v2 (BIGINT, FK auto_workflows.id)
  testWorkflowId?: number   // engine v2 test workflow (BIGINT, FK auto_workflows.id)
  allowMultipleAccounts: boolean
  // Candidate action codes for daily/window quota checks, not for action-disable enforcement.
  limitCheckActionCodes: string[]
  isDelete: boolean
  createdAt?: string
}

export interface AutoAccountAction {
  id: number
  flatformType: string
  name: string
  code: string
  isActive: boolean
  isDelete: boolean
  createdAt?: string
  updatedAt?: string
}

export interface AutoAccountActionStatus {
  id: number
  accountId: number
  actionCode: string
  countActionInDay: number
  countDate: string
  isDisable: boolean
  dateEnable?: string | null
  disabledErrorCode?: string | null
  disabledReason?: string | null
  disabledAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AutoErrorPolicy {
  id: number
  errorType: string
  errorName: string
  errorDesc?: string | null
  errorCode: string
  errorElement?: string | null
  notiRunningProcess?: string | null
  notiCampaign?: string | null
  updateStatusAccount?: string | null
  updateStatusCampaign?: string | null
  disableActionCodes: string[]
  timeDisableActions?: number | null
  countConsecutiveErrors?: number | null
  zaloErrorCodes: string[]
  detailStatus?: string | null
  countsTowardLimit: boolean
  countsTowardBadTarget: boolean
  updateLoginStatus?: string | null
  isActive: boolean
  isDelete: boolean
  createdAt?: string
  updatedAt?: string
}

export interface AccountActionLimitStatus {
  ok: boolean
  actionCode?: string
  actionName?: string
  errorCode?: string
  reason?: string
  isActionDisabled?: boolean
  isDailyLimit?: boolean
  retryAfterMs?: number
  currentCount?: number
  limit?: number
  dailyActionCount?: number
  dailyLimit?: number
  windowActionCount?: number
  windowLimit?: number
  windowMinutes?: number
  disabledReason?: string | null
}

export interface AccountActionOverview {
  action: AutoAccountAction
  status: AutoAccountActionStatus
  windowActionCount: number
  windowMinutes: number
}

export interface ActionLimitConfig {
  dailyLimit?: number
  rateLimitCount?: number
  rateLimitMinutes?: number
}

export interface CampaignActionLimitSettings extends ActionLimitConfig {
  sleepBetweenActions?: number
  // Chỉ điều khiển quota ngày/khung giờ; action disable vẫn luôn check theo action thực sự chạy.
  enabledActionCodes?: string[]
  byActionCode?: Record<string, ActionLimitConfig>
}

export interface CampaignExtraSettings {
  sharePost?: boolean            // đăng bài dạng chia sẻ (timeline post: share from source link)
  postWithBackground?: boolean   // Đăng bài profile/page UI với phông nền Facebook
  rewriteContentEachRun?: boolean // DB block viết lại nội dung chính bằng AI trước mỗi lượt chạy
  enableComment?: boolean        // kiếm comment
  commentGroupMode?: 'all' | 'pending_only' | 'published_only' // group nào được comment sau khi đăng bài group
  commentType?: 'own' | 'others' | 'all' // comment vào bài mình / bài khác / tất cả
  commentCount?: number          // số lượng comment tối đa (khi commentType = 'others' hoặc 'all')
  commentContent?: string        // nội dung comment
  rewriteCommentContentEachRun?: boolean // DB block viết lại nội dung comment bằng AI trước mỗi lượt comment seeding
  commentImageOption?: 'none' | 'all'
  commentImages?: CampaignMediaInput[]        // tối đa 1 ảnh cho mỗi comment
  enablePostLike?: boolean
  postsPerTarget?: number
  // Lướt newsfeed và tương tác
  newsfeedTimeMinutes?: number
  newsfeedLikeKind?: string
  newsfeedLikeLimit?: number
  newsfeedCommentKind?: string
  newsfeedCommentLimit?: number
  newsfeedCommentContent?: string
  newsfeedCommentUseAI?: boolean
  actionLimits?: CampaignActionLimitSettings // giới hạn gửi theo action_code; top-level là fallback cho campaign cũ
  emailSubject?: string          // Tiêu đề email (chiến dịch email_send)
  emailBodyIsHtml?: boolean      // Nội dung email là HTML (chiến dịch email_send)
  emailCheckLinkClicks?: boolean // Kiểm tra click vào link trong email_send
  imageOption?: 'none' | 'all' | 'random'
  randomImageCount?: number
  leaveGroupOnPendingApproval?: boolean   // Rời group nếu bài đang chờ duyệt (đã tham gia)
  autoJoinGroupAfterPost?: boolean         // Tự động tham gia group sau khi đăng bài thành công (chưa tham gia)
  shuffleGroupList?: boolean               // Xáo trộn danh sách group trước khi chạy chiến dịch
  skipPostIfGroupRequiresApproval?: boolean // Không đăng bài vào group đã biết cần duyệt bài; vẫn có thể kiêm comment
  enableGroupPostShareToJoinedGroups?: boolean // Đăng bài group dạng chia sẻ thêm vào 3 nhóm đã tham gia (chỉ lưu cấu hình)
  enablePostBump?: boolean                 // Sau khi đăng group thành công, thêm link bài vào campaign comment-post để up tin
  postBumpCount?: number                   // Tổng số lượt up tối đa cho mỗi bài post, max 10
  postBumpInitialDelayMinutes?: number     // Số phút chờ sau khi đăng thành công trước lượt up đầu tiên
  postBumpIntervalMinutes?: number         // Khoảng cách tối thiểu giữa các lượt up tin
  postBumpMode?: 'select' | 'create'       // Chọn campaign comment-post có sẵn hoặc tạo mới theo account
  postBumpTargetCampaignIds?: number[]     // Campaign facebook_comment_seeding_post nhận link bài post
  postBumpAccountIds?: number[]            // Account dùng để tạo campaign comment-post khi postBumpMode=create
  postBumpContent?: string                 // Nội dung comment cho campaign up tin tạo mới
  postBumpCreatedCampaignIdsByAccount?: Record<string, number> // account_id -> campaign comment-post đã tạo
  postBumpRotationIndex?: number           // Con trỏ chia đều target qua nhiều bài post
  // Nhắn tin bạn bè / nhắn tin UID & kết bạn
  enableMessage?: boolean                  // Gửi tin nhắn
  enableAddFriend?: boolean                // Kết bạn (facebook_message_uid, zalo_message_phone, zalo_message_group_member, zalo_message_remarketing_customer, zalo_message_friend_recommendation)
  useSuggestedFriends?: boolean            // facebook_message_uid: lấy UID từ đề xuất bạn bè Facebook
  suggestedFriendsCount?: number           // Số lượng đề xuất bạn bè cần lấy
  // Zalo - Nhắn tin, kết bạn đến SĐT
  friendRequestMessage?: string
  zaloMessageSendMode?: 'normal' | 'share'
  enableZaloTag?: boolean
  zaloTagId?: number | string | null
  zaloTagName?: string | null
  enableAkaBizTag?: boolean
  akaBizTagIds?: number[]
  akaBizTagNames?: string[]
  enableZaloAlias?: boolean
  zaloAliasTemplate?: string
  zaloFriendTargetMode?: 'selected' | 'all_friends' | 'tagged_friends'
  zaloFriendSourceTagIds?: Array<number | string>
  zaloFriendSourceTagNames?: string[]
  zaloFriendDataMaterializedAt?: string | null
  zaloFriendMaterializedCount?: number
  zaloFriendBlocklistEnabled?: boolean
  zaloFriendBlocklistId?: number | null
  zaloFriendBlocklistName?: string | null
  zaloBirthdayDataMaterializedDate?: string | null
  zaloBirthdayMaterializedCount?: number
  zaloFriendRecommendationCount?: number
  zaloFriendRecommendationDataMaterializedAt?: string | null
  zaloFriendRecommendationMaterializedCount?: number
  zaloCancelFriendRequestLimit?: number
  zaloCancelFriendRequestDataMaterializedAt?: string | null
  zaloCancelFriendRequestMaterializedCount?: number
  zaloRealtimeTriggers?: Array<'join' | 'leave' | 'interact'>
  zaloRealtimeGroupIds?: string[]
  zaloRealtimeGroupNames?: string[]
  zaloRealtimeEndDate?: string | null
  pageInboxPageUid?: string                // facebook_page_to_message: Page ID dùng để mở Business Inbox
  pageInboxPageName?: string               // facebook_page_to_message: tên page hiển thị/log
  // Đăng bài lên trang cá nhân — tuỳ chọn nguồn
  copyContentFromSource?: boolean          // Copy nội dung gần nhất từ link nguồn và nối thêm vào nội dung nhập
  includeSourceImages?: boolean            // Lấy kèm hình ảnh từ link nguồn (đi kèm copyContentFromSource)
  rewriteSourceContentWithAI?: boolean     // Dùng prompt AI để edit riêng phần nội dung copy từ nguồn
  sourceContentAiPrompt?: string           // Prompt AI, dùng [content] để thay bằng nội dung copy được
  postAsReels?: boolean                    // Đăng video dưới dạng Reels thay vì post thường
  sourceLinks?: string                     // Danh sách uid/link nguồn, phẩy ngăn cách (page, profile, group, post)
  sourceLinkIndex?: number                 // Con trỏ rotation qua danh sách sourceLinks (tăng mỗi lần chạy)
  // Đăng bài fanpage
  pagePostMode?: 'api' | 'ui'              // V1 chạy Graph API; UI mode để dành phase sau
  // Tìm kiếm data trong group
  isFindPhone?: boolean
  isFindLinkGroupZalo?: boolean
  isFindUid?: boolean
  isFindPostLink?: boolean
  isFindFacebookGroup?: boolean
  isFindInPost?: boolean
  sortTypePost?: 'most_relevant' | 'recent_activity' | 'new_posts'
  countPostFindData?: number
  isFindInComment?: boolean
  sortTypeComment?: 'most_relevant' | 'all_comments' | 'newest'
  countCommentFindData?: number
  isFindNewInteractors?: boolean
  isFindInGroupMembers?: boolean
  countGroupMemberFindData?: number
  findDataGoalModeEnabled?: boolean
  findDataGoalPriority?: 'phone' | 'zalo_group_link' | 'facebook_uid' | 'post_link' | 'facebook_group'
  findDataGoalDailyLimit?: number
  findDataRerunEnabled?: boolean
  findDataRerunAfterHours?: number
  multiDailyTimeSlotsEnabled?: boolean // Profile/page/Zalo friend/group: chạy nhiều khung giờ trong cùng ngày
  multiDailyTimeSlots?: string         // Danh sách HH:mm, cách nhau bởi dấu phẩy
  isFindPostByKeywords?: boolean
  postKeywords?: string
  isFindPostByContentAI?: boolean
  postContentAI?: string
  isFindCommentByKeywords?: boolean
  commentKeywords?: string
  isFindCommentByContentAI?: boolean
  commentContentAI?: string
  findUidTargetCampaignIds?: number[]          // Khi tìm UID, tự thêm UID vào các campaign facebook_message_uid đã chọn
  findPostLinkTargetCampaignIds?: number[]     // Khi tìm link bài post, tự thêm link vào campaign comment seeding bài post đã chọn
  findPhoneSmsTargetCampaignIds?: number[]       // Khi tìm SĐT, đẩy sang campaign akaBiz Sms đã chọn
  findPhoneZaloWebTargetCampaignIds?: number[]   // Khi tìm SĐT, đẩy sang campaign akaBiz Zalo Web đã chọn
  findPhoneZaloMessagePhoneTargetCampaignIds?: number[] // Khi tìm SĐT, đẩy sang campaign Zalo phone nội bộ đã chọn
  findZaloGroupLinkWebTargetCampaignIds?: number[] // Khi tìm link group Zalo, đẩy sang campaign akaBiz Zalo Web đã chọn
  findZaloGroupLinkJoinTargetCampaignIds?: number[] // Khi tìm link group Zalo, đẩy sang campaign Zalo tham gia group nội bộ đã chọn
  findPhoneAkaBizDesktopTargetCampaignIds?: number[] // Khi tìm SĐT, đẩy sang campaign akaBiz Desktop đã chọn
  findZaloGroupLinkAkaBizDesktopTargetCampaignIds?: number[] // Khi tìm link group Zalo, đẩy sang campaign akaBiz Desktop đã chọn
  // Tìm kiếm data bằng Facebook Search — UI/config phase
  countSearchPostFindData?: number
  countSearchGroupFindData?: number
  searchPostRecentOnly?: boolean
  searchPostSeenOnly?: boolean
  searchPostDateFilter?: 'all' | 'today' | 'this_week' | 'this_month'
  searchPostAuthorFilter?: 'all' | 'you' | 'friends' | 'groups_pages'
  searchPostTaggedLocation?: 'all' | 'near_me'
  searchGroupCity?: string
  searchGroupNearMe?: boolean
  searchGroupPublicOnly?: boolean
  searchGroupMineOnly?: boolean
  minSearchGroupMembers?: number
  minSearchGroupPostsPerDay?: number
  findFacebookGroupPostTargetCampaignIds?: number[] // Khi tìm group Facebook, đẩy sang campaign đăng bài group
  findFacebookGroupCommentTargetCampaignIds?: number[] // Khi tìm group Facebook, đẩy sang campaign comment seeding group/page/profile
  findFacebookGroupJoinTargetCampaignIds?: number[] // Khi tìm group Facebook, đẩy sang campaign tham gia group
}

export interface Campaign {
  id: number
  name: string
  actionId: string
  accountId: number
  status: string
  schedule?: string
  originalSchedule?: string | null
  scheduleType?: 'daily' | 'weekly' | 'monthly'
  scheduleEndDate?: string | null
  dailyStopTime?: string | null     // HH:mm / HH:mm:ss, Asia/Ho_Chi_Minh; null = no daily cutoff
  scheduleDays?: string          // comma-separated days of month e.g. "5,10,19,25"
  scheduleWeekDays?: string      // comma-separated weekday numbers e.g. "2,3,5" (2=Mon..8=Sun)
  continueNextDay?: boolean      // daily: continue at scheduled time next day if not finished
  refreshData?: boolean          // weekly/monthly: reset data to pending when all done
  log: string
  note?: string | null
  content?: string
  extraSettings?: CampaignExtraSettings
  images?: CampaignMediaInput[]  // legacy file paths/data URIs or media snapshots
  isDelete: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
  completedAt?: string | null
  lastRunAt?: string | null
  inputDataCompletedCount?: number
  inputDataTotalCount?: number
  // Joined fields
  actionName?: string
  accountName?: string
}

export const CAMPAIGN_STATUSES = ['chờ xử lý', 'đang chạy', 'tạm dừng', 'hoàn thành'] as const
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number]

// Status enum cho data layer (campaign_inputs / campaign_input_data):
//   - campaign_inputs: 'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành' | 'lỗi'
//     ('lỗi' để flag input không scrape được — admin re-trigger)
//   - campaign_input_data: 'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành'
//     (lỗi action-level đã track ở campaign_details; khi run fail set 'hoàn thành' + note=errMsg)
export type CampaignInputStatus = 'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành' | 'lỗi'

// Pool nguyên liệu thô (e.g. danh sách group để scrape members → campaign_input_data)
export interface CampaignInput {
  id: number
  campaignId: number
  name?: string
  phone?: string
  uid?: string
  email?: string
  status: CampaignInputStatus
  note?: string
  schedule?: string
  dateAction?: string
  isDelete: boolean
  createdAt?: string
}

// Việc-cần-làm thực thi trong campaign loop
export interface CampaignInputData {
  id: number
  campaignId: number
  inputId?: number | null    // nullable: NULL = user nhập trực tiếp; số = sinh từ campaign_inputs (e.g. member của group)
  name?: string
  phone?: string
  uid?: string
  email?: string
  info1?: string
  info2?: string
  info3?: string
  info4?: string
  info5?: string
  status: CampaignInputStatus
  note?: string
  schedule?: string
  dateAction?: string
  isDelete: boolean
  createdAt?: string
}

export type CampaignInputDataRequirementField = 'name' | 'phone' | 'uid' | 'email'

export interface CampaignInputDataRequirement {
  field: CampaignInputDataRequirementField
  label: string
}

const CAMPAIGN_INPUT_DATA_REQUIREMENTS: Record<string, CampaignInputDataRequirement> = {
  facebook_group_post: { field: 'uid', label: 'group URL' },
  facebook_join_group: { field: 'uid', label: 'group URL/UID' },
  facebook_page_post: { field: 'uid', label: 'Page ID' },
  facebook_message_friend: { field: 'uid', label: 'UID/link bạn bè' },
  facebook_message_uid: { field: 'uid', label: 'UID/link profile' },
  facebook_page_to_message: { field: 'uid', label: 'PSID khách inbox Page' },
  facebook_find_data_group: { field: 'uid', label: 'group URL' },
  facebook_find_data_search: { field: 'uid', label: 'từ khóa' },
  facebook_comment_seeding: { field: 'uid', label: 'group/page/profile' },
  facebook_comment_seeding_post: { field: 'uid', label: 'link bài post' },
  zalo_message_phone: { field: 'phone', label: 'SĐT Zalo' },
  zalo_message_friend: { field: 'uid', label: 'UID bạn bè Zalo' },
  zalo_message_group_member: { field: 'uid', label: 'UID thành viên group Zalo' },
  zalo_message_group_realtime: { field: 'uid', label: 'UID thành viên group Zalo theo thời gian thực' },
  zalo_message_remarketing_customer: { field: 'uid', label: 'UID khách hàng Zalo đã từng gửi tin' },
  zalo_message_group: { field: 'uid', label: 'ID group Zalo' },
  zalo_join_group_link: { field: 'uid', label: 'Link group Zalo' },
  zalo_cancel_sent_friend_request: { field: 'uid', label: 'UID lời mời kết bạn Zalo đã gửi' },
  email_send: { field: 'email', label: 'email người nhận' }
}

export const normalizeEmailInputDataValue = (value: unknown): string => String(value ?? '').trim()

export const isValidEmailInputDataValue = (value: unknown): boolean => {
  const email = normalizeEmailInputDataValue(value)
  if (!email || email.length > 254 || /\s/.test(email)) return false
  const parts = email.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (!local || !domain || local.length > 64 || domain.length > 253) return false
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false
  const labels = domain.split('.')
  if (labels.length < 2) return false
  return labels.every(label => (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ))
}

export const getCampaignInputDataRequirement = (actionId?: string | null): CampaignInputDataRequirement | null => {
  if (!actionId) return null
  return CAMPAIGN_INPUT_DATA_REQUIREMENTS[actionId] || null
}

export const isCampaignInputDataValidForAction = (
  row: Partial<CampaignInputData>,
  actionId?: string | null
): boolean => {
  const requirement = getCampaignInputDataRequirement(actionId)
  if (!requirement) return false
  const value = String(row[requirement.field] || '').trim()
  if (actionId === 'email_send') return isValidEmailInputDataValue(value)
  return value.length > 0
}

export interface BulkUpdateCampaignInputDataStatusResult {
  updatedCount: number
  skippedCount: number
}

export interface AddCampaignInputDataToCampaignRequest {
  sourceCampaignId: number
  targetCampaignIds: number[]
  sourceInputDataIds: number[]
  campaignSchedule: string
  campaignStatus: Extract<CampaignStatus, 'chờ xử lý' | 'tạm dừng'>
}

export interface AddCampaignInputDataToCampaignTargetResult {
  campaignId: number
  campaignName: string
  actionId: string
  insertedCount: number
  skippedInvalidCount: number
  skippedRunning: boolean
  error?: string
}

export interface AddCampaignInputDataToCampaignResult {
  totalInsertedCount: number
  totalSkippedInvalidCount: number
  targets: AddCampaignInputDataToCampaignTargetResult[]
}

// Status cho campaign_details là open-ended để Zalo có thể lưu trạng thái như
// 'không tồn tại', 'đã là bạn bè'. Facebook hiện vẫn dùng 'thành công' |
// 'thất bại' | 'lỗi'.
export type CampaignDetailStatus = string

export interface CampaignDetail {
  id: number
  inputDataId?: number | null
  campaignId: number
  accountId?: number
  actionCode?: string | null
  actionName: string
  status: CampaignDetailStatus
  errorCode?: string | null
  log?: string
  data?: Record<string, unknown>
  countsTowardLimit?: boolean | null
  postUrl?: string               // URL of the post this action is related to (e.g. just-published post, commented post)
  isDelete: boolean
  createdAt?: string
}

export type CreateCampaignDetailInput = Partial<CampaignDetail> & {
  /**
   * Optional counter override for platforms with open-ended detail statuses.
   * Omit to keep the legacy Facebook rule: count 'thành công' and 'thất bại'.
   */
  shouldCountAction?: boolean
}

export interface CampaignRunEvent {
  id: number
  campaignId?: number | null
  campaignActionId?: string | null
  campaignInputId?: number | null
  campaignInputDataId?: number | null
  accountId?: number | null
  runId?: number | null
  runStepId?: number | null
  nodeId?: string | null
  blockId?: number | null
  blockName?: string | null
  sequenceNo?: number | null
  eventType: string
  eventName?: string | null
  targetType?: string | null
  status?: string | null
  isUserVisible: boolean
  xpath?: string | null
  cssSelector?: string | null
  elementCount?: number | null
  itemIndex?: number | null
  targetUrl?: string | null
  message?: string | null
  extractedData: Record<string, unknown>
  debugData: Record<string, unknown>
  createdAt?: string
}

export interface CampaignRunEventInput {
  campaignId?: number | null
  campaignActionId?: string | null
  campaignInputId?: number | null
  campaignInputDataId?: number | null
  accountId?: number | null
  runId?: number | null
  runStepId?: number | null
  nodeId?: string | null
  blockId?: number | null
  blockName?: string | null
  sequenceNo?: number | null
  eventType?: string | null
  eventName?: string | null
  targetType?: string | null
  status?: string | null
  isUserVisible?: boolean | null
  xpath?: string | null
  cssSelector?: string | null
  elementCount?: number | null
  itemIndex?: number | null
  targetUrl?: string | null
  message?: string | null
  extractedData?: Record<string, unknown> | null
  debugData?: Record<string, unknown> | null
}

export interface EmailCampaignLinkTrackingSummary {
  url: string
  emailCount: number
  linkCount: number
  clickCount: number
  firstClickedAt?: string | null
  lastClickedAt?: string | null
  firstTrackedAt?: string | null
  lastTrackedAt?: string | null
}

export interface CampaignRunEventListOptions {
  userVisibleOnly?: boolean
  eventTypes?: string[]
  limit?: number
}

export interface CampaignLogAction {
  type: 'block_screenshot_preview'
  filePath: string
  title?: string
}

export interface CampaignLogEntry {
  timestamp: string
  message: string
  action?: CampaignLogAction
}

export interface CampaignRelationActionBreakdown {
  actionName: string
  status: CampaignDetailStatus
  count: number
}

export interface CampaignRelationSummary {
  campaignId: number
  campaignName: string
  actionId: string
  actionName?: string
  accountId?: number
  accountName?: string
  pendingInputCount: number
  successCount: number
  failureCount: number
  errorCount: number
  successBreakdown: CampaignRelationActionBreakdown[]
  failureBreakdown: CampaignRelationActionBreakdown[]
}

// ============================================
// Reports
// ============================================

export interface AccountActionReportQuery {
  flatformType?: string
  accountIds?: number[]
  actionCodes?: string[]
  startIso: string
  endIso: string
}

export interface AccountActionReportAccount {
  id: number
  name: string
  flatformType: string
  accountGroupId?: number | null
  accountGroupName?: string | null
}

export interface AccountActionReportAction {
  code: string
  name: string
  flatformType: string
}

export interface AccountActionReportCell {
  successCount: number
  failureCount: number
  pendingCount: number
}

export interface AccountActionReportRow {
  account: AccountActionReportAccount
  countsByActionCode: Record<string, AccountActionReportCell>
}

export interface AccountActionReportResult {
  query: AccountActionReportQuery
  actions: AccountActionReportAction[]
  rows: AccountActionReportRow[]
  generatedAt: string
}

export type AccountActionReportStatusBucket = 'pending' | 'success' | 'failure'

export interface AccountActionReportDetailQuery {
  flatformType?: string
  accountId: number
  actionCode: string
  statusBucket: AccountActionReportStatusBucket
  startIso: string
  endIso: string
  page?: number
  pageSize?: number
  exportAll?: boolean
}

export interface AccountActionReportDetailRow {
  id: string
  source: 'campaign_detail' | 'campaign_input_data'
  occurredAt?: string | null
  accountId: number
  accountName: string
  campaignId?: number | null
  campaignName?: string | null
  actionCode: string
  actionName: string
  targetName?: string | null
  targetUid?: string | null
  targetPhone?: string | null
  targetEmail?: string | null
  status: CampaignDetailStatus | 'chờ xử lý'
  detailText?: string | null
  postUrl?: string | null
}

export interface AccountActionReportDetailResult {
  query: AccountActionReportDetailQuery
  rows: AccountActionReportDetailRow[]
  total: number
  page: number
  pageSize: number
  generatedAt: string
  accountName: string
  actionName: string
  statusLabel: string
}

export interface ZaloLabelOption {
  id: number
  text: string
  textKey?: string
  color?: string
  emoji?: string
  conversations?: string[]
}

// ============================================
// Account Contact Types
// ============================================

export type ContactType = 'person' | 'group' | 'page' | 'page_inbox_customer' | 'zalo_tag'
export type ContactStatusFilter = 'active' | 'inactive' | 'all'

export type PageInboxPhoneFilter = 'all' | 'has_phone' | 'no_phone'
export type PageInboxMessageFilterMode = 'all' | 'contain_all' | 'contain_any' | 'not_contain_all' | 'not_contain_any'

export interface PageInboxContactListQuery {
  pageUid?: string
  search?: string
  phoneFilter?: PageInboxPhoneFilter
  dateFrom?: string
  dateTo?: string
  messageFilterMode?: PageInboxMessageFilterMode
  messageKeywords?: string
  ids?: number[]
  excludeIds?: number[]
  offset?: number
  limit?: number
}

export interface AccountContactListQuery {
  contactType?: ContactType
  statusFilter?: ContactStatusFilter
  search?: string
  sourcePostUrl?: string
  zaloTagIds?: Array<number | string>
  zaloNoTag?: boolean
  akaBizTagIds?: number[]
  akaBizNoTag?: boolean
  ids?: number[]
  excludeIds?: number[]
  offset?: number
  limit?: number
}

export interface ContactListResult {
  contacts: AutoAccountContact[]
  total: number
}

export interface ZaloGroupMemberContactListQuery extends AccountContactListQuery {
  zaloGroupId?: string
}

export interface ZaloRemarketingCustomerListQuery {
  campaignActionId?: string
  campaignActionIds?: string[]
  dateFrom?: string
  dateTo?: string
  search?: string
  zaloTagIds?: Array<number | string>
  zaloNoTag?: boolean
  akaBizTagIds?: number[]
  akaBizNoTag?: boolean
  ids?: number[]
  excludeIds?: number[]
  offset?: number
  limit?: number
}

export interface ContactLoadResult {
  success: boolean
  count: number
  error?: string
  stopped?: boolean
  runKey?: string
  sourcePostUrl?: string
  maxCommenters?: number
  zaloGroupId?: string
  zaloGroupName?: string
  usedProxy?: boolean
}

export type ZaloGroupMemberScanMode = 'joined_group' | 'group_link'

export interface ZaloGroupMemberScanRequest {
  mode: ZaloGroupMemberScanMode
  zaloGroupId?: string
  groupName?: string
  link?: string
}

export interface ContactLoadCompleted {
  accountId: number
  contactType: ContactType
  result: ContactLoadResult
  runKey?: string
}

export interface ContactLoadProgress {
  accountId?: number
  contactType?: ContactType
  runKey?: string
  message: string
}

export interface AutoAccountContact {
  id: number
  accountId: number
  contactType: ContactType
  name: string
  uid?: string
  url?: string
  extraData?: Record<string, unknown>
  akaBizTagIds?: number[]
  zaloUserId?: number | null
  zaloGroupId?: number | null
  isFriend?: boolean
  requiresPostApproval?: boolean | null
  isJoined?: boolean
  isDelete: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export type ContactGroupPurpose = 'data_group' | 'zalo_friend_blocklist'

export interface AutoAccountContactGroup {
  id: number
  accountId: number
  contactType: ContactType
  purpose: ContactGroupPurpose
  name: string
  contactCount?: number
  isDelete: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export interface ContactGroupMutationResult {
  success: boolean
  count: number
}

export interface AkaBizContactTag {
  id: number
  name: string
  contactCount?: number
  isDelete: boolean
  staffId?: number
  organizationId?: number | null
  createdAt?: string
  updatedAt?: string
}

export interface ContentTemplate {
  id: number
  name: string
  content: string
  isDelete: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export interface EmailNotificationSettings {
  id?: number
  staffId?: number
  organizationId?: number | null
  isEnabled: boolean
  recipientEmails: string[]
  notifyCampaignCompleted: boolean
  dailyReportEnabled: boolean
  dailyReportTime: string
  isDelete?: boolean
  createdAt?: string
  updatedAt?: string
}

// ============================================
// Auth Types
// ============================================

export type AuthEntitlementFeature = 'facebookCore' | 'facebookFanpage' | 'email' | 'zalo'

export type AuthDailySendLimits = Record<AuthEntitlementFeature, number | null>
export type AuthAccountLimits = Record<AuthEntitlementFeature, number | null>

export interface AuthEntitlements {
  facebookCore: boolean
  facebookFanpage: boolean
  email: boolean
  zalo: boolean
  dailySendLimits: AuthDailySendLimits
  accountLimits: AuthAccountLimits
}

export interface AuthSessionExpiredPayload {
  message: string
}

export interface AuthAccountProduct {
  feature: AuthEntitlementFeature | null
  productId: number | null
  productName: string
  packageName: string
  packageType: string | null
  displayName: string
  displayOrder: number
  expirationDate: string | null
  maxAccounts: number | null
  isActive: boolean
}

export interface AuthUser {
  staffId: number
  organizationId: number
  name: string
  username: string
  phone?: string | null
  organizationName: string
  isAdminAkabiz: boolean
  useTestWorkflow: boolean
  entitlements: AuthEntitlements
  accountProducts: AuthAccountProduct[]
  deviceLabel?: string | null
  devicePlatform?: string | null
  deviceBoundAt?: string | null
  deviceLastSeenAt?: string | null
}

export interface LoginPreferences {
  rememberLogin: boolean
  autoLogin: boolean
  startupEnabled: boolean
}

export interface SavedLoginCredentials {
  username: string
  password: string
}

export interface AuthBootstrapResult {
  user: AuthUser | null
  loginOptions: LoginPreferences
  savedCredentials: SavedLoginCredentials | null
  errorMessage?: string | null
}

export interface DeviceLockResetResult {
  success: boolean
}

export interface StartupSettingResult {
  enabled: boolean
}

export interface AiRewriteContentRequest {
  content: string
}

export interface AiWriteMultiOtherContentRequest {
  content: string
  countContent: number
}

export interface SystemSetting {
  id: number
  key: string
  value?: string | null
  description?: string | null
  isSecret: boolean
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export type CampaignAssistantMessageRole = 'user' | 'assistant'

export interface CampaignAssistantMessage {
  role: CampaignAssistantMessageRole
  content: string
  timestamp?: number
}

export interface CampaignAssistantContextSnapshot {
  snapshotAt: string
  campaign: Record<string, unknown>
  campaignSummary: Record<string, unknown>
  account: Record<string, unknown> | null
  action: Record<string, unknown> | null
  inputSummary: Record<string, unknown>
  inputData: Array<Record<string, unknown>>
  runResults: Array<Record<string, unknown>>
  progressLogs: Array<Record<string, unknown>>
  bugLogs: {
    campaignErrorDetails: Array<Record<string, unknown>>
    accountErrorStates: Array<Record<string, unknown>>
    runTraces: Array<Record<string, unknown>>
  }
  accountActionLimits: Array<Record<string, unknown>>
  ruleDiagnosis: Record<string, unknown>
  limits: {
    maxContextRows: number
    maxMessages: number
  }
}

export interface CampaignAssistantContextResult {
  contextSnapshot: CampaignAssistantContextSnapshot
}

export interface CampaignAssistantChatRequest {
  campaignId: number
  contextSnapshot: CampaignAssistantContextSnapshot
  messages: CampaignAssistantMessage[]
}

export interface CampaignAssistantChatResponse {
  content: string
  provider: string
  model: string
  generatedAt: string
  usage?: unknown
}

export type CampaignImportPlatform = 'facebook' | 'zalo' | 'email'

export interface CampaignImportDataRow {
  name?: string
  phone?: string
  uid?: string
  email?: string
  info1?: string
  info2?: string
  info3?: string
  info4?: string
  info5?: string
}

export interface CampaignImportImageRequest {
  imageDataUrl: string
  platform: CampaignImportPlatform
  actionId?: string
}

export interface CampaignImportSheetRequest {
  linkSheet: string
  platform: CampaignImportPlatform
  actionId?: string
}

export type AkaBizIntegrationKind = 'sms' | 'zaloWeb' | 'akaBizDesktop'
export type AkaBizCampaignListKind = 'sms' | 'zaloPhone' | 'zaloGroupLink' | 'desktopZaloPhone' | 'desktopZaloGroupLink'

export interface AkaBizStaffBasic {
  id: number
  staffId?: number
  name: string | null
  username: string
  installPath?: string | null
  dbPath?: string | null
}

export interface AkaBizIntegrationInfo extends AkaBizStaffBasic {
  staffId: number
  integratedAt: string
}

export interface AkaBizIntegrations {
  sms?: AkaBizIntegrationInfo | null
  zaloWeb?: AkaBizIntegrationInfo | null
  akaBizDesktop?: AkaBizIntegrationInfo | null
}

export interface AkaBizCampaignListItem {
  id: number
  name: string | null
  shopId: number
  shopName: string | null
  campaignActionId: string | null
  schedule?: string | null
  status?: string | null
}

export interface AkaBizDesktopPathValidationResult {
  installPath: string
  dbPath: string
}

// ============================================
// IPC Event Types
// ============================================

export const IPC_EVENTS = {
  // Theme
  THEME_CHANGE: 'theme:change',

  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_BOOTSTRAP: 'auth:bootstrap',
  AUTH_REVOKE_REMEMBERED_LOGIN: 'auth:revoke-remembered-login',
  AUTH_UPDATE_LOGIN_PREFERENCES: 'auth:update-login-preferences',
  AUTH_RECOVER_DEVICE_CREDENTIALS: 'auth:recover-device-credentials',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_ME: 'auth:me',
  AUTH_RESET_DEVICE_LOCK: 'auth:reset-device-lock',
  AUTH_CHANGE_PASSWORD: 'auth:change-password',
  AUTH_UPDATE_USE_TEST_WORKFLOW: 'auth:update-use-test-workflow',
  AUTH_SESSION_EXPIRED: 'auth:session-expired',
  AUTH_USER_UPDATED: 'auth:user-updated',

  // App
  APP_GET_STARTUP_SETTING: 'app:get-startup-setting',
  APP_SET_STARTUP_SETTING: 'app:set-startup-setting',
  APP_GET_VERSION: 'app:get-version',
  APP_READ_BLOCK_SCREENSHOT: 'app:read-block-screenshot',
  APP_READ_CAMPAIGN_PREVIEW_FILE: 'app:read-campaign-preview-file',

  // AI content tools
  AI_REWRITE_CONTENT: 'ai:rewrite-content',
  AI_WRITE_MULTI_OTHER_CONTENT: 'ai:write-multi-other-content',
  AI_CAMPAIGN_ASSISTANT_CONTEXT: 'ai:campaign-assistant-context',
  AI_CAMPAIGN_ASSISTANT_CHAT: 'ai:campaign-assistant-chat',

  // Campaign data import helpers
  CAMPAIGN_IMPORT_EXTRACT_IMAGE: 'campaign-import:extract-image',
  CAMPAIGN_IMPORT_LOAD_SHEET: 'campaign-import:load-sheet',

  // akaBiz external integrations
  AKABIZ_INTEGRATIONS_GET: 'akabiz:integrations:get',
  AKABIZ_INTEGRATION_LOOKUP: 'akabiz:integration:lookup',
  AKABIZ_INTEGRATION_SAVE: 'akabiz:integration:save',
  AKABIZ_EXTERNAL_CAMPAIGNS_LIST: 'akabiz:external-campaigns:list',
  AKABIZ_DESKTOP_INSTALL_PATH_SELECT: 'akabiz:desktop-install-path:select',
  AKABIZ_DESKTOP_INSTALL_PATH_VALIDATE: 'akabiz:desktop-install-path:validate',

  // Database Auto Accounts
  DB_LIST_ACCOUNTS: 'db:list-accounts',
  DB_CREATE_ACCOUNT: 'db:create-account',
  DB_UPDATE_ACCOUNT: 'db:update-account',
  DB_DELETE_ACCOUNT: 'db:delete-account',
  DB_LIST_ACCOUNT_ACTIONS: 'db:list-account-actions',
  DB_LIST_ACCOUNT_GROUPS: 'db:list-account-groups',
  DB_CREATE_ACCOUNT_GROUP: 'db:create-account-group',
  DB_UPDATE_ACCOUNT_GROUP: 'db:update-account-group',
  DB_DELETE_ACCOUNT_GROUP: 'db:delete-account-group',
  DB_LIST_PROXIES: 'db:list-proxies',
  DB_CREATE_PROXY: 'db:create-proxy',
  DB_UPDATE_PROXY: 'db:update-proxy',
  DB_DELETE_PROXY: 'db:delete-proxy',
  PROXY_TEST: 'proxy:test',
  ACCOUNT_PREPARE_BROWSER_SESSION: 'account:prepare-browser-session',

  // Database Campaign Actions
  DB_LIST_CAMPAIGN_ACTIONS: 'db:list-campaign-actions',
  DB_GET_ALL_CAMPAIGN_ACTIONS: 'db:get-all-campaign-actions',
  DB_CREATE_CAMPAIGN_ACTION: 'db:create-campaign-action',
  DB_UPDATE_CAMPAIGN_ACTION: 'db:update-campaign-action',
  DB_DELETE_CAMPAIGN_ACTION: 'db:delete-campaign-action',

  // Database Campaigns
  DB_LIST_CAMPAIGNS: 'db:list-campaigns',
  DB_CREATE_CAMPAIGN: 'db:create-campaign',
  DB_UPDATE_CAMPAIGN: 'db:update-campaign',
  DB_DELETE_CAMPAIGN: 'db:delete-campaign',
  DB_CLONE_CAMPAIGN: 'db:clone-campaign',

  // Database Campaign Inputs (pool nguyên liệu thô — e.g. group list)
  DB_LIST_CAMPAIGN_INPUTS: 'db:list-campaign-inputs',
  DB_CREATE_CAMPAIGN_INPUT: 'db:create-campaign-input',
  DB_UPDATE_CAMPAIGN_INPUT: 'db:update-campaign-input',
  DB_DELETE_CAMPAIGN_INPUT: 'db:delete-campaign-input',

  // Database Campaign Input Data (việc-cần-làm thực thi)
  DB_LIST_CAMPAIGN_INPUT_DATA: 'db:list-campaign-input-data',
  DB_CREATE_CAMPAIGN_INPUT_DATA: 'db:create-campaign-input-data',
  DB_UPDATE_CAMPAIGN_INPUT_DATA: 'db:update-campaign-input-data',
  DB_BULK_UPDATE_CAMPAIGN_INPUT_DATA_STATUS: 'db:bulk-update-campaign-input-data-status',
  DB_ADD_CAMPAIGN_INPUT_DATA_TO_CAMPAIGNS: 'db:add-campaign-input-data-to-campaigns',
  DB_DELETE_CAMPAIGN_INPUT_DATA: 'db:delete-campaign-input-data',
  DB_LIST_CAMPAIGN_RELATION_SUMMARIES: 'db:list-campaign-relation-summaries',

  // Database Campaign Details (per-milestone log)
  DB_LIST_CAMPAIGN_DETAILS_BY_INPUT_DATA: 'db:list-campaign-details',
  DB_LIST_CAMPAIGN_DETAILS_BY_CAMPAIGN: 'db:list-campaign-details-by-campaign',
  DB_LIST_EMAIL_CAMPAIGN_LINK_TRACKINGS: 'db:list-email-campaign-link-trackings',
  DB_CREATE_CAMPAIGN_DETAIL: 'db:create-campaign-detail',
  DB_DELETE_CAMPAIGN_DETAIL: 'db:delete-campaign-detail',
  DB_LIST_CAMPAIGN_RUN_EVENTS_BY_CAMPAIGN: 'db:list-campaign-run-events-by-campaign',

  // Database Content Templates
  DB_LIST_CONTENT_TEMPLATES: 'db:list-content-templates',
  DB_CREATE_CONTENT_TEMPLATE: 'db:create-content-template',
  DB_UPDATE_CONTENT_TEMPLATE: 'db:update-content-template',
  DB_DELETE_CONTENT_TEMPLATE: 'db:delete-content-template',

  // Media Library
  MEDIA_STORAGE_SETTINGS_GET: 'media:storage-settings:get',
  MEDIA_STORAGE_SETTINGS_SAVE: 'media:storage-settings:save',
  MEDIA_STORAGE_SETTINGS_TEST: 'media:storage-settings:test',
  MEDIA_FILES_LIST: 'media:files:list',
  MEDIA_FILES_UPLOAD: 'media:files:upload',
  MEDIA_FILES_DELETE: 'media:files:delete',

  // Email Notifications
  EMAIL_NOTIFICATION_SETTINGS_GET: 'email-notification-settings:get',
  EMAIL_NOTIFICATION_SETTINGS_SAVE: 'email-notification-settings:save',

  // Reports
  REPORT_ACCOUNT_ACTION_SUMMARY: 'report:account-action-summary',
  REPORT_ACCOUNT_ACTION_DETAILS: 'report:account-action-details',

  // Webview registration (embedded browser tabs)
  WEBVIEW_REGISTER: 'webview:register',
  WEBVIEW_UNREGISTER: 'webview:unregister',
  WEBVIEW_STATUS: 'webview:status',

  // Campaign Log (real-time)
  CAMPAIGN_LOG: 'campaign:log',

  // Campaign Status (real-time: main → renderer whenever a campaign row changes)
  CAMPAIGN_STATUS_UPDATED: 'campaign:status-updated',

  // Campaign browser selection/preview (main → renderer when an automation run starts)
  CAMPAIGN_BROWSER_SELECT: 'campaign:browser-select',
  CAMPAIGN_BROWSER_PREVIEW: 'campaign:browser-preview',

  // Account Actions
  ACCOUNT_CHECK_FB_LOGIN: 'account:check-fb-login',
  ACCOUNT_RELOAD_PAGE: 'account:reload-page',
  ACCOUNT_STATUS_UPDATED: 'account:status-updated',
  ACCOUNT_ACTION_OVERVIEW: 'account:action-overview',
  ACCOUNT_ACTION_ENABLE_NOW: 'account:action-enable-now',
  ZALO_LOGIN_QR_START: 'zalo:login-qr-start',
  ZALO_LOGIN_QR_CANCEL: 'zalo:login-qr-cancel',
  ZALO_LOGIN_QR_EVENT: 'zalo:login-qr-event',
  ZALO_CHECK_SESSION: 'zalo:check-session',
  ZALO_LOGOUT: 'zalo:logout',
  ZALO_LIST_LABELS: 'zalo:list-labels',
  ZALO_SYNC_LABELS: 'zalo:sync-labels',
  EMAIL_GET_CONFIG: 'email:get-config',
  EMAIL_SAVE_CONFIG: 'email:save-config',
  EMAIL_VERIFY: 'email:verify',
  EMAIL_LOGOUT: 'email:logout',

  // Contacts (Load data)
  CONTACTS_LOAD_FRIENDS: 'contacts:load-friends',
  CONTACTS_LOAD_GROUPS: 'contacts:load-groups',
  CONTACTS_LOAD_PAGES: 'contacts:load-pages',
  CONTACTS_LOAD_POST_COMMENTERS: 'contacts:load-post-commenters',
  CONTACTS_LOAD_PAGE_INBOX_CUSTOMERS: 'contacts:load-page-inbox-customers',
  CONTACTS_LOAD_ZALO_GROUP_MEMBERS: 'contacts:load-zalo-group-members',
  CONTACTS_LIST_PAGE_INBOX: 'contacts:list-page-inbox',
  CONTACTS_LIST_PAGED: 'contacts:list-paged',
  CONTACTS_LIST_ZALO_GROUP_MEMBERS: 'contacts:list-zalo-group-members',
  CONTACTS_LIST_ZALO_REMARKETING_CUSTOMERS: 'contacts:list-zalo-remarketing-customers',
  CONTACTS_EXPORT_PAGE_INBOX: 'contacts:export-page-inbox',
  CONTACTS_EXPORT_PAGED: 'contacts:export-paged',
  CONTACTS_EXPORT_ZALO_GROUP_MEMBERS: 'contacts:export-zalo-group-members',
  CONTACTS_EXPORT_ZALO_REMARKETING_CUSTOMERS: 'contacts:export-zalo-remarketing-customers',
  CONTACTS_CANCEL_LOAD: 'contacts:cancel-load',
  CONTACTS_LIST: 'contacts:list',
  CONTACTS_DELETE: 'contacts:delete',
  CONTACT_GROUPS_LIST: 'contacts:groups:list',
  CONTACT_GROUPS_CREATE: 'contacts:groups:create',
  CONTACT_GROUPS_UPDATE: 'contacts:groups:update',
  CONTACT_GROUPS_DELETE: 'contacts:groups:delete',
  CONTACT_GROUPS_LIST_CONTACTS: 'contacts:groups:list-contacts',
  CONTACT_GROUPS_ADD_CONTACTS: 'contacts:groups:add-contacts',
  CONTACT_GROUPS_REMOVE_CONTACTS: 'contacts:groups:remove-contacts',
  AKABIZ_CONTACT_TAGS_LIST: 'contacts:akabiz-tags:list',
  AKABIZ_CONTACT_TAGS_CREATE: 'contacts:akabiz-tags:create',
  AKABIZ_CONTACT_TAGS_UPDATE: 'contacts:akabiz-tags:update',
  AKABIZ_CONTACT_TAGS_DELETE: 'contacts:akabiz-tags:delete',
  ZALO_FRIEND_BLOCKLISTS_LIST: 'contacts:zalo-friend-blocklists:list',
  ZALO_FRIEND_BLOCKLISTS_CREATE: 'contacts:zalo-friend-blocklists:create',
  ZALO_FRIEND_BLOCKLISTS_UPDATE: 'contacts:zalo-friend-blocklists:update',
  ZALO_FRIEND_BLOCKLISTS_DELETE: 'contacts:zalo-friend-blocklists:delete',
  ZALO_FRIEND_BLOCKLISTS_LIST_FRIENDS: 'contacts:zalo-friend-blocklists:list-friends',
  ZALO_FRIEND_BLOCKLISTS_ADD_FRIENDS: 'contacts:zalo-friend-blocklists:add-friends',
  ZALO_FRIEND_BLOCKLISTS_REMOVE_FRIENDS: 'contacts:zalo-friend-blocklists:remove-friends',
  CONTACTS_PROGRESS: 'contacts:progress',
  CONTACTS_COMPLETED: 'contacts:completed',

  // Auto-update
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD_INSTALL: 'update:download-install',
  UPDATE_PROGRESS: 'update:progress',
} as const

// ============================================
// Supabase Config
// ============================================

export interface SupabaseConfig {
  url: string
  anonKey: string
}
