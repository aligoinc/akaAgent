import { AuthEntitlements, AuthUser } from '../../../shared/types'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

export const AKA_AGENT_PRODUCT_ID = 3
export const EMAIL_PRODUCT_ID = 13
export const ACCOUNT_EXPIRED_MESSAGE = 'Tài khoản của bạn đã hết hạn'
export const EMAIL_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng Email chưa được kích hoạt hoặc đã hết hạn.'

interface OrganizationProductRow {
  expiration_date?: string | null
}

interface ProductCheckOptions {
  context: string
  technicalMessage: string
}

function todayStartTimestamp(): number {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  return todayStart.getTime()
}

function isExpirationActive(expirationDate?: string | null): boolean {
  const expirationTime = expirationDate ? Date.parse(expirationDate) : NaN
  return Number.isFinite(expirationTime) && expirationTime >= todayStartTimestamp()
}

export async function isOrganizationProductActive(
  organizationId: number,
  productId: number,
  options: ProductCheckOptions
): Promise<boolean> {
  const { data, error } = await client()
    .from('org_organization_product')
    .select('expiration_date')
    .eq('organization_id', organizationId)
    .eq('product_id', productId)
    .eq('is_deleted', false)
    .order('expiration_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(`[entitlements] ${options.context}:`, error)
    throw new Error(options.technicalMessage)
  }

  const row = data as unknown as OrganizationProductRow | null
  return isExpirationActive(row?.expiration_date)
}

export async function ensureAkaAgentSubscriptionActive(organizationId: number): Promise<void> {
  const active = await isOrganizationProductActive(organizationId, AKA_AGENT_PRODUCT_ID, {
    context: 'check app subscription',
    technicalMessage: 'Không thể kiểm tra hạn sử dụng. Vui lòng thử lại sau.'
  })
  if (!active) throw new Error(ACCOUNT_EXPIRED_MESSAGE)
}

export async function loadOrganizationEntitlements(organizationId: number): Promise<AuthEntitlements> {
  let email = false
  try {
    email = await isOrganizationProductActive(organizationId, EMAIL_PRODUCT_ID, {
      context: 'check email subscription',
      technicalMessage: 'Không thể kiểm tra quyền Email. Vui lòng thử lại sau.'
    })
  } catch (err) {
    console.error('[entitlements] Failed to load email entitlement:', err)
  }

  return { email }
}

export function hasEmailFeatureEntitlement(user?: Pick<AuthUser, 'entitlements'> | null): boolean {
  return !!user?.entitlements?.email
}

export function hasCurrentUserEmailFeatureEntitlement(): boolean {
  return hasEmailFeatureEntitlement(requireCurrentUser())
}

export async function canCurrentUserUseEmailFeature(): Promise<boolean> {
  if (!hasCurrentUserEmailFeatureEntitlement()) return false
  try {
    return await isCurrentUserEmailFeatureActive()
  } catch (err) {
    console.error('[entitlements] Failed to refresh current email entitlement:', err)
    return false
  }
}

export async function isCurrentUserEmailFeatureActive(): Promise<boolean> {
  const user = requireCurrentUser()
  return isOrganizationProductActive(user.organizationId, EMAIL_PRODUCT_ID, {
    context: 'check current user email entitlement',
    technicalMessage: 'Không thể kiểm tra quyền Email. Vui lòng thử lại sau.'
  })
}

export async function ensureCurrentUserEmailFeatureActive(): Promise<void> {
  if (!(await isCurrentUserEmailFeatureActive())) {
    throw new Error(EMAIL_FEATURE_UNAVAILABLE_MESSAGE)
  }
}
