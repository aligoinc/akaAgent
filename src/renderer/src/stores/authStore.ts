import { create } from 'zustand'
import { useUiStore } from './uiStore'
import { AuthUser, DeviceLockResetResult, LoginPreferences, AuthLocalState, ZaloRuntimeRestartRequiredPayload } from '../../../shared/types'

interface AuthState {
  user: AuthUser | null
  initializing: boolean
  loggingIn: boolean
  acceptingPolicy: boolean
  recoveringCredentials: boolean
  resettingDevice: boolean
  policyAcceptanceRequired: boolean
  errorMessage: string | null
  loginOptions: LoginPreferences
  rememberedLogin: AuthLocalState['rememberedLogin']
  zaloRuntimeRestartRequired: ZaloRuntimeRestartRequiredPayload | null

  setLoginOptions: (updates: Partial<LoginPreferences>) => Promise<void>
  login: (username: string, password: string, options?: LoginPreferences) => Promise<void>
  acceptPolicyAndLogin: () => Promise<void>
  cancelPolicyAcceptance: () => void
  cancelPendingLogin: () => void
  recoverDeviceCredentials: () => Promise<void>
  logout: () => Promise<void>
  resetDeviceLock: () => Promise<DeviceLockResetResult>
  resetDeviceLockByUsername: (username: string) => Promise<DeviceLockResetResult>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
  updateUseTestWorkflow: (useTestWorkflow: boolean) => Promise<void>
  rehydrateFromStorage: () => Promise<void>
  handleSessionExpired: (message?: string | null) => void
  handleUserUpdated: (user: AuthUser) => void
  handleZaloRuntimeRestartRequired: (payload: ZaloRuntimeRestartRequiredPayload) => void
  clearError: () => void
}

const LEGACY_STORAGE_KEYS = [
  'aka-biz-auth-creds',
  'aka-biz-auth-user',
  'aka-biz-login-options'
]

const DEFAULT_LOGIN_OPTIONS: LoginPreferences = {
  rememberLogin: true,
  autoLogin: true,
  startupEnabled: false
}

function normalizeLoginOptions(options?: Partial<LoginPreferences> | null): LoginPreferences {
  const merged = {
    ...DEFAULT_LOGIN_OPTIONS,
    ...(options || {})
  }

  const next: LoginPreferences = {
    rememberLogin: !!merged.rememberLogin,
    autoLogin: !!merged.autoLogin,
    startupEnabled: !!merged.startupEnabled
  }

  if (options?.rememberLogin === false) next.autoLogin = false
  if (next.autoLogin) next.rememberLogin = true
  return next
}

function clearLegacyAuthStorage(): void {
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(key)
    }
  } catch {
    // ignore storage failures
  }
}

function formatAuthErrorMessage(err: unknown, fallback: string): string {
  const rawMessage = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : ''

  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  if (!message) return fallback

  const technicalPatterns = [
    /schema cache/i,
    /could not find/i,
    /relation .* does not exist/i,
    /column .* does not exist/i,
    /permission denied/i,
    /violates .* constraint/i,
    /duplicate key/i,
    /invalid input syntax/i,
    /null value/i,
    /foreign key/i,
    /postgrest/i,
    /\bpgrst/i,
    /\bsupabase/i,
    /jwt/i,
    /cannot read propert/i,
    /is not a function/i,
    /api not available/i
  ]

  if (technicalPatterns.some(pattern => pattern.test(message))) {
    return fallback
  }

  if (/fetch failed|failed to fetch|network|econn|enotfound|timeout|timed out/i.test(message)) {
    return 'Không thể kết nối máy chủ. Vui lòng kiểm tra internet và thử lại.'
  }

  return message
}

let optionsRevision = 0
let authRevision = 0
const localState = (state: AuthLocalState) => ({ loginOptions: state.loginOptions, rememberedLogin: state.rememberedLogin })
function warnStorage(state: AuthLocalState): void {
  if (state.warningMessage) useUiStore.getState().showAlert(state.warningMessage, 'info')
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null, initializing: true, loggingIn: false, acceptingPolicy: false,
  recoveringCredentials: false, resettingDevice: false, policyAcceptanceRequired: false,
  errorMessage: null, loginOptions: DEFAULT_LOGIN_OPTIONS, rememberedLogin: null, zaloRuntimeRestartRequired: null,

  setLoginOptions: async (updates) => {
    const revision = ++optionsRevision
    const next = { ...get().loginOptions, ...updates }
    if (updates.autoLogin === true && updates.rememberLogin !== false) next.rememberLogin = true
    const options = normalizeLoginOptions(next)
    set({ loginOptions: options, ...(!options.rememberLogin ? { rememberedLogin: null } : {}) })
    try {
      const state = await window.electronAPI.updateLoginPreferences(updates)
      if (revision === optionsRevision) { set(localState(state)); warnStorage(state) }
    } catch (error) { set({ errorMessage: formatAuthErrorMessage(error, 'Chưa lưu được tuỳ chọn đăng nhập.') }) }
  },

  login: async (username, password, options) => {
    if (get().loggingIn) return
    const auth = ++authRevision
    const revision = optionsRevision
    set({ loggingIn: true, policyAcceptanceRequired: false, errorMessage: null })
    try {
      const result = password
        ? await window.electronAPI.login(username, password, options || get().loginOptions)
        : await window.electronAPI.loginRemembered(username, options || get().loginOptions)
      if (auth !== authRevision) return
      if (result.status === 'policy_required') { set({ policyAcceptanceRequired: true }); return }
      set({ user: result.user, ...(result.loginState && revision === optionsRevision ? localState(result.loginState) : {}) })
      if (result.loginState) warnStorage(result.loginState)
    } catch (error) {
      if (auth !== authRevision) return
      set({ user: null, errorMessage: formatAuthErrorMessage(error, 'Đăng nhập thất bại.'),
        ...(get().rememberedLogin?.source === 'recovery' ? { rememberedLogin: null } : {}) })
      throw error
    } finally { set({ loggingIn: false }) }
  },

  acceptPolicyAndLogin: async () => {
    if (get().acceptingPolicy) return
    const auth = ++authRevision
    const revision = optionsRevision
    set({ acceptingPolicy: true, errorMessage: null })
    try {
      const result = await window.electronAPI.acceptPolicyAndLogin()
      if (auth !== authRevision) return
      if (result.status !== 'authenticated') return
      set({ user: result.user, policyAcceptanceRequired: false, ...(result.loginState && revision === optionsRevision ? localState(result.loginState) : {}) })
      if (result.loginState) warnStorage(result.loginState)
    } catch (error) {
      if (auth === authRevision) set({ errorMessage: formatAuthErrorMessage(error, 'Không thể xác nhận chính sách.') })
    }
    finally { set({ acceptingPolicy: false }) }
  },
  cancelPolicyAcceptance: () => {
    get().cancelPendingLogin()
    set({ acceptingPolicy: false, policyAcceptanceRequired: false, errorMessage: null })
  },
  cancelPendingLogin: () => {
    authRevision++
    void window.electronAPI?.cancelPendingLogin()
    if (get().rememberedLogin?.source === 'recovery') set({ rememberedLogin: null })
  },
  recoverDeviceCredentials: async () => {
    if (get().recoveringCredentials || get().loggingIn) return
    const auth = ++authRevision
    const revision = optionsRevision
    set({ recoveringCredentials: true, errorMessage: null, rememberedLogin: null })
    try {
      const state = await window.electronAPI.recoverDeviceCredentials()
      if (auth !== authRevision || revision !== optionsRevision) return
      set(localState(state)); warnStorage(state)
      if (!state.rememberedLogin) set({ errorMessage: 'Không tìm thấy thông tin đăng nhập cho máy này. Vui lòng nhập thông tin tài khoản.' })
    } catch (error) {
      if (auth === authRevision && revision === optionsRevision) set({ errorMessage: formatAuthErrorMessage(error, 'Không lấy được thông tin đăng nhập.') })
    }
    finally { set({ recoveringCredentials: false }) }
  },
  logout: async () => {
    authRevision++
    try { await window.electronAPI.logout() } catch { /* cleanup is best effort */ }
    set({ user: null, acceptingPolicy: false, policyAcceptanceRequired: false, errorMessage: null,
      ...(get().rememberedLogin?.source === 'recovery' ? { rememberedLogin: null } : {}) })
  },
  resetDeviceLock: async () => {
    set({ resettingDevice: true })
    try {
      const result = await window.electronAPI.resetDeviceLock()
      if (result.success) {
        const state = await window.electronAPI.bootstrapAuth()
        set(localState(state)); warnStorage(state)
      }
      return result
    } finally { set({ resettingDevice: false }) }
  },
  resetDeviceLockByUsername: async (username) => {
    set({ resettingDevice: true, errorMessage: null })
    try { return await window.electronAPI.resetDeviceLockByUsername(username) }
    catch (error) { throw new Error(formatAuthErrorMessage(error, 'Đổi máy tính thất bại.')) }
    finally { set({ resettingDevice: false }) }
  },
  changePassword: async (oldPassword, newPassword) => {
    const result = await window.electronAPI.changePassword(oldPassword, newPassword)
    if (result.loginState) { set(localState(result.loginState)); warnStorage(result.loginState) }
  },

  updateUseTestWorkflow: async (useTestWorkflow) => {
    if (!window.electronAPI) throw new Error('API not available')
    const user = await window.electronAPI.updateUseTestWorkflow(useTestWorkflow)
    set({ user })
  },

  rehydrateFromStorage: async () => {
    clearLegacyAuthStorage()
    const revision = optionsRevision
    const auth = authRevision
    try {
      const state = await window.electronAPI.bootstrapAuth()
      if (auth !== authRevision) { set({ initializing: false }); return }
      const local = revision === optionsRevision ? localState(state) : {}
      set({ ...local, user: state.user, initializing: false, policyAcceptanceRequired: !!state.policyAcceptanceRequired,
        errorMessage: state.errorMessage ? formatAuthErrorMessage(state.errorMessage, 'Không thể đăng nhập tự động.') : null })
      warnStorage(state)
    } catch (error) {
      if (auth !== authRevision) { set({ initializing: false }); return }
      set({ user: null, initializing: false, errorMessage: formatAuthErrorMessage(error, 'Không thể tải thông tin đăng nhập. Vui lòng đăng nhập thủ công.') })
    }
  },

  handleSessionExpired: (message) => {
    get().cancelPendingLogin()
    set({ user: null, loggingIn: false, acceptingPolicy: false, policyAcceptanceRequired: false, initializing: false,
      errorMessage: formatAuthErrorMessage(message || 'Tài khoản của bạn đã hết hạn', 'Tài khoản của bạn đã hết hạn') })
  },

  handleUserUpdated: (user) => set((state) => ({
    // Server/Web runtime ownership is a startup invariant. Main preserves a
    // pending Web-mode switch while still allowing package add/remove/expiry
    // to refresh the compatible QR capability.
    user: state.user && state.user.staffId === user.staffId
      ? {
          ...user,
          isZaloServer: state.user.isZaloServer,
          isZaloShowWeb: state.user.isZaloShowWeb,
          zaloAccountCapabilities: user.zaloAccountCapabilities || state.user.zaloAccountCapabilities
        }
      : user,
    errorMessage: null
  })),

  handleZaloRuntimeRestartRequired: (payload) => set((state) => ({
    zaloRuntimeRestartRequired: state.zaloRuntimeRestartRequired || payload
  })),

  clearError: () => set({ errorMessage: null })
}))
