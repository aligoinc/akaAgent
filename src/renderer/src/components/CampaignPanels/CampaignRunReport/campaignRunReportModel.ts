// Chép từ akaAgentWebApp apps/web/src/features/campaignReport/campaignReportModel.ts; chỉ khác import và dòng chiến dịch
// của danh sách Desktop (CampaignListItem) ở gợi ý "Có số liệu mới". Sửa ở WebApp trước rồi chép lại.
import {
  CAMPAIGN_INPUT_OUTCOMES, CAMPAIGN_REPORT_GROUPS, CAMPAIGN_REPORT_GROUP_LABELS,
  type CampaignInputOutcome, type CampaignInputStatusKey, type CampaignReportGroup, type CampaignReportGroupCounts,
  type CampaignReportTimelineUnit, type CampaignRunReport, type CampaignRunReportTimelinePoint
} from '../../../../../shared/campaignRunReport'
import type { CampaignListItem } from '../../../../../shared/types'

/**
 * Mô hình hiển thị của tab "Báo cáo" (hàm thuần, không đọc API). Số liệu đến từ một lượt đọc
 * IPC `report:campaign-run` (RPC V487); ở đây chỉ định dạng, chọn màu và dựng trục thời gian.
 */

/** Vai trò màu trạng thái (token CSS `--rpt-<tone>` dưới `.campaign-report-view`). */
export type ReportTone = 'good' | 'progress' | 'neutral' | 'wait' | 'bad' | 'track'
export type ReportIcon = 'check' | 'play' | 'pause' | 'x' | 'dashed' | 'minus' | 'clock' | 'db' | 'flag' | 'zap'

export const INPUT_STATUS_STYLE: Readonly<Record<CampaignInputStatusKey, { tone: ReportTone; icon: ReportIcon }>> = {
  completed: { tone: 'good', icon: 'check' },
  running: { tone: 'progress', icon: 'play' },
  paused: { tone: 'wait', icon: 'pause' },
  error: { tone: 'bad', icon: 'x' },
  waiting: { tone: 'track', icon: 'dashed' },
  other: { tone: 'neutral', icon: 'minus' }
}

export const OUTCOME_STYLE: Readonly<Record<CampaignInputOutcome, { tone: ReportTone; icon: ReportIcon }>> = {
  success: { tone: 'good', icon: 'check' },
  failure: { tone: 'bad', icon: 'x' },
  skipped: { tone: 'neutral', icon: 'minus' },
  pending: { tone: 'wait', icon: 'clock' },
  other: { tone: 'neutral', icon: 'minus' },
  none: { tone: 'track', icon: 'dashed' }
}

export const GROUP_STYLE: Readonly<Record<CampaignReportGroup, { tone: ReportTone; icon: ReportIcon }>> = {
  success: { tone: 'good', icon: 'check' },
  skipped: { tone: 'neutral', icon: 'minus' },
  pending: { tone: 'wait', icon: 'clock' },
  failure: { tone: 'bad', icon: 'x' },
  other: { tone: 'neutral', icon: 'minus' }
}

export const formatReportNumber = (value: number) => value.toLocaleString('vi-VN')

/** Phần trăm làm tròn; không bao giờ in 0% cho phần khác 0 hay 100% cho phần chưa đủ. */
export function formatReportPercent(part: number, total: number): string {
  if (total <= 0) return '0%'
  const value = Math.round(part / total * 100)
  if (part > 0 && value === 0) return '<1%'
  if (part < total && value === 100) return '>99%'
  return `${value}%`
}

export const formatReportRate = (rate: number | null) => rate === null ? '—' : formatReportPercent(Math.round(rate * 1000), 1000)

const VN_OFFSET_MS = 7 * 3_600_000
const pad = (value: number) => String(value).padStart(2, '0')
/** Giờ Việt Nam của một mốc ISO bất kỳ. */
function vietnamParts(iso: string) {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  const date = new Date(time + VN_OFFSET_MS)
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), h: date.getUTCHours(), min: date.getUTCMinutes(), s: date.getUTCSeconds() }
}

/** "HH:mm:ss" giờ Việt Nam (giờ DB của lượt đọc). */
export function formatReportClock(iso: string): string {
  const parts = vietnamParts(iso)
  return parts ? `${pad(parts.h)}:${pad(parts.min)}:${pad(parts.s)}` : ''
}

/** "DD/MM/YYYY HH:mm" giờ Việt Nam. */
export function formatReportDateTime(iso: string | null): string {
  const parts = iso ? vietnamParts(iso) : null
  return parts ? `${pad(parts.h)}:${pad(parts.min)} ${pad(parts.d)}/${pad(parts.m)}/${parts.y}` : ''
}

// Mốc của dòng thời gian: chuỗi giờ Việt Nam không múi giờ ("YYYY-MM-DDTHH:00" hoặc "YYYY-MM-DD").
const bucketDate = (at: string) => {
  const match = at.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}))?/)
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]), h: match[4] ? Number(match[4]) : 0 } : null
}
const addDays = (at: string, days: number) => {
  const time = Date.parse(`${at.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(time) ? new Date(time + days * 86_400_000).toISOString().slice(0, 10) : at
}
const dayMonth = (at: string) => { const b = bucketDate(at); return b ? `${pad(b.d)}/${pad(b.m)}` : at }
const fullDay = (at: string) => { const b = bucketDate(at); return b ? `${pad(b.d)}/${pad(b.m)}/${b.y}` : at }

export const TIMELINE_UNIT_LABELS: Readonly<Record<CampaignReportTimelineUnit, string>> = { hour: 'Theo giờ', day: 'Theo ngày', week: 'Theo tuần' }

/** Nhãn ngắn của một cột trên trục x; theo giờ chỉ ghi ngày ở nhãn đầu và khi sang ngày mới. */
export function timelineTick(at: string, unit: CampaignReportTimelineUnit, previousAt: string | null = null): string {
  const b = bucketDate(at)
  if (!b) return at
  if (unit !== 'hour') return dayMonth(at)
  return previousAt && previousAt.slice(0, 10) === at.slice(0, 10) ? `${pad(b.h)}h` : `${pad(b.h)}h ${pad(b.d)}/${pad(b.m)}`
}

/** Tiêu đề đầy đủ của một cột (tooltip, bảng, Excel). */
export function timelineTitle(at: string, unit: CampaignReportTimelineUnit): string {
  const b = bucketDate(at)
  if (!b) return at
  if (unit === 'hour') return `${pad(b.h)}:00–${pad((b.h + 1) % 24)}:00 ${fullDay(at)}`
  if (unit === 'day') return fullDay(at)
  return `Tuần ${dayMonth(at)} – ${fullDay(addDays(at, 6))}`
}

/** Câu thay biểu đồ khi mọi lượt rơi vào một mốc. */
export function timelineSingleSentence(point: CampaignRunReportTimelinePoint, unit: CampaignReportTimelineUnit): string {
  const n = formatReportNumber(point.total)
  const b = bucketDate(point.at)
  if (unit === 'hour' && b) return `Toàn bộ ${n} lượt trong khoảng ${pad(b.h)}:00–${pad((b.h + 1) % 24)}:00 ngày ${fullDay(point.at)}.`
  if (unit === 'day') return `Toàn bộ ${n} lượt trong ngày ${fullDay(point.at)}.`
  return `Toàn bộ ${n} lượt trong ${timelineTitle(point.at, unit).toLowerCase()}.`
}

/** Khoảng ngày của dòng thời gian cho dòng phụ đề: "27/10 – 09/11". */
export function timelineRange(points: readonly CampaignRunReportTimelinePoint[], unit: CampaignReportTimelineUnit): string {
  if (!points.length) return ''
  const first = points[0].at
  const last = unit === 'week' ? addDays(points[points.length - 1].at, 6) : points[points.length - 1].at
  const a = dayMonth(first), b = dayMonth(last)
  return a === b ? fullDay(first) : `${a} – ${b}`
}

/** Vạch trục y "đẹp": 0 và 4 mốc chia đều tới số tròn ≥ giá trị lớn nhất. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const rough = max / count
  const power = 10 ** Math.floor(Math.log10(rough))
  // 2,5 chỉ dùng khi bước ≥ 25 để vạch luôn là số nguyên.
  const multipliers = power >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10]
  const step = multipliers.map(m => m * power).find(candidate => candidate >= rough) ?? 10 * power
  const niceStep = Math.max(1, Math.ceil(step))
  return Array.from({ length: Math.ceil(max / niceStep) + 1 }, (_, index) => index * niceStep)
}

/** Chỉ số các cột được in nhãn trục x: bước đều, tối đa `max` nhãn, nhãn cuối luôn là cột cuối. */
export function tickIndexes(length: number, max = 8): number[] {
  if (length <= max) return Array.from({ length }, (_, index) => index)
  const step = Math.ceil((length - 1) / (max - 1))
  const indexes: number[] = []
  for (let index = 0; index < length; index += step) indexes.push(index)
  // Cột cuối thay nhãn đều cuối cùng (luôn cách nhãn trước ít nhất một bước) để hai nhãn không dính nhau.
  if (indexes[indexes.length - 1] !== length - 1) indexes[indexes.length - 1] = length - 1
  return indexes
}

export const presentGroups = (counts: CampaignReportGroupCounts) => CAMPAIGN_REPORT_GROUPS.filter(group => counts[group] > 0)
export const groupLabel = (group: CampaignReportGroup) => CAMPAIGN_REPORT_GROUP_LABELS[group]

export interface ReportKpi {
  key: string
  label: string
  value: string
  suffix: string
  sub: string
  tone: ReportTone
  icon: ReportIcon
  /** 0..1 cho thanh tiến độ của ô Hoàn thành. */
  meter?: number
}

/** Tối đa 6 ô số liệu chính (mục 3.4 của phương án). */
export function reportKpis(report: CampaignRunReport): ReportKpi[] {
  const n = formatReportNumber
  const actions: ReportKpi = {
    key: 'actions', label: 'Lượt hành động', value: n(report.results.total), suffix: ' lượt', tone: 'progress', icon: 'zap',
    sub: report.results.total === 0 ? 'Chưa có lượt nào' : report.results.successRate === null
      ? 'Bằng số ở tab Kết quả chạy'
      : `${formatReportRate(report.results.successRate)} thành công (hành động chính)`
  }
  if (!report.usesInputData) {
    const groups = report.results.groups
    return [
      actions,
      { key: 'success', label: 'Thành công', value: n(groups.success), suffix: ' lượt', tone: 'good', icon: 'check',
        sub: report.results.total ? `${formatReportPercent(groups.success, report.results.total)} số lượt` : 'Chưa có lượt nào' },
      { key: 'failure', label: 'Không thành công', value: n(groups.failure), suffix: ' lượt', tone: 'bad', icon: 'x',
        sub: report.results.total ? `${formatReportPercent(groups.failure, report.results.total)} số lượt` : 'Chưa có lượt nào' }
    ]
  }
  const { inputs } = report
  const outcome = (key: CampaignInputOutcome) => inputs.completedOutcomes.find(item => item.outcome === key)
  const success = outcome('success')?.count || 0
  const failure = outcome('failure')
  const unfinishedParts = (['waiting', 'running', 'paused'] as const)
    .map(key => inputs.byStatus.find(status => status.key === key)).filter((status): status is NonNullable<typeof status> => !!status)
  const unfinished = unfinishedParts.reduce((sum, status) => sum + status.count, 0)
  const unfinishedLabel: Partial<Record<CampaignInputStatusKey, string>> = { waiting: 'chờ', running: 'đang chạy', paused: 'tạm dừng' }
  return [
    { key: 'total', label: 'Tổng data', value: n(inputs.total), suffix: '', sub: 'Bằng số ở tab Data ban đầu', tone: 'track', icon: 'db' },
    { key: 'completed', label: 'Hoàn thành', value: n(inputs.completed), suffix: ` / ${n(inputs.total)}`, tone: 'good', icon: 'flag',
      meter: inputs.total ? inputs.completed / inputs.total : 0,
      sub: inputs.total ? `${formatReportPercent(inputs.completed, inputs.total)} · còn ${n(Math.max(0, inputs.total - inputs.completed))} data` : 'Chưa có data' },
    { key: 'success', label: 'Thành công', value: n(success), suffix: ' data', tone: 'good', icon: 'check',
      sub: inputs.completed ? `${formatReportPercent(success, inputs.completed)} số data đã hoàn thành` : 'Chưa có data hoàn thành' },
    { key: 'failure', label: 'Không thành công', value: n(failure?.count || 0), suffix: ' data', tone: 'bad', icon: 'x',
      sub: failure?.notFound ? `trong đó ${n(failure.notFound)} không tồn tại` : inputs.completed ? `${formatReportPercent(failure?.count || 0, inputs.completed)} số data đã hoàn thành` : 'Chưa có data hoàn thành' },
    { key: 'unfinished', label: 'Chưa xong', value: n(unfinished), suffix: ' data', tone: 'wait', icon: 'clock',
      sub: unfinishedParts.length ? unfinishedParts.map(status => `${n(status.count)} ${unfinishedLabel[status.key]}`).join(' · ') : 'Đã chạy hết data' },
    actions
  ]
}

/**
 * Gợi ý làm mới không tốn request: dòng chiến dịch trong danh sách đã tự làm mới theo chu kỳ sẵn có
 * (tiến độ đọc bằng aka_agent_control_campaign_progress, cùng điều kiện đếm với báo cáo), khác số của lượt đọc thì trả câu gợi ý.
 */
export function reportStaleMessage(report: CampaignRunReport, campaign: Pick<CampaignListItem, 'inputDataTotalCount' | 'inputDataCompletedCount' | 'status'>): string | null {
  const { inputs } = report
  const countsChanged = campaign.inputDataTotalCount !== inputs.total || campaign.inputDataCompletedCount !== inputs.completed
  if (!countsChanged && campaign.status === report.campaignStatus) return null
  if (!report.usesInputData || !countsChanged) {
    return `Có số liệu mới sau lần tải này: chiến dịch đang ở trạng thái "${campaign.status}".`
  }
  return `Có số liệu mới sau lần tải này: danh sách đang báo ${formatReportNumber(campaign.inputDataCompletedCount)}/${formatReportNumber(campaign.inputDataTotalCount)} data hoàn thành.`
}

/** Thứ tự kết quả hiển thị và lọc bỏ phần bằng 0 (trừ khi cần đủ cột cho bảng). */
export const visibleOutcomes = (counts: Record<CampaignInputOutcome, number>) => CAMPAIGN_INPUT_OUTCOMES.filter(outcome => counts[outcome] > 0)

/** Nhãn mô tả đầy đủ một thanh phân đoạn cho trình đọc màn hình. */
export function segmentsAria(title: string, segments: ReadonlyArray<{ label: string; count: number }>, total: number, unit: string): string {
  const parts = segments.filter(segment => segment.count > 0)
    .map(segment => `${segment.label} ${formatReportNumber(segment.count)} ${unit} (${formatReportPercent(segment.count, total)})`)
  return parts.length ? `${title}: ${parts.join(', ')}` : `${title}: chưa có số liệu`
}
