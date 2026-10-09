/** A complete catalog is reused for 60 seconds; existing runs keep their reference. */
export class ActionResultCatalogCache<T> {
  private cached: { value: T; loadedAt: number } | undefined
  private pending: Promise<T> | undefined
  private failed: { at: number; error: unknown } | undefined

  constructor(private readonly read: () => Promise<T>, private readonly now = Date.now) {}

  get(): Promise<T> {
    if (this.cached) {
      const age = this.now() - this.cached.loadedAt
      if (age >= 0 && age < 60_000) return Promise.resolve(this.cached.value)
    }
    if (this.pending) return this.pending
    if (this.failed) {
      const age = this.now() - this.failed.at
      if (age >= 0 && age < 60_000) {
        return this.cached ? Promise.resolve(this.cached.value) : Promise.reject(this.failed.error)
      }
    }
    // Share the entire load, including mapping/validation, across concurrent starts.
    // Keep the last complete catalog on failure; retry on demand after 60 seconds.
    this.pending = Promise.resolve().then(this.read).then(value => {
      this.cached = { value, loadedAt: this.now() }
      this.failed = undefined
      return value
    }).catch(error => {
      this.failed = { at: this.now(), error }
      if (this.cached) return this.cached.value
      throw error
    }).finally(() => { this.pending = undefined })
    return this.pending
  }
}
