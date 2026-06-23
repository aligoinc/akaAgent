import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { AccountActionLimitStatus, ActionLimitConfig, AkaBizIntegrationInfo, AutoAccount, AutoErrorPolicy, IPC_EVENTS, Campaign, CampaignAction, CampaignActionLimitSettings, CampaignDetail, CampaignDetailStatus, CampaignInputData, CampaignLogAction, CampaignRunEvent, CampaignRunEventInput, ContactType } from '../../shared/types'
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
  getMessageActionCode as resolveMessageActionCode,
  getPostActionCode as resolvePostActionCode,
  isCommentSeedingCampaign as resolveIsCommentSeedingCampaign,
  isNewsfeedCommentConfigured as resolveIsNewsfeedCommentConfigured,
  isNewsfeedLikeConfigured as resolveIsNewsfeedLikeConfigured,
  type CampaignActionDescriptor
} from '../domain/campaigns/campaignActionDescriptors'
import { ProxyRuntimeService } from './proxyRuntimeService'
import { ZaloApiError } from 'zca-js'
import { ZaloRuntimeService, type ZaloForwardMessageResult, type ZaloForwardMessageTargetResult, type ZaloFoundUser } from './zaloRuntimeService'
import { EmailRuntimeService } from './emailRuntimeService'
import * as campaignRunEventRepo from '../data/repositories/campaignRunEventRepository'
import type { ZaloUserContactInput } from '../data/repositories/accountContactRepository'
import { callAiUsing } from './aiRuntimeService'
import { captureBlockScreenshot, readBlockScreenshotDataUrl } from './blockScreenshotService'
import type {
  ZaloActionDetailOutput,
  ZaloActionHelperResult,
  ZaloApplyContactTagOptions,
  ZaloChangeContactAliasOptions,
  ZaloFindPhoneUserOptions,
  ZaloResolvedTarget,
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
  pendingNote?: string
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
  allCheckedActionsBlocked: boolean
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

interface ZaloFriendBlocklistContext {
  groupId: number
  groupName: string
  uidKeys: Set<string>
  invalidReason?: string
}

interface PostBumpTarget {
  campaignId: number
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

type FindDataTargetCampaignField =
  | 'findUidTargetCampaignIds'
  | 'findPostLinkTargetCampaignIds'
  | 'findFacebookGroupPostTargetCampaignIds'
  | 'findFacebookGroupCommentTargetCampaignIds'

const FIND_DATA_GROUP_ACTION_ID = 'facebook_find_data_group'
const FIND_DATA_SEARCH_ACTION_ID = 'facebook_find_data_search'
const GROUP_POST_ACTION_ID = 'facebook_group_post'
const GROUP_POST_FREQUENCY_LIMIT_ERROR_CODE = 'err_group_post_frequency_limit'
const COMMENT_SEEDING_FEED_ACTION_ID = 'facebook_comment_seeding'
const COMMENT_SEEDING_POST_ACTION_ID = 'facebook_comment_seeding_post'
const MESSAGE_FRIEND_ACTION_ID = 'facebook_message_friend'
const MESSAGE_UID_ACTION_ID = 'facebook_message_uid'
const PAGE_INBOX_MESSAGE_ACTION_ID = 'facebook_page_to_message'
const PAGE_POST_ACTION_ID = 'facebook_page_post'
const NEWSFEED_INTERACTION_ACTION_ID = 'facebook_newsfeed_interaction'
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const ZALO_MESSAGE_FRIEND_ACTION_ID = 'zalo_message_friend'
const ZALO_MESSAGE_BIRTHDAY_ACTION_ID = 'zalo_message_birthday'
const ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID = 'zalo_message_group_member'
const ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID = 'zalo_message_remarketing_customer'
const ZALO_MESSAGE_GROUP_ACTION_ID = 'zalo_message_group'
const ZALO_MESSAGE_SEND_MODE_SHARE = 'share'
const ZALO_SHARE_MESSAGE_BATCH_SIZE = 50
const ZALO_SHARE_MESSAGE_REWRITE_AI_CODE = 'fb_send_message_rewrite'
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
const OLD_VN_MOBILE_PREFIX_MAP: Record<string, string> = {
  '0162': '032',
  '0163': '033',
  '0164': '034',
  '0165': '035',
  '0166': '036',
  '0167': '037',
  '0168': '038',
  '0169': '039',
  '0120': '070',
  '0121': '079',
  '0122': '077',
  '0126': '076',
  '0128': '078',
  '0123': '083',
  '0124': '084',
  '0125': '085',
  '0127': '081',
  '0129': '082',
  '0186': '056',
  '0188': '058',
  '0199': '059'
}
const EMAIL_SEND_ACTION_ID = 'email_send'
const ZALO_FIND_PHONE_ACTION_CODE = 'zalo_find_phone_user'
const ZALO_FIND_PHONE_DEFAULT_LIMIT = 1000
const ZALO_API_BUSINESS_FAILED_ERROR_CODE = 'err_zalo_api_business_failed'
const ZALO_USER_NOT_FOUND_ERROR_CODE = 'err_zalo_user_not_found'
const CAMPAIGN_ERROR_SCREENSHOT_DIAGNOSIS_AI_CODE = 'campaign_error_screenshot_diagnosis'
const DEFAULT_RATE_LIMIT_MINUTES = 65
const CAMPAIGN_PAUSE_PENDING_NOTE = 'Đang chờ tạm dừng'
const FIND_DATA_SOURCE_WAIT_NOTE = 'Đang chờ data từ chiến dịch tìm data'

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
  private activeAccountRuns = new Set<number>()
  private activeV2Aborts = new Map<number, AbortController>()
  private pauseRequests = new Set<number>()
  private loggedNewsfeedMilestoneKeys = new Set<string>()
  private backgroundPages = new BackgroundPageManager()
  private backgroundPreviewTimers = new Map<string, ReturnType<typeof setInterval>>()
  private backgroundPreviewCapturing = new Set<string>()
  private backgroundPreviewOverrides = new Map<string, BackgroundPreviewOverride>()
  private proxyRuntime?: ProxyRuntimeService
  private zaloRuntime?: ZaloRuntimeService
  private emailRuntime?: EmailRuntimeService

  constructor(
    supabase: SupabaseService,
    webviewRegistry: WebviewRegistry,
    mainWindow: BrowserWindow,
    proxyRuntime?: ProxyRuntimeService,
    zaloRuntime?: ZaloRuntimeService,
    emailRuntime?: EmailRuntimeService
  ) {
    this.supabase = supabase
    this.webviewRegistry = webviewRegistry
    this.mainWindow = mainWindow
    this.proxyRuntime = proxyRuntime
    this.zaloRuntime = zaloRuntime
    this.emailRuntime = emailRuntime
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
    if (campaign.actionId === GROUP_POST_ACTION_ID) return 'findFacebookGroupPostTargetCampaignIds'
    if (campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID) return 'findFacebookGroupCommentTargetCampaignIds'
    return null
  }

  private isMatchingFindDataSource(sourceCampaign: Campaign, targetField: FindDataTargetCampaignField): boolean {
    if (sourceCampaign.isDelete) return false
    const isFindDataGroup = sourceCampaign.actionId === FIND_DATA_GROUP_ACTION_ID
    const isFindDataSearch = sourceCampaign.actionId === FIND_DATA_SEARCH_ACTION_ID
    if (!isFindDataGroup && !isFindDataSearch) return false

    if (targetField === 'findUidTargetCampaignIds') return sourceCampaign.extraSettings?.isFindUid === true
    if (targetField === 'findPostLinkTargetCampaignIds') return sourceCampaign.extraSettings?.isFindPostLink === true
    if (!isFindDataSearch) return false
    return sourceCampaign.extraSettings?.isFindFacebookGroup === true
  }

  start(options: SchedulerStartOptions = {}): void {
    if (this.running) return
    this.running = true
    const initialDelayMs = Math.max(0, options.initialDelayMs ?? 0)
    if (initialDelayMs > 0) {
      const seconds = Math.ceil(initialDelayMs / 1000)
      this.sendLog(`📋 Scheduler sẽ bắt đầu sau ${seconds} giây. Kiểm tra mỗi 30 giây.`)
      this.startDelayTimeoutId = setTimeout(() => {
        this.startDelayTimeoutId = null
        this.startPolling()
      }, initialDelayMs)
      return
    }

    this.startPolling()
  }

  stop(): void {
    this.running = false
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
    this.sendLog('⏹ Scheduler đã dừng.')
  }

  private startPolling(): void {
    if (!this.running || this.intervalId) return
    this.intervalId = setInterval(() => this.tick(), 30000)
    this.sendLog('📋 Scheduler đã bắt đầu. Kiểm tra mỗi 30 giây.')
    this.tick()
  }

  destroyBackgroundPage(accountId: number): void {
    this.backgroundPages.destroy(accountId)
  }

  isRunning(): boolean {
    return this.running
  }

  async requestPauseCampaign(campaignId: number): Promise<Campaign> {
    const campaign = await this.supabase.getCampaign(campaignId)
    if (!campaign) {
      throw new Error('Không tìm thấy chiến dịch.')
    }

    if (campaign.status === 'chờ xử lý') {
      this.pauseRequests.delete(campaignId)
      return await this.updateCampaignAndBroadcast(campaignId, { status: 'tạm dừng', note: null })
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

  private isCampaignPauseRequested(campaignId: number): boolean {
    return this.pauseRequests.has(campaignId)
  }

  private async completeCampaignPause(campaign: Campaign): Promise<void> {
    await this.updateCampaignAndBroadcast(campaign.id, { status: 'tạm dừng', note: null })
    this.pauseRequests.delete(campaign.id)
    await this.logCampaignProgress(campaign.id, `⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`)
  }

  private async sleepBetweenTargets(campaign: Campaign, seconds: number): Promise<'paused' | 'completed'> {
    const endAt = Date.now() + seconds * 1000
    while (Date.now() < endAt) {
      if (this.isCampaignPauseRequested(campaign.id)) return 'paused'
      await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, endAt - Date.now()))))
    }
    return this.isCampaignPauseRequested(campaign.id) ? 'paused' : 'completed'
  }

  private async tick(): Promise<void> {
    if (!this.running || this.dispatching) return
    this.dispatching = true

    try {
      await this.supabase.enableDueAccountActions().catch(err => {
        console.error('Failed to enable due account actions:', err)
      })

      // 1. Get eligible accounts
      const accounts = await this.supabase.getEligibleAccounts()
      if (accounts.length === 0) {
        return
      }

      for (const account of accounts) {
        if (this.activeAccountRuns.has(account.id)) {
          continue
        }

        if (account.status !== 'chờ xử lý' || account.loginStatus !== 'đã đăng nhập') {
          continue
        }

        // 2. Get pending campaigns for this account
        const campaigns = await this.supabase.getPendingCampaigns(account.id)
        if (campaigns.length === 0) continue

        // Browserless campaigns such as Zalo API flows do not mount a webview tab.
        const hasBrowserCampaigns = campaigns.some(campaign => !this.isBrowserlessCampaign(campaign))
        if (hasBrowserCampaigns && !this.webviewRegistry.isRegistered(account.id)) {
          this.sendLog(`⚠️ Tài khoản "${account.name}" chưa mở tab trình duyệt. Bỏ qua.`)
          continue
        }

        this.startAccountCampaignQueue(account, campaigns)
      }
    } catch (err) {
      console.error('Scheduler tick error:', err)
      this.sendLog(`❌ Lỗi scheduler: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.dispatching = false
    }
  }

  private startAccountCampaignQueue(account: AutoAccount, campaigns: Campaign[]): void {
    if (this.activeAccountRuns.has(account.id)) return
    this.activeAccountRuns.add(account.id)

    void this.runAccountCampaignQueue(account, campaigns)
      .catch(err => {
        console.error(`Scheduler account queue error for account ${account.id}:`, err)
        this.sendLog(`❌ Lỗi hàng đợi tài khoản "${account.name}": ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        this.activeAccountRuns.delete(account.id)
      })
  }

  private async runAccountCampaignQueue(account: AutoAccount, campaigns: Campaign[]): Promise<void> {
    for (const campaign of campaigns) {
      if (!this.running) break
      await this.executeCampaign(account, campaign)
    }
  }

  /**
   * Handle post-campaign completion. Recurring schedule maintenance runs after
   * login / day change; completion itself should not move weekly/monthly dates.
   */
  private async handleCampaignCompletion(campaign: Campaign): Promise<void> {
    // Check end date
    const now = new Date()
    if (campaign.scheduleEndDate) {
      const endDate = new Date(campaign.scheduleEndDate)
      if (now >= endDate) {
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
        await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (hết ngày kết thúc)`)
        return
      }
    }

    if (await this.handleMultiDailyTimeSlotAfterCompletion(campaign, now)) {
      return
    }

    if (await this.handleRerunAfterCompletion(campaign, now)) {
      return
    }

    await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
    await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"`)
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
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không còn khung giờ chạy trong hôm nay)`)
      return true
    }

    if (this.isAfterDailyStopTime(nextSchedule, campaign.dailyStopTime)) {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.logCampaignProgress(
        campaign.id,
        `✅ Hoàn thành chiến dịch "${campaign.name}" (khung giờ ${nextSlot} vượt quá giờ dừng trong ngày)`
      )
      return true
    }

    const details = await this.supabase.listCampaignInputData(campaign.id)
    const resettableCount = details.filter(detail => !detail.isDelete && detail.status !== 'tạm dừng').length
    if (details.length > 0 && resettableCount === 0) {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không có data cần chạy lại ở khung giờ tiếp theo)`)
      return true
    }
    if (campaign.actionId === PAGE_POST_ACTION_ID && details.length === 0) {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không có page cần chạy lại ở khung giờ tiếp theo)`)
      return true
    }
    if (
      (campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID || campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID) &&
      details.length === 0
    ) {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không có data cần chạy lại ở khung giờ tiếp theo)`)
      return true
    }

    if (resettableCount > 0) {
      await this.supabase.resetCampaignInputDataForRerun(campaign.id)
    }
    await this.updateCampaignAndBroadcast(campaign.id, {
      status: 'chờ xử lý',
      schedule: nextSchedule.toISOString(),
      note: null
    })
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
      campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID
    if (
      !supportsRerunAfterCompletion ||
      campaign.extraSettings?.findDataRerunEnabled !== true
    ) {
      return false
    }

    const hours = this.normalizeFindDataRerunAfterHours(campaign.extraSettings.findDataRerunAfterHours)
    if (hours <= 0) return false

    const nextSchedule = new Date(now.getTime() + hours * 60 * 60 * 1000)

    if (!this.isSameVietnamDay(nextSchedule, now)) {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"`)
      return true
    }

    if (this.isAfterDailyStopTime(nextSchedule, campaign.dailyStopTime)) {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.logCampaignProgress(
        campaign.id,
        `✅ Hoàn thành chiến dịch "${campaign.name}" (lượt chạy lại sau ${hours} giờ vượt quá giờ dừng trong ngày)`
      )
      return true
    }

    const details = await this.supabase.listCampaignInputData(campaign.id)
    const resettableCount = details.filter(detail => !detail.isDelete && detail.status !== 'tạm dừng').length
    if (resettableCount === 0) {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}" (không có data cần chạy lại)`)
      return true
    }

    await this.supabase.resetCampaignInputDataForRerun(campaign.id)
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
    await this.updateCampaignAndBroadcast(campaign.id, {
      status: 'hoàn thành',
      note
    })
    const suffix = note ? ` (${note})` : ''
    await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"${suffix}`)
  }

  private async completeZaloBirthdayWithoutTargets(campaign: Campaign): Promise<void> {
    const message = 'Không có bạn bè sinh nhật hôm nay'
    await this.updateCampaignAndBroadcast(campaign.id, {
      status: 'hoàn thành',
      note: message
    })
    await this.logCampaignProgress(campaign.id, `🎂 ${message}`)
    await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"`)
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

  private getVietnamDateKey(date = new Date()): string {
    const parts = this.getVietnamDateTimeParts(date)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
  }

  private getVietnamBirthdayKey(date = new Date()): string {
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
    const match = String(dailyStopTime || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (!match) return false

    const stopHour = Number(match[1])
    const stopMinute = Number(match[2])
    const stopSecond = Number(match[3] || 0)
    if (
      !Number.isInteger(stopHour) ||
      !Number.isInteger(stopMinute) ||
      !Number.isInteger(stopSecond) ||
      stopHour < 0 ||
      stopHour > 23 ||
      stopMinute < 0 ||
      stopMinute > 59 ||
      stopSecond < 0 ||
      stopSecond > 59
    ) {
      return false
    }

    const parts = this.getVietnamDateTimeParts(date)
    if (parts.hour !== stopHour) return parts.hour > stopHour
    if (parts.minute !== stopMinute) return parts.minute > stopMinute
    return parts.second > stopSecond
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

  private async executeCampaign(account: AutoAccount, campaign: Campaign): Promise<void> {
    try {
      const currentCampaign = await this.supabase.getCampaign(campaign.id)
      if (!currentCampaign || currentCampaign.status !== 'chờ xử lý') {
        return
      }
      campaign = currentCampaign

      const startBlockReason = await this.getAccountRunBlockReason(account.id, 'chờ xử lý')
      if (startBlockReason) {
        await this.updateCampaignPreflightNote(campaign, startBlockReason)
        return
      }

      const findDataWaitNote = await this.getFindDataSourceWaitNote(campaign)
      if (findDataWaitNote) {
        await this.updateCampaignPreflightNote(campaign, findDataWaitNote)
        return
      }

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

      const workflowSelection = this.resolveCampaignWorkflow(action)
      if (!workflowSelection.workflowId) {
        await this.updateCampaignPreflightNote(campaign, workflowSelection.missingNote)
        return
      }

      const actionDescriptors = this.getCampaignActionDescriptors(campaign, action)
      const preflightActionDescriptors = campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID
        ? []
        : campaign.actionId === 'facebook_group_post' && campaign.extraSettings?.skipPostIfGroupRequiresApproval === true
          ? actionDescriptors.filter(action => action.code !== 'fb_post_group')
          : actionDescriptors
      const preflightLimit = await this.checkActionLimits(
        account,
        campaign,
        preflightActionDescriptors,
        campaign.extraSettings?.actionLimits
      )
      if (preflightLimit && !preflightLimit.ok) {
        await this.updateCampaignPreflightNote(campaign, await this.buildLimitPreflightNote(preflightLimit))
        return
      }

      if (!(await this.ensureZaloSessionReadyForCampaign(account, campaign))) {
        return
      }

      await this.updateCampaignAndBroadcast(campaign.id, { status: 'đang chạy', note: null })
      await this.logCampaignProgress(campaign.id, `🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${account.name}"`)

      await this.updateAccountAndBroadcast(account.id, { status: 'đang chạy' })

      await this.executeCampaignV2(account, campaign, workflowSelection.workflowId, actionDescriptors)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.recoverStuckCampaignInputData(campaign.id, errMsg)
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
    actionDescriptors: CampaignActionDescriptor[]
  ): Promise<void> {
    // Determine details: if campaign actionId has details (group_post, message_friend, etc.)
    let details = await this.supabase.listCampaignInputData(campaign.id)
    const extra = campaign.extraSettings || {}

    if (this.isCampaignPauseRequested(campaign.id)) {
      await this.releaseRunningAccount(account.id)
      await this.completeCampaignPause(campaign)
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

    if (this.shouldMaterializeZaloBirthdayInputData(campaign, details)) {
      details = await this.materializeZaloBirthdayInputData(account, campaign)
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

    if (this.shouldUseSuggestedFriends(campaign) && details.length === 0) {
      details = await this.collectSuggestedFriendInputData(account, campaign, workflowId)
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

    if (this.shouldUseZaloShareMessageBatch(campaign)) {
      await this.executeZaloShareMessageBatchCampaign(account, campaign, details, actionDescriptors, zaloFriendBlocklist)
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
    const shouldPostWithBackground = extra.postWithBackground === true && (
      campaign.actionId === 'facebook_timeline_post' ||
      (campaign.actionId === PAGE_POST_ACTION_ID && sourcePagePostMode === 'ui')
    )
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

    for (let i = 0; i < targets.length; i++) {
      // Check pause
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

      const detail = targets[i]
      if (detail && detail.status !== 'chờ xử lý') continue
      if (detail) {
        const futureSchedule = this.getFutureInputSchedule(detail, new Date())
        if (futureSchedule) {
          if (!earliestFutureInputSchedule || futureSchedule.getTime() < earliestFutureInputSchedule.getTime()) {
            earliestFutureInputSchedule = futureSchedule
          }
          continue
        }
      }

      if (detail && this.isZaloFriendBlockedByBlocklist(campaign, detail, zaloFriendBlocklist)) {
        await this.markZaloFriendBlocklistSkipped(campaign, detail, zaloFriendBlocklist!)
        zaloFriendBlocklistSkippedCount += 1
        continue
      }

      const groupPostApproval = await this.resolveGroupPostApprovalForTarget(account.id, campaign, detail)
      const targetActionDescriptors = groupPostApproval.skipPostByKnownApproval
        ? actionDescriptors.filter(action => action.code !== 'fb_post_group')
        : actionDescriptors
      let newsfeedAvailability: NewsfeedActionAvailability | undefined

      // Check action disable/rate limit immediately before each target.
      try {
        if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
          newsfeedAvailability = await this.resolveNewsfeedActionAvailability(account, campaign, targetActionDescriptors, limitConfig)
          if (newsfeedAvailability.allCheckedActionsBlocked) {
            stoppedBeforeCompletion = true
            const message = newsfeedAvailability.blockedReasons.join('; ') || 'Các hành động newsfeed đang đạt giới hạn'
            if (this.isNewsfeedDailyCampaign(campaign)) {
              await this.completeNewsfeedDailyWithoutNextDay(campaign, message)
            } else {
              await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
              await this.logCampaignProgress(campaign.id, `⚠️ Tạm dừng "${campaign.name}": ${message}`)
            }
            break
          }
        } else {
          const limitStatus = await this.checkActionLimits(account, campaign, targetActionDescriptors, limitConfig)
          if (limitStatus && !limitStatus.ok) {
            stoppedBeforeCompletion = true
            await this.handleLimitStatus(account, campaign, limitStatus)
            break
          }
        }
      } catch (err) {
        console.error('Rate limit check error:', err)
      }

      const browserlessRun = this.isBrowserlessCampaign(campaign)
      const automationPage = browserlessRun
        ? { page: null, source: 'background' as const }
        : await this.getAutomationPage(account, campaign.id)
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

      // Build variables
      const variables = {
        ...this.buildVariablesV2(campaign, detail, account.id, currentSourceLink, i, groupPostApproval),
        ...(campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID
          ? {
            allowNewsfeedLike: newsfeedAvailability?.allowLike ?? true,
            allowNewsfeedComment: newsfeedAvailability?.allowComment ?? true
          }
          : {})
      }

      // Update detail status running
      if (detail) {
        await this.supabase.updateCampaignInputData(detail.id, {
          status: 'đang chạy',
          dateAction: new Date().toISOString()
        })
        const inputDataName = this.getInputDataDisplayName(campaign, detail)
        await this.logCampaignProgress(campaign.id, `▶️ Xử lý "${inputDataName}" trong chiến dịch "${campaign.name}"`)
        if (groupPostApproval.skipPostByKnownApproval) {
          const message = `Bỏ qua đăng bài vào "${inputDataName}" vì group đã biết cần duyệt bài`
          await this.logCampaignProgress(campaign.id, `⚠️ ${message}`)
        }
      }

      // Run engine v2
      const abort = new AbortController()
      let accountStopReason: string | null = null
      let shouldStopAfterTarget = false
      let shouldCompletePauseAfterTarget = false
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

        // Per-milestone logging — scan steps theo block_name
        const milestoneSummary = await this.logMilestonesV2(campaign, detail, account.id, result.steps, result.status === 'completed', screenshotProgressLogs)

        const campaignPauseRequested = this.isCampaignPauseRequested(campaign.id)
        const pauseCancelledRun = campaignPauseRequested && !accountStopReason && result.status === 'cancelled'
        let runtimeStopTriggered = false

        if (accountStopReason) {
          if (detail) {
            await this.supabase.updateCampaignInputData(detail.id, { status: 'chờ xử lý', note: accountStopReason })
          }
          await this.stopCampaignForAccountCondition(account, campaign, accountStopReason)
          shouldStopAfterTarget = true
        }

        if (detail && !accountStopReason) {
          if (result.status === 'completed') {
            if (milestoneSummary.resetInputToPending) {
              await this.supabase.updateCampaignInputData(detail.id, {
                status: 'chờ xử lý',
                note: milestoneSummary.pendingNote || ''
              })
            } else {
              await this.supabase.updateCampaignInputData(detail.id, { status: 'hoàn thành' })
              await this.logCampaignProgress(campaign.id, `✅ Hoàn thành "${this.getInputDataDisplayName(campaign, detail)}"`)
            }
          } else if (pauseCancelledRun) {
            await this.supabase.updateCampaignInputData(detail.id, { status: 'chờ xử lý', note: CAMPAIGN_PAUSE_PENDING_NOTE })
          } else {
            // campaign_input_data enum không có 'lỗi' — set 'hoàn thành' + note (chi tiết lỗi đã ở campaign_details)
            const errMsg = result.error || 'Lỗi không xác định'
            await this.supabase.updateCampaignInputData(detail.id, { status: 'hoàn thành', note: errMsg })
            await this.logCampaignProgress(campaign.id, `❌ Lỗi "${this.getInputDataDisplayName(campaign, detail)}": ${errMsg}`)
          }
        }

        if (!accountStopReason && !pauseCancelledRun) {
          const runtimeError = result.status !== 'completed'
            ? this.normalizeRuntimeError(campaign, result.steps, result.error)
            : null

          if (runtimeError && this.isNewsfeedDailyCampaign(campaign)) {
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
              targetActionDescriptors[0]?.code,
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

        if (milestoneSummary.stopAfterTarget) {
          const latestCampaign = await this.supabase.getCampaign(campaign.id).catch(() => null)
          if (!latestCampaign || latestCampaign.status === 'đang chạy') {
            await this.updateCampaignAndBroadcast(campaign.id, {
              status: 'chờ xử lý',
              note: milestoneSummary.pendingNote || 'Tài khoản Zalo cần kiểm tra lại trước khi chạy tiếp'
            })
          }
          shouldStopAfterTarget = true
        }

        if (campaignPauseRequested) {
          if (!accountStopReason && !runtimeStopTriggered) {
            shouldCompletePauseAfterTarget = true
            shouldStopAfterTarget = true
          } else {
            this.pauseRequests.delete(campaign.id)
          }
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err)
        const campaignPauseRequested = this.isCampaignPauseRequested(campaign.id)
        const pauseAbortTriggered = campaignPauseRequested && !accountStopReason && abort.signal.aborted
        let runtimeStopTriggered = false
        if (detail) {
          await this.supabase.updateCampaignInputData(detail.id, {
            status: accountStopReason || pauseAbortTriggered ? 'chờ xử lý' : 'hoàn thành',
            note: accountStopReason || (pauseAbortTriggered ? CAMPAIGN_PAUSE_PENDING_NOTE : errMsg)
          })
        }
        if (pauseAbortTriggered) {
          shouldCompletePauseAfterTarget = true
          shouldStopAfterTarget = true
        } else if (accountStopReason) {
          await this.stopCampaignForAccountCondition(account, campaign, accountStopReason)
          shouldStopAfterTarget = true
        } else {
          const runtimeError = this.normalizeRuntimeError(campaign, [], errMsg)
          if (this.isNewsfeedDailyCampaign(campaign)) {
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
        if (!pauseAbortTriggered) {
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
        if (campaignPauseRequested && !pauseAbortTriggered) {
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

      if (shouldCompletePauseAfterTarget) {
        await this.releaseRunningAccount(account.id)
        await this.completeCampaignPause(campaign)
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
          const sleepResult = await this.sleepBetweenTargets(campaign, sleepTime)
          if (sleepResult === 'paused') {
            await this.releaseRunningAccount(account.id)
            await this.completeCampaignPause(campaign)
            return
          }
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

  private shouldUseZaloShareMessageBatch(campaign: Campaign): boolean {
    return (
      campaign.extraSettings?.zaloMessageSendMode === ZALO_MESSAGE_SEND_MODE_SHARE &&
      (campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID || campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID)
    )
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
    actionDescriptors: CampaignActionDescriptor[],
    zaloFriendBlocklist: ZaloFriendBlocklistContext | null
  ): Promise<void> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')

    const extra = campaign.extraSettings || {}
    const actionDescriptor = this.getZaloShareMessageActionDescriptor(campaign, actionDescriptors)
    const baseMessage = this.cycleVariant(this.splitContentVariants(campaign.content), 0)
    const attachments = this.resolveImageSelection(campaign.images || [], extra.imageOption || 'all', extra.randomImageCount || 3)
    const isGroup = campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
    const targetKindLabel = isGroup ? 'group Zalo' : 'bạn bè Zalo'

    if (!baseMessage.trim() && attachments.length === 0) {
      const note = 'Vui lòng nhập nội dung hoặc chọn media để gửi Zalo'
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note })
      await this.logCampaignProgress(campaign.id, `⚠️ ${note}`)
      await this.releaseRunningAccount(account.id)
      return
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
      const now = new Date()
      const remainingDetails: CampaignInputData[] = []
      for (const detail of details) {
        if (
          detail.status === 'chờ xử lý' &&
          !this.getFutureInputSchedule(detail, now) &&
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

    while (index < details.length) {
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

      const capacity = await this.getZaloShareMessageBatchCapacity(account, campaign, actionDescriptor, limitConfig)
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

      const batch: ZaloShareMessageTarget[] = []
      let stopAfterInvalidTarget = false

      while (index < details.length && batch.length < capacity.capacity) {
        const detail = details[index]
        index += 1

        if (detail.status !== 'chờ xử lý') continue
        const futureSchedule = this.getFutureInputSchedule(detail, new Date())
        if (futureSchedule) {
          if (!earliestFutureInputSchedule || futureSchedule.getTime() < earliestFutureInputSchedule.getTime()) {
            earliestFutureInputSchedule = futureSchedule
          }
          continue
        }

        if (this.isZaloFriendBlockedByBlocklist(campaign, detail, zaloFriendBlocklist)) {
          await this.markZaloFriendBlocklistSkipped(campaign, detail, zaloFriendBlocklist!, { logProgress: false })
          zaloFriendBlocklistSkippedCount += 1
          continue
        }

        await this.supabase.updateCampaignInputData(detail.id, {
          status: 'đang chạy',
          dateAction: new Date().toISOString()
        })

        const target = this.createZaloShareMessageTarget(campaign, detail)
        if (!target) {
          stopAfterInvalidTarget = await this.handleInvalidZaloShareMessageTarget(account, campaign, detail, actionDescriptor)
          if (stopAfterInvalidTarget) break
          continue
        }
        if (campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID) {
          const resolvedTarget = await this.resolveZaloFriendMessageTarget(account, target.target)
          await this.upsertZaloResolvedProfileTarget(account, resolvedTarget, campaign.actionId)
          batch.push({ ...target, target: resolvedTarget })
        } else {
          batch.push(target)
        }
      }

      if (stopAfterInvalidTarget) {
        stoppedBeforeCompletion = true
        break
      }
      if (batch.length === 0) continue

      const message = await this.getZaloShareMessageForBatch(account, campaign, baseMessage)
      const stopAfterBatch = await this.processZaloShareMessageBatch(
        account,
        campaign,
        batch,
        actionDescriptor,
        message,
        attachments
      )
      if (stopAfterBatch) {
        stoppedBeforeCompletion = true
        break
      }

      if (index < details.length) {
        const sleepTime = this.getEffectiveSleepBetweenActions(account, limitConfig)
        if (sleepTime > 0) {
          const sleepResult = await this.sleepBetweenTargets(campaign, sleepTime)
          if (sleepResult === 'paused') {
            await this.releaseRunningAccount(account.id)
            await this.completeCampaignPause(campaign)
            return
          }
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
  }

  private async getZaloShareMessageBatchCapacity(
    account: AutoAccount,
    campaign: Campaign,
    actionDescriptor: CampaignActionDescriptor,
    limitConfig?: CampaignActionLimitSettings
  ): Promise<ZaloShareMessageCapacity> {
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
    const original = String(message || '')
    const content = original.trim()
    if (campaign.extraSettings?.rewriteContentEachRun !== true || !content) {
      return original
    }

    try {
      const result = await callAiUsing(ZALO_SHARE_MESSAGE_REWRITE_AI_CODE, {
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

    const isGroup = campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
    const trimmedMessage = String(message || '').trim()
    const mediaFailures = new Map<number, ZaloActionDetailOutput>()
    const mediaResponses = new Map<number, unknown>()

    if (attachments.length > 0) {
      for (const item of batch) {
        try {
          const response = isGroup
            ? await this.zaloRuntime.sendMessageToGroup(account.id, item.threadId, '', attachments)
            : await this.zaloRuntime.sendMessageToUser(account.id, item.threadId, '', attachments)
          mediaResponses.set(item.detail.id, response)
        } catch (err) {
          mediaFailures.set(item.detail.id, await this.createZaloErrorDetail(
            account,
            campaign,
            err,
            actionDescriptor.code,
            actionDescriptor.name,
            { target: item.target, threadId: item.threadId, attachments, inputData: item.inputData, sendMode: 'share_media' }
          ))
        }
      }
    }

    let forwardResult: ZaloForwardMessageResult | null = null
    let forwardError: unknown = null
    const textBatch = batch.filter(item => !mediaFailures.has(item.detail.id))
    if (trimmedMessage) {
      if (textBatch.length > 0) {
        try {
          forwardResult = isGroup
            ? await this.zaloRuntime.forwardMessageToGroups(account.id, textBatch.map(item => item.threadId), trimmedMessage)
            : await this.zaloRuntime.forwardMessageToUsers(account.id, textBatch.map(item => item.threadId), trimmedMessage)
        } catch (err) {
          forwardError = err
        }
      }
    }

    let stopAfterBatch = false
    let shareSuccessCount = 0
    let shareFailCount = 0
    for (const item of batch) {
      const mediaFailure = mediaFailures.get(item.detail.id)
      let actionDetail: ZaloActionDetailOutput

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
        const targetResult = this.findZaloForwardTargetResult(forwardResult, item.threadId)
        actionDetail = targetResult?.ok
          ? this.createZaloShareSuccessDetail(actionDescriptor, item, trimmedMessage, attachments, mediaResponses.get(item.detail.id), forwardResult?.response)
          : await this.createZaloForwardFailureDetail(account, campaign, actionDescriptor, item, targetResult, trimmedMessage, attachments, forwardResult?.response)
      } else {
        actionDetail = this.createZaloShareSuccessDetail(actionDescriptor, item, '', attachments, mediaResponses.get(item.detail.id), null)
      }

      const created = await this.recordZaloShareActionDetail(campaign, item.detail, account.id, actionDetail)
      await this.updateZaloShareInputStatus(item.detail, actionDetail)

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
    if (actionDetail.resetInputToPending) {
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

  private shouldMaterializeZaloFriendInputData(campaign: Campaign, details: CampaignInputData[]): boolean {
    if (!this.isZaloFriendAutoDataCampaign(campaign)) return false
    if (details.length > 0) return false
    return !campaign.extraSettings?.zaloFriendDataMaterializedAt
  }

  private shouldMaterializeZaloBirthdayInputData(campaign: Campaign, details: CampaignInputData[]): boolean {
    if (!this.isZaloBirthdayCampaign(campaign)) return false
    if (details.length > 0) return false
    return campaign.extraSettings?.zaloBirthdayDataMaterializedDate !== this.getVietnamDateKey()
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
      || campaign.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID
      || campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
  }

  private getInputDataDisplayName(campaign: Campaign, detail: CampaignInputData | null | undefined, fallback = 'N/A'): string {
    if (!detail) return fallback
    const values = campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID
      ? [detail.phone, detail.name, detail.uid]
      : campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
          campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
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

  private normalizeSuggestedFriendsCount(value: unknown): number {
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed)) return 10
    return Math.max(1, parsed)
  }

  private async collectSuggestedFriendInputData(account: AutoAccount, campaign: Campaign, workflowId: number): Promise<CampaignInputData[]> {
    const count = this.normalizeSuggestedFriendsCount(campaign.extraSettings?.suggestedFriendsCount)

    await this.logCampaignProgress(campaign.id, `ℹ️ Bắt đầu lấy ${count} đề xuất bạn bè từ Facebook`)

    const automationPage = await this.getAutomationPage(account, campaign.id)
    const page = automationPage.page
    if (!page) throw new Error('Không khởi tạo được trình duyệt cho Facebook')
    const abort = new AbortController()
    this.activeV2Aborts.set(campaign.id, abort)
    if (automationPage.source === 'background') {
      this.startBackgroundPreview(account.id, campaign.id, page)
    }

    try {
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

      for (const profile of profiles) {
        await this.supabase.createCampaignInputData({
          campaignId: campaign.id,
          name: profile.name,
          uid: profile.uid,
          status: 'chờ xử lý',
          note: ''
        })
      }

      await this.logCampaignProgress(campaign.id, `✅ Đã thêm ${profiles.length} đề xuất bạn bè vào chiến dịch "${campaign.name}"`)
      return await this.supabase.listCampaignInputData(campaign.id)
    } finally {
      if (automationPage.source === 'background') {
        this.stopBackgroundPreview(account.id, campaign.id)
      }
      this.activeV2Aborts.delete(campaign.id)
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
    let digits = this.phoneInputText(value).replace(/\D+/g, '')
    if (!digits) return ''

    if (digits.startsWith('0084') && digits.length >= 13) {
      digits = `0${digits.slice(4)}`
    } else if (digits.startsWith('84') && digits.length >= 11) {
      digits = `0${digits.slice(2)}`
    }
    if (digits.length === 9 && /^[35789]/.test(digits)) {
      digits = `0${digits}`
    }
    if (digits.length === 11) {
      const mappedPrefix = OLD_VN_MOBILE_PREFIX_MAP[digits.slice(0, 4)]
      if (mappedPrefix) digits = `${mappedPrefix}${digits.slice(4)}`
    }

    return /^0[35789]\d{8}$/.test(digits) ? digits : ''
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
      campaign.extraSettings?.zaloMessageSendMode === ZALO_MESSAGE_SEND_MODE_SHARE ||
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
        conversationUids.push(...await this.zaloRuntime.getLabelConversationUids(account.id, tagId))
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
      const rows = await this.zaloRuntime.getAllFriendsPage(account.id, ZALO_FRIEND_PAGE_SIZE, page)
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

    await this.upsertZaloApiUserContacts(
      profiles.map(profile => this.mapZaloApiRawUserContact(account.id, profile.raw, campaign.actionId))
    )

    for (const profile of profiles) {
      await this.supabase.createCampaignInputData({
        campaignId: campaign.id,
        name: profile.name,
        uid: profile.uid,
        phone: profile.phone || '',
        status: 'chờ xử lý',
        note: ''
      })
    }

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

  private async materializeZaloBirthdayInputData(account: AutoAccount, campaign: Campaign): Promise<CampaignInputData[]> {
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const todayDateKey = this.getVietnamDateKey()
    const todayDdMm = this.getVietnamBirthdayKey()

    await this.logCampaignProgress(campaign.id, `🔄 Đang quét danh sách bạn bè Zalo live để lọc sinh nhật ${todayDdMm}`)

    const profiles: ZaloFriendMaterializedProfile[] = []
    const seen = new Set<string>()
    let page = 1
    while (true) {
      const rows = await this.zaloRuntime.getAllFriendsPage(account.id, ZALO_FRIEND_PAGE_SIZE, page)
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

    await this.upsertZaloApiUserContacts(
      profiles.map(profile => this.mapZaloApiRawUserContact(account.id, profile.raw, campaign.actionId))
    )

    for (const profile of profiles) {
      await this.supabase.createCampaignInputData({
        campaignId: campaign.id,
        name: profile.name,
        uid: profile.uid,
        phone: profile.phone || '',
        status: 'chờ xử lý',
        note: ''
      })
    }

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

  private async checkActionLimits(
    account: AutoAccount,
    campaign: Campaign,
    actionDescriptors: CampaignActionDescriptor[],
    limitConfig?: CampaignActionLimitSettings
  ): Promise<AccountActionLimitStatus | null> {
    void campaign
    const entitlements = await loadCurrentUserEffectiveEntitlements()
    for (const action of actionDescriptors) {
      const limitStatus = await this.supabase.getAccountRateLimitStatus(
        account.id,
        action.code,
        action.name,
        this.getActionLimitConfig(action.code, limitConfig, account, entitlements)
      )
      if (!limitStatus.ok) return limitStatus
    }
    return null
  }

  private async resolveNewsfeedActionAvailability(
    account: AutoAccount,
    campaign: Campaign,
    actionDescriptors: CampaignActionDescriptor[],
    limitConfig?: CampaignActionLimitSettings
  ): Promise<NewsfeedActionAvailability> {
    const extra = campaign.extraSettings || {}
    const likeConfigured = this.isNewsfeedLikeConfigured(extra)
    const commentConfigured = this.isNewsfeedCommentConfigured(extra)
    const entitlements = await loadCurrentUserEffectiveEntitlements()
    let allowLike = likeConfigured
    let allowComment = commentConfigured
    const blockedReasons: string[] = []
    const checkedCodes = new Set(actionDescriptors.map(action => action.code))

    const checkOne = async (code: 'fb_like_post' | 'fb_comment', name: string): Promise<boolean> => {
      const limitStatus = await this.supabase.getAccountRateLimitStatus(
        account.id,
        code,
        name,
        this.getActionLimitConfig(code, limitConfig, account, entitlements)
      )
      if (limitStatus.ok) return true
      blockedReasons.push(await this.buildLimitPreflightNote(limitStatus))
      return false
    }

    if (likeConfigured && checkedCodes.has('fb_like_post')) {
      allowLike = await checkOne('fb_like_post', this.getAccountActionName('fb_like_post'))
    }
    if (commentConfigured && checkedCodes.has('fb_comment')) {
      allowComment = await checkOne('fb_comment', this.getAccountActionName('fb_comment'))
    }

    return {
      allowLike,
      allowComment,
      blockedReasons,
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
      const result = await this.zaloRuntime.checkSession(account.id)
      try {
        this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
      } catch {
        // Window may be closed
      }
      if (result.loggedIn) return true
    } catch (err) {
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
    if (campaign.status === 'chờ xử lý' && campaign.note === message) return
    await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
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
    else if (errorStep?.blockName && errorStep.blockName.startsWith('fb_newsfeed_comment')) actionCode = 'fb_comment'
    else if (errorStep?.blockName === 'fb_newsfeed_like_post') actionCode = 'fb_like_post'
    else if (errorStep?.blockName === 'fb_click_post_button' || errorStep?.blockName === 'fb_verify_group_post_form_closed') actionCode = this.getPostActionCode(campaign) || undefined
    else if (
      errorStep?.blockName === 'fb_page_post_api' ||
      errorStep?.blockName === 'fb_post_current_identity_ui' ||
      errorStep?.blockName === 'fb_switch_identity_by_name' ||
      errorStep?.blockName === 'fb_get_current_identity_name'
    ) actionCode = 'fb_post_page'
    else actionCode = this.getCampaignActionDescriptors(campaign)[0]?.code

    if (lowerMessage.includes('bạn đã đạt giới hạn về số tin nhắn đang chờ')) {
      return { errorCode: 'err_limit_waiting_message', actionCode, message }
    }
    if (campaign.actionId === GROUP_POST_ACTION_ID && lowerMessage.includes('giới hạn tần suất bạn đăng bài')) {
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
      const descriptors = this.getCampaignActionDescriptors(campaign)
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
        reason: message
      })
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

  /** Build variables object inject vào engine v2. */
  private buildVariablesV2(
    campaign: Campaign,
    detail: CampaignInputData | null,
    accountId: number,
    currentSourceLink: string,
    detailIndex: number,
    groupPostApproval?: {
      skipPostByKnownApproval?: boolean
      requiresPostApproval?: boolean | null
      source?: string
    }
  ): Record<string, unknown> {
    const extra = campaign.extraSettings || {}
    const canUseFindDataPostContentConditions =
      extra.isFindInPost === true || extra.isFindInComment === true || extra.isFindPostLink === true
    const canUseFindDataCommentContentConditions = extra.isFindInComment === true
    const canUseCommentSeedingPostContentConditions = campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID
    const canUsePostContentConditions = canUseFindDataPostContentConditions || canUseCommentSeedingPostContentConditions
    const validImages = this.resolveImageSelection(campaign.images || [], extra.imageOption || 'all', extra.randomImageCount || 3)
    const validCommentImages = (extra.commentImages || []).filter(fp => this.isUsableImagePath(fp)).slice(0, 1)
    const pagePostMode = extra.pagePostMode || 'api'
    const postWithBackground = extra.postWithBackground === true && (
      campaign.actionId === 'facebook_timeline_post' ||
      (campaign.actionId === PAGE_POST_ACTION_ID && pagePostMode === 'ui')
    )
    const validPostImages = postWithBackground ? [] : validImages

    // Comment iterations
    const enableComment = extra.enableComment ?? false
    const commentGroupMode = extra.commentGroupMode || 'all'
    const commentType = extra.commentType || 'own'
    const rawCommentCount = Math.floor(Number(extra.commentCount ?? 3))
    const commentCount = Number.isFinite(rawCommentCount) ? Math.max(1, rawCommentCount) : 3
    let commentIndices: number[] = []
    if (enableComment) {
      if (commentType === 'own') commentIndices = [1]
      else if (commentType === 'all') for (let i = 0; i < commentCount; i++) commentIndices.push(i + 1)
      else for (let i = 0; i < commentCount; i++) commentIndices.push(i + 2)
    }
    const postVariants = this.splitContentVariants(campaign.content)
    const commentVariants = this.splitContentVariants(extra.commentContent)
    const selectedPostContent = this.cycleVariant(postVariants, detailIndex)
    const storedCommentImageOption = String(extra.commentImageOption || 'none')
    const commentImageOption = storedCommentImageOption === 'none' ? 'none' : 'all'
    const selectedCommentImages = commentImageOption === 'all' ? validCommentImages : []
    const commentBatchCount = Math.max(commentIndices.length, Number(extra.postsPerTarget ?? commentCount), 1)
    const commentImageBatches = Array.from({ length: commentBatchCount }, () =>
      [...selectedCommentImages]
    )
    const commentIterations = commentIndices.map((position, k) => ({
      position,
      text: this.cycleVariant(commentVariants, k),
      images: commentImageBatches[k] || []
    }))

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignContent: selectedPostContent,
      originalCampaignContent: selectedPostContent,
      rewriteContentEachRun: extra.rewriteContentEachRun === true,
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
      commentImages: commentImageBatches[0] || [],
      commentImageBatches,
      commentImageOption,
      enablePostLike: extra.enablePostLike ?? false,
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
      // Timeline post extras
      sharePost: postWithBackground ? false : (extra.sharePost ?? false),
      postWithBackground,
      copyContentFromSource: postWithBackground ? false : (extra.copyContentFromSource ?? false),
      includeSourceImages: postWithBackground ? false : (extra.includeSourceImages ?? false),
      rewriteSourceContentWithAI: postWithBackground ? false : extra.rewriteSourceContentWithAI === true,
      sourceContentAiPrompt: postWithBackground ? '' : (extra.sourceContentAiPrompt || ''),
      postAsReels: postWithBackground ? false : (extra.postAsReels ?? false),
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
      ) ? true : (extra.enableMessage ?? false),
      enableAddFriend: (
        campaign.actionId === MESSAGE_FRIEND_ACTION_ID ||
        campaign.actionId === PAGE_INBOX_MESSAGE_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
      ) ? false : (extra.enableAddFriend ?? false),
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
      emailSubject: extra.emailSubject || '',
      emailBodyIsHtml: extra.emailBodyIsHtml === true,
      friendRequestMessage: extra.friendRequestMessage || '',
      enableZaloTag: extra.enableZaloTag === true,
      zaloTagId: extra.zaloTagId ?? null,
      zaloTagName: extra.zaloTagName || '',
      enableZaloAlias: extra.enableZaloAlias === true,
      zaloAlias: extra.zaloAliasTemplate || '',
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

    for (const step of steps) {
      const blockName = step.blockName || ''
      if (!blockName.startsWith('zalo_')) continue
      if (loggedBlocks.has(`${step.nodeId || ''}:${blockName}:${step.startedAt || ''}`)) continue
      loggedBlocks.add(`${step.nodeId || ''}:${blockName}:${step.startedAt || ''}`)

      const actionDetail = this.getZaloActionDetailFromStep(step)
      if (!actionDetail) continue

      if (actionDetail.resetInputToPending) {
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
    screenshotProgressLogs: BlockScreenshotProgressLog[] = []
  ): Promise<MilestoneSummary> {
    void overallSuccess
    const summary = this.createMilestoneSummary()
    const createCampaignDetail = async (action: Partial<CampaignDetail>) => {
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
      const findPhoneSmsTargetCampaignIds = Array.isArray(campaign.extraSettings?.findPhoneSmsTargetCampaignIds)
        ? campaign.extraSettings.findPhoneSmsTargetCampaignIds
        : []
      const findPhoneZaloWebTargetCampaignIds = Array.isArray(campaign.extraSettings?.findPhoneZaloWebTargetCampaignIds)
        ? campaign.extraSettings.findPhoneZaloWebTargetCampaignIds
        : []
      const findZaloGroupLinkWebTargetCampaignIds = Array.isArray(campaign.extraSettings?.findZaloGroupLinkWebTargetCampaignIds)
        ? campaign.extraSettings.findZaloGroupLinkWebTargetCampaignIds
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
            findPhoneSmsTargetCampaignIds,
            findPhoneZaloWebTargetCampaignIds,
            findZaloGroupLinkWebTargetCampaignIds,
            findPhoneAkaBizDesktopTargetCampaignIds,
            findZaloGroupLinkAkaBizDesktopTargetCampaignIds,
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
            ...this.getFindDataConfiguredTargetCampaignIds(findFacebookGroupCommentTargetCampaignIds, campaign.id)
          ].length > 0
        })
        await this.logFindDataDuplicatePushSummary(campaign, {
          label: 'SĐT',
          foundCount: phones.length,
          pushedCount: newPhonesForExternal.length,
          hasTarget: [
            ...this.getFindDataConfiguredTargetCampaignIds(findPhoneSmsTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findPhoneZaloWebTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findPhoneAkaBizDesktopTargetCampaignIds, campaign.id)
          ].length > 0
        })
        await this.logFindDataDuplicatePushSummary(campaign, {
          label: 'link group Zalo',
          foundCount: linkGroupZalos.length,
          pushedCount: newZaloGroupLinksForExternal.length,
          hasTarget: [
            ...this.getFindDataConfiguredTargetCampaignIds(findZaloGroupLinkWebTargetCampaignIds, campaign.id),
            ...this.getFindDataConfiguredTargetCampaignIds(findZaloGroupLinkAkaBizDesktopTargetCampaignIds, campaign.id)
          ].length > 0
        })
        await this.pushFoundUidsToTargetCampaigns(campaign, newUidsForInternal, groupMemberNameByUid)
        await this.pushFoundPostLinksToTargetCampaigns(campaign, newPostLinksForInternal)
        await this.pushFoundFacebookGroupsToTargetCampaigns(campaign, newFacebookGroupsForInternal)
        await this.pushFoundPhonesToSmsCampaigns(campaign, newPhonesForExternal, newPhoneProfilesForExternal)
        await this.pushFoundPhonesToZaloWebCampaigns(campaign, newPhonesForExternal, newPhoneProfilesForExternal)
        await this.pushFoundZaloGroupLinksToZaloWebCampaigns(campaign, newZaloGroupLinksForExternal)
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

    // Nhắn tin — phân biệt 3 status: thành công / thất bại (FB block) / lỗi (exception)
    const msgSteps = steps.filter(s =>
      (s.blockName === 'fb_send_message' || s.blockName === 'fb_send_page_inbox_message') &&
      (s.status === 'success' || s.status === 'error')
    )
    for (const s of msgSteps) {
      const out = (s.output as any) || {}
      const errMsg = out.error || s.error || 'Lỗi không xác định'
      const isPageInboxMessage = s.blockName === 'fb_send_page_inbox_message' || campaign.actionId === PAGE_INBOX_MESSAGE_ACTION_ID
      const actionName = isPageInboxMessage ? 'Nhắn tin khách inbox page' : 'Nhắn tin'
      const status: 'thành công' | 'thất bại' | 'lỗi' =
        s.status === 'error' ? 'lỗi'
        : out.ok === true ? 'thành công'
        : 'thất bại'
      const errorCode = status === 'lỗi' ? this.normalizeRuntimeError(campaign, [s], errMsg).errorCode : undefined
      try {
        await createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionCode: this.getMessageActionCode(campaign),
          actionName,
          status,
          errorCode,
          log: status === 'thành công' ? `${actionName} thành công đến ${inputDataName}` : `Lỗi ${actionName.toLowerCase()} đến ${inputDataName}: ${errMsg}`,
          data: status === 'thành công' ? undefined : { error: errMsg }
        })
        if (status === 'thành công') await this.logCampaignProgress(campaign.id, `💬 ${actionName} thành công đến "${inputDataName}"`)
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

        for (const uid of uids) {
          const name = uidNameByNormalizedUid.get(this.normalizeUidForCompare(uid)) || undefined
          await this.supabase.createCampaignInputData({
            campaignId: targetCampaign.id,
            name,
            uid,
            status: 'chờ xử lý',
            note: `Đã thêm từ chiến dịch "${sourceCampaign.name}"`
          })
        }

        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${uids.length} UID sang chiến dịch "${targetCampaign.name}"`)
        await this.logCampaignProgress(targetCampaign.id, `✅ Đã nhận ${uids.length} UID từ chiến dịch "${sourceCampaign.name}"`, { emitRealtime: false })
        if (targetCampaign.status === 'hoàn thành') {
          await this.updateCampaignAndBroadcast(targetCampaign.id, { status: 'chờ xử lý' })
        }
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

        for (const postLink of postLinks) {
          await this.supabase.createCampaignInputData({
            campaignId: targetCampaign.id,
            uid: postLink,
            status: 'chờ xử lý',
            note: `Đã thêm từ chiến dịch "${sourceCampaign.name}"`
          })
        }

        await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${postLinks.length} link bài post sang chiến dịch "${targetCampaign.name}"`)
        await this.logCampaignProgress(targetCampaign.id, `✅ Đã nhận ${postLinks.length} link bài post từ chiến dịch "${sourceCampaign.name}"`, { emitRealtime: false })
        if (targetCampaign.status === 'hoàn thành') {
          await this.updateCampaignAndBroadcast(targetCampaign.id, { status: 'chờ xử lý' })
        }
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

          for (const group of groups) {
            await this.supabase.createCampaignInputData({
              campaignId: targetCampaign.id,
              name: group.name || group.url,
              uid: group.url,
              status: 'chờ xử lý',
              note: `Đã thêm từ chiến dịch "${sourceCampaign.name}"`
            })
          }

          await this.logCampaignProgress(sourceCampaign.id, `✅ Đã đẩy ${groups.length} link group Facebook sang ${config.label} "${targetCampaign.name}"`)
          await this.logCampaignProgress(targetCampaign.id, `✅ Đã nhận ${groups.length} link group Facebook từ chiến dịch "${sourceCampaign.name}"`, { emitRealtime: false })
          if (targetCampaign.status === 'hoàn thành') {
            await this.updateCampaignAndBroadcast(targetCampaign.id, { status: 'chờ xử lý' })
          }
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

  private getPhoneProfileNameMap(profiles: FindDataPhoneProfile[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const profile of profiles) {
      const key = this.normalizeExternalValueForCompare(profile.phone)
      if (key && profile.name && !map.has(key)) map.set(key, profile.name)
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
    const contents = String(contentMessage || '')
      .split('|')
      .map(item => item.trim())
      .filter(Boolean)
    return contents.length > 0 ? contents : ['']
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
            content: contentSms[iContentSms++]
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
    const now = new Date()
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
      schedule: new Date().toISOString(),
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
    const now = new Date()
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
            note: `Dừng đột ngột: ${errMsg}`
          })
        }
      }
    } catch (recoverErr) {
      console.error('Failed to recover stuck campaign input data:', recoverErr)
    }
  }

  private sendLog(message: string, action?: CampaignLogAction): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_LOG, {
        timestamp: new Date().toISOString(),
        message,
        ...(action ? { action } : {})
      })
    } catch {
      // Window may be closed
    }
  }

  private async logCampaignProgress(
    campaignId: number,
    message: string,
    options: { emitRealtime?: boolean; realtimeAction?: CampaignLogAction; realtimeMessage?: string } = {}
  ): Promise<void> {
    try {
      const updated = await this.supabase.appendCampaignLog(campaignId, message)
      this.broadcastCampaignUpdate(updated)
    } catch (err) {
      console.error('Failed append campaign progress log:', err)
    }
    if (options.emitRealtime !== false) {
      this.sendLog(options.realtimeMessage ?? message, options.realtimeAction)
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

    if (policy.updateLoginStatus) {
      await this.updateAccountAndBroadcast(account.id, { loginStatus: policy.updateLoginStatus })
      this.zaloRuntime?.invalidateAccount(account.id)
      stopAfterTarget = true
    }
    if (policy.updateStatusAccount) {
      await this.updateAccountAndBroadcast(account.id, { status: policy.updateStatusAccount })
      stopAfterTarget = true
    }
    if (policy.disableActionCodes.length > 0) {
      await this.supabase.disableAccountActions(account.id, policy.disableActionCodes, policy.timeDisableActions, {
        errorCode: policy.errorCode,
        reason: message
      })
      stopAfterTarget = true
    }
    if (policy.updateStatusCampaign) {
      await this.updateCampaignAndBroadcast(campaign.id, {
        status: policy.updateStatusCampaign,
        note: message
      })
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
      case 'zalo_tag_contact':
        return 'updateLabels'
      case 'zalo_change_alias':
        return 'changeFriendAlias'
      default:
        return actionCode || 'unknown'
    }
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
    const rawMessage = this.getZaloErrorMessage(err)
    const zaloCode = this.getZaloErrorCode(err)
    const policy = await this.getZaloPolicyByErrorCode(zaloCode)
    const log = this.renderZaloPolicyLog(policy, rawMessage, {
      actionName,
      action: actionName,
      actionCode
    }, zaloCode)
    const sideEffects = await this.applyZaloPolicySideEffects(account, campaign, policy, log)
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
    const detail: ZaloActionDetailOutput = {
      createDetail: Boolean(detailStatus),
      actionCode,
      actionName,
      status: detailStatus || undefined,
      errorCode: policy?.errorCode || null,
      log,
      countsTowardLimit: policy?.countsTowardLimit ?? true,
      countsTowardBadTarget: policy?.countsTowardBadTarget ?? true,
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
    const log = this.renderZaloPolicyLog(policy, rawMessage, {
      actionName,
      action: actionName,
      actionCode
    }, zaloCode)
    const sideEffects = await this.applyZaloPolicySideEffects(account, campaign, policy, log)
    const detailStatus = this.normalizeZaloDetailStatus(policy?.detailStatus)
    return {
      createDetail: Boolean(detailStatus),
      actionCode,
      actionName,
      status: detailStatus || undefined,
      errorCode: policy?.errorCode || null,
      log,
      countsTowardLimit: policy?.countsTowardLimit ?? true,
      countsTowardBadTarget: policy?.countsTowardBadTarget ?? true,
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
      countsTowardBadTarget: false
    }
  }

  private getZaloTargetLabel(target: ZaloResolvedTarget | null | undefined): string {
    return target?.displayName || target?.originalName || target?.phone || target?.uid || 'target'
  }

  private renderZaloTemplate(
    template: string | undefined | null,
    inputData: Record<string, unknown> | undefined,
    target?: ZaloResolvedTarget | null
  ): string {
    const raw = String(template || '')
    if (!raw) return ''
    const now = new Date()
    const formatDate = (format: string, offsetDays = 0): string => {
      const date = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000)
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
    const renderPhone = (): string => this.normalizeVietnamMobilePhone(this.firstNonEmptyString(target?.phone, input.phone))
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
      const user = await this.zaloRuntime.findUserByPhone(account.id, phone)
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
          { phone }
        )
        return { ok: true, zaloTarget: null, detail }
      }

      const target = this.normalizeZaloTarget(phone, user)
      await this.upsertZaloFoundUserContact(account, user, campaign.actionId)
      await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person')
      const inputDataId = Number((options.inputData as Record<string, unknown> | undefined)?.id)
      if (Number.isFinite(inputDataId) && inputDataId > 0) {
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
          data: { phone, target }
        })
      }
    } catch (err) {
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
    await this.upsertZaloResolvedProfileTarget(account, target, campaign.actionId)
    await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person')

    return { ok: true, zaloTarget: target }
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
    await this.upsertZaloResolvedProfileTarget(account, target, campaign.actionId)
    await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person')

    return { ok: true, zaloTarget: target }
  }

  private async zaloSendPhoneMessage(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloSendPhoneMessageOptions
  ): Promise<ZaloActionHelperResult> {
    if (!options.enabled) return { ok: true, skipped: true, zaloTarget: options.target ?? null }
    if (!this.zaloRuntime) throw new Error('Zalo runtime chưa sẵn sàng')
    const target = options.target
    if (!target?.uid) return { ok: true, skipped: true }
    const attachments = (Array.isArray(options.attachments) ? options.attachments : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    const message = this.renderZaloTemplate(options.message, options.inputData, target)
    const actionCode = 'zalo_message_stranger'
    const actionName = 'Nhắn tin người lạ'

    try {
      const response = await this.zaloRuntime.sendMessageToUser(account.id, target.uid, message, attachments)
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          log: `Đã gửi tin nhắn đến ${this.getZaloTargetLabel(target)}`,
          data: { target, message, attachments, response: response as Record<string, unknown> | undefined }
        })
      }
    } catch (err) {
      return {
        ok: false,
        zaloTarget: target,
        detail: await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, { target, message, attachments, inputData: options.inputData })
      }
    }
  }

  private async zaloSendFriendMessage(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloSendDirectMessageOptions
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
    await this.upsertZaloResolvedProfileTarget(account, target, campaign.actionId)
    await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person')
    const attachments = (Array.isArray(options.attachments) ? options.attachments : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
    const message = this.renderZaloTemplate(options.message, options.inputData, target)

    try {
      const response = await this.zaloRuntime.sendMessageToUser(account.id, target.uid, message, attachments)
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          log: `Đã gửi tin nhắn đến ${this.getZaloTargetLabel(target)}`,
          data: { target, message, attachments, response: response as Record<string, unknown> | undefined }
        })
      }
    } catch (err) {
      return {
        ok: false,
        zaloTarget: target,
        detail: await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, { target, message, attachments, inputData: options.inputData })
      }
    }
  }

  private async zaloSendGroupMessage(
    account: AutoAccount,
    campaign: Campaign,
    options: ZaloSendDirectMessageOptions
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
    const message = this.renderZaloTemplate(options.message, options.inputData, target)

    try {
      const response = await this.zaloRuntime.sendMessageToGroup(account.id, groupId, message, attachments)
      await this.applyAkaBizTagsToZaloTarget(account, campaign, target, 'group')
      return {
        ok: true,
        zaloTarget: target,
        detail: this.createZaloSuccessDetail({
          actionCode,
          actionName,
          log: `Đã gửi tin nhắn vào group ${this.getZaloTargetLabel(target)}`,
          data: { target, groupId, message, attachments, response: response as Record<string, unknown> | undefined }
        })
      }
    } catch (err) {
      return {
        ok: false,
        zaloTarget: target,
        detail: await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, { target, groupId, message, attachments, inputData: options.inputData })
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
    const message = this.renderZaloTemplate(options.message, options.inputData, target).slice(0, 150)

    try {
      const response = await this.zaloRuntime.sendFriendRequestToUser(account.id, target.uid, message)
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
      const detail = await this.createZaloErrorDetail(account, campaign, err, actionCode, actionName, { target, message, inputData: options.inputData })
      const detailStatus = String(detail.status || '').toLocaleLowerCase('vi-VN')
      return {
        ok: Boolean(detail.status) && detailStatus !== 'thất bại' && detailStatus !== 'lỗi',
        zaloTarget: target,
        detail
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
    const alias = this.renderZaloTemplate(options.alias, options.inputData, target).trim()
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
      zaloFindPhoneUser: (options) => this.zaloFindPhoneUser(account, campaign, options),
      zaloResolveGroupMemberTarget: (options) => this.zaloResolveGroupMemberTarget(account, campaign, options),
      zaloResolveRemarketingCustomerTarget: (options) => this.zaloResolveRemarketingCustomerTarget(account, campaign, options),
      zaloSendPhoneMessage: (options) => this.zaloSendPhoneMessage(account, campaign, options),
      zaloSendFriendMessage: (options) => this.zaloSendFriendMessage(account, campaign, options),
      zaloSendGroupMessage: (options) => this.zaloSendGroupMessage(account, campaign, options),
      zaloSendPhoneFriendRequest: (options) => this.zaloSendPhoneFriendRequest(account, campaign, options),
      zaloApplyContactTag: (options) => this.zaloApplyContactTag(account, campaign, options),
      zaloChangeContactAlias: (options) => this.zaloChangeContactAlias(account, campaign, options),
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

    const subject = this.renderZaloTemplate(options.subject, options.inputData).trim()
    const body = this.renderZaloTemplate(options.body, options.inputData)
    const attachments = (Array.isArray(options.attachments) ? options.attachments : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)

    try {
      const result = await this.emailRuntime.sendEmail(account.id, {
        to,
        subject,
        body,
        isHtml: options.isHtml === true,
        attachments
      })
      return {
        ok: true,
        detail: {
          createDetail: true,
          actionCode,
          actionName,
          status: 'thành công',
          log: `Đã gửi email đến ${to}`,
          data: { to, subject, messageId: result.messageId },
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
    return this.getCampaignActionDescriptors(campaign)[0]?.name || 'Hành động'
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

  /**
   * Cập nhật campaign xong push luôn ra renderer để UI hiện status realtime.
   */
  private async updateCampaignAndBroadcast(id: number, updates: Partial<Campaign>): Promise<Campaign> {
    const updated = await this.supabase.updateCampaign(id, updates)
    this.broadcastCampaignUpdate(updated)
    return updated
  }

  private broadcastCampaignUpdate(campaign: Campaign): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, campaign)
    } catch {
      // Window may be closed
    }
  }

  /**
   * Cập nhật account xong push event để panel tài khoản reload realtime.
   */
  private async updateAccountAndBroadcast(id: number, updates: Partial<AutoAccount>): Promise<AutoAccount> {
    const updated = await this.supabase.updateAccount(id, updates)
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
    } catch {
      // Window may be closed
    }
    return updated
  }

  private async releaseRunningAccount(accountId: number): Promise<void> {
    const account = await this.supabase.getAccount(accountId)
    if (!account || account.status !== 'đang chạy') return
    await this.updateAccountAndBroadcast(accountId, { status: 'chờ xử lý' })
  }

  private resolveImageSelection(
    availableImages: string[],
    option: 'none' | 'all' | 'random',
    randomCount: number
  ): string[] {
    const validImages = availableImages.filter(fp => this.isUsableImagePath(fp))
    return this.selectImagesFromValid(validImages, option, randomCount)
  }

  private selectImagesFromValid(
    validImages: string[],
    option: 'none' | 'all' | 'random',
    randomCount: number
  ): string[] {
    if (option === 'none') return []
    if (option === 'all') return [...validImages]
    const count = Math.max(1, randomCount || 1)
    return [...validImages].sort(() => 0.5 - Math.random()).slice(0, count)
  }

  private isUsableImagePath(path: string): boolean {
    return typeof path === 'string' && (path.startsWith('data:') || existsSync(path))
  }

  /**
   * Tách nội dung theo dấu `|` thành mảng biến thể (đã trim, bỏ rỗng).
   * Nếu input rỗng/null → `[]`; nếu không có dấu `|` → `[raw]`.
   * Dùng cho cả `content` và `commentContent`.
   */
  private splitContentVariants(raw: string | undefined | null): string[] {
    if (!raw) return []
    if (!raw.includes('|')) return [raw]
    return raw.split('|').map(s => s.trim()).filter(s => s.length > 0)
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
}
