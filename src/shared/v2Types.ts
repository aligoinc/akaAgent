// ============================================================
// Workflow System v2 — shared types
// ============================================================

export type BlockCategory =
  | 'navigation'
  | 'interaction'
  | 'data'
  | 'utility'
  | 'control'
  | 'facebook'
  | 'custom'
  | 'file'

export type BlockKind = 'js' | 'system'

export type SystemBlockType = 'ifElse' | 'loop' | 'parallel' | 'merge'

export type LoopType = 'count' | 'while' | 'forEach'

export type MergeMode = 'all' | 'any'

export interface BlockConfigField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'json' | 'select' | 'textarea' | 'code'
  label: string
  description?: string
  required?: boolean
  default?: unknown
  placeholder?: string
  options?: { label: string; value: string }[]
  multiline?: boolean
}

export interface BlockOutputField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'json' | 'any'
  label: string
  description?: string
}

export interface BlockDef {
  id: number
  name: string
  description?: string
  icon?: string
  category: BlockCategory
  kind: BlockKind
  systemType?: SystemBlockType
  code: string
  configSchema: BlockConfigField[]
  outputSchema: BlockOutputField[]
  defaultConfig: Record<string, unknown>
  isBuiltin: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export interface WorkflowNode {
  id: string
  blockId: number
  blockName: string
  position: { x: number; y: number }
  config: Record<string, unknown>
  codeOverride?: string
  label?: string
  systemType?: SystemBlockType
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
}

export interface WorkflowVariableField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'json' | 'array'
  label: string
  description?: string
  default?: unknown
}

export interface WorkflowDef {
  id: number
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variablesSchema: WorkflowVariableField[]
  defaultVariables: Record<string, unknown>
  isBuiltin: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

export interface ElementDef {
  id: number
  name: string
  xpath: string
  description?: string
  category?: string
  isBuiltin: boolean
  staffId?: number
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}

// ============================================================
// Runtime
// ============================================================

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

export interface RunStepV2 {
  id?: number
  runId?: number
  nodeId: string
  blockId?: number
  blockName?: string
  status: StepStatus
  input: Record<string, unknown>
  output: Record<string, unknown>
  error?: string
  durationMs?: number
  startedAt?: string
  completedAt?: string
}

export interface RunV2 {
  id?: number
  workflowId?: number
  campaignId?: number
  campaignDetailId?: number
  channelId?: number
  status: RunStatus
  variables: Record<string, unknown>
  output: Record<string, unknown>
  error?: string
  startedAt?: string
  completedAt?: string
  createdAt?: string
  steps: RunStepV2[]
}

export interface BlockResult {
  success: boolean
  output: Record<string, unknown>
  error?: string
  durationMs: number
  logs: string[]
}

// ============================================================
// IPC channels v2
// ============================================================
export const IPC_CHANNELS_V2 = {
  // Block library
  BLOCK_LIST: 'v2:block:list',
  BLOCK_GET: 'v2:block:get',
  BLOCK_SAVE: 'v2:block:save',
  BLOCK_DELETE: 'v2:block:delete',

  // Workflow
  WORKFLOW_LIST: 'v2:workflow:list',
  WORKFLOW_GET: 'v2:workflow:get',
  WORKFLOW_SAVE: 'v2:workflow:save',
  WORKFLOW_DELETE: 'v2:workflow:delete',

  // Element library
  ELEMENT_LIST: 'v2:element:list',
  ELEMENT_GET: 'v2:element:get',
  ELEMENT_SAVE: 'v2:element:save',
  ELEMENT_DELETE: 'v2:element:delete',

  // Test runs (in editor)
  WORKFLOW_TEST_RUN: 'v2:workflow:test-run',
  BLOCK_TEST_RUN: 'v2:block:test-run',
  RUN_STOP: 'v2:run:stop',

  // Realtime progress
  RUN_PROGRESS: 'v2:run:progress',
  RUN_LOG: 'v2:run:log'
} as const
