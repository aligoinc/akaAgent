export const CAMPAIGN_DIAGNOSTICS_IPC = {
  read: 'campaign:diagnostics:read', ai: 'campaign:diagnostics:ai', cancel: 'campaign:diagnostics:cancel'
} as const
export const DIAGNOSTICS_TTL_MS = 5 * 60_000
export const DIAGNOSTICS_AI_CODE = 'app_campaign_diagnostics'
export const DIAGNOSTICS_MODEL = 'gpt-6.1-sol'
export const DIAGNOSTICS_ACTIONS = {
  account: 'Kiểm tra tài khoản', login: 'Đăng nhập / cấu hình tài khoản',
  accountActions: 'Quản lý hành động tài khoản', schedule: 'Sửa lịch chạy',
  limits: 'Sửa giới hạn', content: 'Cập nhật nội dung và media',
  data: 'Kiểm tra data đầu vào', importData: 'Bổ sung data', results: 'Xem kết quả chạy', history: 'Xem lịch sử chạy',
  randomSettings: 'Cài đặt chạy ngẫu nhiên'
} as const
const diagnosticDateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  day: '2-digit', month: '2-digit', year: 'numeric'
})
export function formatDiagnosticTime(value: string | null | undefined, emptyLabel = 'Chưa xác minh'): string {
  if (!value) return emptyLabel
  const time = Date.parse(value)
  return Number.isFinite(time) ? diagnosticDateTime.format(time) : 'Chưa xác minh'
}
export type DiagnosticAction = keyof typeof DIAGNOSTICS_ACTIONS
export type DiagnosticSeverity = 'ok' | 'info' | 'warning' | 'blocking' | 'unknown'
export interface DiagnosticIssue {
  id: string
  title: string
  severity: DiagnosticSeverity
  problem: string
  cause: string
  explanation: string
  solution: string
  actions: DiagnosticAction[]
  evidence?: string[]
}
export interface DiagnosticQuota {
  code: string
  name: string
  checked: boolean
  disabled: boolean
  reason: string | null
  enableAt: string | null
  dayUsed: number
  dayLimit: number
  windowUsed: number | null
  windowLimit: number
  windowMinutes: number
}
export interface DiagnosticScheduleContext {
  evaluatedAt: string | null
  timeZone: 'Asia/Ho_Chi_Minh'
  sourceMode: 'direct' | 'data_group' | 'unknown'
  endDatePolicy: 'completion_and_recurrence' | 'hard_end' | 'unknown'
  endDateState: 'not_set' | 'future' | 'reached' | 'unknown'
  explanation: string
}
export interface CampaignDiagnosticsSnapshot {
  id: string
  campaignId: number
  accountId: number
  version: string
  checkedAt: string
  expiresAt: string
  campaignStatus: string
  headline: string
  complete: boolean
  checks: DiagnosticIssue[]
  quotas: DiagnosticQuota[]
  facts: {
    facebookRandomRun?: FacebookRandomConfigurationCheck | null
    schedule: DiagnosticScheduleContext | null
    campaign: Record<string, unknown>
    account: Record<string, unknown> | null
    action: Record<string, unknown> | null
    accountHistory: Record<string, unknown>[] | null
    campaignHistory: string[] | null
    results: Record<string, unknown>[] | null
    inputSummary: Record<string, number> | null
    inputs: Record<string, unknown>[] | null
  }
}
export interface CampaignDiagnosticsRequest { campaignId: number; requestId: string }
export interface CampaignDiagnosticsAiRequest extends CampaignDiagnosticsRequest { snapshotId: string }
export interface CampaignDiagnosticsAiResult {
  snapshot: CampaignDiagnosticsSnapshot
  generatedAt: string
  model: string
  summary: string
  issues: DiagnosticIssue[]
}

// Basic masking only, as requested: known object fields and same-line credentials.
// Do not parse embedded JSON, reconstruct log events or infer missing credential labels.
const secretField = /password|passwd|^pass$|cookie|token|secret|api.?key|authorization|session|imei|credential|zpsid|zpw_sek|private.?key/i
export function sanitizeDiagnosticText(value: string): string {
  // Bound work before matching. Literal field names avoid the former generic key scanner.
  return value.slice(0, 8000)
    .replace(/(\b(?:password|passwd|pass|set-cookie|cookies?|proxy-authorization|authorization|access_token|refresh_token|token|secret|api[_-]?key|session|imei|zpsid|zpw_sek)["']?[ \t]*[:=])[^\r\n]*/gi, '$1 [ẩn]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[ẩn]@')
    .replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, '[media]')
    .replace(/<!--\s*screenshotEventId:[\s\S]*?-->/g, '')
    .replace(/Bearer[ \t]+[^\s,;"']+/gi, 'Bearer [ẩn]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[ẩn]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[ẩn]')
    .replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]+/gi, '$1?[ẩn tham số]').slice(0, 8000)
}
export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[rút gọn]'
  if (typeof value === 'string') return sanitizeDiagnosticText(value)
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeDiagnosticValue(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secretField.test(key))
    .map(([key, item]) => [key, sanitizeDiagnosticValue(item, depth + 1)]))
  return value
}

export function sanitizeCampaignDiagnosticsSnapshot(snapshot: CampaignDiagnosticsSnapshot): CampaignDiagnosticsSnapshot {
  return sanitizeDiagnosticValue({ ...snapshot, facts: { ...snapshot.facts,
    campaignHistory: snapshot.facts.campaignHistory?.slice(0, 30) ?? null
  } }) as CampaignDiagnosticsSnapshot
}

export function parseDiagnosticAiResponse(content: string): Pick<CampaignDiagnosticsAiResult, 'summary' | 'issues'> {
  const data = JSON.parse(content) as Record<string, unknown>
  if (!data || typeof data.summary !== 'string' || !data.summary.trim() || !Array.isArray(data.issues) || data.issues.length > 12) {
    throw new Error('AI trả kết quả chưa đúng định dạng. Vui lòng thử lại.')
  }
  const issues = data.issues.map((item: unknown, index): DiagnosticIssue => {
    if (!item || typeof item !== 'object') throw new Error('Kết quả AI không hợp lệ.')
    const row = item as Record<string, unknown>
    for (const field of ['title', 'problem', 'cause', 'explanation', 'solution']) {
      if (typeof row[field] !== 'string' || !String(row[field]).trim()) throw new Error('AI chưa trả đủ các phần giải thích.')
    }
    if (!['ok', 'info', 'warning', 'blocking', 'unknown'].includes(String(row.severity)) || !Array.isArray(row.actions)
      || row.actions.some(action => typeof action !== 'string' || !Object.hasOwn(DIAGNOSTICS_ACTIONS, action))) {
      throw new Error('AI đề xuất thao tác chưa được hỗ trợ.')
    }
    return { id: `ai-${index}`, title: sanitizeDiagnosticText(String(row.title)), severity: row.severity as DiagnosticSeverity,
      problem: sanitizeDiagnosticText(String(row.problem)), cause: sanitizeDiagnosticText(String(row.cause)),
      explanation: sanitizeDiagnosticText(String(row.explanation)), solution: sanitizeDiagnosticText(String(row.solution)),
      actions: Array.from(new Set(row.actions as DiagnosticAction[])) }
  })
  return { summary: sanitizeDiagnosticText(data.summary), issues }
}
import type { FacebookRandomConfigurationCheck } from './facebookRandomRunDiagnostics'
