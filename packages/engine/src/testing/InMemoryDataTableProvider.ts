import type { DataTableRow, DataRowStatus } from '../types/DataTable.js'
import type { IDataTableProvider, PickRowOptions, UpdateRowPatch } from '../core/IDataTableProvider.js'

/**
 * Test-only InMemoryDataTableProvider — store rows trong Map.
 * Atomic lock semantics: pickRows với atomicLock=true sẽ set row.status='in_progress'.
 */
export class InMemoryDataTableProvider implements IDataTableProvider {
  public rows = new Map<string, DataTableRow>()

  seed(rows: DataTableRow[]): void {
    for (const r of rows) this.rows.set(r.id, { ...r })
  }

  async getRow(rowId: string): Promise<DataTableRow | null> {
    return this.rows.get(rowId) ?? null
  }

  async pickRows(opts: PickRowOptions): Promise<DataTableRow[]> {
    let filtered = Array.from(this.rows.values())
      .filter(r => r.datatableId === opts.datatableId)

    const where = opts.filter?.where
    if (where) {
      filtered = filtered.filter(r => {
        for (const [k, v] of Object.entries(where)) {
          // Top-level row keys
          if (k === 'status' && r.status !== v) return false
          if (k === 'datatableId') continue
          // data.* keys
          if (k.startsWith('data.')) {
            const dataKey = k.slice(5)
            if (r.data[dataKey] !== v) return false
          }
        }
        return true
      })
    }

    if (opts.filter?.orderBy === 'created_at') {
      filtered.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    }

    const limit = opts.filter?.limit ?? filtered.length
    filtered = filtered.slice(0, limit)

    if (opts.atomicLock) {
      const now = new Date().toISOString()
      for (const r of filtered) {
        const stored = this.rows.get(r.id)
        if (stored) {
          stored.status = 'in_progress'
          stored.lastRunAt = now
          stored.updatedAt = now
        }
      }
      // Return updated copies
      return filtered.map(r => ({ ...this.rows.get(r.id)! }))
    }

    return filtered.map(r => ({ ...r }))
  }

  async updateRow(rowId: string, patch: UpdateRowPatch): Promise<DataTableRow | null> {
    const row = this.rows.get(rowId)
    if (!row) return null

    if (patch.data) row.data = { ...row.data, ...patch.data }
    if (patch.status) row.status = patch.status as DataRowStatus
    if (typeof patch.retryCount === 'number') row.retryCount = patch.retryCount
    if (patch.incrementRetry) row.retryCount = (row.retryCount ?? 0) + 1
    if (patch.lastRunId) row.lastRunId = patch.lastRunId
    if (patch.tags) row.tags = patch.tags
    row.updatedAt = new Date().toISOString()

    return { ...row }
  }
}
