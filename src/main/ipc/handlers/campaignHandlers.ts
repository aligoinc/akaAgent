import { ipcMain } from 'electron'
import { CAMPAIGN_STATUSES, IPC_EVENTS, type AddCampaignInputDataRowsRequest, type AddCampaignInputDataToCampaignRequest, type Campaign, type CampaignDetailPageQuery, type CampaignInputDataPageQuery, type CampaignInputStatus, type CampaignRunEventListOptions, type CampaignStatus } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

interface CampaignStatusController {
  requestCampaignStatus(
    campaignId: number,
    status: Extract<CampaignStatus, 'chờ xử lý' | 'tạm dừng'>
  ): Promise<Campaign>
}

interface CampaignRealtimeRefreshController {
  refreshSoon(reason?: string): void
}

const isKnownCampaignStatus = (status: string): status is CampaignStatus =>
  (CAMPAIGN_STATUSES as readonly string[]).includes(status)

const canEditCampaign = (status: string) => status === 'chờ xử lý' || status === 'tạm dừng'
const canPauseCampaign = (status: string) => status === 'chờ xử lý' || status === 'đang chạy'
const canResumeCampaign = (status: string) => status === 'tạm dừng'

const isStatusOnlyCampaignUpdate = (updates: Partial<Campaign>) => {
  const keys = Object.keys(updates)
  return keys.length === 1 && keys[0] === 'status' && updates.status !== undefined
}

async function assertCanUpdateCampaignFromRenderer(
  supabase: SupabaseService,
  id: number,
  updates: Partial<Campaign>
): Promise<void> {
  const campaign = await supabase.getCampaign(id)
  if (!campaign) {
    throw new Error('Không tìm thấy chiến dịch.')
  }

  if (isStatusOnlyCampaignUpdate(updates)) {
    if (updates.status === 'tạm dừng' && canPauseCampaign(campaign.status)) return
    if (updates.status === 'chờ xử lý' && canResumeCampaign(campaign.status)) return

    if (updates.status === 'tạm dừng') {
      throw new Error('Chỉ có thể tạm dừng chiến dịch khi trạng thái là "chờ xử lý" hoặc "đang chạy".')
    }
    if (updates.status === 'chờ xử lý') {
      throw new Error('Chỉ có thể tiếp tục chiến dịch khi trạng thái là "tạm dừng".')
    }

    const nextStatus = updates.status && isKnownCampaignStatus(updates.status)
      ? updates.status
      : String(updates.status || '')
    throw new Error(`Không hỗ trợ chuyển trạng thái chiến dịch sang "${nextStatus}".`)
  }

  if (updates.status !== undefined) {
    throw new Error('Không thể cập nhật trạng thái kèm cấu hình chiến dịch.')
  }

  if (!canEditCampaign(campaign.status)) {
    throw new Error('Chỉ có thể sửa chiến dịch khi trạng thái là "chờ xử lý" hoặc "tạm dừng".')
  }
}

export function registerCampaignHandlers(
  supabase: SupabaseService,
  campaignStatusController: CampaignStatusController,
  realtimeRefreshController?: CampaignRealtimeRefreshController
): void {
  // Campaign Actions
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_ACTIONS, async () => {
    return supabase.listCampaignActions()
  })

  ipcMain.handle(IPC_EVENTS.DB_GET_ALL_CAMPAIGN_ACTIONS, async () => {
    return supabase.getAllCampaignActions()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN_ACTION, async (_, actionData) => {
    return supabase.createCampaignAction(actionData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CAMPAIGN_ACTION, async (_, id: string, updates) => {
    return supabase.updateCampaignAction(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN_ACTION, async (_, id: string) => {
    return supabase.deleteCampaignAction(id)
  })

  // Campaigns
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGNS, async () => {
    return supabase.listCampaigns()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN, async (_, campaignData) => {
    const campaign = await supabase.createCampaign(campaignData)
    realtimeRefreshController?.refreshSoon('campaign-created')
    return campaign
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CAMPAIGN, async (_, id: number, updates: Partial<Campaign> | null | undefined) => {
    const payload = updates || {}
    if (
      isStatusOnlyCampaignUpdate(payload)
      && (payload.status === 'tạm dừng' || payload.status === 'chờ xử lý')
    ) {
      await assertCanUpdateCampaignFromRenderer(supabase, id, payload)
      const campaign = await campaignStatusController.requestCampaignStatus(id, payload.status)
      realtimeRefreshController?.refreshSoon(
        payload.status === 'tạm dừng' ? 'campaign-paused' : 'campaign-resumed'
      )
      return campaign
    }
    await assertCanUpdateCampaignFromRenderer(supabase, id, payload)
    const campaign = await supabase.updateCampaign(id, payload)
    realtimeRefreshController?.refreshSoon('campaign-updated')
    return campaign
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN, async (_, id: number) => {
    const result = await supabase.deleteCampaign(id)
    realtimeRefreshController?.refreshSoon('campaign-deleted')
    return result
  })

  ipcMain.handle(IPC_EVENTS.DB_CLONE_CAMPAIGN, async (_, id: number) => {
    return supabase.cloneCampaign(id)
  })

  // Campaign Inputs (pool nguyên liệu)
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_INPUTS, async (_, campaignId: number) => {
    return supabase.listCampaignInputs(campaignId)
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN_INPUT, async (_, inputData) => {
    return supabase.createCampaignInput(inputData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CAMPAIGN_INPUT, async (_, id: number, updates) => {
    return supabase.updateCampaignInput(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN_INPUT, async (_, id: number) => {
    return supabase.deleteCampaignInput(id)
  })

  // Campaign Input Data (việc-cần-làm)
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_INPUT_DATA, async (_, campaignId: number) => {
    return supabase.listCampaignInputData(campaignId)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_INPUT_DATA_PAGE, async (_, query: CampaignInputDataPageQuery) => {
    return supabase.listCampaignInputDataPage(query)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_RELATION_SUMMARIES, async (_, campaignIds: number[]) => {
    return supabase.listCampaignRelationSummaries(campaignIds)
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN_INPUT_DATA, async (_, actionData) => {
    return supabase.createCampaignInputData(actionData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CAMPAIGN_INPUT_DATA, async (_, id: number, updates) => {
    return supabase.updateCampaignInputData(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_BULK_UPDATE_CAMPAIGN_INPUT_DATA_STATUS, async (
    _,
    campaignId: number,
    ids: number[],
    status: Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>
  ) => {
    return supabase.bulkUpdateCampaignInputDataStatus(campaignId, ids, status)
  })

  ipcMain.handle(IPC_EVENTS.DB_ADD_CAMPAIGN_INPUT_DATA_TO_CAMPAIGNS, async (
    _,
    request: AddCampaignInputDataToCampaignRequest
  ) => {
    return supabase.addCampaignInputDataToCampaign(request)
  })

  ipcMain.handle(IPC_EVENTS.DB_ADD_CAMPAIGN_INPUT_DATA_ROWS, async (
    _,
    request: AddCampaignInputDataRowsRequest
  ) => {
    return supabase.addCampaignInputDataRows(request)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN_INPUT_DATA, async (_, id: number) => {
    return supabase.deleteCampaignInputData(id)
  })

  // Campaign Details (per-milestone log)
  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_DETAILS_BY_INPUT_DATA, async (_, inputDataId: number) => {
    return supabase.listCampaignDetailsByInputData(inputDataId)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_DETAILS_BY_CAMPAIGN, async (_, campaignId: number) => {
    return supabase.listCampaignDetailsByCampaign(campaignId)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_DETAILS_PAGE, async (_, query: CampaignDetailPageQuery) => {
    return supabase.listCampaignDetailsPage(query)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_EMAIL_CAMPAIGN_LINK_TRACKINGS, async (_, campaignId: number) => {
    return supabase.listEmailCampaignLinkTrackingSummaries(campaignId)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_CAMPAIGN_RUN_EVENTS_BY_CAMPAIGN, async (
    _,
    campaignId: number,
    options?: CampaignRunEventListOptions
  ) => {
    return supabase.listCampaignRunEventsByCampaign(campaignId, options)
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN_DETAIL, async (_, actionData) => {
    return supabase.createCampaignDetail(actionData)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN_DETAIL, async (_, id: number) => {
    return supabase.deleteCampaignDetail(id)
  })
}
