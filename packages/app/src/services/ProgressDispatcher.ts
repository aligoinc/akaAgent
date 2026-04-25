import type { ProgressEvent } from '@akabiz/engine'
import type { CampaignLogger } from './CampaignLogger.js'
import type { ScreenshotWriter } from './ScreenshotWriter.js'
import type { ForensicCollector } from './ForensicCollector.js'

/**
 * ProgressDispatcher — fan-out engine ProgressEvent tới 4 sinks:
 *  1. CampaignLogger (campaign_logs DB never delete)
 *  2. ScreenshotWriter (PNG local, 30d retention via CleanupJob)
 *  3. ForensicCollector (step_forensics DB, 30d retention)
 *  4. Realtime broadcast (mainWindow IPC) — handled bởi caller
 *
 * Track current channel per run (cần cho ScreenshotWriter +
 * ForensicCollector). Caller pass channelId khi enqueue + dispatcher
 * cache theo runId.
 */

export class ProgressDispatcher {
  private channelByRun = new Map<string, string>()
  private realtimeBroadcast: (event: ProgressEvent) => void

  constructor(
    private campaignLogger: CampaignLogger,
    private screenshotWriter: ScreenshotWriter,
    private forensicCollector: ForensicCollector,
    realtimeBroadcast: (event: ProgressEvent) => void = () => {}
  ) {
    this.realtimeBroadcast = realtimeBroadcast
  }

  /** Set/replace realtime broadcast fn (main process wires this after creating window). */
  setRealtimeBroadcast(fn: (event: ProgressEvent) => void): void {
    this.realtimeBroadcast = fn
  }

  /** Caller pass channelId before enqueue → dispatcher uses for screenshot/forensic. */
  registerRunChannel(runId: string, channelId: string | null): void {
    if (channelId) this.channelByRun.set(runId, channelId)
  }

  handle(event: ProgressEvent): void {
    // 1. Realtime broadcast first (UI responsive)
    try { this.realtimeBroadcast(event) } catch {}

    // 2. Async sinks (don't await — fire-and-forget)
    void this.campaignLogger.handle(event).catch(() => {})

    const channelId = this.channelByRun.get(event.runId) ?? null
    void this.screenshotWriter.handle(event, channelId).catch(() => {})
    void this.forensicCollector.handle(event, channelId).catch(() => {})

    if (event.kind === 'run.end') {
      this.screenshotWriter.cleanup(event.runId)
      this.channelByRun.delete(event.runId)
    }
  }
}
