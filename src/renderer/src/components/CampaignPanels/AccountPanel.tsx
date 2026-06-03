import { useState, useEffect } from 'react'
import { FolderCog, Loader2, Plus } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { AutoAccount } from '../../../../shared/types'
import AccountContextMenu from './AccountContextMenu'
import AccountInfoModal from './AccountInfoModal'
import AccountGroupAssignModal from './AccountGroupAssignModal'
import AccountGroupManagerModal from './AccountGroupManagerModal'
import { useUiStore } from '../../stores/uiStore'

interface AccountPanelProps {
  onNavigateToBrowser?: (accountId: number) => void
  onFilterCampaigns?: (accountId: number | null) => void
}

export default function AccountPanel({ onNavigateToBrowser, onFilterCampaigns }: AccountPanelProps) {
  const {
    accounts,
    accountGroups,
    loadAccounts,
    loadAccountGroups,
    createAccount,
    updateAccount,
    deleteAccount,
    createAccountGroup,
    updateAccountGroup,
    deleteAccountGroup
  } = useCampaignStore()
  const [showForm, setShowForm] = useState(false)
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [groupManagerPlatform, setGroupManagerPlatform] = useState('facebook')
  const [groupAssignAccount, setGroupAssignAccount] = useState<AutoAccount | null>(null)
  const [editingAccount, setEditingAccount] = useState<AutoAccount | null>(null)
  const [infoAccount, setInfoAccount] = useState<AutoAccount | null>(null)
  const [savingAccount, setSavingAccount] = useState(false)
  const [formData, setFormData] = useState({ 
    name: '', 
    flatformType: 'facebook',
    accountGroupId: null as number | null
  })

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    account: AutoAccount
    position: { x: number; y: number }
  } | null>(null)

  useEffect(() => {
    loadAccounts()
    loadAccountGroups()
  }, [loadAccounts, loadAccountGroups])

  const resetForm = () => {
    setFormData({ name: '', flatformType: 'facebook', accountGroupId: null })
  }

  const openCreateForm = () => {
    setShowForm(true)
    setEditingAccount(null)
    resetForm()
  }

  const openGroupManager = (platform = formData.flatformType) => {
    setGroupManagerPlatform(platform)
    setShowGroupManager(true)
  }

  const formAccountGroups = accountGroups.filter(group => group.flatformType === formData.flatformType && group.isActive)

  const handleSubmit = async () => {
    if (savingAccount || !formData.name.trim()) return
    setSavingAccount(true)
    try {
      const payload = {
        name: formData.name,
        flatformType: formData.flatformType,
        accountGroupId: formData.accountGroupId
      }

      if (editingAccount) {
        await updateAccount(editingAccount.id, payload)
      } else {
        await createAccount(payload)
      }
      setShowForm(false)
      setEditingAccount(null)
      resetForm()
    } catch (err) {
      console.error('Failed to save account:', err)
    } finally {
      setSavingAccount(false)
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
      flatformType: account.flatformType,
      accountGroupId: account.accountGroupId ?? null
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
    await updateAccount(account.id, { status: 'chờ xử lý' })
  }

  const handlePause = async (account: AutoAccount) => {
    await updateAccount(account.id, { status: 'tạm dừng' })
  }

  const handleEnable = async (account: AutoAccount) => {
    await updateAccount(account.id, { isActive: true, status: 'chờ xử lý' })
  }

  const handleDisable = async (account: AutoAccount) => {
    await updateAccount(account.id, { isActive: false, status: 'tạm dừng' })
  }

  const handleViewInfo = (account: AutoAccount) => {
    setInfoAccount(account)
  }

  const handleChangeGroup = (account: AutoAccount) => {
    setGroupAssignAccount(account)
  }

  const handleAssignAccountsToGroup = async (accountIds: number[], accountGroupId: number | null) => {
    for (const accountId of accountIds) {
      await updateAccount(accountId, { accountGroupId })
    }
  }

  const handleFilterCampaigns = (accountId: number) => {
    onFilterCampaigns?.(accountId)
  }

  const getAccountStatusClass = (status: string) => {
    switch (status) {
      case 'chờ xử lý': return 'status-pending'
      case 'đang chạy': return 'status-running'
      case 'tạm dừng': return 'status-paused'
      default: return 'status-unknown'
    }
  }

  const getLoginColor = (login: string) => {
    switch (login) {
      case 'đã đăng nhập': return 'var(--accent-success)'
      case 'checkpoint': return 'var(--accent-error)'
      default: return 'var(--text-tertiary)'
    }
  }

  return (
    <div className="campaign-panel">
      <div className="campaign-panel-header">
        <span className="campaign-panel-title">Tài khoản</span>
        <div className="campaign-panel-header-actions">
          <button className="btn btn-secondary btn-icon" onClick={() => openGroupManager()} title="Nhóm tài khoản">
            <FolderCog size={14} />
          </button>
          <button className="btn btn-primary btn-icon" onClick={openCreateForm} title="Thêm tài khoản">
            <Plus size={14} />
          </button>
        </div>
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
            onChange={e => setFormData(prev => ({ ...prev, flatformType: e.target.value, accountGroupId: null }))}
            className="panel-input"
          >
            <option value="facebook">Facebook</option>
            <option value="zalo">Zalo</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="other">Khác</option>
          </select>

          <div className="panel-input-row">
            <select
              value={formData.accountGroupId ?? ''}
              onChange={e => setFormData(prev => ({
                ...prev,
                accountGroupId: e.target.value ? Number(e.target.value) : null
              }))}
              className="panel-input"
            >
              <option value="">Không thuộc nhóm</option>
              {formAccountGroups.map(group => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
            <button
              className="btn btn-secondary btn-icon"
              onClick={() => openGroupManager(formData.flatformType)}
              title="Tạo hoặc sửa nhóm"
            >
              <FolderCog size={14} />
            </button>
          </div>

          <div className="panel-form-actions">
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setEditingAccount(null); resetForm() }}>Huỷ</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={savingAccount}>
              {savingAccount && <Loader2 size={14} className="animate-spin" />}
              {savingAccount ? 'Đang lưu...' : editingAccount ? 'Cập nhật' : 'Tạo'}
            </button>
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
              className={`account-card ${getAccountStatusClass(account.status)} ${!account.isActive ? 'disabled' : ''}`}
              onContextMenu={(e) => handleContextMenu(e, account)}
              title="Nhấn chuột phải để xem menu"
            >
              <div className="account-card-info">
                <div className="account-card-name">
                  <span className={`account-status-dot ${!account.isActive ? 'is-disabled' : getAccountStatusClass(account.status)}`} aria-hidden="true" />
                  <span className="account-card-name-text" title={account.name}>{account.name}</span>
                </div>
                <div className="account-card-meta">
                  <span className="account-tag" style={{ color: 'var(--accent-info)' }}>{account.flatformType}</span>
                  <span style={{ color: getLoginColor(account.loginStatus), fontSize: '10px' }}>{account.loginStatus}</span>
                </div>
                <div className="account-card-meta">
                  <span className="account-card-status">{account.status}</span>
                  {account.accountGroupName && (
                    <span className="account-group-tag" title={account.accountGroupName}>{account.accountGroupName}</span>
                  )}
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
          onViewInfo={handleViewInfo}
          onEdit={handleEdit}
          onChangeGroup={handleChangeGroup}
          onDelete={handleDelete}
          onFilterCampaigns={handleFilterCampaigns}
        />
      )}

      {infoAccount && (
        <AccountInfoModal
          account={infoAccount}
          onClose={() => setInfoAccount(null)}
        />
      )}

      {showGroupManager && (
        <AccountGroupManagerModal
          groups={accountGroups}
          accounts={accounts}
          initialPlatform={groupManagerPlatform}
          onClose={() => setShowGroupManager(false)}
          onCreateGroup={createAccountGroup}
          onUpdateGroup={updateAccountGroup}
          onDeleteGroup={deleteAccountGroup}
          onAssignAccounts={handleAssignAccountsToGroup}
        />
      )}

      {groupAssignAccount && (
        <AccountGroupAssignModal
          account={groupAssignAccount}
          groups={accountGroups}
          onClose={() => setGroupAssignAccount(null)}
          onManageGroups={(platform) => {
            setGroupAssignAccount(null)
            openGroupManager(platform)
          }}
          onSave={async (accountId, accountGroupId) => {
            await handleAssignAccountsToGroup([accountId], accountGroupId)
          }}
        />
      )}
    </div>
  )
}
