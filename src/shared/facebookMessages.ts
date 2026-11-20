/**
 * Trang "Tin nhắn Facebook": gom Messenger của nhiều tài khoản Facebook vào một chỗ.
 *
 * Mỗi tài khoản được chọn có một <webview> riêng mở facebook.com/messages, dùng chung
 * phân vùng `persist:account_<id>` (cookie, proxy) với tab Trình duyệt. Webview này
 * KHÔNG đăng ký vào WebviewRegistry nên chiến dịch không bao giờ chạy trên nó.
 */

export const FACEBOOK_MESSAGES_URL = 'https://www.facebook.com/messages/'

/** Danh sách tài khoản được chọn lưu trên máy, theo tổ chức + nhân viên. */
export const FACEBOOK_MESSAGES_SELECTION_KEY_PREFIX = 'aka.fbMessages.selectedAccountIds.v1'

export function facebookMessagesSelectionKey(organizationId: number, staffId: number): string {
  return `${FACEBOOK_MESSAGES_SELECTION_KEY_PREFIX}:${organizationId}:${staffId}`
}

/** Đọc danh sách id đã lưu; dữ liệu hỏng thì coi như chưa chọn. */
export function parseFacebookMessagesSelection(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const ids: number[] = []
    for (const item of value) {
      const id = Number(item)
      if (Number.isSafeInteger(id) && id > 0 && !ids.includes(id)) ids.push(id)
    }
    return ids
  } catch {
    return []
  }
}

/**
 * Đếm số đoạn chat chưa đọc trong danh sách "Đoạn chat" của facebook.com/messages.
 * Tiêu đề trang KHÔNG có số (đo trên trang thật 20/11/2026: 8 đoạn chưa đọc mà tiêu
 * đề vẫn là "Messenger | Facebook"). Mỗi dòng chưa đọc có một chữ ẩn cho trình đọc
 * màn hình "Tin nhắn chưa đọc:" bên trong link /messages/t/<id> hoặc /messages/e2ee/t/<id>.
 * Chỉ đếm được các đoạn chat đang hiện trong danh sách (khoảng 20–30 đoạn gần nhất).
 * Trả về null khi trang không có danh sách đoạn chat (đang ở trang khác, đang tải).
 * Chạy bằng executeJavaScript trên webview của trang Tin nhắn, chỉ đọc DOM.
 */
// String.raw: template thường nuốt dấu \ của regex (\/ thành /).
export const FACEBOOK_UNREAD_COUNT_SCRIPT = String.raw`(() => {
  const marker = /^(Tin nhắn chưa đọc|Unread message):?$/i;
  const threads = new Set();
  const unread = new Set();
  for (const link of document.querySelectorAll('a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]')) {
    let path = '';
    try { path = new URL(link.getAttribute('href') || '', 'https://www.facebook.com/').pathname; } catch (error) { continue; }
    if (/^\/messages\/(e2ee\/)?t\/?$/.test(path)) continue;
    threads.add(path);
    for (const node of link.querySelectorAll('div, span')) {
      if (node.childElementCount === 0 && marker.test((node.textContent || '').trim())) {
        unread.add(path);
        break;
      }
    }
  }
  return threads.size > 0 ? unread.size : null;
})()`

export function normalizeFacebookUnreadCount(value: unknown): number | null {
  const count = typeof value === 'number' ? value : Number.NaN
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

export function formatFacebookUnreadBadge(count: number): string {
  return count > 99 ? '99+' : String(count)
}
