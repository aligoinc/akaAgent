import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, ChevronUp, ChevronDown, Check, Upload } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { Campaign, CampaignDetail } from '../../../../shared/types'
import { read, utils } from 'xlsx'

interface CampaignFormModalProps {
  campaign: Campaign | null
  cloneFromId?: number
  onClose: () => void
}

interface StepDef {
  id: string
  title: string
  fields: { key: string; label: string }[]
}

const STEPS: StepDef[] = [
  {
    id: 'general',
    title: 'Cài đặt chung',
    fields: [
      { key: 'actionId', label: 'Chiến dịch' },
      { key: 'flatformAccountId', label: 'Tài khoản' },
      { key: 'name', label: 'Tên chiến dịch' },
      { key: 'schedule', label: 'Thời gian' },
      { key: 'timeSleepBetween2', label: 'Thời gian nghỉ' }
    ]
  },
  {
    id: 'content',
    title: 'Nội dung',
    fields: [
      { key: 'content', label: 'Nội dung chiến dịch' }
    ]
  },
  {
    id: 'details',
    title: 'Danh sách data',
    fields: [
      { key: 'details', label: 'Data' }
    ]
  }
]

export default function CampaignFormModal({ campaign, cloneFromId, onClose }: CampaignFormModalProps) {
  const {
    accounts, campaignActions,
    createCampaign, updateCampaign,
    createCampaignDetail, loadCampaignDetails
  } = useCampaignStore()

  const contentRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initSchedule = () => {
    if (campaign?.schedule) {
      const d = new Date(campaign.schedule)
      const pad = (n: number) => n.toString().padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    // Default to current time for new or cloned campaigns
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  }

  const [formData, setFormData] = useState({
    name: campaign?.name || '',
    actionId: campaign?.actionId || '',
    flatformAccountId: campaign?.flatformAccountId || 0,
    schedule: initSchedule(),
    timeSleepBetween2: campaign?.timeSleepBetween2 ?? 30,
    content: campaign?.content || ''
  })

  const [details, setDetails] = useState<Partial<CampaignDetail>[]>([])
  const [deletedIds, setDeletedIds] = useState<number[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [activeStep, setActiveStep] = useState('general')
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  useEffect(() => {
    async function fetchDetails() {
      const loadId = cloneFromId || (campaign && campaign.id ? campaign.id : null)
      if (loadId && window.electronAPI) {
        setLoadingDetails(true)
        try {
          const existingDetails = await window.electronAPI.listCampaignDetails(loadId)
          if (cloneFromId) {
            // Clone: strip IDs and reset status, ALSO clear note
            setDetails(existingDetails.map(d => ({ ...d, id: undefined, status: 'chờ xử lý', note: '' })))
          } else {
            setDetails(existingDetails)
            setDeletedIds([])
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

  // Check field completion
  const isFieldComplete = (key: string): boolean => {
    switch (key) {
      case 'actionId': return !!formData.actionId
      case 'flatformAccountId': return formData.flatformAccountId > 0
      case 'name': return formData.name.trim().length > 0
      case 'schedule': return !!formData.schedule
      case 'timeSleepBetween2': return formData.timeSleepBetween2 >= 0
      case 'content': return formData.content.trim().length > 0
      case 'details': return details.length > 0
      default: return false
    }
  }

  const getStepCompletion = (step: StepDef) => {
    const completed = step.fields.filter(f => isFieldComplete(f.key)).length
    return { completed, total: step.fields.length }
  }

  const scrollToSection = (stepId: string) => {
    setActiveStep(stepId)
    const el = sectionRefs.current[stepId]
    if (el && contentRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const toggleSection = (stepId: string) => {
    setCollapsedSections(prev => ({ ...prev, [stepId]: !prev[stepId] }))
  }

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.actionId || !formData.flatformAccountId) {
      setToastMsg({ type: 'error', text: 'Vui lòng nhập Tên, Hành động và Tài khoản.' })
      setTimeout(() => setToastMsg(null), 3000)
      return
    }

    try {
      let savedCampaign: Campaign

      if (campaign && campaign.id) {
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
        savedCampaign = await createCampaign({
          name: formData.name,
          actionId: formData.actionId,
          flatformAccountId: formData.flatformAccountId,
          schedule: formData.schedule ? new Date(formData.schedule).toISOString() : undefined,
          timeSleepBetween2: formData.timeSleepBetween2,
          content: formData.content
        })
      }

      const { deleteCampaignDetail, updateCampaignDetail } = useCampaignStore.getState()

      for (const id of deletedIds) {
        await deleteCampaignDetail(id)
      }

      for (const d of details) {
        if (d.id) {
          await updateCampaignDetail(d.id, {
            name: d.name,
            phone: d.phone,
            uid: d.uid,
            email: d.email,
            note: d.note,
          })
        } else {
          await createCampaignDetail({
            ...d,
            campaignId: savedCampaign.id
          })
        }
      }

      setToastMsg({ type: 'success', text: 'Lưu chiến dịch thành công!' })
      // Delay closing to let user see the toast, and prevent Electron modal focus loss bug
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      console.error('Failed to save campaign:', err)
      setToastMsg({ type: 'error', text: 'Có lỗi xảy ra khi lưu chiến dịch.' })
      setTimeout(() => setToastMsg(null), 3000)
    }
  }

  const addDetailRow = () => {
    setDetails(prev => [...prev, { name: '', phone: '', uid: '', email: '', note: '' }])
  }

  const removeDetailRow = (index: number) => {
    setDetails(prev => {
      const copy = [...prev]
      const removed = copy.splice(index, 1)[0]
      if (removed.id) {
        setDeletedIds(d => [...d, removed.id!])
      }
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        
        // Convert to array of arrays, treating header row as ordinary data for a moment 
        // using header: 1 to get raw 2D array
        const data = utils.sheet_to_json<any[]>(ws, { header: 1 })
        
        // Find index of first data row (skip header if 'Tên', 'Uid', etc. is in A1)
        let startIndex = 0
        if (data.length > 0 && String(data[0][0] || '').toLowerCase().includes('tên')) {
          startIndex = 1
        }

        const newRows: Partial<CampaignDetail>[] = []
        for (let i = startIndex; i < data.length; i++) {
          const row = data[i]
          if (!row || row.length === 0 || row.every((c: any) => !c)) continue // skip empty rows

          // A: Tên (0), B: Uid (1), C: Sđt (2), D: Email (3)
          const name = String(row[0] || '').trim()
          const uid = String(row[1] || '').trim()
          const phone = String(row[2] || '').trim()
          const email = String(row[3] || '').trim()

          newRows.push({
            name,
            uid,
            phone,
            email,
            note: '',
            status: 'chờ xử lý'
          })
        }

        setDetails(prev => [...prev, ...newRows])
      } catch (err) {
        console.error('Lỗi khi đọc file Excel:', err)
        alert('Có lỗi xảy ra khi đọc file Excel. Vui lòng kiểm tra lại định dạng file.')
      }
    }
    reader.readAsBinaryString(file)
    // Clear input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="modal-overlay">
      <div className="campaign-full-modal stepper-modal">
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">
            {campaign && campaign.id ? 'Sửa chiến dịch' : campaign ? 'Nhân bản chiến dịch' : 'Thêm chiến dịch'}
          </span>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {toastMsg && (
          <div style={{
            padding: '10px 16px',
            backgroundColor: toastMsg.type === 'success' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(244, 63, 94, 0.15)',
            color: toastMsg.type === 'success' ? '#34d399' : '#f43f5e',
            borderBottom: '1px solid var(--border-default)',
            fontSize: 13,
            fontWeight: 500
          }}>
            {toastMsg.text}
          </div>
        )}

        {/* Stepper Layout */}
        <div className="stepper-layout">
          {/* Left Sidebar - Stepper Navigation */}
          <div className="stepper-sidebar">
            {STEPS.map((step, stepIndex) => {
              const { completed, total } = getStepCompletion(step)
              const isComplete = completed === total
              const isActive = activeStep === step.id

              return (
                <div
                  key={step.id}
                  className={`stepper-step ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}
                  onClick={() => scrollToSection(step.id)}
                >
                  <div className="stepper-step-header">
                    <div className={`stepper-number ${isComplete ? 'complete' : ''}`}>
                      {isComplete ? <Check size={14} /> : stepIndex + 1}
                    </div>
                    <span className="stepper-step-title">{step.title}</span>
                    <span className="stepper-step-count">{completed} / {total}</span>
                  </div>
                  <div className="stepper-step-fields">
                    {step.fields.map(field => (
                      <div key={field.key} className="stepper-field-item">
                        <div className={`stepper-field-dot ${isFieldComplete(field.key) ? 'complete' : ''}`} />
                        <span className="stepper-field-label">{field.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Right Content */}
          <div className="stepper-content" ref={contentRef}>
            {/* Section 1: Cài đặt chung */}
            <div
              className="stepper-section"
              ref={el => { sectionRefs.current['general'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('general')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">1</span>
                  <span className="stepper-section-title">Cài đặt chung</span>
                </div>
                {collapsedSections['general'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['general'] && (
                <div className="stepper-section-body">
                  <div className="stepper-form-group">
                    <label>Chiến dịch <span className="required">*</span></label>
                    <select
                      value={formData.actionId}
                      onChange={e => setFormData(p => ({ ...p, actionId: e.target.value }))}
                      className="stepper-input"
                    >
                      <option value="">-- Chọn hành động --</option>
                      {campaignActions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>

                  <div className="stepper-form-group">
                    <label>Tài khoản <span className="required">*</span></label>
                    <select
                      value={formData.flatformAccountId}
                      onChange={e => setFormData(p => ({ ...p, flatformAccountId: Number(e.target.value) }))}
                      className="stepper-input"
                    >
                      <option value={0}>-- Chọn tài khoản --</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.flatformType})</option>)}
                    </select>
                  </div>

                  <div className="stepper-form-group">
                    <label>Tên chiến dịch <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                      className="stepper-input"
                      placeholder="Nhập tên chiến dịch..."
                    />
                  </div>

                  <div className="stepper-form-row">
                    <div className="stepper-form-group half">
                      <label>Thời gian (Hẹn giờ)</label>
                      <input
                        type="datetime-local"
                        value={formData.schedule}
                        onChange={e => setFormData(p => ({ ...p, schedule: e.target.value }))}
                        className="stepper-input"
                      />
                    </div>
                    <div className="stepper-form-group half">
                      <label>Thời gian nghỉ giữa 2 lần (giây)</label>
                      <input
                        type="number"
                        min={0}
                        value={formData.timeSleepBetween2}
                        onChange={e => setFormData(p => ({ ...p, timeSleepBetween2: Number(e.target.value) }))}
                        className="stepper-input"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Section 2: Nội dung */}
            <div
              className="stepper-section"
              ref={el => { sectionRefs.current['content'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('content')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">2</span>
                  <span className="stepper-section-title">Nội dung</span>
                </div>
                {collapsedSections['content'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['content'] && (
                <div className="stepper-section-body">
                  <div className="stepper-form-group">
                    <label>Nội dung chiến dịch</label>
                    <textarea
                      className="stepper-textarea"
                      placeholder="Nhập nội dung chiến dịch ở đây..."
                      value={formData.content}
                      onChange={e => setFormData(p => ({ ...p, content: e.target.value }))}
                      rows={8}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Section 3: Danh sách data */}
            <div
              className="stepper-section"
              ref={el => { sectionRefs.current['details'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('details')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">3</span>
                  <span className="stepper-section-title">Danh sách data</span>
                  {details.length > 0 && (
                    <span className="stepper-section-badge">{details.length}</span>
                  )}
                </div>
                {collapsedSections['details'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['details'] && (
                <div className="stepper-section-body">
                  <div className="stepper-grid-toolbar" style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={addDetailRow}>
                      <Plus size={14} /> Thêm dòng
                    </button>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={14} /> Upload Excel
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      accept=".xlsx, .xls, .csv"
                      onChange={handleFileUpload}
                      title="Upload Excel"
                    />
                  </div>

                  <div className="stepper-grid-container">
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
                          <tr><td colSpan={5} className="text-center text-muted">Chưa có data nào. Nhấn "Thêm dòng" hoặc "Upload Excel" để bắt đầu.</td></tr>
                        ) : (
                          details.map((d, i) => (
                            <tr key={d.id || `new-${i}`}>
                              <td>
                                <input type="text" value={d.name || ''} onChange={e => updateDetailRow(i, 'name', e.target.value)} placeholder="Tên..." />
                              </td>
                              <td>
                                <input type="text" value={d.phone || ''} onChange={e => updateDetailRow(i, 'phone', e.target.value)} placeholder="SĐT..." />
                              </td>
                              <td>
                                <input type="text" value={d.uid || ''} onChange={e => updateDetailRow(i, 'uid', e.target.value)} placeholder="UID..." />
                              </td>
                              <td>
                                <input type="text" value={d.email || ''} onChange={e => updateDetailRow(i, 'email', e.target.value)} placeholder="Email..." />
                              </td>
                              <td>
                                <button className="btn-icon text-error" onClick={() => removeDetailRow(i)}><Trash2 size={14} /></button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleSave}>Lưu chiến dịch</button>
        </div>
      </div>
    </div>
  )
}
