/**
 * IPC channel names — shared giữa main process và renderer.
 *
 * Phase 7a minimum: list workflows + run workflow + progress events.
 */

export const IPC_CHANNELS = {
  // Workflows
  WORKFLOW_LIST: 'workflow:list',
  WORKFLOW_GET: 'workflow:get',
  WORKFLOW_SAVE: 'workflow:save',           // upsert workflow + new revision
  WORKFLOW_CREATE: 'workflow:create',       // blank workflow
  WORKFLOW_DELETE: 'workflow:delete',
  // Runs
  RUN_ENQUEUE: 'run:enqueue',
  RUN_LIST: 'run:list',
  RUN_GET_STEPS: 'run:getSteps',
  // Channels
  CHANNEL_LIST: 'channel:list',
  CHANNEL_REGISTER: 'channel:register',
  // Realtime broadcast (main → renderer)
  RUN_PROGRESS: 'run:progress',
  // Block registry
  BLOCK_LIST: 'block:list',
  // Named selectors
  SELECTOR_LIST: 'selector:list',
  SELECTOR_GET_BY_NAME: 'selector:getByName',
  SELECTOR_SAVE: 'selector:save',
  SELECTOR_DELETE: 'selector:delete',
  // Element picker
  PICKER_START: 'picker:start',
  PICKER_CANCEL: 'picker:cancel',
  // DataTables
  DATATABLE_LIST: 'datatable:list',
  DATATABLE_GET: 'datatable:get',
  DATATABLE_SAVE: 'datatable:save',
  DATATABLE_DELETE: 'datatable:delete',
  DATATABLE_ROWS_LIST: 'datatable:rowsList',
  DATATABLE_ROW_SAVE: 'datatable:rowSave',
  DATATABLE_ROW_DELETE: 'datatable:rowDelete',
  DATATABLE_ROW_RESET: 'datatable:rowReset',
  // Triggers
  TRIGGER_LIST: 'trigger:list',
  TRIGGER_SAVE: 'trigger:save',
  TRIGGER_DELETE: 'trigger:delete',
  TRIGGER_RUN_NOW: 'trigger:runNow',
  // Connections
  CONNECTION_LIST: 'connection:list',
  CONNECTION_SAVE: 'connection:save',
  CONNECTION_DELETE: 'connection:delete',
  // Campaign views
  CAMPAIGNVIEW_LIST: 'campaignView:list',
  CAMPAIGNVIEW_SAVE: 'campaignView:save',
  CAMPAIGNVIEW_DELETE: 'campaignView:delete',
  // Channels CRUD (extension)
  CHANNEL_SAVE: 'channel:save',
  CHANNEL_DELETE: 'channel:delete',
  // Campaign logs (Phase 9.5)
  CAMPAIGNLOG_LIST: 'campaignLog:list'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]

export interface WorkflowListItem {
  id: string
  name: string
  description: string | null
  is_active: boolean
  is_block: boolean
  current_version: number
  updated_at: string | null
}

export interface RunListItem {
  id: string
  workflow_id: string
  workflow_version: number
  channel_id: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  error: string | null
}

export interface ChannelListItem {
  id: string
  name: string
  channel_type: string
  status: string
}

export interface NamedSelectorRow {
  id: string
  name: string
  domain: string | null
  description: string | null
  selector_type: 'css' | 'xpath' | 'text-match'
  expression: string
  fallbacks: Array<{ type: string; expression: string }> | null
  last_verified_at: string | null
  organization_id: number | null
  created_by: number | null
  created_at: string
  updated_at: string | null
}

export interface PickResult {
  selectorType: 'css' | 'xpath'
  expression: string
  fallbacks: Array<{ type: 'css' | 'xpath' | 'text-match'; expression: string }>
  text: string
  tagName: string
  url: string
}

export interface PickerStartArgs {
  channelId: string
  url?: string
}

export interface DataTableRow {
  id: string
  name: string
  schema: Array<{ name: string; type: string; label?: string; required?: boolean }>
  description: string | null
  organization_id: number | null
  created_at: string
}

export interface DataTableRowItem {
  id: string
  datatable_id: string
  data: Record<string, unknown>
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped'
  last_run_id: string | null
  last_run_at: string | null
  retry_count: number
  tags: string[] | null
  organization_id: number | null
  created_at: string
  updated_at: string | null
}

export interface TriggerRow {
  id: string
  workflow_id: string
  workflow_version: number | null
  channel_id: string | null
  channel_pool: string[] | null
  channel_assignment: string | null
  datatable_id: string | null
  datatable_filter: Record<string, unknown> | null
  kind: 'manual' | 'schedule' | 'webhook' | 'event'
  config: Record<string, unknown>
  settings: Record<string, unknown> | null
  is_active: boolean
  next_run_at: string | null
  last_run_at: string | null
  last_run_status: string | null
  consecutive_failures: number
  organization_id: number | null
  created_at: string
}

export interface ConnectionRow {
  id: string
  name: string
  conn_type: 'oauth2' | 'apikey' | 'basicauth' | 'cookie' | 'custom'
  scope: Record<string, unknown> | null
  organization_id: number | null
  created_at: string
}

export interface CampaignViewRow {
  id: string
  name: string
  description: string | null
  workflow_id: string | null
  trigger_id: string | null
  datatable_id: string | null
  organization_id: number | null
  created_at: string
}

export interface CampaignLogItem {
  id: number
  campaign_view_id: string | null
  workflow_id: string
  run_id: string
  datatable_row_id: string | null
  ts: string
  level: 'info' | 'success' | 'warn' | 'error'
  icon: string | null
  message: string
  meta: Record<string, unknown> | null
}
