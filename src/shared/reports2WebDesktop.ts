// Menu Báo cáo 2 của Desktop (người dùng yêu cầu 23/11/2026 "Thêm menu: Báo cáo 2 > hiển thị trang báo cáo này. Giữ nguyên
// menu báo cáo như hiện tại"): nhúng trang Báo cáo 2 của Web (akaAgentWebApp `/reports-2?embed=desktop`,
// apps/web/src/lib/desktopEmbed.ts). Hằng số dùng chung main / preload / renderer.
import { classifyJourneyWebOutside, type JourneyWebOutside, type JourneyWebTheme } from './journeyWebDesktop'

export const REPORTS2_WEB_IPC = {
  prepare: 'reports2-web:prepare',
  reload: 'reports2-web:reload',
  state: 'reports2-web:state',
  navigateOut: 'reports2-web:navigate-out'
} as const

export const REPORTS2_WEB_HOME = '/reports-2'

/** Đường được ở lại trong khung nhúng (cùng luật phần `reports2` của `desktopEmbedInsidePath` của WebApp). */
export function reports2WebInsidePath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0]
  return pathname === REPORTS2_WEB_HOME || pathname.startsWith(`${REPORTS2_WEB_HOME}/`)
}

/** Đường an toàn để mở trong khung: chỉ `/reports-2…`, không giao thức, không `..`. Sai thì về `/reports-2`. */
export function reports2WebStartPath(path: string | null | undefined): string {
  const value = typeof path === 'string' ? path.trim() : ''
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('..') || value.length > 300 || !reports2WebInsidePath(value)) return REPORTS2_WEB_HOME
  return value
}

export function reports2WebUrl(origin: string, path: string | null | undefined, theme: JourneyWebTheme): string {
  const url = new URL(reports2WebStartPath(path), origin)
  url.searchParams.set('embed', 'desktop')
  url.searchParams.set('theme', theme)
  return url.href
}

/** Thẻ của trang Báo cáo (menu Báo cáo của Desktop) mà link "Xem tất cả…" của Báo cáo 2 mở. */
export type Reports2ReportsTab = 'achievements' | 'campaigns' | 'accounts'
const REPORT_TABS: readonly Reports2ReportsTab[] = ['achievements', 'campaigns', 'accounts']

/** Link ra ngoài Báo cáo 2 mà Desktop mở bằng màn của chính nó. */
export type Reports2WebOutside =
  | JourneyWebOutside
  | { kind: 'reports'; tab: Reports2ReportsTab | null }
  | { kind: 'dataScan' }

/** Phân loại một địa chỉ mà trang Báo cáo 2 nhúng muốn đi tới. */
export function classifyReports2WebOutside(href: string, origin: string): Reports2WebOutside {
  let url: URL
  try { url = new URL(href) } catch { return { kind: 'external', url: origin } }
  if (url.origin !== origin) return { kind: 'external', url: url.href }
  const path = url.pathname.replace(/\/+$/, '') || '/'
  // "Xem tất cả … / Xem theo chiến dịch": trang Báo cáo của Desktop, đúng thẻ.
  if (path === '/reports' || path.startsWith('/reports/')) {
    const tab = url.searchParams.get('tab')
    return { kind: 'reports', tab: REPORT_TABS.includes(tab as Reports2ReportsTab) ? tab as Reports2ReportsTab : null }
  }
  // "Kiểm tra số điện thoại" (Lấy danh bạ Zalo trên Web): Quét data của Desktop.
  if (path === '/data' || path.startsWith('/data/')) return { kind: 'dataScan' }
  return classifyJourneyWebOutside(href, origin)
}
