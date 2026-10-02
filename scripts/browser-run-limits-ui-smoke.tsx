import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import GeneralSettingsModal from '../src/renderer/src/components/Settings/GeneralSettingsModal'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import '../src/renderer/src/styles/global.css'

const state: any = { reads: 0, saves: [], errors: [], settings: { zaloWebMax: null, facebookMax: null, revision: 0 }, failGet: false, failSave: false, conflict: false, deferSave: false, deferGet: false, pending: [] }
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
window.electronAPI = {
  getAkaBizIntegrations: async () => ({}), listAkaBizContactTags: async () => [],
  getEmailNotificationSettings: async () => ({ isEnabled: false, recipientEmails: [] }),
  getBrowserRunLimits: async () => {
    state.reads++
    if (state.failGet) throw Error('fixture network error')
    const snapshot = { ...state.settings }
    if (state.deferGet) return new Promise(resolve => state.pending.push(() => resolve(snapshot)))
    return snapshot
  },
  saveBrowserRunLimits: async (input: any) => {
    state.saves.push(input)
    if (state.failSave) throw Error('fixture network error')
    if (state.conflict) return { ok: false, reason: 'conflict' }
    const result = { ok: true, settings: { ...input, revision: input.revision + 1 } }
    if (state.deferSave) return new Promise(resolve => state.pending.push(() => resolve(result)))
    state.settings = result.settings
    return result
  }
} as any
useAuthStore.setState({ user: { staffId: 1, organizationId: 9 } as any })
function App() {
  const [visible, setVisible] = useState(true), [generation, setGeneration] = useState(0)
  ;(window as any).limitsSmoke = { state,
    open: () => { setGeneration(x => x + 1); setVisible(true) },
    switchUser: () => useAuthStore.setState({ user: { staffId: 2, organizationId: 9 } as any }),
    resolve: () => state.pending.splice(0).forEach((fn: any) => fn())
  }
  return visible ? <GeneralSettingsModal key={generation} onClose={() => setVisible(false)} /> : null
}
createRoot(document.getElementById('root')!).render(<App />)
