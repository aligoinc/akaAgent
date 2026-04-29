import { webContents, WebContents } from 'electron'

/**
 * Thin wrapper exposing connectivity + URL of an Electron <webview>'s WebContents.
 * After engine v1 was removed, all browser automation runs through `src/main/v2/runtime/pageController.ts`.
 * This file remains because:
 *   - WebviewRegistry maps channelId → webContentsId (used by scheduler/contactLoader).
 *   - WebviewController.isConnected() / getURL() are called by contactLoader & channelPoller
 *     for status checks before invoking engine v2.
 */
export class WebviewController {
  private wc: WebContents

  constructor(webContentsInstance: WebContents) {
    this.wc = webContentsInstance
  }

  isConnected(): boolean {
    try {
      return !this.wc.isDestroyed()
    } catch {
      return false
    }
  }

  getURL(): string {
    return this.isConnected() ? this.wc.getURL() : ''
  }
}

/**
 * Registry mapping channelId → webContentsId.
 * Used by CampaignScheduler / ContactLoader to find the webview for each channel.
 */
export class WebviewRegistry {
  private registry: Map<number, number> = new Map() // channelId → webContentsId

  register(channelId: number, webContentsId: number): void {
    this.registry.set(channelId, webContentsId)
  }

  unregister(channelId: number): void {
    this.registry.delete(channelId)
  }

  isRegistered(channelId: number): boolean {
    const wcId = this.registry.get(channelId)
    if (wcId === undefined) return false
    // Verify the webContents still exists
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(channelId)
      return false
    }
    return true
  }

  getController(channelId: number): WebviewController | null {
    const wcId = this.registry.get(channelId)
    if (wcId === undefined) return null
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(channelId)
      return null
    }
    return new WebviewController(wc)
  }

  getWebContentsId(channelId: number): number | null {
    const wcId = this.registry.get(channelId)
    if (wcId === undefined) return null
    return wcId
  }

  /**
   * Snapshot of all registered channels along with whether the underlying
   * WebContents is still alive. Used by channelPoller to skip dead tabs.
   */
  listRegistered(): Array<{ channelId: number; connected: boolean }> {
    const result: Array<{ channelId: number; connected: boolean }> = []
    for (const [channelId, wcId] of this.registry.entries()) {
      const wc = webContents.fromId(wcId)
      const connected = !!wc && !wc.isDestroyed()
      result.push({ channelId, connected })
    }
    return result
  }
}
