import type { AutoAccount } from './types'

export interface BrowserRunLimits {
  zaloWebMax: number | null
  facebookMax: number | null
  revision: number
}

export type SaveBrowserRunLimitsResult =
  | { ok: true; settings: BrowserRunLimits }
  | { ok: false; reason: 'conflict' }

export const BROWSER_RUN_LIMITS_IPC = {
  get: 'settings:browser-run-limits:get',
  save: 'settings:browser-run-limits:save'
} as const

export function isBrowserRunLimit(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647)
}

export function isBrowserRunLimits(value: unknown): value is BrowserRunLimits {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return isBrowserRunLimit(row.zaloWebMax) && isBrowserRunLimit(row.facebookMax)
    && typeof row.revision === 'number' && Number.isSafeInteger(row.revision) && row.revision >= 0
}

export function parseBrowserRunLimit(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const number = Number(text)
  if (!/^\d+$/.test(text) || !isBrowserRunLimit(number)) {
    throw new Error('Giới hạn phải là số nguyên dương không vượt quá 2.147.483.647, hoặc để trống nếu không giới hạn.')
  }
  return number
}

export function browserRunLimitWaitNote(account: Pick<AutoAccount, 'flatformType' | 'isZaloShowWeb' | 'isZaloServer'>): string | null {
  const platform = account.flatformType.trim().toLowerCase()
  const label = platform === 'facebook' ? 'Facebook'
    : platform === 'zalo' && account.isZaloShowWeb && !account.isZaloServer ? 'Zalo (trình duyệt)' : null
  return label ? `Đã đạt giới hạn tài khoản ${label} chạy đồng thời. Chiến dịch sẽ tự chạy khi có chỗ.` : null
}
