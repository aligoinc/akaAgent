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
  PICKER_CANCEL: 'picker:cancel'
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
