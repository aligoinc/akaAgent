// Isolated real-form harness: no production API, accounts, files or scheduler.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import CampaignPanel from '../src/renderer/src/components/CampaignPanels/CampaignPanel'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], saved: null, errors: [], alerts: [], nextCampaignId: 100 }
const original: any = {
  id: '61b21e19-7ed9-419f-af2c-fc124eea4c81', revision: 1, updatedAt: '2035-01-01T09:00:00+07:00',
  name: 'Nháp smoke', actionId: 'facebook_message_uid', accountIds: [41], schedule: '2035-01-01T09:00',
  isDelete: false, campaignIds: [], deletionReason: null,
  payload: { version: 1, values: {
    formData: { name: 'Nháp smoke', actionId: 'facebook_message_uid', accountIds: [41], schedule: '2035-01-01T09:00',
      content: 'Nội dung đang viết', enableMessage: true, rewriteContentEachRun: false,
      dailyLimit: 0, images: [{ localPath: '/draft-smoke/image.png', name: 'image.png', mimeType: 'image/png' }] },
    details: [{ uid: '100000000000001', name: 'Khách A', info1: 'Giữ dữ liệu', note: 'Đang nhập' }, { uid: '', name: 'Chưa hoàn thiện' }],
    advancedContentSourceMode: 'manual', selectedFindDataSourceCampaignIds: [71],
    internalCampaignDrafts: [{ tempId: -5, sourceType: 'findDataSource', actionId: 'facebook_find_data', items: [] }]
  } }
}
state.saved = structuredClone(original)
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  listCampaignDrafts: (page = 1) => {
    if (state.listError) throw new Error('Smoke: không tải được nháp')
    const drafts = state.listItems || (state.saved.isDelete ? [] : [state.saved])
    return { items: drafts.slice((page - 1) * 50, page * 50).map(({ payload: _payload, ...summary }: any) => summary), total: drafts.length }
  },
  getCampaignDraft: () => structuredClone(state.saved),
  saveCampaignDraft: (request: any) => {
    state.saved = { ...state.saved, ...request, ...request.payload.values.formData, isDelete: false,
      name: request.payload.values.formData.name, revision: state.saved.revision + 1 }
    return structuredClone(state.saved)
  },
  deleteCampaignDraft: () => { state.saved.isDelete = true },
  completeCampaignDraft: (request: any) => {
    if (state.failComplete) throw new Error('Smoke: completion failed')
    state.saved.isDelete = true
    state.saved.deletionReason = 'converted'
    state.saved.campaignIds = request.campaignIds
  },
  getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }),
  listCampaignInputData: () => [{ uid: 'clone-uid', name: 'Clone data', info1: 'Clone info' }],
  getCampaignConfig: (id: number) => {
    if (id !== 91) return { id, name: 'Source', actionId: 'facebook_find_data', status: 'tạm dừng', extraSettings: {} }
    const value = { id, name: 'Chiến dịch thật', actionId: 'facebook_message_uid', accountId: 41,
      staffId: 41, organizationId: 1, schedule: '2035-01-01T09:00:00+07:00', updatedAt: '2035-01-01T09:00:00+07:00',
      status: 'chờ xử lý', content: 'Nội dung thật', extraSettings: { enableMessage: true } }
    return value
  },
  createCampaign: (payload: any) => ({ ...payload, id: state.nextCampaignId++ }),
  createCampaignInputDataBatch: (rows: any[]) => { if (state.failInput) throw new Error('Smoke: input failed'); return rows.length },
  generateCampaignName: () => 'AI must not overwrite saved name'
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
useAuthStore.setState({ user: { staffId: 41, organizationId: 1, entitlements: normalizeEntitlements({ facebookCore: true }),
  zaloAccountCapabilities: { qr: false, web: false, server: false } } as any })
useCampaignStore.setState({
  accounts: [41, 42].map((id, index) => ({ id, name: `Facebook smoke ${id}`, flatformType: 'facebook', status: 'chờ xử lý', loginStatus: 'đã đăng nhập',
    staffId: 41, organizationId: 1, isActive: true, isDelete: false, rateLimitMinutes: index === 0 ? 120 : 180 } as any)),
  campaignActions: [
    { id: 'facebook_message_uid', name: 'Nhắn tin UID', flatformType: 'facebook', isActive: true, isDelete: false,
      limitCheckActionCodes: ['fb_message_stranger'] },
    { id: 'facebook_timeline_post', name: 'Đăng bài trang cá nhân', flatformType: 'facebook', isActive: true, isDelete: false }
  ] as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {},
  loadAccounts: async () => {}, loadCampaignActions: async () => {}
})
useUiStore.setState({
  showAlert: (message, type) => { state.alerts.push({ message, type }); document.getElementById('smoke-alert')!.textContent = message },
  showConfirm: (_message, confirm) => { void confirm() }
})

function App() {
  const [mode, setMode] = useState('saved')
  const [generation, setGeneration] = useState(0)
  const close = () => setMode('closed')
  const open = (value: string) => { state.calls = []; state.alerts = []; setGeneration(value => value + 1); setMode(value) }
  const prepareRateLimitCase = (scenario: string) => {
    if (!['default', 'multiple', 'manual', 'clone'].includes(scenario)) throw new Error('Unknown rate-limit scenario')
    const draft = structuredClone(original)
    const accountIds = scenario === 'multiple' || scenario === 'manual' ? [41, 42] : [41]
    const values = draft.payload.values
    Object.assign(values.formData, { accountIds, rateLimitMinutes: scenario === 'clone' ? 95 : 65,
      actionLimitsByCode: { fb_message_stranger: { dailyLimit: 30, rateLimitCount: 9, rateLimitMinutes: scenario === 'manual' || scenario === 'clone' ? 45 : 65 } } })
    values.editedRateLimitMinuteActions = scenario === 'manual' ? { fb_message_stranger: true } : {}
    if (scenario === 'clone') {
      draft.payload.cloneSourceCampaignId = 7
      draft.payload.baseCampaign = { name: 'Clone source', actionId: 'facebook_message_uid', accountId: 41,
        extraSettings: { actionLimits: { rateLimitMinutes: 95, byActionCode: { fb_message_stranger: {
          dailyLimit: 30, rateLimitCount: 9, rateLimitMinutes: 45
        } } } } }
    }
    state.saved = draft
    state.rateLimitScenario = scenario
    state.expectedRateLimits = accountIds.map(accountId => ({ accountId,
      rateLimitMinutes: scenario === 'clone' ? 95 : accountId === 41 ? 120 : 180,
      actionRateLimitMinutes: scenario === 'manual' || scenario === 'clone' ? 45 : accountId === 41 ? 120 : 180
    }))
    open('saved')
  }
  const assertRateLimits = () => {
    const calls = state.calls.filter((item: any) => item.method === 'createCampaign')
    if (!calls.length) throw new Error(`Create was not called: ${JSON.stringify(state.alerts)}`)
    const actual = calls.map(({ args: [item] }: any) => ({ accountId: item.accountId,
      rateLimitMinutes: item.extraSettings.actionLimits.rateLimitMinutes,
      actionRateLimitMinutes: item.extraSettings.actionLimits.byActionCode.fb_message_stranger.rateLimitMinutes
    }))
    if (JSON.stringify(actual) !== JSON.stringify(state.expectedRateLimits)) {
      throw new Error(`Expected ${JSON.stringify(state.expectedRateLimits)}, received ${JSON.stringify(actual)}`)
    }
    if (state.errors.length > 0) throw new Error(JSON.stringify(state.errors))
    return { scenario: state.rateLimitScenario, result: 'PASS', actual }
  }
  const prepareList = (count = 1) => {
    state.saved = structuredClone(original)
    state.listItems = count > 1 ? Array.from({ length: count }, (_, index) => ({ ...structuredClone(original),
      id: `${original.id}-${index}`, name: `Nháp ${index + 1}` })) : null
    useCampaignStore.setState({ campaigns: [{ id: 91, name: 'Chiến dịch thật', actionId: 'facebook_message_uid',
      accountId: 41, accountName: 'Facebook smoke 41', schedule: '2035-01-01T09:00:00+07:00',
      updatedAt: '2035-01-01T09:00:00+07:00', status: 'chờ xử lý', isDelete: false, relationSettings: {} }] as any })
    open('list')
  }
  ;(window as any).draftSmokeUI = { state, original, open, prepareRateLimitCase, assertRateLimits, prepareList,
    reset: () => { state.saved = structuredClone(original); open('saved') } }
  const base = { id: 7, name: 'Campaign smoke', actionId: 'facebook_message_uid', accountId: 41, schedule: '2035-01-01T09:00:00+07:00',
    content: 'Nội dung chính thức', status: 'tạm dừng', extraSettings: { enableMessage: true, sourceLinkIndex: 9, contentRotationIndex: 7 } } as any
  return <>
    <div style={{ padding: 12 }}>
      {['saved', 'list', 'new', 'clone', 'edit'].map(value => <button key={value} onClick={() => open(value)}>{value}</button>)}
      <div id="smoke-alert" role="status" />
    </div>
    {mode === 'list' ? <div style={{ height: 'calc(100vh - 60px)' }}>
      <CampaignPanel key={generation} isActive={true} /></div>
      : mode !== 'closed' && <CampaignFormModal key={`${mode}:${generation}`} onClose={close}
        campaign={mode === 'edit' ? base : mode === 'clone' ? { ...base, id: undefined } : null}
        cloneFromId={mode === 'clone' ? 7 : undefined}
        savedDraft={mode === 'saved' ? structuredClone(state.saved) : undefined} />}
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
