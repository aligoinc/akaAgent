import { FlowData, ExecutionRun, ExecutionStep } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapFlowFromDB, mapRunFromDB, mapRunStepFromDB } from '../mappers'

const client = () => getSupabaseClient()

export async function saveFlow(flowData: FlowData): Promise<FlowData> {
  const payload = {
    id: flowData.id,
    name: flowData.name,
    description: flowData.description || '',
    nodes: flowData.nodes,
    edges: flowData.edges,
    variables: flowData.variables || {},
    input_schema: flowData.inputSchema || {},
    output_schema: flowData.outputSchema || {},
    is_block: flowData.isBlock || false,
    updated_at: new Date().toISOString()
  }

  const { data, error } = await client()
    .from('auto_flows')
    .upsert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to save flow: ${error.message}`)
  return mapFlowFromDB(data)
}

export async function loadFlow(flowId: string): Promise<FlowData | null> {
  const { data, error } = await client()
    .from('auto_flows')
    .select('*')
    .eq('id', flowId)
    .single()

  if (error) return null
  return mapFlowFromDB(data)
}

export async function listFlows(): Promise<FlowData[]> {
  const { data, error } = await client()
    .from('auto_flows')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) throw new Error(`Failed to list flows: ${error.message}`)
  return (data || []).map(mapFlowFromDB)
}

export async function deleteFlow(flowId: string): Promise<void> {
  const { data: runs } = await client()
    .from('auto_runs')
    .select('id')
    .eq('flow_id', flowId)

  if (runs && runs.length > 0) {
    const runIds = runs.map(r => r.id)
    const { error: stepsError } = await client()
      .from('auto_run_steps')
      .delete()
      .in('run_id', runIds)
    if (stepsError) console.error('Failed to delete run steps:', stepsError.message)

    const { error: runsError } = await client()
      .from('auto_runs')
      .delete()
      .eq('flow_id', flowId)
    if (runsError) console.error('Failed to delete runs:', runsError.message)
  }

  const { error } = await client()
    .from('auto_flows')
    .delete()
    .eq('id', flowId)

  if (error) throw new Error(`Failed to delete flow: ${error.message}`)
}

export async function createRun(run: ExecutionRun): Promise<void> {
  const runPayload = {
    id: run.id,
    flow_id: run.flowId,
    workflow_id: run.workflowId || null,
    status: run.status,
    input: run.input,
    started_at: run.startedAt
  }

  const { error: runError } = await client()
    .from('auto_runs')
    .insert(runPayload)

  if (runError) throw new Error(`Failed to create run: ${runError.message}`)
}

export async function updateRun(runId: string, status: string, output: Record<string, unknown>, errorStr?: string, completedAt?: string): Promise<void> {
  const payload: any = { status, output }
  if (errorStr) payload.error = errorStr
  if (completedAt) payload.completed_at = completedAt

  const { error } = await client()
    .from('auto_runs')
    .update(payload)
    .eq('id', runId)

  if (error) throw new Error(`Failed to update run: ${error.message}`)
}

export async function createRunStep(runId: string, step: ExecutionStep): Promise<void> {
  const stepsPayload = {
    run_id: runId,
    node_id: step.nodeId,
    action_type: step.actionType,
    status: step.status,
    input: step.input,
    output: step.output,
    screenshot_url: step.screenshotUrl || null,
    error: step.error || null,
    duration_ms: step.durationMs || null,
    executed_at: step.executedAt
  }

  const { error: stepsError } = await client()
    .from('auto_run_steps')
    .insert(stepsPayload)

  if (stepsError) throw new Error(`Failed to save run step: ${stepsError.message}`)
}

export async function listRuns(flowId?: string): Promise<ExecutionRun[]> {
  let query = client()
    .from('auto_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (flowId) {
    query = query.eq('flow_id', flowId)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list runs: ${error.message}`)
  return (data || []).map(row => mapRunFromDB(row))
}

export async function listRunSteps(runId: string): Promise<ExecutionStep[]> {
  const { data, error } = await client()
    .from('auto_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('executed_at', { ascending: true })

  if (error) throw new Error(`Failed to list run steps: ${error.message}`)
  return (data || []).map(row => mapRunStepFromDB(row))
}
