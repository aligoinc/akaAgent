import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const MARKER_VERSION = 1 as const
const LOCAL_DATA_DIR = 'local-data'
const MARKER_FILE = 'zalo-desktop-handoff-ready.json'

export interface DesktopZaloHandoffReadyMarker {
  version: typeof MARKER_VERSION
  staffId: number
  organizationId: number
  expectedModeRevision: string
  createdAt: string
}

export interface SaveDesktopZaloHandoffReadyMarkerInput {
  staffId: number
  organizationId: number
  expectedModeRevision: string
  createdAt?: string
}

interface DesktopZaloHandoffReadyMarkerFile {
  version: typeof MARKER_VERSION
  markers: DesktopZaloHandoffReadyMarker[]
}

export function getDesktopZaloHandoffReadyMarkerPath(): string {
  return join(app.getPath('userData'), LOCAL_DATA_DIR, MARKER_FILE)
}

/**
 * Durable, desktop-local proof that the previous local Zalo runtime reached an
 * idle handoff boundary. The marker is only consumed by the same staff and
 * organization, and may additionally be guarded by the exact mode revision.
 */
export class DesktopZaloHandoffStore {
  private markers = new Map<string, DesktopZaloHandoffReadyMarker>()

  constructor(private readonly filePath: string = getDesktopZaloHandoffReadyMarkerPath()) {
    this.load()
  }

  load(): DesktopZaloHandoffReadyMarker[] {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as
        | Partial<DesktopZaloHandoffReadyMarkerFile>
        | Partial<DesktopZaloHandoffReadyMarker>
      const rawMarkers = Array.isArray((parsed as Partial<DesktopZaloHandoffReadyMarkerFile>).markers)
        ? (parsed as Partial<DesktopZaloHandoffReadyMarkerFile>).markers || []
        : [parsed as Partial<DesktopZaloHandoffReadyMarker>]
      const markers = rawMarkers
        .map(value => parseMarker(value))
        .filter((value): value is DesktopZaloHandoffReadyMarker => !!value)
      this.markers = new Map(markers.map(marker => [markerKey(marker.staffId, marker.organizationId), marker]))
    } catch (error) {
      this.markers.clear()
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        console.error('[DesktopZaloHandoffStore] Cannot read handoff marker:', error)
      }
    }
    return Array.from(this.markers.values(), marker => cloneMarker(marker)!)
  }

  get(staffId: number, organizationId: number): DesktopZaloHandoffReadyMarker | null {
    return cloneMarker(this.markers.get(markerKey(staffId, organizationId)) || null)
  }

  save(input: SaveDesktopZaloHandoffReadyMarkerInput): DesktopZaloHandoffReadyMarker {
    const marker = parseMarker({
      version: MARKER_VERSION,
      staffId: input.staffId,
      organizationId: input.organizationId,
      expectedModeRevision: input.expectedModeRevision,
      createdAt: input.createdAt ?? new Date().toISOString()
    })
    if (!marker) throw new Error('Desktop Zalo handoff marker is invalid')

    const nextMarkers = new Map(this.markers)
    nextMarkers.set(markerKey(marker.staffId, marker.organizationId), marker)
    this.write(Array.from(nextMarkers.values()))
    this.markers = nextMarkers
    return cloneMarker(marker)!
  }

  clear(staffId: number, organizationId: number, expectedModeRevision?: string): boolean {
    const key = markerKey(staffId, organizationId)
    const marker = this.markers.get(key)
    if (!marker) return false
    if (expectedModeRevision !== undefined && marker.expectedModeRevision !== expectedModeRevision.trim()) {
      return false
    }

    const nextMarkers = new Map(this.markers)
    nextMarkers.delete(key)
    this.write(Array.from(nextMarkers.values()))
    this.markers = nextMarkers
    return true
  }

  private write(markers: DesktopZaloHandoffReadyMarker[]): void {
    if (markers.length === 0) {
      try {
        unlinkSync(this.filePath)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code !== 'ENOENT') throw error
      }
      return
    }

    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    const payload: DesktopZaloHandoffReadyMarkerFile = {
      version: MARKER_VERSION,
      markers
    }
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, this.filePath)
  }
}

function markerKey(staffId: number, organizationId: number): string {
  return `${Math.floor(Number(staffId))}:${Math.floor(Number(organizationId))}`
}

function parseMarker(value: Partial<DesktopZaloHandoffReadyMarker>): DesktopZaloHandoffReadyMarker | null {
  if (value.version !== MARKER_VERSION) return null

  const staffId = Math.floor(Number(value.staffId))
  const organizationId = Math.floor(Number(value.organizationId))
  const expectedModeRevision = typeof value.expectedModeRevision === 'string'
    ? value.expectedModeRevision.trim()
    : ''
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt.trim() : ''

  if (!Number.isSafeInteger(staffId) || staffId <= 0) return null
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return null
  if (!expectedModeRevision || !createdAt || !Number.isFinite(Date.parse(createdAt))) return null

  return {
    version: MARKER_VERSION,
    staffId,
    organizationId,
    expectedModeRevision,
    createdAt
  }
}

function cloneMarker(marker: DesktopZaloHandoffReadyMarker | null): DesktopZaloHandoffReadyMarker | null {
  return marker ? { ...marker } : null
}
