import { BlockDef } from '../../../shared/v2Types'
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

function mapFromDB(row: Record<string, unknown>): BlockDef {
  return {
    id: row.id as number,
    name: row.name as string,
    description: row.description as string | undefined,
    icon: row.icon as string | undefined,
    category: row.category as BlockDef['category'],
    kind: row.kind as BlockDef['kind'],
    systemType: row.system_type as BlockDef['systemType'],
    code: (row.code as string) || '',
    configSchema: (row.config_schema as BlockDef['configSchema']) || [],
    outputSchema: (row.output_schema as BlockDef['outputSchema']) || [],
    defaultConfig: (row.default_config as Record<string, unknown>) || {},
    isBuiltin: (row.is_builtin as boolean) ?? false,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function toPayload(b: Partial<BlockDef> & { name: string; category: BlockDef['category']; kind: BlockDef['kind'] }) {
  return {
    name: b.name,
    description: b.description ?? null,
    icon: b.icon ?? null,
    category: b.category,
    kind: b.kind,
    system_type: b.systemType ?? null,
    code: b.code ?? '',
    config_schema: b.configSchema ?? [],
    output_schema: b.outputSchema ?? [],
    default_config: b.defaultConfig ?? {},
    is_builtin: b.isBuiltin ?? false,
    staff_id: b.staffId ?? null,
    organization_id: b.organizationId ?? null,
    updated_at: new Date().toISOString()
  }
}

export async function listBlocks(): Promise<BlockDef[]> {
  const u = requireCurrentUser()
  const admin = await resolveAdminTenant()
  // Show: blocks của staff hiện tại + built-in của admin tenant + legacy NULL
  const orClauses = [`staff_id.eq.${u.staffId}`, 'staff_id.is.null']
  if (admin && admin.staffId !== u.staffId) {
    orClauses.push(`staff_id.eq.${admin.staffId}`)
  }
  const { data, error } = await client()
    .from('auto_blocks')
    .select('*')
    .or(orClauses.join(','))
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw new Error(`Failed to list blocks: ${error.message}`)
  return (data || []).map(mapFromDB)
}

export async function getBlock(id: number): Promise<BlockDef | null> {
  const { data, error } = await client()
    .from('auto_blocks')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return mapFromDB(data)
}

export async function getBlockByName(name: string): Promise<BlockDef | null> {
  const { data, error } = await client()
    .from('auto_blocks')
    .select('*')
    .eq('name', name)
    .maybeSingle()
  if (error || !data) return null
  return mapFromDB(data)
}

export async function saveBlock(block: Partial<BlockDef> & { name: string; category: BlockDef['category']; kind: BlockDef['kind'] }): Promise<BlockDef> {
  const u = requireCurrentUser()
  const existing = await getBlockByName(block.name)
  const payload = toPayload({
    ...block,
    isBuiltin: block.isBuiltin ?? existing?.isBuiltin ?? false,
    staffId: block.staffId ?? existing?.staffId ?? u.staffId,
    organizationId: block.organizationId ?? existing?.organizationId ?? u.organizationId
  })
  // Upsert by name (UNIQUE constraint)
  const { data, error } = await client()
    .from('auto_blocks')
    .upsert(payload, { onConflict: 'name' })
    .select()
    .single()
  if (error) throw new Error(`Failed to save block: ${error.message}`)
  return mapFromDB(data)
}

export async function deleteBlock(id: number): Promise<void> {
  const u = requireCurrentUser()
  // Block built-in không cho xóa qua API thông thường
  const { error } = await client()
    .from('auto_blocks')
    .delete()
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_builtin', false)
  if (error) throw new Error(`Failed to delete block: ${error.message}`)
}
