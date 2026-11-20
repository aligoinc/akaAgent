import type { AutoAccount } from '../../../../shared/types'

export const FACEBOOK_LOGGED_IN_STATUS = 'đã đăng nhập'

export function isFacebookMessagesAccount(account: AutoAccount): boolean {
  return account.flatformType === 'facebook' && account.isActive
}

export function isLoggedIn(account: AutoAccount): boolean {
  return account.loginStatus === FACEBOOK_LOGGED_IN_STATUS
}

export function loginStatusLabel(status: string | null | undefined): string {
  const text = String(status || '').trim() || 'chưa đăng nhập'
  return text.charAt(0).toLocaleUpperCase('vi-VN') + text.slice(1)
}

export function accountInitials(name: string): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words.slice(-2).map(word => Array.from(word)[0] ?? '').join('').toLocaleUpperCase('vi-VN')
}
