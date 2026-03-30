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
  | 'sleep' | 'waitForSelector' | 'waitForNavigation' | 'apiCall' | 'updateCampaignStatus' | 'writeCampaignLog'
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

export interface FlatformAccount {
  id: number
  name: string
  flatformType: string
  loginStatus: string
  status: string
  isActive: boolean
  isDelete: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CampaignAction {
  id: string         // TEXT id e.g. 'facebook_group_post'
  name: string
  flatformType: string
  isActive: boolean
  workflowId?: string
  isDelete: boolean
  createdAt?: string
}

export interface CampaignExtraSettings {
  sharePost?: boolean            // đăng bài dạng chia sẻ
  enableComment?: boolean        // kiếm comment
  commentType?: 'own' | 'others' // comment vào bài mình / bài khác
  commentCount?: number          // số lượng comment (khi commentType = 'others')
  commentContent?: string        // nội dung comment
  actionLimits?: {               // giới hạn gửi (được lưu theo campaign nhưng check theo account_id + actionName)
    sleepBetweenActions?: number
    dailyLimit?: number
    rateLimitCount?: number
    rateLimitMinutes?: number
  }
  imageOption?: 'none' | 'all' | 'random'
  randomImageCount?: number
}

export interface Campaign {
  id: number
  name: string
  actionId: string
  flatformAccountId: number
  status: string
  schedule?: string
  scheduleType?: 'daily' | 'weekly' | 'monthly'
  scheduleEndDate?: string
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
  createdAt?: string
  updatedAt?: string
  // Joined fields
  actionName?: string
  accountName?: string
}

export interface CampaignDetail {
  id: number
  campaignId: number
  name?: string
  phone?: string
  uid?: string
  email?: string
  status: string
  note?: string
  schedule?: string
  dateAction?: string
  isDelete: boolean
  createdAt?: string
}

export interface CampaignDetailAction {
  id: number
  campaignDetailId?: number
  campaignId: number
  accountId?: number
  actionName: string
  status: string
  log?: string
  data?: Record<string, unknown>
  isDelete: boolean
  createdAt?: string
}

// ============================================
// IPC Channel Types
// ============================================

export const IPC_CHANNELS = {
  // Theme
  THEME_CHANGE: 'theme:change',

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

  // Database Flatform Accounts
  DB_LIST_ACCOUNTS: 'db:list-accounts',
  DB_CREATE_ACCOUNT: 'db:create-account',
  DB_UPDATE_ACCOUNT: 'db:update-account',
  DB_DELETE_ACCOUNT: 'db:delete-account',

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

  // Database Campaign Details
  DB_LIST_CAMPAIGN_DETAILS: 'db:list-campaign-details',
  DB_CREATE_CAMPAIGN_DETAIL: 'db:create-campaign-detail',
  DB_UPDATE_CAMPAIGN_DETAIL: 'db:update-campaign-detail',
  DB_DELETE_CAMPAIGN_DETAIL: 'db:delete-campaign-detail',

  // Database Campaign Detail Actions (action logs)
  DB_LIST_DETAIL_ACTIONS: 'db:list-detail-actions',
  DB_LIST_DETAIL_ACTIONS_BY_CAMPAIGN: 'db:list-detail-actions-by-campaign',
  DB_CREATE_DETAIL_ACTION: 'db:create-detail-action',
  DB_DELETE_DETAIL_ACTION: 'db:delete-detail-action',

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

  // Actions
  ACTIONS_LIST: 'actions:list',
  ACTION_EXECUTE: 'action:execute',
} as const

// ============================================
// Supabase Config
// ============================================

export interface SupabaseConfig {
  url: string
  anonKey: string
}
