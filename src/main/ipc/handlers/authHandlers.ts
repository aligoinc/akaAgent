import { app, ipcMain } from 'electron'
import { AuthUser, IPC_EVENTS, LoginPreferences } from '../../../shared/types'
import {
  changePassword,
  loadLoginSettingsForCurrentDevice,
  login as loginQuery,
  normalizeLoginPreferences,
  recoverDeviceCredentials,
  resetDeviceLock,
  revokeRememberedLoginForCurrentDevice,
  saveDeviceLoginSettings,
  updateLoginPreferencesForCurrentDevice,
  updateUseTestWorkflow
} from '../../data/repositories/authRepository'
import {
  getCurrentUser,
  getCurrentUserCredentials,
  setCurrentUser,
  setCurrentUserCredentials
} from '../../data/currentUser'

export interface AuthLoginContext {
  user: AuthUser
  username: string
  password: string
  automatic: boolean
}

interface AuthLifecycleHooks {
  afterLogin?: (context: AuthLoginContext) => Promise<void> | void
  beforeLogout?: () => Promise<void> | void
  afterPasswordChange?: (context: { oldPassword: string; newPassword: string }) => Promise<void> | void
}

function syncStartupSetting(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled })
  } catch (err) {
    console.error('Failed to sync startup setting:', err)
  }
}

export function registerAuthHandlers(hooks: AuthLifecycleHooks = {}): void {
  ipcMain.handle(IPC_EVENTS.AUTH_BOOTSTRAP, async () => {
    const snapshot = await loadLoginSettingsForCurrentDevice()
    syncStartupSetting(snapshot.loginOptions.startupEnabled)

    if (!snapshot.loginOptions.autoLogin || !snapshot.savedCredentials) {
      return snapshot
    }

    try {
      const user = await loginQuery(snapshot.savedCredentials.username, snapshot.savedCredentials.password)
      const savedOptions = await saveDeviceLoginSettings(user, snapshot.loginOptions)
      syncStartupSetting(savedOptions.startupEnabled)
      setCurrentUser(user)
      setCurrentUserCredentials({
        username: snapshot.savedCredentials.username,
        password: snapshot.savedCredentials.password
      })
      if (hooks.afterLogin) {
        await hooks.afterLogin({
          user,
          username: snapshot.savedCredentials.username,
          password: snapshot.savedCredentials.password,
          automatic: true
        })
      }
      return {
        ...snapshot,
        user,
        loginOptions: savedOptions,
        errorMessage: null
      }
    } catch (err: any) {
      setCurrentUserCredentials(null)
      setCurrentUser(null)
      return {
        ...snapshot,
        user: null,
        errorMessage: err?.message || 'Đăng nhập tự động thất bại'
      }
    }
  })

  ipcMain.handle(IPC_EVENTS.AUTH_LOGIN, async (_, username: string, password: string, options?: Partial<LoginPreferences>) => {
    const loginOptions = normalizeLoginPreferences(options)
    const user = await loginQuery(username, password)
    const savedOptions = await saveDeviceLoginSettings(user, loginOptions)
    syncStartupSetting(savedOptions.startupEnabled)
    setCurrentUser(user)
    setCurrentUserCredentials({ username, password })
    try {
      if (hooks.afterLogin) {
        await hooks.afterLogin({ user, username, password, automatic: false })
      }
    } catch (err) {
      setCurrentUserCredentials(null)
      setCurrentUser(null)
      throw err
    }
    return user
  })

  ipcMain.handle(IPC_EVENTS.AUTH_REVOKE_REMEMBERED_LOGIN, async () => {
    const snapshot = await revokeRememberedLoginForCurrentDevice()
    syncStartupSetting(snapshot.loginOptions.startupEnabled)
    return snapshot
  })

  ipcMain.handle(IPC_EVENTS.AUTH_UPDATE_LOGIN_PREFERENCES, async (_, updates: Partial<LoginPreferences>) => {
    const snapshot = await updateLoginPreferencesForCurrentDevice(updates || {})
    syncStartupSetting(snapshot.loginOptions.startupEnabled)
    return snapshot
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RECOVER_DEVICE_CREDENTIALS, async () => {
    return recoverDeviceCredentials()
  })

  ipcMain.handle(IPC_EVENTS.AUTH_LOGOUT, async () => {
    if (hooks.beforeLogout) {
      try {
        await hooks.beforeLogout()
      } catch (err) {
        console.error('Pre-logout hook failed:', err)
      }
    }
    setCurrentUserCredentials(null)
    setCurrentUser(null)
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.AUTH_ME, async () => {
    return getCurrentUser()
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RESET_DEVICE_LOCK, async () => {
    const user = getCurrentUser()
    if (!user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi đổi máy tính.')
    return resetDeviceLock(user)
  })

  ipcMain.handle(IPC_EVENTS.AUTH_CHANGE_PASSWORD, async (_, oldPassword: string, newPassword: string) => {
    const user = getCurrentUser()
    if (!user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi đổi mật khẩu.')
    const result = await changePassword(user, oldPassword, newPassword)
    const credentials = getCurrentUserCredentials()
    setCurrentUserCredentials({
      username: credentials?.username || user.username,
      password: newPassword
    })
    await hooks.afterPasswordChange?.({ oldPassword, newPassword })
    return result
  })

  ipcMain.handle(IPC_EVENTS.AUTH_UPDATE_USE_TEST_WORKFLOW, async (_, useTestWorkflow: boolean) => {
    const user = getCurrentUser()
    if (!user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi đổi chế độ workflow test.')
    const updatedUser = await updateUseTestWorkflow(user, !!useTestWorkflow)
    setCurrentUser(updatedUser)
    return updatedUser
  })
}
