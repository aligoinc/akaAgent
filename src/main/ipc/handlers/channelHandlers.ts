import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { WebviewRegistry } from '../../playwright/webviewController'

export function registerChannelHandlers(supabase: SupabaseService, webviewRegistry: WebviewRegistry): void {
  ipcMain.handle(IPC_CHANNELS.DB_LIST_CHANNELS, async () => {
    return supabase.listChannels()
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_CHANNEL, async (_, channelData) => {
    return supabase.createChannel(channelData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_CHANNEL, async (_, id: number, updates) => {
    return supabase.updateChannel(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_CHANNEL, async (_, id: number) => {
    if (webviewRegistry.isRegistered(id)) {
      webviewRegistry.unregister(id)
    }
    return supabase.deleteChannel(id)
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_RELOAD_PAGE, async (_, channelId: number, flatformType: string) => {
    const wcId = webviewRegistry.getWebContentsId(channelId)
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

  ipcMain.handle(IPC_CHANNELS.CHANNEL_CHECK_FB_LOGIN, async (_, channelId: number) => {
    const webContentsId = webviewRegistry.getWebContentsId(channelId)
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
        await supabase.updateChannel(channelId, { loginStatus: 'đã đăng nhập' })
        return { loggedIn: true, status: 'đã đăng nhập' }
      } else if (result.checkpoint) {
        await supabase.updateChannel(channelId, { loginStatus: 'checkpoint' })
        return { loggedIn: false, status: 'checkpoint', reason: 'Tài khoản bị checkpoint' }
      } else {
        await supabase.updateChannel(channelId, { loginStatus: 'chưa đăng nhập' })
        return { loggedIn: false, status: 'chưa đăng nhập', reason: 'Chưa đăng nhập Facebook' }
      }
    } catch (err: any) {
      return { loggedIn: false, status: 'chưa đăng nhập', reason: err.message }
    }
  })
}
