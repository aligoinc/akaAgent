// Tab "Hành động" (dạng thẻ) và cột "Giới hạn lượt" của danh sách chiến dịch: CampaignPanel/CSS thật với IPC giả lập.
// Không backend, không chạy chiến dịch. Số liệu theo dạng V502 (giờ từng lượt trong khung giờ, kết quả hôm nay, quản trị).
import { root } from './campaign-pending-reason-ui-smoke'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import type { CampaignAccountActionRow, CampaignAccountActionsResult } from '../src/shared/campaignAccountActions'
import type { CampaignLimitProgressResult } from '../src/shared/campaignLimitProgress'

void root
const state = {
  reads: [] as number[], unlocks: [] as Array<[number, string]>, locked: true, fail: false, defer: false, pending: [] as Array<() => void>,
  progressReads: [] as number[][], progressReady: true
}
const checkedAt = '2026-11-10T03:00:00.000Z'
const at = (hhmm: string) => `2026-11-10T${hhmm}:00.000Z`
const row = (code: string, name: string, change: Partial<CampaignAccountActionRow> = {}): CampaignAccountActionRow => ({
  code, name, limited: true, disabled: false, enableAt: null, remainingMinutes: null, disabledReason: null,
  dayUsed: 5, dayLimit: 30, dayLimitSource: 'campaign', dayLimitCapped: false, packageDailyLimit: 40, campaignDayLimit: 30,
  windowUsed: 2, windowLimit: 9, windowMinutes: 65, windowLimitSource: 'campaign', campaignWindowLimit: 9, campaignWindowMinutes: 65,
  windowTimes: [], windowAtLeast: false, lockedAt: null, lastRunAt: null, sharedCampaigns: 0,
  ...change
})
// 6 lượt Nhắn tin người lạ trong khung 65 phút (rời khung lúc 10:05, 10:15, ... giờ Việt Nam).
const strangerTimes = ['02:00', '02:10', '02:20', '02:30', '02:40', '02:50'].map(at)
const result = (campaignId: number): CampaignAccountActionsResult => ({
  campaignId, accountId: 41, checkedAt, nextDayStartsAt: '2026-11-10T17:00:00.000Z', runtime: 'scheduler',
  groupApplied: true, groupName: 'Nhóm CSKH', continueWhenActionLimitReached: true,
  actions: [
    row('fb_message_stranger', 'Nhắn tin người lạ', {
      dayUsed: 12, dayLimit: 20, dayLimitSource: 'group', windowUsed: 6, windowLimit: 6, windowLimitSource: 'group',
      windowTimes: strangerTimes, lastRunAt: at('02:50'), sharedCampaigns: 1,
      today: { counted: 12, uncounted: 2,
        statuses: [{ status: 'thành công', counted: 9, uncounted: 0 }, { status: 'thất bại', counted: 3, uncounted: 0 }, { status: 'lỗi', counted: 0, uncounted: 2 }],
        campaigns: [{ campaignId, name: `Chiến dịch ${campaignId}`, current: true, counted: 8 }, { campaignId: 77, name: 'Chiến dịch tháng 11', current: false, counted: 4 }] },
      ...(state.locked ? { disabled: true, enableAt: '2026-11-10T03:17:30Z', remainingMinutes: 18, disabledReason: 'Facebook tạm hạn chế nhắn tin cho người lạ', lockedAt: at('02:51') } : {})
    }),
    row('fb_add_friend', 'Kết bạn', { dayUsed: 40, dayLimit: 40, dayLimitCapped: true, campaignDayLimit: 100, windowUsed: 1, windowLimit: 5, windowMinutes: 60,
      windowTimes: [at('02:30')], today: null }),
    row('fb_like_post', 'Like post', { limited: false, dayUsed: 7, dayLimit: null, dayLimitSource: null, packageDailyLimit: null, campaignDayLimit: null,
      windowUsed: null, windowLimit: null, windowMinutes: null, windowLimitSource: null, campaignWindowLimit: null, campaignWindowMinutes: null,
      today: { counted: 0, uncounted: 7, statuses: [{ status: 'thành công', counted: 0, uncounted: 7 }], campaigns: [] } })
  ],
  management: {
    status: 'chờ xử lý', schedule: '2026-11-10T04:30:00.000Z', scheduleType: 'daily', dailyStopTime: '18:00:00', sleepSeconds: 120,
    resumeKnown: true, skippableCodes: ['fb_message_stranger', 'fb_add_friend'], blockingCodes: ['fb_message_stranger', 'fb_add_friend']
  }
})
const progress = (ids: number[]): CampaignLimitProgressResult => ({
  ready: state.progressReady, checkedAt, nextDayStartsAt: '2026-11-10T17:00:00.000Z',
  items: state.progressReady ? ids.map(campaignId => ({
    campaignId, accountId: 41, resumeKnown: true, skippableCodes: [],
    actions: [
      { code: 'fb_message_stranger', name: 'Nhắn tin người lạ', limited: true, dayUsed: 12, dayLimit: 20, windowLimit: 6, windowMinutes: 65,
        windowUsed: 6, windowTimes: strangerTimes, windowAtLeast: false, locked: state.locked && campaignId !== 92,
        lockedUntil: state.locked && campaignId !== 92 ? '2026-11-10T03:17:30Z' : null,
        lockReason: state.locked && campaignId !== 92 ? 'Facebook tạm hạn chế nhắn tin cho người lạ' : null, sharedCampaigns: 1 },
      { code: 'fb_add_friend', name: 'Kết bạn', limited: true, dayUsed: 40, dayLimit: 40, windowLimit: 5, windowMinutes: 60,
        windowUsed: 1, windowTimes: [at('02:30')], windowAtLeast: false, locked: false, lockedUntil: null, lockReason: null, sharedCampaigns: 0 }
    ]
  })) : []
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
  if (key === 'getCampaignLimitProgress') return async (ids: number[]) => { state.progressReads.push(ids.slice()); return progress(ids) }
  if (key === 'enableAccountActionNow') return async (accountId: number, code: string) => { state.unlocks.push([accountId, code]); state.locked = false; return {} }
  return (target as any)[key]
} }) as any
;(window as any).actionsSmoke = { state, release: () => state.pending.splice(0).forEach(resolve => resolve()) }
