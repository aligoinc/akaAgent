import type {
  NotificationDetail,
  NotificationDeviceRemoval,
  NotificationListPage,
  NotificationListQuery,
  NotificationReadRequest,
  NotificationReadResult,
  NotificationSettings,
  NotificationTestChannel,
  NotificationTestResult,
  NotificationVerificationResult,
  SaveNotificationSettingsRequest
} from '../../../shared/types'
import {
  NOTIFICATION_CENTER_NOT_READY,
  NOTIFICATION_CENTER_UNAVAILABLE,
  notificationErrorMessage,
  parseNotificationDetail,
  parseNotificationListPage,
  parseNotificationReadResult,
  parseNotificationSettings
} from '../../../shared/notificationCenter'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

// Trung tâm thông báo V457: một RPC Desktop, staff/tổ chức lấy từ phiên đăng nhập,
// đi qua Supabase client sẵn có (không thêm pool/kết nối). Hợp đồng: docs/NOTIFICATION_CENTER.md.
const RPC_TIMEOUT_MS = 15_000

type NotificationCenterAction =
  | 'get_settings' | 'save_settings' | 'test' | 'resend_verification' | 'list' | 'detail'
  | 'mark_read' | 'unread_count' | 'set_device_enabled' | 'unregister_device'

/** Lỗi đã chuẩn hóa: `code` là mã `notification_*`, `message` là câu tiếng Việt cho người dùng. */
export class NotificationCenterError extends Error {
  constructor(readonly code: string, message = notificationErrorMessage(code)) {
    super(message)
    this.name = 'NotificationCenterError'
  }
}

/**
 * Không chuyển SQL/chi tiết PostgREST sang renderer: chỉ giữ mã `notification_*`.
 * RPC chưa có (DB chưa apply V457: PostgREST PGRST202 / Postgres 42883) thành
 * `notification_center_not_ready` để renderer quay về form email cũ.
 */
export function toNotificationCenterError(error: { message?: unknown; code?: unknown } | null | undefined): NotificationCenterError {
  const sqlState = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  if (sqlState === 'PGRST202' || sqlState === '42883') return new NotificationCenterError(NOTIFICATION_CENTER_NOT_READY)
  // Mã do RPC tự RAISE (vd. `notification_settings_conflict`); bỏ qua tên hàm `aka_agent_notification_*`
  // có thể xuất hiện trong lỗi quyền/PostgREST.
  const code = /(?:^|[^a-z_])(notification_[a-z_]+)/.exec(message)?.[1]
  if (code) return new NotificationCenterError(code)
  if (/automation_auth_(?:required|invalid)|desktop_[a-z_]+_denied/.test(message)) return new NotificationCenterError('notification_session_invalid')
  if (sqlState === '57014' || /AbortError|TimeoutError/i.test(message)) {
    return new NotificationCenterError(NOTIFICATION_CENTER_UNAVAILABLE, 'Hết thời gian chờ máy chủ thông báo. Vui lòng thử lại.')
  }
  return new NotificationCenterError(NOTIFICATION_CENTER_UNAVAILABLE)
}

async function callNotificationCenter(action: NotificationCenterAction, payload: Record<string, unknown> = {}): Promise<unknown> {
  let user: ReturnType<typeof requireCurrentUser>
  let credentials: ReturnType<typeof requireCurrentUserCredentials>
  try {
    user = requireCurrentUser()
    credentials = requireCurrentUserCredentials()
  } catch {
    throw new NotificationCenterError('notification_session_invalid')
  }
  let result: { data: unknown; error: { message?: unknown; code?: unknown } | null }
  try {
    result = await getSupabaseClient().rpc('aka_agent_notification_center', {
      p_staff_id: user.staffId,
      p_organization_id: user.organizationId,
      p_auth_username: credentials.username,
      p_auth_password: credentials.password,
      p_action: action,
      p_payload: payload
    }).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
  } catch (error) {
    // Lỗi ném ra từ client (mạng, hủy): chỉ lấy tên lỗi để phân loại, không chuyển nội dung đi.
    result = { data: null, error: { message: error instanceof Error ? error.name : '', code: '' } }
  }
  const current = getCurrentUser()
  if (current?.staffId !== user.staffId || current.organizationId !== user.organizationId
    || getCurrentUserCredentials() !== credentials) {
    throw new NotificationCenterError('notification_session_changed')
  }
  if (result.error) {
    const failure = toNotificationCenterError(result.error)
    if (failure.code !== NOTIFICATION_CENTER_NOT_READY) {
      const sqlState = typeof result.error.code === 'string' && result.error.code ? ` (${result.error.code})` : ''
      console.warn(`[notification-center] ${action} failed: ${failure.code}${sqlState}`)
    }
    throw failure
  }
  return result.data
}

function requireShape<T>(value: T | null): T {
  if (value === null) throw new NotificationCenterError(NOTIFICATION_CENTER_UNAVAILABLE)
  return value
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export async function getNotificationSettings(): Promise<NotificationSettings> {
  return requireShape(parseNotificationSettings(await callNotificationCenter('get_settings')))
}

/** `request` đã qua sanitizeSaveNotificationSettingsRequest; revision lệch trả notification_settings_conflict. */
export async function saveNotificationSettings(request: SaveNotificationSettingsRequest): Promise<NotificationSettings> {
  return requireShape(parseNotificationSettings(await callNotificationCenter('save_settings', { ...request })))
}

export async function sendNotificationTest(channel: NotificationTestChannel): Promise<NotificationTestResult> {
  const data = await callNotificationCenter('test', { channel })
  if (!isRecord(data) || data.ok !== true) throw new NotificationCenterError(NOTIFICATION_CENTER_UNAVAILABLE)
  return {
    ok: true,
    id: typeof data.id === 'number' ? data.id : 0,
    deliveryMode: data.deliveryMode === 'live' ? 'live' : 'dry_run'
  }
}

export async function resendNotificationVerification(email: string): Promise<NotificationVerificationResult> {
  const data = await callNotificationCenter('resend_verification', { email })
  if (!isRecord(data) || data.ok !== true) throw new NotificationCenterError(NOTIFICATION_CENTER_UNAVAILABLE)
  return { ok: true, requested: data.requested === true }
}

export async function listNotifications(query: NotificationListQuery): Promise<NotificationListPage> {
  const payload: Record<string, unknown> = {}
  if (query.limit !== undefined) payload.limit = query.limit
  if (query.type) payload.type = query.type
  if (query.unreadOnly) payload.unreadOnly = true
  if (query.cursor) payload.cursor = { createdAt: query.cursor.createdAt, id: query.cursor.id }
  return requireShape(parseNotificationListPage(await callNotificationCenter('list', payload)))
}

export async function getNotificationDetail(id: number): Promise<NotificationDetail> {
  return requireShape(parseNotificationDetail(await callNotificationCenter('detail', { id })))
}

export async function markNotificationsRead(request: NotificationReadRequest): Promise<NotificationReadResult> {
  const payload = 'ids' in request ? { ids: request.ids } : { upToId: request.upToId, ...(request.type ? { type: request.type } : {}) }
  return requireShape(parseNotificationReadResult(await callNotificationCenter('mark_read', payload)))
}

export async function getNotificationUnreadCount(): Promise<number> {
  const data = await callNotificationCenter('unread_count')
  if (!isRecord(data) || typeof data.unreadCount !== 'number' || !Number.isSafeInteger(data.unreadCount)) {
    throw new NotificationCenterError(NOTIFICATION_CENTER_UNAVAILABLE)
  }
  return Math.max(0, data.unreadCount)
}

export async function setNotificationDeviceEnabled(deviceId: number, enabled: boolean): Promise<null> {
  await callNotificationCenter('set_device_enabled', { deviceId, enabled })
  return null
}

export async function unregisterNotificationDevice(deviceId: number): Promise<NotificationDeviceRemoval> {
  const data = await callNotificationCenter('unregister_device', { deviceId })
  if (!isRecord(data) || data.ok !== true) throw new NotificationCenterError(NOTIFICATION_CENTER_UNAVAILABLE)
  return { ok: true, updated: typeof data.updated === 'number' ? data.updated : 0 }
}
