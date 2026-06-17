import { ipcMain, webContents, BrowserWindow } from 'electron'
import { AutoAccountContact, AutoProxy, IPC_EVENTS, ProxyTestRequest, ZaloLabelOption, EmailAccountConfig } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { WebviewRegistry } from '../../playwright/webviewController'
import { ProxyRuntimeService } from '../../services/proxyRuntimeService'
import { ZaloRuntimeService } from '../../services/zaloRuntimeService'
import { EmailRuntimeService } from '../../services/emailRuntimeService'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com'
}
const BROWSERLESS_PLATFORMS = new Set(['zalo', 'email'])
const BROWSERLESS_ACCOUNT_REASON = 'Tài khoản này không dùng trình duyệt trong phiên bản này'

function mapZaloLabelContact(contact: AutoAccountContact): ZaloLabelOption {
  const extra = contact.extraData || {}
  return {
    id: Number(contact.uid),
    text: contact.name,
    textKey: typeof extra.textKey === 'string' ? extra.textKey : undefined,
    color: typeof extra.color === 'string' ? extra.color : undefined,
    emoji: typeof extra.emoji === 'string' ? extra.emoji : undefined
  }
}

function mapZaloLabelToContact(accountId: number, label: ZaloLabelOption): Partial<AutoAccountContact> {
  return {
    accountId,
    contactType: 'zalo_tag',
    uid: String(label.id),
    name: label.text,
    extraData: {
      textKey: label.textKey || undefined,
      color: label.color || undefined,
      emoji: label.emoji || undefined
    }
  }
}

export function registerAccountHandlers(
  supabase: SupabaseService,
  webviewRegistry: WebviewRegistry,
  proxyRuntime: ProxyRuntimeService,
  zaloRuntime?: ZaloRuntimeService,
  emailRuntime?: EmailRuntimeService,
  mainWindow?: BrowserWindow
): void {
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
    const normalizedUpdates = updates || {}
    const currentAccount = normalizedUpdates.proxyId !== undefined
      ? await supabase.getAccount(id)
      : null
    const proxyChanged = Boolean(
      currentAccount &&
      normalizedUpdates.proxyId !== undefined &&
      (currentAccount.proxyId ?? null) !== (normalizedUpdates.proxyId ?? null)
    )
    const targetPlatform = normalizedUpdates.flatformType ?? currentAccount?.flatformType
    if (proxyChanged && targetPlatform === 'zalo' && currentAccount?.status === 'đang chạy') {
      throw new Error('Không thể đổi proxy khi tài khoản Zalo đang chạy')
    }

    const account = await supabase.updateAccount(id, normalizedUpdates)
    if (normalizedUpdates.proxyId !== undefined || normalizedUpdates.flatformType !== undefined) {
      zaloRuntime?.invalidateAccount(id)
    }
    if (proxyChanged && account.flatformType === 'zalo' && account.hasZaloSession && zaloRuntime) {
      void zaloRuntime.checkSession(id)
        .catch((err) => {
          console.warn('[ZaloRuntime] Failed to verify Zalo session after proxy change:', {
            accountId: id,
            err
          })
        })
        .finally(() => sendAccountStatusUpdated(mainWindow))
    }
    return account
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_ACCOUNT, async (_, id: number) => {
    if (webviewRegistry.isRegistered(id)) {
      webviewRegistry.unregister(id)
    }
    zaloRuntime?.invalidateAccount(id)
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
    const proxy = await supabase.updateProxy(id, updates)
    await invalidateZaloAccountsUsingProxy(supabase, zaloRuntime, id)
    return proxy
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
    if (BROWSERLESS_PLATFORMS.has(account.flatformType)) {
      return { success: false, reason: BROWSERLESS_ACCOUNT_REASON }
    }
    await proxyRuntime.prepareAccountSession(account)
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_ACCOUNT_ACTIONS, async (_, flatformType?: string, includeRestricted?: boolean) => {
    return supabase.listAccountActions(flatformType, includeRestricted)
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_ACTION_OVERVIEW, async (_, accountId: number) => {
    return supabase.listAccountActionOverview(accountId)
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_ACTION_ENABLE_NOW, async (_, accountId: number, actionCode: string) => {
    const status = await supabase.enableAccountActionNow(accountId, actionCode)
    sendAccountStatusUpdated(mainWindow)
    return status
  })

  ipcMain.handle(IPC_EVENTS.ZALO_LOGIN_QR_START, async (_, accountId: number) => {
    if (!zaloRuntime) return { success: false, accountId, reason: 'Zalo runtime chưa sẵn sàng' }
    return zaloRuntime.startLoginQr(accountId)
  })

  ipcMain.handle(IPC_EVENTS.ZALO_LOGIN_QR_CANCEL, async (_, accountId: number) => {
    if (!zaloRuntime) return { success: false, accountId, reason: 'Zalo runtime chưa sẵn sàng' }
    zaloRuntime.cancelLoginQr(accountId)
    return { success: true, accountId }
  })

  ipcMain.handle(IPC_EVENTS.ZALO_CHECK_SESSION, async (_, accountId: number) => {
    if (!zaloRuntime) return { success: false, loggedIn: false, status: 'chưa đăng nhập', reason: 'Zalo runtime chưa sẵn sàng' }
    const result = await zaloRuntime.checkSession(accountId)
    sendAccountStatusUpdated(mainWindow)
    return result
  })

  ipcMain.handle(IPC_EVENTS.ZALO_LOGOUT, async (_, accountId: number) => {
    if (!zaloRuntime) return { success: false, loggedIn: false, status: 'chưa đăng nhập', reason: 'Zalo runtime chưa sẵn sàng' }
    const result = await zaloRuntime.logout(accountId)
    sendAccountStatusUpdated(mainWindow)
    return result
  })

  ipcMain.handle(IPC_EVENTS.ZALO_LIST_LABELS, async (_, accountId: number) => {
    const contacts = await supabase.listContacts(accountId, 'zalo_tag')
    return contacts
      .map(mapZaloLabelContact)
      .filter(label => Number.isFinite(label.id) && label.id > 0 && label.text)
  })

  ipcMain.handle(IPC_EVENTS.ZALO_SYNC_LABELS, async (_, accountId: number) => {
    if (!zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const account = await supabase.getAccount(accountId)
    if (!account || account.flatformType !== 'zalo') {
      throw new Error('Tài khoản không phải Zalo')
    }
    const labels = await zaloRuntime.listLabels(accountId)
    if (labels.length === 0) {
      await supabase.deleteContacts(accountId, 'zalo_tag')
    } else {
      await supabase.upsertContacts(labels.map(label => mapZaloLabelToContact(accountId, label)), {
        markMissingDeleted: true
      })
    }
    return labels
  })

  ipcMain.handle(IPC_EVENTS.EMAIL_GET_CONFIG, async (_, accountId: number) => {
    const entry = await supabase.getAccountEmailSession(accountId)
    return entry?.session ?? null
  })

  ipcMain.handle(IPC_EVENTS.EMAIL_VERIFY, async (_, config: EmailAccountConfig) => {
    if (!emailRuntime) return { ok: false, error: 'Email runtime chưa sẵn sàng' }
    return emailRuntime.verifyConfig(config)
  })

  ipcMain.handle(IPC_EVENTS.EMAIL_SAVE_CONFIG, async (_, accountId: number, config: EmailAccountConfig) => {
    if (!emailRuntime) throw new Error('Email runtime chưa sẵn sàng')
    const verify = await emailRuntime.verifyConfig(config)
    const account = await supabase.updateAccountEmailSession(accountId, { session: config, verified: verify.ok })
    if (!verify.ok) {
      await supabase.markAccountEmailSessionCheck(accountId, { ok: false, error: verify.error })
    }
    emailRuntime.invalidateAccount(accountId)
    sendAccountStatusUpdated(mainWindow)
    return { success: true, verified: verify.ok, error: verify.ok ? undefined : verify.error, account }
  })

  ipcMain.handle(IPC_EVENTS.EMAIL_LOGOUT, async (_, accountId: number) => {
    const account = await supabase.clearAccountEmailSession(accountId)
    emailRuntime?.invalidateAccount(accountId)
    sendAccountStatusUpdated(mainWindow)
    return { success: true, account }
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_RELOAD_PAGE, async (_, accountId: number, flatformType: string) => {
    const account = await supabase.getAccount(accountId)
    if (BROWSERLESS_PLATFORMS.has(flatformType) || (account && BROWSERLESS_PLATFORMS.has(account.flatformType))) {
      return { success: false, reason: BROWSERLESS_ACCOUNT_REASON }
    }
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
      if (account) await proxyRuntime.prepareAccountSession(account)
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

function sendAccountStatusUpdated(mainWindow?: BrowserWindow): void {
  try {
    mainWindow?.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
  } catch {
    // Window may be closed
  }
}

async function invalidateZaloAccountsUsingProxy(
  supabase: SupabaseService,
  zaloRuntime: ZaloRuntimeService | undefined,
  proxyId: number
): Promise<void> {
  if (!zaloRuntime) return
  try {
    const accounts = await supabase.listAccounts()
    for (const account of accounts) {
      if (account.flatformType === 'zalo' && account.proxyId === proxyId) {
        zaloRuntime.invalidateAccount(account.id)
      }
    }
  } catch (err) {
    console.warn('[ZaloRuntime] Failed to invalidate Zalo accounts after proxy update:', err)
  }
}
