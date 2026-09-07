import { randomUUID } from 'node:crypto'
import type { ProcessAuthCredentials } from '../data/currentUser'
import type { DeviceIdentity } from './deviceIdentity'

export const DEVICE_HEARTBEAT_INTERVAL_MS = 30_000
export const DEVICE_HEARTBEAT_TIMEOUT_MS = 5_000

interface PresenceSession {
  instanceId: string
  credentials: ProcessAuthCredentials
  initialHeartbeatPending: boolean
}

/** Observational service. There are deliberately no auth/runtime action callbacks. */
export class PassiveDevicePresence {
  private session: PresenceSession | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> | null = null
  private lastDiagnosticAt = -Infinity

  constructor(private readonly options: {
    getDevice: () => Promise<DeviceIdentity & { appVersion: string }>
    send: (args: Record<string, unknown>, signal: AbortSignal) => Promise<void>
    warn: () => void
    now?: () => number
  }) {}

  start(credentials: ProcessAuthCredentials): void {
    this.stop()
    this.session = { instanceId: randomUUID(), credentials: { ...credentials }, initialHeartbeatPending: true }
    this.timer = setInterval(() => this.heartbeat(), DEVICE_HEARTBEAT_INTERVAL_MS)
    this.timer.unref?.()
    this.heartbeat()
  }

  updateCredentials(credentials: ProcessAuthCredentials): void {
    if (this.session?.credentials.username === credentials.username) this.session.credentials = { ...credentials }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const session = this.session
    this.session = null
    if (session) this.enqueueEnd(session)
  }

  heartbeat(): void {
    if (!this.session || this.inFlight) return
    this.session.initialHeartbeatPending = false
    this.track(this.transmit(this.session, false))
  }

  private enqueueEnd(session: PresenceSession): void {
    const preceding = this.inFlight
    // Serialize ending with any registration already in flight. Never await
    // this from logout/quit, and never let an old completion clear a new timer.
    this.track((async () => {
      await preceding
      await this.transmit(session, true)
    })())
  }

  private track(operation: Promise<void>): void {
    const tracked = operation.finally(() => {
      if (this.inFlight !== tracked) return
      this.inFlight = null
      // A new login may have waited behind the previous session's end. Send
      // its first heartbeat now, but never retry a failed heartbeat eagerly
      // or register a session that has since been stopped/replaced.
      if (this.session?.initialHeartbeatPending) this.heartbeat()
    })
    this.inFlight = tracked
  }

  private async transmit(session: PresenceSession, ended: boolean): Promise<void> {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('Presence timeout'))
        }, DEVICE_HEARTBEAT_TIMEOUT_MS)
        timeout.unref?.()
      })
      await Promise.race([deadline, (async () => {
        const device = await this.options.getDevice()
        if (controller.signal.aborted) return
        await this.options.send({
          p_username: session.credentials.username, p_password: session.credentials.password,
          p_instance_id: session.instanceId, p_device: device, p_ended: ended
        }, controller.signal)
      })()])
    } catch {
      const now = (this.options.now ?? Date.now)()
      if (now - this.lastDiagnosticAt >= 300_000) {
        this.lastDiagnosticAt = now
        this.options.warn()
      }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}
