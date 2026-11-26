import { BrowserWindow, session, shell, type Session, type WebContents } from 'electron'
import { getCurrentUser, requireCurrentUserCredentials } from '../data/currentUser'
import {
  JOURNEY_WEB_EXPIRED_TITLE, JOURNEY_WEB_IPC, JOURNEY_WEB_VIEWS, classifyJourneyWebOutside, journeyWebInsidePath, journeyWebUrl,
  journeyWebViewOfPath, type JourneyWebState, type JourneyWebTheme, type JourneyWebView
} from '../../shared/journeyWebDesktop'

/**
 * Dịch vụ nhúng trang Web (`?embed=desktop`) dùng chung một phiên: thẻ Tự động hóa › Quy trình (`automation`, đường `/automation`)
 * và mục menu Bot sự kiện (`eventBot`, đường `/automation/event-bot`). Mỗi trang nhúng một webview, một trạng thái, một đường mặc
 * định và tiêu đề trong câu báo (JOURNEY_WEB_VIEWS); đăng nhập, cookie, phân vùng dùng chung. Trang `automation` giữ nguyên hành vi cũ.
 *
 * Đăng nhập: main gọi đăng nhập native của API Web bằng tài khoản akaAgent đang dùng (như trang Chat), rồi đặt cookie phiên
 * `aka_agent_control_session` vào phân vùng riêng của webview. Phiên native không tính vào hạn 3 thiết bị Web, không đẩy phiên
 * trình duyệt của khách. Trang nhúng đọc `/me` bằng cookie đó (không qua web-entry). Mật khẩu và token không tới renderer.
 *
 * Chỉ tạo khi khách mở thẻ lần đầu; không hẹn giờ, không polling. Phiên hết hạn: trang đổi tiêu đề thành
 * `JOURNEY_WEB_EXPIRED_TITLE`, main đăng nhập lại một lần rồi nạp lại.
 */
export const JOURNEY_WEB_ORIGIN = (() => {
  try { return new URL(process.env.AKA_AGENT_WEB_APP_URL || 'https://agent.akabiz.net').origin } catch { return 'https://agent.akabiz.net' }
})()
const CONTROL_PREFIX = '/api/aka-agent/control/v1'
const COOKIE_NAME = 'aka_agent_control_session'
/** Phiên native sống 30 ngày ở API; cookie đặt ngắn hơn để lần mở sau đăng nhập lại. */
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60

/** Câu lỗi đăng nhập có chỗ cho tiêu đề trang nhúng (`{title}`). */
class JourneyWebAuthError extends Error {}

interface EmbedView {
  key: JourneyWebView
  title: string
  defaultPath: string
  state: JourneyWebState
  guest: WebContents | null
}

interface NativeLoginBody {
  status?: number
  message?: string
  data?: { status?: string; token?: string; me?: { id?: number; organization?: { id?: number } } }
}

function isJourneyOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === JOURNEY_WEB_ORIGIN && !url.username && !url.password
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
    await fetch(`${JOURNEY_WEB_ORIGIN}${CONTROL_PREFIX}/auth/logout`, {
      method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000)
    })
  } catch { /* Bỏ qua. */ }
}

export class JourneyWebService {
  private readonly browserSession: Session
  private readonly staffId: number
  private readonly organizationId: number
  private readonly partition: string
  private readonly views = new Map<JourneyWebView, EmbedView>()
  /** Trang nhúng của các webview đang gắn (will-attach → did-attach, theo thứ tự). */
  private readonly pendingAttach: JourneyWebView[] = []
  private disposed = false
  private loggedIn = false
  private inflight: Promise<void> | null = null
  private requestAbort: AbortController | null = null
  private readonly contents = new Set<WebContents>()
  private theme: JourneyWebTheme = 'light'
  private automaticRecoveryUsed = false
  /** Token phiên native đang đặt trong cookie; chỉ giữ trong RAM của main để thu hồi khi thay / đăng xuất. */
  private token: string | null = null

  constructor(private readonly mainWindow: BrowserWindow, staffId: number, organizationId: number) {
    this.staffId = staffId
    this.organizationId = organizationId
    const partition = `persist:akaagent_web_${organizationId}_${staffId}`
    this.partition = partition
    this.browserSession = session.fromPartition(partition)
    this.viewOf('automation', 'light')
    mainWindow.webContents.on('will-attach-webview', this.beforeAttach)
    mainWindow.webContents.on('did-attach-webview', this.afterAttach)
    this.browserSession.setPermissionCheckHandler((contents, permission, origin) =>
      this.isCurrent() && !!contents && this.contents.has(contents) && isJourneyOrigin(origin) && ['clipboard-sanitized-write', 'fullscreen'].includes(permission))
    this.browserSession.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(this.isCurrent() && this.contents.has(contents) && isJourneyOrigin(details.requestingUrl) && ['clipboard-sanitized-write', 'fullscreen'].includes(permission)))
    // Trang nhúng không tải tệp về máy (xuất Excel… làm ở Web).
    this.browserSession.on('will-download', this.onDownload)
    this.browserSession.webRequest.onBeforeRequest({ urls: [`${JOURNEY_WEB_ORIGIN}${CONTROL_PREFIX}/auth/*`] }, (details, callback) => {
      // Đăng nhập / đăng xuất / đổi tài khoản chỉ do main làm: form đăng nhập trong trang không được đổi nhân viên.
      const path = new URL(details.url).pathname
      const fromPage = (details.webContentsId ?? -1) > 0
      callback({ cancel: this.disposed || (fromPage && (path.endsWith('/login') || path.includes('/logout') || path.includes('/web-entry'))) })
    })
    this.browserSession.webRequest.onCompleted({ urls: [`${JOURNEY_WEB_ORIGIN}${CONTROL_PREFIX}/me*`] }, details => {
      // Trang đọc được phiên bằng cookie hiện tại: cho phép tự đăng nhập lại ở lần hết hạn sau (một lần mỗi phiên tốt).
      if (details.statusCode >= 200 && details.statusCode < 300 && (details.webContentsId ?? -1) > 0) this.automaticRecoveryUsed = false
    })
  }

  private isCurrent(): boolean {
    const user = getCurrentUser()
    return !this.disposed && !!user && user.staffId === this.staffId && user.organizationId === this.organizationId
  }

  /** Trang nhúng `key` (tạo ở lần mở đầu, theo giao diện lúc đó). */
  private viewOf(key: JourneyWebView, theme: JourneyWebTheme): EmbedView {
    let view = this.views.get(key)
    if (!view) {
      const def = JOURNEY_WEB_VIEWS[key]
      view = {
        key, title: def.title, defaultPath: def.defaultPath, guest: null,
        state: { revision: 0, webviewGeneration: 0, status: 'connecting', partition: this.partition, url: journeyWebUrl(JOURNEY_WEB_ORIGIN, def.defaultPath, theme, def.defaultPath), view: key }
      }
      this.views.set(key, view)
    }
    return view
  }

  private publish(view: EmbedView, status: JourneyWebState['status'], message?: string, url?: string): void {
    view.state = { ...view.state, revision: view.state.revision + 1, status, message, ...(url ? { url } : {}) }
    if (!this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.send(JOURNEY_WEB_IPC.state, view.state)
    }
  }

  /** Trạng thái phiên đổi (đang kết nối / sẵn sàng / lỗi): báo mọi trang nhúng đã mở. `message` nhận tiêu đề của từng trang. */
  private publishAll(status: JourneyWebState['status'], message?: (title: string) => string): void {
    for (const view of this.views.values()) this.publish(view, status, message?.(view.title))
  }

  private viewByContents(contents: WebContents): EmbedView | null {
    for (const view of this.views.values()) if (view.guest === contents) return view
    return null
  }

  /** Mở trang: đăng nhập nếu chưa có phiên; `path` là đường trong `/automation` cần mở (ví dụ một quy trình). */
  async prepare(theme: JourneyWebTheme, path?: string | null, key: JourneyWebView = 'automation'): Promise<JourneyWebState> {
    if (!this.isCurrent()) throw new Error('Phiên akaAgent đã kết thúc.')
    this.theme = theme
    const view = this.viewOf(key, theme)
    const url = journeyWebUrl(JOURNEY_WEB_ORIGIN, path, theme, view.defaultPath)
    // Trang nhúng mới mở khi phiên đã có (trang kia đã đăng nhập): dùng chung phiên, không đăng nhập lại.
    if (this.loggedIn && view.state.status === 'connecting' && !this.inflight) this.publish(view, 'ready')
    if (!this.loggedIn || view.state.status !== 'ready') await this.authenticate()
    if (view.state.status === 'ready' && url !== view.state.url) {
      this.publish(view, 'ready', undefined, url)
      if (path && view.guest && !view.guest.isDestroyed()) void view.guest.loadURL(url).catch(() => {})
    }
    return view.state
  }

  async reload(key: JourneyWebView = 'automation'): Promise<JourneyWebState> {
    if (!this.isCurrent()) throw new Error('Phiên akaAgent đã kết thúc.')
    const view = this.viewOf(key, this.theme)
    this.automaticRecoveryUsed = false
    this.loggedIn = false
    await this.authenticate()
    if (view.state.status === 'ready' && view.guest && !view.guest.isDestroyed()) void view.guest.loadURL(view.state.url).catch(() => {})
    return view.state
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
    const controller = new AbortController()
    this.requestAbort = controller
    for (const view of this.views.values()) if (view.state.status !== 'ready') this.publish(view, 'connecting', `Đang kết nối ${view.title}…`)
    try {
      const credentials = requireCurrentUserCredentials()
      // Đăng nhập bằng fetch của main (không qua phân vùng): token chỉ đi vào cookie httpOnly của phân vùng webview.
      const response = await fetch(`${JOURNEY_WEB_ORIGIN}${CONTROL_PREFIX}/auth/native/login`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-aka-desktop-accounts': '1', 'x-aka-facebook-campaigns': '1', 'user-agent': 'akaAgent-Desktop/automation' },
        body: JSON.stringify({ username: credentials.username, password: credentials.password }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])
      })
      if (!this.isCurrent() || controller.signal.aborted) return
      // Khuôn trả lời của API Web: { status: 1, errorCode: 0, message, data } / lỗi { status: -1, errorCode: <HTTP>, message }.
      const body = await response.json().catch(() => null) as NativeLoginBody | null
      if (response.status === 401 || response.status === 403) {
        const message = typeof body?.message === 'string' && body.message.length <= 300 ? body.message : ''
        throw new JourneyWebAuthError(message || 'Không đăng nhập được {title} bằng tài khoản akaAgent. Vui lòng đăng nhập lại akaAgent.')
      }
      if (!response.ok || body?.status !== 1 || !body.data) throw new Error('journey_web_unavailable')
      if (body.data.status === 'policy_required') {
        throw new JourneyWebAuthError('Tài khoản cần đồng ý điều khoản sử dụng trên Web trước. Vui lòng đăng nhập agent.akabiz.net một lần rồi thử lại.')
      }
      const token = body.data.token
      const me = body.data.me
      if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{16,512}$/.test(token)) throw new Error('journey_web_token_invalid')
      if (me && (Number(me.id) !== this.staffId || Number(me.organization?.id) !== this.organizationId)) {
        throw new JourneyWebAuthError('Phiên {title} không khớp tài khoản akaAgent. Vui lòng đăng nhập lại akaAgent.')
      }
      await this.browserSession.cookies.set({
        url: `${JOURNEY_WEB_ORIGIN}${CONTROL_PREFIX}`, name: COOKIE_NAME, value: token, path: CONTROL_PREFIX,
        httpOnly: true, secure: JOURNEY_WEB_ORIGIN.startsWith('https:'), sameSite: 'lax',
        expirationDate: Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS
      })
      if (!this.isCurrent() || controller.signal.aborted) { void revokeNativeSession(token); return }
      const previous = this.token
      this.token = token
      if (previous && previous !== token) void revokeNativeSession(previous)
      this.loggedIn = true
      this.publishAll('ready')
    } catch (error) {
      if (!this.isCurrent() || controller.signal.aborted) return
      this.loggedIn = false
      if (error instanceof JourneyWebAuthError) {
        await this.browserSession.cookies.remove(`${JOURNEY_WEB_ORIGIN}${CONTROL_PREFIX}`, COOKIE_NAME).catch(() => {})
        const template = error.message
        this.publishAll('error', title => template.split('{title}').join(title))
      } else {
        this.publishAll('error', title => `Không thể kết nối ${title}. Vui lòng kiểm tra internet và thử lại.`)
      }
    } finally {
      if (this.requestAbort === controller) this.requestAbort = null
    }
  }

  /** Trang báo phiên hết hạn: đăng nhập lại một lần rồi nạp lại; lần thứ hai thì để khách bấm Thử lại. */
  private recoverExpiredSession(): void {
    if (!this.isCurrent() || this.inflight) return
    if (this.automaticRecoveryUsed) {
      this.publishAll('error', title => `Phiên ${title} không còn hợp lệ. Vui lòng thử kết nối lại.`)
      return
    }
    this.automaticRecoveryUsed = true
    this.loggedIn = false
    void this.authenticate().then(() => {
      for (const view of this.views.values()) {
        if (view.state.status === 'ready' && view.guest && !view.guest.isDestroyed()) void view.guest.loadURL(view.state.url).catch(() => {})
      }
    })
  }

  private beforeAttach = (event: Electron.Event, preferences: Electron.WebPreferences, params: Record<string, string>): void => {
    if (preferences.partition !== this.partition) return
    let allowed = false
    let key: JourneyWebView = 'automation'
    try {
      const url = new URL(params.src)
      allowed = url.origin === JOURNEY_WEB_ORIGIN && journeyWebInsidePath(url.pathname) && url.searchParams.get('embed') === 'desktop'
      key = journeyWebViewOfPath(url.pathname)
    } catch { allowed = false }
    const view = this.views.get(key)
    if (!this.isCurrent() || !view || view.state.status !== 'ready' || !allowed) {
      event.preventDefault()
      return
    }
    this.pendingAttach.push(key)
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
    const key = this.pendingAttach.shift() ?? 'automation'
    if (!this.isCurrent()) { contents.close(); return }
    const view = this.views.get(key)
    if (!view) { contents.close(); return }
    if (view.guest && !view.guest.isDestroyed()) view.guest.close()
    view.guest = contents
    this.configureContents(contents)
  }

  private configureContents(contents: WebContents): void {
    this.contents.add(contents)
    contents.once('destroyed', () => {
      this.contents.delete(contents)
      const view = this.viewByContents(contents)
      if (view) view.guest = null
    })
    const guardNavigation = (event: Electron.Event, href: string): void => {
      let inside = false
      try {
        const url = new URL(href)
        inside = isJourneyOrigin(href) && journeyWebInsidePath(url.pathname)
      } catch { inside = false }
      if (inside && this.isCurrent()) return
      event.preventDefault()
      if (!this.isCurrent()) return
      // Link ra ngoài Tự động hóa: Desktop mở màn của chính nó (chiến dịch, nhóm data, tài khoản); còn lại mở trình duyệt.
      const target = classifyJourneyWebOutside(href, JOURNEY_WEB_ORIGIN)
      if (target.kind === 'external') { openExternal(target.url); return }
      if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(JOURNEY_WEB_IPC.navigateOut, target)
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
    contents.setWindowOpenHandler(({ url }) => {
      if (isJourneyOrigin(url)) {
        const parsed = new URL(url)
        const view = this.viewByContents(contents)
        if (journeyWebInsidePath(parsed.pathname) && view?.guest && !view.guest.isDestroyed()) {
          // Tab mới trong Tự động hóa: mở ngay trong khung (giữ chế độ nhúng).
          void view.guest.loadURL(journeyWebUrl(JOURNEY_WEB_ORIGIN, `${parsed.pathname}${parsed.search}`, this.theme, view.defaultPath)).catch(() => {})
        } else {
          const target = classifyJourneyWebOutside(url, JOURNEY_WEB_ORIGIN)
          if (target.kind === 'external') openExternal(target.url)
          else if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(JOURNEY_WEB_IPC.navigateOut, target)
        }
      } else {
        openExternal(url)
      }
      return { action: 'deny' }
    })
    contents.on('page-title-updated', (_event, title) => {
      if (this.viewByContents(contents) && title === JOURNEY_WEB_EXPIRED_TITLE) this.recoverExpiredSession()
    })
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      const view = this.viewByContents(contents)
      if (view && this.isCurrent() && isMainFrame && code !== -3) {
        this.publish(view, 'error', `Không thể tải trang ${view.title}. Vui lòng kiểm tra internet và thử lại.`)
      }
    })
    contents.on('render-process-gone', () => {
      const view = this.viewByContents(contents)
      if (view && this.isCurrent()) {
        // Không nạp lại webview đã sập (Electron có thể dừng main): báo renderer dựng webview mới.
        view.guest = null
        view.state = { ...view.state, webviewGeneration: view.state.webviewGeneration + 1 }
        contents.close({ waitForBeforeUnload: false })
        this.publish(view, 'error', `Trang ${view.title} đã dừng. Vui lòng tải lại.`)
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
    this.publishAll('closed')
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
    await this.browserSession.cookies.remove(`${JOURNEY_WEB_ORIGIN}${CONTROL_PREFIX}`, COOKIE_NAME).catch(() => {})
    await this.browserSession.closeAllConnections()
    if (this.token) await revokeNativeSession(this.token)
    this.token = null
  }
}
