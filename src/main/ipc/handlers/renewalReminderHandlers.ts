import { ipcMain, type BrowserWindow } from 'electron'
import { RENEWAL_REMINDER_IPC } from '../../../shared/renewalReminderDesktop'
import type { RenewalReminderState } from '../../../shared/renewalReminder'
import { issueRenewalLinkTicket } from '../../data/repositories/renewalReminderRepository'
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
    // Vé gia hạn dùng một lần do DB cấp (V521); DB chưa có hàm hoặc từ chối thì service dùng link thường.
    issueTicket: issueRenewalLinkTicket
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
