import type { LoginScreenContent } from '../../../shared/types'
import { normalizePublicLinkUrl, parseAppNotification } from '../../../shared/appNotification'
import { getSupabaseClient } from '../supabaseClient'

// Public before authentication. Never accept a key list from the renderer or
// reuse the general authenticated settings reader here.
const LOGIN_SCREEN_SETTING_KEYS = [
  'app.notification',
  'akabiz.links.website',
  'akabiz.links.user_guide',
  'akabiz.links.upgrade_payment',
  'akabiz.links.contact_us'
]

export async function getLoginScreenContent(): Promise<LoginScreenContent> {
  const { data, error } = await getSupabaseClient()
    .from('auto_system_settings')
    .select('id,key,value,updated_at')
    .in('key', LOGIN_SCREEN_SETTING_KEYS)
    .eq('is_active', true)
    .eq('is_secret', false)
    .abortSignal(AbortSignal.timeout(10_000))

  if (error) throw new Error('Không thể tải thông tin từ akaBiz.')
  const settings = new Map((data || []).map(row => [row.key as string, row]))
  const notification = settings.get('app.notification')
  return {
    notification: notification
      ? parseAppNotification(notification.id, notification.updated_at, notification.value)
      : null,
    links: {
      website: normalizePublicLinkUrl(settings.get('akabiz.links.website')?.value),
      userGuide: normalizePublicLinkUrl(settings.get('akabiz.links.user_guide')?.value),
      upgradePayment: normalizePublicLinkUrl(settings.get('akabiz.links.upgrade_payment')?.value),
      contactUs: normalizePublicLinkUrl(settings.get('akabiz.links.contact_us')?.value)
    }
  }
}
