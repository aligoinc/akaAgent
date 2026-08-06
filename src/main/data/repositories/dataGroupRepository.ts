import {
  BindCampaignDataGroupSourceRequest,
  CampaignDataGroupChangePreflight,
  CampaignDataGroupSource,
  CampaignCreationBundle,
  CreateCampaignBundleRequest,
  CreateDataGroupRequest,
  DataGroup,
  DataGroupCampaignTargetPreview,
  DataGroupCampaignTargetPreviewRequest,
  DataGroupIngestRequest,
  DataGroupIngestResult,
  DataGroupLatestIngestStats,
  DataGroupDataset,
  DataGroupListQuery,
  DataGroupListResult,
  DataGroupMember,
  DataGroupMemberIdListResult,
  DataGroupMemberListQuery,
  DataGroupMemberListResult,
  DataGroupMemberMutationRequest,
  DataGroupMutationResult,
  DataProvenance,
  DataTypeCategoryItem,
  MoveDataGroupMembersRequest,
  SnapshotDataGroupToCampaignRequest,
  SnapshotDataGroupToCampaignResult,
  UpdateDataGroupRequest
} from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'

type DbRow = Record<string, unknown>

const client = () => getSupabaseClient()

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value)
}

function asNullableString(value: unknown): string | null {
  const normalized = asString(value).trim()
  return normalized || null
}

function unwrapRpcRow(data: unknown): DbRow {
  if (Array.isArray(data)) return (data[0] || {}) as DbRow
  return (data || {}) as DbRow
}

function unwrapRpcRows(data: unknown): DbRow[] {
  if (!Array.isArray(data)) return data ? [data as DbRow] : []
  return data as DbRow[]
}

function mapDataGroup(row: DbRow): DataGroup {
  return {
    id: asNumber(row.id),
    name: asString(row.name),
    color: asString(row.color, '#6366f1'),
    sortOrder: asNumber(row.sort_order),
    revision: asNumber(row.revision),
    dataTypeCategoryItemId: asNullableNumber(row.data_type_category_item_id),
    dataTypeCode: asNullableString(row.data_type_code) as DataGroup['dataTypeCode'],
    dataTypeName: asNullableString(row.data_type_name),
    datasetSyncMode: asString(row.dataset_sync_mode, 'manual') as DataGroup['datasetSyncMode'],
    activeMembershipCount: asNumber(row.active_membership_count ?? row.contact_count),
    isDelete: Boolean(row.is_delete),
    staffId: asNullableNumber(row.staff_id) ?? undefined,
    organizationId: asNullableNumber(row.organization_id) ?? undefined,
    createdAt: asNullableString(row.created_at) ?? undefined,
    updatedAt: asNullableString(row.updated_at) ?? undefined
  }
}

function mapProvenance(row: DbRow): DataProvenance {
  return {
    id: asNullableNumber(row.id) ?? undefined,
    membershipId: asNullableNumber(row.membership_id) ?? undefined,
    kind: asString(row.kind, 'legacy_unknown') as DataProvenance['kind'],
    datasetId: asNullableNumber(row.dataset_id),
    batchId: asNullableNumber(row.batch_id),
    sourceAccountId: asNullableNumber(row.source_account_id),
    sourceAccountName: asNullableString(row.source_account_name),
    sourceAccountDeleted: Boolean(row.source_account_deleted),
    automationDetailId: asNullableNumber(row.automation_detail_id),
    automationId: asNullableNumber(row.automation_id),
    automationName: asNullableString(row.automation_name),
    automationDetailStatus: asNullableString(row.automation_detail_status),
    sourceCampaignId: asNullableNumber(row.source_campaign_id),
    sourceCampaignName: asNullableString(row.source_campaign_name),
    targetCampaignId: asNullableNumber(row.target_campaign_id),
    targetCampaignName: asNullableString(row.target_campaign_name),
    sourceNameSnapshot: asNullableString(row.source_name_snapshot),
    relationshipKind: asNullableString(row.relationship_kind) as DataProvenance['relationshipKind'],
    dataTypeCategoryItemId: asNullableNumber(row.data_type_category_item_id),
    dataTypeCode: asNullableString(row.data_type_code) as DataProvenance['dataTypeCode'],
    dataTypeName: asNullableString(row.data_type_name),
    isCurrent: row.is_current !== false,
    createdAt: asNullableString(row.created_at) ?? undefined,
    updatedAt: asNullableString(row.updated_at) ?? undefined
  }
}

function mapDataGroupMember(row: DbRow): DataGroupMember {
  const provenanceRows = Array.isArray(row.provenance) ? row.provenance as DbRow[] : []
  const datasetIds = Array.isArray(row.dataset_ids)
    ? row.dataset_ids.map(value => asNumber(value)).filter(value => value > 0)
    : []
  const datasetNames = Array.isArray(row.dataset_names)
    ? row.dataset_names.map(value => asString(value)).filter(Boolean)
    : []
  return {
    id: asNumber(row.id ?? row.membership_id),
    groupId: asNumber(row.group_id),
    contactId: asNumber(row.contact_id),
    name: asString(row.name),
    uid: asNullableString(row.uid),
    url: asNullableString(row.url),
    phone: asNullableString(row.phone),
    email: asNullableString(row.email),
    info1: asNullableString(row.info1),
    info2: asNullableString(row.info2),
    info3: asNullableString(row.info3),
    info4: asNullableString(row.info4),
    info5: asNullableString(row.info5),
    contactType: asString(row.contact_type, 'campaign_input') as DataGroupMember['contactType'],
    flatformType: asNullableString(row.flatform_type),
    sourceAccountId: asNullableNumber(row.source_account_id ?? row.account_id),
    sourceAccountName: asNullableString(row.source_account_name ?? row.account_name),
    sourceAccountDeleted: Boolean(row.source_account_deleted ?? row.account_is_delete),
    datasetIds,
    datasetNames,
    isFriend: row.is_friend == null ? null : Boolean(row.is_friend),
    isJoined: row.is_joined == null ? null : Boolean(row.is_joined),
    isDelete: Boolean(row.is_delete),
    changeRevision: asNumber(row.change_revision),
    primaryOriginId: asNullableNumber(row.primary_origin_id),
    sourceCategoryItemId: asNullableNumber(row.source_category_item_id),
    sourceCode: asNullableString(row.source_code) as DataGroupMember['sourceCode'],
    sourceName: asNullableString(row.source_name),
    sourceAutomationId: asNullableNumber(row.source_automation_id),
    sourceAutomationName: asNullableString(row.source_automation_name),
    dataTypeCategoryItemId: asNullableNumber(row.data_type_category_item_id),
    dataTypeCode: asNullableString(row.data_type_code) as DataGroupMember['dataTypeCode'],
    dataTypeName: asNullableString(row.data_type_name),
    groupDataTypeCategoryItemId: asNullableNumber(row.group_data_type_category_item_id),
    groupDataTypeCode: asNullableString(row.group_data_type_code) as DataGroupMember['groupDataTypeCode'],
    groupDataTypeName: asNullableString(row.group_data_type_name),
    provenance: provenanceRows.map(mapProvenance),
    createdAt: asNullableString(row.created_at) ?? undefined,
    updatedAt: asNullableString(row.updated_at) ?? undefined
  }
}

function mapDataGroupDataset(row: DbRow): DataGroupDataset {
  return {
    id: asNumber(row.id),
    groupId: asNullableNumber(row.group_id),
    name: asString(row.name),
    link: asNullableString(row.link),
    description: asNullableString(row.description),
    source: asString(row.source, 'upload') as DataGroupDataset['source'],
    accountId: asNullableNumber(row.account_id),
    sourceAccountName: asNullableString(row.source_account_name),
    sourceAccountDeleted: Boolean(row.source_account_deleted),
    flatformType: asString(row.flatform_type),
    contactType: asString(row.contact_type, 'campaign_input') as DataGroupDataset['contactType'],
    scanType: asString(row.scan_type, 'upload') as DataGroupDataset['scanType'],
    sourceKey: asString(row.source_key),
    importSource: asNullableString(row.import_source) as DataGroupDataset['importSource'],
    contactCount: asNumber(row.contact_count),
    dataTypeCategoryItemId: asNullableNumber(row.data_type_category_item_id),
    dataTypeCode: asNullableString(row.data_type_code) as DataGroupDataset['dataTypeCode'],
    dataTypeName: asNullableString(row.data_type_name),
    isDelete: Boolean(row.is_delete),
    createdAt: asNullableString(row.created_at) ?? undefined,
    updatedAt: asNullableString(row.updated_at) ?? undefined
  }
}

function mapSource(row: DbRow): CampaignDataGroupSource {
  return {
    id: asNumber(row.id),
    campaignId: asNumber(row.campaign_id),
    groupId: asNumber(row.group_id),
    baselineRevision: asNumber(row.baseline_revision),
    status: asString(row.status, 'baselining') as CampaignDataGroupSource['status'],
    startedAt: asNullableString(row.started_at),
    stoppedAt: asNullableString(row.stopped_at),
    stopReason: asNullableString(row.stop_reason),
    lastIngestAt: asNullableString(row.last_ingest_at),
    createdAt: asNullableString(row.created_at) ?? undefined,
    updatedAt: asNullableString(row.updated_at) ?? undefined
  }
}

function identityParams(): {
  p_staff_id: number
  p_organization_id: number
  p_auth_username: string
  p_auth_password: string
} {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  return {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_auth_username: credentials.username,
    p_auth_password: credentials.password
  }
}

export interface DataGroupRuntimeContext {
  runtimeTarget: 'desktop' | 'server'
  runtimeModeRevision?: string | null
}

function serverRuntimeParams(context: DataGroupRuntimeContext): {
  p_staff_id: number
  p_organization_id: number
  p_expected_mode_revision: string
} {
  const user = requireCurrentUser()
  const runtimeModeRevision = asString(context.runtimeModeRevision).trim()
  if (context.runtimeTarget !== 'server' || !runtimeModeRevision) {
    throw new Error('Thiếu revision xác thực của Zalo Server runtime.')
  }
  return {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_expected_mode_revision: runtimeModeRevision
  }
}

function throwRpcError(prefix: string, error: { message?: string } | null): never {
  const rawMessage = error?.message || 'unknown_error'
  const semanticMessages: Record<string, string> = {
    invalid_data_type_category_item: 'Loại data không hợp lệ hoặc đã ngừng sử dụng.',
    invalid_data_type_category_context: 'Loại data không thuộc danh mục Loại dữ liệu.',
    data_group_ingest_semantic_type_mismatch: 'Data thêm vào không đúng loại của nhóm.',
    data_group_origin_semantic_type_mismatch: 'Nguồn data không đúng loại của nhóm.',
    data_group_dataset_semantic_type_mismatch: 'Danh sách data không đúng loại của nhóm.',
    data_group_members_semantic_type_mismatch: 'Nhóm đang có data không phù hợp với loại muốn đổi.',
    dataset_auto_data_group_type_read_only: 'Loại của nhóm tự sinh được quản lý theo danh sách data và không thể sửa thủ công.',
    data_group_campaign_semantic_type_incompatible: 'Nhóm data không tương thích với loại dữ liệu của chiến dịch.',
    automation_data_group_semantic_type_mismatch: 'Nhóm data không đúng loại dữ liệu của tự động hóa.',
    zalo_add_group_member_upload_requires_phone: 'Upload trực tiếp cho chiến dịch thêm thành viên Zalo chỉ nhận số điện thoại.',
    facebook_comment_seeding_upload_must_be_unrestricted: 'Upload cho comment seeding phải dùng nhóm Mọi loại dữ liệu.'
  }
  const matchedCode = Object.keys(semanticMessages).find(code => rawMessage.includes(code))
  throw new Error(matchedCode ? semanticMessages[matchedCode] : `${prefix}: ${rawMessage}`)
}

export async function listDataGroups(query: DataGroupListQuery = {}): Promise<DataGroupListResult> {
  const { data, error } = await client().rpc('aka_agent_list_data_groups', {
    ...identityParams(),
    p_search: asNullableString(query.search),
    p_compatible_action_id: asNullableString(query.compatibleActionId),
    p_compatible_data_type_category_item_id: asNullableNumber(query.compatibleDataTypeCategoryItemId),
    p_unrestricted_only: query.unrestrictedOnly === true,
    p_data_type_category_item_ids: query.dataTypeCategoryItemIds?.length
      ? query.dataTypeCategoryItemIds
      : null,
    p_offset: Math.max(0, Math.trunc(query.offset || 0)),
    p_limit: Math.min(200, Math.max(1, Math.trunc(query.limit || 50)))
  })
  if (error) throwRpcError('Failed to list data groups', error)
  const rows = unwrapRpcRows(data)
  return {
    groups: rows.map(mapDataGroup),
    total: rows.length > 0 ? asNumber(rows[0].total_count, rows.length) : 0
  }
}

export async function listDataTypeCategoryItems(): Promise<DataTypeCategoryItem[]> {
  const { data, error } = await client()
    .from('category_item')
    .select('id, code, name, sort_order, is_active, category_type!inner(namespace, code, managed_by, is_active)')
    .eq('category_type.namespace', 'common')
    .eq('category_type.code', 'data_type')
    .eq('category_type.managed_by', 'system')
    .eq('category_type.is_active', true)
    .eq('managed_by', 'system')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
  if (error) throwRpcError('Failed to list data type categories', error)
  return (data || []).map((row: DbRow) => ({
    id: asNumber(row.id),
    code: asString(row.code) as DataTypeCategoryItem['code'],
    name: asString(row.name),
    sortOrder: asNumber(row.sort_order),
    isActive: row.is_active !== false
  }))
}

export async function createDataGroup(request: CreateDataGroupRequest): Promise<DataGroup> {
  const { data, error } = await client().rpc('aka_agent_create_data_group', {
    ...identityParams(),
    p_name: request.name,
    p_color: request.color || null,
    p_request_id: request.requestId || null,
    p_data_type_category_item_id: request.dataTypeCategoryItemId ?? null
  })
  if (error) throwRpcError('Failed to create data group', error)
  return mapDataGroup(unwrapRpcRow(data))
}

export async function updateDataGroup(request: UpdateDataGroupRequest): Promise<DataGroup> {
  const { data, error } = await client().rpc('aka_agent_update_data_group', {
    ...identityParams(),
    p_group_id: request.groupId,
    p_name: request.name ?? null,
    p_color: request.color ?? null,
    p_sort_order: request.sortOrder ?? null,
    p_data_type_category_item_id: request.dataTypeCategoryItemId ?? null,
    p_update_data_type: Object.prototype.hasOwnProperty.call(request, 'dataTypeCategoryItemId')
  })
  if (error) throwRpcError('Failed to update data group', error)
  return mapDataGroup(unwrapRpcRow(data))
}

export async function deleteDataGroup(
  groupId: number,
  requestId: string,
  detachAutomations = true
): Promise<DataGroupMutationResult> {
  const { data, error } = await client().rpc('aka_agent_delete_data_group_with_options', {
    ...identityParams(),
    p_group_id: groupId,
    p_request_id: requestId,
    p_detach_automations: detachAutomations
  })
  if (error) throwRpcError('Failed to delete data group', error)
  const row = unwrapRpcRow(data)
  return {
    success: row.success !== false,
    count: asNumber(row.count),
    groupRevision: asNullableNumber(row.group_revision) ?? undefined,
    detachedAutomationCount: asNullableNumber(row.detached_automation_count) ?? undefined
  }
}

export async function duplicateDataGroup(
  groupId: number,
  name: string | null,
  requestId: string
): Promise<DataGroup> {
  const { data, error } = await client().rpc('aka_agent_duplicate_data_group', {
    ...identityParams(),
    p_group_id: groupId,
    p_name: name,
    p_request_id: requestId
  })
  if (error) throwRpcError('Failed to duplicate data group', error)
  return mapDataGroup(unwrapRpcRow(data))
}

export async function listDataGroupMembers(
  query: DataGroupMemberListQuery
): Promise<DataGroupMemberListResult> {
  const { data, error } = await client().rpc('aka_agent_list_data_group_members', {
    ...identityParams(),
    p_group_id: query.groupId,
    p_search: asNullableString(query.search),
    p_account_ids: query.accountIds?.length ? query.accountIds : null,
    p_include_accountless: query.includeAccountless !== false,
    p_contact_types: query.contactTypes?.length ? query.contactTypes : null,
    p_flatform_types: query.flatformTypes?.length ? query.flatformTypes : null,
    p_status: query.status || 'all',
    p_dataset_ids: query.datasetIds?.length ? query.datasetIds : null,
    p_data_type_category_item_ids: query.dataTypeCategoryItemIds?.length
      ? query.dataTypeCategoryItemIds
      : null,
    p_ids: query.ids?.length ? query.ids : null,
    p_exclude_ids: query.excludeIds?.length ? query.excludeIds : null,
    p_offset: Math.max(0, Math.trunc(query.offset || 0)),
    p_limit: Math.min(500, Math.max(1, Math.trunc(query.limit || 50)))
  })
  if (error) throwRpcError('Failed to list data group members', error)
  const rows = unwrapRpcRows(data)
  return {
    members: rows.map(mapDataGroupMember),
    total: rows.length > 0 ? asNumber(rows[0].total_count, rows.length) : 0
  }
}

export async function listDataGroupMemberIds(
  query: DataGroupMemberListQuery
): Promise<DataGroupMemberIdListResult> {
  const ids: number[] = []
  const pageSize = 500
  let offset = 0
  let total = 0

  while (true) {
    const page = await listDataGroupMembers({
      ...query,
      offset,
      limit: pageSize
    })
    ids.push(...page.members.map(member => member.id))
    total = page.total
    offset += page.members.length
    if (page.members.length === 0 || offset >= total) break
  }

  return { ids, total }
}

export async function listDataGroupDatasets(groupId: number): Promise<DataGroupDataset[]> {
  const { data, error } = await client().rpc('aka_agent_list_data_group_datasets', {
    ...identityParams(),
    p_group_id: groupId
  })
  if (error) throwRpcError('Failed to list data group datasets', error)
  return unwrapRpcRows(data).map(mapDataGroupDataset)
}

export async function exportDataGroupMembers(query: DataGroupMemberListQuery): Promise<DataGroupMember[]> {
  const members: DataGroupMember[] = []
  const pageSize = 500
  let offset = 0
  while (true) {
    const page = await listDataGroupMembers({ ...query, offset, limit: pageSize })
    members.push(...page.members)
    offset += page.members.length
    if (page.members.length === 0 || offset >= page.total) break
  }
  return members
}

export async function ingestDataGroup(request: DataGroupIngestRequest): Promise<DataGroupIngestResult> {
  const rows = request.rows.map(row => ({
    contact_id: row.contactId ?? null,
    source_account_id: row.sourceAccountId ?? request.sourceAccountId ?? null,
    relationship_kind: row.relationshipKind ?? null,
    contact_type: row.contactType ?? null,
    flatform_type: row.flatformType ?? null,
    name: row.name ?? null,
    uid: row.uid ?? null,
    url: row.url ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    info1: row.info1 ?? null,
    info2: row.info2 ?? null,
    info3: row.info3 ?? null,
    info4: row.info4 ?? null,
    info5: row.info5 ?? null,
    extra_data: row.extraData || {}
  }))
  const { data, error } = await client().rpc('aka_agent_ingest_data_group', {
    ...identityParams(),
    p_request_id: request.requestId,
    p_group_id: request.groupId,
    p_kind: request.kind,
    p_rows: rows,
    p_dataset_id: request.datasetId ?? null,
    p_dataset_name: request.datasetName ?? null,
    p_import_source: request.importSource ?? null,
    p_source_account_id: request.sourceAccountId ?? null,
    p_source_name: request.sourceName ?? null,
    p_payload_hash: request.payloadHash ?? null,
    p_data_type_category_item_id: request.dataTypeCategoryItemId ?? null
  })
  if (error) throwRpcError('Failed to ingest data group', error)
  const row = unwrapRpcRow(data)
  return {
    requestId: asString(row.request_id, request.requestId),
    batchId: asNullableNumber(row.batch_id),
    groupId: asNumber(row.group_id, request.groupId),
    groupRevision: asNumber(row.group_revision),
    insertedMembershipCount: asNumber(row.inserted_membership_count),
    reactivatedMembershipCount: asNumber(row.reactivated_membership_count),
    alreadyMemberCount: asNumber(row.already_member_count),
    insertedInputCount: asNumber(row.inserted_input_count),
    alreadySeenInputCount: asNumber(row.already_seen_input_count),
    incompatibleCount: asNumber(row.incompatible_count),
    conflictCount: asNumber(row.conflict_count),
    invalidCount: asNumber(row.invalid_count),
    conflicts: Array.isArray(row.conflicts) ? row.conflicts as DataGroupIngestResult['conflicts'] : []
  }
}

async function mutateMembers(
  rpcName: string,
  request: DataGroupMemberMutationRequest,
  extra: DbRow = {}
): Promise<DataGroupMutationResult> {
  const { data, error } = await client().rpc(rpcName, {
    ...identityParams(),
    p_request_id: request.requestId,
    p_group_id: request.groupId,
    p_membership_ids: request.membershipIds,
    ...extra
  })
  if (error) throwRpcError(`Failed to mutate data group members (${rpcName})`, error)
  const row = unwrapRpcRow(data)
  return {
    success: row.success !== false,
    count: asNumber(row.count),
    groupRevision: asNullableNumber(row.group_revision) ?? undefined
  }
}

export function removeDataGroupMembers(request: DataGroupMemberMutationRequest): Promise<DataGroupMutationResult> {
  return mutateMembers('aka_agent_remove_data_group_members', request)
}

export function moveDataGroupMembers(request: MoveDataGroupMembersRequest): Promise<DataGroupMutationResult> {
  return mutateMembers('aka_agent_move_data_group_members', request, {
    p_target_group_id: request.targetGroupId
  })
}

export async function bindCampaignDataGroupSource(
  request: BindCampaignDataGroupSourceRequest
): Promise<CampaignDataGroupSource> {
  const { data, error } = await client().rpc('aka_agent_bind_campaign_data_group_source', {
    ...identityParams(),
    p_request_id: request.requestId,
    p_campaign_id: request.campaignId,
    p_group_id: request.groupId,
    p_bundle_id: request.bundleId ?? null
  })
  if (error) throwRpcError('Failed to bind campaign data group source', error)
  return mapSource(unwrapRpcRow(data))
}

export async function previewDataGroupCampaignTargets(
  request: DataGroupCampaignTargetPreviewRequest
): Promise<DataGroupCampaignTargetPreview[]> {
  const { data, error } = await client().rpc('aka_agent_preview_data_group_campaign_targets', {
    ...identityParams(),
    p_group_id: request.groupId,
    p_action_id: request.actionId,
    p_account_ids: request.accountIds
  })
  if (error) throwRpcError('Failed to preview campaign data group targets', error)
  return unwrapRpcRows(data).map(row => ({
    accountId: asNumber(row.account_id),
    activeMembershipCount: asNumber(row.active_membership_count),
    compatibleMembershipCount: asNumber(row.compatible_membership_count),
    validTargetCount: asNumber(row.valid_target_count),
    incompatibleMembershipCount: asNumber(row.incompatible_membership_count),
    duplicateTargetCount: asNumber(row.duplicate_target_count)
  }))
}

export async function snapshotDataGroupToCampaign(
  request: SnapshotDataGroupToCampaignRequest
): Promise<SnapshotDataGroupToCampaignResult> {
  const { data, error } = await client().rpc('aka_agent_snapshot_data_group_to_direct_campaign', {
    ...identityParams(),
    p_request_id: request.requestId,
    p_campaign_id: request.campaignId,
    p_group_id: request.groupId,
    p_campaign_schedule: request.campaignSchedule,
    p_campaign_status: request.campaignStatus
  })
  if (error) throwRpcError('Failed to snapshot data group into campaign', error)
  const row = unwrapRpcRow(data)
  return {
    requestId: asString(row.request_id, request.requestId),
    campaignId: asNumber(row.campaign_id, request.campaignId),
    groupId: asNumber(row.group_id, request.groupId),
    groupRevision: asNumber(row.group_revision),
    activeMembershipCount: asNumber(row.active_membership_count),
    insertedCount: asNumber(row.inserted_count ?? row.inserted_input_count),
    alreadySeenCount: asNumber(row.already_seen_count ?? row.already_seen_input_count),
    incompatibleCount: asNumber(row.incompatible_count),
    conflictCount: asNumber(row.conflict_count)
  }
}

export async function preflightCampaignDataGroupChange(
  campaignId: number,
  groupId: number
): Promise<CampaignDataGroupChangePreflight> {
  const { data, error } = await client().rpc('aka_agent_preflight_campaign_data_group_change', {
    ...identityParams(),
    p_campaign_id: campaignId,
    p_group_id: groupId
  })
  if (error) throwRpcError('Failed to preflight campaign data-group change', error)
  const row = unwrapRpcRow(data)
  return {
    allowed: row.allowed === true,
    reason: asString(row.reason, row.allowed === true ? 'allowed' : 'not_allowed'),
    canonicalCount: asNumber(row.canonical_count)
  }
}

export async function getDataGroupLatestIngestStats(groupId: number): Promise<DataGroupLatestIngestStats> {
  const { data, error } = await client().rpc('aka_agent_get_data_group_latest_ingest_stats', {
    ...identityParams(),
    p_group_id: groupId
  })
  if (error) throwRpcError('Failed to get latest data-group ingest stats', error)
  const row = unwrapRpcRow(data)
  const latestResult = row.latest_result && typeof row.latest_result === 'object' && !Array.isArray(row.latest_result)
    ? row.latest_result as Record<string, unknown>
    : {}
  return {
    groupId: asNumber(row.group_id, groupId),
    groupRevision: asNumber(row.group_revision),
    activeMembershipCount: asNumber(row.active_membership_count),
    uniqueCompatibleTargetCount: asNumber(row.unique_compatible_target_count),
    campaignInputCount: asNumber(row.campaign_input_count),
    latestBatchId: asNullableNumber(row.latest_batch_id),
    latestRequestId: asNullableString(row.latest_request_id),
    latestKind: asNullableString(row.latest_kind) as DataGroupLatestIngestStats['latestKind'],
    latestSourceName: asNullableString(row.latest_source_name),
    latestBatchStatus: asNullableString(row.latest_batch_status),
    latestResult,
    insertedMembershipCount: asNumber(row.inserted_membership_count),
    reactivatedMembershipCount: asNumber(row.reactivated_membership_count),
    alreadyMemberCount: asNumber(row.already_member_count),
    removedMembershipCount: asNumber(row.removed_membership_count),
    insertedInputCount: asNumber(row.inserted_input_count),
    alreadySeenInputCount: asNumber(row.already_seen_input_count),
    incompatibleCount: asNumber(row.incompatible_count),
    conflictCount: asNumber(row.conflict_count),
    invalidCount: asNumber(row.invalid_count),
    baseliningSourceCount: asNumber(row.baselining_source_count),
    activeSourceCount: asNumber(row.active_source_count),
    stoppedSourceCount: asNumber(row.stopped_source_count),
    latestBatchCreatedAt: asNullableString(row.latest_batch_created_at),
    latestBatchUpdatedAt: asNullableString(row.latest_batch_updated_at)
  }
}

export async function createCampaignCreationBundle(
  request: CreateCampaignBundleRequest
): Promise<CampaignCreationBundle> {
  const { data, error } = await client().rpc('aka_agent_create_campaign_creation_bundle', {
    ...identityParams(),
    p_request_id: request.requestId,
    p_expected_campaign_count: request.expectedCampaignCount
  })
  if (error) throwRpcError('Failed to create campaign bundle', error)
  const row = unwrapRpcRow(data)
  return {
    id: asNumber(row.id ?? row.bundle_id),
    requestId: asString(row.request_id, request.requestId),
    status: asString(row.status, 'staged') as CampaignCreationBundle['status'],
    expectedCampaignCount: asNumber(row.expected_campaign_count, request.expectedCampaignCount),
    readyCampaignCount: asNumber(row.ready_campaign_count),
    error: asNullableString(row.error),
    createdAt: asNullableString(row.created_at) ?? undefined,
    updatedAt: asNullableString(row.updated_at) ?? undefined
  }
}

export async function getCampaignDataGroupSource(campaignId: number): Promise<CampaignDataGroupSource | null> {
  const { data, error } = await client().rpc('aka_agent_get_campaign_data_group_source', {
    ...identityParams(),
    p_campaign_id: campaignId
  })
  if (error) throwRpcError('Failed to get campaign data group source', error)
  const row = unwrapRpcRow(data)
  return asNumber(row.id) > 0 ? mapSource(row) : null
}

async function changeSourceState(
  rpcName: string,
  campaignId: number,
  requestId: string,
  reason?: string
): Promise<CampaignDataGroupSource> {
  const { data, error } = await client().rpc(rpcName, {
    ...identityParams(),
    p_campaign_id: campaignId,
    p_request_id: requestId,
    p_reason: reason || null
  })
  if (error) throwRpcError(`Failed to change campaign data group source (${rpcName})`, error)
  return mapSource(unwrapRpcRow(data))
}

export function stopCampaignDataGroupSource(
  campaignId: number,
  requestId: string,
  reason = 'manual_stop'
): Promise<CampaignDataGroupSource> {
  return changeSourceState('aka_agent_stop_campaign_data_group_source', campaignId, requestId, reason)
}

export function reactivateCampaignDataGroupSource(
  campaignId: number,
  requestId: string
): Promise<CampaignDataGroupSource> {
  return changeSourceState('aka_agent_reactivate_campaign_data_group_source', campaignId, requestId)
}

export interface FinalizeDataGroupCampaignResult {
  completed: boolean
  status: string
  reason: string
}

export async function finalizeDataGroupCampaign(
  campaignId: number,
  note?: string | null,
  runtimeContext: DataGroupRuntimeContext = { runtimeTarget: 'desktop' }
): Promise<FinalizeDataGroupCampaignResult> {
  const rpcName = runtimeContext.runtimeTarget === 'server'
    ? 'aka_agent_finalize_zalo_server_data_group_campaign'
    : 'aka_agent_finalize_data_group_campaign'
  const params = runtimeContext.runtimeTarget === 'server'
    ? {
        ...serverRuntimeParams(runtimeContext),
        p_campaign_id: campaignId,
        p_note: note ?? null
      }
    : {
        ...identityParams(),
        p_campaign_id: campaignId,
        p_note: note ?? null
      }
  const { data, error } = await client().rpc(rpcName, params)
  if (error) throwRpcError('Failed to finalize data-group campaign', error)
  const row = unwrapRpcRow(data)
  const status = asString(row.status ?? row.campaign_status, 'chờ xử lý')
  return {
    completed: Boolean(row.completed) || status === 'hoàn thành',
    status,
    reason: asString(row.reason, status === 'hoàn thành' ? 'completed' : 'active_source_waiting')
  }
}

export interface FinalizeExpiredDataGroupCampaignResult {
  campaignId: number
  campaignStatus: string
  result: Record<string, unknown>
}

/**
 * Sweep hard-ended subscriptions independently from account/login/runtime
 * eligibility. The RPC owns row locking and the atomic source/input finalizer.
 */
export async function finalizeExpiredDataGroupCampaigns(
  limit = 200,
  runtimeContext: DataGroupRuntimeContext = { runtimeTarget: 'desktop' }
): Promise<FinalizeExpiredDataGroupCampaignResult[]> {
  const normalizedLimit = Math.min(1000, Math.max(1, Math.trunc(limit)))
  const rpcName = runtimeContext.runtimeTarget === 'server'
    ? 'aka_agent_finalize_expired_zalo_server_data_group_campaigns'
    : 'aka_agent_finalize_expired_data_group_campaigns'
  const params = runtimeContext.runtimeTarget === 'server'
    ? {
        ...serverRuntimeParams(runtimeContext),
        p_limit: normalizedLimit
      }
    : {
        ...identityParams(),
        p_limit: normalizedLimit
      }
  const { data, error } = await client().rpc(rpcName, params)
  if (error) throwRpcError('Failed to finalize expired data-group campaigns', error)
  return unwrapRpcRows(data).map(row => ({
    campaignId: asNumber(row.campaign_id),
    campaignStatus: asString(row.campaign_status),
    result: row.result && typeof row.result === 'object' && !Array.isArray(row.result)
      ? row.result as Record<string, unknown>
      : {}
  })).filter(row => row.campaignId > 0)
}
