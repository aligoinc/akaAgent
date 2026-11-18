/**
 * Thông tin quản trị viên của group Facebook tìm bằng search ("Tìm kiếm data bằng search" → "Lấy thông tin quản trị viên của group").
 *
 * Block `fb_collect_search_group_admins` (workflow engine của `facebook_find_data_search`) gắn vào mỗi phần tử `facebookGroups`:
 *   - `adminScan`: `listed` (đọc được danh sách), `not_listed` (group riêng tư chưa tham gia: Facebook không ghi vai trò từng người),
 *     `failed` (chưa đọc được trang);
 *   - `admins`: quản trị viên của group, mỗi người có tên, link trang cá nhân, UID, SĐT và email tách từ mục "Thông tin liên hệ", tên và
 *     dòng giới thiệu dưới tên.
 * Module này đọc payload không tin cậy (kết quả block, `auto_campaign_details.data`) và giữ quy tắc tách SĐT / email trùng với đoạn chạy trong
 * trang (scripts/facebook-search-groups/contact-extract.fragment.js; bài kiểm so hai bên). TypeScript thuần để dùng ở main, renderer và
 * chép sang WebApp. Hợp đồng: docs/FACEBOOK_SEARCH_GROUP_ADMINS.md.
 */

export type FacebookGroupAdminScan = 'listed' | 'not_listed' | 'failed'

export interface FacebookGroupAdmin {
  name: string
  /** `https://www.facebook.com/<tên riêng>` hoặc `https://www.facebook.com/profile.php?id=<uid>`. */
  url: string
  uid?: string
  /** Di động Việt Nam, dạng 0xxxxxxxxx, không trùng. */
  phones: string[]
  /** Chữ thường, không trùng. */
  emails: string[]
  /** Đã mở được trang cá nhân để đọc liên hệ chưa (chưa mở được thì SĐT / email chỉ lấy từ tên). */
  profileRead?: boolean
}

export interface FacebookGroupAdminFields {
  adminScan?: FacebookGroupAdminScan
  admins?: FacebookGroupAdmin[]
}

export const FACEBOOK_GROUP_ADMIN_MAX = 200
const CONTACT_MAX = 10
const SCANS = new Set<FacebookGroupAdminScan>(['listed', 'not_listed', 'failed'])
const PHONE_PATTERN = /(?<![\d+])(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}(?!\d)/g
const EMAIL_PATTERN = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/g

/** Số di động Việt Nam về dạng 0xxxxxxxxx; không phải thì trả chuỗi rỗng. */
export function normalizeVietnamMobile(value: unknown): string {
  let digits = String(value ?? '').replace(/[^\d+]/g, '')
  if (digits.startsWith('+84')) digits = `0${digits.slice(3)}`
  else if (digits.startsWith('84')) digits = `0${digits.slice(2)}`
  digits = digits.replace(/\D/g, '')
  return /^0[35789]\d{8}$/.test(digits) ? digits : ''
}

export function findVietnamMobiles(text: unknown): string[] {
  const matches = String(text ?? '').match(PHONE_PATTERN) ?? []
  return Array.from(new Set(matches.map(normalizeVietnamMobile).filter(Boolean)))
}

export function findEmails(text: unknown): string[] {
  const matches = String(text ?? '').match(EMAIL_PATTERN) ?? []
  return Array.from(new Set(matches.map(value => value.replace(/[.\-]+$/g, '').toLowerCase()).filter(value => /\.[a-z]{2,}$/.test(value))))
}

function cleanProfileUrl(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || !/^(?:www\.|m\.|web\.)?facebook\.com$/i.test(url.hostname)) return ''
    if (url.pathname === '/profile.php') {
      const id = url.searchParams.get('id') ?? ''
      return /^\d{1,30}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : ''
    }
    const segment = url.pathname.split('/').filter(Boolean)[0] ?? ''
    return /^[A-Za-z0-9.\-_]{1,100}$/.test(segment) ? `https://www.facebook.com/${segment}` : ''
  } catch {
    return ''
  }
}

function readAdmin(value: unknown): FacebookGroupAdmin | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const uid = /^\d{1,30}$/.test(String(source.uid ?? '').trim()) ? String(source.uid).trim() : ''
  const url = cleanProfileUrl(source.url) || (uid ? `https://www.facebook.com/profile.php?id=${uid}` : '')
  const name = String(source.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!url || (!name && !uid)) return null
  const phones = Array.from(new Set((Array.isArray(source.phones) ? source.phones : []).map(normalizeVietnamMobile).filter(Boolean))).slice(0, CONTACT_MAX)
  const emails = Array.from(new Set((Array.isArray(source.emails) ? source.emails : []).flatMap(item => findEmails(item)))).slice(0, CONTACT_MAX)
  return {
    name,
    url,
    ...(uid ? { uid } : {}),
    phones,
    emails,
    ...(typeof source.profileRead === 'boolean' ? { profileRead: source.profileRead } : {})
  }
}

/** Đọc `adminScan` / `admins` từ một phần tử `facebookGroups` không tin cậy; trường sai dạng thì bỏ, không đoán. */
export function readFacebookGroupAdminFields(value: unknown): FacebookGroupAdminFields {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  const scan = String(source.adminScan ?? '') as FacebookGroupAdminScan
  if (!SCANS.has(scan)) return {}
  const admins: FacebookGroupAdmin[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(source.admins) ? source.admins : []) {
    const admin = readAdmin(item)
    if (!admin) continue
    const key = (admin.uid || admin.url).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    admins.push(admin)
    if (admins.length >= FACEBOOK_GROUP_ADMIN_MAX) break
  }
  return { adminScan: scan, admins: scan === 'listed' ? admins : [] }
}

/** Chữ hiện ở cột "Quản trị viên" của một group (bảng Data tìm được và file Excel). Chưa quét thì chuỗi rỗng. */
export function describeFacebookGroupAdminScan(fields: FacebookGroupAdminFields): string {
  if (fields.adminScan === 'listed') return String(fields.admins?.length ?? 0)
  if (fields.adminScan === 'not_listed') return 'Facebook không hiện'
  if (fields.adminScan === 'failed') return 'Chưa đọc được'
  return ''
}

export interface FacebookGroupAdminTotals {
  /** Số group đã quét quản trị viên (có `adminScan`). */
  scanned: number
  /** Số group đọc được danh sách. */
  listed: number
  admins: number
  withPhone: number
  withEmail: number
}

/** Tổng hợp quản trị viên của một loạt group (đã qua `readFacebookGroupAdminFields`). */
export function summarizeFacebookGroupAdmins(groups: ReadonlyArray<FacebookGroupAdminFields>): FacebookGroupAdminTotals {
  const totals: FacebookGroupAdminTotals = { scanned: 0, listed: 0, admins: 0, withPhone: 0, withEmail: 0 }
  for (const group of groups) {
    if (!group.adminScan) continue
    totals.scanned += 1
    if (group.adminScan !== 'listed') continue
    totals.listed += 1
    for (const admin of group.admins ?? []) {
      totals.admins += 1
      if (admin.phones.length > 0) totals.withPhone += 1
      if (admin.emails.length > 0) totals.withEmail += 1
    }
  }
  return totals
}

/** Dòng thêm vào câu kết quả tìm data cho khách; chuỗi rỗng khi lượt này không quét quản trị viên của group nào. */
export function formatFacebookGroupAdminsLine(groups: ReadonlyArray<FacebookGroupAdminFields>): string {
  const totals = summarizeFacebookGroupAdmins(groups)
  if (totals.scanned === 0) return ''
  const contact = [
    totals.withPhone > 0 ? `${totals.withPhone} người có số điện thoại` : '',
    totals.withEmail > 0 ? `${totals.withEmail} người có email` : ''
  ].filter(Boolean).join(', ')
  return `Quản trị viên group: ${totals.admins} người của ${totals.listed}/${totals.scanned} group${contact ? ` (${contact})` : ''}`
}
