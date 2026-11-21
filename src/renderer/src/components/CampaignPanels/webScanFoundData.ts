// Data tìm được của chiến dịch quét data website (phương án docs/WEB_DATA_SCAN_PLAN.md mục 7.8): đọc từ data.webRecords của các dòng Lịch sử
// hành động (mỗi lần hiện SĐT / mở trang một dòng, data dùng lại ở dòng "Tìm data"), bỏ trùng theo SĐT, dựng file Excel.
import { utils, type WorkBook } from 'xlsx'
import {
  WEB_SCAN_INFO_KEYS, getWebScanFieldCatalog, getWebScanFieldLabel, webScanInfoValues,
  type WebScanInfoMap, type WebScanRecord, type WebScanSite
} from '../../../../shared/webScan'
import type { CampaignDetail } from '../../../../shared/types'

export interface WebScanFoundRecord extends WebScanRecord {
  foundAt?: string
  accountId?: number
  keyword?: string
}

const str = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

function readRecord(raw: unknown): WebScanRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const phone = str(value.phone)
  const site = str(value.site) as WebScanSite
  if (!phone || !['nhatot', 'batdongsan', 'yellowpages'].includes(site)) return null
  const fields: Record<string, string> = {}
  if (value.fields && typeof value.fields === 'object' && !Array.isArray(value.fields)) {
    for (const [key, item] of Object.entries(value.fields as Record<string, unknown>)) {
      const text = typeof item === 'string' ? item.trim() : item == null ? '' : String(item)
      if (text) fields[key] = text
    }
  }
  return {
    site, phone, name: str(value.name), ...(str(value.email) ? { email: str(value.email) } : {}),
    listingKey: str(value.listingKey), link: str(value.link),
    ...(value.section === 'sale' || value.section === 'rent' ? { section: value.section } : {}),
    fields, ...(value.reused === true ? { reused: true } : {})
  }
}

/** Data của chiến dịch theo thứ tự tìm ra (dòng cũ trước), mỗi SĐT một dòng. */
export function collectWebScanRecords(details: readonly CampaignDetail[]): WebScanFoundRecord[] {
  const rows = [...details].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id - b.id)
  const out: WebScanFoundRecord[] = []
  const seen = new Set<string>()
  for (const detail of rows) {
    const list = detail.data && Array.isArray((detail.data as Record<string, unknown>).webRecords)
      ? (detail.data as Record<string, unknown>).webRecords as unknown[] : []
    for (const raw of list) {
      const record = readRecord(raw)
      if (!record || seen.has(record.phone)) continue
      seen.add(record.phone)
      out.push({ ...record, foundAt: detail.createdAt, accountId: detail.accountId,
        keyword: str(detail.inputData?.name) || str(detail.inputData?.uid) || undefined })
    }
  }
  return out
}

/** Cột trường thêm hiển thị / xuất: theo thứ tự danh mục của trang, chỉ trường có dữ liệu. */
export function webScanFieldColumns(site: WebScanSite, records: readonly WebScanRecord[]): Array<{ key: string; label: string }> {
  const present = new Set(records.flatMap(record => Object.keys(record.fields)))
  return getWebScanFieldCatalog(site).filter(field => present.has(field.key)).map(field => ({ key: field.key, label: field.label }))
}

/**
 * File Excel: chín cột đầu theo mẫu nhập Nhóm data (Tên, Uid, Sđt, Email, Info1–Info5 theo lựa chọn của chiến dịch), rồi từ khoá, ngày tìm
 * và mọi trường lấy thêm.
 */
export function buildWebScanWorkbook(site: WebScanSite, records: readonly WebScanFoundRecord[], infoMap: WebScanInfoMap): WorkBook {
  const columns = webScanFieldColumns(site, records)
  const header = ['Tên', 'Uid', 'Sđt', 'Email', ...WEB_SCAN_INFO_KEYS.map((_key, index) => `Info${index + 1}`), 'Từ khoá', 'Ngày tìm',
    ...columns.map(column => column.label)]
  const rows = records.map(record => {
    const info = webScanInfoValues(record, infoMap)
    return [
      record.name || '', '', record.phone, record.email || record.fields.email || '',
      ...WEB_SCAN_INFO_KEYS.map(key => info[key] || ''),
      record.keyword || '', record.foundAt ? new Date(record.foundAt).toLocaleString('vi-VN') : '',
      ...columns.map(column => record.fields[column.key] || '')
    ]
  })
  const sheet = utils.aoa_to_sheet([header, ...rows])
  sheet['!cols'] = header.map((_label, index) => ({ wch: index < 4 ? [24, 10, 14, 26][index] : 18 }))
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, 'Sheet1')
  return workbook
}

export { getWebScanFieldLabel }
