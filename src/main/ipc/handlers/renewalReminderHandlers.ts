import { ipcMain, type BrowserWindow } from 'electron'
import { RENEWAL_REMINDER_IPC } from '../../../shared/renewalReminderDesktop'
import type { RenewalReminderState } from '../../../shared/renewalReminder'
import { createRenewalPortalLink } from '../../data/repositories/authRepository'
import { getCurrentDeviceIdentity } from '../../services/deviceIdentity'
import { renewalReminderService } from '../../services/renewalReminderService'
import type { RenewalReminderWebControl } from './renewalWebHandlers'

/**
 * Nhắc gia hạn trong phần mềm (docs/RENEWAL_REMINDER_DESKTOP.md): kênh trạng thái cho renderer và điều khiển cửa sổ
 * "Gia hạn gói" khi đang đăng nhập. `refreshEntitlements` là lượt kiểm gói sẵn có (cùng hàm 30 giây).
 */
export function registerRenewalReminderHandlers(
  mainWindow: BrowserWindow,
  refreshEntitlements: () => Promise<void>
): RenewalReminderWebControl {
  const send = (state: RenewalReminderState): void => {
    if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(RENEWAL_REMINDER_IPC.changed, state)
    }
  }
  renewalReminderService.attach({
    send,
    refreshEntitlements,
    // Edge `renewal_link` (aka-agent-desktop-session); chưa deploy thì ném lỗi và service dùng link thường.
    sign: async (credentials, organizationProductId) => createRenewalPortalLink(
      credentials, (await getCurrentDeviceIdentity()).fingerprintHash, organizationProductId
    )
  })

  ipcMain.handle(RENEWAL_REMINDER_IPC.state, () => renewalReminderService.getState())
  ipcMain.handle(RENEWAL_REMINDER_IPC.refresh, () => renewalReminderService.refresh('focus'))

  return {
    currentSessionId: () => renewalReminderService.currentSessionId(),
    onSessionChanged: listener => renewalReminderService.onSessionChanged(listener),
    hasReminder: () => renewalReminderService.hasReminder(),
    createLink: reminderKey => renewalReminderService.resolveLink(reminderKey),
    orderCompleted: () => { void renewalReminderService.refresh('completed') },
    windowClosed: () => { void renewalReminderService.refresh('closed') }
  }
}
