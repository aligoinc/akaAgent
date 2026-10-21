import { normalizeColumnFilters } from '../../../shared/dataColumnFilters'

// Every expression is owned by the adapter. Values are always bound parameters.
export const PAGE_INBOX_FILTER_EXPRESSIONS: Record<string, string> = {
  name: 'name', uid: 'uid', phone: "json_extract(extra_data, '$.phone')",
  avatar: "COALESCE(NULLIF(json_extract(extra_data, '$.avatarUrl'),''),NULLIF(json_extract(extra_data, '$.avatar'),''),NULLIF(json_extract(extra_data, '$.avatar_url'),''),NULLIF(json_extract(extra_data, '$.fullAvatar'),''),json_extract(extra_data, '$.full_avatar'))",
  message: "json_extract(extra_data, '$.lastMessageText')",
  lastMessageAt: "julianday(json_extract(extra_data, '$.lastMessageAt'))"
}
export function compilePageInboxColumnFilters(input: unknown): { sql: string; params: Array<string | number> } {
  const request = normalizeColumnFilters('page_inbox', input)
  const params: Array<string | number> = []
  const bind = (value: string | number): string => { params.push(value); return '?' }
  const conditions = request.filters.map(filter => {
    const raw = PAGE_INBOX_FILTER_EXPRESSIONS[filter.field]
    if (!raw) throw new Error('Cột chưa có ánh xạ truy vấn.')
    const date = filter.field === 'lastMessageAt'
    const expr = date ? raw : `NULLIF(trim(CAST(${raw} AS TEXT), char(32,9,10,13,12,11,160)), '')`
    if (filter.op === 'empty') return `${expr} IS NULL`
    if (filter.op === 'not_empty') return `${expr} IS NOT NULL`
    if (date) {
      if (filter.op === 'between') return `(${expr} >= julianday(${bind(filter.value as string)}) AND ${expr} < julianday(${bind(filter.to as string)}))`
      return `${expr} ${filter.op === 'gte' ? '>=' : '<'} julianday(${bind(filter.value as string)})`
    }
    const folded = `column_filter_fold(${expr})`
    if (filter.op === 'in') return `${folded} IN (${(filter.value as string[]).map(value => `column_filter_fold(${bind(value)})`).join(',')})`
    if (filter.op === 'eq' || filter.op === 'neq') return `${folded} ${filter.op === 'eq' ? '=' : '<>'} column_filter_fold(${bind(filter.value as string)})`
    // instr/substr make % and _ literal without SQLite's ASCII-only LIKE.
    const value = `column_filter_fold(${bind(filter.value as string)})`
    if (filter.op === 'starts_with') return `instr(${folded},${value}) = 1`
    return `instr(${folded},${value}) ${filter.op === 'not_contains' ? '=' : '>'} 0`
  })
  return { sql: conditions.length ? conditions.join(' AND ') : '1', params }
}
export function foldColumnFilterText(value: unknown): string | null {
  return value == null ? null : String(value).normalize('NFC').toLocaleLowerCase('vi-VN')
}
