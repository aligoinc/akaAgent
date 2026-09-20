import { canAccessAdmin, type AdminApiDoc } from '../../../shared/admin'
import type { AuthUser } from '../../../shared/types'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

export class AdminAccessError extends Error {
  constructor() { super('Bạn không có quyền truy cập Admin akaBiz.'); this.name = 'AdminAccessError' }
}

export function requireAdmin(): AuthUser {
  const user = requireCurrentUser()
  if (!canAccessAdmin(user)) throw new AdminAccessError()
  return user
}

function transformKeys(value: unknown, convert: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map(item => transformKeys(item, convert))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [convert(key), transformKeys(item, convert)]))
  }
  return value
}

export function validAdminDocUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('URL tài liệu không hợp lệ.')
  try {
    const url = new URL(raw.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new Error()
    return url.href
  } catch { throw new Error('URL tài liệu phải dùng HTTP hoặc HTTPS, không kèm thông tin đăng nhập.') }
}

export type AdminResource = 'docs' | 'notifications' | 'settings' | 'cron' | 'triggers'

export async function callAdmin<T>(resource: AdminResource, action: string, input: Record<string, unknown> = {}): Promise<T> {
  const user = requireAdmin()
  const credentials = requireCurrentUserCredentials()
  const payload = { ...input }
  if (resource === 'docs' && action === 'save') {
    payload.url = validAdminDocUrl(payload.url)
    if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 200 || !Number.isSafeInteger(payload.sortOrder)) {
      throw new Error('Tên hoặc thứ tự tài liệu không hợp lệ.')
    }
  }
  const { data, error } = await getSupabaseClient().rpc(`aka_agent_admin_${resource}`, {
    p_staff_id: user.staffId, p_username: credentials.username, p_password: credentials.password,
    p_action: action, p_data: transformKeys(payload, key => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`))
  }).abortSignal(AbortSignal.timeout(12_000))
  const current = getCurrentUser()
  if (current?.staffId !== user.staffId || current.organizationId !== user.organizationId || getCurrentUserCredentials() !== credentials) {
    throw new Error('Phiên đăng nhập đã thay đổi.')
  }
  if (error) {
    // Never relay the PostgREST error/details: it can contain SQL or secret input.
    if (error.message?.includes('admin_access_denied')) throw new AdminAccessError()
    if (error.message?.includes('admin_conflict')) throw new Error('Dữ liệu đã được thay đổi. Hãy tải lại trước khi lưu.')
    if (error.code === '57014') throw new Error('Truy vấn mất quá nhiều thời gian. Hãy thử tải lại hoặc chọn bộ lọc khác.')
    if (error.message?.includes('admin_not_found')) throw new Error('Dữ liệu không còn tồn tại. Hãy tải lại danh sách.')
    throw new Error('Không thể hoàn tất thao tác Admin. Vui lòng kiểm tra dữ liệu hoặc thử tải lại.')
  }
  if (!canAccessAdmin(current)) throw new AdminAccessError()
  return transformKeys(data, key => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())) as T
}

export async function getAdminDoc(id: number): Promise<AdminApiDoc> {
  const doc = await callAdmin<AdminApiDoc>('docs', 'get', { id })
  if (!doc.isActive) throw new Error('Tài liệu này đã được tắt.')
  return { ...doc, url: validAdminDocUrl(doc.url) }
}

/** Reuses the existing 30-second auth refresh, only for organization 1. */
export async function readLiveAdminFlag(user: AuthUser): Promise<boolean> {
  if (user.organizationId !== 1) return user.isAdmin === true
  const { data, error } = await getSupabaseClient().from('org_staff').select('is_admin,is_active')
    .eq('id', user.staffId).eq('organization_id', 1).abortSignal(AbortSignal.timeout(5000)).maybeSingle()
  return !error && data?.is_active === true && data.is_admin === true
}
