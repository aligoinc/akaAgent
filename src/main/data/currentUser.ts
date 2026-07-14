import { AsyncLocalStorage } from 'node:async_hooks'
import { AuthUser } from '../../shared/types'

let _currentUser: AuthUser | null = null
const currentUserStorage = new AsyncLocalStorage<AuthUser>()

export function setCurrentUser(user: AuthUser | null): void {
  _currentUser = user
}

export function getCurrentUser(): AuthUser | null {
  return currentUserStorage.getStore() ?? _currentUser
}

export function requireCurrentUser(): AuthUser {
  const currentUser = getCurrentUser()
  if (!currentUser) {
    throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi thao tác dữ liệu.')
  }
  return currentUser
}

/**
 * Run an operation with an isolated current user. AsyncLocalStorage keeps the
 * user across awaited work while desktop callers can continue using the
 * process-wide setCurrentUser/getCurrentUser fallback.
 */
export function runWithCurrentUser<T>(user: AuthUser, operation: () => T): T {
  return currentUserStorage.run(user, operation)
}

export function isZaloServerUser(
  user: Pick<AuthUser, 'isZaloServer'> | null | undefined
): boolean {
  return user?.isZaloServer === true
}

export function isCurrentUserZaloServerEnabled(): boolean {
  return isZaloServerUser(getCurrentUser())
}
