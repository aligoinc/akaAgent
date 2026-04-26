import { RunV2, RunStepV2 } from '../../../shared/v2Types'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

function mapRunFromDB(row: Record<string, unknown>): RunV2 {
  return {
    id: row.id as number,
    workflowId: row.workflow_id as number | undefined,
    campaignId: row.campaign_id as number | undefined,
    campaignDetailId: row.campaign_detail_id as number | undefined,
    channelId: row.channel_id as number | undefined,
    status: row.status as RunV2['status'],
    variables: (row.variables as Record<string, unknown>) || {},
    output: (row.output as Record<string, unknown>) || {},
    error: row.error as string | undefined,
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
    createdAt: row.created_at as string | undefined,
    steps: []
  }
}

function mapStepFromDB(row: Record<string, unknown>): RunStepV2 {
  return {
    id: row.id as number,
    runId: row.run_id as number,
    nodeId: row.node_id as string,
    blockId: row.block_id as number | undefined,
    blockName: row.block_name as string | undefined,
    status: row.status as RunStepV2['status'],
    input: (row.input as Record<string, unknown>) || {},
    output: (row.output as Record<string, unknown>) || {},
    error: row.error as string | undefined,
    durationMs: row.duration_ms as number | undefined,
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined
  }
}

export async function createRun(run: Omit<RunV2, 'id' | 'steps' | 'createdAt'>): Promise<number> {
  const payload = {
    workflow_id: run.workflowId ?? null,
    campaign_id: run.campaignId ?? null,
    campaign_detail_id: run.campaignDetailId ?? null,
    channel_id: run.channelId ?? null,
    status: run.status,
    variables: run.variables,
    output: run.output,
    error: run.error ?? null,
    started_at: run.startedAt ?? null,
    completed_at: run.completedAt ?? null
  }
  const { data, error } = await client()
    .from('auto_v2_runs')
    .insert(payload)
    .select('id')
    .single()
  if (error) throw new Error(`Failed to create run: ${error.message}`)
  return data.id as number
}

export async function updateRun(runId: number, patch: Partial<Pick<RunV2, 'status' | 'output' | 'error' | 'completedAt'>>): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (patch.status !== undefined) payload.status = patch.status
  if (patch.output !== undefined) payload.output = patch.output
  if (patch.error !== undefined) payload.error = patch.error
  if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt

  const { error } = await client()
    .from('auto_v2_runs')
    .update(payload)
    .eq('id', runId)
  if (error) throw new Error(`Failed to update run: ${error.message}`)
}

export async function createRunStep(runId: number, step: Omit<RunStepV2, 'id' | 'runId'>): Promise<number> {
  const payload = {
    run_id: runId,
    node_id: step.nodeId,
    block_id: step.blockId ?? null,
    block_name: step.blockName ?? null,
    status: step.status,
    input: step.input,
    output: step.output,
    error: step.error ?? null,
    duration_ms: step.durationMs ?? null,
    started_at: step.startedAt ?? null,
    completed_at: step.completedAt ?? null
  }
  const { data, error } = await client()
    .from('auto_v2_run_steps')
    .insert(payload)
    .select('id')
    .single()
  if (error) throw new Error(`Failed to create run step: ${error.message}`)
  return data.id as number
}

export async function updateRunStep(stepId: number, patch: Partial<Pick<RunStepV2, 'status' | 'output' | 'error' | 'durationMs' | 'completedAt'>>): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (patch.status !== undefined) payload.status = patch.status
  if (patch.output !== undefined) payload.output = patch.output
  if (patch.error !== undefined) payload.error = patch.error
  if (patch.durationMs !== undefined) payload.duration_ms = patch.durationMs
  if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt

  const { error } = await client()
    .from('auto_v2_run_steps')
    .update(payload)
    .eq('id', stepId)
  if (error) throw new Error(`Failed to update run step: ${error.message}`)
}

export async function listRunsByWorkflow(workflowId: number, limit = 50): Promise<RunV2[]> {
  const { data, error } = await client()
    .from('auto_v2_runs')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Failed to list runs: ${error.message}`)
  return (data || []).map(mapRunFromDB)
}

export async function listRunSteps(runId: number): Promise<RunStepV2[]> {
  const { data, error } = await client()
    .from('auto_v2_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('started_at', { ascending: true })
  if (error) throw new Error(`Failed to list run steps: ${error.message}`)
  return (data || []).map(mapStepFromDB)
}
