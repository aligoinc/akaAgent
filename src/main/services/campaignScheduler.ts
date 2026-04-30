import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { IPC_CHANNELS, Campaign, CampaignDataAction } from '../../shared/types'
import { IPC_CHANNELS_V2, RunStepV2 } from '../../shared/v2Types'
import { PageControllerRegistry } from '../v2/runtime/pageController'
import { WorkflowEngineV2 } from '../v2/runtime/workflowEngine'

/**
 * Campaign scheduler: every 30s, scan eligible channels for due campaigns and
 * run their associated workflow v2 against the channel's embedded webview.
 *
 * Engine v2 is the only execution path. Each campaign action template
 * (`auto_campaign_actions.workflow_v2_id`) points to a workflow that already
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
    this.sendLog('⏹ Scheduler đã dừng.')
  }

  isRunning(): boolean {
    return this.running
  }

  private async tick(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      // 1. Get eligible channels
      const channels = await this.supabase.getEligibleChannels()
      if (channels.length === 0) {
        this.processing = false
        return
      }

      for (const channel of channels) {
        // 2. Get pending campaigns for this channel
        const campaigns = await this.supabase.getPendingCampaigns(channel.id)
        if (campaigns.length === 0) continue

        // Check browser webview is registered for this channel
        if (!this.webviewRegistry.isRegistered(channel.id)) {
          this.sendLog(`⚠️ Tài khoản "${channel.name}" chưa mở tab trình duyệt. Bỏ qua.`)
          continue
        }

        for (const campaign of campaigns) {
          await this.executeCampaign(channel, campaign)
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
      const details = await this.supabase.listCampaignDataActions(campaign.id)
      for (const detail of details) {
        await this.supabase.updateCampaignDataAction(detail.id, {
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

  private async executeCampaign(channel: import('../../shared/types').OrgChannel, campaign: Campaign): Promise<void> {
    if (!this.shouldRunToday(campaign)) return

    try {
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'đang chạy' })
      await this.supabase.appendCampaignLog(campaign.id, `Bắt đầu chạy chiến dịch`)
      this.sendLog(`🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${channel.name}"`)

      await this.supabase.updateChannel(channel.id, { status: 'đang chạy' })

      const action = await this.supabase.getCampaignAction(campaign.actionId)
      if (!action) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Không tìm thấy action`)
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
        await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Không tìm thấy action "${campaign.actionId}"`)
        return
      }

      if (!action.workflowV2Id) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Action "${action.name}" chưa được liên kết workflow v2`)
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
        await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Action "${action.name}" chưa có workflow_v2_id`)
        return
      }

      if (!this.pageRegistry) {
        throw new Error('pageRegistry chưa được set cho scheduler')
      }

      await this.executeCampaignV2(channel, campaign, action.workflowV2Id)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.recoverStuckDataActions(campaign.id, errMsg)
      await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
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
    channel: import('../../shared/types').OrgChannel,
    campaign: Campaign,
    workflowV2Id: number
  ): Promise<void> {
    if (!this.pageRegistry) throw new Error('pageRegistry chưa được set cho scheduler')
    const page = this.pageRegistry.get(channel.id)
    if (!page) {
      this.sendLog(`⚠️ Tài khoản "${channel.name}" chưa mở tab. Bỏ qua.`)
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý' })
      return
    }

    // Determine details: if campaign actionId has details (group_post, message_friend, etc.)
    const details = await this.supabase.listCampaignDataActions(campaign.id)

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
        await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
        return
      }

      const detail = targets[i]
      if (detail && detail.status !== 'chờ xử lý') continue

      // Rate limit
      const actionLabel = campaign.actionId === 'facebook_message_friend' ? (extra.enableMessage ? 'Nhắn tin' : 'Kết bạn') : 'Đăng bài'
      try {
        const limitStatus = await this.supabase.getChannelRateLimitStatus(channel.id, actionLabel, limitConfig)
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
      const variables = this.buildVariablesV2(campaign, detail, channel.id, currentSourceLink, i)

      // Update detail status running
      if (detail) {
        await this.supabase.updateCampaignDataAction(detail.id, {
          status: 'đang chạy',
          dateAction: new Date().toISOString()
        })
        const detailName = detail.name || detail.uid || 'N/A'
        this.sendLog(`▶️ Xử lý "${detailName}" trong chiến dịch "${campaign.name}"`)
      }

      // Run engine v2
      const abort = new AbortController()
      this.activeV2Aborts.set(campaign.id, abort)
      try {
        const result = await this.engineV2.run(workflowV2Id, variables, page, {
          channelId: channel.id,
          campaignId: campaign.id,
          campaignDataActionId: detail?.id,
          signal: abort.signal,
          persist: true,
          onStepProgress: (step: RunStepV2) => {
            try { this.mainWindow.webContents.send(IPC_CHANNELS_V2.RUN_PROGRESS, { runKey: `campaign-${campaign.id}`, step }) } catch {}
          },
          onLog: (entry) => {
            try { this.mainWindow.webContents.send(IPC_CHANNELS_V2.RUN_LOG, { runKey: `campaign-${campaign.id}`, ...entry }) } catch {}
          }
        })

        // Per-milestone logging — scan steps theo block_name
        await this.logMilestonesV2(campaign, detail, channel.id, result.steps, result.status === 'completed')

        if (detail) {
          if (result.status === 'completed') {
            await this.supabase.updateCampaignDataAction(detail.id, { status: 'hoàn thành' })
            await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành: ${detail.name || detail.uid || 'N/A'}`)
            this.sendLog(`✅ Hoàn thành "${detail.name || detail.uid || 'N/A'}"`)
          } else {
            // data_actions enum không có 'lỗi' — set 'hoàn thành' + note (chi tiết lỗi đã ở result_actions)
            const errMsg = result.error || 'Lỗi không xác định'
            await this.supabase.updateCampaignDataAction(detail.id, { status: 'hoàn thành', note: errMsg })
            await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${detail.name || detail.uid || 'N/A'} - ${errMsg}`)
            this.sendLog(`❌ Lỗi "${detail.name || detail.uid || 'N/A'}": ${errMsg}`)
          }
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err)
        if (detail) {
          await this.supabase.updateCampaignDataAction(detail.id, { status: 'hoàn thành', note: errMsg })
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
    await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
  }

  /** Build variables object inject vào engine v2. */
  private buildVariablesV2(
    campaign: Campaign,
    detail: CampaignDataAction | null,
    channelId: number,
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
      channelId,
      // Comment
      enableComment,
      commentType,
      commentCount,
      commentIterations,
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
      videoPath: validImages[0] || '',
      // Message friend extras
      enableMessage: extra.enableMessage ?? false,
      enableAddFriend: extra.enableAddFriend ?? false,
      // Detail-specific.
      // detailUid pass nguyên dạng raw (UID thuần hoặc link) — workflow block
      // `fb_resolve_url` sẽ verify/normalize tuỳ theo urlType (group/profile/messenger).
      ...(detail ? {
        detailId: detail.id,
        detailName: detail.name,
        detailUid: detail.uid,
        detailPhone: detail.phone,
        detailEmail: detail.email
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
   * Mỗi milestone ghi 1 row vào auto_campaign_result_actions với status:
   *   - 'thành công' = action OK
   *   - 'thất bại'   = nghiệp vụ FB từ chối (output.ok=false không exception)
   *   - 'lỗi'        = exception/crash code (step.status='error')
   */
  private async logMilestonesV2(
    campaign: Campaign,
    detail: CampaignDataAction | null,
    channelId: number,
    steps: RunStepV2[],
    overallSuccess: boolean
  ): Promise<void> {
    void overallSuccess
    const detailName = detail?.name || detail?.uid || ''

    // Đăng bài
    const postSteps = steps.filter(s => s.blockName === 'fb_click_post_button' && s.status === 'success')
    for (const s of postSteps) {
      try {
        const isPending = steps.find(x => x.blockName === 'fb_detect_pending_post')?.output?.isPending === true
        await this.supabase.createResultAction({
          dataActionId: detail?.id,
          campaignId: campaign.id,
          channelId,
          actionName: 'Đăng bài',
          status: 'thành công',
          log: detail ? `Đăng bài thành công vào ${detailName}${isPending ? ' (chờ duyệt)' : ''}` : 'Đăng bài thành công',
          data: isPending ? { isPending: true } : undefined
        })
        this.sendLog(`📝 Đăng bài thành công${detail ? ` vào "${detailName}"` : ''}`)
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
        await this.supabase.createResultAction({
          dataActionId: detail?.id,
          campaignId: campaign.id,
          channelId,
          actionName: 'Comment',
          status: 'thành công',
          log: `Đã comment vào ${target}: "${preview}"`,
          data: { commentPosition: position, iteration: i + 1, commentContent: text }
        })
        this.sendLog(`💬 Đã comment vào ${target}${detail ? ` tại "${detailName}"` : ''}`)
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
        await this.supabase.createResultAction({
          dataActionId: detail?.id,
          campaignId: campaign.id,
          channelId,
          actionName: 'Nhắn tin',
          status,
          log: status === 'thành công' ? `Nhắn tin thành công đến ${detailName}` : `Lỗi nhắn tin đến ${detailName}: ${errMsg}`
        })
        if (status === 'thành công') this.sendLog(`💬 Nhắn tin thành công đến "${detailName}"`)
        else this.sendLog(`❌ Lỗi nhắn tin "${detailName}": ${errMsg}`)
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
          await this.supabase.createResultAction({
            dataActionId: detail?.id,
            campaignId: campaign.id,
            channelId,
            actionName: 'Kết bạn',
            status: 'thành công',
            log: `Bỏ qua kết bạn với ${detailName} (đã là bạn bè hoặc nút bị ẩn)`,
            data: { alreadyFriend: true }
          })
          this.sendLog(`ℹ️ Bỏ qua kết bạn với "${detailName}" (đã là bạn hoặc nút bị ẩn)`)
        } else if (clicked) {
          await this.supabase.createResultAction({
            dataActionId: detail?.id,
            campaignId: campaign.id,
            channelId,
            actionName: 'Kết bạn',
            status: 'thành công',
            log: `Kết bạn thành công với ${detailName}`
          })
          this.sendLog(`🤝 Kết bạn thành công với "${detailName}"`)
        } else {
          // s.status='error' → 'lỗi' (crash); s.status='success' nhưng ok=false → 'thất bại' (FB từ chối)
          const status: 'thất bại' | 'lỗi' = s.status === 'error' ? 'lỗi' : 'thất bại'
          await this.supabase.createResultAction({
            dataActionId: detail?.id,
            campaignId: campaign.id,
            channelId,
            actionName: 'Kết bạn',
            status,
            log: `Lỗi kết bạn với ${detailName}: ${errMsg}`
          })
          this.sendLog(`❌ Lỗi kết bạn "${detailName}": ${errMsg}`)
        }
      } catch (err) { console.error('Failed log friend:', err) }
    }
  }

  private async recoverStuckDataActions(campaignId: number, errMsg: string): Promise<void> {
    try {
      const details = await this.supabase.listCampaignDataActions(campaignId)
      for (const d of details) {
        if (d.status === 'đang chạy') {
          // data_actions enum không có 'lỗi' — flag bằng 'hoàn thành' + note
          await this.supabase.updateCampaignDataAction(d.id, {
            status: 'hoàn thành',
            note: `Dừng đột ngột: ${errMsg}`
          })
        }
      }
    } catch (recoverErr) {
      console.error('Failed to recover stuck data actions:', recoverErr)
    }
  }

  private sendLog(message: string): void {
    try {
      this.mainWindow.webContents.send(IPC_CHANNELS.CAMPAIGN_LOG, {
        timestamp: new Date().toISOString(),
        message
      })
    } catch {
      // Window may be closed
    }
  }

  /**
   * Cập nhật campaign xong push luôn ra renderer để UI hiện status realtime.
   */
  private async updateCampaignAndBroadcast(id: number, updates: Partial<Campaign>): Promise<Campaign> {
    const updated = await this.supabase.updateCampaign(id, updates)
    try {
      this.mainWindow.webContents.send(IPC_CHANNELS.CAMPAIGN_STATUS_UPDATED, updated)
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
