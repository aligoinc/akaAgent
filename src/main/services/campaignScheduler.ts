import { BrowserWindow, webContents } from 'electron'
import { existsSync } from 'fs'
import { SupabaseService } from './supabase'
import { WebviewRegistry, WebviewController } from '../playwright/webviewController'
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
      if (!action || !action.workflowId) {
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: Không tìm thấy action hoặc workflow`)
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
      await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
      await this.supabase.updateCampaign(campaign.id, { status: 'lỗi' })
      await this.supabase.updateAccount(account.id, { status: 'chờ xử lý' })
      this.sendLog(`❌ Lỗi chiến dịch "${campaign.name}": ${errMsg}`)
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
      // Shuffle array securely
      const shuffled = [...availableImages].sort(() => 0.5 - Math.random())
      finalImages = shuffled.slice(0, count)
    } else {
      // none
      finalImages = []
    }

    // Prepare flow variables with campaign/detail data
    const flowCopy = JSON.parse(JSON.stringify(flow))
    flowCopy.variables = {
      ...flowCopy.variables,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignContent: campaign.content,
      commentContent: campaign.extraSettings?.commentContent || '',
      sharePost: campaign.extraSettings?.sharePost ?? false,
      enableComment: campaign.extraSettings?.enableComment ?? false,
      commentType: campaign.extraSettings?.commentType || 'own',
      commentCount: campaign.extraSettings?.commentCount ?? 3,
      images: finalImages, // Make sure nodes picking up images use this list
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
    
    // Debug: Log the current URL to ensure it's on the right page
    try {
      const currentUrl = controller.getURL()
      console.log(`Campaign ${campaign.id} detail ${detailName} running on URL: ${currentUrl}`)
    } catch {}

    // ====== AUTO IMAGE UPLOAD via CDP ======
    // Strategy:
    // 1) Intercept file choosers: if the flow explicitly clicks Photo/Video, intercept and provide files.
    // 2) Intercept workflow clicks: wrap the controller's executeAction. If it's about to click "Post" (Đăng), 
    //    we directly inject the images via CDP before the click happens.
    let cdpDebuggerAttached = false
    let imageInjected = false
    const wcId = this.webviewRegistry.getWebContentsId(accountId)
    const targetWc = wcId ? webContents.fromId(wcId) : null

    // Validate file paths exist
    const validImages = finalImages.filter(fp => {
      if (fp.startsWith('data:')) return true
      return existsSync(fp)
    })

    if (targetWc && validImages.length > 0) {
      try {
        targetWc.debugger.attach('1.3')
        cdpDebuggerAttached = true
        await targetWc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })

        targetWc.debugger.on('message', (_event: any, method: string) => {
          if (method === 'Page.fileChooserOpened') {
            imageInjected = true
            console.log(`[CampaignScheduler] File chooser intercepted, providing ${validImages.length} images`)
            this.sendLog(`📎 Đang đính kèm ${validImages.length} ảnh qua hộp thoại...`)
            targetWc.debugger.sendCommand('Page.handleFileChooser', {
              action: 'accept',
              files: validImages
            }).catch(err => {
              console.error('[CampaignScheduler] Failed to handle file chooser:', err)
            })
          }
        })

        console.log(`[CampaignScheduler] CDP file chooser interception enabled for ${validImages.length} images`)
      } catch (cdpErr) {
        console.warn('[CampaignScheduler] Failed to set up CDP file chooser interception:', cdpErr)
        cdpDebuggerAttached = false
      }
    }

    // Wrap the controller to intercept the final post click
    const originalExecuteAction = controller.executeAction.bind(controller)
    controller.executeAction = async (actionType: import('../../shared/types').ActionType, input: any) => {
      // Check if we are about to click a "Post" or "Comment" button and haven't injected images yet
      if (
        cdpDebuggerAttached && 
        targetWc && 
        validImages.length > 0 && 
        !imageInjected && 
        actionType === 'click' && 
        input.selector
      ) {
        const sel = input.selector.toLowerCase()
        const isSubmitClick = sel.includes('đăng') || sel.includes('post') || 
                              sel.includes('bình luận') || sel.includes('comment') || 
                              sel.includes('gửi') || sel.includes('send')
                              
        if (isSubmitClick) {
          try {
            console.log(`[CampaignScheduler] Intercepted submit click (${input.selector}), injecting images first...`)
            this.sendLog(`📎 Đang tự động đính kèm ${validImages.length} ảnh trước khi đăng...`)
            imageInjected = true

            // Disable file chooser interception before direct DOM manipulation just in case
            try {
              await targetWc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false })
            } catch {}

            // Try to find file input and set files
            const { root } = await targetWc.debugger.sendCommand('DOM.getDocument', {})
            let fileInputNodeId = 0
            const fileInputSelectors = [
              'input[type="file"][accept*="image"]',
              'input[type="file"][accept*="video"]',
              'input[type="file"]'
            ]

            for (const selector of fileInputSelectors) {
              try {
                const res = await targetWc.debugger.sendCommand('DOM.querySelector', {
                  nodeId: root.nodeId,
                  selector
                })
                if (res.nodeId) {
                  fileInputNodeId = res.nodeId
                  break
                }
              } catch {}
            }

            if (fileInputNodeId) {
              // Direct upload
              await targetWc.debugger.sendCommand('DOM.setFileInputFiles', {
                nodeId: fileInputNodeId,
                files: validImages
              })

              await targetWc.executeJavaScript(`
                (function() {
                  var inputs = document.querySelectorAll('input[type="file"]');
                  for (var i = 0; i < inputs.length; i++) {
                    inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
                    inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
                  }
                })()
              `)

              this.sendLog(`✅ Đã đính kèm ảnh thành công`)
              await new Promise(r => setTimeout(r, 2000)) // Give React time to process the file change
            } else {
              // Fallback: try clicking the photo button to trigger the interceptor we had
              console.log('[CampaignScheduler] No file input found directly, trying to click Photo button')
              // Note: if file input not found, we can't easily upload.
              this.sendLog(`⚠️ Không tìm thấy vị trí để đính kèm ảnh`)
            }
          } catch (injectErr) {
            console.error('[CampaignScheduler] Failed to inject images before submit:', injectErr)
            this.sendLog(`⚠️ Lỗi khi đính kèm ảnh: ${injectErr}`)
          }
        }
      }

      // Proceed with the actual click (or whatever action it was)
      return originalExecuteAction(actionType, input)
    }

    const runner = new FlowRunner(controller, this.supabase, (step: ExecutionStep) => {
      this.mainWindow.webContents.send(IPC_CHANNELS.FLOW_PROGRESS, step)
    })

    let result: import('../../shared/types').ExecutionRun
    try {
      result = await runner.run(flowCopy)
    } finally {
      // Clean up CDP debugger
      if (cdpDebuggerAttached && targetWc && !targetWc.isDestroyed()) {
        try {
          await targetWc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false })
          targetWc.debugger.detach()
        } catch {}
      }
    }

    if (detail) {
      if (result.status === 'completed') {
        // Log individual actions into auto_campaign_detail_actions
        try {
          // Log post action
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            accountId: accountId,
            actionName: 'Đăng bài',
            status: 'success',
            log: `Đăng bài thành công vào ${detailName}`
          })
          // Send real-time log to UI for post action
          this.sendLog(`📝 Đăng bài thành công vào "${detailName}"`)

          // Log comment action if comment was enabled
          if (campaign.extraSettings?.enableComment && campaign.extraSettings?.commentContent) {
            await this.supabase.createDetailAction({
              campaignDetailId: detail.id,
              campaignId: campaign.id,
              accountId: accountId,
              actionName: 'Comment',
              status: 'success',
              log: `Comment thành công: "${campaign.extraSettings.commentContent.substring(0, 50)}..."`,
              data: {
                commentType: campaign.extraSettings.commentType,
                commentContent: campaign.extraSettings.commentContent
              }
            })
            // Send real-time log to UI for comment action
            const commentPreview = campaign.extraSettings.commentContent.length > 50
              ? campaign.extraSettings.commentContent.substring(0, 50) + '...'
              : campaign.extraSettings.commentContent
            this.sendLog(`💬 Comment thành công vào "${detailName}": "${commentPreview}"`)
          }
        } catch (logErr) {
          console.error('Failed to log detail actions:', logErr)
        }

        await this.supabase.updateCampaignDetail(detail.id, { status: 'hoàn thành' })
        await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành: ${detailName}`)
        this.sendLog(`✅ Hoàn thành "${detailName}"`)
      } else {
        await this.supabase.updateCampaignDetail(detail.id, {
          status: 'lỗi',
          note: result.error || 'Unknown error'
        })
        await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${detailName} - ${result.error}`)
        this.sendLog(`❌ Lỗi "${detailName}": ${result.error}`)

        // Log failed action
        try {
          await this.supabase.createDetailAction({
            campaignDetailId: detail.id,
            campaignId: campaign.id,
            accountId: accountId,
            actionName: 'Lỗi thực thi',
            status: 'error',
            log: result.error || 'Unknown error'
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
}
