/**
 * Đồng bộ trạng thái tin nhắn Zalo: nối phần chạy (zaloMessageStatusRuntime.ts) với DB thật của tiến trình này.
 * Một bộ dùng chung cho cả tiến trình: App Server (nhiều nhân viên) và app Desktop (một nhân viên đăng nhập).
 *
 * - App Server chạy bằng quyền máy chủ: gọi thẳng hàm nhận lô `aka_agent_ingest_zalo_message_status` với nguồn 'server'.
 * - App Desktop là máy khách: gọi hàm bọc `aka_agent_desktop_ingest_zalo_message_status`; DB lấy nhân viên từ phiên đăng
 *   nhập và chỉ nhận sự kiện của tài khoản do nhân viên đó phụ trách.
 * Không thêm kết nối hay vòng hỏi định kỳ nào: cấu hình chỉ được đọc (tối đa 5 phút một lần) khi tiến trình đang gửi tin
 * hoặc đang nhận sự kiện Zalo, và lô chỉ được gửi khi bộ đệm có sự kiện.
 * Độc lập với theo dõi tương tác cũ (zaloCampaignEngagement.ts): không dùng chung công tắc, bộ đệm hay lời gọi DB.
 */
import { getCurrentUser, onCurrentUserSessionChanged } from '../data/currentUser'
import { getSupabaseClient, isTrustedServerSupabaseConfigured } from '../data/supabaseClient'
import { peekDatabaseRuntimeClock } from '../data/repositories/runtimeClockRepository'
import { MESSAGE_STATUS_DESKTOP_INGEST_RPC, MESSAGE_STATUS_INGEST_RPC, MESSAGE_STATUS_SYNC_KEYS,
  type ZaloStatusRef } from '../../shared/zaloMessageStatusSync'
import { ZaloMessageStatusRuntime, type ZaloMessageStatusSend } from './zaloMessageStatusRuntime'

export type { ZaloMessageStatusSend } from './zaloMessageStatusRuntime'

let lastWarningAt = 0

const runtime = new ZaloMessageStatusRuntime({
  loadSettings: async () => {
    const { data, error } = await getSupabaseClient().from('auto_system_settings')
      .select('key,value,is_active,is_secret').in('key', [...MESSAGE_STATUS_SYNC_KEYS])
      .abortSignal(AbortSignal.timeout(5_000))
    if (error) throw error
    return data || []
  },
  ingest: async items => {
    const client = getSupabaseClient()
    const request = isTrustedServerSupabaseConfigured()
      ? client.rpc(MESSAGE_STATUS_INGEST_RPC, { p_source: 'server', p_events: items })
      : client.rpc(MESSAGE_STATUS_DESKTOP_INGEST_RPC, { p_events: items })
    const { data, error } = await request.abortSignal(AbortSignal.timeout(20_000))
    if (error) throw error
    return data
  },
  // Giờ gửi và giờ nhận biên nhận dùng đồng hồ DB khi đang có (đồng hồ máy khách có thể sai); không có thì giờ máy, DB tự
  // kéo các mốc lệch về giờ của nó.
  nowIso: () => peekDatabaseRuntimeClock()?.dbNow ?? new Date().toISOString(),
  warn: (kind, detail) => {
    if (Date.now() - lastWarningAt < 60_000) return
    lastWarningAt = Date.now()
    console.warn('[ZaloMessageStatus] degraded', { kind, ...detail, ...runtime.metrics })
  }
})

// Desktop: đổi người đăng nhập hoặc đăng xuất thì bỏ phần đang đệm (sự kiện thuộc tài khoản của người trước).
// App Server không có "người đăng nhập": các nhân viên chạy song song, bộ đệm dùng chung và không bị xoá ở đây.
onCurrentUserSessionChanged(() => { if (!isTrustedServerSupabaseConfigured()) runtime.reset() })

/** Tính năng đang bật cho tiến trình này (theo cấu hình đã đọc; không chờ IO). Dùng để quyết định mở bộ nghe Zalo. */
export function zaloMessageStatusSyncEnabled(): boolean {
  try { return runtime.enabled(getCurrentUser()?.organizationId) } catch { return false }
}

/**
 * Gọi ngay trước khi gửi một tin 1-1 (`message`) hoặc lời mời kết bạn (`friend_request`) của chiến dịch.
 * `ownUid`: UID Zalo của tài khoản lấy từ phiên đang chạy (getCachedOwnUid), không có thì dùng `account.zaloUid`.
 * Trả `null` khi không theo dõi được; ngược lại trải `send.detailData(response)` vào `data` của kết quả gửi THÀNH CÔNG.
 */
export function beginZaloMessageStatusSend(
  account: { id: number; zaloUid?: string | null; isZaloShowWeb?: boolean | null; organizationId?: number | null },
  ownUid: string | null | undefined,
  targetUid: string | null | undefined,
  kind: ZaloStatusRef['k']
): ZaloMessageStatusSend | null {
  try {
    return runtime.beginSend({
      id: account.id, zaloUid: ownUid || account.zaloUid, isZaloShowWeb: account.isZaloShowWeb,
      organizationId: account.organizationId ?? getCurrentUser()?.organizationId
    }, targetUid, kind)
  } catch {
    return null
  }
}

/** Một sự kiện của bộ nghe Zalo (message, reaction, seen_messages, delivered_messages, friend_event). Không ném lỗi. */
export function receiveZaloMessageStatus(type: string, payload: unknown, accountId: number, ownUid: string): void {
  try { runtime.receive(type, payload, accountId, ownUid, getCurrentUser()?.organizationId) } catch { /* cố gắng hết mức */ }
}

/** Số đếm trong RAM của tiến trình (chẩn đoán). */
export const zaloMessageStatusMetrics = runtime.metrics
