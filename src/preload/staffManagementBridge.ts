import { ipcRenderer } from 'electron'
import { STAFF_MANAGEMENT_IPC, type StaffManagementApi } from '../shared/staffManagement'

export const staffManagementAPI: StaffManagementApi = {
  list: input => ipcRenderer.invoke(STAFF_MANAGEMENT_IPC, 'list', input),
  saveGroup: input => ipcRenderer.invoke(STAFF_MANAGEMENT_IPC, 'saveGroup', input),
  saveStaff: input => ipcRenderer.invoke(STAFF_MANAGEMENT_IPC, 'saveStaff', input),
  setStatus: input => ipcRenderer.invoke(STAFF_MANAGEMENT_IPC, 'setStatus', input),
  revealPassword: id => ipcRenderer.invoke(STAFF_MANAGEMENT_IPC, 'revealPassword', { id }),
  prepareDevices: ids => ipcRenderer.invoke(STAFF_MANAGEMENT_IPC, 'prepareDevices', { ids }),
  resetDevices: input => ipcRenderer.invoke(STAFF_MANAGEMENT_IPC, 'resetDevices', input)
}
