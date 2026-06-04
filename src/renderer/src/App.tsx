import { useEffect, useState } from 'react'
import TopBar from './components/TopBar/TopBar'
import CampaignPage from './pages/CampaignPage'
import BrowserPage from './pages/BrowserPage'
import ReportPage from './pages/ReportPage'
import LoginPage from './pages/LoginPage'
import WorkflowEditorV2 from './components/v2/WorkflowEditorV2'
import { useThemeStore } from './stores/themeStore'
import { useCampaignStore } from './stores/campaignStore'
import { useAuthStore } from './stores/authStore'
import AlertModal from './components/CampaignPanels/AlertModal'
import ConfirmModal from './components/CampaignPanels/ConfirmModal'
import UpdateModal from './components/UpdateModal/UpdateModal'
import DataScanModal from './components/DataScan/DataScanModal'
import GeneralSettingsModal, { type GeneralSettingsMenu } from './components/Settings/GeneralSettingsModal'
import ChangePasswordModal from './components/Settings/ChangePasswordModal'

export default function App() {
  const { user, initializing, rehydrateFromStorage } = useAuthStore()
  const canOpenWorkflowEditor = !!user?.isAdminAkabiz
  // Default to campaigns; workflow-editor is only available for akaBiz admin staff.
  const [activePage, setActivePage] = useState<'campaigns' | 'workflow-editor' | 'browsers' | 'reports'>('campaigns')
  const [focusAccountId, setFocusAccountId] = useState<number | null>(null)
  const [showDataScan, setShowDataScan] = useState(false)
  const [showGeneralSettings, setShowGeneralSettings] = useState(false)
  const [generalSettingsInitialMenu, setGeneralSettingsInitialMenu] = useState<GeneralSettingsMenu>('akabiz')
  const [showChangePassword, setShowChangePassword] = useState(false)

  // Bootstrap auth: re-login from stored creds (or land on LoginPage).
  useEffect(() => {
    rehydrateFromStorage()
  }, [rehydrateFromStorage])

  // Snap workflow-editor -> campaigns if user loses workflow access (e.g. after switching account).
  useEffect(() => {
    if (!canOpenWorkflowEditor && activePage === 'workflow-editor') {
      setActivePage('campaigns')
    }
  }, [canOpenWorkflowEditor, activePage])

  const { theme } = useThemeStore()
  const { loadAccounts, upsertCampaign } = useCampaignStore()

  const [updateInfo, setUpdateInfo] = useState<{ localVersion: string; remoteVersion: string } | null>(null)

  const openGeneralSettings = (menu: GeneralSettingsMenu = 'akabiz') => {
    setGeneralSettingsInitialMenu(menu)
    setShowGeneralSettings(true)
  }

  // Auto-check for updates once on app start (non-blocking).
  useEffect(() => {
    if (!window.electronAPI?.checkForUpdate) return
    const timer = setTimeout(async () => {
      try {
        const res = await window.electronAPI.checkForUpdate()
        if (res.hasUpdate) {
          setUpdateInfo({ localVersion: res.localVersion, remoteVersion: res.remoteVersion })
        } else if (res.error) {
          console.warn('Update check error:', res.error)
        }
      } catch (err) {
        console.warn('Update check failed:', err)
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, [])

  // Listen for auto-check login status updates from main process
  useEffect(() => {
    if (!window.electronAPI?.onAccountStatusUpdated) return
    const unsubscribe = window.electronAPI.onAccountStatusUpdated(() => {
      loadAccounts()
    })
    return unsubscribe
  }, [loadAccounts])

  // Listen for realtime campaign status updates (scheduler → renderer)
  useEffect(() => {
    if (!window.electronAPI?.onCampaignStatusUpdated) return
    const unsubscribe = window.electronAPI.onCampaignStatusUpdated((campaign) => {
      upsertCampaign(campaign)
    })
    return unsubscribe
  }, [upsertCampaign])

  // Apply theme class to body
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('theme-light')
    } else {
      document.body.classList.remove('theme-light')
    }
    
    if (window.electronAPI?.setTheme) {
      window.electronAPI.setTheme(theme).catch(err => console.error('Set theme error:', err))
    }
  }, [theme])

  if (initializing) {
    return (
      <div className="app-layout" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-secondary, #aaa)', fontSize: 13 }}>Đang khởi tạo…</div>
        <AlertModal />
        <ConfirmModal />
        {updateInfo && (
          <UpdateModal
            localVersion={updateInfo.localVersion}
            remoteVersion={updateInfo.remoteVersion}
            onClose={() => setUpdateInfo(null)}
          />
        )}
      </div>
    )
  }

  if (!user) {
    return (
      <div className="app-layout">
        <LoginPage />
        <AlertModal />
        <ConfirmModal />
        {updateInfo && (
          <UpdateModal
            localVersion={updateInfo.localVersion}
            remoteVersion={updateInfo.remoteVersion}
            onClose={() => setUpdateInfo(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="app-layout">
      <TopBar
        activePage={activePage}
        onPageChange={setActivePage}
        onOpenDataScan={() => setShowDataScan(true)}
        onOpenGeneralSettings={() => openGeneralSettings()}
        onOpenChangePassword={() => setShowChangePassword(true)}
      />

      <div style={{ display: activePage === 'campaigns' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <CampaignPage
          onNavigateToBrowser={(accountId) => {
            setFocusAccountId(accountId)
            setActivePage('browsers')
          }}
          onOpenGeneralSettings={openGeneralSettings}
        />
      </div>

      <div style={activePage === 'browsers'
        ? { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }
        : { display: 'none' }
      }>
        <BrowserPage focusAccountId={focusAccountId} onFocusHandled={() => setFocusAccountId(null)} />
      </div>

      <div style={{ display: activePage === 'reports' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ReportPage isActive={activePage === 'reports'} />
      </div>

      {/* Conditional render thay display:none để ReactFlow measure container đúng khi mount */}
      {activePage === 'workflow-editor' && canOpenWorkflowEditor && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <WorkflowEditorV2 />
        </div>
      )}

      <AlertModal />
      <ConfirmModal />
      {showDataScan && (
        <DataScanModal onClose={() => setShowDataScan(false)} />
      )}
      {showGeneralSettings && (
        <GeneralSettingsModal
          initialMenu={generalSettingsInitialMenu}
          onClose={() => setShowGeneralSettings(false)}
        />
      )}
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
      {updateInfo && (
        <UpdateModal
          localVersion={updateInfo.localVersion}
          remoteVersion={updateInfo.remoteVersion}
          onClose={() => setUpdateInfo(null)}
        />
      )}
    </div>
  )
}
