import { read, utils, type WorkBook } from 'xlsx'
import { importExportMatrix, importHeaderField, type ImportCell, type ImportResultGroup, type ImportTableSource, type ImportVerificationResult } from './campaignImportVerification'

const LONG_TEXT_SHEET = 'Nội dung dài'
const LONG_TEXT_MARKER = 'akaAgentImportLongText'
const LONG_TEXT_HEADERS = ['Mã nội dung', 'Phần', 'Nội dung', 'Tổng phần', 'Độ dài gốc']
const LONG_TEXT_REFERENCE = /^\[Nội dung dài: (ND\d+)\]$/
const EXCEL_TEXT_LIMIT = 32_767

/** Sample logical records, ignoring separators/newlines inside quoted cells. XLSX still parses the cells. */
function importCsvSeparator(text: string): string {
  const explicit = text.match(/^sep=([,;\t])(?:\r\n|\r|\n)/)
  if (explicit) return explicit[1]
  const separators = [',', ';', '\t']
  const records: { counts: number[]; text: string }[] = []
  let counts = [0, 0, 0], quoted = false, nonempty = false, start = 0
  const finish = (end: number) => {
    if (nonempty) records.push({ counts, text: text.slice(start, end) })
    counts = [0, 0, 0]; nonempty = false
  }
  for (let index = 0; index < text.length && records.length < 50; index++) {
    const char = text[index]
    if (char === '"') {
      nonempty = true
      if (quoted && text[index + 1] === '"') index++
      else quoted = !quoted
    } else if (!quoted && (char === '\n' || char === '\r')) {
      finish(index)
      if (char === '\r' && text[index + 1] === '\n') index++
      start = index + 1
    } else {
      if (char.trim()) nonempty = true
      if (!quoted) {
        const separator = separators.indexOf(char)
        if (separator >= 0) { counts[separator]++; nonempty = true }
      }
    }
  }
  if (records.length < 50) finish(text.length)
  const ambiguous = () => new Error('Không xác định được dấu phân cột CSV. Vui lòng thêm dòng tiêu đề rõ ràng, đặt ô có dấu phân cách trong dấu nháy kép hoặc dùng file Excel .xlsx.')
  // A title or an empty quoted cell may precede a header. Prefer recognized headers
  // over punctuation in the title or phone cells. Bound header probes, not the input.
  const headers: { separator: string | null; score: number }[] = []
  for (const record of records.slice(0, 20)) {
    if (record.text.length > 4096) continue
    for (let index = 0; index < separators.length; index++) {
      const separator = separators[index]
      if (record.counts[index] === 0 && record.counts.some(count => count > 0)) continue
      const book = read(record.text, { type: 'string', raw: true, FS: separator })
      const row = utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: true })[0] || []
      const nonemptyCells = row.filter(cell => String(cell ?? '').trim())
      const fields = new Set(nonemptyCells.map(importHeaderField).filter(field => field !== undefined))
      if (!Array.from(fields).some(field => field === 'phone' || field === 'uid' || field === 'email')) continue
      if (fields.size < 2 && nonemptyCells.length !== 1) continue
      headers.push({ separator: record.counts[index] > 0 ? separator : null, score: fields.size })
    }
  }
  if (headers.length) {
    const best = Math.max(...headers.map(header => header.score))
    const winners = new Set(headers.filter(header => header.score === best).map(header => header.separator))
    if (winners.size === 1) return Array.from(winners)[0] ?? ','
    throw ambiguous()
  }
  // Without a recognizable header, use the most repeated positive column count.
  // Single-cell prefaces and blank records must not force a comma delimiter.
  const candidates = separators.flatMap((separator, index) => {
    const frequencies = new Map<number, number>()
    for (const record of records) {
      const count = record.counts[index]
      if (count > 0) frequencies.set(count, (frequencies.get(count) || 0) + 1)
    }
    return frequencies.size ? [{ separator, consistent: Math.max(...Array.from(frequencies.values())) }] : []
  })
  if (!candidates.length) return ','
  const best = Math.max(...candidates.map(candidate => candidate.consistent))
  const winners = candidates.filter(candidate => candidate.consistent === best)
  if (winners.length === 1) return winners[0].separator
  throw ambiguous()
}

/** Keep CSV text intact, including long identifiers and scientific notation evidence. */
export function readImportWorkbook(bytes: Uint8Array, fileName = '', options: { csvSeparator?: ',' | ';' | '\t' } = {}): WorkBook {
  const binary = (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)
    || (bytes[0] === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(bytes[1]))
  if (/\.csv$/i.test(fileName) || (!fileName && !binary)) {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
    const text = new TextDecoder(encoding).decode(bytes)
    // Sheet links may return SpreadsheetML without a filename. Let XLSX read its structure.
    if (!fileName && text.trimStart().startsWith('<')) return read(bytes, { type: 'array' })
    // Google exports a known comma-separated structure. Semicolons inside its
    // cells belong to the data; only local files/unknown exports need guessing.
    return read(text, { type: 'string', raw: true, codepage: 65001, FS: options.csvSeparator ?? importCsvSeparator(text) })
  }
  return read(bytes, { type: 'array' })
}

/** Store repeated long evidence once, in text chunks Excel can write without losing Unicode. */
export function createImportExportWorkbook(report: ImportVerificationResult, group: ImportResultGroup): WorkBook {
  const matrix = importExportMatrix(report, group)
  const longTexts = new Map<string, string>()
  const chunks: string[][] = [LONG_TEXT_HEADERS]
  const rows = matrix.map(row => row.map(value => {
    if (value.length <= EXCEL_TEXT_LIMIT && !LONG_TEXT_REFERENCE.test(value)) return value
    let id = longTexts.get(value)
    if (!id) {
      id = `ND${longTexts.size + 1}`
      longTexts.set(value, id)
      const parts: string[] = []
      let offset = 0
      while (offset < value.length) {
        let end = Math.min(offset + EXCEL_TEXT_LIMIT, value.length)
        if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--
        parts.push(value.slice(offset, end))
        offset = end
      }
      parts.forEach((content, index) => chunks.push([id!, String(index + 1), content, String(parts.length), String(value.length)]))
    }
    return `[${LONG_TEXT_SHEET}: ${id}]`
  }))
  const sheet = utils.aoa_to_sheet(rows)
  sheet['!cols'] = rows[0].map((_, index) => ({ wch: index < 9 ? 22 : 32 }))
  sheet['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) }
  const book = utils.book_new()
  utils.book_append_sheet(book, sheet, group === 'valid' ? 'Hợp lệ' : group === 'rejected' ? 'Bị loại' : 'Trùng')
  if (longTexts.size) {
    const evidence = utils.aoa_to_sheet(chunks)
    evidence['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 90 }, { wch: 12 }, { wch: 16 }]
    utils.book_append_sheet(book, evidence, LONG_TEXT_SHEET)
    book.Custprops = { [LONG_TEXT_MARKER]: '1' }
  }
  return book
}

function readLongTexts(workbook: WorkBook): Map<string, string> | null {
  const properties = workbook.Custprops as Record<string, unknown> | undefined
  if (properties?.[LONG_TEXT_MARKER] !== '1') return null
  const sheet = workbook.Sheets[LONG_TEXT_SHEET]
  const invalid = () => new Error('File báo cáo thiếu hoặc sai sheet Nội dung dài. Vui lòng dùng file xuất đầy đủ để giữ nguyên dữ liệu.')
  if (!sheet) throw invalid()
  const rows = utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: true })
  if (!LONG_TEXT_HEADERS.every((header, index) => rows[0]?.[index] === header)) throw invalid()
  const parts = new Map<string, { values: string[]; count: number; length: number }>()
  for (const [id, part, content, total, length] of rows.slice(1)) {
    if (typeof id !== 'string' || !/^ND\d+$/.test(id) || typeof content !== 'string') throw invalid()
    const count = Number(total), size = Number(length)
    if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(size) || size <= 0) throw invalid()
    const items = parts.get(id) || { values: [], count, length: size }
    if (items.count !== count || items.length !== size || String(part) !== String(items.values.length + 1)) throw invalid()
    items.values.push(content)
    parts.set(id, items)
  }
  return new Map(Array.from(parts, ([id, items]) => {
    const content = items.values.join('')
    if (items.values.length !== items.count || content.length !== items.length) throw invalid()
    return [id, content]
  }))
}

export function importWorkbookTables(workbook: WorkBook): ImportTableSource {
  const longTexts = readLongTexts(workbook)
  const restore = (value: unknown): unknown => {
    const match = typeof value === 'string' ? value.match(LONG_TEXT_REFERENCE) : null
    if (!longTexts || !match) return value
    if (!longTexts.has(match[1])) throw new Error(`File báo cáo thiếu nội dung ${match[1]} trong sheet Nội dung dài.`)
    return longTexts.get(match[1])!
  }
  return { tables: workbook.SheetNames.filter(name => !longTexts || name !== LONG_TEXT_SHEET).map(name => {
    const sheet = workbook.Sheets[name]
    const raw = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true, blankrows: true })
    const display = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: true })
    const start = sheet['!ref'] ? utils.decode_range(sheet['!ref']).s : { r: 0, c: 0 }
    return {
      name,
      rowNumbers: raw.map((_, index) => start.r + index + 1),
      rows: raw.map((row, index) => Array.from({ length: Math.max(row.length, display[index]?.length || 0) }, (_, column): ImportCell => {
        // sheet_to_json replaces error cells with defval even when raw:false.
        const cell = sheet[utils.encode_cell({ r: start.r + index, c: start.c + column })]
        if (cell?.t === 'e') {
          const error = String(cell.w || utils.format_cell(cell) || '#ERROR!')
          return { value: error, text: error, error }
        }
        const value = restore(row[column])
        return {
          value: typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : value == null ? '' : String(value),
          text: String(restore(display[index]?.[column]) ?? value ?? '')
        }
      }))
    }
  }) }
}
