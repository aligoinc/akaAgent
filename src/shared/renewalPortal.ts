import { AUTH_FACEBOOK_CORE_PRODUCT_ID, AUTH_FACEBOOK_FANPAGE_PRODUCT_ID, AUTH_PRODUCT_IDS, getAuthProductById } from './authProductCatalog'
import type { AuthRenewalKind, AuthRenewalProduct, AuthRenewalRequired } from './types'

/**
 * Cổng gia hạn tự phục vụ của CRM (repo SqlServerDashboard, `shared/renewal-portal.ts`).
 * Hợp đồng tích hợp với Desktop: docs/RENEWAL_PORTAL_DESKTOP.md.
 */
export const RENEWAL_PORTAL_ORIGIN = 'https://crm.akabiz.net'
export const RENEWAL_PORTAL_PATHS = {
  login: '/gia-han',
  recover: '/gia-han/lay-lai-tai-khoan',
  trialExpired: '/gia-han/het-han-dung-thu',
  packageExpired: '/gia-han/het-han-goi',
  upgrade: '/gia-han/nang-cap',
  trialSignup: '/gia-han/dang-ky-dung-thu'
} as const

/** Link công khai mặc định khi auto_system_settings chưa cấu hình key tương ứng. */
export const DEFAULT_RECOVER_ACCOUNT_URL = `${RENEWAL_PORTAL_ORIGIN}${RENEWAL_PORTAL_PATHS.recover}`
export const DEFAULT_TRIAL_SIGNUP_URL = `${RENEWAL_PORTAL_ORIGIN}${RENEWAL_PORTAL_PATHS.trialSignup}`

/**
 * Tiêu đề trang Nâng cấp khi đơn đã kích hoạt xong. CRM giữ cùng hằng số
 * (`RENEWAL_ORDER_COMPLETED_TITLE`); đổi một bên phải đổi bên còn lại.
 */
export const RENEWAL_ORDER_COMPLETED_TITLE = 'Đã kích hoạt gói – akaBiz'

/** Phân vùng trình duyệt không lưu đĩa của màn Gia hạn; xoá dữ liệu khi đóng màn. */
export const RENEWAL_WEB_PARTITION = 'akaagent_renewal'
export const RENEWAL_WEB_INITIAL_URL = 'about:blank'

/** Bản dùng thử theo cùng quy tắc với CRM `isTrialPackageType`: rỗng, demo hoặc free. */
const TRIAL_PACKAGE_TYPES = new Set(['', 'demo', 'free'])

export function isRenewalPortalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.origin !== RENEWAL_PORTAL_ORIGIN || url.username || url.password) return false
    const path = url.pathname.replace(/\/+$/, '') || '/'
    return path === RENEWAL_PORTAL_PATHS.login || path.startsWith(`${RENEWAL_PORTAL_PATHS.login}/`)
  } catch {
    return false
  }
}

export function renewalLandingPath(kind: AuthRenewalKind): string {
  if (kind === 'trial_expired') return RENEWAL_PORTAL_PATHS.trialExpired
  if (kind === 'package_expired') return RENEWAL_PORTAL_PATHS.packageExpired
  return RENEWAL_PORTAL_PATHS.upgrade
}

/** Trang đăng nhập cổng (khách nhập lại mật khẩu) khi không lấy được link ký số. */
export function renewalManualLoginUrl(kind: AuthRenewalKind): string {
  const next = encodeURIComponent(renewalLandingPath(kind))
  return `${RENEWAL_PORTAL_ORIGIN}${RENEWAL_PORTAL_PATHS.login}?next=${next}`
}

export interface RenewalProductRow {
  id?: number | string | null
  product_id?: number | string | null
  package_type?: string | null
  expiration_date?: string | null
}

/** Kết quả phân loại đầy đủ; chỉ main giữ `focusOrganizationProductId` để ký link. */
export interface RenewalRequirement extends AuthRenewalRequired {
  focusOrganizationProductId: number | null
}

interface ClassifiedRow {
  organizationProductId: number | null
  productId: number
  isTrial: boolean
  expirationMs: number
  expirationDate: string | null
}

function isTrialPackageType(packageType: string | null | undefined): boolean {
  return TRIAL_PACKAGE_TYPES.has(String(packageType ?? '').trim().toLowerCase())
}

/** Nhãn catalog cũng là nhóm quyền: Facebook 3/10 và Zalo 16/18 dùng chung một nhãn. */
function productLabel(productId: number): string {
  return getAuthProductById(productId)?.label || 'akaAgent'
}

function expirationTime(row: ClassifiedRow): number {
  return Number.isFinite(row.expirationMs) ? row.expirationMs : Number.NEGATIVE_INFINITY
}

function toPublicProduct(row: ClassifiedRow): AuthRenewalProduct {
  return {
    productId: row.productId,
    displayName: productLabel(row.productId),
    isTrial: row.isTrial,
    expirationDate: row.expirationDate
  }
}

/**
 * Chọn trang gia hạn khi tổ chức không còn sản phẩm akaAgent nào còn hạn.
 * Quy tắc như CRM `resolvePortalLanding` nhưng chỉ xét product akaAgent
 * (3/10/13/16/17/18): còn gói trả phí đã hết hạn → Hết hạn gói; chỉ còn bản dùng
 * thử đã hết hạn → Hết hạn dùng thử; không có sản phẩm akaAgent → Nâng cấp.
 * Dòng còn hạn (`expiration_date` ≥ đầu ngày VN `todayStartMs`, cùng quy tắc đăng
 * nhập) loại sản phẩm đó khỏi danh sách cần gia hạn.
 */
export function classifyRenewalRequirement(
  rows: readonly RenewalProductRow[],
  todayStartMs: number,
  username: string
): RenewalRequirement {
  const akaAgentRows: ClassifiedRow[] = []
  for (const row of rows) {
    const productId = Number(row.product_id)
    if (!AUTH_PRODUCT_IDS.includes(productId)) continue
    const organizationProductId = Number(row.id)
    const expirationMs = row.expiration_date ? Date.parse(row.expiration_date) : Number.NaN
    akaAgentRows.push({
      organizationProductId: Number.isSafeInteger(organizationProductId) && organizationProductId > 0 ? organizationProductId : null,
      productId,
      isTrial: isTrialPackageType(row.package_type),
      expirationMs,
      expirationDate: row.expiration_date || null
    })
  }

  const isActive = (row: ClassifiedRow) => Number.isFinite(row.expirationMs) && row.expirationMs >= todayStartMs
  const liveGroups = new Set(akaAgentRows.filter(isActive).map(row => productLabel(row.productId)))
  const expired = akaAgentRows
    .filter(row => !isActive(row) && !liveGroups.has(productLabel(row.productId)))
    .sort((a, b) => expirationTime(b) === expirationTime(a) ? 0 : expirationTime(b) > expirationTime(a) ? 1 : -1)
  const expiredPaid = expired.filter(row => !row.isTrial)
  const expiredTrials = expired.filter(row => row.isTrial)
  const candidates = expiredPaid.length > 0 ? expiredPaid : expiredTrials
  const kind: AuthRenewalKind = expiredPaid.length > 0
    ? 'package_expired'
    : expiredTrials.length > 0 ? 'trial_expired' : 'no_package'

  let focus = candidates[0] ?? null
  // CRM chưa bán gói cho product 10; cùng nhóm Facebook thì mở trang của product 3.
  if (focus?.productId === AUTH_FACEBOOK_FANPAGE_PRODUCT_ID) {
    focus = candidates.find(row => row.productId === AUTH_FACEBOOK_CORE_PRODUCT_ID) ?? focus
  }

  // Hiển thị mỗi nhóm một dòng (mới hết hạn nhất), sản phẩm trọng tâm đứng đầu.
  const seenGroups = new Set<string>()
  const products: AuthRenewalProduct[] = []
  for (const row of [...(focus ? [focus] : []), ...expired]) {
    const group = productLabel(row.productId)
    if (seenGroups.has(group)) continue
    seenGroups.add(group)
    products.push(toPublicProduct(row))
  }

  return {
    kind,
    username,
    focusProduct: focus ? toPublicProduct(focus) : null,
    products,
    focusOrganizationProductId: focus?.organizationProductId ?? null
  }
}

export function toPublicRenewal(requirement: RenewalRequirement): AuthRenewalRequired {
  return {
    kind: requirement.kind,
    username: requirement.username,
    focusProduct: requirement.focusProduct,
    products: requirement.products
  }
}
