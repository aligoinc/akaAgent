import type { AccountActionStatusReportDetailQuery } from '../../../shared/actionStatusReport'
import { ipcMain } from 'electron'
import { AccountActionReportDetailQuery, AccountActionReportQuery, IPC_EVENTS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { EFFECTIVENESS_IPC, type EffectivenessIpcRequest } from '../../../shared/effectivenessIpc'
import { handleEffectivenessRequest } from '../../services/effectivenessReportService'
import { DATA_REPORT_IPC, type DataReportIpcRequest } from '../../../shared/dataReportIpc'
import { handleDataReportRequest } from '../../services/dataReportService'
import { CAMPAIGN_RUN_REPORT_IPC, type CampaignRunReportIpcRequest } from '../../../shared/campaignRunReportIpc'
import { handleCampaignRunReportRequest } from '../../services/campaignRunReportService'
import { CAMPAIGN_RESULT_ACTIONS_IPC, type CampaignResultActionsIpcRequest } from '../../../shared/campaignResultActionsIpc'
import { handleCampaignResultActionsRequest } from '../../services/campaignResultActionsService'

export function registerReportHandlers(supabase: SupabaseService): void {
  ipcMain.handle(IPC_EVENTS.REPORT_ACCOUNT_ACTION_STATUS_SUMMARY, async (_, query: AccountActionReportQuery) => {
    return supabase.getAccountActionStatusReport(query)
  })
  ipcMain.handle(IPC_EVENTS.REPORT_ACCOUNT_ACTION_STATUS_DETAILS, async (_, query: AccountActionStatusReportDetailQuery) => {
    return supabase.getAccountActionStatusReportDetails(query)
  })
  ipcMain.handle(IPC_EVENTS.REPORT_ACCOUNT_ACTION_SUMMARY, async (_, query: AccountActionReportQuery) => {
    return supabase.getAccountActionReport(query)
  })

  ipcMain.handle(IPC_EVENTS.REPORT_ACCOUNT_ACTION_DETAILS, async (_, query: AccountActionReportDetailQuery) => {
    return supabase.getAccountActionReportDetails(query)
  })

  // Báo cáo hiệu quả: one channel, never throws ({ok,data} | {ok:false,code,message}).
  ipcMain.handle(EFFECTIVENESS_IPC, (_, request: EffectivenessIpcRequest) => handleEffectivenessRequest(request))

  // Báo cáo dữ liệu: nightly snapshot (V469) and one customer's journey; same envelope, never throws.
  ipcMain.handle(DATA_REPORT_IPC, (_, request: DataReportIpcRequest) => handleDataReportRequest(request))

  // Tab "Báo cáo" của chi tiết chiến dịch: one V487 read per open/refresh; same envelope, never throws.
  ipcMain.handle(CAMPAIGN_RUN_REPORT_IPC, (_, request: CampaignRunReportIpcRequest) => handleCampaignRunReportRequest(request))

  // Tab Kết quả chạy: danh sách hành động và chế độ "Gộp hành động vào một dòng" (V539/V540); same envelope, never throws.
  ipcMain.handle(CAMPAIGN_RESULT_ACTIONS_IPC, (_, request: CampaignResultActionsIpcRequest) => handleCampaignResultActionsRequest(request))
}
