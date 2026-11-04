import { ipcMain, type BrowserWindow } from 'electron'
import type { AppAccessChange } from '../../../shared/appAccess'
import { readAppAccess, setAppAccess } from '../../data/repositories/appAccessRepository'

export function registerAppAccessHandlers(window: BrowserWindow): void {
  ipcMain.handle('app-access:invoke', async (event, action: string, input: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu không hợp lệ.')
    if (action === 'snapshot' && Array.isArray(input) && input.length <= 500 && input.every(id => Number.isSafeInteger(id) && id > 0)) return readAppAccess(input)
    if (action !== 'set' || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Yêu cầu không hợp lệ.')
    const value = input as AppAccessChange
    if (!['staff', 'account'].includes(value.targetType) || !['akaAgent', 'akaChat'].includes(value.app) || typeof value.enabled !== 'boolean'
      || !Number.isSafeInteger(value.targetId) || value.targetId <= 0 || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
      || Object.keys(value).some(key => !['targetType','targetId','app','enabled','requestId'].includes(key))) throw new Error('Yêu cầu không hợp lệ.')
    return setAppAccess(value)
  })
}
