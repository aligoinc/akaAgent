import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { inspect } from 'util'

const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || value.message
  return inspect(value, { depth: 5, breakLength: 160, maxArrayLength: 100 })
}

function rotateIfNeeded(filePath: string): void {
  try {
    if (!existsSync(filePath) || statSync(filePath).size < MAX_LOG_FILE_BYTES) return
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
      output(...args)
      try {
        rotateIfNeeded(filePath)
        const line = `${new Date().toISOString()} [${level}] ${args.map(stringify).join(' ')}\n`
        appendFileSync(filePath, line, 'utf8')
      } catch {
        // Console remains available even if ProgramData is not writable.
      }
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
