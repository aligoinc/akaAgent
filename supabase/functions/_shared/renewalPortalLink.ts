/**
 * Ký link đăng nhập sẵn vào cổng gia hạn CRM: `<origin>/gia-han?t=<JWT HS256>`.
 * Hợp đồng CRM: SqlServerDashboard `server/services/renewal-portal-session.ts`
 * (`verifyRenewalLinkToken`) và `docs/trang-gia-han-khach-hang.md`; tích hợp Desktop:
 * akaAgent `docs/RENEWAL_PORTAL_DESKTOP.md`.
 *
 * Dùng trong Edge `aka-agent-desktop-session` (action `renewal_link`) sau khi đã xác
 * thực tài khoản; không bao giờ đưa khóa ký vào Desktop. Chỉ dùng WebCrypto nên chạy
 * được trên Deno và Node ≥ 20 (script kiểm chéo `scripts/renewal-portal/`).
 */

export const RENEWAL_LINK_AUDIENCE = 'akabiz-renewal-link'
export const RENEWAL_LINK_SECRET_MIN_LENGTH = 32
/** CRM khuyến nghị 10–30 phút; mỗi lần mở màn Gia hạn ký link mới. */
export const RENEWAL_LINK_DEFAULT_TTL_SECONDS = 10 * 60
export const RENEWAL_LINK_MAX_TTL_SECONDS = 24 * 60 * 60
export const RENEWAL_PORTAL_DEFAULT_ORIGIN = 'https://crm.akabiz.net'
/** Product akaAgent: Facebook 3/10, Email 13, Zalo 16/18, SMS 17. */
export const AKA_AGENT_RENEWAL_PRODUCT_IDS: readonly number[] = [3, 10, 13, 16, 17, 18]

/** Chưa cấu hình `RENEWAL_PORTAL_LINK_SECRET` (≥ 32 ký tự): Edge trả 503, Desktop dùng trang đăng nhập cổng. */
export class RenewalLinkUnavailable extends Error {
  constructor() {
    super('renewal_link_unavailable')
    this.name = 'RenewalLinkUnavailable'
  }
}

export interface RenewalLinkInput {
  /** `org_staff.id` lấy từ kết quả xác thực ở server, không nhận từ client. */
  staffId: number
  /** `org_organization_product.id` đã kiểm thuộc tổ chức của staff; null để CRM tự chọn trang. */
  organizationProductId?: number | null
  secret: string | null | undefined
  origin?: string | null
  nowSeconds?: number
  ttlSeconds?: number
}

export interface RenewalLinkResult {
  url: string
  expiresAt: string
}

const encoder = new TextEncoder()

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)))
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function portalOrigin(value: string | null | undefined): string {
  if (!value) return RENEWAL_PORTAL_DEFAULT_ORIGIN
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password && (url.pathname === '/' || url.pathname === '')) return url.origin
  } catch { /* dùng origin mặc định */ }
  return RENEWAL_PORTAL_DEFAULT_ORIGIN
}

/**
 * Chỉ giữ `opid` nếu là dòng sản phẩm akaAgent của chính tổ chức (danh sách `products`
 * do `aka_agent_desktop_session_admin('check')` trả). Sai kiểu → null, không lỗi.
 */
export function pickRenewalOrganizationProductId(products: unknown, requested: unknown): number | null {
  if (!isPositiveSafeInteger(requested) || !Array.isArray(products)) return null
  return products.some(row => {
    const item = row as { id?: unknown; product_id?: unknown } | null
    return Number(item?.id) === requested && AKA_AGENT_RENEWAL_PRODUCT_IDS.includes(Number(item?.product_id))
  }) ? requested : null
}

export async function createRenewalPortalLink(input: RenewalLinkInput): Promise<RenewalLinkResult> {
  // CRM dùng nguyên chuỗi đã trim làm khóa HMAC (byte UTF-8), không giải mã base64.
  const secret = (input.secret ?? '').trim()
  if (secret.length < RENEWAL_LINK_SECRET_MIN_LENGTH) throw new RenewalLinkUnavailable()
  if (!isPositiveSafeInteger(input.staffId)) throw new Error('renewal_link_invalid_staff')
  const now = Math.floor(input.nowSeconds ?? Date.now() / 1000)
  const ttl = Math.min(Math.max(Math.floor(input.ttlSeconds ?? RENEWAL_LINK_DEFAULT_TTL_SECONDS), 60), RENEWAL_LINK_MAX_TTL_SECONDS)
  const payload: Record<string, unknown> = { aud: RENEWAL_LINK_AUDIENCE, sub: String(input.staffId), iat: now, exp: now + ttl }
  if (isPositiveSafeInteger(input.organizationProductId)) payload.opid = input.organizationProductId
  const signingInput = `${base64UrlJson({ alg: 'HS256', typ: 'JWT' })}.${base64UrlJson(payload)}`
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)))
  return {
    url: `${portalOrigin(input.origin)}/gia-han?t=${signingInput}.${base64Url(signature)}`,
    expiresAt: new Date((now + ttl) * 1000).toISOString()
  }
}
