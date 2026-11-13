import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC_EVENTS, type RenewalWebDescriptor, type RenewalWebState } from '../../../shared/types'
import { RenewalWebService, type RenewalWebLink } from '../../services/renewalWebService'
import { RENEWAL_ENDED_MESSAGE, type AuthRenewalControl } from './authHandlers'
import {
  RENEWAL_REMINDER_IPC,
  RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE,
  RENEWAL_REMINDER_NO_REMINDER_MESSAGE,
  type RenewalReminderExternalResult,
  type RenewalReminderOpenResult
} from '../../../shared/renewalReminderDesktop'

/** Cửa sổ "Gia hạn gói" khi đang đăng nhập (nhắc gia hạn). Link ký số chỉ đi trong main. */
export interface RenewalReminderWebControl {
  /** Mã phiên đăng nhập hiện tại; null khi chưa đăng nhập. */
  currentSessionId(): number | null
  onSessionChanged(listener: () => void): () => void
  hasReminder(): boolean
  /** Link cho thông báo hiện tại (ký số, hoặc link thường khi không ký được). Ném lỗi có `code` khi không có thông báo. */
  createLink(reminderKey: unknown): Promise<RenewalWebLink>
  /** Trang CRM báo đơn đã kích hoạt. */
  orderCompleted(): void
  /** Khách đóng cửa sổ (có thể đã thanh toán rồi đóng). */
  windowClosed(): void
}

type Owner = { mode: 'pending'; id: number } | { mode: 'reminder'; id: number }

const errorCode = (error: unknown): string | null =>
  error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null

/**
 * Webview cổng gia hạn. Hai chế độ dùng chung một phân vùng nên không bao giờ cùng tồn tại:
 * - `pending`: màn Gia hạn trước đăng nhập, gắn với đúng một lượt gia hạn của main (giữ nguyên hành vi cũ). Lượt gia
 *   hạn đổi (đăng nhập thành công, huỷ, tài khoản khác, quá hạn chờ) thì đóng và xoá phân vùng.
 * - `reminder`: cửa sổ "Gia hạn gói" khi đang đăng nhập, gắn với phiên đăng nhập; đăng xuất/đổi tài khoản thì đóng.
 */
export function registerRenewalWebHandlers(mainWindow: BrowserWindow, control: AuthRenewalControl, reminder?: RenewalReminderWebControl): void {
  let service: RenewalWebService | null = null
  let owner: Owner | null = null
  let cleanup: Promise<void> = Promise.resolve()

  const assertMainFrame = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Yêu cầu gia hạn không hợp lệ.')
    }
  }

  const dispose = (): Promise<void> => {
    const previous = service
    service = null
    owner = null
    if (previous) {
      cleanup = cleanup.then(() => previous.dispose()).catch(() => {
        console.warn('[Renewal] Không thể đóng hoàn toàn trang gia hạn.')
      })
    }
    return cleanup
  }

  const ownedBy = (mode: Owner['mode'], id: number | null): boolean => !!service && !!owner && id !== null && owner.mode === mode && owner.id === id

  control.onRenewalChanged(() => {
    if (service && owner?.mode === 'pending' && control.currentRenewalId() !== owner.id) void dispose()
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RENEWAL_WEB_PREPARE, async (event): Promise<RenewalWebDescriptor> => {
    assertMainFrame(event)
    const renewalId = control.currentRenewalId()
    if (renewalId === null) throw new Error(RENEWAL_ENDED_MESSAGE)
    if (service && !ownedBy('pending', renewalId)) void dispose()
    // Chờ lượt cũ xoá xong phân vùng trước khi mở lượt mới trên cùng phân vùng.
    await cleanup
    if (control.currentRenewalId() !== renewalId) throw new Error(RENEWAL_ENDED_MESSAGE)
    if (!service) {
      service = new RenewalWebService(mainWindow, {
        createLink: () => control.createRenewalLink(),
        isAllowed: () => control.currentRenewalId() === renewalId
      })
      owner = { mode: 'pending', id: renewalId }
    }
    return service.descriptor
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RENEWAL_WEB_RELOAD, (event): RenewalWebState => {
    assertMainFrame(event)
    if (!service || !ownedBy('pending', control.currentRenewalId())) throw new Error(RENEWAL_ENDED_MESSAGE)
    service.reload()
    return service.snapshot()
  })

  if (reminder) {
    reminder.onSessionChanged(() => {
      if (service && owner?.mode === 'reminder' && reminder.currentSessionId() !== owner.id) void dispose()
    })

    ipcMain.handle(RENEWAL_REMINDER_IPC.open, async (event, request: unknown): Promise<RenewalReminderOpenResult> => {
      assertMainFrame(event)
      const reminderKey = request && typeof request === 'object' ? (request as { reminderKey?: unknown }).reminderKey : null
      const sessionId = reminder.currentSessionId()
      if (sessionId === null) return { ok: false, code: 'not_logged_in', message: RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE }
      if (!reminder.hasReminder()) return { ok: false, code: 'no_reminder', message: RENEWAL_REMINDER_NO_REMINDER_MESSAGE }
      if (service && !ownedBy('reminder', sessionId)) void dispose()
      await cleanup
      if (reminder.currentSessionId() !== sessionId) return { ok: false, code: 'not_logged_in', message: RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE }
      if (!service) {
        let completed = false
        service = new RenewalWebService(mainWindow, {
          createLink: () => reminder.createLink(reminderKey),
          isAllowed: () => reminder.currentSessionId() === sessionId,
          stateChannel: RENEWAL_REMINDER_IPC.webState,
          onOrderCompleted: () => {
            if (completed) return
            completed = true
            reminder.orderCompleted()
          }
        })
        owner = { mode: 'reminder', id: sessionId }
      }
      return { ok: true, partition: service.descriptor.partition, url: service.descriptor.url }
    })

    ipcMain.handle(RENEWAL_REMINDER_IPC.webReload, (event): RenewalWebState => {
      assertMainFrame(event)
      if (!service || !ownedBy('reminder', reminder.currentSessionId())) throw new Error(RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE)
      service.reload()
      return service.snapshot()
    })

    ipcMain.handle(RENEWAL_REMINDER_IPC.close, async (event): Promise<void> => {
      assertMainFrame(event)
      if (service && owner?.mode === 'reminder') await dispose()
      reminder.windowClosed()
    })

    ipcMain.handle(RENEWAL_REMINDER_IPC.openExternal, async (event, request: unknown): Promise<RenewalReminderExternalResult> => {
      assertMainFrame(event)
      const reminderKey = request && typeof request === 'object' ? (request as { reminderKey?: unknown }).reminderKey : null
      try {
        const link = await reminder.createLink(reminderKey)
        await shell.openExternal(link.url)
        return { ok: true, signed: link.signed }
      } catch (error) {
        const code = errorCode(error)
        if (code === 'no_reminder') return { ok: false, code, message: RENEWAL_REMINDER_NO_REMINDER_MESSAGE }
        if (code === 'not_logged_in') return { ok: false, code, message: RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE }
        return { ok: false, code: 'unavailable', message: 'Không mở được trình duyệt. Vui lòng thử lại.' }
      }
    })
  }

  mainWindow.once('closed', () => { void dispose() })
}
