/**
 * Chương trình đối tác giới thiệu ("Giới thiệu nhận hoa hồng"): mỗi khách có một mã giới thiệu và một trang giới thiệu
 * riêng trên cổng CRM (`https://crm.akabiz.net/gt/<MÃ>`); người vào trang đó rồi dùng thử / mua thì khách nhận hoa hồng.
 *
 * File này là hợp đồng dữ liệu giữa DB (akaAgent V546: `aka_agent_control_aff_partner` cho API Web,
 * `aka_agent_aff_partner` cho Desktop) và giao diện Web / iOS / Desktop: chỉ kiểu dữ liệu và hàm thuần, không gọi mạng,
 * không import file khác. Desktop chép NGUYÊN VĂN sang akaAgent `src/shared/affPartner.ts` (sửa ở WebApp trước rồi chép lại).
 *
 * Trang quản lý hoa hồng đầy đủ (người đã giới thiệu, lịch sử hoa hồng, tài khoản nhận tiền) nằm ở cổng khách của CRM:
 * `/gia-han/doi-tac`. App chỉ hiện mã, link, số liệu tóm tắt, mức hoa hồng theo sản phẩm và nút mở trang đó.
 * Quy tắc và bảng dữ liệu: SqlServerDashboard `docs/affiliate-doi-tac-gioi-thieu-phuong-an-2026-11-15.md`.
 */

export const AFF_PARTNER_PORTAL_ORIGIN = 'https://crm.akabiz.net'
/** Trang đăng nhập của cổng; nhận `?t=<vé>` và `?next=<trang trong cổng>`. */
export const AFF_PARTNER_PORTAL_LOGIN_PATH = '/gia-han'
/** Trang quản lý hoa hồng của đối tác trên cổng. Phải khớp `RENEWAL_PORTAL_PATHS.partner` của SqlServerDashboard. */
export const AFF_PARTNER_PORTAL_PATH = '/gia-han/doi-tac'
/** Khóa `auto_system_settings` chứa công tắc chương trình: JSON `{"audience":"off" | "admin_akabiz" | "all", ...}`. */
export const AFF_PARTNER_SETTING_KEY = 'affiliate.program'
/** Mã giới thiệu: 7 ký tự chữ in hoa + số, bỏ I, L, O, 0, 1. */
export const AFF_PARTNER_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{7}$/
/** Vé mở cổng dùng một lần (akaAgent V521): 64 ký tự hex. */
export const AFF_PARTNER_TICKET_PATTERN = /^[0-9a-f]{64}$/

// ------------------------------------------------------------------ Công tắc chương trình

export type AffPartnerAudience = 'off' | 'admin_akabiz' | 'all'

/**
 * Đọc `audience` từ giá trị dòng cài đặt `affiliate.program` (chuỗi JSON hoặc object đã parse).
 * Thiếu dòng, JSON sai, giá trị lạ = tắt.
 */
export function parseAffPartnerAudience(raw: unknown): AffPartnerAudience {
  let value: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return 'off'
    try {
      value = JSON.parse(raw)
    } catch {
      return 'off'
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'off'
  const audience = (value as Record<string, unknown>).audience
  return audience === 'all' || audience === 'admin_akabiz' ? audience : 'off'
}

/**
 * Có hiện lối vào "Giới thiệu nhận hoa hồng" cho tài khoản này không (chỉ để ẩn / hiện mục menu mà không gọi thêm DB).
 * Quyền thật do DB quyết định khi mở trang: `all` vẫn có thể trả `internal_staff` cho nhân viên nội bộ akaBiz.
 */
export function affPartnerVisibleFor(audience: AffPartnerAudience, isAdminAkabiz: boolean): boolean {
  if (audience === 'all') return true
  return audience === 'admin_akabiz' && isAdminAkabiz
}

// ------------------------------------------------------------------ Dữ liệu của một đối tác

export type AffPartnerStatus = 'active' | 'paused' | 'banned'

export const AFF_PARTNER_DISABLED_REASONS = [
  /** Chương trình đang tắt. */
  'off',
  /** Tài khoản bị khóa / đã xóa, hoặc không thuộc tổ chức của phiên. */
  'staff_inactive',
  /** Chương trình đang thử nghiệm, chưa mở cho tài khoản này. */
  'not_in_audience',
  /** Nhân viên nội bộ akaBiz không tham gia. */
  'internal_staff',
  /** Desktop: không xác định được nhân viên từ phiên. */
  'no_session',
  /** DB chưa có hàm V546 (PGRST202). */
  'not_installed',
  /** Lỗi đọc hoặc dữ liệu trả về sai dạng. */
  'unavailable'
] as const
export type AffPartnerDisabledReason = typeof AFF_PARTNER_DISABLED_REASONS[number]

export interface AffPartnerInfo {
  code: string
  status: AffPartnerStatus
  /** Tên hiện trên trang giới thiệu. */
  displayName: string | null
  /** Link trang giới thiệu riêng để chia sẻ, vd `https://crm.akabiz.net/gt/AK7M2QX`. */
  pageUrl: string
  /** Đã đồng ý điều khoản chương trình (làm ở trang quản lý hoa hồng). */
  termsAccepted: boolean
  /** Đã có tài khoản ngân hàng nhận hoa hồng. */
  hasPayoutInfo: boolean
  firstReferralAt: string | null
}

export interface AffPartnerStats {
  /** Lượt xem trang giới thiệu. */
  visits: number
  /** Số tài khoản dùng thử được ghi nhận. */
  trials: number
  /** Số khách đã mua. */
  purchased: number
  /** Hoa hồng đang giữ, chưa tới ngày được rút (VND). */
  commissionPending: number
  /** Hoa hồng được rút, chưa chi (VND). */
  commissionApproved: number
  /** Hoa hồng đã nhận (VND). */
  commissionPaid: number
}

export interface AffPartnerProgram {
  /** Số ngày kể từ lượt xem trang mà lượt đăng ký dùng thử còn được tính. */
  visitWindowDays: number
  /** Số ngày kể từ ngày dùng thử mà đơn mua còn được tính hoa hồng. */
  purchaseWindowDays: number
  /** Số ngày giữ hoa hồng sau khi khách thanh toán. */
  holdDays: number
  /** Ngưỡng chi tối thiểu (VND). */
  minPayout: number
  /** Số thưởng dùng thử tối đa mỗi tháng. */
  trialRewardMonthlyCap: number
}

export interface AffPartnerRateTerms {
  /** Tỉ lệ hoa hồng trên tiền khách thanh toán, 0..1. */
  purchaseRate: number
  /** Thưởng cho một tài khoản dùng thử hợp lệ (VND). */
  trialReward: number
}

export interface AffPartnerProductRate extends AffPartnerRateTerms {
  productId: number
  productName: string
}

export interface AffPartnerDisabled {
  enabled: false
  reason: AffPartnerDisabledReason
}

/** Chương trình mở cho tài khoản nhưng chưa cấp mã (chỉ gặp khi gọi ở chế độ chỉ đọc). */
export interface AffPartnerPending {
  enabled: true
  partner: null
}

export interface AffPartnerActive {
  enabled: true
  partner: AffPartnerInfo
  stats: AffPartnerStats
  program: AffPartnerProgram
  /** Mức áp dụng cho sản phẩm không có mức riêng. */
  defaultRate: AffPartnerRateTerms
  /** Mức theo từng sản phẩm đang bán. */
  rates: AffPartnerProductRate[]
  /** Trang quản lý hoa hồng trên cổng (chưa kèm vé). */
  portalUrl: string
}

export type AffPartnerSummary = AffPartnerDisabled | AffPartnerPending | AffPartnerActive

export function isAffPartnerActive(summary: AffPartnerSummary | null | undefined): summary is AffPartnerActive {
  return Boolean(summary && summary.enabled && summary.partner)
}

const disabled = (reason: AffPartnerDisabledReason): AffPartnerDisabled => ({ enabled: false, reason })

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function count(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

function rate(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function httpsUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function terms(value: unknown): AffPartnerRateTerms {
  const row = record(value)
  return { purchaseRate: rate(row?.purchaseRate), trialReward: count(row?.trialReward) }
}

/**
 * Chuẩn hóa kết quả jsonb của hàm DB V546. Dữ liệu sai dạng → `{ enabled: false, reason: 'unavailable' }`, không ném lỗi:
 * mục "Giới thiệu nhận hoa hồng" chỉ là tiện ích, không được làm hỏng màn hình chứa nó.
 */
export function parseAffPartnerSummary(raw: unknown): AffPartnerSummary {
  const value = record(raw)
  if (!value) return disabled('unavailable')
  if (value.enabled !== true) {
    const reason = value.reason
    return disabled((AFF_PARTNER_DISABLED_REASONS as readonly unknown[]).includes(reason) ? reason as AffPartnerDisabledReason : 'off')
  }
  if (value.partner == null) return { enabled: true, partner: null }

  const partner = record(value.partner)
  const code = text(partner?.code)
  const pageUrl = httpsUrl(partner?.pageUrl)
  if (!partner || !code || !AFF_PARTNER_CODE_PATTERN.test(code) || !pageUrl || !pageUrl.pathname.endsWith(`/${code}`)) {
    return disabled('unavailable')
  }
  const status: AffPartnerStatus = partner.status === 'paused' || partner.status === 'banned' ? partner.status : 'active'
  const stats = record(value.stats)
  const program = record(value.program)
  const portal = httpsUrl(value.portalUrl)
  const rates: AffPartnerProductRate[] = []
  for (const item of Array.isArray(value.rates) ? value.rates : []) {
    const row = record(item)
    const productId = count(row?.productId)
    const productName = text(row?.productName)
    if (productId > 0 && productName) rates.push({ productId, productName, ...terms(row) })
  }
  return {
    enabled: true,
    partner: {
      code,
      status,
      displayName: text(partner.displayName),
      pageUrl: pageUrl.toString(),
      termsAccepted: text(partner.termsAcceptedAt) != null,
      hasPayoutInfo: partner.hasPayoutInfo === true,
      firstReferralAt: text(partner.firstReferralAt)
    },
    stats: {
      visits: count(stats?.visits),
      trials: count(stats?.trials),
      purchased: count(stats?.purchased),
      commissionPending: count(stats?.commissionPending),
      commissionApproved: count(stats?.commissionApproved),
      commissionPaid: count(stats?.commissionPaid)
    },
    program: {
      visitWindowDays: count(program?.visitWindowDays) || 90,
      purchaseWindowDays: count(program?.purchaseWindowDays) || 90,
      holdDays: count(program?.holdDays),
      minPayout: count(program?.minPayout),
      trialRewardMonthlyCap: count(program?.trialRewardMonthlyCap)
    },
    defaultRate: terms(value.defaultRate),
    rates,
    portalUrl: portal && portal.pathname === AFF_PARTNER_PORTAL_PATH
      ? `${portal.origin}${AFF_PARTNER_PORTAL_PATH}`
      : `${AFF_PARTNER_PORTAL_ORIGIN}${AFF_PARTNER_PORTAL_PATH}`
  }
}

// ------------------------------------------------------------------ Link mở trang quản lý hoa hồng

export interface AffPartnerPortalLink {
  url: string
  /** true: link có vé, khách vào thẳng trang; false: khách đăng nhập cổng bằng mật khẩu rồi cổng tự đưa về trang. */
  signed: boolean
}

/**
 * Link mở trang quản lý hoa hồng: `<cổng>/gia-han?t=<vé>&next=/gia-han/doi-tac`. Không có vé (DB chưa cấp được) thì bỏ `t`:
 * trang đăng nhập của cổng tự đưa khách về `next` sau khi đăng nhập. `portalUrl` lấy từ `AffPartnerActive.portalUrl`.
 */
export function affPartnerPortalLink(portalUrl: string | null | undefined, ticket?: unknown): AffPartnerPortalLink {
  const portal = httpsUrl(portalUrl)
  const url = new URL(AFF_PARTNER_PORTAL_LOGIN_PATH, portal ? portal.origin : AFF_PARTNER_PORTAL_ORIGIN)
  const signed = typeof ticket === 'string' && AFF_PARTNER_TICKET_PATTERN.test(ticket)
  if (signed) url.searchParams.set('t', ticket as string)
  url.searchParams.set('next', AFF_PARTNER_PORTAL_PATH)
  return { url: url.toString(), signed }
}

// ------------------------------------------------------------------ Câu chữ dùng chung

const DISABLED_MESSAGES: Record<AffPartnerDisabledReason, string> = {
  off: 'Chương trình giới thiệu chưa mở. akaBiz sẽ thông báo khi chương trình bắt đầu.',
  staff_inactive: 'Tài khoản này đang bị khóa nên chưa tham gia được chương trình giới thiệu.',
  not_in_audience: 'Chương trình giới thiệu đang thử nghiệm, chưa mở cho tài khoản này.',
  internal_staff: 'Tài khoản nội bộ akaBiz không tham gia chương trình giới thiệu.',
  no_session: 'Chưa xác định được tài khoản. Anh/chị đăng nhập lại rồi thử lại giúp em nhé.',
  not_installed: 'Chương trình giới thiệu chưa mở. akaBiz sẽ thông báo khi chương trình bắt đầu.',
  unavailable: 'Chưa tải được thông tin chương trình giới thiệu. Anh/chị thử lại sau ít phút.'
}

export function affPartnerDisabledMessage(reason: AffPartnerDisabledReason): string {
  return DISABLED_MESSAGES[reason] ?? DISABLED_MESSAGES.unavailable
}

/** 0.1 → "10%", 0.125 → "12,5%". */
export function formatAffPartnerRate(value: number): string {
  const percent = Math.round(rate(value) * 1000) / 10
  return `${String(percent).replace('.', ',')}%`
}

/** 20000 → "20.000 đ". */
export function formatAffPartnerMoney(value: number): string {
  return `${String(count(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} đ`
}

/** Câu mời kèm link để khách dán lên Zalo / Facebook. */
export function affPartnerShareText(partner: Pick<AffPartnerInfo, 'pageUrl' | 'code'>): string {
  return `Mời bạn dùng thử akaBiz miễn phí: ${partner.pageUrl} (mã giới thiệu ${partner.code})`
}

// ------------------------------------------------------------------ Hợp đồng API / IPC

/** `GET /aff/partner` (Web / iOS) và IPC `aff-partner:summary` (Desktop). */
export interface AffPartnerResponse {
  summary: AffPartnerSummary
}

/**
 * `POST /aff/partner/link` (Web / iOS). Desktop không trả link về giao diện: IPC `aff-partner:open-portal` để tiến trình
 * chính tự mở link bằng trình duyệt ngoài và chỉ trả `{ signed }`.
 */
export type AffPartnerLinkResponse = AffPartnerPortalLink
