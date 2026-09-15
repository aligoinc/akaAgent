// Real campaign form with isolated IPC fixtures. Network is blocked by the runner.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import { FACEBOOK_PAGE_IDENTITY_ACTIONS } from '../src/shared/facebookPageIdentity'
import '../src/renderer/src/styles/global.css'

const actions = [...FACEBOOK_PAGE_IDENTITY_ACTIONS].map(id => ({ id, name: id, flatformType: 'facebook', isActive: true,
  isDelete: false, allowMultipleAccounts: true, allowSecondaryAccount: true }))
const accounts = [11, 12].map(id => ({ id, name: `Facebook ${id}`, flatformType: 'facebook', isActive: true, isDelete: false,
  status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 9 }))
const detail = { id: 5, uid: '100001', name: 'Group thử nghiệm', url: 'https://www.facebook.com/groups/100001', status: 'chờ xử lý' }
const state: any = { calls: [], errors: [], alerts: [], hold: false, pending: [], fail: false, pages: [] }
const resetData = () => Object.assign(state, { calls: [], alerts: [], hold: false, fail: false,
  pages: accounts.flatMap(account => [1, 2].map(index => ({ id: account.id * 10 + index, accountId: account.id, uid: `${account.id}00${index}`,
    name: index === 1 ? `akaBiz — Phần mềm marketing ${account.id}` : `Page thứ hai ${account.id}`, contactType: 'page', isDelete: false, updatedAt: '2026-09-15T03:24:00Z' }))) })
resetData()
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }), listAccounts: () => accounts,
  listContacts: async (accountId: number, type: string) => {
    const result = structuredClone(state.pages.filter((row: any) => row.accountId === accountId && type === 'page'))
    if (state.hold) await new Promise(resolve => state.pending.push(resolve))
    return result
  },
  loadPages: () => state.fail ? { success: false, error: 'Fixture: không tải được Page' } : { success: true, count: 2 },
  listCampaignInputData: () => [detail], listCampaignInputDataPage: () => ({ items: [detail], total: 1 }),
  createCampaign: (payload: any) => ({ ...payload, id: 31 }), updateCampaign: (id: number, payload: any) => ({ ...payload, id }),
  createCampaignInputDataBatch: (rows: any[]) => rows.map((row, index) => ({ ...row, id: index + 1 })),
  saveCampaignDraft: (request: any) => ({ ...request, id: request.id || '61b21e19-7ed9-419f-af2c-fc124eea4c81', revision: 2, updatedAt: new Date().toISOString() })
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
useCampaignStore.setState({ accounts: accounts as any, campaignActions: actions as any, campaigns: [],
  loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })

function App() {
  const [options, setOptions] = useState<any>({ mode: 'new', actionId: 'facebook_join_group', accountIds: [11], generation: 0 })
  ;(window as any).pageSmoke = { state, actions: [...FACEBOOK_PAGE_IDENTITY_ACTIONS],
    open: (mode: string, actionId = 'facebook_join_group', accountIds = [11]) => { resetData(); setOptions((old: any) => ({ mode, actionId, accountIds, generation: old.generation + 1 })) },
    release: () => { state.hold = false; state.pending.splice(0).forEach((resolve: any) => resolve()) } }
  const formData = { name: 'Tham gia group bằng Page', actionId: options.actionId, accountIds: options.accountIds, schedule: '2035-01-01T09:00',
    content: 'Nội dung thử nghiệm', runAsPage: true, runAsPageUid: '11001', runAsPageName: 'akaBiz — Phần mềm marketing 11' }
  const base: any = { id: 7, name: formData.name, actionId: options.actionId, accountId: 11, schedule: formData.schedule,
    content: formData.content, status: 'tạm dừng', secondaryAccountId: null, extraSettings: formData }
  const savedDraft: any = { id: '61b21e19-7ed9-419f-af2c-fc124eea4c81', revision: 1, updatedAt: '2035-01-01T09:00:00+07:00',
    ...formData, payload: { version: 1, values: { formData, details: [detail] } } }
  return options.mode === 'closed' ? null : <CampaignFormModal key={options.generation} onClose={() => setOptions((old: any) => ({ ...old, mode: 'closed' }))}
    campaign={options.mode === 'edit' ? base : options.mode === 'clone' ? { ...base, id: undefined } : null}
    cloneFromId={options.mode === 'clone' ? 7 : undefined} savedDraft={options.mode === 'draft' ? savedDraft : undefined}
    lockedActionId={options.actionId} initialAccountIds={options.accountIds} initialDetails={[detail] as any} />
}
createRoot(document.getElementById('root')!).render(<App />)
