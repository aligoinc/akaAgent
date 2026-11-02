import { importHeaderField } from './campaignImportVerification'

/** Local import payloads never belong in an AI request or its history. */
export const AGENT_DATA_IPC = { store: 'campaign-agent:data-store', read: 'campaign-agent:data-read',
  cancel: 'campaign-agent:data-cancel' } as const
export const AGENT_DATA_MAX_FILES = 5
export const AGENT_DATA_MAX_BYTES = 10 * 1024 * 1024
export const AGENT_DATA_TOTAL_BYTES = 25 * 1024 * 1024
export const AGENT_DATA_IMAGE_TOTAL_BYTES = 15 * 1024 * 1024
export const AGENT_DATA_ACCEPT = '.xlsx,.xls,.csv,.txt,image/png,image/jpeg,image/webp'
export interface AgentDataFile { id: string; name: string; kind: 'text' | 'excel' | 'image'; bytes: number; legacyImage?: boolean }
export interface AgentDataUpload { name: string; mimeType: string; dataBase64: string }
export type AgentDataSource = { kind: 'text'; name: string; text: string } | { kind: 'file'; name: string; mimeType: string; dataBase64: string }
export interface AgentDataImport { files: AgentDataFile[]; mode: 'append' | 'replace'; actionId: string }
export const validAgentDataFiles = (value: unknown): value is AgentDataFile[] => Array.isArray(value)
  && value.length <= AGENT_DATA_MAX_FILES && value.every(f => f && typeof f === 'object'
    && typeof f.id === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(f.id)
    && typeof f.name === 'string' && f.name.length <= 200 && ['text', 'excel', 'image'].includes(f.kind)
    && Number.isSafeInteger(f.bytes) && f.bytes > 0 && f.bytes <= (f.kind === 'image' ? 5 * 1024 * 1024 : AGENT_DATA_MAX_BYTES)
    && (f.legacyImage === undefined || f.legacyImage === true && f.kind === 'image'))
  && value.reduce((n, f) => n + f.bytes, 0) <= AGENT_DATA_TOTAL_BYTES
  && value.reduce((n, f) => n + (f.kind === 'image' ? f.bytes : 0), 0) <= AGENT_DATA_IMAGE_TOTAL_BYTES
export const validAgentDataImport = (value: unknown): value is AgentDataImport => !!value && typeof value === 'object'
  && validAgentDataFiles((value as AgentDataImport).files) && ['append', 'replace'].includes((value as AgentDataImport).mode)
  && typeof (value as AgentDataImport).actionId === 'string'

const recipient = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?84(?:[ ().-]?\d){9,10}(?!\d)|0(?:[ ().-]?\d){9}(?!\d)|\b\d{7,20}\b/gi
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
const unprefixed = (value: string) => fold(value.trim()).replace(/^(?:(?:toi muon|toi can|hay|giup toi|vui long)\s+)+/, '')
const contentIntent = (value: string) => /^(?:(?:viet|soan|sua|viet lai|rut gon|them|doi|chen)\b.*\b(?:noi dung|email|tin nhan|bai viet|loi nhan)|(?:noi dung|content|tieu de|chu ky)\s*:)/.test(unprefixed(value))
const dataIntent = (value: string) => /^(?:(?:nhap|them|import|thay|thay the)\s+(?:danh sach|data|du lieu|nguoi nhan)|(?:danh sach|data|du lieu|nguoi nhan)\s*:)/.test(unprefixed(value))
const recipientIntent = (value: string) => /^(?:(?:gui|nhan)(?:\s+tin(?: nhan)?)?\s+(?:toi|den|cho)|(?:nhap|them)\s+(?:sdt|so dien thoai|email|uid)(?:\s+(?:vao danh sach|nguoi nhan))?)\s*:?\s*$/.test(unprefixed(value))
const separatorsOnly = (value: string) => /^[\s,;|()\[\]"'“”‘’•*:-]*$/.test(value)
const contentBoundary = (value: string) => /\b(?:noi dung|content|tin nhan)\s*:/.test(fold(value))
const recipientCell = new RegExp(`^(?:${recipient.source}|https?:\\/\\/\\S+)$`, 'i')
const csvInstruction = (value: string) => contentIntent(value) || dataIntent(value)
  || /^(?:ten chien dich|campaign name|email subject|tieu de email)\b/.test(unprefixed(value))
  || /^ten\s*:/.test(unprefixed(value))
  || /^(?:chay|gui|dat|chon|tao|doi|sua|bat|tat|xoa|bo|nghi)\s/.test(unprefixed(value))
  || /^khong\s+(?:gui|nhan|chay|ket ban|trung|lap|them|doi|dung)\b/.test(unprefixed(value))
  || /^(?:(?:vao|luc|tu|den)\s+(?:\d|sang\b|trua\b|chieu\b|toi\b|thu\b|ngay\b)|(?:hom nay|ngay mai|toi nay|sang mai|sau do)\b)/.test(unprefixed(value))
interface DelimitedRecord { start: number; end: number; cells: string[] }
/** Only recognize table boundaries here. Upload owns parsing, mapping and validation. */
function delimitedRecords(lines: string[], separator: string): DelimitedRecord[] {
  const records: DelimitedRecord[] = []
  let cells: string[] = [], cell = '', quoted = false, start = 0
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]
    for (let index = 0; index < line.length; index++) {
      const char = line[index]
      if (char === '"' && (quoted || !cell.trim())) {
        if (quoted && line[index + 1] === '"') { cell += '"'; index++ }
        else quoted = !quoted
      } else if (char === separator && !quoted) { cells.push(cell.trim()); cell = '' }
      else cell += char
    }
    if (quoted && row < lines.length - 1) { cell += '\n'; continue }
    cells.push(cell.trim()); records.push({ start, end: row, cells })
    cells = []; cell = ''; start = row + 1
  }
  return records
}
function delimitedBlocks(lines: string[], separators: readonly string[]): Map<number, number> {
  const blocks = new Map<number, number>()
  for (const separator of separators) {
    // Empty records do not end a table. Original line spans still retain the
    // blank rows/quoted cells when the complete source is handed to Upload.
    const records = delimitedRecords(lines, separator).filter(record => record.cells.some(cell => cell.length > 0))
    for (let index = 0; index < records.length; index++) {
      const record = records[index], fields = record.cells.map(importHeaderField)
      if (record.cells.length < 2) continue
      const header = fields.some(field => field === 'phone' || field === 'uid' || field === 'email')
        && new Set(fields.filter(Boolean)).size >= 2
      const recipientColumn = record.cells.findIndex(cell => recipientCell.test(cell))
      const next = records[index + 1]
      const consistentRows = recipientColumn >= 0 && next?.cells.length === record.cells.length
        && recipientCell.test(next.cells[recipientColumn])
      if (!header && !consistentRows) continue
      const recipientColumns = header
        ? fields.flatMap((field, column) => field === 'phone' || field === 'uid' || field === 'email' ? [column] : [])
        : [recipientColumn]
      let last = index
      while (last + 1 < records.length) {
        const candidate = records[last + 1]
        if (candidate.cells.length < 2) break
        // A recipient in the table's identity column wins over words in names or
        // notes (e.g. "Đạt Nguyễn"). Upload still owns validity/column mapping.
        const hasRecipient = recipientColumns.some(column => recipientCell.test(candidate.cells[column] || ''))
        if (!header && (candidate.cells.length !== record.cells.length || !hasRecipient)) break
        // A comma in prose is not evidence of another table row. Inspect each
        // cell so a schedule preface cannot hide the instruction after it.
        // Non-instruction malformed rows stay local for Upload's error preview.
        if (!hasRecipient && candidate.cells.some(csvInstruction)) break
        last++
      }
      if (last > index) blocks.set(record.start, Math.max(blocks.get(record.start) ?? 0, records[last].end))
      index = last
    }
  }
  return blocks
}
/** Keep CSV bytes/quoted cells intact so the existing workbook importer can map columns. */
export const isAgentCsvData = (value: string): boolean => delimitedBlocks(value.split(/\r?\n/), [',', ';']).size > 0
/** Deterministic extraction: structured rows stay local; only the instruction reaches the router. */
export function splitAgentDataMessage(value: string, contentOnly = false): { description: string; data: string } {
  if (contentOnly) return { description: value.trim(), data: '' }
  const lines = value.split(/\r?\n/), data: string[] = [], words: string[] = []
  const tables = delimitedBlocks(lines, [',', ';', '\t'])
  // A pasted Excel row is already recognized by its tabs below. Extend that
  // same row through quoted newlines before inspecting any continuation as prose,
  // including a single headerless row. Keep the existing TXT/table import route.
  for (const record of delimitedRecords(lines, '\t')) {
    if (record.cells.length > 1 && record.end > record.start) {
      tables.set(record.start, Math.max(tables.get(record.start) ?? record.end, record.end))
    }
  }
  let mode: 'auto' | 'content' | 'data' = 'auto'
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    // Prose is not recipient data just because it contains an identity. Keep a
    // content block intact until the user explicitly starts a data block.
    if (dataIntent(line)) mode = 'data'
    else if (contentIntent(line)) mode = 'content'
    else if (mode === 'data' && line.split(/[,;]/).some(csvInstruction)) {
      // After local rows are removed, a remaining "Nhập danh sách" heading must
      // not make a later instruction/hotline become data on the next sanitize.
      mode = contentBoundary(line) ? 'content' : 'auto'
    }
    // Renderer/main/history may sanitize the same instruction more than once.
    // The recipient list is already local; do not consume a later hotline as a new list.
    if (line.includes('[data đính kèm]')) {
      words.push(line); mode = contentBoundary(line) ? 'content' : 'auto'; continue
    }
    if (mode === 'content') { words.push(line); continue }
    const tableEnd = tables.get(index)
    if (tableEnd !== undefined) { data.push(lines.slice(index, tableEnd + 1).join('\n')); index = tableEnd; mode = 'auto'; continue }
    const urls = Array.from(line.matchAll(/https?:\/\/\S+/gi))
    const matches = Array.from(line.matchAll(recipient)).filter(m => !urls.some(url => m.index! >= url.index! && m.index! < url.index! + url[0].length))
    let remaining = line
    for (const match of [...matches].reverse()) remaining = remaining.slice(0, match.index!) + remaining.slice(match.index! + match[0].length)
    const inlineRecipients = matches.length > 0 && recipientIntent(line.slice(0, matches[0].index))
    const dataHeading = dataIntent(line)
    const structured = !inlineRecipients && !dataHeading && (line.includes('\t')
      || matches.length > 0 && (separatorsOnly(remaining) || mode === 'data')
      || (mode === 'data' || lines.length > 1) && /^https?:\/\/\S+$/i.test(line.trim()))
    if (structured) data.push(line)
    else if (matches.length && (inlineRecipients || dataHeading)) {
      // Only the contiguous recipient list is data. A following message body
      // (including its hotline/email) remains part of the user's instruction.
      const first = matches[0], selected = [first]
      for (const match of matches.slice(1)) {
        const previous = selected[selected.length - 1]
        if (!separatorsOnly(line.slice(previous.index! + previous[0].length, match.index))) break
        selected.push(match)
      }
      data.push(...selected.map(match => match[0]))
      const last = selected[selected.length - 1]
      words.push(line.slice(0, first.index) + '[data đính kèm]' + line.slice(last.index! + last[0].length))
      if (contentBoundary(line.slice(last.index! + last[0].length))) mode = 'content'
    } else words.push(line)
  }
  // Keep standalone headers with their rows, but never treat a sentence such as
  // "Tên chiến dịch: ..." as a header just because its first word is "Tên".
  const headerOnly = (line: string) => !line.trim()
    || line.split(/[,;\t]/).every(cell => !cell.trim() || importHeaderField(cell) !== undefined)
  if (data.length && lines.length > 1 && words.every(headerOnly)) return { description: '', data: value }
  return { description: words.join('\n').trim(), data: data.join('\n').trim() }
}
export function agentDataSafeText(value: string, contentOnly = false): string {
  const split = splitAgentDataMessage(value, contentOnly)
  return (split.description + (split.data ? '\n[Có dữ liệu được giữ tại máy để import]' : '')).trim().slice(0, 4000)
}
