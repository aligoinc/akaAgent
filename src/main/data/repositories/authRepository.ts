import { AuthUser, DeviceLockResetResult } from '../../../shared/types'
import { getCurrentDeviceIdentity } from '../../services/deviceIdentity'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

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
}

const STAFF_SELECT = [
  'id',
  'organization_id',
  'name',
  'username',
  'password',
  'is_active',
  'is_admin_akabiz',
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
    deviceLabel: deviceRecord.device_label || null,
    devicePlatform: deviceRecord.device_platform || null,
    deviceBoundAt: deviceRecord.device_bound_at || null,
    deviceLastSeenAt: deviceRecord.device_last_seen_at || null
  }
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
