import { getSupabaseClient } from '../supabaseClient'

const CAMPAIGN_ENGINE_FLAG_TIMEOUT_MS = 10_000

/**
 * V513: tổ chức trong phiên Desktop có bật cờ engine v2 (`org_organization.use_new_zalo_runtime`) không. Hàm DB đọc tổ chức từ
 * phiên Desktop, không nhận tham số. Đọc một lần lúc đăng nhập; lỗi mạng, hết giờ hoặc DB chưa có V513 (PGRST202) thì coi như
 * cờ tắt và chạy bộ cũ như trước. Cờ này còn chọn nơi chạy tài khoản Zalo Server (bật = Fly, tắt = App Server).
 */
export async function loadCampaignEngineV2Enabled(): Promise<boolean> {
  return readSessionBoolean('aka_agent_engine_desktop_enabled_v1', 'cờ engine chiến dịch v2')
}

/**
 * V667: tổ chức trong phiên Desktop có trong công tắc `engine.zalo_server_vps` không (tổ chức chưa bật cờ, tài khoản Zalo Server chạy
 * engine v2 trên App Server). Đúng thì tài khoản Zalo QR / trình duyệt của bản Desktop này cũng chạy engine v2; không đổi nơi chạy tài
 * khoản Zalo Server (vẫn theo `loadCampaignEngineV2Enabled`). Chỉ hỏi khi cờ tắt. Đọc một lần lúc đăng nhập; lỗi hoặc DB chưa có V667
 * (PGRST202) thì coi như tắt.
 */
export async function loadDesktopVpsEngineEnabled(): Promise<boolean> {
  return readSessionBoolean('aka_agent_engine_desktop_vps_enabled_v1', 'công tắc engine v2 của tổ chức chạy App Server')
}

async function readSessionBoolean(fn: string, label: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseClient()
      .rpc(fn)
      .abortSignal(AbortSignal.timeout(CAMPAIGN_ENGINE_FLAG_TIMEOUT_MS))
    if (error) {
      if (error.code !== 'PGRST202') console.warn(`[auth] Không đọc được ${label}:`, error.message)
      return false
    }
    return data === true
  } catch (error) {
    console.warn(`[auth] Không đọc được ${label}:`, error)
    return false
  }
}
