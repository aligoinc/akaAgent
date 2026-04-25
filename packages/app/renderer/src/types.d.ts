import type { ProgressEvent, RunResult, BlockManifest } from '@akabiz/engine'
import type { WorkflowListItem, RunListItem, ChannelListItem } from '../../shared/ipcChannels'

export interface WorkflowGraph {
  nodes: Array<{
    id: string
    manifestId: string
    position: { x: number; y: number }
    config: Record<string, unknown>
    inputMapping: Record<string, { sourceNodeId: string; sourceField: string; sourcePath?: string }>
    [key: string]: unknown
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
  variables?: unknown[]
  inputSchema?: unknown[]
  outputSchema?: unknown[]
}

declare global {
  interface Window {
    akabiz: {
      workflows: {
        list: () => Promise<WorkflowListItem[]>
        get: (id: string, version?: number) => Promise<{ workflow: Record<string, unknown>; revision: { graph: WorkflowGraph; version: number } }>
        save: (args: { id: string; name: string; description?: string | null; isBlock?: boolean; graph: WorkflowGraph; bumpVersion?: boolean }) => Promise<{ id: string; version: number }>
        create: (args: { name: string; description?: string }) => Promise<{ id: string }>
        delete: (id: string) => Promise<{ ok: boolean }>
      }
      runs: {
        enqueue: (args: { workflowId: string; channelId?: string; input: Record<string, unknown>; workflowVersion?: number }) => Promise<RunResult>
        list: (opts?: { workflowId?: string; limit?: number }) => Promise<RunListItem[]>
        getSteps: (runId: string) => Promise<Array<Record<string, unknown>>>
      }
      channels: {
        list: () => Promise<ChannelListItem[]>
        register: (channelId: string) => Promise<{ ok: boolean }>
      }
      blocks: {
        list: () => Promise<BlockManifest[]>
      }
      onProgress: (cb: (event: ProgressEvent) => void) => () => void
    }
  }
}

export {}
