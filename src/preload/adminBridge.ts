import { ipcRenderer } from 'electron'
import { ADMIN_IPC, type AdminApi } from '../shared/admin'

export const adminAPI: AdminApi = {
  listDocs: () => ipcRenderer.invoke(ADMIN_IPC.docs, 'list'),
  saveDoc: input => ipcRenderer.invoke(ADMIN_IPC.docs, 'save', input),
  deleteDoc: (id, expectedVersion) => ipcRenderer.invoke(ADMIN_IPC.docs, 'delete', { id, expectedVersion }),
  prepareDoc: (id, requestId) => ipcRenderer.invoke(ADMIN_IPC.prepareDoc, id, requestId),
  closeDoc: requestId => ipcRenderer.invoke(ADMIN_IPC.closeDoc, requestId),
  openDocExternal: id => ipcRenderer.invoke(ADMIN_IPC.openDocExternal, id),
  getGlobalNotification: () => ipcRenderer.invoke(ADMIN_IPC.notifications, 'global'),
  listNotifications: cursor => ipcRenderer.invoke(ADMIN_IPC.notifications, 'list', { cursor }),
  searchStaff: search => ipcRenderer.invoke(ADMIN_IPC.notifications, 'search', { search }),
  saveNotification: input => ipcRenderer.invoke(ADMIN_IPC.notifications, 'save', input),
  listSettings: () => ipcRenderer.invoke(ADMIN_IPC.settings, 'list'),
  revealSetting: id => ipcRenderer.invoke(ADMIN_IPC.settings, 'reveal', { id }),
  saveSetting: input => ipcRenderer.invoke(ADMIN_IPC.settings, 'save', input),
  listCronJobs: () => ipcRenderer.invoke(ADMIN_IPC.cron, 'jobs'),
  listCronRuns: query => ipcRenderer.invoke(ADMIN_IPC.cron, 'runs', query),
  getCronRun: id => ipcRenderer.invoke(ADMIN_IPC.cron, 'detail', { id }),
  listTriggers: () => ipcRenderer.invoke(ADMIN_IPC.triggers, 'list'),
  getTrigger: id => ipcRenderer.invoke(ADMIN_IPC.triggers, 'detail', { id })
}
