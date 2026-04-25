import { Cron } from 'croner'
import { EventEmitter } from 'node:events'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RunOrchestrator } from './RunOrchestrator.js'

/**
 * TriggerService — schedule + event triggers.
 *
 * Phase 6 minimal:
 *  - tick mỗi 60s, query triggers WHERE kind='schedule' AND next_run_at <= now()
 *  - Cho mỗi trigger fired: orchestrator.enqueueFromTrigger(triggerId)
 *  - update next_run_at theo cron với croner
 *  - EventBus internal: emit('event', {name, payload}) — workflows trigger nhau
 *
 * Phase later: webhook server, persist paused runs, misfire policy advanced.
 */

interface TriggerRow {
  id: string
  workflow_id: string
  workflow_version: number | null
  channel_id: string | null
  channel_pool: string[] | null
  datatable_id: string | null
  datatable_filter: Record<string, unknown> | null
  kind: 'manual' | 'schedule' | 'webhook' | 'event'
  config: Record<string, unknown>
  settings: Record<string, unknown> | null
  is_active: boolean
  next_run_at: string | null
  last_run_at: string | null
  consecutive_failures: number
  organization_id: number | null
}

export class TriggerService {
  private intervalId: NodeJS.Timeout | null = null
  private bus = new EventEmitter()
  private running = false

  constructor(
    private supabase: SupabaseClient,
    private orchestrator: RunOrchestrator
  ) {
    this.bus.setMaxListeners(100)
  }

  start(): void {
    if (this.running) return
    this.running = true
    // Tick immediately + every 60s
    void this.tick()
    this.intervalId = setInterval(() => void this.tick(), 60_000)
    console.log('[TriggerService] started')
  }

  stop(): void {
    this.running = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.bus.removeAllListeners()
    console.log('[TriggerService] stopped')
  }

  /**
   * Subscribe to internal event (vd workflow chain qua core.emit).
   */
  onEvent(eventName: string, listener: (payload: unknown) => void): void {
    this.bus.on(eventName, listener)
  }

  emitEvent(eventName: string, payload: unknown): void {
    this.bus.emit(eventName, payload)
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    try {
      const now = new Date().toISOString()
      const { data, error } = await this.supabase.from('triggers')
        .select('*')
        .eq('is_active', true)
        .eq('kind', 'schedule')
        .lte('next_run_at', now)
        .limit(50)

      if (error) {
        console.error('[TriggerService] tick query error:', error.message)
        return
      }

      const triggers = (data ?? []) as TriggerRow[]
      for (const t of triggers) {
        await this.fireTrigger(t)
      }
    } catch (err) {
      console.error('[TriggerService] tick error:', err instanceof Error ? err.message : err)
    }
  }

  private async fireTrigger(trigger: TriggerRow): Promise<void> {
    try {
      // Compute next_run_at from cron
      const cronExpr = String(trigger.config.cron ?? '')
      const tz = String(trigger.config.timezone ?? 'UTC')
      let nextAt: string | null = null
      if (cronExpr) {
        try {
          const cron = new Cron(cronExpr, { timezone: tz })
          const next = cron.nextRun()
          nextAt = next ? next.toISOString() : null
        } catch (cronErr) {
          console.error(`[TriggerService] invalid cron '${cronExpr}':`, cronErr instanceof Error ? cronErr.message : cronErr)
        }
      }

      // Update trigger.last_run_at + next_run_at first to prevent re-fire
      await this.supabase.from('triggers').update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextAt
      }).eq('id', trigger.id)

      // Dispatch via orchestrator
      console.log(`[TriggerService] firing trigger ${trigger.id} (workflow ${trigger.workflow_id})`)
      await this.orchestrator.enqueueFromTrigger(trigger)
    } catch (err) {
      console.error(`[TriggerService] fireTrigger ${trigger.id} error:`, err)
      await this.supabase.from('triggers').update({
        consecutive_failures: trigger.consecutive_failures + 1,
        last_run_status: 'error'
      }).eq('id', trigger.id)
    }
  }
}

export type { TriggerRow }
