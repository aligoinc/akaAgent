import { FACEBOOK_AI_SECTIONS, FACEBOOK_AI_ACTIONS, FACEBOOK_AI_FIELDS, parseFacebookAiResponse, validateFacebookAiRequest } from '../src/shared/campaignFacebookAi'
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { campaignEdit } from '../src/renderer/src/components/CampaignPanels/campaignEdit'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'
import exclusionPage from './fixtures/send-exclusion-ui-page.json'

const state: any = { calls: [], requests: [], pending: [], cancels: [], alerts: [], errors: [], deadlines: [] }
// This fixture exercises AI/drafts. The status-choice dialog has its own edit-flow suite.
campaignEdit.chooseSaveStatus = async () => 'tạm dừng'
state.formAiRows = ['campaign.schedule', 'campaign.action_limits', 'campaign.content', 'campaign.send_exclusions', ...Object.values(FACEBOOK_AI_SECTIONS)].map(sectionId => ({ sectionId, campaignScope: 'all', campaignActionIds: [] }))
state.metadataPending = []
const originalTimeout = window.setTimeout.bind(window)
window.setTimeout = ((callback: any, ms?: number, ...args: any[]) => {
  const id = originalTimeout(callback, ms, ...args)
  if (ms === 120000) state.deadlines.push(() => { clearTimeout(id); callback() })
  return id
}) as typeof window.setTimeout
const actions = [...FACEBOOK_AI_ACTIONS, 'zalo_message_group_realtime', 'zalo_message_friend', 'email_send'].map(id => ({
  id, allowSecondaryAccount: id === 'facebook_group_post', name: id, limitCheckActionCodes: id === 'facebook_timeline_post' ? ['fb_post_my_profile'] : id === 'facebook_group_post' ? ['fb_post_group', 'fb_comment'] : id === 'facebook_comment_seeding' ? ['fb_comment', 'fb_like_post'] : id === 'zalo_message_friend' ? ['zalo_message_friend'] : id === 'email_send' ? ['email_send'] : ['zalo_message_stranger', 'zalo_add_friend'], flatformType: id.startsWith('facebook') ? 'facebook' : id === 'email_send' ? 'email' : 'zalo', isActive: true, isDelete: false
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
  listCampaignFormAi: () => state.deferMetadata ? new Promise(resolve => state.metadataPending.push(resolve)) : state.formAiRows,
  generateCampaignScheduleAi: (request: any) => { state.requests.push(request); return new Promise((resolve, reject) => state.pending.push({ resolve, reject })) },
  cancelCampaignScheduleAi: (id: string) => { state.cancels.push(id) },
  generateCampaignLimitsAi: (request: any) => { state.requests.push(request); return new Promise((resolve, reject) => state.pending.push({ resolve, reject })) },
  generateCampaignContentAi: (request: any) => { state.requests.push(request); return new Promise((resolve, reject) => state.pending.push({ resolve, reject })) },
  cancelCampaignContentAi: (id: string) => { state.cancels.push(id) },
  cancelCampaignLimitsAi: (id: string) => { state.cancels.push(id) }
}
handlers.generateCampaignFacebookAi = (request: any) => { state.requests.push(request); return new Promise((resolve, reject) => state.pending.push({ resolve, reject })) }
handlers.cancelCampaignFacebookAi = (id: string) => { state.cancels.push(id) }
handlers.generateCampaignExclusionAi = (request: any) => { state.requests.push(request); return new Promise((resolve, reject) => state.pending.push({ resolve, reject })) }
handlers.cancelCampaignExclusionAi = (id: string) => { state.cancels.push(id) }
handlers.listSendExclusionGroups = (id: number) => ({ ...structuredClone(exclusionPage),
  groups: exclusionPage.groups.map(group => ({ ...group, accountId: id })) })
handlers.saveSendExclusionGroup = (group: any) => ({ ...group, id: 50, revision: group.revision + 1 })
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  if (key === 'fileExists') return target[key]
  return async (...args: any[]) => { state.calls.push({ method: key, args }); return key in target ? target[key](...args) : key.startsWith('get') ? null : [] }
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 7, organizationId: 9, entitlements: normalizeEntitlements({ facebookCore: true, zalo: true, email: true }) } as any })
useCampaignStore.setState({ accounts: [account], campaignActions: actions as any, campaigns: [],
  loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })
function App() {
  const [generation, setGeneration] = useState(0), [closed, setClosed] = useState(false)
  const [draft, setDraft] = useState<any>(), [newForm, setNewForm] = useState(false)
  const [providedCampaign, setProvidedCampaign] = useState<any>()
  const [initialAccounts, setInitialAccounts] = useState([11])
  ;(window as any).scheduleSmoke = { state,
    openFacebook: (actionId: string, extraSettings: any = {}, campaignOverrides: any = {}, extraAccountIds: number[] = []) => {
      useCampaignStore.setState({ accounts: [account, {...account, id:12, name:'Tài khoản thứ hai'}, ...extraAccountIds.map(id => ({...account,id,name:'Tài khoản '+id}))], campaignActions: actions as any })
      setInitialAccounts([11]); setDraft(undefined); setNewForm(false); setProvidedCampaign({
        name: 'Facebook kiểm thử', actionId, accountId:11, status:'tạm dừng', schedule:'2026-10-23T02:00:00Z', scheduleType:'daily', content:'Giữ nội dung', extraSettings, ...campaignOverrides
      }); setClosed(false); setGeneration(value => value + 1)
    },
    openExclusions: () => {
      const zalo = { ...account, flatformType: 'zalo', connectionMethod: 'qr' }
      useCampaignStore.setState({ accounts: [zalo, { ...zalo, id: 12, name: 'Zalo phụ' }], campaignActions: actions as any })
      setInitialAccounts([11, 12]); setDraft(undefined); setNewForm(false)
      setProvidedCampaign({ name: 'Loại trừ kiểm thử', actionId: 'zalo_message_friend', accountId: 11,
        content: 'Giữ nội dung', schedule: '2026-10-20T02:00:00Z', scheduleType: 'daily',
        status: 'tạm dừng', extraSettings: { enableMessage: true, zaloFriendTargetMode: 'all_friends',
          zaloSendExclusionsByAccountId: { '11': { groupId: 1, blocklistIds: [4] }, '12': { groupId: null, blocklistIds: [] } } } })
      setClosed(false); setGeneration(value => value + 1)
    },
    openMixedWindows: () => {
      useCampaignStore.setState({ accounts: [{ ...account, rateLimitMinutes: 30 },
        { ...account, id: 12, name: 'Tài khoản thứ hai', rateLimitMinutes: 60 }], campaignActions: actions as any })
      setInitialAccounts([11, 12]); setProvidedCampaign(undefined); setDraft(undefined); setNewForm(true)
      setClosed(false); setGeneration(value => value + 1)
    },
    open: () => { setProvidedCampaign(undefined); setDraft(undefined); setNewForm(false); setClosed(false); setGeneration(value => value + 1) },
    // The auth-change smoke clears the real store; simulate its next catalog load before opening another form.
    openDraft: (draft: any) => { useCampaignStore.setState({ accounts: [account], campaignActions: actions as any }); setDraft(draft); setNewForm(false); setClosed(false); setGeneration(value => value + 1) },
    openNew: () => { useCampaignStore.setState({ accounts: [account], campaignActions: actions as any }); setDraft(undefined); setNewForm(true); setClosed(false); setGeneration(value => value + 1) },
    openCampaign: (value: any) => { useCampaignStore.setState({ accounts: [account], campaignActions: actions as any }); setProvidedCampaign(value); setDraft(undefined); setNewForm(false); setClosed(false); setGeneration(value => value + 1) },
    resolveFacebookOutput: (patch: any) => {
      const request = validateFacebookAiRequest(state.requests.at(-1))
      const wire = { status:'ok', reason:'', changes:{ ...Object.fromEntries(Object.keys(FACEBOOK_AI_FIELDS[request.kind]).map(key => [key,null])), ...patch } }
      // Real parser at the IPC boundary; fixture catalog is already authorized.
      const result = parseFacebookAiResponse(JSON.stringify(wire), request, {
        accounts:useCampaignStore.getState().accounts.map(({id,name}) => ({id,name})), pages:[{accountId:12,uid:'page-b',name:'Page B'}], allowMultipleAccounts:!request.singleAccountOnly, hasSecondaryAccount:request.secondaryAccountId !== null, secondaryAccount:null
      })
      state.pending.shift().resolve(result)
      return result
    },
    resolve: (result: any) => state.pending.shift().resolve(result), reject: () => state.pending.shift().reject(new Error('raw provider secret')),
    expire: () => state.deadlines.at(-1)(), switchUser: () => useAuthStore.setState(state => ({ user: { ...state.user!, staffId: state.user!.staffId + 1 } })) }
  const campaign: any = { id: 7, name: 'Lịch chạy kiểm thử', actionId: 'facebook_timeline_post', accountId: 11,
    schedule: '2026-10-14T02:00:00Z', scheduleType: 'daily', scheduleEndDate: '2026-10-21T16:59:59Z',
    content: 'Nội dung kiểm thử', status: 'tạm dừng', refreshData: true, continueNextDay: true, extraSettings: {} }
  return closed ? <div>Đã đóng</div> : <CampaignFormModal key={generation} savedDraft={draft}
    campaign={draft ? undefined : newForm ? { ...campaign, id: undefined } : providedCampaign || campaign}
    initialSection="schedule" lockedActionId={providedCampaign?.actionId || "facebook_timeline_post"} initialAccountIds={initialAccounts} initialDetails={[detail]}
    onClose={() => setClosed(true)} />
}
createRoot(document.getElementById('root')!).render(<App />)
