import { ipcMain } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { login as loginQuery, resetDeviceLock } from '../../data/repositories/authRepository'
import { setCurrentUser, getCurrentUser } from '../../data/currentUser'

export function registerAuthHandlers(afterLogin?: () => Promise<void>): void {
  ipcMain.handle(IPC_EVENTS.AUTH_LOGIN, async (_, username: string, password: string) => {
    const user = await loginQuery(username, password)
    setCurrentUser(user)
    if (afterLogin) {
      try {
        await afterLogin()
      } catch (err) {
        console.error('Post-login maintenance failed:', err)
      }
    }
    return user
  })

  ipcMain.handle(IPC_EVENTS.AUTH_LOGOUT, async () => {
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
}
