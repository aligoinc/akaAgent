// Thông báo nổi Desktop (NotificationToast thật + store số chưa đọc thật) với IPC giả lập.
// Chạy bằng scripts/notification-toast-desktop/run-toast-ui-smoke.cjs (Chromium của Playwright, đồng hồ giả, không ra mạng).
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import NotificationToast from '../../src/renderer/src/components/Notifications/NotificationToast'
import { useNotificationCenterStore, useNotificationUnreadSync } from '../../src/renderer/src/stores/notificationCenterStore'
import { useCampaignStore } from '../../src/renderer/src/stores/campaignStore'
import '../../src/renderer/src/styles/global.css'

type Row = Record<string, unknown>
interface Call { name: string; args?: unknown; at: number }
const initial = ((window as any).__toastInitial ?? {}) as { unread?: number; upcomingRunAts?: string[]; items?: Row[] }
const server = {
  unread: initial.unread ?? 0,
  items: (initial.items ?? []) as Row[],
  upcomingRunAts: (initial.upcomingRunAts ?? []) as string[],
  hidden: false,
  calls: [] as Call[],
  opened: [] as number[]
}
let attentionListener: (() => void) | null = null
const record = (name: string, args?: unknown) => server.calls.push({ name, args, at: Date.now() })

;(window as any).electronAPI = {
  getDesktopUiAttention: async () => { record('attention'); return { hidden: server.hidden, idleSeconds: 0 } },
  onDesktopUiAttentionChanged: (callback: () => void) => { attentionListener = callback; return () => { attentionListener = null } },
  notificationCenter: {
    unreadCount: async () => { record('unreadCount'); return { ok: true, data: server.unread } },
    list: async (query: Row) => {
      record('list', query)
      const items = server.items.filter(item => !query.unreadOnly || !item.readAt).slice(0, Number(query.limit ?? 20))
      return { ok: true, data: { items, nextCursor: null } }
    },
    getSettings: async () => {
      record('getSettings')
      return { ok: true, data: { email: null, emailVerified: false, channels: {}, subscriptions: [], upcomingRunAts: server.upcomingRunAts } }
    }
  }
}

function App() {
  const [scope, setScope] = useState('1:7')
  const [suppressed, setSuppressed] = useState(false)
  const [page, setPage] = useState('campaigns')
  const [mounted, setMounted] = useState(true)
  // Như App: chưa đăng nhập thì không có phạm vi, không có thông báo nổi.
  useNotificationUnreadSync(mounted ? scope : null, page)
  useEffect(() => {
    ;(window as any).toastSmoke = {
      server,
      setScope, setSuppressed, setPage, setMounted,
      setCampaigns: (rows: Array<{ id: number; status: string }>) => useCampaignStore.setState({ campaigns: rows as never }),
      fireAttention: () => attentionListener?.(),
      refresh: (force = true) => useNotificationCenterStore.getState().refreshUnread({ force }),
      unreadInStore: () => useNotificationCenterStore.getState().unreadCount,
      count: (name: string, since = 0) => server.calls.filter(call => call.name === name && call.at >= since).length,
      lastList: () => [...server.calls].reverse().find(call => call.name === 'list')?.args ?? null
    }
  }, [])
  return (
    <div data-smoke-mounted={String(mounted)} data-smoke-suppressed={String(suppressed)} style={{ height: '100vh', background: 'var(--bg-primary, #f5f6f8)' }}>
      <p style={{ padding: 24 }}>Trang chiến dịch (giả)</p>
      {mounted && <NotificationToast scope={scope} suppressed={suppressed} onOpen={id => server.opened.push(id)} />}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
