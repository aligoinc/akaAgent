import { ipcMain, type BrowserWindow } from 'electron'
import { FACEBOOK_RANDOM_RUN_IPC } from '../../../shared/facebookRandomRun'
import * as random from '../../data/repositories/facebookRandomRunRepository'

export function registerFacebookRandomRunHandlers(window: BrowserWindow): void {
  ipcMain.handle(FACEBOOK_RANDOM_RUN_IPC, (event, operation: string, accountId: number, input: any) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu không hợp lệ.')
    switch (operation) {
      case 'get': return random.getRandomSettings(accountId)
      case 'save': return random.saveRandomSettings(accountId, input)
      case 'toggle': return random.setRandomEnabled(accountId, input?.enabled, input?.revision)
      case 'dates': return random.listRandomDates(accountId, input)
      case 'day': return random.readRandomDay(accountId, input)
      default: throw new Error('Thao tác không hợp lệ.')
    }
  })
}
