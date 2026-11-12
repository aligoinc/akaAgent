/**
 * Báo kết quả về DB: ghi nhật ký trên máy TRƯỚC, rồi gọi report_v1; DB/mạng/Supabase lỗi tạm thời thì
 * chờ có backoff và thử lại (không đổi trạng thái chiến dịch). Gửi bù idempotent theo result_key.
 */
import type {
  BatchReportItem, BatchReportResponse, CallOptions, EngineClock, EngineDataPort, EngineEvents, LocalJournal, ReportOutcome, ReportResponse
} from './contracts.js'
import { CancelledError, errorMessage, isTransientDbError, withDeadline } from './boundary.js'
import { journalId } from './journal.js'

export interface RetryPolicy {
  /** Hạn giờ mỗi lời gọi DB. */
  callTimeoutMs: number
  /** Nghỉ giữa các lần thử khi DB lỗi tạm thời; lần sau dùng phần tử cuối. */
  backoffMs: readonly number[]
}

export const DEFAULT_RETRY: RetryPolicy = { callTimeoutMs: 20_000, backoffMs: [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] }

export interface OutageHandler {
  /** Gọi ở mỗi lần thử thất bại do DB lỗi tạm thời. */
  onOutage(label: string, attempt: number, err: unknown): void
  /** Gọi khi gọi được DB trở lại sau ít nhất một lần lỗi. */
  onRecovered(label: string, attempts: number): void
}

/**
 * Gọi DB tới khi có câu trả lời. Lỗi tạm thời: chờ và thử lại; lỗi khác: ném ra; bị huỷ: ném CancelledError.
 */
export async function callUntilAvailable<T>(label: string, fn: (opts: CallOptions) => Promise<T>,
  clock: EngineClock, retry: RetryPolicy, signal: AbortSignal, outage?: OutageHandler): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new CancelledError(label)
    try {
      const result = await withDeadline(label, retry.callTimeoutMs, signal, s => fn({ signal: s, timeoutMs: retry.callTimeoutMs }))
      if (attempt > 0) outage?.onRecovered(label, attempt)
      return result
    } catch (err) {
      if (err instanceof CancelledError || signal.aborted) throw new CancelledError(label)
      if (!isTransientDbError(err)) throw err
      outage?.onOutage(label, attempt + 1, err)
      const wait = retry.backoffMs[Math.min(attempt, retry.backoffMs.length - 1)] ?? 1_000
      if (!(await clock.sleep(wait, signal))) throw new CancelledError(label)
    }
  }
}

export interface ReporterDeps { data: EngineDataPort; journal: LocalJournal; clock: EngineClock; events: EngineEvents }

export class OutcomeReporter {
  constructor(private readonly deps: ReporterDeps, private readonly retry: RetryPolicy, private readonly outage?: OutageHandler) {}

  /** Ghi nhật ký rồi gửi; chờ tới khi DB trả lời. Bị huỷ giữa chừng thì kết quả còn trong nhật ký để gửi bù. */
  async report(targetRunId: number, leaseToken: string, outcomes: ReportOutcome[], final: boolean, signal: AbortSignal): Promise<ReportResponse> {
    const id = journalId(targetRunId, outcomes.map(o => o.resultKey), final)
    await this.deps.journal.append({ id, targetRunId, leaseToken, outcomes, final, createdAt: this.deps.clock.now(), attempts: 0 })
    const response = await callUntilAvailable('report', opts => this.deps.data.report(targetRunId, leaseToken, outcomes, final, opts),
      this.deps.clock, this.retry, signal, this.outage)
    await this.deps.journal.remove(id)
    if (!response.ok) this.deps.events.trace({ type: 'report_rejected', targetRunId, reason: response.reason, resultKeys: outcomes.map(o => o.resultKey) })
    return response
  }

  /**
   * Báo cả lô gửi dạng chia sẻ (report_batch_v1): ghi nhật ký từng data trước (chốt data), rồi gửi cả lô, chờ tới khi DB trả lời.
   * Bị huỷ giữa chừng thì từng data còn trong nhật ký và được gửi bù riêng (report_v1, chính sách áp đủ). Lô bị từ chối thì giữ
   * nhật ký: lần sau gửi bù từng data, data hợp lệ vẫn được ghi.
   */
  async reportBatch(leaseToken: string, items: BatchReportItem[], batchSize: number, alreadyStopped: boolean,
    signal: AbortSignal): Promise<BatchReportResponse> {
    const reportBatch = this.deps.data.reportBatch
    if (!reportBatch) throw new Error('Nơi chạy chưa hỗ trợ báo cả lô (report_batch_v1)')
    const ids = items.map(item => journalId(item.targetRunId, item.outcomes.map(o => o.resultKey), true))
    for (const [index, item] of items.entries()) {
      await this.deps.journal.append({ id: ids[index]!, targetRunId: item.targetRunId, leaseToken, outcomes: item.outcomes, final: true,
        createdAt: this.deps.clock.now(), attempts: 0 })
    }
    const response = await callUntilAvailable('report_batch', opts => reportBatch(leaseToken, items, batchSize, alreadyStopped, opts),
      this.deps.clock, this.retry, signal, this.outage)
    if (response.ok) {
      for (const id of ids) await this.deps.journal.remove(id)
    } else {
      this.deps.events.trace({ type: 'report_batch_rejected', reason: response.reason, items: items.map(item => item.targetRunId) })
    }
    return response
  }

  /**
   * Một lần gửi, không chờ DB (dùng khi đang dừng: báo kết quả bị huỷ). Không gửi được thì để trong nhật ký.
   */
  async reportOnce(targetRunId: number, leaseToken: string, outcomes: ReportOutcome[], final: boolean, timeoutMs: number): Promise<ReportResponse | null> {
    const id = journalId(targetRunId, outcomes.map(o => o.resultKey), final)
    await this.deps.journal.append({ id, targetRunId, leaseToken, outcomes, final, createdAt: this.deps.clock.now(), attempts: 0 })
    try {
      const response = await withDeadline('report_once', timeoutMs, undefined,
        s => this.deps.data.report(targetRunId, leaseToken, outcomes, final, { signal: s, timeoutMs }))
      await this.deps.journal.remove(id)
      return response
    } catch (err) {
      this.deps.events.trace({ type: 'report_deferred', targetRunId, error: errorMessage(err) })
      return null
    }
  }

  /** Gửi bù mọi kết quả còn trong nhật ký (khởi động lại, DB sống lại). Trả số lô đã gửi / bị từ chối. */
  async flush(signal: AbortSignal): Promise<{ sent: number; rejected: number }> {
    let sent = 0
    let rejected = 0
    for (const entry of await this.deps.journal.pending()) {
      entry.attempts += 1
      await this.deps.journal.update(entry)
      const response = await callUntilAvailable('report_flush',
        opts => this.deps.data.report(entry.targetRunId, entry.leaseToken, entry.outcomes, entry.final, opts),
        this.deps.clock, this.retry, signal, this.outage)
      await this.deps.journal.remove(entry.id)
      if (response.ok) sent++
      else {
        rejected++
        this.deps.events.trace({ type: 'flush_rejected', targetRunId: entry.targetRunId, reason: response.reason })
      }
    }
    return { sent, rejected }
  }
}
