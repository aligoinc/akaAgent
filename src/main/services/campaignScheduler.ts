import { BrowserWindow } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { tmpdir } from 'os'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { AccountActionLimitStatus, ActionLimitConfig, AkaBizIntegrationInfo, AutoAccount, AutoErrorPolicy, IPC_EVENTS, Campaign, CampaignAction, CampaignActionLimitSettings, CampaignAdvancedContentItem, CampaignDetail, CampaignDetailStatus, CampaignInputData, CampaignLogAction, CampaignLogEntry, CampaignMediaInput, CampaignRunEvent, CampaignRunEventInput, CampaignSummaryRefreshSignal, ContactType, DataGroupIngestRow, DataTypeCategoryCode } from '../../shared/types'
import { formatCampaignLogMessage } from '../../shared/campaignLogFormat'
import { normalizeVietnamMobilePhone as normalizeSharedVietnamMobilePhone } from '../../shared/phone'
import {
  getRuntimeMediaDownloadExtensionForMimeType,
  isImageMediaSource,
  isImageOrVideoMediaSource,
  isVideoMediaSource
} from '../../shared/mediaTypes'
import { renderContentSpin, splitContentVariants as splitSharedContentVariants } from '../../shared/contentSpin'
import {
  isFormattedContentEmpty,
  sanitizeFormattedContent,
  splitFormattedContentVariants,
  supportsFormattedContent,
  transformFormattedContentText
} from '../../shared/formattedContent'
import {
  findInvalidAdvancedContentItemIndex,
  getAdvancedContentItems,
  selectAdvancedContentItem
} from '../../shared/advancedContent'
import { MAX_SMS_ADVANCED_CONTENT_ITEMS } from '../../shared/smsContent'
import { isRecentDeliveryCooldownEnabled } from '../../shared/campaignDeliveryCooldown'
import { IPC_EVENTS_V2, RunStepV2 } from '../../shared/v2Types'
import { PageController, PageControllerRegistry } from '../v2/runtime/pageController'
import { BlockScreenshotCaptureRequest, WorkflowEngineV2 } from '../v2/runtime/workflowEngine'
import type { BlockRuntimeHelpers, BlockRuntimeMetadata, GroupPendingContentCheckOptions, GroupPendingContentCheckResult } from '../v2/runtime/blockHelpers'
import { BackgroundPageManager } from '../v2/runtime/backgroundPageManager'
import {
  addSmsCampaignDetail,
  addZaloCampaignDetails,
  getSmsCampaign,
  getZaloCampaign,
  type AkaBizCampaignSummary,
  updateZaloCampaignStatus
} from './akaBizApiClient'
import {
  addAkaBizDesktopCampaignDetails,
  getAkaBizDesktopCampaign,
  updateAkaBizDesktopCampaignStatus,
  type AkaBizDesktopCampaignSummary
} from './akaBizDesktopSqliteClient'
import { getAkaBizIntegrationsForStaff } from '../data/repositories/staffIntegrationRepository'
import { getCurrentUser } from '../data/currentUser'
import {
  ensureCurrentUserCanUseCampaignAction,
  getAccountActionDailySendLimit,
  loadCurrentUserEffectiveEntitlements
} from '../data/repositories/entitlementRepository'
import {
  getAccountActionName as resolveAccountActionName,
  getCampaignActionDescriptors as resolveCampaignActionDescriptors,
  getCampaignExecutableActionDescriptors as resolveCampaignExecutableActionDescriptors,
  getMessageActionCode as resolveMessageActionCode,
  getPostActionCode as resolvePostActionCode,
  isCommentSeedingCampaign as resolveIsCommentSeedingCampaign,
  isNewsfeedCommentConfigured as resolveIsNewsfeedCommentConfigured,
  isNewsfeedLikeConfigured as resolveIsNewsfeedLikeConfigured,
  type CampaignActionDescriptor
} from '../domain/campaigns/campaignActionDescriptors'
import { ProxyRuntimeService } from './proxyRuntimeService'
import { ZaloApiError } from 'zca-js'
import { ZaloRuntimeService, type ZaloForwardMessageResult, type ZaloForwardMessageTargetResult, type ZaloFoundUser, type ZaloFriendRecommendationProfile, type ZaloJoinGroupLinkResult, type ZaloMessageSendResult, type ZaloOutgoingText, type ZaloSentFriendRequestProfile } from './zaloRuntimeService'
import { convertHtmlToZaloMessage } from './zaloFormattedContent'
import { EmailRuntimeService, type EmailRecipientCheckResult } from './emailRuntimeService'
import * as campaignRunEventRepo from '../data/repositories/campaignRunEventRepository'
import type { ZaloGroupContactInput, ZaloUserContactInput } from '../data/repositories/accountContactRepository'
import { callAiUsing } from './aiRuntimeService'
import { captureBlockScreenshot, readBlockScreenshotDataUrl } from './blockScreenshotService'
import type { DailyMaintenanceBarrier } from './dailyMaintenanceCoordinator'
import type {
  ZaloActionDetailOutput,
  ZaloAddGroupMemberOptions,
  ZaloActionHelperResult,
  ZaloApplyContactTagOptions,
  ZaloCancelSentFriendRequestOptions,
  ZaloChangeContactAliasOptions,
  ZaloFindPhoneUserOptions,
  ZaloJoinGroupLinkOptions,
  ZaloResolvedTarget,
  ZaloResolveAddGroupMemberTargetOptions,
  ZaloResolveGroupMemberTargetOptions,
  ZaloSendDirectMessageOptions,
  ZaloSendPhoneFriendRequestOptions,
  ZaloSendPhoneMessageOptions,
  EmailSendMessageOptions,
  EmailActionHelperResult
} from '../v2/runtime/blockHelpers'

interface AutomationPageRef {
  page: PageController | null
  source: 'visible' | 'background'
}

interface BackgroundPreviewOverride {
  page: PageController
  title?: string
  context?: string
}

interface SchedulerStartOptions {
  initialDelayMs?: number
}

interface DeliveryCooldownBatchResult {
  allowedInputDataIds: Set<number>
  pausedInputDataIds: Set<number>
  deferredInputDataIds: Set<number>
  pausedNotesByInputDataId: Map<number, string>
}

export type CampaignSchedulerRuntimeTarget = 'desktop' | 'server'

export interface CampaignSchedulerLogEntry extends CampaignLogEntry {}

export type CampaignSchedulerLogSink = (entry: CampaignSchedulerLogEntry) => void | Promise<void>

export interface CampaignSchedulerOptions {
  runtimeTarget?: CampaignSchedulerRuntimeTarget
  runtimeModeRevision?: string | null | (() => string | null)
  maintenanceCoordinator?: DailyMaintenanceBarrier
  logSink?: CampaignSchedulerLogSink
  /** App Server lifecycle hook when a live DB claim rejects this runtime owner. */
  onRuntimeOwnershipLost?: () => void
}

interface RuntimeErrorResult {
  triggered: boolean
  message: string
  policy?: AutoErrorPolicy
}

interface CampaignBadTargetResult extends RuntimeErrorResult {
  count?: number
  threshold?: number | null
}

interface MilestoneSummary {
  hasSuccess: boolean
  hasFailure: boolean
  hasHardFailure: boolean
  hasError: boolean
  failureReasons: string[]
  errorReasons: string[]
  failureRootReasons: string[]
  errorRootReasons: string[]
  resetInputToPending?: boolean
  preventInputRetry?: boolean
  pendingNote?: string
  inputCompletionNote?: string
  stopAfterTarget?: boolean
}

interface BlockScreenshotRunResult {
  status: 'success' | 'failure' | 'error'
  statusLabel: string
  actionName: string
  targetName: string
  message: string
  displayMessage: string
  errorCode?: string
}

interface BlockScreenshotProgressLog {
  runStepId?: number | null
  nodeId?: string | null
  blockId?: number | null
  blockName?: string | null
  storedMessage: string
  realtimeMessage: string
  action: CampaignLogAction
}

interface CampaignRunBoundaryContext {
  runtimeClaimToken: string
  claimedVietnamDateKey: string
  cutoffAtMs: number
  cutoffLabel: string
  kind: 'configured_stop' | 'end_of_day_drain'
  boundaryLogged: boolean
  maintenanceReconciledDateKey: string | null
}

interface CampaignRunBoundaryCheck {
  reached: boolean
  context: CampaignRunBoundaryContext
  clock: {
    dbNow: string
    vietnamDateKey: string
  } | null
  clockUnavailable: boolean
}

interface CampaignRunUnitLease {
  runtimeUnitToken: string
  inputDataIds: number[]
  requeueRemainingOnSettle: boolean
}

class CampaignMediaResolveError extends Error {
  constructor(
    public readonly mediaName: string,
    public readonly reason: string
  ) {
    super(`Không dùng được media "${mediaName}": ${reason}`)
    this.name = 'CampaignMediaResolveError'
  }
}

class CampaignRunUnitOwnershipLostError extends Error {
  constructor(campaignId: number) {
    super(`Campaign ${campaignId} no longer owns its run-unit lease`)
    this.name = 'CampaignRunUnitOwnershipLostError'
  }
}

class ZaloPartialSendError extends Error {
  constructor(
    public readonly stage: 'content_after_media' | 'media_after_content',
    public readonly causeError: unknown,
    public readonly response: ZaloMessageDispatchResponse
  ) {
    super(stage === 'content_after_media'
      ? 'Đã gửi file nhưng gửi nội dung thất bại'
      : 'Đã gửi nội dung nhưng gửi file thất bại')
    this.name = 'ZaloPartialSendError'
  }
}

interface SuggestedFriendProfile {
  name: string
  uid: string
}

interface ZaloFriendMaterializedProfile {
  name: string
  uid: string
  phone?: string
  sdob?: string
  raw: Record<string, unknown>
}

interface NewsfeedActionAvailability {
  allowLike: boolean
  allowComment: boolean
  blockedReasons: string[]
  disabledStatus?: AccountActionLimitStatus
  blockedLimitStatuses: AccountActionLimitStatus[]
  allCheckedActionsBlocked: boolean
}

interface ActionLimitContinuationResult {
  limitStatus: AccountActionLimitStatus | null
  runnableActionDescriptors: CampaignActionDescriptor[]
  skippedActionDescriptors: CampaignActionDescriptor[]
  skippedLimitStatuses: AccountActionLimitStatus[]
}

interface ZaloShareMessageTarget {
  detail: CampaignInputData
  target: ZaloResolvedTarget
  threadId: string
  inputData: Record<string, unknown>
}

interface ZaloShareMessageCapacity {
  ok: boolean
  capacity: number
  limitStatus?: AccountActionLimitStatus
}

interface ZaloMessageDispatchResponse {
  sequence: 'combined' | 'content_only' | 'media_only' | 'media_then_content' | 'content_then_media'
  response?: ZaloMessageSendResult
  mediaResponse?: ZaloMessageSendResult
  contentResponse?: ZaloMessageSendResult
}

interface ZaloPartialSendMetadata {
  stage: 'content_after_media' | 'media_after_content'
  sequence: 'media_then_content' | 'content_then_media'
  mediaResponse?: unknown
  contentResponse?: unknown
  error: string
}

type ZaloRuntimeStopReason = 'handoff' | 'shutdown'
type ZaloServerPauseBoundary = 'campaign' | 'account'
type ZaloServerCampaignFinalization = Awaited<ReturnType<SupabaseService['finalizeZaloServerCampaign']>>

interface FacebookGroupInviteTarget {
  detail: CampaignInputData
  inputDataId: number
  name: string
  uid: string
  url: string
  inputData: Record<string, unknown>
}

interface FacebookGroupInviteCapacity {
  ok: boolean
  capacity: number
  limitStatus?: AccountActionLimitStatus
}

type FacebookGroupInviteDetailStatus =
  | 'thành công'
  | 'đã gửi lời mời'
  | 'đã là thành viên'
  | 'không tồn tại'
  | 'lỗi'

interface FacebookGroupInviteBlockResult {
  inputDataId?: number
  name?: string
  uid?: string
  url?: string
  status?: string
  message?: string
  selected?: boolean
  countsTowardLimit?: boolean
  error?: string
}

interface FacebookGroupInviteBlockOutput {
  ok?: boolean
  submitOk?: boolean
  selectedCount?: number
  processedCount?: number
  quotaReached?: boolean
  error?: string
  message?: string
  groupUrl?: string
  groupName?: string
  results?: FacebookGroupInviteBlockResult[]
}

interface FacebookGroupInviteBatchRunOutcome {
  stop: boolean
  paused?: boolean
}

interface ZaloFriendBlocklistContext {
  groupId: number
  groupName: string
  uidKeys: Set<string>
  invalidReason?: string
}

interface PostBumpTarget {
  campaignId: number
}

interface GroupPostShareTarget {
  id: number
  name: string
  uid?: string
}

interface FindDataSourceCounts {
  post: {
    phones: number
    linkGroupZalos: number
    uids: number
    postLinks: number
  }
  comment: {
    phones: number
    linkGroupZalos: number
    uids: number
  }
  groupMembers: {
    uids: number
  }
  newInteractors: {
    uids: number
  }
  facebookGroups: {
    groups: number
  }
}

interface FindDataUniqueCounts {
  phones: number
  linkGroupZalos: number
  uids: number
  postLinks: number
  groupMembers: number
  facebookGroups?: number
}

interface FindDataGroupMember {
  uid: string
  name: string
  url: string
}

interface FindDataUidProfile {
  uid: string
  name: string
  url: string
  source: string
}

interface FindDataPhoneProfile {
  phone: string
  name: string
  uid: string
  url: string
  source: string
}

interface FindDataFacebookGroup {
  url: string
  name: string
  privacy?: string
  memberCount?: number
  postsPerDay?: number
  keyword?: string
}

interface FindDataPreviousValues {
  phones: Set<string>
  linkGroupZalos: Set<string>
  uids: Set<string>
  postLinks: Set<string>
  facebookGroups: Set<string>
  detailCount: number
}

type FindDataGroupOutputKind =
  | 'phone'
  | 'zalo_group_link'
  | 'facebook_uid'
  | 'post_link'
  | 'facebook_group'

type FindDataTargetCampaignField =
  | 'findUidTargetCampaignIds'
  | 'findPostLinkTargetCampaignIds'
  | 'findPhoneZaloMessagePhoneTargetCampaignIds'
  | 'findZaloGroupLinkJoinTargetCampaignIds'
  | 'findFacebookGroupPostTargetCampaignIds'
  | 'findFacebookGroupCommentTargetCampaignIds'
  | 'findFacebookGroupJoinTargetCampaignIds'

const FIND_DATA_GROUP_ACTION_ID = 'facebook_find_data_group'
const FIND_DATA_SEARCH_ACTION_ID = 'facebook_find_data_search'
const GROUP_POST_ACTION_ID = 'facebook_group_post'
const LIMIT_IN_DAY_ERROR_CODE = 'error_limit_in_day'
const LIMIT_IN_HOUR_ERROR_CODE = 'error_limit_in_hour'
const GROUP_POST_FREQUENCY_LIMIT_ERROR_CODE = 'err_group_post_frequency_limit'
const COMMENT_FREQUENCY_LIMIT_ERROR_CODE = 'err_comment_frequency_limit'
const COMMENT_SEEDING_FEED_ACTION_ID = 'facebook_comment_seeding'
const COMMENT_SEEDING_POST_ACTION_ID = 'facebook_comment_seeding_post'
const MESSAGE_FRIEND_ACTION_ID = 'facebook_message_friend'
const MESSAGE_UID_ACTION_ID = 'facebook_message_uid'
const PAGE_INBOX_MESSAGE_ACTION_ID = 'facebook_page_to_message'
const PAGE_POST_ACTION_ID = 'facebook_page_post'
const NEWSFEED_INTERACTION_ACTION_ID = 'facebook_newsfeed_interaction'
const FACEBOOK_JOIN_GROUP_ACTION_ID = 'facebook_join_group'
const FACEBOOK_GROUP_INVITE_ACTION_ID = 'facebook_group_invite'
const FACEBOOK_GROUP_INVITE_ACTION_CODE = 'fb_group_invite'
// A Facebook invite dialog is one durable DB unit. Keep the candidate set at
// the same bound as the atomic unit-lease RPC so every row is reserved before
// the external submit and unused candidates can be safely requeued.
const FACEBOOK_GROUP_INVITE_BATCH_MAX_SIZE = 50
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const ZALO_MESSAGE_FRIEND_ACTION_ID = 'zalo_message_friend'
const ZALO_MESSAGE_BIRTHDAY_ACTION_ID = 'zalo_message_birthday'
const ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID = 'zalo_message_group_member'
const ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID = 'zalo_message_group_realtime'
const ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID = 'zalo_message_remarketing_customer'
const ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID = 'zalo_message_friend_recommendation'
const ZALO_MESSAGE_GROUP_ACTION_ID = 'zalo_message_group'
const ZALO_ADD_GROUP_MEMBER_ACTION_ID = 'zalo_add_group_member'
const ZALO_JOIN_GROUP_LINK_ACTION_ID = 'zalo_join_group_link'
const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID = 'zalo_cancel_sent_friend_request'
const SMS_SEND_ACTION_ID = 'sms_send'
const VOICE_CALL_ACTION_ID = 'voice_call'
const MOBILE_MANAGED_SMS_ACTION_IDS = new Set([SMS_SEND_ACTION_ID, VOICE_CALL_ACTION_ID])
const EXTERNAL_SMS_ZALO_ACTION_IDS = new Set([
  ZALO_MESSAGE_PHONE_ACTION_ID,
  ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID
])
const EXTERNAL_SMS_STATUS_VALUES = new Set(['thành công', 'thất bại', 'không tồn tại'])
const ZALO_MESSAGE_SEND_MODE_SHARE = 'share'
const ZALO_SHARE_MESSAGE_BATCH_SIZE = 50
const ZALO_MESSAGE_REWRITE_AI_CODE = 'fb_send_message_rewrite'
const MULTI_DAILY_TIME_SLOT_ACTION_IDS = new Set([
  'facebook_timeline_post',
  PAGE_POST_ACTION_ID,
  ZALO_MESSAGE_FRIEND_ACTION_ID,
  ZALO_MESSAGE_GROUP_ACTION_ID
])
const ZALO_FRIEND_TARGET_MODE_SELECTED = 'selected'
const ZALO_FRIEND_TARGET_MODE_ALL = 'all_friends'
const ZALO_FRIEND_TARGET_MODE_TAGGED = 'tagged_friends'
const ZALO_FRIEND_TARGET_MODES = new Set([
  ZALO_FRIEND_TARGET_MODE_SELECTED,
  ZALO_FRIEND_TARGET_MODE_ALL,
  ZALO_FRIEND_TARGET_MODE_TAGGED
])
const ZALO_FRIEND_PAGE_SIZE = 500
const EMAIL_SEND_ACTION_ID = 'email_send'
const EMAIL_RECIPIENT_NOT_FOUND_ERROR_CODE = 'err_email_recipient_not_found'
const ZALO_FIND_PHONE_ACTION_CODE = 'zalo_find_phone_user'
const ZALO_FIND_PHONE_DEFAULT_LIMIT = 1000
const ZALO_API_BUSINESS_FAILED_ERROR_CODE = 'err_zalo_api_business_failed'
const ZALO_USER_NOT_FOUND_ERROR_CODE = 'err_zalo_user_not_found'
const ZALO_RUNTIME_HANDOFF_UNCERTAIN_NOTE =
  'Dừng do thay đổi chế độ runtime, không xác định kết quả; không tự thực hiện lại'
const ZALO_RUNTIME_RESTART_NOTE =
  'Chế độ chạy Zalo đã thay đổi. Vui lòng tắt và mở lại ứng dụng.'
const ZALO_RUNTIME_SHUTDOWN_UNCERTAIN_NOTE =
  'Dừng do runtime Zalo đang tắt, không xác định kết quả; không tự thực hiện lại'
const ZALO_RUNTIME_SHUTDOWN_NOTE = 'Runtime Zalo đang dừng.'
const CAMPAIGN_ERROR_SCREENSHOT_DIAGNOSIS_AI_CODE = 'campaign_error_screenshot_diagnosis'
const DEFAULT_RATE_LIMIT_MINUTES = 65
const CAMPAIGN_PAUSE_PENDING_NOTE = 'Đang chờ tạm dừng'
const FIND_DATA_SOURCE_WAIT_NOTE = 'Đang chờ data từ chiến dịch tìm data'
const DATA_GROUP_WAITING_NOTES = new Set(['Chờ data phù hợp', 'Chờ data mới'])
const DATA_GROUP_HARD_END_NOTE = 'Chiến dịch đã hết thời hạn nhận và chạy data mới'
const SCHEDULER_CONNECTIVITY_RETRY_LOG = '⚠️ Không kết nối được Internet hoặc máy chủ dữ liệu. Scheduler sẽ tự thử lại sau 30 giây.'
const SCHEDULER_CONNECTIVITY_RECOVERED_LOG = '✅ Đã kết nối lại máy chủ dữ liệu. Scheduler tiếp tục kiểm tra chiến dịch.'
const SCHEDULER_CONNECTIVITY_ERROR_PATTERNS = [
  /fetch failed/,
  /failed to fetch/,
  /network is unreachable/,
  /net::err_(internet_disconnected|network_changed|network_access_denied|address_unreachable)/,
  /\b(enotfound|enetunreach|ehostunreach|econnreset|econnrefused|etimedout|eai_again)\b/,
  /getaddrinfo/,
  /\b(connect|request|operation) timed out\b/
]

type RawRunEventPayload = Record<string, unknown>

function eventValue(payload: RawRunEventPayload, camelKey: string, snakeKey?: string): unknown {
  if (payload[camelKey] !== undefined) return payload[camelKey]
  if (snakeKey && payload[snakeKey] !== undefined) return payload[snakeKey]
  return undefined
}

function eventString(payload: RawRunEventPayload, camelKey: string, snakeKey?: string): string | null {
  const value = eventValue(payload, camelKey, snakeKey)
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function eventNumber(payload: RawRunEventPayload, camelKey: string, snakeKey?: string): number | null {
  const value = eventValue(payload, camelKey, snakeKey)
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function eventBoolean(payload: RawRunEventPayload, camelKey: string, snakeKey?: string): boolean | null {
  const value = eventValue(payload, camelKey, snakeKey)
  if (value === undefined || value === null) return null
  return value === true || value === 'true' || value === 1 || value === '1'
}

function eventJsonObject(payload: RawRunEventPayload, camelKey: string, snakeKey?: string): Record<string, unknown> {
  const value = eventValue(payload, camelKey, snakeKey)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return String(error.message || error.name || '').trim()
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '').trim()
  }
  return String(error || '').trim()
}

function getSchedulerErrorSearchText(error: unknown): string {
  const parts = [getErrorMessage(error)]
  if (error && typeof error === 'object') {
    const { code, cause } = error as { code?: unknown; cause?: unknown }
    if (code) parts.push(String(code))
    if (cause) parts.push(getErrorMessage(cause))
  }
  return parts.join(' ').toLowerCase()
}

function isSchedulerConnectivityError(error: unknown): boolean {
  const searchText = getSchedulerErrorSearchText(error)
  return SCHEDULER_CONNECTIVITY_ERROR_PATTERNS.some(pattern => pattern.test(searchText))
}

/**
 * Campaign scheduler: every 30s, scan eligible accounts for due campaigns and
 * run their associated workflow v2 against the account browser session.
 *
 * Engine v2 is the only execution path. Each campaign action template
 * (`auto_campaign_actions.workflow_id`, or `test_workflow_id` when the
 * current staff enables workflow test mode) points to a workflow that already
 * encodes the full per-action logic (post / share / reels / message / friend
 * with internal ifElse on extraSettings flags). Scheduler only orchestrates
 * scheduling, rate limits, and per-milestone logging.
 */
export class CampaignScheduler {
  private supabase: SupabaseService
  private webviewRegistry: WebviewRegistry
  private pageRegistry: PageControllerRegistry | null = null
  private engineV2 = new WorkflowEngineV2()
  private mainWindow: BrowserWindow
  private intervalId: ReturnType<typeof setInterval> | null = null
  private startDelayTimeoutId: ReturnType<typeof setTimeout> | null = null
  private running = false
  private dispatching = false
  private wakeRequested = false
  private activeAccountRuns = new Set<number>()
  private activeZaloAccountRuns = new Set<number>()
  private externalAccountRuns = new Set<number>()
  private activeV2Aborts = new Map<number, AbortController>()
  private activeZaloCampaignRuns = new Set<number>()
  private claimedServerZaloCampaignIds = new Set<number>()
  private claimedServerZaloAccountIds = new Set<number>()
  private activeZaloRunGenerations = new Map<number, number>()
  private activeZaloRunStopReasons = new Map<number, ZaloRuntimeStopReason>()
  private pauseRequests = new Set<number>()
  private serverZaloPauseBoundaries = new Map<number, ZaloServerPauseBoundary>()
  private loggedNewsfeedMilestoneKeys = new Set<string>()
  private internalSmsPushedDetailKeys = new Set<string>()
  private externalSmsPushedDetailKeys = new Set<string>()
  private formattedZaloShareWarnings = new Set<number>()
  private backgroundPages = new BackgroundPageManager()
  private backgroundPreviewTimers = new Map<string, ReturnType<typeof setInterval>>()
  private backgroundPreviewCapturing = new Set<string>()
  private backgroundPreviewOverrides = new Map<string, BackgroundPreviewOverride>()
  private proxyRuntime?: ProxyRuntimeService
  private zaloRuntime?: ZaloRuntimeService
  private emailRuntime?: EmailRuntimeService
  private schedulerConnectivityIssueActive = false
  private zaloRuntimeBlockedForRestart = false
  private zaloRuntimeStopRequested = false
  private zaloRuntimeLifecycleGeneration = 0
  private zaloRuntimeClaimsAbandoned = false
  private runtimeTarget: CampaignSchedulerRuntimeTarget
  private runtimeModeRevision: string | null | (() => string | null)
  private maintenanceCoordinator?: DailyMaintenanceBarrier
  private logSink?: CampaignSchedulerLogSink
  private onRuntimeOwnershipLost?: () => void
  private runtimeOwnershipLossReported = false
  private campaignRunBoundaries = new Map<number, CampaignRunBoundaryContext>()
  private activeCampaignRunUnits = new Map<number, CampaignRunUnitLease>()
  private boundaryStoppedAccountQueues = new Set<number>()

  constructor(
    supabase: SupabaseService,
    webviewRegistry: WebviewRegistry,
    mainWindow: BrowserWindow,
    proxyRuntime?: ProxyRuntimeService,
    zaloRuntime?: ZaloRuntimeService,
    emailRuntime?: EmailRuntimeService,
    options: CampaignSchedulerOptions = {}
  ) {
    this.supabase = supabase
    this.webviewRegistry = webviewRegistry
    this.mainWindow = mainWindow
    this.proxyRuntime = proxyRuntime
    this.zaloRuntime = zaloRuntime
    this.emailRuntime = emailRuntime
    this.runtimeTarget = options.runtimeTarget || 'desktop'
    this.runtimeModeRevision = options.runtimeModeRevision || null
    this.maintenanceCoordinator = options.maintenanceCoordinator
    this.logSink = options.logSink
    this.onRuntimeOwnershipLost = options.onRuntimeOwnershipLost
  }

  setPageRegistry(reg: PageControllerRegistry): void {
    this.pageRegistry = reg
  }

  private isCommentSeedingCampaign(actionId: string): boolean {
    return resolveIsCommentSeedingCampaign(actionId)
  }

  private isCommentSeedingPostCampaign(actionId: string): boolean {
    return actionId === COMMENT_SEEDING_POST_ACTION_ID
  }

  private isNewsfeedLikeConfigured(extra: Campaign['extraSettings']): boolean {
    return resolveIsNewsfeedLikeConfigured(extra)
  }

  private isNewsfeedCommentConfigured(extra: Campaign['extraSettings']): boolean {
    return resolveIsNewsfeedCommentConfigured(extra)
  }

  private getFindDataTargetCampaignField(campaign: Campaign): FindDataTargetCampaignField | null {
    if (campaign.actionId === MESSAGE_UID_ACTION_ID) return 'findUidTargetCampaignIds'
    if (campaign.actionId === COMMENT_SEEDING_POST_ACTION_ID) return 'findPostLinkTargetCampaignIds'
    if (campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID) return 'findPhoneZaloMessagePhoneTargetCampaignIds'
    if (campaign.actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID) return 'findZaloGroupLinkJoinTargetCampaignIds'
    if (campaign.actionId === GROUP_POST_ACTION_ID) return 'findFacebookGroupPostTargetCampaignIds'
    if (campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID) return 'findFacebookGroupCommentTargetCampaignIds'
    if (campaign.actionId === FACEBOOK_JOIN_GROUP_ACTION_ID) return 'findFacebookGroupJoinTargetCampaignIds'
    return null
  }

  private isMatchingFindDataSource(sourceCampaign: Campaign, targetField: FindDataTargetCampaignField): boolean {
    if (sourceCampaign.isDelete) return false
    const isFindDataGroup = sourceCampaign.actionId === FIND_DATA_GROUP_ACTION_ID
    const isFindDataSearch = sourceCampaign.actionId === FIND_DATA_SEARCH_ACTION_ID
    if (!isFindDataGroup && !isFindDataSearch) return false

    if (targetField === 'findUidTargetCampaignIds') return sourceCampaign.extraSettings?.isFindUid === true
    if (targetField === 'findPostLinkTargetCampaignIds') return sourceCampaign.extraSettings?.isFindPostLink === true
    if (targetField === 'findPhoneZaloMessagePhoneTargetCampaignIds') return sourceCampaign.extraSettings?.isFindPhone === true
    if (targetField === 'findZaloGroupLinkJoinTargetCampaignIds') return sourceCampaign.extraSettings?.isFindLinkGroupZalo === true
    if (!isFindDataSearch) return false
    return sourceCampaign.extraSettings?.isFindFacebookGroup === true
  }

  start(options: SchedulerStartOptions = {}): void {
    if (this.running) return
    this.running = true
    this.schedulerConnectivityIssueActive = false
    const initialDelayMs = Math.max(0, options.initialDelayMs ?? 0)
    if (initialDelayMs > 0) {
      const seconds = Math.ceil(initialDelayMs / 1000)
      if (this.runtimeTarget !== 'server') {
        this.sendLog(`📋 Scheduler sẽ bắt đầu sau ${seconds} giây. Kiểm tra mỗi 30 giây.`)
      }
      this.startDelayTimeoutId = setTimeout(() => {
        this.startDelayTimeoutId = null
        this.startPolling()
      }, initialDelayMs)
      return
    }

    this.startPolling()
  }

  stop(): void {
    this.requestZaloRuntimeStop('shutdown')
    this.running = false
    this.wakeRequested = false
    this.maintenanceCoordinator?.cancelPending()
    this.schedulerConnectivityIssueActive = false
    if (this.startDelayTimeoutId) {
      clearTimeout(this.startDelayTimeoutId)
      this.startDelayTimeoutId = null
    }
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    for (const abort of this.activeV2Aborts.values()) {
      try {
        abort.abort()
      } catch {}
    }
    this.stopAllBackgroundPreviews()
    this.backgroundPages.destroyAll()
    if (this.runtimeTarget !== 'server') {
      this.sendLog('⏹ Scheduler đã dừng.')
    }
  }

  /**
   * Stop polling without aborting an already claimed Zalo unit. Server
   * entitlement loss is observed by the DB run-control guard, which lets the
   * current target settle and prevents the next target from starting.
   */
  stopAcceptingNewZaloWork(): void {
    this.running = false
    this.wakeRequested = false
    this.maintenanceCoordinator?.cancelPending()
    this.schedulerConnectivityIssueActive = false
    if (this.startDelayTimeoutId) {
      clearTimeout(this.startDelayTimeoutId)
      this.startDelayTimeoutId = null
    }
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private startPolling(): void {
    if (!this.running || this.intervalId) return
    this.intervalId = setInterval(() => this.wakeNow('interval'), 30000)
    if (this.runtimeTarget !== 'server') {
      this.sendLog('📋 Scheduler đã bắt đầu. Kiểm tra mỗi 30 giây.')
    }
    this.wakeNow('start')
  }

  /**
   * Coalesces external wakeups (resume/midnight/realtime) with the polling
   * loop. If a tick is already dispatching, exactly one follow-up pass is kept
   * pending instead of opening another discovery/maintenance pass in parallel.
   */
  wakeNow(_reason?: string): void {
    if (!this.running) return
    this.wakeRequested = true
    void this.tick()
  }

  destroyBackgroundPage(accountId: number): void {
    this.backgroundPages.destroy(accountId)
  }

  isRunning(): boolean {
    return this.running
  }

  blockZaloRuntimeForRestart(
    message: string | null = '⏹ Zalo đã dừng nhận tác vụ vì chế độ runtime thay đổi. Vui lòng khởi động lại ứng dụng.'
  ): void {
    if (this.zaloRuntimeBlockedForRestart) return
    this.zaloRuntimeBlockedForRestart = true
    this.requestZaloRuntimeStop('handoff')
    if (message) this.sendLog(message)
  }

  resetZaloRuntimeRestartBlock(): void {
    this.zaloRuntimeBlockedForRestart = false
    this.zaloRuntimeStopRequested = false
  }

  private requestZaloRuntimeStop(reason: ZaloRuntimeStopReason): void {
    this.zaloRuntimeStopRequested = true
    this.zaloRuntimeLifecycleGeneration += 1
    for (const campaignId of this.activeZaloCampaignRuns) {
      const currentReason = this.activeZaloRunStopReasons.get(campaignId)
      if (!currentReason || reason === 'handoff') {
        this.activeZaloRunStopReasons.set(campaignId, reason)
      }
      const abort = this.activeV2Aborts.get(campaignId)
      if (abort && !abort.signal.aborted) abort.abort()
    }
  }

  private getZaloRuntimeStopReason(campaignId: number): ZaloRuntimeStopReason | null {
    const explicitReason = this.activeZaloRunStopReasons.get(campaignId)
    if (explicitReason) return explicitReason

    const runGeneration = this.activeZaloRunGenerations.get(campaignId)
    if (runGeneration === undefined) return null
    if (
      runGeneration !== this.zaloRuntimeLifecycleGeneration
    ) {
      return this.zaloRuntimeBlockedForRestart ? 'handoff' : 'shutdown'
    }

    if (!this.zaloRuntimeStopRequested) return null
    return this.zaloRuntimeBlockedForRestart ? 'handoff' : 'shutdown'
  }

  private getZaloRuntimeUncertainNote(reason: ZaloRuntimeStopReason): string {
    return reason === 'handoff'
      ? ZALO_RUNTIME_HANDOFF_UNCERTAIN_NOTE
      : ZALO_RUNTIME_SHUTDOWN_UNCERTAIN_NOTE
  }

  private getZaloRuntimeCampaignStopNote(reason: ZaloRuntimeStopReason): string {
    return reason === 'handoff' ? ZALO_RUNTIME_RESTART_NOTE : ZALO_RUNTIME_SHUTDOWN_NOTE
  }

  private throwIfZaloRuntimeStopping(campaignId: number): void {
    const reason = this.getZaloRuntimeStopReason(campaignId)
    if (reason) throw new Error(this.getZaloRuntimeUncertainNote(reason))
  }

  private isZaloRuntimeWriteBarrierActive(campaignId: number): boolean {
    return this.zaloRuntimeClaimsAbandoned && this.activeZaloRunGenerations.has(campaignId)
  }

  private async runZaloCampaignHelper<T>(campaignId: number, operation: () => Promise<T>): Promise<T> {
    this.throwIfZaloRuntimeStopping(campaignId)
    try {
      const result = await operation()
      this.throwIfZaloRuntimeStopping(campaignId)
      return result
    } catch (err) {
      // Prefer the lifecycle stop over an API/account/pause error that raced it.
      // This lets the scheduler apply the no-retry uncertainty rule uniformly.
      this.throwIfZaloRuntimeStopping(campaignId)
      throw err
    }
  }

  abandonZaloRuntimeClaims(): void {
    this.zaloRuntimeClaimsAbandoned = true
  }

  resetZaloRuntimeClaims(): void {
    this.zaloRuntimeClaimsAbandoned = false
  }

  async waitForZaloIdle(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while (this.activeZaloAccountRuns.size > 0 || this.externalAccountRuns.size > 0) {
      if (Date.now() >= deadline) return false
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return true
  }

  tryReserveExternalAccount(accountId: number): boolean {
    if (this.activeAccountRuns.has(accountId) || this.externalAccountRuns.has(accountId)) return false
    this.externalAccountRuns.add(accountId)
    return true
  }

  releaseExternalAccount(accountId: number): void {
    this.externalAccountRuns.delete(accountId)
  }

  async waitForIdle(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while (this.dispatching || this.activeAccountRuns.size > 0) {
      if (Date.now() >= deadline) return false
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return true
  }

  async requestPauseCampaign(campaignId: number): Promise<Campaign> {
    if (this.runtimeTarget === 'server') {
      const result = await this.supabase.setZaloServerCampaignStatus(campaignId, 'tạm dừng')
      if (!result.ok) {
        if (result.reason === 'not_found') throw new Error('Không tìm thấy chiến dịch Zalo Server.')
        if (result.reason === 'runtime_not_owner') throw new Error('Organization không còn chạy Zalo Server.')
        throw new Error('Chỉ có thể tạm dừng chiến dịch đang chờ xử lý hoặc đang chạy.')
      }
      const campaign = await this.supabase.getCampaign(campaignId)
      if (!campaign) throw new Error('Không tìm thấy chiến dịch Zalo Server sau khi tạm dừng.')
      this.broadcastCampaignUpdate(campaign)
      return campaign
    }

    const campaign = await this.supabase.getCampaign(campaignId)
    if (!campaign) {
      throw new Error('Không tìm thấy chiến dịch.')
    }

    if (campaign.status === 'chờ xử lý') {
      const transition = await this.supabase.setDesktopCampaignStatusV2(
        campaign.id,
        campaign.accountId,
        'tạm dừng'
      )
      if (transition.ok || transition.reason === 'already_target') {
        this.pauseRequests.delete(campaignId)
        const updated = await this.supabase.getCampaign(campaignId)
        if (!updated) throw new Error('Không tìm thấy chiến dịch sau khi tạm dừng.')
        this.broadcastCampaignUpdate(updated)
        return updated
      }

      // The scheduler may have claimed the campaign after the initial read.
      // Convert that CAS conflict into the normal soft-pause latch; never
      // overwrite the fresh runtime token with a stale pending->paused write.
      if (transition.reason === 'runtime_busy' || transition.reason === 'unit_lease_busy') {
        const latest = await this.supabase.getCampaign(campaignId)
        if (latest?.status === 'đang chạy') {
          this.pauseRequests.add(campaignId)
          return await this.updateCampaignAndBroadcast(campaignId, { note: CAMPAIGN_PAUSE_PENDING_NOTE })
        }
        if (latest?.status === 'tạm dừng') return latest
      }
      throw new Error('Trạng thái chiến dịch đã thay đổi. Vui lòng thử lại.')
    }

    if (campaign.status === 'đang chạy') {
      this.pauseRequests.add(campaignId)
      const updated = await this.updateCampaignAndBroadcast(campaignId, { note: CAMPAIGN_PAUSE_PENDING_NOTE })
      if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
        const abort = this.activeV2Aborts.get(campaignId)
        if (abort && !abort.signal.aborted) abort.abort()
      }
      return updated
    }

    throw new Error('Chỉ có thể tạm dừng chiến dịch khi trạng thái là "chờ xử lý" hoặc "đang chạy".')
  }

  async requestResumeCampaign(campaignId: number): Promise<Campaign> {
    if (this.runtimeTarget === 'server') {
      throw new Error('Zalo Server phải dùng DB-first run control để tiếp tục chiến dịch.')
    }
    const campaign = await this.supabase.getCampaign(campaignId)
    if (!campaign) throw new Error('Không tìm thấy chiến dịch.')

    const transition = await this.supabase.setDesktopCampaignStatusV2(
      campaign.id,
      campaign.accountId,
      'chờ xử lý'
    )
    if (!transition.ok) {
      if (transition.reason === 'unit_lease_busy') {
        throw new Error('Lượt hiện tại chưa ghi xong; vui lòng chờ chiến dịch tạm dừng hoàn tất rồi tiếp tục.')
      }
      if (transition.reason === 'runtime_busy') {
        throw new Error('Chiến dịch đang được runtime khác xử lý. Vui lòng thử lại sau.')
      }
      if (transition.reason === 'not_found') throw new Error('Không tìm thấy chiến dịch.')
      throw new Error('Trạng thái chiến dịch đã thay đổi. Vui lòng tải lại trước khi tiếp tục.')
    }

    this.pauseRequests.delete(campaignId)
    const updated = await this.supabase.getCampaign(campaignId)
    if (!updated) throw new Error('Không tìm thấy chiến dịch sau khi tiếp tục.')
    this.broadcastCampaignUpdate(updated)
    this.wakeNow('campaign-resumed')
    return updated
  }

  private isCampaignPauseRequested(campaignId: number): boolean {
    return this.pauseRequests.has(campaignId)
  }

  private async completeCampaignPause(campaign: Campaign): Promise<void> {
    await this.updateCampaignAndBroadcast(campaign.id, { status: 'tạm dừng', note: null })
    this.pauseRequests.delete(campaign.id)
    await this.logCampaignProgress(campaign.id, `⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`)
  }

  private async sleepBetweenTargets(
    campaign: Campaign,
    seconds: number,
    account?: AutoAccount
  ): Promise<'paused' | 'boundary' | 'stopped' | 'completed'> {
    const endAt = Date.now() + seconds * 1000
    let nextServerControlCheckAt = 0
    while (Date.now() < endAt) {
      if (!this.running) return 'stopped'
      if (this.isCampaignPauseRequested(campaign.id)) return 'paused'
      const boundaryCheck = await this.checkCampaignRunBoundary(campaign.id)
      if (boundaryCheck?.reached) {
        if (!account || await this.yieldCampaignAtRunBoundary(account, campaign, boundaryCheck)) {
          return 'boundary'
        }
      }
      if (account && this.isServerZaloCampaign(account, campaign) && Date.now() >= nextServerControlCheckAt) {
        nextServerControlCheckAt = Date.now() + 5000
        const control = await this.supabase.getZaloServerRunControlState(campaign.id, account.id)
        if (this.isServerZaloBoundaryRequested(
          control.campaignStatus,
          control.accountStatus,
          control.hardStopReason
        )) {
          this.latchServerZaloPause(campaign.id, control.campaignStatus, control.accountStatus)
          return 'paused'
        }
        if (control.hardStopReason) return 'completed'
      }
      if (this.getZaloRuntimeStopReason(campaign.id)) return 'completed'
      await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, endAt - Date.now()))))
    }
    if (!this.running) return 'stopped'
    if (this.isCampaignPauseRequested(campaign.id)) return 'paused'
    const boundaryCheck = await this.checkCampaignRunBoundary(campaign.id)
    if (boundaryCheck?.reached) {
      if (!account || await this.yieldCampaignAtRunBoundary(account, campaign, boundaryCheck)) {
        return 'boundary'
      }
    }
    if (account && this.isServerZaloCampaign(account, campaign)) {
      const control = await this.supabase.getZaloServerRunControlState(campaign.id, account.id)
      if (this.isServerZaloBoundaryRequested(
        control.campaignStatus,
        control.accountStatus,
        control.hardStopReason
      )) {
        this.latchServerZaloPause(campaign.id, control.campaignStatus, control.accountStatus)
        return 'paused'
      }
    }
    return 'completed'
  }

  private getReadyRuntimeClock() {
    return this.maintenanceCoordinator
      ? this.maintenanceCoordinator.ensureReady()
      : this.supabase.getRuntimeClock()
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    if (this.dispatching) {
      this.wakeRequested = true
      return
    }
    this.dispatching = true
    this.wakeRequested = false

    try {
      await this.getReadyRuntimeClock()
      if (!this.running) return

      // Hard end belongs to the DB subscription lifecycle, so sweep it before
      // looking at eligible/logged-in accounts. This also covers paused campaigns
      // and accounts that are hidden, deleted or temporarily unlicensed.
      await this.sweepExpiredDataGroupCampaigns()
      if (!this.running) return

      await this.supabase.enableDueAccountActions().catch(err => {
        console.error('Failed to enable due account actions:', err)
      })
      if (!this.running) return

      // 1. Get eligible accounts
      const accounts = await this.supabase.getEligibleAccounts()

      for (const account of accounts) {
        if (!this.running) break

        // This call normally only advances the cached monotonic anchor. It
        // refreshes DB time/maintenance if a long tick crosses cache expiry or
        // Vietnam midnight before reaching this account.
        const accountClock = await this.getReadyRuntimeClock()
        if (!this.running) break

        // The server owns only eligible QR Zalo accounts. Hard-ended campaigns
        // outside that runtime are already covered by the tenant-scoped sweep
        // above, so never route an ineligible account through the narrow server
        // per-campaign finalizer.
        if (!this.shouldProcessAccountForRuntime(account)) continue

        if (this.isSmsAccount(account)) {
          await this.refreshDueMobileManagedCampaignLimitNotes(account, accountClock.dbNow)
          continue
        }

        // Finalize an expired Data Group subscription before runtime eligibility
        // checks. Hard end is a database lifecycle boundary and must not depend on
        // the account being logged in or having a mounted browser tab.
        const pendingCampaigns = await this.supabase.getPendingCampaigns(account.id, accountClock.dbNow)
        const campaigns: Campaign[] = []
        for (const campaign of pendingCampaigns) {
          if (await this.finalizeDataGroupCampaignAtHardEnd(
            campaign,
            new Date(accountClock.dbNow)
          )) continue
          if (this.isRealtimeCampaignDisabledForRuntime(account, campaign)) continue
          campaigns.push(campaign)
        }
        if (!this.running) break

        if (this.activeAccountRuns.has(account.id) || this.externalAccountRuns.has(account.id)) {
          continue
        }

        if (account.status !== 'chờ xử lý' || account.loginStatus !== 'đã đăng nhập') {
          continue
        }

        if (campaigns.length === 0) continue

        // Browserless campaigns such as Zalo API flows do not mount a webview tab.
        const hasBrowserCampaigns = campaigns.some(campaign => !this.isBrowserlessCampaign(campaign))
          || (account.flatformType === 'zalo' && account.isZaloShowWeb === true)
        if (hasBrowserCampaigns && !this.webviewRegistry.isRegistered(account.id)) {
          this.sendLog(`⚠️ Tài khoản "${account.name}" chưa mở tab trình duyệt. Bỏ qua.`)
          continue
        }

        if (this.externalAccountRuns.has(account.id)) continue
        this.startAccountCampaignQueue(account, campaigns)
      }

      if (this.schedulerConnectivityIssueActive) {
        this.schedulerConnectivityIssueActive = false
        this.sendLog(SCHEDULER_CONNECTIVITY_RECOVERED_LOG)
      }
    } catch (err) {
      if (!this.running && err instanceof Error && err.name === 'AbortError') return
      console.error('Scheduler tick error:', err)
      if (isSchedulerConnectivityError(err)) {
        if (!this.schedulerConnectivityIssueActive) {
          this.schedulerConnectivityIssueActive = true
          this.sendLog(SCHEDULER_CONNECTIVITY_RETRY_LOG)
        }
        return
      }
      this.sendLog(`❌ Lỗi scheduler: ${getErrorMessage(err) || 'Lỗi không xác định'}`)
    } finally {
      this.dispatching = false
      if (this.running && this.wakeRequested) {
        this.wakeRequested = false
        queueMicrotask(() => {
          if (this.running) void this.tick()
        })
      }
    }
  }

  private startAccountCampaignQueue(account: AutoAccount, campaigns: Campaign[]): void {
    if (this.activeAccountRuns.has(account.id)) return
    this.activeAccountRuns.add(account.id)
    const isZaloAccount = String(account.flatformType || '').trim().toLowerCase() === 'zalo'
    if (isZaloAccount) this.activeZaloAccountRuns.add(account.id)

    void this.runAccountCampaignQueue(account, campaigns)
      .catch(err => {
        console.error(`Scheduler account queue error for account ${account.id}:`, err)
        this.sendLog(`❌ Lỗi hàng đợi tài khoản "${account.name}": ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        this.activeAccountRuns.delete(account.id)
        this.boundaryStoppedAccountQueues.delete(account.id)
        if (isZaloAccount) this.activeZaloAccountRuns.delete(account.id)
      })
  }

  private async runAccountCampaignQueue(account: AutoAccount, campaigns: Campaign[]): Promise<void> {
    for (const campaign of campaigns) {
      if (!this.running) break
      const runtimeClock = await this.getReadyRuntimeClock()
      if (!this.running) break
      if (!this.shouldProcessAccountForRuntime(account)) break
      const currentCampaign = await this.supabase.getCampaign(campaign.id)
      if (!this.running) break
      const businessNow = new Date(runtimeClock.dbNow)
      if (!Number.isFinite(businessNow.getTime())) throw new Error('DB runtime clock is invalid')
      if (
        !currentCampaign ||
        this.isRealtimeCampaignDisabledForRuntime(account, currentCampaign) ||
        currentCampaign.status !== 'chờ xử lý' ||
        currentCampaign.isDelete ||
        !currentCampaign.schedule ||
        new Date(currentCampaign.schedule).getTime() > businessNow.getTime() ||
        this.isAtOrAfterCampaignDispatchCutoff(businessNow, currentCampaign.dailyStopTime)
      ) {
        continue
      }
      if (!this.running) break
      await this.executeCampaign(account, currentCampaign)
      if (this.boundaryStoppedAccountQueues.delete(account.id)) break
    }
  }

  private shouldProcessAccountForRuntime(account: AutoAccount): boolean {
    const isZaloAccount = String(account.flatformType || '').trim().toLowerCase() === 'zalo'
    if (isZaloAccount && this.zaloRuntimeStopRequested) return false
    if (this.runtimeTarget === 'server') {
      return isZaloAccount && account.isZaloServer === true && !account.isZaloShowWeb
    }
    return !isZaloAccount || account.isZaloServer !== true
  }

  private isRealtimeCampaignDisabledForRuntime(account: AutoAccount, campaign: Campaign): boolean {
    return this.runtimeTarget === 'desktop'
      && account.flatformType === 'zalo'
      && account.isZaloShowWeb === true
      && campaign.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID
  }

  private isSmsAccount(account: AutoAccount): boolean {
    return String(account.flatformType || '').trim().toLowerCase() === 'sms'
  }

  private async refreshDueMobileManagedCampaignLimitNotes(account: AutoAccount, dbNow: string): Promise<void> {
    const campaigns = await this.supabase.getDueMobileManagedCampaignsForLimitCheck(account.id, dbNow)
    for (const campaign of campaigns) {
      try {
        await this.refreshMobileManagedCampaignLimitNote(account, campaign)
      } catch (err) {
        console.error(`Failed to refresh mobile-managed campaign limit note for campaign ${campaign.id}:`, err)
      }
    }
  }

  private async refreshMobileManagedCampaignLimitNote(account: AutoAccount, campaign: Campaign): Promise<void> {
    if (!MOBILE_MANAGED_SMS_ACTION_IDS.has(campaign.actionId)) return

    try {
      await ensureCurrentUserCanUseCampaignAction(campaign.actionId)
    } catch (err) {
      await this.updateCampaignPreflightNote(campaign, err instanceof Error ? err.message : String(err))
      return
    }

    const action = await this.supabase.getCampaignAction(campaign.actionId)
    if (!action) {
      await this.updateCampaignPreflightNote(campaign, 'Không tìm thấy loại chiến dịch')
      return
    }

    const executableActionDescriptors = this.getCampaignExecutableActionDescriptors(campaign, action)
    const quotaActionDescriptors = this.getCampaignActionDescriptors(campaign, action)

    const disabledStatus = await this.checkActionDisabled(account, executableActionDescriptors)
    if (disabledStatus && !disabledStatus.ok) {
      await this.updateCampaignPreflightNote(campaign, await this.buildLimitPreflightNote(disabledStatus))
      return
    }

    const limitStatus = await this.checkActionLimits(
      account,
      campaign,
      quotaActionDescriptors,
      campaign.extraSettings?.actionLimits
    )
    if (limitStatus && !limitStatus.ok) {
      await this.updateCampaignPreflightNote(campaign, await this.buildLimitPreflightNote(limitStatus))
      return
    }

    if (this.isLimitNoteText(campaign.note)) {
      await this.updateCampaignAndBroadcast(campaign.id, { note: null })
    }
  }

  private isLimitNoteText(note: string | null | undefined): boolean {
    const text = String(note || '').trim().toLowerCase()
    if (!text) return false
    return text.includes('giới hạn') || text.includes('tạm nghỉ')
  }

  /**
   * Handle post-campaign completion. Recurring schedule maintenance runs after
   * login / day change; completion itself should not move weekly/monthly dates.
   */
  private async transitionCampaignToCompleted(
    campaign: Campaign,
    note?: string | null
  ): Promise<boolean> {
    if (campaign.dataTargetSourceMode === 'data_group') {
      const finalized = await this.supabase.finalizeDataGroupCampaign(
        campaign.id,
        note,
        this.dataGroupRuntimeContext()
      )
      const updated = await this.supabase.getCampaign(campaign.id)
      if (!updated) throw new Error('Không tìm thấy chiến dịch Nhóm data sau khi finalize atomic.')
      this.broadcastCampaignUpdate(updated)
      return finalized.completed && updated.status === 'hoàn thành'
    }

    if (this.claimedServerZaloCampaignIds.has(campaign.id)) {
      const { finalized, campaign: updated } = await this.finalizeClaimedServerZaloCampaign(
        campaign.id,
        note
      )
      this.broadcastCampaignUpdate(updated)
      if (updated.status === 'hoàn thành') return true
      await this.finishServerZaloFinalizationBoundary(campaign, finalized)
      return false
    }

    const finalized = await this.supabase.finalizeCampaign(campaign.id, note)
    const updated = await this.supabase.getCampaign(campaign.id)
    if (!updated) throw new Error('Không tìm thấy chiến dịch sau khi finalize pending-input guard.')
    this.broadcastCampaignUpdate(updated)
    if (finalized.reason === 'pending_input_remaining') {
      await this.logCampaignProgress(
        campaign.id,
        `⏳ Phát hiện ${finalized.pendingInputCount} data mới đang chờ xử lý; chiến dịch chưa hoàn thành.`
      )
    }
    return finalized.completed && updated.status === 'hoàn thành'
  }

  private async getDatabaseBusinessNow(): Promise<Date> {
    const clock = await this.supabase.getRuntimeClock()
    const now = new Date(clock.dbNow)
    if (!Number.isFinite(now.getTime())) throw new Error('DB runtime clock is invalid')
    return now
  }

  private requiresDataGroupHardEndCheck(campaign: Campaign): boolean {
    return campaign.dataTargetSourceMode === 'data_group' && Boolean(campaign.scheduleEndDate)
  }

  private isDataGroupCampaignHardEnded(campaign: Campaign, now: Date): boolean {
    if (campaign.dataTargetSourceMode !== 'data_group' || !campaign.scheduleEndDate) return false
    const hardEndAt = new Date(campaign.scheduleEndDate).getTime()
    return !Number.isNaN(hardEndAt) && now.getTime() >= hardEndAt
  }

  private async sweepExpiredDataGroupCampaigns(): Promise<void> {
    const batchSize = 200
    // A bounded loop drains ordinary backlogs in one tick without letting a very
    // large tenant monopolize the scheduler forever.
    for (let batch = 0; batch < 5; batch += 1) {
      const finalized = await this.supabase.finalizeExpiredDataGroupCampaigns(
        batchSize,
        this.dataGroupRuntimeContext()
      )
      for (const item of finalized) {
        const campaign = await this.supabase.getCampaign(item.campaignId)
        if (campaign) this.broadcastCampaignUpdate(campaign)
        if (item.result.completed === true) {
          await this.logCampaignProgress(item.campaignId, `⏹ ${DATA_GROUP_HARD_END_NOTE}`)
        }
      }
      if (finalized.length < batchSize) break
    }
  }

  private dataGroupRuntimeContext(): {
    runtimeTarget: CampaignSchedulerRuntimeTarget
    runtimeModeRevision: string | null
  } {
    const runtimeModeRevision = typeof this.runtimeModeRevision === 'function'
      ? this.runtimeModeRevision()
      : this.runtimeModeRevision
    return {
      runtimeTarget: this.runtimeTarget,
      runtimeModeRevision: String(runtimeModeRevision || '').trim() || null
    }
  }

  /**
   * Close and settle an expired Data Group campaign through its atomic DB
   * finalizer. Returning true means callers must not start another target,
   * even when the finalizer observed an already-running target and therefore
   * could not complete the campaign in this pass.
   */
  private async finalizeDataGroupCampaignAtHardEnd(
    campaign: Campaign,
    businessNow?: Date
  ): Promise<boolean> {
    if (!this.requiresDataGroupHardEndCheck(campaign)) return false
    const now = businessNow || await this.getDatabaseBusinessNow()
    if (!this.isDataGroupCampaignHardEnded(campaign, now)) return false
    const completed = await this.transitionCampaignToCompleted(campaign, DATA_GROUP_HARD_END_NOTE)
    if (completed) {
      await this.logCampaignProgress(campaign.id, `⏹ ${DATA_GROUP_HARD_END_NOTE}`)
    }
    return true
  }

  private async handleCampaignCompletion(campaign: Campaign): Promise<void> {
    // A live data-group source is an intake subscription, not a finite snapshot.
    // The DB finalizer atomically rechecks raced input, source stop/delete and hard end.
    if (campaign.dataTargetSourceMode === 'data_group') {
      const completed = await this.transitionCampaignToCompleted(campaign)
      if (completed) {
        await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"`)
      } else {
        await this.logCampaignProgress(campaign.id, `⏳ Chiến dịch "${campaign.name}" đang chờ data mới từ Nhóm data`)
      }
      return
    }

    // Check end date
    const now = await this.getDatabaseBusinessNow()
    if (await this.handleZaloRealtimeGroupCompletion(campaign, now)) {
      return
    }

    if (campaign.scheduleEndDate) {
      const endDate = new Date(campaign.scheduleEndDate)
      if (now >= endDate) {
        const completed = await this.transitionCampaignToCompleted(campaign)
        if (completed) {
          await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (hết ngày kết thúc)`)
        }
        return
      }
    }

    if (await this.handleMultiDailyTimeSlotAfterCompletion(campaign, now)) {
      return
    }

    if (await this.handleRerunAfterCompletion(campaign, now)) {
      return
    }

    const completed = await this.transitionCampaignToCompleted(campaign)
    if (completed) {
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"`)
    }
  }

  private async handleZaloRealtimeGroupCompletion(campaign: Campaign, now: Date): Promise<boolean> {
    if (!this.isZaloRealtimeGroupCampaign(campaign)) return false

    const details = await this.supabase.listCampaignInputData(campaign.id)
    let earliestFutureInputSchedule: Date | null = null
    let hasPendingDueInput = false

    for (const detail of details) {
      if (detail.status !== 'chờ xử lý') continue
      const futureSchedule = this.getFutureInputSchedule(detail, now)
      if (futureSchedule) {
        if (!earliestFutureInputSchedule || futureSchedule.getTime() < earliestFutureInputSchedule.getTime()) {
          earliestFutureInputSchedule = futureSchedule
        }
      } else {
        hasPendingDueInput = true
      }
    }

    if (hasPendingDueInput) {
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: 'chờ xử lý',
        schedule: now.toISOString(),
        note: null
      })
      return true
    }

    if (earliestFutureInputSchedule) {
      await this.deferCampaignUntilFutureInput(campaign, earliestFutureInputSchedule)
      return true
    }

    if (this.isZaloRealtimeReceivingWindowActive(campaign, now)) {
      const nextSchedule = this.getZaloRealtimeWaitSchedule(campaign, now)
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: 'chờ xử lý',
        schedule: nextSchedule.toISOString(),
        note: null
      })
      await this.logCampaignProgress(campaign.id, `⏳ Chiến dịch "${campaign.name}" tiếp tục chờ data theo thời gian thực từ group Zalo`)
      return true
    }

    const completed = await this.transitionCampaignToCompleted(
      campaign,
      'Chiến dịch đã hết ngày nhận data theo thời gian thực và không còn data chờ chạy'
    )
    if (completed) {
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (hết ngày nhận data theo thời gian thực)`)
    }
    return true
  }

  private async handleMultiDailyTimeSlotAfterCompletion(campaign: Campaign, now: Date): Promise<boolean> {
    if (
      !MULTI_DAILY_TIME_SLOT_ACTION_IDS.has(campaign.actionId) ||
      campaign.extraSettings?.multiDailyTimeSlotsEnabled !== true
    ) {
      return false
    }

    const slots = this.normalizeMultiDailyTimeSlots(campaign.extraSettings.multiDailyTimeSlots)
    if (slots.length < 2) return false

    const currentSchedule = campaign.schedule ? new Date(campaign.schedule) : null
    if (!currentSchedule || Number.isNaN(currentSchedule.getTime()) || !this.isSameVietnamDay(currentSchedule, now)) {
      return false
    }

    const currentParts = this.getVietnamDateTimeParts(currentSchedule)
    const currentSlotMinute = currentParts.hour * 60 + currentParts.minute
    let nextSlot = ''
    let nextSchedule: Date | null = null

    for (const slot of slots) {
      const slotMinute = this.getTimeSlotMinute(slot)
      if (slotMinute <= currentSlotMinute) continue

      const candidate = this.withVietnamTimeSlot(currentSchedule, slot)
      if (!candidate || candidate.getTime() <= now.getTime()) continue

      nextSlot = slot
      nextSchedule = candidate
      break
    }

    if (!nextSchedule) {
      const completed = await this.transitionCampaignToCompleted(campaign)
      if (completed) {
        await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không còn khung giờ chạy trong hôm nay)`)
      }
      return true
    }

    if (this.isAtOrAfterCampaignDispatchCutoff(nextSchedule, campaign.dailyStopTime)) {
      const completed = await this.transitionCampaignToCompleted(campaign)
      if (completed) {
        await this.logCampaignProgress(
          campaign.id,
          `✅ Hoàn thành chiến dịch "${campaign.name}" (khung giờ ${nextSlot} vượt quá giờ dừng trong ngày)`
        )
      }
      return true
    }

    const details = await this.supabase.listCampaignInputData(campaign.id)
    const resettableCount = details.filter(detail => !detail.isDelete && detail.status !== 'tạm dừng').length
    if (details.length > 0 && resettableCount === 0) {
      const completed = await this.transitionCampaignToCompleted(campaign)
      if (completed) {
        await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không có data cần chạy lại ở khung giờ tiếp theo)`)
      }
      return true
    }
    if (campaign.actionId === PAGE_POST_ACTION_ID && details.length === 0) {
      const completed = await this.transitionCampaignToCompleted(campaign)
      if (completed) {
        await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không có page cần chạy lại ở khung giờ tiếp theo)`)
      }
      return true
    }
    if (
      (campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID || campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID) &&
      details.length === 0
    ) {
      const completed = await this.transitionCampaignToCompleted(campaign)
      if (completed) {
        await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không có data cần chạy lại ở khung giờ tiếp theo)`)
      }
      return true
    }

    const isClaimedServerZalo = this.runtimeTarget === 'server' &&
      this.claimedServerZaloCampaignIds.has(campaign.id) &&
      this.claimedServerZaloAccountIds.has(campaign.accountId) &&
      String(campaign.actionId || '').trim().toLowerCase().startsWith('zalo_')

    if (isClaimedServerZalo) {
      const advanced = await this.supabase.advanceZaloServerMultiDailySlot(
        campaign.id,
        campaign.accountId,
        nextSchedule.toISOString()
      )
      if (!advanced.ok) {
        const account = await this.supabase.getAccount(campaign.accountId)
        if (!account) {
          throw new Error(`Không tìm thấy tài khoản khi chuyển khung giờ Zalo Server (${advanced.reason}).`)
        }

        if (advanced.reason === 'runtime_control_paused') {
          this.latchServerZaloPause(campaign.id, advanced.campaignStatus, advanced.accountStatus)
          await this.completePauseAtBoundary(account, campaign)
          return true
        }

        const control = await this.getServerZaloBoundaryReason(account, campaign)
        if (control.paused) {
          await this.completePauseAtBoundary(account, campaign)
          return true
        }
        if (control.hardStopReason) {
          await this.stopCampaignForAccountCondition(account, campaign, control.hardStopReason)
          await this.releaseRunningAccount(account.id)
          return true
        }
        throw new Error(`Không thể chuyển khung giờ Zalo Server (${advanced.reason}).`)
      }

      const updated = await this.supabase.getCampaign(campaign.id)
      if (updated) this.broadcastCampaignUpdate(updated)
    } else {
      if (resettableCount > 0) {
        await this.supabase.resetCampaignInputDataForRerun(campaign.id)
      }
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: 'chờ xử lý',
        schedule: nextSchedule.toISOString(),
        note: null
      })
    }
    await this.logCampaignProgress(
      campaign.id,
      `⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch "${campaign.name}" ở khung giờ ${nextSlot} (${this.formatVietnamDateTime(nextSchedule)})`
    )
    return true
  }

  private async handleRerunAfterCompletion(campaign: Campaign, now: Date): Promise<boolean> {
    const supportsRerunAfterCompletion =
      campaign.actionId === FIND_DATA_GROUP_ACTION_ID ||
      campaign.actionId === FIND_DATA_SEARCH_ACTION_ID ||
      campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID ||
      campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID
    if (
      !supportsRerunAfterCompletion ||
      campaign.extraSettings?.findDataRerunEnabled !== true
    ) {
      return false
    }

    const hours = this.normalizeFindDataRerunAfterHours(campaign.extraSettings.findDataRerunAfterHours)
    if (hours <= 0) return false

    const nextSchedule = new Date(now.getTime() + hours * 60 * 60 * 1000)

    // The rerun window belongs to the immutable Vietnam day assigned by the
    // top-level runtime claim. A unit may legally start before midnight and
    // finish after it; comparing only with the completion-time `now` would
    // incorrectly reopen a weekly/monthly campaign on the new day before
    // schedule maintenance can advance its recurrence. Keep the old `now`
    // comparison for the legacy/no-context path and for an interval which
    // itself crosses midnight.
    const claimedVietnamDateKey = this.campaignRunBoundaries.get(campaign.id)?.claimedVietnamDateKey
    const leavesClaimedVietnamDay = Boolean(
      claimedVietnamDateKey &&
      this.getVietnamDateKey(nextSchedule) !== claimedVietnamDateKey
    )
    if (leavesClaimedVietnamDay || !this.isSameVietnamDay(nextSchedule, now)) {
      const completed = await this.transitionCampaignToCompleted(campaign)
      if (completed) {
        await this.logCampaignProgress(
          campaign.id,
          `✅ Hoàn thành chiến dịch "${campaign.name}" (không hẹn chạy lại theo giờ qua ngày mới)`
        )
      }
      return true
    }

    if (this.isAtOrAfterCampaignDispatchCutoff(nextSchedule, campaign.dailyStopTime)) {
      const completed = await this.transitionCampaignToCompleted(campaign)
      if (completed) {
        await this.logCampaignProgress(
          campaign.id,
          `✅ Hoàn thành chiến dịch "${campaign.name}" (lượt chạy lại sau ${hours} giờ vượt quá giờ dừng trong ngày)`
        )
      }
      return true
    }

    if (campaign.actionId !== NEWSFEED_INTERACTION_ACTION_ID) {
      const details = await this.supabase.listCampaignInputData(campaign.id)
      const resettableCount = details.filter(detail => !detail.isDelete && detail.status !== 'tạm dừng').length
      if (resettableCount === 0) {
        const completed = await this.transitionCampaignToCompleted(campaign)
        if (completed) {
          await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không có data cần chạy lại)`)
        }
        return true
      }

      await this.supabase.resetCampaignInputDataForRerun(campaign.id)
    }
    await this.updateCampaignAndBroadcast(campaign.id, {
      status: 'chờ xử lý',
      schedule: nextSchedule.toISOString(),
      note: null
    })
    await this.logCampaignProgress(
      campaign.id,
      `⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch "${campaign.name}" lúc ${this.formatVietnamDateTime(nextSchedule)}`
    )
    return true
  }

  private isNewsfeedDailyCampaign(campaign: Campaign): boolean {
    return campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID && (campaign.scheduleType || 'daily') === 'daily'
  }

  private async completeNewsfeedDailyWithoutNextDay(campaign: Campaign, reason?: string): Promise<void> {
    const note = reason?.trim() || null
    const completed = await this.transitionCampaignToCompleted(campaign, note)
    const suffix = note ? ` (${note})` : ''
    if (completed) {
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"${suffix}`)
    }
  }

  private async completeZaloBirthdayWithoutTargets(campaign: Campaign): Promise<void> {
    const message = 'Không có bạn bè sinh nhật hôm nay'
    const completed = await this.transitionCampaignToCompleted(campaign, message)
    await this.logCampaignProgress(campaign.id, `🎂 ${message}`)
    if (completed) {
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"`)
    }
  }

  private async completeZaloFriendRecommendationWithoutTargets(campaign: Campaign, message: string): Promise<void> {
    const note = message || 'Không lấy được đề xuất Zalo để chạy'
    const completed = await this.transitionCampaignToCompleted(campaign, note)
    await this.logCampaignProgress(campaign.id, `⚠️ ${note}`)
    if (completed) {
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"`)
    }
  }

  private getFutureInputSchedule(detail: CampaignInputData, now: Date): Date | null {
    if (!detail.schedule) return null
    const scheduledAt = new Date(detail.schedule)
    if (Number.isNaN(scheduledAt.getTime())) return null
    return scheduledAt.getTime() > now.getTime() ? scheduledAt : null
  }

  private formatVietnamDateTime(date: Date): string {
    return date.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  private normalizeFindDataRerunAfterHours(value: unknown): number {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 0
  }

  private parseMultiDailyTimeSlot(value: string): string | null {
    const raw = value.trim().toLowerCase().replace(/\s+/g, '')
    if (!raw) return null

    const match = raw.match(/^(\d{1,2})(?::(\d{1,2})|h(\d{1,2})?|h)?$/)
    if (!match) return null

    const hour = Number(match[1])
    const minute = Number(match[2] ?? match[3] ?? 0)
    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  private normalizeMultiDailyTimeSlots(value: unknown): string[] {
    const slotMinutes = new Map<number, string>()
    String(value || '')
      .split(/[,\r\n]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => {
        const slot = this.parseMultiDailyTimeSlot(item)
        if (!slot) return
        slotMinutes.set(this.getTimeSlotMinute(slot), slot)
      })

    return Array.from(slotMinutes.entries())
      .sort(([left], [right]) => left - right)
      .map(([, slot]) => slot)
  }

  private getTimeSlotMinute(slot: string): number {
    const [hour, minute] = slot.split(':').map(Number)
    return hour * 60 + minute
  }

  private withVietnamTimeSlot(day: Date, slot: string): Date | null {
    const [hour, minute] = slot.split(':').map(Number)
    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null
    }

    const parts = this.getVietnamDateTimeParts(day)
    const pad = (value: number) => String(value).padStart(2, '0')
    return new Date(`${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(hour)}:${pad(minute)}:00+07:00`)
  }

  private getVietnamDateTimeParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      })
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

  private getVietnamDateKey(date: Date): string {
    const parts = this.getVietnamDateTimeParts(date)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
  }

  private getVietnamBirthdayKey(date: Date): string {
    const parts = this.getVietnamDateTimeParts(date)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${pad(parts.day)}/${pad(parts.month)}`
  }

  private isSameVietnamDay(left: Date, right: Date): boolean {
    const leftParts = this.getVietnamDateTimeParts(left)
    const rightParts = this.getVietnamDateTimeParts(right)
    return (
      leftParts.year === rightParts.year &&
      leftParts.month === rightParts.month &&
      leftParts.day === rightParts.day
    )
  }

  private isAfterDailyStopTime(date: Date, dailyStopTime?: string | null): boolean {
    const stop = this.parseDailyStopTime(dailyStopTime)
    if (!stop) return false

    const parts = this.getVietnamDateTimeParts(date)
    if (parts.hour !== stop.hour) return parts.hour > stop.hour
    if (parts.minute !== stop.minute) return parts.minute > stop.minute
    return parts.second >= stop.second
  }

  private parseDailyStopTime(
    dailyStopTime?: string | null
  ): { hour: number; minute: number; second: number } | null {
    const match = String(dailyStopTime || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
    if (!match) return null

    const hour = Number(match[1])
    const minute = Number(match[2])
    const second = Number(match[3] || 0)
    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      !Number.isInteger(second) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      return null
    }
    return { hour, minute, second }
  }

  /**
   * Dispatch stops at the configured daily cutoff. Campaigns without one use
   * 23:59 Vietnam time as a mandatory drain window before date maintenance.
   */
  private isAtOrAfterCampaignDispatchCutoff(date: Date, dailyStopTime?: string | null): boolean {
    const configuredStop = this.parseDailyStopTime(dailyStopTime)
    if (configuredStop) {
      const configuredSeconds = configuredStop.hour * 3600 + configuredStop.minute * 60 + configuredStop.second
      if (configuredSeconds > 23 * 3600 + 59 * 60) {
        const parts = this.getVietnamDateTimeParts(date)
        return parts.hour === 23 && parts.minute >= 59
      }
      return this.isAfterDailyStopTime(date, dailyStopTime)
    }
    const parts = this.getVietnamDateTimeParts(date)
    return parts.hour === 23 && parts.minute >= 59
  }

  private createCampaignRunBoundary(
    campaign: Campaign,
    runtimeClaimToken: string,
    claimedVietnamDateKey: string
  ): CampaignRunBoundaryContext {
    const configuredStop = this.parseDailyStopTime(campaign.dailyStopTime)
    const configuredStopSeconds = configuredStop
      ? configuredStop.hour * 3600 + configuredStop.minute * 60 + configuredStop.second
      : Number.POSITIVE_INFINITY
    const stop = configuredStop && configuredStopSeconds <= 23 * 3600 + 59 * 60
      ? configuredStop
      : { hour: 23, minute: 59, second: 0 }
    const pad = (value: number) => String(value).padStart(2, '0')
    const cutoffAt = new Date(
      `${claimedVietnamDateKey}T${pad(stop.hour)}:${pad(stop.minute)}:${pad(stop.second)}+07:00`
    )
    if (!Number.isFinite(cutoffAt.getTime())) {
      throw new Error('Không thể xác định mốc dừng chạy theo ngày Việt Nam')
    }

    return {
      runtimeClaimToken,
      claimedVietnamDateKey,
      cutoffAtMs: cutoffAt.getTime(),
      cutoffLabel: `${pad(stop.hour)}:${pad(stop.minute)}${stop.second > 0 ? `:${pad(stop.second)}` : ''}`,
      kind: configuredStop ? 'configured_stop' : 'end_of_day_drain',
      boundaryLogged: false,
      maintenanceReconciledDateKey: null
    }
  }

  private checkCampaignRunBoundaryWithClock(
    context: CampaignRunBoundaryContext,
    clock: NonNullable<CampaignRunBoundaryCheck['clock']>
  ): CampaignRunBoundaryCheck {
    const dbNowMs = new Date(clock.dbNow).getTime()
    if (!Number.isFinite(dbNowMs)) throw new Error('DB runtime clock is invalid')
    return {
      reached:
        clock.vietnamDateKey !== context.claimedVietnamDateKey ||
        dbNowMs >= context.cutoffAtMs,
      context,
      clock,
      clockUnavailable: false
    }
  }

  private async checkCampaignRunBoundary(campaignId: number): Promise<CampaignRunBoundaryCheck | null> {
    const context = this.campaignRunBoundaries.get(campaignId)
    if (!context) return null
    try {
      const clock = await this.supabase.getRuntimeClock()
      return this.checkCampaignRunBoundaryWithClock(context, clock)
    } catch (error) {
      // A run must not start a new external side effect when the authoritative
      // clock cannot be verified. The already-running unit is never aborted;
      // callers only reach this check at a safe unit boundary.
      console.error(`Failed to verify run boundary for campaign ${campaignId}:`, error)
      return {
        reached: true,
        context,
        clock: null,
        clockUnavailable: true
      }
    }
  }

  private async stopCampaignAtRunBoundaryIfNeeded(
    account: AutoAccount,
    campaign: Campaign,
    knownCheck?: CampaignRunBoundaryCheck | null
  ): Promise<boolean> {
    const check = knownCheck || await this.checkCampaignRunBoundary(campaign.id)
    if (!check?.reached) return false
    return await this.yieldCampaignAtRunBoundary(account, campaign, check)
  }

  /**
   * Advisory DB guard used before expensive batch preparation. Every external
   * workflow still calls beginCampaignRunUnit at its true start point; that RPC
   * is the final token-bound linearization point.
   */
  private async stopCampaignBeforeNewUnitIfNeeded(
    account: AutoAccount,
    campaign: Campaign
  ): Promise<boolean> {
    const context = this.campaignRunBoundaries.get(campaign.id)
    if (!context) return false

    try {
      const result = await this.supabase.checkCampaignDailyBoundary(
        campaign.id,
        account.id,
        this.runtimeTarget,
        context.claimedVietnamDateKey
      )
      if (result.allowNewUnit) return false
      const isDailyBoundaryDue =
        result.reason === 'daily_stop_due' ||
        result.reason === 'daily_drain_due' ||
        result.reason === 'vietnam_day_changed' ||
        result.reason === 'runtime_control_paused'
      if (!isDailyBoundaryDue) {
        this.boundaryStoppedAccountQueues.add(account.id)
        if (
          result.reason === 'account_logged_out' ||
          result.reason === 'account_inactive' ||
          result.reason === 'account_deleted'
        ) {
          const reason = result.reason === 'account_logged_out'
            ? 'Tài khoản bị đăng xuất'
            : result.reason === 'account_inactive'
              ? 'Tài khoản đã ngừng hoạt động'
              : 'Tài khoản đã bị xoá'
          await this.stopCampaignForAccountCondition(account, campaign, reason)
          await this.releaseRunningAccount(account.id)
        } else if (result.reason === 'campaign_deleted' || result.reason === 'not_found') {
          await this.releaseRunningAccount(account.id)
        } else if (result.reason === 'runtime_not_owner' && account.flatformType === 'zalo') {
          if (this.runtimeTarget === 'server') {
            this.stopAcceptingNewZaloWork()
            if (!this.runtimeOwnershipLossReported) {
              this.runtimeOwnershipLossReported = true
              this.onRuntimeOwnershipLost?.()
            }
          } else {
            this.blockZaloRuntimeForRestart()
          }
        } else {
          this.sendLog(`⚠️ Chiến dịch "${campaign.name}" đã dừng trước lượt mới (${result.reason}).`)
        }
        return true
      }
      return await this.yieldCampaignAtRunBoundary(account, campaign, {
        reached: true,
        context,
        clock: {
          dbNow: result.dbNow,
          vietnamDateKey: result.vietnamDateKey
        },
        clockUnavailable: false
      })
    } catch (error) {
      console.error(`Failed DB daily-boundary guard for campaign ${campaign.id}:`, error)
      return await this.yieldCampaignAtRunBoundary(account, campaign, {
        reached: true,
        context,
        clock: null,
        clockUnavailable: true
      })
    }
  }

  /**
   * Single soft-yield path for every executor. Status changes happen only
   * after the current target/batch has settled. Migration v231 owns the
   * atomic campaign/account transition, while pause requests are checked both
   * before and after that RPC so a user pause remains the final visible state.
   */
  private async yieldCampaignAtRunBoundary(
    account: AutoAccount,
    campaign: Campaign,
    check: CampaignRunBoundaryCheck
  ): Promise<boolean> {
    if (
      this.isCampaignPauseRequested(campaign.id) ||
      this.serverZaloPauseBoundaries.has(campaign.id)
    ) {
      this.boundaryStoppedAccountQueues.add(account.id)
      await this.completePauseAtBoundary(account, campaign)
      await this.reconcileMaintenanceAfterSettledRun(account, campaign, check.clock)
      return true
    }

    // The boundary is observed only between external units. Settle the last
    // durable unit lease first; the yield RPC deliberately refuses to move the
    // campaign/account while such a lease is still active.
    if (!await this.settleActiveCampaignRunUnit(account, campaign)) return true

    let result: Awaited<ReturnType<SupabaseService['yieldCampaignDailyBoundary']>>
    let yieldRetryLogged = false
    let unsettledUnitRetryLogged = false
    while (true) {
      try {
        result = await this.supabase.yieldCampaignDailyBoundary(
          campaign.id,
          account.id,
          this.runtimeTarget,
          check.context.runtimeClaimToken,
          check.context.claimedVietnamDateKey
        )
        if (result.reason !== 'unit_still_running') break
        this.boundaryStoppedAccountQueues.add(account.id)
        if (!unsettledUnitRetryLogged) {
          unsettledUnitRetryLogged = true
          this.sendLog(`⚠️ Chiến dịch "${campaign.name}" đang chờ lượt hiện tại ghi xong trước khi dừng.`)
        }
        if (!this.running) return true
        await new Promise(resolve => setTimeout(resolve, 2000))
      } catch (error) {
        // Migration v231 is mandatory for the new scheduler. Never replace
        // this CAS with a host-clock or non-atomic status fallback. Keep the
        // account run reserved and retry after connectivity returns so neither
        // a later target nor midnight maintenance can overtake this yield.
        this.boundaryStoppedAccountQueues.add(account.id)
        console.error(`Failed atomic daily-boundary yield for campaign ${campaign.id}:`, error)
        if (!yieldRetryLogged) {
          yieldRetryLogged = true
          this.sendLog('⚠️ Chưa thể dừng chiến dịch tại mốc ngày vì DB chưa phản hồi; đang chờ để thử lại và không mở lượt mới.')
        }
        if (!this.running) return true
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }

    const resultClock: NonNullable<CampaignRunBoundaryCheck['clock']> = {
      dbNow: result.dbNow,
      vietnamDateKey: result.vietnamDateKey
    }
    check = { ...check, clock: resultClock, clockUnavailable: false }

    if (result.reason === 'boundary_not_due') return false

    this.boundaryStoppedAccountQueues.add(account.id)

    // A pause/control write which won the row lock is authoritative. The RPC
    // intentionally did not update campaign/account in this branch.
    if (result.reason === 'runtime_control_paused') {
      if (this.isCampaignPauseRequested(campaign.id)) {
        await this.completePauseAtBoundary(account, campaign)
        await this.reconcileMaintenanceAfterSettledRun(account, campaign, resultClock)
        return true
      }
      const currentCampaign = await this.supabase.getCampaign(campaign.id).catch(() => null)
      if (currentCampaign) this.broadcastCampaignUpdate(currentCampaign)
      if (result.campaignStatus === 'đang chạy' && result.accountStatus !== 'đang chạy') {
        if (this.isServerZaloCampaign(account, campaign)) {
          await this.completePauseAtBoundary(account, campaign)
        } else {
          await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: null })
        }
      }
      await this.releaseRunningAccount(account.id)
      if (currentCampaign?.status === 'tạm dừng') this.pauseRequests.delete(campaign.id)
      await this.reconcileMaintenanceAfterSettledRun(account, campaign, resultClock)
      return true
    }

    if (this.isCampaignPauseRequested(campaign.id)) {
      // Desktop pause may have been requested while the atomic RPC was in
      // flight. Complete it after a successful boundary yield so pause remains
      // the final visible state.
      await this.completePauseAtBoundary(account, campaign)
      await this.reconcileMaintenanceAfterSettledRun(account, campaign, resultClock)
      return true
    }

    const yieldedToPending = result.ok
    if (result.ok) {
      const updatedCampaign = await this.supabase.getCampaign(campaign.id).catch(() => null)
      if (updatedCampaign) this.broadcastCampaignUpdate(updatedCampaign)
      try { this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch {}
    } else {
      const currentCampaign = await this.supabase.getCampaign(campaign.id).catch(() => null)
      if (currentCampaign) this.broadcastCampaignUpdate(currentCampaign)

      if (
        result.reason === 'account_logged_out' ||
        result.reason === 'account_inactive' ||
        result.reason === 'account_deleted'
      ) {
        const reason = result.reason === 'account_logged_out'
          ? 'Tài khoản bị đăng xuất'
          : result.reason === 'account_inactive'
            ? 'Tài khoản đã ngừng hoạt động'
            : 'Tài khoản đã bị xoá'
        await this.stopCampaignForAccountCondition(account, campaign, reason)
        await this.releaseRunningAccount(account.id)
      } else if (result.reason === 'campaign_deleted' || result.reason === 'not_found') {
        await this.releaseRunningAccount(account.id)
      } else if (result.reason === 'runtime_not_owner') {
        if (account.flatformType === 'zalo') {
          if (this.runtimeTarget === 'server') {
            this.stopAcceptingNewZaloWork()
            if (!this.runtimeOwnershipLossReported) {
              this.runtimeOwnershipLossReported = true
              try {
                this.onRuntimeOwnershipLost?.()
              } catch (error) {
                console.error('Failed to notify Zalo Server ownership loss:', error)
              }
            }
          } else {
            this.blockZaloRuntimeForRestart()
          }
        }
      } else {
        // Unknown/invalid ownership results remain untouched for normal stale
        // run recovery. Never guess a replacement status outside the CAS RPC.
        this.sendLog(`⚠️ Chiến dịch "${campaign.name}" đã dừng trước lượt mới (${result.reason}).`)
      }
    }

    if (yieldedToPending && !check.context.boundaryLogged) {
      check.context.boundaryLogged = true
      const message = check.clockUnavailable
        ? '⏹ Không xác minh được giờ DB; đã dừng an toàn trước lượt tiếp theo.'
        : check.context.kind === 'configured_stop'
          ? `⏹ Đã đến giờ dừng ${check.context.cutoffLabel}; đã hoàn tất lượt hiện tại và không mở lượt mới.`
          : '⏹ Đã đến mốc dừng cuối ngày 23:59; đã hoàn tất lượt hiện tại và không mở lượt mới.'
      await this.logCampaignProgress(campaign.id, message).catch(() => {})
    }

    await this.reconcileMaintenanceAfterSettledRun(account, campaign, resultClock)
    return true
  }

  /**
   * Maintenance is released only after the old-day unit lease has settled.
   * A pass that began at 00:00 remains inside the DB gate while a 23:58 unit
   * finishes at 00:02, then observes the campaign's final visible state.
   */
  private async reconcileMaintenanceAfterSettledRun(
    account: AutoAccount,
    campaign: Campaign,
    knownClock?: CampaignRunBoundaryCheck['clock']
  ): Promise<void> {
    const context = this.campaignRunBoundaries.get(campaign.id)
    if (!context) return

    let clock = knownClock || null
    if (!clock) {
      try {
        clock = await this.supabase.getRuntimeClock()
      } catch (error) {
        console.error(`Failed to reconcile maintenance clock for campaign ${campaign.id}:`, error)
        return
      }
    }
    if (
      clock.vietnamDateKey === context.claimedVietnamDateKey ||
      context.maintenanceReconciledDateKey === clock.vietnamDateKey
    ) {
      return
    }

    let currentCampaign: Campaign | null
    let currentAccount: AutoAccount | null
    try {
      ;[currentCampaign, currentAccount] = await Promise.all([
        this.supabase.getCampaign(campaign.id),
        this.supabase.getAccount(account.id)
      ])
    } catch (error) {
      console.error(`Failed to verify settled state before daily maintenance for campaign ${campaign.id}:`, error)
      this.boundaryStoppedAccountQueues.add(account.id)
      return
    }
    if (currentCampaign?.status === 'đang chạy' || currentAccount?.status === 'đang chạy') {
      return
    }

    this.boundaryStoppedAccountQueues.add(account.id)
    const coordinator = this.maintenanceCoordinator
    if (!coordinator) return

    try {
      // The durable old-day unit lease kept the DB gate closed until the
      // settlement immediately preceding this call. The in-flight maintenance
      // pass therefore already includes this campaign; invalidating here would
      // only execute the same idempotent maintenance twice.
      await coordinator.ensureReady()
      context.maintenanceReconciledDateKey = clock.vietnamDateKey
    } catch (error) {
      // Fail closed: this account queue is already stopped. The next scheduler
      // wake enters getReadyRuntimeClock() and retries maintenance before any
      // campaign discovery can continue.
      console.error(`Failed to rerun daily maintenance after campaign ${campaign.id} settled:`, error)
      this.sendLog('⚠️ Chưa cập nhật xong lịch chiến dịch ngày mới; scheduler sẽ tự thử lại trước khi chạy tiếp.')
    }
  }

  private async deferCampaignUntilFutureInput(campaign: Campaign, scheduledAt: Date): Promise<void> {
    await this.updateCampaignAndBroadcast(campaign.id, {
      status: 'chờ xử lý',
      schedule: scheduledAt.toISOString(),
      note: null
    })
    const message = `Hẹn chạy tiếp chiến dịch lúc ${this.formatVietnamDateTime(scheduledAt)}`
    await this.logCampaignProgress(campaign.id, `⏳ ${message}`)
  }

  private isZaloRealtimeGroupCampaign(campaign: Campaign): boolean {
    return campaign.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID
  }

  private getZaloRealtimeEndDateKey(campaign: Campaign): string {
    const raw = String(campaign.extraSettings?.zaloRealtimeEndDate || '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    const date = raw ? new Date(raw) : null
    return date && !Number.isNaN(date.getTime()) ? this.getVietnamDateKey(date) : ''
  }

  private isZaloRealtimeReceivingWindowActive(campaign: Campaign, now: Date): boolean {
    const endDateKey = this.getZaloRealtimeEndDateKey(campaign)
    return Boolean(endDateKey) && this.getVietnamDateKey(now) <= endDateKey
  }

  private getZaloRealtimeWaitSchedule(campaign: Campaign, now: Date): Date {
    const anchor = campaign.originalSchedule || campaign.schedule || now.toISOString()
    const anchorDate = new Date(anchor)
    const anchorParts = Number.isNaN(anchorDate.getTime())
      ? this.getVietnamDateTimeParts(now)
      : this.getVietnamDateTimeParts(anchorDate)
    const slot = `${String(anchorParts.hour).padStart(2, '0')}:${String(anchorParts.minute).padStart(2, '0')}`
    const todayAtSlot = this.withVietnamTimeSlot(now, slot)
    if (todayAtSlot && todayAtSlot.getTime() > now.getTime()) return todayAtSlot
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    return this.withVietnamTimeSlot(tomorrow, slot) || new Date(now.getTime() + 24 * 60 * 60 * 1000)
  }

  private async prepareZaloRealtimeGroupCampaignRun(campaign: Campaign): Promise<boolean> {
    if (!this.isZaloRealtimeGroupCampaign(campaign)) return true

    const details = await this.supabase.listCampaignInputData(campaign.id)
    const now = await this.getDatabaseBusinessNow()
    let earliestFutureInputSchedule: Date | null = null
    let pendingCount = 0

    for (const detail of details) {
      if (detail.status !== 'chờ xử lý') continue
      pendingCount += 1
      const futureSchedule = this.getFutureInputSchedule(detail, now)
      if (futureSchedule) {
        if (!earliestFutureInputSchedule || futureSchedule.getTime() < earliestFutureInputSchedule.getTime()) {
          earliestFutureInputSchedule = futureSchedule
        }
        continue
      }
      return true
    }

    if (earliestFutureInputSchedule) {
      await this.deferCampaignUntilFutureInput(campaign, earliestFutureInputSchedule)
      return false
    }

    if (pendingCount === 0 && this.isZaloRealtimeReceivingWindowActive(campaign, now)) {
      const nextSchedule = this.getZaloRealtimeWaitSchedule(campaign, now)
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: 'chờ xử lý',
        schedule: nextSchedule.toISOString(),
        note: null
      })
      await this.logCampaignProgress(campaign.id, `⏳ Chiến dịch "${campaign.name}" đang chờ data theo thời gian thực từ group Zalo`)
      return false
    }

    const completed = await this.transitionCampaignToCompleted(
      campaign,
      'Chiến dịch đã hết ngày nhận data theo thời gian thực và không còn data chờ chạy'
    )
    if (completed) {
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (hết ngày nhận data theo thời gian thực)`)
    }
    return false
  }

  private async getFindDataSourceWaitNote(campaign: Campaign): Promise<string | null> {
    const targetField = this.getFindDataTargetCampaignField(campaign)
    if (!targetField) return null

    const details = await this.supabase.listCampaignInputData(campaign.id)
    if (details.length > 0) return null

    const campaigns = await this.supabase.listCampaigns()
    const hasSource = campaigns.some(sourceCampaign => {
      if (!this.isMatchingFindDataSource(sourceCampaign, targetField)) return false
      return this.getFindDataConfiguredTargetCampaignIds(
        sourceCampaign.extraSettings?.[targetField],
        sourceCampaign.id
      ).includes(campaign.id)
    })

    return hasSource ? FIND_DATA_SOURCE_WAIT_NOTE : null
  }

  /**
   * Read the current action-limit state without creating/resetting/locking the
   * quota row. A first-time block persists its note with a pending/unclaimed
   * CAS before any runtime claim; subsequent ticks skip all writes while the
   * DB values are still blocked.
   */
  private async getCampaignPreclaimLimitStatus(
    account: AutoAccount,
    campaign: Campaign,
    action: CampaignAction
  ): Promise<AccountActionLimitStatus | null> {
    const {
      executable: preflightExecutableActionDescriptors,
      quota: preflightQuotaActionDescriptors
    } = this.getCampaignPreflightActionDescriptors(campaign, action)

    const disabledStatus = await this.checkActionDisabled(account, preflightExecutableActionDescriptors, true)
    if (disabledStatus && !disabledStatus.ok) return disabledStatus

    const limitResult = await this.checkActionLimitsForContinuation(
      account,
      campaign,
      preflightQuotaActionDescriptors,
      campaign.extraSettings?.actionLimits,
      true
    )
    return limitResult.limitStatus
  }

  private async executeCampaign(
    account: AutoAccount,
    campaign: Campaign
  ): Promise<void> {
    let runtimeClaimed = false
    const isZaloCampaign = String(account.flatformType || '').trim().toLowerCase() === 'zalo'
    if (isZaloCampaign) {
      this.activeZaloCampaignRuns.add(campaign.id)
      this.activeZaloRunGenerations.set(campaign.id, this.zaloRuntimeLifecycleGeneration)
    }
    try {
      const currentCampaign = await this.supabase.getCampaign(campaign.id)
      if (!currentCampaign || currentCampaign.status !== 'chờ xử lý') {
        return
      }
      campaign = currentCampaign

      const preclaimAction = await this.supabase.getCampaignAction(campaign.actionId)
      const preclaimLimitStatus = preclaimAction
        ? await this.getCampaignPreclaimLimitStatus(account, campaign, preclaimAction)
        : null
      if (preclaimLimitStatus) {
        const preclaimLimitNote = await this.buildLimitPreflightNote(preclaimLimitStatus)
        if (String(campaign.note || '').trim() === preclaimLimitNote.trim()) return

        await this.updateUnclaimedCampaignPreflightNote(campaign, preclaimLimitNote)
        return
      }

      const runtimeClaimToken = randomUUID()
      let claimed: Awaited<ReturnType<SupabaseService['claimCampaignRuntimeV2']>>
      let claimRetryLogged = false
      while (true) {
        if (!this.running) return
        try {
          claimed = await this.supabase.claimCampaignRuntimeV2(
            campaign.id,
            account.id,
            this.runtimeTarget,
            runtimeClaimToken
          )
        } catch (error) {
          // The client-generated token makes a retry idempotent when PostgreSQL
          // committed the claim but its response was lost. Never fall back to
          // the legacy boolean RPC: without the token a late run cannot yield
          // safely before maintenance.
          console.error(`Failed v2 runtime claim for campaign ${campaign.id}:`, error)
          if (!claimRetryLogged) {
            claimRetryLogged = true
            this.sendLog('⚠️ Chưa thể xác nhận quyền chạy chiến dịch từ DB; scheduler đang chờ và không mở lượt mới.')
          }
          await new Promise(resolve => setTimeout(resolve, 2_000))
          continue
        }

        if (claimed.reason === 'daily_maintenance_required') {
          // A campaign can be paused while the midnight pass runs and resumed
          // later by Desktop, PWA or another process. Its old schedule must not
          // bypass the coordinator's already-completed in-memory run key. Keep
          // this account queue reserved, rerun maintenance, then retry the same
          // no-write claim immediately.
          this.boundaryStoppedAccountQueues.add(account.id)
          const coordinator = this.maintenanceCoordinator
          if (!coordinator) {
            this.sendLog(`⚠️ Chiến dịch "${campaign.name}" đang chờ cập nhật lịch ngày mới.`)
            return
          }
          coordinator.invalidate()
          try {
            await coordinator.ensureReady()
          } catch (error) {
            console.error(`Failed stale-schedule maintenance for campaign ${campaign.id}:`, error)
            this.sendLog('⚠️ Chưa cập nhật xong lịch chiến dịch ngày mới; scheduler sẽ tự thử lại trước khi chạy tiếp.')
            return
          }
          if (!this.running) return
          continue
        }

        break
      }
      if (!claimed.ok) {
        if (claimed.reason === 'daily_drain_due' || claimed.reason === 'vietnam_day_changed') {
          this.boundaryStoppedAccountQueues.add(account.id)
        }
        return
      }
      if (
        !claimed.runtimeClaimVietnamDateKey ||
        claimed.runtimeClaimToken !== runtimeClaimToken
      ) {
        // Repository validation should make this unreachable. Do not attempt a
        // tokenless cleanup if a mismatched server contract is ever deployed.
        this.boundaryStoppedAccountQueues.add(account.id)
        this.sendLog(`⚠️ Chiến dịch "${campaign.name}" đã dừng vì DB trả ownership token không hợp lệ.`)
        return
      }
      runtimeClaimed = true
      if (this.runtimeTarget === 'server' && isZaloCampaign) {
        this.claimedServerZaloCampaignIds.add(campaign.id)
        this.claimedServerZaloAccountIds.add(account.id)
      }

      const claimedClock: NonNullable<CampaignRunBoundaryCheck['clock']> = {
        dbNow: claimed.dbNow,
        vietnamDateKey: claimed.vietnamDateKey
      }
      const runBoundary = this.createCampaignRunBoundary(
        campaign,
        runtimeClaimToken,
        claimed.runtimeClaimVietnamDateKey
      )
      this.campaignRunBoundaries.set(campaign.id, runBoundary)

      await this.broadcastClaimedRuntimeState(campaign.id)

      const initialBoundaryCheck = this.checkCampaignRunBoundaryWithClock(runBoundary, claimedClock)
      if (await this.stopCampaignAtRunBoundaryIfNeeded(account, campaign, initialBoundaryCheck)) {
        return
      }

      // The mode may change immediately after the atomic claim commits. Do not
      // let that already-claimed campaign advance into preflight/runtime writes.
      const claimedRuntimeStopReason = isZaloCampaign
        ? this.getZaloRuntimeStopReason(campaign.id)
        : null
      if (claimedRuntimeStopReason) {
        if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
        await this.releaseClaimedCampaignPreflight(
          account.id,
          campaign,
          this.getZaloRuntimeCampaignStopNote(claimedRuntimeStopReason)
        )
        return
      }

      const initialServerControl = this.isServerZaloCampaign(account, campaign)
        ? await this.getServerZaloBoundaryReason(account, campaign)
        : null
      if (initialServerControl?.paused) {
        await this.completePauseAtBoundary(account, campaign)
        return
      }
      const startBlockReason = initialServerControl
        ? initialServerControl.hardStopReason
        : await this.getAccountRunBlockReason(account.id, 'đang chạy')
      if (startBlockReason) {
        await this.releaseClaimedCampaignPreflight(account.id, campaign, startBlockReason)
        return
      }

      const findDataWaitNote = await this.getFindDataSourceWaitNote(campaign)
      if (findDataWaitNote) {
        await this.releaseClaimedCampaignPreflight(account.id, campaign, findDataWaitNote)
        return
      }

      try {
        await ensureCurrentUserCanUseCampaignAction(campaign.actionId)
      } catch (err) {
        await this.releaseClaimedCampaignPreflight(
          account.id,
          campaign,
          err instanceof Error ? err.message : String(err)
        )
        return
      }

      const action = preclaimAction || await this.supabase.getCampaignAction(campaign.actionId)
      if (!action) {
        await this.releaseClaimedCampaignPreflight(account.id, campaign, 'Không tìm thấy loại chiến dịch')
        return
      }

      const workflowSelection = this.resolveCampaignWorkflow(action)
      if (!workflowSelection.workflowId) {
        await this.releaseClaimedCampaignPreflight(account.id, campaign, workflowSelection.missingNote)
        return
      }

      if (!(await this.prepareZaloRealtimeGroupCampaignRun(campaign))) {
        await this.releaseRunningAccount(account.id)
        return
      }

      const executableActionDescriptors = this.getCampaignExecutableActionDescriptors(campaign, action)
      const quotaActionDescriptors = this.getCampaignActionDescriptors(campaign, action)

      if (!(await this.ensureZaloSessionReadyForCampaign(account, campaign))) {
        await this.releaseRunningAccount(account.id)
        return
      }

      const preRuntimeStopReason = isZaloCampaign
        ? this.getZaloRuntimeStopReason(campaign.id)
        : null
      if (preRuntimeStopReason) {
        if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
        await this.releaseClaimedCampaignPreflight(
          account.id,
          campaign,
          this.getZaloRuntimeCampaignStopNote(preRuntimeStopReason)
        )
        return
      }

      if (await this.stopCampaignAtRunBoundaryIfNeeded(account, campaign)) {
        return
      }

      await this.logCampaignProgress(campaign.id, `🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${account.name}"`)

      await this.executeCampaignV2(account, campaign, workflowSelection.workflowId, executableActionDescriptors, quotaActionDescriptors)
    } catch (err) {
      if (!runtimeClaimed) throw err
      if (err instanceof CampaignRunUnitOwnershipLostError) return
      const errMsg = err instanceof Error ? err.message : String(err)
      const runtimeStopReason = isZaloCampaign
        ? this.getZaloRuntimeStopReason(campaign.id)
        : null
      if (runtimeStopReason) {
        if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
        await this.recoverStuckCampaignInputData(
          campaign.id,
          this.getZaloRuntimeUncertainNote(runtimeStopReason)
        )
        if (!await this.settleActiveCampaignRunUnit(account, campaign)) return
        await this.updateCampaignAndBroadcast(campaign.id, {
          status: 'chờ xử lý',
          note: this.getZaloRuntimeCampaignStopNote(runtimeStopReason)
        }).catch(() => {})
        await this.releaseRunningAccount(account.id)
        return
      }
      await this.recoverStuckCampaignInputData(campaign.id, errMsg)
      if (!await this.settleActiveCampaignRunUnit(account, campaign)) return
      if (this.isNewsfeedDailyCampaign(campaign)) {
        await this.completeNewsfeedDailyWithoutNextDay(campaign, errMsg)
      } else {
        const handled = await this.handleCampaignBadTarget(account, campaign, null, 'err_undefined', undefined, { message: errMsg })
        if (!handled.triggered) {
          await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: handled.message })
        }
      }
      await this.releaseRunningAccount(account.id)
      await this.logCampaignProgress(campaign.id, `❌ Lỗi chiến dịch "${campaign.name}": ${errMsg}`)
    } finally {
      const unitSettled = runtimeClaimed
        ? await this.settleActiveCampaignRunUnit(account, campaign).catch(error => {
          console.error(`Failed final unit settlement for campaign ${campaign.id}:`, error)
          return false
        })
        : true
      if (runtimeClaimed && unitSettled && this.running) {
        await this.reconcileMaintenanceAfterSettledRun(account, campaign).catch(error => {
          console.error(`Failed final maintenance reconciliation for campaign ${campaign.id}:`, error)
        })
      }
      if (isZaloCampaign) {
        this.activeZaloCampaignRuns.delete(campaign.id)
        this.activeZaloRunGenerations.delete(campaign.id)
        this.activeZaloRunStopReasons.delete(campaign.id)
        this.serverZaloPauseBoundaries.delete(campaign.id)
        this.claimedServerZaloCampaignIds.delete(campaign.id)
        this.claimedServerZaloAccountIds.delete(account.id)
      }
      if (unitSettled) this.activeCampaignRunUnits.delete(campaign.id)
      this.campaignRunBoundaries.delete(campaign.id)
      this.clearZaloSmsPushKeysForCampaign(campaign.id)
    }
  }

  // ============================================================
  // V2 EXECUTOR — chạy workflow v2 cho campaign
  // ============================================================
  /**
   * Engine v2 unified executor. Workflow v2 đã chứa logic ifElse cho các biến
   * thể (sharePost / postAsReels / copyContentFromSource / enableComment /
   * leaveGroup / joinGroup / enableMessage / enableAddFriend). Scheduler chỉ
   * build variables, loop details, gọi engineV2.run.
   */
  private async executeCampaignV2(
    account: AutoAccount,
    campaign: Campaign,
    workflowId: number,
    executableActionDescriptors: CampaignActionDescriptor[],
    quotaActionDescriptors: CampaignActionDescriptor[]
  ): Promise<void> {
    // Determine details: if campaign actionId has details (group_post, message_friend, etc.)
    let details = await this.supabase.listCampaignInputData(campaign.id)
    const extra = campaign.extraSettings || {}

    const initialRuntimeStopReason = account.flatformType === 'zalo'
      ? this.getZaloRuntimeStopReason(campaign.id)
      : null
    if (initialRuntimeStopReason) {
      if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: 'chờ xử lý',
        note: this.getZaloRuntimeCampaignStopNote(initialRuntimeStopReason)
      })
      await this.releaseRunningAccount(account.id)
      return
    }

    if (this.isCampaignPauseRequested(campaign.id)) {
      await this.releaseRunningAccount(account.id)
      await this.completeCampaignPause(campaign)
      return
    }

    if (
      campaign.dataTargetSourceMode === 'data_group' &&
      !details.some(detail => !detail.isDelete && detail.status === 'chờ xử lý')
    ) {
      await this.handleCampaignCompletion(campaign)
      await this.releaseRunningAccount(account.id)
      return
    }

    if (this.shouldMaterializeZaloFriendInputData(campaign, details)) {
      details = await this.materializeZaloFriendInputData(account, campaign)
      if (this.isCampaignPauseRequested(campaign.id)) {
        await this.releaseRunningAccount(account.id)
        await this.completeCampaignPause(campaign)
        return
      }
      if (details.length === 0) {
        const message = 'Không lấy được bạn bè Zalo nào để gửi tin'
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
        await this.logCampaignProgress(campaign.id, `⚠️ ${message}`)
        await this.releaseRunningAccount(account.id)
        return
      }
    }

    const birthdayBusinessNow = this.isZaloBirthdayCampaign(campaign) && details.length === 0
      ? await this.getDatabaseBusinessNow()
      : null
    if (
      birthdayBusinessNow &&
      this.shouldMaterializeZaloBirthdayInputData(campaign, details, birthdayBusinessNow)
    ) {
      details = await this.materializeZaloBirthdayInputData(account, campaign, birthdayBusinessNow)
      if (this.isCampaignPauseRequested(campaign.id)) {
        await this.releaseRunningAccount(account.id)
        await this.completeCampaignPause(campaign)
        return
      }
      if (details.length === 0) {
        await this.completeZaloBirthdayWithoutTargets(campaign)
        await this.releaseRunningAccount(account.id)
        return
      }
    }

    if (this.shouldMaterializeZaloFriendRecommendationInputData(campaign, details)) {
      details = await this.materializeZaloFriendRecommendationInputData(account, campaign)
      if (details.length === 0) {
        await this.releaseRunningAccount(account.id)
        return
      }
      if (this.isCampaignPauseRequested(campaign.id)) {
        await this.releaseRunningAccount(account.id)
        await this.completeCampaignPause(campaign)
        return
      }
    }

    if (this.shouldMaterializeZaloCancelSentFriendRequestInputData(campaign, details)) {
      details = await this.materializeZaloCancelSentFriendRequestInputData(account, campaign, details)
      if (details.length === 0) {
        await this.releaseRunningAccount(account.id)
        return
      }
      if (this.isCampaignPauseRequested(campaign.id)) {
        await this.releaseRunningAccount(account.id)
        await this.completeCampaignPause(campaign)
        return
      }
    }

    if (this.isZaloFriendAutoDataCampaign(campaign) && details.length === 0) {
      const message = 'Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy'
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
      await this.logCampaignProgress(campaign.id, `⚠️ ${message}`)
      await this.releaseRunningAccount(account.id)
      return
    }

    if (this.isZaloBirthdayCampaign(campaign) && details.length === 0) {
      await this.completeZaloBirthdayWithoutTargets(campaign)
      await this.releaseRunningAccount(account.id)
      return
    }

    if (this.isZaloFriendRecommendationCampaign(campaign) && details.length === 0) {
      await this.completeZaloFriendRecommendationWithoutTargets(campaign, 'Zalo không có danh sách đề xuất để chạy')
      await this.releaseRunningAccount(account.id)
      return
    }

    if (this.isZaloCancelSentFriendRequestCampaign(campaign) && details.length === 0) {
      await this.completeZaloCancelSentFriendRequestWithoutTargets(campaign, 'Zalo không có lời mời kết bạn đã gửi để huỷ')
      await this.releaseRunningAccount(account.id)
      return
    }

    const materializedRuntimeStopReason = account.flatformType === 'zalo'
      ? this.getZaloRuntimeStopReason(campaign.id)
      : null
    if (materializedRuntimeStopReason) {
      if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: 'chờ xử lý',
        note: this.getZaloRuntimeCampaignStopNote(materializedRuntimeStopReason)
      })
      await this.releaseRunningAccount(account.id)
      return
    }

    if (this.shouldUseSuggestedFriends(campaign) && details.length === 0) {
      const suggestedDetails = await this.collectSuggestedFriendInputData(account, campaign, workflowId)
      if (suggestedDetails === null) return
      details = suggestedDetails
      if (this.isCampaignPauseRequested(campaign.id)) {
        await this.releaseRunningAccount(account.id)
        await this.completeCampaignPause(campaign)
        return
      }
      if (details.length === 0) {
        const message = 'Không lấy được đề xuất bạn bè từ Facebook'
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
        await this.logCampaignProgress(campaign.id, `⚠️ ${message}`)
        await this.releaseRunningAccount(account.id)
        return
      }
    }

    const zaloFriendBlocklist = await this.loadZaloFriendBlocklistContext(account, campaign)
    if (zaloFriendBlocklist?.invalidReason) {
      const note = `Danh sách không gửi tin Zalo không hợp lệ: ${zaloFriendBlocklist.invalidReason}`
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note })
      await this.logCampaignProgress(campaign.id, `⚠️ ${note}`)
      await this.releaseRunningAccount(account.id)
      return
    }

    if (
      this.isFormattedContentCampaign(campaign) &&
      campaign.extraSettings?.zaloMessageSendMode === ZALO_MESSAGE_SEND_MODE_SHARE &&
      !this.formattedZaloShareWarnings.has(campaign.id)
    ) {
      this.formattedZaloShareWarnings.add(campaign.id)
      await this.logCampaignProgress(
        campaign.id,
        '⚠️ Nội dung có định dạng không hỗ trợ chế độ chia sẻ; chiến dịch sẽ gửi tin nhắn thường.'
      )
    }

    // Materialization, blocklist loading and content validation may take long
    // enough to reach the cutoff. No ordinary target is reserved at this point.
    if (await this.stopCampaignAtRunBoundaryIfNeeded(account, campaign)) {
      return
    }

    if (this.shouldUseZaloShareMessageBatch(campaign)) {
      await this.executeZaloShareMessageBatchCampaign(
        account,
        campaign,
        details,
        executableActionDescriptors,
        quotaActionDescriptors,
        zaloFriendBlocklist
      )
      return
    }

    if (this.shouldUseFacebookGroupInviteBatch(campaign)) {
      await this.executeFacebookGroupInviteBatchCampaign(
        account,
        campaign,
        workflowId,
        details,
        executableActionDescriptors,
        quotaActionDescriptors
      )
      return
    }

    // Shuffle group list nếu enabled
    if (campaign.extraSettings?.shuffleGroupList && details.length > 1 && campaign.actionId === 'facebook_group_post') {
      for (let i = details.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[details[i], details[j]] = [details[j], details[i]]
      }
      await this.logCampaignProgress(campaign.id, `🔀 Đã xáo trộn danh sách ${details.length} group`)
    }

    const sourcePagePostMode = extra.pagePostMode || 'api'
    const shouldPostWithBackground = !this.isFormattedContentCampaign(campaign) && extra.postWithBackground === true && (
      campaign.actionId === 'facebook_timeline_post' ||
      (campaign.actionId === PAGE_POST_ACTION_ID && sourcePagePostMode === 'ui') ||
      campaign.actionId === GROUP_POST_ACTION_ID
    )
    const advancedContentError = this.getAdvancedContentConfigError(campaign, !shouldPostWithBackground)
    if (advancedContentError) {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: advancedContentError })
      await this.logCampaignProgress(campaign.id, `⚠️ ${advancedContentError}`)
      await this.releaseRunningAccount(account.id)
      return
    }
    const shouldRotateSourceLink =
      !shouldPostWithBackground && (
        (campaign.actionId === 'facebook_timeline_post' && (extra.copyContentFromSource === true || extra.sharePost === true)) ||
        (campaign.actionId === PAGE_POST_ACTION_ID && extra.copyContentFromSource === true) ||
        (campaign.actionId === 'facebook_group_post' && extra.copyContentFromSource === true)
      )
    const sourceLinks = shouldRotateSourceLink
      ? (extra.sourceLinks || '').split(/[,\r\n]+/).map(s => s.trim()).filter(Boolean)
      : []
    let sourceLinkRotationIndex = sourceLinks.length > 0
      ? (((Number(extra.sourceLinkIndex || 0) % sourceLinks.length) + sourceLinks.length) % sourceLinks.length)
      : 0

    const runOnce = details.length === 0
    const targets = runOnce ? [null] : details

    const limitConfig = extra.actionLimits
    let stoppedBeforeCompletion = false
    let earliestFutureInputSchedule: Date | null = null
    let zaloFriendBlocklistSkippedCount = 0
    const consumedGroupPostInputDataIds = new Set<number>()
    const loggedSkippedLimitActionCodes = new Set<string>()

    for (let i = 0; i < targets.length; i++) {
      // A graceful Server capability drain owns only the target/batch that
      // already crossed its DB unit claim. Do not run preflight or mutate a
      // later pending target while the runtime is stopping.
      if (this.isServerZaloCampaign(account, campaign) && !this.running) return
      const detail = targets[i]
      // Completed/paused/error rows are only historical context. Skip them
      // before any per-target DB guards so large campaigns resume immediately
      // instead of issuing multiple queries for every previously handled row.
      if (detail && consumedGroupPostInputDataIds.has(detail.id)) continue
      if (detail && detail.status !== 'chờ xử lý') continue

      if (await this.stopCampaignAtRunBoundaryIfNeeded(account, campaign)) {
        return
      }

      const loopRuntimeStopReason = account.flatformType === 'zalo'
        ? this.getZaloRuntimeStopReason(campaign.id)
        : null
      if (loopRuntimeStopReason) {
        if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
        stoppedBeforeCompletion = true
        await this.updateCampaignAndBroadcast(campaign.id, {
          status: 'chờ xử lý',
          note: this.getZaloRuntimeCampaignStopNote(loopRuntimeStopReason)
        })
        break
      }
      // Server-mode pause is durable DB control. Stop only before the next
      // unit; an already-started target is allowed to finish below.
      const serverBoundary = await this.getServerZaloBoundaryReason(account, campaign)
      const cur = serverBoundary.paused ? null : await this.supabase.getCampaign(campaign.id)
      if (this.isServerZaloCampaign(account, campaign) && !this.running) return
      if (
        serverBoundary.paused ||
        this.isCampaignPauseRequested(campaign.id) ||
        (cur && cur.status === 'tạm dừng')
      ) {
        await this.completePauseAtBoundary(account, campaign)
        return
      }

      const needsInputScheduleClock = Boolean(detail?.schedule)
      const targetBusinessNow = this.requiresDataGroupHardEndCheck(campaign) || needsInputScheduleClock
        ? await this.getDatabaseBusinessNow()
        : undefined
      if (await this.finalizeDataGroupCampaignAtHardEnd(campaign, targetBusinessNow)) {
        await this.releaseRunningAccount(account.id)
        return
      }
      if (this.isServerZaloCampaign(account, campaign) && !this.running) return

      const accountBlockReason = this.isServerZaloCampaign(account, campaign)
        ? serverBoundary.hardStopReason
        : await this.getAccountRunBlockReason(account.id, 'đang chạy')
      if (this.isServerZaloCampaign(account, campaign) && !this.running) return
      if (accountBlockReason) {
        stoppedBeforeCompletion = true
        await this.stopCampaignForAccountCondition(account, campaign, accountBlockReason)
        await this.releaseRunningAccount(account.id)
        return
      }

      if (detail) {
        const futureSchedule = detail.schedule && targetBusinessNow
          ? this.getFutureInputSchedule(detail, targetBusinessNow)
          : null
        if (futureSchedule) {
          if (!earliestFutureInputSchedule || futureSchedule.getTime() < earliestFutureInputSchedule.getTime()) {
            earliestFutureInputSchedule = futureSchedule
          }
          continue
        }
      }

      if (detail && this.isZaloFriendBlockedByBlocklist(campaign, detail, zaloFriendBlocklist)) {
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        await this.markZaloFriendBlocklistSkipped(campaign, detail, zaloFriendBlocklist!)
        zaloFriendBlocklistSkippedCount += 1
        continue
      }

      if (detail && isRecentDeliveryCooldownEnabled(campaign.actionId, campaign.extraSettings)) {
        try {
          const cooldown = await this.applyRecentDeliveryCooldown(account, campaign, [detail.id])
          if (!cooldown.allowedInputDataIds.has(detail.id)) {
            if (cooldown.pausedInputDataIds.has(detail.id)) {
              detail.status = 'tạm dừng'
              await this.logRecentDeliveryCooldownPauses(campaign, [detail], cooldown)
            }
            continue
          }
        } catch (err) {
          const message = `Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: ${getErrorMessage(err) || 'Lỗi không xác định'}`
          await this.releaseClaimedCampaignPreflight(account.id, campaign, message)
          await this.logCampaignProgress(campaign.id, `⚠️ ${message}`).catch(() => {})
          return
        }
      }

      const groupPostApproval = await this.resolveGroupPostApprovalForTarget(account.id, campaign, detail)
      if (this.isServerZaloCampaign(account, campaign) && !this.running) return
      const executableTargetActionDescriptors = groupPostApproval.skipPostByKnownApproval
        ? executableActionDescriptors.filter(action => action.code !== 'fb_post_group')
        : executableActionDescriptors
      let quotaTargetActionDescriptors = groupPostApproval.skipPostByKnownApproval
        ? quotaActionDescriptors.filter(action => action.code !== 'fb_post_group')
        : quotaActionDescriptors
      let newsfeedAvailability: NewsfeedActionAvailability | undefined
      let skippedLimitActionCodes = new Set<string>()

      // Check action disable/rate limit immediately before each target.
      try {
        if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
          const continueOnActionLimit = this.shouldContinueWhenActionLimitReached(limitConfig)
          newsfeedAvailability = await this.resolveNewsfeedActionAvailability(
            account,
            campaign,
            executableTargetActionDescriptors,
            quotaTargetActionDescriptors,
            limitConfig
          )
          if (this.isServerZaloCampaign(account, campaign) && !this.running) return
          if (newsfeedAvailability.disabledStatus) {
            stoppedBeforeCompletion = true
            await this.handleLimitStatus(account, campaign, newsfeedAvailability.disabledStatus)
            break
          }
          if (!continueOnActionLimit && newsfeedAvailability.blockedLimitStatuses.length > 0) {
            stoppedBeforeCompletion = true
            await this.handleLimitStatus(account, campaign, newsfeedAvailability.blockedLimitStatuses[0])
            break
          }
          if (newsfeedAvailability.allCheckedActionsBlocked) {
            stoppedBeforeCompletion = true
            const limitStatus = newsfeedAvailability.blockedLimitStatuses[0]
            const message = newsfeedAvailability.blockedReasons.join('; ') || 'Các hành động newsfeed đang đạt giới hạn'
            if (this.isNewsfeedDailyCampaign(campaign)) {
              await this.completeNewsfeedDailyWithoutNextDay(campaign, message)
            } else if (limitStatus) {
              await this.handleLimitStatus(account, campaign, limitStatus)
            } else {
              await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
              await this.logCampaignProgress(campaign.id, `⚠️ Tạm dừng "${campaign.name}": ${message}`)
            }
            break
          }
          skippedLimitActionCodes = this.getSkippedLimitActionCodeSet(newsfeedAvailability.blockedLimitStatuses)
          await this.logSkippedLimitActionsOnce(campaign, newsfeedAvailability.blockedLimitStatuses, loggedSkippedLimitActionCodes)
        } else {
          const disabledStatus = await this.checkActionDisabled(account, executableTargetActionDescriptors)
          if (this.isServerZaloCampaign(account, campaign) && !this.running) return
          if (disabledStatus && !disabledStatus.ok) {
            stoppedBeforeCompletion = true
            await this.handleLimitStatus(account, campaign, disabledStatus)
            break
          }

          const limitResult = await this.checkActionLimitsForContinuation(account, campaign, quotaTargetActionDescriptors, limitConfig)
          if (this.isServerZaloCampaign(account, campaign) && !this.running) return
          if (limitResult.limitStatus) {
            stoppedBeforeCompletion = true
            await this.handleLimitStatus(account, campaign, limitResult.limitStatus)
            break
          }
          quotaTargetActionDescriptors = limitResult.runnableActionDescriptors
          skippedLimitActionCodes = this.getSkippedLimitActionCodeSet(limitResult.skippedLimitStatuses)
          await this.logSkippedLimitActionsOnce(campaign, limitResult.skippedLimitStatuses, loggedSkippedLimitActionCodes)
        }
      } catch (err) {
        console.error('Rate limit check error:', err)
        const message = `Không thể kiểm tra giới hạn hành động từ DB; chiến dịch sẽ tự thử lại: ${getErrorMessage(err) || 'Lỗi không xác định'}`
        await this.releaseClaimedCampaignPreflight(account.id, campaign, message)
        await this.logCampaignProgress(campaign.id, `⚠️ ${message}`).catch(() => {})
        return
      }

      const browserlessRun = this.isBrowserlessCampaign(campaign)
      const automationPage = browserlessRun
        ? { page: null, source: 'background' as const }
        : await this.getAutomationPage(account, campaign.id)
      if (this.isServerZaloCampaign(account, campaign) && !this.running) return
      const page = automationPage.page

      let currentSourceLink = ''
      if (sourceLinks.length > 0) {
        const sourceIdx = sourceLinkRotationIndex % sourceLinks.length
        currentSourceLink = sourceLinks[sourceIdx]
        sourceLinkRotationIndex = (sourceIdx + 1) % sourceLinks.length
        try {
          await this.updateCampaignAndBroadcast(campaign.id, {
            extraSettings: { ...extra, sourceLinkIndex: sourceLinkRotationIndex }
          })
        } catch {}
        const targetLabel = detail ? ` cho "${this.getInputDataDisplayName(campaign, detail)}"` : ''
        await this.logCampaignProgress(campaign.id, `🔗 Link nguồn #${sourceIdx + 1}/${sourceLinks.length}${targetLabel}: ${currentSourceLink}`)
      }

      // Run engine v2
      let shouldStopAfterTarget = false
      let shouldCompletePauseAfterTarget = false
      const mediaTempPaths: string[] = []
      try {
        // Build variables
        const groupPostShareMaxCount = await this.resolveGroupPostShareQuotaCapacity(
          account,
          campaign,
          limitConfig,
          groupPostApproval.skipPostByKnownApproval
        )
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        let groupPostShareTargets = await this.buildGroupPostShareTargets(
          campaign,
          details,
          detail,
          consumedGroupPostInputDataIds,
          groupPostShareMaxCount,
          targetBusinessNow
        )
        if (groupPostShareTargets.length > 0 && detail && isRecentDeliveryCooldownEnabled(campaign.actionId, campaign.extraSettings)) {
          try {
            const cooldown = await this.applyRecentDeliveryCooldown(
              account,
              campaign,
              [detail.id, ...groupPostShareTargets.map(target => target.id)]
            )
            for (const pausedId of cooldown.pausedInputDataIds) {
              const pausedDetail = details.find(item => item.id === pausedId)
              if (pausedDetail) pausedDetail.status = 'tạm dừng'
            }
            await this.logRecentDeliveryCooldownPauses(
              campaign,
              [
                detail,
                ...groupPostShareTargets.map(target => details.find(item => item.id === target.id))
              ],
              cooldown
            )
            groupPostShareTargets = groupPostShareTargets.filter(target =>
              cooldown.allowedInputDataIds.has(target.id)
            )
          } catch (err) {
            const message = `Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: ${getErrorMessage(err) || 'Lỗi không xác định'}`
            await this.releaseClaimedCampaignPreflight(account.id, campaign, message)
            await this.logCampaignProgress(campaign.id, `⚠️ ${message}`).catch(() => {})
            return
          }
        }
        const baseVariables = await this.buildVariablesV2(campaign, detail, account.id, currentSourceLink, i, groupPostApproval, mediaTempPaths, skippedLimitActionCodes)
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        const variables = {
          ...baseVariables,
          enableGroupPostShareToJoinedGroups: campaign.extraSettings?.enableGroupPostShareToJoinedGroups === true && groupPostShareMaxCount > 0 && groupPostShareTargets.length > 0,
          groupPostShareTargets,
          groupPostShareMaxCount,
          ...(campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID
            ? {
              allowNewsfeedLike: newsfeedAvailability?.allowLike ?? true,
              allowNewsfeedComment: newsfeedAvailability?.allowComment ?? true
            }
            : {})
        }

        if (account.flatformType === 'zalo') {
          this.throwIfZaloRuntimeStopping(campaign.id)
        }

        // Quota/page preparation above can outlive the earlier hard-end check;
        // finalize that lifecycle before the atomic daily/unit claim below.
        if (await this.finalizeDataGroupCampaignAtHardEnd(campaign)) {
          await this.releaseRunningAccount(account.id)
          return
        }

        // This DB transaction is the final start point for both Desktop and
        // Server: it validates the parent token/cutoff and reserves the input
        // before the workflow can produce an external side effect.
        const runUnitInputDataIds = detail
          ? [detail.id, ...groupPostShareTargets.map(target => target.id)]
          : []
        if (!await this.beginCampaignRunUnit(
          account,
          campaign,
          runUnitInputDataIds,
          { requeueRemainingOnSettle: groupPostShareTargets.length > 0 }
        )) return
        try {
          if (detail) {
            const inputDataName = this.getInputDataDisplayName(campaign, detail)
            await this.logCampaignProgress(campaign.id, `▶️ Xử lý "${inputDataName}" trong chiến dịch "${campaign.name}"`)
            if (groupPostApproval.skipPostByKnownApproval) {
              const message = `Bỏ qua đăng bài vào "${inputDataName}" vì group đã biết cần duyệt bài`
              await this.logCampaignProgress(campaign.id, `⚠️ ${message}`)
            }
          }
        } catch (error) {
          // No side effect has started yet. Requeue the exact reservation before
          // propagating a progress-log failure into the normal campaign policy.
          if (!await this.settleActiveCampaignRunUnit(account, campaign, true)) return
          throw error
        }
        if (this.isRunUnitStartCancelled(account, campaign)) {
          await this.settleActiveCampaignRunUnit(account, campaign, true)
          return
        }

        const abort = new AbortController()
        let accountStopReason: string | null = null
        let accountGuardCheckInFlight = false
        const accountGuard = setInterval(() => {
          void (async () => {
            if (accountStopReason || abort.signal.aborted || accountGuardCheckInFlight) return
            accountGuardCheckInFlight = true
            try {
            if (this.isServerZaloCampaign(account, campaign)) {
              const control = await this.supabase.getZaloServerRunControlState(campaign.id, account.id)
              if (this.isServerZaloBoundaryRequested(
                control.campaignStatus,
                control.accountStatus,
                control.hardStopReason
              )) {
                this.latchServerZaloPause(campaign.id, control.campaignStatus, control.accountStatus)
                return
              }
              if (control.hardStopReason) {
                accountStopReason = this.getServerZaloHardStopMessage(control.hardStopReason)
                abort.abort()
              }
              return
            }
            const reason = await this.getAccountRunBlockReason(account.id, 'đang chạy')
            if (reason) {
              accountStopReason = reason
              abort.abort()
            }
            } finally {
              accountGuardCheckInFlight = false
            }
          })().catch(err => {
            console.error('Account run guard error:', err)
          })
        }, 5000)
        this.activeV2Aborts.set(campaign.id, abort)
        if (account.flatformType === 'zalo' && this.getZaloRuntimeStopReason(campaign.id)) abort.abort()
        if (automationPage.source === 'background' && page) {
          this.startBackgroundPreview(account.id, campaign.id, page)
        }
        const screenshotProgressLogs: BlockScreenshotProgressLog[] = []
        try {
          const runtimeHelpers = this.createBlockRuntimeHelpers(account, campaign, detail, page)
          const result = await this.engineV2.run(workflowId, variables, page, {
            organizationId: campaign.organizationId ?? account.organizationId ?? null,
            accountId: account.id,
            campaignId: campaign.id,
            campaignInputId: detail?.inputId ?? null,
            campaignInputDataId: detail?.id,
            signal: abort.signal,
            persist: true,
            runtimeHelpers,
            onBlockScreenshot: async (request, screenshotPage) => {
              const progressLog = await this.recordBlockScreenshotEvent(account, campaign, detail, request, screenshotPage)
              if (progressLog) screenshotProgressLogs.push(progressLog)
            },
            onStepProgress: (step: RunStepV2) => {
              try { this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_PROGRESS, { runKey: `campaign-${campaign.id}`, step }) } catch {}
              if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID && step.status === 'success') {
                void this.logNewsfeedMilestoneStep(campaign, detail, account.id, step)
              }
            },
            onLog: (entry) => {
              try { this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_LOG, { runKey: `campaign-${campaign.id}`, ...entry }) } catch {}
            }
          })

          // An abort cannot cancel a Zalo HTTP request that is already in
          // flight. Recheck the lifecycle immediately when the workflow
          // returns, before milestone/detail writes can make the target look
          // retryable or successfully completed by this obsolete runtime.
          if (account.flatformType === 'zalo') {
            this.throwIfZaloRuntimeStopping(campaign.id)
          }

          // Per-milestone logging — scan steps theo block_name
          const milestoneSummary = await this.logMilestonesV2(
            campaign,
            detail,
            account.id,
            result.steps,
            result.status === 'completed',
            screenshotProgressLogs,
            consumedGroupPostInputDataIds
          )

          if (this.isServerZaloCampaign(account, campaign)) {
            const control = await this.supabase.getZaloServerRunControlState(campaign.id, account.id)
            if (this.isServerZaloBoundaryRequested(
              control.campaignStatus,
              control.accountStatus,
              control.hardStopReason
            )) {
              this.latchServerZaloPause(campaign.id, control.campaignStatus, control.accountStatus)
            } else if (control.hardStopReason && !accountStopReason) {
              accountStopReason = this.getServerZaloHardStopMessage(control.hardStopReason)
            }
          }

          const campaignPauseRequested = this.isCampaignPauseRequested(campaign.id) ||
            this.serverZaloPauseBoundaries.has(campaign.id)
          const pauseCancelledRun = campaignPauseRequested && !accountStopReason && result.status === 'cancelled'
          const runtimeStopReason = account.flatformType === 'zalo'
            ? this.getZaloRuntimeStopReason(campaign.id)
            : null
          const runtimeModeStopRequested = runtimeStopReason !== null
          if (runtimeModeStopRequested && this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          let runtimeStopTriggered = false

          if (accountStopReason && !runtimeModeStopRequested) {
            if (detail && !milestoneSummary.preventInputRetry) {
              await this.supabase.updateCampaignInputData(detail.id, { status: 'chờ xử lý', note: accountStopReason })
            }
            await this.stopCampaignForAccountCondition(account, campaign, accountStopReason)
            shouldStopAfterTarget = true
          }

          if (detail && (runtimeModeStopRequested || !accountStopReason || milestoneSummary.preventInputRetry)) {
            if (runtimeModeStopRequested) {
              await this.supabase.updateCampaignInputData(detail.id, {
                status: 'hoàn thành',
                note: this.getZaloRuntimeUncertainNote(runtimeStopReason)
              })
              consumedGroupPostInputDataIds.add(detail.id)
            } else if (milestoneSummary.preventInputRetry) {
              await this.supabase.updateCampaignInputData(detail.id, {
                status: 'hoàn thành',
                note: milestoneSummary.inputCompletionNote || 'Tin nhắn đã gửi một phần; không tự động gửi lại để tránh trùng nội dung hoặc file.'
              })
              consumedGroupPostInputDataIds.add(detail.id)
            } else if (result.status === 'completed') {
              if (milestoneSummary.resetInputToPending) {
                await this.supabase.updateCampaignInputData(detail.id, {
                  status: 'chờ xử lý',
                  note: milestoneSummary.pendingNote || ''
                })
              } else {
                await this.supabase.updateCampaignInputData(detail.id, { status: 'hoàn thành' })
                consumedGroupPostInputDataIds.add(detail.id)
                await this.logCampaignProgress(campaign.id, `✅ Hoàn thành "${this.getInputDataDisplayName(campaign, detail)}"`)
              }
            } else if (pauseCancelledRun) {
              await this.supabase.updateCampaignInputData(detail.id, { status: 'chờ xử lý', note: CAMPAIGN_PAUSE_PENDING_NOTE })
            } else {
              // campaign_input_data enum không có 'lỗi' — set 'hoàn thành' + note (chi tiết lỗi đã ở campaign_details)
              const errMsg = result.error || 'Lỗi không xác định'
              await this.supabase.updateCampaignInputData(detail.id, { status: 'hoàn thành', note: errMsg })
              consumedGroupPostInputDataIds.add(detail.id)
              await this.logCampaignProgress(campaign.id, `❌ Lỗi "${this.getInputDataDisplayName(campaign, detail)}": ${errMsg}`)
            }
          }

          if (!accountStopReason && !pauseCancelledRun && !runtimeModeStopRequested) {
            const runtimeError = result.status !== 'completed'
              ? this.normalizeRuntimeError(campaign, result.steps, result.error)
              : null

            if (
              runtimeError &&
              this.isNewsfeedDailyCampaign(campaign) &&
              runtimeError.errorCode !== COMMENT_FREQUENCY_LIMIT_ERROR_CODE
            ) {
              await this.completeNewsfeedDailyWithoutNextDay(campaign, runtimeError.message)
              runtimeStopTriggered = true
              shouldStopAfterTarget = true
            } else if (runtimeError) {
              const handled = await this.handleCampaignBadTarget(
                account,
                campaign,
                detail?.id,
                runtimeError.errorCode,
                runtimeError.actionCode,
                {
                  message: runtimeError.message,
                  runId: result.runId ? String(result.runId) : undefined
                }
              )
              runtimeStopTriggered = handled.triggered
              shouldStopAfterTarget = handled.triggered
            } else if (
              milestoneSummary.hasError ||
              milestoneSummary.hasHardFailure ||
              (milestoneSummary.hasFailure && !milestoneSummary.hasSuccess)
            ) {
              const handled = await this.handleCampaignBadTarget(
                account,
                campaign,
                detail?.id,
                'err_undefined',
                executableTargetActionDescriptors[0]?.code,
                {
                  message: this.getMilestoneBadReason(milestoneSummary),
                  thresholdReason: this.getMilestoneBadRootReason(milestoneSummary),
                  runId: result.runId ? String(result.runId) : undefined
                }
              )
              runtimeStopTriggered = handled.triggered
              shouldStopAfterTarget = handled.triggered
            } else if (milestoneSummary.hasSuccess) {
              await this.resetCampaignBadTargetCount(campaign)
            }
          }

          if (milestoneSummary.stopAfterTarget && !runtimeModeStopRequested) {
            const latestCampaign = await this.supabase.getCampaign(campaign.id).catch(() => null)
            if (!latestCampaign || latestCampaign.status === 'đang chạy') {
              await this.updateCampaignAndBroadcast(campaign.id, {
                status: 'chờ xử lý',
                note: milestoneSummary.pendingNote || 'Tài khoản Zalo cần kiểm tra lại trước khi chạy tiếp'
              })
            }
            shouldStopAfterTarget = true
          }

          if (runtimeModeStopRequested && this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          if (runtimeModeStopRequested) {
            await this.updateCampaignAndBroadcast(campaign.id, {
              status: 'chờ xử lý',
              note: this.getZaloRuntimeCampaignStopNote(runtimeStopReason)
            })
            shouldStopAfterTarget = true
          }

          if (campaignPauseRequested && !runtimeModeStopRequested) {
            if (!accountStopReason && !runtimeStopTriggered) {
              shouldCompletePauseAfterTarget = true
              shouldStopAfterTarget = true
            } else {
              this.pauseRequests.delete(campaign.id)
            }
          }
        } catch (err: any) {
          const errMsg = err?.message || String(err)
          if (this.isServerZaloCampaign(account, campaign)) {
            const control = await this.supabase.getZaloServerRunControlState(campaign.id, account.id).catch(() => null)
            if (control && this.isServerZaloBoundaryRequested(
              control.campaignStatus,
              control.accountStatus,
              control.hardStopReason
            )) {
              this.latchServerZaloPause(campaign.id, control.campaignStatus, control.accountStatus)
            } else if (control?.hardStopReason && !accountStopReason) {
              accountStopReason = this.getServerZaloHardStopMessage(control.hardStopReason)
            }
          }
          const campaignPauseRequested = this.isCampaignPauseRequested(campaign.id) ||
            this.serverZaloPauseBoundaries.has(campaign.id)
          const pauseAbortTriggered = campaignPauseRequested && !accountStopReason && abort.signal.aborted
          const runtimeStopReason = account.flatformType === 'zalo'
            ? this.getZaloRuntimeStopReason(campaign.id)
            : null
          const runtimeModeAbortTriggered = runtimeStopReason !== null
          if (runtimeModeAbortTriggered && this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          let runtimeStopTriggered = false
          if (detail) {
            const nextStatus = runtimeModeAbortTriggered
              ? 'hoàn thành'
              : accountStopReason || pauseAbortTriggered
                ? 'chờ xử lý'
                : 'hoàn thành'
            await this.supabase.updateCampaignInputData(detail.id, {
              status: nextStatus,
              note: runtimeModeAbortTriggered
                ? this.getZaloRuntimeUncertainNote(runtimeStopReason)
                : accountStopReason || (pauseAbortTriggered ? CAMPAIGN_PAUSE_PENDING_NOTE : errMsg)
            })
            if (nextStatus === 'hoàn thành') consumedGroupPostInputDataIds.add(detail.id)
          }
          if (runtimeModeAbortTriggered && this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          if (runtimeModeAbortTriggered) {
            await this.updateCampaignAndBroadcast(campaign.id, {
              status: 'chờ xử lý',
              note: this.getZaloRuntimeCampaignStopNote(runtimeStopReason)
            })
            shouldStopAfterTarget = true
          } else if (pauseAbortTriggered) {
            shouldCompletePauseAfterTarget = true
            shouldStopAfterTarget = true
          } else if (accountStopReason) {
            await this.stopCampaignForAccountCondition(account, campaign, accountStopReason)
            shouldStopAfterTarget = true
          } else {
            const runtimeError = this.normalizeRuntimeError(campaign, [], errMsg)
            if (
              this.isNewsfeedDailyCampaign(campaign) &&
              runtimeError.errorCode !== COMMENT_FREQUENCY_LIMIT_ERROR_CODE
            ) {
              await this.completeNewsfeedDailyWithoutNextDay(campaign, runtimeError.message)
              runtimeStopTriggered = true
              shouldStopAfterTarget = true
            } else {
              const handled = await this.handleCampaignBadTarget(
                account,
                campaign,
                detail?.id,
                runtimeError.errorCode,
                runtimeError.actionCode,
                { message: runtimeError.message }
              )
              runtimeStopTriggered = handled.triggered
              shouldStopAfterTarget = handled.triggered
            }
          }
          if (!pauseAbortTriggered && !runtimeModeAbortTriggered) {
            await this.logCampaignProgress(campaign.id, `❌ Lỗi engine v2 "${campaign.name}": ${errMsg}`)
            while (screenshotProgressLogs.length > 0) {
              const progressLog = screenshotProgressLogs.shift()
              if (!progressLog) continue
              await this.logCampaignProgress(campaign.id, progressLog.storedMessage, {
                realtimeMessage: progressLog.realtimeMessage,
                realtimeAction: progressLog.action
              })
            }
          }
          if (campaignPauseRequested && !pauseAbortTriggered && !runtimeModeAbortTriggered) {
            if (!accountStopReason && !runtimeStopTriggered) {
              shouldCompletePauseAfterTarget = true
              shouldStopAfterTarget = true
            } else {
              this.pauseRequests.delete(campaign.id)
            }
          }
        } finally {
          clearInterval(accountGuard)
          if (automationPage.source === 'background' && page) {
            this.stopBackgroundPreview(account.id, campaign.id)
          }
          this.activeV2Aborts.delete(campaign.id)
        }
      } catch (err) {
        if (this.isCampaignMediaResolveError(err)) {
          await this.pauseCampaignForMediaError(campaign, detail, err)
          shouldStopAfterTarget = true
        } else {
          throw err
        }
      } finally {
        this.cleanupCampaignMediaTempFiles(mediaTempPaths)
      }

      // Account-stop/pause handling above contains awaits. A mode change can
      // arrive during one of those writes, so make the lifecycle decision one
      // final time and let uncertainty be the authoritative last state.
      const postTargetRuntimeStopReason = account.flatformType === 'zalo'
        ? this.getZaloRuntimeStopReason(campaign.id)
        : null
      if (postTargetRuntimeStopReason) {
        if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
        if (detail) {
          await this.supabase.updateCampaignInputData(detail.id, {
            status: 'hoàn thành',
            note: this.getZaloRuntimeUncertainNote(postTargetRuntimeStopReason)
          })
          if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          consumedGroupPostInputDataIds.add(detail.id)
        }
        await this.updateCampaignAndBroadcast(campaign.id, {
          status: 'chờ xử lý',
          note: this.getZaloRuntimeCampaignStopNote(postTargetRuntimeStopReason)
        })
        shouldCompletePauseAfterTarget = false
        shouldStopAfterTarget = true
      }

      // The target and every secondary group-share result are now fully
      // recorded. Settle before pause/stop/sleep/finalization so unused leased
      // candidates return to pending while the campaign is still running.
      if (!await this.settleActiveCampaignRunUnit(account, campaign)) return

      if (shouldCompletePauseAfterTarget) {
        await this.completePauseAtBoundary(account, campaign)
        return
      }

      if (shouldStopAfterTarget) {
        stoppedBeforeCompletion = true
        break
      }

      // Sleep between details
      if (i < targets.length - 1) {
        const sleepTime = this.getEffectiveSleepBetweenActions(account, limitConfig)
        if (sleepTime > 0) {
          await this.logCampaignProgress(campaign.id, `⏳ Nghỉ ${sleepTime}s trước khi xử lý mục tiếp theo...`)
          const sleepResult = await this.sleepBetweenTargets(campaign, sleepTime, account)
          if (sleepResult === 'paused') {
            await this.completePauseAtBoundary(account, campaign)
            return
          }
          if (sleepResult === 'boundary') {
            return
          }
          if (sleepResult === 'stopped') return
        }
      }
    }

    if (!stoppedBeforeCompletion) {
      if (earliestFutureInputSchedule) {
        await this.deferCampaignUntilFutureInput(campaign, earliestFutureInputSchedule)
      } else {
        await this.handleCampaignCompletion(campaign)
      }
    }
    await this.releaseRunningAccount(account.id)
  }

  private shouldUseFacebookGroupInviteBatch(campaign: Campaign): boolean {
    return campaign.actionId === FACEBOOK_GROUP_INVITE_ACTION_ID
  }

  private getFacebookGroupInviteActionDescriptor(
    actionDescriptors: CampaignActionDescriptor[]
  ): CampaignActionDescriptor {
    return actionDescriptors.find(action => action.code === FACEBOOK_GROUP_INVITE_ACTION_CODE) || {
      code: FACEBOOK_GROUP_INVITE_ACTION_CODE,
      name: this.getAccountActionName(FACEBOOK_GROUP_INVITE_ACTION_CODE)
    }
  }

  private async executeFacebookGroupInviteBatchCampaign(
    account: AutoAccount,
    campaign: Campaign,
    workflowId: number,
    details: CampaignInputData[],
    executableActionDescriptors: CampaignActionDescriptor[],
    quotaActionDescriptors: CampaignActionDescriptor[]
  ): Promise<void> {
    const extra = campaign.extraSettings || {}
    const groupUrl = this.firstNonEmptyString(extra.facebookGroupInviteTargetGroupUrl, extra.facebookGroupInviteTargetGroupUid)
    const groupName = this.firstNonEmptyString(extra.facebookGroupInviteTargetGroupName, groupUrl)
    const groupUid = this.firstNonEmptyString(extra.facebookGroupInviteTargetGroupUid)

    if (!groupUrl) {
      const note = 'Vui lòng chọn group nhận lời mời trước khi chạy chiến dịch'
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note })
      await this.logCampaignProgress(campaign.id, `⚠️ ${note}`)
      await this.releaseRunningAccount(account.id)
      return
    }

    if (details.length === 0) {
      const note = 'Không có bạn bè cần mời vào group'
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note })
      await this.logCampaignProgress(campaign.id, `⚠️ ${note}`)
      await this.releaseRunningAccount(account.id)
      return
    }

    const actionDescriptor = this.getFacebookGroupInviteActionDescriptor(executableActionDescriptors)
    const shouldCheckQuota = quotaActionDescriptors.some(action => action.code === actionDescriptor.code)
    const limitConfig = extra.actionLimits
    let stoppedBeforeCompletion = false
    let earliestFutureInputSchedule: Date | null = null
    let batchIndex = 0

    while (true) {
      // A group-invite workflow owns one batch as its current unit. Let that
      // unit finish, but never open the next Facebook form after hard end.
      if (await this.finalizeDataGroupCampaignAtHardEnd(campaign)) {
        await this.releaseRunningAccount(account.id)
        return
      }

      const cur = await this.supabase.getCampaign(campaign.id)
      if (this.isCampaignPauseRequested(campaign.id) || (cur && cur.status === 'tạm dừng')) {
        await this.releaseRunningAccount(account.id)
        await this.completeCampaignPause(campaign)
        return
      }

      const accountBlockReason = await this.getAccountRunBlockReason(account.id, 'đang chạy')
      if (accountBlockReason) {
        stoppedBeforeCompletion = true
        await this.stopCampaignForAccountCondition(account, campaign, accountBlockReason)
        await this.releaseRunningAccount(account.id)
        return
      }

      details = await this.supabase.listCampaignInputData(campaign.id)
      const scheduleNow = details.some(detail =>
        detail.status === 'chờ xử lý' && Boolean(detail.schedule)
      )
        ? await this.getDatabaseBusinessNow()
        : null
      const pendingTargets: FacebookGroupInviteTarget[] = []
      earliestFutureInputSchedule = null
      for (const detail of details) {
        if (detail.status !== 'chờ xử lý') continue
        const futureSchedule = detail.schedule && scheduleNow
          ? this.getFutureInputSchedule(detail, scheduleNow)
          : null
        if (futureSchedule) {
          if (!earliestFutureInputSchedule || futureSchedule.getTime() < earliestFutureInputSchedule.getTime()) {
            earliestFutureInputSchedule = futureSchedule
          }
          continue
        }
        pendingTargets.push(this.createFacebookGroupInviteTarget(detail))
      }

      if (pendingTargets.length === 0) break

      if (await this.stopCampaignAtRunBoundaryIfNeeded(account, campaign)) {
        return
      }

      const capacity = await this.getFacebookGroupInviteBatchCapacity(
        account,
        campaign,
        actionDescriptor,
        shouldCheckQuota,
        limitConfig
      )
      if (!capacity.ok || capacity.capacity < 1) {
        stoppedBeforeCompletion = true
        await this.handleLimitStatus(account, campaign, capacity.limitStatus || {
          ok: false,
          actionCode: actionDescriptor.code,
          actionName: actionDescriptor.name,
          reason: `Hành động "${actionDescriptor.name}" đang đạt giới hạn`
        })
        break
      }

      // Limit/quota reads can outlive the schedule boundary. Recheck before
      // handing any target to the batch workflow.
      if (await this.finalizeDataGroupCampaignAtHardEnd(campaign)) {
        await this.releaseRunningAccount(account.id)
        return
      }

      if (await this.stopCampaignBeforeNewUnitIfNeeded(account, campaign)) {
        return
      }

      const batch = pendingTargets.slice(0, FACEBOOK_GROUP_INVITE_BATCH_MAX_SIZE)
      batchIndex += 1
      const outcome = await this.runFacebookGroupInviteBatch(
        account,
        campaign,
        workflowId,
        batch,
        actionDescriptor,
        {
          groupUrl,
          groupName,
          groupUid,
          quotaCapacity: capacity.capacity,
          batchIndex
        }
      )

      if (outcome.paused) {
        await this.releaseRunningAccount(account.id)
        await this.completeCampaignPause(campaign)
        return
      }
      if (outcome.stop) {
        stoppedBeforeCompletion = true
        break
      }
    }

    if (!stoppedBeforeCompletion) {
      if (earliestFutureInputSchedule) {
        await this.deferCampaignUntilFutureInput(campaign, earliestFutureInputSchedule)
      } else {
        await this.handleCampaignCompletion(campaign)
      }
    }
    await this.releaseRunningAccount(account.id)
  }

  private createFacebookGroupInviteTarget(detail: CampaignInputData): FacebookGroupInviteTarget {
    const uid = this.firstNonEmptyString(detail.uid)
    const name = this.firstNonEmptyString(detail.name, uid)
    return {
      detail,
      inputDataId: detail.id,
      name,
      uid,
      url: uid,
      inputData: {
        id: detail.id,
        name: detail.name || '',
        phone: detail.phone || '',
        uid: detail.uid || '',
        email: detail.email || '',
        info1: detail.info1 || '',
        info2: detail.info2 || '',
        info3: detail.info3 || '',
        info4: detail.info4 || '',
        info5: detail.info5 || ''
      }
    }
  }

  private async getFacebookGroupInviteBatchCapacity(
    account: AutoAccount,
    campaign: Campaign,
    actionDescriptor: CampaignActionDescriptor,
    shouldCheckQuota: boolean,
    limitConfig?: CampaignActionLimitSettings
  ): Promise<FacebookGroupInviteCapacity> {
    const disabledStatus = await this.supabase.getAccountActionDisabledStatus(
      account.id,
      actionDescriptor.code,
      actionDescriptor.name
    )
    if (!disabledStatus.ok) return { ok: false, capacity: 0, limitStatus: disabledStatus }
    if (!shouldCheckQuota) return { ok: true, capacity: FACEBOOK_GROUP_INVITE_BATCH_MAX_SIZE }

    const entitlements = await loadCurrentUserEffectiveEntitlements()
    const actionLimitConfig = this.getActionLimitConfig(actionDescriptor.code, limitConfig, account, entitlements)
    const limitStatus = await this.supabase.getAccountRateLimitStatus(
      account.id,
      actionDescriptor.code,
      actionDescriptor.name,
      actionLimitConfig
    )
    if (!limitStatus.ok) return { ok: false, capacity: 0, limitStatus }

    const dailyLimit = limitStatus.dailyLimit ?? actionLimitConfig?.dailyLimit ?? 30
    const dailyActionCount = limitStatus.dailyActionCount ?? 0
    const windowLimit = limitStatus.windowLimit ?? actionLimitConfig?.rateLimitCount ?? 9
    const windowActionCount = limitStatus.windowActionCount ?? 0
    const dailyRemaining = Math.max(0, dailyLimit - dailyActionCount)
    const windowRemaining = Math.max(0, windowLimit - windowActionCount)
    const capacity = Math.min(FACEBOOK_GROUP_INVITE_BATCH_MAX_SIZE, dailyRemaining, windowRemaining)

    if (capacity < 1) {
      return {
        ok: false,
        capacity: 0,
        limitStatus: {
          ok: false,
          actionCode: actionDescriptor.code,
          actionName: actionDescriptor.name,
          currentCount: Math.max(dailyActionCount, windowActionCount),
          limit: Math.min(dailyLimit, windowLimit),
          dailyActionCount,
          dailyLimit,
          windowActionCount,
          windowLimit,
          windowMinutes: limitStatus.windowMinutes,
          reason: `Hành động "${actionDescriptor.name}" không còn quota để mời vào group`
        }
      }
    }

    return { ok: true, capacity }
  }

  private async runFacebookGroupInviteBatch(
    account: AutoAccount,
    campaign: Campaign,
    workflowId: number,
    batch: FacebookGroupInviteTarget[],
    actionDescriptor: CampaignActionDescriptor,
    options: {
      groupUrl: string
      groupName: string
      groupUid: string
      quotaCapacity: number
      batchIndex: number
    }
  ): Promise<FacebookGroupInviteBatchRunOutcome> {
    const automationPage = await this.getAutomationPage(account, campaign.id)
    const page = automationPage.page
    if (!page) throw new Error('Facebook - Mời vào group cần browser page')

    await this.logCampaignProgress(
      campaign.id,
      `▶️ Đang mời ${batch.length} bạn bè vào group "${options.groupName}"`
    )

    const abort = new AbortController()
    let accountStopReason: string | null = null
    const accountGuard = setInterval(() => {
      void (async () => {
        if (accountStopReason || abort.signal.aborted) return
        const reason = await this.getAccountRunBlockReason(account.id, 'đang chạy')
        if (reason) {
          accountStopReason = reason
          abort.abort()
        }
      })().catch(err => {
        console.error('Account run guard error:', err)
      })
    }, 5000)
    this.activeV2Aborts.set(campaign.id, abort)
    if (account.flatformType === 'zalo' && this.zaloRuntimeBlockedForRestart) abort.abort()
    if (automationPage.source === 'background') {
      this.startBackgroundPreview(account.id, campaign.id, page)
    }

    const screenshotProgressLogs: BlockScreenshotProgressLog[] = []
    try {
      const variables = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        accountId: account.id,
        facebookGroupInviteTargetGroupUrl: options.groupUrl,
        facebookGroupInviteTargetGroupName: options.groupName,
        facebookGroupInviteTargetGroupUid: options.groupUid,
        facebookGroupInviteQuotaCapacity: options.quotaCapacity,
        facebookGroupInviteTargets: batch.map(item => ({
          inputDataId: item.inputDataId,
          name: item.name,
          uid: item.uid,
          url: item.url,
          inputData: item.inputData
        }))
      }
      if (!await this.beginCampaignRunUnit(
        account,
        campaign,
        batch.map(item => item.inputDataId),
        { requeueRemainingOnSettle: true }
      )) {
        return { stop: true }
      }
      const runtimeHelpers = this.createBlockRuntimeHelpers(account, campaign, null, page)
      const result = await this.engineV2.run(workflowId, variables, page, {
        organizationId: campaign.organizationId ?? account.organizationId ?? null,
        accountId: account.id,
        campaignId: campaign.id,
        signal: abort.signal,
        persist: true,
        runtimeHelpers,
        onBlockScreenshot: async (request, screenshotPage) => {
          const progressLog = await this.recordBlockScreenshotEvent(account, campaign, null, request, screenshotPage)
          if (progressLog) screenshotProgressLogs.push(progressLog)
        },
        onStepProgress: (step: RunStepV2) => {
          try { this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_PROGRESS, { runKey: `campaign-${campaign.id}`, step }) } catch {}
        },
        onLog: (entry) => {
          try { this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_LOG, { runKey: `campaign-${campaign.id}`, ...entry }) } catch {}
        }
      })

      const pauseCancelledRun = this.isCampaignPauseRequested(campaign.id) && !accountStopReason && result.status === 'cancelled'
      if (pauseCancelledRun) return { stop: true, paused: true }
      if (accountStopReason) {
        await this.stopCampaignForAccountCondition(account, campaign, accountStopReason)
        return { stop: true }
      }

      const output = this.getFacebookGroupInviteOutput(result)
      if (result.status !== 'completed' || !output) {
        const errMsg = result.error || output?.error || 'Lỗi mời bạn bè vào group'
        return await this.handleFacebookGroupInviteBatchRuntimeError(
          account,
          campaign,
          actionDescriptor,
          errMsg,
          result.runId ? String(result.runId) : undefined,
          options
        )
      }

      return await this.processFacebookGroupInviteOutput(
        account,
        campaign,
        batch,
        actionDescriptor,
        output,
        result.runId ? String(result.runId) : undefined,
        options
      )
    } catch (err: any) {
      if (this.isCampaignPauseRequested(campaign.id) && abort.signal.aborted && !accountStopReason) {
        return { stop: true, paused: true }
      }
      if (accountStopReason) {
        await this.stopCampaignForAccountCondition(account, campaign, accountStopReason)
        return { stop: true }
      }
      const errMsg = err?.message || String(err)
      return await this.handleFacebookGroupInviteBatchRuntimeError(
        account,
        campaign,
        actionDescriptor,
        errMsg,
        undefined,
        options
      )
    } finally {
      clearInterval(accountGuard)
      if (automationPage.source === 'background') {
        this.stopBackgroundPreview(account.id, campaign.id)
      }
      this.activeV2Aborts.delete(campaign.id)
      if (!await this.settleActiveCampaignRunUnit(account, campaign)) {
        throw new CampaignRunUnitOwnershipLostError(campaign.id)
      }
      while (screenshotProgressLogs.length > 0) {
        const progressLog = screenshotProgressLogs.shift()
        if (!progressLog) continue
        await this.logCampaignProgress(campaign.id, progressLog.storedMessage, {
          realtimeMessage: progressLog.realtimeMessage,
          realtimeAction: progressLog.action
        })
      }
    }
  }

  private getFacebookGroupInviteOutput(result: Awaited<ReturnType<WorkflowEngineV2['run']>>): FacebookGroupInviteBlockOutput | null {
    const stepOutput = [...result.steps]
      .reverse()
      .find(step => step.blockName === 'fb_group_invite' && step.status === 'success')
      ?.output as FacebookGroupInviteBlockOutput | undefined
    const output = (result.output && Object.keys(result.output).length > 0
      ? result.output
      : stepOutput) as FacebookGroupInviteBlockOutput | undefined
    if (!output || typeof output !== 'object') return null
    return output
  }

  private async handleFacebookGroupInviteBatchRuntimeError(
    account: AutoAccount,
    campaign: Campaign,
    actionDescriptor: CampaignActionDescriptor,
    message: string,
    runId: string | undefined,
    options: {
      groupUrl: string
      groupName: string
      groupUid: string
      quotaCapacity: number
      batchIndex: number
    }
  ): Promise<FacebookGroupInviteBatchRunOutcome> {
    const runtimeError = this.normalizeRuntimeError(campaign, [], message)
    await this.supabase.createCampaignDetail({
      campaignId: campaign.id,
      accountId: account.id,
      actionCode: actionDescriptor.code,
      actionName: actionDescriptor.name,
      status: 'lỗi',
      errorCode: runtimeError.errorCode,
      log: message,
      data: {
        groupUrl: options.groupUrl,
        groupName: options.groupName,
        groupUid: options.groupUid,
        batchIndex: options.batchIndex,
        runId
      },
      shouldCountAction: false
    })
    const note = message || 'Lỗi mở form mời vào group'
    await this.updateCampaignAndBroadcast(campaign.id, { status: 'tạm dừng', note })
    await this.logCampaignProgress(campaign.id, `⏸ Tạm dừng chiến dịch "${campaign.name}" vì lỗi mời vào group: ${note}`)
    return { stop: true }
  }

  private async processFacebookGroupInviteOutput(
    account: AutoAccount,
    campaign: Campaign,
    batch: FacebookGroupInviteTarget[],
    actionDescriptor: CampaignActionDescriptor,
    output: FacebookGroupInviteBlockOutput,
    runId: string | undefined,
    options: {
      groupUrl: string
      groupName: string
      groupUid: string
      quotaCapacity: number
      batchIndex: number
    }
  ): Promise<FacebookGroupInviteBatchRunOutcome> {
    const targetById = new Map(batch.map(item => [item.inputDataId, item]))
    const rawResults = Array.isArray(output.results) ? output.results : []
    let processedCount = 0
    let successCount = 0
    let alreadyInvitedCount = 0
    let alreadyMemberCount = 0
    let notFoundCount = 0
    let errorCount = 0
    let retryPendingCount = 0
    let submitErrorMessage = ''
    let stop = false

    for (const raw of rawResults) {
      const inputDataId = Number(raw.inputDataId)
      if (!Number.isFinite(inputDataId)) continue
      const target = targetById.get(inputDataId)
      if (!target) continue

      const status = this.normalizeFacebookGroupInviteDetailStatus(raw, output)
      const message = this.getFacebookGroupInviteDetailMessage(status, raw, target, options.groupName)
      const shouldCountAction = status === 'thành công' && raw.countsTowardLimit !== false
      const errorCode = status === 'lỗi' ? 'err_undefined' : undefined
      const submitFailedSelected = output.submitOk === false && raw.selected === true

      if (submitFailedSelected) {
        submitErrorMessage = submitErrorMessage || message
        await this.supabase.updateCampaignInputData(inputDataId, {
          status: 'chờ xử lý',
          note: message
        })
        retryPendingCount += 1
        continue
      }

      await this.supabase.createCampaignDetail({
        inputDataId,
        campaignId: campaign.id,
        accountId: account.id,
        actionCode: actionDescriptor.code,
        actionName: actionDescriptor.name,
        status,
        errorCode,
        log: message,
        data: {
          groupUrl: options.groupUrl,
          groupName: options.groupName,
          groupUid: options.groupUid,
          target: {
            inputDataId,
            name: target.name,
            uid: target.uid,
            url: target.url
          },
          selected: raw.selected === true,
          submitOk: output.submitOk === true,
          runId,
          rawResult: raw as Record<string, unknown>
        },
        shouldCountAction
      })
      await this.supabase.updateCampaignInputData(inputDataId, {
        status: 'hoàn thành',
        dateAction: new Date().toISOString(),
        note: status === 'thành công' ? '' : message
      })

      processedCount += 1
      if (status === 'thành công') {
        successCount += 1
        await this.resetCampaignBadTargetCount(campaign)
      } else if (status === 'đã gửi lời mời') {
        alreadyInvitedCount += 1
        await this.resetCampaignBadTargetCount(campaign)
      } else if (status === 'đã là thành viên') {
        alreadyMemberCount += 1
        await this.resetCampaignBadTargetCount(campaign)
      } else if (status === 'không tồn tại') {
        notFoundCount += 1
        await this.resetCampaignBadTargetCount(campaign)
      } else {
        errorCount += 1
        const handled = await this.handleCampaignBadTarget(
          account,
          campaign,
          inputDataId,
          'err_undefined',
          actionDescriptor.code,
          { message, runId }
        )
        if (handled.triggered) stop = true
      }
    }

    if (processedCount === 0 && retryPendingCount === 0) {
      const message = output.error || output.message || 'Workflow mời vào group không trả về kết quả target'
      await this.handleFacebookGroupInviteBatchRuntimeError(account, campaign, actionDescriptor, message, runId, options)
      return { stop: true }
    }

    await this.logCampaignProgress(
      campaign.id,
      `📨 Kết quả mời vào group: tổng ${processedCount}, thành công ${successCount}, đã mời ${alreadyInvitedCount}, đã là thành viên ${alreadyMemberCount}, không tồn tại ${notFoundCount}, lỗi ${errorCount}, chờ xử lý lại ${retryPendingCount}`
    )

    if (retryPendingCount > 0 && output.submitOk === false) {
      const message = output.error || output.message || submitErrorMessage || 'Lỗi submit lời mời vào group'
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'tạm dừng', note: message })
      await this.logCampaignProgress(campaign.id, `⏸ Tạm dừng chiến dịch "${campaign.name}" vì lỗi submit lời mời vào group: ${message}`)
      stop = true
    }

    if (output.ok === false && errorCount > 0 && !stop) {
      const message = output.error || output.message || 'Lỗi submit lời mời vào group'
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
      await this.logCampaignProgress(campaign.id, `❌ ${message}`)
      stop = true
    }

    return { stop }
  }

  private normalizeFacebookGroupInviteDetailStatus(
    raw: FacebookGroupInviteBlockResult,
    output: FacebookGroupInviteBlockOutput
  ): FacebookGroupInviteDetailStatus {
    const status = String(raw.status || '').trim()
    if (status === 'thành công') return 'thành công'
    if (status === 'đã gửi lời mời') return 'đã gửi lời mời'
    if (status === 'đã là thành viên') return 'đã là thành viên'
    if (status === 'không tồn tại') return 'không tồn tại'
    if (status === 'selected' && output.submitOk === true) return 'thành công'
    return 'lỗi'
  }

  private getFacebookGroupInviteDetailMessage(
    status: FacebookGroupInviteDetailStatus,
    raw: FacebookGroupInviteBlockResult,
    target: FacebookGroupInviteTarget,
    groupName: string
  ): string {
    const rawMessage = String(raw.message || raw.error || '').trim()
    if (rawMessage) return rawMessage
    if (status === 'thành công') return `Đã gửi lời mời vào group "${groupName}" cho "${target.name}"`
    if (status === 'đã gửi lời mời') return `"${target.name}" đã gửi lời mời trước đó`
    if (status === 'đã là thành viên') return `"${target.name}" đã là thành viên của group`
    if (status === 'không tồn tại') return `Không tìm thấy "${target.name}" trong form mời`
    return `Lỗi mời "${target.name}" vào group`
  }

  private shouldUseZaloShareMessageBatch(campaign: Campaign): boolean {
    return (
      !this.isFormattedContentCampaign(campaign) &&
      campaign.extraSettings?.zaloMessageSendMode === ZALO_MESSAGE_SEND_MODE_SHARE &&
      (campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID || campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID)
    )
  }

  private isFormattedContentCampaign(campaign: Campaign): boolean {
    return campaign.extraSettings?.formattedContentEnabled === true && supportsFormattedContent(campaign.actionId)
  }

  private getZaloShareMessageActionDescriptor(
    campaign: Campaign,
    actionDescriptors: CampaignActionDescriptor[]
  ): CampaignActionDescriptor {
    const actionCode = campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
      ? 'zalo_message_group'
      : 'zalo_message_friend'
    return actionDescriptors.find(action => action.code === actionCode) || {
      code: actionCode,
      name: this.getAccountActionName(actionCode)
    }
  }

  private async executeZaloShareMessageBatchCampaign(
    account: AutoAccount,
    campaign: Campaign,
    details: CampaignInputData[],
    executableActionDescriptors: CampaignActionDescriptor[],
    quotaActionDescriptors: CampaignActionDescriptor[],
    zaloFriendBlocklist: ZaloFriendBlocklistContext | null
  ): Promise<void> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    if (this.isServerZaloCampaign(account, campaign) && !this.running) return

    const mediaTempPaths: string[] = []
    try {
      const extra = campaign.extraSettings || {}
      const actionDescriptor = this.getZaloShareMessageActionDescriptor(campaign, executableActionDescriptors)
      const shouldCheckQuota = quotaActionDescriptors.some(action => action.code === actionDescriptor.code)
      const usesAdvancedContent = this.shouldUseAdvancedContent(campaign)
      let simpleAttachments: string[] | null = null
      const isGroup = campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
      const targetKindLabel = isGroup ? 'group Zalo' : 'bạn bè Zalo'

      if (usesAdvancedContent) {
        const advancedContentError = this.getAdvancedContentConfigError(campaign, true)
        if (advancedContentError) {
          await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: advancedContentError })
          await this.logCampaignProgress(campaign.id, `⚠️ ${advancedContentError}`)
          await this.releaseRunningAccount(account.id)
          return
        }
      } else {
        const baseMessage = this.getRawCampaignContentForIndex(campaign, 0)
        simpleAttachments = await this.resolveCampaignMediaForIndex(campaign, 0, false, mediaTempPaths)
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        if (!baseMessage.trim() && simpleAttachments.length === 0) {
          const note = 'Vui lòng nhập nội dung hoặc chọn media để gửi Zalo'
          await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note })
          await this.logCampaignProgress(campaign.id, `⚠️ ${note}`)
          await this.releaseRunningAccount(account.id)
          return
        }
      }

      if (details.length === 0) {
        const note = `Không có ${targetKindLabel} để gửi tin`
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note })
        await this.logCampaignProgress(campaign.id, `⚠️ ${note}`)
        await this.releaseRunningAccount(account.id)
        return
      }

      let zaloFriendBlocklistSkippedCount = 0
      if (zaloFriendBlocklist && campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID) {
        const scheduleNow = details.some(detail =>
          detail.status === 'chờ xử lý' && Boolean(detail.schedule)
        )
          ? await this.getDatabaseBusinessNow()
          : null
        const remainingDetails: CampaignInputData[] = []
        for (const detail of details) {
          if (this.isServerZaloCampaign(account, campaign) && !this.running) return
          if (
            detail.status === 'chờ xử lý' &&
            (!detail.schedule || !scheduleNow || !this.getFutureInputSchedule(detail, scheduleNow)) &&
            this.isZaloFriendBlockedByBlocklist(campaign, detail, zaloFriendBlocklist)
          ) {
            await this.markZaloFriendBlocklistSkipped(campaign, detail, zaloFriendBlocklist, { logProgress: false })
            zaloFriendBlocklistSkippedCount += 1
            continue
          }
          remainingDetails.push(detail)
        }
        details = remainingDetails
      }

      const limitConfig = extra.actionLimits
      let stoppedBeforeCompletion = false
      let earliestFutureInputSchedule: Date | null = null
      let index = 0
      let batchIndex = 0

      while (index < details.length) {
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        if (await this.stopCampaignAtRunBoundaryIfNeeded(account, campaign)) {
          return
        }
        // Zalo forwarding is atomic per batch. A batch that already entered the
        // API may finish, but no new batch may be assembled after hard end.
        if (await this.finalizeDataGroupCampaignAtHardEnd(campaign)) {
          await this.releaseRunningAccount(account.id)
          return
        }
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return

        const loopRuntimeStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (loopRuntimeStopReason) {
          if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          stoppedBeforeCompletion = true
          await this.updateCampaignAndBroadcast(campaign.id, {
            status: 'chờ xử lý',
            note: this.getZaloRuntimeCampaignStopNote(loopRuntimeStopReason)
          })
          break
        }
        const serverBoundary = await this.getServerZaloBoundaryReason(account, campaign)
        const cur = serverBoundary.paused ? null : await this.supabase.getCampaign(campaign.id)
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        if (
          serverBoundary.paused ||
          this.isCampaignPauseRequested(campaign.id) ||
          (cur && cur.status === 'tạm dừng')
        ) {
          await this.completePauseAtBoundary(account, campaign)
          return
        }

        const accountBlockReason = this.isServerZaloCampaign(account, campaign)
          ? serverBoundary.hardStopReason
          : await this.getAccountRunBlockReason(account.id, 'đang chạy')
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        if (accountBlockReason) {
          stoppedBeforeCompletion = true
          await this.stopCampaignForAccountCondition(account, campaign, accountBlockReason)
          await this.releaseRunningAccount(account.id)
          return
        }

        const capacity = await this.getZaloShareMessageBatchCapacity(
          account,
          campaign,
          actionDescriptor,
          shouldCheckQuota,
          limitConfig
        )
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        if (!capacity.ok || capacity.capacity < 1) {
          stoppedBeforeCompletion = true
          await this.handleLimitStatus(account, campaign, capacity.limitStatus || {
            ok: false,
            actionCode: actionDescriptor.code,
            actionName: actionDescriptor.name,
            reason: `Hành động "${actionDescriptor.name}" đang đạt giới hạn`
          })
          break
        }

        const batchCandidates: CampaignInputData[] = []
        const batch: ZaloShareMessageTarget[] = []
        let stopAfterInvalidTarget = false

        while (index < details.length && batchCandidates.length < capacity.capacity) {
          if (this.isServerZaloCampaign(account, campaign) && !this.running) return
          if (await this.stopCampaignAtRunBoundaryIfNeeded(account, campaign)) {
            return
          }
          // Target resolution can take long enough to cross the boundary. Stop
          // building the batch before resolving or reserving another target.
          const targetBusinessNow = this.requiresDataGroupHardEndCheck(campaign)
            ? await this.getDatabaseBusinessNow()
            : undefined
          if (await this.finalizeDataGroupCampaignAtHardEnd(campaign, targetBusinessNow)) {
            await this.releaseRunningAccount(account.id)
            return
          }
          if (this.isServerZaloCampaign(account, campaign) && !this.running) return
          if (this.getZaloRuntimeStopReason(campaign.id)) {
            stoppedBeforeCompletion = true
            break
          }
          const detail = details[index]
          index += 1

          if (detail.status !== 'chờ xử lý') continue
          const inputScheduleNow = detail.schedule
            ? targetBusinessNow || await this.getDatabaseBusinessNow()
            : null
          const futureSchedule = inputScheduleNow
            ? this.getFutureInputSchedule(detail, inputScheduleNow)
            : null
          if (futureSchedule) {
            if (!earliestFutureInputSchedule || futureSchedule.getTime() < earliestFutureInputSchedule.getTime()) {
              earliestFutureInputSchedule = futureSchedule
            }
            continue
          }

          if (this.isZaloFriendBlockedByBlocklist(campaign, detail, zaloFriendBlocklist)) {
            if (this.isServerZaloCampaign(account, campaign) && !this.running) return
            await this.markZaloFriendBlocklistSkipped(campaign, detail, zaloFriendBlocklist!, { logProgress: false })
            zaloFriendBlocklistSkippedCount += 1
            continue
          }

          batchCandidates.push(detail)
        }

        let allowedBatchCandidateIds = new Set(batchCandidates.map(detail => detail.id))
        if (batchCandidates.length > 0 && isRecentDeliveryCooldownEnabled(campaign.actionId, campaign.extraSettings)) {
          try {
            const cooldown = await this.applyRecentDeliveryCooldown(
              account,
              campaign,
              batchCandidates.map(detail => detail.id)
            )
            allowedBatchCandidateIds = cooldown.allowedInputDataIds
            for (const candidate of batchCandidates) {
              if (cooldown.pausedInputDataIds.has(candidate.id)) candidate.status = 'tạm dừng'
            }
            await this.logRecentDeliveryCooldownPauses(campaign, batchCandidates, cooldown)
          } catch (err) {
            const message = `Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: ${getErrorMessage(err) || 'Lỗi không xác định'}`
            await this.releaseClaimedCampaignPreflight(account.id, campaign, message)
            await this.logCampaignProgress(campaign.id, `⚠️ ${message}`).catch(() => {})
            return
          }
        }

        for (const detail of batchCandidates) {
          if (!allowedBatchCandidateIds.has(detail.id)) continue

          const target = this.createZaloShareMessageTarget(campaign, detail)
          if (!target) {
            if (!await this.beginCampaignRunUnit(account, campaign, [detail.id])) return
            stopAfterInvalidTarget = await this.handleInvalidZaloShareMessageTarget(account, campaign, detail, actionDescriptor)
            if (!await this.settleActiveCampaignRunUnit(account, campaign)) return
            if (stopAfterInvalidTarget) break
            continue
          }
          if (campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID) {
            const resolvedTarget = await this.resolveZaloFriendMessageTarget(account, target.target)
            if (this.getZaloRuntimeStopReason(campaign.id)) {
              stoppedBeforeCompletion = true
              break
            }
            if (this.isServerZaloCampaign(account, campaign) && !this.running) return
            await this.upsertZaloResolvedProfileTarget(account, resolvedTarget, campaign.actionId)
            if (this.getZaloRuntimeStopReason(campaign.id)) {
              stoppedBeforeCompletion = true
              break
            }
            batch.push({ ...target, target: resolvedTarget })
          } else {
            batch.push(target)
          }
        }

        const batchBuildStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (batchBuildStopReason) {
          if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          await this.updateCampaignAndBroadcast(campaign.id, {
            status: 'chờ xử lý',
            note: this.getZaloRuntimeCampaignStopNote(batchBuildStopReason)
          })
          break
        }

        if (stopAfterInvalidTarget) {
          stoppedBeforeCompletion = true
          break
        }
        if (batch.length === 0) continue

        const rawBatchMessage = this.getRawCampaignContentForIndex(campaign, batchIndex)
        const batchAttachments = usesAdvancedContent
          ? await this.resolveCampaignMediaForIndex(campaign, batchIndex, false, mediaTempPaths)
          : (simpleAttachments || [])
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        batchIndex += 1
        const message = await this.getZaloShareMessageForBatch(account, campaign, rawBatchMessage)
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        const contentStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (contentStopReason) {
          if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          stoppedBeforeCompletion = true
          await this.updateCampaignAndBroadcast(campaign.id, {
            status: 'chờ xử lý',
            note: this.getZaloRuntimeCampaignStopNote(contentStopReason)
          })
          break
        }

        // Media resolution/AI rewrite may cross hard end. No target in this
        // batch has reached a Zalo send API yet, so finalize before reserving it.
        if (await this.finalizeDataGroupCampaignAtHardEnd(campaign)) {
          await this.releaseRunningAccount(account.id)
          return
        }
        if (this.isServerZaloCampaign(account, campaign) && !this.running) return
        if (!await this.beginCampaignRunUnit(
          account,
          campaign,
          batch.map(item => item.detail.id)
        )) return
        const claimedBatchStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (claimedBatchStopReason) {
          if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          await this.settleZaloShareBatchRuntimeStop(batch, new Set(), claimedBatchStopReason)
          stoppedBeforeCompletion = true
        }
        if (stoppedBeforeCompletion) {
          const prepareStopReason = this.getZaloRuntimeStopReason(campaign.id)
          if (prepareStopReason) {
            if (this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
            await this.updateCampaignAndBroadcast(campaign.id, {
              status: 'chờ xử lý',
              note: this.getZaloRuntimeCampaignStopNote(prepareStopReason)
            })
          }
          if (!await this.settleActiveCampaignRunUnit(account, campaign)) return
          break
        }
        let batchHardStopReason: string | null = null
        let batchControlGuard: ReturnType<typeof setInterval> | null = null
        if (this.isServerZaloCampaign(account, campaign)) {
          let batchControlCheckInFlight = false
          batchControlGuard = setInterval(() => {
            if (batchControlCheckInFlight) return
            batchControlCheckInFlight = true
            void this.supabase.getZaloServerRunControlState(campaign.id, account.id)
              .then(control => {
                if (this.isServerZaloBoundaryRequested(
                  control.campaignStatus,
                  control.accountStatus,
                  control.hardStopReason
                )) {
                  this.latchServerZaloPause(campaign.id, control.campaignStatus, control.accountStatus)
                } else if (control.hardStopReason) {
                  batchHardStopReason = this.getServerZaloHardStopMessage(control.hardStopReason)
                }
              })
              .catch(err => console.error('Zalo Server batch control guard error:', err))
              .finally(() => { batchControlCheckInFlight = false })
          }, 5000)
        }
        let stopAfterBatch = false
        try {
          stopAfterBatch = await this.processZaloShareMessageBatch(
            account,
            campaign,
            batch,
            actionDescriptor,
            message,
            batchAttachments
          )
        } finally {
          if (batchControlGuard) clearInterval(batchControlGuard)
        }
        if (!await this.settleActiveCampaignRunUnit(account, campaign)) return
        const postBatchControl = await this.getServerZaloBoundaryReason(account, campaign)
        if (postBatchControl.paused) {
          await this.completePauseAtBoundary(account, campaign)
          return
        }
        if (batchHardStopReason || postBatchControl.hardStopReason) {
          stoppedBeforeCompletion = true
          await this.stopCampaignForAccountCondition(
            account,
            campaign,
            batchHardStopReason || postBatchControl.hardStopReason || 'Trạng thái Zalo Server không còn hợp lệ'
          )
          break
        }
        const processedStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (stopAfterBatch || processedStopReason) {
          if (processedStopReason && this.isZaloRuntimeWriteBarrierActive(campaign.id)) return
          stoppedBeforeCompletion = true
          if (processedStopReason) {
            await this.updateCampaignAndBroadcast(campaign.id, {
              status: 'chờ xử lý',
              note: this.getZaloRuntimeCampaignStopNote(processedStopReason)
            })
          }
          break
        }

        if (
          index < details.length &&
          await this.stopCampaignAtRunBoundaryIfNeeded(account, campaign)
        ) {
          return
        }

        // The current batch has been fully recorded. Check hard end before a
        // delay or the next batch so no later target starts past the boundary.
        if (await this.finalizeDataGroupCampaignAtHardEnd(campaign)) {
          await this.releaseRunningAccount(account.id)
          return
        }

        if (index < details.length) {
          const sleepTime = this.getEffectiveSleepBetweenActions(account, limitConfig)
          if (sleepTime > 0) {
            const sleepResult = await this.sleepBetweenTargets(campaign, sleepTime, account)
            if (sleepResult === 'paused') {
              await this.completePauseAtBoundary(account, campaign)
              return
            }
            if (sleepResult === 'boundary') {
              return
            }
            if (sleepResult === 'stopped') return
          }
        }
      }

      if (zaloFriendBlocklistSkippedCount > 0) {
        await this.logCampaignProgress(campaign.id, `🚫 Đã bỏ qua ${zaloFriendBlocklistSkippedCount} bạn bè Zalo trong danh sách không gửi tin`)
      }
      if (!stoppedBeforeCompletion) {
        if (earliestFutureInputSchedule) {
          await this.deferCampaignUntilFutureInput(campaign, earliestFutureInputSchedule)
        } else {
          await this.handleCampaignCompletion(campaign)
        }
      }
      await this.releaseRunningAccount(account.id)
    } catch (err) {
      if (this.isCampaignMediaResolveError(err)) {
        await this.pauseCampaignForMediaError(campaign, null, err)
        await this.releaseRunningAccount(account.id)
        return
      }
      throw err
    } finally {
      this.cleanupCampaignMediaTempFiles(mediaTempPaths)
    }
  }

  private async getZaloShareMessageBatchCapacity(
    account: AutoAccount,
    campaign: Campaign,
    actionDescriptor: CampaignActionDescriptor,
    shouldCheckQuota: boolean,
    limitConfig?: CampaignActionLimitSettings
  ): Promise<ZaloShareMessageCapacity> {
    const disabledStatus = await this.supabase.getAccountActionDisabledStatus(
      account.id,
      actionDescriptor.code,
      actionDescriptor.name
    )
    if (!disabledStatus.ok) return { ok: false, capacity: 0, limitStatus: disabledStatus }
    if (!shouldCheckQuota) return { ok: true, capacity: ZALO_SHARE_MESSAGE_BATCH_SIZE }

    const entitlements = await loadCurrentUserEffectiveEntitlements()
    const actionLimitConfig = this.getActionLimitConfig(actionDescriptor.code, limitConfig, account, entitlements)
    const limitStatus = await this.supabase.getAccountRateLimitStatus(
      account.id,
      actionDescriptor.code,
      actionDescriptor.name,
      actionLimitConfig
    )
    if (!limitStatus.ok) return { ok: false, capacity: 0, limitStatus }

    const dailyLimit = limitStatus.dailyLimit ?? actionLimitConfig?.dailyLimit ?? 30
    const dailyActionCount = limitStatus.dailyActionCount ?? 0
    const windowLimit = limitStatus.windowLimit ?? actionLimitConfig?.rateLimitCount ?? 9
    const windowActionCount = limitStatus.windowActionCount ?? 0
    const dailyRemaining = Math.max(0, dailyLimit - dailyActionCount)
    const windowRemaining = Math.max(0, windowLimit - windowActionCount)
    const capacity = Math.min(ZALO_SHARE_MESSAGE_BATCH_SIZE, dailyRemaining, windowRemaining)

    if (capacity < 1) {
      return {
        ok: false,
        capacity: 0,
        limitStatus: {
          ok: false,
          actionCode: actionDescriptor.code,
          actionName: actionDescriptor.name,
          currentCount: Math.max(dailyActionCount, windowActionCount),
          limit: Math.min(dailyLimit, windowLimit),
          dailyActionCount,
          dailyLimit,
          windowActionCount,
          windowLimit,
          windowMinutes: limitStatus.windowMinutes,
          reason: `Hành động "${actionDescriptor.name}" không còn quota để gửi batch`
        }
      }
    }

    return { ok: true, capacity }
  }

  private async getZaloShareMessageForBatch(
    account: AutoAccount,
    campaign: Campaign,
    message: string
  ): Promise<string> {
    const original = this.renderSpinContent(message)
    const content = original.trim()
    if (campaign.extraSettings?.rewriteContentEachRun !== true || !content) {
      return original
    }

    try {
      const result = await callAiUsing(ZALO_MESSAGE_REWRITE_AI_CODE, {
        content,
        question: content,
        source: 'aka_agent'
      }, {
        organizationId: campaign.organizationId ?? account.organizationId ?? null,
        accountId: account.id,
        campaignId: campaign.id
      })

      if (!result.ok) {
        throw new Error(result.error || 'AI lỗi')
      }

      const rewritten = String(result.content || '').trim()
      if (!rewritten) {
        throw new Error('AI trả về nội dung không hợp lệ.')
      }
      return rewritten
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[CampaignScheduler] Zalo share AI rewrite failed, using original content', {
        campaignId: campaign.id,
        accountId: account.id,
        message
      })
      return original
    }
  }

  private createZaloShareMessageTarget(
    campaign: Campaign,
    detail: CampaignInputData
  ): ZaloShareMessageTarget | null {
    const threadId = this.getZaloShareMessageThreadId(campaign, detail)
    if (!threadId) return null
    const inputData = this.buildZaloShareInputData(detail)
    const target = this.normalizeZaloTargetFromInputData(
      threadId,
      detail.name,
      inputData,
      campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID ? { type: 'group' } : undefined,
      campaign.actionId !== ZALO_MESSAGE_GROUP_ACTION_ID
    )
    return { detail, target, threadId, inputData }
  }

  private getZaloShareMessageThreadId(campaign: Campaign, detail: CampaignInputData): string {
    const raw = this.firstNonEmptyString(detail.uid)
    return campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
      ? raw.replace(/^g/i, '')
      : raw
  }

  private buildZaloShareInputData(detail: CampaignInputData): Record<string, unknown> {
    return {
      id: detail.id,
      name: detail.name || '',
      phone: detail.phone || '',
      uid: detail.uid || '',
      email: detail.email || '',
      info1: detail.info1 || '',
      info2: detail.info2 || '',
      info3: detail.info3 || '',
      info4: detail.info4 || '',
      info5: detail.info5 || ''
    }
  }

  private async handleInvalidZaloShareMessageTarget(
    account: AutoAccount,
    campaign: Campaign,
    detail: CampaignInputData,
    actionDescriptor: CampaignActionDescriptor
  ): Promise<boolean> {
    const isGroup = campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
    const rawMessage = isGroup ? 'ID group Zalo không hợp lệ' : 'UID bạn bè Zalo không hợp lệ'
    const actionDetail = await this.createZaloPolicyDetailFromCode(
      account,
      campaign,
      await this.supabase.getZaloErrorPolicyByCode('114'),
      rawMessage,
      actionDescriptor.code,
      actionDescriptor.name,
      '114',
      { inputData: this.buildZaloShareInputData(detail) }
    )
    await this.recordZaloShareActionDetail(campaign, detail, account.id, actionDetail)
    await this.updateZaloShareInputStatus(detail, actionDetail)
    if (actionDetail.stopAfterTarget) return true
    return false
  }

  private async processZaloShareMessageBatch(
    account: AutoAccount,
    campaign: Campaign,
    batch: ZaloShareMessageTarget[],
    actionDescriptor: CampaignActionDescriptor,
    message: string,
    attachments: string[]
  ): Promise<boolean> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const initialStopReason = this.getZaloRuntimeStopReason(campaign.id)
    if (initialStopReason) {
      await this.settleZaloShareBatchRuntimeStop(batch, new Set(), initialStopReason)
      return true
    }

    const isGroup = campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
    const trimmedMessage = String(message || '').trim()
    const mediaFailures = new Map<number, ZaloActionDetailOutput>()
    const mediaResponses = new Map<number, unknown>()
    const startedInputDataIds = new Set<number>()

    try {
      if (attachments.length > 0) {
        for (const item of batch) {
          const beforeSendStopReason = this.getZaloRuntimeStopReason(campaign.id)
          if (beforeSendStopReason) {
            await this.settleZaloShareBatchRuntimeStop(batch, startedInputDataIds, beforeSendStopReason)
            return true
          }

          startedInputDataIds.add(item.detail.id)
          let response: unknown = null
          let sendError: unknown = null
          try {
            response = isGroup
              ? await this.zaloRuntime.sendMessageToGroup(account.id, item.threadId, '', attachments)
              : await this.zaloRuntime.sendMessageToUser(account.id, item.threadId, '', attachments)
          } catch (err) {
            sendError = err
          }

          // The request may have reached Zalo even when shutdown/mode-change won
          // the race with its response. Do not derive a success/error detail or
          // start another API call from this obsolete runtime.
          const afterSendStopReason = this.getZaloRuntimeStopReason(campaign.id)
          if (afterSendStopReason) {
            await this.settleZaloShareBatchRuntimeStop(batch, startedInputDataIds, afterSendStopReason)
            return true
          }

          if (sendError) {
            mediaFailures.set(item.detail.id, await this.createZaloErrorDetail(
              account,
              campaign,
              sendError,
              actionDescriptor.code,
              actionDescriptor.name,
              { target: item.target, threadId: item.threadId, attachments, inputData: item.inputData, sendMode: 'share_media' }
            ))
          } else {
            mediaResponses.set(item.detail.id, response)
          }

          const afterMediaDetailStopReason = this.getZaloRuntimeStopReason(campaign.id)
          if (afterMediaDetailStopReason) {
            await this.settleZaloShareBatchRuntimeStop(batch, startedInputDataIds, afterMediaDetailStopReason)
            return true
          }
        }
      }

      let forwardResult: ZaloForwardMessageResult | null = null
      let forwardError: unknown = null
      const textBatch = batch.filter(item => !mediaFailures.has(item.detail.id))
      if (trimmedMessage && textBatch.length > 0) {
        const beforeForwardStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (beforeForwardStopReason) {
          await this.settleZaloShareBatchRuntimeStop(batch, startedInputDataIds, beforeForwardStopReason)
          return true
        }
        textBatch.forEach(item => startedInputDataIds.add(item.detail.id))
        try {
          forwardResult = isGroup
            ? await this.zaloRuntime.forwardMessageToGroups(account.id, textBatch.map(item => item.threadId), trimmedMessage)
            : await this.zaloRuntime.forwardMessageToUsers(account.id, textBatch.map(item => item.threadId), trimmedMessage)
        } catch (err) {
          forwardError = err
        }

        const afterForwardStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (afterForwardStopReason) {
          await this.settleZaloShareBatchRuntimeStop(batch, startedInputDataIds, afterForwardStopReason)
          return true
        }
      }

      let stopAfterBatch = false
      let shareSuccessCount = 0
      let shareFailCount = 0
      for (const item of batch) {
        const beforeDetailStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (beforeDetailStopReason) {
          await this.settleZaloShareBatchRuntimeStop(batch, startedInputDataIds, beforeDetailStopReason)
          return true
        }

        const mediaFailure = mediaFailures.get(item.detail.id)
        let actionDetail: ZaloActionDetailOutput
        let forwardTargetResult: ZaloForwardMessageTargetResult | null = null

        if (mediaFailure) {
          actionDetail = mediaFailure
        } else if (forwardError) {
          actionDetail = await this.createZaloErrorDetail(
            account,
            campaign,
            forwardError,
            actionDescriptor.code,
            actionDescriptor.name,
            { target: item.target, threadId: item.threadId, message: trimmedMessage, attachments, inputData: item.inputData, sendMode: 'share_text' }
          )
        } else if (trimmedMessage) {
          forwardTargetResult = this.findZaloForwardTargetResult(forwardResult, item.threadId)
          actionDetail = forwardTargetResult?.ok
            ? this.createZaloShareSuccessDetail(actionDescriptor, item, trimmedMessage, attachments, mediaResponses.get(item.detail.id), forwardResult?.response)
            : await this.createZaloForwardFailureDetail(account, campaign, actionDescriptor, item, forwardTargetResult, trimmedMessage, attachments, forwardResult?.response)
        } else {
          actionDetail = this.createZaloShareSuccessDetail(actionDescriptor, item, '', attachments, mediaResponses.get(item.detail.id), null)
        }

        if (
          trimmedMessage &&
          mediaResponses.has(item.detail.id) &&
          actionDetail.status !== 'thành công'
        ) {
          const forwardFailure = forwardError || {
            message: forwardTargetResult?.errorMessage || 'Chia sẻ tin nhắn Zalo thất bại',
            code: forwardTargetResult?.errorCode
          }
          const mediaResponse = mediaResponses.get(item.detail.id)
          actionDetail = this.finalizeZaloPartialSendDetail(
            actionDetail,
            {
              target: item.target,
              threadId: item.threadId,
              message: trimmedMessage,
              attachments,
              inputData: item.inputData,
              sendMode: 'share',
              mediaResponse,
              forwardTargetResult: forwardTargetResult || undefined,
              forwardResponse: forwardResult?.response as Record<string, unknown> | undefined
            },
            {
              stage: 'content_after_media',
              sequence: 'media_then_content',
              mediaResponse,
              contentResponse: forwardTargetResult || forwardResult?.response,
              error: this.getZaloErrorMessage(forwardFailure)
            }
          )
        }

        const created = await this.recordZaloShareActionDetail(campaign, item.detail, account.id, actionDetail)
        const afterRecordStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (afterRecordStopReason) {
          await this.settleZaloShareBatchRuntimeStop(batch, startedInputDataIds, afterRecordStopReason)
          return true
        }
        await this.updateZaloShareInputStatus(item.detail, actionDetail)

        const afterInputUpdateStopReason = this.getZaloRuntimeStopReason(campaign.id)
        if (afterInputUpdateStopReason) {
          await this.settleZaloShareBatchRuntimeStop(batch, startedInputDataIds, afterInputUpdateStopReason)
          return true
        }

        if (actionDetail.stopAfterTarget) {
          stopAfterBatch = true
        }

        const createdStatus = created?.status || actionDetail.status
        if (createdStatus === 'thành công') {
          shareSuccessCount += 1
          await this.resetCampaignBadTargetCount(campaign)
        } else {
          shareFailCount += 1
        }
      }

      await this.logCampaignProgress(
        campaign.id,
        `📨 Kết quả chia sẻ tin nhắn Zalo: tổng ${batch.length}, thành công ${shareSuccessCount}, thất bại ${shareFailCount}`
      )

      return stopAfterBatch
    } catch (err) {
      const runtimeStopReason = this.getZaloRuntimeStopReason(campaign.id)
      if (runtimeStopReason) {
        await this.settleZaloShareBatchRuntimeStop(batch, startedInputDataIds, runtimeStopReason)
        return true
      }
      throw err
    }
  }

  private async settleZaloShareBatchRuntimeStop(
    batch: ZaloShareMessageTarget[],
    startedInputDataIds: Set<number>,
    reason: ZaloRuntimeStopReason
  ): Promise<void> {
    if (this.zaloRuntimeClaimsAbandoned) return
    const uncertainNote = this.getZaloRuntimeUncertainNote(reason)
    for (const item of batch) {
      if (this.zaloRuntimeClaimsAbandoned) return
      if (startedInputDataIds.has(item.detail.id)) {
        await this.supabase.updateCampaignInputData(item.detail.id, {
          status: 'hoàn thành',
          note: uncertainNote
        })
        if (this.zaloRuntimeClaimsAbandoned) return
      } else {
        // This target was reserved for the batch but no Zalo API call started,
        // so it is safe for the next runtime to process it.
        await this.supabase.updateCampaignInputData(item.detail.id, {
          status: 'chờ xử lý'
        })
        if (this.zaloRuntimeClaimsAbandoned) return
      }
    }
  }

  private findZaloForwardTargetResult(
    forwardResult: ZaloForwardMessageResult | null,
    threadId: string
  ): ZaloForwardMessageTargetResult | null {
    return forwardResult?.results.find(item => item.threadId === threadId) || null
  }

  private createZaloShareSuccessDetail(
    actionDescriptor: CampaignActionDescriptor,
    item: ZaloShareMessageTarget,
    message: string,
    attachments: string[],
    mediaResponse: unknown,
    forwardResponse: unknown
  ): ZaloActionDetailOutput {
    const isGroup = actionDescriptor.code === 'zalo_message_group'
    return this.createZaloSuccessDetail({
      actionCode: actionDescriptor.code,
      actionName: actionDescriptor.name,
      log: isGroup
        ? `Đã chia sẻ tin nhắn vào group ${this.getZaloTargetLabel(item.target)}`
        : `Đã chia sẻ tin nhắn đến ${this.getZaloTargetLabel(item.target)}`,
      data: {
        target: item.target,
        threadId: item.threadId,
        message,
        attachments,
        sendMode: 'share',
        mediaResponse: mediaResponse as Record<string, unknown> | undefined,
        forwardResponse: forwardResponse as Record<string, unknown> | undefined
      }
    })
  }

  private async createZaloForwardFailureDetail(
    account: AutoAccount,
    campaign: Campaign,
    actionDescriptor: CampaignActionDescriptor,
    item: ZaloShareMessageTarget,
    targetResult: ZaloForwardMessageTargetResult | null,
    message: string,
    attachments: string[],
    forwardResponse: unknown
  ): Promise<ZaloActionDetailOutput> {
    const rawMessage = targetResult?.errorMessage || 'Chia sẻ tin nhắn Zalo thất bại'
    const err = {
      message: rawMessage,
      code: targetResult?.errorCode
    }
    return this.createZaloErrorDetail(account, campaign, err, actionDescriptor.code, actionDescriptor.name, {
      target: item.target,
      threadId: item.threadId,
      message,
      attachments,
      sendMode: 'share',
      forwardTargetResult: targetResult || undefined,
      forwardResponse: forwardResponse as Record<string, unknown> | undefined
    })
  }

  private async recordZaloShareActionDetail(
    campaign: Campaign,
    detail: CampaignInputData,
    accountId: number,
    actionDetail: ZaloActionDetailOutput
  ): Promise<CampaignDetail | null> {
    if (actionDetail.createDetail === false || !actionDetail.status) {
      return null
    }

    const created = await this.supabase.createCampaignDetail({
      inputDataId: detail.id,
      campaignId: campaign.id,
      accountId,
      actionCode: actionDetail.actionCode ?? null,
      actionName: actionDetail.actionName || this.getAccountActionName(actionDetail.actionCode || ''),
      status: actionDetail.status,
      errorCode: actionDetail.errorCode ?? null,
      log: actionDetail.log || undefined,
      data: actionDetail.data || {},
      shouldCountAction: actionDetail.countsTowardLimit === true
    })

    return created
  }

  private async updateZaloShareInputStatus(
    detail: CampaignInputData,
    actionDetail: ZaloActionDetailOutput
  ): Promise<void> {
    if (actionDetail.resetInputToPending && !actionDetail.preventInputRetry) {
      await this.supabase.updateCampaignInputData(detail.id, {
        status: 'chờ xử lý',
        note: actionDetail.pendingNote || actionDetail.log || ''
      })
      return
    }

    await this.supabase.updateCampaignInputData(detail.id, {
      status: 'hoàn thành',
      note: actionDetail.status === 'thành công' ? '' : (actionDetail.log || '')
    })
  }

  private shouldUseSuggestedFriends(campaign: Campaign): boolean {
    return campaign.actionId === MESSAGE_UID_ACTION_ID && campaign.extraSettings?.useSuggestedFriends === true
  }

  private getZaloFriendTargetMode(campaign: Campaign): string {
    const mode = String(campaign.extraSettings?.zaloFriendTargetMode || ZALO_FRIEND_TARGET_MODE_SELECTED)
    return ZALO_FRIEND_TARGET_MODES.has(mode) ? mode : ZALO_FRIEND_TARGET_MODE_SELECTED
  }

  private isZaloFriendAutoDataCampaign(campaign: Campaign): boolean {
    const mode = this.getZaloFriendTargetMode(campaign)
    return campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID && mode !== ZALO_FRIEND_TARGET_MODE_SELECTED
  }

  private getZaloFriendBlocklistId(campaign: Campaign): number {
    const id = Number(campaign.extraSettings?.zaloFriendBlocklistId)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }

  private async loadZaloFriendBlocklistContext(
    account: AutoAccount,
    campaign: Campaign
  ): Promise<ZaloFriendBlocklistContext | null> {
    if (
      campaign.actionId !== ZALO_MESSAGE_FRIEND_ACTION_ID ||
      campaign.extraSettings?.zaloFriendBlocklistEnabled !== true
    ) {
      return null
    }

    const groupId = this.getZaloFriendBlocklistId(campaign)
    if (!groupId) {
      return {
        groupId: 0,
        groupName: '',
        uidKeys: new Set(),
        invalidReason: 'Chưa chọn danh sách không gửi tin Zalo'
      }
    }

    try {
      const snapshot = await this.supabase.getZaloFriendBlocklistUidSnapshot(account.id, groupId)
      const uidKeys = new Set(
        snapshot.uids
          .map(uid => this.normalizeUidForCompare(uid))
          .filter(Boolean)
      )
      return {
        groupId: snapshot.group.id,
        groupName: snapshot.group.name,
        uidKeys
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const message = raw.replace(/^Failed to get contact group:\s*/i, '').trim() || 'Danh sách không gửi tin Zalo không hợp lệ'
      return {
        groupId,
        groupName: String(campaign.extraSettings?.zaloFriendBlocklistName || '').trim(),
        uidKeys: new Set(),
        invalidReason: message
      }
    }
  }

  private isZaloFriendBlockedByBlocklist(
    campaign: Campaign,
    detail: CampaignInputData | null | undefined,
    blocklist: ZaloFriendBlocklistContext | null
  ): boolean {
    if (campaign.actionId !== ZALO_MESSAGE_FRIEND_ACTION_ID || !detail || !blocklist || blocklist.invalidReason) return false
    const uid = this.normalizeUidForCompare(this.firstNonEmptyString(detail.uid))
    return Boolean(uid && blocklist.uidKeys.has(uid))
  }

  private async applyRecentDeliveryCooldown(
    account: AutoAccount,
    campaign: Campaign,
    inputDataIds: number[]
  ): Promise<DeliveryCooldownBatchResult> {
    const uniqueIds = [...new Set(inputDataIds)]
    if (!isRecentDeliveryCooldownEnabled(campaign.actionId, campaign.extraSettings)) {
      return {
        allowedInputDataIds: new Set(uniqueIds),
        pausedInputDataIds: new Set(),
        deferredInputDataIds: new Set(),
        pausedNotesByInputDataId: new Map()
      }
    }

    const rows = await this.supabase.applyCampaignDeliveryCooldown(campaign.id, account.id, uniqueIds)
    const returnedIds = new Set(rows.map(row => row.inputDataId))
    if (rows.length !== uniqueIds.length || uniqueIds.some(id => !returnedIds.has(id))) {
      throw new Error('RPC giới hạn gửi/đăng lặp trả về batch không đầy đủ.')
    }

    const allowedInputDataIds = new Set<number>()
    const pausedInputDataIds = new Set<number>()
    const deferredInputDataIds = new Set<number>()
    const pausedNotesByInputDataId = new Map<number, string>()
    for (const row of rows) {
      if (row.decision === 'allowed') {
        allowedInputDataIds.add(row.inputDataId)
      } else if (row.decision === 'paused_recent_delivery' || row.decision === 'paused_unidentifiable') {
        pausedInputDataIds.add(row.inputDataId)
        pausedNotesByInputDataId.set(
          row.inputDataId,
          row.note || 'Tạm dừng vì giới hạn gửi/đăng lặp.'
        )
      } else if (row.decision === 'deferred_batch_duplicate') {
        deferredInputDataIds.add(row.inputDataId)
      } else if (row.decision !== 'not_pending') {
        throw new Error(`RPC giới hạn gửi/đăng lặp trả về quyết định không hợp lệ: ${row.decision}`)
      }
    }

    return {
      allowedInputDataIds,
      pausedInputDataIds,
      deferredInputDataIds,
      pausedNotesByInputDataId
    }
  }

  private getRecentDeliveryCooldownTargetName(
    campaign: Campaign,
    detail: CampaignInputData | null | undefined
  ): string {
    if (!detail) return 'N/A'
    const values = campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID || campaign.actionId === SMS_SEND_ACTION_ID
      ? [detail.phone, detail.name, detail.uid]
      : campaign.actionId === EMAIL_SEND_ACTION_ID
        ? [detail.email, detail.name, detail.uid]
        : [detail.name, detail.uid, detail.phone, detail.email]
    const distinct = values
      .map(value => String(value || '').trim())
      .filter((value, index, all) => value && all.indexOf(value) === index)
    return distinct.slice(0, 2).join(' - ') || 'N/A'
  }

  private async logRecentDeliveryCooldownPauses(
    campaign: Campaign,
    details: Array<CampaignInputData | null | undefined>,
    cooldown: DeliveryCooldownBatchResult
  ): Promise<void> {
    if (cooldown.pausedInputDataIds.size === 0) return
    const detailById = new Map(
      details.filter((detail): detail is CampaignInputData => Boolean(detail))
        .map(detail => [detail.id, detail] as const)
    )
    for (const inputDataId of cooldown.pausedInputDataIds) {
      const rawNote = cooldown.pausedNotesByInputDataId.get(inputDataId) || 'do giới hạn gửi/đăng lặp.'
      const note = rawNote.trim()
        .replace(/^Tạm dừng:\s*/iu, '')
        .replace(/^Tạm dừng vì\s*/iu, '')
        .replace(/\s+(?:Gửi|Đăng) lại từ \d{2}\/\d{2}\/\d{4}\.?$/iu, '') || 'do giới hạn gửi/đăng lặp.'
      const targetName = this.getRecentDeliveryCooldownTargetName(campaign, detailById.get(inputDataId))
      await this.logCampaignProgress(campaign.id, `⏸️ Bỏ qua "${targetName}": ${note}`)
    }
  }

  private async markZaloFriendBlocklistSkipped(
    campaign: Campaign,
    detail: CampaignInputData,
    blocklist: ZaloFriendBlocklistContext,
    options: { logProgress?: boolean } = {}
  ): Promise<void> {
    const groupName = blocklist.groupName || 'danh sách không gửi tin'
    const targetName = this.getInputDataDisplayName(campaign, detail)
    await this.supabase.updateCampaignInputData(detail.id, {
      status: 'hoàn thành',
      note: `Bỏ qua vì nằm trong danh sách không gửi tin: ${groupName}`,
      dateAction: new Date().toISOString()
    })
    if (options.logProgress !== false) {
      await this.logCampaignProgress(campaign.id, `🚫 Bỏ qua "${targetName}" vì nằm trong danh sách không gửi tin: ${groupName}`)
    }
  }

  private isZaloBirthdayCampaign(campaign: Campaign): boolean {
    return campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID
  }

  private isZaloFriendRecommendationCampaign(campaign: Campaign): boolean {
    return campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
  }

  private isZaloCancelSentFriendRequestCampaign(campaign: Campaign): boolean {
    return campaign.actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
  }

  private shouldMaterializeZaloFriendInputData(campaign: Campaign, details: CampaignInputData[]): boolean {
    if (!this.isZaloFriendAutoDataCampaign(campaign)) return false
    if (details.length > 0) return false
    return !campaign.extraSettings?.zaloFriendDataMaterializedAt
  }

  private shouldMaterializeZaloBirthdayInputData(
    campaign: Campaign,
    details: CampaignInputData[],
    businessNow: Date
  ): boolean {
    if (!this.isZaloBirthdayCampaign(campaign)) return false
    if (details.length > 0) return false
    return campaign.extraSettings?.zaloBirthdayDataMaterializedDate !== this.getVietnamDateKey(businessNow)
  }

  private shouldMaterializeZaloFriendRecommendationInputData(campaign: Campaign, details: CampaignInputData[]): boolean {
    if (!this.isZaloFriendRecommendationCampaign(campaign)) return false
    if (details.length > 0) return false
    return !campaign.extraSettings?.zaloFriendRecommendationDataMaterializedAt
  }

  private shouldMaterializeZaloCancelSentFriendRequestInputData(campaign: Campaign, details: CampaignInputData[]): boolean {
    if (!this.isZaloCancelSentFriendRequestCampaign(campaign)) return false
    return details.length === 0 || details.every(detail => detail.status === 'hoàn thành')
  }

  private isBrowserlessCampaign(campaign: Campaign): boolean {
    return this.isZaloBrowserlessCampaign(campaign)
      || campaign.actionId === EMAIL_SEND_ACTION_ID
  }

  private isZaloBrowserlessCampaign(campaign: Campaign): boolean {
    return campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID
      || campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID
      || campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID
      || campaign.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID
      || campaign.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID
      || campaign.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID
      || campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
      || campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
      || campaign.actionId === ZALO_ADD_GROUP_MEMBER_ACTION_ID
      || campaign.actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID
      || campaign.actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
  }

  private getInputDataDisplayName(campaign: Campaign, detail: CampaignInputData | null | undefined, fallback = 'N/A'): string {
    if (!detail) return fallback
    const values = campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID
      ? [detail.phone, detail.name, detail.uid]
      : campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID ||
          campaign.actionId === ZALO_ADD_GROUP_MEMBER_ACTION_ID ||
          campaign.actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID ||
          campaign.actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
        ? [detail.name, detail.uid, detail.phone]
      : campaign.actionId === EMAIL_SEND_ACTION_ID
        ? [detail.email, detail.name, detail.uid]
        : [detail.name, detail.uid, detail.phone]
    for (const value of values) {
      const text = String(value || '').trim()
      if (text) return text
    }
    return fallback
  }

  private async resolveGroupPostApprovalForTarget(
    accountId: number,
    campaign: Campaign,
    detail: CampaignInputData | null
  ): Promise<{
    skipPostByKnownApproval: boolean
    requiresPostApproval: boolean | null
    source: string
  }> {
    const fallback = { skipPostByKnownApproval: false, requiresPostApproval: null, source: '' }
    if (
      campaign.actionId !== 'facebook_group_post' ||
      campaign.extraSettings?.skipPostIfGroupRequiresApproval !== true ||
      !detail?.uid
    ) {
      return fallback
    }

    try {
      const contact = await this.supabase.getGroupContactByTarget(accountId, detail.uid)
      const requiresPostApproval = contact?.requiresPostApproval ?? null
      return {
        skipPostByKnownApproval: requiresPostApproval === true,
        requiresPostApproval,
        source: contact ? 'account_contact' : ''
      }
    } catch (err) {
      console.error('Failed to resolve group post approval status:', err)
      return fallback
    }
  }

  private normalizeGroupPostShareName(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  private getGroupPostShareNameKey(value: unknown): string {
    return this.normalizeGroupPostShareName(value).toLocaleLowerCase('vi-VN')
  }

  private async buildGroupPostShareTargets(
    campaign: Campaign,
    details: CampaignInputData[],
    currentDetail: CampaignInputData | null,
    consumedInputDataIds: Set<number>,
    maxShareCount: number,
    businessNow?: Date
  ): Promise<GroupPostShareTarget[]> {
    if (
      campaign.actionId !== GROUP_POST_ACTION_ID ||
      campaign.extraSettings?.enableGroupPostShareToJoinedGroups !== true ||
      maxShareCount <= 0
    ) {
      return []
    }

    const hasScheduledRunnableDetail = details.some(detail =>
      detail &&
      !detail.isDelete &&
      detail.status === 'chờ xử lý' &&
      !consumedInputDataIds.has(detail.id) &&
      Boolean(detail.schedule)
    )
    const scheduleNow = hasScheduledRunnableDetail
      ? businessNow || await this.getDatabaseBusinessNow()
      : null
    const nameCounts = new Map<string, number>()
    for (const detail of details) {
      if (!detail || detail.isDelete) continue
      const key = this.getGroupPostShareNameKey(detail.name)
      if (!key) continue
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1)
    }

    const runnableDetails = details.filter(detail => {
      if (!detail || detail.isDelete || detail.status !== 'chờ xử lý') return false
      if (consumedInputDataIds.has(detail.id)) return false
      if (detail.schedule && scheduleNow && this.getFutureInputSchedule(detail, scheduleNow)) return false
      return !!this.normalizeGroupPostShareName(detail.name)
    })

    const targets: GroupPostShareTarget[] = []
    for (const detail of runnableDetails) {
      if (currentDetail && detail.id === currentDetail.id) continue
      const name = this.normalizeGroupPostShareName(detail.name)
      const key = this.getGroupPostShareNameKey(name)
      if (!key || (nameCounts.get(key) || 0) > 1) continue
      targets.push({
        id: detail.id,
        name,
        uid: String(detail.uid || '').trim() || undefined
      })
      if (targets.length >= 10) break
    }
    return targets
  }

  private async resolveGroupPostShareQuotaCapacity(
    account: AutoAccount,
    campaign: Campaign,
    limitConfig: CampaignActionLimitSettings | undefined,
    skipMainPost: boolean
  ): Promise<number> {
    if (
      campaign.actionId !== GROUP_POST_ACTION_ID ||
      campaign.extraSettings?.enableGroupPostShareToJoinedGroups !== true ||
      skipMainPost
    ) {
      return 0
    }

    try {
      const actionCode = 'fb_post_group'
      const entitlements = await loadCurrentUserEffectiveEntitlements()
      const actionLimitConfig = this.getActionLimitConfig(actionCode, limitConfig, account, entitlements)
      const limitStatus = await this.supabase.getAccountRateLimitStatus(
        account.id,
        actionCode,
        this.getAccountActionName(actionCode),
        actionLimitConfig
      )
      if (!limitStatus.ok) return 0

      const dailyLimit = Number(limitStatus.dailyLimit ?? actionLimitConfig?.dailyLimit ?? 30)
      const dailyActionCount = Number(limitStatus.dailyActionCount ?? 0)
      const windowLimit = Number(limitStatus.windowLimit ?? actionLimitConfig?.rateLimitCount ?? 9)
      const windowActionCount = Number(limitStatus.windowActionCount ?? limitStatus.currentCount ?? 0)
      const dailyRemaining = Number.isFinite(dailyLimit) ? Math.max(0, dailyLimit - dailyActionCount) : 4
      const windowRemaining = Number.isFinite(windowLimit) ? Math.max(0, windowLimit - windowActionCount) : 4
      const remainingAfterMainPost = Math.min(dailyRemaining, windowRemaining) - 1
      return Math.min(3, Math.max(0, remainingAfterMainPost))
    } catch (err) {
      console.error('Failed to resolve group post share quota capacity:', err)
      return 0
    }
  }

  private normalizeSuggestedFriendsCount(value: unknown): number {
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed)) return 10
    return Math.max(1, parsed)
  }

  private async createMaterializedCampaignInputDataBatch(
    rows: Partial<CampaignInputData>[],
    beforeChunk?: () => void
  ): Promise<void> {
    await this.supabase.createCampaignInputDataBatchWithRollback(rows, beforeChunk)
  }

  private async collectSuggestedFriendInputData(
    account: AutoAccount,
    campaign: Campaign,
    workflowId: number
  ): Promise<CampaignInputData[] | null> {
    const count = this.normalizeSuggestedFriendsCount(campaign.extraSettings?.suggestedFriendsCount)

    await this.logCampaignProgress(campaign.id, `ℹ️ Bắt đầu lấy ${count} đề xuất bạn bè từ Facebook`)

    const automationPage = await this.getAutomationPage(account, campaign.id)
    const page = automationPage.page
    if (!page) throw new Error('Không khởi tạo được trình duyệt cho Facebook')
    const abort = new AbortController()
    this.activeV2Aborts.set(campaign.id, abort)
    if (account.flatformType === 'zalo' && this.zaloRuntimeBlockedForRestart) abort.abort()
    if (automationPage.source === 'background') {
      this.startBackgroundPreview(account.id, campaign.id, page)
    }

    try {
      // Suggested-friend collection is a standalone browser workflow which
      // runs before ordinary input rows exist, so reserve an empty-ID unit at
      // the final point immediately before its external side effects.
      if (!await this.beginCampaignRunUnit(account, campaign, [])) return null
      const result = await this.engineV2.run(workflowId, {
        accountId: account.id,
        campaignId: campaign.id,
        campaignName: campaign.name,
        collectSuggestedFriendsOnly: true,
        count,
        suggestedFriendsCount: count
      }, page, {
        organizationId: campaign.organizationId ?? account.organizationId ?? null,
        accountId: account.id,
        campaignId: campaign.id,
        signal: abort.signal,
        persist: true,
        onStepProgress: (step: RunStepV2) => {
          try { this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_PROGRESS, { runKey: `campaign-${campaign.id}`, step }) } catch {}
        },
        onLog: (entry) => {
          try { this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_LOG, { runKey: `campaign-${campaign.id}`, ...entry }) } catch {}
        }
      })

      if (result.status !== 'completed') {
        throw new Error(result.error || 'Không lấy được đề xuất bạn bè')
      }

      const profiles = this.normalizeSuggestedFriendProfiles(result.output.suggestedProfiles, count)
      if (profiles.length === 0) return []

      await this.createMaterializedCampaignInputDataBatch(
        profiles.map<Partial<CampaignInputData>>(profile => ({
          campaignId: campaign.id,
          name: profile.name,
          uid: profile.uid,
          status: 'chờ xử lý',
          note: ''
        }))
      )

      await this.logCampaignProgress(campaign.id, `✅ Đã thêm ${profiles.length} đề xuất bạn bè vào chiến dịch "${campaign.name}"`)
      return await this.supabase.listCampaignInputData(campaign.id)
    } finally {
      if (automationPage.source === 'background') {
        this.stopBackgroundPreview(account.id, campaign.id)
      }
      this.activeV2Aborts.delete(campaign.id)
      if (!await this.settleActiveCampaignRunUnit(account, campaign)) {
        throw new CampaignRunUnitOwnershipLostError(campaign.id)
      }
    }
  }

  private firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
      const text = String(value ?? '').trim()
      if (text) return text
    }
    return ''
  }

  private normalizeVietnamMobilePhone(value: unknown): string {
    return normalizeSharedVietnamMobilePhone(value)
  }

  private firstNormalizedVietnamMobilePhone(...values: unknown[]): string {
    for (const value of values) {
      const phone = this.normalizeVietnamMobilePhone(value)
      if (phone) return phone
    }
    return ''
  }

  private phoneInputText(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.trunc(value).toString() : ''
    }
    const text = String(value).trim()
    if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
      const parsed = Number(text)
      return Number.isFinite(parsed) ? Math.trunc(parsed).toString() : text
    }
    return text
  }

  private nullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  private stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value
      .map(item => String(item ?? '').trim())
      .filter(Boolean)
  }

  private normalizeZaloGroupInviteLink(value: unknown): string {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    try {
      const url = new URL(withProtocol)
      const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()
      const parts = url.pathname.split('/').filter(Boolean)
      let groupCode = ''
      if (hostname === 'zalo.me' || hostname.endsWith('.zalo.me')) {
        if (parts[0]?.toLowerCase() !== 'g') return ''
        groupCode = parts[1] || ''
      } else if (hostname === 'zaloapp.com' || hostname.endsWith('.zaloapp.com')) {
        if (parts[0]?.toLowerCase() !== 'qr' || parts[1]?.toLowerCase() !== 'g') return ''
        groupCode = parts[2] || ''
      } else {
        return ''
      }
      return groupCode ? `https://zalo.me/g/${groupCode}` : ''
    } catch {
      return ''
    }
  }

  private recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {}
  }

  private getOwnNullableNumber(raw: Record<string, unknown>, ...keys: string[]): number | undefined {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue
      const value = this.nullableNumber(raw[key])
      if (value !== null) return value
    }
    return undefined
  }

  private mapZaloApiRawUserContact(
    accountId: number,
    rawInput: Record<string, unknown>,
    source: string,
    fallbackUid?: string
  ): ZaloUserContactInput | null {
    const raw = this.recordValue(rawInput)
    const zaloUid = this.firstNonEmptyString(raw.userId, raw.uid, raw.id, raw.globalId, fallbackUid)
    if (!zaloUid) return null

    const isFr = this.getOwnNullableNumber(raw, 'isFr', 'is_fr')
    return {
      accountId,
      zaloUid,
      contactSource: source,
      userId: this.firstNonEmptyString(raw.userId) || null,
      username: this.firstNonEmptyString(raw.username) || null,
      displayName: this.firstNonEmptyString(raw.displayName, raw.display_name) || null,
      zaloName: this.firstNonEmptyString(raw.zaloName, raw.zalo_name) || null,
      avatar: this.firstNonEmptyString(raw.avatar) || null,
      bgavatar: this.firstNonEmptyString(raw.bgavatar) || null,
      cover: this.firstNonEmptyString(raw.cover) || null,
      gender: this.nullableNumber(raw.gender),
      dob: this.nullableNumber(raw.dob),
      sdob: this.firstNonEmptyString(raw.sdob) || null,
      status: this.firstNonEmptyString(raw.status) || null,
      phoneNumber: this.firstNonEmptyString(raw.phoneNumber, raw.phone) || null,
      isFr,
      isBlocked: this.nullableNumber(raw.isBlocked),
      lastActionTime: this.nullableNumber(raw.lastActionTime),
      lastUpdateTime: this.nullableNumber(raw.lastUpdateTime),
      isActive: this.nullableNumber(raw.isActive),
      key: this.nullableNumber(raw.key),
      type: this.nullableNumber(raw.type),
      isActivePC: this.nullableNumber(raw.isActivePC),
      isActiveWeb: this.nullableNumber(raw.isActiveWeb),
      isValid: this.nullableNumber(raw.isValid),
      userKey: this.firstNonEmptyString(raw.userKey) || null,
      accountStatus: this.nullableNumber(raw.accountStatus),
      oaInfo: raw.oaInfo,
      userMode: this.nullableNumber(raw.userMode ?? raw.user_mode),
      globalId: this.firstNonEmptyString(raw.globalId) || null,
      bizPkg: raw.bizPkg,
      createdTs: this.nullableNumber(raw.createdTs),
      oaStatus: raw.oaStatus ?? raw.oa_status,
      rawPayload: raw
    }
  }

  private mapZaloApiRawGroupContact(
    accountId: number,
    rawInput: Record<string, unknown>,
    source: string,
    fallbackLink?: string,
    isJoined = true
  ): ZaloGroupContactInput | null {
    const raw = this.recordValue(rawInput)
    const zaloGroupId = this.firstNonEmptyString(raw.groupId, raw.gridId, raw.id)
    if (!zaloGroupId) return null
    const link = this.firstNonEmptyString(raw.link, fallbackLink)
    return {
      accountId,
      zaloGroupId,
      isJoined,
      name: this.firstNonEmptyString(raw.name) || null,
      description: this.firstNonEmptyString(raw.desc, raw.description) || null,
      link: link || null,
      groupType: this.nullableNumber(raw.type),
      creatorUid: this.firstNonEmptyString(raw.creatorId) || null,
      version: this.firstNonEmptyString(raw.version) || null,
      avatar: this.firstNonEmptyString(raw.avt, raw.avatar) || null,
      fullAvatar: this.firstNonEmptyString(raw.fullAvt, raw.fullAvatar) || null,
      memberIds: this.stringArray(raw.memberIds),
      adminIds: this.stringArray(raw.adminIds),
      currentMems: raw.currentMems,
      updateMems: raw.updateMems,
      admins: raw.admins,
      hasMoreMember: this.nullableNumber(raw.hasMoreMember),
      subType: this.nullableNumber(raw.subType),
      totalMember: this.nullableNumber(raw.totalMember),
      maxMember: this.nullableNumber(raw.maxMember),
      setting: raw.setting,
      createdTime: this.nullableNumber(raw.createdTime),
      visibility: this.nullableNumber(raw.visibility),
      globalId: this.firstNonEmptyString(raw.globalId) || null,
      e2ee: this.nullableNumber(raw.e2ee),
      status: this.nullableNumber(raw.status),
      extraInfo: raw.extraInfo,
      memVerList: this.stringArray(raw.memVerList),
      pendingApprove: raw.pendingApprove,
      rawPayload: {
        ...raw,
        source,
        link
      }
    }
  }

  private mapZaloFoundUserContact(
    accountId: number,
    user: ZaloFoundUser,
    source: string
  ): ZaloUserContactInput | null {
    const raw = {
      ...this.recordValue(user.raw),
      uid: user.uid,
      phoneNumber: user.phone,
      displayName: user.displayName,
      zaloName: user.originalName,
      gender: user.gender,
      avatar: user.avatar
    }
    return this.mapZaloApiRawUserContact(accountId, raw, source, user.uid)
  }

  private async upsertZaloApiUserContacts(contacts: Array<ZaloUserContactInput | null>): Promise<void> {
    const validContacts = contacts.filter((contact): contact is ZaloUserContactInput => !!contact)
    if (validContacts.length === 0) return
    await this.supabase.upsertZaloCampaignUserContacts(validContacts)
  }

  private async upsertZaloFoundUserContact(
    account: AutoAccount,
    user: ZaloFoundUser,
    source: string
  ): Promise<void> {
    await this.upsertZaloApiUserContacts([
      this.mapZaloFoundUserContact(account.id, user, source)
    ])
  }

  private async upsertZaloJoinGroupLinkContact(
    account: AutoAccount,
    result: ZaloJoinGroupLinkResult,
    isJoined: boolean
  ): Promise<void> {
    const contact = this.mapZaloApiRawGroupContact(
      account.id,
      result.group,
      ZALO_JOIN_GROUP_LINK_ACTION_ID,
      result.link,
      isJoined
    )
    if (!contact) return
    await this.supabase.upsertZaloGroupContacts([contact], { markMissingDeleted: false })
  }

  private async upsertZaloResolvedProfileTarget(
    account: AutoAccount,
    target: ZaloResolvedTarget,
    source: string
  ): Promise<void> {
    const raw = this.recordValue(target.raw)
    const profile = this.recordValue(raw.profile)
    if (Object.keys(profile).length === 0) return
    await this.upsertZaloApiUserContacts([
      this.mapZaloApiRawUserContact(
        account.id,
        {
          ...profile,
          uid: this.firstNonEmptyString(raw.profileUid, profile.uid, profile.userId)
        },
        source,
        this.firstNonEmptyString(raw.profileUid, target.uid)
      )
    ])
  }

  private getAkaBizTagIdsForCampaign(campaign: Campaign): number[] {
    if (
      campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID ||
      this.shouldUseZaloShareMessageBatch(campaign) ||
      campaign.extraSettings?.enableAkaBizTag !== true
    ) {
      return []
    }

    const seen = new Set<number>()
    const ids: number[] = []
    const rawIds = Array.isArray(campaign.extraSettings?.akaBizTagIds)
      ? campaign.extraSettings.akaBizTagIds
      : []
    for (const rawId of rawIds) {
      const id = Number(rawId)
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    return ids
  }

  private getAkaBizTargetUids(target: ZaloResolvedTarget, contactType: ContactType): string[] {
    const uid = this.firstNonEmptyString(target.uid)
    if (!uid) return []
    if (contactType !== 'group') return [uid]

    const withoutPrefix = uid.replace(/^g/i, '')
    return Array.from(new Set([uid, withoutPrefix].map(value => value.trim()).filter(Boolean)))
  }

  private async applyAkaBizTagsToZaloTarget(
    account: AutoAccount,
    campaign: Campaign,
    target: ZaloResolvedTarget | null | undefined,
    contactType: ContactType
  ): Promise<void> {
    const tagIds = this.getAkaBizTagIdsForCampaign(campaign)
    if (tagIds.length === 0 || !target?.uid) return

    const uids = this.getAkaBizTargetUids(target, contactType)
    if (uids.length === 0) return

    try {
      const result = await this.supabase.applyAkaBizTagsToContactTargets(
        uids.map(uid => ({
          accountId: account.id,
          contactType,
          uid
        })),
        tagIds
      )
      this.throwIfZaloRuntimeStopping(campaign.id)
      if (result.count > 0) {
        const label = contactType === 'group'
          ? `group ${this.getZaloTargetLabel(target)}`
          : this.getZaloTargetLabel(target)
        await this.logCampaignProgress(campaign.id, `🏷️ Đã gắn tag akaBiz cho ${label}`)
      } else {
        console.warn('[CampaignScheduler] No existing contact found for akaBiz tags', {
          accountId: account.id,
          campaignId: campaign.id,
          contactType,
          uid: target.uid,
          tagIds
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[CampaignScheduler] Failed to apply akaBiz contact tags:', {
        accountId: account.id,
        campaignId: campaign.id,
        contactType,
        uid: target.uid,
        message
      })
      await this.logCampaignProgress(campaign.id, `⚠️ Không thể gắn tag akaBiz cho ${this.getZaloTargetLabel(target)}: ${message}`)
    }
  }

  private normalizeZaloFriendProfile(raw: Record<string, unknown>): ZaloFriendMaterializedProfile | null {
    const uid = this.firstNonEmptyString(raw.userId, raw.uid, raw.id)
    if (!uid) return null
    return {
      uid,
      name: this.firstNonEmptyString(raw.displayName, raw.zaloName, raw.username, raw.name, uid),
      phone: this.firstNonEmptyString(raw.phoneNumber, raw.phone),
      sdob: this.firstNonEmptyString(raw.sdob),
      raw
    }
  }

  private getZaloFriendSourceTagIds(campaign: Campaign): string[] {
    const extra = campaign.extraSettings || {}
    const rawIds = Array.isArray(extra.zaloFriendSourceTagIds) ? extra.zaloFriendSourceTagIds : []
    const seen = new Set<string>()
    const tagIds: string[] = []

    rawIds.forEach((rawId) => {
      const id = String(rawId ?? '').trim()
      if (!id || seen.has(id)) return
      seen.add(id)
      tagIds.push(id)
    })

    return tagIds
  }

  private getZaloFriendSourceTagLogLabel(campaign: Campaign, tagIds: string[]): string {
    const rawNames = Array.isArray(campaign.extraSettings?.zaloFriendSourceTagNames)
      ? campaign.extraSettings.zaloFriendSourceTagNames
      : []
    return tagIds
      .map((id, index) => String(rawNames[index] || id).trim() || id)
      .join(', ')
  }

  private async materializeZaloFriendInputData(account: AutoAccount, campaign: Campaign): Promise<CampaignInputData[]> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    this.throwIfZaloRuntimeStopping(campaign.id)
    const mode = this.getZaloFriendTargetMode(campaign)
    const sourceTagIds = this.getZaloFriendSourceTagIds(campaign)
    let allowedUidKeys: Set<string> | null = null

    if (mode === ZALO_FRIEND_TARGET_MODE_TAGGED) {
      if (sourceTagIds.length === 0) {
        await this.logCampaignProgress(campaign.id, '⚠️ Chưa chọn tag nguồn Zalo để lấy danh sách bạn bè')
        return []
      }
      await this.logCampaignProgress(campaign.id, `🔄 Đang lấy danh sách hội thoại trong ${sourceTagIds.length} tag Zalo: ${this.getZaloFriendSourceTagLogLabel(campaign, sourceTagIds)}`)
      const conversationUids: string[] = []
      for (const tagId of sourceTagIds) {
        this.throwIfZaloRuntimeStopping(campaign.id)
        conversationUids.push(...await this.zaloRuntime.getLabelConversationUids(account.id, tagId))
        this.throwIfZaloRuntimeStopping(campaign.id)
      }
      allowedUidKeys = new Set(conversationUids.map(uid => this.normalizeUidForCompare(uid)).filter(Boolean))
      if (allowedUidKeys.size === 0) {
        await this.updateCampaignAndBroadcast(campaign.id, {
          extraSettings: {
            ...(campaign.extraSettings || {}),
            zaloFriendDataMaterializedAt: new Date().toISOString(),
            zaloFriendMaterializedCount: 0
          }
        })
        await this.logCampaignProgress(campaign.id, `⚠️ Các tag Zalo đã chọn chưa có bạn bè nào`)
        return []
      }
    }

    await this.logCampaignProgress(campaign.id, mode === ZALO_FRIEND_TARGET_MODE_TAGGED
      ? '🔄 Đang quét danh sách bạn bè Zalo live để lọc theo tag'
      : '🔄 Đang quét toàn bộ danh sách bạn bè Zalo live')

    const profiles: ZaloFriendMaterializedProfile[] = []
    const seen = new Set<string>()
    let page = 1
    while (true) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const rows = await this.zaloRuntime.getAllFriendsPage(account.id, ZALO_FRIEND_PAGE_SIZE, page)
      this.throwIfZaloRuntimeStopping(campaign.id)
      for (const row of rows) {
        const profile = this.normalizeZaloFriendProfile(row)
        if (!profile) continue
        const key = this.normalizeUidForCompare(profile.uid)
        if (!key || seen.has(key)) continue
        if (allowedUidKeys && !allowedUidKeys.has(key)) continue
        seen.add(key)
        profiles.push(profile)
      }
      if (rows.length < ZALO_FRIEND_PAGE_SIZE) break
      page += 1
    }

    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.upsertZaloApiUserContacts(
      profiles.map(profile => this.mapZaloApiRawUserContact(account.id, profile.raw, campaign.actionId))
    )

    if (profiles.length > 0) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      await this.createMaterializedCampaignInputDataBatch(
        profiles.map<Partial<CampaignInputData>>(profile => ({
          campaignId: campaign.id,
          name: profile.name,
          uid: profile.uid,
          phone: profile.phone || '',
          status: 'chờ xử lý',
          note: ''
        })),
        () => this.throwIfZaloRuntimeStopping(campaign.id)
      )
    }
    this.throwIfZaloRuntimeStopping(campaign.id)

    const nextExtraSettings = {
      ...(campaign.extraSettings || {}),
      zaloFriendDataMaterializedAt: new Date().toISOString(),
      zaloFriendMaterializedCount: profiles.length
    }
    campaign.extraSettings = nextExtraSettings
    await this.updateCampaignAndBroadcast(campaign.id, { extraSettings: nextExtraSettings })
    await this.logCampaignProgress(campaign.id, `✅ Đã thêm ${profiles.length} bạn bè Zalo vào chiến dịch "${campaign.name}"`)
    return await this.supabase.listCampaignInputData(campaign.id)
  }

  private isZaloBirthdayToday(sdob: unknown, todayDdMm: string): boolean {
    const text = String(sdob ?? '').trim()
    return text.length >= 5 && text.slice(0, 5) === todayDdMm
  }

  private async materializeZaloBirthdayInputData(
    account: AutoAccount,
    campaign: Campaign,
    businessNow: Date
  ): Promise<CampaignInputData[]> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    this.throwIfZaloRuntimeStopping(campaign.id)
    const todayDateKey = this.getVietnamDateKey(businessNow)
    const todayDdMm = this.getVietnamBirthdayKey(businessNow)

    await this.logCampaignProgress(campaign.id, `🔄 Đang quét danh sách bạn bè Zalo live để lọc sinh nhật ${todayDdMm}`)

    const profiles: ZaloFriendMaterializedProfile[] = []
    const seen = new Set<string>()
    let page = 1
    while (true) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const rows = await this.zaloRuntime.getAllFriendsPage(account.id, ZALO_FRIEND_PAGE_SIZE, page)
      this.throwIfZaloRuntimeStopping(campaign.id)
      for (const row of rows) {
        const profile = this.normalizeZaloFriendProfile(row)
        if (!profile || !this.isZaloBirthdayToday(profile.sdob, todayDdMm)) continue
        const key = this.normalizeUidForCompare(profile.uid)
        if (!key || seen.has(key)) continue
        seen.add(key)
        profiles.push(profile)
      }
      if (rows.length < ZALO_FRIEND_PAGE_SIZE) break
      page += 1
    }

    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.upsertZaloApiUserContacts(
      profiles.map(profile => this.mapZaloApiRawUserContact(account.id, profile.raw, campaign.actionId))
    )

    if (profiles.length > 0) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      await this.createMaterializedCampaignInputDataBatch(
        profiles.map<Partial<CampaignInputData>>(profile => ({
          campaignId: campaign.id,
          name: profile.name,
          uid: profile.uid,
          phone: profile.phone || '',
          status: 'chờ xử lý',
          note: ''
        })),
        () => this.throwIfZaloRuntimeStopping(campaign.id)
      )
    }
    this.throwIfZaloRuntimeStopping(campaign.id)

    const nextExtraSettings = {
      ...(campaign.extraSettings || {}),
      zaloBirthdayDataMaterializedDate: todayDateKey,
      zaloBirthdayMaterializedCount: profiles.length
    }
    campaign.extraSettings = nextExtraSettings
    await this.updateCampaignAndBroadcast(campaign.id, { extraSettings: nextExtraSettings })

    if (profiles.length === 0) {
      return []
    }

    await this.logCampaignProgress(campaign.id, `✅ Đã thêm ${profiles.length} bạn bè sinh nhật hôm nay vào chiến dịch "${campaign.name}"`)
    return await this.supabase.listCampaignInputData(campaign.id)
  }

  private normalizeZaloFriendRecommendationCount(value: unknown): number {
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed)) return 10
    return Math.max(1, parsed)
  }

  private async markZaloFriendRecommendationMaterialized(campaign: Campaign, count: number): Promise<void> {
    const nextExtraSettings = {
      ...(campaign.extraSettings || {}),
      zaloFriendRecommendationDataMaterializedAt: new Date().toISOString(),
      zaloFriendRecommendationMaterializedCount: count
    }
    campaign.extraSettings = nextExtraSettings
    await this.updateCampaignAndBroadcast(campaign.id, { extraSettings: nextExtraSettings })
  }

  private getZaloFriendRecommendationEmptyReason(input: {
    hasRecommendationList: boolean
    totalItems: number
    recommendedItems: number
    missingUidItems: number
  }): string {
    if (!input.hasRecommendationList) return 'Zalo không trả danh sách đề xuất để chạy'
    if (input.totalItems === 0) return 'Zalo không có danh sách đề xuất để chạy'
    if (input.recommendedItems === 0) return 'Zalo không có danh sách đề xuất để chạy'
    if (input.missingUidItems >= input.recommendedItems) return 'Danh sách đề xuất Zalo không có UID hợp lệ để chạy'
    return 'Không lấy được đề xuất Zalo để chạy'
  }

  private async materializeZaloFriendRecommendationInputData(
    account: AutoAccount,
    campaign: Campaign
  ): Promise<CampaignInputData[]> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    this.throwIfZaloRuntimeStopping(campaign.id)
    const requestedCount = this.normalizeZaloFriendRecommendationCount(
      campaign.extraSettings?.zaloFriendRecommendationCount
    )
    await this.logCampaignProgress(campaign.id, `🔄 Đang lấy ${requestedCount} đề xuất Zalo`)

    let snapshot: Awaited<ReturnType<ZaloRuntimeService['getFriendRecommendations']>>
    try {
      this.throwIfZaloRuntimeStopping(campaign.id)
      snapshot = await this.zaloRuntime.getFriendRecommendations(account.id)
      this.throwIfZaloRuntimeStopping(campaign.id)
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      await this.markZaloFriendRecommendationMaterialized(campaign, 0)
      const message = `Không lấy được đề xuất Zalo: ${this.getZaloErrorMessage(err) || 'Lỗi không xác định'}`
      await this.completeZaloFriendRecommendationWithoutTargets(campaign, message)
      return []
    }

    const selectedProfiles: ZaloFriendRecommendationProfile[] = []
    const seen = new Set<string>()
    for (const profile of snapshot.profiles) {
      const key = this.normalizeUidForCompare(profile.uid)
      if (!key || seen.has(key)) continue
      seen.add(key)
      selectedProfiles.push(profile)
      if (selectedProfiles.length >= requestedCount) break
    }

    if (snapshot.missingUidItems > 0) {
      await this.logCampaignProgress(campaign.id, `⚠️ Bỏ qua ${snapshot.missingUidItems} đề xuất Zalo thiếu UID`)
    }

    if (selectedProfiles.length === 0) {
      await this.markZaloFriendRecommendationMaterialized(campaign, 0)
      await this.completeZaloFriendRecommendationWithoutTargets(
        campaign,
        this.getZaloFriendRecommendationEmptyReason(snapshot)
      )
      return []
    }

    if (selectedProfiles.length < requestedCount) {
      await this.logCampaignProgress(campaign.id, `⚠️ Chỉ lấy được ${selectedProfiles.length}/${requestedCount} đề xuất Zalo`)
    }

    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.createMaterializedCampaignInputDataBatch(
      selectedProfiles.map<Partial<CampaignInputData>>(profile => ({
        campaignId: campaign.id,
        name: profile.name || '',
        uid: profile.uid,
        phone: profile.phone || '',
        status: 'chờ xử lý',
        note: ''
      })),
      () => this.throwIfZaloRuntimeStopping(campaign.id)
    )
    this.throwIfZaloRuntimeStopping(campaign.id)

    await this.markZaloFriendRecommendationMaterialized(campaign, selectedProfiles.length)
    await this.logCampaignProgress(campaign.id, `✅ Đã thêm ${selectedProfiles.length} đề xuất Zalo vào chiến dịch "${campaign.name}"`)
    return await this.supabase.listCampaignInputData(campaign.id)
  }

  private normalizeZaloCancelFriendRequestLimit(value: unknown): number {
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed)) return 10
    return Math.max(1, parsed)
  }

  private async markZaloCancelSentFriendRequestMaterialized(campaign: Campaign, count: number): Promise<void> {
    const nextExtraSettings = {
      ...(campaign.extraSettings || {}),
      zaloCancelFriendRequestDataMaterializedAt: new Date().toISOString(),
      zaloCancelFriendRequestMaterializedCount: count
    }
    campaign.extraSettings = nextExtraSettings
    await this.updateCampaignAndBroadcast(campaign.id, { extraSettings: nextExtraSettings })
  }

  private async completeZaloCancelSentFriendRequestWithoutTargets(campaign: Campaign, message: string): Promise<void> {
    const note = message || 'Zalo không có lời mời kết bạn đã gửi để huỷ'
    campaign.note = note
    await this.updateCampaignAndBroadcast(campaign.id, { note })
    await this.logCampaignProgress(campaign.id, `⚠️ ${note}`)
    await this.handleCampaignCompletion(campaign)
  }

  private sortZaloSentFriendRequestsOldestFirst(
    profiles: ZaloSentFriendRequestProfile[]
  ): ZaloSentFriendRequestProfile[] {
    return [...profiles].sort((left, right) => {
      const leftTime = Number.isFinite(Number(left.sentAt)) ? Number(left.sentAt) : Number.MAX_SAFE_INTEGER
      const rightTime = Number.isFinite(Number(right.sentAt)) ? Number(right.sentAt) : Number.MAX_SAFE_INTEGER
      if (leftTime !== rightTime) return leftTime - rightTime
      return left.uid.localeCompare(right.uid, 'vi')
    })
  }

  private async materializeZaloCancelSentFriendRequestInputData(
    account: AutoAccount,
    campaign: Campaign,
    existingDetails: CampaignInputData[]
  ): Promise<CampaignInputData[]> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    this.throwIfZaloRuntimeStopping(campaign.id)
    const limit = this.normalizeZaloCancelFriendRequestLimit(
      campaign.extraSettings?.zaloCancelFriendRequestLimit
    )

    if (existingDetails.length > 0) {
      await this.supabase.clearCampaignInputData(campaign.id)
      this.throwIfZaloRuntimeStopping(campaign.id)
    }

    await this.logCampaignProgress(campaign.id, `🔄 Đang lấy danh sách lời mời kết bạn đã gửi từ Zalo để huỷ ${limit} lời mời cũ nhất`)

    let snapshot: Awaited<ReturnType<ZaloRuntimeService['getSentFriendRequests']>>
    try {
      this.throwIfZaloRuntimeStopping(campaign.id)
      snapshot = await this.zaloRuntime.getSentFriendRequests(account.id)
      this.throwIfZaloRuntimeStopping(campaign.id)
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      await this.markZaloCancelSentFriendRequestMaterialized(campaign, 0)
      const message = `Không lấy được danh sách lời mời kết bạn đã gửi từ Zalo: ${this.getZaloErrorMessage(err) || 'Lỗi không xác định'}`
      await this.completeZaloCancelSentFriendRequestWithoutTargets(campaign, message)
      return []
    }

    if (snapshot.missingUidItems > 0) {
      await this.logCampaignProgress(campaign.id, `⚠️ Bỏ qua ${snapshot.missingUidItems} lời mời Zalo thiếu UID`)
    }

    const selectedProfiles = this.sortZaloSentFriendRequestsOldestFirst(snapshot.profiles).slice(0, limit)
    if (selectedProfiles.length === 0) {
      await this.markZaloCancelSentFriendRequestMaterialized(campaign, 0)
      await this.completeZaloCancelSentFriendRequestWithoutTargets(campaign, 'Zalo không có lời mời kết bạn đã gửi để huỷ')
      return []
    }

    if (selectedProfiles.length < limit) {
      await this.logCampaignProgress(campaign.id, `⚠️ Chỉ lấy được ${selectedProfiles.length}/${limit} lời mời kết bạn đã gửi`)
    }

    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.createMaterializedCampaignInputDataBatch(
      selectedProfiles.map<Partial<CampaignInputData>>(profile => ({
        campaignId: campaign.id,
        name: profile.name || profile.displayName || profile.zaloName || profile.uid,
        uid: profile.uid,
        status: 'chờ xử lý',
        note: '',
        info1: profile.sentAt === null || profile.sentAt === undefined ? '' : String(profile.sentAt),
        info2: profile.requestMessage || '',
        info3: profile.globalId || ''
      })),
      () => this.throwIfZaloRuntimeStopping(campaign.id)
    )
    this.throwIfZaloRuntimeStopping(campaign.id)

    await this.markZaloCancelSentFriendRequestMaterialized(campaign, selectedProfiles.length)
    await this.logCampaignProgress(campaign.id, `✅ Đã thêm ${selectedProfiles.length} lời mời kết bạn đã gửi vào chiến dịch "${campaign.name}"`)
    return await this.supabase.listCampaignInputData(campaign.id)
  }

  private normalizeSuggestedFriendProfiles(value: unknown, limit: number): SuggestedFriendProfile[] {
    const rawProfiles = Array.isArray(value) ? value : []
    const profiles: SuggestedFriendProfile[] = []
    const seen = new Set<string>()

    for (const item of rawProfiles) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const uid = String(record.uid || '').trim()
      if (!uid) continue
      const key = this.normalizeUidForCompare(uid)
      if (!key || seen.has(key)) continue
      seen.add(key)
      profiles.push({
        name: String(record.name || '').trim(),
        uid
      })
      if (profiles.length >= limit) break
    }

    return profiles
  }

  private getCampaignActionDescriptors(campaign: Campaign, campaignAction?: CampaignAction): CampaignActionDescriptor[] {
    return resolveCampaignActionDescriptors(campaign, campaignAction)
  }

  private getCampaignExecutableActionDescriptors(campaign: Campaign, campaignAction?: CampaignAction): CampaignActionDescriptor[] {
    return resolveCampaignExecutableActionDescriptors(campaign, campaignAction)
  }

  private getCampaignPreflightActionDescriptors(
    campaign: Campaign,
    campaignAction: CampaignAction,
    executableActionDescriptors = this.getCampaignExecutableActionDescriptors(campaign, campaignAction),
    quotaActionDescriptors = this.getCampaignActionDescriptors(campaign, campaignAction)
  ): { executable: CampaignActionDescriptor[]; quota: CampaignActionDescriptor[] } {
    if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
      return { executable: [], quota: [] }
    }

    if (
      campaign.actionId === GROUP_POST_ACTION_ID &&
      campaign.extraSettings?.skipPostIfGroupRequiresApproval === true
    ) {
      return {
        executable: executableActionDescriptors.filter(descriptor => descriptor.code !== 'fb_post_group'),
        quota: quotaActionDescriptors.filter(descriptor => descriptor.code !== 'fb_post_group')
      }
    }

    return {
      executable: executableActionDescriptors,
      quota: quotaActionDescriptors
    }
  }

  private resolveCampaignWorkflow(action: CampaignAction): { workflowId?: number; missingNote: string } {
    const useTestWorkflow = getCurrentUser()?.useTestWorkflow === true
    const workflowId = useTestWorkflow ? action.testWorkflowId : action.workflowId
    const normalizedWorkflowId = Number(workflowId)
    return {
      workflowId: Number.isFinite(normalizedWorkflowId) && normalizedWorkflowId > 0 ? normalizedWorkflowId : undefined,
      missingNote: useTestWorkflow
        ? 'Loại chiến dịch chưa được liên kết workflow test'
        : 'Loại chiến dịch chưa được liên kết workflow'
    }
  }

  private getAccountActionName(actionCode: string): string {
    return resolveAccountActionName(actionCode)
  }

  private getPostActionCode(campaign: Campaign): string | null {
    return resolvePostActionCode(campaign)
  }

  private getMessageActionCode(campaign: Campaign): string {
    return resolveMessageActionCode(campaign)
  }

  private async checkActionDisabled(
    account: AutoAccount,
    actionDescriptors: CampaignActionDescriptor[],
    readOnly = false
  ): Promise<AccountActionLimitStatus | null> {
    for (const action of actionDescriptors) {
      const disabledStatus = readOnly
        ? await this.supabase.peekAccountActionDisabledStatus(account.id, action.code, action.name)
        : await this.supabase.getAccountActionDisabledStatus(account.id, action.code, action.name)
      if (!disabledStatus.ok) return disabledStatus
    }
    return null
  }

  private async checkActionLimits(
    account: AutoAccount,
    campaign: Campaign,
    actionDescriptors: CampaignActionDescriptor[],
    limitConfig?: CampaignActionLimitSettings,
    readOnly = false
  ): Promise<AccountActionLimitStatus | null> {
    void campaign
    const entitlements = await loadCurrentUserEffectiveEntitlements()
    for (const action of actionDescriptors) {
      const actionLimitConfig = this.getActionLimitConfig(action.code, limitConfig, account, entitlements)
      const limitStatus = readOnly
        ? await this.supabase.peekAccountRateLimitStatus(account.id, action.code, action.name, actionLimitConfig)
        : await this.supabase.getAccountRateLimitStatus(account.id, action.code, action.name, actionLimitConfig)
      if (!limitStatus.ok) return limitStatus
    }
    return null
  }

  private async buildRuntimeLimitDetail(
    limitStatus: AccountActionLimitStatus,
    data: Record<string, unknown> = {}
  ): Promise<ZaloActionDetailOutput> {
    const note = await this.buildLimitPreflightNote(limitStatus)
    return {
      createDetail: false,
      actionCode: limitStatus.actionCode || null,
      actionName: this.getLimitActionName(limitStatus),
      errorCode: limitStatus.errorCode || null,
      log: note,
      countsTowardLimit: false,
      countsTowardBadTarget: false,
      resetInputToPending: true,
      pendingNote: note,
      stopAfterTarget: true,
      data: {
        ...data,
        actionLimit: {
          actionCode: limitStatus.actionCode || null,
          actionName: limitStatus.actionName || null,
          errorCode: limitStatus.errorCode || null,
          reason: limitStatus.reason || null,
          currentCount: limitStatus.currentCount ?? null,
          limit: limitStatus.limit ?? null,
          dailyActionCount: limitStatus.dailyActionCount ?? null,
          dailyLimit: limitStatus.dailyLimit ?? null,
          windowActionCount: limitStatus.windowActionCount ?? null,
          windowLimit: limitStatus.windowLimit ?? null,
          windowMinutes: limitStatus.windowMinutes ?? null,
          retryAfterMs: limitStatus.retryAfterMs ?? null,
          isActionDisabled: limitStatus.isActionDisabled === true
        }
      }
    }
  }

  private async checkZaloFindPhoneUserRuntimeLimit(
    account: AutoAccount,
    campaign: Campaign,
    data: Record<string, unknown> = {}
  ): Promise<ZaloActionDetailOutput | null> {
    const actionDescriptor: CampaignActionDescriptor = {
      code: ZALO_FIND_PHONE_ACTION_CODE,
      name: this.getAccountActionName(ZALO_FIND_PHONE_ACTION_CODE)
    }
    const disabledStatus = await this.checkActionDisabled(account, [actionDescriptor])
    if (disabledStatus && !disabledStatus.ok) return this.buildRuntimeLimitDetail(disabledStatus, data)

    const limitStatus = await this.checkActionLimits(account, campaign, [actionDescriptor], campaign.extraSettings?.actionLimits)
    if (limitStatus && !limitStatus.ok) return this.buildRuntimeLimitDetail(limitStatus, data)

    return null
  }

  private shouldContinueWhenActionLimitReached(limitConfig?: CampaignActionLimitSettings): boolean {
    return limitConfig?.continueWhenActionLimitReached === true
  }

  private isInternalQuotaLimitStatus(limitStatus: AccountActionLimitStatus): boolean {
    return !limitStatus.isActionDisabled && (
      limitStatus.errorCode === LIMIT_IN_DAY_ERROR_CODE ||
      limitStatus.errorCode === LIMIT_IN_HOUR_ERROR_CODE
    )
  }

  private isSkippableLimitAction(campaign: Campaign, actionCode: string): boolean {
    if (actionCode === 'fb_comment') {
      return (
        campaign.actionId === GROUP_POST_ACTION_ID ||
        campaign.actionId === 'facebook_timeline_post' ||
        campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID
      )
    }
    if (actionCode === 'fb_like_post') {
      return (
        campaign.actionId === GROUP_POST_ACTION_ID ||
        campaign.actionId === 'facebook_timeline_post' ||
        campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID ||
        campaign.actionId === COMMENT_SEEDING_POST_ACTION_ID ||
        campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID
      )
    }
    if (actionCode === 'fb_message_stranger' || actionCode === 'fb_add_friend') {
      return campaign.actionId === MESSAGE_UID_ACTION_ID
    }
    if (actionCode === 'zalo_message_stranger' || actionCode === 'zalo_add_friend') {
      return (
        campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
      )
    }
    return false
  }

  private getSkippedLimitActionCodeSet(limitStatuses: AccountActionLimitStatus[]): Set<string> {
    return new Set(limitStatuses.map(status => status.actionCode).filter((code): code is string => !!code))
  }

  private getContinuableLimitActionCodes(campaign: Campaign): Set<string> | null {
    if (campaign.actionId !== ZALO_MESSAGE_PHONE_ACTION_ID) return null

    const extra = campaign.extraSettings || {}
    const codes: string[] = []
    if (extra.enableMessage === true) codes.push('zalo_message_stranger')
    if (extra.enableAddFriend === true) codes.push('zalo_add_friend')
    return new Set(codes)
  }

  private hasRunnableContinuableLimitAction(
    campaign: Campaign,
    runnableActionDescriptors: CampaignActionDescriptor[]
  ): boolean {
    const continuableCodes = this.getContinuableLimitActionCodes(campaign)
    if (!continuableCodes) return runnableActionDescriptors.length > 0
    if (continuableCodes.size === 0) return false
    return runnableActionDescriptors.some(action => continuableCodes.has(action.code))
  }

  private shouldSkipMessageByLimit(campaign: Campaign, skippedActionCodes: Set<string>): boolean {
    const messageCodes = [
      this.getMessageActionCode(campaign),
      'zalo_message_stranger',
      'zalo_message_friend',
      'zalo_message_group',
      'email_send',
      'sms_send',
      'voice_call'
    ]
    return messageCodes.some(code => skippedActionCodes.has(code))
  }

  private shouldSkipAddFriendByLimit(skippedActionCodes: Set<string>): boolean {
    return skippedActionCodes.has('fb_add_friend') || skippedActionCodes.has('zalo_add_friend')
  }

  private async logSkippedLimitActionsOnce(
    campaign: Campaign,
    limitStatuses: AccountActionLimitStatus[],
    loggedActionCodes: Set<string>
  ): Promise<void> {
    for (const status of limitStatuses) {
      const actionCode = status.actionCode || status.actionName || ''
      if (!actionCode || loggedActionCodes.has(actionCode)) continue
      loggedActionCodes.add(actionCode)
      const note = await this.buildLimitPreflightNote(status)
      await this.logCampaignProgress(campaign.id, `⚠️ Bỏ qua ${this.getLimitActionName(status)} vì đã đạt giới hạn: ${note}`)
    }
  }

  private async checkActionLimitsForContinuation(
    account: AutoAccount,
    campaign: Campaign,
    actionDescriptors: CampaignActionDescriptor[],
    limitConfig?: CampaignActionLimitSettings,
    readOnly = false
  ): Promise<ActionLimitContinuationResult> {
    if (!this.shouldContinueWhenActionLimitReached(limitConfig)) {
      const limitStatus = await this.checkActionLimits(account, campaign, actionDescriptors, limitConfig, readOnly)
      return {
        limitStatus,
        runnableActionDescriptors: actionDescriptors,
        skippedActionDescriptors: [],
        skippedLimitStatuses: []
      }
    }

    const entitlements = await loadCurrentUserEffectiveEntitlements()
    const runnableActionDescriptors: CampaignActionDescriptor[] = []
    const skippedActionDescriptors: CampaignActionDescriptor[] = []
    const skippedLimitStatuses: AccountActionLimitStatus[] = []

    for (const action of actionDescriptors) {
      const actionLimitConfig = this.getActionLimitConfig(action.code, limitConfig, account, entitlements)
      const limitStatus = readOnly
        ? await this.supabase.peekAccountRateLimitStatus(account.id, action.code, action.name, actionLimitConfig)
        : await this.supabase.getAccountRateLimitStatus(account.id, action.code, action.name, actionLimitConfig)
      if (limitStatus.ok) {
        runnableActionDescriptors.push(action)
        continue
      }

      if (this.isInternalQuotaLimitStatus(limitStatus) && this.isSkippableLimitAction(campaign, action.code)) {
        skippedActionDescriptors.push(action)
        skippedLimitStatuses.push(limitStatus)
        continue
      }

      return {
        limitStatus,
        runnableActionDescriptors,
        skippedActionDescriptors,
        skippedLimitStatuses
      }
    }

    if (
      actionDescriptors.length > 0 &&
      !this.hasRunnableContinuableLimitAction(campaign, runnableActionDescriptors) &&
      skippedLimitStatuses.length > 0
    ) {
      return {
        limitStatus: skippedLimitStatuses[0],
        runnableActionDescriptors,
        skippedActionDescriptors,
        skippedLimitStatuses
      }
    }

    return {
      limitStatus: null,
      runnableActionDescriptors,
      skippedActionDescriptors,
      skippedLimitStatuses
    }
  }

  private async resolveNewsfeedActionAvailability(
    account: AutoAccount,
    campaign: Campaign,
    executableActionDescriptors: CampaignActionDescriptor[],
    quotaActionDescriptors: CampaignActionDescriptor[],
    limitConfig?: CampaignActionLimitSettings
  ): Promise<NewsfeedActionAvailability> {
    const extra = campaign.extraSettings || {}
    const likeConfigured = this.isNewsfeedLikeConfigured(extra)
    const commentConfigured = this.isNewsfeedCommentConfigured(extra)
    const entitlements = await loadCurrentUserEffectiveEntitlements()
    let allowLike = likeConfigured
    let allowComment = commentConfigured
    const blockedReasons: string[] = []
    const blockedLimitStatuses: AccountActionLimitStatus[] = []
    let disabledStatus: AccountActionLimitStatus | undefined
    const executableCodes = new Set(executableActionDescriptors.map(action => action.code))
    const quotaCodes = new Set(quotaActionDescriptors.map(action => action.code))

    const checkDisabledOne = async (code: 'fb_like_post' | 'fb_comment', name: string): Promise<AccountActionLimitStatus | null> => {
      const status = await this.supabase.getAccountActionDisabledStatus(account.id, code, name)
      if (status.ok) return null
      blockedReasons.push(await this.buildLimitPreflightNote(status))
      return status
    }

    const checkQuotaOne = async (code: 'fb_like_post' | 'fb_comment', name: string): Promise<boolean> => {
      const limitStatus = await this.supabase.getAccountRateLimitStatus(
        account.id,
        code,
        name,
        this.getActionLimitConfig(code, limitConfig, account, entitlements)
      )
      if (limitStatus.ok) return true
      blockedReasons.push(await this.buildLimitPreflightNote(limitStatus))
      blockedLimitStatuses.push(limitStatus)
      return false
    }

    if (likeConfigured && executableCodes.has('fb_like_post')) {
      const status = await checkDisabledOne('fb_like_post', this.getAccountActionName('fb_like_post'))
      if (status) {
        disabledStatus = disabledStatus || status
        allowLike = false
      }
      if (!status && quotaCodes.has('fb_like_post')) {
        allowLike = await checkQuotaOne('fb_like_post', this.getAccountActionName('fb_like_post'))
      }
    }
    if (commentConfigured && executableCodes.has('fb_comment')) {
      const status = await checkDisabledOne('fb_comment', this.getAccountActionName('fb_comment'))
      if (status) {
        disabledStatus = disabledStatus || status
        allowComment = false
      }
      if (!status && quotaCodes.has('fb_comment')) {
        allowComment = await checkQuotaOne('fb_comment', this.getAccountActionName('fb_comment'))
      }
    }

    return {
      allowLike,
      allowComment,
      blockedReasons,
      disabledStatus,
      blockedLimitStatuses,
      allCheckedActionsBlocked: blockedReasons.length > 0 && !allowLike && !allowComment
    }
  }

  private normalizePositiveLimitValue(value: unknown): number | undefined {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  private normalizeNonNegativeLimitValue(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }

  private getCampaignActionLimitConfig(
    actionCode: string,
    limitConfig?: CampaignActionLimitSettings
  ): ActionLimitConfig | undefined {
    if (actionCode === ZALO_FIND_PHONE_ACTION_CODE) {
      return {
        dailyLimit: ZALO_FIND_PHONE_DEFAULT_LIMIT,
        rateLimitCount: ZALO_FIND_PHONE_DEFAULT_LIMIT,
        rateLimitMinutes: limitConfig?.byActionCode?.[actionCode]?.rateLimitMinutes ?? limitConfig?.rateLimitMinutes
      }
    }
    const byActionCode = limitConfig?.byActionCode?.[actionCode]
    if (byActionCode) return byActionCode
    if (!limitConfig) return undefined
    return {
      dailyLimit: limitConfig.dailyLimit,
      rateLimitCount: limitConfig.rateLimitCount,
      rateLimitMinutes: limitConfig.rateLimitMinutes
    }
  }

  private getActionLimitConfig(
    actionCode: string,
    limitConfig?: CampaignActionLimitSettings,
    account?: AutoAccount,
    entitlements?: Parameters<typeof getAccountActionDailySendLimit>[2]
  ): ActionLimitConfig | undefined {
    const campaignLimit = this.getCampaignActionLimitConfig(actionCode, limitConfig)
    const groupLimit = account?.accountGroupSettings?.byActionCode?.[actionCode]
    if (!groupLimit) return this.applyDailySendLimitToActionConfig(actionCode, campaignLimit, entitlements)

    const mergedLimit = {
      dailyLimit: this.normalizePositiveLimitValue(groupLimit.dailyLimit) ?? campaignLimit?.dailyLimit,
      rateLimitCount: this.normalizePositiveLimitValue(groupLimit.rateLimitCount) ?? campaignLimit?.rateLimitCount,
      rateLimitMinutes: this.normalizePositiveLimitValue(groupLimit.rateLimitMinutes) ?? campaignLimit?.rateLimitMinutes
    }

    return this.applyDailySendLimitToActionConfig(actionCode, mergedLimit, entitlements)
  }

  private applyDailySendLimitToActionConfig(
    actionCode: string,
    config?: ActionLimitConfig,
    entitlements?: Parameters<typeof getAccountActionDailySendLimit>[2]
  ): ActionLimitConfig | undefined {
    const cap = getAccountActionDailySendLimit(actionCode, null, entitlements)
    const normalizedCap = this.normalizePositiveLimitValue(cap)
    if (!normalizedCap) return config

    const dailyLimit = Math.min(this.normalizePositiveLimitValue(config?.dailyLimit) ?? 30, normalizedCap)
    return {
      ...(config || {}),
      dailyLimit
    }
  }

  private getEffectiveSleepBetweenActions(
    account: AutoAccount,
    limitConfig?: CampaignActionLimitSettings
  ): number {
    return this.normalizeNonNegativeLimitValue(account.accountGroupSettings?.sleepBetweenActions)
      ?? this.normalizeNonNegativeLimitValue(limitConfig?.sleepBetweenActions)
      ?? 0
  }

  private isServerZaloCampaign(account: AutoAccount, campaign: Campaign): boolean {
    return this.runtimeTarget === 'server' &&
      String(account.flatformType || '').trim().toLowerCase() === 'zalo' &&
      account.isZaloServer === true &&
      !account.isZaloShowWeb &&
      String(campaign.actionId || '').trim().toLowerCase().startsWith('zalo_')
  }

  private latchServerZaloPause(
    campaignId: number,
    campaignStatus: string | null,
    accountStatus: string | null
  ): void {
    const current = this.serverZaloPauseBoundaries.get(campaignId)
    if (current === 'campaign') return
    if (campaignStatus && campaignStatus !== 'đang chạy') {
      this.serverZaloPauseBoundaries.set(campaignId, 'campaign')
    } else if (accountStatus && accountStatus !== 'đang chạy') {
      this.serverZaloPauseBoundaries.set(campaignId, 'account')
    }
  }

  private isServerZaloBoundaryRequested(
    campaignStatus: string | null,
    accountStatus: string | null,
    hardStopReason: string | null
  ): boolean {
    if (hardStopReason) return false
    return (campaignStatus !== null && campaignStatus !== 'đang chạy') ||
      (accountStatus !== null && accountStatus !== 'đang chạy')
  }

  private getServerZaloHardStopMessage(reason: string): string {
    if (reason === 'account_logged_out') return 'Tài khoản bị đăng xuất'
    if (reason === 'account_inactive') return 'Tài khoản đã bị tắt'
    if (reason === 'account_deleted') return 'Tài khoản đã bị xoá'
    if (reason === 'campaign_deleted') return 'Chiến dịch đã bị xoá'
    if (reason === 'runtime_not_owner') {
      // A mode change is a lifecycle stop, not an ordinary account pause. Any
      // in-flight request follows the existing uncertainty/no-retry cleanup.
      this.requestZaloRuntimeStop('handoff')
      return ZALO_RUNTIME_RESTART_NOTE
    }
    return 'Trạng thái Zalo Server không còn hợp lệ'
  }

  private async getServerZaloBoundaryReason(
    account: AutoAccount,
    campaign: Campaign
  ): Promise<{ paused: boolean; hardStopReason: string | null }> {
    if (!this.isServerZaloCampaign(account, campaign)) {
      return { paused: false, hardStopReason: null }
    }
    const control = await this.supabase.getZaloServerRunControlState(campaign.id, account.id)
    const boundaryRequested = this.isServerZaloBoundaryRequested(
      control.campaignStatus,
      control.accountStatus,
      control.hardStopReason
    )
    if (boundaryRequested) {
      this.latchServerZaloPause(campaign.id, control.campaignStatus, control.accountStatus)
    }
    return {
      paused: boundaryRequested,
      hardStopReason: control.hardStopReason
        ? this.getServerZaloHardStopMessage(control.hardStopReason)
        : null
    }
  }

  private async beginCampaignRunUnit(
    account: AutoAccount,
    campaign: Campaign,
    inputDataIds: number[],
    options: { requeueRemainingOnSettle?: boolean } = {}
  ): Promise<boolean> {
    const context = this.campaignRunBoundaries.get(campaign.id)
    if (!context) {
      this.boundaryStoppedAccountQueues.add(account.id)
      this.sendLog(`⚠️ Chiến dịch "${campaign.name}" không có ownership token; đã dừng trước lượt mới.`)
      return false
    }

    // Reaching another begin point proves the prior unit has finished all
    // external work and result writes. Clear that durable lease before a new
    // token can be created; maintenance remains closed while this retries.
    if (!await this.settleActiveCampaignRunUnit(account, campaign)) return false

    // `stopAcceptingNewZaloWork()` flips `running` before waiting for the
    // already-claimed unit to settle. Keep that local drain boundary even if
    // the product capability is toggled off and back on while this runtime is
    // still stopping; only a reconciled runtime may claim the next unit.
    if (this.isServerZaloCampaign(account, campaign) && !this.running) return false

    const runtimeUnitToken = randomUUID()
    let claim: Awaited<ReturnType<SupabaseService['claimCampaignRunUnitV2']>>
    let retryLogged = false
    while (true) {
      if (!this.running) return false
      try {
        claim = await this.supabase.claimCampaignRunUnitV2(
          campaign.id,
          account.id,
          this.runtimeTarget,
          context.runtimeClaimToken,
          context.claimedVietnamDateKey,
          runtimeUnitToken,
          inputDataIds
        )
        break
      } catch (error) {
        // An exact retry is idempotent when a previous response was lost. Keep
        // the parent claim reserved and never start the external side effect
        // until PostgreSQL confirms this unit and its cutoff atomically.
        this.boundaryStoppedAccountQueues.add(account.id)
        console.error(`Failed v2 unit claim for campaign ${campaign.id}:`, error)
        if (!retryLogged) {
          retryLogged = true
          this.sendLog('⚠️ Chưa thể xác nhận lượt chạy từ DB; đang chờ để thử lại và không thực hiện hành động mới.')
        }
        await new Promise(resolve => setTimeout(resolve, 2_000))
      }
    }

    if (claim.ok) {
      if (claim.claimedCount !== inputDataIds.length) {
        throw new Error('DB đã claim số lượng data không khớp với lượt chạy.')
      }
      if (
        claim.runtimeUnitToken !== runtimeUnitToken ||
        claim.runtimeUnitVietnamDateKey !== context.claimedVietnamDateKey
      ) {
        throw new Error('DB trả unit lease không khớp với lượt chạy hiện tại.')
      }
      this.activeCampaignRunUnits.set(campaign.id, {
        runtimeUnitToken,
        inputDataIds: [...inputDataIds],
        requeueRemainingOnSettle: options.requeueRemainingOnSettle === true
      })

      const parentStillOwned =
        claim.runtimeClaimToken === context.runtimeClaimToken &&
        claim.runtimeClaimVietnamDateKey === context.claimedVietnamDateKey
      const visibleRuntimeStillRunning =
        claim.campaignStatus === 'đang chạy' && claim.accountStatus === 'đang chạy'

      // The only successful response allowed without the visible parent claim
      // is an exact-token retry after the first response was lost. If pause or
      // another control transition won meanwhile, no external effect has
      // started in this caller: requeue its exact reservation and stop.
      if (!parentStillOwned || !visibleRuntimeStillRunning) {
        this.boundaryStoppedAccountQueues.add(account.id)
        if (this.isServerZaloCampaign(account, campaign)) {
          this.latchServerZaloPause(campaign.id, claim.campaignStatus, claim.accountStatus)
        }
        if (!await this.settleActiveCampaignRunUnit(account, campaign, true)) return false
        if (
          claim.campaignStatus === 'tạm dừng' ||
          claim.accountStatus === 'tạm dừng' ||
          this.isCampaignPauseRequested(campaign.id) ||
          this.serverZaloPauseBoundaries.has(campaign.id)
        ) {
          await this.completePauseAtBoundary(account, campaign)
        }
        return false
      }
      if (this.isRunUnitStartCancelled(account, campaign)) {
        this.boundaryStoppedAccountQueues.add(account.id)
        await this.settleActiveCampaignRunUnit(account, campaign, true)
        return false
      }
      return true
    }

    if (
      claim.reason === 'daily_stop_due' ||
      claim.reason === 'daily_drain_due' ||
      claim.reason === 'vietnam_day_changed' ||
      claim.reason === 'runtime_control_paused'
    ) {
      if (
        claim.reason === 'runtime_control_paused' &&
        this.isServerZaloCampaign(account, campaign)
      ) {
        this.latchServerZaloPause(campaign.id, claim.campaignStatus, claim.accountStatus)
      }
      await this.yieldCampaignAtRunBoundary(account, campaign, {
        reached: true,
        context,
        clock: {
          dbNow: claim.dbNow,
          vietnamDateKey: claim.vietnamDateKey
        },
        clockUnavailable: false
      })
      return false
    }

    this.boundaryStoppedAccountQueues.add(account.id)

    if (claim.reason === 'runtime_not_owner') {
      // Capability loss is a graceful ownership boundary. The current target
      // (or realtime batch) has already settled before this next-unit claim,
      // and the rejected input is still pending. Stop locally *now* and signal
      // the manager instead of waiting for its discovery poll: capability may
      // be restored before that poll, otherwise the already-claimed parent
      // campaign/account could remain running forever. Manager recovery is
      // scoped to Server-subtype rows and does not consume bad-target policy.
      if (this.runtimeTarget === 'server') {
        this.stopAcceptingNewZaloWork()
        if (!this.runtimeOwnershipLossReported) {
          this.runtimeOwnershipLossReported = true
          try {
            this.onRuntimeOwnershipLost?.()
          } catch (error) {
            console.error('Failed to notify Zalo Server ownership loss:', error)
          }
        }
      } else if (account.flatformType === 'zalo') {
        this.blockZaloRuntimeForRestart()
      }
      return false
    }

    if (
      claim.reason === 'account_logged_out' ||
      claim.reason === 'account_inactive' ||
      claim.reason === 'account_deleted'
    ) {
      const reason = claim.reason === 'account_logged_out'
        ? 'Tài khoản bị đăng xuất'
        : claim.reason === 'account_inactive'
          ? 'Tài khoản đã ngừng hoạt động'
          : 'Tài khoản đã bị xoá'
      await this.stopCampaignForAccountCondition(account, campaign, reason)
      await this.releaseRunningAccount(account.id)
      return false
    }

    if (claim.reason === 'campaign_deleted' || claim.reason === 'not_found') {
      await this.releaseRunningAccount(account.id)
      return false
    }

    if (claim.reason === 'input_not_pending') {
      // The input was edited after this run loaded its snapshot. End the old
      // claim without consuming another row; the scheduler will reload fresh
      // input state on the next pass.
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: 'chờ xử lý',
        note: null
      })
      await this.releaseRunningAccount(account.id)
      return false
    }

    // A stale executor must never repair or release rows belonging to a newer
    // token. Unknown claim outcomes are likewise left to scoped stale-run
    // recovery instead of entering the campaign-wide error policy.
    this.sendLog(`⚠️ Chiến dịch "${campaign.name}" đã dừng trước lượt mới (${claim.reason}).`)
    return false
  }

  /** No external side effect may begin after local shutdown/handoff won. */
  private isRunUnitStartCancelled(account: AutoAccount, campaign: Campaign): boolean {
    if (!this.running) return true
    return account.flatformType === 'zalo' && this.getZaloRuntimeStopReason(campaign.id) !== null
  }

  /**
   * Token-CAS settlement is the durable end of an external run unit. A lost
   * response is safe to retry: no later unit is opened until PostgreSQL either
   * clears this exact token or proves that it is already absent/stale.
   */
  private async settleActiveCampaignRunUnit(
    account: AutoAccount,
    campaign: Campaign,
    requeueRemainingOverride?: boolean
  ): Promise<boolean> {
    const lease = this.activeCampaignRunUnits.get(campaign.id)
    if (!lease) return true

    if (account.flatformType === 'zalo' && this.isZaloRuntimeWriteBarrierActive(campaign.id)) {
      // Ownership was explicitly abandoned only after the producer became
      // idle. The succeeding owner/startup recovery clears this durable lease.
      return false
    }

    const requeueRemaining = requeueRemainingOverride ?? lease.requeueRemainingOnSettle
    let retryLogged = false
    while (true) {
      try {
        const result = await this.supabase.settleCampaignRunUnitV2(
          campaign.id,
          account.id,
          this.runtimeTarget,
          lease.runtimeUnitToken,
          requeueRemaining
        )
        if (
          result.ok ||
          result.reason === 'unit_lease_not_found'
        ) {
          this.activeCampaignRunUnits.delete(campaign.id)
          return true
        }
        if (result.reason === 'unit_lease_mismatch' || result.reason === 'runtime_not_owner') {
          this.activeCampaignRunUnits.delete(campaign.id)
          this.boundaryStoppedAccountQueues.add(account.id)
          this.sendLog(`⚠️ Chiến dịch "${campaign.name}" không còn sở hữu unit lease (${result.reason}).`)
          return false
        }
        throw new Error(`Unit settlement rejected: ${result.reason}`)
      } catch (error) {
        console.error(`Failed to settle v2 unit lease for campaign ${campaign.id}:`, error)
        this.boundaryStoppedAccountQueues.add(account.id)
        if (!retryLogged) {
          retryLogged = true
          this.sendLog('⚠️ Lượt chạy đã xong nhưng DB chưa xác nhận settle; hệ thống đang giữ maintenance và không mở lượt mới.')
        }
        if (!this.running) return false
        await new Promise(resolve => setTimeout(resolve, 2_000))
      }
    }
  }

  private async completePauseAtBoundary(account: AutoAccount, campaign: Campaign): Promise<void> {
    if (!await this.settleActiveCampaignRunUnit(account, campaign)) return
    if (!this.isServerZaloCampaign(account, campaign)) {
      await this.releaseRunningAccount(account.id)
      await this.completeCampaignPause(campaign)
      return
    }

    let boundary = this.serverZaloPauseBoundaries.get(campaign.id) || null
    const control = await this.supabase.getZaloServerRunControlState(campaign.id, account.id).catch(() => null)
    if (control?.campaignStatus && control.campaignStatus !== 'đang chạy') boundary = 'campaign'
    else if (!boundary && control?.accountStatus && control.accountStatus !== 'đang chạy') boundary = 'account'

    try {
      if (boundary === 'account') {
        const updated = await this.updateCampaignAndBroadcast(campaign.id, {
          status: 'chờ xử lý',
          note: null
        })
        // A concurrent campaign pause wins the CAS and must remain paused.
        if (updated.status === 'tạm dừng') boundary = 'campaign'
      } else {
        const current = await this.supabase.getCampaign(campaign.id)
        if (current) this.broadcastCampaignUpdate(current)
      }
    } finally {
      this.serverZaloPauseBoundaries.delete(campaign.id)
      await this.releaseRunningAccount(account.id)
      try { this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch {}
    }

    const label = boundary === 'account' ? 'tài khoản' : 'chiến dịch'
    await this.logCampaignProgress(campaign.id, `⏸ Đã hoàn thành lượt hiện tại và tạm dừng ${label}.`)
  }

  private async getAccountRunBlockReason(
    accountId: number,
    expectedStatus: 'chờ xử lý' | 'đang chạy'
  ): Promise<string | null> {
    const account = await this.supabase.getAccount(accountId)
    if (!account) return 'Không tìm thấy tài khoản'
    if (account.loginStatus !== 'đã đăng nhập') return 'Tài khoản bị đăng xuất'
    if (account.status !== expectedStatus) return `Tài khoản đang ở trạng thái ${account.status}`
    return null
  }

  private async ensureZaloSessionReadyForCampaign(account: AutoAccount, campaign: Campaign): Promise<boolean> {
    if (!this.isZaloBrowserlessCampaign(campaign) || account.flatformType !== 'zalo') return true

    if (!this.zaloRuntime) {
      const message = 'Zalo runtime chưa sẵn sàng'
      await this.updateCampaignPreflightNote(campaign, message)
      await this.logCampaignProgress(campaign.id, `⚠️ ${message}`)
      return false
    }

    try {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const result = await this.zaloRuntime.checkSession(account.id)
      this.throwIfZaloRuntimeStopping(campaign.id)
      try {
        this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
      } catch {
        // Window may be closed
      }
      if (result.loggedIn) return true
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      console.error('Failed to verify Zalo session before campaign run:', err)
      try {
        this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
      } catch {
        // Window may be closed
      }
    }

    const message = 'Tài khoản Zalo chưa đăng nhập hoặc phiên đăng nhập đã hết hạn'
    await this.updateCampaignPreflightNote(campaign, message)
    await this.logCampaignProgress(campaign.id, `⚠️ ${message}`)
    return false
  }

  private async stopCampaignForAccountCondition(
    account: AutoAccount,
    campaign: Campaign,
    reason: string
  ): Promise<void> {
    if (reason.includes('đăng xuất')) {
      await this.handleRuntimeError(account, campaign, 'err_logout', undefined, { message: reason })
    } else {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: reason })
      await this.logCampaignProgress(campaign.id, `⚠️ Dừng chiến dịch "${campaign.name}": ${reason}`)
    }
  }

  private async handleLimitStatus(
    account: AutoAccount,
    campaign: Campaign,
    limitStatus: AccountActionLimitStatus
  ): Promise<void> {
    const actionName = this.getLimitActionName(limitStatus)
    const replacements = this.buildLimitReplacements(limitStatus)
    const message = this.addActionContextToMessage(
      limitStatus.reason || `Hành động "${actionName}" đang tạm dừng`,
      replacements
    )

    if (limitStatus.isActionDisabled) {
      const note = await this.buildLimitPreflightNote(limitStatus)
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note })
      await this.logCampaignProgress(campaign.id, `⚠️ Tạm dừng "${campaign.name}": ${note}`)
      return
    }

    if (limitStatus.errorCode) {
      await this.handleRuntimeError(account, campaign, limitStatus.errorCode, limitStatus.actionCode, replacements)
    } else {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
      await this.logCampaignProgress(campaign.id, `⚠️ Tạm dừng "${campaign.name}": ${message}`)
    }
  }

  private async updateCampaignPreflightNote(campaign: Campaign, note: string): Promise<void> {
    const message = note || 'Không đủ điều kiện chạy'
    if (campaign.status === 'chờ xử lý' && campaign.note === message) {
      const currentCampaign = await this.supabase.getCampaign(campaign.id)
      if (currentCampaign?.status === 'chờ xử lý' && currentCampaign.note === message) return
    }
    await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
  }

  private async updateUnclaimedCampaignPreflightNote(campaign: Campaign, note: string): Promise<void> {
    const updated = await this.supabase.updatePendingUnclaimedCampaignNote(
      campaign.id,
      campaign.updatedAt || '',
      note || 'Không đủ điều kiện chạy'
    )
    if (updated) {
      this.broadcastCampaignUpdate(updated)
      return
    }

    // Losing the CAS means a pause, edit or runtime claim won the race. Publish
    // that authoritative row and never overwrite or release the newer owner.
    const currentCampaign = await this.supabase.getCampaign(campaign.id)
    if (currentCampaign) this.broadcastCampaignUpdate(currentCampaign)
  }

  private async releaseClaimedCampaignPreflight(
    accountId: number,
    campaign: Campaign,
    note: string
  ): Promise<void> {
    try {
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: 'chờ xử lý',
        note: note || 'Không đủ điều kiện chạy'
      })
    } finally {
      await this.releaseRunningAccount(accountId)
    }
  }

  private async buildLimitPreflightNote(limitStatus: AccountActionLimitStatus): Promise<string> {
    const replacements = this.buildLimitReplacements(limitStatus)

    if (limitStatus.errorCode) {
      const policy = await this.supabase.getErrorPolicy(limitStatus.errorCode)
      const message = this.renderPolicyMessage(policy?.notiCampaign || policy?.notiRunningProcess, replacements)
      if (message) return this.addActionContextToMessage(message, replacements)
    }

    return this.addActionContextToMessage(limitStatus.reason || 'Không đủ điều kiện chạy', replacements)
  }

  private buildLimitReplacements(limitStatus: AccountActionLimitStatus): Record<string, string | undefined> {
    const minutes = limitStatus.retryAfterMs ? Math.ceil(limitStatus.retryAfterMs / 60000) : undefined
    const actionName = this.getLimitActionName(limitStatus)
    const countOrLimit = limitStatus.currentCount ?? limitStatus.limit
    return {
      x: String(countOrLimit ?? minutes ?? ''),
      t: String(minutes ?? ''),
      actionName,
      action: actionName,
      a: actionName,
      actionCode: limitStatus.actionCode,
      action_code: limitStatus.actionCode,
      message: limitStatus.reason
    }
  }

  private getLimitActionName(limitStatus: AccountActionLimitStatus): string {
    return limitStatus.actionName || limitStatus.actionCode || 'hành động'
  }

  private addActionContextToMessage(message: string, replacements: Record<string, string | undefined>): string {
    const actionName = replacements.actionName || replacements.action || replacements.a
    const text = (message || '').trim()
    if (!actionName || !text || text.includes(actionName)) return text
    return `${actionName}: ${text}`
  }

  private normalizeRuntimeError(
    campaign: Campaign,
    steps: RunStepV2[],
    fallbackError?: string
  ): { errorCode: string; actionCode?: string; message: string } {
    const errorStep = [...steps].reverse().find(step => step.status === 'error')
    const rawMessage = String(
      fallbackError ||
      errorStep?.error ||
      (errorStep?.output as any)?.error ||
      'Lỗi không xác định'
    )
    const message = rawMessage.trim() || 'Lỗi không xác định'
    const lowerMessage = message.toLowerCase()
    let actionCode: string | undefined

    if (errorStep?.blockName === 'fb_send_message' || errorStep?.blockName === 'fb_send_page_inbox_message') actionCode = this.getMessageActionCode(campaign)
    else if (errorStep?.blockName === 'fb_add_friend') actionCode = 'fb_add_friend'
    else if (errorStep?.blockName === 'fb_comment_at_position' || errorStep?.blockName === 'fb_comment_current_post') actionCode = 'fb_comment'
    else if (errorStep?.blockName === 'fb_click_like_current_post') actionCode = 'fb_like_post'
    else if (errorStep?.blockName === 'fb_join_group') actionCode = 'fb_join_group'
    else if (errorStep?.blockName === 'fb_group_invite') actionCode = FACEBOOK_GROUP_INVITE_ACTION_CODE
    else if (errorStep?.blockName && errorStep.blockName.startsWith('fb_newsfeed_comment')) actionCode = 'fb_comment'
    else if (errorStep?.blockName === 'fb_newsfeed_like_post') actionCode = 'fb_like_post'
    else if (errorStep?.blockName === 'fb_click_post_button' || errorStep?.blockName === 'fb_verify_group_post_form_closed') actionCode = this.getPostActionCode(campaign) || undefined
    else if (
      errorStep?.blockName === 'fb_page_post_api' ||
      errorStep?.blockName === 'fb_post_current_identity_ui' ||
      errorStep?.blockName === 'fb_switch_identity_by_name' ||
      errorStep?.blockName === 'fb_get_current_identity_name'
    ) actionCode = 'fb_post_page'
    else actionCode = this.getCampaignExecutableActionDescriptors(campaign)[0]?.code

    if (lowerMessage.includes('bạn đã đạt giới hạn về số tin nhắn đang chờ')) {
      return { errorCode: 'err_limit_waiting_message', actionCode, message }
    }
    if (lowerMessage.includes('giới hạn tần suất comment')) {
      return { errorCode: COMMENT_FREQUENCY_LIMIT_ERROR_CODE, actionCode: 'fb_comment', message }
    }
    if (campaign.actionId === GROUP_POST_ACTION_ID && actionCode !== 'fb_comment' && lowerMessage.includes('giới hạn tần suất bạn đăng bài')) {
      return { errorCode: GROUP_POST_FREQUENCY_LIMIT_ERROR_CODE, actionCode, message }
    }

    return { errorCode: 'err_undefined', actionCode, message }
  }

  private createMilestoneSummary(): MilestoneSummary {
    return {
      hasSuccess: false,
      hasFailure: false,
      hasHardFailure: false,
      hasError: false,
      failureReasons: [],
      errorReasons: [],
      failureRootReasons: [],
      errorRootReasons: []
    }
  }

  private recordMilestoneSummary(
    summary: MilestoneSummary,
    status: CampaignDetailStatus | undefined,
    reason?: string | null,
    actionName?: string | null,
    rootReason?: string | null
  ): void {
    const message = String(reason || '').trim()
    const rootMessage = String(rootReason || '').trim()
    if (status === 'thành công') {
      summary.hasSuccess = true
    } else if (status === 'thất bại') {
      summary.hasFailure = true
      if (String(actionName || '').trim() !== 'Comment') summary.hasHardFailure = true
      if (message) summary.failureReasons.push(message)
      if (rootMessage) summary.failureRootReasons.push(rootMessage)
    } else if (status === 'lỗi') {
      summary.hasError = true
      if (message) summary.errorReasons.push(message)
      if (rootMessage) summary.errorRootReasons.push(rootMessage)
    }
  }

  private getMilestoneBadReason(summary: MilestoneSummary): string {
    return summary.errorReasons[0] || summary.failureReasons[0] || 'Target có lỗi hoặc thất bại'
  }

  private getMilestoneBadRootReason(summary: MilestoneSummary): string {
    return summary.errorRootReasons[0] || summary.failureRootReasons[0] || this.getMilestoneBadReason(summary)
  }

  private getCampaignDetailRootReason(detail: Partial<CampaignDetail>): string | undefined {
    const data = detail.data
    if (!data || typeof data !== 'object') return undefined
    const error = data.error
    return typeof error === 'string' && error.trim().length > 0
      ? error.trim()
      : undefined
  }

  private getPolicyThreshold(policy: AutoErrorPolicy | null | undefined): number | null {
    return policy?.countConsecutiveErrors && policy.countConsecutiveErrors > 0
      ? policy.countConsecutiveErrors
      : null
  }

  private getRunIdFromPolicyReplacements(replacements: Record<string, string | undefined>): number | null {
    const runId = Number(replacements.runId)
    return Number.isFinite(runId) && runId > 0 ? runId : null
  }

  private getScreenshotPathFromEvent(event: CampaignRunEvent): string {
    const screenshotPath = event.debugData?.screenshotPath
    return typeof screenshotPath === 'string' ? screenshotPath.trim() : ''
  }

  private getBrowserUrlFromEvent(event: CampaignRunEvent): string {
    const browserUrl = event.debugData?.browserUrl || event.targetUrl
    return typeof browserUrl === 'string' ? browserUrl.trim() : ''
  }

  private async findLatestScreenshotEventForDiagnosis(
    campaignId: number,
    inputDataId: number | null | undefined,
    runId: number | null
  ): Promise<CampaignRunEvent | null> {
    if (inputDataId) {
      const inputScreenshot = await campaignRunEventRepo.findLatestBrowserScreenshotEvent({
        campaignId,
        campaignInputDataId: inputDataId
      })
      if (inputScreenshot) return inputScreenshot
    }

    if (!runId) return null

    return campaignRunEventRepo.findLatestBrowserScreenshotEvent({
      campaignId,
      runId
    })
  }

  private normalizeAiDiagnosisText(value: string): string {
    return String(value || '')
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```$/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500)
  }

  private async diagnoseUndefinedErrorWithScreenshot(
    account: AutoAccount,
    campaign: Campaign,
    inputDataId: number | null | undefined,
    policyReplacements: Record<string, string | undefined>,
    fallbackReason: string
  ): Promise<string | null> {
    try {
      const runId = this.getRunIdFromPolicyReplacements(policyReplacements)
      const screenshotEvent = await this.findLatestScreenshotEventForDiagnosis(campaign.id, inputDataId, runId)
      if (!screenshotEvent) return null

      const screenshotPath = this.getScreenshotPathFromEvent(screenshotEvent)
      if (!screenshotPath) return null

      const image = readBlockScreenshotDataUrl(screenshotPath)
      const descriptors = this.getCampaignExecutableActionDescriptors(campaign)
      const actionName = descriptors[0]?.name || policyReplacements.actionName || policyReplacements.action || ''
      const browserUrl = this.getBrowserUrlFromEvent(screenshotEvent)
      const result = await callAiUsing(CAMPAIGN_ERROR_SCREENSHOT_DIAGNOSIS_AI_CODE, {
        source: 'aka_agent',
        campaignName: campaign.name,
        campaignActionId: campaign.actionId,
        actionCode: policyReplacements.actionCode || policyReplacements.action_code || '',
        actionName,
        errorMessage: fallbackReason,
        fullLog: policyReplacements.message || fallbackReason,
        browserUrl,
        screenshotEventId: screenshotEvent.id,
        imageDataUrl: image.dataUrl
      }, {
        organizationId: campaign.organizationId ?? account.organizationId ?? null,
        accountId: account.id,
        campaignId: campaign.id,
        campaignInputId: screenshotEvent.campaignInputId ?? null,
        campaignInputDataId: screenshotEvent.campaignInputDataId ?? inputDataId ?? undefined,
        runId: screenshotEvent.runId ?? runId ?? undefined,
        runStepId: screenshotEvent.runStepId ?? undefined,
        nodeId: screenshotEvent.nodeId ?? undefined,
        blockId: screenshotEvent.blockId ?? undefined,
        blockName: screenshotEvent.blockName ?? undefined
      })
      if (!result.ok) {
        console.warn('[campaignScheduler] AI screenshot diagnosis failed:', result.error || 'unknown error')
        return null
      }

      const diagnosis = this.normalizeAiDiagnosisText(result.content)
      return diagnosis || null
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[campaignScheduler] AI screenshot diagnosis failed:', message)
      return null
    }
  }

  private async applyRuntimeErrorPolicy(
    account: AutoAccount,
    campaign: Campaign,
    errorCode: string,
    actionCode: string | undefined,
    replacements: Record<string, string | undefined> = {}
  ): Promise<RuntimeErrorResult> {
    const policyReplacements: Record<string, string | undefined> = {
      ...replacements,
      actionCode: replacements.actionCode || actionCode,
      action_code: replacements.action_code || actionCode
    }
    const policy = await this.supabase.getErrorPolicy(errorCode) || await this.supabase.getErrorPolicy('err_undefined')
    if (!policy) {
      const message = policyReplacements.message || 'Có lỗi xảy ra'
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
      return { triggered: true, message }
    }

    const message = this.addActionContextToMessage(
      this.renderPolicyMessage(policy.notiCampaign || policy.notiRunningProcess, policyReplacements)
      || policyReplacements.message
      || policy.errorDesc
      || policy.errorName,
      policyReplacements
    )
    const campaignStatus = policy.updateStatusCampaign || 'chờ xử lý'

    if (policy.updateStatusAccount) {
      await this.updateAccountAndBroadcast(account.id, { status: policy.updateStatusAccount })
    }
    if (policy.disableActionCodes.length > 0) {
      await this.supabase.disableAccountActions(account.id, policy.disableActionCodes, policy.timeDisableActions, {
        errorCode: policy.errorCode,
        reason: message,
        dateEnable: await this.resolvePolicyActionDateEnable(policy)
      })
      try { this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch {}
    }

    await this.updateCampaignAndBroadcast(campaign.id, { status: campaignStatus, note: message })
    await this.logCampaignProgress(campaign.id, `⚠️ Dừng chiến dịch "${campaign.name}": ${message}`)

    return { triggered: true, message, policy }
  }

  private async handleCampaignBadTarget(
    account: AutoAccount,
    campaign: Campaign,
    inputDataId: number | null | undefined,
    errorCode: string,
    actionCode: string | undefined,
    replacements: Record<string, string | undefined> = {}
  ): Promise<CampaignBadTargetResult> {
    const policyReplacements: Record<string, string | undefined> = {
      ...replacements,
      actionCode: replacements.actionCode || actionCode,
      action_code: replacements.action_code || actionCode
    }
    const specificPolicy = await this.supabase.getErrorPolicy(errorCode)
    const isUndefinedErrorPolicy = errorCode === 'err_undefined' || !specificPolicy
    const policy = specificPolicy || await this.supabase.getErrorPolicy('err_undefined')
    const threshold = this.getPolicyThreshold(policy)
    if (!policy || !threshold) {
      return this.applyRuntimeErrorPolicy(account, campaign, errorCode, actionCode, policyReplacements)
    }

    const notice = this.addActionContextToMessage(
      this.renderPolicyMessage(policy.notiRunningProcess, policyReplacements) ||
      policyReplacements.message ||
      policy.errorName,
      policyReplacements
    )
    const state = await this.supabase.incrementCampaignBadTargetCount(
      campaign.id,
      inputDataId,
      policyReplacements.message || notice
    )
    const count = state.countConsecutiveBadTargets

    if (count < threshold) {
      const message = `${notice} (${count}/${threshold})`
      return { triggered: false, message, policy, count, threshold }
    }

    let thresholdReason = String(
      policyReplacements.thresholdReason ||
      policyReplacements.message ||
      notice ||
      'Lỗi không xác định'
    ).trim() || 'Lỗi không xác định'
    if (isUndefinedErrorPolicy) {
      thresholdReason = await this.diagnoseUndefinedErrorWithScreenshot(
        account,
        campaign,
        inputDataId,
        policyReplacements,
        thresholdReason
      ) || thresholdReason
    }
    await this.logCampaignProgress(campaign.id, `⚠️ Chiến dịch đã lỗi/thất bại liên tiếp ${threshold} lần: ${thresholdReason}`)

    const handled = await this.applyRuntimeErrorPolicy(account, campaign, errorCode, actionCode, policyReplacements)
    return { ...handled, count, threshold }
  }

  private async resetCampaignBadTargetCount(campaign: Campaign): Promise<void> {
    try {
      await this.supabase.resetCampaignBadTargetCount(campaign.id)
    } catch (err) {
      console.error(`Failed to reset campaign bad target counter for campaign ${campaign.id}:`, err)
    }
  }

  private async handleRuntimeError(
    account: AutoAccount,
    campaign: Campaign,
    errorCode: string,
    actionCode: string | undefined,
    replacements: Record<string, string | undefined> = {}
  ): Promise<RuntimeErrorResult> {
    return this.applyRuntimeErrorPolicy(account, campaign, errorCode, actionCode, replacements)
  }

  private renderPolicyMessage(template: string | null | undefined, replacements: Record<string, string | undefined>): string {
    if (!template) return ''
    return template
      .replace(/\[x\]/g, replacements.x || replacements.message || '')
      .replace(/\[t\]/g, replacements.t || '')
      .replace(/\[a\]/g, replacements.actionName || replacements.action || replacements.a || '')
      .replace(/\[action\]/g, replacements.actionName || replacements.action || replacements.a || '')
      .replace(/\[action_code\]/g, replacements.actionCode || replacements.action_code || '')
      .trim()
  }

  private async resolvePolicyActionDateEnable(policy: AutoErrorPolicy): Promise<string | null | undefined> {
    if (policy.disableActionMode === 'end_of_day') {
      return (await this.supabase.getRuntimeClock()).nextVietnamMidnight
    }
    if (policy.disableActionMode === 'indefinite') return null
    return undefined
  }

  /** Build variables object inject vào engine v2. */
  private async buildVariablesV2(
    campaign: Campaign,
    detail: CampaignInputData | null,
    accountId: number,
    currentSourceLink: string,
    detailIndex: number,
    groupPostApproval?: {
      skipPostByKnownApproval?: boolean
      requiresPostApproval?: boolean | null
      source?: string
    },
    mediaTempPaths: string[] = [],
    skippedLimitActionCodes: Set<string> = new Set()
  ): Promise<Record<string, unknown>> {
    const extra = campaign.extraSettings || {}
    const formattedContentEnabled = this.isFormattedContentCampaign(campaign)
    const isActionSkippedByLimit = (actionCode: string) => skippedLimitActionCodes.has(actionCode)
    const skipMessageByLimit = this.shouldSkipMessageByLimit(campaign, skippedLimitActionCodes)
    const skipAddFriendByLimit = this.shouldSkipAddFriendByLimit(skippedLimitActionCodes)
    const canUseFindDataPostContentConditions =
      extra.isFindInPost === true || extra.isFindInComment === true || extra.isFindPostLink === true
    const canUseFindDataCommentContentConditions = extra.isFindInComment === true
    const canUseCommentSeedingPostContentConditions = campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID
    const canUsePostContentConditions = canUseFindDataPostContentConditions || canUseCommentSeedingPostContentConditions
    const pagePostMode = extra.pagePostMode || 'api'
    const postWithBackground = !formattedContentEnabled && extra.postWithBackground === true && (
      campaign.actionId === 'facebook_timeline_post' ||
      (campaign.actionId === PAGE_POST_ACTION_ID && pagePostMode === 'ui') ||
      campaign.actionId === GROUP_POST_ACTION_ID
    )

    // Comment seeding/group-post workflows use the shared comment iteration +
    // media contract. Newsfeed has its own comment flow but still consumes the
    // legacy `enableComment` variable, so preserve that toggle without letting
    // dormant comment media participate in its run.
    const usesCommentIterations = this.campaignUsesCommentIterations(campaign)
    const usesNewsfeedComment = campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID
    const enableComment = (usesCommentIterations || usesNewsfeedComment) &&
      (extra.enableComment ?? false) &&
      !isActionSkippedByLimit('fb_comment')
    const enableCommentIterations = usesCommentIterations && enableComment
    const enablePostLike = (extra.enablePostLike ?? false) && !isActionSkippedByLimit('fb_like_post')
    const commentGroupMode = extra.commentGroupMode || 'all'
    const commentType = extra.commentType || 'own'
    const rawCommentCount = Math.floor(Number(extra.commentCount ?? 3))
    const commentCount = Number.isFinite(rawCommentCount) ? Math.max(1, rawCommentCount) : 3
    let commentIndices: number[] = []
    if (enableCommentIterations) {
      if (commentType === 'own') commentIndices = [1]
      else if (commentType === 'all') for (let i = 0; i < commentCount; i++) commentIndices.push(i + 1)
      else for (let i = 0; i < commentCount; i++) commentIndices.push(i + 2)
    }
    const useAdvancedCommentContent = this.shouldUseAdvancedCommentContent(campaign)
    const rawCommentVariants = this.splitContentVariants(extra.commentContent)
    const selectedAdvancedContentItem = this.shouldUseAdvancedContent(campaign)
      ? selectAdvancedContentItem(campaign.extraSettings, detailIndex)
      : null
    const selectedRawPostContent = useAdvancedCommentContent
      ? ''
      : this.getRawCampaignContentForIndex(campaign, detailIndex)
    const selectedPostContent = campaign.actionId === FACEBOOK_JOIN_GROUP_ACTION_ID
      ? ''
      : formattedContentEnabled
        ? this.isBrowserlessCampaign(campaign)
          ? selectedRawPostContent
          : transformFormattedContentText(selectedRawPostContent, text => this.renderSpinContent(text))
        : this.isBrowserlessCampaign(campaign)
          ? selectedRawPostContent
          : this.renderSpinContent(selectedRawPostContent)
    const skipMainMediaForThisRun = !this.campaignUsesMainMedia(campaign) ||
      (this.campaignUsesMessageMedia(campaign) && skipMessageByLimit) ||
      (campaign.actionId === GROUP_POST_ACTION_ID && groupPostApproval?.skipPostByKnownApproval === true)
    const postAsReels = campaign.actionId === 'facebook_timeline_post' && !postWithBackground && extra.postAsReels === true
    const validPostImages = skipMainMediaForThisRun || postWithBackground || useAdvancedCommentContent
      ? []
      : await this.resolveCampaignMediaForIndex(
          campaign,
          detailIndex,
          postWithBackground,
          mediaTempPaths,
          postAsReels ? 1 : undefined
        )
    if (postAsReels && (validPostImages.length !== 1 || !isVideoMediaSource('', validPostImages[0]))) {
      throw new Error('Đăng Reels cần đúng 1 video hợp lệ cho mỗi lượt chạy')
    }
    if (campaign.actionId === PAGE_POST_ACTION_ID && pagePostMode === 'api' && validPostImages.some(media => !isImageMediaSource('', media))) {
      throw new Error('Đăng fanpage bằng API hiện chỉ hỗ trợ ảnh; hãy chuyển sang chế độ UI để dùng video')
    }
    if (campaign.actionId.startsWith('facebook_') && validPostImages.some(media => !isImageOrVideoMediaSource('', media))) {
      throw new Error('Media Facebook chỉ hỗ trợ ảnh hoặc video')
    }
    const commentBatchCount = !usesCommentIterations
      ? 1
      : useAdvancedCommentContent && campaign.actionId === COMMENT_SEEDING_POST_ACTION_ID
        ? 1
        : Math.max(commentIndices.length, Number(extra.postsPerTarget ?? commentCount), 1)
    let commentVariants: string[]
    let commentImageBatches: string[][]
    let commentImageOption: 'none' | 'all' | 'random'

    if (useAdvancedCommentContent) {
      // Keep rotation deterministic across both axes: all slots of target 0,
      // then all slots of target 1, and so on. Only the saved campaign
      // snapshot participates; source template/group metadata is never read.
      const advancedBatches: Array<{ text: string; images: string[] }> = []
      for (let slotIndex = 0; slotIndex < commentBatchCount; slotIndex++) {
        const linearIndex = detailIndex * commentBatchCount + slotIndex
        const item = selectAdvancedContentItem(campaign.extraSettings, linearIndex)
        advancedBatches.push({
          text: this.renderSpinContent(item?.content || ''),
          images: enableComment
            ? await this.resolveAdvancedCommentMedia(item, mediaTempPaths)
            : []
        })
      }
      commentVariants = advancedBatches.map(batch => batch.text)
      commentImageBatches = advancedBatches.map(batch => batch.images)
      commentImageOption = commentImageBatches.some(images => images.length > 0) ? 'all' : 'none'
    } else {
      const storedCommentImageOption = String(extra.commentImageOption || 'none')
      commentImageOption = storedCommentImageOption === 'random'
        ? 'random'
        : storedCommentImageOption === 'none'
          ? 'none'
          : 'all'
      const shouldUseCommentImages = enableCommentIterations && commentImageOption !== 'none'
      const availableCommentImages = Array.isArray(extra.commentImages) ? extra.commentImages : []
      if (shouldUseCommentImages && availableCommentImages.some(item => (
        this.hasDeclaredMediaSource(item) && !this.isCampaignMediaImageOrVideo(item)
      ))) {
        throw new Error('Media comment Facebook chỉ hỗ trợ ảnh hoặc video')
      }
      commentVariants = Array.from({ length: commentBatchCount }, (_, k) =>
        this.renderSpinContent(this.cycleVariant(rawCommentVariants, k))
      )
      if (!shouldUseCommentImages) {
        commentImageBatches = Array.from({ length: commentBatchCount }, () => [])
      } else if (commentImageOption === 'random') {
        commentImageBatches = []
        for (let slotIndex = 0; slotIndex < commentBatchCount; slotIndex++) {
          commentImageBatches.push(
            await this.resolveMediaSelection(availableCommentImages, 'random', 1, mediaTempPaths)
          )
        }
      } else {
        const firstDeclaredCommentImage = availableCommentImages.find(item => this.hasDeclaredMediaSource(item))
        const firstCommentImage = await this.resolveMediaSelection(
          firstDeclaredCommentImage ? [firstDeclaredCommentImage] : [],
          'all',
          1,
          mediaTempPaths
        )
        commentImageBatches = Array.from({ length: commentBatchCount }, () => [...firstCommentImage])
      }
    }
    const commentIterations = commentIndices.map((position, k) => ({
      position,
      text: this.cycleVariant(commentVariants, k),
      images: commentImageBatches[k] || []
    }))
    const legacyAdvancedEmailSubject = extra.advancedContentSource === 'group_snapshot'
      ? ''
      : String(extra.emailSubject ?? '')
    const selectedEmailSubject = campaign.actionId === EMAIL_SEND_ACTION_ID && selectedAdvancedContentItem
      ? String(selectedAdvancedContentItem.emailSubject ?? legacyAdvancedEmailSubject)
      : (extra.emailSubject || '')

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignContent: selectedPostContent,
      originalCampaignContent: selectedPostContent,
      manualContentNative: selectedPostContent,
      sourceContentPlain: '',
      formattedContentEnabled,
      rewriteContentEachRun: !formattedContentEnabled && extra.rewriteContentEachRun === true,
      campaignInputDataName: detail?.name || '',
      inputDataName: detail?.name || '',
      images: validPostImages,
      accountId,
      // Comment
      enableComment,
      rewriteCommentContentEachRun: extra.rewriteCommentContentEachRun === true,
      commentGroupMode,
      commentType,
      commentCount,
      commentIterations,
      commentVariants,
      // Legacy comment blocks fall back to `commentImages` whenever the
      // current batch has no image. Advanced items intentionally allow an
      // empty image batch, so keep that fallback empty to avoid reusing the
      // first item's image for later image-less items. Simple mode preserves
      // the existing shared-image behavior.
      commentImages: useAdvancedCommentContent ? [] : (commentImageBatches[0] || []),
      commentImageBatches,
      commentImageOption: enableCommentIterations ? commentImageOption : 'none',
      enablePostLike,
      postsPerTarget: extra.postsPerTarget ?? commentCount,
      isFindPostByKeywords: canUsePostContentConditions ? (extra.isFindPostByKeywords ?? false) : false,
      postKeywords: canUsePostContentConditions ? (extra.postKeywords ?? '') : '',
      isFindPostByContentAI: canUsePostContentConditions ? (extra.isFindPostByContentAI ?? false) : false,
      postContentAI: canUsePostContentConditions ? (extra.postContentAI ?? '') : '',
      // Newsfeed interaction extras
      newsfeedTimeMinutes: extra.newsfeedTimeMinutes ?? 20,
      newsfeedLikeKind: extra.newsfeedLikeKind || '',
      newsfeedLikeLimit: extra.newsfeedLikeLimit ?? 10,
      newsfeedCommentKind: extra.newsfeedCommentKind || '',
      newsfeedCommentLimit: extra.newsfeedCommentLimit ?? 10,
      newsfeedCommentContent: extra.newsfeedCommentContent || '',
      newsfeedCommentUseAI: extra.newsfeedCommentUseAI === true,
      // Group post extras
      leaveGroupOnPendingApproval: extra.leaveGroupOnPendingApproval ?? false,
      autoJoinGroupAfterPost: extra.autoJoinGroupAfterPost ?? false,
      shuffleGroupList: extra.shuffleGroupList ?? false,
      skipPostIfGroupRequiresApproval: extra.skipPostIfGroupRequiresApproval ?? false,
      skipGroupPostByKnownApproval: groupPostApproval?.skipPostByKnownApproval === true,
      groupPostRequiresPostApproval: groupPostApproval?.requiresPostApproval ?? null,
      groupPostApprovalSource: groupPostApproval?.source || '',
      enableGroupPostShareToJoinedGroups: extra.enableGroupPostShareToJoinedGroups === true,
      groupPostShareTargets: [],
      groupPostShareMaxCount: 0,
      // Timeline/page/group post extras
      sharePost: postWithBackground ? false : (extra.sharePost ?? false),
      postWithBackground,
      copyContentFromSource: postWithBackground ? false : (extra.copyContentFromSource ?? false),
      includeSourceImages: postWithBackground ? false : (extra.includeSourceImages ?? false),
      rewriteSourceContentWithAI: postWithBackground ? false : extra.rewriteSourceContentWithAI === true,
      sourceContentAiPrompt: postWithBackground ? '' : (extra.sourceContentAiPrompt || ''),
      postAsReels,
      sourceLink: currentSourceLink,
      targetUrl: detail?.uid || currentSourceLink,
      videoPath: validPostImages[0] || '',
      // Page post extras
      pagePostMode,
      pageUid: detail?.uid || '',
      pageName: detail?.name || '',
      businessUrl: 'https://business.facebook.com/content_management',
      // Message extras
      enableMessage: (
        campaign.actionId === MESSAGE_FRIEND_ACTION_ID ||
        campaign.actionId === PAGE_INBOX_MESSAGE_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
      ) ? !skipMessageByLimit : ((extra.enableMessage ?? false) && !skipMessageByLimit),
      enableAddFriend: (
        campaign.actionId === MESSAGE_FRIEND_ACTION_ID ||
        campaign.actionId === PAGE_INBOX_MESSAGE_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
      ) ? false : ((extra.enableAddFriend ?? false) && !skipAddFriendByLimit),
      pageInboxPageUid: extra.pageInboxPageUid || '',
      pageInboxPageName: extra.pageInboxPageName || '',
      // Find data in group extras
      isFindPhone: extra.isFindPhone ?? false,
      isFindLinkGroupZalo: extra.isFindLinkGroupZalo ?? false,
      isFindUid: extra.isFindUid ?? false,
      isFindPostLink: extra.isFindPostLink ?? false,
      isFindInPost: extra.isFindInPost ?? false,
      sortTypePost: extra.sortTypePost ?? 'most_relevant',
      countPostFindData: extra.countPostFindData ?? 10,
      isFindInComment: extra.isFindInComment ?? false,
      sortTypeComment: extra.sortTypeComment ?? 'most_relevant',
      countCommentFindData: extra.countCommentFindData ?? 30,
      isFindNewInteractors: extra.isFindNewInteractors ?? false,
      isFindInGroupMembers: extra.isFindInGroupMembers ?? false,
      countGroupMemberFindData: extra.countGroupMemberFindData ?? 100,
      // Find data by Facebook Search extras
      isFindFacebookGroup: extra.isFindFacebookGroup ?? false,
      countSearchPostFindData: extra.countSearchPostFindData ?? extra.countPostFindData ?? 10,
      countSearchGroupFindData: extra.countSearchGroupFindData ?? 20,
      searchPostRecentOnly: extra.searchPostRecentOnly ?? false,
      searchPostSeenOnly: extra.searchPostSeenOnly ?? false,
      searchPostDateFilter: extra.searchPostDateFilter ?? 'all',
      searchPostAuthorFilter: extra.searchPostAuthorFilter ?? 'all',
      searchPostTaggedLocation: extra.searchPostTaggedLocation ?? 'all',
      searchGroupCity: extra.searchGroupCity || '',
      searchGroupNearMe: extra.searchGroupNearMe ?? false,
      searchGroupPublicOnly: extra.searchGroupPublicOnly ?? false,
      searchGroupMineOnly: extra.searchGroupMineOnly ?? false,
      minSearchGroupMembers: extra.minSearchGroupMembers ?? 0,
      minSearchGroupPostsPerDay: extra.minSearchGroupPostsPerDay ?? 0,
      isFindCommentByKeywords: canUseFindDataCommentContentConditions ? (extra.isFindCommentByKeywords ?? false) : false,
      commentKeywords: canUseFindDataCommentContentConditions ? (extra.commentKeywords ?? '') : '',
      isFindCommentByContentAI: canUseFindDataCommentContentConditions ? (extra.isFindCommentByContentAI ?? false) : false,
      commentContentAI: canUseFindDataCommentContentConditions ? (extra.commentContentAI ?? '') : '',
      // Detail-specific.
      // inputDataUid pass nguyên dạng raw (UID thuần hoặc link) — workflow block
      // `fb_resolve_url` sẽ verify/normalize tuỳ theo urlType (group/profile/messenger).
      targetUid: detail?.uid || '',
      targetName: detail?.name || '',
      targetPhone: detail?.phone || '',
      // Email
      targetEmail: detail?.email || '',
      emailSubject: selectedEmailSubject,
      emailBodyIsHtml: extra.emailBodyIsHtml === true,
      emailCheckLinkClicks: extra.emailCheckLinkClicks === true,
      friendRequestMessage: extra.friendRequestMessage || '',
      enableZaloTag: extra.enableZaloTag === true,
      zaloTagId: extra.zaloTagId ?? null,
      zaloTagName: extra.zaloTagName || '',
      enableZaloAlias: extra.enableZaloAlias === true,
      zaloAlias: extra.zaloAliasTemplate || '',
      zaloAddGroupMemberTargetGroupId: this.firstNonEmptyString(extra.zaloAddGroupMemberTargetGroupId),
      zaloAddGroupMemberTargetGroupName: this.firstNonEmptyString(extra.zaloAddGroupMemberTargetGroupName),
      zaloAddGroupMemberUseShareMethod: extra.zaloAddGroupMemberUseShareMethod === true,
      inputData: detail ? {
        id: detail.id,
        name: detail.name || '',
        phone: detail.phone || '',
        uid: detail.uid || '',
        email: detail.email || '',
        info1: detail.info1 || '',
        info2: detail.info2 || '',
        info3: detail.info3 || '',
        info4: detail.info4 || '',
        info5: detail.info5 || ''
      } : {},
      ...(detail ? {
        inputDataId: detail.id,
        inputDataName: detail.name,
        inputDataUid: detail.uid,
        inputDataPhone: detail.phone,
        inputDataEmail: detail.email,
        inputDataInfo1: detail.info1,
        inputDataInfo2: detail.info2,
        inputDataInfo3: detail.info3,
        inputDataInfo4: detail.info4,
        inputDataInfo5: detail.info5
      } : {})
    }
  }

  private async logNewsfeedMilestoneStep(
    campaign: Campaign,
    detail: CampaignInputData | null,
    accountId: number,
    step: RunStepV2
  ): Promise<void> {
    if (step.status !== 'success') return
    if (step.blockName !== 'fb_newsfeed_like_post' && step.blockName !== 'fb_newsfeed_comment_submit') return

    const out = (step.output as any) || {}
    const isLike = step.blockName === 'fb_newsfeed_like_post'
    const isComment = step.blockName === 'fb_newsfeed_comment_submit'
    if (isLike && out.liked !== true) return
    if (isComment && out.commented !== true) return

    const key = [
      campaign.id,
      step.runId ?? 'run',
      step.nodeId || step.blockName,
      step.startedAt || step.completedAt || JSON.stringify(out)
    ].join(':')
    if (this.loggedNewsfeedMilestoneKeys.has(key)) return
    this.loggedNewsfeedMilestoneKeys.add(key)

    const targetName = String(out.targetName || 'bài viết newsfeed').trim()
    const postContent = String(out.postContent || '').trim()

    try {
      if (isLike) {
        const preview = postContent.length > 50 ? postContent.substring(0, 50) + '...' : postContent
        await this.supabase.createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionCode: 'fb_like_post',
          actionName: 'Like post',
          status: 'thành công',
          log: preview ? `Đã like bài newsfeed của ${targetName}: "${preview}"` : `Đã like bài newsfeed của ${targetName}`,
          data: {
            targetName,
            targetUid: out.targetUid || undefined,
            postContent: postContent || undefined,
            source: 'newsfeed',
            runId: step.runId,
            nodeId: step.nodeId
          }
        })
        await this.logCampaignProgress(campaign.id, `👍 Đã like bài newsfeed của "${targetName}"`)
        return
      }

      const text = String(out.text || '').trim()
      const preview = text.length > 50 ? text.substring(0, 50) + '...' : text
      await this.supabase.createCampaignDetail({
        inputDataId: detail?.id,
        campaignId: campaign.id,
        accountId,
        actionCode: 'fb_comment',
        actionName: 'Comment',
        status: 'thành công',
        log: preview ? `Đã comment bài newsfeed của ${targetName}: "${preview}"` : `Đã comment bài newsfeed của ${targetName}`,
        data: {
          targetName,
          targetUid: out.targetUid || undefined,
          postContent: postContent || undefined,
          commentContent: text || undefined,
          source: 'newsfeed',
          runId: step.runId,
          nodeId: step.nodeId
        }
      })
      await this.logCampaignProgress(campaign.id, `💬 Đã comment bài newsfeed của "${targetName}"`)
    } catch (err) {
      this.loggedNewsfeedMilestoneKeys.delete(key)
      console.error('Failed log newsfeed milestone:', err)
    }
  }

  private getZaloActionDetailFromStep(step: RunStepV2): ZaloActionDetailOutput | null {
    const output = (step.output || {}) as Record<string, unknown>
    const raw = output.detail || output.zaloDetail
    if (!raw || typeof raw !== 'object') return null
    return raw as ZaloActionDetailOutput
  }

  private formatZaloProgressLog(detail: Pick<ZaloActionDetailOutput, 'actionName' | 'log'>): string {
    const actionName = String(detail.actionName || '').trim()
    const log = String(detail.log || '').trim()
    if (!actionName) return log
    if (!log) return actionName
    const lowerLog = log.toLocaleLowerCase('vi-VN')
    const lowerAction = actionName.toLocaleLowerCase('vi-VN')
    return lowerLog.startsWith(lowerAction)
      ? log
      : `${actionName}: ${log}`
  }

  private async logEmailSendMilestones(
    campaign: Campaign,
    detail: CampaignInputData | null,
    accountId: number,
    steps: RunStepV2[]
  ): Promise<MilestoneSummary> {
    const summary = this.createMilestoneSummary()
    const loggedBlocks = new Set<string>()

    for (const step of steps) {
      const blockName = step.blockName || ''
      if (!blockName.startsWith('email_')) continue
      if (loggedBlocks.has(`${step.nodeId || ''}:${blockName}:${step.startedAt || ''}`)) continue
      loggedBlocks.add(`${step.nodeId || ''}:${blockName}:${step.startedAt || ''}`)

      const actionDetail = this.getZaloActionDetailFromStep(step)
      if (!actionDetail) continue

      if (actionDetail.createDetail === false || !actionDetail.status) {
        if (actionDetail.log) {
          await this.logCampaignProgress(campaign.id, `⚠️ ${this.formatZaloProgressLog(actionDetail)}`)
        }
        continue
      }

      const created = await this.supabase.createCampaignDetail({
        inputDataId: detail?.id,
        campaignId: campaign.id,
        accountId,
        actionCode: actionDetail.actionCode ?? null,
        actionName: actionDetail.actionName || this.getAccountActionName(actionDetail.actionCode || ''),
        status: actionDetail.status,
        errorCode: actionDetail.errorCode ?? null,
        log: actionDetail.log || undefined,
        data: actionDetail.data || {},
        shouldCountAction: actionDetail.countsTowardLimit === true
      })

      const output = (step.output || {}) as Record<string, unknown>
      const trackingMessageId = Number(output.emailTrackingMessageId)
      if (Number.isFinite(trackingMessageId) && trackingMessageId > 0) {
        await this.supabase.linkEmailMessageTrackingToDetail(trackingMessageId, created.id).catch(err => {
          const message = err instanceof Error ? err.message : String(err)
          console.warn('[EmailRuntime] failed to link campaign detail to tracking row:', err)
          return campaignRunEventRepo.createCampaignRunEvents([{
            campaignId: campaign.id,
            campaignActionId: campaign.actionId,
            campaignInputId: detail?.inputId ?? null,
            campaignInputDataId: detail?.id ?? null,
            accountId,
            runId: step.runId ?? null,
            runStepId: step.id ?? null,
            nodeId: step.nodeId ?? null,
            blockId: step.blockId ?? null,
            blockName: step.blockName ?? null,
            eventType: 'email_tracking_link_failed',
            eventName: 'email_tracking_link_failed',
            targetType: 'email',
            status: 'warning',
            isUserVisible: false,
            message: 'Email đã gửi nhưng không gắn được tracking với lịch sử hành động',
            debugData: {
              trackingMessageId,
              campaignDetailId: created.id,
              error: message
            }
          }]).catch(eventErr => {
            console.warn('[EmailRuntime] failed to log email tracking link warning:', eventErr)
          })
        })
      }

      if (actionDetail.countsTowardBadTarget !== false) {
        this.recordMilestoneSummary(
          summary,
          created.status,
          created.log || actionDetail.log,
          created.actionName || actionDetail.actionName,
          this.getCampaignDetailRootReason(created) || this.getCampaignDetailRootReason(actionDetail as Partial<CampaignDetail>)
        )
      } else if (created.status === 'thành công') {
        summary.hasSuccess = true
      }

      if (created.log) {
        await this.logCampaignProgress(campaign.id, this.formatZaloProgressLog({
          ...actionDetail,
          actionName: created.actionName || actionDetail.actionName,
          log: created.log
        }))
      }
    }

    return summary
  }

  private async logZaloMessagePhoneMilestones(
    campaign: Campaign,
    detail: CampaignInputData | null,
    accountId: number,
    steps: RunStepV2[]
  ): Promise<MilestoneSummary> {
    const summary = this.createMilestoneSummary()
    const loggedBlocks = new Set<string>()
    const smsPushDetails: CampaignDetail[] = []

    for (const step of steps) {
      const blockName = step.blockName || ''
      if (!blockName.startsWith('zalo_')) continue
      if (loggedBlocks.has(`${step.nodeId || ''}:${blockName}:${step.startedAt || ''}`)) continue
      loggedBlocks.add(`${step.nodeId || ''}:${blockName}:${step.startedAt || ''}`)

      const actionDetail = this.getZaloActionDetailFromStep(step)
      if (!actionDetail) continue

      if (actionDetail.preventInputRetry) {
        // A successful first send cannot be rolled back. This terminal marker
        // wins over retry requests from every action before or after it.
        summary.preventInputRetry = true
        summary.resetInputToPending = false
        summary.inputCompletionNote = actionDetail.log || summary.inputCompletionNote
      } else if (actionDetail.resetInputToPending && !summary.preventInputRetry) {
        summary.resetInputToPending = true
        summary.pendingNote = actionDetail.pendingNote || actionDetail.log || summary.pendingNote
      }
      if (actionDetail.stopAfterTarget) {
        summary.stopAfterTarget = true
      }

      if (actionDetail.createDetail === false || !actionDetail.status) {
        if (actionDetail.log) {
          await this.logCampaignProgress(campaign.id, `⚠️ ${this.formatZaloProgressLog(actionDetail)}`)
        }
        continue
      }

      const created = await this.supabase.createCampaignDetail({
        inputDataId: detail?.id,
        campaignId: campaign.id,
        accountId,
        actionCode: actionDetail.actionCode ?? null,
        actionName: actionDetail.actionName || this.getAccountActionName(actionDetail.actionCode || ''),
        status: actionDetail.status,
        errorCode: actionDetail.errorCode ?? null,
        log: actionDetail.log || undefined,
        data: actionDetail.data || {},
        shouldCountAction: actionDetail.countsTowardLimit === true
      })
      smsPushDetails.push(created)

      if (actionDetail.countsTowardBadTarget !== false) {
        this.recordMilestoneSummary(
          summary,
          created.status,
          created.log || actionDetail.log,
          created.actionName || actionDetail.actionName,
          this.getCampaignDetailRootReason(created) || this.getCampaignDetailRootReason(actionDetail as Partial<CampaignDetail>)
        )
      }

      if (created.log) {
        await this.logCampaignProgress(campaign.id, this.formatZaloProgressLog({
          ...actionDetail,
          actionName: created.actionName || actionDetail.actionName,
          log: created.log
        }))
      }
    }

    for (const created of smsPushDetails) {
      try {
        if (campaign.extraSettings?.internalSmsEnabled === true) {
          await this.pushZaloDetailToInternalSmsIfNeeded(campaign, detail, created)
        } else {
          await this.pushZaloDetailToExternalSmsIfNeeded(campaign, detail, created)
        }
      } catch (err) {
        console.error('Failed to process SMS push for Zalo detail:', err)
        await this.logExternalPushWarning(campaign, 'Không thể xử lý kiêm gửi SMS', err)
      }
    }

    return summary
  }

  /**
   * Per-milestone logging cho engine v2.
   * Scan steps theo block_name (cố định) để biết bước nào succeeded:
   *   - fb_click_post_button → "Đăng bài"
   *   - fb_comment_at_position/fb_comment_current_post → "Comment"
   *   - fb_send_message/fb_send_page_inbox_message → "Nhắn tin"
   *   - fb_add_friend → "Kết bạn"
   * Mỗi milestone ghi 1 row vào auto_campaign_details với status:
   *   - 'thành công' = action OK
   *   - 'thất bại'   = nghiệp vụ FB từ chối (output.ok=false không exception)
   *   - 'lỗi'        = exception/crash code (step.status='error')
   */
  private async logMilestonesV2(
    campaign: Campaign,
    detail: CampaignInputData | null,
    accountId: number,
    steps: RunStepV2[],
    overallSuccess: boolean,
    screenshotProgressLogs: BlockScreenshotProgressLog[] = [],
    consumedGroupPostInputDataIds?: Set<number>
  ): Promise<MilestoneSummary> {
    void overallSuccess
    const summary = this.createMilestoneSummary()
    const createCampaignDetail = async (action: Partial<CampaignDetail> & { shouldCountAction?: boolean }) => {
      const created = await this.supabase.createCampaignDetail(action)
      this.recordMilestoneSummary(
        summary,
        created.status,
        created.log || action.log,
        created.actionName || action.actionName,
        this.getCampaignDetailRootReason(created) || this.getCampaignDetailRootReason(action)
      )
      return created
    }
    const inputDataName = this.getInputDataDisplayName(campaign, detail, '')
    const pendingScreenshotLogs = screenshotProgressLogs
    const matchesScreenshotStep = (log: BlockScreenshotProgressLog, step: RunStepV2): boolean => {
      if (log.runStepId != null && step.id != null) return Number(log.runStepId) === Number(step.id)
      const nodeMatches = !!log.nodeId && !!step.nodeId && log.nodeId === step.nodeId
      const blockNameMatches = !!log.blockName && !!step.blockName && log.blockName === step.blockName
      const blockIdMatches = log.blockId != null && step.blockId != null && Number(log.blockId) === Number(step.blockId)
      return nodeMatches && (blockNameMatches || blockIdMatches)
    }
    const flushScreenshotLog = async (log: BlockScreenshotProgressLog) => {
      await this.logCampaignProgress(campaign.id, log.storedMessage, {
        realtimeMessage: log.realtimeMessage,
        realtimeAction: log.action
      })
    }
    const flushScreenshotLogsForStep = async (step?: RunStepV2 | null) => {
      if (!step) return
      for (let index = 0; index < pendingScreenshotLogs.length;) {
        const log = pendingScreenshotLogs[index]
        if (!matchesScreenshotStep(log, step)) {
          index += 1
          continue
        }
        pendingScreenshotLogs.splice(index, 1)
        await flushScreenshotLog(log)
      }
    }
    const flushRemainingScreenshotLogs = async () => {
      while (pendingScreenshotLogs.length > 0) {
        const log = pendingScreenshotLogs.shift()
        if (log) await flushScreenshotLog(log)
      }
    }

    if (this.isZaloBrowserlessCampaign(campaign)) {
      await flushRemainingScreenshotLogs()
      return this.logZaloMessagePhoneMilestones(campaign, detail, accountId, steps)
    }

    if (campaign.actionId === EMAIL_SEND_ACTION_ID) {
      await flushRemainingScreenshotLogs()
      return this.logEmailSendMilestones(campaign, detail, accountId, steps)
    }

    // Tìm kiếm data — 1 milestone tổng kết, dữ liệu chi tiết nằm trong JSONB data.
    if (campaign.actionId === FIND_DATA_GROUP_ACTION_ID || campaign.actionId === FIND_DATA_SEARCH_ACTION_ID) {
      const isFindDataSearch = campaign.actionId === FIND_DATA_SEARCH_ACTION_ID
      const summaryStep = steps.find(s => s.blockName === (isFindDataSearch ? 'fb_find_search_data_summary' : 'fb_find_group_data_summary'))
      const errorStep = steps.find(s => s.status === 'error')
      const out = ((summaryStep?.output as any) || {}) as {
        phones?: unknown[]
        linkGroupZalos?: unknown[]
        uids?: unknown[]
        postLinks?: unknown[]
        groupMembers?: unknown[]
        facebookGroups?: unknown[]
        uidProfiles?: unknown[]
        phoneProfiles?: unknown[]
        sourceCounts?: unknown
        message?: string
        groupUrl?: string
        searchKeyword?: string
        total?: number
        error?: string
      }
      const rawPhones = Array.isArray(out.phones) ? out.phones.map(String) : []
      const rawLinkGroupZalos = Array.isArray(out.linkGroupZalos) ? out.linkGroupZalos.map(String) : []
      const rawUids = Array.isArray(out.uids) ? out.uids.map(String) : []
      const rawPostLinks = Array.isArray(out.postLinks)
        ? out.postLinks.map(link => this.cleanPostLinkForStorage(String(link))).filter(Boolean)
        : []
      const rawGroupMembers = this.normalizeFoundGroupMembers(out.groupMembers)
      const rawFacebookGroups = this.normalizeFoundFacebookGroups(out.facebookGroups)
      const rawUidProfiles = this.normalizeFoundUidProfiles(out.uidProfiles)
      const rawPhoneProfiles = this.normalizeFoundPhoneProfiles(out.phoneProfiles)
      const sourceCounts = this.normalizeFindDataSourceCounts(out.sourceCounts)
      const targetName = isFindDataSearch
        ? (String(out.searchKeyword || '').trim() || inputDataName || detail?.uid || 'từ khóa search')
        : (inputDataName || out.groupUrl || 'group')
      const isSuccess = summaryStep?.status === 'success'
      const previousInputValues = isSuccess
        ? await this.getPreviouslyFoundValuesForInputData(campaign.id, detail?.id)
        : this.createEmptyFindDataPreviousValues()
      const isFollowUpInputRun = previousInputValues.detailCount > 0
      const scanGroupMembers = this.filterNewGroupMembers(rawGroupMembers, new Set<string>())
      const scanGroupMemberUidKeys = this.getGroupMemberUidKeys(scanGroupMembers)
      const scanUids = this.filterNewUidValues(rawUids, new Set<string>())
        .filter(uid => !scanGroupMemberUidKeys.has(this.normalizeUidForCompare(uid)))
      const scanPhones = this.filterNewExternalValues(rawPhones, new Set<string>())
      const scanLinkGroupZalos = this.filterNewExternalValues(rawLinkGroupZalos, new Set<string>())
      const scanPostLinks = this.filterNewPostLinkValues(rawPostLinks, new Set<string>())
      const scanFacebookGroups = this.filterNewFacebookGroups(rawFacebookGroups, new Set<string>())
      const groupMembers = this.filterNewGroupMembers(rawGroupMembers, previousInputValues.uids)
      const groupMemberUidKeys = this.getGroupMemberUidKeys(groupMembers)
      const uids = this.filterNewUidValues(rawUids, previousInputValues.uids)
        .filter(uid => !groupMemberUidKeys.has(this.normalizeUidForCompare(uid)))
      const phones = this.filterNewExternalValues(rawPhones, previousInputValues.phones)
      const linkGroupZalos = this.filterNewExternalValues(rawLinkGroupZalos, previousInputValues.linkGroupZalos)
      const postLinks = this.filterNewPostLinkValues(rawPostLinks, previousInputValues.postLinks)
      const facebookGroups = this.filterNewFacebookGroups(rawFacebookGroups, previousInputValues.facebookGroups)
      const uidProfiles = this.filterUidProfilesByUids(rawUidProfiles, uids)
      const phoneProfiles = this.filterPhoneProfilesByPhones(rawPhoneProfiles, phones)
      const groupMemberNameByUid = new Map<string, string>()
      for (const member of groupMembers) {
        const key = this.normalizeUidForCompare(member.uid)
        if (key && member.name && !groupMemberNameByUid.has(key)) groupMemberNameByUid.set(key, member.name)
      }
      for (const profile of uidProfiles) {
        const key = this.normalizeUidForCompare(profile.uid)
        if (key && profile.name && !groupMemberNameByUid.has(key)) groupMemberNameByUid.set(key, profile.name)
      }
      const rawCounts = {
        phones: scanPhones.length,
        linkGroupZalos: scanLinkGroupZalos.length,
        uids: scanUids.length,
        postLinks: scanPostLinks.length,
        groupMembers: scanGroupMembers.length,
        facebookGroups: scanFacebookGroups.length,
        total: scanPhones.length + scanLinkGroupZalos.length + scanUids.length + scanPostLinks.length + scanGroupMembers.length + scanFacebookGroups.length
      }
      const filteredCounts = {
        phones: phones.length,
        linkGroupZalos: linkGroupZalos.length,
        uids: uids.length,
        postLinks: postLinks.length,
        groupMembers: groupMembers.length,
        facebookGroups: facebookGroups.length,
        total: phones.length + linkGroupZalos.length + uids.length + postLinks.length + groupMembers.length + facebookGroups.length
      }
      const duplicateCounts = {
        phones: Math.max(0, rawCounts.phones - filteredCounts.phones),
        linkGroupZalos: Math.max(0, rawCounts.linkGroupZalos - filteredCounts.linkGroupZalos),
        uids: Math.max(0, rawCounts.uids - filteredCounts.uids),
        postLinks: Math.max(0, rawCounts.postLinks - filteredCounts.postLinks),
        groupMembers: Math.max(0, rawCounts.groupMembers - filteredCounts.groupMembers),
        facebookGroups: Math.max(0, rawCounts.facebookGroups - filteredCounts.facebookGroups),
        total: Math.max(0, rawCounts.total - filteredCounts.total)
      }
      const findUidTargetCampaignIds = Array.isArray(campaign.extraSettings?.findUidTargetCampaignIds)
        ? campaign.extraSettings.findUidTargetCampaignIds
        : []
      const findPostLinkTargetCampaignIds = Array.isArray(campaign.extraSettings?.findPostLinkTargetCampaignIds)
        ? campaign.extraSettings.findPostLinkTargetCampaignIds
        : []
      const findFacebookGroupPostTargetCampaignIds = Array.isArray(campaign.extraSettings?.findFacebookGroupPostTargetCampaignIds)
        ? campaign.extraSettings.findFacebookGroupPostTargetCampaignIds
        : []
      const findFacebookGroupCommentTargetCampaignIds = Array.isArray(campaign.extraSettings?.findFacebookGroupCommentTargetCampaignIds)
        ? campaign.extraSettings.findFacebookGroupCommentTargetCampaignIds
        : []
      const findFacebookGroupJoinTargetCampaignIds = Array.isArray(campaign.extraSettings?.findFacebookGroupJoinTargetCampaignIds)
        ? campaign.extraSettings.findFacebookGroupJoinTargetCampaignIds
        : []
      const findPhoneSmsTargetCampaignIds = Array.isArray(campaign.extraSettings?.findPhoneSmsTargetCampaignIds)
        ? campaign.extraSettings.findPhoneSmsTargetCampaignIds
        : []
      const findPhoneZaloWebTargetCampaignIds = Array.isArray(campaign.extraSettings?.findPhoneZaloWebTargetCampaignIds)
        ? campaign.extraSettings.findPhoneZaloWebTargetCampaignIds
        : []
      const findPhoneZaloMessagePhoneTargetCampaignIds = Array.isArray(campaign.extraSettings?.findPhoneZaloMessagePhoneTargetCampaignIds)
        ? campaign.extraSettings.findPhoneZaloMessagePhoneTargetCampaignIds
        : []
      const findZaloGroupLinkWebTargetCampaignIds = Array.isArray(campaign.extraSettings?.findZaloGroupLinkWebTargetCampaignIds)
        ? campaign.extraSettings.findZaloGroupLinkWebTargetCampaignIds
        : []
      const findZaloGroupLinkJoinTargetCampaignIds = Array.isArray(campaign.extraSettings?.findZaloGroupLinkJoinTargetCampaignIds)
        ? campaign.extraSettings.findZaloGroupLinkJoinTargetCampaignIds
        : []
      const findPhoneAkaBizDesktopTargetCampaignIds = Array.isArray(campaign.extraSettings?.findPhoneAkaBizDesktopTargetCampaignIds)
        ? campaign.extraSettings.findPhoneAkaBizDesktopTargetCampaignIds
        : []
      const findZaloGroupLinkAkaBizDesktopTargetCampaignIds = Array.isArray(campaign.extraSettings?.findZaloGroupLinkAkaBizDesktopTargetCampaignIds)
        ? campaign.extraSettings.findZaloGroupLinkAkaBizDesktopTargetCampaignIds
        : []
      const successLog = this.formatFindDataLogMessage(
        targetName,
        {
          phones: phones.length,
          linkGroupZalos: linkGroupZalos.length,
          uids: uids.length,
          postLinks: postLinks.length,
          groupMembers: groupMembers.length,
          facebookGroups: facebookGroups.length
        },
        sourceCounts,
        campaign.extraSettings || {},
        { isFollowUpInputRun, isSearch: isFindDataSearch }
      )
      const errMsg = out.error || summaryStep?.error || errorStep?.error || 'Lỗi không xác định'
      const previousCampaignValues = isSuccess
        ? await this.getPreviouslyFoundValues(campaign.id)
        : this.createEmptyFindDataPreviousValues()

      try {
        await createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionName: 'Tìm data',
          status: isSuccess ? 'thành công' : 'lỗi',
          log: isSuccess
            ? successLog
            : `Lỗi tìm data ${isFindDataSearch ? 'bằng search' : 'trong group'} ${targetName}: ${errMsg}`,
          data: {
            groupUrl: isFindDataSearch ? targetName : (out.groupUrl || detail?.uid),
            searchKeyword: isFindDataSearch ? targetName : undefined,
            phones,
            linkGroupZalos,
            uids,
            postLinks,
            groupMembers,
            facebookGroups,
            uidProfiles,
            phoneProfiles,
            counts: filteredCounts,
            rawCounts,
            duplicateCounts,
            isFollowUpInputRun,
            sourceCounts,
            findUidTargetCampaignIds,
            findPostLinkTargetCampaignIds,
            findFacebookGroupPostTargetCampaignIds,
            findFacebookGroupCommentTargetCampaignIds,
            findFacebookGroupJoinTargetCampaignIds,
            findPhoneSmsTargetCampaignIds,
            findPhoneZaloWebTargetCampaignIds,
            findPhoneZaloMessagePhoneTargetCampaignIds,
            findZaloGroupLinkWebTargetCampaignIds,
            findZaloGroupLinkJoinTargetCampaignIds,
            findPhoneAkaBizDesktopTargetCampaignIds,
            findZaloGroupLinkAkaBizDesktopTargetCampaignIds,
            findDataTargetDataGroups: campaign.extraSettings?.findDataTargetDataGroups || {},
            error: isSuccess ? undefined : errMsg,
            errorBlock: errorStep?.blockName
          }
        })
        if (isSuccess) await this.logCampaignProgress(campaign.id, `✅ ${successLog}`)
        else await this.logCampaignProgress(campaign.id, `❌ Lỗi tìm data ${isFindDataSearch ? 'bằng search' : 'trong group'} "${targetName}": ${errMsg}`)
        await flushScreenshotLogsForStep(summaryStep || errorStep)
      } catch (err) { console.error('Failed log find data:', err) }

      if (isSuccess) {
        const foundUidsForPush = [
          ...groupMembers.map(member => member.uid),
          ...uids
        ]
        const newUidsForInternal = this.filterNewUidValues(foundUidsForPush, previousCampaignValues.uids)
        const newPostLinksForInternal = this.filterNewPostLinkValues(postLinks, previousCampaignValues.postLinks)
        const newPhonesForExternal = this.filterNewExternalValues(phones, previousCampaignValues.phones)
        const newZaloGroupLinksForExternal = this.filterNewExternalValues(linkGroupZalos, previousCampaignValues.linkGroupZalos)
        const newFacebookGroupsForInternal = this.filterNewFacebookGroups(facebookGroups, previousCampaignValues.facebookGroups)
        const newPhoneProfilesForExternal = this.filterPhoneProfilesByPhones(phoneProfiles, newPhonesForExternal)
        await this.logFindDataDuplicatePushSummary(campaign, {
          label: 'UID',
          foundCount: foundUidsForPush.length,
          pushedCount: newUidsForInternal.length,
          hasTarget: this.getFindDataConfiguredTargetCampaignIds(findUidTargetCampaignIds, campaign.id).length > 0
        })
        await this.logFindDataDuplicatePushSummary(campaign, {
          label: 'link bài post',
          foundCount: postLinks.length,
          pushedCount: newPostLinksForInternal.length,
          hasTarget: this.getFindDataConfiguredTargetCampaignIds(findPostLinkTargetCampaignIds, campaign.id).length > 0
        })
        await this.logFindDataDuplicatePushSummary(campaign, {
          label: 'link group Facebook',
          foundCount: facebookGroups.length,
          pushedCount: newFacebookGroupsForInternal.length,
          hasTarget: [
            ...this.getFindDataConfiguredTargetCampaignIds(findFacebookGroupPostTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findFacebookGroupCommentTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findFacebookGroupJoinTargetCampaignIds, campaign.id)
          ].length > 0
        })
        await this.logFindDataDuplicatePushSummary(campaign, {
          label: 'SĐT',
          foundCount: phones.length,
          pushedCount: newPhonesForExternal.length,
          hasTarget: [
            ...this.getFindDataConfiguredTargetCampaignIds(findPhoneSmsTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findPhoneZaloWebTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findPhoneZaloMessagePhoneTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findPhoneAkaBizDesktopTargetCampaignIds, campaign.id)
          ].length > 0
        })
        await this.logFindDataDuplicatePushSummary(campaign, {
          label: 'link group Zalo',
          foundCount: linkGroupZalos.length,
          pushedCount: newZaloGroupLinksForExternal.length,
          hasTarget: [
            ...this.getFindDataConfiguredTargetCampaignIds(findZaloGroupLinkWebTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findZaloGroupLinkJoinTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findZaloGroupLinkAkaBizDesktopTargetCampaignIds, campaign.id)
          ].length > 0
        })
        await this.pushFoundDataToDataGroups(campaign, accountId, detail, summaryStep, targetName, {
          phones: scanPhones,
          linkGroupZalos: scanLinkGroupZalos,
          uids: scanUids,
          postLinks: scanPostLinks,
          groupMembers: scanGroupMembers,
          facebookGroups: scanFacebookGroups,
          uidProfiles: rawUidProfiles,
          phoneProfiles: rawPhoneProfiles
        })
        await this.pushFoundUidsToTargetCampaigns(campaign, newUidsForInternal, groupMemberNameByUid)
        await this.pushFoundPostLinksToTargetCampaigns(campaign, newPostLinksForInternal)
        await this.pushFoundFacebookGroupsToTargetCampaigns(campaign, newFacebookGroupsForInternal)
        await this.pushFoundPhonesToSmsCampaigns(campaign, newPhonesForExternal, newPhoneProfilesForExternal)
        await this.pushFoundPhonesToZaloWebCampaigns(campaign, newPhonesForExternal, newPhoneProfilesForExternal)
        await this.pushFoundPhonesToZaloMessagePhoneCampaigns(campaign, newPhonesForExternal, newPhoneProfilesForExternal)
        await this.pushFoundZaloGroupLinksToZaloWebCampaigns(campaign, newZaloGroupLinksForExternal)
        await this.pushFoundZaloGroupLinksToJoinCampaigns(campaign, newZaloGroupLinksForExternal)
        await this.pushFoundPhonesToAkaBizDesktopCampaigns(campaign, newPhonesForExternal, newPhoneProfilesForExternal)
        await this.pushFoundZaloGroupLinksToAkaBizDesktopCampaigns(campaign, newZaloGroupLinksForExternal)
      }
      await flushRemainingScreenshotLogs()
      return summary
    }

    if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
      for (const s of steps) await this.logNewsfeedMilestoneStep(campaign, detail, accountId, s)
      const hasNewsfeedSuccess = steps.some(s => {
        const out = (s.output as any) || {}
        return (
          (s.blockName === 'fb_newsfeed_like_post' && out.liked === true) ||
          (s.blockName === 'fb_newsfeed_comment_submit' && out.commented === true)
        )
      })
      if (hasNewsfeedSuccess) this.recordMilestoneSummary(summary, 'thành công', 'Tương tác newsfeed thành công')
      await flushRemainingScreenshotLogs()
      return summary
    }

    if (campaign.actionId === FACEBOOK_JOIN_GROUP_ACTION_ID) {
      const joinGroupSteps = steps.filter(s =>
        s.blockName === 'fb_join_group' &&
        (s.status === 'success' || s.status === 'error')
      )
      for (const s of joinGroupSteps) {
        try {
          const out = (s.output as any) || {}
          const outcome = String(out.joinOutcome || '').trim()
          const targetUrl = String(out.targetUrl || detail?.uid || '').trim()
          const targetUid = String(out.targetUid || detail?.uid || '').trim()
          const groupName = String(out.targetName || inputDataName || targetUid || targetUrl || 'group').trim()
          const errMsg = String(out.error || out.message || s.error || 'Lỗi không xác định').trim()
          const isError = s.status === 'error'
          const isFailure = !isError && out.ok === false
          const isSuccess = !isError && !isFailure
          const status: CampaignDetailStatus = isError ? 'lỗi' : isFailure ? 'thất bại' : outcome === 'already_joined' ? 'đã tham gia' : 'thành công'
          const errorCode = status === 'lỗi' ? this.normalizeRuntimeError(campaign, [s], errMsg).errorCode : undefined
          const shouldCountAction = outcome !== 'already_joined'
          const log = (() => {
            if (status === 'lỗi') return `Lỗi tham gia group ${groupName}: ${errMsg}`
            if (status === 'thất bại') return `Tham gia group thất bại ${groupName}: ${errMsg}`
            if (outcome === 'requested') return `Đã gửi yêu cầu tham gia group ${groupName}`
            if (outcome === 'already_joined') return `Bỏ qua group ${groupName} (đã tham gia từ trước)`
            return `Đã tham gia group ${groupName}`
          })()

          await createCampaignDetail({
            inputDataId: detail?.id,
            campaignId: campaign.id,
            accountId,
            actionCode: 'fb_join_group',
            actionName: 'Tham gia group',
            status,
            errorCode,
            log,
            shouldCountAction,
            data: {
              joinOutcome: outcome || undefined,
              statusCode: out.statusCode,
              targetUrl,
              targetUid,
              targetName: groupName,
              questionStats: out.questionStats,
              error: isSuccess ? undefined : errMsg
            }
          })

          if (isSuccess) {
            if (outcome === 'already_joined') {
              await this.logCampaignProgress(campaign.id, `ℹ️ Bỏ qua group "${groupName}" vì đã tham gia từ trước`)
            } else if (outcome === 'requested') {
              await this.logCampaignProgress(campaign.id, `✅ Đã gửi yêu cầu tham gia group "${groupName}"`)
            } else {
              await this.logCampaignProgress(campaign.id, `✅ Đã tham gia group "${groupName}"`)
            }
          } else if (status === 'lỗi') {
            await this.logCampaignProgress(campaign.id, `❌ Lỗi tham gia group "${groupName}": ${errMsg}`)
          } else {
            await this.logCampaignProgress(campaign.id, `❌ Tham gia group thất bại "${groupName}": ${errMsg}`)
          }
          await flushScreenshotLogsForStep(s)
        } catch (err) { console.error('Failed log Facebook join group:', err) }
      }
      await flushRemainingScreenshotLogs()
      return summary
    }

    // Đăng bài fanpage — API block trả ok=false cho lỗi Graph; UI workflow mới dùng các block nhỏ.
    const pagePostSteps = campaign.actionId === PAGE_POST_ACTION_ID
      ? steps.filter(s => (
          s.blockName === 'fb_page_post_api' ||
          s.blockName === 'fb_post_current_identity_ui'
        ) && (s.status === 'success' || s.status === 'error'))
      : []
    const switchToPageStep = campaign.actionId === PAGE_POST_ACTION_ID
      ? steps.find(s => s.nodeId === 'switch_to_page' && s.blockName === 'fb_switch_identity_by_name')
      : undefined
    const restoreStep = campaign.actionId === PAGE_POST_ACTION_ID
      ? [...steps].reverse().find(s => s.nodeId === 'restore_original_identity' && s.blockName === 'fb_switch_identity_by_name')
      : undefined
    for (const s of pagePostSteps) {
      try {
        const out = (s.output as any) || {}
        const graphError = (out.graphError && typeof out.graphError === 'object') ? out.graphError : {}
        const mode = String(out.mode || (s.blockName === 'fb_page_post_api' ? 'api' : 'ui')).trim()
        const isUiMode = mode === 'ui' || s.blockName === 'fb_post_current_identity_ui'
        const pageUid = String(out.pageUid || detail?.uid || '').trim()
        const pageName = String(out.pageName || inputDataName || pageUid || 'fanpage').trim()
        const postId = String(out.postId || '').trim()
        const postUrl = String(out.postUrl || '').trim()
        const imageCount = Number(out.imageCount || 0)
        const restoreOut = (restoreStep?.output as any) || {}
        const restoreOk = out.restoreOk === true || restoreOut.ok === true
        const failureMessage = String(
          out.error ||
          out.message ||
          graphError.message ||
          s.error ||
          'Lỗi không xác định'
        ).trim()
        const status: 'thành công' | 'thất bại' | 'lỗi' =
          s.status === 'error' ? 'lỗi'
          : (out.ok === true || out.posted === true) ? 'thành công'
          : 'thất bại'

        await createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionCode: 'fb_post_page',
          actionName: 'Đăng bài fanpage',
          status,
          log: status === 'thành công'
            ? `Đăng bài fanpage thành công vào ${pageName}${postId ? ` (${postId})` : ''}`
            : status === 'thất bại' && !isUiMode
              ? `Facebook API từ chối đăng fanpage ${pageName}: ${failureMessage}`
              : status === 'thất bại'
                ? `Đăng fanpage trên giao diện thất bại ${pageName}: ${failureMessage}`
              : `Lỗi đăng fanpage ${pageName}: ${failureMessage}`,
          postUrl: postUrl || undefined,
          data: {
            mode,
            pageUid,
            pageName,
            postId: postId || undefined,
            postUrl: postUrl || undefined,
            imageCount,
            restoreOk,
            graphResponse: out.graphResponse,
            graphError: Object.keys(graphError).length > 0 ? graphError : undefined,
            error: status === 'thành công' ? undefined : failureMessage
          }
        })

        if (status === 'thành công') {
          await this.logCampaignProgress(campaign.id, `📝 Đăng bài fanpage thành công vào "${pageName}"`)
          if (postUrl) await this.logCampaignProgress(campaign.id, `🔗 Link bài post: ${postUrl}`)
        } else if (status === 'thất bại' && !isUiMode) {
          await this.logCampaignProgress(campaign.id, `❌ Facebook API từ chối đăng fanpage "${pageName}": ${failureMessage}`)
        } else if (status === 'thất bại') {
          await this.logCampaignProgress(campaign.id, `❌ Đăng fanpage trên giao diện thất bại "${pageName}": ${failureMessage}`)
        } else {
          await this.logCampaignProgress(campaign.id, `❌ Lỗi đăng fanpage "${pageName}": ${failureMessage}`)
        }
        await flushScreenshotLogsForStep(s)
      } catch (err) { console.error('Failed log page post:', err) }
    }

    if (campaign.actionId === PAGE_POST_ACTION_ID && pagePostSteps.length === 0 && switchToPageStep) {
      try {
        const out = (switchToPageStep.output as any) || {}
        if (switchToPageStep.status === 'error' || out.ok !== true) {
          const pageUid = String(detail?.uid || '').trim()
          const pageName = String(inputDataName || pageUid || 'fanpage').trim()
          const restoreOut = (restoreStep?.output as any) || {}
          const restoreOk = restoreOut.ok === true
          const failureMessage = String(
            out.message ||
            out.error ||
            switchToPageStep.error ||
            'Không chuyển được sang fanpage'
          ).trim()
          const status: 'thành công' | 'thất bại' | 'lỗi' = switchToPageStep.status === 'error' ? 'lỗi' : 'thất bại'
          await createCampaignDetail({
            inputDataId: detail?.id,
            campaignId: campaign.id,
            accountId,
            actionCode: 'fb_post_page',
            actionName: 'Đăng bài fanpage',
            status,
            log: status === 'lỗi'
              ? `Lỗi chuyển sang fanpage ${pageName}: ${failureMessage}`
              : `Không chuyển được sang fanpage ${pageName}: ${failureMessage}`,
            data: {
              mode: 'ui',
              pageUid,
              pageName,
              restoreOk,
              error: failureMessage
            }
          })
          await this.logCampaignProgress(campaign.id, `❌ Không chuyển được sang fanpage "${pageName}": ${failureMessage}`)
          await flushScreenshotLogsForStep(switchToPageStep)
        }
      } catch (err) { console.error('Failed log page switch:', err) }
    }

    // Đăng bài group — xác nhận submit bằng việc form đóng, rồi lưu link bài vừa đăng nếu lấy được.
    const groupPostVerifySteps = campaign.actionId === 'facebook_group_post'
      ? steps.filter(s => s.blockName === 'fb_verify_group_post_form_closed' && (s.status === 'success' || s.status === 'error'))
      : []
    for (const s of groupPostVerifySteps) {
      try {
        const out = (s.output as any) || {}
        const posted = s.status === 'success' && (out.posted === true || out.ok === true)
        const linkStep = [...steps].reverse().find(x => x.blockName === 'fb_get_first_group_post_link' && x.status === 'success')
        const linkOut = ((linkStep?.output as any) || {}) as { postUrl?: unknown; link?: unknown; rawPostLink?: unknown }
        const postUrl = posted
          ? this.cleanPostLinkForStorage(String(linkOut.postUrl || linkOut.link || out.postUrl || ''))
          : ''
        const detectStep = [...steps].reverse().find(x => x.blockName === 'fb_detect_pending_post' && x.status === 'success')
        const detectOut = ((detectStep?.output as any) || {}) as {
          isPending?: unknown
          pendingCheckConclusive?: unknown
          pendingContentUrl?: unknown
          pendingContentLinks?: unknown
          source?: unknown
        }
        const detectHasIsPending = typeof detectOut.isPending === 'boolean'
        const pendingCheckConclusive = detectOut.pendingCheckConclusive === false
          ? false
          : detectHasIsPending
        const isPending = detectHasIsPending ? detectOut.isPending === true : postUrl.includes('/pending_posts/')
        const requiresPostApproval = posted
          ? (isPending ? true : (pendingCheckConclusive ? false : undefined))
          : undefined
        const rawPostLink = String(linkOut.rawPostLink || '').trim()
        const failureMessage = String(s.error || out.error || out.message || 'Form đăng bài chưa đóng sau 60 giây')
        const status: 'thành công' | 'thất bại' | 'lỗi' =
          posted ? 'thành công'
          : s.status === 'error' ? 'lỗi'
          : 'thất bại'
        const errorCode = status === 'lỗi'
          ? this.normalizeRuntimeError(campaign, [s], failureMessage).errorCode
          : undefined
        const pendingContentLinks = Array.isArray(detectOut.pendingContentLinks)
          ? detectOut.pendingContentLinks.map(link => String(link || '').trim()).filter(Boolean)
          : undefined
        const pendingApprovalLog = this.formatGroupPendingProgressLog(isPending, pendingCheckConclusive)
        await createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionCode: this.getPostActionCode(campaign),
          actionName: 'Đăng bài',
          status,
          errorCode,
          log: posted
            ? (detail ? `Đăng bài thành công vào ${inputDataName}${isPending ? ' (chờ duyệt)' : ''}` : `Đăng bài thành công${isPending ? ' (chờ duyệt)' : ''}`)
            : status === 'lỗi'
              ? (detail ? `Lỗi đăng bài vào ${inputDataName}: ${failureMessage}` : `Lỗi đăng bài: ${failureMessage}`)
              : (detail ? `Đăng bài thất bại vào ${inputDataName}: ${failureMessage}` : `Đăng bài thất bại: ${failureMessage}`),
          postUrl: postUrl || undefined,
          data: {
            isPending,
            pendingCheckConclusive,
            pendingContentUrl: typeof detectOut.pendingContentUrl === 'string' ? detectOut.pendingContentUrl : undefined,
            pendingContentLinks,
            pendingSource: typeof detectOut.source === 'string' ? detectOut.source : undefined,
            rawPostLink: rawPostLink || undefined,
            postUrl: postUrl || undefined,
            submitClosed: posted,
            errorCode,
            error: posted ? undefined : failureMessage
          }
        })
        if (posted) {
          await this.syncGroupPostContactStatus(accountId, detail, requiresPostApproval)
          const shareStep = [...steps].reverse().find(x => x.blockName === 'fb_select_group_post_share_targets' && x.status === 'success')
          const shareOut = ((shareStep?.output as any) || {}) as { selectedTargets?: unknown }
          const rawSelectedTargets = Array.isArray(shareOut.selectedTargets) ? shareOut.selectedTargets : []
          const selectedShareTargets: GroupPostShareTarget[] = []
          const seenShareTargetIds = new Set<number>()
          for (const item of rawSelectedTargets) {
            const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
            const id = Number(record.id)
            if (!Number.isFinite(id) || id <= 0 || seenShareTargetIds.has(id)) continue
            if (detail && id === detail.id) continue
            const name = this.normalizeGroupPostShareName(record.name)
            selectedShareTargets.push({
              id,
              name: name || `group #${id}`,
              uid: String(record.uid || '').trim() || undefined
            })
            seenShareTargetIds.add(id)
          }
          for (const target of selectedShareTargets) {
            try {
              await createCampaignDetail({
                inputDataId: target.id,
                campaignId: campaign.id,
                accountId,
                actionCode: 'fb_post_group',
                actionName: 'Đăng bài',
                status: 'thành công',
                log: `Đăng bài dạng chia sẻ vào ${target.name}`,
                data: {
                  shareMode: 'group_composer_add_group',
                  sharedFromInputDataId: detail?.id ?? null,
                  sharedFromName: inputDataName || undefined,
                  targetUid: target.uid
                }
              })
              await this.supabase.updateCampaignInputData(target.id, {
                status: 'hoàn thành',
                note: 'Đăng bài dạng chia sẻ'
              })
              consumedGroupPostInputDataIds?.add(target.id)
              await this.logCampaignProgress(campaign.id, `🔁 Đã đăng bài dạng chia sẻ vào "${target.name}"`)
            } catch (shareErr) {
              console.error('Failed log group post share target:', shareErr)
            }
          }
          await this.logCampaignProgress(campaign.id, `📝 Đăng bài thành công${detail ? ` vào "${inputDataName}"` : ''}`)
          await this.logCampaignProgress(campaign.id, pendingApprovalLog)
          if (postUrl) await this.logCampaignProgress(campaign.id, `🔗 Link bài post: ${postUrl}`)
          await this.enqueuePostBumpAfterGroupPost(campaign, postUrl, isPending)
          await flushScreenshotLogsForStep(s)
        } else if (status === 'lỗi') {
          await this.logCampaignProgress(campaign.id, `❌ Lỗi đăng bài${detail ? ` vào "${inputDataName}"` : ''}: ${failureMessage}`)
          await flushScreenshotLogsForStep(s)
        } else {
          await this.logCampaignProgress(campaign.id, `❌ Đăng bài thất bại${detail ? ` vào "${inputDataName}"` : ''}: ${failureMessage}`)
          await flushScreenshotLogsForStep(s)
        }
      } catch (err) { console.error('Failed log group post:', err) }
    }

    // Đăng bài timeline hoặc fallback khi workflow group post chưa có block verify submit.
    const postSteps = groupPostVerifySteps.length > 0
      ? []
      : steps.filter(s => s.blockName === 'fb_click_post_button' && s.status === 'success')
    for (const s of postSteps) {
      try {
        const detectOut = ((steps.find(x => x.blockName === 'fb_detect_pending_post')?.output as any) || {}) as {
          isPending?: unknown
          pendingCheckConclusive?: unknown
        }
        const detectHasIsPending = typeof detectOut.isPending === 'boolean'
        const pendingCheckConclusive = detectOut.pendingCheckConclusive === false
          ? false
          : detectHasIsPending
        const isPending = detectOut.isPending === true
        await createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionCode: this.getPostActionCode(campaign),
          actionName: 'Đăng bài',
          status: 'thành công',
          log: detail ? `Đăng bài thành công vào ${inputDataName}${isPending ? ' (chờ duyệt)' : ''}` : 'Đăng bài thành công',
          data: isPending ? { isPending: true } : undefined
        })
        await this.logCampaignProgress(campaign.id, `📝 Đăng bài thành công${detail ? ` vào "${inputDataName}"` : ''}`)
        if (campaign.actionId === 'facebook_group_post') {
          await this.logCampaignProgress(campaign.id, this.formatGroupPendingProgressLog(isPending, pendingCheckConclusive))
        }
        await flushScreenshotLogsForStep(s)
      } catch (err) { console.error('Failed log post:', err) }
      void s
    }

    const groupPostCommentAdjustStep = campaign.actionId === 'facebook_group_post'
      ? [...steps].reverse().find(s => s.blockName === 'fb_adjust_group_post_comments_after_pending' && s.status === 'success')
      : undefined
    const groupPostCommentAdjustOutput = ((groupPostCommentAdjustStep?.output as any) || {}) as {
      isPending?: boolean
      skippedByGroupMode?: boolean
      skipReason?: string
    }
    const groupPostIsPending = campaign.actionId === 'facebook_group_post'
      ? (groupPostCommentAdjustOutput.isPending === true || steps.find(x => x.blockName === 'fb_detect_pending_post')?.output?.isPending === true)
      : false

    if (groupPostCommentAdjustOutput.skippedByGroupMode === true) {
      const reason = String(groupPostCommentAdjustOutput.skipReason || 'Bỏ qua comment vì group không khớp điều kiện comment')
      try {
        await this.logCampaignProgress(campaign.id, `⚠️ ${reason}${detail ? ` tại "${inputDataName}"` : ''}`)
        await flushScreenshotLogsForStep(groupPostCommentAdjustStep)
      } catch (err) { console.error('Failed append group comment skip log:', err) }
    }

    // Comment — đọc position/text từ s.output (block return) thay vì s.input
    const commentSteps = steps.filter(s =>
      (s.blockName === 'fb_comment_at_position' || s.blockName === 'fb_comment_current_post') &&
      s.status === 'success'
    )
    let loggedCommentCount = 0
    for (let i = 0; i < commentSteps.length; i++) {
      const s = commentSteps[i]
      const out = (s.output as any) || {}
      const position = Number(out.position ?? (i + 1))
      const text = String(out.text ?? '')
      const imageCount = Number(out.imageCount || 0)
      const commentFailed = out.commentFailed === true
      if (!commentFailed && (out.commented === false || (text.trim().length === 0 && imageCount <= 0))) continue
      const preview = text.length > 50 ? text.substring(0, 50) + '...' : text
      const commentType = String(campaign.extraSettings?.commentType || '')
      let target: string
      if (this.isCommentSeedingPostCampaign(campaign.actionId)) {
        target = 'bài post'
      } else if (campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID) {
        target = this.formatOrdinalPost(commentFailed ? position : loggedCommentCount + 1)
      } else if (campaign.actionId === 'facebook_group_post' && commentType === 'others') {
        target = this.formatOrdinalPost(position)
      } else if (campaign.actionId === 'facebook_group_post' && commentType === 'all') {
        target = groupPostIsPending
          ? this.formatOrdinalPost(position)
          : (position === 1 ? 'bài của mình' : this.formatOrdinalPost(position))
      } else {
        target = position === 1 ? 'bài của mình' : this.formatOrdinalPost(position)
      }
      if (commentFailed) {
        const errMsg = String(out.error || s.error || 'Không comment được bài').trim() || 'Không comment được bài'
        try {
          await createCampaignDetail({
            inputDataId: detail?.id,
            campaignId: campaign.id,
            accountId,
            actionCode: 'fb_comment',
            actionName: 'Comment',
            status: 'thất bại',
            log: `Không comment được ${target}: ${errMsg}`,
            data: {
              commentPosition: position,
              commentType: commentType || undefined,
              commentContent: text,
              commentImageCount: imageCount,
              commentFailed: true,
              error: errMsg
            }
          })
          await this.logCampaignProgress(campaign.id, `⚠️ Không comment được ${target}${detail ? ` tại "${inputDataName}"` : ''}: ${errMsg}`)
          await flushScreenshotLogsForStep(s)
        } catch (err) { console.error('Failed log failed comment:', err) }
        continue
      }

      loggedCommentCount++
      const logText = text.trim().length > 0
        ? `Đã comment vào ${target}: "${preview}"`
        : `Đã comment vào ${target}`
      try {
        await createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionCode: 'fb_comment',
          actionName: 'Comment',
          status: 'thành công',
          log: logText,
          data: { commentPosition: position, iteration: loggedCommentCount, commentType: commentType || undefined, commentContent: text, commentImageCount: imageCount }
        })
        await this.logCampaignProgress(campaign.id, `💬 Đã comment vào ${target}${detail ? ` tại "${inputDataName}"` : ''}`)
        await flushScreenshotLogsForStep(s)
      } catch (err) { console.error('Failed log comment:', err) }
    }

    // Comment seeding: không có bài phù hợp thì chỉ ghi log chiến dịch, không tạo campaign_detail.
    if (campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID && loggedCommentCount === 0) {
      const prepareStep = steps.find(s => s.blockName === 'fb_prepare_seeding_iterations')
      const out = (prepareStep?.output as any) || {}
      const matchedCount = Number(out.matchedCount ?? 0)
      if (prepareStep?.status === 'success' && matchedCount === 0) {
        const totalCount = Number(out.totalCount ?? 0)
        const extra = campaign.extraSettings || {}
        const keyword = extra.isFindPostByKeywords === true ? String(extra.postKeywords || '').trim() : ''
        const aiPrompt = extra.isFindPostByContentAI === true ? String(extra.postContentAI || '').trim() : ''
        const enabledConditions = [
          keyword ? `từ khoá "${keyword}"` : '',
          aiPrompt ? 'ý nghĩa AI' : ''
        ].filter(Boolean).join(' và ')
        const targetName = inputDataName || 'mục tiêu'
        const reason = enabledConditions
          ? (totalCount > 0
            ? `Không tìm thấy bài phù hợp với điều kiện ${enabledConditions} trong ${targetName}`
            : `Không tìm thấy bài nào để kiểm tra điều kiện ${enabledConditions} trong ${targetName}`)
          : `Không tìm thấy bài phù hợp để comment trong ${targetName}`
        await this.logCampaignProgress(campaign.id, `ℹ️ ${reason}`)
        await flushScreenshotLogsForStep(prepareStep)
      }
    }

    // Nhắn tin — phân biệt thành công / target không tồn tại / thất bại nghiệp vụ / lỗi exception.
    const msgSteps = steps.filter(s =>
      (s.blockName === 'fb_send_message' || s.blockName === 'fb_send_page_inbox_message') &&
      (s.status === 'success' || s.status === 'error')
    )
    for (const s of msgSteps) {
      const out = (s.output as any) || {}
      const errMsg = out.error || s.error || 'Lỗi không xác định'
      const isPageInboxMessage = s.blockName === 'fb_send_page_inbox_message' || campaign.actionId === PAGE_INBOX_MESSAGE_ACTION_ID
      const actionName = isPageInboxMessage ? 'Nhắn tin khách inbox page' : 'Nhắn tin'
      const reason = String(out.reason || '').trim()
      const isPageInboxTargetNotFound = isPageInboxMessage && s.status === 'success' && out.ok !== true && (
        reason === 'not_found' || reason === 'wrong_conversation'
      )
      const status: CampaignDetailStatus =
        s.status === 'error' ? 'lỗi'
        : out.ok === true ? 'thành công'
        : isPageInboxTargetNotFound ? 'không tồn tại'
        : 'thất bại'
      const errorCode = status === 'lỗi' ? this.normalizeRuntimeError(campaign, [s], errMsg).errorCode : undefined
      const failureData = status === 'thành công' ? undefined : {
        error: errMsg,
        ...(reason ? { reason } : {}),
        ...(isPageInboxTargetNotFound && out.customerName ? { customerName: out.customerName } : {}),
        ...(isPageInboxTargetNotFound && out.customerPsid ? { customerPsid: out.customerPsid } : {}),
        ...(isPageInboxTargetNotFound && out.openedName ? { openedName: out.openedName } : {})
      }
      const logText = status === 'thành công'
        ? `${actionName} thành công đến ${inputDataName}`
        : status === 'không tồn tại'
          ? `Không tìm thấy khách inbox page ${inputDataName}: ${errMsg}`
          : `Lỗi ${actionName.toLowerCase()} đến ${inputDataName}: ${errMsg}`
      try {
        await createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionCode: this.getMessageActionCode(campaign),
          actionName,
          status,
          errorCode,
          log: logText,
          data: failureData,
          shouldCountAction: isPageInboxTargetNotFound ? false : undefined
        })
        if (status === 'thành công') await this.logCampaignProgress(campaign.id, `💬 ${actionName} thành công đến "${inputDataName}"`)
        else if (status === 'không tồn tại') await this.logCampaignProgress(campaign.id, `⚠️ Không tìm thấy khách inbox page "${inputDataName}": ${errMsg}`)
        else await this.logCampaignProgress(campaign.id, `❌ Lỗi ${actionName.toLowerCase()} "${inputDataName}": ${errMsg}`)
        await flushScreenshotLogsForStep(s)
      } catch (err) { console.error('Failed log message:', err) }
    }

    // Kết bạn — alreadyFriend / clicked = thành công; ok=false không exception = thất bại; exception = lỗi
    const friendSteps = steps.filter(s =>
      s.blockName === 'fb_add_friend' &&
      (s.status === 'success' || s.status === 'error')
    )
    for (const s of friendSteps) {
      const out = (s.output as any) || {}
      const ok = s.status === 'success' && out.ok === true
      const alreadyFriend = ok && out.alreadyFriend === true
      const clicked = ok && out.clicked === true
      const errMsg = out.error || s.error || 'Lỗi không xác định'

      try {
        if (alreadyFriend) {
          await createCampaignDetail({
            inputDataId: detail?.id,
            campaignId: campaign.id,
            accountId,
            actionCode: 'fb_add_friend',
            actionName: 'Kết bạn',
            status: 'thành công',
            log: `Bỏ qua kết bạn với ${inputDataName} (đã là bạn bè hoặc nút bị ẩn)`,
            data: { alreadyFriend: true }
          })
          await this.logCampaignProgress(campaign.id, `ℹ️ Bỏ qua kết bạn với "${inputDataName}" (đã là bạn hoặc nút bị ẩn)`)
          await flushScreenshotLogsForStep(s)
        } else if (clicked) {
          await createCampaignDetail({
            inputDataId: detail?.id,
            campaignId: campaign.id,
            accountId,
            actionCode: 'fb_add_friend',
            actionName: 'Kết bạn',
            status: 'thành công',
            log: `Kết bạn thành công với ${inputDataName}`
          })
          await this.logCampaignProgress(campaign.id, `🤝 Kết bạn thành công với "${inputDataName}"`)
          await flushScreenshotLogsForStep(s)
        } else {
          // s.status='error' → 'lỗi' (crash); s.status='success' nhưng ok=false → 'thất bại' (FB từ chối)
          const status: 'thất bại' | 'lỗi' = s.status === 'error' ? 'lỗi' : 'thất bại'
          const errorCode = status === 'lỗi' ? this.normalizeRuntimeError(campaign, [s], errMsg).errorCode : undefined
          await createCampaignDetail({
            inputDataId: detail?.id,
            campaignId: campaign.id,
            accountId,
            actionCode: 'fb_add_friend',
            actionName: 'Kết bạn',
            status,
            errorCode,
            log: `Lỗi kết bạn với ${inputDataName}: ${errMsg}`,
            data: { error: errMsg }
          })
          await this.logCampaignProgress(campaign.id, `❌ Lỗi kết bạn "${inputDataName}": ${errMsg}`)
          await flushScreenshotLogsForStep(s)
        }
      } catch (err) { console.error('Failed log friend:', err) }
    }

    await flushRemainingScreenshotLogs()
    return summary
  }

  private async pushFoundUidsToTargetCampaigns(sourceCampaign: Campaign, rawUids: string[], uidNameByNormalizedUid: Map<string, string> = new Map()): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindUid) return

    const targetCampaignIds = this.getFindDataConfiguredTargetCampaignIds(
      sourceCampaign.extraSettings.findUidTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const uidMap = new Map<string, string>()
    for (const rawUid of rawUids) {
      const uid = String(rawUid || '').trim()
      const normalizedUid = this.normalizeUidForCompare(uid)
      if (uid && normalizedUid && !uidMap.has(normalizedUid)) {
        uidMap.set(normalizedUid, uid)
      }
    }
    const uids = Array.from(uidMap.values())
    if (uids.length === 0) return

    for (const targetCampaignId of targetCampaignIds) {
      try {
        const targetCampaign = await this.supabase.getCampaign(targetCampaignId)
        if (!targetCampaign || targetCampaign.actionId !== MESSAGE_UID_ACTION_ID) continue

        await this.supabase.createCampaignInputDataBatch(
          uids.map<Partial<CampaignInputData>>(uid => {
            const name = uidNameByNormalizedUid.get(this.normalizeUidForCompare(uid)) || undefined
            return {
              campaignId: targetCampaign.id,
              name,
              uid,
              status: 'chờ xử lý',
              note: `Đã thêm từ chiến dịch "${sourceCampaign.name}"`
            }
          })
        )

        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${uids.length} UID sang chiến dịch "${targetCampaign.name}"`)
        await this.logCampaignProgress(targetCampaign.id, `✅ Đã nhận ${uids.length} UID từ chiến dịch "${sourceCampaign.name}"`, { emitRealtime: false })
        const reopenedTarget = await this.supabase.reopenCompletedCampaignAfterInputInsert(
          targetCampaign.id,
          MESSAGE_UID_ACTION_ID
        )
        if (reopenedTarget) this.broadcastCampaignUpdate(reopenedTarget)
      } catch (err) {
        console.error('Failed to push found UIDs to target campaign:', err)
      }
    }
  }

  private async pushFoundPostLinksToTargetCampaigns(sourceCampaign: Campaign, rawPostLinks: string[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindPostLink) return

    const targetCampaignIds = this.getFindDataConfiguredTargetCampaignIds(
      sourceCampaign.extraSettings.findPostLinkTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const linkMap = new Map<string, string>()
    for (const rawLink of rawPostLinks) {
      const link = this.cleanPostLinkForStorage(rawLink)
      const normalizedLink = this.normalizePostLinkForCompare(link)
      if (link && normalizedLink && !linkMap.has(normalizedLink)) {
        linkMap.set(normalizedLink, link)
      }
    }
    const postLinks = Array.from(linkMap.values())
    if (postLinks.length === 0) return

    for (const targetCampaignId of targetCampaignIds) {
      try {
        const targetCampaign = await this.supabase.getCampaign(targetCampaignId)
        if (!targetCampaign || targetCampaign.actionId !== COMMENT_SEEDING_POST_ACTION_ID) continue

        await this.supabase.createCampaignInputDataBatch(
          postLinks.map<Partial<CampaignInputData>>(postLink => ({
            campaignId: targetCampaign.id,
            uid: postLink,
            status: 'chờ xử lý',
            note: `Đã thêm từ chiến dịch "${sourceCampaign.name}"`
          }))
        )

        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${postLinks.length} link bài post sang chiến dịch "${targetCampaign.name}"`)
        await this.logCampaignProgress(targetCampaign.id, `✅ Đã nhận ${postLinks.length} link bài post từ chiến dịch "${sourceCampaign.name}"`, { emitRealtime: false })
        const reopenedTarget = await this.supabase.reopenCompletedCampaignAfterInputInsert(
          targetCampaign.id,
          COMMENT_SEEDING_POST_ACTION_ID
        )
        if (reopenedTarget) this.broadcastCampaignUpdate(reopenedTarget)
      } catch (err) {
        console.error('Failed to push found post links to target campaign:', err)
      }
    }
  }

  private async pushFoundFacebookGroupsToTargetCampaigns(sourceCampaign: Campaign, rawGroups: FindDataFacebookGroup[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindFacebookGroup) return

    const targetConfigs = [
      {
        ids: this.getFindDataConfiguredTargetCampaignIds(
          sourceCampaign.extraSettings.findFacebookGroupPostTargetCampaignIds,
          sourceCampaign.id
        ),
        actionId: GROUP_POST_ACTION_ID,
        label: 'chiến dịch đăng bài group'
      },
      {
        ids: this.getFindDataConfiguredTargetCampaignIds(
          sourceCampaign.extraSettings.findFacebookGroupCommentTargetCampaignIds,
          sourceCampaign.id
        ),
        actionId: COMMENT_SEEDING_FEED_ACTION_ID,
        label: 'chiến dịch comment seeding'
      },
      {
        ids: this.getFindDataConfiguredTargetCampaignIds(
          sourceCampaign.extraSettings.findFacebookGroupJoinTargetCampaignIds,
          sourceCampaign.id
        ),
        actionId: FACEBOOK_JOIN_GROUP_ACTION_ID,
        label: 'chiến dịch tham gia group'
      }
    ]
    const hasTarget = targetConfigs.some(config => config.ids.length > 0)
    if (!hasTarget) return

    const groupMap = new Map<string, FindDataFacebookGroup>()
    for (const rawGroup of rawGroups) {
      const group = this.normalizeFoundFacebookGroup(rawGroup)
      const key = this.normalizeFacebookGroupUrlForCompare(group.url)
      if (group.url && key && !groupMap.has(key)) {
        groupMap.set(key, group)
      }
    }
    const groups = Array.from(groupMap.values())
    if (groups.length === 0) return

    for (const config of targetConfigs) {
      for (const targetCampaignId of config.ids) {
        try {
          const targetCampaign = await this.supabase.getCampaign(targetCampaignId)
          if (!targetCampaign || targetCampaign.actionId !== config.actionId) continue

          await this.supabase.createCampaignInputDataBatch(
            groups.map<Partial<CampaignInputData>>(group => ({
              campaignId: targetCampaign.id,
              name: group.name || group.url,
              uid: group.url,
              status: 'chờ xử lý',
              note: `Đã thêm từ chiến dịch "${sourceCampaign.name}"`
            }))
          )

          await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${groups.length} link group Facebook sang ${config.label} "${targetCampaign.name}"`)
          await this.logCampaignProgress(targetCampaign.id, `✅ Đã nhận ${groups.length} link group Facebook từ chiến dịch "${sourceCampaign.name}"`, { emitRealtime: false })
          const reopenedTarget = await this.supabase.reopenCompletedCampaignAfterInputInsert(
            targetCampaign.id,
            config.actionId
          )
          if (reopenedTarget) this.broadcastCampaignUpdate(reopenedTarget)
        } catch (err) {
          console.error('Failed to push found Facebook groups to target campaign:', err)
        }
      }
    }
  }

  private getFindDataConfiguredTargetCampaignIds(rawIds: unknown, sourceCampaignId: number): number[] {
    return Array.from(new Set(
      (Array.isArray(rawIds) ? rawIds : [])
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id > 0 && id !== sourceCampaignId)
    ))
  }

  private getExternalTargetCampaignIds(rawIds: unknown[] | undefined, sourceCampaignId: number): number[] {
    return this.getFindDataConfiguredTargetCampaignIds(rawIds, sourceCampaignId)
  }

  private async logFindDataDuplicatePushSummary(
    sourceCampaign: Campaign,
    options: {
      label: string
      foundCount: number
      pushedCount: number
      hasTarget: boolean
    }
  ): Promise<void> {
    const foundCount = Math.max(0, options.foundCount)
    const pushedCount = Math.max(0, options.pushedCount)
    if (!options.hasTarget || foundCount <= 0 || pushedCount >= foundCount) return

    if (pushedCount <= 0) {
      await this.logCampaignProgress(
        sourceCampaign.id,
        `ℹ️ ${options.label}: tìm được ${foundCount} nhưng tất cả đã từng tìm được trong chiến dịch này nên không đẩy sang chiến dịch khác.`
      )
      return
    }

    await this.logCampaignProgress(
      sourceCampaign.id,
      `ℹ️ ${options.label}: tìm được ${foundCount}, bỏ qua ${foundCount - pushedCount} ${options.label} đã từng tìm được trong chiến dịch này, sẽ đẩy ${pushedCount} ${options.label} mới.`
    )
  }

  private async pushFoundDataToDataGroups(
    sourceCampaign: Campaign,
    accountId: number,
    inputData: CampaignInputData | null,
    summaryStep: RunStepV2 | undefined,
    sourceTargetName: string,
    found: {
      phones: string[]
      linkGroupZalos: string[]
      uids: string[]
      postLinks: string[]
      groupMembers: FindDataGroupMember[]
      facebookGroups: FindDataFacebookGroup[]
      uidProfiles: FindDataUidProfile[]
      phoneProfiles: FindDataPhoneProfile[]
    }
  ): Promise<void> {
    const destinations = sourceCampaign.extraSettings?.findDataTargetDataGroups
    if (!destinations || typeof destinations !== 'object') return

    const configuredKinds = ([
      'phone',
      'zalo_group_link',
      'facebook_uid',
      'post_link',
      'facebook_group'
    ] as FindDataGroupOutputKind[]).filter(kind => {
      const groupId = Number(destinations[kind]?.groupId)
      return Number.isSafeInteger(groupId) && groupId > 0
    })
    if (configuredKinds.length === 0) return

    let dataTypeIdByCode: Map<DataTypeCategoryCode, number>
    try {
      const dataTypes = await this.supabase.listDataTypeCategoryItems()
      dataTypeIdByCode = new Map(
        dataTypes
          .filter(item => Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0)
          .map(item => [item.code, Number(item.id)])
      )
    } catch (err) {
      console.error('Failed to load data types before pushing find-data results to Data Groups:', err)
      await this.logCampaignProgress(
        sourceCampaign.id,
        `⚠️ Không thể tải danh mục loại dữ liệu để đẩy kết quả sang Nhóm data: ${err instanceof Error ? err.message : String(err)}`
      )
      return
    }

    const uidProfileByKey = new Map<string, FindDataUidProfile>()
    for (const member of found.groupMembers) {
      const key = this.normalizeUidForCompare(member.uid)
      if (!key) continue
      uidProfileByKey.set(key, {
        uid: member.uid,
        name: member.name,
        url: member.url,
        source: 'group_member'
      })
    }
    for (const profile of found.uidProfiles) {
      const key = this.normalizeUidForCompare(profile.uid)
      if (!key) continue
      const current = uidProfileByKey.get(key)
      uidProfileByKey.set(key, current ? this.mergeFindDataUidProfile(current, profile) : profile)
    }

    const phoneProfileByKey = new Map<string, FindDataPhoneProfile>()
    for (const profile of found.phoneProfiles) {
      const key = this.normalizeExternalValueForCompare(profile.phone)
      if (!key) continue
      const current = phoneProfileByKey.get(key)
      phoneProfileByKey.set(key, current ? this.mergeFindDataPhoneProfile(current, profile) : profile)
    }

    const uidValues = new Map<string, string>()
    for (const rawUid of [
      ...found.groupMembers.map(member => member.uid),
      ...found.uids
    ]) {
      const uid = String(rawUid || '').trim()
      const key = this.normalizeUidForCompare(uid)
      if (uid && key && !uidValues.has(key)) uidValues.set(key, uid)
    }

    const sourceMetadata = {
      sourceCampaignId: sourceCampaign.id,
      sourceCampaignActionId: sourceCampaign.actionId,
      sourceInputDataId: inputData?.id ?? null,
      sourceRunId: summaryStep?.runId ?? null,
      sourceTargetName
    }
    const phoneRows: DataGroupIngestRow[] = this.uniqueExternalValues(found.phones).map(phone => {
      const profile = phoneProfileByKey.get(this.normalizeExternalValueForCompare(phone))
      return {
        contactType: 'phone',
        flatformType: null,
        name: profile?.name || phone,
        phone,
        extraData: {
          ...sourceMetadata,
          sourceProfileUid: profile?.uid || null,
          sourceProfileUrl: profile?.url || null,
          sourceProfileKind: profile?.source || null
        }
      }
    })
    const zaloGroupRows: DataGroupIngestRow[] = this.uniqueExternalValues(found.linkGroupZalos).map(link => ({
      contactType: 'group',
      flatformType: 'zalo',
      name: link,
      uid: link,
      url: link,
      extraData: sourceMetadata
    }))
    const facebookUidRows: DataGroupIngestRow[] = Array.from(uidValues.entries()).map(([key, uid]) => {
      const profile = uidProfileByKey.get(key)
      return {
        contactType: 'person',
        flatformType: 'facebook',
        name: profile?.name || uid,
        uid,
        url: profile?.url || (/^https?:\/\//i.test(uid) ? uid : null),
        extraData: {
          ...sourceMetadata,
          sourceProfileKind: profile?.source || null
        }
      }
    })
    const postLinkRows: DataGroupIngestRow[] = found.postLinks.map(link => ({
      contactType: 'campaign_input',
      flatformType: 'facebook',
      name: link,
      uid: link,
      url: link,
      extraData: sourceMetadata
    }))
    const facebookGroupRows: DataGroupIngestRow[] = found.facebookGroups.map(group => ({
      contactType: 'group',
      flatformType: 'facebook',
      name: group.name || group.url,
      uid: group.url,
      url: group.url,
      extraData: {
        ...sourceMetadata,
        privacy: group.privacy || null,
        memberCount: group.memberCount ?? null,
        postsPerDay: group.postsPerDay ?? null,
        keyword: group.keyword || null
      }
    }))

    const specs: Record<FindDataGroupOutputKind, {
      code: DataTypeCategoryCode
      label: string
      rows: DataGroupIngestRow[]
    }> = {
      phone: { code: 'phone', label: 'SĐT', rows: phoneRows },
      zalo_group_link: { code: 'zalo_group', label: 'link group Zalo', rows: zaloGroupRows },
      facebook_uid: { code: 'facebook_person', label: 'UID Facebook', rows: facebookUidRows },
      post_link: { code: 'facebook_post_url', label: 'link bài post', rows: postLinkRows },
      facebook_group: { code: 'facebook_group', label: 'group Facebook', rows: facebookGroupRows }
    }

    const sourceName = `Chiến dịch tìm data: ${sourceCampaign.name}`.slice(0, 255)
    const runIdentity = String(summaryStep?.runId ?? summaryStep?.id ?? 'unknown')
    const inputIdentity = Number(inputData?.id) > 0 ? String(inputData?.id) : 'none'
    const maxRowsPerRequest = 10000

    for (const kind of configuredKinds) {
      const destination = destinations[kind]
      const groupId = Number(destination?.groupId)
      const spec = specs[kind]
      if (!Number.isSafeInteger(groupId) || groupId <= 0 || spec.rows.length === 0) continue
      const dataTypeCategoryItemId = dataTypeIdByCode.get(spec.code)
      if (!dataTypeCategoryItemId) {
        await this.logCampaignProgress(
          sourceCampaign.id,
          `⚠️ Không tìm thấy loại dữ liệu "${spec.code}" nên chưa thể đẩy ${spec.label} sang Nhóm data.`
        )
        continue
      }

      let addedCount = 0
      let alreadyMemberCount = 0
      let skippedCount = 0
      try {
        for (let offset = 0; offset < spec.rows.length; offset += maxRowsPerRequest) {
          const chunkIndex = Math.floor(offset / maxRowsPerRequest)
          const rows = spec.rows.slice(offset, offset + maxRowsPerRequest)
          const payloadHash = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
          const result = await this.supabase.ingestDataGroup({
            requestId: [
              'find-data',
              sourceCampaign.id,
              inputIdentity,
              runIdentity,
              groupId,
              spec.code,
              chunkIndex,
              payloadHash.slice(0, 24),
              'v1'
            ].join(':'),
            groupId,
            kind: 'scan',
            rows,
            sourceAccountId: accountId,
            sourceName,
            payloadHash,
            dataTypeCategoryItemId
          })
          addedCount += result.insertedMembershipCount + result.reactivatedMembershipCount
          alreadyMemberCount += result.alreadyMemberCount
          skippedCount += result.invalidCount + result.incompatibleCount + result.conflictCount
        }

        const groupName = String(destination?.groupName || '').trim() || `Nhóm #${groupId}`
        const detailText = [
          `${addedCount} mới`,
          alreadyMemberCount > 0 ? `${alreadyMemberCount} đã có` : '',
          skippedCount > 0 ? `${skippedCount} không hợp lệ/không tương thích` : ''
        ].filter(Boolean).join(' · ')
        await this.logCampaignProgress(
          sourceCampaign.id,
          `✅ Đã đẩy ${spec.rows.length} ${spec.label} sang Nhóm data "${groupName}" (${detailText}).`
        )
      } catch (err) {
        console.error(`Failed to push find-data ${kind} to Data Group ${groupId}:`, err)
        const groupName = String(destination?.groupName || '').trim() || `Nhóm #${groupId}`
        await this.logCampaignProgress(
          sourceCampaign.id,
          `⚠️ Không thể đẩy ${spec.label} sang Nhóm data "${groupName}": ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  private uniqueExternalValues(rawValues: string[]): string[] {
    const map = new Map<string, string>()
    for (const rawValue of rawValues) {
      const value = String(rawValue || '').trim()
      const key = this.normalizeExternalValueForCompare(value)
      if (value && !map.has(key)) {
        map.set(key, value)
      }
    }
    return Array.from(map.values())
  }

  private normalizeFoundGroupMembers(rawMembers: unknown): FindDataGroupMember[] {
    if (!Array.isArray(rawMembers)) return []
    const result: FindDataGroupMember[] = []
    const seen = new Set<string>()
    for (const rawMember of rawMembers) {
      if (!rawMember || typeof rawMember !== 'object') continue
      const member = rawMember as { uid?: unknown; name?: unknown; url?: unknown }
      const uid = String(member.uid || '').trim()
      const key = this.normalizeUidForCompare(uid)
      if (!uid || !key || seen.has(key)) continue
      seen.add(key)
      result.push({
        uid,
        name: String(member.name || '').trim(),
        url: String(member.url || '').trim()
      })
    }
    return result
  }

  private normalizeFoundUidProfiles(rawProfiles: unknown): FindDataUidProfile[] {
    if (!Array.isArray(rawProfiles)) return []
    const map = new Map<string, FindDataUidProfile>()
    for (const rawProfile of rawProfiles) {
      if (!rawProfile || typeof rawProfile !== 'object') continue
      const profile = rawProfile as { uid?: unknown; name?: unknown; url?: unknown; source?: unknown }
      const uid = String(profile.uid || '').trim()
      const key = this.normalizeUidForCompare(uid)
      if (!uid || !key) continue
      const nextProfile: FindDataUidProfile = {
        uid,
        name: String(profile.name || '').trim(),
        url: String(profile.url || '').trim(),
        source: String(profile.source || '').trim()
      }
      const current = map.get(key)
      map.set(key, current ? this.mergeFindDataUidProfile(current, nextProfile) : nextProfile)
    }
    return Array.from(map.values())
  }

  private normalizeFoundPhoneProfiles(rawProfiles: unknown): FindDataPhoneProfile[] {
    if (!Array.isArray(rawProfiles)) return []
    const map = new Map<string, FindDataPhoneProfile>()
    for (const rawProfile of rawProfiles) {
      if (!rawProfile || typeof rawProfile !== 'object') continue
      const profile = rawProfile as { phone?: unknown; name?: unknown; uid?: unknown; url?: unknown; source?: unknown }
      const phone = String(profile.phone || '').trim()
      const key = this.normalizeExternalValueForCompare(phone)
      if (!phone || !key) continue
      const nextProfile: FindDataPhoneProfile = {
        phone,
        name: String(profile.name || '').trim(),
        uid: String(profile.uid || '').trim(),
        url: String(profile.url || '').trim(),
        source: String(profile.source || '').trim()
      }
      const current = map.get(key)
      map.set(key, current ? this.mergeFindDataPhoneProfile(current, nextProfile) : nextProfile)
    }
    return Array.from(map.values())
  }

  private mergeFindDataUidProfile(current: FindDataUidProfile, next: FindDataUidProfile): FindDataUidProfile {
    return {
      uid: current.uid || next.uid,
      name: current.name || next.name,
      url: current.url || next.url,
      source: current.source || next.source
    }
  }

  private mergeFindDataPhoneProfile(current: FindDataPhoneProfile, next: FindDataPhoneProfile): FindDataPhoneProfile {
    return {
      phone: current.phone || next.phone,
      name: current.name || next.name,
      uid: current.uid || next.uid,
      url: current.url || next.url,
      source: current.source || next.source
    }
  }

  private cleanFacebookGroupUrlForStorage(rawUrl: unknown): string {
    const value = String(rawUrl || '').trim()
    if (!value) return ''
    try {
      const url = new URL(value, 'https://www.facebook.com')
      const parts = url.pathname.split('/').filter(Boolean)
      const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups')
      const groupKey = groupIndex >= 0 ? parts[groupIndex + 1] : ''
      if (!groupKey) return ''
      return `https://www.facebook.com/groups/${groupKey}/`
    } catch {
      const cleaned = value.replace(/^https?:\/\/(www\.)?facebook\.com\/?/i, '').replace(/^\/+|\/+$/g, '')
      const parts = cleaned.split('/').filter(Boolean)
      const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups')
      const groupKey = groupIndex >= 0 ? parts[groupIndex + 1] : ''
      return groupKey ? `https://www.facebook.com/groups/${groupKey}/` : ''
    }
  }

  private normalizeFacebookGroupUrlForCompare(rawUrl: unknown): string {
    return this.cleanFacebookGroupUrlForStorage(rawUrl).replace(/\/+$/g, '').toLowerCase()
  }

  private normalizeFoundFacebookGroup(rawGroup: unknown): FindDataFacebookGroup {
    const source = rawGroup && typeof rawGroup === 'object'
      ? rawGroup as { url?: unknown; name?: unknown; privacy?: unknown; memberCount?: unknown; postsPerDay?: unknown; keyword?: unknown }
      : { url: rawGroup }
    const url = this.cleanFacebookGroupUrlForStorage(source.url)
    const numberOrUndefined = (value: unknown): number | undefined => {
      const numericValue = Number(value)
      return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : undefined
    }
    return {
      url,
      name: String(source.name || '').trim(),
      privacy: String(source.privacy || '').trim() || undefined,
      memberCount: numberOrUndefined(source.memberCount),
      postsPerDay: numberOrUndefined(source.postsPerDay),
      keyword: String(source.keyword || '').trim() || undefined
    }
  }

  private normalizeFoundFacebookGroups(rawGroups: unknown): FindDataFacebookGroup[] {
    if (!Array.isArray(rawGroups)) return []
    const result: FindDataFacebookGroup[] = []
    const seen = new Set<string>()
    for (const rawGroup of rawGroups) {
      const group = this.normalizeFoundFacebookGroup(rawGroup)
      const key = this.normalizeFacebookGroupUrlForCompare(group.url)
      if (!group.url || !key || seen.has(key)) continue
      seen.add(key)
      result.push(group)
    }
    return result
  }

  private normalizeFindDataSourceCounts(rawCounts: unknown): FindDataSourceCounts {
    const raw = rawCounts && typeof rawCounts === 'object'
      ? rawCounts as Record<string, unknown>
      : {}
    const rawPost = raw.post && typeof raw.post === 'object'
      ? raw.post as Record<string, unknown>
      : {}
    const rawComment = raw.comment && typeof raw.comment === 'object'
      ? raw.comment as Record<string, unknown>
      : {}
    const rawGroupMembers = raw.groupMembers && typeof raw.groupMembers === 'object'
      ? raw.groupMembers as Record<string, unknown>
      : {}
    const rawNewInteractors = raw.newInteractors && typeof raw.newInteractors === 'object'
      ? raw.newInteractors as Record<string, unknown>
      : {}
    const rawFacebookGroups = raw.facebookGroups && typeof raw.facebookGroups === 'object'
      ? raw.facebookGroups as Record<string, unknown>
      : {}

    const count = (value: unknown) => {
      const numericValue = Number(value)
      return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0
    }

    return {
      post: {
        phones: count(rawPost.phones),
        linkGroupZalos: count(rawPost.linkGroupZalos),
        uids: count(rawPost.uids),
        postLinks: count(rawPost.postLinks)
      },
      comment: {
        phones: count(rawComment.phones),
        linkGroupZalos: count(rawComment.linkGroupZalos),
        uids: count(rawComment.uids)
      },
      groupMembers: {
        uids: count(rawGroupMembers.uids)
      },
      newInteractors: {
        uids: count(rawNewInteractors.uids)
      },
      facebookGroups: {
        groups: count(rawFacebookGroups.groups)
      }
    }
  }

  private formatFindDataLogMessage(
    targetName: string,
    counts: FindDataUniqueCounts,
    sourceCounts: FindDataSourceCounts,
    extra: Campaign['extraSettings'],
    options: { isFollowUpInputRun?: boolean; isSearch?: boolean } = {}
  ): string {
    const isFollowUpInputRun = options.isFollowUpInputRun === true
    const isSearch = options.isSearch === true
    const uidCount = counts.uids + counts.groupMembers
    const uniqueParts: string[] = []
    if (extra?.isFindUid) uniqueParts.push(`${uidCount} UID${isFollowUpInputRun ? ' mới' : ''}`)
    if (extra?.isFindPostLink) uniqueParts.push(`${counts.postLinks} link bài post${isFollowUpInputRun ? ' mới' : ''}`)
    if (extra?.isFindPhone) uniqueParts.push(`${counts.phones} số điện thoại${isFollowUpInputRun ? ' mới' : ''}`)
    if (extra?.isFindLinkGroupZalo) uniqueParts.push(`${counts.linkGroupZalos} link group Zalo${isFollowUpInputRun ? ' mới' : ''}`)
    if (extra?.isFindFacebookGroup) uniqueParts.push(`${counts.facebookGroups || 0} link group Facebook${isFollowUpInputRun ? ' mới' : ''}`)
    const title = isSearch ? 'Tìm data bằng search:' : 'Tìm data trong group:'

    if (isFollowUpInputRun) {
      const summary = uniqueParts.join(' - ')
      return [
        isSearch ? 'Tìm data mới bằng search:' : 'Tìm data mới trong group:',
        targetName,
        '',
        summary
          ? 'Sau khi lọc trùng với các lần chạy trước:'
          : 'Không có data mới sau khi lọc trùng với các lần chạy trước.',
        ...(summary ? [summary] : [])
      ].join('\n')
    }

    const sourceLines: string[] = []
    const uidParts: string[] = []
    if (extra?.isFindUid && extra?.isFindInPost) uidParts.push(`${sourceCounts.post.uids} UID từ bài post`)
    if (extra?.isFindUid && extra?.isFindInComment) uidParts.push(`${sourceCounts.comment.uids} UID từ comment`)
    if (extra?.isFindUid && extra?.isFindNewInteractors) uidParts.push(`${sourceCounts.newInteractors.uids} UID từ người tương tác mới`)
    if (extra?.isFindUid && extra?.isFindInGroupMembers) uidParts.push(`${sourceCounts.groupMembers.uids} UID từ thành viên group`)
    if (uidParts.length > 0) sourceLines.push(uidParts.join(' - '))

    if (extra?.isFindPostLink) sourceLines.push(`${sourceCounts.post.postLinks} link bài post trong group`)

    const phoneParts: string[] = []
    if (extra?.isFindPhone && extra?.isFindInPost) phoneParts.push(`${sourceCounts.post.phones} SĐT trong bài post`)
    if (extra?.isFindPhone && extra?.isFindInComment) phoneParts.push(`${sourceCounts.comment.phones} SĐT trong comment`)
    if (phoneParts.length > 0) sourceLines.push(phoneParts.join(' - '))

    const zaloParts: string[] = []
    if (extra?.isFindLinkGroupZalo && extra?.isFindInPost) zaloParts.push(`${sourceCounts.post.linkGroupZalos} link group Zalo trong bài post`)
    if (extra?.isFindLinkGroupZalo && extra?.isFindInComment) zaloParts.push(`${sourceCounts.comment.linkGroupZalos} link group Zalo trong comment`)
    if (zaloParts.length > 0) sourceLines.push(zaloParts.join(' - '))

    if (extra?.isFindFacebookGroup) sourceLines.push(`${sourceCounts.facebookGroups.groups} link group Facebook từ kết quả search group`)

    return [
      title,
      targetName,
      '',
      ...sourceLines,
      '',
      'Sau khi lọc trùng:',
      uniqueParts.join(' - ') || '0 data'
    ].join('\n')
  }

  private normalizeExternalValueForCompare(value: unknown): string {
    return String(value || '').trim().toLowerCase()
  }

  private filterNewExternalValues(rawValues: string[], existingValues: Set<string>): string[] {
    const result: string[] = []
    const seen = new Set<string>()
    for (const rawValue of rawValues) {
      const value = String(rawValue || '').trim()
      const key = this.normalizeExternalValueForCompare(value)
      if (!value || !key || existingValues.has(key) || seen.has(key)) continue
      seen.add(key)
      result.push(value)
    }
    return result
  }

  private filterNewUidValues(rawUids: string[], existingValues: Set<string>): string[] {
    const result: string[] = []
    const seen = new Set<string>()
    for (const rawUid of rawUids) {
      const uid = String(rawUid || '').trim()
      const key = this.normalizeUidForCompare(uid)
      if (!uid || !key || existingValues.has(key) || seen.has(key)) continue
      seen.add(key)
      result.push(uid)
    }
    return result
  }

  private filterNewPostLinkValues(rawPostLinks: string[], existingValues: Set<string>): string[] {
    const result: string[] = []
    const seen = new Set<string>()
    for (const rawLink of rawPostLinks) {
      const link = this.cleanPostLinkForStorage(rawLink)
      const key = this.normalizePostLinkForCompare(link)
      if (!link || !key || existingValues.has(key) || seen.has(key)) continue
      seen.add(key)
      result.push(link)
    }
    return result
  }

  private filterNewGroupMembers(rawMembers: FindDataGroupMember[], existingUidValues: Set<string>): FindDataGroupMember[] {
    const result: FindDataGroupMember[] = []
    const seen = new Set<string>()
    for (const member of rawMembers) {
      const key = this.normalizeUidForCompare(member.uid)
      if (!member.uid || !key || existingUidValues.has(key) || seen.has(key)) continue
      seen.add(key)
      result.push(member)
    }
    return result
  }

  private filterUidProfilesByUids(rawProfiles: FindDataUidProfile[], uids: string[]): FindDataUidProfile[] {
    const allowed = new Set(uids.map(uid => this.normalizeUidForCompare(uid)).filter(Boolean))
    if (allowed.size === 0) return []
    const result = new Map<string, FindDataUidProfile>()
    for (const profile of rawProfiles) {
      const key = this.normalizeUidForCompare(profile.uid)
      if (!key || !allowed.has(key)) continue
      const current = result.get(key)
      result.set(key, current ? this.mergeFindDataUidProfile(current, profile) : profile)
    }
    return Array.from(result.values())
  }

  private filterPhoneProfilesByPhones(rawProfiles: FindDataPhoneProfile[], phones: string[]): FindDataPhoneProfile[] {
    const allowed = new Set(phones.map(phone => this.normalizeExternalValueForCompare(phone)).filter(Boolean))
    if (allowed.size === 0) return []
    const result = new Map<string, FindDataPhoneProfile>()
    for (const profile of rawProfiles) {
      const key = this.normalizeExternalValueForCompare(profile.phone)
      if (!key || !allowed.has(key)) continue
      const current = result.get(key)
      result.set(key, current ? this.mergeFindDataPhoneProfile(current, profile) : profile)
    }
    return Array.from(result.values())
  }

  private getPhoneProfileNameMap(
    profiles: FindDataPhoneProfile[],
    normalizePhone: (value: unknown) => string = value => String(value || '').trim()
  ): Map<string, string> {
    const map = new Map<string, string>()
    for (const profile of profiles) {
      const key = this.normalizeExternalValueForCompare(normalizePhone(profile.phone))
      const name = String(profile.name || '').trim()
      if (!key || !name || map.has(key)) continue
      map.set(key, name)
    }
    return map
  }

  private filterNewFacebookGroups(rawGroups: FindDataFacebookGroup[], existingValues: Set<string>): FindDataFacebookGroup[] {
    const result: FindDataFacebookGroup[] = []
    const seen = new Set<string>()
    for (const rawGroup of rawGroups) {
      const group = this.normalizeFoundFacebookGroup(rawGroup)
      const key = this.normalizeFacebookGroupUrlForCompare(group.url)
      if (!group.url || !key || existingValues.has(key) || seen.has(key)) continue
      seen.add(key)
      result.push(group)
    }
    return result
  }

  private getGroupMemberUidKeys(members: FindDataGroupMember[]): Set<string> {
    return new Set(
      members
        .map(member => this.normalizeUidForCompare(member.uid))
        .filter(Boolean)
    )
  }

  private createEmptyFindDataPreviousValues(): FindDataPreviousValues {
    return {
      phones: new Set(),
      linkGroupZalos: new Set(),
      uids: new Set(),
      postLinks: new Set(),
      facebookGroups: new Set(),
      detailCount: 0
    }
  }

  private addFindDataDetailValues(detail: { data?: Record<string, unknown> }, target: FindDataPreviousValues): void {
    const data = detail.data || {}
    const addValues = (values: unknown, destination: Set<string>, normalize: (value: unknown) => string) => {
      if (!Array.isArray(values)) return
      for (const value of values) {
        const key = normalize(value)
        if (key) destination.add(key)
      }
    }
    addValues(data.phones, target.phones, value => this.normalizeExternalValueForCompare(value))
    addValues(data.linkGroupZalos, target.linkGroupZalos, value => this.normalizeExternalValueForCompare(value))
    addValues(data.uids, target.uids, value => this.normalizeUidForCompare(String(value || '').trim()))
    addValues(data.postLinks, target.postLinks, value => this.normalizePostLinkForCompare(this.cleanPostLinkForStorage(String(value || ''))))
    addValues(data.facebookGroups, target.facebookGroups, value => {
      const group = this.normalizeFoundFacebookGroup(value)
      return this.normalizeFacebookGroupUrlForCompare(group.url)
    })

    if (Array.isArray(data.groupMembers)) {
      for (const member of data.groupMembers) {
        if (!member || typeof member !== 'object') continue
        const uid = String((member as { uid?: unknown }).uid || '').trim()
        const key = this.normalizeUidForCompare(uid)
        if (key) target.uids.add(key)
      }
    }
    if (Array.isArray(data.facebookGroups)) {
      for (const item of data.facebookGroups) {
        const group = this.normalizeFoundFacebookGroup(item)
        const key = this.normalizeFacebookGroupUrlForCompare(group.url)
        if (key) target.facebookGroups.add(key)
      }
    }
  }

  private async getPreviouslyFoundValues(campaignId: number): Promise<FindDataPreviousValues> {
    const values = this.createEmptyFindDataPreviousValues()
    try {
      const details = await this.supabase.listCampaignDetailsByCampaign(campaignId)
      for (const detail of details) {
        if (detail.actionName !== 'Tìm data' || detail.status !== 'thành công') continue
        values.detailCount += 1
        this.addFindDataDetailValues(detail, values)
      }
    } catch (err) {
      console.error('Failed to load previous find-data values:', err)
    }

    return values
  }

  private async getPreviouslyFoundValuesForInputData(campaignId: number, inputDataId?: number | null): Promise<FindDataPreviousValues> {
    const values = this.createEmptyFindDataPreviousValues()
    if (!inputDataId) return values

    try {
      const details = await this.supabase.listCampaignDetailsByInputData(inputDataId)
      for (const detail of details) {
        if (detail.campaignId !== campaignId || detail.actionName !== 'Tìm data' || detail.status !== 'thành công') continue
        values.detailCount += 1
        this.addFindDataDetailValues(detail, values)
      }
    } catch (err) {
      console.error('Failed to load previous find-data values by input data:', err)
    }

    return values
  }

  private splitSmsContent(contentMessage: string | null | undefined): string[] {
    return splitSharedContentVariants(contentMessage, { fallbackToRaw: true })
  }

  private getAkaBizStaffIdForCampaign(sourceCampaign: Campaign): number | null {
    const campaignStaffId = Number(sourceCampaign.staffId)
    if (Number.isFinite(campaignStaffId) && campaignStaffId > 0) return campaignStaffId
    const currentStaffId = Number(getCurrentUser()?.staffId)
    return Number.isFinite(currentStaffId) && currentStaffId > 0 ? currentStaffId : null
  }

  private async loadAkaBizIntegrationsForCampaign(sourceCampaign: Campaign) {
    const staffId = this.getAkaBizStaffIdForCampaign(sourceCampaign)
    if (!staffId) {
      await this.logCampaignProgress(sourceCampaign.id, '⚠️ Chưa xác định được nhân viên để tải tích hợp akaBiz.')
      return null
    }
    try {
      return await getAkaBizIntegrationsForStaff(staffId)
    } catch (err: any) {
      console.error('Failed to load akaBiz integrations:', err)
      await this.logCampaignProgress(sourceCampaign.id, `⚠️ Không thể tải tích hợp akaBiz: ${err?.message || err}`)
      return null
    }
  }

  private async logExternalPushWarning(sourceCampaign: Campaign, message: string, err?: unknown): Promise<void> {
    const errMsg = err instanceof Error ? err.message : (err ? String(err) : '')
    await this.logCampaignProgress(sourceCampaign.id, `⚠️ ${message}${errMsg ? `: ${errMsg}` : ''}`)
  }

  private formatAkaBizCampaignName(name: string | null | undefined): string {
    const trimmed = String(name || '').trim()
    return trimmed ? `chiến dịch "${trimmed}"` : 'chiến dịch đã chọn'
  }

  private async ensureZaloWebCampaignPending(targetCampaignId: number, sourceCampaign: Campaign): Promise<AkaBizCampaignSummary> {
    void sourceCampaign
    const targetCampaign = await getZaloCampaign(targetCampaignId)
    const status = String(targetCampaign.status || '').trim().toLowerCase()
    if (status === 'hoàn thành') {
      await updateZaloCampaignStatus(targetCampaignId, 'Chờ xử lý')
    }
    return targetCampaign
  }

  private ensureAkaBizDesktopCampaignPending(
    integration: AkaBizIntegrationInfo,
    targetCampaignId: number
  ): AkaBizDesktopCampaignSummary {
    const targetCampaign = getAkaBizDesktopCampaign(integration, targetCampaignId)
    const status = String(targetCampaign.status || '').trim().toLowerCase()
    if (status === 'hoàn thành') {
      updateAkaBizDesktopCampaignStatus(integration, targetCampaignId, 'Chờ xử lý')
    }
    return targetCampaign
  }

  private async pushFoundPhonesToSmsCampaigns(sourceCampaign: Campaign, rawPhones: string[], phoneProfiles: FindDataPhoneProfile[] = []): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindPhone) return

    const targetCampaignIds = this.getExternalTargetCampaignIds(
      sourceCampaign.extraSettings.findPhoneSmsTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const phones = this.uniqueExternalValues(rawPhones)
    if (phones.length === 0) return
    const phoneNameByValue = this.getPhoneProfileNameMap(phoneProfiles)

    const integrations = await this.loadAkaBizIntegrationsForCampaign(sourceCampaign)
    if (!integrations?.sms?.staffId) {
      await this.logExternalPushWarning(sourceCampaign, 'Chưa tích hợp akaBiz Sms nên không thể đẩy SĐT ra campaign ngoài hệ thống.')
      return
    }

    for (const targetCampaignId of targetCampaignIds) {
      let targetCampaignName = 'chiến dịch đã chọn'
      try {
        const campSms = await getSmsCampaign(targetCampaignId)
        targetCampaignName = this.formatAkaBizCampaignName(campSms.name)
        const shopId = Number(campSms.shopId)
        if (!Number.isFinite(shopId) || shopId <= 0) {
          throw new Error('Campaign akaBiz Sms thiếu shopId.')
        }
        const contentSms = this.splitSmsContent(campSms.contentMessage)
        let iContentSms = 0

        for (const phone of phones) {
          await addSmsCampaignDetail({
            shopId,
            campaignId: targetCampaignId,
            phone,
            name: phoneNameByValue.get(this.normalizeExternalValueForCompare(phone)) || '',
            content: this.renderSpinContent(contentSms[iContentSms++])
          })
          if (iContentSms === contentSms.length) iContentSms = 0
        }

        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${phones.length} SĐT sang ${targetCampaignName}`)
      } catch (err) {
        console.error('Failed to push found phones to akaBiz Sms campaign:', err)
        await this.logExternalPushWarning(sourceCampaign, `Không thể đẩy SĐT sang ${targetCampaignName}`, err)
      }
    }
  }

  private getInternalSmsAccountIds(sourceCampaign: Campaign): number[] {
    const raw = Array.isArray(sourceCampaign.extraSettings?.internalSmsAccountIds)
      ? sourceCampaign.extraSettings.internalSmsAccountIds
      : []
    return Array.from(new Set(
      raw
        .map(item => Number(item))
        .filter(item => Number.isFinite(item) && item > 0)
    ))
  }

  private getInternalSmsStatuses(sourceCampaign: Campaign): Set<string> {
    const raw = Array.isArray(sourceCampaign.extraSettings?.internalSmsStatuses)
      ? sourceCampaign.extraSettings.internalSmsStatuses
      : []
    return new Set(
      raw
        .map(item => String(item || '').trim().toLocaleLowerCase('vi-VN'))
        .filter(item => EXTERNAL_SMS_STATUS_VALUES.has(item))
    )
  }

  private getInternalSmsCreatedCampaignIdMap(sourceCampaign: Campaign): Record<string, number> {
    const raw = sourceCampaign.extraSettings?.internalSmsCreatedCampaignIdsByAccount
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const mapping: Record<string, number> = {}
    for (const [key, value] of Object.entries(raw)) {
      const accountId = Number(key)
      const campaignId = Number(value)
      if (Number.isFinite(accountId) && accountId > 0 && Number.isFinite(campaignId) && campaignId > 0) {
        mapping[String(accountId)] = campaignId
      }
    }
    return mapping
  }

  private getExternalSmsShopIds(sourceCampaign: Campaign): number[] {
    const raw = Array.isArray(sourceCampaign.extraSettings?.externalSmsShopIds)
      ? sourceCampaign.extraSettings.externalSmsShopIds
      : []
    return Array.from(new Set(
      raw
        .map(item => Number(item))
        .filter(item => Number.isFinite(item) && item > 0)
    ))
  }

  private getExternalSmsStatuses(sourceCampaign: Campaign): Set<string> {
    const raw = Array.isArray(sourceCampaign.extraSettings?.externalSmsStatuses)
      ? sourceCampaign.extraSettings.externalSmsStatuses
      : []
    return new Set(
      raw
        .map(item => String(item || '').trim().toLocaleLowerCase('vi-VN'))
        .filter(item => EXTERNAL_SMS_STATUS_VALUES.has(item))
    )
  }

  private getRecordValue(record: unknown, key: string): unknown {
    return record && typeof record === 'object' && !Array.isArray(record)
      ? (record as Record<string, unknown>)[key]
      : undefined
  }

  private getZaloDetailSmsPhone(created: CampaignDetail, inputData: CampaignInputData | null): string {
    const data = created.data || {}
    const target = this.getRecordValue(data, 'target')
    const detailInputData = this.getRecordValue(data, 'inputData')
    return this.firstNormalizedVietnamMobilePhone(
      this.getRecordValue(target, 'phone'),
      this.getRecordValue(detailInputData, 'phone'),
      inputData?.phone
    )
  }

  private getZaloDetailSmsName(created: CampaignDetail, inputData: CampaignInputData | null): string {
    const data = created.data || {}
    const target = this.getRecordValue(data, 'target')
    const detailInputData = this.getRecordValue(data, 'inputData')
    return this.firstNonEmptyString(
      this.getRecordValue(target, 'displayName'),
      this.getRecordValue(target, 'originalName'),
      this.getRecordValue(detailInputData, 'name'),
      inputData?.name,
      this.getRecordValue(target, 'uid'),
      inputData?.uid
    )
  }

  private clearZaloSmsPushKeysForCampaign(campaignId: number): void {
    const prefix = `${campaignId}:`
    for (const key of Array.from(this.internalSmsPushedDetailKeys)) {
      if (key.startsWith(prefix)) this.internalSmsPushedDetailKeys.delete(key)
    }
    for (const key of Array.from(this.externalSmsPushedDetailKeys)) {
      if (key.startsWith(prefix)) this.externalSmsPushedDetailKeys.delete(key)
    }
  }

  private getExternalSmsPushKey(sourceCampaign: Campaign, inputData: CampaignInputData | null, phone: string): string {
    const inputDataId = Number(inputData?.id)
    if (Number.isFinite(inputDataId) && inputDataId > 0) return `${sourceCampaign.id}:input:${inputDataId}`
    return `${sourceCampaign.id}:phone:${phone || 'unknown'}`
  }

  private isExternalSmsZaloDetailEligible(created: CampaignDetail): boolean {
    const actionCode = String(created.actionCode || '').trim()
    const status = String(created.status || '').trim().toLocaleLowerCase('vi-VN')
    if (actionCode === ZALO_FIND_PHONE_ACTION_CODE) return status === 'không tồn tại'
    return actionCode === 'zalo_message_stranger' || actionCode === 'zalo_add_friend'
  }

  private renderExternalSmsLegacyTokens(content: string, inputData: Record<string, unknown>, target: unknown): string {
    const targetRecord = target && typeof target === 'object' && !Array.isArray(target)
      ? target as Record<string, unknown>
      : {}
    const displayName = this.firstNonEmptyString(targetRecord.displayName, inputData.name)
    const originalName = this.firstNonEmptyString(targetRecord.originalName, displayName)
    const phone = this.firstNormalizedVietnamMobilePhone(targetRecord.phone, inputData.phone)
    return String(content || '')
      .replace(/\[fullname_web\]/g, displayName)
      .replace(/\[fullname_original\]/g, originalName)
      .replace(/\[fullname\]/g, this.firstNonEmptyString(inputData.name, displayName))
      .replace(/\[phone\]/g, phone)
      .replace(/\[mobile\]/g, phone)
      .replace(/\[email\]/g, this.firstNonEmptyString(inputData.email))
      .replace(/\[info1\]/g, this.firstNonEmptyString(inputData.info1))
      .replace(/\[info2\]/g, this.firstNonEmptyString(inputData.info2))
      .replace(/\[info3\]/g, this.firstNonEmptyString(inputData.info3))
      .replace(/\[info4\]/g, this.firstNonEmptyString(inputData.info4))
      .replace(/\[info5\]/g, this.firstNonEmptyString(inputData.info5))
  }

  private getZaloSmsContentForDetail(
    contentMessage: string | null | undefined,
    inputData: CampaignInputData | null,
    created: CampaignDetail,
    businessNow?: Date
  ): string {
    const variants = this.splitSmsContent(contentMessage)
    const index = variants.length > 0 ? Math.abs(Number(created.id) || 0) % variants.length : 0
    const data = created.data || {}
    const target = this.getRecordValue(data, 'target')
    const detailInputData = this.getRecordValue(data, 'inputData')
    const mergedInputData = {
      id: inputData?.id,
      name: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'name'), inputData?.name),
      phone: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'phone'), inputData?.phone),
      uid: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'uid'), inputData?.uid),
      email: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'email'), inputData?.email),
      info1: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info1'), inputData?.info1),
      info2: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info2'), inputData?.info2),
      info3: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info3'), inputData?.info3),
      info4: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info4'), inputData?.info4),
      info5: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info5'), inputData?.info5)
    }
    const rendered = this.renderZaloTemplate(
      variants[index] || '',
      mergedInputData,
      target as ZaloResolvedTarget | null,
      false,
      businessNow
    )
    return this.renderExternalSmsLegacyTokens(rendered, mergedInputData, target)
  }

  private getInternalSmsContentForZaloDetail(
    sourceCampaign: Campaign,
    inputData: CampaignInputData | null,
    created: CampaignDetail,
    businessNow?: Date
  ): string {
    return this.getZaloSmsContentForDetail(
      sourceCampaign.extraSettings?.internalSmsContent,
      inputData,
      created,
      businessNow
    )
  }

  private getExternalSmsContentForZaloDetail(
    sourceCampaign: Campaign,
    inputData: CampaignInputData | null,
    created: CampaignDetail,
    businessNow?: Date
  ): string {
    return this.getZaloSmsContentForDetail(
      sourceCampaign.extraSettings?.externalSmsContent,
      inputData,
      created,
      businessNow
    )
  }

  private getZaloDetailSmsInputSnapshot(created: CampaignDetail, inputData: CampaignInputData | null, phone: string): Partial<CampaignInputData> {
    const data = created.data || {}
    const target = this.getRecordValue(data, 'target')
    const detailInputData = this.getRecordValue(data, 'inputData')
    return {
      name: this.getZaloDetailSmsName(created, inputData),
      phone,
      uid: this.firstNonEmptyString(
        this.getRecordValue(target, 'uid'),
        this.getRecordValue(detailInputData, 'uid'),
        inputData?.uid
      ),
      email: this.firstNonEmptyString(
        this.getRecordValue(detailInputData, 'email'),
        inputData?.email
      ),
      info1: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info1'), inputData?.info1),
      info2: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info2'), inputData?.info2),
      info3: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info3'), inputData?.info3),
      info4: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info4'), inputData?.info4),
      info5: this.firstNonEmptyString(this.getRecordValue(detailInputData, 'info5'), inputData?.info5)
    }
  }

  private isUsableInternalSmsChildCampaign(childCampaign: Campaign | null, smsAccountId: number, sourceCampaign: Campaign): childCampaign is Campaign {
    if (!childCampaign || childCampaign.isDelete) return false
    if (childCampaign.actionId !== SMS_SEND_ACTION_ID) return false
    if (Number(childCampaign.accountId) !== Number(smsAccountId)) return false
    const sourceId = Number(childCampaign.extraSettings?.internalSmsSourceCampaignId)
    return !Number.isFinite(sourceId) || sourceId === sourceCampaign.id
  }

  private async ensureInternalSmsChildCampaign(sourceCampaign: Campaign, smsAccountId: number, nowIso: string): Promise<Campaign> {
    const smsAccount = await this.supabase.getAccount(smsAccountId)
    if (!smsAccount || smsAccount.isDelete || smsAccount.flatformType !== 'sms') {
      throw new Error(`Tài khoản Sms #${smsAccountId} không tồn tại hoặc không hợp lệ.`)
    }

    const mapping = this.getInternalSmsCreatedCampaignIdMap(sourceCampaign)
    const mappedCampaignId = mapping[String(smsAccountId)]
    if (mappedCampaignId) {
      const existingCampaign = await this.supabase.getCampaign(mappedCampaignId)
      if (this.isUsableInternalSmsChildCampaign(existingCampaign, smsAccountId, sourceCampaign)) {
        if (existingCampaign.status === 'hoàn thành') {
          return await this.updateCampaignAndBroadcast(existingCampaign.id, { status: 'chờ xử lý', note: null })
        }
        return existingCampaign
      }
    }

    const createdCampaign = await this.supabase.createCampaign({
      name: `Kiêm SMS - ${sourceCampaign.name} - ${smsAccount.name || smsAccount.username || `Sms #${smsAccount.id}`}`,
      actionId: SMS_SEND_ACTION_ID,
      accountId: smsAccount.id,
      status: 'chờ xử lý',
      schedule: nowIso,
      originalSchedule: nowIso,
      content: sourceCampaign.extraSettings?.internalSmsContent || '',
      extraSettings: {
        internalSmsSourceCampaignId: sourceCampaign.id,
        internalSmsSourceCampaignName: sourceCampaign.name,
        internalSmsSourceActionId: sourceCampaign.actionId
      },
      note: null
    })

    const nextMapping = { ...mapping, [String(smsAccount.id)]: createdCampaign.id }
    const updatedSourceCampaign = await this.updateCampaignAndBroadcast(sourceCampaign.id, {
      extraSettings: {
        ...(sourceCampaign.extraSettings || {}),
        internalSmsCreatedCampaignIdsByAccount: nextMapping
      }
    })
    sourceCampaign.extraSettings = updatedSourceCampaign.extraSettings

    return createdCampaign
  }

  private async pushZaloDetailToInternalSmsIfNeeded(
    sourceCampaign: Campaign,
    inputData: CampaignInputData | null,
    created: CampaignDetail
  ): Promise<void> {
    if (!EXTERNAL_SMS_ZALO_ACTION_IDS.has(sourceCampaign.actionId)) return
    if (sourceCampaign.extraSettings?.internalSmsEnabled !== true) return
    if (!this.isExternalSmsZaloDetailEligible(created)) return

    const statuses = this.getInternalSmsStatuses(sourceCampaign)
    const detailStatus = String(created.status || '').trim().toLocaleLowerCase('vi-VN')
    if (!statuses.has(detailStatus)) return

    const accountIds = this.getInternalSmsAccountIds(sourceCampaign)
    if (accountIds.length === 0) return

    const phone = this.getZaloDetailSmsPhone(created, inputData)
    if (!phone) {
      await this.logExternalPushWarning(sourceCampaign, `Không thể kiêm gửi SMS vì thiếu SĐT cho ${this.getInputDataDisplayName(sourceCampaign, inputData, 'target')}`)
      return
    }

    const pushKey = this.getExternalSmsPushKey(sourceCampaign, inputData, phone)
    if (this.internalSmsPushedDetailKeys.has(pushKey)) return

    const nowIso = (await this.getDatabaseBusinessNow()).toISOString()
    const content = this.getInternalSmsContentForZaloDetail(
      sourceCampaign,
      inputData,
      created,
      new Date(nowIso)
    )
    const inputSnapshot = this.getZaloDetailSmsInputSnapshot(created, inputData, phone)
    let successCount = 0

    for (const accountId of accountIds) {
      try {
        const childCampaign = await this.ensureInternalSmsChildCampaign(sourceCampaign, accountId, nowIso)
        await this.supabase.createSmsCampaignInputDataSnapshot({
          ...inputSnapshot,
          campaignId: childCampaign.id,
          status: 'chờ xử lý',
          note: '',
          schedule: nowIso,
          content
        })
        const reopenedChildCampaign = await this.supabase.reopenCompletedCampaignAfterInputInsert(
          childCampaign.id,
          SMS_SEND_ACTION_ID
        )
        if (reopenedChildCampaign) this.broadcastCampaignUpdate(reopenedChildCampaign)
        successCount += 1
      } catch (err) {
        console.error('Failed to push Zalo detail to internal SMS campaign:', err)
        await this.logExternalPushWarning(sourceCampaign, `Không thể kiêm gửi SMS sang tài khoản Sms #${accountId}`, err)
      }
    }

    if (successCount > 0) {
      this.internalSmsPushedDetailKeys.add(pushKey)
      await this.logCampaignProgress(sourceCampaign.id, `✅ Đã kiêm gửi SMS cho ${phone} sang ${successCount} tài khoản Sms`)
    }
  }

  private async pushZaloDetailToExternalSmsIfNeeded(
    sourceCampaign: Campaign,
    inputData: CampaignInputData | null,
    created: CampaignDetail
  ): Promise<void> {
    if (!EXTERNAL_SMS_ZALO_ACTION_IDS.has(sourceCampaign.actionId)) return
    if (sourceCampaign.extraSettings?.externalSmsEnabled !== true) return
    if (!this.isExternalSmsZaloDetailEligible(created)) return

    const statuses = this.getExternalSmsStatuses(sourceCampaign)
    const detailStatus = String(created.status || '').trim().toLocaleLowerCase('vi-VN')
    if (!statuses.has(detailStatus)) return

    const shopIds = this.getExternalSmsShopIds(sourceCampaign)
    if (shopIds.length === 0) return

    const phone = this.getZaloDetailSmsPhone(created, inputData)
    if (!phone) {
      await this.logExternalPushWarning(sourceCampaign, `Không thể kiêm gửi SMS vì thiếu SĐT cho ${this.getInputDataDisplayName(sourceCampaign, inputData, 'target')}`)
      return
    }

    const pushKey = this.getExternalSmsPushKey(sourceCampaign, inputData, phone)
    if (this.externalSmsPushedDetailKeys.has(pushKey)) return

    const integrations = await this.loadAkaBizIntegrationsForCampaign(sourceCampaign)
    if (!integrations?.sms?.staffId) {
      await this.logExternalPushWarning(sourceCampaign, 'Chưa tích hợp akaBiz Sms nên không thể kiêm gửi SMS.')
      return
    }

    const templateNow = await this.getTemplateBusinessNow(sourceCampaign.extraSettings?.externalSmsContent)
    const content = this.getExternalSmsContentForZaloDetail(sourceCampaign, inputData, created, templateNow)
    const name = this.getZaloDetailSmsName(created, inputData)
    let successCount = 0

    for (const shopId of shopIds) {
      try {
        await addSmsCampaignDetail({
          shopId,
          campaignId: sourceCampaign.id,
          phone,
          name,
          content
        })
        successCount += 1
      } catch (err) {
        console.error('Failed to push Zalo detail to akaBiz Sms:', err)
        await this.logExternalPushWarning(sourceCampaign, `Không thể kiêm gửi SMS sang tài khoản #${shopId}`, err)
      }
    }

    if (successCount > 0) {
      this.externalSmsPushedDetailKeys.add(pushKey)
      await this.logCampaignProgress(sourceCampaign.id, `✅ Đã kiêm gửi SMS cho ${phone} sang ${successCount} tài khoản akaBiz Sms`)
    }
  }

  private async pushFoundPhonesToZaloWebCampaigns(sourceCampaign: Campaign, rawPhones: string[], phoneProfiles: FindDataPhoneProfile[] = []): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindPhone) return

    const targetCampaignIds = this.getExternalTargetCampaignIds(
      sourceCampaign.extraSettings.findPhoneZaloWebTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const phones = this.uniqueExternalValues(rawPhones)
    if (phones.length === 0) return
    const phoneNameByValue = this.getPhoneProfileNameMap(phoneProfiles)

    const integrations = await this.loadAkaBizIntegrationsForCampaign(sourceCampaign)
    if (!integrations?.zaloWeb?.staffId) {
      await this.logExternalPushWarning(sourceCampaign, 'Chưa tích hợp akaBiz Zalo Web nên không thể đẩy SĐT ra campaign ngoài hệ thống.')
      return
    }

    for (const targetCampaignId of targetCampaignIds) {
      let targetCampaignName = 'chiến dịch đã chọn'
      try {
        const targetCampaign = await this.ensureZaloWebCampaignPending(targetCampaignId, sourceCampaign)
        targetCampaignName = this.formatAkaBizCampaignName(targetCampaign.name)
        await addZaloCampaignDetails(phones.map(phone => ({
          campaignId: targetCampaignId,
          status: 1,
          name: phoneNameByValue.get(this.normalizeExternalValueForCompare(phone)) || '',
          phone,
          isAutomate: true
        })))
        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${phones.length} SĐT sang ${targetCampaignName}`)
      } catch (err) {
        console.error('Failed to push found phones to akaBiz Zalo Web campaign:', err)
        await this.logExternalPushWarning(sourceCampaign, `Không thể đẩy SĐT sang ${targetCampaignName}`, err)
      }
    }
  }

  private async pushFoundPhonesToZaloMessagePhoneCampaigns(sourceCampaign: Campaign, rawPhones: string[], phoneProfiles: FindDataPhoneProfile[] = []): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindPhone) return

    const targetCampaignIds = this.getFindDataConfiguredTargetCampaignIds(
      sourceCampaign.extraSettings.findPhoneZaloMessagePhoneTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const phoneMap = new Map<string, string>()
    for (const rawPhone of rawPhones) {
      const phone = this.normalizeVietnamMobilePhone(rawPhone)
      const key = this.normalizeExternalValueForCompare(phone)
      if (phone && key && !phoneMap.has(key)) phoneMap.set(key, phone)
    }
    const phones = Array.from(phoneMap.values())
    if (phones.length === 0) return
    const phoneNameByValue = this.getPhoneProfileNameMap(phoneProfiles, value => this.normalizeVietnamMobilePhone(value))

    for (const targetCampaignId of targetCampaignIds) {
      try {
        const targetCampaign = await this.supabase.getCampaign(targetCampaignId)
        if (!targetCampaign || targetCampaign.actionId !== ZALO_MESSAGE_PHONE_ACTION_ID) continue

        await this.supabase.createCampaignInputDataBatch(
          phones.map<Partial<CampaignInputData>>(phone => ({
            campaignId: targetCampaign.id,
            name: phoneNameByValue.get(this.normalizeExternalValueForCompare(phone)) || undefined,
            phone,
            status: 'chờ xử lý',
            note: `Đã thêm từ chiến dịch "${sourceCampaign.name}"`
          }))
        )

        const reopenedTarget = await this.supabase.reopenCompletedCampaignAfterInputInsert(
          targetCampaign.id,
          ZALO_MESSAGE_PHONE_ACTION_ID
        )
        if (reopenedTarget) this.broadcastCampaignUpdate(reopenedTarget)

        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${phones.length} SĐT sang chiến dịch "${targetCampaign.name}"`)
        await this.logCampaignProgress(targetCampaign.id, `✅ Đã nhận ${phones.length} SĐT từ chiến dịch "${sourceCampaign.name}"`, { emitRealtime: false })
      } catch (err) {
        console.error('Failed to push found phones to Zalo phone campaign:', err)
      }
    }
  }

  private async pushFoundZaloGroupLinksToZaloWebCampaigns(sourceCampaign: Campaign, rawLinks: string[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindLinkGroupZalo) return

    const targetCampaignIds = this.getExternalTargetCampaignIds(
      sourceCampaign.extraSettings.findZaloGroupLinkWebTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const links = this.uniqueExternalValues(rawLinks)
    if (links.length === 0) return

    const integrations = await this.loadAkaBizIntegrationsForCampaign(sourceCampaign)
    if (!integrations?.zaloWeb?.staffId) {
      await this.logExternalPushWarning(sourceCampaign, 'Chưa tích hợp akaBiz Zalo Web nên không thể đẩy link group Zalo ra campaign ngoài hệ thống.')
      return
    }

    for (const targetCampaignId of targetCampaignIds) {
      let targetCampaignName = 'chiến dịch đã chọn'
      try {
        const targetCampaign = await this.ensureZaloWebCampaignPending(targetCampaignId, sourceCampaign)
        targetCampaignName = this.formatAkaBizCampaignName(targetCampaign.name)
        await addZaloCampaignDetails(links.map(link => ({
          campaignId: targetCampaignId,
          status: 1,
          uid: link,
          isAutomate: true
        })))
        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${links.length} link group Zalo sang ${targetCampaignName}`)
      } catch (err) {
        console.error('Failed to push found Zalo group links to akaBiz Zalo Web campaign:', err)
        await this.logExternalPushWarning(sourceCampaign, `Không thể đẩy link group Zalo sang ${targetCampaignName}`, err)
      }
    }
  }

  private async pushFoundZaloGroupLinksToJoinCampaigns(sourceCampaign: Campaign, rawLinks: string[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindLinkGroupZalo) return

    const targetCampaignIds = this.getFindDataConfiguredTargetCampaignIds(
      sourceCampaign.extraSettings.findZaloGroupLinkJoinTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const links = this.uniqueExternalValues(rawLinks)
    if (links.length === 0) return

    for (const targetCampaignId of targetCampaignIds) {
      try {
        const targetCampaign = await this.supabase.getCampaign(targetCampaignId)
        if (!targetCampaign || targetCampaign.actionId !== ZALO_JOIN_GROUP_LINK_ACTION_ID) continue

        await this.supabase.createCampaignInputDataBatch(
          links.map<Partial<CampaignInputData>>(link => ({
            campaignId: targetCampaign.id,
            uid: link,
            status: 'chờ xử lý',
            note: `Đã thêm từ chiến dịch "${sourceCampaign.name}"`
          }))
        )

        const reopenedTarget = await this.supabase.reopenCompletedCampaignAfterInputInsert(
          targetCampaign.id,
          ZALO_JOIN_GROUP_LINK_ACTION_ID
        )
        if (reopenedTarget) this.broadcastCampaignUpdate(reopenedTarget)

        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${links.length} link group Zalo sang chiến dịch "${targetCampaign.name}"`)
        await this.logCampaignProgress(targetCampaign.id, `✅ Đã nhận ${links.length} link group Zalo từ chiến dịch "${sourceCampaign.name}"`, { emitRealtime: false })
      } catch (err) {
        console.error('Failed to push found Zalo group links to join campaign:', err)
      }
    }
  }

  private async pushFoundPhonesToAkaBizDesktopCampaigns(sourceCampaign: Campaign, rawPhones: string[], phoneProfiles: FindDataPhoneProfile[] = []): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindPhone) return

    const targetCampaignIds = this.getExternalTargetCampaignIds(
      sourceCampaign.extraSettings.findPhoneAkaBizDesktopTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const phones = this.uniqueExternalValues(rawPhones)
    if (phones.length === 0) return
    const phoneNameByValue = this.getPhoneProfileNameMap(phoneProfiles)

    const integrations = await this.loadAkaBizIntegrationsForCampaign(sourceCampaign)
    const integration = integrations?.akaBizDesktop
    if (!integration?.staffId || !integration.dbPath) {
      await this.logExternalPushWarning(sourceCampaign, 'Chưa tích hợp akaBiz Desktop nên không thể đẩy SĐT ra campaign ngoài hệ thống.')
      return
    }

    for (const targetCampaignId of targetCampaignIds) {
      let targetCampaignName = 'chiến dịch đã chọn'
      try {
        const targetCampaign = this.ensureAkaBizDesktopCampaignPending(integration, targetCampaignId)
        targetCampaignName = this.formatAkaBizCampaignName(targetCampaign.name)
        addAkaBizDesktopCampaignDetails(integration, phones.map(phone => ({
          campaignId: targetCampaignId,
          status: 1,
          name: phoneNameByValue.get(this.normalizeExternalValueForCompare(phone)) || '',
          phone,
          isAutomate: true
        })))
        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${phones.length} SĐT sang ${targetCampaignName}`)
      } catch (err) {
        console.error('Failed to push found phones to akaBiz Desktop campaign:', err)
        await this.logExternalPushWarning(sourceCampaign, `Không thể đẩy SĐT sang ${targetCampaignName}`, err)
      }
    }
  }

  private async pushFoundZaloGroupLinksToAkaBizDesktopCampaigns(sourceCampaign: Campaign, rawLinks: string[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindLinkGroupZalo) return

    const targetCampaignIds = this.getExternalTargetCampaignIds(
      sourceCampaign.extraSettings.findZaloGroupLinkAkaBizDesktopTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const links = this.uniqueExternalValues(rawLinks)
    if (links.length === 0) return

    const integrations = await this.loadAkaBizIntegrationsForCampaign(sourceCampaign)
    const integration = integrations?.akaBizDesktop
    if (!integration?.staffId || !integration.dbPath) {
      await this.logExternalPushWarning(sourceCampaign, 'Chưa tích hợp akaBiz Desktop nên không thể đẩy link group Zalo ra campaign ngoài hệ thống.')
      return
    }

    for (const targetCampaignId of targetCampaignIds) {
      let targetCampaignName = 'chiến dịch đã chọn'
      try {
        const targetCampaign = this.ensureAkaBizDesktopCampaignPending(integration, targetCampaignId)
        targetCampaignName = this.formatAkaBizCampaignName(targetCampaign.name)
        addAkaBizDesktopCampaignDetails(integration, links.map(link => ({
          campaignId: targetCampaignId,
          status: 1,
          uid: link,
          isAutomate: true
        })))
        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${links.length} link group Zalo sang ${targetCampaignName}`)
      } catch (err) {
        console.error('Failed to push found Zalo group links to akaBiz Desktop campaign:', err)
        await this.logExternalPushWarning(sourceCampaign, `Không thể đẩy link group Zalo sang ${targetCampaignName}`, err)
      }
    }
  }

  private normalizePostBumpCount(value: unknown): number {
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed)) return 3
    return Math.min(10, Math.max(1, parsed))
  }

  private normalizePostBumpMinutes(value: unknown, fallback: number, min: number): number {
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, parsed)
  }

  private normalizeRateLimitMinutes(value: unknown): number {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_MINUTES
  }

  private normalizePostBumpRotationIndex(value: unknown, targetCount: number): number {
    if (targetCount <= 0) return 0
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed)) return 0
    return ((parsed % targetCount) + targetCount) % targetCount
  }

  private async enqueuePostBumpAfterGroupPost(campaign: Campaign, rawPostUrl: string, isPending?: boolean): Promise<void> {
    const extra = campaign.extraSettings || {}
    if (campaign.actionId !== 'facebook_group_post' || extra.enablePostBump !== true) return

    const postUrl = this.cleanPostLinkForStorage(rawPostUrl)
    if (!postUrl || isPending === true || postUrl.includes('/pending_posts/')) return

    const targets = await this.resolvePostBumpTargets(campaign)
    if (targets.length === 0) {
      const message = 'Chưa có chiến dịch up tin để nhận link bài post'
      await this.logCampaignProgress(campaign.id, `⚠️ ${message}`)
      return
    }

    const count = this.normalizePostBumpCount(extra.postBumpCount)
    const initialDelay = this.normalizePostBumpMinutes(extra.postBumpInitialDelayMinutes, 30, 0)
    const interval = this.normalizePostBumpMinutes(extra.postBumpIntervalMinutes, 10, 1)
    const startIndex = this.normalizePostBumpRotationIndex(extra.postBumpRotationIndex, targets.length)
    const now = await this.getDatabaseBusinessNow()
    const earliestByCampaign = new Map<number, Date>()

    for (let i = 0; i < count; i++) {
      const target = targets[(startIndex + i) % targets.length]
      const schedule = new Date(now.getTime() + (initialDelay + i * interval) * 60 * 1000)
      await this.supabase.createCampaignInputData({
        campaignId: target.campaignId,
        uid: postUrl,
        status: 'chờ xử lý',
        schedule: schedule.toISOString(),
        note: `Đã thêm từ chiến dịch "${campaign.name}"`
      })
      const currentEarliest = earliestByCampaign.get(target.campaignId)
      if (!currentEarliest || schedule.getTime() < currentEarliest.getTime()) {
        earliestByCampaign.set(target.campaignId, schedule)
      }
    }

    const nextRotationIndex = (startIndex + count) % targets.length
    const nextExtraSettings = {
      ...campaign.extraSettings,
      postBumpRotationIndex: nextRotationIndex
    }
    campaign.extraSettings = nextExtraSettings
    await this.updateCampaignAndBroadcast(campaign.id, { extraSettings: nextExtraSettings })

    for (const campaignId of earliestByCampaign.keys()) {
      await this.refreshPostBumpTargetCampaignSchedule(campaignId)
    }

    const message = `Đã thêm ${count} lượt up tin cho bài post`
    await this.logCampaignProgress(campaign.id, `✅ ${message}`)
  }

  private async resolvePostBumpTargets(campaign: Campaign): Promise<PostBumpTarget[]> {
    const extra = campaign.extraSettings || {}

    if (extra.postBumpMode === 'create') {
      return this.resolveCreatedPostBumpTargets(campaign)
    }

    const targetIds = Array.from(new Set(
      (extra.postBumpTargetCampaignIds || [])
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id > 0 && id !== campaign.id)
    ))
    const targets: PostBumpTarget[] = []
    for (const targetId of targetIds) {
      try {
        const targetCampaign = await this.supabase.getCampaign(targetId)
        if (targetCampaign && targetCampaign.actionId === COMMENT_SEEDING_POST_ACTION_ID) {
          targets.push({ campaignId: targetCampaign.id })
        }
      } catch (err) {
        console.error('Failed resolve selected post bump target campaign:', err)
      }
    }
    return targets
  }

  private async resolveCreatedPostBumpTargets(campaign: Campaign): Promise<PostBumpTarget[]> {
    const extra = campaign.extraSettings || {}
    const accountIds = Array.from(new Set(
      (extra.postBumpAccountIds || [])
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id > 0)
    ))
    if (accountIds.length === 0) return []

    const mapping: Record<string, number> = { ...(extra.postBumpCreatedCampaignIdsByAccount || {}) }
    let mappingChanged = false
    const targets: PostBumpTarget[] = []

    for (const accountId of accountIds) {
      const key = String(accountId)
      let targetCampaignId = Number(mapping[key])
      let targetCampaign = targetCampaignId ? await this.supabase.getCampaign(targetCampaignId).catch(() => null) : null

      if (!targetCampaign || targetCampaign.actionId !== COMMENT_SEEDING_POST_ACTION_ID || targetCampaign.isDelete) {
        targetCampaign = await this.createPostBumpTargetCampaign(campaign, accountId)
        targetCampaignId = targetCampaign.id
        mapping[key] = targetCampaignId
        mappingChanged = true
      }

      targets.push({ campaignId: targetCampaignId })
    }

    if (mappingChanged) {
      const nextExtraSettings = {
        ...campaign.extraSettings,
        postBumpCreatedCampaignIdsByAccount: mapping
      }
      campaign.extraSettings = nextExtraSettings
      await this.updateCampaignAndBroadcast(campaign.id, { extraSettings: nextExtraSettings })
    }

    return targets
  }

  private async createPostBumpTargetCampaign(sourceCampaign: Campaign, accountId: number): Promise<Campaign> {
    const account = await this.supabase.getAccount(accountId).catch(() => null)
    const content = String(sourceCampaign.extraSettings?.postBumpContent || '').trim()
    const rateLimitMinutes = this.normalizeRateLimitMinutes(account?.rateLimitMinutes)
    const actionLimits: CampaignActionLimitSettings = {
      sleepBetweenActions: 0,
      enabledActionCodes: ['fb_comment'],
      dailyLimit: 1000,
      rateLimitCount: 1000,
      rateLimitMinutes,
      byActionCode: {
        fb_comment: {
          dailyLimit: 1000,
          rateLimitCount: 1000,
          rateLimitMinutes
        }
      }
    }

    const created = await this.supabase.createCampaign({
      name: `Up tin cho chiến dịch ${sourceCampaign.name}${account?.name ? ` - ${account.name}` : ''}`,
      actionId: COMMENT_SEEDING_POST_ACTION_ID,
      accountId,
      status: 'chờ xử lý',
      schedule: (await this.getDatabaseBusinessNow()).toISOString(),
      scheduleType: 'daily',
      scheduleEndDate: null,
      dailyStopTime: null,
      continueNextDay: true,
      refreshData: true,
      content,
      extraSettings: {
        enableComment: true,
        commentContent: content,
        commentCount: 1,
        postsPerTarget: 1,
        enablePostLike: false,
        actionLimits
      },
      images: []
    })

    await this.logCampaignProgress(created.id, `✅ Đã tạo chiến dịch up tin "${created.name}"`)
    return created
  }

  private async refreshPostBumpTargetCampaignSchedule(campaignId: number): Promise<void> {
    const targetCampaign = await this.supabase.getCampaign(campaignId)
    if (!targetCampaign) return

    const nextSchedule = await this.getNextPendingInputSchedule(campaignId)
    if (!nextSchedule) return

    const updates: Partial<Campaign> = {
      schedule: nextSchedule.toISOString()
    }
    if (targetCampaign.status === 'hoàn thành') {
      updates.status = 'chờ xử lý'
      updates.note = null
    }

    await this.updateCampaignAndBroadcast(campaignId, updates)
  }

  private async getNextPendingInputSchedule(campaignId: number): Promise<Date | null> {
    const details = await this.supabase.listCampaignInputData(campaignId)
    const now = await this.getDatabaseBusinessNow()
    let earliestFuture: Date | null = null

    for (const detail of details) {
      if (detail.status !== 'chờ xử lý') continue
      if (!detail.schedule) return now

      const scheduledAt = new Date(detail.schedule)
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= now.getTime()) {
        return now
      }
      if (!earliestFuture || scheduledAt.getTime() < earliestFuture.getTime()) {
        earliestFuture = scheduledAt
      }
    }

    return earliestFuture
  }

  private normalizeUidForCompare(uid: string): string {
    return String(uid || '').trim().replace(/\/+$/g, '').toLowerCase()
  }

  private normalizePostLinkForCompare(link: string): string {
    const raw = this.cleanPostLinkForStorage(link)
    if (!raw) return ''
    try {
      const url = new URL(raw, 'https://www.facebook.com')
      if (/^(m|mbasic|mobile)\.facebook\.com$/i.test(url.hostname)) {
        url.hostname = 'www.facebook.com'
      }
      url.hash = ''
      for (const key of Array.from(url.searchParams.keys())) {
        if (key.startsWith('__') || key === 'mibextid' || key === 'ref' || key === 'locale') {
          url.searchParams.delete(key)
        }
      }
      return url.toString().replace(/\/+$/g, '').toLowerCase()
    } catch {
      return raw.replace(/\/+$/g, '').toLowerCase()
    }
  }

  private cleanPostLinkForStorage(link: string): string {
    const raw = String(link || '').trim()
    if (!raw) return ''
    try {
      const url = new URL(raw, 'https://www.facebook.com')
      if (/^(m|mbasic|mobile)\.facebook\.com$/i.test(url.hostname)) {
        url.hostname = 'www.facebook.com'
      }
      url.hash = ''
      for (const key of Array.from(url.searchParams.keys())) {
        if (
          key.startsWith('__') ||
          key === 'mibextid' ||
          key === 'ref' ||
          key === 'locale' ||
          key === 'comment_id' ||
          key === 'reply_comment_id'
        ) {
          url.searchParams.delete(key)
        }
      }
      return url.toString()
    } catch {
      return raw
    }
  }

  private formatOrdinalPost(position: number): string {
    return position === 1 ? 'bài đầu tiên' : `bài thứ ${position}`
  }

  private formatGroupPendingProgressLog(isPending: boolean, pendingCheckConclusive: boolean): string {
    if (isPending) return '⏳ Group cần duyệt bài'
    return pendingCheckConclusive
      ? '✅ Group không cần duyệt bài'
      : '⚠️ Chưa xác định được trạng thái duyệt bài'
  }

  private async syncGroupPostContactStatus(
    accountId: number,
    detail: CampaignInputData | null,
    requiresPostApproval: boolean | undefined
  ): Promise<void> {
    if (!detail?.uid) return
    try {
      await this.supabase.upsertGroupPostContactStatus({
        accountId,
        targetUrl: detail.uid,
        targetName: detail.name,
        requiresPostApproval
      })
    } catch (err) {
      console.error('Failed to sync group contact status:', err)
    }
  }

  private async recoverStuckCampaignInputData(campaignId: number, errMsg: string): Promise<void> {
    try {
      const details = await this.supabase.listCampaignInputData(campaignId)
      for (const d of details) {
        if (d.status === 'đang chạy') {
          // campaign_input_data enum không có 'lỗi' — flag bằng 'hoàn thành' + note
          await this.supabase.updateCampaignInputData(d.id, {
            status: 'hoàn thành',
            note: errMsg === ZALO_RUNTIME_HANDOFF_UNCERTAIN_NOTE || errMsg === ZALO_RUNTIME_SHUTDOWN_UNCERTAIN_NOTE
              ? errMsg
              : `Dừng đột ngột: ${errMsg}`
          })
        }
      }
    } catch (recoverErr) {
      console.error('Failed to recover stuck campaign input data:', recoverErr)
    }
  }

  private sendLog(
    message: string,
    action?: CampaignLogAction,
    context: Pick<CampaignLogEntry, 'accountId' | 'accountName' | 'campaignId' | 'campaignName'> = {}
  ): void {
    const entry: CampaignSchedulerLogEntry = {
      timestamp: new Date().toISOString(),
      message,
      ...context,
      ...(action ? { action } : {})
    }

    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_LOG, entry)
    } catch {
      // Window may be closed
    }

    if (!this.logSink) return
    try {
      void Promise.resolve(this.logSink(entry)).catch(err => {
        console.error('Campaign scheduler log sink failed:', err)
      })
    } catch (err) {
      console.error('Campaign scheduler log sink failed:', err)
    }
  }

  private async logCampaignProgress(
    campaignId: number,
    message: string,
    options: { emitRealtime?: boolean; realtimeAction?: CampaignLogAction; realtimeMessage?: string } = {}
  ): Promise<void> {
    let realtimeMessage = options.realtimeMessage ?? message
    let realtimeContext: Pick<CampaignLogEntry, 'accountId' | 'accountName' | 'campaignId' | 'campaignName'> = {
      campaignId
    }
    try {
      const updated = await this.supabase.appendCampaignLog(campaignId, message)
      this.broadcastCampaignUpdate(updated)
      realtimeContext = {
        accountId: updated.accountId,
        accountName: updated.accountName,
        campaignId: updated.id,
        campaignName: updated.name
      }
      realtimeMessage = formatCampaignLogMessage(realtimeMessage, {
        accountName: updated.accountName,
        campaignName: updated.name
      })
    } catch (err) {
      console.error('Failed append campaign progress log:', err)
    }
    if (options.emitRealtime !== false) {
      this.sendLog(realtimeMessage, options.realtimeAction, realtimeContext)
    }
  }

  private async getAutomationPage(account: AutoAccount, campaignId?: number): Promise<AutomationPageRef> {
    await this.proxyRuntime?.prepareAccountSession(account)
    this.selectAutomationBrowser(account.id, campaignId)
    return {
      page: this.backgroundPages.getOrCreate(account.id, account.flatformType),
      source: 'background'
    }
  }

  private normalizeZaloTarget(phone: string, user: ZaloFoundUser, isFriend?: boolean): ZaloResolvedTarget {
    return {
      uid: user.uid,
      phone,
      displayName: user.displayName || user.originalName || '',
      originalName: user.originalName || user.displayName || '',
      gender: user.gender ?? null,
      isFriend,
      raw: user.raw
    }
  }

  private normalizeZaloTargetFromInputData(
    uid: string,
    targetName?: string,
    inputData?: Record<string, unknown>,
    raw?: Record<string, unknown>,
    isFriend = true
  ): ZaloResolvedTarget {
    const input = inputData || {}
    const displayName = this.firstNonEmptyString(targetName, input.name, uid)
    return {
      uid,
      phone: this.firstNonEmptyString(input.phone),
      displayName,
      originalName: this.firstNonEmptyString(input.originalName, input.zaloName, input.zalo_name) || undefined,
      gender: null,
      isFriend,
      raw: {
        ...(raw || {}),
        inputData: input
      }
    }
  }

  private mergeZaloFriendProfileTarget(target: ZaloResolvedTarget, profile: ZaloFoundUser | null): ZaloResolvedTarget {
    if (!profile) return target
    const displayName = this.firstNonEmptyString(profile.displayName, target.displayName)
    const originalName = this.firstNonEmptyString(
      profile.raw?.zaloName,
      profile.raw?.zalo_name,
      profile.originalName
    )
    return {
      ...target,
      phone: this.firstNonEmptyString(profile.phone, profile.raw?.phoneNumber, profile.raw?.phone, target.phone),
      displayName,
      originalName: originalName || undefined,
      gender: profile.gender ?? null,
      raw: {
        ...(target.raw || {}),
        profileUid: profile.uid,
        profileAvatar: profile.avatar || null,
        profile: profile.raw
      }
    }
  }

  private async resolveZaloFriendMessageTarget(account: AutoAccount, target: ZaloResolvedTarget): Promise<ZaloResolvedTarget> {
    if (!this.zaloRuntime || !target.uid) return target
    try {
      const profile = await this.zaloRuntime.getUserProfile(account.id, target.uid)
      return this.mergeZaloFriendProfileTarget(target, profile)
    } catch (err) {
      console.warn('[CampaignScheduler] Failed to get Zalo friend profile before message send:', {
        accountId: account.id,
        targetUid: target.uid,
        message: this.getZaloErrorMessage(err)
      })
      return target
    }
  }

  private getZaloErrorMessage(err: unknown): string {
    if (err instanceof Error) return String(err.message || '').trim()
    const message = (err as any)?.message
    if (message !== undefined && message !== null) return String(message).trim()
    return String(err || '').trim()
  }

  private getZaloErrorCode(err: unknown): string | null {
    if (err instanceof ZaloApiError && err.code !== null && err.code !== undefined) {
      return String(err.code)
    }
    const code = (err as any)?.code
    return code === null || code === undefined || String(code).trim() === ''
      ? null
      : String(code).trim()
  }

  private buildZaloFallbackErrorLog(actionName: string, rawMessage: string, zaloCode: string | null): string {
    const message = String(rawMessage || '').trim() || 'Lỗi Zalo chưa xác định'
    const suffix = zaloCode ? ` (mã Zalo: ${zaloCode})` : ''
    return `${actionName || 'Thao tác Zalo'} thất bại: ${message}${suffix}`
  }

  private normalizeZaloDetailStatus(value: string | null | undefined): string | null {
    const trimmed = String(value || '').trim()
    if (!trimmed) return null
    const lower = trimmed.toLocaleLowerCase('vi-VN')
    if (lower === 'thất bại') return 'thất bại'
    if (lower === 'lỗi') return 'lỗi'
    if (lower === 'thành công') return 'thành công'
    return trimmed
  }

  private async getZaloPolicyByErrorCode(errorCode: string | null): Promise<AutoErrorPolicy | null> {
    if (errorCode) {
      const mapped = await this.supabase.getZaloErrorPolicyByCode(errorCode)
      if (mapped) return mapped
    }
    return this.supabase.getErrorPolicy(ZALO_API_BUSINESS_FAILED_ERROR_CODE)
  }

  private async getZaloNotFoundPolicy(): Promise<AutoErrorPolicy | null> {
    return this.supabase.getErrorPolicy(ZALO_USER_NOT_FOUND_ERROR_CODE)
  }

  private renderZaloPolicyLog(
    policy: AutoErrorPolicy | null,
    rawMessage: string,
    replacements: Record<string, string | undefined>,
    zaloCode: string | null = null
  ): string {
    if (policy?.errorCode === ZALO_API_BUSINESS_FAILED_ERROR_CODE) {
      return this.buildZaloFallbackErrorLog(replacements.actionName || replacements.action || '', rawMessage, zaloCode)
    }

    const rendered = policy
      ? this.renderPolicyMessage(policy.notiRunningProcess || policy.notiCampaign, {
        ...replacements,
        message: rawMessage,
        x: rawMessage
      })
      : ''
    return rendered || rawMessage || policy?.errorName || this.buildZaloFallbackErrorLog(replacements.actionName || replacements.action || '', '', zaloCode)
  }

  private async applyZaloPolicySideEffects(
    account: AutoAccount,
    campaign: Campaign,
    policy: AutoErrorPolicy | null,
    message: string
  ): Promise<{ stopAfterTarget: boolean }> {
    let stopAfterTarget = false
    if (!policy) return { stopAfterTarget }
    this.throwIfZaloRuntimeStopping(campaign.id)

    if (policy.updateLoginStatus) {
      await this.updateAccountAndBroadcast(account.id, { loginStatus: policy.updateLoginStatus })
      this.throwIfZaloRuntimeStopping(campaign.id)
      this.zaloRuntime?.invalidateAccount(account.id)
      stopAfterTarget = true
    }
    if (policy.updateStatusAccount) {
      await this.updateAccountAndBroadcast(account.id, { status: policy.updateStatusAccount })
      this.throwIfZaloRuntimeStopping(campaign.id)
      stopAfterTarget = true
    }
    if (policy.disableActionCodes.length > 0) {
      await this.supabase.disableAccountActions(account.id, policy.disableActionCodes, policy.timeDisableActions, {
        errorCode: policy.errorCode,
        reason: message,
        dateEnable: await this.resolvePolicyActionDateEnable(policy)
      })
      try { this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch {}
      this.throwIfZaloRuntimeStopping(campaign.id)
      stopAfterTarget = true
    }
    if (policy.updateStatusCampaign) {
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: policy.updateStatusCampaign,
        note: message
      })
      this.throwIfZaloRuntimeStopping(campaign.id)
      stopAfterTarget = true
    }

    return { stopAfterTarget }
  }

  private getZaloApiName(actionCode: string): string {
    switch (actionCode) {
      case 'zalo_find_phone_user':
        return 'findUser'
      case 'zalo_message_friend':
      case 'zalo_message_group':
      case 'zalo_message_stranger':
        return 'sendMessage'
      case 'zalo_add_friend':
        return 'sendFriendRequest'
      case 'zalo_cancel_sent_friend_request':
        return 'undoFriendRequest'
      case 'zalo_add_group_member':
        return 'addUserToGroup'
      case 'zalo_join_group_link':
        return 'joinGroupLink'
      case 'zalo_tag_contact':
        return 'updateLabels'
      case 'zalo_change_alias':
        return 'changeFriendAlias'
      default:
        return actionCode || 'unknown'
    }
  }

  /**
   * These actions enrich a target after the workflow's main outcome. Their
   * result is still persisted, but it must not change the campaign's
   * consecutive-bad-target safety counter in either direction.
   */
  private isAuxiliaryZaloTargetAction(actionCode: string): boolean {
    return actionCode === 'zalo_tag_contact' || actionCode === 'zalo_change_alias'
  }

  private shouldCountZaloActionTowardBadTarget(
    actionCode: string,
    policy: AutoErrorPolicy | null
  ): boolean {
    return !this.isAuxiliaryZaloTargetAction(actionCode) && (policy?.countsTowardBadTarget ?? true)
  }

  private getZaloTargetPayload(data: Record<string, unknown>): Record<string, unknown> {
    const target = data.target
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      return target as Record<string, unknown>
    }
    const phone = String(data.phone || '').trim()
    return phone ? { phone } : {}
  }

  private getZaloRequestPayload(actionCode: string, data: Record<string, unknown>): Record<string, unknown> {
    const { target: _target, ...rest } = data
    return {
      actionCode,
      ...rest
    }
  }

  private async logZaloApiError(input: {
    account: AutoAccount
    campaign: Campaign
    err: unknown
    actionCode: string
    actionName: string
    apiName?: string
    data: Record<string, unknown>
    zaloCode: string | null
    rawMessage: string
    policy: AutoErrorPolicy | null
    detailStatus: string | null
  }): Promise<void> {
    try {
      await this.supabase.createZaloApiErrorLog({
        staffId: input.campaign.staffId ?? input.account.staffId ?? null,
        organizationId: input.campaign.organizationId ?? input.account.organizationId ?? null,
        accountId: input.account.id,
        campaignId: input.campaign.id,
        campaignInputDataId: Number((input.data.inputData as Record<string, unknown> | undefined)?.id) || undefined,
        actionCode: input.actionCode,
        actionName: input.actionName,
        apiName: input.apiName || this.getZaloApiName(input.actionCode),
        zaloErrorCode: input.zaloCode,
        zaloErrorMessage: input.rawMessage || null,
        normalizedErrorCode: input.policy?.errorCode || null,
        detailStatus: input.detailStatus,
        requestPayload: this.getZaloRequestPayload(input.actionCode, input.data),
        targetPayload: this.getZaloTargetPayload(input.data),
        rawError: input.err
      })
    } catch (err) {
      console.warn('[ZaloRuntime] Failed to log raw Zalo API error:', {
        accountId: input.account.id,
        campaignId: input.campaign.id,
        actionCode: input.actionCode,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private async logCaughtZaloApiError(input: {
    account: AutoAccount
    campaign: Campaign
    err: unknown
    actionCode: string
    actionName: string
    apiName?: string
    data?: Record<string, unknown>
    detailStatus?: string | null
  }): Promise<void> {
    const rawMessage = this.getZaloErrorMessage(input.err)
    const zaloCode = this.getZaloErrorCode(input.err)
    const policy = await this.getZaloPolicyByErrorCode(zaloCode)
    await this.logZaloApiError({
      account: input.account,
      campaign: input.campaign,
      err: input.err,
      actionCode: input.actionCode,
      actionName: input.actionName,
      apiName: input.apiName,
      data: input.data || {},
      zaloCode,
      rawMessage,
      policy,
      detailStatus: input.detailStatus ?? this.normalizeZaloDetailStatus(policy?.detailStatus)
    })
  }

  private async createZaloErrorDetail(
    account: AutoAccount,
    campaign: Campaign,
    err: unknown,
    actionCode: string,
    actionName: string,
    data: Record<string, unknown> = {}
  ): Promise<ZaloActionDetailOutput> {
    this.throwIfZaloRuntimeStopping(campaign.id)
    const rawMessage = this.getZaloErrorMessage(err)
    const zaloCode = this.getZaloErrorCode(err)
    const policy = await this.getZaloPolicyByErrorCode(zaloCode)
    this.throwIfZaloRuntimeStopping(campaign.id)
    const log = this.renderZaloPolicyLog(policy, rawMessage, {
      actionName,
      action: actionName,
      actionCode
    }, zaloCode)
    const sideEffects = await this.applyZaloPolicySideEffects(account, campaign, policy, log)
    this.throwIfZaloRuntimeStopping(campaign.id)
    const detailStatus = this.normalizeZaloDetailStatus(policy?.detailStatus)
    await this.logZaloApiError({
      account,
      campaign,
      err,
      actionCode,
      actionName,
      data,
      zaloCode,
      rawMessage,
      policy,
      detailStatus
    })
    this.throwIfZaloRuntimeStopping(campaign.id)
    const detail: ZaloActionDetailOutput = {
      createDetail: Boolean(detailStatus),
      actionCode,
      actionName,
      status: detailStatus || undefined,
      errorCode: policy?.errorCode || null,
      log,
      countsTowardLimit: policy?.countsTowardLimit ?? true,
      countsTowardBadTarget: this.shouldCountZaloActionTowardBadTarget(actionCode, policy),
      resetInputToPending: !detailStatus,
      pendingNote: log,
      stopAfterTarget: sideEffects.stopAfterTarget,
      data: {
        ...data,
        error: rawMessage || undefined,
        zalo: {
          code: zaloCode,
          message: rawMessage,
          policyErrorCode: policy?.errorCode || null
        }
      }
    }
    return detail
  }

  private async createZaloPolicyDetailFromCode(
    account: AutoAccount,
    campaign: Campaign,
    policy: AutoErrorPolicy | null,
    rawMessage: string,
    actionCode: string,
    actionName: string,
    zaloCode: string | null,
    data: Record<string, unknown> = {}
  ): Promise<ZaloActionDetailOutput> {
    this.throwIfZaloRuntimeStopping(campaign.id)
    const log = this.renderZaloPolicyLog(policy, rawMessage, {
      actionName,
      action: actionName,
      actionCode
    }, zaloCode)
    const sideEffects = await this.applyZaloPolicySideEffects(account, campaign, policy, log)
    this.throwIfZaloRuntimeStopping(campaign.id)
    const detailStatus = this.normalizeZaloDetailStatus(policy?.detailStatus)
    return {
      createDetail: Boolean(detailStatus),
      actionCode,
      actionName,
      status: detailStatus || undefined,
      errorCode: policy?.errorCode || null,
      log,
      countsTowardLimit: policy?.countsTowardLimit ?? true,
      countsTowardBadTarget: this.shouldCountZaloActionTowardBadTarget(actionCode, policy),
      resetInputToPending: !detailStatus,
      pendingNote: log,
      stopAfterTarget: sideEffects.stopAfterTarget,
      data: {
        ...data,
        error: rawMessage || undefined,
        zalo: {
          code: zaloCode,
          message: rawMessage,
          policyErrorCode: policy?.errorCode || null
        }
      }
    }
  }

  private createZaloSuccessDetail(input: {
    actionCode: string
    actionName: string
    status?: string
    log: string
    data?: Record<string, unknown>
    countsTowardLimit?: boolean
  }): ZaloActionDetailOutput {
    return {
      createDetail: true,
      actionCode: input.actionCode,
      actionName: input.actionName,
      status: input.status || 'thành công',
      log: input.log,
      data: input.data || {},
      countsTowardLimit: input.countsTowardLimit ?? true,
      countsTowardBadTarget: !this.isAuxiliaryZaloTargetAction(input.actionCode)
    }
  }

  private getZaloTargetLabel(target: ZaloResolvedTarget | null | undefined): string {
    return target?.displayName || target?.originalName || target?.phone || target?.uid || 'target'
  }

  private templateUsesDatabaseDate(template: string | undefined | null): boolean {
    return /#\{(?:TODAY|TOMORROW|YESTERDAY)\([^}]*\)\}/.test(String(template || ''))
  }

  private async getTemplateBusinessNow(
    ...templates: Array<string | undefined | null>
  ): Promise<Date | undefined> {
    return templates.some(template => this.templateUsesDatabaseDate(template))
      ? await this.getDatabaseBusinessNow()
      : undefined
  }

  private renderZaloTemplate(
    template: string | undefined | null,
    inputData: Record<string, unknown> | undefined,
    target?: ZaloResolvedTarget | null,
    formatted = false,
    businessNow?: Date
  ): string {
    if (formatted) {
      return transformFormattedContentText(
        template,
        text => this.renderZaloTemplateText(text, inputData, target, businessNow)
      )
    }
    return this.renderZaloTemplateText(template, inputData, target, businessNow)
  }

  private renderZaloTemplateText(
    template: string | undefined | null,
    inputData: Record<string, unknown> | undefined,
    target?: ZaloResolvedTarget | null,
    businessNow?: Date
  ): string {
    const raw = this.renderSpinContent(template)
    if (!raw) return ''
    const formatDate = (format: string, offsetDays = 0): string => {
      if (!businessNow) {
        throw new Error('DB runtime clock is required for relative date template tokens')
      }
      const date = new Date(businessNow.getTime() + offsetDays * 24 * 60 * 60 * 1000)
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
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

    const input = inputData || {}
    const getInput = (key: string): string => String(input[key] ?? '').trim()
    const renderPhone = (): string => this.firstNormalizedVietnamMobilePhone(target?.phone, input.phone)
    const renderSex = (body: string): string => {
      const [male = '', female = '', unknown = ''] = String(body || '').split('-')
      const gender = target?.gender
      const normalized = String(gender ?? '').toLocaleLowerCase('vi-VN')
      if (gender === 0 || normalized === '0' || normalized === 'male' || normalized === 'nam') return male
      if (gender === 1 || normalized === '1' || normalized === 'female' || normalized === 'nữ' || normalized === 'nu') return female
      return unknown || male || female
    }

    return raw
      .replace(/#\{(TODAY|TOMORROW|YESTERDAY)\(([^}]*)\)\}/g, (_, token, fmt) => {
        const offsetDays = token === 'TOMORROW' ? 1 : token === 'YESTERDAY' ? -1 : 0
        return formatDate(String(fmt || 'DD/MM/YYYY'), offsetDays)
      })
      .replace(/#\{SEX\{([^}]*)\}\}/g, (_, body) => renderSex(String(body || '')))
      .replace(/#\{FULL_NAME\}/g, target?.displayName || '')
      .replace(/#\{ORIGINAL_NAME\}/g, target?.originalName || '')
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
  }

  private async buildZaloOutgoingMessage(
    account: AutoAccount,
    campaign: Campaign,
    rawMessage: string | undefined | null,
    inputData: Record<string, unknown> | undefined,
    target: ZaloResolvedTarget | null | undefined,
    metadata?: BlockRuntimeMetadata
  ): Promise<ZaloOutgoingText> {
    const formatted = this.isFormattedContentCampaign(campaign)
    const businessNow = await this.getTemplateBusinessNow(rawMessage)
    const rendered = this.renderZaloTemplate(rawMessage, inputData, target, formatted, businessNow)
    if (formatted) return convertHtmlToZaloMessage(rendered)
    return this.rewriteZaloMessageForRun(account, campaign, rendered, metadata)
  }

  private async logZaloAiRewriteRunEvent(
    account: AutoAccount,
    campaign: Campaign,
    metadata: BlockRuntimeMetadata | undefined,
    status: 'success' | 'warning',
    message: string,
    debugData?: Record<string, unknown>
  ): Promise<void> {
    if (!metadata?.runId && !metadata?.runStepId) return

    try {
      await campaignRunEventRepo.createCampaignRunEvents([{
        campaignId: metadata.campaignId ?? campaign.id,
        campaignActionId: campaign.actionId,
        campaignInputId: metadata.campaignInputId ?? null,
        campaignInputDataId: metadata.campaignInputDataId ?? null,
        accountId: metadata.accountId ?? account.id,
        runId: metadata.runId ?? null,
        runStepId: metadata.runStepId ?? null,
        nodeId: metadata.nodeId ?? null,
        blockId: metadata.blockId ?? null,
        blockName: metadata.blockName ?? null,
        eventType: 'zalo_ai_rewrite',
        eventName: status === 'success' ? 'zalo_ai_rewrite_success' : 'zalo_ai_rewrite_fallback',
        targetType: 'zalo',
        status,
        isUserVisible: false,
        message,
        debugData
      }])
    } catch (err) {
      console.warn('[CampaignScheduler] failed to log Zalo AI rewrite event', {
        campaignId: campaign.id,
        accountId: account.id,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private async rewriteZaloMessageForRun(
    account: AutoAccount,
    campaign: Campaign,
    renderedMessage: string,
    metadata?: BlockRuntimeMetadata
  ): Promise<string> {
    const original = String(renderedMessage || '')
    const content = original.trim()
    if (campaign.extraSettings?.rewriteContentEachRun !== true || !content) {
      return original
    }

    try {
      const result = await callAiUsing(ZALO_MESSAGE_REWRITE_AI_CODE, {
        content,
        question: content,
        source: 'aka_agent'
      }, {
        organizationId: campaign.organizationId ?? account.organizationId ?? metadata?.organizationId ?? null,
        accountId: metadata?.accountId ?? account.id,
        campaignId: metadata?.campaignId ?? campaign.id,
        campaignInputId: metadata?.campaignInputId,
        campaignInputDataId: metadata?.campaignInputDataId,
        workflowId: metadata?.workflowId,
        runId: metadata?.runId,
        runStepId: metadata?.runStepId,
        nodeId: metadata?.nodeId,
        blockId: metadata?.blockId,
        blockName: metadata?.blockName ?? 'zalo_send_message'
      })

      const rewritten = this.stripAiCodeFence(result.content)
      if (result.ok && rewritten) {
        await this.logZaloAiRewriteRunEvent(
          account,
          campaign,
          metadata,
          'success',
          'Đã viết lại nội dung bằng AI'
        )
        return rewritten
      }

      throw new Error(result.error || 'AI trả về nội dung không hợp lệ.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const fallbackLog = `AI viết lại nội dung lỗi, dùng nội dung gốc: ${message}`
      console.warn('[CampaignScheduler] Zalo AI rewrite failed, using original content', {
        campaignId: campaign.id,
        accountId: account.id,
        campaignInputDataId: metadata?.campaignInputDataId ?? null,
        blockName: metadata?.blockName ?? null,
        message
      })
      await this.logZaloAiRewriteRunEvent(account, campaign, metadata, 'warning', fallbackLog, {
        error: message
      })
      await this.logCampaignProgress(campaign.id, `⚠️ ${fallbackLog}`).catch(logErr => {
        console.warn('[CampaignScheduler] failed to log Zalo AI rewrite fallback', {
          campaignId: campaign.id,
          accountId: account.id,
          error: logErr instanceof Error ? logErr.message : String(logErr)
        })
      })
      return original
    }
  }

  private stripAiCodeFence(value: string): string {
    const text = String(value || '').trim()
    const match = text.match(/^```(?:text|txt)?\s*([\s\S]*?)\s*```$/i)
    return match ? match[1].trim() : text
  }

  private async rewriteEmailPlainTextBodyForRun(
    account: AutoAccount,
    campaign: Campaign,
    options: EmailSendMessageOptions,
    renderedBody: string
  ): Promise<string> {
    const body = String(renderedBody || '')
    if (options.isHtml === true || campaign.extraSettings?.rewriteContentEachRun !== true || !body.trim()) {
      return body
    }

    try {
      const result = await callAiUsing('app_ai_rewrite_content', { content: body }, {
        organizationId: campaign.organizationId ?? account.organizationId ?? null,
        accountId: account.id,
        campaignId: campaign.id,
        campaignInputDataId: Number(options.inputData?.id) || undefined,
        blockName: 'email_send_message'
      })
      const rewritten = this.stripAiCodeFence(result.content)
      if (result.ok && rewritten) return rewritten

      console.warn('[CampaignScheduler] Email AI rewrite failed, using original body', {
        campaignId: campaign.id,
        accountId: account.id,
        inputDataId: Number(options.inputData?.id) || null,
        error: result.error || 'empty_ai_content'
      })
    } catch (err) {
      console.warn('[CampaignScheduler] Email AI rewrite threw, using original body', {
        campaignId: campaign.id,
        accountId: account.id,
        inputDataId: Number(options.inputData?.id) || null,
        error: err instanceof Error ? err.message : String(err)
      })
    }

    return body
  }

  private async zaloFindPhoneUser(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloFindPhoneUserOptions
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const phone = String(options.phone || '').trim()
    if (!phone) {
      const detail = await this.createZaloPolicyDetailFromCode(
        account,
        campaign,
        await this.supabase.getZaloErrorPolicyByCode('114'),
        'SĐT Zalo không hợp lệ',
        'zalo_find_phone_user',
        'Tìm SĐT',
        '114',
        { phone }
      )
      return { ok: false, detail }
    }

    try {
      const searchResult = await this.zaloRuntime.findUserByPhone(account.id, phone)
      const user = searchResult.user
      const searchAttemptData = searchResult.attempts.length > 0
        ? { searchPhoneAttempts: searchResult.attempts }
        : {}
      this.throwIfZaloRuntimeStopping(campaign.id)
      if (!user) {
        const policy = await this.getZaloNotFoundPolicy()
        const detail = await this.createZaloPolicyDetailFromCode(
          account,
          campaign,
          policy,
          'Không tồn tại',
          'zalo_find_phone_user',
          'Tìm SĐT',
          '216',
          { phone, ...searchAttemptData }
        )
        return { ok: true, zaloTarget: null, detail }
      }

      const target = this.normalizeZaloTarget(phone, user)
      await this.upsertZaloFoundUserContact(account, user, campaign.actionId)
      this.throwIfZaloRuntimeStopping(campaign.id)
      await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person')
      this.throwIfZaloRuntimeStopping(campaign.id)
      const inputDataId = Number((options.inputData as Record<string, unknown> | undefined)?.id)
      // Data Group inputs are an immutable delivery snapshot. The resolved Zalo UID/name
      // belongs to the execution result/contact catalog, not back in the canonical ledger.
      if (campaign.dataTargetSourceMode !== 'data_group' && Number.isFinite(inputDataId) && inputDataId > 0) {
        const nextName = target.displayName || target.originalName || ''
        await this.supabase.updateCampaignInputData(inputDataId, {
          name: nextName || undefined,
          uid: target.uid
        })
      }
      const log = `Đã tìm thấy SĐT ${phone}: ${this.getZaloTargetLabel(target)}`
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode: 'zalo_find_phone_user',
          actionName: 'Tìm SĐT',
          log,
          data: { phone, target, ...searchAttemptData }
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      return {
        ok: false,
        detail: await this.createZaloErrorDetail(account, campaign, err, 'zalo_find_phone_user', 'Tìm SĐT', { phone, inputData: options.inputData })
      }
    }
  }

  private async zaloResolveGroupMemberTarget(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloResolveGroupMemberTargetOptions
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const uid = this.firstNonEmptyString(options.targetUid, options.inputData?.uid)
    if (!uid) {
      const detail = await this.createZaloPolicyDetailFromCode(
        account,
        campaign,
        await this.supabase.getZaloErrorPolicyByCode('114'),
        'UID thành viên group Zalo không hợp lệ',
        'zalo_message_stranger',
        'Nhắn tin người lạ',
        '114',
        { uid, inputData: options.inputData }
      )
      return { ok: false, detail }
    }

    const target = await this.resolveZaloFriendMessageTarget(
      account,
      this.normalizeZaloTargetFromInputData(
        uid,
        options.targetName,
        options.inputData,
        { source: 'zalo_group_members' },
        false
      )
    )
    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.upsertZaloResolvedProfileTarget(account, target, campaign.actionId)
    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person')

    return { ok: true, zaloTarget: target }
  }

  private async zaloResolveAddGroupMemberTarget(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloResolveAddGroupMemberTargetOptions
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const uid = this.firstNonEmptyString(options.targetUid, options.inputData?.uid)
    if (uid) {
      const target = await this.resolveZaloFriendMessageTarget(
        account,
        this.normalizeZaloTargetFromInputData(
          uid,
          options.targetName,
          options.inputData,
          { source: 'zalo_add_group_member' },
          false
        )
      )
      this.throwIfZaloRuntimeStopping(campaign.id)
      await this.upsertZaloResolvedProfileTarget(account, target, campaign.actionId)
      this.throwIfZaloRuntimeStopping(campaign.id)
      return { ok: true, zaloTarget: target }
    }

    const phone = this.firstNonEmptyString(options.phone, options.inputData?.phone)
    if (phone) {
      const limitDetail = await this.checkZaloFindPhoneUserRuntimeLimit(account, campaign, {
        phone,
        inputData: options.inputData
      })
      if (limitDetail) return { ok: false, detail: limitDetail }
      return this.zaloFindPhoneUser(account, campaign, {
        phone,
        targetName: options.targetName,
        inputData: options.inputData
      })
    }

    const actionCode = ZALO_ADD_GROUP_MEMBER_ACTION_ID
    const actionName = 'Thêm thành viên vào group'
    const detail = await this.createZaloPolicyDetailFromCode(
      account,
      campaign,
      await this.supabase.getZaloErrorPolicyByCode('114'),
      'Data cần có SĐT hoặc UID Zalo',
      actionCode,
      actionName,
      '114',
      { inputData: options.inputData }
    )
    detail.countsTowardLimit = false
    return { ok: false, detail }
  }

  private async zaloResolveRemarketingCustomerTarget(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloResolveGroupMemberTargetOptions
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const uid = this.firstNonEmptyString(options.targetUid, options.inputData?.uid)
    if (!uid) {
      const detail = await this.createZaloPolicyDetailFromCode(
        account,
        campaign,
        await this.supabase.getZaloErrorPolicyByCode('114'),
        'UID khách hàng cũ Zalo không hợp lệ',
        'zalo_message_stranger',
        'Nhắn tin người lạ',
        '114',
        { uid, inputData: options.inputData }
      )
      return { ok: false, detail }
    }

    const target = await this.resolveZaloFriendMessageTarget(
      account,
      this.normalizeZaloTargetFromInputData(
        uid,
        options.targetName,
        options.inputData,
        { source: 'zalo_remarketing_customers' },
        false
      )
    )
    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.upsertZaloResolvedProfileTarget(account, target, campaign.actionId)
    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person')

    return { ok: true, zaloTarget: target }
  }

  private async zaloResolveFriendRecommendationTarget(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloResolveGroupMemberTargetOptions
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const uid = this.firstNonEmptyString(options.targetUid, options.inputData?.uid)
    if (!uid) {
      const detail = await this.createZaloPolicyDetailFromCode(
        account,
        campaign,
        await this.supabase.getZaloErrorPolicyByCode('114'),
        'UID đề xuất Zalo không hợp lệ',
        'zalo_message_stranger',
        'Nhắn tin người lạ',
        '114',
        { uid, inputData: options.inputData }
      )
      return { ok: false, detail }
    }

    const target = await this.resolveZaloFriendMessageTarget(
      account,
      this.normalizeZaloTargetFromInputData(
        uid,
        options.targetName,
        options.inputData,
        { source: 'zalo_friend_recommendations' },
        false
      )
    )
    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.upsertZaloResolvedProfileTarget(account, target, campaign.actionId)
    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person')

    return { ok: true, zaloTarget: target }
  }

  private getZaloOutgoingMessageText(message: ZaloOutgoingText): string {
    return typeof message === 'string' ? message : String(message?.msg || '')
  }

  private async dispatchZaloMessage(
    accountId: number,
    threadId: string,
    isGroup: boolean,
    message: ZaloOutgoingText,
    attachments: string[]
  ): Promise<ZaloMessageDispatchResponse> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const safeAttachments = attachments.map(item => String(item || '').trim()).filter(Boolean)
    const hasContent = this.getZaloOutgoingMessageText(message).trim().length > 0
    const isFormatted = typeof message !== 'string'
    const send = (outgoing: ZaloOutgoingText, files: string[]): Promise<ZaloMessageSendResult> => (
      isGroup
        ? this.zaloRuntime!.sendMessageToGroup(accountId, threadId, outgoing, files)
        : this.zaloRuntime!.sendMessageToUser(accountId, threadId, outgoing, files)
    )

    if (safeAttachments.length >= 2) {
      const mediaResponse = await send('', safeAttachments)
      const response: ZaloMessageDispatchResponse = {
        sequence: hasContent ? 'media_then_content' : 'media_only',
        mediaResponse
      }
      if (!hasContent) return response
      try {
        response.contentResponse = await send(message, [])
        return response
      } catch (err) {
        throw new ZaloPartialSendError('content_after_media', err, response)
      }
    }

    if (isFormatted && safeAttachments.length === 1) {
      if (!hasContent) {
        return {
          sequence: 'media_only',
          mediaResponse: await send('', safeAttachments)
        }
      }

      const contentResponse = await send(message, [])
      const response: ZaloMessageDispatchResponse = {
        sequence: 'content_then_media',
        contentResponse
      }
      try {
        response.mediaResponse = await send('', safeAttachments)
        return response
      } catch (err) {
        throw new ZaloPartialSendError('media_after_content', err, response)
      }
    }

    return {
      sequence: safeAttachments.length > 0 ? 'combined' : 'content_only',
      response: await send(message, safeAttachments)
    }
  }

  private async createZaloPartialSendDetail(
    account: AutoAccount,
    campaign: Campaign,
    err: ZaloPartialSendError,
    actionCode: string,
    actionName: string,
    data: Record<string, unknown>
  ): Promise<ZaloActionDetailOutput> {
    const detail = await this.createZaloErrorDetail(
      account,
      campaign,
      err.causeError,
      actionCode,
      actionName,
      data
    )
    return this.finalizeZaloPartialSendDetail(detail, data, {
      stage: err.stage,
      sequence: err.response.sequence === 'content_then_media' ? 'content_then_media' : 'media_then_content',
      mediaResponse: err.response.mediaResponse,
      contentResponse: err.response.contentResponse,
      error: this.getZaloErrorMessage(err.causeError)
    })
  }

  private finalizeZaloPartialSendDetail(
    detail: ZaloActionDetailOutput,
    data: Record<string, unknown>,
    partialSend: ZaloPartialSendMetadata
  ): ZaloActionDetailOutput {
    const log = partialSend.stage === 'content_after_media'
      ? 'Đã gửi file nhưng gửi nội dung thất bại'
      : 'Đã gửi nội dung nhưng gửi file thất bại'
    return {
      ...detail,
      createDetail: true,
      status: 'thất bại',
      log,
      countsTowardLimit: true,
      countsTowardBadTarget: false,
      resetInputToPending: false,
      preventInputRetry: true,
      pendingNote: undefined,
      data: {
        ...(detail.data || {}),
        ...data,
        partialSend
      }
    }
  }

  private async zaloSendPhoneMessage(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloSendPhoneMessageOptions,
    metadata?: BlockRuntimeMetadata
  ): Promise<ZaloActionHelperResult> {
    if (!options.enabled) return { ok: true, skipped: true, zaloTarget: options.target ?? null }
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const target = options.target
    if (!target?.uid) return { ok: true, skipped: true }
    const attachments = (Array.isArray(options.attachments) ? options.attachments : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    const message = await this.buildZaloOutgoingMessage(
      account,
      campaign,
      options.message,
      options.inputData,
      target,
      metadata
    )
    const actionCode = 'zalo_message_stranger'
    const actionName = 'Nhắn tin người lạ'

    try {
      const response = await this.dispatchZaloMessage(account.id, target.uid, false, message, attachments)
      this.throwIfZaloRuntimeStopping(campaign.id)
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          log: `Đã gửi tin nhắn đến ${this.getZaloTargetLabel(target)}`,
          data: { target, message, attachments, response }
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const errorData = { target, message, attachments, inputData: options.inputData }
      return {
        ok: false,
        zaloTarget: target,
        detail: err instanceof ZaloPartialSendError
          ? await this.createZaloPartialSendDetail(account, campaign, err, actionCode, actionName, errorData)
          : await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, errorData)
      }
    }
  }

  private async zaloSendFriendMessage(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloSendDirectMessageOptions,
    metadata?: BlockRuntimeMetadata
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const uid = this.firstNonEmptyString(options.targetUid, options.inputData?.uid)
    const actionCode = 'zalo_message_friend'
    const actionName = 'Nhắn tin bạn bè'
    if (!uid) {
      const detail = await this.createZaloPolicyDetailFromCode(
        account,
        campaign,
        await this.supabase.getZaloErrorPolicyByCode('114'),
        'UID bạn bè Zalo không hợp lệ',
        actionCode,
        actionName,
        '114',
        { uid, inputData: options.inputData }
      )
      return { ok: false, detail }
    }

    const target = await this.resolveZaloFriendMessageTarget(
      account,
      this.normalizeZaloTargetFromInputData(uid, options.targetName, options.inputData)
    )
    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.upsertZaloResolvedProfileTarget(account, target, campaign.actionId)
    this.throwIfZaloRuntimeStopping(campaign.id)
    await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person')
    const attachments = (Array.isArray(options.attachments) ? options.attachments : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    const message = await this.buildZaloOutgoingMessage(
      account,
      campaign,
      options.message,
      options.inputData,
      target,
      metadata
    )

    try {
      const response = await this.dispatchZaloMessage(account.id, target.uid, false, message, attachments)
      this.throwIfZaloRuntimeStopping(campaign.id)
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          log: `Đã gửi tin nhắn đến ${this.getZaloTargetLabel(target)}`,
          data: { target, message, attachments, response }
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const errorData = { target, message, attachments, inputData: options.inputData }
      return {
        ok: false,
        zaloTarget: target,
        detail: err instanceof ZaloPartialSendError
          ? await this.createZaloPartialSendDetail(account, campaign, err, actionCode, actionName, errorData)
          : await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, errorData)
      }
    }
  }

  private async zaloSendGroupMessage(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloSendDirectMessageOptions,
    metadata?: BlockRuntimeMetadata
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const groupId = this.firstNonEmptyString(options.targetUid, options.inputData?.uid)
    const actionCode = 'zalo_message_group'
    const actionName = 'Nhắn tin group'
    if (!groupId) {
      const detail = await this.createZaloPolicyDetailFromCode(
        account,
        campaign,
        await this.supabase.getZaloErrorPolicyByCode('114'),
        'ID group Zalo không hợp lệ',
        actionCode,
        actionName,
        '114',
        { groupId, inputData: options.inputData }
      )
      return { ok: false, detail }
    }

    const target = this.normalizeZaloTargetFromInputData(groupId, options.targetName, options.inputData, { type: 'group' }, false)
    const attachments = (Array.isArray(options.attachments) ? options.attachments : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    const message = await this.buildZaloOutgoingMessage(
      account,
      campaign,
      options.message,
      options.inputData,
      target,
      metadata
    )

    try {
      const response = await this.dispatchZaloMessage(account.id, groupId, true, message, attachments)
      this.throwIfZaloRuntimeStopping(campaign.id)
      await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'group')
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          log: `Đã gửi tin nhắn vào group ${this.getZaloTargetLabel(target)}`,
          data: { target, groupId, message, attachments, response }
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const errorData = { target, groupId, message, attachments, inputData: options.inputData }
      return {
        ok: false,
        zaloTarget: target,
        detail: err instanceof ZaloPartialSendError
          ? await this.createZaloPartialSendDetail(account, campaign, err, actionCode, actionName, errorData)
          : await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, errorData)
      }
    }
  }

  private async zaloAddGroupMember(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloAddGroupMemberOptions
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const actionCode = ZALO_ADD_GROUP_MEMBER_ACTION_ID
    const actionName = 'Thêm thành viên vào group'
    const target = options.target ?? null
    if (!target?.uid) return { ok: true, skipped: true, zaloTarget: target }

    const groupId = this.firstNonEmptyString(
      options.targetGroupId,
      campaign.extraSettings?.zaloAddGroupMemberTargetGroupId
    ).replace(/^g/i, '')
    const groupName = this.firstNonEmptyString(
      options.targetGroupName,
      campaign.extraSettings?.zaloAddGroupMemberTargetGroupName,
      groupId
    )
    if (!groupId) {
      const detail = await this.createZaloPolicyDetailFromCode(
        account,
        campaign,
        await this.supabase.getZaloErrorPolicyByCode('114'),
        'Chưa chọn group Zalo cần thêm thành viên',
        actionCode,
        actionName,
        '114',
        { target, inputData: options.inputData }
      )
      detail.countsTowardLimit = false
      return { ok: false, zaloTarget: target, detail }
    }

    const useShareMethod = options.useShareMethod === true
    try {
      const result = await this.zaloRuntime.addMemberToGroup(account.id, {
        groupId,
        memberId: target.uid,
        useShareMethod
      })
      this.throwIfZaloRuntimeStopping(campaign.id)
      const targetLabel = this.getZaloTargetLabel(target)
      const groupLabel = this.firstNonEmptyString(result.groupName, groupName, result.groupId)
      const isAlreadyMember = result.outcome === 'already_member'
      const log = isAlreadyMember
        ? `${targetLabel} đã là thành viên của group ${groupLabel}`
        : result.mode === 'share_group_link'
        ? `Gửi lời mời thành công đến ${targetLabel} qua link group ${groupLabel}`
        : `${result.message} cho ${targetLabel} vào group ${groupLabel}`
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          status: isAlreadyMember ? 'đã là thành viên' : undefined,
          log,
          countsTowardLimit: isAlreadyMember ? false : true,
          data: {
            target,
            targetGroup: {
              id: result.groupId,
              name: groupLabel,
              type: result.groupType ?? null
            },
            mode: result.mode,
            outcome: result.outcome,
            useShareMethod,
            groupLink: result.groupLink,
            response: result.response as Record<string, unknown> | undefined
          }
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const detail = await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, {
        target,
        targetGroup: { id: groupId, name: groupName },
        useShareMethod,
        inputData: options.inputData
      })
      detail.countsTowardLimit = false
      return {
        ok: false,
        zaloTarget: target,
        detail
      }
    }
  }

  private async zaloJoinGroupLink(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloJoinGroupLinkOptions
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const actionCode = ZALO_JOIN_GROUP_LINK_ACTION_ID
    const actionName = 'Tham gia group'
    const link = this.firstNonEmptyString(options.targetLink, options.inputData?.uid)
    const normalizedLink = this.normalizeZaloGroupInviteLink(link)
    if (!normalizedLink) {
      const detail = await this.createZaloPolicyDetailFromCode(
        account,
        campaign,
        await this.supabase.getZaloErrorPolicyByCode('114'),
        'Link group Zalo không hợp lệ',
        actionCode,
        actionName,
        '114',
        { link, inputData: options.inputData }
      )
      return { ok: false, detail }
    }

    try {
      const result = await this.zaloRuntime.joinGroupByLink(account.id, normalizedLink)
      this.throwIfZaloRuntimeStopping(campaign.id)
      const isConfirmedJoined = result.outcome === 'joined' || result.outcome === 'already_joined'
      const isPendingApproval = result.outcome === 'pending_approval'
      if (!isConfirmedJoined && !isPendingApproval) {
        throw new Error(result.zaloMessage || 'Không xác định được kết quả tham gia group Zalo')
      }
      await this.upsertZaloJoinGroupLinkContact(account, result, isConfirmedJoined)

      const groupLabel = this.firstNonEmptyString(result.groupName, result.groupId, result.link)
      const target = this.normalizeZaloTargetFromInputData(
        this.firstNonEmptyString(result.groupId, result.link),
        groupLabel,
        {
          ...(options.inputData || {}),
          uid: this.firstNonEmptyString(result.groupId, options.inputData?.uid, result.link),
          name: groupLabel
        },
        {
          type: 'group',
          link: result.link,
          group: result.group,
          joinOutcome: result.outcome
        },
        false
      )
      const data = {
        target,
        link: result.link,
        groupId: result.groupId,
        groupName: groupLabel,
        group: result.group,
        response: result.response as Record<string, unknown> | undefined,
        zalo: {
          code: result.zaloCode,
          message: result.zaloMessage
        }
      }

      if (result.outcome === 'already_joined') {
        return {
          ok: true,
          zaloTarget: target,
          detail: this.createZaloSuccessDetail({
            actionCode,
            actionName,
            status: 'đã tham gia',
            log: `Tài khoản đã tham gia group ${groupLabel} từ trước`,
            countsTowardLimit: false,
            data
          })
        }
      }

      if (result.outcome === 'pending_approval') {
        return {
          ok: true,
          zaloTarget: target,
          detail: this.createZaloSuccessDetail({
            actionCode,
            actionName,
            log: `Đã gửi yêu cầu tham gia group ${groupLabel}, đang chờ duyệt`,
            countsTowardLimit: true,
            data
          })
        }
      }

      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          log: `Đã tham gia group ${groupLabel}`,
          countsTowardLimit: true,
          data
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      return {
        ok: false,
        detail: await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, { link: normalizedLink, inputData: options.inputData })
      }
    }
  }

  private async zaloSendPhoneFriendRequest(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloSendPhoneFriendRequestOptions
  ): Promise<ZaloActionHelperResult> {
    if (!options.enabled) return { ok: true, skipped: true, zaloTarget: options.target ?? null }
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const target = options.target
    if (!target?.uid) return { ok: true, skipped: true }
    const actionCode = 'zalo_add_friend'
    const actionName = 'Kết bạn'
    const businessNow = await this.getTemplateBusinessNow(options.message)
    const message = this.renderZaloTemplate(
      options.message,
      options.inputData,
      target,
      false,
      businessNow
    ).slice(0, 150)

    try {
      const response = await this.zaloRuntime.sendFriendRequestToUser(account.id, target.uid, message)
      this.throwIfZaloRuntimeStopping(campaign.id)
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          status: 'thành công',
          log: `Đã gửi lời mời kết bạn đến ${this.getZaloTargetLabel(target)}`,
          data: { target, message, response: response as Record<string, unknown> | undefined }
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const detail = await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, { target, message, inputData: options.inputData })
      const detailStatus = String(detail.status || '').toLocaleLowerCase('vi-VN')
      return {
        ok: Boolean(detail.status) && detailStatus !== 'thất bại' && detailStatus !== 'lỗi',
        zaloTarget: target,
        detail
      }
    }
  }

  private async zaloCancelSentFriendRequest(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloCancelSentFriendRequestOptions
  ): Promise<ZaloActionHelperResult> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const uid = this.firstNonEmptyString(options.targetUid, options.inputData?.uid)
    const actionCode = ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
    const actionName = 'Huỷ lời mời kết bạn'
    if (!uid) {
      const detail = await this.createZaloPolicyDetailFromCode(
        account,
        campaign,
        await this.supabase.getZaloErrorPolicyByCode('114'),
        'UID lời mời kết bạn Zalo không hợp lệ',
        actionCode,
        actionName,
        '114',
        { uid, inputData: options.inputData }
      )
      return { ok: false, detail }
    }

    const target = this.normalizeZaloTargetFromInputData(
      uid,
      options.targetName,
      options.inputData,
      {
        source: 'zalo_sent_friend_requests',
        sentAt: options.sentAt ?? options.inputData?.info1 ?? null,
        requestMessage: options.requestMessage || this.firstNonEmptyString(options.inputData?.info2)
      },
      false
    )
    const sentAt = options.sentAt ?? options.inputData?.info1 ?? null
    const requestMessage = options.requestMessage || this.firstNonEmptyString(options.inputData?.info2)

    try {
      const response = await this.zaloRuntime.undoFriendRequest(account.id, target.uid)
      this.throwIfZaloRuntimeStopping(campaign.id)
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          status: 'thành công',
          log: `Đã huỷ lời mời kết bạn đã gửi đến ${this.getZaloTargetLabel(target)}`,
          data: {
            target,
            sentAt,
            requestMessage,
            response: response as Record<string, unknown> | undefined
          }
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      return {
        ok: false,
        zaloTarget: target,
        detail: await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, {
          target,
          sentAt,
          requestMessage,
          inputData: options.inputData
        })
      }
    }
  }

  private async zaloApplyContactTag(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloApplyContactTagOptions
  ): Promise<ZaloActionHelperResult> {
    if (!options.enabled) return { ok: true, skipped: true, zaloTarget: options.target ?? null }
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const target = options.target
    if (!target?.uid) return { ok: true, skipped: true }
    const labelId = options.labelId
    if (!labelId) {
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode: 'zalo_tag_contact',
          actionName: 'Gắn tag Zalo',
          status: 'tag không tồn tại',
          log: 'Tag Zalo không tồn tại',
          countsTowardLimit: false,
          data: { target, labelId }
        })
      }
    }

    try {
      const label = await this.zaloRuntime.applyLabelToUser(account.id, target.uid, labelId)
      this.throwIfZaloRuntimeStopping(campaign.id)
      const labelName = label.text || options.labelName || ''
      await this.supabase.appendZaloTagsToExistingContacts(
        account.id,
        'person',
        [target.uid],
        [{ id: labelId, name: labelName }]
      ).catch(err => {
        console.warn('[CampaignScheduler] Failed to mirror Zalo tag to contact:', {
          accountId: account.id,
          uid: target.uid,
          labelId,
          err
        })
      })
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode: 'zalo_tag_contact',
          actionName: 'Gắn tag Zalo',
          log: `Đã gắn tag "${labelName || labelId}" cho ${this.getZaloTargetLabel(target)}`,
          countsTowardLimit: false,
          data: { target, labelId, labelName }
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const message = this.getZaloErrorMessage(err)
      if (message.includes('Tag Zalo không tồn tại')) {
        await this.logCaughtZaloApiError({
          account,
          campaign,
          err,
          actionCode: 'zalo_tag_contact',
          actionName: 'Gắn tag Zalo',
          apiName: 'updateLabels',
          data: { target, labelId },
          detailStatus: 'tag không tồn tại'
        })
        return {
          ok: true,
          zaloTarget: target,
          detail: this.createZaloSuccessDetail({
            actionCode: 'zalo_tag_contact',
            actionName: 'Gắn tag Zalo',
            status: 'tag không tồn tại',
            log: 'Tag Zalo không tồn tại',
            countsTowardLimit: false,
            data: { target, labelId, error: message }
          })
        }
      }
      const detail = await this.createZaloErrorDetail(account, campaign, err, 'zalo_tag_contact', 'Gắn tag Zalo', { target, labelId })
      detail.countsTowardLimit = false
      return {
        ok: false,
        zaloTarget: target,
        detail
      }
    }
  }

  private async zaloChangeContactAlias(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloChangeContactAliasOptions
  ): Promise<ZaloActionHelperResult> {
    if (!options.enabled) return { ok: true, skipped: true, zaloTarget: options.target ?? null }
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const target = options.target
    if (!target?.uid) return { ok: true, skipped: true }
    const businessNow = await this.getTemplateBusinessNow(options.alias)
    const alias = this.renderZaloTemplate(
      options.alias,
      options.inputData,
      target,
      false,
      businessNow
    ).trim()
    if (!alias) {
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode: 'zalo_change_alias',
          actionName: 'Đổi tên Zalo',
          status: 'tham số không hợp lệ',
          log: 'Tên Zalo mới không hợp lệ',
          countsTowardLimit: false,
          data: { target, alias }
        })
      }
    }

    try {
      const response = await this.zaloRuntime.changeUserAlias(account.id, target.uid, alias)
      this.throwIfZaloRuntimeStopping(campaign.id)
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode: 'zalo_change_alias',
          actionName: 'Đổi tên Zalo',
          log: `Đã đổi tên ${this.getZaloTargetLabel(target)} thành "${alias}"`,
          countsTowardLimit: false,
          data: { target, alias, response: response as Record<string, unknown> | undefined }
        })
      }
    } catch (err) {
      this.throwIfZaloRuntimeStopping(campaign.id)
      const detail = await this.createZaloErrorDetail(account, campaign, err, 'zalo_change_alias', 'Đổi tên Zalo', { target, alias, inputData: options.inputData })
      detail.countsTowardLimit = false
      return {
        ok: false,
        zaloTarget: target,
        detail
      }
    }
  }

  private createBlockRuntimeHelpers(
    account: AutoAccount,
    campaign: Campaign,
    detail: CampaignInputData | null,
    mainPage: PageController | null
  ): BlockRuntimeHelpers {
    let sequenceNo = 0
    const normalizeEvent = (
      rawEvent: CampaignRunEventInput,
      metadata: BlockRuntimeMetadata
    ): CampaignRunEventInput => {
      const payload = (rawEvent && typeof rawEvent === 'object' ? rawEvent : {}) as RawRunEventPayload
      sequenceNo += 1
      return {
        campaignId: metadata.campaignId ?? campaign.id,
        campaignActionId: campaign.actionId,
        campaignInputId: metadata.campaignInputId ?? detail?.inputId ?? null,
        campaignInputDataId: metadata.campaignInputDataId ?? detail?.id ?? null,
        accountId: metadata.accountId ?? account.id,
        runId: metadata.runId ?? null,
        runStepId: metadata.runStepId ?? null,
        nodeId: metadata.nodeId ?? null,
        blockId: metadata.blockId ?? null,
        blockName: metadata.blockName ?? null,
        sequenceNo,
        eventType: eventString(payload, 'eventType', 'event_type') || 'info',
        eventName: eventString(payload, 'eventName', 'event_name'),
        targetType: eventString(payload, 'targetType', 'target_type'),
        status: eventString(payload, 'status') || 'success',
        isUserVisible: eventBoolean(payload, 'isUserVisible', 'is_user_visible') ?? false,
        xpath: eventString(payload, 'xpath'),
        cssSelector: eventString(payload, 'cssSelector', 'css_selector'),
        elementCount: eventNumber(payload, 'elementCount', 'element_count'),
        itemIndex: eventNumber(payload, 'itemIndex', 'item_index'),
        targetUrl: eventString(payload, 'targetUrl', 'target_url'),
        message: eventString(payload, 'message'),
        extractedData: eventJsonObject(payload, 'extractedData', 'extracted_data'),
        debugData: eventJsonObject(payload, 'debugData', 'debug_data')
      }
    }
    const logRunEvents = async (
      events: CampaignRunEventInput[],
      metadata: BlockRuntimeMetadata
    ): Promise<{ ok: boolean; insertedCount?: number; error?: string }> => {
      const rows = (Array.isArray(events) ? events : [])
        .map(event => normalizeEvent(event, metadata))
        .filter(event => String(event.eventType || '').trim().length > 0)
      if (rows.length === 0) return { ok: true, insertedCount: 0 }

      try {
        await campaignRunEventRepo.createCampaignRunEvents(rows)
        return { ok: true, insertedCount: rows.length }
      } catch (err: any) {
        const message = err?.message ? String(err.message) : String(err)
        try {
          console.warn('[campaignRunEvent] failed to insert run events:', message)
        } catch {}
        return { ok: false, error: message }
      }
    }

    return {
      checkGroupPendingContent: (options) => {
        if (!mainPage) {
          return Promise.resolve({
            ok: false,
            conclusive: false,
            url: String(options?.url || ''),
            links: [],
            error: 'Workflow này không dùng trình duyệt'
          })
        }
        return this.checkGroupPendingContent(account, campaign, mainPage, options)
      },
      logRunEvent: (event, metadata) => logRunEvents([event], metadata),
      logRunEvents,
      callAIUsing: (code, payload, metadata) => callAiUsing(code, payload, {
        organizationId: campaign.organizationId ?? account.organizationId ?? metadata.organizationId ?? null,
        accountId: metadata.accountId,
        campaignId: metadata.campaignId,
        campaignInputId: metadata.campaignInputId,
        campaignInputDataId: metadata.campaignInputDataId,
        workflowId: metadata.workflowId,
        runId: metadata.runId,
        runStepId: metadata.runStepId,
        nodeId: metadata.nodeId,
        blockId: metadata.blockId,
        blockName: metadata.blockName
      }),
      zaloFindPhoneUser: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloFindPhoneUser(account, campaign, options)),
      zaloResolveGroupMemberTarget: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloResolveGroupMemberTarget(account, campaign, options)),
      zaloResolveAddGroupMemberTarget: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloResolveAddGroupMemberTarget(account, campaign, options)),
      zaloResolveRemarketingCustomerTarget: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloResolveRemarketingCustomerTarget(account, campaign, options)),
      zaloResolveFriendRecommendationTarget: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloResolveFriendRecommendationTarget(account, campaign, options)),
      zaloSendPhoneMessage: (options, metadata) => this.runZaloCampaignHelper(campaign.id, () => this.zaloSendPhoneMessage(account, campaign, options, metadata)),
      zaloSendFriendMessage: (options, metadata) => this.runZaloCampaignHelper(campaign.id, () => this.zaloSendFriendMessage(account, campaign, options, metadata)),
      zaloSendGroupMessage: (options, metadata) => this.runZaloCampaignHelper(campaign.id, () => this.zaloSendGroupMessage(account, campaign, options, metadata)),
      zaloAddGroupMember: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloAddGroupMember(account, campaign, options)),
      zaloJoinGroupLink: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloJoinGroupLink(account, campaign, options)),
      zaloSendPhoneFriendRequest: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloSendPhoneFriendRequest(account, campaign, options)),
      zaloCancelSentFriendRequest: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloCancelSentFriendRequest(account, campaign, options)),
      zaloApplyContactTag: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloApplyContactTag(account, campaign, options)),
      zaloChangeContactAlias: (options) => this.runZaloCampaignHelper(campaign.id, () => this.zaloChangeContactAlias(account, campaign, options)),
      emailSendMessage: (options) => this.emailSendMessage(account, campaign, options)
    }
  }

  private async emailSendMessage(
    account: AutoAccount,
    campaign: Campaign,
    options: EmailSendMessageOptions
  ): Promise<EmailActionHelperResult> {
    if (!this.emailRuntime) throw new Error('Email runtime chưa sẵn sàng')
    const actionCode = 'email_send'
    const actionName = 'Gửi email'
    const to = String(options.to || '').trim()
    if (!to) {
      return {
        ok: false,
        detail: {
          createDetail: true,
          actionCode,
          actionName,
          status: 'thất bại',
          log: 'Thiếu email người nhận',
          countsTowardLimit: false,
          countsTowardBadTarget: true
        }
      }
    }

    const businessNow = await this.getTemplateBusinessNow(options.subject, options.body)
    const subject = this.renderZaloTemplate(
      options.subject,
      options.inputData,
      undefined,
      false,
      businessNow
    ).trim()
    const renderedBody = this.renderZaloTemplate(
      options.body,
      options.inputData,
      undefined,
      false,
      businessNow
    )
    const attachments = (Array.isArray(options.attachments) ? options.attachments : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)

    const recipientCheck: EmailRecipientCheckResult = await this.emailRuntime
      .checkRecipientExists(account.id, to)
      .catch(err => ({
        status: 'unknown' as const,
        reason: err instanceof Error ? err.message : String(err)
      }))
    if (recipientCheck.status === 'not_found') {
      return {
        ok: false,
        skipped: true,
        detail: {
          createDetail: true,
          actionCode,
          actionName,
          status: 'không tồn tại',
          errorCode: EMAIL_RECIPIENT_NOT_FOUND_ERROR_CODE,
          log: `Email không tồn tại ${to}`,
          data: {
            to,
            subject,
            recipientCheck: {
              status: recipientCheck.status,
              reason: recipientCheck.reason || null,
              ...(recipientCheck.data || {})
            }
          },
          countsTowardLimit: false,
          countsTowardBadTarget: false
        }
      }
    }

    try {
      const body = await this.rewriteEmailPlainTextBodyForRun(account, campaign, options, renderedBody)
      const result = await this.emailRuntime.sendEmail(account.id, {
        to,
        subject,
        body,
        isHtml: options.isHtml === true,
        attachments,
        tracking: {
          campaignId: campaign.id,
          inputDataId: Number(options.inputData?.id) || null,
          recipientName: options.targetName || null,
          enableClickTracking: options.enableClickTracking === true
        }
      })
      return {
        ok: true,
        emailTrackingMessageId: result.trackingMessageId,
        detail: {
          createDetail: true,
          actionCode,
          actionName,
          status: 'thành công',
          log: `Đã gửi email đến ${to}`,
          data: {
            to,
            subject,
            messageId: result.messageId
          },
          countsTowardLimit: true,
          countsTowardBadTarget: false
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        detail: {
          createDetail: true,
          actionCode,
          actionName,
          status: 'thất bại',
          log: `Gửi email thất bại đến ${to}: ${message}`,
          data: { to, error: message },
          countsTowardLimit: true,
          countsTowardBadTarget: true
        }
      }
    }
  }

  private createScreenshotRunStep(request: BlockScreenshotCaptureRequest): RunStepV2 {
    return {
      id: request.runStepId ?? undefined,
      runId: request.runId ?? undefined,
      nodeId: request.nodeId,
      blockId: request.blockId,
      blockName: request.blockName,
      status: request.stepStatus,
      input: {},
      output: request.output || {},
      error: request.error,
      startedAt: request.startedAt,
      completedAt: request.completedAt
    }
  }

  private getScreenshotOutputMessage(
    request: BlockScreenshotCaptureRequest,
    fallback: string
  ): string {
    const output = request.output || {}
    const raw = [
      request.error,
      output.error,
      output.message,
      output.reason,
      output.failureReason,
      output.failure_message
    ].find(value => typeof value === 'string' && value.trim().length > 0)
    return String(raw || fallback).trim() || fallback
  }

  private async getScreenshotPolicyMessage(errorCode: string | undefined, fallback: string): Promise<string> {
    const normalizedFallback = String(fallback || '').trim() || 'Lỗi không xác định'
    if (!errorCode || errorCode === 'err_undefined') return normalizedFallback

    try {
      const policy = await this.supabase.getErrorPolicy(errorCode)
      const policyMessage = String(
        policy?.notiRunningProcess ||
        policy?.errorName ||
        policy?.errorDesc ||
        ''
      ).trim()
      return policyMessage || normalizedFallback
    } catch (err) {
      console.warn('[campaignScheduler] failed to resolve screenshot error policy:', err)
      return normalizedFallback
    }
  }

  private getScreenshotActionName(campaign: Campaign, request: BlockScreenshotCaptureRequest): string {
    const blockName = String(request.blockName || '')
    if (blockName === 'fb_verify_group_post_form_closed' || blockName === 'fb_click_post_button') return 'Đăng bài'
    if (blockName === 'fb_join_group') return 'Tham gia group'
    if (blockName === 'fb_group_invite') return 'Mời vào group'
    if (
      blockName === 'fb_page_post_api' ||
      blockName === 'fb_post_current_identity_ui' ||
      blockName === 'fb_switch_identity_by_name' ||
      blockName === 'fb_get_current_identity_name'
    ) return 'Đăng bài fanpage'
    if (blockName === 'fb_comment_at_position' || blockName === 'fb_comment_current_post' || blockName.startsWith('fb_newsfeed_comment')) return 'Comment'
    if (blockName === 'fb_send_message' || blockName === 'fb_send_page_inbox_message') return 'Nhắn tin'
    if (blockName === 'fb_add_friend') return 'Kết bạn'
    if (blockName === 'fb_click_like_current_post' || blockName === 'fb_newsfeed_like_post') return 'Like bài viết'
    return this.getCampaignExecutableActionDescriptors(campaign)[0]?.name || 'Hành động'
  }

  private getScreenshotTargetSuffix(actionName: string, targetName: string): string {
    const target = String(targetName || '').trim()
    if (!target) return ''
    if (actionName === 'Nhắn tin') return ` đến "${target}"`
    if (actionName === 'Kết bạn') return ` với "${target}"`
    if (actionName === 'Like bài viết') return ` của "${target}"`
    return ` vào "${target}"`
  }

  private formatScreenshotDisplayMessage(result: Omit<BlockScreenshotRunResult, 'displayMessage'>): string {
    const actionText = String(result.actionName || 'Hành động').trim() || 'Hành động'
    const targetSuffix = this.getScreenshotTargetSuffix(actionText, result.targetName)
    if (result.status === 'success') return `${actionText} thành công${targetSuffix}`
    if (result.status === 'error') return `Lỗi ${actionText.toLowerCase()}${targetSuffix}: ${result.message}`
    return `${actionText} thất bại${targetSuffix}: ${result.message}`
  }

  private async resolveBlockScreenshotRunResult(
    campaign: Campaign,
    detail: CampaignInputData | null,
    request: BlockScreenshotCaptureRequest
  ): Promise<BlockScreenshotRunResult> {
    const actionName = this.getScreenshotActionName(campaign, request)
    const targetName = String(detail?.name || detail?.uid || '').trim()
    const output = request.output || {}
    const isPosted = request.stepStatus === 'success' && (output.posted === true || output.ok === true)

    if (request.captureReason === 'success' || isPosted) {
      const base = {
        status: 'success' as const,
        statusLabel: 'Thành công',
        actionName,
        targetName,
        message: 'Thành công'
      }
      return { ...base, displayMessage: this.formatScreenshotDisplayMessage(base) }
    }

    const status: BlockScreenshotRunResult['status'] = request.stepStatus === 'error' ? 'error' : 'failure'
    const fallbackMessage = request.blockName === 'fb_verify_group_post_form_closed'
      ? 'Form đăng bài chưa đóng sau 60 giây'
      : (status === 'error' ? 'Lỗi không xác định' : 'Thao tác thất bại')
    const rawMessage = this.getScreenshotOutputMessage(request, fallbackMessage)
    let errorCode: string | undefined
    let message = rawMessage

    if (status === 'error') {
      const runtimeError = this.normalizeRuntimeError(campaign, [this.createScreenshotRunStep(request)], rawMessage)
      errorCode = runtimeError.errorCode
      message = await this.getScreenshotPolicyMessage(runtimeError.errorCode, runtimeError.message)
    }

    const base = {
      status,
      statusLabel: status === 'error' ? 'Lỗi' : 'Thất bại',
      actionName,
      targetName,
      message,
      errorCode
    }
    return { ...base, displayMessage: this.formatScreenshotDisplayMessage(base) }
  }

  private async recordBlockScreenshotEvent(
    account: AutoAccount,
    campaign: Campaign,
    detail: CampaignInputData | null,
    request: BlockScreenshotCaptureRequest,
    page: PageController
  ): Promise<BlockScreenshotProgressLog | null> {
    try {
      const runResult = await this.resolveBlockScreenshotRunResult(campaign, detail, request)
      const screenshot = await captureBlockScreenshot({
        page,
        accountId: request.accountId ?? account.id,
        campaignId: request.campaignId ?? campaign.id,
        runId: request.runId ?? null,
        runStepId: request.runStepId ?? null,
        nodeId: request.nodeId,
        blockName: request.blockName,
        captureReason: request.captureReason
      })
      const eventStatus = runResult.status === 'success'
        ? 'success'
        : runResult.status === 'error'
          ? 'error'
          : 'failed'
      const createdEvents = await campaignRunEventRepo.createCampaignRunEvents([{
        campaignId: request.campaignId ?? campaign.id,
        campaignActionId: campaign.actionId,
        campaignInputId: request.campaignInputId ?? detail?.inputId ?? null,
        campaignInputDataId: request.campaignInputDataId ?? detail?.id ?? null,
        accountId: request.accountId ?? account.id,
        runId: request.runId ?? null,
        runStepId: request.runStepId ?? null,
        nodeId: request.nodeId,
        blockId: request.blockId ?? null,
        blockName: request.blockName ?? null,
        eventType: 'browser_screenshot',
        eventName: 'block_screenshot',
        targetType: 'browser',
        status: eventStatus,
        isUserVisible: true,
        targetUrl: screenshot.browserUrl,
        message: runResult.displayMessage,
        debugData: {
          screenshotPath: screenshot.filePath,
          screenshotFileName: screenshot.fileName,
          screenshotSizeBytes: screenshot.sizeBytes,
          browserUrl: screenshot.browserUrl,
          runResultStatus: runResult.status,
          runResultStatusLabel: runResult.statusLabel,
          runResultMessage: runResult.message,
          runResultDisplay: runResult.displayMessage,
          actionName: runResult.actionName,
          targetName: runResult.targetName,
          errorCode: runResult.errorCode ?? null,
          captureTiming: request.captureTiming,
          captureOn: request.captureOn,
          captureReason: request.captureReason,
          stepStatus: request.stepStatus,
          error: request.error ?? null,
          capturedAt: screenshot.capturedAt,
          blockStartedAt: request.startedAt ?? null,
          blockCompletedAt: request.completedAt ?? null
        }
      }])
      const createdEventId = createdEvents[0]?.id
      const cleanLogMessage = '📸 Ảnh chụp màn hình trạng thái trình duyệt'
      const storedLogMessage = createdEventId
        ? `${cleanLogMessage} <!-- screenshotEventId:${createdEventId} -->`
        : cleanLogMessage
      return {
        runStepId: request.runStepId ?? null,
        nodeId: request.nodeId ?? null,
        blockId: request.blockId ?? null,
        blockName: request.blockName ?? null,
        storedMessage: storedLogMessage,
        realtimeMessage: cleanLogMessage,
        action: {
          type: 'block_screenshot_preview',
          filePath: screenshot.filePath,
          title: runResult.displayMessage
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[campaignScheduler] block screenshot capture failed:', message)
      return null
    }
  }

  private async checkGroupPendingContent(
    account: AutoAccount,
    campaign: Campaign,
    mainPage: PageController,
    options: GroupPendingContentCheckOptions
  ): Promise<GroupPendingContentCheckResult> {
    const url = String(options?.url || '').trim()
    const rawSelector = String(options?.rawSelector || '').trim()
    const linkSelector = String(options?.linkSelector || '').trim()
    const timeoutMs = Math.min(30000, Math.max(5000, Number(options?.timeoutMs || 15000)))

    if (!url) {
      return { ok: false, conclusive: false, url, links: [], error: 'Thiếu URL my_pending_content' }
    }
    if (!rawSelector && !linkSelector) {
      return { ok: false, conclusive: false, url, links: [], error: 'Thiếu selector kiểm tra pending content' }
    }

    const temp = this.backgroundPages.createTemporary(account.id, account.flatformType)
    const title = 'Đang kiểm tra bài chờ duyệt'
    this.setBackgroundPreviewOverride(account.id, campaign.id, temp.page, title)

    try {
      await this.withTimeout(temp.page.navigate(url), timeoutMs, `Timeout mở trang pending content: ${url}`)
      try {
        await this.withTimeout(
          temp.page.waitForSelector("//*[@role='main']", { timeout: Math.min(timeoutMs, 10000), state: 'attached' }),
          Math.min(timeoutMs, 12000),
          'Timeout chờ trang pending content render'
        )
      } catch {
        // Facebook sometimes renders usable links before role=main is visible.
      }
      await new Promise(resolve => setTimeout(resolve, 1200))
      await this.sendBackgroundPreviewSnapshot(account.id, campaign.id, temp.page, title)

      const links = await this.withTimeout(
        temp.page.evaluate<string[]>(`
          const rawSelector = String(__args[0] || '');
          const linkSelector = String(__args[1] || '');

          function xpathAll(xpath) {
            const out = [];
            if (!xpath) return out;
            try {
              const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              for (let i = 0; i < result.snapshotLength; i++) {
                const item = result.snapshotItem(i);
                if (item) out.push(item);
              }
            } catch {}
            return out;
          }

          function hrefOf(el) {
            return el ? (el.href || el.getAttribute('href') || '') : '';
          }

          function cleanHref(href) {
            if (!href) return '';
            try {
              const url = new URL(href, location.href);
              if (/^(m|mbasic|mobile)\\.facebook\\.com$/i.test(url.hostname)) {
                url.hostname = 'www.facebook.com';
              }
              url.hash = '';
              Array.from(url.searchParams.keys()).forEach(key => {
                if (key.startsWith('__') || key === 'mibextid' || key === 'ref' || key === 'locale') {
                  url.searchParams.delete(key);
                }
              });
              return url.href;
            } catch {
              return String(href || '').trim();
            }
          }

          const links = []
            .concat(xpathAll(rawSelector), xpathAll(linkSelector))
            .map(el => cleanHref(hrefOf(el)))
            .filter(Boolean);

          return Array.from(new Set(links));
        `, rawSelector, linkSelector),
        Math.min(timeoutMs, 10000),
        'Timeout đọc link pending content'
      )

      return {
        ok: true,
        conclusive: true,
        url,
        links: Array.isArray(links) ? links.map(link => String(link || '').trim()).filter(Boolean) : []
      }
    } catch (err) {
      return {
        ok: false,
        conclusive: false,
        url,
        links: [],
        error: err instanceof Error ? err.message : String(err)
      }
    } finally {
      this.clearBackgroundPreviewOverride(account.id, campaign.id)
      temp.destroy()
      await this.sendBackgroundPreviewSnapshot(account.id, campaign.id, mainPage, undefined, 'campaign')
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private selectAutomationBrowser(accountId: number, campaignId?: number): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_BROWSER_SELECT, { accountId, campaignId })
    } catch {}
  }

  private setBackgroundPreviewOverride(
    accountId: number,
    campaignId: number,
    page: PageController,
    title?: string
  ): void {
    const key = this.backgroundPreviewKey(accountId, campaignId)
    this.backgroundPreviewOverrides.set(key, { page, title, context: 'campaign' })
  }

  private clearBackgroundPreviewOverride(accountId: number, campaignId: number): void {
    this.backgroundPreviewOverrides.delete(this.backgroundPreviewKey(accountId, campaignId))
  }

  private startBackgroundPreview(accountId: number, campaignId: number, page: PageController): void {
    const key = this.backgroundPreviewKey(accountId, campaignId)
    if (this.backgroundPreviewTimers.has(key)) return

    const capture = async (): Promise<void> => {
      if (this.backgroundPreviewCapturing.has(key)) return
      this.backgroundPreviewCapturing.add(key)
      try {
        const override = this.backgroundPreviewOverrides.get(key)
        await this.sendBackgroundPreviewSnapshot(
          accountId,
          campaignId,
          override?.page || page,
          override?.title,
          override?.context
        )
      } catch {
        // Preview is best-effort; workflow steps remain the source of truth.
      } finally {
        this.backgroundPreviewCapturing.delete(key)
      }
    }

    void capture()
    this.backgroundPreviewTimers.set(key, setInterval(() => void capture(), 2000))
  }

  private stopBackgroundPreview(accountId: number, campaignId: number): void {
    const key = this.backgroundPreviewKey(accountId, campaignId)
    const timer = this.backgroundPreviewTimers.get(key)
    if (timer) clearInterval(timer)
    this.backgroundPreviewTimers.delete(key)
    this.backgroundPreviewCapturing.delete(key)
    this.backgroundPreviewOverrides.delete(key)
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_BROWSER_PREVIEW, {
        accountId,
        campaignId,
        active: false,
        timestamp: new Date().toISOString()
      })
    } catch {}
  }

  private stopAllBackgroundPreviews(): void {
    for (const timer of this.backgroundPreviewTimers.values()) {
      clearInterval(timer)
    }
    this.backgroundPreviewTimers.clear()
    this.backgroundPreviewCapturing.clear()
    this.backgroundPreviewOverrides.clear()
  }

  private async sendBackgroundPreviewSnapshot(
    accountId: number,
    campaignId: number,
    page: PageController,
    title?: string,
    context?: string
  ): Promise<void> {
    try {
      if (!page.isConnected()) return
      const image = await page.screenshot()
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_BROWSER_PREVIEW, {
        accountId,
        campaignId,
        active: true,
        image: `data:image/png;base64,${image}`,
        title,
        context,
        timestamp: new Date().toISOString()
      })
    } catch {
      // Preview is best-effort; workflow steps remain the source of truth.
    }
  }

  private backgroundPreviewKey(accountId: number, campaignId: number): string {
    return `${accountId}:${campaignId}`
  }

  private isAdvancedContentEnabled(campaign: Campaign): boolean {
    return campaign.extraSettings?.advancedContentEnabled === true
  }

  private shouldUseAdvancedContent(campaign: Campaign): boolean {
    return this.isAdvancedContentEnabled(campaign) && this.campaignUsesMainContent(campaign)
  }

  private shouldUseAdvancedCommentContent(campaign: Campaign): boolean {
    return this.isAdvancedContentEnabled(campaign) && (
      campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID ||
      campaign.actionId === COMMENT_SEEDING_POST_ACTION_ID
    )
  }

  private campaignUsesCommentIterations(campaign: Campaign): boolean {
    return campaign.actionId === GROUP_POST_ACTION_ID ||
      campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID ||
      campaign.actionId === COMMENT_SEEDING_POST_ACTION_ID
  }

  private campaignUsesMainMedia(campaign: Campaign): boolean {
    // SMS uses main text content but never media. All other exclusions and
    // message toggles are shared with the main-content contract below.
    return campaign.actionId !== SMS_SEND_ACTION_ID && this.campaignUsesMainContent(campaign)
  }

  private campaignUsesMessageMedia(campaign: Campaign): boolean {
    return campaign.actionId === MESSAGE_FRIEND_ACTION_ID ||
      campaign.actionId === MESSAGE_UID_ACTION_ID ||
      campaign.actionId === PAGE_INBOX_MESSAGE_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID ||
      campaign.actionId === EMAIL_SEND_ACTION_ID
  }

  private campaignUsesMainContent(campaign: Campaign): boolean {
    const extra = campaign.extraSettings || {}
    if (
      campaign.actionId === FIND_DATA_GROUP_ACTION_ID ||
      campaign.actionId === FIND_DATA_SEARCH_ACTION_ID ||
      campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID ||
      campaign.actionId === COMMENT_SEEDING_POST_ACTION_ID ||
      campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID ||
      campaign.actionId === FACEBOOK_JOIN_GROUP_ACTION_ID ||
      campaign.actionId === FACEBOOK_GROUP_INVITE_ACTION_ID ||
      campaign.actionId === ZALO_ADD_GROUP_MEMBER_ACTION_ID ||
      campaign.actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID ||
      campaign.actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID ||
      campaign.actionId === VOICE_CALL_ACTION_ID
    ) {
      return false
    }
    if (
      campaign.actionId === MESSAGE_UID_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
      campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
    ) {
      return extra.enableMessage === true
    }
    return true
  }

  private getAdvancedContentConfigError(campaign: Campaign, allowMediaOnly: boolean): string | null {
    const usesMainContent = this.shouldUseAdvancedContent(campaign)
    const usesStandaloneCommentContent = this.shouldUseAdvancedCommentContent(campaign)
    if (!usesMainContent && !usesStandaloneCommentContent) return null
    const items = getAdvancedContentItems(campaign.extraSettings)
    if (items.length === 0) {
      return 'Vui lòng thêm ít nhất 1 nội dung nâng cao hoặc chuyển về chế độ Cơ bản.'
    }
    if (campaign.actionId === SMS_SEND_ACTION_ID && items.length > MAX_SMS_ADVANCED_CONTENT_ITEMS) {
      return `Nội dung nâng cao SMS chỉ được tối đa ${MAX_SMS_ADVANCED_CONTENT_ITEMS} mục.`
    }
    if (campaign.actionId === EMAIL_SEND_ACTION_ID) {
      const missingSubjectIndex = items.findIndex(item => {
        const legacySubject = campaign.extraSettings?.advancedContentSource === 'group_snapshot'
          ? ''
          : campaign.extraSettings?.emailSubject ?? ''
        const subject = item.emailSubject ?? legacySubject
        return !String(subject).trim()
      })
      if (missingSubjectIndex >= 0) {
        return `Nội dung nâng cao Email số ${missingSubjectIndex + 1} chưa có tiêu đề.`
      }
    }
    const invalidIndex = usesMainContent && this.isFormattedContentCampaign(campaign)
      ? items.findIndex(item => {
          const hasContent = !isFormattedContentEmpty(item.content)
          const hasMedia = item.mediaOption !== 'none' && Array.isArray(item.mediaItems) && item.mediaItems.length > 0
          return !hasContent && !(allowMediaOnly && hasMedia)
        })
      : findInvalidAdvancedContentItemIndex(items, { allowMediaOnly })
    if (invalidIndex < 0) return null
    return allowMediaOnly
      ? `Nội dung nâng cao số ${invalidIndex + 1} đang rỗng. Vui lòng nhập nội dung hoặc chọn media.`
      : `Nội dung nâng cao số ${invalidIndex + 1} chưa có nội dung.`
  }

  private getRawCampaignContentForIndex(campaign: Campaign, index: number): string {
    if (this.shouldUseAdvancedContent(campaign)) {
      const selected = selectAdvancedContentItem(campaign.extraSettings, index)?.content || ''
      return this.isFormattedContentCampaign(campaign)
        ? sanitizeFormattedContent(selected)
        : selected
    }

    if (this.isFormattedContentCampaign(campaign)) {
      return this.cycleVariant(splitFormattedContentVariants(campaign.content), index)
    }

    const variants = this.splitContentVariants(campaign.content)
    return this.cycleVariant(variants, index)
  }

  private async resolveCampaignMediaForIndex(
    campaign: Campaign,
    index: number,
    postWithBackground: boolean,
    mediaTempPaths: string[] = [],
    randomMediaCountOverride?: number
  ): Promise<string[]> {
    if (postWithBackground) return []

    if (this.shouldUseAdvancedContent(campaign)) {
      const advancedItem = selectAdvancedContentItem(campaign.extraSettings, index)
      if (!advancedItem) return []
      return this.resolveMediaSelection(
        advancedItem.mediaItems || [],
        advancedItem.mediaOption || 'none',
        randomMediaCountOverride ?? (advancedItem.randomMediaCount || 3),
        mediaTempPaths
      )
    }

    const extra = campaign.extraSettings || {}
    return this.resolveMediaSelection(
      campaign.images || [],
      extra.imageOption || 'all',
      randomMediaCountOverride ?? (extra.randomImageCount || 3),
      mediaTempPaths
    )
  }

  private async resolveAdvancedCommentMedia(
    item: CampaignAdvancedContentItem | null,
    mediaTempPaths: string[] = []
  ): Promise<string[]> {
    if (!item || item.mediaOption === 'none') return []
    const mediaItems = Array.isArray(item.mediaItems) ? item.mediaItems : []
    if (mediaItems.length === 0) return []
    if (mediaItems.some(media => this.hasDeclaredMediaSource(media) && !this.isCampaignMediaImageOrVideo(media))) {
      throw new Error('Media comment Facebook chỉ hỗ trợ ảnh hoặc video')
    }

    // Facebook comment supports one image or video. `random` chooses one from
    // item's snapshot; `all` deterministically uses its first snapshot media.
    return item.mediaOption === 'random'
      ? this.resolveMediaSelection(mediaItems, 'random', 1, mediaTempPaths)
      : this.resolveMediaSelection(
          mediaItems.filter(media => this.hasDeclaredMediaSource(media)).slice(0, 1),
          'all',
          1,
          mediaTempPaths
        )
  }

  /**
   * Cập nhật campaign xong push luôn ra renderer để UI hiện status realtime.
   */
  private async finalizeClaimedServerZaloCampaign(
    id: number,
    note?: string | null
  ): Promise<{ finalized: ZaloServerCampaignFinalization; campaign: Campaign }> {
    const finalized = await this.supabase.finalizeZaloServerCampaign(id, note)
    if (!finalized.ok) {
      throw new Error(`Không thể hoàn tất chiến dịch Zalo Server (${finalized.reason}).`)
    }
    const current = await this.supabase.getCampaign(id)
    if (!current) {
      throw new Error('Không tìm thấy chiến dịch Zalo Server sau khi hoàn tất atomic.')
    }
    return { finalized, campaign: current }
  }

  private async finishServerZaloFinalizationBoundary(
    campaign: Campaign,
    finalized: ZaloServerCampaignFinalization
  ): Promise<void> {
    if (
      finalized.reason !== 'account_control_won' &&
      finalized.reason !== 'campaign_control_won' &&
      finalized.reason !== 'pending_input_remaining'
    ) {
      return
    }

    this.serverZaloPauseBoundaries.delete(campaign.id)
    await this.releaseRunningAccount(finalized.accountId || campaign.accountId)
    try { this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch {}

    if (finalized.reason === 'pending_input_remaining') return

    if (finalized.reason === 'account_control_won') {
      const message = finalized.accountStatus === 'tạm dừng'
        ? '⏸ Đã hoàn thành lượt hiện tại và tạm dừng tài khoản.'
        : '🔄 Đã hoàn thành lượt hiện tại và áp dụng trạng thái mới của tài khoản.'
      await this.logCampaignProgress(campaign.id, message)
      return
    }

    const message = finalized.campaignStatus === 'tạm dừng'
      ? '⏸ Đã hoàn thành lượt hiện tại và tạm dừng chiến dịch.'
      : '🔄 Đã hoàn thành lượt hiện tại và áp dụng trạng thái mới của chiến dịch.'
    await this.logCampaignProgress(campaign.id, message)
  }

  private async updateCampaignAndBroadcast(id: number, updates: Partial<Campaign>): Promise<Campaign> {
    let updated: Campaign
    if (updates.status === 'hoàn thành' && this.claimedServerZaloCampaignIds.has(id)) {
      const result = await this.finalizeClaimedServerZaloCampaign(id, updates.note)
      updated = result.campaign
    } else if (updates.status === 'hoàn thành') {
      const campaign = await this.supabase.getCampaign(id)
      if (!campaign) throw new Error('Không tìm thấy chiến dịch trước khi kiểm tra data để hoàn thành.')
      const nonFinalizationUpdates = { ...updates }
      delete nonFinalizationUpdates.status
      delete nonFinalizationUpdates.note
      if (Object.keys(nonFinalizationUpdates).length > 0) {
        await this.supabase.updateCampaign(id, nonFinalizationUpdates)
      }
      if (campaign.dataTargetSourceMode === 'data_group') {
        await this.supabase.finalizeDataGroupCampaign(
          id,
          updates.note,
          this.dataGroupRuntimeContext()
        )
      } else {
        await this.supabase.finalizeCampaign(id, updates.note)
      }
      const finalizedCampaign = await this.supabase.getCampaign(id)
      if (!finalizedCampaign) throw new Error('Không tìm thấy chiến dịch sau khi kiểm tra data để hoàn thành.')
      updated = finalizedCampaign
    } else if (updates.status !== undefined && this.claimedServerZaloCampaignIds.has(id)) {
      updated = await this.supabase.updateClaimedZaloServerCampaign(id, updates)
    } else {
      updated = await this.supabase.updateCampaign(id, updates)
    }
    this.broadcastCampaignUpdate(
      updated,
      updates.extraSettings !== undefined ? { invalidateConfig: true } : undefined
    )
    return updated
  }

  private broadcastCampaignUpdate(
    campaign: Pick<Campaign, 'id' | 'updatedAt' | 'status' | 'note'> & {
      schedule?: string | null
      lastRunAt?: string | null
    },
    options?: { invalidateConfig?: true }
  ): void {
    try {
      const signal: CampaignSummaryRefreshSignal = {
        id: campaign.id,
        updatedAt: campaign.updatedAt,
        status: campaign.status,
        note: campaign.note,
        ...(options?.invalidateConfig ? { invalidateConfig: true } : {})
      }
      if ('schedule' in campaign) signal.schedule = campaign.schedule ?? null
      if ('lastRunAt' in campaign) signal.lastRunAt = campaign.lastRunAt ?? null
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, signal)
    } catch {
      // Window may be closed
    }
  }

  private async broadcastClaimedRuntimeState(campaignId: number): Promise<void> {
    try {
      const claimedCampaign = await this.supabase.getCampaign(campaignId)
      if (claimedCampaign) this.broadcastCampaignUpdate(claimedCampaign)
    } catch (error) {
      console.warn(`Campaign ${campaignId} was claimed but could not be reloaded for broadcast:`, error)
    }

    try {
      this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
    } catch {
      // Window may be closed
    }
  }

  /**
   * Cập nhật account xong push event để panel tài khoản reload realtime.
   */
  private async updateAccountAndBroadcast(id: number, updates: Partial<AutoAccount>): Promise<AutoAccount> {
    const updated = updates.status !== undefined && this.claimedServerZaloAccountIds.has(id)
      ? await this.supabase.updateClaimedZaloServerAccount(id, updates)
      : await this.supabase.updateAccount(id, updates)
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
    } catch {
      // Window may be closed
    }
    return updated
  }

  private async releaseRunningAccount(accountId: number): Promise<void> {
    if (this.zaloRuntimeClaimsAbandoned && this.activeZaloAccountRuns.has(accountId)) return
    const account = await this.supabase.getAccount(accountId)
    if (!account || account.status !== 'đang chạy') return
    if (account.flatformType === 'zalo') {
      const released = await this.supabase.releaseZaloAccountRuntimeOperation(
        accountId,
        this.runtimeTarget,
        'chờ xử lý'
      )
      if (released) {
        try { this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED) } catch {}
      }
      return
    }
    await this.updateAccountAndBroadcast(accountId, { status: 'chờ xử lý' })
  }

  private async resolveMediaSelection(
    availableMedia: CampaignMediaInput[],
    option: 'none' | 'all' | 'random',
    randomCount: number,
    mediaTempPaths: string[] = []
  ): Promise<string[]> {
    if (option === 'none') return []
    const declaredMedia = (Array.isArray(availableMedia) ? availableMedia : [])
      .filter(item => this.hasDeclaredMediaSource(item))
    const candidateLimit = option === 'random'
      ? Math.max(1, randomCount || 1)
      : Number.MAX_SAFE_INTEGER
    const candidates = option === 'random'
      ? [...declaredMedia].sort(() => 0.5 - Math.random()).slice(0, candidateLimit)
      : declaredMedia
    const resolved: string[] = []

    for (const item of candidates) {
      resolved.push(await this.resolveCampaignMediaSource(item, mediaTempPaths))
    }

    return resolved
  }

  private hasDeclaredMediaSource(item: CampaignMediaInput): boolean {
    if (typeof item === 'string') {
      const value = item.trim()
      return Boolean(value)
    }
    if (!item || typeof item !== 'object') return false
    const localPath = String(item.localPath || '').trim()
    const cloudUrl = String(item.cloudUrl || '').trim()
    return Boolean(localPath || cloudUrl)
  }

  private isCampaignMediaImageOrVideo(item: CampaignMediaInput): boolean {
    if (typeof item === 'string') return isImageOrVideoMediaSource('', item)
    return isImageOrVideoMediaSource(item.mimeType, item.localPath, item.cloudUrl, item.name)
  }

  private async resolveCampaignMediaSource(item: CampaignMediaInput, mediaTempPaths: string[] = []): Promise<string> {
    const mediaName = this.getCampaignMediaName(item)

    if (typeof item === 'string') {
      const value = item.trim()
      if (!value) throw new CampaignMediaResolveError(mediaName, 'không có local path hoặc cloud URL hợp lệ')
      if (value.startsWith('data:')) return value
      if (/^https?:\/\//i.test(value)) return this.downloadCampaignMediaUrl(value, mediaName, mediaTempPaths)
      if (existsSync(value)) return value
      throw new CampaignMediaResolveError(mediaName, 'local path không tồn tại và không có cloud URL fallback')
    }

    const localPath = String(item?.localPath || '').trim()
    const localMissingReason = localPath ? 'local path không tồn tại' : 'không có local path'
    if (localPath) {
      if (localPath.startsWith('data:') || existsSync(localPath)) return localPath
    }

    const cloudUrl = String(item?.cloudUrl || '').trim()
    if (cloudUrl) {
      try {
        return await this.downloadCampaignMediaUrl(cloudUrl, mediaName, mediaTempPaths)
      } catch (err) {
        if (this.isCampaignMediaResolveError(err)) {
          throw new CampaignMediaResolveError(mediaName, `${localMissingReason} và ${err.reason}`)
        }
        throw err
      }
    }

    if (localPath) {
      throw new CampaignMediaResolveError(mediaName, `${localMissingReason} và không có cloud URL fallback`)
    }
    throw new CampaignMediaResolveError(mediaName, 'không có local path hoặc cloud URL hợp lệ')
  }

  private async downloadCampaignMediaUrl(url: string, mediaName: string, mediaTempPaths: string[] = []): Promise<string> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(60000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      const buf = Buffer.from(await response.arrayBuffer())
      const ext = this.getMediaDownloadExtension(url, contentType, mediaName)
      const tempPath = join(tmpdir(), `campaign-media-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`)
      writeFileSync(tempPath, buf)
      mediaTempPaths.push(tempPath)
      return tempPath
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new CampaignMediaResolveError(mediaName, `cloud URL không tải được (${message})`)
    }
  }

  private getMediaDownloadExtension(url: string, contentType: string, mediaName: string): string {
    try {
      const ext = extname(new URL(url).pathname)
      if (ext) return ext
    } catch {}

    const nameExt = extname(mediaName)
    if (nameExt) return nameExt

    return getRuntimeMediaDownloadExtensionForMimeType(contentType) || '.bin'
  }

  private getCampaignMediaName(item: CampaignMediaInput): string {
    if (typeof item === 'string') return item.split(/[\\/]/).pop() || item || 'media'
    return item?.name ||
      item?.localPath?.split(/[\\/]/).pop() ||
      item?.cloudUrl?.split('/').pop()?.split('?')[0] ||
      'media'
  }

  private isCampaignMediaResolveError(err: unknown): err is CampaignMediaResolveError {
    return err instanceof CampaignMediaResolveError
  }

  private async pauseCampaignForMediaError(campaign: Campaign, detail: CampaignInputData | null, error: CampaignMediaResolveError): Promise<void> {
    const note = error.message
    console.warn(`[CampaignScheduler] ${note}`)
    if (detail) {
      await this.supabase.updateCampaignInputData(detail.id, { status: 'chờ xử lý', note })
    }
    await this.updateCampaignAndBroadcast(campaign.id, { status: 'tạm dừng', note })
    await this.logCampaignProgress(campaign.id, `❌ Tạm dừng chiến dịch "${campaign.name}": ${note}`)
  }

  private cleanupCampaignMediaTempFiles(paths: string[]): void {
    const uniquePaths = Array.from(new Set(paths.map(path => String(path || '').trim()).filter(Boolean)))
    paths.length = 0
    for (const path of uniquePaths) {
      try {
        unlinkSync(path)
      } catch {}
    }
  }

  /**
   * Tách nội dung theo dấu `|` thành mảng biến thể (đã trim, bỏ rỗng).
   * Nếu input rỗng/null → `[]`; nếu không có dấu `|` → `[raw]`.
   * Dùng cho cả `content` và `commentContent`.
   */
  private splitContentVariants(raw: string | undefined | null): string[] {
    return splitSharedContentVariants(raw)
  }

  /**
   * Chọn biến thể theo chỉ số (cycle). `index` vượt quá length sẽ modulo về
   * đầu. Mảng rỗng → `''`.
   */
  private cycleVariant(variants: string[], index: number): string {
    if (variants.length === 0) return ''
    const safeIdx = ((index % variants.length) + variants.length) % variants.length
    return variants[safeIdx]
  }

  private renderSpinContent(raw: string | undefined | null): string {
    return renderContentSpin(raw)
  }
}
