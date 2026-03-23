import { useState, useEffect } from 'react'
import { Plus, Trash2, Globe, Edit3, Power } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { FlatformAccount } from '../../../../shared/types'

export default function AccountPanel() {
  const { accounts, loadAccounts, createAccount, updateAccount, deleteAccount } = useCampaignStore()
  const [showForm, setShowForm] = useState(false)
  const [editingAccount, setEditingAccount] = useState<FlatformAccount | null>(null)
  const [formData, setFormData] = useState({ name: '', flatformType: 'facebook' })

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const handleSubmit = async () => {
    if (!formData.name.trim()) return
    try {
      if (editingAccount) {
        await updateAccount(editingAccount.id, {
          name: formData.name,
          flatformType: formData.flatformType
        })
      } else {
        await createAccount({
          name: formData.name,
          flatformType: formData.flatformType
        })
      }
      setShowForm(false)
      setEditingAccount(null)
      setFormData({ name: '', flatformType: 'facebook' })
    } catch (err) {
      console.error('Failed to save account:', err)
    }
  }

  const handleEdit = (account: FlatformAccount) => {
    setEditingAccount(account)
    setFormData({ name: account.name, flatformType: account.flatformType })
    setShowForm(true)
  }

  const handleDelete = async (account: FlatformAccount) => {
    if (!confirm(`Xoá tài khoản "${account.name}"?`)) return
    await deleteAccount(account.id)
  }

  const handleToggleBrowser = async (account: FlatformAccount) => {
    if (!window.electronAPI) return
    try {
      const { connected } = await window.electronAPI.getProfileStatus(account.id)
      if (connected) {
        await window.electronAPI.closeProfile(account.id)
      } else {
        await window.electronAPI.launchProfile(account.id, account.name)
      }
      loadAccounts()
    } catch (err) {
      console.error('Failed to toggle browser:', err)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'đang chạy': return 'var(--accent-success)'
      case 'tạm dừng': return 'var(--accent-warning)'
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
            <div key={account.id} className="account-card">
              <div className="account-card-info">
                <div className="account-card-name">{account.name}</div>
                <div className="account-card-meta">
                  <span className="account-tag" style={{ color: 'var(--accent-info)' }}>{account.flatformType}</span>
                </div>
                <div className="account-card-meta">
                  <span style={{ color: getLoginColor(account.loginStatus) }}>{account.loginStatus}</span>
                </div>
                <div className="account-card-meta">
                  <span style={{ color: getStatusColor(account.status) }}>{account.status}</span>
                  {!account.isActive && <span className="account-tag inactive">Ngưng hoạt động</span>}
                </div>
              </div>
              <div className="account-card-actions">
                <button className="btn-icon" onClick={() => handleToggleBrowser(account)} title="Mở/Đóng trình duyệt">
                  <Globe size={13} />
                </button>
                <button className="btn-icon" onClick={() => handleEdit(account)} title="Sửa">
                  <Edit3 size={13} />
                </button>
                <button className="btn-icon" onClick={() => handleDelete(account)} title="Xoá">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
