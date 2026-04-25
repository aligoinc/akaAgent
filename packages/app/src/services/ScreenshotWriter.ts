import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProgressEvent } from '@akabiz/engine'
import type { ChannelManager } from './ChannelManager.js'
import type { PlaywrightController } from '../browser/PlaywrightController.js'

/**
 * ScreenshotWriter — capture screenshot khi step error (or always per workflow setting).
 * Save PNG vào userData/screenshots/{runId}/{stepIdx}_{nodeId}.png.
 * Update run_steps.screenshot_after_path.
 */

export class ScreenshotWriter {
  private baseDir: string
  private stepCounters = new Map<string, number>()    // runId → step index counter

  constructor(
    private supabase: SupabaseClient,
    private channelManager: ChannelManager,
    baseDir?: string
  ) {
    this.baseDir = baseDir ?? path.join(app.getPath('userData'), 'screenshots')
  }

  async handle(event: ProgressEvent, currentChannelId: string | null): Promise<void> {
    if (event.kind !== 'step.end') return
    if (event.status !== 'error') return    // Phase 9.5 minimum: only on error

    if (!currentChannelId) return            // No browser channel → no screenshot
    const ctrl = this.channelManager['controllers'].get(currentChannelId) as PlaywrightController | undefined
    if (!ctrl || !ctrl.isConnected()) return

    try {
      const page = ctrl.getPage()
      if (!page) return

      const counter = (this.stepCounters.get(event.runId) ?? 0) + 1
      this.stepCounters.set(event.runId, counter)

      const dir = path.join(this.baseDir, event.runId)
      await mkdir(dir, { recursive: true })
      const filename = `${String(counter).padStart(3, '0')}_${event.nodeId}.error.png`
      const fullPath = path.join(dir, filename)
      const buf = await page.screenshot({ fullPage: false })
      await writeFile(fullPath, buf)

      // Relative path for DB (relative to userData)
      const relPath = path.relative(app.getPath('userData'), fullPath)

      // Update most recent step record for this run+node with screenshot path
      const { data: steps } = await this.supabase.from('run_steps')
        .select('id').eq('run_id', event.runId).eq('node_id', event.nodeId)
        .order('started_at', { ascending: false }).limit(1)
      if (steps && steps[0]) {
        await this.supabase.from('run_steps').update({
          screenshot_after_path: relPath
        }).eq('id', steps[0].id)
      }
    } catch (err) {
      console.warn('[ScreenshotWriter] capture failed:', err instanceof Error ? err.message : err)
    }

    if (event.kind === 'step.end') return
  }

  cleanup(runId: string): void {
    this.stepCounters.delete(runId)
  }

  getBaseDir(): string {
    return this.baseDir
  }
}
