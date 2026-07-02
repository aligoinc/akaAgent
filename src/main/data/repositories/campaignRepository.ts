import {
  AccountActionLimitStatus,
  ActionLimitConfig,
  AuthEntitlements,
  Campaign,
  CampaignActionLimitSettings,
  CampaignInput,
  CampaignInputData,
  CampaignInputStatus,
  CampaignDetail,
  CampaignDetailStatus,
  CreateCampaignDetailInput,
  CampaignRelationSummary,
  AddCampaignInputDataToCampaignRequest,
  AddCampaignInputDataToCampaignResult,
  AutoAccountContact,
  AutoAccountActionStatus,
  BulkUpdateCampaignInputDataStatusResult,
  ContactListResult,
  getCampaignInputDataRequirement,
  isCampaignInputDataValidForAction,
  ZaloRemarketingCustomerListQuery
} from '../../../shared/types'
import { getVietnamMobileCarrier, normalizeVietnamMobilePhone, type VietnamMobileCarrier } from '../../../shared/phone'
import { normalizeSmsContentForSend, type SmsContentOptions } from '../../../shared/smsContent'
import { getSupabaseClient } from '../supabaseClient'
import { mapCampaignFromDB, mapCampaignInputFromDB, mapCampaignInputDataFromDB, mapCampaignDetailFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'
import { formatStoredCampaignLogLine } from '../../../shared/campaignLogFormat'
import * as accountActionRepo from './accountActionRepository'
import * as errorPolicyRepo from './errorPolicyRepository'
import {
  canUseCampaignActionWithEntitlements,
  ensureCurrentUserCanUseCampaignAction,
  getAccountActionDailySendLimit,
  getCampaignActionDailySendLimit,
  loadCurrentUserEffectiveEntitlements,
} from './entitlementRepository'

const client = () => getSupabaseClient()
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const VIETNAM_UTC_OFFSET = '+07:00'
const NEWSFEED_INTERACTION_ACTION_ID = 'facebook_newsfeed_interaction'
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const ZALO_MESSAGE_FRIEND_ACTION_ID = 'zalo_message_friend'
const ZALO_MESSAGE_BIRTHDAY_ACTION_ID = 'zalo_message_birthday'
const ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID = 'zalo_message_group_member'
const ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID = 'zalo_message_group_realtime'
const ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID = 'zalo_message_friend_recommendation'
const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID = 'zalo_cancel_sent_friend_request'
const SMS_SEND_ACTION_ID = 'sms_send'
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
const CAMPAIGN_LIST_PROGRESS_FETCH_CHUNK = 1000
const CAMPAIGN_LIST_PROGRESS_ID_CHUNK = 100
const CAMPAIGN_RELATION_SUCCESS_DETAIL_STATUSES: CampaignDetailStatus[] = ['thành công', 'đã xem', 'đã click']
const CAMPAIGN_RELATION_DETAIL_STATUSES: CampaignDetailStatus[] = [
  ...CAMPAIGN_RELATION_SUCCESS_DETAIL_STATUSES,
  'thất bại',
  'lỗi',
  'không tồn tại'
]
const CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE = 500
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
const FIND_DATA_TARGET_FIELDS = [
  'findUidTargetCampaignIds',
  'findPostLinkTargetCampaignIds',
  'findPhoneZaloMessagePhoneTargetCampaignIds',
  'findZaloGroupLinkJoinTargetCampaignIds',
  'findFacebookGroupPostTargetCampaignIds',
  'findFacebookGroupCommentTargetCampaignIds',
  'findFacebookGroupJoinTargetCampaignIds'
] as const
const RESTRICTED_CAMPAIGN_CONFIG_UPDATE_KEYS = new Set<keyof Campaign>([
  'name',
  'accountId',
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

const uniquePositiveIds = (ids: number[]): number[] => Array.from(new Set(
  ids
    .map(id => Number(id))
    .filter(id => Number.isFinite(id) && id > 0)
))

const getLinkedFindDataTargetIds = (extraSettings: unknown): number[] => {
  const extra = (extraSettings && typeof extraSettings === 'object')
    ? extraSettings as Record<string, unknown>
    : {}

  return uniquePositiveIds(FIND_DATA_TARGET_FIELDS.flatMap(field => {
    const value = extra[field]
    return Array.isArray(value) ? value.map(id => Number(id)) : []
  }))
}

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
  if (!shouldSkipCloneCampaignInputData(actionId, extraSettings)) return extraSettings
  const extra = extraSettings && typeof extraSettings === 'object'
    ? { ...(extraSettings as Record<string, unknown>) }
    : {}
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

function isSmsCampaignAction(actionId?: string | null): boolean {
  return actionId === SMS_SEND_ACTION_ID
}

function splitSmsContentVariants(content: string | undefined | null): string[] {
  const raw = String(content || '')
  const variants = raw.split('|').map(item => item.trim()).filter(Boolean)
  return variants.length > 0 ? variants : [raw]
}

function cycleSmsContentVariant(content: string | undefined | null, index: number): string {
  const variants = splitSmsContentVariants(content)
  if (variants.length === 0) return ''
  const safeIndex = ((index % variants.length) + variants.length) % variants.length
  return variants[safeIndex] || ''
}

function getSmsRenderBaseDate(schedule?: string | null): Date {
  const date = schedule ? new Date(schedule) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function formatSmsTemplateDate(baseDate: Date, format: string, offsetDays = 0): string {
  const date = new Date(baseDate.getTime() + offsetDays * 24 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const dateMap = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>
  return String(format || 'DD/MM/YYYY')
    .replace(/DD/g, dateMap.day || '')
    .replace(/MM/g, dateMap.month || '')
    .replace(/YYYY/g, dateMap.year || '')
    .replace(/YY/g, (dateMap.year || '').slice(-2))
}

function getSmsContentOptions(extraSettings?: Campaign['extraSettings'] | null): SmsContentOptions {
  return {
    useUnicode: extraSettings?.smsUseUnicode ?? false,
    keepNewLines: extraSettings?.smsKeepNewLines ?? false
  }
}

function renderSmsInputContent(
  campaign: Pick<Campaign, 'content' | 'schedule' | 'originalSchedule'> & { extraSettings?: Campaign['extraSettings'] },
  row: Partial<CampaignInputData>,
  rowIndex: number,
  scheduleOverride?: string | null
): string {
  const template = cycleSmsContentVariant(campaign.content, rowIndex)
  if (!template) return ''
  const baseDate = getSmsRenderBaseDate(scheduleOverride || row.schedule || campaign.schedule || campaign.originalSchedule)
  const getInput = (key: keyof CampaignInputData): string => String(row[key] ?? '').trim()
  const renderPhone = (): string => normalizeVietnamMobilePhone(row.phone)
  const renderSex = (body: string): string => {
    const [male = '', female = '', unknown = ''] = String(body || '').split('-')
    return unknown || male || female
  }

  const rendered = template
    .replace(/#\{(TODAY|TOMORROW|YESTERDAY)\(([^}]*)\)\}/g, (_, token, fmt) => {
      const offsetDays = token === 'TOMORROW' ? 1 : token === 'YESTERDAY' ? -1 : 0
      return formatSmsTemplateDate(baseDate, String(fmt || 'DD/MM/YYYY'), offsetDays)
    })
    .replace(/#\{SEX\{([^}]*)\}\}/g, (_, body) => renderSex(String(body || '')))
    .replace(/#\{FULL_NAME\}/g, getInput('name'))
    .replace(/#\{ORIGINAL_NAME\}/g, getInput('name'))
    .replace(/#\{INPUT_FULLNAME\}/g, getInput('name'))
    .replace(/#\{UID\}/g, getInput('uid'))
    .replace(/#\{PHONE\}/g, renderPhone())
    .replace(/#\{MOBILE\}/g, renderPhone())
    .replace(/#\{EMAIL\}/g, getInput('email'))
    .replace(/#\{INFO1\}/g, getInput('info1'))
    .replace(/#\{INFO2\}/g, getInput('info2'))
    .replace(/#\{INFO3\}/g, getInput('info3'))
    .replace(/#\{INFO4\}/g, getInput('info4'))
    .replace(/#\{INFO5\}/g, getInput('info5'))

  return normalizeSmsContentForSend(rendered, getSmsContentOptions(campaign.extraSettings))
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

function isSmsActionCode(actionCode?: string | null): boolean {
  return String(actionCode || '').trim() === SMS_SEND_ACTION_ID
}

function shouldCountDetailByDefault(actionCode: string | null | undefined, status: CampaignDetailStatus): boolean {
  if (isSmsActionCode(actionCode)) return true
  return LIMIT_COUNT_STATUSES.includes(status)
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
  const scopedLegacyQuery = isSmsActionCode(actionCode)
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
  const scopedLegacyQuery = isSmsActionCode(actionCode)
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

function startOfVietnamDay(date = new Date()): Date {
  const parts = parseVietnamParts(date)
  return makeVietnamDate({ year: parts.year, month: parts.month, day: parts.day })
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

export async function getCampaign(id: number): Promise<Campaign | null> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .single()

  if (error) return null
  return mapCampaignFromDB(data)
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
  const ids = Array.from(new Set(campaignIds.filter(id => Number.isFinite(id) && id > 0)))
  ids.forEach(id => progressByCampaign.set(id, { completed: 0, total: 0 }))
  if (ids.length === 0) return progressByCampaign

  for (const idChunk of chunkNumbers(ids, CAMPAIGN_LIST_PROGRESS_ID_CHUNK)) {
    let from = 0

    while (true) {
      const { data, error } = await client()
        .from('auto_campaign_input_data')
        .select('campaign_id, status')
        .in('campaign_id', idChunk)
        .eq('is_delete', false)
        .order('id', { ascending: true })
        .range(from, from + CAMPAIGN_LIST_PROGRESS_FETCH_CHUNK - 1)

      if (error) throw new Error(`Failed to load campaign input progress: ${error.message}`)

      const page = (data || []) as Array<{ campaign_id: number; status: string | null }>
      for (const row of page) {
        const campaignId = Number(row.campaign_id)
        const progress = progressByCampaign.get(campaignId)
        if (!progress) continue
        progress.total += 1
        if (row.status === 'hoàn thành') progress.completed += 1
      }

      if (page.length < CAMPAIGN_LIST_PROGRESS_FETCH_CHUNK) break
      from += CAMPAIGN_LIST_PROGRESS_FETCH_CHUNK
    }
  }

  return progressByCampaign
}

async function attachCampaignInputDataProgress(campaigns: Campaign[]): Promise<Campaign[]> {
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

export async function listCampaigns(): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list campaigns: ${error.message}`)
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const campaigns = filterCampaignsByEntitlements((data || []).map(row => mapCampaignFromDB(row)), entitlements)
  return attachCampaignInputDataProgress(campaigns)
}

export async function listZaloRealtimeGroupCampaignSnapshots(): Promise<ZaloRealtimeGroupCampaignSnapshot[]> {
  const u = requireCurrentUser()
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  if (!entitlements.zalo) return []

  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name, login_status, status, is_active)')
    .eq('staff_id', u.staffId)
    .eq('action_id', ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID)
    .eq('is_delete', false)
    .in('status', ['chờ xử lý', 'đang chạy'])

  if (error) throw new Error(`Không thể tải danh sách chiến dịch Zalo theo thời gian thực: ${error.message}`)

  return (data || []).map(row => {
    const account = (row as Record<string, any>).auto_accounts || {}
    return {
      campaign: mapCampaignFromDB(row),
      accountLoginStatus: String(account.login_status || ''),
      accountStatus: String(account.status || ''),
      accountIsActive: account.is_active !== false
    }
  })
}

export async function enqueueZaloRealtimeGroupEvent(
  request: EnqueueZaloRealtimeGroupEventRequest
): Promise<EnqueueZaloRealtimeGroupEventResult> {
  const { data, error } = await client().rpc('enqueue_campaign_zalo_realtime_group_event', {
    p_campaign_id: request.campaignId,
    p_account_id: request.accountId,
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

export async function createCampaign(campaign: Partial<Campaign>): Promise<Campaign> {
  const u = requireCurrentUser()
  await ensureCurrentUserCanUseCampaignAction(campaign.actionId)
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const isSmsCampaign = isSmsCampaignAction(campaign.actionId)
  const payload = {
    name: campaign.name,
    action_id: campaign.actionId,
    account_id: campaign.accountId,
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
    extra_settings: clampCampaignExtraSettingsDailyLimits(campaign.extraSettings, campaign.actionId, entitlements),
    images: campaign.images || [],
    log: '',
    note: campaign.note ?? null,
    staff_id: u.staffId,
    organization_id: u.organizationId
  }

  const { data, error } = await client()
    .from('auto_campaigns')
    .insert(payload)
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .single()

  if (error) throw new Error(`Failed to create campaign: ${error.message}`)
  return mapCampaignFromDB(data)
}

function smsMaterializationTouched(updates: Partial<Campaign>): boolean {
  return updates.actionId !== undefined ||
    updates.content !== undefined ||
    updates.schedule !== undefined ||
    updates.originalSchedule !== undefined ||
    updates.extraSettings !== undefined
}

async function rematerializeSmsInputData(campaign: Campaign, updateSchedule: boolean): Promise<void> {
  if (!isSmsCampaignAction(campaign.actionId)) return
  const rows = await listCampaignInputData(campaign.id)
  const schedule = campaign.schedule || campaign.originalSchedule || null

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row.status !== 'chờ xử lý' && row.status !== 'tạm dừng') continue
    const payload: Record<string, unknown> = {
      content: renderSmsInputContent(campaign, row, index, updateSchedule ? schedule : undefined),
      phone_carrier: normalizeCampaignInputPhoneCarrier(row.phone, row.phoneCarrier)
    }
    if (updateSchedule) payload.schedule = schedule

    const { error } = await client()
      .from('auto_campaign_input_data')
      .update(payload)
      .eq('id', row.id)
      .eq('campaign_id', campaign.id)
      .eq('is_delete', false)
      .in('status', ['chờ xử lý', 'tạm dừng'])

    if (error) throw new Error(`Failed to update SMS input content: ${error.message}`)
  }
}

export async function updateCampaign(id: number, updates: Partial<Campaign>): Promise<Campaign> {
  const u = requireCurrentUser()
  let targetActionId: string | null | undefined = updates.actionId
  if (updates.actionId !== undefined) {
    await ensureCurrentUserCanUseCampaignAction(updates.actionId)
  } else if (touchesRestrictedCampaignConfig(updates)) {
    const currentActionId = await getCampaignActionIdForCurrentUser(id, u.staffId)
    targetActionId = currentActionId
    await ensureCurrentUserCanUseCampaignAction(currentActionId)
  } else if (smsMaterializationTouched(updates)) {
    targetActionId = await getCampaignActionIdForCurrentUser(id, u.staffId)
  }
  const isSmsCampaign = isSmsCampaignAction(targetActionId)
  const payload: any = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.actionId !== undefined) payload.action_id = updates.actionId
  if (updates.accountId !== undefined) payload.account_id = updates.accountId
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
    payload.extra_settings = clampCampaignExtraSettingsDailyLimits(updates.extraSettings, targetActionId, entitlements)
  }
  if (updates.images !== undefined) payload.images = updates.images
  if (updates.log !== undefined) payload.log = updates.log
  if (updates.note !== undefined) payload.note = updates.note
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
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .single()

  if (error) throw new Error(`Failed to update campaign: ${error.message}`)
  const updatedCampaign = mapCampaignFromDB(data)
  if (isSmsCampaignAction(updatedCampaign.actionId) && smsMaterializationTouched(updates)) {
    await rematerializeSmsInputData(
      updatedCampaign,
      updates.actionId !== undefined || updates.schedule !== undefined || updates.originalSchedule !== undefined
    )
  }
  return updatedCampaign
}

export async function deleteCampaign(id: number): Promise<void> {
  const u = requireCurrentUser()
  const { data: campaign, error: fetchError } = await client()
    .from('auto_campaigns')
    .select('id, status, extra_settings')
    .eq('id', id)
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (fetchError) throw new Error(`Failed to load campaign before delete: ${fetchError.message}`)
  if (!campaign) throw new Error('Không tìm thấy chiến dịch cần xoá.')
  if (campaign.status === 'đang chạy') {
    throw new Error('Không thể xoá chiến dịch đang chạy.')
  }

  const linkedTargetIds = getLinkedFindDataTargetIds((campaign as { extra_settings?: unknown }).extra_settings)
  if (linkedTargetIds.length > 0) {
    throw new Error(`Không thể xoá chiến dịch nguồn đang gắn với chiến dịch khác (#${linkedTargetIds.join(', #')}).`)
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
  const skipCloningInputData = shouldSkipCloneCampaignInputData(origCamp.action_id, origCamp.extra_settings)

  const { data: newCamp, error: errInsert } = await client()
    .from('auto_campaigns')
    .insert({
      name: origCamp.name + ' (Copy)',
      action_id: origCamp.action_id,
      account_id: origCamp.account_id,
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
      staff_id: u.staffId,
      organization_id: u.organizationId
    })
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
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
      content: origCamp.content as string | undefined,
      schedule: origCamp.schedule as string | undefined,
      originalSchedule: (origCamp.original_schedule as string | null | undefined) ?? null,
      extraSettings: normalizeRecord(origCamp.extra_settings) as Campaign['extraSettings']
    }
    const isSmsClone = isSmsCampaignAction(origCamp.action_id as string)
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
        ? renderSmsInputContent(clonedCampaignForRender, mapCampaignInputDataFromDB(d), index, d.schedule as string | null | undefined)
        : d.content,
      note: d.note,
      status: 'chờ xử lý',
      schedule: d.schedule
    }))

    const { error: errInsertActions } = await client()
      .from('auto_campaign_input_data')
      .insert(actionsToInsert)

    if (errInsertActions) {
      console.warn('Failed to clone campaign input data:', errInsertActions)
    }
  }

  return mapCampaignFromDB(newCamp)
}

export async function appendCampaignLog(campaignId: number, logText: string): Promise<Campaign> {
  const { data: current, error: currentError } = await client()
    .from('auto_campaigns')
    .select('log, name, auto_accounts(name)')
    .eq('id', campaignId)
    .single()

  if (currentError) throw new Error(`Failed to load campaign log: ${currentError.message}`)
  if (!current) throw new Error('Campaign not found')

  const newLog = formatStoredCampaignLogLine(logText, {
    campaignName: (current as any)?.name,
    accountName: (current as any)?.auto_accounts?.name
  })
  const fullLog = current?.log ? `${current.log}\n${newLog}` : newLog

  const { data, error } = await client()
    .from('auto_campaigns')
    .update({ log: fullLog, updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .single()

  if (error) throw new Error(`Failed to append campaign log: ${error.message}`)
  return mapCampaignFromDB(data)
}

export async function getPendingCampaigns(accountId: number): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const now = new Date()
  const currentVietnamTime = formatVietnamTimeForQuery(now)
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('status', 'chờ xử lý')
    .eq('is_delete', false)
    .neq('action_id', SMS_SEND_ACTION_ID)
    .lte('schedule', now.toISOString())
    .or(`daily_stop_time.is.null,daily_stop_time.gte.${currentVietnamTime}`)

  if (error) throw new Error(`Failed to get pending campaigns: ${error.message}`)
  return (data || []).map(row => mapCampaignFromDB(row))
}

export async function getDueSmsCampaignsForLimitCheck(accountId: number): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const now = new Date()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('account_id', accountId)
    .eq('staff_id', u.staffId)
    .eq('status', 'chờ xử lý')
    .eq('is_delete', false)
    .eq('action_id', SMS_SEND_ACTION_ID)
    .lte('schedule', now.toISOString())

  if (error) throw new Error(`Failed to get due SMS campaigns for limit check: ${error.message}`)
  return (data || []).map(row => mapCampaignFromDB(row))
}

export async function maintainCampaignSchedules(): Promise<Campaign[]> {
  const u = requireCurrentUser()
  const todayStart = startOfVietnamDay()
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .neq('action_id', SMS_SEND_ACTION_ID)
    .not('schedule', 'is', null)
    .lt('schedule', todayStart.toISOString())
    .in('status', ['chờ xử lý', 'hoàn thành'])

  if (error) throw new Error(`Failed to list stale campaign schedules: ${error.message}`)

  const updatedCampaigns: Campaign[] = []
  const campaigns = (data || []).map(row => mapCampaignFromDB(row))

  for (const campaign of campaigns) {
    try {
      const scheduleType = campaign.scheduleType || 'daily'
      const nextSchedule = resolveNextSchedule(campaign, todayStart)
      if (!nextSchedule) continue

      if (isPastScheduleEnd(campaign, nextSchedule)) {
        const updated = await updateCampaign(campaign.id, {
          schedule: nextSchedule.toISOString(),
          ...(campaign.status !== 'hoàn thành'
            ? {
              status: 'hoàn thành',
              note: 'Chiến dịch đã hết ngày kết thúc'
            }
            : {})
        })
        updatedCampaigns.push(updated)
        continue
      }

      if (scheduleType === 'daily') {
        if (campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID) {
          if (campaign.status !== 'hoàn thành') {
            const updated = await updateCampaign(campaign.id, {
              status: 'hoàn thành',
              note: 'Chiến dịch chúc mừng sinh nhật không chạy bù qua ngày'
            })
            updatedCampaigns.push(updated)
          }
          continue
        }

        if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
          if (campaign.status !== 'hoàn thành') {
            const updated = await updateCampaign(campaign.id, {
              status: 'hoàn thành',
              note: 'Chiến dịch lướt newsfeed không chạy tiếp qua ngày'
            })
            updatedCampaigns.push(updated)
          }
          continue
        }

        if (campaign.status !== 'chờ xử lý') continue

        // continueNextDay controls timing, not whether stale daily data continues.
        // true waits until today's original scheduled time; false keeps the stale
        // schedule due so the scheduler can run it immediately when eligible.
        if (campaign.continueNextDay) {
          const updated = await updateCampaign(campaign.id, {
            schedule: nextSchedule.toISOString()
          })
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
        schedule: nextSchedule.toISOString()
      })
      updatedCampaigns.push(updated)
    } catch (err) {
      console.error(`Failed to maintain campaign schedule ${campaign.id}:`, err)
    }
  }

  return updatedCampaigns
}

async function listStaffCampaignIds(staffId: number, context: string): Promise<number[]> {
  const { data, error } = await client()
    .from('auto_campaigns')
    .select('id')
    .eq('staff_id', staffId)
    .neq('action_id', SMS_SEND_ACTION_ID)

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
    .neq('action_id', SMS_SEND_ACTION_ID)
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
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
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
      failureCount: 0,
      errorCount: 0,
      successBreakdown: [],
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
    } else {
      summary.failureCount += 1
      if (detail.status === 'lỗi') summary.errorCount += 1
      incrementRelationBreakdown(summary.failureBreakdown, actionName, detail.status)
    }
  }

  for (const summary of summaryById.values()) {
    sortRelationBreakdown(summary.successBreakdown)
    sortRelationBreakdown(summary.failureBreakdown)
  }

  return ids
    .map(id => summaryById.get(id))
    .filter((summary): summary is CampaignRelationSummary => !!summary)
}

export async function createCampaignInputData(action: Partial<CampaignInputData>): Promise<CampaignInputData> {
  const u = requireCurrentUser()
  const campaignId = Number(action.campaignId)
  const actionId = Number.isFinite(campaignId) && campaignId > 0
    ? await getCampaignActionIdForCurrentUser(campaignId, u.staffId)
    : null
  if (actionId) await ensureCurrentUserCanUseCampaignAction(actionId)
  const isSmsInputData = isSmsCampaignAction(actionId)
  let inputAction = action
  if (isSmsInputData && Number.isFinite(campaignId) && campaignId > 0) {
    const campaign = await getCampaign(campaignId)
    if (campaign) {
      const rowIndex = await countActiveCampaignInputData(campaignId)
      const schedule = action.schedule || campaign.schedule || campaign.originalSchedule || null
      inputAction = {
        ...action,
        phone: normalizeVietnamMobilePhone(action.phone),
        schedule: schedule || undefined,
        content: renderSmsInputContent(campaign, { ...action, schedule: schedule || undefined }, rowIndex, schedule)
      }
    }
  }
  const payload = {
    campaign_id: inputAction.campaignId,
    input_id: inputAction.inputId ?? null,
    name: inputAction.name || null,
    phone: inputAction.phone || null,
    phone_carrier: isSmsInputData ? normalizeCampaignInputPhoneCarrier(inputAction.phone, inputAction.phoneCarrier) : null,
    uid: inputAction.uid || null,
    email: inputAction.email || null,
    info1: inputAction.info1 || null,
    info2: inputAction.info2 || null,
    info3: inputAction.info3 || null,
    info4: inputAction.info4 || null,
    info5: inputAction.info5 || null,
    content: inputAction.content || null,
    status: inputAction.status || 'chờ xử lý',
    note: inputAction.note || null,
    schedule: inputAction.schedule || null
  }

  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign input data: ${error.message}`)
  return mapCampaignInputDataFromDB(data)
}

export async function updateCampaignInputData(id: number, updates: Partial<CampaignInputData>): Promise<CampaignInputData> {
  const payload: any = {}
  const shouldUpdateCarrier = updates.phone !== undefined || updates.phoneCarrier !== undefined
  const actionId = shouldUpdateCarrier ? await getCampaignActionIdForInputData(id) : null
  const isSmsInputData = isSmsCampaignAction(actionId)
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
    .eq('is_delete', false)

  if (campaignError) throw new Error(`Failed to verify campaign ownership: ${campaignError.message}`)
  if ((count ?? 0) === 0) throw new Error('Không tìm thấy chiến dịch.')

  const fromStatus: InputDataBatchStatus = status === 'tạm dừng' ? 'chờ xử lý' : 'tạm dừng'
  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .update({ status })
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .eq('status', fromStatus)
    .in('id', inputDataIds)
    .select('id')

  if (error) throw new Error(`Failed to bulk update campaign input data status: ${error.message}`)

  const updatedCount = data?.length ?? 0
  return {
    updatedCount,
    skippedCount: Math.max(0, inputDataIds.length - updatedCount)
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

  const { data: sourceRows, error: sourceRowsError } = await client()
    .from('auto_campaign_input_data')
    .select('*')
    .eq('campaign_id', sourceCampaignId)
    .eq('is_delete', false)
    .in('id', sourceInputDataIds)
    .order('created_at', { ascending: true })

  if (sourceRowsError) throw new Error(`Failed to load selected campaign input data: ${sourceRowsError.message}`)

  const selectedRows = (sourceRows || []).map(row => mapCampaignInputDataFromDB(row))
  if (selectedRows.length === 0) throw new Error('Không tìm thấy data đã chọn.')

  const { data: targetRows, error: targetError } = await client()
    .from('auto_campaigns')
    .select('*, auto_campaign_actions(name), auto_accounts(name)')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .in('id', targetCampaignIds)

  if (targetError) throw new Error(`Failed to load target campaigns: ${targetError.message}`)

  const targetById = new Map((targetRows || []).map(row => {
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

    const isSmsTarget = isSmsCampaignAction(target.actionId)
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
        content: isSmsTarget ? renderSmsInputContent(target, row, smsRowIndexOffset + rowIndex, campaignSchedule) : (row.content || null),
        status: 'chờ xử lý',
        note: '',
        schedule: isSmsTarget ? campaignSchedule : null
      }
    })

    let insertedCount = 0
    for (const chunk of chunkArray(payload, CAMPAIGN_INPUT_DATA_INSERT_CHUNK_SIZE)) {
      const { data: insertedRows, error: insertError } = await client()
        .from('auto_campaign_input_data')
        .insert(chunk)
        .select('id')

      if (insertError) throw new Error(`Failed to add input data to campaign "${target.name}": ${insertError.message}`)
      insertedCount += insertedRows?.length ?? chunk.length
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
  const { error } = await client()
    .from('auto_campaign_input_data')
    .update({ is_delete: true })
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)

  if (error) throw new Error(`Failed to clear campaign input data: ${error.message}`)
}

export async function deleteCampaignInputData(id: number): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_input_data')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete campaign input data: ${error.message}`)
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
  return (data || []).map(row => mapCampaignDetailFromDB(row))
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
  return (data || []).map(row => mapCampaignDetailFromDB(row))
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

export async function getAccountRateLimitStatus(
  accountId: number,
  actionCode: string,
  actionName: string,
  limitConfig?: ActionLimitConfig
): Promise<AccountActionLimitStatus> {
  const normalizedActionCode = actionCode.trim()
  if (!normalizedActionCode) return { ok: true }

  const dailyLimit = limitConfig?.dailyLimit && limitConfig.dailyLimit > 0 ? limitConfig.dailyLimit : 30
  const rateLimitCount = limitConfig?.rateLimitCount && limitConfig.rateLimitCount > 0 ? limitConfig.rateLimitCount : 9
  const rateLimitMinutes = limitConfig?.rateLimitMinutes && limitConfig.rateLimitMinutes > 0 ? limitConfig.rateLimitMinutes : 65
  const actionStatus = await accountActionRepo.getAccountActionStatus(accountId, normalizedActionCode)

  const disabledStatus = buildAccountActionDisabledStatus(actionStatus, normalizedActionCode, actionName)
  if (disabledStatus) return disabledStatus

  const dailyActionCount = actionStatus.countActionInDay

  if (dailyActionCount >= dailyLimit) {
    // Daily limit → đợi tới 00:00 ngày mai mới reset
    const tomorrow = addVietnamDays(startOfVietnamDay(), 1)
    return {
      ok: false,
      actionCode: normalizedActionCode,
      actionName,
      errorCode: 'error_limit_in_day',
      isDailyLimit: true,
      retryAfterMs: tomorrow.getTime() - Date.now(),
      currentCount: dailyActionCount,
      limit: dailyLimit,
      dailyActionCount,
      dailyLimit,
      reason: `Đạt giới hạn ngày cho hành động "${actionName}" (${dailyActionCount}/${dailyLimit})`
    }
  }

  const timeFrameStart = new Date(new Date().getTime() - rateLimitMinutes * 60 * 1000)
  const timeFrameStartIso = timeFrameStart.toISOString()

  const windowActionCount = await countLimitDetailsInWindow(accountId, normalizedActionCode, timeFrameStartIso)

  if (windowActionCount >= rateLimitCount) {
    // Hourly limit → đợi tới khi row cũ nhất trong window > rateLimitMinutes phút
    const oldestCreatedAt = await getOldestLimitDetailCreatedAtInWindow(accountId, normalizedActionCode, timeFrameStartIso)
    let retryAfterMs = rateLimitMinutes * 60 * 1000
    if (oldestCreatedAt) {
      const oldestTime = new Date(oldestCreatedAt).getTime()
      retryAfterMs = Math.max(60 * 1000, (oldestTime + rateLimitMinutes * 60 * 1000) - Date.now())
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

function buildAccountActionDisabledStatus(
  actionStatus: AutoAccountActionStatus,
  actionCode: string,
  actionName: string
): AccountActionLimitStatus | null {
  if (!actionStatus.isDisable) return null

  const retryAfterMs = actionStatus.dateEnable
    ? Math.max(0, new Date(actionStatus.dateEnable).getTime() - Date.now())
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

  const actionStatus = await accountActionRepo.getAccountActionStatus(accountId, normalizedActionCode)
  return buildAccountActionDisabledStatus(actionStatus, normalizedActionCode, actionName) || {
    ok: true,
    actionCode: normalizedActionCode,
    actionName
  }
}
