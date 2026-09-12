import {
  AuthLoginResult,
  AuthUser,
  DeviceLockResetResult,
  LoginPreferences,
  SavedLoginCredentials
} from '../../../shared/types'
import { getCurrentDeviceIdentity, getLegacyDeviceIdentity } from '../../services/deviceIdentity'
import { getDeviceChangeRequests } from '../../services/deviceChangeService'
import { requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import {
  ACCOUNT_EXPIRED_MESSAGE,
  ensureAkaAgentSubscriptionActive,
  loadOrganizationAccountProducts,
  loadOrganizationChatSyncProducts,
  loadOrganizationEntitlementAccess
} from './entitlementRepository'
import { loadStaffZaloServerModeSnapshot } from './zaloRuntimeModeRepository'

const client = () => getSupabaseClient()

export const DEFAULT_LOGIN_PREFERENCES: LoginPreferences = {
  rememberLogin: true,
  autoLogin: true,
  startupEnabled: false
}

interface StaffDeviceColumns {
  aka_agent_device_fingerprint_hash?: string | null
  device_fingerprint_hash?: string | null
  device_label?: string | null
  device_platform?: string | null
  device_bound_at?: string | null
  device_last_seen_at?: string | null
}

interface StaffRow extends StaffDeviceColumns {
  id: number
  organization_id: number
  name: string
  phone?: string | null
  username: string
  password: string
  is_active: boolean
  is_admin_akabiz: boolean
  use_test_workflow: boolean
  is_policy_accepted: boolean
  policy_accepted_at?: string | null
}

interface DeviceLoginSettingsRow {
  id: number
  staff_id: number
  organization_id?: number | null
  device_fingerprint_hash: string
  device_label?: string | null
  device_platform?: string | null
  remember_login?: boolean | null
  auto_login?: boolean | null
  startup_enabled?: boolean | null
  last_login_at?: string | null
  last_used_at?: string | null
  is_delete?: boolean | null
  created_at?: string
  updated_at?: string
}

const STAFF_SELECT = [
  'id',
  'organization_id',
  'name',
  'phone',
  'username',
  'password',
  'is_active',
  'is_admin_akabiz',
  'use_test_workflow',
  'is_policy_accepted',
  'policy_accepted_at',
  'aka_agent_device_fingerprint_hash',
  'device_fingerprint_hash',
  'device_label',
  'device_platform',
  'device_bound_at',
  'device_last_seen_at'
].join(', ')

export function normalizeLoginPreferences(options?: Partial<LoginPreferences> | null): LoginPreferences {
  const merged = {
    ...DEFAULT_LOGIN_PREFERENCES,
    ...(options || {})
  }

  const next: LoginPreferences = {
    rememberLogin: !!merged.rememberLogin,
    autoLogin: !!merged.autoLogin,
    startupEnabled: !!merged.startupEnabled
  }

  if (options?.rememberLogin === false) next.autoLogin = false
  if (next.autoLogin) next.rememberLogin = true
  return next
}

function deviceLockedMessage(): string {
  return 'Tài khoản này đang liên kết với máy tính khác. Vui lòng chọn Đổi máy tính trên trang đăng nhập hoặc liên hệ hỗ trợ.'
}

function normalizeDeviceHash(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function throwAuthTechnicalError(context: string, userMessage: string, error: unknown): never {
  console.error(`[auth] ${context}:`, error)
  throw new Error(userMessage)
}

async function ensureStaffSubscriptionActive(staff: Pick<StaffRow, 'organization_id'>): Promise<void> {
  await ensureAkaAgentSubscriptionActive(staff.organization_id)
}

async function loadStaffById(staffId: number): Promise<StaffRow | null> {
  const { data, error } = await client()
    .from('org_staff')
    .select(STAFF_SELECT)
    .eq('id', staffId)
    .maybeSingle()

  if (error) {
    throwAuthTechnicalError(
      'load remembered staff',
      'Không thể tải tài khoản đã ghi nhớ. Vui lòng đăng nhập lại.',
      error
    )
  }
  return data as unknown as StaffRow | null
}

async function buildAuthUser(staffRow: StaffRow, deviceRecord: StaffDeviceColumns): Promise<AuthUser> {
  // Lookup org separately — embed gặp ambiguous FK (org_staff.organization_id vs org_organization.staff_admin_id).
  const { data: org, error: orgErr } = await client()
    .from('org_organization')
    .select('id, name')
    .eq('id', staffRow.organization_id)
    .maybeSingle()

  if (orgErr) {
    throwAuthTechnicalError(
      'load auth organization',
      'Đăng nhập thất bại. Vui lòng thử lại sau.',
      orgErr
    )
  }

  const [entitlementAccess, accountProducts, chatSyncProducts, zaloRuntimeMode] = await Promise.all([
    loadOrganizationEntitlementAccess(staffRow.organization_id),
    loadOrganizationAccountProducts(staffRow.organization_id),
    loadOrganizationChatSyncProducts(staffRow.organization_id),
    loadStaffZaloServerModeSnapshot(staffRow.id)
  ])
  const { entitlements, zaloAccountCapabilities, chatSyncEnabled } = entitlementAccess

  return {
    staffId: staffRow.id,
    organizationId: staffRow.organization_id,
    name: staffRow.name,
    username: staffRow.username,
    phone: staffRow.phone || null,
    organizationName: (org?.name as string) || '',
    isAdminAkabiz: !!staffRow.is_admin_akabiz,
    useTestWorkflow: !!staffRow.use_test_workflow,
    isZaloServer: zaloRuntimeMode.isZaloServer && !zaloAccountCapabilities.web,
    isZaloShowWeb: zaloAccountCapabilities.web,
    zaloAccountCapabilities,
    entitlements,
    accountProducts,
    isChatSync: chatSyncEnabled,
    chatSyncProducts,
    deviceLabel: deviceRecord.device_label || null,
    devicePlatform: deviceRecord.device_platform || null,
    deviceBoundAt: deviceRecord.device_bound_at || null,
    deviceLastSeenAt: deviceRecord.device_last_seen_at || null
  }
}

async function ensureStaffDeviceLock(staff: StaffRow): Promise<StaffDeviceColumns> {
  const device = await getCurrentDeviceIdentity()
  const currentHash = normalizeDeviceHash(staff.aka_agent_device_fingerprint_hash)
  if (currentHash && currentHash !== device.fingerprintHash) throw new Error(deviceLockedMessage())
  if (!currentHash) {
    const { data, error } = await client().from('org_staff')
      .update({ aka_agent_device_fingerprint_hash: device.fingerprintHash })
      .eq('id', staff.id).is('aka_agent_device_fingerprint_hash', null)
      .select('aka_agent_device_fingerprint_hash').maybeSingle()
    if (normalizeDeviceHash(data?.aka_agent_device_fingerprint_hash) !== device.fingerprintHash) {
      // A lost response does not imply rollback. Confirm the winning binding.
      const { data: latest, error: readError } = await client().from('org_staff')
        .select('aka_agent_device_fingerprint_hash').eq('id', staff.id).maybeSingle()
      if (readError) throwAuthTechnicalError('confirm v2 binding', 'Không thể xác nhận liên kết máy. Vui lòng thử lại.', readError)
      if (normalizeDeviceHash(latest?.aka_agent_device_fingerprint_hash) !== device.fingerprintHash) {
        if (error && !latest?.aka_agent_device_fingerprint_hash) throwAuthTechnicalError('bind v2 device', 'Không thể liên kết máy. Vui lòng thử lại.', error)
        throw new Error(deviceLockedMessage())
      }
    }
  } else {
    // The login snapshot can predate a reset/rebind while entitlement checks run.
    // Confirm the live binding even when that snapshot matched this machine.
    const { data: latest, error } = await client().from('org_staff')
      .select('aka_agent_device_fingerprint_hash').eq('id', staff.id).maybeSingle()
    if (error) throwAuthTechnicalError('confirm v2 binding', 'Không thể xác nhận liên kết máy. Vui lòng thử lại.', error)
    if (normalizeDeviceHash(latest?.aka_agent_device_fingerprint_hash) !== device.fingerprintHash) throw new Error(deviceLockedMessage())
  }
  return { aka_agent_device_fingerprint_hash: device.fingerprintHash, device_label: device.label, device_platform: device.platform }
}

function mapLoginPreferencesFromRow(row: DeviceLoginSettingsRow | null | undefined): LoginPreferences {
  if (!row) return DEFAULT_LOGIN_PREFERENCES
  return normalizeLoginPreferences({
    rememberLogin: row.remember_login ?? DEFAULT_LOGIN_PREFERENCES.rememberLogin,
    autoLogin: row.auto_login ?? DEFAULT_LOGIN_PREFERENCES.autoLogin,
    startupEnabled: row.startup_enabled ?? DEFAULT_LOGIN_PREFERENCES.startupEnabled
  })
}

/** Only for first migration. Password is loaded after both fingerprint gates pass. */
export async function loadLegacyLoginCandidate(): Promise<{ loginOptions: LoginPreferences; credentials: SavedLoginCredentials | null } | null> {
  const device = await getCurrentDeviceIdentity()
  const { data: existing, error: existenceError } = await client().from('org_staff').select('id')
    .eq('aka_agent_device_fingerprint_hash', device.fingerprintHash).limit(1)
  if (existenceError) throwAuthTechnicalError('check v2 fingerprint', 'Không thể kiểm tra máy. Vui lòng đăng nhập thủ công hoặc thử lại.', existenceError)
  if (existing?.length) return null
  const legacy = await getLegacyDeviceIdentity()
  // Deliberately count before active/entitlement/remember filters. Two is enough to reject ambiguity.
  const { data: matches, error } = await client().from('org_staff')
    .select('id, aka_agent_device_fingerprint_hash').eq('device_fingerprint_hash', legacy.fingerprintHash).limit(2)
  if (error) throwAuthTechnicalError('check legacy fingerprint', 'Không thể lấy thông tin ghi nhớ cũ. Vui lòng đăng nhập thủ công.', error)
  if (matches?.length !== 1) return null
  const match = matches[0]
  if (normalizeDeviceHash(match.aka_agent_device_fingerprint_hash)) return null
  const { data: settings, error: settingsError } = await client().from('auto_staff_device_login_settings')
    .select('remember_login, auto_login, startup_enabled').eq('staff_id', match.id)
    .eq('device_fingerprint_hash', legacy.fingerprintHash).eq('is_delete', false).maybeSingle()
  if (settingsError) throwAuthTechnicalError('load legacy options', 'Không thể đọc tuỳ chọn cũ. Vui lòng đăng nhập thủ công.', settingsError)
  if (!settings) return null
  const loginOptions = mapLoginPreferencesFromRow(settings as DeviceLoginSettingsRow)
  if (!loginOptions.rememberLogin) return { loginOptions, credentials: null }
  const staff = await loadStaffById(Number(match.id))
  if (!staff || !staff.is_active || normalizeDeviceHash(staff.aka_agent_device_fingerprint_hash)
    || normalizeDeviceHash(staff.device_fingerprint_hash) !== legacy.fingerprintHash) return null
  await ensureStaffSubscriptionActive(staff)
  return { loginOptions, credentials: { username: staff.username, password: staff.password } }
}

function hasAcceptedPolicy(staff: StaffRow): boolean {
  return staff.is_policy_accepted === true
}

async function verifyStaffLogin(username: string, password: string): Promise<StaffRow> {
  const u = (username || '').trim()
  const p = password || ''
  if (!u || !p) throw new Error('Vui lòng nhập tên đăng nhập và mật khẩu.')

  const { data: staff, error } = await client()
    .from('org_staff')
    .select(STAFF_SELECT)
    .eq('username', u)
    .maybeSingle()

  if (error) {
    throwAuthTechnicalError(
      'login staff lookup',
      'Đăng nhập thất bại. Vui lòng thử lại sau.',
      error
    )
  }
  const staffRow = staff as unknown as StaffRow | null
  if (!staffRow) throw new Error('Tên đăng nhập không tồn tại.')
  if (staffRow.password !== p) throw new Error('Mật khẩu không đúng.')
  if (!staffRow.is_active) throw new Error('Tài khoản đã bị khoá.')
  await ensureStaffSubscriptionActive(staffRow)

  return staffRow
}

async function completeStaffLogin(staffRow: StaffRow, assertCurrent?: () => void): Promise<AuthUser> {
  assertCurrent?.()
  const deviceRecord = await ensureStaffDeviceLock(staffRow)
  return buildAuthUser(staffRow, deviceRecord)
}

export async function login(username: string, password: string, assertCurrent?: () => void): Promise<AuthLoginResult> {
  const staffRow = await verifyStaffLogin(username, password)
  if (!hasAcceptedPolicy(staffRow)) {
    return { status: 'policy_required' }
  }

  return {
    status: 'authenticated',
    user: await completeStaffLogin(staffRow, assertCurrent)
  }
}

export async function acceptPolicyAndLogin(username: string, password: string, assertCurrent?: () => void): Promise<AuthUser> {
  const staffRow = await verifyStaffLogin(username, password)

  if (!hasAcceptedPolicy(staffRow)) {
    const now = new Date().toISOString()
    const { error } = await client()
      .from('org_staff')
      .update({
        is_policy_accepted: true,
        policy_accepted_at: now,
        updated_at: now
      })
      .eq('id', staffRow.id)
      .eq('is_policy_accepted', false)

    if (error) {
      throwAuthTechnicalError(
        'accept staff policy',
        'Không thể ghi nhận đồng ý chính sách. Vui lòng thử lại sau.',
        error
      )
    }
  }

  // Re-read and revalidate after the conditional update. This makes concurrent
  // confirmations idempotent while allowing an admin to reset only the boolean.
  const acceptedStaff = await verifyStaffLogin(username, password)
  if (!hasAcceptedPolicy(acceptedStaff)) {
    throw new Error('Không thể ghi nhận đồng ý chính sách. Vui lòng thử lại sau.')
  }

  return completeStaffLogin(acceptedStaff, assertCurrent)
}

export async function resetDeviceLock(user: AuthUser): Promise<DeviceLockResetResult> {
  const credentials = requireCurrentUserCredentials()
  if (credentials.username !== user.username) throw new Error('Phiên đăng nhập không hợp lệ.')
  return getDeviceChangeRequests().reset(credentials.username, 'account_menu', credentials.password)
}

export async function changePassword(user: AuthUser, oldPassword: string, newPassword: string): Promise<{ success: boolean }> {
  const currentPassword = oldPassword || ''
  const nextPassword = newPassword || ''
  if (!nextPassword) throw new Error('Vui lòng nhập mật khẩu mới.')
  if (!currentPassword) throw new Error('Vui lòng nhập mật khẩu cũ.')

  const { data: staff, error } = await client()
    .from('org_staff')
    .select('id, password, is_active')
    .eq('id', user.staffId)
    .maybeSingle()

  if (error) {
    throwAuthTechnicalError(
      'load staff for password change',
      'Đổi mật khẩu thất bại. Vui lòng thử lại sau.',
      error
    )
  }
  const staffRow = staff as unknown as Pick<StaffRow, 'id' | 'password' | 'is_active'> | null
  if (!staffRow) throw new Error('Không tìm thấy tài khoản để đổi mật khẩu.')
  if (!staffRow.is_active) throw new Error('Tài khoản đã bị khoá.')
  if (staffRow.password !== currentPassword) throw new Error('Mật khẩu cũ không đúng.')

  const { error: updateError } = await client()
    .from('org_staff')
    .update({
      password: nextPassword,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.staffId)

  if (updateError) {
    throwAuthTechnicalError(
      'update staff password',
      'Đổi mật khẩu thất bại. Vui lòng thử lại sau.',
      updateError
    )
  }
  return { success: true }
}

export async function updateUseTestWorkflow(user: AuthUser, useTestWorkflow: boolean): Promise<AuthUser> {
  if (!user.isAdminAkabiz) {
    throw new Error('Chỉ admin akaBiz mới được bật/tắt workflow test.')
  }

  const { error } = await client()
    .from('org_staff')
    .update({
      use_test_workflow: useTestWorkflow,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.staffId)

  if (error) {
    throwAuthTechnicalError(
      'update workflow test mode',
      'Không thể lưu chế độ workflow test. Vui lòng thử lại sau.',
      error
    )
  }
  return { ...user, useTestWorkflow }
}
