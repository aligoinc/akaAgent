import { ipcMain } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { WebviewRegistry } from '../../playwright/webviewController'

export function registerAccountHandlers(supabase: SupabaseService, webviewRegistry: WebviewRegistry): void {
  ipcMain.handle(IPC_EVENTS.DB_LIST_ACCOUNTS, async () => {
    return supabase.listAccounts()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_ACCOUNT, async (_, accountData) => {
    return supabase.createAccount(accountData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_ACCOUNT, async (_, id: number, updates) => {
    return supabase.updateAccount(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_ACCOUNT, async (_, id: number) => {
    if (webviewRegistry.isRegistered(id)) {
      webviewRegistry.unregister(id)
    }
    return supabase.deleteAccount(id)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_ACCOUNT_ACTIONS, async (_, flatformType?: string) => {
    return supabase.listAccountActions(flatformType)
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_ACTION_OVERVIEW, async (_, accountId: number) => {
    return supabase.listAccountActionOverview(accountId)
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_RELOAD_PAGE, async (_, accountId: number, flatformType: string) => {
    const wcId = webviewRegistry.getWebContentsId(accountId)
    if (!wcId) {
      return { success: false, reason: 'Tab trình duyệt chưa được mở' }
    }
    try {
      const { webContents } = require('electron')
      const wc = webContents.fromId(wcId)
      if (!wc || wc.isDestroyed()) {
        return { success: false, reason: 'Tab trình duyệt không khả dụng' }
      }
      const platformUrls: Record<string, string> = {
        facebook: 'https://www.facebook.com',
        zalo: 'https://chat.zalo.me',
        tiktok: 'https://www.tiktok.com',
        shopee: 'https://banhang.shopee.vn',
        instagram: 'https://www.instagram.com',
      }
      const url = platformUrls[flatformType] || 'about:blank'
      wc.loadURL(url)
      return { success: true }
    } catch (err: any) {
      return { success: false, reason: err.message }
    }
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_CHECK_FB_LOGIN, async (_, accountId: number) => {
    const webContentsId = webviewRegistry.getWebContentsId(accountId)
    if (!webContentsId) {
      return { loggedIn: false, status: 'chưa đăng nhập', reason: 'Tab trình duyệt chưa được mở' }
    }
    try {
      const { webContents } = require('electron')
      const wc = webContents.fromId(webContentsId)
      if (!wc) {
        return { loggedIn: false, status: 'chưa đăng nhập', reason: 'Tab trình duyệt không khả dụng' }
      }
      const result = await wc.executeJavaScript(`
        (function() {
          try {
            const cookies = document.cookie;
            if (cookies.includes('c_user=')) {
              return { loggedIn: true };
            }
            if (document.querySelector('#checkpoint_title') || window.location.href.includes('checkpoint')) {
              return { loggedIn: false, checkpoint: true };
            }
            return { loggedIn: false };
          } catch(e) {
            return { loggedIn: false, error: e.message };
          }
        })()
      `)
      if (result.loggedIn) {
        await supabase.updateAccount(accountId, { loginStatus: 'đã đăng nhập' })
        return { loggedIn: true, status: 'đã đăng nhập' }
      } else if (result.checkpoint) {
        await supabase.updateAccount(accountId, { loginStatus: 'checkpoint' })
        return { loggedIn: false, status: 'checkpoint', reason: 'Tài khoản bị checkpoint' }
      } else {
        await supabase.updateAccount(accountId, { loginStatus: 'chưa đăng nhập' })
        return { loggedIn: false, status: 'chưa đăng nhập', reason: 'Chưa đăng nhập Facebook' }
      }
    } catch (err: any) {
      return { loggedIn: false, status: 'chưa đăng nhập', reason: err.message }
    }
  })
}
