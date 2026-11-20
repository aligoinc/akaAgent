/**
 * Đoạn JS chạy trong tab Facebook của tài khoản để bước kiểm đăng nhập 30 giây (AutoCheck) đọc trạng thái.
 *
 * Phải xét địa chỉ của chính trang đang hiển thị: khi trang không tải được, `webContents.getURL()` vẫn trả địa chỉ
 * facebook.com vừa lỗi nhưng tài liệu là trang lỗi `chrome-error://chromewebdata/`, đọc cookie ở đó không có `c_user`
 * nên trước đây tài khoản bị hạ nhầm xuống "chưa đăng nhập" (thấy khi thử nút "Mở trình duyệt" của Quét data 20/11/2026).
 * Trang lỗi hoặc trang không thuộc facebook.com trả `unknown`: giữ nguyên trạng thái tài khoản.
 */
export const FACEBOOK_TAB_LOGIN_PROBE = `
  (function() {
    try {
      var host = String(location.hostname || '').toLowerCase();
      if (location.protocol !== 'https:' || !(host === 'facebook.com' || /\\.facebook\\.com$/.test(host))) {
        return { unknown: true };
      }
      var cookies = document.cookie;
      if (cookies.includes('c_user=')) return { loggedIn: true };
      if (document.querySelector('#checkpoint_title') || window.location.href.includes('checkpoint'))
        return { loggedIn: false, checkpoint: true };
      return { loggedIn: false };
    } catch(e) { return { loggedIn: false }; }
  })()
`

export interface FacebookTabLoginProbeResult {
  unknown?: boolean
  loggedIn?: boolean
  checkpoint?: boolean
}

/** Trạng thái đăng nhập theo kết quả đoạn JS; null = không đổi trạng thái. */
export function facebookTabLoginStatus(result: FacebookTabLoginProbeResult | null | undefined): string | null {
  if (!result || result.unknown) return null
  if (result.loggedIn) return 'đã đăng nhập'
  if (result.checkpoint) return 'checkpoint'
  return 'chưa đăng nhập'
}
