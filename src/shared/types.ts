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
  enableComment?: boolean        // kiếm comment
  commentType?: 'own' | 'others' // comment vào bài mình / bài khác
  commentCount?: number          // số lượng comment (khi commentType = 'others')
  commentContent?: string        // nội dung comment
  commentImageOption?: 'none' | 'all'
  commentImages?: string[]        // tối đa 1 ảnh cho mỗi comment
  enablePostLike?: boolean
  postsPerTarget?: number
  postKeywordFilter?: string
  keywordFilter?: string
  actionLimits?: CampaignActionLimitSettings // giới hạn gửi theo action_code; top-level là fallback cho campaign cũ
  imageOption?: 'none' | 'all' | 'random'
  randomImageCount?: number
  leaveGroupOnPendingApproval?: boolean   // Rời group nếu bài đang chờ duyệt (đã tham gia)
  autoJoinGroupAfterPost?: boolean         // Tự động tham gia group sau khi đăng bài thành công (chưa tham gia)
  shuffleGroupList?: boolean               // Xáo trộn danh sách group trước khi chạy chiến dịch
  // Nhắn tin & kết bạn
  enableMessage?: boolean                  // Gửi tin nhắn
  enableAddFriend?: boolean                // Kết bạn
  // Đăng bài lên trang cá nhân — tuỳ chọn nguồn
  copyContentFromSource?: boolean          // Copy nội dung gần nhất từ link nguồn và nối thêm vào nội dung nhập
  includeSourceImages?: boolean            // Lấy kèm hình ảnh từ link nguồn (đi kèm copyContentFromSource)
  postAsReels?: boolean                    // Đăng video dưới dạng Reels thay vì post thường
  sourceLinks?: string                     // Danh sách uid/link nguồn, phẩy ngăn cách (page, profile, group, post)
  sourceLinkIndex?: number                 // Con trỏ rotation qua danh sách sourceLinks (tăng mỗi lần chạy)
  // Tìm kiếm data trong group
  isFindPhone?: boolean
  isFindLinkGroupZalo?: boolean
  isFindUid?: boolean
  isFindInPost?: boolean
  sortTypePost?: 'most_relevant' | 'recent_activity' | 'new_posts'
  countPostFindData?: number
  isFindInComment?: boolean
  sortTypeComment?: 'most_relevant' | 'all_comments' | 'newest'
  countCommentFindData?: number
  isFindByKeywords?: boolean
  keywords?: string
  isFindByContentAI?: boolean
  contentAI?: string
  findUidTargetCampaignIds?: number[]          // Khi tìm UID, tự thêm UID vào các campaign nhắn tin/kết bạn đã chọn
}

export interface Campaign {
  id: number
  name: string
  actionId: string
  accountId: number
  status: string
  schedule?: string
  scheduleType?: 'daily' | 'weekly' | 'monthly'
  scheduleEndDate?: string | null
  scheduleDays?: string          // comma-separated days of month e.g. "5,10,19,25"
  scheduleWeekDays?: string      // comma-separated weekday numbers e.g. "2,3,5" (2=Mon..8=Sun)
  continueNextDay?: boolean      // daily: continue at scheduled time next day if not finished
  refreshData?: boolean          // weekly/monthly: reset data to pending when all done
  timeSleepBetween2: number   // seconds
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
  // Joined fields
  actionName?: string
  accountName?: string
}

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

// ============================================
// Account Contact Types
// ============================================

export type ContactType = 'friend' | 'group'

export interface AutoAccountContact {
  id: number
  accountId: number
  contactType: ContactType
  name: string
  uid?: string
  url?: string
  extraData?: Record<string, unknown>
  isDelete: boolean
  staffId?: number
  organizationId?: number
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

  // Database Auto Accounts
  DB_LIST_ACCOUNTS: 'db:list-accounts',
  DB_CREATE_ACCOUNT: 'db:create-account',
  DB_UPDATE_ACCOUNT: 'db:update-account',
  DB_DELETE_ACCOUNT: 'db:delete-account',
  DB_LIST_ACCOUNT_ACTIONS: 'db:list-account-actions',

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

  // Database Campaign Details (per-milestone log)
  DB_LIST_CAMPAIGN_DETAILS_BY_INPUT_DATA: 'db:list-campaign-details',
  DB_LIST_CAMPAIGN_DETAILS_BY_CAMPAIGN: 'db:list-campaign-details-by-campaign',
  DB_CREATE_CAMPAIGN_DETAIL: 'db:create-campaign-detail',
  DB_DELETE_CAMPAIGN_DETAIL: 'db:delete-campaign-detail',

  // Campaign Scheduler
  SCHEDULER_START: 'scheduler:start',
  SCHEDULER_STOP: 'scheduler:stop',
  SCHEDULER_STATUS: 'scheduler:status',

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
  CONTACTS_LIST: 'contacts:list',
  CONTACTS_DELETE: 'contacts:delete',
  CONTACTS_PROGRESS: 'contacts:progress',

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
