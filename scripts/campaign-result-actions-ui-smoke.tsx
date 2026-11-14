// Real CampaignPanel + tab "Kết quả chạy" with the "Hành động" filter and "Gộp hành động vào một dòng", isolated IPC and
// blocked HTTP. Recipients answers are real V539 JSON from the WebApp fixture (scripts/fixtures/campaign-result-actions-rpc-samples.json);
// the action list is built by the shared builder like the main service; the report tab uses the V487 samples.
import React from 'react'
import { createRoot } from 'react-dom/client'
import CampaignPanel from '../src/renderer/src/components/CampaignPanels/CampaignPanel'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import { buildCampaignRunReport, parseCampaignRunReportRpc } from '../src/shared/campaignRunReport'
import {
  buildCampaignResultActionOptions, parseCampaignResultActionsRpc, parseCampaignResultRecipientsRpc, CAMPAIGN_RESULT_ACTIONS_NOT_READY
} from '../src/shared/campaignResultActions'
import { getAccountActionName, getCampaignAccountOverviewActionDescriptors } from '../src/shared/campaignActionDescriptors'
import reportSamples from './fixtures/campaign-run-report-rpc-samples.json'
import recipientSamples from './fixtures/campaign-result-actions-rpc-samples.json'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], errors: [], alerts: [], exports: [], notReady: {} as Record<number, boolean>, v3NotReady: false }
const now = new Date().toISOString()
const base = { staffId: 41, organizationId: 1, schedule: now, createdAt: now, updatedAt: now, isDelete: false, relationSettings: {} }
const campaigns = [
  { ...base, id: 102, name: 'Mời khách hội thảo', actionId: 'zalo_message_phone', accountId: 41, accountName: 'Zalo CSKH',
    status: 'đang chạy', inputDataTotalCount: 1086, inputDataCompletedCount: 393, extraSettings: reportSamples[1].extra },
  { ...base, id: 103, name: 'Chiến dịch chờ cập nhật DB', actionId: 'zalo_message_phone', accountId: 41, accountName: 'Zalo CSKH',
    status: 'tạm dừng', inputDataTotalCount: 0, inputDataCompletedCount: 0, extraSettings: {} }
]
const configuredCodes = (campaignId: number) => {
  const campaign = campaigns.find(item => item.id === campaignId)!
  return getCampaignAccountOverviewActionDescriptors({ actionId: campaign.actionId, extraSettings: campaign.extraSettings as any }).map(action => action.code)
}
const reportFor = (campaignId: number) => {
  const sample = reportSamples.find(item => item.id === campaignId)!
  const rpc = parseCampaignRunReportRpc(sample.rpc)
  const configured = configuredCodes(campaignId)
  const codes = new Set([...configured, ...rpc.results.groups.map(group => group.actionCode).filter(Boolean) as string[]])
  return buildCampaignRunReport({ rpc, catalog: null, platform: sample.platform, usesInputData: true, configuredActionCodes: configured,
    actionNames: Object.fromEntries(Array.from(codes).map(code => [code, getAccountActionName(code)])) })
}
const actionsFor = (campaignId: number) => {
  const rpc = parseCampaignResultActionsRpc(recipientSamples.actions)
  // Same names as the main service: every configured or recorded code Desktop knows.
  const codes = new Set([...configuredCodes(campaignId), ...rpc.actions.map(row => row.code).filter(Boolean) as string[]])
  const names = Object.fromEntries(Array.from(codes).map(code => [code, getAccountActionName(code)]).filter(([code, name]) => name !== code))
  return { campaignId, total: rpc.total, usesInputData: true,
    actions: buildCampaignResultActionOptions({ configuredCodes: configuredCodes(campaignId), recorded: rpc.actions, names }) }
}
const page = parseCampaignResultRecipientsRpc(recipientSamples.page, 'page')
const byId = new Map([...page.items, ...parseCampaignResultRecipientsRpc(recipientSamples.byKeys, 'byKeys').items].map(item => [item.id, item]))
const keys = recipientSamples.keys

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
  listCampaignDetailsPage: (query: any) => {
    if (query.actionCode !== undefined && state.v3NotReady) {
      throw new Error(`Error invoking remote method 'db:list-campaign-details-page': Error: ${CAMPAIGN_RESULT_ACTIONS_NOT_READY}`)
    }
    return { items: [], total: 0 }
  },
  campaignRunReport: async (request: { campaignId: number }) => ({ ok: true, data: reportFor(request.campaignId) }),
  campaignResultActions: async (request: any) => {
    if (state.notReady[request.campaignId]) {
      return { ok: false, code: 'campaign_result_actions_not_ready', message: CAMPAIGN_RESULT_ACTIONS_NOT_READY }
    }
    if (request.kind === 'actions') return { ok: true, data: actionsFor(request.campaignId) }
    if (request.kind === 'page') return { ok: true, data: { items: page.items, total: keys.total, page: request.page, pageSize: request.pageSize } }
    if (request.kind === 'keys') return { ok: true, data: keys }
    if (request.kind === 'byKeys') return { ok: true, data: { items: request.ids.map((id: number) => byId.get(id)).filter(Boolean) } }
    return { ok: false, code: 'invalid_campaign_result_query', message: 'Bộ lọc không hợp lệ.' }
  }
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  return async (...args: any[]) => {
    state.calls.push({ method: key, args: JSON.parse(JSON.stringify(args)) })
    return key in target ? target[key](...args) : key.startsWith('get') ? null : []
  }
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 41, organizationId: 1,
  entitlements: normalizeEntitlements({ zaloCore: true, facebook: true }), zaloAccountCapabilities: { qr: true, web: false, server: true } } as any })
useCampaignStore.setState({ campaigns: campaigns as any, campaignConfigs: Object.fromEntries(campaigns.map(row => [row.id, row])) as any,
  accounts: [
    { id: 41, name: 'Zalo CSKH', flatformType: 'zalo', isActive: true, isDelete: false, staffId: 41, organizationId: 1, loginStatus: 'đã đăng nhập', status: 'đang chạy' }
  ] as any,
  campaignActions: [{ id: 'zalo_message_phone', name: 'Nhắn tin theo SĐT', flatformType: 'zalo', isActive: true, isDelete: false }] as any,
  loadAccounts: async () => {}, loadAccountGroups: async () => {}, loadCampaignActions: async () => {}
})
useUiStore.setState({ showAlert: (message, type) => {
  state.alerts.push({ message, type })
  if (type === 'error') state.errors.push(message)
} })
;(window as any).resultSmoke = { state, store: useCampaignStore }
createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh' }}><CampaignPanel isActive /></div>)
