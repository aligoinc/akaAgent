import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { AutoAccount } from '../../../../shared/types'
import AccountContextMenu from './AccountContextMenu'
import { useUiStore } from '../../stores/uiStore'

interface AccountPanelProps {
  onNavigateToBrowser?: (accountId: number) => void
  onFilterCampaigns?: (accountId: number | null) => void
}

export default function AccountPanel({ onNavigateToBrowser, onFilterCampaigns }: AccountPanelProps) {
  const { accounts, loadAccounts, createAccount, updateAccount, deleteAccount } = useCampaignStore()
  const [showForm, setShowForm] = useState(false)
  const [editingAccount, setEditingAccount] = useState<AutoAccount | null>(null)
  const [formData, setFormData] = useState({ 
    name: '', 
    flatformType: 'facebook'
  })

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    account: AutoAccount
    position: { x: number; y: number }
  } | null>(null)

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const handleSubmit = async () => {
    if (!formData.name.trim()) return
    try {
      const payload = {
        name: formData.name,
        flatformType: formData.flatformType
      }

      if (editingAccount) {
        await updateAccount(editingAccount.id, payload)
      } else {
        await createAccount(payload)
      }
      setShowForm(false)
      setEditingAccount(null)
      setFormData({ name: '', flatformType: 'facebook' })
    } catch (err) {
      console.error('Failed to save account:', err)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, account: AutoAccount) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      account,
      position: { x: e.clientX, y: e.clientY }
    })
  }

  const handleEdit = (account: AutoAccount) => {
    setEditingAccount(account)
    setFormData({ 
      name: account.name,
      flatformType: account.flatformType
    })
    setShowForm(true)
  }

  const handleDelete = (account: AutoAccount) => {
    useUiStore.getState().showConfirm(
      `Xoá tài khoản "${account.name}"?`,
      async () => { await deleteAccount(account.id) },
      { title: 'Xoá tài khoản', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleViewBrowser = (accountId: number) => {
    onNavigateToBrowser?.(accountId)
  }

  const handleReloadPage = async (account: AutoAccount) => {
    if (!window.electronAPI?.reloadAccountPage) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    const result = await window.electronAPI.reloadAccountPage(account.id, account.flatformType)
    if (!result.success) {
      useUiStore.getState().showAlert(`Không thể load lại: ${result.reason}`, 'error')
    }
  }

  const handleCheckLogin = async (account: AutoAccount) => {
    if (!window.electronAPI?.checkFacebookLogin) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    try {
      const result = await window.electronAPI.checkFacebookLogin(account.id)
      await loadAccounts() // Refresh to get updated loginStatus
      if (result.loggedIn) {
        useUiStore.getState().showAlert(`✅ ${account.name}: Đã đăng nhập Facebook`, 'success')
      } else {
        useUiStore.getState().showAlert(`❌ ${account.name}: ${result.reason || 'Chưa đăng nhập'}`, 'error')
      }
    } catch (err: any) {
      useUiStore.getState().showAlert(`Lỗi kiểm tra: ${err.message}`, 'error')
    }
  }

  const handleResume = async (account: AutoAccount) => {
    await updateAccount(account.id, { status: 'hoạt động' })
  }

  const handlePause = async (account: AutoAccount) => {
    await updateAccount(account.id, { status: 'tạm dừng' })
  }

  const handleEnable = async (account: AutoAccount) => {
    await updateAccount(account.id, { isActive: true, status: 'hoạt động' })
  }

  const handleDisable = async (account: AutoAccount) => {
    await updateAccount(account.id, { isActive: false, status: 'vô hiệu hoá' })
  }

  const handleFilterCampaigns = (accountId: number) => {
    onFilterCampaigns?.(accountId)
  }

  const handleLoadFriends = async (account: AutoAccount) => {
    if (!window.electronAPI?.loadFriends) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    try {
      const result = await window.electronAPI.loadFriends(account.id)
      if (result.success) {
        useUiStore.getState().showAlert(`✅ Đã load ${result.count} bạn bè cho "${account.name}"`, 'success')
      } else {
        useUiStore.getState().showAlert(`❌ Lỗi: ${result.error}`, 'error')
      }
    } catch (err: any) {
      useUiStore.getState().showAlert(`Lỗi load bạn bè: ${err.message}`, 'error')
    }
  }

  const handleLoadGroups = async (account: AutoAccount) => {
    if (!window.electronAPI?.loadGroups) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    try {
      const result = await window.electronAPI.loadGroups(account.id)
      if (result.success) {
        useUiStore.getState().showAlert(`✅ Đã load ${result.count} group cho "${account.name}"`, 'success')
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

  const getStatusIcon = (account: AutoAccount) => {
    if (!account.isActive) return '🚫'
    if (account.status === 'tạm dừng') return '⏸️'
    if (account.status === 'hoạt động' || account.status === 'đang chạy') return '🟢'
    return '⏳'
  }

  return (
    <div className="campaign-panel">
      <div className="campaign-panel-header">
        <span className="campaign-panel-title">Tài khoản</span>
        <button className="btn btn-primary btn-icon" onClick={() => { setShowForm(true); setEditingAccount(null); setFormData({ name: '', flatformType: 'facebook' }) }} title="Thêm tài khoản">
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
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setEditingAccount(null) }}>Huỷ</button>
            <button className="btn btn-primary" onClick={handleSubmit}>{editingAccount ? 'Cập nhật' : 'Tạo'}</button>
          </div>
        </div>
      )}

      <div className="campaign-panel-content">
        {accounts.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">Chưa có tài khoản</div></div>
        ) : (
          accounts.map(account => (
            <div 
              key={account.id}
              className={`account-card ${!account.isActive ? 'disabled' : ''}`}
              onContextMenu={(e) => handleContextMenu(e, account)}
              title="Nhấn chuột phải để xem menu"
            >
              <div className="account-card-info">
                <div className="account-card-name">
                  <span className="account-status-icon">{getStatusIcon(account)}</span>
                  {account.name}
                </div>
                <div className="account-card-meta">
                  <span className="account-tag" style={{ color: 'var(--accent-info)' }}>{account.flatformType}</span>
                  <span style={{ color: getLoginColor(account.loginStatus), fontSize: '10px' }}>{account.loginStatus}</span>
                </div>
                <div className="account-card-meta">
                  <span style={{ color: getStatusColor(account.status), fontSize: '10px', fontWeight: 600 }}>{account.status}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <AccountContextMenu
          account={contextMenu.account}
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
