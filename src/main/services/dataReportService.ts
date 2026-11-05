import { DATA_REPORT_CACHE_MS, parseDataReportJourney, parseDataReportSnapshot, type DataReportJourney, type DataReportSnapshot } from '../../shared/dataReports'
import type { DataReportIpcRequest, DataReportIpcResult } from '../../shared/dataReportIpc'
import { requireCurrentUser, runWithCurrentUser } from '../data/currentUser'
import { DataReportReadError, readDataReport } from '../data/repositories/dataReportRepository'
import { canUseAccountPlatformWithEntitlements, loadCurrentUserEffectiveEntitlements } from '../data/repositories/entitlementRepository'
import { ReportReadFlights, reportFlightKey } from '../domain/reports/reportReadFlights'
import { REPORT_READ_TIMEOUT_MS } from '../domain/reports/reportReadRpc'

/**
 * "Báo cáo dữ liệu" on Desktop. Reads the V465 nightly snapshot through the logged-in Desktop token (no new
 * client/pool/timer). Own flights (at most two distinct reads, so it never blocks the other reports); the snapshot
 * changes once a night and is reused for 10 minutes, a journey for 15 seconds. Numbers are built in the renderer
 * by the shared contract (identical to WebApp/iOS).
 */
const flights = new ReportReadFlights()
const cache = new Map<string, { value: unknown; expires: number }>()
const JOURNEY_CACHE_MS = 15_000
const CACHE_MAX = 32

function scopeKey(): unknown[] {
  const user = requireCurrentUser()
  return [user.staffId, user.organizationId]
}

async function cached<T>(kind: string, key: object, ttlMs: number, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const fullKey = reportFlightKey(`data-${kind}`, scopeKey(), key)
  const now = Date.now()
  for (const [entry, value] of cache) if (value.expires <= now) cache.delete(entry)
  const hit = cache.get(fullKey)
  if (hit) return hit.value as T
  const value = await flights.run(fullKey, () => load(AbortSignal.timeout(REPORT_READ_TIMEOUT_MS)))
  while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(fullKey, { value, expires: Date.now() + ttlMs })
  return value
}

/** Same audience as WebApp/iOS (Zalo Server or SMS there); on Desktop any Zalo account kind counts. */
export async function dataReportAllowed(): Promise<boolean> {
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  return canUseAccountPlatformWithEntitlements('zalo', entitlements) || canUseAccountPlatformWithEntitlements('sms', entitlements)
}

async function requireAllowed(): Promise<void> {
  if (!await dataReportAllowed()) throw new DataReportReadError('capability_required', 'Không có quyền xem báo cáo này.')
}

/** Digits, spaces, "+", ".", "-", "(", ")" only; 8-20 characters, at least 9 digits. Normalization happens in the database. */
export function journeyPhone(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!/^[0-9+().\s-]{8,20}$/.test(value) || value.replace(/\D/g, '').length < 9) {
    throw new DataReportReadError('invalid_report_query', 'Số điện thoại không hợp lệ.')
  }
  return value
}

export async function snapshot(): Promise<DataReportSnapshot> {
  await requireAllowed()
  return cached('snapshot', {}, DATA_REPORT_CACHE_MS, async signal => parseDataReportSnapshot(await readDataReport({ mode: 'snapshot' }, signal)))
}

export async function journey(raw: unknown): Promise<DataReportJourney> {
  await requireAllowed()
  const phone = journeyPhone(raw)
  return cached('journey', { phone }, JOURNEY_CACHE_MS, async signal => parseDataReportJourney(await readDataReport({ mode: 'journey', phone }, signal)))
}

async function dispatch(request: DataReportIpcRequest): Promise<unknown> {
  switch (request?.kind) {
    case 'snapshot': return snapshot()
    case 'journey': return journey(request.phone)
    default: throw new DataReportReadError('invalid_report_query', 'Yêu cầu báo cáo không hợp lệ.')
  }
}

/** IPC entry: never throws; maps known failures to stable codes and plain Vietnamese messages. */
export async function handleDataReportRequest(request: DataReportIpcRequest): Promise<DataReportIpcResult<unknown>> {
  try {
    const user = requireCurrentUser()
    return { ok: true, data: await runWithCurrentUser(user, () => dispatch(request)) }
  } catch (error) {
    if (error instanceof DataReportReadError) return { ok: false, code: error.code, message: error.message }
    const message = error instanceof Error ? error.message : String(error)
    if (/Đang tải báo cáo khác/.test(message)) return { ok: false, code: 'report_busy', message: 'Hệ thống đang tải báo cáo khác. Vui lòng thử lại sau vài giây.' }
    if (/chưa đăng nhập|đăng nhập lại|Not logged in/i.test(message)) return { ok: false, code: 'session_invalid', message: 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.' }
    console.warn('[dataReport] request failed:', message)
    return { ok: false, code: 'report_failed', message: 'Không thể tải báo cáo dữ liệu. Vui lòng thử lại.' }
  }
}
