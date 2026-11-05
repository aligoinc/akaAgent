import {
  EFFECTIVENESS_AI_SUMMARY_SCHEMA, EFFECTIVENESS_SUGGESTION_TARGETS, REACH_ACTIONS, REPORT_SUMMARY_AI_CODE, REPORT_SUMMARY_AI_MODEL,
  previousReportRange, sanitizeEffectivenessAiSummary, shiftDateKey, vietnamDateKey, vietnamDayStartIso,
  type CampaignEffectivenessDetail, type CampaignEffectivenessList, type EffectivenessAiSummary, type EffectivenessAssets,
  type EffectivenessCustomerPage, type EffectivenessDataGroups, type EffectivenessHours, type EffectivenessLifetime,
  type EffectivenessListStage, type EffectivenessOverview, type EffectivenessPlatform, type EffectivenessQuery
} from '../../shared/campaignEffectiveness'
import {
  EFFECTIVENESS_HOURS_MAX_RANGE_MS, EFFECTIVENESS_LEGACY_STATUSES, EFFECTIVENESS_LIST_STAGES, EFFECTIVENESS_LONG_CACHE_MS, buildCampaignDetail, buildCampaignRows,
  buildCustomerRows, buildEffectivenessAiContext, buildEffectivenessOverview, buildHoursReport, buildLifetime, shiftEffectivenessMonthKey,
  type EffectivenessCampaignResultRow, type EffectivenessHoursResult, type EffectivenessLifetimeResult, type EffectivenessListRow,
  type EffectivenessSummaryResult
} from '../../shared/campaignEffectivenessAssembly'
import type { EffectivenessIpcRequest, EffectivenessIpcResult } from '../../shared/effectivenessIpc'
import { requireCurrentUser, runWithCurrentUser } from '../data/currentUser'
import * as repo from '../data/repositories/effectivenessRepository'
import { EffectivenessReadError, type EffectivenessAccountRef } from '../data/repositories/effectivenessRepository'
import { ReportReadFlights, reportFlightKey } from '../domain/reports/reportReadFlights'
import { REPORT_READ_TIMEOUT_MS } from '../domain/reports/reportReadRpc'
import { callAiUsing } from './aiRuntimeService'

/**
 * "Báo cáo hiệu quả" on Desktop. Reads V462 through the logged-in Desktop token (no new client/pool/timer);
 * at most two distinct reads per process (own flights, so the account report is never blocked), short reuse
 * (15 s; lifetime/assets/AI 10 min). Numbers come from the shared assembly, identical to WebApp/iOS.
 * Input-level pending (data not yet started) is not added here; pending results are.
 */
const flights = new ReportReadFlights()
const cache = new Map<string, { value: unknown; expires: number }>()
const SHORT_CACHE_MS = 15_000
const CACHE_MAX = 48
const PLATFORMS: readonly EffectivenessPlatform[] = ['facebook', 'zalo', 'email', 'sms']
const EMPTY_SUMMARY: EffectivenessSummaryResult = { rows: [], statusCodes: {}, unique: null }

const invalid = (message = 'Bộ lọc báo cáo không hợp lệ.') => new EffectivenessReadError('invalid_report_query', message)

function scopeKey(): unknown[] {
  const user = requireCurrentUser()
  return [user.staffId, user.organizationId, user.entitlements, user.zaloAccountCapabilities]
}

async function cached<T>(kind: string, key: object, ttlMs: number, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const fullKey = reportFlightKey(`effectiveness-${kind}`, scopeKey(), key)
  const now = Date.now()
  for (const [entry, value] of cache) if (value.expires <= now) cache.delete(entry)
  const hit = cache.get(fullKey)
  if (hit) return hit.value as T
  const value = await flights.run(fullKey, () => load(AbortSignal.timeout(REPORT_READ_TIMEOUT_MS)))
  if (ttlMs > 0) {
    while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
    cache.set(fullKey, { value, expires: Date.now() + ttlMs })
  }
  return value
}

function isoParam(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw invalid('Thời gian báo cáo không hợp lệ.')
  return new Date(value).toISOString()
}

function normalizeQuery(raw: unknown): EffectivenessQuery {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const startIso = isoParam(value.startIso), endIso = isoParam(value.endIso)
  const span = Date.parse(endIso) - Date.parse(startIso)
  if (span <= 0 || span > 366 * 86_400_000) throw invalid('Chọn khoảng báo cáo tối đa 366 ngày.')
  let flatformType: EffectivenessPlatform | undefined
  if (value.flatformType !== undefined && value.flatformType !== null && value.flatformType !== '') {
    if (!PLATFORMS.includes(value.flatformType as EffectivenessPlatform)) throw invalid('Loại tài khoản không hợp lệ.')
    flatformType = value.flatformType as EffectivenessPlatform
  }
  let accountIds: number[] | undefined
  if (value.accountIds !== undefined && value.accountIds !== null) {
    if (!Array.isArray(value.accountIds) || value.accountIds.length > 1000
      || value.accountIds.some(id => !Number.isSafeInteger(id) || Number(id) <= 0)) throw invalid('Danh sách tài khoản không hợp lệ.')
    accountIds = [...new Set(value.accountIds.map(Number))].sort((a, b) => a - b)
  }
  return { startIso, endIso, ...(flatformType ? { flatformType } : {}), ...(accountIds ? { accountIds } : {}) }
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw invalid()
  return parsed
}

function rpcBase(accounts: readonly EffectivenessAccountRef[], actionCodes: string[]) {
  return {
    accountIds: accounts.map(account => account.id), actionCodes, reachActionCodes: [...REACH_ACTIONS],
    legacy: EFFECTIVENESS_LEGACY_STATUSES
  }
}

export function overview(query: EffectivenessQuery, compare: boolean): Promise<EffectivenessOverview> {
  return cached('overview', { ...query, compare }, SHORT_CACHE_MS, async signal => {
    const { accounts, actions } = await repo.loadEffectivenessScope(query.flatformType, query.accountIds, signal)
    const actionCodes = actions.map(action => action.code)
    if (!accounts.length || !actionCodes.length) {
      return buildEffectivenessOverview({ query, actions, summary: EMPTY_SUMMARY, pendingInputsByAction: new Map(),
        previous: compare ? EMPTY_SUMMARY : null, now: new Date() })
    }
    const base = rpcBase(accounts, actionCodes)
    const summary = await repo.readCampaignEffectiveness<EffectivenessSummaryResult>(
      { ...base, mode: 'summary', startIso: query.startIso, endIso: query.endIso, includeUnique: true }, signal)
    const previous = compare
      ? await repo.readCampaignEffectiveness<EffectivenessSummaryResult>({ ...base, mode: 'summary', ...previousReportRange(query) }, signal)
      : null
    return buildEffectivenessOverview({ query, actions, summary, pendingInputsByAction: new Map(), previous, now: new Date() })
  })
}

export function campaigns(query: EffectivenessQuery): Promise<CampaignEffectivenessList> {
  return cached('campaigns', query, SHORT_CACHE_MS, async signal => {
    const { accounts, actions } = await repo.loadEffectivenessScope(query.flatformType, query.accountIds, signal)
    if (!accounts.length || !actions.length) return { query, rows: [], generatedAt: new Date().toISOString() }
    const result = await repo.readCampaignEffectiveness<{ rows: EffectivenessCampaignResultRow[] }>(
      { ...rpcBase(accounts, actions.map(action => action.code)), mode: 'campaigns', startIso: query.startIso, endIso: query.endIso }, signal)
    const metas = await repo.loadEffectivenessCampaigns(result.rows.map(row => row.campaignId), signal)
    return { query, rows: buildCampaignRows({ rows: result.rows, campaigns: metas, accounts }), generatedAt: new Date().toISOString() }
  })
}

export function campaign(campaignId: number, query: EffectivenessQuery): Promise<CampaignEffectivenessDetail> {
  return cached('campaign', { ...query, campaignId }, SHORT_CACHE_MS, async signal => {
    const [meta] = await repo.loadEffectivenessCampaigns([campaignId], signal)
    if (!meta) throw new EffectivenessReadError('campaign_not_found', 'Không tìm thấy chiến dịch.')
    const { accounts, actions } = await repo.loadEffectivenessScope(undefined, undefined, signal)
    const account = accounts.filter(item => item.id === meta.accountId)
    const summary = account.length && actions.length
      ? await repo.readCampaignEffectiveness<EffectivenessSummaryResult>({ ...rpcBase(account, actions.map(action => action.code)),
          mode: 'summary', campaignIds: [campaignId], startIso: query.startIso, endIso: query.endIso }, signal)
      : EMPTY_SUMMARY
    return buildCampaignDetail({ query, campaign: meta, summary, accountName: account[0]?.name || '',
      actionNames: new Map(actions.map(action => [action.code, action.name])), now: new Date() })
  })
}

export function hours(query: EffectivenessQuery): Promise<EffectivenessHours> {
  if (Date.parse(query.endIso) - Date.parse(query.startIso) > EFFECTIVENESS_HOURS_MAX_RANGE_MS) {
    return Promise.reject(invalid('Chọn khoảng tối đa 92 ngày cho báo cáo khung giờ.'))
  }
  return cached('hours', query, SHORT_CACHE_MS, async signal => {
    const { accounts, actions } = await repo.loadEffectivenessScope(query.flatformType, query.accountIds, signal)
    const empty: EffectivenessHoursResult = { cells: [], activity: [], medianResponseMinutes: null, medianSeenMinutes: null }
    const result = accounts.length && actions.length
      ? await repo.readCampaignEffectiveness<EffectivenessHoursResult>(
          { ...rpcBase(accounts, actions.map(action => action.code)), mode: 'hours', startIso: query.startIso, endIso: query.endIso }, signal)
      : empty
    return buildHoursReport(query, result, new Date())
  })
}

export function dataGroups(query: EffectivenessQuery): Promise<EffectivenessDataGroups> {
  return cached('data-groups', query, SHORT_CACHE_MS, async signal => {
    const { accounts, actions } = await repo.loadEffectivenessScope(query.flatformType, query.accountIds, signal)
    if (!accounts.length || !actions.length) return { query, rows: [], generatedAt: new Date().toISOString() }
    const result = await repo.readCampaignEffectiveness<{ rows: EffectivenessDataGroups['rows'] }>(
      { ...rpcBase(accounts, actions.map(action => action.code)), mode: 'data_groups', startIso: query.startIso, endIso: query.endIso }, signal)
    return { query, rows: result.rows, generatedAt: new Date().toISOString() }
  })
}

export function customers(query: EffectivenessQuery, input: { stage: unknown; page?: unknown; pageSize?: unknown; campaignId?: unknown }):
  Promise<EffectivenessCustomerPage> {
  const stage = String(input.stage || '') as EffectivenessListStage
  if (!EFFECTIVENESS_LIST_STAGES.includes(stage) || stage === 'received') return Promise.reject(invalid('Trạng thái khách hàng không hợp lệ.'))
  const page = positiveInt(input.page, 1, 100_000)
  const pageSize = positiveInt(input.pageSize, 100, 500)
  const campaignId = input.campaignId === undefined || input.campaignId === null ? undefined : positiveInt(input.campaignId, 1, Number.MAX_SAFE_INTEGER)
  const customerQuery = { ...query, stage, page, pageSize, ...(campaignId ? { campaignId } : {}) }
  // Customer lists are read on demand and never cached.
  return cached('customers', customerQuery, 0, async signal => {
    const { accounts, actions } = await repo.loadEffectivenessScope(query.flatformType, query.accountIds, signal)
    if (!accounts.length || !actions.length) return { query: customerQuery, rows: [], total: 0, page, pageSize, generatedAt: new Date().toISOString() }
    const result = await repo.readCampaignEffectiveness<{ rows: EffectivenessListRow[]; total: number | null }>({
      ...rpcBase(accounts, actions.map(action => action.code)), mode: 'list', stage, count: true,
      startIso: query.startIso, endIso: query.endIso, limit: pageSize, offset: (page - 1) * pageSize,
      ...(campaignId ? { campaignIds: [campaignId] } : {})
    }, signal)
    return {
      query: customerQuery, page, pageSize, total: Number(result.total) || 0, generatedAt: new Date().toISOString(),
      rows: buildCustomerRows(result.rows, new Map(accounts.map(account => [account.id, account.name])))
    }
  })
}

export function lifetime(raw: { flatformType?: unknown; accountIds?: unknown }): Promise<EffectivenessLifetime> {
  const now = new Date()
  const today = vietnamDateKey(now)
  const startKey = `${shiftEffectivenessMonthKey(today, -11)}-01`
  const range = { startIso: vietnamDayStartIso(startKey), endIso: vietnamDayStartIso(shiftDateKey(today, 1)) }
  const query = normalizeQuery({ ...raw, ...range })
  return cached('lifetime', { ...query, today }, EFFECTIVENESS_LONG_CACHE_MS, async signal => {
    const { accounts, actions } = await repo.loadEffectivenessScope(query.flatformType, query.accountIds, signal)
    const result: EffectivenessLifetimeResult = accounts.length && actions.length
      ? await repo.readCampaignEffectiveness<EffectivenessLifetimeResult>(
          { ...rpcBase(accounts, actions.map(action => action.code)), mode: 'lifetime', includeUnique: true, ...range }, signal)
      : { monthly: [], unique: null, firstCampaignAt: null }
    return buildLifetime(result, startKey, today, range.startIso, now)
  })
}

export function assets(): Promise<EffectivenessAssets> {
  const today = vietnamDateKey(new Date())
  return cached('assets', { today }, EFFECTIVENESS_LONG_CACHE_MS, async signal => ({
    ...await repo.countEffectivenessAssets(signal), generatedAt: new Date().toISOString()
  }))
}

/** "Tóm tắt bằng AI": only on an explicit click; aggregate numbers only; same prompt/schema as WebApp (V463). */
export async function aiSummary(query: EffectivenessQuery): Promise<EffectivenessAiSummary> {
  const key = reportFlightKey('effectiveness-ai', scopeKey(), query)
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value as EffectivenessAiSummary
  const base = await overview(query, true)
  if (base.totals.success === 0) throw new EffectivenessReadError('effectiveness_summary_empty', 'Chưa có kết quả trong khoảng thời gian này để tóm tắt.')
  const span = Date.parse(query.endIso) - Date.parse(query.startIso)
  const hourReport = span <= EFFECTIVENESS_HOURS_MAX_RANGE_MS ? await hours(query).catch(() => null) : null
  const campaignList = await campaigns(query).catch(() => null)
  const context = buildEffectivenessAiContext({ overview: base, hours: hourReport, campaigns: campaignList })
  const user = requireCurrentUser()
  let result
  try {
    result = await callAiUsing(REPORT_SUMMARY_AI_CODE, {
      reportContext: JSON.stringify(context),
      availableTargets: JSON.stringify([...EFFECTIVENESS_SUGGESTION_TARGETS, 'none']),
      bodyOverrides: { text: { format: { type: 'json_schema', name: 'report_effectiveness_summary', strict: true, schema: EFFECTIVENESS_AI_SUMMARY_SCHEMA } }, store: false }
    }, { organizationId: user.organizationId }, { signal: AbortSignal.timeout(120_000), expectedModel: REPORT_SUMMARY_AI_MODEL })
  } catch (error) {
    // callAiUsing only throws for a model mismatch (config not ready) or our own timeout.
    if (error instanceof Error && /model AI không khớp/.test(error.message)) {
      throw new EffectivenessReadError('ai_not_configured', 'Tóm tắt bằng AI đang được chuẩn bị. Vui lòng thử lại sau.')
    }
    throw new EffectivenessReadError('ai_unavailable', 'AI chưa tạo được tóm tắt lúc này. Vui lòng thử lại.')
  }
  if (!result.ok) {
    if (/Không tìm thấy cấu hình AI|Chưa cấu hình/.test(result.error || '')) {
      throw new EffectivenessReadError('ai_not_configured', 'Tóm tắt bằng AI đang được chuẩn bị. Vui lòng thử lại sau.')
    }
    throw new EffectivenessReadError('ai_unavailable', 'AI chưa tạo được tóm tắt lúc này. Vui lòng thử lại.')
  }
  const summary = sanitizeEffectivenessAiSummary(result.content, result.generatedAt || new Date().toISOString())
  if (!summary) throw new EffectivenessReadError('ai_invalid_output', 'AI chưa tạo được tóm tắt phù hợp. Vui lòng thử lại.')
  while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, { value: summary, expires: Date.now() + EFFECTIVENESS_LONG_CACHE_MS })
  return summary
}

async function dispatch(request: EffectivenessIpcRequest): Promise<unknown> {
  switch (request?.kind) {
    case 'platforms': return repo.listEffectivenessPlatforms()
    case 'overview': return overview(normalizeQuery(request.query), request.compare === true)
    case 'campaigns': return campaigns(normalizeQuery(request.query))
    case 'campaign': return campaign(positiveInt(request.campaignId, 0, Number.MAX_SAFE_INTEGER), normalizeQuery(request.query))
    case 'hours': return hours(normalizeQuery(request.query))
    case 'dataGroups': return dataGroups(normalizeQuery(request.query))
    case 'customers': return customers(normalizeQuery(request.query), request)
    case 'lifetime': return lifetime({ flatformType: request.flatformType, accountIds: request.accountIds })
    case 'assets': return assets()
    case 'aiSummary': return aiSummary(normalizeQuery(request.query))
    default: throw invalid()
  }
}

/** IPC entry: never throws; maps known failures to stable codes and plain Vietnamese messages. */
export async function handleEffectivenessRequest(request: EffectivenessIpcRequest): Promise<EffectivenessIpcResult<unknown>> {
  try {
    const user = requireCurrentUser()
    return { ok: true, data: await runWithCurrentUser(user, () => dispatch(request)) }
  } catch (error) {
    if (error instanceof EffectivenessReadError) return { ok: false, code: error.code, message: error.message }
    const message = error instanceof Error ? error.message : String(error)
    if (/Đang tải báo cáo khác/.test(message)) return { ok: false, code: 'report_busy', message: 'Hệ thống đang tải báo cáo khác. Vui lòng thử lại sau vài giây.' }
    if (/chưa đăng nhập|đăng nhập lại|Not logged in/i.test(message)) return { ok: false, code: 'session_invalid', message: 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.' }
    console.warn('[effectivenessReport] request failed:', message)
    return { ok: false, code: 'report_failed', message: 'Không thể tải báo cáo hiệu quả. Vui lòng thử lại.' }
  }
}
