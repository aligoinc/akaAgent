import type { ProgressEvent, RunResult, BlockManifest } from '@akabiz/engine'
import type {
  WorkflowListItem, RunListItem, ChannelListItem, NamedSelectorRow, PickResult,
  DataTableRow, DataTableRowItem, TriggerRow, ConnectionRow, CampaignViewRow,
  CampaignLogItem
} from '../../shared/ipcChannels'

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
      selectors: {
        list: () => Promise<NamedSelectorRow[]>
        getByName: (name: string) => Promise<NamedSelectorRow | null>
        save: (args: {
          id?: string
          name: string
          domain?: string | null
          description?: string | null
          selectorType: 'css' | 'xpath' | 'text-match'
          expression: string
          fallbacks?: Array<{ type: string; expression: string }>
        }) => Promise<NamedSelectorRow>
        delete: (id: string) => Promise<{ ok: boolean }>
      }
      picker: {
        start: (args: { channelId: string; url?: string }) => Promise<PickResult | null>
        cancel: () => Promise<{ ok: boolean }>
      }
      datatables: {
        list: () => Promise<DataTableRow[]>
        get: (id: string) => Promise<DataTableRow | null>
        save: (args: { id?: string; name: string; description?: string | null; schema: unknown[] }) => Promise<DataTableRow>
        delete: (id: string) => Promise<{ ok: boolean }>
        rowsList: (args: { datatableId: string; status?: string; limit?: number }) => Promise<DataTableRowItem[]>
        rowSave: (args: { id?: string; datatableId: string; data: Record<string, unknown>; status?: string; tags?: string[] }) => Promise<DataTableRowItem>
        rowDelete: (id: string) => Promise<{ ok: boolean }>
        rowReset: (id: string) => Promise<{ ok: boolean }>
      }
      triggers: {
        list: () => Promise<TriggerRow[]>
        save: (args: Record<string, unknown>) => Promise<TriggerRow>
        delete: (id: string) => Promise<{ ok: boolean }>
        runNow: (id: string) => Promise<{ ok: boolean }>
      }
      connections: {
        list: () => Promise<ConnectionRow[]>
        save: (args: { id?: string; name: string; conn_type: string; secrets: Record<string, string>; scope?: Record<string, unknown> | null }) => Promise<ConnectionRow>
        delete: (id: string) => Promise<{ ok: boolean }>
      }
      campaignViews: {
        list: () => Promise<CampaignViewRow[]>
        save: (args: { id?: string; name: string; description?: string | null; workflow_id?: string | null; trigger_id?: string | null; datatable_id?: string | null }) => Promise<CampaignViewRow>
        delete: (id: string) => Promise<{ ok: boolean }>
      }
      channelsAdmin: {
        save: (args: { id?: string; name: string; channel_type: string; profile_path?: string | null; user_agent?: string | null; locale?: string | null; timezone?: string | null; proxy_url?: string | null }) => Promise<ChannelListItem>
        delete: (id: string) => Promise<{ ok: boolean }>
      }
      campaignLogs: {
        list: (opts?: { campaignViewId?: string; workflowId?: string; runId?: string; datatableRowId?: string; limit?: number }) => Promise<CampaignLogItem[]>
      }
      customBlocks: {
        list: () => Promise<Array<Record<string, unknown>>>
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
        }) => Promise<Record<string, unknown>>
        delete: (manifestId: string) => Promise<{ ok: boolean }>
      }
      onProgress: (cb: (event: ProgressEvent) => void) => () => void
    }
  }
}

export {}
