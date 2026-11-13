// Chép từ akaAgentWebApp apps/web/src/features/campaignReport/campaignReportExcel.ts (khác import và kiểu dòng chiến dịch).
import { utils, writeFile } from 'xlsx'
import {
  CAMPAIGN_INPUT_OUTCOMES, CAMPAIGN_INPUT_OUTCOME_LABELS, CAMPAIGN_REPORT_GROUPS, CAMPAIGN_REPORT_GROUP_LABELS,
  type CampaignRunReport
} from '../../../../../shared/campaignRunReport'
import type { CampaignListItem } from '../../../../../shared/types'
import { TIMELINE_UNIT_LABELS, formatReportDateTime, timelineTitle } from './campaignRunReportModel'

type Cell = string | number | null
export interface ReportSheet { name: string; rows: Cell[][] }

const ratePercent = (rate: number | null): Cell => rate === null ? null : Math.round(rate * 1000) / 10
const share = (part: number, total: number): Cell => total > 0 ? Math.round(part / total * 1000) / 10 : null

/**
 * Bốn sheet của "Xuất Excel" ở tab Báo cáo (mục 3.12 của phương án), dựng từ dữ liệu đang hiện.
 * Danh sách từng dòng data/kết quả vẫn xuất bằng nút Excel của tab Data ban đầu và Kết quả chạy.
 */
export function campaignReportSheets(report: CampaignRunReport, campaign: Pick<CampaignListItem, 'id' | 'name' | 'accountName'>): ReportSheet[] {
  const { inputs, results } = report
  const completedOutcome = (key: (typeof CAMPAIGN_INPUT_OUTCOMES)[number]) => inputs.completedOutcomes.find(item => item.outcome === key)
  const unfinished = inputs.byStatus.filter(status => status.key === 'waiting' || status.key === 'running' || status.key === 'paused')
    .reduce((sum, status) => sum + status.count, 0)

  const overview: Cell[][] = [
    ['Chiến dịch', campaign.name],
    ['ID chiến dịch', campaign.id],
    ['Tài khoản', campaign.accountName || ''],
    ['Trạng thái chiến dịch', report.campaignStatus],
    ['Cập nhật lúc (giờ Việt Nam)', formatReportDateTime(report.generatedAt)],
    ['Lượt đầu tiên', formatReportDateTime(results.firstAt)],
    ['Lượt gần nhất', formatReportDateTime(results.lastAt)],
    [],
    ['Số liệu', 'Giá trị', 'Ghi chú'],
    ...(report.usesInputData ? [
      ['Tổng data', inputs.total, 'Bằng số ở tab Data ban đầu'],
      ['Hoàn thành (data)', inputs.completed, 'Bằng tiến độ ở danh sách chiến dịch'],
      ['Thành công (data)', completedOutcome('success')?.count || 0, 'Data hoàn thành có ít nhất một hành động chính thành công'],
      ['Không thành công (data)', completedOutcome('failure')?.count || 0, `Trong đó ${completedOutcome('failure')?.notFound || 0} không tồn tại`],
      ['Chưa xong (data)', unfinished, 'Chờ xử lý + đang chạy + tạm dừng'],
      ['Lỗi (data)', inputs.failed, '']
    ] as Cell[][] : []),
    ['Lượt hành động', results.total, 'Bằng số ở tab Kết quả chạy'],
    ...CAMPAIGN_REPORT_GROUPS.map(group => [`  ${CAMPAIGN_REPORT_GROUP_LABELS[group]} (lượt)`, results.groups[group], ''] as Cell[]),
    ['Tỷ lệ thành công (%)', ratePercent(results.successRate), 'Hành động chính; không tính bỏ qua, chờ xác nhận, khác'],
    ...(report.engagement ? [
      [],
      ['Tương tác Zalo (lượt gửi thành công)', 'Số lượt', ''],
      ['Tin nhắn đã gửi', report.engagement.message.sent, ''],
      ['  được theo dõi', report.engagement.message.tracked, ''],
      ['  đã xem', report.engagement.message.seen, ''],
      ['  có tương tác', report.engagement.message.interacted, 'Phản hồi hoặc thả cảm xúc'],
      ['  đã phản hồi', report.engagement.message.responded, ''],
      ['Lời mời kết bạn đã gửi', report.engagement.friend.requested, ''],
      ['  được theo dõi', report.engagement.friend.tracked, ''],
      ['  đã đồng ý', report.engagement.friend.friended, '']
    ] as Cell[][] : [])
  ]

  const data: Cell[][] = !report.usesInputData ? [['Chiến dịch này không dùng data đầu vào.']] : [
    ['Trạng thái data', 'Số data', 'Tỷ lệ (%)'],
    ...inputs.byStatus.map(status => [status.label, status.count, share(status.count, inputs.total)]),
    ['Tổng', inputs.total, inputs.total ? 100 : null],
    [],
    [`Kết quả của ${inputs.completed} data đã hoàn thành`, 'Số data', 'Tỷ lệ (%)', 'Ghi chú'],
    ...inputs.completedOutcomes.map(outcome => [outcome.label, outcome.count, share(outcome.count, inputs.completed),
      outcome.outcome === 'failure' && outcome.notFound ? `Trong đó ${outcome.notFound} không tồn tại` : '']),
    [],
    ['Trạng thái data × kết quả', ...CAMPAIGN_INPUT_OUTCOMES.map(outcome => CAMPAIGN_INPUT_OUTCOME_LABELS[outcome]), 'Trong đó không tồn tại', 'Tổng'],
    ...inputs.matrix.map(row => [row.label, ...CAMPAIGN_INPUT_OUTCOMES.map(outcome => row.counts[outcome]), row.notFound, row.total]),
    ['Tổng', ...CAMPAIGN_INPUT_OUTCOMES.map(outcome => inputs.matrix.reduce((sum, row) => sum + row.counts[outcome], 0)),
      inputs.matrix.reduce((sum, row) => sum + row.notFound, 0), inputs.total]
  ]

  const actions: Cell[][] = [
    ['Hành động', 'Loại', ...report.columns.map(column => column.label), 'Tổng',
      ...CAMPAIGN_REPORT_GROUPS.map(group => `${CAMPAIGN_REPORT_GROUP_LABELS[group]} (nhóm)`), 'Tỷ lệ thành công (%)'],
    ...report.actions.map(action => [
      action.name, action.auxiliary ? 'Hành động phụ' : action.code ? 'Hành động chính' : '',
      ...report.columns.map(column => action.cells[column.key] ?? '–'), action.total,
      ...CAMPAIGN_REPORT_GROUPS.map(group => action.groups[group]), ratePercent(action.successRate)
    ]),
    ['Tổng', '', ...report.columns.map(column => report.actions.reduce((sum, action) => sum + (action.cells[column.key] || 0), 0)),
      results.total, ...CAMPAIGN_REPORT_GROUPS.map(group => results.groups[group]), ratePercent(results.successRate)],
    [],
    ['"–": trạng thái không thuộc hành động đó. "0": có trong cấu hình nhưng chưa có lượt nào.'],
    [],
    ['Hành động', 'Trạng thái', 'Trạng thái phụ (trong đó, không cộng thêm)', 'Số lượt'],
    ...report.actions.flatMap(action => action.statuses.flatMap(status => status.subStatuses.map(sub => [action.name, status.label, sub.label, sub.count])))
  ]

  const timeline: Cell[][] = [
    [`Mốc (${TIMELINE_UNIT_LABELS[report.timeline.unit].toLowerCase()}, giờ Việt Nam)`, ...CAMPAIGN_REPORT_GROUPS.map(group => CAMPAIGN_REPORT_GROUP_LABELS[group]), 'Tổng'],
    ...report.timeline.points.map(point => [timelineTitle(point.at, report.timeline.unit), ...CAMPAIGN_REPORT_GROUPS.map(group => point.counts[group]), point.total])
  ]

  return [
    { name: 'Tổng quan', rows: overview },
    { name: 'Data theo trạng thái', rows: data },
    { name: 'Theo hành động', rows: actions },
    { name: 'Theo thời gian', rows: timeline }
  ]
}

export function downloadCampaignReport(report: CampaignRunReport, campaign: Pick<CampaignListItem, 'id' | 'name' | 'accountName'>): void {
  const book = utils.book_new()
  for (const sheet of campaignReportSheets(report, campaign)) utils.book_append_sheet(book, utils.aoa_to_sheet(sheet.rows), sheet.name)
  writeFile(book, `bao-cao-chien-dich-${campaign.id}.xlsx`)
}
