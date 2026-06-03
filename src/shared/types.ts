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
  isDelete: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
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

export interface CampaignAction {
  id: string         // TEXT id e.g. 'facebook_group_post'
  name: string
  flatformType: string
  isActive: boolean
  workflowId?: number       // engine v2 (BIGINT, FK auto_workflows.id)
  testWorkflowId?: number   // engine v2 test workflow (BIGINT, FK auto_workflows.id)
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
  isDailyLimit?: boolean
  retryAfterMs?: number
  currentCount?: number
  limit?: number
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
  commentImages?: string[]        // tối đa 1 ảnh cho mỗi comment
  enablePostLike?: boolean
  postsPerTarget?: number
  postKeywordFilter?: string
  keywordFilter?: string
  // Lướt newsfeed và tương tác
  newsfeedTimeMinutes?: number
  newsfeedLikeKind?: string
  newsfeedLikeLimit?: number
  newsfeedCommentKind?: string
  newsfeedCommentLimit?: number
  newsfeedCommentContent?: string
  newsfeedCommentUseAI?: boolean
  actionLimits?: CampaignActionLimitSettings // giới hạn gửi theo action_code; top-level là fallback cho campaign cũ
  imageOption?: 'none' | 'all' | 'random'
  randomImageCount?: number
  leaveGroupOnPendingApproval?: boolean   // Rời group nếu bài đang chờ duyệt (đã tham gia)
  autoJoinGroupAfterPost?: boolean         // Tự động tham gia group sau khi đăng bài thành công (chưa tham gia)
  shuffleGroupList?: boolean               // Xáo trộn danh sách group trước khi chạy chiến dịch
  skipPostIfGroupRequiresApproval?: boolean // Không đăng bài vào group đã biết cần duyệt bài; vẫn có thể kiêm comment
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
  enableAddFriend?: boolean                // Kết bạn (chỉ dùng cho facebook_message_uid)
  useSuggestedFriends?: boolean            // facebook_message_uid: lấy UID từ đề xuất bạn bè Facebook
  suggestedFriendsCount?: number           // Số lượng đề xuất bạn bè cần lấy
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
  multiDailyTimeSlotsEnabled?: boolean // Đăng bài profile/page: chạy nhiều khung giờ trong cùng ngày
  multiDailyTimeSlots?: string         // Danh sách HH:mm, cách nhau bởi dấu phẩy
  isFindByKeywords?: boolean
  keywords?: string
  isFindByContentAI?: boolean
  contentAI?: string
  findUidTargetCampaignIds?: number[]          // Khi tìm UID, tự thêm UID vào các campaign facebook_message_uid đã chọn
  findPostLinkTargetCampaignIds?: number[]     // Khi tìm link bài post, tự thêm link vào campaign comment seeding bài post đã chọn
  findPhoneSmsTargetCampaignIds?: number[]       // Khi tìm SĐT, đẩy sang campaign akaBiz Sms đã chọn
  findPhoneZaloWebTargetCampaignIds?: number[]   // Khi tìm SĐT, đẩy sang campaign akaBiz Zalo Web đã chọn
  findZaloGroupLinkWebTargetCampaignIds?: number[] // Khi tìm link group Zalo, đẩy sang campaign akaBiz Zalo Web đã chọn
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
  images?: string[]              // file paths or base64 strings
  isDelete: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
  completedAt?: string | null
  lastRunAt?: string | null
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
  status: CampaignInputStatus
  note?: string
  schedule?: string
  dateAction?: string
  isDelete: boolean
  createdAt?: string
}

// Status enum cho campaign_details (per-milestone log):
//   - 'thành công': action OK (đã post, đã comment, đã kết bạn)
//   - 'thất bại': nghiệp vụ FB từ chối (FB block message, post pending, kết bạn không gửi được)
//   - 'lỗi': exception/crash code (selector not found, timeout, network)
export type CampaignDetailStatus = 'thành công' | 'thất bại' | 'lỗi'

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
  postUrl?: string               // URL of the post this action is related to (e.g. just-published post, commented post)
  isDelete: boolean
  createdAt?: string
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

// ============================================
// Account Contact Types
// ============================================

export type ContactType = 'person' | 'group' | 'page' | 'page_inbox_customer'

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

export interface ContactListResult {
  contacts: AutoAccountContact[]
  total: number
}

export interface ContactLoadResult {
  success: boolean
  count: number
  error?: string
  stopped?: boolean
  runKey?: string
  sourcePostUrl?: string
  maxCommenters?: number
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
  isFriend?: boolean
  requiresPostApproval?: boolean | null
  isJoined?: boolean
  isDelete: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export interface AutoAccountContactGroup {
  id: number
  accountId: number
  contactType: ContactType
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

export interface AuthUser {
  staffId: number
  organizationId: number
  name: string
  username: string
  organizationName: string
  isAdminAkabiz: boolean
  useTestWorkflow: boolean
  deviceLabel?: string | null
  devicePlatform?: string | null
  deviceBoundAt?: string | null
  deviceLastSeenAt?: string | null
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
  provider: 'deepseek'
  model: string
  generatedAt: string
  usage?: unknown
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
  AUTH_LOGOUT: 'auth:logout',
  AUTH_ME: 'auth:me',
  AUTH_RESET_DEVICE_LOCK: 'auth:reset-device-lock',
  AUTH_CHANGE_PASSWORD: 'auth:change-password',
  AUTH_UPDATE_USE_TEST_WORKFLOW: 'auth:update-use-test-workflow',

  // App
  APP_GET_STARTUP_SETTING: 'app:get-startup-setting',
  APP_SET_STARTUP_SETTING: 'app:set-startup-setting',

  // AI content tools
  AI_REWRITE_CONTENT: 'ai:rewrite-content',
  AI_WRITE_MULTI_OTHER_CONTENT: 'ai:write-multi-other-content',
  AI_CAMPAIGN_ASSISTANT_CONTEXT: 'ai:campaign-assistant-context',
  AI_CAMPAIGN_ASSISTANT_CHAT: 'ai:campaign-assistant-chat',

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
  DB_DELETE_CAMPAIGN_INPUT_DATA: 'db:delete-campaign-input-data',
  DB_LIST_CAMPAIGN_RELATION_SUMMARIES: 'db:list-campaign-relation-summaries',

  // Database Campaign Details (per-milestone log)
  DB_LIST_CAMPAIGN_DETAILS_BY_INPUT_DATA: 'db:list-campaign-details',
  DB_LIST_CAMPAIGN_DETAILS_BY_CAMPAIGN: 'db:list-campaign-details-by-campaign',
  DB_CREATE_CAMPAIGN_DETAIL: 'db:create-campaign-detail',
  DB_DELETE_CAMPAIGN_DETAIL: 'db:delete-campaign-detail',

  // Database Content Templates
  DB_LIST_CONTENT_TEMPLATES: 'db:list-content-templates',
  DB_CREATE_CONTENT_TEMPLATE: 'db:create-content-template',
  DB_UPDATE_CONTENT_TEMPLATE: 'db:update-content-template',
  DB_DELETE_CONTENT_TEMPLATE: 'db:delete-content-template',

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

  // Contacts (Load data)
  CONTACTS_LOAD_FRIENDS: 'contacts:load-friends',
  CONTACTS_LOAD_GROUPS: 'contacts:load-groups',
  CONTACTS_LOAD_PAGES: 'contacts:load-pages',
  CONTACTS_LOAD_POST_COMMENTERS: 'contacts:load-post-commenters',
  CONTACTS_LOAD_PAGE_INBOX_CUSTOMERS: 'contacts:load-page-inbox-customers',
  CONTACTS_LIST_PAGE_INBOX: 'contacts:list-page-inbox',
  CONTACTS_EXPORT_PAGE_INBOX: 'contacts:export-page-inbox',
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
