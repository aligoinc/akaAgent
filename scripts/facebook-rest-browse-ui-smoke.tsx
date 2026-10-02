import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const actions = ['facebook_group_post', 'facebook_comment_seeding', 'facebook_message_uid', 'facebook_comment_seeding_post', 'facebook_message_friend'].map(id => ({
  id, name: id, flatformType: 'facebook', isActive: true, isDelete: false, allowMultipleAccounts: true,
  limitCheckActionCodes: ['fb_post_group', 'fb_comment', 'fb_message_stranger']
}))
const account = { id: 11, name: 'Facebook kiểm thử', flatformType: 'facebook', isActive: true, isDelete: false,
  status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 9 }
const detail = { id: 5, uid: '100001', name: 'Đích kiểm thử', status: 'chờ xử lý', isDelete: false }
const savedSettings = { enabled: true, browseSeconds: 240, restSeconds: 30, browseTarget: true, browseHome: false }
const state: any = { calls: [], errors: [], alerts: [], draft: null }
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true, getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}), getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }), listAccounts: () => [account],
  getAllCampaignActions: () => actions, getAllAccountActions: () => [],
  getCampaignActionUsage: () => [],
  listCampaignInputData: () => [detail], listCampaignInputDataPage: () => ({ items: [detail], total: 1 }),
  createCampaign: (payload: any) => ({ ...payload, id: 31 }), updateCampaign: (id: number, payload: any) => ({ ...payload, id }),
  createCampaignInputDataBatch: (rows: any[]) => rows.map((row, index) => ({ ...row, id: index + 1 })),
  saveCampaignDraft: (request: any) => {
    const draft = { ...request, id: request.id || '61b21e19-7ed9-419f-af2c-fc124eea4c81', revision: 2, updatedAt: new Date().toISOString() }
    state.draft = draft; return draft
  }
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  if (key === 'fileExists') return target[key]
  return async (...args: any[]) => { state.calls.push({ method: key, args }); return key in target ? target[key](...args) : key.startsWith('get') ? null : [] }
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 7, organizationId: 9, entitlements: normalizeEntitlements({ facebookCore: true }) } as any })
useCampaignStore.setState({ accounts: [account] as any, campaignActions: actions as any, campaigns: [],
  loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })

function App() {
  const [options, setOptions] = useState<any>({ mode: 'new', actionId: 'facebook_group_post', generation: 0 })
  ;(window as any).restSmoke = { state, open: (mode: string, actionId = 'facebook_group_post') => {
    state.calls = []; state.alerts = []; setOptions((old: any) => ({ mode, actionId, generation: old.generation + 1 }))
  } }
  const formData = { name: 'Chiến dịch kiểm thử', actionId: options.actionId, accountIds: [11], schedule: '2035-01-01T09:00',
    content: 'Nội dung kiểm thử', commentContent: 'Bình luận kiểm thử', enableMessage: true, enableAddFriend: true, facebookRestBrowse: savedSettings }
  const base: any = { id: 7, name: formData.name, actionId: options.actionId, accountId: 11, schedule: formData.schedule,
    content: formData.content, status: 'tạm dừng', extraSettings: formData }
  const draft: any = state.draft || { id: '61b21e19-7ed9-419f-af2c-fc124eea4c81', revision: 1, ...formData,
    payload: { version: 1, values: { formData, details: [detail] } } }
  return options.mode === 'closed' ? null : <CampaignFormModal key={options.generation} onClose={() => setOptions((old: any) => ({ ...old, mode: 'closed' }))}
    campaign={options.mode === 'edit' ? base : options.mode === 'clone' ? { ...base, id: undefined } : null}
    cloneFromId={options.mode === 'clone' ? 7 : undefined} savedDraft={options.mode === 'draft' ? draft : undefined}
    lockedActionId={options.actionId} initialAccountIds={[11]} initialDetails={[detail] as any} />
}
createRoot(document.getElementById('root')!).render(<App />)
