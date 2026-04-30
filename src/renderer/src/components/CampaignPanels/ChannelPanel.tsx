import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { OrgChannel } from '../../../../shared/types'
import ChannelContextMenu from './ChannelContextMenu'
import { useUiStore } from '../../stores/uiStore'

interface ChannelPanelProps {
  onNavigateToBrowser?: (channelId: number) => void
  onFilterCampaigns?: (channelId: number | null) => void
}

export default function ChannelPanel({ onNavigateToBrowser, onFilterCampaigns }: ChannelPanelProps) {
  const { channels, loadChannels, createChannel, updateChannel, deleteChannel } = useCampaignStore()
  const [showForm, setShowForm] = useState(false)
  const [editingChannel, setEditingChannel] = useState<OrgChannel | null>(null)
  const [formData, setFormData] = useState({ 
    name: '', 
    flatformType: 'facebook'
  })

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    channel: OrgChannel
    position: { x: number; y: number }
  } | null>(null)

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  const handleSubmit = async () => {
    if (!formData.name.trim()) return
    try {
      const payload = {
        name: formData.name,
        flatformType: formData.flatformType
      }

      if (editingChannel) {
        await updateChannel(editingChannel.id, payload)
      } else {
        await createChannel(payload)
      }
      setShowForm(false)
      setEditingChannel(null)
      setFormData({ name: '', flatformType: 'facebook' })
    } catch (err) {
      console.error('Failed to save channel:', err)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, channel: OrgChannel) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      channel,
      position: { x: e.clientX, y: e.clientY }
    })
  }

  const handleEdit = (channel: OrgChannel) => {
    setEditingChannel(channel)
    setFormData({ 
      name: channel.name, 
      flatformType: channel.flatformType
    })
    setShowForm(true)
  }

  const handleDelete = (channel: OrgChannel) => {
    useUiStore.getState().showConfirm(
      `Xoá tài khoản "${channel.name}"?`,
      async () => { await deleteChannel(channel.id) },
      { title: 'Xoá tài khoản', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleViewBrowser = (channelId: number) => {
    onNavigateToBrowser?.(channelId)
  }

  const handleReloadPage = async (channel: OrgChannel) => {
    if (!window.electronAPI?.reloadChannelPage) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    const result = await window.electronAPI.reloadChannelPage(channel.id, channel.flatformType)
    if (!result.success) {
      useUiStore.getState().showAlert(`Không thể load lại: ${result.reason}`, 'error')
    }
  }

  const handleCheckLogin = async (channel: OrgChannel) => {
    if (!window.electronAPI?.checkFacebookLogin) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    try {
      const result = await window.electronAPI.checkFacebookLogin(channel.id)
      await loadChannels() // Refresh to get updated loginStatus
      if (result.loggedIn) {
        useUiStore.getState().showAlert(`✅ ${channel.name}: Đã đăng nhập Facebook`, 'success')
      } else {
        useUiStore.getState().showAlert(`❌ ${channel.name}: ${result.reason || 'Chưa đăng nhập'}`, 'error')
      }
    } catch (err: any) {
      useUiStore.getState().showAlert(`Lỗi kiểm tra: ${err.message}`, 'error')
    }
  }

  const handleResume = async (channel: OrgChannel) => {
    await updateChannel(channel.id, { status: 'hoạt động' })
  }

  const handlePause = async (channel: OrgChannel) => {
    await updateChannel(channel.id, { status: 'tạm dừng' })
  }

  const handleEnable = async (channel: OrgChannel) => {
    await updateChannel(channel.id, { isActive: true, status: 'hoạt động' })
  }

  const handleDisable = async (channel: OrgChannel) => {
    await updateChannel(channel.id, { isActive: false, status: 'vô hiệu hoá' })
  }

  const handleFilterCampaigns = (channelId: number) => {
    onFilterCampaigns?.(channelId)
  }

  const handleLoadFriends = async (channel: OrgChannel) => {
    if (!window.electronAPI?.loadFriends) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    try {
      const result = await window.electronAPI.loadFriends(channel.id)
      if (result.success) {
        useUiStore.getState().showAlert(`✅ Đã load ${result.count} bạn bè cho "${channel.name}"`, 'success')
      } else {
        useUiStore.getState().showAlert(`❌ Lỗi: ${result.error}`, 'error')
      }
    } catch (err: any) {
      useUiStore.getState().showAlert(`Lỗi load bạn bè: ${err.message}`, 'error')
    }
  }

  const handleLoadGroups = async (channel: OrgChannel) => {
    if (!window.electronAPI?.loadGroups) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    try {
      const result = await window.electronAPI.loadGroups(channel.id)
      if (result.success) {
        useUiStore.getState().showAlert(`✅ Đã load ${result.count} group cho "${channel.name}"`, 'success')
      } else {
        useUiStore.getState().showAlert(`❌ Lỗi: ${result.error}`, 'error')
      }
    } catch (err: any) {
      useUiStore.getState().showAlert(`Lỗi load group: ${err.message}`, 'error')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'hoạt động': return 'var(--accent-success)'
      case 'đang chạy': return 'var(--accent-success)'
      case 'tạm dừng': return 'var(--accent-warning)'
      case 'vô hiệu hoá': return 'var(--accent-error)'
      case 'lỗi': return 'var(--accent-error)'
      default: return 'var(--text-tertiary)'
    }
  }

  const getLoginColor = (login: string) => {
    switch (login) {
      case 'đã đăng nhập': return 'var(--accent-success)'
      case 'checkpoint': return 'var(--accent-error)'
      default: return 'var(--text-tertiary)'
    }
  }

  const getStatusIcon = (channel: OrgChannel) => {
    if (!channel.isActive) return '🚫'
    if (channel.status === 'tạm dừng') return '⏸️'
    if (channel.status === 'hoạt động' || channel.status === 'đang chạy') return '🟢'
    return '⏳'
  }

  return (
    <div className="campaign-panel">
      <div className="campaign-panel-header">
        <span className="campaign-panel-title">Tài khoản</span>
        <button className="btn btn-primary btn-icon" onClick={() => { setShowForm(true); setEditingChannel(null); setFormData({ name: '', flatformType: 'facebook' }) }} title="Thêm tài khoản">
          <Plus size={14} />
        </button>
      </div>

      {showForm && (
        <div className="panel-form">
          <input
            type="text"
            placeholder="Tên tài khoản"
            value={formData.name}
            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className="panel-input"
            autoFocus
          />
          <select
            value={formData.flatformType}
            onChange={e => setFormData(prev => ({ ...prev, flatformType: e.target.value }))}
            className="panel-input"
          >
            <option value="facebook">Facebook</option>
            <option value="zalo">Zalo</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="other">Khác</option>
          </select>

          <div className="panel-form-actions">
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setEditingChannel(null) }}>Huỷ</button>
            <button className="btn btn-primary" onClick={handleSubmit}>{editingChannel ? 'Cập nhật' : 'Tạo'}</button>
          </div>
        </div>
      )}

      <div className="campaign-panel-content">
        {channels.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">Chưa có tài khoản</div></div>
        ) : (
          channels.map(channel => (
            <div 
              key={channel.id} 
              className={`channel-card ${!channel.isActive ? 'disabled' : ''}`}
              onContextMenu={(e) => handleContextMenu(e, channel)}
              title="Nhấn chuột phải để xem menu"
            >
              <div className="channel-card-info">
                <div className="channel-card-name">
                  <span className="channel-status-icon">{getStatusIcon(channel)}</span>
                  {channel.name}
                </div>
                <div className="channel-card-meta">
                  <span className="channel-tag" style={{ color: 'var(--accent-info)' }}>{channel.flatformType}</span>
                  <span style={{ color: getLoginColor(channel.loginStatus), fontSize: '10px' }}>{channel.loginStatus}</span>
                </div>
                <div className="channel-card-meta">
                  <span style={{ color: getStatusColor(channel.status), fontSize: '10px', fontWeight: 600 }}>{channel.status}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ChannelContextMenu
          channel={contextMenu.channel}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onViewBrowser={handleViewBrowser}
          onReloadPage={handleReloadPage}
          onCheckLogin={handleCheckLogin}
          onResume={handleResume}
          onPause={handlePause}
          onEnable={handleEnable}
          onDisable={handleDisable}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onFilterCampaigns={handleFilterCampaigns}
          onLoadFriends={handleLoadFriends}
          onLoadGroups={handleLoadGroups}
        />
      )}
    </div>
  )
}
