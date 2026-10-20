import { ipcRenderer } from 'electron'
import { GROUP_SHARING_IPC, type GroupSharingApi } from '../shared/groupSharing'
export const groupSharingAPI: GroupSharingApi = {
  staff: () => ipcRenderer.invoke(GROUP_SHARING_IPC, 'staff'),
  get: (kind, groupId) => ipcRenderer.invoke(GROUP_SHARING_IPC, 'get', { kind, groupId }),
  save: input => ipcRenderer.invoke(GROUP_SHARING_IPC, 'save', input),
  copy: input => ipcRenderer.invoke(GROUP_SHARING_IPC, 'copy', input)
}
