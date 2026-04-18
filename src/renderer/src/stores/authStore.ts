import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AuthUser } from '../../../shared/types'

interface AuthState {
  user: AuthUser | null
  initializing: boolean
  loggingIn: boolean
  errorMessage: string | null

  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  rehydrateFromStorage: () => Promise<void>
  clearError: () => void
}

interface PersistedCreds {
  username: string
  password: string
}

const CREDS_KEY = 'aka-biz-auth-creds'

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

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      initializing: true,
      loggingIn: false,
      errorMessage: null,

      login: async (username, password) => {
        if (!window.electronAPI) throw new Error('API not available')
        set({ loggingIn: true, errorMessage: null })
        try {
          const user = await window.electronAPI.login(username, password)
          writeStoredCreds({ username, password })
          set({ user, loggingIn: false, errorMessage: null })
        } catch (err: any) {
          writeStoredCreds(null)
          set({ user: null, loggingIn: false, errorMessage: err?.message || 'Đăng nhập thất bại' })
          throw err
        }
      },

      logout: async () => {
        if (window.electronAPI) {
          try { await window.electronAPI.logout() } catch { /* ignore */ }
        }
        writeStoredCreds(null)
        set({ user: null, errorMessage: null })
      },

      rehydrateFromStorage: async () => {
        if (!window.electronAPI) {
          set({ initializing: false })
          return
        }
        const creds = readStoredCreds()
        if (!creds) {
          set({ initializing: false })
          return
        }
        try {
          const user = await window.electronAPI.login(creds.username, creds.password)
          set({ user, initializing: false, errorMessage: null })
        } catch {
          writeStoredCreds(null)
          set({ user: null, initializing: false })
        }
      },

      clearError: () => set({ errorMessage: null })
    }),
    {
      name: 'aka-biz-auth-user',
      partialize: (state) => ({ user: state.user })
    }
  )
)
