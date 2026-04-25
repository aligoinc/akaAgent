import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'
import type { IDataTableProvider } from '../../core/IDataTableProvider.js'

/**
 * core.readDataRow — read 1 row từ DataTable.
 *
 * 2 modes:
 *   - rowId (specific): get 1 row by id
 *   - filter (atomic pick): pick rows match filter, optionally lock as 'in_progress'
 *
 * Phase 3c: handler dùng `ctx.dataTableProvider` (App layer inject).
 */

export const readDataRowManifest: CoreBlockManifest = {
  manifestId: 'core.readDataRow',
  name: 'Read Data Row',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Database', category: 'datatable', description: 'Read row(s) from a DataTable' },
  inputSchema: [
    { name: 'datatableId', type: 'datatable', label: 'DataTable', required: true },
    { name: 'rowId', type: 'string', label: 'Row ID (specific row)' },
    { name: 'filter', type: 'json', label: 'Filter (mode pick)',
      placeholder: '{"where": {"status":"pending"}, "orderBy":"created_at", "limit":1}',
      uiHint: 'monaco-json' },
    { name: 'atomicLock', type: 'boolean', label: 'Atomic lock as in_progress', defaultValue: false }
  ],
  outputSchema: [
    { name: 'row', type: 'json', label: 'First row found' },
    { name: 'rows', type: 'array', label: 'All matching rows' },
    { name: 'count', type: 'number', label: 'Number of rows returned' }
  ],
  implementationKey: 'core.readDataRow'
}

export function makeReadDataRowHandler(provider: IDataTableProvider): CoreBlockHandler {
  return {
    async execute(input: Record<string, unknown>, _ctx: ExecuteContext) {
      void _ctx
      const datatableId = String(input.datatableId ?? '')
      if (!datatableId) return { success: false, error: 'readDataRow: datatableId is required' }

      // Mode 1: specific rowId
      const rowId = input.rowId
      if (typeof rowId === 'string' && rowId !== '') {
        const row = await provider.getRow(rowId)
        if (!row) return { success: false, error: `readDataRow: row '${rowId}' not found` }
        return { success: true, output: { row, rows: [row], count: 1 } }
      }

      // Mode 2: filter pick
      const filterRaw = input.filter
      const filter = filterRaw && typeof filterRaw === 'object' ? filterRaw as Record<string, unknown> : {}
      const atomicLock = Boolean(input.atomicLock ?? false)

      try {
        const rows = await provider.pickRows({
          datatableId,
          filter: {
            ...(filter.where ? { where: filter.where as Record<string, unknown> } : {}),
            ...(filter.orderBy ? { orderBy: String(filter.orderBy) } : {}),
            ...(filter.limit ? { limit: Number(filter.limit) } : {})
          },
          atomicLock
        })
        return {
          success: true,
          output: {
            row: rows[0] ?? null,
            rows,
            count: rows.length
          }
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
