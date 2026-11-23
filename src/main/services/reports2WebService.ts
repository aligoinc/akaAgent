import type { BrowserWindow } from 'electron'
import { REPORTS2_WEB_IPC, classifyReports2WebOutside, reports2WebInsidePath, reports2WebUrl } from '../../shared/reports2WebDesktop'
import { DesktopWebEmbedService, type DesktopWebEmbedSurface } from './desktopWebEmbedService'

/**
 * Menu Báo cáo 2: webview nạp trang Báo cáo 2 của Web ở chế độ nhúng (`/reports-2?embed=desktop`). Số liệu, bộ lọc và
 * gợi ý là của Web (không chép logic báo cáo sang Desktop); Desktop chỉ đăng nhập, giữ phiên trong phân vùng riêng và mở
 * màn của chính nó khi trang bấm sang chiến dịch, tài khoản, Báo cáo, Quét data.
 */
export const REPORTS2_WEB_SURFACE: DesktopWebEmbedSurface = {
  label: 'Báo cáo 2',
  logTag: 'Reports2Web',
  // Phân vùng riêng (khác Tự động hóa): webRequest và quyền gắn theo phân vùng.
  partitionPrefix: 'akaagent_web_reports2',
  stateChannel: REPORTS2_WEB_IPC.state,
  navigateOutChannel: REPORTS2_WEB_IPC.navigateOut,
  userAgent: 'akaAgent-Desktop/reports-2',
  insidePath: reports2WebInsidePath,
  url: reports2WebUrl,
  classifyOutside: classifyReports2WebOutside
}

export class Reports2WebService extends DesktopWebEmbedService {
  constructor(mainWindow: BrowserWindow, staffId: number, organizationId: number) {
    super(mainWindow, staffId, organizationId, REPORTS2_WEB_SURFACE)
  }
}
