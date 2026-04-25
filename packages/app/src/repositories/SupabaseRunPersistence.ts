import type { SupabaseClient } from '@supabase/supabase-js'
import type { IRunPersistence, Run, RunStep, RunStatus } from '@akabiz/engine'

/**
 * SupabaseRunPersistence — implement IRunPersistence với Supabase.
 *
 * Tables: runs, run_steps (đã có trong 0001_init_schema.sql).
 */

export class SupabaseRunPersistence implements IRunPersistence {
  constructor(private supabase: SupabaseClient) {}

  async createRun(run: Run): Promise<void> {
    const { error } = await this.supabase.from('runs').insert({
      id: run.id,
      workflow_id: run.workflowId,
      workflow_version: run.workflowVersion,
      trigger_id: run.triggerId ?? null,
      channel_id: run.channelId ?? null,
      datatable_row_id: run.datatableRowId ?? null,
      status: run.status,
      input: run.input ?? null,
      started_at: run.startedAt ?? null,
      organization_id: run.organizationId ?? null
    })
    if (error) throw new Error(`createRun failed: ${error.message}`)
  }

  async saveStep(step: RunStep): Promise<void> {
    const { error } = await this.supabase.from('run_steps').insert({
      id: step.id,
      run_id: step.runId,
      node_id: step.nodeId,
      manifest_id: step.manifestId,
      status: step.status,
      input: step.input ?? null,
      output: step.output ?? null,
      error: step.error ?? null,
      attempt: step.attempt,
      started_at: step.startedAt ?? null,
      finished_at: step.finishedAt ?? null,
      duration_ms: step.durationMs ?? null,
      reporting_label: step.reportingLabel ?? null,
      reporting_tags: step.reportingTags ?? null,
      log_messages: step.logMessages ?? null,
      screenshot_before_path: step.screenshotBeforePath ?? null,
      screenshot_after_path: step.screenshotAfterPath ?? null
    })
    if (error) throw new Error(`saveStep failed: ${error.message}`)
  }

  async finishRun(runId: string, status: RunStatus, output?: Record<string, unknown>, error?: string): Promise<void> {
    const finishedAt = new Date().toISOString()
    const { data: existing } = await this.supabase.from('runs').select('started_at').eq('id', runId).single()
    let durationMs: number | null = null
    if (existing?.started_at) {
      durationMs = Date.now() - new Date(existing.started_at as string).getTime()
    }
    const updates: Record<string, unknown> = {
      status,
      finished_at: finishedAt,
      duration_ms: durationMs,
      output: output ?? null
    }
    if (error !== undefined) updates.error = error
    const { error: updErr } = await this.supabase.from('runs').update(updates).eq('id', runId)
    if (updErr) throw new Error(`finishRun failed: ${updErr.message}`)
  }
}
