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
 * không còn), nên chia nhỏ thì lần sau gỡ data của lần trước.
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

/** Ước tính thời gian mỗi dòng theo số chiến dịch đang bật "nhận data mới từ nhóm". */
export function estimateDataGroupIngestRowMs(receivingCampaigns: number): number {
  const campaigns = Number.isFinite(receivingCampaigns) && receivingCampaigns > 0 ? Math.floor(receivingCampaigns) : 0
  return DATA_GROUP_INGEST_ROW_BASE_MS + campaigns * DATA_GROUP_INGEST_ROW_PER_CAMPAIGN_MS
}

/** Số dòng mỗi lần gọi để một lần chạy khoảng `targetMs`. */
export function dataGroupIngestRowsForTarget(rowMs: number, targetMs = DATA_GROUP_INGEST_TARGET_CHUNK_MS): number {
  if (!Number.isFinite(rowMs) || rowMs <= 0) return DATA_GROUP_INGEST_MAX_CHUNK_ROWS
  return Math.max(1, Math.min(DATA_GROUP_INGEST_MAX_CHUNK_ROWS, Math.floor(targetMs / rowMs)))
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
