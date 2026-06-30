import { useCallback, useEffect, useRef, useState } from 'react'
import TopBar from './components/TopBar/TopBar'
import AppUtilityTopbar from './components/TopBar/AppUtilityTopbar'
import CampaignPage from './pages/CampaignPage'
import BrowserPage, { type BrowserOpenRequest, type BrowserOpenResult } from './pages/BrowserPage'
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
import GeneralSettingsModal, { type GeneralSettingsMenu } from './components/Settings/GeneralSettingsModal'
import ChangePasswordModal from './components/Settings/ChangePasswordModal'
import AccountProfileModal from './components/Settings/AccountProfileModal'
import MediaLibraryModal from './components/Media/MediaLibraryModal'

export default function App() {
  const { user, initializing, rehydrateFromStorage, handleSessionExpired, handleUserUpdated } = useAuthStore()
  const { theme } = useThemeStore()
  const { loadAccounts, loadCampaigns, loadCampaignActions, upsertCampaign } = useCampaignStore()
  const canOpenWorkflowEditor = !!user?.isAdminAkabiz
  // Default to campaigns; workflow-editor is only available for akaBiz admin staff.
  const [activePage, setActivePage] = useState<'campaigns' | 'workflow-editor' | 'browsers' | 'reports'>('campaigns')
  const [browserOpenRequest, setBrowserOpenRequest] = useState<BrowserOpenRequest | null>(null)
  const browserOpenRequestSeq = useRef(0)
  const browserOpenResolvers = useRef(new Map<number, {
    accountId: number
    resolve: (result: BrowserOpenResult) => void
  }>())
  const [showDataScan, setShowDataScan] = useState(false)
  const [showMediaLibrary, setShowMediaLibrary] = useState(false)
  const [showGeneralSettings, setShowGeneralSettings] = useState(false)
  const [generalSettingsInitialMenu, setGeneralSettingsInitialMenu] = useState<GeneralSettingsMenu>('akabiz')
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showAccountProfile, setShowAccountProfile] = useState(false)
  const [localVersion, setLocalVersion] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const runtimePlatform = window.electronAPI?.platform || 'unknown'
  const platformClass = `platform-${runtimePlatform}`

  // Bootstrap auth from DB-backed device login settings (or land on LoginPage).
  useEffect(() => {
    rehydrateFromStorage()
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

  const [updateInfo, setUpdateInfo] = useState<{ localVersion: string; remoteVersion: string } | null>(null)

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

  const handleCheckForUpdate = useCallback(async (manual = true) => {
    if (!window.electronAPI?.checkForUpdate) {
      if (manual) useUiStore.getState().showAlert('Chức năng cập nhật chưa sẵn sàng.', 'error')
      return
    }

    setCheckingUpdate(true)
    try {
      const res = await window.electronAPI.checkForUpdate()
      setLocalVersion(res.localVersion)
      if (res.hasUpdate) {
        setUpdateInfo({ localVersion: res.localVersion, remoteVersion: res.remoteVersion })
      } else if (manual) {
        if (res.error) {
          useUiStore.getState().showAlert(`Không kiểm tra được cập nhật: ${res.error}`, 'error')
        } else {
          useUiStore.getState().showAlert(`Bạn đang dùng phiên bản mới nhất (${res.localVersion}).`, 'success')
        }
      } else if (res.error) {
        console.warn('Update check error:', res.error)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (manual) {
        useUiStore.getState().showAlert(`Không kiểm tra được cập nhật: ${message}`, 'error')
      } else {
        console.warn('Update check failed:', err)
      }
    } finally {
      setCheckingUpdate(false)
    }
  }, [])

  const openGeneralSettings = (menu: GeneralSettingsMenu = 'akabiz') => {
    setGeneralSettingsInitialMenu(menu)
    setShowGeneralSettings(true)
  }

  const requestOpenBrowser = useCallback((request: { accountId: number; reloadAfterOpen?: boolean }) => {
    browserOpenResolvers.current.forEach((pending, requestId) => {
      pending.resolve({
        requestId,
        accountId: pending.accountId,
        success: false,
        reason: 'Yêu cầu hiển thị đã được thay thế'
      })
    })
    browserOpenResolvers.current.clear()

    browserOpenRequestSeq.current += 1
    const requestId = browserOpenRequestSeq.current
    setBrowserOpenRequest({
      requestId,
      accountId: request.accountId,
      requestedAt: Date.now(),
      reloadAfterOpen: request.reloadAfterOpen === true
    })
    setActivePage('browsers')
    return new Promise<BrowserOpenResult>(resolve => {
      browserOpenResolvers.current.set(requestId, {
        accountId: request.accountId,
        resolve
      })
    })
  }, [])

  // Auto-check for updates once on app start (non-blocking).
  useEffect(() => {
    const timer = setTimeout(async () => {
      await handleCheckForUpdate(false)
    }, 3000)
    return () => clearTimeout(timer)
  }, [handleCheckForUpdate])

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
      <div className={`app-layout ${platformClass}`}>
        <div className="app-window-drag-frame" aria-hidden="true" />
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
            />
          </div>

          <div style={activePage === 'browsers'
            ? { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }
            : { visibility: 'hidden', position: 'absolute', width: '100%', height: '100%', top: 0, left: 0, pointerEvents: 'none' }
          }>
            <BrowserPage
              openRequest={browserOpenRequest}
              onRequestHandled={(result) => {
                setBrowserOpenRequest(prev => prev?.requestId === result.requestId ? null : prev)
                const pending = browserOpenResolvers.current.get(result.requestId)
                if (pending) {
                  pending.resolve(result)
                  browserOpenResolvers.current.delete(result.requestId)
                }
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
          onClose={() => setUpdateInfo(null)}
        />
      )}
    </div>
  )
}
