import { getCampaignInputDataRequirement, isValidEmailInputDataValue } from './types'
import type { CampaignImportDataRow, CampaignImportPlatform } from './types'
import { getVietnamMobileCarrier, normalizeVietnamMobilePhone } from './phone'
import { isZaloUidImportAction, normalizeZaloImportUid } from './zaloUidImport'

export const IMPORT_MAX_ROWS = 10_000
export const IMPORT_LIMIT_MESSAGE = 'Mỗi lần chỉ được nhập tối đa 10.000 dòng dữ liệu. Vui lòng chia nhỏ dữ liệu rồi thử lại.'
export const IMPORT_FIELDS = ['name', 'uid', 'phone', 'email', 'info1', 'info2', 'info3', 'info4', 'info5'] as const
export type ImportField = typeof IMPORT_FIELDS[number]
export type ImportSourceKind = 'textbox' | 'image' | 'sheet' | 'akabizTemplate' | 'excel'
export type ImportPhonePolicy = 'discard' | 'first' | 'all'
export type ImportResultGroup = 'valid' | 'rejected' | 'duplicates'
export type ImportValue = string | number | boolean | null
export interface ImportCell { value: ImportValue; text: string; error?: string }
export interface ImportTable { name: string; rows: ImportCell[][]; rowNumbers: number[] }
export interface ImportTableSource { tables: ImportTable[] }
export type ImportColumnMap = Partial<Record<ImportField, number>>
export interface ImportRowLocation { source: string; sheet: string; row: number; item: number }
export interface ImportSourceRow {
  data: Partial<Record<ImportField, ImportValue>>
  display?: Partial<Record<ImportField, string>>
  /** Excel error cells must not become blank rows or literal recipient identifiers. */
  errors?: Partial<Record<ImportField, string>>
  /** Evidence for nonempty AI records whose recipient field is missing/unrecognized. */
  rawRecord?: string
  location: ImportRowLocation
}
export interface ImportImageSource { rows: ImportSourceRow[] }
export interface ImportVerificationEntry {
  id: number
  location: ImportRowLocation
  original: CampaignImportDataRow
  row: CampaignImportDataRow
  originalValue: string
  displayValue: string
  normalizedValue: string
  reason: string
  duplicateOf?: ImportRowLocation
}
export interface ImportVerificationResult {
  valid: ImportVerificationEntry[]
  rejected: ImportVerificationEntry[]
  duplicates: ImportVerificationEntry[]
  sourceRowCount: number
  itemCount: number
  limitExceeded: boolean
}
export interface ImportVerificationOptions {
  platform: CampaignImportPlatform
  actionId: string
  kind: ImportSourceKind
  phonePolicy?: ImportPhonePolicy
}

export const importText = (value: unknown): string => value == null ? '' : String(value).trim()
export const importTargetField = (platform: CampaignImportPlatform, actionId: string): 'phone' | 'uid' | 'email' => {
  if (actionId === 'zalo_add_group_member') return 'phone'
  if (actionId === 'data_group_zalo_person_uid') return 'uid'
  const field = getCampaignInputDataRequirement(actionId)?.field
  if (field === 'phone' || field === 'uid' || field === 'email') return field
  return platform === 'zalo' || platform === 'sms' ? 'phone' : platform === 'email' ? 'email' : 'uid'
}

/** Expand only digits present in the source; never round a long identifier through Number. */
function exactScientificInteger(text: string): { value: string; reason: string } | null {
  const scientific = text.match(/^([+-]?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i)
  if (!scientific) return null
  const digits = scientific[2] + (scientific[3] || '')
  const shift = Number(scientific[4]) - (scientific[3]?.length || 0)
  if (!Number.isSafeInteger(shift) || shift > 0) {
    return { value: '', reason: 'Số dạng khoa học có thể thiếu chữ số. Vui lòng nhập số đầy đủ.' }
  }
  if (scientific[1] === '-' || -shift >= digits.length || (shift < 0 && !/^0+$/.test(digits.slice(shift)))) {
    return { value: '', reason: 'Số dạng khoa học không phải số nguyên không âm.' }
  }
  const integer = shift < 0 ? digits.slice(0, shift) : digits
  // These zeros belong to the mantissa, not to a text identifier supplied as digits.
  return { value: integer.replace(/^0+(?=\d)/, ''), reason: '' }
}

/** Import-only adapter. Runtime, SQL, and background Sheet sync keep their current normalizer. */
export function normalizeImportPhone(raw: unknown): { value: string; reason: string } {
  const invalid = { value: '', reason: 'Số điện thoại Việt Nam không hợp lệ.' }
  if (typeof raw === 'number' && (!Number.isSafeInteger(raw) || raw < 0)) return invalid
  let text = importText(raw).replace(/^'/, '').trim()
  if (!text) return { value: '', reason: 'Thiếu số điện thoại.' }
  const scientific = exactScientificInteger(text)
  if (scientific) {
    if (!scientific.value) return scientific
    text = scientific.value
  } else if (/^[+-]?\d+(?:\.\d+)?e/i.test(text)) {
    return invalid
  }
  if (/^\+?\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, '')
  // Labels outside the phone are harmless; words between numeric groups are not a phone.
  const numericSpan = text.match(/\d[\s\S]*\d/)?.[0] || text
  if (/[^\d\s().+\-\u200b-\u200d\ufeff]/.test(numericSpan)) return invalid
  let digits = text.replace(/\D+/g, '')
  if (/^840\d{9}$/.test(digits)) digits = digits.slice(2)
  else if (/^084\d{9}$/.test(digits)) digits = `0${digits.slice(3)}`
  const value = normalizeVietnamMobilePhone(digits)
  return value ? { value, reason: '' } : invalid
}

export const normalizeImportGroupLink = (value: unknown): string => {
  const raw = importText(value)
  if (!raw) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = url.hostname.replace(/^www\./i, '').toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    const code = (host === 'zalo.me' || host.endsWith('.zalo.me')) && parts[0]?.toLowerCase() === 'g'
      ? parts[1]
      : (host === 'zaloapp.com' || host.endsWith('.zaloapp.com')) && parts[0]?.toLowerCase() === 'qr' && parts[1]?.toLowerCase() === 'g'
        ? parts[2] : ''
    return code ? `https://zalo.me/g/${code}` : ''
  } catch { return '' }
}

const normalizeUid = (value: unknown): { value: string; reason: string } => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    return { value: '', reason: 'UID dạng số không còn đủ độ chính xác. Vui lòng nhập UID đầy đủ dạng text.' }
  }
  const text = importText(value).replace(/\s+/g, '').replace(/\/+$/, '')
  const scientific = exactScientificInteger(text)
  if (scientific) return scientific
  return { value: ['uid', 'url', 'link', 'group', 'profile', 'facebook', 'facebookuid'].includes(text.toLowerCase()) ? '' : text, reason: '' }
}
const keyword = (value: unknown): string => {
  const text = importText(value).replace(/\s+/g, ' ')
  return ['keyword', 'keywords', 'tu khoa', 'từ khóa', 'search', 'tìm kiếm'].includes(text.toLowerCase()) ? '' : text
}
const isBlankRow = (row: ImportCell[]) => row.every(cell => !importText(cell.value) && !cell.text.trim())
export const importHeader = (value: unknown): string => importText(value).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '')
const ALIASES: Record<ImportField, string[]> = {
  name: ['ten', 'hoten', 'tenkh', 'tenkhachhang', 'fullname', 'name'],
  uid: ['uid', 'url', 'link', 'userid', 'groupid', 'profile', 'facebookuid'],
  phone: ['sdt', 'phone', 'mobile', 'sodienthoai', 'dienthoai', 'phonenumber'],
  email: ['email', 'emailaddress', 'mail'],
  info1: ['info1'], info2: ['info2'], info3: ['info3'], info4: ['info4'], info5: ['info5']
}
const targetAliases = (actionId: string, field: ImportField): string[] => actionId === 'facebook_find_data_search'
  ? ['keyword', 'keywords', 'tukhoa', 'search', 'timkiem']
  : actionId === 'zalo_join_group_link' || actionId === 'facebook_join_group'
    ? [...ALIASES[field], 'group', 'grouplink', 'groupurl', 'linkgroup', 'linknhom', 'linkgroupzalo'] : ALIASES[field]

/** Shared header vocabulary for CSV structure detection; does not choose or skip data columns. */
export function importHeaderField(value: unknown): ImportField | undefined {
  const label = importHeader(value)
  return IMPORT_FIELDS.find(field => ALIASES[field].includes(label))
    ?? (targetAliases('facebook_find_data_search', 'uid').includes(label)
      || targetAliases('zalo_join_group_link', 'uid').includes(label) ? 'uid' : undefined)
}

export function hasImportTextHeader(text: string, platform: CampaignImportPlatform, actionId: string): boolean {
  const firstLine = text.replace(/\r\n?/g, '\n').split('\n')[0]
  return targetAliases(actionId, importTargetField(platform, actionId)).includes(importHeader(firstLine))
}

export function detectImportColumns(table: ImportTable, platform: CampaignImportPlatform, actionId: string): { mapping: ImportColumnMap; hasHeader: boolean } {
  const target = importTargetField(platform, actionId)
  const header = (table.rows[0] || []).map(cell => importHeader(cell.text))
  const hasHeader = header.some(label => targetAliases(actionId, target).includes(label))
  const mapping: ImportColumnMap = {}
  if (hasHeader) {
    for (const field of IMPORT_FIELDS) {
      const aliases = field === target ? targetAliases(actionId, field) : ALIASES[field]
      const indexes = header.flatMap((label, index) => aliases.includes(label) ? [index] : [])
      if (indexes.length === 1) mapping[field] = indexes[0]
    }
  } else {
    const width = table.rows.reduce((max, row) => Math.max(max, row.length), 0)
    const scores = Array.from({ length: width }, (_, index) => table.rows.slice(0, 10).filter(row => {
      if (row[index]?.error) return false
      const value = row[index]?.value
      if (target === 'phone') return importText(value).split(/[,;]/).some(part => normalizeImportPhone(part).value)
      if (target === 'email') return isValidEmailInputDataValue(importText(value).toLowerCase())
      if (isZaloUidImportAction(actionId) || actionId === 'data_group_zalo_person_uid') return !!normalizeZaloImportUid(value)
      if (actionId === 'zalo_join_group_link') return !!normalizeImportGroupLink(value)
      return !!importText(value) && (actionId === 'facebook_find_data_search' || !/\s/.test(importText(value)))
    }).length)
    const best = Math.max(0, ...scores)
    if (best > 0 && scores.filter(score => score === best).length === 1) mapping[target] = scores.indexOf(best)
  }
  return { mapping, hasHeader }
}

export function templateImportSchema(table: ImportTable): { headerIndex: number; mapping: ImportColumnMap } | null {
  for (let index = 0; index < Math.min(20, table.rows.length); index++) {
    const row = table.rows[index]
    if (IMPORT_FIELDS.every((field, col) => ALIASES[field].includes(importHeader(row[col]?.text)))) {
      return { headerIndex: index, mapping: Object.fromEntries(IMPORT_FIELDS.map((field, col) => [field, col])) }
    }
  }
  return null
}

export function mapImportTable(table: ImportTable, mapping: ImportColumnMap, startIndex: number, source: string): ImportSourceRow[] {
  const result: ImportSourceRow[] = []
  for (let index = startIndex; index < table.rows.length; index++) {
    const cells = table.rows[index]
    if (isBlankRow(cells)) continue
    const data: ImportSourceRow['data'] = {}, display: ImportSourceRow['display'] = {}, errors: ImportSourceRow['errors'] = {}
    for (const field of IMPORT_FIELDS) {
      const column = mapping[field]
      if (column === undefined) continue
      const cell = cells[column]
      data[field] = field === 'phone' || field === 'uid' ? cell?.value ?? '' : cell?.text ?? ''
      display[field] = cell?.text ?? ''
      if (cell?.error) errors[field] = cell.error
    }
    result.push({ data, display, errors, location: { source, sheet: table.name, row: table.rowNumbers[index] ?? index + 1, item: 1 } })
    if (result.length > IMPORT_MAX_ROWS) throw new Error(IMPORT_LIMIT_MESSAGE)
  }
  return result
}

export function textImportRows(text: string, platform: CampaignImportPlatform, actionId: string, source: string,
  skipHeader = hasImportTextHeader(text, platform, actionId)): ImportSourceRow[] {
  const target = importTargetField(platform, actionId)
  return text.replace(/\r\n?/g, '\n').split('\n').flatMap((line, row) => (skipHeader && row === 0 ? [] : line.split(target === 'phone' ? /[,;]/ : /,/))
    .map(part => part.trim()).filter(Boolean).map((value, item) => ({
      data: { [target]: value }, location: { source, sheet: '', row: row + 1, item: item + 1 }
    })))
}

export function imageImportRows(rows: unknown[], platform: CampaignImportPlatform, actionId: string): ImportSourceRow[] {
  const first = (...values: unknown[]): ImportValue => {
    const value = values.find(value => importText(value))
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : value == null ? '' : JSON.stringify(value)
  }
  const target = importTargetField(platform, actionId)
  return rows.flatMap((value, index) => {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { value }
    // Match the legacy action-specific alias order without normalizing or dropping rows here.
    const uid = actionId === 'zalo_join_group_link'
      ? first(row.uid, row.url, row.link, row.groupLink, row.zaloGroupLink, row.zalo_group_link, row.value, row.name)
      : actionId === 'facebook_join_group'
        ? first(row.uid, row.url, row.link, row.group, row.groupLink, row.facebookGroupLink, row.facebook_group_link,
          row.group_id, row.groupId, row.value, row.name)
        : actionId === 'facebook_find_data_search'
          ? first(row.uid, row.keyword, row.keywords, row.search, row.query, row.tuKhoa, row['tu khoa'], row['từ khóa'], row.value, row.name)
          : first(row.uid, row.userId, row.user_id, row.url, row.link, row.groupLink, row.groupId, row.group_id,
            row.profileUrl, row.facebookUrl, target === 'uid' ? row.value : '')
    const data: ImportSourceRow['data'] = {
      name: first(row.name, row.fullname, row.fullName, row.ten, row.contactName),
      phone: first(row.phone, row.mobile, row.sdt, row.soDienThoai, target === 'phone' ? row.value : ''),
      uid,
      email: first(row.email, row.mail, target === 'email' ? row.value : '')
    }
    for (const key of IMPORT_FIELDS.filter(key => key.startsWith('info'))) data[key] = first(row[key], row[`I${key.slice(1)}`])
    return Object.values(row).some(value => importText(value))
      ? [{ data, rawRecord: JSON.stringify(value), location: { source: 'Ảnh (dữ liệu AI trả về)', sheet: '', row: index + 1, item: 1 } }] : []
  })
}

export function verifyImportRows(rows: ImportSourceRow[], options: ImportVerificationOptions): ImportVerificationResult {
  const { actionId, platform, kind } = options
  const target = importTargetField(platform, actionId)
  const sourceRowCount = new Set(rows.map(row => JSON.stringify([row.location.source, row.location.sheet, row.location.row]))).size
  if (sourceRowCount > IMPORT_MAX_ROWS) throw new Error(IMPORT_LIMIT_MESSAGE)
  const result: ImportVerificationResult = { valid: [], rejected: [], duplicates: [], sourceRowCount, itemCount: 0, limitExceeded: false }
  const seen = new Map<string, ImportVerificationEntry>()
  const tablePolicy = ['excel', 'akabizTemplate', 'sheet'].includes(kind) ? options.phonePolicy || 'first' : 'all'
  for (const source of rows) {
    const original = Object.fromEntries(IMPORT_FIELDS.map(field => [field, source.display?.[field] ?? importText(source.data[field])])) as CampaignImportDataRow
    let raw = source.data[target]
    let sourceField: ImportField = target
    if (!source.errors?.[target] && !importText(raw) && (actionId === 'facebook_join_group' || actionId === 'facebook_find_data_search' || actionId === 'data_group_zalo_person_uid'
      || (kind === 'akabizTemplate' && ['zalo_join_group_link', 'facebook_comment_seeding_post', 'zalo_add_group_member'].includes(actionId)))) {
      raw = source.data.name
      sourceField = 'name'
    }
    const cellError = source.errors?.[sourceField]
    const parts: unknown[] = !cellError && target === 'phone' && typeof raw === 'string'
      ? raw.split(/[,;]/).map(part => part.trim()).filter(Boolean) : [raw]
    if (!parts.length) parts.push('')
    let tookFirst = false
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex]
      const row: CampaignImportDataRow = { ...original }
      let normalizedValue = '', reason = '', key = ''
      if (cellError) {
        reason = `Ô dữ liệu người nhận bị lỗi Excel ${cellError}. Vui lòng sửa ô nguồn rồi nhập lại.`
        row[target] = ''
      } else if (target === 'phone') {
        const phone = normalizeImportPhone(part)
        normalizedValue = phone.value
        reason = phone.reason
        row.phone = phone.value
        row.phoneCarrier = getVietnamMobileCarrier(phone.value) || null
        if (kind !== 'akabizTemplate' || actionId === 'zalo_add_group_member') { row.uid = ''; row.email = '' }
        if (actionId === 'zalo_add_group_member' && normalizeImportPhone(row.name).value === phone.value) row.name = ''
        if (parts.length > 1 && tablePolicy === 'discard') reason = 'Bị bỏ theo lựa chọn bỏ dòng có nhiều SĐT.'
        else if (phone.value && tablePolicy === 'first') {
          if (tookFirst) reason = 'Bị bỏ theo lựa chọn chỉ lấy số hợp lệ đầu tiên.'
          else tookFirst = true
        }
      } else if (target === 'email') {
        normalizedValue = importText(part).toLowerCase()
        if (!isValidEmailInputDataValue(normalizedValue)) { normalizedValue = ''; reason = 'Email không hợp lệ hoặc bị thiếu.' }
        row.email = normalizedValue
        if (kind !== 'akabizTemplate') { row.uid = ''; row.phone = '' }
      } else {
        if (isZaloUidImportAction(actionId) || actionId === 'data_group_zalo_person_uid') normalizedValue = normalizeZaloImportUid(part)
        else if (actionId === 'zalo_join_group_link') normalizedValue = normalizeImportGroupLink(part)
        else if (actionId === 'facebook_find_data_search') normalizedValue = keyword(part)
        else {
          const uid = normalizeUid(part)
          normalizedValue = uid.value
          reason = uid.reason
        }
        if (!normalizedValue && !reason) reason = `${getCampaignInputDataRequirement(actionId)?.label || 'UID'} không hợp lệ hoặc bị thiếu.`
        row.uid = normalizedValue
        if (kind !== 'akabizTemplate' || isZaloUidImportAction(actionId) || ['data_group_zalo_person_uid', 'zalo_join_group_link', 'facebook_join_group', 'facebook_find_data_search', 'facebook_comment_seeding_post'].includes(actionId)) { row.phone = ''; row.email = '' }
        if (actionId === 'facebook_find_data_search' || (actionId === 'facebook_comment_seeding_post' && kind === 'akabizTemplate')) row.name = ''
        else if (['data_group_zalo_person_uid', 'zalo_join_group_link', 'facebook_join_group'].includes(actionId) && importText(row.name) === importText(part)) row.name = ''
      }
      key = actionId === 'facebook_find_data_search' || target === 'email' || kind === 'akabizTemplate' ? normalizedValue.toLowerCase() : normalizedValue
      const entry: ImportVerificationEntry = {
        id: ++result.itemCount,
        location: { ...source.location, item: parts.length > 1 ? partIndex + 1 : source.location.item },
        original: { ...original, [target]: importText(part) }, row,
        originalValue: importText(raw) || source.rawRecord || '', displayValue: source.display?.[target] ?? importText(raw), normalizedValue, reason
      }
      if (reason || !key) result.rejected.push(entry)
      else if (seen.has(key)) {
        entry.reason = 'Trùng dữ liệu sau chuẩn hóa trong lần upload này.'
        entry.duplicateOf = seen.get(key)!.location
        result.duplicates.push(entry)
      } else { seen.set(key, entry); result.valid.push(entry) }
    }
  }
  result.limitExceeded = result.valid.length > IMPORT_MAX_ROWS
  return result
}

export function importLocationLabel(location: ImportRowLocation): string {
  return `${location.source}${location.sheet ? ` · ${location.sheet}` : ''} · dòng ${location.row}${location.item > 1 ? ` · mục ${location.item}` : ''}`
}

export function importExportMatrix(report: ImportVerificationResult, group: ImportResultGroup): string[][] {
  return [
    ['Fullname', 'Uid', 'Mobile', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5', 'Nguồn', 'Sheet', 'Dòng gốc', 'Mục trong dòng', 'Giá trị gốc', 'Giá trị hiển thị ban đầu', 'Giá trị chuẩn hóa', ...(group === 'valid' ? [] : ['Lý do']), ...(group === 'duplicates' ? ['Trùng với dòng'] : [])],
    ...report[group].map(entry => [
      ...IMPORT_FIELDS.map(field => importText((group === 'valid' ? entry.row : entry.original)[field])),
      entry.location.source, entry.location.sheet, String(entry.location.row), String(entry.location.item), entry.originalValue, entry.displayValue, entry.normalizedValue,
      ...(group === 'valid' ? [] : [entry.reason]), ...(group === 'duplicates' ? [entry.duplicateOf ? importLocationLabel(entry.duplicateOf) : ''] : [])
    ])
  ]
}
