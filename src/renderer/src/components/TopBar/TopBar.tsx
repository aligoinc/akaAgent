import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp,
  BarChart3,
  Badge,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  FolderOpen,
  Globe,
  Images,
  Info,
  KeyRound,
  Layers,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  ServerCog,
  Settings,
  SlidersHorizontal,
  Sun,
  User,
  Zap
} from 'lucide-react'
import { useThemeStore } from '../../stores/themeStore'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'

const appIconUrl = new URL('../../assets/app-icon.png', import.meta.url).href

type AppPage = 'campaigns' | 'automations' | 'workflow-editor' | 'browsers' | 'content-templates' | 'reports'

interface TopBarProps {
  activePage: AppPage
  onPageChange: (page: AppPage) => void
  onOpenDataScan: () => void
  onOpenMediaLibrary: () => void
  onOpenProxyManager: () => void
  onOpenDataGroups: () => void
  onOpenAccountInfo: () => void
  onOpenGeneralSettings: () => void
  onOpenChangePassword: () => void
  currentVersion: string
  checkingUpdate: boolean
  onCheckUpdate: () => void
}

interface SidebarNavItem {
  key: string
  label: string
  icon: ReactNode
  active?: boolean
  onClick: () => void
}

function UpdateBadgeIcon() {
  return (
    <span className="app-sidebar-update-icon" aria-hidden="true">
      <Badge size={17} />
      <ArrowUp size={9} strokeWidth={3} />
    </span>
  )
}

export default function TopBar({
  activePage,
  onPageChange,
  onOpenDataScan,
  onOpenMediaLibrary,
  onOpenProxyManager,
  onOpenDataGroups,
  onOpenAccountInfo,
  onOpenGeneralSettings,
  onOpenChangePassword,
  currentVersion,
  checkingUpdate,
  onCheckUpdate
}: TopBarProps) {
  const { theme, toggleTheme } = useThemeStore()
  const { user, logout, resetDeviceLock } = useAuthStore()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const isAdminAkabiz = !!user?.isAdminAkabiz
  const canOpenWorkflowEditor = isAdminAkabiz

  useEffect(() => {
    if (!accountMenuOpen) return

    const handleMouseDown = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [accountMenuOpen])

  const navItems = useMemo<SidebarNavItem[]>(() => {
    const items: SidebarNavItem[] = [
      {
        key: 'campaigns',
        label: 'Chiến dịch',
        icon: <Layers size={18} />,
        active: activePage === 'campaigns',
        onClick: () => onPageChange('campaigns')
      },
      {
        key: 'automations',
        label: 'Tự động hóa',
        icon: <Zap size={18} />,
        active: activePage === 'automations',
        onClick: () => onPageChange('automations')
      },
      {
        key: 'browsers',
        label: 'Trình duyệt',
        icon: <Globe size={18} />,
        active: activePage === 'browsers',
        onClick: () => onPageChange('browsers')
      },
      {
        key: 'data-scan',
        label: 'Quét data',
        icon: <Database size={18} />,
        onClick: onOpenDataScan
      },
      {
        key: 'data-groups',
        label: 'Nhóm data',
        icon: <FolderOpen size={18} />,
        onClick: onOpenDataGroups
      },
      {
        key: 'content-templates',
        label: 'Mẫu nội dung',
        icon: <FileText size={18} />,
        active: activePage === 'content-templates',
        onClick: () => onPageChange('content-templates')
      },
      {
        key: 'media',
        label: 'Media',
        icon: <Images size={18} />,
        onClick: onOpenMediaLibrary
      },
      {
        key: 'proxy',
        label: 'Proxy',
        icon: <ServerCog size={18} />,
        onClick: onOpenProxyManager
      },
      {
        key: 'reports',
        label: 'Báo cáo',
        icon: <BarChart3 size={18} />,
        active: activePage === 'reports',
        onClick: () => onPageChange('reports')
      }
    ]

    if (canOpenWorkflowEditor) {
      items.push({
        key: 'workflow-editor',
        label: 'Cài đặt Workflow',
        icon: <Settings size={18} />,
        active: activePage === 'workflow-editor',
        onClick: () => onPageChange('workflow-editor')
      })
    }

    return items
  }, [
    activePage,
    canOpenWorkflowEditor,
    onOpenDataGroups,
    onOpenDataScan,
    onOpenMediaLibrary,
    onOpenProxyManager,
    onPageChange
  ])

  const closeAccountMenu = () => setAccountMenuOpen(false)

  const handleLogout = () => {
    closeAccountMenu()
    useUiStore.getState().showConfirm(
      'Đăng xuất khỏi tài khoản?',
      async () => {
        await logout()
      },
      { title: 'Đăng xuất', confirmText: 'Đăng xuất', variant: 'primary' }
    )
  }

  const handleToggleTheme = () => {
    toggleTheme()
  }

  const handleResetDeviceLock = () => {
    closeAccountMenu()
    useUiStore.getState().showConfirm(
      'Bạn có muốn đổi máy tính không?',
      async () => {
        try {
          await resetDeviceLock()
          useUiStore.getState().showAlert('Đã reset máy tính. Bạn có thể đăng nhập tài khoản này trên máy mới.', 'success')
        } catch (err: any) {
          useUiStore.getState().showAlert(err?.message || 'Đổi máy tính thất bại', 'error')
        }
      },
      { title: 'Đổi máy tính', confirmText: 'Đổi máy tính', variant: 'primary' }
    )
  }

  const handleOpenGeneralSettings = () => {
    closeAccountMenu()
    onOpenGeneralSettings()
  }

  const handleOpenAccountInfo = () => {
    closeAccountMenu()
    onOpenAccountInfo()
  }

  const handleOpenChangePassword = () => {
    closeAccountMenu()
    onOpenChangePassword()
  }

  const handleCheckUpdate = () => {
    if (checkingUpdate) return
    onCheckUpdate()
  }

  return (
    <aside className={`app-sidebar ${sidebarExpanded ? 'is-expanded' : 'is-collapsed'}`}>
      <div className="app-sidebar-header">
        <div className="app-sidebar-brand" title="akaBizAuto">
          <span className="app-sidebar-logo">
            <img src={appIconUrl} alt="" />
          </span>
          <span className="app-sidebar-label app-sidebar-brand-name">akaBizAuto</span>
        </div>
        <button
          type="button"
          className="app-sidebar-toggle"
          onClick={() => setSidebarExpanded(expanded => !expanded)}
          title={sidebarExpanded ? 'Thu gọn menu' : 'Mở rộng menu'}
          aria-label={sidebarExpanded ? 'Thu gọn menu' : 'Mở rộng menu'}
          aria-expanded={sidebarExpanded}
        >
          {sidebarExpanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      <nav className="app-sidebar-nav" aria-label="Điều hướng chính">
        {navItems.map(item => (
          <button
            key={item.key}
            type="button"
            className={`app-sidebar-nav-item ${item.active ? 'active' : ''}`}
            onClick={item.onClick}
            title={item.label}
            aria-current={item.active ? 'page' : undefined}
          >
            <span className="app-sidebar-item-icon">{item.icon}</span>
            <span className="app-sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="app-sidebar-footer" ref={accountMenuRef}>
        <button
          type="button"
          className={`app-sidebar-account-button ${accountMenuOpen ? 'active' : ''}`}
          onClick={() => setAccountMenuOpen(open => !open)}
          title={user?.name || 'Tài khoản'}
          aria-label="Mở menu tài khoản"
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
        >
          <span className="app-sidebar-user-avatar">
            <User size={18} />
          </span>
          <span className="app-sidebar-label app-sidebar-account-copy">
            <strong>{user?.name || 'Tài khoản'}</strong>
            <span>{user?.organizationName || 'akaBizAuto'}</span>
          </span>
          <ChevronRight size={15} className="app-sidebar-account-chevron" />
        </button>

        {accountMenuOpen && (
          <div className="app-sidebar-account-flyout" role="menu">
            <div className="app-sidebar-flyout-header">
              <span className="app-sidebar-flyout-avatar">
                <User size={18} />
              </span>
              <div className="app-sidebar-flyout-user">
                <strong>{user?.name || 'Tài khoản'}</strong>
                <span>{user?.organizationName || 'akaBizAuto'} · v{currentVersion || '...'}</span>
              </div>
            </div>

            <div className="app-sidebar-flyout-section">
              <button type="button" className="app-sidebar-flyout-item" onClick={handleOpenAccountInfo} role="menuitem">
                <Info size={16} />
                <span>Thông tin tài khoản</span>
              </button>
              <button
                type="button"
                className="app-sidebar-flyout-item"
                onClick={handleCheckUpdate}
                disabled={checkingUpdate}
                role="menuitem"
              >
                {checkingUpdate ? <RefreshCw size={16} className="animate-spin" /> : <UpdateBadgeIcon />}
                <span>{checkingUpdate ? 'Đang kiểm tra' : 'Cập nhật'}</span>
              </button>
              <button type="button" className="app-sidebar-flyout-item" onClick={handleOpenGeneralSettings} role="menuitem">
                <SlidersHorizontal size={16} />
                <span>Cài đặt</span>
              </button>
              <button type="button" className="app-sidebar-flyout-item" onClick={handleOpenChangePassword} role="menuitem">
                <KeyRound size={16} />
                <span>Đổi mật khẩu</span>
              </button>
              <button type="button" className="app-sidebar-flyout-item" onClick={handleResetDeviceLock} role="menuitem">
                <Monitor size={16} />
                <span>Đổi máy tính</span>
              </button>
              <button
                type="button"
                className="app-sidebar-flyout-item app-sidebar-theme-toggle-item"
                onClick={handleToggleTheme}
                role="menuitemcheckbox"
                aria-checked={theme === 'dark'}
              >
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                <span>Giao diện sáng/tối</span>
                <span className={`app-sidebar-theme-switch ${theme === 'dark' ? 'on' : ''}`}>
                  <span className="app-sidebar-theme-switch-thumb" />
                </span>
              </button>
            </div>

            <div className="app-sidebar-flyout-section">
              <button
                type="button"
                className="app-sidebar-flyout-item app-sidebar-flyout-danger"
                onClick={handleLogout}
                role="menuitem"
              >
                <LogOut size={16} />
                <span>Đăng xuất</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
