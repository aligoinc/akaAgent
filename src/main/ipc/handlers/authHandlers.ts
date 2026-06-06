import { app, ipcMain } from 'electron'
import { IPC_EVENTS, LoginPreferences } from '../../../shared/types'
import {
  changePassword,
  loadLoginSettingsForCurrentDevice,
  login as loginQuery,
  normalizeLoginPreferences,
  resetDeviceLock,
  revokeRememberedLoginForCurrentDevice,
  saveDeviceLoginSettings,
  updateLoginPreferencesForCurrentDevice,
  updateUseTestWorkflow
} from '../../data/repositories/authRepository'
import { setCurrentUser, getCurrentUser } from '../../data/currentUser'

interface AuthLifecycleHooks {
  afterLogin?: () => Promise<void> | void
  beforeLogout?: () => Promise<void> | void
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
      if (hooks.afterLogin) {
        try {
          await hooks.afterLogin()
        } catch (err) {
          console.error('Post-login hook failed:', err)
        }
      }
      return {
        ...snapshot,
        user,
        loginOptions: savedOptions,
        errorMessage: null
      }
    } catch (err: any) {
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
    if (hooks.afterLogin) {
      try {
        await hooks.afterLogin()
      } catch (err) {
        console.error('Post-login hook failed:', err)
      }
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

  ipcMain.handle(IPC_EVENTS.AUTH_LOGOUT, async () => {
    if (hooks.beforeLogout) {
      try {
        await hooks.beforeLogout()
      } catch (err) {
        console.error('Pre-logout hook failed:', err)
      }
    }
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
    return changePassword(user, oldPassword, newPassword)
  })

  ipcMain.handle(IPC_EVENTS.AUTH_UPDATE_USE_TEST_WORKFLOW, async (_, useTestWorkflow: boolean) => {
    const user = getCurrentUser()
    if (!user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi đổi chế độ workflow test.')
    const updatedUser = await updateUseTestWorkflow(user, !!useTestWorkflow)
    setCurrentUser(updatedUser)
    return updatedUser
  })
}
