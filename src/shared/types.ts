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
  | 'sleep' | 'waitForSelector' | 'waitForNavigation'
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
// IPC Channel Types
// ============================================

export const IPC_CHANNELS = {
  // Flow execution
  FLOW_RUN: 'flow:run',
  FLOW_STOP: 'flow:stop',
  FLOW_PROGRESS: 'flow:progress',

  // Browser control
  BROWSER_LAUNCH: 'browser:launch',
  BROWSER_CLOSE: 'browser:close',
  BROWSER_STATUS: 'browser:status',

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
