import { create } from 'zustand'
import { AuthUser, DeviceLockResetResult, LoginPreferences, SavedLoginCredentials, ZaloRuntimeRestartRequiredPayload } from '../../../shared/types'

interface PendingPolicyLogin {
  credentials: SavedLoginCredentials
  options: LoginPreferences
}

interface AuthState {
  user: AuthUser | null
  initializing: boolean
  loggingIn: boolean
  acceptingPolicy: boolean
  recoveringCredentials: boolean
  resettingDevice: boolean
  policyAcceptanceRequired: boolean
  pendingPolicyLogin: PendingPolicyLogin | null
  errorMessage: string | null
  loginOptions: LoginPreferences
  savedCredentials: SavedLoginCredentials | null
  zaloRuntimeRestartRequired: ZaloRuntimeRestartRequiredPayload | null

  setLoginOptions: (updates: Partial<LoginPreferences>) => Promise<void>
  login: (username: string, password: string, options?: LoginPreferences) => Promise<void>
  acceptPolicyAndLogin: () => Promise<void>
  cancelPolicyAcceptance: () => void
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

  if (next.autoLogin) next.rememberLogin = true
  if (!next.rememberLogin) next.autoLogin = false
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

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  initializing: true,
  loggingIn: false,
  acceptingPolicy: false,
  recoveringCredentials: false,
  resettingDevice: false,
  policyAcceptanceRequired: false,
  pendingPolicyLogin: null,
  errorMessage: null,
  loginOptions: DEFAULT_LOGIN_OPTIONS,
  savedCredentials: null,
  zaloRuntimeRestartRequired: null,

  setLoginOptions: async (updates) => {
    const current = useAuthStore.getState()
    const nextOptions = normalizeLoginOptions({ ...current.loginOptions, ...updates })
    const shouldPersistDisabledOption = !!current.savedCredentials && (
      updates.rememberLogin === false ||
      updates.autoLogin === false ||
      updates.startupEnabled === false
    )

    set({
      loginOptions: nextOptions,
      savedCredentials: nextOptions.rememberLogin ? current.savedCredentials : null,
      errorMessage: null
    })

    if (!shouldPersistDisabledOption || !window.electronAPI?.updateLoginPreferences) return

    try {
      const snapshot = await window.electronAPI.updateLoginPreferences(nextOptions)
      set({
        loginOptions: snapshot.loginOptions,
        savedCredentials: snapshot.savedCredentials,
        errorMessage: null
      })
    } catch (err: any) {
      set({
        loginOptions: current.loginOptions,
        savedCredentials: current.savedCredentials,
        errorMessage: formatAuthErrorMessage(err, 'Không thể tắt ghi nhớ đăng nhập. Vui lòng thử lại sau.')
      })
    }
  },

  login: async (username, password, options) => {
    if (!window.electronAPI) throw new Error('API not available')
    const loginOptions = normalizeLoginOptions(options || useAuthStore.getState().loginOptions)
    set({
      loggingIn: true,
      policyAcceptanceRequired: false,
      pendingPolicyLogin: null,
      errorMessage: null
    })
    try {
      const result = await window.electronAPI.login(username, password, loginOptions)
      if (result.status === 'policy_required') {
        set({
          user: null,
          loggingIn: false,
          policyAcceptanceRequired: true,
          pendingPolicyLogin: {
            credentials: { username, password },
            options: loginOptions
          },
          errorMessage: null,
          loginOptions
        })
        return
      }

      const savedCredentials = loginOptions.rememberLogin ? { username, password } : null
      set({
        user: result.user,
        loggingIn: false,
        policyAcceptanceRequired: false,
        pendingPolicyLogin: null,
        errorMessage: null,
        loginOptions,
        savedCredentials
      })
    } catch (err: any) {
      set({
        user: null,
        loggingIn: false,
        policyAcceptanceRequired: false,
        pendingPolicyLogin: null,
        errorMessage: formatAuthErrorMessage(err, 'Đăng nhập thất bại. Vui lòng thử lại sau.'),
        loginOptions
      })
      throw err
    }
  },

  acceptPolicyAndLogin: async () => {
    if (!window.electronAPI?.acceptPolicyAndLogin) throw new Error('API not available')
    const pending = useAuthStore.getState().pendingPolicyLogin
    if (!pending) throw new Error('Không tìm thấy phiên đăng nhập đang chờ đồng ý chính sách.')

    set({ acceptingPolicy: true, errorMessage: null })
    try {
      const user = await window.electronAPI.acceptPolicyAndLogin(
        pending.credentials.username,
        pending.credentials.password,
        pending.options
      )
      set({
        user,
        acceptingPolicy: false,
        policyAcceptanceRequired: false,
        pendingPolicyLogin: null,
        errorMessage: null,
        loginOptions: pending.options,
        savedCredentials: pending.options.rememberLogin ? pending.credentials : null
      })
    } catch (err: any) {
      set({
        user: null,
        acceptingPolicy: false,
        policyAcceptanceRequired: true,
        errorMessage: formatAuthErrorMessage(err, 'Không thể ghi nhận đồng ý chính sách. Vui lòng thử lại sau.')
      })
      throw err
    }
  },

  cancelPolicyAcceptance: () => set({
    acceptingPolicy: false,
    policyAcceptanceRequired: false,
    pendingPolicyLogin: null,
    errorMessage: null
  }),

  recoverDeviceCredentials: async () => {
    if (!window.electronAPI?.recoverDeviceCredentials) throw new Error('API not available')
    set({ recoveringCredentials: true, errorMessage: null })
    try {
      const savedCredentials = await window.electronAPI.recoverDeviceCredentials()
      set({
        savedCredentials,
        recoveringCredentials: false,
        errorMessage: null
      })
    } catch (err: any) {
      set({
        recoveringCredentials: false,
        errorMessage: formatAuthErrorMessage(err, 'Không thể lấy lại tên đăng nhập. Vui lòng thử lại sau.')
      })
    }
  },

  logout: async () => {
    if (window.electronAPI) {
      try { await window.electronAPI.logout() } catch { /* ignore */ }
    }
    set({
      user: null,
      acceptingPolicy: false,
      policyAcceptanceRequired: false,
      pendingPolicyLogin: null,
      errorMessage: null
    })
  },

  resetDeviceLock: async () => {
    if (!window.electronAPI) throw new Error('API not available')
    set({ resettingDevice: true })
    try {
      const result = await window.electronAPI.resetDeviceLock()
      if (result.success) {
        const currentOptions = useAuthStore.getState().loginOptions
        set({
          savedCredentials: null,
          loginOptions: normalizeLoginOptions({ ...currentOptions, rememberLogin: false, autoLogin: false }),
          errorMessage: null
        })
      }
      return result
    } catch (error) {
      throw new Error(formatAuthErrorMessage(error, 'Đổi máy tính thất bại. Vui lòng thử lại sau.'))
    } finally {
      set({ resettingDevice: false })
    }
  },

  resetDeviceLockByUsername: async (username) => {
    if (!window.electronAPI) throw new Error('API not available')
    set({ resettingDevice: true, errorMessage: null })
    try {
      return await window.electronAPI.resetDeviceLockByUsername(username)
    } catch (error) {
      throw new Error(formatAuthErrorMessage(error, 'Đổi máy tính thất bại. Vui lòng thử lại sau.'))
    } finally {
      set({ resettingDevice: false })
    }
  },

  changePassword: async (oldPassword, newPassword) => {
    if (!window.electronAPI) throw new Error('API not available')
    await window.electronAPI.changePassword(oldPassword, newPassword)
    const { savedCredentials, user } = useAuthStore.getState()
    if (!savedCredentials || !user || savedCredentials.username !== user.username) return

    set({
      savedCredentials: {
        ...savedCredentials,
        password: newPassword
      }
    })
  },

  updateUseTestWorkflow: async (useTestWorkflow) => {
    if (!window.electronAPI) throw new Error('API not available')
    const user = await window.electronAPI.updateUseTestWorkflow(useTestWorkflow)
    set({ user })
  },

  rehydrateFromStorage: async () => {
    clearLegacyAuthStorage()

    if (!window.electronAPI?.bootstrapAuth) {
      set({ initializing: false })
      return
    }

    try {
      const snapshot = await window.electronAPI.bootstrapAuth()
      const bootstrapErrorMessage = snapshot.errorMessage
        ? formatAuthErrorMessage(snapshot.errorMessage, 'Không thể tải tuỳ chọn đăng nhập. Vui lòng thử lại sau.')
        : null

      set({
        user: snapshot.user,
        initializing: false,
        policyAcceptanceRequired: !!snapshot.policyAcceptanceRequired,
        pendingPolicyLogin: snapshot.policyAcceptanceRequired && snapshot.savedCredentials
          ? {
              credentials: snapshot.savedCredentials,
              options: snapshot.loginOptions
            }
          : null,
        errorMessage: bootstrapErrorMessage,
        loginOptions: snapshot.loginOptions,
        savedCredentials: snapshot.savedCredentials
      })
    } catch (err: any) {
      set({
        user: null,
        initializing: false,
        policyAcceptanceRequired: false,
        pendingPolicyLogin: null,
        errorMessage: formatAuthErrorMessage(err, 'Không thể tải tuỳ chọn đăng nhập. Vui lòng thử lại sau.'),
        loginOptions: DEFAULT_LOGIN_OPTIONS,
        savedCredentials: null
      })
    }
  },

  handleSessionExpired: (message) => set({
    user: null,
    loggingIn: false,
    acceptingPolicy: false,
    policyAcceptanceRequired: false,
    pendingPolicyLogin: null,
    initializing: false,
    errorMessage: formatAuthErrorMessage(message || 'Tài khoản của bạn đã hết hạn', 'Tài khoản của bạn đã hết hạn')
  }),

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
