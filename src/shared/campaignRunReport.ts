// Tab "Báo cáo" của chi tiết chiến dịch: hợp đồng RPC V487 và hàm dựng báo cáo dùng chung.
// Chép nguyên văn từ akaAgentWebApp packages/control-api/src/campaignRunReport.ts (Desktop không import được
// package WebApp); chỉ khác phần import và loại nền tảng (Desktop có thêm Facebook và Email). Sửa ở WebApp trước rồi chép lại.
import { ActionReportStatusCatalog, type ActionReportStatusSelector } from './actionStatusReport'
import {
  emptyEffectivenessCounts, friendFunnel, messageFunnel, type EffectivenessPlatform, type FriendFunnel, type MessageFunnel
} from './campaignEffectiveness'
import { EFFECTIVENESS_LEGACY_STATUSES } from './campaignEffectivenessAssembly'
type ControlPlatform = EffectivenessPlatform

/**
 * Tab "Báo cáo" trong chi tiết chiến dịch (Web, 09/11/2026). Số liệu đọc một lần bằng RPC chỉ đọc
 * akaAgent V487 `aka_agent_read_campaign_run_report` rồi dựng ở đây (hàm thuần, dùng chung API/iOS sau này).
 * Hai đơn vị: "data" (mỗi dòng Data ban đầu một lần) và "lượt" (mỗi dòng Kết quả chạy một lần).
 * Tổng data = tiến độ danh sách = Data ban đầu; tổng lượt = Kết quả chạy (cùng điều kiện lọc trong DB).
 */

export const CAMPAIGN_RUN_REPORT_UNAVAILABLE = 'Chưa tải được báo cáo của chiến dịch. Vui lòng thử lại.'
export const CAMPAIGN_RUN_REPORT_NOT_READY = 'Báo cáo đang được cập nhật. Vui lòng thử lại sau.'
export const CAMPAIGN_RUN_REPORT_BUSY = 'Hệ thống đang tổng hợp báo cáo khác. Vui lòng thử lại sau vài giây.'
export const CAMPAIGN_RUN_REPORT_TIMEOUT = 'Chiến dịch quá lớn để tổng hợp nhanh. Vui lòng thử lại sau.'

/** Nhóm kết quả của một lượt, theo thứ tự hiển thị (tốt → trung tính → chờ → xấu → khác). */
export type CampaignReportGroup = 'success' | 'skipped' | 'pending' | 'failure' | 'other'
export const CAMPAIGN_REPORT_GROUPS: readonly CampaignReportGroup[] = ['success', 'skipped', 'pending', 'failure', 'other']
export const CAMPAIGN_REPORT_GROUP_LABELS: Readonly<Record<CampaignReportGroup, string>> = {
  success: 'Thành công', skipped: 'Bỏ qua', pending: 'Chờ xác nhận', failure: 'Không thành công', other: 'Khác'
}

/** Kết quả của một data: hành động chính quyết định; thất bại xét trước bỏ qua. */
export type CampaignInputOutcome = 'success' | 'failure' | 'skipped' | 'pending' | 'other' | 'none'
export const CAMPAIGN_INPUT_OUTCOMES: readonly CampaignInputOutcome[] = ['success', 'failure', 'skipped', 'pending', 'other', 'none']
export const CAMPAIGN_INPUT_OUTCOME_LABELS: Readonly<Record<CampaignInputOutcome, string>> = {
  success: 'Thành công', failure: 'Không thành công', skipped: 'Bỏ qua', pending: 'Chờ xác nhận', other: 'Khác', none: 'Chưa có kết quả'
}

/** Trạng thái của data ban đầu (giá trị lưu trong DB) theo thứ tự hiển thị. */
export type CampaignInputStatusKey = 'completed' | 'running' | 'paused' | 'error' | 'waiting' | 'other'
export const CAMPAIGN_INPUT_STATUSES: ReadonlyArray<{ value: string; key: CampaignInputStatusKey; label: string }> = [
  { value: 'hoàn thành', key: 'completed', label: 'Hoàn thành' },
  { value: 'đang chạy', key: 'running', label: 'Đang chạy' },
  { value: 'tạm dừng', key: 'paused', label: 'Tạm dừng' },
  { value: 'lỗi', key: 'error', label: 'Lỗi' },
  { value: 'chờ xử lý', key: 'waiting', label: 'Chờ xử lý' }
]

/** Hành động phụ: chỉ quyết định kết quả của data khi data chưa có lượt của hành động chính (cùng journey-core). */
export const CAMPAIGN_REPORT_AUXILIARY_ACTION_CODES: readonly string[] = ['zalo_find_phone_user', 'zalo_tag_contact', 'zalo_change_alias']
/** Lượt thất bại vì mục tiêu không tồn tại (không có Zalo/không tìm thấy). */
export const CAMPAIGN_REPORT_NOT_FOUND_STATUSES: readonly string[] = ['không tồn tại']
export const CAMPAIGN_REPORT_NOT_FOUND_STATUS_CODES: readonly string[] = ['campaign_detail_not_found']
/** Trần số mốc dòng thời gian sau khi điền mốc trống (RPC đã chọn giờ ≤ 48 h, ngày ≤ 180 ngày, còn lại tuần). */
export const CAMPAIGN_REPORT_MAX_TIMELINE_POINTS = 400

/** `p_query` gửi cho V487: danh sách chữ trạng thái cũ giống V462 để mọi bề mặt đếm như nhau. */
export function campaignRunReportQuery() {
  return {
    legacy: {
      success: [...EFFECTIVENESS_LEGACY_STATUSES.success],
      skipped: [...EFFECTIVENESS_LEGACY_STATUSES.skipped],
      failure: [...EFFECTIVENESS_LEGACY_STATUSES.failure]
    },
    auxiliaryActionCodes: [...CAMPAIGN_REPORT_AUXILIARY_ACTION_CODES],
    notFoundStatuses: [...CAMPAIGN_REPORT_NOT_FOUND_STATUSES],
    notFoundStatusCodes: [...CAMPAIGN_REPORT_NOT_FOUND_STATUS_CODES]
  }
}

// ---------------------------------------------------------------------------
// Kết quả thô của RPC
// ---------------------------------------------------------------------------

export type CampaignReportTimelineUnit = 'hour' | 'day' | 'week'

export interface CampaignRunReportRpcGroupRow {
  actionCode: string | null
  actionName: string | null
  statusId: number | null
  legacyStatus: string | null
  subStatusId: number | null
  group: CampaignReportGroup
  count: number
  sampleStatus: string | null
}

export interface CampaignRunReportRpcEngagement {
  messageSent: number
  messageTracked: number
  responded: number
  reacted: number
  seen: number
  friendRequested: number
  friendTracked: number
  friended: number
}

export interface CampaignRunReportRpcResult {
  dbNow: string
  campaign: { id: number; status: string; createdAt: string | null }
  inputs: Array<{ status: string; count: number }>
  results: { total: number; firstAt: string | null; lastAt: string | null; groups: CampaignRunReportRpcGroupRow[] }
  timeline: { unit: CampaignReportTimelineUnit; points: Array<{ at: string; group: CampaignReportGroup; count: number }> }
  inputOutcomes: Array<{ status: string; outcome: CampaignInputOutcome; notFound: boolean; count: number }>
  engagement: CampaignRunReportRpcEngagement
  statuses: Array<{ id: number; code: string | null; name: string | null; statusValue: string | null }>
}

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const invalid = (what: string): never => { throw new Error(`Dữ liệu báo cáo chiến dịch không hợp lệ (${what}).`) }
const count = (value: unknown, what: string): number => {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : invalid(what)
}
const optionalId = (value: unknown, what: string): number | null => {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : invalid(what)
}
const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : String(value)
const optionalText = (value: unknown): string | null => typeof value === 'string' ? value : null
const list = (value: unknown, what: string): unknown[] => Array.isArray(value) ? value : invalid(what)
const GROUPS = new Set<string>(CAMPAIGN_REPORT_GROUPS)
const OUTCOMES = new Set<string>(CAMPAIGN_INPUT_OUTCOMES)
const UNITS = new Set<string>(['hour', 'day', 'week'])

/** Kiểm tra hình dạng JSON của V487; sai thì ném lỗi (API trả lỗi chung, không lộ dữ liệu). */
export function parseCampaignRunReportRpc(data: unknown): CampaignRunReportRpcResult {
  if (!isRow(data)) return invalid('root')
  const campaign = isRow(data.campaign) ? data.campaign : invalid('campaign')
  const results = isRow(data.results) ? data.results : invalid('results')
  const timeline = isRow(data.timeline) ? data.timeline : invalid('timeline')
  const engagement = isRow(data.engagement) ? data.engagement : {}
  const unit = text(timeline.unit)
  if (!UNITS.has(unit)) invalid('timeline.unit')
  return {
    dbNow: text(data.dbNow),
    campaign: { id: count(campaign.id, 'campaign.id'), status: text(campaign.status), createdAt: optionalText(campaign.createdAt) },
    inputs: list(data.inputs, 'inputs').map(row => {
      if (!isRow(row)) return invalid('inputs[]')
      return { status: text(row.status), count: count(row.count, 'inputs.count') }
    }),
    results: {
      total: count(results.total, 'results.total'),
      firstAt: optionalText(results.firstAt),
      lastAt: optionalText(results.lastAt),
      groups: list(results.groups, 'results.groups').map(row => {
        if (!isRow(row)) return invalid('results.groups[]')
        const group = text(row.group)
        if (!GROUPS.has(group)) invalid('results.groups.group')
        return {
          actionCode: optionalText(row.actionCode), actionName: optionalText(row.actionName),
          statusId: optionalId(row.statusId, 'statusId'), legacyStatus: optionalText(row.legacyStatus),
          subStatusId: optionalId(row.subStatusId, 'subStatusId'), group: group as CampaignReportGroup,
          count: count(row.count, 'results.groups.count'), sampleStatus: optionalText(row.sampleStatus)
        }
      })
    },
    timeline: {
      unit: unit as CampaignReportTimelineUnit,
      points: list(timeline.points, 'timeline.points').map(row => {
        if (!isRow(row)) return invalid('timeline.points[]')
        const group = text(row.group)
        if (!GROUPS.has(group)) invalid('timeline.points.group')
        return { at: text(row.at), group: group as CampaignReportGroup, count: count(row.count, 'timeline.points.count') }
      })
    },
    inputOutcomes: list(data.inputOutcomes ?? [], 'inputOutcomes').map(row => {
      if (!isRow(row)) return invalid('inputOutcomes[]')
      const outcome = text(row.outcome)
      if (!OUTCOMES.has(outcome)) invalid('inputOutcomes.outcome')
      return { status: text(row.status), outcome: outcome as CampaignInputOutcome, notFound: row.notFound === true,
        count: count(row.count, 'inputOutcomes.count') }
    }),
    engagement: {
      messageSent: count(engagement.messageSent ?? 0, 'messageSent'), messageTracked: count(engagement.messageTracked ?? 0, 'messageTracked'),
      responded: count(engagement.responded ?? 0, 'responded'), reacted: count(engagement.reacted ?? 0, 'reacted'),
      seen: count(engagement.seen ?? 0, 'seen'), friendRequested: count(engagement.friendRequested ?? 0, 'friendRequested'),
      friendTracked: count(engagement.friendTracked ?? 0, 'friendTracked'), friended: count(engagement.friended ?? 0, 'friended')
    },
    statuses: list(data.statuses ?? [], 'statuses').map(row => {
      if (!isRow(row)) return invalid('statuses[]')
      return { id: count(row.id, 'statuses.id'), code: optionalText(row.code), name: optionalText(row.name), statusValue: optionalText(row.statusValue) }
    })
  }
}

// ---------------------------------------------------------------------------
// Báo cáo trả về client
// ---------------------------------------------------------------------------

export type CampaignReportGroupCounts = Record<CampaignReportGroup, number>
export const emptyCampaignReportGroupCounts = (): CampaignReportGroupCounts => ({ success: 0, skipped: 0, pending: 0, failure: 0, other: 0 })

export interface CampaignRunReportInputStatus {
  /** Giá trị lưu trong DB (dùng làm bộ lọc của tab Data ban đầu). */
  status: string
  key: CampaignInputStatusKey
  label: string
  count: number
}

export interface CampaignRunReportOutcome {
  outcome: CampaignInputOutcome
  label: string
  count: number
  /** Trong số data không thành công: số data mà mục tiêu không tồn tại (không có Zalo/không tìm thấy). */
  notFound: number
}

export interface CampaignRunReportInputs {
  total: number
  /** Bằng `input_completed` của tiến độ danh sách. */
  completed: number
  /** Bằng `input_failed` của tiến độ danh sách. */
  failed: number
  byStatus: CampaignRunReportInputStatus[]
  /** Kết quả của data đã hoàn thành, đủ mọi kết quả (kể cả 0) theo thứ tự hiển thị. */
  completedOutcomes: CampaignRunReportOutcome[]
  /** Bảng chéo trạng thái data × kết quả (mọi trạng thái có data). */
  matrix: Array<{ status: string; label: string; counts: Record<CampaignInputOutcome, number>; notFound: number; total: number }>
}

export interface CampaignRunReportStatus {
  key: string
  label: string
  group: CampaignReportGroup
  count: number
  /** Bộ chọn giống báo cáo "Trạng thái hành động"; null với chip gộp "Chờ xác nhận". */
  selector: ActionReportStatusSelector | null
  /** Chữ lọc của tab Kết quả chạy (giá trị/tên trạng thái); null khi không lọc được bằng một chữ. */
  filterStatus: string | null
  /** Trạng thái phụ (chỉ "trong đó", không cộng thêm). */
  subStatuses: Array<{ label: string; count: number }>
}

export interface CampaignRunReportAction {
  key: string
  code: string | null
  name: string
  auxiliary: boolean
  /** Có trong danh sách hành động đã cấu hình của chiến dịch (như tab Hành động). */
  configured: boolean
  total: number
  groups: CampaignReportGroupCounts
  /** Thành công / (thành công + không thành công); null khi chưa có lượt nào trong hai nhóm này. */
  successRate: number | null
  /** Chip trạng thái có lượt, theo nhóm rồi số lượt. */
  statuses: CampaignRunReportStatus[]
  /** Ô của bảng: số lượt theo khóa cột; null = trạng thái không thuộc hành động này. */
  cells: Record<string, number | null>
}

export interface CampaignRunReportColumn { key: string; label: string }

export interface CampaignRunReportTimelinePoint { at: string; counts: CampaignReportGroupCounts; total: number }

export interface CampaignRunReportEngagement { message: MessageFunnel; friend: FriendFunnel }

export type CampaignRunReportAttentionTarget =
  | { tab: 'data'; status: string }
  | { tab: 'results'; status: string | null }

export interface CampaignRunReportAttention {
  key: string
  tone: 'bad' | 'wait'
  icon: 'x' | 'pause' | 'clock'
  count: number
  title: string
  detail: string
  cta: string
  target: CampaignRunReportAttentionTarget
}

export interface CampaignRunReport {
  campaignId: number
  /** Giờ DB lúc đọc. */
  generatedAt: string
  campaignStatus: string
  /** false: loại chiến dịch không dùng data đầu vào (Facebook đăng trang cá nhân/lướt newsfeed). */
  usesInputData: boolean
  inputs: CampaignRunReportInputs
  results: {
    total: number
    firstAt: string | null
    lastAt: string | null
    groups: CampaignReportGroupCounts
    /** Tỷ lệ thành công của hành động chính (chỉ hành động phụ thì tính trên chúng). */
    successRate: number | null
  }
  actions: CampaignRunReportAction[]
  /** Cột của bảng hành động × trạng thái: cột cấu hình theo thứ tự, cột lịch sử, cuối cùng "Chờ xác nhận". */
  columns: CampaignRunReportColumn[]
  timeline: { unit: CampaignReportTimelineUnit; points: CampaignRunReportTimelinePoint[] }
  /** null khi chiến dịch không có lượt thành công của nhắn tin/kết bạn Zalo. */
  engagement: CampaignRunReportEngagement | null
  /** Tối đa 3 việc nên xem, xếp theo số lượng. */
  attention: CampaignRunReportAttention[]
}

export interface BuildCampaignRunReportInput {
  rpc: CampaignRunReportRpcResult
  /** Danh mục trạng thái của báo cáo "Trạng thái hành động"; null khi không tải được (vẫn dựng bằng tên đã ghi). */
  catalog: ActionReportStatusCatalog | null
  /** `flatform_type` của tài khoản chiến dịch (zalo, sms, facebook…). */
  platform: string
  usesInputData: boolean
  /** Hành động đã cấu hình theo thứ tự chạy (campaignAccountActionCodes). */
  configuredActionCodes: readonly string[]
  /** Tên dự phòng khi kết quả chưa ghi tên hành động. */
  actionNames?: Readonly<Record<string, string>>
}

const PENDING_COLUMN: CampaignRunReportColumn = { key: 'pending', label: CAMPAIGN_REPORT_GROUP_LABELS.pending }
const NO_ACTION_KEY = '__no_action__'
const ACTION_UNITS: Readonly<Record<string, string>> = {
  zalo_message_friend: 'tin nhắn', zalo_message_stranger: 'tin nhắn', zalo_message_group: 'tin nhắn vào group',
  zalo_add_friend: 'lời mời kết bạn', sms_send: 'SMS', voice_call: 'cuộc gọi', zalo_add_group_member: 'lượt thêm thành viên',
  zalo_join_group_link: 'lượt tham gia group', zalo_cancel_sent_friend_request: 'lượt huỷ lời mời'
}

const rate = (success: number, failure: number): number | null => success + failure > 0 ? success / (success + failure) : null

/** Ngày giờ của mốc tiếp theo, theo chuỗi mốc RPC trả (giờ Việt Nam, không múi giờ). */
function nextBucket(at: string, unit: CampaignReportTimelineUnit): string | null {
  const iso = unit === 'hour' ? `${at}:00Z` : `${at}T00:00:00Z`
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  const next = new Date(time + (unit === 'hour' ? 3_600_000 : unit === 'day' ? 86_400_000 : 7 * 86_400_000)).toISOString()
  return unit === 'hour' ? next.slice(0, 13) + ':00' : next.slice(0, 10)
}

/** Điền mốc trống giữa mốc đầu và cuối để trục thời gian đều; giữ nguyên nếu vượt trần. */
function timelinePoints(rpc: CampaignRunReportRpcResult['timeline']): CampaignRunReportTimelinePoint[] {
  const byAt = new Map<string, CampaignRunReportTimelinePoint>()
  for (const point of rpc.points) {
    const entry = byAt.get(point.at) || { at: point.at, counts: emptyCampaignReportGroupCounts(), total: 0 }
    entry.counts[point.group] += point.count
    entry.total += point.count
    byAt.set(point.at, entry)
  }
  const sorted = Array.from(byAt.values()).sort((a, b) => a.at.localeCompare(b.at))
  if (sorted.length < 2) return sorted
  const filled: CampaignRunReportTimelinePoint[] = []
  let cursor: string | null = sorted[0].at
  const last = sorted[sorted.length - 1].at
  while (cursor && cursor <= last && filled.length <= CAMPAIGN_REPORT_MAX_TIMELINE_POINTS) {
    filled.push(byAt.get(cursor) || { at: cursor, counts: emptyCampaignReportGroupCounts(), total: 0 })
    cursor = nextBucket(cursor, rpc.unit)
  }
  return filled.length > CAMPAIGN_REPORT_MAX_TIMELINE_POINTS || filled[filled.length - 1]?.at !== last ? sorted : filled
}

function inputSummary(rpc: CampaignRunReportRpcResult): CampaignRunReportInputs {
  const byValue = new Map<string, number>()
  for (const row of rpc.inputs) byValue.set(row.status, (byValue.get(row.status) || 0) + row.count)
  const known = new Set(CAMPAIGN_INPUT_STATUSES.map(status => status.value))
  const byStatus: CampaignRunReportInputStatus[] = [
    ...CAMPAIGN_INPUT_STATUSES.filter(status => (byValue.get(status.value) || 0) > 0)
      .map(status => ({ status: status.value, key: status.key, label: status.label, count: byValue.get(status.value) || 0 })),
    ...Array.from(byValue.entries()).filter(([value, n]) => !known.has(value) && n > 0)
      .sort(([a], [b]) => a.localeCompare(b, 'vi'))
      .map(([value, n]) => ({ status: value, key: 'other' as const, label: value ? `Khác (${value})` : 'Khác', count: n }))
  ]
  const matrixByStatus = new Map<string, { counts: Record<CampaignInputOutcome, number>; notFound: number }>()
  for (const row of rpc.inputOutcomes) {
    const entry = matrixByStatus.get(row.status) || {
      counts: { success: 0, failure: 0, skipped: 0, pending: 0, other: 0, none: 0 }, notFound: 0
    }
    entry.counts[row.outcome] += row.count
    if (row.outcome === 'failure' && row.notFound) entry.notFound += row.count
    matrixByStatus.set(row.status, entry)
  }
  const completed = matrixByStatus.get('hoàn thành')
  return {
    total: byStatus.reduce((sum, status) => sum + status.count, 0),
    completed: byValue.get('hoàn thành') || 0,
    failed: byValue.get('lỗi') || 0,
    byStatus,
    completedOutcomes: CAMPAIGN_INPUT_OUTCOMES.map(outcome => ({
      outcome, label: CAMPAIGN_INPUT_OUTCOME_LABELS[outcome], count: completed?.counts[outcome] || 0,
      notFound: outcome === 'failure' ? completed?.notFound || 0 : 0
    })),
    matrix: byStatus.map(status => {
      const entry = matrixByStatus.get(status.status)
      const counts = entry?.counts || { success: 0, failure: 0, skipped: 0, pending: 0, other: 0, none: status.count }
      return { status: status.status, label: status.label, counts, notFound: entry?.notFound || 0, total: status.count }
    })
  }
}

interface ColumnAccumulator {
  key: string
  label: string
  selector: ActionReportStatusSelector | null
  filterStatus: string | null
  count: number
  groups: CampaignReportGroupCounts
  subStatuses: Map<string, number>
}

/** Dựng báo cáo từ kết quả V487: một hàm thuần, không đọc DB, không phụ thuộc giờ máy. */
export function buildCampaignRunReport(input: BuildCampaignRunReportInput): CampaignRunReport {
  const { rpc, catalog, platform } = input
  const statusById = new Map(rpc.statuses.map(status => [status.id, status]))
  const auxiliary = new Set(CAMPAIGN_REPORT_AUXILIARY_ACTION_CODES)
  const configured = Array.from(new Set(input.configuredActionCodes))

  // Hành động: theo thứ tự chạy, rồi hành động lịch sử theo tên, cuối cùng "không rõ hành động".
  const perAction = new Map<string, { code: string | null; name: string | null; columns: Map<string, ColumnAccumulator>; groups: CampaignReportGroupCounts; total: number }>()
  const ensureAction = (code: string | null) => {
    const key = code ?? NO_ACTION_KEY
    let entry = perAction.get(key)
    if (!entry) perAction.set(key, entry = { code, name: null, columns: new Map(), groups: emptyCampaignReportGroupCounts(), total: 0 })
    return entry
  }
  for (const code of configured) ensureAction(code)

  for (const row of rpc.results.groups) {
    const action = ensureAction(row.actionCode)
    if (row.actionName && !action.name) action.name = row.actionName
    action.groups[row.group] += row.count
    action.total += row.count
    let column: { key: string; label: string; selector: ActionReportStatusSelector | null; filterStatus: string | null }
    if (row.group === 'pending') {
      column = { ...PENDING_COLUMN, selector: { kind: 'pending' }, filterStatus: null }
    } else {
      const raw = row.legacyStatus ?? row.sampleStatus ?? ''
      const resolved = catalog
        ? catalog.column(row.statusId, raw, platform)
        : row.statusId
          ? { key: `status:${row.statusId}`, label: '', selector: { kind: 'status' as const, statusId: row.statusId } }
          : { key: `legacy:${JSON.stringify(raw)}`, label: raw || 'Chưa xác định', selector: { kind: 'legacy' as const, status: raw } }
      const stored = resolved.selector.kind === 'status' ? statusById.get(resolved.selector.statusId) : undefined
      const label = resolved.selector.kind === 'status'
        ? (catalog && catalog.label(resolved.selector) !== 'Trạng thái đã lưu' ? catalog.label(resolved.selector) : '')
          || stored?.name || row.sampleStatus || 'Trạng thái đã lưu'
        : resolved.label
      column = {
        key: resolved.key, label, selector: resolved.selector,
        filterStatus: resolved.selector.kind === 'legacy' ? resolved.selector.status || null : stored?.statusValue || stored?.name || row.sampleStatus || null
      }
    }
    let accumulator = action.columns.get(column.key)
    if (!accumulator) {
      action.columns.set(column.key, accumulator = { ...column, count: 0, groups: emptyCampaignReportGroupCounts(), subStatuses: new Map() })
    }
    accumulator.count += row.count
    accumulator.groups[row.group] += row.count
    if (row.subStatusId) {
      const subLabel = statusById.get(row.subStatusId)?.name || 'Trạng thái phụ'
      accumulator.subStatuses.set(subLabel, (accumulator.subStatuses.get(subLabel) || 0) + row.count)
    }
  }

  // Cột của bảng: cột cấu hình (thứ tự danh mục) cho từng hành động, rồi cột lịch sử, cuối cùng "Chờ xác nhận".
  const columnOrder: CampaignRunReportColumn[] = []
  const seenColumns = new Set<string>()
  const configuredColumns = new Map<string, Set<string>>()
  for (const [key, action] of Array.from(perAction.entries())) {
    if (!catalog || !action.code) continue
    const keys = new Set<string>()
    for (const column of catalog.configured({ code: action.code, name: action.name || action.code, flatformType: platform as ControlPlatform })) {
      if (column.key === 'pending') continue
      keys.add(column.key)
      if (!seenColumns.has(column.key)) { seenColumns.add(column.key); columnOrder.push({ key: column.key, label: column.label }) }
    }
    configuredColumns.set(key, keys)
  }
  // Cột lịch sử (không có trong danh mục, hoặc không tải được danh mục): theo nhóm như chip rồi theo tên.
  const groupRank = (counts: CampaignReportGroupCounts): CampaignReportGroup =>
    CAMPAIGN_REPORT_GROUPS.reduce((best, group) => counts[group] > counts[best] ? group : best, 'other' as CampaignReportGroup)
  const historical = new Map<string, CampaignRunReportColumn & { groups: CampaignReportGroupCounts }>()
  for (const action of Array.from(perAction.values())) {
    for (const column of Array.from(action.columns.values())) {
      if (column.key === 'pending' || seenColumns.has(column.key)) continue
      let entry = historical.get(column.key)
      if (!entry) historical.set(column.key, entry = { key: column.key, label: column.label, groups: emptyCampaignReportGroupCounts() })
      for (const group of CAMPAIGN_REPORT_GROUPS) entry.groups[group] += column.groups[group]
    }
  }
  const historicalColumns = Array.from(historical.values()).sort((a, b) =>
    CAMPAIGN_REPORT_GROUPS.indexOf(groupRank(a.groups)) - CAMPAIGN_REPORT_GROUPS.indexOf(groupRank(b.groups))
    || a.label.localeCompare(b.label, 'vi') || a.key.localeCompare(b.key))
  // Nhãn cột lấy theo dữ liệu thật khi có (danh mục có thể đổi tên).
  const labelOf = new Map<string, string>()
  for (const action of Array.from(perAction.values())) for (const column of Array.from(action.columns.values())) labelOf.set(column.key, column.label)
  const columns = [...columnOrder, ...historicalColumns].map(column => ({ key: column.key, label: labelOf.get(column.key) || column.label }))
  columns.push(PENDING_COLUMN)

  const configuredIndex = new Map(configured.map((code, index) => [code, index]))
  const actions: CampaignRunReportAction[] = Array.from(perAction.entries()).map(([key, action]) => {
    const name = action.name || (action.code ? input.actionNames?.[action.code] || action.code : 'Không rõ hành động')
    const statuses: CampaignRunReportStatus[] = Array.from(action.columns.values()).map(column => ({
      key: column.key, label: column.label, group: column.key === 'pending' ? 'pending' as const : groupRank(column.groups),
      count: column.count, selector: column.selector, filterStatus: column.filterStatus,
      subStatuses: Array.from(column.subStatuses.entries()).map(([label, n]) => ({ label, count: n })).sort((a, b) => b.count - a.count)
    })).sort((a, b) => CAMPAIGN_REPORT_GROUPS.indexOf(a.group) - CAMPAIGN_REPORT_GROUPS.indexOf(b.group) || b.count - a.count
      || a.label.localeCompare(b.label, 'vi'))
    const configuredKeys = configuredColumns.get(key)
    const cells: Record<string, number | null> = {}
    for (const column of columns) {
      const value = action.columns.get(column.key)?.count
      cells[column.key] = value ?? (column.key === 'pending' || configuredKeys?.has(column.key) ? 0 : null)
    }
    return {
      key, code: action.code, name, auxiliary: !!action.code && auxiliary.has(action.code), configured: !!action.code && configuredIndex.has(action.code),
      total: action.total, groups: action.groups, successRate: rate(action.groups.success, action.groups.failure), statuses, cells
    }
  }).sort((a, b) => {
    const rank = (action: CampaignRunReportAction) => action.code === null ? 2 : configuredIndex.has(action.code) ? 0 : 1
    return rank(a) - rank(b) || (configuredIndex.get(a.code || '') ?? 0) - (configuredIndex.get(b.code || '') ?? 0) || a.name.localeCompare(b.name, 'vi')
  })

  const resultGroups = emptyCampaignReportGroupCounts()
  for (const action of actions) for (const group of CAMPAIGN_REPORT_GROUPS) resultGroups[group] += action.groups[group]
  const main = actions.filter(action => !action.auxiliary)
  const rateSource = main.some(action => action.groups.success + action.groups.failure > 0) ? main : actions
  const successRate = rate(rateSource.reduce((sum, action) => sum + action.groups.success, 0), rateSource.reduce((sum, action) => sum + action.groups.failure, 0))

  const engagementSource = rpc.engagement
  const engagement = engagementSource.messageSent + engagementSource.friendRequested > 0 ? {
    message: messageFunnel({ ...emptyEffectivenessCounts(), success: engagementSource.messageSent, tracked: engagementSource.messageTracked,
      responded: engagementSource.responded, reacted: engagementSource.reacted, seen: engagementSource.seen }),
    friend: friendFunnel({ ...emptyEffectivenessCounts(), success: engagementSource.friendRequested, tracked: engagementSource.friendTracked,
      friended: engagementSource.friended })
  } : null

  const inputs = inputSummary(rpc)
  const report: CampaignRunReport = {
    campaignId: rpc.campaign.id,
    generatedAt: rpc.dbNow,
    campaignStatus: rpc.campaign.status,
    usesInputData: input.usesInputData,
    inputs,
    results: { total: rpc.results.total, firstAt: rpc.results.firstAt, lastAt: rpc.results.lastAt, groups: resultGroups, successRate },
    actions,
    columns,
    timeline: { unit: rpc.timeline.unit, points: timelinePoints(rpc.timeline) },
    engagement,
    attention: []
  }
  report.attention = campaignRunReportAttention(report)
  return report
}

const fmt = (value: number) => value.toLocaleString('vi-VN')

/** "Cần chú ý": tối đa 3 việc từ chính số liệu báo cáo, xếp theo số lượng (không đọc thêm). */
export function campaignRunReportAttention(report: Pick<CampaignRunReport, 'actions' | 'inputs' | 'usesInputData'>, limit = 3): CampaignRunReportAttention[] {
  const items: CampaignRunReportAttention[] = []
  for (const action of report.actions) {
    const failures = action.statuses.filter(status => status.group === 'failure')
    if (!failures.length) continue
    const notFound = failures.filter(status => status.filterStatus && CAMPAIGN_REPORT_NOT_FOUND_STATUSES.includes(status.filterStatus))
    const others = failures.filter(status => !notFound.includes(status))
    if (notFound.length && action.code === 'zalo_find_phone_user') {
      const n = notFound.reduce((sum, status) => sum + status.count, 0)
      const tried = action.groups.success + action.groups.failure
      items.push({
        key: `not_found:${action.key}`, tone: 'bad', icon: 'x', count: n, title: `${fmt(n)} SĐT không có Zalo`,
        detail: tried > 0 ? `${Math.max(1, Math.round(n / tried * 100))}% số đã tra ở bước ${action.name}` : action.name,
        cta: 'Xem danh sách', target: { tab: 'results', status: notFound[0].filterStatus }
      })
    }
    const rest = action.code === 'zalo_find_phone_user' ? others : failures
    const n = rest.reduce((sum, status) => sum + status.count, 0)
    if (n > 0) {
      const unit = action.code ? ACTION_UNITS[action.code] : undefined
      const top = rest.slice().sort((a, b) => b.count - a.count)
      items.push({
        key: `failure:${action.key}`, tone: 'bad', icon: 'x', count: n,
        title: unit ? `${fmt(n)} ${unit} không gửi được` : `${fmt(n)} lượt ${action.name} không thành công`,
        detail: top.slice(0, 3).map(status => `${status.label} ${fmt(status.count)}`).join(' · '),
        cta: 'Xem lý do', target: { tab: 'results', status: top[0].filterStatus }
      })
    }
  }
  if (report.usesInputData) {
    const paused = report.inputs.byStatus.find(status => status.key === 'paused')
    if (paused && paused.count > 0) {
      items.push({ key: 'paused', tone: 'wait', icon: 'pause', count: paused.count, title: `${fmt(paused.count)} data đang tạm dừng`,
        detail: 'Sẽ không chạy cho tới khi bật lại', cta: 'Xem data', target: { tab: 'data', status: paused.status } })
    }
    const errored = report.inputs.byStatus.find(status => status.key === 'error')
    if (errored && errored.count > 0) {
      items.push({ key: 'error', tone: 'bad', icon: 'x', count: errored.count, title: `${fmt(errored.count)} data lỗi`,
        detail: 'Xem ghi chú từng dòng ở Data ban đầu', cta: 'Xem data', target: { tab: 'data', status: errored.status } })
    }
  }
  const pending = report.actions.reduce((sum, action) => sum + action.groups.pending, 0)
  if (pending > 0) {
    items.push({ key: 'pending', tone: 'wait', icon: 'clock', count: pending, title: `${fmt(pending)} lượt chờ xác nhận`,
      detail: 'Thường có kết quả sau vài phút', cta: 'Xem kết quả', target: { tab: 'results', status: null } })
  }
  return items.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, limit)
}
