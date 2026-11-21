// Form thật (CampaignFormModal) cho chiến dịch "Tìm kiếm data bằng search" có lấy quản trị viên group: hai ô đẩy UID / SĐT quản trị
// viên sang Nhóm data và nút "Tạo nhóm mới" (docs/FIND_DATA_GROUP_ADMIN_DATA_GROUPS.md). IPC giả: tạo nhóm thì nhóm mới có trong danh sách.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignStore } from '../../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../../src/renderer/src/stores/authStore'
import { useUiStore } from '../../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../../src/renderer/src/utils/entitlements'
import '../../src/renderer/src/styles/global.css'

const TYPES = [
  { id: 38, code: 'facebook_person', name: 'User Facebook', isActive: true },
  { id: 39, code: 'facebook_group', name: 'Group Facebook', isActive: true },
  { id: 40, code: 'phone', name: 'Số điện thoại', isActive: true }
]
const baseGroup = (id: number, name: string, typeId: number) => {
  const type = TYPES.find(t => t.id === typeId)!
  return { id, name, color: '#2563eb', sortOrder: 1, revision: 1, dataTypeCategoryItemId: typeId, dataTypeCode: type.code,
    dataTypeName: type.name, activeMembershipCount: 0, isDelete: false, staffId: 41, organizationId: 1, access: { canManage: true, canEdit: true } }
}
const state: any = { calls: [], alerts: [], errors: [], campaigns: new Map(), groups: [baseGroup(7400, 'UID cũ', 38)], nextId: 70001, nextGroupId: 8100 }
const handlers: Record<string, any> = {
  platform: 'linux', fileExists: () => true,
  getCampaignInputDataLimit: () => 10000, getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: (query: any) => {
    let groups = state.groups.filter((g: any) => !g.isDelete)
    if (query?.compatibleActionId === 'facebook_message_uid') groups = groups.filter((g: any) => g.dataTypeCode === 'facebook_person')
    if (query?.compatibleActionId === 'zalo_message_phone') groups = groups.filter((g: any) => g.dataTypeCode === 'phone')
    return { groups, total: groups.length }
  },
  getDataGroup: (id: number) => state.groups.find((g: any) => g.id === id) || null,
  listDataTypeCategoryItems: () => TYPES,
  createDataGroup: (request: any) => {
    const existing = state.groups.find((g: any) => g.requestId === request.requestId)
    if (existing) return existing
    const group = { ...baseGroup(state.nextGroupId++, request.name, request.dataTypeCategoryItemId), requestId: request.requestId }
    state.groups.push(group)
    return group
  },
  createCampaign: (payload: any) => {
    const campaign = { ...payload, id: state.nextId++, isDelete: false }
    state.campaigns.set(campaign.id, campaign)
    return campaign
  },
  updateCampaign: (id: number, patch: any) => {
    const campaign = state.campaigns.get(id)
    if (campaign) Object.assign(campaign, patch)
    return campaign
  },
  createCampaignInputDataBatch: (rows: any[]) => rows.length,
  getCampaignConfig: (id: number) => state.campaigns.get(id) || null,
  generateCampaignName: () => 'Tên tự sinh'
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  if (key === 'fileExists') return target[key]
  return async (...args: any[]) => {
    state.calls.push({ method: key, args: JSON.parse(JSON.stringify(args ?? null)) })
    return key in target ? target[key](...args) : key.startsWith('get') ? null : key.startsWith('list') ? [] : null
  }
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 41, organizationId: 1, entitlements: normalizeEntitlements({ facebookCore: true, zaloQr: true }),
  zaloAccountCapabilities: { qr: true, web: false, server: false } } as any })
useCampaignStore.setState({
  accounts: [{ id: 41, name: 'Facebook 41', flatformType: 'facebook', status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 41,
    organizationId: 1, isActive: true, isDelete: false, rateLimitMinutes: 65 } as any],
  campaignActions: [
    { id: 'facebook_find_data_search', name: 'Tìm kiếm data bằng search', flatformType: 'facebook', isActive: true, isDelete: false },
    { id: 'facebook_message_uid', name: 'Nhắn tin UID', flatformType: 'facebook', isActive: true, isDelete: false,
      dataTypes: [{ dataTypeCategoryItemId: 38 }] },
    { id: 'zalo_message_phone', name: 'Nhắn tin theo SĐT', flatformType: 'zalo', isActive: true, isDelete: false,
      dataTypes: [{ dataTypeCategoryItemId: 40 }] },
    { id: 'facebook_join_group', name: 'Tham gia group', flatformType: 'facebook', isActive: true, isDelete: false }
  ] as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {}
})
useUiStore.setState({
  showAlert: (message: string, type?: string) => { state.alerts.push({ message, type }) },
  showConfirm: (_message: string, confirm: () => void) => { void confirm() }
} as any)

function draft(admins: boolean) {
  return {
    id: `admin-${admins}`, revision: 1, updatedAt: '2035-01-01T09:00:00+07:00', name: 'Tìm group BĐS', actionId: 'facebook_find_data_search',
    accountIds: [41], schedule: '2035-01-01T09:00', isDelete: false, campaignIds: [], deletionReason: null,
    payload: { version: 1, values: {
      formData: { name: 'Tìm group BĐS', actionId: 'facebook_find_data_search', accountIds: [41], schedule: '2035-01-01T09:00',
        isFindFacebookGroup: true, isFindFacebookGroupAdmins: admins, dataTargetSourceMode: 'direct' },
      findDataSearchKeywordsText: 'nhà đất'
    } }
  } as any
}

function App() {
  const [mode, setMode] = useState<null | boolean>(null)
  const [generation, setGeneration] = useState(0)
  ;(window as any).adminSmoke = {
    state,
    open: (admins: boolean) => { state.calls = []; state.alerts = []; setGeneration(v => v + 1); setMode(admins) },
    reset: () => { state.campaigns = new Map(); state.alerts = []; state.calls = []; state.groups = [baseGroup(7400, 'UID cũ', 38)]; state.nextGroupId = 8100 },
    campaigns: () => Array.from(state.campaigns.values())
  }
  return mode === null ? null : <CampaignFormModal key={`${mode}:${generation}`} onClose={() => setMode(null)} campaign={null} savedDraft={draft(mode)} />
}
createRoot(document.getElementById('root')!).render(<App />)
