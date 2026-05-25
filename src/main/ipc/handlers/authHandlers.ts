import { ipcMain } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { changePassword, login as loginQuery, resetDeviceLock } from '../../data/repositories/authRepository'
import { setCurrentUser, getCurrentUser } from '../../data/currentUser'

interface AuthLifecycleHooks {
  afterLogin?: () => Promise<void> | void
  beforeLogout?: () => Promise<void> | void
}

export function registerAuthHandlers(hooks: AuthLifecycleHooks = {}): void {
  ipcMain.handle(IPC_EVENTS.AUTH_LOGIN, async (_, username: string, password: string) => {
    const user = await loginQuery(username, password)
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
}
