import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, ChevronUp, ChevronDown, Check, Upload, Calendar, Image, Users } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { Campaign, CampaignDetail, CampaignExtraSettings } from '../../../../shared/types'
import { read, utils } from 'xlsx'
import FriendPickerModal from './FriendPickerModal'
import { useUiStore } from '../../stores/uiStore'

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

const WEEKDAYS = [
  { value: '2', label: 'Thứ 2' },
  { value: '3', label: 'Thứ 3' },
  { value: '4', label: 'Thứ 4' },
  { value: '5', label: 'Thứ 5' },
  { value: '6', label: 'Thứ 6' },
  { value: '7', label: 'Thứ 7' },
  { value: '8', label: 'Chủ nhật' }
]

// Campaign action IDs that don't need detail data (no Section 6) and extra group settings (no Section 5)
const SIMPLE_CAMPAIGN_ACTIONS = new Set([
  'facebook_timeline_post'
])

// Campaign action IDs for "Nhắn tin & Kết bạn" type — hide extra (group), show details, show message/friend toggles
const MESSAGE_FRIEND_ACTIONS = new Set([
  'facebook_message_friend'
])

// Campaign action IDs that show the "Nguồn đăng bài" section (source links, copy content, share, reels)
const TIMELINE_POST_ACTIONS = new Set([
  'facebook_timeline_post'
])

const ALL_STEPS: StepDef[] = [
  {
    id: 'general',
    title: 'Cài đặt chung',
    fields: [
      { key: 'actionId', label: 'Chiến dịch' },
      { key: 'channelIds', label: 'Tài khoản' },
      { key: 'name', label: 'Tên chiến dịch' }
    ]
  },
  {
    id: 'schedule',
    title: 'Lịch chạy',
    fields: [
      { key: 'scheduleType', label: 'Loại lịch' },
      { key: 'schedule', label: 'Ngày chạy' },
      { key: 'scheduleEndDate', label: 'Ngày kết thúc' }
    ]
  },
  {
    id: 'limits',
    title: 'Giới hạn hành động',
    fields: [
      { key: 'timeSleepBetween2', label: 'Nghỉ giữa 2 lần' },
      { key: 'dailyLimit', label: 'Giới hạn ngày' },
      { key: 'rateLimitCount', label: 'Số lần chờ' },
      { key: 'rateLimitMinutes', label: 'Khung thời gian' }
    ]
  },
  {
    id: 'content',
    title: 'Nội dung',
    fields: [
      { key: 'content', label: 'Nội dung chiến dịch' },
      { key: 'images', label: 'Media' }
    ]
  },
  {
    id: 'extra',
    title: 'Cài đặt thêm',
    fields: [
      { key: 'enableComment', label: 'Kiêm comment' }
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
    channels, campaignActions,
    createCampaign, updateCampaign,
    createCampaignDetail, loadCampaignDetails
  } = useCampaignStore()

  const contentRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const txtFileInputRef = useRef<HTMLInputElement>(null)

  const initSchedule = () => {
    if (campaign?.schedule) {
      const d = new Date(campaign.schedule)
      const pad = (n: number) => n.toString().padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  }

  const initEndDate = () => {
    if (campaign?.scheduleEndDate) {
      const d = new Date(campaign.scheduleEndDate)
      const pad = (n: number) => n.toString().padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    // Default to 7 days from now
    const d = new Date()
    d.setDate(d.getDate() + 7)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  const [formData, setFormData] = useState({
    name: campaign?.name || '',
    actionId: campaign?.actionId || '',
    channelIds: campaign?.channelId ? [campaign.channelId] : [] as number[],
    schedule: initSchedule(),
    scheduleType: (campaign?.scheduleType || 'daily') as 'daily' | 'weekly' | 'monthly',
    scheduleEndDate: initEndDate(),
    scheduleDays: campaign?.scheduleDays || '',
    scheduleWeekDays: campaign?.scheduleWeekDays || '',
    continueNextDay: campaign?.continueNextDay ?? true,
    refreshData: campaign?.refreshData ?? true,
    timeSleepBetween2: campaign?.timeSleepBetween2 ?? 30,
    content: campaign?.content || '',
    // Extra settings
    sharePost: campaign?.extraSettings?.sharePost ?? false,
    enableComment: campaign?.extraSettings?.enableComment ?? false,
    commentType: (campaign?.extraSettings?.commentType || 'own') as 'own' | 'others',
    commentCount: campaign?.extraSettings?.commentCount ?? 3,
    commentContent: campaign?.extraSettings?.commentContent || '',
    dailyLimit: campaign?.extraSettings?.actionLimits?.dailyLimit ?? 30,
    rateLimitCount: campaign?.extraSettings?.actionLimits?.rateLimitCount ?? 9,
    rateLimitMinutes: campaign?.extraSettings?.actionLimits?.rateLimitMinutes ?? 60,
    imageOption: (campaign?.extraSettings?.imageOption || 'none') as 'none' | 'all' | 'random',
    randomImageCount: campaign?.extraSettings?.randomImageCount || 3,
    images: campaign?.images || [] as string[],
    splitDataAcrossChannels: false,
    leaveGroupOnPendingApproval: campaign?.extraSettings?.leaveGroupOnPendingApproval ?? false,
    autoJoinGroupAfterPost: campaign?.extraSettings?.autoJoinGroupAfterPost ?? false,
    shuffleGroupList: campaign?.extraSettings?.shuffleGroupList ?? false,
    // Nhắn tin & Kết bạn
    enableMessage: campaign?.extraSettings?.enableMessage ?? true,
    enableAddFriend: campaign?.extraSettings?.enableAddFriend ?? false,
    // Nguồn đăng bài (timeline post)
    copyContentFromSource: campaign?.extraSettings?.copyContentFromSource ?? false,
    includeSourceImages: campaign?.extraSettings?.includeSourceImages ?? false,
    postAsReels: campaign?.extraSettings?.postAsReels ?? false,
    sourceLinks: campaign?.extraSettings?.sourceLinks || ''
  })
  const imageInputRef = useRef<HTMLInputElement>(null)

  // Determine if this is a "simple" campaign (no details/extra sections)
  const isSimpleCampaign = SIMPLE_CAMPAIGN_ACTIONS.has(formData.actionId)
  const isMessageFriendCampaign = MESSAGE_FRIEND_ACTIONS.has(formData.actionId)
  const isTimelinePostCampaign = TIMELINE_POST_ACTIONS.has(formData.actionId)
  const STEPS = isSimpleCampaign
    ? ALL_STEPS.filter(s => s.id !== 'extra' && s.id !== 'details')
    : ALL_STEPS

  const [details, setDetails] = useState<Partial<CampaignDetail>[]>([])
  const [deletedIds, setDeletedIds] = useState<number[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [activeStep, setActiveStep] = useState('general')
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState(false)
  const channelDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(event.target as Node)) {
        setIsChannelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const { showAlert } = useUiStore()

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
  const toggleWeekDay = (day: string) => {
    const days = formData.scheduleWeekDays ? formData.scheduleWeekDays.split(',').filter(Boolean) : []
    const idx = days.indexOf(day)
    if (idx >= 0) {
      days.splice(idx, 1)
    } else {
      days.push(day)
    }
    setFormData(p => ({ ...p, scheduleWeekDays: days.join(',') }))
  }

  const isFieldComplete = (key: string): boolean => {
    switch (key) {
      case 'actionId': return !!formData.actionId
      case 'channelIds': return formData.channelIds.length > 0
      case 'name': return formData.name.trim().length > 0
      case 'schedule': return !!formData.schedule
      case 'scheduleType': return !!formData.scheduleType
      case 'scheduleEndDate': return !!formData.scheduleEndDate
      case 'timeSleepBetween2': return formData.timeSleepBetween2 >= 0
      case 'dailyLimit': return formData.dailyLimit >= 0
      case 'rateLimitCount': return formData.rateLimitCount >= 0
      case 'rateLimitMinutes': return formData.rateLimitMinutes >= 0
      case 'content': return formData.content.trim().length > 0
      case 'sharePost': return true  // optional, always "complete"
      case 'enableComment': return true  // optional
      case 'images': return true  // optional
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
    if (!formData.name.trim() || !formData.actionId || formData.channelIds.length === 0) {
      showAlert('Vui lòng nhập Tên, Hành động và Tài khoản.', 'error')
      return
    }

    try {
      const { deleteCampaignDetail, updateCampaignDetail, createCampaignDetail, createCampaign, updateCampaign } = useCampaignStore.getState()

      for (const id of deletedIds) {
        await deleteCampaignDetail(id)
      }

      let channelChunks: Partial<CampaignDetail>[][] = [];
      const numChannels = formData.channelIds.length;
      
      if (formData.splitDataAcrossChannels && numChannels > 1 && details.length > 0) {
        // Khởi tạo mảng con cho mỗi tài khoản
        for (let i = 0; i < numChannels; i++) {
          channelChunks.push([]);
        }
        // Chia data lần lượt (round-robin)
        for (let i = 0; i < details.length; i++) {
          const channelIndex = i % numChannels;
          channelChunks[channelIndex].push(details[i]);
        }
      } else {
        for (let i = 0; i < numChannels; i++) {
          channelChunks.push(details);
        }
      }

      for (let i = 0; i < numChannels; i++) {
        const channelId = formData.channelIds[i]
        const isFirst = (i === 0)
        const currentDetails = channelChunks[i] || [];

        const campaignPayload = {
          name: formData.name,
          actionId: formData.actionId,
          channelId: channelId,
          schedule: formData.schedule ? new Date(formData.schedule).toISOString() : undefined,
          scheduleType: formData.scheduleType,
          scheduleEndDate: formData.scheduleType === 'daily'
            ? null
            : (formData.scheduleEndDate ? new Date(formData.scheduleEndDate + 'T23:59:59').toISOString() : null),
          scheduleDays: formData.scheduleDays || undefined,
          scheduleWeekDays: formData.scheduleWeekDays || undefined,
          continueNextDay: formData.continueNextDay,
          refreshData: formData.refreshData,
          timeSleepBetween2: formData.timeSleepBetween2,
          content: formData.content,
          extraSettings: {
            sharePost: formData.sharePost,
            enableComment: formData.enableComment,
            commentType: formData.commentType,
            commentCount: formData.commentCount,
            commentContent: formData.commentContent,
            actionLimits: {
              sleepBetweenActions: formData.timeSleepBetween2,
              dailyLimit: formData.dailyLimit,
              rateLimitCount: formData.rateLimitCount,
              rateLimitMinutes: formData.rateLimitMinutes
            },
            imageOption: formData.imageOption,
            randomImageCount: formData.randomImageCount,
            leaveGroupOnPendingApproval: formData.leaveGroupOnPendingApproval,
            autoJoinGroupAfterPost: formData.autoJoinGroupAfterPost,
            shuffleGroupList: formData.shuffleGroupList,
            enableMessage: formData.enableMessage,
            enableAddFriend: formData.enableAddFriend,
            // Nguồn đăng bài (timeline post only)
            copyContentFromSource: formData.copyContentFromSource,
            includeSourceImages: formData.includeSourceImages,
            postAsReels: formData.postAsReels,
            sourceLinks: formData.sourceLinks,
            // Giữ nguyên con trỏ rotation hiện tại (scheduler cập nhật mỗi lần chạy)
            sourceLinkIndex: campaign?.extraSettings?.sourceLinkIndex ?? 0
          } as CampaignExtraSettings,
          images: formData.images
        }

        let savedCampaign: Campaign

        if (campaign && campaign.id && isFirst) {
          await updateCampaign(campaign.id, campaignPayload)
          savedCampaign = campaign
          
          for (const d of currentDetails) {
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
        } else {
          savedCampaign = await createCampaign(campaignPayload)
          
          for (const d of currentDetails) {
            await createCampaignDetail({
              ...d,
              id: undefined,
              campaignId: savedCampaign.id
            })
          }
        }
      }

      showAlert('Lưu chiến dịch thành công!', 'success')
      // Delay closing to let user see the toast
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      console.error('Failed to save campaign:', err)
      showAlert('Có lỗi xảy ra khi lưu chiến dịch.', 'error')
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
        showAlert('Có lỗi xảy ra khi đọc file Excel. Vui lòng kiểm tra lại định dạng file.', 'error')
      }
    }
    reader.readAsBinaryString(file)
    // Clear input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleTxtFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string
        if (!text) return

        // Mảng chứa các UID cắt bằng dấu phẩy hoặc xuống dòng
        const tokens = text.split(/[\r\n,]+/)
        
        const newRows: Partial<CampaignDetail>[] = []
        for (const token of tokens) {
          const uid = token.trim()
          if (!uid) continue

          newRows.push({
            name: '',
            uid: uid,
            phone: '',
            email: '',
            note: '',
            status: 'chờ xử lý'
          })
        }

        if (newRows.length > 0) {
          setDetails(prev => [...prev, ...newRows])
          showAlert(`Đã thêm ${newRows.length} UID từ file TXT.`, 'success')
        } else {
          showAlert('File TXT trống hoặc không có UID hợp lệ.', 'error')
        }
      } catch (err) {
        console.error('Lỗi khi đọc file TXT:', err)
        showAlert('Có lỗi xảy ra khi đọc file TXT.', 'error')
      }
    }
    reader.readAsText(file) // For text files
    if (txtFileInputRef.current) txtFileInputRef.current.value = ''
  }

  const [showFriendPicker, setShowFriendPicker] = useState(false)

  const onFriendsSelected = (contacts: { id: number; name: string; uid?: string }[]) => {
    const newRows: Partial<CampaignDetail>[] = contacts.map(c => ({
      name: c.name,
      uid: c.uid || '',
      phone: '',
      email: '',
      note: '',
      status: 'chờ xử lý'
    }))
    setDetails(prev => [...prev, ...newRows])
    showAlert(`Đã thêm ${newRows.length} bạn bè.`, 'success')
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

                  <div className="stepper-form-group" ref={channelDropdownRef}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ margin: 0 }}>Tài khoản <span className="required">*</span></label>
                      {channels.length > 0 && !(campaign && campaign.id) && (
                        <button 
                          type="button" 
                          className="btn btn-ghost" 
                          style={{ padding: '2px 8px', fontSize: '12px', height: 'auto' }}
                          onClick={() => {
                            const allSelected = formData.channelIds.length === channels.length;
                            setFormData(p => ({
                              ...p,
                              channelIds: allSelected ? [] : channels.map(a => a.id)
                            }));
                          }}
                        >
                          {formData.channelIds.length === channels.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                        </button>
                      )}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <div 
                        className="stepper-input" 
                        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: isChannelDropdownOpen ? 'var(--bg-secondary)' : 'var(--bg-primary)' }}
                        onClick={() => setIsChannelDropdownOpen(!isChannelDropdownOpen)}
                      >
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
                          {formData.channelIds.length === 0 
                            ? '-- Chọn tài khoản --' 
                            : formData.channelIds.length === 1 
                              ? channels.find(a => a.id === formData.channelIds[0])?.name || 'Đã chọn 1 tài khoản'
                              : `Đã chọn ${formData.channelIds.length} tài khoản`}
                        </span>
                        <ChevronDown size={16} style={{ flexShrink: 0, transform: isChannelDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                      
                      {isChannelDropdownOpen && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 10, background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                          <div className="channel-checkbox-list" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', padding: '12px', maxHeight: '250px', overflowY: 'auto' }}>
                            {channels.map(a => (
                              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                                <input
                                  type={campaign && campaign.id ? "radio" : "checkbox"}
                                  name={campaign && campaign.id ? "channel-selection" : undefined}
                                  checked={formData.channelIds.includes(a.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    if (campaign && campaign.id) {
                                      setFormData(p => ({
                                        ...p,
                                        channelIds: [a.id]
                                      }))
                                      setIsChannelDropdownOpen(false) // auto close if it is a radio select
                                    } else {
                                      setFormData(p => ({
                                        ...p,
                                        channelIds: checked 
                                          ? [...p.channelIds, a.id]
                                          : p.channelIds.filter(id => id !== a.id)
                                      }))
                                    }
                                  }}
                                />
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${a.name} (${a.flatformType})`}>{a.name} ({a.flatformType})</span>
                              </label>
                            ))}
                            {channels.length === 0 && (
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '8px 0' }}>Chưa có tài khoản nào</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
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


                </div>
              )}
            </div>

            {/* Section 2: Lịch chạy */}
            <div
              className="stepper-section"
              ref={el => { sectionRefs.current['schedule'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('schedule')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">2</span>
                  <span className="stepper-section-title">Lịch chạy</span>
                </div>
                {collapsedSections['schedule'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['schedule'] && (
                <div className="stepper-section-body">
                  {/* Schedule Type */}
                  <div className="stepper-form-group">
                    <label>Lịch</label>
                    <div className="schedule-radio-group">
                      {([['daily', 'Hàng ngày'], ['weekly', 'Theo tuần'], ['monthly', 'Theo tháng']] as const).map(([value, label]) => (
                        <label key={value} className="schedule-radio-label">
                          <input
                            type="radio"
                            name="scheduleType"
                            value={value}
                            checked={formData.scheduleType === value}
                            onChange={() => setFormData(p => ({ ...p, scheduleType: value }))}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Start date / End date */}
                  <div className="stepper-form-row">
                    <div className="stepper-form-group half">
                      <label>Ngày chạy</label>
                      <input
                        type="datetime-local"
                        value={formData.schedule}
                        onChange={e => setFormData(p => ({ ...p, schedule: e.target.value }))}
                        className="stepper-input"
                      />
                    </div>
                    <div className="stepper-form-group half">
                      <label>Ngày kết thúc</label>
                      <input
                        type="date"
                        value={formData.scheduleEndDate}
                        onChange={e => setFormData(p => ({ ...p, scheduleEndDate: e.target.value }))}
                        className="stepper-input"
                        disabled={formData.scheduleType === 'daily'}
                      />
                    </div>
                  </div>

                  {/* Monthly days */}
                  <div className="stepper-form-group">
                    <label>Lịch tháng</label>
                    <input
                      type="text"
                      value={formData.scheduleDays}
                      onChange={e => setFormData(p => ({ ...p, scheduleDays: e.target.value }))}
                      className="stepper-input"
                      placeholder="Ví dụ: 5,10,19,25"
                      disabled={formData.scheduleType !== 'monthly'}
                    />
                    <span className="schedule-hint">Danh sách ngày chạy, các ngày cách nhau bởi dấu phẩy.</span>
                  </div>

                  {/* Weekly days */}
                  <div className="stepper-form-group">
                    <label>Lịch tuần</label>
                    <div className="schedule-weekday-group">
                      {WEEKDAYS.map(day => {
                        const selectedDays = formData.scheduleWeekDays ? formData.scheduleWeekDays.split(',') : []
                        return (
                          <label key={day.value} className="schedule-checkbox-label">
                            <input
                              type="checkbox"
                              checked={selectedDays.includes(day.value)}
                              onChange={() => toggleWeekDay(day.value)}
                              disabled={formData.scheduleType !== 'weekly'}
                            />
                            <span>{day.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* Conditional checkbox based on schedule type */}
                  {formData.scheduleType === 'daily' && (
                    <div className="stepper-form-group">
                      <label className="schedule-checkbox-label schedule-option-label">
                        <input
                          type="checkbox"
                          checked={formData.continueNextDay}
                          onChange={e => setFormData(p => ({ ...p, continueNextDay: e.target.checked }))}
                        />
                        <span>Nếu chưa chạy hết data do đạt giới hạn, 00h ngày hôm sau sẽ tiếp tục chạy. Nếu chạy hết data sẽ hoàn thành chiến dịch.</span>
                      </label>
                    </div>
                  )}

                  {(formData.scheduleType === 'weekly' || formData.scheduleType === 'monthly') && (
                    <div className="stepper-form-group">
                      <label className="schedule-checkbox-label schedule-option-label">
                        <input
                          type="checkbox"
                          checked={formData.refreshData}
                          onChange={e => setFormData(p => ({ ...p, refreshData: e.target.checked }))}
                        />
                        <span>Dữ liệu sẽ được làm mới lại khi chạy hết data <span className="schedule-hint-inline">(Mặc định là chạy hết sẽ hoàn thành chiến dịch)</span></span>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section 3: Giới hạn hành động */}
            <div
              className="stepper-section"
              ref={el => { sectionRefs.current['limits'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('limits')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">3</span>
                  <span className="stepper-section-title">Giới hạn hành động</span>
                </div>
                {collapsedSections['limits'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['limits'] && (
                <div className="stepper-section-body">
                  <div className="stepper-form-row">
                    <div className="stepper-form-group half">
                      <label>Thời gian nghỉ giữa 2 lần gửi (giây)</label>
                      <input
                        type="number"
                        value={formData.timeSleepBetween2}
                        onChange={e => setFormData(p => ({ ...p, timeSleepBetween2: parseInt(e.target.value) || 0 }))}
                        className="stepper-input"
                      />
                    </div>
                    <div className="stepper-form-group half">
                      <label>Giới hạn trong ngày</label>
                      <input
                        type="number"
                        value={formData.dailyLimit}
                        onChange={e => setFormData(p => ({ ...p, dailyLimit: parseInt(e.target.value) || 0 }))}
                        className="stepper-input"
                      />
                    </div>
                  </div>
                  <div className="stepper-form-row" style={{ marginTop: 12 }}>
                    <div className="stepper-form-group half">
                      <label>Giới hạn số hành động</label>
                      <input
                        type="number"
                        value={formData.rateLimitCount}
                        onChange={e => setFormData(p => ({ ...p, rateLimitCount: parseInt(e.target.value) || 0 }))}
                        className="stepper-input"
                      />
                    </div>
                    <div className="stepper-form-group half">
                      <label>Trong khoảng (phút)</label>
                      <input
                        type="number"
                        value={formData.rateLimitMinutes}
                        onChange={e => setFormData(p => ({ ...p, rateLimitMinutes: parseInt(e.target.value) || 0 }))}
                        className="stepper-input"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Section 4: Nội dung */}
            <div
              className="stepper-section"
              ref={el => { sectionRefs.current['content'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('content')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">4</span>
                  <span className="stepper-section-title">Nội dung</span>
                </div>
                {collapsedSections['content'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['content'] && (
                <div className="stepper-section-body">
                  {/* === Nguồn đăng bài (chỉ hiện cho đăng trang cá nhân) === */}
                  {isTimelinePostCampaign && (
                    <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
                      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.copyContentFromSource}
                            onChange={e => setFormData(p => ({ ...p, copyContentFromSource: e.target.checked }))}
                          />
                          <span>Copy nội dung từ nguồn</span>
                        </label>
                        <label className="schedule-checkbox-label" style={{ opacity: formData.copyContentFromSource ? 1 : 0.5 }}>
                          <input
                            type="checkbox"
                            checked={formData.includeSourceImages}
                            onChange={e => setFormData(p => ({ ...p, includeSourceImages: e.target.checked }))}
                            disabled={!formData.copyContentFromSource}
                          />
                          <span>Lấy kèm hình ảnh</span>
                        </label>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.sharePost}
                            onChange={e => setFormData(p => ({ ...p, sharePost: e.target.checked }))}
                          />
                          <span>Đăng bài bằng cách chia sẻ</span>
                        </label>
                      </div>

                      <div className="stepper-form-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <label style={{ margin: 0 }}>Danh sách uid/link (page, profile, group, post)</label>
                          <span style={{ color: 'var(--text-error)', fontSize: 12 }}>(Mỗi link/uid cách nhau bằng dấu phẩy)</span>
                        </div>
                        <textarea
                          className="stepper-textarea"
                          placeholder="Ví dụ: https://facebook.com/abc, https://facebook.com/xyz/posts/12345, 100012345"
                          value={formData.sourceLinks}
                          onChange={e => setFormData(p => ({ ...p, sourceLinks: e.target.value }))}
                          rows={6}
                        />
                        <div className="schedule-hint" style={{ marginTop: 4 }}>
                          Hệ thống sẽ tự động copy nội dung gần nhất trong link để đăng bài.<br />
                          Nếu có nhiều link, hệ thống sẽ lấy nội dung từ 1 link lần lượt trong danh sách, đảm bảo nội dung không bị trùng lặp.
                        </div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.postAsReels}
                            onChange={e => setFormData(p => ({ ...p, postAsReels: e.target.checked }))}
                          />
                          <span>Đăng Reels <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Đăng video trên Reels)</em></span>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="stepper-form-group">
                    <label>Nội dung chiến dịch</label>
                    <textarea
                      className="stepper-textarea"
                      placeholder={isTimelinePostCampaign && formData.copyContentFromSource
                        ? "Nội dung nhập ở đây sẽ được nối sau nội dung copy từ nguồn (ngăn bằng dòng mới)..."
                        : "Nhập nội dung chiến dịch ở đây. Dùng dấu | để tách nhiều nội dung — nội dung 1 chạy ở mục tiêu 1, nội dung 2 ở mục tiêu 2..."}
                      value={formData.content}
                      onChange={e => setFormData(p => ({ ...p, content: e.target.value }))}
                      rows={8}
                    />
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                      Mẹo: tách nhiều nội dung bằng dấu <code>|</code> — nội dung thứ N sẽ đăng ở group/tin nhắn thứ N (lặp lại từ đầu khi hết biến thể).
                    </div>
                  </div>

                  {/* Media section */}
                  <div style={{ marginTop: 24, borderTop: '1px solid var(--border-default)', paddingTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>Media</div>
                    
                    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                      {/* Left side */}
                      <div style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <button
                          className="btn btn-primary"
                          onClick={() => imageInputRef.current?.click()}
                          style={{ width: 'fit-content', opacity: formData.imageOption === 'none' ? 0.6 : 1 }}
                          disabled={formData.imageOption === 'none'}
                        >
                          Tải hoặc chọn ảnh
                        </button>
                        <input
                          type="file"
                          ref={imageInputRef}
                          style={{ display: 'none' }}
                          accept="image/*"
                          multiple
                          onChange={e => {
                            const files = Array.from(e.target.files || [])
                            const paths = files
                              .map(f => {
                                try {
                                  return window.electronAPI.getPathForFile(f)
                                } catch {
                                  return ''
                                }
                              })
                              .filter(Boolean)
                            if (paths.length < files.length) {
                              showAlert('Một số ảnh không xác định được đường dẫn và đã bị bỏ qua.', 'error')
                            }
                            if (paths.length > 0) {
                              setFormData(p => ({ ...p, images: [...p.images, ...paths] }))
                            }
                            e.target.value = ''
                          }}
                        />

                        <div className="schedule-radio-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
                          <label className="schedule-radio-label">
                            <input
                              type="radio"
                              name="imageOption"
                              checked={formData.imageOption === 'none'}
                              onChange={() => setFormData(p => ({ ...p, imageOption: 'none' }))}
                            />
                            <span>Không gửi ảnh</span>
                          </label>
                          <label className="schedule-radio-label">
                            <input
                              type="radio"
                              name="imageOption"
                              checked={formData.imageOption === 'all'}
                              onChange={() => setFormData(p => ({ ...p, imageOption: 'all' }))}
                            />
                            <span>Gửi ảnh đã chọn</span>
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <label className="schedule-radio-label">
                              <input
                                type="radio"
                                name="imageOption"
                                checked={formData.imageOption === 'random'}
                                onChange={() => setFormData(p => ({ ...p, imageOption: 'random' }))}
                              />
                              <span>Gửi ngẫu nhiên số ảnh trong ảnh đã chọn</span>
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={formData.randomImageCount}
                              onChange={e => setFormData(p => ({ ...p, randomImageCount: Number(e.target.value) }))}
                              className="stepper-input"
                              style={{ width: 60, padding: '4px 8px' }}
                              disabled={formData.imageOption !== 'random'}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Right side - Table */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Ảnh đã chọn</div>
                        <div className="stepper-grid-container" style={{ margin: 0, maxHeight: 300, overflowY: 'auto' }}>
                          <table className="campaign-grid">
                            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                              <tr>
                                <th style={{ width: 50, textAlign: 'center' }}>STT</th>
                                <th>Link</th>
                                <th style={{ width: 40, textAlign: 'center' }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {formData.images.length === 0 ? (
                                <tr>
                                  <td colSpan={3} className="text-center text-muted" style={{ padding: '24px 0' }}>Chưa có ảnh nào được chọn</td>
                                </tr>
                              ) : (
                                formData.images.map((img, idx) => (
                                  <tr key={idx}>
                                    <td className="text-center">{idx + 1}</td>
                                    <td className="text-truncate" style={{ maxWidth: 200 }} title={img}>{img.split(/[\\/]/).pop() || img}</td>
                                    <td className="text-center">
                                      <button
                                        className="btn-icon text-error action-btn"
                                        style={{ display: 'inline-flex' }}
                                        onClick={() => setFormData(p => ({ ...p, images: p.images.filter((_, i) => i !== idx) }))}
                                        title="Xóa"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!isSimpleCampaign && <div
              className="stepper-section"
              ref={el => { sectionRefs.current['extra'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('extra')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">5</span>
                  <span className="stepper-section-title">Cài đặt thêm</span>
                </div>
                {collapsedSections['extra'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['extra'] && (
                <div className="stepper-section-body">

                  {/* === Nhắn tin & Kết bạn toggles (chỉ hiện cho message_friend campaigns) === */}
                  {isMessageFriendCampaign && (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Chọn hành động</div>
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.enableMessage}
                            onChange={e => setFormData(p => ({ ...p, enableMessage: e.target.checked }))}
                          />
                          <span>💬 Nhắn tin cho bạn bè / UID</span>
                        </label>
                      </div>
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.enableAddFriend}
                            onChange={e => setFormData(p => ({ ...p, enableAddFriend: e.target.checked }))}
                          />
                          <span>🤝 Kết bạn với UID</span>
                        </label>
                      </div>
                      {!formData.enableMessage && !formData.enableAddFriend && (
                        <div style={{ color: 'var(--text-error)', fontSize: 12, marginTop: 4 }}>⚠️ Vui lòng chọn ít nhất một hành động.</div>
                      )}
                    </>
                  )}

                  {/* === Group campaign options (ẩn cho message_friend campaigns) === */}
                  {!isMessageFriendCampaign && (
                    <>
                      {/* Share post - tạm ẩn, sẽ mở lại khi implement đầy đủ */}

                      {/* Enable comment */}
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.enableComment}
                            onChange={e => setFormData(p => ({ ...p, enableComment: e.target.checked }))}
                          />
                          <span>Kiêm comment</span>
                        </label>
                      </div>

                      {/* Comment options - only when enableComment */}
                      {formData.enableComment && (
                        <div className="extra-comment-options">
                          <div className="stepper-form-group">
                            <div className="schedule-radio-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                              <label className="schedule-radio-label">
                                <input
                                  type="radio"
                                  name="commentType"
                                  value="own"
                                  checked={formData.commentType === 'own'}
                                  onChange={() => setFormData(p => ({ ...p, commentType: 'own' }))}
                                />
                                <span>Chỉ comment vào bài post của mình</span>
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label className="schedule-radio-label">
                                  <input
                                    type="radio"
                                    name="commentType"
                                    value="others"
                                    checked={formData.commentType === 'others'}
                                    onChange={() => setFormData(p => ({ ...p, commentType: 'others' }))}
                                  />
                                  <span>Comment vào các bài khác trừ bài post của mình với số lượng</span>
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  value={formData.commentCount}
                                  onChange={e => setFormData(p => ({ ...p, commentCount: Number(e.target.value) }))}
                                  className="stepper-input"
                                  style={{ width: 60 }}
                                  disabled={formData.commentType !== 'others'}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="stepper-form-group">
                            <label>Nội dung comment</label>
                            <textarea
                              className="stepper-textarea"
                              placeholder="Nhập nội dung comment. Dùng dấu | để tách nhiều nội dung — comment 1 dùng nội dung 1, comment 2 dùng nội dung 2..."
                              value={formData.commentContent}
                              onChange={e => setFormData(p => ({ ...p, commentContent: e.target.value }))}
                              rows={4}
                            />
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                              Mẹo: tách nhiều nội dung bằng dấu <code>|</code> — comment thứ K trong group dùng nội dung thứ K (lặp lại từ đầu khi hết biến thể).
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Divider */}
                      <div style={{ borderTop: '1px solid var(--border-default)', margin: '16px 0' }} />

                      {/* Leave group on pending approval */}
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.leaveGroupOnPendingApproval}
                            onChange={e => setFormData(p => ({ ...p, leaveGroupOnPendingApproval: e.target.checked }))}
                          />
                          <span>RỜI GROUP chờ duyệt bài đăng <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Nếu đã tham gia)</em></span>
                        </label>
                      </div>

                      {/* Auto join group after post */}
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.autoJoinGroupAfterPost}
                            onChange={e => setFormData(p => ({ ...p, autoJoinGroupAfterPost: e.target.checked }))}
                          />
                          <span>Tự động THAM GIA GROUP sau khi đăng bài thành công và không bị kiểm duyệt <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Nếu chưa tham gia)</em></span>
                        </label>
                      </div>

                      {/* Shuffle group list */}
                      <div className="stepper-form-group">
                        <label className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.shuffleGroupList}
                            onChange={e => setFormData(p => ({ ...p, shuffleGroupList: e.target.checked }))}
                          />
                          <span>XÁO TRỘN DANH SÁCH GROUP trước khi chạy chiến dịch <em style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}>(Thay đổi thứ tự sắp xếp của danh sách group)</em></span>
                        </label>
                        <div className="schedule-hint" style={{ marginTop: 4, marginLeft: 24 }}>
                          Thay vì đăng tuần tự hoặc cố định vào 1 danh sách nhóm, hệ thống sẽ tự động trộn danh sách nhóm và chọn ngẫu nhiên để đăng. Cách này giúp nội dung phân tán tự nhiên hơn, tránh việc bị Facebook đánh giá là spam vì đăng quá dầy đặc vào cùng thời điểm và nhóm giống nhau.
                        </div>
                      </div>
                    </>
                  )}

                </div>
              )}
            </div>}


            {/* Section 6: Danh sách data (hidden for simple campaigns) */}
            {!isSimpleCampaign && <div
              className="stepper-section"
              ref={el => { sectionRefs.current['details'] = el }}
            >
              <div
                className="stepper-section-header"
                onClick={() => toggleSection('details')}
              >
                <div className="stepper-section-header-left">
                  <span className="stepper-section-num">6</span>
                  <span className="stepper-section-title">Danh sách data</span>
                  {details.length > 0 && (
                    <span className="stepper-section-badge">{details.length}</span>
                  )}
                </div>
                {collapsedSections['details'] ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>

              {!collapsedSections['details'] && (
                <div className="stepper-section-body">
                  {formData.channelIds.length > 1 && (
                    <div className="stepper-form-group" style={{ marginBottom: 12 }}>
                      <label className="schedule-checkbox-label" style={{ fontWeight: 500 }}>
                        <input
                          type="checkbox"
                          checked={formData.splitDataAcrossChannels}
                          onChange={e => setFormData(p => ({ ...p, splitDataAcrossChannels: e.target.checked }))}
                        />
                        <span>Chia đều data cho các tài khoản <span className="schedule-hint-inline" style={{ fontWeight: 'normal' }}>(Mặc định là tất cả tài khoản chung 1 data)</span></span>
                      </label>
                    </div>
                  )}
                  <div className="stepper-grid-toolbar" style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={addDetailRow}>
                      <Plus size={14} /> Thêm data
                    </button>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={14} /> Upload Excel
                    </button>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => txtFileInputRef.current?.click()}
                    >
                      <Upload size={14} /> Upload TXT
                    </button>
                    {isMessageFriendCampaign && (
                      <button 
                        className="btn btn-secondary" 
                        onClick={() => {
                          if (formData.channelIds.length === 0) {
                            showAlert('Vui lòng chọn tài khoản trước.', 'error')
                            return
                          }
                          setShowFriendPicker(true)
                        }}
                        title="Chọn bạn bè từ danh sách liên hệ"
                      >
                        <Users size={14} /> Chọn bạn bè
                      </button>
                    )}
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      accept=".xlsx, .xls, .csv"
                      onChange={handleFileUpload}
                      title="Upload Excel"
                    />
                    <input
                      type="file"
                      ref={txtFileInputRef}
                      style={{ display: 'none' }}
                      accept=".txt"
                      onChange={handleTxtFileUpload}
                      title="Upload TXT"
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
                          <tr><td colSpan={5} className="text-center text-muted">Chưa có data nào.</td></tr>
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
            </div>}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleSave}>Lưu chiến dịch</button>
        </div>
      </div>
      {/* Friend Picker Modal */}
      {showFriendPicker && formData.channelIds.length > 0 && (
        <FriendPickerModal
          channelId={formData.channelIds[0]}
          onClose={() => setShowFriendPicker(false)}
          onSelect={onFriendsSelected}
        />
      )}
    </div>
  )
}
