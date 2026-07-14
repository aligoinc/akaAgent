import type { ZaloRuntimeRestartRequiredPayload } from '../../../shared/types'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

export const ZALO_RUNTIME_RESTART_REQUIRED_MESSAGE =
  'Chế độ chạy Zalo đã thay đổi. Vui lòng tắt và mở lại ứng dụng.'

export const ZALO_LOCAL_STARTUP_HANDOFF_MESSAGE =
  'Zalo local đang chờ app server dừng và bàn giao an toàn. Vui lòng thử lại sau.'

let restartRequired: ZaloRuntimeRestartRequiredPayload | null = null
let localStartupHandoffBlocked = false

export interface StaffZaloRuntimeModeSnapshot {
  isZaloServer: boolean
  revision: string
}

export async function loadStaffZaloServerModeSnapshot(
  staffId: number
): Promise<StaffZaloRuntimeModeSnapshot> {
  const normalizedStaffId = Math.floor(Number(staffId))
  if (!Number.isSafeInteger(normalizedStaffId) || normalizedStaffId <= 0) {
    throw new Error('Staff ID không hợp lệ.')
  }

  const { data, error } = await client().rpc('get_staff_zalo_runtime_mode', {
    p_staff_id: normalizedStaffId
  })

  if (error) {
    console.error('[zalo-runtime-mode] load staff mode:', error)
    throw new Error('Không thể kiểm tra chế độ chạy Zalo. Vui lòng thử lại sau.')
  }
  const payload = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  const revision = String(payload?.revision || '').trim()
  if (!payload || !revision) throw new Error('Tài khoản staff không còn hoạt động.')
  return {
    isZaloServer: payload.is_zalo_server === true,
    revision
  }
}

export async function loadStaffZaloServerMode(staffId: number): Promise<boolean> {
  return (await loadStaffZaloServerModeSnapshot(staffId)).isZaloServer
}

export function getZaloRuntimeRestartRequired(): ZaloRuntimeRestartRequiredPayload | null {
  return restartRequired
}

export function clearZaloRuntimeRestartRequired(): void {
  restartRequired = null
}

export function isZaloLocalStartupHandoffBlocked(): boolean {
  return localStartupHandoffBlocked
}

export function blockZaloLocalStartupHandoff(): void {
  localStartupHandoffBlocked = true
}

export function clearZaloLocalStartupHandoffBlock(): void {
  localStartupHandoffBlocked = false
}

export function markZaloRuntimeRestartRequired(
  databaseIsZaloServer: boolean
): ZaloRuntimeRestartRequiredPayload {
  const user = requireCurrentUser()
  const payload: ZaloRuntimeRestartRequiredPayload = {
    sessionIsZaloServer: user.isZaloServer,
    databaseIsZaloServer,
    message: ZALO_RUNTIME_RESTART_REQUIRED_MESSAGE
  }
  restartRequired = payload
  return payload
}

export function ensureCurrentUserZaloRuntimeCanStartOperation(): void {
  if (restartRequired) throw new Error(restartRequired.message)
  if (localStartupHandoffBlocked) throw new Error(ZALO_LOCAL_STARTUP_HANDOFF_MESSAGE)
}

export async function refreshCurrentUserZaloRuntimeMode(): Promise<{
  changed: boolean
  liveIsZaloServer: boolean
  payload: ZaloRuntimeRestartRequiredPayload | null
}> {
  const user = requireCurrentUser()
  const liveIsZaloServer = await loadStaffZaloServerMode(user.staffId)
  if (liveIsZaloServer === user.isZaloServer) {
    return { changed: false, liveIsZaloServer, payload: restartRequired }
  }
  return {
    changed: true,
    liveIsZaloServer,
    payload: markZaloRuntimeRestartRequired(liveIsZaloServer)
  }
}

/**
 * New operations always stay on the runtime selected when this desktop session
 * started. A live mode mismatch requires an app restart; it must never hot-route
 * a command (especially cancel/cleanup) to the other runtime.
 */
export async function shouldRouteCurrentUserZaloToServer(): Promise<boolean> {
  ensureCurrentUserZaloRuntimeCanStartOperation()
  const user = requireCurrentUser()
  const liveMode = await loadStaffZaloServerMode(user.staffId)
  if (liveMode !== user.isZaloServer) {
    const payload = markZaloRuntimeRestartRequired(liveMode)
    throw new Error(payload.message)
  }
  return user.isZaloServer
}

export function shouldRouteCurrentUserZaloCleanupToServer(): boolean {
  return requireCurrentUser().isZaloServer
}
