import { useState, useEffect } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { Campaign, CampaignDetail } from '../../../../shared/types'

interface CampaignFormModalProps {
  campaign: Campaign | null
  cloneFromId?: number  // original campaign ID when cloning
  onClose: () => void
}

export default function CampaignFormModal({ campaign, cloneFromId, onClose }: CampaignFormModalProps) {
  const {
    accounts, campaignActions,
    createCampaign, updateCampaign,
    createCampaignDetail, loadCampaignDetails
  } = useCampaignStore()

  const initSchedule = () => {
    if (!campaign?.schedule) return ''
    const d = new Date(campaign.schedule)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // Main Campaign Form
  const [formData, setFormData] = useState({
    name: campaign?.name || '',
    actionId: campaign?.actionId || '',
    flatformAccountId: campaign?.flatformAccountId || 0,
    schedule: initSchedule(),
    timeSleepBetween2: campaign?.timeSleepBetween2 ?? 30,
    content: campaign?.content || ''
  })

  // Details Grid
  const [details, setDetails] = useState<Partial<CampaignDetail>[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Load existing details if editing or cloning
  useEffect(() => {
    async function fetchDetails() {
      const loadId = cloneFromId || (campaign && campaign.id ? campaign.id : null)
      if (loadId && window.electronAPI) {
        setLoadingDetails(true)
        try {
          const existingDetails = await window.electronAPI.listCampaignDetails(loadId)
          if (cloneFromId) {
            // Strip ids so they get created as new rows
            setDetails(existingDetails.map(d => ({ ...d, id: undefined, status: 'chờ xử lý' })))
          } else {
            setDetails(existingDetails)
          }
        } catch (err) {
          console.error(err)
        } finally {
          setLoadingDetails(false)
        }
      }
    }
    fetchDetails()
  }, [campaign, cloneFromId])

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.actionId || !formData.flatformAccountId) {
      alert('Vui lòng nhập Tên, Hành động và Tài khoản.')
      return
    }

    try {
      let savedCampaign: Campaign

      if (campaign && campaign.id) {
        // Update existing
        await updateCampaign(campaign.id, {
          name: formData.name,
          actionId: formData.actionId,
          flatformAccountId: formData.flatformAccountId,
          schedule: formData.schedule ? new Date(formData.schedule).toISOString() : undefined,
          timeSleepBetween2: formData.timeSleepBetween2,
          content: formData.content
        })
        savedCampaign = campaign
      } else {
        // Create new (or clone with id=0)
        savedCampaign = await createCampaign({
          name: formData.name,
          actionId: formData.actionId,
          flatformAccountId: formData.flatformAccountId,
          schedule: formData.schedule ? new Date(formData.schedule).toISOString() : undefined,
          timeSleepBetween2: formData.timeSleepBetween2,
          content: formData.content
        })
      }

      // Save new details (only handling inserts for simplicity right now)
      const newDetails = details.filter(d => !d.id)
      for (const d of newDetails) {
        await createCampaignDetail({
          ...d,
          campaignId: savedCampaign.id
        })
      }

      onClose()
    } catch (err) {
      console.error('Failed to save campaign:', err)
      alert('Có lỗi xảy ra khi lưu chiến dịch.')
    }
  }

  const addDetailRow = () => {
    setDetails(prev => [...prev, { name: '', phone: '', uid: '', email: '' }])
  }

  const removeDetailRow = (index: number) => {
    setDetails(prev => {
      const copy = [...prev]
      copy.splice(index, 1)
      return copy
    })
  }

  const updateDetailRow = (index: number, field: keyof CampaignDetail, value: string) => {
    setDetails(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }

  return (
    <div className="modal-overlay">
      <div className="campaign-full-modal">
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">{campaign && campaign.id ? 'Sửa chiến dịch' : campaign ? 'Nhân bản chiến dịch' : 'Thêm chiến dịch'}</span>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Content Body */}
        <div className="modal-body campaign-modal-body">
          {/* Top layout: 2 panels */}
          <div className="campaign-modal-top">
            {/* Left Panel: Settings */}
            <div className="campaign-settings-panel">
              <div className="section-title">Cài đặt chung</div>
              
              <div className="form-group row">
                <label>Chiến dịch</label>
                <select 
                  value={formData.actionId} 
                  onChange={e => setFormData(p => ({ ...p, actionId: e.target.value }))}
                  className="panel-input"
                >
                  <option value="">-- Chọn hành động --</option>
                  {campaignActions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>

              <div className="form-group row">
                <label>Tài khoản</label>
                <select 
                  value={formData.flatformAccountId} 
                  onChange={e => setFormData(p => ({ ...p, flatformAccountId: Number(e.target.value) }))}
                  className="panel-input"
                >
                  <option value={0}>-- Chọn tài khoản --</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.flatformType})</option>)}
                </select>
              </div>

              <div className="form-group row">
                <label>Tên chiến dịch</label>
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  className="panel-input"
                />
              </div>

              <div className="form-group row">
                <label>Thời gian (Hẹn giờ)</label>
                <input 
                  type="datetime-local" 
                  value={formData.schedule} 
                  onChange={e => setFormData(p => ({ ...p, schedule: e.target.value }))}
                  className="panel-input"
                />
              </div>

              <div className="section-title mt-4">Cài đặt giới hạn gửi</div>
              
              <div className="form-group row">
                <label>Thời gian nghỉ giữa 2 lần (giây)</label>
                <input 
                  type="number" 
                  min={0}
                  value={formData.timeSleepBetween2} 
                  onChange={e => setFormData(p => ({ ...p, timeSleepBetween2: Number(e.target.value) }))}
                  className="panel-input number-input"
                />
              </div>
            </div>

            {/* Right Panel: Content */}
            <div className="campaign-content-panel">
              <div className="section-title">Nội dung</div>
              <textarea 
                className="campaign-textarea" 
                placeholder="Nhập nội dung chiến dịch ở đây..."
                value={formData.content}
                onChange={e => setFormData(p => ({ ...p, content: e.target.value }))}
              />
            </div>
          </div>

          {/* Bottom layout: Details Grid */}
          <div className="campaign-modal-bottom">
            <div className="grid-toolbar">
              <button className="btn btn-secondary" onClick={addDetailRow}>Thêm dòng</button>
            </div>
            
            <div className="campaign-grid-container">
              <table className="campaign-grid">
                <thead>
                  <tr>
                    <th>Tên</th>
                    <th>Số điện thoại</th>
                    <th>Uid</th>
                    <th>Email</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {loadingDetails ? (
                    <tr><td colSpan={5} className="text-center">Đang tải data...</td></tr>
                  ) : details.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-muted">Chưa có data nào</td></tr>
                  ) : (
                    details.map((d, i) => (
                      <tr key={d.id || `new-${i}`}>
                        <td>
                          <input type="text" value={d.name || ''} onChange={e => updateDetailRow(i, 'name', e.target.value)} disabled={!!d.id} />
                        </td>
                        <td>
                          <input type="text" value={d.phone || ''} onChange={e => updateDetailRow(i, 'phone', e.target.value)} disabled={!!d.id} />
                        </td>
                        <td>
                          <input type="text" value={d.uid || ''} onChange={e => updateDetailRow(i, 'uid', e.target.value)} disabled={!!d.id} />
                        </td>
                        <td>
                          <input type="text" value={d.email || ''} onChange={e => updateDetailRow(i, 'email', e.target.value)} disabled={!!d.id} />
                        </td>
                        <td>
                          {!d.id && (
                            <button className="btn-icon text-error" onClick={() => removeDetailRow(i)}><Trash2 size={14} /></button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleSave}>Lưu</button>
        </div>
      </div>
    </div>
  )
}
