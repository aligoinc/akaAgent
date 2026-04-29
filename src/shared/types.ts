// ============================================
// Action System Types
// ============================================

export type ActionCategory = 'navigation' | 'interaction' | 'data' | 'control' | 'utility' | 'block'

export type ActionType =
  // Navigation
  | 'navigate' | 'goBack' | 'goForward' | 'reload'
  // Interaction
  | 'click' | 'type' | 'scroll' | 'hover' | 'select' | 'pressKey'
  // Data
  | 'getValue' | 'setValue' | 'getText' | 'screenshot' | 'getAttribute'
  // Utility
  | 'sleep' | 'waitForSelector' | 'waitForNavigation' | 'apiCall' | 'updateCampaignStatus' | 'writeCampaignLog' | 'uploadFile' | 'dropFile' | 'downloadUrl'
  // Facebook compound actions (high-level, FB-specific automation)
  | 'fbScrapePost' | 'fbSharePost' | 'fbPostReels' | 'fbSendMessage' | 'fbAddFriend'
  | 'fbDetectPostPending' | 'fbLeaveGroupIfPending' | 'fbJoinGroupIfNotMember'
  // Control Flow
  | 'ifElse' | 'loop' | 'switch'
  // Block System
  | 'blockInput' | 'blockOutput' | 'block'

export interface ActionIOField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'json' | 'any' | 'element'
  label: string
  description?: string
  required?: boolean
  defaultValue?: unknown
  placeholder?: string
  options?: { label: string; value: string }[] // for select fields
}

export interface ActionDefinition {
  id: string
  name: string
  type: ActionType
  description: string
  icon: string // lucide icon name
  category: ActionCategory
  inputSchema: ActionIOField[]
  outputSchema: ActionIOField[]
  defaultConfig?: Record<string, unknown>
}

// ============================================
// Element Management Types
// ============================================

export interface ElementDefinition {
  id: string
  name: string
  xpath: string
  description?: string
  createdAt?: string
  updatedAt?: string
}

// ============================================
// Flow Types (React Flow compatible)
// ============================================

export interface FlowNodeData extends Record<string, unknown> {
  actionType: ActionType
  label: string
  icon: string
  category: ActionCategory
  config: Record<string, unknown>    // user-configured input values
  blockData?: {
    id: string
    name: string
    inputSchema: ActionIOField[]
    outputSchema: ActionIOField[]
  }
  inputMapping: Record<string, {     // maps input fields to outputs of other nodes
    sourceNodeId: string
    sourceField: string
    sourcePath?: string              // optional path for JSON objects e.g. "user.name"
  }>
  status?: 'idle' | 'running' | 'success' | 'error'
  output?: Record<string, unknown>
  error?: string
}

export interface FlowData {
  id: string
  name: string
  description?: string
  nodes: FlowNodeSerialized[]
  edges: FlowEdgeSerialized[]
  variables?: Record<string, unknown>
  inputSchema?: ActionIOField[]
  outputSchema?: ActionIOField[]
  isBlock?: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export interface FlowNodeSerialized {
  id: string
  type: string
  position: { x: number; y: number }
  data: FlowNodeData
}

export interface FlowEdgeSerialized {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

// ============================================
// Execution Types
// ============================================

export interface ActionResult {
  success: boolean
  output: Record<string, unknown>
  error?: string
  durationMs: number
  screenshotBase64?: string
}

/**
 * Common interface for browser controllers (PlaywrightController, WebviewController).
 * FlowRunner uses this interface to execute actions on either controller type.
 */
export interface IBrowserController {
  isConnected(): boolean
  executeAction(actionType: ActionType, input: Record<string, unknown>): Promise<ActionResult>
}

export interface ExecutionStep {
  nodeId: string
  actionType: ActionType
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped'
  input: Record<string, unknown>
  output: Record<string, unknown>
  error?: string
  durationMs?: number
  screenshotUrl?: string
  executedAt?: string
}

export interface ExecutionRun {
  id: string
  flowId: string
  workflowId?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  input: Record<string, unknown>
  output: Record<string, unknown>
  steps: ExecutionStep[]
  startedAt?: string
  completedAt?: string
  error?: string
}

// ============================================
// Campaign Automation Types
// ============================================

export interface OrgChannel {
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
  workflowId?: string         // engine cũ (UUID, FK auto_flows.id)
  workflowV2Id?: number       // engine v2 (BIGINT, FK auto_v2_workflows.id) — ưu tiên nếu set
  isDelete: boolean
  createdAt?: string
}

export interface CampaignExtraSettings {
  sharePost?: boolean            // đăng bài dạng chia sẻ (timeline post: share from source link)
  enableComment?: boolean        // kiếm comment
  commentType?: 'own' | 'others' // comment vào bài mình / bài khác
  commentCount?: number          // số lượng comment (khi commentType = 'others')
  commentContent?: string        // nội dung comment
  actionLimits?: {               // giới hạn gửi (được lưu theo campaign nhưng check theo channel_id + actionName)
    sleepBetweenActions?: number
    dailyLimit?: number
    rateLimitCount?: number
    rateLimitMinutes?: number
  }
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
}

export interface Campaign {
  id: number
  name: string
  actionId: string
  channelId: number
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
  channelName?: string
}

// Status enum cho data layer (data_inputs / data_actions):
//   - data_inputs: 'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành' | 'lỗi'
//     ('lỗi' để flag input không scrape được — admin re-trigger)
//   - data_actions: 'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành'
//     (lỗi action-level đã track ở result_actions; khi run fail set 'hoàn thành' + note=errMsg)
export type CampaignDataStatus = 'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành' | 'lỗi'

// Pool nguyên liệu thô (e.g. danh sách group để scrape members → data_actions)
export interface CampaignDataInput {
  id: number
  campaignId: number
  name?: string
  phone?: string
  uid?: string
  email?: string
  status: CampaignDataStatus
  note?: string
  schedule?: string
  dateAction?: string
  isDelete: boolean
  createdAt?: string
}

// Việc-cần-làm thực thi trong campaign loop (thay auto_campaign_details cũ)
export interface CampaignDataAction {
  id: number
  campaignId: number
  dataInputId?: number | null    // nullable: NULL = user nhập trực tiếp; số = sinh từ data_inputs (e.g. member của group)
  name?: string
  phone?: string
  uid?: string
  email?: string
  status: CampaignDataStatus
  note?: string
  schedule?: string
  dateAction?: string
  isDelete: boolean
  createdAt?: string
}

// Status enum cho result_actions (per-milestone log):
//   - 'thành công': action OK (đã post, đã comment, đã kết bạn)
//   - 'thất bại': nghiệp vụ FB từ chối (FB block message, post pending, kết bạn không gửi được)
//   - 'lỗi': exception/crash code (selector not found, timeout, network)
export type CampaignResultStatus = 'thành công' | 'thất bại' | 'lỗi'

export interface CampaignResultAction {
  id: number
  dataActionId?: number | null
  campaignId: number
  channelId?: number
  actionName: string
  status: CampaignResultStatus
  log?: string
  data?: Record<string, unknown>
  postUrl?: string               // URL of the post this action is related to (e.g. just-published post, commented post)
  isDelete: boolean
  createdAt?: string
}

// ============================================
// Channel Contact Types
// ============================================

export type ContactType = 'friend' | 'group'

export interface OrgChannelContact {
  id: number
  channelId: number
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
// IPC Channel Types
// ============================================

export const IPC_CHANNELS = {
  // Theme
  THEME_CHANGE: 'theme:change',

  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_ME: 'auth:me',

  // Flow execution
  FLOW_RUN: 'flow:run',
  FLOW_STOP: 'flow:stop',
  FLOW_PROGRESS: 'flow:progress',

  // Browser control (legacy single browser for workflow editor)
  BROWSER_LAUNCH: 'browser:launch',
  BROWSER_CLOSE: 'browser:close',
  BROWSER_STATUS: 'browser:status',

  // Multi-browser profile management
  PROFILE_LAUNCH: 'profile:launch',
  PROFILE_CLOSE: 'profile:close',
  PROFILE_STATUS: 'profile:status',
  PROFILE_LIST: 'profile:list',
  PROFILE_FOCUS: 'profile:focus',

  // Database Flow
  DB_SAVE_FLOW: 'db:save-flow',
  DB_LOAD_FLOW: 'db:load-flow',
  DB_LIST_FLOWS: 'db:list-flows',
  DB_DELETE_FLOW: 'db:delete-flow',

  // Database Run
  DB_SAVE_RUN: 'db:save-run',
  DB_LIST_RUNS: 'db:list-runs',
  DB_LIST_RUN_STEPS: 'db:list-run-steps',

  // Database Element
  DB_SAVE_ELEMENT: 'db:save-element',
  DB_LIST_ELEMENTS: 'db:list-elements',
  DB_DELETE_ELEMENT: 'db:delete-element',

  // Database Org Channels
  DB_LIST_CHANNELS: 'db:list-channels',
  DB_CREATE_CHANNEL: 'db:create-channel',
  DB_UPDATE_CHANNEL: 'db:update-channel',
  DB_DELETE_CHANNEL: 'db:delete-channel',

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

  // Database Campaign Data Inputs (pool nguyên liệu thô — e.g. group list)
  DB_LIST_DATA_INPUTS: 'db:list-data-inputs',
  DB_CREATE_DATA_INPUT: 'db:create-data-input',
  DB_UPDATE_DATA_INPUT: 'db:update-data-input',
  DB_DELETE_DATA_INPUT: 'db:delete-data-input',

  // Database Campaign Data Actions (việc-cần-làm thực thi)
  DB_LIST_DATA_ACTIONS: 'db:list-data-actions',
  DB_CREATE_DATA_ACTION: 'db:create-data-action',
  DB_UPDATE_DATA_ACTION: 'db:update-data-action',
  DB_DELETE_DATA_ACTION: 'db:delete-data-action',

  // Database Campaign Result Actions (per-milestone log)
  DB_LIST_RESULT_ACTIONS_BY_DATA_ACTION: 'db:list-result-actions',
  DB_LIST_RESULT_ACTIONS_BY_CAMPAIGN: 'db:list-result-actions-by-campaign',
  DB_CREATE_RESULT_ACTION: 'db:create-result-action',
  DB_DELETE_RESULT_ACTION: 'db:delete-result-action',

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

  // Channel Actions
  CHANNEL_CHECK_FB_LOGIN: 'channel:check-fb-login',
  CHANNEL_RELOAD_PAGE: 'channel:reload-page',
  CHANNEL_STATUS_UPDATED: 'channel:status-updated',

  // Actions
  ACTIONS_LIST: 'actions:list',
  ACTION_EXECUTE: 'action:execute',

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
