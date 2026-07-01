import { useCallback, useEffect, useRef, useState } from 'react'
import TopBar from './components/TopBar/TopBar'
import AppUtilityTopbar from './components/TopBar/AppUtilityTopbar'
import CampaignPage from './pages/CampaignPage'
import BrowserPage, { type BrowserOpenRequest } from './pages/BrowserPage'
import ReportPage from './pages/ReportPage'
import LoginPage from './pages/LoginPage'
import WorkflowEditorV2 from './components/v2/WorkflowEditorV2'
import { useThemeStore } from './stores/themeStore'
import { useCampaignStore } from './stores/campaignStore'
import { useAuthStore } from './stores/authStore'
import { useUiStore } from './stores/uiStore'
import AlertModal from './components/CampaignPanels/AlertModal'
import ConfirmModal from './components/CampaignPanels/ConfirmModal'
import UpdateModal from './components/UpdateModal/UpdateModal'
import DataScanModal from './components/DataScan/DataScanModal'
import DataGroupManagerModal from './components/DataScan/DataGroupManagerModal'
import GeneralSettingsModal, { type GeneralSettingsMenu } from './components/Settings/GeneralSettingsModal'
import ContentTemplateManagerModal from './components/Settings/ContentTemplateManagerModal'
import ChangePasswordModal from './components/Settings/ChangePasswordModal'
import AccountProfileModal from './components/Settings/AccountProfileModal'
import MediaLibraryModal from './components/Media/MediaLibraryModal'
import ProxyManagerModal from './components/CampaignPanels/ProxyManagerModal'

type UpdatePromptSource = 'startup' | 'manual'

interface UpdateInfo {
  localVersion: string
  remoteVersion: string
  source: UpdatePromptSource
}

export default function App() {
  const { user, initializing, rehydrateFromStorage, handleSessionExpired, handleUserUpdated } = useAuthStore()
  const { theme } = useThemeStore()
  const {
    accounts,
    proxies,
    loadAccounts,
    loadProxies,
    createProxy,
    updateProxy,
    deleteProxy,
    loadCampaigns,
    loadCampaignActions,
    upsertCampaign
  } = useCampaignStore()
  const canOpenWorkflowEditor = !!user?.isAdminAkabiz
  // Default to campaigns; workflow-editor is only available for akaBiz admin staff.
  const [activePage, setActivePage] = useState<'campaigns' | 'workflow-editor' | 'browsers' | 'reports'>('campaigns')
  const [browserOpenRequest, setBrowserOpenRequest] = useState<BrowserOpenRequest | null>(null)
  const browserOpenRequestSeq = useRef(0)
  const [showDataScan, setShowDataScan] = useState(false)
  const [showMediaLibrary, setShowMediaLibrary] = useState(false)
  const [showProxyManager, setShowProxyManager] = useState(false)
  const [showContentTemplates, setShowContentTemplates] = useState(false)
  const [showDataGroups, setShowDataGroups] = useState(false)
  const [showGeneralSettings, setShowGeneralSettings] = useState(false)
  const [generalSettingsInitialMenu, setGeneralSettingsInitialMenu] = useState<GeneralSettingsMenu>('akabiz')
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showAccountProfile, setShowAccountProfile] = useState(false)
  const [localVersion, setLocalVersion] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const authBootstrapStarted = useRef(false)
  const startupUpdateCheckStarted = useRef(false)
  const runtimePlatform = window.electronAPI?.platform || 'unknown'
  const platformClass = `platform-${runtimePlatform}`

  const startAuthBootstrap = useCallback(() => {
    if (authBootstrapStarted.current) return
    authBootstrapStarted.current = true
    void rehydrateFromStorage()
  }, [rehydrateFromStorage])

  useEffect(() => {
    if (!window.electronAPI?.onAuthSessionExpired) return
    return window.electronAPI.onAuthSessionExpired((payload) => {
      handleSessionExpired(payload?.message)
    })
  }, [handleSessionExpired])

  useEffect(() => {
    if (!window.electronAPI?.onAuthUserUpdated) return
    return window.electronAPI.onAuthUserUpdated((nextUser) => {
      handleUserUpdated(nextUser)
      void loadAccounts()
      void loadCampaigns()
      void loadCampaignActions()
    })
  }, [handleUserUpdated, loadAccounts, loadCampaigns, loadCampaignActions])

  // Snap workflow-editor -> campaigns if user loses workflow access (e.g. after switching account).
  useEffect(() => {
    if (!canOpenWorkflowEditor && activePage === 'workflow-editor') {
      setActivePage('campaigns')
    }
  }, [canOpenWorkflowEditor, activePage])

  useEffect(() => {
    if (!window.electronAPI?.getAppVersion) return
    let cancelled = false
    window.electronAPI.getAppVersion()
      .then(version => {
        if (!cancelled) setLocalVersion(version)
      })
      .catch(err => console.warn('Get app version failed:', err))
    return () => {
      cancelled = true
    }
  }, [])

  const handleCheckForUpdate = useCallback(async (
    manual = true,
    source: UpdatePromptSource = manual ? 'manual' : 'startup'
  ): Promise<boolean> => {
    if (!window.electronAPI?.checkForUpdate) {
      if (manual) useUiStore.getState().showAlert('Chức năng cập nhật chưa sẵn sàng.', 'error')
      return false
    }

    setCheckingUpdate(true)
    try {
      const res = await window.electronAPI.checkForUpdate()
      setLocalVersion(res.localVersion)
      if (res.hasUpdate) {
        setUpdateInfo({ localVersion: res.localVersion, remoteVersion: res.remoteVersion, source })
        return true
      } else if (manual) {
        if (res.error) {
          useUiStore.getState().showAlert(`Không kiểm tra được cập nhật: ${res.error}`, 'error')
        } else {
          useUiStore.getState().showAlert(`Bạn đang dùng phiên bản mới nhất (${res.localVersion}).`, 'success')
        }
      } else if (res.error) {
        console.warn('Update check error:', res.error)
      }
      return false
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (manual) {
        useUiStore.getState().showAlert(`Không kiểm tra được cập nhật: ${message}`, 'error')
      } else {
        console.warn('Update check failed:', err)
      }
      return false
    } finally {
      setCheckingUpdate(false)
    }
  }, [])

  // Check startup updates before auth bootstrap so auto-login cannot start scheduler first.
  useEffect(() => {
    if (startupUpdateCheckStarted.current) return
    startupUpdateCheckStarted.current = true

    void (async () => {
      const hasUpdate = await handleCheckForUpdate(false, 'startup')
      if (!hasUpdate) startAuthBootstrap()
    })()
  }, [handleCheckForUpdate, startAuthBootstrap])

  const handleCloseUpdateModal = useCallback(() => {
    const source = updateInfo?.source
    setUpdateInfo(null)
    if (source === 'startup') {
      startAuthBootstrap()
    }
  }, [startAuthBootstrap, updateInfo?.source])

  const openGeneralSettings = (menu: GeneralSettingsMenu = 'akabiz') => {
    setGeneralSettingsInitialMenu(menu)
    setShowGeneralSettings(true)
  }

  const openProxyManager = () => {
    void loadAccounts()
    void loadProxies()
    setShowProxyManager(true)
  }

  const requestOpenBrowser = useCallback((request: { accountId: number; reloadAfterOpen?: boolean }) => {
    browserOpenRequestSeq.current += 1
    setBrowserOpenRequest({
      requestId: browserOpenRequestSeq.current,
      accountId: request.accountId,
      reloadAfterOpen: request.reloadAfterOpen === true
    })
    setActivePage('browsers')
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

  useEffect(() => {
    document.body.classList.add(platformClass)
    return () => {
      document.body.classList.remove(platformClass)
    }
  }, [platformClass])

  if (initializing) {
    return (
      <div className={`app-layout ${platformClass}`} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="app-window-drag-frame" aria-hidden="true" />
        <div style={{ color: 'var(--text-secondary, #aaa)', fontSize: 13 }}>
          {checkingUpdate ? 'Đang kiểm tra cập nhật…' : 'Đang khởi tạo…'}
        </div>
        <AlertModal />
        <ConfirmModal />
        {updateInfo && (
          <UpdateModal
            localVersion={updateInfo.localVersion}
            remoteVersion={updateInfo.remoteVersion}
            onClose={handleCloseUpdateModal}
          />
        )}
      </div>
    )
  }

  if (!user) {
    return (
      <div className={`app-layout ${platformClass}`}>
        <div className="app-window-drag-frame" aria-hidden="true" />
        <LoginPage />
        <AlertModal />
        <ConfirmModal />
        {updateInfo && (
          <UpdateModal
            localVersion={updateInfo.localVersion}
            remoteVersion={updateInfo.remoteVersion}
            onClose={handleCloseUpdateModal}
          />
        )}
      </div>
    )
  }

  return (
    <div className={`app-layout app-layout-authenticated ${platformClass}`}>
      <div className="app-window-drag-frame" aria-hidden="true" />
      <AppUtilityTopbar
        currentVersion={localVersion}
        checkingUpdate={checkingUpdate}
        onCheckUpdate={() => { void handleCheckForUpdate(true) }}
      />
      <div className="app-content-shell">
        <TopBar
          activePage={activePage}
          onPageChange={setActivePage}
          onOpenDataScan={() => setShowDataScan(true)}
          onOpenMediaLibrary={() => setShowMediaLibrary(true)}
          onOpenProxyManager={openProxyManager}
          onOpenContentTemplates={() => setShowContentTemplates(true)}
          onOpenDataGroups={() => setShowDataGroups(true)}
          onOpenAccountInfo={() => setShowAccountProfile(true)}
          onOpenGeneralSettings={() => openGeneralSettings()}
          onOpenChangePassword={() => setShowChangePassword(true)}
          currentVersion={localVersion}
          checkingUpdate={checkingUpdate}
          onCheckUpdate={() => { void handleCheckForUpdate(true) }}
        />

        <div className="app-main">
          <div style={{ display: activePage === 'campaigns' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <CampaignPage
              isActive={activePage === 'campaigns'}
              onNavigateToBrowser={requestOpenBrowser}
              onOpenGeneralSettings={openGeneralSettings}
              onOpenContentTemplates={() => setShowContentTemplates(true)}
            />
          </div>

          <div style={activePage === 'browsers'
            ? { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }
            : { visibility: 'hidden', position: 'absolute', width: '100%', height: '100%', top: 0, left: 0, pointerEvents: 'none' }
          }>
            <BrowserPage
              openRequest={browserOpenRequest}
              onRequestHandled={(requestId) => {
                setBrowserOpenRequest(prev => prev?.requestId === requestId ? null : prev)
              }}
            />
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
        </div>
      </div>

      <AlertModal />
      <ConfirmModal />
      {showDataScan && (
        <DataScanModal onClose={() => setShowDataScan(false)} />
      )}
      {showMediaLibrary && (
        <MediaLibraryModal onClose={() => setShowMediaLibrary(false)} />
      )}
      {showProxyManager && (
        <ProxyManagerModal
          proxies={proxies}
          accounts={accounts}
          initialPlatform="facebook"
          onClose={() => setShowProxyManager(false)}
          onCreateProxy={createProxy}
          onUpdateProxy={updateProxy}
          onDeleteProxy={deleteProxy}
        />
      )}
      {showContentTemplates && (
        <ContentTemplateManagerModal onClose={() => setShowContentTemplates(false)} />
      )}
      {showDataGroups && (
        <DataGroupManagerModal onClose={() => setShowDataGroups(false)} />
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
      {showAccountProfile && (
        <AccountProfileModal onClose={() => setShowAccountProfile(false)} />
      )}
      {updateInfo && (
        <UpdateModal
          localVersion={updateInfo.localVersion}
          remoteVersion={updateInfo.remoteVersion}
          onClose={handleCloseUpdateModal}
        />
      )}
    </div>
  )
}
