import { getSupabaseClient } from '../supabaseClient'
import { performance } from 'node:perf_hooks'

const VIETNAM_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATABASE_CLOCK_MAX_AGE_MS = 10 * 60 * 1000

export interface DatabaseRuntimeClock {
  dbNow: string
  vietnamDateKey: string
  nextVietnamMidnight: string
}

interface DatabaseRuntimeClockAnchor {
  dbEpochMs: number
  monotonicAtSyncMs: number
  vietnamDateKey: string
  nextVietnamMidnightMs: number
}

interface LoadedDatabaseRuntimeClock {
  clock: DatabaseRuntimeClock
  monotonicAtSyncMs: number
}

let clockAnchor: DatabaseRuntimeClockAnchor | null = null
let inFlightClock: Promise<DatabaseRuntimeClock> | null = null
let clockGeneration = 0

function parseTimestamp(value: unknown, field: string): string {
  const timestamp = String(value || '').trim()
  if (!timestamp || !Number.isFinite(new Date(timestamp).getTime())) {
    throw new Error(`DB runtime clock returned an invalid ${field}`)
  }
  return timestamp
}

export function parseDatabaseRuntimeClock(row: unknown): DatabaseRuntimeClock {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('DB runtime clock returned an invalid payload')
  }

  const record = row as Record<string, unknown>
  const vietnamDateKey = String(record.vietnam_date_key || '').trim()
  if (!VIETNAM_DATE_KEY_PATTERN.test(vietnamDateKey)) {
    throw new Error('DB runtime clock returned an invalid Vietnam date key')
  }

  return {
    dbNow: parseTimestamp(record.db_now, 'db_now'),
    vietnamDateKey,
    nextVietnamMidnight: parseTimestamp(
      record.next_vietnam_midnight,
      'next_vietnam_midnight'
    )
  }
}

function createClockAnchor(
  clock: DatabaseRuntimeClock,
  monotonicAtSyncMs: number
): DatabaseRuntimeClockAnchor {
  const dbEpochMs = new Date(clock.dbNow).getTime()
  const nextVietnamMidnightMs = new Date(clock.nextVietnamMidnight).getTime()
  if (
    !Number.isFinite(dbEpochMs) ||
    !Number.isFinite(nextVietnamMidnightMs) ||
    nextVietnamMidnightMs <= dbEpochMs
  ) {
    throw new Error('DB runtime clock returned inconsistent time boundaries')
  }

  return {
    dbEpochMs,
    monotonicAtSyncMs,
    vietnamDateKey: clock.vietnamDateKey,
    nextVietnamMidnightMs
  }
}

function snapshotFromAnchor(
  anchor: DatabaseRuntimeClockAnchor,
  monotonicNowMs: number
): DatabaseRuntimeClock | null {
  const elapsedMs = monotonicNowMs - anchor.monotonicAtSyncMs
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= DATABASE_CLOCK_MAX_AGE_MS) {
    return null
  }

  const dbNowMs = anchor.dbEpochMs + elapsedMs
  if (dbNowMs >= anchor.nextVietnamMidnightMs) return null

  return {
    dbNow: new Date(dbNowMs).toISOString(),
    vietnamDateKey: anchor.vietnamDateKey,
    nextVietnamMidnight: new Date(anchor.nextVietnamMidnightMs).toISOString()
  }
}

async function loadDatabaseRuntimeClock(): Promise<LoadedDatabaseRuntimeClock> {
  const monotonicBeforeRequestMs = performance.now()
  const { data, error } = await getSupabaseClient().rpc('aka_agent_get_runtime_clock')
  const monotonicAfterRequestMs = performance.now()
  if (error) {
    throw new Error(
      `Failed to load DB runtime clock: ${error.message}. Ensure migration v223 is applied.`
    )
  }

  const row = Array.isArray(data) ? data[0] : data
  return {
    clock: parseDatabaseRuntimeClock(row),
    // The DB statement executes somewhere inside the request round trip. Its
    // midpoint is the lowest-error anchor available without trusting wall time.
    monotonicAtSyncMs: monotonicBeforeRequestMs +
      (monotonicAfterRequestMs - monotonicBeforeRequestMs) / 2
  }
}

/**
 * Returns an authoritative DB-synchronized clock. A successful RPC establishes
 * an epoch anchor; subsequent callers advance it with Node's monotonic clock.
 * The anchor is refreshed lazily after ten minutes or exactly at the Vietnam
 * day boundary. Concurrent refreshes share one in-flight RPC.
 */
export function getDatabaseRuntimeClock(): Promise<DatabaseRuntimeClock> {
  const cached = clockAnchor && snapshotFromAnchor(clockAnchor, performance.now())
  if (cached) return Promise.resolve(cached)
  if (inFlightClock) return inFlightClock

  const loadGeneration = clockGeneration
  const request = loadDatabaseRuntimeClock().then(loaded => {
    if (clockGeneration !== loadGeneration) {
      throw new Error('DB runtime clock was invalidated while refreshing')
    }
    const anchor = createClockAnchor(loaded.clock, loaded.monotonicAtSyncMs)
    clockAnchor = anchor
    const snapshot = snapshotFromAnchor(anchor, performance.now())
    if (!snapshot) throw new Error('DB runtime clock expired immediately after refresh')
    return snapshot
  }).finally(() => {
    if (inFlightClock === request) inFlightClock = null
  })
  inFlightClock = request

  return inFlightClock
}

/**
 * Discards both the monotonic anchor and any pre-resume refresh. The next clock
 * request must establish a new DB epoch before business work can continue.
 */
export function invalidateDatabaseRuntimeClock(): void {
  clockGeneration += 1
  clockAnchor = null
  inFlightClock = null
}
