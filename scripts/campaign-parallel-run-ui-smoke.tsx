// "Chạy cùng lúc" (V670): ô tích trên form Desktop thật với IPC giả lập; không kết nối production.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import CampaignInfoView from '../src/renderer/src/components/CampaignPanels/CampaignInfoView'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const accounts = [11].map(id => ({ id, name: `Zalo ${id}`, flatformType: 'zalo', isActive: true, isDelete: false,
  isZaloServer: false, isZaloShowWeb: false, status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 9 }))
const actions = [
  { id: 'zalo_cancel_sent_friend_request', name: 'Huỷ lời mời kết bạn', flatformType: 'zalo', isActive: true, isDelete: false, allowParallelRun: true },
  { id: 'zalo_message_friend', name: 'Nhắn tin bạn bè', flatformType: 'zalo', isActive: true, isDelete: false, allowParallelRun: false }
]
const state: any = { calls: [], errors: [], created: [], alerts: [] }
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getEmailNotificationSettings: () => ({ recipientEmails: [], dailyReportTime: '18:00' }),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }),
  listAccounts: () => accounts,
  listZaloFriendBlocklists: () => [],
  listZaloFriendBlocklistPage: () => ({ contacts: [], total: 0 }),
  listAkaBizContactTags: () => [],
  listSendExclusionGroups: () => ({ groups: [], blocklists: [], revision: 1 }),
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
useUiStore.setState({ showAlert: (message: any, type: any) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })
// Gán người dùng trước rồi mới gán danh sách tài khoản / loại chiến dịch: đổi người dùng làm campaignStore xoá dữ liệu cũ.
const setUser = (engineV2: boolean) => {
  useAuthStore.setState({ user: { staffId: 7, organizationId: 9, campaignEngineV2: engineV2,
    entitlements: normalizeEntitlements({ zalo: true }), zaloAccountCapabilities: { qr: true, web: true, server: true } } as any })
  useCampaignStore.setState({ accounts: accounts as any, campaignActions: actions as any,
    campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {},
    createCampaign: async (data: any) => { state.created.push(data); return { ...data, id: 900 + state.created.length, log: '', isDelete: false } } } as any)
}
setUser(true)

function App() {
  const [selection, setSelection] = useState({ actionId: 'zalo_cancel_sent_friend_request', mode: 'new', key: 0, ticked: false, view: 'form' })
  ;(window as any).parallelRunSmoke = { state, open: (actionId: string, mode: string, engineV2: boolean, ticked = false, view = 'form') => {
    setUser(engineV2); setSelection(old => ({ actionId, mode, key: old.key + 1, ticked, view }))
  } }
  const base: any = { id: 7, name: 'Chạy cùng lúc fixture', actionId: selection.actionId, accountId: 11, accountName: 'Zalo 11',
    schedule: '2035-01-01T02:00:00.000Z', originalSchedule: '2035-01-01T02:00:00.000Z', content: 'Chào bạn', status: 'tạm dừng', images: [],
    scheduleType: 'daily', continueNextDay: true, dataTargetSourceMode: 'direct', extraSettings: {}, parallelRunEnabled: selection.ticked,
    isDelete: false, editVersion: 'v', editReady: true }
  if (selection.view === 'info') {
    return <CampaignInfoView key={selection.key} campaign={base} account={accounts[0] as any}
      action={actions.find(action => action.id === selection.actionId) as any} campaigns={[]} accounts={accounts as any} />
  }
  return <CampaignFormModal key={selection.key} onClose={() => {}} campaign={selection.mode === 'edit' ? base : null}
    lockedActionId={selection.actionId} initialAccountIds={[11]} />
}
createRoot(document.getElementById('root')!).render(<App />)
