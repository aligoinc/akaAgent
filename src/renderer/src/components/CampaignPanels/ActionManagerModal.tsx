import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, X } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import { CampaignAction } from '../../../../shared/types'
import { WorkflowDef } from '../../../../shared/v2Types'

interface ActionManagerModalProps {
  onClose: () => void
}

export default function ActionManagerModal({ onClose }: ActionManagerModalProps) {
  const { allCampaignActions, loadAllCampaignActions, createCampaignAction, updateCampaignAction, deleteCampaignAction } = useCampaignStore()

  const [workflows, setWorkflows] = useState<WorkflowDef[]>([])
  const [editingAction, setEditingAction] = useState<CampaignAction | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState<{ id: string; name: string; flatformType: string; workflowId: number | ''; isActive: boolean }>({
    id: '',
    name: '',
    flatformType: 'facebook',
    workflowId: '',
    isActive: true
  })

  useEffect(() => {
    loadAllCampaignActions()

    // Load workflows v2 for the dropdown
    if (window.electronAPI?.v2?.listWorkflows) {
      window.electronAPI.v2.listWorkflows().then(setWorkflows).catch(console.error)
    }
  }, [loadAllCampaignActions])

  const handleAddNew = () => {
    setEditingAction(null)
    setFormData({
      id: '',
      name: '',
      flatformType: 'facebook',
      workflowId: '',
      isActive: true
    })
    setShowForm(true)
  }

  const handleEdit = (action: CampaignAction) => {
    setEditingAction(action)
    setFormData({
      id: action.id,
      name: action.name,
      flatformType: action.flatformType,
      workflowId: action.workflowId ?? '',
      isActive: action.isActive
    })
    setShowForm(true)
  }

  const handleDelete = (action: CampaignAction) => {
    useUiStore.getState().showConfirm(
      `Xoá hành động "${action.name}"?`,
      async () => {
        try {
          await deleteCampaignAction(action.id)
        } catch (err) {
          console.error('Failed to delete action:', err)
          useUiStore.getState().showAlert('', 'error')
        }
      },
      { title: 'Xoá hành động', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleSubmit = async () => {
    if (!formData.id.trim() || !formData.name.trim()) {
      useUiStore.getState().showAlert('', 'error')
      return
    }

    const payload: Partial<CampaignAction> = {
      id: formData.id,
      name: formData.name,
      flatformType: formData.flatformType,
      isActive: formData.isActive,
      workflowId: formData.workflowId === '' ? undefined : Number(formData.workflowId)
    }

    try {
      if (editingAction) {
        await updateCampaignAction(editingAction.id, payload)
      } else {
        await createCampaignAction(payload)
      }
      setShowForm(false)
    } catch (err) {
      console.error('Failed to save action:', err)
      useUiStore.getState().showAlert('', 'error')
    }
  }

  return (
    <div className="modal-overlay">
      <div className="campaign-full-modal" style={{ width: '800px', height: '600px' }}>
        <div className="campaign-modal-top" style={{ height: 'auto', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)' }}>
          <h2 className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>Quản lý Hành động Chiến dịch</h2>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="campaign-modal-body" style={{ flexDirection: 'row', overflow: 'hidden' }}>

          {/* Main List */}
          <div className="campaign-grid-container" style={{ flex: 1, padding: 16 }}>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-secondary" style={{ fontSize: 13 }}>Danh sách hành động trong hệ thống</span>
              <button className="btn btn-primary" onClick={handleAddNew} style={{ padding: '4px 12px', fontSize: 12 }}>
                <Plus size={14} style={{ marginRight: 4 }} /> Thêm Hành động
              </button>
            </div>

            <table className="campaign-grid">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tên</th>
                  <th>Nền tảng</th>
                  <th>Workflow</th>
                  <th>Trạng thái</th>
                  <th style={{ width: 60, textAlign: 'center' }}>Ops</th>
                </tr>
              </thead>
              <tbody>
                {allCampaignActions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted" style={{ padding: 24 }}>Chưa có hành động nào</td>
                  </tr>
                ) : (
                  allCampaignActions.map(action => (
                    <tr key={action.id}>
                      <td>{action.id}</td>
                      <td style={{ fontWeight: 500 }}>{action.name}</td>
                      <td><span className="badge">{action.flatformType}</span></td>
                      <td>
                        {action.workflowId ? (
                           <span className="text-success" style={{ fontSize: 11 }}>Đã liên kết</span>
                        ) : (
                          <span className="text-error" style={{ fontSize: 11 }}>Chưa liên kết</span>
                        )}
                      </td>
                      <td>
                        <span style={{ color: action.isActive ? 'var(--accent-success)' : 'var(--text-tertiary)' }}>
                          {action.isActive ? 'Hoạt động' : 'Đã tắt'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          <button className="btn-icon" onClick={() => handleEdit(action)} title="Sửa">
                            <Edit3 size={14} />
                          </button>
                          <button className="btn-icon" onClick={() => handleDelete(action)} title="Xoá">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Form Panel (Side) */}
          {showForm && (
            <div className="campaign-settings-panel" style={{ width: 300, borderLeft: '1px solid var(--border-default)', borderRight: 'none' }}>
              <h3 className="section-title">{editingAction ? 'Sửa hành động' : 'Têm hành động'}</h3>

              <div className="form-group row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <label>ID Hành động (Mã duy nhất, không dấu):</label>
                <input
                  type="text"
                  value={formData.id}
                  onChange={e => setFormData(prev => ({ ...prev, id: e.target.value }))}
                  className="panel-input"
                  style={{ width: '100%' }}
                  disabled={!!editingAction}
                  placeholder="vd: facebook_like"
                />
              </div>

              <div className="form-group row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <label>Tên Hành động:</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="panel-input"
                  style={{ width: '100%' }}
                  placeholder="vd: Facebook - Thích bài viết"
                />
              </div>

              <div className="form-group row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <label>Nền tảng:</label>
                <select
                  value={formData.flatformType}
                  onChange={e => setFormData(prev => ({ ...prev, flatformType: e.target.value }))}
                  className="panel-input"
                  style={{ width: '100%' }}
                >
                  <option value="facebook">Facebook</option>
                  <option value="zalo">Zalo</option>
                  <option value="tiktok">TikTok</option>
                  <option value="shopee">Shopee</option>
                  <option value="other">Khác</option>
                </select>
              </div>

              <div className="form-group row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <label>Workflow Liên Kết:</label>
                <select
                  value={formData.workflowId}
                  onChange={e => setFormData(prev => ({ ...prev, workflowId: e.target.value === '' ? '' : Number(e.target.value) }))}
                  className="panel-input"
                  style={{ width: '100%' }}
                >
                  <option value="">-- Chọn Workflow --</option>
                  {workflows.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <span className="text-secondary" style={{ fontSize: 10, marginTop: 4 }}>
                  Workflow v2 sẽ chạy khi hành động này được gọi.
                </span>
              </div>

              <div className="form-group row" style={{ marginTop: 16 }}>
                <label>Đang hoạt động:</label>
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={e => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 24, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Huỷ</button>
                <button className="btn btn-primary" onClick={handleSubmit}>Lưu Hành Động</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
