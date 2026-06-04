import { AutoProxy, ProxyProtocol } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapProxyFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()
const PROTOCOLS: ProxyProtocol[] = ['http', 'https', 'socks5']

function sanitizeProxy(proxy: AutoProxy): AutoProxy {
  return { ...proxy, password: null }
}

function normalizeProtocol(value: unknown): ProxyProtocol {
  const protocol = String(value || '').trim().toLowerCase() as ProxyProtocol
  if (!PROTOCOLS.includes(protocol)) {
    throw new Error('Loại proxy không hợp lệ')
  }
  return protocol
}

function normalizeHost(value: unknown): string {
  const host = String(value || '').trim()
  if (!host) throw new Error('Host proxy không được để trống')
  return host
}

function normalizePort(value: unknown): number {
  const port = Math.floor(Number(value))
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error('Port proxy phải nằm trong khoảng 1-65535')
  }
  return port
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === null) return null
  const text = String(value ?? '').trim()
  return text || null
}

function buildProxyPayload(proxy: Partial<AutoProxy>, existing?: AutoProxy | null): Record<string, unknown> {
  const name = String(proxy.name ?? existing?.name ?? '').trim()
  if (!name) throw new Error('Tên proxy không được để trống')
  const usernameSource = Object.prototype.hasOwnProperty.call(proxy, 'username')
    ? proxy.username
    : existing?.username

  return {
    name,
    protocol: normalizeProtocol(proxy.protocol ?? existing?.protocol ?? 'http'),
    host: normalizeHost(proxy.host ?? existing?.host),
    port: normalizePort(proxy.port ?? existing?.port),
    username: normalizeOptionalText(usernameSource),
    password: proxy.password === undefined
      ? normalizeOptionalText(existing?.password)
      : normalizeOptionalText(proxy.password),
    is_active: proxy.isActive ?? existing?.isActive ?? true
  }
}

async function countProxyUsage(proxyId: number, staffId: number): Promise<number> {
  const { count, error } = await client()
    .from('auto_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('proxy_id', proxyId)
    .eq('staff_id', staffId)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to check proxy usage: ${error.message}`)
  return count || 0
}

async function assertNoRunningAccountsForProxy(proxyId: number, staffId: number): Promise<void> {
  const { data, error } = await client()
    .from('auto_accounts')
    .select('name')
    .eq('proxy_id', proxyId)
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .eq('status', 'đang chạy')
    .limit(3)

  if (error) throw new Error(`Failed to check running accounts for proxy: ${error.message}`)
  if ((data || []).length > 0) {
    const names = data.map(row => String(row.name || '')).filter(Boolean).join(', ')
    throw new Error(`Chỉ được sửa proxy khi tài khoản đang dùng không chạy${names ? `: ${names}` : ''}`)
  }
}

export async function listProxies(): Promise<AutoProxy[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_proxies')
    .select('*')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list proxies: ${error.message}`)

  const proxies = (data || []).map(row => mapProxyFromDB(row))
  const { data: accounts, error: accountError } = await client()
    .from('auto_accounts')
    .select('proxy_id')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .not('proxy_id', 'is', null)

  if (accountError) throw new Error(`Failed to count proxy usage: ${accountError.message}`)

  const usageByProxyId = new Map<number, number>()
  for (const account of accounts || []) {
    const proxyId = Number(account.proxy_id)
    if (!Number.isFinite(proxyId)) continue
    usageByProxyId.set(proxyId, (usageByProxyId.get(proxyId) || 0) + 1)
  }

  return proxies.map(proxy => sanitizeProxy({
    ...proxy,
    usageCount: usageByProxyId.get(proxy.id) || 0
  }))
}

export async function getProxy(id: number): Promise<AutoProxy | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_proxies')
    .select('*')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to get proxy: ${error.message}`)
  return data ? mapProxyFromDB(data) : null
}

export async function createProxy(proxy: Partial<AutoProxy>): Promise<AutoProxy> {
  const u = requireCurrentUser()
  const payload = {
    ...buildProxyPayload(proxy),
    staff_id: u.staffId,
    organization_id: u.organizationId
  }

  const { data, error } = await client()
    .from('auto_proxies')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create proxy: ${error.message}`)
  return sanitizeProxy(mapProxyFromDB(data))
}

export async function updateProxy(id: number, updates: Partial<AutoProxy>): Promise<AutoProxy> {
  const u = requireCurrentUser()
  const existing = await getProxy(id)
  if (!existing) throw new Error('Không tìm thấy proxy')

  await assertNoRunningAccountsForProxy(id, u.staffId)

  const payload = {
    ...buildProxyPayload(updates, existing),
    updated_at: new Date().toISOString()
  }

  const { data, error } = await client()
    .from('auto_proxies')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .select()
    .single()

  if (error) throw new Error(`Failed to update proxy: ${error.message}`)
  return sanitizeProxy(mapProxyFromDB(data))
}

export async function deleteProxy(id: number): Promise<void> {
  const u = requireCurrentUser()
  const usageCount = await countProxyUsage(id, u.staffId)
  if (usageCount > 0) {
    throw new Error('Không thể xoá proxy khi còn tài khoản đang dùng proxy này')
  }

  const { error } = await client()
    .from('auto_proxies')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to delete proxy: ${error.message}`)
}

export async function validateProxyForAccount(proxyId: number | null | undefined): Promise<number | null> {
  if (proxyId === undefined || proxyId === null) return null

  const proxy = await getProxy(proxyId)
  if (!proxy || !proxy.isActive) throw new Error('Không tìm thấy proxy')
  return proxy.id
}
