import type { WebEnrichmentConfig } from '../../shared/facebookWebEnrichment'

export interface WebSlot { key: string; start: number; expires: number }
/** Only RAM. Start at the first available opportunity inside the slot's 30-minute window. */
export class WebEnrichmentPlanner {
  private day = ''
  private revision = -1
  private seen = new Set<string>()
  private pending?: WebSlot
  private suppressThrough = 0
  private interval?: { start: number; end: number }

  /** Reconsider only an unused pending slot; started/skipped slots stay consumed. */
  configurationChanged(): void {
    if (this.pending) this.seen.delete(this.pending.key)
    this.pending = undefined
  }
  discardThrough(now: number): void { this.suppressThrough = Math.max(this.suppressThrough, now); this.pending = undefined }
  started(now: number): void { this.interval = { start: now, end: Infinity }; this.pending = undefined }
  finished(now: number): void { if (this.interval) this.interval.end = now }
  observe(c: WebEnrichmentConfig, now: number, date: string, midnight: number): WebSlot | undefined {
    if (this.day !== date) { this.day = date; this.seen.clear(); this.pending = undefined }
    if (this.revision !== c.revision) {
      if (this.revision >= 0) this.configurationChanged()
      this.revision = c.revision
    }
    if (c.stopDate && date > c.stopDate) { this.pending = undefined; return }
    if (this.pending && now >= this.pending.expires) this.pending = undefined
    const slots = c.slots.map(key => ({ key, start: Date.parse(`${date}T${key}:00+07:00`) }))
    for (let i = 0; i < slots.length; i++) {
      const { key, start } = slots[i]
      if (start > now || this.seen.has(key)) continue
      this.seen.add(key)
      const expires = Math.min(start + 30 * 60_000, slots[i + 1]?.start ?? midnight)
      const overlapped = this.interval && start >= this.interval.start && start < this.interval.end
      if (overlapped || start <= this.suppressThrough || now >= expires) continue
      this.pending = { key, start, expires }
    }
    return this.pending
  }
}
