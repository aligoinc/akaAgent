// Phần riêng của Desktop cho mục "Nâng cấp và mua gói" (docs/UPGRADE_PORTAL_DESKTOP.md). `upgradePortal.ts` chép nguyên văn từ
// akaAgentWebApp `packages/control-api/src/upgradePortal.ts` (sửa ở WebApp trước rồi chép lại); tệp này chỉ nối hợp đồng đó
// với IPC và cửa sổ nhúng cổng CRM của phần mềm.

import { parseRenewalLinkTicket } from './renewalReminder'
import {
  UPGRADE_PORTAL_OPEN_ERROR,
  upgradePortalLink,
  type UpgradePortalEntry,
  type UpgradePortalLink
} from './upgradePortal'

export const UPGRADE_PORTAL_IPC = {
  /** `{ from, entitlementId? }` → tiến trình chính chuẩn bị form; link (có thể có vé) do tiến trình chính tự nạp vào form. */
  open: 'upgrade-portal:open',
  webReload: 'upgrade-portal:web-reload',
  /** Trạng thái webview của form (tiến trình chính → giao diện). */
  webState: 'upgrade-portal:web-state',
  /** Đóng form: xoá dữ liệu phiên cổng, đọc lại gói một lượt (khi đang đăng nhập). */
  close: 'upgrade-portal:close',
  /** Lối dự phòng "Mở bằng trình duyệt": tiến trình chính dựng link rồi mở trình duyệt ngoài. */
  openExternal: 'upgrade-portal:open-external'
} as const

export const UPGRADE_PORTAL_NOT_LOGGED_IN_MESSAGE = 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.'
/** Đang ở màn Gia hạn trước đăng nhập hoặc cửa sổ "Gia hạn gói": dùng trang đang mở, không mở thêm form. */
export const UPGRADE_PORTAL_BUSY_MESSAGE = 'Trang gia hạn đang mở. Anh/chị dùng trang đang mở giúp em nhé.'
export const UPGRADE_PORTAL_EXTERNAL_ERROR = 'Không mở được trình duyệt. Vui lòng thử lại.'
export const UPGRADE_PORTAL_LOAD_ERROR = 'Không tải được trang Nâng cấp và mua gói. Vui lòng kiểm tra internet và thử lại.'
export const UPGRADE_PORTAL_RELOAD_ERROR = 'Không thể tải lại trang Nâng cấp và mua gói. Vui lòng thử lại.'
export const UPGRADE_PORTAL_LOADING_TEXT = 'Đang mở trang Nâng cấp và mua gói…'
export const UPGRADE_PORTAL_LOGIN_NOTE = 'Vui lòng đăng nhập trang này bằng tài khoản akaAgent của bạn để tiếp tục.'
export const UPGRADE_PORTAL_DONE_TEXT = 'Đã kích hoạt gói.'

export type UpgradePortalDesktopErrorCode = 'invalid_request' | 'not_logged_in' | 'busy' | 'unavailable'

export type UpgradePortalOpenResult =
  | { ok: true; partition: string; url: string }
  | { ok: false; code: UpgradePortalDesktopErrorCode; message: string }

export type UpgradePortalExternalResult =
  | { ok: true; signed: boolean }
  | { ok: false; code: UpgradePortalDesktopErrorCode; message: string }

export interface UpgradePortalCloseResult {
  /** true: sau khi đóng form, gói của tài khoản đã khác lúc mở (gói mới, hạn mới hoặc số tài khoản mới). */
  updated: boolean
}

export const upgradePortalError = (code: UpgradePortalDesktopErrorCode): { ok: false; code: UpgradePortalDesktopErrorCode; message: string } => ({
  ok: false,
  code,
  message: code === 'not_logged_in'
    ? UPGRADE_PORTAL_NOT_LOGGED_IN_MESSAGE
    : code === 'busy' ? UPGRADE_PORTAL_BUSY_MESSAGE : UPGRADE_PORTAL_OPEN_ERROR
})

/**
 * Link mở cổng cho form của Desktop. URL (có thể có vé) chỉ dùng trong tiến trình chính, không gửi xuống giao diện, không log.
 *  - `ownedEntitlementIds` = null: chưa đăng nhập. Không xin vé, không gọi DB; khách đăng nhập ngay trên trang CRM trong form.
 *  - Đang đăng nhập: xin một vé dùng một lần (`aka_agent_renewal_link_ticket`, V521). Sản phẩm trên yêu cầu chỉ được dùng khi
 *    thuộc gói của chính phiên đang đăng nhập; lạ thì mở chế độ mua hàng. Không có vé (DB chưa có hàm, quá hạn mức, lỗi gọi)
 *    thì dùng link thường, khách đăng nhập cổng bằng mật khẩu.
 */
export async function buildUpgradePortalDesktopLink(input: {
  from: UpgradePortalEntry
  entitlementId?: number | null
  ownedEntitlementIds: readonly number[] | null
  issueTicket: (organizationProductId: number | null) => Promise<unknown>
}): Promise<UpgradePortalLink> {
  if (input.ownedEntitlementIds === null) return upgradePortalLink({ channel: 'desktop', from: input.from })
  const requested = input.entitlementId ?? null
  const entitlementId = requested !== null && input.ownedEntitlementIds.includes(requested) ? requested : null
  let ticket: string | null = null
  try {
    ticket = parseRenewalLinkTicket(await input.issueTicket(entitlementId))
  } catch { /* Xin vé lỗi: dùng link thường, không log chi tiết. */ }
  return upgradePortalLink({ channel: 'desktop', from: input.from, entitlementId, ticket })
}

/** Dấu vân tay danh sách gói để biết sau khi đóng form gói có đổi không (gói, hạn, số tài khoản, trạng thái). */
export function upgradePortalProductsFingerprint(products: readonly {
  organizationProductId: number | null
  productId: number | null
  packageName: string
  packageType: string | null
  expirationDate: string | null
  maxAccounts: number | null
  isActive: boolean
}[] | null | undefined): string {
  return JSON.stringify((products ?? []).map(product => JSON.stringify([
    product.organizationProductId, product.productId, product.packageName, product.packageType,
    product.expirationDate, product.maxAccounts, product.isActive
  ])).sort())
}

const FEATURE_UNAVAILABLE_PHRASE = 'chưa được kích hoạt hoặc đã hết hạn'

/**
 * Câu báo "Tính năng … chưa được kích hoạt hoặc đã hết hạn." (thêm tài khoản, tạo chiến dịch, quét data, nhóm tài khoản; cả câu
 * do tiến trình chính trả về). Hộp thông báo lỗi thêm nút "Mua hoặc dùng thử" cho đúng các câu này.
 */
export function isUpgradePortalFeatureMessage(message: unknown): boolean {
  return typeof message === 'string' && message.includes(FEATURE_UNAVAILABLE_PHRASE)
}
