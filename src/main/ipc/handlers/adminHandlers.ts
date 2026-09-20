import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ADMIN_IPC, canAccessAdmin } from '../../../shared/admin'
import { IPC_EVENTS } from '../../../shared/types'
import { getCurrentUser, setCurrentUser } from '../../data/currentUser'
import { AdminAccessError, callAdmin, getAdminDoc, requireAdmin, type AdminResource } from '../../data/repositories/adminRepository'
import { AdminDocsWebService } from '../../services/adminDocsWebService'

export function registerAdminHandlers(window: BrowserWindow): { startSession: () => void; reset: () => Promise<void>; revokeIfNeeded: () => Promise<void> } {
  let sessionStaffId: number | null = null
  let sessionGeneration = 0
  let service: AdminDocsWebService | null = null
  let requestId: string | null = null
  let generation = 0
  let cleanup: Promise<void> = Promise.resolve()

  const sessionAllowed = (): boolean => sessionStaffId !== null && getCurrentUser()?.staffId === sessionStaffId && canAccessAdmin(getCurrentUser())
  const checkSession = (): void => { if (!sessionAllowed()) throw new Error('Phiên Admin akaBiz chưa sẵn sàng hoặc đã kết thúc.') }

  const close = (): Promise<void> => {
    generation++
    requestId = null
    const previous = service
    service = null
    cleanup = cleanup.catch(() => {}).then(() => previous?.dispose()).then(() => {})
    return cleanup
  }
  const checkSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu Admin không hợp lệ.')
  }
  const invoke = (operation: (args: unknown[]) => Promise<unknown>) => async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    checkSender(event)
    checkSession()
    const checkedUser = requireAdmin()
    const epoch = sessionGeneration
    try {
      const result = await operation(args)
      checkSession()
      if (sessionGeneration !== epoch) throw new Error('Phiên Admin akaBiz đã thay đổi.')
      return result
    } catch (error) {
      if (error instanceof AdminAccessError && getCurrentUser()?.staffId === checkedUser.staffId && getCurrentUser()?.organizationId === checkedUser.organizationId) {
        setCurrentUser({ ...getCurrentUser()!, isAdmin: false })
        await close()
        if (!window.isDestroyed()) window.webContents.send(IPC_EVENTS.AUTH_USER_UPDATED, getCurrentUser())
      }
      throw error
    }
  }
  for (const resource of ['docs', 'notifications', 'settings', 'cron', 'triggers'] as AdminResource[]) {
    ipcMain.handle(ADMIN_IPC[resource], invoke(async ([action, input]) => {
      if (typeof action !== 'string' || (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)))) throw new Error('Dữ liệu Admin không hợp lệ.')
      const result = await callAdmin(resource, action, (input || {}) as Record<string, unknown>)
      if (resource === 'docs' && ['save', 'delete'].includes(action)) await close()
      return result
    }))
  }
  ipcMain.handle(ADMIN_IPC.prepareDoc, invoke(async ([id, token]) => {
    if (!Number.isSafeInteger(id) || typeof token !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(token)) throw new Error('Tài liệu không hợp lệ.')
    const user = requireAdmin()
    const closing = close()
    requestId = token
    const epoch = generation
    await closing
    const doc = await getAdminDoc(id as number)
    checkSession()
    if (epoch !== generation || requestId !== token || getCurrentUser()?.staffId !== user.staffId) throw new Error('Tài liệu đã được đóng.')
    const descriptor = { id: doc.id, url: doc.url, partition: `persist:akaagent_admin_docs_1_${user.staffId}_${doc.id}`, token }
    service = new AdminDocsWebService(window, descriptor, () => epoch === generation && sessionAllowed() && getCurrentUser()?.staffId === user.staffId)
    return descriptor
  }))
  // Cleanup remains callable after permission revocation, and a stale close cannot close a newer guest.
  ipcMain.handle(ADMIN_IPC.closeDoc, async (event, token: unknown) => {
    checkSender(event)
    if (token === requestId) await close()
  })
  ipcMain.handle(ADMIN_IPC.openDocExternal, invoke(async ([id]) => {
    const epoch = sessionGeneration
    const doc = await getAdminDoc(id as number)
    checkSession()
    if (epoch !== sessionGeneration) throw new Error('Phiên Admin akaBiz đã thay đổi.')
    await shell.openExternal(doc.url)
  }))
  return {
    startSession: () => { sessionGeneration++; const user = getCurrentUser(); sessionStaffId = user?.organizationId === 1 ? user.staffId : null },
    reset: () => { sessionStaffId = null; sessionGeneration++; return close() },
    revokeIfNeeded: async () => { if (!canAccessAdmin(getCurrentUser())) await close() }
  }
}
