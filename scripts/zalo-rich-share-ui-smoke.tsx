// Real Desktop form/settings with isolated IPC fixtures; never connects to production.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { CampaignContentMediaUpdateModal } from '../src/renderer/src/components/CampaignPanels/CampaignQuickEditModals'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const accounts = [12, 11].map(id => ({ id, name: `Zalo ${id}`, flatformType: 'zalo', isActive: true, isDelete: false,
  isZaloServer: false, isZaloShowWeb: false, status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 9 }))
const state: any = { calls: [], errors: [], alerts: [], groups: [], tags: [], holdWrite: false, pending: [], failGroups: false, failTags: false }
const resetData = () => {
  Object.assign(state, { calls: [], alerts: [], failGroups: false, failTags: false,
    groups: [{ id: 31, accountId: 11, name: 'Không chăm sóc', contactCount: 0 }, { id: 37, accountId: 12, name: 'Tài khoản khác', contactCount: 0 }],
    tags: [{ id: 41, name: 'Khách cũ' }] })
}
resetData()
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getEmailNotificationSettings: () => ({ recipientEmails: [], dailyReportTime: '18:00' }),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }),
  listAccounts: () => accounts,
  listZaloFriendBlocklists: (accountId: number) => {
    if (state.failGroups) throw new Error('Fixture: không tải được danh sách')
    return structuredClone(state.groups.filter((group: any) => group.accountId === accountId))
  },
  listZaloFriendBlocklistPage: () => ({ contacts: [], total: 0 }),
  createZaloFriendBlocklist: async (accountId: number, name: string) => {
    if (state.holdWrite) await new Promise(resolve => state.pending.push(resolve))
    const group = { id: 32, accountId, name, contactCount: 0 }; state.groups.push(group); return group
  },
  updateZaloFriendBlocklist: (id: number, name: string) => Object.assign(state.groups.find((group: any) => group.id === id), { name }),
  deleteZaloFriendBlocklist: (id: number) => { state.groups = state.groups.filter((group: any) => group.id !== id) },
  listAkaBizContactTags: () => {
    if (state.failTags) throw new Error('Fixture: không tải được tag')
    return structuredClone(state.tags)
  },
  updateAkaBizContactTag: (id: number, name: string) => Object.assign(state.tags.find((tag: any) => tag.id === id), { name }),
  listCampaignInputData: () => [],
  saveCampaignDraft: (request: any) => ({ ...request, revision: 2, updatedAt: new Date().toISOString() })
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
useAuthStore.setState({ user: { staffId: 7, organizationId: 9, entitlements: normalizeEntitlements({ zalo: true }),
  zaloAccountCapabilities: { qr: true, web: true, server: true } } as any })
useCampaignStore.setState({ accounts: accounts as any, campaignActions: ['zalo_message_friend', 'zalo_message_group'].map(id => ({ id, name: id, flatformType: 'zalo', isActive: true, isDelete: false })) as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })

function App() {
  const [selection, setSelection] = useState({ actionId: 'zalo_message_friend', mode: 'new', key: 0 })
  const [closed, setClosed] = useState(false)
  ;(window as any).richShareSmoke = { state, open: (actionId: string, mode: string) => {
    resetData(); setClosed(false); setSelection(old => ({ actionId, mode, key: old.key + 1 }))
  } }
  const base: any = { id: 7, name: 'Rich share fixture', actionId: selection.actionId, accountId: 11,
    accountName: 'Zalo 11', schedule: '2035-01-01T09:00', content: '<p><strong>Chào bạn</strong></p>',
    status: 'tạm dừng', images: [], extraSettings: { formattedContentEnabled: true, zaloMessageSendMode: 'share' } }
  return closed ? <p>Đã đóng</p> : selection.mode === 'quick'
    ? <CampaignContentMediaUpdateModal key={selection.key} campaign={base} onClose={() => setClosed(true)} />
    : <CampaignFormModal key={selection.key} onClose={() => setClosed(true)} campaign={selection.mode === 'edit' ? base : null}
      lockedActionId={selection.actionId} initialAccountIds={[11]} />
}
createRoot(document.getElementById('root')!).render(<App />)
