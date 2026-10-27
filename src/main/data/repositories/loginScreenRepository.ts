import type { LoginScreenContent } from '../../../shared/types'
import { normalizePublicLinkUrl, parseAppNotification } from '../../../shared/appNotification'
import { getSupabaseClient } from '../supabaseClient'

interface LoginScreenSettingRow { id: number; key: string; value: string | null; updated_at: string }

// Public before authentication. The RPC owns the fixed five-key allowlist and
// active/non-secret filters; no caller-supplied key or table access is accepted.
export async function getLoginScreenContent(): Promise<LoginScreenContent> {
  const { data, error } = await getSupabaseClient()
    .rpc('aka_agent_desktop_login_content')
    .abortSignal(AbortSignal.timeout(10_000))

  if (error) throw new Error('Không thể tải thông tin từ akaBiz.')
  const settings = new Map(((data || []) as LoginScreenSettingRow[]).map(row => [row.key, row]))
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
