import { ArrowUp, Badge, LogOut, RefreshCw } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'

interface AppUtilityTopbarProps {
  currentVersion: string
  availableUpdateVersion?: string
  checkingUpdate: boolean
  onCheckUpdate: () => void
}

function UpdateBadgeIcon() {
  return (
    <span className="app-utility-update-icon" aria-hidden="true">
      <Badge size={16} />
      <ArrowUp size={8} strokeWidth={3} />
    </span>
  )
}

export default function AppUtilityTopbar({
  currentVersion,
  availableUpdateVersion,
  checkingUpdate,
  onCheckUpdate
}: AppUtilityTopbarProps) {
  const { logout } = useAuthStore()
  const updateButtonLabel = checkingUpdate
    ? 'Đang kiểm tra'
    : availableUpdateVersion
      ? `Có phiên bản mới ${availableUpdateVersion}`
      : 'Cập nhật'

  const handleCheckUpdate = () => {
    if (checkingUpdate) return
    onCheckUpdate()
  }

  const handleLogout = () => {
    useUiStore.getState().showConfirm(
      'Đăng xuất khỏi tài khoản?',
      async () => {
        await logout()
      },
      { title: 'Đăng xuất', confirmText: 'Đăng xuất', variant: 'primary' }
    )
  }

  return (
    <header className="app-utility-topbar" aria-label="Thanh công cụ ứng dụng">
      <div className="app-utility-title" title="akaBiz">akaBiz</div>
      <div className="app-utility-actions">
        <span className="app-utility-version">v{currentVersion || '...'}</span>
        <button
          type="button"
          className={`app-utility-button ${availableUpdateVersion ? 'has-update' : ''}`}
          onClick={handleCheckUpdate}
          disabled={checkingUpdate}
          title={checkingUpdate
            ? 'Đang kiểm tra cập nhật'
            : availableUpdateVersion
              ? `Có phiên bản mới ${availableUpdateVersion}`
              : 'Kiểm tra cập nhật'}
        >
          {checkingUpdate ? <RefreshCw size={16} className="animate-spin" /> : <UpdateBadgeIcon />}
          <span>{updateButtonLabel}</span>
          {availableUpdateVersion && !checkingUpdate
            ? <span className="app-update-available-dot" aria-hidden="true" />
            : null}
        </button>
        <button
          type="button"
          className="app-utility-button app-utility-logout"
          onClick={handleLogout}
          title="Đăng xuất"
        >
          <LogOut size={16} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </header>
  )
}
