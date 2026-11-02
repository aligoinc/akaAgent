import { ipcRenderer } from 'electron'
import type { AppAccessAPI } from '../shared/appAccess'
export const appAccessAPI: AppAccessAPI = {
  snapshot: (accountIds = []) => ipcRenderer.invoke('app-access:invoke', 'snapshot', accountIds),
  set: input => ipcRenderer.invoke('app-access:invoke', 'set', input)
}
