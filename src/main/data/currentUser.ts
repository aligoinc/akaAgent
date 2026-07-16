import { AsyncLocalStorage } from 'node:async_hooks'
import { AuthUser } from '../../shared/types'

let _currentUser: AuthUser | null = null
const currentUserStorage = new AsyncLocalStorage<AuthUser>()

/**
 * Login credentials are process-only runtime state. They must never be added
 * to AuthUser because that object is returned to the renderer.
 */
export interface ProcessAuthCredentials {
  username: string
  password: string
}

let _currentUserCredentials: ProcessAuthCredentials | null = null

export function setCurrentUser(user: AuthUser | null): void {
  if (
    !user ||
    (_currentUser && (
      _currentUser.staffId !== user.staffId ||
      _currentUser.organizationId !== user.organizationId
    ))
  ) {
    _currentUserCredentials = null
  }
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

export function setCurrentUserCredentials(credentials: ProcessAuthCredentials | null): void {
  if (!credentials) {
    _currentUserCredentials = null
    return
  }
  const username = String(credentials.username || '').trim()
  const password = String(credentials.password || '')
  _currentUserCredentials = username && password ? { username, password } : null
}

export function getCurrentUserCredentials(): ProcessAuthCredentials | null {
  return _currentUserCredentials
}

export function requireCurrentUserCredentials(): ProcessAuthCredentials {
  const credentials = getCurrentUserCredentials()
  if (!credentials) {
    throw new Error('Phiên xác thực tự động hóa không còn hợp lệ. Vui lòng đăng nhập lại.')
  }
  return credentials
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
