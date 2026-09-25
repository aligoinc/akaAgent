import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { FACEBOOK_LOGIN_IPC, type FacebookImportInput, type FacebookCredentialUpdate } from '../../../shared/facebookLogin'
import { FacebookLoginService } from '../../services/facebookLoginService'

export function registerFacebookLoginHandlers(window: BrowserWindow, service: FacebookLoginService): void {
  const invoke = (handler: (...args: any[]) => unknown) => async (event: IpcMainInvokeEvent, ...args: any[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu Facebook không hợp lệ.')
    return handler(...args)
  }
  const id = (value: unknown): number => {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('ID tài khoản không hợp lệ.')
    return value as number
  }
  ipcMain.handle(FACEBOOK_LOGIN_IPC.preview, invoke((input: FacebookImportInput) => service.preview(input)))
  ipcMain.handle(FACEBOOK_LOGIN_IPC.start, invoke((batchId: string) => service.start(batchId)))
  ipcMain.handle(FACEBOOK_LOGIN_IPC.stop, invoke(() => service.stopBatch()))
  ipcMain.handle(FACEBOOK_LOGIN_IPC.state, invoke(() => service.state()))
  ipcMain.handle(FACEBOOK_LOGIN_IPC.restore, invoke((accountId: number) => service.restore(id(accountId))))
  ipcMain.handle(FACEBOOK_LOGIN_IPC.login, invoke((accountId: number, input: FacebookCredentialUpdate) => service.login(id(accountId), input)))
  ipcMain.handle(FACEBOOK_LOGIN_IPC.metadata, invoke((accountId: number) => service.metadata(id(accountId))))
  ipcMain.handle(FACEBOOK_LOGIN_IPC.save, invoke((accountId: number, input: FacebookCredentialUpdate) => service.save(id(accountId), input)))
}
