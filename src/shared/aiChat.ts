/**
 * Hỏi đáp AI theo dự án (akaAgent V488): hợp đồng + logic đồng bộ dùng chung cho Web, mobile và Desktop.
 *
 * Tệp này KHÔNG import gì và không dùng DOM/Node: Desktop (akaAgent `src/shared/aiChat.ts`) chép nguyên văn.
 * Sửa ở đây trước rồi chép lại. Nơi dùng chỉ cần cấp một `AiChatTransport` (HTTP ở Web/mobile, RPC Supabase ở Desktop);
 * `AiChatThreadController` lo toàn bộ việc chờ câu trả lời, hỏi lại theo nhịp, chống gửi trùng và khôi phục khi mất mạng.
 * DB là nguồn sự thật duy nhất: bộ điều khiển không tự dựng câu trả lời, chỉ hiện những gì server trả về.
 * Hợp đồng đầy đủ: docs/AI_CHAT.md.
 */

export const AI_CHAT_STATUSES = [
  'chờ câu trả lời', 'đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời', 'hoàn thành', 'lỗi', 'đã hủy'
] as const
export type AiChatMessageStatus = (typeof AI_CHAT_STATUSES)[number]
/** Câu đang được xử lý: ô nhập bị khóa cho tới khi câu chuyển sang hoàn thành / lỗi / đã hủy. */
export const AI_CHAT_ACTIVE_STATUSES: readonly AiChatMessageStatus[] = [
  'chờ câu trả lời', 'đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời'
]
export const AI_CHAT_MAX_QUESTION = 4000
export const AI_CHAT_NOT_READY = 'ai_chat_not_ready'
export const AI_CHAT_UNAVAILABLE = 'ai_chat_unavailable'
/** Nhóm agent hiện trong menu Trợ lý của danh sách chiến dịch. */
export const AI_CHAT_CAMPAIGN_GROUP = 'hoi-dap-chien-dich'

export const AI_CHAT_ENDPOINTS = {
  agents: '/ai-chat/agents',
  pending: '/ai-chat/pending',
  threads: '/ai-chat/threads',
  thread: (threadId: number) => `/ai-chat/threads/${threadId}`,
  messages: (threadId: number) => `/ai-chat/threads/${threadId}/messages`,
  read: (threadId: number) => `/ai-chat/threads/${threadId}/read`,
  cancel: (threadId: number, messageId: number) => `/ai-chat/threads/${threadId}/messages/${messageId}/cancel`,
  retry: (threadId: number, messageId: number) => `/ai-chat/threads/${threadId}/messages/${messageId}/retry`,
  rating: (threadId: number, messageId: number) => `/ai-chat/threads/${threadId}/messages/${messageId}/rating`
} as const

export type AiChatIntakeFieldType = 'text' | 'textarea' | 'select' | 'checkbox'
export interface AiChatIntakeField {
  key: string
  label: string
  type: AiChatIntakeFieldType
  required: boolean
  placeholder: string
  maxLength: number
  options: Array<{ value: string; label: string }>
}
export interface AiChatProject {
  id: number
  code: string
  name: string
  description: string
  defaultQuestion: string
  suggestedQuestions: string[]
  intakeSchema: AiChatIntakeField[]
  appliesTo: { platforms: string[]; actionIds: string[] }
  requiresCampaign: boolean
  timeoutSeconds: number
  version: number
}
export interface AiChatGroup { id: number; code: string; name: string; description: string; projects: AiChatProject[] }
export interface AiChatLimits { maxQuestionLength: number; maxPendingPerStaff: number; maxQuestionsPerDay: number }
export interface AiChatAgents { enabled: boolean; groups: AiChatGroup[]; limits: AiChatLimits; serverTime: string }

export interface AiChatThread {
  id: number
  projectId: number
  projectCode: string
  projectName: string
  name: string
  firstQuestion: string
  campaignId: number | null
  campaignName: string | null
  accountId: number | null
  accountName: string | null
  status: 'đang mở' | 'đã đóng'
  source: string
  revision: number
  messageCount: number
  lastMessageSeq: number
  lastMessageStatus: AiChatMessageStatus | null
  lastMessageAt: string
  lastReadSeq: number
  /** Câu cuối đang được xử lý. */
  pending: boolean
  /** Có kết quả (trả lời hoặc lỗi) mà người dùng chưa xem. */
  unread: boolean
  createdAt: string
}
export interface AiChatMessage {
  id: number
  threadId: number
  seq: number
  requestId: string
  question: string
  /** Chỉ có khi status = 'hoàn thành'. */
  answer: string | null
  answerJson: Record<string, unknown> | null
  status: AiChatMessageStatus
  progressNote: string | null
  threadRev: number
  askedAt: string
  /** Lần xếp hàng gần nhất (đổi khi Thử lại): mốc tính thời gian chờ. */
  queuedAt: string
  startedAt: string | null
  answeredAt: string | null
  completedAt: string | null
  deadlineAt: string
  errorCode: string | null
  errorMessage: string | null
  rating: 1 | -1 | null
}
export type AiChatSnapshot =
  | { changed: false; revision: number; lastReadSeq: number; serverTime: string }
  | {
    changed: true
    /** true = `messages` là các tin cuối của hội thoại; false = chỉ các tin đổi sau `afterRevision`. */
    full: boolean
    revision: number
    thread: AiChatThread
    messages: AiChatMessage[]
    hasMore: boolean
    serverTime: string
    /** Chỉ ở `open`: true = đã mở lại hội thoại đang chờ sẵn có thay vì tạo mới. */
    reused?: boolean
  }
export interface AiChatPendingList { items: AiChatThread[]; serverTime: string }
export interface AiChatThreadCursor { lastMessageAt: string; id: number }
export interface AiChatThreadQuery { campaignId?: number; projectId?: number; limit?: number; cursor?: AiChatThreadCursor | null }
export interface AiChatThreadPage { items: AiChatThread[]; nextCursor: AiChatThreadCursor | null; serverTime: string }
export interface AiChatMessagePage { messages: AiChatMessage[]; hasMore: boolean; serverTime: string }
export interface AiChatReadResult { ok: true; lastReadSeq: number }

export interface AiChatOpenRequest {
  /** UUID sinh lúc mở modal: gửi lại cùng mã (bấm hai lần, mất phản hồi) không tạo hội thoại thứ hai. */
  requestId: string
  projectId: number
  campaignId?: number | null
  question: string
  intake?: Record<string, string | boolean>
}
export interface AiChatAskRequest { requestId: string; question: string; afterRevision?: number }

/** Cổng gọi server. Web/mobile: HTTP tới API WebApp. Desktop: RPC `aka_agent_ai_chat`. */
export interface AiChatTransport {
  agents(groupCode?: string, signal?: AbortSignal): Promise<AiChatAgents>
  open(request: AiChatOpenRequest): Promise<AiChatSnapshot>
  ask(threadId: number, request: AiChatAskRequest): Promise<AiChatSnapshot>
  sync(threadId: number, afterRevision: number, signal?: AbortSignal): Promise<AiChatSnapshot>
  pending(signal?: AbortSignal): Promise<AiChatPendingList>
  threads(query?: AiChatThreadQuery, signal?: AbortSignal): Promise<AiChatThreadPage>
  olderMessages(threadId: number, beforeSeq: number, signal?: AbortSignal): Promise<AiChatMessagePage>
  cancel(threadId: number, messageId: number, afterRevision: number): Promise<AiChatSnapshot>
  retry(threadId: number, messageId: number, afterRevision: number): Promise<AiChatSnapshot>
  rate(threadId: number, messageId: number, rating: 1 | -1 | null, afterRevision: number, note?: string): Promise<AiChatSnapshot>
  markRead(threadId: number, seq: number): Promise<AiChatReadResult>
}

// ---------------------------------------------------------------------------------------------------------------------
// Thông báo lỗi + nhãn
// ---------------------------------------------------------------------------------------------------------------------

export function aiChatErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'ai_chat_disabled': return 'Trợ lý hỏi đáp đang tạm tắt. Vui lòng thử lại sau.'
    case 'ai_chat_not_ready': return 'Trợ lý hỏi đáp chưa sẵn sàng.'
    case 'ai_chat_access_denied': return 'Bạn không có quyền dùng trợ lý hỏi đáp.'
    case 'ai_chat_agent_not_found':
    case 'ai_chat_agent_unavailable': return 'Trợ lý này hiện không khả dụng.'
    case 'ai_chat_agent_not_applicable': return 'Trợ lý này không áp dụng cho loại chiến dịch đã chọn.'
    case 'ai_chat_campaign_required': return 'Hãy chọn một chiến dịch để hỏi trợ lý.'
    case 'ai_chat_campaign_not_found': return 'Không tìm thấy chiến dịch hoặc chiến dịch không thuộc bạn.'
    case 'ai_chat_question_required': return 'Vui lòng nhập câu hỏi.'
    case 'ai_chat_question_too_long': return 'Câu hỏi tối đa 4.000 ký tự.'
    case 'ai_chat_intake_required': return 'Vui lòng điền đủ các thông tin bắt buộc.'
    case 'ai_chat_message_pending': return 'Chờ trợ lý trả lời câu hiện tại trước khi hỏi tiếp.'
    case 'ai_chat_too_many_pending': return 'Bạn đang có nhiều câu hỏi chờ trả lời. Vui lòng chờ một câu xong rồi hỏi tiếp.'
    case 'ai_chat_daily_limit': return 'Bạn đã dùng hết số câu hỏi trong ngày hôm nay.'
    case 'ai_chat_thread_not_found': return 'Không tìm thấy hội thoại.'
    case 'ai_chat_thread_closed': return 'Hội thoại đã đóng. Hãy mở hội thoại mới.'
    case 'ai_chat_message_not_found': return 'Không tìm thấy câu hỏi.'
    case 'ai_chat_not_retryable': return 'Câu hỏi này không thể thử lại. Hãy gửi câu hỏi mới.'
    case 'ai_chat_not_rateable': return 'Chỉ đánh giá được câu đã có trả lời.'
    case 'ai_chat_invalid_request': return 'Yêu cầu không hợp lệ. Vui lòng tải lại trang rồi thử lại.'
    case 'ai_chat_unavailable': return 'Không kết nối được trợ lý hỏi đáp. Vui lòng thử lại.'
    default: return 'Không thể xử lý yêu cầu hỏi đáp. Vui lòng thử lại.'
  }
}

export function isAiChatStatusActive(status: AiChatMessageStatus | null | undefined): boolean {
  return !!status && AI_CHAT_ACTIVE_STATUSES.includes(status)
}

/** Dòng trạng thái hiện cho khách trong lúc chờ. */
export function aiChatStatusLabel(status: AiChatMessageStatus): string {
  switch (status) {
    case 'chờ câu trả lời': return 'Đã gửi, đang chờ trợ lý nhận câu hỏi'
    case 'đang lấy thông tin câu hỏi': return 'Trợ lý đã nhận câu hỏi'
    case 'đang tìm câu trả lời': return 'Trợ lý đang tìm câu trả lời'
    case 'đã có câu trả lời': return 'Đang hoàn tất câu trả lời'
    case 'hoàn thành': return 'Đã trả lời'
    case 'lỗi': return 'Chưa trả lời được'
    case 'đã hủy': return 'Đã dừng'
  }
}

/** Agent có áp dụng cho chiến dịch này không (server kiểm lại khi mở hội thoại). */
export function aiChatProjectApplies(project: Pick<AiChatProject, 'appliesTo'>, campaign: { platform?: string | null; actionId?: string | null }): boolean {
  const { platforms, actionIds } = project.appliesTo
  if (platforms.length && !platforms.includes(campaign.platform ?? '')) return false
  if (actionIds.length && !actionIds.includes(campaign.actionId ?? '')) return false
  return true
}

/** Các agent của một nhóm áp dụng cho chiến dịch (menu Trợ lý). */
export function aiChatProjectsForCampaign(agents: AiChatAgents | null | undefined, groupCode: string,
  campaign: { platform?: string | null; actionId?: string | null }): AiChatProject[] {
  if (!agents?.enabled) return []
  return agents.groups.filter(group => group.code === groupCode).flatMap(group => group.projects)
    .filter(project => aiChatProjectApplies(project, campaign))
}

/** Kiểm tra câu hỏi trước khi gửi; trả mã lỗi `ai_chat_*` hoặc null. */
export function validateAiChatQuestion(question: string): string | null {
  const text = question.trim()
  if (!text) return 'ai_chat_question_required'
  if (text.length > AI_CHAT_MAX_QUESTION) return 'ai_chat_question_too_long'
  return null
}

/** Kiểm tra các ô modal thu thêm theo `intakeSchema`. */
export function validateAiChatIntake(project: Pick<AiChatProject, 'intakeSchema'>, intake: Record<string, string | boolean>): string | null {
  for (const field of project.intakeSchema) {
    const value = intake[field.key]
    const empty = value === undefined || value === false || (typeof value === 'string' && !value.trim())
    if (field.required && empty) return 'ai_chat_intake_required'
  }
  return null
}

export function newAiChatRequestId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  // Môi trường cũ không có crypto.randomUUID: UUID v4 đủ dùng làm mã chống gửi trùng.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16)
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Câu trả lời có cấu trúc (answerJson theo output_schema của agent)
// ---------------------------------------------------------------------------------------------------------------------

export type AiChatAnswerSection =
  | { kind: 'summary'; text: string }
  | { kind: 'causes'; title: string; items: Array<{ text: string; evidence: string | null }> }
  | { kind: 'steps'; title: string; items: string[] }
  | { kind: 'clarify'; text: string }
  | { kind: 'escalate'; text: string }
  | { kind: 'note'; text: string }

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Chuyển câu trả lời thành các khối hiển thị. Hiểu cấu trúc của nhóm "Hỏi đáp chiến dịch"
 * (tom_tat, nguyen_nhan, cach_xu_ly, cau_hoi_lam_ro, can_chuyen_vien, thoi_diem_du_lieu); agent khác
 * hoặc JSON lạ thì hiện nguyên văn `answer`.
 */
export function aiChatAnswerSections(message: Pick<AiChatMessage, 'answer' | 'answerJson'>): AiChatAnswerSection[] {
  const json = message.answerJson
  const fallback = text(message.answer)
  if (!json || !text(json.tom_tat)) return fallback ? [{ kind: 'summary', text: fallback }] : []
  const sections: AiChatAnswerSection[] = [{ kind: 'summary', text: text(json.tom_tat) }]
  const causes = (Array.isArray(json.nguyen_nhan) ? json.nguyen_nhan : []).map(item => {
    if (typeof item === 'string') return { text: item.trim(), evidence: null }
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return { text: text(row.noi_dung), evidence: text(row.bang_chung) || null }
  }).filter(item => item.text)
  if (causes.length) sections.push({ kind: 'causes', title: 'Nguyên nhân', items: causes })
  const steps = (Array.isArray(json.cach_xu_ly) ? json.cach_xu_ly : []).map(text).filter(Boolean)
  if (steps.length) sections.push({ kind: 'steps', title: 'Cách xử lý', items: steps })
  if (text(json.cau_hoi_lam_ro)) sections.push({ kind: 'clarify', text: text(json.cau_hoi_lam_ro) })
  if (json.can_chuyen_vien === true) sections.push({ kind: 'escalate', text: 'Trường hợp này cần chuyên viên akaBiz kiểm tra thêm.' })
  if (text(json.thoi_diem_du_lieu)) sections.push({ kind: 'note', text: `Dữ liệu tính đến ${text(json.thoi_diem_du_lieu)}` })
  return sections
}

// ---------------------------------------------------------------------------------------------------------------------
// Đọc dữ liệu server (chặt ở phần định danh/trạng thái, mềm ở phần hiển thị)
// ---------------------------------------------------------------------------------------------------------------------

export class AiChatContractError extends Error {
  readonly code = AI_CHAT_UNAVAILABLE
  constructor(message = 'Máy chủ trả về dữ liệu hỏi đáp không hợp lệ.') {
    super(message)
    this.name = 'AiChatContractError'
  }
}

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const row = (value: unknown): Row => { if (!isRow(value)) throw new AiChatContractError(); return value }
const id = (value: unknown): number => {
  const number = typeof value === 'string' && /^[0-9]{1,15}$/.test(value) ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) throw new AiChatContractError()
  return number
}
const optionalId = (value: unknown): number | null => (value === null || value === undefined ? null : id(value))
const count = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const nullableStr = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const time = (value: unknown): string => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new AiChatContractError()
  return value
}
const optionalTime = (value: unknown): string | null => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [])
const status = (value: unknown): AiChatMessageStatus => {
  if (typeof value !== 'string' || !(AI_CHAT_STATUSES as readonly string[]).includes(value)) throw new AiChatContractError()
  return value as AiChatMessageStatus
}

function parseIntakeField(value: unknown): AiChatIntakeField | null {
  if (!isRow(value) || typeof value.key !== 'string' || !value.key.trim()) return null
  const type = (['text', 'textarea', 'select', 'checkbox'] as const).find(item => item === value.type) ?? 'text'
  return {
    key: value.key,
    label: str(value.label) || value.key,
    type,
    required: value.required === true,
    placeholder: str(value.placeholder),
    maxLength: Math.min(count(value.maxLength, 500) || 500, 2000),
    options: (Array.isArray(value.options) ? value.options : []).filter(isRow)
      .map(option => ({ value: str(option.value), label: str(option.label) || str(option.value) })).filter(option => option.value)
  }
}

export function parseAiChatProject(value: unknown): AiChatProject {
  const data = row(value)
  const applies = isRow(data.appliesTo) ? data.appliesTo : {}
  return {
    id: id(data.id), code: str(data.code), name: str(data.name), description: str(data.description),
    defaultQuestion: str(data.defaultQuestion), suggestedQuestions: strings(data.suggestedQuestions),
    intakeSchema: (Array.isArray(data.intakeSchema) ? data.intakeSchema : []).map(parseIntakeField).filter((field): field is AiChatIntakeField => !!field),
    appliesTo: { platforms: strings(applies.platforms), actionIds: strings(applies.actionIds) },
    requiresCampaign: data.requiresCampaign !== false,
    timeoutSeconds: count(data.timeoutSeconds, 300) || 300,
    version: count(data.version, 1) || 1
  }
}

export function parseAiChatAgents(value: unknown): AiChatAgents {
  const data = row(value)
  const limits = isRow(data.limits) ? data.limits : {}
  return {
    enabled: data.enabled === true,
    groups: (Array.isArray(data.groups) ? data.groups : []).map(item => {
      const group = row(item)
      return {
        id: id(group.id), code: str(group.code), name: str(group.name), description: str(group.description),
        projects: (Array.isArray(group.projects) ? group.projects : []).map(parseAiChatProject)
      }
    }),
    limits: {
      maxQuestionLength: count(limits.maxQuestionLength, AI_CHAT_MAX_QUESTION) || AI_CHAT_MAX_QUESTION,
      maxPendingPerStaff: count(limits.maxPendingPerStaff, 3),
      maxQuestionsPerDay: count(limits.maxQuestionsPerDay, 50)
    },
    serverTime: optionalTime(data.serverTime) ?? new Date(0).toISOString()
  }
}

export function parseAiChatThread(value: unknown): AiChatThread {
  const data = row(value)
  const lastStatus = data.lastMessageStatus === null || data.lastMessageStatus === undefined ? null : status(data.lastMessageStatus)
  return {
    id: id(data.id), projectId: id(data.projectId), projectCode: str(data.projectCode), projectName: str(data.projectName),
    name: str(data.name), firstQuestion: str(data.firstQuestion),
    campaignId: optionalId(data.campaignId), campaignName: nullableStr(data.campaignName),
    accountId: optionalId(data.accountId), accountName: nullableStr(data.accountName),
    status: data.status === 'đã đóng' ? 'đã đóng' : 'đang mở', source: str(data.source),
    revision: id(data.revision), messageCount: count(data.messageCount), lastMessageSeq: count(data.lastMessageSeq),
    lastMessageStatus: lastStatus, lastMessageAt: time(data.lastMessageAt), lastReadSeq: count(data.lastReadSeq),
    pending: isAiChatStatusActive(lastStatus),
    unread: data.unread === true, createdAt: time(data.createdAt)
  }
}

export function parseAiChatMessage(value: unknown): AiChatMessage {
  const data = row(value)
  const messageStatus = status(data.status)
  const done = messageStatus === 'hoàn thành'
  return {
    id: id(data.id), threadId: id(data.threadId), seq: id(data.seq), requestId: str(data.requestId), question: str(data.question),
    // Phòng thủ hai lớp: server đã ẩn, client cũng không giữ câu trả lời của câu chưa hoàn thành.
    answer: done ? nullableStr(data.answer) : null,
    answerJson: done && isRow(data.answerJson) ? data.answerJson : null,
    status: messageStatus, progressNote: nullableStr(data.progressNote), threadRev: id(data.threadRev),
    askedAt: time(data.askedAt), queuedAt: optionalTime(data.queuedAt) ?? time(data.askedAt),
    startedAt: optionalTime(data.startedAt), answeredAt: optionalTime(data.answeredAt), completedAt: optionalTime(data.completedAt),
    deadlineAt: time(data.deadlineAt), errorCode: nullableStr(data.errorCode), errorMessage: nullableStr(data.errorMessage),
    rating: data.rating === 1 || data.rating === -1 ? data.rating : null
  }
}

export function parseAiChatSnapshot(value: unknown): AiChatSnapshot {
  const data = row(value)
  if (data.changed === false) {
    return { changed: false, revision: id(data.revision), lastReadSeq: count(data.lastReadSeq), serverTime: time(data.serverTime) }
  }
  if (data.changed !== true || !Array.isArray(data.messages)) throw new AiChatContractError()
  const thread = parseAiChatThread(data.thread)
  const messages = data.messages.map(parseAiChatMessage)
  if (messages.some(message => message.threadId !== thread.id)) throw new AiChatContractError()
  return {
    changed: true, full: data.full === true, revision: id(data.revision), thread, messages,
    hasMore: data.hasMore === true, serverTime: time(data.serverTime),
    ...(typeof data.reused === 'boolean' ? { reused: data.reused } : {})
  }
}

export function parseAiChatPendingList(value: unknown): AiChatPendingList {
  const data = row(value)
  return { items: (Array.isArray(data.items) ? data.items : []).map(parseAiChatThread), serverTime: time(data.serverTime) }
}

export function parseAiChatThreadPage(value: unknown): AiChatThreadPage {
  const data = row(value)
  const cursor = isRow(data.nextCursor) ? data.nextCursor : null
  return {
    items: (Array.isArray(data.items) ? data.items : []).map(parseAiChatThread),
    nextCursor: cursor ? { lastMessageAt: time(cursor.lastMessageAt), id: id(cursor.id) } : null,
    serverTime: time(data.serverTime)
  }
}

export function parseAiChatMessagePage(value: unknown): AiChatMessagePage {
  const data = row(value)
  return { messages: (Array.isArray(data.messages) ? data.messages : []).map(parseAiChatMessage), hasMore: data.hasMore === true, serverTime: time(data.serverTime) }
}

export function parseAiChatReadResult(value: unknown): AiChatReadResult {
  const data = row(value)
  return { ok: true, lastReadSeq: count(data.lastReadSeq) }
}

// ---------------------------------------------------------------------------------------------------------------------
// Trạng thái hội thoại phía client + gộp ảnh chụp
// ---------------------------------------------------------------------------------------------------------------------

export interface AiChatThreadState {
  thread: AiChatThread | null
  /** Sắp theo seq tăng dần. */
  messages: AiChatMessage[]
  revision: number
  hasMore: boolean
  /** Giờ server trừ giờ máy (ms): đồng hồ chờ tính theo giờ server, máy khách sai giờ vẫn đúng. */
  serverOffsetMs: number
}

export const EMPTY_AI_CHAT_THREAD_STATE: AiChatThreadState = { thread: null, messages: [], revision: 0, hasMore: false, serverOffsetMs: 0 }

/**
 * Gộp một ảnh chụp từ server vào trạng thái đang có. Ảnh chụp cũ hơn (đến muộn do mạng) bị bỏ qua;
 * tin được gộp theo id nên nhận trùng không nhân đôi; thứ tự luôn theo seq.
 */
export function applyAiChatSnapshot(state: AiChatThreadState, snapshot: AiChatSnapshot, receivedAtMs: number): AiChatThreadState {
  const serverOffsetMs = Date.parse(snapshot.serverTime) - receivedAtMs
  if (!snapshot.changed) {
    if (!state.thread || snapshot.revision !== state.revision) return { ...state, serverOffsetMs }
    const lastReadSeq = Math.max(state.thread.lastReadSeq, snapshot.lastReadSeq)
    const unread = state.thread.unread && state.thread.lastMessageSeq > lastReadSeq
    return { ...state, serverOffsetMs, thread: { ...state.thread, lastReadSeq, unread } }
  }
  const sameThread = state.thread?.id === snapshot.thread.id
  if (sameThread && snapshot.revision < state.revision) return state
  const byId = new Map<number, AiChatMessage>()
  if (sameThread) for (const message of state.messages) byId.set(message.id, message)
  for (const message of snapshot.messages) {
    const current = byId.get(message.id)
    if (!current || message.threadRev >= current.threadRev) byId.set(message.id, message)
  }
  const messages = Array.from(byId.values()).sort((left, right) => left.seq - right.seq)
  return {
    thread: snapshot.thread,
    messages,
    revision: snapshot.revision,
    hasMore: snapshot.full ? snapshot.hasMore || (sameThread && state.hasMore && messages[0]?.seq !== 1) : state.hasMore,
    serverOffsetMs
  }
}

export function aiChatLastMessage(state: Pick<AiChatThreadState, 'messages'>): AiChatMessage | null {
  return state.messages.length ? state.messages[state.messages.length - 1] : null
}

/** Thời gian đã chờ của một câu đang xử lý, theo giờ server. */
export function aiChatElapsedMs(message: Pick<AiChatMessage, 'queuedAt'>, nowMs: number, serverOffsetMs: number): number {
  return Math.max(0, nowMs + serverOffsetMs - Date.parse(message.queuedAt))
}

/** `m:ss` cho đồng hồ chờ. */
export function formatAiChatElapsed(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Nhịp hỏi lại trạng thái khi có câu đang chờ. Đang xem: 2 giây trong 30 giây đầu, 3 giây tới phút thứ 2, sau đó 5 giây.
 * Không xem (tab/trang khác): 12 giây, đủ để bật chấm báo. Không có câu chờ thì không hỏi lại.
 */
export function aiChatPollDelayMs(elapsedMs: number, visible: boolean): number {
  if (!visible) return 12_000
  if (elapsedMs < 30_000) return 2_000
  if (elapsedMs < 120_000) return 3_000
  return 5_000
}

/** Lỗi nghiệp vụ `ai_chat_*` do server trả; lỗi khác (mạng, 5xx) được coi là tạm thời. */
export function aiChatErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('ai_chat_') ? code : null
}

function describeError(error: unknown): string {
  const code = aiChatErrorCode(error)
  if (code && code !== AI_CHAT_UNAVAILABLE) return aiChatErrorMessage(code)
  return 'Mất kết nối tới trợ lý. Vui lòng thử lại.'
}

// ---------------------------------------------------------------------------------------------------------------------
// Bộ điều khiển một hội thoại: chờ câu trả lời, hỏi tiếp, hủy, thử lại
// ---------------------------------------------------------------------------------------------------------------------

export type AiChatLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AiChatControllerState extends AiChatThreadState {
  status: AiChatLoadStatus
  /** Lỗi tải/mở hội thoại (màn hình lỗi có nút Thử lại). */
  error: string | null
  /** Đang hỏi lại trạng thái nhưng mạng lỗi: hiện "Mất kết nối, đang thử lại", KHÔNG coi câu hỏi là lỗi. */
  offline: boolean
  /** Đang gửi một lệnh (hỏi tiếp, hủy, thử lại, đánh giá). */
  busy: boolean
  /** Lỗi của lệnh vừa gửi (hiện cạnh ô nhập). */
  actionError: string | null
  /** Câu hỏi gửi chưa thành công: gửi lại dùng đúng requestId cũ để không tạo câu trùng. */
  unsent: { requestId: string; question: string } | null
}

export const EMPTY_AI_CHAT_CONTROLLER_STATE: AiChatControllerState = {
  ...EMPTY_AI_CHAT_THREAD_STATE, status: 'idle', error: null, offline: false, busy: false, actionError: null, unsent: null
}

export interface AiChatControllerDeps {
  transport: AiChatTransport
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (handle: unknown) => void
  newRequestId?: () => string
  /** Gọi một lần khi câu đang chờ có kết quả (hoàn thành/lỗi): nơi dùng bật chấm báo, thông báo. */
  onSettled?: (thread: AiChatThread, message: AiChatMessage) => void
  /** Gọi khi trạng thái chờ của hội thoại đổi (có câu mới, có kết quả, hủy): nơi dùng làm mới danh sách cần chú ý. */
  onPendingChanged?: () => void
}

/** Ô nhập có được mở không. Khóa khi chưa tải xong, đang gửi, hoặc câu cuối còn đang xử lý. */
export function aiChatCanAsk(state: AiChatControllerState): boolean {
  if (state.status !== 'ready' || !state.thread || state.busy || state.thread.status !== 'đang mở') return false
  return !isAiChatStatusActive(aiChatLastMessage(state)?.status)
}

export class AiChatThreadController {
  private state: AiChatControllerState = EMPTY_AI_CHAT_CONTROLLER_STATE
  private readonly listeners = new Set<() => void>()
  private timer: unknown = null
  private epoch = 0
  private failures = 0
  private visible = true
  private syncing = false
  private disposed = false
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly newRequestId: () => string

  constructor(private readonly deps: AiChatControllerDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = deps.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.newRequestId = deps.newRequestId ?? newAiChatRequestId
  }

  getState = (): AiChatControllerState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Mở hội thoại mới (hoặc hội thoại đang chờ sẵn có của cùng agent + chiến dịch). */
  async open(request: AiChatOpenRequest): Promise<boolean> {
    const epoch = this.reset('loading')
    try {
      const snapshot = await this.deps.transport.open(request)
      if (epoch !== this.epoch) return false
      this.accept(snapshot, epoch, true)
      return true
    } catch (error) {
      if (epoch === this.epoch) this.patch({ status: 'error', error: describeError(error) })
      return false
    }
  }

  /** Nhận ảnh chụp đã có sẵn (vd. modal vừa mở hội thoại xong) mà không gọi lại server. */
  adopt(snapshot: AiChatSnapshot): void {
    const epoch = this.reset('loading')
    this.accept(snapshot, epoch, true)
  }

  /** Mở một hội thoại đã có (lịch sử, chấm báo, mở lại app). */
  async load(threadId: number): Promise<boolean> {
    if (this.state.thread?.id === threadId && this.state.status === 'ready') { void this.refresh(); return true }
    const epoch = this.reset('loading')
    try {
      const snapshot = await this.deps.transport.sync(threadId, 0)
      if (epoch !== this.epoch) return false
      this.accept(snapshot, epoch, true)
      return true
    } catch (error) {
      if (epoch === this.epoch) this.patch({ status: 'error', error: describeError(error) })
      return false
    }
  }

  /** Đóng hội thoại đang xem (đổi chiến dịch, đăng xuất). Câu đang chờ vẫn được server xử lý. */
  close(): void { this.reset('idle') }

  /** Hỏi tiếp. Trả true nếu câu hỏi đã được server nhận. */
  async ask(question: string): Promise<boolean> {
    const clean = question.trim()
    const invalid = validateAiChatQuestion(clean)
    if (invalid) { this.patch({ actionError: aiChatErrorMessage(invalid) }); return false }
    if (!aiChatCanAsk(this.state) || !this.state.thread) return false
    const unsent = this.state.unsent?.question === clean ? this.state.unsent : { requestId: this.newRequestId(), question: clean }
    const threadId = this.state.thread.id
    return this.command(() => this.deps.transport.ask(threadId, { ...unsent, afterRevision: this.state.revision }), {
      before: { unsent },
      onSuccess: { unsent: null },
      // Server báo đang có câu chờ (đã hỏi từ thiết bị khác): bỏ bản nháp gửi dở, đồng bộ lại để thấy câu đó.
      resyncOn: ['ai_chat_message_pending']
    })
  }

  /** Dừng câu đang chờ. */
  async cancel(): Promise<boolean> {
    const last = aiChatLastMessage(this.state)
    if (!this.state.thread || !last || !isAiChatStatusActive(last.status)) return false
    const threadId = this.state.thread.id
    return this.command(() => this.deps.transport.cancel(threadId, last.id, this.state.revision), {})
  }

  /** Thử lại câu cuối đang lỗi hoặc đã dừng. */
  async retry(): Promise<boolean> {
    const last = aiChatLastMessage(this.state)
    if (!this.state.thread || !last || (last.status !== 'lỗi' && last.status !== 'đã hủy')) return false
    const threadId = this.state.thread.id
    return this.command(() => this.deps.transport.retry(threadId, last.id, this.state.revision), {})
  }

  async rate(messageId: number, rating: 1 | -1 | null): Promise<boolean> {
    if (!this.state.thread) return false
    const threadId = this.state.thread.id
    return this.command(() => this.deps.transport.rate(threadId, messageId, rating, this.state.revision), {})
  }

  /** Đánh dấu đã xem kết quả mới nhất (gọi khi người dùng đang nhìn hội thoại). */
  async markRead(): Promise<void> {
    const thread = this.state.thread
    if (!thread || !thread.unread) return
    const epoch = this.epoch
    try {
      const result = await this.deps.transport.markRead(thread.id, thread.lastMessageSeq)
      if (epoch !== this.epoch || !this.state.thread) return
      this.patch({ thread: { ...this.state.thread, lastReadSeq: result.lastReadSeq, unread: this.state.thread.lastMessageSeq > result.lastReadSeq && this.state.thread.unread } })
      this.deps.onPendingChanged?.()
    } catch { /* Lần xem sau sẽ đánh dấu lại; không làm phiền người dùng. */ }
  }

  /** Tải thêm các câu cũ hơn. */
  async loadOlder(): Promise<void> {
    const thread = this.state.thread
    const first = this.state.messages[0]
    if (!thread || !first || !this.state.hasMore || first.seq <= 1) return
    const epoch = this.epoch
    try {
      const page = await this.deps.transport.olderMessages(thread.id, first.seq)
      if (epoch !== this.epoch) return
      const known = new Set(this.state.messages.map(message => message.id))
      const messages = [...page.messages.filter(message => !known.has(message.id)), ...this.state.messages].sort((left, right) => left.seq - right.seq)
      this.patch({ messages, hasMore: page.hasMore })
    } catch (error) {
      if (epoch === this.epoch) this.patch({ actionError: describeError(error) })
    }
  }

  /** Đồng bộ ngay (quay lại cửa sổ, bấm "Kiểm tra lại"). */
  async refresh(): Promise<void> {
    if (!this.state.thread || this.syncing) return
    await this.tick(this.epoch)
  }

  /** Báo hội thoại có đang được nhìn thấy không: không xem thì hỏi lại thưa hơn. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (visible && this.state.thread) void this.refresh()
    else this.schedule()
  }

  dispose(): void {
    this.disposed = true
    this.epoch++
    this.stopTimer()
    this.listeners.clear()
  }

  private reset(status: AiChatLoadStatus): number {
    this.stopTimer()
    this.failures = 0
    this.syncing = false
    this.state = { ...EMPTY_AI_CHAT_CONTROLLER_STATE, status }
    this.emit()
    return ++this.epoch
  }

  private patch(change: Partial<AiChatControllerState>): void {
    this.state = { ...this.state, ...change }
    this.emit()
  }

  private emit(): void {
    if (this.disposed) return
    Array.from(this.listeners).forEach(listener => listener())
  }

  private stopTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  private accept(snapshot: AiChatSnapshot, epoch: number, initial = false): void {
    if (epoch !== this.epoch) return
    if (initial && !snapshot.changed) { this.patch({ status: 'error', error: 'Không tải được hội thoại. Vui lòng thử lại.' }); return }
    const before = aiChatLastMessage(this.state)
    const wasPending = isAiChatStatusActive(before?.status)
    const next = applyAiChatSnapshot(this.state, snapshot, this.now())
    const after = aiChatLastMessage(next)
    this.failures = 0
    this.state = { ...this.state, ...next, status: 'ready', error: null, offline: false }
    this.emit()
    const isPending = isAiChatStatusActive(after?.status)
    if (next.thread && after && wasPending && !isPending && before?.id === after.id && after.status !== 'đã hủy') {
      this.deps.onSettled?.(next.thread, after)
    }
    if (wasPending !== isPending || before?.id !== after?.id) this.deps.onPendingChanged?.()
    this.schedule()
  }

  private schedule(): void {
    this.stopTimer()
    if (this.disposed) return
    const last = aiChatLastMessage(this.state)
    if (!this.state.thread || !last || !isAiChatStatusActive(last.status)) return
    const base = aiChatPollDelayMs(aiChatElapsedMs(last, this.now(), this.state.serverOffsetMs), this.visible)
    const backoff = this.failures ? Math.min(30_000, 2_000 * 2 ** Math.min(this.failures, 4)) : 0
    const epoch = this.epoch
    this.timer = this.setTimer(() => { this.timer = null; void this.tick(epoch) }, Math.max(base, backoff))
  }

  private async tick(epoch: number): Promise<void> {
    const thread = this.state.thread
    if (epoch !== this.epoch || !thread || this.syncing) return
    this.syncing = true
    try {
      const snapshot = await this.deps.transport.sync(thread.id, this.state.revision)
      if (epoch !== this.epoch) return
      this.syncing = false
      this.accept(snapshot, epoch)
    } catch (error) {
      if (epoch !== this.epoch) return
      this.syncing = false
      if (aiChatErrorCode(error) === 'ai_chat_thread_not_found') {
        this.stopTimer()
        this.patch({ status: 'error', error: aiChatErrorMessage('ai_chat_thread_not_found'), offline: false })
        return
      }
      // Lỗi mạng/máy chủ: giữ nguyên câu đang chờ, thử lại giãn dần. Không bao giờ tự đánh dấu câu hỏi là lỗi.
      this.failures++
      this.patch({ offline: true })
      this.schedule()
    }
  }

  private async command(action: () => Promise<AiChatSnapshot>, options: {
    before?: Partial<AiChatControllerState>
    onSuccess?: Partial<AiChatControllerState>
    resyncOn?: string[]
  }): Promise<boolean> {
    if (this.state.busy || this.state.status !== 'ready') return false
    const epoch = this.epoch
    this.patch({ ...options.before, busy: true, actionError: null })
    try {
      const snapshot = await action()
      if (epoch !== this.epoch) return false
      this.state = { ...this.state, ...options.onSuccess, busy: false }
      this.accept(snapshot, epoch)
      return true
    } catch (error) {
      if (epoch !== this.epoch) return false
      const code = aiChatErrorCode(error)
      if (code && options.resyncOn?.includes(code)) {
        this.patch({ busy: false, unsent: null, actionError: aiChatErrorMessage(code) })
        void this.refresh()
        return false
      }
      // Lỗi nghiệp vụ không thể gửi lại y nguyên (vd. hết hạn mức): bỏ mã gửi dở. Lỗi mạng: giữ để "Gửi lại" không tạo câu trùng.
      this.patch({ busy: false, actionError: describeError(error), ...(code && code !== AI_CHAT_UNAVAILABLE ? { unsent: null } : {}) })
      return false
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Danh sách "cần chú ý" của nhân viên: hội thoại còn câu chờ hoặc có kết quả chưa xem (chấm báo, biểu tượng chờ)
// ---------------------------------------------------------------------------------------------------------------------

export interface AiChatAttentionState { items: AiChatThread[]; loaded: boolean }

/** Số hội thoại có kết quả chưa xem. */
export function aiChatUnreadCount(items: readonly AiChatThread[]): number {
  return items.filter(thread => thread.unread).length
}

/** Hội thoại cần chú ý của một chiến dịch + agent (để mở lại thay vì tạo mới). */
export function aiChatAttentionFor(items: readonly AiChatThread[], campaignId: number | null, projectId?: number): AiChatThread | null {
  return items.find(thread => thread.campaignId === campaignId && (projectId === undefined || thread.projectId === projectId)) ?? null
}

/**
 * Một request cho mọi hội thoại cần chú ý của nhân viên. Chỉ tự hỏi lại (15 giây) khi còn câu đang chờ và đang hiển thị;
 * còn lại chỉ tải khi được gọi `refresh()` (mở trang, quay lại cửa sổ, sau khi gửi/nhận kết quả).
 */
export class AiChatAttentionController {
  private state: AiChatAttentionState = { items: [], loaded: false }
  private readonly listeners = new Set<() => void>()
  private timer: unknown = null
  private loading: Promise<void> | null = null
  private visible = true
  private disposed = false
  private lastLoadedAt = 0
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly deps: Pick<AiChatControllerDeps, 'transport' | 'now' | 'setTimer' | 'clearTimer'> & { pollMs?: number }) {
    this.now = deps.now ?? (() => Date.now())
    this.setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = deps.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  getState = (): AiChatAttentionState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Tải lại ngay; các lời gọi chồng nhau dùng chung một request. `minAgeMs` bỏ qua nếu vừa tải xong. */
  refresh(minAgeMs = 0): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.loading) return this.loading
    if (minAgeMs > 0 && this.state.loaded && this.now() - this.lastLoadedAt < minAgeMs) return Promise.resolve()
    this.stopTimer()
    this.loading = this.deps.transport.pending().then(list => {
      if (this.disposed) return
      this.lastLoadedAt = this.now()
      this.state = { items: list.items, loaded: true }
      Array.from(this.listeners).forEach(listener => listener())
    }).catch(() => { /* Chấm báo là phụ trợ: lỗi thì lần sau tải lại. */ }).finally(() => {
      this.loading = null
      this.schedule()
    })
    return this.loading
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (visible) void this.refresh(60_000)
    else this.stopTimer()
  }

  /** Xóa dữ liệu (đăng xuất/đổi tài khoản). */
  clear(): void {
    this.stopTimer()
    this.state = { items: [], loaded: false }
    this.lastLoadedAt = 0
    Array.from(this.listeners).forEach(listener => listener())
  }

  dispose(): void {
    this.disposed = true
    this.stopTimer()
    this.listeners.clear()
  }

  private stopTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  private schedule(): void {
    this.stopTimer()
    if (this.disposed || !this.visible || !this.state.items.some(thread => thread.pending)) return
    this.timer = this.setTimer(() => { this.timer = null; void this.refresh() }, this.deps.pollMs ?? 15_000)
  }
}
