// Real Desktop form/settings with isolated IPC fixtures; never connects to production.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const accounts = [13, 12, 11].map(id => ({ id, name: `Zalo ${id}`, flatformType: 'zalo', isActive: true, isDelete: false,
  isZaloServer: false, isZaloShowWeb: false, status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 9 }))
const state: any = { failZaloLabels: false, calls: [], errors: [], alerts: [], groups: [], tags: [], holdWrite: false, pending: [], failGroups: false, failTags: false, holdLabels: null, pendingLabels: [], emptyLabels: false }
const labelsFor = (accountId: number) => {
  const offset = (accountId - 11) * 10
  return ['Tag mới', 'VIP', 'Khách cũ Zalo', 'Bạn bè', 'Công việc', 'Đồng nghiệp', 'Gia đình', 'Học tập']
    .map((text, index) => ({ id: 7 + offset + index, text, conversations: [] }))
}
const resetData = () => {
  Object.assign(state, { calls: [], alerts: [], failGroups: false, failTags: false,
    groups: [{ id: 31, accountId: 11, name: 'Không chăm sóc', contactCount: 0 }, { id: 37, accountId: 12, name: 'Tài khoản khác', contactCount: 0 }],
    tags: [{ id: 41, name: 'Khách cũ' }] })
}
resetData()
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  listZaloLabels: (accountId: number) => {
    if (state.failZaloLabels) throw new Error('Fixture: Zalo tags offline')
    if (state.holdLabels === accountId) return new Promise(resolve => state.pendingLabels.push(() => resolve(labelsFor(accountId))))
    return state.emptyLabels ? [] : labelsFor(accountId)
  },
  syncZaloLabels: (accountId: number) => {
    if (state.failZaloLabels) throw new Error('Fixture: Zalo tags offline')
    return handlers.listZaloLabels(accountId)
  },
  createCampaign: (patch: any) => ({ id: 900 + patch.accountId, ...patch }),
  updateCampaign: (id: number, patch: any) => ({ id, ...patch }),
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
const actions = ['zalo_message_friend', 'zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation']
useCampaignStore.setState({ accounts: accounts as any, campaignActions: actions.map(id => ({ id, name: id, flatformType: 'zalo', isActive: true, isDelete: false, allowSecondaryAccount: true })) as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })

function App() {
  const [mode, setMode] = useState('new')
  const [actionId, setActionId] = useState('zalo_message_friend')
  const [generation, setGeneration] = useState(0)
  const [options, setOptions] = useState<any>({})
  const open = (next: string, action = 'zalo_message_friend', overrides = {}) => {
    resetData(); state.failZaloLabels = false; state.holdLabels = null; state.pendingLabels = []; state.emptyLabels = false
    setOptions(overrides); setMode(next); setActionId(action); setGeneration(value => value + 1)
  }
  ;(window as any).settingsSmoke = { state, open }
  const formData = { name: 'Điều kiện Zalo', actionId, accountIds: [11], schedule: '2035-01-01T09:00',
    content: 'Nội dung', enableMessage: true, zaloFriendTargetMode: 'all_friends',
    enableZaloTag: true, zaloTagId: '7', zaloTagName: 'Tag mới',
    zaloTagSkipIfFriend: true, zaloTagSkipIfHasSelectedTags: true, zaloTagSkipTagIds: ['8', '9'], zaloTagSkipTagNames: ['VIP', 'Khách cũ Zalo'],
    enableZaloAlias: true, zaloAliasTemplate: 'Tên mới', zaloAliasSkipIfFriend: true }
  const base: any = { id: 7, name: formData.name, actionId, accountId: 11, schedule: formData.schedule,
    content: formData.content, status: 'tạm dừng', extraSettings: formData, ...options.campaign }
  const savedDraft: any = { id: '61b21e19-7ed9-419f-af2c-fc124eea4c81', revision: 1, updatedAt: '2035-01-01T09:00:00+07:00',
    ...formData, payload: { version: 1, values: { formData } } }
  return mode === 'closed' ? null : <CampaignFormModal key={`${mode}:${actionId}:${generation}`} onClose={() => setMode('closed')}
    campaign={mode === 'edit' ? base : mode === 'clone' ? { ...base, id: undefined } : null}
    cloneFromId={mode === 'clone' ? 7 : undefined} savedDraft={mode === 'draft' ? options.savedDraft || savedDraft : undefined}
    lockedActionId={actionId} initialAccountIds={options.initialAccountIds || [11]} />
}
createRoot(document.getElementById('root')!).render(<App />)
