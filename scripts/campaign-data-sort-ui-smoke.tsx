// Real CampaignPanel + Zustand paging, isolated IPC and blocked HTTP.
import React from 'react'
import { createRoot } from 'react-dom/client'
import CampaignPanel from '../src/renderer/src/components/CampaignPanels/CampaignPanel'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], errors: [], alerts: [], exports: [], hold: null, release: null }
const now = new Date().toISOString()
const campaigns = [91, 92].map(id => ({ id, name: `Sort campaign ${id}`, actionId: 'facebook_message_uid',
  accountId: 41, accountName: 'Sort account', staffId: 41, organizationId: 1,
  schedule: now, createdAt: now, updatedAt: now, status: 'tạm dừng', isDelete: false, relationSettings: {}, extraSettings: {} }))
const inputs = Array.from({ length: 205 }, (_, i) => ({ id: i + 1, campaignId: 91, name: `Data ${i + 1}`,
  uid: `uid-${i + 1}`, status: i % 2 ? 'tạm dừng' : 'hoàn thành', isDelete: false,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, Math.floor(i / 2))).toISOString(),
  dateAction: i % 3 ? new Date(Date.UTC(2026, 1, 1, 0, 205 - i)).toISOString() : undefined }))
const results = inputs.map(row => ({ id: row.id, campaignId: 91, createdAt: row.createdAt,
  actionName: `Result ${row.id}`, actionCode: 'fb_message_stranger', status: 'thành công', log: `Result ${row.id}`, isDelete: false }))
const pageRows = (rows: any[], query: any) => {
  const sort = query.sort || 'created_desc'
  let filtered = rows.filter(row => (!query.inputDataIds || query.inputDataIds.includes(row.id))
    && (!query.inputDataIds || state.dropSelectionId !== row.id)
    && (!query.search || `${row.name || row.actionName} ${row.uid}`.includes(query.search))
    && (!query.status || row.status === query.status))
  filtered = filtered.sort((a, b) => {
    const time = (row: any) => Date.parse(sort.startsWith('processed') ? row.dateAction || row.createdAt : row.createdAt)
    return (sort.endsWith('asc') ? 1 : -1) * (time(a) - time(b) || a.id - b.id)
  })
  return { items: filtered.slice(query.offset || 0, (query.offset || 0) + (query.limit || 100)), total: filtered.length }
}
const handlers: Record<string, any> = {
  platform: 'darwin', listCampaignDrafts: () => ({ items: [], total: 0 }),
  listAutomations: () => ({ items: [], total: 0, pageSize: 100 }),
  listAutomationExecutions: () => ({ items: [], total: 0, pageSize: 100 }),
  getCampaignConfig: (id: number) => campaigns.find(row => row.id === id),
  getCampaignRelationSummaries: () => [],
  listCampaignInputDataPage: async (query: any) => {
    const result = pageRows(inputs, query)
    if (state.hold === query.sort) await new Promise(resolve => { state.release = resolve })
    return result
  },
  listCampaignDetailsPage: (query: any) => pageRows(results, query)
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
useAuthStore.setState({ user: { staffId: 41, organizationId: 1,
  entitlements: normalizeEntitlements({ facebookCore: true }), zaloAccountCapabilities: { qr: false, web: false, server: false } } as any })
useCampaignStore.setState({ campaigns: campaigns as any, campaignConfigs: Object.fromEntries(campaigns.map(row => [row.id, row])) as any,
  accounts: [{ id: 41, name: 'Sort account', flatformType: 'facebook', isActive: true, isDelete: false,
    staffId: 41, organizationId: 1, loginStatus: 'đã đăng nhập', status: 'chờ xử lý' }] as any,
  campaignActions: [{ id: 'facebook_message_uid', name: 'Nhắn tin UID', flatformType: 'facebook', isActive: true, isDelete: false }] as any,
  loadCampaigns: async () => {}, loadAccounts: async () => {}, loadAccountGroups: async () => {}, loadCampaignActions: async () => {}
})
useUiStore.setState({ showAlert: (message, type) => {
  state.alerts.push({ message, type })
  if (type === 'error') state.errors.push(message)
} })
;(window as any).sortSmoke = { state, store: useCampaignStore,
  refresh: () => useCampaignStore.getState().refreshCampaignInputData(91) }
createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh' }}><CampaignPanel isActive /></div>)
