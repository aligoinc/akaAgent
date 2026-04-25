import { gzipSync } from 'node:zlib'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProgressEvent } from '@akabiz/engine'
import type { ChannelManager } from './ChannelManager.js'
import type { PlaywrightController } from '../browser/PlaywrightController.js'

/**
 * ForensicCollector — write step_forensics on error (or always per setting).
 *
 * Phase 9.5 minimum: on step.end error, capture:
 *  - DOM HTML (gzip)
 *  - Page URL
 *  - Viewport
 *
 * Phase later:
 *  - Console logs (need persistent listener on page)
 *  - Network HAR (need page.context.tracing or Playwright HAR API)
 */

export class ForensicCollector {
  constructor(
    private supabase: SupabaseClient,
    private channelManager: ChannelManager
  ) {}

  async handle(event: ProgressEvent, currentChannelId: string | null): Promise<void> {
    if (event.kind !== 'step.end') return
    if (event.status !== 'error') return
    if (!currentChannelId) return

    const ctrl = this.channelManager['controllers'].get(currentChannelId) as PlaywrightController | undefined
    if (!ctrl || !ctrl.isConnected()) return

    try {
      const page = ctrl.getPage()
      if (!page) return

      const url = page.url()
      const viewport = page.viewportSize() ?? { width: 0, height: 0 }
      const html = await page.content().catch(() => '')

      const domGz = html ? gzipSync(Buffer.from(html, 'utf8')) : null

      // Lookup step record
      const { data: steps } = await this.supabase.from('run_steps')
        .select('id').eq('run_id', event.runId).eq('node_id', event.nodeId)
        .order('started_at', { ascending: false }).limit(1)
      if (!steps?.[0]) return
      const stepId = steps[0].id as string

      await this.supabase.from('step_forensics').insert({
        step_id: stepId,
        dom_html_gz: domGz,
        network_har: null,
        console_logs: null,
        page_url: url,
        viewport
      })
    } catch (err) {
      console.warn('[ForensicCollector] capture failed:', err instanceof Error ? err.message : err)
    }
  }
}
