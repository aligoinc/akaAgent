import {
  AuthBootstrapResult,
  AuthUser,
  DeviceLockResetResult,
  LoginPreferences,
  SavedLoginCredentials
} from '../../../shared/types'
import { getCurrentDeviceIdentity } from '../../services/deviceIdentity'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

export const DEFAULT_LOGIN_PREFERENCES: LoginPreferences = {
  rememberLogin: true,
  autoLogin: true,
  startupEnabled: false
}

interface StaffDeviceColumns {
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
  username: string
  password: string
  is_active: boolean
  is_admin_akabiz: boolean
  use_test_workflow: boolean
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
  'username',
  'password',
  'is_active',
  'is_admin_akabiz',
  'use_test_workflow',
  'device_fingerprint_hash',
  'device_label',
  'device_platform',
  'device_bound_at',
  'device_last_seen_at'
].join(', ')

const DEVICE_SELECT = [
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

  if (next.autoLogin) next.rememberLogin = true
  if (!next.rememberLogin) next.autoLogin = false
  return next
}

function deviceLockedMessage(): string {
  return 'Tài khoản này đang được đăng nhập trên máy tính khác. Vui lòng dùng máy đang được cấp quyền để Đổi máy tính, hoặc liên hệ hỗ trợ.'
}

function normalizeDeviceHash(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function loadStaffDevice(staffId: number): Promise<StaffDeviceColumns | null> {
  const { data, error } = await client()
    .from('org_staff')
    .select(DEVICE_SELECT)
    .eq('id', staffId)
    .maybeSingle()

  if (error) throw new Error(`Đăng nhập thất bại: ${error.message}`)
  return data as StaffDeviceColumns | null
}

async function loadStaffById(staffId: number): Promise<StaffRow | null> {
  const { data, error } = await client()
    .from('org_staff')
    .select(STAFF_SELECT)
    .eq('id', staffId)
    .maybeSingle()

  if (error) throw new Error(`Không thể tải tài khoản đã ghi nhớ: ${error.message}`)
  return data as unknown as StaffRow | null
}

async function buildAuthUser(staffRow: StaffRow, deviceRecord: StaffDeviceColumns): Promise<AuthUser> {
  // Lookup org separately — embed gặp ambiguous FK (org_staff.organization_id vs org_organization.staff_admin_id).
  const { data: org, error: orgErr } = await client()
    .from('org_organization')
    .select('id, name')
    .eq('id', staffRow.organization_id)
    .maybeSingle()

  if (orgErr) throw new Error(`Đăng nhập thất bại: ${orgErr.message}`)

  return {
    staffId: staffRow.id,
    organizationId: staffRow.organization_id,
    name: staffRow.name,
    username: staffRow.username,
    organizationName: (org?.name as string) || '',
    isAdminAkabiz: !!staffRow.is_admin_akabiz,
    useTestWorkflow: !!staffRow.use_test_workflow,
    deviceLabel: deviceRecord.device_label || null,
    devicePlatform: deviceRecord.device_platform || null,
    deviceBoundAt: deviceRecord.device_bound_at || null,
    deviceLastSeenAt: deviceRecord.device_last_seen_at || null
  }
}

async function ensureStaffDeviceLock(staff: StaffRow): Promise<StaffDeviceColumns> {
  const device = await getCurrentDeviceIdentity()
  const now = new Date().toISOString()
  const currentHash = normalizeDeviceHash(staff.device_fingerprint_hash)

  if (!currentHash) {
    const { data: updated, error } = await client()
      .from('org_staff')
      .update({
        device_fingerprint_hash: device.fingerprintHash,
        device_label: device.label,
        device_platform: device.platform,
        device_bound_at: now,
        device_last_seen_at: now,
        updated_at: now
      })
      .eq('id', staff.id)
      .is('device_fingerprint_hash', null)
      .select(DEVICE_SELECT)
      .maybeSingle()

    if (error) throw new Error(`Đăng nhập thất bại: ${error.message}`)
    const updatedDevice = updated as unknown as StaffDeviceColumns | null
    if (normalizeDeviceHash(updatedDevice?.device_fingerprint_hash) === device.fingerprintHash) {
      return updatedDevice as StaffDeviceColumns
    }

    const latest = await loadStaffDevice(staff.id)
    if (normalizeDeviceHash(latest?.device_fingerprint_hash) === device.fingerprintHash) {
      return latest as StaffDeviceColumns
    }
    throw new Error(deviceLockedMessage())
  }

  if (currentHash !== device.fingerprintHash) {
    throw new Error(deviceLockedMessage())
  }

  const { data: updated, error } = await client()
    .from('org_staff')
    .update({
      device_label: device.label,
      device_platform: device.platform,
      device_last_seen_at: now,
      updated_at: now
    })
    .eq('id', staff.id)
    .eq('device_fingerprint_hash', device.fingerprintHash)
    .select(DEVICE_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Đăng nhập thất bại: ${error.message}`)
  const updatedDevice = updated as unknown as StaffDeviceColumns | null
  if (normalizeDeviceHash(updatedDevice?.device_fingerprint_hash) !== device.fingerprintHash) {
    throw new Error(deviceLockedMessage())
  }
  return updatedDevice as StaffDeviceColumns
}

function mapLoginPreferencesFromRow(row: DeviceLoginSettingsRow | null | undefined): LoginPreferences {
  if (!row) return DEFAULT_LOGIN_PREFERENCES
  return normalizeLoginPreferences({
    rememberLogin: row.remember_login ?? DEFAULT_LOGIN_PREFERENCES.rememberLogin,
    autoLogin: row.auto_login ?? DEFAULT_LOGIN_PREFERENCES.autoLogin,
    startupEnabled: row.startup_enabled ?? DEFAULT_LOGIN_PREFERENCES.startupEnabled
  })
}

async function loadLatestDeviceLoginSettingsRow(
  deviceFingerprintHash: string
): Promise<DeviceLoginSettingsRow | null> {
  const { data, error } = await client()
    .from('auto_staff_device_login_settings')
    .select('*')
    .eq('device_fingerprint_hash', deviceFingerprintHash)
    .eq('is_delete', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Không thể tải tuỳ chọn đăng nhập: ${error.message}`)
  return data as unknown as DeviceLoginSettingsRow | null
}

function buildAuthBootstrapResult(
  loginOptions: LoginPreferences,
  savedCredentials: SavedLoginCredentials | null,
  errorMessage: string | null = null
): AuthBootstrapResult {
  return {
    user: null,
    loginOptions,
    savedCredentials,
    errorMessage
  }
}

export async function loadLoginSettingsForCurrentDevice(): Promise<AuthBootstrapResult> {
  const device = await getCurrentDeviceIdentity()
  const row = await loadLatestDeviceLoginSettingsRow(device.fingerprintHash)
  if (!row) {
    return buildAuthBootstrapResult(DEFAULT_LOGIN_PREFERENCES, null)
  }

  const loginOptions = mapLoginPreferencesFromRow(row)
  if (!loginOptions.rememberLogin) {
    return buildAuthBootstrapResult(loginOptions, null)
  }

  const staff = await loadStaffById(Number(row.staff_id))
  const staffDeviceHash = normalizeDeviceHash(staff?.device_fingerprint_hash)
  if (!staff || !staff.is_active || staffDeviceHash !== device.fingerprintHash) {
    return buildAuthBootstrapResult(loginOptions, null)
  }

  return buildAuthBootstrapResult(loginOptions, {
    username: staff.username,
    password: staff.password
  })
}

export async function recoverDeviceCredentials(): Promise<SavedLoginCredentials> {
  const device = await getCurrentDeviceIdentity()
  const { data, error } = await client()
    .from('org_staff')
    .select(STAFF_SELECT)
    .eq('device_fingerprint_hash', device.fingerprintHash)
    .eq('is_active', true)
    .order('device_last_seen_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Không thể lấy lại tài khoản đăng nhập: ${error.message}`)
  const staff = data as unknown as StaffRow | null
  if (!staff) {
    throw new Error('Không tìm thấy tài khoản đang được cấp quyền trên máy tính này.')
  }

  return {
    username: staff.username,
    password: staff.password
  }
}

export async function saveDeviceLoginSettings(
  user: AuthUser,
  options?: Partial<LoginPreferences> | null
): Promise<LoginPreferences> {
  const device = await getCurrentDeviceIdentity()
  const loginOptions = normalizeLoginPreferences(options)
  const now = new Date().toISOString()
  const { data, error } = await client()
    .from('auto_staff_device_login_settings')
    .upsert({
      staff_id: user.staffId,
      organization_id: user.organizationId,
      device_fingerprint_hash: device.fingerprintHash,
      device_label: device.label,
      device_platform: device.platform,
      remember_login: loginOptions.rememberLogin,
      auto_login: loginOptions.autoLogin,
      startup_enabled: loginOptions.startupEnabled,
      last_login_at: now,
      last_used_at: now,
      is_delete: false,
      updated_at: now
    }, { onConflict: 'staff_id,device_fingerprint_hash' })
    .select()
    .single()

  if (error) throw new Error(`Không thể lưu tuỳ chọn đăng nhập: ${error.message}`)
  return mapLoginPreferencesFromRow(data as unknown as DeviceLoginSettingsRow)
}

export async function revokeRememberedLoginForCurrentDevice(): Promise<AuthBootstrapResult> {
  const device = await getCurrentDeviceIdentity()
  const row = await loadLatestDeviceLoginSettingsRow(device.fingerprintHash)
  if (!row) {
    return buildAuthBootstrapResult(
      normalizeLoginPreferences({ rememberLogin: false, autoLogin: false }),
      null
    )
  }

  const now = new Date().toISOString()
  const { data, error } = await client()
    .from('auto_staff_device_login_settings')
    .update({
      remember_login: false,
      auto_login: false,
      last_used_at: now,
      updated_at: now
    })
    .eq('id', row.id)
    .select()
    .single()

  if (error) throw new Error(`Không thể tắt ghi nhớ đăng nhập: ${error.message}`)
  return buildAuthBootstrapResult(mapLoginPreferencesFromRow(data as unknown as DeviceLoginSettingsRow), null)
}

export async function updateLoginPreferencesForCurrentDevice(
  updates: Partial<LoginPreferences>
): Promise<AuthBootstrapResult> {
  const device = await getCurrentDeviceIdentity()
  const row = await loadLatestDeviceLoginSettingsRow(device.fingerprintHash)
  const nextOptions = normalizeLoginPreferences({
    ...(row ? mapLoginPreferencesFromRow(row) : DEFAULT_LOGIN_PREFERENCES),
    ...updates
  })

  if (!row) {
    return buildAuthBootstrapResult(nextOptions, null)
  }

  const now = new Date().toISOString()
  const { error } = await client()
    .from('auto_staff_device_login_settings')
    .update({
      remember_login: nextOptions.rememberLogin,
      auto_login: nextOptions.autoLogin,
      startup_enabled: nextOptions.startupEnabled,
      last_used_at: now,
      updated_at: now
    })
    .eq('id', row.id)

  if (error) throw new Error(`Không thể lưu tuỳ chọn đăng nhập: ${error.message}`)
  return loadLoginSettingsForCurrentDevice()
}

export async function updateStartupSettingForCurrentDevice(
  enabled: boolean,
  user?: AuthUser | null
): Promise<LoginPreferences> {
  const device = await getCurrentDeviceIdentity()
  const row = await loadLatestDeviceLoginSettingsRow(device.fingerprintHash)
  const now = new Date().toISOString()

  if (row) {
    const { data, error } = await client()
      .from('auto_staff_device_login_settings')
      .update({
        startup_enabled: !!enabled,
        last_used_at: now,
        updated_at: now
      })
      .eq('id', row.id)
      .select()
      .single()

    if (error) throw new Error(`Không thể lưu tuỳ chọn khởi động: ${error.message}`)
    return mapLoginPreferencesFromRow(data as unknown as DeviceLoginSettingsRow)
  }

  if (user) {
    return saveDeviceLoginSettings(user, {
      ...DEFAULT_LOGIN_PREFERENCES,
      startupEnabled: !!enabled
    })
  }

  return normalizeLoginPreferences({
    ...DEFAULT_LOGIN_PREFERENCES,
    startupEnabled: !!enabled
  })
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const u = (username || '').trim()
  const p = password || ''
  if (!u || !p) throw new Error('Vui lòng nhập tên đăng nhập và mật khẩu.')

  const { data: staff, error } = await client()
    .from('org_staff')
    .select(STAFF_SELECT)
    .eq('username', u)
    .maybeSingle()

  if (error) throw new Error(`Đăng nhập thất bại: ${error.message}`)
  const staffRow = staff as unknown as StaffRow | null
  if (!staffRow) throw new Error('Tên đăng nhập không tồn tại.')
  if (staffRow.password !== p) throw new Error('Mật khẩu không đúng.')
  if (!staffRow.is_active) throw new Error('Tài khoản đã bị khoá.')

  const deviceRecord = await ensureStaffDeviceLock(staffRow)
  return buildAuthUser(staffRow, deviceRecord)
}

export async function resetDeviceLock(user: AuthUser): Promise<DeviceLockResetResult> {
  const device = await getCurrentDeviceIdentity()
  const latest = await loadStaffDevice(user.staffId)
  if (!latest) throw new Error('Không tìm thấy tài khoản để đổi máy tính.')

  const currentHash = normalizeDeviceHash(latest.device_fingerprint_hash)
  if (currentHash && currentHash !== device.fingerprintHash) {
    throw new Error('Chỉ máy tính đang được cấp quyền mới có thể đổi máy tính.')
  }

  const now = new Date().toISOString()
  const { error } = await client()
    .from('org_staff')
    .update({
      device_fingerprint_hash: null,
      device_label: null,
      device_platform: null,
      device_bound_at: null,
      device_last_seen_at: null,
      updated_at: now
    })
    .eq('id', user.staffId)

  if (error) throw new Error(`Đổi máy tính thất bại: ${error.message}`)

  const nowAfterReset = new Date().toISOString()
  await client()
    .from('auto_staff_device_login_settings')
    .update({
      remember_login: false,
      auto_login: false,
      updated_at: nowAfterReset
    })
    .eq('staff_id', user.staffId)
    .eq('device_fingerprint_hash', device.fingerprintHash)

  return { success: true }
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

  if (error) throw new Error(`Đổi mật khẩu thất bại: ${error.message}`)
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

  if (updateError) throw new Error(`Đổi mật khẩu thất bại: ${updateError.message}`)
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

  if (error) throw new Error(`Không thể lưu chế độ workflow test: ${error.message}`)
  return { ...user, useTestWorkflow }
}
