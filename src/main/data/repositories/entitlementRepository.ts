import {
  AuthAccountProduct,
  AuthEntitlementFeature,
  AuthEntitlements,
  AuthUser,
  AutoAccount,
  ZaloAccountCapabilities
} from '../../../shared/types'
import {
  AUTH_PRODUCT_BY_FEATURE,
  AUTH_PRODUCT_IDS,
  AUTH_PRODUCTS_BY_FEATURE,
  AUTH_ZALO_PRODUCT_IDS,
  getAuthProductById
} from '../../../shared/authProductCatalog'
import { getVietnamDayStart } from '../../../shared/vietnamTime'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

export type EntitlementFeature = AuthEntitlementFeature

export const FACEBOOK_CORE_PRODUCT_ID = AUTH_PRODUCT_BY_FEATURE.facebookCore.productId
export const FACEBOOK_FANPAGE_PRODUCT_ID = AUTH_PRODUCT_BY_FEATURE.facebookFanpage.productId
export const EMAIL_PRODUCT_ID = AUTH_PRODUCT_BY_FEATURE.email.productId
export const ZALO_PRODUCT_IDS = AUTH_ZALO_PRODUCT_IDS
export const SMS_PRODUCT_ID = AUTH_PRODUCT_BY_FEATURE.sms.productId
export const AKA_AGENT_PRODUCT_ID = FACEBOOK_CORE_PRODUCT_ID
export const DEFAULT_DEMO_DAILY_SEND_LIMIT = 30
export const ZALO_FIND_PHONE_ACTION_CODE = 'zalo_find_phone_user'

export const ACCOUNT_EXPIRED_MESSAGE = 'Tài khoản của bạn đã hết hạn'
export const FACEBOOK_CORE_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng Facebook chưa được kích hoạt hoặc đã hết hạn.'
export const FACEBOOK_FANPAGE_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng Facebook Fanpage chưa được kích hoạt hoặc đã hết hạn.'
export const EMAIL_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng Email chưa được kích hoạt hoặc đã hết hạn.'
export const ZALO_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng Zalo chưa được kích hoạt hoặc đã hết hạn.'
export const ZALO_QR_FEATURE_UNAVAILABLE_MESSAGE = 'Gói hiện tại không hỗ trợ tài khoản Zalo (mã QR).'
export const ZALO_WEB_FEATURE_UNAVAILABLE_MESSAGE = 'Gói hiện tại không hỗ trợ tài khoản Zalo (trình duyệt).'
export const ZALO_SERVER_FEATURE_UNAVAILABLE_MESSAGE = 'Gói hiện tại không hỗ trợ tài khoản Zalo chạy trên server.'
export const SMS_FEATURE_UNAVAILABLE_MESSAGE = 'Tính năng SMS chưa được kích hoạt hoặc đã hết hạn.'

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
  'zalo_add_group_member',
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
  'zalo_add_group_member',
  'zalo_join_group_link',
  'zalo_cancel_sent_friend_request',
  'zalo_tag_contact',
  'zalo_change_alias'
])

const FEATURE_PRODUCT_IDS: Record<EntitlementFeature, readonly number[]> = {
  facebookCore: AUTH_PRODUCTS_BY_FEATURE.facebookCore.map(item => item.productId),
  facebookFanpage: AUTH_PRODUCTS_BY_FEATURE.facebookFanpage.map(item => item.productId),
  email: AUTH_PRODUCTS_BY_FEATURE.email.map(item => item.productId),
  zalo: AUTH_PRODUCTS_BY_FEATURE.zalo.map(item => item.productId),
  sms: AUTH_PRODUCTS_BY_FEATURE.sms.map(item => item.productId)
}

const FEATURE_UNAVAILABLE_MESSAGES: Record<EntitlementFeature, string> = {
  facebookCore: FACEBOOK_CORE_FEATURE_UNAVAILABLE_MESSAGE,
  facebookFanpage: FACEBOOK_FANPAGE_FEATURE_UNAVAILABLE_MESSAGE,
  email: EMAIL_FEATURE_UNAVAILABLE_MESSAGE,
  zalo: ZALO_FEATURE_UNAVAILABLE_MESSAGE,
  sms: SMS_FEATURE_UNAVAILABLE_MESSAGE
}

interface OrganizationProductRow {
  id?: number | string | null
  product_id?: number | null
  product_name?: string | null
  package_name?: string | null
  expiration_date?: string | null
  package_type?: string | null
  max_sends_per_day?: number | string | null
  max_accounts?: number | string | null
  is_zalo_show_web?: boolean | null
  is_zalo_server?: boolean | null
  created_at?: string | null
}

export interface OrganizationEntitlementAccess {
  entitlements: AuthEntitlements
  zaloAccountCapabilities: ZaloAccountCapabilities
}

export function emptyZaloAccountCapabilities(): ZaloAccountCapabilities {
  return { qr: false, web: false, server: false }
}

export function emptyAuthEntitlements(): AuthEntitlements {
  return {
    facebookCore: false,
    facebookFanpage: false,
    email: false,
    zalo: false,
    sms: false,
    dailySendLimits: {
      facebookCore: null,
      facebookFanpage: null,
      email: null,
      zalo: null,
      sms: null
    },
    accountLimits: {
      facebookCore: null,
      facebookFanpage: null,
      email: null,
      zalo: null,
      sms: null
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
    sms: !!entitlements?.sms,
    dailySendLimits: {
      ...empty.dailySendLimits,
      ...(entitlements?.dailySendLimits || {})
    },
    accountLimits: {
      ...empty.accountLimits,
      ...(entitlements?.accountLimits || {})
    }
  }
}

function todayStartTimestamp(): number {
  return getVietnamDayStart().getTime()
}

function isExpirationActive(expirationDate?: string | null): boolean {
  const expirationTime = expirationDate ? Date.parse(expirationDate) : NaN
  return Number.isFinite(expirationTime) && expirationTime >= todayStartTimestamp()
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getFeatureDailySendLimitFromProducts(rows: OrganizationProductRow[]): number | null {
  const activeRows = rows.filter(row => isExpirationActive(row.expiration_date))
  if (activeRows.length === 0) return null

  const paidRows = activeRows.filter(row => String(row.package_type || '').trim().toLowerCase() !== 'demo')
  if (paidRows.length > 0) {
    const paidLimits = paidRows
      .map(row => normalizePositiveInteger(row.max_sends_per_day))
      .filter((limit): limit is number => limit !== null)
    return paidLimits.length > 0 ? Math.max(...paidLimits) : null
  }

  const demoLimits = activeRows
    .map(row => normalizePositiveInteger(row.max_sends_per_day))
    .filter((limit): limit is number => limit !== null)
  return demoLimits.length > 0 ? Math.max(...demoLimits) : DEFAULT_DEMO_DAILY_SEND_LIMIT
}

function getFeatureAccountLimit(rows: OrganizationProductRow[]): number | null {
  const limits = rows
    .filter(row => isExpirationActive(row.expiration_date))
    .map(row => normalizePositiveInteger(row.max_accounts))
    .filter((limit): limit is number => limit !== null)
  return limits.length > 0 ? Math.max(...limits) : null
}

function getNewestZaloProductRow(
  rows: OrganizationProductRow[],
  activeOnly: boolean
): OrganizationProductRow | null {
  // Both entitlement queries order with the same database-side rule as the
  // SQL resolver. Keep that exact order here instead of reparsing timestamptz
  // or bigint values in JavaScript, which could lose sub-millisecond/64-bit
  // precision and select a different winner.
  return rows.find(row => (
    ZALO_PRODUCT_IDS.includes(
      Number(row.product_id) as (typeof ZALO_PRODUCT_IDS)[number]
    ) &&
    (!activeOnly || isExpirationActive(row.expiration_date))
  )) || null
}

function getZaloDailySendLimit(rows: OrganizationProductRow[]): number | null {
  const activeRows = rows.filter(row => isExpirationActive(row.expiration_date))
  const configuredLimits = activeRows
    .map(row => normalizePositiveInteger(row.max_sends_per_day))
    .filter((limit): limit is number => limit !== null)
  if (configuredLimits.length > 0) return Math.max(...configuredLimits)

  const hasPaidPackage = activeRows.some(row => String(row.package_type || '').trim().toLowerCase() !== 'demo')
  if (hasPaidPackage) return null
  return activeRows.length > 0 ? DEFAULT_DEMO_DAILY_SEND_LIMIT : null
}

function resolveZaloAccountCapabilities(rows: OrganizationProductRow[]): ZaloAccountCapabilities {
  const effectiveRow = getNewestZaloProductRow(rows, true)
  return {
    qr: effectiveRow !== null,
    web: effectiveRow?.is_zalo_show_web === true,
    server: effectiveRow?.is_zalo_server === true
  }
}

function hasAnyEntitlement(entitlements: Partial<AuthEntitlements> | null | undefined): boolean {
  return !!(
    entitlements?.facebookCore ||
    entitlements?.facebookFanpage ||
    entitlements?.email ||
    entitlements?.zalo ||
    entitlements?.sms
  )
}

export function getFeatureUnavailableMessage(feature: EntitlementFeature): string {
  return FEATURE_UNAVAILABLE_MESSAGES[feature]
}

export async function loadOrganizationEntitlementAccess(
  organizationId: number
): Promise<OrganizationEntitlementAccess> {
  const entitlements = emptyAuthEntitlements()
  const { data, error } = await client()
    .from('org_organization_product')
    .select('id, product_id, expiration_date, package_type, max_sends_per_day, max_accounts, is_zalo_show_web, is_zalo_server, created_at')
    .eq('organization_id', organizationId)
    .eq('is_deleted', false)
    .in('product_id', AUTH_PRODUCT_IDS)
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })

  if (error) {
    console.error('[entitlements] load organization entitlements:', error)
    throw new Error('Không thể kiểm tra quyền sử dụng. Vui lòng thử lại sau.')
  }

  const rows = (data || []) as unknown as OrganizationProductRow[]
  for (const [feature, productIds] of Object.entries(FEATURE_PRODUCT_IDS) as Array<[EntitlementFeature, readonly number[]]>) {
    const featureRows = rows.filter(row => productIds.includes(Number(row.product_id)))
    const effectiveZaloRow = feature === 'zalo'
      ? getNewestZaloProductRow(featureRows, true)
      : null
    const effectiveRows = feature === 'zalo'
      ? (effectiveZaloRow ? [effectiveZaloRow] : [])
      : featureRows
    entitlements[feature] = effectiveRows.some(row => isExpirationActive(row.expiration_date))
    entitlements.dailySendLimits[feature] = feature === 'zalo'
      ? getZaloDailySendLimit(effectiveRows)
      : getFeatureDailySendLimitFromProducts(effectiveRows)
    entitlements.accountLimits[feature] = getFeatureAccountLimit(effectiveRows)
  }

  return {
    entitlements,
    zaloAccountCapabilities: resolveZaloAccountCapabilities(rows)
  }
}

export async function loadOrganizationEntitlements(organizationId: number): Promise<AuthEntitlements> {
  return (await loadOrganizationEntitlementAccess(organizationId)).entitlements
}

export async function loadOrganizationZaloAccountCapabilities(
  organizationId: number
): Promise<ZaloAccountCapabilities> {
  return (await loadOrganizationEntitlementAccess(organizationId)).zaloAccountCapabilities
}

export async function loadOrganizationAccountProducts(organizationId: number): Promise<AuthAccountProduct[]> {
  const { data, error } = await client()
    .from('org_organization_product')
    .select('id, product_id, product_name, package_name, package_type, expiration_date, max_accounts, is_zalo_show_web, is_zalo_server, created_at')
    .eq('organization_id', organizationId)
    .eq('is_deleted', false)
    .in('product_id', AUTH_PRODUCT_IDS)
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })

  if (error) {
    console.error('[entitlements] load organization account products:', error)
    throw new Error('Không thể tải thông tin gói sản phẩm. Vui lòng thử lại sau.')
  }

  const rows = (data || []) as unknown as OrganizationProductRow[]
  const effectiveZaloRow = getNewestZaloProductRow(rows, true)
    || getNewestZaloProductRow(rows, false)
  const effectiveRows = rows.filter(row => (
    !ZALO_PRODUCT_IDS.includes(
      Number(row.product_id) as (typeof ZALO_PRODUCT_IDS)[number]
    ) || row === effectiveZaloRow
  ))

  return effectiveRows.map(row => {
    const organizationProductId = Number(row.id)
    const productId = Number(row.product_id)
    const productCatalogItem = getAuthProductById(Number.isFinite(productId) ? productId : null)
    const productName = String(row.product_name || '').trim()
    const packageName = String(row.package_name || '').trim()
    return {
      organizationProductId: Number.isSafeInteger(organizationProductId) && organizationProductId > 0
        ? organizationProductId
        : null,
      feature: productCatalogItem?.feature ?? null,
      productId: Number.isFinite(productId) ? productId : null,
      productName,
      packageName,
      packageType: row.package_type ? String(row.package_type).trim() : null,
      displayName: productCatalogItem?.label || productName || packageName || 'Sản phẩm',
      displayOrder: productCatalogItem?.order ?? 99,
      expirationDate: row.expiration_date || null,
      maxAccounts: normalizePositiveInteger(row.max_accounts),
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

type ZaloCapabilityUser = Partial<Pick<
  AuthUser,
  'entitlements' | 'isZaloServer' | 'isZaloShowWeb' | 'zaloAccountCapabilities'
>>

/**
 * Normalize the startup capability snapshot. The legacy fallback keeps an old
 * persisted AuthUser usable for one upgrade login; newly built users always
 * include zaloAccountCapabilities explicitly.
 */
export function getUserZaloAccountCapabilities(
  user: ZaloCapabilityUser | null | undefined
): ZaloAccountCapabilities {
  const capabilities = user?.zaloAccountCapabilities
  if (
    capabilities &&
    typeof capabilities.qr === 'boolean' &&
    typeof capabilities.web === 'boolean' &&
    typeof capabilities.server === 'boolean'
  ) {
    return {
      qr: capabilities.qr || capabilities.web,
      web: capabilities.web,
      server: capabilities.server
    }
  }

  const hasLegacyZaloEntitlement = user?.entitlements?.zalo === true
  const legacyWeb = hasLegacyZaloEntitlement && user?.isZaloShowWeb === true
  return {
    qr: hasLegacyZaloEntitlement,
    web: legacyWeb,
    server: hasLegacyZaloEntitlement && user?.isZaloServer === true
  }
}

export function loadCurrentUserZaloAccountCapabilities(): ZaloAccountCapabilities {
  return getUserZaloAccountCapabilities(requireCurrentUser())
}

export function canUseZaloAccountWithCapabilities(
  accountOrShowWeb: Pick<AutoAccount, 'isZaloShowWeb' | 'isZaloServer'> | boolean,
  capabilities: Partial<ZaloAccountCapabilities> | null | undefined,
  isZaloServer = false
): boolean {
  const isShowWeb = typeof accountOrShowWeb === 'boolean'
    ? accountOrShowWeb
    : accountOrShowWeb.isZaloShowWeb === true
  const isServer = typeof accountOrShowWeb === 'boolean'
    ? isZaloServer
    : accountOrShowWeb.isZaloServer === true
  if (isShowWeb && isServer) return false
  if (isServer) return capabilities?.server === true
  return isShowWeb ? capabilities?.web === true : capabilities?.qr === true
}

export function canUseAccountWithEntitlementsAndCapabilities(
  account: Pick<AutoAccount, 'flatformType' | 'isZaloShowWeb' | 'isZaloServer'>,
  entitlements: Partial<AuthEntitlements> | null | undefined,
  zaloAccountCapabilities: Partial<ZaloAccountCapabilities> | null | undefined
): boolean {
  if (!canUseAccountPlatformWithEntitlements(account.flatformType, entitlements)) return false
  return String(account.flatformType || '').trim().toLowerCase() !== 'zalo'
    || canUseZaloAccountWithCapabilities(account, zaloAccountCapabilities)
}

export async function ensureCurrentUserCanUseZaloAccountType(
  isZaloShowWeb: boolean,
  isZaloServer = false
): Promise<void> {
  await ensureCurrentUserFeatureActive('zalo')
  const capabilities = loadCurrentUserZaloAccountCapabilities()
  if (!canUseZaloAccountWithCapabilities(isZaloShowWeb, capabilities, isZaloServer)) {
    throw new Error(isZaloServer
      ? ZALO_SERVER_FEATURE_UNAVAILABLE_MESSAGE
      : isZaloShowWeb
        ? ZALO_WEB_FEATURE_UNAVAILABLE_MESSAGE
        : ZALO_QR_FEATURE_UNAVAILABLE_MESSAGE)
  }
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
  if (normalizedActionId === 'sms_send' || normalizedActionId === 'voice_call' || normalizedPlatform === 'sms') return 'sms'
  if (normalizedActionId === 'email_send' || normalizedPlatform === 'email') return 'email'
  if (ZALO_CAMPAIGN_ACTION_IDS.has(normalizedActionId) || normalizedPlatform === 'zalo') return 'zalo'
  if (FACEBOOK_FANPAGE_CAMPAIGN_ACTION_IDS.has(normalizedActionId)) return 'facebookFanpage'
  return 'facebookCore'
}

export function getAccountActionFeature(actionCode?: string | null, flatformType?: string | null): EntitlementFeature {
  const normalizedActionCode = String(actionCode || '').trim()
  const normalizedPlatform = String(flatformType || '').trim().toLowerCase()
  if (normalizedPlatform === 'sms' || normalizedActionCode === 'sms_send' || normalizedActionCode === 'voice_call') return 'sms'
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

export function getAccountPlatformLimit(
  flatformType: string | null | undefined,
  entitlements: Partial<AuthEntitlements> | null | undefined
): number | null {
  const platform = String(flatformType || '').trim().toLowerCase()
  if (platform === 'sms') return entitlements?.sms ? normalizePositiveInteger(entitlements?.accountLimits?.sms) : null
  if (platform === 'email') return entitlements?.email ? normalizePositiveInteger(entitlements?.accountLimits?.email) : null
  if (platform === 'zalo') return entitlements?.zalo ? normalizePositiveInteger(entitlements?.accountLimits?.zalo) : null
  if (platform === 'facebook') {
    const limits: Array<number | null> = []
    if (entitlements?.facebookCore) limits.push(normalizePositiveInteger(entitlements?.accountLimits?.facebookCore))
    if (entitlements?.facebookFanpage) limits.push(normalizePositiveInteger(entitlements?.accountLimits?.facebookFanpage))
    if (limits.length === 0 || limits.some(limit => limit === null)) return null
    return Math.max(...limits.filter((limit): limit is number => limit !== null))
  }
  return null
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
  if (platform === 'sms') return !!entitlements?.sms
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
  if (platform === 'sms') return ensureCurrentUserFeatureActive('sms')
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
