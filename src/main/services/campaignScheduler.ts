import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { FlowRunner } from '../playwright/flowRunner'
import { IPC_CHANNELS, ExecutionStep, Campaign, CampaignDetail } from '../../shared/types'

export class CampaignScheduler {
  private supabase: SupabaseService
  private webviewRegistry: WebviewRegistry
  private mainWindow: BrowserWindow
  private intervalId: ReturnType<typeof setInterval> | null = null
  private running = false
  private processing = false

  constructor(supabase: SupabaseService, webviewRegistry: WebviewRegistry, mainWindow: BrowserWindow) {
    this.supabase = supabase
    this.webviewRegistry = webviewRegistry
    this.mainWindow = mainWindow
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
        // Past end date, mark as complete
        await this.supabase.updateCampaign(campaign.id, { status: 'hoàn thành' })
        await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành chiến dịch (đã hết ngày kết thúc)`)
        this.sendLog(`✅ Hoàn thành chiến dịch "${campaign.name}" (hết ngày kết thúc)`)
        return
      }
    }

    if ((scheduleType === 'weekly' || scheduleType === 'monthly') && campaign.refreshData) {
      // Reset all detail statuses to pending
      const details = await this.supabase.listCampaignDetails(campaign.id)
      for (const detail of details) {
        await this.supabase.updateCampaignDetail(detail.id, {
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

        await this.supabase.updateCampaign(campaign.id, {
          status: 'chờ xử lý',
          schedule: tomorrow.toISOString()
        })
        await this.supabase.appendCampaignLog(campaign.id, `Dữ liệu đã được làm mới. Chạy lại lúc ${tomorrow.toLocaleString('vi-VN')}`)
        this.sendLog(`🔄 Chiến dịch "${campaign.name}": dữ liệu đã reset, chạy lại ${tomorrow.toLocaleString('vi-VN')}`)
      } else {
        await this.supabase.updateCampaign(campaign.id, { status: 'chờ xử lý' })
      }
      return
    }

    // Default: mark as complete
    await this.supabase.updateCampaign(campaign.id, { status: 'hoàn thành' })
    await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành chiến dịch`)
    this.sendLog(`✅ Hoàn thành chiến dịch "${campaign.name}"`)
  }

  private async executeCampaign(account: import('../../shared/types').FlatformAccount, campaign: Campaign): Promise<void> {
    // Check schedule type eligibility
    if (!this.shouldRunToday(campaign)) {
      return
    }

    try {
      // Update campaign status to running
      await this.supabase.updateCampaign(campaign.id, { status: 'đang chạy' })
      await this.supabase.appendCampaignLog(campaign.id, `Bắt đầu chạy chiến dịch`)
      this.sendLog(`🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${account.name}"`)

      // Update account status to running
      await this.supabase.updateAccount(account.id, { status: 'đang chạy' })

      // Get the campaign action and its workflow
      const action = await this.supabase.getCampaignAction(campaign.actionId)
      if (!action) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Không tìm thấy action`)
        await this.supabase.updateCampaign(campaign.id, { status: 'lỗi' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Không tìm thấy action "${campaign.actionId}"`)
        return
      }

      // === Message & Friend Request campaign: no workflow, direct browser automation ===
      if (campaign.actionId === 'facebook_message_friend') {
        await this.executeMessageFriendCampaign(account, campaign)
        return
      }

      if (!action.workflowId) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Không tìm thấy workflow`)
        await this.supabase.updateCampaign(campaign.id, { status: 'lỗi' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Không tìm thấy workflow cho action "${campaign.actionId}"`)
        return
      }

      // Load the workflow/flow
      const flow = await this.supabase.loadFlow(action.workflowId)
      if (!flow) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Không tìm thấy flow ${action.workflowId}`)
        await this.supabase.updateCampaign(campaign.id, { status: 'lỗi' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Không tìm thấy flow`)
        return
      }

      // Get campaign details
      const details = await this.supabase.listCampaignDetails(campaign.id)

      if (campaign.extraSettings?.sharePost) {
        const msg = '⚠️ Tính năng "Đăng bài dạng chia sẻ" chưa được hỗ trợ trong phiên bản hiện tại - sẽ bỏ qua'
        this.sendLog(msg)
        await this.supabase.appendCampaignLog(campaign.id, msg)
      }

      // Shuffle details if shuffleGroupList is enabled (Fisher-Yates shuffle)
      if (campaign.extraSettings?.shuffleGroupList && details.length > 1) {
        for (let i = details.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [details[i], details[j]] = [details[j], details[i]]
        }
        this.sendLog(`🔀 Đã xáo trộn danh sách ${details.length} group`)
      }

      if (details.length === 0) {
        // No details, run workflow once with campaign info
        // Check rate limits first
        const limitConfig = campaign.extraSettings?.actionLimits
        let overrideEnableComment = campaign.extraSettings?.enableComment ?? false

        try {
          const limitStatus = await this.supabase.getAccountRateLimitStatus(account.id, 'Đăng bài', limitConfig)
          if (!limitStatus.ok) {
            await this.supabase.appendCampaignLog(campaign.id, `Từ chối chạy do vượt giới hạn Đăng bài: ${limitStatus.reason}`)
            this.sendLog(`⚠️ Từ chối "${campaign.name}" do giới hạn Đăng bài: ${limitStatus.reason}`)
            await this.supabase.updateCampaign(campaign.id, { status: 'chờ xử lý' })
            await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
            return
          }
        } catch (err) {
          console.error('Rate limit check error:', err)
        }

        const campaignToRun = {
          ...campaign,
          extraSettings: { ...campaign.extraSettings, enableComment: overrideEnableComment }
        }
        await this.runWorkflowForDetail(account.id, campaignToRun, flow, null)
        await this.handleCampaignCompletion(campaign)
      } else {
        let rateLimitReached = false

        // Run workflow for each detail
        for (let i = 0; i < details.length; i++) {
          // Kiểm tra xem chiến dịch có bị tạm dừng trong lúc đang chạy không
          const currentCamp = await this.supabase.getCampaign(campaign.id);
          if (currentCamp && currentCamp.status === 'tạm dừng') {
            this.sendLog(`⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`);
            await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
            return; // Thoát khỏi chiến dịch hiện tại
          }

          const detail = details[i]
          if (detail.status !== 'chờ xử lý') continue

          const limitConfig = campaign.extraSettings?.actionLimits
          let overrideEnableComment = campaign.extraSettings?.enableComment ?? false

          // Check Rate limit before processing
          try {
            const limitStatus = await this.supabase.getAccountRateLimitStatus(account.id, 'Đăng bài', limitConfig)
            if (!limitStatus.ok) {
              rateLimitReached = true
              await this.supabase.appendCampaignLog(campaign.id, `Tạm dừng gửi do vượt giới hạn Đăng bài: ${limitStatus.reason}`)
              this.sendLog(`⚠️ Tạm dừng "${campaign.name}" do giới hạn Đăng bài: ${limitStatus.reason}`)
              break
            }
          } catch (err) {
            console.error('Rate limit check error:', err)
          }

          const campaignToRun = {
            ...campaign,
            extraSettings: { ...campaign.extraSettings, enableComment: overrideEnableComment }
          }
          await this.runWorkflowForDetail(account.id, campaignToRun, flow, detail)

          // Sleep between details
          if (i < details.length - 1) {
            const sleepTime = campaign.extraSettings?.actionLimits?.sleepBetweenActions || campaign.timeSleepBetween2 || 0
              
            if (sleepTime > 0) {
              this.sendLog(`⏳ Nghỉ ${sleepTime}s trước khi xử lý mục tiếp theo...`)
              await new Promise(resolve => setTimeout(resolve, sleepTime * 1000))
            }
          }
        }

        if (rateLimitReached) {
          if (campaign.scheduleType === 'daily' && campaign.continueNextDay) {
            // Update schedule to tomorrow, status to chờ xử lý
            const now = new Date()
            if (campaign.schedule) {
              const schedDate = new Date(campaign.schedule)
              const tomorrow = new Date(now)
              tomorrow.setDate(tomorrow.getDate() + 1)
              tomorrow.setHours(schedDate.getHours(), schedDate.getMinutes(), 0, 0)
              
              await this.supabase.updateCampaign(campaign.id, {
                status: 'chờ xử lý',
                schedule: tomorrow.toISOString()
              })
              await this.supabase.appendCampaignLog(campaign.id, `Tạm dừng do đạt giới hạn. Cập nhật lịch chạy tiếp vào ${tomorrow.toLocaleString('vi-VN')}`)
              this.sendLog(`🔄 Chiến dịch "${campaign.name}" sẽ chạy tiếp vào ${tomorrow.toLocaleString('vi-VN')}`)
            } else {
              await this.supabase.updateCampaign(campaign.id, { status: 'chờ xử lý' })
            }
          } else {
            await this.supabase.updateCampaign(campaign.id, { status: 'chờ xử lý' })
          }
        } else {
          // Handle completion based on schedule type
          await this.handleCampaignCompletion(campaign)
        }
      }

      // Reset account status
      await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.recoverStuckDetails(campaign.id, errMsg)
      await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
      await this.supabase.updateCampaign(campaign.id, { status: 'lỗi' })
      await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
      this.sendLog(`❌ Lỗi chiến dịch "${campaign.name}": ${errMsg}`)
    }
  }

  private async recoverStuckDetails(campaignId: number, errMsg: string): Promise<void> {
    try {
      const details = await this.supabase.listCampaignDetails(campaignId)
      for (const d of details) {
        if (d.status === 'đang chạy') {
          await this.supabase.updateCampaignDetail(d.id, {
            status: 'lỗi',
            note: `Dừng đột ngột: ${errMsg}`
          })
        }
      }
    } catch (recoverErr) {
      console.error('Failed to recover stuck details:', recoverErr)
    }
  }

  private async runWorkflowForDetail(
    accountId: number,
    campaign: Campaign,
    flow: import('../../shared/types').FlowData,
    detail: CampaignDetail | null
  ): Promise<void> {
    const detailName = detail?.name || detail?.uid || 'N/A'

    // Update detail status
    if (detail) {
      await this.supabase.updateCampaignDetail(detail.id, {
        status: 'đang chạy',
        dateAction: new Date().toISOString()
      })
      await this.supabase.appendCampaignLog(campaign.id, `Đang xử lý: ${detailName}`)
      this.sendLog(`▶️ Xử lý "${detailName}" trong chiến dịch "${campaign.name}"`)
    }

    // Resolve which images to process based on ExtraSettings
    let finalImages: string[] = []
    const imageOption = campaign.extraSettings?.imageOption || 'all'
    const availableImages = campaign.images || []
    
    if (imageOption === 'all') {
      finalImages = [...availableImages]
    } else if (imageOption === 'random') {
      const count = campaign.extraSettings?.randomImageCount || 3
      const shuffled = [...availableImages].sort(() => 0.5 - Math.random())
      finalImages = shuffled.slice(0, count)
    } else {
      // none
      finalImages = []
    }

    // Validate file paths exist
    const validImages = finalImages.filter(fp => {
      if (fp.startsWith('data:')) return true
      return existsSync(fp)
    })
    if (finalImages.length > 0 && validImages.length < finalImages.length) {
      const missing = finalImages.filter(fp => !fp.startsWith('data:') && !existsSync(fp))
      const msg = `⚠️ Bỏ qua ${missing.length}/${finalImages.length} ảnh không tìm thấy: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}`
      this.sendLog(msg)
      await this.supabase.appendCampaignLog(campaign.id, msg)
    }

    // Compute which comment-box positions (1-indexed XPath) to target.
    // After posting, user's own post sits at position [1]; other posts start at [2].
    const enableComment = campaign.extraSettings?.enableComment ?? false
    const commentType = campaign.extraSettings?.commentType || 'own'
    const commentCount = campaign.extraSettings?.commentCount ?? 3
    let commentIndices: number[] = []
    if (enableComment) {
      if (commentType === 'own') {
        commentIndices = [1]
      } else {
        for (let i = 0; i < commentCount; i++) commentIndices.push(i + 2)
      }
    }

    // Prepare flow variables with campaign/detail data
    // The workflow nodes will consume these variables via blockInput/inputMapping
    const flowCopy = JSON.parse(JSON.stringify(flow))
    flowCopy.variables = {
      ...flowCopy.variables,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignContent: campaign.content,
      commentContent: campaign.extraSettings?.commentContent || '',
      sharePost: campaign.extraSettings?.sharePost ?? false,
      enableComment,
      commentType,
      commentCount,
      commentIndices,
      images: validImages,
      accountId: accountId,
      ...(detail ? {
        detailId: detail.id,
        detailName: detail.name,
        detailPhone: detail.phone,
        detailUid: detail.uid,
        detailEmail: detail.email
      } : {}),
      // Group posting extra settings
      leaveGroupOnPendingApproval: campaign.extraSettings?.leaveGroupOnPendingApproval ?? false,
      autoJoinGroupAfterPost: campaign.extraSettings?.autoJoinGroupAfterPost ?? false,
      shuffleGroupList: campaign.extraSettings?.shuffleGroupList ?? false
    }

    // Create a controller that uses the account's embedded webview
    const controller = this.webviewRegistry.getController(accountId)
    if (!controller) {
      throw new Error(`Không tìm thấy tab trình duyệt cho tài khoản ${accountId}`)
    }
    
    // Debug: Log the current URL
    try {
      const currentUrl = controller.getURL()
      console.log(`Campaign ${campaign.id} detail ${detailName} running on URL: ${currentUrl}`)
    } catch {}

    // Run the workflow — all browser actions (click, setValue, dropFile, etc.)
    // are defined as nodes in the workflow and executed by FlowRunner
    const runner = new FlowRunner(controller, this.supabase, (step: ExecutionStep) => {
      this.mainWindow.webContents.send(IPC_CHANNELS.FLOW_PROGRESS, step)
    })

    const result = await runner.run(flowCopy)

    // Inspect per-step outcomes so we log each milestone that actually
    // succeeded — even if the flow as a whole ended up failing later
    // (e.g. post succeeded but a comment failed).
    const postStep = result.steps.find(s => s.nodeId === 'node-block-post')
    const postSucceeded = postStep?.status === 'success'
    const commentSteps = result.steps.filter(s => s.nodeId === 'node-block-comment')
    const commentSuccessCount = commentSteps.filter(s => s.status === 'success').length

    // Detect pending approval via FB's banner text (so leaveGroupOnPendingApproval works)
    let isPendingPost = false
    if (detail && postSucceeded) {
      const leaveOnPending = campaign.extraSettings?.leaveGroupOnPendingApproval ?? false
      const joinAfterPost = campaign.extraSettings?.autoJoinGroupAfterPost ?? false
      if (leaveOnPending || joinAfterPost) {
        isPendingPost = await this.detectPostPending(controller)
      }
    }

    // Post-flow group actions (leaveGroupOnPendingApproval / autoJoinGroupAfterPost)
    let postPendingNote = ''
    if (detail && postSucceeded) {
      const leaveOnPending = campaign.extraSettings?.leaveGroupOnPendingApproval ?? false
      const joinAfterPost = campaign.extraSettings?.autoJoinGroupAfterPost ?? false
      if (isPendingPost && leaveOnPending) {
        const left = await this.leaveCurrentGroup(controller, campaign.id)
        postPendingNote = left ? 'Bài chờ duyệt - đã rời nhóm' : 'Bài chờ duyệt - không rời được nhóm'
      } else if (!isPendingPost && joinAfterPost) {
        await this.joinCurrentGroupIfNotMember(controller, campaign.id)
      }
    }

    if (detail) {
      // ----- Milestone 1: Post success -----
      if (postSucceeded) {
        this.sendLog(`📝 Đăng bài thành công vào "${detailName}"`)
        if (isPendingPost) this.sendLog(`⏳ Bài đang chờ duyệt`)

        try {
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            accountId: accountId,
            actionName: 'Đăng bài',
            status: 'success',
            log: `Đăng bài thành công vào ${detailName}${postPendingNote ? ` (${postPendingNote})` : ''}`
          })
        } catch (logErr) {
          console.error('Failed to log post detail action:', logErr)
        }
      }

      // ----- Milestone 2: Each successful comment -----
      if (enableComment && commentSuccessCount > 0) {
        const commentBody = campaign.extraSettings?.commentContent || ''
        const preview = commentBody.length > 50 ? commentBody.substring(0, 50) + '...' : commentBody
        for (let i = 0; i < commentSuccessCount; i++) {
          const position = commentIndices[i]
          const target = commentType === 'own' ? 'bài của mình' : `bài thứ ${position}`
          try {
            await this.supabase.createDetailAction({
              campaignDetailId: detail.id,
              campaignId: campaign.id,
              accountId: accountId,
              actionName: 'Comment',
              status: 'success',
              log: `Đã comment vào ${target}: "${preview}"`,
              data: {
                commentType,
                commentContent: commentBody,
                commentPosition: position,
                iteration: i + 1
              }
            })
            this.sendLog(`💬 Đã comment vào ${target} tại "${detailName}"`)
          } catch (logErr) {
            console.error('Failed to log comment detail action:', logErr)
          }
        }
      }

      // ----- Overall detail status -----
      if (result.status === 'completed') {
        await this.supabase.updateCampaignDetail(detail.id, {
          status: 'hoàn thành',
          note: postPendingNote || undefined
        })
        await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành: ${detailName}${postPendingNote ? ` - ${postPendingNote}` : ''}`)
        this.sendLog(`✅ Hoàn thành "${detailName}"`)
      } else {
        // Figure out which milestone failed so the error message is specific
        let failureLabel = ''
        let errorMsg = result.error || 'Lỗi không xác định'
        if (!postSucceeded) {
          failureLabel = 'Đăng bài lỗi'
          errorMsg = `Đăng bài thất bại: ${errorMsg}`
        } else if (enableComment && commentSuccessCount < commentIndices.length) {
          failureLabel = 'Comment lỗi'
          errorMsg = `Comment thất bại ở lần thứ ${commentSuccessCount + 1}/${commentIndices.length}: ${result.error || 'Lỗi không xác định'}`
        } else {
          failureLabel = 'Lỗi thực thi'
        }

        await this.supabase.updateCampaignDetail(detail.id, {
          status: 'lỗi',
          note: errorMsg
        })
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${detailName} - ${errorMsg}`)
        this.sendLog(`❌ Lỗi "${detailName}": ${errorMsg}`)

        try {
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            accountId: accountId,
            actionName: failureLabel,
            status: 'error',
            log: errorMsg
          })
        } catch (logErr) {
          console.error('Failed to log error action:', logErr)
        }
      }
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
   * Detect whether the just-submitted post is awaiting admin approval by
   * scanning for FB's pending banner text.
   */
  private async detectPostPending(
    controller: import('../../shared/types').IBrowserController
  ): Promise<boolean> {
    await new Promise(r => setTimeout(r, 3500))
    const selector = `//*[contains(text(),"đang chờ được duyệt") or contains(text(),"chờ phê duyệt") or contains(text(),"Bài viết đang chờ duyệt") or contains(text(),"pending approval") or contains(text(),"Post pending approval")]`
    try {
      const check = await controller.executeAction('waitForSelector', { selector, timeout: 2500 })
      return check.success && check.output?.found !== false
    } catch {
      return false
    }
  }

  // =========== Group Post Post-flow Actions ===========

  /**
   * Open the group's "Joined" menu and leave the group, then confirm.
   * Caller should already be on the group page.
   */
  private async leaveCurrentGroup(
    controller: import('../../shared/types').IBrowserController,
    campaignId: number
  ): Promise<boolean> {
    try {
      const joinedMenuSelector = `//*[@role="button" and (contains(@aria-label,"Đã tham gia") or contains(@aria-label,"Joined") or .="Đã tham gia" or .="Joined")]`
      const menuCheck = await controller.executeAction('waitForSelector', { selector: joinedMenuSelector, timeout: 4000 })
      if (!menuCheck.success || menuCheck.output?.found === false) {
        this.sendLog('⚠️ Không tìm thấy menu "Đã tham gia"')
        return false
      }
      await controller.executeAction('click', { selector: joinedMenuSelector })
      await new Promise(r => setTimeout(r, 1500))

      const leaveItemSelector = `//*[@role="menuitem" and (contains(.,"Rời nhóm") or contains(.,"Rời khỏi nhóm") or contains(.,"Leave group") or contains(.,"Leave Group"))]`
      const leaveClick = await controller.executeAction('click', { selector: leaveItemSelector })
      if (!leaveClick.success) {
        this.sendLog('⚠️ Không tìm thấy mục "Rời nhóm" trong menu')
        return false
      }
      await new Promise(r => setTimeout(r, 1500))

      const confirmSelector = `//*[@role="button" and (.="Rời nhóm" or .="Rời khỏi nhóm" or .="Leave Group" or .="Leave group")]`
      await controller.executeAction('click', { selector: confirmSelector })
      await new Promise(r => setTimeout(r, 2000))

      this.sendLog('👋 Đã rời nhóm (do bài đăng chờ duyệt)')
      await this.supabase.appendCampaignLog(campaignId, 'Đã rời nhóm do bài đăng chờ duyệt')
      return true
    } catch (err) {
      console.error('leaveCurrentGroup error:', err)
      this.sendLog(`⚠️ Lỗi khi rời nhóm: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  /**
   * If a Join button is visible on the current group page, click it.
   * No-op if the user is already a member (button absent).
   */
  private async joinCurrentGroupIfNotMember(
    controller: import('../../shared/types').IBrowserController,
    campaignId: number
  ): Promise<boolean> {
    try {
      const joinSelector = `//*[@role="button" and (contains(@aria-label,"Tham gia nhóm") or contains(@aria-label,"Join group") or .="Tham gia nhóm" or .="Join group" or .="Tham gia" or .="Join")]`
      const check = await controller.executeAction('waitForSelector', { selector: joinSelector, timeout: 2500 })
      if (!check.success || check.output?.found === false) {
        return false
      }
      await controller.executeAction('click', { selector: joinSelector })
      await new Promise(r => setTimeout(r, 2500))
      this.sendLog('🤝 Đã nhấn "Tham gia nhóm"')
      await this.supabase.appendCampaignLog(campaignId, 'Tự động tham gia nhóm sau khi đăng bài thành công')
      return true
    } catch (err) {
      console.error('joinCurrentGroupIfNotMember error:', err)
      return false
    }
  }

  // =========== Facebook Message & Friend Request Campaign ===========

  /**
   * Extract a clean UID/username from user input that may be a full Facebook URL.
   * Examples:
   *   "https://www.facebook.com/quangnhut27" → "quangnhut27"
   *   "https://www.facebook.com/profile.php?id=100012345" → "100012345"
   *   "https://facebook.com/quangnhut27/" → "quangnhut27"
   *   "quangnhut27" → "quangnhut27"
   *   "100012345" → "100012345"
   */
  private extractUidFromInput(raw: string): string {
    const trimmed = raw.trim()
    try {
      const url = new URL(trimmed)
      // Handle profile.php?id=xxx
      const idParam = url.searchParams.get('id')
      if (idParam) return idParam
      // Handle /username or /username/
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length > 0) return parts[parts.length - 1]
    } catch {
      // Not a URL, return as-is
    }
    return trimmed
  }

  private async executeMessageFriendCampaign(
    account: import('../../shared/types').FlatformAccount,
    campaign: Campaign
  ): Promise<void> {
    const enableMessage = campaign.extraSettings?.enableMessage ?? true
    const enableAddFriend = campaign.extraSettings?.enableAddFriend ?? false
    const messageContent = campaign.content || ''

    if (!enableMessage && !enableAddFriend) {
      await this.supabase.appendCampaignLog(campaign.id, 'Lỗi: Chưa chọn hành động nào (nhắn tin hoặc kết bạn)')
      await this.supabase.updateCampaign(campaign.id, { status: 'lỗi' })
      return
    }

    const details = await this.supabase.listCampaignDetails(campaign.id)
    if (details.length === 0) {
      await this.supabase.appendCampaignLog(campaign.id, 'Không có data để xử lý')
      await this.supabase.updateCampaign(campaign.id, { status: 'hoàn thành' })
      return
    }

    const controller = this.webviewRegistry.getController(account.id)
    if (!controller) {
      await this.supabase.appendCampaignLog(campaign.id, 'Lỗi: Không tìm thấy tab trình duyệt')
      await this.supabase.updateCampaign(campaign.id, { status: 'lỗi' })
      return
    }

    let rateLimitReached = false
    const limitConfig = campaign.extraSettings?.actionLimits

    for (let i = 0; i < details.length; i++) {
      // Check if campaign was paused
      const currentCamp = await this.supabase.getCampaign(campaign.id)
      if (currentCamp && currentCamp.status === 'tạm dừng') {
        this.sendLog(`⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`)
        await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
        return
      }

      const detail = details[i]
      if (detail.status !== 'chờ xử lý') continue

      const detailName = detail.name || detail.uid || 'N/A'
      const uid = detail.uid ? this.extractUidFromInput(detail.uid) : ''

      if (!uid) {
        await this.supabase.updateCampaignDetail(detail.id, { status: 'lỗi', note: 'Thiếu UID' })
        await this.supabase.createDetailAction({
          campaignDetailId: detail.id,
          campaignId: campaign.id,
          accountId: account.id,
          actionName: 'Bỏ qua',
          status: 'error',
          log: `Bỏ qua ${detailName}: thiếu UID`
        })
        continue
      }

      // Check rate limit
      const actionName = enableMessage ? 'Nhắn tin' : 'Kết bạn'
      try {
        const limitStatus = await this.supabase.getAccountRateLimitStatus(account.id, actionName, limitConfig)
        if (!limitStatus.ok) {
          rateLimitReached = true
          await this.supabase.appendCampaignLog(campaign.id, `Tạm dừng do vượt giới hạn: ${limitStatus.reason}`)
          this.sendLog(`⚠️ Tạm dừng "${campaign.name}" do giới hạn: ${limitStatus.reason}`)
          break
        }
      } catch (err) {
        console.error('Rate limit check error:', err)
      }

      await this.supabase.updateCampaignDetail(detail.id, {
        status: 'đang chạy',
        dateAction: new Date().toISOString()
      })
      this.sendLog(`▶️ Xử lý "${detailName}" trong chiến dịch "${campaign.name}"`)

      let detailSuccess = true

      // Resolve images for this detail (per-detail so 'random' picks vary)
      const imageOption = campaign.extraSettings?.imageOption || 'none'
      const availableImages = campaign.images || []
      let finalImages: string[] = []
      if (imageOption === 'all') {
        finalImages = [...availableImages]
      } else if (imageOption === 'random') {
        const count = campaign.extraSettings?.randomImageCount || 3
        finalImages = [...availableImages].sort(() => 0.5 - Math.random()).slice(0, count)
      }
      const validImages = finalImages.filter(fp => fp.startsWith('data:') || existsSync(fp))
      if (finalImages.length > 0 && validImages.length < finalImages.length) {
        const missing = finalImages.filter(fp => !fp.startsWith('data:') && !existsSync(fp))
        const msg = `⚠️ Bỏ qua ${missing.length}/${finalImages.length} ảnh không tìm thấy: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}`
        this.sendLog(msg)
        await this.supabase.appendCampaignLog(campaign.id, msg)
      }

      // --- Send Message ---
      if (enableMessage && (messageContent || validImages.length > 0)) {
        try {
          await this.sendFacebookMessage(controller, uid, messageContent, validImages)
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            accountId: account.id,
            actionName: 'Nhắn tin',
            status: 'success',
            log: `Nhắn tin thành công đến ${detailName}`
          })
          this.sendLog(`💬 Nhắn tin thành công đến "${detailName}"`)
        } catch (err: any) {
          detailSuccess = false
          const errMsg = err.message || String(err)
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            accountId: account.id,
            actionName: 'Nhắn tin',
            status: 'error',
            log: `Lỗi nhắn tin đến ${detailName}: ${errMsg}`
          })
          this.sendLog(`❌ Lỗi nhắn tin "${detailName}": ${errMsg}`)
        }
      }

      // --- Add Friend ---
      if (enableAddFriend) {
        try {
          await this.sendFriendRequest(controller, uid)
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            accountId: account.id,
            actionName: 'Kết bạn',
            status: 'success',
            log: `Kết bạn thành công với ${detailName}`
          })
          this.sendLog(`🤝 Kết bạn thành công với "${detailName}"`)
        } catch (err: any) {
          detailSuccess = false
          const errMsg = err.message || String(err)
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            accountId: account.id,
            actionName: 'Kết bạn',
            status: 'error',
            log: `Lỗi kết bạn với ${detailName}: ${errMsg}`
          })
          this.sendLog(`❌ Lỗi kết bạn "${detailName}": ${errMsg}`)
        }
      }

      // Update detail status
      await this.supabase.updateCampaignDetail(detail.id, {
        status: detailSuccess ? 'hoàn thành' : 'lỗi',
        note: detailSuccess ? '' : 'Có lỗi xảy ra'
      })
      await this.supabase.appendCampaignLog(campaign.id,
        detailSuccess ? `Hoàn thành: ${detailName}` : `Lỗi: ${detailName}`
      )

      // Sleep between details
      if (i < details.length - 1) {
        const sleepTime = campaign.extraSettings?.actionLimits?.sleepBetweenActions || campaign.timeSleepBetween2 || 0
        if (sleepTime > 0) {
          this.sendLog(`⏳ Nghỉ ${sleepTime}s trước khi xử lý mục tiếp theo...`)
          await new Promise(resolve => setTimeout(resolve, sleepTime * 1000))
        }
      }
    }

    if (rateLimitReached) {
      if (campaign.scheduleType === 'daily' && campaign.continueNextDay && campaign.schedule) {
        const now = new Date()
        const schedDate = new Date(campaign.schedule)
        const tomorrow = new Date(now)
        tomorrow.setDate(tomorrow.getDate() + 1)
        tomorrow.setHours(schedDate.getHours(), schedDate.getMinutes(), 0, 0)
        await this.supabase.updateCampaign(campaign.id, { status: 'chờ xử lý', schedule: tomorrow.toISOString() })
        await this.supabase.appendCampaignLog(campaign.id, `Tạm dừng do đạt giới hạn. Chạy tiếp vào ${tomorrow.toLocaleString('vi-VN')}`)
      } else {
        await this.supabase.updateCampaign(campaign.id, { status: 'chờ xử lý' })
      }
    } else {
      await this.handleCampaignCompletion(campaign)
    }

    await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
  }

  /**
   * Send a Facebook message to a user via Facebook Messenger.
   * Navigate to facebook.com/messages/t/{uid}, type message, send.
   * Handles two common blocking scenarios:
   *   1) PIN recovery dialog ("Nhập mã PIN để khôi phục đoạn chat") → close it
   *   2) "Tiếp tục" (Continue) button at the bottom → click it
   */
  private async sendFacebookMessage(
    controller: import('../../shared/types').IBrowserController,
    uid: string,
    message: string,
    images: string[] = []
  ): Promise<void> {
    // Navigate to Facebook messenger conversation
    await controller.executeAction('navigate', { url: `https://www.facebook.com/messages/t/${uid}` })
    await new Promise(r => setTimeout(r, 4000))

    // --- Handle blocking scenario 1: PIN recovery dialog ---
    // Try to close the dialog by clicking the X (close) button
    // Use short timeout to avoid wasting time if no dialog exists
    const pinDialogCheck = await controller.executeAction('waitForSelector', {
      selector: '[aria-label="Đóng"], [aria-label="Close"]',
      timeout: 3000
    })
    if (pinDialogCheck.success && pinDialogCheck.output?.found !== false) {
      await controller.executeAction('click', {
        selector: '[aria-label="Đóng"], [aria-label="Close"]'
      })
      this.sendLog('📌 Đã đóng dialog khôi phục đoạn chat')
      await new Promise(r => setTimeout(r, 2000))

      // --- Handle confirmation dialog: "Tiếp tục mà không khôi phục?" ---
      // The blue button
      const confirmCheck = await controller.executeAction('waitForSelector', {
        selector: '//*[@role="button" and @aria-label="Không khôi phục tin nhắn" and @tabindex="0"]',
        timeout: 3000
      })
      if (confirmCheck.success && confirmCheck.output?.found !== false) {
        await controller.executeAction('click', {
          selector: '//*[@role="button" and @aria-label="Không khôi phục tin nhắn" and @tabindex="0"]'
        })
        this.sendLog('📌 Đã nhấn "Không khôi phục tin nhắn"')
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    // --- Handle blocking scenario 2: "Tiếp tục" button ---
    // Facebook sometimes shows an end-to-end encryption notice with a "Tiếp tục" button
    const continueCheck = await controller.executeAction('waitForSelector', {
      selector: '//*[@role="button" and .="Tiếp tục"]',
      timeout: 2000
    })
    if (continueCheck.success && continueCheck.output?.found !== false) {
      await controller.executeAction('click', {
        selector: '//*[@role="button" and .="Tiếp tục"]'
      })
      this.sendLog('📌 Đã nhấn nút Tiếp tục')
      await new Promise(r => setTimeout(r, 2000))
    }

    // Wait for the message input to appear
    await controller.executeAction('waitForSelector', {
      selector: '[role="textbox"][contenteditable="true"]',
      timeout: 15000
    })
    await new Promise(r => setTimeout(r, 1000))

    // Click into the message input
    await controller.executeAction('click', {
      selector: '[role="textbox"][contenteditable="true"]'
    })
    await new Promise(r => setTimeout(r, 500))

    // Set the message content (uses paste-based approach for multiline support)
    if (message) {
      await controller.executeAction('setValue', {
        selector: '[role="textbox"][contenteditable="true"]',
        value: message
      })
      await new Promise(r => setTimeout(r, 1000))
    }

    // Attach images via drag-and-drop onto the message textbox
    if (images.length > 0) {
      const dropResult = await controller.executeAction('dropFile', {
        selector: '[role="textbox"][contenteditable="true"]',
        filePaths: images
      })
      if (!dropResult.success) {
        throw new Error('Không thể đính kèm ảnh vào tin nhắn')
      }
      this.sendLog(`🖼 Đã đính kèm ${images.length} ảnh vào tin nhắn`)
      // Wait for previews/uploads to finalize before sending
      await new Promise(r => setTimeout(r, Math.max(3000, images.length * 1500)))
    }

    // Press Enter to send
    await controller.executeAction('pressKey', { key: 'Enter' })
    await new Promise(r => setTimeout(r, 2000))
  }

  /**
   * Send a friend request to a Facebook user.
   * Navigate to their profile and click "Add Friend" button.
   */
  private async sendFriendRequest(
    controller: import('../../shared/types').IBrowserController,
    uid: string
  ): Promise<void> {
    // Navigate to the user's profile
    const profileUrl = uid.match(/^\d+$/)
      ? `https://www.facebook.com/profile.php?id=${uid}`
      : `https://www.facebook.com/${uid}`

    await controller.executeAction('navigate', { url: profileUrl })
    await new Promise(r => setTimeout(r, 3000))

    // Wait for profile page
    await controller.executeAction('waitForSelector', {
      selector: '[role="main"]',
      timeout: 10000
    })
    await new Promise(r => setTimeout(r, 1500))

    // Click the "Thêm bạn bè" button using exact XPath
    const addFriendResult = await controller.executeAction('click', {
      selector: '//*[@role="button" and .="Thêm bạn bè"]'
    })

    if (!addFriendResult.success) {
      throw new Error('Không tìm thấy nút Kết bạn. Có thể đã là bạn bè hoặc đã gửi lời mời.')
    }

    await new Promise(r => setTimeout(r, 2000))
  }
}
