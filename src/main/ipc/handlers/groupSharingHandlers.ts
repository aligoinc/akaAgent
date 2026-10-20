import { ipcMain, type BrowserWindow } from 'electron'
import { GROUP_SHARING_IPC } from '../../../shared/groupSharing'
import { invokeGroupSharing } from '../../data/repositories/groupSharingRepository'

export function registerGroupSharingHandlers(window: BrowserWindow): void {
  ipcMain.handle(GROUP_SHARING_IPC, async (event, action: unknown, input: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu không hợp lệ.')
    if (typeof action !== 'string' || !['staff', 'get', 'save', 'copy'].includes(action)) throw new Error('Thao tác không hợp lệ.')
    if (action === 'staff') return invokeGroupSharing(action)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Nhóm không hợp lệ.')
    const value = input as Record<string, unknown>
    if (!['data', 'content'].includes(String(value.kind)) || !Number.isSafeInteger(value.groupId) || Number(value.groupId) <= 0) throw new Error('Nhóm không hợp lệ.')
    return invokeGroupSharing(action, value)
  })
}
