import type { CampaignAccountActionScope, CampaignAccountActionSnapshot, CampaignAccountActionDailyState } from '../../../shared/campaignAccountActionSnapshot'
import { getSupabaseClient } from '../supabaseClient'
import { onCurrentUserSessionChanged, requireCurrentUser } from '../currentUser'
import { getDatabaseRuntimeClock } from './runtimeClockRepository'
import { withRequestDeadline } from '../../services/requestDeadline'
import { canUseAccountActionWithEntitlements, canUseAccountWithEntitlementsAndCapabilities, loadCurrentUserEffectiveEntitlements, loadCurrentUserZaloAccountCapabilities } from './entitlementRepository'

const ACCOUNT_BATCH_SIZE = 100
const STATUS_ROW_BUDGET = 500
const SNAPSHOT_TIMEOUT_MS = 15_000

/** One read-only form snapshot. No history counts, quota writes, unlock RPC, or retry loop. */
export async function getCampaignAccountActionSnapshot(scopes: CampaignAccountActionScope[]): Promise<CampaignAccountActionSnapshot> {
  const user = requireCurrentUser()
  if (!Array.isArray(scopes) || scopes.length > 16 || scopes.some(scope => !scope ||
    !Array.isArray(scope.accountIds) || scope.accountIds.length > 10_000 ||
    scope.accountIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
    !Array.isArray(scope.actionCodes) || scope.actionCodes.length > 32 ||
    scope.actionCodes.some(code => typeof code !== 'string' || !/^[a-z0-9_]{1,100}$/.test(code))
  )) throw new Error('Tài khoản hoặc mã hành động không hợp lệ')

  const requested = new Map<number, Set<string>>()
  for (const scope of scopes) {
    if (scope.actionCodes.length === 0) continue
    for (const id of scope.accountIds) {
      const codes = requested.get(id) ?? new Set<string>()
      scope.actionCodes.forEach(code => codes.add(code))
      requested.set(id, codes)
    }
  }
  if (requested.size > 10_000 || Array.from(requested.values()).some(codes => codes.size > 32)) {
    throw new Error('Phạm vi thống kê hành động quá lớn')
  }
  if (requested.size === 0) return { capturedAt: null, accounts: [] }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS)
  const unsubscribe = onCurrentUserSessionChanged(() => controller.abort())
  const assertCurrent = () => {
    controller.signal.throwIfAborted()
    const current = requireCurrentUser()
    if (current.staffId !== user.staffId || current.organizationId !== user.organizationId ||
      current.chatWebSessionId !== user.chatWebSessionId) throw new Error('Phiên đăng nhập đã thay đổi')
  }
  try {
    const entitlements = await loadCurrentUserEffectiveEntitlements()
    assertCurrent()
    const capabilities = loadCurrentUserZaloAccountCapabilities()
    const client = getSupabaseClient()
    const allCodes = [...new Set(Array.from(requested.values()).flatMap(codes => [...codes]))]
    const { data: catalog, error: catalogError } = await client.from('auto_account_actions')
      .select('code,flatform_type').in('code', allCodes).eq('is_active', true).eq('is_delete', false)
      .abortSignal(controller.signal)
    assertCurrent()
    if (catalogError) throw new Error(`Không tải được danh mục hành động: ${catalogError.message}`)
    const catalogByCode = new Map((catalog || [])
      .filter(action => canUseAccountActionWithEntitlements(action.code, action.flatform_type, entitlements))
      .map(action => [String(action.code), String(action.flatform_type)]))
    if (catalogByCode.size === 0) return { capturedAt: null, accounts: [] }

    const groups = new Map<string, { accountIds: number[]; actionCodes: string[] }>()
    const ids = [...requested.keys()]
    for (let offset = 0; offset < ids.length; offset += ACCOUNT_BATCH_SIZE) {
      const { data: accounts, error } = await client.from('auto_accounts')
        .select('id,flatform_type,is_zalo_show_web,is_zalo_server')
        .in('id', ids.slice(offset, offset + ACCOUNT_BATCH_SIZE))
        .eq('staff_id', user.staffId).eq('organization_id', user.organizationId).eq('is_delete', false)
        .abortSignal(controller.signal)
      assertCurrent()
      if (error) throw new Error(`Không tải được tài khoản: ${error.message}`)
      for (const account of accounts || []) {
        if (!canUseAccountWithEntitlementsAndCapabilities({
          flatformType: account.flatform_type, isZaloShowWeb: account.is_zalo_show_web, isZaloServer: account.is_zalo_server
        }, entitlements, capabilities)) continue
        const actionCodes = [...(requested.get(Number(account.id)) ?? [])]
          .filter(code => catalogByCode.get(code) === account.flatform_type).sort()
        if (!actionCodes.length) continue
        const key = actionCodes.join(',')
        const group = groups.get(key) ?? { accountIds: [], actionCodes }
        group.accountIds.push(Number(account.id))
        groups.set(key, group)
      }
    }
    if (groups.size === 0) return { capturedAt: null, accounts: [] }
    // Bound this caller's wait without cancelling the clock refresh shared with runtime.
    const clock = await withRequestDeadline(controller.signal, getDatabaseRuntimeClock, SNAPSHOT_TIMEOUT_MS)
    assertCurrent()
    const nowMs = Date.parse(clock.dbNow)
    const result: CampaignAccountActionSnapshot = { capturedAt: clock.dbNow, accounts: [] }
    for (const { accountIds, actionCodes } of groups.values()) {
      // Unique (account_id, action_code) bounds each response below the Data API row cap.
      const batchSize = Math.min(ACCOUNT_BATCH_SIZE, Math.floor(STATUS_ROW_BUDGET / actionCodes.length))
      for (let offset = 0; offset < accountIds.length; offset += batchSize) {
        const batch = accountIds.slice(offset, offset + batchSize)
        const { data, error } = await client.from('auto_account_action_status')
          .select('account_id,action_code,count_action_in_day,count_date,is_disable,date_enable')
          .in('account_id', batch).in('action_code', actionCodes).abortSignal(controller.signal)
        assertCurrent()
        if (error) throw new Error(`Không tải được thống kê hành động: ${error.message}`)
        const rows = new Map<string, CampaignAccountActionDailyState>()
        for (const row of data || []) {
          if (String(row.count_date || '') > clock.vietnamDateKey) throw new Error('Ngày thống kê hành động vượt quá ngày hiện tại của DB')
          const enableMs = row.date_enable ? Date.parse(row.date_enable) : Number.NaN
          const hasEnableTime = Number.isFinite(enableMs)
          const isDisable = row.is_disable === true && !(hasEnableTime && enableMs <= nowMs)
          rows.set(`${row.account_id}:${row.action_code}`, {
            actionCode: row.action_code,
            dailyActionCount: row.count_date === clock.vietnamDateKey ? Number(row.count_action_in_day || 0) : 0,
            isDisable,
            remainingMinutes: isDisable && hasEnableTime ? Math.ceil((enableMs - nowMs) / 60_000) : null
          })
        }
        for (const accountId of batch) result.accounts.push({
          accountId,
          actions: actionCodes.map(actionCode => rows.get(`${accountId}:${actionCode}`) ?? {
            actionCode, dailyActionCount: 0, isDisable: false, remainingMinutes: null
          })
        })
      }
    }
    assertCurrent()
    return result
  } finally {
    clearTimeout(timer)
    unsubscribe()
  }
}
