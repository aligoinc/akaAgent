import type { BrowserWindow } from 'electron'
import { JOURNEY_WEB_SURFACE, JourneyWebService } from '../../services/journeyWebService'
import { JOURNEY_WEB_IPC } from '../../../shared/journeyWebDesktop'
import { registerDesktopWebEmbedHandlers, type DesktopWebEmbedHandles } from './desktopWebEmbedHandlers'

/**
 * Thẻ Tự động hóa › Quy trình (trang Web nhúng). Dịch vụ tạo khi khách mở thẻ lần đầu, gắn với nhân viên đang đăng nhập;
 * đăng xuất / đổi tài khoản thì `reset()` xoá phiên và cookie của phân vùng.
 */
export function registerJourneyWebHandlers(mainWindow: BrowserWindow): DesktopWebEmbedHandles {
  return registerDesktopWebEmbedHandlers(mainWindow, JOURNEY_WEB_IPC, JOURNEY_WEB_SURFACE,
    (window, staffId, organizationId) => new JourneyWebService(window, staffId, organizationId))
}
