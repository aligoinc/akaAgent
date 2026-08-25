import type {
  CreateDataGroupRequest,
  DataGroup,
  DataGroupDataset,
  DataGroupDynamicFilterConfig,
  DataGroupIngestRequest,
  DataGroupIngestResult,
  DataGroupLatestIngestStats,
  DataGroupListQuery,
  DataGroupListResult,
  DataGroupMember,
  DataGroupMemberIdListResult,
  DataGroupMemberListQuery,
  DataGroupMemberListResult,
  DataGroupMemberMutationRequest,
  DataGroupMutationResult,
  DataGroupNoteUpdateResult,
  DataGroupPanelData,
  MoveDataGroupMembersRequest,
  SaveDataGroupDynamicFilterRequest,
  UpdateDataGroupRequest
} from '../../../../shared/types'

/**
 * Renderer-side contract for the staff-shared data-group IPC surface.
 *
 * This adapter intentionally lives next to the data-group UI so the manager and
 * picker can land independently while preload/main wiring is implemented in the
 * same change set.
 */
export interface DataGroupElectronAPI {
  listDataGroups: (query?: DataGroupListQuery) => Promise<DataGroupListResult>
  createDataGroup: (request: CreateDataGroupRequest) => Promise<DataGroup>
  updateDataGroup: (request: UpdateDataGroupRequest) => Promise<DataGroup>
  deleteDataGroup: (
    groupId: number,
    requestId: string,
    detachAutomations?: boolean
  ) => Promise<DataGroupMutationResult>
  duplicateDataGroup: (groupId: number, name: string | null, requestId: string) => Promise<DataGroup>
  listDataGroupMembers: (query: DataGroupMemberListQuery) => Promise<DataGroupMemberListResult>
  listDataGroupMemberIds: (query: DataGroupMemberListQuery) => Promise<DataGroupMemberIdListResult>
  listDataGroupDatasets: (groupId: number) => Promise<DataGroupDataset[]>
  getDataGroupLatestIngestStats: (groupId: number) => Promise<DataGroupLatestIngestStats>
  getDataGroupPanel: (groupId: number) => Promise<DataGroupPanelData>
  updateDataGroupNote: (groupId: number, note: string | null) => Promise<DataGroupNoteUpdateResult>
  getDataGroupDynamicFilter: (groupId: number) => Promise<DataGroupDynamicFilterConfig>
  saveDataGroupDynamicFilter: (request: SaveDataGroupDynamicFilterRequest) => Promise<DataGroupDynamicFilterConfig>
  ingestDataGroup: (request: DataGroupIngestRequest) => Promise<DataGroupIngestResult>
  removeDataGroupMembers: (request: DataGroupMemberMutationRequest) => Promise<DataGroupMutationResult>
  moveDataGroupMembers: (request: MoveDataGroupMembersRequest) => Promise<DataGroupMutationResult>
  exportDataGroupMembers: (query: DataGroupMemberListQuery) => Promise<DataGroupMember[]>
}

export const getDataGroupApi = (): DataGroupElectronAPI | null => {
  const api = window.electronAPI as unknown as Partial<DataGroupElectronAPI> | undefined
  return api && typeof api.listDataGroups === 'function'
    ? api as DataGroupElectronAPI
    : null
}

export const createDataGroupRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `data-group-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
