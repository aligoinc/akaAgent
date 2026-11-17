import type { ActionReportStatusCatalog } from '../../shared/actionStatusReport'
import { getAccountActionName, getCampaignAccountOverviewActionDescriptors } from '../../shared/campaignActionDescriptors'
import { CAMPAIGN_RUN_REPORT_BUSY, CAMPAIGN_RUN_REPORT_UNAVAILABLE, buildCampaignRunReport, type CampaignRunReport } from '../../shared/campaignRunReport'
import type { CampaignRunReportIpcRequest, CampaignRunReportIpcResult } from '../../shared/campaignRunReportIpc'
import type { Campaign } from '../../shared/types'
import { requireCurrentUser, runWithCurrentUser } from '../data/currentUser'
import * as repo from '../data/repositories/campaignRunReportRepository'
import { CampaignRunReportReadError } from '../data/repositories/campaignRunReportRepository'
import { getSupabaseClient } from '../data/supabaseClient'
import { loadActionReportStatusCatalog } from '../domain/reports/actionStatusReportCatalog'
import { ReportReadFlights, reportFlightKey } from '../domain/reports/reportReadFlights'
import { REPORT_READ_TIMEOUT_MS } from '../domain/reports/reportReadRpc'

/**
 * Tab "Báo cáo" của chi tiết chiến dịch trên Desktop (10/11/2026). Mỗi lượt mở/làm mới: đọc dòng chiến dịch rồi một
 * lượt RPC chỉ đọc V487 (tổng hợp trong DB theo campaign_id, trần 60 s; Desktop được cấp quyền ở V489) qua client
 * HTTP sẵn có của tiến trình. Hạn cả lượt 65 s; gộp lượt trùng, tối đa 2 lượt khác nhau (cổng riêng, không chặn báo
 * cáo khác); không cache kết quả, không hẹn giờ. Danh mục trạng thái (cấu hình chung) giữ 5 phút; không tải được thì
 * vẫn dựng bằng tên trạng thái đã ghi.
 */
const flights = new ReportReadFlights()
const CATALOG_TTL_MS = 5 * 60_000
let catalogCache: { value: ActionReportStatusCatalog; expires: number } | null = null

// Facebook "Đăng bài trang cá nhân" và "Tương tác newsfeed" không có data đầu vào (như WebApp facebookUsesInputData).
export const FACEBOOK_WITHOUT_INPUT_DATA: ReadonlySet<string> = new Set(['facebook_timeline_post', 'facebook_newsfeed_interaction'])

async function statusCatalog(signal: AbortSignal): Promise<ActionReportStatusCatalog | null> {
  if (catalogCache && catalogCache.expires > Date.now()) return catalogCache.value
  try {
    const value = await loadActionReportStatusCatalog(getSupabaseClient(), signal)
    catalogCache = { value, expires: Date.now() + CATALOG_TTL_MS }
    return value
  } catch {
    return null
  }
}

async function readReport(campaignId: number, signal: AbortSignal): Promise<CampaignRunReport> {
  const campaign = await repo.readCampaignRunReportCampaign(campaignId, signal)
  const rpc = await repo.readCampaignRunReportRpc(campaignId, signal)
  const catalog = signal.aborted ? null : await statusCatalog(signal)
  const configured = getCampaignAccountOverviewActionDescriptors({
    actionId: campaign.actionId, extraSettings: campaign.extraSettings as Campaign['extraSettings']
  }).map(action => action.code)
  const codes = new Set<string>(configured)
  for (const row of rpc.results.groups) if (row.actionCode) codes.add(row.actionCode)
  const inputTotal = rpc.inputs.reduce((sum, row) => sum + row.count, 0)
  // Theo loại chiến dịch như WebApp. Desktop có thêm các loại WebApp chưa quản lý: chiến dịch không có data nào
  // mà đã có kết quả thì hiện bố cục theo lượt thay vì "Tổng data 0".
  const usesInputData = (campaign.platform !== 'facebook' || !FACEBOOK_WITHOUT_INPUT_DATA.has(campaign.actionId))
    && !(inputTotal === 0 && rpc.results.total > 0)
  return buildCampaignRunReport({
    rpc, catalog, platform: campaign.platform, usesInputData, configuredActionCodes: configured,
    actionNames: Object.fromEntries(Array.from(codes).map(code => [code, getAccountActionName(code)]))
  })
}

export async function handleCampaignRunReportRequest(request: CampaignRunReportIpcRequest): Promise<CampaignRunReportIpcResult> {
  const campaignId = Number(request?.campaignId)
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    return { ok: false, code: 'invalid_campaign_id', message: 'ID chiến dịch không hợp lệ.' }
  }
  try {
    const user = requireCurrentUser()
    const key = reportFlightKey('campaign-run', [user.staffId, user.organizationId], { campaignId })
    const data = await runWithCurrentUser(user, () => flights.run(key, () => readReport(campaignId, AbortSignal.timeout(REPORT_READ_TIMEOUT_MS))))
    return { ok: true, data }
  } catch (error) {
    if (error instanceof CampaignRunReportReadError) return { ok: false, code: error.code, message: error.message }
    const message = error instanceof Error ? error.message : String(error)
    if (/Đang tải báo cáo khác/.test(message)) return { ok: false, code: 'report_busy', message: CAMPAIGN_RUN_REPORT_BUSY }
    if (/chưa đăng nhập|đăng nhập lại|Not logged in/i.test(message)) {
      return { ok: false, code: 'session_invalid', message: 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.' }
    }
    console.warn('[campaignRunReport] request failed:', message)
    return { ok: false, code: 'campaign_report_unavailable', message: CAMPAIGN_RUN_REPORT_UNAVAILABLE }
  }
}
