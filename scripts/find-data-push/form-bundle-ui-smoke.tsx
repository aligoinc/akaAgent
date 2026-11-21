// Form thật (CampaignFormModal) lưu chiến dịch tìm data chạy bằng Nhóm data kèm chiến dịch đích tạo cùng lúc — ca khách 2481 (21/11/2026,
// lỗi "Failed to bind campaign data group source: campaign_creation_bundle_child_invalid"). IPC giả làm đúng luật của DB:
// gắn Nhóm data mà mã gói gửi lên khác mã gói của chiến dịch thì từ chối như aka_agent_bind_campaign_data_group_source.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignStore } from '../../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../../src/renderer/src/stores/authStore'
import { useUiStore } from '../../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../../src/renderer/src/utils/entitlements'
import '../../src/renderer/src/styles/global.css'

const state: any = { calls: [], alerts: [], errors: [], campaigns: new Map(), bundles: [], binds: [], nextId: 60313, failBindOnce: false }
const dataGroup = { id: 7356, name: 'BĐS Hà Nội', color: '#2563eb', sortOrder: 1, revision: 3, dataTypeCategoryItemId: 38,
  dataTypeCode: 'facebook_person', dataTypeName: 'User Facebook', activeMembershipCount: 532, isDelete: false, staffId: 41, organizationId: 1 }
const groupLinkGroup = { ...dataGroup, id: 7357, name: 'Link group BĐS', dataTypeCategoryItemId: 39, dataTypeCode: 'facebook_group',
  dataTypeName: 'Group Facebook', activeMembershipCount: 40 }
const handlers: Record<string, any> = {
  platform: 'linux', fileExists: () => true,
  getCampaignInputDataLimit: () => 10000, getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [dataGroup, groupLinkGroup], total: 2 }),
  getDataGroup: (id: number) => (id === 7356 ? dataGroup : groupLinkGroup),
  previewDataGroupCampaignTargets: (request: any) => ({ groupId: request.groupId, totalCount: 40, validTargetCount: 40, invalidCount: 0, items: [] }),
  listDataTypeCategoryItems: () => [{ id: 38, code: 'facebook_person', name: 'User Facebook' }, { id: 39, code: 'facebook_group', name: 'Group Facebook' }],
  // Như aka_agent_create_campaign_creation_bundle: cùng mã yêu cầu thì trả lại gói cũ.
  createCampaignCreationBundle: (request: any) => {
    const existing = state.bundles.find((b: any) => b.requestId === request.requestId)
    if (existing) return existing
    const bundle = { id: 3020 + state.bundles.length, requestId: request.requestId, expectedCampaignCount: request.expectedCampaignCount, status: 'staged' }
    state.bundles.push(bundle)
    return bundle
  },
  // Như campaignRepository.createCampaign: cùng (gói, vị trí trong gói) thì trả lại chiến dịch đã tạo (chỉ mục duy nhất của DB).
  createCampaign: (payload: any) => {
    if (payload.creationBundleId != null && payload.creationBundleChildIndex != null) {
      const existing = Array.from(state.campaigns.values()).find((c: any) => !c.isDelete
        && c.creationBundleId === payload.creationBundleId && c.creationBundleChildIndex === payload.creationBundleChildIndex)
      if (existing) return existing
    }
    const campaign = { ...payload, id: state.nextId++, isDelete: false, creationBundleId: payload.creationBundleId ?? null }
    state.campaigns.set(campaign.id, campaign)
    return campaign
  },
  // Luật DB: chiến dịch có / không có gói phải gửi đúng mã gói của chính nó.
  bindCampaignDataGroupSource: (request: any) => {
    state.binds.push(request)
    const campaign = state.campaigns.get(request.campaignId)
    if (state.failBindOnce) { state.failBindOnce = false; throw new Error('Failed to bind campaign data group source: fetch failed') }
    if (!campaign || (campaign.creationBundleId ?? null) !== (request.bundleId ?? null)) {
      throw new Error('Failed to bind campaign data group source: campaign_creation_bundle_child_invalid')
    }
    campaign.dataGroupSourceBound = request.groupId
    return { id: state.binds.length, campaignId: request.campaignId, groupId: request.groupId, status: 'active' }
  },
  updateCampaign: (id: number, patch: any) => {
    const campaign = state.campaigns.get(id)
    if (campaign) Object.assign(campaign, patch)
    return campaign
  },
  deleteCampaign: (id: number) => { const c = state.campaigns.get(id); if (c) c.isDelete = true; return true },
  createCampaignInputDataBatch: (rows: any[]) => rows.length,
  finalizeCampaignCreationBundle: () => ({ ok: true }),
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
useAuthStore.setState({ user: { staffId: 41, organizationId: 1, entitlements: normalizeEntitlements({ facebookCore: true }),
  zaloAccountCapabilities: { qr: false, web: false, server: false } } as any })
useCampaignStore.setState({
  accounts: [{ id: 41, name: 'Facebook 41', flatformType: 'facebook', status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 41,
    organizationId: 1, isActive: true, isDelete: false, rateLimitMinutes: 65 } as any],
  campaignActions: [
    { id: 'facebook_find_data_group', name: 'Tìm data trong group', flatformType: 'facebook', isActive: true, isDelete: false },
    { id: 'facebook_message_uid', name: 'Nhắn tin UID', flatformType: 'facebook', isActive: true, isDelete: false, limitCheckActionCodes: ['fb_message_stranger'] },
    { id: 'facebook_comment_seeding_post', name: 'Comment vào bài', flatformType: 'facebook', isActive: true, isDelete: false }
  ] as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {}
})
useUiStore.setState({
  showAlert: (message: string, type?: string) => { state.alerts.push({ message, type }) },
  showConfirm: (_message: string, confirm: () => void) => { void confirm() }
} as any)

// Nháp đã lưu giống form của khách 2481: chiến dịch tìm data chạy bằng Nhóm data, UID tìm được đẩy sang chiến dịch nhắn UID tạo kèm.
// `targetMode`: 'data_group' = đích tạo kèm chọn chạy bằng Nhóm data (cách khách đã làm), 'direct' = đích nhập data trực tiếp.
function draftFor(targetMode: 'data_group' | 'direct') {
  const targetPayload: any = {
    name: 'Nhắn tin UID cho data tìm được', actionId: 'facebook_message_uid', accountId: 41, staffId: 41, organizationId: 1,
    schedule: '2035-01-01T09:00:00+07:00', content: 'Xin chào anh/chị', status: 'tạm dừng', extraSettings: { enableMessage: true },
    dataTargetSourceMode: targetMode, dataGroupId: targetMode === 'data_group' ? 7356 : null
  }
  return {
    id: 'f1d2-2481', revision: 1, updatedAt: '2035-01-01T09:00:00+07:00', name: 'Tìm data BĐS', actionId: 'facebook_find_data_group',
    accountIds: [41], schedule: '2035-01-01T09:00', isDelete: false, campaignIds: [], deletionReason: null,
    payload: { version: 1, values: {
      formData: { name: 'Tìm data BĐS', actionId: 'facebook_find_data_group', accountIds: [41], schedule: '2035-01-01T09:00',
        dataTargetSourceMode: 'data_group', dataGroupId: 7357, isFindUid: true, isFindInPost: true, isFindInComment: true, findUidTargetCampaignIds: [-1] },
      handleFoundUidData: true,
      internalCampaignDrafts: [{ tempId: -1, sourceType: 'messageUidTarget', actionId: 'facebook_message_uid',
        requiredTargetField: 'findUidTargetCampaignIds', items: [{ campaignPayload: targetPayload, details: [], dataGroupSnapshots: [] }] }]
    } }
  } as any
}

function App() {
  const [mode, setMode] = useState<null | 'data_group' | 'direct'>(null)
  const [generation, setGeneration] = useState(0)
  ;(window as any).bundleSmoke = {
    state,
    open: (targetMode: 'data_group' | 'direct') => { state.calls = []; state.alerts = []; setGeneration(v => v + 1); setMode(targetMode) },
    reset: () => { state.campaigns = new Map(); state.bundles = []; state.binds = []; state.nextId = 60313; state.alerts = []; state.calls = [] },
    campaigns: () => Array.from(state.campaigns.values())
  }
  return mode ? <CampaignFormModal key={`${mode}:${generation}`} onClose={() => setMode(null)} campaign={null} savedDraft={draftFor(mode)} /> : null
}
createRoot(document.getElementById('root')!).render(<App />)
