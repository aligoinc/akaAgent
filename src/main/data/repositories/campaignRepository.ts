import {
  AccountActionLimitStatus,
  ActionLimitConfig,
  AuthEntitlements,
  Campaign,
  CampaignConfig,
  CampaignListItem,
  CampaignLogSnapshot,
  CampaignUpdate,
  CampaignActionLimitSettings,
  CampaignInput,
  CampaignInputData,
  CampaignInputDataOrigin,
  CampaignInputDataPageQuery,
  CampaignInputDataPageResult,
  CampaignInputStatus,
  CampaignStatus,
  CampaignDataGroupSourceStatus,
  CampaignDetail,
  CampaignDetailPageQuery,
  CampaignDetailPageResult,
  CampaignDetailStatus,
  CreateCampaignDetailInput,
  CampaignRelationSummary,
  AddCampaignInputDataRowsRequest,
  AddCampaignInputDataRowsResult,
  AddCampaignInputDataToCampaignRequest,
  AddCampaignInputDataToCampaignResult,
  AutoAccount,
  AutoAccountContact,
  AutoAccountActionStatus,
  BulkDeleteCampaignInputDataResult,
  BulkUpdateCampaignInputDataStatusResult,
  ContactListResult,
  actionSupportsDataGroup,
  getCampaignInputDataRequirement,
  isCampaignInputDataValidForAction,
  ZaloRemarketingCustomerListQuery
} from '../../../shared/types'
import { getVietnamMobileCarrier, normalizeVietnamMobilePhone, type VietnamMobileCarrier } from '../../../shared/phone'
import { MAX_SMS_ADVANCED_CONTENT_ITEMS, renderSmsInputContent, renderVoiceCallInputContent } from '../../../shared/smsContent'
import { getAdvancedContentItems } from '../../../shared/advancedContent'
import { getSupabaseClient } from '../supabaseClient'
import { mapCampaignConfigFromDB, mapCampaignFromDB, mapCampaignInputFromDB, mapCampaignInputDataFromDB, mapCampaignDetailFromDB, mapCampaignListItemFromDB } from '../mappers'
import {
  getCurrentUserCredentials,
  requireCurrentUser,
  requireCurrentUserCredentials
} from '../currentUser'
import { formatStoredCampaignLogLine } from '../../../shared/campaignLogFormat'
import * as accountActionRepo from './accountActionRepository'
import * as accountRepo from './accountRepository'
import {
  finalizeDataGroupCampaign,
  listDataGroups,
  type DataGroupRuntimeContext
} from './dataGroupRepository'
import * as errorPolicyRepo from './errorPolicyRepository'
import {
  canUseCampaignActionWithEntitlements,
  ensureCurrentUserCanUseCampaignAction,
  getAccountActionDailySendLimit,
  getCampaignActionDailySendLimit,
  loadCurrentUserZaloAccountCapabilities,
  loadCurrentUserEffectiveEntitlements,
} from './entitlementRepository'
import { randomUUID } from 'node:crypto'

const client = () => getSupabaseClient()

export type CampaignDeliveryCooldownDecisionCode =
  | 'allowed'
  | 'paused_recent_delivery'
  | 'paused_unidentifiable'
  | 'deferred_batch_duplicate'
  | 'not_pending'

export interface CampaignDeliveryCooldownDecision {
  inputDataId: number
  decision: CampaignDeliveryCooldownDecisionCode
  note: string | null
  lastSentAt: string | null
  eligibleDate: string | null
  sourceCampaignId: number | null
  sourceCampaignName: string | null
}

export interface ZaloMessageOptOutCheckResult {
  isOptedOut: boolean
  matchedBy: 'phone' | 'zalo_global_id' | null
}

export interface ZaloMessageOptOutPrepareResult {
  id: string
  isOptedOut: boolean
}
const CAMPAIGN_PRIMARY_ACCOUNT_RELATION =
  'primary_account:auto_accounts!auto_campaigns_account_id_fkey(name, flatform_type, is_zalo_show_web, is_zalo_server)'
const CAMPAIGN_RELATIONS =
  `auto_campaign_actions(name), ${CAMPAIGN_PRIMARY_ACCOUNT_RELATION}`
const CAMPAIGN_SELECT = `*, ${CAMPAIGN_RELATIONS}`
const CAMPAIGN_LOG_APPEND_RESULT_SELECT = [
  'id',
  'name',
  'account_id',
  'status',
  'note',
  'schedule',
  'last_run_at',
  'updated_at',
  CAMPAIGN_PRIMARY_ACCOUNT_RELATION
].join(', ')
const CAMPAIGN_CONFIG_SELECT = [
  'id',
  'name',
  'action_id',
  'account_id',
  'secondary_account_id',
  'status',
  'schedule',
  'original_schedule',
  'schedule_type',
  'schedule_end_date',
  'daily_stop_time',
  'schedule_days',
  'schedule_week_days',
  'continue_next_day',
  'refresh_data',
  'content',
  'extra_settings',
  'images',
  'note',
  'is_delete',
  'staff_id',
  'organization_id',
  'created_at',
  'updated_at',
  'completed_at',
  'last_run_at',
  'data_target_source_mode',
  'data_group_id',
  'provisioning_state',
  'creation_bundle_id',
  'creation_bundle_child_index',
  CAMPAIGN_RELATIONS
].join(', ')
const CAMPAIGN_LIST_ITEM_SELECT = [
  'id',
  'name',
  'action_id',
  'account_id',
  'secondary_account_id',
  'status',
  'schedule',
  'original_schedule',
  'schedule_type',
  'schedule_end_date',
  'daily_stop_time',
  'schedule_days',
  'schedule_week_days',
  'continue_next_day',
  'refresh_data',
  'note',
  'is_delete',
  'created_at',
  'updated_at',
  'completed_at',
  'last_run_at',
  'data_target_source_mode',
  'data_group_id',
  'provisioning_state',
  'email_check_link_clicks:extra_settings->emailCheckLinkClicks',
  'is_find_phone:extra_settings->isFindPhone',
  'is_find_link_group_zalo:extra_settings->isFindLinkGroupZalo',
  'is_find_uid:extra_settings->isFindUid',
  'is_find_post_link:extra_settings->isFindPostLink',
  'is_find_facebook_group:extra_settings->isFindFacebookGroup',
  'is_find_in_post:extra_settings->isFindInPost',
  'is_find_in_comment:extra_settings->isFindInComment',
  'is_find_new_interactors:extra_settings->isFindNewInteractors',
  'is_find_in_group_members:extra_settings->isFindInGroupMembers',
  'find_uid_target_campaign_ids:extra_settings->findUidTargetCampaignIds',
  'find_post_link_target_campaign_ids:extra_settings->findPostLinkTargetCampaignIds',
  'find_phone_zalo_message_phone_target_campaign_ids:extra_settings->findPhoneZaloMessagePhoneTargetCampaignIds',
  'find_zalo_group_link_join_target_campaign_ids:extra_settings->findZaloGroupLinkJoinTargetCampaignIds',
  'find_facebook_group_post_target_campaign_ids:extra_settings->findFacebookGroupPostTargetCampaignIds',
  'find_facebook_group_comment_target_campaign_ids:extra_settings->findFacebookGroupCommentTargetCampaignIds',
  'find_facebook_group_join_target_campaign_ids:extra_settings->findFacebookGroupJoinTargetCampaignIds',
  CAMPAIGN_RELATIONS
].join(', ')
const CAMPAIGN_ACTION_STATUS_SELECT =
  `*, auto_campaign_actions(name, is_active, is_delete), ${CAMPAIGN_PRIMARY_ACCOUNT_RELATION}`
const CAMPAIGN_ZALO_REALTIME_SELECT =
  '*, auto_campaign_actions(name), primary_account:auto_accounts!auto_campaigns_account_id_fkey(name, login_status, status, is_active, is_zalo_show_web, is_zalo_server)'
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const VIETNAM_UTC_OFFSET = '+07:00'
const NEWSFEED_INTERACTION_ACTION_ID = 'facebook_newsfeed_interaction'
const FACEBOOK_GROUP_INVITE_ACTION_ID = 'facebook_group_invite'
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const ZALO_MESSAGE_FRIEND_ACTION_ID = 'zalo_message_friend'
const ZALO_MESSAGE_BIRTHDAY_ACTION_ID = 'zalo_message_birthday'
const ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID = 'zalo_message_group_member'
const ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID = 'zalo_message_group_realtime'
const ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID = 'zalo_message_friend_recommendation'
const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID = 'zalo_cancel_sent_friend_request'
const SMS_SEND_ACTION_ID = 'sms_send'
const VOICE_CALL_ACTION_ID = 'voice_call'
const MOBILE_MANAGED_SMS_ACTION_IDS = [SMS_SEND_ACTION_ID, VOICE_CALL_ACTION_ID] as const
const ZALO_FRIEND_AUTO_TARGET_MODES = new Set(['all_friends', 'tagged_friends'])
const ZALO_REMARKETING_SOURCE_ACTION_IDS = [
  ZALO_MESSAGE_PHONE_ACTION_ID,
  ZALO_MESSAGE_FRIEND_ACTION_ID,
  ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID,
  ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID,
  ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
]
const ZALO_REMARKETING_MESSAGE_ACTION_CODES = ['zalo_message_stranger', 'zalo_message_friend']
const ZALO_REMARKETING_DETAIL_FETCH_CHUNK = 1000
const ZALO_REMARKETING_PAGE_DEFAULT_LIMIT = 100
const ZALO_REMARKETING_PAGE_MAX_LIMIT = 20000
const CAMPAIGN_INPUT_DATA_FETCH_CHUNK = 1000
const CAMPAIGN_LIST_PROGRESS_ID_CHUNK = 100
const CAMPAIGN_DATA_GROUP_FALLBACK_GROUP_PAGE_LIMIT = 200
const CAMPAIGN_DATA_GROUP_FALLBACK_GROUP_PAGE_COUNT = 5
const CAMPAIGN_DATA_GROUP_FALLBACK_GROUP_CACHE_MS = 60_000
let hasWarnedCampaignDataGroupSummaryRpcUnavailable = false
let hasWarnedCampaignDataGroupSummaryFallbackFailure = false
const CAMPAIGN_RELATION_SUCCESS_DETAIL_STATUSES: CampaignDetailStatus[] = ['thành công', 'đã xem', 'đã click']
const CAMPAIGN_RELATION_SKIPPED_DETAIL_STATUSES: CampaignDetailStatus[] = ['đã gửi lời mời', 'đã là thành viên']
const FACEBOOK_GROUP_INVITE_SKIPPED_DETAIL_STATUSES: CampaignDetailStatus[] = [
  ...CAMPAIGN_RELATION_SKIPPED_DETAIL_STATUSES,
  'không tồn tại'
]
const CAMPAIGN_RELATION_DETAIL_STATUSES: CampaignDetailStatus[] = [
  ...CAMPAIGN_RELATION_SUCCESS_DETAIL_STATUSES,
  ...CAMPAIGN_RELATION_SKIPPED_DETAIL_STATUSES,
  'thất bại',
  'lỗi',
  'không tồn tại'
]
const CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE = 500
const APPEND_DATA_UNSUPPORTED_ACTION_IDS = new Set([
  NEWSFEED_INTERACTION_ACTION_ID,
  ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID,
  ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
])
const LIMIT_COUNT_STATUSES = ['thành công', 'thất bại']
const VIETNAM_MOBILE_CARRIER_CODES = new Set<VietnamMobileCarrier>([
  'viettel',
  'vinaphone',
  'mobifone',
  'vietnamobile',
  'gmobile',
  'itel',
  'wintel',
  'unknown'
])
const RESTRICTED_CAMPAIGN_CONFIG_UPDATE_KEYS = new Set<keyof Campaign>([
  'name',
  'accountId',
  'secondaryAccountId',
  'scheduleType',
  'scheduleEndDate',
  'dailyStopTime',
  'scheduleDays',
  'scheduleWeekDays',
  'continueNextDay',
  'refreshData',
  'content',
  'extraSettings',
  'images'
])

type CampaignScheduleType = NonNullable<Campaign['scheduleType']>
type InputDataBatchStatus = Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>
export type CampaignRuntimeTarget = 'desktop' | 'server'

export interface CampaignRuntimeClaimV2Result {
  ok: boolean
  reason: string
  campaignStatus: string | null
  accountStatus: string | null
  runtimeClaimToken: string | null
  runtimeClaimVietnamDateKey: string | null
  runtimeClaimedAt: string | null
  dbNow: string
  vietnamDateKey: string
  effectiveStopTime: string | null
  boundaryAt: string | null
}

export interface CampaignRunUnitClaimV2Result {
  ok: boolean
  reason: string
  campaignStatus: string | null
  accountStatus: string | null
  claimedCount: number
  runtimeClaimToken: string | null
  runtimeClaimVietnamDateKey: string | null
  runtimeUnitToken: string | null
  runtimeUnitVietnamDateKey: string | null
  runtimeUnitClaimedAt: string | null
  runtimeUnitInputDataIds: number[]
  dbNow: string
  vietnamDateKey: string
  effectiveStopTime: string | null
  boundaryAt: string | null
}

export interface CampaignRunUnitSettlementV2Result {
  ok: boolean
  reason: string
  campaignStatus: string | null
  accountStatus: string | null
  requeuedCount: number
  dbNow: string
  vietnamDateKey: string
}

export interface CampaignRuntimeUnitRecoveryV2Result {
  ok: boolean
  reason: string
  recoveredLeaseCount: number
  requeuedInputCount: number
  dbNow: string
  vietnamDateKey: string
}

export interface DesktopCampaignStatusV2Result {
  ok: boolean
  reason: string
  campaignStatus: string | null
  accountStatus: string | null
  dbNow: string
  vietnamDateKey: string
}

export interface CampaignDailyBoundaryCheckResult {
  allowNewUnit: boolean
  reason: string
  campaignStatus: string | null
  accountStatus: string | null
  dbNow: string
  vietnamDateKey: string
  claimedVietnamDateKey: string
  effectiveStopTime: string | null
  boundaryAt: string | null
  dayChanged: boolean
}

export interface CampaignDailyBoundaryYieldResult extends Omit<CampaignDailyBoundaryCheckResult, 'allowNewUnit'> {
  ok: boolean
  runningInputCount: number
}

export interface DailyMaintenanceBarrierCheckResult {
  ready: boolean
  runningCampaignCount: number
  dbNow: string
  vietnamDateKey: string
}
type CampaignInputDataProgress = {
  completed: number
  total: number
}

export interface ZaloRealtimeGroupCampaignSnapshot {
  campaign: Campaign
  accountLoginStatus: string
  accountStatus: string
  accountIsActive: boolean
}

export interface EnqueueZaloRealtimeGroupEventRequest {
  runtimeTarget: CampaignRuntimeTarget
  campaignId: number
  accountId: number
  groupId: string
  groupName?: string | null
  triggerType: 'join' | 'leave' | 'interact'
  targetUid: string
  targetName?: string | null
  eventTime?: string | null
  scheduleAt: string
  rawPayload?: Record<string, unknown>
}

export interface EnqueueZaloRealtimeGroupEventResult {
  inserted: boolean
  eventId: number | null
  inputDataId: number | null
}

export type ZaloServerControlStatus = 'chờ xử lý' | 'tạm dừng'

export interface ZaloServerCampaignStatusResult {
  ok: boolean
  reason: 'updated' | 'already_target' | 'not_found' | 'runtime_not_owner' | 'invalid_transition' | string
  campaignId: number
  campaignStatus: string | null
  accountStatus: string | null
}

export interface ZaloServerRunControlState {
  campaignId: number
  accountId: number
  campaignStatus: string | null
  accountStatus: string | null
  accountLoginStatus: string | null
  accountIsActive: boolean
  accountIsDelete: boolean
  campaignIsDelete: boolean
  pauseRequested: boolean
  shouldStop: boolean
  hardStopReason: string | null
}

export interface ZaloServerRunUnitClaimResult {
  ok: boolean
  reason: string
  campaignStatus: string | null
  accountStatus: string | null
  claimedCount: number
}

export interface ZaloServerCampaignFinalizationResult {
  ok: boolean
  reason: string
  campaignId: number
  accountId: number | null
  campaignStatus: string | null
  accountStatus: string | null
}

export interface CampaignFinalizationResult {
  completed: boolean
  reason: string
  campaignId: number
  campaignStatus: string | null
  pendingInputCount: number
}

export interface ZaloServerMultiDailySlotAdvanceResult {
  ok: boolean
  reason: string
  campaignStatus: string | null
  accountStatus: string | null
  resetCount: number
}

const uniquePositiveIds = (ids: number[]): number[] => Array.from(new Set(
  ids
    .map(id => Number(id))
    .filter(id => Number.isFinite(id) && id > 0)
))

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const normalizeCampaignInputPhoneCarrier = (
  phone: unknown,
  explicitCarrier?: string | null
): VietnamMobileCarrier | null => {
  const inferred = getVietnamMobileCarrier(phone)
  if (inferred) return inferred
  const carrier = String(explicitCarrier || '').trim().toLowerCase() as VietnamMobileCarrier
  return VIETNAM_MOBILE_CARRIER_CODES.has(carrier) ? carrier : null
}

const touchesRestrictedCampaignConfig = (updates: Partial<Campaign>): boolean => (
  Object.keys(updates).some(key => RESTRICTED_CAMPAIGN_CONFIG_UPDATE_KEYS.has(key as keyof Campaign))
)

function filterCampaignsByEntitlements<T extends { actionId?: string | null; action_id?: string | null; flatformType?: string | null; flatform_type?: string | null }>(
  campaigns: T[],
  entitlements: Parameters<typeof canUseCampaignActionWithEntitlements>[2]
): T[] {
  return campaigns.filter(campaign => canUseCampaignActionWithEntitlements(
    campaign.actionId ?? campaign.action_id,
    campaign.flatformType ?? campaign.flatform_type,
    entitlements
  ))
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function clampDailyLimitValue(value: unknown, cap: number | null): number | undefined {
  if (value === undefined) return undefined
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return undefined
  if (parsed <= 0) return parsed
  const normalizedCap = normalizePositiveInteger(cap)
  return normalizedCap ? Math.min(parsed, normalizedCap) : parsed
}

function clampActionLimitConfigDailyLimit<T extends ActionLimitConfig>(
  config: T,
  cap: number | null
): T {
  const next = { ...config }
  const dailyLimit = clampDailyLimitValue(config.dailyLimit, cap)
  if (dailyLimit !== undefined) next.dailyLimit = dailyLimit
  return next
}

function clampCampaignExtraSettingsDailyLimits(
  extraSettings: Campaign['extraSettings'] | undefined,
  actionId: string | null | undefined,
  entitlements: Partial<AuthEntitlements> | null | undefined
): Campaign['extraSettings'] {
  const extra = { ...(extraSettings || {}) }
  const actionLimits = extra.actionLimits
  if (!actionLimits) return extra

  const nextActionLimits: CampaignActionLimitSettings = clampActionLimitConfigDailyLimit(
    { ...actionLimits },
    getCampaignActionDailySendLimit(actionId, null, entitlements)
  )
  const byActionCode = actionLimits.byActionCode || {}
  const nextByActionCode: NonNullable<CampaignActionLimitSettings['byActionCode']> = {}

  for (const [actionCode, limit] of Object.entries(byActionCode)) {
    nextByActionCode[actionCode] = clampActionLimitConfigDailyLimit(
      { ...limit },
      getAccountActionDailySendLimit(actionCode, null, entitlements)
    )
  }

  return {
    ...extra,
    actionLimits: {
      ...nextActionLimits,
      ...(Object.keys(nextByActionCode).length > 0 ? { byActionCode: nextByActionCode } : {})
    }
  }
}

const shouldSkipCloneCampaignInputData = (actionId: string, extraSettings: unknown): boolean => {
  if (actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID) return true
  if (actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID) return true
  if (actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID) return true
  if (actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID) return true
  if (actionId !== ZALO_MESSAGE_FRIEND_ACTION_ID) return false
  const extra = extraSettings && typeof extraSettings === 'object'
    ? extraSettings as Record<string, unknown>
    : {}
  return ZALO_FRIEND_AUTO_TARGET_MODES.has(String(extra.zaloFriendTargetMode || 'selected'))
}

const sanitizeClonedCampaignExtraSettings = (actionId: string, extraSettings: unknown): unknown => {
  if (!extraSettings || typeof extraSettings !== 'object' || Array.isArray(extraSettings)) return extraSettings
  const extra = extraSettings && typeof extraSettings === 'object'
    ? { ...(extraSettings as Record<string, unknown>) }
    : {}
  delete extra.internalSmsCreatedCampaignIdsByAccount
  if (actionId === 'facebook_timeline_post') extra.contentRotationIndex = 0
  if (!shouldSkipCloneCampaignInputData(actionId, extraSettings)) return extra
  delete extra.zaloFriendDataMaterializedAt
  delete extra.zaloFriendMaterializedCount
  delete extra.zaloBirthdayDataMaterializedDate
  delete extra.zaloBirthdayMaterializedCount
  delete extra.zaloFriendRecommendationDataMaterializedAt
  delete extra.zaloFriendRecommendationMaterializedCount
  delete extra.zaloCancelFriendRequestDataMaterializedAt
  delete extra.zaloCancelFriendRequestMaterializedCount
  return extra
}

function clearZaloBirthdayMaterializedExtra(extraSettings: Campaign['extraSettings']): Campaign['extraSettings'] {
  const nextExtra = { ...(extraSettings || {}) }
  delete nextExtra.zaloBirthdayDataMaterializedDate
  delete nextExtra.zaloBirthdayMaterializedCount
  return nextExtra
}

function clearZaloFriendRecommendationMaterializedExtra(extraSettings: Campaign['extraSettings']): Campaign['extraSettings'] {
  const nextExtra = { ...(extraSettings || {}) }
  delete nextExtra.zaloFriendRecommendationDataMaterializedAt
  delete nextExtra.zaloFriendRecommendationMaterializedCount
  return nextExtra
}

function clearZaloCancelSentFriendRequestMaterializedExtra(extraSettings: Campaign['extraSettings']): Campaign['extraSettings'] {
  const nextExtra = { ...(extraSettings || {}) }
  delete nextExtra.zaloCancelFriendRequestDataMaterializedAt
  delete nextExtra.zaloCancelFriendRequestMaterializedCount
  return nextExtra
}

async function getCampaignActionIdForCurrentUser(campaignId: number, staffId: number): Promise<string | null> {
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('action_id')
    .eq('id', campaignId)
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to load campaign action for entitlement check: ${error.message}`)
  return data ? String((data as Record<string, unknown>).action_id || '') : null
}

async function getCampaignActionIdForInputData(inputDataId: number): Promise<string | null> {
  const { data: inputData, error: inputError } = await client()
    .from('auto_campaign_input_data')
    .select('campaign_id')
    .eq('id', inputDataId)
    .eq('is_delete', false)
    .maybeSingle()

  if (inputError) throw new Error(`Failed to load campaign input data action: ${inputError.message}`)
  const campaignId = Number((inputData as Record<string, unknown> | null)?.campaign_id)
  if (!Number.isFinite(campaignId) || campaignId <= 0) return null

  const { data: campaign, error: campaignError } = await client()
    .from('auto_campaigns')
    .select('action_id')
    .eq('id', campaignId)
    .eq('is_delete', false)
    .maybeSingle()

  if (campaignError) throw new Error(`Failed to load campaign action for input data: ${campaignError.message}`)
  return campaign ? String((campaign as Record<string, unknown>).action_id || '') : null
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } catch {
      return null
    }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return nestedRecord(value[0])
  return normalizeRecord(value)
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textValue(value)
    if (text) return text
  }
  return ''
}

function isMobileManagedSmsCampaignAction(actionId?: string | null): boolean {
  return actionId === SMS_SEND_ACTION_ID || actionId === VOICE_CALL_ACTION_ID
}

function renderMobileManagedInputContent(
  campaign: Pick<Campaign, 'actionId' | 'content' | 'schedule' | 'originalSchedule'> & { extraSettings?: Campaign['extraSettings'] },
  row: Partial<CampaignInputData>,
  rowIndex: number,
  scheduleOverride?: string | null
): string {
  return campaign.actionId === VOICE_CALL_ACTION_ID
    ? renderVoiceCallInputContent(campaign, row, rowIndex, scheduleOverride)
    : renderSmsInputContent(campaign, row, rowIndex, scheduleOverride)
}

async function countActiveCampaignInputData(campaignId: number): Promise<number> {
  const { count, error } = await client()
    .from('auto_campaign_input_data')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to count campaign input data: ${error.message}`)
  return count ?? 0
}

function addDaysToDateInput(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00${VIETNAM_UTC_OFFSET}`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + days)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const map = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>
  return `${map.year}-${map.month}-${map.day}`
}

function dateInputToVietnamIso(value: string, endExclusive = false): string | null {
  const normalized = textValue(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const dateInput = endExclusive ? addDaysToDateInput(normalized, 1) : normalized
  if (!dateInput) return null
  const date = new Date(`${dateInput}T00:00:00${VIETNAM_UTC_OFFSET}`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function formatVietnamDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function getDaysSinceVietnam(value: string): number | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const sentParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const toUtcDay = (parts: Intl.DateTimeFormatPart[]) => {
    const map = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>
    return Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day))
  }
  return Math.max(0, Math.floor((toUtcDay(todayParts) - toUtcDay(sentParts)) / 86400000))
}

interface ZaloRemarketingCampaignInfo {
  id: number
  name: string
  actionId: string
  actionName: string
}

interface ZaloRemarketingInputInfo {
  id: number
  name?: string | null
  uid?: string | null
  phone?: string | null
  email?: string | null
  info1?: string | null
  info2?: string | null
  info3?: string | null
  info4?: string | null
  info5?: string | null
}

interface ZaloRemarketingDetailRecord {
  id: number
  input_data_id: number | null
  campaign_id: number
  account_id: number | null
  action_code: string | null
  action_name: string | null
  status: CampaignDetailStatus
  error_code: string | null
  log: string | null
  data: Record<string, unknown> | string | null
  created_at: string
}

interface CampaignRelationDetailRow {
  campaign_id: number
  action_name: string | null
  status: CampaignDetailStatus
}

export interface CampaignErrorState {
  id: number
  campaignId: number
  countConsecutiveBadTargets: number
  lastInputDataId?: number | null
  lastReason?: string | null
  lastBadTargetAt?: string | null
  createdAt?: string
  updatedAt?: string
}

interface VietnamDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function isMobileManagedSmsActionCode(actionCode?: string | null): boolean {
  const normalized = String(actionCode || '').trim()
  return normalized === SMS_SEND_ACTION_ID || normalized === VOICE_CALL_ACTION_ID
}

function shouldCountDetailByDefault(actionCode: string | null | undefined, status: CampaignDetailStatus): boolean {
  if (isMobileManagedSmsActionCode(actionCode)) return true
  return LIMIT_COUNT_STATUSES.includes(status)
}

const normalizeDetailInputText = (value: unknown): string | undefined => {
  const text = String(value ?? '').trim()
  return text || undefined
}

async function enrichCampaignDetailsWithInputData(
  details: CampaignDetail[],
  expectedCampaignId?: number
): Promise<CampaignDetail[]> {
  const inputDataIds = uniquePositiveIds(details.map(detail => Number(detail.inputDataId || 0)))
  if (inputDataIds.length === 0) return details

  const inputDataById = new Map<number, NonNullable<CampaignDetail['inputData']>>()
  for (const chunk of chunkArray(inputDataIds, 1000)) {
    let inputQuery = client()
      .from('auto_campaign_input_data')
      .select('id, name, phone, uid, email')
      .in('id', chunk)
    if (expectedCampaignId) inputQuery = inputQuery.eq('campaign_id', expectedCampaignId)
    const { data, error } = await inputQuery

    if (error) throw new Error(`Failed to enrich campaign details with input data: ${error.message}`)
    for (const row of data || []) {
      const id = Number(row.id)
      if (!Number.isFinite(id) || id <= 0) continue
      inputDataById.set(id, {
        id,
        name: normalizeDetailInputText(row.name),
        phone: normalizeDetailInputText(row.phone),
        uid: normalizeDetailInputText(row.uid),
        email: normalizeDetailInputText(row.email)
      })
    }
  }

  return details.map(detail => {
    const inputDataId = Number(detail.inputDataId || 0)
    const inputData = inputDataById.get(inputDataId)
    return inputData ? { ...detail, inputData } : detail
  })
}

async function countLimitDetailsInWindow(
  accountId: number,
  actionCode: string,
  timeFrameStartIso: string
): Promise<number> {
  const legacyQuery = client()
    .from('auto_campaign_details')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('action_code', actionCode)
    .is('counts_toward_limit', null)
    .gte('created_at', timeFrameStartIso)
  const scopedLegacyQuery = isMobileManagedSmsCampaignAction(actionCode)
    ? legacyQuery
    : legacyQuery.in('status', LIMIT_COUNT_STATUSES)

  const [explicitResult, legacyResult] = await Promise.all([
    client()
      .from('auto_campaign_details')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('action_code', actionCode)
      .eq('counts_toward_limit', true)
      .gte('created_at', timeFrameStartIso),
    scopedLegacyQuery
  ])

  if (explicitResult.error) throw new Error(`Window explicit count query error: ${explicitResult.error.message}`)
  if (legacyResult.error) throw new Error(`Window legacy count query error: ${legacyResult.error.message}`)

  return (explicitResult.count ?? 0) + (legacyResult.count ?? 0)
}

async function getOldestLimitDetailCreatedAtInWindow(
  accountId: number,
  actionCode: string,
  timeFrameStartIso: string
): Promise<string | null> {
  const legacyQuery = client()
    .from('auto_campaign_details')
    .select('created_at')
    .eq('account_id', accountId)
    .eq('action_code', actionCode)
    .is('counts_toward_limit', null)
    .gte('created_at', timeFrameStartIso)
  const scopedLegacyQuery = isMobileManagedSmsCampaignAction(actionCode)
    ? legacyQuery
    : legacyQuery.in('status', LIMIT_COUNT_STATUSES)

  const [explicitResult, legacyResult] = await Promise.all([
    client()
      .from('auto_campaign_details')
      .select('created_at')
      .eq('account_id', accountId)
      .eq('action_code', actionCode)
      .eq('counts_toward_limit', true)
      .gte('created_at', timeFrameStartIso)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    scopedLegacyQuery
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
  ])

  if (explicitResult.error) throw new Error(`Window explicit oldest query error: ${explicitResult.error.message}`)
  if (legacyResult.error) throw new Error(`Window legacy oldest query error: ${legacyResult.error.message}`)

  const candidates = [
    (explicitResult.data as { created_at?: string } | null)?.created_at,
    (legacyResult.data as { created_at?: string } | null)?.created_at
  ].filter((value): value is string => Boolean(value))

  if (candidates.length === 0) return null
  return candidates.sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0]
}

const vietnamDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: VIETNAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

const vietnamWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: VIETNAM_TIME_ZONE,
  weekday: 'short'
})

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function parseVietnamParts(date: Date): VietnamDateTimeParts {
  const parts = Object.fromEntries(
    vietnamDateTimeFormatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  ) as Record<string, string>

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  }
}

function makeVietnamDate(parts: Partial<VietnamDateTimeParts> & Pick<VietnamDateTimeParts, 'year' | 'month' | 'day'>): Date {
  const hour = parts.hour ?? 0
  const minute = parts.minute ?? 0
  const second = parts.second ?? 0
  return new Date(
    `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${VIETNAM_UTC_OFFSET}`
  )
}

function startOfVietnamDateKey(dateKey: string): Date {
  const normalized = String(dateKey || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('DB Vietnam date key is invalid')
  }
  const date = new Date(`${normalized}T00:00:00${VIETNAM_UTC_OFFSET}`)
  if (!Number.isFinite(date.getTime())) throw new Error('DB Vietnam date key is invalid')
  const parts = parseVietnamParts(date)
  if (`${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` !== normalized) {
    throw new Error('DB Vietnam date key is invalid')
  }
  return date
}

function parseDatabaseNow(dbNow: string): Date {
  const date = new Date(dbNow)
  if (!Number.isFinite(date.getTime())) throw new Error('DB runtime clock is invalid')
  return date
}

function addVietnamDays(day: Date, amount: number): Date {
  return new Date(day.getTime() + amount * 24 * 60 * 60 * 1000)
}

function withVietnamTime(day: Date, time: Pick<VietnamDateTimeParts, 'hour' | 'minute' | 'second'>): Date {
  const parts = parseVietnamParts(day)
  return makeVietnamDate({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second
  })
}

function formatVietnamTimeForQuery(date = new Date()): string {
  const parts = parseVietnamParts(date)
  return `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`
}

function isAtOrAfterDailyDrainTime(date: Date): boolean {
  return formatVietnamTimeForQuery(date) >= '23:59:00'
}

function mapCampaignErrorStateFromDB(row: Record<string, unknown>): CampaignErrorState {
  return {
    id: row.id as number,
    campaignId: row.campaign_id as number,
    countConsecutiveBadTargets: Number(row.count_consecutive_bad_targets || 0),
    lastInputDataId: (row.last_input_data_id as number | null) ?? null,
    lastReason: (row.last_reason as string | null) ?? null,
    lastBadTargetAt: (row.last_bad_target_at as string | null) ?? null,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined
  }
}

function getVietnamWeekdayNumber(date: Date): number {
  const weekday = vietnamWeekdayFormatter.format(date)
  switch (weekday) {
    case 'Mon': return 2
    case 'Tue': return 3
    case 'Wed': return 4
    case 'Thu': return 5
    case 'Fri': return 6
    case 'Sat': return 7
    case 'Sun': return 8
    default: return 0
  }
}

function parseNumberList(value: string | undefined, min: number, max: number): number[] {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map(item => Number(item.trim()))
      .filter(item => Number.isInteger(item) && item >= min && item <= max)
  )).sort((a, b) => a - b)
}

function resolveNextSchedule(campaign: Campaign, todayStart: Date): Date | null {
  if (!campaign.schedule) return null

  const scheduleType: CampaignScheduleType = campaign.scheduleType || 'daily'
  const timeSource = campaign.originalSchedule || campaign.schedule
  const timeDate = new Date(timeSource)
  if (Number.isNaN(timeDate.getTime())) return null
  const scheduleTime = parseVietnamParts(timeDate)

  if (scheduleType === 'daily') {
    return withVietnamTime(todayStart, scheduleTime)
  }

  if (scheduleType === 'weekly') {
    const weekDays = parseNumberList(campaign.scheduleWeekDays, 2, 8)
    if (weekDays.length === 0) return null

    for (let i = 0; i < 14; i++) {
      const candidateDay = addVietnamDays(todayStart, i)
      if (weekDays.includes(getVietnamWeekdayNumber(candidateDay))) {
        return withVietnamTime(candidateDay, scheduleTime)
      }
    }
    return null
  }

  if (scheduleType === 'monthly') {
    const monthDays = parseNumberList(campaign.scheduleDays, 1, 31)
    if (monthDays.length === 0) return null

    for (let i = 0; i < 370; i++) {
      const candidateDay = addVietnamDays(todayStart, i)
      const dayOfMonth = parseVietnamParts(candidateDay).day
      if (monthDays.includes(dayOfMonth)) {
        return withVietnamTime(candidateDay, scheduleTime)
      }
    }
    return null
  }

  return null
}

function isPastScheduleEnd(campaign: Campaign, schedule: Date): boolean {
  if (!campaign.scheduleEndDate) return false
  return schedule.getTime() > new Date(campaign.scheduleEndDate).getTime()
}

// =========== CAMPAIGNS ===========

async function attachCampaignSecondaryAccountNames<T extends {
  secondaryAccountId?: number | null
  secondaryAccountName?: string
}>(
  campaigns: T[],
  staffId: number,
  organizationId: number
): Promise<T[]> {
  const secondaryAccountIds = Array.from(new Set(
    campaigns
      .map(campaign => campaign.secondaryAccountId)
      .filter((accountId): accountId is number => Number.isSafeInteger(accountId) && Number(accountId) > 0)
  ))
  if (secondaryAccountIds.length === 0) return campaigns

  const { data, error } = await client()
    .from('auto_accounts')
    .select('id, name')
    .eq('staff_id', staffId)
    .eq('organization_id', organizationId)
    .in('id', secondaryAccountIds)

  if (error) {
    console.warn('Cannot load secondary account names for campaigns:', error)
    return campaigns
  }

  const accountNames = new Map(
    (data || []).map(account => [Number(account.id), String(account.name || '')])
  )
  return campaigns.map(campaign => {
    if (!campaign.secondaryAccountId) return campaign
    const secondaryAccountName = accountNames.get(campaign.secondaryAccountId)
    return secondaryAccountName
      ? { ...campaign, secondaryAccountName }
      : campaign
  })
}

export async function getCampaign(id: number): Promise<Campaign | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .single()

  if (error) return null
  const [campaign] = await attachCampaignSecondaryAccountNames(
    [mapCampaignFromDB(data)],
    u.staffId,
    u.organizationId
  )
  return campaign
}

export async function getCampaignConfig(id: number): Promise<CampaignConfig | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_CONFIG_SELECT)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to load campaign configuration: ${error.message}`)
  if (!data) return null

  const [campaign] = await attachCampaignSecondaryAccountNames(
    [mapCampaignConfigFromDB(data as unknown as Record<string, unknown>)],
    u.staffId,
    u.organizationId
  )
  const [campaignWithDataGroupSource] = await attachCampaignDataGroupSourceSummaries([campaign])
  return campaignWithDataGroupSource
}

export async function getCampaignLog(id: number): Promise<CampaignLogSnapshot | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('id, log, updated_at')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to load campaign log: ${error.message}`)
  if (!data) return null
  return {
    id: Number(data.id),
    log: typeof data.log === 'string' ? data.log : '',
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : undefined
  }
}

export async function setZaloServerCampaignStatus(
  campaignId: number,
  status: ZaloServerControlStatus
): Promise<ZaloServerCampaignStatusResult> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for Zalo Server control')
  }
  if (status !== 'chờ xử lý' && status !== 'tạm dừng') {
    throw new Error('Zalo Server campaign status must be pending or paused')
  }

  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_set_zalo_server_campaign_status', {
    p_campaign_id: normalizedCampaignId,
    p_staff_id: u.staffId,
    p_status: status
  })
  if (error) {
    throw new Error(
      `Failed to update Zalo Server campaign status atomically: ${error.message}. ` +
      'Ensure migration v172 is applied; no non-atomic fallback was attempted.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Zalo Server campaign control returned no result')
  return {
    ok: row.ok === true,
    reason: String(row.reason || 'invalid_transition'),
    campaignId: Number(row.campaign_id || normalizedCampaignId),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status)
  }
}

export async function getZaloServerRunControlState(
  campaignId: number,
  accountId: number
): Promise<ZaloServerRunControlState> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  const normalizedAccountId = Math.floor(Number(accountId))
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for Zalo Server control')
  }
  if (!Number.isSafeInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Account ID must be a positive integer for Zalo Server control')
  }

  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_get_zalo_server_run_control_state', {
    p_campaign_id: normalizedCampaignId,
    p_account_id: normalizedAccountId,
    p_staff_id: u.staffId
  })
  if (error) {
    throw new Error(
      `Failed to read Zalo Server run control atomically: ${error.message}. ` +
      'Ensure migration v172 is applied; no local fallback was attempted.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Zalo Server run control returned no result')
  return {
    campaignId: Number(row.campaign_id || normalizedCampaignId),
    accountId: Number(row.account_id || normalizedAccountId),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status),
    accountLoginStatus: row.account_login_status == null ? null : String(row.account_login_status),
    accountIsActive: row.account_is_active === true,
    accountIsDelete: row.account_is_delete === true,
    campaignIsDelete: row.campaign_is_delete === true,
    pauseRequested: row.pause_requested === true,
    shouldStop: row.should_stop === true,
    hardStopReason: row.hard_stop_reason == null ? null : String(row.hard_stop_reason)
  }
}

export async function claimZaloServerRunUnit(
  campaignId: number,
  accountId: number,
  inputDataIds: number[]
): Promise<ZaloServerRunUnitClaimResult> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  const normalizedAccountId = Math.floor(Number(accountId))
  const normalizedInputDataIds = Array.from(new Set(inputDataIds.map(id => Number(id))))
    .sort((left, right) => left - right)
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for Zalo Server unit claim')
  }
  if (!Number.isSafeInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Account ID must be a positive integer for Zalo Server unit claim')
  }
  if (
    normalizedInputDataIds.length !== inputDataIds.length ||
    normalizedInputDataIds.length > 50 ||
    normalizedInputDataIds.some(id => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new Error('Zalo Server unit input IDs must be unique positive integers with at most 50 rows')
  }

  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_claim_zalo_server_run_unit', {
    p_campaign_id: normalizedCampaignId,
    p_account_id: normalizedAccountId,
    p_staff_id: u.staffId,
    p_input_data_ids: normalizedInputDataIds
  })
  if (error) {
    throw new Error(
      `Failed to claim Zalo Server run unit atomically: ${error.message}. ` +
      'Ensure migration v172 is applied; no non-atomic fallback was attempted.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Zalo Server run unit claim returned no result')
  return {
    ok: row.ok === true,
    reason: String(row.reason || 'not_found'),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status),
    claimedCount: Number(row.claimed_count || 0)
  }
}

export async function finalizeZaloServerCampaign(
  campaignId: number,
  note?: string | null
): Promise<ZaloServerCampaignFinalizationResult> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for Zalo Server finalization')
  }

  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_finalize_zalo_server_campaign', {
    p_campaign_id: normalizedCampaignId,
    p_staff_id: u.staffId,
    p_note: note ?? null,
    p_update_note: note !== undefined
  })
  if (error) {
    throw new Error(
      `Failed to finalize Zalo Server campaign atomically: ${error.message}. ` +
      'Ensure migration v172 is applied; no non-atomic fallback was attempted.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Zalo Server campaign finalization returned no result')
  return {
    ok: row.ok === true,
    reason: String(row.reason || 'not_found'),
    campaignId: Number(row.campaign_id || normalizedCampaignId),
    accountId: row.account_id == null ? null : Number(row.account_id),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status)
  }
}

export async function finalizeCampaign(
  campaignId: number,
  note?: string | null,
  expectedStatus: 'chờ xử lý' | 'đang chạy' = 'đang chạy'
): Promise<CampaignFinalizationResult> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for finalization')
  }

  const u = requireCurrentUser()
  const auth = requireCurrentUserCredentials()
  const { data, error } = await client().rpc('aka_agent_finalize_campaign', {
    p_staff_id: u.staffId,
    p_organization_id: u.organizationId,
    p_campaign_id: normalizedCampaignId,
    p_note: note ?? null,
    p_update_note: note !== undefined,
    p_expected_status: expectedStatus,
    p_auth_username: auth.username,
    p_auth_password: auth.password
  })
  if (error) {
    throw new Error(
      `Failed to finalize campaign with pending-input guard: ${error.message}. ` +
      'Ensure migration v214 is applied; no non-atomic fallback was attempted.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Campaign finalization returned no result')
  const pendingInputCount = Number(row.pending_input_count || 0)
  return {
    completed: row.completed === true,
    reason: String(row.reason || 'not_found'),
    campaignId: Number(row.campaign_id || normalizedCampaignId),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    pendingInputCount: Number.isFinite(pendingInputCount) ? Math.max(0, pendingInputCount) : 0
  }
}

async function finalizeZaloServerMaintenanceCampaign(
  campaignId: number,
  note: string | null,
  runtimeModeRevision: string | null | undefined
): Promise<CampaignFinalizationResult> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for Zalo Server maintenance finalization')
  }

  const normalizedModeRevision = String(runtimeModeRevision || '').trim()
  if (!normalizedModeRevision) {
    throw new Error('Thiếu revision xác thực của Zalo Server runtime.')
  }

  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_finalize_zalo_server_maintenance_campaign', {
    p_staff_id: u.staffId,
    p_organization_id: u.organizationId,
    p_expected_mode_revision: normalizedModeRevision,
    p_campaign_id: normalizedCampaignId,
    p_note: note,
    p_update_note: true
  })
  if (error) {
    throw new Error(
      `Failed to finalize Zalo Server campaign during schedule maintenance: ${error.message}. ` +
      'Ensure migration v216 is applied; no desktop-credential fallback was attempted.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Zalo Server maintenance finalization returned no result')
  const reason = String(row.reason || 'not_found')
  if (!['completed', 'pending_input_remaining', 'campaign_control_won', 'not_found'].includes(reason)) {
    throw new Error(`Zalo Server maintenance finalization rejected campaign ${normalizedCampaignId}: ${reason}`)
  }
  const pendingInputCount = Number(row.pending_input_count || 0)
  return {
    completed: row.completed === true,
    reason,
    campaignId: Number(row.campaign_id || normalizedCampaignId),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    pendingInputCount: Number.isFinite(pendingInputCount) ? Math.max(0, pendingInputCount) : 0
  }
}

export async function advanceZaloServerMultiDailySlot(
  campaignId: number,
  accountId: number,
  nextSchedule: string
): Promise<ZaloServerMultiDailySlotAdvanceResult> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  const normalizedAccountId = Math.floor(Number(accountId))
  const normalizedNextSchedule = new Date(nextSchedule)
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for Zalo Server slot advance')
  }
  if (!Number.isSafeInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Account ID must be a positive integer for Zalo Server slot advance')
  }
  if (Number.isNaN(normalizedNextSchedule.getTime())) {
    throw new Error('Next schedule must be a valid timestamp for Zalo Server slot advance')
  }

  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_advance_zalo_server_multi_daily_slot', {
    p_campaign_id: normalizedCampaignId,
    p_account_id: normalizedAccountId,
    p_staff_id: u.staffId,
    p_next_schedule: normalizedNextSchedule.toISOString()
  })
  if (error) {
    throw new Error(
      `Failed to advance Zalo Server multi-daily slot atomically: ${error.message}. ` +
      'Ensure migration v172 is applied; no non-atomic fallback was attempted.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Zalo Server multi-daily slot advance returned no result')
  return {
    ok: row.ok === true,
    reason: String(row.reason || 'not_found'),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status),
    resetCount: Number(row.reset_count || 0)
  }
}

const chunkNumbers = (values: number[], chunkSize: number): number[][] => {
  const chunks: number[][] = []
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize))
  }
  return chunks
}

async function loadCampaignInputDataProgress(campaignIds: number[]): Promise<Map<number, CampaignInputDataProgress>> {
  const progressByCampaign = new Map<number, CampaignInputDataProgress>()
  const ids = Array.from(new Set(campaignIds
    .map(id => Math.floor(Number(id)))
    .filter(id => Number.isSafeInteger(id) && id > 0)))
  ids.forEach(id => progressByCampaign.set(id, { completed: 0, total: 0 }))
  if (ids.length === 0) return progressByCampaign

  const user = requireCurrentUser()
  const auth = requireCurrentUserCredentials()
  for (const idChunk of chunkNumbers(ids, CAMPAIGN_LIST_PROGRESS_ID_CHUNK)) {
    const { data, error } = await client().rpc('aka_agent_control_campaign_progress', {
      p_staff_id: user.staffId,
      p_organization_id: user.organizationId,
      p_campaign_ids: idChunk,
      p_auth_username: auth.username,
      p_auth_password: auth.password
    })
    if (error) throw new Error(`Failed to aggregate campaign input progress: ${error.message}`)

    for (const row of Array.isArray(data) ? data as Array<Record<string, unknown>> : []) {
      const campaignId = Math.floor(Number(row.campaign_id))
      if (!progressByCampaign.has(campaignId)) continue
      const total = Math.max(0, Math.floor(Number(row.input_total) || 0))
      const completed = Math.min(total, Math.max(0, Math.floor(Number(row.input_completed) || 0)))
      progressByCampaign.set(campaignId, { completed, total })
    }
  }

  return progressByCampaign
}

async function attachCampaignInputDataProgress<T extends { id: number }>(campaigns: T[]): Promise<T[]> {
  if (campaigns.length === 0) return campaigns
  const progressByCampaign = await loadCampaignInputDataProgress(campaigns.map(campaign => campaign.id))
  return campaigns.map(campaign => {
    const progress = progressByCampaign.get(campaign.id)
    return {
      ...campaign,
      inputDataCompletedCount: progress?.completed ?? 0,
      inputDataTotalCount: progress?.total ?? 0
    }
  })
}

const CAMPAIGN_DATA_GROUP_SOURCE_STATUS_VALUES = new Set<CampaignDataGroupSourceStatus>([
  'baselining',
  'active',
  'stopped'
])

type CampaignDataGroupSourceSummary = {
  campaignId: number
  groupId: number
  groupName: string | null
  groupIsDelete: boolean
  sourceStatus: CampaignDataGroupSourceStatus | null
  stopReason: string | null
  updatedAt: string | null
}

type CampaignDataGroupSummaryRpcError = {
  code?: string
  message?: string
  details?: string
  hint?: string
}

type CampaignDataGroupFallbackNameCache = {
  tenantKey: string
  expiresAt: number
  groupNameById: Map<number, string>
}

let campaignDataGroupFallbackNameCache: CampaignDataGroupFallbackNameCache | null = null

function isCampaignDataGroupSummaryRpcUnavailable(error: CampaignDataGroupSummaryRpcError): boolean {
  if (error.code === 'PGRST202') return true
  const message = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
  return message.includes('aka_agent_list_campaign_data_group_source_summaries')
    && /schema cache|could not find the function|does not exist/i.test(message)
}

function asCampaignDataGroupSourceStatus(value: unknown): CampaignDataGroupSourceStatus | null {
  const status = typeof value === 'string' ? value : ''
  return CAMPAIGN_DATA_GROUP_SOURCE_STATUS_VALUES.has(status as CampaignDataGroupSourceStatus)
    ? status as CampaignDataGroupSourceStatus
    : null
}

function asCampaignDataGroupSummary(row: Record<string, unknown>): CampaignDataGroupSourceSummary | null {
  const campaignId = Number(row.campaign_id)
  const groupId = Number(row.group_id)
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0
    || !Number.isSafeInteger(groupId) || groupId <= 0) return null
  const groupName = typeof row.group_name === 'string' && row.group_name.trim()
    ? row.group_name.trim()
    : null
  const stopReason = typeof row.stop_reason === 'string' && row.stop_reason.trim()
    ? row.stop_reason.trim()
    : null
  const updatedAt = typeof row.updated_at === 'string' && row.updated_at.trim()
    ? row.updated_at
    : null
  return {
    campaignId,
    groupId,
    groupName,
    groupIsDelete: row.group_is_delete === true,
    sourceStatus: asCampaignDataGroupSourceStatus(row.source_status),
    stopReason,
    updatedAt
  }
}

async function loadLegacyCampaignDataGroupSourceSummaries(
  campaigns: Array<Pick<Campaign, 'id' | 'dataGroupId'>>
): Promise<Map<number, CampaignDataGroupSourceSummary>> {
  const summaries = new Map<number, CampaignDataGroupSourceSummary>()
  const user = requireCurrentUser()
  const tenantKey = `${user.staffId}:${user.organizationId}`
  let groupNameById = campaignDataGroupFallbackNameCache?.tenantKey === tenantKey
    && campaignDataGroupFallbackNameCache.expiresAt > Date.now()
    ? campaignDataGroupFallbackNameCache.groupNameById
    : null

  if (!groupNameById) {
    groupNameById = new Map<number, string>()
    let offset = 0
    try {
      for (let pageIndex = 0; pageIndex < CAMPAIGN_DATA_GROUP_FALLBACK_GROUP_PAGE_COUNT; pageIndex += 1) {
        const page = await listDataGroups({
          offset,
          limit: CAMPAIGN_DATA_GROUP_FALLBACK_GROUP_PAGE_LIMIT
        })
        page.groups.forEach(group => groupNameById!.set(group.id, group.name))
        offset += page.groups.length
        if (page.groups.length < CAMPAIGN_DATA_GROUP_FALLBACK_GROUP_PAGE_LIMIT || offset >= page.total) break
      }
      campaignDataGroupFallbackNameCache = {
        tenantKey,
        expiresAt: Date.now() + CAMPAIGN_DATA_GROUP_FALLBACK_GROUP_CACHE_MS,
        groupNameById
      }
    } catch (error) {
      campaignDataGroupFallbackNameCache = {
        tenantKey,
        expiresAt: Date.now() + CAMPAIGN_DATA_GROUP_FALLBACK_GROUP_CACHE_MS,
        groupNameById
      }
      if (!hasWarnedCampaignDataGroupSummaryFallbackFailure) {
        hasWarnedCampaignDataGroupSummaryFallbackFailure = true
        console.warn('Cannot load fallback Data Group names for the campaign list:', error)
      }
    }
  }

  for (const campaign of campaigns) {
    if (!campaign.dataGroupId) continue
    summaries.set(campaign.id, {
      campaignId: campaign.id,
      groupId: campaign.dataGroupId,
      groupName: groupNameById.get(campaign.dataGroupId) || null,
      groupIsDelete: false,
      sourceStatus: null,
      stopReason: null,
      updatedAt: null
    })
  }
  return summaries
}

async function loadCampaignDataGroupSourceSummaries(
  campaigns: Array<Pick<Campaign, 'id' | 'dataTargetSourceMode' | 'dataGroupId'>>
): Promise<Map<number, CampaignDataGroupSourceSummary>> {
  const dataGroupCampaigns = campaigns.filter(campaign =>
    campaign.dataTargetSourceMode === 'data_group'
    && Number.isSafeInteger(Number(campaign.id))
    && Number(campaign.id) > 0
  )
  if (dataGroupCampaigns.length === 0) return new Map()

  const user = requireCurrentUser()
  const auth = getCurrentUserCredentials()
  // App Server/runtime contexts use runWithCurrentUser without retaining the
  // desktop user's process-only password. This list-only enrichment must not
  // make those existing campaign paths depend on desktop credentials.
  if (!auth) return new Map()
  const { data, error } = await client().rpc('aka_agent_list_campaign_data_group_source_summaries', {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_campaign_ids: dataGroupCampaigns.map(campaign => campaign.id),
    p_auth_username: auth.username,
    p_auth_password: auth.password
  })

  if (error) {
    if (isCampaignDataGroupSummaryRpcUnavailable(error)) {
      if (!hasWarnedCampaignDataGroupSummaryRpcUnavailable) {
        hasWarnedCampaignDataGroupSummaryRpcUnavailable = true
        console.warn(
          'Campaign Data Group source summary RPC is unavailable; using cached group names until migration v209 is applied.'
        )
      }
      return loadLegacyCampaignDataGroupSourceSummaries(dataGroupCampaigns)
    }
    throw new Error(`Failed to list campaign Data Group source summaries: ${error.message}`)
  }

  const summaries = new Map<number, CampaignDataGroupSourceSummary>()
  for (const candidate of Array.isArray(data) ? data : []) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const summary = asCampaignDataGroupSummary(candidate as Record<string, unknown>)
    if (summary) summaries.set(summary.campaignId, summary)
  }
  return summaries
}

async function attachCampaignDataGroupSourceSummaries<T extends Pick<Campaign, 'id'> & Partial<Pick<Campaign,
  'dataTargetSourceMode' | 'dataGroupId' | 'dataGroupName' | 'dataGroupIsDelete' |
  'dataGroupSourceStatus' | 'dataGroupSourceGroupId' | 'dataGroupSourceStopReason' | 'dataGroupSourceUpdatedAt'
>>>(campaigns: T[]): Promise<T[]> {
  const summaries = await loadCampaignDataGroupSourceSummaries(campaigns)
  return campaigns.map(campaign => {
    const summary = summaries.get(campaign.id)
    if (!summary) return campaign
    return {
      ...campaign,
      dataGroupName: summary.groupName,
      dataGroupIsDelete: summary.groupIsDelete,
      dataGroupSourceStatus: summary.sourceStatus,
      dataGroupSourceGroupId: summary.groupId,
      dataGroupSourceStopReason: summary.stopReason,
      dataGroupSourceUpdatedAt: summary.updatedAt
    }
  })
}

export async function listCampaignSummaries(): Promise<CampaignListItem[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_LIST_ITEM_SELECT)
    .eq('staff_id', u.staffId)
    .eq('organization_id', u.organizationId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list campaign summaries: ${error.message}`)
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const zaloCapabilities = loadCurrentUserZaloAccountCapabilities()
  const visibleRows = (data || []).filter(row => {
    const account = (row as Record<string, any>).primary_account || {}
    if (String(account.flatform_type || '').trim().toLowerCase() !== 'zalo') return true
    if (account.is_zalo_show_web === true) return zaloCapabilities.web
    return account.is_zalo_server === true ? zaloCapabilities.server : zaloCapabilities.qr
  })
  const campaigns = filterCampaignsByEntitlements(
    visibleRows.map(row => mapCampaignListItemFromDB(row as unknown as Record<string, unknown>)),
    entitlements
  )
  const campaignsWithSecondaryAccountNames = await attachCampaignSecondaryAccountNames(
    campaigns,
    u.staffId,
    u.organizationId
  )
  const campaignsWithDataGroupSources = await attachCampaignDataGroupSourceSummaries(
    campaignsWithSecondaryAccountNames
  )
  return attachCampaignInputDataProgress(campaignsWithDataGroupSources)
}

export async function listCampaigns(): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('staff_id', u.staffId)
    .eq('organization_id', u.organizationId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list campaigns: ${error.message}`)
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const zaloCapabilities = loadCurrentUserZaloAccountCapabilities()
  const visibleRows = (data || []).filter(row => {
    const account = (row as Record<string, any>).primary_account || {}
    if (String(account.flatform_type || '').trim().toLowerCase() !== 'zalo') return true
    if (account.is_zalo_show_web === true) return zaloCapabilities.web
    return account.is_zalo_server === true ? zaloCapabilities.server : zaloCapabilities.qr
  })
  const campaigns = filterCampaignsByEntitlements(visibleRows.map(row => mapCampaignFromDB(row)), entitlements)
  const campaignsWithSecondaryAccountNames = await attachCampaignSecondaryAccountNames(
    campaigns,
    u.staffId,
    u.organizationId
  )
  const campaignsWithDataGroupSources = await attachCampaignDataGroupSourceSummaries(campaignsWithSecondaryAccountNames)
  // Scheduler/runtime callers do not display list progress and App Server
  // contexts intentionally do not retain Desktop process credentials.
  return campaignsWithDataGroupSources
}

export async function listZaloRealtimeGroupCampaignSnapshots(
  runtimeTarget: CampaignRuntimeTarget = 'desktop'
): Promise<ZaloRealtimeGroupCampaignSnapshot[]> {
  const u = requireCurrentUser()
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const capabilities = loadCurrentUserZaloAccountCapabilities()
  if (!entitlements.zalo || (runtimeTarget === 'server' ? !capabilities.server : !capabilities.qr)) return []

  const { data, error } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_ZALO_REALTIME_SELECT)
    .eq('staff_id', u.staffId)
    .eq('action_id', ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID)
    .eq('is_delete', false)
    .in('status', ['chờ xử lý', 'đang chạy'])

  if (error) throw new Error(`Không thể tải danh sách chiến dịch Zalo theo thời gian thực: ${error.message}`)

  return (data || []).flatMap(row => {
    const account = (row as Record<string, any>).primary_account || {}
    if (account.is_zalo_show_web === true) return []
    if ((account.is_zalo_server === true) !== (runtimeTarget === 'server')) return []
    return [{
      campaign: mapCampaignFromDB(row),
      accountLoginStatus: String(account.login_status || ''),
      accountStatus: String(account.status || ''),
      accountIsActive: account.is_active !== false
    }]
  })
}

export async function enqueueZaloRealtimeGroupEvent(
  request: EnqueueZaloRealtimeGroupEventRequest
): Promise<EnqueueZaloRealtimeGroupEventResult> {
  const u = requireCurrentUser()
  const { data, error } = await client().rpc('enqueue_campaign_zalo_realtime_group_event', {
    p_campaign_id: request.campaignId,
    p_account_id: request.accountId,
    p_staff_id: u.staffId,
    p_runtime_target: request.runtimeTarget,
    p_group_id: request.groupId,
    p_group_name: request.groupName || null,
    p_trigger_type: request.triggerType,
    p_target_uid: request.targetUid,
    p_target_name: request.targetName || null,
    p_event_time: request.eventTime || new Date().toISOString(),
    p_schedule_at: request.scheduleAt,
    p_raw_payload: request.rawPayload || {}
  })

  if (error) throw new Error(`Không thể ghi sự kiện group Zalo theo thời gian thực: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : data
  return {
    inserted: Boolean(row?.inserted),
    eventId: row?.event_id ? Number(row.event_id) : null,
    inputDataId: row?.input_data_id ? Number(row.input_data_id) : null
  }
}

function normalizeSecondaryAccountId(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const accountId = Math.floor(Number(value))
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new Error('Tài khoản phụ phải là một tài khoản hợp lệ.')
  }
  return accountId
}

async function validateSecondaryCampaignAccount(
  actionId: string,
  primaryAccount: AutoAccount,
  secondaryAccountIdValue: unknown,
  staffId: number,
  organizationId: number
): Promise<number | null> {
  const secondaryAccountId = normalizeSecondaryAccountId(secondaryAccountIdValue)
  if (secondaryAccountId === null) return null

  if (secondaryAccountId === primaryAccount.id) {
    throw new Error('Tài khoản phụ phải khác tài khoản chính.')
  }

  const { data: action, error: actionError } = await client()
    .from('auto_campaign_actions')
    .select('id, flatform_type, allow_secondary_account')
    .eq('id', actionId)
    .eq('is_delete', false)
    .maybeSingle()
  if (actionError) {
    throw new Error(`Không thể kiểm tra cấu hình tài khoản phụ: ${actionError.message}`)
  }
  if (!action || action.allow_secondary_account !== true) {
    throw new Error('Loại chiến dịch này không hỗ trợ tài khoản phụ.')
  }

  const secondaryAccount = await accountRepo.getAccount(secondaryAccountId)
  if (!secondaryAccount) {
    throw new Error('Tài khoản phụ không tồn tại hoặc không phù hợp với gói hiện tại.')
  }

  const isSameTenant =
    primaryAccount.staffId === staffId &&
    secondaryAccount.staffId === staffId &&
    primaryAccount.organizationId === organizationId &&
    secondaryAccount.organizationId === organizationId
  if (!isSameTenant) {
    throw new Error('Tài khoản chính và tài khoản phụ phải thuộc cùng nhân viên và tổ chức hiện tại.')
  }

  const primaryPlatform = String(primaryAccount.flatformType || '').trim().toLowerCase()
  const secondaryPlatform = String(secondaryAccount.flatformType || '').trim().toLowerCase()
  const actionPlatform = String(action.flatform_type || '').trim().toLowerCase()
  if (
    !primaryPlatform ||
    primaryPlatform !== secondaryPlatform ||
    (actionPlatform !== 'all' && actionPlatform !== primaryPlatform)
  ) {
    throw new Error('Tài khoản phụ phải cùng nền tảng với tài khoản chính và loại chiến dịch.')
  }

  if (primaryPlatform === 'zalo' && (
    primaryAccount.isZaloShowWeb !== secondaryAccount.isZaloShowWeb ||
    primaryAccount.isZaloServer !== secondaryAccount.isZaloServer
  )) {
    throw new Error('Tài khoản phụ Zalo phải cùng loại QR local, Trình duyệt hoặc Server với tài khoản chính.')
  }

  return secondaryAccountId
}

export async function createCampaign(campaign: Partial<Campaign>): Promise<Campaign> {
  const u = requireCurrentUser()
  await ensureCurrentUserCanUseCampaignAction(campaign.actionId)
  const accountId = Math.floor(Number(campaign.accountId))
  const primaryAccount = Number.isSafeInteger(accountId) && accountId > 0
    ? await accountRepo.getAccount(accountId)
    : null
  if (!primaryAccount) {
    throw new Error('Tài khoản chiến dịch không tồn tại hoặc không phù hợp với gói hiện tại.')
  }
  const secondaryAccountId = await validateSecondaryCampaignAccount(
    String(campaign.actionId || ''),
    primaryAccount,
    campaign.secondaryAccountId,
    u.staffId,
    u.organizationId
  )
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const isSmsCampaign = isMobileManagedSmsCampaignAction(campaign.actionId)
  const extraSettings = clampCampaignExtraSettingsDailyLimits(campaign.extraSettings, campaign.actionId, entitlements)
  assertAdvancedContentPersistenceContract(campaign.actionId, extraSettings)
  const sourceMode = campaign.dataTargetSourceMode || 'direct'
  if (sourceMode === 'data_group') {
    if (!actionSupportsDataGroup(campaign.actionId)) {
      throw new Error('Hành động này không hỗ trợ nguồn Nhóm data.')
    }
    if (!Number.isSafeInteger(campaign.dataGroupId) || Number(campaign.dataGroupId) <= 0) {
      throw new Error('Vui lòng chọn Nhóm data cho chiến dịch.')
    }
  }
  const creationBundleId = campaign.creationBundleId == null ? null : Math.floor(Number(campaign.creationBundleId))
  const creationBundleChildIndex = campaign.creationBundleChildIndex == null
    ? null
    : Math.floor(Number(campaign.creationBundleChildIndex))
  if (creationBundleId !== null && creationBundleChildIndex !== null) {
    const { data: existing, error: existingError } = await client()
      .from('auto_campaigns')
      .select(CAMPAIGN_SELECT)
      .eq('staff_id', u.staffId)
      .eq('organization_id', u.organizationId)
      .eq('creation_bundle_id', creationBundleId)
      .eq('creation_bundle_child_index', creationBundleChildIndex)
      .eq('is_delete', false)
      .maybeSingle()
    if (existingError) throw new Error(`Failed to resume campaign bundle child: ${existingError.message}`)
    if (existing) return mapCampaignFromDB(existing)
  }
  const payload = {
    name: campaign.name,
    action_id: campaign.actionId,
    account_id: accountId,
    secondary_account_id: secondaryAccountId,
    status: campaign.status || 'chờ xử lý',
    schedule: campaign.schedule || null,
    original_schedule: campaign.originalSchedule ?? campaign.schedule ?? null,
    schedule_type: isSmsCampaign ? 'daily' : (campaign.scheduleType || 'daily'),
    schedule_end_date: isSmsCampaign ? null : (campaign.scheduleEndDate || null),
    daily_stop_time: isSmsCampaign ? null : (campaign.dailyStopTime || null),
    schedule_days: isSmsCampaign ? null : (campaign.scheduleDays || null),
    schedule_week_days: isSmsCampaign ? null : (campaign.scheduleWeekDays || null),
    continue_next_day: isSmsCampaign ? true : (campaign.continueNextDay ?? false),
    refresh_data: isSmsCampaign ? true : (campaign.refreshData ?? false),
    content: campaign.content || '',
    extra_settings: extraSettings,
    images: campaign.images || [],
    log: '',
    note: campaign.note ?? null,
    data_target_source_mode: sourceMode,
    data_group_id: sourceMode === 'data_group' ? campaign.dataGroupId : null,
    provisioning_state: sourceMode === 'data_group' ? 'staged' : 'ready',
    creation_bundle_id: creationBundleId,
    creation_bundle_child_index: creationBundleChildIndex,
    staff_id: u.staffId,
    organization_id: u.organizationId
  }

  const { data, error } = await client()
    .from('auto_campaigns')
    .insert(payload)
    .select(CAMPAIGN_SELECT)
    .single()

  if (error) throw new Error(`Failed to create campaign: ${error.message}`)
  return mapCampaignFromDB(data)
}

function smsMaterializationUpdateRequested(updates: Partial<Campaign>): boolean {
  return updates.actionId !== undefined ||
    updates.content !== undefined ||
    updates.schedule !== undefined ||
    updates.originalSchedule !== undefined ||
    updates.extraSettings !== undefined
}

function assertAdvancedContentPersistenceContract(
  actionId: string | null | undefined,
  extraSettings: Campaign['extraSettings'] | null | undefined
): void {
  if (extraSettings?.advancedContentEnabled !== true) return
  const items = getAdvancedContentItems(extraSettings)
  if (actionId === SMS_SEND_ACTION_ID && items.length > MAX_SMS_ADVANCED_CONTENT_ITEMS) {
    throw new Error(`Nội dung nâng cao SMS chỉ được tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} mục.`)
  }
  if (actionId === VOICE_CALL_ACTION_ID) {
    throw new Error('Cuộc gọi tự động không hỗ trợ nội dung nâng cao.')
  }
  if (actionId === 'email_send') {
    const missingSubjectIndex = items.findIndex(item => {
      const legacySubject = extraSettings.advancedContentSource === 'group_snapshot'
        ? ''
        : extraSettings.emailSubject ?? ''
      const subject = item.emailSubject ?? legacySubject
      return !String(subject).trim()
    })
    if (missingSubjectIndex >= 0) {
      throw new Error(`Nội dung nâng cao Email số ${missingSubjectIndex + 1} chưa có tiêu đề.`)
    }
  }
}

function getSmsExtraSettingsMaterializationFingerprint(
  extraSettings: Campaign['extraSettings'] | null | undefined
): string {
  const advancedContentEnabled = extraSettings?.advancedContentEnabled === true
  return JSON.stringify({
    advancedContentEnabled,
    advancedContentItems: advancedContentEnabled
      ? getAdvancedContentItems(extraSettings).map(item => item.content)
      : [],
    smsUseUnicode: extraSettings?.smsUseUnicode ?? false,
    smsKeepNewLines: extraSettings?.smsKeepNewLines ?? false
  })
}

function smsMaterializationTouched(
  updates: Partial<Campaign>,
  actionId: string | null | undefined,
  previousExtraSettings?: Campaign['extraSettings'] | null
): boolean {
  if (
    updates.actionId !== undefined ||
    updates.content !== undefined ||
    updates.schedule !== undefined ||
    updates.originalSchedule !== undefined
  ) {
    return true
  }
  if (updates.extraSettings === undefined) return false
  // Voice-call input rows also materialize their TTS payload. Advanced content
  // is intentionally unsupported there, but any voice settings change must
  // keep the existing rematerialization behavior.
  if (actionId === VOICE_CALL_ACTION_ID) return true
  if (actionId !== SMS_SEND_ACTION_ID) return false
  return getSmsExtraSettingsMaterializationFingerprint(previousExtraSettings) !==
    getSmsExtraSettingsMaterializationFingerprint(updates.extraSettings)
}

async function getCampaignExtraSettingsForCurrentUser(
  campaignId: number,
  staffId: number
): Promise<Campaign['extraSettings']> {
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('extra_settings')
    .eq('id', campaignId)
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to load campaign SMS settings: ${error.message}`)
  if (!data) throw new Error('Không tìm thấy chiến dịch.')
  return (normalizeRecord((data as Record<string, unknown>).extra_settings) || {}) as Campaign['extraSettings']
}

async function rematerializeSmsInputData(campaign: Campaign, updateSchedule: boolean): Promise<void> {
  if (!isMobileManagedSmsCampaignAction(campaign.actionId)) return
  const rows = await listCampaignInputData(campaign.id)
  const schedule = campaign.schedule || campaign.originalSchedule || null
  const writes = rows.flatMap((row, index) => {
    if (row.status !== 'chờ xử lý' && row.status !== 'tạm dừng') return []
    const payload: Record<string, unknown> = {
      content: renderMobileManagedInputContent(campaign, row, index, updateSchedule ? schedule : undefined),
      phone_carrier: normalizeCampaignInputPhoneCarrier(row.phone, row.phoneCarrier)
    }
    if (updateSchedule) payload.schedule = schedule
    return [{ rowId: row.id, payload }]
  })
  if (writes.length === 0) return

  const state: {
    nextIndex: number
    firstFailure: Error | null
  } = {
    nextIndex: 0,
    firstFailure: null
  }
  const runWorker = async (): Promise<void> => {
    while (!state.firstFailure) {
      const writeIndex = state.nextIndex
      if (writeIndex >= writes.length) return
      state.nextIndex += 1
      const write = writes[writeIndex]

      try {
        const { error } = await client()
          .from('auto_campaign_input_data')
          .update(write.payload)
          .eq('id', write.rowId)
          .eq('campaign_id', campaign.id)
          .eq('is_delete', false)
          .in('status', ['chờ xử lý', 'tạm dừng'])

        if (error) throw new Error(error.message)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        state.firstFailure ||= new Error(`Failed to update SMS input content: ${message}`)
      }
    }
  }

  const concurrency = Math.min(5, writes.length)
  await Promise.all(Array.from({ length: concurrency }, () => runWorker()))
  if (state.firstFailure) throw state.firstFailure
}

async function pauseCampaignAfterMobileContentUpdateFailure(
  campaignId: number,
  staffId: number
): Promise<boolean> {
  const { data, error } = await client()
    .from('auto_campaigns')
    .update({
      status: 'tạm dừng',
      updated_at: new Date().toISOString()
    })
    .eq('id', campaignId)
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .in('status', ['chờ xử lý', 'đang chạy', 'tạm dừng'])
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Failed to pause campaign after mobile content update failure:', error)
    return false
  }
  return Boolean(data)
}

function getMobileContentUpdateFailureMessage(actionId: string, paused: boolean): string {
  const contentLabel = actionId === VOICE_CALL_ACTION_ID ? 'cuộc gọi tự động' : 'SMS'
  if (!paused) {
    return `Cập nhật nội dung ${contentLabel} chưa hoàn tất và ứng dụng chưa thể tự tạm dừng chiến dịch. ` +
      'Hãy tạm dừng chiến dịch, mở Sửa chiến dịch, bấm Lưu lại, rồi mới tiếp tục.'
  }
  return `Cập nhật nội dung ${contentLabel} chưa hoàn tất. Chiến dịch đã được tạm dừng. ` +
    'Hãy mở Sửa chiến dịch, bấm Lưu lại, rồi tiếp tục chiến dịch.'
}

export async function updateCampaign(id: number, updates: CampaignUpdate): Promise<Campaign> {
  const u = requireCurrentUser()
  if ((updates as Record<string, unknown>).log !== undefined) {
    throw new Error('Campaign log must be written through the bounded atomic append operation.')
  }
  let currentCampaignForUpdate: Campaign | null | undefined
  const loadCurrentCampaignForUpdate = async (): Promise<Campaign> => {
    if (currentCampaignForUpdate === undefined) {
      currentCampaignForUpdate = await getCampaign(id)
    }
    if (!currentCampaignForUpdate) throw new Error('Không tìm thấy chiến dịch cần cập nhật.')
    return currentCampaignForUpdate
  }
  if (updates.dataTargetSourceMode !== undefined || updates.dataGroupId !== undefined) {
    const currentCampaign = await loadCurrentCampaignForUpdate()
    const nextSourceMode = updates.dataTargetSourceMode ?? currentCampaign.dataTargetSourceMode ?? 'direct'
    const nextGroupId = updates.dataGroupId !== undefined
      ? (updates.dataGroupId ?? null)
      : (currentCampaign.dataGroupId ?? null)
    if (
      nextSourceMode !== (currentCampaign.dataTargetSourceMode ?? 'direct') ||
      nextGroupId !== (currentCampaign.dataGroupId ?? null)
    ) {
      throw new Error('Đổi nguồn hoặc Nhóm data phải đi qua thao tác bind nguyên tử của Nhóm data.')
    }
  }
  let normalizedSecondaryAccountId: number | null | undefined
  if (
    updates.actionId !== undefined ||
    updates.accountId !== undefined ||
    updates.secondaryAccountId !== undefined
  ) {
    const currentCampaign = await loadCurrentCampaignForUpdate()
    const nextAccountId = updates.accountId === undefined
      ? currentCampaign.accountId
      : Math.floor(Number(updates.accountId))
    const primaryAccount = Number.isSafeInteger(nextAccountId) && nextAccountId > 0
      ? await accountRepo.getAccount(nextAccountId)
      : null
    if (!primaryAccount) {
      throw new Error('Tài khoản chiến dịch không tồn tại hoặc không phù hợp với gói hiện tại.')
    }
    normalizedSecondaryAccountId = await validateSecondaryCampaignAccount(
      updates.actionId ?? currentCampaign.actionId,
      primaryAccount,
      updates.secondaryAccountId === undefined
        ? currentCampaign.secondaryAccountId
        : updates.secondaryAccountId,
      u.staffId,
      u.organizationId
    )
  }
  let targetActionId: string | null | undefined = updates.actionId
  if (updates.actionId !== undefined) {
    await ensureCurrentUserCanUseCampaignAction(updates.actionId)
  } else if (touchesRestrictedCampaignConfig(updates)) {
    const currentActionId = await getCampaignActionIdForCurrentUser(id, u.staffId)
    targetActionId = currentActionId
    await ensureCurrentUserCanUseCampaignAction(currentActionId)
  } else if (smsMaterializationUpdateRequested(updates)) {
    targetActionId = await getCampaignActionIdForCurrentUser(id, u.staffId)
  }
  const previousSmsExtraSettings = updates.extraSettings !== undefined && targetActionId === SMS_SEND_ACTION_ID
    ? await getCampaignExtraSettingsForCurrentUser(id, u.staffId)
    : undefined
  const isSmsCampaign = isMobileManagedSmsCampaignAction(targetActionId)
  const payload: any = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.actionId !== undefined) payload.action_id = updates.actionId
  if (updates.accountId !== undefined) payload.account_id = Math.floor(Number(updates.accountId))
  if (updates.secondaryAccountId !== undefined) payload.secondary_account_id = normalizedSecondaryAccountId ?? null
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.schedule !== undefined) payload.schedule = updates.schedule
  if (updates.originalSchedule !== undefined) payload.original_schedule = updates.originalSchedule
  if (updates.scheduleType !== undefined) payload.schedule_type = isSmsCampaign ? 'daily' : updates.scheduleType
  if (updates.scheduleEndDate !== undefined) payload.schedule_end_date = isSmsCampaign ? null : updates.scheduleEndDate
  if (updates.dailyStopTime !== undefined) payload.daily_stop_time = isSmsCampaign ? null : (updates.dailyStopTime || null)
  if (updates.scheduleDays !== undefined) payload.schedule_days = isSmsCampaign ? null : updates.scheduleDays
  if (updates.scheduleWeekDays !== undefined) payload.schedule_week_days = isSmsCampaign ? null : updates.scheduleWeekDays
  if (updates.continueNextDay !== undefined) payload.continue_next_day = isSmsCampaign ? true : updates.continueNextDay
  if (updates.refreshData !== undefined) payload.refresh_data = isSmsCampaign ? true : updates.refreshData
  if (updates.content !== undefined) payload.content = updates.content
  if (updates.extraSettings !== undefined) {
    const entitlements = await loadCurrentUserEffectiveEntitlements()
    const extraSettings = clampCampaignExtraSettingsDailyLimits(updates.extraSettings, targetActionId, entitlements)
    assertAdvancedContentPersistenceContract(targetActionId, extraSettings)
    payload.extra_settings = extraSettings
  }
  if (updates.images !== undefined) payload.images = updates.images
  if (updates.note !== undefined) payload.note = updates.note
  if (updates.dataTargetSourceMode !== undefined) payload.data_target_source_mode = updates.dataTargetSourceMode
  if (updates.dataGroupId !== undefined) payload.data_group_id = updates.dataGroupId
  if (isSmsCampaign) {
    payload.schedule_type = 'daily'
    payload.schedule_end_date = null
    payload.daily_stop_time = null
    payload.schedule_days = null
    payload.schedule_week_days = null
    payload.continue_next_day = true
    payload.refresh_data = true
  }

  const { data, error } = await client()
    .from('auto_campaigns')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .select(CAMPAIGN_SELECT)
    .single()

  if (error) throw new Error(`Failed to update campaign: ${error.message}`)
  const updatedCampaign = mapCampaignFromDB(data)
  if (
    isMobileManagedSmsCampaignAction(updatedCampaign.actionId) &&
    smsMaterializationTouched(updates, updatedCampaign.actionId, previousSmsExtraSettings)
  ) {
    try {
      await rematerializeSmsInputData(
        updatedCampaign,
        updates.actionId !== undefined || updates.schedule !== undefined || updates.originalSchedule !== undefined
      )
    } catch (materializationError) {
      console.error('Failed to update mobile-managed campaign input content:', materializationError)
      const paused = await pauseCampaignAfterMobileContentUpdateFailure(id, u.staffId)
      throw new Error(getMobileContentUpdateFailureMessage(updatedCampaign.actionId, paused))
    }
  }
  return updatedCampaign
}

/**
 * Persist a preclaim note only while the scheduler snapshot is still current
 * and no runtime owns the campaign. The updated_at equality is the compare
 * part of the CAS: a concurrent edit, pause or claim makes this update affect
 * zero rows instead of overwriting the newer state.
 */
export async function updatePendingUnclaimedCampaignNote(
  id: number,
  expectedUpdatedAt: string,
  note: string
): Promise<Campaign | null> {
  const normalizedId = Math.floor(Number(id))
  if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0) {
    throw new Error('Campaign ID must be a positive integer for preclaim note CAS')
  }

  const normalizedExpectedUpdatedAt = String(expectedUpdatedAt || '').trim()
  const expectedUpdatedAtMs = Date.parse(normalizedExpectedUpdatedAt)
  if (!normalizedExpectedUpdatedAt || !Number.isFinite(expectedUpdatedAtMs)) {
    throw new Error('Campaign updated_at is required for preclaim note CAS')
  }

  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .update({
      note: note || 'Không đủ điều kiện chạy',
      // Advance from the stored DB value instead of trusting the app clock.
      updated_at: new Date(expectedUpdatedAtMs + 1).toISOString()
    })
    .eq('id', normalizedId)
    .eq('staff_id', u.staffId)
    .eq('status', 'chờ xử lý')
    .eq('updated_at', normalizedExpectedUpdatedAt)
    .is('runtime_claim_token', null)
    .is('runtime_unit_token', null)
    .eq('is_delete', false)
    .select(CAMPAIGN_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to update pending campaign note with CAS: ${error.message}`)
  return data ? mapCampaignFromDB(data) : null
}

/**
 * Server runtime writes after an atomic claim must never overwrite a newer
 * pause/resume written by a client. A missing update is a normal CAS conflict;
 * return the current row so realtime can publish the winning client state.
 */
export async function updateClaimedZaloServerCampaign(
  id: number,
  updates: CampaignUpdate
): Promise<Campaign> {
  const u = requireCurrentUser()
  if ((updates as Record<string, unknown>).log !== undefined) {
    throw new Error('Campaign log must be written through the bounded atomic append operation.')
  }
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.schedule !== undefined) payload.schedule = updates.schedule
  if (updates.originalSchedule !== undefined) payload.original_schedule = updates.originalSchedule
  if (updates.completedAt !== undefined) payload.completed_at = updates.completedAt
  if (updates.extraSettings !== undefined) payload.extra_settings = updates.extraSettings
  if (updates.note !== undefined) payload.note = updates.note

  const { data, error } = await client()
    .from('auto_campaigns')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('status', 'đang chạy')
    .select(CAMPAIGN_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to update claimed Zalo Server campaign: ${error.message}`)
  if (data) return mapCampaignFromDB(data)

  const current = await getCampaign(id)
  if (!current) throw new Error('Không tìm thấy chiến dịch Zalo Server sau xung đột trạng thái')
  return current
}

/**
 * Desktop scheduler boundary writes must not overwrite a newer client status.
 * Only the still-running row may move to the scheduler's requested stop state;
 * a CAS conflict returns the current winner for broadcast.
 */
export async function updateRunningDesktopCampaign(
  id: number,
  updates: Pick<CampaignUpdate, 'status' | 'note'>
): Promise<Campaign> {
  if (updates.status !== 'chờ xử lý' && updates.status !== 'tạm dừng') {
    throw new Error('Desktop running campaign transition requires a pending or paused status')
  }

  const u = requireCurrentUser()
  const payload: Record<string, unknown> = {
    status: updates.status,
    updated_at: new Date().toISOString()
  }
  if (updates.note !== undefined) payload.note = updates.note

  const { data, error } = await client()
    .from('auto_campaigns')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('status', 'đang chạy')
    .eq('is_delete', false)
    .select(CAMPAIGN_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to transition running Desktop campaign: ${error.message}`)
  if (data) return mapCampaignFromDB(data)

  const current = await getCampaign(id)
  if (!current) throw new Error('Không tìm thấy chiến dịch Desktop sau xung đột trạng thái')
  return current
}

/**
 * A find-data producer inserts rows outside the target campaign run. If the
 * target finalizer committed first, reopen only that completed snapshot; a
 * newer pause or already-running state must win the CAS.
 */
export async function reopenCompletedCampaignAfterInputInsert(
  id: number,
  expectedActionId: string
): Promise<Campaign | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .update({
      status: 'chờ xử lý',
      note: null,
      completed_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('action_id', expectedActionId)
    .eq('is_delete', false)
    .eq('status', 'hoàn thành')
    .select(CAMPAIGN_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to reopen campaign after input insert: ${error.message}`)
  return data ? mapCampaignFromDB(data) : null
}

export async function deleteCampaign(id: number): Promise<void> {
  const u = requireCurrentUser()
  const { data: campaign, error: fetchError } = await client()
    .from('auto_campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (fetchError) throw new Error(`Failed to load campaign before delete: ${fetchError.message}`)
  if (!campaign) throw new Error('Không tìm thấy chiến dịch cần xoá.')
  if (campaign.status === 'đang chạy') {
    throw new Error('Không thể xoá chiến dịch đang chạy.')
  }

  const { error } = await client()
    .from('auto_campaigns')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', u.staffId)

  if (error) throw new Error(`Failed to delete campaign: ${error.message}`)
}

export async function cloneCampaign(id: number): Promise<Campaign> {
  const u = requireCurrentUser()
  const { data: origCamp, error: errC } = await client()
    .from('auto_campaigns')
    .select('*')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .single()

  if (errC || !origCamp) throw new Error(`Campaign not found: ${errC?.message}`)
  await ensureCurrentUserCanUseCampaignAction(origCamp.action_id)
  let clonedSecondaryAccountId: number | null = null
  if (origCamp.secondary_account_id !== null && origCamp.secondary_account_id !== undefined) {
    const primaryAccount = await accountRepo.getAccount(Number(origCamp.account_id))
    if (!primaryAccount) {
      throw new Error('Tài khoản chính của chiến dịch gốc không còn khả dụng để nhân bản.')
    }
    clonedSecondaryAccountId = await validateSecondaryCampaignAccount(
      String(origCamp.action_id || ''),
      primaryAccount,
      origCamp.secondary_account_id,
      u.staffId,
      u.organizationId
    )
  }
  const isDataGroupClone = origCamp.data_target_source_mode === 'data_group'
    && Number.isSafeInteger(Number(origCamp.data_group_id))
    && Number(origCamp.data_group_id) > 0
  const skipCloningInputData = isDataGroupClone
    || shouldSkipCloneCampaignInputData(origCamp.action_id, origCamp.extra_settings)

  const { data: newCamp, error: errInsert } = await client()
    .from('auto_campaigns')
    .insert({
      name: origCamp.name + ' (Copy)',
      action_id: origCamp.action_id,
      account_id: origCamp.account_id,
      secondary_account_id: clonedSecondaryAccountId,
      status: 'tạm dừng',
      schedule: origCamp.schedule,
      original_schedule: origCamp.schedule,
      schedule_type: origCamp.schedule_type,
      schedule_end_date: origCamp.schedule_end_date,
      daily_stop_time: origCamp.daily_stop_time,
      schedule_days: origCamp.schedule_days,
      schedule_week_days: origCamp.schedule_week_days,
      continue_next_day: origCamp.continue_next_day,
      refresh_data: origCamp.refresh_data,
      content: origCamp.content,
      extra_settings: sanitizeClonedCampaignExtraSettings(origCamp.action_id, origCamp.extra_settings),
      images: origCamp.images,
      log: '',
      note: null,
      data_target_source_mode: isDataGroupClone ? 'data_group' : 'direct',
      data_group_id: isDataGroupClone ? origCamp.data_group_id : null,
      provisioning_state: isDataGroupClone ? 'staged' : 'ready',
      creation_bundle_id: null,
      creation_bundle_child_index: null,
      staff_id: u.staffId,
      organization_id: u.organizationId
    })
    .select(CAMPAIGN_SELECT)
    .single()

  if (errInsert || !newCamp) throw new Error(`Failed to insert cloned campaign: ${errInsert?.message}`)

  // Clone campaign_inputs trước (để build map oldInputId → newInputId cho input_data tham chiếu)
  const inputIdMap = new Map<number, number>()
  const { data: origInputs, error: errInputs } = skipCloningInputData
    ? { data: [], error: null }
    : await client()
      .from('auto_campaign_inputs')
      .select('*')
      .eq('campaign_id', id)
      .eq('is_delete', false)

  if (errInputs) throw new Error(`Failed to fetch original campaign inputs: ${errInputs.message}`)

  if (origInputs && origInputs.length > 0) {
    for (const inp of origInputs) {
      const { data: newInp, error: errInsertInp } = await client()
        .from('auto_campaign_inputs')
        .insert({
          campaign_id: newCamp.id,
          name: inp.name,
          phone: inp.phone,
          uid: inp.uid,
          email: inp.email,
          note: inp.note,
          status: 'chờ xử lý',
          schedule: inp.schedule
        })
        .select('id')
        .single()
      if (errInsertInp || !newInp) {
        console.warn('Failed to clone campaign input:', errInsertInp)
        continue
      }
      inputIdMap.set(inp.id as number, newInp.id as number)
    }
  }

  // Clone campaign_input_data, map input_id qua inputIdMap
  const { data: origActions, error: errActions } = skipCloningInputData
    ? { data: [], error: null }
    : await client()
      .from('auto_campaign_input_data')
      .select('*')
      .eq('campaign_id', id)
      .eq('is_delete', false)

  if (errActions) throw new Error(`Failed to fetch original campaign input data: ${errActions.message}`)

  if (origActions && origActions.length > 0) {
    const clonedCampaignForRender = {
      actionId: origCamp.action_id as string,
      content: origCamp.content as string | undefined,
      schedule: origCamp.schedule as string | undefined,
      originalSchedule: (origCamp.original_schedule as string | null | undefined) ?? null,
      extraSettings: normalizeRecord(origCamp.extra_settings) as Campaign['extraSettings']
    }
    const isSmsClone = isMobileManagedSmsCampaignAction(origCamp.action_id as string)
    const actionsToInsert = origActions.map((d, index) => ({
      campaign_id: newCamp.id,
      input_id: d.input_id != null ? (inputIdMap.get(d.input_id as number) ?? null) : null,
      name: d.name,
      phone: d.phone,
      phone_carrier: isSmsClone ? normalizeCampaignInputPhoneCarrier(d.phone, d.phone_carrier as string | null | undefined) : null,
      uid: d.uid,
      email: d.email,
      info1: d.info1,
      info2: d.info2,
      info3: d.info3,
      info4: d.info4,
      info5: d.info5,
      content: isSmsClone
        ? renderMobileManagedInputContent(clonedCampaignForRender, mapCampaignInputDataFromDB(d), index, d.schedule as string | null | undefined)
        : d.content,
      note: d.note,
      status: 'chờ xử lý',
      schedule: d.schedule
    }))

    try {
      await insertCampaignInputDataPayload(
        actionsToInsert as CampaignInputDataInsertPayload[],
        false,
        undefined,
        true
      )
    } catch (errInsertActions) {
      console.warn('Failed to clone campaign input data:', errInsertActions)
    }
  }

  if (isDataGroupClone) {
    const auth = requireCurrentUserCredentials()
    const { error: bindError } = await client().rpc('aka_agent_bind_campaign_data_group_source', {
      p_staff_id: u.staffId,
      p_organization_id: u.organizationId,
      p_request_id: `clone:${id}:${randomUUID()}`,
      p_campaign_id: newCamp.id,
      p_group_id: origCamp.data_group_id,
      p_bundle_id: null,
      p_auth_username: auth.username,
      p_auth_password: auth.password
    })
    if (bindError) {
      await client()
        .from('auto_campaigns')
        .update({
          provisioning_state: 'failed',
          status: 'tạm dừng',
          note: `Không thể baseline Nhóm data khi nhân bản: ${bindError.message}`
        })
        .eq('id', newCamp.id)
        .eq('staff_id', u.staffId)
      throw new Error(`Failed to baseline cloned Data Group campaign: ${bindError.message}`)
    }

    const { data: readyClone, error: readyCloneError } = await client()
      .from('auto_campaigns')
      .select(CAMPAIGN_SELECT)
      .eq('id', newCamp.id)
      .eq('staff_id', u.staffId)
      .single()
    if (readyCloneError || !readyClone) {
      throw new Error(`Cloned Data Group campaign was provisioned but could not be reloaded: ${readyCloneError?.message}`)
    }
    return mapCampaignFromDB(readyClone)
  }

  return mapCampaignFromDB(newCamp)
}

export type CampaignLogAppendResult = Pick<
  Campaign,
  'id' | 'name' | 'accountId' | 'accountName' | 'status' | 'note' | 'updatedAt'
> & {
  schedule: string | null
  lastRunAt: string | null
}

export async function appendCampaignLog(
  campaignId: number,
  logText: string
): Promise<CampaignLogAppendResult> {
  const u = requireCurrentUser()
  const { data: current, error: currentError } = await client()
    .from('auto_campaigns')
    .select(`name, ${CAMPAIGN_PRIMARY_ACCOUNT_RELATION}`)
    .eq('id', campaignId)
    .eq('staff_id', u.staffId)
    .single()

  if (currentError) throw new Error(`Failed to load campaign log: ${currentError.message}`)
  if (!current) throw new Error('Campaign not found')

  const newLog = formatStoredCampaignLogLine(logText, {
    campaignName: (current as any)?.name,
    accountName: (current as any)?.primary_account?.name
  })

  const { error: appendError } = await client().rpc('append_auto_campaign_log', {
    p_campaign_id: campaignId,
    p_staff_id: u.staffId,
    p_log_line: newLog
  })

  if (appendError) {
    throw new Error(
      `Failed to append campaign log atomically: ${appendError.message}. ` +
      'Ensure migration v237 is applied; the legacy read-modify-write fallback was intentionally not used.'
    )
  }

  const { data, error } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_LOG_APPEND_RESULT_SELECT)
    .eq('id', campaignId)
    .eq('staff_id', u.staffId)
    .single()

  if (error) {
    throw new Error(
      `Campaign log was appended atomically, but the updated campaign could not be reloaded: ${error.message}`
    )
  }

  const primaryAccount = Array.isArray((data as any).primary_account)
    ? (data as any).primary_account[0]
    : (data as any).primary_account
  return {
    id: Number((data as any).id),
    name: String((data as any).name || ''),
    accountId: Number((data as any).account_id),
    accountName: typeof primaryAccount?.name === 'string' ? primaryAccount.name : undefined,
    status: String((data as any).status || ''),
    note: typeof (data as any).note === 'string' ? (data as any).note : null,
    schedule: typeof (data as any).schedule === 'string' ? (data as any).schedule : null,
    lastRunAt: typeof (data as any).last_run_at === 'string' ? (data as any).last_run_at : null,
    updatedAt: typeof (data as any).updated_at === 'string' ? (data as any).updated_at : undefined
  }
}

export async function claimCampaignRuntime(
  campaignId: number,
  accountId: number,
  runtimeTarget: CampaignRuntimeTarget
): Promise<boolean> {
  const u = requireCurrentUser()
  const normalizedCampaignId = Math.floor(Number(campaignId))
  const normalizedAccountId = Math.floor(Number(accountId))
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for runtime claim')
  }
  if (!Number.isSafeInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Account ID must be a positive integer for runtime claim')
  }
  if (runtimeTarget !== 'desktop' && runtimeTarget !== 'server') {
    throw new Error('Runtime target must be desktop or server')
  }

  const { data, error } = await client().rpc('claim_campaign_runtime', {
    p_campaign_id: normalizedCampaignId,
    p_account_id: normalizedAccountId,
    p_staff_id: u.staffId,
    p_runtime_target: runtimeTarget
  })

  if (error) {
    throw new Error(
      `Failed to claim campaign runtime atomically: ${error.message}. ` +
      'Ensure migration v171 is applied; no non-atomic fallback was attempted.'
    )
  }

  return data === true
}

const RUNTIME_CLAIM_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeRuntimeClaimToken(runtimeClaimToken: string): string {
  const normalized = String(runtimeClaimToken || '').trim().toLowerCase()
  if (!RUNTIME_CLAIM_TOKEN_PATTERN.test(normalized)) {
    throw new Error('Runtime claim token must be a valid UUID')
  }
  return normalized
}

function mapCampaignRuntimeClaimV2Row(row: Record<string, unknown>): CampaignRuntimeClaimV2Result {
  return {
    ok: row.ok === true,
    reason: String(row.reason || 'claim_rejected'),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status),
    runtimeClaimToken: row.runtime_claim_token == null ? null : String(row.runtime_claim_token),
    runtimeClaimVietnamDateKey:
      row.runtime_claim_vietnam_date == null ? null : String(row.runtime_claim_vietnam_date),
    runtimeClaimedAt: row.runtime_claimed_at == null ? null : String(row.runtime_claimed_at),
    dbNow: String(row.db_now || ''),
    vietnamDateKey: String(row.vietnam_date_key || ''),
    effectiveStopTime: row.effective_stop_time == null ? null : String(row.effective_stop_time),
    boundaryAt: row.boundary_at == null ? null : String(row.boundary_at)
  }
}

export async function claimCampaignRuntimeV2(
  campaignId: number,
  accountId: number,
  runtimeTarget: CampaignRuntimeTarget,
  runtimeClaimToken: string
): Promise<CampaignRuntimeClaimV2Result> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  const normalizedAccountId = Math.floor(Number(accountId))
  const normalizedRuntimeClaimToken = normalizeRuntimeClaimToken(runtimeClaimToken)
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for v2 runtime claim')
  }
  if (!Number.isSafeInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Account ID must be a positive integer for v2 runtime claim')
  }
  if (runtimeTarget !== 'desktop' && runtimeTarget !== 'server') {
    throw new Error('Runtime target must be desktop or server for v2 runtime claim')
  }

  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_claim_campaign_runtime_v2', {
    p_campaign_id: normalizedCampaignId,
    p_account_id: normalizedAccountId,
    p_staff_id: u.staffId,
    p_runtime_target: runtimeTarget,
    p_runtime_claim_token: normalizedRuntimeClaimToken
  })
  if (error) {
    throw new Error(
      `Failed to claim campaign runtime v2 atomically: ${error.message}. ` +
      'Ensure migration v231 is applied; no legacy fallback was attempted.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Campaign runtime v2 claim returned no result')
  const result = mapCampaignRuntimeClaimV2Row(row)
  if (result.ok) {
    if (result.runtimeClaimToken !== normalizedRuntimeClaimToken) {
      throw new Error('Campaign runtime v2 claim returned an unexpected ownership token')
    }
    if (!result.runtimeClaimVietnamDateKey) {
      throw new Error('Campaign runtime v2 claim returned no Vietnam claim date')
    }
    startOfVietnamDateKey(result.runtimeClaimVietnamDateKey)
  }
  return result
}

export async function claimCampaignRunUnitV2(
  campaignId: number,
  accountId: number,
  runtimeTarget: CampaignRuntimeTarget,
  runtimeClaimToken: string,
  runtimeClaimVietnamDateKey: string,
  runtimeUnitToken: string,
  inputDataIds: number[]
): Promise<CampaignRunUnitClaimV2Result> {
  const args = normalizeCampaignDailyBoundaryArgs(
    campaignId,
    accountId,
    runtimeTarget,
    runtimeClaimVietnamDateKey
  )
  const normalizedRuntimeClaimToken = normalizeRuntimeClaimToken(runtimeClaimToken)
  const normalizedRuntimeUnitToken = normalizeRuntimeClaimToken(runtimeUnitToken)
  const normalizedInputDataIds = Array.from(new Set(inputDataIds.map(id => Number(id))))
    .sort((left, right) => left - right)
  if (
    normalizedInputDataIds.length !== inputDataIds.length ||
    normalizedInputDataIds.length > 50 ||
    normalizedInputDataIds.some(id => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new Error('Campaign run-unit input IDs must be unique positive integers with at most 50 rows')
  }

  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_claim_campaign_run_unit_v2', {
    p_campaign_id: args.campaignId,
    p_account_id: args.accountId,
    p_staff_id: u.staffId,
    p_runtime_target: args.runtimeTarget,
    p_runtime_claim_token: normalizedRuntimeClaimToken,
    p_runtime_claim_vietnam_date: args.claimedVietnamDateKey,
    p_runtime_unit_token: normalizedRuntimeUnitToken,
    p_input_data_ids: normalizedInputDataIds
  })
  if (error) {
    throw new Error(
      `Failed to claim campaign run unit v2 atomically: ${error.message}. ` +
      'Ensure migration v231 is applied; no non-atomic fallback was attempted.'
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Campaign run-unit v2 claim returned no result')
  const result: CampaignRunUnitClaimV2Result = {
    ok: row.ok === true,
    reason: String(row.reason || 'unit_claim_rejected'),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status),
    claimedCount: Number(row.claimed_count || 0),
    runtimeClaimToken: row.runtime_claim_token == null ? null : String(row.runtime_claim_token),
    runtimeClaimVietnamDateKey:
      row.runtime_claim_vietnam_date == null ? null : String(row.runtime_claim_vietnam_date),
    runtimeUnitToken: row.runtime_unit_token == null ? null : String(row.runtime_unit_token),
    runtimeUnitVietnamDateKey:
      row.runtime_unit_vietnam_date == null ? null : String(row.runtime_unit_vietnam_date),
    runtimeUnitClaimedAt: row.runtime_unit_claimed_at == null ? null : String(row.runtime_unit_claimed_at),
    runtimeUnitInputDataIds: Array.isArray(row.runtime_unit_input_data_ids)
      ? row.runtime_unit_input_data_ids.map(id => Number(id))
      : [],
    dbNow: String(row.db_now || ''),
    vietnamDateKey: String(row.vietnam_date_key || ''),
    effectiveStopTime: row.effective_stop_time == null ? null : String(row.effective_stop_time),
    boundaryAt: row.boundary_at == null ? null : String(row.boundary_at)
  }
  if (result.ok) {
    if (result.reason === 'claimed') {
      if (result.runtimeClaimToken !== normalizedRuntimeClaimToken) {
        throw new Error('Campaign run-unit v2 claim returned an unexpected ownership token')
      }
      if (result.runtimeClaimVietnamDateKey !== args.claimedVietnamDateKey) {
        throw new Error('Campaign run-unit v2 claim returned an unexpected Vietnam claim date')
      }
    }
    if (result.runtimeUnitToken !== normalizedRuntimeUnitToken) {
      throw new Error('Campaign run-unit v2 claim returned an unexpected unit token')
    }
    if (result.runtimeUnitVietnamDateKey !== args.claimedVietnamDateKey) {
      throw new Error('Campaign run-unit v2 claim returned an unexpected unit Vietnam date')
    }
    if (
      result.runtimeUnitInputDataIds.length !== normalizedInputDataIds.length ||
      result.runtimeUnitInputDataIds.some((id, index) => id !== normalizedInputDataIds[index])
    ) {
      throw new Error('Campaign run-unit v2 claim returned an unexpected input-data lease')
    }
  }
  return result
}

export async function settleCampaignRunUnitV2(
  campaignId: number,
  accountId: number,
  runtimeTarget: CampaignRuntimeTarget,
  runtimeUnitToken: string,
  requeueUnstarted: boolean
): Promise<CampaignRunUnitSettlementV2Result> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  const normalizedAccountId = Math.floor(Number(accountId))
  const normalizedRuntimeUnitToken = normalizeRuntimeClaimToken(runtimeUnitToken)
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for unit settlement')
  }
  if (!Number.isSafeInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Account ID must be a positive integer for unit settlement')
  }
  if (runtimeTarget !== 'desktop' && runtimeTarget !== 'server') {
    throw new Error('Runtime target must be desktop or server for unit settlement')
  }

  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_settle_campaign_run_unit_v2', {
    p_campaign_id: normalizedCampaignId,
    p_account_id: normalizedAccountId,
    p_staff_id: u.staffId,
    p_runtime_target: runtimeTarget,
    p_runtime_unit_token: normalizedRuntimeUnitToken,
    p_requeue_unstarted: requeueUnstarted === true
  })
  if (error) {
    throw new Error(
      `Failed to settle campaign run-unit v2 atomically: ${error.message}. ` +
      'Ensure migration v231 is applied; the unit lease remains active.'
    )
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Campaign run-unit v2 settlement returned no result')
  return {
    ok: row.ok === true,
    reason: String(row.reason || 'unit_settlement_rejected'),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status),
    requeuedCount: Number(row.requeued_count || 0),
    dbNow: String(row.db_now || ''),
    vietnamDateKey: String(row.vietnam_date_key || '')
  }
}

export async function recoverCampaignRuntimeUnitLeasesV2(
  runtimeTarget: CampaignRuntimeTarget,
  platformScope: 'all' | 'zalo' = 'all'
): Promise<CampaignRuntimeUnitRecoveryV2Result> {
  if (runtimeTarget !== 'desktop' && runtimeTarget !== 'server') {
    throw new Error('Runtime target must be desktop or server for unit-lease recovery')
  }
  if (platformScope !== 'all' && platformScope !== 'zalo') {
    throw new Error('Platform scope must be all or zalo for unit-lease recovery')
  }
  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_recover_campaign_runtime_unit_leases', {
    p_staff_id: u.staffId,
    p_runtime_target: runtimeTarget,
    p_platform_scope: platformScope
  })
  if (error) {
    throw new Error(
      `Failed to recover campaign runtime unit leases: ${error.message}. ` +
      'Ensure migration v231 is applied; maintenance remains closed.'
    )
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Campaign runtime unit-lease recovery returned no result')
  return {
    ok: row.ok === true,
    reason: String(row.reason || 'unit_recovery_rejected'),
    recoveredLeaseCount: Number(row.recovered_lease_count || 0),
    requeuedInputCount: Number(row.requeued_input_count || 0),
    dbNow: String(row.db_now || ''),
    vietnamDateKey: String(row.vietnam_date_key || '')
  }
}

export async function setDesktopCampaignStatusV2(
  campaignId: number,
  accountId: number,
  targetStatus: Extract<CampaignStatus, 'chờ xử lý' | 'tạm dừng'>
): Promise<DesktopCampaignStatusV2Result> {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  const normalizedAccountId = Math.floor(Number(accountId))
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for desktop status control')
  }
  if (!Number.isSafeInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Account ID must be a positive integer for desktop status control')
  }
  if (targetStatus !== 'chờ xử lý' && targetStatus !== 'tạm dừng') {
    throw new Error('Desktop campaign target status is invalid')
  }
  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_set_desktop_campaign_status_v2', {
    p_campaign_id: normalizedCampaignId,
    p_account_id: normalizedAccountId,
    p_staff_id: u.staffId,
    p_target_status: targetStatus
  })
  if (error) {
    throw new Error(
      `Failed to update desktop campaign status atomically: ${error.message}. ` +
      'Ensure migration v231 is applied; no unconditional status write was attempted.'
    )
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Desktop campaign status v2 returned no result')
  return {
    ok: row.ok === true,
    reason: String(row.reason || 'status_update_rejected'),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status),
    dbNow: String(row.db_now || ''),
    vietnamDateKey: String(row.vietnam_date_key || '')
  }
}

function normalizeCampaignDailyBoundaryArgs(
  campaignId: number,
  accountId: number,
  runtimeTarget: CampaignRuntimeTarget,
  claimedVietnamDateKey: string
): {
  campaignId: number
  accountId: number
  runtimeTarget: CampaignRuntimeTarget
  claimedVietnamDateKey: string
} {
  const normalizedCampaignId = Math.floor(Number(campaignId))
  const normalizedAccountId = Math.floor(Number(accountId))
  const normalizedDateKey = String(claimedVietnamDateKey || '').trim()
  if (!Number.isSafeInteger(normalizedCampaignId) || normalizedCampaignId <= 0) {
    throw new Error('Campaign ID must be a positive integer for daily boundary')
  }
  if (!Number.isSafeInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Account ID must be a positive integer for daily boundary')
  }
  if (runtimeTarget !== 'desktop' && runtimeTarget !== 'server') {
    throw new Error('Runtime target must be desktop or server for daily boundary')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateKey)) {
    throw new Error('Claimed Vietnam date key is invalid for daily boundary')
  }
  // Reuse the strict calendar-date parser instead of accepting values such as
  // 2026-99-99 that merely match the shape above.
  startOfVietnamDateKey(normalizedDateKey)
  return {
    campaignId: normalizedCampaignId,
    accountId: normalizedAccountId,
    runtimeTarget,
    claimedVietnamDateKey: normalizedDateKey
  }
}

function mapCampaignDailyBoundaryRow(row: Record<string, unknown>): CampaignDailyBoundaryCheckResult {
  return {
    allowNewUnit: row.allow_new_unit === true,
    reason: String(row.reason || 'not_found'),
    campaignStatus: row.campaign_status == null ? null : String(row.campaign_status),
    accountStatus: row.account_status == null ? null : String(row.account_status),
    dbNow: String(row.db_now || ''),
    vietnamDateKey: String(row.vietnam_date_key || ''),
    claimedVietnamDateKey: String(row.claimed_vietnam_date_key || ''),
    effectiveStopTime: row.effective_stop_time == null ? null : String(row.effective_stop_time),
    boundaryAt: row.boundary_at == null ? null : String(row.boundary_at),
    dayChanged: row.day_changed === true
  }
}

export async function checkCampaignDailyBoundary(
  campaignId: number,
  accountId: number,
  runtimeTarget: CampaignRuntimeTarget,
  claimedVietnamDateKey: string
): Promise<CampaignDailyBoundaryCheckResult> {
  const args = normalizeCampaignDailyBoundaryArgs(
    campaignId,
    accountId,
    runtimeTarget,
    claimedVietnamDateKey
  )
  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_check_campaign_daily_boundary', {
    p_campaign_id: args.campaignId,
    p_account_id: args.accountId,
    p_staff_id: u.staffId,
    p_runtime_target: args.runtimeTarget,
    p_claimed_vietnam_date: args.claimedVietnamDateKey
  })
  if (error) {
    throw new Error(
      `Failed to check campaign daily boundary: ${error.message}. ` +
      'Ensure migration v231 is applied; no host-clock fallback was attempted.'
    )
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Campaign daily boundary check returned no result')
  return mapCampaignDailyBoundaryRow(row)
}

export async function yieldCampaignDailyBoundary(
  campaignId: number,
  accountId: number,
  runtimeTarget: CampaignRuntimeTarget,
  runtimeClaimToken: string,
  claimedVietnamDateKey: string
): Promise<CampaignDailyBoundaryYieldResult> {
  const args = normalizeCampaignDailyBoundaryArgs(
    campaignId,
    accountId,
    runtimeTarget,
    claimedVietnamDateKey
  )
  const normalizedRuntimeClaimToken = normalizeRuntimeClaimToken(runtimeClaimToken)
  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_yield_campaign_daily_boundary', {
    p_campaign_id: args.campaignId,
    p_account_id: args.accountId,
    p_staff_id: u.staffId,
    p_runtime_target: args.runtimeTarget,
    p_runtime_claim_token: normalizedRuntimeClaimToken,
    p_claimed_vietnam_date: args.claimedVietnamDateKey
  })
  if (error) {
    throw new Error(
      `Failed to yield campaign at daily boundary: ${error.message}. ` +
      'Ensure migration v231 is applied; no non-atomic fallback was attempted.'
    )
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Campaign daily boundary yield returned no result')
  const boundary = mapCampaignDailyBoundaryRow({ ...row, allow_new_unit: false })
  return {
    ok: row.ok === true,
    reason: boundary.reason,
    campaignStatus: boundary.campaignStatus,
    accountStatus: boundary.accountStatus,
    dbNow: boundary.dbNow,
    vietnamDateKey: boundary.vietnamDateKey,
    claimedVietnamDateKey: boundary.claimedVietnamDateKey,
    effectiveStopTime: boundary.effectiveStopTime,
    boundaryAt: boundary.boundaryAt,
    dayChanged: boundary.dayChanged,
    runningInputCount: Number(row.running_input_count || 0)
  }
}

export async function checkDailyMaintenanceBarrier(
  runtimeTarget: CampaignRuntimeTarget,
  vietnamDateKey: string
): Promise<DailyMaintenanceBarrierCheckResult> {
  const normalizedDateKey = String(vietnamDateKey || '').trim()
  if (runtimeTarget !== 'desktop' && runtimeTarget !== 'server') {
    throw new Error('Runtime target must be desktop or server for daily maintenance barrier')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateKey)) {
    throw new Error('Vietnam date key is invalid for daily maintenance barrier')
  }
  startOfVietnamDateKey(normalizedDateKey)
  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_check_daily_maintenance_barrier', {
    p_staff_id: u.staffId,
    p_runtime_target: runtimeTarget,
    p_vietnam_date_key: normalizedDateKey
  })
  if (error) {
    throw new Error(
      `Failed to check daily maintenance barrier: ${error.message}. ` +
      'Ensure migration v231 is applied; maintenance remains closed.'
    )
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) throw new Error('Daily maintenance barrier check returned no result')
  return {
    ready: row.ready === true,
    runningCampaignCount: Number(row.running_campaign_count || 0),
    dbNow: String(row.db_now || ''),
    vietnamDateKey: String(row.vietnam_date_key || '')
  }
}

export async function getPendingCampaigns(accountId: number, dbNow: string): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const now = parseDatabaseNow(dbNow)
  const currentVietnamTime = formatVietnamTimeForQuery(now)
  // 23:59 is the daily drain window when no earlier stop time is configured.
  // Do not even offer a campaign to the scheduler during that final minute;
  // an already-started execution unit is allowed to settle separately.
  if (currentVietnamTime >= '23:59:00') return []
  const { data, error } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('status', 'chờ xử lý')
    .eq('is_delete', false)
    .eq('provisioning_state', 'ready')
    .not('action_id', 'in', `(${MOBILE_MANAGED_SMS_ACTION_IDS.join(',')})`)
    .lte('schedule', now.toISOString())
    .or(`daily_stop_time.is.null,daily_stop_time.gt.${currentVietnamTime}`)
    .order('schedule', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(`Failed to get pending campaigns: ${error.message}`)
  return (data || []).map(row => mapCampaignFromDB(row))
}

export async function getDueMobileManagedCampaignsForLimitCheck(
  accountId: number,
  dbNow: string
): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const now = parseDatabaseNow(dbNow)
  const { data, error } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('status', 'chờ xử lý')
    .eq('is_delete', false)
    .in('action_id', [...MOBILE_MANAGED_SMS_ACTION_IDS])
    .lte('schedule', now.toISOString())

  if (error) throw new Error(`Failed to get due mobile-managed campaigns for limit check: ${error.message}`)
  return (data || []).map(row => mapCampaignFromDB(row))
}

type CampaignSchedulePlatformScope = 'all' | 'zalo' | 'non-zalo'

export async function maintainCampaignSchedules(
  vietnamDateKey: string,
  platformScope: CampaignSchedulePlatformScope = 'all',
  runtimeContext: DataGroupRuntimeContext = { runtimeTarget: 'desktop' }
): Promise<Campaign[]> {
  if (runtimeContext.runtimeTarget === 'server' && platformScope !== 'zalo') {
    throw new Error('Zalo Server schedule maintenance only supports the Zalo platform scope.')
  }

  const u = requireCurrentUser()
  const todayStart = startOfVietnamDateKey(vietnamDateKey)
  const accountRelation =
    'primary_account:auto_accounts!auto_campaigns_account_id_fkey!inner(name, flatform_type, is_delete, is_zalo_show_web, is_zalo_server, staff_id)'
  const staleCampaignRows: any[] = []
  let afterCampaignId = 0
  const pageSize = 500

  // PostgREST projects commonly cap a response at 1,000 rows. Keyset paging is
  // required here because permanently completed/no-catch-up rows may remain
  // stale and otherwise starve a later pending campaign that the v2 claim is
  // correctly holding behind maintenance.
  while (true) {
    let query = client()
      .from('auto_campaigns')
      .select(`*, auto_campaign_actions(name), ${accountRelation}`)
      .eq('staff_id', u.staffId)
      .eq('is_delete', false)
      .not('action_id', 'in', `(${MOBILE_MANAGED_SMS_ACTION_IDS.join(',')})`)
      .not('schedule', 'is', null)
      .lt('schedule', todayStart.toISOString())
      .in('status', ['chờ xử lý', 'hoàn thành'])
      .eq('primary_account.is_delete', false)
      .gt('id', afterCampaignId)

    if (platformScope === 'zalo') {
      query = query.eq('primary_account.flatform_type', 'zalo')
      if (runtimeContext.runtimeTarget === 'server') {
        query = query
          .eq('primary_account.is_zalo_show_web', false)
          .eq('primary_account.is_zalo_server', true)
          .eq('primary_account.staff_id', u.staffId)
          .or(
            `organization_id.is.null,organization_id.eq.${u.organizationId}`,
            { referencedTable: 'primary_account' }
          )
      } else {
        query = query.eq('primary_account.is_zalo_server', false)
      }
    } else if (platformScope === 'non-zalo') {
      query = query.neq('primary_account.flatform_type', 'zalo')
    } else if (runtimeContext.runtimeTarget === 'desktop') {
      query = query.eq('primary_account.is_zalo_server', false)
    }

    const { data, error } = await query
      .order('id', { ascending: true })
      .limit(pageSize)

    if (error) throw new Error(`Failed to list stale campaign schedules: ${error.message}`)
    const page = data || []
    staleCampaignRows.push(...page)
    if (page.length < pageSize) break

    const nextAfterCampaignId = Number(page[page.length - 1]?.id)
    if (!Number.isSafeInteger(nextAfterCampaignId) || nextAfterCampaignId <= afterCampaignId) {
      throw new Error('Failed to advance stale campaign schedule pagination')
    }
    afterCampaignId = nextAfterCampaignId
  }

  const updatedCampaigns: Campaign[] = []
  const maintenanceErrors: Array<{ campaignId: number; message: string }> = []
  const campaigns = staleCampaignRows.map(row => mapCampaignFromDB(row))
  const finalizeForMaintenance = async (campaign: Campaign, note: string): Promise<boolean> => {
    if (campaign.dataTargetSourceMode === 'data_group') {
      await finalizeDataGroupCampaign(campaign.id, note, runtimeContext)
      return true
    }
    if (runtimeContext.runtimeTarget === 'server') {
      const result = await finalizeZaloServerMaintenanceCampaign(
        campaign.id,
        note,
        runtimeContext.runtimeModeRevision
      )
      // The account/campaign can be deleted or otherwise leave the candidate
      // set after the page query but before the fail-closed RPC takes its locks.
      // Stop processing this row so maintenance never advances stale state.
      return result.reason !== 'not_found'
    }
    const result = await finalizeCampaign(campaign.id, note, 'chờ xử lý')
    return result.reason !== 'not_found'
  }

  for (const campaign of campaigns) {
    try {
      const scheduleType = campaign.scheduleType || 'daily'
      const isCompletedNonCatchUpDailyCampaign = scheduleType === 'daily'
        && campaign.status === 'hoàn thành'
        && (
          campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID
          || campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID
        )
      if (isCompletedNonCatchUpDailyCampaign) continue

      const nextSchedule = resolveNextSchedule(campaign, todayStart)
      if (!nextSchedule) {
        // A stale pending row must never survive a successful maintenance pass:
        // the v2 atomic claim deliberately treats that state as not maintained.
        // Isolate an invalid recurrence instead of making every campaign for the
        // same staff loop forever at the maintenance barrier.
        if (campaign.status === 'chờ xử lý') {
          const updated = await updateCampaign(campaign.id, {
            status: 'tạm dừng',
            note: 'Lịch chạy không hợp lệ. Vui lòng kiểm tra lại ngày chạy trong tuần/tháng.'
          })
          updatedCampaigns.push(updated)
        }
        continue
      }

      if (isPastScheduleEnd(campaign, nextSchedule)) {
        const candidateStillValid = await finalizeForMaintenance(
          campaign,
          'Chiến dịch đã hết ngày kết thúc'
        )
        if (!candidateStillValid) continue
        await updateCampaign(campaign.id, {
          schedule: nextSchedule.toISOString()
        })
        const updated = await getCampaign(campaign.id)
        if (!updated) throw new Error('Không tìm thấy chiến dịch sau khi kiểm tra data trước khi hoàn thành.')
        updatedCampaigns.push(updated)
        continue
      }

      if (campaign.status === 'chờ xử lý' && isAtOrAfterDailyDrainTime(nextSchedule)) {
        // 23:59 is reserved for draining the last already-claimed unit. Older
        // app versions allowed recurring campaigns to use that exact slot; if
        // maintenance kept rolling those rows forward they could be skipped
        // forever. Pause instead of silently changing the user's run time.
        const updated = await updateCampaign(campaign.id, {
          status: 'tạm dừng',
          note: '23:59 là thời gian hệ thống dừng nhận lượt mới để cập nhật lịch ngày mới. Vui lòng chọn giờ chạy sớm hơn.'
        })
        updatedCampaigns.push(updated)
        continue
      }

      if (scheduleType === 'daily') {
        if (campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID) {
          const candidateStillValid = await finalizeForMaintenance(
            campaign,
            'Chiến dịch chúc mừng sinh nhật không chạy bù qua ngày'
          )
          if (!candidateStillValid) continue
          let updated = await getCampaign(campaign.id)
          if (!updated) throw new Error('Không tìm thấy chiến dịch sinh nhật sau khi kiểm tra data.')
          // A producer/finalizer race can legitimately leave fresh pending data.
          // Keep it runnable today, but never leave the old-day schedule which
          // the atomic top-level claim must reject.
          if (
            updated.status === 'chờ xử lý' &&
            (!updated.schedule || new Date(updated.schedule).getTime() < todayStart.getTime())
          ) {
            updated = await updateCampaign(campaign.id, { schedule: todayStart.toISOString() })
          }
          if (
            updated.status !== campaign.status ||
            updated.note !== campaign.note ||
            updated.schedule !== campaign.schedule
          ) {
            updatedCampaigns.push(updated)
          }
          continue
        }

        if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
          const candidateStillValid = await finalizeForMaintenance(
            campaign,
            'Chiến dịch lướt newsfeed không chạy tiếp qua ngày'
          )
          if (!candidateStillValid) continue
          let updated = await getCampaign(campaign.id)
          if (!updated) throw new Error('Không tìm thấy chiến dịch newsfeed sau khi kiểm tra data.')
          if (
            updated.status === 'chờ xử lý' &&
            (!updated.schedule || new Date(updated.schedule).getTime() < todayStart.getTime())
          ) {
            updated = await updateCampaign(campaign.id, { schedule: todayStart.toISOString() })
          }
          if (
            updated.status !== campaign.status ||
            updated.note !== campaign.note ||
            updated.schedule !== campaign.schedule
          ) {
            updatedCampaigns.push(updated)
          }
          continue
        }

        if (campaign.status !== 'chờ xử lý') continue

        // continueNextDay controls timing, not whether stale daily data continues.
        // true advances to today's configured run time. false deliberately keeps
        // the already-due timestamp unchanged so the campaign can continue as
        // soon as the scheduler runs after midnight.
        if (campaign.continueNextDay) {
          const updated = await updateCampaign(campaign.id, {
            schedule: nextSchedule.toISOString(),
            note: null
          })
          updatedCampaigns.push(updated)
        } else if (campaign.note != null) {
          const updated = await updateCampaign(campaign.id, { note: null })
          updatedCampaigns.push(updated)
        }
        continue
      }

      const details = await listCampaignInputData(campaign.id)
      const allDataDone = details.length > 0 && details.every(detail => detail.status === 'hoàn thành')
      const shouldRefreshData = campaign.refreshData && (allDataDone || details.length === 0)

      if (campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID) {
        if (details.length > 0) {
          await clearCampaignInputData(campaign.id)
        }

        const updated = await updateCampaign(campaign.id, {
          status: 'chờ xử lý',
          schedule: nextSchedule.toISOString(),
          note: null,
          extraSettings: clearZaloFriendRecommendationMaterializedExtra(campaign.extraSettings)
        })
        updatedCampaigns.push(updated)
        continue
      }

      if (campaign.actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID) {
        if (details.length > 0) {
          await clearCampaignInputData(campaign.id)
        }

        const updated = await updateCampaign(campaign.id, {
          status: 'chờ xử lý',
          schedule: nextSchedule.toISOString(),
          note: null,
          extraSettings: clearZaloCancelSentFriendRequestMaterializedExtra(campaign.extraSettings)
        })
        updatedCampaigns.push(updated)
        continue
      }

      if (campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID) {
        if (details.length > 0) {
          const { error: deleteError } = await client()
            .from('auto_campaign_input_data')
            .update({ is_delete: true })
            .eq('campaign_id', campaign.id)
            .eq('is_delete', false)

          if (deleteError) throw new Error(`Failed to clear birthday campaign input data: ${deleteError.message}`)
        }

        const updated = await updateCampaign(campaign.id, {
          status: 'chờ xử lý',
          schedule: nextSchedule.toISOString(),
          note: null,
          extraSettings: clearZaloBirthdayMaterializedExtra(campaign.extraSettings)
        })
        updatedCampaigns.push(updated)
        continue
      }

      if (shouldRefreshData) {
        if (details.length > 0) {
          const { error: resetError } = await client()
            .from('auto_campaign_input_data')
            .update({
              status: 'chờ xử lý',
              note: '',
              date_action: null
            })
            .eq('campaign_id', campaign.id)
            .eq('is_delete', false)
            .neq('status', 'tạm dừng')

          if (resetError) throw new Error(`Failed to reset campaign input data: ${resetError.message}`)
        }

        const updated = await updateCampaign(campaign.id, {
          status: 'chờ xử lý',
          schedule: nextSchedule.toISOString(),
          note: null
        })
        updatedCampaigns.push(updated)
        continue
      }

      const updated = await updateCampaign(campaign.id, {
        schedule: nextSchedule.toISOString(),
        note: null
      })
      updatedCampaigns.push(updated)
    } catch (err) {
      console.error(`Failed to maintain campaign schedule ${campaign.id}:`, err)
      maintenanceErrors.push({
        campaignId: campaign.id,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (maintenanceErrors.length > 0) {
    const summary = maintenanceErrors
      .slice(0, 5)
      .map(item => `#${item.campaignId}: ${item.message}`)
      .join('; ')
    throw new Error(`Maintenance failed for ${maintenanceErrors.length} campaign(s): ${summary}`)
  }

  return updatedCampaigns
}

export function maintainZaloCampaignSchedules(vietnamDateKey: string): Promise<Campaign[]> {
  return maintainCampaignSchedules(vietnamDateKey, 'zalo')
}

export function maintainZaloServerCampaignSchedules(
  runtimeModeRevision: string,
  vietnamDateKey: string
): Promise<Campaign[]> {
  return maintainCampaignSchedules(vietnamDateKey, 'zalo', {
    runtimeTarget: 'server',
    runtimeModeRevision
  })
}

export function maintainNonZaloCampaignSchedules(vietnamDateKey: string): Promise<Campaign[]> {
  return maintainCampaignSchedules(vietnamDateKey, 'non-zalo')
}

async function listStaffCampaignIds(staffId: number, context: string): Promise<number[]> {
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('id')
    .eq('staff_id', staffId)
    .not('action_id', 'in', `(${MOBILE_MANAGED_SMS_ACTION_IDS.join(',')})`)

  if (error) {
    console.error(`Failed to list staff campaign ids for ${context}:`, error.message)
    return []
  }

  return (data || []).map(row => row.id as number)
}

export async function resetRunningCampaignStatuses(staffId: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaigns')
    .update({ status: 'chờ xử lý' })
    .eq('staff_id', staffId)
    .not('action_id', 'in', `(${MOBILE_MANAGED_SMS_ACTION_IDS.join(',')})`)
    .eq('status', 'đang chạy')

  if (error) console.error('Failed to reset campaign statuses:', error.message)
}

export async function resetCampaignNotes(staffId: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaigns')
    .update({ note: null, updated_at: new Date().toISOString() })
    .eq('staff_id', staffId)
    .not('note', 'is', null)

  if (error) console.error('Failed to reset campaign notes:', error.message)
}

export async function resetRunningCampaignInputStatuses(staffId: number): Promise<void> {
  const campaignIds = await listStaffCampaignIds(staffId, 'campaign input reset')
  if (campaignIds.length === 0) return

  const { error } = await client()
    .from('auto_campaign_inputs')
    .update({ status: 'chờ xử lý' })
    .in('campaign_id', campaignIds)
    .eq('status', 'đang chạy')

  if (error) console.error('Failed to reset campaign input statuses:', error.message)
}

export async function resetRunningCampaignInputDataStatuses(staffId: number): Promise<void> {
  const campaignIds = await listStaffCampaignIds(staffId, 'campaign input data reset')
  if (campaignIds.length === 0) return

  const { error } = await client()
    .from('auto_campaign_input_data')
    .update({ status: 'chờ xử lý' })
    .in('campaign_id', campaignIds)
    .eq('status', 'đang chạy')

  if (error) console.error('Failed to reset campaign input data statuses:', error.message)
}

// =========== CAMPAIGN INPUTS (pool nguyên liệu) ===========

export async function listCampaignInputs(campaignId: number): Promise<CampaignInput[]> {
  const { data, error } = await client()
    .from('auto_campaign_inputs')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list campaign inputs: ${error.message}`)
  return (data || []).map(row => mapCampaignInputFromDB(row))
}

export async function createCampaignInput(input: Partial<CampaignInput>): Promise<CampaignInput> {
  const payload = {
    campaign_id: input.campaignId,
    name: input.name || null,
    phone: input.phone || null,
    uid: input.uid || null,
    email: input.email || null,
    status: input.status || 'chờ xử lý',
    note: input.note || null,
    schedule: input.schedule || null
  }

  const { data, error } = await client()
    .from('auto_campaign_inputs')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign input: ${error.message}`)
  return mapCampaignInputFromDB(data)
}

export async function updateCampaignInput(id: number, updates: Partial<CampaignInput>): Promise<CampaignInput> {
  const payload: any = {}
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.phone !== undefined) payload.phone = updates.phone
  if (updates.uid !== undefined) payload.uid = updates.uid
  if (updates.email !== undefined) payload.email = updates.email
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.note !== undefined) payload.note = updates.note
  if (updates.schedule !== undefined) payload.schedule = updates.schedule
  if (updates.dateAction !== undefined) payload.date_action = updates.dateAction

  const { data, error } = await client()
    .from('auto_campaign_inputs')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update campaign input: ${error.message}`)
  return mapCampaignInputFromDB(data)
}

export async function deleteCampaignInput(id: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_inputs')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete campaign input: ${error.message}`)
}

// =========== CAMPAIGN INPUT DATA (việc-cần-làm) ===========

export async function listCampaignInputData(campaignId: number): Promise<CampaignInputData[]> {
  const rows: CampaignInputData[] = []
  let from = 0

  while (true) {
    const { data, error } = await client()
      .from('auto_campaign_input_data')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('is_delete', false)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + CAMPAIGN_INPUT_DATA_FETCH_CHUNK - 1)

    if (error) throw new Error(`Failed to list campaign input data: ${error.message}`)

    const page = data || []
    rows.push(...page.map(row => mapCampaignInputDataFromDB(row)))
    if (page.length < CAMPAIGN_INPUT_DATA_FETCH_CHUNK) break
    from += CAMPAIGN_INPUT_DATA_FETCH_CHUNK
  }

  return rows
}

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const nullableString = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
  return text || null
}

function mapCampaignInputDataOrigin(value: unknown): CampaignInputDataOrigin {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const numberArray = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.map(Number).filter(item => Number.isFinite(item) && item > 0)
    : []
  const stringArray = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.map(item => String(item || '').trim()).filter(Boolean)
    : []
  return {
    originId: nullableNumber(row.origin_id),
    originKind: nullableString(row.origin_kind),
    groupId: nullableNumber(row.group_id),
    groupName: nullableString(row.group_name),
    groupColor: nullableString(row.group_color),
    membershipId: nullableNumber(row.membership_id),
    membershipIsDelete: row.membership_is_delete === true,
    contactId: nullableNumber(row.contact_id),
    contactName: nullableString(row.contact_name),
    sourceId: nullableNumber(row.source_id),
    sourceStatus: nullableString(row.source_status) as CampaignInputDataOrigin['sourceStatus'],
    batchId: nullableNumber(row.batch_id),
    batchKind: nullableString(row.batch_kind),
    batchSourceName: nullableString(row.batch_source_name),
    datasetIds: numberArray(row.dataset_ids),
    datasetNames: stringArray(row.dataset_names),
    automationDetailId: nullableNumber(row.automation_detail_id),
    automationId: nullableNumber(row.automation_id),
    automationName: nullableString(row.automation_name),
    automationSourceCampaignId: nullableNumber(row.automation_source_campaign_id),
    automationSourceCampaignName: nullableString(row.automation_source_campaign_name),
    automationTargetCampaignId: nullableNumber(row.automation_target_campaign_id),
    automationTargetCampaignName: nullableString(row.automation_target_campaign_name),
    canonicalTargetKey: nullableString(row.canonical_target_key),
    createdAt: nullableString(row.created_at)
  }
}

async function enrichCampaignDetailsWithTriggeredAutomations(
  details: CampaignDetail[],
  staffId: number,
  organizationId: number,
  campaignId: number
): Promise<CampaignDetail[]> {
  const detailIds = uniquePositiveIds(details.map(detail => detail.id))
  if (detailIds.length === 0) return details
  const auth = requireCurrentUserCredentials()
  const { data, error } = await client().rpc('aka_agent_list_campaign_detail_automation_triggers', {
    p_staff_id: staffId,
    p_organization_id: organizationId,
    p_campaign_id: campaignId,
    p_campaign_detail_ids: detailIds,
    p_auth_username: auth.username,
    p_auth_password: auth.password
  })
  if (error) throw new Error(`Failed to enrich campaign details with triggered automations: ${error.message}`)
  const executionRows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []

  const triggersByDetailId = new Map<number, NonNullable<CampaignDetail['triggeredAutomations']>>()
  for (const row of executionRows) {
    const sourceDetailId = Number(row.source_campaign_detail_id)
    const automationDetailId = Number(row.automation_detail_id)
    const automationId = Number(row.automation_id)
    if (!Number.isFinite(sourceDetailId) || sourceDetailId <= 0
      || !Number.isFinite(automationDetailId) || automationDetailId <= 0
      || !Number.isFinite(automationId) || automationId <= 0) continue
    const automationName = String(row.automation_name || `Tự động hóa #${automationId}`)
    const triggers = triggersByDetailId.get(sourceDetailId) || []
    triggers.push({ automationDetailId, automationId, automationName })
    triggersByDetailId.set(sourceDetailId, triggers)
  }

  return details.map(detail => ({
    ...detail,
    triggeredAutomations: triggersByDetailId.get(detail.id) || []
  }))
}

interface AutomationDetailReference {
  automationId: number
  automationName: string
  sourceCampaignId: number | null
  targetCampaignId: number | null
}

async function loadAutomationReferencesByDetailIds(
  detailIds: number[],
  staffId: number,
  organizationId: number,
  auth: { username: string; password: string }
): Promise<Map<number, AutomationDetailReference>> {
  const references = new Map<number, AutomationDetailReference>()
  for (const chunk of chunkArray(uniquePositiveIds(detailIds), 500)) {
    const { data, error } = await client().rpc('aka_agent_list_automation_refs_by_detail_ids', {
      p_staff_id: staffId,
      p_organization_id: organizationId,
      p_detail_ids: chunk,
      p_auth_username: auth.username,
      p_auth_password: auth.password
    })
    if (error) throw new Error(`Failed to resolve campaign input automation provenance: ${error.message}`)
    for (const row of Array.isArray(data) ? data as Array<Record<string, unknown>> : []) {
      const automationDetailId = Number(row.automation_detail_id)
      const automationId = Number(row.automation_id)
      if (!Number.isFinite(automationDetailId) || automationDetailId <= 0
        || !Number.isFinite(automationId) || automationId <= 0) continue
      references.set(automationDetailId, {
        automationId,
        automationName: String(row.automation_name || `Tự động hóa #${automationId}`),
        sourceCampaignId: nullableNumber(row.source_campaign_id),
        targetCampaignId: nullableNumber(row.target_campaign_id)
      })
    }
  }
  return references
}

export async function listCampaignInputDataPage(
  query: CampaignInputDataPageQuery
): Promise<CampaignInputDataPageResult> {
  const u = requireCurrentUser()
  const auth = requireCurrentUserCredentials()
  const campaignId = Number(query.campaignId)
  if (!Number.isFinite(campaignId) || campaignId <= 0) throw new Error('Chiến dịch không hợp lệ.')
  const limit = Math.min(500, Math.max(1, Math.trunc(query.limit || 100)))
  const offset = Math.max(0, Math.trunc(query.offset || 0))
  const { data, error } = await client().rpc('aka_agent_list_campaign_input_data_page', {
    p_staff_id: u.staffId,
    p_organization_id: u.organizationId,
    p_campaign_id: campaignId,
    p_search: nullableString(query.search),
    p_status: nullableString(query.status),
    p_origin_filter: query.originFilter || 'all',
    p_date_from: nullableString(query.dateFrom),
    p_date_to: nullableString(query.dateTo),
    p_offset: offset,
    p_limit: limit,
    p_auth_username: auth.username,
    p_auth_password: auth.password
  })
  if (error) throw new Error(`Failed to list campaign input data page: ${error.message}`)
  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []
  const items = rows.map(row => {
    const inputData = row.input_data && typeof row.input_data === 'object' && !Array.isArray(row.input_data)
      ? row.input_data as Record<string, unknown>
      : {}
    const mapped = mapCampaignInputDataFromDB(inputData)
    mapped.origins = (Array.isArray(row.origins) ? row.origins : []).map(mapCampaignInputDataOrigin)
    return mapped
  })
  const automationDetailIds = items.flatMap(item => (
    item.origins || []
  ).map(origin => Number(origin.automationDetailId || 0)))
  const automationReferences = await loadAutomationReferencesByDetailIds(
    automationDetailIds,
    u.staffId,
    u.organizationId,
    auth
  )
  for (const item of items) {
    for (const origin of item.origins || []) {
      const reference = origin.automationDetailId
        ? automationReferences.get(origin.automationDetailId)
        : undefined
      if (!reference) continue
      origin.automationId = reference.automationId
      origin.automationName = reference.automationName
      origin.automationSourceCampaignId = reference.sourceCampaignId
      origin.automationTargetCampaignId = reference.targetCampaignId
    }
  }
  return {
    items,
    total: rows.length > 0 ? Math.max(0, Number(rows[0].total_count) || 0) : 0
  }
}

export async function listCampaignInputDataPreview(campaignId: number, limit: number): Promise<CampaignInputData[]> {
  const normalizedLimit = Math.floor(Number(limit))
  if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) return []

  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(normalizedLimit)

  if (error) throw new Error(`Failed to list campaign input data: ${error.message}`)
  return (data || []).map(row => mapCampaignInputDataFromDB(row))
}

export async function listCampaignInputDataByDateActionRange(
  campaignId: number,
  startIso: string,
  endIso: string,
  limit: number
): Promise<CampaignInputData[]> {
  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .gte('date_action', startIso)
    .lt('date_action', endIso)
    .order('date_action', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list campaign input data by date_action: ${error.message}`)
  return (data || []).map(row => mapCampaignInputDataFromDB(row))
}

export async function getCampaignInputDataStatusCounts(campaignId: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const statuses: CampaignInput['status'][] = ['chờ xử lý', 'đang chạy', 'hoàn thành', 'tạm dừng', 'lỗi']

  await Promise.all(statuses.map(async status => {
    const { count, error } = await client()
      .from('auto_campaign_input_data')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('is_delete', false)
      .eq('status', status)

    if (error) throw new Error(`Failed to count campaign input data status "${status}": ${error.message}`)
    if ((count ?? 0) > 0) counts[status] = count ?? 0
  }))

  return counts
}

async function loadZaloRemarketingCampaignMap(
  accountId: number,
  staffId: number,
  actionIds: string[]
): Promise<Map<number, ZaloRemarketingCampaignInfo>> {
  if (actionIds.length === 0) return new Map()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('id, name, action_id, auto_campaign_actions(name)')
    .eq('staff_id', staffId)
    .eq('account_id', accountId)
    .eq('is_delete', false)
    .in('action_id', actionIds)

  if (error) throw new Error(`Failed to list Zalo remarketing source campaigns: ${error.message}`)
  return new Map((data || []).map(row => {
    const record = row as Record<string, unknown>
    const action = nestedRecord(record.auto_campaign_actions)
    const id = Number(record.id)
    return [
      id,
      {
        id,
        name: textValue(record.name),
        actionId: textValue(record.action_id),
        actionName: firstText(action?.name, record.action_id)
      }
    ] as const
  }))
}

async function loadZaloRemarketingInputMap(inputDataIds: number[]): Promise<Map<number, ZaloRemarketingInputInfo>> {
  const ids = uniquePositiveIds(inputDataIds)
  if (ids.length === 0) return new Map()

  const rows: Record<string, unknown>[] = []
  for (const chunk of chunkArray(ids, 1000)) {
    const { data, error } = await client()
      .from('auto_campaign_input_data')
      .select('id, name, uid, phone, email, info1, info2, info3, info4, info5')
      .in('id', chunk)

    if (error) throw new Error(`Failed to list Zalo remarketing input data: ${error.message}`)
    rows.push(...((data || []) as Record<string, unknown>[]))
  }

  return new Map(rows.map(row => [
    Number(row.id),
    {
      id: Number(row.id),
      name: (row.name as string | null) ?? null,
      uid: (row.uid as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      info1: (row.info1 as string | null) ?? null,
      info2: (row.info2 as string | null) ?? null,
      info3: (row.info3 as string | null) ?? null,
      info4: (row.info4 as string | null) ?? null,
      info5: (row.info5 as string | null) ?? null
    }
  ]))
}

function getZaloRemarketingContactPhone(extraData: unknown): string {
  const extra = normalizeRecord(extraData) || {}
  return normalizeVietnamMobilePhone(firstText(
    extra.phone,
    extra.phoneNumber,
    extra.phone_number,
    extra.mobilePhone,
    extra.mobile_phone
  ))
}

function normalizeAkaBizTagIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map(item => Number(item))
      .filter(item => Number.isFinite(item) && item > 0)
      .map(item => Math.floor(item))
  ))
}

interface ZaloRemarketingLookup {
  nameByUid: Map<string, string>
  originalNameByUid: Map<string, string>
  phoneByUid: Map<string, string>
  groupNameByUid: Map<string, string>
  recipientStatusByUid: Map<string, string>
  isFriendByUid: Map<string, boolean>
  genderByUid: Map<string, number | string | null>
  akaBizTagIdsByUid: Map<string, number[]>
  extraDataByUid: Map<string, Record<string, unknown>>
}

async function loadZaloRemarketingLookup(
  accountId: number,
  staffId: number,
  uids: string[]
): Promise<ZaloRemarketingLookup> {
  const normalizedUids = Array.from(new Set(
    uids.map(uid => uid.trim()).filter(Boolean)
  ))
  const empty: ZaloRemarketingLookup = {
    nameByUid: new Map<string, string>(),
    originalNameByUid: new Map<string, string>(),
    phoneByUid: new Map<string, string>(),
    groupNameByUid: new Map<string, string>(),
    recipientStatusByUid: new Map<string, string>(),
    isFriendByUid: new Map<string, boolean>(),
    genderByUid: new Map<string, number | string | null>(),
    akaBizTagIdsByUid: new Map<string, number[]>(),
    extraDataByUid: new Map<string, Record<string, unknown>>()
  }
  if (normalizedUids.length === 0) return empty

  const nameByUid = new Map<string, string>()
  const originalNameByUid = new Map<string, string>()
  const phoneByUid = new Map<string, string>()
  const contactGroupIdByUid = new Map<string, string>()
  const groupIdByUid = new Map<string, string>()
  const recipientStatusByUid = new Map<string, string>()
  const isFriendByUid = new Map<string, boolean>()
  const genderByUid = new Map<string, number | string | null>()
  const akaBizTagIdsByUid = new Map<string, number[]>()
  const extraDataByUid = new Map<string, Record<string, unknown>>()
  const chunkSize = 100

  for (let i = 0; i < normalizedUids.length; i += chunkSize) {
    const chunk = normalizedUids.slice(i, i + chunkSize)
    const { data, error } = await client()
      .from('zalo_users')
      .select('zalo_uid, display_name, zalo_name, phone_number, is_fr, gender, raw_payload')
      .eq('account_id', accountId)
      .eq('staff_id', staffId)
      .in('zalo_uid', chunk)

    if (error) throw new Error(`Failed to list Zalo remarketing customer users: ${error.message}`)
    for (const row of data || []) {
      const record = row as Record<string, unknown>
      const uid = textValue(record.zalo_uid)
      const rawPayload = normalizeRecord(record.raw_payload) || {}
      const name = firstText(record.display_name, record.zalo_name)
      const originalName = firstText(record.zalo_name, record.display_name)
      const phone = normalizeVietnamMobilePhone(firstText(record.phone_number, rawPayload.phoneNumber, rawPayload.phone_number, rawPayload.phone))
      const isFr = Number(record.is_fr)
      const gender = record.gender
      if (uid && name && !nameByUid.has(uid)) nameByUid.set(uid, name)
      if (uid && originalName && !originalNameByUid.has(uid)) originalNameByUid.set(uid, originalName)
      if (uid && phone && !phoneByUid.has(uid)) phoneByUid.set(uid, phone)
      if (uid && Number.isFinite(isFr)) {
        if (isFr === 1) {
          isFriendByUid.set(uid, true)
          recipientStatusByUid.set(uid, 'Bạn bè')
        } else if (isFr === 0 && !isFriendByUid.has(uid)) {
          isFriendByUid.set(uid, false)
          if (!recipientStatusByUid.has(uid)) recipientStatusByUid.set(uid, 'Chưa kết bạn')
        }
      }
      if (uid && gender !== null && gender !== undefined && !genderByUid.has(uid)) {
        genderByUid.set(uid, gender as number | string | null)
      }
    }
  }

  for (let i = 0; i < normalizedUids.length; i += chunkSize) {
    const chunk = normalizedUids.slice(i, i + chunkSize)
    const { data, error } = await client()
      .from('auto_account_contacts')
      .select('uid, name, is_friend, extra_data, akabiz_tag_ids')
      .eq('account_id', accountId)
      .eq('staff_id', staffId)
      .eq('contact_type', 'person')
      .eq('is_delete', false)
      .in('uid', chunk)

    if (error) throw new Error(`Failed to list Zalo remarketing customer contacts: ${error.message}`)
    for (const row of data || []) {
      const record = row as Record<string, unknown>
      const uid = textValue(record.uid)
      const name = textValue(record.name)
      const extra = normalizeRecord(record.extra_data) || {}
      const phone = getZaloRemarketingContactPhone(extra)
      const groupId = firstText(extra.zaloGroupId, extra.zalo_group_id)
      const isFriend = record.is_friend
      const akaBizTagIds = normalizeAkaBizTagIds(record.akabiz_tag_ids)
      if (uid && name) nameByUid.set(uid, name)
      if (uid && phone && !phoneByUid.has(uid)) phoneByUid.set(uid, phone)
      if (uid && groupId && !contactGroupIdByUid.has(uid)) contactGroupIdByUid.set(uid, groupId)
      if (uid && akaBizTagIds.length > 0) akaBizTagIdsByUid.set(uid, akaBizTagIds)
      if (uid) extraDataByUid.set(uid, extra)
      if (uid && typeof isFriend === 'boolean') {
        if (isFriend) {
          isFriendByUid.set(uid, true)
          recipientStatusByUid.set(uid, 'Bạn bè')
        } else if (!isFriendByUid.has(uid)) {
          isFriendByUid.set(uid, false)
          if (!recipientStatusByUid.has(uid)) recipientStatusByUid.set(uid, 'Chưa kết bạn')
        }
      }
    }
  }

  for (const [uid, groupId] of contactGroupIdByUid.entries()) {
    groupIdByUid.set(uid, groupId)
  }

  for (let i = 0; i < normalizedUids.length; i += chunkSize) {
    const chunk = normalizedUids.slice(i, i + chunkSize)
    const { data, error } = await client()
      .from('zalo_group_members')
      .select('zalo_uid, zalo_group_id, is_current, last_seen_at, updated_at')
      .eq('account_id', accountId)
      .eq('staff_id', staffId)
      .in('zalo_uid', chunk)
      .order('is_current', { ascending: false })
      .order('last_seen_at', { ascending: false })
      .order('updated_at', { ascending: false })

    if (error) throw new Error(`Failed to list Zalo remarketing customer group memberships: ${error.message}`)
    for (const row of data || []) {
      const uid = textValue((row as Record<string, unknown>).zalo_uid)
      const groupId = textValue((row as Record<string, unknown>).zalo_group_id)
      if (uid && groupId && !groupIdByUid.has(uid)) groupIdByUid.set(uid, groupId)
    }
  }

  const groupIds = Array.from(new Set(Array.from(groupIdByUid.values()).filter(Boolean)))
  if (groupIds.length === 0) return {
    nameByUid,
    originalNameByUid,
    phoneByUid,
    groupNameByUid: new Map(),
    recipientStatusByUid,
    isFriendByUid,
    genderByUid,
    akaBizTagIdsByUid,
    extraDataByUid
  }

  const groupNameById = new Map<string, string>()
  for (let i = 0; i < groupIds.length; i += chunkSize) {
    const chunk = groupIds.slice(i, i + chunkSize)
    const { data, error } = await client()
      .from('zalo_groups')
      .select('zalo_group_id, name')
      .eq('account_id', accountId)
      .eq('staff_id', staffId)
      .in('zalo_group_id', chunk)

    if (error) throw new Error(`Failed to list Zalo remarketing customer groups: ${error.message}`)
    for (const row of data || []) {
      const groupId = textValue((row as Record<string, unknown>).zalo_group_id)
      const groupName = textValue((row as Record<string, unknown>).name)
      if (groupId && groupName) groupNameById.set(groupId, groupName)
    }
  }

  const groupNameByUid = new Map<string, string>()
  for (const [uid, groupId] of groupIdByUid.entries()) {
    const groupName = groupNameById.get(groupId)
    if (groupName) groupNameByUid.set(uid, groupName)
  }
  return {
    nameByUid,
    originalNameByUid,
    phoneByUid,
    groupNameByUid,
    recipientStatusByUid,
    isFriendByUid,
    genderByUid,
    akaBizTagIdsByUid,
    extraDataByUid
  }
}

function getZaloRemarketingDetailContext(
  detail: ZaloRemarketingDetailRecord,
  input?: ZaloRemarketingInputInfo
): {
  data: Record<string, unknown>
  target: Record<string, unknown>
  targetInput: Record<string, unknown>
  targetProfile: Record<string, unknown>
  uid: string
} {
  const data = normalizeRecord(detail.data) || {}
  const target = nestedRecord(data.target) || {}
  const targetRaw = nestedRecord(target.raw) || {}
  const targetInput = nestedRecord(targetRaw.inputData) || {}
  const targetProfile = nestedRecord(targetRaw.profile) || {}
  const uid = firstText(
    input?.uid,
    target.uid,
    data.targetUid,
    data.uid,
    targetInput.uid,
    targetProfile.uid
  )

  return {
    data,
    target,
    targetInput,
    targetProfile,
    uid
  }
}

function clampZaloRemarketingOffset(value: unknown): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function clampZaloRemarketingLimit(value: unknown, fallback = ZALO_REMARKETING_PAGE_DEFAULT_LIMIT): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(ZALO_REMARKETING_PAGE_MAX_LIMIT, parsed)
}

function normalizeOptionalZaloRemarketingLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  return clampZaloRemarketingLimit(value)
}

function normalizeZaloRemarketingIds(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(
    values
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)
  ))
}

function normalizeZaloRemarketingZaloTagIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(
    values
      .map(value => String(value || '').trim())
      .filter(Boolean)
  ))
}

function extractZaloRemarketingZaloTagIdsFromValue(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap(item => extractZaloRemarketingZaloTagIdsFromValue(item))
  if (typeof value === 'object') {
    const item = normalizeRecord(value) || {}
    const id = textValue(item.id || item.labelId || item.label_id || item.tagId || item.tag_id)
    return id ? [id] : []
  }
  const raw = textValue(value)
  return raw ? [raw] : []
}

function getZaloRemarketingContactZaloTagIds(contact: AutoAccountContact): string[] {
  const extra = normalizeRecord(contact.extraData) || {}
  const rawPayload = normalizeRecord(extra.rawPayload) || {}
  const tagIds = [
    extra.zaloTagIds,
    extra.zalo_tag_ids,
    extra.labelIds,
    extra.label_ids,
    extra.tagIds,
    extra.tag_ids,
    rawPayload.labelIds,
    rawPayload.label_ids,
    rawPayload.tagIds,
    rawPayload.tag_ids
  ].flatMap(value => normalizeZaloRemarketingZaloTagIds(value))

  tagIds.push(
    ...extractZaloRemarketingZaloTagIdsFromValue(extra.labels),
    ...extractZaloRemarketingZaloTagIdsFromValue(extra.tags),
    ...extractZaloRemarketingZaloTagIdsFromValue(rawPayload.labels),
    ...extractZaloRemarketingZaloTagIdsFromValue(rawPayload.tags)
  )

  const tagObjects = [
    Array.isArray(extra.zaloTags) ? extra.zaloTags : [],
    Array.isArray(extra.zalo_tags) ? extra.zalo_tags : [],
    Array.isArray(rawPayload.zaloTags) ? rawPayload.zaloTags : [],
    Array.isArray(rawPayload.zalo_tags) ? rawPayload.zalo_tags : []
  ].flat()

  for (const rawTag of tagObjects) {
    const tag = normalizeRecord(rawTag)
    const id = textValue(tag?.id || tag?.labelId || tag?.label_id || tag?.tagId || tag?.tag_id)
    if (id) tagIds.push(id)
  }

  return Array.from(new Set(tagIds))
}

function zaloRemarketingContactMatchesZaloTagFilter(contact: AutoAccountContact, tagIds: string[], includeNoTag: boolean): boolean {
  if (tagIds.length === 0 && !includeNoTag) return true
  const contactTagIds = new Set(getZaloRemarketingContactZaloTagIds(contact))
  if (includeNoTag && contactTagIds.size === 0) return true
  return tagIds.some(tagId => contactTagIds.has(tagId))
}

function zaloRemarketingContactMatchesAkaBizTagFilter(contact: AutoAccountContact, tagIds: number[], includeNoTag: boolean): boolean {
  if (tagIds.length === 0 && !includeNoTag) return true
  const contactTagIds = new Set(normalizeAkaBizTagIds(contact.akaBizTagIds))
  if (includeNoTag && contactTagIds.size === 0) return true
  return tagIds.some(tagId => contactTagIds.has(tagId))
}

function zaloRemarketingContactMatchesSearch(contact: AutoAccountContact, search: string): boolean {
  if (!search) return true
  const extra = contact.extraData || {}
  return [
    contact.name,
    contact.uid,
    extra.phone,
    extra.phoneNumber,
    extra.phone_number,
    extra.mobilePhone,
    extra.mobile_phone
  ].join(' ').toLocaleLowerCase('vi-VN').includes(search)
}

function filterZaloRemarketingContacts(
  contacts: AutoAccountContact[],
  query: ZaloRemarketingCustomerListQuery
): AutoAccountContact[] {
  const ids = normalizeZaloRemarketingIds(query.ids)
  const idSet = ids.length > 0 ? new Set(ids) : null
  const excludeIds = new Set(normalizeZaloRemarketingIds(query.excludeIds))
  const search = textValue(query.search).toLocaleLowerCase('vi-VN')
  const zaloTagIds = normalizeZaloRemarketingZaloTagIds(query.zaloTagIds)
  const akaBizTagIds = normalizeAkaBizTagIds(query.akaBizTagIds)
  const includeNoZaloTag = query.zaloNoTag === true
  const includeNoAkaBizTag = query.akaBizNoTag === true
  return contacts.filter(contact => {
    if (idSet && !idSet.has(contact.id)) return false
    if (excludeIds.has(contact.id)) return false
    if (!zaloRemarketingContactMatchesSearch(contact, search)) return false
    if (!zaloRemarketingContactMatchesZaloTagFilter(contact, zaloTagIds, includeNoZaloTag)) return false
    if (!zaloRemarketingContactMatchesAkaBizTagFilter(contact, akaBizTagIds, includeNoAkaBizTag)) return false
    return true
  })
}

async function buildZaloRemarketingCustomers(
  accountId: number,
  query: ZaloRemarketingCustomerListQuery = {}
): Promise<AutoAccountContact[]> {
  const u = requireCurrentUser()
  const normalizedAccountId = Number(accountId)
  if (!Number.isFinite(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Tài khoản Zalo không hợp lệ.')
  }

  const { data: account, error: accountError } = await client()
    .from('auto_accounts')
    .select('id, flatform_type')
    .eq('id', normalizedAccountId)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (accountError) throw new Error(`Failed to verify Zalo account: ${accountError.message}`)
  if (!account || String(account.flatform_type || '') !== 'zalo') {
    throw new Error('Không tìm thấy tài khoản Zalo.')
  }

  const requestedActionIds = Array.isArray(query.campaignActionIds)
    ? query.campaignActionIds.map(textValue).filter(Boolean)
    : null
  const legacyActionId = textValue(query.campaignActionId)
  const actionIds = (requestedActionIds !== null
    ? requestedActionIds
    : legacyActionId && legacyActionId !== 'all'
      ? [legacyActionId]
      : ZALO_REMARKETING_SOURCE_ACTION_IDS
  ).filter((actionId, index, arr) => (
    ZALO_REMARKETING_SOURCE_ACTION_IDS.includes(actionId) && arr.indexOf(actionId) === index
  ))
  const campaignMap = await loadZaloRemarketingCampaignMap(normalizedAccountId, u.staffId, actionIds)
  const campaignIds = Array.from(campaignMap.keys())
  if (campaignIds.length === 0) return []

  const startIso = dateInputToVietnamIso(textValue(query.dateFrom))
  const endIso = dateInputToVietnamIso(textValue(query.dateTo), true)

  const details: ZaloRemarketingDetailRecord[] = []
  let detailFrom = 0
  while (true) {
    let detailQuery = client()
      .from('auto_campaign_details')
      .select('id, input_data_id, campaign_id, account_id, action_code, action_name, status, error_code, log, data, created_at')
      .eq('account_id', normalizedAccountId)
      .eq('is_delete', false)
      .in('campaign_id', campaignIds)
      .in('action_code', ZALO_REMARKETING_MESSAGE_ACTION_CODES)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(detailFrom, detailFrom + ZALO_REMARKETING_DETAIL_FETCH_CHUNK - 1)

    if (startIso) detailQuery = detailQuery.gte('created_at', startIso)
    if (endIso) detailQuery = detailQuery.lt('created_at', endIso)

    const { data: detailRows, error: detailError } = await detailQuery
    if (detailError) throw new Error(`Failed to list Zalo remarketing customers: ${detailError.message}`)

    details.push(...((detailRows || []) as ZaloRemarketingDetailRecord[]))
    if (!detailRows || detailRows.length < ZALO_REMARKETING_DETAIL_FETCH_CHUNK) break
    detailFrom += ZALO_REMARKETING_DETAIL_FETCH_CHUNK
  }

  const inputMap = await loadZaloRemarketingInputMap(
    details.map(row => Number(row.input_data_id)).filter(Number.isFinite)
  )
  const lookup = await loadZaloRemarketingLookup(
    normalizedAccountId,
    u.staffId,
    details.map(detail => {
      const input = detail.input_data_id ? inputMap.get(Number(detail.input_data_id)) : undefined
      return getZaloRemarketingDetailContext(detail, input).uid
    })
  )
  const rowsByUid = new Map<string, AutoAccountContact & { extraData: Record<string, unknown> }>()

  for (const detail of details) {
    const campaign = campaignMap.get(Number(detail.campaign_id))
    if (!campaign) continue
    const input = detail.input_data_id ? inputMap.get(Number(detail.input_data_id)) : undefined
    const { target, targetInput, targetProfile, uid } = getZaloRemarketingDetailContext(detail, input)
    if (!uid) continue
    const key = `${normalizedAccountId}:${uid}`.toLowerCase()
    const detailName = firstText(
      target.displayName,
      target.originalName,
      targetProfile.displayName,
      targetProfile.zaloName,
      targetProfile.zalo_name,
      targetInput.name
    )
    const name = firstText(
      lookup.nameByUid.get(uid),
      input?.name,
      detailName,
      uid
    )
    const originalName = firstText(
      lookup.originalNameByUid.get(uid),
      target.originalName,
      targetProfile.zaloName,
      targetProfile.zalo_name,
      targetInput.originalName
    )
    const phone = firstText(
      lookup.phoneByUid.get(uid),
      normalizeVietnamMobilePhone(input?.phone)
    )
    const groupName = lookup.groupNameByUid.get(uid) || ''
    const recipientStatus = lookup.recipientStatusByUid.get(uid) || ''
    const isFriend = lookup.isFriendByUid.get(uid)
    const gender = lookup.genderByUid.has(uid) ? lookup.genderByUid.get(uid) ?? null : null
    const akaBizTagIds = lookup.akaBizTagIdsByUid.get(uid) || []
    const contactExtraData = lookup.extraDataByUid.get(uid) || {}
    const existing = rowsByUid.get(key)
    if (existing) {
      existing.extraData = { ...contactExtraData, ...existing.extraData }
      existing.extraData.sentCount = Number(existing.extraData.sentCount || 0) + 1
      if ((!textValue(existing.name) || existing.name === existing.uid) && name && name !== existing.uid) {
        existing.name = name
      }
      if (!textValue(existing.extraData.phone) && phone) {
        existing.extraData.phone = phone
      }
      if (!textValue(existing.extraData.groupName) && groupName) {
        existing.extraData.groupName = groupName
      }
      if (!textValue(existing.extraData.recipientStatus) && recipientStatus) {
        existing.extraData.recipientStatus = recipientStatus
      }
      if (!textValue(existing.extraData.originalName) && originalName) {
        existing.extraData.originalName = originalName
      }
      if ((existing.extraData.gender === null || existing.extraData.gender === undefined) && gender !== null && gender !== undefined) {
        existing.extraData.gender = gender
      }
      if (isFriend !== undefined) {
        existing.isFriend = isFriend
      }
      if ((!existing.akaBizTagIds || existing.akaBizTagIds.length === 0) && akaBizTagIds.length > 0) {
        existing.akaBizTagIds = akaBizTagIds
      }
      continue
    }

    const latestSentAt = textValue(detail.created_at)
    const daysSinceLatest = latestSentAt ? getDaysSinceVietnam(latestSentAt) : null

    rowsByUid.set(key, {
      id: Number(detail.id),
      accountId: normalizedAccountId,
      contactType: 'person',
      name,
      uid,
      url: '',
      extraData: {
        ...contactExtraData,
        source: 'zalo_remarketing_customers',
        phone,
        groupName,
        latestCampaignId: campaign.id,
        latestCampaignName: campaign.name,
        latestCampaignActionId: campaign.actionId,
        latestCampaignActionName: campaign.actionName,
        sentCount: 1,
        latestSentAt,
        latestSentDate: latestSentAt ? formatVietnamDate(latestSentAt) : '',
        daysSinceLatest,
        latestStatus: detail.status,
        latestLog: textValue(detail.log),
        latestErrorCode: textValue(detail.error_code),
        recipientStatus,
        originalName,
        gender
      },
      akaBizTagIds,
      isFriend,
      isDelete: false
    })
  }

  return filterZaloRemarketingContacts(Array.from(rowsByUid.values()), query)
}

export async function listZaloRemarketingCustomers(
  accountId: number,
  query: ZaloRemarketingCustomerListQuery = {}
): Promise<ContactListResult> {
  const filtered = await buildZaloRemarketingCustomers(accountId, query)
  const offset = clampZaloRemarketingOffset(query.offset)
  const limit = clampZaloRemarketingLimit(query.limit)
  return {
    contacts: filtered.slice(offset, offset + limit),
    total: filtered.length
  }
}

export async function exportZaloRemarketingCustomers(
  accountId: number,
  query: ZaloRemarketingCustomerListQuery = {}
): Promise<AutoAccountContact[]> {
  const filtered = await buildZaloRemarketingCustomers(accountId, query)
  const offset = clampZaloRemarketingOffset(query.offset)
  const limit = normalizeOptionalZaloRemarketingLimit(query.limit)
  return limit === null ? filtered : filtered.slice(offset, offset + limit)
}

async function countPendingCampaignInputData(campaignId: number): Promise<number> {
  const { count, error } = await client()
    .from('auto_campaign_input_data')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .eq('status', 'chờ xử lý')

  if (error) throw new Error(`Failed to count pending campaign input data: ${error.message}`)
  return count ?? 0
}

async function listRelationDetailRows(campaignIds: number[]): Promise<CampaignRelationDetailRow[]> {
  const rows: CampaignRelationDetailRow[] = []
  const pageSize = 1000
  let from = 0

  while (true) {
    const { data, error } = await client()
      .from('auto_campaign_details')
      .select('campaign_id, action_name, status')
      .in('campaign_id', campaignIds)
      .eq('is_delete', false)
      .in('status', CAMPAIGN_RELATION_DETAIL_STATUSES)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Failed to list campaign relation details: ${error.message}`)

    const page = (data || []) as CampaignRelationDetailRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }

  return rows
}

const incrementRelationBreakdown = (
  breakdown: CampaignRelationSummary['successBreakdown'],
  actionName: string,
  status: CampaignDetailStatus
): void => {
  const existing = breakdown.find(item => item.actionName === actionName && item.status === status)
  if (existing) {
    existing.count += 1
    return
  }
  breakdown.push({ actionName, status, count: 1 })
}

const sortRelationBreakdown = (breakdown: CampaignRelationSummary['successBreakdown']): void => {
  breakdown.sort((a, b) =>
    b.count - a.count ||
    a.actionName.localeCompare(b.actionName, 'vi') ||
    a.status.localeCompare(b.status, 'vi')
  )
}

const isCampaignRelationSkippedStatus = (actionId: string, status: CampaignDetailStatus): boolean => {
  if (actionId === FACEBOOK_GROUP_INVITE_ACTION_ID) {
    return FACEBOOK_GROUP_INVITE_SKIPPED_DETAIL_STATUSES.includes(status)
  }
  return CAMPAIGN_RELATION_SKIPPED_DETAIL_STATUSES.includes(status)
}

export async function listCampaignRelationSummaries(campaignIds: number[]): Promise<CampaignRelationSummary[]> {
  const u = requireCurrentUser()
  const ids = Array.from(new Set(
    campaignIds
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && id > 0)
  ))

  if (ids.length === 0) return []

  const { data, error } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .in('id', ids)

  if (error) throw new Error(`Failed to list campaign relation summaries: ${error.message}`)

  const campaigns = (data || []).map(row => mapCampaignFromDB(row))
  const pendingCounts = await Promise.all(
    campaigns.map(campaign => countPendingCampaignInputData(campaign.id))
  )
  const summaryById = new Map<number, CampaignRelationSummary>()

  campaigns.forEach((campaign, index) => {
    summaryById.set(campaign.id, {
      campaignId: campaign.id,
      campaignName: campaign.name,
      actionId: campaign.actionId,
      actionName: campaign.actionName,
      accountId: campaign.accountId,
      accountName: campaign.accountName,
      pendingInputCount: pendingCounts[index] ?? 0,
      successCount: 0,
      skippedCount: 0,
      failureCount: 0,
      errorCount: 0,
      successBreakdown: [],
      skippedBreakdown: [],
      failureBreakdown: []
    })
  })

  const ownedIds = Array.from(summaryById.keys())
  const details = ownedIds.length > 0 ? await listRelationDetailRows(ownedIds) : []
  for (const detail of details) {
    const summary = summaryById.get(detail.campaign_id)
    if (!summary) continue

    const actionName = String(detail.action_name || '').trim() || 'Không rõ'
    if (CAMPAIGN_RELATION_SUCCESS_DETAIL_STATUSES.includes(detail.status)) {
      summary.successCount += 1
      incrementRelationBreakdown(summary.successBreakdown, actionName, detail.status)
    } else if (isCampaignRelationSkippedStatus(summary.actionId, detail.status)) {
      summary.skippedCount += 1
      incrementRelationBreakdown(summary.skippedBreakdown, actionName, detail.status)
    } else {
      summary.failureCount += 1
      if (detail.status === 'lỗi') summary.errorCount += 1
      incrementRelationBreakdown(summary.failureBreakdown, actionName, detail.status)
    }
  }

  for (const summary of summaryById.values()) {
    sortRelationBreakdown(summary.successBreakdown)
    sortRelationBreakdown(summary.skippedBreakdown)
    sortRelationBreakdown(summary.failureBreakdown)
  }

  return ids
    .map(id => summaryById.get(id))
    .filter((summary): summary is CampaignRelationSummary => !!summary)
}

export async function createCampaignInputData(action: Partial<CampaignInputData>): Promise<CampaignInputData> {
  const result = await createCampaignInputDataBatchInternal([action], true)
  const created = result.rows[0]
  if (!created) throw new Error('Failed to create campaign input data.')
  return created
}

type CampaignInputDataInsertPayload = {
  campaign_id: number
  input_id: number | null
  name: string | null
  phone: string | null
  phone_carrier: VietnamMobileCarrier | null
  uid: string | null
  email: string | null
  info1: string | null
  info2: string | null
  info3: string | null
  info4: string | null
  info5: string | null
  content: string | null
  status: CampaignInputStatus
  note: string | null
  schedule: string | null
}

type CampaignInputDataBatchInsertResult = {
  insertedCount: number
  rows: CampaignInputData[]
}

export type CampaignInputDataWriteProgressCallback = (
  processedCount: number,
  totalCount: number
) => void

function notifyCampaignInputDataWriteProgress(
  onProgress: CampaignInputDataWriteProgressCallback | undefined,
  processedCount: number,
  totalCount: number
): void {
  try {
    onProgress?.(processedCount, totalCount)
  } catch {
    // Progress is best-effort and must never change the database write result.
  }
}

async function rollbackCreatedCampaignInputData(ids: number[]): Promise<void> {
  for (const idChunk of chunkArray(ids, CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE)) {
    const { error } = await client()
      .from('auto_campaign_input_data')
      .update({ is_delete: true })
      .eq('is_delete', false)
      .in('id', idChunk)
    if (error) throw new Error(`Failed to rollback campaign input data: ${error.message}`)
  }
}

async function insertCampaignInputDataPayload(
  payload: CampaignInputDataInsertPayload[],
  returnRows: boolean,
  beforeChunk?: () => void,
  rollbackOnFailure = false,
  onProgress?: CampaignInputDataWriteProgressCallback
): Promise<CampaignInputDataBatchInsertResult> {
  let insertedCount = 0
  const rows: CampaignInputData[] = []
  const insertedIds: number[] = []
  try {
    for (const payloadChunk of chunkArray(payload, CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE)) {
      beforeChunk?.()
      if (returnRows) {
        const { data, error } = await client()
          .from('auto_campaign_input_data')
          .insert(payloadChunk)
          .select()
        if (error) throw new Error(`Failed to create campaign input data: ${error.message}`)
        insertedCount += data?.length ?? payloadChunk.length
        rows.push(...(data || []).map(row => mapCampaignInputDataFromDB(row)))
        notifyCampaignInputDataWriteProgress(onProgress, insertedCount, payload.length)
        continue
      }

      if (rollbackOnFailure) {
        const { data, error } = await client()
          .from('auto_campaign_input_data')
          .insert(payloadChunk)
          .select('id')
        if (error) throw new Error(`Failed to create campaign input data: ${error.message}`)
        insertedCount += data?.length ?? payloadChunk.length
        insertedIds.push(...(data || []).map(row => Number(row.id)).filter(id => Number.isSafeInteger(id) && id > 0))
        notifyCampaignInputDataWriteProgress(onProgress, insertedCount, payload.length)
        continue
      }

      const { error } = await client()
        .from('auto_campaign_input_data')
        .insert(payloadChunk)
      if (error) throw new Error(`Failed to create campaign input data: ${error.message}`)
      insertedCount += payloadChunk.length
      notifyCampaignInputDataWriteProgress(onProgress, insertedCount, payload.length)
    }
  } catch (insertError) {
    if (rollbackOnFailure && insertedIds.length > 0) {
      try {
        await rollbackCreatedCampaignInputData(insertedIds)
      } catch (rollbackError) {
        const insertMessage = insertError instanceof Error ? insertError.message : String(insertError)
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        throw new Error(`${insertMessage}. Không thể rollback data đã lưu một phần: ${rollbackMessage}`)
      }
    }
    throw insertError
  }
  return { insertedCount, rows }
}

async function createCampaignInputDataBatchInternal(
  actions: Partial<CampaignInputData>[],
  returnRows: boolean,
  beforeChunk?: () => void,
  rollbackOnFailure = false,
  onProgress?: CampaignInputDataWriteProgressCallback
): Promise<CampaignInputDataBatchInsertResult> {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { insertedCount: 0, rows: [] }
  }

  const actionsByCampaignId = new Map<number, Partial<CampaignInputData>[]>()
  for (const action of actions) {
    const campaignId = Math.floor(Number(action.campaignId))
    if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
      throw new Error('Chiến dịch của input không hợp lệ.')
    }
    const campaignActions = actionsByCampaignId.get(campaignId)
    if (campaignActions) campaignActions.push(action)
    else actionsByCampaignId.set(campaignId, [action])
  }

  const u = requireCurrentUser()
  let insertedCount = 0
  const insertedRows: CampaignInputData[] = []
  for (const [campaignId, campaignActions] of actionsByCampaignId) {
    const { data: campaignRow, error: campaignError } = await client()
      .from('auto_campaigns')
      .select(CAMPAIGN_SELECT)
      .eq('id', campaignId)
      .eq('staff_id', u.staffId)
      .eq('organization_id', u.organizationId)
      .eq('is_delete', false)
      .maybeSingle()
    if (campaignError) throw new Error(`Failed to load campaign for input data: ${campaignError.message}`)
    if (!campaignRow) throw new Error('Không tìm thấy chiến dịch của input.')

    const campaign = mapCampaignFromDB(campaignRow)
    if (campaign.dataTargetSourceMode === 'data_group') {
      throw new Error('Input của chiến dịch Nhóm data chỉ được tạo qua RPC reserve canonical của Nhóm data.')
    }
    await ensureCurrentUserCanUseCampaignAction(campaign.actionId)

    const isSmsInputData = isMobileManagedSmsCampaignAction(campaign.actionId)
    const rowIndexOffset = isSmsInputData
      ? await countActiveCampaignInputData(campaignId)
      : 0
    const payload = campaignActions.map((action, rowIndex): CampaignInputDataInsertPayload => {
      const schedule = action.schedule || (
        isSmsInputData
          ? campaign.schedule || campaign.originalSchedule || null
          : null
      )
      const phone = isSmsInputData
        ? normalizeVietnamMobilePhone(action.phone)
        : action.phone || ''
      const renderRow = {
        ...action,
        phone,
        schedule: schedule || undefined
      }
      return {
        campaign_id: campaignId,
        input_id: action.inputId ?? null,
        name: action.name || null,
        phone: phone || null,
        phone_carrier: isSmsInputData
          ? normalizeCampaignInputPhoneCarrier(phone, action.phoneCarrier)
          : null,
        uid: action.uid || null,
        email: action.email || null,
        info1: action.info1 || null,
        info2: action.info2 || null,
        info3: action.info3 || null,
        info4: action.info4 || null,
        info5: action.info5 || null,
        content: isSmsInputData
          ? renderMobileManagedInputContent(campaign, renderRow, rowIndexOffset + rowIndex, schedule)
          : action.content || null,
        status: action.status || 'chờ xử lý',
        note: action.note || null,
        schedule: schedule || null
      }
    })

    const processedBeforeCampaign = insertedCount
    const result = await insertCampaignInputDataPayload(
      payload,
      returnRows,
      beforeChunk,
      rollbackOnFailure,
      onProgress
        ? (processedCount) => onProgress(processedBeforeCampaign + processedCount, actions.length)
        : undefined
    )
    insertedCount += result.insertedCount
    insertedRows.push(...result.rows)
  }
  return { insertedCount, rows: insertedRows }
}

export async function createCampaignInputDataBatch(
  actions: Partial<CampaignInputData>[],
  onProgress?: CampaignInputDataWriteProgressCallback
): Promise<number> {
  return (await createCampaignInputDataBatchInternal(
    actions,
    false,
    undefined,
    true,
    onProgress
  )).insertedCount
}

export async function createCampaignInputDataBatchWithRollback(
  actions: Partial<CampaignInputData>[],
  beforeChunk?: () => void
): Promise<number> {
  if (!Array.isArray(actions) || actions.length === 0) return 0
  const campaignIds = new Set<number>()
  for (const action of actions) {
    const campaignId = Math.floor(Number(action.campaignId))
    if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
      throw new Error('Chiến dịch của input không hợp lệ.')
    }
    campaignIds.add(campaignId)
  }
  if (campaignIds.size !== 1) {
    throw new Error('Rollback batch chỉ hỗ trợ data của một chiến dịch.')
  }
  return (await createCampaignInputDataBatchInternal(
    actions,
    false,
    beforeChunk,
    true
  )).insertedCount
}

export async function createSmsCampaignInputDataSnapshot(action: Partial<CampaignInputData>): Promise<CampaignInputData> {
  const u = requireCurrentUser()
  const campaignId = Number(action.campaignId)
  const targetCampaign = Number.isFinite(campaignId) && campaignId > 0
    ? await getCampaign(campaignId)
    : null
  if (targetCampaign?.dataTargetSourceMode === 'data_group') {
    throw new Error('SMS/voice không hỗ trợ nguồn Nhóm data.')
  }
  const actionId = Number.isFinite(campaignId) && campaignId > 0
    ? await getCampaignActionIdForCurrentUser(campaignId, u.staffId)
    : null
  if (actionId !== SMS_SEND_ACTION_ID) {
    throw new Error('Campaign nhận SMS không phải chiến dịch gửi SMS nội bộ.')
  }
  await ensureCurrentUserCanUseCampaignAction(actionId)

  const phone = normalizeVietnamMobilePhone(action.phone)
  const schedule = action.schedule || new Date().toISOString()
  const payload = {
    campaign_id: campaignId,
    input_id: action.inputId ?? null,
    name: action.name || null,
    phone: phone || null,
    phone_carrier: normalizeCampaignInputPhoneCarrier(phone, action.phoneCarrier),
    uid: action.uid || null,
    email: action.email || null,
    info1: action.info1 || null,
    info2: action.info2 || null,
    info3: action.info3 || null,
    info4: action.info4 || null,
    info5: action.info5 || null,
    content: action.content ?? null,
    status: action.status || 'chờ xử lý',
    note: action.note || null,
    schedule
  }

  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create SMS campaign input data snapshot: ${error.message}`)
  return mapCampaignInputDataFromDB(data)
}

export async function updateCampaignInputData(id: number, updates: Partial<CampaignInputData>): Promise<CampaignInputData> {
  const immutablePayloadFields: Array<keyof CampaignInputData> = [
    'inputId', 'name', 'phone', 'phoneCarrier', 'uid', 'email',
    'info1', 'info2', 'info3', 'info4', 'info5', 'content', 'schedule',
    'isDelete', 'canonicalTargetKey'
  ]
  if (immutablePayloadFields.some(field => updates[field] !== undefined)) {
    const u = requireCurrentUser()
    const { data: inputRow, error: inputError } = await client()
      .from('auto_campaign_input_data')
      .select('campaign_id, canonical_target_key')
      .eq('id', id)
      .eq('is_delete', false)
      .maybeSingle()
    if (inputError) throw new Error(`Failed to validate campaign input mutation: ${inputError.message}`)
    if (!inputRow) throw new Error('Không tìm thấy input cần cập nhật.')
    const campaign = await getCampaign(Number(inputRow.campaign_id))
    if (!campaign || campaign.staffId !== u.staffId) throw new Error('Không tìm thấy chiến dịch của input.')
    if (campaign.dataTargetSourceMode === 'data_group' || inputRow.canonical_target_key) {
      throw new Error('Payload canonical là snapshot bất biến; chỉ được cập nhật trạng thái, ghi chú và kết quả chạy.')
    }
  }
  const payload: any = {}
  const shouldUpdateCarrier = updates.phone !== undefined || updates.phoneCarrier !== undefined
  const actionId = shouldUpdateCarrier ? await getCampaignActionIdForInputData(id) : null
  const isSmsInputData = isMobileManagedSmsCampaignAction(actionId)
  if (updates.inputId !== undefined) payload.input_id = updates.inputId
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.phone !== undefined) {
    payload.phone = updates.phone
    payload.phone_carrier = isSmsInputData ? normalizeCampaignInputPhoneCarrier(updates.phone, updates.phoneCarrier) : null
  } else if (updates.phoneCarrier !== undefined) {
    payload.phone_carrier = isSmsInputData ? normalizeCampaignInputPhoneCarrier(null, updates.phoneCarrier) : null
  }
  if (updates.uid !== undefined) payload.uid = updates.uid
  if (updates.email !== undefined) payload.email = updates.email
  if (updates.info1 !== undefined) payload.info1 = updates.info1
  if (updates.info2 !== undefined) payload.info2 = updates.info2
  if (updates.info3 !== undefined) payload.info3 = updates.info3
  if (updates.info4 !== undefined) payload.info4 = updates.info4
  if (updates.info5 !== undefined) payload.info5 = updates.info5
  if (updates.content !== undefined) payload.content = updates.content
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.note !== undefined) payload.note = updates.note
  if (updates.schedule !== undefined) payload.schedule = updates.schedule
  if (updates.dateAction !== undefined) payload.date_action = updates.dateAction

  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update campaign input data: ${error.message}`)
  return mapCampaignInputDataFromDB(data)
}

export async function bulkUpdateCampaignInputDataStatus(
  campaignId: number,
  ids: number[],
  status: InputDataBatchStatus
): Promise<BulkUpdateCampaignInputDataStatusResult> {
  const u = requireCurrentUser()
  const inputDataIds = uniquePositiveIds(ids)
  if (inputDataIds.length === 0) return { updatedCount: 0, skippedCount: 0 }
  if (status !== 'chờ xử lý' && status !== 'tạm dừng') {
    throw new Error('Trạng thái data không hợp lệ.')
  }

  const { count, error: campaignError } = await client()
    .from('auto_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('id', campaignId)
    .eq('staff_id', u.staffId)
    .eq('organization_id', u.organizationId)
    .eq('is_delete', false)

  if (campaignError) throw new Error(`Failed to verify campaign ownership: ${campaignError.message}`)
  if ((count ?? 0) === 0) throw new Error('Không tìm thấy chiến dịch.')

  const sourceStatuses: CampaignInputStatus[] = status === 'tạm dừng'
    ? ['chờ xử lý']
    : ['tạm dừng', 'hoàn thành']
  let updatedCount = 0
  for (const idChunk of chunkArray(inputDataIds, 500)) {
    const { data, error } = await client()
      .from('auto_campaign_input_data')
      .update({ status })
      .eq('campaign_id', campaignId)
      .eq('is_delete', false)
      .in('status', sourceStatuses)
      .in('id', idChunk)
      .select('id')

    if (error) throw new Error(`Failed to bulk update campaign input data status: ${error.message}`)
    updatedCount += data?.length ?? 0
  }

  return {
    updatedCount,
    skippedCount: Math.max(0, inputDataIds.length - updatedCount)
  }
}

function getAppendInputDataDedupeKeys(row: Partial<CampaignInputData>, actionId?: string | null): string[] {
  const requirement = getCampaignInputDataRequirement(actionId)
  if (!requirement) return []
  if (requirement.field === 'phone_or_uid') {
    const keys: string[] = []
    const phone = normalizeVietnamMobilePhone(row.phone)
    const uid = String(row.uid || '').trim().replace(/\/+$/g, '').toLowerCase()
    if (phone) keys.push(`phone:${phone}`)
    if (uid) keys.push(`uid:${uid}`)
    return keys
  }
  const value = String(row[requirement.field] || '').trim()
  if (actionId === 'email_send') return value ? [value.toLowerCase()] : []
  if (requirement.field === 'phone') {
    const phone = normalizeVietnamMobilePhone(value)
    return phone ? [phone] : []
  }
  const key = value.replace(/\/+$/g, '').toLowerCase()
  return key ? [key] : []
}

function normalizeAppendInputDataRow(row: Partial<CampaignInputData>, actionId: string): Partial<CampaignInputData> {
  const requirement = getCampaignInputDataRequirement(actionId)
  const shouldNormalizePhone = requirement?.field === 'phone' || requirement?.field === 'phone_or_uid' || isMobileManagedSmsCampaignAction(actionId)
  const phone = shouldNormalizePhone
    ? normalizeVietnamMobilePhone(row.phone)
    : String(row.phone || '').trim()
  return {
    name: String(row.name || '').trim(),
    phone,
    phoneCarrier: normalizeCampaignInputPhoneCarrier(phone, row.phoneCarrier),
    uid: String(row.uid || '').trim(),
    email: actionId === 'email_send'
      ? String(row.email || '').trim().toLowerCase()
      : String(row.email || '').trim(),
    info1: String(row.info1 || '').trim(),
    info2: String(row.info2 || '').trim(),
    info3: String(row.info3 || '').trim(),
    info4: String(row.info4 || '').trim(),
    info5: String(row.info5 || '').trim(),
    content: String(row.content || '').trim(),
    status: 'chờ xử lý',
    note: ''
  }
}

async function loadAppendInputDataExistingKeys(campaignId: number, actionId: string): Promise<Set<string>> {
  const requirement = getCampaignInputDataRequirement(actionId)
  if (!requirement) return new Set()
  const selectFields = requirement.field === 'phone_or_uid' ? 'phone, uid' : requirement.field

  const keys = new Set<string>()
  let offset = 0
  while (true) {
    const { data, error } = await client()
      .from('auto_campaign_input_data')
      .select(selectFields)
      .eq('campaign_id', campaignId)
      .eq('is_delete', false)
      .range(offset, offset + CAMPAIGN_INPUT_DATA_FETCH_CHUNK - 1)

    if (error) throw new Error(`Failed to load existing campaign input data: ${error.message}`)

    const rows = (data || []) as unknown as Record<string, unknown>[]
    for (const row of rows) {
      for (const key of getAppendInputDataDedupeKeys(mapCampaignInputDataFromDB(row), actionId)) {
        keys.add(key)
      }
    }
    if (rows.length < CAMPAIGN_INPUT_DATA_FETCH_CHUNK) break
    offset += CAMPAIGN_INPUT_DATA_FETCH_CHUNK
  }

  return keys
}

export async function addCampaignInputDataRows(
  request: AddCampaignInputDataRowsRequest,
  onProgress?: CampaignInputDataWriteProgressCallback
): Promise<AddCampaignInputDataRowsResult> {
  const u = requireCurrentUser()
  const campaignId = Number(request.campaignId)
  const campaignStatus = request.campaignStatus
  const scheduleDate = new Date(request.campaignSchedule)
  const rows = Array.isArray(request.rows) ? request.rows : []

  if (!Number.isFinite(campaignId) || campaignId <= 0) throw new Error('Chiến dịch không hợp lệ.')
  if (rows.length === 0) throw new Error('Vui lòng thêm ít nhất một data.')
  if (campaignStatus !== 'chờ xử lý' && campaignStatus !== 'tạm dừng') throw new Error('Trạng thái chiến dịch không hợp lệ.')
  if (Number.isNaN(scheduleDate.getTime())) throw new Error('Schedule không hợp lệ.')

  const { data: campaignRow, error: campaignError } = await client()
    .from('auto_campaigns')
    .select(CAMPAIGN_ACTION_STATUS_SELECT)
    .eq('id', campaignId)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (campaignError) throw new Error(`Failed to load campaign: ${campaignError.message}`)
  if (!campaignRow) throw new Error('Không tìm thấy chiến dịch.')

  const campaign = mapCampaignFromDB(campaignRow)
  if (campaign.dataTargetSourceMode === 'data_group') {
    throw new Error('Chiến dịch Nhóm data chỉ nhận input mới qua RPC ingest/reserve canonical.')
  }
  const actionRow = Array.isArray((campaignRow as any).auto_campaign_actions)
    ? (campaignRow as any).auto_campaign_actions[0]
    : (campaignRow as any).auto_campaign_actions
  if (!actionRow || actionRow.is_active !== true || actionRow.is_delete === true) {
    throw new Error('Loại chiến dịch này đã bị tắt hoặc đã xoá, không thể thêm data.')
  }
  await ensureCurrentUserCanUseCampaignAction(campaign.actionId)

  if (campaign.status === 'đang chạy') {
    throw new Error('Chiến dịch đang chạy, vui lòng tạm dừng trước khi thêm data.')
  }

  const requirement = getCampaignInputDataRequirement(campaign.actionId)
  if (!requirement || APPEND_DATA_UNSUPPORTED_ACTION_IDS.has(campaign.actionId)) {
    throw new Error('Loại chiến dịch này không hỗ trợ thêm data.')
  }

  const existingKeys = request.skipExistingInCampaign
    ? await loadAppendInputDataExistingKeys(campaignId, campaign.actionId)
    : new Set<string>()
  const batchKeys = new Set<string>()
  const validRows: Partial<CampaignInputData>[] = []
  let skippedInvalidCount = 0
  let skippedBatchDuplicateCount = 0
  let skippedExistingCount = 0

  for (const rawRow of rows) {
    const row = normalizeAppendInputDataRow(rawRow, campaign.actionId)
    const keys = getAppendInputDataDedupeKeys(row, campaign.actionId)
    if (keys.length === 0 || !isCampaignInputDataValidForAction(row, campaign.actionId)) {
      skippedInvalidCount += 1
      continue
    }
    if (keys.some(key => batchKeys.has(key))) {
      skippedBatchDuplicateCount += 1
      continue
    }
    if (request.skipExistingInCampaign && keys.some(key => existingKeys.has(key))) {
      skippedExistingCount += 1
      continue
    }
    keys.forEach(key => batchKeys.add(key))
    validRows.push(row)
  }

  const campaignSchedule = scheduleDate.toISOString()
  const isSmsTarget = isMobileManagedSmsCampaignAction(campaign.actionId)
  const smsRowIndexOffset = isSmsTarget && validRows.length > 0 ? await countActiveCampaignInputData(campaignId) : 0
  const payload = validRows.map((row, rowIndex) => ({
    campaign_id: campaignId,
    input_id: null,
    name: row.name || null,
    phone: row.phone || null,
    phone_carrier: isSmsTarget ? normalizeCampaignInputPhoneCarrier(row.phone, row.phoneCarrier) : null,
    uid: row.uid || null,
    email: row.email || null,
    info1: row.info1 || null,
    info2: row.info2 || null,
    info3: row.info3 || null,
    info4: row.info4 || null,
    info5: row.info5 || null,
    content: isSmsTarget ? renderMobileManagedInputContent(campaign, row, smsRowIndexOffset + rowIndex, campaignSchedule) : (row.content || null),
    status: 'chờ xử lý',
    note: '',
    schedule: isSmsTarget ? campaignSchedule : null
  }))

  let insertedCount = 0
  for (const chunk of chunkArray(payload, CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE)) {
    const { error: insertError } = await client()
      .from('auto_campaign_input_data')
      .insert(chunk)

    if (insertError) throw new Error(`Failed to add input data to campaign "${campaign.name}": ${insertError.message}`)
    insertedCount += chunk.length
    notifyCampaignInputDataWriteProgress(onProgress, insertedCount, payload.length)
  }

  if (insertedCount > 0) {
    await updateCampaign(campaignId, {
      schedule: campaignSchedule,
      originalSchedule: campaignSchedule,
      status: campaignStatus
    })
  }

  return {
    insertedCount,
    skippedBatchDuplicateCount,
    skippedExistingCount,
    skippedInvalidCount
  }
}

export async function addCampaignInputDataToCampaign(
  request: AddCampaignInputDataToCampaignRequest
): Promise<AddCampaignInputDataToCampaignResult> {
  const u = requireCurrentUser()
  const sourceCampaignId = Number(request.sourceCampaignId)
  const targetCampaignIds = uniquePositiveIds(request.targetCampaignIds)
  const sourceInputDataIds = uniquePositiveIds(request.sourceInputDataIds)
  const campaignStatus = request.campaignStatus
  const scheduleDate = new Date(request.campaignSchedule)

  if (!Number.isFinite(sourceCampaignId) || sourceCampaignId <= 0) throw new Error('Chiến dịch nguồn không hợp lệ.')
  if (targetCampaignIds.length === 0) throw new Error('Vui lòng chọn ít nhất một chiến dịch đích.')
  if (sourceInputDataIds.length === 0) throw new Error('Vui lòng chọn ít nhất một data.')
  if (campaignStatus !== 'chờ xử lý' && campaignStatus !== 'tạm dừng') throw new Error('Trạng thái chiến dịch không hợp lệ.')
  if (Number.isNaN(scheduleDate.getTime())) throw new Error('Schedule không hợp lệ.')

  const { data: sourceCampaign, error: sourceCampaignError } = await client()
    .from('auto_campaigns')
    .select('id')
    .eq('id', sourceCampaignId)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (sourceCampaignError) throw new Error(`Failed to verify source campaign: ${sourceCampaignError.message}`)
  if (!sourceCampaign) throw new Error('Không tìm thấy chiến dịch nguồn.')

  const sourceRowsById = new Map<number, Record<string, unknown>>()
  for (const idChunk of chunkArray(sourceInputDataIds, 500)) {
    const { data: sourceRows, error: sourceRowsError } = await client()
      .from('auto_campaign_input_data')
      .select('*')
      .eq('campaign_id', sourceCampaignId)
      .eq('is_delete', false)
      .in('id', idChunk)

    if (sourceRowsError) {
      throw new Error(`Failed to load selected campaign input data: ${sourceRowsError.message}`)
    }
    for (const row of sourceRows || []) {
      const rowId = Number(row.id)
      if (Number.isFinite(rowId) && rowId > 0) sourceRowsById.set(rowId, row)
    }
  }

  const selectedRows = [...sourceRowsById.values()]
    .sort((left, right) => {
      const byCreatedAt = String(left.created_at || '').localeCompare(String(right.created_at || ''))
      return byCreatedAt || Number(left.id || 0) - Number(right.id || 0)
    })
    .map(row => mapCampaignInputDataFromDB(row))
  if (selectedRows.length === 0) throw new Error('Không tìm thấy data đã chọn.')

  const targetRows: Record<string, unknown>[] = []
  for (const idChunk of chunkArray(targetCampaignIds, 500)) {
    const { data, error: targetError } = await client()
      .from('auto_campaigns')
      .select(CAMPAIGN_SELECT)
      .eq('staff_id', u.staffId)
      .eq('is_delete', false)
      .in('id', idChunk)

    if (targetError) throw new Error(`Failed to load target campaigns: ${targetError.message}`)
    targetRows.push(...(data || []))
  }

  const targetById = new Map(targetRows.map(row => {
    const campaign = mapCampaignFromDB(row)
    return [campaign.id, campaign] as const
  }))
  const results: AddCampaignInputDataToCampaignResult['targets'] = []
  const campaignSchedule = scheduleDate.toISOString()

  for (const targetId of targetCampaignIds) {
    const target = targetById.get(targetId)
    if (!target) {
      results.push({
        campaignId: targetId,
        campaignName: `ID ${targetId}`,
        actionId: '',
        insertedCount: 0,
        skippedInvalidCount: selectedRows.length,
        skippedRunning: false,
        error: 'Không tìm thấy chiến dịch đích.'
      })
      continue
    }

    try {
      await ensureCurrentUserCanUseCampaignAction(target.actionId)
    } catch (err) {
      results.push({
        campaignId: target.id,
        campaignName: target.name,
        actionId: target.actionId,
        insertedCount: 0,
        skippedInvalidCount: selectedRows.length,
        skippedRunning: false,
        error: err instanceof Error ? err.message : String(err)
      })
      continue
    }

    if (target.dataTargetSourceMode === 'data_group') {
      results.push({
        campaignId: target.id,
        campaignName: target.name,
        actionId: target.actionId,
        insertedCount: 0,
        skippedInvalidCount: selectedRows.length,
        skippedRunning: false,
        error: 'Chiến dịch Nhóm data chỉ nhận input mới qua RPC ingest/reserve canonical.'
      })
      continue
    }

    if (target.status === 'đang chạy') {
      results.push({
        campaignId: target.id,
        campaignName: target.name,
        actionId: target.actionId,
        insertedCount: 0,
        skippedInvalidCount: 0,
        skippedRunning: true,
        error: 'Chiến dịch đang chạy, không thể thêm data.'
      })
      continue
    }

    const requirement = getCampaignInputDataRequirement(target.actionId)
    if (!requirement) {
      results.push({
        campaignId: target.id,
        campaignName: target.name,
        actionId: target.actionId,
        insertedCount: 0,
        skippedInvalidCount: selectedRows.length,
        skippedRunning: false,
        error: 'Loại chiến dịch này không hỗ trợ thêm data.'
      })
      continue
    }

    const validRows = selectedRows.filter(row => isCampaignInputDataValidForAction(row, target.actionId))
    const skippedInvalidCount = selectedRows.length - validRows.length
    if (validRows.length === 0) {
      results.push({
        campaignId: target.id,
        campaignName: target.name,
        actionId: target.actionId,
        insertedCount: 0,
        skippedInvalidCount,
        skippedRunning: false,
        error: `Không có data hợp lệ cho ${requirement.label}.`
      })
      continue
    }

    const isSmsTarget = isMobileManagedSmsCampaignAction(target.actionId)
    const smsRowIndexOffset = isSmsTarget ? await countActiveCampaignInputData(target.id) : 0
    const payload = validRows.map((row, rowIndex) => {
      const phone = isSmsTarget ? normalizeVietnamMobilePhone(row.phone) : (row.phone || '')
      return {
        campaign_id: target.id,
        input_id: null,
        name: row.name || null,
        phone: phone || null,
        phone_carrier: isSmsTarget ? normalizeCampaignInputPhoneCarrier(phone, row.phoneCarrier) : null,
        uid: row.uid || null,
        email: row.email || null,
        info1: row.info1 || null,
        info2: row.info2 || null,
        info3: row.info3 || null,
        info4: row.info4 || null,
        info5: row.info5 || null,
        content: isSmsTarget ? renderMobileManagedInputContent(target, row, smsRowIndexOffset + rowIndex, campaignSchedule) : (row.content || null),
        status: 'chờ xử lý',
        note: '',
        schedule: isSmsTarget ? campaignSchedule : null
      }
    })

    let insertedCount = 0
    for (const chunk of chunkArray(payload, CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE)) {
      const { error: insertError } = await client()
        .from('auto_campaign_input_data')
        .insert(chunk)

      if (insertError) throw new Error(`Failed to add input data to campaign "${target.name}": ${insertError.message}`)
      insertedCount += chunk.length
    }

    await updateCampaign(target.id, {
      schedule: campaignSchedule,
      originalSchedule: campaignSchedule,
      status: campaignStatus
    })

    results.push({
      campaignId: target.id,
      campaignName: target.name,
      actionId: target.actionId,
      insertedCount,
      skippedInvalidCount,
      skippedRunning: false
    })
  }

  return {
    totalInsertedCount: results.reduce((sum, item) => sum + item.insertedCount, 0),
    totalSkippedInvalidCount: results.reduce((sum, item) => sum + item.skippedInvalidCount, 0),
    targets: results
  }
}

export async function resetCampaignInputDataForRerun(campaignId: number): Promise<void> {
  const campaign = await getCampaign(campaignId)
  if (campaign?.dataTargetSourceMode === 'data_group') {
    throw new Error('Chiến dịch Nhóm data không hỗ trợ chạy lại toàn bộ canonical input.')
  }
  const { error } = await client()
    .from('auto_campaign_input_data')
    .update({
      status: 'chờ xử lý',
      note: '',
      date_action: null
    })
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .neq('status', 'tạm dừng')

  if (error) throw new Error(`Failed to reset campaign input data for rerun: ${error.message}`)
}

export async function clearCampaignInputData(campaignId: number): Promise<void> {
  const campaign = await getCampaign(campaignId)
  if (campaign?.dataTargetSourceMode === 'data_group') {
    throw new Error('Không thể xoá ledger canonical của chiến dịch Nhóm data.')
  }
  const { error } = await client()
    .from('auto_campaign_input_data')
    .update({ is_delete: true })
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to clear campaign input data: ${error.message}`)
}

export async function deleteCampaignInputData(id: number): Promise<void> {
  await deleteCampaignInputDataBatch([id])
}

async function deleteCampaignInputDataBatchFallback(
  inputDataIds: number[]
): Promise<BulkDeleteCampaignInputDataResult> {
  const u = requireCurrentUser()
  const inputRows: Array<{ id: number; campaign_id: number; canonical_target_key: string | null }> = []
  for (const idChunk of chunkArray(inputDataIds, CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE)) {
    const { data, error } = await client()
      .from('auto_campaign_input_data')
      .select('id, campaign_id, canonical_target_key')
      .in('id', idChunk)
      .eq('is_delete', false)
    if (error) throw new Error(`Failed to validate campaign input delete: ${error.message}`)
    inputRows.push(...(data || []).map(row => ({
      id: Number(row.id),
      campaign_id: Number(row.campaign_id),
      canonical_target_key: row.canonical_target_key ? String(row.canonical_target_key) : null
    })))
  }

  const campaignIds = uniquePositiveIds(inputRows.map(row => row.campaign_id))
  const writableCampaignIds = new Set<number>()
  for (const campaignIdChunk of chunkArray(campaignIds, CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE)) {
    const { data, error } = await client()
      .from('auto_campaigns')
      .select('id, data_target_source_mode')
      .eq('staff_id', u.staffId)
      .eq('organization_id', u.organizationId)
      .eq('is_delete', false)
      .in('id', campaignIdChunk)
    if (error) throw new Error(`Failed to validate campaign input delete ownership: ${error.message}`)
    for (const campaign of data || []) {
      if (campaign.data_target_source_mode === 'data_group') {
        throw new Error('Canonical input được giữ làm ledger; manual retry phải dùng lại đúng input cũ.')
      }
      writableCampaignIds.add(Number(campaign.id))
    }
  }

  const writableIds = inputRows
    .filter(row => writableCampaignIds.has(row.campaign_id))
    .map(row => {
      if (row.canonical_target_key) {
        throw new Error('Canonical input được giữ làm ledger; manual retry phải dùng lại đúng input cũ.')
      }
      return row.id
    })

  let deletedCount = 0
  for (const idChunk of chunkArray(writableIds, CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE)) {
    const { data, error } = await client()
      .from('auto_campaign_input_data')
      .update({ is_delete: true })
      .eq('is_delete', false)
      .in('id', idChunk)
      .select('id')
    if (error) throw new Error(`Failed to delete campaign input data: ${error.message}`)
    deletedCount += data?.length ?? 0
  }
  return {
    deletedCount,
    skippedCount: Math.max(0, inputDataIds.length - deletedCount)
  }
}

export async function deleteCampaignInputDataBatch(
  ids: number[]
): Promise<BulkDeleteCampaignInputDataResult> {
  const inputDataIds = uniquePositiveIds(Array.isArray(ids) ? ids : [])
  if (inputDataIds.length === 0) return { deletedCount: 0, skippedCount: 0 }
  return deleteCampaignInputDataBatchFallback(inputDataIds)
}

// =========== CAMPAIGN ERROR STATE (campaign-scoped consecutive bad targets) ===========

export async function getCampaignErrorState(campaignId: number): Promise<CampaignErrorState | null> {
  const { data, error } = await client()
    .from('auto_campaign_error_state')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle()

  if (error) throw new Error(`Failed to get campaign error state: ${error.message}`)
  return data ? mapCampaignErrorStateFromDB(data) : null
}

export async function incrementCampaignBadTargetCount(
  campaignId: number,
  inputDataId: number | null | undefined,
  reason: string
): Promise<CampaignErrorState> {
  const existing = await getCampaignErrorState(campaignId)
  const now = new Date().toISOString()
  const nextCount = (existing?.countConsecutiveBadTargets || 0) + 1
  const payload = {
    count_consecutive_bad_targets: nextCount,
    last_input_data_id: inputDataId ?? null,
    last_reason: reason || null,
    last_bad_target_at: now,
    updated_at: now
  }

  if (existing) {
    const { data, error } = await client()
      .from('auto_campaign_error_state')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update campaign error state: ${error.message}`)
    return mapCampaignErrorStateFromDB(data)
  }

  const { data, error } = await client()
    .from('auto_campaign_error_state')
    .insert({
      campaign_id: campaignId,
      ...payload
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign error state: ${error.message}`)
  return mapCampaignErrorStateFromDB(data)
}

export async function resetCampaignBadTargetCount(campaignId: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_error_state')
    .upsert({
      campaign_id: campaignId,
      count_consecutive_bad_targets: 0,
      last_reason: null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'campaign_id' })

  if (error) throw new Error(`Failed to reset campaign error state: ${error.message}`)
}

// =========== CAMPAIGN DETAILS (per-milestone log) ===========

export async function listCampaignDetailsByInputData(inputDataId: number): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('input_data_id', inputDataId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list campaign details: ${error.message}`)
  return enrichCampaignDetailsWithInputData((data || []).map(row => mapCampaignDetailFromDB(row)))
}

export async function listCampaignDetailsByCampaign(campaignId: number): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw new Error(`Failed to list campaign details by campaign: ${error.message}`)
  return enrichCampaignDetailsWithInputData((data || []).map(row => mapCampaignDetailFromDB(row)))
}

const normalizeCampaignDetailPageDate = (value: string | null | undefined, label: string): string | null => {
  const text = String(value || '').trim()
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} không hợp lệ.`)
  return date.toISOString()
}

const normalizeCampaignDetailSearch = (value: string | null | undefined): string | null => {
  const text = String(value || '').trim().slice(0, 200)
  if (!text) return null
  // Build a PostgREST OR expression only from ordinary searchable characters;
  // punctuation that can alter filter grammar is deliberately discarded.
  return text
    .replace(/[^\p{L}\p{N}\s@:/._+#=\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null
}

export async function listCampaignDetailsPage(
  query: CampaignDetailPageQuery
): Promise<CampaignDetailPageResult> {
  const u = requireCurrentUser()
  const campaignId = Math.trunc(Number(query.campaignId))
  const staffId = Math.trunc(Number(u.staffId))
  const organizationId = Math.trunc(Number(u.organizationId))
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) throw new Error('Chiến dịch không hợp lệ.')
  if (!Number.isSafeInteger(staffId) || staffId <= 0 || !Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error('Phiên làm việc không có staff/tenant hợp lệ.')
  }

  const { data: ownedCampaign, error: campaignError } = await client()
    .from('auto_campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('staff_id', staffId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (campaignError) throw new Error(`Failed to validate campaign detail access: ${campaignError.message}`)
  if (!ownedCampaign) throw new Error('Không tìm thấy chiến dịch hoặc bạn không có quyền xem kết quả.')

  const limit = Math.min(500, Math.max(1, Math.trunc(Number(query.limit) || 100)))
  const offset = Math.max(0, Math.trunc(Number(query.offset) || 0))
  const status = String(query.status || '').trim().slice(0, 120)
  const search = normalizeCampaignDetailSearch(query.search)
  const dateFrom = normalizeCampaignDetailPageDate(query.dateFrom, 'Ngày bắt đầu')
  const dateTo = normalizeCampaignDetailPageDate(query.dateTo, 'Ngày kết thúc')
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('Khoảng thời gian lọc không hợp lệ.')

  let pageQuery = client()
    .from('auto_campaign_details')
    .select('*', { count: 'exact' })
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)

  if (status) pageQuery = pageQuery.eq('status', status)
  if (dateFrom) pageQuery = pageQuery.gte('created_at', dateFrom)
  if (dateTo) pageQuery = pageQuery.lte('created_at', dateTo)
  if (search) {
    const pattern = `*${search}*`
    pageQuery = pageQuery.or([
      `action_name.ilike.${pattern}`,
      `action_code.ilike.${pattern}`,
      `status.ilike.${pattern}`,
      `error_code.ilike.${pattern}`,
      `log.ilike.${pattern}`,
      `post_url.ilike.${pattern}`
    ].join(','))
  }

  const { data, error, count } = await pageQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(`Failed to list campaign detail page: ${error.message}`)
  const itemsWithInputData = await enrichCampaignDetailsWithInputData(
    (data || []).map(row => mapCampaignDetailFromDB(row)),
    campaignId
  )
  const items = await enrichCampaignDetailsWithTriggeredAutomations(
    itemsWithInputData,
    staffId,
    organizationId,
    campaignId
  )
  return { items, total: Math.max(0, Number(count) || 0) }
}

export async function listAllCampaignDetailsByCampaign(campaignId: number): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to list all campaign details by campaign: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function listCampaignDetailsByCreatedAtRange(
  campaignId: number,
  startIso: string,
  endIso: string,
  limit: number
): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list campaign details by created_at: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function listCampaignErrorDetailsByCreatedAtRange(
  campaignId: number,
  startIso: string,
  endIso: string,
  limit: number
): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .or('status.eq.lỗi,error_code.not.is.null')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list campaign error details by created_at: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function listLatestCampaignErrorDetails(
  campaignId: number,
  limit: number
): Promise<CampaignDetail[]> {
  const { data, error } = await client()
    .from('auto_campaign_details')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .or('status.eq.lỗi,error_code.not.is.null')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list latest campaign error details: ${error.message}`)
  return (data || []).map(row => mapCampaignDetailFromDB(row))
}

export async function createCampaignDetail(action: CreateCampaignDetailInput): Promise<CampaignDetail> {
  const payload: Record<string, unknown> = {
    input_data_id: action.inputDataId ?? null,
    campaign_id: action.campaignId,
    account_id: action.accountId,
    action_code: action.actionCode ?? null,
    action_name: action.actionName,
    status: action.status || 'thành công',
    error_code: action.errorCode ?? null,
    log: action.log || null,
    data: action.data || null,
    post_url: action.postUrl || null
  }
  if (action.shouldCountAction !== undefined) {
    payload.counts_toward_limit = action.shouldCountAction
  }

  const { data, error } = await client()
    .from('auto_campaign_details')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign detail: ${error.message}`)
  const detail = mapCampaignDetailFromDB(data)
  const shouldCountAction = detail.accountId && detail.actionCode && (
    action.shouldCountAction !== undefined
      ? action.shouldCountAction
      : shouldCountDetailByDefault(detail.actionCode, detail.status)
  )

  if (shouldCountAction) {
    try {
      await accountActionRepo.incrementAccountActionCount(detail.accountId as number, detail.actionCode as string, 1)
      await errorPolicyRepo.resetConsecutiveErrors(detail.accountId as number, detail.actionCode as string)
    } catch (countErr) {
      console.error('Failed to update account action counters:', countErr)
    }
  }

  return detail
}

export async function deleteCampaignDetail(id: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_details')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete campaign detail: ${error.message}`)
}

async function resolveAccountRateLimitStatus(
  accountId: number,
  actionCode: string,
  actionName: string,
  limitConfig: ActionLimitConfig | undefined,
  actionSnapshot: accountActionRepo.AccountActionStatusSnapshot
): Promise<AccountActionLimitStatus> {
  const normalizedActionCode = actionCode.trim()
  if (!normalizedActionCode) return { ok: true }

  const dailyLimit = limitConfig?.dailyLimit && limitConfig.dailyLimit > 0 ? limitConfig.dailyLimit : 30
  const rateLimitCount = limitConfig?.rateLimitCount && limitConfig.rateLimitCount > 0 ? limitConfig.rateLimitCount : 9
  const rateLimitMinutes = limitConfig?.rateLimitMinutes && limitConfig.rateLimitMinutes > 0 ? limitConfig.rateLimitMinutes : 65
  const actionStatus = actionSnapshot.status
  const dbNowMs = new Date(actionSnapshot.clock.dbNow).getTime()

  const disabledStatus = buildAccountActionDisabledStatus(
    actionStatus,
    normalizedActionCode,
    actionName,
    dbNowMs
  )
  if (disabledStatus) return disabledStatus

  const dailyActionCount = actionStatus.countActionInDay

  if (dailyActionCount >= dailyLimit) {
    // Daily limit → đợi tới 00:00 ngày mai mới reset
    const tomorrow = new Date(actionSnapshot.clock.nextVietnamMidnight)
    return {
      ok: false,
      actionCode: normalizedActionCode,
      actionName,
      errorCode: 'error_limit_in_day',
      isDailyLimit: true,
      retryAfterMs: Math.max(0, tomorrow.getTime() - dbNowMs),
      currentCount: dailyActionCount,
      limit: dailyLimit,
      dailyActionCount,
      dailyLimit,
      reason: `Đạt giới hạn ngày cho hành động "${actionName}" (${dailyActionCount}/${dailyLimit})`
    }
  }

  const timeFrameStart = new Date(dbNowMs - rateLimitMinutes * 60 * 1000)
  const timeFrameStartIso = timeFrameStart.toISOString()

  const windowActionCount = await countLimitDetailsInWindow(accountId, normalizedActionCode, timeFrameStartIso)

  if (windowActionCount >= rateLimitCount) {
    // Hourly limit → đợi tới khi row cũ nhất trong window > rateLimitMinutes phút
    const oldestCreatedAt = await getOldestLimitDetailCreatedAtInWindow(accountId, normalizedActionCode, timeFrameStartIso)
    let retryAfterMs = rateLimitMinutes * 60 * 1000
    if (oldestCreatedAt) {
      const oldestTime = new Date(oldestCreatedAt).getTime()
      retryAfterMs = Math.max(60 * 1000, (oldestTime + rateLimitMinutes * 60 * 1000) - dbNowMs)
    }
    return {
      ok: false,
      actionCode: normalizedActionCode,
      actionName,
      errorCode: 'error_limit_in_hour',
      isDailyLimit: false,
      retryAfterMs,
      currentCount: windowActionCount,
      limit: rateLimitCount,
      dailyActionCount,
      dailyLimit,
      windowActionCount,
      windowLimit: rateLimitCount,
      windowMinutes: rateLimitMinutes,
      reason: `Đạt tốc độ giới hạn hành động "${actionName}" (${windowActionCount}/${rateLimitCount} lần / ${rateLimitMinutes} phút)`
    }
  }

  return {
    ok: true,
    actionCode: normalizedActionCode,
    actionName,
    currentCount: windowActionCount,
    limit: rateLimitCount,
    dailyActionCount,
    dailyLimit,
    windowActionCount,
    windowLimit: rateLimitCount,
    windowMinutes: rateLimitMinutes
  }
}

export async function getAccountRateLimitStatus(
  accountId: number,
  actionCode: string,
  actionName: string,
  limitConfig?: ActionLimitConfig
): Promise<AccountActionLimitStatus> {
  const normalizedActionCode = actionCode.trim()
  if (!normalizedActionCode) return { ok: true }
  const actionSnapshot = await accountActionRepo.getAccountActionStatusSnapshot(accountId, normalizedActionCode)
  return resolveAccountRateLimitStatus(accountId, normalizedActionCode, actionName, limitConfig, actionSnapshot)
}

export async function peekAccountRateLimitStatus(
  accountId: number,
  actionCode: string,
  actionName: string,
  limitConfig?: ActionLimitConfig
): Promise<AccountActionLimitStatus> {
  const normalizedActionCode = actionCode.trim()
  if (!normalizedActionCode) return { ok: true }
  const actionSnapshot = await accountActionRepo.peekAccountActionStatusSnapshot(accountId, normalizedActionCode)
  return resolveAccountRateLimitStatus(accountId, normalizedActionCode, actionName, limitConfig, actionSnapshot)
}

function buildAccountActionDisabledStatus(
  actionStatus: AutoAccountActionStatus,
  actionCode: string,
  actionName: string,
  dbNowMs: number
): AccountActionLimitStatus | null {
  if (!actionStatus.isDisable) return null

  const retryAfterMs = actionStatus.dateEnable
    ? Math.max(0, new Date(actionStatus.dateEnable).getTime() - dbNowMs)
    : undefined
  if (actionStatus.dateEnable && retryAfterMs !== undefined && retryAfterMs <= 0) return null

  return {
    ok: false,
    actionCode,
    actionName,
    errorCode: actionStatus.disabledErrorCode || undefined,
    isActionDisabled: true,
    disabledReason: actionStatus.disabledReason,
    retryAfterMs,
    reason: retryAfterMs
      ? actionStatus.disabledReason || `Hành động "${actionName}" đang tạm dừng, còn khoảng ${Math.ceil(retryAfterMs / 60000)} phút`
      : actionStatus.disabledReason || `Hành động "${actionName}" đang tạm dừng`
  }
}

export async function getAccountActionDisabledStatus(
  accountId: number,
  actionCode: string,
  actionName: string
): Promise<AccountActionLimitStatus> {
  const normalizedActionCode = actionCode.trim()
  if (!normalizedActionCode) return { ok: true }

  const actionSnapshot = await accountActionRepo.getAccountActionStatusSnapshot(accountId, normalizedActionCode)
  return buildAccountActionDisabledStatus(
    actionSnapshot.status,
    normalizedActionCode,
    actionName,
    new Date(actionSnapshot.clock.dbNow).getTime()
  ) || {
    ok: true,
    actionCode: normalizedActionCode,
    actionName
  }
}

export async function applyCampaignDeliveryCooldown(
  campaignId: number,
  accountId: number,
  inputDataIds: number[]
): Promise<CampaignDeliveryCooldownDecision[]> {
  const user = requireCurrentUser()
  const normalizedIds = [...new Set(inputDataIds.filter(id => Number.isSafeInteger(id) && id > 0))]
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0 ||
      !Number.isSafeInteger(accountId) || accountId <= 0 ||
      normalizedIds.length < 1 || normalizedIds.length > 500) {
    throw new Error('Dữ liệu kiểm tra giới hạn gửi/đăng lặp không hợp lệ.')
  }

  const { data, error } = await client().rpc('aka_agent_apply_campaign_delivery_cooldown', {
    p_campaign_id: campaignId,
    p_account_id: accountId,
    p_staff_id: user.staffId,
    p_input_data_ids: normalizedIds
  })
  if (error) throw new Error(`Không thể kiểm tra lịch sử gửi/đăng gần nhất: ${error.message}`)

  return ((data || []) as Record<string, unknown>[]).map(row => ({
    inputDataId: Number(row.input_data_id),
    decision: String(row.decision || 'not_pending') as CampaignDeliveryCooldownDecisionCode,
    note: row.note == null ? null : String(row.note),
    lastSentAt: row.last_sent_at == null ? null : String(row.last_sent_at),
    eligibleDate: row.eligible_date == null ? null : String(row.eligible_date),
    sourceCampaignId: row.source_campaign_id == null ? null : Number(row.source_campaign_id),
    sourceCampaignName: row.source_campaign_name == null ? null : String(row.source_campaign_name)
  }))
}

export async function checkZaloMessageOptOut(
  campaignId: number,
  accountId: number,
  target: { phone?: string | null; globalId?: string | null }
): Promise<ZaloMessageOptOutCheckResult> {
  const user = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_check_zalo_message_opt_out', {
    p_campaign_id: campaignId,
    p_account_id: accountId,
    p_staff_id: user.staffId,
    p_phone: target.phone || null,
    p_zalo_global_id: target.globalId || null
  })
  if (error) throw new Error(`Không thể kiểm tra từ chối nhận tin Zalo: ${error.message}`)
  const row = ((data || []) as Record<string, unknown>[])[0]
  if (!row) throw new Error('RPC kiểm tra từ chối nhận tin Zalo không trả kết quả.')
  const matchedBy = String(row.matched_by || '')
  return {
    isOptedOut: row.is_opted_out === true,
    matchedBy: matchedBy === 'phone' || matchedBy === 'zalo_global_id' ? matchedBy : null
  }
}

export async function prepareZaloMessageOptOut(
  campaignId: number,
  accountId: number,
  target: { phone?: string | null; globalId: string }
): Promise<ZaloMessageOptOutPrepareResult> {
  const user = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_prepare_zalo_message_opt_out', {
    p_campaign_id: campaignId,
    p_account_id: accountId,
    p_staff_id: user.staffId,
    p_phone: target.phone || null,
    p_zalo_global_id: target.globalId
  })
  if (error) throw new Error(`Không thể tạo link từ chối nhận tin Zalo: ${error.message}`)
  const row = ((data || []) as Record<string, unknown>[])[0]
  const id = String(row?.id || '').trim()
  if (!id) throw new Error('RPC tạo link từ chối nhận tin Zalo không trả kết quả.')
  return { id, isOptedOut: row?.is_opted_out === true }
}

export async function pausePendingZaloMessageOptOutInput(
  campaignId: number,
  inputDataId: number,
  note: string
): Promise<boolean> {
  const user = requireCurrentUser()
  const campaign = await getCampaign(campaignId)
  if (!campaign || campaign.staffId !== user.staffId) return false
  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .update({ status: 'tạm dừng', note })
    .eq('id', inputDataId)
    .eq('campaign_id', campaignId)
    .eq('status', 'chờ xử lý')
    .eq('is_delete', false)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`Không thể đánh dấu data từ chối nhận tin Zalo: ${error.message}`)
  return Boolean(data)
}

export async function peekAccountActionDisabledStatus(
  accountId: number,
  actionCode: string,
  actionName: string
): Promise<AccountActionLimitStatus> {
  const normalizedActionCode = actionCode.trim()
  if (!normalizedActionCode) return { ok: true }

  const actionSnapshot = await accountActionRepo.peekAccountActionStatusSnapshot(accountId, normalizedActionCode)
  return buildAccountActionDisabledStatus(
    actionSnapshot.status,
    normalizedActionCode,
    actionName,
    new Date(actionSnapshot.clock.dbNow).getTime()
  ) || {
    ok: true,
    actionCode: normalizedActionCode,
    actionName
  }
}
