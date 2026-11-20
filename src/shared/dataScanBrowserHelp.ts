/**
 * Câu lỗi cho khách khi quét data gặp lỗi xử lý được trong tab Trình duyệt của tài khoản, kèm trang cần mở.
 * Câu do anh duyệt ngày 20/11/2026. Lỗi gốc vẫn nằm ở nhật ký quét và auto_account_logs; hàm này chỉ đổi câu hiển thị.
 */

export const DATA_SCAN_OPEN_BROWSER_LABEL = 'Mở trình duyệt'

export const FACEBOOK_HOME_URL = 'https://www.facebook.com/'
export const FACEBOOK_BUSINESS_CONTENT_URL = 'https://business.facebook.com/content_management'
export const ZALO_WEB_URL = 'https://chat.zalo.me/'

export const DATA_SCAN_TEXT = {
  facebookPageUnreachable: 'Không mở được trang Facebook. Bấm "Mở trình duyệt" để kiểm tra.',
  facebookProxyUnreachable: 'Không kết nối được proxy của tài khoản nên không mở được trang Facebook. Vui lòng kiểm tra lại proxy.',
  facebookVerificationCode: 'Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm "Mở trình duyệt", nhập mã rồi quét lại.',
  facebookNotLoggedIn: 'Tài khoản chưa đăng nhập Facebook. Bấm "Mở trình duyệt" để đăng nhập, rồi quét lại.',
  facebookCheckpoint: 'Facebook đang yêu cầu xác minh tài khoản này. Bấm "Mở trình duyệt" để xử lý, rồi quét lại.',
  zaloWebNotReady: 'Zalo trên trình duyệt của tài khoản này chưa sẵn sàng. Bấm "Mở trình duyệt" để tải lại trang Zalo, rồi quét lại.',
  zaloWebLoggedOut: 'Tài khoản chưa đăng nhập Zalo trên trình duyệt. Bấm "Mở trình duyệt" để đăng nhập, rồi quét lại.'
} as const

/** Đầu câu chung của lỗi thiếu token trang Business: câu của tiến trình chính và câu của block quét page (V589). */
const FACEBOOK_VERIFICATION_PREFIX = 'Facebook đang yêu cầu nhập mã xác minh cho tài khoản này'
const FACEBOOK_NOT_LOGGED_IN = 'Tài khoản chưa đăng nhập Facebook'
const ZALO_NOT_LOGGED_IN = 'Tài khoản chưa đăng nhập Zalo'
const ZALO_WEB_LOGGED_OUT = 'Zalo Web đã đăng xuất'
/** Câu của zaloWebRuntimeService / zaloRuntimeService khi app chưa đọc được phiên Zalo trong tab. */
const ZALO_WEB_NOT_READY_FRAGMENTS = [
  'Chưa xác minh được phiên Zalo Web',
  'Hãy mở tab Zalo Web',
  'Hãy mở lại tab Zalo Web',
  'Hãy mở trang chat.zalo.me',
  'Bộ theo dõi phiên Zalo Web',
  'Bộ theo dõi Zalo Web',
  'Tab Zalo Web không khả dụng',
  'Trang Zalo Web đang tải',
  'tải lại tab Zalo'
]

/** Lỗi mở trang của Chromium: `ERR_CONNECTION_TIMED_OUT (-118) loading 'https://…'`. */
const NAVIGATION_ERROR_RE = /\b(ERR_[A-Z0-9_]+) \(-\d+\) loading '([^']+)'/
const SAVED_SUFFIX_RE = /\s*Đã lưu (\d+) data\.?\s*$/
const IPC_PREFIX_RE = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/

export interface DataScanErrorAccount {
  flatformType?: string | null
  isZaloShowWeb?: boolean | null
  isZaloServer?: boolean | null
  loginStatus?: string | null
  proxyId?: number | null
}

export interface DataScanErrorView {
  message: string
  /** Trang mở trong tab Trình duyệt của tài khoản; không có thì chỉ hiện nút Đóng. */
  openUrl?: string
}

export function isProxyNavigationErrorCode(code: string): boolean {
  // PROXY, PROXIES (ERR_NO_SUPPORTED_PROXIES), SOCKS; đường hầm CONNECT chỉ có khi đi qua proxy.
  return /PROX(?:Y|IES)|SOCKS/.test(code) || code === 'ERR_TUNNEL_CONNECTION_FAILED'
}

function facebookHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    return host === 'facebook.com' || host.endsWith('.facebook.com') ? url.toString() : null
  } catch {
    return null
  }
}

function withSavedSuffix(message: string, savedCount: number): string {
  return savedCount > 0 ? `${message} Đã lưu ${savedCount} data.` : message
}

export function describeDataScanError(rawError: unknown, account: DataScanErrorAccount | null | undefined): DataScanErrorView {
  const raw = String(rawError ?? '').replace(IPC_PREFIX_RE, '').trim()
  if (!raw || !account) return { message: raw }

  const savedMatch = raw.match(SAVED_SUFFIX_RE)
  const savedCount = savedMatch ? Number(savedMatch[1]) || 0 : 0
  const core = (savedMatch ? raw.slice(0, savedMatch.index) : raw).trim()
  const platform = String(account.flatformType || '').trim().toLowerCase()

  if (platform === 'facebook') {
    if (core.startsWith(FACEBOOK_VERIFICATION_PREFIX)) {
      return { message: withSavedSuffix(DATA_SCAN_TEXT.facebookVerificationCode, savedCount), openUrl: FACEBOOK_BUSINESS_CONTENT_URL }
    }
    if (core.replace(/[.\s]+$/, '') === FACEBOOK_NOT_LOGGED_IN) {
      return {
        message: account.loginStatus === 'checkpoint' ? DATA_SCAN_TEXT.facebookCheckpoint : DATA_SCAN_TEXT.facebookNotLoggedIn,
        openUrl: FACEBOOK_HOME_URL
      }
    }
    const navigation = core.match(NAVIGATION_ERROR_RE)
    if (navigation) {
      const url = facebookHttpsUrl(navigation[2])
      if (!url) return { message: raw }
      // Tab Trình duyệt đi qua cùng proxy nên mở ra cũng không tải được; chỉ báo kiểm tra proxy.
      if (isProxyNavigationErrorCode(navigation[1]) && account.proxyId) {
        return { message: withSavedSuffix(DATA_SCAN_TEXT.facebookProxyUnreachable, savedCount) }
      }
      return { message: withSavedSuffix(DATA_SCAN_TEXT.facebookPageUnreachable, savedCount), openUrl: url }
    }
    return { message: raw }
  }

  if (platform === 'zalo' && account.isZaloShowWeb === true && account.isZaloServer !== true) {
    if (core.replace(/[.\s]+$/, '') === ZALO_NOT_LOGGED_IN || core.includes(ZALO_WEB_LOGGED_OUT)) {
      return { message: DATA_SCAN_TEXT.zaloWebLoggedOut, openUrl: ZALO_WEB_URL }
    }
    if (ZALO_WEB_NOT_READY_FRAGMENTS.some(fragment => core.includes(fragment))) {
      return { message: DATA_SCAN_TEXT.zaloWebNotReady, openUrl: ZALO_WEB_URL }
    }
  }

  return { message: raw }
}
