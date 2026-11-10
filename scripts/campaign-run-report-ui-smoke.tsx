// Real CampaignPanel + the "Báo cáo" detail tab with isolated IPC and blocked HTTP. The report IPC answers with the shared
// builder over two V487 results returned by production on 10/11/2026 (scripts/fixtures/campaign-run-report-rpc-samples.json).
import React from 'react'
import { createRoot } from 'react-dom/client'
import CampaignPanel from '../src/renderer/src/components/CampaignPanels/CampaignPanel'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import { buildCampaignRunReport, parseCampaignRunReportRpc } from '../src/shared/campaignRunReport'
import { getAccountActionName, getCampaignAccountOverviewActionDescriptors } from '../src/shared/campaignActionDescriptors'
import samples from './fixtures/campaign-run-report-rpc-samples.json'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], errors: [], alerts: [], exports: [], reportMode: {} as Record<number, string>, hold: null, release: null }
const now = new Date().toISOString()
const base = { staffId: 41, organizationId: 1, schedule: now, createdAt: now, updatedAt: now, isDelete: false, relationSettings: {} }
const campaigns = [
  { ...base, id: 102, name: 'Mời khách hội thảo', actionId: 'zalo_message_phone', accountId: 41, accountName: 'Zalo CSKH',
    status: 'đang chạy', inputDataTotalCount: 1086, inputDataCompletedCount: 393, extraSettings: samples[1].extra },
  { ...base, id: 101, name: 'Đăng bài nhóm bất động sản', actionId: 'facebook_group_post', accountId: 42, accountName: 'Facebook Sale',
    status: 'đang chạy', inputDataTotalCount: 435, inputDataCompletedCount: 175, extraSettings: samples[0].extra },
  { ...base, id: 103, name: 'Chiến dịch chờ cập nhật DB', actionId: 'zalo_message_phone', accountId: 41, accountName: 'Zalo CSKH',
    status: 'tạm dừng', inputDataTotalCount: 0, inputDataCompletedCount: 0, extraSettings: {} }
]
const reportFor = (campaignId: number) => {
  const sample = samples.find(item => item.id === campaignId)!
  const campaign = campaigns.find(item => item.id === campaignId)!
  const rpc = parseCampaignRunReportRpc(sample.rpc)
  const configured = getCampaignAccountOverviewActionDescriptors({ actionId: campaign.actionId, extraSettings: campaign.extraSettings as any })
    .map(action => action.code)
  const codes = new Set([...configured, ...rpc.results.groups.map(group => group.actionCode).filter(Boolean) as string[]])
  return buildCampaignRunReport({ rpc, catalog: null, platform: sample.platform, usesInputData: true, configuredActionCodes: configured,
    actionNames: Object.fromEntries(Array.from(codes).map(code => [code, getAccountActionName(code)])) })
}
const handlers: Record<string, any> = {
  platform: 'darwin', listCampaignDrafts: () => ({ items: [], total: 0 }),
  listAutomations: () => ({ items: [], total: 0, pageSize: 100 }),
  listAutomationExecutions: () => ({ items: [], total: 0, pageSize: 100 }),
  getCampaignConfig: (id: number) => campaigns.find(row => row.id === id),
  getDesktopCampaignConfig: (id: number) => campaigns.find(row => row.id === id),
  getCampaignRelationSummaries: () => [],
  getDesktopCampaignSources: () => [],
  getDesktopCampaignPage: (query: any) => ({ items: campaigns, selected: campaigns.find(row => row.id === query.selectedId) || null,
    order: campaigns.map(row => ({ kind: 'campaign', id: String(row.id) })), total: campaigns.length, campaignTotal: campaigns.length,
    page: 1, pageSize: 100, actionOptions: [] }),
  listCampaignInputDataPage: () => ({ items: [], total: 0 }),
  listCampaignDetailsPage: () => ({ items: [], total: 0 }),
  campaignRunReport: async (request: { campaignId: number }) => {
    if (state.hold === request.campaignId) await new Promise(resolve => { state.release = resolve })
    if (request.campaignId === 103 || state.reportMode[request.campaignId] === 'not_ready') {
      return { ok: false, code: 'campaign_report_not_ready', message: 'Báo cáo đang được cập nhật. Vui lòng thử lại sau.' }
    }
    return { ok: true, data: reportFor(request.campaignId) }
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
useAuthStore.setState({ user: { staffId: 41, organizationId: 1,
  entitlements: normalizeEntitlements({ zaloCore: true, facebook: true }), zaloAccountCapabilities: { qr: true, web: false, server: true } } as any })
useCampaignStore.setState({ campaigns: campaigns as any, campaignConfigs: Object.fromEntries(campaigns.map(row => [row.id, row])) as any,
  accounts: [
    { id: 41, name: 'Zalo CSKH', flatformType: 'zalo', isActive: true, isDelete: false, staffId: 41, organizationId: 1, loginStatus: 'đã đăng nhập', status: 'đang chạy' },
    { id: 42, name: 'Facebook Sale', flatformType: 'facebook', isActive: true, isDelete: false, staffId: 41, organizationId: 1, loginStatus: 'đã đăng nhập', status: 'đang chạy' }
  ] as any,
  campaignActions: [
    { id: 'zalo_message_phone', name: 'Nhắn tin theo SĐT', flatformType: 'zalo', isActive: true, isDelete: false },
    { id: 'facebook_group_post', name: 'Đăng bài vào nhóm', flatformType: 'facebook', isActive: true, isDelete: false }
  ] as any,
  loadAccounts: async () => {}, loadAccountGroups: async () => {}, loadCampaignActions: async () => {}
})
useUiStore.setState({ showAlert: (message, type) => {
  state.alerts.push({ message, type })
  if (type === 'error') state.errors.push(message)
} })
;(window as any).reportSmoke = { state, store: useCampaignStore }
createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh' }}><CampaignPanel isActive /></div>)
