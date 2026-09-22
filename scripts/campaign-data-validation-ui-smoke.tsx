// Real campaign form with isolated IPC; the runner blocks every HTTP request.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], alerts: [], errors: [], insertedCount: null, nextId: 100 }
const accounts = [11, 12, 13, 41, 42, 43].map(id => ({ id, name: `Fixture ${id}`, flatformType: id < 40 ? 'zalo' : 'facebook', isActive: true, isDelete: false,
  isZaloServer: true, isZaloShowWeb: false, status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 9 }))
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }), listAccounts: () => accounts,
  listCampaignInputData: () => [],
  createCampaign: (payload: any) => ({ ...payload, id: state.nextId++ }),
  createCampaignInputDataBatch: (rows: any[]) => state.insertedCount ?? rows.length,
  snapshotDataGroupToCampaign: () => ({ insertedCount: 0, alreadySeenCount: 0 }),
  saveCampaignDraft: (request: any) => ({ ...request, ...request.payload.values.formData, revision: 2, updatedAt: new Date().toISOString() }),
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  if (key === 'fileExists') return target[key]
  return async (...args: any[]) => {
    state.calls.push({ method: key, args })
    return key in target ? target[key](...args) : key.startsWith('get') ? null : []
  }
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 7, organizationId: 9, entitlements: normalizeEntitlements({ zalo: true, facebookCore: true }),
  zaloAccountCapabilities: { qr: true, web: true, server: true } } as any })
useCampaignStore.setState({ accounts: accounts as any,
  campaignActions: ['zalo_message_group', 'zalo_message_friend', 'zalo_message_phone', 'zalo_join_group_link',
    'facebook_message_uid', 'facebook_find_data_group', 'facebook_find_data_search',
    'facebook_timeline_post', 'facebook_newsfeed_interaction'].map(id => ({ id, name: id, flatformType: id.startsWith('zalo_') ? 'zalo' : 'facebook',
    isActive: true, isDelete: false, allowMultipleAccounts: true })) as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })

function App() {
  const [scenario, setScenario] = useState<any>({})
  const [generation, setGeneration] = useState(0)
  const [closed, setClosed] = useState(false)
  ;(window as any).dataValidationSmoke = { state, open: (value: any) => {
    Object.assign(state, { calls: [], alerts: [], errors: [], insertedCount: value.insertedCount ?? null })
    setScenario(value); setClosed(false); setGeneration(value => value + 1)
  } }
  const formData = { name: 'Kiểm tra data rỗng', actionId: 'zalo_message_group', accountIds: [11, 12, 13],
    schedule: '2035-01-01T09:00', content: 'Nội dung cần giữ', splitDataAcrossAccounts: true,
    zaloFriendBlocklistEnabled: false, enableAkaBizTag: false, ...scenario.formData }
  const savedDraft: any = { id: '61b21e19-7ed9-419f-af2c-fc124eea4c81', revision: 1, updatedAt: '2035-01-01T09:00:00+07:00',
    ...formData, payload: { version: 1, values: { ...scenario.values, formData, details: scenario.rows ?? [{ uid: 'group-1' }, { uid: '' }, { uid: ' ' }] } } }
  return closed ? <div>Đã đóng</div> : <CampaignFormModal key={generation} campaign={null} savedDraft={savedDraft}
    onClose={() => setClosed(true)} />
}
createRoot(document.getElementById('root')!).render(<App />)
