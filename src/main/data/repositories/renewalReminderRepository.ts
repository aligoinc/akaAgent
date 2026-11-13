import { getSupabaseClient } from '../supabaseClient'

const RENEWAL_REMINDER_STATE_TIMEOUT_MS = 10_000

/**
 * `aka_agent_renewal_reminder_state()` (chỉ đọc, không tham số, nhân viên lấy từ phiên Desktop): ngày/giờ máy chủ,
 * các ngày có đăng nhập 60 ngày gần nhất, ưu đãi gia hạn sớm. Trả dữ liệu thô để `parseRenewalReminderServerState`
 * kiểm; lỗi mạng, hết giờ hoặc DB chưa có hàm (PGRST202) → null, bên gọi dùng ngày theo đồng hồ máy và không thử lại
 * cho tới lần kích hoạt sau (đăng nhập, sang ngày, gia hạn xong).
 *
 * Không log dữ liệu trả về: có các ngày đăng nhập của nhân viên.
 */
export async function loadRenewalReminderServerState(): Promise<unknown | null> {
  try {
    const { data, error } = await getSupabaseClient()
      .rpc('aka_agent_renewal_reminder_state')
      .abortSignal(AbortSignal.timeout(RENEWAL_REMINDER_STATE_TIMEOUT_MS))
    if (error) {
      if (error.code !== 'PGRST202') console.warn('[RenewalReminder] Không đọc được dữ liệu nhắc gia hạn:', error.code || 'unknown')
      return null
    }
    return data ?? null
  } catch {
    console.warn('[RenewalReminder] Không đọc được dữ liệu nhắc gia hạn.')
    return null
  }
}
