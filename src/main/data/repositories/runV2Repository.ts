import { RunV2, RunStepV2 } from '../../../shared/v2Types'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()
const BUG_RUN_STATUSES: RunV2['status'][] = ['failed', 'cancelled']

export interface CampaignBugRunTrace {
  source: 'today' | 'latest'
  run: RunV2
  steps: RunStepV2[]
}

function mapRunFromDB(row: Record<string, unknown>): RunV2 {
  return {
    id: row.id as number,
    workflowId: row.workflow_id as number | undefined,
    campaignId: row.campaign_id as number | undefined,
    campaignInputDataId: row.campaign_input_data_id as number | undefined,
    accountId: row.account_id as number | undefined,
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
    campaign_detail_id: null,                                    // legacy column — luôn NULL với code mới
    campaign_input_data_id: run.campaignInputDataId ?? null,
    account_id: run.accountId ?? null,
    status: run.status,
    variables: run.variables,
    output: run.output,
    error: run.error ?? null,
    started_at: run.startedAt ?? null,
    completed_at: run.completedAt ?? null
  }
  const { data, error } = await client()
    .from('auto_runs')
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
    .from('auto_runs')
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
    .from('auto_run_steps')
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
    .from('auto_run_steps')
    .update(payload)
    .eq('id', stepId)
  if (error) throw new Error(`Failed to update run step: ${error.message}`)
}

export async function listRunsByWorkflow(workflowId: number, limit = 50): Promise<RunV2[]> {
  const { data, error } = await client()
    .from('auto_runs')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Failed to list runs: ${error.message}`)
  return (data || []).map(mapRunFromDB)
}

export async function listRunSteps(runId: number): Promise<RunStepV2[]> {
  const { data, error } = await client()
    .from('auto_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('started_at', { ascending: true })
  if (error) throw new Error(`Failed to list run steps: ${error.message}`)
  return (data || []).map(mapStepFromDB)
}

async function listFailedCampaignRuns(
  campaignId: number,
  limit: number,
  range?: { startIso: string; endIso: string }
): Promise<RunV2[]> {
  let query = client()
    .from('auto_runs')
    .select('*')
    .eq('campaign_id', campaignId)
    .in('status', BUG_RUN_STATUSES)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (range) {
    query = query
      .gte('created_at', range.startIso)
      .lt('created_at', range.endIso)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list failed campaign runs: ${error.message}`)
  return (data || []).map(mapRunFromDB)
}

async function listCampaignRunIdsWithErrorSteps(
  campaignId: number,
  limit: number,
  range?: { startIso: string; endIso: string }
): Promise<number[]> {
  let query = client()
    .from('auto_run_steps')
    .select('run_id, started_at, auto_runs!inner(campaign_id)')
    .eq('status', 'error')
    .eq('auto_runs.campaign_id', campaignId)
    .order('started_at', { ascending: false })
    .limit(limit * 10)

  if (range) {
    query = query
      .gte('started_at', range.startIso)
      .lt('started_at', range.endIso)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list campaign run ids with error steps: ${error.message}`)
  const ids: number[] = []
  const seen = new Set<number>()
  for (const row of data || []) {
    const runId = Number((row as Record<string, unknown>).run_id)
    if (!Number.isFinite(runId) || seen.has(runId)) continue
    seen.add(runId)
    ids.push(runId)
    if (ids.length >= limit) break
  }
  return ids
}

async function listRunsByIds(runIds: number[]): Promise<RunV2[]> {
  if (runIds.length === 0) return []
  const { data, error } = await client()
    .from('auto_runs')
    .select('*')
    .in('id', runIds)

  if (error) throw new Error(`Failed to list runs by ids: ${error.message}`)
  return (data || []).map(mapRunFromDB)
}

function runSortTime(run: RunV2): number {
  const value = run.createdAt || run.startedAt || run.completedAt || ''
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

async function listBugRuns(
  campaignId: number,
  limit: number,
  range?: { startIso: string; endIso: string }
): Promise<RunV2[]> {
  const [failedRuns, errorStepRunIds] = await Promise.all([
    listFailedCampaignRuns(campaignId, limit, range),
    listCampaignRunIdsWithErrorSteps(campaignId, limit, range)
  ])
  const errorStepRuns = await listRunsByIds(errorStepRunIds)
  const byId = new Map<number, RunV2>()
  for (const run of [...failedRuns, ...errorStepRuns]) {
    if (run.id === undefined) continue
    if (run.campaignId !== campaignId) continue
    byId.set(run.id, run)
  }
  return Array.from(byId.values())
    .sort((a, b) => runSortTime(b) - runSortTime(a))
    .slice(0, limit)
}

function selectStepsAroundErrors(steps: RunStepV2[], radius = 2): RunStepV2[] {
  const ordered = [...steps].sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0
    return aTime - bTime
  })
  const errorIndexes = ordered
    .map((step, index) => step.status === 'error' ? index : -1)
    .filter(index => index >= 0)

  if (errorIndexes.length === 0) {
    return ordered.slice(-5)
  }

  const selectedIndexes = new Set<number>()
  for (const index of errorIndexes) {
    for (let selected = Math.max(0, index - radius); selected <= Math.min(ordered.length - 1, index + radius); selected++) {
      selectedIndexes.add(selected)
    }
  }
  return ordered.filter((_, index) => selectedIndexes.has(index))
}

export async function listCampaignBugRunTraces(
  campaignId: number,
  startIso: string,
  endIso: string,
  limit: number
): Promise<CampaignBugRunTrace[]> {
  let source: CampaignBugRunTrace['source'] = 'today'
  let runs = await listBugRuns(campaignId, limit, { startIso, endIso })
  if (runs.length === 0) {
    source = 'latest'
    runs = await listBugRuns(campaignId, limit)
  }

  return Promise.all(runs.map(async run => {
    const steps = run.id !== undefined ? await listRunSteps(run.id) : []
    return {
      source,
      run,
      steps: selectStepsAroundErrors(steps)
    }
  }))
}
