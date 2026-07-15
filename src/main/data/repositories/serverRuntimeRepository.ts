import type { AuthAccountProduct, AuthEntitlements, AuthUser } from '../../../shared/types'
import { getAuthProductById } from '../../../shared/authProductCatalog'
import { getSupabaseClient } from '../supabaseClient'
import {
  DEFAULT_DEMO_DAILY_SEND_LIMIT,
  ZALO_PRODUCT_IDS,
  emptyAuthEntitlements,
  loadOrganizationAccountProducts,
  loadOrganizationEntitlements
} from './entitlementRepository'
import {
  loadStaffZaloServerModeSnapshot,
  type StaffZaloRuntimeModeSnapshot
} from './zaloRuntimeModeRepository'

const client = () => getSupabaseClient()
const PAGE_SIZE = 1000
const ID_CHUNK_SIZE = 100

interface ServerStaffRow {
  id: number
  organization_id: number
  name: string
  phone?: string | null
  username: string
  is_active: boolean
  is_admin_akabiz: boolean
  use_test_workflow: boolean
}

interface ZaloServerDiscoveryRow {
  staff_id?: number | string | null
  organization_id?: number | string | null
  staff_name?: string | null
  staff_phone?: string | null
  username?: string | null
  is_admin_akabiz?: boolean | null
  use_test_workflow?: boolean | null
  organization_name?: string | null
  entitlement_id?: number | string | null
  mode_revision?: string | null
  product_id?: number | string | null
  product_name?: string | null
  package_name?: string | null
  package_type?: string | null
  expiration_date?: string | null
  max_sends_per_day?: number | string | null
  max_accounts?: number | string | null
  created_at?: string | null
}

interface ZaloServerDiscoveryPage {
  items?: unknown
  next_after_staff_id?: number | string | null
}

interface LoadedZaloServerDiscoveryPage {
  users: ZaloServerRuntimeUser[]
  nextAfterStaffId: number | null
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
  'use_test_workflow'
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
  context: ServerOrganizationContext,
  modeSnapshot?: StaffZaloRuntimeModeSnapshot
): Promise<ZaloServerRuntimeUser> {
  const resolvedModeSnapshot = modeSnapshot || await loadStaffZaloServerModeSnapshot(staff.id)
  return {
    staffId: staff.id,
    organizationId: staff.organization_id,
    name: staff.name,
    username: staff.username,
    phone: staff.phone || null,
    organizationName: context.organizationName,
    isAdminAkabiz: !!staff.is_admin_akabiz,
    useTestWorkflow: !!staff.use_test_workflow,
    isZaloServer: resolvedModeSnapshot.isZaloServer,
    entitlements: context.entitlements,
    accountProducts: context.accountProducts,
    zaloRuntimeModeRevision: resolvedModeSnapshot.revision
  }
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function requirePositiveSafeInteger(value: unknown, field: string): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${field} returned by Zalo server discovery`)
  }
  return parsed
}

function buildDiscoveredZaloServerUser(row: ZaloServerDiscoveryRow): ZaloServerRuntimeUser {
  const staffId = requirePositiveSafeInteger(row.staff_id, 'staff_id')
  const organizationId = requirePositiveSafeInteger(row.organization_id, 'organization_id')
  const entitlementId = requirePositiveSafeInteger(row.entitlement_id, 'entitlement_id')
  const productId = requirePositiveSafeInteger(row.product_id, 'product_id')
  if (!ZALO_PRODUCT_IDS.some(candidate => candidate === productId)) {
    throw new Error(`Invalid Zalo product_id returned for staff ${staffId}`)
  }

  const username = String(row.username || '').trim()
  const revision = String(row.mode_revision || '').trim()
  if (!username) throw new Error(`Missing username returned for staff ${staffId}`)
  if (!revision.startsWith(`${entitlementId}:`)) {
    throw new Error(`Invalid mode_revision returned for staff ${staffId}`)
  }

  const packageType = row.package_type == null
    ? null
    : String(row.package_type).trim() || null
  const maxAccounts = normalizePositiveInteger(row.max_accounts)
  const configuredDailySendLimit = normalizePositiveInteger(row.max_sends_per_day)
  const dailySendLimit = packageType?.toLowerCase() === 'demo'
    ? configuredDailySendLimit ?? DEFAULT_DEMO_DAILY_SEND_LIMIT
    : configuredDailySendLimit
  const entitlements = emptyAuthEntitlements()
  entitlements.zalo = true
  entitlements.dailySendLimits.zalo = dailySendLimit
  entitlements.accountLimits.zalo = maxAccounts

  const productName = String(row.product_name || '').trim()
  const packageName = String(row.package_name || '').trim()
  const productCatalogItem = getAuthProductById(productId)
  const accountProduct: AuthAccountProduct = {
    feature: 'zalo',
    productId,
    productName,
    packageName,
    packageType,
    displayName: productCatalogItem?.label || productName || packageName || 'Sản phẩm',
    displayOrder: productCatalogItem?.order ?? 99,
    expirationDate: row.expiration_date ? String(row.expiration_date) : null,
    maxAccounts,
    isActive: true
  }

  return {
    staffId,
    organizationId,
    name: String(row.staff_name || ''),
    username,
    phone: row.staff_phone ? String(row.staff_phone) : null,
    organizationName: String(row.organization_name || ''),
    isAdminAkabiz: row.is_admin_akabiz === true,
    useTestWorkflow: row.use_test_workflow === true,
    isZaloServer: true,
    entitlements,
    accountProducts: [accountProduct],
    zaloRuntimeModeRevision: revision
  }
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

function toZaloOnlyOrganizationContext(context: ServerOrganizationContext): ServerOrganizationContext {
  const entitlements = emptyAuthEntitlements()
  entitlements.zalo = context.entitlements.zalo
  entitlements.dailySendLimits.zalo = context.entitlements.dailySendLimits.zalo
  entitlements.accountLimits.zalo = context.entitlements.accountLimits.zalo
  return {
    organizationId: context.organizationId,
    organizationName: context.organizationName,
    entitlements,
    accountProducts: context.accountProducts
      .filter(product => product.feature === 'zalo' && product.isActive)
      .slice(0, 1)
  }
}

async function loadDiscoveryPage(
  afterStaffId: number,
  limit: number
): Promise<LoadedZaloServerDiscoveryPage> {
  if (!Number.isSafeInteger(afterStaffId) || afterStaffId < 0) {
    throw new Error('Zalo server discovery cursor must be zero or a positive integer')
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > PAGE_SIZE) {
    throw new Error(`Zalo server discovery page size must be between 1 and ${PAGE_SIZE}`)
  }

  const { data, error } = await client().rpc('discover_zalo_server_runtime_users', {
    p_after_staff_id: afterStaffId,
    p_limit: limit
  })
  if (error) throwServerRuntimeTechnicalError('discover Zalo server runtime users', error)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throwServerRuntimeTechnicalError(
      'discover Zalo server runtime users',
      new Error('Discovery RPC returned an invalid page payload')
    )
  }

  const page = data as ZaloServerDiscoveryPage
  if (!Array.isArray(page.items)) {
    throwServerRuntimeTechnicalError(
      'discover Zalo server runtime users',
      new Error('Discovery RPC returned a page without an items array')
    )
  }
  if (page.items.length > limit) {
    throwServerRuntimeTechnicalError(
      'discover Zalo server runtime users',
      new Error(`Discovery RPC exceeded its requested page size: ${page.items.length}`)
    )
  }

  const users: ZaloServerRuntimeUser[] = []
  let pageLastStaffId = afterStaffId
  for (const row of page.items as ZaloServerDiscoveryRow[]) {
    let user: ZaloServerRuntimeUser
    try {
      user = buildDiscoveredZaloServerUser(row)
    } catch (buildError) {
      throwServerRuntimeTechnicalError('validate Zalo server discovery row', buildError)
    }
    if (user.staffId <= pageLastStaffId) {
      throwServerRuntimeTechnicalError(
        'validate Zalo server discovery pagination',
        new Error(`Non-monotonic or duplicate staff_id ${user.staffId} after ${pageLastStaffId}`)
      )
    }
    pageLastStaffId = user.staffId
    users.push(user)
  }

  if (page.next_after_staff_id == null) {
    return { users, nextAfterStaffId: null }
  }

  let nextAfterStaffId: number
  try {
    nextAfterStaffId = requirePositiveSafeInteger(
      page.next_after_staff_id,
      'next_after_staff_id'
    )
  } catch (cursorError) {
    throwServerRuntimeTechnicalError('validate Zalo server discovery pagination', cursorError)
  }
  if (
    users.length !== limit ||
    nextAfterStaffId !== pageLastStaffId ||
    nextAfterStaffId <= afterStaffId
  ) {
    throwServerRuntimeTechnicalError(
      'validate Zalo server discovery pagination',
      new Error(`Invalid next_after_staff_id ${nextAfterStaffId} for page after ${afterStaffId}`)
    )
  }
  return { users, nextAfterStaffId }
}

export async function loadActiveZaloServerUser(
  staffId: number
): Promise<ZaloServerRuntimeUser | null> {
  const normalizedStaffId = requirePositiveSafeInteger(staffId, 'staff_id')
  const page = await loadDiscoveryPage(normalizedStaffId - 1, 1)
  const user = page.users[0]
  return user?.staffId === normalizedStaffId ? user : null
}

/**
 * Discover every active staff in an organization whose newest active Zalo
 * entitlement (product 16 or 18) selects the server runtime.
 * This does not read passwords or bind/check a device.
 */
export async function listActiveZaloServerUsers(): Promise<ZaloServerRuntimeUser[]> {
  const users: ZaloServerRuntimeUser[] = []
  const seenStaffIds = new Set<number>()
  let afterStaffId = 0

  while (true) {
    const page = await loadDiscoveryPage(afterStaffId, PAGE_SIZE)
    for (const user of page.users) {
      if (seenStaffIds.has(user.staffId)) {
        throwServerRuntimeTechnicalError(
          'validate Zalo server discovery pagination',
          new Error(`Duplicate staff_id ${user.staffId} across discovery pages`)
        )
      }
      seenStaffIds.add(user.staffId)
      users.push(user)
    }

    if (page.nextAfterStaffId == null) break
    afterStaffId = page.nextAfterStaffId
  }

  return users
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
    .select('id, organization_id, is_active')
    .eq('id', normalizedStaffId)
    .maybeSingle()

  if (error) throwServerRuntimeTechnicalError('revalidate Zalo server realtime access', error)
  const staff = data as {
    id?: number | null
    organization_id?: number | null
    is_active?: boolean | null
  } | null
  if (
    !staff ||
    Number(staff.organization_id) !== normalizedOrganizationId ||
    !staff.is_active
  ) return false

  const modeSnapshot = await loadStaffZaloServerModeSnapshot(normalizedStaffId)
  if (!modeSnapshot.isZaloServer) return false

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
    staff.password !== rawPassword
  ) return null

  if (requireServerMode) {
    const liveServerUser = await loadActiveZaloServerUser(staff.id)
    return liveServerUser?.username === normalizedUsername ? liveServerUser : null
  }

  const context = await loadOrganizationContext(staff.organization_id)
  if (!context) return null
  const modeSnapshot = await loadStaffZaloServerModeSnapshot(staff.id)
  return buildServerAuthUser(staff, toZaloOnlyOrganizationContext(context), modeSnapshot)
}
