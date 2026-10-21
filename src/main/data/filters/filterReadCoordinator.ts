/** Bounded read work, independent of Electron so cancellation can be verified. */
export interface FilterReadPolicy { concurrency: number; pending: number; deadlineMs: number; serverBudgetMs: number }
export const FILTER_READ_POLICY: FilterReadPolicy = { concurrency: 2, pending: 8, deadlineMs: 65000, serverBudgetMs: 60000 }
/** A transport deadline cannot confirm that the remote database has stopped. */
export class FilterTransportTimeoutError extends Error {}

interface Job {
  key: string; requestId: string; controller: AbortController; startedAt: number; unconfirmedAt: number
  run: (signal: AbortSignal) => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>; settled: boolean; active: boolean
}
export class FilterReadCoordinator {
  private jobs = new Map<string, Job>()
  private queue: Job[] = []
  private active = 0
  constructor(private readonly policy: FilterReadPolicy = FILTER_READ_POLICY) {}

  read<T>(key: string, requestId: string, run: (signal: AbortSignal) => Promise<T>, deadlineMs = this.policy.deadlineMs): Promise<T> {
    if (!key || !requestId || key.length > 180 || requestId.length > 100) return Promise.reject(new Error('Mã lượt lọc không hợp lệ.'))
    this.cancel(key)
    if (this.queue.length >= this.policy.pending) return Promise.reject(new Error('Đang có nhiều yêu cầu đọc dữ liệu. Vui lòng thử lại.'))
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        key, requestId, controller: new AbortController(), startedAt: 0, unconfirmedAt: 0, run,
        resolve: value => resolve(value as T), reject, settled: false, active: false,
        timer: setTimeout(() => this.stop(job, 'Truy vấn lọc quá thời gian chờ. Hãy thu hẹp điều kiện rồi thử lại.'), Math.min(65000, Math.max(1, deadlineMs)))
      }
      this.jobs.set(key, job); this.queue.push(job); this.pump()
    })
  }

  cancel(key: string, requestId?: string): void {
    const job = this.jobs.get(key)
    if (job && (!requestId || requestId === job.requestId)) this.stop(job, 'Đã hủy lượt lọc dữ liệu.')
  }

  cancelOwner(owner: string): void {
    for (const [key, job] of this.jobs) if (key.startsWith(`${owner}:`)) this.stop(job, 'Đã đóng phiên đọc dữ liệu.')
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) this.stop(job, 'Phiên đăng nhập đã thay đổi.')
  }

  private finish(job: Job, error?: Error, value?: unknown): void {
    if (job.settled) return
    job.settled = true; clearTimeout(job.timer)
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key)
    if (error) job.reject(error); else job.resolve(value)
  }

  private stop(job: Job, message: string): void {
    if (job.settled) return
    job.controller.abort(); this.finish(job, new Error(message))
    this.queue = this.queue.filter(item => item !== job)
    this.pump()
  }

  private pump(): void {
    while (this.active < this.policy.concurrency && this.queue.length) {
      const job = this.queue.shift()!
      if (job.settled) continue
      job.active = true; job.startedAt = Date.now(); this.active++
      void this.execute(job)
    }
  }

  private async execute(job: Job): Promise<void> {
    try {
      const value = await job.run(job.controller.signal)
      if (!job.controller.signal.aborted) this.finish(job, undefined, value)
    } catch (error) {
      if (error instanceof FilterTransportTimeoutError) {
        job.unconfirmedAt = Date.now()
        job.controller.abort()
      }
      this.finish(job, error instanceof Error ? error : new Error('Không thể đọc dữ liệu đã lọc.'))
    } finally {
      // run() must wait for real completion: HTTP response or local child close.
      // Logical cancellation only fences results. Transport failure cannot prove
      // PostgreSQL stopped, so retain its server budget in that case alone.
      if (job.unconfirmedAt) {
        const remaining = this.policy.serverBudgetMs - (Date.now() - job.unconfirmedAt)
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
      }
      this.active--; this.pump()
    }
  }
}
