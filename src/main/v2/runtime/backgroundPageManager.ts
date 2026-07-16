import { BrowserWindow } from 'electron'
import { PageController, isNavigationAbortError } from './pageController'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com'
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface BackgroundPageEntry {
  win: BrowserWindow
  page: PageController
}

interface TemporaryPageEntry {
  page: PageController
  destroy: () => void
}

/**
 * Hidden offscreen pages for scheduler runs.
 * They share the same persistent partition as the visible webview tabs, so login/session state stays intact
 * while the main app window can remain minimized.
 */
export class BackgroundPageManager {
  private pages = new Map<number, BackgroundPageEntry>()
  private temporaryPages = new Set<BrowserWindow>()

  getOrCreate(accountId: number, platformType: string): PageController {
    if (String(platformType || '').toLowerCase() === 'zalo') {
      throw new Error('Zalo chỉ chạy qua API của phiên tài khoản; không được mở trang nền thứ hai')
    }
    const existing = this.pages.get(accountId)
    if (existing && !existing.win.isDestroyed() && existing.page.isConnected()) {
      return existing.page
    }

    const win = new BrowserWindow({
      width: 1920,
      height: 1080,
      show: false,
      skipTaskbar: true,
      frame: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        partition: `persist:account_${accountId}`,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: true
      }
    })

    win.setMenuBarVisibility(false)
    win.webContents.setUserAgent(DEFAULT_USER_AGENT)
    win.webContents.setBackgroundThrottling(false)
    win.webContents.on('render-process-gone', () => this.destroy(accountId))
    win.on('closed', () => this.pages.delete(accountId))

    const page = new PageController(win.webContents)
    this.pages.set(accountId, { win, page })

    const initialUrl = PLATFORM_URLS[platformType] || 'about:blank'
    page.navigate(initialUrl).catch((err) => {
      if (isNavigationAbortError(err)) return
      console.warn(`[BackgroundPageManager] Failed to load ${initialUrl}:`, err)
    })

    return page
  }

  createTemporary(accountId: number, platformType: string): TemporaryPageEntry {
    if (String(platformType || '').toLowerCase() === 'zalo') {
      throw new Error('Zalo chỉ chạy qua API của phiên tài khoản; không được mở trang tạm thứ hai')
    }
    const win = new BrowserWindow({
      width: 1920,
      height: 1080,
      show: false,
      skipTaskbar: true,
      frame: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        partition: `persist:account_${accountId}`,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: true
      }
    })

    win.setMenuBarVisibility(false)
    win.webContents.setUserAgent(DEFAULT_USER_AGENT)
    win.webContents.setBackgroundThrottling(false)
    win.on('closed', () => this.temporaryPages.delete(win))
    this.temporaryPages.add(win)

    const page = new PageController(win.webContents)
    const destroy = () => {
      this.temporaryPages.delete(win)
      if (win.isDestroyed()) return
      try {
        win.destroy()
      } catch {}
    }

    return { page, destroy }
  }

  destroy(accountId: number): void {
    const entry = this.pages.get(accountId)
    this.pages.delete(accountId)
    if (!entry || entry.win.isDestroyed()) return
    try {
      entry.win.destroy()
    } catch {}
  }

  destroyAll(): void {
    for (const accountId of Array.from(this.pages.keys())) {
      this.destroy(accountId)
    }
    for (const win of Array.from(this.temporaryPages)) {
      this.temporaryPages.delete(win)
      if (win.isDestroyed()) continue
      try {
        win.destroy()
      } catch {}
    }
  }
}
