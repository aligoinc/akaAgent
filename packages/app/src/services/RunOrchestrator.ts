import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkflowEngine, RunRequest, RunResult, IDataTableProvider, DataTableRow } from '@akabiz/engine'
import type { TriggerRow } from './TriggerService.js'

/**
 * RunOrchestrator — queue + dispatch RunRequest tới WorkflowEngine.
 *
 * Phase 6 minimal:
 *  - enqueueFromTrigger(trigger): fan-out theo datatable filter, tạo N RunRequest
 *  - Per-channel concurrency=1 (delegated to ChannelManager via acquire mutex)
 *  - Sequential dispatch — fire-and-collect promises
 *
 * Phase later: persistent queue (Postgres), priority, retry of failed runs.
 */

export class RunOrchestrator {
  constructor(
    private engine: WorkflowEngine,
    private supabase: SupabaseClient,
    private dataTableProvider: IDataTableProvider
  ) {}

  /** Manual enqueue (for CLI/UI testing). */
  async enqueue(request: RunRequest): Promise<RunResult> {
    return await this.engine.enqueue(request)
  }

  /** Trigger fired — fan-out theo datatable nếu có. */
  async enqueueFromTrigger(trigger: TriggerRow): Promise<void> {
    const channelId = this.pickChannel(trigger)

    // No datatable: 1 run với input = trigger.config.input (nếu có)
    if (!trigger.datatable_id) {
      const inputRaw = trigger.config.input
      const input = inputRaw && typeof inputRaw === 'object' ? (inputRaw as Record<string, unknown>) : {}
      const result = await this.engine.enqueue({
        workflowId: trigger.workflow_id,
        ...(trigger.workflow_version !== null ? { workflowVersion: trigger.workflow_version } : {}),
        triggerId: trigger.id,
        ...(channelId ? { channelId } : {}),
        input
      })
      console.log(`[RunOrchestrator] trigger ${trigger.id} → run ${result.runId} (${result.status})`)
      return
    }

    // Datatable fan-out
    const filter = trigger.datatable_filter ?? {}
    const where = (filter.where ?? {}) as Record<string, unknown>
    const orderBy = String(filter.orderBy ?? 'created_at')
    const limit = Number(filter.limit ?? 50)

    const rows = await this.dataTableProvider.pickRows({
      datatableId: trigger.datatable_id,
      filter: { where, orderBy, limit },
      atomicLock: true
    })

    console.log(`[RunOrchestrator] trigger ${trigger.id} fan-out ${rows.length} rows`)

    // Sequential dispatch (per-channel concurrency=1 in ChannelManager)
    for (const row of rows) {
      try {
        const result = await this.engine.enqueue({
          workflowId: trigger.workflow_id,
          ...(trigger.workflow_version !== null ? { workflowVersion: trigger.workflow_version } : {}),
          triggerId: trigger.id,
          ...(channelId ? { channelId } : {}),
          input: row.data,
          context: { datatableRowId: row.id }
        })
        console.log(`[RunOrchestrator]   row ${row.id} → run ${result.runId} (${result.status})`)
        // Update row status based on run result
        await this.dataTableProvider.updateRow(row.id, {
          status: result.status === 'completed' ? 'done' : 'failed',
          lastRunId: result.runId,
          ...(result.status !== 'completed' ? { incrementRetry: true } : {})
        })
      } catch (err) {
        console.error(`[RunOrchestrator]   row ${row.id} run failed:`, err instanceof Error ? err.message : err)
        await this.dataTableProvider.updateRow(row.id, {
          status: 'failed',
          incrementRetry: true
        })
      }
    }
  }

  private pickChannel(trigger: TriggerRow): string | undefined {
    if (trigger.channel_id) return trigger.channel_id
    if (trigger.channel_pool && trigger.channel_pool.length > 0) {
      // Phase 6 simple: round-robin first. Phase later: actual round-robin state
      return trigger.channel_pool[0]
    }
    return undefined
  }

  /**
   * Recover orphaned runs on app boot — runs status='running' không có owner
   * → mark 'failed' với note. Datatable rows đang in_progress (last_run was
   * orphaned) → reset 'pending'.
   */
  async recoverInflight(): Promise<void> {
    const { data: orphaned, error } = await this.supabase.from('runs')
      .select('id, datatable_row_id')
      .in('status', ['running', 'queued', 'paused'])
    if (error) {
      console.warn('[RunOrchestrator] recover query error:', error.message)
      return
    }

    if (!orphaned || orphaned.length === 0) return

    console.log(`[RunOrchestrator] recovering ${orphaned.length} orphaned runs`)
    const orphanIds = orphaned.map(r => r.id as string)

    await this.supabase.from('runs').update({
      status: 'failed',
      error: 'orphaned: app crashed or restarted',
      finished_at: new Date().toISOString()
    }).in('id', orphanIds)

    const rowIds = orphaned.filter(r => r.datatable_row_id).map(r => r.datatable_row_id as string)
    if (rowIds.length > 0) {
      await this.supabase.from('datatable_rows').update({
        status: 'pending'
      }).in('id', rowIds).eq('status', 'in_progress')
    }
  }
}
