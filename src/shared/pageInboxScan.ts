import type { PageInboxScanOptions } from './types'

export const DEFAULT_PAGE_INBOX_SCAN_DAYS = 30
export const DEFAULT_PAGE_INBOX_MAX_CUSTOMERS = 5_000
export const PAGE_INBOX_MAX_CUSTOMERS = 20_000
export const DEFAULT_PAGE_INBOX_ESTIMATE_SECONDS = 2_400
export const PAGE_INBOX_ESTIMATE_SETTING_KEY = 'facebook.page_inbox.scan_estimated_seconds_per_20000'

export function validatePageInboxScanOptions(options?: PageInboxScanOptions): Required<PageInboxScanOptions> {
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) {
    throw new Error('Cấu hình quét inbox Page không hợp lệ.')
  }
  const value = options ?? { mode: 'since_latest_message', maxCustomers: DEFAULT_PAGE_INBOX_MAX_CUSTOMERS }
  if (value.mode !== 'since_latest_message' && value.mode !== 'last_days') {
    throw new Error('Vui lòng chọn cách lấy dữ liệu inbox Page.')
  }
  if (!Number.isSafeInteger(value.maxCustomers) || value.maxCustomers < 1 || value.maxCustomers > PAGE_INBOX_MAX_CUSTOMERS) {
    throw new Error('Số khách hàng tối đa phải là số nguyên từ 1 đến 20.000.')
  }
  const days = value.mode === 'last_days' ? value.days : DEFAULT_PAGE_INBOX_SCAN_DAYS
  if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1) {
    throw new Error('Số ngày lấy dữ liệu phải là số nguyên lớn hơn hoặc bằng 1.')
  }
  return { mode: value.mode, maxCustomers: value.maxCustomers, days }
}

export function parsePageInboxTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function formatPageInboxScanDate(value: string): string {
  const timestamp = parsePageInboxTimestamp(value)
  return timestamp === null ? '' : new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(timestamp)
}

/** Boundaries are inclusive Vietnam calendar dates, frozen at scan startup. */
export function getPageInboxScanCutoff(
  options: Required<PageInboxScanOptions>,
  vietnamDateKey: string,
  latestMessageAt: string | null
): number | null {
  if (options.mode === 'since_latest_message') {
    const latest = parsePageInboxTimestamp(latestMessageAt)
    if (latest === null) return null
    const dateKey = new Date(latest + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    return Date.parse(`${dateKey}T00:00:00+07:00`)
  }
  const cutoff = Date.parse(`${vietnamDateKey}T00:00:00+07:00`) - (options.days - 1) * 86_400_000
  if (!Number.isFinite(cutoff) || !Number.isFinite(new Date(cutoff).getTime())) {
    throw new Error('Khoảng ngày lấy dữ liệu không hợp lệ.')
  }
  return cutoff
}

export function normalizePageInboxEstimateSeconds(value: unknown): number {
  const seconds = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_PAGE_INBOX_ESTIMATE_SECONDS
}

export function estimatePageInboxScanMinutes(maxCustomers: number, secondsPer20000: unknown): number {
  return Math.max(1, Math.ceil(normalizePageInboxEstimateSeconds(secondsPer20000) * (maxCustomers / PAGE_INBOX_MAX_CUSTOMERS) / 60))
}
