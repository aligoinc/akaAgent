import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { FlowData, ExecutionRun, ExecutionStep, FlatformAccount, Campaign, CampaignAction, CampaignDetail } from '../../shared/types'
import * as dotenv from 'dotenv'
import { join } from 'path'

// Try to load .env from root if available in dev
dotenv.config({ path: join(process.cwd(), '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://swggxlwfgwzzoszvolbm.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'dummy_key_to_prevent_crash'

export class SupabaseService {
  private client: SupabaseClient

  constructor() {
    try {
      this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    } catch (e) {
      console.error('Failed to initialize Supabase client:', e)
      // Fallback dummy client so app doesn't crash
      this.client = createClient('https://dummy.supabase.co', 'dummy')
    }
  }

  // =========== FLOWS ===========

  async saveFlow(flowData: FlowData): Promise<FlowData> {
    const payload = {
      id: flowData.id,
      name: flowData.name,
      description: flowData.description || '',
      nodes: flowData.nodes,
      edges: flowData.edges,
      variables: flowData.variables || {},
      input_schema: flowData.inputSchema || {},
      output_schema: flowData.outputSchema || {},
      is_block: flowData.isBlock || false,
      updated_at: new Date().toISOString()
    }

    const { data, error } = await this.client
      .from('auto_flows')
      .upsert(payload)
      .select()
      .single()

    if (error) throw new Error(`Failed to save flow: ${error.message}`)
    return this.mapFlowFromDB(data)
  }

  async loadFlow(flowId: string): Promise<FlowData | null> {
    const { data, error } = await this.client
      .from('auto_flows')
      .select('*')
      .eq('id', flowId)
      .single()

    if (error) return null
    return this.mapFlowFromDB(data)
  }

  async listFlows(): Promise<FlowData[]> {
    const { data, error } = await this.client
      .from('auto_flows')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) throw new Error(`Failed to list flows: ${error.message}`)
    return (data || []).map(this.mapFlowFromDB)
  }

  async deleteFlow(flowId: string): Promise<void> {
    // First get all runs for this flow
    const { data: runs } = await this.client
      .from('auto_runs')
      .select('id')
      .eq('flow_id', flowId)

    // Delete run steps for each run
    if (runs && runs.length > 0) {
      const runIds = runs.map(r => r.id)
      const { error: stepsError } = await this.client
        .from('auto_run_steps')
        .delete()
        .in('run_id', runIds)
      if (stepsError) console.error('Failed to delete run steps:', stepsError.message)

      // Delete runs
      const { error: runsError } = await this.client
        .from('auto_runs')
        .delete()
        .eq('flow_id', flowId)
      if (runsError) console.error('Failed to delete runs:', runsError.message)
    }

    // Finally delete the flow
    const { error } = await this.client
      .from('auto_flows')
      .delete()
      .eq('id', flowId)

    if (error) throw new Error(`Failed to delete flow: ${error.message}`)
  }

  // =========== ELEMENTS ===========

  async saveElement(element: Omit<import('../../shared/types').ElementDefinition, 'createdAt' | 'updatedAt'>): Promise<import('../../shared/types').ElementDefinition> {
    const payload = {
      id: element.id,
      name: element.name,
      xpath: element.xpath,
      description: element.description || '',
      updated_at: new Date().toISOString()
    }

    const { data, error } = await this.client
      .from('auto_elements')
      .upsert(payload)
      .select()
      .single()

    if (error) throw new Error(`Failed to save element: ${error.message}`)
    return this.mapElementFromDB(data)
  }

  async listElements(): Promise<import('../../shared/types').ElementDefinition[]> {
    const { data, error } = await this.client
      .from('auto_elements')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) throw new Error(`Failed to list elements: ${error.message}`)
    return (data || []).map(row => this.mapElementFromDB(row))
  }

  async deleteElement(elementId: string): Promise<void> {
    const { error } = await this.client
      .from('auto_elements')
      .delete()
      .eq('id', elementId)

    if (error) throw new Error(`Failed to delete element: ${error.message}`)
  }

  // =========== RUN HISTORY ===========

  async createRun(run: ExecutionRun): Promise<void> {
    const runPayload = {
      id: run.id,
      flow_id: run.flowId,
      workflow_id: run.workflowId || null,
      status: run.status,
      input: run.input,
      started_at: run.startedAt
    }

    const { error: runError } = await this.client
      .from('auto_runs')
      .insert(runPayload)

    if (runError) throw new Error(`Failed to create run: ${runError.message}`)
  }

  async updateRun(runId: string, status: string, output: Record<string, unknown>, errorStr?: string, completedAt?: string): Promise<void> {
    const payload: any = { status, output }
    if (errorStr) payload.error = errorStr
    if (completedAt) payload.completed_at = completedAt

    const { error } = await this.client
      .from('auto_runs')
      .update(payload)
      .eq('id', runId)

    if (error) throw new Error(`Failed to update run: ${error.message}`)
  }

  async createRunStep(runId: string, step: ExecutionStep): Promise<void> {
    const stepsPayload = {
      run_id: runId,
      node_id: step.nodeId,
      action_type: step.actionType,
      status: step.status,
      input: step.input,
      output: step.output,
      screenshot_url: step.screenshotUrl || null,
      error: step.error || null,
      duration_ms: step.durationMs || null,
      executed_at: step.executedAt
    }

    const { error: stepsError } = await this.client
      .from('auto_run_steps')
      .insert(stepsPayload)

    if (stepsError) throw new Error(`Failed to save run step: ${stepsError.message}`)
  }

  async listRuns(flowId?: string): Promise<ExecutionRun[]> {
    let query = this.client
      .from('auto_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (flowId) {
      query = query.eq('flow_id', flowId)
    }

    const { data, error } = await query
    if (error) throw new Error(`Failed to list runs: ${error.message}`)
    return (data || []).map(row => this.mapRunFromDB(row))
  }

  async listRunSteps(runId: string): Promise<ExecutionStep[]> {
    const { data, error } = await this.client
      .from('auto_run_steps')
      .select('*')
      .eq('run_id', runId)
      .order('executed_at', { ascending: true })

    if (error) throw new Error(`Failed to list run steps: ${error.message}`)
    return (data || []).map(row => this.mapRunStepFromDB(row))
  }

  // =========== FLATFORM ACCOUNTS ===========

  async listAccounts(): Promise<FlatformAccount[]> {
    const { data, error } = await this.client
      .from('auto_flatform_accounts')
      .select('*')
      .eq('is_delete', false)
      .order('created_at', { ascending: false })

    if (error) throw new Error(`Failed to list accounts: ${error.message}`)
    return (data || []).map(row => this.mapAccountFromDB(row))
  }

  async createAccount(account: Partial<FlatformAccount>): Promise<FlatformAccount> {
    const payload = {
      name: account.name,
      flatform_type: account.flatformType || 'facebook',
      login_status: account.loginStatus || 'chưa đăng nhập',
      status: account.status || 'chờ xử lý',
      is_active: account.isActive ?? true
    }

    const { data, error } = await this.client
      .from('auto_flatform_accounts')
      .insert(payload)
      .select()
      .single()

    if (error) throw new Error(`Failed to create account: ${error.message}`)
    return this.mapAccountFromDB(data)
  }

  async updateAccount(id: number, updates: Partial<FlatformAccount>): Promise<FlatformAccount> {
    const payload: any = { updated_at: new Date().toISOString() }
    if (updates.name !== undefined) payload.name = updates.name
    if (updates.flatformType !== undefined) payload.flatform_type = updates.flatformType
    if (updates.loginStatus !== undefined) payload.login_status = updates.loginStatus
    if (updates.status !== undefined) payload.status = updates.status
    if (updates.isActive !== undefined) payload.is_active = updates.isActive

    const { data, error } = await this.client
      .from('auto_flatform_accounts')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update account: ${error.message}`)
    return this.mapAccountFromDB(data)
  }

  async deleteAccount(id: number): Promise<void> {
    const { error } = await this.client
      .from('auto_flatform_accounts')
      .update({ is_delete: true, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw new Error(`Failed to delete account: ${error.message}`)
  }

  // =========== CAMPAIGN ACTIONS ===========

  async listCampaignActions(): Promise<CampaignAction[]> {
    const { data, error } = await this.client
      .from('auto_campaign_actions')
      .select('*')
      .eq('is_active', true)
      .eq('is_delete', false)
      .order('created_at', { ascending: false })

    if (error) throw new Error(`Failed to list campaign actions: ${error.message}`)
    return (data || []).map(row => this.mapCampaignActionFromDB(row))
  }

  async getAllCampaignActions(): Promise<CampaignAction[]> {
    const { data, error } = await this.client
      .from('auto_campaign_actions')
      .select('*')
      .eq('is_delete', false)
      .order('created_at', { ascending: false })

    if (error) throw new Error(`Failed to get all campaign actions: ${error.message}`)
    return (data || []).map(row => this.mapCampaignActionFromDB(row))
  }

  async createCampaignAction(action: Partial<CampaignAction>): Promise<CampaignAction> {
    const payload = {
      id: action.id, // User provides ID
      name: action.name,
      flatform_type: action.flatformType,
      is_active: action.isActive ?? true,
      workflow_id: action.workflowId || null
    }

    const { data, error } = await this.client
      .from('auto_campaign_actions')
      .insert(payload)
      .select()
      .single()

    if (error) throw new Error(`Failed to create campaign action: ${error.message}`)
    return this.mapCampaignActionFromDB(data)
  }

  async updateCampaignAction(id: string, updates: Partial<CampaignAction>): Promise<CampaignAction> {
    const payload: any = {}
    if (updates.name !== undefined) payload.name = updates.name
    if (updates.flatformType !== undefined) payload.flatform_type = updates.flatformType
    if (updates.isActive !== undefined) payload.is_active = updates.isActive
    if (updates.workflowId !== undefined) payload.workflow_id = updates.workflowId

    const { data, error } = await this.client
      .from('auto_campaign_actions')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update campaign action: ${error.message}`)
    return this.mapCampaignActionFromDB(data)
  }

  async deleteCampaignAction(id: string): Promise<void> {
    const { error } = await this.client
      .from('auto_campaign_actions')
      .update({ is_delete: true })
      .eq('id', id)

    if (error) throw new Error(`Failed to delete campaign action: ${error.message}`)
  }

  // =========== CAMPAIGNS ===========

  async getCampaign(id: number): Promise<Campaign | null> {
    const { data, error } = await this.client
      .from('auto_campaigns')
      .select('*, auto_campaign_actions(name), auto_flatform_accounts(name)')
      .eq('id', id)
      .single()

    if (error) return null
    return this.mapCampaignFromDB(data)
  }

  async listCampaigns(): Promise<Campaign[]> {
    const { data, error } = await this.client
      .from('auto_campaigns')
      .select('*, auto_campaign_actions(name), auto_flatform_accounts(name)')
      .eq('is_delete', false)
      .order('created_at', { ascending: false })

    if (error) throw new Error(`Failed to list campaigns: ${error.message}`)
    return (data || []).map(row => this.mapCampaignFromDB(row))
  }

  async createCampaign(campaign: Partial<Campaign>): Promise<Campaign> {
    const payload = {
      name: campaign.name,
      action_id: campaign.actionId,
      flatform_account_id: campaign.flatformAccountId,
      status: campaign.status || 'chờ xử lý',
      schedule: campaign.schedule || null,
      schedule_type: campaign.scheduleType || 'daily',
      schedule_end_date: campaign.scheduleEndDate || null,
      schedule_days: campaign.scheduleDays || null,
      schedule_week_days: campaign.scheduleWeekDays || null,
      continue_next_day: campaign.continueNextDay ?? false,
      refresh_data: campaign.refreshData ?? false,
      time_sleep_between_2: campaign.timeSleepBetween2 || 30,
      content: campaign.content || '',
      extra_settings: campaign.extraSettings || {},
      images: campaign.images || [],
      log: ''
    }

    const { data, error } = await this.client
      .from('auto_campaigns')
      .insert(payload)
      .select('*, auto_campaign_actions(name), auto_flatform_accounts(name)')
      .single()

    if (error) throw new Error(`Failed to create campaign: ${error.message}`)
    return this.mapCampaignFromDB(data)
  }

  async updateCampaign(id: number, updates: Partial<Campaign>): Promise<Campaign> {
    const payload: any = { updated_at: new Date().toISOString() }
    if (updates.name !== undefined) payload.name = updates.name
    if (updates.actionId !== undefined) payload.action_id = updates.actionId
    if (updates.flatformAccountId !== undefined) payload.flatform_account_id = updates.flatformAccountId
    if (updates.status !== undefined) payload.status = updates.status
    if (updates.schedule !== undefined) payload.schedule = updates.schedule
    if (updates.scheduleType !== undefined) payload.schedule_type = updates.scheduleType
    if (updates.scheduleEndDate !== undefined) payload.schedule_end_date = updates.scheduleEndDate
    if (updates.scheduleDays !== undefined) payload.schedule_days = updates.scheduleDays
    if (updates.scheduleWeekDays !== undefined) payload.schedule_week_days = updates.scheduleWeekDays
    if (updates.continueNextDay !== undefined) payload.continue_next_day = updates.continueNextDay
    if (updates.refreshData !== undefined) payload.refresh_data = updates.refreshData
    if (updates.timeSleepBetween2 !== undefined) payload.time_sleep_between_2 = updates.timeSleepBetween2
    if (updates.content !== undefined) payload.content = updates.content
    if (updates.extraSettings !== undefined) payload.extra_settings = updates.extraSettings
    if (updates.images !== undefined) payload.images = updates.images
    if (updates.log !== undefined) payload.log = updates.log

    const { data, error } = await this.client
      .from('auto_campaigns')
      .update(payload)
      .eq('id', id)
      .select('*, auto_campaign_actions(name), auto_flatform_accounts(name)')
      .single()

    if (error) throw new Error(`Failed to update campaign: ${error.message}`)
    return this.mapCampaignFromDB(data)
  }

  async deleteCampaign(id: number): Promise<void> {
    const { error } = await this.client
      .from('auto_campaigns')
      .update({ is_delete: true, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw new Error(`Failed to delete campaign: ${error.message}`)
  }

  async cloneCampaign(id: number): Promise<Campaign> {
    // 1. Fetch original campaign
    const { data: origCamp, error: errC } = await this.client
      .from('auto_campaigns')
      .select('*')
      .eq('id', id)
      .single()
      
    if (errC || !origCamp) throw new Error(`Campaign not found: ${errC?.message}`)

    // 2. Insert cloned campaign
    const { data: newCamp, error: errInsert } = await this.client
      .from('auto_campaigns')
      .insert({
        name: origCamp.name + ' (Copy)',
        action_id: origCamp.action_id,
        flatform_account_id: origCamp.flatform_account_id,
        status: 'chờ xử lý',
        schedule: origCamp.schedule,
        schedule_type: origCamp.schedule_type,
        schedule_end_date: origCamp.schedule_end_date,
        schedule_days: origCamp.schedule_days,
        schedule_week_days: origCamp.schedule_week_days,
        continue_next_day: origCamp.continue_next_day,
        refresh_data: origCamp.refresh_data,
        time_sleep_between_2: origCamp.time_sleep_between_2,
        content: origCamp.content,
        extra_settings: origCamp.extra_settings,
        images: origCamp.images,
        log: ''
      })
      .select('*, auto_campaign_actions(name), auto_flatform_accounts(name)')
      .single()

    if (errInsert || !newCamp) throw new Error(`Failed to insert cloned campaign: ${errInsert?.message}`)

    // 3. Fetch original details
    const { data: origDetails, error: errDetails } = await this.client
      .from('auto_campaign_details')
      .select('*')
      .eq('campaign_id', id)
      .eq('is_delete', false)

    if (errDetails) throw new Error(`Failed to fetch original details: ${errDetails.message}`)

    // 4. Insert cloned details if any
    if (origDetails && origDetails.length > 0) {
      const detailsToInsert = origDetails.map(d => ({
        campaign_id: newCamp.id,
        name: d.name,
        phone: d.phone,
        uid: d.uid,
        email: d.email,
        note: d.note,
        status: 'chờ xử lý',
        schedule: d.schedule
      }))

      const { error: errInsertDetails } = await this.client
        .from('auto_campaign_details')
        .insert(detailsToInsert)
      
      if (errInsertDetails) {
        console.warn('Failed to clone campaign details:', errInsertDetails)
      }
    }

    return this.mapCampaignFromDB(newCamp)
  }

  async appendCampaignLog(campaignId: number, logText: string): Promise<void> {
    // Fetch current log
    const { data: current } = await this.client
      .from('auto_campaigns')
      .select('log')
      .eq('id', campaignId)
      .single()

    const timestamp = new Date().toLocaleString('vi-VN')
    const newLog = `[${timestamp}] ${logText}`
    const fullLog = current?.log ? `${current.log}\n${newLog}` : newLog

    const { error } = await this.client
      .from('auto_campaigns')
      .update({ log: fullLog, updated_at: new Date().toISOString() })
      .eq('id', campaignId)

    if (error) throw new Error(`Failed to append campaign log: ${error.message}`)
  }

  // =========== CAMPAIGN DETAILS ===========

  async listCampaignDetails(campaignId: number): Promise<CampaignDetail[]> {
    const { data, error } = await this.client
      .from('auto_campaign_details')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('is_delete', false)
      .order('created_at', { ascending: true })

    if (error) throw new Error(`Failed to list campaign details: ${error.message}`)
    return (data || []).map(row => this.mapCampaignDetailFromDB(row))
  }

  async createCampaignDetail(detail: Partial<CampaignDetail>): Promise<CampaignDetail> {
    const payload = {
      campaign_id: detail.campaignId,
      name: detail.name || null,
      phone: detail.phone || null,
      uid: detail.uid || null,
      email: detail.email || null,
      status: detail.status || 'chờ xử lý',
      note: detail.note || null,
      schedule: detail.schedule || null
    }

    const { data, error } = await this.client
      .from('auto_campaign_details')
      .insert(payload)
      .select()
      .single()

    if (error) throw new Error(`Failed to create campaign detail: ${error.message}`)
    return this.mapCampaignDetailFromDB(data)
  }

  async updateCampaignDetail(id: number, updates: Partial<CampaignDetail>): Promise<CampaignDetail> {
    const payload: any = {}
    if (updates.name !== undefined) payload.name = updates.name
    if (updates.phone !== undefined) payload.phone = updates.phone
    if (updates.uid !== undefined) payload.uid = updates.uid
    if (updates.email !== undefined) payload.email = updates.email
    if (updates.status !== undefined) payload.status = updates.status
    if (updates.note !== undefined) payload.note = updates.note
    if (updates.schedule !== undefined) payload.schedule = updates.schedule
    if (updates.dateAction !== undefined) payload.date_action = updates.dateAction

    const { data, error } = await this.client
      .from('auto_campaign_details')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update campaign detail: ${error.message}`)
    return this.mapCampaignDetailFromDB(data)
  }

  async deleteCampaignDetail(id: number): Promise<void> {
    const { error } = await this.client
      .from('auto_campaign_details')
      .update({ is_delete: true })
      .eq('id', id)

    if (error) throw new Error(`Failed to delete campaign detail: ${error.message}`)
  }

  // =========== CAMPAIGN DETAIL ACTIONS (Action Logs) ===========

  async listDetailActions(detailId: number): Promise<import('../../shared/types').CampaignDetailAction[]> {
    const { data, error } = await this.client
      .from('auto_campaign_detail_actions')
      .select('*')
      .eq('campaign_detail_id', detailId)
      .eq('is_delete', false)
      .order('created_at', { ascending: true })

    if (error) throw new Error(`Failed to list detail actions: ${error.message}`)
    return (data || []).map(row => this.mapDetailActionFromDB(row))
  }

  async listDetailActionsByCampaign(campaignId: number): Promise<import('../../shared/types').CampaignDetailAction[]> {
    const { data, error } = await this.client
      .from('auto_campaign_detail_actions')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('is_delete', false)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) throw new Error(`Failed to list detail actions by campaign: ${error.message}`)
    return (data || []).map(row => this.mapDetailActionFromDB(row))
  }

  async createDetailAction(action: Partial<import('../../shared/types').CampaignDetailAction>): Promise<import('../../shared/types').CampaignDetailAction> {
    const payload = {
      campaign_detail_id: action.campaignDetailId,
      campaign_id: action.campaignId,
      account_id: action.accountId,
      action_name: action.actionName,
      status: action.status || 'success',
      log: action.log || null,
      data: action.data || null
    }

    const { data, error } = await this.client
      .from('auto_campaign_detail_actions')
      .insert(payload)
      .select()
      .single()

    if (error) throw new Error(`Failed to create detail action: ${error.message}`)
    return this.mapDetailActionFromDB(data)
  }

  async deleteDetailAction(id: number): Promise<void> {
    const { error } = await this.client
      .from('auto_campaign_detail_actions')
      .update({ is_delete: true })
      .eq('id', id)

    if (error) throw new Error(`Failed to delete detail action: ${error.message}`)
  }

  // =========== SCHEDULER QUERIES ===========

  async getAccountRateLimitStatus(
    accountId: number, 
    actionName: string, 
    limitConfig?: { dailyLimit?: number; rateLimitCount?: number; rateLimitMinutes?: number }
  ): Promise<{ ok: boolean, reason?: string }> {
    const dailyLimit = limitConfig?.dailyLimit && limitConfig.dailyLimit > 0 ? limitConfig.dailyLimit : 30
    const rateLimitCount = limitConfig?.rateLimitCount && limitConfig.rateLimitCount > 0 ? limitConfig.rateLimitCount : 9
    const rateLimitMinutes = limitConfig?.rateLimitMinutes && limitConfig.rateLimitMinutes > 0 ? limitConfig.rateLimitMinutes : 60

    // 1. Query today's count for this specific actionName
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // We count successful actions or basically any valid action performed by the bot matching the actionName
    const { count: dailyActionCount, error: dailyErr } = await this.client
      .from('auto_campaign_detail_actions')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('action_name', actionName)
      .gte('created_at', today.toISOString())
      
    if (dailyErr) throw new Error(`Daily count query error: ${dailyErr.message}`)
    
    if ((dailyActionCount ?? 0) >= dailyLimit) {
        return { ok: false, reason: `Đạt giới hạn ngày cho hành động "${actionName}" (${dailyActionCount}/${dailyLimit})` }
    }

    // 2. Query short-term count for this specific actionName
    const timeFrameStart = new Date(new Date().getTime() - rateLimitMinutes * 60 * 1000)
    
    const { count: windowActionCount, error: winErr } = await this.client
      .from('auto_campaign_detail_actions')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('action_name', actionName)
      .gte('created_at', timeFrameStart.toISOString())
      
    if (winErr) throw new Error(`Window count query error: ${winErr.message}`)
    
    if ((windowActionCount ?? 0) >= rateLimitCount) {
        return { ok: false, reason: `Đạt tốc độ giới hạn hành động "${actionName}" (${windowActionCount}/${rateLimitCount} lần / ${rateLimitMinutes} phút)` }
    }

    return { ok: true }
  }

  async getEligibleAccounts(): Promise<FlatformAccount[]> {
    const { data, error } = await this.client
      .from('auto_flatform_accounts')
      .select('*')
      // .eq('login_status', 'đã đăng nhập') // TRANSIENT: Bypassed for testing
      //.eq('status', 'chờ xử lý')
      .eq('is_active', true)
      .eq('is_delete', false)

    if (error) throw new Error(`Failed to get eligible accounts: ${error.message}`)
    return (data || []).map(row => this.mapAccountFromDB(row))
  }

  async getPendingCampaigns(accountId: number): Promise<Campaign[]> {
    const { data, error } = await this.client
      .from('auto_campaigns')
      .select('*, auto_campaign_actions(name), auto_flatform_accounts(name)')
      .eq('flatform_account_id', accountId)
      .eq('status', 'chờ xử lý')
      .eq('is_delete', false)
      .lte('schedule', new Date().toISOString())

    if (error) throw new Error(`Failed to get pending campaigns: ${error.message}`)
    return (data || []).map(row => this.mapCampaignFromDB(row))
  }

  async getCampaignAction(actionId: string): Promise<CampaignAction | null> {
    const { data, error } = await this.client
      .from('auto_campaign_actions')
      .select('*')
      .eq('id', actionId)
      .single()

    if (error) return null
    return this.mapCampaignActionFromDB(data)
  }

  // =========== MAPPERS ===========

  private mapFlowFromDB(row: Record<string, unknown>): FlowData {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      nodes: row.nodes as FlowData['nodes'],
      edges: row.edges as FlowData['edges'],
      variables: row.variables as Record<string, unknown>,
      inputSchema: row.input_schema as FlowData['inputSchema'],
      outputSchema: row.output_schema as FlowData['outputSchema'],
      isBlock: row.is_block as boolean,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }
  }

  private mapRunFromDB(row: Record<string, unknown>): ExecutionRun {
    return {
      id: row.id as string,
      flowId: row.flow_id as string,
      workflowId: row.workflow_id as string | undefined,
      status: row.status as ExecutionRun['status'],
      input: row.input as Record<string, unknown>,
      output: row.output as Record<string, unknown>,
      steps: [],
      startedAt: row.started_at as string,
      completedAt: row.completed_at as string,
      error: row.error as string | undefined
    }
  }

  private mapRunStepFromDB(row: Record<string, unknown>): ExecutionStep {
    return {
      nodeId: row.node_id as string,
      actionType: row.action_type as import('../../shared/types').ActionType,
      status: row.status as ExecutionStep['status'],
      input: row.input as Record<string, unknown>,
      output: row.output as Record<string, unknown>,
      screenshotUrl: row.screenshot_url as string | undefined,
      error: row.error as string | undefined,
      durationMs: row.duration_ms as number | undefined,
      executedAt: row.executed_at as string
    }
  }

  private mapElementFromDB(row: Record<string, unknown>): import('../../shared/types').ElementDefinition {
    return {
      id: row.id as string,
      name: row.name as string,
      xpath: row.xpath as string,
      description: row.description as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }
  }

  private mapAccountFromDB(row: Record<string, unknown>): FlatformAccount {
    return {
      id: row.id as number,
      name: row.name as string,
      flatformType: row.flatform_type as string,
      loginStatus: row.login_status as string,
      status: row.status as string,
      isActive: row.is_active as boolean,
      isDelete: row.is_delete as boolean,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }
  }

  private mapCampaignActionFromDB(row: Record<string, unknown>): CampaignAction {
    return {
      id: row.id as string,
      name: row.name as string,
      flatformType: row.flatform_type as string,
      isActive: row.is_active as boolean,
      workflowId: row.workflow_id as string | undefined,
      isDelete: row.is_delete as boolean,
      createdAt: row.created_at as string
    }
  }

  private mapCampaignFromDB(row: Record<string, unknown>): Campaign {
    return {
      id: row.id as number,
      name: row.name as string,
      actionId: row.action_id as string,
      flatformAccountId: row.flatform_account_id as number,
      status: row.status as string,
      schedule: row.schedule as string | undefined,
      scheduleType: (row.schedule_type as Campaign['scheduleType']) || 'daily',
      scheduleEndDate: row.schedule_end_date as string | undefined,
      scheduleDays: row.schedule_days as string | undefined,
      scheduleWeekDays: row.schedule_week_days as string | undefined,
      continueNextDay: (row.continue_next_day as boolean) ?? false,
      refreshData: (row.refresh_data as boolean) ?? false,
      timeSleepBetween2: row.time_sleep_between_2 as number,
      content: (row.content as string) || '',
      extraSettings: (row.extra_settings as Campaign['extraSettings']) || {},
      images: (row.images as string[]) || [],
      log: (row.log as string) || '',
      isDelete: row.is_delete as boolean,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      actionName: (row as any).auto_campaign_actions?.name as string | undefined,
      accountName: (row as any).auto_flatform_accounts?.name as string | undefined
    }
  }

  private mapCampaignDetailFromDB(row: Record<string, unknown>): CampaignDetail {
    return {
      id: row.id as number,
      campaignId: row.campaign_id as number,
      name: row.name as string | undefined,
      phone: row.phone as string | undefined,
      uid: row.uid as string | undefined,
      email: row.email as string | undefined,
      status: row.status as string,
      note: row.note as string | undefined,
      schedule: row.schedule as string | undefined,
      dateAction: row.date_action as string | undefined,
      isDelete: row.is_delete as boolean,
      createdAt: row.created_at as string
    }
  }

  private mapDetailActionFromDB(row: Record<string, unknown>): import('../../shared/types').CampaignDetailAction {
    return {
      id: row.id as number,
      campaignDetailId: row.campaign_detail_id as number | undefined,
      campaignId: row.campaign_id as number,
      accountId: row.account_id as number | undefined,
      actionName: row.action_name as string,
      status: row.status as string,
      log: row.log as string | undefined,
      data: row.data as Record<string, unknown> | undefined,
      isDelete: row.is_delete as boolean,
      createdAt: row.created_at as string
    }
  }
}
