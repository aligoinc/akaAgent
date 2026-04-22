import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { FlowRunner } from '../playwright/flowRunner'
import { IPC_CHANNELS, ExecutionStep, Campaign, CampaignDetail } from '../../shared/types'
import {
  FB_SHARE_POST_WORKFLOW_ID,
  FB_REELS_WORKFLOW_ID,
  FB_POST_COPY_SOURCE_WORKFLOW_ID,
  FB_MESSAGE_FRIEND_WORKFLOW_ID,
  FB_GROUP_POST_COMPLETION_BLOCK_ID
} from '../data/seed/builtinCampaignActions'

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
          this.sendLog(`⚠️ Kênh "${channel.name}" chưa mở tab trình duyệt. Bỏ qua.`)
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
        // Past end date, mark as complete
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
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
    // Check schedule type eligibility
    if (!this.shouldRunToday(campaign)) {
      return
    }

    try {
      // Update campaign status to running
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'đang chạy' })
      await this.supabase.appendCampaignLog(campaign.id, `Bắt đầu chạy chiến dịch`)
      this.sendLog(`🚀 Bắt đầu chiến dịch "${campaign.name}" trên kênh "${channel.name}"`)

      // Update channel status to running
      await this.supabase.updateChannel(channel.id, { status: 'đang chạy' })

      // Get the campaign action and its workflow
      const action = await this.supabase.getCampaignAction(campaign.actionId)
      if (!action) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Không tìm thấy action`)
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Không tìm thấy action "${campaign.actionId}"`)
        return
      }

      // === Message & Friend Request campaign: no workflow, direct browser automation ===
      if (campaign.actionId === 'facebook_message_friend') {
        await this.executeMessageFriendCampaign(channel, campaign)
        return
      }

      if (!action.workflowId) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Không tìm thấy workflow`)
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Không tìm thấy workflow cho action "${campaign.actionId}"`)
        return
      }

      // Load the workflow/flow
      const flow = await this.supabase.loadFlow(action.workflowId)
      if (!flow) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Không tìm thấy flow ${action.workflowId}`)
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
        this.sendLog(`❌ Chiến dịch "${campaign.name}": Không tìm thấy flow`)
        return
      }

      // === Timeline post with source options: custom handling ===
      // (copy content / share / reels — run once then completion, similar to simple campaign)
      const extraForTimeline = campaign.extraSettings || {}
      const needTimelineCustom = campaign.actionId === 'facebook_timeline_post' && (
        extraForTimeline.copyContentFromSource === true ||
        extraForTimeline.sharePost === true ||
        extraForTimeline.postAsReels === true
      )
      if (needTimelineCustom) {
        await this.executeTimelinePostCampaign(channel, campaign, flow)
        await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
        return
      }

      // Get campaign details
      const details = await this.supabase.listCampaignDetails(campaign.id)

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
          const limitStatus = await this.supabase.getChannelRateLimitStatus(channel.id, 'Đăng bài', limitConfig)
          if (!limitStatus.ok) {
            await this.supabase.appendCampaignLog(campaign.id, `Từ chối chạy do vượt giới hạn Đăng bài: ${limitStatus.reason}`)
            this.sendLog(`⚠️ Từ chối "${campaign.name}" do giới hạn Đăng bài: ${limitStatus.reason}`)
            await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý' })
            await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
            return
          }
        } catch (err) {
          console.error('Rate limit check error:', err)
        }

        const campaignToRun = {
          ...campaign,
          extraSettings: { ...campaign.extraSettings, enableComment: overrideEnableComment }
        }
        await this.runWorkflowForDetail(channel.id, campaignToRun, flow, null)
        await this.handleCampaignCompletion(campaign)
      } else {
        let rateLimitReached = false

        // Run workflow for each detail
        for (let i = 0; i < details.length; i++) {
          // Kiểm tra xem chiến dịch có bị tạm dừng trong lúc đang chạy không
          const currentCamp = await this.supabase.getCampaign(campaign.id);
          if (currentCamp && currentCamp.status === 'tạm dừng') {
            this.sendLog(`⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`);
            await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
            return; // Thoát khỏi chiến dịch hiện tại
          }

          const detail = details[i]
          if (detail.status !== 'chờ xử lý') continue

          const limitConfig = campaign.extraSettings?.actionLimits
          let overrideEnableComment = campaign.extraSettings?.enableComment ?? false

          // Check Rate limit before processing
          try {
            const limitStatus = await this.supabase.getChannelRateLimitStatus(channel.id, 'Đăng bài', limitConfig)
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
          await this.runWorkflowForDetail(channel.id, campaignToRun, flow, detail, i)

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
              
              await this.updateCampaignAndBroadcast(campaign.id, {
                status: 'chờ xử lý',
                schedule: tomorrow.toISOString()
              })
              await this.supabase.appendCampaignLog(campaign.id, `Tạm dừng do đạt giới hạn. Cập nhật lịch chạy tiếp vào ${tomorrow.toLocaleString('vi-VN')}`)
              this.sendLog(`🔄 Chiến dịch "${campaign.name}" sẽ chạy tiếp vào ${tomorrow.toLocaleString('vi-VN')}`)
            } else {
              await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý' })
            }
          } else {
            await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý' })
          }
        } else {
          // Handle completion based on schedule type
          await this.handleCampaignCompletion(campaign)
        }
      }

      // Reset channel status
      await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.recoverStuckDetails(campaign.id, errMsg)
      await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
      this.sendLog(`❌ Lỗi chiến dịch "${campaign.name}": ${errMsg}`)
      // Đối với simple campaign (không có detail row), ghi 1 entry vào detail_actions
      // để khách hàng có lịch sử lỗi để xem.
      if (campaign.actionId === 'facebook_timeline_post') {
        try {
          await this.supabase.createDetailAction({
            campaignId: campaign.id,
            channelId: channel.id,
            actionName: 'Đăng bài',
            status: 'error',
            log: errMsg
          })
        } catch {}
      }
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
    channelId: number,
    campaign: Campaign,
    flow: import('../../shared/types').FlowData,
    detail: CampaignDetail | null,
    detailIndex: number = 0
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

    // Phân tách nội dung theo dấu `|` → deterministic cycle theo chỉ số:
    //   - Bài đăng: detail thứ N dùng variant[N % numVariants].
    //   - Comment trong cùng 1 group: comment thứ K dùng variant[K % numVariants],
    //     reset lại đầu variant list ở mỗi group.
    const postVariants = this.splitContentVariants(campaign.content)
    const commentVariants = this.splitContentVariants(campaign.extraSettings?.commentContent)
    const selectedPostContent = this.cycleVariant(postVariants, detailIndex)
    // `commentIterations[k] = { position, text }` — flow loop iterates mảng này
    // thay vì commentIndices, block dùng sourcePath để lấy position + text.
    const commentIterations = commentIndices.map((position, k) => ({
      position,
      text: this.cycleVariant(commentVariants, k)
    }))
    // `selectedCommentContent` dùng cho preview log per-comment bên dưới.
    const selectedCommentContent = commentVariants[0] || ''

    // Prepare flow variables with campaign/detail data
    // The workflow nodes will consume these variables via blockInput/inputMapping
    const flowCopy = JSON.parse(JSON.stringify(flow))
    flowCopy.variables = {
      ...flowCopy.variables,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignContent: selectedPostContent,
      commentContent: selectedCommentContent,
      sharePost: campaign.extraSettings?.sharePost ?? false,
      enableComment,
      commentType,
      commentCount,
      commentIndices,
      commentIterations,
      images: validImages,
      channelId: channelId,
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

    // Create a controller that uses the channel's embedded webview
    const controller = this.webviewRegistry.getController(channelId)
    if (!controller) {
      throw new Error(`Không tìm thấy tab trình duyệt cho kênh ${channelId}`)
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

    // Detect pending + post-flow group actions (leave/join) — invoke sub-block.
    // Block tự xử lý điều kiện (enabled + isPending) trong từng action node.
    let isPendingPost = false
    let postPendingNote = ''
    if (detail && postSucceeded) {
      const leaveOnPending = campaign.extraSettings?.leaveGroupOnPendingApproval ?? false
      const joinAfterPost = campaign.extraSettings?.autoJoinGroupAfterPost ?? false
      if (leaveOnPending || joinAfterPost) {
        try {
          const completionBlock = await this.supabase.loadFlow(FB_GROUP_POST_COMPLETION_BLOCK_ID)
          if (completionBlock) {
            const blockCopy = JSON.parse(JSON.stringify(completionBlock))
            blockCopy.variables = {
              ...(blockCopy.variables || {}),
              leaveOnPending,
              joinAfterPost
            }
            const completionRunner = new FlowRunner(controller, this.supabase, () => {})
            const completionRun = await completionRunner.run(blockCopy)
            isPendingPost = (completionRun.output?.isPending as boolean) === true
            const left = (completionRun.output?.left as boolean) === true
            const joined = (completionRun.output?.joined as boolean) === true

            if (isPendingPost && leaveOnPending) {
              postPendingNote = left ? 'Bài chờ duyệt - đã rời nhóm' : 'Bài chờ duyệt - không rời được nhóm'
              if (left) {
                this.sendLog('👋 Đã rời nhóm (do bài đăng chờ duyệt)')
                await this.supabase.appendCampaignLog(campaign.id, 'Đã rời nhóm do bài đăng chờ duyệt')
              }
            } else if (!isPendingPost && joinAfterPost && joined) {
              this.sendLog('🤝 Đã nhấn "Tham gia nhóm"')
              await this.supabase.appendCampaignLog(campaign.id, 'Tự động tham gia nhóm sau khi đăng bài thành công')
            }
          } else {
            console.warn('[Scheduler] Group post completion block not found, skipping leave/join')
          }
        } catch (err) {
          console.error('[Scheduler] Group post completion block failed:', err)
        }
      }
    }

    // ===== Simple campaign (no detail row): vẫn ghi 1 entry vào detail_actions =====
    // để khách hàng thấy lịch sử chạy giống như các chiến dịch có data.
    // Lưu ý: KHÔNG dùng `postSucceeded` (chỉ match `node-block-post` của workflow
    // group post) — workflow timeline post có node ID khác (`node_click_post`).
    // Với simple campaign, success = cả workflow chạy xong = result.status='completed'.
    if (!detail) {
      if (result.status === 'completed') {
        this.sendLog(`📝 Đăng bài thành công`)
        try {
          await this.supabase.createDetailAction({
            campaignId: campaign.id,
            channelId: channelId,
            actionName: 'Đăng bài',
            status: 'success',
            log: 'Đăng bài thành công'
          })
        } catch (logErr) {
          console.error('Failed to log post detail action (no detail):', logErr)
        }
      } else {
        // Throw để outer try/catch ghi 1 entry detail_action lỗi (campaign status
        // vẫn là 'hoàn thành' — campaign chỉ có 4 status: chờ xử lý / tạm dừng /
        // đang chạy / hoàn thành; lỗi được lưu trong campaign.log + detail_actions).
        throw new Error(result.error || 'Workflow không chạy xong')
      }
      return
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
            channelId: channelId,
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
        for (let i = 0; i < commentSuccessCount; i++) {
          const iter = commentIterations[i]
          const position = iter?.position ?? commentIndices[i]
          const commentBody = iter?.text || ''
          const preview = commentBody.length > 50 ? commentBody.substring(0, 50) + '...' : commentBody
          const target = commentType === 'own' ? 'bài của mình' : `bài thứ ${position}`
          try {
            await this.supabase.createDetailAction({
              campaignDetailId: detail.id,
              campaignId: campaign.id,
              channelId: channelId,
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
            channelId: channelId,
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

  // =========== Facebook Message & Friend Request Campaign ===========
  // Group post post-flow actions (detect pending / leave group / join group) đã
  // được refactor sang FB_GROUP_POST_COMPLETION_BLOCK_ID — sub-block invoke từ
  // runWorkflowForDetail. 3 helper cũ (detectPostPending, leaveCurrentGroup,
  // joinCurrentGroupIfNotMember) đã chuyển thành action types fbDetectPostPending,
  // fbLeaveGroupIfPending, fbJoinGroupIfNotMember trong webviewController.

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
   *   cycleVariant(['a','b','c'], 0) → 'a'
   *   cycleVariant(['a','b','c'], 3) → 'a' (cycle)
   */
  private cycleVariant(variants: string[], index: number): string {
    if (variants.length === 0) return ''
    const safeIdx = ((index % variants.length) + variants.length) % variants.length
    return variants[safeIdx]
  }

  /**
   * Loop qua details, mỗi detail invoke FB_MESSAGE_FRIEND_WORKFLOW_ID 1 lần
   * (workflow chứa 2 action node fbSendMessage + fbAddFriend, mỗi action self-catch
   * lỗi và trả qua output.ok/error nên cả 2 đều chạy độc lập). Scheduler đọc
   * step.output để log per-action vào detail_actions.
   */
  private async executeMessageFriendCampaign(
    channel: import('../../shared/types').OrgChannel,
    campaign: Campaign
  ): Promise<void> {
    const enableMessage = campaign.extraSettings?.enableMessage ?? true
    const enableAddFriend = campaign.extraSettings?.enableAddFriend ?? false
    const messageContent = campaign.content || ''

    if (!enableMessage && !enableAddFriend) {
      await this.supabase.appendCampaignLog(campaign.id, 'Lỗi: Chưa chọn hành động nào (nhắn tin hoặc kết bạn)')
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      return
    }

    const details = await this.supabase.listCampaignDetails(campaign.id)
    if (details.length === 0) {
      await this.supabase.appendCampaignLog(campaign.id, 'Không có data để xử lý')
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      return
    }

    const flow = await this.supabase.loadFlow(FB_MESSAGE_FRIEND_WORKFLOW_ID)
    if (!flow) {
      await this.supabase.appendCampaignLog(campaign.id, 'Lỗi: Không tìm thấy workflow Nhắn tin & Kết bạn')
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      return
    }

    let rateLimitReached = false
    const limitConfig = campaign.extraSettings?.actionLimits

    for (let i = 0; i < details.length; i++) {
      // Check if campaign was paused
      const currentCamp = await this.supabase.getCampaign(campaign.id)
      if (currentCamp && currentCamp.status === 'tạm dừng') {
        this.sendLog(`⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`)
        await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
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
          channelId: channel.id,
          actionName: 'Bỏ qua',
          status: 'error',
          log: `Bỏ qua ${detailName}: thiếu UID`
        })
        continue
      }

      // Rate limit check
      const actionName = enableMessage ? 'Nhắn tin' : 'Kết bạn'
      try {
        const limitStatus = await this.supabase.getChannelRateLimitStatus(channel.id, actionName, limitConfig)
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

      // Resolve ảnh per-detail (random pick khác nhau giữa các detail)
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

      // Cycle biến thể nội dung nhắn tin theo thứ tự detail (tách bằng `|`).
      // Detail thứ N → variant[N % numVariants].
      const messageVariants = this.splitContentVariants(messageContent)
      const selectedMessageContent = this.cycleVariant(messageVariants, i)

      // Skip nếu enableMessage nhưng không có nội dung và không có ảnh (matches old behavior)
      const effectiveEnableMessage = enableMessage && (selectedMessageContent.trim().length > 0 || validImages.length > 0)

      // Run workflow
      const flowCopy = JSON.parse(JSON.stringify(flow))
      flowCopy.variables = {
        ...(flowCopy.variables || {}),
        detailUid: uid,
        campaignContent: selectedMessageContent,
        images: validImages,
        enableMessage: effectiveEnableMessage,
        enableAddFriend
      }

      const controller = this.webviewRegistry.getController(channel.id)
      if (!controller) {
        await this.supabase.appendCampaignLog(campaign.id, 'Lỗi: Không tìm thấy tab trình duyệt')
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
        return
      }

      const runner = new FlowRunner(controller, this.supabase, (step: ExecutionStep) => {
        this.mainWindow.webContents.send(IPC_CHANNELS.FLOW_PROGRESS, step)
      })

      let detailSuccess = true
      let runError: string | null = null
      let runResult: import('../../shared/types').ExecutionRun | null = null
      try {
        runResult = await runner.run(flowCopy)
      } catch (err: any) {
        runError = err?.message || String(err)
        detailSuccess = false
      }

      // Inspect step outcomes per action node ID
      const msgStep = runResult?.steps.find(s => s.nodeId === 'node_send_msg')
      const friendStep = runResult?.steps.find(s => s.nodeId === 'node_add_friend')

      // --- Per-action logging: Nhắn tin ---
      if (effectiveEnableMessage && msgStep) {
        const msgOk = msgStep.status === 'success' && (msgStep.output as any)?.ok === true
        if (msgOk) {
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            channelId: channel.id,
            actionName: 'Nhắn tin',
            status: 'success',
            log: `Nhắn tin thành công đến ${detailName}`
          })
          this.sendLog(`💬 Nhắn tin thành công đến "${detailName}"`)
        } else {
          detailSuccess = false
          const errMsg = (msgStep.output as any)?.error || msgStep.error || runError || 'Lỗi không xác định'
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            channelId: channel.id,
            actionName: 'Nhắn tin',
            status: 'error',
            log: `Lỗi nhắn tin đến ${detailName}: ${errMsg}`
          })
          this.sendLog(`❌ Lỗi nhắn tin "${detailName}": ${errMsg}`)
        }
      }

      // --- Per-action logging: Kết bạn ---
      if (enableAddFriend && friendStep) {
        const frdOk = friendStep.status === 'success' && (friendStep.output as any)?.ok === true
        if (frdOk) {
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            channelId: channel.id,
            actionName: 'Kết bạn',
            status: 'success',
            log: `Kết bạn thành công với ${detailName}`
          })
          this.sendLog(`🤝 Kết bạn thành công với "${detailName}"`)
        } else {
          detailSuccess = false
          const errMsg = (friendStep.output as any)?.error || friendStep.error || runError || 'Lỗi không xác định'
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            channelId: channel.id,
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
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý', schedule: tomorrow.toISOString() })
        await this.supabase.appendCampaignLog(campaign.id, `Tạm dừng do đạt giới hạn. Chạy tiếp vào ${tomorrow.toLocaleString('vi-VN')}`)
      } else {
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý' })
      }
    } else {
      await this.handleCampaignCompletion(campaign)
    }

    await this.supabase.updateChannel(channel.id, { status: 'chờ xử lý' })
  }

  // =========== Facebook Timeline Post — Source Options ===========

  /**
   * Handle facebook_timeline_post campaigns that use source-link features
   * (copyContentFromSource / sharePost / postAsReels).
   *
   * Architecture: scheduler chỉ làm orchestration (rotate link, rate-limit,
   * data merge). Tất cả browser automation (scrape, share, reels) chạy qua
   * action handlers trong WebviewController, được wrap thành block/workflow
   * trong builtinCampaignActions:
   *   - FB_SCRAPE_POST_BLOCK_ID   (block isBlock=true) → scrape source + download ảnh
   *   - FB_SHARE_POST_WORKFLOW_ID (workflow)            → đăng bằng cách chia sẻ
   *   - FB_REELS_WORKFLOW_ID      (workflow)            → đăng Reels
   * Default: dùng workflow timeline post hiện có.
   */
  private async executeTimelinePostCampaign(
    channel: import('../../shared/types').OrgChannel,
    campaign: Campaign,
    flow: import('../../shared/types').FlowData
  ): Promise<void> {
    const extra = campaign.extraSettings || {}

    // --- Rotate source link (mỗi lần chạy 1 link) ---
    const sourceLinks = (extra.sourceLinks || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    let currentLink: string | null = null
    if (sourceLinks.length > 0) {
      const idx = (extra.sourceLinkIndex || 0) % sourceLinks.length
      currentLink = sourceLinks[idx]
      const nextIdx = (idx + 1) % sourceLinks.length
      try {
        await this.updateCampaignAndBroadcast(campaign.id, {
          extraSettings: { ...extra, sourceLinkIndex: nextIdx }
        })
      } catch (err) {
        console.error('Failed to persist sourceLinkIndex:', err)
      }
      this.sendLog(`🔗 Link nguồn #${idx + 1}/${sourceLinks.length}: ${currentLink}`)
    }

    // Validate prerequisites
    if ((extra.copyContentFromSource || extra.sharePost) && !currentLink) {
      const msg = '⚠️ Bật "Copy nội dung từ nguồn" hoặc "Đăng bài bằng cách chia sẻ" nhưng không có link nguồn — bỏ qua.'
      this.sendLog(msg)
      await this.supabase.appendCampaignLog(campaign.id, msg)
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      return
    }

    // --- Rate limit ---
    const limitConfig = extra.actionLimits
    try {
      const limitStatus = await this.supabase.getChannelRateLimitStatus(channel.id, 'Đăng bài', limitConfig)
      if (!limitStatus.ok) {
        await this.supabase.appendCampaignLog(campaign.id, `Từ chối chạy do vượt giới hạn Đăng bài: ${limitStatus.reason}`)
        this.sendLog(`⚠️ Từ chối "${campaign.name}" do giới hạn Đăng bài: ${limitStatus.reason}`)
        await this.updateCampaignAndBroadcast(campaign.id, { status: 'chờ xử lý' })
        return
      }
    } catch (err) {
      console.error('Rate limit check error:', err)
    }

    // --- Chọn workflow + label dựa trên flags ---
    // Mỗi mode 1 workflow riêng (block scrape được dùng làm node trong copy-source workflow).
    // Scheduler chỉ load + chạy — không còn invoke block riêng hay làm browser action.
    let chosenFlow: import('../../shared/types').FlowData = flow
    let actionLabel = 'Đăng bài'

    if (extra.postAsReels) {
      const reelsFlow = await this.supabase.loadFlow(FB_REELS_WORKFLOW_ID)
      if (!reelsFlow) throw new Error('Không tìm thấy workflow "Đăng Reels"')
      if ((campaign.images || []).length === 0) {
        throw new Error('Đăng Reels yêu cầu ít nhất 1 video trong phần Media')
      }
      chosenFlow = reelsFlow
      actionLabel = 'Đăng Reels'
    } else if (extra.sharePost && currentLink) {
      const shareFlow = await this.supabase.loadFlow(FB_SHARE_POST_WORKFLOW_ID)
      if (!shareFlow) throw new Error('Không tìm thấy workflow "Đăng bài bằng cách chia sẻ"')
      chosenFlow = shareFlow
      actionLabel = 'Đăng bài (chia sẻ)'
    } else if (extra.copyContentFromSource && currentLink) {
      const copyFlow = await this.supabase.loadFlow(FB_POST_COPY_SOURCE_WORKFLOW_ID)
      if (!copyFlow) throw new Error('Không tìm thấy workflow "Đăng bài (copy nội dung từ nguồn)"')
      chosenFlow = copyFlow
      // actionLabel giữ "Đăng bài"
    }

    // Inject variables cho workflow đã chọn. blockInput nodes của workflow
    // sẽ đọc từ flowCopy.variables qua field name tương ứng.
    const flowCopy = JSON.parse(JSON.stringify(chosenFlow))
    flowCopy.variables = {
      ...(flowCopy.variables || {}),
      sourceLink: currentLink || '',
      includeImages: extra.includeSourceImages === true,
      videoPath: (campaign.images || [])[0] || ''
      // campaignContent đã được runWorkflowForDetail set từ campaign.content
    }

    try {
      await this.runWorkflowForDetail(channel.id, campaign, flowCopy, null)
      // Bổ sung log specific cho share/reels (runWorkflowForDetail log "Đăng bài" chung)
      if (actionLabel !== 'Đăng bài') {
        try {
          await this.supabase.createDetailAction({
            campaignId: campaign.id,
            channelId: channel.id,
            actionName: actionLabel,
            status: 'success',
            log: currentLink ? `${actionLabel} thành công (nguồn: ${currentLink})` : `${actionLabel} thành công`,
            postUrl: currentLink || undefined
          })
        } catch {}
      }
      await this.handleCampaignCompletion(campaign)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
      await this.updateCampaignAndBroadcast(campaign.id, { status: 'hoàn thành' })
      this.sendLog(`❌ Lỗi chiến dịch "${campaign.name}": ${errMsg}`)
      try {
        await this.supabase.createDetailAction({
          campaignId: campaign.id,
          channelId: channel.id,
          actionName: actionLabel,
          status: 'error',
          log: errMsg
        })
      } catch {}
    }
  }
}
