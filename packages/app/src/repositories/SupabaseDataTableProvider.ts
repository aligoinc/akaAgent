import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  IDataTableProvider, PickRowOptions, UpdateRowPatch,
  DataTableRow, DataRowStatus
} from '@akabiz/engine'

/**
 * SupabaseDataTableProvider — implement IDataTableProvider qua Supabase.
 *
 * Phase 6 minimal: pickRows + getRow + updateRow.
 * Phase 6.5+: atomic SELECT FOR UPDATE SKIP LOCKED qua RPC function
 * (Supabase JS không expose row-level lock trực tiếp, cần stored proc).
 * Hiện tại pickRows + atomicLock = 2 round trips (SELECT then UPDATE).
 */

export class SupabaseDataTableProvider implements IDataTableProvider {
  constructor(private supabase: SupabaseClient) {}

  async getRow(rowId: string): Promise<DataTableRow | null> {
    const { data, error } = await this.supabase.from('datatable_rows')
      .select('*').eq('id', rowId).single()
    if (error) {
      if (error.code === 'PGRST116') return null   // no rows found
      throw new Error(`getRow failed: ${error.message}`)
    }
    return this.mapRow(data)
  }

  async pickRows(opts: PickRowOptions): Promise<DataTableRow[]> {
    let query = this.supabase.from('datatable_rows')
      .select('*')
      .eq('datatable_id', opts.datatableId)

    const where = opts.filter?.where ?? {}
    for (const [k, v] of Object.entries(where)) {
      if (k === 'status') query = query.eq('status', v as string)
      else if (k.startsWith('data.')) {
        const dataKey = k.slice(5)
        query = query.eq(`data->>${dataKey}`, String(v))
      }
    }
    if (opts.filter?.orderBy === 'created_at') {
      query = query.order('created_at', { ascending: true })
    }
    const limit = opts.filter?.limit ?? 50
    query = query.limit(limit)

    const { data, error } = await query
    if (error) throw new Error(`pickRows failed: ${error.message}`)
    const rows = (data ?? []).map(r => this.mapRow(r))

    if (opts.atomicLock && rows.length > 0) {
      const ids = rows.map(r => r.id)
      const now = new Date().toISOString()
      const { error: updErr } = await this.supabase.from('datatable_rows')
        .update({ status: 'in_progress', last_run_at: now, updated_at: now })
        .in('id', ids)
      if (updErr) throw new Error(`pickRows atomicLock failed: ${updErr.message}`)
      // Reflect locked status
      for (const r of rows) {
        r.status = 'in_progress'
        r.lastRunAt = now
        r.updatedAt = now
      }
    }
    return rows
  }

  async updateRow(rowId: string, patch: UpdateRowPatch): Promise<DataTableRow | null> {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    if (patch.status) updates.status = patch.status
    if (typeof patch.retryCount === 'number') updates.retry_count = patch.retryCount
    if (patch.lastRunId) updates.last_run_id = patch.lastRunId
    if (patch.tags) updates.tags = patch.tags

    if (patch.data !== undefined || patch.incrementRetry) {
      // Need current row to merge data / increment retry
      const current = await this.getRow(rowId)
      if (!current) return null
      if (patch.data) updates.data = { ...current.data, ...patch.data }
      if (patch.incrementRetry) updates.retry_count = (current.retryCount ?? 0) + 1
    }

    const { data, error } = await this.supabase.from('datatable_rows')
      .update(updates).eq('id', rowId).select().single()
    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`updateRow failed: ${error.message}`)
    }
    return this.mapRow(data)
  }

  private mapRow(raw: Record<string, unknown>): DataTableRow {
    return {
      id: String(raw.id),
      datatableId: String(raw.datatable_id),
      data: (raw.data ?? {}) as Record<string, unknown>,
      status: (raw.status ?? 'pending') as DataRowStatus,
      ...(raw.last_run_id ? { lastRunId: String(raw.last_run_id) } : {}),
      ...(raw.last_run_at ? { lastRunAt: String(raw.last_run_at) } : {}),
      retryCount: Number(raw.retry_count ?? 0),
      ...(Array.isArray(raw.tags) ? { tags: raw.tags as string[] } : {}),
      ...(raw.organization_id !== null && raw.organization_id !== undefined ? { organizationId: Number(raw.organization_id) } : {}),
      ...(raw.created_at ? { createdAt: String(raw.created_at) } : {}),
      ...(raw.updated_at ? { updatedAt: String(raw.updated_at) } : {})
    }
  }
}
