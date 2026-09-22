import { contextBridge, ipcRenderer } from 'electron'
import { staffManagementAPI } from '../src/preload/staffManagementBridge'
import { IPC_EVENTS } from '../src/shared/types'
contextBridge.exposeInMainWorld('electronAPI', {
  staffManagement: staffManagementAPI,
  onAuthUserUpdated: (callback: (value: unknown)=>void) => { const listener=(_:unknown,user:unknown)=>callback(user); ipcRenderer.on(IPC_EVENTS.AUTH_USER_UPDATED,listener);return()=>ipcRenderer.removeListener(IPC_EVENTS.AUTH_USER_UPDATED,listener) }
})
