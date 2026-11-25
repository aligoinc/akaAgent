// Form xin email (V652): các thành phần giao diện Desktop thật với IPC giả lập; không kết nối production.
// Chạy bằng scripts/staff-email-prompt/run-email-prompt-ui-smoke.cjs (Chromium của Playwright, không cần Electron).
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AppUtilityTopbar from '../../src/renderer/src/components/TopBar/AppUtilityTopbar'
import EmailPromptHost from '../../src/renderer/src/components/EmailPrompt/EmailPromptHost'
import RenewalReminderHost from '../../src/renderer/src/components/RenewalReminder/RenewalReminderHost'
import AccountProfileModal from '../../src/renderer/src/components/Settings/AccountProfileModal'
import { useAuthStore } from '../../src/renderer/src/stores/authStore'
import { RENEWAL_REMINDER_STATE_OFF } from '../../src/shared/renewalReminder'
import '../../src/renderer/src/styles/global.css'

interface Scenario {
  state: Record<string, unknown>
  /** email (viết thường) → kết quả save của DB; thiếu thì lưu thành công. */
  saveReplies?: Record<string, Record<string, unknown>>
  profileEmail?: string | null
}

const smoke: any = { calls: [] as Array<{ action: string; payload: unknown }>, errors: [] as string[], scenario: null as Scenario | null }
window.addEventListener('error', event => smoke.errors.push(String(event.message)))
window.addEventListener('unhandledrejection', event => smoke.errors.push(String((event as PromiseRejectionEvent).reason)))

async function emailPromptCall(action: string, payload?: Record<string, unknown>) {
  smoke.calls.push({ action, payload: payload ?? null })
  const scenario = smoke.scenario as Scenario
  if (action === 'state') return { ok: true, data: { enabled: true, reason: '', chip: false, username: null, isAdmin: false, email: null, ...scenario.state } }
  if (action === 'dismiss') return { ok: true, data: { dismissed: true } }
  if (action === 'profile') return { ok: true, data: { enabled: true, email: scenario.profileEmail ?? null, emailList: [], isAdmin: true, verified: false } }
  if (action === 'save') {
    const email = String(payload?.email ?? '').toLowerCase()
    const reply = payload?.allowTypo ? null : scenario.saveReplies?.[email]
    if (reply) return reply
    const saved = payload?.confirm ? String(scenario.state.email) : email
    scenario.profileEmail = saved
    return { ok: true, data: { email: saved, isAdmin: true, verified: false } }
  }
  return { ok: false, code: 'invalid_action', message: 'x' }
}

;(window as any).electronAPI = new Proxy({
  emailPromptCall,
  getRenewalReminderState: async () => RENEWAL_REMINDER_STATE_OFF(Date.now()),
  onRenewalReminderChanged: () => () => undefined,
  getActiveAppNotification: async () => null
} as Record<string, unknown>, {
  get(target, key: string) {
    if (key in target) return target[key]
    if (/^on[A-Z]/.test(key)) return () => () => undefined
    return async () => null
  }
})

let scopeSeq = 0

function Harness() {
  const [scope, setScope] = useState<string | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [blocker, setBlocker] = useState(false)
  smoke.start = (scenario: Scenario, options: { blocker?: boolean } = {}) => {
    smoke.calls.length = 0
    smoke.scenario = scenario
    setProfileOpen(false)
    setBlocker(!!options.blocker)
    setScope(`9:${++scopeSeq}`)
  }
  smoke.stop = () => setScope(null)
  smoke.setBlocker = (value: boolean) => setBlocker(value)
  smoke.openProfile = () => setProfileOpen(true)
  return (
    <div className="app-layout app-layout-authenticated platform-win32">
      <AppUtilityTopbar currentVersion="10.4.0" checkingUpdate={false} onCheckUpdate={() => undefined} />
      <div className="app-content-shell" style={{ padding: 24 }}>
        <p style={{ color: 'var(--text-secondary)' }}>Nội dung ứng dụng (màn Chiến dịch) nằm ở đây.</p>
      </div>
      {blocker && (
        <div className="modal-overlay" data-testid="blocker">
          <div className="modal"><button type="button" onClick={() => setBlocker(false)}>Đóng hộp thoại khác</button></div>
        </div>
      )}
      {profileOpen && <AccountProfileModal onClose={() => setProfileOpen(false)} />}
      {scope && <RenewalReminderHost scope={scope} />}
      {scope && <EmailPromptHost scope={scope} />}
    </div>
  )
}

;(window as any).emailSmoke = smoke
;(window as any).emailSmokeTheme = (light: boolean) => document.body.classList.toggle('theme-light', light)
useAuthStore.setState({
  user: { staffId: 7, organizationId: 9, username: 'hoangmai', name: 'Hoàng Mai', phone: '0900000000', isAdmin: true, isAdminAkabiz: false, entitlements: {}, accountProducts: [] } as any,
  initializing: false
} as any)
createRoot(document.getElementById('root')!).render(<Harness />)
