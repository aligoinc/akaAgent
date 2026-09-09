import { BrowserWindow, powerMonitor, session, shell, type Session, type WebContents } from 'electron'
import { getCurrentUser, requireCurrentUserCredentials } from '../data/currentUser'
import { IPC_EVENTS, type AuthUser, type ChatWebState } from '../../shared/types'

const CHAT_URL = 'https://chat.akabiz.biz/'
const CHAT_ORIGIN = new URL(CHAT_URL).origin
const COOKIE_NAME = 'aka_chat_staff'
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 3_600_000]

function isChatUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === CHAT_ORIGIN && !url.username && !url.password
  } catch { return false }
}

function openExternal(value: string): void {
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      void shell.openExternal(url.href).catch(() => {})
    }
  } catch { /* Invalid links are ignored. */ }
}

class ChatAuthenticationError extends Error {}

/** Created only after an eligible staff member opens Chat. No account runtime registration. */
export class ChatWebService {
  private readonly browserSession: Session
  private readonly sessionId: string
  private readonly staffId: number
  private readonly organizationId: number
  private state: ChatWebState
  private disposed = false
  private initialized = false
  private expiresAt = 0
  private inflight: Promise<void> | null = null
  private requestAbort: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private automaticRecoveryUsed = false
  private reloadAfterAuthentication = false
  private guest: WebContents | null = null
  private readonly contents = new Set<WebContents>()
  private readonly popupWindows = new Set<BrowserWindow>()
  private signOutPending: Promise<void> | null = null

  constructor(private readonly mainWindow: BrowserWindow, user: AuthUser) {
    if (!user.chatWebEnabledAtLogin || !user.chatWebSessionId) throw new Error('Tài khoản chưa được bật Chat.')
    this.sessionId = user.chatWebSessionId
    this.staffId = user.staffId
    this.organizationId = user.organizationId
    const partition = `persist:akaagent_chat_${user.organizationId}_${user.staffId}`
    this.browserSession = session.fromPartition(partition)
    this.state = { sessionId: this.sessionId, revision: 0, status: 'connecting', partition, url: CHAT_URL }
    mainWindow.webContents.on('will-attach-webview', this.beforeAttach)
    mainWindow.webContents.on('did-attach-webview', this.afterAttach)
    powerMonitor.on('resume', this.onResume)

    this.browserSession.setPermissionCheckHandler((contents, permission, origin) => (
      this.isCurrent() && !!contents && this.contents.has(contents) && isChatUrl(origin) &&
      ['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission)
    ))
    this.browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(this.isCurrent() && this.contents.has(contents) && isChatUrl(details.requestingUrl) &&
        ['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
    })
    this.browserSession.on('will-download', this.onDownload)
    this.browserSession.webRequest.onBeforeRequest({ urls: [`${CHAT_ORIGIN}/api/auth/login*`] }, (details, callback) => {
      // Login credentials only originate in main; an embedded login form must not switch staff.
      const isLogin = new URL(details.url).pathname.replace(/\/+$/, '') === '/api/auth/login'
      callback({ cancel: this.disposed || (isLogin && (details.webContentsId ?? -1) > 0) })
    })
    this.browserSession.webRequest.onHeadersReceived({ urls: [`${CHAT_ORIGIN}/api/*`] }, (details, callback) => {
      // ChatWeb navigates as soon as fetch resolves its headers. A slow response body
      // can be cancelled by that navigation, so onCompleted would miss 401/logout.
      callback({})
      if (!this.isCurrent() || !details.webContentsId || details.webContentsId <= 0 || !this.contentsHasId(details.webContentsId)) return
      const path = new URL(details.url).pathname
      const protectedRequest = path.startsWith('/api/chat/') || path.startsWith('/api/settings/') || path === '/api/auth/session'
      if (path === '/api/auth/logout' && details.statusCode >= 200 && details.statusCode < 300) {
        this.signOutPending = this.signOut().catch(() => {})
      } else if (details.statusCode === 401 && protectedRequest) {
        this.recoverExpiredSession()
      } else if (protectedRequest && details.statusCode >= 200 && details.statusCode < 300 &&
        !this.inflight && this.state.status === 'ready') {
        this.automaticRecoveryUsed = false
      }
    })
  }

  private isCurrent(): boolean {
    const user = getCurrentUser()
    return !this.disposed && !!user && user.chatWebEnabledAtLogin === true &&
      user.chatWebSessionId === this.sessionId && user.staffId === this.staffId &&
      user.organizationId === this.organizationId
  }

  private contentsHasId(id: number): boolean {
    return [...this.contents].some(contents => contents.id === id)
  }

  private publish(status: ChatWebState['status'], message?: string): void {
    this.state = { ...this.state, revision: this.state.revision + 1, status, message }
    if (!this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_EVENTS.CHAT_WEB_STATE, this.state)
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(delay: number): void {
    this.clearTimer()
    if (!this.isCurrent() || this.state.status === 'signed-out') return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.authenticate()
    }, Math.max(1_000, Math.min(delay, 2_147_483_647)))
  }

  private onResume = (): void => {
    if (this.isCurrent() && this.state.status !== 'signed-out' &&
      this.expiresAt > 0 && this.expiresAt - Date.now() < RENEW_BEFORE_MS) {
      void this.authenticate()
    }
  }

  async prepare(): Promise<ChatWebState> {
    if (!this.isCurrent()) throw new Error('Phiên akaAgent đã kết thúc.')
    if (!this.initialized || this.state.status === 'connecting' ||
      (this.state.status === 'ready' && this.expiresAt - Date.now() < RENEW_BEFORE_MS)) {
      await this.authenticate()
    }
    return this.state
  }

  async reload(): Promise<ChatWebState> {
    await this.signOutPending
    if (!this.isCurrent()) throw new Error('Phiên akaAgent đã kết thúc.')
    this.automaticRecoveryUsed = false
    this.retryCount = 0
    this.reloadAfterAuthentication = true
    await this.authenticate()
    return this.state
  }

  credentialsChanged(): void {
    if (this.isCurrent() && this.state.status !== 'signed-out') {
      // Await the old request before retrying so an old password response cannot win.
      this.requestAbort?.abort()
      void (this.inflight ?? Promise.resolve()).then(() => {
        if (this.isCurrent() && this.state.status !== 'signed-out') void this.authenticate()
      })
    }
  }

  private authenticate(): Promise<void> {
    if (this.inflight) return this.inflight
    if (!this.isCurrent()) return Promise.resolve()
    const operation = this.performAuthentication().finally(() => {
      if (this.inflight === operation) this.inflight = null
    })
    this.inflight = operation
    return operation
  }

  private async performAuthentication(): Promise<void> {
    this.clearTimer()
    const controller = new AbortController()
    this.requestAbort = controller
    const hadValidSession = this.state.status === 'ready' && this.expiresAt > Date.now()
    if (!hadValidSession) this.publish('connecting', 'Đang kết nối Chat…')
    try {
      if (!this.initialized) {
        await this.browserSession.cookies.remove(CHAT_URL, COOKIE_NAME)
        this.initialized = true
      }
      if (!this.isCurrent() || controller.signal.aborted) return
      const credentials = requireCurrentUserCredentials()
      const response = await this.browserSession.fetch(`${CHAT_ORIGIN}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: credentials.username, password: credentials.password }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
      })
      if (!this.isCurrent() || controller.signal.aborted) return
      if (response.status === 401 || response.status === 403) {
        throw new ChatAuthenticationError('Không thể xác thực Chat bằng tài khoản akaAgent. Vui lòng kiểm tra quyền Chat hoặc đăng nhập lại akaAgent.')
      }
      if (!response.ok) throw new Error('chat_unavailable')
      const data = await response.json() as { staffId?: string; organizationId?: string; expiresAt?: number }
      if (!this.isCurrent() || controller.signal.aborted) return
      if (String(data.staffId) !== String(this.staffId) || String(data.organizationId) !== String(this.organizationId)) {
        throw new ChatAuthenticationError('Phiên Chat không khớp tài khoản akaAgent. Vui lòng đăng nhập lại akaAgent.')
      }
      const expiry = Number(data.expiresAt) * 1000
      if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('invalid_chat_expiry')
      const cookies = await this.browserSession.cookies.get({ url: CHAT_URL, name: COOKIE_NAME })
      if (!this.isCurrent() || controller.signal.aborted) return
      if (!cookies.some(cookie => cookie.httpOnly && cookie.secure && cookie.value)) throw new Error('chat_cookie_missing')
      this.expiresAt = expiry
      this.retryCount = 0
      this.publish('ready')
      this.schedule(expiry - Date.now() - RENEW_BEFORE_MS)
      if (this.reloadAfterAuthentication && this.guest && !this.guest.isDestroyed()) {
        this.reloadAfterAuthentication = false
        void this.guest.loadURL(CHAT_URL).catch(() => {})
      }
    } catch (error) {
      if (!this.isCurrent() || controller.signal.aborted) return
      if (error instanceof ChatAuthenticationError) {
        this.expiresAt = 0
        await this.browserSession.cookies.remove(CHAT_URL, COOKIE_NAME)
        if (this.isCurrent()) this.publish('error', error.message)
      } else {
        if (!hadValidSession || this.expiresAt <= Date.now()) {
          this.publish('error', 'Không thể kết nối Chat. Vui lòng kiểm tra internet và thử lại.')
        }
        this.schedule(RETRY_DELAYS_MS[Math.min(this.retryCount++, RETRY_DELAYS_MS.length - 1)])
      }
    } finally {
      if (this.requestAbort === controller) this.requestAbort = null
    }
  }

  private recoverExpiredSession(): void {
    if (this.state.status === 'signed-out' || this.state.status === 'error') return
    this.expiresAt = 0
    this.reloadAfterAuthentication = true
    if (this.inflight) return
    if (this.automaticRecoveryUsed) {
      this.clearTimer()
      this.publish('error', 'Phiên Chat không còn hợp lệ. Vui lòng thử kết nối lại.')
      return
    }
    this.automaticRecoveryUsed = true
    void this.authenticate()
  }

  private async signOut(): Promise<void> {
    this.clearTimer()
    this.requestAbort?.abort()
    this.expiresAt = 0
    this.reloadAfterAuthentication = true
    this.publish('signed-out', 'Bạn đã đăng xuất Chat. Kết nối lại bằng tài khoản akaAgent đang sử dụng.')
    await this.inflight
    if (this.isCurrent()) await this.browserSession.cookies.remove(CHAT_URL, COOKIE_NAME)
  }

  private beforeAttach = (event: Electron.Event, preferences: Electron.WebPreferences, params: Record<string, string>): void => {
    if (preferences.partition !== this.state.partition) return
    if (!this.isCurrent() || this.state.status !== 'ready' || params.src !== CHAT_URL) {
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
    preferences.backgroundThrottling = false
  }

  private afterAttach = (_event: Electron.Event, contents: WebContents): void => {
    if (contents.session !== this.browserSession) return
    if (!this.isCurrent()) { contents.close(); return }
    if (this.guest && !this.guest.isDestroyed()) this.guest.close()
    this.guest = contents
    this.reloadAfterAuthentication = false
    this.configureContents(contents)
  }

  private configureContents(contents: WebContents): void {
    this.contents.add(contents)
    contents.setBackgroundThrottling(false)
    contents.once('destroyed', () => {
      this.contents.delete(contents)
      if (this.guest === contents) this.guest = null
    })
    const guardNavigation = (event: Electron.Event, url: string): void => {
      if (this.isCurrent() && isChatUrl(url)) {
        const target = new URL(url)
        if (target.pathname === '/' && target.searchParams.get('reason') === 'session-expired') {
          // Main owns 401 recovery. Do not let ChatWeb's redirect race the renewed
          // cookie or cancel the authenticated load started by performAuthentication.
          event.preventDefault()
        }
        return
      }
      event.preventDefault()
      if (this.isCurrent()) openExternal(url)
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
    contents.setWindowOpenHandler(({ url }) => {
      if (!this.isCurrent() || this.state.status !== 'ready') return { action: 'deny' }
      if (!isChatUrl(url)) { openExternal(url); return { action: 'deny' } }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: this.mainWindow, width: 1100, height: 800, autoHideMenuBar: true,
          webPreferences: {
            session: this.browserSession, sandbox: true, contextIsolation: true,
            nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false,
            webSecurity: true, backgroundThrottling: false, preload: undefined
          }
        }
      }
    })
    contents.on('did-create-window', child => {
      this.popupWindows.add(child)
      child.once('closed', () => this.popupWindows.delete(child))
      this.configureContents(child.webContents)
    })
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (contents === this.guest && this.isCurrent() && isMainFrame && code !== -3) {
        this.reloadAfterAuthentication = true
        this.publish('error', 'Không thể tải trang Chat. Vui lòng thử lại.')
      }
    })
    contents.on('render-process-gone', () => {
      if (contents === this.guest && this.isCurrent()) {
        this.reloadAfterAuthentication = true
        this.publish('error', 'Trang Chat đã dừng. Vui lòng tải lại.')
      }
    })
  }

  private onDownload = (event: Electron.Event, item: Electron.DownloadItem, contents: WebContents): void => {
    if (!this.isCurrent() || !contents || !this.contents.has(contents)) { event.preventDefault(); return }
    item.setSaveDialogOptions({ title: 'Lưu tệp từ Chat' })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.clearTimer()
    this.requestAbort?.abort()
    this.publish('closed')
    powerMonitor.removeListener('resume', this.onResume)
    if (!this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.removeListener('will-attach-webview', this.beforeAttach)
      this.mainWindow.webContents.removeListener('did-attach-webview', this.afterAttach)
    }
    for (const popup of this.popupWindows) if (!popup.isDestroyed()) popup.destroy()
    for (const contents of this.contents) if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    this.contents.clear()
    this.browserSession.removeListener('will-download', this.onDownload)
    // Keep deny handlers on this partition until the next authenticated service replaces them.
    this.browserSession.setPermissionCheckHandler(() => false)
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.browserSession.webRequest.onHeadersReceived(null)
    this.browserSession.webRequest.onBeforeRequest((_, callback) => callback({ cancel: true }))
    await this.inflight
    await this.browserSession.cookies.remove(CHAT_URL, COOKIE_NAME)
    await this.browserSession.closeAllConnections()
  }
}
