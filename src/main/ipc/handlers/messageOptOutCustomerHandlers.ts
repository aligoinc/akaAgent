import { ipcMain, type BrowserWindow } from 'electron'
import { MESSAGE_OPT_OUT_CUSTOMERS_IPC, type MessageOptOutCustomerQuery } from '../../../shared/messageOptOutCustomers'
import { listMessageOptOutCustomers } from '../../data/repositories/messageOptOutCustomerRepository'

export function registerMessageOptOutCustomerHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(MESSAGE_OPT_OUT_CUSTOMERS_IPC, (event, query?: MessageOptOutCustomerQuery) => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Không có quyền truy cập danh sách.')
    }
    return listMessageOptOutCustomers(query && typeof query === 'object' ? query : {})
  })
}
