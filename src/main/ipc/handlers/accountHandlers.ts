import { ipcMain, webContents, BrowserWindow } from 'electron'
import { AutoAccount, AutoAccountContact, AutoProxy, IPC_EVENTS, ProxyTestRequest, ZaloLabelOption, EmailAccountConfig } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { WebviewRegistry } from '../../playwright/webviewController'
import { ProxyRuntimeService } from '../../services/proxyRuntimeService'
import { ZaloRuntimeService } from '../../services/zaloRuntimeService'
import { EmailRuntimeService } from '../../services/emailRuntimeService'
import { ZaloServerClient } from '../../services/zaloServerClient'
import { ZaloChatApiClient } from '../../services/zaloChatApiClient'
import {
  ensureCurrentUserCanUseAccountPlatform,
  ensureCurrentUserCanUseZaloAccountType,
  ensureCurrentUserFeatureActive
} from '../../data/repositories/entitlementRepository'
import type { ZaloAccountRuntimeTarget } from '../../data/repositories/accountRepository'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  zalo: 'https://chat.zalo.me',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com'
}
const ALWAYS_BROWSERLESS_PLATFORMS = new Set(['email', 'sms'])
const BROWSERLESS_ACCOUNT_REASON = 'Tài khoản này không dùng trình duyệt trong phiên bản này'

function isBrowserlessAccount(account: Pick<AutoAccount, 'flatformType' | 'isZaloShowWeb'>): boolean {
  const platform = String(account.flatformType || '').trim().toLowerCase()
  return ALWAYS_BROWSERLESS_PLATFORMS.has(platform)
    || (platform === 'zalo' && !account.isZaloShowWeb)
}

function mapZaloLabelContact(contact: AutoAccountContact): ZaloLabelOption {
  const extra = contact.extraData || {}
  return {
    id: Number(contact.uid),
    text: contact.name,
    textKey: typeof extra.textKey === 'string' ? extra.textKey : undefined,
    color: typeof extra.color === 'string' ? extra.color : undefined,
    emoji: typeof extra.emoji === 'string' ? extra.emoji : undefined,
    conversations: Array.isArray(extra.conversations)
      ? extra.conversations.map(item => String(item || '').trim()).filter(Boolean)
      : undefined
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
      emoji: label.emoji || undefined,
      conversations: Array.isArray(label.conversations)
        ? label.conversations.map(item => String(item || '').trim()).filter(Boolean)
        : []
    }
  }
}

interface ZaloRealtimeRefreshController {
  refreshSoon(reason?: string): void
}

export interface AccountZaloOperationController {
  stopAll(): Promise<boolean>
  waitForIdle(timeoutMs?: number): Promise<boolean>
  abandonClaims(): void
  resetClaims(): void
}

export function registerAccountHandlers(
  supabase: SupabaseService,
  webviewRegistry: WebviewRegistry,
  proxyRuntime: ProxyRuntimeService,
  zaloRuntime?: ZaloRuntimeService,
  emailRuntime?: EmailRuntimeService,
  mainWindow?: BrowserWindow,
  zaloRealtimeRefresh?: ZaloRealtimeRefreshController,
  zaloServerClient?: ZaloServerClient,
  zaloChatApiClient?: ZaloChatApiClient
): AccountZaloOperationController {
  type PreviousZaloAccountStatus = 'chờ xử lý' | 'tạm dừng'
  const localQrClaims = new Map<number, PreviousZaloAccountStatus>()
  const localQrReleasePromises = new Map<number, Promise<void>>()
  const activeLocalOperations = new Set<Promise<unknown>>()
  let runtimeClaimsAbandoned = false

  const requireZaloAccount = async (accountId: number): Promise<AutoAccount> => {
    const account = await supabase.getAccount(accountId)
    if (!account || account.flatformType !== 'zalo') {
      throw new Error('Không tìm thấy tài khoản Zalo phù hợp với gói hiện tại')
    }
    return account
  }

  const getZaloRuntimeTarget = (account: AutoAccount): ZaloAccountRuntimeTarget => (
    account.isZaloServer ? 'server' : 'desktop'
  )

  const shouldRouteZaloAccountToChatApi = (account: AutoAccount): boolean => (
    account.isZaloServer && zaloChatApiClient?.isEnabled() === true
  )
  const shouldRouteZaloAccountToServer = (account: AutoAccount): boolean => (
    account.isZaloServer && !shouldRouteZaloAccountToChatApi(account)
  )
  const shouldRouteZaloAccountCleanupToServer = shouldRouteZaloAccountToServer

  const trackLocalOperation = <T>(operation: Promise<T>): Promise<T> => {
    activeLocalOperations.add(operation)
    void operation.finally(() => activeLocalOperations.delete(operation)).catch(() => {})
    return operation
  }

  const claimLocalZaloOperation = async (
    accountId: number,
    requiresLogin: boolean
  ): Promise<PreviousZaloAccountStatus> => {
    if (runtimeClaimsAbandoned) {
      throw new Error('Runtime Zalo của phiên cũ đang đóng. Vui lòng mở lại ứng dụng.')
    }
    const claim = await supabase.claimZaloAccountRuntimeOperation(accountId, 'desktop', requiresLogin)
    if (!claim.claimed || !claim.previousStatus) {
      const message = claim.reason === 'runtime_not_owner'
        ? 'Chế độ chạy Zalo đã thay đổi. Vui lòng tắt và mở lại ứng dụng.'
        : 'Tài khoản Zalo đang thực hiện một tác vụ khác.'
      throw new Error(message)
    }
    try { mainWindow?.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch {}
    return claim.previousStatus
  }

  const releaseLocalZaloOperation = async (
    accountId: number,
    previousStatus: PreviousZaloAccountStatus
  ): Promise<boolean> => {
    if (runtimeClaimsAbandoned) return true
    try {
      await supabase.releaseZaloAccountRuntimeOperation(accountId, 'desktop', previousStatus)
      try { mainWindow?.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch {}
      return true
    } catch (error) {
      console.error('[ZaloRuntime] Failed to release local account operation:', { accountId, error })
      return false
    }
  }

  const runClaimedLocalZaloOperation = async <T>(
    accountId: number,
    requiresLogin: boolean,
    operation: () => Promise<T>
  ): Promise<T> => trackLocalOperation((async () => {
    const previousStatus = await claimLocalZaloOperation(accountId, requiresLogin)
    try {
      return await operation()
    } finally {
      await releaseLocalZaloOperation(accountId, previousStatus)
    }
  })())

  const releaseLocalQrClaim = (accountId: number): Promise<void> => {
    const existingRelease = localQrReleasePromises.get(accountId)
    if (existingRelease) return existingRelease
    const previousStatus = localQrClaims.get(accountId)
    if (!previousStatus) return Promise.resolve()

    const release = (async () => {
      const releaseCompleted = await releaseLocalZaloOperation(accountId, previousStatus)
      if (releaseCompleted && localQrClaims.get(accountId) === previousStatus) {
        localQrClaims.delete(accountId)
      }
    })()
    localQrReleasePromises.set(accountId, release)
    void release.finally(() => {
      if (localQrReleasePromises.get(accountId) === release) {
        localQrReleasePromises.delete(accountId)
      }
    }).catch(() => {})
    return release
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
    const normalizedUpdates = updates || {}
    const existing = await supabase.getAccount(id)
    const updateKeys = Object.keys(normalizedUpdates)
    const statusOnly = updateKeys.length === 1 && updateKeys[0] === 'status'
    const requestedStatus = normalizedUpdates.status
    if (
      statusOnly
      && (requestedStatus === 'chờ xử lý' || requestedStatus === 'tạm dừng')
      && existing?.flatformType === 'zalo'
      && shouldRouteZaloAccountCleanupToServer(existing)
    ) {
      const result = await supabase.setZaloServerAccountStatus(id, requestedStatus)
      if (!result.ok) {
        if (result.reason === 'runtime_not_owner') {
          throw new Error('Tài khoản này không còn được cấu hình chạy trên Zalo Server. Vui lòng tải lại danh sách tài khoản.')
        }
        if (result.reason === 'not_found') throw new Error('Không tìm thấy tài khoản Zalo.')
        if (result.reason === 'invalid_transition') {
          throw new Error('Trạng thái tài khoản đã thay đổi. Vui lòng thử lại.')
        }
        throw new Error('Không thể cập nhật trạng thái tài khoản Zalo Server.')
      }
      const account = await supabase.getAccount(id)
      if (!account) throw new Error('Không tìm thấy tài khoản Zalo.')
      sendAccountStatusUpdated(mainWindow)
      return account
    }

    const changesZaloType = existing?.flatformType === 'zalo'
      && (normalizedUpdates.flatformType === undefined || normalizedUpdates.flatformType === 'zalo')
      && (
        (typeof normalizedUpdates.isZaloShowWeb === 'boolean'
          && existing.isZaloShowWeb !== normalizedUpdates.isZaloShowWeb) ||
        (typeof normalizedUpdates.isZaloServer === 'boolean'
          && existing.isZaloServer !== normalizedUpdates.isZaloServer)
      )
    const targetIsZaloShowWeb = changesZaloType
      ? normalizedUpdates.isZaloShowWeb ?? existing!.isZaloShowWeb
      : existing?.isZaloShowWeb ?? false
    const targetIsZaloServer = changesZaloType
      ? normalizedUpdates.isZaloServer ?? existing!.isZaloServer
      : existing?.isZaloServer ?? false
    const crossesZaloWebBoundary = changesZaloType
      && targetIsZaloShowWeb !== existing!.isZaloShowWeb
    let zaloTypeChangePreviousStatus: PreviousZaloAccountStatus | undefined
    let zaloTypeChangeRuntimeTarget: ZaloAccountRuntimeTarget | undefined
    let zaloTypeChangeClaimToken: string | undefined
    if (changesZaloType) {
      if (existing.status !== 'chờ xử lý' && existing.status !== 'tạm dừng') {
        throw new Error('Không thể đổi loại tài khoản Zalo khi tài khoản đang chạy.')
      }
      // Validate the destination before clearing either local session. Cleanup is
      // deliberately performed before the DB commit so a cleanup failure remains
      // retryable and cannot leave the account stored as the new runtime type.
      await ensureCurrentUserCanUseZaloAccountType(targetIsZaloShowWeb, targetIsZaloServer)
      if (crossesZaloWebBoundary && !zaloRuntime) {
        throw new Error('Runtime Zalo chưa sẵn sàng để đổi loại tài khoản.')
      }
      zaloTypeChangeRuntimeTarget = getZaloRuntimeTarget(existing)
      const claim = await supabase.claimZaloAccountTypeChange(
        id,
        zaloTypeChangeRuntimeTarget,
        existing.status
      )
      if (!claim.claimed || !claim.previousStatus || !claim.claimToken) {
        const message = claim.reason === 'runtime_not_owner'
          ? 'Loại runtime của tài khoản Zalo đã thay đổi. Vui lòng tải lại danh sách tài khoản.'
          : claim.reason === 'work_running'
            ? 'Không thể đổi loại tài khoản Zalo khi chiến dịch hoặc tác vụ của tài khoản đang chạy.'
            : claim.reason === 'account_not_available' || claim.reason === 'status_changed'
              ? 'Trạng thái tài khoản Zalo đã thay đổi. Vui lòng thử lại.'
              : 'Tài khoản Zalo đang thực hiện một tác vụ khác.'
        throw new Error(message)
      }
      zaloTypeChangePreviousStatus = claim.previousStatus
      zaloTypeChangeClaimToken = claim.claimToken
      sendAccountStatusUpdated(mainWindow)
    }

    let zaloTypeChangeReleased = false
    try {
      if (changesZaloType) {
        if (shouldRouteZaloAccountToServer(existing!)) {
          void zaloServerClient?.executeCommand('zalo.runtime.invalidate', id).catch(() => {})
        } else if (!shouldRouteZaloAccountToChatApi(existing!)) {
          zaloRuntime?.invalidateAccount(id)
        }
        if (crossesZaloWebBoundary) await zaloRuntime!.resetAccountTypeSession(id)
      }
      let account = await supabase.updateAccount(
        id,
        normalizedUpdates,
        changesZaloType ? { zaloTypeChangePreviousStatus, zaloTypeChangeClaimToken } : undefined
      )
      if (
        changesZaloType &&
        zaloTypeChangePreviousStatus &&
        zaloTypeChangeRuntimeTarget &&
        zaloTypeChangeClaimToken
      ) {
        const released = await supabase.releaseZaloAccountTypeChange(
          id,
          zaloTypeChangeRuntimeTarget,
          zaloTypeChangePreviousStatus,
          zaloTypeChangeClaimToken
        )
        if (!released) {
          throw new Error('Không thể hoàn tất đổi loại tài khoản Zalo. Vui lòng tải lại danh sách tài khoản.')
        }
        zaloTypeChangeReleased = true
        const settledAccount = await supabase.getAccount(id)
        if (!settledAccount) {
          throw new Error('Không thể tải lại tài khoản Zalo sau khi đổi loại.')
        }
        account = settledAccount
      }
      if (!changesZaloType && normalizedUpdates.flatformType !== undefined && existing) {
        if (!shouldRouteZaloAccountCleanupToServer(existing)) zaloRuntime?.invalidateAccount(id)
      }
      if (changesZaloType) sendAccountStatusUpdated(mainWindow)
      return account
    } catch (error) {
      if (
        zaloTypeChangePreviousStatus &&
        zaloTypeChangeRuntimeTarget &&
        zaloTypeChangeClaimToken &&
        !zaloTypeChangeReleased
      ) {
        await supabase.releaseZaloAccountTypeChange(
          id,
          zaloTypeChangeRuntimeTarget,
          zaloTypeChangePreviousStatus,
          zaloTypeChangeClaimToken
        ).catch(releaseError => {
          console.error('[ZaloRuntime] Failed to release account type-change claim:', {
            accountId: id,
            releaseError
          })
        })
        sendAccountStatusUpdated(mainWindow)
      }
      throw error
    }
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_ACCOUNT, async (_, id: number) => {
    const existing = await supabase.getAccount(id)
    if (webviewRegistry.isRegistered(id)) {
      webviewRegistry.unregister(id)
    }
    if (existing?.flatformType === 'zalo' && shouldRouteZaloAccountCleanupToServer(existing)) {
      void zaloServerClient?.executeCommand('zalo.runtime.invalidate', id).catch(() => {})
    } else if (!existing || !shouldRouteZaloAccountToChatApi(existing)) {
      zaloRuntime?.invalidateAccount(id)
      zaloRuntime?.detachWebSession(id)
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
    return supabase.updateProxy(id, updates)
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
    await ensureCurrentUserCanUseAccountPlatform(account.flatformType)
    if (isBrowserlessAccount(account)) {
      return { success: false, reason: BROWSERLESS_ACCOUNT_REASON }
    }
    await proxyRuntime.prepareAccountSession(account)
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_ACCOUNT_ACTIONS, async (_, flatformType?: string, includeRestricted?: boolean) => {
    return supabase.listAccountActions(flatformType, includeRestricted)
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_ACTION_OVERVIEW, async (_, accountId: number) => {
    if (!await supabase.getAccount(accountId)) throw new Error('Không tìm thấy tài khoản phù hợp với gói hiện tại')
    return supabase.listAccountActionOverview(accountId)
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_ACTION_ENABLE_NOW, async (_, accountId: number, actionCode: string) => {
    if (!await supabase.getAccount(accountId)) throw new Error('Không tìm thấy tài khoản phù hợp với gói hiện tại')
    const status = await supabase.enableAccountActionNow(accountId, actionCode)
    sendAccountStatusUpdated(mainWindow)
    return status
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_SMS_RESET_MOBILE_DEVICE, async (_, accountId: number) => {
    const account = await supabase.clearAccountMobileDevice(accountId)
    sendAccountStatusUpdated(mainWindow)
    return account
  })

  ipcMain.handle(IPC_EVENTS.ZALO_LOGIN_QR_START, async (_, accountId: number) => {
    await ensureCurrentUserFeatureActive('zalo')
    const account = await requireZaloAccount(accountId)
    if (account.isZaloShowWeb) {
      return { success: false, accountId, reason: 'Hãy mở tab Zalo Web để đăng nhập' }
    }
    if (shouldRouteZaloAccountToChatApi(account)) {
      return zaloChatApiClient!.startLoginQr(accountId)
    }
    if (shouldRouteZaloAccountToServer(account)) {
      return zaloServerClient?.executeCommand('zalo.loginQr.start', accountId)
        ?? { success: false, accountId, reason: 'Chưa kết nối akaAgent Zalo Server' }
    }
    if (!zaloRuntime) return { success: false, accountId, reason: 'Zalo runtime chưa sẵn sàng' }
    return trackLocalOperation((async () => {
      const previousStatus = await claimLocalZaloOperation(accountId, false)
      try {
        const result = await zaloRuntime.startLoginQr(accountId)
        if (!result.success) {
          await releaseLocalZaloOperation(accountId, previousStatus)
          return result
        }

        localQrClaims.set(accountId, previousStatus)
        trackLocalOperation(
          zaloRuntime.waitForLoginQrIdle(accountId)
            .finally(() => releaseLocalQrClaim(accountId))
        ).catch(error => {
          console.error(`[ZaloRuntime] QR completion failed for account ${accountId}:`, error)
        })
        return result
      } catch (error) {
        const qrSettled = await zaloRuntime.cancelLoginQrAndWait(accountId).catch(() => false)
        if (qrSettled) {
          await releaseLocalZaloOperation(accountId, previousStatus)
        } else {
          localQrClaims.set(accountId, previousStatus)
        }
        throw error
      }
    })())
  })

  ipcMain.handle(IPC_EVENTS.ZALO_LOGIN_QR_CANCEL, async (_, accountId: number) => {
    const account = await supabase.getAccountIgnoringCapability(accountId)
    if (!account || account.flatformType !== 'zalo') {
      throw new Error('Không tìm thấy tài khoản Zalo thuộc quyền quản lý của bạn')
    }
    if (shouldRouteZaloAccountToChatApi(account)) {
      return zaloChatApiClient!.cancelLoginQr(accountId)
    }
    if (shouldRouteZaloAccountCleanupToServer(account)) {
      return zaloServerClient?.executeCommand('zalo.loginQr.cancel', accountId)
        ?? { success: false, accountId, reason: 'Chưa kết nối akaAgent Zalo Server' }
    }
    if (!zaloRuntime) return { success: false, accountId, reason: 'Zalo runtime chưa sẵn sàng' }
    return trackLocalOperation((async () => {
      const qrSettled = await zaloRuntime.cancelLoginQrAndWait(accountId)
      if (!qrSettled) {
        return { success: false, accountId, reason: 'QR chưa dừng an toàn. Vui lòng thử lại sau.' }
      }
      await releaseLocalQrClaim(accountId)
      return { success: true, accountId }
    })())
  })

  ipcMain.handle(IPC_EVENTS.ZALO_CHECK_SESSION, async (_, accountId: number) => {
    await ensureCurrentUserFeatureActive('zalo')
    const account = await requireZaloAccount(accountId)
    if (shouldRouteZaloAccountToChatApi(account)) {
      return zaloChatApiClient!.checkSession(accountId)
    }
    if (shouldRouteZaloAccountToServer(account)) {
      return zaloServerClient?.executeCommand('zalo.session.check', accountId)
        ?? { success: false, loggedIn: false, status: 'chưa đăng nhập', reason: 'Chưa kết nối akaAgent Zalo Server' }
    }
    if (!zaloRuntime) return { success: false, loggedIn: false, status: 'chưa đăng nhập', reason: 'Zalo runtime chưa sẵn sàng' }
    const result = await runClaimedLocalZaloOperation(accountId, false, () => zaloRuntime.checkSession(accountId))
    sendAccountStatusUpdated(mainWindow)
    zaloRealtimeRefresh?.refreshSoon('zalo-check-session')
    return result
  })

  ipcMain.handle(IPC_EVENTS.ZALO_LOGOUT, async (_, accountId: number) => {
    await ensureCurrentUserFeatureActive('zalo')
    const account = await requireZaloAccount(accountId)
    if (shouldRouteZaloAccountToChatApi(account)) {
      const result = await zaloChatApiClient!.logout(accountId)
      sendAccountStatusUpdated(mainWindow)
      return result
    }
    if (shouldRouteZaloAccountToServer(account)) {
      return zaloServerClient?.executeCommand('zalo.logout', accountId)
        ?? { success: false, loggedIn: false, status: 'chưa đăng nhập', reason: 'Chưa kết nối akaAgent Zalo Server' }
    }
    if (!zaloRuntime) return { success: false, loggedIn: false, status: 'chưa đăng nhập', reason: 'Zalo runtime chưa sẵn sàng' }
    const result = await runClaimedLocalZaloOperation(accountId, false, () => zaloRuntime.logout(accountId))
    sendAccountStatusUpdated(mainWindow)
    zaloRealtimeRefresh?.refreshSoon('zalo-logout')
    return result
  })

  ipcMain.handle(IPC_EVENTS.ZALO_LIST_LABELS, async (_, accountId: number) => {
    await ensureCurrentUserFeatureActive('zalo')
    await requireZaloAccount(accountId)
    const contacts = await supabase.listContacts(accountId, 'zalo_tag')
    return contacts
      .map(mapZaloLabelContact)
      .filter(label => Number.isFinite(label.id) && label.id > 0 && label.text)
  })

  ipcMain.handle(IPC_EVENTS.ZALO_SYNC_LABELS, async (_, accountId: number) => {
    await ensureCurrentUserFeatureActive('zalo')
    const account = await requireZaloAccount(accountId)
    if (shouldRouteZaloAccountToServer(account)) {
      return zaloServerClient?.executeCommand('zalo.labels.sync', accountId)
        ?? Promise.reject(new Error('Chưa kết nối akaAgent Zalo Server'))
    }
    if (!zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    return runClaimedLocalZaloOperation(accountId, true, async () => {
      const labels = await zaloRuntime.listLabels(accountId)
      if (labels.length === 0) {
        await supabase.deleteContacts(accountId, 'zalo_tag')
      } else {
        await supabase.upsertContacts(labels.map(label => mapZaloLabelToContact(accountId, label)), {
          markMissingDeleted: true
        })
      }
      await supabase.syncZaloLabelMemberships(accountId, labels)
      return labels
    })
  })

  ipcMain.handle(IPC_EVENTS.EMAIL_GET_CONFIG, async (_, accountId: number) => {
    const entry = await supabase.getAccountEmailSession(accountId)
    return entry?.session ?? null
  })

  ipcMain.handle(IPC_EVENTS.EMAIL_VERIFY, async (_, config: EmailAccountConfig) => {
    await ensureCurrentUserFeatureActive('email')
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
    if (!account) return { success: false, reason: 'Không tìm thấy tài khoản' }
    if (isBrowserlessAccount(account)) {
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
      const url = PLATFORM_URLS[account.flatformType] || PLATFORM_URLS[flatformType] || 'about:blank'
      await proxyRuntime.prepareAccountSession(account)
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

  ipcMain.handle(IPC_EVENTS.ACCOUNT_CHECK_ZALO_WEB_LOGIN, async (_, accountId: number) => {
    await ensureCurrentUserFeatureActive('zalo')
    const account = await requireZaloAccount(accountId)
    if (!account.isZaloShowWeb) {
      return { loggedIn: false, status: 'chưa đăng nhập', reason: 'Tài khoản Zalo này không dùng trình duyệt' }
    }
    if (!zaloRuntime) {
      return { loggedIn: false, status: 'chưa đăng nhập', reason: 'Zalo runtime chưa sẵn sàng' }
    }
    const result = await runClaimedLocalZaloOperation(accountId, false, () => zaloRuntime.checkSession(accountId))
    sendAccountStatusUpdated(mainWindow)
    return {
      loggedIn: result.loggedIn,
      status: result.status,
      reason: result.reason
    }
  })

  ipcMain.handle(IPC_EVENTS.ACCOUNT_LOGOUT_ZALO_WEB, async (_, accountId: number) => {
    await ensureCurrentUserFeatureActive('zalo')
    const account = await requireZaloAccount(accountId)
    if (!account.isZaloShowWeb) return { success: false, reason: 'Tài khoản Zalo này không dùng trình duyệt' }
    if (!zaloRuntime) return { success: false, reason: 'Zalo runtime chưa sẵn sàng' }
    const result = await runClaimedLocalZaloOperation(accountId, false, () => zaloRuntime.logout(accountId))
    sendAccountStatusUpdated(mainWindow)
    return { success: result.success, reason: result.reason || 'Đã đăng xuất Zalo Web' }
  })

  return {
    async stopAll(): Promise<boolean> {
      const qrSettled = await zaloRuntime?.cancelAllLoginQrAndWait() ?? true
      if (qrSettled) {
        await Promise.allSettled(Array.from(localQrClaims.keys()).map(releaseLocalQrClaim))
      }
      return qrSettled
    },
    async waitForIdle(timeoutMs = 30_000): Promise<boolean> {
      const pending = Array.from(activeLocalOperations)
      if (pending.length === 0) return true
      return await Promise.race([
        Promise.allSettled(pending).then(() => true),
        new Promise<false>(resolve => setTimeout(() => resolve(false), Math.max(0, timeoutMs)))
      ])
    },
    abandonClaims(): void {
      runtimeClaimsAbandoned = true
      localQrClaims.clear()
    },
    resetClaims(): void {
      runtimeClaimsAbandoned = false
    }
  }
}

function sendAccountStatusUpdated(mainWindow?: BrowserWindow): void {
  try {
    mainWindow?.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
  } catch {
    // Window may be closed
  }
}
