import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipcChannels.js'
import type { ProgressEvent, RunResult } from '@akabiz/engine'

const api = {
  workflows: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_LIST),
    get: (id: string, version?: number) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_GET, id, version),
    save: (args: { id: string; name: string; description?: string | null; isBlock?: boolean; graph: { nodes: unknown[]; edges: unknown[]; variables?: unknown[]; inputSchema?: unknown[]; outputSchema?: unknown[] }; bumpVersion?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_SAVE, args),
    create: (args: { name: string; description?: string }) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_CREATE, args),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_DELETE, id)
  },
  runs: {
    enqueue: (args: { workflowId: string; channelId?: string; input: Record<string, unknown>; workflowVersion?: number }): Promise<RunResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.RUN_ENQUEUE, args),
    list: (opts?: { workflowId?: string; limit?: number }) => ipcRenderer.invoke(IPC_CHANNELS.RUN_LIST, opts ?? {}),
    getSteps: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.RUN_GET_STEPS, runId)
  },
  channels: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.CHANNEL_LIST),
    register: (channelId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHANNEL_REGISTER, channelId)
  },
  blocks: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.BLOCK_LIST)
  },
  onProgress: (cb: (event: ProgressEvent) => void) => {
    const handler = (_e: unknown, event: ProgressEvent): void => cb(event)
    ipcRenderer.on(IPC_CHANNELS.RUN_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.RUN_PROGRESS, handler)
  }
}

contextBridge.exposeInMainWorld('akabiz', api)

export type AkabizAPI = typeof api
