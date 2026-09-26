import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import ContentTemplateWorkspace from '../src/renderer/src/components/ContentTemplates/ContentTemplateWorkspace'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { useContentTemplateStore } from '../src/renderer/src/stores/contentTemplateStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], errors: [], alerts: [], fail: false, hold: false, releases: [],
  groups: [{ id: 31, name: 'Chăm sóc', order: 1, isActive: true, isDelete: false, templateCount: null }],
  templates: [1, 2].map(id => ({ id, name: `Mẫu ${id}`, groupId: 31, groupName: 'Chăm sóc', isDelete: false,
    channels: { zalo_message: { enabled: true, variants: [{ text: `Xin chào ${id}` }], imageUrls: [] } } })) }
const accounts: any[] = [{ id: 11, name: 'Zalo 11', flatformType: 'zalo', isActive: true, isDelete: false,
  status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 9 }]
const handlers: Record<string, any> = {
  platform: 'darwin', getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  listContentTemplates: async () => {
    if (state.hold) await new Promise(resolve => state.releases.push(resolve))
    if (state.fail) throw new Error('Fixture: fetch failed')
    return structuredClone(state.templates)
  },
  listContentTemplateGroups: () => structuredClone(state.groups),
  listContentTemplateContentTypes: () => [{ id: 1, name: 'zalo_message', label: 'Zalo', order: 1, isActive: true }],
  createContentTemplateGroup: (input: any) => {
    const group = { ...input, id: state.groups.length + 31, isDelete: false, templateCount: null }
    state.groups.push(group); return group
  },
  deleteContentTemplateGroup: (id: number) => { state.groups = state.groups.filter((group: any) => group.id !== id) },
  createContentTemplate: (input: any) => { const row = { ...input, id: state.templates.length + 1, isDelete: false }; state.templates.push(row); return row },
  listAccounts: () => accounts,
  saveCampaignDraft: (request: any) => ({ ...request, revision: 2, updatedAt: new Date().toISOString() })
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
useAuthStore.setState({ user: { staffId: 7, organizationId: 9, entitlements: normalizeEntitlements({ zalo: true }) } as any })
useCampaignStore.setState({ accounts: accounts as any, campaignActions: [{ id: 'zalo_message_friend', name: 'Gửi tin nhắn bạn bè', flatformType: 'zalo', isActive: true, isDelete: false }] as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })

function App() {
  const [mode, setMode] = useState('basic')
  const [generation, setGeneration] = useState(0)
  ;(window as any).templateUi = { state, store: useContentTemplateStore,
    show: (next: string) => { setMode(next); setGeneration(value => value + 1) },
    release: () => { state.hold = false; state.releases.splice(0).forEach((done: any) => done()) } }
  const campaign: any = { id: 7, name: 'Chiến dịch mẫu', actionId: 'zalo_message_friend', accountId: 11,
    schedule: '2035-01-01T09:00', content: 'Xin chào', status: 'tạm dừng', extraSettings: {
      advancedContentEnabled: true, advancedContentSource: 'group_snapshot',
      advancedContentItems: [{ id: 'snapshot-item', content: 'Nội dung snapshot giữ nguyên', images: [] }],
      advancedContentGroupSnapshot: { groupId: 31, groupName: 'Chăm sóc', templateCount: 1, itemCount: 1,
        capturedAt: '2026-01-01T00:00:00Z', channel: 'zalo_message' }
    } }
  return <>
    <div style={{ display: mode === 'workspace' || mode === 'both' ? 'flex' : 'none', height: '100vh' }}>
      <ContentTemplateWorkspace isActive={mode === 'workspace' || mode === 'both'} />
    </div>
    {mode !== 'workspace' && <CampaignFormModal key={generation} onClose={() => setMode('workspace')}
      campaign={mode === 'group' || mode === 'both' ? campaign : null}
      lockedActionId="zalo_message_friend" initialAccountIds={[11]} />}
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
