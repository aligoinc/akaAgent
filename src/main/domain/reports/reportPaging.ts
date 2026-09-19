/** PostgREST report paging. Keep timestamps as returned by PostgreSQL (microseconds). */
export interface ReportCursorRow { id: number; created_at?: unknown; campaign_id?: unknown }
export interface PendingReportPartition { campaignIds: number[]; fallbackCampaignIds: number[] }

function integer(value: unknown): string {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Invalid report cursor ID')
  return String(n)
}
export function completedReportCursor(row: ReportCursorRow): string {
  const stamp = String(row.created_at || '')
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp)) {
    throw new Error('Invalid report cursor timestamp')
  }
  const value = JSON.stringify(stamp)
  return `created_at.lt.${value},and(created_at.eq.${value},id.lt.${integer(row.id)})`
}
export function pendingReportPartitions(
  campaigns: Array<{ id: number; schedule: unknown }>, startIso: string, endIso: string,
): PendingReportPartition[] {
  const start = Date.parse(startIso), end = Date.parse(endIso)
  const sorted = [...campaigns].sort((a, b) => a.id - b.id)
  const result: PendingReportPartition[] = []
  for (let i = 0; i < sorted.length; i += 200) {
    const batch = sorted.slice(i, i + 200)
    result.push({
      campaignIds: batch.map(row => Number(integer(row.id))),
      fallbackCampaignIds: batch.filter(row => {
        const stamp = Date.parse(String(row.schedule || ''))
        return stamp >= start && stamp < end
      }).map(row => row.id),
    })
  }
  return result
}
export function pendingReportFilter(
  partition: PendingReportPartition, startIso: string, endIso: string,
  after?: ReportCursorRow,
): string {
  const date = `and(schedule.gte.${JSON.stringify(startIso)},schedule.lt.${JSON.stringify(endIso)})`
  const branches = [date]
  if (partition.fallbackCampaignIds.length) {
    branches.push(`and(schedule.is.null,campaign_id.in.(${partition.fallbackCampaignIds.map(integer).join(',')}))`)
  }
  if (!after) return branches.join(',')
  const campaign = integer(after.campaign_id), id = integer(after.id)
  // One outer OR: PostgREST builders replace, rather than combine, repeated .or().
  return `and(or(${branches.join(',')}),or(campaign_id.gt.${campaign},and(campaign_id.eq.${campaign},id.gt.${id})))`
}

export interface PendingPageRequest {
  head: boolean
  offset: number
  limit: number
  after?: ReportCursorRow
}
/** Stable campaign_id/id order lets whole partitions be skipped using DB counts. */
export async function readPendingReportPage<T extends ReportCursorRow>(
  partitions: PendingReportPartition[],
  offset: number,
  limit: number,
  exportAll: boolean,
  read: (partition: PendingReportPartition, page: PendingPageRequest) => Promise<{ rows: T[]; count: number | null }>,
): Promise<{ rows: T[]; total: number }> {
  const rows: T[] = []
  if (exportAll) {
    for (const partition of partitions) {
      let after: T | undefined
      for (;;) {
        const page = await read(partition, { head: false, offset: 0, limit: 1000, after })
        rows.push(...page.rows)
        if (page.rows.length < 1000) break
        const last = page.rows[page.rows.length - 1]
        if (after && Number(last.campaign_id) === Number(after.campaign_id) && last.id <= after.id) {
          throw new Error('Report export cursor did not advance')
        }
        after = last
      }
    }
    return { rows, total: rows.length }
  }
  const counts: number[] = []
  for (const partition of partitions) {
    const result = await read(partition, { head: true, offset: 0, limit: 0 })
    if (result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) {
      throw new Error('Report count is unavailable')
    }
    counts.push(result.count)
  }
  const total = counts.reduce((sum, count) => sum + count, 0)
  let skip = offset
  for (let i = 0; i < partitions.length && rows.length < limit; i++) {
    if (skip >= counts[i]) { skip -= counts[i]; continue }
    const take = Math.min(limit - rows.length, counts[i] - skip)
    const result = await read(partitions[i], { head: false, offset: skip, limit: take })
    rows.push(...result.rows)
    skip = 0
  }
  return { rows, total }
}
