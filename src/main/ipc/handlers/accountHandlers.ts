import { ipcMain, webContents } from 'electron'
import { AutoAccount, AutoProxy, IPC_EVENTS, ProxyTestRequest } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { WebviewRegistry } from '../../playwright/webviewController'
import { ProxyRuntimeService } from '../../services/proxyRuntimeService'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  zalo: 'https://chat.zalo.me',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com'
}

interface AccountProxyRuntimeHooks {
  destroyBackgroundPage(accountId: number): void
}

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

export function registerAccountHandlers(
  supabase: SupabaseService,
  webviewRegistry: WebviewRegistry,
  proxyRuntime: ProxyRuntimeService,
  proxyHooks?: AccountProxyRuntimeHooks
): void {
  const reloadAccountWebview = async (account: AutoAccount): Promise<void> => {
    const wcId = webviewRegistry.getWebContentsId(account.id)
    if (!wcId) return

    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) return

    const url = PLATFORM_URLS[account.flatformType] || 'about:blank'
    await wc.loadURL(url)
  }

  const refreshAccountProxyRuntime = async (account: AutoAccount): Promise<void> => {
    await proxyRuntime.prepareAccountSession(account)
    proxyHooks?.destroyBackgroundPage(account.id)
    await reloadAccountWebview(account).catch(err => {
      console.warn(`Failed to reload account webview after proxy update (${account.id}):`, err)
    })
  }

  const resolveProxyForTest = async (request: ProxyTestRequest): Promise<Partial<AutoProxy>> => {
    const existing = request.proxyId ? await supabase.getProxy(request.proxyId) : null
    const draft = request.proxy || {}
    const merged: Partial<AutoProxy> = {
      ...(existing || {}),
      ...draft
    }
    if (draft.password === undefined && existing) {
      merged.password = existing.password
    }
    return merged
  }

  ipcMain.handle(IPC_EVENTS.DB_LIST_ACCOUNTS, async () => {
    return supabase.listAccounts()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_ACCOUNT, async (_, accountData) => {
    return supabase.createAccount(accountData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_ACCOUNT, async (_, id: number, updates) => {
    const payload = updates || {}
    const shouldRefreshProxy = hasOwn(payload, 'proxyId')
    const updated = await supabase.updateAccount(id, payload)
    if (shouldRefreshProxy) {
      await refreshAccountProxyRuntime(updated)
    }
    return updated
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_ACCOUNT, async (_, id: number) => {
    if (webviewRegistry.isRegistered(id)) {
      webviewRegistry.unregister(id)
    }
    return supabase.deleteAccount(id)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_ACCOUNT_GROUPS, async (_, flatformType?: string) => {
    return supabase.listAccountGroups(flatformType)
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_ACCOUNT_GROUP, async (_, groupData) => {
    return supabase.createAccountGroup(groupData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_ACCOUNT_GROUP, async (_, id: number, updates) => {
    return supabase.updateAccountGroup(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_ACCOUNT_GROUP, async (_, id: number) => {
    return supabase.deleteAccountGroup(id)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_PROXIES, async () => {
    return supabase.listProxies()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_PROXY, async (_, proxyData) => {
    return supabase.createProxy(proxyData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_PROXY, async (_, id: number, updates) => {
    const updated = await supabase.updateProxy(id, updates)
    const accounts = await supabase.listAccounts()
    const affectedAccounts = accounts.filter(account => account.proxyId === id)
    for (const account of affectedAccounts) {
      await refreshAccountProxyRuntime(account)
    }
    return updated
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_PROXY, async (_, id: number) => {
    return supabase.deleteProxy(id)
  })

  ipcMain.handle(IPC_EVENTS.PROXY_TEST, async (_, request: ProxyTestRequest) => {
    const proxy = await resolveProxyForTest(request || {})
    return proxyRuntime.testProxy(proxy, request?.platform || 'other', request?.testUrl)
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_PREPARE_BROWSER_SESSION, async (_, accountId: number) => {
    const account = await supabase.getAccount(accountId)
    if (!account) return { success: false, reason: 'Không tìm thấy tài khoản' }
    await proxyRuntime.prepareAccountSession(account)
    return { success: true }
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
      const wc = webContents.fromId(wcId)
      if (!wc || wc.isDestroyed()) {
        return { success: false, reason: 'Tab trình duyệt không khả dụng' }
      }
      const url = PLATFORM_URLS[flatformType] || 'about:blank'
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
