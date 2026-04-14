import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS, FlowData, ExecutionStep } from '../../shared/types'
import { builtinActions } from '../../shared/actions'
import { PlaywrightController } from '../playwright/controller'
import { WebviewRegistry } from '../playwright/webviewController'
import { FlowRunner } from '../playwright/flowRunner'
import { SupabaseService } from '../services/supabase'
import { CampaignScheduler } from '../services/campaignScheduler'
import { ContactLoader } from '../services/contactLoader'

let playwrightController: PlaywrightController | null = null
let flowRunner: FlowRunner | null = null
let webviewRegistry: WebviewRegistry | null = null
let campaignScheduler: CampaignScheduler | null = null
let contactLoader: ContactLoader | null = null

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const supabase = new SupabaseService()
  webviewRegistry = new WebviewRegistry()
  campaignScheduler = new CampaignScheduler(supabase, webviewRegistry, mainWindow)
  contactLoader = new ContactLoader(supabase, webviewRegistry, mainWindow)

  // =========== SEED BUILT-IN DATA ===========
  supabase.seedBuiltinCampaignActions().catch(err => {
    console.error('Failed to seed built-in campaign actions:', err)
  })

  // =========== THEME ===========
  ipcMain.handle(IPC_CHANNELS.THEME_CHANGE, (_, theme: 'light' | 'dark') => {
    if (theme === 'light') {
      mainWindow.setTitleBarOverlay({
        color: '#7c3aed',
        symbolColor: '#ffffff'
      })
    } else {
      mainWindow.setTitleBarOverlay({
        color: '#0a0a0f',
        symbolColor: '#a0a0b0'
      })
    }
  })

  // =========== ACTIONS ===========
  ipcMain.handle(IPC_CHANNELS.ACTIONS_LIST, () => {
    return builtinActions
  })

  // =========== BROWSER CONTROL (legacy single browser for workflow editor) ===========
  ipcMain.handle(IPC_CHANNELS.BROWSER_LAUNCH, async (_, options?: { headless?: boolean; profileName?: string }) => {
    if (!playwrightController) {
      playwrightController = new PlaywrightController()
    }
    await playwrightController.launch(options?.headless ?? false, options?.profileName ?? 'default')
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLOSE, async () => {
    if (playwrightController) {
      await playwrightController.close()
      playwrightController = null
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_STATUS, () => {
    return { connected: playwrightController?.isConnected() ?? false }
  })

  // =========== WEBVIEW REGISTRATION ===========
  ipcMain.handle(IPC_CHANNELS.WEBVIEW_REGISTER, (_, accountId: number, webContentsId: number) => {
    if (!webviewRegistry) throw new Error('Webview registry not initialized')
    webviewRegistry.register(accountId, webContentsId)
    
    // Prevent Chromium from throttling this webview when it's in the background.
    // This ensures DOM is always fully rendered and accessible for automation.
    try {
      const { webContents } = require('electron')
      const wc = webContents.fromId(webContentsId)
      if (wc && !wc.isDestroyed()) {
        wc.setBackgroundThrottling(false)
      }
    } catch {}
    
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.WEBVIEW_UNREGISTER, (_, accountId: number) => {
    if (!webviewRegistry) throw new Error('Webview registry not initialized')
    webviewRegistry.unregister(accountId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.WEBVIEW_STATUS, (_, accountId: number) => {
    return { connected: webviewRegistry?.isRegistered(accountId) ?? false }
  })

  // =========== FLOW EXECUTION ===========
  ipcMain.handle(IPC_CHANNELS.FLOW_RUN, async (_, flowData: FlowData) => {
    if (!playwrightController || !playwrightController.isConnected()) {
      throw new Error('Browser not launched. Please launch browser first.')
    }

    flowRunner = new FlowRunner(playwrightController, supabase, (step: ExecutionStep) => {
      mainWindow.webContents.send(IPC_CHANNELS.FLOW_PROGRESS, step)
    })

    try {
      const result = await flowRunner.run(flowData)
      return result
    } catch (error) {
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.FLOW_STOP, async () => {
    if (flowRunner) {
      flowRunner.stop()
      flowRunner = null
    }
    return { success: true }
  })

  // =========== DATABASE - FLOWS ===========
  ipcMain.handle(IPC_CHANNELS.DB_SAVE_FLOW, async (_, flowData: FlowData) => {
    return supabase.saveFlow(flowData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LOAD_FLOW, async (_, flowId: string) => {
    return supabase.loadFlow(flowId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_FLOWS, async () => {
    return supabase.listFlows()
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_FLOW, async (_, flowId: string) => {
    return supabase.deleteFlow(flowId)
  })

  // =========== DATABASE - RUNS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_RUNS, async (_, flowId?: string) => {
    return supabase.listRuns(flowId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_RUN_STEPS, async (_, runId: string) => {
    return supabase.listRunSteps(runId)
  })

  // =========== DATABASE - ELEMENTS ===========
  ipcMain.handle(IPC_CHANNELS.DB_SAVE_ELEMENT, async (_, element) => {
    return supabase.saveElement(element)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_ELEMENTS, async () => {
    return supabase.listElements()
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_ELEMENT, async (_, elementId: string) => {
    return supabase.deleteElement(elementId)
  })

  // =========== DATABASE - FLATFORM ACCOUNTS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_ACCOUNTS, async () => {
    return supabase.listAccounts()
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_ACCOUNT, async (_, accountData) => {
    return supabase.createAccount(accountData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_ACCOUNT, async (_, id: number, updates) => {
    return supabase.updateAccount(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_ACCOUNT, async (_, id: number) => {
    // Unregister webview if registered
    if (webviewRegistry?.isRegistered(id)) {
      webviewRegistry.unregister(id)
    }
    return supabase.deleteAccount(id)
  })

  // =========== DATABASE - CAMPAIGN ACTIONS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_CAMPAIGN_ACTIONS, async () => {
    return supabase.listCampaignActions()
  })

  ipcMain.handle(IPC_CHANNELS.DB_GET_ALL_CAMPAIGN_ACTIONS, async () => {
    return supabase.getAllCampaignActions()
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_CAMPAIGN_ACTION, async (_, actionData) => {
    return supabase.createCampaignAction(actionData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_CAMPAIGN_ACTION, async (_, id: string, updates) => {
    return supabase.updateCampaignAction(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_CAMPAIGN_ACTION, async (_, id: string) => {
    return supabase.deleteCampaignAction(id)
  })

  // =========== DATABASE - CAMPAIGNS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_CAMPAIGNS, async () => {
    return supabase.listCampaigns()
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_CAMPAIGN, async (_, campaignData) => {
    return supabase.createCampaign(campaignData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_CAMPAIGN, async (_, id: number, updates) => {
    return supabase.updateCampaign(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_CAMPAIGN, async (_, id: number) => {
    return supabase.deleteCampaign(id)
  })

  ipcMain.handle(IPC_CHANNELS.DB_CLONE_CAMPAIGN, async (_, id: number) => {
    return supabase.cloneCampaign(id)
  })

  // =========== DATABASE - CAMPAIGN DETAILS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_CAMPAIGN_DETAILS, async (_, campaignId: number) => {
    return supabase.listCampaignDetails(campaignId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_CAMPAIGN_DETAIL, async (_, detailData) => {
    return supabase.createCampaignDetail(detailData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_CAMPAIGN_DETAIL, async (_, id: number, updates) => {
    return supabase.updateCampaignDetail(id, updates)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_CAMPAIGN_DETAIL, async (_, id: number) => {
    return supabase.deleteCampaignDetail(id)
  })

  // =========== DATABASE - CAMPAIGN DETAIL ACTIONS ===========
  ipcMain.handle(IPC_CHANNELS.DB_LIST_DETAIL_ACTIONS, async (_, detailId: number) => {
    return supabase.listDetailActions(detailId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_DETAIL_ACTIONS_BY_CAMPAIGN, async (_, campaignId: number) => {
    return supabase.listDetailActionsByCampaign(campaignId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_DETAIL_ACTION, async (_, actionData) => {
    return supabase.createDetailAction(actionData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_DETAIL_ACTION, async (_, id: number) => {
    return supabase.deleteDetailAction(id)
  })

  // =========== CAMPAIGN SCHEDULER ===========
  ipcMain.handle(IPC_CHANNELS.SCHEDULER_START, () => {
    campaignScheduler?.start()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STOP, () => {
    campaignScheduler?.stop()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STATUS, () => {
    return { running: campaignScheduler?.isRunning() ?? false }
  })

  // =========== ACCOUNT ACTIONS ===========
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_RELOAD_PAGE, async (_, accountId: number, flatformType: string) => {
    if (!webviewRegistry) throw new Error('Webview registry not initialized')
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

  ipcMain.handle(IPC_CHANNELS.ACCOUNT_CHECK_FB_LOGIN, async (_, accountId: number) => {
    if (!webviewRegistry) throw new Error('Webview registry not initialized')
    const webContentsId = webviewRegistry.getWebContentsId(accountId)
    if (!webContentsId) {
      // Try to update status directly - webview not available
      return { loggedIn: false, status: 'chưa đăng nhập', reason: 'Tab trình duyệt chưa được mở' }
    }
    try {
      const { webContents } = require('electron')
      const wc = webContents.fromId(webContentsId)
      if (!wc) {
        return { loggedIn: false, status: 'chưa đăng nhập', reason: 'Tab trình duyệt không khả dụng' }
      }
      // Execute JS in webview to check login: look for c_user cookie
      const result = await wc.executeJavaScript(`
        (function() {
          try {
            const cookies = document.cookie;
            if (cookies.includes('c_user=')) {
              return { loggedIn: true };
            }
            // Check for checkpoint
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

  // =========== CONTACTS (Load data) ===========
  ipcMain.handle(IPC_CHANNELS.CONTACTS_LOAD_FRIENDS, async (_, flatformAccountId: number) => {
    if (!contactLoader) throw new Error('ContactLoader not initialized')
    return contactLoader.loadFriends(flatformAccountId)
  })

  ipcMain.handle(IPC_CHANNELS.CONTACTS_LOAD_GROUPS, async (_, flatformAccountId: number) => {
    if (!contactLoader) throw new Error('ContactLoader not initialized')
    return contactLoader.loadGroups(flatformAccountId)
  })

  ipcMain.handle(IPC_CHANNELS.CONTACTS_LIST, async (_, flatformAccountId: number, contactType?: string) => {
    return supabase.listContacts(flatformAccountId, contactType as any)
  })

  ipcMain.handle(IPC_CHANNELS.CONTACTS_DELETE, async (_, flatformAccountId: number, contactType: string) => {
    return supabase.deleteContacts(flatformAccountId, contactType as any)
  })

  // =========== AUTO-CHECK LOGIN STATUS (every 30s) ===========
  const AUTO_CHECK_INTERVAL = 30_000

  async function checkAccountLogin(accountId: number, wcId: number): Promise<string | null> {
    try {
      const { webContents } = require('electron')
      const wc = webContents.fromId(wcId)
      if (!wc || wc.isDestroyed()) return null

      const url = wc.getURL()

      // Facebook check
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

      // Zalo check - logged in if there is chat content
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

      // Default: check if page has loaded content (basic check)
      return null // no change for unsupported platforms
    } catch {
      return null
    }
  }

  setInterval(async () => {
    if (!webviewRegistry) return
    const registered = webviewRegistry.listRegistered()
    if (registered.length === 0) return

    let hasChanges = false

    for (const { accountId, connected } of registered) {
      if (!connected) continue
      const wcId = webviewRegistry.getWebContentsId(accountId)
      if (!wcId) continue

      try {
        const newStatus = await checkAccountLogin(accountId, wcId)
        if (newStatus) {
          // Only update if status actually changed
          const accounts = await supabase.listAccounts()
          const account = accounts.find(a => a.id === accountId)
          if (account && account.loginStatus !== newStatus) {
            await supabase.updateAccount(accountId, { loginStatus: newStatus })
            hasChanges = true
            console.log(`[AutoCheck] Account ${accountId}: ${account.loginStatus} → ${newStatus}`)
          }
        }
      } catch (err) {
        // Silently ignore per-account errors
      }
    }

    // Notify renderer to refresh accounts if any status changed
    if (hasChanges) {
      mainWindow.webContents.send(IPC_CHANNELS.ACCOUNT_STATUS_UPDATED)
    }
  }, AUTO_CHECK_INTERVAL)
}
