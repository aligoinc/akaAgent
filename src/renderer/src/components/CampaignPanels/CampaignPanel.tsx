import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, RefreshCw, Settings2, Copy, ChevronDown, ChevronUp, Pause, Play } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { Campaign } from '../../../../shared/types'
import CampaignFormModal from './CampaignFormModal'
import ActionManagerModal from './ActionManagerModal'

export default function CampaignPanel() {
  const {
    accounts, campaigns, campaignActions,
    campaignDetails, loadingDetails,
    detailActions, loadingDetailActions,
    loadCampaigns, loadCampaignActions, loadAccounts,
    createCampaign, updateCampaign, deleteCampaign, cloneCampaign,
    loadCampaignDetails, loadDetailActionsByCampaign
  } = useCampaignStore()

  const [showForm, setShowForm] = useState(false)
  const [showActionManager, setShowActionManager] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)
  const [cloneFromId, setCloneFromId] = useState<number | undefined>(undefined)
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null)
  const [detailDockOpen, setDetailDockOpen] = useState(true)
  const [detailTab, setDetailTab] = useState<'data' | 'actions'>('data')

  useEffect(() => {
    loadCampaigns()
    loadCampaignActions()
    loadAccounts()
  }, [loadCampaigns, loadCampaignActions, loadAccounts])

  // Load details when a campaign is selected
  useEffect(() => {
    if (selectedCampaignId) {
      loadCampaignDetails(selectedCampaignId)
      loadDetailActionsByCampaign(selectedCampaignId)
    }
  }, [selectedCampaignId, loadCampaignDetails, loadDetailActionsByCampaign])

  const handleEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign)
    setShowForm(true)
  }

  const handleDelete = async (campaign: Campaign) => {
    if (!confirm(`Xoá chiến dịch "${campaign.name}"?`)) return
    await deleteCampaign(campaign.id)
    if (selectedCampaignId === campaign.id) {
      setSelectedCampaignId(null)
    }
  }

  const handleClone = (campaign: Campaign) => {
    const cloneData: Campaign = {
      ...campaign,
      id: 0,
      name: campaign.name + ' (Copy)',
      status: 'chờ xử lý',
      log: ''
    }
    setCloneFromId(campaign.id)
    setEditingCampaign(cloneData)
    setShowForm(true)
  }

  const handleRowClick = (campaign: Campaign) => {
    setSelectedCampaignId(prev => prev === campaign.id ? null : campaign.id)
    if (!detailDockOpen) setDetailDockOpen(true)
  }

  const handlePause = async (campaign: Campaign) => {
    await updateCampaign(campaign.id, { status: 'tạm dừng' })
  }

  const handleResume = async (campaign: Campaign) => {
    await updateCampaign(campaign.id, { status: 'chờ xử lý' })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'đang chạy': return 'var(--accent-warning)'
      case 'hoàn thành': return 'var(--accent-success)'
      case 'lỗi': return 'var(--accent-error)'
      case 'tạm dừng': return 'var(--accent-info)'
      case 'success': return 'var(--accent-success)'
      case 'error': return 'var(--accent-error)'
      default: return 'var(--text-tertiary)'
    }
  }

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)

  return (
    <div className="campaign-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="campaign-panel-header">
        <span className="campaign-panel-title">Chiến dịch</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-icon" onClick={() => setShowActionManager(true)} title="Quản lý Hành động">
            <Settings2 size={14} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => loadCampaigns()} title="Làm mới">
            <RefreshCw size={14} />
          </button>
          <button className="btn btn-primary btn-icon" onClick={() => { setEditingCampaign(null); setShowForm(true); }} title="Thêm chiến dịch">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {showForm && (
        <CampaignFormModal 
          campaign={editingCampaign}
          cloneFromId={cloneFromId}
          onClose={() => {
            setShowForm(false)
            setEditingCampaign(null)
            setCloneFromId(undefined)
            loadCampaigns()
            if (selectedCampaignId) loadCampaignDetails(selectedCampaignId)
          }} 
        />
      )}

      {showActionManager && (
        <ActionManagerModal onClose={() => {
          setShowActionManager(false)
          loadCampaignActions()
        }} />
      )}

      {/* Campaign Table */}
      <div className="campaign-panel-content" style={{ flex: 1, minHeight: 0 }}>
        {campaigns.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">Chưa có chiến dịch</div></div>
        ) : (
          <div className="campaign-table">
            <div className="campaign-table-header">
              <div className="campaign-col col-name">Tên</div>
              <div className="campaign-col col-action">Hành động</div>
              <div className="campaign-col col-account">Tài khoản</div>
              <div className="campaign-col col-status">Trạng thái</div>
              <div className="campaign-col col-schedule">Lịch chạy</div>
              <div className="campaign-col col-ops"></div>
            </div>
            {campaigns.map(campaign => (
              <div 
                key={campaign.id} 
                className={`campaign-table-row ${selectedCampaignId === campaign.id ? 'selected' : ''}`}
                onClick={() => handleRowClick(campaign)}
                style={{ cursor: 'pointer' }}
              >
                <div className="campaign-col col-name">{campaign.name}</div>
                <div className="campaign-col col-action">{campaign.actionName || campaign.actionId}</div>
                <div className="campaign-col col-account">{campaign.accountName || '-'}</div>
                <div className="campaign-col col-status">
                  <span className="status-badge" style={{ color: getStatusColor(campaign.status) }}>
                    {campaign.status}
                  </span>
                </div>
                <div className="campaign-col col-schedule">
                  {campaign.schedule ? new Date(campaign.schedule).toLocaleString('vi-VN') : '-'}
                </div>
                <div className="campaign-col col-ops" onClick={e => e.stopPropagation()}>
                  {(campaign.status === 'đang chạy' || campaign.status === 'chờ xử lý') && (
                    <button className="btn-icon" onClick={() => handlePause(campaign)} title="Tạm dừng">
                      <Pause size={12} />
                    </button>
                  )}
                  {campaign.status === 'tạm dừng' && (
                    <button className="btn-icon" onClick={() => handleResume(campaign)} title="Tiếp tục">
                      <Play size={12} />
                    </button>
                  )}
                  <button className="btn-icon" onClick={() => handleClone(campaign)} title="Nhân bản">
                    <Copy size={12} />
                  </button>
                  <button className="btn-icon" onClick={() => handleEdit(campaign)} title="Sửa">
                    <Edit3 size={12} />
                  </button>
                  <button className="btn-icon" onClick={() => handleDelete(campaign)} title="Xoá">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Detail Dock */}
      {selectedCampaignId && (
        <div className="campaign-detail-dock">
          <div className="detail-dock-header" onClick={() => setDetailDockOpen(!detailDockOpen)}>
            <span className="detail-dock-title">
              Chi tiết: <strong>{selectedCampaign?.name || ''}</strong>
            </span>
            <button className="btn-icon">
              {detailDockOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>

          {detailDockOpen && (
            <div className="detail-dock-body">
              {/* Tabs */}
              <div className="detail-dock-tabs">
                <button
                  className={`detail-dock-tab ${detailTab === 'data' ? 'active' : ''}`}
                  onClick={() => setDetailTab('data')}
                >
                  Dữ liệu ({campaignDetails.length})
                </button>
                <button
                  className={`detail-dock-tab ${detailTab === 'actions' ? 'active' : ''}`}
                  onClick={() => {
                    setDetailTab('actions')
                    if (selectedCampaignId) loadDetailActionsByCampaign(selectedCampaignId)
                  }}
                >
                  Lịch sử hành động ({detailActions.length})
                </button>
              </div>

              {/* Tab: Data */}
              {detailTab === 'data' && (
                <>
                  {loadingDetails ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : campaignDetails.length === 0 ? (
                    <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Chưa có chi tiết nào</div>
                  ) : (
                    <table className="campaign-grid" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Tên</th>
                          <th>UID</th>
                          <th>SĐT</th>
                          <th>Email</th>
                          <th>Trạng thái</th>
                          <th>Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaignDetails.map(d => (
                          <tr key={d.id}>
                            <td>{d.name || '-'}</td>
                            <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.uid || '-'}</td>
                            <td>{d.phone || '-'}</td>
                            <td>{d.email || '-'}</td>
                            <td>
                              <span style={{ color: getStatusColor(d.status) }}>{d.status}</span>
                            </td>
                            <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.note || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {/* Tab: Action Logs */}
              {detailTab === 'actions' && (
                <>
                  {loadingDetailActions ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : detailActions.length === 0 ? (
                    <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Chưa có hành động nào được ghi nhận</div>
                  ) : (
                    <table className="campaign-grid" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Thời gian</th>
                          <th>Hành động</th>
                          <th>Trạng thái</th>
                          <th>Chi tiết</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailActions.map(a => (
                          <tr key={a.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {a.createdAt ? new Date(a.createdAt).toLocaleString('vi-VN') : '-'}
                            </td>
                            <td>
                              <strong>{a.actionName}</strong>
                            </td>
                            <td>
                              <span style={{ color: getStatusColor(a.status) }}>
                                {a.status === 'success' ? '✅ Thành công' : a.status === 'error' ? '❌ Lỗi' : a.status}
                              </span>
                            </td>
                            <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {a.log || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
