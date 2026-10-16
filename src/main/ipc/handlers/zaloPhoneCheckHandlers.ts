import { ipcMain, type BrowserWindow } from 'electron'
import { ZALO_PHONE_CHECK_IPC, validateZaloPhoneCheckRequest, type ZaloPhoneCheckResult } from '../../../shared/zaloPhoneCheck'
import { getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials, runWithCurrentUser } from '../../data/currentUser'
import { ensureCurrentUserFeatureActive } from '../../data/repositories/entitlementRepository'
import { getZaloPhoneCheckDailyLimit } from '../../data/repositories/zaloPhoneCheckRepository'
import type { SupabaseService } from '../../services/supabase'
import type { ContactLoader } from '../../services/contactLoader'
import type { ZaloServerClient } from '../../services/zaloServerClient'
import { withRequestDeadline } from '../../services/requestDeadline'

export function registerZaloPhoneCheckHandlers(window: BrowserWindow, supabase: SupabaseService,
  local: ContactLoader, chat: ContactLoader, server: ZaloServerClient, isChatSync: () => boolean): () => void {
  let flight: { runId: string; accountId: number; credentials: object; controller: AbortController; cancel?: () => Promise<unknown> | void } | undefined
  const stop = () => {
    const active = flight
    if (!active) return
    active.controller.abort()
    void Promise.resolve(active.cancel?.()).catch(() => undefined)
  }
  const assertFrame = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Không có quyền thực hiện thao tác này.')
  }
  window.webContents.once('destroyed', stop)
  ipcMain.handle(ZALO_PHONE_CHECK_IPC.limit, async event => {
    assertFrame(event)
    const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
    return runWithCurrentUser(user, async () => {
      await ensureCurrentUserFeatureActive('zalo')
      const limit = await withRequestDeadline(new AbortController().signal, getZaloPhoneCheckDailyLimit, 6_000)
      if (getCurrentUserCredentials() !== credentials || window.isDestroyed()) throw new Error('Phiên đăng nhập đã thay đổi.')
      return limit
    })
  })
  ipcMain.handle(ZALO_PHONE_CHECK_IPC.usage, async (event, accountId: unknown) => {
    assertFrame(event)
    if (typeof accountId !== 'number' || !Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Tài khoản không hợp lệ.')
    const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
    return runWithCurrentUser(user, async () => {
      await ensureCurrentUserFeatureActive('zalo')
      const account = await supabase.getAccount(accountId)
      if (!account || account.flatformType !== 'zalo' || getCurrentUserCredentials() !== credentials) throw new Error('Phiên hoặc tài khoản không hợp lệ.')
      const usage = await withRequestDeadline(new AbortController().signal, signal => supabase.getZaloPhoneCheckUsage(
        accountId, account.isZaloServer ? 'server' : 'desktop', null, false, false, signal
      ), 6_000)
      if (getCurrentUserCredentials() !== credentials || window.isDestroyed()) throw new Error('Phiên đăng nhập đã thay đổi.')
      return usage
    })
  })
  ipcMain.handle(ZALO_PHONE_CHECK_IPC.start, async (event, input: unknown): Promise<ZaloPhoneCheckResult> => {
    assertFrame(event)
    const request = validateZaloPhoneCheckRequest(input)
    const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
    if (flight) throw new Error('Một lượt kiểm tra SĐT đang chạy. Vui lòng đợi dừng hoàn tất.')
    const owned = { runId: request.runId, accountId: request.accountId, credentials, controller: new AbortController(), cancel: undefined as (() => Promise<unknown> | void) | undefined }
    flight = owned
    const assertCurrent = () => {
      owned.controller.signal.throwIfAborted()
      if (getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi.')
    }
    try {
      return await runWithCurrentUser(user, async () => {
        await ensureCurrentUserFeatureActive('zalo')
        const account = await supabase.getAccount(request.accountId)
        assertCurrent()
        if (!account || account.flatformType !== 'zalo') throw new Error('Không có quyền sử dụng tài khoản Zalo này.')
        let result: ZaloPhoneCheckResult
        if (account.isZaloServer && !isChatSync()) {
          owned.cancel = () => server.executeCommand('contacts.cancelPhoneCheck', request.accountId, request.runId)
          try {
            result = await server.executeCommand('contacts.checkZaloPhones', request.accountId, request) as ZaloPhoneCheckResult
          } catch (error) {
            if (/không được hỗ trợ|unsupported|unknown command/i.test(String(error))) throw new Error('Zalo Server chưa hỗ trợ kiểm tra SĐT. Vui lòng cập nhật akaAgent Zalo Server.')
            throw error
          }
        } else {
          const loader = account.isZaloServer ? chat : local
          owned.cancel = () => loader.cancelZaloPhoneCheck(request.accountId, request.runId)
          result = await loader.checkZaloPhones(request, owned.controller.signal)
        }
        if (getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi.')
        return result
      })
    } finally { if (flight === owned) flight = undefined }
  })
  ipcMain.handle(ZALO_PHONE_CHECK_IPC.cancel, async (event, runId: unknown) => {
    assertFrame(event)
    const owned = flight
    if (!owned || owned.runId !== runId || owned.credentials !== getCurrentUserCredentials()) return
    owned.controller.abort()
    await owned.cancel?.()
  })
  return stop
}
