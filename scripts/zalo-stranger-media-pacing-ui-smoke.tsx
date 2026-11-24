// Cảnh báo "từ 3 ảnh thì nghỉ từ 300 giây" (V647) trên form Desktop thật (thường + Agent), IPC giả lập; không kết nối production.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import CampaignAgentFormModal from '../src/renderer/src/components/CampaignPanels/CampaignAgentFormModal'
import { useDesktopPollingStore } from '../src/renderer/src/stores/desktopPollingStore'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const accounts = [11].map(id => ({ id, name: `Zalo ${id}`, flatformType: 'zalo', isActive: true, isDelete: false,
  isZaloServer: false, isZaloShowWeb: false, status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 9 }))
const state: any = { calls: [], errors: [], alerts: [] }
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getEmailNotificationSettings: () => ({ recipientEmails: [], dailyReportTime: '18:00' }),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }),
  listAccounts: () => accounts,
  listZaloFriendBlocklists: () => [], listZaloFriendBlocklistPage: () => ({ contacts: [], total: 0 }),
  listAkaBizContactTags: () => [],
  listSendExclusionGroups: () => ({ groups: [], blocklists: [], revision: 1 }),
  listCampaignInputData: () => [{ id: 1, campaignId: 7, phone: '0900000001', name: 'Khách 1', status: 'chờ xử lý', isDelete: false }],
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
const actions = ['zalo_message_phone', 'zalo_message_friend', 'zalo_message_group_member']
useCampaignStore.setState({ accounts: accounts as any, campaignActions: actions.map(id => ({ id, name: id, flatformType: 'zalo', isActive: true, isDelete: false })) as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })
useDesktopPollingStore.setState({ settings: { campaigns: 30, accounts: 30 } } as any)

const media = (n: number) => Array.from({ length: n }, (_, i) => `https://media.example/${i + 1}.jpg`)

function App() {
  const [sel, setSel] = useState({ form: 'normal', actionId: 'zalo_message_phone', images: 3, extra: {} as Record<string, unknown>, key: 0 })
  ;(window as any).pacingSmoke = { state, open: (form: string, actionId: string, images: number, extra: Record<string, unknown> = {}) =>
    setSel(old => ({ form, actionId, images, extra, key: old.key + 1 })) }
  const campaign: any = { id: 7, name: 'Pacing fixture', actionId: sel.actionId, accountId: 11, accountName: 'Zalo 11',
    schedule: '2035-01-01T02:00:00.000Z', originalSchedule: '2035-01-01T02:00:00.000Z', content: 'Chào bạn', status: 'tạm dừng',
    images: media(sel.images), scheduleType: 'daily', continueNextDay: true, dataTargetSourceMode: 'direct',
    extraSettings: { imageOption: 'all', actionLimits: { sleepBetweenActions: 30 }, ...sel.extra } }
  const Modal: any = sel.form === 'agent' ? CampaignAgentFormModal : CampaignFormModal
  return <Modal key={sel.key} onClose={() => {}} campaign={campaign} lockedActionId={sel.actionId} initialAccountIds={[11]} />
}
createRoot(document.getElementById('root')!).render(<App />)
