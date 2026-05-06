import { webContents, WebContents } from 'electron'

/**
 * Thin wrapper exposing connectivity + URL of an Electron <webview>'s WebContents.
 * After engine v1 was removed, all browser automation runs through `src/main/v2/runtime/pageController.ts`.
 * This file remains because:
 *   - WebviewRegistry maps accountId → webContentsId (used by scheduler/contactLoader).
 *   - WebviewController.isConnected() / getURL() are called by contactLoader & accountPoller
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
 * Registry mapping accountId → webContentsId.
 * Used by CampaignScheduler / ContactLoader to find the webview for each account.
 */
export class WebviewRegistry {
  private registry: Map<number, number> = new Map() // accountId → webContentsId

  register(accountId: number, webContentsId: number): void {
    this.registry.set(accountId, webContentsId)
  }

  unregister(accountId: number): void {
    this.registry.delete(accountId)
  }

  isRegistered(accountId: number): boolean {
    const wcId = this.registry.get(accountId)
    if (wcId === undefined) return false
    // Verify the webContents still exists
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(accountId)
      return false
    }
    return true
  }

  getController(accountId: number): WebviewController | null {
    const wcId = this.registry.get(accountId)
    if (wcId === undefined) return null
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(accountId)
      return null
    }
    return new WebviewController(wc)
  }

  getWebContentsId(accountId: number): number | null {
    const wcId = this.registry.get(accountId)
    if (wcId === undefined) return null
    return wcId
  }

  /**
   * Snapshot of all registered accounts along with whether the underlying
   * WebContents is still alive. Used by accountPoller to skip dead tabs.
   */
  listRegistered(): Array<{ accountId: number; connected: boolean }> {
    const result: Array<{ accountId: number; connected: boolean }> = []
    for (const [accountId, wcId] of this.registry.entries()) {
      const wc = webContents.fromId(wcId)
      const connected = !!wc && !wc.isDestroyed()
      result.push({ accountId, connected })
    }
    return result
  }
}
