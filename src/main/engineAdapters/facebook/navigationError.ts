/**
 * Lỗi mở trang của Chromium (page.navigate / loadURL): `ERR_CONNECTION_TIMED_OUT (-118) loading 'https://www.facebook.com/'`.
 * Trang chưa tải xong nên block chưa tìm phần tử nào: đây là lỗi mạng / proxy / trình duyệt, không phải lỗi giao diện Facebook.
 */
const NAVIGATION_ERROR_RE = /\b(ERR_[A-Z0-9_]+) \(-\d+\) loading '([^']+)'/

export interface NavigationError {
  /** Mã lỗi Chromium, vd `ERR_PROXY_CONNECTION_FAILED`. */
  code: string
  /** Host của trang đang mở (rỗng khi URL không đọc được). */
  host: string
}

export function parseNavigationError(message: string | null | undefined): NavigationError | null {
  const match = String(message ?? '').match(NAVIGATION_ERROR_RE)
  if (!match) return null
  let host = ''
  try { host = new URL(match[2]).host } catch { /* URL lạ: chỉ giữ mã */ }
  return { code: match[1], host }
}
