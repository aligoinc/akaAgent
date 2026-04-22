import { useEffect, useRef, useCallback, useState } from 'react'
import {
  Globe, RefreshCw, Shield, Play, Pause,
  Unlock, Ban, Edit3, Trash2, ListFilter,
  Database, Users, FolderOpen, ChevronRight
} from 'lucide-react'
import { OrgChannel } from '../../../../shared/types'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  zalo: 'https://chat.zalo.me',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com',
}

interface ChannelContextMenuProps {
  channel: OrgChannel
  position: { x: number; y: number }
  onClose: () => void
  onViewBrowser: (channelId: number) => void
  onReloadPage: (channel: OrgChannel) => void
  onCheckLogin: (channel: OrgChannel) => void
  onResume: (channel: OrgChannel) => void
  onPause: (channel: OrgChannel) => void
  onEnable: (channel: OrgChannel) => void
  onDisable: (channel: OrgChannel) => void
  onEdit: (channel: OrgChannel) => void
  onDelete: (channel: OrgChannel) => void
  onFilterCampaigns: (channelId: number) => void
  onLoadFriends: (channel: OrgChannel) => void
  onLoadGroups: (channel: OrgChannel) => void
}

export default function ChannelContextMenu({
  channel,
  position,
  onClose,
  onViewBrowser,
  onReloadPage,
  onCheckLogin,
  onResume,
  onPause,
  onEnable,
  onDisable,
  onEdit,
  onDelete,
  onFilterCampaigns,
  onLoadFriends,
  onLoadGroups
}: ChannelContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [showLoadData, setShowLoadData] = useState(false)

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

  const isPaused = channel.status === 'tạm dừng'
  const isDisabled = !channel.isActive

  return (
    <div
      ref={menuRef}
      className="context-menu animate-fadeIn"
      style={{ left: position.x, top: position.y }}
    >
      {/* Browser Group */}
      <div className="context-menu-group">
        {!isDisabled && (
          <>
            <button
              className="context-menu-item"
              onClick={() => handleAction(() => onViewBrowser(channel.id))}
            >
              <Globe size={14} />
              <span>Hiển thị & xem trang web</span>
            </button>
            <button
              className="context-menu-item"
              onClick={() => handleAction(() => onReloadPage(channel))}
            >
              <RefreshCw size={14} />
              <span>Load lại trang web</span>
            </button>
          </>
        )}
        {!isDisabled && channel.flatformType === 'facebook' && (
          <button
            className="context-menu-item"
            onClick={() => handleAction(() => onCheckLogin(channel))}
          >
            <Shield size={14} />
            <span>Kiểm tra đăng nhập</span>
          </button>
        )}
      </div>

      {/* Status Group */}
      {!isDisabled && (
        <div className="context-menu-group">
          {isPaused ? (
            <button
              className="context-menu-item accent-success"
              onClick={() => handleAction(() => onResume(channel))}
            >
              <Play size={14} />
              <span>TIẾP TỤC hoạt động</span>
            </button>
          ) : (
            <button
              className="context-menu-item accent-warning"
              onClick={() => handleAction(() => onPause(channel))}
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
            onClick={() => handleAction(() => onEnable(channel))}
          >
            <Unlock size={14} />
            <span>MỞ lại tài khoản</span>
          </button>
        ) : (
          <button
            className="context-menu-item accent-error"
            onClick={() => handleAction(() => onDisable(channel))}
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
          onClick={() => handleAction(() => onEdit(channel))}
        >
          <Edit3 size={14} />
          <span>Sửa tài khoản</span>
        </button>
        <button
          className="context-menu-item accent-error"
          onClick={() => handleAction(() => onDelete(channel))}
        >
          <Trash2 size={14} />
          <span>Xoá tài khoản</span>
        </button>
      </div>

      {/* Load Data Group */}
      {!isDisabled && channel.flatformType === 'facebook' && channel.loginStatus === 'đã đăng nhập' && (
        <div className="context-menu-group">
          <div className="context-menu-submenu">
            <button
              className="context-menu-item"
              onClick={() => setShowLoadData(!showLoadData)}
            >
              <Database size={14} />
              <span>Load data</span>
              <ChevronRight size={12} style={{ marginLeft: 'auto', transform: showLoadData ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
            </button>
            {showLoadData && (
              <div className="context-submenu-items">
                <button
                  className="context-menu-item"
                  onClick={() => handleAction(() => onLoadFriends(channel))}
                >
                  <Users size={14} />
                  <span>Load danh sách bạn bè</span>
                </button>
                <button
                  className="context-menu-item"
                  onClick={() => handleAction(() => onLoadGroups(channel))}
                >
                  <FolderOpen size={14} />
                  <span>Load danh sách group</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Campaign Group */}
      <div className="context-menu-group">
        <button
          className="context-menu-item"
          onClick={() => handleAction(() => onFilterCampaigns(channel.id))}
        >
          <ListFilter size={14} />
          <span>Hiển thị chiến dịch</span>
        </button>
      </div>
    </div>
  )
}
