import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'
import {
  campaignSheetSyncErrorCode, campaignSheetSyncErrorMessage, CAMPAIGN_SHEET_SYNC_MAX_VALUES,
  type CampaignSheetSyncResult
} from '../../../shared/campaignSheetSync'

const ACTIONS = new Set(['settings', 'state', 'list', 'runs', 'save', 'stop', 'resume'])
const TIMEOUT_MS = 25_000
const MAX_PAYLOAD_CHARS = 2_000_000

const failure = (code: string, detail?: string | null): CampaignSheetSyncResult<never> =>
  ({ ok: false, code, message: campaignSheetSyncErrorMessage(code, detail) })

/**
 * Đồng bộ Google Sheet vào data chiến dịch (V662): `aka_agent_campaign_sheet_sync(p_payload)`, nhân viên lấy từ phiên
 * Desktop. Một lượt RPC mỗi lần gọi, không thử lại, không ném lỗi. DB chưa có hàm (PGRST202 / 42883) → `sheet_sync_not_ready`.
 */
export async function callCampaignSheetSync(payload: unknown): Promise<CampaignSheetSyncResult<unknown>> {
  const request = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null
  if (!request || typeof request.action !== 'string' || !ACTIONS.has(request.action)) return failure('sheet_sync_invalid')
  if (Array.isArray(request.sheetValues) && request.sheetValues.length > CAMPAIGN_SHEET_SYNC_MAX_VALUES) return failure('sheet_sync_invalid')
  if (JSON.stringify(request).length > MAX_PAYLOAD_CHARS) return failure('sheet_sync_invalid')
  try {
    requireCurrentUser()
  } catch {
    return failure('sheet_sync_unauthorized')
  }
  try {
    const { data, error } = await getSupabaseClient()
      .rpc('aka_agent_campaign_sheet_sync', { p_payload: request })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    if (error) {
      const sqlCode = typeof error.code === 'string' ? error.code : ''
      if (sqlCode === 'PGRST202' || sqlCode === '42883') return failure('sheet_sync_not_ready')
      const code = campaignSheetSyncErrorCode(error.message) || 'sheet_sync_failed'
      if (code === 'sheet_sync_failed') console.warn(`[CampaignSheetSync] ${request.action} thất bại:`, sqlCode || 'unknown')
      return failure(code, typeof error.details === 'string' ? error.details : null)
    }
    return { ok: true, data }
  } catch {
    return failure('sheet_sync_failed')
  }
}
