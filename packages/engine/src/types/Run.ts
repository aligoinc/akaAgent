export type RunStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export type StepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'cancelled'

export interface Run {
  id: string
  workflowId: string
  workflowVersion: number
  triggerId?: string
  channelId?: string
  datatableRowId?: string
  status: RunStatus
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  retryOfRun?: string
  organizationId?: number
  createdAt?: string
}

export interface RunStepLogMessage {
  level: 'info' | 'warn' | 'error'
  ts: string
  message: string
}

export interface RunStep {
  id: string
  runId: string
  nodeId: string
  manifestId: string
  status: StepStatus
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  attempt: number
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  reportingLabel?: string
  reportingTags?: string[]
  logMessages?: RunStepLogMessage[]
  screenshotBeforePath?: string
  screenshotAfterPath?: string
}

export interface RunRequest {
  workflowId: string
  workflowVersion?: number
  triggerId?: string
  channelId?: string
  input: Record<string, unknown>
  context?: {
    datatableRowId?: string
    campaignViewId?: string
  }
}

export interface RunResult {
  runId: string
  status: RunStatus
  output?: Record<string, unknown>
  error?: string
  durationMs: number
}

export type ProgressEvent =
  | { kind: 'run.start'; runId: string }
  | { kind: 'step.start'; runId: string; nodeId: string; manifestId: string; attempt: number }
  | {
      kind: 'step.end'
      runId: string
      nodeId: string
      manifestId: string
      status: 'success' | 'error' | 'skipped'
      output?: Record<string, unknown>
      error?: string
      durationMs: number
      reportingLabel?: string
      reportingTags?: string[]
    }
  | {
      kind: 'log'
      runId: string
      nodeId?: string
      level: 'info' | 'warn' | 'error'
      message: string
    }
  | { kind: 'run.end'; runId: string; status: RunStatus; durationMs: number }
