import type { AuthAccountProduct, AuthEntitlements, AuthUser } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import {
  loadOrganizationAccountProducts,
  loadOrganizationEntitlements
} from './entitlementRepository'
import { loadStaffZaloServerModeSnapshot } from './zaloRuntimeModeRepository'

const client = () => getSupabaseClient()
const PAGE_SIZE = 1000
const ID_CHUNK_SIZE = 100
const CONTEXT_CONCURRENCY = 10

interface ServerStaffRow {
  id: number
  organization_id: number
  name: string
  phone?: string | null
  username: string
  is_active: boolean
  is_admin_akabiz: boolean
  use_test_workflow: boolean
  is_zalo_server: boolean
}

export interface ZaloServerRuntimeUser extends AuthUser {
  zaloRuntimeModeRevision: string
}

interface ServerAuthStaffRow extends ServerStaffRow {
  password: string
}

interface ServerOrganizationContext {
  organizationId: number
  organizationName: string
  entitlements: AuthEntitlements
  accountProducts: AuthAccountProduct[]
}

const DISCOVERY_STAFF_SELECT = [
  'id',
  'organization_id',
  'name',
  'phone',
  'username',
  'is_active',
  'is_admin_akabiz',
  'use_test_workflow',
  'is_zalo_server'
].join(', ')

const AUTH_STAFF_SELECT = `${DISCOVERY_STAFF_SELECT}, password`

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function throwServerRuntimeTechnicalError(context: string, error: unknown): never {
  console.error(`[zalo-server-runtime] ${context}:`, error)
  throw new Error('Không thể xác thực Zalo Server. Vui lòng thử lại sau.')
}

async function buildServerAuthUser(
  staff: ServerStaffRow,
  context: ServerOrganizationContext
): Promise<ZaloServerRuntimeUser> {
  const modeSnapshot = await loadStaffZaloServerModeSnapshot(staff.id)
  return {
    staffId: staff.id,
    organizationId: staff.organization_id,
    name: staff.name,
    username: staff.username,
    phone: staff.phone || null,
    organizationName: context.organizationName,
    isAdminAkabiz: !!staff.is_admin_akabiz,
    useTestWorkflow: !!staff.use_test_workflow,
    isZaloServer: !!staff.is_zalo_server,
    entitlements: context.entitlements,
    accountProducts: context.accountProducts,
    zaloRuntimeModeRevision: modeSnapshot.revision
  }
}

async function loadActiveServerStaffRows(): Promise<ServerStaffRow[]> {
  const staffRows: ServerStaffRow[] = []
  let from = 0

  while (true) {
    const { data, error } = await client()
      .from('org_staff')
      .select(DISCOVERY_STAFF_SELECT)
      .eq('is_active', true)
      .eq('is_zalo_server', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throwServerRuntimeTechnicalError('discover Zalo server staff', error)

    const rows = (data || []) as unknown as ServerStaffRow[]
    staffRows.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return staffRows
}

async function loadOrganizationNameMap(organizationIds: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>()

  for (const idChunk of chunkValues(organizationIds, ID_CHUNK_SIZE)) {
    const { data, error } = await client()
      .from('org_organization')
      .select('id, name')
      .in('id', idChunk)

    if (error) throwServerRuntimeTechnicalError('load server runtime organizations', error)

    for (const row of data || []) {
      const organizationId = Number(row.id)
      if (!Number.isFinite(organizationId) || organizationId <= 0) continue
      names.set(organizationId, String(row.name || ''))
    }
  }

  return names
}

async function loadOrganizationContexts(
  organizationIds: number[],
  organizationNames: Map<number, string>
): Promise<Map<number, ServerOrganizationContext>> {
  const contexts = new Map<number, ServerOrganizationContext>()

  for (const idChunk of chunkValues(organizationIds, CONTEXT_CONCURRENCY)) {
    const loaded = await Promise.all(idChunk.map(async organizationId => {
      const [entitlements, accountProducts] = await Promise.all([
        loadOrganizationEntitlements(organizationId),
        loadOrganizationAccountProducts(organizationId)
      ])
      const context: ServerOrganizationContext = {
        organizationId,
        organizationName: organizationNames.get(organizationId) || '',
        entitlements,
        accountProducts
      }
      return entitlements.zalo ? context : null
    }))

    for (const context of loaded) {
      if (context) contexts.set(context.organizationId, context)
    }
  }

  return contexts
}

async function loadOrganizationContext(organizationId: number): Promise<ServerOrganizationContext | null> {
  const [organizationNames, entitlements, accountProducts] = await Promise.all([
    loadOrganizationNameMap([organizationId]),
    loadOrganizationEntitlements(organizationId),
    loadOrganizationAccountProducts(organizationId)
  ])
  const context: ServerOrganizationContext = {
    organizationId,
    organizationName: organizationNames.get(organizationId) || '',
    entitlements,
    accountProducts
  }
  return entitlements.zalo ? context : null
}

/**
 * Discover every active staff explicitly assigned to the server runtime and
 * whose organization has an active Zalo entitlement (product 16 or 18).
 * This does not read passwords or bind/check a device.
 */
export async function listActiveZaloServerUsers(): Promise<ZaloServerRuntimeUser[]> {
  const staffRows = await loadActiveServerStaffRows()
  const candidateOrganizationIds = Array.from(new Set(staffRows.map(row => Number(row.organization_id))))
    .filter(organizationId => Number.isSafeInteger(organizationId) && organizationId > 0)
  if (candidateOrganizationIds.length === 0) return []

  const organizationNames = await loadOrganizationNameMap(candidateOrganizationIds)
  const contexts = await loadOrganizationContexts(candidateOrganizationIds, organizationNames)
  const activeOrganizationIds = Array.from(contexts.keys())
  if (activeOrganizationIds.length === 0) return []

  const candidates = staffRows.flatMap(staff => {
    const context = contexts.get(staff.organization_id)
    return context ? [{ staff, context }] : []
  })
  return Promise.all(candidates.map(({ staff, context }) => buildServerAuthUser(staff, context)))
}

/**
 * Authenticate a desktop client for the Zalo server channel without touching
 * the one-device desktop lock. Invalid credentials, inactive staff, or a
 * server mode disabled, or a missing/expired Zalo entitlement return null;
 * database failures still throw.
 */
export async function authenticateZaloServerClient(
  username: string,
  password: string
): Promise<ZaloServerRuntimeUser | null> {
  return authenticateZaloRuntimeUser(username, password, true)
}

/**
 * Authenticate a staff that is asking the server to hand ownership back to a
 * local desktop. The mode may already be false by the time this request
 * arrives, so only active staff, credentials and an active Zalo entitlement
 * are required.
 */
export async function authenticateZaloRuntimeHandoff(
  username: string,
  password: string
): Promise<ZaloServerRuntimeUser | null> {
  return authenticateZaloRuntimeUser(username, password, false)
}

/**
 * Revalidate the revocable control session behind a short-lived realtime ticket.
 * Staff mode/product capability is cached independently so many tabs do not
 * multiply the heavier entitlement query.
 */
export async function hasLiveControlRealtimeSession(
  staffId: number,
  organizationId: number,
  sessionId: string
): Promise<boolean> {
  const normalizedStaffId = Math.floor(Number(staffId))
  const normalizedOrganizationId = Math.floor(Number(organizationId))
  const normalizedSessionId = String(sessionId || '').trim()
  if (
    !Number.isSafeInteger(normalizedStaffId) || normalizedStaffId <= 0 ||
    !Number.isSafeInteger(normalizedOrganizationId) || normalizedOrganizationId <= 0 ||
    !normalizedSessionId
  ) return false

  const { data: sessionData, error: sessionError } = await client()
    .rpc('validate_control_session', {
      p_session_id: normalizedSessionId,
      p_staff_id: normalizedStaffId,
      p_organization_id: normalizedOrganizationId
    })

  if (sessionError) throwServerRuntimeTechnicalError('revalidate control realtime session', sessionError)
  return sessionData === true
}

export async function hasLiveZaloServerRealtimeCapability(
  staffId: number,
  organizationId: number
): Promise<boolean> {
  const normalizedStaffId = Math.floor(Number(staffId))
  const normalizedOrganizationId = Math.floor(Number(organizationId))
  if (
    !Number.isSafeInteger(normalizedStaffId) || normalizedStaffId <= 0 ||
    !Number.isSafeInteger(normalizedOrganizationId) || normalizedOrganizationId <= 0
  ) return false

  const { data, error } = await client()
    .from('org_staff')
    .select('id, organization_id, is_active, is_zalo_server')
    .eq('id', normalizedStaffId)
    .maybeSingle()

  if (error) throwServerRuntimeTechnicalError('revalidate Zalo server realtime access', error)
  const staff = data as {
    id?: number | null
    organization_id?: number | null
    is_active?: boolean | null
    is_zalo_server?: boolean | null
  } | null
  if (
    !staff ||
    Number(staff.organization_id) !== normalizedOrganizationId ||
    !staff.is_active ||
    !staff.is_zalo_server
  ) return false

  const organizationNames = await loadOrganizationNameMap([normalizedOrganizationId])
  if (!organizationNames.has(normalizedOrganizationId)) return false
  const entitlements = await loadOrganizationEntitlements(normalizedOrganizationId)
  return entitlements.zalo
}

async function authenticateZaloRuntimeUser(
  username: string,
  password: string,
  requireServerMode: boolean
): Promise<ZaloServerRuntimeUser | null> {
  const normalizedUsername = String(username || '').trim()
  const rawPassword = password || ''
  if (!normalizedUsername || !rawPassword) return null

  const { data, error } = await client()
    .from('org_staff')
    .select(AUTH_STAFF_SELECT)
    .eq('username', normalizedUsername)
    .maybeSingle()

  if (error) throwServerRuntimeTechnicalError('authenticate Zalo runtime client', error)

  const staff = data as unknown as ServerAuthStaffRow | null
  if (
    !staff ||
    !staff.is_active ||
    (requireServerMode && !staff.is_zalo_server) ||
    staff.password !== rawPassword
  ) return null

  const context = await loadOrganizationContext(staff.organization_id)
  return context ? await buildServerAuthUser(staff, context) : null
}
