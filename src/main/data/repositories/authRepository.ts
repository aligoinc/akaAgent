import { app } from 'electron'
import { join } from 'node:path'
import type { DeviceLoginSource, DeviceV3Decision } from '../../../shared/deviceIdentity'
import { DeviceBindingMigration } from '../../services/deviceBindingMigration'
import {
  AuthLoginResult,
  AuthUser,
  DeviceLockResetResult,
  LoginPreferences,
  SavedLoginCredentials
} from '../../../shared/types'
import { getCurrentDeviceIdentity, getV2DeviceIdentity } from '../../services/deviceIdentity'
import { getDeviceChangeRequests } from '../../services/deviceChangeService'
import { requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import { callStaffClient, callCurrentStaffClient } from './staffClientRepository'
import { recoverStaffDeviceCredentials, registerStaffDeviceRecovery } from '../../services/staffDeviceRecovery'
import {
  ACCOUNT_EXPIRED_MESSAGE,
  ensureAkaAgentSubscriptionActive,
  loadOrganizationAccountProducts,
  loadOrganizationChatSyncProducts,
  loadOrganizationEntitlementAccess
} from './entitlementRepository'
import { loadStaffZaloServerModeSnapshot } from './zaloRuntimeModeRepository'
import { readStaffAccess } from './staffManagementRepository'

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
  is_admin: boolean | null
  is_admin_akabiz: boolean
  use_test_workflow: boolean
  is_policy_accepted: boolean
  policy_accepted_at?: string | null
}

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

function throwAuthTechnicalError(context: string, userMessage: string, error: unknown): never {
  console.error(`[auth] ${context}:`, error)
  throw new Error(userMessage)
}

async function ensureStaffSubscriptionActive(staff: Pick<StaffRow, 'id' | 'organization_id' | 'username' | 'password'>): Promise<void> {
  const access = await readStaffAccess(staff.id, staff.username, staff.password)
  if (!access.isActive) throw new Error('Tài khoản đã bị khoá.')
  if (!access.timeAllowed) throw new Error('Tài khoản nhân viên đã hết hạn sử dụng.')
  await ensureAkaAgentSubscriptionActive(staff.organization_id)
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
    isAdmin: staffRow.is_admin === true,
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

interface PreparedDeviceLogin {
  staff: StaffRow
  device: Awaited<ReturnType<typeof getCurrentDeviceIdentity>>
  legacyHash: string | null
  decision: DeviceV3Decision
  source: DeviceLoginSource
}
async function prepareDeviceLogin(username: string, password: string, source: DeviceLoginSource): Promise<PreparedDeviceLogin> {
  if (!username.trim() || !password) throw new Error('Vui lòng nhập tên đăng nhập và mật khẩu.')
  const device = await getCurrentDeviceIdentity(true)
  // v2 is only a comparison value. Its missing/corrupt storage never creates a new installation ID.
  let legacyHash: string | null = null
  try { legacyHash = (await getV2DeviceIdentity()).fingerprintHash } catch { /* server rejects a bound v2 account without a matching proof */ }
  const profile = await callStaffClient({ username, password }, 'prepare_device_v3', {
    fingerprintHash: device.fingerprintHash, legacyHash, source
  })
  const staff: StaffRow = { ...profile, password }
  await ensureStaffSubscriptionActive(staff)
  const decision = profile.deviceV3!
  if (decision.decision === 'device_locked') throw new Error(deviceLockedMessage())
  return { staff, device, legacyHash, decision, source }
}

/** Called even when auto-login is off, before exposing the remembered username to renderer. */
export async function checkRememberedDeviceLogin(credentials: SavedLoginCredentials): Promise<boolean> {
  const prepared = await prepareDeviceLogin(credentials.username, credentials.password, 'remembered')
  return prepared.decision.decision === 'allowed'
}

export async function recoverDeviceCredentials(): Promise<SavedLoginCredentials | null> {
  const { fingerprintHash } = await getCurrentDeviceIdentity(true)
  const recovered = await recoverStaffDeviceCredentials(fingerprintHash, async () => (await getV2DeviceIdentity()).fingerprintHash)
  if (recovered === 'manual_login_required') return null
  if (!recovered) throw new Error('Máy chưa đăng ký khôi phục. Vui lòng nhập tên đăng nhập và mật khẩu.')
  const prepared = await prepareDeviceLogin(recovered.username, recovered.password, 'recovery')
  if (prepared.decision.decision === 'manual_login_required') return null
  return recovered
}

async function completeDeviceLogin(prepared: PreparedDeviceLogin, assertCurrent?: () => void): Promise<AuthLoginResult> {
  if (prepared.decision.decision === 'manual_login_required') return { status: 'manual_login_required' }
  assertCurrent?.()
  const { staff, device, source, legacyHash } = prepared
  const migration = new DeviceBindingMigration(join(app.getPath('userData'), 'device-binding-v3'))
  const request = await migration.request({ staffId: staff.id, fingerprintHash: device.fingerprintHash,
    legacyHash, source, expected: prepared.decision.binding }, staff.organization_id, prepared.decision.needsBinding)
  // Re-read selected hardware; errors cannot silently substitute other sources.
  if ((await getCurrentDeviceIdentity(true)).fingerprintHash !== device.fingerprintHash) throw new Error(deviceLockedMessage())
  assertCurrent?.()
  const confirmed = await callStaffClient({ username: staff.username, password: staff.password }, 'bind_device_v3', { ...request })
  assertCurrent?.()
  if (confirmed.organization_id !== staff.organization_id) throw new Error('Tổ chức của tài khoản đã thay đổi. Vui lòng đăng nhập lại.')
  await migration.confirmed(staff.id)
  if (confirmed.deviceV3!.decision === 'manual_login_required') return { status: 'manual_login_required' }
  if (confirmed.deviceV3!.decision !== 'allowed') throw new Error(deviceLockedMessage())
  if (confirmed.deviceV3!.binding.version !== 3 || confirmed.deviceV3!.binding.hash !== device.fingerprintHash || confirmed.deviceV3!.needsBinding) throw new Error('Không thể xác minh liên kết máy tính.')
  const automaticLoginAllowed = confirmed.deviceV3!.automaticAllowed
  if (automaticLoginAllowed) {
    try { await registerStaffDeviceRecovery({ username: staff.username, password: staff.password }, staff.id, device.fingerprintHash) }
    catch { console.warn('[auth] Không đăng ký được khóa khôi phục trên máy; đăng nhập vẫn hợp lệ.') }
  }
  assertCurrent?.()
  return { status: 'authenticated', automaticLoginAllowed, user: await buildAuthUser(staff, {
    aka_agent_device_fingerprint_hash: device.fingerprintHash, device_label: device.label, device_platform: device.platform
  }) }
}

function hasAcceptedPolicy(staff: StaffRow): boolean {
  return staff.is_policy_accepted === true
}

export async function login(username: string, password: string, assertCurrent?: () => void, source: DeviceLoginSource = 'manual'): Promise<AuthLoginResult> {
  const prepared = await prepareDeviceLogin(username.trim(), password, source)
  assertCurrent?.()
  if (prepared.decision.decision === 'manual_login_required') return { status: 'manual_login_required' }
  if (!hasAcceptedPolicy(prepared.staff)) return { status: 'policy_required' }
  return completeDeviceLogin(prepared, assertCurrent)
}

export async function acceptPolicyAndLogin(username: string, password: string, assertCurrent?: () => void, source: DeviceLoginSource = 'manual'): Promise<AuthLoginResult> {
  const prepared = await prepareDeviceLogin(username.trim(), password, source)
  assertCurrent?.()
  if (prepared.decision.decision === 'manual_login_required') return { status: 'manual_login_required' }
  if (!hasAcceptedPolicy(prepared.staff)) await callStaffClient({ username: prepared.staff.username, password }, 'accept_policy', { staffId: prepared.staff.id })
  assertCurrent?.()
  // Revalidate identity and policy after confirmation, preserving the original login source.
  return login(username, password, assertCurrent, source)
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

  await callStaffClient({ username: user.username, password: currentPassword }, 'change_password', {
    staffId: user.staffId, newPassword: nextPassword
  })
  try {
    const device = await getCurrentDeviceIdentity(true)
    await registerStaffDeviceRecovery({ username: user.username, password: nextPassword }, user.staffId, device.fingerprintHash)
  } catch { console.warn('[auth] Chưa cập nhật khóa khôi phục sau khi đổi mật khẩu.') }

  return { success: true }
}

export async function updateUseTestWorkflow(user: AuthUser, useTestWorkflow: boolean): Promise<AuthUser> {
  if (!user.isAdminAkabiz) {
    throw new Error('Chỉ admin akaBiz mới được bật/tắt workflow test.')
  }

  await callCurrentStaffClient('set_test_workflow', { enabled: useTestWorkflow })

  return { ...user, useTestWorkflow }
}
