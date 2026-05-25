import { useEffect, useRef, useState } from 'react'
import { Zap, Layers, Settings, Globe, Sun, Moon, LogOut, User, ChevronDown, Monitor, Database, SlidersHorizontal, KeyRound } from 'lucide-react'
import { useThemeStore } from '../../stores/themeStore'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'

interface TopBarProps {
  activePage: 'campaigns' | 'workflow-editor' | 'browsers'
  onPageChange: (page: 'campaigns' | 'workflow-editor' | 'browsers') => void
  onOpenDataScan: () => void
  onOpenGeneralSettings: () => void
  onOpenChangePassword: () => void
}

export default function TopBar({ activePage, onPageChange, onOpenDataScan, onOpenGeneralSettings, onOpenChangePassword }: TopBarProps) {
  const { theme, toggleTheme } = useThemeStore()
  const { user, logout, resetDeviceLock } = useAuthStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const isAdminAkabiz = !!user?.isAdminAkabiz
  const canOpenWorkflowEditor = user?.staffId === 1

  useEffect(() => {
    if (!settingsOpen) return

    const handleMouseDown = (event: MouseEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [settingsOpen])

  const handleLogout = () => {
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
    setSettingsOpen(false)
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
    setSettingsOpen(false)
    onOpenGeneralSettings()
  }

  const handleOpenChangePassword = () => {
    setSettingsOpen(false)
    onOpenChangePassword()
  }

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo">
          <Zap size={16} color="white" />
        </div>
        <span className="topbar-brand">akaBizAuto</span>
      </div>

      <nav className="topbar-nav">
        <button
          className={`topbar-nav-item ${activePage === 'campaigns' ? 'active' : ''}`}
          onClick={() => onPageChange('campaigns')}
        >
          <Layers size={15} />
          Chiến dịch
        </button>
        <button
          className={`topbar-nav-item ${activePage === 'browsers' ? 'active' : ''}`}
          onClick={() => onPageChange('browsers')}
        >
          <Globe size={15} />
          Trình duyệt
        </button>
        <button
          className="topbar-nav-item"
          onClick={onOpenDataScan}
        >
          <Database size={15} />
          Quét data
        </button>
        {canOpenWorkflowEditor && (
          <button
            className={`topbar-nav-item ${activePage === 'workflow-editor' ? 'active' : ''}`}
            onClick={() => onPageChange('workflow-editor')}
          >
            <Settings size={15} />
            Cài đặt Workflow
          </button>
        )}
      </nav>

      <div className="topbar-right">
        {user && (
          <div
            title={`${user.organizationName}${isAdminAkabiz ? ' · admin akaBiz' : ''}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px',
              fontSize: 12,
              color: 'var(--text-topbar-muted, var(--text-secondary, #aaa))',
              border: '1px solid var(--border-topbar, var(--border-default, #27272f))',
              borderRadius: 6,
              marginRight: 8
            }}
          >
            <User size={13} />
            <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.name}
            </span>
          </div>
        )}

        <div className="topbar-settings-menu-wrap" ref={settingsRef}>
          <button
            className={`btn btn-ghost topbar-settings-button ${settingsOpen ? 'active' : ''}`}
            onClick={() => setSettingsOpen(open => !open)}
            title="Cài đặt"
            aria-haspopup="menu"
            aria-expanded={settingsOpen}
          >
            <Settings size={15} />
            <ChevronDown size={12} />
          </button>
          {settingsOpen && (
            <div className="topbar-settings-menu" role="menu">
              <button className="topbar-settings-item" role="menuitem" onClick={handleOpenGeneralSettings}>
                <SlidersHorizontal size={14} />
                <span>Cài đặt chung</span>
              </button>
              <button className="topbar-settings-item" role="menuitem" onClick={handleOpenChangePassword}>
                <KeyRound size={14} />
                <span>Đổi mật khẩu</span>
              </button>
              <button className="topbar-settings-item" role="menuitem" onClick={handleResetDeviceLock}>
                <Monitor size={14} />
                <span>Đổi máy tính</span>
              </button>
              <button
                className="topbar-settings-item topbar-theme-toggle-item"
                role="menuitemcheckbox"
                aria-checked={theme === 'dark'}
                onClick={handleToggleTheme}
              >
                {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
                <span>Giao diện sáng/tối</span>
                <span className={`topbar-theme-switch ${theme === 'dark' ? 'on' : ''}`}>
                  <span className="topbar-theme-switch-thumb" />
                </span>
              </button>
            </div>
          )}
        </div>

        <button
          className="btn btn-ghost btn-icon"
          onClick={handleLogout}
          title="Đăng xuất"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  )
}
