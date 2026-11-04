import type { DeviceLoginSource } from '../../../shared/deviceIdentity'
import { getCurrentDeviceIdentity, resetCompositeSelection } from '../../services/deviceIdentity'
import { app, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { AuthUser, AuthLoginResult, AuthBootstrapResult, AuthLocalState, AuthRenewalRecheckResult, AuthRenewalRequired, IPC_EVENTS, LoginPreferences, SavedLoginCredentials } from '../../../shared/types'
import { acceptPolicyAndLogin, changePassword, checkRememberedDeviceLogin, checkRenewalStatus, createRenewalPortalLink, login, recoverDeviceCredentials, resetDeviceLock, updateUseTestWorkflow } from '../../data/repositories/authRepository'
import { RenewalRequiredError } from '../../data/repositories/entitlementRepository'
import { DesktopSessionRejected } from '../../data/desktopSession'
import { renewalManualLoginUrl, toPublicRenewal, type RenewalRequirement } from '../../../shared/renewalPortal'
import type { RenewalWebLink } from '../../services/renewalWebService'
import { getCurrentUser, getCurrentUserCredentials, setCurrentUser, setCurrentUserCredentials } from '../../data/currentUser'
import { getLocalLoginStore } from '../../services/localLoginService'
import { getDeviceChangeRequests } from '../../services/deviceChangeService'
import { devicePresence } from '../../services/devicePresenceService'
import { resumeDesktopCampaignEngagement } from '../../services/zaloCampaignEngagement'

export interface AuthLoginContext { user: AuthUser; username: string; password: string; automatic: boolean }
interface AuthLifecycleHooks {
  afterLogin?: (context: AuthLoginContext) => Promise<void> | void
  beforeLogout?: () => Promise<void> | void
  afterPasswordChange?: (context: { oldPassword: string; newPassword: string }) => Promise<void> | void
  /** Main -> renderer: phiên vừa hết hạn vì hết gói, mở màn Gia hạn. */
  notifyRenewalRequired?: (renewal: AuthRenewalRequired) => void
}

export const RENEWAL_ENDED_MESSAGE = 'Phiên gia hạn đã kết thúc. Vui lòng đăng nhập lại.'
/** Thông tin đăng nhập chỉ nằm trong RAM main khi màn Gia hạn còn được dùng. */
const RENEWAL_IDLE_TTL_MS = 60 * 60_000

interface PendingRenewal {
  id: number
  credentials: SavedLoginCredentials
  source: DeviceLoginSource
  requirement: RenewalRequirement
  fingerprintHash: string | null
  touchedAt: number
}

/** Điều khiển màn Gia hạn cho handlers khác; không trả mật khẩu ra ngoài main. */
export interface AuthRenewalControl {
  currentRenewalId(): number | null
  onRenewalChanged(listener: () => void): () => void
  createRenewalLink(): Promise<RenewalWebLink>
  offerSessionRenewal(credentials: SavedLoginCredentials): Promise<void>
}

export function registerAuthHandlers(hooks: AuthLifecycleHooks = {}): AuthRenewalControl {
  const store = getLocalLoginStore()
  let generation = 0
  let pendingPolicy: { credentials: SavedLoginCredentials; source: DeviceLoginSource } | null = null
  let pendingRenewal: PendingRenewal | null = null
  let renewalSequence = 0
  // Tăng khi có lượt đăng nhập/huỷ/đăng xuất mới để bỏ đề nghị gia hạn đang chạy dở.
  let renewalEpoch = 0
  let authenticatedSource: { username: string; source: DeviceLoginSource } | null = null
  const renewalListeners = new Set<() => void>()
  let rememberedChecked = false
  let recoveredCredentials: SavedLoginCredentials | null = null
  let bootstrap: Promise<AuthBootstrapResult> | null = null
  let bootstrapCompleted = false
  let loginRunning = false
  const withRecovery = (state: AuthLocalState): AuthLocalState => recoveredCredentials
    ? { ...state, rememberedLogin: { username: recoveredCredentials.username, hasCredential: true, source: 'recovery' } }
    : rememberedChecked ? state : { ...state, rememberedLogin: null }
  const snapshot = (): AuthBootstrapResult => ({ user: null, ...withRecovery(store.snapshot()) })
  const setPendingRenewal = (next: PendingRenewal | null): void => {
    if (pendingRenewal === next) return
    pendingRenewal = next
    for (const listener of renewalListeners) {
      try { listener() } catch { console.warn('[Renewal] Không cập nhật được màn Gia hạn.') }
    }
  }
  const currentRenewal = (): PendingRenewal | null => {
    if (pendingRenewal && Date.now() - pendingRenewal.touchedAt > RENEWAL_IDLE_TTL_MS) setPendingRenewal(null)
    return pendingRenewal
  }
  const adoptRenewal = (credentials: SavedLoginCredentials, source: DeviceLoginSource, requirement: RenewalRequirement,
    fingerprintHash: string | null): AuthRenewalRequired => {
    const current = currentRenewal()
    if (current && current.credentials.username === credentials.username && current.credentials.password === credentials.password) {
      // Cùng tài khoản: giữ webview đang mở (khách có thể đang ở bước thanh toán).
      current.requirement = requirement
      current.source = source
      current.fingerprintHash = fingerprintHash ?? current.fingerprintHash
      current.touchedAt = Date.now()
    } else {
      setPendingRenewal({ id: ++renewalSequence, credentials: { ...credentials }, source, requirement, fingerprintHash, touchedAt: Date.now() })
    }
    return toPublicRenewal(requirement)
  }
  const deviceFingerprint = async (pending: PendingRenewal): Promise<string> =>
    pending.fingerprintHash ?? (await getCurrentDeviceIdentity()).fingerprintHash
  function syncStartup(): string | null {
    try {
      const enabled = store.snapshot().loginOptions.startupEnabled
      app.setLoginItemSettings({ openAtLogin: enabled })
      if (app.getLoginItemSettings().openAtLogin !== enabled) throw new Error('Startup setting was not applied')
      return null
    }
    catch { return 'Chưa cập nhật được thiết lập khởi động cùng máy tính.' }
  }
  async function runLogin(credentials: SavedLoginCredentials, source: DeviceLoginSource, accept = false): Promise<AuthLoginResult> {
    if (loginRunning) throw new Error('Đang xử lý đăng nhập. Vui lòng chờ.')
    loginRunning = true
    const automatic = source === 'automatic'
    const expected = generation
    const revision = store.getRevision()
    const assertCurrent = () => {
      if (generation !== expected || (automatic && revision !== store.getRevision())) throw new Error('Đăng nhập tự động đã được hủy theo lựa chọn mới.')
    }
    try {
      assertCurrent()
      let result: AuthLoginResult
      try {
        result = accept
          ? await acceptPolicyAndLogin(credentials.username, credentials.password, assertCurrent, source)
          : await login(credentials.username, credentials.password, assertCurrent, source)
      } catch (error) {
        if (!(error instanceof RenewalRequiredError)) throw error
        assertCurrent()
        pendingPolicy = null; rememberedChecked = true
        return { status: 'renewal_required', renewal: adoptRenewal(credentials, source, error.requirement, error.context?.fingerprintHash ?? null) }
      }
      assertCurrent()
      // authRepository báo hết hạn bằng RenewalRequiredError; giữ nguyên nếu có kết quả này.
      if (result.status === 'renewal_required') return result
      // Gói đã còn hạn: màn Gia hạn không còn cần.
      setPendingRenewal(null)
      if (result.status === 'manual_login_required') {
        pendingPolicy = null; recoveredCredentials = null; rememberedChecked = false
        const loginState = await store.requireManualDeviceLogin()
        rememberedChecked = true
        return { status: 'manual_login_required', loginState }
      }
      rememberedChecked = true
      if (result.status === 'policy_required') { pendingPolicy = { credentials: { ...credentials }, source }; return result }
      pendingPolicy = null
      const user = result.user
      user.chatWebEnabledAtLogin = false
      user.chatWebSessionId = undefined
      setCurrentUser(user)
      setCurrentUserCredentials(credentials)
      try {
        await hooks.afterLogin?.({ user, ...credentials, automatic })
        assertCurrent()
        const authenticated = getCurrentUser()
        if (!authenticated) throw new Error('Phiên đăng nhập không còn hợp lệ.')
        user.chatWebEnabledAtLogin = authenticated.appAccess?.separateAccess ? authenticated.appAccess.staff.akachatAllowed : authenticated.isChatSync === true
        user.chatWebSessionId = user.chatWebEnabledAtLogin ? randomUUID() : undefined
        authenticated.chatWebEnabledAtLogin = user.chatWebEnabledAtLogin
        authenticated.chatWebSessionId = user.chatWebSessionId
        const loginState = await store.saveAuthenticated(credentials, result.automaticLoginAllowed !== false)
        assertCurrent()
        loginState.warningMessage = [loginState.warningMessage, syncStartup()].filter(Boolean).join('\n') || null
        try { devicePresence.start(credentials) } catch { console.warn('[DevicePresence] Không khởi động được trạng thái phiên.') }
        resumeDesktopCampaignEngagement()
        authenticatedSource = { username: credentials.username, source }
        return { status: 'authenticated', user, loginState }
      } catch (error) {
        // A cancelled login may already have started services in afterLogin.
        // Finish their cleanup before permitting another authentication attempt.
        try { await hooks.beforeLogout?.() } catch { console.warn('[Auth] Không hoàn tất cleanup đăng nhập đã hủy.') }
        devicePresence.stop()
        setCurrentUserCredentials(null)
        setCurrentUser(null)
        throw error
      }
    } catch (error) {
      if (!getCurrentUser()) setCurrentUser(null)
      throw error
    } finally { loginRunning = false }
  }
  ipcMain.handle(IPC_EVENTS.AUTH_BOOTSTRAP, () => {
    if (bootstrapCompleted || getCurrentUser()) {
      const renewal = getCurrentUser() ? null : currentRenewal()
      return { ...snapshot(), user: getCurrentUser(), policyAcceptanceRequired: !!pendingPolicy,
        renewal: renewal ? toPublicRenewal(renewal.requirement) : null }
    }
    return bootstrap ??= (async () => {
      const bootstrapGeneration = generation
      const revision = store.getRevision()
      await store.initialize()
      let startupEnabled = store.snapshot().loginOptions.startupEnabled
      try { startupEnabled = app.getLoginItemSettings().openAtLogin } catch { /* preserve existing preference */ }
      store.initializeMigrationPreferences(startupEnabled)
      const startupWarning = syncStartup()
      const bootSnapshot = (): AuthBootstrapResult => {
        const state = snapshot()
        return { ...state, warningMessage: state.warningMessage || startupWarning }
      }
      const credentials = store.getCredentials()
      if (!credentials || store.getRevision() !== revision || generation !== bootstrapGeneration) return bootSnapshot()
      try {
        if (!store.snapshot().loginOptions.autoLogin) {
          const allowed = await checkRememberedDeviceLogin(credentials)
          if (store.getRevision() !== revision || generation !== bootstrapGeneration) return bootSnapshot()
          if (!allowed) await store.requireManualDeviceLogin()
          rememberedChecked = true
          return bootSnapshot()
        }
      } catch (error) { return { ...bootSnapshot(), errorMessage: error instanceof Error ? error.message : 'Không xác minh được thông tin ghi nhớ.' } }
      try {
        const result = await runLogin(credentials, 'automatic')
        if (result.status === 'manual_login_required') return { ...bootSnapshot(), ...result.loginState }
        if (result.status === 'policy_required') return { ...bootSnapshot(), policyAcceptanceRequired: true }
        if (result.status === 'renewal_required') return { ...bootSnapshot(), renewal: result.renewal }
        return { ...bootSnapshot(), ...result.loginState, user: result.user }
      } catch (error) { return { ...bootSnapshot(), errorMessage: error instanceof Error ? error.message : 'Đăng nhập tự động thất bại.' } }
    })().finally(() => { bootstrapCompleted = true })
  })
  ipcMain.handle(IPC_EVENTS.AUTH_LOGIN, async (_, username: string, password: string, options?: Partial<LoginPreferences>) => {
    generation++; pendingPolicy = null; recoveredCredentials = null
    renewalEpoch++; setPendingRenewal(null)
    await store.updateOptions(options ?? {})
    return runLogin({ username: (username || '').trim(), password: password || '' }, 'manual')
  })
  ipcMain.handle(IPC_EVENTS.AUTH_LOGIN_REMEMBERED, async (_, username: string, options?: Partial<LoginPreferences>) => {
    generation++; pendingPolicy = null
    renewalEpoch++; setPendingRenewal(null)
    await store.initialize()
    const credentials = recoveredCredentials ?? store.getCredentials()
    if (!credentials || credentials.username !== username?.trim()) throw new Error('Vui lòng nhập mật khẩu cho tài khoản này.')
    const source = recoveredCredentials ? 'recovery' : 'remembered'
    recoveredCredentials = null
    await store.updateOptions(options ?? {})
    return runLogin(credentials, source)
  })
  ipcMain.handle(IPC_EVENTS.AUTH_ACCEPT_POLICY_AND_LOGIN, async () => {
    if (!pendingPolicy) throw new Error('Không còn yêu cầu xác nhận chính sách. Vui lòng đăng nhập lại.')
    return runLogin({ ...pendingPolicy.credentials }, pendingPolicy.source, true)
  })
  ipcMain.handle(IPC_EVENTS.AUTH_CANCEL_PENDING_LOGIN, () => { generation++; pendingPolicy = null; recoveredCredentials = null })
  const updateOptions = async (updates: Partial<LoginPreferences>): Promise<AuthBootstrapResult> => {
    if (updates.rememberLogin === false) recoveredCredentials = null
    const state = await store.updateOptions(updates, getCurrentUserCredentials())
    if (Object.prototype.hasOwnProperty.call(updates, 'startupEnabled')) state.warningMessage = [state.warningMessage, syncStartup()].filter(Boolean).join('\n') || null
    return { user: null, ...withRecovery(state) }
  }
  ipcMain.handle(IPC_EVENTS.AUTH_UPDATE_LOGIN_PREFERENCES, (_, updates: Partial<LoginPreferences>) => updateOptions(updates))
  ipcMain.handle(IPC_EVENTS.AUTH_REVOKE_REMEMBERED_LOGIN, () => updateOptions({ rememberLogin: false, autoLogin: false }))
  ipcMain.handle(IPC_EVENTS.AUTH_RECOVER_DEVICE_CREDENTIALS, async () => {
    if (loginRunning || getCurrentUser()) throw new Error('Chỉ lấy lại thông tin trên màn hình đăng nhập.')
    const expected = ++generation
    pendingPolicy = null; recoveredCredentials = null
    const revision = store.getRevision()
    await store.initialize()
    if (store.snapshot().manualLoginRequired) return store.snapshot()
    const credentials = await recoverDeviceCredentials()
    if (generation !== expected || store.getRevision() !== revision || loginRunning || getCurrentUser()) {
      throw new Error('Đã hủy lấy thông tin đăng nhập theo thao tác mới.')
    }
    if (!credentials) {
      rememberedChecked = false
      const state = await store.requireManualDeviceLogin()
      rememberedChecked = true
      return state
    }
    rememberedChecked = true
    recoveredCredentials = { ...credentials }
    return withRecovery(store.snapshot())
  })
  ipcMain.handle(IPC_EVENTS.AUTH_LOGOUT, async () => {
    generation++; pendingPolicy = null; recoveredCredentials = null
    renewalEpoch++; setPendingRenewal(null); authenticatedSource = null
    try { await hooks.beforeLogout?.() } catch { console.warn('[Auth] Không hoàn tất cleanup đăng xuất.') }
    devicePresence.stop(); setCurrentUserCredentials(null); setCurrentUser(null)
    return { success: true }
  })
  ipcMain.handle(IPC_EVENTS.AUTH_ME, () => getCurrentUser())
  ipcMain.handle(IPC_EVENTS.AUTH_RESET_DEVICE_LOCK, async () => {
    const user = getCurrentUser()
    if (!user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi đổi máy tính.')
    const result = await resetDeviceLock(user)
    if (result.success) { await resetCompositeSelection(); await updateOptions({ rememberLogin: false, autoLogin: false }) }
    return result
  })
  ipcMain.handle(IPC_EVENTS.AUTH_RESET_DEVICE_LOCK_BY_USERNAME, async (_, username: string) => {
    generation++; pendingPolicy = null; recoveredCredentials = null
    const result = await getDeviceChangeRequests().reset(username, 'login')
    if (result.success) await resetCompositeSelection()
    return result
  })
  ipcMain.handle(IPC_EVENTS.AUTH_CHANGE_PASSWORD, async (_, oldPassword: string, newPassword: string) => {
    const user = getCurrentUser()
    if (!user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước.')
    const result = await changePassword(user, oldPassword, newPassword)
    const credentials = { username: user.username, password: newPassword }
    setCurrentUserCredentials(credentials)
    resumeDesktopCampaignEngagement()
    const loginState = await store.saveAuthenticated(credentials)
    devicePresence.updateCredentials(credentials)
    await hooks.afterPasswordChange?.({ oldPassword, newPassword })
    return { ...result, loginState }
  })
  ipcMain.handle(IPC_EVENTS.AUTH_UPDATE_USE_TEST_WORKFLOW, async (_, useTestWorkflow: boolean) => {
    const user = getCurrentUser()
    if (!user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước.')
    const updated = await updateUseTestWorkflow(user, !!useTestWorkflow)
    setCurrentUser(updated)
    return updated
  })

  // ===== Màn Gia hạn (cổng CRM /gia-han) =====

  async function createRenewalLink(): Promise<RenewalWebLink> {
    const pending = currentRenewal()
    if (!pending) throw new Error(RENEWAL_ENDED_MESSAGE)
    pending.touchedAt = Date.now()
    try {
      const url = await createRenewalPortalLink(pending.credentials, await deviceFingerprint(pending),
        pending.requirement.focusOrganizationProductId)
      if (currentRenewal() !== pending) throw new Error(RENEWAL_ENDED_MESSAGE)
      return { url, signed: true }
    } catch {
      if (currentRenewal() !== pending) throw new Error(RENEWAL_ENDED_MESSAGE)
      // Edge chưa có action/khóa ký hoặc lỗi mạng: khách đăng nhập cổng bằng mật khẩu.
      // Không log chi tiết vì link ký số là mã đăng nhập dùng được trong thời hạn.
      console.warn('[Renewal] Chưa tạo được link ký số; mở trang đăng nhập cổng gia hạn.')
      return { url: renewalManualLoginUrl(pending.requirement.kind), signed: false }
    }
  }

  ipcMain.handle(IPC_EVENTS.AUTH_RENEWAL_RECHECK, async (): Promise<AuthRenewalRecheckResult> => {
    const pending = currentRenewal()
    if (!pending) return { status: 'renewal_ended', message: RENEWAL_ENDED_MESSAGE }
    if (loginRunning) throw new Error('Đang xử lý đăng nhập. Vui lòng chờ.')
    pending.touchedAt = Date.now()
    try {
      // Kiểm nhẹ 1 request; chỉ chạy lại toàn bộ đăng nhập khi gói đã còn hạn.
      const status = await checkRenewalStatus(pending.credentials, await deviceFingerprint(pending))
      if (currentRenewal() !== pending) return { status: 'renewal_ended', message: RENEWAL_ENDED_MESSAGE }
      if (status.requirement) {
        pending.requirement = status.requirement
        return { status: 'renewal_required', renewal: toPublicRenewal(status.requirement) }
      }
    } catch (error) {
      if (currentRenewal() !== pending) return { status: 'renewal_ended', message: RENEWAL_ENDED_MESSAGE }
      // Bị từ chối (đổi mật khẩu, bị khoá…): luồng đăng nhập đầy đủ trả đúng câu báo.
      if (!(error instanceof DesktopSessionRejected)) throw error
    }
    if (loginRunning) throw new Error('Đang xử lý đăng nhập. Vui lòng chờ.')
    generation++; pendingPolicy = null; recoveredCredentials = null
    try {
      return await runLogin({ ...pending.credentials }, pending.source)
    } catch (error) {
      // Lỗi trước khi xác định được gói (mạng…): vẫn ở màn Gia hạn để thử lại.
      if (currentRenewal()) throw error
      // Gói đã còn hạn nhưng đăng nhập vướng bước khác (khoá máy…): về màn đăng nhập.
      return { status: 'renewal_ended', message: error instanceof Error ? error.message : 'Đăng nhập thất bại.' }
    }
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RENEWAL_CANCEL, () => {
    generation++; renewalEpoch++; pendingPolicy = null
    setPendingRenewal(null)
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RENEWAL_OPEN_EXTERNAL, async (): Promise<{ signed: boolean }> => {
    const link = await createRenewalLink()
    await shell.openExternal(link.url)
    return { signed: link.signed }
  })

  return {
    currentRenewalId: () => currentRenewal()?.id ?? null,
    onRenewalChanged: listener => {
      renewalListeners.add(listener)
      return () => { renewalListeners.delete(listener) }
    },
    createRenewalLink,
    offerSessionRenewal: async credentials => {
      // Gọi sau khi phiên đang dùng bị kết thúc vì tổ chức hết gói.
      const epoch = ++renewalEpoch
      const fingerprintHash = (await getCurrentDeviceIdentity()).fingerprintHash
      const status = await checkRenewalStatus(credentials, fingerprintHash)
      if (epoch !== renewalEpoch || loginRunning || getCurrentUser() || !status.requirement) return
      const source: DeviceLoginSource = authenticatedSource?.username === credentials.username
        ? authenticatedSource.source
        : 'remembered'
      rememberedChecked = true
      hooks.notifyRenewalRequired?.(adoptRenewal(credentials, source, status.requirement, fingerprintHash))
    }
  }
}
