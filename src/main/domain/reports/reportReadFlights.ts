/** In-flight only: an explicit reload after completion always performs fresh reads. */
export class ReportReadFlights {
  private readonly flights = new Map<string, Promise<unknown>>()
  /** `max`: số lượt khác nhau chạy cùng lúc của cổng này (mặc định 2 như các báo cáo). */
  constructor(private readonly max = 2) {}
  run<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.flights.get(key)
    if (existing) return existing as Promise<T>
    if (this.flights.size >= this.max) return Promise.reject(new Error('Đang tải báo cáo khác. Vui lòng thử lại sau vài giây.'))
    const flight = Promise.resolve().then(load).finally(() => this.flights.delete(key))
    this.flights.set(key, flight)
    return flight
  }
}
export function reportFlightKey(kind: string, scope: unknown, query: object): string {
  return JSON.stringify([kind, scope, Object.fromEntries(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value]))])
}
