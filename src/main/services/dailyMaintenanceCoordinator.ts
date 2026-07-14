const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

export type DailyMaintenanceTask = (dateKey: string) => Promise<unknown>

export interface DailyMaintenanceCoordinatorOptions {
  now?: () => Date
  scopeKey?: () => string
}

export interface DailyMaintenanceBarrier {
  ensureReady(): Promise<void>
}

export function getVietnamMaintenanceDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

/**
 * Serializes the once-per-Vietnam-day maintenance step for every scheduler
 * sharing this instance. Callers are released only after maintenance succeeds.
 * A failed run is deliberately not marked ready so the next caller can retry.
 */
export class DailyMaintenanceCoordinator implements DailyMaintenanceBarrier {
  private readonly runMaintenance: DailyMaintenanceTask
  private readonly now: () => Date
  private readonly scopeKey: () => string
  private completedRunKey: string | null = null
  private inFlight: Promise<void> | null = null
  private generation = 0

  constructor(runMaintenance: DailyMaintenanceTask, options: DailyMaintenanceCoordinatorOptions = {}) {
    this.runMaintenance = runMaintenance
    this.now = options.now || (() => new Date())
    this.scopeKey = options.scopeKey || (() => 'default')
  }

  async ensureReady(): Promise<void> {
    while (true) {
      const dateKey = getVietnamMaintenanceDateKey(this.now())
      const runKey = `${this.scopeKey()}::${dateKey}`
      if (this.completedRunKey === runKey) return

      if (!this.inFlight) {
        this.inFlight = this.runForDate(dateKey, runKey, this.generation)
      }

      await this.inFlight

      // Midnight can pass while maintenance is running. Re-check the Vietnam
      // date before releasing the caller so discovery never crosses an
      // unmaintained day boundary.
      const currentRunKey = `${this.scopeKey()}::${getVietnamMaintenanceDateKey(this.now())}`
      if (this.completedRunKey === currentRunKey) return
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
