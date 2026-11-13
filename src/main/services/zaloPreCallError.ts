/**
 * Lỗi ném ra TRƯỚC khi gọi Zalo cho thao tác của nơi gọi: zaloRuntimeService đọc tài khoản / phiên từ DB, kiểm gói, đăng nhập lại
 * bằng phiên (ensureApi), đọc lại tài khoản và mở listener tải tệp (sendMessage). Chắc chắn chưa gửi gì tới người nhận.
 *
 * Dấu gắn lên chính đối tượng lỗi (thuộc tính symbol, không liệt kê) nên câu, mã và lớp lỗi giữ nguyên: bộ chạy cũ đọc lỗi như trước;
 * cổng engine v2 của Desktop (engineAdapters/desktopZaloPort.ts) đọc dấu để xếp "chưa gửi" (data về hàng đợi) thay vì "không rõ đã tới".
 */
const ZALO_PRE_CALL = Symbol.for('aka-agent.zalo.preCall')

export function markZaloPreCallError<T>(error: T): T {
  if (error !== null && typeof error === 'object') {
    try {
      Object.defineProperty(error, ZALO_PRE_CALL, { value: true, enumerable: false, configurable: true })
    } catch {
      // Đối tượng lỗi bị khoá: giữ nguyên lỗi, cổng xếp như lỗi thường.
    }
  }
  return error
}

export function isZaloPreCallError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && (error as Record<symbol, unknown>)[ZALO_PRE_CALL] === true
}

/** Chạy một bước chuẩn bị trước khi gọi Zalo; lỗi được gắn dấu rồi ném tiếp. */
export async function zaloPreCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw markZaloPreCallError(error)
  }
}
