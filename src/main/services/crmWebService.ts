import { BrowserWindow, session, shell, type Session, type WebContents } from 'electron'
import type { CrmWebDescriptor } from '../../shared/types'

const CRM_URL = 'https://aka10000.fly.dev/'
const CRM_ORIGIN = new URL(CRM_URL).origin

function isCrmUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === CRM_ORIGIN && !url.username && !url.password
  } catch { return false }
}

function openExternal(value: string): void {
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      void shell.openExternal(url.href).catch(() => {})
    }
  } catch { /* Ignore invalid links. */ }
}

/** A staff-isolated browser. CRM owns login, cookies and session expiry. */
export class CrmWebService {
  readonly descriptor: CrmWebDescriptor
  private readonly browserSession: Session
  private readonly contents = new Set<WebContents>()
  private readonly popups = new Set<BrowserWindow>()
  private guest: WebContents | null = null
  private disposed = false

  constructor(private readonly mainWindow: BrowserWindow, staffId: number, private readonly isAllowed: () => boolean) {
    this.descriptor = { url: CRM_URL, partition: `persist:akaagent_crm_1_${staffId}` }
    this.browserSession = session.fromPartition(this.descriptor.partition)
    mainWindow.webContents.on('will-attach-webview', this.beforeAttach)
    mainWindow.webContents.on('did-attach-webview', this.afterAttach)
    this.browserSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: !this.isCurrent() }))
    this.browserSession.setPermissionCheckHandler((contents, permission, origin) => (
      this.isCurrent() && !!contents && this.contents.has(contents) && isCrmUrl(origin) &&
      ['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission)
    ))
    this.browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(this.isCurrent() && this.contents.has(contents) && isCrmUrl(details.requestingUrl) &&
        ['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
    })
    this.browserSession.on('will-download', this.onDownload)
  }

  private isCurrent(): boolean { return !this.disposed && this.isAllowed() }

  private beforeAttach = (event: Electron.Event, preferences: Electron.WebPreferences, params: Record<string, string>): void => {
    if (preferences.partition !== this.descriptor.partition) return
    if (!this.isCurrent() || params.src !== CRM_URL) { event.preventDefault(); return }
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
    if (!this.isCurrent()) { contents.close({ waitForBeforeUnload: false }); return }
    if (this.guest && !this.guest.isDestroyed()) this.guest.close({ waitForBeforeUnload: false })
    this.guest = contents
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
      if (this.isCurrent() && isCrmUrl(url)) return
      event.preventDefault()
      if (this.isCurrent()) openExternal(url)
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
    contents.setWindowOpenHandler(({ url }) => {
      if (!this.isCurrent()) return { action: 'deny' }
      if (!isCrmUrl(url)) { openExternal(url); return { action: 'deny' } }
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
      this.popups.add(child)
      child.once('closed', () => this.popups.delete(child))
      this.configureContents(child.webContents)
    })
  }

  private onDownload = (event: Electron.Event, item: Electron.DownloadItem, contents: WebContents): void => {
    if (!this.isCurrent() || !contents || !this.contents.has(contents)) { event.preventDefault(); return }
    item.setSaveDialogOptions({ title: 'Lưu tệp từ CRM' })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (!this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.removeListener('will-attach-webview', this.beforeAttach)
      this.mainWindow.webContents.removeListener('did-attach-webview', this.afterAttach)
    }
    for (const popup of this.popups) if (!popup.isDestroyed()) popup.destroy()
    for (const contents of this.contents) if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    this.contents.clear()
    this.browserSession.removeListener('will-download', this.onDownload)
    this.browserSession.setPermissionCheckHandler(() => false)
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.browserSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }))
    // Preserve this staff's manually established CRM login, like a browser profile.
    await this.browserSession.closeAllConnections()
  }
}
