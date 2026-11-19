import { create } from 'zustand'
import { UPGRADE_PORTAL_UPDATED_TEXT, type UpgradePortalLinkRequest } from '../../../shared/upgradePortal'
import { useRenewalReminderStore } from './renewalReminderStore'
import { useUiStore } from './uiStore'

/**
 * Form "Nâng cấp và mua gói" (docs/UPGRADE_PORTAL_DESKTOP.md): mọi lối gia hạn / nâng cấp mới của phần mềm gọi `open`.
 * Store chỉ giữ yêu cầu đang mở; link do tiến trình chính tự nạp vào form. Không đọc DB, không hẹn giờ.
 */
interface UpgradePortalStore {
  request: UpgradePortalLinkRequest | null
  /** Tăng mỗi lần mở, để form dựng lại từ đầu. */
  openSeq: number
  open(request: UpgradePortalLinkRequest): void
  /** Khách đóng form: tiến trình chính xoá dữ liệu phiên cổng và đọc lại gói một lượt. */
  close(): void
  /** Đổi phiên hoặc cửa sổ "Gia hạn gói" mở lên: bỏ form (tiến trình chính tự đóng webview). */
  reset(): void
}

export const useUpgradePortalStore = create<UpgradePortalStore>((set, get) => ({
  request: null,
  openSeq: 0,

  open(request) {
    // Form hoặc cửa sổ "Gia hạn gói" đang mở: dùng lại cửa sổ đang mở, không mở thêm.
    if (get().request || useRenewalReminderStore.getState().windowOpen) return
    set({ request: { from: request.from, entitlementId: request.entitlementId ?? null }, openSeq: get().openSeq + 1 })
  },

  close() {
    if (!get().request) return
    set({ request: null })
    const close = window.electronAPI?.closeUpgradePortal
    if (!close) return
    void close()
      .then(result => { if (result?.updated) useUiStore.getState().showAlert(UPGRADE_PORTAL_UPDATED_TEXT, 'success') })
      .catch(() => { /* Không đọc lại được gói: lượt kiểm gói định kỳ sẽ nhận sau. */ })
  },

  reset() { if (get().request) set({ request: null }) }
}))
