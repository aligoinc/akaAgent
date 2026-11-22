import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getCurrentUser } from '../../data/currentUser'
import { JourneyWebService } from '../../services/journeyWebService'
import { JOURNEY_WEB_IPC, type JourneyWebTheme } from '../../../shared/journeyWebDesktop'

/**
 * Thẻ Tự động hóa › Quy trình (trang Web nhúng). Dịch vụ tạo khi khách mở thẻ lần đầu, gắn với nhân viên đang đăng nhập;
 * đăng xuất / đổi tài khoản thì `reset()` xoá phiên và cookie của phân vùng.
 */
export function registerJourneyWebHandlers(mainWindow: BrowserWindow): {
  reset: () => Promise<void>
  credentialsChanged: () => void
} {
  let service: JourneyWebService | null = null
  let serviceKey: string | null = null
  let cleanup: Promise<void> = Promise.resolve()

  const reset = (): Promise<void> => {
    const previous = service
    service = null
    serviceKey = null
    if (previous) cleanup = previous.dispose().catch(() => {
      console.warn('[JourneyWeb] Không thể dọn hoàn toàn phiên Tự động hóa; lần mở sau sẽ đăng nhập lại.')
    })
    return cleanup
  }

  const resolve = async (event: IpcMainInvokeEvent): Promise<JourneyWebService> => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Yêu cầu Tự động hóa không hợp lệ.')
    }
    const user = getCurrentUser()
    if (!user) throw new Error('Phiên akaAgent đã kết thúc.')
    const key = `${user.organizationId}:${user.staffId}`
    if (service && serviceKey !== key) await reset()
    await cleanup
    const current = getCurrentUser()
    if (!current || `${current.organizationId}:${current.staffId}` !== key) throw new Error('Phiên akaAgent đã thay đổi.')
    if (!service) {
      service = new JourneyWebService(mainWindow, current.staffId, current.organizationId)
      serviceKey = key
    }
    return service
  }

  const theme = (value: unknown): JourneyWebTheme => value === 'dark' ? 'dark' : 'light'
  ipcMain.handle(JOURNEY_WEB_IPC.prepare, async (event, themeValue: unknown, path: unknown) =>
    (await resolve(event)).prepare(theme(themeValue), typeof path === 'string' ? path : null))
  ipcMain.handle(JOURNEY_WEB_IPC.reload, async event => (await resolve(event)).reload())
  return { reset, credentialsChanged: () => service?.credentialsChanged() }
}
