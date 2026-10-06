import type { BrowserWindow } from 'electron'
import { ZALO_SERVER_IPC, type ZaloServerRuntimeEvent, type ZaloServerSnapshot } from '../../shared/zaloServerProtocol'

const UPDATE_INTERVAL_MS = 250
const MAX_PENDING_EVENTS = 1_000

/** Presentation only: never delays gateway events, scheduler work or file logs. */
export class ZaloServerAdminUpdates {
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly events = new Map<number, ZaloServerRuntimeEvent>()
  private snapshotDirty = false
  private resync = true
  private visible: boolean | undefined
  private disposed = false

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly snapshot: (includeEvents: boolean) => ZaloServerSnapshot | undefined
  ) {}

  private canDisplay(): boolean {
    const window = this.window()
    return !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized() &&
      !window.webContents.isDestroyed()
  }

  visibilityChanged(force = false): void {
    if (this.disposed) return
    const visible = this.canDisplay()
    if (!force && this.visible === visible) return
    this.visible = visible
    this.send(ZALO_SERVER_IPC.VISIBILITY_UPDATED, visible)
    if (!visible) {
      this.cancelTimer()
      this.events.clear()
      this.resync = true
      return
    }
    // Recover the existing bounded history once after hiding/reloading.
    this.resync = true
    this.requestSnapshot()
  }

  pushEvent(event: ZaloServerRuntimeEvent): void {
    if (this.disposed || !this.canDisplay()) return
    this.events.set(event.sequence, event)
    if (this.events.size > MAX_PENDING_EVENTS) this.events.delete(this.events.keys().next().value!)
    this.schedule()
  }

  requestSnapshot(): void {
    if (this.disposed) return
    this.snapshotDirty = true
    this.schedule()
  }

  clearThrough(sequence: number): void {
    for (const key of this.events.keys()) if (key <= sequence) this.events.delete(key)
  }

  private schedule(): void {
    if (this.timer || !this.canDisplay()) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, UPDATE_INTERVAL_MS)
  }

  private flush(): void {
    if (this.disposed || !this.canDisplay()) {
      this.events.clear()
      this.resync = true
      return
    }
    if (this.snapshotDirty || this.resync) {
      const snapshot = this.snapshot(this.resync)
      if (snapshot) {
        this.send(ZALO_SERVER_IPC.SNAPSHOT_UPDATED, snapshot)
        this.snapshotDirty = false
        this.resync = false
      }
    }
    if (this.events.size) {
      this.send(ZALO_SERVER_IPC.RUNTIME_EVENT, Array.from(this.events.values()))
      this.events.clear()
    }
  }

  private send(channel: string, payload: unknown): void {
    const window = this.window()
    try {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    } catch {
      // A closing/reloading admin window must not affect the runtime.
    }
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  dispose(): void {
    this.disposed = true
    this.cancelTimer()
    this.events.clear()
  }
}
