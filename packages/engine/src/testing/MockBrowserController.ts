import type { IBrowserController, ActionResult } from '../controllers/IBrowserController.js'
import type { IChannelProvider } from '../controllers/IChannelProvider.js'

/**
 * Test-only MockBrowserController — record action calls + return canned outputs.
 */
export class MockBrowserController implements IBrowserController {
  public calls: Array<{ actionType: string; input: Record<string, unknown> }> = []
  public connected = true

  /** Map actionType → output. Default: { success: true } */
  public responseMap = new Map<string, Partial<ActionResult>>()

  isConnected(): boolean { return this.connected }

  async executeAction(actionType: string, input: Record<string, unknown>): Promise<ActionResult> {
    this.calls.push({ actionType, input })
    const canned = this.responseMap.get(actionType)
    if (canned) {
      return {
        success: canned.success ?? true,
        output: canned.output ?? {},
        durationMs: canned.durationMs ?? 1,
        ...(canned.error !== undefined ? { error: canned.error } : {})
      }
    }
    return { success: true, output: { actionType, mock: true }, durationMs: 1 }
  }

  setResponse(actionType: string, response: Partial<ActionResult>): void {
    this.responseMap.set(actionType, response)
  }

  reset(): void {
    this.calls = []
    this.responseMap.clear()
  }
}

/**
 * Wraps MockBrowserController as IChannelProvider for test convenience.
 */
export class MockChannelProvider implements IChannelProvider {
  constructor(public controller: MockBrowserController = new MockBrowserController()) {}

  async acquire(channelId: string) {
    return {
      controller: this.controller,
      channelId,
      release: async () => {}
    }
  }

  async health(_channelId: string) {
    return { status: 'idle' as const }
  }
}
