import { ipcMain } from 'electron'
import { CAMPAIGN_STATUSES, IPC_EVENTS, type AddCampaignInputDataToCampaignRequest, type Campaign, type CampaignInputStatus, type CampaignStatus } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

interface CampaignPauseController {
  requestPauseCampaign(campaignId: number): Promise<Campaign>
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

export function registerCampaignHandlers(supabase: SupabaseService, campaignPauseController: CampaignPauseController): void {
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
    return supabase.createCampaign(campaignData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CAMPAIGN, async (_, id: number, updates: Partial<Campaign> | null | undefined) => {
    const payload = updates || {}
    if (isStatusOnlyCampaignUpdate(payload) && payload.status === 'tạm dừng') {
      return campaignPauseController.requestPauseCampaign(id)
    }
    await assertCanUpdateCampaignFromRenderer(supabase, id, payload)
    return supabase.updateCampaign(id, payload)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN, async (_, id: number) => {
    return supabase.deleteCampaign(id)
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

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CAMPAIGN_DETAIL, async (_, actionData) => {
    return supabase.createCampaignDetail(actionData)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CAMPAIGN_DETAIL, async (_, id: number) => {
    return supabase.deleteCampaignDetail(id)
  })
}
