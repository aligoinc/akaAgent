import type { NetworkRequestSignal } from '../../shared/networkStatus'

/**
 * Tín hiệu mạng cho dòng báo mất mạng (docs/NETWORK_STATUS_BAR_DESKTOP.md).
 *
 * `desktopFetch` báo mỗi request tới máy chủ dữ liệu: lỗi mạng thì `failed` (tối đa một lần mỗi giây, vì bộ chạy
 * chiến dịch có thể lỗi hàng loạt cùng lúc); có phản hồi thì `ok`, nhưng chỉ gửi khi trước đó đã gửi `failed`,
 * để lúc mạng bình thường không có IPC nào. Không hẹn giờ, không tự gửi request.
 */
const FAILURE_SIGNAL_INTERVAL_MS = 1_000
export const NETWORK_PROBE_TIMEOUT_MS = 8_000

let listener: ((signal: NetworkRequestSignal) => void) | null = null
let failureSent = false
let lastFailureSentAt = Number.NEGATIVE_INFINITY

export function setNetworkSignalListener(next: ((signal: NetworkRequestSignal) => void) | null): void {
  listener = next
}

const emit = (signal: NetworkRequestSignal) => {
  try { listener?.(signal) } catch { /* Cửa sổ đã đóng: bỏ qua, không ảnh hưởng request. */ }
}

/** Request tới máy chủ dữ liệu bị lỗi mạng (không tính request bị huỷ). */
export function reportNetworkRequestFailure(now = Date.now()): void {
  if (now - lastFailureSentAt < FAILURE_SIGNAL_INTERVAL_MS) return
  lastFailureSentAt = now
  failureSent = true
  emit('failed')
}

/** Request tới máy chủ dữ liệu nhận được phản hồi HTTP (bất kể mã trạng thái). */
export function reportNetworkRequestSuccess(): void {
  if (!failureSent) return
  failureSent = false
  emit('ok')
}

/** Chỉ dùng cho smoke test. */
export function resetNetworkSignalsForTest(): void {
  listener = null
  failureSent = false
  lastFailureSentAt = Number.NEGATIVE_INFINITY
}

/**
 * Thử kết nối một lần: `GET <máy chủ>/auth/v1/health` kèm khóa định danh dự án (không phải khóa bí mật, không đọc DB).
 * Có phản hồi HTTP bất kỳ là còn mạng; chỉ lỗi mạng hoặc quá hạn mới tính là mất.
 */
export async function probeNetwork(
  baseUrl: string,
  publishableKey: string,
  send: typeof fetch = fetch,
  timeoutMs = NETWORK_PROBE_TIMEOUT_MS
): Promise<boolean> {
  try {
    const response = await send(new URL('/auth/v1/health', baseUrl).toString(), {
      method: 'GET',
      headers: { apikey: publishableKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs)
    })
    // Không cần nội dung; huỷ phần thân để trả kết nối ngay.
    void response.body?.cancel().catch(() => undefined)
    return true
  } catch {
    return false
  }
}
