import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { AccountActionLimitStatus, ActionLimitConfig, AutoAccount, AutoErrorPolicy, IPC_EVENTS, Campaign, CampaignAction, CampaignActionLimitSettings, CampaignInputData } from '../../shared/types'
import { IPC_EVENTS_V2, RunStepV2 } from '../../shared/v2Types'
import { PageController, PageControllerRegistry } from '../v2/runtime/pageController'
import { WorkflowEngineV2 } from '../v2/runtime/workflowEngine'
import { BackgroundPageManager } from '../v2/runtime/backgroundPageManager'

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

const COMMENT_SEEDING_FEED_ACTION_ID = 'facebook_comment_seeding'
const COMMENT_SEEDING_POST_ACTION_ID = 'facebook_comment_seeding_post'
const MESSAGE_FRIEND_ACTION_ID = 'facebook_message_friend'
const MESSAGE_UID_ACTION_ID = 'facebook_message_uid'

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
  private processing = false
  private activeV2Aborts = new Map<number, AbortController>()
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
    this.stopAllBackgroundPreviews()
    this.backgroundPages.destroyAll()
    this.sendLog('⏹ Scheduler đã dừng.')
  }

  isRunning(): boolean {
    return this.running
  }

  private async tick(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      await this.supabase.enableDueAccountActions().catch(err => {
        console.error('Failed to enable due account actions:', err)
      })

      // 1. Get eligible accounts
      const accounts = await this.supabase.getEligibleAccounts()
      if (accounts.length === 0) {
        this.processing = false
        return
      }

      for (const account of accounts) {
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

        for (const campaign of campaigns) {
          await this.executeCampaign(account, campaign)
        }
      }
    } catch (err) {
      console.error('Scheduler tick error:', err)
      this.sendLog(`❌ Lỗi scheduler: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.processing = false
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
        await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành chiến dịch (đã hết ngày kết thúc)`)
        this.sendLog(`✅ Hoàn thành chiến dịch "${campaign.name}" (hết ngày kết thúc)`)
        return
      }
    }

    await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
    await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành chiến dịch`)
    this.sendLog(`✅ Hoàn thành chiến dịch "${campaign.name}"`)
  }

  private async executeCampaign(account: AutoAccount, campaign: Campaign): Promise<void> {
    try {
      const startBlockReason = await this.getAccountRunBlockReason(account.id, 'chờ xử lý')
      if (startBlockReason) {
        await this.updateCampaignPreflightNote(campaign, startBlockReason)
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

      const preflightLimit = await this.checkActionLimits(
        account.id,
        campaign,
        this.getCampaignActionDescriptors(campaign, action),
        campaign.extraSettings?.actionLimits
      )
      if (preflightLimit && !preflightLimit.ok) {
        await this.updateCampaignPreflightNote(campaign, await this.buildLimitPreflightNote(preflightLimit))
        return
      }

      await this.updateCampaignAndBroadcast(campaign.id, { status: 'đang chạy', note: null })
      await this.supabase.appendCampaignLog(campaign.id, `Bắt đầu chạy chiến dịch`)
      this.sendLog(`🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${account.name}"`)

      await this.updateAccountAndBroadcast(account.id, { status: 'đang chạy' })

      await this.executeCampaignV2(account, campaign, action.workflowId, this.getCampaignActionDescriptors(campaign, action))
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.recoverStuckCampaignInputData(campaign.id, errMsg)
      await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
      await this.handleRuntimeError(account, campaign, 'err_undefined', undefined, { message: errMsg })
      await this.releaseRunningAccount(account.id)
      this.sendLog(`❌ Lỗi chiến dịch "${campaign.name}": ${errMsg}`)
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

    if (this.shouldUseSuggestedFriends(campaign) && details.length === 0) {
      details = await this.collectSuggestedFriendInputData(account, campaign, workflowId)
      if (details.length === 0) {
        const message = 'Không lấy được đề xuất bạn bè từ Facebook'
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', note: message })
        await this.supabase.appendCampaignLog(campaign.id, message)
        this.sendLog(`⚠️ ${message}`)
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
      this.sendLog(`🔀 Đã xáo trộn danh sách ${details.length} group`)
    }

    // Resolve sourceLink rotation cho timeline_post
    let currentSourceLink = ''
    if (campaign.actionId === 'facebook_timeline_post') {
      const links = (extra.sourceLinks || '').split(',').map(s => s.trim()).filter(Boolean)
      if (links.length > 0) {
        const idx = (extra.sourceLinkIndex || 0) % links.length
        currentSourceLink = links[idx]
        const nextIdx = (idx + 1) % links.length
        try {
          await this.updateCampaignAndBroadcast(campaign.id, {
            extraSettings: { ...extra, sourceLinkIndex: nextIdx }
          })
        } catch {}
        this.sendLog(`🔗 Link nguồn #${idx + 1}/${links.length}: ${currentSourceLink}`)
      }
    }

    const runOnce = details.length === 0
    const targets = runOnce ? [null] : details

    const limitConfig = extra.actionLimits
    let stoppedBeforeCompletion = false

    for (let i = 0; i < targets.length; i++) {
      // Check pause
      const cur = await this.supabase.getCampaign(campaign.id)
      if (cur && cur.status === 'tạm dừng') {
        this.sendLog(`⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`)
        await this.releaseRunningAccount(account.id)
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

      // Check action disable/rate limit immediately before each target.
      try {
        const limitStatus = await this.checkActionLimits(account.id, campaign, actionDescriptors, limitConfig)
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

      // Build variables
      const variables = this.buildVariablesV2(campaign, detail, account.id, currentSourceLink, i)

      // Update detail status running
      if (detail) {
        await this.supabase.updateCampaignInputData(detail.id, {
          status: 'đang chạy',
          dateAction: new Date().toISOString()
        })
        const inputDataName = detail.name || detail.uid || 'N/A'
        this.sendLog(`▶️ Xử lý "${inputDataName}" trong chiến dịch "${campaign.name}"`)
      }

      // Run engine v2
      const abort = new AbortController()
      let accountStopReason: string | null = null
      let shouldStopAfterTarget = false
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
            await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành: ${detail.name || detail.uid || 'N/A'}`)
            this.sendLog(`✅ Hoàn thành "${detail.name || detail.uid || 'N/A'}"`)
          } else {
            // campaign_input_data enum không có 'lỗi' — set 'hoàn thành' + note (chi tiết lỗi đã ở campaign_details)
            const errMsg = result.error || 'Lỗi không xác định'
            await this.supabase.updateCampaignInputData(detail.id, { status: 'hoàn thành', note: errMsg })
            await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${detail.name || detail.uid || 'N/A'} - ${errMsg}`)
            this.sendLog(`❌ Lỗi "${detail.name || detail.uid || 'N/A'}": ${errMsg}`)
          }
        }

        if (!accountStopReason && result.status !== 'completed') {
          const runtimeError = this.normalizeRuntimeError(campaign, result.steps, result.error)
          const handled = await this.handleRuntimeError(account, campaign, runtimeError.errorCode, runtimeError.actionCode, {
            message: runtimeError.message
          })
          shouldStopAfterTarget = handled.triggered
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err)
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
          shouldStopAfterTarget = handled.triggered
        }
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
        this.sendLog(`❌ Lỗi engine v2 "${campaign.name}": ${errMsg}`)
      } finally {
        clearInterval(accountGuard)
        if (automationPage.source === 'background') {
          this.stopBackgroundPreview(account.id, campaign.id)
        }
        this.activeV2Aborts.delete(campaign.id)
      }

      if (shouldStopAfterTarget) {
        stoppedBeforeCompletion = true
        break
      }

      // Sleep between details
      if (i < targets.length - 1) {
        const sleepTime = extra.actionLimits?.sleepBetweenActions || campaign.timeSleepBetween2 || 0
        if (sleepTime > 0) {
          this.sendLog(`⏳ Nghỉ ${sleepTime}s trước khi xử lý mục tiếp theo...`)
          await new Promise(r => setTimeout(r, sleepTime * 1000))
        }
      }
    }

    if (!stoppedBeforeCompletion) {
      await this.handleCampaignCompletion(campaign)
    }
    await this.releaseRunningAccount(account.id)
  }

  private shouldUseSuggestedFriends(campaign: Campaign): boolean {
    return campaign.actionId === MESSAGE_UID_ACTION_ID && campaign.extraSettings?.useSuggestedFriends === true
  }

  private normalizeSuggestedFriendsCount(value: unknown): number {
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed)) return 10
    return Math.max(1, parsed)
  }

  private async collectSuggestedFriendInputData(account: AutoAccount, campaign: Campaign, workflowId: number): Promise<CampaignInputData[]> {
    const count = this.normalizeSuggestedFriendsCount(campaign.extraSettings?.suggestedFriendsCount)

    await this.supabase.appendCampaignLog(campaign.id, `Bắt đầu lấy ${count} đề xuất bạn bè từ Facebook`)
    this.sendLog(`ℹ️ Bắt đầu lấy ${count} đề xuất bạn bè từ Facebook`)

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

      await this.supabase.appendCampaignLog(campaign.id, `Đã thêm ${profiles.length} đề xuất bạn bè vào danh sách UID`)
      this.sendLog(`✅ Đã thêm ${profiles.length} đề xuất bạn bè vào chiến dịch "${campaign.name}"`)
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
      await this.supabase.appendCampaignLog(campaign.id, reason)
      this.sendLog(`⚠️ Dừng chiến dịch "${campaign.name}": ${reason}`)
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
      await this.supabase.appendCampaignLog(campaign.id, message)
      this.sendLog(`⚠️ Tạm dừng "${campaign.name}": ${message}`)
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
    await this.supabase.appendCampaignLog(campaign.id, message)
    this.sendLog(`⚠️ Dừng chiến dịch "${campaign.name}": ${message}`)

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
    detailIndex: number
  ): Record<string, unknown> {
    const extra = campaign.extraSettings || {}
    const validImages = this.resolveImageSelection(campaign.images || [], extra.imageOption || 'all', extra.randomImageCount || 3)
    const validCommentImages = (extra.commentImages || []).filter(fp => this.isUsableImagePath(fp)).slice(0, 1)

    // Comment iterations
    const enableComment = extra.enableComment ?? false
    const commentType = extra.commentType || 'own'
    const commentCount = extra.commentCount ?? 3
    let commentIndices: number[] = []
    if (enableComment) {
      if (commentType === 'own') commentIndices = [1]
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
      images: validImages,
      accountId,
      // Comment
      enableComment,
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
      // Timeline post extras
      sharePost: extra.sharePost ?? false,
      copyContentFromSource: extra.copyContentFromSource ?? false,
      includeSourceImages: extra.includeSourceImages ?? false,
      postAsReels: extra.postAsReels ?? false,
      sourceLink: currentSourceLink,
      targetUrl: detail?.uid || currentSourceLink,
      videoPath: validImages[0] || '',
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
      isFindByKeywords: extra.isFindByKeywords ?? false,
      keywords: extra.keywords ?? '',
      isFindByContentAI: extra.isFindByContentAI ?? false,
      contentAI: extra.contentAI ?? '',
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
        message?: string
        groupUrl?: string
        total?: number
        error?: string
      }
      const phones = Array.isArray(out.phones) ? out.phones.map(String) : []
      const linkGroupZalos = Array.isArray(out.linkGroupZalos) ? out.linkGroupZalos.map(String) : []
      const uids = Array.isArray(out.uids) ? out.uids.map(String) : []
      const postLinks = Array.isArray(out.postLinks)
        ? out.postLinks.map(link => this.cleanPostLinkForStorage(String(link))).filter(Boolean)
        : []
      const findUidTargetCampaignIds = Array.isArray(campaign.extraSettings?.findUidTargetCampaignIds)
        ? campaign.extraSettings.findUidTargetCampaignIds
        : []
      const findPostLinkTargetCampaignIds = Array.isArray(campaign.extraSettings?.findPostLinkTargetCampaignIds)
        ? campaign.extraSettings.findPostLinkTargetCampaignIds
        : []
      const total = Number(out.total ?? (phones.length + linkGroupZalos.length + uids.length + postLinks.length))
      const targetName = inputDataName || out.groupUrl || 'group'
      const isSuccess = summaryStep?.status === 'success'
      const notes: string[] = []
      if (campaign.extraSettings?.isFindPhone) notes.push(`${phones.length} số điện thoại`)
      if (campaign.extraSettings?.isFindLinkGroupZalo) notes.push(`${linkGroupZalos.length} link group Zalo`)
      if (campaign.extraSettings?.isFindUid) notes.push(`${uids.length} UID`)
      if (campaign.extraSettings?.isFindPostLink) notes.push(`${postLinks.length} link bài post`)
      const errMsg = out.error || summaryStep?.error || errorStep?.error || 'Lỗi không xác định'

      try {
        await this.supabase.createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionName: 'Tìm data',
          status: isSuccess ? 'thành công' : 'lỗi',
          log: isSuccess
            ? (total > 0
              ? `Đã tìm data trong ${targetName}: ${notes.join(' - ')}`
              : `Không tìm thấy data phù hợp trong ${targetName}`)
            : `Lỗi tìm data trong ${targetName}: ${errMsg}`,
          data: {
            groupUrl: out.groupUrl || detail?.uid,
            phones,
            linkGroupZalos,
            uids,
            postLinks,
            counts: { phones: phones.length, linkGroupZalos: linkGroupZalos.length, uids: uids.length, postLinks: postLinks.length, total },
            findUidTargetCampaignIds,
            findPostLinkTargetCampaignIds,
            errorBlock: errorStep?.blockName
          }
        })
        if (isSuccess) this.sendLog(`✅ ${total > 0 ? `Đã tìm data trong "${targetName}": ${notes.join(' - ')}` : `Không tìm thấy data phù hợp trong "${targetName}"`}`)
        else this.sendLog(`❌ Lỗi tìm data trong "${targetName}": ${errMsg}`)
      } catch (err) { console.error('Failed log find data:', err) }

      if (isSuccess) {
        await this.pushFoundUidsToTargetCampaigns(campaign, uids)
        await this.pushFoundPostLinksToTargetCampaigns(campaign, postLinks)
      }
      return
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
          this.sendLog(`📝 Đăng bài thành công${detail ? ` vào "${inputDataName}"` : ''}`)
          if (isPending) this.sendLog(`⏳ Bài đang chờ duyệt`)
          if (postUrl) this.sendLog(`🔗 Link bài post: ${postUrl}`)
        } else {
          this.sendLog(`❌ Đăng bài thất bại${detail ? ` vào "${inputDataName}"` : ''}: ${failureMessage}`)
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
        this.sendLog(`📝 Đăng bài thành công${detail ? ` vào "${inputDataName}"` : ''}`)
        if (isPending) this.sendLog(`⏳ Bài đang chờ duyệt`)
      } catch (err) { console.error('Failed log post:', err) }
      void s
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
        this.sendLog(`💬 Đã comment vào ${target}${detail ? ` tại "${inputDataName}"` : ''}`)
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
        try {
          await this.supabase.appendCampaignLog(campaign.id, reason)
        } catch (err) {
          console.error('Failed append no-match comment seeding log:', err)
        }
        this.sendLog(`ℹ️ ${reason}`)
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
        if (status === 'thành công') this.sendLog(`💬 Nhắn tin thành công đến "${inputDataName}"`)
        else this.sendLog(`❌ Lỗi nhắn tin "${inputDataName}": ${errMsg}`)
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
          this.sendLog(`ℹ️ Bỏ qua kết bạn với "${inputDataName}" (đã là bạn hoặc nút bị ẩn)`)
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
          this.sendLog(`🤝 Kết bạn thành công với "${inputDataName}"`)
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
          this.sendLog(`❌ Lỗi kết bạn "${inputDataName}": ${errMsg}`)
        }
      } catch (err) { console.error('Failed log friend:', err) }
    }
  }

  private async pushFoundUidsToTargetCampaigns(sourceCampaign: Campaign, rawUids: string[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindUid) return

    const targetCampaignIds = Array.from(new Set(
      (sourceCampaign.extraSettings.findUidTargetCampaignIds || [])
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id > 0 && id !== sourceCampaign.id)
    ))
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

        const existingRows = await this.supabase.listCampaignInputData(targetCampaign.id)
        const existingUids = new Set(
          existingRows
            .map(row => this.normalizeUidForCompare(row.uid || ''))
            .filter(Boolean)
        )
        const newUids = uids.filter(uid => !existingUids.has(this.normalizeUidForCompare(uid)))
        if (newUids.length === 0) continue

        for (const uid of newUids) {
          await this.supabase.createCampaignInputData({
            campaignId: targetCampaign.id,
            uid,
            status: 'chờ xử lý',
            note: `Tự động thêm từ chiến dịch "${sourceCampaign.name}"`
          })
        }

        await this.supabase.appendCampaignLog(
          targetCampaign.id,
          `Đã thêm ${newUids.length} UID từ chiến dịch "${sourceCampaign.name}"`
        )
        if (targetCampaign.status === 'hoàn thành') {
          await this.updateCampaignAndBroadcast(targetCampaign.id, { status: 'chờ xử lý' })
        }
        this.sendLog(`✅ Đã thêm ${newUids.length} UID vào chiến dịch "${targetCampaign.name}"`)
      } catch (err) {
        console.error('Failed to push found UIDs to target campaign:', err)
      }
    }
  }

  private async pushFoundPostLinksToTargetCampaigns(sourceCampaign: Campaign, rawPostLinks: string[]): Promise<void> {
    if (!sourceCampaign.extraSettings?.isFindPostLink) return

    const targetCampaignIds = Array.from(new Set(
      (sourceCampaign.extraSettings.findPostLinkTargetCampaignIds || [])
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id > 0 && id !== sourceCampaign.id)
    ))
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

        const existingRows = await this.supabase.listCampaignInputData(targetCampaign.id)
        const existingLinks = new Set(
          existingRows
            .map(row => this.normalizePostLinkForCompare(row.uid || ''))
            .filter(Boolean)
        )
        const newPostLinks = postLinks.filter(link => !existingLinks.has(this.normalizePostLinkForCompare(link)))
        if (newPostLinks.length === 0) continue
        const skippedExistingCount = postLinks.length - newPostLinks.length

        for (const postLink of newPostLinks) {
          await this.supabase.createCampaignInputData({
            campaignId: targetCampaign.id,
            uid: postLink,
            status: 'chờ xử lý',
            note: `Tự động thêm từ chiến dịch "${sourceCampaign.name}"`
          })
        }

        await this.supabase.appendCampaignLog(
          targetCampaign.id,
          `Đã thêm ${newPostLinks.length} link bài post từ chiến dịch "${sourceCampaign.name}"${skippedExistingCount > 0 ? `, bỏ qua ${skippedExistingCount} link đã có` : ''}`
        )
        if (targetCampaign.status === 'hoàn thành') {
          await this.updateCampaignAndBroadcast(targetCampaign.id, { status: 'chờ xử lý' })
        }
        this.sendLog(`✅ Đã thêm ${newPostLinks.length} link bài post vào chiến dịch "${targetCampaign.name}"${skippedExistingCount > 0 ? `, bỏ qua ${skippedExistingCount} link đã có` : ''}`)
      } catch (err) {
        console.error('Failed to push found post links to target campaign:', err)
      }
    }
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
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, updated)
    } catch {
      // Window may be closed
    }
    return updated
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
