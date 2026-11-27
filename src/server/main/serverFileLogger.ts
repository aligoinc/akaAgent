import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { performance } from 'perf_hooks'
import { inspect } from 'util'

const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024

// Thời gian nằm trong console.log/warn/error (ghi server.log đồng bộ trên luồng chính), để dòng [ServerHealth] báo lại.
const writeStats = { count: 0, totalMs: 0, maxMs: 0 }
let lastFileBytes: number | null = null

/** Số lệnh ghi log, tổng / lâu nhất (ms) từ lần đọc trước, cỡ file server.log lần ghi gần nhất; đọc xong là đặt lại. */
export function takeServerFileLogStats(): { count: number; totalMs: number; maxMs: number; fileBytes: number | null } {
  const stats = { ...writeStats, fileBytes: lastFileBytes }
  writeStats.count = 0
  writeStats.totalMs = 0
  writeStats.maxMs = 0
  return stats
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || value.message
  return inspect(value, { depth: 5, breakLength: 160, maxArrayLength: 100 })
}

function rotateIfNeeded(filePath: string): void {
  try {
    if (!existsSync(filePath)) {
      lastFileBytes = 0
      return
    }
    const size = statSync(filePath).size
    lastFileBytes = size
    if (size < MAX_LOG_FILE_BYTES) return
    const backupPath = `${filePath}.1`
    if (existsSync(backupPath)) {
      // renameSync replaces the destination on Windows only inconsistently;
      // keep logging to the current file if rotation cannot be performed.
      return
    }
    renameSync(filePath, backupPath)
  } catch {
    // File logging must never stop the runtime.
  }
}

export interface ServerFileLogger {
  clear(): void
}

export function installServerFileLogger(filePath: string): ServerFileLogger {
  mkdirSync(dirname(filePath), { recursive: true })
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }

  const wrap = (level: 'INFO' | 'WARN' | 'ERROR', output: (...args: unknown[]) => void) => {
    return (...args: unknown[]): void => {
      const startedAt = performance.now()
      output(...args)
      try {
        rotateIfNeeded(filePath)
        const line = `${new Date().toISOString()} [${level}] ${args.map(stringify).join(' ')}\n`
        appendFileSync(filePath, line, 'utf8')
      } catch {
        // Console remains available even if ProgramData is not writable.
      }
      const elapsedMs = performance.now() - startedAt
      writeStats.count += 1
      writeStats.totalMs += elapsedMs
      if (elapsedMs > writeStats.maxMs) writeStats.maxMs = elapsedMs
    }
  }

  console.log = wrap('INFO', original.log)
  console.warn = wrap('WARN', original.warn)
  console.error = wrap('ERROR', original.error)

  return {
    clear: () => {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, '', 'utf8')
      rmSync(`${filePath}.1`, { force: true })
    }
  }
}
