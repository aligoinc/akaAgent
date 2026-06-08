export interface AiModel {
  id: number
  code: string
  provider: string
  model: string
  endpoint: string
  apiKey?: string | null
  defaultBody: Record<string, unknown>
  organizationId?: number | null
  isSystem: boolean
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface AiPrompt {
  id: number
  code: string
  name: string
  promptSystem?: string | null
  promptUser: string
  isReasoning: boolean
  organizationId?: number | null
  isSystem: boolean
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface AiUsing {
  id: number
  code: string
  name: string
  description?: string | null
  promptId: number
  modelId: number
  organizationId?: number | null
  isSystem: boolean
  isActive: boolean
  timeoutMs: number
  responseParser: string
  responsePath?: string | null
  requestOptions: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface AiUsingConfig {
  using: AiUsing
  model: AiModel
  prompt: AiPrompt
}

export interface AiCallMetadata {
  organizationId?: number | null
  campaignId?: number
  campaignInputId?: number | null
  campaignInputDataId?: number
  accountId?: number
  workflowId?: number
  runId?: number
  runStepId?: number
  nodeId?: string
  blockId?: number
  blockName?: string
}

export interface AiCallResult {
  ok: boolean
  content: string
  usingCode: string
  provider: string
  model: string
  generatedAt: string
  renderedSystemPrompt?: string | null
  renderedUserPrompt?: string | null
  usage?: unknown
  tokenInput?: number | null
  tokenOutput?: number | null
  durationMs?: number
  logId?: number | null
  rawResponse?: unknown
  error?: string
}

export interface AiLogInput extends AiCallMetadata {
  usingId?: number | null
  modelId?: number | null
  promptId?: number | null
  usingCode?: string
  provider?: string
  model?: string
  endpoint?: string
  status: 'success' | 'error'
  httpStatus?: number | null
  renderedSystemPrompt?: string | null
  renderedUserPrompt?: string | null
  sanitizedRequest?: Record<string, unknown>
  sanitizedResponse?: Record<string, unknown>
  responseText?: string | null
  errorMessage?: string | null
  tokenInput?: number | null
  tokenOutput?: number | null
  durationMs?: number | null
}
