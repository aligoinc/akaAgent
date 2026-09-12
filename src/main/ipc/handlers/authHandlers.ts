import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { AuthUser, AuthLoginResult, AuthBootstrapResult, AuthLocalState, IPC_EVENTS, LoginPreferences, SavedLoginCredentials } from '../../../shared/types'
import { acceptPolicyAndLogin, changePassword, loadLegacyLoginCandidate, login, recoverDeviceCredentials, resetDeviceLock, updateUseTestWorkflow } from '../../data/repositories/authRepository'
import { getCurrentUser, getCurrentUserCredentials, setCurrentUser, setCurrentUserCredentials } from '../../data/currentUser'
import { getLocalLoginStore } from '../../services/localLoginService'
import { getDeviceChangeRequests } from '../../services/deviceChangeService'
import { devicePresence } from '../../services/devicePresenceService'

export interface AuthLoginContext { user: AuthUser; username: string; password: string; automatic: boolean }
interface AuthLifecycleHooks {
  afterLogin?: (context: AuthLoginContext) => Promise<void> | void
  beforeLogout?: () => Promise<void> | void
  afterPasswordChange?: (context: { oldPassword: string; newPassword: string }) => Promise<void> | void
}

export function registerAuthHandlers(hooks: AuthLifecycleHooks = {}): void {
  const store = getLocalLoginStore()
  let generation = 0
  let pendingPolicy: SavedLoginCredentials | null = null
  let recoveredCredentials: SavedLoginCredentials | null = null
  let bootstrap: Promise<AuthBootstrapResult> | null = null
  let bootstrapCompleted = false
  let loginRunning = false
  const withRecovery = (state: AuthLocalState): AuthLocalState => recoveredCredentials
    ? { ...state, rememberedLogin: { username: recoveredCredentials.username, hasCredential: true, source: 'recovery' } }
    : state
  const snapshot = (): AuthBootstrapResult => ({ user: null, ...withRecovery(store.snapshot()) })
  function syncStartup(): string | null {
    try {
      const enabled = store.snapshot().loginOptions.startupEnabled
      app.setLoginItemSettings({ openAtLogin: enabled })
      if (app.getLoginItemSettings().openAtLogin !== enabled) throw new Error('Startup setting was not applied')
      return null
    }
    catch { return 'Chưa cập nhật được thiết lập khởi động cùng máy tính.' }
  }
  async function runLogin(credentials: SavedLoginCredentials, automatic: boolean, accept = false): Promise<AuthLoginResult> {
    if (loginRunning) throw new Error('Đang xử lý đăng nhập. Vui lòng chờ.')
    loginRunning = true
    const expected = generation
    const revision = store.getRevision()
    const assertCurrent = () => {
      if (generation !== expected || (automatic && revision !== store.getRevision())) throw new Error('Đăng nhập tự động đã được hủy theo lựa chọn mới.')
    }
    try {
      assertCurrent()
      const result: AuthLoginResult = accept
        ? { status: 'authenticated', user: await acceptPolicyAndLogin(credentials.username, credentials.password, assertCurrent) }
        : await login(credentials.username, credentials.password, assertCurrent)
      assertCurrent()
      if (result.status === 'policy_required') { pendingPolicy = { ...credentials }; return result }
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
        user.chatWebEnabledAtLogin = authenticated.isChatSync === true
        user.chatWebSessionId = user.chatWebEnabledAtLogin ? randomUUID() : undefined
        authenticated.chatWebEnabledAtLogin = user.chatWebEnabledAtLogin
        authenticated.chatWebSessionId = user.chatWebSessionId
        const loginState = await store.saveAuthenticated(credentials)
        assertCurrent()
        loginState.warningMessage = [loginState.warningMessage, syncStartup()].filter(Boolean).join('\n') || null
        try { devicePresence.start(credentials) } catch { console.warn('[DevicePresence] Không khởi động được trạng thái phiên.') }
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
    } finally { loginRunning = false }
  }
  ipcMain.handle(IPC_EVENTS.AUTH_BOOTSTRAP, () => {
    if (bootstrapCompleted || getCurrentUser()) return { ...snapshot(), user: getCurrentUser(), policyAcceptanceRequired: !!pendingPolicy }
    return bootstrap ??= (async () => {
      const bootstrapGeneration = generation
      const revision = store.getRevision()
      await store.initialize()
      let startupEnabled = store.snapshot().loginOptions.startupEnabled
      try { startupEnabled = app.getLoginItemSettings().openAtLogin } catch { /* preserve existing preference */ }
      store.initializeMigrationPreferences(startupEnabled)
      if (store.mayImportLegacy()) {
        try {
          const candidate = await loadLegacyLoginCandidate()
          if (candidate) store.importLegacy(candidate.credentials, candidate.loginOptions, revision)
        } catch (error) { return { ...snapshot(), errorMessage: error instanceof Error ? error.message : 'Không tải được thông tin cũ. Vui lòng đăng nhập thủ công.' } }
      }
      const current = snapshot()
      if (!current.warningMessage) current.warningMessage = syncStartup()
      const credentials = store.getCredentials()
      if (!credentials || !current.loginOptions.autoLogin || store.getRevision() !== revision || generation !== bootstrapGeneration) return current
      try {
        const result = await runLogin(credentials, true)
        if (result.status === 'policy_required') return { ...snapshot(), policyAcceptanceRequired: true }
        return { ...snapshot(), ...result.loginState, user: result.user }
      } catch (error) { return { ...snapshot(), errorMessage: error instanceof Error ? error.message : 'Đăng nhập tự động thất bại.' } }
    })().finally(() => { bootstrapCompleted = true })
  })
  ipcMain.handle(IPC_EVENTS.AUTH_LOGIN, async (_, username: string, password: string, options?: Partial<LoginPreferences>) => {
    generation++; pendingPolicy = null; recoveredCredentials = null
    await store.updateOptions(options ?? {})
    return runLogin({ username: (username || '').trim(), password: password || '' }, false)
  })
  ipcMain.handle(IPC_EVENTS.AUTH_LOGIN_REMEMBERED, async (_, username: string, options?: Partial<LoginPreferences>) => {
    generation++; pendingPolicy = null
    await store.initialize()
    const credentials = recoveredCredentials ?? store.getCredentials()
    if (!credentials || credentials.username !== username?.trim()) throw new Error('Vui lòng nhập mật khẩu cho tài khoản này.')
    recoveredCredentials = null
    await store.updateOptions(options ?? {})
    return runLogin(credentials, false)
  })
  ipcMain.handle(IPC_EVENTS.AUTH_ACCEPT_POLICY_AND_LOGIN, async () => {
    if (!pendingPolicy) throw new Error('Không còn yêu cầu xác nhận chính sách. Vui lòng đăng nhập lại.')
    return runLogin({ ...pendingPolicy }, false, true)
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
    const credentials = await recoverDeviceCredentials()
    if (generation !== expected || store.getRevision() !== revision || loginRunning || getCurrentUser()) {
      throw new Error('Đã hủy lấy thông tin đăng nhập theo thao tác mới.')
    }
    recoveredCredentials = { ...credentials }
    return withRecovery(store.snapshot())
  })
  ipcMain.handle(IPC_EVENTS.AUTH_LOGOUT, async () => {
    generation++; pendingPolicy = null; recoveredCredentials = null
    try { await hooks.beforeLogout?.() } catch { console.warn('[Auth] Không hoàn tất cleanup đăng xuất.') }
    devicePresence.stop(); setCurrentUserCredentials(null); setCurrentUser(null)
    return { success: true }
  })
  ipcMain.handle(IPC_EVENTS.AUTH_ME, () => getCurrentUser())
  ipcMain.handle(IPC_EVENTS.AUTH_RESET_DEVICE_LOCK, async () => {
    const user = getCurrentUser()
    if (!user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi đổi máy tính.')
    const result = await resetDeviceLock(user)
    if (result.success) await updateOptions({ rememberLogin: false, autoLogin: false })
    return result
  })
  ipcMain.handle(IPC_EVENTS.AUTH_RESET_DEVICE_LOCK_BY_USERNAME, (_, username: string) => getDeviceChangeRequests().reset(username, 'login'))
  ipcMain.handle(IPC_EVENTS.AUTH_CHANGE_PASSWORD, async (_, oldPassword: string, newPassword: string) => {
    const user = getCurrentUser()
    if (!user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước.')
    const result = await changePassword(user, oldPassword, newPassword)
    const credentials = { username: user.username, password: newPassword }
    setCurrentUserCredentials(credentials)
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
}
