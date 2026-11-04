import { ipcMain, type BrowserWindow } from 'electron'
import { FACEBOOK_RANDOM_RUN_IPC } from '../../../shared/facebookRandomRun'
import * as random from '../../data/repositories/facebookRandomRunRepository'
import { cancelFacebookRandomAi } from '../../services/facebookRandomAiService'

export function registerFacebookRandomRunHandlers(window: BrowserWindow): void {
  ipcMain.handle(FACEBOOK_RANDOM_RUN_IPC, async (event, operation: string, accountId: number, input: any) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu không hợp lệ.')
    switch (operation) {
      case 'get': return random.getRandomSettings(accountId)
      case 'save': {
        const saved = await random.saveRandomSettings(accountId, input)
        cancelFacebookRandomAi(accountId)
        return saved
      }
      case 'toggle': {
        const saved = await random.setRandomEnabled(accountId, input?.enabled, input?.revision)
        if (!saved.enabled) cancelFacebookRandomAi(accountId)
        return saved
      }
      case 'retryAi': return random.retryRandomAi(accountId)
      case 'dates': return random.listRandomDates(accountId, input)
      case 'day': return random.readRandomDay(accountId, input)
      default: throw new Error('Thao tác không hợp lệ.')
    }
  })
}
