import type { DataTableRow, DataRowStatus } from '../types/DataTable.js'

/**
 * App layer (DataTableService) implement interface này để engine read/update
 * datatable_rows. Engine không trực tiếp đụng Supabase — qua interface.
 *
 * Phase 2 mock: in-memory Map. Phase 6 thật: Supabase repo + atomic SELECT
 * FOR UPDATE SKIP LOCKED cho row picker.
 */

export interface PickRowOptions {
  datatableId: string
  filter?: {
    where?: Record<string, unknown>
    orderBy?: string
    limit?: number
  }
  /** Set to 'in_progress' atomic — đảm bảo no race với trigger khác */
  atomicLock?: boolean
}

export interface UpdateRowPatch {
  data?: Record<string, unknown>            // merge vào existing data
  status?: DataRowStatus
  retryCount?: number                       // explicit value hoặc undefined để giữ nguyên
  incrementRetry?: boolean                  // shortcut: retryCount += 1
  lastRunId?: string
  tags?: string[]
}

export interface IDataTableProvider {
  /** Pick 1 hoặc N rows match filter, optionally lock as 'in_progress' */
  pickRows(opts: PickRowOptions): Promise<DataTableRow[]>

  /** Get 1 row by id */
  getRow(rowId: string): Promise<DataTableRow | null>

  /** Update 1 row */
  updateRow(rowId: string, patch: UpdateRowPatch): Promise<DataTableRow | null>
}
