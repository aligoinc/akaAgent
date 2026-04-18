import { Zap, Layers, Settings, Play, Pause, Globe, Sun, Moon, LogOut, User } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { useThemeStore } from '../../stores/themeStore'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'

interface TopBarProps {
  activePage: 'campaigns' | 'workflow-editor' | 'browsers'
  onPageChange: (page: 'campaigns' | 'workflow-editor' | 'browsers') => void
}

export default function TopBar({ activePage, onPageChange }: TopBarProps) {
  const { schedulerRunning, setSchedulerRunning } = useCampaignStore()
  const { theme, toggleTheme } = useThemeStore()
  const { user, logout } = useAuthStore()
  const isAdminAkabiz = !!user?.isAdminAkabiz

  const handleToggleScheduler = async () => {
    if (!window.electronAPI) return
    try {
      if (schedulerRunning) {
        await window.electronAPI.stopScheduler()
        setSchedulerRunning(false)
      } else {
        await window.electronAPI.startScheduler()
        setSchedulerRunning(true)
      }
    } catch (err) {
      console.error('Scheduler toggle error:', err)
    }
  }

  const handleLogout = () => {
    useUiStore.getState().showConfirm(
      'Đăng xuất khỏi tài khoản?',
      async () => {
        if (schedulerRunning) {
          try { await window.electronAPI?.stopScheduler() } catch { /* ignore */ }
          setSchedulerRunning(false)
        }
        await logout()
      },
      { title: 'Đăng xuất', confirmText: 'Đăng xuất', variant: 'primary' }
    )
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
        {isAdminAkabiz && (
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
              color: 'var(--text-secondary, #aaa)',
              border: '1px solid var(--border-color, #27272f)',
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

        <button
          className="btn btn-ghost btn-icon"
          onClick={toggleTheme}
          title={theme === 'light' ? 'Chế độ tối' : 'Chế độ sáng'}
          style={{ marginRight: 8 }}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        <button
          className={`btn ${schedulerRunning ? 'btn-danger' : 'btn-success'}`}
          onClick={handleToggleScheduler}
          title={schedulerRunning ? 'Dừng scheduler' : 'Bắt đầu scheduler'}
          style={{ marginRight: 8 }}
        >
          {schedulerRunning ? <Pause size={14} /> : <Play size={14} />}
          {schedulerRunning ? 'Dừng' : 'Chạy'} Scheduler
          {schedulerRunning && <span className="status-dot running" style={{ marginLeft: 4 }} />}
        </button>

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
