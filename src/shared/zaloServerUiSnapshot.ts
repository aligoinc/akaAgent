import type { ZaloServerSnapshot } from './zaloServerProtocol'

/** Periodic clock/client/log counters are not database invalidations. */
export function zaloServerUiSnapshotKey(snapshot: ZaloServerSnapshot, staffId?: number, organizationId?: number): string {
  const staff = snapshot.staffs.find(row => row.staffId === staffId && row.organizationId === organizationId)
  return JSON.stringify([snapshot.state, snapshot.startedAt, staff?.staffId, staff?.organizationId,
    staff?.state, staff?.startedAt, staff?.lastError])
}
