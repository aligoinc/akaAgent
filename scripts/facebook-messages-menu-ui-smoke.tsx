// Mục "Tin nhắn Facebook" trên menu bên trái: số đoạn chat chưa đọc + ô hiện khi rê chuột.
// Dựng TopBar thật với IPC giả lập; số do trang Tin nhắn Facebook gửi lên được giả bằng store.
// Chạy bằng scripts/run-facebook-messages-menu-ui-smoke.cjs (Chromium của Playwright, không cần Electron).
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TopBar, { type AppPage } from '../src/renderer/src/components/TopBar/TopBar'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useFacebookMessagesUnreadStore } from '../src/renderer/src/stores/facebookMessagesUnreadStore'
import { summarizeFacebookUnread } from '../src/shared/facebookMessages'
import '../src/renderer/src/styles/global.css'

const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String((event as PromiseRejectionEvent).reason)))

const handlers: Record<string, any> = {
  platform: 'win32',
  notificationCenter: {
    list: async () => ({ ok: true, data: { items: [], nextCursor: null, unreadCount: 0 } }),
    detail: async () => ({ ok: false, code: 'notification_not_found', message: '' }),
    markRead: async () => ({ ok: true, data: { ok: true, updated: 0, unreadCount: 0 } }),
    unreadCount: async () => ({ ok: true, data: { unreadCount: 0 } })
  }
}
;(window as any).electronAPI = new Proxy(handlers, {
  get(target, key: string) {
    if (key in target) return target[key]
    if (/^on[A-Z]/.test(key)) return () => () => undefined
    return async () => null
  }
})

useAuthStore.setState({
  user: {
    staffId: 4, organizationId: 1, username: 'demo', name: 'Nguyễn Văn Demo', fullName: 'Nguyễn Văn Demo', phone: '0900000000',
    organizationName: 'Cửa hàng Demo', isAdmin: true, isAdminAkabiz: false,
    entitlements: { facebookCore: true, facebookFanpage: false, email: false, zalo: false, sms: false },
    accountProducts: []
  } as any
})

;(window as any).menuSmoke = {
  errors,
  setSummary(accounts: { id: number; name: string; loggedIn: boolean }[], unread: [number, number][]) {
    useFacebookMessagesUnreadStore.getState().setSummary(summarizeFacebookUnread(accounts, new Map(unread)))
  },
  clearSummary() {
    useFacebookMessagesUnreadStore.getState().setSummary(null)
  }
}

const noop = () => undefined

function Harness() {
  const [activePage, setActivePage] = useState<AppPage>('campaigns')
  return (
    <div className="app-layout app-layout-authenticated platform-win32">
      <div className="app-content-shell" style={{ display: 'flex', minHeight: 0, flex: 1 }}>
        <TopBar activePage={activePage} onPageChange={setActivePage} onOpenDataScan={noop} onOpenMediaLibrary={noop} onOpenProxyManager={noop}
          onOpenDataGroups={noop} onOpenAccountInfo={noop} onOpenGeneralSettings={noop} onOpenChangePassword={noop}
          onOpenAffPartner={noop} onOpenEngineErrorReview={noop} onOpenNotifications={noop} currentVersion="10.8.0"
          checkingUpdate={false} onCheckUpdate={noop} />
        <p style={{ padding: 24, color: 'var(--text-secondary)' }}>Nội dung ứng dụng (màn Chiến dịch) nằm ở đây.</p>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
