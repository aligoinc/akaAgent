import type { ProgressEvent, RunResult } from '@akabiz/engine'
import type { WorkflowListItem, RunListItem, ChannelListItem } from '../../shared/ipcChannels'

declare global {
  interface Window {
    akabiz: {
      workflows: {
        list: () => Promise<WorkflowListItem[]>
        get: (id: string, version?: number) => Promise<{ workflow: Record<string, unknown>; revision: { graph: unknown; version: number } }>
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
        list: () => Promise<unknown[]>
      }
      onProgress: (cb: (event: ProgressEvent) => void) => () => void
    }
  }
}

export {}
