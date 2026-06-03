import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AuthUser } from '../../../shared/types'

interface AuthState {
  user: AuthUser | null
  initializing: boolean
  loggingIn: boolean
  errorMessage: string | null
  loginOptions: LoginOptions
  savedCredentials: PersistedCreds | null

  setLoginOptions: (updates: Partial<LoginOptions>) => void
  login: (username: string, password: string, options?: LoginOptions) => Promise<void>
  logout: () => Promise<void>
  resetDeviceLock: () => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
  updateUseTestWorkflow: (useTestWorkflow: boolean) => Promise<void>
  rehydrateFromStorage: () => Promise<void>
  clearError: () => void
}

interface PersistedCreds {
  username: string
  password: string
}

export interface LoginOptions {
  rememberLogin: boolean
  autoLogin: boolean
}

const CREDS_KEY = 'aka-biz-auth-creds'
const USER_STATE_KEY = 'aka-biz-auth-user'
const LOGIN_OPTIONS_KEY = 'aka-biz-login-options'
const DEFAULT_LOGIN_OPTIONS: LoginOptions = {
  rememberLogin: true,
  autoLogin: true
}

function normalizeLoginOptions(options: LoginOptions): LoginOptions {
  if (options.autoLogin) {
    return { rememberLogin: true, autoLogin: true }
  }
  if (!options.rememberLogin) {
    return { rememberLogin: false, autoLogin: false }
  }
  return { rememberLogin: true, autoLogin: false }
}

function readLoginOptions(): LoginOptions {
  try {
    const raw = localStorage.getItem(LOGIN_OPTIONS_KEY)
    if (!raw) return DEFAULT_LOGIN_OPTIONS
    return normalizeLoginOptions({
      ...DEFAULT_LOGIN_OPTIONS,
      ...(JSON.parse(raw) as Partial<LoginOptions>)
    })
  } catch {
    return DEFAULT_LOGIN_OPTIONS
  }
}

function writeLoginOptions(options: LoginOptions): void {
  localStorage.setItem(LOGIN_OPTIONS_KEY, JSON.stringify(normalizeLoginOptions(options)))
}

function readStoredCreds(): PersistedCreds | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedCreds
  } catch {
    return null
  }
}

function writeStoredCreds(creds: PersistedCreds | null): void {
  if (!creds) {
    localStorage.removeItem(CREDS_KEY)
    return
  }
  localStorage.setItem(CREDS_KEY, JSON.stringify(creds))
}

function clearStoredUserState(): void {
  try {
    localStorage.removeItem(USER_STATE_KEY)
  } catch {
    // ignore storage failures
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      initializing: true,
      loggingIn: false,
      errorMessage: null,
      loginOptions: readLoginOptions(),
      savedCredentials: readStoredCreds(),

      setLoginOptions: (updates) => set((state) => {
        const mergedOptions = { ...state.loginOptions, ...updates }
        if (updates.rememberLogin === false) mergedOptions.autoLogin = false
        if (updates.autoLogin === true) mergedOptions.rememberLogin = true
        const nextOptions = normalizeLoginOptions(mergedOptions)
        writeLoginOptions(nextOptions)
        if (!nextOptions.rememberLogin) {
          writeStoredCreds(null)
          return { loginOptions: nextOptions, savedCredentials: null }
        }
        return { loginOptions: nextOptions }
      }),

      login: async (username, password, options) => {
        if (!window.electronAPI) throw new Error('API not available')
        const loginOptions = normalizeLoginOptions(options || useAuthStore.getState().loginOptions)
        writeLoginOptions(loginOptions)
        set({ loggingIn: true, errorMessage: null })
        try {
          const user = await window.electronAPI.login(username, password)
          const savedCredentials = loginOptions.rememberLogin ? { username, password } : null
          writeStoredCreds(savedCredentials)
          if (!savedCredentials) clearStoredUserState()
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

      logout: async () => {
        if (window.electronAPI) {
          try { await window.electronAPI.logout() } catch { /* ignore */ }
        }
        set({ user: null, errorMessage: null })
      },

      resetDeviceLock: async () => {
        if (!window.electronAPI) throw new Error('API not available')
        await window.electronAPI.resetDeviceLock()
        writeStoredCreds(null)
        clearStoredUserState()
        set({ savedCredentials: null })
      },

      changePassword: async (oldPassword, newPassword) => {
        if (!window.electronAPI) throw new Error('API not available')
        await window.electronAPI.changePassword(oldPassword, newPassword)
        const { savedCredentials, user } = useAuthStore.getState()
        if (!savedCredentials || !user || savedCredentials.username !== user.username) return

        const nextCredentials = { ...savedCredentials, password: newPassword }
        writeStoredCreds(nextCredentials)
        set({ savedCredentials: nextCredentials })
      },

      updateUseTestWorkflow: async (useTestWorkflow) => {
        if (!window.electronAPI) throw new Error('API not available')
        const user = await window.electronAPI.updateUseTestWorkflow(useTestWorkflow)
        set({ user })
      },

      rehydrateFromStorage: async () => {
        if (!window.electronAPI) {
          set({ initializing: false })
          return
        }
        const loginOptions = readLoginOptions()
        let creds = readStoredCreds()
        if (!loginOptions.rememberLogin && creds) {
          writeStoredCreds(null)
          creds = null
        }
        if (!creds) {
          set({
            user: null,
            initializing: false,
            loginOptions,
            savedCredentials: null
          })
          return
        }
        if (!loginOptions.autoLogin) {
          set({
            user: null,
            initializing: false,
            errorMessage: null,
            loginOptions,
            savedCredentials: creds
          })
          return
        }
        try {
          const user = await window.electronAPI.login(creds.username, creds.password)
          set({
            user,
            initializing: false,
            errorMessage: null,
            loginOptions,
            savedCredentials: creds
          })
        } catch (err: any) {
          set({
            user: null,
            initializing: false,
            errorMessage: err?.message || 'Đăng nhập tự động thất bại',
            loginOptions,
            savedCredentials: creds
          })
        }
      },

      clearError: () => set({ errorMessage: null })
    }),
    {
      name: USER_STATE_KEY,
      partialize: (state) => ({ user: state.user })
    }
  )
)
