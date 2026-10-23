// Real React hook and campaign form, with isolated accounts/API and no production access.
import React, { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignAccountActionSnapshot } from '../src/renderer/src/components/CampaignPanels/useCampaignAccountActionSnapshot'
import { useCampaignActionUsage } from '../src/renderer/src/components/CampaignPanels/useCampaignActionUsage'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { campaignVisibilityScope, campaignVisibilitySession } from '../src/renderer/src/stores/campaignTypeVisibilityStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], pending: [], errors: [], autoReply: false,
  hiddenActionIds: [], deferVisibility: false, visibilityPending: [] }
const visibilitySnapshot = (hiddenActionIds: string[], revision = 1) => ({
  organizationId: 1, revision, hiddenActionIds, updatedAt: null, canEdit: false
})
state.configureVisibility = (hiddenActionIds: string[], defer = false, cachedHiddenIds?: string[]) => {
  state.hiddenActionIds = hiddenActionIds; state.deferVisibility = defer; state.visibilityPending = []
  campaignVisibilitySession.reset(campaignVisibilityScope())
  if (cachedHiddenIds) campaignVisibilitySession.accept(visibilitySnapshot(cachedHiddenIds, 0), campaignVisibilityScope())
}
const reply = (codes: string[], count = 12) => codes.map(actionCode => ({ actionCode, dailyActionCount: count, windowActionCount: 3 }))
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  getCampaignActionUsage: (accountId: number, codes: string[]) => {
    state.calls.push({ accountId, codes })
    if (state.autoReply) return reply(codes)
    return new Promise((resolve, reject) => state.pending.push({ resolve: (count: number) => resolve(reply(codes, count)), reject }))
  },
  getCampaignAccountActionSnapshot: (scopes: any[]) => {
    state.calls.push({ scopes })
    const snapshot = (count: number) => ({ capturedAt: '2035-01-02T10:00:00Z', accounts: scopes.flatMap(scope => scope.accountIds.map((accountId: number) => ({
      accountId, actions: scope.actionCodes.map((actionCode: string) => ({ actionCode, dailyActionCount: count,
        isDisable: accountId === 42, remainingMinutes: accountId === 42 && ['fb_message_stranger', 'zalo_message_stranger'].includes(actionCode) ? 18 : null }))
    }))) })
    if (state.autoReply) return snapshot(12)
    return new Promise((resolve, reject) => state.pending.push({ resolve: (count: number) => resolve(snapshot(count)), reject }))
  },
  getCampaignInputDataLimit: () => 10000,
  getCampaignTypeVisibility: () => {
    const snapshot = visibilitySnapshot(state.hiddenActionIds)
    if (!state.deferVisibility) return snapshot
    return new Promise((resolve, reject) => state.visibilityPending.push({ resolve: () => resolve(snapshot), reject }))
  },
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }),
  listSendExclusionGroups: () => ({ catalog: { fields: [], operators: [], mappings: [] }, groups: [], options: [], blocklists: [] })
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  return async (...args: any[]) => key in target ? target[key](...args) : key.startsWith('get') ? null : []
} }) as any
window.addEventListener('error', event => state.errors.push(event.error?.stack || event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 41, organizationId: 1,
  entitlements: normalizeEntitlements({ facebookCore: true, dailySendLimits: { facebookCore: 40, facebookFanpage: 40 } } as any),
  zaloAccountCapabilities: { qr: false, web: false, server: false }
} as any })
useCampaignStore.setState({
  accountCatalogVersion: 'fixture-ready', loadingAccounts: false,
  accounts: [41, 42].map(id => ({ id, name: `Facebook smoke ${id}`, flatformType: 'facebook', status: 'chờ xử lý',
    loginStatus: 'đã đăng nhập', isActive: true, isDelete: false, rateLimitMinutes: 65,
    accountGroupId: id === 41 ? 1 : null, accountGroupName: id === 41 ? 'Nhóm smoke' : null,
    accountGroupSettings: id === 41 ? { byActionCode: { fb_message_stranger: { dailyLimit: 50, rateLimitCount: 7, rateLimitMinutes: 90 } } } : null
  } as any)),
  accountGroups: [{ id: 1, name: 'Nhóm smoke', flatformType: 'facebook' }] as any,
  campaignActions: [
    { id: 'facebook_message_uid', name: 'Nhắn tin UID', flatformType: 'facebook', isActive: true, isDelete: false,
      limitCheckActionCodes: ['fb_message_stranger', 'fb_add_friend'] },
    { id: 'facebook_timeline_post', name: 'Đăng bài trang cá nhân', flatformType: 'facebook', isActive: true, isDelete: false,
      limitCheckActionCodes: ['fb_post_my_profile'] }
  ] as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {},
  loadAccounts: async () => {}, loadCampaignActions: async () => {}
})

function Probe({ selection }: { selection: any }) {
  const usage = useCampaignActionUsage(selection.accountId, selection.actionId, selection.codes, '1:41')
  return <pre id="usage-probe">{JSON.stringify(usage)}</pre>
}
function SnapshotProbe({ selection }: { selection: any }) {
  const snapshot = useCampaignAccountActionSnapshot(selection.scopes || [], selection.ready === true, selection.userScope || '')
  return <pre id="snapshot-probe">{JSON.stringify({ status: snapshot.status, snapshot: snapshot.snapshot })}</pre>
}
function App() {
  const [selection, setSelection] = useState({ accountId: null, actionId: '', codes: [] } as any)
  const [mode, setMode] = useState('probe')
  const [generation, setGeneration] = useState(0)
  state.select = (patch: any) => setSelection((previous: any) => ({ ...previous, ...patch }))
  state.openSnapshotProbe = () => { state.autoReply = false; state.calls = []; state.pending = []; setMode('snapshot-probe'); setGeneration(value => value + 1) }
  state.openZaloForm = (options: { actionId?: string; extraActionId?: string; onlyWeb?: boolean; locked?: boolean } = {}) => {
    state.autoReply = true; state.calls = []
    state.zaloActionId = options.actionId || 'zalo_message_phone'
    state.zaloLocked = options.locked === true
    useAuthStore.setState({ user: { staffId: 41, organizationId: 1,
      entitlements: normalizeEntitlements({ zalo: true } as any),
      zaloAccountCapabilities: { qr: true, web: true, server: true }
    } as any })
    useCampaignStore.setState({ accountCatalogVersion: 'zalo-fixture',
      accounts: ['zl MN sv', 'ax', 'zl MN', 'zl QN', 'zl QN sv', 'zl QN 2'].map((name, index) => ({
        id: 41 + index, name, flatformType: 'zalo', status: 'chờ xử lý',
        isZaloServer: index === 0 || index === 4, isZaloShowWeb: index === 5,
        loginStatus: index === 4 ? 'đã đăng nhập' : 'chưa đăng nhập',
        isActive: true, isDelete: false, accountGroupId: index < 2 ? index + 1 : index < 4 ? 3 : null
      })).filter(account => !options.onlyWeb || account.isZaloShowWeb) as any,
      accountGroups: ['abcde', 'Zw', 'zalo test'].map((name, index) => ({ id: index + 1, name, flatformType: 'zalo' })) as any,
      campaignActions: [
        { id: 'zalo_message_phone', name: 'Zalo - Nhắn tin, kết bạn đến SĐT', flatformType: 'zalo',
          allowSecondaryAccount: true, limitCheckActionCodes: ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend'] },
        { id: 'zalo_message_group_realtime', name: 'Zalo - Nhắn tin thành viên theo thời gian thực', flatformType: 'zalo',
          limitCheckActionCodes: ['zalo_message_stranger', 'zalo_add_friend'] },
        { id: 'zalo_message_group', name: 'Zalo - Nhắn tin group', flatformType: 'zalo',
          limitCheckActionCodes: ['zalo_message_group'] }
      ].filter(action => action.id === state.zaloActionId || action.id === options.extraActionId) as any
    })
    setMode('zalo'); setGeneration(value => value + 1)
  }
  state.openForm = (mode: string) => { state.autoReply = true; state.calls = []; setMode(mode); setGeneration(value => value + 1) }
  state.openGroupPostForm = () => {
    useCampaignStore.setState({ campaignActions: [{ id: 'facebook_group_post', name: 'Đăng bài group', flatformType: 'facebook',
      limitCheckActionCodes: ['fb_post_group', 'fb_comment'] }] as any })
    state.openForm('group-post')
  }
  state.openInteractionForm = (actionId: string) => {
    state.interactionActionId = actionId
    useCampaignStore.setState({ campaignActions: [{ id: actionId, name: actionId, flatformType: 'facebook',
      limitCheckActionCodes: actionId === 'facebook_newsfeed_interaction' ? ['fb_comment', 'fb_like_post'] : ['fb_comment'] }] as any })
    state.openForm('interaction')
  }
  ;(window as any).usageFixture = state
  const base: any = { id: 91, name: 'Kiểm tra thống kê', accountId: 41, actionId: 'facebook_message_uid',
    status: 'chờ xử lý', scheduleType: 'daily', schedule: '2035-01-02T09:00', extraSettings: { enableMessage: true, enableAddFriend: true } }
  const draft: any = { id: '11111111-1111-4111-8111-111111111111', name: 'Nháp thống kê', revision: 1,
    payload: { version: 1, values: { formData: { accountIds: [41], actionId: base.actionId, enableMessage: true, enableAddFriend: true } } } }
  return mode === 'probe' ? <Probe selection={selection} /> : mode === 'snapshot-probe' ? <SnapshotProbe key={generation} selection={selection} /> : <CampaignFormModal key={`${mode}:${generation}`}
    onClose={() => setMode('probe')} initialAccountIds={mode === 'multiple' ? [41, 42] : [41]}
    draftMode={mode === 'zalo' && state.zaloLocked}
    lockedActionId={mode === 'unselected' ? undefined : mode === 'zalo' ? state.zaloActionId : mode === 'interaction' ? state.interactionActionId : mode === 'group-post' ? 'facebook_group_post' : base.actionId} savedDraft={mode === 'draft' ? draft : undefined}
    campaign={mode === 'zalo' ? { ...base, id: undefined, actionId: state.zaloActionId }
      : mode === 'group-post' ? { ...base, id: undefined, actionId: 'facebook_group_post', extraSettings: { enableComment: true, enablePostLike: true } }
      : mode === 'interaction' ? { ...base, id: undefined, actionId: state.interactionActionId, extraSettings: { enableComment: false, enablePostLike: false } }
      : mode === 'locked-edit' ? { ...base, dataTargetSourceMode: 'data_group' }
      : mode === 'edit' ? base : mode === 'clone' ? { ...base, id: undefined } : null}
    cloneFromId={mode === 'clone' ? 91 : undefined} />
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
