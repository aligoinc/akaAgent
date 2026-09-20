import { ipcRenderer } from 'electron'
import { SHEET_SYNC_IPC, type DataGroupExternalSyncApi } from '../shared/googleSheetSync'

export const dataGroupExternalSyncAPI: DataGroupExternalSyncApi = {
  list: groupId => ipcRenderer.invoke(SHEET_SYNC_IPC, 'list', { groupId }),
  inspect: (groupId, url, hasHeader) => ipcRenderer.invoke(SHEET_SYNC_IPC, 'inspect', { groupId, url, hasHeader }),
  preview: (groupId, config, sourceId) => ipcRenderer.invoke(SHEET_SYNC_IPC, 'preview', { groupId, config, sourceId }),
  save: input => ipcRenderer.invoke(SHEET_SYNC_IPC, 'save', input),
  toggle: (groupId, id, expectedRevision, enabled) => ipcRenderer.invoke(SHEET_SYNC_IPC, 'toggle', { groupId, id, expectedRevision, enabled }),
  remove: (groupId, id, expectedRevision) => ipcRenderer.invoke(SHEET_SYNC_IPC, 'delete', { groupId, id, expectedRevision })
}
