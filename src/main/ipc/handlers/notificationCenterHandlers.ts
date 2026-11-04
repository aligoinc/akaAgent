import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC_EVENTS, type NotificationCenterResult } from '../../../shared/types'
import {
  NOTIFICATION_CENTER_UNAVAILABLE,
  isValidNotificationEmail,
  sanitizeNotificationListQuery,
  sanitizeNotificationReadRequest,
  sanitizeSaveNotificationSettingsRequest
} from '../../../shared/notificationCenter'
import {
  NotificationCenterError,
  getNotificationDetail,
  getNotificationSettings,
  getNotificationUnreadCount,
  listNotifications,
  markNotificationsRead,
  resendNotificationVerification,
  saveNotificationSettings,
  sendNotificationTest,
  setNotificationDeviceEnabled,
  unregisterNotificationDevice
} from '../../data/repositories/notificationCenterRepository'

const isPositiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function invalidRequest(): never {
  throw new NotificationCenterError('notification_invalid_request')
}

/**
 * Trung tâm thông báo (V457). Mọi kênh trả `NotificationCenterResult` thay vì ném lỗi để
 * renderer phân nhánh theo mã (vd. `notification_center_not_ready` → form email cũ,
 * `notification_settings_conflict` → giữ nháp và mời tải lại).
 */
export function registerNotificationCenterHandlers(mainWindow: BrowserWindow): void {
  const handle = <T>(channel: string, run: (...args: unknown[]) => Promise<T>): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<NotificationCenterResult<T>> => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('Không có quyền truy cập cài đặt.')
      }
      try {
        return { ok: true, data: await run(...args) }
      } catch (error) {
        if (error instanceof NotificationCenterError) return { ok: false, code: error.code, message: error.message }
        console.warn(`[notification-center] unexpected failure on ${channel}: ${error instanceof Error ? error.name : typeof error}`)
        const failure = new NotificationCenterError(NOTIFICATION_CENTER_UNAVAILABLE)
        return { ok: false, code: failure.code, message: failure.message }
      }
    })
  }

  handle(IPC_EVENTS.NOTIFICATION_CENTER_SETTINGS_GET, () => getNotificationSettings())

  handle(IPC_EVENTS.NOTIFICATION_CENTER_SETTINGS_SAVE, async (input) => {
    const request = sanitizeSaveNotificationSettingsRequest(input)
    if (!request) invalidRequest()
    return saveNotificationSettings(request)
  })

  handle(IPC_EVENTS.NOTIFICATION_CENTER_TEST, async (channel) => {
    if (channel !== 'email' && channel !== 'push') throw new NotificationCenterError('notification_invalid_channel')
    return sendNotificationTest(channel)
  })

  handle(IPC_EVENTS.NOTIFICATION_CENTER_RESEND_VERIFICATION, async (email) => {
    const value = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (!value || !isValidNotificationEmail(value)) throw new NotificationCenterError('notification_invalid_email')
    return resendNotificationVerification(value)
  })

  handle(IPC_EVENTS.NOTIFICATION_CENTER_LIST, (query) => listNotifications(sanitizeNotificationListQuery(query)))

  handle(IPC_EVENTS.NOTIFICATION_CENTER_DETAIL, async (id) => {
    if (!isPositiveId(id)) throw new NotificationCenterError('notification_not_found')
    return getNotificationDetail(id)
  })

  handle(IPC_EVENTS.NOTIFICATION_CENTER_MARK_READ, async (input) => {
    const request = sanitizeNotificationReadRequest(input)
    if (!request) throw new NotificationCenterError('notification_invalid_ids')
    return markNotificationsRead(request)
  })

  handle(IPC_EVENTS.NOTIFICATION_CENTER_UNREAD_COUNT, () => getNotificationUnreadCount())

  handle(IPC_EVENTS.NOTIFICATION_CENTER_DEVICE_SET_ENABLED, async (deviceId, enabled) => {
    if (!isPositiveId(deviceId) || typeof enabled !== 'boolean') throw new NotificationCenterError('notification_invalid_device')
    return setNotificationDeviceEnabled(deviceId, enabled)
  })

  handle(IPC_EVENTS.NOTIFICATION_CENTER_DEVICE_UNREGISTER, async (deviceId) => {
    if (!isPositiveId(deviceId)) throw new NotificationCenterError('notification_invalid_device')
    return unregisterNotificationDevice(deviceId)
  })
}
