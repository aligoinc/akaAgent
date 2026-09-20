import { contextBridge, ipcRenderer } from 'electron'
import { adminAPI } from '../src/preload/adminBridge'
import { IPC_EVENTS } from '../src/shared/types'
contextBridge.exposeInMainWorld('electronAPI', {
  admin: adminAPI,
  onAuthUserUpdated: (callback: (value: unknown) => void) => {
    const handler = (_: unknown, user: unknown) => callback(user)
    ipcRenderer.on(IPC_EVENTS.AUTH_USER_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.AUTH_USER_UPDATED, handler)
  }
})
