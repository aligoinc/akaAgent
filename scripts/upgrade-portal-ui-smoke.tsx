// "Nâng cấp và mua gói": các thành phần giao diện Desktop thật với IPC giả lập; không kết nối production.
// Chạy bằng scripts/run-upgrade-portal-ui-smoke.cjs (Chromium của Playwright, không cần Electron).
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TopBar from '../src/renderer/src/components/TopBar/TopBar'
import AppNotificationBar from '../src/renderer/src/components/AppNotificationBar/AppNotificationBar'
import AlertModal from '../src/renderer/src/components/CampaignPanels/AlertModal'
import AccountProfileModal from '../src/renderer/src/components/Settings/AccountProfileModal'
import LoginInformationPanel from '../src/renderer/src/components/Login/LoginInformationPanel'
import RenewalReminderHost from '../src/renderer/src/components/RenewalReminder/RenewalReminderHost'
import UpgradePortalHost from '../src/renderer/src/components/UpgradePortal/UpgradePortalHost'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useRenewalReminderStore } from '../src/renderer/src/stores/renewalReminderStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { useUpgradePortalStore } from '../src/renderer/src/stores/upgradePortalStore'
import {
  RENEWAL_REMINDER_SETTINGS_OFF, addVietnamDays, computeRenewalReminder, toPublicRenewalReminder, vietnamDayOf,
  type RenewalReminderState
} from '../src/shared/renewalReminder'
import type { RenewalWebState } from '../src/shared/types'
import '../src/renderer/src/styles/global.css'

const state: any = {
  calls: [], errors: [], clicks: [],
  notification: null as any,
  upgradePayment: 'https://crm.akabiz.net/gia-han',
  closeUpdated: false,
  reminder: false,
  webState: null as null | ((next: RenewalWebState) => void)
}
window.addEventListener('error', event => state.errors.push(String(event.message)))
window.addEventListener('unhandledrejection', event => state.errors.push(String((event as PromiseRejectionEvent).reason)))
// Ghi lại link nào còn để trình duyệt xử lý (không bị giao diện chặn), rồi chặn để trang kiểm thử không rời đi.
document.addEventListener('click', event => {
  const anchor = (event.target as HTMLElement | null)?.closest?.('a')
  if (!anchor) return
  state.clicks.push({ href: anchor.getAttribute('href'), handledInApp: event.defaultPrevented })
  event.preventDefault()
})

const today = vietnamDayOf(Date.now()) as string
const expiry = (days: number) => `${addVietnamDays(today, days)}T03:00:00Z`

/** `reminder` = true: gói Zalo (501) còn 7 ngày và đang được nhắc; gói Facebook (502) còn dài hạn. */
function reminderState(reminder: boolean): RenewalReminderState {
  const nowMs = Date.now()
  if (!reminder) return { enabled: true, today, serverTimeMs: nowMs, reminder: null }
  const computed = computeRenewalReminder({
    today,
    settings: { ...RENEWAL_REMINDER_SETTINGS_OFF, audience: 'all' },
    products: [{ organizationProductId: 501, group: 'zalo', displayName: 'akaAgent Zalo', packageName: 'akaAgent Zalo Web - 1 năm', isTrial: false, expirationDate: expiry(7), durationDays: 366 }],
    offers: []
  })
  return { enabled: true, today, serverTimeMs: nowMs, reminder: computed ? toPublicRenewalReminder(computed) : null }
}

const user = (staffId: number, reminder: boolean): any => ({
  staffId, organizationId: 9, username: 'demo', name: 'Nguyễn Văn Demo', fullName: 'Nguyễn Văn Demo', phone: '0900000000',
  organizationName: 'Cửa hàng Demo', isAdmin: true, isAdminAkabiz: false, entitlements: {},
  accountProducts: [
    { organizationProductId: 501, feature: 'zalo', productId: 16, productName: 'akaAgent Zalo', displayName: 'Zalo', packageName: 'akaAgent Zalo Web - 1 năm',
      packageType: 'year', displayOrder: 1, expirationDate: expiry(reminder ? 7 : 200), maxAccounts: 5, isActive: true, durationDays: 366 },
    { organizationProductId: 502, feature: 'facebook', productId: 3, productName: 'akaAgent Facebook', displayName: 'Facebook', packageName: 'akaAgent Facebook - 1 năm',
      packageType: 'year', displayOrder: 2, expirationDate: expiry(300), maxAccounts: 10, isActive: true, durationDays: 366 }
  ]
})

const descriptor = { ok: true, partition: 'akaagent_renewal', url: 'about:blank' }
const handlers: Record<string, any> = {
  platform: 'win32',
  notificationCenter: {
    list: async () => ({ ok: true, data: { items: [], nextCursor: null, unreadCount: 0 } }),
    detail: async () => ({ ok: false, code: 'notification_not_found', message: '' }),
    markRead: async () => ({ ok: true, data: { ok: true, updated: 0, unreadCount: 0 } }),
    unreadCount: async () => ({ ok: true, data: { unreadCount: 0 } })
  },
  getActiveAppNotification: () => state.notification,
  getRenewalReminderState: () => reminderState(state.reminder),
  refreshRenewalReminder: () => reminderState(state.reminder),
  onRenewalReminderChanged: () => () => undefined,
  openRenewalReminderWindow: () => descriptor,
  reloadRenewalReminderWindow: () => ({ status: 'loading', signed: false, orderCompleted: false, revision: 1 }),
  closeRenewalReminderWindow: () => undefined,
  openRenewalReminderExternal: () => ({ ok: true, signed: false }),
  onRenewalReminderWebState: () => () => undefined,
  openUpgradePortal: () => descriptor,
  reloadUpgradePortal: () => ({ status: 'loading', signed: false, orderCompleted: false, revision: 1 }),
  closeUpgradePortal: () => ({ updated: state.closeUpdated }),
  openUpgradePortalExternal: () => ({ ok: true, signed: true }),
  onUpgradePortalWebState: (callback: (next: RenewalWebState) => void) => { state.webState = callback; return () => { state.webState = null } }
}
;(window as any).electronAPI = new Proxy(handlers, {
  get(target, key: string) {
    if (key in target) {
      const value = target[key]
      if (typeof value !== 'function') return value
      // Kênh đăng ký sự kiện (`on…`) trả hàm huỷ đồng bộ như preload thật; các lệnh còn lại là invoke (Promise).
      if (/^on[A-Z]/.test(key)) return (...args: unknown[]) => value(...args)
      return async (...args: unknown[]) => { state.calls.push({ method: key, args }); return value(...args) }
    }
    if (/^on[A-Z]/.test(key)) return () => () => undefined
    return async () => null
  }
})

const noop = () => undefined

function Harness() {
  const loggedIn = useAuthStore(store => store.user)
  const [profileOpen, setProfileOpen] = useState(false)
  const [barKey, setBarKey] = useState(0)
  ;(window as any).upgradeSmokeProfile = (open: boolean) => setProfileOpen(open)
  ;(window as any).upgradeSmokeReloadBar = () => setBarKey(key => key + 1)
  if (!loggedIn) {
    return (
      <div className="app-layout platform-win32">
        <LoginInformationPanel content={{
          notification: null,
          links: { website: 'https://akabiz.net', userGuide: null, upgradePayment: state.upgradePayment, contactUs: null, recoverAccount: null, trialSignup: null }
        }} />
        <UpgradePortalHost scope={null} />
        <AlertModal />
      </div>
    )
  }
  const scope = `${loggedIn.organizationId}:${loggedIn.staffId}`
  return (
    <div className="app-layout app-layout-authenticated platform-win32">
      <AppNotificationBar key={`${scope}:${barKey}`} />
      <div className="app-content-shell" style={{ display: 'flex', minHeight: 0, flex: 1 }}>
        <TopBar activePage="campaigns" onPageChange={noop} onOpenDataScan={noop} onOpenMediaLibrary={noop} onOpenProxyManager={noop}
          onOpenDataGroups={noop} onOpenAccountInfo={() => setProfileOpen(true)} onOpenGeneralSettings={noop} onOpenChangePassword={noop}
          onOpenAffPartner={noop} onOpenNotifications={noop} currentVersion="9.9.0" checkingUpdate={false} onCheckUpdate={noop} />
        <p style={{ padding: 24, color: 'var(--text-secondary)' }}>Nội dung ứng dụng (màn Chiến dịch) nằm ở đây.</p>
      </div>
      {profileOpen && <AccountProfileModal onClose={() => setProfileOpen(false)} />}
      <AlertModal />
      <RenewalReminderHost scope={scope} />
      <UpgradePortalHost scope={scope} />
    </div>
  )
}

;(window as any).upgradeSmoke = {
  state,
  shop: () => JSON.parse(JSON.stringify({ request: useUpgradePortalStore.getState().request, openSeq: useUpgradePortalStore.getState().openSeq })),
  reminderWindowOpen: () => useRenewalReminderStore.getState().windowOpen,
  /** Đăng nhập nhân viên `staffId` (0 = màn đăng nhập); `reminder` = gói Zalo đang được nhắc gia hạn. */
  login(staffId: number, options: { reminder?: boolean } = {}) {
    useUiStore.getState().closeAlert()
    state.reminder = !!staffId && !!options.reminder
    if (!staffId) { useAuthStore.setState({ user: null, initializing: false }); return }
    useAuthStore.setState({ user: user(staffId, state.reminder), initializing: false })
    // Chờ host vào phiên xong rồi mới đặt trạng thái: không để hộp thoại nhắc gia hạn tự bật che các nút đang kiểm.
    window.setTimeout(() => {
      useRenewalReminderStore.setState({ seen: null, dialogShownThisSession: true, dialogOpen: false, windowOpen: false, successUntil: 0 })
      useRenewalReminderStore.getState().receive(reminderState(state.reminder))
    }, 50)
  },
  open(from: any, entitlementId?: number) { useUpgradePortalStore.getState().open({ from, entitlementId }) },
  alert(message: string, type: any, action?: boolean) {
    useUiStore.getState().showAlert(message, type, action ? { action: { label: 'Thử lại', onClick: () => undefined } } : undefined)
  },
  web(next: Partial<RenewalWebState>) { state.webState?.({ revision: Date.now(), status: 'ready', signed: true, orderCompleted: false, ...next }) },
  clear() { state.calls.length = 0; state.clicks.length = 0 }
}

document.body.classList.add('theme-light')
useAuthStore.setState({ user: user(7, false), initializing: false })
createRoot(document.getElementById('root')!).render(<Harness />)
