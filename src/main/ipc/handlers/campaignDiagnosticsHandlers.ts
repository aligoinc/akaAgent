import { ipcMain, type BrowserWindow } from 'electron'
import { CAMPAIGN_DIAGNOSTICS_IPC, DIAGNOSTICS_TTL_MS, type CampaignDiagnosticsRequest, type CampaignDiagnosticsAiRequest, type CampaignDiagnosticsSnapshot } from '../../../shared/campaignDiagnostics'
import { getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials, runWithCurrentUser } from '../../data/currentUser'
import { collectCampaignDiagnostics, analyzeDiagnosticsSnapshot, readDiagnosticVersion } from '../../services/campaignDiagnosticsService'
import { readDiagnosticsCampaign } from '../../data/repositories/campaignDiagnosticsRepository'
import { readStaffAccess } from '../../data/repositories/staffManagementRepository'
import { withRequestDeadline } from '../../services/requestDeadline'
import type { CampaignScheduler } from '../../services/campaignScheduler'

const unavailable = 'Chưa thể hoàn tất chẩn đoán. Vui lòng kiểm tra lại.'
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
export function registerCampaignDiagnosticsHandlers(window: BrowserWindow, scheduler: Pick<CampaignScheduler, 'getDiagnosticRuntime'>): { stop: () => void } {
  interface Flight { credentials: object; controller: AbortController; clients: Set<string>; promise: Promise<unknown> }
  const flights = new Map<string, Flight>()
  const snapshots = new Map<string, { credentials: object; snapshot: CampaignDiagnosticsSnapshot; timer: ReturnType<typeof setTimeout> }>()
  const stop = () => {
    for (const flight of flights.values()) flight.controller.abort()
    flights.clear()
    for (const entry of snapshots.values()) clearTimeout(entry.timer)
    snapshots.clear()
  }
  const remember = (snapshot: CampaignDiagnosticsSnapshot, credentials: object) => {
    for (const [id, entry] of snapshots) if (entry.snapshot.campaignId === snapshot.campaignId || snapshots.size >= 32) {
      clearTimeout(entry.timer); snapshots.delete(id)
    }
    const timer = setTimeout(() => snapshots.delete(snapshot.id), DIAGNOSTICS_TTL_MS)
    timer.unref()
    snapshots.set(snapshot.id, { credentials, snapshot, timer })
    return snapshot
  }
  const assertFrame = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error(unavailable)
  }
  const execute = (request: CampaignDiagnosticsRequest, ai: boolean, snapshotId?: string) => {
    if (!request || !Number.isSafeInteger(request.campaignId) || request.campaignId <= 0 || !uuid.test(request.requestId)
      || ai && !uuid.test(snapshotId || '')) throw new Error(unavailable)
    const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
    const key = `${user.staffId}:${user.organizationId}:${request.campaignId}:${ai ? snapshotId : 'read'}`
    let flight = flights.get(key)
    if (flight?.controller.signal.aborted) { flights.delete(key); flight = undefined }
    if (flight && flight.credentials !== credentials) { stop(); flight = undefined }
    if (!flight) {
      if (flights.size >= 4) throw new Error('Đang kiểm tra nhiều chiến dịch. Vui lòng thử lại sau.')
      const controller = new AbortController()
      flight = { credentials, controller, clients: new Set(), promise: null! }
      const owned = flight
      flight.promise = runWithCurrentUser(user, () => withRequestDeadline(controller.signal, async signal => {
        const current = () => { signal.throwIfAborted(); if (getCurrentUserCredentials() !== credentials) throw new Error(unavailable) }
        const collect = async (readSignal = signal) => {
          const snapshot = await collectCampaignDiagnostics(request.campaignId, scheduler.getDiagnosticRuntime(readSignal), readSignal)
          current(); return remember(snapshot, credentials)
        }
        if (!ai) return collect()
        const entry = snapshots.get(snapshotId!)
        // A renderer identifier is never accepted as evidence or as ownership authorization.
        if (entry && (entry.credentials !== credentials || entry.snapshot.campaignId !== request.campaignId)) throw new Error(unavailable)
        const access = await readStaffAccess(user.staffId, credentials.username, credentials.password)
        current()
        if (!access.isActive) throw new Error(unavailable)
        const campaign = await readDiagnosticsCampaign(request.campaignId, signal)
        current()
        if (!campaign) throw new Error(unavailable)
        const version = await readDiagnosticVersion(campaign, signal)
        current()
        const snapshot = !entry || Date.parse(entry.snapshot.expiresAt) <= Date.now() || version !== entry.snapshot.version
          ? await withRequestDeadline(signal, readSignal => collect(readSignal), 20_000) : entry.snapshot
        const result = await analyzeDiagnosticsSnapshot(snapshot, signal)
        current()
        const latest = await readDiagnosticsCampaign(request.campaignId, signal)
        current()
        if (!latest || await readDiagnosticVersion(latest, signal) !== snapshot.version) throw new Error(unavailable)
        current()
        return result
      }, ai ? 120_000 : 20_000)).catch(() => { throw new Error(ai
        ? 'AI chưa hoàn tất hoặc dữ liệu đã thay đổi. Bấm Kiểm tra lại rồi thử AI; kết quả kiểm tra vẫn được giữ.' : unavailable)
      }).finally(() => { if (flights.get(key) === owned) flights.delete(key) })
      flights.set(key, flight)
    }
    flight.clients.add(request.requestId)
    const owned = flight
    return flight.promise.then(result => {
      if (!owned.clients.has(request.requestId) || owned.controller.signal.aborted || getCurrentUserCredentials() !== credentials) throw new Error(unavailable)
      return result
    })
  }
  ipcMain.handle(CAMPAIGN_DIAGNOSTICS_IPC.read, (event, request: CampaignDiagnosticsRequest) => { assertFrame(event); return execute(request, false) })
  ipcMain.handle(CAMPAIGN_DIAGNOSTICS_IPC.ai, (event, request: CampaignDiagnosticsAiRequest) => { assertFrame(event); return execute(request, true, request?.snapshotId) })
  ipcMain.handle(CAMPAIGN_DIAGNOSTICS_IPC.cancel, (event, requestId: string) => {
    assertFrame(event)
    if (!uuid.test(requestId)) return
    for (const flight of flights.values()) if (flight.credentials === getCurrentUserCredentials() && flight.clients.delete(requestId) && !flight.clients.size) flight.controller.abort()
  })
  return { stop }
}
