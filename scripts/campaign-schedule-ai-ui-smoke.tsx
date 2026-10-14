import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], requests: [], pending: [], cancels: [], alerts: [], errors: [], deadlines: [] }
const originalTimeout = window.setTimeout.bind(window)
window.setTimeout = ((callback: any, ms?: number, ...args: any[]) => {
  const id = originalTimeout(callback, ms, ...args)
  if (ms === 120000) state.deadlines.push(() => { clearTimeout(id); callback() })
  return id
}) as typeof window.setTimeout
const actions = ['facebook_timeline_post', 'facebook_group_post', 'zalo_message_group_realtime', 'facebook_comment_seeding', 'zalo_message_friend'].map(id => ({
  id, name: id, limitCheckActionCodes: id === 'facebook_timeline_post' ? ['fb_post_my_profile'] : id === 'facebook_group_post' ? ['fb_post_group', 'fb_comment'] : id === 'facebook_comment_seeding' ? ['fb_comment', 'fb_like_post'] : id === 'zalo_message_friend' ? ['zalo_message_friend'] : ['zalo_message_stranger', 'zalo_add_friend'], flatformType: id.startsWith('facebook') ? 'facebook' : 'zalo', isActive: true, isDelete: false
}))
const account: any = { id: 11, name: 'Tài khoản kiểm thử', flatformType: 'facebook', isActive: true, isDelete: false,
  status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 9 }
const detail: any = { id: 5, uid: '100001', name: 'Đích kiểm thử', status: 'chờ xử lý', isDelete: false }
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true, getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}), getSystemSetting: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }), listAccounts: () => [account],
  getAllCampaignActions: () => actions, getAllAccountActions: () => [], getCampaignActionUsage: () => [],
  listCampaignInputData: () => [detail], listCampaignInputDataPage: () => ({ items: [detail], total: 1 }),
  updateCampaign: (id: number, payload: any) => ({ ...payload, id }),
  createCampaign: (payload: any) => ({ ...payload, id: 100 + state.calls.length }),
  saveCampaignDraft: (request: any) => {
    const form = request.payload.values.formData
    state.lastSavedDraft = { ...request, ...form, revision: request.revision + 1,
      updatedAt: new Date().toISOString(), isDelete: false, deletionReason: null, campaignIds: [] }
    return state.lastSavedDraft
  },
  generateCampaignScheduleAi: (request: any) => { state.requests.push(request); return new Promise((resolve, reject) => state.pending.push({ resolve, reject })) },
  cancelCampaignScheduleAi: (id: string) => { state.cancels.push(id) },
  generateCampaignLimitsAi: (request: any) => { state.requests.push(request); return new Promise((resolve, reject) => state.pending.push({ resolve, reject })) },
  cancelCampaignLimitsAi: (id: string) => { state.cancels.push(id) }
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  if (key === 'fileExists') return target[key]
  return async (...args: any[]) => { state.calls.push({ method: key, args }); return key in target ? target[key](...args) : key.startsWith('get') ? null : [] }
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 7, organizationId: 9, entitlements: normalizeEntitlements({ facebookCore: true, zalo: true }) } as any })
useCampaignStore.setState({ accounts: [account], campaignActions: actions as any, campaigns: [],
  loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })
function App() {
  const [generation, setGeneration] = useState(0), [closed, setClosed] = useState(false)
  const [draft, setDraft] = useState<any>(), [newForm, setNewForm] = useState(false)
  const [providedCampaign, setProvidedCampaign] = useState<any>()
  ;(window as any).scheduleSmoke = { state,
    open: () => { setProvidedCampaign(undefined); setDraft(undefined); setNewForm(false); setClosed(false); setGeneration(value => value + 1) },
    // The auth-change smoke clears the real store; simulate its next catalog load before opening another form.
    openDraft: (draft: any) => { useCampaignStore.setState({ accounts: [account], campaignActions: actions as any }); setDraft(draft); setNewForm(false); setClosed(false); setGeneration(value => value + 1) },
    openNew: () => { useCampaignStore.setState({ accounts: [account], campaignActions: actions as any }); setDraft(undefined); setNewForm(true); setClosed(false); setGeneration(value => value + 1) },
    openCampaign: (value: any) => { useCampaignStore.setState({ accounts: [account], campaignActions: actions as any }); setProvidedCampaign(value); setDraft(undefined); setNewForm(false); setClosed(false); setGeneration(value => value + 1) },
    resolve: (result: any) => state.pending.shift().resolve(result), reject: () => state.pending.shift().reject(new Error('raw provider secret')),
    expire: () => state.deadlines.at(-1)(), switchUser: () => useAuthStore.setState(state => ({ user: { ...state.user!, staffId: state.user!.staffId + 1 } })) }
  const campaign: any = { id: 7, name: 'Lịch chạy kiểm thử', actionId: 'facebook_timeline_post', accountId: 11,
    schedule: '2026-10-14T02:00:00Z', scheduleType: 'daily', scheduleEndDate: '2026-10-21T16:59:59Z',
    content: 'Nội dung kiểm thử', status: 'tạm dừng', refreshData: true, continueNextDay: true, extraSettings: {} }
  return closed ? <div>Đã đóng</div> : <CampaignFormModal key={generation} savedDraft={draft}
    campaign={draft ? undefined : newForm ? { ...campaign, id: undefined } : providedCampaign || campaign}
    initialSection="schedule" lockedActionId={providedCampaign?.actionId || "facebook_timeline_post"} initialAccountIds={[11]} initialDetails={[detail]}
    onClose={() => setClosed(true)} />
}
createRoot(document.getElementById('root')!).render(<App />)
