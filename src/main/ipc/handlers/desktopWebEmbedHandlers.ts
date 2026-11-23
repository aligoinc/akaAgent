import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getCurrentUser } from '../../data/currentUser'
import type { DesktopWebEmbedService, DesktopWebEmbedSurface } from '../../services/desktopWebEmbedService'
import type { JourneyWebTheme } from '../../../shared/journeyWebDesktop'

export interface DesktopWebEmbedHandles {
  reset: () => Promise<void>
  credentialsChanged: () => void
}

/**
 * Một trang Web nhúng (Tự động hóa › Quy trình, Báo cáo 2). Dịch vụ tạo khi khách mở trang lần đầu, gắn với nhân viên đang
 * đăng nhập; đăng xuất / đổi tài khoản thì `reset()` xoá phiên và cookie của phân vùng.
 */
export function registerDesktopWebEmbedHandlers(
  mainWindow: BrowserWindow,
  ipc: { prepare: string; reload: string },
  surface: Pick<DesktopWebEmbedSurface, 'label' | 'logTag'>,
  create: (mainWindow: BrowserWindow, staffId: number, organizationId: number) => DesktopWebEmbedService
): DesktopWebEmbedHandles {
  let service: DesktopWebEmbedService | null = null
  let serviceKey: string | null = null
  let cleanup: Promise<void> = Promise.resolve()

  const reset = (): Promise<void> => {
    const previous = service
    service = null
    serviceKey = null
    if (previous) cleanup = previous.dispose().catch(() => {
      console.warn(`[${surface.logTag}] Không thể dọn hoàn toàn phiên ${surface.label}; lần mở sau sẽ đăng nhập lại.`)
    })
    return cleanup
  }

  const resolve = async (event: IpcMainInvokeEvent): Promise<DesktopWebEmbedService> => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error(`Yêu cầu ${surface.label} không hợp lệ.`)
    }
    const user = getCurrentUser()
    if (!user) throw new Error('Phiên akaAgent đã kết thúc.')
    const key = `${user.organizationId}:${user.staffId}`
    if (service && serviceKey !== key) await reset()
    await cleanup
    const current = getCurrentUser()
    if (!current || `${current.organizationId}:${current.staffId}` !== key) throw new Error('Phiên akaAgent đã thay đổi.')
    if (!service) {
      service = create(mainWindow, current.staffId, current.organizationId)
      serviceKey = key
    }
    return service
  }

  const theme = (value: unknown): JourneyWebTheme => value === 'dark' ? 'dark' : 'light'
  ipcMain.handle(ipc.prepare, async (event, themeValue: unknown, path: unknown) =>
    (await resolve(event)).prepare(theme(themeValue), typeof path === 'string' ? path : null))
  ipcMain.handle(ipc.reload, async event => (await resolve(event)).reload())
  return { reset, credentialsChanged: () => service?.credentialsChanged() }
}
