import type {
  Automation,
  AutomationActionOption,
  AutomationCampaignOption,
  AutomationContactGroupOption,
  AutomationDataType,
  AutomationDelayUnit,
  AutomationExecution,
  AutomationExecutionListQuery,
  AutomationExecutionListResult,
  AutomationExecutionStatus,
  AutomationInput,
  AutomationListQuery,
  AutomationListResult,
  AutomationOptions,
  AutomationScheduleMode,
  AutomationTriggerCondition,
  AutomationTriggerOption,
  CampaignAutomationExecutionListQuery,
  CampaignAutomationExecutionListResult,
  CampaignAutomationExecutionRole
} from '../../../shared/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  requireCurrentUser,
  requireCurrentUserCredentials,
  type ProcessAuthCredentials
} from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import * as dataGroupRepo from './dataGroupRepository'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200
const AUTOMATION_DATA_TYPES = new Set<AutomationDataType>([
  'phone',
  'email',
  'zalo_uid',
  'facebook_uid'
])
const AUTOMATION_DELAY_UNITS = new Set<AutomationDelayUnit>(['minute', 'hour', 'day'])
const AUTOMATION_DELAY_MAX_BY_UNIT: Record<AutomationDelayUnit, number> = {
  minute: 5_256_000,
  hour: 87_600,
  day: 3_650
}
const AUTOMATION_SCHEDULE_MODES = new Set<AutomationScheduleMode>([
  'immediate',
  'after_delay',
  'daily_time',
  'fixed_at'
])
const DAILY_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const AUTOMATION_EXECUTION_STATUSES = new Set<AutomationExecutionStatus>([
  'chờ xử lý',
  'đang xử lý',
  'đã thêm',
  'bỏ qua',
  'lỗi'
])
const CAMPAIGN_AUTOMATION_EXECUTION_ROLES = new Set<CampaignAutomationExecutionRole>([
  'all',
  'source',
  'target'
])
const RPC_LIST = 'aka_agent_list_automations'
const RPC_GET = 'aka_agent_get_automation'
const RPC_OPTIONS = 'aka_agent_get_automation_options'
const RPC_SAVE = 'aka_agent_save_automation'
const RPC_SET_ACTIVE = 'aka_agent_set_automation_active'
const RPC_DELETE = 'aka_agent_delete_automation'
const RPC_LIST_DETAILS = 'aka_agent_list_automation_details'
const RPC_LIST_CAMPAIGN_DETAILS = 'aka_agent_list_campaign_automation_details'
const RPC_CLAIM_DETAILS = 'claim_auto_automation_details'
const RPC_MATERIALIZE_DETAIL = 'materialize_auto_automation_detail'
const RPC_RETRY_DETAIL = 'retry_auto_automation_detail'
const RPC_RECOVER_STALE = 'recover_stale_auto_automation_details'
const RPC_RECONCILE_ENQUEUE_FAILURES = 'reconcile_auto_automation_enqueue_failures'
const AUTOMATION_ERROR_MESSAGES: Record<string, string> = {
  automation_auth_required: 'Phiên xác thực tự động hóa đã hết hạn. Vui lòng đăng nhập lại.',
  automation_auth_invalid: 'Thông tin đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.',
  invalid_automation_tenant: 'Phiên đăng nhập không hợp lệ.',
  inactive_automation_staff: 'Tài khoản nhân viên đã ngừng hoạt động.',
  automation_campaigns_must_be_distinct: 'Chiến dịch A và chiến dịch B phải khác nhau.',
  invalid_source_campaign: 'Chiến dịch A không tồn tại hoặc không còn hợp lệ.',
  invalid_target_campaign: 'Chiến dịch B không tồn tại hoặc không còn hợp lệ.',
  invalid_automation_data_type: 'Loại dữ liệu tự động hóa không hợp lệ.',
  source_campaign_data_type_not_supported: 'Chiến dịch A không tạo ra loại dữ liệu đã chọn.',
  target_campaign_data_type_not_supported: 'Chiến dịch B không nhận loại dữ liệu đã chọn.',
  account_scoped_data_requires_same_account: 'Dữ liệu UID Zalo yêu cầu hai chiến dịch dùng cùng một tài khoản Zalo.',
  invalid_target_contact_group: 'Nhóm dữ liệu không thuộc tài khoản hoặc không đúng loại dữ liệu của chiến dịch B.',
  invalid_automation_schedule: 'Cấu hình thời gian chạy không hợp lệ.',
  invalid_immediate_schedule: 'Chế độ chạy ngay không được có thời gian chờ.',
  invalid_delay_schedule: 'Vui lòng nhập thời gian chờ hợp lệ.',
  invalid_delay_exact_time_schedule: 'Giờ chạy cụ thể phải đúng định dạng HH:mm.',
  invalid_daily_time_schedule: 'Vui lòng nhập giờ chạy hợp lệ theo định dạng HH:mm.',
  invalid_fixed_schedule: 'Ngày giờ kích hoạt phải lớn hơn thời điểm hiện tại.',
  automation_cycle_detected: 'Không thể bật tự động hóa vì tạo thành vòng lặp chiến dịch.',
  invalid_automation_name: 'Tên tự động hóa không hợp lệ.',
  invalid_automation_note: 'Ghi chú tự động hóa không được quá 2.000 ký tự.',
  invalid_automation_target_input: 'Dữ liệu chuyển đến đích không hợp lệ.',
  invalid_automation_trigger_statuses: 'Danh sách trạng thái kích hoạt không hợp lệ.',
  invalid_automation_trigger_status: 'Trạng thái kích hoạt không hợp lệ.',
  invalid_automation_trigger_status_value: 'Giá trị trạng thái kích hoạt không hợp lệ.',
  invalid_automation_trigger_action_code: 'Hành động kích hoạt không hợp lệ.',
  automation_trigger_status_required: 'Vui lòng chọn ít nhất một trạng thái kích hoạt.',
  automation_destination_required: 'Vui lòng chọn ít nhất một đích: Chiến dịch đích hoặc Nhóm data.',
  target_contact_group_requires_campaign: 'Nhóm dữ liệu cũ chỉ dùng được khi có chiến dịch đích.',
  invalid_target_data_group: 'Nhóm data đích không tồn tại hoặc không còn hợp lệ.',
  automation_not_found: 'Không tìm thấy tự động hóa.',
  campaign_not_found: 'Không tìm thấy chiến dịch.',
  invalid_campaign_automation_role: 'Vai trò tự động hóa trong chiến dịch không hợp lệ.',
  invalid_campaign_automation_date_range: 'Khoảng ngày lịch sử tự động hóa không hợp lệ.'
}

type JsonRecord = Record<string, unknown>

export type AutomationRuntimeTarget = 'desktop' | 'server'

/**
 * Explicit context is reserved for trusted service-role/manual backend jobs.
 * The packaged desktop omits it and therefore requires process-only login
 * credentials from currentUser. The packaged Zalo Server does not run this
 * processor because its deployment intentionally has no Supabase secret.
 */
export interface AutomationRepositoryContext {
  client: SupabaseClient
  auth: ProcessAuthCredentials | null
}

export interface AutomationEnqueueReconcileResult {
  processed: number
  resolved: number
  failed: number
  pending: number
}

export interface ClaimedAutomationDetail {
  automationDetailId: number
  automationId: number
  parentAutomationDetailId: number | null
  sourceCampaignDetailId: number
  sourceCampaignInputDataId: number
  sourceCampaignId: number
  sourceAccountId: number
  sourceActionId: string
  sourceActionCode: string | null
  sourceStatus: string
  targetCampaignId: number | null
  targetAccountId: number | null
  targetActionId: string | null
  dataType: AutomationDataType
  dataValue: string
  sourceInputSnapshot: JsonRecord
  configSnapshot: JsonRecord
  targetContactGroupId: number | null
  targetDataGroupId: number | null
  scheduledAt: string
  targetRowIndex: number | null
  attemptCount: number
}

export interface AutomationMaterializeResult {
  code: 'materialized' | 'already_materialized' | 'target_running' | 'not_claimed' | 'failed' | string
  automationDetailId?: number
  targetInputDataId?: number | null
  targetContactId?: number | null
  targetContactGroupMemberId?: number | null
  targetDataGroupMemberId?: number | null
  targetRowIndex?: number | null
  error?: string | null
}

export interface AutomationDataGroupIngestResult {
  code: 'completed' | 'pending' | 'failed' | 'skipped' | string
  targetDataGroupMemberId?: number | null
  insertedInputCount: number
  alreadySeenInputCount: number
  error?: string | null
}

export interface RetryAutomationDetailOptions {
  error: string
  delaySeconds?: number
  terminal?: boolean
  skip?: boolean
  countAttempt?: boolean
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter(row => Object.keys(row).length > 0) : []
}

function firstDefined(row: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key]
  }
  return undefined
}

function toStringValue(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value)
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

function toNumberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toBooleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return fallback
}

function normalizeMappedDailyTime(value: unknown): string | null {
  const raw = toStringValue(value).trim()
  const match = /^((?:[01]\d|2[0-3])):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(raw)
  return match ? `${match[1]}:${match[2]}` : null
}

function normalizeTriggerStatus(value: unknown): string {
  return toStringValue(value).trim().toLocaleLowerCase('vi-VN')
}

function normalizeTriggerActionCode(value: unknown): string | null {
  return toNullableString(value)?.trim() || null
}

function triggerScopeKey(
  trigger: Pick<AutomationTriggerOption, 'campaignActionId' | 'actionCode' | 'status'>
): string {
  return `${trigger.campaignActionId}\u0000${trigger.actionCode || ''}\u0000${normalizeTriggerStatus(trigger.status)}`
}

function triggerIdentityKey(
  trigger: Pick<AutomationTriggerOption, 'campaignActionId' | 'statusMappingId' | 'actionCode' | 'status'>
): string {
  return trigger.statusMappingId
    ? `mapping\u0000${trigger.statusMappingId}`
    : `scope\u0000${triggerScopeKey(trigger)}`
}

function mapCanonicalDelay(
  row: JsonRecord,
  scheduleMode: AutomationScheduleMode,
  delayDays: number,
  delayHours: number
): { delayValue: number | null; delayUnit: AutomationDelayUnit | null } {
  const rawValue = toNullableNumber(firstDefined(row, 'delayValue', 'delay_value'))
  const rawUnit = toStringValue(firstDefined(row, 'delayUnit', 'delay_unit')) as AutomationDelayUnit
  if (
    rawValue !== null &&
    Number.isSafeInteger(rawValue) &&
    rawValue > 0 &&
    AUTOMATION_DELAY_UNITS.has(rawUnit) &&
    rawValue <= AUTOMATION_DELAY_MAX_BY_UNIT[rawUnit]
  ) {
    return { delayValue: rawValue, delayUnit: rawUnit }
  }

  if (scheduleMode !== 'after_delay') {
    return { delayValue: null, delayUnit: null }
  }

  const legacyDays = Number.isSafeInteger(delayDays) && delayDays > 0 ? delayDays : 0
  const legacyHours = Number.isSafeInteger(delayHours) && delayHours > 0 ? delayHours : 0
  if (legacyDays > 0 && legacyHours === 0 && legacyDays <= AUTOMATION_DELAY_MAX_BY_UNIT.day) {
    return { delayValue: legacyDays, delayUnit: 'day' }
  }

  const totalHours = legacyDays * 24 + legacyHours
  if (totalHours > 0 && totalHours <= AUTOMATION_DELAY_MAX_BY_UNIT.hour) {
    return { delayValue: totalHours, delayUnit: 'hour' }
  }
  return { delayValue: null, delayUnit: null }
}

function legacyDelayParts(
  delayValue: number,
  delayUnit: AutomationDelayUnit
): { delayDays: number; delayHours: number } {
  const totalHours = delayUnit === 'day'
    ? delayValue * 24
    : delayUnit === 'hour'
      ? delayValue
      : delayValue % 60 === 0
        ? delayValue / 60
        : null
  if (totalHours === null) return { delayDays: 0, delayHours: 0 }
  return {
    delayDays: Math.floor(totalHours / 24),
    delayHours: totalHours % 24
  }
}

function normalizePositiveId(value: unknown, label: string): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} không hợp lệ.`)
  return parsed
}

function normalizePage(value: unknown): number {
  const parsed = Math.floor(Number(value))
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
}

function normalizePageSize(value: unknown): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(parsed, MAX_PAGE_SIZE)
}

function normalizeUpdatedFrom(value: unknown): string | null {
  const raw = toStringValue(value).trim()
  if (!raw) return null
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+07:00` : raw)
  if (Number.isNaN(date.getTime())) throw new Error('Ngày cập nhật không hợp lệ.')
  return date.toISOString()
}

function normalizeAutomationHistoryDate(value: unknown, label: string): string | null {
  const raw = toStringValue(value).trim()
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} không hợp lệ.`)
  return date.toISOString()
}

function automationRpcError(
  error: { message?: string; details?: string; hint?: string; code?: string } | null | undefined,
  fallback: string
): Error {
  const message = String(error?.message || '').trim()
  if (/PGRST202|schema cache|could not find the function/i.test(message)) {
    return new Error('Cơ sở dữ liệu chưa được cập nhật cho tính năng Tự động hóa.')
  }
  for (const [code, friendly] of Object.entries(AUTOMATION_ERROR_MESSAGES)) {
    if (message.includes(code)) return new Error(friendly)
  }
  return new Error(message || fallback)
}

async function invokeRpc<T>(
  name: string,
  args: JsonRecord,
  fallback: string,
  context?: AutomationRepositoryContext
): Promise<T> {
  const auth = context ? context.auth : requireCurrentUserCredentials()
  const rpcClient = context?.client ?? getSupabaseClient()
  const { data, error } = await rpcClient.rpc(name, {
    ...args,
    p_auth_username: auth?.username ?? null,
    p_auth_password: auth?.password ?? null
  })
  if (error) throw automationRpcError(error, fallback)
  return data as T
}

function mapTriggerCondition(value: unknown): AutomationTriggerCondition | null {
  const row = asRecord(value)
  const status = toStringValue(firstDefined(row, 'status', 'statusValue', 'status_value')).trim()
  if (!status) return null
  const id = toNullableNumber(firstDefined(row, 'id', 'triggerStatusId', 'trigger_status_id'))
  const statusMappingId = toNullableNumber(firstDefined(row, 'statusMappingId', 'status_mapping_id'))
  const semanticStatusId = toNullableNumber(firstDefined(
    row,
    'semanticStatusId',
    'semantic_status_id',
    'statusId',
    'status_id'
  ))
  const actionCode = normalizeTriggerActionCode(firstDefined(row, 'actionCode', 'action_code'))
  return {
    ...(id ? { id } : {}),
    statusMappingId,
    semanticStatusId,
    actionCode,
    actionName: toNullableString(firstDefined(
      row,
      'actionName',
      'action_name',
      'accountActionName',
      'account_action_name'
    )),
    isWildcard: toBooleanValue(firstDefined(row, 'isWildcard', 'is_wildcard'), actionCode === null),
    status,
    statusLabel: toStringValue(firstDefined(row, 'statusLabel', 'status_label', 'statusName', 'status_name'), status)
  }
}

export function mapAutomationFromRpc(value: unknown): Automation {
  const row = asRecord(value)
  const sourceCampaign = asRecord(firstDefined(row, 'sourceCampaign', 'source_campaign'))
  const targetCampaign = asRecord(firstDefined(row, 'targetCampaign', 'target_campaign'))
  const rawScheduleMode = toStringValue(
    firstDefined(row, 'scheduleMode', 'schedule_mode'),
    'immediate'
  ) as AutomationScheduleMode
  const scheduleMode = AUTOMATION_SCHEDULE_MODES.has(rawScheduleMode) ? rawScheduleMode : 'immediate'
  const delayDays = toNumberValue(firstDefined(row, 'delayDays', 'delay_days'))
  const delayHours = toNumberValue(firstDefined(row, 'delayHours', 'delay_hours'))
  const canonicalDelay = mapCanonicalDelay(row, scheduleMode, delayDays, delayHours)
  const triggerRows = firstDefined(
    row,
    'triggerConditions',
    'trigger_conditions',
    'triggerStatuses',
    'trigger_statuses'
  )
  const triggerConditions = (Array.isArray(triggerRows) ? triggerRows : [])
    .map(mapTriggerCondition)
    .filter((item): item is AutomationTriggerCondition => !!item)

  return {
    id: toNumberValue(firstDefined(row, 'id', 'automationId', 'automation_id')),
    name: toStringValue(row.name),
    actionType: 'campaign_detail_route',
    isActive: toBooleanValue(firstDefined(row, 'isActive', 'is_active')),
    sourceCampaignId: toNumberValue(firstDefined(row, 'sourceCampaignId', 'source_campaign_id')),
    targetCampaignId: toNullableNumber(firstDefined(row, 'targetCampaignId', 'target_campaign_id')),
    dataType: toStringValue(firstDefined(row, 'dataType', 'dataTypeCode', 'data_type_code')) as AutomationDataType,
    targetContactGroupId: toNullableNumber(firstDefined(row, 'targetContactGroupId', 'target_contact_group_id')),
    targetDataGroupId: toNullableNumber(firstDefined(row, 'targetDataGroupId', 'target_data_group_id')),
    targetDataGroupName: toNullableString(firstDefined(row, 'targetDataGroupName', 'target_data_group_name')),
    scheduleMode,
    delayValue: canonicalDelay.delayValue,
    delayUnit: canonicalDelay.delayUnit,
    delayExactTime: normalizeMappedDailyTime(firstDefined(row, 'delayExactTime', 'delay_exact_time')),
    dailyTime: normalizeMappedDailyTime(firstDefined(row, 'dailyTime', 'daily_time')),
    delayDays,
    delayHours,
    fixedAt: toNullableString(firstDefined(row, 'fixedAt', 'fixed_at')),
    note: toNullableString(row.note),
    lastDataAt: toNullableString(firstDefined(row, 'lastDataAt', 'last_data_at')),
    activatedAt: toNullableString(firstDefined(row, 'activatedAt', 'activated_at')),
    isDelete: toBooleanValue(firstDefined(row, 'isDelete', 'is_delete')),
    staffId: toNullableNumber(firstDefined(row, 'staffId', 'staff_id')) ?? undefined,
    organizationId: toNullableNumber(firstDefined(row, 'organizationId', 'organization_id')) ?? undefined,
    createdAt: toNullableString(firstDefined(row, 'createdAt', 'created_at')) ?? undefined,
    updatedAt: toNullableString(firstDefined(row, 'updatedAt', 'updated_at')) ?? undefined,
    sourceCampaignName: toNullableString(firstDefined(row, 'sourceCampaignName', 'source_campaign_name') ?? sourceCampaign.name) ?? undefined,
    targetCampaignName: toNullableString(firstDefined(row, 'targetCampaignName', 'target_campaign_name') ?? targetCampaign.name) ?? undefined,
    sourceAccountId: toNullableNumber(firstDefined(row, 'sourceAccountId', 'source_account_id') ?? firstDefined(sourceCampaign, 'accountId', 'account_id')) ?? undefined,
    targetAccountId: toNullableNumber(firstDefined(row, 'targetAccountId', 'target_account_id') ?? firstDefined(targetCampaign, 'accountId', 'account_id')) ?? undefined,
    sourceAccountName: toNullableString(firstDefined(row, 'sourceAccountName', 'source_account_name') ?? firstDefined(sourceCampaign, 'accountName', 'account_name')) ?? undefined,
    targetAccountName: toNullableString(firstDefined(row, 'targetAccountName', 'target_account_name') ?? firstDefined(targetCampaign, 'accountName', 'account_name')) ?? undefined,
    sourceActionId: toNullableString(firstDefined(row, 'sourceActionId', 'source_action_id') ?? firstDefined(sourceCampaign, 'actionId', 'action_id')) ?? undefined,
    targetActionId: toNullableString(firstDefined(row, 'targetActionId', 'target_action_id') ?? firstDefined(targetCampaign, 'actionId', 'action_id')) ?? undefined,
    sourceActionName: toNullableString(firstDefined(row, 'sourceActionName', 'source_action_name') ?? firstDefined(sourceCampaign, 'actionName', 'action_name')) ?? undefined,
    targetActionName: toNullableString(firstDefined(row, 'targetActionName', 'target_action_name') ?? firstDefined(targetCampaign, 'actionName', 'action_name')) ?? undefined,
    triggerConditions
  }
}

function mapAutomationExecutionFromRpc(value: unknown): AutomationExecution {
  const row = asRecord(value)
  const status = toStringValue(row.status) as AutomationExecutionStatus
  const campaignRole = toStringValue(firstDefined(row, 'campaignRole', 'campaign_role'))
  return {
    id: toNumberValue(firstDefined(row, 'id', 'automationDetailId', 'automation_detail_id')),
    automationId: toNumberValue(firstDefined(row, 'automationId', 'automation_id')),
    automationName: toNullableString(firstDefined(row, 'automationName', 'automation_name')),
    campaignRole: campaignRole === 'source' || campaignRole === 'target' ? campaignRole : undefined,
    sourceCampaignName: toNullableString(firstDefined(row, 'sourceCampaignName', 'source_campaign_name')),
    targetCampaignName: toNullableString(firstDefined(row, 'targetCampaignName', 'target_campaign_name')),
    targetCampaignId: toNullableNumber(firstDefined(row, 'targetCampaignId', 'target_campaign_id')),
    sourceCampaignDetailId: toNumberValue(firstDefined(row, 'sourceCampaignDetailId', 'source_campaign_detail_id')),
    sourceInputDataId: toNumberValue(firstDefined(
      row,
      'sourceInputDataId',
      'sourceCampaignInputDataId',
      'source_campaign_input_data_id'
    )),
    targetInputDataId: toNullableNumber(firstDefined(row, 'targetInputDataId', 'target_input_data_id')),
    targetContactGroupMemberId: toNullableNumber(firstDefined(
      row,
      'targetContactGroupMemberId',
      'target_contact_group_member_id'
    )),
    targetDataGroupId: toNullableNumber(firstDefined(
      row,
      'targetDataGroupId',
      'target_data_group_id'
    )),
    targetDataGroupMemberId: toNullableNumber(firstDefined(
      row,
      'targetDataGroupMemberId',
      'target_data_group_member_id'
    )),
    targetDataGroupSyncStatus: toNullableString(firstDefined(
      row,
      'targetDataGroupSyncStatus',
      'target_data_group_sync_status'
    )) as AutomationExecution['targetDataGroupSyncStatus'],
    targetDataGroupSyncError: toNullableString(firstDefined(
      row,
      'targetDataGroupSyncError',
      'target_data_group_sync_error'
    )),
    sourceStatus: toStringValue(firstDefined(row, 'sourceStatus', 'source_status')),
    dataType: toStringValue(firstDefined(row, 'dataType', 'dataTypeCode', 'data_type_code')) as AutomationDataType,
    dataValue: toStringValue(firstDefined(row, 'dataValue', 'data_value')),
    triggeredAt: toStringValue(firstDefined(row, 'triggeredAt', 'triggered_at', 'createdAt', 'created_at')),
    scheduledAt: toStringValue(firstDefined(row, 'scheduledAt', 'scheduled_at')),
    processedAt: toNullableString(firstDefined(row, 'processedAt', 'processed_at')),
    status: AUTOMATION_EXECUTION_STATUSES.has(status) ? status : 'lỗi',
    attemptCount: toNumberValue(firstDefined(row, 'attemptCount', 'attempt_count')),
    errorMessage: toNullableString(firstDefined(row, 'errorMessage', 'error_message', 'last_error')),
    dataSnapshot: asRecord(firstDefined(row, 'dataSnapshot', 'data_snapshot', 'sourceInputSnapshot', 'source_input_snapshot')),
    targetResultStatus: toNullableString(firstDefined(row, 'targetResultStatus', 'target_result_status')),
    targetResultCount: Math.max(0, Math.floor(toNumberValue(firstDefined(row, 'targetResultCount', 'target_result_count')))),
    targetContactGroupName: toNullableString(firstDefined(row, 'targetContactGroupName', 'target_contact_group_name')),
    targetDataGroupName: toNullableString(firstDefined(row, 'targetDataGroupName', 'target_data_group_name')),
    createdAt: toNullableString(firstDefined(row, 'createdAt', 'created_at')) ?? undefined,
    updatedAt: toNullableString(firstDefined(row, 'updatedAt', 'updated_at')) ?? undefined
  }
}

function normalizeTriggerConditions(value: unknown): AutomationTriggerCondition[] {
  if (!Array.isArray(value)) throw new Error('Vui lòng chọn ít nhất một trạng thái kích hoạt.')
  const seen = new Set<string>()
  const result: AutomationTriggerCondition[] = []
  for (const item of value) {
    const row = asRecord(item)
    const status = toStringValue(row.status).trim()
    const actionCode = normalizeTriggerActionCode(firstDefined(row, 'actionCode', 'action_code'))
    const statusMappingId = toNullableNumber(firstDefined(row, 'statusMappingId', 'status_mapping_id'))
    const semanticStatusId = toNullableNumber(firstDefined(
      row,
      'semanticStatusId',
      'semantic_status_id',
      'statusId',
      'status_id'
    ))
    if (!status) continue
    if (status.length > 120 || (actionCode && actionCode.length > 120)) {
      throw new Error('Trạng thái kích hoạt không hợp lệ.')
    }
    const key = statusMappingId
      ? `mapping\u0000${statusMappingId}`
      : `scope\u0000${actionCode || ''}\u0000${normalizeTriggerStatus(status)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      statusMappingId,
      semanticStatusId,
      actionCode,
      actionName: toNullableString(firstDefined(
        row,
        'actionName',
        'action_name',
        'accountActionName',
        'account_action_name'
      )),
      isWildcard: toBooleanValue(firstDefined(row, 'isWildcard', 'is_wildcard'), actionCode === null),
      status,
      statusLabel: toStringValue(firstDefined(row, 'statusLabel', 'status_label'), status)
    })
  }
  if (result.length === 0) throw new Error('Vui lòng chọn ít nhất một trạng thái kích hoạt.')
  return result
}

function normalizeAutomationInput(input: AutomationInput): Required<Pick<AutomationInput,
  'name' | 'sourceCampaignId' | 'targetCampaignId' | 'dataType' | 'scheduleMode' | 'triggerConditions'
>> & Omit<AutomationInput,
  'name' | 'sourceCampaignId' | 'targetCampaignId' | 'dataType' | 'scheduleMode' | 'triggerConditions'
> {
  const name = toStringValue(input?.name).trim()
  if (!name) throw new Error('Vui lòng nhập tên tự động hóa.')
  if (name.length > 200) throw new Error('Tên tự động hóa không được quá 200 ký tự.')
  const sourceCampaignId = normalizePositiveId(input?.sourceCampaignId, 'Chiến dịch A')
  const targetCampaignId = input?.targetCampaignId === null || input?.targetCampaignId === undefined
    ? null
    : normalizePositiveId(input.targetCampaignId, 'Chiến dịch đích')
  const targetDataGroupId = input.targetDataGroupId === null || input.targetDataGroupId === undefined
    ? null
    : normalizePositiveId(input.targetDataGroupId, 'Nhóm data dùng chung')
  if (targetCampaignId === null && targetDataGroupId === null) {
    throw new Error('Vui lòng chọn ít nhất một đích: Chiến dịch đích hoặc Nhóm data.')
  }
  if (targetCampaignId !== null && sourceCampaignId === targetCampaignId) {
    throw new Error('Chiến dịch A và chiến dịch B phải khác nhau.')
  }
  if (!AUTOMATION_DATA_TYPES.has(input?.dataType)) throw new Error('Loại dữ liệu không hợp lệ.')
  if (!AUTOMATION_SCHEDULE_MODES.has(input?.scheduleMode)) throw new Error('Thời gian chạy không hợp lệ.')

  let delayValue: number | null = null
  let delayUnit: AutomationDelayUnit | null = null
  let delayExactTime: string | null = null
  let delayDays = 0
  let delayHours = 0
  let dailyTime: string | null = null
  let fixedAt: string | null = null

  if (input.scheduleMode === 'after_delay') {
    const hasCanonicalDelay = (
      input.delayValue !== null && input.delayValue !== undefined
    ) || (
      input.delayUnit !== null && input.delayUnit !== undefined
    )
    if (hasCanonicalDelay) {
      const rawUnit = input.delayUnit
      const rawValue = Number(input.delayValue)
      if (!rawUnit || !AUTOMATION_DELAY_UNITS.has(rawUnit)) {
        throw new Error('Đơn vị thời gian chờ không hợp lệ.')
      }
      if (
        !Number.isSafeInteger(rawValue) ||
        rawValue <= 0 ||
        rawValue > AUTOMATION_DELAY_MAX_BY_UNIT[rawUnit]
      ) {
        throw new Error('Thời gian chờ phải là số nguyên dương và không vượt quá 3.650 ngày.')
      }
      delayValue = rawValue
      delayUnit = rawUnit
      const legacyParts = legacyDelayParts(delayValue, delayUnit)
      delayDays = legacyParts.delayDays
      delayHours = legacyParts.delayHours
    } else {
      const legacyDays = Number(input.delayDays ?? 0)
      const legacyHours = Number(input.delayHours ?? 0)
      const totalHours = legacyDays * 24 + legacyHours
      if (
        !Number.isSafeInteger(legacyDays) ||
        legacyDays < 0 ||
        legacyDays > AUTOMATION_DELAY_MAX_BY_UNIT.day ||
        !Number.isSafeInteger(legacyHours) ||
        legacyHours < 0 ||
        legacyHours > 23 ||
        totalHours <= 0 ||
        totalHours > AUTOMATION_DELAY_MAX_BY_UNIT.hour
      ) {
        throw new Error('Thời gian chờ phải là số nguyên dương và không vượt quá 3.650 ngày.')
      }
      delayDays = legacyDays
      delayHours = legacyHours
      if (legacyDays > 0 && legacyHours === 0) {
        delayValue = legacyDays
        delayUnit = 'day'
      } else {
        delayValue = totalHours
        delayUnit = 'hour'
      }
    }
    const rawDelayExactTime = toStringValue(input.delayExactTime).trim()
    if (rawDelayExactTime) {
      if (!DAILY_TIME_PATTERN.test(rawDelayExactTime)) {
        throw new Error('Giờ chạy cụ thể phải đúng định dạng HH:mm.')
      }
      delayExactTime = rawDelayExactTime
    }
  } else if (input.scheduleMode === 'daily_time') {
    const rawDailyTime = toStringValue(input.dailyTime).trim()
    if (!DAILY_TIME_PATTERN.test(rawDailyTime)) {
      throw new Error('Giờ chạy phải đúng định dạng HH:mm.')
    }
    dailyTime = rawDailyTime
  } else if (input.scheduleMode === 'fixed_at') {
    const date = new Date(String(input.fixedAt || ''))
    if (Number.isNaN(date.getTime())) throw new Error('Ngày giờ kích hoạt không hợp lệ.')
    if ((input.isActive ?? true) && date.getTime() <= Date.now()) {
      throw new Error('Ngày giờ kích hoạt phải lớn hơn thời điểm hiện tại.')
    }
    fixedAt = date.toISOString()
  }

  const targetContactGroupId = input.targetContactGroupId === null || input.targetContactGroupId === undefined
    ? null
    : normalizePositiveId(input.targetContactGroupId, 'Nhóm dữ liệu')
  if (targetCampaignId === null && targetContactGroupId !== null) {
    throw new Error('Nhóm dữ liệu cũ chỉ dùng được khi có chiến dịch đích.')
  }
  const note = toStringValue(input.note).trim() || null
  if (note && note.length > 2000) throw new Error('Ghi chú không được quá 2000 ký tự.')

  return {
    name,
    sourceCampaignId,
    targetCampaignId,
    dataType: input.dataType,
    targetContactGroupId,
    targetDataGroupId,
    scheduleMode: input.scheduleMode,
    delayValue,
    delayUnit,
    delayExactTime,
    dailyTime,
    delayDays,
    delayHours,
    fixedAt,
    note,
    isActive: input.isActive ?? true,
    actionType: 'campaign_detail_route',
    triggerConditions: normalizeTriggerConditions(input.triggerConditions)
  }
}

function mapAutomationActionOption(value: unknown): AutomationActionOption | null {
  const row = asRecord(value)
  const id = toStringValue(firstDefined(row, 'id', 'code', 'actionType', 'action_type')) as AutomationActionOption['id']
  if (!['campaign_detail_route', 'zalo_friend_status_check', 'akaagent_campaign_notification'].includes(id)) return null
  return {
    id,
    name: toStringValue(row.name),
    description: toNullableString(row.description),
    isAvailable: toBooleanValue(firstDefined(row, 'isAvailable', 'is_available')),
    isActive: toBooleanValue(firstDefined(row, 'isActive', 'is_active'), true),
    sortOrder: toNumberValue(firstDefined(row, 'sortOrder', 'sort_order'))
  }
}

function mapCampaignOption(
  value: unknown,
  actionDataTypes: Map<string, {
    dataTypes: AutomationDataType[]
    contactTypeByDataType: Partial<Record<AutomationDataType, AutomationContactGroupOption['contactType']>>
  }>
): AutomationCampaignOption | null {
  const row = asRecord(value)
  const id = toNumberValue(row.id)
  const actionId = toStringValue(firstDefined(row, 'actionId', 'action_id'))
  const accountId = toNumberValue(firstDefined(row, 'accountId', 'account_id'))
  if (!id || !actionId || !accountId) return null
  const rawDataTypes = firstDefined(row, 'dataTypes', 'data_types')
  const inlineContactTypes: Partial<Record<AutomationDataType, AutomationContactGroupOption['contactType']>> = {}
  const dataTypes = Array.from(new Set(
    (Array.isArray(rawDataTypes) ? rawDataTypes : actionDataTypes.get(actionId)?.dataTypes || [])
      .map(value => {
        const mapping = asRecord(value)
        const code = toStringValue(firstDefined(mapping, 'code', 'dataType', 'data_type_code') ?? value) as AutomationDataType
        const contactType = toNullableString(firstDefined(mapping, 'targetContactType', 'target_contact_type'))
        if (AUTOMATION_DATA_TYPES.has(code) && contactType) {
          inlineContactTypes[code] = contactType as AutomationContactGroupOption['contactType']
        }
        return code
      })
      .filter(value => AUTOMATION_DATA_TYPES.has(value))
  ))
  return {
    id,
    name: toStringValue(row.name),
    actionId,
    actionName: toNullableString(firstDefined(row, 'actionName', 'action_name')) ?? undefined,
    accountId,
    accountName: toNullableString(firstDefined(row, 'accountName', 'account_name')) ?? undefined,
    platformType: toStringValue(firstDefined(row, 'platformType', 'platform_type', 'flatformType', 'flatform_type')),
    status: toStringValue(row.status),
    dataTypes,
    contactTypeByDataType: {
      ...(actionDataTypes.get(actionId)?.contactTypeByDataType || {}),
      ...inlineContactTypes
    }
  }
}

function mapTriggerOption(value: unknown): AutomationTriggerOption | null {
  const row = asRecord(value)
  const campaignActionId = toStringValue(firstDefined(row, 'campaignActionId', 'campaign_action_id'))
  const status = toStringValue(firstDefined(row, 'status', 'statusValue', 'status_value')).trim()
  if (!campaignActionId || !status) return null
  const statusMappingId = toNullableNumber(firstDefined(
    row,
    'statusMappingId',
    'status_mapping_id',
    'mappingId',
    'mapping_id',
    'id'
  ))
  const semanticStatusId = toNullableNumber(firstDefined(
    row,
    'semanticStatusId',
    'semantic_status_id',
    'statusId',
    'status_id'
  ))
  const actionCode = normalizeTriggerActionCode(firstDefined(row, 'actionCode', 'action_code'))
  return {
    campaignActionId,
    statusMappingId,
    semanticStatusId,
    actionCode,
    actionName: toNullableString(firstDefined(
      row,
      'actionName',
      'action_name',
      'accountActionName',
      'account_action_name'
    )),
    isWildcard: toBooleanValue(firstDefined(row, 'isWildcard', 'is_wildcard'), actionCode === null),
    status,
    statusLabel: toStringValue(firstDefined(row, 'statusLabel', 'status_label', 'statusName', 'status_name', 'label'), status)
  }
}

function mapContactGroupOption(value: unknown): AutomationContactGroupOption | null {
  const row = asRecord(value)
  const id = toNumberValue(row.id)
  const accountId = toNumberValue(firstDefined(row, 'accountId', 'account_id'))
  if (!id || !accountId) return null
  return {
    id,
    name: toStringValue(row.name),
    accountId,
    contactType: toStringValue(firstDefined(row, 'contactType', 'contact_type'), 'person') as AutomationContactGroupOption['contactType']
  }
}

export async function listAutomations(query: AutomationListQuery = {}): Promise<AutomationListResult> {
  const user = requireCurrentUser()
  const page = normalizePage(query.page)
  const pageSize = normalizePageSize(query.pageSize)
  const sourceCampaignId = query.sourceCampaignId === undefined
    ? null
    : normalizePositiveId(query.sourceCampaignId, 'Chiến dịch A')
  const targetCampaignId = query.targetCampaignId === undefined
    ? null
    : normalizePositiveId(query.targetCampaignId, 'Chiến dịch B')
  const dataType = query.dataType && AUTOMATION_DATA_TYPES.has(query.dataType) ? query.dataType : null
  const sortMap = {
    name: 'name',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    lastDataAt: 'last_data_at',
    isActive: 'is_active'
  } as const
  const payload = await invokeRpc<unknown>(RPC_LIST, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_search: toStringValue(query.search).trim() || null,
    p_is_active: typeof query.isActive === 'boolean' ? query.isActive : null,
    p_data_type_code: dataType,
    p_source_campaign_id: sourceCampaignId,
    p_target_campaign_id: targetCampaignId,
    p_updated_from: normalizeUpdatedFrom(query.updatedFrom),
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_sort_by: sortMap[query.sortBy || 'updatedAt'],
    p_sort_direction: query.sortDirection === 'asc' ? 'asc' : 'desc'
  }, 'Không thể tải danh sách tự động hóa.')
  const result = asRecord(Array.isArray(payload) ? payload[0] : payload)
  return {
    items: asRecordArray(firstDefined(result, 'items', 'data')).map(mapAutomationFromRpc),
    total: toNumberValue(firstDefined(result, 'total', 'totalCount', 'total_count')),
    page,
    pageSize
  }
}

export async function getAutomation(id: number): Promise<Automation> {
  const user = requireCurrentUser()
  const automationId = normalizePositiveId(id, 'Tự động hóa')
  const payload = await invokeRpc<unknown>(RPC_GET, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_automation_id: automationId
  }, 'Không thể tải tự động hóa.')
  const row = Array.isArray(payload) ? payload[0] : payload
  if (!row) throw new Error('Không tìm thấy tự động hóa.')
  return mapAutomationFromRpc(row)
}

async function listAllAutomationDataGroups(): Promise<AutomationOptions['dataGroups']> {
  const pageSize = MAX_PAGE_SIZE
  const firstPage = await dataGroupRepo.listDataGroups({ offset: 0, limit: pageSize })
  const expectedPageCount = Math.max(1, Math.ceil(firstPage.total / pageSize))
  const groups = [...firstPage.groups]
  const seenGroupIds = new Set(groups.map(group => group.id))

  // Use the total captured by the first page as a bounded snapshot. This keeps
  // pagination finite even if groups are added continuously while options load.
  for (let pageIndex = 1; pageIndex < expectedPageCount; pageIndex += 1) {
    const page = await dataGroupRepo.listDataGroups({
      offset: pageIndex * pageSize,
      limit: pageSize
    })
    for (const group of page.groups) {
      if (seenGroupIds.has(group.id)) continue
      seenGroupIds.add(group.id)
      groups.push(group)
    }
    if (page.groups.length < pageSize) break
  }

  return groups
}

export async function getAutomationOptions(): Promise<AutomationOptions> {
  const user = requireCurrentUser()
  const [payload, dataGroups] = await Promise.all([
    invokeRpc<unknown>(RPC_OPTIONS, {
      p_staff_id: user.staffId,
      p_organization_id: user.organizationId
    }, 'Không thể tải dữ liệu tạo tự động hóa.'),
    listAllAutomationDataGroups().catch(error => {
      // Campaign-only rules must remain usable if the optional Data Group
      // catalog is temporarily unavailable.
      console.warn('[Automation] Không thể tải Nhóm data:', error)
      return []
    })
  ])
  const result = asRecord(Array.isArray(payload) ? payload[0] : payload)
  const actionDataTypes = new Map<string, {
    dataTypes: AutomationDataType[]
    contactTypeByDataType: Partial<Record<AutomationDataType, AutomationContactGroupOption['contactType']>>
  }>()
  for (const item of asRecordArray(firstDefined(result, 'actionDataTypes', 'action_data_types'))) {
    const actionId = toStringValue(firstDefined(item, 'campaignActionId', 'campaign_action_id', 'actionId', 'action_id'))
    const dataType = toStringValue(firstDefined(item, 'dataType', 'dataTypeCode', 'data_type_code')) as AutomationDataType
    if (!actionId || !AUTOMATION_DATA_TYPES.has(dataType)) continue
    const current = actionDataTypes.get(actionId) || { dataTypes: [], contactTypeByDataType: {} }
    const contactType = toNullableString(firstDefined(item, 'targetContactType', 'target_contact_type'))
    actionDataTypes.set(actionId, {
      dataTypes: [...current.dataTypes, dataType],
      contactTypeByDataType: {
        ...current.contactTypeByDataType,
        ...(contactType ? { [dataType]: contactType as AutomationContactGroupOption['contactType'] } : {})
      }
    })
  }
  const triggerOptions = [
    ...asRecordArray(firstDefined(result, 'catalogStatuses', 'catalog_statuses', 'statusMappings', 'status_mappings')),
    ...asRecordArray(firstDefined(result, 'triggerOptions', 'statusOptions', 'status_options'))
  ]
    .map(mapTriggerOption)
    .filter((item): item is AutomationTriggerOption => !!item)
  const mappedTriggerScopes = new Set(
    triggerOptions
      .filter(item => !!item.statusMappingId)
      .map(triggerScopeKey)
  )
  const triggerOptionKeys = new Set<string>()

  return {
    actions: asRecordArray(firstDefined(result, 'actions', 'automationActions', 'automation_actions'))
      .map(mapAutomationActionOption)
      .filter((item): item is AutomationActionOption => !!item)
      .sort((left, right) => left.sortOrder - right.sortOrder),
    campaigns: asRecordArray(result.campaigns)
      .map(item => mapCampaignOption(item, actionDataTypes))
      .filter((item): item is AutomationCampaignOption => !!item),
    triggerOptions: triggerOptions.filter(item => {
      if (!item.statusMappingId && mappedTriggerScopes.has(triggerScopeKey(item))) return false
      const key = triggerIdentityKey(item)
      if (triggerOptionKeys.has(key)) return false
      triggerOptionKeys.add(key)
      return true
    }),
    contactGroups: asRecordArray(firstDefined(result, 'contactGroups', 'contact_groups'))
      .map(mapContactGroupOption)
      .filter((item): item is AutomationContactGroupOption => !!item),
    dataGroups
  }
}

async function saveAutomation(id: number | null, input: AutomationInput): Promise<Automation> {
  const user = requireCurrentUser()
  const normalized = normalizeAutomationInput(input)
  const payload = await invokeRpc<unknown>(RPC_SAVE, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_automation_id: id,
    p_name: normalized.name,
    p_source_campaign_id: normalized.sourceCampaignId,
    p_target_campaign_id: normalized.targetCampaignId,
    p_data_type_code: normalized.dataType,
    p_target_contact_group_id: normalized.targetContactGroupId ?? null,
    p_target_data_group_id: normalized.targetDataGroupId ?? null,
    p_schedule_mode: normalized.scheduleMode,
    p_delay_days: normalized.delayDays ?? 0,
    p_delay_hours: normalized.delayHours ?? 0,
    p_fixed_at: normalized.fixedAt ?? null,
    p_note: normalized.note ?? null,
    p_is_active: normalized.isActive ?? true,
    p_trigger_statuses: normalized.triggerConditions.map(condition => ({
      statusMappingId: condition.statusMappingId ?? null,
      actionCode: condition.actionCode || null,
      statusValue: condition.status
    })),
    p_delay_value: normalized.delayValue ?? null,
    p_delay_unit: normalized.delayUnit ?? null,
    p_delay_exact_time: normalized.delayExactTime ?? null,
    p_delay_exact_time_present: true,
    p_daily_time: normalized.dailyTime ?? null
  }, id ? 'Không thể cập nhật tự động hóa.' : 'Không thể tạo tự động hóa.')
  return mapAutomationFromRpc(Array.isArray(payload) ? payload[0] : payload)
}

export function createAutomation(input: AutomationInput): Promise<Automation> {
  return saveAutomation(null, input)
}

export function updateAutomation(id: number, input: AutomationInput): Promise<Automation> {
  return saveAutomation(normalizePositiveId(id, 'Tự động hóa'), input)
}

export async function setAutomationActive(id: number, isActive: boolean): Promise<Automation> {
  const user = requireCurrentUser()
  const payload = await invokeRpc<unknown>(RPC_SET_ACTIVE, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_automation_id: normalizePositiveId(id, 'Tự động hóa'),
    p_is_active: isActive === true
  }, 'Không thể thay đổi trạng thái tự động hóa.')
  return mapAutomationFromRpc(Array.isArray(payload) ? payload[0] : payload)
}

export async function deleteAutomation(id: number): Promise<void> {
  const user = requireCurrentUser()
  await invokeRpc<unknown>(RPC_DELETE, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_automation_id: normalizePositiveId(id, 'Tự động hóa')
  }, 'Không thể xóa tự động hóa.')
}

export async function listAutomationDetails(
  automationId: number,
  query: AutomationExecutionListQuery = {}
): Promise<AutomationExecutionListResult> {
  const user = requireCurrentUser()
  const page = normalizePage(query.page)
  const pageSize = normalizePageSize(query.pageSize)
  const status = query.status && AUTOMATION_EXECUTION_STATUSES.has(query.status) ? query.status : null
  const payload = await invokeRpc<unknown>(RPC_LIST_DETAILS, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_automation_id: normalizePositiveId(automationId, 'Tự động hóa'),
    p_status: status,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize
  }, 'Không thể tải dữ liệu kích hoạt.')
  const result = asRecord(Array.isArray(payload) ? payload[0] : payload)
  return {
    items: asRecordArray(firstDefined(result, 'items', 'data')).map(mapAutomationExecutionFromRpc),
    total: toNumberValue(firstDefined(result, 'total', 'totalCount', 'total_count')),
    page,
    pageSize
  }
}

export async function listCampaignAutomationDetails(
  query: CampaignAutomationExecutionListQuery
): Promise<CampaignAutomationExecutionListResult> {
  const user = requireCurrentUser()
  const campaignId = normalizePositiveId(query.campaignId, 'Chiến dịch')
  const role = CAMPAIGN_AUTOMATION_EXECUTION_ROLES.has(query.role || 'all')
    ? query.role || 'all'
    : 'all'
  const status = query.status && AUTOMATION_EXECUTION_STATUSES.has(query.status)
    ? query.status
    : null
  const search = toStringValue(query.search).trim() || null
  const dateFrom = normalizeAutomationHistoryDate(query.dateFrom, 'Ngày bắt đầu')
  const dateTo = normalizeAutomationHistoryDate(query.dateTo, 'Ngày kết thúc')
  if (dateFrom && dateTo && new Date(dateFrom).getTime() > new Date(dateTo).getTime()) {
    throw new Error('Khoảng ngày lịch sử tự động hóa không hợp lệ.')
  }
  const offsetValue = Math.floor(Number(query.offset))
  const limitValue = Math.floor(Number(query.limit))
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0
  const limit = Number.isSafeInteger(limitValue) && limitValue > 0
    ? Math.min(limitValue, 500)
    : 100

  const payload = await invokeRpc<unknown>(RPC_LIST_CAMPAIGN_DETAILS, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_campaign_id: campaignId,
    p_role: role,
    p_status: status,
    p_search: search,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_limit: limit,
    p_offset: offset
  }, 'Không thể tải lịch sử tự động hóa của chiến dịch.')
  const result = asRecord(Array.isArray(payload) ? payload[0] : payload)
  return {
    items: asRecordArray(firstDefined(result, 'items', 'data')).map(mapAutomationExecutionFromRpc),
    total: Math.max(0, Math.floor(toNumberValue(firstDefined(result, 'total', 'totalCount', 'total_count')))),
    offset: Math.max(0, Math.floor(toNumberValue(firstDefined(result, 'offset'), offset))),
    limit: Math.max(1, Math.floor(toNumberValue(firstDefined(result, 'limit'), limit)))
  }
}

function mapClaimedAutomationDetail(value: unknown): ClaimedAutomationDetail | null {
  const row = asRecord(value)
  const automationDetailId = toNumberValue(firstDefined(row, 'automationDetailId', 'automation_detail_id'))
  const dataType = toStringValue(firstDefined(row, 'dataType', 'dataTypeCode', 'data_type_code')) as AutomationDataType
  if (!automationDetailId || !AUTOMATION_DATA_TYPES.has(dataType)) return null
  return {
    automationDetailId,
    automationId: toNumberValue(firstDefined(row, 'automationId', 'automation_id')),
    parentAutomationDetailId: toNullableNumber(firstDefined(row, 'parentAutomationDetailId', 'parent_automation_detail_id')),
    sourceCampaignDetailId: toNumberValue(firstDefined(row, 'sourceCampaignDetailId', 'source_campaign_detail_id')),
    sourceCampaignInputDataId: toNumberValue(firstDefined(row, 'sourceCampaignInputDataId', 'source_campaign_input_data_id')),
    sourceCampaignId: toNumberValue(firstDefined(row, 'sourceCampaignId', 'source_campaign_id')),
    sourceAccountId: toNumberValue(firstDefined(row, 'sourceAccountId', 'source_account_id')),
    sourceActionId: toStringValue(firstDefined(row, 'sourceActionId', 'source_action_id')),
    sourceActionCode: toNullableString(firstDefined(row, 'sourceActionCode', 'source_action_code')),
    sourceStatus: toStringValue(firstDefined(row, 'sourceStatus', 'source_status')),
    targetCampaignId: toNullableNumber(firstDefined(row, 'targetCampaignId', 'target_campaign_id')),
    targetAccountId: toNullableNumber(firstDefined(row, 'targetAccountId', 'target_account_id')),
    targetActionId: toNullableString(firstDefined(row, 'targetActionId', 'target_action_id')),
    dataType,
    dataValue: toStringValue(firstDefined(row, 'dataValue', 'data_value')),
    sourceInputSnapshot: asRecord(firstDefined(row, 'sourceInputSnapshot', 'source_input_snapshot')),
    configSnapshot: asRecord(firstDefined(row, 'configSnapshot', 'config_snapshot')),
    targetContactGroupId: toNullableNumber(firstDefined(row, 'targetContactGroupId', 'target_contact_group_id')),
    targetDataGroupId: toNullableNumber(firstDefined(row, 'targetDataGroupId', 'target_data_group_id')),
    scheduledAt: toStringValue(firstDefined(row, 'scheduledAt', 'scheduled_at')),
    targetRowIndex: toNullableNumber(firstDefined(row, 'targetRowIndex', 'target_row_index')),
    attemptCount: Math.max(0, Math.floor(toNumberValue(firstDefined(row, 'attemptCount', 'attempt_count'))))
  }
}

export async function claimAutomationDetails(
  workerId: string,
  limit = 50,
  context?: AutomationRepositoryContext
): Promise<ClaimedAutomationDetail[]> {
  const user = requireCurrentUser()
  const normalizedWorkerId = toStringValue(workerId).trim()
  if (!normalizedWorkerId) throw new Error('Worker tự động hóa không hợp lệ.')
  const normalizedLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)))
  const rows = await invokeRpc<unknown[]>(RPC_CLAIM_DETAILS, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_worker_id: normalizedWorkerId,
    p_limit: normalizedLimit
  }, 'Không thể nhận dữ liệu tự động hóa.', context)
  return (Array.isArray(rows) ? rows : [])
    .map(mapClaimedAutomationDetail)
    .filter((item): item is ClaimedAutomationDetail => !!item)
}

export async function materializeAutomationDetail(
  automationDetailId: number,
  workerId: string,
  targetInput: JsonRecord,
  context?: AutomationRepositoryContext
): Promise<AutomationMaterializeResult> {
  const user = requireCurrentUser()
  const payload = await invokeRpc<unknown>(RPC_MATERIALIZE_DETAIL, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_automation_detail_id: normalizePositiveId(automationDetailId, 'Lần kích hoạt'),
    p_worker_id: toStringValue(workerId).trim(),
    p_target_input: targetInput
  }, 'Không thể chuyển dữ liệu đến đích đã chọn.', context)
  const row = asRecord(Array.isArray(payload) ? payload[0] : payload)
  return {
    code: toStringValue(firstDefined(row, 'code', 'result', 'resultCode', 'result_code'), 'failed'),
    automationDetailId: toNullableNumber(firstDefined(row, 'automationDetailId', 'automation_detail_id')) ?? undefined,
    targetInputDataId: toNullableNumber(firstDefined(row, 'targetInputDataId', 'target_input_data_id')),
    targetContactId: toNullableNumber(firstDefined(row, 'targetContactId', 'target_contact_id')),
    targetContactGroupMemberId: toNullableNumber(firstDefined(row, 'targetContactGroupMemberId', 'target_contact_group_member_id')),
    targetDataGroupMemberId: toNullableNumber(firstDefined(row, 'targetDataGroupMemberId', 'target_data_group_member_id')),
    targetRowIndex: toNullableNumber(firstDefined(row, 'targetRowIndex', 'target_row_index')),
    error: toNullableString(firstDefined(row, 'error', 'errorMessage', 'error_message'))
  }
}

export async function ingestAutomationDataGroupResult(
  automationDetailId: number,
  context?: AutomationRepositoryContext
): Promise<AutomationDataGroupIngestResult> {
  const user = requireCurrentUser()
  const payload = await invokeRpc<unknown>('aka_agent_ingest_automation_data_group_result', {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_automation_detail_id: normalizePositiveId(automationDetailId, 'Lần kích hoạt')
  }, 'Không thể thêm kết quả tự động hóa vào Nhóm data.', context)
  const row = asRecord(Array.isArray(payload) ? payload[0] : payload)
  return {
    code: toStringValue(firstDefined(row, 'code', 'result_code'), 'skipped'),
    targetDataGroupMemberId: toNullableNumber(firstDefined(
      row,
      'targetDataGroupMemberId',
      'target_data_group_member_id',
      'membershipId',
      'membership_id'
    )),
    insertedInputCount: Math.max(0, Math.floor(toNumberValue(firstDefined(row, 'insertedInputCount', 'inserted_input_count')))),
    alreadySeenInputCount: Math.max(0, Math.floor(toNumberValue(firstDefined(row, 'alreadySeenInputCount', 'already_seen_input_count')))),
    error: toNullableString(firstDefined(row, 'error', 'errorMessage', 'error_message'))
  }
}

export async function retryAutomationDetail(
  automationDetailId: number,
  workerId: string,
  options: RetryAutomationDetailOptions,
  context?: AutomationRepositoryContext
): Promise<void> {
  const user = requireCurrentUser()
  await invokeRpc<unknown>(RPC_RETRY_DETAIL, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_automation_detail_id: normalizePositiveId(automationDetailId, 'Lần kích hoạt'),
    p_worker_id: toStringValue(workerId).trim(),
    p_error: toStringValue(options.error).slice(0, 2000),
    p_delay_seconds: Math.max(0, Math.floor(Number(options.delaySeconds) || 0)),
    p_terminal: options.terminal === true,
    p_skip: options.skip === true,
    p_count_attempt: options.countAttempt !== false
  }, 'Không thể cập nhật lần kích hoạt.', context)
}

export async function recoverStaleAutomationDetails(
  staleAfterSeconds = 120,
  context?: AutomationRepositoryContext
): Promise<number> {
  const user = requireCurrentUser()
  const result = await invokeRpc<unknown>(RPC_RECOVER_STALE, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_stale_after_seconds: Math.max(30, Math.floor(Number(staleAfterSeconds) || 120))
  }, 'Không thể khôi phục dữ liệu tự động hóa.', context)
  if (Array.isArray(result)) {
    const row = asRecord(result[0])
    return toNumberValue(firstDefined(row, 'count', 'recoveredCount', 'recovered_count'))
  }
  if (result && typeof result === 'object') {
    const row = asRecord(result)
    return toNumberValue(firstDefined(row, 'count', 'recoveredCount', 'recovered_count'))
  }
  return toNumberValue(result)
}

export async function reconcileAutomationEnqueueFailures(
  workerId: string,
  limit = 100,
  context?: AutomationRepositoryContext
): Promise<AutomationEnqueueReconcileResult> {
  const user = requireCurrentUser()
  const normalizedWorkerId = toStringValue(workerId).trim()
  if (!normalizedWorkerId) throw new Error('Worker tự động hóa không hợp lệ.')
  const normalizedLimit = Math.min(500, Math.max(1, Math.floor(Number(limit) || 100)))
  const payload = await invokeRpc<unknown>(RPC_RECONCILE_ENQUEUE_FAILURES, {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_worker_id: normalizedWorkerId,
    p_limit: normalizedLimit
  }, 'Không thể đối soát dữ liệu kích hoạt tự động hóa.', context)
  const row = asRecord(Array.isArray(payload) ? payload[0] : payload)
  return {
    processed: Math.max(0, Math.floor(toNumberValue(row.processed))),
    resolved: Math.max(0, Math.floor(toNumberValue(row.resolved))),
    failed: Math.max(0, Math.floor(toNumberValue(row.failed))),
    pending: Math.max(0, Math.floor(toNumberValue(row.pending)))
  }
}
