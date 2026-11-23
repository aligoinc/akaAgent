import { Workflow } from 'lucide-react'
import DesktopWebEmbedFrame, { type DesktopWebEmbedApi } from '../WebEmbed/DesktopWebEmbedFrame'

/** Lời gọi tới main ổn định qua các lần vẽ (khung chỉ đăng ký một lần). */
const JOURNEY_WEB_API: DesktopWebEmbedApi = {
  prepare: (theme, path) => window.electronAPI.journeyWebPrepare(theme, path ?? null),
  reload: () => window.electronAPI.journeyWebReload(),
  onState: callback => window.electronAPI.onJourneyWebState(callback)
}

/**
 * Thẻ Tự động hóa › Quy trình: trang Tự động hóa của Web ở chế độ nhúng (`?embed=desktop`). Main đăng nhập và đặt cookie phiên
 * trong phân vùng riêng; webview chỉ dựng khi khách mở thẻ lần đầu (khung dùng chung với Báo cáo 2).
 */
export default function JourneysEmbed({ isActive, openPath }: { isActive: boolean; openPath?: { path: string; nonce: number } | null }) {
  return <DesktopWebEmbedFrame api={JOURNEY_WEB_API} label="Tự động hóa" regionLabel="Quy trình" isActive={isActive} openPath={openPath}
    bar={<>
      <Workflow size={16} aria-hidden="true" />
      <span>Quy trình tự động: dựng kéo thả hoặc nhờ Agent dựng, chạy trên máy chủ.</span>
    </>} />
}
