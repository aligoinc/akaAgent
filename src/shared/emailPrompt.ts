/**
 * Form xin email sau khi đăng nhập (akaAgent V652, phương án akaAgent `docs/STAFF_EMAIL_PROMPT_PLAN.md`).
 *
 * File này là hợp đồng dữ liệu giữa DB (`aka_agent_control_email_prompt` cho API Web, `aka_agent_email_prompt` cho
 * Desktop) và giao diện Web / iOS / Desktop: chỉ kiểu dữ liệu và hàm thuần, không gọi mạng, không import file khác.
 * Desktop chép NGUYÊN VĂN sang akaAgent `src/shared/emailPrompt.ts` (sửa ở WebApp trước rồi chép lại).
 *
 * Luật (DB quyết định, app chỉ hiển thị):
 * - "Có email" = 1 trong 3 chỗ có email dùng được: email của tài khoản đăng nhập (`org_staff.email`), email tổ chức
 *   (`org_organization.email`), email khách trong CRM (`aka_customer.email` của tổ chức). Có thì không hỏi.
 * - Không có ở đâu: hiện form; khách bấm × thì hôm sau (ngày VN) hỏi lại, thanh trên cùng có nhãn "Thêm email".
 * - Admin tổ chức lưu thì ghi đè cả 3 chỗ, tài khoản khác chỉ ghi tài khoản của mình. Email cũ giữ ở `email_list`.
 * - Lưu xong DB xếp một thư xác nhận (không chứa mật khẩu), API Web gửi.
 */

/** Khóa `auto_system_settings`: JSON `{"audience":"off" | "admin_akabiz" | "orgs" | "all", "organizationIds":[...]}`. */
export const EMAIL_PROMPT_SETTING_KEY = 'account.email_prompt'

export type EmailPromptShow = 'none' | 'enter' | 'confirm'
export type EmailPromptClient = 'desktop' | 'web' | 'ios'

export interface EmailPromptState {
  /** Công tắc đang mở cho tài khoản này (tắt thì ẩn cả form, nhãn lẫn nút "Đổi email"). */
  enabled: boolean
  /** `enter`: hiện màn nhập email; `confirm`: hiện màn xác nhận email đã có (dự phòng, hiện DB chưa trả); `none`: không hiện. */
  show: EmailPromptShow
  /** `disabled` | `no_package` | `has_email` | `dismissed` | `no_email` (lý do kỹ thuật, không hiện cho khách). */
  reason: string
  /** Hiện nhãn "Thêm email" trên thanh trên cùng (chưa có email, kể cả khi hôm nay đã tắt form). */
  chip: boolean
  username: string | null
  isAdmin: boolean
  /** Chỉ có ở `confirm`: email đang lưu, hiện nguyên văn để khách xác nhận. */
  email: string | null
}

export interface EmailPromptSaveInput {
  client: EmailPromptClient
  /** Email khách gõ (màn nhập). Bỏ trống khi `confirm`. */
  email?: string
  /** Khách bấm "Đúng, tôi đang dùng email này" ở màn xác nhận. */
  confirm?: boolean
  /** Khách bấm "Giữ nguyên" khi form gợi ý sửa tên miền gõ nhầm. */
  allowTypo?: boolean
}

export interface EmailPromptSaveResult {
  email: string
  isAdmin: boolean
  /** Email này đã được xác nhận qua thư trước đó (lưu lại đúng email cũ). */
  verified: boolean
}

export interface EmailPromptProfile {
  enabled: boolean
  /** Email hiện tại của tài khoản đăng nhập (viết thường), null nếu chưa có. */
  email: string | null
  /** Mọi email từng dùng của tài khoản, mới nhất đứng đầu. */
  emailList: string[]
  isAdmin: boolean
  verified: boolean
}

export const EMAIL_PROMPT_ERROR_CODES = [
  'disabled',
  'no_session',
  'staff_inactive',
  'invalid_client',
  'invalid_action',
  'email_invalid',
  'email_typo',
  'nothing_to_confirm',
  'rate_limited',
  /** DB chưa có V652 (PGRST202). */
  'not_installed',
  /** Lỗi mạng / dữ liệu trả về sai dạng. */
  'unavailable'
] as const
export type EmailPromptErrorCode = typeof EMAIL_PROMPT_ERROR_CODES[number]

export type EmailPromptResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: EmailPromptErrorCode; message: string; suggestion?: string }

export function emailPromptErrorMessage(code: EmailPromptErrorCode): string {
  switch (code) {
    case 'email_invalid': return 'Email chưa đúng, ví dụ: ten@gmail.com'
    case 'email_typo': return 'Tên miền email có vẻ bị gõ nhầm.'
    case 'rate_limited': return 'Bạn đã lưu email nhiều lần trong 1 giờ. Vui lòng thử lại sau.'
    case 'nothing_to_confirm': return 'Tài khoản chưa có email để xác nhận.'
    case 'disabled': return 'Tính năng đang tạm tắt.'
    case 'no_session':
    case 'staff_inactive': return 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.'
    case 'not_installed': return 'Tính năng đang được cập nhật, vui lòng thử lại sau.'
    default: return 'Không lưu được email, vui lòng thử lại.'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function errorOf<T>(raw: Record<string, unknown>): EmailPromptResult<T> {
  const code = (EMAIL_PROMPT_ERROR_CODES as readonly string[]).includes(String(raw.code))
    ? raw.code as EmailPromptErrorCode
    : 'unavailable'
  const suggestion = text(raw.suggestion)
  return { ok: false, code, message: emailPromptErrorMessage(code), ...(suggestion ? { suggestion } : {}) }
}

const UNAVAILABLE = { ok: false as const, code: 'unavailable' as const, message: emailPromptErrorMessage('unavailable') }

/** Đọc kết quả lệnh `state` của RPC. */
export function parseEmailPromptState(raw: unknown): EmailPromptResult<EmailPromptState> {
  if (!isObject(raw)) return UNAVAILABLE
  if (raw.ok !== true) return errorOf(raw)
  const show = raw.show === 'enter' || raw.show === 'confirm' ? raw.show : 'none'
  return {
    ok: true,
    data: {
      enabled: raw.enabled !== false,
      show,
      reason: text(raw.reason) ?? '',
      chip: raw.chip === true,
      username: text(raw.username),
      isAdmin: raw.isAdmin === true,
      email: show === 'confirm' ? text(raw.email) : null
    }
  }
}

/** Đọc kết quả lệnh `save`. */
export function parseEmailPromptSave(raw: unknown): EmailPromptResult<EmailPromptSaveResult> {
  if (!isObject(raw)) return UNAVAILABLE
  if (raw.ok !== true) return errorOf(raw)
  if (raw.enabled === false) return errorOf({ code: 'disabled' })
  const email = text(raw.email)
  if (!email || raw.saved !== true) return UNAVAILABLE
  return { ok: true, data: { email, isAdmin: raw.isAdmin === true, verified: raw.verified === true } }
}

/** Đọc kết quả lệnh `profile`. */
export function parseEmailPromptProfile(raw: unknown): EmailPromptResult<EmailPromptProfile> {
  if (!isObject(raw)) return UNAVAILABLE
  if (raw.ok !== true) return errorOf(raw)
  const list = Array.isArray(raw.emailList) ? raw.emailList.filter((item): item is string => typeof item === 'string') : []
  return {
    ok: true,
    data: {
      enabled: raw.enabled !== false,
      email: text(raw.email),
      emailList: list,
      isAdmin: raw.isAdmin === true,
      verified: raw.verified === true
    }
  }
}

/** Đọc kết quả lệnh `dismiss`. */
export function parseEmailPromptDismiss(raw: unknown): EmailPromptResult<{ dismissed: true }> {
  if (!isObject(raw)) return UNAVAILABLE
  if (raw.ok !== true) return errorOf(raw)
  if (raw.enabled === false) return errorOf({ code: 'disabled' })
  return { ok: true, data: { dismissed: true } }
}

// ------------------------------------------------------------------ Kiểm email phía giao diện (DB kiểm lại)

/** Cùng biểu thức với DB (`private.aka_staff_email_usable`). */
const EMAIL_PATTERN = /^[a-z0-9_%+'-]+(\.[a-z0-9_%+'-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

/** Tên miền gõ nhầm -> tên miền đúng ('' = tên miền mẫu, coi như sai). Cùng danh sách với DB. */
export const EMAIL_TYPO_DOMAINS: Readonly<Record<string, string>> = {
  'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com',
  'gmail.vn': 'gmail.com', 'gmail.com.vn': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gmal.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gmsil.com': 'gmail.com', 'gmial.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.comm': 'gmail.com',
  'yahoo.con': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'hotmail.con': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'outlook.con': 'outlook.com', 'icloud.con': 'icloud.com',
  'example.com': '', 'test.com': ''
}

/** Nút chọn nhanh khi khách mới gõ phần trước `@`. */
export const EMAIL_QUICK_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com'] as const

export function normalizeEmail(value: string): string {
  return String(value ?? '').trim().toLowerCase()
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value)
  if (email.length < 6 || email.length > 254 || !EMAIL_PATTERN.test(email)) return false
  return EMAIL_TYPO_DOMAINS[email.split('@')[1] ?? ''] !== ''
}

/** Email đúng nếu tên miền là tên miền gõ nhầm quen thuộc (vd `an@gmial.com` -> `an@gmail.com`); không thì null. */
export function suggestEmailFix(value: string): string | null {
  const email = normalizeEmail(value)
  const at = email.indexOf('@')
  if (at <= 0) return null
  const fix = EMAIL_TYPO_DOMAINS[email.slice(at + 1)]
  return fix ? `${email.slice(0, at)}@${fix}` : null
}

/** Các gợi ý `phần-trước-@` + tên miền khi khách chưa gõ tên miền; rỗng khi đã gõ tên miền. */
export function emailQuickCompletions(value: string): string[] {
  const email = normalizeEmail(value)
  const at = email.indexOf('@')
  const local = at >= 0 ? email.slice(0, at) : email
  if (!local || (at >= 0 && email.length > at + 1)) return []
  return EMAIL_QUICK_DOMAINS.map(domain => `${local}@${domain}`)
}

// ------------------------------------------------------------------ Câu chữ (dùng chung Web / iOS / Desktop)

export const EMAIL_PROMPT_TEXTS = {
  eyebrow: 'BẢO VỆ TÀI KHOẢN',
  title: 'Giữ tài khoản luôn trong tầm tay',
  confirmTitle: 'Bạn vẫn dùng email này chứ?',
  inputLabel: 'Email của bạn',
  inputPlaceholder: 'ten@congty.vn',
  save: 'Lưu email',
  confirm: 'Đúng, tôi đang dùng email này',
  changeEmail: 'Đổi sang email khác',
  fixTypo: 'Sửa giúp',
  keepTypo: 'Giữ nguyên',
  trust: 'Email chỉ dùng cho tài khoản và thông báo của phần mềm. Đổi được bất cứ lúc nào trong Thông tin tài khoản.',
  chip: 'Thêm email',
  savedTitle: 'Đã lưu email',
  savedNext: 'Vào làm việc',
  savedFootnote: 'Gõ nhầm? Đổi email trong Thông tin tài khoản.',
  close: 'Đóng'
} as const

export function emailPromptSubtitle(username: string | null): string {
  return username
    ? `Tài khoản ${username} chưa có email. Thêm ngay, chỉ mất 10 giây.`
    : 'Tài khoản của bạn chưa có email. Thêm ngay, chỉ mất 10 giây.'
}

export function emailPromptTypoQuestion(suggestion: string): string {
  return `Có phải bạn muốn nhập ${suggestion}?`
}

export function emailPromptSavedMessage(email: string, verified: boolean): string {
  return verified
    ? `Thông tin tài khoản sẽ gửi về ${email}.`
    : `Thông tin tài khoản sẽ gửi về ${email}. Chúng tôi vừa gửi một thư xác nhận, bạn mở hộp thư và bấm Xác nhận nhé.`
}

export const EMAIL_PROMPT_BENEFITS = [
  { key: 'recover', title: 'Quên mật khẩu, lấy lại trong 1 phút', detail: 'Thông tin đăng nhập gửi về đúng email này.' },
  { key: 'installer', title: 'Nhận bản cài và link đăng nhập', detail: 'Cài phần mềm trên máy mới, không phải chờ hỗ trợ.' },
  { key: 'account', title: 'Lưu sẵn thông tin tài khoản', detail: 'Tên đăng nhập, gói đang dùng và hạn sử dụng luôn có trong hộp thư.' },
  { key: 'report', title: 'Báo cáo chiến dịch mỗi sáng', detail: 'Gửi lúc 07:00, tắt được bất cứ lúc nào trong Cài đặt chung.' }
] as const

/** Ngày VN (YYYY-MM-DD) để app biết đã sang ngày mới mà hỏi lại trạng thái (Desktop mở liền nhiều ngày). */
export function emailPromptDayKey(nowMs: number = Date.now()): string {
  return new Date(nowMs + 7 * 3_600_000).toISOString().slice(0, 10)
}
