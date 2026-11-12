import CampaignEditDialogs from './components/CampaignPanels/CampaignEditDialogs'
import { useDesktopUiPolling } from './hooks/useDesktopUiPolling'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import TopBar, { type AppPage } from './components/TopBar/TopBar'
import AppUtilityTopbar from './components/TopBar/AppUtilityTopbar'
import CampaignPage from './pages/CampaignPage'
import BrowserPage, { type BrowserOpenRequest } from './pages/BrowserPage'
import EffectivenessReportsHub from './components/EffectivenessReports/EffectivenessReportsHub'
import type { EffectivenessNavigation } from './components/EffectivenessReports/effectivenessApi'
import AutomationPage from './pages/AutomationPage'
import ContentTemplatePage from './pages/ContentTemplatePage'
import LoginPage from './pages/LoginPage'
import RenewalPage from './pages/RenewalPage'
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
import GeneralSettingsModal, { type GeneralSettingsMenu, type GeneralSettingsOpenOptions, type OpenGeneralSettings } from './components/Settings/GeneralSettingsModal'
import ContentTemplateManagerModal from './components/Settings/ContentTemplateManagerModal'
import ChangePasswordModal from './components/Settings/ChangePasswordModal'
import AccountProfileModal from './components/Settings/AccountProfileModal'
import MediaLibraryModal from './components/Media/MediaLibraryModal'
import ProxyManagerModal from './components/CampaignPanels/ProxyManagerModal'
import CustomerFeedbackLauncher from './components/CustomerFeedback/CustomerFeedbackLauncher'
import ZaloRuntimeRestartRequiredModal from './components/ZaloRuntimeRestartRequiredModal'
import AppNotificationBar from './components/AppNotificationBar/AppNotificationBar'
import NetworkStatusBar from './components/NetworkStatusBar/NetworkStatusBar'
import NotificationsPage, { type NotificationSelectRequest } from './pages/NotificationsPage'
import type { NotificationTarget } from './components/Notifications/notificationTargets'
import { useNotificationUnreadSync } from './stores/notificationCenterStore'
import type { ContentTemplateChannelName, DataGroupCampaignNavigationRequest } from '../../shared/types'
import { canAccessAdmin } from '../../shared/admin'
import { canManageStaff } from '../../shared/staffManagement'

const ChatPage = lazy(() => import('./pages/ChatPage'))
const CrmPage = lazy(() => import('./pages/CrmPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const StaffManagementPage = lazy(() => import('./pages/StaffManagementPage'))

interface UpdateInfo {
  localVersion: string
  remoteVersion: string
}

type UpdateCheckSource = 'startup' | 'manual' | 'periodic'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

export default function App() {
  const {
    user,
    initializing,
    zaloRuntimeRestartRequired,
    rehydrateFromStorage,
    handleSessionExpired,
    handleUserUpdated,
    handleZaloRuntimeRestartRequired,
    renewal,
    handleRenewalRequired
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
  const canOpenAdmin = canAccessAdmin(user)
  const canOpenStaffManagement = canManageStaff(user)
  // Default to campaigns; workflow-editor is only available for akaBiz admin staff.
  const [activePage, setActivePage] = useState<AppPage>('campaigns')
  const [chatOpenedSessionId, setChatOpenedSessionId] = useState<string | null>(null)
  const [crmOpenedStaffKey, setCrmOpenedStaffKey] = useState<string | null>(null)
  const chatSessionId = user?.chatWebEnabledAtLogin ? user.chatWebSessionId : undefined
  const crmStaffKey = user?.organizationId === 1 ? `${user.organizationId}:${user.staffId}` : undefined
  const handlePageChange = useCallback((page: AppPage) => {
    if (page === 'admin' && !canOpenAdmin) return
    if (page === 'staff-management' && !canOpenStaffManagement) return
    if (page === 'chat') {
      if (!chatSessionId) return
      setChatOpenedSessionId(chatSessionId)
    }
    if (page === 'crm') {
      if (!crmStaffKey) return
      setCrmOpenedStaffKey(crmStaffKey)
    }
    setActivePage(page)
  }, [chatSessionId, crmStaffKey, canOpenAdmin, canOpenStaffManagement])

  useEffect(() => {
    if (!canOpenStaffManagement) setActivePage(previous => previous === 'staff-management' ? 'campaigns' : previous)
  }, [canOpenStaffManagement])

  useEffect(() => {
    if (!canOpenAdmin) setActivePage(previous => previous === 'admin' ? 'campaigns' : previous)
  }, [canOpenAdmin])

  useEffect(() => {
    setChatOpenedSessionId(null)
    setActivePage(previous => previous === 'chat' ? 'campaigns' : previous)
  }, [chatSessionId])
  useEffect(() => {
    setCrmOpenedStaffKey(null)
    setActivePage(previous => previous === 'crm' ? 'campaigns' : previous)
  }, [crmStaffKey])
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
  const [dataGroupInitialId, setDataGroupInitialId] = useState<number | null>(null)
  const [accountOpenRequest, setAccountOpenRequest] = useState<{ accountId: number; requestId: number } | null>(null)
  const accountOpenRequestSeq = useRef(0)
  const [notificationSelectRequest, setNotificationSelectRequest] = useState<NotificationSelectRequest | null>(null)
  const notificationSelectRequestSeq = useRef(0)
  const [generalSettingsRequest, setGeneralSettingsRequest] = useState<(GeneralSettingsOpenOptions & { menu: GeneralSettingsMenu; returnFocusTo: HTMLElement | null }) | null>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showAccountProfile, setShowAccountProfile] = useState(false)
  const [localVersion, setLocalVersion] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const authBootstrapStarted = useRef(false)
  const startupUpdateCheckStarted = useRef(false)
  const runtimePlatform = window.electronAPI?.platform || 'unknown'
  const platformClass = `platform-${runtimePlatform}`
  const hasZaloServerAccounts = accounts.some(account => account.isZaloServer)
  useDesktopUiPolling(user ? `${user.organizationId}:${user.staffId}` : null, activePage === 'campaigns', hasZaloServerAccounts)
  useNotificationUnreadSync(user ? `${user.organizationId}:${user.staffId}` : null, activePage)

  const openNotifications = useCallback((notificationId?: number) => {
    if (notificationId) setNotificationSelectRequest({ notificationId, requestId: ++notificationSelectRequestSeq.current })
    setActivePage('notifications')
  }, [])

  // Nút "Mở nhanh" trong trang Thông báo: chiến dịch/tài khoản mở ở trang Chiến dịch, nhóm data mở hộp Nhóm data.
  const openNotificationTarget = useCallback((target: NotificationTarget) => {
    if (target.kind === 'campaign') {
      setActivePage('campaigns')
      setDataGroupCampaignRequest({ requestId: ++dataGroupCampaignRequestSeq.current, mode: 'open', campaignId: target.id })
      return
    }
    if (target.kind === 'account') {
      setActivePage('campaigns')
      setAccountOpenRequest({ accountId: target.id, requestId: ++accountOpenRequestSeq.current })
      return
    }
    setDataGroupInitialId(target.id)
    setShowDataGroups(true)
  }, [])

  // Nút trong Báo cáo hiệu quả: mở chiến dịch, Quét data (kiểm tra SĐT), Nhóm data hoặc Mẫu nội dung.
  const navigateFromReport = useCallback((target: EffectivenessNavigation) => {
    if (target.kind === 'campaign') {
      setActivePage('campaigns')
      setDataGroupCampaignRequest({ requestId: ++dataGroupCampaignRequestSeq.current, mode: 'open', campaignId: target.campaignId })
      return
    }
    if (target.kind === 'dataScan') { setShowDataScan(true); return }
    if (target.kind === 'dataGroups') {
      setDataGroupInitialId(null)
      setShowDataGroups(true)
      return
    }
    setActivePage(target.kind === 'contentTemplates' ? 'content-templates' : 'campaigns')
  }, [])

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
    if (!window.electronAPI?.onRenewalRequired) return
    return window.electronAPI.onRenewalRequired(handleRenewalRequired)
  }, [handleRenewalRequired])

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
      const res = await window.electronAPI.checkForUpdate(source === 'startup')
      setLocalVersion(res.localVersion)
      if (res.hasUpdate) {
        setAvailableUpdate({ localVersion: res.localVersion, remoteVersion: res.remoteVersion })
        const requiresStartupPrompt = source === 'startup'
          && res.promptOnStartup === true
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

  // The public system setting controls the startup prompt before auth bootstrap.
  useEffect(() => {
    if (startupUpdateCheckStarted.current) return
    startupUpdateCheckStarted.current = true

    void (async () => {
      const openedUpdatePrompt = await handleCheckForUpdate('startup')
      if (!openedUpdatePrompt) startAuthBootstrap()
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

  const openGeneralSettings: OpenGeneralSettings = (menu = 'akabiz', options = {}) => {
    setGeneralSettingsRequest({ ...options, menu, returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null })
  }

  const closeGeneralSettings = () => {
    setGeneralSettingsRequest(null)
    generalSettingsRequest?.onClose?.()
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
        <NetworkStatusBar />
        <div style={{ color: 'var(--text-secondary, #aaa)', fontSize: 13 }}>
          {checkingUpdate ? 'Đang kiểm tra cập nhật…' : 'Đang khởi tạo…'}
        </div>
        <AlertModal />
        <ConfirmModal />
        <CampaignEditDialogs />
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
        <NetworkStatusBar />
        {renewal ? <RenewalPage /> : <LoginPage />}
        <AlertModal />
        <ConfirmModal />
        <CampaignEditDialogs />
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

  if (user.appAccess?.separateAccess && !user.appAccess.staff.akaAgentAllowed) {
    return <div className="app-loading" role="status"><p>Quyền dùng akaAgent đã bị thu hồi. Đang dừng và lưu kết quả tác vụ…</p></div>
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
      <AppNotificationBar key={`${user.organizationId}:${user.staffId}`} />
      <NetworkStatusBar />
      <div className="app-content-shell">
        <TopBar
          activePage={activePage}
          onPageChange={handlePageChange}
          onOpenDataScan={() => setShowDataScan(true)}
          onOpenMediaLibrary={() => setShowMediaLibrary(true)}
          onOpenProxyManager={openProxyManager}
          onOpenDataGroups={() => {
            setDataGroupInitialId(null)
            setShowDataGroups(true)
          }}
          onOpenAccountInfo={() => setShowAccountProfile(true)}
          onOpenGeneralSettings={() => openGeneralSettings()}
          onOpenChangePassword={() => setShowChangePassword(true)}
          onOpenNotifications={openNotifications}
          currentVersion={localVersion}
          availableUpdateVersion={availableUpdate?.remoteVersion}
          checkingUpdate={checkingUpdate}
          onCheckUpdate={handleUpdateButtonClick}
        />

        <div className="app-main">
          {activePage === 'staff-management' && canOpenStaffManagement && (
            <Suspense fallback={<div className="empty-state" role="status">Đang mở Quản lý nhân viên…</div>}>
              <StaffManagementPage key={`${user.organizationId}:${user.staffId}`} />
            </Suspense>
          )}
          {activePage === 'admin' && canOpenAdmin && (
            <Suspense fallback={<div className="empty-state" role="status">Đang mở Admin akaBiz…</div>}>
              <AdminPage key={`${user.organizationId}:${user.staffId}`} />
            </Suspense>
          )}
          {crmStaffKey && crmOpenedStaffKey === crmStaffKey && (
            <div style={{ display: activePage === 'crm' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <Suspense fallback={<div className="empty-state" role="status">Đang mở CRM…</div>}>
                <CrmPage key={crmStaffKey} isActive={activePage === 'crm'} />
              </Suspense>
            </div>
          )}
          {chatSessionId && chatOpenedSessionId === chatSessionId && (
            <div style={{ display: activePage === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <Suspense fallback={<div className="empty-state" role="status">Đang mở Chat…</div>}>
                <ChatPage key={chatSessionId} sessionId={chatSessionId} isActive={activePage === 'chat'} />
              </Suspense>
            </div>
          )}
          {activePage === 'notifications' && (
            <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <NotificationsPage
                key={`${user.organizationId}:${user.staffId}`}
                selectRequest={notificationSelectRequest}
                onOpenTarget={openNotificationTarget}
              />
            </div>
          )}
          <div style={{ display: activePage === 'campaigns' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <CampaignPage
              isActive={activePage === 'campaigns'}
              accountOpenRequest={accountOpenRequest}
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
            <EffectivenessReportsHub isActive={activePage === 'reports'} onNavigate={navigateFromReport} />
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
      <CampaignEditDialogs />
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
          initialGroupId={dataGroupInitialId}
          onClose={() => {
            setShowDataGroups(false)
            setDataGroupInitialId(null)
          }}
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
      {generalSettingsRequest && (
        <GeneralSettingsModal
          initialMenu={generalSettingsRequest.menu}
          initialAccountId={generalSettingsRequest.initialAccountId}
          returnFocusTo={generalSettingsRequest.returnFocusTo}
          onClose={closeGeneralSettings}
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
