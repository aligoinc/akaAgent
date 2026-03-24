import { BrowserWindow } from 'electron'
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
          await this.executeCampaign(account.id, account.name, campaign)
        }
      }
    } catch (err) {
      console.error('Scheduler tick error:', err)
      this.sendLog(`❌ Lỗi scheduler: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.processing = false
    }
  }

  private async executeCampaign(accountId: number, accountName: string, campaign: Campaign): Promise<void> {
    try {
      // Update campaign status to running
      await this.supabase.updateCampaign(campaign.id, { status: 'đang chạy' })
      await this.supabase.appendCampaignLog(campaign.id, `Bắt đầu chạy chiến dịch`)
      this.sendLog(`🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${accountName}"`)

      // Update account status to running
      await this.supabase.updateAccount(accountId, { status: 'đang chạy' })

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

      if (details.length === 0) {
        // No details, run workflow once with campaign info
        await this.runWorkflowForDetail(accountId, campaign, flow, null)
      } else {
        // Run workflow for each detail
        for (let i = 0; i < details.length; i++) {
          const detail = details[i]
          if (detail.status !== 'chờ xử lý') continue

          await this.runWorkflowForDetail(accountId, campaign, flow, detail)

          // Sleep between details
          if (i < details.length - 1 && campaign.timeSleepBetween2 > 0) {
            this.sendLog(`⏳ Nghỉ ${campaign.timeSleepBetween2}s trước khi xử lý mục tiếp theo...`)
            await new Promise(resolve => setTimeout(resolve, campaign.timeSleepBetween2 * 1000))
          }
        }
      }

      // Mark campaign as complete
      await this.supabase.updateCampaign(campaign.id, { status: 'hoàn thành' })
      await this.supabase.appendCampaignLog(campaign.id, `Hoàn thành chiến dịch`)
      this.sendLog(`✅ Hoàn thành chiến dịch "${campaign.name}"`)

      // Reset account status
      await this.supabase.updateAccount(accountId, { status: 'chờ xử lý' })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.supabase.appendCampaignLog(campaign.id, `Lỗi: ${errMsg}`)
      await this.supabase.updateCampaign(campaign.id, { status: 'lỗi' })
      await this.supabase.updateAccount(accountId, { status: 'chờ xử lý' })
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

    // Prepare flow variables with campaign/detail data
    const flowCopy = JSON.parse(JSON.stringify(flow))
    flowCopy.variables = {
      ...flowCopy.variables,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignContent: campaign.content,
      accountId: accountId,
      ...(detail ? {
        detailId: detail.id,
        detailName: detail.name,
        detailPhone: detail.phone,
        detailUid: detail.uid,
        detailEmail: detail.email
      } : {})
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

    const runner = new FlowRunner(controller, this.supabase, (step: ExecutionStep) => {
      // Send progress to main window
      this.mainWindow.webContents.send(IPC_CHANNELS.FLOW_PROGRESS, step)
    })

    const result = await runner.run(flowCopy)

    if (detail) {
      if (result.status === 'completed') {
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
