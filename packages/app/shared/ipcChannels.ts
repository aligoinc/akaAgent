/**
 * IPC channel names — shared giữa main process và renderer.
 *
 * Phase 7a minimum: list workflows + run workflow + progress events.
 */

export const IPC_CHANNELS = {
  // Workflows
  WORKFLOW_LIST: 'workflow:list',
  WORKFLOW_GET: 'workflow:get',
  WORKFLOW_SEED: 'workflow:seed',           // upsert from JSON
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
  BLOCK_LIST: 'block:list'
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
