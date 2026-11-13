import { session, shell, type BrowserWindow, type Session, type WebContents } from 'electron'
import { IPC_EVENTS, type RenewalWebDescriptor, type RenewalWebState } from '../../shared/types'
import {
  RENEWAL_ORDER_COMPLETED_TITLE,
  RENEWAL_PORTAL_ORIGIN,
  RENEWAL_WEB_INITIAL_URL,
  RENEWAL_WEB_PARTITION,
  isRenewalPortalUrl
} from '../../shared/renewalPortal'

export interface RenewalWebLink { url: string; signed: boolean }

interface RenewalWebDependencies {
  /** Link ký số (màn Gia hạn trước đăng nhập) hoặc link có vé (nhắc gia hạn), hoặc trang đăng nhập cổng, do main tạo. */
  createLink: () => Promise<RenewalWebLink>
  isAllowed: () => boolean
  /** Kênh gửi trạng thái webview; mặc định là kênh của màn Gia hạn trước đăng nhập. */
  stateChannel?: string
  /** Trang CRM vừa báo đơn đã kích hoạt (gọi một lần). */
  onOrderCompleted?: () => void
}

function isPortalOrigin(value: string): boolean {
  try { return new URL(value).origin === RENEWAL_PORTAL_ORIGIN } catch { return false }
}

function openExternal(value: string): void {
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      void shell.openExternal(url.href).catch(() => {})
    }
  } catch { /* Ignore invalid links. */ }
}

/**
 * Trình duyệt nhúng của cổng gia hạn: màn Gia hạn trước đăng nhập và cửa sổ "Gia hạn gói" khi đang đăng nhập
 * (nhắc gia hạn; `isAllowed` gắn với phiên đăng nhập thay vì lượt gia hạn). Chỉ mở cổng CRM /gia-han,
 * phân vùng không lưu đĩa và bị xoá khi đóng màn; link ký số đi thẳng từ main
 * vào guest, không qua renderer.
 */
export class RenewalWebService {
  readonly descriptor: RenewalWebDescriptor = { partition: RENEWAL_WEB_PARTITION, url: RENEWAL_WEB_INITIAL_URL }
  private readonly browserSession: Session
  private guest: WebContents | null = null
  private disposed = false
  private loadGeneration = 0
  private state: RenewalWebState = { revision: 0, status: 'loading', signed: false, orderCompleted: false }

  constructor(private readonly mainWindow: BrowserWindow, private readonly deps: RenewalWebDependencies) {
    this.browserSession = session.fromPartition(RENEWAL_WEB_PARTITION)
    mainWindow.webContents.on('will-attach-webview', this.beforeAttach)
    mainWindow.webContents.on('did-attach-webview', this.afterAttach)
    this.browserSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: !this.isCurrent() }))
    // Nút "sao chép số tài khoản / nội dung chuyển khoản" của cổng cần quyền ghi clipboard.
    this.browserSession.setPermissionCheckHandler((contents, permission, origin) => (
      this.isCurrent() && !!contents && contents === this.guest && isPortalOrigin(origin) &&
      permission === 'clipboard-sanitized-write'
    ))
    this.browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(this.isCurrent() && contents === this.guest && isPortalOrigin(details.requestingUrl) &&
        permission === 'clipboard-sanitized-write')
    })
    this.browserSession.on('will-download', this.onDownload)
  }

  private isCurrent(): boolean {
    return !this.disposed && this.deps.isAllowed()
  }

  private publish(update: Partial<Omit<RenewalWebState, 'revision'>>): void {
    this.state = { ...this.state, ...update, revision: this.state.revision + 1 }
    if (!this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.send(this.deps.stateChannel ?? IPC_EVENTS.AUTH_RENEWAL_WEB_STATE, this.state)
    }
  }

  private beforeAttach = (event: Electron.Event, preferences: Electron.WebPreferences, params: Record<string, string>): void => {
    if (preferences.partition !== this.descriptor.partition) return
    if (!this.isCurrent() || params.src !== RENEWAL_WEB_INITIAL_URL) { event.preventDefault(); return }
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
    if (!this.isCurrent()) { contents.close({ waitForBeforeUnload: false }); return }
    if (this.guest && this.guest !== contents && !this.guest.isDestroyed()) this.guest.close({ waitForBeforeUnload: false })
    this.guest = contents
    this.configureContents(contents)
    void this.loadPortal()
  }

  private configureContents(contents: WebContents): void {
    contents.once('destroyed', () => { if (this.guest === contents) this.guest = null })
    const guardNavigation = (event: Electron.Event, url: string): void => {
      if (this.isCurrent() && (url === RENEWAL_WEB_INITIAL_URL || isRenewalPortalUrl(url))) return
      event.preventDefault()
      if (this.isCurrent()) openExternal(url)
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
    // Website, Zalo hỗ trợ… mở trình duyệt ngoài; không mở cửa sổ con trong app.
    contents.setWindowOpenHandler(({ url }) => {
      if (this.isCurrent()) openExternal(url)
      return { action: 'deny' }
    })
    contents.on('page-title-updated', (_event, title) => {
      if (contents === this.guest && this.isCurrent() && title.trim() === RENEWAL_ORDER_COMPLETED_TITLE && !this.state.orderCompleted) {
        this.publish({ orderCompleted: true })
        try { this.deps.onOrderCompleted?.() } catch { /* Bên gọi tự xử lý lỗi. */ }
      }
    })
  }

  /** Mỗi lần mở/tải lại tạo link mới (hạn 10 phút); trang CRM tự xoá `?t=`. */
  private async loadPortal(): Promise<void> {
    const guest = this.guest
    if (!guest || guest.isDestroyed() || !this.isCurrent()) return
    const generation = ++this.loadGeneration
    this.publish({ status: 'loading', message: undefined })
    let link: RenewalWebLink
    try {
      link = await this.deps.createLink()
    } catch (error) {
      if (generation === this.loadGeneration && this.isCurrent()) {
        this.publish({ status: 'error', message: error instanceof Error ? error.message : 'Không thể mở trang gia hạn.' })
      }
      return
    }
    if (generation !== this.loadGeneration || guest !== this.guest || guest.isDestroyed() || !this.isCurrent()) return
    if (!isRenewalPortalUrl(link.url)) {
      this.publish({ status: 'error', message: 'Không thể mở trang gia hạn.' })
      return
    }
    this.publish({ signed: link.signed })
    try {
      await guest.loadURL(link.url)
      if (generation === this.loadGeneration && this.isCurrent()) this.publish({ status: 'ready' })
    } catch {
      // Lỗi tải được renderer hiển thị qua sự kiện did-fail-load của webview.
      if (generation === this.loadGeneration && this.isCurrent()) {
        this.publish({ status: 'error', message: 'Không tải được trang gia hạn. Vui lòng kiểm tra internet và thử lại.' })
      }
    }
  }

  reload(): void {
    if (!this.isCurrent()) throw new Error('Phiên gia hạn đã kết thúc. Vui lòng đăng nhập lại.')
    if (!this.guest || this.guest.isDestroyed()) return
    void this.loadPortal()
  }

  snapshot(): RenewalWebState {
    return this.state
  }

  private onDownload = (event: Electron.Event): void => {
    event.preventDefault()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.loadGeneration++
    if (!this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.removeListener('will-attach-webview', this.beforeAttach)
      this.mainWindow.webContents.removeListener('did-attach-webview', this.afterAttach)
    }
    if (this.guest && !this.guest.isDestroyed()) this.guest.close({ waitForBeforeUnload: false })
    this.guest = null
    this.browserSession.removeListener('will-download', this.onDownload)
    this.browserSession.setPermissionCheckHandler(() => false)
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.browserSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }))
    // Phiên cổng gia hạn (sessionStorage/cookie) không được giữ sang lần sau.
    await this.browserSession.clearStorageData()
    await this.browserSession.clearCache()
    await this.browserSession.closeAllConnections()
  }
}
