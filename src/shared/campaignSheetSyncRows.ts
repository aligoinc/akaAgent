/**
 * Chuẩn hoá dòng Google Sheet cho đồng bộ chiến dịch (V662): cùng hàm với cửa sổ Upload (`mapImportTable` +
 * `verifyImportRows`), để lượt đồng bộ ra đúng data như lúc khách tự nhập. Dùng ở cửa sổ Upload (dựng cấu hình +
 * mốc ban đầu) và ở Edge Function `aka-agent-campaign-sheet-sync` (bản đóng gói sinh bằng
 * `scripts/campaign-sheet-sync/build-edge-core.cjs`).
 */
import type { CampaignImportPlatform } from './types'
import {
  importText, importTargetField, mapImportTable, verifyImportRows,
  type ImportColumnMap, type ImportPhonePolicy, type ImportTable, type ImportVerificationResult
} from './campaignImportVerification'
import {
  canonicalCampaignSheetUrl, CAMPAIGN_SHEET_SYNC_MAX_VALUES,
  type CampaignSheetSyncConfig, type CampaignSheetSyncField, type CampaignSheetSyncPlatform
} from './campaignSheetSync'

const SYNC_FIELDS: readonly CampaignSheetSyncField[] = ['name', 'uid', 'phone', 'email', 'info1', 'info2', 'info3', 'info4', 'info5']

export class CampaignSheetSyncError extends Error {
  constructor(readonly code: string, message: string, readonly permanent: boolean) {
    super(message)
    this.name = 'CampaignSheetSyncError'
  }
}

export interface CampaignSheetSyncRow {
  name?: string
  phone?: string
  uid?: string
  email?: string
  info1?: string
  info2?: string
  info3?: string
  info4?: string
  info5?: string
  phoneCarrier?: string | null
}

export interface CampaignSheetSyncRowsResult {
  rows: CampaignSheetSyncRow[]
  rowCount: number
  invalid: number
  duplicates: number
}

const headerCell = (value: unknown) => importText(value).replace(/\s+/g, ' ')

/** Cấu hình nguồn từ lựa chọn của cửa sổ Upload. `null` khi link / loại chiến dịch không đồng bộ được. */
export function buildCampaignSheetSyncConfig(input: {
  link: string
  table: ImportTable
  mapping: ImportColumnMap
  skipHeader: boolean
  phonePolicy: ImportPhonePolicy
  platform: CampaignImportPlatform
  actionId: string
}): CampaignSheetSyncConfig | null {
  const url = canonicalCampaignSheetUrl(input.link)
  if (!url || !['zalo', 'facebook', 'email'].includes(input.platform)) return null
  const targetField = importTargetField(input.platform, input.actionId)
  const mapping: CampaignSheetSyncConfig['mapping'] = {}
  for (const field of SYNC_FIELDS) {
    const column = input.mapping[field]
    if (typeof column === 'number' && Number.isInteger(column) && column >= 0) mapping[field] = column
  }
  if (mapping[targetField] === undefined) return null
  const width = input.table.rows.reduce((max, row) => Math.max(max, row.length), 0)
  const columnCount = Math.max(width, ...Object.values(mapping).map(column => (column as number) + 1))
  if (columnCount > 512) return null
  const expectedHeaders = input.skipHeader ? (input.table.rows[0] || []).map(cell => headerCell(cell.text)).slice(0, 512) : []
  return {
    url, hasHeader: input.skipHeader, mapping, expectedHeaders, columnCount,
    phonePolicy: input.phonePolicy, targetField, platform: input.platform as CampaignSheetSyncPlatform
  }
}

/** Giá trị đã chuẩn hoá của mọi dòng hợp lệ cửa sổ Upload đã đọc: DB lấy phần chưa vào chiến dịch làm mốc ban đầu. */
export function campaignSheetSyncValues(report: Pick<ImportVerificationResult, 'valid'>): string[] {
  const values = new Set<string>()
  for (const entry of report.valid) {
    if (entry.normalizedValue) values.add(entry.normalizedValue)
    if (values.size >= CAMPAIGN_SHEET_SYNC_MAX_VALUES) break
  }
  return Array.from(values)
}

/** Dựng bảng như cửa sổ Upload đọc CSV của Google (giá trị giữ nguyên chuỗi, không đổi sang số). */
export function campaignSheetTable(rows: string[][]): ImportTable {
  return {
    name: 'Google Sheet',
    rowNumbers: rows.map((_, index) => index + 1),
    rows: rows.map(row => row.map(value => ({ value, text: value })))
  }
}

/** Một lượt đồng bộ: kiểm cột còn như lúc kết nối rồi chuẩn hoá như cửa sổ Upload. */
export function campaignSheetSyncRows(table: ImportTable, config: CampaignSheetSyncConfig, actionId: string): CampaignSheetSyncRowsResult {
  if (config.hasHeader) {
    const header = (table.rows[0] || []).map(cell => headerCell(cell.text))
    const expected = config.expectedHeaders.map(headerCell)
    // Cột thêm vào sau các cột cũ không làm lệch cột đã ghép; đổi tên / đổi thứ tự / xoá cột cũ thì dừng.
    for (let index = 0; index < expected.length; index++) {
      if ((header[index] || '') !== expected[index]) {
        throw new CampaignSheetSyncError('sheet_columns_changed', 'Cột của Sheet đã thay đổi. Hãy kết nối và ghép cột lại.', true)
      }
    }
  }
  const mapping = config.mapping as ImportColumnMap
  let report: ImportVerificationResult
  try {
    const source = mapImportTable(table, mapping, config.hasHeader ? 1 : 0, 'Google Sheet')
    report = verifyImportRows(source, {
      platform: config.platform as CampaignImportPlatform, actionId, kind: 'sheet', phonePolicy: config.phonePolicy
    })
  } catch (error) {
    throw new CampaignSheetSyncError('sheet_too_large', error instanceof Error ? error.message : 'Sheet vượt giới hạn dòng.', true)
  }
  const field = config.targetField
  const rows: CampaignSheetSyncRow[] = report.valid.map(entry => {
    const row: CampaignSheetSyncRow = {}
    const name = importText(entry.row.name)
    if (name) row.name = name
    row[field] = entry.normalizedValue
    for (const info of ['info1', 'info2', 'info3', 'info4', 'info5'] as const) {
      const value = importText(entry.row[info])
      if (value) row[info] = value
    }
    if (field === 'phone' && entry.row.phoneCarrier) row.phoneCarrier = entry.row.phoneCarrier
    return row
  })
  return { rows, rowCount: report.sourceRowCount, invalid: report.rejected.length, duplicates: report.duplicates.length }
}
