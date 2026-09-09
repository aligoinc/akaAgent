import { ipcMain, type BrowserWindow } from 'electron'
import { getCurrentUser } from '../../data/currentUser'
import { CrmWebService } from '../../services/crmWebService'
import { IPC_EVENTS } from '../../../shared/types'

export function registerCrmWebHandlers(mainWindow: BrowserWindow): {
  startSession: () => void
  reset: () => Promise<void>
} {
  let service: CrmWebService | null = null
  let staffId: number | null = null
  let generation = 0
  let cleanup: Promise<void> = Promise.resolve()

  const isAllowed = (): boolean => {
    const user = getCurrentUser()
    return staffId !== null && user?.organizationId === 1 && user.staffId === staffId
  }

  ipcMain.handle(IPC_EVENTS.CRM_WEB_PREPARE, async event => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Yêu cầu CRM không hợp lệ.')
    }
    if (!isAllowed()) throw new Error('Tài khoản không có quyền mở CRM.')
    const requestedGeneration = generation
    await cleanup
    if (!isAllowed() || generation !== requestedGeneration) throw new Error('Phiên akaAgent đã thay đổi.')
    if (!service) service = new CrmWebService(mainWindow, staffId!, () => isAllowed() && generation === requestedGeneration)
    return service.descriptor
  })

  return {
    // Called only after akaAgent login/bootstrap and runtime recovery succeed.
    startSession: () => {
      const user = getCurrentUser()
      staffId = user?.organizationId === 1 ? user.staffId : null
    },
    reset: () => {
      staffId = null
      generation++
      const previous = service
      service = null
      if (previous) cleanup = previous.dispose().catch(() => {
        console.warn('[CRM] Không thể đóng hoàn toàn trình duyệt CRM.')
      })
      return cleanup
    }
  }
}
