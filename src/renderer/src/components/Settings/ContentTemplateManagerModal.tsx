import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Edit3, Plus, Search, Trash2, X } from 'lucide-react'
import { ContentTemplate } from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'

interface ContentTemplateManagerModalProps {
  onClose: () => void
}

interface TemplateFormState {
  id: number | null
  name: string
  content: string
}

function formatContentTemplateError(err: unknown, fallback: string): string {
  let message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : ''

  message = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  return message || fallback
}

export default function ContentTemplateManagerModal({ onClose }: ContentTemplateManagerModalProps) {
  const showAlert = useUiStore(s => s.showAlert)
  const showConfirm = useUiStore(s => s.showConfirm)
  const [templates, setTemplates] = useState<ContentTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateForm, setTemplateForm] = useState<TemplateFormState>({ id: null, name: '', content: '' })

  const loadTemplates = async () => {
    if (!window.electronAPI?.listContentTemplates) return
    setTemplatesLoading(true)
    try {
      const rows = await window.electronAPI.listContentTemplates()
      setTemplates(rows)
    } catch (err) {
      showAlert(formatContentTemplateError(err, 'Không thể tải mẫu nội dung.'), 'error')
    } finally {
      setTemplatesLoading(false)
    }
  }

  useEffect(() => {
    void loadTemplates()
  }, [])

  const resetTemplateForm = () => {
    setTemplateForm({ id: null, name: '', content: '' })
  }

  const handleEditTemplate = (template: ContentTemplate) => {
    setTemplateForm({ id: template.id, name: template.name, content: template.content })
  }

  const handleSaveTemplate = async () => {
    const name = templateForm.name.trim()
    const content = templateForm.content.trim()
    if (!name) {
      showAlert('Vui lòng nhập tên mẫu nội dung.', 'error')
      return
    }
    if (!content) {
      showAlert('Vui lòng nhập nội dung mẫu.', 'error')
      return
    }
    if (!window.electronAPI?.createContentTemplate || !window.electronAPI?.updateContentTemplate) {
      showAlert('Tính năng mẫu nội dung chưa sẵn sàng.', 'error')
      return
    }

    setTemplateBusy(true)
    try {
      if (templateForm.id) {
        await window.electronAPI.updateContentTemplate(templateForm.id, { name, content })
        showAlert('Đã cập nhật mẫu nội dung.', 'success')
      } else {
        await window.electronAPI.createContentTemplate({ name, content })
        showAlert('Đã tạo mẫu nội dung.', 'success')
      }
      resetTemplateForm()
      await loadTemplates()
      window.dispatchEvent(new Event('content-templates-updated'))
    } catch (err) {
      showAlert(formatContentTemplateError(err, 'Không thể lưu mẫu nội dung.'), 'error')
    } finally {
      setTemplateBusy(false)
    }
  }

  const handleDeleteTemplate = (template: ContentTemplate) => {
    if (!window.electronAPI?.deleteContentTemplate) {
      showAlert('Tính năng xoá mẫu nội dung chưa sẵn sàng.', 'error')
      return
    }
    showConfirm(
      `Bạn có muốn xoá mẫu nội dung "${template.name}" không?`,
      async () => {
        setTemplateBusy(true)
        try {
          await window.electronAPI.deleteContentTemplate(template.id)
          if (templateForm.id === template.id) resetTemplateForm()
          await loadTemplates()
          window.dispatchEvent(new Event('content-templates-updated'))
          showAlert('Đã xoá mẫu nội dung.', 'success')
        } catch (err) {
          showAlert(formatContentTemplateError(err, 'Không thể xoá mẫu nội dung.'), 'error')
        } finally {
          setTemplateBusy(false)
        }
      },
      { title: 'Xoá mẫu nội dung', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const normalizedTemplateSearch = templateSearch.trim().toLowerCase()
  const filteredTemplates = normalizedTemplateSearch
    ? templates.filter(template =>
      `${template.name}\n${template.content}`.toLowerCase().includes(normalizedTemplateSearch)
    )
    : templates

  return createPortal(
    <div className="modal-overlay general-settings-modal-overlay" onClick={onClose}>
      <div className="general-settings-modal content-template-manager-modal" onClick={event => event.stopPropagation()}>
        <div className="general-settings-header">
          <div>
            <h2>Mẫu nội dung</h2>
            <div className="general-settings-subtitle">Quản lý mẫu nội dung dùng lại trong form chiến dịch</div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="general-settings-content content-template-manager-content">
          <div className="content-template-settings">
            <div className="content-template-editor">
              <div className="content-template-editor-head">
                <div>
                  <div className="content-template-title">
                    {templateForm.id ? 'Sửa mẫu nội dung' : 'Thêm mẫu nội dung'}
                  </div>
                </div>
                {templateForm.id && (
                  <button type="button" className="btn btn-ghost" onClick={resetTemplateForm} disabled={templateBusy}>
                    Hủy sửa
                  </button>
                )}
              </div>
              <div className="content-template-form-grid">
                <div className="content-template-field">
                  <label>Tên mẫu</label>
                  <input
                    className="stepper-input"
                    value={templateForm.name}
                    onChange={event => setTemplateForm(prev => ({ ...prev, name: event.target.value }))}
                    placeholder="Ví dụ: Mẫu nhắn tin chăm sóc"
                    disabled={templateBusy}
                  />
                </div>
                <div className="content-template-field full">
                  <label>Nội dung</label>
                  <textarea
                    className="stepper-textarea content-template-textarea"
                    value={templateForm.content}
                    onChange={event => setTemplateForm(prev => ({ ...prev, content: event.target.value }))}
                    placeholder="Nhập nội dung mẫu. Có thể dùng dấu | để tách nhiều biến thể."
                    disabled={templateBusy}
                    rows={5}
                  />
                </div>
              </div>
              <div className="content-template-editor-actions">
                <button type="button" className="btn btn-primary" onClick={handleSaveTemplate} disabled={templateBusy}>
                  <Plus size={15} />
                  <span>{templateBusy ? 'Đang lưu...' : templateForm.id ? 'Lưu thay đổi' : 'Thêm mẫu'}</span>
                </button>
              </div>
            </div>

            <div className="content-template-list-head">
              <div className="content-template-title">Danh sách mẫu</div>
              <div className="content-template-search">
                <Search size={15} />
                <input
                  value={templateSearch}
                  onChange={event => setTemplateSearch(event.target.value)}
                  placeholder="Tìm mẫu nội dung"
                />
              </div>
            </div>

            <div className="content-template-table-wrap">
              <table className="campaign-grid content-template-table">
                <thead>
                  <tr>
                    <th>Tên mẫu</th>
                    <th>Nội dung</th>
                    <th>Ngày tạo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {templatesLoading ? (
                    <tr><td colSpan={4} className="text-center text-secondary">Đang tải...</td></tr>
                  ) : filteredTemplates.length === 0 ? (
                    <tr><td colSpan={4} className="text-center text-secondary">Chưa có mẫu nội dung.</td></tr>
                  ) : filteredTemplates.map(template => (
                    <tr key={template.id}>
                      <td className="content-template-name">{template.name}</td>
                      <td className="content-template-preview">{template.content}</td>
                      <td>{template.createdAt ? new Date(template.createdAt).toLocaleDateString('vi-VN') : '-'}</td>
                      <td>
                        <div className="content-template-row-actions">
                          <button type="button" className="btn-icon" title="Sửa mẫu" onClick={() => handleEditTemplate(template)} disabled={templateBusy}>
                            <Edit3 size={15} />
                          </button>
                          <button type="button" className="btn-icon danger" title="Xoá mẫu" onClick={() => handleDeleteTemplate(template)} disabled={templateBusy}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
