import { createHash } from 'node:crypto'

export interface LogDelta {
  mode: 'unchanged' | 'replace' | 'delta'
  version: string
  updatedAt?: string
  log?: string
  prefix?: string
  keepChars?: number
  append?: string
}
const digest = (value: string) => createHash('md5').update(value, 'utf8').digest('hex')
export function logCursor(log: string): { version: string; length: number; tail: string } {
  const characters = Array.from(log) // PostgreSQL counts Unicode code points, not UTF-16 units.
  return { version: digest(log), length: characters.length, tail: characters.slice(-1024).join('') }
}
export function reconstructLog(previous: string | undefined, delta: LogDelta): string | null {
  let log: string | undefined
  if (delta.mode === 'unchanged') log = previous
  else if (delta.mode === 'replace') log = delta.log
  else if (delta.mode === 'delta' && previous !== undefined && typeof delta.prefix === 'string' && typeof delta.append === 'string') {
    const characters = Array.from(previous)
    const keep = delta.keepChars
    if (!Number.isSafeInteger(keep) || keep! < 0 || keep! > characters.length) return null
    log = delta.prefix + (keep ? characters.slice(-keep).join('') : '') + delta.append
  }
  return typeof log === 'string' && digest(log) === delta.version ? log : null
}
