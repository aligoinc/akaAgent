import { powerMonitor, type BrowserWindow } from 'electron'
import { DESKTOP_UI_ATTENTIVE, DESKTOP_UI_IPC, type DesktopUiAttention } from '../../shared/desktopUiReads'

/**
 * "Có ai đang nhìn cửa sổ chính không" cho bộ điều phối đọc của giao diện (docs/DESKTOP_UI_IDLE_READS.md).
 *
 * Cửa sổ chính đặt backgroundThrottling=false để bộ chạy không bị chậm khi thu nhỏ, nên giao diện không tự biết
 * mình đang bị ẩn. Hàm này chỉ hỏi cửa sổ và hệ điều hành tại thời điểm gọi: không đọc DB/mạng, không giữ cờ
 * trạng thái (không có gì kẹt được khi lỡ một sự kiện), không đổi backgroundThrottling hay đồng hồ nào của bộ
 * chạy/bộ lập lịch. Mọi lỗi hoặc không chắc = coi như đang có người nhìn, tức giao diện đọc như trước.
 */
export function readDesktopUiAttention(window: BrowserWindow | null | undefined): DesktopUiAttention {
  try {
    if (!window || window.isDestroyed()) return { ...DESKTOP_UI_ATTENTIVE }
    const windowHidden = window.isMinimized() || !window.isVisible()
    let screenLocked = false
    let idleSeconds = 0
    try { screenLocked = powerMonitor.getSystemIdleState(1) === 'locked' } catch { screenLocked = false }
    try { idleSeconds = Number(powerMonitor.getSystemIdleTime()) } catch { idleSeconds = 0 }
    return {
      hidden: windowHidden || screenLocked,
      idleSeconds: Number.isFinite(idleSeconds) && idleSeconds > 0 ? Math.floor(idleSeconds) : 0
    }
  } catch {
    return { ...DESKTOP_UI_ATTENTIVE }
  }
}

/**
 * Báo giao diện hỏi lại ngay khi cửa sổ thu nhỏ/khôi phục/ẩn/hiện, để quay lại là đọc liền thay vì chờ lượt hỏi
 * định kỳ. Tín hiệu không kèm dữ liệu; lỡ tín hiệu thì lượt hỏi định kỳ của giao diện vẫn bắt kịp.
 */
export function watchDesktopUiAttention(window: BrowserWindow): void {
  const notify = (): void => {
    try {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_UI_IPC.attentionChanged)
    } catch { /* Cửa sổ đang đóng: không còn ai cần tín hiệu. */ }
  }
  window.on('minimize', notify)
  window.on('restore', notify)
  window.on('hide', notify)
  window.on('show', notify)
}
