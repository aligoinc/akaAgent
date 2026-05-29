import { session, webContents, WebContents } from 'electron'

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

  private getExpectedPartition(accountId: number): string {
    return `persist:account_${accountId}`
  }

  validateWebContentsForAccount(accountId: number, webContentsId: number): { success: boolean; reason?: string } {
    const wc = webContents.fromId(webContentsId)
    if (!wc || wc.isDestroyed()) {
      return { success: false, reason: 'Tab trình duyệt không khả dụng' }
    }

    const expectedSession = session.fromPartition(this.getExpectedPartition(accountId))
    if (wc.session !== expectedSession) {
      return { success: false, reason: 'Tab trình duyệt không khớp hồ sơ tài khoản' }
    }

    return { success: true }
  }

  isWebContentsForAccount(accountId: number, webContentsId: number): boolean {
    return this.validateWebContentsForAccount(accountId, webContentsId).success
  }

  private getRegisteredWebContents(accountId: number): WebContents | null {
    const wcId = this.registry.get(accountId)
    if (wcId === undefined) return null

    const validation = this.validateWebContentsForAccount(accountId, wcId)
    if (!validation.success) {
      this.registry.delete(accountId)
      return null
    }

    return webContents.fromId(wcId) ?? null
  }

  register(accountId: number, webContentsId: number): { success: boolean; reason?: string } {
    const validation = this.validateWebContentsForAccount(accountId, webContentsId)
    if (!validation.success) return validation
    this.registry.set(accountId, webContentsId)
    return { success: true }
  }

  unregister(accountId: number): void {
    this.registry.delete(accountId)
  }

  isRegistered(accountId: number): boolean {
    return !!this.getRegisteredWebContents(accountId)
  }

  getController(accountId: number): WebviewController | null {
    const wc = this.getRegisteredWebContents(accountId)
    if (!wc) return null
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
      const connected = this.isWebContentsForAccount(accountId, wcId)
      if (!connected) this.registry.delete(accountId)
      result.push({ accountId, connected })
    }
    return result
  }
}
