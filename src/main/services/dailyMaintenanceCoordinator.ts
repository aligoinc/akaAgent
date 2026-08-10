export type DailyMaintenanceTask = (dateKey: string) => Promise<unknown>

export interface DailyMaintenanceClock {
  dbNow: string
  vietnamDateKey: string
  nextVietnamMidnight: string
}

export interface DailyMaintenanceCoordinatorOptions {
  loadClock: () => Promise<DailyMaintenanceClock>
  scopeKey?: () => string
  /**
   * Optional cross-runtime barrier which must be satisfied before schedule
   * maintenance starts for a Vietnam date. Keep this hook DB-backed: this
   * coordinator is also entered from a scheduler tick, so waiting for that
   * scheduler itself to become idle would deadlock the tick.
   *
   * A rejected hook deliberately leaves the date unready. The next caller can
   * retry after old-day runtime claims have drained.
   */
  beforeMaintenance?: (dateKey: string, signal: AbortSignal) => Promise<unknown>
}

export interface DailyMaintenanceBarrier {
  ensureReady(): Promise<DailyMaintenanceClock>
  /**
   * Marks a completed result stale when ownership/scope changes and a full
   * maintenance pass must be requested explicitly.
   */
  invalidate(): void
  /** Abort only a pending gate wait so shutdown recovery can become idle. */
  cancelPending(): void
}

export interface DailyMaintenanceGateSnapshot {
  ready: boolean
  runningCampaignCount: number
  vietnamDateKey: string
}

/**
 * Keep the new-day dispatch barrier closed while a target claimed on the old
 * Vietnam day is still settling. The check is DB-backed so Desktop and App
 * Server observe the same state; there is intentionally no host-clock or
 * timeout fallback that could let maintenance skip a late campaign.
 */
export async function waitForDailyMaintenanceGate(
  dateKey: string,
  check: () => Promise<DailyMaintenanceGateSnapshot>,
  options: {
    pollIntervalMs?: number
    onWaiting?: (runningCampaignCount: number) => void
    signal?: AbortSignal
  } = {}
): Promise<void> {
  const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 2_000)
  let waitingReported = false
  while (true) {
    throwIfMaintenanceAborted(options.signal)
    const snapshot = await check()
    throwIfMaintenanceAborted(options.signal)
    if (snapshot.vietnamDateKey !== dateKey) {
      throw new Error(
        `Daily maintenance date changed while waiting (${dateKey} -> ${snapshot.vietnamDateKey})`
      )
    }
    if (snapshot.ready) return
    if (snapshot.runningCampaignCount <= 0) {
      throw new Error('Daily maintenance gate is closed without an active old-day campaign')
    }
    if (!waitingReported) {
      waitingReported = true
      options.onWaiting?.(snapshot.runningCampaignCount)
    }
    await waitForMaintenancePoll(pollIntervalMs, options.signal)
  }
}

function throwIfMaintenanceAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Daily maintenance wait was cancelled')
  error.name = 'AbortError'
  throw error
}

function waitForMaintenancePoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(resolve => setTimeout(resolve, delayMs))
  throwIfMaintenanceAborted(signal)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      const error = new Error('Daily maintenance wait was cancelled')
      error.name = 'AbortError'
      reject(error)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Serializes the once-per-Vietnam-day maintenance step for every scheduler
 * sharing this instance. Callers are released only after maintenance succeeds.
 * A failed run is deliberately not marked ready so the next caller can retry.
 */
export class DailyMaintenanceCoordinator implements DailyMaintenanceBarrier {
  private readonly runMaintenance: DailyMaintenanceTask
  private readonly loadClock: () => Promise<DailyMaintenanceClock>
  private readonly scopeKey: () => string
  private readonly beforeMaintenance?: (dateKey: string, signal: AbortSignal) => Promise<unknown>
  private completedRunKey: string | null = null
  private inFlight: Promise<void> | null = null
  private inFlightAbort: AbortController | null = null
  private generation = 0

  constructor(runMaintenance: DailyMaintenanceTask, options: DailyMaintenanceCoordinatorOptions) {
    this.runMaintenance = runMaintenance
    this.loadClock = options.loadClock
    this.scopeKey = options.scopeKey || (() => 'default')
    this.beforeMaintenance = options.beforeMaintenance
  }

  async ensureReady(): Promise<DailyMaintenanceClock> {
    while (true) {
      const clock = await this.loadClock()
      const dateKey = clock.vietnamDateKey
      const runKey = `${this.scopeKey()}::${dateKey}`
      if (this.completedRunKey === runKey) return clock

      if (!this.inFlight) {
        const abort = new AbortController()
        this.inFlightAbort = abort
        this.inFlight = this.runForDate(dateKey, runKey, this.generation, abort.signal)
      }

      await this.inFlight

      // Midnight can pass while maintenance is running. Re-check the Vietnam
      // date before releasing the caller so discovery never crosses an
      // unmaintained day boundary.
      const currentClock = await this.loadClock()
      const currentRunKey = `${this.scopeKey()}::${currentClock.vietnamDateKey}`
      if (this.completedRunKey === currentRunKey) return currentClock
    }
  }

  invalidate(): void {
    this.generation += 1
    this.completedRunKey = null
  }

  cancelPending(): void {
    this.generation += 1
    this.completedRunKey = null
    this.inFlightAbort?.abort()
  }

  private async runForDate(
    dateKey: string,
    runKey: string,
    generation: number,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await this.beforeMaintenance?.(dateKey, signal)
      throwIfMaintenanceAborted(signal)
      await this.runMaintenance(dateKey)
      if (this.generation === generation && `${this.scopeKey()}::${dateKey}` === runKey) {
        this.completedRunKey = runKey
      }
    } finally {
      this.inFlight = null
      this.inFlightAbort = null
    }
  }
}
