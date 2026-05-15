import { ipcMain } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { login as loginQuery } from '../../data/repositories/authRepository'
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
}
