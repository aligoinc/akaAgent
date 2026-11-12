import type { ActionLimitConfig, Campaign, CampaignAction, CampaignActionLimitSettings } from '../../shared/types'
import {
  CAMPAIGN_LIMIT_WINDOW_TIMES_MAX,
  type CampaignLimitAction, type CampaignLimitProgressItem, type CampaignLimitProgressResult
} from '../../shared/campaignLimitProgress'
import type { CampaignAccountActionRow, CampaignAccountActionToday, CampaignAccountActionsResult } from '../../shared/campaignAccountActions'
import { requireCurrentUser } from '../data/currentUser'
import { campaignQuotaCodes, resolveCampaignActionQuotaLimit } from '../data/repositories/campaignDiagnosticsRepository'
import { getAccountActionDailySendLimit, loadCurrentUserEffectiveEntitlements } from '../data/repositories/entitlementRepository'
import { limitPairKey, readCampaignLimitFacts, type LimitFacts, type LimitRow } from '../data/repositories/campaignLimitProgressRepository'
import { getCampaignAccountOverviewActionDescriptors, getCampaignExecutableActionDescriptors } from '../domain/campaigns/campaignActionDescriptors'
import { CampaignAccountActionsError, readCampaignAccountActions } from './campaignAccountActionsService'

/**
 * Cột "Giới hạn lượt" của danh sách chiến dịch và tab "Hành động" dạng thẻ trên Desktop (12/11/2026, port từ
 * WebApp `apps/api/.../campaignLimitProgress.ts`). Số liệu thô từ một lượt RPC V502; danh sách hành động, mã
 * kiểm tra giới hạn, giới hạn hiệu lực và cách đếm dùng đúng các hàm của tab "Hành động"/Chẩn đoán Desktop
 * (`campaignActionDescriptors`, `campaignQuotaCodes`, `resolveCampaignActionQuotaLimit`) nên ba nơi ra cùng số
 * với bộ chạy. Không ghi DB, không cache, không tự thử lại.
 */
type Row = LimitRow
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown) => String(value ?? '')
const iso = (value: unknown): string | null => {
  const raw = text(value)
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString() : null
}
const MOBILE_LIMIT_ACTION_CODES = new Set(['sms_send', 'voice_call'])
const ZALO_COMBINED_MESSAGING = new Set(['zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime',
  'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation'])

/** Giống `isSkippableLimitAction` của bộ chạy (campaignScheduler): hành động được bỏ qua khi hết lượt ngày/giờ. */
function isSkippableLimitAction(actionId: string, code: string): boolean {
  if (code === 'fb_comment') return ['facebook_group_post', 'facebook_timeline_post', 'facebook_newsfeed_interaction'].includes(actionId)
  if (code === 'fb_like_post') {
    return ['facebook_group_post', 'facebook_timeline_post', 'facebook_comment_seeding', 'facebook_comment_seeding_post',
      'facebook_newsfeed_interaction'].includes(actionId)
  }
  if (code === 'fb_message_stranger' || code === 'fb_add_friend') return actionId === 'facebook_message_uid'
  if (code === 'zalo_message_stranger' || code === 'zalo_add_friend') return ZALO_COMBINED_MESSAGING.has(actionId)
  return false
}

/** Lượt tính vào giới hạn theo bộ chạy: akaChat chỉ dòng có cờ; bộ chạy akaAgent cộng dòng cũ NULL (SMS/gọi đếm hết). */
const countedByRuntime = (chat: boolean, code: string, countsTowardLimit: unknown, status: string) =>
  countsTowardLimit === true || (countsTowardLimit == null && !chat
    && (MOBILE_LIMIT_ACTION_CODES.has(code) || status === 'thành công' || status === 'thất bại'))

export interface BuiltCampaignActions {
  result: CampaignAccountActionsResult
  /** Mã hành động bộ chạy thực hiện: hành động ngoài danh sách này bị khóa cũng không làm chiến dịch đứng. */
  executable: string[]
  accountDeleted: boolean
}

/** Dựng dòng hành động của một chiến dịch từ số liệu thô của V502. */
export async function buildDesktopCampaignActions(facts: LimitFacts, row: Row): Promise<BuiltCampaignActions | null> {
  const user = requireCurrentUser()
  const account = object(row.account)
  const campaignId = Number(row.id), accountId = Number(row.accountId)
  if (!Number.isSafeInteger(campaignId) || !Number.isSafeInteger(accountId)) return null
  const actionId = text(row.actionId)
  const extra = object(row.extra)
  const limits = object(extra.actionLimits)
  const platform = text(account.flatform_type)
  // Cùng điều kiện với `readPendingReasonAccount`: Zalo Server của tổ chức akaChat do akaChat chạy.
  const isChatManaged = user.isChatSync === true && platform === 'zalo' && account.is_zalo_server === true && account.is_zalo_show_web !== true
  const group = object(row.group)
  // akaChat chỉ áp nhóm đang hoạt động của cùng tổ chức; bộ chạy akaAgent dùng nhóm đã liên kết.
  const groupApplies = Object.keys(group).length > 0 && (!isChatManaged
    || (group.is_active === true && group.is_delete !== true && Number(group.organization_id) === user.organizationId))
  const groupLimits = groupApplies ? object(object(group.settings).byActionCode) : {}
  const campaign = { actionId, extraSettings: extra } as unknown as Campaign
  const action = { limitCheckActionCodes: Array.isArray(row.limitCheckActionCodes) ? row.limitCheckActionCodes.map(text) : [] } as unknown as CampaignAction
  const quota = campaignQuotaCodes(campaign, action, isChatManaged)
  const executable = getCampaignExecutableActionDescriptors(campaign).map(item => item.code)
  const seen = new Set<string>()
  const display = getCampaignAccountOverviewActionDescriptors(campaign).filter(item => !seen.has(item.code) && !!seen.add(item.code))
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const siblings = facts.siblings.filter(item => Number(item.accountId) === accountId && Number(item.campaignId) !== campaignId)
  const todayRows = facts.todayRows?.filter(item => Number(item.accountId) === accountId) ?? null
  const continueWhenActionLimitReached = limits.continueWhenActionLimitReached === true
  const skippableCodes = continueWhenActionLimitReached ? [...quota].filter(code => isSkippableLimitAction(actionId, code)) : []

  const actions: CampaignAccountActionRow[] = display.map(({ code, name }) => {
    const status = facts.statuses.get(limitPairKey(accountId, code))
    const enableAt = text(status?.dateEnable)
    const enableMs = enableAt ? Date.parse(enableAt) : Number.NaN
    // Khóa đã tới giờ mở lại coi như bình thường (bộ chạy tự mở), không ghi DB.
    const disabled = status?.isDisable === true && (!enableAt || !Number.isFinite(enableMs) || enableMs > facts.nowMs)
    const countDate = text(status?.countDate)
    // Ngày đếm sau hôm nay là dữ liệu không xác minh được: không coi là 0.
    const dayUsed = !status ? 0 : countDate > facts.today ? null : countDate === facts.today ? Math.max(0, Number(status.countActionInDay) || 0) : 0
    const limited = quota.has(code)
    const groupLimit = groupLimits[code] && typeof groupLimits[code] === 'object' ? groupLimits[code] as ActionLimitConfig : undefined
    const limit = limited ? resolveCampaignActionQuotaLimit(code, limits as CampaignActionLimitSettings, groupLimit,
      getAccountActionDailySendLimit(code, null, entitlements)) : null
    const fact = facts.windows.get(limitPairKey(accountId, code))
    let windowTimes: number[] = []
    let windowAtLeast = false
    if (limit && fact) {
      const start = facts.nowMs - limit.rateLimitMinutes * 60_000
      const counted = isChatManaged ? fact.explicit : MOBILE_LIMIT_ACTION_CODES.has(code)
        ? [...fact.explicit, ...fact.legacy, ...fact.other] : [...fact.explicit, ...fact.legacy]
      windowTimes = counted.filter(at => at >= start).sort((left, right) => left - right)
      windowAtLeast = fact.truncated || limit.rateLimitMinutes > fact.lookbackMinutes
    }
    let today: CampaignAccountActionToday | null | undefined
    let lastRunAt: string | null = windowTimes.length ? new Date(windowTimes[windowTimes.length - 1]).toISOString() : null
    if (todayRows) {
      const mine = todayRows.filter(item => text(item.actionCode) === code)
      const statuses = new Map<string, { status: string; counted: number; uncounted: number }>()
      const campaigns = new Map<string, { campaignId: number | null; name: string | null; current: boolean; counted: number }>()
      let counted = 0, uncounted = 0, lastMs = lastRunAt ? Date.parse(lastRunAt) : 0
      for (const item of mine) {
        const n = Math.max(0, Number(item.count) || 0)
        const label = text(item.status) || 'khác'
        const isCounted = countedByRuntime(isChatManaged, code, item.countsTowardLimit, label)
        const entry = statuses.get(label) ?? { status: label, counted: 0, uncounted: 0 }
        if (isCounted) { entry.counted += n; counted += n } else { entry.uncounted += n; uncounted += n }
        statuses.set(label, entry)
        if (isCounted) {
          const id = item.campaignId == null ? null : Number(item.campaignId)
          const key = String(id)
          const owner = campaigns.get(key) ?? { campaignId: id, name: item.campaignName == null ? null : text(item.campaignName), current: id === campaignId, counted: 0 }
          owner.counted += n
          campaigns.set(key, owner)
        }
        const at = Date.parse(text(item.lastAt))
        if (Number.isFinite(at) && at > lastMs) lastMs = at
      }
      today = mine.length ? {
        counted, uncounted,
        statuses: [...statuses.values()].sort((left, right) => (right.counted + right.uncounted) - (left.counted + left.uncounted)),
        campaigns: [...campaigns.values()].sort((left, right) => Number(right.current) - Number(left.current) || right.counted - left.counted)
      } : null
      lastRunAt = lastMs ? new Date(lastMs).toISOString() : null
    }
    return {
      code, name, limited, disabled,
      enableAt: disabled && Number.isFinite(enableMs) ? enableAt : null,
      remainingMinutes: disabled && Number.isFinite(enableMs) ? Math.ceil((enableMs - facts.nowMs) / 60_000) : null,
      disabledReason: disabled ? text(status?.disabledReason).trim() || text(status?.disabledErrorCode).trim() || null : null,
      dayUsed,
      dayLimit: limit?.dailyLimit ?? null,
      dayLimitSource: limit?.dailySource ?? null,
      dayLimitCapped: limit?.dailyCapped ?? false,
      packageDailyLimit: limit?.packageDailyLimit ?? null,
      campaignDayLimit: limit?.campaignDailyLimit ?? null,
      windowUsed: limit ? windowTimes.length : null,
      windowLimit: limit?.rateLimitCount ?? null,
      windowMinutes: limit?.rateLimitMinutes ?? null,
      windowLimitSource: limit?.windowSource ?? null,
      campaignWindowLimit: limit?.campaignRateLimitCount ?? null,
      campaignWindowMinutes: limit?.campaignRateLimitMinutes ?? null,
      windowTimes: windowTimes.slice(0, CAMPAIGN_LIMIT_WINDOW_TIMES_MAX).map(at => new Date(at).toISOString()),
      windowAtLeast,
      lockedAt: disabled ? iso(status?.disabledAt) : null,
      lastRunAt,
      // Chiến dịch khác của tài khoản chạy hôm nay mà loại của nó cũng kiểm tra hành động này.
      sharedCampaigns: limited ? siblings.filter(item => Array.isArray(item.limitCheckActionCodes) && item.limitCheckActionCodes.includes(code)).length : 0,
      ...(today === undefined ? {} : { today })
    }
  })

  const sleep = Number(limits.sleepBetweenActions ?? row.timeSleepBetween2)
  return {
    executable,
    accountDeleted: account.is_delete === true,
    result: {
      campaignId, accountId, checkedAt: facts.checkedAt, nextDayStartsAt: facts.nextDayStartsAt,
      runtime: isChatManaged ? 'chat' : 'scheduler',
      groupApplied: groupApplies,
      groupName: groupApplies ? text(group.name).trim() || null : null,
      continueWhenActionLimitReached,
      actions,
      management: {
        status: text(row.status),
        schedule: iso(row.schedule),
        scheduleType: text(row.scheduleType) || null,
        dailyStopTime: text(row.dailyStopTime) || null,
        sleepSeconds: Number.isFinite(sleep) && sleep >= 0 ? Math.floor(sleep) : null,
        // Facebook chạy workflow có bước tùy chọn: chưa đối chiếu hành động nào làm chiến dịch đứng (giống Web).
        resumeKnown: platform !== 'facebook',
        skippableCodes,
        blockingCodes: actions.filter(item => item.limited || executable.includes(item.code)).map(item => item.code)
      }
    }
  }
}

const toLimitAction = (row: CampaignAccountActionRow): CampaignLimitAction => ({
  code: row.code, name: row.name, limited: row.limited,
  dayUsed: row.dayUsed, dayLimit: row.dayLimit, windowLimit: row.windowLimit, windowMinutes: row.windowMinutes,
  windowUsed: row.windowUsed ?? 0, windowTimes: row.windowTimes ?? [], windowAtLeast: row.windowAtLeast === true,
  locked: row.disabled, lockedUntil: row.enableAt, lockReason: row.disabledReason, sharedCampaigns: row.sharedCampaigns ?? 0
})

/** Tiến độ giới hạn của các chiến dịch trên một trang danh sách. Chiến dịch đã xóa/ngoài phạm vi bị bỏ qua. */
export async function readCampaignLimitProgress(ids: readonly number[], signal: AbortSignal): Promise<CampaignLimitProgressResult> {
  const facts = await readCampaignLimitFacts(ids, false, signal)
  if (!facts) {
    const now = new Date().toISOString()
    return { ready: false, checkedAt: now, nextDayStartsAt: now, items: [] }
  }
  const items: CampaignLimitProgressItem[] = []
  for (const row of facts.campaigns) {
    signal.throwIfAborted()
    const built = await buildDesktopCampaignActions(facts, row)
    if (!built || built.accountDeleted) continue
    const management = built.result.management
    items.push({
      campaignId: built.result.campaignId, accountId: built.result.accountId,
      resumeKnown: management?.resumeKnown !== false,
      skippableCodes: management?.skippableCodes ?? [],
      // Hành động có giới hạn lượt, cộng hành động bộ chạy thực hiện đang bị khóa (khóa cũng làm chiến dịch đứng).
      actions: built.result.actions.filter(item => item.limited || (item.disabled && built.executable.includes(item.code))).map(toLimitAction)
    })
  }
  signal.throwIfAborted()
  return { ready: true, checkedAt: facts.checkedAt, nextDayStartsAt: facts.nextDayStartsAt, items }
}

/**
 * Tab "Hành động": một lượt đọc V502 ở chế độ chi tiết (thêm kết quả hôm nay, chia lượt theo chiến dịch, nhịp
 * chạy và lịch). DB chưa có hàm thì dùng bộ đọc cũ, tab hiện như trước.
 */
export async function readCampaignAccountActionsDetail(id: number, signal: AbortSignal): Promise<CampaignAccountActionsResult> {
  const facts = await readCampaignLimitFacts([id], true, signal)
  const row = facts?.campaigns.find(item => Number(item.id) === id)
  // DB chưa có hàm, hoặc chiến dịch ngoài phạm vi V502 (tổ chức trống/tài khoản khác nhân viên): bộ đọc cũ quyết định.
  if (!facts || !row) return readCampaignAccountActions(id, signal)
  const built = await buildDesktopCampaignActions(facts, row)
  if (!built) throw new CampaignAccountActionsError('Không tìm thấy tài khoản của chiến dịch.')
  if (built.accountDeleted) throw new CampaignAccountActionsError('Tài khoản của chiến dịch đã bị xóa.')
  signal.throwIfAborted()
  return built.result
}
