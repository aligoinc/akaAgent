/** DB is authoritative. Assigned permissions do not imply an active entitlement. */
export type AppAccessApp = 'akaAgent' | 'akaChat'
export type AppAccessTarget = 'staff' | 'account'

export interface AppAccessQuota {
  hasPackage: boolean
  limit: number | null
  used: number
  remaining: number | null
  overLimit: boolean
  productIds: number[]
}

export interface AppAccessFlags {
  isAkaAgentEnabled: boolean
  isAkachatEnabled: boolean
  akaAgentAllowed: boolean
  akachatAllowed: boolean
  stopping: boolean
}

export interface AppAccessSnapshot {
  separateAccess: boolean
  usesChatRuntime: boolean
  staff: AppAccessFlags
  staffQuotas: Record<AppAccessApp, AppAccessQuota>
  accountQuotas: Record<AppAccessApp, AppAccessQuota>
  accounts: Record<string, AppAccessFlags>
}

export interface AppAccessChange {
  targetType: AppAccessTarget
  targetId: number
  app: AppAccessApp
  enabled: boolean
  requestId: string
}

export interface AppAccessChangeResult {
  requestId: string
  status: 'completed' | 'stopping'
  targetType: AppAccessTarget
  targetId: number
  access: AppAccessFlags
}

export interface AppAccessAPI {
  snapshot(accountIds?: number[]): Promise<AppAccessSnapshot>
  set(input: AppAccessChange): Promise<AppAccessChangeResult>
}

export function appAccessErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    app_access_package_required: 'Ứng dụng chưa có gói còn hạn.',
    app_access_staff_limit: 'Đã hết suất nhân viên của ứng dụng.',
    app_access_account_limit: 'Chủ tài khoản đã hết suất tài khoản của ứng dụng.',
    app_access_owner_agent_required: 'Chủ tài khoản chưa có quyền dùng akaAgent.',
    app_access_local_reader_required: 'Hãy chuyển tài khoản QR local sang Server hoặc tắt đồng bộ akaChat trước.',
    app_access_stopping: 'Tác vụ cũ đang dừng. Hãy chờ hoàn tất trước khi bật lại.',
    app_access_zalo_only: 'Chỉ tài khoản Zalo QR local và Zalo Server được đồng bộ akaChat.',
    app_access_denied: 'Bạn không có quyền thay đổi quyền sử dụng này.',
    app_access_request_mismatch: 'Mã yêu cầu đã được dùng cho một thay đổi khác.',
    zalo_already_linked: 'Zalo này đã được liên kết với tài khoản khác trong tổ chức.'
  }
  return messages[code] ?? 'Không thể cập nhật quyền sử dụng. Vui lòng thử lại.'
}
