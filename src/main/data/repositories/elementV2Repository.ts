import { ElementDef } from '../../../shared/v2Types'
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

function mapFromDB(row: Record<string, unknown>): ElementDef {
  return {
    id: row.id as number,
    name: row.name as string,
    xpath: row.xpath as string,
    description: row.description as string | undefined,
    category: row.category as string | undefined,
    isBuiltin: (row.is_builtin as boolean) ?? false,
    staffId: row.staff_id as number | undefined,
    organizationId: row.organization_id as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function toPayload(e: Partial<ElementDef> & { name: string; xpath: string }) {
  return {
    name: e.name,
    xpath: e.xpath,
    description: e.description ?? null,
    category: e.category ?? null,
    is_builtin: e.isBuiltin ?? false,
    staff_id: e.staffId ?? null,
    organization_id: e.organizationId ?? null,
    updated_at: new Date().toISOString()
  }
}

// In-memory cache cho `helpers.element(name)` lookup. Invalidate khi save/delete.
const _xpathCache = new Map<string, string>()
let _cacheReady = false

async function ensureCache(): Promise<void> {
  if (_cacheReady) return
  const { data, error } = await client()
    .from('auto_elements')
    .select('name, xpath')
  if (error) throw new Error(`Failed to load elements cache: ${error.message}`)
  _xpathCache.clear()
  for (const r of data || []) {
    _xpathCache.set(r.name as string, r.xpath as string)
  }
  _cacheReady = true
}

export function invalidateElementCache(): void {
  _cacheReady = false
  _xpathCache.clear()
}

export async function resolveXpathByName(name: string): Promise<string> {
  await ensureCache()
  const xpath = _xpathCache.get(name)
  if (!xpath) {
    // 1 attempt re-fetch trong trường hợp element được thêm mới sau khi cache load
    invalidateElementCache()
    await ensureCache()
    const retry = _xpathCache.get(name)
    if (!retry) throw new Error(`Element không tìm thấy: ${name}`)
    return retry
  }
  return xpath
}

export async function listElements(): Promise<ElementDef[]> {
  const u = requireCurrentUser()
  const admin = await resolveAdminTenant()
  const orClauses = [`staff_id.eq.${u.staffId}`, 'staff_id.is.null']
  if (admin && admin.staffId !== u.staffId) {
    orClauses.push(`staff_id.eq.${admin.staffId}`)
  }
  const { data, error } = await client()
    .from('auto_elements')
    .select('*')
    .or(orClauses.join(','))
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw new Error(`Failed to list elements: ${error.message}`)
  return (data || []).map(mapFromDB)
}

export async function getElement(id: number): Promise<ElementDef | null> {
  const { data, error } = await client()
    .from('auto_elements')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return mapFromDB(data)
}

export async function saveElement(el: Partial<ElementDef> & { name: string; xpath: string }): Promise<ElementDef> {
  const u = requireCurrentUser()
  const existing = await getElementByName(el.name)
  const payload = toPayload({
    ...el,
    isBuiltin: el.isBuiltin ?? existing?.isBuiltin ?? false,
    staffId: el.staffId ?? existing?.staffId ?? u.staffId,
    organizationId: el.organizationId ?? existing?.organizationId ?? u.organizationId
  })
  const { data, error } = await client()
    .from('auto_elements')
    .upsert(payload, { onConflict: 'name' })
    .select()
    .single()
  if (error) throw new Error(`Failed to save element: ${error.message}`)
  invalidateElementCache()
  return mapFromDB(data)
}

async function getElementByName(name: string): Promise<ElementDef | null> {
  const { data, error } = await client()
    .from('auto_elements')
    .select('*')
    .eq('name', name)
    .maybeSingle()
  if (error || !data) return null
  return mapFromDB(data)
}

export async function deleteElement(id: number): Promise<void> {
  const u = requireCurrentUser()
  const { error } = await client()
    .from('auto_elements')
    .delete()
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_builtin', false)
  if (error) throw new Error(`Failed to delete element: ${error.message}`)
  invalidateElementCache()
}
