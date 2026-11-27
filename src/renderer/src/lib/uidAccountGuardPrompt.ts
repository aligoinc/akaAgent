import {
  UID_GUARD_CLOSE_LABEL, uidGuardSkipLabel, uidGuardUseAccountLabel, type UidAccountGuardCheckResponse
} from '../../../shared/campaignUidAccountGuard'
import type { UidAccountGuardIpcRequest } from '../../../shared/campaignUidAccountGuardIpc'
import type { AlertOptions, AlertType, ConfirmOptions } from '../stores/uiStore'

/**
 * Hộp báo khi danh sách người nhận được quét bằng tài khoản Zalo khác (DAT04, V679; docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md).
 * Câu do hợp đồng dùng chung dựng (src/shared/campaignUidAccountGuard.ts); ở đây chỉ chọn nút: "Bỏ N người này" khi danh sách lẫn,
 * "Dùng tài khoản X" khi một tài khoản của chính khách đã quét cả danh sách, còn lại chỉ "Đóng".
 */
type Verdict = NonNullable<UidAccountGuardCheckResponse['verdict']>

/** Hỏi tiến trình chính. Không kiểm được thì trả null (cho lưu: lúc chạy người nhận sai tài khoản vẫn được giữ lại). */
export async function checkUidAccountGuard(request: UidAccountGuardIpcRequest): Promise<UidAccountGuardCheckResponse | null> {
  try {
    const result = await window.electronAPI.campaignUidAccountGuard(request)
    return result.ok ? result.data : null
  } catch {
    return null
  }
}

/** Khách chọn "Bỏ N người này": lần lưu / Tiếp tục kế tiếp của chiến dịch đó được đi qua. */
export async function allowUidAccountGuardSkip(campaignId: number, accountId?: number | null): Promise<void> {
  await window.electronAPI.campaignUidAccountGuard({ action: 'allow-skip', campaignId, accountId: accountId ?? null }).catch(() => undefined)
}

interface Feedback {
  showAlert: (message: string, type?: AlertType, options?: AlertOptions) => void
  showConfirm: (message: string, onConfirm: () => void | Promise<void>, options?: ConfirmOptions) => void
}

export function showUidAccountGuard(
  feedback: Feedback,
  verdict: Verdict,
  actions: { onSkip?: () => void | Promise<void>; onUseAccount?: (accountId: number) => void | Promise<void> } = {}
): void {
  const title = verdict.kind === 'resume' ? 'Chưa chạy tiếp được' : verdict.title
  if (verdict.canSkip && actions.onSkip) {
    feedback.showConfirm(verdict.message, actions.onSkip, {
      title, confirmText: uidGuardSkipLabel(verdict.blocked), cancelText: UID_GUARD_CLOSE_LABEL, variant: 'primary'
    })
    return
  }
  if (verdict.suggestedAccountId && actions.onUseAccount) {
    const accountId = verdict.suggestedAccountId
    feedback.showConfirm(verdict.message, () => actions.onUseAccount!(accountId), {
      title, confirmText: uidGuardUseAccountLabel(verdict.suggestedAccountName || ''), cancelText: UID_GUARD_CLOSE_LABEL, variant: 'primary'
    })
    return
  }
  feedback.showAlert(verdict.kind === 'resume' ? verdict.message : `${verdict.title}\n${verdict.message}`, 'error')
}
