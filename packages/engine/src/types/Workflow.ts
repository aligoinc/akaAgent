import type { BlockIOField, RetryPolicy } from './BlockManifest.js'

export interface InputRef {
  sourceNodeId: string
  sourceField: string
  sourcePath?: string
}

/**
 * Reserved fields (track, joinPolicy, joinCount, compensate) là Phase 2 hợp đồng:
 * Engine ngày 1 KHÔNG xử lý — nhưng schema CHẤP NHẬN, KHÔNG strip khi load/save.
 * Sau này enable không cần migrate data.
 */
export interface WorkflowNode {
  id: string
  manifestId: string
  position: { x: number; y: number }
  config: Record<string, unknown>
  inputMapping: Record<string, InputRef>
  retry?: RetryPolicy
  onError?: 'fail' | 'continue' | 'goto'
  onErrorTarget?: string
  track?: 'main' | 'side'
  joinPolicy?: 'all' | 'race' | 'any' | 'all-settled' | 'n-of-m'
  joinCount?: number
  compensate?: string
  reportingLabel?: string
  reportingTags?: string[]
  channelOverride?: 'workflow' | 'specific'
  channelId?: string
  label?: string
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface WorkflowVariable {
  name: string
  type: BlockIOField['type']
  defaultValue?: unknown
  fromInput?: boolean
  secret?: boolean
}

export type TriggerKind = 'manual' | 'schedule' | 'webhook' | 'event'

export interface WorkflowTrigger {
  kind: TriggerKind
  config: Record<string, unknown>
}

export interface WorkflowSettings {
  defaultTimeoutMs?: number
  defaultRetry?: RetryPolicy
  onErrorPolicy?: 'fail' | 'continue'
  saveScreenshotOn?: 'error' | 'always' | 'never'
  forensicCapture?: 'never' | 'on-error' | 'always'
  captureScreenshot?: 'never' | 'on-error' | 'always'
  captureDom?: 'never' | 'on-error' | 'always'
  captureNetworkHar?: boolean
  retainForensicDays?: number
  maskSecrets?: boolean
  maxDurationMs?: number
}

export interface Workflow {
  id: string
  name: string
  version: number
  description?: string
  isBlock?: boolean
  inputSchema: BlockIOField[]
  outputSchema: BlockIOField[]
  variables: WorkflowVariable[]
  triggers: WorkflowTrigger[]
  graph: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
  }
  settings?: WorkflowSettings
  createdAt?: string
  updatedAt?: string
  staffId?: number
  organizationId?: number
}
