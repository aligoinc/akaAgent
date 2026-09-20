/** Pure browser/Node/Deno contract shared by Desktop preview and the cloud worker. */
import { normalizeVietnamMobilePhone } from './phone.ts'

export const SHEET_MAX_BYTES = 10 * 1024 * 1024
export const SHEET_MAX_ROWS = 10_000
export const SHEET_SYNC_IPC = 'data-group:external-sync'

export const SHEET_DATA_TYPES = [
  { code: 'phone', label: 'Số điện thoại', field: 'phone', fieldLabel: 'Số điện thoại', contactType: 'phone', platform: null },
  { code: 'email', label: 'Email', field: 'email', fieldLabel: 'Email', contactType: 'email', platform: 'email' },
  { code: 'facebook_search_keyword', label: 'Facebook · Từ khóa tìm kiếm', field: 'uid', fieldLabel: 'Từ khóa', contactType: 'campaign_input', platform: 'facebook' },
  { code: 'facebook_post_url', label: 'Facebook · Link bài viết', field: 'url', fieldLabel: 'Link bài viết Facebook', contactType: 'campaign_input', platform: 'facebook' },
  { code: 'facebook_person', label: 'Facebook · User', field: 'uid', fieldLabel: 'UID / link Facebook', contactType: 'person', platform: 'facebook' },
  { code: 'facebook_group', label: 'Facebook · Group', field: 'uid', fieldLabel: 'UID / link group Facebook', contactType: 'group', platform: 'facebook' },
  { code: 'facebook_page', label: 'Facebook · Page', field: 'uid', fieldLabel: 'UID / link Page Facebook', contactType: 'page', platform: 'facebook' },
  { code: 'zalo_person', label: 'Zalo · User theo UID', field: 'uid', fieldLabel: 'UID Zalo', contactType: 'person', platform: 'zalo' },
  { code: 'zalo_group', label: 'Zalo · Group/link', field: 'url', fieldLabel: 'Link nhóm Zalo', contactType: 'group', platform: 'zalo' }
] as const
export type SheetDataType = typeof SHEET_DATA_TYPES[number]['code']
export type SheetField = 'uid' | 'url' | 'name' | 'phone' | 'email' | 'info1' | 'info2' | 'info3' | 'info4' | 'info5'
export interface SheetColumnMapping { column: number; field: SheetField }
export interface GoogleSheetConfig {
  url: string
  dataTypeCode: SheetDataType
  hasHeader: boolean
  mapping: SheetColumnMapping[]
  /** All headers are captured on connection. A moved/renamed column must be rechecked. */
  expectedHeaders: string[]
}
export interface GoogleSheetDocument {
  url: string
  headers: string[]
  rows: string[][]
}
export interface GoogleSheetInspection {
  url: string
  headers: string[]
  sample: string[][]
  rowCount: number
}
export interface GoogleSheetMappedRows {
  rows: Array<Record<string, string | null>>
  rowCount: number
  invalidCount: number
  errors: Array<{ row: number; message: string }>
}
export interface GoogleSheetPreview {
  rowCount: number
  newCount: number
  duplicateCount: number
  invalidCount: number
  sample: Array<Record<string, string | null>>
  errors: Array<{ row: number; message: string }>
}
export interface DataGroupExternalSyncSource {
  id: number
  groupId: number
  name: string
  config: GoogleSheetConfig
  everyHours: number
  endDate: string | null
  isEnabled: boolean
  revision: number
  status: 'pending' | 'running' | 'paused' | 'success' | 'retry' | 'error' | 'expired'
  nextRunAt: string | null
  lastRunAt: string | null
  lastError: string | null
  rowCount: number
  addedCount: number
  lastAddedCount: number
}
export interface DataGroupExternalSyncRun {
  id: number
  sourceId: number
  sourceName: string
  status: string
  startedAt: string
  finishedAt: string | null
  rowCount: number
  addedCount: number
  duplicateCount: number
  invalidCount: number
  error: string | null
}
export interface SaveDataGroupExternalSyncSource {
  groupId: number
  id?: number
  expectedRevision?: number
  requestId: string
  name: string
  config: GoogleSheetConfig
  everyHours: number
  endDate: string | null
  isEnabled: boolean
}
export interface DataGroupExternalSyncPanel {
  sources: DataGroupExternalSyncSource[]
  runs: DataGroupExternalSyncRun[]
}
export interface DataGroupExternalSyncApi {
  list: (groupId: number) => Promise<DataGroupExternalSyncPanel>
  inspect: (groupId: number, url: string, hasHeader: boolean) => Promise<GoogleSheetInspection>
  preview: (groupId: number, config: GoogleSheetConfig, sourceId?: number) => Promise<GoogleSheetPreview>
  save: (input: SaveDataGroupExternalSyncSource) => Promise<DataGroupExternalSyncSource>
  toggle: (groupId: number, id: number, expectedRevision: number, enabled: boolean) => Promise<void>
  remove: (groupId: number, id: number, expectedRevision: number) => Promise<void>
}

export class GoogleSheetError extends Error {
  constructor(message: string, readonly permanent = true) { super(message); this.name = 'GoogleSheetError' }
}

export function googleSheetUrl(raw: unknown): { url: string; downloadUrl: string } {
  try {
    if (typeof raw !== 'string' || raw.length > 4096) throw new Error()
    const url = new URL(raw.trim())
    const id = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1]
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password || !id) throw new Error()
    const gid = url.searchParams.get('gid') ?? new URLSearchParams(url.hash.slice(1)).get('gid') ?? ''
    if (gid && !/^\d{1,20}$/.test(gid)) throw new Error()
    return {
      url: `https://docs.google.com/spreadsheets/d/${id}/edit${gid ? `#gid=${gid}` : ''}`,
      downloadUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`
    }
  } catch { throw new GoogleSheetError('Vui lòng nhập link https://docs.google.com/spreadsheets/d/… hợp lệ.') }
}

/** RFC 4180, preserving strings (including leading zeroes and long identifiers). */
export function parseSheetCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false, closed = false
  const pushCell = () => {
    row.push(cell); cell = ''; closed = false
    if (row.length > 512) throw new GoogleSheetError('Sheet có quá nhiều cột (tối đa 512 cột).')
  }
  const pushRow = () => {
    pushCell(); rows.push(row); row = []
    if (rows.length > SHEET_MAX_ROWS + 1) throw new GoogleSheetError('Sheet vượt giới hạn 10.000 dòng dữ liệu.')
  }
  csv = csv.replace(/^\uFEFF/, '')
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true }
      } else cell += c
    } else if (c === ',') pushCell()
    else if (c === '\n' || c === '\r') { if (c === '\r' && csv[i + 1] === '\n') i++; pushRow() }
    else if (c === '"' && cell === '' && !closed) quoted = true
    else if (closed || c === '"') throw new GoogleSheetError('Dữ liệu CSV không hợp lệ.')
    else cell += c
  }
  if (quoted) throw new GoogleSheetError('Dữ liệu CSV thiếu dấu đóng ngoặc kép.')
  if (cell || row.length || closed) pushRow()
  return rows
}

export async function readGoogleSheet(raw: string, hasHeader: boolean, fetcher: typeof fetch = fetch): Promise<GoogleSheetDocument> {
  const target = googleSheetUrl(raw)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    let next = target.downloadUrl, response: Response | undefined
    for (let redirects = 0; redirects <= 3; redirects++) {
      const u = new URL(next)
      if (u.protocol !== 'https:' || u.port || u.username || u.password ||
        !(u.hostname === 'docs.google.com' || u.hostname.endsWith('.googleusercontent.com'))) {
        throw new GoogleSheetError('Sheet yêu cầu đăng nhập. Hãy bật “Bất kỳ ai có đường liên kết”.')
      }
      response = await fetcher(next, { redirect: 'manual', signal: controller.signal })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location || redirects === 3) throw new GoogleSheetError('Không thể đọc đường dẫn chuyển tiếp của Google Sheet.')
        next = new URL(location, next).href
      } else break
    }
    if (!response?.ok) {
      await response?.body?.cancel()
      throw new GoogleSheetError(`Không đọc được Sheet (HTTP ${response?.status}). Kiểm tra link, tab và quyền chia sẻ.`, !response || ![408, 429].includes(response.status) && response.status < 500)
    }
    if (response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel()
      throw new GoogleSheetError('Sheet chưa cho phép đọc qua link hoặc tab không tồn tại.')
    }
    if (Number(response.headers.get('content-length')) > SHEET_MAX_BYTES) {
      await response.body?.cancel(); throw new GoogleSheetError('Sheet vượt giới hạn 10 MiB.')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new GoogleSheetError('Không nhận được dữ liệu Sheet.', false)
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let size = 0, text = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > SHEET_MAX_BYTES) throw new GoogleSheetError('Sheet vượt giới hạn 10 MiB.')
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    if (/^\s*<(?:!doctype|html)/i.test(text)) throw new GoogleSheetError('Sheet chưa cho phép đọc qua link.')
    const parsed = parseSheetCsv(text)
    const headers = hasHeader ? (parsed.shift() || []).map(s => s.trim()) : []
    if (parsed.length > SHEET_MAX_ROWS) throw new GoogleSheetError('Sheet vượt giới hạn 10.000 dòng dữ liệu.')
    const width = Math.max(headers.length, ...parsed.map(row => row.length), 0)
    return { url: target.url, headers: hasHeader ? headers : Array.from({ length: width }, () => ''), rows: parsed }
  } catch (error) {
    if (error instanceof GoogleSheetError) throw error
    throw new GoogleSheetError(controller.signal.aborted ? 'Đọc Sheet quá 30 giây. Hệ thống sẽ thử lại.' : 'Không thể kết nối Google Sheet. Vui lòng thử lại.', false)
  } finally { clearTimeout(timeout) }
}

export function validateSheetConfig(config: GoogleSheetConfig): void {
  googleSheetUrl(config?.url)
  const type = SHEET_DATA_TYPES.find(t => t.code === config?.dataTypeCode)
  const fields = new Set<string>(['uid', 'url', 'name', 'phone', 'email', 'info1', 'info2', 'info3', 'info4', 'info5'])
  if (!type || typeof config.hasHeader !== 'boolean' || !Array.isArray(config.expectedHeaders) || config.expectedHeaders.length > 512 ||
    !config.expectedHeaders.every(h => typeof h === 'string' && h.length <= 2000) || !Array.isArray(config.mapping) || !config.mapping.length || config.mapping.length > 10) {
    throw new GoogleSheetError('Cấu hình ghép cột không hợp lệ.')
  }
  const used = new Set<string>()
  for (const map of config.mapping) {
    if (!Number.isInteger(map.column) || map.column < 0 || map.column >= config.expectedHeaders.length || !fields.has(map.field) || used.has(map.field)) {
      throw new GoogleSheetError('Mỗi trường chỉ được ghép một lần và phải trỏ tới cột đã đọc từ Sheet.')
    }
    used.add(map.field)
  }
  if (!used.has(type.field)) throw new GoogleSheetError(`Vui lòng ghép cột ${type.fieldLabel}.`)
}

export function mapGoogleSheet(document: GoogleSheetDocument, config: GoogleSheetConfig): GoogleSheetMappedRows {
  validateSheetConfig(config)
  if (document.headers.length !== config.expectedHeaders.length || document.headers.some((h, i) => h !== config.expectedHeaders[i])) {
    throw new GoogleSheetError('Cột của Sheet đã thay đổi. Hãy kết nối và ghép cột lại rồi lưu nguồn.')
  }
  const type = SHEET_DATA_TYPES.find(t => t.code === config.dataTypeCode)!
  const rows: GoogleSheetMappedRows['rows'] = [], errors: GoogleSheetMappedRows['errors'] = []
  let invalidCount = 0
  document.rows.forEach((cells, i) => {
    const row: Record<string, string | null> = { contact_type: type.contactType, flatform_type: type.platform }
    config.mapping.forEach(map => { row[map.field] = cells[map.column]?.trim() || null })
    let reason = !row[type.field] ? `Thiếu ${type.fieldLabel}.` : ''
    if (Object.values(row).some(v => v && v.length > 10_000)) reason = 'Giá trị trong ô quá dài.'
    if (!reason && type.code === 'zalo_person' && !/^\d+$/.test(row.uid!)) reason = 'UID Zalo phải gồm các chữ số.'
    if (!reason && type.code === 'email') {
      row.email = row.email!.toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || row.email.length > 254) reason = 'Email không hợp lệ.'
    }
    // The authoritative canonical key and duplicate check are evaluated in SQL.
    if (!reason && type.code === 'phone') {
      row.phone = normalizeVietnamMobilePhone(row.phone)
      if (!row.phone) reason = 'Số điện thoại Việt Nam không hợp lệ.'
    }
    if (!reason && type.code === 'zalo_group') {
      const match = row.url!.match(/^(?:https?:\/\/)?(?:www\.)?(?:zalo\.me\/g\/|zaloapp\.com\/qr\/g\/)([a-zA-Z0-9_-]+)(?:[/?#].*)?$/)
      if (!match) reason = 'Link nhóm Zalo không hợp lệ.'
      else row.url = `https://zalo.me/g/${match[1]}`
    }
    if (!reason && type.code.startsWith('facebook_') && type.code !== 'facebook_search_keyword') {
      const field = type.field, value = row[field]!
      if (!/^\d+$/.test(value)) {
        try {
          const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
          if (!['facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'fb.com', 'www.fb.com'].includes(url.hostname) || url.username || url.password || url.port || !['https:', 'http:'].includes(url.protocol) || url.pathname === '/') throw new Error()
          if (type.code === 'facebook_group' && !/^\/groups\/[^/]+/.test(url.pathname)) throw new Error()
          url.hostname = 'www.facebook.com'; url.protocol = 'https:'; url.hash = ''
          const identityParams = ['id', 'story_fbid', 'fbid']
          if (type.code === 'facebook_post_url') {
            // These query parameters identify content, not tracking. Normalize
            // group permalinks before stripping the query; preserve video IDs.
            if (url.searchParams.has('multi_permalinks')) {
              const group = url.pathname.match(/^\/groups\/([^/]+)(?:\/|$)/)?.[1]
              const post = url.searchParams.get('multi_permalinks') || ''
              if (!group || !/^[A-Za-z0-9_-]+$/.test(post) || url.searchParams.getAll('multi_permalinks').length !== 1) throw new Error()
              url.pathname = `/groups/${group}/posts/${post}`; url.search = ''
            }
            if (/^\/(?:watch(?:\/live)?\/?|video\.php)$/.test(url.pathname)) {
              if (!/^[A-Za-z0-9_-]+$/.test(url.searchParams.get('v') || '') || url.searchParams.getAll('v').length !== 1) throw new Error()
            }
            if (/^\/groups\/[^/]+\/?$/.test(url.pathname)) throw new Error()
            identityParams.push('v')
          }
          for (const key of Array.from(url.searchParams.keys())) if (!identityParams.includes(key)) url.searchParams.delete(key)
          row[field] = url.href.replace(/\/$/, '')
        } catch { reason = `${type.fieldLabel} không hợp lệ.` }
      } else if (type.code === 'facebook_post_url') reason = 'Vui lòng dùng link bài viết Facebook.'
    }
    if (reason) { invalidCount++; if (errors.length < 100) errors.push({ row: i + (config.hasHeader ? 2 : 1), message: reason }) }
    else rows.push(row)
  })
  return { rows, rowCount: document.rows.length, invalidCount, errors }
}

export function sheetColumnName(index: number): string {
  let result = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result
  return result
}
