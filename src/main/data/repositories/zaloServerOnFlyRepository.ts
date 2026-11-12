import { getSupabaseClient } from '../supabaseClient'

const ZALO_SERVER_ON_FLY_TIMEOUT_MS = 10_000

/**
 * V498: tài khoản Zalo Server của tổ chức trong phiên Desktop đang chạy trên Fly (có Chat, hoặc ChatApi đã nhận theo cờ
 * engine v2). Hàm DB đọc tổ chức từ phiên Desktop, không nhận tham số. Chỉ dùng để Desktop nghe tiến trình chiến dịch từ
 * ChatApi, nên lỗi mạng hoặc DB chưa có V498 (PGRST202) thì coi như không chạy trên Fly và giữ đúng hành vi cũ.
 */
export async function loadZaloServerOnFly(): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseClient()
      .rpc('aka_agent_zalo_server_on_fly_v1')
      .abortSignal(AbortSignal.timeout(ZALO_SERVER_ON_FLY_TIMEOUT_MS))
    if (error) {
      if (error.code !== 'PGRST202') console.warn('[auth] Không kiểm được tài khoản Zalo Server chạy trên Fly:', error.message)
      return false
    }
    return data === true
  } catch (error) {
    console.warn('[auth] Không kiểm được tài khoản Zalo Server chạy trên Fly:', error)
    return false
  }
}
