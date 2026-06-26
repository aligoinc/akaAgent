import { AuthAccountProduct, AuthEntitlementFeature, AuthEntitlements, AuthUser } from '../../../shared/types'
import { AUTH_PRODUCT_BY_FEATURE, AUTH_PRODUCT_IDS, getAuthProductById } from '../../../shared/authProductCatalog'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

export type EntitlementFeature = AuthEntitlementFeature

export const FACEBOOK_CORE_PRODUCT_ID = AUTH_PRODUCT_BY_FEATURE.facebookCore.productId
export const FACEBOOK_FANPAGE_PRODUCT_ID = AUTH_PRODUCT_BY_FEATURE.facebookFanpage.productId
export const EMAIL_PRODUCT_ID = AUTH_PRODUCT_BY_FEATURE.email.productId
export const ZALO_PRODUCT_ID = AUTH_PRODUCT_BY_FEATURE.zalo.productId
export const AKA_AGENT_PRODUCT_ID = FACEBOOK_CORE_PRODUCT_ID
export const DEFAULT_DEMO_DAILY_SEND_LIMIT = 30
export const ZALO_FIND_PHONE_ACTION_CODE = 'zalo_find_phone_user'

export const ACCOUNT_EXPIRED_MESSAGE = 'Tài khoản của bạn đã hết hạn'
export const FACEBOOK_CORE_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng Facebook chưa được kích hoạt hoặc đã hết hạn.'
export const FACEBOOK_FANPAGE_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng Facebook Fanpage chưa được kích hoạt hoặc đã hết hạn.'
export const EMAIL_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng Email chưa được kích hoạt hoặc đã hết hạn.'
export const ZALO_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng Zalo chưa được kích hoạt hoặc đã hết hạn.'

export const FACEBOOK_FANPAGE_CAMPAIGN_ACTION_IDS = new Set([
  'facebook_page_post',
  'facebook_page_to_message'
])

export const ZALO_CAMPAIGN_ACTION_IDS = new Set([
  'zalo_message_phone',
  'zalo_message_friend',
  'zalo_message_birthday',
  'zalo_message_group_member',
  'zalo_message_group_realtime',
  'zalo_message_remarketing_customer',
  'zalo_message_friend_recommendation',
  'zalo_message_group',
  'zalo_join_group_link',
  'zalo_cancel_sent_friend_request'
])

export const FACEBOOK_FANPAGE_ACCOUNT_ACTION_CODES = new Set([
  'fb_post_page',
  'fb_message_page_inbox_customer'
])

export const ZALO_ACCOUNT_ACTION_CODES = new Set([
  'zalo_find_phone_user',
  'zalo_message_friend',
  'zalo_message_group',
  'zalo_message_stranger',
  'zalo_add_friend',
  'zalo_join_group_link',
  'zalo_cancel_sent_friend_request',
  'zalo_tag_contact',
  'zalo_change_alias'
])

const FEATURE_PRODUCT_IDS: Record<EntitlementFeature, number> = {
  facebookCore: AUTH_PRODUCT_BY_FEATURE.facebookCore.productId,
  facebookFanpage: AUTH_PRODUCT_BY_FEATURE.facebookFanpage.productId,
  email: AUTH_PRODUCT_BY_FEATURE.email.productId,
  zalo: AUTH_PRODUCT_BY_FEATURE.zalo.productId
}

const FEATURE_UNAVAILABLE_MESSAGES: Record<EntitlementFeature, string> = {
  facebookCore: FACEBOOK_CORE_FEATURE_UNAVAILABLE_MESSAGE,
  facebookFanpage: FACEBOOK_FANPAGE_FEATURE_UNAVAILABLE_MESSAGE,
  email: EMAIL_FEATURE_UNAVAILABLE_MESSAGE,
  zalo: ZALO_FEATURE_UNAVAILABLE_MESSAGE
}

interface OrganizationProductRow {
  product_id?: number | null
  product_name?: string | null
  package_name?: string | null
  expiration_date?: string | null
  package_type?: string | null
  max_sends_per_day?: number | string | null
}

export function emptyAuthEntitlements(): AuthEntitlements {
  return {
    facebookCore: false,
    facebookFanpage: false,
    email: false,
    zalo: false,
    dailySendLimits: {
      facebookCore: null,
      facebookFanpage: null,
      email: null,
      zalo: null
    }
  }
}

function normalizeAuthEntitlements(entitlements?: Partial<AuthEntitlements> | null): AuthEntitlements {
  const empty = emptyAuthEntitlements()
  return {
    facebookCore: !!entitlements?.facebookCore,
    facebookFanpage: !!entitlements?.facebookFanpage,
    email: !!entitlements?.email,
    zalo: !!entitlements?.zalo,
    dailySendLimits: {
      ...empty.dailySendLimits,
      ...(entitlements?.dailySendLimits || {})
    }
  }
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

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getDemoDailySendLimit(rows: OrganizationProductRow[]): number | null {
  const activeRows = rows.filter(row => isExpirationActive(row.expiration_date))
  if (activeRows.length === 0) return null

  const hasNonDemo = activeRows.some(row => String(row.package_type || '').trim().toLowerCase() !== 'demo')
  if (hasNonDemo) return null

  return normalizePositiveInteger(activeRows[0]?.max_sends_per_day) ?? DEFAULT_DEMO_DAILY_SEND_LIMIT
}

function hasAnyEntitlement(entitlements: Partial<AuthEntitlements> | null | undefined): boolean {
  return !!(
    entitlements?.facebookCore ||
    entitlements?.facebookFanpage ||
    entitlements?.email ||
    entitlements?.zalo
  )
}

export function getFeatureUnavailableMessage(feature: EntitlementFeature): string {
  return FEATURE_UNAVAILABLE_MESSAGES[feature]
}

export async function loadOrganizationEntitlements(organizationId: number): Promise<AuthEntitlements> {
  const entitlements = emptyAuthEntitlements()
  const { data, error } = await client()
    .from('org_organization_product')
    .select('product_id, expiration_date, package_type, max_sends_per_day')
    .eq('organization_id', organizationId)
    .eq('is_deleted', false)
    .in('product_id', AUTH_PRODUCT_IDS)
    .order('expiration_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })

  if (error) {
    console.error('[entitlements] load organization entitlements:', error)
    throw new Error('Không thể kiểm tra quyền sử dụng. Vui lòng thử lại sau.')
  }

  const rows = (data || []) as unknown as OrganizationProductRow[]
  for (const [feature, productId] of Object.entries(FEATURE_PRODUCT_IDS) as Array<[EntitlementFeature, number]>) {
    const featureRows = rows.filter(row => Number(row.product_id) === productId)
    entitlements[feature] = featureRows.some(row => isExpirationActive(row.expiration_date))
    entitlements.dailySendLimits[feature] = getDemoDailySendLimit(featureRows)
  }

  return entitlements
}

export async function loadOrganizationAccountProducts(organizationId: number): Promise<AuthAccountProduct[]> {
  const { data, error } = await client()
    .from('org_organization_product')
    .select('product_id, product_name, package_name, package_type, expiration_date')
    .eq('organization_id', organizationId)
    .eq('is_deleted', false)
    .in('product_id', AUTH_PRODUCT_IDS)
    .order('expiration_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })

  if (error) {
    console.error('[entitlements] load organization account products:', error)
    throw new Error('Không thể tải thông tin gói sản phẩm. Vui lòng thử lại sau.')
  }

  return ((data || []) as unknown as OrganizationProductRow[]).map(row => {
    const productId = Number(row.product_id)
    const productCatalogItem = getAuthProductById(Number.isFinite(productId) ? productId : null)
    const productName = String(row.product_name || '').trim()
    const packageName = String(row.package_name || '').trim()
    return {
      feature: productCatalogItem?.feature ?? null,
      productId: Number.isFinite(productId) ? productId : null,
      productName,
      packageName,
      packageType: row.package_type ? String(row.package_type).trim() : null,
      displayName: productCatalogItem?.label || productName || packageName || 'Sản phẩm',
      displayOrder: productCatalogItem?.order ?? 99,
      expirationDate: row.expiration_date || null,
      isActive: isExpirationActive(row.expiration_date)
    }
  })
}

export async function ensureAkaAgentSubscriptionActive(organizationId: number): Promise<void> {
  const entitlements = await loadOrganizationEntitlements(organizationId)
  if (!hasAnyEntitlement(entitlements)) throw new Error(ACCOUNT_EXPIRED_MESSAGE)
}

export function hasFeatureEntitlement(
  user: Pick<AuthUser, 'entitlements'> | null | undefined,
  feature: EntitlementFeature
): boolean {
  return !!user?.entitlements?.[feature]
}

export function hasEmailFeatureEntitlement(user?: Pick<AuthUser, 'entitlements'> | null): boolean {
  return hasFeatureEntitlement(user, 'email')
}

export function hasCurrentUserFeatureEntitlement(feature: EntitlementFeature): boolean {
  return hasFeatureEntitlement(requireCurrentUser(), feature)
}

export function hasCurrentUserEmailFeatureEntitlement(): boolean {
  return hasCurrentUserFeatureEntitlement('email')
}

export async function loadCurrentUserEffectiveEntitlements(): Promise<AuthEntitlements> {
  return normalizeAuthEntitlements(requireCurrentUser().entitlements)
}

export async function isCurrentUserFeatureActive(feature: EntitlementFeature): Promise<boolean> {
  return hasCurrentUserFeatureEntitlement(feature)
}

export async function canCurrentUserUseFeature(feature: EntitlementFeature): Promise<boolean> {
  return hasCurrentUserFeatureEntitlement(feature)
}

export async function ensureCurrentUserFeatureActive(feature: EntitlementFeature): Promise<void> {
  if (!hasCurrentUserFeatureEntitlement(feature)) {
    throw new Error(getFeatureUnavailableMessage(feature))
  }
}

export async function canCurrentUserUseEmailFeature(): Promise<boolean> {
  return canCurrentUserUseFeature('email')
}

export async function isCurrentUserEmailFeatureActive(): Promise<boolean> {
  return isCurrentUserFeatureActive('email')
}

export async function ensureCurrentUserEmailFeatureActive(): Promise<void> {
  return ensureCurrentUserFeatureActive('email')
}

export function getCampaignActionFeature(actionId?: string | null, flatformType?: string | null): EntitlementFeature {
  const normalizedActionId = String(actionId || '').trim()
  const normalizedPlatform = String(flatformType || '').trim().toLowerCase()
  if (normalizedActionId === 'email_send' || normalizedPlatform === 'email') return 'email'
  if (ZALO_CAMPAIGN_ACTION_IDS.has(normalizedActionId) || normalizedPlatform === 'zalo') return 'zalo'
  if (FACEBOOK_FANPAGE_CAMPAIGN_ACTION_IDS.has(normalizedActionId)) return 'facebookFanpage'
  return 'facebookCore'
}

export function getAccountActionFeature(actionCode?: string | null, flatformType?: string | null): EntitlementFeature {
  const normalizedActionCode = String(actionCode || '').trim()
  const normalizedPlatform = String(flatformType || '').trim().toLowerCase()
  if (normalizedPlatform === 'email' || normalizedActionCode === 'email_send') return 'email'
  if (normalizedPlatform === 'zalo' || ZALO_ACCOUNT_ACTION_CODES.has(normalizedActionCode)) return 'zalo'
  if (FACEBOOK_FANPAGE_ACCOUNT_ACTION_CODES.has(normalizedActionCode)) return 'facebookFanpage'
  return 'facebookCore'
}

export function getFeatureDailySendLimit(
  entitlements: Partial<AuthEntitlements> | null | undefined,
  feature: EntitlementFeature
): number | null {
  return normalizePositiveInteger(entitlements?.dailySendLimits?.[feature])
}

export function getCampaignActionDailySendLimit(
  actionId: string | null | undefined,
  flatformType: string | null | undefined,
  entitlements: Partial<AuthEntitlements> | null | undefined
): number | null {
  return getFeatureDailySendLimit(entitlements, getCampaignActionFeature(actionId, flatformType))
}

export function getAccountActionDailySendLimit(
  actionCode: string | null | undefined,
  flatformType: string | null | undefined,
  entitlements: Partial<AuthEntitlements> | null | undefined
): number | null {
  const normalizedActionCode = String(actionCode || '').trim()
  if (normalizedActionCode === ZALO_FIND_PHONE_ACTION_CODE) return null
  return getFeatureDailySendLimit(entitlements, getAccountActionFeature(normalizedActionCode, flatformType))
}

export function canUseAccountPlatformWithEntitlements(
  flatformType: string | null | undefined,
  entitlements: Partial<AuthEntitlements> | null | undefined
): boolean {
  const platform = String(flatformType || '').trim().toLowerCase()
  if (platform === 'email') return !!entitlements?.email
  if (platform === 'zalo') return !!entitlements?.zalo
  if (platform === 'facebook') return !!entitlements?.facebookCore || !!entitlements?.facebookFanpage
  return false
}

export async function canCurrentUserUseAccountPlatform(flatformType?: string | null): Promise<boolean> {
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  return canUseAccountPlatformWithEntitlements(flatformType, entitlements)
}

export async function ensureCurrentUserCanUseAccountPlatform(flatformType?: string | null): Promise<void> {
  const platform = String(flatformType || '').trim().toLowerCase()
  if (platform === 'facebook') {
    const entitlements = await loadCurrentUserEffectiveEntitlements()
    if (!canUseAccountPlatformWithEntitlements(platform, entitlements)) {
      throw new Error(FACEBOOK_CORE_FEATURE_UNAVAILABLE_MESSAGE)
    }
    return
  }
  if (platform === 'email') return ensureCurrentUserFeatureActive('email')
  if (platform === 'zalo') return ensureCurrentUserFeatureActive('zalo')
  throw new Error('Tính năng này chưa được kích hoạt hoặc đã hết hạn.')
}

export async function canCurrentUserUseCampaignAction(actionId?: string | null, flatformType?: string | null): Promise<boolean> {
  return canCurrentUserUseFeature(getCampaignActionFeature(actionId, flatformType))
}

export async function ensureCurrentUserCanUseCampaignAction(actionId?: string | null, flatformType?: string | null): Promise<void> {
  return ensureCurrentUserFeatureActive(getCampaignActionFeature(actionId, flatformType))
}

export function canUseCampaignActionWithEntitlements(
  actionId: string | null | undefined,
  flatformType: string | null | undefined,
  entitlements: Partial<AuthEntitlements> | null | undefined
): boolean {
  return !!entitlements?.[getCampaignActionFeature(actionId, flatformType)]
}

export function canUseAccountActionWithEntitlements(
  actionCode: string | null | undefined,
  flatformType: string | null | undefined,
  entitlements: Partial<AuthEntitlements> | null | undefined
): boolean {
  return !!entitlements?.[getAccountActionFeature(actionCode, flatformType)]
}
