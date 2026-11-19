import { useCallback, useMemo } from 'react'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'
import PortalWebWindow, { type PortalWebWindowDriver, type PortalWebWindowTexts } from './PortalWebWindow'

const TEXTS: PortalWebWindowTexts = {
  title: 'Gia hạn gói',
  done: 'Đã gia hạn thành công.',
  loginNote: 'Vui lòng đăng nhập trang gia hạn bằng tài khoản akaAgent của bạn để tiếp tục.',
  loading: 'Đang mở trang gia hạn…',
  openFailed: 'Không thể mở trang gia hạn. Vui lòng thử lại.',
  loadFailed: 'Không tải được trang gia hạn. Vui lòng kiểm tra internet và thử lại.',
  reloadFailed: 'Không thể tải lại trang gia hạn. Vui lòng thử lại.',
  externalFailed: 'Không mở được trình duyệt. Vui lòng thử lại.',
  closeLabel: 'Đóng cửa sổ gia hạn',
  frameLabel: 'Trang gia hạn akaBiz'
}

/**
 * Cửa sổ "Gia hạn gói" khi đang đăng nhập (mở từ lời nhắc gia hạn): webview cổng CRM `/gia-han` (phân vùng
 * `akaagent_renewal`). Main tự nạp link (có vé hoặc trang đăng nhập cổng) vào guest; renderer chỉ gắn `about:blank`.
 * Chiến dịch vẫn chạy trong lúc mở. Phần khung dùng chung với form "Nâng cấp và mua gói" (`PortalWebWindow`).
 */
export default function RenewalReminderWindow({ reminderKey }: { reminderKey: string }) {
  const closeWindow = useRenewalReminderStore(store => store.closeWindow)
  const markRenewed = useRenewalReminderStore(store => store.markRenewed)
  const markRefreshOnFocus = useRenewalReminderStore(store => store.markRefreshOnFocus)

  const driver = useMemo<PortalWebWindowDriver>(() => ({
    open: () => window.electronAPI.openRenewalReminderWindow(reminderKey),
    reload: () => window.electronAPI.reloadRenewalReminderWindow(),
    openExternal: () => window.electronAPI.openRenewalReminderExternal(reminderKey),
    onState: callback => window.electronAPI.onRenewalReminderWebState(callback)
  }), [reminderKey])

  const close = useCallback(() => {
    // Main xoá dữ liệu phân vùng và đọc lại gói (khách có thể đã thanh toán rồi đóng).
    void window.electronAPI.closeRenewalReminderWindow().catch(() => {}).finally(closeWindow)
  }, [closeWindow])

  return (
    <PortalWebWindow texts={TEXTS} driver={driver} onClose={close} onCompleted={markRenewed} onExternalOpened={markRefreshOnFocus} />
  )
}
