import { useState, useEffect, useMemo, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus, Trash2, Edit3, RefreshCw, Settings2, Copy, ChevronDown, ChevronUp, Pause, Play, X, Download } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import { Campaign, CampaignDetail } from '../../../../shared/types'
import { utils, writeFile } from 'xlsx'
import CampaignFormModal from './CampaignFormModal'
import ActionManagerModal from './ActionManagerModal'
import AccountInfoView from './AccountInfoView'

interface CampaignPanelProps {
  filterAccountId?: number | null
  onClearFilter?: () => void
  onOpenGeneralSettings?: () => void
}

type DetailTab = 'data' | 'actions' | 'runLog' | 'accountInfo' | 'foundData'
type FoundDataKind = 'phone' | 'zalo' | 'uid' | 'postLink'

interface RunLogEntry {
  key: string
  timestamp: string | undefined
  message: string
}

interface FoundDataPayload {
  phones: string[]
  linkGroupZalos: string[]
  uids: string[]
  postLinks: string[]
  groupMembers: FoundGroupMember[]
  groupUrl: string
  total: number
}

interface FoundGroupMember {
  uid: string
  name: string
  url: string
}

interface FoundDataItem {
  key: string
  kind: FoundDataKind
  label: string
  value: string
  name?: string
  groupUrl: string
  createdAt?: string
}

const FOUND_DATA_TEMPLATE_HEADERS = ['Tên', 'Uid', 'Sđt', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']

const FOUND_DATA_EXPORT_OPTIONS: { kind: FoundDataKind; label: string }[] = [
  { kind: 'phone', label: 'SĐT' },
  { kind: 'uid', label: 'UID' },
  { kind: 'zalo', label: 'Link group Zalo' },
  { kind: 'postLink', label: 'Link bài post' }
]

const DETAIL_DOCK_DEFAULT_HEIGHT = 220
const DETAIL_DOCK_MIN_HEIGHT = 140
const DETAIL_DOCK_MAX_HEIGHT = 900
const DETAIL_DOCK_TOP_RESERVED_HEIGHT = 96

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const canEditCampaign = (status: string) => status === 'chờ xử lý' || status === 'tạm dừng'
const canPauseCampaign = (status: string) => status === 'chờ xử lý' || status === 'đang chạy'
const canResumeCampaign = (status: string) => status === 'tạm dừng'

const formatIpcErrorMessage = (err: unknown, fallback: string): string => {
  const message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : ''

  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback
}

const toStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item || '').trim()).filter(Boolean)
}

const toGroupMemberList = (value: unknown): FoundGroupMember[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const members: FoundGroupMember[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const member = item as { uid?: unknown; name?: unknown; url?: unknown }
    const uid = String(member.uid || '').trim()
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    members.push({
      uid,
      name: String(member.name || '').trim(),
      url: String(member.url || '').trim()
    })
  }
  return members
}

const getFindDataPayload = (detail: CampaignDetail): FoundDataPayload => {
  const data = detail.data || {}
  const phones = toStringList(data.phones)
  const linkGroupZalos = toStringList(data.linkGroupZalos)
  const uids = toStringList(data.uids)
  const postLinks = toStringList(data.postLinks)
  const groupMembers = toGroupMemberList(data.groupMembers)
  const groupUrl = typeof data.groupUrl === 'string' ? data.groupUrl : ''
  return {
    phones,
    linkGroupZalos,
    uids,
    postLinks,
    groupMembers,
    groupUrl,
    total: phones.length + linkGroupZalos.length + uids.length + postLinks.length + groupMembers.length
  }
}

const getFoundDataKindLabel = (kind: FoundDataKind) => {
  switch (kind) {
    case 'phone': return 'Số điện thoại'
    case 'zalo': return 'Link group Zalo'
    case 'uid': return 'UID'
    case 'postLink': return 'Link bài post'
  }
}

const normalizeFoundDataExportValue = (item: FoundDataItem) => {
  const value = String(item.value || '').trim()
  if (item.kind === 'phone') return value.replace(/[\s.\-()+]/g, '')
  if (item.kind === 'postLink') return value.replace(/\/+$/g, '').toLowerCase()
  return value.toLowerCase()
}

const getUniqueFoundDataItems = (items: FoundDataItem[]) => {
  const map = new Map<string, FoundDataItem>()
  for (const item of items) {
    const normalizedValue = normalizeFoundDataExportValue(item)
    if (!normalizedValue) continue
    const key = `${item.kind}:${normalizedValue}`
    const existing = map.get(key)
    if (!existing || (!existing.name && item.name)) {
      map.set(key, item)
    }
  }
  return Array.from(map.values())
}

const formatDisplayDateTime = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'

const formatExportTimestamp = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('')
}

const sanitizeFileSegment = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'campaign'
}

const parseCampaignRunLog = (log: string): RunLogEntry[] => {
  const entries: RunLogEntry[] = []
  const lines = (log || '').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const text = line.trimEnd()
    if (!text.trim()) {
      const lastEntry = entries[entries.length - 1]
      if (lastEntry) lastEntry.message = `${lastEntry.message}\n`
      continue
    }
    const match = text.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (match) {
      entries.push({
        key: `${index}-${text}`,
        timestamp: match[1],
        message: match[2]
      })
      continue
    }

    const lastEntry = entries[entries.length - 1]
    if (lastEntry) {
      lastEntry.message = `${lastEntry.message}\n${text.trimEnd()}`
    } else {
      entries.push({
        key: `${index}-${text}`,
        timestamp: undefined,
        message: text.trim()
      })
    }
  }
  return entries
}

export default function CampaignPanel({ filterAccountId, onClearFilter, onOpenGeneralSettings }: CampaignPanelProps) {
  const {
    accounts, campaigns, campaignActions,
    campaignInputData, loadingCampaignInputData,
    campaignDetails, loadingCampaignDetails,
    loadCampaigns, loadCampaignActions, loadAccounts,
    createCampaign, updateCampaign, deleteCampaign, cloneCampaign,
    bulkUpdateCampaignStatus, bulkDeleteCampaigns,
    loadCampaignInputData, loadCampaignDetails
  } = useCampaignStore()
  const canManageCampaignActions = useAuthStore(s => s.user?.staffId === 1)
  const showAlert = useUiStore(s => s.showAlert)

  const [showForm, setShowForm] = useState(false)
  const [showActionManager, setShowActionManager] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)
  const [cloneFromId, setCloneFromId] = useState<number | undefined>(undefined)
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null)
  const [detailDockOpen, setDetailDockOpen] = useState(true)
  const [detailTab, setDetailTab] = useState<DetailTab>('data')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [detailDockHeight, setDetailDockHeight] = useState(DETAIL_DOCK_DEFAULT_HEIGHT)
  const [foundDataExportKinds, setFoundDataExportKinds] = useState<Set<FoundDataKind>>(
    () => new Set(FOUND_DATA_EXPORT_OPTIONS.map(option => option.kind))
  )

  useEffect(() => {
    loadCampaigns()
    loadCampaignActions()
    loadAccounts()
  }, [loadCampaigns, loadCampaignActions, loadAccounts])

  // Load only the data needed by the active campaign detail tab.
  useEffect(() => {
    if (!selectedCampaignId) return
    if (detailTab === 'data') {
      loadCampaignInputData(selectedCampaignId)
      return
    }
    if (detailTab === 'actions' || detailTab === 'foundData') {
      loadCampaignDetails(selectedCampaignId)
    }
  }, [selectedCampaignId, detailTab, loadCampaignInputData, loadCampaignDetails])

  // Clear bulk selection when account filter changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filterAccountId])

  const handleEdit = (campaign: Campaign) => {
    if (!canEditCampaign(campaign.status)) {
      showAlert('Chỉ có thể sửa chiến dịch khi trạng thái là "chờ xử lý" hoặc "tạm dừng".', 'info')
      return
    }
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
      status: 'tạm dừng',
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
    if (!canPauseCampaign(campaign.status)) {
      showAlert('Chỉ có thể tạm dừng chiến dịch khi trạng thái là "chờ xử lý" hoặc "đang chạy".', 'info')
      return
    }
    try {
      await updateCampaign(campaign.id, { status: 'tạm dừng' })
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tạm dừng chiến dịch.'), 'error')
    }
  }

  const handleResume = async (campaign: Campaign) => {
    if (!canResumeCampaign(campaign.status)) {
      showAlert('Chỉ có thể tiếp tục chiến dịch khi trạng thái là "tạm dừng".', 'info')
      return
    }
    try {
      await updateCampaign(campaign.id, { status: 'chờ xử lý' })
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tiếp tục chiến dịch.'), 'error')
    }
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
      .filter(c => canPauseCampaign(c.status))
      .map(c => c.id)
    if (eligible.length === 0) {
      showAlert('Không có chiến dịch nào có thể tạm dừng. Chỉ có thể tạm dừng chiến dịch "chờ xử lý" hoặc "đang chạy".', 'info')
      return
    }
    setBulkActionLoading(true)
    try {
      await bulkUpdateCampaignStatus(eligible, 'tạm dừng')
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tạm dừng các chiến dịch đã chọn.'), 'error')
    } finally {
      setBulkActionLoading(false)
      setSelectedIds(new Set())
    }
  }

  const handleBulkResume = async () => {
    const eligible = filteredCampaigns
      .filter(c => selectedIds.has(c.id) && canResumeCampaign(c.status))
      .map(c => c.id)
    if (eligible.length === 0) {
      showAlert('Không có chiến dịch nào có thể tiếp tục. Chỉ có thể tiếp tục chiến dịch "tạm dừng".', 'info')
      return
    }
    setBulkActionLoading(true)
    try {
      await bulkUpdateCampaignStatus(eligible, 'chờ xử lý')
    } catch (err) {
      showAlert(formatIpcErrorMessage(err, 'Không thể tiếp tục các chiến dịch đã chọn.'), 'error')
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

  const getDetailStatusLabel = (status: string) => (
    status === 'thành công' ? '✅ Thành công'
      : status === 'thất bại' ? '⚠️ Thất bại'
        : status === 'lỗi' ? '❌ Lỗi'
          : status
  )

  const getCampaignStatusClass = (status: string) => {
    switch (status) {
      case 'chờ xử lý': return 'status-pending'
      case 'đang chạy': return 'status-running'
      case 'hoàn thành': return 'status-completed'
      case 'tạm dừng': return 'status-paused'
      default: return 'status-unknown'
    }
  }

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)
  const selectedCampaignAccount = selectedCampaign?.accountId
    ? accounts.find(account => account.id === selectedCampaign.accountId) || null
    : null
  const isSelectedFindDataCampaign = selectedCampaign?.actionId === 'facebook_find_data_group'
  const runLogEntries = useMemo(
    () => parseCampaignRunLog(selectedCampaign?.log || ''),
    [selectedCampaign?.log]
  )

  const foundDataItems = useMemo<FoundDataItem[]>(() => {
    return campaignDetails.flatMap(detail => {
      const payload = getFindDataPayload(detail)
      if (payload.total === 0) return []
      const groupUrl = payload.groupUrl || '-'
      const createdAt = detail.createdAt
      const memberNameByUid = new Map(payload.groupMembers.map(member => [member.uid, member.name]))
      const memberUidSet = new Set(payload.groupMembers.map(member => member.uid))
      const uidItems = [
        ...[...payload.groupMembers]
          .sort((a, b) => Number(!a.name) - Number(!b.name))
          .map((member, index) => ({
            key: `${detail.id}-uid-member-${index}`,
            kind: 'uid' as const,
            label: getFoundDataKindLabel('uid'),
            value: member.uid,
            name: member.name,
            groupUrl,
            createdAt
          })),
        ...payload.uids
          .filter(value => !memberUidSet.has(value))
          .map((value, index) => ({
            key: `${detail.id}-uid-${index}`,
            kind: 'uid' as const,
            label: getFoundDataKindLabel('uid'),
            value,
            name: memberNameByUid.get(value) || '',
            groupUrl,
            createdAt
          }))
      ]
      return [
        ...payload.phones.map((value, index) => ({
          key: `${detail.id}-phone-${index}`,
          kind: 'phone' as const,
          label: getFoundDataKindLabel('phone'),
          value,
          groupUrl,
          createdAt
        })),
        ...payload.linkGroupZalos.map((value, index) => ({
          key: `${detail.id}-zalo-${index}`,
          kind: 'zalo' as const,
          label: getFoundDataKindLabel('zalo'),
          value,
          groupUrl,
          createdAt
        })),
        ...uidItems,
        ...payload.postLinks.map((value, index) => ({
          key: `${detail.id}-post-link-${index}`,
          kind: 'postLink' as const,
          label: getFoundDataKindLabel('postLink'),
          value,
          groupUrl,
          createdAt
        }))
      ]
    })
  }, [campaignDetails])

  const selectedFoundDataItems = useMemo(() => {
    return foundDataItems.filter(item => foundDataExportKinds.has(item.kind))
  }, [foundDataItems, foundDataExportKinds])

  useEffect(() => {
    if (detailTab === 'foundData' && !isSelectedFindDataCampaign) {
      setDetailTab('actions')
    }
  }, [detailTab, isSelectedFindDataCampaign])

  const toggleFoundDataExportKind = (kind: FoundDataKind) => {
    setFoundDataExportKinds(prev => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const getDetailDockMaxHeight = () => {
    const availableHeight = window.innerHeight - DETAIL_DOCK_TOP_RESERVED_HEIGHT
    return Math.max(DETAIL_DOCK_MIN_HEIGHT, Math.min(DETAIL_DOCK_MAX_HEIGHT, availableHeight))
  }

  const handleDetailDockResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()

    const startY = event.clientY
    const startHeight = detailDockHeight
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault()
      const deltaY = moveEvent.clientY - startY
      setDetailDockHeight(clamp(
        startHeight - deltaY,
        DETAIL_DOCK_MIN_HEIGHT,
        getDetailDockMaxHeight()
      ))
    }

    const stopResize = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize, { once: true })
    window.addEventListener('pointercancel', stopResize, { once: true })
  }

  const renderCampaignDetailLog = (detail: CampaignDetail) => {
    const payload = getFindDataPayload(detail)
    const postUrl = typeof detail.postUrl === 'string' ? detail.postUrl.trim() : ''
    const isFindDataDetail = isSelectedFindDataCampaign && detail.actionName === 'Tìm data'
    if (!isFindDataDetail && payload.total === 0 && !postUrl) {
      return <span className="campaign-detail-log-text">{detail.log || '-'}</span>
    }

    return (
      <div className="find-data-history-cell">
        <div className="campaign-detail-log-text">{detail.log || '-'}</div>
        {postUrl && (
          <a
            className="campaign-detail-post-link"
            href={postUrl}
            target="_blank"
            rel="noreferrer"
            title={postUrl}
          >
            {postUrl}
          </a>
        )}
        {(isFindDataDetail || payload.total > 0) && (
          <div className="find-data-result-chips">
            <span className="find-data-chip find-data-chip-phone">SĐT: {payload.phones.length}</span>
            <span className="find-data-chip find-data-chip-zalo">Link group Zalo: {payload.linkGroupZalos.length}</span>
            <span className="find-data-chip find-data-chip-uid">UID: {payload.uids.length + payload.groupMembers.length}</span>
            <span className="find-data-chip find-data-chip-postLink">Link Post: {payload.postLinks.length}</span>
          </div>
        )}
      </div>
    )
  }

  const getCampaignDetailLogTitle = (detail: CampaignDetail) => {
    const postUrl = typeof detail.postUrl === 'string' ? detail.postUrl.trim() : ''
    return [detail.log || '', postUrl].filter(Boolean).join('\n') || '-'
  }

  const handleExportCampaignDetails = () => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (campaignDetails.length === 0) {
      showAlert('Chưa có lịch sử hành động để xuất.', 'info')
      return
    }

    try {
      const rows = campaignDetails.map((detail, index) => ({
        STT: index + 1,
        'Thời gian': detail.createdAt ? new Date(detail.createdAt).toLocaleString('vi-VN') : '',
        'Hành động': detail.actionName || '',
        'Trạng thái': detail.status,
        'Chi tiết': detail.log || '',
        'Link bài viết': detail.postUrl || ''
      }))
      const sheet = utils.json_to_sheet(rows)
      sheet['!cols'] = [
        { wch: 6 },
        { wch: 22 },
        { wch: 18 },
        { wch: 14 },
        { wch: 70 },
        { wch: 40 }
      ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Lich su hanh dong')
      const name = sanitizeFileSegment(selectedCampaign.name || `campaign-${selectedCampaign.id}`)
      writeFile(workbook, `campaign-history-${selectedCampaign.id}-${name}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất lịch sử hành động ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export campaign details:', err)
      showAlert('Không thể xuất file Excel lịch sử hành động.', 'error')
    }
  }

  const handleExportFoundData = () => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (foundDataExportKinds.size === 0) {
      showAlert('Vui lòng chọn ít nhất một loại data để xuất.', 'error')
      return
    }
    if (selectedFoundDataItems.length === 0) {
      showAlert('Không có data phù hợp với tuỳ chọn xuất.', 'info')
      return
    }

    try {
      const uniqueItems = getUniqueFoundDataItems(selectedFoundDataItems)
      const rows = [
        FOUND_DATA_TEMPLATE_HEADERS,
        ...uniqueItems.map(item => {
          const isPhone = item.kind === 'phone'
          return [
            item.name || '',
            isPhone ? '' : item.value,
            isPhone ? item.value : '',
            '',
            '',
            '',
            '',
            '',
            ''
          ]
        })
      ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = [
        { wch: 24 },
        { wch: 48 },
        { wch: 18 },
        { wch: 28 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 }
      ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Sheet1')
      const name = sanitizeFileSegment(selectedCampaign.name || `campaign-${selectedCampaign.id}`)
      writeFile(workbook, `found-data-${selectedCampaign.id}-${name}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất data tìm được ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export found data:', err)
      showAlert('Không thể xuất file Excel data tìm được.', 'error')
    }
  }

  const handleExportCampaignInputData = () => {
    if (!selectedCampaign) {
      showAlert('Vui lòng chọn chiến dịch trước.', 'error')
      return
    }
    if (campaignInputData.length === 0) {
      showAlert('Chưa có dữ liệu để xuất.', 'info')
      return
    }

    try {
      const rows = [
        FOUND_DATA_TEMPLATE_HEADERS,
        ...campaignInputData.map(item => [
          item.name || '',
          item.uid || '',
          item.phone || '',
          item.email || '',
          '',
          '',
          '',
          '',
          ''
        ])
      ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = [
        { wch: 24 },
        { wch: 48 },
        { wch: 18 },
        { wch: 28 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 }
      ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Sheet1')
      const name = sanitizeFileSegment(selectedCampaign.name || `campaign-${selectedCampaign.id}`)
      writeFile(workbook, `campaign-data-${selectedCampaign.id}-${name}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất dữ liệu ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export campaign input data:', err)
      showAlert('Không thể xuất file Excel dữ liệu.', 'error')
    }
  }

  // Filter campaigns by account if filter is active
  const filteredCampaigns = useMemo(() => {
    if (!filterAccountId) return campaigns
    return campaigns.filter(c => c.accountId === filterAccountId)
  }, [campaigns, filterAccountId])

  const filterAccountName = filterAccountId
    ? accounts.find(a => a.id === filterAccountId)?.name || `ID: ${filterAccountId}`
    : null

  return (
    <div className="campaign-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="campaign-panel-header">
        <span className="campaign-panel-title">Chiến dịch</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {canManageCampaignActions && (
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
      {filterAccountId && (
        <div className="campaign-filter-bar">
          <span>Lọc theo: <strong>{filterAccountName}</strong></span>
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
          onOpenGeneralSettings={onOpenGeneralSettings}
          onClose={() => {
            setShowForm(false)
            setEditingCampaign(null)
            setCloneFromId(undefined)
            loadCampaigns()
            if (selectedCampaignId) loadCampaignInputData(selectedCampaignId)
          }}
        />
      )}

      {showActionManager && canManageCampaignActions && (
        <ActionManagerModal onClose={() => {
          setShowActionManager(false)
          loadCampaignActions()
        }} />
      )}

      {/* Campaign Table */}
      <div className="campaign-panel-content" style={{ flex: 1, minHeight: 0 }}>
        {filteredCampaigns.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">{filterAccountId ? 'Không có chiến dịch cho tài khoản này' : 'Chưa có chiến dịch'}</div></div>
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
              <div className="campaign-col col-account">Tài khoản</div>
              <div className="campaign-col col-status">Trạng thái</div>
              <div className="campaign-col col-schedule">Lịch chạy</div>
              <div className="campaign-col col-note">Ghi chú</div>
              <div className="campaign-col col-ops"></div>
            </div>
            {filteredCampaigns.map(campaign => {
              const actionLabel = campaign.actionName || campaign.actionId
              const accountLabel = campaign.accountName || '-'
              const scheduleLabel = campaign.schedule ? new Date(campaign.schedule).toLocaleString('vi-VN') : '-'

              return (
                <div
                  key={campaign.id}
                  className={`campaign-table-row ${getCampaignStatusClass(campaign.status)} ${selectedCampaignId === campaign.id ? 'selected' : ''} ${selectedIds.has(campaign.id) ? 'multi-selected' : ''}`}
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
                  <div className="campaign-col col-name" title={campaign.name}>
                    <div>{campaign.name}</div>
                  </div>
                  <div className="campaign-col col-action" title={actionLabel}>{actionLabel}</div>
                  <div className="campaign-col col-account" title={accountLabel}>{accountLabel}</div>
                  <div className="campaign-col col-status" title={campaign.status}>
                    <span className="status-badge">
                      {campaign.status}
                    </span>
                  </div>
                  <div className="campaign-col col-schedule" title={scheduleLabel}>
                    {scheduleLabel}
                  </div>
                  <div className="campaign-col col-note" title={campaign.note || ''}>
                    {campaign.note ? (
                      <span className="campaign-note-text">{campaign.note}</span>
                    ) : '-'}
                  </div>
                  <div className="campaign-col col-ops" onClick={e => e.stopPropagation()}>
                    {canPauseCampaign(campaign.status) && (
                      <button className="btn-icon" onClick={() => handlePause(campaign)} title="Tạm dừng">
                        <Pause size={12} />
                      </button>
                    )}
                    {canResumeCampaign(campaign.status) && (
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
              )
            })}
          </div>
        )}
      </div>

      {/* Bottom Detail Dock */}
      {selectedCampaignId && (
        <div
          className="campaign-detail-dock"
          style={detailDockOpen ? { height: detailDockHeight } : undefined}
        >
          {detailDockOpen && (
            <div
              className="detail-dock-resize-handle"
              onPointerDown={handleDetailDockResizeStart}
              role="separator"
              aria-orientation="horizontal"
              title="Kéo để thay đổi chiều cao"
            />
          )}
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
                  Data ban đầu ({campaignInputData.length})
                </button>
                <button
                  className={`detail-dock-tab ${detailTab === 'actions' ? 'active' : ''}`}
                  onClick={() => {
                    setDetailTab('actions')
                    if (selectedCampaignId) loadCampaignDetails(selectedCampaignId)
                  }}
                >
                  Kết quả chạy ({campaignDetails.length})
                </button>
                {isSelectedFindDataCampaign && (
                  <button
                    className={`detail-dock-tab ${detailTab === 'foundData' ? 'active' : ''}`}
                    onClick={() => {
                      setDetailTab('foundData')
                      if (selectedCampaignId) loadCampaignDetails(selectedCampaignId)
                    }}
                  >
                    Data tìm được ({foundDataItems.length})
                  </button>
                )}
                <button
                  className={`detail-dock-tab ${detailTab === 'runLog' ? 'active' : ''}`}
                  onClick={() => setDetailTab('runLog')}
                >
                  Lịch sử chạy ({runLogEntries.length})
                </button>
                <button
                  className={`detail-dock-tab ${detailTab === 'accountInfo' ? 'active' : ''}`}
                  onClick={() => setDetailTab('accountInfo')}
                >
                  Thông tin tài khoản
                </button>
              </div>

              {/* Tab: Campaign Input Data */}
              {detailTab === 'data' && (
                <>
                  <div className="detail-export-bar">
                    <button
                      className="btn btn-secondary"
                      onClick={handleExportCampaignInputData}
                      disabled={loadingCampaignInputData || campaignInputData.length === 0}
                      title="Xuất dữ liệu ra Excel"
                    >
                      <Download size={14} /> Xuất Excel
                    </button>
                  </div>
                  {loadingCampaignInputData ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : campaignInputData.length === 0 ? (
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
                        {campaignInputData.map(d => (
                          <tr key={d.id}>
                            <td title={d.name || '-'}>{d.name || '-'}</td>
                            <td title={d.uid || '-'} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.uid || '-'}</td>
                            <td title={d.phone || '-'}>{d.phone || '-'}</td>
                            <td title={d.email || '-'}>{d.email || '-'}</td>
                            <td title={d.status}>
                              <span style={{ color: getStatusColor(d.status) }}>{d.status}</span>
                            </td>
                            <td title={d.note || '-'} style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.note || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {/* Tab: Campaign Details (per-milestone log) */}
              {detailTab === 'actions' && (
                <>
                  <div className="detail-export-bar">
                    <button
                      className="btn btn-secondary"
                      onClick={handleExportCampaignDetails}
                      disabled={loadingCampaignDetails || campaignDetails.length === 0}
                      title="Xuất lịch sử hành động ra Excel"
                    >
                      <Download size={14} /> Xuất Excel
                    </button>
                  </div>
                  {loadingCampaignDetails ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : campaignDetails.length === 0 ? (
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
                        {campaignDetails.map(a => {
                          const createdAtLabel = formatDisplayDateTime(a.createdAt)
                          const statusLabel = getDetailStatusLabel(a.status)
                          const detailLogTitle = getCampaignDetailLogTitle(a)
                          return (
                            <tr key={a.id}>
                              <td title={createdAtLabel} style={{ whiteSpace: 'nowrap' }}>
                                {createdAtLabel}
                              </td>
                              <td title={a.actionName || '-'}>
                                <strong>{a.actionName}</strong>
                              </td>
                              <td title={statusLabel}>
                                <span style={{ color: getStatusColor(a.status) }}>
                                  {statusLabel}
                                </span>
                              </td>
                              <td className="campaign-detail-log-cell" title={detailLogTitle}>
                                {renderCampaignDetailLog(a)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {/* Tab: Campaign run log from auto_campaigns.log */}
              {detailTab === 'runLog' && (
                runLogEntries.length === 0 ? (
                  <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Chưa có lịch sử chạy</div>
                ) : (
                  <table className="campaign-grid" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>Nội dung</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runLogEntries.map(entry => (
                        <tr key={entry.key}>
                          <td title={entry.timestamp || '-'} style={{ whiteSpace: 'nowrap' }}>{entry.timestamp || '-'}</td>
                          <td className="campaign-detail-log-cell" title={entry.message || '-'}>{entry.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}

              {/* Tab: Account info for the selected campaign */}
              {detailTab === 'accountInfo' && (
                selectedCampaignAccount ? (
                  <AccountInfoView account={selectedCampaignAccount} mode="dock" />
                ) : (
                  <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>
                    Không tìm thấy tài khoản của chiến dịch này
                  </div>
                )
              )}

              {/* Tab: Found data extracted by facebook_find_data_group */}
              {detailTab === 'foundData' && (
                <>
                  <div className="find-data-export-bar">
                    <div className="find-data-export-options">
                      {FOUND_DATA_EXPORT_OPTIONS.map(option => (
                        <label key={option.kind} className="schedule-checkbox-label">
                          <input
                            type="checkbox"
                            checked={foundDataExportKinds.has(option.kind)}
                            onChange={() => toggleFoundDataExportKind(option.kind)}
                            disabled={loadingCampaignDetails}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={handleExportFoundData}
                      disabled={loadingCampaignDetails || selectedFoundDataItems.length === 0}
                      title="Xuất data tìm được ra Excel"
                    >
                      <Download size={14} /> Xuất Excel
                    </button>
                  </div>
                  {loadingCampaignDetails ? (
                    <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
                  ) : foundDataItems.length === 0 ? (
                    <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>Chưa tìm thấy data nào</div>
                  ) : (
                    <table className="campaign-grid find-data-result-grid" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Loại data</th>
                          <th>Giá trị</th>
                          <th>Tên</th>
                          <th>Group</th>
                          <th>Thời gian</th>
                        </tr>
                      </thead>
                      <tbody>
                        {foundDataItems.map(item => {
                          const createdAtLabel = formatDisplayDateTime(item.createdAt)
                          return (
                            <tr key={item.key}>
                              <td title={item.label}>
                                <span className={`find-data-kind find-data-kind-${item.kind}`}>
                                  {item.label}
                                </span>
                              </td>
                              <td className="find-data-value-cell" title={item.value}>{item.value}</td>
                              <td title={item.name || '-'}>{item.name || '-'}</td>
                              <td className="find-data-group-cell" title={item.groupUrl}>{item.groupUrl}</td>
                              <td title={createdAtLabel} style={{ whiteSpace: 'nowrap' }}>
                                {createdAtLabel}
                              </td>
                            </tr>
                          )
                        })}
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
