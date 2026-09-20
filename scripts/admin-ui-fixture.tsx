import React from 'react'
import { createRoot } from 'react-dom/client'
import AdminPage from '../src/renderer/src/pages/AdminPage'
import TopBar from '../src/renderer/src/components/TopBar/TopBar'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import type { AuthUser } from '../src/shared/types'
import '../src/renderer/src/styles/global.css'

const user = { staffId: 101, organizationId: 1, username: 'fixture-admin', isAdmin: true, isAdminAkabiz: false, name: 'Admin fixture' } as AuthUser
useAuthStore.setState({ user })
window.electronAPI.onAuthUserUpdated(next => useAuthStore.setState({ user: next }))
Object.assign(window, { adminFixture: { setUser: (next: Partial<AuthUser>) => useAuthStore.setState({ user: { ...user, ...next } }) } })
function Fixture() {
  return <div className="app-layout"><div className="app-content-shell" style={{ height: '100vh' }}>
    <TopBar activePage="admin" onPageChange={() => {}} onOpenDataScan={() => {}} onOpenMediaLibrary={() => {}} onOpenProxyManager={() => {}}
      onOpenDataGroups={() => {}} onOpenAccountInfo={() => {}} onOpenGeneralSettings={() => {}} onOpenChangePassword={() => {}}
      currentVersion="fixture" checkingUpdate={false} onCheckUpdate={() => {}} />
    <AdminPage />
  </div></div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
