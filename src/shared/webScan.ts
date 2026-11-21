// Quét data từ website (batdongsan, Trang Vàng, nhatot): hợp đồng dùng chung cho main, renderer và bài kiểm.
// Phương án: docs/WEB_DATA_SCAN_PLAN.md. Mã chiến dịch / mã thao tác / khoá cài đặt phải khớp migration của tính năng.

export const WEB_ACCOUNT_PLATFORM = 'web'
export const WEB_SCAN_SETTING_KEY = 'web_scan.campaigns'

export type WebScanSite = 'nhatot' | 'batdongsan' | 'yellowpages'
export const WEB_SCAN_SITES: readonly WebScanSite[] = ['nhatot', 'batdongsan', 'yellowpages']

export const WEB_FIND_DATA_ACTION_IDS: Readonly<Record<WebScanSite, string>> = {
  nhatot: 'web_find_data_nhatot',
  batdongsan: 'web_find_data_batdongsan',
  yellowpages: 'web_find_data_yellowpages'
}

/** Mã thao tác tính hạn mức (auto_account_actions.code): mỗi lần hiện SĐT / mở trang là một lượt. */
export const WEB_SCAN_ACTION_CODES: Readonly<Record<WebScanSite, string>> = {
  nhatot: 'web_nhatot_phone',
  batdongsan: 'web_batdongsan_phone',
  yellowpages: 'web_yellowpages_page'
}

export const WEB_SCAN_ACTION_NAMES: Readonly<Record<WebScanSite, string>> = {
  nhatot: 'Hiện SĐT Nhà Tốt',
  batdongsan: 'Hiện SĐT Batdongsan',
  yellowpages: 'Mở trang Trang Vàng'
}

export const WEB_SCAN_SITE_LABELS: Readonly<Record<WebScanSite, string>> = {
  nhatot: 'nhatot',
  batdongsan: 'batdongsan',
  yellowpages: 'Trang Vàng'
}

/** Mặc định anh chốt 21/11/2026: chung cả ba trang. Trần thật nằm ở DB (setting `limits`). */
export const WEB_SCAN_DEFAULT_LIMITS = {
  defaultDaily: 100,
  maxDaily: 500,
  defaultSleepSeconds: 15,
  minSleepSeconds: 10
} as const

export type WebScanLimits = {
  defaultDaily: number
  maxDaily: number
  defaultSleepSeconds: number
  minSleepSeconds: number
}

export type WebScanSetting = {
  /** null = mọi tổ chức. */
  organizationIds: number[] | null
  limits: WebScanLimits
}

const WEB_ID_TO_SITE = new Map<string, WebScanSite>(
  WEB_SCAN_SITES.map(site => [WEB_FIND_DATA_ACTION_IDS[site], site])
)
const WEB_CODE_TO_SITE = new Map<string, WebScanSite>(
  WEB_SCAN_SITES.map(site => [WEB_SCAN_ACTION_CODES[site], site])
)

export function isWebFindDataAction(actionId: string | null | undefined): boolean {
  return WEB_ID_TO_SITE.has(String(actionId || ''))
}

export function getWebScanSite(actionId: string | null | undefined): WebScanSite | null {
  return WEB_ID_TO_SITE.get(String(actionId || '')) || null
}

export function getWebScanSiteByActionCode(code: string | null | undefined): WebScanSite | null {
  return WEB_CODE_TO_SITE.get(String(code || '')) || null
}

export function isWebScanActionCode(code: string | null | undefined): boolean {
  return WEB_CODE_TO_SITE.has(String(code || ''))
}

export function isWebAccountPlatform(platform: string | null | undefined): boolean {
  return String(platform || '').trim().toLowerCase() === WEB_ACCOUNT_PLATFORM
}

function positiveInt(value: unknown, fallback: number, min = 1, max = 100000): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  const v = Math.floor(n)
  if (v < min || v > max) return fallback
  return v
}

/** Đọc dòng auto_system_settings `web_scan.campaigns`. Sai / thiếu = không tổ chức nào. */
export function parseWebScanSetting(raw: unknown): WebScanSetting {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { value = null }
  }
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  let organizationIds: number[] | null = []
  if (obj.mode === 'all') {
    organizationIds = null
  } else if (Array.isArray(obj.organizationIds)) {
    organizationIds = obj.organizationIds
      .map(item => Number(item))
      .filter(item => Number.isInteger(item) && item > 0)
  }
  const l = obj.limits && typeof obj.limits === 'object' ? obj.limits as Record<string, unknown> : {}
  const maxDaily = positiveInt(l.maxDaily, WEB_SCAN_DEFAULT_LIMITS.maxDaily)
  const minSleepSeconds = positiveInt(l.minSleepSeconds, WEB_SCAN_DEFAULT_LIMITS.minSleepSeconds, 0, 3600)
  return {
    organizationIds,
    limits: {
      maxDaily,
      defaultDaily: Math.min(positiveInt(l.defaultDaily, WEB_SCAN_DEFAULT_LIMITS.defaultDaily), maxDaily),
      minSleepSeconds,
      defaultSleepSeconds: Math.max(positiveInt(l.defaultSleepSeconds, WEB_SCAN_DEFAULT_LIMITS.defaultSleepSeconds, 0, 3600), minSleepSeconds)
    }
  }
}

export function webScanCoversOrganization(setting: WebScanSetting, organizationId: number | null | undefined): boolean {
  if (!organizationId || organizationId <= 0) return false
  if (setting.organizationIds === null) return true
  return setting.organizationIds.includes(organizationId)
}

export function clampWebScanSleepSeconds(value: unknown, limits: WebScanLimits = WEB_SCAN_DEFAULT_LIMITS): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return limits.defaultSleepSeconds
  return Math.max(Math.floor(n), limits.minSleepSeconds)
}

export function clampWebScanDailyLimit(value: unknown, limits: WebScanLimits = WEB_SCAN_DEFAULT_LIMITS): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return limits.defaultDaily
  return Math.min(Math.floor(n), limits.maxDaily)
}

// ---------------------------------------------------------------------------
// Trường lấy thêm

export type WebScanFieldGroup = 'list' | 'detail'

export type WebScanField = {
  key: string
  label: string
  /** list: có sẵn khi đọc danh sách / trang tin đã mở để hiện SĐT; detail: phải bật "mở trang chi tiết". */
  group: WebScanFieldGroup
  defaultSelected: boolean
}

/** Trường luôn lấy (không có ô chọn); vẫn chọn được vào Info1–5. */
export const WEB_SCAN_ALWAYS_FIELDS: Readonly<Record<WebScanSite, WebScanField[]>> = {
  nhatot: [
    { key: 'link', label: 'Link tin', group: 'list', defaultSelected: true },
    { key: 'listingId', label: 'Mã tin', group: 'list', defaultSelected: true },
    { key: 'section', label: 'Mua bán / Cho thuê', group: 'list', defaultSelected: true }
  ],
  batdongsan: [
    { key: 'link', label: 'Link tin', group: 'list', defaultSelected: true },
    { key: 'listingId', label: 'Mã tin', group: 'list', defaultSelected: true },
    { key: 'section', label: 'Bán / Cho thuê', group: 'list', defaultSelected: true }
  ],
  yellowpages: [
    { key: 'link', label: 'Link hồ sơ', group: 'list', defaultSelected: true }
  ]
}

export const WEB_SCAN_FIELDS: Readonly<Record<WebScanSite, WebScanField[]>> = {
  nhatot: [
    { key: 'address', label: 'Địa chỉ đầy đủ', group: 'list', defaultSelected: true },
    { key: 'posterType', label: 'Cá nhân / Môi giới', group: 'list', defaultSelected: true },
    { key: 'title', label: 'Tiêu đề tin', group: 'list', defaultSelected: true },
    { key: 'price', label: 'Giá', group: 'list', defaultSelected: true },
    { key: 'area', label: 'Diện tích', group: 'list', defaultSelected: true },
    { key: 'propertyType', label: 'Loại bất động sản', group: 'list', defaultSelected: true },
    { key: 'postedAt', label: 'Ngày đăng', group: 'list', defaultSelected: true },
    { key: 'rooms', label: 'Phòng ngủ · toilet · số tầng', group: 'list', defaultSelected: true },
    { key: 'pricePerM2', label: 'Giá/m²', group: 'list', defaultSelected: true },
    { key: 'project', label: 'Dự án', group: 'list', defaultSelected: true },
    { key: 'dimensions', label: 'Ngang × dài', group: 'list', defaultSelected: false },
    { key: 'direction', label: 'Hướng', group: 'list', defaultSelected: false },
    { key: 'legal', label: 'Pháp lý', group: 'list', defaultSelected: false },
    { key: 'furniture', label: 'Nội thất', group: 'list', defaultSelected: false },
    { key: 'description', label: 'Mô tả tin', group: 'list', defaultSelected: false },
    { key: 'coordinates', label: 'Toạ độ (vĩ độ, kinh độ)', group: 'list', defaultSelected: false }
  ],
  batdongsan: [
    { key: 'title', label: 'Tiêu đề tin', group: 'list', defaultSelected: true },
    { key: 'price', label: 'Giá', group: 'list', defaultSelected: true },
    { key: 'area', label: 'Diện tích', group: 'list', defaultSelected: true },
    { key: 'province', label: 'Tỉnh / thành', group: 'list', defaultSelected: true },
    { key: 'postedAt', label: 'Ngày đăng', group: 'list', defaultSelected: true },
    { key: 'rooms', label: 'Phòng ngủ · WC', group: 'list', defaultSelected: true },
    { key: 'pricePerM2', label: 'Giá/m²', group: 'list', defaultSelected: true },
    { key: 'listingTier', label: 'Loại tin (VIP…)', group: 'list', defaultSelected: false },
    { key: 'description', label: 'Mô tả ngắn', group: 'list', defaultSelected: false },
    { key: 'address', label: 'Địa chỉ đầy đủ', group: 'detail', defaultSelected: true },
    { key: 'frontage', label: 'Mặt tiền · đường vào', group: 'detail', defaultSelected: false },
    { key: 'floors', label: 'Số tầng', group: 'detail', defaultSelected: false },
    { key: 'direction', label: 'Hướng nhà · ban công', group: 'detail', defaultSelected: false },
    { key: 'legal', label: 'Pháp lý', group: 'detail', defaultSelected: false },
    { key: 'furniture', label: 'Nội thất', group: 'detail', defaultSelected: false },
    { key: 'expiresAt', label: 'Ngày hết hạn tin', group: 'detail', defaultSelected: false },
    { key: 'project', label: 'Dự án', group: 'detail', defaultSelected: false }
  ],
  yellowpages: [
    { key: 'address', label: 'Địa chỉ', group: 'list', defaultSelected: true },
    { key: 'email', label: 'Email', group: 'list', defaultSelected: true },
    { key: 'website', label: 'Website', group: 'list', defaultSelected: true },
    { key: 'industry', label: 'Ngành (theo từ khoá / link đang quét)', group: 'list', defaultSelected: true },
    { key: 'verified', label: 'Nhãn Xác thực', group: 'list', defaultSelected: true },
    { key: 'description', label: 'Mô tả ngắn', group: 'list', defaultSelected: false },
    { key: 'taxCode', label: 'Mã số thuế', group: 'detail', defaultSelected: true },
    { key: 'taxAddress', label: 'Địa chỉ theo MST', group: 'detail', defaultSelected: false },
    { key: 'hotline', label: 'Hotline', group: 'detail', defaultSelected: false },
    { key: 'businessType', label: 'Loại hình (sản xuất / dịch vụ…)', group: 'detail', defaultSelected: false },
    { key: 'market', label: 'Thị trường', group: 'detail', defaultSelected: false },
    { key: 'mainCustomers', label: 'Khách hàng chính', group: 'detail', defaultSelected: false },
    { key: 'businessLines', label: 'Ngành nghề kinh doanh', group: 'detail', defaultSelected: false },
    { key: 'products', label: 'Sản phẩm dịch vụ', group: 'detail', defaultSelected: false }
  ]
}

export type WebScanInfoKey = 'info1' | 'info2' | 'info3' | 'info4' | 'info5'
export const WEB_SCAN_INFO_KEYS: readonly WebScanInfoKey[] = ['info1', 'info2', 'info3', 'info4', 'info5']
export type WebScanInfoMap = Partial<Record<WebScanInfoKey, string | null>>

export const WEB_SCAN_DEFAULT_INFO_MAP: Readonly<Record<WebScanSite, WebScanInfoMap>> = {
  nhatot: { info1: 'address', info2: 'price', info3: 'area', info4: 'propertyType', info5: 'title' },
  batdongsan: { info1: 'province', info2: 'price', info3: 'area', info4: 'title', info5: 'postedAt' },
  yellowpages: { info1: 'address', info2: 'email', info3: 'website', info4: 'industry', info5: 'link' }
}

/** Trường của trang (luôn lấy + chọn được), theo thứ tự hiển thị. */
export function getWebScanFieldCatalog(site: WebScanSite): WebScanField[] {
  return [...WEB_SCAN_ALWAYS_FIELDS[site], ...WEB_SCAN_FIELDS[site]]
}

export function getWebScanFieldLabel(site: WebScanSite, key: string): string {
  if (key === 'phone') return 'SĐT'
  if (key === 'name') return site === 'yellowpages' ? 'Tên doanh nghiệp' : 'Tên người đăng'
  return getWebScanFieldCatalog(site).find(field => field.key === key)?.label || key
}

// ---------------------------------------------------------------------------
// Cài đặt chiến dịch (auto_campaigns.extra_settings.webScan)

export type WebScanPoster = 'broker' | 'personal' | 'both'

export type WebScanCampaignSettings = {
  site: WebScanSite
  /** Trang Vàng: tỉnh / thành (tên theo Trang Vàng); rỗng = cả nước. */
  provinces: string[]
  /** Trang Vàng: link ngành / link tìm kiếm khách dán. */
  links: string[]
  /** Số trang tối đa mỗi lần tìm (một từ khoá × một mục, hoặc một link). */
  pagesPerSearch: number
  /** Số data tối đa mỗi lượt chạy (một từ khoá). */
  maxDataPerRun: number
  skipSeen: boolean
  /** nhatot: lấy SĐT của ai. */
  poster: WebScanPoster
  /** batdongsan / Trang Vàng: mở trang chi tiết để lấy trường nhóm detail. */
  openDetail: boolean
  fields: string[]
  infoMap: WebScanInfoMap
}

export function defaultWebScanCampaignSettings(site: WebScanSite): WebScanCampaignSettings {
  return {
    site,
    provinces: [],
    links: [],
    pagesPerSearch: site === 'yellowpages' ? 20 : site === 'nhatot' ? 10 : 5,
    maxDataPerRun: site === 'yellowpages' ? 1000 : 100,
    skipSeen: true,
    poster: 'broker',
    openDetail: false,
    fields: WEB_SCAN_FIELDS[site].filter(field => field.defaultSelected && field.group === 'list').map(field => field.key),
    infoMap: { ...WEB_SCAN_DEFAULT_INFO_MAP[site] }
  }
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim() : ''
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= max) break
  }
  return out
}

export function normalizeWebScanCampaignSettings(raw: unknown, site: WebScanSite): WebScanCampaignSettings {
  const base = defaultWebScanCampaignSettings(site)
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const catalog = new Set(getWebScanFieldCatalog(site).map(field => field.key))
  const fields = Array.isArray(obj.fields)
    ? stringList(obj.fields, 50).filter(key => catalog.has(key))
    : base.fields
  const infoMapRaw = obj.infoMap && typeof obj.infoMap === 'object' ? obj.infoMap as Record<string, unknown> : null
  const infoMap: WebScanInfoMap = {}
  for (const infoKey of WEB_SCAN_INFO_KEYS) {
    const value = infoMapRaw ? infoMapRaw[infoKey] : base.infoMap[infoKey]
    infoMap[infoKey] = typeof value === 'string' && (catalog.has(value) || value === 'phone' || value === 'name') ? value : null
  }
  const poster = obj.poster === 'personal' || obj.poster === 'both' ? obj.poster : 'broker'
  return {
    site,
    provinces: site === 'yellowpages' ? stringList(obj.provinces, 70) : [],
    links: site === 'yellowpages' ? stringList(obj.links, 200).filter(isYellowPagesListingLink) : [],
    pagesPerSearch: positiveInt(obj.pagesPerSearch, base.pagesPerSearch, 1, 500),
    maxDataPerRun: positiveInt(obj.maxDataPerRun, base.maxDataPerRun, 1, 10000),
    skipSeen: obj.skipSeen !== false,
    poster: site === 'nhatot' ? poster : 'both',
    openDetail: site === 'nhatot' ? false : obj.openDetail === true,
    fields,
    infoMap
  }
}

/** Link Trang Vàng dán được: trang ngành `/cls/…`, trang tìm kiếm `/srch/…` hoặc `search.asp`. */
export function isYellowPagesListingLink(value: string): boolean {
  let url: URL
  try { url = new URL(value.trim()) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  if (host !== 'yellowpages.vn') return false
  return /^\/(cls|srch)\//i.test(url.pathname) || /^\/search\.asp$/i.test(url.pathname)
}

/** Từ khoá nhập ở form: mỗi dòng một từ khoá, bỏ trống và trùng (không phân biệt hoa thường). */
export function parseWebScanKeywords(text: string, max = 500): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of String(text || '').split(/\r?\n/)) {
    const keyword = line.replace(/\s+/g, ' ').trim()
    if (!keyword) continue
    const key = keyword.toLocaleLowerCase('vi')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(keyword.slice(0, 200))
    if (out.length >= max) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Kết quả một lượt (block trả về, Desktop ghi vào dòng "Tìm data")

export type WebScanSection = 'sale' | 'rent'

export type WebScanRecord = {
  site: WebScanSite
  phone: string
  name: string
  email?: string
  listingKey: string
  link: string
  section?: WebScanSection
  /** Mọi trường đọc được (đã lọc theo trường khách chọn khi ghi lịch sử / đẩy Nhóm data). */
  fields: Record<string, string>
  /** Số lấy lại từ tin đã hiện trong tổ chức (không bấm hiện số lần nữa). */
  reused?: boolean
}

/** Một lần dùng hạn mức (hiện SĐT / mở trang): mỗi lần là một dòng Lịch sử hành động. */
export type WebScanUse = {
  listingKey: string
  link: string
  title?: string
  phone?: string
  /** Trang Vàng: số doanh nghiệp đọc được trên trang vừa mở. */
  itemCount?: number
  at?: string
}

export const WEB_SCAN_STOP_REASONS = [
  'done', 'max_pages', 'max_data', 'quota', 'all_seen', 'login_required', 'challenge', 'layout_changed', 'no_result', 'error'
] as const
export type WebScanStopReason = typeof WEB_SCAN_STOP_REASONS[number]

// ---------------------------------------------------------------------------
// SĐT

/** Chuẩn hoá SĐT di động Việt Nam về dạng 0xxxxxxxxx (10 số); số bàn / sai thì null. */
export function normalizeVietnamMobile(value: string | null | undefined): string | null {
  let digits = String(value || '').replace(/[^\d+]/g, '')
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3)
  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2)
  digits = digits.replace(/\D/g, '')
  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits
  if (!/^0[35789]\d{8}$/.test(digits)) return null
  return digits
}

/** Chuẩn hoá SĐT bất kỳ (kể cả số bàn) để so trùng; không phải số thì null. */
export function normalizeVietnamPhone(value: string | null | undefined): string | null {
  const mobile = normalizeVietnamMobile(value)
  if (mobile) return mobile
  let digits = String(value || '').replace(/[^\d+]/g, '')
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3)
  digits = digits.replace(/\D/g, '')
  if (/^0\d{9,10}$/.test(digits)) return digits
  return null
}

/** Giá trị Info1–5 của một bản ghi theo lựa chọn của chiến dịch. */
export function webScanInfoValues(record: WebScanRecord, infoMap: WebScanInfoMap): Partial<Record<WebScanInfoKey, string>> {
  const out: Partial<Record<WebScanInfoKey, string>> = {}
  for (const infoKey of WEB_SCAN_INFO_KEYS) {
    const fieldKey = infoMap[infoKey]
    if (!fieldKey) continue
    const value = fieldKey === 'phone' ? record.phone
      : fieldKey === 'name' ? record.name
        : fieldKey === 'link' ? record.link
          : record.fields[fieldKey]
    if (value && String(value).trim()) out[infoKey] = String(value).trim().slice(0, 1000)
  }
  return out
}

// ---------------------------------------------------------------------------
// Link tìm kiếm Trang Vàng

/** Đoạn đường dẫn Trang Vàng: chữ thường, khoảng trắng thành "_", giữ dấu (thử 21/11/2026: `/srch/bao_bì_nhựa.html` ra 893 doanh nghiệp). */
export function yellowPagesPathSegment(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi').replace(/ /g, '_').replace(/[/?#\\]/g, '')
}

/** Trang tìm theo từ khoá (cả nước) hoặc theo từ khoá + tỉnh của Trang Vàng. */
export function yellowPagesSearchUrl(keyword: string, province?: string | null): string {
  const kw = encodeURIComponent(yellowPagesPathSegment(keyword))
  const p = province ? yellowPagesPathSegment(province) : ''
  return p ? `https://www.yellowpages.vn/srch/${encodeURIComponent(p)}/${kw}.html` : `https://www.yellowpages.vn/srch/${kw}.html`
}

/** Bỏ trường khách không chọn; giữ trường luôn lấy và trường đang được chọn vào Info1–5. */
export function pickWebScanFields(site: WebScanSite, fields: Record<string, unknown>, settings: Pick<WebScanCampaignSettings, 'fields' | 'infoMap'>): Record<string, string> {
  const keep = new Set<string>([...WEB_SCAN_ALWAYS_FIELDS[site].map(field => field.key), ...settings.fields])
  for (const value of Object.values(settings.infoMap)) if (value) keep.add(value)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!keep.has(key)) continue
    const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
    if (text) out[key] = text.slice(0, 2000)
  }
  return out
}

/**
 * Tỉnh / thành của Trang Vàng, đúng chữ trang dùng trong link tìm theo tỉnh (đọc từ trang 21/11/2026; Trang Vàng vẫn theo 63 tỉnh cũ). Bắc Kạn,
 * Đắk Nông chưa thấy trên trang (không có kết quả ở các từ khoá đã thử) nên viết theo cùng kiểu.
 */
export const WEB_SCAN_YELLOWPAGES_PROVINCES: readonly string[] = [
  'Hà Nội', 'TP. Hồ Chí Minh (TPHCM)', 'Tp. Đà Nẵng', 'TP. Hải Phòng', 'TP. Cần Thơ',
  'An Giang', 'Bà Rịa-Vũng Tàu', 'Bạc Liêu', 'Bắc Giang', 'Bắc Kạn', 'Bắc Ninh', 'Bến Tre', 'Bình Dương', 'Bình Định', 'Bình Phước',
  'Bình Thuận', 'Cà Mau', 'Cao Bằng', 'Đắk Lắk', 'Đắk Nông', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Giang', 'Hà Nam',
  'Hà Tĩnh', 'Hải Dương', 'Hậu Giang', 'Hòa Bình', 'Hưng Yên', 'Khánh Hòa', 'Kiên Giang', 'Kon Tum', 'Lai Châu', 'Lâm Đồng', 'Lạng Sơn',
  'Lào Cai', 'Long An', 'Nam Định', 'Nghệ An', 'Ninh Bình', 'Ninh Thuận', 'Phú Thọ', 'Phú Yên', 'Quảng Bình', 'Quảng Nam', 'Quảng Ngãi',
  'Quảng Ninh', 'Quảng Trị', 'Sóc Trăng', 'Sơn La', 'Tây Ninh', 'Thái Bình', 'Thái Nguyên', 'Thanh Hóa', 'Thừa Thiên Huế', 'Tiền Giang',
  'Trà Vinh', 'Tuyên Quang', 'Vĩnh Long', 'Vĩnh Phúc', 'Yên Bái'
]
