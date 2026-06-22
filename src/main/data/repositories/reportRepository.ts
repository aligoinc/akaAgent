import {
  AccountActionReportAccount,
  AccountActionReportAction,
  AccountActionReportCell,
  AccountActionReportDetailQuery,
  AccountActionReportDetailResult,
  AccountActionReportDetailRow,
  AccountActionReportQuery,
  AccountActionReportResult,
  AccountActionReportStatusBucket,
  Campaign,
  CampaignAction,
  CampaignDetailStatus
} from '../../../shared/types'
import { getCampaignActionDescriptors } from '../../domain/campaigns/campaignActionDescriptors'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import * as accountActionRepo from './accountActionRepository'
import {
  canUseAccountPlatformWithEntitlements,
  loadCurrentUserEffectiveEntitlements
} from './entitlementRepository'

const client = () => getSupabaseClient()
const PAGE_SIZE = 1000
const DETAIL_PAGE_SIZE = 100
const MAX_DETAIL_PAGE_SIZE = 500

interface ReportDetailRow {
  account_id: number | null
  action_code: string | null
  status: CampaignDetailStatus
}

interface PendingInputRow {
  id: number
  schedule: string | null
  auto_campaigns?: Record<string, unknown> | Record<string, unknown>[] | null
}

interface CampaignDetailRecord {
  id: number
  input_data_id: number | null
  campaign_id: number | null
  account_id: number | null
  action_code: string | null
  action_name: string | null
  status: CampaignDetailStatus
  error_code: string | null
  log: string | null
  data: Record<string, unknown> | string | null
  post_url: string | null
  created_at: string | null
}

interface PendingDetailInputRow {
  id: number
  campaign_id: number
  name: string | null
  phone: string | null
  uid: string | null
  email: string | null
  note: string | null
  schedule: string | null
  created_at: string | null
  auto_campaigns?: Record<string, unknown> | Record<string, unknown>[] | null
}

interface CampaignInfo {
  id: number
  name: string
}

interface InputDataInfo {
  id: number
  name?: string | null
  uid?: string | null
  phone?: string | null
  email?: string | null
  note?: string | null
  schedule?: string | null
}

function normalizeNumberIds(values: unknown): number[] | undefined {
  if (!Array.isArray(values)) return undefined
  return Array.from(new Set(
    values
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)
  ))
}

function normalizeStringList(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  return Array.from(new Set(
    values
      .map(value => String(value || '').trim())
      .filter(Boolean)
  ))
}

function normalizeQuery(query: AccountActionReportQuery): AccountActionReportQuery {
  const startDate = new Date(query.startIso)
  const endDate = new Date(query.endIso)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Khoảng thời gian báo cáo không hợp lệ.')
  }
  if (startDate.getTime() >= endDate.getTime()) {
    throw new Error('Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc.')
  }

  const accountIds = normalizeNumberIds(query.accountIds)
  const actionCodes = normalizeStringList(query.actionCodes)

  return {
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
    ...(String(query.flatformType || '').trim() ? { flatformType: String(query.flatformType || '').trim() } : {}),
    ...(accountIds !== undefined ? { accountIds } : {}),
    ...(actionCodes !== undefined ? { actionCodes } : {})
  }
}

function normalizeDetailQuery(query: AccountActionReportDetailQuery): AccountActionReportDetailQuery {
  const startDate = new Date(query.startIso)
  const endDate = new Date(query.endIso)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Khoảng thời gian báo cáo không hợp lệ.')
  }
  if (startDate.getTime() >= endDate.getTime()) {
    throw new Error('Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc.')
  }

  const accountId = Math.floor(Number(query.accountId))
  if (!Number.isFinite(accountId) || accountId <= 0) {
    throw new Error('Tài khoản báo cáo không hợp lệ.')
  }

  const actionCode = String(query.actionCode || '').trim()
  if (!actionCode) {
    throw new Error('Hành động báo cáo không hợp lệ.')
  }

  const statusBuckets: AccountActionReportStatusBucket[] = ['pending', 'success', 'failure']
  if (!statusBuckets.includes(query.statusBucket)) {
    throw new Error('Trạng thái báo cáo không hợp lệ.')
  }

  const page = Math.max(1, Math.floor(Number(query.page || 1)))
  const pageSize = Math.min(
    MAX_DETAIL_PAGE_SIZE,
    Math.max(1, Math.floor(Number(query.pageSize || DETAIL_PAGE_SIZE)))
  )

  return {
    accountId,
    actionCode,
    statusBucket: query.statusBucket,
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
    page,
    pageSize,
    exportAll: query.exportAll === true,
    ...(String(query.flatformType || '').trim() ? { flatformType: String(query.flatformType || '').trim() } : {})
  }
}

function getNestedObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0]
    return first && typeof first === 'object' ? first as Record<string, unknown> : null
  }
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function mapAccountRow(row: Record<string, unknown>): AccountActionReportAccount {
  const group = getNestedObject(row.auto_account_groups)
  return {
    id: row.id as number,
    name: String(row.name || ''),
    flatformType: String(row.flatform_type || ''),
    accountGroupId: (row.account_group_id as number | null) ?? null,
    accountGroupName: group ? String(group.name || '') : null
  }
}

function makeEmptyCell(): AccountActionReportCell {
  return {
    successCount: 0,
    failureCount: 0,
    pendingCount: 0
  }
}

function isWithinRange(iso: string | null | undefined, startMs: number, endMs: number): boolean {
  if (!iso) return false
  const value = new Date(iso).getTime()
  return Number.isFinite(value) && value >= startMs && value < endMs
}

function getStatusLabel(statusBucket: AccountActionReportStatusBucket): string {
  if (statusBucket === 'pending') return 'Chờ xử lý'
  if (statusBucket === 'success') return 'Thành công'
  return 'Thất bại'
}

function getDetailStatuses(statusBucket: AccountActionReportStatusBucket): CampaignDetailStatus[] {
  return statusBucket === 'success' ? ['thành công'] : ['thất bại', 'lỗi']
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  return null
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function firstText(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null
  for (const key of keys) {
    const text = textValue(record[key])
    if (text) return text
  }
  return null
}

function isHttpUrl(value: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(value || '').trim())
}

function uniqueIds(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0)
  ))
}

async function loadCampaignInfoMap(staffId: number, campaignIds: number[]): Promise<Map<number, CampaignInfo>> {
  if (campaignIds.length === 0) return new Map()

  const { data, error } = await client()
    .from('auto_campaigns')
    .select('id, name')
    .eq('staff_id', staffId)
    .in('id', campaignIds)

  if (error) throw new Error(`Failed to list report detail campaigns: ${error.message}`)
  return new Map((data || []).map(row => [
    Number(row.id),
    { id: Number(row.id), name: String(row.name || '') }
  ]))
}

async function loadInputDataInfoMap(inputDataIds: number[]): Promise<Map<number, InputDataInfo>> {
  if (inputDataIds.length === 0) return new Map()

  const { data, error } = await client()
    .from('auto_campaign_input_data')
    .select('id, name, uid, phone, email, note, schedule')
    .in('id', inputDataIds)

  if (error) throw new Error(`Failed to list report detail input data: ${error.message}`)
  return new Map((data || []).map(row => [
    Number(row.id),
    {
      id: Number(row.id),
      name: (row.name as string | null) ?? null,
      uid: (row.uid as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      note: (row.note as string | null) ?? null,
      schedule: (row.schedule as string | null) ?? null
    }
  ]))
}

async function loadReportAccount(query: AccountActionReportDetailQuery, staffId: number): Promise<AccountActionReportAccount> {
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  if (query.flatformType && !canUseAccountPlatformWithEntitlements(query.flatformType, entitlements)) {
    throw new Error('Không tìm thấy tài khoản trong báo cáo.')
  }
  const { data, error } = await client()
    .from('auto_accounts')
    .select('id, name, flatform_type, account_group_id, auto_account_groups(name)')
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .eq('id', query.accountId)
    .maybeSingle()

  if (error) throw new Error(`Failed to get report account: ${error.message}`)
  if (!data) throw new Error('Không tìm thấy tài khoản trong báo cáo.')
  const account = mapAccountRow(data)
  if (query.flatformType && account.flatformType !== query.flatformType) {
    throw new Error('Không tìm thấy tài khoản trong báo cáo.')
  }
  if (!canUseAccountPlatformWithEntitlements(account.flatformType, entitlements)) {
    throw new Error('Không tìm thấy tài khoản trong báo cáo.')
  }
  return account
}

async function loadReportAction(account: AccountActionReportAccount, actionCode: string): Promise<AccountActionReportAction> {
  const actions = await accountActionRepo.listAccountActions(account.flatformType)
  const action = actions.find(item => item.code === actionCode)
  return {
    code: actionCode,
    name: action?.name || actionCode,
    flatformType: account.flatformType
  }
}

function mapCampaignDetailRecordToRow(
  detail: CampaignDetailRecord,
  account: AccountActionReportAccount,
  action: AccountActionReportAction,
  campaignMap: Map<number, CampaignInfo>,
  inputDataMap: Map<number, InputDataInfo>
): AccountActionReportDetailRow {
  const data = normalizeRecord(detail.data)
  const inputData = detail.input_data_id ? inputDataMap.get(Number(detail.input_data_id)) : undefined
  const campaign = detail.campaign_id ? campaignMap.get(Number(detail.campaign_id)) : undefined
  const targetName = inputData?.name || firstText(data, ['targetName', 'name', 'profileName', 'groupName', 'pageName'])
  const targetUid = inputData?.uid || firstText(data, ['targetUid', 'uid', 'targetUrl', 'profileUrl', 'groupUrl', 'pageUrl'])
  const targetPhone = inputData?.phone || firstText(data, ['targetPhone', 'phone'])
  const targetEmail = inputData?.email || firstText(data, ['targetEmail', 'email'])
  const postUrl = detail.post_url || firstText(data, ['postUrl', 'post_url'])
  const detailParts = [
    textValue(detail.log),
    detail.error_code ? `Mã lỗi: ${detail.error_code}` : null
  ].filter(Boolean)

  return {
    id: `detail:${detail.id}`,
    source: 'campaign_detail',
    occurredAt: detail.created_at,
    accountId: account.id,
    accountName: account.name,
    campaignId: detail.campaign_id ?? null,
    campaignName: campaign?.name || null,
    actionCode: detail.action_code || action.code,
    actionName: detail.action_name || action.name,
    targetName,
    targetUid,
    targetPhone,
    targetEmail,
    status: detail.status,
    detailText: detailParts.join('\n') || null,
    postUrl
  }
}

function mapPendingInputRecordToRow(
  inputRow: PendingDetailInputRow,
  account: AccountActionReportAccount,
  action: AccountActionReportAction,
  campaignRow: Record<string, unknown>,
  effectiveSchedule: string
): AccountActionReportDetailRow {
  const uid = textValue(inputRow.uid)
  return {
    id: `pending:${inputRow.id}:${action.code}`,
    source: 'campaign_input_data',
    occurredAt: effectiveSchedule,
    accountId: account.id,
    accountName: account.name,
    campaignId: Number(campaignRow.id),
    campaignName: textValue(campaignRow.name),
    actionCode: action.code,
    actionName: action.name,
    targetName: textValue(inputRow.name),
    targetUid: uid,
    targetPhone: textValue(inputRow.phone),
    targetEmail: textValue(inputRow.email),
    status: 'chờ xử lý',
    detailText: textValue(inputRow.note),
    postUrl: isHttpUrl(uid) ? uid : null
  }
}

export async function getAccountActionReport(input: AccountActionReportQuery): Promise<AccountActionReportResult> {
  const u = requireCurrentUser()
  const query = normalizeQuery(input)
  const explicitAccountFilter = Array.isArray(input.accountIds)
  const explicitActionFilter = Array.isArray(input.actionCodes)

  const allActions = await accountActionRepo.listAccountActions(query.flatformType)
  const allowedActionCodeSet = explicitActionFilter
    ? new Set(query.actionCodes || [])
    : null
  const actions: AccountActionReportAction[] = allActions
    .filter(action => !allowedActionCodeSet || allowedActionCodeSet.has(action.code))
    .map(action => ({
      code: action.code,
      name: action.name,
      flatformType: action.flatformType
    }))

  if (explicitActionFilter && (query.actionCodes || []).length === 0) {
    return { query, actions: [], rows: [], generatedAt: new Date().toISOString() }
  }

  const requestedAccountIds = query.accountIds || []
  if (explicitAccountFilter && requestedAccountIds.length === 0) {
    return { query, actions, rows: [], generatedAt: new Date().toISOString() }
  }
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  if (query.flatformType && !canUseAccountPlatformWithEntitlements(query.flatformType, entitlements)) {
    return { query, actions: [], rows: [], generatedAt: new Date().toISOString() }
  }

  let accountQuery = client()
    .from('auto_accounts')
    .select('id, name, flatform_type, account_group_id, auto_account_groups(name)')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .order('name', { ascending: true })

  if (query.flatformType) accountQuery = accountQuery.eq('flatform_type', query.flatformType)
  if (explicitAccountFilter) accountQuery = accountQuery.in('id', requestedAccountIds)

  const { data: accountRows, error: accountError } = await accountQuery
  if (accountError) throw new Error(`Failed to list report accounts: ${accountError.message}`)

  const accounts = (accountRows || [])
    .map(row => mapAccountRow(row))
    .filter(account => canUseAccountPlatformWithEntitlements(account.flatformType, entitlements))
  const actionCodes = actions.map(action => action.code)
  const actionCodeSet = new Set(actionCodes)
  const rows = accounts.map(account => ({
    account,
    countsByActionCode: Object.fromEntries(actionCodes.map(code => [code, makeEmptyCell()]))
  }))
  const rowByAccountId = new Map(rows.map(row => [row.account.id, row]))

  if (accounts.length === 0 || actions.length === 0) {
    return { query, actions, rows, generatedAt: new Date().toISOString() }
  }

  const accountIds = accounts.map(account => account.id)
  const startMs = new Date(query.startIso).getTime()
  const endMs = new Date(query.endIso).getTime()

  let detailFrom = 0
  while (true) {
    let detailQuery = client()
      .from('auto_campaign_details')
      .select('account_id, action_code, status')
      .eq('is_delete', false)
      .in('account_id', accountIds)
      .in('action_code', actionCodes)
      .in('status', ['thành công', 'thất bại', 'lỗi'])
      .gte('created_at', query.startIso)
      .lt('created_at', query.endIso)
      .order('id', { ascending: true })
      .range(detailFrom, detailFrom + PAGE_SIZE - 1)

    const { data, error } = await detailQuery
    if (error) throw new Error(`Failed to list report campaign details: ${error.message}`)

    const page = (data || []) as ReportDetailRow[]
    for (const detail of page) {
      const accountId = Number(detail.account_id)
      const actionCode = String(detail.action_code || '')
      const reportRow = rowByAccountId.get(accountId)
      if (!reportRow || !actionCodeSet.has(actionCode)) continue

      const cell = reportRow.countsByActionCode[actionCode] || makeEmptyCell()
      if (detail.status === 'thành công') cell.successCount += 1
      else cell.failureCount += 1
      reportRow.countsByActionCode[actionCode] = cell
    }

    if (page.length < PAGE_SIZE) break
    detailFrom += PAGE_SIZE
  }

  let pendingFrom = 0
  while (true) {
    const { data, error } = await client()
      .from('auto_campaign_input_data')
      .select(`
        id,
        schedule,
        auto_campaigns!inner(
          id,
          account_id,
          action_id,
          schedule,
          extra_settings,
          auto_campaign_actions(limit_check_action_codes, name)
        )
      `)
      .eq('is_delete', false)
      .eq('status', 'chờ xử lý')
      .eq('auto_campaigns.staff_id', u.staffId)
      .eq('auto_campaigns.is_delete', false)
      .in('auto_campaigns.account_id', accountIds)
      .order('id', { ascending: true })
      .range(pendingFrom, pendingFrom + PAGE_SIZE - 1)

    if (error) throw new Error(`Failed to list report pending inputs: ${error.message}`)

    const page = (data || []) as PendingInputRow[]
    for (const inputRow of page) {
      const campaignRow = getNestedObject(inputRow.auto_campaigns)
      if (!campaignRow) continue

      const effectiveSchedule = String(inputRow.schedule || campaignRow.schedule || '').trim()
      if (!isWithinRange(effectiveSchedule, startMs, endMs)) continue

      const accountId = Number(campaignRow.account_id)
      const reportRow = rowByAccountId.get(accountId)
      if (!reportRow) continue

      const actionRow = getNestedObject(campaignRow.auto_campaign_actions)
      const campaign = {
        id: Number(campaignRow.id),
        actionId: String(campaignRow.action_id || ''),
        accountId,
        schedule: String(campaignRow.schedule || '') || undefined,
        extraSettings: (campaignRow.extra_settings as Campaign['extraSettings']) || {}
      } as Campaign
      const campaignAction = actionRow
        ? {
          id: campaign.actionId,
          name: String(actionRow.name || ''),
          limitCheckActionCodes: Array.isArray(actionRow.limit_check_action_codes)
            ? actionRow.limit_check_action_codes as string[]
            : []
        } as CampaignAction
        : undefined

      for (const action of getCampaignActionDescriptors(campaign, campaignAction)) {
        if (!actionCodeSet.has(action.code)) continue
        const cell = reportRow.countsByActionCode[action.code] || makeEmptyCell()
        cell.pendingCount += 1
        reportRow.countsByActionCode[action.code] = cell
      }
    }

    if (page.length < PAGE_SIZE) break
    pendingFrom += PAGE_SIZE
  }

  return {
    query,
    actions,
    rows,
    generatedAt: new Date().toISOString()
  }
}

async function getCampaignDetailRows(
  query: AccountActionReportDetailQuery,
  account: AccountActionReportAccount,
  action: AccountActionReportAction,
  staffId: number
): Promise<AccountActionReportDetailResult> {
  const statuses = getDetailStatuses(query.statusBucket)
  const offset = ((query.page || 1) - 1) * (query.pageSize || DETAIL_PAGE_SIZE)
  const rows: CampaignDetailRecord[] = []
  let total = 0

  const runQuery = async (from: number, to: number) => {
    const request = client()
      .from('auto_campaign_details')
      .select(`
        id,
        input_data_id,
        campaign_id,
        account_id,
        action_code,
        action_name,
        status,
        error_code,
        log,
        data,
        post_url,
        created_at
      `, { count: 'exact' })
      .eq('is_delete', false)
      .eq('account_id', account.id)
      .eq('action_code', action.code)
      .in('status', statuses)
      .gte('created_at', query.startIso)
      .lt('created_at', query.endIso)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    const { data, error, count } = await request
    if (error) throw new Error(`Failed to list report action details: ${error.message}`)
    return { data: (data || []) as CampaignDetailRecord[], count: count ?? 0 }
  }

  if (query.exportAll) {
    let from = 0
    while (true) {
      const { data, count } = await runQuery(from, from + PAGE_SIZE - 1)
      if (from === 0) total = count
      rows.push(...data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
    total = total || rows.length
  } else {
    const { data, count } = await runQuery(offset, offset + (query.pageSize || DETAIL_PAGE_SIZE) - 1)
    rows.push(...data)
    total = count
  }

  const campaignMap = await loadCampaignInfoMap(staffId, uniqueIds(rows.map(row => row.campaign_id)))
  const inputDataMap = await loadInputDataInfoMap(uniqueIds(rows.map(row => row.input_data_id)))

  return {
    query,
    rows: rows.map(row => mapCampaignDetailRecordToRow(row, account, action, campaignMap, inputDataMap)),
    total,
    page: query.exportAll ? 1 : query.page || 1,
    pageSize: query.exportAll ? Math.max(rows.length, 1) : query.pageSize || DETAIL_PAGE_SIZE,
    generatedAt: new Date().toISOString(),
    accountName: account.name,
    actionName: action.name,
    statusLabel: getStatusLabel(query.statusBucket)
  }
}

async function getPendingDetailRows(
  query: AccountActionReportDetailQuery,
  account: AccountActionReportAccount,
  action: AccountActionReportAction,
  staffId: number
): Promise<AccountActionReportDetailResult> {
  const offset = ((query.page || 1) - 1) * (query.pageSize || DETAIL_PAGE_SIZE)
  const limit = query.pageSize || DETAIL_PAGE_SIZE
  const startMs = new Date(query.startIso).getTime()
  const endMs = new Date(query.endIso).getTime()
  const rows: AccountActionReportDetailRow[] = []
  let total = 0
  let from = 0

  while (true) {
    const { data, error } = await client()
      .from('auto_campaign_input_data')
      .select(`
        id,
        campaign_id,
        name,
        phone,
        uid,
        email,
        note,
        schedule,
        created_at,
        auto_campaigns!inner(
          id,
          name,
          account_id,
          action_id,
          schedule,
          extra_settings,
          auto_campaign_actions(limit_check_action_codes, name)
        )
      `)
      .eq('is_delete', false)
      .eq('status', 'chờ xử lý')
      .eq('auto_campaigns.staff_id', staffId)
      .eq('auto_campaigns.is_delete', false)
      .eq('auto_campaigns.account_id', account.id)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Failed to list report pending details: ${error.message}`)

    const page = (data || []) as PendingDetailInputRow[]
    for (const inputRow of page) {
      const campaignRow = getNestedObject(inputRow.auto_campaigns)
      if (!campaignRow) continue

      const effectiveSchedule = String(inputRow.schedule || campaignRow.schedule || '').trim()
      if (!isWithinRange(effectiveSchedule, startMs, endMs)) continue

      const actionRow = getNestedObject(campaignRow.auto_campaign_actions)
      const campaign = {
        id: Number(campaignRow.id),
        actionId: String(campaignRow.action_id || ''),
        accountId: account.id,
        schedule: String(campaignRow.schedule || '') || undefined,
        extraSettings: (campaignRow.extra_settings as Campaign['extraSettings']) || {}
      } as Campaign
      const campaignAction = actionRow
        ? {
          id: campaign.actionId,
          name: String(actionRow.name || ''),
          limitCheckActionCodes: Array.isArray(actionRow.limit_check_action_codes)
            ? actionRow.limit_check_action_codes as string[]
            : []
        } as CampaignAction
        : undefined
      const descriptor = getCampaignActionDescriptors(campaign, campaignAction)
        .find(item => item.code === action.code)
      if (!descriptor) continue

      const currentIndex = total
      total += 1
      if (query.exportAll || (currentIndex >= offset && rows.length < limit)) {
        rows.push(mapPendingInputRecordToRow(
          inputRow,
          account,
          { ...action, name: descriptor.name || action.name },
          campaignRow,
          effectiveSchedule
        ))
      }
    }

    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return {
    query,
    rows,
    total,
    page: query.exportAll ? 1 : query.page || 1,
    pageSize: query.exportAll ? Math.max(rows.length, 1) : limit,
    generatedAt: new Date().toISOString(),
    accountName: account.name,
    actionName: action.name,
    statusLabel: getStatusLabel(query.statusBucket)
  }
}

export async function getAccountActionReportDetails(
  input: AccountActionReportDetailQuery
): Promise<AccountActionReportDetailResult> {
  const u = requireCurrentUser()
  const query = normalizeDetailQuery(input)
  const account = await loadReportAccount(query, u.staffId)
  const action = await loadReportAction(account, query.actionCode)

  if (query.statusBucket === 'pending') {
    return getPendingDetailRows(query, account, action, u.staffId)
  }

  return getCampaignDetailRows(query, account, action, u.staffId)
}
