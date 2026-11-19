/**
 * "Nâng cấp và mua gói" (docs/UPGRADE_AND_BUY_PLAN.md): khách đang dùng mở trang Nâng cấp của cổng CRM
 * (`https://crm.akabiz.net/gia-han/nang-cap`) để gia hạn, đổi gói, thêm tài khoản, mua thêm hoặc dùng thử sản phẩm khác.
 * Web, Desktop và form nhúng của Desktop đều dùng MỘT trang đó; không nơi nào có trang mua riêng.
 *
 * File này là hợp đồng dùng chung: chỉ hằng số, kiểu dữ liệu và hàm thuần, không gọi mạng, không import file khác.
 * Desktop chép NGUYÊN VĂN sang akaAgent `src/shared/upgradePortal.ts` (sửa ở WebApp trước rồi chép lại).
 *
 * Link mở cổng: `<cổng>/gia-han?t=<vé>&next=<trang>&src=<nguồn>`. Vé dùng một lần do DB cấp (akaAgent V521); không có vé
 * thì bỏ `t`, khách đăng nhập cổng bằng mật khẩu rồi cổng đưa về `next`. Đường dẫn phải khớp `RENEWAL_PORTAL_PATHS` của
 * SqlServerDashboard (`shared/renewal-portal.ts`).
 */

/** Tên mục menu (Web, Desktop) và tiêu đề trang mua của cổng. */
export const UPGRADE_PORTAL_MENU_LABEL = 'Nâng cấp và mua gói'
/** Dòng phụ dưới tên mục menu. */
export const UPGRADE_PORTAL_MENU_CAPTION = 'Gia hạn, thêm tài khoản, dùng thử'
/** Nút trên từng gói ở "Thông tin tài khoản". */
export const UPGRADE_PORTAL_PRODUCT_BUTTON_LABEL = 'Gia hạn / Nâng cấp'
/** Nút cuối danh sách gói ở "Thông tin tài khoản". */
export const UPGRADE_PORTAL_MORE_BUTTON_LABEL = 'Mua thêm hoặc dùng thử sản phẩm khác'
export const UPGRADE_PORTAL_MORE_BUTTON_CAPTION = 'Dùng thử miễn phí trước khi mua'
/** Nút kèm thông báo "Tính năng … chưa được kích hoạt hoặc đã hết hạn". */
export const UPGRADE_PORTAL_FEATURE_BUTTON_LABEL = 'Mua hoặc dùng thử'
export const UPGRADE_PORTAL_OPEN_ERROR = 'Chưa mở được trang Nâng cấp và mua gói. Anh/chị thử lại giúp em nhé.'
/** Báo khi quay lại app mà gói đã đổi (gói mới, hạn mới hoặc số tài khoản mới). */
export const UPGRADE_PORTAL_UPDATED_TEXT = 'Gói đã được cập nhật.'

export const UPGRADE_PORTAL_ORIGIN = 'https://crm.akabiz.net'
/** Trang đăng nhập của cổng; nhận `?t=<vé>`, `?next=<trang trong cổng>` và `?src=<nguồn>`. */
export const UPGRADE_PORTAL_LOGIN_PATH = '/gia-han'
/** Trang Nâng cấp của cổng. Phải khớp `RENEWAL_PORTAL_PATHS.upgrade` của SqlServerDashboard. */
export const UPGRADE_PORTAL_SHOP_PATH = '/gia-han/nang-cap'
/** `?shop=1`: chế độ mua hàng của trang Nâng cấp (giỏ trống, mục "Mua thêm sản phẩm" mở sẵn). */
export const UPGRADE_PORTAL_SHOP_PARAM = 'shop'
/** `?product=<id dòng sản phẩm>`: trang Nâng cấp chọn sẵn đúng sản phẩm đó. */
export const UPGRADE_PORTAL_PRODUCT_PARAM = 'product'
/** Vé mở cổng dùng một lần (akaAgent V521): 64 ký tự hex. */
export const UPGRADE_PORTAL_TICKET_PATTERN = /^[0-9a-f]{64}$/

/**
 * Lối vào: `menu` = mục menu tài khoản; `account` = nút trong "Thông tin tài khoản"; `login` = link ở màn đăng nhập
 * (Desktop); `banner` = dải thông báo có link tới cổng (Desktop); `feature` = nút kèm thông báo tính năng chưa kích hoạt.
 */
export const UPGRADE_PORTAL_ENTRIES = ['menu', 'account', 'login', 'banner', 'feature'] as const
export type UpgradePortalEntry = typeof UPGRADE_PORTAL_ENTRIES[number]
export type UpgradePortalChannel = 'web' | 'desktop'

const ENTRY_SOURCE: Record<UpgradePortalEntry, string> = { menu: 'm1', account: 'm2', login: 'l1', banner: 'b1', feature: 'f1' }

/**
 * Mã nguồn gắn vào link (`src`) để CRM ghi lên đơn: `web.m1` (menu), `web.m2` (Thông tin tài khoản), `desktop.l1` (màn đăng
 * nhập), `desktop.b1` (dải thông báo), `desktop.f1` (thông báo tính năng). Chỉ để thống kê. Khớp mẫu
 * `^[a-z][a-z_]{1,15}\.[a-z][0-9]{1,3}$` của CRM.
 */
export function upgradePortalSource(channel: UpgradePortalChannel, entry: UpgradePortalEntry): string {
  return `${channel}.${ENTRY_SOURCE[entry] ?? ENTRY_SOURCE.menu}`
}

/** `POST /upgrade/link` (Web) và IPC `upgrade-portal:open` (Desktop). `entitlementId` = `org_organization_product.id`. */
export interface UpgradePortalLinkRequest {
  from: UpgradePortalEntry
  entitlementId?: number | null
}

export interface UpgradePortalLink {
  url: string
  /** true: link có vé, khách vào thẳng trang; false: khách đăng nhập cổng bằng mật khẩu rồi cổng tự đưa về trang. */
  signed: boolean
}

/**
 * `POST /upgrade/link`. Desktop không trả link về giao diện: tiến trình chính tự nạp link vào form nhúng; giao diện chỉ
 * nhận trạng thái của form (đang tải, có vé hay không) qua kênh trạng thái, không bao giờ cầm link hay vé.
 */
export type UpgradePortalLinkResponse = UpgradePortalLink

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isPositiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Đọc thân yêu cầu; sai cấu trúc → null (bên gọi trả 400). `entitlementId` sai dạng bị bỏ qua. */
export function parseUpgradePortalLinkRequest(value: unknown): UpgradePortalLinkRequest | null {
  if (!isRecord(value)) return null
  const from = value.from
  if (typeof from !== 'string' || !(UPGRADE_PORTAL_ENTRIES as readonly string[]).includes(from)) return null
  return { from: from as UpgradePortalEntry, entitlementId: isPositiveId(value.entitlementId) ? value.entitlementId : null }
}

function portalOrigin(origin: string | null | undefined): string {
  if (typeof origin !== 'string') return UPGRADE_PORTAL_ORIGIN
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' ? url.origin : UPGRADE_PORTAL_ORIGIN
  } catch {
    return UPGRADE_PORTAL_ORIGIN
  }
}

/** Trang trong cổng cần mở: chọn sẵn một sản phẩm, hoặc chế độ mua hàng với giỏ trống. */
export function upgradePortalNextPath(entitlementId?: number | null): string {
  return isPositiveId(entitlementId)
    ? `${UPGRADE_PORTAL_SHOP_PATH}?${UPGRADE_PORTAL_PRODUCT_PARAM}=${entitlementId}`
    : `${UPGRADE_PORTAL_SHOP_PATH}?${UPGRADE_PORTAL_SHOP_PARAM}=1`
}

/**
 * Link mở cổng.
 *  - Không trỏ sản phẩm (menu, nút mua thêm, màn đăng nhập, thông báo): `next` = trang Nâng cấp ở chế độ mua hàng.
 *  - Trỏ một sản phẩm và CÓ vé: vé đã mang sản phẩm đó nên không gửi `next`, cổng tự chọn trang (gói còn hạn → trang Nâng
 *    cấp chọn sẵn sản phẩm; đã hết hạn → trang có thẻ thanh toán nhanh).
 *  - Trỏ một sản phẩm mà KHÔNG có vé: `next` = trang Nâng cấp chọn sẵn sản phẩm đó.
 * `ticketCarriesProduct` = false khi vé được cấp không kèm sản phẩm (DB từ chối sản phẩm): khi đó vẫn gửi `next`.
 */
export function upgradePortalLink(input: {
  channel: UpgradePortalChannel
  from: UpgradePortalEntry
  entitlementId?: number | null
  ticket?: unknown
  ticketCarriesProduct?: boolean
  origin?: string | null
}): UpgradePortalLink {
  const url = new URL(UPGRADE_PORTAL_LOGIN_PATH, portalOrigin(input.origin))
  const signed = typeof input.ticket === 'string' && UPGRADE_PORTAL_TICKET_PATTERN.test(input.ticket)
  const focused = isPositiveId(input.entitlementId)
  if (signed) url.searchParams.set('t', input.ticket as string)
  if (!(signed && focused && input.ticketCarriesProduct !== false)) {
    url.searchParams.set('next', upgradePortalNextPath(focused ? input.entitlementId : null))
  }
  url.searchParams.set('src', upgradePortalSource(input.channel, input.from))
  return { url: url.toString(), signed }
}

/** Link có thuộc cổng gia hạn / nâng cấp không (`https://crm.akabiz.net/gia-han` hoặc trang con). */
export function isUpgradePortalUrl(value: unknown, origin?: string | null): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== portalOrigin(origin)) return false
    if (url.username || url.password) return false
    return url.pathname === UPGRADE_PORTAL_LOGIN_PATH || url.pathname.startsWith(`${UPGRADE_PORTAL_LOGIN_PATH}/`)
  } catch {
    return false
  }
}
