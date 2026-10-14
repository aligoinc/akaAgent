export const WEB_ENRICHMENT_IPC = 'facebook:web-enrichment'
export const WEB_ENRICHMENT_STATE = 'facebook:web-enrichment-state'
export const WEB_ENRICHMENT_WORKFLOW = 'fb_web_enrichment'
export const WEB_ENRICHMENT_DEFAULT_TIME = '12:00'
export interface WebEnrichmentConfig {
  version: 1
  revision: number
  industry: string
  keywords: string[]
  websites: string[]
  hobbies: string[]
  minutesPerSession: number
  slots: string[]
  stopDate: string | null
}
export interface WebEnrichmentSettings { enabled: boolean; config: WebEnrichmentConfig }
export interface WebEnrichmentState { accountId: number; runId: string }
export const emptyWebEnrichmentConfig = (now = Date.now()): WebEnrichmentConfig => ({
  version: 1, revision: 0, industry: '', keywords: [], websites: [], hobbies: [],
  minutesPerSession: 30, slots: [],
  // Vietnam is UTC+7 with no DST; use its calendar date seven days from now.
  stopDate: new Date(now + (7 * 24 + 7) * 60 * 60 * 1000).toISOString().slice(0, 10)
})
export const WEB_ENRICHMENT_NOTE = 'Hệ thống tự động search Google và lướt web theo thông tin bạn cung cấp. Mỗi khung giờ cho phép bắt đầu tối đa một phiên trong 30 phút kể từ mốc đó. Khi app đang mở, tài khoản rảnh thì chạy; nếu đang chạy chiến dịch, hệ thống chờ lượt hiện tại hoàn tất. Hết cửa sổ mà chưa bắt đầu thì bỏ lượt, không chạy bù. Phiên đã bắt đầu tiếp tục theo thời lượng đã cài đặt.'
export const WEB_ENRICHMENT_OVERLAP = '⚠️ Các phiên có thể trùng nhau. Khung giờ đến khi phiên trước vẫn đang lướt sẽ được bỏ qua, không chạy bù. Bạn có thể giãn các khung giờ hoặc giảm thời lượng mỗi phiên.'

export function normalizeWebUrl(value: string): string {
  const text = value.trim()
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(text) && !/^[a-z\d.-]+:\d+(?:[/?#]|$)/i.test(text)
  const url = new URL(hasScheme ? text : `https://${text}`)
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password
    || /\s/.test(text)) throw new Error('Website phải là URL HTTP(S) hợp lệ, không chứa thông tin đăng nhập.')
  url.hash = ''
  return url.href
}
export function validateWebEnrichment(value: unknown, { allowLegacyFiveWebsites = false }: {
  allowLegacyFiveWebsites?: boolean
} = {}): WebEnrichmentSettings {
  const fail = (message: string): never => { throw new Error(message) }
  if (!value || typeof value !== 'object') return fail('Cấu hình không hợp lệ.')
  const s = value as WebEnrichmentSettings, c = s.config
  if (typeof s.enabled !== 'boolean' || !c || c.version !== 1 || !Number.isSafeInteger(c.revision) || c.revision < 0)
    return fail('Phiên bản cấu hình không hợp lệ. Hãy tải lại.')
  const list = (input: unknown, max: number, caseSensitive = false): string[] => {
    if (!Array.isArray(input) || input.length > max || input.some(x => typeof x !== 'string' || x.length > 2048))
      return fail('Danh sách không hợp lệ hoặc quá dài.')
    return Array.from(new Map(input.map(x => [caseSensitive ? x.trim() : x.trim().toLocaleLowerCase('vi'), x.trim()])).values()).filter(Boolean)
  }
  if (typeof c.industry !== 'string' || c.industry.length > 8000) return fail('Mô tả tối đa 8.000 ký tự.')
  const config: WebEnrichmentConfig = { version: 1, revision: c.revision, industry: c.industry.trim(),
    keywords: list(c.keywords, 200), websites: list(c.websites, 5, true), hobbies: list(c.hobbies, 100),
    minutesPerSession: Number.isFinite(c.minutesPerSession) ? c.minutesPerSession : 30,
    slots: list(c.slots, 48).sort(), stopDate: typeof c.stopDate === 'string' && c.stopDate ? c.stopDate : null }
  // Disabled drafts may be incomplete, but are still bounded, typed JSON.
  if (!s.enabled) return { enabled: false, config }
  if (!config.industry) return fail('Vui lòng mô tả lĩnh vực khách hàng.')
  if (config.keywords.length < 3) return fail('Cần ít nhất 3 từ khóa khác nhau.')
  try { config.websites = config.websites.map(normalizeWebUrl) } catch { return fail('Vui lòng nhập website HTTP(S) hợp lệ.') }
  // Only the runtime may keep using an already-saved five-site configuration.
  const websiteCount = allowLegacyFiveWebsites && config.revision > 0 && config.websites.length === 5 ? 5 : 3
  if (config.websites.length !== websiteCount || new Set(config.websites).size !== websiteCount)
    return fail('Cần đúng 3 website khác nhau.')
  if (!Number.isInteger(c.minutesPerSession) || c.minutesPerSession < 5 || c.minutesPerSession > 240 || c.minutesPerSession % 5)
    return fail('Thời lượng từ 5–240 phút, bước 5 phút.')
  if (!config.slots.length || config.slots.some(x => !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)))
    return fail('Cần ít nhất một khung giờ HH:mm hợp lệ.')
  if (config.stopDate && (!/^\d{4}-\d{2}-\d{2}$/.test(config.stopDate) || !Number.isFinite(Date.parse(config.stopDate))
    || new Date(config.stopDate).toISOString().slice(0, 10) !== config.stopDate)) return fail('Ngày dừng không hợp lệ.')
  return { enabled: true, config }
}
export function hasWebEnrichmentOverlap(slots: string[], minutes: number): boolean {
  const values = Array.from(new Set(slots)).sort().map(x => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)))
  return values.some((value, i) => i > 0 && value - values[i - 1] < minutes + 30)
}
