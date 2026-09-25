import type { WebContents } from 'electron'
import { trustedFacebookUrl } from './facebookSessionRequest'
import { withRequestDeadline } from './requestDeadline'

/** One initial tab load, observed through Electron events only. Never owns an account claim. */
export class FacebookStartupBrowser {
  private complete!: () => void
  private readonly ready = new Promise<void>(resolve => { this.complete = resolve })
  private page: WebContents | null = null
  private loaded = false
  private cancelled = false
  private detach = (): void => {}

  attach(page: WebContents): void {
    if (this.page === page || this.cancelled) return
    if (this.page) { this.cancel(); return }
    this.page = page
    const cancel = (): void => this.cancel()
    const navigation = (_event: Electron.Event, _url: string, _inPlace: boolean, mainFrame: boolean): void => {
      if (mainFrame && this.loaded) this.cancel()
    }
    const settled = (): void => {
      if (page.isDestroyed()) { this.cancel(); return }
      const url = page.getURL()
      // about:blank's dom-ready/stop is not the first Facebook page load.
      if (!url || url === 'about:blank' || page.isLoadingMainFrame()) return
      if (!trustedFacebookUrl(url)) { this.cancel(); return }
      this.loaded = true
      this.complete()
    }
    page.on('did-stop-loading', settled)
    page.on('did-start-navigation', navigation)
    page.on('before-input-event', cancel)
    page.on('will-navigate', cancel)
    page.on('destroyed', cancel)
    this.detach = () => {
      page.removeListener('did-stop-loading', settled)
      page.removeListener('did-start-navigation', navigation)
      page.removeListener('before-input-event', cancel)
      page.removeListener('will-navigate', cancel)
      page.removeListener('destroyed', cancel)
    }
    settled()
  }

  cancel(): void { this.cancelled = true; this.complete(); this.dispose() }
  dispose(): void { this.detach(); this.detach = () => {} }

  async wait(signal: AbortSignal): Promise<void> {
    try {
      await withRequestDeadline(signal, () => this.ready, 30_000)
      signal.throwIfAborted()
      if (this.cancelled) throw new Error('Đã dừng tự khôi phục vì trình duyệt có thao tác mới hoặc đã đóng.')
    } finally { this.dispose() }
  }
}
