import type { AppNotification } from '../../../shared/types'
import { parseAppNotification } from '../../../shared/appNotification'
import { requireCurrentUser } from '../currentUser'
import { callCurrentStaffClient } from './staffClientRepository'
import { listActiveSystemSettingsByKeys } from './systemSettingsRepository'
import { shouldSkipLegacyRenewalNotice } from '../../../shared/renewalReminderDesktop'
import { renewalReminderService } from '../../services/renewalReminderService'

const APP_NOTIFICATION_SETTING_KEY = 'app.notification'

export async function getActiveAppNotification(): Promise<AppNotification | null> {
  const user = requireCurrentUser()
  try {
    const staff = await callCurrentStaffClient('read')
    // Thông báo nhắc gia hạn do job ghi cho bản app cũ: bỏ qua khi giao diện nhắc gia hạn mới đang bật cho người này,
    // để không hiện hai dải. Tắt tính năng thì giữ nguyên như cũ.
    const skipLegacy = shouldSkipLegacyRenewalNotice(renewalReminderService.enabledForCurrentUser(), staff.app_notification)
    const notification = skipLegacy ? null : parseAppNotification(user.staffId, staff.updated_at, staff.app_notification)
    if (notification) return notification
  } catch { console.warn('Không đọc được thông báo nhân viên.') }

  const settings = await listActiveSystemSettingsByKeys([APP_NOTIFICATION_SETTING_KEY])
  const setting = settings.get(APP_NOTIFICATION_SETTING_KEY)
  return setting ? parseAppNotification(setting.id, setting.updatedAt, setting.value) : null
}
