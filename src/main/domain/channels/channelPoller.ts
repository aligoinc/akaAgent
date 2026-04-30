import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { WebviewRegistry } from '../../playwright/webviewController'
import * as channelRepo from '../../data/repositories/channelRepository'

const AUTO_CHECK_INTERVAL = 30_000

async function checkChannelLogin(channelId: number, wcId: number): Promise<string | null> {
  try {
    const { webContents } = require('electron')
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) return null

    const url = wc.getURL()

    if (url.includes('facebook.com')) {
      const result = await wc.executeJavaScript(`
        (function() {
          try {
            const cookies = document.cookie;
            if (cookies.includes('c_user=')) return { loggedIn: true };
            if (document.querySelector('#checkpoint_title') || window.location.href.includes('checkpoint'))
              return { loggedIn: false, checkpoint: true };
            return { loggedIn: false };
          } catch(e) { return { loggedIn: false }; }
        })()
      `)
      if (result.loggedIn) return 'đã đăng nhập'
      if (result.checkpoint) return 'checkpoint'
      return 'chưa đăng nhập'
    }

    if (url.includes('zalo')) {
      const result = await wc.executeJavaScript(`
        (function() {
          try {
            return !!document.querySelector('[data-id="conversations"]') || !!document.querySelector('.chat-list');
          } catch(e) { return false; }
        })()
      `)
      return result ? 'đã đăng nhập' : 'chưa đăng nhập'
    }

    return null
  } catch {
    return null
  }
}

export function startChannelPoller(webviewRegistry: WebviewRegistry, mainWindow: BrowserWindow): void {
  setInterval(async () => {
    if (!webviewRegistry) return
    const registered = webviewRegistry.listRegistered()
    if (registered.length === 0) return

    let hasChanges = false

    for (const { channelId, connected } of registered) {
      if (!connected) continue
      const wcId = webviewRegistry.getWebContentsId(channelId)
      if (!wcId) continue

      try {
        const newStatus = await checkChannelLogin(channelId, wcId)
        if (newStatus) {
          const channels = await channelRepo.listChannels()
          const channel = channels.find(a => a.id === channelId)
          if (channel && channel.loginStatus !== newStatus) {
            await channelRepo.updateChannel(channelId, { loginStatus: newStatus })
            hasChanges = true
            console.log(`[AutoCheck] Channel ${channelId}: ${channel.loginStatus} → ${newStatus}`)
          }
        }
      } catch {
        // Silently ignore per-channel errors
      }
    }

    if (hasChanges) {
      mainWindow.webContents.send(IPC_CHANNELS.CHANNEL_STATUS_UPDATED)
    }
  }, AUTO_CHECK_INTERVAL)
}
