/**
 * Nhắc gia hạn trong phần mềm: gói sắp hết hạn thì hiện nhãn đếm ngày, dải thông báo và hộp thoại kèm nút Gia hạn
 * (phương án: akaAgent `docs/RENEWAL_REMINDER_PLAN.md`; phía Web: `docs/RENEWAL_REMINDER.md`).
 *
 * Hợp đồng dùng chung Web/API/Desktop. Desktop chép nguyên văn sang `src/shared/renewalReminder.ts` (sửa ở đây trước rồi
 * chép lại). Tệp không import gì để chép được nguyên văn.
 *
 * Hai điều phải giữ khi sửa:
 * - Ngày tính theo giờ Việt Nam, lấy từ máy chủ. Số ngày còn lại = ngày hết hạn − hôm nay; 0 là ngày cuối còn dùng được
 *   (trùng quy tắc đăng nhập: còn hạn tới hết ngày ghi trên gói).
 * - Thói quen đăng nhập chỉ dùng bên trong để nhắc sớm hơn. Không đưa chu kỳ, số lần đăng nhập còn lại hay các ngày đã
 *   đăng nhập vào chữ hiển thị, và không gửi chúng xuống trình duyệt.
 */

// ------------------------------------------------------------------ Cấu hình

export const RENEWAL_REMINDER_SETTING_KEY = 'renewal.reminder'
/**
 * Web bản có giao diện nhắc gia hạn gửi header này (giá trị `1`) ở mọi request; máy chủ khi đó không trả thông báo nhắc gia
 * hạn kiểu cũ (`org_staff.app_notification` do job ghi) qua `/app-notification`, tránh hiện hai dải.
 */
export const RENEWAL_REMINDER_UI_HEADER = 'x-aka-renewal-reminder'
export type RenewalReminderAudience = 'off' | 'admin_akabiz' | 'all'

export interface RenewalReminderSettings {
  audience: RenewalReminderAudience
  /** Các mốc ngày, giảm dần. Giai đoạn = mốc nhỏ nhất còn ≥ số ngày còn lại. */
  milestones: number[]
  /** Từ mốc này trở xuống có hộp thoại (mức vừa). */
  popupFromDays: number
  /** Từ mốc này trở xuống dải thông báo không tắt được, chỉ thu gọn (mức mạnh). */
  lockedFromDays: number
  /** Gói có thời hạn không quá số ngày này: ở mốc lớn nhất chỉ hiện nhãn, không hiện dải. */
  shortPackageDays: number
  /** Còn không quá ngần này lần đăng nhập (ước theo thói quen) thì nhắc sớm. */
  usageCycles: number
  usageWindowDays: number
  /** Chỉ nhắc sớm khi gói còn không quá số ngày này. */
  usageMaxDaysLeft: number
  /** Cần ít nhất ngần này ngày có đăng nhập mới tính thói quen. */
  usageMinLoginDays: number
  /** Chỉ quản trị tổ chức (`org_staff.is_admin`) thấy. */
  adminOnly: boolean
  /** Bật kênh có sẵn `org_staff.app_notification` cho bản app chưa có giao diện nhắc gia hạn. */
  legacyBanner: boolean
}

export const RENEWAL_REMINDER_DEFAULT_MILESTONES: readonly number[] = [30, 14, 7, 5, 3, 1, 0]

/** Thiếu dòng cài đặt, sai định dạng hoặc lỗi đọc: tắt. */
export const RENEWAL_REMINDER_SETTINGS_OFF: RenewalReminderSettings = {
  audience: 'off',
  milestones: [...RENEWAL_REMINDER_DEFAULT_MILESTONES],
  popupFromDays: 7,
  lockedFromDays: 3,
  shortPackageDays: 61,
  usageCycles: 3,
  usageWindowDays: 60,
  usageMaxDaysLeft: 60,
  usageMinLoginDays: 3,
  adminOnly: false,
  legacyBanner: false
}

const intInRange = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback

function parseMilestones(value: unknown): number[] {
  if (!Array.isArray(value)) return [...RENEWAL_REMINDER_DEFAULT_MILESTONES]
  const days = new Set<number>()
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > 365) return [...RENEWAL_REMINDER_DEFAULT_MILESTONES]
    days.add(item)
  }
  if (days.size === 0 || days.size > 20) return [...RENEWAL_REMINDER_DEFAULT_MILESTONES]
  return Array.from(days).sort((a, b) => b - a)
}

/**
 * `auto_system_settings` `renewal.reminder` = JSON
 * `{"audience":"off"|"admin_akabiz"|"all","milestones":[30,14,7,5,3,1,0],"popupFromDays":7,"lockedFromDays":3,
 *   "shortPackageDays":61,"usageCycles":3,"usageWindowDays":60,"usageMaxDaysLeft":60,"usageMinLoginDays":3,
 *   "adminOnly":false,"legacyBanner":true}`. Trường thiếu hoặc sai lấy mặc định; `audience` thiếu hoặc sai = tắt.
 */
export function parseRenewalReminderSettings(value: unknown): RenewalReminderSettings {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...RENEWAL_REMINDER_SETTINGS_OFF }
    const record = parsed as Record<string, unknown>
    const off = RENEWAL_REMINDER_SETTINGS_OFF
    const audience: RenewalReminderAudience = record.audience === 'all' || record.audience === 'admin_akabiz' ? record.audience : 'off'
    const popupFromDays = intInRange(record.popupFromDays, off.popupFromDays, 0, 365)
    return {
      audience,
      milestones: parseMilestones(record.milestones),
      popupFromDays,
      lockedFromDays: Math.min(intInRange(record.lockedFromDays, off.lockedFromDays, 0, 365), popupFromDays),
      shortPackageDays: intInRange(record.shortPackageDays, off.shortPackageDays, 0, 3650),
      usageCycles: intInRange(record.usageCycles, off.usageCycles, 0, 30),
      usageWindowDays: intInRange(record.usageWindowDays, off.usageWindowDays, 7, 365),
      usageMaxDaysLeft: intInRange(record.usageMaxDaysLeft, off.usageMaxDaysLeft, 0, 365),
      usageMinLoginDays: intInRange(record.usageMinLoginDays, off.usageMinLoginDays, 2, 60),
      adminOnly: record.adminOnly === true,
      legacyBanner: record.legacyBanner === true
    }
  } catch { return { ...RENEWAL_REMINDER_SETTINGS_OFF } }
}

export interface RenewalReminderViewer {
  isAdminAkabiz?: boolean | null
  /** Quản trị tổ chức (`org_staff.is_admin`). */
  isAdmin?: boolean | null
}

export function renewalReminderEnabledFor(settings: RenewalReminderSettings | null | undefined, viewer: RenewalReminderViewer): boolean {
  if (!settings) return false
  const inAudience = settings.audience === 'all' || (settings.audience === 'admin_akabiz' && viewer.isAdminAkabiz === true)
  return inAudience && (!settings.adminOnly || viewer.isAdmin === true)
}

// ------------------------------------------------------------------ Ngày Việt Nam

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function dayToUtcMs(day: string): number {
  const match = DAY_PATTERN.exec(day)
  if (!match) return Number.NaN
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return new Date(ms).toISOString().slice(0, 10) === day ? ms : Number.NaN
}

/** Ngày Việt Nam `YYYY-MM-DD` của một thời điểm; null khi không đọc được. */
export function vietnamDayOf(value: string | number | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms + VIETNAM_OFFSET_MS).toISOString().slice(0, 10) : null
}

/** Số ngày từ `from` tới `to` (hai ngày `YYYY-MM-DD`); NaN khi sai định dạng. */
export function vietnamDayDiff(from: string, to: string): number {
  return Math.round((dayToUtcMs(to) - dayToUtcMs(from)) / DAY_MS)
}

export function addVietnamDays(day: string, days: number): string | null {
  const ms = dayToUtcMs(day)
  return Number.isFinite(ms) ? new Date(ms + days * DAY_MS).toISOString().slice(0, 10) : null
}

/** Thời điểm 24:00 giờ Việt Nam của ngày đó (lúc gói thật sự ngừng dùng được). */
export function vietnamDayEndMs(day: string): number {
  return dayToUtcMs(day) + DAY_MS - VIETNAM_OFFSET_MS
}

/** `dd/mm/yyyy`; `short` = `dd/mm`. */
export function formatVietnamDay(day: string, short = false): string {
  const match = DAY_PATTERN.exec(day)
  if (!match) return day
  return short ? `${match[3]}/${match[2]}` : `${match[3]}/${match[2]}/${match[1]}`
}

// ------------------------------------------------------------------ Sản phẩm

/** Sản phẩm akaAgent (cùng danh sách với quyền đăng nhập Desktop). */
export const RENEWAL_REMINDER_PRODUCT_IDS: readonly number[] = [3, 10, 13, 16, 17, 18]

/** Nhóm quyền: Facebook 3/10 và Zalo 16/18 dùng chung một nhóm, tính theo dòng hết hạn xa nhất. */
export function renewalProductGroup(productId: number | null | undefined): string {
  if (productId === 3 || productId === 10) return 'facebook'
  if (productId === 16 || productId === 18) return 'zalo'
  if (productId === 17) return 'sms'
  if (productId === 13) return 'email'
  return `p${productId ?? 0}`
}

/** Bản dùng thử theo cùng quy tắc với cổng gia hạn của CRM: rỗng, demo hoặc free. */
export function isRenewalTrialPackageType(packageType: string | null | undefined): boolean {
  const type = String(packageType ?? '').trim().toLowerCase()
  return type === '' || type === 'demo' || type === 'free'
}

export interface RenewalReminderProduct {
  /** `org_organization_product.id`; cổng gia hạn nhận qua `opid`. */
  organizationProductId: number | null
  group: string
  /** Tên sản phẩm để ghép câu, ví dụ "akaAgent Zalo". */
  displayName: string
  /** Tên gói đầy đủ nếu có, ví dụ "akaAgent Zalo Web - 2 tháng". */
  packageName: string | null
  isTrial: boolean
  expirationDate: string | null
  durationDays?: number | null
}

/** Ưu đãi gia hạn sớm đã được máy chủ lọc đúng sản phẩm (CRM `aka_promotion.min_days_before_expiry`). */
export interface RenewalReminderOfferRow {
  organizationProductId: number | null
  /** Áp dụng khi gói còn ít nhất ngần này ngày. */
  minDaysBeforeExpiry: number
  bonusDays: number
  discountType: 'percent' | 'fixed' | null
  discountValue: number | null
}

export interface RenewalReminderOffer extends RenewalReminderOfferRow {
  /** Ngày cuối còn hưởng ưu đãi (ngày Việt Nam). */
  deadlineDay: string
}

// ------------------------------------------------------------------ Thói quen đăng nhập (chỉ dùng bên trong)

/**
 * Chu kỳ đăng nhập = trung vị khoảng cách giữa các ngày có đăng nhập liền nhau trong cửa sổ, tối thiểu 1.
 * Trả null khi chưa đủ dữ liệu. Kết quả không được hiển thị cho khách.
 */
export function computeLoginCycleDays(
  loginDays: readonly string[] | null | undefined,
  today: string,
  settings: Pick<RenewalReminderSettings, 'usageWindowDays' | 'usageMinLoginDays'>
): number | null {
  if (!Number.isFinite(dayToUtcMs(today))) return null
  const days = new Set<string>([today])
  for (const day of loginDays ?? []) {
    const age = vietnamDayDiff(day, today)
    if (Number.isFinite(age) && age >= 0 && age <= settings.usageWindowDays) days.add(day)
  }
  if (days.size < settings.usageMinLoginDays) return null
  const sorted = Array.from(days).sort()
  const gaps: number[] = []
  for (let index = 1; index < sorted.length; index += 1) gaps.push(vietnamDayDiff(sorted[index - 1], sorted[index]))
  gaps.sort((a, b) => a - b)
  const middle = Math.floor(gaps.length / 2)
  const median = gaps.length % 2 === 1 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2
  return Math.max(1, Math.ceil(median))
}

// ------------------------------------------------------------------ Tính thông báo

export type RenewalReminderKind = 'trial' | 'paid'
export type RenewalReminderLevel = 'mild' | 'medium' | 'strong'
/** none: không hiện; once: hiện tới khi tắt, tắt tới giai đoạn sau; daily: tắt được trong ngày; sticky: chỉ thu gọn trong ngày; locked: luôn hiện. */
export type RenewalReminderBannerMode = 'none' | 'once' | 'daily' | 'sticky' | 'locked'
/** none: không có; once: một lần mỗi giai đoạn; daily: mỗi ngày một lần; always: mỗi lần mở phần mềm. */
export type RenewalReminderDialogMode = 'none' | 'once' | 'daily' | 'always'

export interface RenewalReminder {
  /** `<id dòng sản phẩm hoặc nhóm>:<ngày hết hạn>`; gia hạn xong (ngày hết hạn đổi) là khóa đổi, trạng thái đã xem tự bỏ. */
  key: string
  kind: RenewalReminderKind
  product: RenewalReminderProduct
  daysLeft: number
  /** Ngày hết hạn theo giờ Việt Nam. */
  expiryDay: string
  /** 24:00 giờ Việt Nam của ngày hết hạn. */
  expiresAtMs: number
  /** Khóa giai đoạn dùng cho trạng thái đã xem. */
  stageKey: string
  /** Mốc ngày đang áp dụng; null khi chỉ có nhắc sớm. Dùng thử: số ngày còn lại. */
  stage: number | null
  level: RenewalReminderLevel
  /** Được nâng mức nhờ thói quen đăng nhập. Chỉ để đo lường; giao diện không được nói ra. */
  early: boolean
  banner: RenewalReminderBannerMode
  dialog: RenewalReminderDialogMode
  /** Hiện đồng hồ đếm ngược tới `expiresAtMs`. */
  countdown: boolean
  /** Số sản phẩm khác cũng đang trong diện nhắc. */
  otherProducts: number
  offer: RenewalReminderOffer | null
}

export interface RenewalReminderInput {
  products: readonly RenewalReminderProduct[]
  /** Ngày Việt Nam hôm nay, lấy từ máy chủ. */
  today: string
  settings: RenewalReminderSettings
  loginDays?: readonly string[] | null
  offers?: readonly RenewalReminderOfferRow[] | null
}

const LEVEL_RANK: Record<RenewalReminderLevel, number> = { mild: 0, medium: 1, strong: 2 }
const strongerLevel = (a: RenewalReminderLevel, b: RenewalReminderLevel): RenewalReminderLevel => LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b

interface ActiveProduct { product: RenewalReminderProduct; expiryDay: string; daysLeft: number }

/** Mỗi nhóm lấy dòng còn hạn hết hạn xa nhất: nhóm chỉ thật sự hết khi dòng cuối cùng hết. */
function activeProductsByGroup(products: readonly RenewalReminderProduct[], today: string): ActiveProduct[] {
  const byGroup = new Map<string, ActiveProduct>()
  for (const product of products) {
    const expiryDay = vietnamDayOf(product.expirationDate)
    if (!expiryDay) continue
    const daysLeft = vietnamDayDiff(today, expiryDay)
    if (!Number.isFinite(daysLeft) || daysLeft < 0) continue
    const current = byGroup.get(product.group)
    if (!current || daysLeft > current.daysLeft) byGroup.set(product.group, { product, expiryDay, daysLeft })
  }
  return Array.from(byGroup.values())
}

function pickOffer(active: ActiveProduct, offers: readonly RenewalReminderOfferRow[] | null | undefined): RenewalReminderOffer | null {
  if (active.product.isTrial) return null
  let best: RenewalReminderOfferRow | null = null
  for (const offer of offers ?? []) {
    if (offer.organizationProductId !== null && offer.organizationProductId !== active.product.organizationProductId) continue
    if (!Number.isInteger(offer.minDaysBeforeExpiry) || offer.minDaysBeforeExpiry < 1 || active.daysLeft < offer.minDaysBeforeExpiry) continue
    if (!(offer.bonusDays > 0) && !(offer.discountValue !== null && offer.discountValue > 0)) continue
    if (!best || offer.bonusDays > best.bonusDays || (offer.bonusDays === best.bonusDays && (offer.discountValue ?? 0) > (best.discountValue ?? 0))) best = offer
  }
  if (!best) return null
  const deadlineDay = addVietnamDays(active.expiryDay, -best.minDaysBeforeExpiry)
  return deadlineDay ? { ...best, deadlineDay } : null
}

function buildReminder(active: ActiveProduct, input: RenewalReminderInput, cycleDays: number | null): RenewalReminder | null {
  const { product, expiryDay, daysLeft } = active
  const { settings } = input
  const base = {
    key: `${product.organizationProductId ?? product.group}:${expiryDay}`,
    product,
    daysLeft,
    expiryDay,
    expiresAtMs: vietnamDayEndMs(expiryDay),
    otherProducts: 0
  }

  if (product.isTrial) {
    const level: RenewalReminderLevel = daysLeft <= 0 ? 'strong' : daysLeft === 1 ? 'medium' : 'mild'
    return {
      ...base, kind: 'trial', stage: daysLeft, stageKey: `t${daysLeft}`, level, early: false,
      banner: 'none', dialog: daysLeft <= 0 ? 'always' : daysLeft === 1 ? 'daily' : 'none', countdown: true, offer: null
    }
  }

  const milestones = settings.milestones
  const largest = milestones.length > 0 ? milestones[0] : -1
  let stage: number | null = null
  for (const milestone of milestones) if (milestone >= daysLeft) stage = milestone
  let level: RenewalReminderLevel | null = stage === null ? null
    : stage <= settings.lockedFromDays ? 'strong' : stage <= settings.popupFromDays ? 'medium' : 'mild'

  let early = false
  if (cycleDays !== null && daysLeft <= settings.usageMaxDaysLeft) {
    const loginsLeft = Math.floor(daysLeft / cycleDays)
    if (loginsLeft <= settings.usageCycles) {
      const usageLevel: RenewalReminderLevel = loginsLeft <= 1 ? 'strong' : 'medium'
      const raised: RenewalReminderLevel = level === null ? usageLevel : strongerLevel(level, usageLevel)
      early = raised !== level
      level = raised
    }
  }
  if (level === null) return null

  const lastDay = daysLeft <= 0
  if (lastDay) level = 'strong'
  const shortPackageAtLargest = !early && level === 'mild' && stage === largest
    && typeof product.durationDays === 'number' && product.durationDays > 0 && product.durationDays <= settings.shortPackageDays
  const banner: RenewalReminderBannerMode = lastDay ? 'locked'
    : level === 'strong' ? 'sticky' : level === 'medium' ? 'daily' : shortPackageAtLargest ? 'none' : 'once'
  const dialog: RenewalReminderDialogMode = lastDay ? 'always' : level === 'strong' ? 'daily' : level === 'medium' ? 'once' : 'none'

  return {
    ...base, kind: 'paid', stage, stageKey: `${early ? 'e' : 'd'}${stage ?? 'x'}:${level}`, level, early,
    banner, dialog, countdown: lastDay, offer: pickOffer(active, input.offers)
  }
}

/** Thông báo cần hiện: sản phẩm gấp nhất (ít ngày nhất; bằng nhau thì gói trả phí trước). Không có gì cần nhắc thì null. */
export function computeRenewalReminder(input: RenewalReminderInput): RenewalReminder | null {
  if (!Number.isFinite(dayToUtcMs(input.today))) return null
  const cycleDays = computeLoginCycleDays(input.loginDays, input.today, input.settings)
  const reminders: RenewalReminder[] = []
  for (const active of activeProductsByGroup(input.products, input.today)) {
    const reminder = buildReminder(active, input, cycleDays)
    if (reminder) reminders.push(reminder)
  }
  if (reminders.length === 0) return null
  reminders.sort((a, b) => a.daysLeft - b.daysLeft || (a.kind === b.kind ? 0 : a.kind === 'paid' ? -1 : 1))
  return { ...reminders[0], otherProducts: reminders.length - 1 }
}

// ------------------------------------------------------------------ Trạng thái đã xem (lưu tại máy)

export interface RenewalReminderSeen {
  key: string
  /** Giai đoạn mà khách đã tắt dải kiểu `once`. */
  bannerStageKey?: string
  /** Ngày khách ẩn/thu gọn dải kiểu `daily`/`sticky`. */
  bannerDay?: string
  dialogStageKey?: string
  dialogDay?: string
}

export interface RenewalReminderView {
  showBanner: boolean
  /** Có nút tắt/thu gọn dải. */
  bannerDismissible: boolean
  showDialog: boolean
}

/**
 * Quyết định hiện gì cho lần mở này. `dialogShownThisSession`: hộp thoại kiểu `always` chỉ hiện một lần cho mỗi lần mở
 * phần mềm, bên gọi tự nhớ trong RAM.
 */
export function renewalReminderView(
  reminder: RenewalReminder,
  seen: RenewalReminderSeen | null | undefined,
  today: string,
  dialogShownThisSession = false
): RenewalReminderView {
  const state = seen && seen.key === reminder.key ? seen : null
  const showBanner = reminder.banner === 'locked' ? true
    : reminder.banner === 'none' ? false
      : reminder.banner === 'once' ? state?.bannerStageKey !== reminder.stageKey
        : state?.bannerDay !== today
  const showDialog = reminder.dialog === 'none' ? false
    : reminder.dialog === 'always' ? !dialogShownThisSession
      : reminder.dialog === 'daily' ? state?.dialogDay !== today && !dialogShownThisSession
        : state?.dialogStageKey !== reminder.stageKey && !dialogShownThisSession
  return { showBanner, bannerDismissible: reminder.banner === 'once' || reminder.banner === 'daily' || reminder.banner === 'sticky', showDialog }
}

export function dismissRenewalBanner(reminder: RenewalReminder, seen: RenewalReminderSeen | null | undefined, today: string): RenewalReminderSeen {
  const state: RenewalReminderSeen = seen && seen.key === reminder.key ? { ...seen } : { key: reminder.key }
  if (reminder.banner === 'once') state.bannerStageKey = reminder.stageKey
  else if (reminder.banner === 'daily' || reminder.banner === 'sticky') state.bannerDay = today
  return state
}

export function markRenewalDialogShown(reminder: RenewalReminder, seen: RenewalReminderSeen | null | undefined, today: string): RenewalReminderSeen {
  const state: RenewalReminderSeen = seen && seen.key === reminder.key ? { ...seen } : { key: reminder.key }
  state.dialogStageKey = reminder.stageKey
  state.dialogDay = today
  return state
}

export function parseRenewalReminderSeen(value: unknown): RenewalReminderSeen | null {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.key !== 'string' || !record.key || record.key.length > 80) return null
    const text = (field: unknown): string | undefined => typeof field === 'string' && field.length <= 40 ? field : undefined
    return {
      key: record.key, bannerStageKey: text(record.bannerStageKey), bannerDay: text(record.bannerDay),
      dialogStageKey: text(record.dialogStageKey), dialogDay: text(record.dialogDay)
    }
  } catch { return null }
}

// ------------------------------------------------------------------ Câu chữ

export interface RenewalReminderTexts {
  /** Nhãn nhỏ trên thanh trên cùng: "Còn 7 ngày", "Hết hạn hôm nay", "Dùng thử còn". */
  chip: string
  /** Dòng đầu của dải thông báo và tiêu đề hộp thoại. */
  title: string
  message: string
  dialogMessage: string
  /** "Gia hạn", "Gia hạn ngay", "Nâng cấp". */
  button: string
  offer: string | null
  /** "và 2 gói khác"; null khi chỉ có một gói. */
  others: string | null
}

const groupThousands = (value: number): string => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

export function renewalReminderProductLabel(reminder: Pick<RenewalReminder, 'kind' | 'product'>): string {
  const { product } = reminder
  const packageName = (product.packageName ?? '').trim()
  return reminder.kind === 'paid' && packageName ? packageName : product.displayName.trim() || 'akaAgent'
}

export function renewalOfferText(offer: RenewalReminderOffer | null, today: string): string | null {
  if (!offer) return null
  const benefit = offer.bonusDays > 0 ? `tặng thêm ${offer.bonusDays} ngày`
    : offer.discountType === 'percent' && offer.discountValue ? `giảm ${offer.discountValue}%`
      : offer.discountType === 'fixed' && offer.discountValue ? `giảm ${groupThousands(offer.discountValue)}đ` : null
  if (!benefit) return null
  return offer.deadlineDay === today ? `Hôm nay là ngày cuối: ${benefit}` : `Gia hạn trước ${formatVietnamDay(offer.deadlineDay, true)}: ${benefit}`
}

/** Câu chữ cho khách. Không có trường nào nói về thói quen đăng nhập. */
export function renewalReminderTexts(reminder: RenewalReminder, today: string): RenewalReminderTexts {
  const label = renewalReminderProductLabel(reminder)
  const expiry = formatVietnamDay(reminder.expiryDay)
  const others = reminder.otherProducts > 0 ? `và ${reminder.otherProducts} gói khác` : null
  if (reminder.kind === 'trial') {
    return {
      chip: 'Dùng thử còn',
      title: `Bạn đang dùng thử ${label}`,
      message: `Hết hạn lúc 24:00 ngày ${expiry}. Nâng cấp để giữ nguyên tài khoản và chiến dịch đã tạo.`,
      dialogMessage: reminder.daysLeft <= 0
        ? 'Hôm nay là ngày dùng thử cuối cùng. Nâng cấp trước 24:00 để tiếp tục dùng vào ngày mai.'
        : 'Nâng cấp để giữ nguyên tài khoản và chiến dịch đã tạo.',
      button: 'Nâng cấp', offer: null, others
    }
  }
  if (reminder.daysLeft <= 0) {
    return {
      chip: 'Hết hạn hôm nay',
      title: `Gói ${label} hết hạn hôm nay`,
      message: 'Sau 24:00 phần mềm sẽ ngừng chạy chiến dịch.',
      dialogMessage: 'Gia hạn trước 24:00 để phần mềm tiếp tục chạy vào ngày mai.',
      button: 'Gia hạn ngay', offer: null, others
    }
  }
  return {
    chip: `Còn ${reminder.daysLeft} ngày`,
    title: `Gói ${label} còn ${reminder.daysLeft} ngày`,
    message: `Hết hạn ${expiry}. Gia hạn hôm nay, hạn mới cộng tiếp từ ${formatVietnamDay(reminder.expiryDay, true)} nên không mất ngày nào.`,
    dialogMessage: 'Gia hạn sớm để chiến dịch không bị gián đoạn. Bạn không mất ngày nào của gói hiện tại.',
    button: reminder.level === 'strong' ? 'Gia hạn ngay' : 'Gia hạn',
    offer: renewalOfferText(reminder.offer, today), others
  }
}

export interface RenewalCountdown { days: number; hours: number; minutes: number; seconds: number; totalMs: number }

export function renewalCountdown(expiresAtMs: number, nowMs: number): RenewalCountdown {
  const totalMs = Math.max(0, expiresAtMs - nowMs)
  const totalSeconds = Math.floor(totalMs / 1000)
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalMs
  }
}

const two = (value: number): string => String(value).padStart(2, '0')

/** "2 ngày 05 giờ" khi còn từ một ngày; "07:42:15" trong 24 giờ cuối. */
export function renewalCountdownLabel(countdown: RenewalCountdown): string {
  return countdown.days > 0
    ? `${countdown.days} ngày ${two(countdown.hours)} giờ`
    : `${two(countdown.hours)}:${two(countdown.minutes)}:${two(countdown.seconds)}`
}

// ------------------------------------------------------------------ Link sang cổng gia hạn

/** Khớp `RENEWAL_PORTAL_PATHS` của cổng CRM (`shared/renewal-portal.ts`, SqlServerDashboard). */
export const RENEWAL_REMINDER_PORTAL_ORIGIN = 'https://crm.akabiz.net'
export const RENEWAL_REMINDER_PORTAL_LOGIN_PATH = '/gia-han'

/** Trang có thẻ thanh toán nhanh cho gói còn hạn. */
export function renewalReminderLandingPath(kind: RenewalReminderKind): string {
  return kind === 'trial' ? '/gia-han/het-han-dung-thu' : '/gia-han/het-han-goi'
}

export type RenewalReminderChannel = 'desktop' | 'web' | 'banner'

/**
 * Mã nguồn gắn vào link (`src`) để CRM ghi lên đơn: `desktop.d7` (mốc 7 ngày), `web.e28` (nhắc sớm khi còn 28 ngày),
 * `web.t2` (dùng thử còn 2 ngày). Chỉ để thống kê. Khớp mẫu `^[a-z][a-z_]{1,15}\.[a-z][0-9]{1,3}$` của CRM.
 */
export function renewalReminderSource(channel: RenewalReminderChannel, reminder: Pick<RenewalReminder, 'kind' | 'early' | 'stage' | 'daysLeft'>): string {
  const days = Math.max(0, Math.min(999, reminder.daysLeft))
  if (reminder.kind === 'trial') return `${channel}.t${days}`
  if (reminder.early || reminder.stage === null) return `${channel}.e${days}`
  return `${channel}.d${Math.max(0, Math.min(999, reminder.stage))}`
}

export const RENEWAL_ENTRY_SOURCE_PATTERN = /^[a-z][a-z_]{1,15}\.[a-z][0-9]{1,3}$/

/** Link thường: khách đăng nhập cổng bằng mật khẩu rồi được đưa tới đúng trang. Dùng khi không ký được link. */
export function renewalReminderPlainUrl(kind: RenewalReminderKind, source?: string | null): string {
  const url = new URL(RENEWAL_REMINDER_PORTAL_LOGIN_PATH, RENEWAL_REMINDER_PORTAL_ORIGIN)
  url.searchParams.set('next', renewalReminderLandingPath(kind))
  if (source && RENEWAL_ENTRY_SOURCE_PATTERN.test(source)) url.searchParams.set('src', source)
  return url.toString()
}

/** Gắn `next` và `src` vào link ký số `…/gia-han?t=<JWT>`. Trả null nếu link không thuộc cổng gia hạn. */
export function renewalReminderSignedUrl(signedUrl: string, kind: RenewalReminderKind, source?: string | null): string | null {
  try {
    const url = new URL(signedUrl)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (url.origin !== RENEWAL_REMINDER_PORTAL_ORIGIN || url.username || url.password || path !== RENEWAL_REMINDER_PORTAL_LOGIN_PATH) return null
    if (!url.searchParams.get('t')) return null
    url.searchParams.set('next', renewalReminderLandingPath(kind))
    if (source && RENEWAL_ENTRY_SOURCE_PATTERN.test(source)) url.searchParams.set('src', source)
    return url.toString()
  } catch { return null }
}

// ------------------------------------------------------------------ Hợp đồng API / IPC

/** `GET /renewal/reminder` (Web) và IPC `renewal-reminder:state` (Desktop). Không chứa dữ liệu thói quen đăng nhập. */
export interface RenewalReminderState {
  enabled: boolean
  /** Ngày Việt Nam theo máy chủ; null khi tắt. */
  today: string | null
  /** Giờ máy chủ lúc trả lời, để đồng hồ đếm ngược không phụ thuộc đồng hồ máy khách. */
  serverTimeMs: number
  reminder: RenewalReminder | null
}

export const RENEWAL_REMINDER_STATE_OFF = (serverTimeMs: number): RenewalReminderState =>
  ({ enabled: false, today: null, serverTimeMs, reminder: null })

/**
 * Bản gửi xuống máy khách (trình duyệt, renderer của Desktop): bỏ dấu "nhắc sớm theo thói quen đăng nhập". `early` luôn
 * false và `stageKey` không còn tiền tố phân biệt nhắc sớm; khóa vẫn đổi theo giai đoạn và mức nên trạng thái "đã xem"
 * hoạt động như cũ. Mã nguồn của link (`renewalReminderSource`) phải tính từ thông báo gốc, ở phía máy chủ.
 */
export function toPublicRenewalReminder(reminder: RenewalReminder): RenewalReminder {
  return { ...reminder, early: false, stageKey: `s${reminder.stage ?? 'x'}:${reminder.level}` }
}

export interface RenewalReminderLinkRequest {
  /** `RenewalReminder.key` đang hiển thị; máy chủ tự tính lại sản phẩm và nguồn, không tin số liệu từ máy khách. */
  reminderKey: string
}

export interface RenewalReminderLinkResponse {
  url: string
  /** true: link ký số, khách vào thẳng trang thanh toán; false: khách đăng nhập cổng bằng mật khẩu. */
  signed: boolean
}

// ------------------------------------------------------------------ Kênh có sẵn `org_staff.app_notification`

/** Dấu nhận biết thông báo do job nhắc gia hạn ghi; bản app mới bỏ qua thông báo có dấu này vì đã có giao diện riêng. */
export const RENEWAL_LEGACY_NOTICE_KIND = 'renewal_reminder'

export interface RenewalLegacyNotice {
  kind: typeof RENEWAL_LEGACY_NOTICE_KIND
  key: string
  title: string
  message: string
  level: 'info' | 'warning' | 'error'
  linkLabel: string
  linkUrl: string
  /** Hết ngày hôm nay (giờ Việt Nam): job không chạy được thì thông báo tự mất, không báo sai số ngày. */
  endsAt: string
}

/**
 * Kênh cũ không tắt được nên chỉ ghi khi đáng: mức vừa và mạnh, dùng thử, còn mức nhẹ thì chỉ đúng ngày mốc.
 * Câu chữ như giao diện mới, không có ưu đãi (kênh cũ chỉ có một dòng).
 */
export function buildRenewalLegacyNotice(reminder: RenewalReminder, today: string): RenewalLegacyNotice | null {
  if (reminder.kind === 'paid' && reminder.level === 'mild' && (reminder.banner === 'none' || reminder.stage !== reminder.daysLeft)) return null
  const texts = renewalReminderTexts(reminder, today)
  return {
    kind: RENEWAL_LEGACY_NOTICE_KIND,
    key: reminder.key,
    title: texts.title,
    message: texts.message,
    level: reminder.level === 'strong' ? 'error' : reminder.level === 'medium' ? 'warning' : 'info',
    linkLabel: texts.button,
    linkUrl: renewalReminderPlainUrl(reminder.kind, renewalReminderSource('banner', reminder)),
    endsAt: new Date(vietnamDayEndMs(today)).toISOString()
  }
}

/** Giá trị thô của `org_staff.app_notification` có phải thông báo do job nhắc gia hạn ghi không. */
export function isRenewalLegacyNotice(rawValue: unknown): boolean {
  if (typeof rawValue !== 'string' || !rawValue.includes(RENEWAL_LEGACY_NOTICE_KIND)) return false
  try {
    const parsed: unknown = JSON.parse(rawValue)
    return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as Record<string, unknown>).kind === RENEWAL_LEGACY_NOTICE_KIND
  } catch { return false }
}
