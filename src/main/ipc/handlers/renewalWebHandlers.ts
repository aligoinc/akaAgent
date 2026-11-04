import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC_EVENTS, type RenewalWebDescriptor, type RenewalWebState } from '../../../shared/types'
import { RenewalWebService } from '../../services/renewalWebService'
import { RENEWAL_ENDED_MESSAGE, type AuthRenewalControl } from './authHandlers'

/**
 * Webview màn Gia hạn gắn với đúng một lượt gia hạn của main. Lượt gia hạn đổi
 * (đăng nhập thành công, huỷ, tài khoản khác, quá hạn chờ) thì đóng và xoá phân vùng.
 */
export function registerRenewalWebHandlers(mainWindow: BrowserWindow, control: AuthRenewalControl): void {
  let service: RenewalWebService | null = null
  let serviceRenewalId: number | null = null
  let cleanup: Promise<void> = Promise.resolve()

  const assertMainFrame = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Yêu cầu gia hạn không hợp lệ.')
    }
  }

  const dispose = (): Promise<void> => {
    const previous = service
    service = null
    serviceRenewalId = null
    if (previous) {
      cleanup = cleanup.then(() => previous.dispose()).catch(() => {
        console.warn('[Renewal] Không thể đóng hoàn toàn trang gia hạn.')
      })
    }
    return cleanup
  }

  control.onRenewalChanged(() => {
    if (service && control.currentRenewalId() !== serviceRenewalId) void dispose()
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RENEWAL_WEB_PREPARE, async (event): Promise<RenewalWebDescriptor> => {
    assertMainFrame(event)
    const renewalId = control.currentRenewalId()
    if (renewalId === null) throw new Error(RENEWAL_ENDED_MESSAGE)
    if (service && serviceRenewalId !== renewalId) void dispose()
    // Chờ lượt cũ xoá xong phân vùng trước khi mở lượt mới trên cùng phân vùng.
    await cleanup
    if (control.currentRenewalId() !== renewalId) throw new Error(RENEWAL_ENDED_MESSAGE)
    if (!service) {
      service = new RenewalWebService(mainWindow, {
        createLink: () => control.createRenewalLink(),
        isAllowed: () => control.currentRenewalId() === renewalId
      })
      serviceRenewalId = renewalId
    }
    return service.descriptor
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RENEWAL_WEB_RELOAD, (event): RenewalWebState => {
    assertMainFrame(event)
    if (!service || control.currentRenewalId() !== serviceRenewalId) throw new Error(RENEWAL_ENDED_MESSAGE)
    service.reload()
    return service.snapshot()
  })

  mainWindow.once('closed', () => { void dispose() })
}
