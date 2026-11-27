// Thẻ Tự động hóa › Quy trình của Desktop: nhúng trang Tự động hóa của Web (akaAgentWebApp `?embed=desktop`,
// apps/web/src/lib/desktopEmbed.ts). Hằng số dùng chung main / preload / renderer.

export const JOURNEY_WEB_IPC = {
  prepare: 'journey-web:prepare',
  reload: 'journey-web:reload',
  state: 'journey-web:state',
  navigateOut: 'journey-web:navigate-out'
} as const

/** Tiêu đề trang Web khi phiên hết hạn trong khung nhúng (trùng `DESKTOP_EMBED_EXPIRED_TITLE` của WebApp). */
export const JOURNEY_WEB_EXPIRED_TITLE = 'akaAgent: cần đăng nhập lại'

export type JourneyWebTheme = 'light' | 'dark'

/**
 * Trang Web nhúng cùng phiên (cùng phân vùng, cùng lần đăng nhập native): `automation` = thẻ Tự động hóa › Quy trình (như cũ),
 * `eventBot` = mục menu Bot sự kiện (docs/EVENT_BOT_TECH.md mục 8). Mỗi trang một webview, một đường mặc định, một tiêu đề trong câu báo.
 */
export type JourneyWebView = 'automation' | 'eventBot'

export const JOURNEY_WEB_VIEWS: Record<JourneyWebView, { defaultPath: string; title: string }> = {
  automation: { defaultPath: '/automation', title: 'Tự động hóa' },
  eventBot: { defaultPath: '/automation/event-bot', title: 'Bot sự kiện' }
}

export function journeyWebView(value: unknown): JourneyWebView {
  return value === 'eventBot' ? 'eventBot' : 'automation'
}

/** Trang nhúng của một địa chỉ trong khung (Bot sự kiện có đường riêng, còn lại là Quy trình). */
export function journeyWebViewOfPath(path: string): JourneyWebView {
  const pathname = path.split(/[?#]/, 1)[0]
  return pathname === '/automation/event-bot' || pathname.startsWith('/automation/event-bot/') ? 'eventBot' : 'automation'
}

export interface JourneyWebState {
  revision: number
  /** Đổi khi trang bị sập phải dựng webview mới. */
  webviewGeneration: number
  status: 'connecting' | 'ready' | 'error' | 'closed'
  /** Trang nhúng của trạng thái này; thiếu = `automation` (bản cũ chỉ có một trang). */
  view?: JourneyWebView
  partition: string
  /** Địa chỉ webview nạp lúc dựng (đường trong `/automation`, kèm `?embed=desktop&theme=`). */
  url: string
  message?: string
}

/** Đường được ở lại trong khung nhúng (cùng luật `desktopEmbedInsidePath` của WebApp). */
export function journeyWebInsidePath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0]
  if (pathname === '/automation/from-campaigns' || pathname.startsWith('/automation/from-campaigns/')) return false
  return pathname === '/automation' || pathname.startsWith('/automation/')
}

/** Đường an toàn để mở trong khung: chỉ `/automation…`, không giao thức, không `..`. Sai thì về đường mặc định (`/automation`). */
export function journeyWebStartPath(path: string | null | undefined, fallback = '/automation'): string {
  const value = typeof path === 'string' ? path.trim() : ''
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('..') || value.length > 300 || !journeyWebInsidePath(value)) return fallback
  return value
}

export function journeyWebUrl(origin: string, path: string | null | undefined, theme: JourneyWebTheme, fallback = '/automation'): string {
  const url = new URL(journeyWebStartPath(path, fallback), origin)
  url.searchParams.set('embed', 'desktop')
  url.searchParams.set('theme', theme)
  return url.href
}

/** Link ra ngoài Tự động hóa mà Desktop mở bằng màn của chính nó. */
export type JourneyWebOutside =
  | { kind: 'campaign'; campaignId: number; edit: boolean }
  | { kind: 'newCampaign' }
  | { kind: 'campaigns' }
  | { kind: 'dataGroup'; groupId: number | null }
  | { kind: 'account'; accountId: number }
  | { kind: 'accounts' }
  | { kind: 'fromCampaigns' }
  | { kind: 'external'; url: string }

const positive = (value: string | null): number | null => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/** Phân loại một địa chỉ cùng origin với Web mà trang nhúng muốn đi tới. */
export function classifyJourneyWebOutside(href: string, origin: string): JourneyWebOutside {
  let url: URL
  try { url = new URL(href) } catch { return { kind: 'external', url: origin } }
  if (url.origin !== origin) return { kind: 'external', url: url.href }
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (path === '/automation/from-campaigns' || path.startsWith('/automation/from-campaigns/')) return { kind: 'fromCampaigns' }
  if (path === '/campaigns/new') return { kind: 'newCampaign' }
  if (path === '/campaigns' || path.startsWith('/campaigns/')) {
    const parts = path.split('/')
    const id = positive(url.searchParams.get('campaign')) ?? positive(parts[2] ?? null)
    return id ? { kind: 'campaign', campaignId: id, edit: parts[3] === 'edit' } : { kind: 'campaigns' }
  }
  if (path === '/data-groups' || path.startsWith('/data-groups/')) {
    return { kind: 'dataGroup', groupId: positive(url.searchParams.get('group')) ?? positive(path.split('/')[2] ?? null) }
  }
  if (path === '/accounts' || path.startsWith('/accounts/')) {
    const id = positive(url.searchParams.get('account')) ?? positive(path.split('/')[2] ?? null)
    return id ? { kind: 'account', accountId: id } : { kind: 'accounts' }
  }
  return { kind: 'external', url: url.href }
}
