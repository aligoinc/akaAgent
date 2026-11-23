import type { BrowserWindow } from 'electron'
import { REPORTS2_WEB_SURFACE, Reports2WebService } from '../../services/reports2WebService'
import { REPORTS2_WEB_IPC } from '../../../shared/reports2WebDesktop'
import { registerDesktopWebEmbedHandlers, type DesktopWebEmbedHandles } from './desktopWebEmbedHandlers'

/**
 * Menu Báo cáo 2 (trang Web nhúng). Dịch vụ tạo khi khách mở trang lần đầu, gắn với nhân viên đang đăng nhập;
 * đăng xuất / đổi tài khoản thì `reset()` xoá phiên và cookie của phân vùng.
 */
export function registerReports2WebHandlers(mainWindow: BrowserWindow): DesktopWebEmbedHandles {
  return registerDesktopWebEmbedHandlers(mainWindow, REPORTS2_WEB_IPC, REPORTS2_WEB_SURFACE,
    (window, staffId, organizationId) => new Reports2WebService(window, staffId, organizationId))
}
