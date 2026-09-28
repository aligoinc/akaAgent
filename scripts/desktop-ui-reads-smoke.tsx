// Real stores/panel/coordinator, fake IPC only. Runner blocks all HTTP.
import React from 'react'
import { createRoot } from 'react-dom/client'
import CampaignPanel from '../src/renderer/src/components/CampaignPanels/CampaignPanel'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { useDesktopUiPolling } from '../src/renderer/src/hooks/useDesktopUiPolling'
import { useDesktopPollingStore } from '../src/renderer/src/stores/desktopPollingStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const now = new Date().toISOString()
const rows: any[] = Array.from({ length: 1205 }, (_, index) => ({ id: index + 1, name: `Campaign ${index + 1}`, actionId: 'zalo_message_phone', accountId: 41, accountName: 'Account', staffId: 41, organizationId: 1, schedule: now, createdAt: now, updatedAt: now, status: 'tạm dừng', isDelete: false, relationSettings: {}, extraSettings: {} }))
const account: any = { id: 41, name: 'Account', flatformType: 'zalo', isZaloServer: true, isActive: true, isDelete: false, staffId: 41, organizationId: 1, loginStatus: 'đã đăng nhập', status: 'chờ xử lý', updatedAt: now }
const state: any = { calls: [], errors: [], hold: null, release: null, failPage: false, hidden: false, catalogVersion: 'a'.repeat(32), catalogName: 'Account', settings: { campaigns: 30, accounts: 30 } }
Object.defineProperty(document, 'visibilityState', { get: () => state.hidden ? 'hidden' : 'visible', configurable: true })
let accountEvent = () => {}
const matches = (row: any, filters: any) => (!filters.search || row.name.toLowerCase().includes(filters.search.toLowerCase())) && (!filters.statuses || filters.statuses.includes(row.status))
const handlers: Record<string, any> = {
  platform: 'darwin', listCampaignDrafts: () => ({ items: [], total: 0 }),
  listAutomations: () => ({ items: [], total: 0, pageSize: 100 }), listAutomationExecutions: () => ({ items: [], total: 0, pageSize: 100 }),
  getCampaignConfig: (id: number) => rows.find(row => row.id === id), getDesktopCampaignSources: async (id: number) => {
    const result = [...(state.sources?.[id] || [])]
    if (state.hold === 'sources') await new Promise(resolve => { state.release = resolve })
    return result
  },
  getDesktopPollingSettings: () => state.settings,
  getDesktopCampaignPage: async (query: any) => {
    if (state.failPage) throw new Error('Fixture page error')
    const filtered = rows.filter(row => matches(row, query.filters))
    const page = Math.min(query.page, Math.max(1, Math.ceil(filtered.length / 100)))
    const items = filtered.slice((page - 1) * 100, page * 100).map(row => ({ ...row }))
    const result = { items, selected: rows.find(row => row.id === query.selectedId) || null, order: items.map(row => ({ kind: 'campaign', id: String(row.id) })), total: filtered.length, campaignTotal: filtered.length, page, pageSize: 100, actionOptions: [] }
    if (state.hold === 'campaign') await new Promise(resolve => { state.release = resolve })
    return result
  },
  getDesktopCampaignSelection: async (query: any) => {
    const result = rows.filter(row => matches(row, query.filters) && (query.ids ? query.ids.includes(row.id) : row.id > (query.afterId || 0))).slice(0, 500).map(({ id, status }) => ({ id, status }))
    if (state.hold === 'selection') await new Promise(resolve => { state.release = resolve })
    return result
  },
  getDesktopAccountSnapshot: async (version: string) => {
    const result = { version: state.catalogVersion, catalog: version === state.catalogVersion ? null : [{ ...account, name: state.catalogName }], states: [{ id: 41, status: account.status, loginStatus: account.loginStatus, updatedAt: account.updatedAt, hasDisabledActions: false }] }
    if (state.hold === 'account') await new Promise(resolve => { state.release = resolve })
    return result
  },
  updateCampaign: (id: number, updates: any) => { const row = rows.find(row => row.id === id); Object.assign(row, updates); return { ...row } },
  updateAccount: (id: number, updates: any) => { Object.assign(account, updates); state.catalogName = account.name; state.catalogVersion = 'b'.repeat(32); return { ...account } },
  listDesktopCampaignCatalog: () => rows,
  bulkUpdateCampaignStatus: (ids: number[], status: string) => { rows.forEach(row => { if (ids.includes(row.id)) row.status = status }); return { updatedCount: ids.length } },
  onAccountStatusUpdated: (callback: () => void) => { accountEvent = callback; return () => { accountEvent = () => {} } }
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return key in target ? target[key] : () => () => {}
  return async (...args: any[]) => { state.calls.push({ method: key, args }); return key in target ? target[key](...args) : key.startsWith('get') ? null : [] }
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 41, organizationId: 1, entitlements: normalizeEntitlements({ zalo: true }), zaloAccountCapabilities: { qr: false, web: false, server: true } } as any })
useCampaignStore.setState({ accounts: [account], campaignActions: [{ id: 'zalo_message_phone', name: 'Nhắn tin', flatformType: 'zalo', isActive: true, isDelete: false }] as any, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { if (type === 'error') state.errors.push(message) } })
;(window as any).desktopSmoke = { state, store: useCampaignStore, ui: useUiStore, polling: useDesktopPollingStore, rows, accountEvent: () => accountEvent() }
function App() {
  const user = useAuthStore(state => state.user)
  useDesktopUiPolling(user ? `${user.organizationId}:${user.staffId}` : null, true, true)
  return <div style={{ height: '100vh' }}><CampaignPanel isActive /></div>
}
createRoot(document.getElementById('root')!).render(<App />)
