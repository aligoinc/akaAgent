import { useEffect, useMemo, useState } from 'react'
import { Edit3, Plus, Save, Trash2, X } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { AutoAccountAction, CampaignAction } from '../../../../shared/types'
import { WorkflowDef } from '../../../../shared/v2Types'

interface ActionManagerModalProps {
  onClose: () => void
}

interface ActionFormData {
  id: string
  name: string
  flatformType: string
  workflowId: number | ''
  testWorkflowId: number | ''
  limitCheckActionCodes: string[]
  allowMultipleAccounts: boolean
  isActive: boolean
}

const emptyForm: ActionFormData = {
  id: '',
  name: '',
  flatformType: 'facebook',
  workflowId: '',
  testWorkflowId: '',
  limitCheckActionCodes: [],
  allowMultipleAccounts: false,
  isActive: true
}

const PLATFORM_OPTIONS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'zalo', label: 'Zalo' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'other', label: 'Khác' }
]

const formatActionCodes = (codes?: string[]) => {
  return codes && codes.length > 0 ? codes.join(', ') : '-'
}

export default function ActionManagerModal({ onClose }: ActionManagerModalProps) {
  const {
    allCampaignActions,
    loadAllCampaignActions,
    createCampaignAction,
    updateCampaignAction,
    deleteCampaignAction
  } = useCampaignStore()
  const user = useAuthStore(state => state.user)
  const updateUseTestWorkflow = useAuthStore(state => state.updateUseTestWorkflow)

  const [workflows, setWorkflows] = useState<WorkflowDef[]>([])
  const [accountActions, setAccountActions] = useState<AutoAccountAction[]>([])
  const [editingAction, setEditingAction] = useState<CampaignAction | null>(null)
  const [formData, setFormData] = useState<ActionFormData>(emptyForm)
  const [isEditing, setIsEditing] = useState(false)
  const [testModeSaving, setTestModeSaving] = useState(false)

  useEffect(() => {
    loadAllCampaignActions()

    if (window.electronAPI?.v2?.listWorkflows) {
      window.electronAPI.v2.listWorkflows().then(setWorkflows).catch(console.error)
    }
    if (window.electronAPI?.listAccountActions) {
      window.electronAPI.listAccountActions(undefined, true).then(setAccountActions).catch(console.error)
    }
  }, [loadAllCampaignActions])

  const visibleAccountActions = useMemo(() => {
    return accountActions.filter(action => action.flatformType === formData.flatformType)
  }, [accountActions, formData.flatformType])

  const selectedCodeSet = useMemo(() => new Set(formData.limitCheckActionCodes), [formData.limitCheckActionCodes])
  const isMobileManagedSmsAction = ['sms_send', 'voice_call'].includes(formData.id.trim())

  const openCreateForm = () => {
    setEditingAction(null)
    setFormData(emptyForm)
    setIsEditing(true)
  }

  const openEditForm = (action: CampaignAction) => {
    setEditingAction(action)
    setFormData({
      id: action.id,
      name: action.name,
      flatformType: action.flatformType,
      workflowId: action.workflowId ?? '',
      testWorkflowId: action.testWorkflowId ?? '',
      limitCheckActionCodes: action.limitCheckActionCodes || [],
      allowMultipleAccounts: action.allowMultipleAccounts ?? false,
      isActive: action.isActive
    })
    setIsEditing(true)
  }

  const handlePlatformChange = (flatformType: string) => {
    const allowedCodes = new Set(accountActions.filter(action => action.flatformType === flatformType).map(action => action.code))
    setFormData(prev => ({
      ...prev,
      flatformType,
      limitCheckActionCodes: prev.limitCheckActionCodes.filter(code => allowedCodes.has(code))
    }))
  }

  const toggleLimitCode = (code: string) => {
    setFormData(prev => {
      const exists = prev.limitCheckActionCodes.includes(code)
      return {
        ...prev,
        limitCheckActionCodes: exists
          ? prev.limitCheckActionCodes.filter(item => item !== code)
          : [...prev.limitCheckActionCodes, code]
      }
    })
  }

  const handleToggleTestMode = async (checked: boolean) => {
    setTestModeSaving(true)
    try {
      await updateUseTestWorkflow(checked)
      useUiStore.getState().showAlert(
        checked ? 'Đã bật chế độ workflow test.' : 'Đã tắt chế độ workflow test.',
        'success'
      )
    } catch (err: any) {
      useUiStore.getState().showAlert(err?.message || 'Không thể lưu chế độ workflow test.', 'error')
    } finally {
      setTestModeSaving(false)
    }
  }

  const handleDelete = (action: CampaignAction) => {
    useUiStore.getState().showConfirm(
      `Xoá hành động "${action.name}"?`,
      async () => {
        try {
          await deleteCampaignAction(action.id)
          if (editingAction?.id === action.id) {
            setEditingAction(null)
            setIsEditing(false)
            setFormData(emptyForm)
          }
        } catch (err) {
          console.error('Failed to delete action:', err)
          useUiStore.getState().showAlert('Không thể xoá hành động chiến dịch.', 'error')
        }
      },
      { title: 'Xoá hành động', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleSubmit = async () => {
    if (!formData.id.trim() || !formData.name.trim()) {
      useUiStore.getState().showAlert('Vui lòng nhập ID và tên hành động.', 'error')
      return
    }
    if (!isMobileManagedSmsAction && formData.workflowId === '') {
      useUiStore.getState().showAlert('Vui lòng chọn workflow chạy thật.', 'error')
      return
    }
    if (!isMobileManagedSmsAction && formData.testWorkflowId === '') {
      useUiStore.getState().showAlert('Vui lòng chọn workflow test.', 'error')
      return
    }

    const payload: Partial<CampaignAction> = {
      id: formData.id.trim(),
      name: formData.name.trim(),
      flatformType: formData.flatformType,
      isActive: formData.isActive,
      workflowId: formData.workflowId === '' ? undefined : Number(formData.workflowId),
      testWorkflowId: formData.testWorkflowId === '' ? undefined : Number(formData.testWorkflowId),
      allowMultipleAccounts: formData.allowMultipleAccounts,
      limitCheckActionCodes: formData.limitCheckActionCodes
    }

    try {
      if (editingAction) {
        await updateCampaignAction(editingAction.id, payload)
      } else {
        const created = await createCampaignAction(payload)
        setEditingAction(created)
      }
      setIsEditing(false)
    } catch (err) {
      console.error('Failed to save action:', err)
      useUiStore.getState().showAlert('Không thể lưu hành động chiến dịch.', 'error')
    }
  }

  return (
    <div className="modal-overlay">
      <div className="action-manager-modal">
        <div className="action-manager-header">
          <div>
            <h2>Quản lý Hành động Chiến dịch</h2>
            <span>{allCampaignActions.length} hành động</span>
          </div>
          <button className="btn-icon" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </div>

        {user?.isAdminAkabiz && (
          <div className="action-manager-mode-bar">
            <div className="action-manager-mode-copy">
              <strong>Chạy bằng workflow test</strong>
              <span>Khi bật, campaign của tài khoản admin hiện tại sẽ dùng workflow test.</span>
            </div>
            <label className="action-manager-mode-toggle">
              <input
                type="checkbox"
                checked={!!user.useTestWorkflow}
                onChange={event => handleToggleTestMode(event.target.checked)}
                disabled={testModeSaving}
              />
              <span>{testModeSaving ? 'Đang lưu...' : user.useTestWorkflow ? 'Đang bật' : 'Đang tắt'}</span>
            </label>
          </div>
        )}

        <div className="action-manager-body">
          <div className="action-manager-list-pane">
            <div className="action-manager-list-toolbar">
              <strong>Danh sách</strong>
              <button className="btn btn-primary btn-sm" onClick={openCreateForm}>
                <Plus size={13} /> Thêm
              </button>
            </div>

            <div className="action-manager-list">
              {allCampaignActions.length === 0 ? (
                <div className="action-manager-empty">Chưa có hành động nào</div>
              ) : (
                allCampaignActions.map(action => (
                  <button
                    key={action.id}
                    className={`action-manager-list-item ${editingAction?.id === action.id ? 'active' : ''}`}
                    onClick={() => openEditForm(action)}
                  >
                    <div className="action-manager-list-item-main">
                      <span>{action.name}</span>
                      <code>{action.id}</code>
                    </div>
                    <div className="action-manager-list-item-meta">
                      <span>{action.flatformType}</span>
                      <span className={action.isActive ? 'text-success' : 'text-muted'}>
                        {action.isActive ? 'Bật' : 'Tắt'}
                      </span>
                      <span>{action.allowMultipleAccounts === false ? '1 tài khoản' : 'Nhiều tài khoản'}</span>
                    </div>
                    <div className="action-manager-code-line">
                      {formatActionCodes(action.limitCheckActionCodes)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="action-manager-editor-pane">
            {!isEditing ? (
              <div className="action-manager-editor-empty">
                <Edit3 size={22} />
                <span>Chọn một hành động để sửa hoặc tạo hành động mới.</span>
              </div>
            ) : (
              <>
                <div className="action-manager-editor-header">
                  <div>
                    <h3>{editingAction ? 'Sửa hành động' : 'Thêm hành động'}</h3>
                    <span>{formData.id || 'Hành động mới'}</span>
                  </div>
                  {editingAction && (
                    <button className="btn-icon text-error" onClick={() => handleDelete(editingAction)} title="Xoá">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <div className="action-manager-form">
                  <div className="action-manager-form-grid">
                    <div className="form-group">
                      <label>ID</label>
                      <input
                        type="text"
                        value={formData.id}
                        onChange={e => setFormData(prev => ({ ...prev, id: e.target.value }))}
                        className="panel-input"
                        disabled={!!editingAction}
                        placeholder="facebook_group_post"
                      />
                    </div>

                    <div className="form-group">
                      <label>Tên</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        className="panel-input"
                        placeholder="Facebook - Đăng bài vào group"
                      />
                    </div>

                    <div className="form-group">
                      <label>Nền tảng</label>
                      <select
                        value={formData.flatformType}
                        onChange={e => handlePlatformChange(e.target.value)}
                        className="panel-input"
                      >
                        {PLATFORM_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Workflow chạy thật</label>
                      <select
                        value={formData.workflowId}
                        onChange={e => setFormData(prev => ({ ...prev, workflowId: e.target.value === '' ? '' : Number(e.target.value) }))}
                        className="panel-input"
                      >
                        <option value="">Chưa liên kết</option>
                        {workflows.map(workflow => (
                          <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Workflow test</label>
                      <select
                        value={formData.testWorkflowId}
                        onChange={e => setFormData(prev => ({ ...prev, testWorkflowId: e.target.value === '' ? '' : Number(e.target.value) }))}
                        className="panel-input"
                      >
                        <option value="">Chưa liên kết</option>
                        {workflows.map(workflow => (
                          <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="action-manager-toggle-group">
                    <label className="action-manager-toggle">
                      <input
                        type="checkbox"
                        checked={formData.isActive}
                        onChange={e => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                      />
                      <span>Đang hoạt động</span>
                    </label>

                    <label className="action-manager-toggle">
                      <input
                        type="checkbox"
                        checked={formData.allowMultipleAccounts}
                        onChange={e => setFormData(prev => ({ ...prev, allowMultipleAccounts: e.target.checked }))}
                      />
                      <span>Cho phép chọn nhiều tài khoản</span>
                    </label>
                  </div>

                  <div className="action-code-picker-block">
                    <div className="action-code-picker-title">
                      <strong>Check quota ngày/giờ</strong>
                      <span>{formData.limitCheckActionCodes.length} action</span>
                    </div>
                    <div className="action-code-picker">
                      {visibleAccountActions.length === 0 ? (
                        <div className="action-manager-empty">Chưa có action code cho nền tảng này</div>
                      ) : (
                        visibleAccountActions.map(action => (
                          <label
                            key={action.code}
                            className={`action-code-option ${selectedCodeSet.has(action.code) ? 'selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedCodeSet.has(action.code)}
                              onChange={() => toggleLimitCode(action.code)}
                            />
                            <span>{action.name}</span>
                            <code>{action.code}</code>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="action-manager-footer">
                  <button className="btn btn-ghost" onClick={() => setIsEditing(false)}>Huỷ</button>
                  <button className="btn btn-primary" onClick={handleSubmit}>
                    <Save size={14} /> Lưu
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
