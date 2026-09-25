/** Public Facebook login contracts. Never return stored secrets in progress/metadata. */
export const FACEBOOK_LOGIN_IPC = {
  preview: 'facebook-login:preview', start: 'facebook-login:start', stop: 'facebook-login:stop',
  state: 'facebook-login:state', progress: 'facebook-login:progress',
  restore: 'facebook-login:restore', login: 'facebook-login:login', metadata: 'facebook-login:metadata', save: 'facebook-login:save'
} as const
export const FACEBOOK_IMPORT_LIMIT_KEY = 'facebook.account_import.max_accounts_per_batch'
export interface FacebookLoginInput { uid: string; password?: string; twoFactorSecret?: string; cookie?: string }
export interface FacebookImportInput { text?: string; rows?: FacebookLoginInput[]; accountGroupId?: number | null; proxyId?: number | null }
export type FacebookRowStatus = 'invalid' | 'skipped' | 'ready' | 'running' | 'success' | 'failed' | 'cancelled'
export interface FacebookImportRow { index: number; uid: string; status: FacebookRowStatus; message: string; name?: string; accountId?: number }
export interface FacebookImportState { id: string; running: boolean; limit: number; rows: FacebookImportRow[] }
export interface FacebookLoginMetadata { uid: string | null; revision: number; hasPassword: boolean; hasTwoFactor: boolean; hasCookie: boolean }
export interface FacebookCredentialUpdate { uid: string; password?: string; twoFactorSecret?: string; revision: number }
export interface FacebookCookie {
  name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean;
  expirationDate?: number; sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'; hostOnly?: boolean
}
export interface FacebookSecret { uid: string; password?: string; twoFactorSecret?: string; cookies: FacebookCookie[] }
export interface FacebookSessionObservation {
  state: 'authenticated' | 'logged_out' | 'challenge' | 'unknown'; uid?: string; name?: string; message?: string
}
export const isFacebookHost = (host: string): boolean => host === 'facebook.com' || host.endsWith('.facebook.com')
export function normalizeFacebookUid(value: unknown): string {
  const uid = String(value ?? '').trim()
  if (!/^\d{5,24}$/.test(uid)) throw new Error('UID phải là chuỗi số; kiểm tra định dạng Text trong Excel.')
  return uid
}
export function normalizeTwoFactorSecret(value: unknown): string {
  const secret = String(value ?? '').replace(/\s/g, '').toUpperCase().replace(/=+$/, '')
  if (secret && (!/^[A-Z2-7]+$/.test(secret) || secret.length < 16 || secret.length > 256)) {
    throw new Error('Khóa 2FA không hợp lệ. Nhập khóa gốc, không nhập mã OTP sáu số.')
  }
  return secret
}
export function parseFacebookCookie(raw: string, uid: string): FacebookCookie[] {
  if (!raw.trim()) return []
  const cookies: FacebookCookie[] = []
  for (const part of raw.split(';')) {
    if (!part.trim()) continue
    const at = part.indexOf('=')
    if (at <= 0) throw new Error('Cookie phải có dạng name=value; name=value.')
    const name = part.slice(0, at).trim(), value = part.slice(at + 1).trim()
    if (!/^[\w-]+$/.test(name) || /[\r\n\u0000]/.test(value)) throw new Error('Cookie không hợp lệ.')
    if (cookies.some(cookie => cookie.name === name)) throw new Error('Cookie bị trùng tên.')
    cookies.push({ name, value, domain: '.facebook.com', path: '/', secure: true, httpOnly: name === 'xs' })
  }
  if (cookies.find(cookie => cookie.name === 'c_user')?.value !== uid) throw new Error('UID trong cookie không khớp UID nhập vào.')
  return cookies
}
export function validateFacebookInput(input: FacebookLoginInput): FacebookLoginInput {
  const uid = normalizeFacebookUid(input.uid)
  const password = String(input.password ?? '')
  const twoFactorSecret = normalizeTwoFactorSecret(input.twoFactorSecret)
  const cookie = String(input.cookie ?? '').trim()
  if (password.length > 1024 || cookie.length > 65536) throw new Error('Thông tin đăng nhập vượt kích thước cho phép.')
  if (!password && !cookie) throw new Error('Cần password hoặc cookie để đăng nhập.')
  if (cookie) parseFacebookCookie(cookie, uid)
  return { uid, password, twoFactorSecret, cookie }
}
export function parseFacebookText(text: string): FacebookLoginInput[] {
  if (text.length > 2_000_000) throw new Error('Nội dung nhập quá lớn.')
  const records: string[] = []
  for (const line of text.split(/\r?\n/).filter(line => line.trim())) {
    // Cookies/passwords can contain spaces. Split whitespace only for unambiguous compact triples.
    const tokens = line.trim().split(/\s+/)
    if (tokens.length > 1 && tokens.every(token => /^\d+\|[^|\s]+\|[A-Za-z2-7=]+$/.test(token))) records.push(...tokens)
    else records.push(line.trim())
  }
  if (records.length > 5000) throw new Error('Danh sách nhập quá lớn. Hãy chia nhỏ file.')
  return records.map(record => {
    const parts = record.split('|')
    if (parts.length === 2 && parts[1].includes('c_user=')) return { uid: parts[0], cookie: parts[1] }
    if (parts.length < 3 || parts.length > 4) return { uid: '', password: '' }
    return { uid: parts[0], password: parts[1], twoFactorSecret: parts[2], cookie: parts[3] }
  })
}
