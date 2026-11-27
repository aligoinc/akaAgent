/**
 * Đo sức khoẻ App Server (27/11/2026). App Server trên VPS có lúc chậm hẳn trong khi DB và các máy khác vẫn bình thường
 * (ghi chú trong CLAUDE.md): ban ngày nó đứng 10–20 giây mỗi khi ổ C: chậm (SQL Server cùng máy đọc nhiều), đêm 27/11 server.log
 * đầy lỗi mở kết nối; từ phía DB không phân biệt được mạng đứt với luồng chính của App Server bị chặn vì chờ đĩa.
 *
 * Mỗi `intervalMs` (mặc định 60 giây) ghi một dòng `[ServerHealth]` vào server.log:
 * - luồng chính: một hẹn giờ 0,5 giây chạy trễ bao lâu (lagP50Ms / lagP99Ms / lagMaxMs) và số lần đứng (stalls, stallMs, stallMaxMs).
 *   Không dùng monitorEventLoopDelay / eventLoopUtilization của Node: trong tiến trình chính của Electron hai số này không thấy lúc
 *   luồng chính bị chặn (đo 27/11/2026 trên Electron 33: chặn 1,5 giây mà lagMax 25 ms, elu 0);
 * - CPU của tiến trình (cpuPct, % của một nhân) và của cả máy (hostCpuPct), CPU từng tiến trình Electron (procCpu);
 * - bộ nhớ (rssMb, heapMb, heapLimitMb, extMb, abMb, hostFreeMb) và dọn rác (gc, gcMs, gcMaxMs, gcMajor, gcMajorMs);
 * - thời gian chờ trong các lệnh ghi đồng bộ: console.* / server.log (log, logMs, logMaxMs, logFileMb) và nhật ký engine SQLite
 *   (journal, journalMs, journalMaxMs);
 * - thời gian từ lúc gửi request HTTP tới lúc có phản hồi, nhìn từ App Server, tách DB với nơi khác (dbReq, dbP50Ms…, otherReq…),
 *   số request lỗi (httpErr) và số lần không mở được kết nối (connErr: hết giờ / bị từ chối, dấu hiệu mạng đứt).
 *
 * Luồng chính đứng từ `stallThresholdMs` (mặc định 2 giây) thì ghi ngay một dòng `[ServerHealth] stall` (tối đa
 * `maxStallLinesPerHour` dòng mỗi giờ; số lần đứng vẫn được đếm đủ trong dòng mỗi phút). Không gọi DB, không đổi hành vi
 * nào khác, mọi lỗi của phần đo đều bị nuốt.
 */
import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { cpus, freemem, totalmem } from 'node:os'
import { PerformanceObserver, constants as perfConstants, createHistogram, performance } from 'node:perf_hooks'
import type { RecordableHistogram } from 'node:perf_hooks'
import { getHeapStatistics } from 'node:v8'

export interface SyncWriteStats {
  count: number
  totalMs: number
  maxMs: number
}

export interface ProcessMetricLike {
  type: string
  cpu?: { percentCPUUsage?: number }
}

export interface ServerHealthSources {
  /** Các lệnh console.* (kèm ghi server.log đồng bộ) từ lần đọc trước; đọc xong là đặt lại. */
  logWrites?: () => SyncWriteStats & { fileBytes?: number | null }
  /** Các lệnh ghi / đọc nhật ký engine SQLite (đồng bộ) từ lần đọc trước; đọc xong là đặt lại. */
  journalWrites?: () => SyncWriteStats
  /** `app.getAppMetrics()` của Electron: CPU từng tiến trình (Browser = tiến trình chính, Renderer, GPU…). */
  appMetrics?: () => ProcessMetricLike[]
}

export interface ServerHealthMonitorOptions {
  intervalMs?: number
  stallThresholdMs?: number
  stallCheckMs?: number
  maxStallLinesPerHour?: number
  log?: (line: string) => void
  sources?: ServerHealthSources
  /** Request tới DB hay nơi khác; mặc định: origin chứa ".supabase.co" là DB. */
  classifyOrigin?: (origin: string) => 'db' | 'other'
}

export interface ServerHealthMonitor {
  stop(): void
  /** Ghi ngay một dòng tổng kết và trả lại dòng đó (bài kiểm dùng). */
  reportNow(): string
}

type HttpKind = 'db' | 'other'

const STALL_LINE_WINDOW_MS = 3_600_000

const roundMs = (value: number): number => Math.round(value)
const toMb = (bytes: number): number => Math.round(bytes / 1_048_576)
const defaultClassifyOrigin = (origin: string): HttpKind => (origin.includes('.supabase.co') ? 'db' : 'other')

function hostCpuSnapshot(): { idle: number; total: number; cores: number } {
  let idle = 0
  let total = 0
  const list = cpus()
  for (const cpu of list) {
    const times = cpu.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total, cores: list.length }
}

function histogramPart(prefix: string, histogram: RecordableHistogram): string[] {
  const count = histogram.count
  if (count === 0) return [`${prefix}Req=0`]
  return [
    `${prefix}Req=${count}`,
    `${prefix}P50Ms=${roundMs(histogram.percentile(50))}`,
    `${prefix}P99Ms=${roundMs(histogram.percentile(99))}`,
    `${prefix}MaxMs=${roundMs(histogram.max)}`
  ]
}

function writePart(prefix: string, stats: SyncWriteStats): string[] {
  return [`${prefix}=${stats.count}`, `${prefix}Ms=${roundMs(stats.totalMs)}`, `${prefix}MaxMs=${roundMs(stats.maxMs)}`]
}

function safely<T>(read: (() => T) | undefined): T | undefined {
  if (!read) return undefined
  try {
    return read()
  } catch {
    return undefined
  }
}

export function startServerHealthMonitor(options: ServerHealthMonitorOptions = {}): ServerHealthMonitor {
  const intervalMs = Math.max(1_000, options.intervalMs ?? 60_000)
  const stallThresholdMs = Math.max(50, options.stallThresholdMs ?? 2_000)
  const stallCheckMs = Math.max(10, options.stallCheckMs ?? 500)
  const maxStallLinesPerHour = Math.max(0, options.maxStallLinesPerHour ?? 60)
  const classifyOrigin = options.classifyOrigin ?? defaultClassifyOrigin
  const sources = options.sources ?? {}
  const emit = (line: string): void => {
    try {
      ;(options.log ?? console.log)(line)
    } catch {
      // Phần đo không bao giờ được làm hỏng App Server.
    }
  }

  // Hẹn giờ stallCheckMs chạy trễ bao lâu (ms): đo được cả trong tiến trình chính của Electron.
  const lagHistogram = createHistogram()

  // Dọn rác.
  const gc = { count: 0, ms: 0, maxMs: 0, major: 0, majorMs: 0 }
  let gcObserver: PerformanceObserver | null = null
  try {
    gcObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const ms = entry.duration
        gc.count += 1
        gc.ms += ms
        if (ms > gc.maxMs) gc.maxMs = ms
        const kind = (entry as { detail?: { kind?: number } }).detail?.kind
        if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) {
          gc.major += 1
          gc.majorMs += ms
        }
      }
    })
    gcObserver.observe({ entryTypes: ['gc'] })
  } catch {
    gcObserver = null
  }

  // Thời gian chờ phản hồi HTTP (fetch dựng sẵn của Node, tức undici), tính từ lúc tạo request tới lúc có phản hồi.
  const httpHistograms: Record<HttpKind, RecordableHistogram> = { db: createHistogram(), other: createHistogram() }
  const httpStarts = new WeakMap<object, { at: number; kind: HttpKind }>()
  let httpErrors = 0
  let connectErrors = 0
  let httpInflight = 0
  const finishRequest = (request: unknown, failed: boolean): void => {
    if (!request || typeof request !== 'object') return
    const started = httpStarts.get(request)
    if (!started) return
    httpStarts.delete(request)
    httpInflight = Math.max(0, httpInflight - 1)
    if (failed) {
      httpErrors += 1
      return
    }
    httpHistograms[started.kind].record(Math.max(1, Math.round(performance.now() - started.at)))
  }
  const onCreate = (message: unknown): void => {
    const request = (message as { request?: { origin?: unknown } } | undefined)?.request
    if (!request || typeof request !== 'object') return
    httpStarts.set(request, { at: performance.now(), kind: classifyOrigin(String(request.origin ?? '')) })
    httpInflight += 1
  }
  const onHeaders = (message: unknown): void => finishRequest((message as { request?: unknown } | undefined)?.request, false)
  const onError = (message: unknown): void => finishRequest((message as { request?: unknown } | undefined)?.request, true)
  const onConnectError = (): void => {
    connectErrors += 1
  }
  const channels: Array<[string, (message: unknown) => void]> = [
    ['undici:request:create', onCreate],
    ['undici:request:headers', onHeaders],
    ['undici:request:error', onError],
    ['undici:client:connectError', onConnectError]
  ]
  const subscribed: Array<[string, (message: unknown) => void]> = []
  for (const [name, handler] of channels) {
    try {
      subscribe(name, handler)
      subscribed.push([name, handler])
    } catch {
      // Không có diagnostics_channel thì chỉ thiếu phần HTTP.
    }
  }

  // Luồng chính đứng: hẹn giờ ngắn, lần chạy trễ hơn ngưỡng là một lần đứng.
  const stalls = { count: 0, ms: 0, maxMs: 0 }
  let stallLineWindowStart = performance.now()
  let stallLinesInWindow = 0
  let lastStallCheck = performance.now()
  const stallTimer = setInterval(() => {
    const now = performance.now()
    const drift = now - lastStallCheck - stallCheckMs
    lastStallCheck = now
    lagHistogram.record(Math.max(1, Math.round(drift)))
    if (drift < stallThresholdMs) return
    stalls.count += 1
    stalls.ms += drift
    if (drift > stalls.maxMs) stalls.maxMs = drift
    if (now - stallLineWindowStart >= STALL_LINE_WINDOW_MS) {
      stallLineWindowStart = now
      stallLinesInWindow = 0
    }
    if (stallLinesInWindow >= maxStallLinesPerHour) return
    stallLinesInWindow += 1
    let memory = ''
    try {
      const usage = process.memoryUsage()
      memory = ` rssMb=${toMb(usage.rss)} heapMb=${toMb(usage.heapUsed)}`
    } catch {
      memory = ''
    }
    emit(`[ServerHealth] stall ms=${roundMs(drift)}${memory} inflight=${httpInflight} gcMaxMs=${roundMs(gc.maxMs)}`)
  }, stallCheckMs)
  stallTimer.unref?.()

  let lastReportAt = performance.now()
  let lastCpu = process.cpuUsage()
  let lastHost = hostCpuSnapshot()
  // Lần gọi đầu của getAppMetrics trả 0% CPU: gọi trước một lần để dòng đầu đã có số.
  safely(sources.appMetrics)

  const report = (): string => {
    const now = performance.now()
    const elapsedMs = Math.max(1, now - lastReportAt)
    lastReportAt = now
    const parts: string[] = ['[ServerHealth]']

    if (lagHistogram.count > 0) {
      parts.push(
        `lagP50Ms=${roundMs(lagHistogram.percentile(50))}`,
        `lagP99Ms=${roundMs(lagHistogram.percentile(99))}`,
        `lagMaxMs=${roundMs(lagHistogram.max)}`
      )
    } else {
      parts.push('lagP50Ms=0', 'lagP99Ms=0', 'lagMaxMs=0')
    }
    lagHistogram.reset()
    parts.push(`stalls=${stalls.count}`, `stallMs=${roundMs(stalls.ms)}`, `stallMaxMs=${roundMs(stalls.maxMs)}`)
    stalls.count = 0
    stalls.ms = 0
    stalls.maxMs = 0

    const cpu = process.cpuUsage()
    parts.push(`cpuPct=${roundMs(((cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000 / elapsedMs) * 100)}`)
    lastCpu = cpu
    const host = hostCpuSnapshot()
    const hostTotal = host.total - lastHost.total
    parts.push(`hostCpuPct=${hostTotal > 0 ? roundMs((1 - (host.idle - lastHost.idle) / hostTotal) * 100) : 0}`, `cores=${host.cores}`)
    lastHost = host
    const metrics = safely(sources.appMetrics)
    if (metrics && metrics.length) {
      const byType = new Map<string, number>()
      for (const metric of metrics) byType.set(metric.type, (byType.get(metric.type) ?? 0) + (metric.cpu?.percentCPUUsage ?? 0))
      parts.push(`procCpu=${[...byType.entries()].map(([type, pct]) => `${type}:${roundMs(pct)}`).join(',')}`)
    }

    try {
      const memory = process.memoryUsage()
      parts.push(
        `rssMb=${toMb(memory.rss)}`,
        `heapMb=${toMb(memory.heapUsed)}/${toMb(memory.heapTotal)}`,
        `heapLimitMb=${toMb(getHeapStatistics().heap_size_limit)}`,
        `extMb=${toMb(memory.external)}`,
        `abMb=${toMb(memory.arrayBuffers)}`
      )
    } catch {
      // Bỏ phần bộ nhớ nếu không đọc được.
    }
    parts.push(`hostFreeMb=${toMb(freemem())}/${toMb(totalmem())}`)
    parts.push(`gc=${gc.count}`, `gcMs=${roundMs(gc.ms)}`, `gcMaxMs=${roundMs(gc.maxMs)}`, `gcMajor=${gc.major}`, `gcMajorMs=${roundMs(gc.majorMs)}`)
    gc.count = 0
    gc.ms = 0
    gc.maxMs = 0
    gc.major = 0
    gc.majorMs = 0

    const logWrites = safely(sources.logWrites)
    if (logWrites) {
      parts.push(...writePart('log', logWrites))
      if (typeof logWrites.fileBytes === 'number') parts.push(`logFileMb=${toMb(logWrites.fileBytes)}`)
    }
    const journalWrites = safely(sources.journalWrites)
    if (journalWrites) parts.push(...writePart('journal', journalWrites))

    parts.push(...histogramPart('db', httpHistograms.db), ...histogramPart('other', httpHistograms.other))
    parts.push(`httpErr=${httpErrors}`, `connErr=${connectErrors}`, `inflight=${httpInflight}`)
    httpHistograms.db.reset()
    httpHistograms.other.reset()
    httpErrors = 0
    connectErrors = 0

    const line = parts.join(' ')
    emit(line)
    return line
  }

  const reportTimer = setInterval(() => {
    try {
      report()
    } catch {
      // Lỗi của phần đo không được làm dừng App Server.
    }
  }, intervalMs)
  reportTimer.unref?.()

  let stopped = false
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      clearInterval(reportTimer)
      clearInterval(stallTimer)
      gcObserver?.disconnect()
      for (const [name, handler] of subscribed) {
        try {
          unsubscribe(name, handler)
        } catch {
          // Bỏ qua.
        }
      }
    },
    reportNow: report
  }
}
