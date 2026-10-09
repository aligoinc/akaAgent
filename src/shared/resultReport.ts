export type StoredReportGroup = 'success' | 'failure' | 'skipped' | 'pending'
const groups = ['success', 'failure', 'skipped', 'pending'] as const

/** A saved decision wins. No live policy lookup or status-name inference. */
export function storedReportGroup(value: unknown): StoredReportGroup | null {
  return groups.includes(value as StoredReportGroup) ? value as StoredReportGroup : null
}

/** One OR expression is essential: a second PostgREST .or() replaces the first. */
export function resultReportFilter(group: StoredReportGroup | 'all', legacyStatuses: readonly string[], cursor?: string): string {
  const saved = group === 'all' ? 'report_group.in.(success,failure,skipped,pending)' : `report_group.eq.${group}`
  const legacy = legacyStatuses.length ? `,and(report_group.is.null,status.in.(${legacyStatuses.map(s => JSON.stringify(s)).join(',')}))` : ''
  const filter = saved + legacy
  return cursor ? `and(or(${filter}),or(${cursor}))` : filter
}
