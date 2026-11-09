/**
 * Chia một lần "thêm data vào nhóm" thành nhiều lần gọi RPC `aka_agent_ingest_data_group` ngắn.
 *
 * Vì sao (sự cố 08–09/11/2026): hàm DB đẩy từng dòng vào mọi chiến dịch đang bật "nhận data mới từ nhóm",
 * tất cả trong một giao dịch có trần 60 giây. Thời gian ≈ số dòng × (~8 ms + số chiến dịch đang bật × ~5 ms).
 * Nhóm gắn nhiều chiến dịch (khách có nhóm cấp data cho 630 chiến dịch: ~3 giây mỗi dòng) hoặc danh sách lớn
 * (~8.700 dòng) bị huỷ "canceling statement due to statement timeout" và rollback toàn bộ, thử lại vẫn hỏng.
 *
 * Chỉ chia kiểu nạp cộng dồn: quét, thủ công, API, tự động. KHÔNG chia 'upload'/'external_sync': DB coi mỗi lần
 * gọi là ảnh chụp toàn bộ của file/nguồn (đầu lần gọi đánh dấu dòng cũ "không còn", cuối lần gọi gỡ thành viên
 * không còn), nên chia nhỏ thì lần sau gỡ data của lần trước. Nhập file lớn dùng phiên nhiều phần của V485
 * (`runDataGroupUpload` bên dưới): các phần chỉ cộng thêm, bước chốt làm phần ảnh chụp một lần cho cả file.
 *
 * Mỗi lô có mã yêu cầu cố định theo vị trí và độ dài, nên thử lại cùng mã gốc với cùng cách chia không nạp trùng;
 * chia khác đi thì dòng đã nạp chỉ thành "đã có" trong nhóm. Cỡ lô tự điều chỉnh theo thời gian chạy thật; DB
 * (V483, cửa vào Desktop) báo `PT413` kèm ước tính mỗi dòng khi một lần gửi chắc chắn vượt trần.
 *
 * Viết ở WebApp packages/control-api, chép nguyên văn sang Desktop src/shared. Không import gì.
 */

/** Kiểu nạp cộng dồn, chia lô an toàn. */
export const DATA_GROUP_INGEST_CHUNKABLE_KINDS = ['manual', 'scan', 'api', 'automation'] as const

/** Lô đầu khi chưa biết nhóm nặng hay nhẹ; nhỏ hơn số này thì gửi một lần với mã yêu cầu gốc. */
export const DATA_GROUP_INGEST_FIRST_CHUNK_ROWS = 100
export const DATA_GROUP_INGEST_MAX_CHUNK_ROWS = 500
/** Mỗi lần gọi nhắm ~20 giây, còn xa trần 60 giây của hàm DB. */
export const DATA_GROUP_INGEST_TARGET_CHUNK_MS = 20_000
/** Ước tính giống guard V483: ~8 ms mỗi dòng + ~5 ms cho mỗi (dòng × chiến dịch đang bật). */
export const DATA_GROUP_INGEST_ROW_BASE_MS = 8
export const DATA_GROUP_INGEST_ROW_PER_CAMPAIGN_MS = 5
const MAX_FAILURES_AT_SAME_OFFSET = 6
const MAX_REQUEST_ID_BASE_LENGTH = 440

export function isChunkableDataGroupIngestKind(kind: string): boolean {
  return (DATA_GROUP_INGEST_CHUNKABLE_KINDS as readonly string[]).includes(kind)
}

/** Khoá `auto_system_settings` của công tắc đẩy data nhóm vào chiến dịch (DB V484). */
export const DATA_GROUP_ROUTING_SETTING_KEY = 'data_groups.routing_mode'

/**
 * Tổ chức có đẩy data vào chiến dịch chạy nền không (DB V484, cùng luật `private.aka_agent_data_group_route_async`):
 * `mode` = 'async' và `organizationIds` thiếu/null (mọi tổ chức) hoặc là mảng có id tổ chức. Khi đó lượt nạp không
 * còn tốn thời gian theo số chiến dịch, ước tính cỡ lô chỉ tính phần ghi thành viên.
 */
export function isDataGroupRoutingAsync(value: unknown, organizationId: number): boolean {
  let setting = value
  if (typeof value === 'string') {
    try {
      setting = JSON.parse(value) as unknown
    } catch {
      return false
    }
  }
  const record = errorRecord(setting)
  if (!record || Array.isArray(setting) || record.mode !== 'async') return false
  const ids = record.organizationIds
  if (ids === undefined || ids === null) return true
  return Array.isArray(ids) && ids.some(id => typeof id === 'number' && id === organizationId)
}

/** Ước tính thời gian mỗi dòng theo số chiến dịch đang bật "nhận data mới từ nhóm". */
export function estimateDataGroupIngestRowMs(receivingCampaigns: number): number {
  const campaigns = Number.isFinite(receivingCampaigns) && receivingCampaigns > 0 ? Math.floor(receivingCampaigns) : 0
  return DATA_GROUP_INGEST_ROW_BASE_MS + campaigns * DATA_GROUP_INGEST_ROW_PER_CAMPAIGN_MS
}

/** Số dòng mỗi lần gọi để một lần chạy khoảng `targetMs`. */
export function dataGroupIngestRowsForTarget(
  rowMs: number,
  targetMs = DATA_GROUP_INGEST_TARGET_CHUNK_MS,
  maxRows = DATA_GROUP_INGEST_MAX_CHUNK_ROWS
): number {
  if (!Number.isFinite(rowMs) || rowMs <= 0) return maxRows
  return Math.max(1, Math.min(maxRows, Math.floor(targetMs / rowMs)))
}

/** Mã yêu cầu của một lô: cố định theo mã gốc, vị trí bắt đầu và độ dài. */
export function dataGroupIngestChunkRequestId(baseRequestId: string, offset: number, length: number): string {
  return `${baseRequestId.trim().slice(0, MAX_REQUEST_ID_BASE_LENGTH)}:part:${offset}+${length}`
}

export interface DataGroupIngestGuard {
  maxRows: number
  rowMs: number | null
  receivingCampaigns: number | null
}

function errorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === 'object' ? error as Record<string, unknown> : null
}

function errorChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = []
  let current = errorRecord(error)
  while (current && chain.length < 5 && !chain.includes(current)) {
    chain.push(current)
    current = errorRecord(current.rpcError ?? current.cause)
  }
  return chain
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** Đọc lỗi chặn sớm của DB (`PT413`, chi tiết JSON có maxRows/rowMs). */
export function readDataGroupIngestGuard(error: unknown): DataGroupIngestGuard | null {
  for (const item of errorChain(error)) {
    if (String(item.code ?? '') !== 'PT413') continue
    let detail: Record<string, unknown> = {}
    try {
      const parsed = typeof item.details === 'string' ? JSON.parse(item.details) as unknown : item.details
      detail = errorRecord(parsed) ?? {}
    } catch {
      detail = {}
    }
    const maxRows = positiveNumber(detail.maxRows)
    return {
      maxRows: maxRows === null ? 1 : Math.max(1, Math.floor(maxRows)),
      rowMs: positiveNumber(detail.rowMs),
      receivingCampaigns: Number.isFinite(Number(detail.receivingCampaigns)) ? Number(detail.receivingCampaigns) : null
    }
  }
  return null
}

/** Lỗi hết thời gian của Postgres (57014), kể cả khi chỉ còn câu chữ. */
export function isDataGroupIngestStatementTimeout(error: unknown): boolean {
  return errorChain(error).some(item => String(item.code ?? '') === '57014'
    || String(item.message ?? '').toLowerCase().includes('statement timeout'))
}

/** Câu tiếng Việt cho lỗi chặn sớm/hết thời gian (khách đọc); null nếu là lỗi khác. */
export function dataGroupIngestTimeoutMessage(error: unknown): string | null {
  const guard = errorChain(error).find(item => String(item.code ?? '') === 'PT413')
  if (guard && String(guard.message ?? '').trim()) return String(guard.message).trim()
  if (isDataGroupIngestStatementTimeout(error)) {
    return 'Thêm data vào nhóm mất quá nhiều thời gian nên đã bị dừng: nhóm đang cấp data cho nhiều chiến dịch bật "nhận data mới từ nhóm" hoặc danh sách quá lớn. Vui lòng chọn ít data hơn rồi thử lại.'
  }
  return null
}

/** Lỗi dừng giữa chừng: các lô trước đã lưu, lô ở `completedRows` hỏng. `rpcError` là lỗi gốc của lô hỏng. */
export class DataGroupIngestChunkError extends Error {
  readonly rpcError: unknown
  readonly completedRows: number
  readonly totalRows: number

  constructor(rpcError: unknown, completedRows: number, totalRows: number) {
    const record = errorRecord(rpcError)
    super(String(record?.message ?? rpcError ?? 'Không thể thêm data vào nhóm.'))
    this.name = 'DataGroupIngestChunkError'
    this.rpcError = rpcError
    this.completedRows = completedRows
    this.totalRows = totalRows
  }
}

/** Câu mở đầu báo số dòng đã lưu khi dừng giữa chừng; rỗng nếu chưa lưu dòng nào. */
export function dataGroupIngestProgressNote(error: unknown): string {
  return error instanceof DataGroupIngestChunkError && error.completedRows > 0
    ? `Đã thêm ${error.completedRows}/${error.totalRows} dòng trước khi dừng, thử lại để thêm tiếp. `
    : ''
}

/** Lỗi gốc của lô (bỏ lớp bọc chia lô) để nơi gọi dịch sang câu của mình. */
export function dataGroupIngestRootError(error: unknown): unknown {
  return error instanceof DataGroupIngestChunkError ? error.rpcError : error
}

export interface DataGroupIngestChunkCall<Row> {
  rows: Row[]
  requestId: string
  offset: number
  /** false: gửi cả danh sách một lần với mã yêu cầu gốc (giữ hành vi cũ). */
  chunked: boolean
}

export interface DataGroupIngestChunkPart<Result> {
  offset: number
  rowCount: number
  result: Result
}

export interface RunChunkedDataGroupIngestOptions<Row, Result> {
  kind: string
  rows: readonly Row[]
  requestId: string
  invoke: (call: DataGroupIngestChunkCall<Row>) => Promise<Result>
  merge: (parts: DataGroupIngestChunkPart<Result>[]) => Result
  /** Ước tính ms mỗi dòng nếu đã biết số chiến dịch đang bật (vd. API Web đếm trước). */
  estimatedRowMs?: number | null
  now?: () => number
  onProgress?: (completedRows: number, totalRows: number) => void
}

/**
 * Gửi `rows` vào nhóm, chia lô khi cần. Kiểu 'upload'/'external_sync' luôn gửi một lần như cũ.
 * Lỗi chặn sớm (PT413) hoặc hết 60 giây làm nhỏ lô rồi gửi lại đúng vị trí đó; lỗi khác dừng và ném
 * `DataGroupIngestChunkError` (nếu đã chia lô) để nơi gọi báo số dòng đã lưu.
 */
export async function runChunkedDataGroupIngest<Row, Result>(
  options: RunChunkedDataGroupIngestOptions<Row, Result>
): Promise<Result> {
  const rows = [...options.rows]
  const total = rows.length
  const now = options.now ?? (() => Date.now())
  const chunkable = isChunkableDataGroupIngestKind(options.kind)
  let size = options.estimatedRowMs
    ? dataGroupIngestRowsForTarget(options.estimatedRowMs)
    : DATA_GROUP_INGEST_FIRST_CHUNK_ROWS

  if (!chunkable || total <= size) {
    try {
      const result = await options.invoke({ rows, requestId: options.requestId, offset: 0, chunked: false })
      options.onProgress?.(total, total)
      return result
    } catch (error) {
      const guard = readDataGroupIngestGuard(error)
      if (!chunkable || total <= 1 || (!guard && !isDataGroupIngestStatementTimeout(error))) throw error
      size = guard
        ? Math.min(guard.rowMs ? dataGroupIngestRowsForTarget(guard.rowMs) : guard.maxRows, total - 1)
        : Math.max(1, Math.floor(total / 4))
    }
  }

  const parts: DataGroupIngestChunkPart<Result>[] = []
  let offset = 0
  let failuresAtOffset = 0
  while (offset < total) {
    const length = Math.max(1, Math.min(size, total - offset))
    const started = now()
    try {
      const result = await options.invoke({
        rows: rows.slice(offset, offset + length),
        requestId: dataGroupIngestChunkRequestId(options.requestId, offset, length),
        offset,
        chunked: true
      })
      parts.push({ offset, rowCount: length, result })
      offset += length
      failuresAtOffset = 0
      options.onProgress?.(offset, total)
      const elapsed = Math.max(1, now() - started)
      const scaled = Math.floor(length * DATA_GROUP_INGEST_TARGET_CHUNK_MS / elapsed)
      size = Math.max(1, Math.min(DATA_GROUP_INGEST_MAX_CHUNK_ROWS, length * 2, scaled))
    } catch (error) {
      failuresAtOffset += 1
      const guard = readDataGroupIngestGuard(error)
      const timedOut = !guard && isDataGroupIngestStatementTimeout(error)
      if ((!guard && !timedOut) || length <= 1 || failuresAtOffset >= MAX_FAILURES_AT_SAME_OFFSET) {
        throw new DataGroupIngestChunkError(error, offset, total)
      }
      const suggested = guard
        ? (guard.rowMs ? dataGroupIngestRowsForTarget(guard.rowMs) : guard.maxRows)
        : Math.floor(length / 4)
      size = Math.max(1, Math.min(suggested, length - 1))
    }
  }
  return options.merge(parts)
}

export interface DataGroupIngestResultLike {
  requestId: string
  batchId?: number | null
  groupId: number
  groupRevision: number
  insertedMembershipCount: number
  reactivatedMembershipCount: number
  alreadyMemberCount: number
  insertedInputCount: number
  alreadySeenInputCount: number
  incompatibleCount: number
  conflictCount: number
  invalidCount: number
  conflicts?: unknown[]
}

const COUNT_KEYS = [
  'insertedMembershipCount', 'reactivatedMembershipCount', 'alreadyMemberCount', 'insertedInputCount',
  'alreadySeenInputCount', 'incompatibleCount', 'conflictCount', 'invalidCount'
] as const

/** Gộp kết quả các lô: cộng số đếm, revision lớn nhất, batch cuối, `conflicts[].rowIndex` đổi về vị trí gốc. */
export function mergeDataGroupIngestResults<Result extends DataGroupIngestResultLike>(
  parts: DataGroupIngestChunkPart<Result>[],
  requestId: string
): Result {
  if (parts.length === 0) throw new Error('Không có lô nào để gộp kết quả.')
  const last = parts[parts.length - 1].result
  const merged = { ...last, requestId } as Result
  for (const key of COUNT_KEYS) {
    (merged as unknown as Record<string, unknown>)[key] = parts.reduce((sum, part) => sum + (Number(part.result[key]) || 0), 0)
  }
  merged.groupRevision = Math.max(...parts.map(part => Number(part.result.groupRevision) || 0))
  merged.batchId = [...parts].reverse().map(part => part.result.batchId).find(id => id != null) ?? null
  if (parts.some(part => Array.isArray(part.result.conflicts))) {
    merged.conflicts = parts.flatMap(part => (Array.isArray(part.result.conflicts) ? part.result.conflicts : []).map(item => {
      const record = errorRecord(item)
      return record && typeof record.rowIndex === 'number' ? { ...record, rowIndex: record.rowIndex + part.offset } : item
    }))
  }
  return merged
}

// ---------------------------------------------------------------------------------------------------------------
// Nhập file nhiều phần (DB V485): begin -> append x N -> finish
// ---------------------------------------------------------------------------------------------------------------

/**
 * File trên số dòng này đi phiên nhiều phần ngay; nhỏ hơn thì gửi một lần như cũ và chỉ chuyển sang phiên khi bị chặn
 * sớm (PT413) hoặc hết 60 giây. ~2.000 dòng x 8 ms = 16 giây, an toàn khi nhóm không cấp data cho chiến dịch nào.
 */
export const DATA_GROUP_UPLOAD_SESSION_MIN_ROWS = 2000
/** Phần đầu khi chưa biết nhóm nặng hay nhẹ; sau đó tự điều chỉnh để mỗi phần khoảng 20 giây. */
export const DATA_GROUP_UPLOAD_FIRST_PART_ROWS = 500
export const DATA_GROUP_UPLOAD_MAX_PART_ROWS = 2000
/** Trần của một phiên (DB kiểm lại). */
export const DATA_GROUP_UPLOAD_MAX_ROWS = 100_000
/** Trần của một lần nạp (đường cũ, cũng là trần khi DB chưa có V485). */
export const DATA_GROUP_SINGLE_INGEST_MAX_ROWS = 10_000
/** File nhỏ mà ước tính (nếu biết) quá số này thì cũng đi phiên ngay, khỏi chờ một lần gửi hết 60 giây. */
export const DATA_GROUP_UPLOAD_SINGLE_MAX_ESTIMATED_MS = 45_000

export interface DataGroupUploadTypeRow {
  contact_type: string | null
  flatform_type: string | null
}

function nullableText(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value)
}

/**
 * Các cặp (contact_type, flatform_type) khác nhau của file, theo đúng dòng sẽ gửi (khoá snake_case như DB).
 * Bước begin dùng chúng để chọn/tạo dataset giống hệt lần nhập một lần (loại/nền tảng của dataset tính trên cả file).
 */
export function dataGroupUploadTypeRows(rows: readonly unknown[]): DataGroupUploadTypeRow[] {
  const seen = new Set<string>()
  const result: DataGroupUploadTypeRow[] = []
  for (const row of rows) {
    const record = errorRecord(row)
    if (!record) continue
    const item = { contact_type: nullableText(record.contact_type), flatform_type: nullableText(record.flatform_type) }
    const key = JSON.stringify([item.contact_type, item.flatform_type])
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export interface DataGroupUploadSessionPart {
  offset: number
  rows: number
}

export interface DataGroupUploadSessionInfo {
  sessionId: string
  status: string
  totalRows: number
  receivedRows: number
  parts: DataGroupUploadSessionPart[]
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

/** Đọc JSON phiên do DB trả (khoá snake_case hoặc camelCase). */
export function parseDataGroupUploadSession(value: unknown): DataGroupUploadSessionInfo {
  const record = errorRecord(Array.isArray(value) ? value[0] : value) ?? {}
  const sessionId = String(record.session_id ?? record.sessionId ?? '').trim()
  const totalRows = nonNegativeInteger(record.total_rows ?? record.totalRows)
  if (!sessionId || totalRows === null) throw new Error('Phản hồi mở phiên nhập file không hợp lệ.')
  const rawParts = Array.isArray(record.parts) ? record.parts : []
  const parts: DataGroupUploadSessionPart[] = []
  for (const raw of rawParts) {
    const part = errorRecord(raw)
    const offset = nonNegativeInteger(part?.offset)
    const rows = nonNegativeInteger(part?.rows)
    if (offset !== null && rows !== null && rows > 0) parts.push({ offset, rows })
  }
  parts.sort((a, b) => a.offset - b.offset)
  return {
    sessionId,
    status: String(record.status ?? 'open'),
    totalRows,
    receivedRows: nonNegativeInteger(record.received_rows ?? record.receivedRows) ?? 0,
    parts
  }
}

/** Các đoạn [offset, offset + length) của file chưa có trong các phần DB đã nhận. */
export function dataGroupUploadMissingRanges(
  totalRows: number,
  parts: readonly DataGroupUploadSessionPart[]
): Array<{ offset: number; length: number }> {
  const ranges: Array<{ offset: number; length: number }> = []
  let cursor = 0
  for (const part of [...parts].sort((a, b) => a.offset - b.offset)) {
    if (part.offset > cursor) ranges.push({ offset: cursor, length: Math.min(part.offset, totalRows) - cursor })
    cursor = Math.max(cursor, part.offset + part.rows)
    if (cursor >= totalRows) break
  }
  if (cursor < totalRows) ranges.push({ offset: cursor, length: totalRows - cursor })
  return ranges.filter(range => range.length > 0)
}

/** DB chưa có RPC phiên (chưa apply V485 hoặc đã gỡ): dùng lại cách gửi một lần. */
export function isDataGroupUploadSessionUnavailable(error: unknown): boolean {
  return errorChain(error).some(item => {
    const code = String(item.code ?? '')
    const message = String(item.message ?? '')
    if (code === 'data_group_upload_session_unavailable' || code === 'PGRST202') return true
    return code === '42883' && message.includes('data_group_upload')
  })
}

export interface DataGroupUploadAppendCall<Row> {
  sessionId: string
  /** Vị trí dòng đầu của phần trong cả file (bắt đầu từ 0). */
  offset: number
  rows: Row[]
}

export interface RunDataGroupUploadOptions<Row, Result> {
  rows: readonly Row[]
  /** Gửi cả file một lần như trước V485. */
  single: (rows: Row[]) => Promise<Result>
  /** Mở phiên (gửi lại cùng mã yêu cầu thì DB trả phiên cũ kèm các phần đã nhận). Trả JSON phiên của DB. */
  begin: (totalRows: number) => Promise<unknown>
  append: (call: DataGroupUploadAppendCall<Row>) => Promise<unknown>
  finish: (sessionId: string) => Promise<Result>
  /** Ước tính ms mỗi dòng nếu biết số chiến dịch đang bật nhận data (0 chiến dịch khi tổ chức đẩy chạy nền). */
  estimatedRowMs?: number | null
  now?: () => number
  onProgress?: (completedRows: number, totalRows: number) => void
}

function closedSessionError(status: string): Error & { code: string } {
  const error = new Error(`data_group_upload_session_closed (${status})`) as Error & { code: string }
  error.code = 'data_group_upload_session_closed'
  return error
}

async function runDataGroupUploadSession<Row, Result>(
  options: RunDataGroupUploadOptions<Row, Result>,
  rows: Row[],
  rowMs: number | null
): Promise<Result> {
  const total = rows.length
  const now = options.now ?? (() => Date.now())
  const session = parseDataGroupUploadSession(await options.begin(total))
  if (session.totalRows !== total) throw new Error('Phiên nhập file không khớp số dòng.')
  if (session.status === 'finished') {
    const result = await options.finish(session.sessionId)
    options.onProgress?.(total, total)
    return result
  }
  if (session.status !== 'open') throw closedSessionError(session.status)
  let received = Math.min(total, session.receivedRows)
  if (received > 0) options.onProgress?.(received, total)
  let size = rowMs
    ? dataGroupIngestRowsForTarget(rowMs, DATA_GROUP_INGEST_TARGET_CHUNK_MS, DATA_GROUP_UPLOAD_MAX_PART_ROWS)
    : DATA_GROUP_UPLOAD_FIRST_PART_ROWS
  for (const range of dataGroupUploadMissingRanges(total, session.parts)) {
    let offset = range.offset
    const end = range.offset + range.length
    let failuresAtOffset = 0
    while (offset < end) {
      const length = Math.max(1, Math.min(size, end - offset))
      const started = now()
      try {
        await options.append({ sessionId: session.sessionId, offset, rows: rows.slice(offset, offset + length) })
        offset += length
        received = Math.min(total, received + length)
        failuresAtOffset = 0
        options.onProgress?.(received, total)
        const elapsed = Math.max(1, now() - started)
        const scaled = Math.floor(length * DATA_GROUP_INGEST_TARGET_CHUNK_MS / elapsed)
        size = Math.max(1, Math.min(DATA_GROUP_UPLOAD_MAX_PART_ROWS, length * 2, scaled))
      } catch (error) {
        failuresAtOffset += 1
        const guard = readDataGroupIngestGuard(error)
        const timedOut = !guard && isDataGroupIngestStatementTimeout(error)
        if ((!guard && !timedOut) || length <= 1 || failuresAtOffset >= MAX_FAILURES_AT_SAME_OFFSET) {
          throw new DataGroupIngestChunkError(error, received, total)
        }
        const suggested = guard
          ? (guard.rowMs
            ? dataGroupIngestRowsForTarget(guard.rowMs, DATA_GROUP_INGEST_TARGET_CHUNK_MS, DATA_GROUP_UPLOAD_MAX_PART_ROWS)
            : guard.maxRows)
          : Math.floor(length / 4)
        size = Math.max(1, Math.min(suggested, length - 1))
      }
    }
  }
  return options.finish(session.sessionId)
}

/**
 * Nhập file ('upload') vào nhóm: file lớn đi phiên nhiều phần (V485), file nhỏ gửi một lần như cũ và chuyển sang
 * phiên khi bị chặn sớm/hết giờ. DB chưa có V485 thì gửi một lần (trần 10.000 dòng như cũ).
 * Lỗi giữa chừng ném `DataGroupIngestChunkError` với số dòng đã nhận; dòng đã nhận nằm trong nhóm nhưng data cũ
 * chưa bị gỡ cho tới khi chốt. Gửi lại cùng mã yêu cầu (cùng file) thì DB trả các phần đã nhận và chỉ gửi phần còn thiếu.
 */
export async function runDataGroupUpload<Row, Result>(options: RunDataGroupUploadOptions<Row, Result>): Promise<Result> {
  const rows = [...options.rows]
  const total = rows.length
  let rowMs = positiveNumber(options.estimatedRowMs)
  const sendSingle = async (): Promise<Result> => {
    const result = await options.single(rows)
    options.onProgress?.(total, total)
    return result
  }
  if (total <= DATA_GROUP_UPLOAD_SESSION_MIN_ROWS && (!rowMs || total * rowMs <= DATA_GROUP_UPLOAD_SINGLE_MAX_ESTIMATED_MS)) {
    try {
      return await sendSingle()
    } catch (error) {
      const guard = readDataGroupIngestGuard(error)
      if (total <= 1 || (!guard && !isDataGroupIngestStatementTimeout(error))) throw error
      if (guard?.rowMs) rowMs = guard.rowMs
      try {
        return await runDataGroupUploadSession(options, rows, rowMs)
      } catch (sessionError) {
        throw isDataGroupUploadSessionUnavailable(sessionError) ? error : sessionError
      }
    }
  }
  try {
    return await runDataGroupUploadSession(options, rows, rowMs)
  } catch (error) {
    if (!isDataGroupUploadSessionUnavailable(error)) throw error
    return sendSingle()
  }
}
