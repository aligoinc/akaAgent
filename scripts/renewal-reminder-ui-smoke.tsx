// Nhắc gia hạn: các thành phần giao diện Desktop thật với IPC giả lập; không kết nối production.
// Chạy bằng scripts/run-renewal-reminder-ui-smoke.cjs (Chromium của Playwright, không cần Electron).
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AppUtilityTopbar from '../src/renderer/src/components/TopBar/AppUtilityTopbar'
import RenewalReminderBanner from '../src/renderer/src/components/RenewalReminder/RenewalReminderBanner'
import RenewalReminderHost from '../src/renderer/src/components/RenewalReminder/RenewalReminderHost'
import AccountProfileModal from '../src/renderer/src/components/Settings/AccountProfileModal'
import NotificationBell from '../src/renderer/src/components/Notifications/NotificationBell'
import NotificationsPage, { type NotificationSelectRequest } from '../src/renderer/src/pages/NotificationsPage'
import type { NotificationTarget } from '../src/renderer/src/components/Notifications/notificationTargets'
import { parseNotificationDetail, parseNotificationListPage } from '../src/shared/notificationCenter'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useRenewalReminderStore } from '../src/renderer/src/stores/renewalReminderStore'
import {
  RENEWAL_REMINDER_SETTINGS_OFF, RENEWAL_REMINDER_STATE_OFF, addVietnamDays, computeRenewalReminder, toPublicRenewalReminder,
  vietnamDayOf, type RenewalReminderState
} from '../src/shared/renewalReminder'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], errors: [], scenario: '', listener: null as null | ((next: RenewalReminderState) => void) }
window.addEventListener('error', event => state.errors.push(String(event.message)))
window.addEventListener('unhandledrejection', event => state.errors.push(String((event as PromiseRejectionEvent).reason)))

/** Kịch bản: d<số ngày> gói trả phí, t<số ngày> dùng thử, thêm `+` để có ưu đãi, rỗng = không nhắc. */
function build(scenario: string): { state: RenewalReminderState; expirationDate: string | null; trial: boolean } {
  const nowMs = Date.now()
  const today = vietnamDayOf(nowMs) as string
  const match = /^([dt])(\d{1,3})(\+?)$/.exec(scenario)
  if (!match) return { state: { enabled: true, today, serverTimeMs: nowMs, reminder: null }, expirationDate: null, trial: false }
  const trial = match[1] === 't'
  const expirationDate = `${addVietnamDays(today, Number(match[2]))}T03:00:00Z`
  const reminder = computeRenewalReminder({
    today,
    settings: { ...RENEWAL_REMINDER_SETTINGS_OFF, audience: 'all' },
    products: [{
      organizationProductId: 501, group: 'zalo', displayName: 'akaAgent Zalo', packageName: trial ? 'Dùng thử' : 'akaAgent Zalo Web - 1 năm',
      isTrial: trial, expirationDate, durationDays: trial ? 3 : 366
    }],
    offers: match[3] ? [{ organizationProductId: 501, minDaysBeforeExpiry: 3, bonusDays: 15, discountType: null, discountValue: null }] : []
  })
  return { state: { enabled: true, today, serverTimeMs: nowMs, reminder: reminder ? toPublicRenewalReminder(reminder) : null }, expirationDate, trial }
}

const user = (expirationDate: string | null, trial: boolean): any => ({
  staffId: 7, organizationId: 9, username: 'demo', fullName: 'Nguyễn Văn Demo', phone: '0900000000', organizationName: 'Cửa hàng Demo',
  isAdmin: true, isAdminAkabiz: false, entitlements: {},
  accountProducts: [{
    organizationProductId: 501, productId: 16, productName: 'akaAgent Zalo', displayName: 'Zalo', packageName: trial ? 'Dùng thử' : 'akaAgent Zalo Web - 1 năm',
    packageType: trial ? 'demo' : 'year', displayOrder: 1, expirationDate, maxAccounts: 5, isActive: true, durationDays: trial ? 3 : 366
  }]
})

// Trung tâm thông báo (V457 + V520): một thông báo "Gói sắp hết hạn" và một thông báo chiến dịch, đi qua đúng bộ đọc của main.
const nowIso = new Date().toISOString()
const notificationRows: any[] = [
  { id: 900, eventType: 'package.expiring', severity: 'warning', title: 'Gói akaAgent Zalo Web - 1 năm còn 7 ngày', body: 'Hết hạn ngày 20/11/2026.',
    occurredAt: nowIso, createdAt: nowIso, readAt: null, emailState: 'none', pushState: 'none', campaignId: null, accountId: null, dataGroupId: null,
    entityKey: 'package:501' },
  { id: 899, eventType: 'campaign.status_changed', severity: 'info', title: 'Chiến dịch A đã hoàn thành', body: null,
    occurredAt: nowIso, createdAt: nowIso, readAt: null, emailState: 'none', pushState: 'none', campaignId: 42, accountId: null, dataGroupId: null,
    entityKey: 'campaign:42' }
]
const notificationContent = {
  kind: 'package',
  headline: 'Gói akaAgent Zalo Web - 1 năm còn 7 ngày',
  sections: [{ title: 'Thông tin gói', tone: 'info', rows: [
    { label: 'Gói', value: 'akaAgent Zalo Web - 1 năm' }, { label: 'Hết hạn', value: '20/11/2026', tone: 'warn' }
  ] }]
}
const notificationCall = (method: string, args: unknown[]) => state.calls.push({ method: `notificationCenter.${method}`, args })
const notificationCenter = {
  list: async (query: unknown) => {
    notificationCall('list', [query])
    return { ok: true, data: parseNotificationListPage({ items: notificationRows, nextCursor: null, unreadCount: notificationRows.filter(row => !row.readAt).length }) }
  },
  detail: async (id: number) => {
    notificationCall('detail', [id])
    const row = notificationRows.find(item => item.id === id)
    const raw = row && { ...row, emailSubject: null, content: id === 900 ? notificationContent : null, templateVersion: 1, suppressedCount: 0, mergedCount: 1, deliveries: [] }
    const detail = raw ? parseNotificationDetail(raw) : null
    return detail ? { ok: true, data: detail } : { ok: false, code: 'notification_not_found', message: 'Không tìm thấy thông báo.' }
  },
  markRead: async (request: any) => {
    notificationCall('markRead', [request])
    for (const row of notificationRows) if (request?.ids?.includes(row.id)) row.readAt = row.readAt ?? new Date().toISOString()
    return { ok: true, data: { ok: true, updated: 1, unreadCount: notificationRows.filter(row => !row.readAt).length } }
  }
}

const handlers: Record<string, any> = {
  notificationCenter,
  platform: 'win32',
  getRenewalReminderState: () => build(state.scenario).state,
  refreshRenewalReminder: () => build(state.scenario).state,
  onRenewalReminderChanged: (callback: (next: RenewalReminderState) => void) => { state.listener = callback; return () => { state.listener = null } },
  openRenewalReminderWindow: () => ({ ok: true, partition: 'akaagent_renewal', url: 'about:blank' }),
  reloadRenewalReminderWindow: () => ({ status: 'loading', signed: false, orderCompleted: false, revision: 1 }),
  closeRenewalReminderWindow: () => undefined,
  openRenewalReminderExternal: () => ({ ok: true, signed: false }),
  onRenewalReminderWebState: () => () => undefined,
  getActiveAppNotification: () => null
}
;(window as any).electronAPI = new Proxy(handlers, {
  get(target, key: string) {
    if (key in target) {
      const value = target[key]
      if (typeof value !== 'function') return value
      // Kênh đăng ký sự kiện (`on…`) trả hàm huỷ đồng bộ như preload thật; các lệnh còn lại là invoke (Promise).
      if (/^on[A-Z]/.test(key)) return (...args: unknown[]) => { state.calls.push({ method: key, args: [] }); return value(...args) }
      return async (...args: unknown[]) => { state.calls.push({ method: key, args }); return value(...args) }
    }
    if (/^on[A-Z]/.test(key)) return () => () => undefined
    return async () => { state.calls.push({ method: key, args: [] }); return null }
  }
})

// Giống `openNotificationTarget` của App.tsx: "Gói sắp hết hạn" mở cửa sổ Gia hạn gói, các đích khác chỉ ghi lại.
const openNotificationTarget = (target: NotificationTarget) => {
  state.calls.push({ method: 'openNotificationTarget', args: [target] })
  if (target.kind === 'renewal') useRenewalReminderStore.getState().openWindow()
}

let notificationSelectSeq = 0

function Harness() {
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [selectRequest, setSelectRequest] = useState<NotificationSelectRequest | null>(null)
  ;(window as any).renewalSmokeOpenProfile = () => setProfileOpen(true)
  ;(window as any).renewalSmokeNotifications = (open: boolean) => { setNotificationsOpen(open); if (!open) setSelectRequest(null) }
  return (
    <div className="app-layout app-layout-authenticated platform-win32">
      <AppUtilityTopbar currentVersion="9.7.0" checkingUpdate={false} onCheckUpdate={() => undefined} />
      <RenewalReminderBanner />
      <div className="app-content-shell" style={{ padding: 24, display: 'flex', gap: 16, minHeight: 0 }}>
        <div className="app-sidebar" style={{ width: 200 }}>
          <NotificationBell active={notificationsOpen}
            onOpenAll={() => setNotificationsOpen(true)}
            onOpenNotification={id => { setSelectRequest({ notificationId: id, requestId: ++notificationSelectSeq }); setNotificationsOpen(true) }} />
        </div>
        {notificationsOpen ? (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <NotificationsPage key="9:7" selectRequest={selectRequest} onOpenTarget={openNotificationTarget} />
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)' }}>Nội dung ứng dụng (màn Chiến dịch) nằm ở đây.</p>
        )}
      </div>
      {profileOpen && <AccountProfileModal onClose={() => setProfileOpen(false)} />}
      <RenewalReminderHost scope="9:7" />
    </div>
  )
}

;(window as any).renewalSmoke = {
  state,
  store: () => { const { state: reminderState, ...rest } = useRenewalReminderStore.getState(); return JSON.parse(JSON.stringify({ ...rest, reminder: reminderState?.reminder ?? null })) },
  /** Đổi kịch bản như thể main vừa gửi trạng thái mới; `fresh` = xoá trạng thái đã xem và coi như vừa mở phần mềm. */
  resetNotifications() { for (const row of notificationRows) row.readAt = null },
  set(scenario: string, options: { theme?: 'light' | 'dark'; fresh?: boolean } = {}) {
    state.scenario = scenario
    const next = build(scenario)
    if (options.theme) document.body.classList.toggle('theme-light', options.theme === 'light')
    if (options.fresh !== false) {
      try { window.localStorage.clear() } catch { /* ignore */ }
      useRenewalReminderStore.setState({ seen: null, dialogShownThisSession: false, dialogOpen: false, windowOpen: false, successUntil: 0 })
    }
    useAuthStore.setState({ user: user(next.expirationDate, next.trial), initializing: false })
    useRenewalReminderStore.getState().receive(next.state)
  }
}

document.body.classList.add('theme-light')
useAuthStore.setState({ user: user(null, false), initializing: false })
createRoot(document.getElementById('root')!).render(<Harness />)
