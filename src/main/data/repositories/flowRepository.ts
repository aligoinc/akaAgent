import { FlowData, ExecutionRun, ExecutionStep } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapFlowFromDB, mapRunFromDB, mapRunStepFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()

// Admin tenant (org có is_admin_akabiz=true) sở hữu các flow built-in để
// quản lý/edit từ "Cài đặt Workflow". Cache trong-process — admin ko đổi runtime.
let _adminTenantCache: { staffId: number; organizationId: number } | null = null
async function resolveAdminTenant(): Promise<{ staffId: number; organizationId: number } | null> {
  if (_adminTenantCache) return _adminTenantCache
  const { data } = await client()
    .from('org_organization')
    .select('id, staff_admin_id')
    .eq('is_admin_akabiz', true)
    .limit(1)
    .maybeSingle()
  const staffAdminId = data?.staff_admin_id as number | null | undefined
  const orgId = data?.id as number | undefined
  if (staffAdminId && orgId) {
    _adminTenantCache = { staffId: staffAdminId, organizationId: orgId }
  }
  return _adminTenantCache
}

export async function saveFlow(flowData: FlowData): Promise<FlowData> {
  const u = requireCurrentUser()
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
    staff_id: u.staffId,
    organization_id: u.organizationId,
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
  const u = requireCurrentUser()
  // Allow: flow của chính staff, flow built-in đã gán admin tenant (để mọi
  // staff load-to-run được), hoặc legacy NULL (seeded trước commit này —
  // sẽ tự upsert thành admin ở lần khởi động tiếp).
  const admin = await resolveAdminTenant()
  const orClauses = [`staff_id.eq.${u.staffId}`, 'staff_id.is.null']
  if (admin && admin.staffId !== u.staffId) {
    orClauses.push(`staff_id.eq.${admin.staffId}`)
  }
  const { data, error } = await client()
    .from('auto_flows')
    .select('*')
    .eq('id', flowId)
    .or(orClauses.join(','))
    .single()

  if (error) return null
  return mapFlowFromDB(data)
}

export async function listFlows(): Promise<FlowData[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_flows')
    .select('*')
    .eq('staff_id', u.staffId)
    .order('updated_at', { ascending: false })

  if (error) throw new Error(`Failed to list flows: ${error.message}`)
  return (data || []).map(mapFlowFromDB)
}

// System-level upsert for seeding built-in workflows (no auth required).
// Gán về admin tenant (is_admin_akabiz=true) để admin edit được từ "Cài đặt
// Workflow". Các staff khác vẫn load-to-run qua fallback trong loadFlow.
// Nếu chưa có admin (DB mới), fallback NULL để ko block seed.
export async function saveFlowSystem(flowData: FlowData): Promise<FlowData> {
  const admin = await resolveAdminTenant()
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
    staff_id: admin?.staffId ?? null,
    organization_id: admin?.organizationId ?? null,
    updated_at: new Date().toISOString()
  }

  const { data, error } = await client()
    .from('auto_flows')
    .upsert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to save system flow: ${error.message}`)
  return mapFlowFromDB(data)
}

export async function deleteFlow(flowId: string): Promise<void> {
  const u = requireCurrentUser()
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
    .eq('staff_id', u.staffId)

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
