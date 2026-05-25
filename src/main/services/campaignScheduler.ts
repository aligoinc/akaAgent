import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { AccountActionLimitStatus, ActionLimitConfig, AkaBizIntegrationInfo, AutoAccount, AutoErrorPolicy, IPC_EVENTS, Campaign, CampaignAction, CampaignActionLimitSettings, CampaignInputData } from '../../shared/types'
import { IPC_EVENTS_V2, RunStepV2 } from '../../shared/v2Types'
import { PageController, PageControllerRegistry } from '../v2/runtime/pageController'
import { WorkflowEngineV2 } from '../v2/runtime/workflowEngine'
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

interface AutomationPageRef {
  page: PageController
  source: 'visible' | 'background'
}

interface CampaignActionDescriptor {
  code: string
  name: string
}

interface RuntimeErrorResult {
  triggered: boolean
  message: string
  policy?: AutoErrorPolicy
}

interface SuggestedFriendProfile {
  name: string
  uid: string
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
}

interface FindDataUniqueCounts {
  phones: number
  linkGroupZalos: number
  uids: number
  postLinks: number
  groupMembers: number
}

interface FindDataGroupMember {
  uid: string
  name: string
  url: string
}

interface FindDataPreviousValues {
  phones: Set<string>
  linkGroupZalos: Set<string>
  uids: Set<string>
  postLinks: Set<string>
  detailCount: number
}

type FindDataTargetCampaignField = 'findUidTargetCampaignIds' | 'findPostLinkTargetCampaignIds'

const FIND_DATA_GROUP_ACTION_ID = 'facebook_find_data_group'
const COMMENT_SEEDING_FEED_ACTION_ID = 'facebook_comment_seeding'
const COMMENT_SEEDING_POST_ACTION_ID = 'facebook_comment_seeding_post'
const MESSAGE_FRIEND_ACTION_ID = 'facebook_message_friend'
const MESSAGE_UID_ACTION_ID = 'facebook_message_uid'
const PAGE_POST_ACTION_ID = 'facebook_page_post'
const DEFAULT_RATE_LIMIT_MINUTES = 65
const CAMPAIGN_PAUSE_PENDING_NOTE = 'Đang chờ tạm dừng'
const FIND_DATA_SOURCE_WAIT_NOTE = 'Đang chờ data từ chiến dịch tìm data'

/**
 * Campaign scheduler: every 30s, scan eligible accounts for due campaigns and
 * run their associated workflow v2 against the account browser session.
 *
 * Engine v2 is the only execution path. Each campaign action template
 * (`auto_campaign_actions.workflow_id`) points to a workflow that already
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
  private running = false
  private dispatching = false
  private activeAccountRuns = new Set<number>()
  private activeV2Aborts = new Map<number, AbortController>()
  private pauseRequests = new Set<number>()
  private backgroundPages = new BackgroundPageManager()
  private backgroundPreviewTimers = new Map<string, ReturnType<typeof setInterval>>()
  private backgroundPreviewCapturing = new Set<string>()

  constructor(supabase: SupabaseService, webviewRegistry: WebviewRegistry, mainWindow: BrowserWindow) {
    this.supabase = supabase
    this.webviewRegistry = webviewRegistry
    this.mainWindow = mainWindow
  }

  setPageRegistry(reg: PageControllerRegistry): void {
    this.pageRegistry = reg
  }

  private isCommentSeedingCampaign(actionId: string): boolean {
    return actionId === COMMENT_SEEDING_FEED_ACTION_ID || actionId === COMMENT_SEEDING_POST_ACTION_ID
  }

  private isCommentSeedingPostCampaign(actionId: string): boolean {
    return actionId === COMMENT_SEEDING_POST_ACTION_ID
  }

  private getFindDataTargetCampaignField(campaign: Campaign): FindDataTargetCampaignField | null {
    if (campaign.actionId === MESSAGE_UID_ACTION_ID) return 'findUidTargetCampaignIds'
    if (campaign.actionId === COMMENT_SEEDING_POST_ACTION_ID) return 'findPostLinkTargetCampaignIds'
    return null
  }

  private isMatchingFindDataSource(sourceCampaign: Campaign, targetField: FindDataTargetCampaignField): boolean {
    if (sourceCampaign.actionId !== FIND_DATA_GROUP_ACTION_ID || sourceCampaign.isDelete) return false
    if (targetField === 'findUidTargetCampaignIds') return sourceCampaign.extraSettings?.isFindUid === true
    return sourceCampaign.extraSettings?.isFindPostLink === true
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.intervalId = setInterval(() => this.tick(), 30000)
    this.sendLog('📋 Scheduler đã bắt đầu. Kiểm tra mỗi 30 giây.')
    // Run immediately on start
    this.tick()
  }

  stop(): void {
    this.running = false
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
      return await this.updateCampaignAndBroadcast(campaignId, { note: CAMPAIGN_PAUSE_PENDING_NOTE })
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

        // Check browser webview is registered for this account
        if (!this.webviewRegistry.isRegistered(account.id)) {
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

    if (await this.handleFindDataRerunAfterCompletion(campaign, now)) {
      return
    }

    await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
    await this.logCampaignProgress(campaign.id, `✅ Hoàn thành chiến dịch "${campaign.name}"`)
  }

  private async handleFindDataRerunAfterCompletion(campaign: Campaign, now: Date): Promise<boolean> {
    if (campaign.actionId !== FIND_DATA_GROUP_ACTION_ID || campaign.extraSettings?.findDataRerunEnabled !== true) {
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

      const action = await this.supabase.getCampaignAction(campaign.actionId)
      if (!action) {
        await this.updateCampaignPreflightNote(campaign, 'Không tìm thấy loại chiến dịch')
        return
      }

      if (!action.workflowId) {
        await this.updateCampaignPreflightNote(campaign, 'Loại chiến dịch chưa được liên kết workflow')
        return
      }

      const actionDescriptors = this.getCampaignActionDescriptors(campaign, action)
      const preflightActionDescriptors = campaign.actionId === 'facebook_group_post' && campaign.extraSettings?.skipPostIfGroupRequiresApproval === true
        ? actionDescriptors.filter(action => action.code !== 'fb_post_group')
        : actionDescriptors
      const preflightLimit = await this.checkActionLimits(
        account.id,
        campaign,
        preflightActionDescriptors,
        campaign.extraSettings?.actionLimits
      )
      if (preflightLimit && !preflightLimit.ok) {
        await this.updateCampaignPreflightNote(campaign, await this.buildLimitPreflightNote(preflightLimit))
        return
      }

      await this.updateCampaignAndBroadcast(campaign.id, { status: 'đang chạy', note: null })
      await this.logCampaignProgress(campaign.id, `🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${account.name}"`)

      await this.updateAccountAndBroadcast(account.id, { status: 'đang chạy' })

      await this.executeCampaignV2(account, campaign, action.workflowId, actionDescriptors)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.recoverStuckCampaignInputData(campaign.id, errMsg)
      await this.handleRuntimeError(account, campaign, 'err_undefined', undefined, { message: errMsg })
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

    // Shuffle group list nếu enabled
    if (campaign.extraSettings?.shuffleGroupList && details.length > 1 && campaign.actionId === 'facebook_group_post') {
      for (let i = details.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[details[i], details[j]] = [details[j], details[i]]
      }
      await this.logCampaignProgress(campaign.id, `🔀 Đã xáo trộn danh sách ${details.length} group`)
    }

    const shouldRotateSourceLink =
      (campaign.actionId === 'facebook_timeline_post' && (extra.copyContentFromSource === true || extra.sharePost === true)) ||
      (campaign.actionId === PAGE_POST_ACTION_ID && extra.copyContentFromSource === true) ||
      (campaign.actionId === 'facebook_group_post' && extra.copyContentFromSource === true)
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

      const groupPostApproval = await this.resolveGroupPostApprovalForTarget(account.id, campaign, detail)
      const targetActionDescriptors = groupPostApproval.skipPostByKnownApproval
        ? actionDescriptors.filter(action => action.code !== 'fb_post_group')
        : actionDescriptors

      // Check action disable/rate limit immediately before each target.
      try {
        const limitStatus = await this.checkActionLimits(account.id, campaign, targetActionDescriptors, limitConfig)
        if (limitStatus && !limitStatus.ok) {
          stoppedBeforeCompletion = true
          await this.handleLimitStatus(account, campaign, limitStatus)
          break
        }
      } catch (err) {
        console.error('Rate limit check error:', err)
      }

      const automationPage = this.getAutomationPage(account, campaign.id)
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
        const targetLabel = detail ? ` cho "${detail.name || detail.uid || 'N/A'}"` : ''
        await this.logCampaignProgress(campaign.id, `🔗 Link nguồn #${sourceIdx + 1}/${sourceLinks.length}${targetLabel}: ${currentSourceLink}`)
      }

      // Build variables
      const variables = this.buildVariablesV2(campaign, detail, account.id, currentSourceLink, i, groupPostApproval)

      // Update detail status running
      if (detail) {
        await this.supabase.updateCampaignInputData(detail.id, {
          status: 'đang chạy',
          dateAction: new Date().toISOString()
        })
        const inputDataName = detail.name || detail.uid || 'N/A'
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
      if (automationPage.source === 'background') {
        this.startBackgroundPreview(account.id, campaign.id, page)
      }
      try {
        const result = await this.engineV2.run(workflowId, variables, page, {
          accountId: account.id,
          campaignId: campaign.id,
          campaignInputDataId: detail?.id,
          signal: abort.signal,
          persist: true,
          onStepProgress: (step: RunStepV2) => {
            try { this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_PROGRESS, { runKey: `campaign-${campaign.id}`, step }) } catch {}
          },
          onLog: (entry) => {
            try { this.mainWindow.webContents.send(IPC_EVENTS_V2.RUN_LOG, { runKey: `campaign-${campaign.id}`, ...entry }) } catch {}
          }
        })

        // Per-milestone logging — scan steps theo block_name
        await this.logMilestonesV2(campaign, detail, account.id, result.steps, result.status === 'completed')

        const campaignPauseRequested = this.isCampaignPauseRequested(campaign.id)
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
            await this.supabase.updateCampaignInputData(detail.id, { status: 'hoàn thành' })
            await this.logCampaignProgress(campaign.id, `✅ Hoàn thành "${detail.name || detail.uid || 'N/A'}"`)
          } else {
            // campaign_input_data enum không có 'lỗi' — set 'hoàn thành' + note (chi tiết lỗi đã ở campaign_details)
            const errMsg = result.error || 'Lỗi không xác định'
            await this.supabase.updateCampaignInputData(detail.id, { status: 'hoàn thành', note: errMsg })
            await this.logCampaignProgress(campaign.id, `❌ Lỗi "${detail.name || detail.uid || 'N/A'}": ${errMsg}`)
          }
        }

        if (!accountStopReason && result.status !== 'completed') {
          const runtimeError = this.normalizeRuntimeError(campaign, result.steps, result.error)
          const handled = await this.handleRuntimeError(account, campaign, runtimeError.errorCode, runtimeError.actionCode, {
            message: runtimeError.message
          })
          runtimeStopTriggered = handled.triggered
          shouldStopAfterTarget = handled.triggered
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
        let runtimeStopTriggered = false
        if (detail) {
          await this.supabase.updateCampaignInputData(detail.id, {
            status: accountStopReason ? 'chờ xử lý' : 'hoàn thành',
            note: accountStopReason || errMsg
          })
        }
        if (accountStopReason) {
          await this.stopCampaignForAccountCondition(account, campaign, accountStopReason)
          shouldStopAfterTarget = true
        } else {
          const runtimeError = this.normalizeRuntimeError(campaign, [], errMsg)
          const handled = await this.handleRuntimeError(account, campaign, runtimeError.errorCode, runtimeError.actionCode, {
            message: runtimeError.message
          })
          runtimeStopTriggered = handled.triggered
          shouldStopAfterTarget = handled.triggered
        }
        await this.logCampaignProgress(campaign.id, `❌ Lỗi engine v2 "${campaign.name}": ${errMsg}`)
        if (campaignPauseRequested) {
          if (!accountStopReason && !runtimeStopTriggered) {
            shouldCompletePauseAfterTarget = true
            shouldStopAfterTarget = true
          } else {
            this.pauseRequests.delete(campaign.id)
          }
        }
      } finally {
        clearInterval(accountGuard)
        if (automationPage.source === 'background') {
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
        const sleepTime = extra.actionLimits?.sleepBetweenActions ?? campaign.timeSleepBetween2 ?? 0
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

  private shouldUseSuggestedFriends(campaign: Campaign): boolean {
    return campaign.actionId === MESSAGE_UID_ACTION_ID && campaign.extraSettings?.useSuggestedFriends === true
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

    const automationPage = this.getAutomationPage(account, campaign.id)
    const page = automationPage.page
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
    if (campaignAction && Array.isArray(campaignAction.limitCheckActionCodes)) {
      return this.filterCampaignActionDescriptors(
        campaign,
        this.normalizeActionDescriptors(campaignAction.limitCheckActionCodes)
      )
    }

    const extra = campaign.extraSettings || {}
    const actions: CampaignActionDescriptor[] = []

    switch (campaign.actionId) {
      case 'facebook_group_post':
        actions.push({ code: 'fb_post_group', name: 'Đăng bài group' })
        if (extra.enableComment) actions.push({ code: 'fb_comment', name: 'Comment' })
        if (extra.enablePostLike) actions.push({ code: 'fb_like_post', name: 'Like post' })
        break
      case 'facebook_timeline_post':
        actions.push({ code: 'fb_post_my_profile', name: 'Đăng bài trang cá nhân' })
        if (extra.enableComment) actions.push({ code: 'fb_comment', name: 'Comment' })
        if (extra.enablePostLike) actions.push({ code: 'fb_like_post', name: 'Like post' })
        break
      case PAGE_POST_ACTION_ID:
        actions.push({ code: 'fb_post_page', name: 'Đăng bài fanpage' })
        break
      case MESSAGE_FRIEND_ACTION_ID:
        actions.push({ code: 'fb_message_friend', name: 'Nhắn tin bạn bè' })
        break
      case MESSAGE_UID_ACTION_ID:
        if (extra.enableMessage !== false) actions.push({ code: 'fb_message_stranger', name: 'Nhắn tin người lạ' })
        if (extra.enableAddFriend) actions.push({ code: 'fb_add_friend', name: 'Kết bạn' })
        break
      case COMMENT_SEEDING_FEED_ACTION_ID:
      case COMMENT_SEEDING_POST_ACTION_ID:
        actions.push({ code: 'fb_comment', name: 'Comment' })
        if (extra.enablePostLike) actions.push({ code: 'fb_like_post', name: 'Like post' })
        break
    }

    return this.filterCampaignActionDescriptors(campaign, this.dedupeActionDescriptors(actions))
  }

  private filterCampaignActionDescriptors(
    campaign: Campaign,
    actions: CampaignActionDescriptor[]
  ): CampaignActionDescriptor[] {
    const configuredCodes = campaign.extraSettings?.actionLimits?.enabledActionCodes
    const configuredSet = Array.isArray(configuredCodes) ? new Set(configuredCodes) : null
    return actions.filter(action => {
      if (configuredSet && !configuredSet.has(action.code)) return false
      return this.isActionCheckEnabledForCampaign(campaign, action.code)
    })
  }

  private isActionCheckEnabledForCampaign(campaign: Campaign, actionCode: string): boolean {
    const extra = campaign.extraSettings || {}
    switch (actionCode) {
      case 'fb_message_friend':
        return true
      case 'fb_message_stranger':
        return campaign.actionId !== MESSAGE_UID_ACTION_ID || extra.enableMessage !== false
      case 'fb_add_friend':
        if (campaign.actionId === MESSAGE_FRIEND_ACTION_ID) return false
        return campaign.actionId !== MESSAGE_UID_ACTION_ID || extra.enableAddFriend === true
      case 'fb_comment':
        if (this.isCommentSeedingCampaign(campaign.actionId)) return true
        return extra.enableComment === true
      case 'fb_like_post':
        return extra.enablePostLike === true
      default:
        return true
    }
  }

  private normalizeActionDescriptors(actionCodes: string[]): CampaignActionDescriptor[] {
    return this.dedupeActionDescriptors(actionCodes.map(code => {
      const normalizedCode = code.trim()
      return { code: normalizedCode, name: this.getAccountActionName(normalizedCode) }
    }).filter(action => action.code))
  }

  private dedupeActionDescriptors(actions: CampaignActionDescriptor[]): CampaignActionDescriptor[] {
    const seen = new Set<string>()
    return actions.filter(action => {
      if (seen.has(action.code)) return false
      seen.add(action.code)
      return true
    })
  }

  private getAccountActionName(actionCode: string): string {
    switch (actionCode) {
      case 'fb_post_group': return 'Đăng bài group'
      case 'fb_post_my_profile': return 'Đăng bài trang cá nhân'
      case 'fb_post_page': return 'Đăng bài fanpage'
      case 'fb_comment': return 'Comment'
      case 'fb_message_stranger': return 'Nhắn tin người lạ'
      case 'fb_message_friend': return 'Nhắn tin bạn bè'
      case 'fb_add_friend': return 'Kết bạn'
      case 'fb_like_post': return 'Like post'
      default: return actionCode
    }
  }

  private getPostActionCode(campaign: Campaign): string | null {
    if (campaign.actionId === 'facebook_group_post') return 'fb_post_group'
    if (campaign.actionId === 'facebook_timeline_post') return 'fb_post_my_profile'
    if (campaign.actionId === PAGE_POST_ACTION_ID) return 'fb_post_page'
    return null
  }

  private getMessageActionCode(campaign: Campaign): string {
    if (campaign.actionId === MESSAGE_UID_ACTION_ID) return 'fb_message_stranger'
    return 'fb_message_friend'
  }

  private async checkActionLimits(
    accountId: number,
    campaign: Campaign,
    actionDescriptors: CampaignActionDescriptor[],
    limitConfig?: CampaignActionLimitSettings
  ): Promise<AccountActionLimitStatus | null> {
    void campaign
    for (const action of actionDescriptors) {
      const limitStatus = await this.supabase.getAccountRateLimitStatus(
        accountId,
        action.code,
        action.name,
        this.getActionLimitConfig(action.code, limitConfig)
      )
      if (!limitStatus.ok) return limitStatus
    }
    return null
  }

  private getActionLimitConfig(
    actionCode: string,
    limitConfig?: CampaignActionLimitSettings
  ): ActionLimitConfig | undefined {
    const byActionCode = limitConfig?.byActionCode?.[actionCode]
    if (byActionCode) return byActionCode
    if (!limitConfig) return undefined
    return {
      dailyLimit: limitConfig.dailyLimit,
      rateLimitCount: limitConfig.rateLimitCount,
      rateLimitMinutes: limitConfig.rateLimitMinutes
    }
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
    return {
      x: String(limitStatus.currentCount ?? limitStatus.limit ?? ''),
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

    if (errorStep?.blockName === 'fb_send_message') actionCode = this.getMessageActionCode(campaign)
    else if (errorStep?.blockName === 'fb_add_friend') actionCode = 'fb_add_friend'
    else if (errorStep?.blockName === 'fb_comment_at_position' || errorStep?.blockName === 'fb_comment_current_post') actionCode = 'fb_comment'
    else if (errorStep?.blockName === 'fb_click_like_current_post') actionCode = 'fb_like_post'
    else if (errorStep?.blockName === 'fb_click_post_button') actionCode = this.getPostActionCode(campaign) || undefined
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

    return { errorCode: 'err_undefined', actionCode, message }
  }

  private async handleRuntimeError(
    account: AutoAccount,
    campaign: Campaign,
    errorCode: string,
    actionCode: string | undefined,
    replacements: Record<string, string | undefined> = {}
  ): Promise<RuntimeErrorResult> {
    const policy = await this.supabase.getErrorPolicy(errorCode) || await this.supabase.getErrorPolicy('err_undefined')
    if (!policy) {
      const message = replacements.message || 'Có lỗi xảy ra'
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
      return { triggered: true, message }
    }

    const threshold = policy.countConsecutiveErrors && policy.countConsecutiveErrors > 0
      ? policy.countConsecutiveErrors
      : null
    if (threshold) {
      const count = await this.supabase.incrementConsecutiveError(account.id, actionCode, policy.errorCode)
      if (count < threshold) {
        const notice = this.addActionContextToMessage(
          this.renderPolicyMessage(policy.notiRunningProcess, replacements) || policy.errorName,
          replacements
        )
        return {
          triggered: false,
          message: `${notice} (${count}/${threshold})`,
          policy
        }
      }
    }

    const message = this.addActionContextToMessage(
      this.renderPolicyMessage(policy.notiCampaign || policy.notiRunningProcess, replacements)
      || replacements.message
      || policy.errorDesc
      || policy.errorName,
      replacements
    )
    const campaignStatus = policy.updateStatusCampaign || 'chờ xử lý'

    if (policy.updateStatusAccount) {
      await this.updateAccountAndBroadcast(account.id, { status: policy.updateStatusAccount })
    }
    if (policy.disableActionCodes.length > 0) {
      await this.supabase.disableAccountActions(account.id, policy.disableActionCodes, policy.timeDisableActions)
    }

    await this.updateCampaignAndBroadcast(campaign.id, { status: campaignStatus, note: message })
    await this.logCampaignProgress(campaign.id, `⚠️ Dừng chiến dịch "${campaign.name}": ${message}`)

    return { triggered: true, message, policy }
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
    const canUseFindDataContentConditions = extra.isFindInPost === true || extra.isFindInComment === true
    const validImages = this.resolveImageSelection(campaign.images || [], extra.imageOption || 'all', extra.randomImageCount || 3)
    const validCommentImages = (extra.commentImages || []).filter(fp => this.isUsableImagePath(fp)).slice(0, 1)

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
      images: validImages,
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
      keywordFilter: extra.postKeywordFilter ?? extra.keywordFilter ?? '',
      // Group post extras
      leaveGroupOnPendingApproval: extra.leaveGroupOnPendingApproval ?? false,
      autoJoinGroupAfterPost: extra.autoJoinGroupAfterPost ?? false,
      shuffleGroupList: extra.shuffleGroupList ?? false,
      skipPostIfGroupRequiresApproval: extra.skipPostIfGroupRequiresApproval ?? false,
      skipGroupPostByKnownApproval: groupPostApproval?.skipPostByKnownApproval === true,
      groupPostRequiresPostApproval: groupPostApproval?.requiresPostApproval ?? null,
      groupPostApprovalSource: groupPostApproval?.source || '',
      // Timeline post extras
      sharePost: extra.sharePost ?? false,
      copyContentFromSource: extra.copyContentFromSource ?? false,
      includeSourceImages: extra.includeSourceImages ?? false,
      rewriteSourceContentWithAI: extra.rewriteSourceContentWithAI === true,
      sourceContentAiPrompt: extra.sourceContentAiPrompt || '',
      postAsReels: extra.postAsReels ?? false,
      sourceLink: currentSourceLink,
      targetUrl: detail?.uid || currentSourceLink,
      videoPath: validImages[0] || '',
      // Page post extras
      pagePostMode: extra.pagePostMode || 'api',
      pageUid: detail?.uid || '',
      pageName: detail?.name || '',
      businessUrl: 'https://business.facebook.com/content_management',
      // Message extras
      enableMessage: campaign.actionId === MESSAGE_FRIEND_ACTION_ID ? true : (extra.enableMessage ?? false),
      enableAddFriend: campaign.actionId === MESSAGE_FRIEND_ACTION_ID ? false : (extra.enableAddFriend ?? false),
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
      isFindByKeywords: canUseFindDataContentConditions ? (extra.isFindByKeywords ?? false) : false,
      keywords: canUseFindDataContentConditions ? (extra.keywords ?? '') : '',
      isFindByContentAI: canUseFindDataContentConditions ? (extra.isFindByContentAI ?? false) : false,
      contentAI: canUseFindDataContentConditions ? (extra.contentAI ?? '') : '',
      // Detail-specific.
      // inputDataUid pass nguyên dạng raw (UID thuần hoặc link) — workflow block
      // `fb_resolve_url` sẽ verify/normalize tuỳ theo urlType (group/profile/messenger).
      ...(detail ? {
        inputDataId: detail.id,
        inputDataName: detail.name,
        inputDataUid: detail.uid,
        inputDataPhone: detail.phone,
        inputDataEmail: detail.email
      } : {})
    }
  }

  /**
   * Per-milestone logging cho engine v2.
   * Scan steps theo block_name (cố định) để biết bước nào succeeded:
   *   - fb_click_post_button → "Đăng bài"
   *   - fb_comment_at_position/fb_comment_current_post → "Comment"
   *   - fb_send_message → "Nhắn tin"
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
    overallSuccess: boolean
  ): Promise<void> {
    void overallSuccess
    const inputDataName = detail?.name || detail?.uid || ''

    // Tìm kiếm data trong group — 1 milestone tổng kết theo group, dữ liệu chi tiết nằm trong JSONB data.
    if (campaign.actionId === 'facebook_find_data_group') {
      const summaryStep = steps.find(s => s.blockName === 'fb_find_group_data_summary')
      const errorStep = steps.find(s => s.status === 'error')
      const out = ((summaryStep?.output as any) || {}) as {
        phones?: unknown[]
        linkGroupZalos?: unknown[]
        uids?: unknown[]
        postLinks?: unknown[]
        groupMembers?: unknown[]
        sourceCounts?: unknown
        message?: string
        groupUrl?: string
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
      const sourceCounts = this.normalizeFindDataSourceCounts(out.sourceCounts)
      const targetName = inputDataName || out.groupUrl || 'group'
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
      const groupMembers = this.filterNewGroupMembers(rawGroupMembers, previousInputValues.uids)
      const groupMemberUidKeys = this.getGroupMemberUidKeys(groupMembers)
      const uids = this.filterNewUidValues(rawUids, previousInputValues.uids)
        .filter(uid => !groupMemberUidKeys.has(this.normalizeUidForCompare(uid)))
      const phones = this.filterNewExternalValues(rawPhones, previousInputValues.phones)
      const linkGroupZalos = this.filterNewExternalValues(rawLinkGroupZalos, previousInputValues.linkGroupZalos)
      const postLinks = this.filterNewPostLinkValues(rawPostLinks, previousInputValues.postLinks)
      const groupMemberNameByUid = new Map<string, string>()
      for (const member of groupMembers) {
        const key = this.normalizeUidForCompare(member.uid)
        if (key && member.name && !groupMemberNameByUid.has(key)) groupMemberNameByUid.set(key, member.name)
      }
      const rawCounts = {
        phones: scanPhones.length,
        linkGroupZalos: scanLinkGroupZalos.length,
        uids: scanUids.length,
        postLinks: scanPostLinks.length,
        groupMembers: scanGroupMembers.length,
        total: scanPhones.length + scanLinkGroupZalos.length + scanUids.length + scanPostLinks.length + scanGroupMembers.length
      }
      const filteredCounts = {
        phones: phones.length,
        linkGroupZalos: linkGroupZalos.length,
        uids: uids.length,
        postLinks: postLinks.length,
        groupMembers: groupMembers.length,
        total: phones.length + linkGroupZalos.length + uids.length + postLinks.length + groupMembers.length
      }
      const duplicateCounts = {
        phones: Math.max(0, rawCounts.phones - filteredCounts.phones),
        linkGroupZalos: Math.max(0, rawCounts.linkGroupZalos - filteredCounts.linkGroupZalos),
        uids: Math.max(0, rawCounts.uids - filteredCounts.uids),
        postLinks: Math.max(0, rawCounts.postLinks - filteredCounts.postLinks),
        groupMembers: Math.max(0, rawCounts.groupMembers - filteredCounts.groupMembers),
        total: Math.max(0, rawCounts.total - filteredCounts.total)
      }
      const findUidTargetCampaignIds = Array.isArray(campaign.extraSettings?.findUidTargetCampaignIds)
        ? campaign.extraSettings.findUidTargetCampaignIds
        : []
      const findPostLinkTargetCampaignIds = Array.isArray(campaign.extraSettings?.findPostLinkTargetCampaignIds)
        ? campaign.extraSettings.findPostLinkTargetCampaignIds
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
          groupMembers: groupMembers.length
        },
        sourceCounts,
        campaign.extraSettings || {},
        { isFollowUpInputRun }
      )
      const errMsg = out.error || summaryStep?.error || errorStep?.error || 'Lỗi không xác định'
      const previousCampaignValues = isSuccess
        ? await this.getPreviouslyFoundValues(campaign.id)
        : this.createEmptyFindDataPreviousValues()

      try {
        await this.supabase.createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionName: 'Tìm data',
          status: isSuccess ? 'thành công' : 'lỗi',
          log: isSuccess
            ? successLog
            : `Lỗi tìm data trong ${targetName}: ${errMsg}`,
          data: {
            groupUrl: out.groupUrl || detail?.uid,
            phones,
            linkGroupZalos,
            uids,
            postLinks,
            groupMembers,
            counts: filteredCounts,
            rawCounts,
            duplicateCounts,
            isFollowUpInputRun,
            sourceCounts,
            findUidTargetCampaignIds,
            findPostLinkTargetCampaignIds,
            findPhoneSmsTargetCampaignIds,
            findPhoneZaloWebTargetCampaignIds,
            findZaloGroupLinkWebTargetCampaignIds,
            findPhoneAkaBizDesktopTargetCampaignIds,
            findZaloGroupLinkAkaBizDesktopTargetCampaignIds,
            errorBlock: errorStep?.blockName
          }
        })
        if (isSuccess) await this.logCampaignProgress(campaign.id, `✅ ${successLog}`)
        else await this.logCampaignProgress(campaign.id, `❌ Lỗi tìm data trong "${targetName}": ${errMsg}`)
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
        await this.pushFoundPhonesToSmsCampaigns(campaign, newPhonesForExternal)
        await this.pushFoundPhonesToZaloWebCampaigns(campaign, newPhonesForExternal)
        await this.pushFoundZaloGroupLinksToZaloWebCampaigns(campaign, newZaloGroupLinksForExternal)
        await this.pushFoundPhonesToAkaBizDesktopCampaigns(campaign, newPhonesForExternal)
        await this.pushFoundZaloGroupLinksToAkaBizDesktopCampaigns(campaign, newZaloGroupLinksForExternal)
      }
      return
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

        await this.supabase.createCampaignDetail({
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
          await this.supabase.createCampaignDetail({
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
        }
      } catch (err) { console.error('Failed log page switch:', err) }
    }

    // Đăng bài group — xác nhận submit bằng việc form đóng, rồi lưu link bài vừa đăng nếu lấy được.
    const groupPostVerifySteps = campaign.actionId === 'facebook_group_post'
      ? steps.filter(s => s.blockName === 'fb_verify_group_post_form_closed' && s.status === 'success')
      : []
    for (const s of groupPostVerifySteps) {
      try {
        const out = (s.output as any) || {}
        const posted = out.posted === true || out.ok === true
        const linkStep = [...steps].reverse().find(x => x.blockName === 'fb_get_first_group_post_link' && x.status === 'success')
        const linkOut = ((linkStep?.output as any) || {}) as { postUrl?: unknown; link?: unknown; rawPostLink?: unknown }
        const postUrl = posted
          ? this.cleanPostLinkForStorage(String(linkOut.postUrl || linkOut.link || out.postUrl || ''))
          : ''
        const isPending = postUrl.includes('/pending_posts/')
        const requiresPostApproval = postUrl ? isPending : undefined
        const rawPostLink = String(linkOut.rawPostLink || '').trim()
        const failureMessage = String(out.message || 'Form đăng bài chưa đóng sau 60 giây')
        await this.supabase.createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionCode: this.getPostActionCode(campaign),
          actionName: 'Đăng bài',
          status: posted ? 'thành công' : 'thất bại',
          log: posted
            ? (detail ? `Đăng bài thành công vào ${inputDataName}${isPending ? ' (chờ duyệt)' : ''}` : `Đăng bài thành công${isPending ? ' (chờ duyệt)' : ''}`)
            : (detail ? `Đăng bài thất bại vào ${inputDataName}: ${failureMessage}` : `Đăng bài thất bại: ${failureMessage}`),
          postUrl: postUrl || undefined,
          data: {
            isPending,
            rawPostLink: rawPostLink || undefined,
            postUrl: postUrl || undefined,
            submitClosed: posted,
            error: posted ? undefined : failureMessage
          }
        })
        if (posted) {
          await this.syncGroupPostContactStatus(accountId, detail, requiresPostApproval)
          await this.logCampaignProgress(campaign.id, `📝 Đăng bài thành công${detail ? ` vào "${inputDataName}"` : ''}`)
          if (isPending) await this.logCampaignProgress(campaign.id, `⏳ Bài đang chờ duyệt`)
          if (postUrl) await this.logCampaignProgress(campaign.id, `🔗 Link bài post: ${postUrl}`)
          await this.enqueuePostBumpAfterGroupPost(campaign, postUrl)
        } else {
          await this.logCampaignProgress(campaign.id, `❌ Đăng bài thất bại${detail ? ` vào "${inputDataName}"` : ''}: ${failureMessage}`)
        }
      } catch (err) { console.error('Failed log group post:', err) }
    }

    // Đăng bài timeline hoặc fallback khi workflow group post chưa có block verify submit.
    const postSteps = groupPostVerifySteps.length > 0
      ? []
      : steps.filter(s => s.blockName === 'fb_click_post_button' && s.status === 'success')
    for (const s of postSteps) {
      try {
        const isPending = steps.find(x => x.blockName === 'fb_detect_pending_post')?.output?.isPending === true
        await this.supabase.createCampaignDetail({
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
        if (isPending) await this.logCampaignProgress(campaign.id, `⏳ Bài đang chờ duyệt`)
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
      if (out.commented === false || (text.trim().length === 0 && imageCount <= 0)) continue
      loggedCommentCount++
      const preview = text.length > 50 ? text.substring(0, 50) + '...' : text
      const commentType = String(campaign.extraSettings?.commentType || '')
      let target: string
      if (this.isCommentSeedingPostCampaign(campaign.actionId)) {
        target = 'bài post'
      } else if (campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID) {
        target = this.formatOrdinalPost(loggedCommentCount)
      } else if (campaign.actionId === 'facebook_group_post' && commentType === 'others') {
        target = this.formatOrdinalPost(position)
      } else if (campaign.actionId === 'facebook_group_post' && commentType === 'all') {
        target = groupPostIsPending
          ? this.formatOrdinalPost(position)
          : (position === 1 ? 'bài của mình' : this.formatOrdinalPost(position))
      } else {
        target = position === 1 ? 'bài của mình' : this.formatOrdinalPost(position)
      }
      const logText = text.trim().length > 0
        ? `Đã comment vào ${target}: "${preview}"`
        : `Đã comment vào ${target}`
      try {
        await this.supabase.createCampaignDetail({
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
      } catch (err) { console.error('Failed log comment:', err) }
    }

    // Comment seeding: không có bài phù hợp thì chỉ ghi log chiến dịch, không tạo campaign_detail.
    if (campaign.actionId === COMMENT_SEEDING_FEED_ACTION_ID && loggedCommentCount === 0) {
      const prepareStep = steps.find(s => s.blockName === 'fb_prepare_seeding_iterations')
      const out = (prepareStep?.output as any) || {}
      const matchedCount = Number(out.matchedCount ?? 0)
      if (prepareStep?.status === 'success' && matchedCount === 0) {
        const totalCount = Number(out.totalCount ?? 0)
        const keyword = String(campaign.extraSettings?.postKeywordFilter ?? campaign.extraSettings?.keywordFilter ?? '').trim()
        const targetName = inputDataName || 'mục tiêu'
        const reason = keyword
          ? (totalCount > 0
            ? `Không tìm thấy bài phù hợp với từ khoá "${keyword}" trong ${targetName}`
            : `Không tìm thấy bài nào để lọc từ khoá "${keyword}" trong ${targetName}`)
          : `Không tìm thấy bài phù hợp để comment trong ${targetName}`
        await this.logCampaignProgress(campaign.id, `ℹ️ ${reason}`)
      }
    }

    // Nhắn tin — phân biệt 3 status: thành công / thất bại (FB block) / lỗi (exception)
    const msgSteps = steps.filter(s =>
      s.blockName === 'fb_send_message' &&
      (s.status === 'success' || s.status === 'error')
    )
    for (const s of msgSteps) {
      const out = (s.output as any) || {}
      const errMsg = out.error || s.error || 'Lỗi không xác định'
      const status: 'thành công' | 'thất bại' | 'lỗi' =
        s.status === 'error' ? 'lỗi'
        : out.ok === true ? 'thành công'
        : 'thất bại'
      const errorCode = status === 'lỗi' ? this.normalizeRuntimeError(campaign, [s], errMsg).errorCode : undefined
      try {
        await this.supabase.createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionCode: this.getMessageActionCode(campaign),
          actionName: 'Nhắn tin',
          status,
          errorCode,
          log: status === 'thành công' ? `Nhắn tin thành công đến ${inputDataName}` : `Lỗi nhắn tin đến ${inputDataName}: ${errMsg}`
        })
        if (status === 'thành công') await this.logCampaignProgress(campaign.id, `💬 Nhắn tin thành công đến "${inputDataName}"`)
        else await this.logCampaignProgress(campaign.id, `❌ Lỗi nhắn tin "${inputDataName}": ${errMsg}`)
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
          await this.supabase.createCampaignDetail({
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
        } else if (clicked) {
          await this.supabase.createCampaignDetail({
            inputDataId: detail?.id,
            campaignId: campaign.id,
            accountId,
            actionCode: 'fb_add_friend',
            actionName: 'Kết bạn',
            status: 'thành công',
            log: `Kết bạn thành công với ${inputDataName}`
          })
          await this.logCampaignProgress(campaign.id, `🤝 Kết bạn thành công với "${inputDataName}"`)
        } else {
          // s.status='error' → 'lỗi' (crash); s.status='success' nhưng ok=false → 'thất bại' (FB từ chối)
          const status: 'thất bại' | 'lỗi' = s.status === 'error' ? 'lỗi' : 'thất bại'
          const errorCode = status === 'lỗi' ? this.normalizeRuntimeError(campaign, [s], errMsg).errorCode : undefined
          await this.supabase.createCampaignDetail({
            inputDataId: detail?.id,
            campaignId: campaign.id,
            accountId,
            actionCode: 'fb_add_friend',
            actionName: 'Kết bạn',
            status,
            errorCode,
            log: `Lỗi kết bạn với ${inputDataName}: ${errMsg}`
          })
          await this.logCampaignProgress(campaign.id, `❌ Lỗi kết bạn "${inputDataName}": ${errMsg}`)
        }
      } catch (err) { console.error('Failed log friend:', err) }
    }
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
      }
    }
  }

  private formatFindDataLogMessage(
    targetName: string,
    counts: FindDataUniqueCounts,
    sourceCounts: FindDataSourceCounts,
    extra: Campaign['extraSettings'],
    options: { isFollowUpInputRun?: boolean } = {}
  ): string {
    const isFollowUpInputRun = options.isFollowUpInputRun === true
    const uidCount = counts.uids + counts.groupMembers
    const uniqueParts: string[] = []
    if (extra?.isFindUid) uniqueParts.push(`${uidCount} UID${isFollowUpInputRun ? ' mới' : ''}`)
    if (extra?.isFindPostLink) uniqueParts.push(`${counts.postLinks} link bài post${isFollowUpInputRun ? ' mới' : ''}`)
    if (extra?.isFindPhone) uniqueParts.push(`${counts.phones} số điện thoại${isFollowUpInputRun ? ' mới' : ''}`)
    if (extra?.isFindLinkGroupZalo) uniqueParts.push(`${counts.linkGroupZalos} link group Zalo${isFollowUpInputRun ? ' mới' : ''}`)

    if (isFollowUpInputRun) {
      const summary = uniqueParts.join(' - ')
      return [
        'Tìm data mới trong group:',
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

    return [
      'Tìm data trong group:',
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

    if (Array.isArray(data.groupMembers)) {
      for (const member of data.groupMembers) {
        if (!member || typeof member !== 'object') continue
        const uid = String((member as { uid?: unknown }).uid || '').trim()
        const key = this.normalizeUidForCompare(uid)
        if (key) target.uids.add(key)
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

  private async pushFoundPhonesToSmsCampaigns(sourceCampaign: Campaign, rawPhones: string[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindPhone) return

    const targetCampaignIds = this.getExternalTargetCampaignIds(
      sourceCampaign.extraSettings.findPhoneSmsTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const phones = this.uniqueExternalValues(rawPhones)
    if (phones.length === 0) return

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
  private async pushFoundPhonesToZaloWebCampaigns(sourceCampaign: Campaign, rawPhones: string[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindPhone) return

    const targetCampaignIds = this.getExternalTargetCampaignIds(
      sourceCampaign.extraSettings.findPhoneZaloWebTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const phones = this.uniqueExternalValues(rawPhones)
    if (phones.length === 0) return

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

  private async pushFoundPhonesToAkaBizDesktopCampaigns(sourceCampaign: Campaign, rawPhones: string[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindPhone) return

    const targetCampaignIds = this.getExternalTargetCampaignIds(
      sourceCampaign.extraSettings.findPhoneAkaBizDesktopTargetCampaignIds,
      sourceCampaign.id
    )
    if (targetCampaignIds.length === 0) return

    const phones = this.uniqueExternalValues(rawPhones)
    if (phones.length === 0) return

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

  private async enqueuePostBumpAfterGroupPost(campaign: Campaign, rawPostUrl: string): Promise<void> {
    const extra = campaign.extraSettings || {}
    if (campaign.actionId !== 'facebook_group_post' || extra.enablePostBump !== true) return

    const postUrl = this.cleanPostLinkForStorage(rawPostUrl)
    if (!postUrl || postUrl.includes('/pending_posts/')) return

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
      timeSleepBetween2: 0,
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

  private sendLog(message: string): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_LOG, {
        timestamp: new Date().toISOString(),
        message
      })
    } catch {
      // Window may be closed
    }
  }

  private async logCampaignProgress(
    campaignId: number,
    message: string,
    options: { emitRealtime?: boolean } = {}
  ): Promise<void> {
    try {
      const updated = await this.supabase.appendCampaignLog(campaignId, message)
      this.broadcastCampaignUpdate(updated)
    } catch (err) {
      console.error('Failed append campaign progress log:', err)
    }
    if (options.emitRealtime !== false) {
      this.sendLog(message)
    }
  }

  private getAutomationPage(account: AutoAccount, campaignId?: number): AutomationPageRef {
    this.selectAutomationBrowser(account.id, campaignId)
    return {
      page: this.backgroundPages.getOrCreate(account.id, account.flatformType),
      source: 'background'
    }
  }

  private selectAutomationBrowser(accountId: number, campaignId?: number): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_BROWSER_SELECT, { accountId, campaignId })
    } catch {}
  }

  private startBackgroundPreview(accountId: number, campaignId: number, page: PageController): void {
    const key = this.backgroundPreviewKey(accountId, campaignId)
    if (this.backgroundPreviewTimers.has(key)) return

    const capture = async (): Promise<void> => {
      if (this.backgroundPreviewCapturing.has(key)) return
      this.backgroundPreviewCapturing.add(key)
      try {
        if (!page.isConnected()) return
        const image = await page.screenshot()
        this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_BROWSER_PREVIEW, {
          accountId,
          campaignId,
          active: true,
          image: `data:image/png;base64,${image}`,
          timestamp: new Date().toISOString()
        })
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
