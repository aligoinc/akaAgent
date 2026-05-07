import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { IPC_EVENTS, Campaign, CampaignInputData } from '../../shared/types'
import { IPC_EVENTS_V2, RunStepV2 } from '../../shared/v2Types'
import { PageController, PageControllerRegistry } from '../v2/runtime/pageController'
import { WorkflowEngineV2 } from '../v2/runtime/workflowEngine'
import { BackgroundPageManager } from '../v2/runtime/backgroundPageManager'

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

  constructor(supabase: SupabaseService, webviewRegistry: WebviewRegistry, mainWindow: BrowserWindow) {
    this.supabase = supabase
    this.webviewRegistry = webviewRegistry
    this.mainWindow = mainWindow
  }

  setPageRegistry(reg: PageControllerRegistry): void {
    this.pageRegistry = reg
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
      // 1. Get eligible accounts
      const accounts = await this.supabase.getEligibleAccounts()
      if (accounts.length === 0) {
        this.processing = false
        return
      }

      for (const account of accounts) {
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
   * Check if a campaign should run today based on its schedule type.
   */
  private shouldRunToday(campaign: Campaign): boolean {
    const now = new Date()

    // Check if past the end date
    if (campaign.scheduleEndDate) {
      const endDate = new Date(campaign.scheduleEndDate)
      if (now > endDate) return false
    }

    const scheduleType = campaign.scheduleType || 'daily'

    switch (scheduleType) {
      case 'daily':
        // Daily: always eligible (schedule time check is done by getPendingCampaigns)
        return true

      case 'weekly': {
        // JS: 0=Sun, 1=Mon ... 6=Sat
        // Our format: 2=Mon, 3=Tue ... 7=Sat, 8=Sun
        const jsDay = now.getDay() // 0-6
        const ourDay = jsDay === 0 ? 8 : jsDay + 1 // convert to 2-8
        const weekDays = (campaign.scheduleWeekDays || '').split(',').map(d => d.trim()).filter(Boolean)
        return weekDays.includes(String(ourDay))
      }

      case 'monthly': {
        const dayOfMonth = now.getDate()
        const monthDays = (campaign.scheduleDays || '').split(',').map(d => d.trim()).filter(Boolean)
        return monthDays.includes(String(dayOfMonth))
      }

      default:
        return true
    }
  }

  /**
   * Handle post-campaign completion logic based on schedule type.
   * - Daily + continueNextDay: reset schedule to tomorrow same time, set status back to pending
   * - Weekly/Monthly + refreshData: reset all details to pending, set campaign back to pending
   * - Otherwise: mark campaign as complete
   */
  private async handleCampaignCompletion(campaign: Campaign): Promise<void> {
    const scheduleType = campaign.scheduleType || 'daily'

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

    if ((scheduleType === 'weekly' || scheduleType === 'monthly') && campaign.refreshData) {
      // Reset all detail statuses to pending
      const details = await this.supabase.listCampaignInputData(campaign.id)
      for (const detail of details) {
        await this.supabase.updateCampaignInputData(detail.id, {
          status: 'chờ xử lý',
          note: ''
        })
      }

      // Reset schedule to tomorrow same time
      if (campaign.schedule) {
        const schedDate = new Date(campaign.schedule)
        const tomorrow = new Date(now)
        tomorrow.setDate(tomorrow.getDate() + 1)
        tomorrow.setHours(schedDate.getHours(), schedDate.getMinutes(), 0, 0)

        await this.updateCampaignAndBroadcast(campaign.id, {
          status: 'chờ xử lý',
          schedule: tomorrow.toISOString()
        })
        await this.supabase.appendCampaignLog(campaign.id, `Dữ liệu đã được làm mới. Chạy lại lúc ${tomorrow.toLocaleString('vi-VN')}`)
        this.sendLog(`🔄 Chiến dịch "${campaign.name}": dữ liệu đã reset, chạy lại ${tomorrow.toLocaleString('vi-VN')}`)
      } else {
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý' })
      }
      return
    }

    // Default: mark as complete
    await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
    await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành chiến dịch`)
    this.sendLog(`✅ Hoàn thành chiến dịch "${campaign.name}"`)
  }

  private async executeCampaign(account: import('../../shared/types').AutoAccount, campaign: Campaign): Promise<void> {
    if (!this.shouldRunToday(campaign)) return

    try {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'đang chạy' })
      await this.supabase.appendCampaignLog(campaign.id, `Bắt đầu chạy chiến dịch`)
      this.sendLog(`🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${account.name}"`)

      await this.supabase.updateAccount(account.id, { status: 'đang chạy' })

      const action = await this.supabase.getCampaignAction(campaign.actionId)
      if (!action) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Không tìm thấy action`)
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
        await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Không tìm thấy action "${campaign.actionId}"`)
        return
      }

      if (!action.workflowId) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Action "${action.name}" chưa được liên kết workflow v2`)
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
        await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Action "${action.name}" chưa có workflow_id`)
        return
      }

      await this.executeCampaignV2(account, campaign, action.workflowId)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.recoverStuckCampaignInputData(campaign.id, errMsg)
      await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
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
    account: import('../../shared/types').AutoAccount,
    campaign: Campaign,
    workflowId: number
  ): Promise<void> {
    // Determine details: if campaign actionId has details (group_post, message_friend, etc.)
    const details = await this.supabase.listCampaignInputData(campaign.id)

    // Shuffle group list nếu enabled
    if (campaign.extraSettings?.shuffleGroupList && details.length > 1 && campaign.actionId === 'facebook_group_post') {
      for (let i = details.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[details[i], details[j]] = [details[j], details[i]]
      }
      this.sendLog(`🔀 Đã xáo trộn danh sách ${details.length} group`)
    }

    // Resolve sourceLink rotation cho timeline_post
    const extra = campaign.extraSettings || {}
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

    let rateLimitReached = false
    let rateLimitRetryAt: Date | null = null  // thời điểm có thể retry sau (cho hourly limit)
    let rateLimitIsDaily = false
    const limitConfig = extra.actionLimits

    for (let i = 0; i < targets.length; i++) {
      // Check pause
      const cur = await this.supabase.getCampaign(campaign.id)
      if (cur && cur.status === 'tạm dừng') {
        this.sendLog(`⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`)
        await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
        return
      }

      const detail = targets[i]
      if (detail && detail.status !== 'chờ xử lý') continue

      const page = this.getAutomationPage(account)

      // Rate limit
      const actionLabel = campaign.actionId === 'facebook_message_friend'
        ? (extra.enableMessage ? 'Nhắn tin' : 'Kết bạn')
        : campaign.actionId === 'facebook_find_data_group'
          ? 'Tìm data'
          : 'Đăng bài'
      try {
        const limitStatus = await this.supabase.getAccountRateLimitStatus(account.id, actionLabel, limitConfig)
        if (!limitStatus.ok) {
          rateLimitReached = true
          rateLimitIsDaily = limitStatus.isDailyLimit === true
          if (limitStatus.retryAfterMs && limitStatus.retryAfterMs > 0) {
            rateLimitRetryAt = new Date(Date.now() + limitStatus.retryAfterMs)
          }
          await this.supabase.appendCampaignLog(campaign.id, `Tạm dừng do vượt giới hạn ${actionLabel}: ${limitStatus.reason}`)
          this.sendLog(`⚠️ Tạm dừng "${campaign.name}" do giới hạn ${actionLabel}: ${limitStatus.reason}`)
          break
        }
      } catch (err) {
        console.error('Rate limit check error:', err)
      }

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
      this.activeV2Aborts.set(campaign.id, abort)
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

        if (detail) {
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
      } catch (err: any) {
        const errMsg = err?.message || String(err)
        if (detail) {
          await this.supabase.updateCampaignInputData(detail.id, { status: 'hoàn thành', note: errMsg })
        }
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
        this.sendLog(`❌ Lỗi engine v2 "${campaign.name}": ${errMsg}`)
      } finally {
        this.activeV2Aborts.delete(campaign.id)
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

    if (rateLimitReached) {
      // Phân biệt 2 loại limit:
      //   1. Hourly (rateLimitCount/rateLimitMinutes): chỉ cần đợi vài chục phút → reschedule = retryAt
      //   2. Daily (dailyLimit): cần đợi sang ngày mai
      //      - continueNextDay=true → schedule = tomorrow cùng giờ user set
      //      - continueNextDay=false → giữ nguyên schedule, chỉ set status='chờ xử lý'
      if (rateLimitIsDaily) {
        if (campaign.scheduleType === 'daily' && campaign.continueNextDay && campaign.schedule) {
          const now = new Date()
          const schedDate = new Date(campaign.schedule)
          const tomorrow = new Date(now)
          tomorrow.setDate(tomorrow.getDate() + 1)
          tomorrow.setHours(schedDate.getHours(), schedDate.getMinutes(), 0, 0)
          await this.updateCampaignAndBroadcast(campaign.id, {
            status: 'chờ xử lý',
            schedule: tomorrow.toISOString()
          })
          await this.supabase.appendCampaignLog(campaign.id, `Đạt giới hạn ngày. Lên lịch chạy tiếp vào ${tomorrow.toLocaleString('vi-VN')}`)
          this.sendLog(`🔄 Chiến dịch "${campaign.name}" sẽ chạy tiếp vào ${tomorrow.toLocaleString('vi-VN')}`)
        } else {
          await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý' })
        }
      } else if (rateLimitRetryAt) {
        // Hourly limit: reschedule = thời điểm có chỗ trong window
        await this.updateCampaignAndBroadcast(campaign.id, {
          status: 'chờ xử lý',
          schedule: rateLimitRetryAt.toISOString()
        })
        const minutesLeft = Math.ceil((rateLimitRetryAt.getTime() - Date.now()) / 60000)
        await this.supabase.appendCampaignLog(campaign.id, `Đạt tốc độ giới hạn. Tiếp tục sau ${minutesLeft} phút (lúc ${rateLimitRetryAt.toLocaleTimeString('vi-VN')})`)
        this.sendLog(`⏳ Chiến dịch "${campaign.name}" sẽ thử lại sau ${minutesLeft} phút`)
      } else {
        // Fallback: không có info retry → giữ nguyên schedule, status chờ xử lý
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý' })
      }
    } else {
      await this.handleCampaignCompletion(campaign)
    }
    await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
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
    // Resolve images theo imageOption
    let finalImages: string[] = []
    const imageOption = extra.imageOption || 'all'
    const availableImages = campaign.images || []
    if (imageOption === 'all') finalImages = [...availableImages]
    else if (imageOption === 'random') {
      const count = extra.randomImageCount || 3
      finalImages = [...availableImages].sort(() => 0.5 - Math.random()).slice(0, count)
    }
    const validImages = finalImages.filter(fp => fp.startsWith('data:') || existsSync(fp))

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
    const commentIterations = commentIndices.map((position, k) => ({
      position,
      text: this.cycleVariant(commentVariants, k)
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
      // Message friend extras
      enableMessage: extra.enableMessage ?? false,
      enableAddFriend: extra.enableAddFriend ?? false,
      // Find data in group extras
      isFindPhone: extra.isFindPhone ?? false,
      isFindLinkGroupZalo: extra.isFindLinkGroupZalo ?? false,
      isFindUid: extra.isFindUid ?? false,
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
   *   - fb_comment_at_position → "Comment"
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
        message?: string
        groupUrl?: string
        total?: number
        error?: string
      }
      const phones = Array.isArray(out.phones) ? out.phones.map(String) : []
      const linkGroupZalos = Array.isArray(out.linkGroupZalos) ? out.linkGroupZalos.map(String) : []
      const uids = Array.isArray(out.uids) ? out.uids.map(String) : []
      const findUidTargetCampaignIds = Array.isArray(campaign.extraSettings?.findUidTargetCampaignIds)
        ? campaign.extraSettings.findUidTargetCampaignIds
        : []
      const total = Number(out.total ?? (phones.length + linkGroupZalos.length + uids.length))
      const targetName = inputDataName || out.groupUrl || 'group'
      const isSuccess = summaryStep?.status === 'success'
      const notes: string[] = []
      if (campaign.extraSettings?.isFindPhone) notes.push(`${phones.length} số điện thoại`)
      if (campaign.extraSettings?.isFindLinkGroupZalo) notes.push(`${linkGroupZalos.length} link group Zalo`)
      if (campaign.extraSettings?.isFindUid) notes.push(`${uids.length} UID`)
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
            counts: { phones: phones.length, linkGroupZalos: linkGroupZalos.length, uids: uids.length, total },
            findUidTargetCampaignIds,
            errorBlock: errorStep?.blockName
          }
        })
        if (isSuccess) this.sendLog(`✅ ${total > 0 ? `Đã tìm data trong "${targetName}": ${notes.join(' - ')}` : `Không tìm thấy data phù hợp trong "${targetName}"`}`)
        else this.sendLog(`❌ Lỗi tìm data trong "${targetName}": ${errMsg}`)
      } catch (err) { console.error('Failed log find data:', err) }

      if (isSuccess) {
        await this.pushFoundUidsToTargetCampaigns(campaign, uids)
      }
      return
    }

    // Đăng bài
    const postSteps = steps.filter(s => s.blockName === 'fb_click_post_button' && s.status === 'success')
    for (const s of postSteps) {
      try {
        const isPending = steps.find(x => x.blockName === 'fb_detect_pending_post')?.output?.isPending === true
        await this.supabase.createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
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
    const commentSteps = steps.filter(s => s.blockName === 'fb_comment_at_position' && s.status === 'success')
    for (let i = 0; i < commentSteps.length; i++) {
      const s = commentSteps[i]
      const out = (s.output as any) || {}
      const position = Number(out.position ?? (i + 1))
      const text = String(out.text ?? '')
      const preview = text.length > 50 ? text.substring(0, 50) + '...' : text
      const target = position === 1 ? 'bài của mình' : `bài thứ ${position}`
      try {
        await this.supabase.createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionName: 'Comment',
          status: 'thành công',
          log: `Đã comment vào ${target}: "${preview}"`,
          data: { commentPosition: position, iteration: i + 1, commentContent: text }
        })
        this.sendLog(`💬 Đã comment vào ${target}${detail ? ` tại "${inputDataName}"` : ''}`)
      } catch (err) { console.error('Failed log comment:', err) }
    }

    // Nhắn tin — phân biệt 3 status: thành công / thất bại (FB block) / lỗi (exception)
    const msgSteps = steps.filter(s => s.blockName === 'fb_send_message')
    for (const s of msgSteps) {
      const out = (s.output as any) || {}
      const errMsg = out.error || s.error || 'Lỗi không xác định'
      const status: 'thành công' | 'thất bại' | 'lỗi' =
        s.status === 'error' ? 'lỗi'
        : out.ok === true ? 'thành công'
        : 'thất bại'
      try {
        await this.supabase.createCampaignDetail({
          inputDataId: detail?.id,
          campaignId: campaign.id,
          accountId,
          actionName: 'Nhắn tin',
          status,
          log: status === 'thành công' ? `Nhắn tin thành công đến ${inputDataName}` : `Lỗi nhắn tin đến ${inputDataName}: ${errMsg}`
        })
        if (status === 'thành công') this.sendLog(`💬 Nhắn tin thành công đến "${inputDataName}"`)
        else this.sendLog(`❌ Lỗi nhắn tin "${inputDataName}": ${errMsg}`)
      } catch (err) { console.error('Failed log message:', err) }
    }

    // Kết bạn — alreadyFriend / clicked = thành công; ok=false không exception = thất bại; exception = lỗi
    const friendSteps = steps.filter(s => s.blockName === 'fb_add_friend')
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
            actionName: 'Kết bạn',
            status: 'thành công',
            log: `Kết bạn thành công với ${inputDataName}`
          })
          this.sendLog(`🤝 Kết bạn thành công với "${inputDataName}"`)
        } else {
          // s.status='error' → 'lỗi' (crash); s.status='success' nhưng ok=false → 'thất bại' (FB từ chối)
          const status: 'thất bại' | 'lỗi' = s.status === 'error' ? 'lỗi' : 'thất bại'
          await this.supabase.createCampaignDetail({
            inputDataId: detail?.id,
            campaignId: campaign.id,
            accountId,
            actionName: 'Kết bạn',
            status,
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
        if (!targetCampaign || targetCampaign.actionId !== 'facebook_message_friend') continue

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

  private normalizeUidForCompare(uid: string): string {
    return String(uid || '').trim().replace(/\/+$/g, '').toLowerCase()
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

  private getAutomationPage(account: import('../../shared/types').AutoAccount): PageController {
    return this.backgroundPages.getOrCreate(account.id, account.flatformType)
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
