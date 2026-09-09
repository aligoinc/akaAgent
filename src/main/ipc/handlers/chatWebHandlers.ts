import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getCurrentUser } from '../../data/currentUser'
import { ChatWebService } from '../../services/chatWebService'
import { IPC_EVENTS } from '../../../shared/types'

export function registerChatWebHandlers(mainWindow: BrowserWindow): {
  reset: () => Promise<void>
  credentialsChanged: () => void
} {
  let service: ChatWebService | null = null
  let serviceSessionId: string | undefined
  let blockedSessionId: string | undefined
  let cleanup: Promise<void> = Promise.resolve()

  const reset = (): Promise<void> => {
    const previous = service
    blockedSessionId = serviceSessionId ?? getCurrentUser()?.chatWebSessionId
    service = null
    serviceSessionId = undefined
    if (previous) cleanup = previous.dispose().catch(() => {
      console.warn('[ChatWeb] Không thể dọn hoàn toàn phiên Chat; phiên kế tiếp sẽ xác thực lại.')
    })
    return cleanup
  }

  const resolve = async (event: IpcMainInvokeEvent): Promise<ChatWebService> => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Yêu cầu Chat không hợp lệ.')
    }
    const user = getCurrentUser()
    if (!user?.chatWebEnabledAtLogin || !user.chatWebSessionId) throw new Error('Tài khoản chưa được bật Chat.')
    if (user.chatWebSessionId === blockedSessionId) throw new Error('Phiên akaAgent đang kết thúc.')
    if (service && serviceSessionId !== user.chatWebSessionId) await reset()
    await cleanup
    if (getCurrentUser()?.chatWebSessionId !== user.chatWebSessionId || user.chatWebSessionId === blockedSessionId) {
      throw new Error('Phiên akaAgent đã thay đổi.')
    }
    if (!service) {
      service = new ChatWebService(mainWindow, user)
      serviceSessionId = user.chatWebSessionId
    }
    return service
  }

  ipcMain.handle(IPC_EVENTS.CHAT_WEB_PREPARE, async event => (await resolve(event)).prepare())
  ipcMain.handle(IPC_EVENTS.CHAT_WEB_RELOAD, async event => (await resolve(event)).reload())
  return { reset, credentialsChanged: () => service?.credentialsChanged() }
}
