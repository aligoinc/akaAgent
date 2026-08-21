import { useCallback, useEffect, useRef, useState } from 'react'
import TopBar from './components/TopBar/TopBar'
import AppUtilityTopbar from './components/TopBar/AppUtilityTopbar'
import CampaignPage from './pages/CampaignPage'
import BrowserPage, { type BrowserOpenRequest } from './pages/BrowserPage'
import ReportPage from './pages/ReportPage'
import AutomationPage from './pages/AutomationPage'
import ContentTemplatePage from './pages/ContentTemplatePage'
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
import CustomerFeedbackLauncher from './components/CustomerFeedback/CustomerFeedbackLauncher'
import ZaloRuntimeRestartRequiredModal from './components/ZaloRuntimeRestartRequiredModal'
import AppNotificationBar from './components/AppNotificationBar/AppNotificationBar'
import type { ContentTemplateChannelName, DataGroupCampaignNavigationRequest } from '../../shared/types'

interface UpdateInfo {
  localVersion: string
  remoteVersion: string
}

type UpdateCheckSource = 'startup' | 'manual' | 'periodic'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const SILENT_STARTUP_UPDATE_MIN_VERSION = 6

function requiresLegacyStartupUpdatePrompt(version: string): boolean {
  const majorVersion = Number.parseInt(version.split('.')[0] || '', 10)
  return Number.isFinite(majorVersion) && majorVersion < SILENT_STARTUP_UPDATE_MIN_VERSION
}

export default function App() {
  const {
    user,
    initializing,
    zaloRuntimeRestartRequired,
    rehydrateFromStorage,
    handleSessionExpired,
    handleUserUpdated,
    handleZaloRuntimeRestartRequired
  } = useAuthStore()
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
  const [activePage, setActivePage] = useState<'campaigns' | 'automations' | 'workflow-editor' | 'browsers' | 'content-templates' | 'reports'>('campaigns')
  const [browserOpenRequest, setBrowserOpenRequest] = useState<BrowserOpenRequest | null>(null)
  const browserOpenRequestSeq = useRef(0)
  const [showDataScan, setShowDataScan] = useState(false)
  const [showMediaLibrary, setShowMediaLibrary] = useState(false)
  const [showProxyManager, setShowProxyManager] = useState(false)
  const [showContentTemplates, setShowContentTemplates] = useState(false)
  const [contentTemplateInitialChannel, setContentTemplateInitialChannel] = useState<ContentTemplateChannelName | undefined>()
  const [showDataGroups, setShowDataGroups] = useState(false)
  const [dataGroupCampaignRequest, setDataGroupCampaignRequest] = useState<DataGroupCampaignNavigationRequest | null>(null)
  const dataGroupCampaignRequestSeq = useRef(0)
  const [showGeneralSettings, setShowGeneralSettings] = useState(false)
  const [generalSettingsInitialMenu, setGeneralSettingsInitialMenu] = useState<GeneralSettingsMenu>('akabiz')
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showAccountProfile, setShowAccountProfile] = useState(false)
  const [localVersion, setLocalVersion] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const authBootstrapStarted = useRef(false)
  const startupUpdateCheckStarted = useRef(false)
  const accountRealtimeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runtimePlatform = window.electronAPI?.platform || 'unknown'
  const platformClass = `platform-${runtimePlatform}`
  const hasZaloServerAccounts = accounts.some(account => account.isZaloServer)

  useEffect(() => {
    const handleDataGroupCampaignNavigation = (event: Event) => {
      const detail = (event as CustomEvent<Pick<DataGroupCampaignNavigationRequest, 'mode' | 'campaignId' | 'group' | 'openFormIfEditable'>>).detail
      if (!detail || (detail.mode === 'open' && !detail.campaignId) || (detail.mode === 'create' && !detail.group)) return
      setActivePage('campaigns')
      setDataGroupCampaignRequest({
        ...detail,
        requestId: ++dataGroupCampaignRequestSeq.current
      })
    }
    window.addEventListener('aka-agent:data-group-campaign-navigate', handleDataGroupCampaignNavigation)
    return () => window.removeEventListener('aka-agent:data-group-campaign-navigate', handleDataGroupCampaignNavigation)
  }, [])

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
      void loadAccounts({ silent: true })
      void loadCampaigns({ silent: true })
      void loadCampaignActions()
    })
  }, [handleUserUpdated, loadAccounts, loadCampaigns, loadCampaignActions])

  useEffect(() => {
    if (!window.electronAPI?.onZaloRuntimeRestartRequired) return
    return window.electronAPI.onZaloRuntimeRestartRequired((payload) => {
      handleZaloRuntimeRestartRequired(payload)
    })
  }, [handleZaloRuntimeRestartRequired])

  const runtimeRestartModal = zaloRuntimeRestartRequired
    ? <ZaloRuntimeRestartRequiredModal payload={zaloRuntimeRestartRequired} />
    : null

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
    source: UpdateCheckSource = 'manual'
  ): Promise<boolean> => {
    const manual = source === 'manual'
    if (!window.electronAPI?.checkForUpdate) {
      if (manual) useUiStore.getState().showAlert('Chức năng cập nhật chưa sẵn sàng.', 'error')
      return false
    }

    setCheckingUpdate(true)
    try {
      const res = await window.electronAPI.checkForUpdate()
      setLocalVersion(res.localVersion)
      if (res.hasUpdate) {
        setAvailableUpdate({ localVersion: res.localVersion, remoteVersion: res.remoteVersion })
        const requiresStartupPrompt = source === 'startup'
          && requiresLegacyStartupUpdatePrompt(res.localVersion)
        if (manual || requiresStartupPrompt) setShowUpdateModal(true)
        return requiresStartupPrompt
      }

      if (!res.error) setAvailableUpdate(null)
      if (manual) {
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

  // Modern versions check silently at startup. Versions below 6.0.0 retain the
  // legacy prompt-before-auth flow so very old clients still surface upgrades.
  useEffect(() => {
    if (startupUpdateCheckStarted.current) return
    startupUpdateCheckStarted.current = true

    void (async () => {
      const openedLegacyUpdatePrompt = await handleCheckForUpdate('startup')
      if (!openedLegacyUpdatePrompt) startAuthBootstrap()
    })()
  }, [handleCheckForUpdate, startAuthBootstrap])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void handleCheckForUpdate('periodic')
    }, UPDATE_CHECK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [handleCheckForUpdate])

  const handleCloseUpdateModal = useCallback(() => {
    setShowUpdateModal(false)
    startAuthBootstrap()
  }, [startAuthBootstrap])

  const handleUpdateButtonClick = useCallback(() => {
    if (availableUpdate) {
      setShowUpdateModal(true)
      return
    }
    void handleCheckForUpdate('manual')
  }, [availableUpdate, handleCheckForUpdate])

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
      if (accountRealtimeRefreshTimer.current) clearTimeout(accountRealtimeRefreshTimer.current)
      accountRealtimeRefreshTimer.current = setTimeout(() => {
        accountRealtimeRefreshTimer.current = null
        void loadAccounts({ silent: true })
      }, 300)
    })
    return () => {
      unsubscribe()
      if (accountRealtimeRefreshTimer.current) clearTimeout(accountRealtimeRefreshTimer.current)
      accountRealtimeRefreshTimer.current = null
    }
  }, [loadAccounts])

  useEffect(() => {
    if (!hasZaloServerAccounts || activePage !== 'campaigns') return

    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void loadAccounts({ silent: true })
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    refresh()
    const timer = setInterval(refresh, user?.isChatSync ? 5_000 : 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [activePage, hasZaloServerAccounts, loadAccounts, user?.isChatSync, user?.organizationId])

  // Listen for realtime campaign status updates (scheduler → renderer)
  useEffect(() => {
    if (!window.electronAPI?.onCampaignStatusUpdated) return
    const unsubscribe = window.electronAPI.onCampaignStatusUpdated((signal) => {
      upsertCampaign(signal)
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
        {runtimeRestartModal}
        {showUpdateModal && availableUpdate && (
          <UpdateModal
            localVersion={availableUpdate.localVersion}
            remoteVersion={availableUpdate.remoteVersion}
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
        {runtimeRestartModal}
        {showUpdateModal && availableUpdate && (
          <UpdateModal
            localVersion={availableUpdate.localVersion}
            remoteVersion={availableUpdate.remoteVersion}
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
        availableUpdateVersion={availableUpdate?.remoteVersion}
        checkingUpdate={checkingUpdate}
        onCheckUpdate={handleUpdateButtonClick}
      />
      <AppNotificationBar />
      <div className="app-content-shell">
        <TopBar
          activePage={activePage}
          onPageChange={setActivePage}
          onOpenDataScan={() => setShowDataScan(true)}
          onOpenMediaLibrary={() => setShowMediaLibrary(true)}
          onOpenProxyManager={openProxyManager}
          onOpenDataGroups={() => setShowDataGroups(true)}
          onOpenAccountInfo={() => setShowAccountProfile(true)}
          onOpenGeneralSettings={() => openGeneralSettings()}
          onOpenChangePassword={() => setShowChangePassword(true)}
          currentVersion={localVersion}
          availableUpdateVersion={availableUpdate?.remoteVersion}
          checkingUpdate={checkingUpdate}
          onCheckUpdate={handleUpdateButtonClick}
        />

        <div className="app-main">
          <div style={{ display: activePage === 'campaigns' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <CampaignPage
              isActive={activePage === 'campaigns'}
              dataGroupCampaignRequest={dataGroupCampaignRequest}
              onDataGroupCampaignRequestHandled={(requestId) => {
                setDataGroupCampaignRequest(previous => previous?.requestId === requestId ? null : previous)
              }}
              onNavigateToBrowser={requestOpenBrowser}
              onOpenGeneralSettings={openGeneralSettings}
              onOpenContentTemplates={(initialChannel) => {
                setContentTemplateInitialChannel(initialChannel)
                setShowContentTemplates(true)
              }}
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

          <div style={{ display: activePage === 'automations' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <AutomationPage isActive={activePage === 'automations'} />
          </div>

          <div style={{ display: activePage === 'content-templates' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <ContentTemplatePage isActive={activePage === 'content-templates'} />
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
      {runtimeRestartModal}
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
        <ContentTemplateManagerModal
          initialChannel={contentTemplateInitialChannel}
          onClose={() => {
            setShowContentTemplates(false)
            setContentTemplateInitialChannel(undefined)
          }}
        />
      )}
      {showDataGroups && (
        <DataGroupManagerModal
          onClose={() => setShowDataGroups(false)}
          onOpenCampaign={(campaignId, options) => {
            setDataGroupCampaignRequest({
              requestId: ++dataGroupCampaignRequestSeq.current,
              mode: 'open',
              campaignId,
              openFormIfEditable: options?.openFormIfEditable
            })
          }}
          onCreateCampaignFromGroup={(group) => {
            setDataGroupCampaignRequest({
              requestId: ++dataGroupCampaignRequestSeq.current,
              mode: 'create',
              group
            })
          }}
        />
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
      {showUpdateModal && availableUpdate && (
        <UpdateModal
          localVersion={availableUpdate.localVersion}
          remoteVersion={availableUpdate.remoteVersion}
          onClose={handleCloseUpdateModal}
        />
      )}
      <CustomerFeedbackLauncher />
    </div>
  )
}
