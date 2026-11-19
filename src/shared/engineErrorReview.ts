// Tab "Lỗi không xác định" của Desktop (admin akaBiz): hợp đồng với hàm DB `aka_agent_engine_error_review(action, payload)`
// của V588 (docs/FB_ERROR_WATCH_CLAUDE_CODE_PLAN.md mục 12). Module thuần: dùng được ở tiến trình chính, preload và renderer.

export const ENGINE_ERROR_REVIEW_IPC = {
  /** Một kênh cho mọi thao tác: `list` | `case` | `note` | `code` | `mark`. */
  call: 'engine-error-review:call'
} as const

export const ENGINE_ERROR_REVIEW_MENU_LABEL = 'Lỗi không xác định'

export type EngineErrorReviewAction = 'list' | 'case' | 'note' | 'code' | 'mark'
export const ENGINE_ERROR_REVIEW_ACTIONS: readonly EngineErrorReviewAction[] = ['list', 'case', 'note', 'code', 'mark']

export type EngineErrorCaseStatus = 'new' | 'queued' | 'reported' | 'failed' | 'known' | 'muted'
export type EngineErrorProposalStatus = 'none' | 'proposed' | 'approved' | 'rejected' | 'applied'

/** Mã lỗi hàm DB trả về, cộng hai mã của Desktop (`not_ready`: DB chưa có V588; `unavailable`: lỗi khác). */
export type EngineErrorReviewErrorCode =
  | 'no_session' | 'forbidden' | 'case_required' | 'case_not_found' | 'note_length' | 'bad_decision'
  | 'no_proposal' | 'bad_status' | 'case_queued' | 'bad_action' | 'not_ready' | 'unavailable'

const MESSAGES: Record<EngineErrorReviewErrorCode, string> = {
  no_session: 'Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.',
  forbidden: 'Mục này chỉ dành cho quản trị viên akaBiz.',
  case_required: 'Chưa chọn ca lỗi.',
  case_not_found: 'Không tìm thấy ca lỗi này. Vui lòng tải lại danh sách.',
  note_length: 'Câu cho khách phải dài từ 5 đến 200 ký tự.',
  bad_decision: 'Lựa chọn không hợp lệ.',
  no_proposal: 'Ca này chưa có đề xuất mã lỗi.',
  bad_status: 'Trạng thái không hợp lệ.',
  case_queued: 'Ca này đang chờ Claude kiểm, chưa đổi trạng thái được.',
  bad_action: 'Thao tác không hợp lệ.',
  not_ready: 'Tính năng này đang được cập nhật. Vui lòng thử lại sau.',
  unavailable: 'Chưa tải được dữ liệu lỗi. Vui lòng thử lại sau ít phút.'
}

export function engineErrorReviewMessage(code: EngineErrorReviewErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.unavailable
}

export function isEngineErrorReviewErrorCode(value: unknown): value is EngineErrorReviewErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, value)
}

export class EngineErrorReviewError extends Error {
  readonly code: EngineErrorReviewErrorCode
  constructor(code: EngineErrorReviewErrorCode) {
    super(engineErrorReviewMessage(code))
    this.name = 'EngineErrorReviewError'
    this.code = code
  }
}

export type EngineErrorReviewIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: EngineErrorReviewErrorCode; message: string }

export interface EngineErrorCaseRow {
  caseKey: string
  kind: string
  errorCode: string
  publicCode: string
  actionCode: string
  step: string
  pattern: string
  hits: number
  pauses: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  status: string
  conclusion: string | null
  confidence: string | null
  summary: string | null
  reportAt: string | null
  customerNote: string | null
  customerNoteStatus: EngineErrorProposalStatus
  codeProposalStatus: EngineErrorProposalStatus
  itemCount: number
  organizationCount: number
  campaignCount: number
}

export interface EngineErrorList {
  settings: { enabled: boolean; enqueue: boolean; imageRequests: boolean; fire: boolean }
  state: { lastTickAt: string | null; lastError: string | null; tasksToday: number }
  counts: Record<string, number>
  needsReview: number
  total: number
  cases: EngineErrorCaseRow[]
}

export interface EngineErrorCodeProposal {
  tenLoi: string
  cauChoKhach: string
  buocTiepTheo: string
  cachXuLy: string
  dauHieu: string
}

export interface EngineErrorCaseDetail extends Omit<EngineErrorCaseRow, 'itemCount' | 'organizationCount' | 'campaignCount'> {
  /** Báo cáo có cấu trúc của Claude (khuôn ở docs/FB_ERROR_WATCH_TASK.md); null khi chưa có báo cáo. */
  report: Record<string, unknown> | null
  /** Báo cáo dạng chữ. */
  answer: string | null
  customerNoteAt: string | null
  codeProposal: EngineErrorCodeProposal | null
  codeProposalAt: string | null
  threadId: number | null
  note: string | null
}

export interface EngineErrorItem {
  id: number
  occurredAt: string | null
  targetRunId: number | null
  inputDataId: number | null
  dataName: string | null
  campaignId: number | null
  campaignName: string | null
  accountId: number | null
  accountName: string | null
  staffId: number | null
  staffName: string | null
  organizationId: number | null
  organizationName: string | null
  publicCode: string
  message: string
  noteAppliedAt: string | null
}

export interface EngineErrorCaseResponse {
  case: EngineErrorCaseDetail
  itemTotal: number
  items: EngineErrorItem[]
}

export interface EngineErrorDecision {
  caseKey: string
  status: string
  customerNote: string | null
  customerNoteStatus: EngineErrorProposalStatus
  customerNoteAt: string | null
  codeProposalStatus: EngineErrorProposalStatus
  codeProposalAt: string | null
}

export interface EngineErrorListQuery {
  status?: string
  kind?: string
  q?: string
  needsReview?: boolean
  limit?: number
  offset?: number
}

export const ENGINE_ERROR_NOTE_MIN = 5
export const ENGINE_ERROR_NOTE_MAX = 200
export const ENGINE_ERROR_LIST_PAGE = 50
export const ENGINE_ERROR_ITEM_PAGE = 50

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value))
const textOrNull = (value: unknown): string | null => {
  const out = text(value)
  return out ? out : null
}
const count = (value: unknown): number => {
  const out = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(out) ? out : 0
}
const idOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const out = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(out) ? out : null
}
const PROPOSAL_STATUSES: readonly EngineErrorProposalStatus[] = ['none', 'proposed', 'approved', 'rejected', 'applied']
const proposalStatus = (value: unknown): EngineErrorProposalStatus =>
  (PROPOSAL_STATUSES as readonly unknown[]).includes(value) ? (value as EngineErrorProposalStatus) : 'none'

function parseCaseBase(raw: Record<string, unknown>): Omit<EngineErrorCaseRow, 'itemCount' | 'organizationCount' | 'campaignCount'> {
  return {
    caseKey: text(raw.caseKey),
    kind: text(raw.kind),
    errorCode: text(raw.errorCode),
    publicCode: text(raw.publicCode),
    actionCode: text(raw.actionCode),
    step: text(raw.step),
    pattern: text(raw.pattern),
    hits: count(raw.hits),
    pauses: count(raw.pauses),
    firstSeenAt: textOrNull(raw.firstSeenAt),
    lastSeenAt: textOrNull(raw.lastSeenAt),
    status: text(raw.status),
    conclusion: textOrNull(raw.conclusion),
    confidence: textOrNull(raw.confidence),
    summary: textOrNull(raw.summary),
    reportAt: textOrNull(raw.reportAt),
    customerNote: textOrNull(raw.customerNote),
    customerNoteStatus: proposalStatus(raw.customerNoteStatus),
    codeProposalStatus: proposalStatus(raw.codeProposalStatus)
  }
}

/** Mọi bộ đọc ném `EngineErrorReviewError`: mã của DB khi `ok = false`, `unavailable` khi dữ liệu sai khuôn. */
function assertOk(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) throw new EngineErrorReviewError('unavailable')
  if (raw.ok !== true) throw new EngineErrorReviewError(isEngineErrorReviewErrorCode(raw.code) ? raw.code : 'unavailable')
  return raw
}

export function parseEngineErrorList(raw: unknown): EngineErrorList {
  const data = assertOk(raw)
  const settings = isRecord(data.settings) ? data.settings : {}
  const state = isRecord(data.state) ? data.state : {}
  const counts: Record<string, number> = {}
  if (isRecord(data.counts)) for (const [key, value] of Object.entries(data.counts)) counts[key] = count(value)
  const cases = Array.isArray(data.cases) ? data.cases.filter(isRecord) : []
  return {
    settings: {
      enabled: settings.enabled === true, enqueue: settings.enqueue === true,
      imageRequests: settings.imageRequests === true, fire: settings.fire === true
    },
    state: { lastTickAt: textOrNull(state.lastTickAt), lastError: textOrNull(state.lastError), tasksToday: count(state.tasksToday) },
    counts,
    needsReview: count(data.needsReview),
    total: count(data.total),
    cases: cases.filter(item => text(item.caseKey)).map(item => ({
      ...parseCaseBase(item),
      itemCount: count(item.itemCount), organizationCount: count(item.organizationCount), campaignCount: count(item.campaignCount)
    }))
  }
}

function parseCodeProposal(raw: unknown): EngineErrorCodeProposal | null {
  if (!isRecord(raw)) return null
  const out = {
    tenLoi: text(raw.ten_loi), cauChoKhach: text(raw.cau_cho_khach), buocTiepTheo: text(raw.buoc_tiep_theo),
    cachXuLy: text(raw.cach_xu_ly), dauHieu: text(raw.dau_hieu)
  }
  return Object.values(out).some(Boolean) ? out : null
}

export function parseEngineErrorCase(raw: unknown): EngineErrorCaseResponse {
  const data = assertOk(raw)
  if (!isRecord(data.case) || !text(data.case.caseKey)) throw new EngineErrorReviewError('unavailable')
  const item = data.case
  const items = Array.isArray(data.items) ? data.items.filter(isRecord) : []
  return {
    case: {
      ...parseCaseBase(item),
      report: isRecord(item.report) ? item.report : null,
      answer: textOrNull(item.answer),
      customerNoteAt: textOrNull(item.customerNoteAt),
      codeProposal: parseCodeProposal(item.codeProposal),
      codeProposalAt: textOrNull(item.codeProposalAt),
      threadId: idOrNull(item.threadId),
      note: textOrNull(item.note)
    },
    itemTotal: count(data.itemTotal),
    items: items.map(row => ({
      id: count(row.id),
      occurredAt: textOrNull(row.occurredAt),
      targetRunId: idOrNull(row.targetRunId),
      inputDataId: idOrNull(row.inputDataId),
      dataName: textOrNull(row.dataName),
      campaignId: idOrNull(row.campaignId),
      campaignName: textOrNull(row.campaignName),
      accountId: idOrNull(row.accountId),
      accountName: textOrNull(row.accountName),
      staffId: idOrNull(row.staffId),
      staffName: textOrNull(row.staffName),
      organizationId: idOrNull(row.organizationId),
      organizationName: textOrNull(row.organizationName),
      publicCode: text(row.publicCode),
      message: text(row.message),
      noteAppliedAt: textOrNull(row.noteAppliedAt)
    }))
  }
}

export function parseEngineErrorDecision(raw: unknown): EngineErrorDecision {
  const data = assertOk(raw)
  if (!isRecord(data.case) || !text(data.case.caseKey)) throw new EngineErrorReviewError('unavailable')
  const item = data.case
  return {
    caseKey: text(item.caseKey),
    status: text(item.status),
    customerNote: textOrNull(item.customerNote),
    customerNoteStatus: proposalStatus(item.customerNoteStatus),
    customerNoteAt: textOrNull(item.customerNoteAt),
    codeProposalStatus: proposalStatus(item.codeProposalStatus),
    codeProposalAt: textOrNull(item.codeProposalAt)
  }
}

/**
 * Chỉ giữ các khoá hàm DB đọc cho từng thao tác, đúng kiểu. Renderer gửi gì khác đều bị bỏ.
 * Trả null khi thiếu thông tin bắt buộc (tiến trình chính trả lỗi mà không gọi DB).
 */
export function sanitizeEngineErrorReviewPayload(action: EngineErrorReviewAction, raw: unknown): Record<string, unknown> | null {
  const input = isRecord(raw) ? raw : {}
  const shortText = (value: unknown, max: number): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
  const page = (value: unknown, max: number): number | undefined =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : undefined
  const caseKey = typeof input.caseKey === 'string' && input.caseKey.length > 0 && input.caseKey.length <= 2000 ? input.caseKey : undefined

  if (action === 'list') {
    return {
      status: shortText(input.status, 20), kind: shortText(input.kind, 40), q: shortText(input.q, 120),
      needsReview: input.needsReview === true, limit: page(input.limit, 200), offset: page(input.offset, 100000)
    }
  }
  if (!caseKey) return null
  if (action === 'case') return { caseKey, limit: page(input.limit, 200), offset: page(input.offset, 100000) }
  if (action === 'note') {
    if (input.decision !== 'approve' && input.decision !== 'reject') return null
    return { caseKey, decision: input.decision, note: input.decision === 'approve' ? shortText(input.note, 400) : undefined }
  }
  if (action === 'code') {
    if (input.decision !== 'approve' && input.decision !== 'reject') return null
    return { caseKey, decision: input.decision }
  }
  if (input.status !== 'known' && input.status !== 'new') return null
  return { caseKey, status: input.status }
}

const KIND_LABELS: Record<string, string> = {
  chua_phan_loai: 'Chưa phân loại',
  ma_chua_ket_luan: 'Mã chưa có kết luận',
  tang_bat_thuong: 'Tăng bất thường',
  luot_bo_do: 'Lượt bỏ dở'
}
const STATUS_LABELS: Record<string, string> = {
  new: 'Chưa kiểm', queued: 'Đang chờ Claude', reported: 'Đã có báo cáo', failed: 'Claude chưa trả lời', known: 'Đã biết', muted: 'Đã tắt báo'
}
const CONCLUSION_LABELS: Record<string, string> = {
  loi_app: 'Lỗi của app',
  facebook_doi_giao_dien: 'Facebook đổi giao diện',
  do_cau_hinh_cua_khach: 'Do cấu hình của khách',
  do_may_khach: 'Do máy của khách',
  chua_du_du_lieu: 'Chưa đủ dữ liệu'
}
const CONFIDENCE_LABELS: Record<string, string> = { cao: 'cao', trung_binh: 'trung bình', thap: 'thấp' }
const PROPOSAL_LABELS: Record<EngineErrorProposalStatus, string> = {
  none: 'Chưa có', proposed: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Đã bỏ', applied: 'Đã áp dụng'
}

export const engineErrorKindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind
export const engineErrorStatusLabel = (status: string): string => STATUS_LABELS[status] ?? status
export const engineErrorConclusionLabel = (conclusion: string | null): string =>
  conclusion ? CONCLUSION_LABELS[conclusion] ?? conclusion : 'Chưa có kết luận'
export const engineErrorConfidenceLabel = (confidence: string | null): string =>
  confidence ? CONFIDENCE_LABELS[confidence] ?? confidence : ''
export const engineErrorProposalLabel = (status: EngineErrorProposalStatus): string => PROPOSAL_LABELS[status]

export const ENGINE_ERROR_STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Mọi trạng thái' },
  ...(['new', 'queued', 'reported', 'failed', 'known'] as const).map(value => ({ value, label: STATUS_LABELS[value] }))
]
export const ENGINE_ERROR_KIND_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Mọi loại ca' },
  ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))
]

/** Câu sẽ ghi vào kết quả chạy: câu đã duyệt kèm mã công khai của lượt, đúng cách hàm tick ghép. */
export function engineErrorAppliedNote(note: string, publicCode: string): string {
  const clean = note.trim().replace(/\s+/g, ' ')
  return publicCode ? `${clean} (${publicCode})` : clean
}
