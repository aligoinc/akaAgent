// Tab "Hành động" trong chi tiết chiến dịch: CampaignPanel/CSS thật với IPC giả lập. Không backend, không chạy chiến dịch.
import { root } from './campaign-pending-reason-ui-smoke'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import type { CampaignAccountActionRow, CampaignAccountActionsResult } from '../src/shared/campaignAccountActions'

void root
const state = { reads: [] as number[], unlocks: [] as Array<[number, string]>, locked: true, fail: false, defer: false, pending: [] as Array<() => void> }
const checkedAt = '2026-11-10T03:00:00.000Z'
const row = (code: string, name: string, change: Partial<CampaignAccountActionRow> = {}): CampaignAccountActionRow => ({
  code, name, limited: true, disabled: false, enableAt: null, remainingMinutes: null, disabledReason: null,
  dayUsed: 5, dayLimit: 30, dayLimitSource: 'campaign', dayLimitCapped: false, packageDailyLimit: 40, campaignDayLimit: 30,
  windowUsed: 2, windowLimit: 9, windowMinutes: 65, windowLimitSource: 'campaign', campaignWindowLimit: 9, campaignWindowMinutes: 65,
  ...change
})
const result = (campaignId: number): CampaignAccountActionsResult => ({
  campaignId, accountId: 41, checkedAt, nextDayStartsAt: '2026-11-10T17:00:00.000Z', runtime: 'scheduler',
  groupApplied: true, continueWhenActionLimitReached: true,
  actions: [
    row('fb_message_stranger', 'Nhắn tin người lạ', state.locked
      ? { disabled: true, enableAt: '2026-11-10T03:17:30Z', remainingMinutes: 18, disabledReason: 'Facebook tạm hạn chế nhắn tin cho người lạ',
        dayUsed: 12, dayLimit: 20, dayLimitSource: 'group', windowUsed: 6, windowLimit: 6, windowLimitSource: 'group' }
      : { dayUsed: 12, dayLimit: 20, dayLimitSource: 'group', windowUsed: 6, windowLimit: 6, windowLimitSource: 'group' }),
    row('fb_add_friend', 'Kết bạn', { dayUsed: 40, dayLimit: 40, dayLimitCapped: true, campaignDayLimit: 100, windowUsed: 1, windowLimit: 5, windowMinutes: 60 }),
    row('fb_like_post', 'Like post', { limited: false, dayUsed: 7, dayLimit: null, dayLimitSource: null, packageDailyLimit: null, campaignDayLimit: null,
      windowUsed: null, windowLimit: null, windowMinutes: null, windowLimitSource: null, campaignWindowLimit: null, campaignWindowMinutes: null })
  ]
})
useCampaignStore.setState(store => ({ accounts: store.accounts.map(account => account.id === 41 ? { ...account, accountGroupName: 'Nhóm CSKH' } : account) }))
const existing = window.electronAPI
window.electronAPI = new Proxy(existing, { get(target, key: string) {
  if (key === 'getCampaignAccountActions') return async (campaignId: number) => {
    state.reads.push(campaignId)
    if (state.fail) throw new Error("Error invoking remote method 'campaign:account-actions': Error: Chưa tải được hành động của chiến dịch. Vui lòng thử lại.")
    if (state.defer) return new Promise(resolve => state.pending.push(() => resolve(result(campaignId))))
    return result(campaignId)
  }
  if (key === 'enableAccountActionNow') return async (accountId: number, code: string) => { state.unlocks.push([accountId, code]); state.locked = false; return {} }
  return (target as any)[key]
} }) as any
;(window as any).actionsSmoke = { state, release: () => state.pending.splice(0).forEach(resolve => resolve()) }
