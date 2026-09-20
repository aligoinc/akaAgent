import { BrowserWindow, session, shell, type Session, type WebContents } from 'electron'
import type { AdminDocDescriptor } from '../../shared/admin'

/** A single guest, isolated from automation, CRM and akaChat. No remote preload. */
export class AdminDocsWebService {
  private readonly browserSession: Session
  private readonly origin: string
  private readonly contents = new Set<WebContents>()
  private readonly popups = new Set<BrowserWindow>()
  private disposed = false
  private crashed = false
  private guest: WebContents | null = null

  constructor(private readonly window: BrowserWindow, readonly descriptor: AdminDocDescriptor, private readonly allowed: () => boolean) {
    this.origin = new URL(descriptor.url).origin
    this.browserSession = session.fromPartition(descriptor.partition)
    window.webContents.on('will-attach-webview', this.beforeAttach)
    window.webContents.on('did-attach-webview', this.afterAttach)
    this.browserSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: !this.current() }))
    this.browserSession.setPermissionCheckHandler((contents, permission, origin) => this.canWriteClipboard(contents, permission, origin))
    this.browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(this.canWriteClipboard(contents, permission, details.requestingUrl))
    })
    this.browserSession.on('will-download', this.onDownload)
  }

  private current(): boolean { return !this.disposed && !this.crashed && this.allowed() }
  private sameOrigin(value: string): boolean {
    try { const url = new URL(value); return url.origin === this.origin && !url.username && !url.password } catch { return false }
  }
  private canWriteClipboard(contents: WebContents | null, permission: string, origin: string): boolean {
    return this.current() && !!contents && this.contents.has(contents) && !contents.isDestroyed() &&
      permission === 'clipboard-sanitized-write' && this.sameOrigin(origin)
  }
  private external(value: string): void {
    try {
      const url = new URL(value)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) void shell.openExternal(url.href).catch(() => {})
    } catch { /* Invalid links never leave the guest. */ }
  }

  private beforeAttach = (event: Electron.Event, preferences: Electron.WebPreferences, params: Record<string, string>): void => {
    if (preferences.partition !== this.descriptor.partition) return
    if (!this.current() || params.src !== this.descriptor.url || this.guest) { event.preventDefault(); return }
    delete preferences.preload
    Object.assign(preferences, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false })
  }
  private afterAttach = (_event: Electron.Event, contents: WebContents): void => {
    if (contents.session !== this.browserSession) return
    if (!this.current() || this.guest) { contents.close({ waitForBeforeUnload: false }); return }
    this.guest = contents
    this.configure(contents)
  }
  private configure(contents: WebContents): void {
    this.contents.add(contents)
    contents.once('destroyed', () => { this.contents.delete(contents); if (this.guest === contents) this.guest = null })
    contents.on('render-process-gone', () => {
      if (this.guest === contents) this.crashed = true
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    })
    const navigate = (event: Electron.Event, url: string) => {
      if (this.current() && this.sameOrigin(url)) return
      event.preventDefault()
      if (this.current()) this.external(url)
    }
    contents.on('will-navigate', navigate)
    contents.on('will-redirect', navigate)
    contents.setWindowOpenHandler(({ url }) => {
      if (!this.current()) return { action: 'deny' }
      if (!this.sameOrigin(url)) { this.external(url); return { action: 'deny' } }
      return { action: 'allow', overrideBrowserWindowOptions: {
        parent: this.window, width: 1000, height: 750, autoHideMenuBar: true,
        webPreferences: { session: this.browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
          nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, preload: undefined }
      } }
    })
    contents.on('did-create-window', child => {
      this.popups.add(child)
      child.once('closed', () => this.popups.delete(child))
      this.configure(child.webContents)
    })
  }
  private onDownload = (event: Electron.Event): void => { event.preventDefault() }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (!this.window.isDestroyed()) {
      this.window.webContents.removeListener('will-attach-webview', this.beforeAttach)
      this.window.webContents.removeListener('did-attach-webview', this.afterAttach)
    }
    for (const popup of this.popups) if (!popup.isDestroyed()) popup.destroy()
    for (const contents of this.contents) if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    this.contents.clear()
    this.browserSession.removeListener('will-download', this.onDownload)
    this.browserSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }))
    this.browserSession.setPermissionCheckHandler(() => false)
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    await this.browserSession.closeAllConnections()
  }
}
