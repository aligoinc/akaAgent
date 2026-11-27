import type { UidAccountGuardIpcRequest } from '../../../shared/campaignUidAccountGuardIpc'
import type { AlertOptions, AlertType } from '../stores/uiStore'

/**
 * Danh sách người nhận được quét bằng tài khoản Zalo khác (DAT04, V679; docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md): chặn lưu, hiện một
 * câu chung (src/shared/campaignUidAccountGuard.ts UID_GUARD_MESSAGE), chỉ có nút Đóng.
 */

/** Hỏi tiến trình chính: trả câu báo khi bị chặn, null khi không chặn. Không kiểm được thì null (cho lưu: lúc chạy người nhận sai
 * tài khoản vẫn được giữ lại). */
export async function checkUidAccountGuard(request: UidAccountGuardIpcRequest): Promise<string | null> {
  try {
    const result = await window.electronAPI.campaignUidAccountGuard(request)
    return result.ok && result.data.blocked && result.data.message ? result.data.message : null
  } catch {
    return null
  }
}

export function showUidAccountGuard(
  feedback: { showAlert: (message: string, type?: AlertType, options?: AlertOptions) => void },
  message: string
): void {
  feedback.showAlert(message, 'error')
}
