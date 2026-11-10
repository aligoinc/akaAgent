import type { CampaignRunReport } from './campaignRunReport'

/**
 * Tab "Báo cáo" của chi tiết chiến dịch (Desktop): một kênh IPC, không bao giờ ném lỗi qua IPC.
 * Main đọc chiến dịch rồi gọi RPC chỉ đọc V487 (`aka_agent_read_campaign_run_report`, cấp cho token Desktop ở V489)
 * và dựng báo cáo bằng `buildCampaignRunReport` dùng chung với WebApp.
 */
export const CAMPAIGN_RUN_REPORT_IPC = 'report:campaign-run'

export interface CampaignRunReportIpcRequest {
  campaignId: number
}

export type CampaignRunReportIpcResult =
  | { ok: true; data: CampaignRunReport }
  | { ok: false; code: string; message: string }
