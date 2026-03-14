import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, FlowData, ExecutionStep, ActionDefinition } from '../shared/types'

export type ElectronAPI = typeof electronAPI

const electronAPI = {
  // Actions
  listActions: (): Promise<ActionDefinition[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.ACTIONS_LIST),

  // Browser
  launchBrowser: (options?: { headless?: boolean }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_LAUNCH, options),

  closeBrowser: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLOSE),

  getBrowserStatus: (): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_STATUS),

  // Flow execution
  runFlow: (flowData: FlowData): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLOW_RUN, flowData),

  stopFlow: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLOW_STOP),

  onFlowProgress: (callback: (step: ExecutionStep) => void): () => void => {
    const handler = (_event: Electron.IpcRendererEvent, step: ExecutionStep) => callback(step)
    ipcRenderer.on(IPC_CHANNELS.FLOW_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FLOW_PROGRESS, handler)
  },

  // Database
  saveFlow: (flowData: FlowData): Promise<FlowData> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_SAVE_FLOW, flowData),

  loadFlow: (flowId: string): Promise<FlowData | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LOAD_FLOW, flowId),

  listFlows: (): Promise<FlowData[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_FLOWS),

  deleteFlow: (flowId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_FLOW, flowId),

  saveRun: (runData: unknown): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_SAVE_RUN, runData),

  listRuns: (flowId?: string): Promise<import('../shared/types').ExecutionRun[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_RUNS, flowId),

  listRunSteps: (runId: string): Promise<ExecutionStep[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_RUN_STEPS, runId),

  // Elements
  saveElement: (elementData: Omit<import('../shared/types').ElementDefinition, 'createdAt' | 'updatedAt'>): Promise<import('../shared/types').ElementDefinition> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_SAVE_ELEMENT, elementData),

  listElements: (): Promise<import('../shared/types').ElementDefinition[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_LIST_ELEMENTS),

  deleteElement: (elementId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_ELEMENT, elementId),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
