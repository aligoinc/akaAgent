import { rm } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Cron } from 'croner'

/**
 * CleanupJob — nightly retention enforcement.
 *
 * - runs: 90 days (cascade run_steps via FK ON DELETE CASCADE)
 * - step_forensics: 30 days (table has its own retention)
 * - screenshots/{runId}/: also 30 days (filesystem cleanup)
 * - campaign_logs: NEVER DELETE (vĩnh viễn for customer reports)
 *
 * Schedule: nightly 03:00 local TZ.
 */

export class CleanupJob {
  private cron: Cron | null = null
  private screenshotsDir: string

  constructor(
    private supabase: SupabaseClient,
    private opts: {
      runRetentionDays?: number
      forensicRetentionDays?: number
      schedule?: string
      timezone?: string
    } = {}
  ) {
    this.screenshotsDir = path.join(app.getPath('userData'), 'screenshots')
  }

  start(): void {
    if (this.cron) return
    const schedule = this.opts.schedule ?? '0 3 * * *'  // 3am daily
    const timezone = this.opts.timezone ?? 'UTC'
    this.cron = new Cron(schedule, { timezone, name: 'akabiz-cleanup' }, async () => {
      console.log('[CleanupJob] running nightly cleanup...')
      try { await this.runOnce() } catch (err) { console.error('[CleanupJob] error:', err) }
    })
    console.log('[CleanupJob] scheduled at', schedule, timezone)
  }

  stop(): void {
    if (this.cron) {
      this.cron.stop()
      this.cron = null
    }
  }

  async runOnce(): Promise<{ runsDeleted: number; forensicsDeleted: number; screenshotsCleaned: number }> {
    const runDays = this.opts.runRetentionDays ?? 90
    const forensicDays = this.opts.forensicRetentionDays ?? 30

    // 1. Delete old runs (cascades run_steps + step_forensics via FK)
    const runCutoff = new Date(Date.now() - runDays * 86400000).toISOString()
    const { data: deletedRuns } = await this.supabase.from('runs').delete()
      .lt('created_at', runCutoff).select('id')
    const runsDeleted = deletedRuns?.length ?? 0

    // 2. Delete old step_forensics (rows whose run still exists but forensic is old)
    const forensicCutoff = new Date(Date.now() - forensicDays * 86400000).toISOString()
    const { data: deletedForensics } = await this.supabase.from('step_forensics').delete()
      .lt('created_at', forensicCutoff).select('step_id')
    const forensicsDeleted = deletedForensics?.length ?? 0

    // 3. Cleanup screenshot directories for runs no longer in DB
    let screenshotsCleaned = 0
    try {
      const { readdir, stat } = await import('node:fs/promises')
      const dirs = await readdir(this.screenshotsDir).catch(() => [] as string[])
      for (const dir of dirs) {
        try {
          const fullDir = path.join(this.screenshotsDir, dir)
          const s = await stat(fullDir)
          if (s.isDirectory() && Date.now() - s.mtimeMs > forensicDays * 86400000) {
            await rm(fullDir, { recursive: true, force: true })
            screenshotsCleaned++
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[CleanupJob] screenshots cleanup error:', err)
    }

    console.log(`[CleanupJob] cleaned: ${runsDeleted} runs, ${forensicsDeleted} forensics, ${screenshotsCleaned} screenshot dirs`)
    return { runsDeleted, forensicsDeleted, screenshotsCleaned }
  }
}
