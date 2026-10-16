import { normalizeVietnamMobilePhone } from './phone'
import type { DataGroupIngestRow } from './types'

export const ZALO_PHONE_CHECK_MAX = 300
export const ZALO_PHONE_CHECK_IPC = {
  start: 'contacts:zalo-phone-check:start', cancel: 'contacts:zalo-phone-check:cancel',
  row: 'contacts:zalo-phone-check:row', completed: 'contacts:zalo-phone-check:completed'
} as const
export type ZaloPhoneCheckStatus = 'pending' | 'checking' | 'found' | 'not_found' | 'unknown'
export const ZALO_PHONE_CHECK_LABELS: Record<ZaloPhoneCheckStatus, string> = {
  pending: 'Chưa kiểm tra', checking: 'Đang kiểm tra', found: 'Có Zalo',
  not_found: 'Không tìm thấy Zalo', unknown: 'Chưa xác định'
}
/** Matches akaBizAuto CheckPhoneExist_ByApi / SearchPhone.LIMITS, after 32→40 selection. */
export function classifyZaloPhoneCheckApiCode(code: string): 'found' | 'not_found' | null {
  // Transport/runtime errors have no Zalo error_code and cannot classify a phone.
  if (!/^-?\d+$/.test(code)) return null
  return [0, 312, 313, 304, 221].includes(Number(code)) ? 'found' : 'not_found'
}
export interface ZaloPhoneCheckRow {
  id: string
  phone: string
  status: ZaloPhoneCheckStatus
  name: string
  uid: string
  note: string
  accountId?: number
}
export interface ZaloPhoneCheckRequest { runId: string; accountId: number; limit: number; phones: string[] }
export interface ZaloPhoneCheckEvent {
  runId: string; accountId: number; sequence: number; row: ZaloPhoneCheckRow
}
export interface ZaloPhoneCheckResult {
  runId: string; accountId: number; sequence: number
  stopped: boolean; error?: string; rows: ZaloPhoneCheckRow[]
}
export function normalizeZaloCheckPhones(values: unknown[]): string[] {
  const phones = Array.from(new Set(values.map(normalizeVietnamMobilePhone).filter(Boolean)))
  if (!phones.length) throw new Error('Không có số điện thoại hợp lệ.')
  if (phones.length > ZALO_PHONE_CHECK_MAX) throw new Error('Chỉ nhận tối đa 300 SĐT hợp lệ, không trùng. Vui lòng chia nhỏ file.')
  return phones
}
export function validateZaloPhoneCheckRequest(input: unknown): ZaloPhoneCheckRequest {
  const value = input as ZaloPhoneCheckRequest | null
  if (!value || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.runId)
    || !Number.isSafeInteger(value.accountId) || value.accountId <= 0
    || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > ZALO_PHONE_CHECK_MAX
    || !Array.isArray(value.phones) || value.phones.length > ZALO_PHONE_CHECK_MAX
    || value.phones.some(phone => typeof phone !== 'string' || phone.length > 64)) {
    throw new Error('Yêu cầu kiểm tra SĐT không hợp lệ (tối đa 300 số).')
  }
  return { runId: value.runId, accountId: value.accountId, limit: value.limit, phones: normalizeZaloCheckPhones(value.phones) }
}
export function createZaloPhoneCheckRow(phone: string): ZaloPhoneCheckRow {
  return { id: phone, phone, status: 'pending', name: '', uid: '', note: '' }
}
export function zaloPhoneCheckExport(rows: ZaloPhoneCheckRow[], template: boolean): string[][] {
  return template
    ? [['Fullname', 'Uid', 'Mobile', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5'],
      ...rows.map(row => [row.name, '', row.phone, '', '', '', '', '', ''])]
    : [['STT', 'SĐT', 'Tên Zalo', 'Zalo ID', 'Trạng thái', 'Ghi chú'],
      ...rows.map((row, index) => [String(index + 1), row.phone, row.name, row.uid, ZALO_PHONE_CHECK_LABELS[row.status], row.note])]
}
export function zaloPhoneCheckGroupRows(rows: ZaloPhoneCheckRow[], type: 'phone' | 'zalo_person'): DataGroupIngestRow[] {
  if (!rows.length) throw new Error('Vui lòng tích chọn dữ liệu.')
  if (type === 'zalo_person' && rows.some(row => row.status !== 'found' || !row.uid || !row.accountId)) {
    throw new Error('Nhóm Zalo UID chỉ nhận các dòng Có Zalo, có Zalo ID và tài khoản đã kiểm tra.')
  }
  if (type === 'zalo_person' && new Set(rows.map(row => row.accountId)).size > 1) {
    throw new Error('Nhóm Zalo UID chỉ nhận kết quả của cùng một tài khoản. Vui lòng chọn riêng các dòng theo tài khoản đã kiểm tra.')
  }
  return rows.map(row => ({
    contactType: type === 'phone' ? 'phone' : 'person', flatformType: 'zalo',
    sourceAccountId: row.accountId ?? null, phone: row.phone, name: row.name || null,
    uid: type === 'zalo_person' ? row.uid : null,
    extraData: { phone: row.phone, zaloPhoneCheckStatus: row.status, zaloUid: row.uid || null }
  }))
}
