import type { AppNotification } from '../../../shared/types'
import { parseAppNotification } from '../../../shared/appNotification'
import { requireCurrentUser } from '../currentUser'
import { callCurrentStaffClient } from './staffClientRepository'
import { listActiveSystemSettingsByKeys } from './systemSettingsRepository'

const APP_NOTIFICATION_SETTING_KEY = 'app.notification'

export async function getActiveAppNotification(): Promise<AppNotification | null> {
  const user = requireCurrentUser()
  try {
    const staff = await callCurrentStaffClient('read')
    const notification = parseAppNotification(user.staffId, staff.updated_at, staff.app_notification)
    if (notification) return notification
  } catch { console.warn('Không đọc được thông báo nhân viên.') }

  const settings = await listActiveSystemSettingsByKeys([APP_NOTIFICATION_SETTING_KEY])
  const setting = settings.get(APP_NOTIFICATION_SETTING_KEY)
  return setting ? parseAppNotification(setting.id, setting.updatedAt, setting.value) : null
}
