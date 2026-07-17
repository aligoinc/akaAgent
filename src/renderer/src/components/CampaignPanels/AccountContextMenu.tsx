import { useEffect, useRef, useCallback } from 'react'
import {
  Globe, RefreshCw, Shield, Play, Pause,
  Unlock, Ban, Edit3, Trash2, ListFilter,
  Info, FolderCog, QrCode, LogOut, Smartphone
} from 'lucide-react'
import { AutoAccount } from '../../../../shared/types'
import { isZaloWebAccount } from '../../utils/accountLabels'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  zalo: 'https://chat.zalo.me',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com',
}
const BROWSERLESS_PLATFORMS = new Set(['zalo', 'email', 'sms'])

interface AccountContextMenuProps {
  account: AutoAccount
  position: { x: number; y: number }
  onClose: () => void
  onViewBrowser: (accountId: number) => void
  onReloadPage: (account: AutoAccount) => void
  onCheckLogin: (account: AutoAccount) => void
  onZaloLogin: (account: AutoAccount) => void
  onCheckZaloSession: (account: AutoAccount) => void
  onLogoutZalo: (account: AutoAccount) => void
  onResetSmsMobileDevice: (account: AutoAccount) => void
  onResume: (account: AutoAccount) => void
  onPause: (account: AutoAccount) => void
  onEnable: (account: AutoAccount) => void
  onDisable: (account: AutoAccount) => void
  onViewInfo: (account: AutoAccount) => void
  onEdit: (account: AutoAccount) => void
  onChangeGroup: (account: AutoAccount) => void
  onDelete: (account: AutoAccount) => void
  onFilterCampaigns: (accountId: number) => void
}

export default function AccountContextMenu({
  account,
  position,
  onClose,
  onViewBrowser,
  onReloadPage,
  onCheckLogin,
  onZaloLogin,
  onCheckZaloSession,
  onLogoutZalo,
  onResetSmsMobileDevice,
  onResume,
  onPause,
  onEnable,
  onDisable,
  onViewInfo,
  onEdit,
  onChangeGroup,
  onDelete,
  onFilterCampaigns
}: AccountContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  // Adjust position to avoid overflow
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (rect.right > vw) {
      menuRef.current.style.left = `${position.x - rect.width}px`
    }
    if (rect.bottom > vh) {
      menuRef.current.style.top = `${position.y - rect.height}px`
    }
  }, [position])

  const handleAction = useCallback((action: () => void) => {
    action()
    onClose()
  }, [onClose])

  const isPaused = account.status === 'tạm dừng'
  const isDisabled = !account.isActive
  const isZalo = account.flatformType === 'zalo'
  const isZaloShowWeb = isZaloWebAccount(account)
  const isSmsAccount = account.flatformType === 'sms'
  const isBrowserless = BROWSERLESS_PLATFORMS.has(account.flatformType)
    && !(account.flatformType === 'zalo' && isZaloShowWeb)

  return (
    <div
      ref={menuRef}
      className="context-menu animate-fadeIn"
      style={{ left: position.x, top: position.y }}
    >
      <div className="context-menu-group">
        <button
          className="context-menu-item"
          onClick={() => handleAction(() => onViewInfo(account))}
        >
          <Info size={14} />
          <span>Thông tin tài khoản</span>
        </button>
      </div>

      {/* Browser Group */}
      <div className="context-menu-group">
        {!isDisabled && !isBrowserless && (
          <>
            <button
              className="context-menu-item"
              onClick={() => handleAction(() => onViewBrowser(account.id))}
            >
              <Globe size={14} />
              <span>Hiển thị & xem trang web</span>
            </button>
            <button
              className="context-menu-item"
              onClick={() => handleAction(() => onReloadPage(account))}
            >
              <RefreshCw size={14} />
              <span>Load lại trang web</span>
            </button>
          </>
        )}
        {!isDisabled && account.flatformType === 'facebook' && (
          <button
            className="context-menu-item"
            onClick={() => handleAction(() => onCheckLogin(account))}
          >
            <Shield size={14} />
            <span>Kiểm tra đăng nhập</span>
          </button>
        )}
        {!isDisabled && isZalo && (
          <>
            <button
              className="context-menu-item"
              onClick={() => handleAction(() => onZaloLogin(account))}
            >
              {isZaloShowWeb ? <Globe size={14} /> : <QrCode size={14} />}
              <span>{isZaloShowWeb ? 'Mở Zalo Web để đăng nhập' : (account.hasZaloSession ? 'Đăng nhập lại Zalo' : 'Đăng nhập Zalo QR')}</span>
            </button>
            <button
              className="context-menu-item"
              onClick={() => handleAction(() => onCheckZaloSession(account))}
            >
              <Shield size={14} />
              <span>Kiểm tra đăng nhập Zalo</span>
            </button>
            {(isZaloShowWeb ? account.loginStatus === 'đã đăng nhập' : account.hasZaloSession) && (
              <button
                className="context-menu-item accent-warning"
                onClick={() => handleAction(() => onLogoutZalo(account))}
              >
                <LogOut size={14} />
                <span>Đăng xuất Zalo</span>
              </button>
            )}
          </>
        )}
      </div>

      {isSmsAccount && (
        <div className="context-menu-group">
          <button
            className="context-menu-item"
            onClick={() => handleAction(() => onResetSmsMobileDevice(account))}
          >
            <Smartphone size={14} />
            <span>Đổi điện thoại</span>
          </button>
        </div>
      )}

      {/* Status Group */}
      {!isDisabled && !isSmsAccount && (
        <div className="context-menu-group">
          {isPaused ? (
            <button
              className="context-menu-item accent-success"
              onClick={() => handleAction(() => onResume(account))}
            >
              <Play size={14} />
              <span>TIẾP TỤC hoạt động</span>
            </button>
          ) : (
            <button
              className="context-menu-item accent-warning"
              onClick={() => handleAction(() => onPause(account))}
            >
              <Pause size={14} />
              <span>TẠM DỪNG hoạt động</span>
            </button>
          )}
        </div>
      )}

      {/* Enable/Disable Group */}
      <div className="context-menu-group">
        {isDisabled ? (
          <button
            className="context-menu-item accent-success"
            onClick={() => handleAction(() => onEnable(account))}
          >
            <Unlock size={14} />
            <span>MỞ lại tài khoản</span>
          </button>
        ) : (
          <button
            className="context-menu-item accent-error"
            onClick={() => handleAction(() => onDisable(account))}
          >
            <Ban size={14} />
            <span>VÔ HIỆU HOÁ tài khoản</span>
          </button>
        )}
      </div>

      {/* Edit/Delete Group */}
      <div className="context-menu-group">
        <button
          className="context-menu-item"
          onClick={() => handleAction(() => onEdit(account))}
        >
          <Edit3 size={14} />
          <span>Sửa tài khoản</span>
        </button>
        <button
          className="context-menu-item"
          onClick={() => handleAction(() => onChangeGroup(account))}
        >
          <FolderCog size={14} />
          <span>{account.accountGroupId ? 'Đổi nhóm tài khoản' : 'Thêm vào nhóm'}</span>
        </button>
        <button
          className="context-menu-item accent-error"
          onClick={() => handleAction(() => onDelete(account))}
        >
          <Trash2 size={14} />
          <span>Xoá tài khoản</span>
        </button>
      </div>

      {/* Campaign Group */}
      <div className="context-menu-group">
        <button
          className="context-menu-item"
          onClick={() => handleAction(() => onFilterCampaigns(account.id))}
        >
          <ListFilter size={14} />
          <span>Hiển thị chiến dịch</span>
        </button>
      </div>
    </div>
  )
}
