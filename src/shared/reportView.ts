import type { AccountActionReportResult, AccountActionReportQuery, AccountActionReportAccount, AccountActionReportAction, AccountActionReportStatusBucket } from './types'
import type { AccountActionStatusReportResult, ActionReportStatusSelector } from './actionStatusReport'

export type ReportMode = 'general' | 'action-status'
export interface ReportViewColumn {
  key: string
  label: string
  bucket?: AccountActionReportStatusBucket
  selector?: ActionReportStatusSelector
}
export interface ReportView {
  mode: ReportMode
  query: AccountActionReportQuery
  actions: Array<AccountActionReportAction & { columns: ReportViewColumn[] }>
  rows: Array<{ account: AccountActionReportAccount; countsByActionCode: Record<string, Record<string, number>> }>
  generatedAt: string
}
const generalColumns: ReportViewColumn[] = [
  { key: 'pendingCount', label: 'Chờ xử lý', bucket: 'pending' },
  { key: 'successCount', label: 'Thành công', bucket: 'success' },
  { key: 'skippedCount', label: 'Bỏ qua', bucket: 'skipped' },
  { key: 'failureCount', label: 'Thất bại', bucket: 'failure' }
]
export function generalReportView(report: AccountActionReportResult): ReportView {
  return { ...report, mode: 'general', actions: report.actions.map(action => ({ ...action, columns: generalColumns })),
    rows: report.rows.map(row => ({ ...row, countsByActionCode: Object.fromEntries(Object.entries(row.countsByActionCode).map(([code, cell]) => [code, { ...cell }])) })) }
}
export function actionStatusReportView(report: AccountActionStatusReportResult): ReportView {
  return { ...report, mode: 'action-status', actions: report.actions.map(action => ({ ...action, columns: action.statuses })) }
}

/** The same ordered columns drive the table and both Excel header rows. */
export function reportExportMatrix(report: ReportView) {
  const header1 = ['Danh sách hành động/danh sách tài khoản chọn']
  const header2 = ['Trạng thái']
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }]
  let offset = 1
  for (const action of report.actions) {
    header1.push(action.name, ...action.columns.slice(1).map(() => ''))
    header2.push(...action.columns.map(column => column.label))
    if (action.columns.length > 1) merges.push({ s: { r: 0, c: offset }, e: { r: 0, c: offset + action.columns.length - 1 } })
    offset += action.columns.length
  }
  const rows = report.rows.map(row => [row.account.name, ...report.actions.flatMap(action => action.columns.map(column => row.countsByActionCode[action.code]?.[column.key] || 0))])
  return { values: [header1, header2, ...rows], merges, widths: [{ wch: 34 }, ...header2.slice(1).map(() => ({ wch: report.mode === 'general' ? 13 : 18 }))] }
}
