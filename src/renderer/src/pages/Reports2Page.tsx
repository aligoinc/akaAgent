import DesktopWebEmbedFrame, { type DesktopWebEmbedApi } from '../components/WebEmbed/DesktopWebEmbedFrame'

/** Lời gọi tới main ổn định qua các lần vẽ (khung chỉ đăng ký một lần). */
const REPORTS2_WEB_API: DesktopWebEmbedApi = {
  prepare: (theme, path) => window.electronAPI.reports2WebPrepare(theme, path ?? null),
  reload: () => window.electronAPI.reports2WebReload(),
  onState: callback => window.electronAPI.onReports2WebState(callback)
}

/**
 * Menu Báo cáo 2 (người dùng yêu cầu 23/11/2026): trang Báo cáo 2 của Web (tỷ lệ gửi thành công theo kênh Zalo, SMS,
 * Facebook, Email) ở chế độ nhúng. Số liệu, bộ lọc, nút Làm mới là của trang Web; menu Báo cáo của Desktop giữ nguyên.
 * Không tải gì tới khi khách mở menu lần đầu.
 */
export default function Reports2Page({ isActive }: { isActive: boolean }) {
  return <DesktopWebEmbedFrame api={REPORTS2_WEB_API} label="Báo cáo 2" isActive={isActive} />
}
