import type { AppNotification } from '../../../shared/types'
import { parseAppNotification } from '../../../shared/appNotification'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import { listActiveSystemSettingsByKeys } from './systemSettingsRepository'

const APP_NOTIFICATION_SETTING_KEY = 'app.notification'

export async function getActiveAppNotification(): Promise<AppNotification | null> {
  const user = requireCurrentUser()
  const { data: staff, error } = await getSupabaseClient()
    .from('org_staff')
    .select('app_notification, updated_at')
    .eq('id', user.staffId)
    .eq('organization_id', user.organizationId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.warn('Get staff app notification failed:', error.code)
  } else {
    const notification = parseAppNotification(user.staffId, staff?.updated_at, staff?.app_notification)
    if (notification) return notification
  }

  const settings = await listActiveSystemSettingsByKeys([APP_NOTIFICATION_SETTING_KEY])
  const setting = settings.get(APP_NOTIFICATION_SETTING_KEY)
  return setting ? parseAppNotification(setting.id, setting.updatedAt, setting.value) : null
}
