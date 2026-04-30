import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, Edit3, RefreshCw, Settings2, Copy, ChevronDown, ChevronUp, Pause, Play, X } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import { Campaign } from '../../../../shared/types'
import CampaignFormModal from './CampaignFormModal'
import ActionManagerModal from './ActionManagerModal'

interface CampaignPanelProps {
  filterChannelId?: number | null
  onClearFilter?: () => void
}

export default function CampaignPanel({ filterChannelId, onClearFilter }: CampaignPanelProps) {
  const {
    channels, campaigns, campaignActions,
    dataActions, loadingDataActions,
    resultActions, loadingResultActions,
    loadCampaigns, loadCampaignActions, loadChannels,
    createCampaign, updateCampaign, deleteCampaign, cloneCampaign,
    bulkUpdateCampaignStatus, bulkDeleteCampaigns,
    loadDataActions, loadResultActions
  } = useCampaignStore()
  const isAdminAkabiz = !!useAuthStore(s => s.user?.isAdminAkabiz)

  const [showForm, setShowForm] = useState(false)
  const [showActionManager, setShowActionManager] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)
  const [cloneFromId, setCloneFromId] = useState<number | undefined>(undefined)
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null)
  const [detailDockOpen, setDetailDockOpen] = useState(true)
  const [detailTab, setDetailTab] = useState<'data' | 'actions'>('data')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  useEffect(() => {
    loadCampaigns()
    loadCampaignActions()
    loadChannels()
  }, [loadCampaigns, loadCampaignActions, loadChannels])

  // Load data + results when a campaign is selected
  useEffect(() => {
    if (selectedCampaignId) {
      loadDataActions(selectedCampaignId)
      loadResultActions(selectedCampaignId)
    }
  }, [selectedCampaignId, loadDataActions, loadResultActions])

  // Clear bulk selection when channel filter changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filterChannelId])

  const handleEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign)
    setShowForm(true)
  }

  const handleDelete = (campaign: Campaign) => {
    useUiStore.getState().showConfirm(
      `Xoá chiến dịch "${campaign.name}"?`,
      async () => {
        await deleteCampaign(campaign.id)
        if (selectedCampaignId === campaign.id) {
          setSelectedCampaignId(null)
        }
      },
      { title: 'Xoá chiến dịch', confirmText: 'Xoá', variant: 'danger' }
    )
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

  const toggleSelectOne = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCampaigns.length && filteredCampaigns.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredCampaigns.map(c => c.id)))
    }
  }

  const handleBulkPause = async () => {
    const eligible = filteredCampaigns
      .filter(c => selectedIds.has(c.id))
      .filter(c => c.status === 'đang chạy' || c.status === 'chờ xử lý')
      .map(c => c.id)
    if (eligible.length === 0) {
      setSelectedIds(new Set())
      return
    }
    setBulkActionLoading(true)
    try {
      await bulkUpdateCampaignStatus(eligible, 'tạm dừng')
    } finally {
      setBulkActionLoading(false)
      setSelectedIds(new Set())
    }
  }

  const handleBulkResume = async () => {
    const eligible = filteredCampaigns
      .filter(c => selectedIds.has(c.id) && c.status === 'tạm dừng')
      .map(c => c.id)
    if (eligible.length === 0) {
      setSelectedIds(new Set())
      return
    }
    setBulkActionLoading(true)
    try {
      await bulkUpdateCampaignStatus(eligible, 'chờ xử lý')
    } finally {
      setBulkActionLoading(false)
      setSelectedIds(new Set())
    }
  }

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    useUiStore.getState().showConfirm(
      `Xoá ${ids.length} chiến dịch đã chọn?`,
      async () => {
        setBulkActionLoading(true)
        try {
          await bulkDeleteCampaigns(ids)
          if (selectedCampaignId && ids.includes(selectedCampaignId)) {
            setSelectedCampaignId(null)
          }
        } finally {
          setBulkActionLoading(false)
          setSelectedIds(new Set())
        }
      },
      { title: 'Xoá chiến dịch', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      // Campaign / data layer status
      case 'đang chạy': return 'var(--accent-warning)'
      case 'hoàn thành': return 'var(--accent-success)'
      case 'tạm dừng': return 'var(--accent-error)'
      // Result actions status (per-milestone)
      case 'thành công': return 'var(--accent-success)'
      case 'thất bại': return 'var(--accent-warning)'   // vàng — nghiệp vụ FB từ chối
      case 'lỗi': return 'var(--accent-error)'           // đỏ — exception/crash code
      default: return 'var(--text-tertiary)'
    }
  }

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)

  // Filter campaigns by channel if filter is active
  const filteredCampaigns = useMemo(() => {
    if (!filterChannelId) return campaigns
    return campaigns.filter(c => c.channelId === filterChannelId)
  }, [campaigns, filterChannelId])

  const filterChannelName = filterChannelId 
    ? channels.find(a => a.id === filterChannelId)?.name || `ID: ${filterChannelId}`
    : null

  return (
    <div className="campaign-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="campaign-panel-header">
        <span className="campaign-panel-title">Chiến dịch</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {isAdminAkabiz && (
            <button className="btn btn-ghost btn-icon" onClick={() => setShowActionManager(true)} title="Quản lý Hành động">
              <Settings2 size={14} />
            </button>
          )}
          <button className="btn btn-ghost btn-icon" onClick={() => loadCampaigns()} title="Làm mới">
            <RefreshCw size={14} />
          </button>
          <button className="btn btn-primary btn-icon" onClick={() => { setEditingCampaign(null); setShowForm(true); }} title="Thêm chiến dịch">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Filter indicator */}
      {filterChannelId && (
        <div className="campaign-filter-bar">
          <span>🔍 Lọc theo: <strong>{filterChannelName}</strong></span>
          <button className="btn-icon" onClick={onClearFilter} title="Bỏ lọc">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="campaign-bulk-action-bar">
          <span>Đã chọn <strong>{selectedIds.size}</strong> chiến dịch</span>
          <div className="bulk-action-buttons">
            <button className="btn btn-secondary btn-sm" disabled={bulkActionLoading} onClick={handleBulkResume} title="Tiếp tục các chiến dịch đang tạm dừng">
              <Play size={12} /> Tiếp tục
            </button>
            <button className="btn btn-secondary btn-sm" disabled={bulkActionLoading} onClick={handleBulkPause} title="Tạm dừng các chiến dịch đang chạy/chờ">
              <Pause size={12} /> Tạm dừng
            </button>
            <button className="btn btn-danger btn-sm" disabled={bulkActionLoading} onClick={handleBulkDelete} title="Xoá các chiến dịch đã chọn">
              <Trash2 size={12} /> Xoá
            </button>
            <button className="btn-icon" onClick={() => setSelectedIds(new Set())} title="Bỏ chọn tất cả">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <CampaignFormModal 
          campaign={editingCampaign}
          cloneFromId={cloneFromId}
          onClose={() => {
            setShowForm(false)
            setEditingCampaign(null)
            setCloneFromId(undefined)
            loadCampaigns()
            if (selectedCampaignId) loadDataActions(selectedCampaignId)
          }} 
        />
      )}

      {showActionManager && isAdminAkabiz && (
        <ActionManagerModal onClose={() => {
          setShowActionManager(false)
          loadCampaignActions()
        }} />
      )}

      {/* Campaign Table */}
      <div className="campaign-panel-content" style={{ flex: 1, minHeight: 0 }}>
        {filteredCampaigns.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">{filterChannelId ? 'Không có chiến dịch cho tài khoản này' : 'Chưa có chiến dịch'}</div></div>
        ) : (
          <div className="campaign-table">
            <div className="campaign-table-header">
              <div className="campaign-col col-checkbox">
                <input
                  type="checkbox"
                  checked={filteredCampaigns.length > 0 && selectedIds.size === filteredCampaigns.length}
                  ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredCampaigns.length }}
                  onChange={toggleSelectAll}
                />
              </div>
              <div className="campaign-col col-name">Tên</div>
              <div className="campaign-col col-action">Hành động</div>
              <div className="campaign-col col-channel">Tài khoản</div>
              <div className="campaign-col col-status">Trạng thái</div>
              <div className="campaign-col col-schedule">Lịch chạy</div>
              <div className="campaign-col col-ops"></div>
            </div>
            {filteredCampaigns.map(campaign => (
              <div
                key={campaign.id}
                className={`campaign-table-row ${selectedCampaignId === campaign.id ? 'selected' : ''} ${selectedIds.has(campaign.id) ? 'multi-selected' : ''}`}
                onClick={() => handleRowClick(campaign)}
                style={{ cursor: 'pointer' }}
              >
                <div className="campaign-col col-checkbox" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(campaign.id)}
                    onChange={() => toggleSelectOne(campaign.id)}
                  />
                </div>
                <div className="campaign-col col-name">{campaign.name}</div>
                <div className="campaign-col col-action">{campaign.actionName || campaign.actionId}</div>
                <div className="campaign-col col-channel">{campaign.channelName || '-'}</div>
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
                  Dữ liệu ({dataActions.length})
                </button>
                <button
                  className={`detail-dock-tab ${detailTab === 'actions' ? 'active' : ''}`}
                  onClick={() => {
                    setDetailTab('actions')
                    if (selectedCampaignId) loadResultActions(selectedCampaignId)
                  }}
                >
                  Lịch sử hành động ({resultActions.length})
                </button>
              </div>

              {/* Tab: Data Actions */}
              {detailTab === 'data' && (
                <>
                  {loadingDataActions ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : dataActions.length === 0 ? (
                    <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Chưa có dữ liệu nào</div>
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
                        {dataActions.map(d => (
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

              {/* Tab: Result Actions (per-milestone log) */}
              {detailTab === 'actions' && (
                <>
                  {loadingResultActions ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : resultActions.length === 0 ? (
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
                        {resultActions.map(a => (
                          <tr key={a.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {a.createdAt ? new Date(a.createdAt).toLocaleString('vi-VN') : '-'}
                            </td>
                            <td>
                              <strong>{a.actionName}</strong>
                            </td>
                            <td>
                              <span style={{ color: getStatusColor(a.status) }}>
                                {a.status === 'thành công' ? '✅ Thành công' : a.status === 'thất bại' ? '⚠️ Thất bại' : a.status === 'lỗi' ? '❌ Lỗi' : a.status}
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
