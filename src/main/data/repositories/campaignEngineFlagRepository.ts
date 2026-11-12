import { getSupabaseClient } from '../supabaseClient'

const CAMPAIGN_ENGINE_FLAG_TIMEOUT_MS = 10_000

/**
 * V513: tổ chức trong phiên Desktop có bật cờ engine v2 (`org_organization.use_new_zalo_runtime`) không. Hàm DB đọc tổ chức từ
 * phiên Desktop, không nhận tham số. Đọc một lần lúc đăng nhập; lỗi mạng, hết giờ hoặc DB chưa có V513 (PGRST202) thì coi như
 * cờ tắt và chạy bộ cũ như trước.
 */
export async function loadCampaignEngineV2Enabled(): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseClient()
      .rpc('aka_agent_engine_desktop_enabled_v1')
      .abortSignal(AbortSignal.timeout(CAMPAIGN_ENGINE_FLAG_TIMEOUT_MS))
    if (error) {
      if (error.code !== 'PGRST202') console.warn('[auth] Không đọc được cờ engine chiến dịch v2:', error.message)
      return false
    }
    return data === true
  } catch (error) {
    console.warn('[auth] Không đọc được cờ engine chiến dịch v2:', error)
    return false
  }
}
