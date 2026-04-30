import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { login as loginQuery } from '../../data/repositories/authRepository'
import { setCurrentUser, getCurrentUser } from '../../data/currentUser'

export function registerAuthHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_, username: string, password: string) => {
    const user = await loginQuery(username, password)
    setCurrentUser(user)
    return user
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    setCurrentUser(null)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_ME, async () => {
    return getCurrentUser()
  })
}
