/**
 * Phần riêng Desktop của "nhắc gia hạn trong phần mềm" (docs/RENEWAL_REMINDER_DESKTOP.md). Quy tắc chung nằm ở
 * `renewalReminder.ts` (chép nguyên văn từ WebApp, không sửa ở đây).
 *
 * Quyền riêng tư: các ngày có đăng nhập chỉ nằm trong tiến trình chính. Không kiểu nào gửi xuống renderer được chứa chúng.
 */
import {
  RENEWAL_REMINDER_STATE_OFF,
  isRenewalLegacyNotice,
  isRenewalTrialPackageType,
  parseRenewalLinkTicket,
  renewalProductGroup,
  renewalReminderPlainUrl,
  renewalReminderSource,
  renewalReminderTicketUrl,
  toPublicRenewalReminder,
  vietnamDayOf,
  type RenewalReminder,
  type RenewalReminderOfferRow,
  type RenewalReminderProduct,
  type RenewalReminderState
} from './renewalReminder'
import type { AuthAccountProduct } from './types'

export const RENEWAL_REMINDER_IPC = {
  /** invoke: trạng thái hiện tại (`RenewalReminderState`). */
  state: 'renewal-reminder:state',
  /** main → renderer: trạng thái đổi. */
  changed: 'renewal-reminder:changed',
  /** invoke: khách quay lại sau khi mở trình duyệt ngoài; main đọc lại gói (tối đa 1 lượt/20 giây). */
  refresh: 'renewal-reminder:refresh',
  /** invoke `{ reminderKey }`: chuẩn bị cửa sổ "Gia hạn gói" (webview cổng CRM). */
  open: 'renewal-reminder:open',
  /** invoke: tải lại trang trong cửa sổ (tạo link mới). */
  webReload: 'renewal-reminder:web-reload',
  /** main → renderer: trạng thái webview của cửa sổ (`RenewalWebState`). */
  webState: 'renewal-reminder:web-state',
  /** invoke: đóng cửa sổ, xoá dữ liệu phân vùng, đọc lại gói. */
  close: 'renewal-reminder:close',
  /** invoke `{ reminderKey }`: mở cổng bằng trình duyệt ngoài. */
  openExternal: 'renewal-reminder:open-external'
} as const

export type RenewalReminderOpenResult =
  | { ok: true; partition: string; url: string }
  | { ok: false; code: 'no_reminder' | 'not_logged_in' | 'unavailable'; message: string }

export type RenewalReminderExternalResult =
  | { ok: true; signed: boolean }
  | { ok: false; code: 'no_reminder' | 'not_logged_in' | 'unavailable'; message: string }

export const RENEWAL_REMINDER_NO_REMINDER_MESSAGE = 'Gói của bạn hiện không cần gia hạn.'
export const RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE = 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.'

// ------------------------------------------------------------------ Gói của phiên đăng nhập

function reminderDisplayName(product: AuthAccountProduct): string {
  const label = String(product.displayName || product.productName || '').trim()
  if (!label) return 'akaAgent'
  return /^aka/i.test(label) ? label : `akaAgent ${label}`
}

/**
 * `AuthUser.accountProducts` (đã gộp Facebook 3/10 và Zalo 16/18 theo dòng hết hạn xa nhất) → đầu vào của quy tắc.
 * Chỉ lấy gói còn hạn; gói hết hạn đi theo màn Gia hạn sau đăng nhập như cũ.
 */
export function toRenewalReminderProducts(products: readonly AuthAccountProduct[] | null | undefined): RenewalReminderProduct[] {
  const result: RenewalReminderProduct[] = []
  for (const product of products ?? []) {
    if (!product || product.isActive !== true || !product.expirationDate) continue
    const durationDays = typeof product.durationDays === 'number' && Number.isInteger(product.durationDays) && product.durationDays > 0
      ? product.durationDays
      : null
    const packageName = String(product.packageName || '').trim()
    result.push({
      organizationProductId: typeof product.organizationProductId === 'number' && Number.isSafeInteger(product.organizationProductId) && product.organizationProductId > 0
        ? product.organizationProductId
        : null,
      group: renewalProductGroup(product.productId),
      displayName: reminderDisplayName(product),
      packageName: packageName || null,
      isTrial: isRenewalTrialPackageType(product.packageType),
      expirationDate: product.expirationDate,
      durationDays
    })
  }
  return result
}

// ------------------------------------------------------------------ RPC aka_agent_renewal_reminder_state()

/** Dữ liệu máy chủ giữ trong RAM của tiến trình chính. `loginDays` không bao giờ rời tiến trình chính. */
export interface RenewalReminderServerSnapshot {
  today: string
  /** Giờ máy chủ − giờ máy khách lúc nhận (ms). */
  serverTimeOffsetMs: number
  loginDays: string[]
  offers: RenewalReminderOfferRow[]
}

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/
const MAX_LOGIN_DAYS = 400
const MAX_OFFERS = 50
/** Lệch giờ quá ngần này thì bỏ giờ máy chủ, dùng đồng hồ máy (dữ liệu lạ). */
const MAX_SERVER_OFFSET_MS = 400 * 24 * 60 * 60 * 1000

function isDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_TEXT.test(value) && vietnamDayOf(`${value}T12:00:00Z`) === value
}

function finiteNumberOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseOffer(value: unknown): RenewalReminderOfferRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const opid = finiteNumberOrNull(row.organizationProductId)
  if (opid === undefined || (opid !== null && (!Number.isSafeInteger(opid) || opid <= 0))) return null
  const minDays = row.minDaysBeforeExpiry
  if (typeof minDays !== 'number' || !Number.isInteger(minDays) || minDays < 0 || minDays > 3650) return null
  const bonusDays = row.bonusDays === null || row.bonusDays === undefined ? 0 : row.bonusDays
  if (typeof bonusDays !== 'number' || !Number.isInteger(bonusDays) || bonusDays < 0 || bonusDays > 3650) return null
  const discountType = row.discountType === undefined ? null : row.discountType
  if (discountType !== null && discountType !== 'percent' && discountType !== 'fixed') return null
  const discountValue = finiteNumberOrNull(row.discountValue)
  if (discountValue === undefined || (discountValue !== null && discountValue < 0)) return null
  if (discountType === 'percent' && discountValue !== null && discountValue > 100) return null
  return { organizationProductId: opid, minDaysBeforeExpiry: minDays, bonusDays, discountType, discountValue }
}

/**
 * Kiểm chặt kết quả RPC. Sai định dạng ở bất kỳ phần nào → null (bên gọi dùng ngày theo đồng hồ máy, không ngày đăng nhập,
 * không ưu đãi).
 */
export function parseRenewalReminderServerState(value: unknown, receivedAtMs: number): RenewalReminderServerSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isDay(record.today)) return null
  const serverMs = typeof record.serverTime === 'string' ? Date.parse(record.serverTime) : Number.NaN
  if (!Number.isFinite(serverMs) || !Number.isFinite(receivedAtMs)) return null
  const offset = serverMs - receivedAtMs
  if (Math.abs(offset) > MAX_SERVER_OFFSET_MS) return null
  // Hôm nay do máy chủ trả phải trùng ngày của giờ máy chủ (sai lệch là dữ liệu hỏng).
  if (vietnamDayOf(serverMs) !== record.today) return null
  const rawDays = record.loginDays ?? []
  if (!Array.isArray(rawDays) || rawDays.length > MAX_LOGIN_DAYS || !rawDays.every(isDay)) return null
  const rawOffers = record.offers ?? []
  if (!Array.isArray(rawOffers) || rawOffers.length > MAX_OFFERS) return null
  const offers: RenewalReminderOfferRow[] = []
  for (const item of rawOffers) {
    const offer = parseOffer(item)
    if (!offer) return null
    offers.push(offer)
  }
  return { today: record.today, serverTimeOffsetMs: offset, loginDays: Array.from(new Set(rawDays as string[])), offers }
}

/** RPC chưa có/lỗi: ngày theo đồng hồ máy, không ngày đăng nhập, không ưu đãi. */
export function fallbackRenewalReminderServerState(nowMs: number): RenewalReminderServerSnapshot {
  return { today: vietnamDayOf(nowMs) ?? '1970-01-01', serverTimeOffsetMs: 0, loginDays: [], offers: [] }
}

/**
 * Bỏ dấu "nhắc sớm theo thói quen đăng nhập" trước khi gửi xuống renderer (cùng hàm với API của Web:
 * `toPublicRenewalReminder`). Mã nguồn `src` của link tính trong main từ thông báo gốc nên vẫn đúng.
 */
export const toRenewalReminderPublicReminder = toPublicRenewalReminder

/** Trạng thái gửi xuống renderer: chỉ đúng 4 trường của hợp đồng, không có ngày đăng nhập hay dấu nhắc sớm. */
export function toRenewalReminderPublicState(input: {
  enabled: boolean
  today: string | null
  serverTimeMs: number
  reminder: RenewalReminder | null
}): RenewalReminderState {
  if (!input.enabled || !input.today) return RENEWAL_REMINDER_STATE_OFF(input.serverTimeMs)
  return {
    enabled: true,
    today: input.today,
    serverTimeMs: input.serverTimeMs,
    reminder: input.reminder ? toRenewalReminderPublicReminder(input.reminder) : null
  }
}

// ------------------------------------------------------------------ Kênh cũ org_staff.app_notification

/** Bỏ thông báo nhắc gia hạn của job cũ khi giao diện mới đang bật cho người dùng (tránh hai dải). */
export function shouldSkipLegacyRenewalNotice(nativeReminderEnabled: boolean, rawStaffNotification: unknown): boolean {
  return nativeReminderEnabled && isRenewalLegacyNotice(rawStaffNotification)
}

// ------------------------------------------------------------------ Link sang cổng gia hạn

export interface RenewalReminderLink {
  url: string
  /** true: link có vé dùng một lần, khách vào thẳng trang thanh toán; false: khách đăng nhập cổng bằng mật khẩu. */
  signed: boolean
}

/**
 * Link có vé gia hạn dùng một lần do DB cấp (`aka_agent_renewal_link_ticket`, V519) hoặc, khi không có vé (DB chưa có hàm,
 * `{ok:false}` như `rate_limited`, mã vé sai dạng, lỗi gọi), link thường để khách đăng nhập cổng bằng mật khẩu. URL (có
 * mã vé) chỉ dùng trong tiến trình chính.
 */
export async function buildRenewalReminderLink(
  reminder: RenewalReminder,
  issueTicket: (organizationProductId: number | null) => Promise<unknown>
): Promise<RenewalReminderLink> {
  const source = renewalReminderSource('desktop', reminder)
  try {
    const ticket = parseRenewalLinkTicket(await issueTicket(reminder.product.organizationProductId))
    const url = ticket ? renewalReminderTicketUrl(ticket, reminder.kind, source) : null
    if (url) return { url, signed: true }
  } catch { /* Xin vé lỗi: dùng link thường bên dưới, không log chi tiết. */ }
  return { url: renewalReminderPlainUrl(reminder.kind, source), signed: false }
}
