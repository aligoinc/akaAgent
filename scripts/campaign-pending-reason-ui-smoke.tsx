// Actual CampaignPanel/hook/CSS with isolated IPC. No backend or campaign execution.
import React from 'react'
import { createRoot } from 'react-dom/client'
import CampaignPanel from '../src/renderer/src/components/CampaignPanels/CampaignPanel'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import { campaignPendingReasonVersion } from '../src/shared/campaignPendingReason'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], errors: [], pending: [], reject: false, webStates: [], message: null }
const webListeners = new Set<(states: any[]) => void>()
const now = new Date().toISOString()
let campaigns: any[] = [91, 92, 93, 94].map(id => ({ id, name: `Chiến dịch ${id}`, actionId: 'facebook_message_uid',
  accountId: 41, accountName: 'Tài khoản kiểm thử', staffId: 41, organizationId: 1, schedule: now,
  createdAt: now, updatedAt: now, status: id === 94 ? 'tạm dừng' : 'chờ xử lý', isDelete: false,
  note: id === 93 ? 'Note chiến dịch hiện có.' : null, relationSettings: {}, extraSettings: {} }))
const user = { staffId: 41, organizationId: 1, entitlements: normalizeEntitlements({ facebookCore: true }),
  zaloAccountCapabilities: { qr: false, web: false, server: false } } as any
const handlers: Record<string, any> = {
  webEnrichment: { state: async () => state.webStates,
    onState: (callback: (states: any[]) => void) => { webListeners.add(callback); return () => webListeners.delete(callback) } },
  platform: 'darwin', listCampaignDrafts: () => ({ items: [], total: 0 }),
  listAutomations: () => ({ items: [], total: 0, pageSize: 100 }),
  listAutomationExecutions: () => ({ items: [], total: 0, pageSize: 100 }),
  getCampaignConfig: (id: number) => campaigns.find(row => row.id === id),
  getDesktopCampaignConfig: (id: number) => campaigns.find(row => row.id === id),
  getCampaignRelationSummaries: () => [], getDesktopCampaignSources: () => [],
  getDesktopCampaignPage: (query: any) => ({ items: campaigns,
    selected: campaigns.find(row => row.id === query.selectedId) || null,
    order: campaigns.map(row => ({ kind: 'campaign', id: String(row.id) })),
    total: campaigns.length, campaignTotal: campaigns.length, page: 1, pageSize: 100, actionOptions: [] }),
  checkCampaignPendingReason: (id: number) => {
    if (state.reject) throw new Error('Private transport failure must not reach the note')
    const version = campaignPendingReasonVersion(campaigns.find(row => row.id === id))
    const message = state.message || 'Chưa có data đến giờ chạy. Data gần nhất được hẹn lúc 11:00 12/10/2026.'
    return new Promise(resolve => state.pending.push(() => resolve({ campaignId: id, version,
      message })))
  }
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  return async (...args: any[]) => {
    state.calls.push({ method: key, args })
    return key in target ? target[key](...args) : key.startsWith('get') ? null : []
  }
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user })
useCampaignStore.setState({ campaigns, campaignConfigs: Object.fromEntries(campaigns.map(row => [row.id, row])),
  accounts: [{ id: 41, name: 'Tài khoản kiểm thử', flatformType: 'facebook', isActive: true, isDelete: false,
    staffId: 41, organizationId: 1, loginStatus: 'đã đăng nhập', status: 'chờ xử lý' }] as any,
  campaignActions: [{ id: 'facebook_message_uid', name: 'Nhắn tin UID', flatformType: 'facebook', isActive: true, isDelete: false }] as any,
  loadAccounts: async () => {}, loadAccountGroups: async () => {}, loadCampaignActions: async () => {}
})
;(window as any).pendingSmoke = { state, store: useCampaignStore,
  web: (states: any[]) => { state.webStates = states; for (const listener of webListeners) listener(states) },
  release: () => state.pending.shift()?.(),
  patch: (id: number, patch: any) => {
    campaigns = campaigns.map(row => row.id === id ? { ...row, ...patch } : row)
    useCampaignStore.setState({ campaigns })
  },
  refresh: () => useCampaignStore.getState().loadCampaigns(),
  switchAuth: () => {
    const previous = useCampaignStore.getState()
    useAuthStore.setState({ user: null }); useAuthStore.setState({ user })
    useCampaignStore.setState(previous)
  }
}
createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh' }}><CampaignPanel isActive /></div>)
