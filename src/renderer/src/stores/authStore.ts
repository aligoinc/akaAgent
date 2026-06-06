import { create } from 'zustand'
import { AuthUser, LoginPreferences, SavedLoginCredentials } from '../../../shared/types'

interface AuthState {
  user: AuthUser | null
  initializing: boolean
  loggingIn: boolean
  recoveringCredentials: boolean
  errorMessage: string | null
  loginOptions: LoginPreferences
  savedCredentials: SavedLoginCredentials | null

  setLoginOptions: (updates: Partial<LoginPreferences>) => Promise<void>
  login: (username: string, password: string, options?: LoginPreferences) => Promise<void>
  recoverDeviceCredentials: () => Promise<void>
  logout: () => Promise<void>
  resetDeviceLock: () => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
  updateUseTestWorkflow: (useTestWorkflow: boolean) => Promise<void>
  rehydrateFromStorage: () => Promise<void>
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

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  initializing: true,
  loggingIn: false,
  recoveringCredentials: false,
  errorMessage: null,
  loginOptions: DEFAULT_LOGIN_OPTIONS,
  savedCredentials: null,

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
        errorMessage: err?.message || 'Không thể tắt ghi nhớ đăng nhập'
      })
    }
  },

  login: async (username, password, options) => {
    if (!window.electronAPI) throw new Error('API not available')
    const loginOptions = normalizeLoginOptions(options || useAuthStore.getState().loginOptions)
    set({ loggingIn: true, errorMessage: null })
    try {
      const user = await window.electronAPI.login(username, password, loginOptions)
      const savedCredentials = loginOptions.rememberLogin ? { username, password } : null
      set({
        user,
        loggingIn: false,
        errorMessage: null,
        loginOptions,
        savedCredentials
      })
    } catch (err: any) {
      set({
        user: null,
        loggingIn: false,
        errorMessage: err?.message || 'Đăng nhập thất bại',
        loginOptions
      })
      throw err
    }
  },

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
        errorMessage: err?.message || 'Không thể lấy lại tên đăng nhập'
      })
    }
  },

  logout: async () => {
    if (window.electronAPI) {
      try { await window.electronAPI.logout() } catch { /* ignore */ }
    }
    set({ user: null, errorMessage: null })
  },

  resetDeviceLock: async () => {
    if (!window.electronAPI) throw new Error('API not available')
    await window.electronAPI.resetDeviceLock()
    const currentOptions = useAuthStore.getState().loginOptions
    set({
      savedCredentials: null,
      loginOptions: normalizeLoginOptions({
        ...currentOptions,
        rememberLogin: false,
        autoLogin: false
      }),
      errorMessage: null
    })
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
      set({
        user: snapshot.user,
        initializing: false,
        errorMessage: snapshot.errorMessage || null,
        loginOptions: snapshot.loginOptions,
        savedCredentials: snapshot.savedCredentials
      })
    } catch (err: any) {
      set({
        user: null,
        initializing: false,
        errorMessage: err?.message || 'Không thể tải tuỳ chọn đăng nhập',
        loginOptions: DEFAULT_LOGIN_OPTIONS,
        savedCredentials: null
      })
    }
  },

  clearError: () => set({ errorMessage: null })
}))
