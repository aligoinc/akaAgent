// Real React hook and campaign form, with isolated accounts/API and no production access.
import React, { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignActionUsage } from '../src/renderer/src/components/CampaignPanels/useCampaignActionUsage'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], pending: [], errors: [], autoReply: false }
const reply = (codes: string[], count = 12) => codes.map(actionCode => ({ actionCode, dailyActionCount: count, windowActionCount: 3 }))
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  getCampaignActionUsage: (accountId: number, codes: string[]) => {
    state.calls.push({ accountId, codes })
    if (state.autoReply) return reply(codes)
    return new Promise((resolve, reject) => state.pending.push({ resolve: (count: number) => resolve(reply(codes, count)), reject }))
  },
  getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 })
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  return async (...args: any[]) => key in target ? target[key](...args) : key.startsWith('get') ? null : []
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 41, organizationId: 1,
  entitlements: normalizeEntitlements({ facebookCore: true, dailySendLimits: { facebookCore: 40, facebookFanpage: 40 } } as any),
  zaloAccountCapabilities: { qr: false, web: false, server: false }
} as any })
useCampaignStore.setState({
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
      limitCheckActionCodes: ['fb_post'] }
  ] as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {},
  loadAccounts: async () => {}, loadCampaignActions: async () => {}
})

function Probe({ selection }: { selection: any }) {
  const usage = useCampaignActionUsage(selection.accountId, selection.actionId, selection.codes, '1:41')
  return <pre id="usage-probe">{JSON.stringify(usage)}</pre>
}
function App() {
  const [selection, setSelection] = useState({ accountId: null, actionId: '', codes: [] } as any)
  const [mode, setMode] = useState('probe')
  const [generation, setGeneration] = useState(0)
  state.select = (patch: any) => setSelection((previous: any) => ({ ...previous, ...patch }))
  state.openForm = (mode: string) => { state.autoReply = true; state.calls = []; setMode(mode); setGeneration(value => value + 1) }
  ;(window as any).usageFixture = state
  const base: any = { id: 91, name: 'Kiểm tra thống kê', accountId: 41, actionId: 'facebook_message_uid',
    status: 'chờ xử lý', scheduleType: 'daily', schedule: '2035-01-02T09:00', extraSettings: { enableMessage: true, enableAddFriend: true } }
  const draft: any = { id: '11111111-1111-4111-8111-111111111111', name: 'Nháp thống kê', revision: 1,
    payload: { version: 1, values: { formData: { accountIds: [41], actionId: base.actionId, enableMessage: true, enableAddFriend: true } } } }
  return mode === 'probe' ? <Probe selection={selection} /> : <CampaignFormModal key={`${mode}:${generation}`}
    onClose={() => setMode('probe')} initialAccountIds={mode === 'multiple' ? [41, 42] : [41]}
    lockedActionId={base.actionId} savedDraft={mode === 'draft' ? draft : undefined}
    campaign={mode === 'edit' ? base : mode === 'clone' ? { ...base, id: undefined } : null}
    cloneFromId={mode === 'clone' ? 91 : undefined} />
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
