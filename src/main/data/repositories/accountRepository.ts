import { AutoAccount, ZaloAccount, ZaloSessionCredentials, EmailAccountConfig } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAccountFromDB, mapZaloAccountFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'
import * as accountGroupRepo from './accountGroupRepository'
import * as proxyRepo from './proxyRepository'
import {
  canUseAccountPlatformWithEntitlements,
  ensureCurrentUserCanUseAccountPlatform,
  ensureCurrentUserEmailFeatureActive,
  ensureCurrentUserFeatureActive,
  getAccountPlatformLimit,
  loadCurrentUserEffectiveEntitlements,
} from './entitlementRepository'

const client = () => getSupabaseClient()
const DEFAULT_RATE_LIMIT_MINUTES = 65
const ACCOUNT_SELECT = [
  'id',
  'name',
  'flatform_type',
  'username',
  'password',
  'mobile_device_id',
  'mobile_device_info',
  'mobile_device_registered_at',
  'mobile_device_last_seen_at',
  'login_status',
  'status',
  'is_active',
  'rate_limit_minutes',
  'account_group_id',
  'proxy_id',
  'zalo_account_id',
  'zalo_session_updated_at',
  'zalo_session_last_verified_at',
  'zalo_session_last_error',
  'email_session_updated_at',
  'email_session_last_verified_at',
  'email_session_last_error',
  'is_delete',
  'staff_id',
  'organization_id',
  'created_at',
  'updated_at',
  'auto_account_groups(name, settings)',
  'auto_proxies(name, protocol, host, port)',
  'zalo_accounts(id, zalo_uid, display_name, phone, avatar_url)'
].join(', ')
const ACCOUNT_WITH_ZALO_SESSION_SELECT = `${ACCOUNT_SELECT}, zalo_session`
const ACCOUNT_WITH_EMAIL_SESSION_SELECT = `${ACCOUNT_SELECT}, email_session`

export interface AccountZaloSession {
  account: AutoAccount
  session: ZaloSessionCredentials | null
}

export interface AccountEmailSession {
  account: AutoAccount
  session: EmailAccountConfig | null
}

export interface ZaloAccountUpsertInput {
  zaloUid: string
  displayName?: string | null
  phone?: string | null
  avatarUrl?: string | null
  metadata?: Record<string, unknown>
}

function normalizeRateLimitMinutes(value: unknown): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_MINUTES
}

function getPlatformDisplayName(flatformType: string | null | undefined): string {
  const platform = String(flatformType || '').trim().toLowerCase()
  if (platform === 'facebook') return 'Facebook'
  if (platform === 'zalo') return 'Zalo'
  if (platform === 'email') return 'Email'
  return String(flatformType || 'nền tảng').trim() || 'nền tảng'
}

async function countStaffAccountsByPlatform(staffId: number, flatformType: string): Promise<number> {
  const { count, error } = await client()
    .from('auto_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', staffId)
    .eq('flatform_type', flatformType)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to count accounts: ${error.message}`)
  return count || 0
}

async function ensureAccountQuotaAvailable(staffId: number, flatformType: string): Promise<void> {
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const limit = getAccountPlatformLimit(flatformType, entitlements)
  if (limit === null) return

  const used = await countStaffAccountsByPlatform(staffId, flatformType)
  if (used < limit) return

  throw new Error(
    `Đã đạt giới hạn tài khoản ${getPlatformDisplayName(flatformType)} của gói hiện tại (${used}/${limit}). Vui lòng xoá tài khoản không dùng hoặc nâng cấp gói để tạo thêm.`
  )
}

export async function getAccount(id: number): Promise<AutoAccount | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_accounts')
    .select(ACCOUNT_SELECT)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to get account: ${error.message}`)
  return data ? mapAccountFromDB(toDbRow(data)) : null
}

export async function getAccountZaloSession(id: number): Promise<AccountZaloSession | null> {
  await ensureCurrentUserFeatureActive('zalo')
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_accounts')
    .select(ACCOUNT_WITH_ZALO_SESSION_SELECT)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to get account Zalo session: ${error.message}`)
  if (!data) return null
  return {
    account: mapAccountFromDB(toDbRow(data)),
    session: normalizeZaloSession((data as any).zalo_session)
  }
}

export async function listZaloAccountsWithSession(): Promise<AccountZaloSession[]> {
  await ensureCurrentUserFeatureActive('zalo')
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_accounts')
    .select(ACCOUNT_WITH_ZALO_SESSION_SELECT)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .eq('flatform_type', 'zalo')
    .not('zalo_session', 'is', null)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list Zalo accounts with session: ${error.message}`)
  return (data || [])
    .map(row => ({
      account: mapAccountFromDB(toDbRow(row)),
      session: normalizeZaloSession((row as any).zalo_session)
    }))
    .filter(entry => !!entry.session)
}

export async function listAccounts(): Promise<AutoAccount[]> {
  const u = requireCurrentUser()
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const { data, error } = await client()
    .from('auto_accounts')
    .select(ACCOUNT_SELECT)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list accounts: ${error.message}`)
  return (data || [])
    .map(row => mapAccountFromDB(toDbRow(row)))
    .filter(account => canUseAccountPlatformWithEntitlements(account.flatformType, entitlements))
}

export async function createAccount(account: Partial<AutoAccount>): Promise<AutoAccount> {
  const u = requireCurrentUser()
  const flatformType = account.flatformType || 'facebook'
  await ensureCurrentUserCanUseAccountPlatform(flatformType)
  await ensureAccountQuotaAvailable(u.staffId, flatformType)
  const accountGroupId = await accountGroupRepo.validateAccountGroupForAccount(account.accountGroupId, flatformType)
  const proxyId = await proxyRepo.validateProxyForAccount(account.proxyId)
  const payload = {
    name: account.name,
    flatform_type: flatformType,
    login_status: account.loginStatus || 'ch\u01b0a \u0111\u0103ng nh\u1eadp',
    status: account.status || 'ch\u1edd x\u1eed l\u00fd',
    is_active: account.isActive ?? true,
    rate_limit_minutes: normalizeRateLimitMinutes(account.rateLimitMinutes),
    account_group_id: accountGroupId,
    proxy_id: proxyId,
    staff_id: u.staffId,
    organization_id: u.organizationId
  }

  const { data, error } = await client()
    .from('auto_accounts')
    .insert(payload)
    .select(ACCOUNT_SELECT)
    .single()

  if (error) throw new Error(`Failed to create account: ${error.message}`)
  return mapAccountFromDB(toDbRow(data))
}

export async function updateAccount(id: number, updates: Partial<AutoAccount>): Promise<AutoAccount> {
  const u = requireCurrentUser()
  const payload: any = { updated_at: new Date().toISOString() }
  const current = await getAccount(id)
  if (!current) throw new Error('Không tìm thấy tài khoản')
  const targetFlatformType = updates.flatformType ?? current.flatformType
  await ensureCurrentUserCanUseAccountPlatform(targetFlatformType)
  await ensureCurrentUserCanUseAccountPlatform(current.flatformType)
  if (updates.flatformType !== undefined && targetFlatformType !== current.flatformType) {
    await ensureAccountQuotaAvailable(u.staffId, targetFlatformType)
  }
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.flatformType !== undefined) payload.flatform_type = updates.flatformType
  if (updates.loginStatus !== undefined) payload.login_status = updates.loginStatus
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.isActive !== undefined) payload.is_active = updates.isActive
  if (updates.rateLimitMinutes !== undefined) payload.rate_limit_minutes = normalizeRateLimitMinutes(updates.rateLimitMinutes)
  if (updates.accountGroupId !== undefined) {
    payload.account_group_id = await accountGroupRepo.validateAccountGroupForAccount(
      updates.accountGroupId,
      targetFlatformType || 'facebook'
    )
  } else if (updates.flatformType !== undefined) {
    payload.account_group_id = null
  }
  if (updates.proxyId !== undefined) {
    const proxyId = await proxyRepo.validateProxyForAccount(updates.proxyId)
    payload.proxy_id = proxyId
  }

  const { data, error } = await client()
    .from('auto_accounts')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select(ACCOUNT_SELECT)
    .single()

  if (error) throw new Error(`Failed to update account: ${error.message}`)
  return mapAccountFromDB(toDbRow(data))
}

export async function clearAccountMobileDevice(id: number): Promise<AutoAccount> {
  const u = requireCurrentUser()
  const current = await getAccount(id)
  if (!current) throw new Error('Không tìm thấy tài khoản')
  await ensureCurrentUserCanUseAccountPlatform(current.flatformType)
  if (current.flatformType !== 'sms') {
    throw new Error('Chỉ tài khoản SMS mới có thể đổi điện thoại mobile.')
  }

  const { data, error } = await client()
    .from('auto_accounts')
    .update({
      mobile_device_id: null,
      mobile_device_info: {},
      mobile_device_registered_at: null,
      mobile_device_last_seen_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('flatform_type', 'sms')
    .eq('is_delete', false)
    .select(ACCOUNT_SELECT)
    .single()

  if (error) throw new Error(`Failed to clear account mobile device: ${error.message}`)
  return mapAccountFromDB(toDbRow(data))
}

export async function upsertZaloAccount(input: ZaloAccountUpsertInput): Promise<ZaloAccount> {
  await ensureCurrentUserFeatureActive('zalo')
  const zaloUid = String(input.zaloUid || '').trim()
  if (!zaloUid) throw new Error('Thiếu Zalo UID')

  const payload = {
    zalo_uid: zaloUid,
    display_name: normalizeNullableString(input.displayName),
    phone: normalizeNullableString(input.phone),
    avatar_url: normalizeNullableString(input.avatarUrl),
    metadata: input.metadata || {},
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  const { data, error } = await client()
    .from('zalo_accounts')
    .upsert(payload, { onConflict: 'zalo_uid' })
    .select()
    .single()

  if (error) throw new Error(`Failed to upsert Zalo account: ${error.message}`)
  return mapZaloAccountFromDB(toDbRow(data))
}

export async function updateAccountZaloSession(
  id: number,
  input: {
    zaloAccountId: number
    session: ZaloSessionCredentials
    verified?: boolean
    clearError?: boolean
  }
): Promise<AutoAccount> {
  await ensureCurrentUserFeatureActive('zalo')
  const u = requireCurrentUser()
  const now = new Date().toISOString()
  const payload = {
    zalo_account_id: input.zaloAccountId,
    zalo_session: input.session,
    zalo_session_updated_at: now,
    zalo_session_last_verified_at: input.verified ? now : null,
    zalo_session_last_error: input.clearError === false ? undefined : null,
    login_status: input.verified ? 'đã đăng nhập' : undefined,
    updated_at: now
  }

  const { data, error } = await client()
    .from('auto_accounts')
    .update(removeUndefined(payload))
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select(ACCOUNT_SELECT)
    .single()

  if (error) throw new Error(`Failed to update account Zalo session: ${error.message}`)
  return mapAccountFromDB(toDbRow(data))
}

export async function markAccountZaloSessionCheck(
  id: number,
  result: { ok: boolean; error?: string | null }
): Promise<AutoAccount> {
  await ensureCurrentUserFeatureActive('zalo')
  const u = requireCurrentUser()
  const now = new Date().toISOString()
  const payload = {
    login_status: result.ok ? 'đã đăng nhập' : 'chưa đăng nhập',
    zalo_session_last_verified_at: result.ok ? now : undefined,
    zalo_session_last_error: result.ok ? null : normalizeNullableString(result.error),
    updated_at: now
  }

  const { data, error } = await client()
    .from('auto_accounts')
    .update(removeUndefined(payload))
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select(ACCOUNT_SELECT)
    .single()

  if (error) throw new Error(`Failed to mark account Zalo session check: ${error.message}`)
  return mapAccountFromDB(toDbRow(data))
}

export async function clearAccountZaloSession(id: number): Promise<AutoAccount> {
  await ensureCurrentUserFeatureActive('zalo')
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_accounts')
    .update({
      zalo_session: null,
      zalo_session_updated_at: null,
      zalo_session_last_verified_at: null,
      zalo_session_last_error: null,
      login_status: 'chưa đăng nhập',
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select(ACCOUNT_SELECT)
    .single()

  if (error) throw new Error(`Failed to clear account Zalo session: ${error.message}`)
  return mapAccountFromDB(toDbRow(data))
}

export async function getAccountEmailSession(id: number): Promise<AccountEmailSession | null> {
  await ensureCurrentUserEmailFeatureActive()
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_accounts')
    .select(ACCOUNT_WITH_EMAIL_SESSION_SELECT)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to get account email session: ${error.message}`)
  if (!data) return null
  return {
    account: mapAccountFromDB(toDbRow(data)),
    session: normalizeEmailSession((data as any).email_session)
  }
}

export async function updateAccountEmailSession(
  id: number,
  input: {
    session: EmailAccountConfig
    verified?: boolean
    clearError?: boolean
  }
): Promise<AutoAccount> {
  await ensureCurrentUserEmailFeatureActive()
  const u = requireCurrentUser()
  const now = new Date().toISOString()
  const payload = {
    email_session: input.session,
    email_session_updated_at: now,
    email_session_last_verified_at: input.verified ? now : null,
    email_session_last_error: input.clearError === false ? undefined : null,
    login_status: input.verified ? 'đã đăng nhập' : undefined,
    updated_at: now
  }

  const { data, error } = await client()
    .from('auto_accounts')
    .update(removeUndefined(payload))
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select(ACCOUNT_SELECT)
    .single()

  if (error) throw new Error(`Failed to update account email session: ${error.message}`)
  return mapAccountFromDB(toDbRow(data))
}

export async function markAccountEmailSessionCheck(
  id: number,
  result: { ok: boolean; error?: string | null }
): Promise<AutoAccount> {
  await ensureCurrentUserEmailFeatureActive()
  const u = requireCurrentUser()
  const now = new Date().toISOString()
  const payload = {
    login_status: result.ok ? 'đã đăng nhập' : 'chưa đăng nhập',
    email_session_last_verified_at: result.ok ? now : undefined,
    email_session_last_error: result.ok ? null : normalizeNullableString(result.error),
    updated_at: now
  }

  const { data, error } = await client()
    .from('auto_accounts')
    .update(removeUndefined(payload))
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select(ACCOUNT_SELECT)
    .single()

  if (error) throw new Error(`Failed to mark account email session check: ${error.message}`)
  return mapAccountFromDB(toDbRow(data))
}

export async function clearAccountEmailSession(id: number): Promise<AutoAccount> {
  await ensureCurrentUserEmailFeatureActive()
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_accounts')
    .update({
      email_session: null,
      email_session_updated_at: null,
      email_session_last_verified_at: null,
      email_session_last_error: null,
      login_status: 'chưa đăng nhập',
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select(ACCOUNT_SELECT)
    .single()

  if (error) throw new Error(`Failed to clear account email session: ${error.message}`)
  return mapAccountFromDB(toDbRow(data))
}

export async function deleteAccount(id: number): Promise<void> {
  const u = requireCurrentUser()
  const { error } = await client()
    .from('auto_accounts')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', u.staffId)

  if (error) throw new Error(`Failed to delete account: ${error.message}`)
}

export async function getEligibleAccounts(): Promise<AutoAccount[]> {
  const u = requireCurrentUser()
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const { data, error } = await client()
    .from('auto_accounts')
    .select(ACCOUNT_SELECT)
    .eq('staff_id', u.staffId)
    .eq('is_active', true)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to get eligible accounts: ${error.message}`)
  return (data || [])
    .map(row => mapAccountFromDB(toDbRow(row)))
    .filter(account => canUseAccountPlatformWithEntitlements(account.flatformType, entitlements))
}

export async function resetRunningAccountStatuses(staffId: number): Promise<void> {
  const { error } = await client()
    .from('auto_accounts')
    .update({ status: 'ch\u1edd x\u1eed l\u00fd' })
    .eq('staff_id', staffId)
    .neq('flatform_type', 'sms')
    .eq('status', '\u0111ang ch\u1ea1y')

  if (error) console.error('Failed to reset account statuses:', error.message)
}

function normalizeNullableString(value: unknown): string | null {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function toDbRow(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

function normalizeZaloSession(value: unknown): ZaloSessionCredentials | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const imei = String(record.imei || '').trim()
  const userAgent = String(record.userAgent || '').trim()
  if (!imei || !userAgent || record.cookie === undefined || record.cookie === null) return null
  return {
    cookie: record.cookie,
    imei,
    userAgent,
    language: normalizeNullableString(record.language) || undefined
  }
}

function normalizeEmailSession(value: unknown): EmailAccountConfig | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const host = String(record.host || '').trim()
  const fromEmail = String(record.fromEmail || '').trim()
  const user = String(record.user || '').trim()
  const pass = String(record.pass ?? '')
  if (!host || !fromEmail) return null
  const portNum = Math.floor(Number(record.port))
  return {
    brandName: normalizeNullableString(record.brandName) || undefined,
    host,
    port: Number.isFinite(portNum) && portNum > 0 ? portNum : 587,
    secure: record.secure === true,
    user,
    pass,
    fromEmail,
    replyTo: normalizeNullableString(record.replyTo) || undefined,
    cc: normalizeNullableString(record.cc) || undefined
  }
}

function removeUndefined<T extends Record<string, unknown>>(payload: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}
