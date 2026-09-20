import { useState } from 'react'
import { BookOpen, Bell, Settings, Clock, Code, ShieldCheck } from 'lucide-react'
import { canAccessAdmin } from '../../../shared/admin'
import { useAuthStore } from '../stores/authStore'
import { AdminBusyContext } from '../components/Admin/common'
import { AdminDocs } from '../components/Admin/AdminDocs'
import { AdminNotifications } from '../components/Admin/AdminNotifications'
import { AdminSettings } from '../components/Admin/AdminSettings'
import { AdminCron, AdminTriggers } from '../components/Admin/AdminDiagnostics'
import '../components/Admin/admin.css'

const menus = [
  { id: 'docs', name: 'Doc API', icon: BookOpen },
  { id: 'notifications', name: 'Thông báo trên Web/App', icon: Bell },
  { id: 'settings', name: 'Cài đặt hệ thống', icon: Settings },
  { id: 'cron', name: 'Cron job Supabase', icon: Clock },
  { id: 'triggers', name: 'Function from Trigger', icon: Code }
] as const

export default function AdminPage() {
  const user = useAuthStore(state => state.user)
  const [menu, setMenu] = useState<typeof menus[number]['id']>('docs')
  const [busy, setBusy] = useState(false)
  if (!canAccessAdmin(user)) return null
  return <AdminBusyContext.Provider value={setBusy}>
    <section className="admin-page" aria-label="Admin akaBiz">
      <header className="admin-heading"><ShieldCheck size={24} /><div><h1>Admin akaBiz</h1><p>Các cài đặt nội bộ của hệ thống akaBiz</p></div><span className="admin-badge">Nội bộ</span></header>
      <div className="admin-layout">
        <nav className="admin-menu" aria-label="Menu Admin akaBiz">
          {menus.map(item => <button key={item.id} type="button" disabled={busy} aria-current={menu === item.id ? 'page' : undefined}
            onClick={() => setMenu(item.id)}><item.icon size={17} /><span>{item.name}</span></button>)}
        </nav>
        <main className="admin-content">
          {menu === 'docs' && <AdminDocs />}
          {menu === 'notifications' && <AdminNotifications />}
          {menu === 'settings' && <AdminSettings />}
          {menu === 'cron' && <AdminCron />}
          {menu === 'triggers' && <AdminTriggers />}
        </main>
      </div>
    </section>
  </AdminBusyContext.Provider>
}
