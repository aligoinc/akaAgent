import { AiCallMetadata, AiLogInput, AiModel, AiPrompt, AiUsing, AiUsingConfig } from '../../../shared/aiTypes'
import { getCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

function toJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function mapModel(row: Record<string, unknown>): AiModel {
  return {
    id: row.id as number,
    code: row.code as string,
    provider: row.provider as string,
    model: row.model as string,
    endpoint: row.endpoint as string,
    apiKey: (row.api_key as string | null) ?? null,
    defaultBody: toJsonObject(row.default_body),
    organizationId: (row.organization_id as number | null) ?? null,
    isSystem: (row.is_system as boolean) ?? false,
    isActive: (row.is_active as boolean) ?? true,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

function mapPrompt(row: Record<string, unknown>): AiPrompt {
  return {
    id: row.id as number,
    code: row.code as string,
    name: row.name as string,
    promptSystem: (row.prompt_system as string | null) ?? null,
    promptUser: (row.prompt_user as string | null) ?? '',
    isReasoning: (row.is_reasoning as boolean) ?? false,
    organizationId: (row.organization_id as number | null) ?? null,
    isSystem: (row.is_system as boolean) ?? false,
    isActive: (row.is_active as boolean) ?? true,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

function mapUsing(row: Record<string, unknown>): AiUsing {
  return {
    id: row.id as number,
    code: row.code as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    promptId: row.prompt_id as number,
    modelId: row.model_id as number,
    organizationId: (row.organization_id as number | null) ?? null,
    isSystem: (row.is_system as boolean) ?? false,
    isActive: (row.is_active as boolean) ?? true,
    timeoutMs: (row.timeout_ms as number | null) ?? 120000,
    responseParser: (row.response_parser as string | null) ?? 'auto',
    responsePath: (row.response_path as string | null) ?? null,
    requestOptions: toJsonObject(row.request_options),
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

function preferredOrganizationId(metadata?: AiCallMetadata): number | null {
  const fromMetadata = Number(metadata?.organizationId)
  if (Number.isFinite(fromMetadata) && fromMetadata > 0) return fromMetadata
  const current = getCurrentUser()
  const fromUser = Number(current?.organizationId)
  return Number.isFinite(fromUser) && fromUser > 0 ? fromUser : null
}

function pickTenantScopedRow<T extends { organizationId?: number | null; isSystem?: boolean }>(
  rows: T[],
  organizationId: number | null
): T | null {
  if (organizationId) {
    const exact = rows.find(row => row.organizationId === organizationId)
    if (exact) return exact
  }
  return rows.find(row => row.organizationId == null && row.isSystem === true)
    || rows.find(row => row.organizationId == null)
    || rows[0]
    || null
}

export async function getAiUsingConfigByCode(code: string, metadata?: AiCallMetadata): Promise<AiUsingConfig | null> {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode) return null

  const organizationId = preferredOrganizationId(metadata)
  const { data: usingRows, error: usingError } = await client()
    .from('ai_using')
    .select('*')
    .eq('code', normalizedCode)
    .eq('is_active', true)

  if (usingError) throw new Error(`Failed to load AI using "${normalizedCode}": ${usingError.message}`)
  const using = pickTenantScopedRow((usingRows || []).map(mapUsing), organizationId)
  if (!using) return null

  const [{ data: modelRow, error: modelError }, { data: promptRow, error: promptError }] = await Promise.all([
    client()
      .from('ai_model')
      .select('*')
      .eq('id', using.modelId)
      .eq('is_active', true)
      .maybeSingle(),
    client()
      .from('ai_prompt')
      .select('*')
      .eq('id', using.promptId)
      .eq('is_active', true)
      .maybeSingle()
  ])

  if (modelError) throw new Error(`Failed to load AI model for "${normalizedCode}": ${modelError.message}`)
  if (promptError) throw new Error(`Failed to load AI prompt for "${normalizedCode}": ${promptError.message}`)
  if (!modelRow || !promptRow) return null

  return {
    using,
    model: mapModel(modelRow),
    prompt: mapPrompt(promptRow)
  }
}

export async function createAiLog(input: AiLogInput): Promise<number | null> {
  const payload = {
    using_id: input.usingId ?? null,
    model_id: input.modelId ?? null,
    prompt_id: input.promptId ?? null,
    organization_id: input.organizationId ?? null,
    campaign_id: input.campaignId ?? null,
    campaign_input_id: input.campaignInputId ?? null,
    campaign_input_data_id: input.campaignInputDataId ?? null,
    account_id: input.accountId ?? null,
    workflow_id: input.workflowId ?? null,
    run_id: input.runId ?? null,
    run_step_id: input.runStepId ?? null,
    node_id: input.nodeId ?? null,
    block_id: input.blockId ?? null,
    block_name: input.blockName ?? null,
    using_code: input.usingCode ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    endpoint: input.endpoint ?? null,
    status: input.status,
    http_status: input.httpStatus ?? null,
    rendered_system_prompt: input.renderedSystemPrompt ?? null,
    rendered_user_prompt: input.renderedUserPrompt ?? null,
    sanitized_request: input.sanitizedRequest ?? {},
    sanitized_response: input.sanitizedResponse ?? {},
    response_text: input.responseText ?? null,
    error_message: input.errorMessage ?? null,
    token_input: input.tokenInput ?? null,
    token_output: input.tokenOutput ?? null,
    duration_ms: input.durationMs ?? null
  }

  const { data, error } = await client()
    .from('ai_log')
    .insert(payload)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to create AI log: ${error.message}`)
  return (data?.id as number | null | undefined) ?? null
}
