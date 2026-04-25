import type { BlockIOField } from './BlockManifest.js'

export type DataRowStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped'

export interface DataTable {
  id: string
  name: string
  schema: BlockIOField[]
  description?: string
  organizationId?: number
  createdAt?: string
}

export interface DataTableRow {
  id: string
  datatableId: string
  data: Record<string, unknown>
  status: DataRowStatus
  lastRunId?: string
  lastRunAt?: string
  retryCount: number
  tags?: string[]
  organizationId?: number
  createdAt?: string
  updatedAt?: string
}
