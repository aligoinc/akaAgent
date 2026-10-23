// Render the production settings and form with isolated IPC. No external requests.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import GeneralSettingsModal from '../src/renderer/src/components/Settings/GeneralSettingsModal'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { campaignVisibilitySession } from '../src/renderer/src/stores/campaignTypeVisibilityStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import catalog from './fixtures/campaign-type-visibility/catalog.json'
import '../src/renderer/src/styles/global.css'

const state: any = { hidden: [], revision: 0, canEdit: true, writes: [], reads: [], refreshes: 0, errors: [], hold: false, fail: false, release: null }
const snapshot = (includeCatalog = false) => ({ organizationId: 9, revision: state.revision, hiddenActionIds: [...state.hidden], canEdit: state.canEdit,
  updatedAt: state.revision ? '2026-10-23T03:00:00Z' : null,
  ...(includeCatalog ? { catalog: catalog.map((action, i) => ({ ...action, campaignCount: i % 3 ? i + 1 : 0 })) } : {}) })
const handlers: Record<string, any> = {
  platform: 'darwin', getSystemSetting: () => null, getSystemSettingValue: () => null,
  getCampaignTypeVisibility: (include: boolean) => { state.reads.push(!!include); return snapshot(include) },
  patchCampaignTypeVisibility: async (changes: any[]) => {
    state.writes.push(changes)
    if (state.hold) await new Promise(resolve => { state.release = resolve })
    if (state.fail) throw new Error('Mất kết nối. Vui lòng thử lại.')
    const hidden = new Set(state.hidden)
    for (const { actionId, visible } of changes) visible ? hidden.delete(actionId) : hidden.add(actionId)
    state.hidden = [...hidden]; state.revision++; return snapshot()
  },
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getEmailNotificationSettings: () => ({ recipientEmails: [], dailyReportTime: '18:00' }),
  getCampaignInputDataLimit: () => 10000,
  getCampaignAccountActionSnapshot: () => null
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  return async (...args: any[]) => key in target ? target[key](...args) : key.startsWith('get') ? null : []
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
const user: any = { staffId: 7, organizationId: 9, organizationName: 'Công ty akaBiz', chatWebSessionId: 'fixture',
  entitlements: normalizeEntitlements({ facebookCore: true, facebookFanpage: true, zalo: true, sms: true, email: true }),
  zaloAccountCapabilities: { qr: true, web: true, server: true } }
useAuthStore.setState({ user })
useCampaignStore.setState({ accounts: [], campaigns: [], campaignActions: catalog.map(a => ({ ...a, flatformType: a.platform, isActive: true, isDelete: false })) as any,
  loadCampaigns: async () => { state.refreshes++ }, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
function App() {
  const [generation, setGeneration] = useState(0)
  const [settings, setSettings] = useState(true)
  const [form, setForm] = useState(false)
  ;(window as any).visibilitySmoke = {
    state, snapshot: () => campaignVisibilitySession.getSnapshot(),
    reopen: (canEdit = true) => { state.canEdit = canEdit; setGeneration(n => n + 1); setSettings(true) },
    openForm: () => { setForm(true); setSettings(false) },
    openSettings: () => setSettings(true),
    session: () => { useAuthStore.setState({ user: { ...user, chatWebSessionId: 'replacement' } }); setGeneration(n => n + 1) }
  }
  return <>{form && <CampaignFormModal onClose={() => setForm(false)} />}
    {settings && <GeneralSettingsModal key={generation} initialMenu="campaignTypeVisibility" onClose={() => setSettings(false)} />}</>
}
createRoot(document.getElementById('root')!).render(<App />)
