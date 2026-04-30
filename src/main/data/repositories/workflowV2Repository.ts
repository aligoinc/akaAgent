import { WorkflowDef, WorkflowNode, WorkflowEdge } from '../../../shared/v2Types'
import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()

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

function mapFromDB(row: Record<string, unknown>): WorkflowDef {
  return {
    id: row.id as number,
    name: row.name as string,
    description: row.description as string | undefined,
    nodes: (row.nodes as WorkflowNode[]) || [],
    edges: (row.edges as WorkflowEdge[]) || [],
    variablesSchema: (row.variables_schema as WorkflowDef['variablesSchema']) || [],
    defaultVariables: (row.default_variables as Record<string, unknown>) || {},
    isBuiltin: (row.is_builtin as boolean) ?? false,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function toPayload(w: Partial<WorkflowDef> & { name: string }) {
  return {
    name: w.name,
    description: w.description ?? null,
    nodes: w.nodes ?? [],
    edges: w.edges ?? [],
    variables_schema: w.variablesSchema ?? [],
    default_variables: w.defaultVariables ?? {},
    is_builtin: w.isBuiltin ?? false,
    staff_id: w.staffId ?? null,
    organization_id: w.organizationId ?? null,
    updated_at: new Date().toISOString()
  }
}

export async function listWorkflows(): Promise<WorkflowDef[]> {
  const u = requireCurrentUser()
  const admin = await resolveAdminTenant()
  const orClauses = [`staff_id.eq.${u.staffId}`, 'staff_id.is.null']
  if (admin && admin.staffId !== u.staffId) {
    orClauses.push(`staff_id.eq.${admin.staffId}`)
  }
  const { data, error } = await client()
    .from('auto_v2_workflows')
    .select('*')
    .or(orClauses.join(','))
    .order('updated_at', { ascending: false })

  if (error) throw new Error(`Failed to list workflows: ${error.message}`)
  return (data || []).map(mapFromDB)
}

export async function getWorkflow(id: number): Promise<WorkflowDef | null> {
  const { data, error } = await client()
    .from('auto_v2_workflows')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return mapFromDB(data)
}

export async function getWorkflowByName(name: string): Promise<WorkflowDef | null> {
  const { data, error } = await client()
    .from('auto_v2_workflows')
    .select('*')
    .eq('name', name)
    .maybeSingle()
  if (error || !data) return null
  return mapFromDB(data)
}

export async function saveWorkflow(wf: Partial<WorkflowDef> & { name: string }): Promise<WorkflowDef> {
  const u = requireCurrentUser()
  const payload = toPayload({
    ...wf,
    staffId: wf.staffId ?? u.staffId,
    organizationId: wf.organizationId ?? u.organizationId
  })
  const { data, error } = await client()
    .from('auto_v2_workflows')
    .upsert(payload, { onConflict: 'name' })
    .select()
    .single()
  if (error) throw new Error(`Failed to save workflow: ${error.message}`)
  return mapFromDB(data)
}

export async function saveWorkflowSystem(wf: Partial<WorkflowDef> & { name: string }): Promise<WorkflowDef> {
  const admin = await resolveAdminTenant()
  const payload = toPayload({
    ...wf,
    isBuiltin: true,
    staffId: admin?.staffId ?? undefined,
    organizationId: admin?.organizationId ?? undefined
  })
  const { data, error } = await client()
    .from('auto_v2_workflows')
    .upsert(payload, { onConflict: 'name' })
    .select()
    .single()
  if (error) throw new Error(`Failed to save system workflow: ${error.message}`)
  return mapFromDB(data)
}

export async function deleteWorkflow(id: number): Promise<void> {
  const u = requireCurrentUser()
  const { error } = await client()
    .from('auto_v2_workflows')
    .delete()
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_builtin', false)
  if (error) throw new Error(`Failed to delete workflow: ${error.message}`)
}
