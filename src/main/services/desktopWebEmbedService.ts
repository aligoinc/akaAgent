import { BrowserWindow, session, shell, type Session, type WebContents } from 'electron'
import { getCurrentUser, requireCurrentUserCredentials } from '../data/currentUser'
import { JOURNEY_WEB_EXPIRED_TITLE, type JourneyWebState, type JourneyWebTheme } from '../../shared/journeyWebDesktop'

/**
 * Một trang của Web (akaAgentWebApp) nhúng trong Desktop ở chế độ `?embed=desktop`: Tự động hóa › Quy trình và Báo cáo 2.
 * Mỗi trang (surface) có phân vùng, webview, phiên native và kênh IPC riêng; luật chung ở đây.
 *
 * Đăng nhập: main gọi đăng nhập native của API Web bằng tài khoản akaAgent đang dùng (như trang Chat), rồi đặt cookie phiên
 * `aka_agent_control_session` vào phân vùng riêng của webview. Phiên native không tính vào hạn 3 thiết bị Web, không đẩy phiên
 * trình duyệt của khách. Trang nhúng đọc `/me` bằng cookie đó (không qua web-entry). Mật khẩu và token không tới renderer.
 *
 * Chỉ tạo khi khách mở trang lần đầu; không hẹn giờ, không polling. Phiên hết hạn: trang đổi tiêu đề thành
 * `JOURNEY_WEB_EXPIRED_TITLE`, main đăng nhập lại một lần rồi nạp lại.
 */
export const DESKTOP_WEB_ORIGIN = (() => {
  try { return new URL(process.env.AKA_AGENT_WEB_APP_URL || 'https://agent.akabiz.net').origin } catch { return 'https://agent.akabiz.net' }
})()
const CONTROL_PREFIX = '/api/aka-agent/control/v1'
const COOKIE_NAME = 'aka_agent_control_session'
/** Phiên native sống 30 ngày ở API; cookie đặt ngắn hơn để lần mở sau đăng nhập lại. */
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60

/** Link ra ngoài trang nhúng: `external` mở trình duyệt; loại khác main gửi renderer để mở màn của Desktop. */
export type DesktopWebOutside = { kind: string; url?: string }

/** Một trang Web được nhúng: tên, phân vùng, kênh IPC và luật đường đi của trang đó. */
export interface DesktopWebEmbedSurface {
  /** Tên trang trong câu báo cho khách ("Tự động hóa", "Báo cáo 2"). */
  label: string
  /** Tên trong log. */
  logTag: string
  /** Phân vùng `persist:<prefix>_<tổ chức>_<nhân viên>`: mỗi trang một phân vùng (webRequest / quyền là của phân vùng). */
  partitionPrefix: string
  /** Kênh main → renderer: trạng thái và link ra ngoài. */
  stateChannel: string
  navigateOutChannel: string
  /** `user-agent` của lượt đăng nhập native (máy chủ ghi theo phiên). */
  userAgent: string
  /** Đường được ở lại trong khung (cùng luật `desktopEmbedInsidePath` của WebApp cho trang này). */
  insidePath(path: string): boolean
  /** Địa chỉ nạp trong webview (đường an toàn của trang, kèm `?embed=desktop&theme=`). */
  url(origin: string, path: string | null | undefined, theme: JourneyWebTheme): string
  /** Phân loại một địa chỉ cùng origin mà trang muốn đi tới (ngoài trang). */
  classifyOutside(href: string, origin: string): DesktopWebOutside
}

class DesktopWebAuthError extends Error {}

interface NativeLoginBody {
  status?: number
  message?: string
  data?: { status?: string; token?: string; me?: { id?: number; organization?: { id?: number } } }
}

function isWebOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === DESKTOP_WEB_ORIGIN && !url.username && !url.password
  } catch { return false }
}

function openExternal(value: string): void {
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) void shell.openExternal(url.href).catch(() => {})
  } catch { /* Link sai bị bỏ qua. */ }
}

/** Thu hồi phiên native trên máy chủ (đăng xuất / thay phiên). Lỗi bỏ qua: phiên tự hết hạn ở máy chủ. */
async function revokeNativeSession(token: string): Promise<void> {
  try {
    await fetch(`${DESKTOP_WEB_ORIGIN}${CONTROL_PREFIX}/auth/logout`, {
      method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000)
    })
  } catch { /* Bỏ qua. */ }
}

export class DesktopWebEmbedService {
  private readonly browserSession: Session
  private readonly staffId: number
  private readonly organizationId: number
  private state: JourneyWebState
  private disposed = false
  private loggedIn = false
  private inflight: Promise<void> | null = null
  private requestAbort: AbortController | null = null
  private guest: WebContents | null = null
  private readonly contents = new Set<WebContents>()
  private theme: JourneyWebTheme = 'light'
  private automaticRecoveryUsed = false
  /** Token phiên native đang đặt trong cookie; chỉ giữ trong RAM của main để thu hồi khi thay / đăng xuất. */
  private token: string | null = null
  /** Hẹn một lần sau điều hướng trong trang (pushState) để xem trang có dừng ở đường ngoài trang này không. */
  private inPageCheck: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly mainWindow: BrowserWindow,
    staffId: number,
    organizationId: number,
    private readonly surface: DesktopWebEmbedSurface
  ) {
    this.staffId = staffId
    this.organizationId = organizationId
    const partition = `persist:${surface.partitionPrefix}_${organizationId}_${staffId}`
    this.browserSession = session.fromPartition(partition)
    this.state = { revision: 0, webviewGeneration: 0, status: 'connecting', partition, url: surface.url(DESKTOP_WEB_ORIGIN, null, 'light') }
    mainWindow.webContents.on('will-attach-webview', this.beforeAttach)
    mainWindow.webContents.on('did-attach-webview', this.afterAttach)
    this.browserSession.setPermissionCheckHandler((contents, permission, origin) =>
      this.isCurrent() && !!contents && this.contents.has(contents) && isWebOrigin(origin) && ['clipboard-sanitized-write', 'fullscreen'].includes(permission))
    this.browserSession.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(this.isCurrent() && this.contents.has(contents) && isWebOrigin(details.requestingUrl) && ['clipboard-sanitized-write', 'fullscreen'].includes(permission)))
    // Trang nhúng không tải tệp về máy (xuất Excel… làm ở Web).
    this.browserSession.on('will-download', this.onDownload)
    this.browserSession.webRequest.onBeforeRequest({ urls: [`${DESKTOP_WEB_ORIGIN}${CONTROL_PREFIX}/auth/*`] }, (details, callback) => {
      // Đăng nhập / đăng xuất / đổi tài khoản chỉ do main làm: form đăng nhập trong trang không được đổi nhân viên.
      const path = new URL(details.url).pathname
      const fromPage = (details.webContentsId ?? -1) > 0
      callback({ cancel: this.disposed || (fromPage && (path.endsWith('/login') || path.includes('/logout') || path.includes('/web-entry'))) })
    })
    this.browserSession.webRequest.onCompleted({ urls: [`${DESKTOP_WEB_ORIGIN}${CONTROL_PREFIX}/me*`] }, details => {
      // Trang đọc được phiên bằng cookie hiện tại: cho phép tự đăng nhập lại ở lần hết hạn sau (một lần mỗi phiên tốt).
      if (details.statusCode >= 200 && details.statusCode < 300 && (details.webContentsId ?? -1) > 0) this.automaticRecoveryUsed = false
    })
  }

  private isCurrent(): boolean {
    const user = getCurrentUser()
    return !this.disposed && !!user && user.staffId === this.staffId && user.organizationId === this.organizationId
  }

  private publish(status: JourneyWebState['status'], message?: string, url?: string): void {
    this.state = { ...this.state, revision: this.state.revision + 1, status, message, ...(url ? { url } : {}) }
    if (!this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.send(this.surface.stateChannel, this.state)
    }
  }

  private navigateOut(href: string): void {
    const target = this.surface.classifyOutside(href, DESKTOP_WEB_ORIGIN)
    if (target.kind === 'external') { openExternal(target.url || ''); return }
    if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(this.surface.navigateOutChannel, target)
  }

  /** Mở trang: đăng nhập nếu chưa có phiên; `path` là đường trong trang cần mở (ví dụ một quy trình). */
  async prepare(theme: JourneyWebTheme, path?: string | null): Promise<JourneyWebState> {
    if (!this.isCurrent()) throw new Error('Phiên akaAgent đã kết thúc.')
    this.theme = theme
    const url = this.surface.url(DESKTOP_WEB_ORIGIN, path, theme)
    if (!this.loggedIn || this.state.status !== 'ready') await this.authenticate()
    if (this.state.status === 'ready' && url !== this.state.url) {
      this.publish('ready', undefined, url)
      if (path && this.guest && !this.guest.isDestroyed()) void this.guest.loadURL(url).catch(() => {})
    }
    return this.state
  }

  async reload(): Promise<JourneyWebState> {
    if (!this.isCurrent()) throw new Error('Phiên akaAgent đã kết thúc.')
    this.automaticRecoveryUsed = false
    this.loggedIn = false
    await this.authenticate()
    if (this.state.status === 'ready' && this.guest && !this.guest.isDestroyed()) void this.guest.loadURL(this.state.url).catch(() => {})
    return this.state
  }

  credentialsChanged(): void {
    if (!this.isCurrent()) return
    this.requestAbort?.abort()
    this.loggedIn = false
    void (this.inflight ?? Promise.resolve()).then(() => { if (this.isCurrent()) void this.authenticate() })
  }

  private authenticate(): Promise<void> {
    if (this.inflight) return this.inflight
    if (!this.isCurrent()) return Promise.resolve()
    const operation = this.performAuthentication().finally(() => { if (this.inflight === operation) this.inflight = null })
    this.inflight = operation
    return operation
  }

  private async performAuthentication(): Promise<void> {
    const { label } = this.surface
    const controller = new AbortController()
    this.requestAbort = controller
    if (this.state.status !== 'ready') this.publish('connecting', `Đang kết nối ${label}…`)
    try {
      const credentials = requireCurrentUserCredentials()
      // Đăng nhập bằng fetch của main (không qua phân vùng): token chỉ đi vào cookie httpOnly của phân vùng webview.
      const response = await fetch(`${DESKTOP_WEB_ORIGIN}${CONTROL_PREFIX}/auth/native/login`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-aka-desktop-accounts': '1', 'x-aka-facebook-campaigns': '1', 'user-agent': this.surface.userAgent },
        body: JSON.stringify({ username: credentials.username, password: credentials.password }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])
      })
      if (!this.isCurrent() || controller.signal.aborted) return
      // Khuôn trả lời của API Web: { status: 1, errorCode: 0, message, data } / lỗi { status: -1, errorCode: <HTTP>, message }.
      const body = await response.json().catch(() => null) as NativeLoginBody | null
      if (response.status === 401 || response.status === 403) {
        const message = typeof body?.message === 'string' && body.message.length <= 300 ? body.message : ''
        throw new DesktopWebAuthError(message || `Không đăng nhập được ${label} bằng tài khoản akaAgent. Vui lòng đăng nhập lại akaAgent.`)
      }
      if (!response.ok || body?.status !== 1 || !body.data) throw new Error('desktop_web_unavailable')
      if (body.data.status === 'policy_required') {
        throw new DesktopWebAuthError('Tài khoản cần đồng ý điều khoản sử dụng trên Web trước. Vui lòng đăng nhập agent.akabiz.net một lần rồi thử lại.')
      }
      const token = body.data.token
      const me = body.data.me
      if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{16,512}$/.test(token)) throw new Error('desktop_web_token_invalid')
      if (me && (Number(me.id) !== this.staffId || Number(me.organization?.id) !== this.organizationId)) {
        throw new DesktopWebAuthError(`Phiên ${label} không khớp tài khoản akaAgent. Vui lòng đăng nhập lại akaAgent.`)
      }
      await this.browserSession.cookies.set({
        url: `${DESKTOP_WEB_ORIGIN}${CONTROL_PREFIX}`, name: COOKIE_NAME, value: token, path: CONTROL_PREFIX,
        httpOnly: true, secure: DESKTOP_WEB_ORIGIN.startsWith('https:'), sameSite: 'lax',
        expirationDate: Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS
      })
      if (!this.isCurrent() || controller.signal.aborted) { void revokeNativeSession(token); return }
      const previous = this.token
      this.token = token
      if (previous && previous !== token) void revokeNativeSession(previous)
      this.loggedIn = true
      this.publish('ready')
    } catch (error) {
      if (!this.isCurrent() || controller.signal.aborted) return
      this.loggedIn = false
      if (error instanceof DesktopWebAuthError) {
        await this.browserSession.cookies.remove(`${DESKTOP_WEB_ORIGIN}${CONTROL_PREFIX}`, COOKIE_NAME).catch(() => {})
        this.publish('error', error.message)
      } else {
        this.publish('error', `Không thể kết nối ${label}. Vui lòng kiểm tra internet và thử lại.`)
      }
    } finally {
      if (this.requestAbort === controller) this.requestAbort = null
    }
  }

  /** Trang báo phiên hết hạn: đăng nhập lại một lần rồi nạp lại; lần thứ hai thì để khách bấm Thử lại. */
  private recoverExpiredSession(): void {
    if (!this.isCurrent() || this.inflight) return
    if (this.automaticRecoveryUsed) {
      this.publish('error', `Phiên ${this.surface.label} không còn hợp lệ. Vui lòng thử kết nối lại.`)
      return
    }
    this.automaticRecoveryUsed = true
    this.loggedIn = false
    void this.authenticate().then(() => {
      if (this.state.status === 'ready' && this.guest && !this.guest.isDestroyed()) void this.guest.loadURL(this.state.url).catch(() => {})
    })
  }

  private beforeAttach = (event: Electron.Event, preferences: Electron.WebPreferences, params: Record<string, string>): void => {
    if (preferences.partition !== this.state.partition) return
    let allowed = false
    try {
      const url = new URL(params.src)
      allowed = url.origin === DESKTOP_WEB_ORIGIN && this.surface.insidePath(url.pathname) && url.searchParams.get('embed') === 'desktop'
    } catch { allowed = false }
    if (!this.isCurrent() || this.state.status !== 'ready' || !allowed) {
      event.preventDefault()
      return
    }
    delete preferences.preload
    preferences.nodeIntegration = false
    preferences.nodeIntegrationInSubFrames = false
    preferences.contextIsolation = true
    preferences.sandbox = true
    preferences.webSecurity = true
    preferences.webviewTag = false
  }

  private afterAttach = (_event: Electron.Event, contents: WebContents): void => {
    if (contents.session !== this.browserSession) return
    if (!this.isCurrent()) { contents.close(); return }
    if (this.guest && !this.guest.isDestroyed()) this.guest.close()
    this.guest = contents
    this.configureContents(contents)
  }

  private configureContents(contents: WebContents): void {
    const { label } = this.surface
    this.contents.add(contents)
    contents.once('destroyed', () => {
      this.contents.delete(contents)
      if (this.guest === contents) this.guest = null
    })
    const guardNavigation = (event: Electron.Event, href: string): void => {
      let inside = false
      try {
        const url = new URL(href)
        inside = isWebOrigin(href) && this.surface.insidePath(url.pathname)
      } catch { inside = false }
      if (inside && this.isCurrent()) return
      event.preventDefault()
      if (!this.isCurrent()) return
      // Link ra ngoài trang: Desktop mở màn của chính nó (chiến dịch, nhóm data, tài khoản…); còn lại mở trình duyệt.
      this.navigateOut(href)
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebOrigin(url)) {
        const parsed = new URL(url)
        if (this.surface.insidePath(parsed.pathname) && this.guest && !this.guest.isDestroyed()) {
          // Tab mới trong trang: mở ngay trong khung (giữ chế độ nhúng).
          void this.guest.loadURL(this.surface.url(DESKTOP_WEB_ORIGIN, `${parsed.pathname}${parsed.search}`, this.theme)).catch(() => {})
        } else {
          this.navigateOut(url)
        }
      } else {
        openExternal(url)
      }
      return { action: 'deny' }
    })
    // Điều hướng trong trang (router của Web) không qua `will-navigate`. Trang dừng ở đường ngoài trang này (vd. bản Web
    // chưa có trang này tự chuyển sang trang khác): báo lỗi thay vì hiện nhầm trang. Chuyển tạm rồi quay về thì bỏ qua.
    contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (!isMainFrame || contents !== this.guest) return
      if (this.inPageCheck) clearTimeout(this.inPageCheck)
      this.inPageCheck = setTimeout(() => {
        this.inPageCheck = null
        if (contents !== this.guest || contents.isDestroyed() || !this.isCurrent()) return
        let inside = false
        try { inside = this.surface.insidePath(new URL(contents.getURL()).pathname) } catch { inside = false }
        if (!inside) this.publish('error', `Trang ${label} chưa có trên máy chủ. Vui lòng thử lại sau.`)
      }, 500)
    })
    contents.on('page-title-updated', (_event, title) => {
      if (contents === this.guest && title === JOURNEY_WEB_EXPIRED_TITLE) this.recoverExpiredSession()
    })
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (contents === this.guest && this.isCurrent() && isMainFrame && code !== -3) {
        this.publish('error', `Không thể tải trang ${label}. Vui lòng kiểm tra internet và thử lại.`)
      }
    })
    contents.on('render-process-gone', () => {
      if (contents === this.guest && this.isCurrent()) {
        // Không nạp lại webview đã sập (Electron có thể dừng main): báo renderer dựng webview mới.
        this.guest = null
        this.state = { ...this.state, webviewGeneration: this.state.webviewGeneration + 1 }
        contents.close({ waitForBeforeUnload: false })
        this.publish('error', `Trang ${label} đã dừng. Vui lòng tải lại.`)
      }
    })
  }

  private onDownload = (event: Electron.Event): void => {
    event.preventDefault()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.requestAbort?.abort()
    if (this.inPageCheck) clearTimeout(this.inPageCheck)
    this.inPageCheck = null
    this.publish('closed')
    if (!this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.removeListener('will-attach-webview', this.beforeAttach)
      this.mainWindow.webContents.removeListener('did-attach-webview', this.afterAttach)
    }
    for (const contents of this.contents) if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    this.contents.clear()
    this.browserSession.removeListener('will-download', this.onDownload)
    this.browserSession.setPermissionCheckHandler(() => false)
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.browserSession.webRequest.onCompleted(null)
    this.browserSession.webRequest.onBeforeRequest((_, callback) => callback({ cancel: true }))
    await this.inflight
    await this.browserSession.cookies.remove(`${DESKTOP_WEB_ORIGIN}${CONTROL_PREFIX}`, COOKIE_NAME).catch(() => {})
    await this.browserSession.closeAllConnections()
    if (this.token) await revokeNativeSession(this.token)
    this.token = null
  }
}
