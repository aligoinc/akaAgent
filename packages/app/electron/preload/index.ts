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
  selectors: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SELECTOR_LIST),
    getByName: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.SELECTOR_GET_BY_NAME, name),
    save: (args: {
      id?: string
      name: string
      domain?: string | null
      description?: string | null
      selectorType: 'css' | 'xpath' | 'text-match'
      expression: string
      fallbacks?: Array<{ type: string; expression: string }>
    }) => ipcRenderer.invoke(IPC_CHANNELS.SELECTOR_SAVE, args),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SELECTOR_DELETE, id)
  },
  picker: {
    start: (args: { channelId: string; url?: string }) => ipcRenderer.invoke(IPC_CHANNELS.PICKER_START, args),
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.PICKER_CANCEL)
  },
  datatables: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.DATATABLE_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DATATABLE_GET, id),
    save: (args: { id?: string; name: string; description?: string | null; schema: unknown[] }) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATATABLE_SAVE, args),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DATATABLE_DELETE, id),
    rowsList: (args: { datatableId: string; status?: string; limit?: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATATABLE_ROWS_LIST, args),
    rowSave: (args: { id?: string; datatableId: string; data: Record<string, unknown>; status?: string; tags?: string[] }) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATATABLE_ROW_SAVE, args),
    rowDelete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DATATABLE_ROW_DELETE, id),
    rowReset: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DATATABLE_ROW_RESET, id)
  },
  triggers: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_LIST),
    save: (args: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_SAVE, args),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_DELETE, id),
    runNow: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_RUN_NOW, id)
  },
  connections: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_LIST),
    save: (args: { id?: string; name: string; conn_type: string; secrets: Record<string, string>; scope?: Record<string, unknown> | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_SAVE, args),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_DELETE, id)
  },
  campaignViews: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.CAMPAIGNVIEW_LIST),
    save: (args: { id?: string; name: string; description?: string | null; workflow_id?: string | null; trigger_id?: string | null; datatable_id?: string | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CAMPAIGNVIEW_SAVE, args),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CAMPAIGNVIEW_DELETE, id)
  },
  channelsAdmin: {
    save: (args: { id?: string; name: string; channel_type: string; profile_path?: string | null; user_agent?: string | null; locale?: string | null; timezone?: string | null; proxy_url?: string | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHANNEL_SAVE, args),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CHANNEL_DELETE, id)
  },
  campaignLogs: {
    list: (opts?: { campaignViewId?: string; workflowId?: string; runId?: string; datatableRowId?: string; limit?: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CAMPAIGNLOG_LIST, opts ?? {})
  },
  customBlocks: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.CUSTOMBLOCK_LIST),
    save: (args: {
      manifest_id: string
      name: string
      version: string
      kind: 'code' | 'composite'
      runtime: 'control' | 'page' | 'node' | 'composite'
      requires: 'browser' | 'none'
      manifest: Record<string, unknown>
      code?: string | null
      workflow_ref?: string | null
      source?: string
    }) => ipcRenderer.invoke(IPC_CHANNELS.CUSTOMBLOCK_SAVE, args),
    delete: (manifestId: string) => ipcRenderer.invoke(IPC_CHANNELS.CUSTOMBLOCK_DELETE, manifestId)
  },
  onProgress: (cb: (event: ProgressEvent) => void) => {
    const handler = (_e: unknown, event: ProgressEvent): void => cb(event)
    ipcRenderer.on(IPC_CHANNELS.RUN_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.RUN_PROGRESS, handler)
  }
}

contextBridge.exposeInMainWorld('akabiz', api)

export type AkabizAPI = typeof api
