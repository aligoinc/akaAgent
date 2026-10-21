/** Versioned wire contract. The database and SQLite adapters validate it again. */
export const COLUMN_FILTER_VERSION = 1 as const
export type DataTableSource = 'contacts' | 'upload' | 'group_members' | 'page_inbox' | 'remarketing' | 'data_group'
export type ColumnFilterKind = 'text' | 'identifier' | 'number' | 'date' | 'enum' | 'set' | 'presence'
export type ColumnFilterOperator = 'contains' | 'not_contains' | 'eq' | 'neq' | 'starts_with' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'empty' | 'not_empty'
export interface ColumnFilter { field: string; op: ColumnFilterOperator; value?: string | number | string[]; to?: string | number }
export interface ColumnFilterRequest { version: typeof COLUMN_FILTER_VERSION; filters: ColumnFilter[] }
export interface ColumnFilterOption { value: string; label: string }
export interface DataColumnDefinition {
  id: string
  label: string
  kind: ColumnFilterKind
  sources: readonly DataTableSource[]
  options?: readonly ColumnFilterOption[]
  optionSource?: 'zaloTags' | 'akaBizTags' | 'accounts' | 'dataTypes' | 'actions'
}

const all: DataTableSource[] = ['contacts', 'upload', 'group_members', 'page_inbox', 'remarketing', 'data_group']
const scan: DataTableSource[] = ['contacts', 'group_members', 'page_inbox']
const option = (value: string, label: string): ColumnFilterOption => ({ value, label })
export const DATA_COLUMNS: readonly DataColumnDefinition[] = [
  { id: 'name', label: 'Tên', kind: 'text', sources: all },
  { id: 'uid', label: 'UID', kind: 'identifier', sources: all },
  { id: 'phone', label: 'Số điện thoại', kind: 'identifier', sources: all },
  { id: 'url', label: 'Link', kind: 'identifier', sources: ['contacts', 'group_members', 'data_group'] },
  { id: 'email', label: 'Email', kind: 'identifier', sources: ['upload', 'data_group'] },
  ...[1, 2, 3, 4, 5].map(n => ({ id: `info${n}`, label: `Info ${n}`, kind: 'text' as const, sources: ['upload', 'data_group'] as DataTableSource[] })),
  { id: 'avatar', label: 'Ảnh đại diện', kind: 'presence', sources: scan },
  { id: 'gender', label: 'Giới tính', kind: 'enum', sources: ['contacts', 'group_members'], options: [option('male', 'Nam'), option('female', 'Nữ'), option('unknown', 'Chưa xác định')] },
  { id: 'zaloTags', label: 'Tag Zalo', kind: 'set', sources: ['contacts', 'group_members', 'remarketing'], optionSource: 'zaloTags' },
  { id: 'akaBizTags', label: 'Tag akaBiz', kind: 'set', sources: ['contacts', 'group_members', 'remarketing'], optionSource: 'akaBizTags' },
  { id: 'memberCount', label: 'Số thành viên', kind: 'number', sources: ['contacts'] },
  { id: 'role', label: 'Vai trò', kind: 'enum', sources: ['contacts', 'group_members'], options: [option('owner', 'Trưởng nhóm'), option('admin', 'Phó nhóm'), option('member', 'Thành viên')] },
  { id: 'friendship', label: 'Bạn bè', kind: 'enum', sources: ['contacts', 'group_members'], options: [option('friend', 'Bạn bè'), option('stranger', 'Người lạ'), option('unknown', 'Chưa xác định')] },
  { id: 'joined', label: 'Tham gia', kind: 'enum', sources: ['contacts'], options: [option('joined', 'Đã tham gia'), option('not_joined', 'Chưa tham gia')] },
  { id: 'approval', label: 'Duyệt bài', kind: 'enum', sources: ['contacts'], options: [option('required', 'Chờ duyệt bài'), option('not_required', 'Không cần duyệt'), option('unknown', 'Chưa biết')] },
  { id: 'message', label: 'Tin nhắn cuối', kind: 'text', sources: ['page_inbox'] },
  { id: 'lastMessageAt', label: 'Thời gian nhắn gần nhất', kind: 'date', sources: ['page_inbox'] },
  { id: 'groupName', label: 'Tên group', kind: 'text', sources: ['remarketing'] },
  { id: 'latestAction', label: 'Hành động của chiến dịch gần nhất', kind: 'enum', sources: ['remarketing'], optionSource: 'actions' },
  { id: 'sentCount', label: 'Số tin đã gửi', kind: 'number', sources: ['remarketing'] },
  { id: 'latestSentAt', label: 'Ngày gửi', kind: 'date', sources: ['remarketing'] },
  { id: 'daysSinceLatest', label: 'Ngày gửi gần nhất cách hôm nay số ngày', kind: 'number', sources: ['remarketing'] },
  { id: 'latestStatus', label: 'Trạng thái gửi tin gần nhất', kind: 'text', sources: ['remarketing'] },
  { id: 'latestLog', label: 'Ghi chú gửi tin gần nhất', kind: 'text', sources: ['remarketing'] },
  { id: 'recipientStatus', label: 'Trạng thái của người nhận trong tin nhắn gần nhất', kind: 'text', sources: ['remarketing'] },
  { id: 'displayName', label: 'Tên hiển thị', kind: 'text', sources: ['data_group'] },
  { id: 'account', label: 'Tài khoản', kind: 'enum', sources: ['data_group'], optionSource: 'accounts' },
  { id: 'dataType', label: 'Loại data', kind: 'enum', sources: ['data_group'], optionSource: 'dataTypes' },
  { id: 'status', label: 'Trạng thái', kind: 'enum', sources: ['data_group'], options: [option('friend', 'Bạn bè'), option('stranger', 'Người lạ'), option('request_sent', 'Gửi lời mời kết bạn'), option('request_received', 'Nhận kết bạn'), option('joined', 'Đã tham gia'), option('not_joined', 'Chưa tham gia'), option('unknown', 'Chưa xác định')] },
  { id: 'source', label: 'Nguồn data', kind: 'enum', sources: ['data_group'], options: [option('upload', 'Upload data'), option('scan', 'Quét data'), option('automation', 'Tự động hóa'), option('dynamic_filter', 'Bộ lọc động'), option('external_sync', 'Google Sheet')] },
  { id: 'automation', label: 'Tự động hóa', kind: 'text', sources: ['data_group'] }
]

export const COLUMN_FILTER_OPERATORS: Record<ColumnFilterKind, readonly ColumnFilterOperator[]> = {
  text: ['contains', 'not_contains', 'eq', 'neq', 'starts_with', 'empty', 'not_empty'],
  identifier: ['contains', 'eq', 'neq', 'starts_with', 'in', 'empty', 'not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
  date: ['gte', 'lt', 'between', 'empty', 'not_empty'],
  enum: ['in', 'empty', 'not_empty'],
  set: ['in', 'empty', 'not_empty'],
  presence: ['empty', 'not_empty']
}
export const COLUMN_FILTER_LIMITS = { conditions: 40, values: 200, text: 1000 } as const
export const EMPTY_COLUMN_FILTERS: ColumnFilterRequest = { version: 1, filters: [] }
const invalid = (): never => { throw new Error('Bộ lọc cột không hợp lệ hoặc không được hỗ trợ cho bảng này.') }
export function getDataColumn(source: DataTableSource, id: string): DataColumnDefinition {
  return DATA_COLUMNS.find(c => c.id === id && c.sources.includes(source)) || invalid()
}

/** Only strict, bounded data crosses IPC. Unknown fields/operators fail closed. */
export function normalizeColumnFilters(source: DataTableSource, input: unknown): ColumnFilterRequest {
  if (input === undefined) return { version: 1, filters: [] }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid()
  const request = input as Record<string, unknown>
  if (request.version !== 1 || !Array.isArray(request.filters) || request.filters.length > COLUMN_FILTER_LIMITS.conditions) return invalid()
  const seen = new Set<string>()
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > COLUMN_FILTER_LIMITS.text || value.includes('\0')) return invalid()
    return value.trim().normalize('NFC')
  }
  const filters = request.filters.map((raw: unknown): ColumnFilter => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid()
    const f = raw as Record<string, unknown>
    if (typeof f.field !== 'string' || seen.has(f.field)) return invalid()
    seen.add(f.field)
    const column = getDataColumn(source, f.field)
    const op = f.op as ColumnFilterOperator
    if (!COLUMN_FILTER_OPERATORS[column.kind].includes(op)) return invalid()
    if (op === 'empty' || op === 'not_empty') return { field: f.field, op }
    if (op === 'in') {
      if (!Array.isArray(f.value) || !f.value.length || f.value.length > COLUMN_FILTER_LIMITS.values) return invalid()
      const value = Array.from(new Set(f.value.map(text))).sort()
      if (column.options && value.some(v => !column.options!.some(o => o.value === v))) return invalid()
      return { field: f.field, op, value }
    }
    const scalar = (value: unknown): string | number => {
      if (column.kind === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return invalid()
        return value
      }
      const normalized = text(value)
      if (column.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized) || !Number.isFinite(Date.parse(normalized)))) return invalid()
      if (column.kind === 'date') {
        const canonical = new Date(normalized).toISOString()
        if (canonical !== normalized.replace(/Z$/, normalized.includes('.') ? 'Z' : '.000Z')) return invalid()
        return canonical
      }
      return normalized
    }
    const value = scalar(f.value)
    if (op !== 'between') return { field: f.field, op, value }
    const to = scalar(f.to)
    if (value > to || (column.kind === 'date' && value === to)) return invalid()
    return { field: f.field, op, value, to }
  })
  return { version: 1, filters: filters.sort((a, b) => a.field.localeCompare(b.field)) }
}

export function columnFilterKey(source: DataTableSource, input: unknown): string {
  return JSON.stringify(normalizeColumnFilters(source, input))
}

/** Date controls represent Vietnam calendar days; interval upper bound is exclusive. */
export function columnFilterDateBoundary(day: string, end = false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return invalid()
  const utc = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== day) return invalid()
  return new Date(utc - 7 * 3600000 + (end ? 86400000 : 0)).toISOString()
}
