import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

interface OwnershipEntry {
  staffId: number
  modeRevision: string
}

interface OwnershipFile {
  version: 2
  entries: OwnershipEntry[]
}

/**
 * Durable, VPS-local ownership marker used to distinguish a crashed server
 * process from work that may still belong to a desktop. Production is limited
 * to one server installation for a database.
 */
export class ServerRuntimeOwnershipStore {
  private readonly entries = new Map<number, string>()

  constructor(private readonly filePath: string) {
    this.load()
  }

  has(staffId: number): boolean {
    return this.entries.has(staffId)
  }

  matchesModeRevision(staffId: number, modeRevision: string): boolean {
    return this.entries.has(staffId) && this.entries.get(staffId) === modeRevision
  }

  claim(staffId: number, modeRevision: string): void {
    if (this.entries.has(staffId) && this.entries.get(staffId) === modeRevision) return
    this.entries.set(staffId, modeRevision)
    this.persist()
  }

  release(staffId: number): void {
    if (!this.entries.delete(staffId)) return
    this.persist()
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as {
        version?: number
        entries?: Array<Partial<OwnershipEntry>>
        staffIds?: unknown[]
      }
      const rawEntries = parsed.version === 2 && Array.isArray(parsed.entries)
        ? parsed.entries
        : parsed.version === 1 && Array.isArray(parsed.staffIds)
          ? parsed.staffIds.map(staffId => ({ staffId: Number(staffId), modeRevision: '' }))
          : []
      for (const rawEntry of rawEntries) {
        const staffId = Math.floor(Number(rawEntry?.staffId))
        if (!Number.isSafeInteger(staffId) || staffId <= 0) continue
        const modeRevision = typeof rawEntry.modeRevision === 'string'
          ? rawEntry.modeRevision.trim()
          : ''
        if (modeRevision) this.entries.set(staffId, modeRevision)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        console.error('[ServerRuntimeOwnershipStore] Cannot read ownership marker:', error)
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const payload: OwnershipFile = {
      version: 2,
      entries: Array.from(this.entries.entries())
        .map(([staffId, modeRevision]) => ({ staffId, modeRevision }))
        .sort((left, right) => left.staffId - right.staffId)
    }
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, this.filePath)
  }
}
