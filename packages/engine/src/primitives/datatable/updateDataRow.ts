import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'
import type { IDataTableProvider } from '../../core/IDataTableProvider.js'

/**
 * core.updateDataRow — update 1 row trong DataTable.
 *
 * Patch:
 *   - data (merge vào existing JSON data)
 *   - status (pending|in_progress|done|failed|skipped)
 *   - retryCount (explicit) hoặc incrementRetry=true
 *   - lastRunId
 *   - tags
 */

export const updateDataRowManifest: CoreBlockManifest = {
  manifestId: 'core.updateDataRow',
  name: 'Update Data Row',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Database', category: 'datatable', description: 'Update a row in a DataTable' },
  inputSchema: [
    { name: 'rowId', type: 'string', label: 'Row ID', required: true },
    { name: 'data', type: 'json', label: 'Merge data fields' },
    { name: 'status', type: 'string', label: 'New status',
      options: [
        { label: 'pending', value: 'pending' },
        { label: 'in_progress', value: 'in_progress' },
        { label: 'done', value: 'done' },
        { label: 'failed', value: 'failed' },
        { label: 'skipped', value: 'skipped' }
      ] },
    { name: 'incrementRetry', type: 'boolean', label: 'Increment retry_count' },
    { name: 'retryCount', type: 'number', label: 'Set retry_count (explicit)' },
    { name: 'lastRunId', type: 'string', label: 'Last run id' },
    { name: 'tags', type: 'array', label: 'Tags',
      itemSchema: { name: 'tag', type: 'string', label: 'Tag' } }
  ],
  outputSchema: [
    { name: 'row', type: 'json', label: 'Updated row' }
  ],
  implementationKey: 'core.updateDataRow'
}

export function makeUpdateDataRowHandler(provider: IDataTableProvider): CoreBlockHandler {
  return {
    async execute(input: Record<string, unknown>, _ctx: ExecuteContext) {
      void _ctx
      const rowId = String(input.rowId ?? '')
      if (!rowId) return { success: false, error: 'updateDataRow: rowId is required' }

      const patch: Parameters<IDataTableProvider['updateRow']>[1] = {}
      if (input.data && typeof input.data === 'object') {
        patch.data = input.data as Record<string, unknown>
      }
      if (typeof input.status === 'string') {
        const allowed = ['pending', 'in_progress', 'done', 'failed', 'skipped']
        if (allowed.includes(input.status)) {
          patch.status = input.status as 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped'
        }
      }
      if (typeof input.retryCount === 'number') patch.retryCount = input.retryCount
      if (input.incrementRetry === true) patch.incrementRetry = true
      if (typeof input.lastRunId === 'string' && input.lastRunId !== '') patch.lastRunId = input.lastRunId
      if (Array.isArray(input.tags)) patch.tags = input.tags.map(String)

      try {
        const updated = await provider.updateRow(rowId, patch)
        if (!updated) return { success: false, error: `updateDataRow: row '${rowId}' not found` }
        return { success: true, output: { row: updated } }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
