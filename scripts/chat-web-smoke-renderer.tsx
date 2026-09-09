import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import TopBar, { type AppPage } from '../src/renderer/src/components/TopBar/TopBar'
import ChatPage from '../src/renderer/src/pages/ChatPage'
import CrmPage from '../src/renderer/src/pages/CrmPage'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import '../src/renderer/src/styles/global.css'

const noop = () => {}

function Fixture() {
  const user = useAuthStore(state => state.user)
  const [page, setPage] = useState<AppPage>('campaigns')
  const [openedChat, setOpenedChat] = useState<string | null>(null)
  const [openedCrm, setOpenedCrm] = useState<string | null>(null)
  const chatSessionId = user?.chatWebEnabledAtLogin ? user.chatWebSessionId : undefined
  const crmStaffKey = user?.organizationId === 1 ? `${user.organizationId}:${user.staffId}` : undefined
  useEffect(() => { setOpenedChat(null) }, [chatSessionId])
  useEffect(() => { setOpenedCrm(null) }, [crmStaffKey])
  return (
    <div className="app-layout app-layout-authenticated">
      <div className="app-content-shell">
        <TopBar activePage={page} onPageChange={next => {
          setPage(next)
          if (next === 'chat' && chatSessionId) setOpenedChat(chatSessionId)
          if (next === 'crm' && crmStaffKey) setOpenedCrm(crmStaffKey)
        }}
          onOpenDataScan={noop} onOpenMediaLibrary={noop} onOpenProxyManager={noop} onOpenDataGroups={noop}
          onOpenAccountInfo={noop} onOpenGeneralSettings={noop} onOpenChangePassword={noop}
          currentVersion="fixture" checkingUpdate={false} onCheckUpdate={noop} />
        <div className="app-main">
          {chatSessionId && openedChat === chatSessionId && (
            <div style={{ display: page === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
              <ChatPage key={chatSessionId} sessionId={chatSessionId} isActive={page === 'chat'} />
            </div>
          )}
          {crmStaffKey && openedCrm === crmStaffKey && (
            <div style={{ display: page === 'crm' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
              <CrmPage key={crmStaffKey} isActive={page === 'crm'} />
            </div>
          )}
        </div>
      </div>
      <div id="fixture-overlay" style={{ display: 'none', position: 'fixed', inset: 0, zIndex: 10000, background: '#ffffffdd' }}>Modal fixture</div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
;(window as any).setFixtureUser = (user: any) => useAuthStore.setState({ user, initializing: false })
