import { ipcMain, type BrowserWindow } from 'electron'
import { STAFF_MANAGEMENT_IPC, type StaffManagementAction } from '../../../shared/staffManagement'
import { IPC_EVENTS } from '../../../shared/types'
import { getCurrentUser, setCurrentUser } from '../../data/currentUser'
import { callStaffManagement, StaffManagementAccessError } from '../../data/repositories/staffManagementRepository'

const actions = new Set<StaffManagementAction>(['list', 'saveGroup', 'saveStaff', 'setStatus', 'revealPassword', 'prepareDevices', 'resetDevices'])

export function registerStaffManagementHandlers(window: BrowserWindow): void {
  ipcMain.handle(STAFF_MANAGEMENT_IPC, async (event, action: StaffManagementAction, input: Record<string, unknown>) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu quản lý nhân viên không hợp lệ.')
    if (!actions.has(action) || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Thông tin nhập không hợp lệ.')
    const actor = getCurrentUser()
    try { return await callStaffManagement(action, input) } catch (error) {
      const current = getCurrentUser()
      if (error instanceof StaffManagementAccessError && current && current.staffId === actor?.staffId && current.organizationId === actor.organizationId) {
        setCurrentUser({ ...current, isAdmin: false })
        if (!window.isDestroyed()) window.webContents.send(IPC_EVENTS.AUTH_USER_UPDATED, getCurrentUser())
      }
      throw error
    }
  })
}
