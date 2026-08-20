import type { CampaignExtraSettings } from './types'

export const DEFAULT_RECENT_DELIVERY_COOLDOWN_DAYS = 3
export const MIN_RECENT_DELIVERY_COOLDOWN_DAYS = 1
export const MAX_RECENT_DELIVERY_COOLDOWN_DAYS = 3650

const ALWAYS_SUPPORTED_ACTION_IDS = new Set([
  'facebook_group_post',
  'facebook_page_post',
  'facebook_message_friend',
  'facebook_page_to_message',
  'zalo_message_friend',
  'zalo_message_birthday',
  'zalo_message_group',
  'sms_send',
  'email_send'
])

const MESSAGE_TOGGLE_ACTION_IDS = new Set([
  'zalo_message_phone',
  'zalo_message_group_member',
  'zalo_message_group_realtime',
  'zalo_message_remarketing_customer',
  'zalo_message_friend_recommendation'
])

export function supportsRecentDeliveryCooldown(
  actionId: string | null | undefined,
  extraSettings?: Pick<CampaignExtraSettings, 'enableMessage'> | null
): boolean {
  if (!actionId) return false
  if (ALWAYS_SUPPORTED_ACTION_IDS.has(actionId)) return true
  if (actionId === 'facebook_message_uid') return extraSettings?.enableMessage !== false
  return MESSAGE_TOGGLE_ACTION_IDS.has(actionId) && extraSettings?.enableMessage === true
}

export function normalizeRecentDeliveryCooldownDays(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) return DEFAULT_RECENT_DELIVERY_COOLDOWN_DAYS
  return Math.min(MAX_RECENT_DELIVERY_COOLDOWN_DAYS, Math.max(MIN_RECENT_DELIVERY_COOLDOWN_DAYS, parsed))
}

export function isRecentDeliveryCooldownEnabled(
  actionId: string | null | undefined,
  extraSettings?: CampaignExtraSettings | null
): boolean {
  return extraSettings?.recentDeliveryCooldownEnabled === true &&
    supportsRecentDeliveryCooldown(actionId, extraSettings)
}
