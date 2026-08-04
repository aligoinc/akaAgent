export type DailyMaintenanceTask = (dateKey: string) => Promise<unknown>

export interface DailyMaintenanceClock {
  dbNow: string
  vietnamDateKey: string
  nextVietnamMidnight: string
}

export interface DailyMaintenanceCoordinatorOptions {
  loadClock: () => Promise<DailyMaintenanceClock>
  scopeKey?: () => string
}

export interface DailyMaintenanceBarrier {
  ensureReady(): Promise<DailyMaintenanceClock>
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
  private completedRunKey: string | null = null
  private inFlight: Promise<void> | null = null
  private generation = 0

  constructor(runMaintenance: DailyMaintenanceTask, options: DailyMaintenanceCoordinatorOptions) {
    this.runMaintenance = runMaintenance
    this.loadClock = options.loadClock
    this.scopeKey = options.scopeKey || (() => 'default')
  }

  async ensureReady(): Promise<DailyMaintenanceClock> {
    while (true) {
      const clock = await this.loadClock()
      const dateKey = clock.vietnamDateKey
      const runKey = `${this.scopeKey()}::${dateKey}`
      if (this.completedRunKey === runKey) return clock

      if (!this.inFlight) {
        this.inFlight = this.runForDate(dateKey, runKey, this.generation)
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

  private async runForDate(dateKey: string, runKey: string, generation: number): Promise<void> {
    try {
      await this.runMaintenance(dateKey)
      if (this.generation === generation && `${this.scopeKey()}::${dateKey}` === runKey) {
        this.completedRunKey = runKey
      }
    } finally {
      this.inFlight = null
    }
  }
}
