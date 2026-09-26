import type { WebContents } from 'electron'
import { withRequestDeadline } from './requestDeadline'

/** Page readiness only. Viewing, navigation and tab replacement never cancel login. */
export class FacebookStartupBrowser {
  private complete!: () => void
  private ready = new Promise<void>(resolve => { this.complete = resolve })
  private page: WebContents | null = null
  private settled = false
  private detach = (): void => {}

  attach(page: WebContents): void {
    if (this.page === page) return
    this.detach()
    this.page = page
    this.reset()
    const closed = (): void => this.releasePage()
    const navigation = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
      if (mainFrame && !inPlace) this.reset()
    }
    const settled = (): void => {
      if (page.isDestroyed()) { this.releasePage(); return }
      const url = page.getURL()
      // about:blank's dom-ready/stop is not the first Facebook page load.
      if (!url || url === 'about:blank' || page.isLoadingMainFrame()) return
      this.settled = true
      this.complete()
    }
    page.on('did-stop-loading', settled)
    page.on('did-start-navigation', navigation)
    page.on('destroyed', closed)
    this.detach = () => {
      page.removeListener('did-stop-loading', settled)
      page.removeListener('did-start-navigation', navigation)
      page.removeListener('destroyed', closed)
    }
    settled()
  }

  private reset(): void {
    this.complete()
    this.settled = false
    this.ready = new Promise<void>(resolve => { this.complete = resolve })
  }
  releasePage(): void { this.page = null; this.settled = true; this.complete(); this.dispose() }
  dispose(): void { this.detach(); this.detach = () => {} }

  async wait(signal: AbortSignal): Promise<void> {
    try {
      await withRequestDeadline(signal, async waitSignal => {
        while (!this.settled) { await this.ready; waitSignal.throwIfAborted() }
      }, 30_000)
      signal.throwIfAborted()
    } catch (error) { this.dispose(); throw error }
  }
}
