import { AuthUser } from '../../shared/types'

let _currentUser: AuthUser | null = null

export function setCurrentUser(user: AuthUser | null): void {
  _currentUser = user
}

export function getCurrentUser(): AuthUser | null {
  return _currentUser
}

export function requireCurrentUser(): AuthUser {
  if (!_currentUser) {
    throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi thao tác dữ liệu.')
  }
  return _currentUser
}
