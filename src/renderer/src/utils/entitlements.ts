import type { AuthEntitlementFeature, AuthEntitlements, CampaignAction } from '../../../shared/types'

const DEFAULT_DAILY_SEND_LIMITS: AuthEntitlements['dailySendLimits'] = {
  facebookCore: null,
  facebookFanpage: null,
  email: null,
  zalo: null
}

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
  'zalo_message_group'
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
  'zalo_tag_contact',
  'zalo_change_alias'
])

const ZALO_FIND_PHONE_ACTION_CODE = 'zalo_find_phone_user'

export function normalizeEntitlements(entitlements?: Partial<AuthEntitlements> | null): AuthEntitlements {
  return {
    facebookCore: !!entitlements?.facebookCore,
    facebookFanpage: !!entitlements?.facebookFanpage,
    email: !!entitlements?.email,
    zalo: !!entitlements?.zalo,
    dailySendLimits: {
      ...DEFAULT_DAILY_SEND_LIMITS,
      ...(entitlements?.dailySendLimits || {})
    }
  }
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function canUsePlatform(
  platform: string | null | undefined,
  entitlements?: Partial<AuthEntitlements> | null
): boolean {
  const normalized = normalizeEntitlements(entitlements)
  switch (String(platform || '').trim().toLowerCase()) {
    case 'email':
      return normalized.email
    case 'zalo':
      return normalized.zalo
    case 'facebook':
      return normalized.facebookCore || normalized.facebookFanpage
    default:
      return false
  }
}

export function canUseCampaignAction(
  action: Pick<CampaignAction, 'id' | 'flatformType'> | null | undefined,
  entitlements?: Partial<AuthEntitlements> | null
): boolean {
  if (!action) return false
  const normalized = normalizeEntitlements(entitlements)
  if (action.id === 'email_send' || action.flatformType === 'email') return normalized.email
  if (ZALO_CAMPAIGN_ACTION_IDS.has(action.id) || action.flatformType === 'zalo') return normalized.zalo
  if (FACEBOOK_FANPAGE_CAMPAIGN_ACTION_IDS.has(action.id)) return normalized.facebookFanpage
  return normalized.facebookCore
}

export function getCampaignActionFeature(
  action: Pick<CampaignAction, 'id' | 'flatformType'> | null | undefined
): AuthEntitlementFeature {
  const actionId = String(action?.id || '').trim()
  const flatformType = String(action?.flatformType || '').trim().toLowerCase()
  if (actionId === 'email_send' || flatformType === 'email') return 'email'
  if (ZALO_CAMPAIGN_ACTION_IDS.has(actionId) || flatformType === 'zalo') return 'zalo'
  if (FACEBOOK_FANPAGE_CAMPAIGN_ACTION_IDS.has(actionId)) return 'facebookFanpage'
  return 'facebookCore'
}

export function getAccountActionFeature(
  actionCode?: string | null,
  flatformType?: string | null
): AuthEntitlementFeature {
  const normalizedActionCode = String(actionCode || '').trim()
  const normalizedPlatform = String(flatformType || '').trim().toLowerCase()
  if (normalizedPlatform === 'email' || normalizedActionCode === 'email_send') return 'email'
  if (normalizedPlatform === 'zalo' || ZALO_ACCOUNT_ACTION_CODES.has(normalizedActionCode)) return 'zalo'
  if (FACEBOOK_FANPAGE_ACCOUNT_ACTION_CODES.has(normalizedActionCode)) return 'facebookFanpage'
  return 'facebookCore'
}

export function getFeatureDailySendLimit(
  entitlements?: Partial<AuthEntitlements> | null,
  feature?: AuthEntitlementFeature | null
): number | null {
  if (!feature) return null
  const normalized = normalizeEntitlements(entitlements)
  return normalizePositiveInteger(normalized.dailySendLimits[feature])
}

export function getCampaignActionDailySendLimit(
  action: Pick<CampaignAction, 'id' | 'flatformType'> | null | undefined,
  entitlements?: Partial<AuthEntitlements> | null
): number | null {
  if (!action) return null
  return getFeatureDailySendLimit(entitlements, getCampaignActionFeature(action))
}

export function getAccountActionDailySendLimit(
  actionCode?: string | null,
  flatformType?: string | null,
  entitlements?: Partial<AuthEntitlements> | null
): number | null {
  const normalizedActionCode = String(actionCode || '').trim()
  if (normalizedActionCode === ZALO_FIND_PHONE_ACTION_CODE) return null
  return getFeatureDailySendLimit(entitlements, getAccountActionFeature(normalizedActionCode, flatformType))
}

export function clampDailyLimitToEntitlement(value: number, dailyLimitCap?: number | null): number {
  const normalizedCap = normalizePositiveInteger(dailyLimitCap)
  if (!normalizedCap) return value
  return Math.min(value, normalizedCap)
}

export function getFirstAllowedPlatform(
  entitlements?: Partial<AuthEntitlements> | null,
  platforms: string[] = ['facebook', 'zalo', 'email']
): string {
  return platforms.find(platform => canUsePlatform(platform, entitlements)) || ''
}
