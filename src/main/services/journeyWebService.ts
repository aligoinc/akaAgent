import type { BrowserWindow } from 'electron'
import {
  JOURNEY_WEB_IPC, classifyJourneyWebOutside, journeyWebInsidePath, journeyWebUrl
} from '../../shared/journeyWebDesktop'
import { DESKTOP_WEB_ORIGIN, DesktopWebEmbedService, type DesktopWebEmbedSurface } from './desktopWebEmbedService'

/**
 * Thẻ Tự động hóa › Quy trình: webview nạp trang Tự động hóa của Web ở chế độ nhúng (`?embed=desktop`).
 * Luật đăng nhập, cookie, chặn điều hướng và dọn phiên dùng chung với Báo cáo 2 (`desktopWebEmbedService.ts`).
 */
export const JOURNEY_WEB_ORIGIN = DESKTOP_WEB_ORIGIN

export const JOURNEY_WEB_SURFACE: DesktopWebEmbedSurface = {
  label: 'Tự động hóa',
  logTag: 'JourneyWeb',
  // Phân vùng giữ nguyên như trước khi có Báo cáo 2 (`persist:akaagent_web_<tổ chức>_<nhân viên>`).
  partitionPrefix: 'akaagent_web',
  stateChannel: JOURNEY_WEB_IPC.state,
  navigateOutChannel: JOURNEY_WEB_IPC.navigateOut,
  userAgent: 'akaAgent-Desktop/automation',
  insidePath: journeyWebInsidePath,
  url: journeyWebUrl,
  classifyOutside: classifyJourneyWebOutside
}

export class JourneyWebService extends DesktopWebEmbedService {
  constructor(mainWindow: BrowserWindow, staffId: number, organizationId: number) {
    super(mainWindow, staffId, organizationId, JOURNEY_WEB_SURFACE)
  }
}
