import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { ZALO_SERVER_IPC } from '../../shared/zaloServerProtocol'
import type { ZaloServerRuntimeEvent, ZaloServerSnapshot } from '../../shared/zaloServerProtocol'
import type { ZaloServerAdminBridge } from './types'

const bridge: ZaloServerAdminBridge = {
  getSnapshot: () => ipcRenderer.invoke(ZALO_SERVER_IPC.GET_SNAPSHOT),

  onRuntimeEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: ZaloServerRuntimeEvent): void => {
      listener(payload)
    }
    ipcRenderer.on(ZALO_SERVER_IPC.RUNTIME_EVENT, handler)
    return () => ipcRenderer.removeListener(ZALO_SERVER_IPC.RUNTIME_EVENT, handler)
  },

  onSnapshotUpdated: (listener) => {
    const handler = (_event: IpcRendererEvent, payload?: ZaloServerSnapshot): void => {
      listener(payload)
    }
    ipcRenderer.on(ZALO_SERVER_IPC.SNAPSHOT_UPDATED, handler)
    return () => ipcRenderer.removeListener(ZALO_SERVER_IPC.SNAPSHOT_UPDATED, handler)
  }
}

contextBridge.exposeInMainWorld('zaloServerAdmin', bridge)
