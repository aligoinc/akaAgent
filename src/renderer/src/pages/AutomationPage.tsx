import {
  ArrowDown,
  ArrowUp,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  Database,
  Edit3,
  FilterX,
  GripHorizontal,
  ListRestart,
  Loader2,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UsersRound,
  Zap
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AutomationFormModal from '../components/Automation/AutomationFormModal'
import {
  formatAutomationScheduleLabel,
  formatAutomationTriggerLabel,
  getAutomationTriggerIdentityKey
} from '../components/Automation/automationDisplay'
import type {
  Automation,
  AutomationDataType,
  AutomationDetail,
  AutomationOptions,
  AutomationSortField
} from '../components/Automation/automationTypes'
import { getAutomationApi } from '../components/Automation/automationTypes'
import { useUiStore } from '../stores/uiStore'
import '../styles/automation.css'

interface AutomationPageProps {
  isActive: boolean
}

interface AutomationFilters {
  search: string
  isActive: '' | 'true' | 'false'
  dataType: '' | AutomationDataType
  sourceCampaignId: string
  targetCampaignId: string
  updatedFrom: string
}

interface SortState {
  field: AutomationSortField
  direction: 'asc' | 'desc'
}

type DetailTab = 'info' | 'data'
type ModalState = { mode: 'create' | 'edit'; automation: Automation | null } | null

const PAGE_SIZE = 10
const DETAIL_PAGE_SIZE = 20
const POLL_INTERVAL_MS = 10_000
const DETAIL_DOCK_MIN_HEIGHT = 180
const DETAIL_DOCK_DEFAULT_HEIGHT = 365

const EMPTY_OPTIONS: AutomationOptions = {
  actions: [],
  campaigns: [],
  triggerOptions: [],
  contactGroups: [],
  dataGroups: []
}

const DEFAULT_FILTERS: AutomationFilters = {
  search: '',
  isActive: '',
  dataType: '',
  sourceCampaignId: '',
  targetCampaignId: '',
  updatedFrom: ''
}

const DATA_TYPE_LABELS: Record<AutomationDataType, string> = {
  phone: 'Số điện thoại',
  email: 'Email',
  zalo_uid: 'UID Zalo',
  facebook_uid: 'UID Facebook'
}

const ACTION_FALLBACKS: AutomationOptions['actions'] = [
  {
    id: 'campaign_detail_route',
    name: 'Theo trạng thái chiến dịch',
    description: 'Chuyển dữ liệu từ chiến dịch nguồn đến chiến dịch đích, Nhóm data, hoặc cả hai.',
    isAvailable: true,
    isActive: true,
    sortOrder: 1
  },
  {
    id: 'zalo_friend_status_check',
    name: 'Kiểm tra bạn bè Zalo',
    description: 'Kiểm tra trạng thái bạn bè của người đã gửi lời mời.',
    isAvailable: false,
    isActive: true,
    sortOrder: 2
  },
  {
    id: 'akaagent_campaign_notification',
    name: 'Nhận thông báo chiến dịch',
    description: 'Nhận thông báo kết quả chiến dịch từ akaAgent.',
    isAvailable: false,
    isActive: true,
    sortOrder: 3
  }
]

const ACTION_ICONS = {
  campaign_detail_route: ListRestart,
  zalo_friend_status_check: UsersRound,
  akaagent_campaign_notification: Bell
} as const

const formatError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error || '')
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback
}

const formatDateTime = (value?: string | null, fallback = '—'): string => {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh'
  }).format(date)
}

const getExecutionTone = (status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' => {
  if (status === 'đã thêm') return 'success'
  if (status === 'lỗi') return 'error'
  if (status === 'bỏ qua') return 'warning'
  if (status === 'đang xử lý') return 'info'
  return 'neutral'
}

const isDocumentVisible = () => document.visibilityState === 'visible'

function SortableHeader({
  field,
  label,
  sort,
  onSort
}: {
  field: AutomationSortField
  label: string
  sort: SortState
  onSort: (field: AutomationSortField) => void
}) {
  const active = sort.field === field
  return (
    <button
      type="button"
      className={`automation-sort-button ${active ? 'active' : ''}`}
      onClick={() => onSort(field)}
      aria-label={`Sắp xếp theo ${label}`}
    >
      {label}
      {active
        ? sort.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
        : <ChevronsUpDown size={13} />}
    </button>
  )
}

export default function AutomationPage({ isActive }: AutomationPageProps) {
  const pageRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const optionsRequestGenerationRef = useRef(0)
  const listRequestGenerationRef = useRef(0)
  const detailRequestGenerationRef = useRef(0)
  const [options, setOptions] = useState<AutomationOptions>(EMPTY_OPTIONS)
  const [optionsLoaded, setOptionsLoaded] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [optionsError, setOptionsError] = useState('')
  const [items, setItems] = useState<Automation[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [listError, setListError] = useState('')
  const [filters, setFilters] = useState<AutomationFilters>(DEFAULT_FILTERS)
  const [searchDraft, setSearchDraft] = useState('')
  const [sort, setSort] = useState<SortState>({ field: 'lastDataAt', direction: 'desc' })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('data')
  const [details, setDetails] = useState<AutomationDetail[]>([])
  const [detailTotal, setDetailTotal] = useState(0)
  const [detailPage, setDetailPage] = useState(1)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [dockHeight, setDockHeight] = useState(DETAIL_DOCK_DEFAULT_HEIGHT)
  const [dockCollapsed, setDockCollapsed] = useState(false)
  const [modal, setModal] = useState<ModalState>(null)
  const [rowMenuId, setRowMenuId] = useState<number | null>(null)
  const [busyAction, setBusyAction] = useState<'active' | 'delete' | 'edit' | null>(null)

  const selected = useMemo(
    () => items.find(item => item.id === selectedId) || null,
    [items, selectedId]
  )
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const detailTotalPages = Math.max(1, Math.ceil(detailTotal / DETAIL_PAGE_SIZE))
  const visibleStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const visibleEnd = Math.min(total, page * PAGE_SIZE)
  const listRequestKey = JSON.stringify({ page, filters, sort })
  const detailRequestKey = `${selectedId ?? 'none'}:${detailPage}`
  const latestListRequestKeyRef = useRef(listRequestKey)
  const latestDetailRequestKeyRef = useRef(detailRequestKey)
  latestListRequestKeyRef.current = listRequestKey
  latestDetailRequestKeyRef.current = detailRequestKey
  const actionItems = useMemo(
    () => (options.actions.length > 0 ? options.actions : ACTION_FALLBACKS)
      .filter(action => action.isActive)
      .sort((left, right) => left.sortOrder - right.sortOrder),
    [options.actions]
  )

  const campaignById = useMemo(
    () => new Map(options.campaigns.map(campaign => [campaign.id, campaign])),
    [options.campaigns]
  )
  const groupById = useMemo(
    () => new Map(options.contactGroups.map(group => [group.id, group])),
    [options.contactGroups]
  )
  const dataGroupById = useMemo(
    () => new Map(options.dataGroups.map(group => [group.id, group])),
    [options.dataGroups]
  )

  const loadOptions = useCallback(async () => {
    const requestGeneration = ++optionsRequestGenerationRef.current
    setOptionsLoading(true)
    try {
      const nextOptions = await getAutomationApi().getAutomationOptions()
      if (requestGeneration !== optionsRequestGenerationRef.current) return
      setOptions(nextOptions)
      setOptionsLoaded(true)
      setOptionsError('')
    } catch (loadError) {
      if (requestGeneration !== optionsRequestGenerationRef.current) return
      setOptionsLoaded(false)
      setOptionsError(formatError(loadError, 'Không thể tải dữ liệu cấu hình tự động hóa.'))
    } finally {
      if (requestGeneration === optionsRequestGenerationRef.current) setOptionsLoading(false)
    }
  }, [])

  const loadAutomations = useCallback(async (silent = false) => {
    const requestKey = JSON.stringify({ page, filters, sort })
    if (requestKey !== latestListRequestKeyRef.current) return
    const requestGeneration = ++listRequestGenerationRef.current
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const result = await getAutomationApi().listAutomations({
        page,
        pageSize: PAGE_SIZE,
        search: filters.search || undefined,
        isActive: filters.isActive ? filters.isActive === 'true' : undefined,
        dataType: filters.dataType || undefined,
        sourceCampaignId: filters.sourceCampaignId ? Number(filters.sourceCampaignId) : undefined,
        targetCampaignId: filters.targetCampaignId ? Number(filters.targetCampaignId) : undefined,
        updatedFrom: filters.updatedFrom || undefined,
        sortBy: sort.field,
        sortDirection: sort.direction
      })
      if (
        requestGeneration !== listRequestGenerationRef.current
        || requestKey !== latestListRequestKeyRef.current
      ) return
      setItems(result.items)
      setTotal(result.total)
      setListError('')
      setSelectedId(current => {
        if (current && result.items.some(item => item.id === current)) return current
        return result.items[0]?.id ?? null
      })
      const nextTotalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
      if (page > nextTotalPages) setPage(nextTotalPages)
    } catch (loadError) {
      if (
        requestGeneration !== listRequestGenerationRef.current
        || requestKey !== latestListRequestKeyRef.current
      ) return
      setListError(formatError(loadError, 'Không thể tải danh sách tự động hóa.'))
    } finally {
      if (
        requestGeneration === listRequestGenerationRef.current
        && requestKey === latestListRequestKeyRef.current
      ) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [filters, page, sort])

  const loadDetails = useCallback(async (automationId: number, silent = false) => {
    const requestedPage = detailPage
    const requestKey = `${automationId}:${requestedPage}`
    if (requestKey !== latestDetailRequestKeyRef.current) return
    const requestGeneration = ++detailRequestGenerationRef.current
    if (!silent) setDetailLoading(true)
    setDetailError('')
    try {
      const result = await getAutomationApi().listAutomationDetails(automationId, {
        page: requestedPage,
        pageSize: DETAIL_PAGE_SIZE
      })
      if (
        requestGeneration !== detailRequestGenerationRef.current
        || requestKey !== latestDetailRequestKeyRef.current
      ) return
      setDetails(result.items)
      setDetailTotal(result.total)
      const nextTotalPages = Math.max(1, Math.ceil(result.total / DETAIL_PAGE_SIZE))
      if (requestedPage > nextTotalPages) setDetailPage(nextTotalPages)
    } catch (loadError) {
      if (
        requestGeneration !== detailRequestGenerationRef.current
        || requestKey !== latestDetailRequestKeyRef.current
      ) return
      setDetailError(formatError(loadError, 'Không thể tải dữ liệu kích hoạt.'))
    } finally {
      if (
        requestGeneration === detailRequestGenerationRef.current
        && requestKey === latestDetailRequestKeyRef.current
      ) setDetailLoading(false)
    }
  }, [detailPage])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setFilters(previous => ({ ...previous, search: searchDraft.trim() }))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchDraft])

  useEffect(() => {
    if (!isActive) return
    const handleSearchShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditing = target?.matches('input, textarea, select, [contenteditable="true"]')
      if (event.key === '/' && !isEditing) {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleSearchShortcut)
    return () => document.removeEventListener('keydown', handleSearchShortcut)
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    if (!optionsLoaded && !optionsLoading && !optionsError) void loadOptions()
  }, [isActive, loadOptions, optionsError, optionsLoaded, optionsLoading])

  useEffect(() => {
    if (!isActive) return
    void loadAutomations()
  }, [isActive, loadAutomations])

  useEffect(() => {
    setDetailPage(1)
  }, [selectedId])

  useEffect(() => {
    if (!isActive || !selectedId) {
      detailRequestGenerationRef.current += 1
      setDetails([])
      setDetailTotal(0)
      setDetailError('')
      setDetailLoading(false)
      return
    }
    setDetails([])
    setDetailTotal(0)
    setDetailError('')
    void loadDetails(selectedId)
  }, [isActive, loadDetails, selectedId])

  useEffect(() => () => {
    optionsRequestGenerationRef.current += 1
    listRequestGenerationRef.current += 1
    detailRequestGenerationRef.current += 1
  }, [])

  useEffect(() => {
    if (!isActive) return
    const api = getAutomationApi()
    if (typeof api.onAutomationUpdated !== 'function') return
    return api.onAutomationUpdated(payload => {
      void loadAutomations(true)
      if (selectedId && (!payload.automationId || payload.automationId === selectedId)) {
        void loadDetails(selectedId, true)
      }
    })
  }, [isActive, loadAutomations, loadDetails, selectedId])

  useEffect(() => {
    if (!isActive) return
    const poll = () => {
      if (!isDocumentVisible()) return
      void loadAutomations(true)
      if (selectedId) void loadDetails(selectedId, true)
    }
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    const handleVisibility = () => {
      if (isDocumentVisible()) poll()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [isActive, loadAutomations, loadDetails, selectedId])

  useEffect(() => {
    const closeMenu = () => setRowMenuId(null)
    if (rowMenuId !== null) {
      document.addEventListener('click', closeMenu)
      return () => document.removeEventListener('click', closeMenu)
    }
  }, [rowMenuId])

  const refreshAll = async () => {
    await Promise.all([
      loadOptions(),
      loadAutomations(true),
      selectedId ? loadDetails(selectedId, true) : Promise.resolve()
    ])
  }

  const handleSort = (field: AutomationSortField) => {
    setPage(1)
    setSort(previous => previous.field === field
      ? { field, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
      : { field, direction: field === 'name' ? 'asc' : 'desc' })
  }

  const updateFilter = <K extends keyof AutomationFilters>(key: K, value: AutomationFilters[K]) => {
    setPage(1)
    setFilters(previous => ({ ...previous, [key]: value }))
  }

  const clearFilters = () => {
    setSearchDraft('')
    setFilters(DEFAULT_FILTERS)
    setPage(1)
  }

  const openEdit = async (automationId: number) => {
    setBusyAction('edit')
    setRowMenuId(null)
    try {
      const automation = await getAutomationApi().getAutomation(automationId)
      setModal({ mode: 'edit', automation })
    } catch (editError) {
      useUiStore.getState().showAlert(formatError(editError, 'Không thể tải tự động hóa để chỉnh sửa.'), 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const setActive = async (automation: Automation, nextActive: boolean) => {
    setBusyAction('active')
    try {
      await getAutomationApi().setAutomationActive(automation.id, nextActive)
      useUiStore.getState().showAlert(
        nextActive ? 'Đã chạy tự động hóa.' : 'Đã dừng tự động hóa.',
        'success'
      )
      await loadAutomations(true)
    } catch (activeError) {
      useUiStore.getState().showAlert(formatError(activeError, 'Không thể đổi trạng thái tự động hóa.'), 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const requestDelete = (automation: Automation) => {
    setRowMenuId(null)
    useUiStore.getState().showConfirm(
      `Xóa tự động hóa “${automation.name}”? Dữ liệu lịch sử vẫn được giữ để đối soát.`,
      async () => {
        setBusyAction('delete')
        try {
          await getAutomationApi().deleteAutomation(automation.id)
          useUiStore.getState().showAlert('Đã xóa tự động hóa.', 'success')
          if (selectedId === automation.id) setSelectedId(null)
          await loadAutomations(true)
        } catch (deleteError) {
          useUiStore.getState().showAlert(formatError(deleteError, 'Không thể xóa tự động hóa.'), 'error')
        } finally {
          setBusyAction(null)
        }
      },
      { title: 'Xóa tự động hóa', confirmText: 'Xóa', variant: 'danger' }
    )
  }

  const startDockResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (dockCollapsed) setDockCollapsed(false)
    const startY = event.clientY
    const startHeight = dockHeight
    const handleMove = (moveEvent: PointerEvent) => {
      const containerHeight = pageRef.current?.clientHeight || window.innerHeight
      const maxHeight = Math.max(DETAIL_DOCK_MIN_HEIGHT, containerHeight - 300)
      setDockHeight(Math.min(maxHeight, Math.max(DETAIL_DOCK_MIN_HEIGHT, startHeight + startY - moveEvent.clientY)))
    }
    const handleUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  const hasFilters = Object.values(filters).some(Boolean)
  const selectedSource = selected ? campaignById.get(selected.sourceCampaignId) : undefined
  const selectedTarget = selected?.targetCampaignId
    ? campaignById.get(selected.targetCampaignId)
    : undefined
  const selectedLegacyGroup = selected?.targetContactGroupId ? groupById.get(selected.targetContactGroupId) : undefined
  const selectedDataGroup = selected?.targetDataGroupId ? dataGroupById.get(selected.targetDataGroupId) : undefined
  const selectedDataGroupName = selectedDataGroup?.name
    || selected?.targetDataGroupName
    || selectedLegacyGroup?.name
  const selectedTriggerLabel = selected
    ? selected.triggerConditions.map(formatAutomationTriggerLabel).join(', ')
    : ''
  const selectedScheduleLabel = selected ? formatAutomationScheduleLabel(selected) : ''

  return (
    <div ref={pageRef} className="automation-page">
      <header className="automation-page-header">
        <div className="automation-page-title">
          <span className="automation-page-title-icon"><Zap size={21} /></span>
          <div>
            <h1>Tự động hóa</h1>
            <p>Kết nối kết quả chiến dịch để dữ liệu tiếp tục được xử lý tự động.</p>
          </div>
        </div>
        <div className="automation-toolbar" role="toolbar" aria-label="Hành động tự động hóa">
          <button
            type="button"
            className="automation-button is-primary"
            onClick={() => setModal({ mode: 'create', automation: null })}
            disabled={!optionsLoaded || optionsLoading}
            title={!optionsLoaded ? 'Cần tải dữ liệu cấu hình trước khi thêm tự động hóa.' : undefined}
          >
            <Plus size={16} /> Thêm tự động hóa
          </button>
          <button type="button" className="automation-button" onClick={() => selected && void openEdit(selected.id)} disabled={!selected || busyAction !== null}>
            {busyAction === 'edit' ? <Loader2 size={15} className="animate-spin" /> : <Edit3 size={15} />} Chỉnh sửa
          </button>
          <button type="button" className="automation-button" onClick={() => selected && void setActive(selected, true)} disabled={!selected || selected.isActive || busyAction !== null}>
            <Play size={15} /> Chạy
          </button>
          <button type="button" className="automation-button" onClick={() => selected && void setActive(selected, false)} disabled={!selected || !selected.isActive || busyAction !== null}>
            <Pause size={15} /> Dừng
          </button>
          <button type="button" className="automation-button is-icon-mobile" onClick={() => void refreshAll()} disabled={refreshing} title="Làm mới">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> <span>Làm mới</span>
          </button>
        </div>
      </header>

      <section className="automation-card automation-action-section" aria-labelledby="automation-actions-title">
        <div className="automation-card-heading">
          <h2 id="automation-actions-title">Danh sách hành động</h2>
        </div>
        <div className="automation-action-strip">
          {actionItems.map(action => {
            const ActionIcon = ACTION_ICONS[action.id]
            const available = action.isAvailable && action.id === 'campaign_detail_route'
            const canCreate = available && optionsLoaded && !optionsLoading
            return (
              <button
                key={action.id}
                type="button"
                className={`automation-action-card ${available ? 'active' : 'disabled'} ${available && !canCreate ? 'is-unavailable' : ''}`}
                disabled={!canCreate}
                onClick={canCreate ? () => setModal({ mode: 'create', automation: null }) : undefined}
                title={available && !canCreate ? 'Cần tải dữ liệu cấu hình trước khi thêm tự động hóa.' : action.description || action.name}
                aria-label={available ? `Tạo tự động hóa: ${action.name}` : `${action.name} — sắp ra mắt`}
              >
                <span className="automation-action-icon"><ActionIcon size={19} /></span>
                <span className="automation-action-copy">
                  <strong>{action.name}</strong>
                  <small>{action.description}</small>
                </span>
                {available
                  ? <span className="automation-action-selected"><Check size={14} /></span>
                  : <span className="automation-coming-soon">Sắp ra mắt</span>}
              </button>
            )
          })}
        </div>
        {optionsError && (
          <div className="automation-options-error" role="alert">
            <CircleAlert size={17} />
            <span>
              <strong>Chưa tải được cấu hình tạo mới.</strong>
              <small>{optionsError} Chức năng thêm tự động hóa tạm thời bị khóa.</small>
            </span>
            <button type="button" className="automation-button" onClick={() => void loadOptions()} disabled={optionsLoading}>
              {optionsLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              {optionsLoading ? 'Đang thử lại' : 'Thử lại'}
            </button>
          </div>
        )}
      </section>

      <section className="automation-card automation-list-section" aria-labelledby="automation-list-title">
        <div className="automation-card-heading automation-list-heading">
          <div>
            <h2 id="automation-list-title">Danh sách tự động hóa</h2>
            {!loading && <span>{total} quy tắc</span>}
          </div>
          {refreshing && <span className="automation-refresh-indicator"><RefreshCw size={13} className="animate-spin" /> Đang đồng bộ</span>}
        </div>

        <div className="automation-filters" role="search">
          <label className="automation-search-field">
            <Search size={16} />
            <input
              ref={searchInputRef}
              type="search"
              value={searchDraft}
              onChange={event => setSearchDraft(event.target.value)}
              placeholder="Tìm kiếm tên tự động hóa..."
              aria-label="Tìm kiếm tự động hóa"
            />
            <kbd>/</kbd>
          </label>
          <label className="automation-filter-field">
            <span>Trạng thái</span>
            <select value={filters.isActive} onChange={event => updateFilter('isActive', event.target.value as AutomationFilters['isActive'])}>
              <option value="">Tất cả</option>
              <option value="true">Đang hoạt động</option>
              <option value="false">Đã dừng</option>
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="automation-filter-field">
            <span>Loại dữ liệu</span>
            <select value={filters.dataType} onChange={event => updateFilter('dataType', event.target.value as AutomationFilters['dataType'])}>
              <option value="">Tất cả</option>
              {(Object.keys(DATA_TYPE_LABELS) as AutomationDataType[]).map(type => (
                <option key={type} value={type}>{DATA_TYPE_LABELS[type]}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="automation-filter-field">
            <span>Chiến dịch A</span>
            <select value={filters.sourceCampaignId} onChange={event => updateFilter('sourceCampaignId', event.target.value)}>
              <option value="">Tất cả</option>
              {options.campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="automation-filter-field">
            <span>Chiến dịch đích</span>
            <select value={filters.targetCampaignId} onChange={event => updateFilter('targetCampaignId', event.target.value)}>
              <option value="">Tất cả</option>
              {options.campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="automation-filter-field is-date">
            <span>Cập nhật từ</span>
            <input
              type="date"
              value={filters.updatedFrom}
              onChange={event => updateFilter('updatedFrom', event.target.value)}
              aria-label="Lọc theo ngày cập nhật từ"
            />
          </label>
          <button type="button" className="automation-button automation-clear-filter" onClick={clearFilters} disabled={!hasFilters && !searchDraft}>
            <FilterX size={15} /> Xóa lọc
          </button>
        </div>

        <div className="automation-table-shell">
          {listError ? (
            <div className="automation-state-panel is-error" role="alert">
              <CircleAlert size={28} />
              <strong>Chưa tải được danh sách</strong>
              <p>{listError}</p>
              <button type="button" className="automation-button" onClick={() => void refreshAll()}>
                <RotateCcw size={15} /> Thử lại
              </button>
            </div>
          ) : loading ? (
            <div className="automation-loading-table" aria-label="Đang tải danh sách tự động hóa">
              {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
            </div>
          ) : items.length === 0 ? (
            <div className="automation-state-panel">
              <Zap size={30} />
              <strong>{hasFilters ? 'Không có kết quả phù hợp' : 'Chưa có tự động hóa'}</strong>
              <p>{hasFilters ? 'Thử thay đổi hoặc xóa bộ lọc hiện tại.' : 'Tạo quy tắc đầu tiên để chuyển dữ liệu đến chiến dịch, Nhóm data, hoặc cả hai.'}</p>
              {hasFilters ? (
                <button type="button" className="automation-button" onClick={clearFilters}><FilterX size={15} /> Xóa bộ lọc</button>
              ) : (
                <button type="button" className="automation-button is-primary" onClick={() => setModal({ mode: 'create', automation: null })} disabled={!optionsLoaded || optionsLoading}>
                  <Plus size={15} /> Thêm tự động hóa
                </button>
              )}
            </div>
          ) : (
            <div className="automation-table-scroll">
              <table className="automation-table">
                <thead>
                  <tr>
                    <th className="automation-selection-column">
                      <input
                        type="checkbox"
                        checked={!!selectedId}
                        onChange={() => setSelectedId(selectedId ? null : items[0]?.id || null)}
                        aria-label={selectedId ? 'Bỏ chọn tự động hóa' : 'Chọn tự động hóa đầu tiên'}
                      />
                    </th>
                    <th><SortableHeader field="name" label="Tên" sort={sort} onSort={handleSort} /></th>
                    <th>Hành động</th>
                    <th><SortableHeader field="isActive" label="Trạng thái tự động hóa" sort={sort} onSort={handleSort} /></th>
                    <th>Chiến dịch A</th>
                    <th>Trạng thái kết quả A</th>
                    <th>Đích nhận</th>
                    <th>Lịch chuyển dữ liệu</th>
                    <th>Ghi chú</th>
                    <th aria-label="Hành động" />
                  </tr>
                </thead>
                <tbody>
                  {items.map(automation => {
                    const isSelected = automation.id === selectedId
                    const source = campaignById.get(automation.sourceCampaignId)
                    const target = automation.targetCampaignId
                      ? campaignById.get(automation.targetCampaignId)
                      : undefined
                    const dataGroup = automation.targetDataGroupId
                      ? dataGroupById.get(automation.targetDataGroupId)
                      : undefined
                    const campaignDestination = automation.targetCampaignName
                      || target?.name
                      || (automation.targetCampaignId ? `#${automation.targetCampaignId}` : '')
                    const groupDestination = automation.targetDataGroupName
                      || dataGroup?.name
                      || (automation.targetDataGroupId ? `#${automation.targetDataGroupId}` : '')
                    const destinationLabel = [
                      campaignDestination,
                      groupDestination
                    ].filter(Boolean).join(' + ')
                    const scheduleLabel = formatAutomationScheduleLabel(automation)
                    return (
                      <tr
                        key={automation.id}
                        className={isSelected ? 'selected' : ''}
                        onClick={() => setSelectedId(automation.id)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedId(automation.id)
                          }
                        }}
                        tabIndex={0}
                        aria-selected={isSelected}
                      >
                        <td className="automation-selection-column">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => setSelectedId(isSelected ? null : automation.id)}
                            onClick={event => event.stopPropagation()}
                            aria-label={`Chọn ${automation.name}`}
                          />
                        </td>
                        <td>
                          <strong className="automation-name-cell">{automation.name}</strong>
                          <small>{DATA_TYPE_LABELS[automation.dataType]}</small>
                        </td>
                        <td>
                          <span className="automation-action-cell"><ListRestart size={15} /> Theo trạng thái chiến dịch</span>
                        </td>
                        <td>
                          <span className={`automation-status-pill ${automation.isActive ? 'is-active' : 'is-paused'}`}>
                            <span /> {automation.isActive ? 'Đang hoạt động' : 'Đã dừng'}
                          </span>
                        </td>
                        <td>
                          <strong>{automation.sourceCampaignName || source?.name || `#${automation.sourceCampaignId}`}</strong>
                          <small>{automation.sourceAccountName || source?.accountName || automation.sourceActionName || source?.actionName}</small>
                        </td>
                        <td>
                          <div className="automation-trigger-chips">
                            {automation.triggerConditions.slice(0, 2).map(condition => (
                              <span
                                key={getAutomationTriggerIdentityKey(condition)}
                                title={formatAutomationTriggerLabel(condition)}
                              >
                                {formatAutomationTriggerLabel(condition)}
                              </span>
                            ))}
                            {automation.triggerConditions.length > 2 && <span>+{automation.triggerConditions.length - 2}</span>}
                          </div>
                        </td>
                        <td>
                          <strong title={destinationLabel || undefined}>{destinationLabel || '—'}</strong>
                          <small>
                            {campaignDestination
                              ? automation.targetAccountName || target?.accountName || automation.targetActionName || target?.actionName
                              : 'Nhóm data'}
                          </small>
                        </td>
                        <td>
                          <strong title={scheduleLabel}>{scheduleLabel}</strong>
                          <small>Cập nhật data: {formatDateTime(automation.lastDataAt)}</small>
                        </td>
                        <td><span className="automation-note-cell" title={automation.note || ''}>{automation.note || '—'}</span></td>
                        <td className="automation-row-action-cell">
                          <button
                            type="button"
                            className="automation-icon-button"
                            onClick={event => {
                              event.stopPropagation()
                              setRowMenuId(current => current === automation.id ? null : automation.id)
                            }}
                            aria-label={`Mở hành động cho ${automation.name}`}
                            aria-haspopup="menu"
                            aria-expanded={rowMenuId === automation.id}
                          >
                            <MoreVertical size={16} />
                          </button>
                          {rowMenuId === automation.id && (
                            <div className="automation-row-menu" role="menu" onClick={event => event.stopPropagation()}>
                              <button type="button" onClick={() => void openEdit(automation.id)} role="menuitem"><Edit3 size={14} /> Chỉnh sửa</button>
                              <button type="button" onClick={() => void setActive(automation, !automation.isActive)} role="menuitem">
                                {automation.isActive ? <Pause size={14} /> : <Play size={14} />} {automation.isActive ? 'Dừng' : 'Chạy'}
                              </button>
                              <button type="button" className="is-danger" onClick={() => requestDelete(automation)} role="menuitem"><Trash2 size={14} /> Xóa</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!listError && !loading && items.length > 0 && (
          <div className="automation-pagination">
            <span>Hiển thị {visibleStart}–{visibleEnd} của {total}</span>
            <div>
              <button type="button" className="automation-icon-button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1} aria-label="Trang trước"><ChevronLeft size={16} /></button>
              <span className="automation-page-number">{page}</span>
              <button type="button" className="automation-icon-button" onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page >= totalPages} aria-label="Trang sau"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </section>

      <section
        className={`automation-detail-dock ${dockCollapsed ? 'is-collapsed' : ''}`}
        style={dockCollapsed ? undefined : { height: dockHeight }}
        aria-label="Chi tiết tự động hóa"
      >
        <button
          type="button"
          className="automation-dock-resize"
          onPointerDown={startDockResize}
          onDoubleClick={() => setDockCollapsed(value => !value)}
          aria-label="Kéo để thay đổi chiều cao bảng chi tiết"
          title="Kéo để đổi chiều cao · Nhấp đúp để thu gọn"
        >
          <GripHorizontal size={16} />
        </button>
        <div className="automation-detail-header">
          <div className="automation-detail-tabs" role="tablist">
            <button type="button" className={detailTab === 'info' ? 'active' : ''} onClick={() => { setDetailTab('info'); setDockCollapsed(false) }} role="tab" aria-selected={detailTab === 'info'}>Thông tin</button>
            <button type="button" className={detailTab === 'data' ? 'active' : ''} onClick={() => { setDetailTab('data'); setDockCollapsed(false) }} role="tab" aria-selected={detailTab === 'data'}>
              Dữ liệu kích hoạt {detailTotal > 0 && <span>{detailTotal}</span>}
            </button>
          </div>
          <div className="automation-detail-header-actions">
            {selected && <strong>{selected.name}</strong>}
            <button type="button" className="automation-icon-button" onClick={() => setDockCollapsed(value => !value)} aria-label={dockCollapsed ? 'Mở chi tiết' : 'Thu gọn chi tiết'}>
              <ChevronDown size={16} className={dockCollapsed ? 'is-rotated' : ''} />
            </button>
          </div>
        </div>

        {!dockCollapsed && (
          <div className="automation-detail-body">
            {!selected ? (
              <div className="automation-inline-detail-empty"><Database size={24} /><span>Chọn một tự động hóa để xem chi tiết.</span></div>
            ) : detailTab === 'info' ? (
              <div className="automation-info-grid" role="tabpanel">
                <div><span>Tên tự động hóa</span><strong>{selected.name}</strong></div>
                <div><span>Trạng thái</span><strong className={selected.isActive ? 'is-success' : ''}>{selected.isActive ? 'Đang hoạt động' : 'Đã dừng'}</strong></div>
                <div><span>Chiến dịch A</span><strong>{selected.sourceCampaignName || selectedSource?.name || `#${selected.sourceCampaignId}`}</strong><small>{selected.sourceAccountName || selectedSource?.accountName}</small></div>
                <div>
                  <span>Kết quả kích hoạt</span>
                  <strong title={selectedTriggerLabel}>
                    {selectedTriggerLabel}
                  </strong>
                </div>
                <div><span>Dữ liệu đồng nhất</span><strong>{DATA_TYPE_LABELS[selected.dataType]}</strong></div>
                <div>
                  <span>Chiến dịch đích</span>
                  <strong>{selected.targetCampaignName || selectedTarget?.name || (selected.targetCampaignId ? `#${selected.targetCampaignId}` : 'Không chọn')}</strong>
                  <small>{selected.targetAccountName || selectedTarget?.accountName}</small>
                </div>
                <div><span>Nhóm data đích</span><strong>{selectedDataGroupName || 'Không thêm vào nhóm'}</strong></div>
                <div>
                  <span>Lịch chuyển dữ liệu</span>
                  <strong title={selectedScheduleLabel}>{selectedScheduleLabel}</strong>
                </div>
                <div><span>Dữ liệu gần nhất</span><strong>{formatDateTime(selected.lastDataAt)}</strong></div>
                <div><span>Ngày tạo</span><strong>{formatDateTime(selected.createdAt)}</strong></div>
                <div className="is-wide"><span>Ghi chú</span><strong>{selected.note || 'Không có ghi chú'}</strong></div>
              </div>
            ) : detailError ? (
              <div className="automation-inline-detail-empty is-error" role="alert">
                <CircleAlert size={22} /><span>{detailError}</span>
                <button type="button" className="automation-button" onClick={() => void loadDetails(selected.id)}>Thử lại</button>
              </div>
            ) : detailLoading ? (
              <div className="automation-detail-loading"><Loader2 size={23} className="animate-spin" /> Đang tải dữ liệu kích hoạt...</div>
            ) : details.length === 0 ? (
              <div className="automation-inline-detail-empty"><Database size={24} /><span>Tự động hóa này chưa có dữ liệu kích hoạt.</span></div>
            ) : (
              <div className="automation-detail-table-wrap" role="tabpanel">
                <table className="automation-detail-table">
                  <thead>
                    <tr>
                      <th>Dữ liệu</th>
                      <th>Kết quả A</th>
                      <th>Thời điểm kích hoạt</th>
                      <th>Input chiến dịch đích</th>
                      <th>Kết quả chiến dịch đích</th>
                      <th>Nhóm data</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map(detail => {
                      const groupSyncIncomplete = !!(
                        detail.targetDataGroupId
                        || detail.targetDataGroupSyncStatus
                      )
                        && detail.status === 'đã thêm'
                        && detail.targetDataGroupSyncStatus !== 'completed'
                      const tone = groupSyncIncomplete
                        ? 'warning'
                        : getExecutionTone(detail.status)
                      const StatusIcon = tone === 'success' ? CircleCheck : tone === 'error' ? CircleX : tone === 'warning' ? CircleAlert : Database
                      const hasCampaignDestination = detail.targetCampaignId !== null
                        && detail.targetCampaignId !== undefined
                      const groupDestinationLabel = detail.targetDataGroupName
                        || (detail.targetDataGroupId ? `#${detail.targetDataGroupId}` : '')
                      const statusLabel = groupSyncIncomplete
                        ? detail.targetDataGroupSyncStatus === 'failed'
                          ? 'Một phần lỗi'
                          : detail.targetDataGroupSyncStatus === 'skipped'
                            ? 'Một phần bỏ qua'
                            : 'Chờ Nhóm data'
                        : detail.status
                      return (
                        <tr key={detail.id}>
                          <td><strong>{detail.dataValue || '—'}</strong><small>{DATA_TYPE_LABELS[detail.dataType]}</small></td>
                          <td><strong>{detail.sourceStatus || '—'}</strong><small>Detail #{detail.sourceCampaignDetailId}</small></td>
                          <td><strong>{formatDateTime(detail.scheduledAt)}</strong><small>Kích hoạt: {formatDateTime(detail.triggeredAt)}</small></td>
                          <td>
                            <strong>{hasCampaignDestination ? (detail.targetInputDataId ? `#${detail.targetInputDataId}` : 'Chưa tạo') : 'Không áp dụng'}</strong>
                            <small>{hasCampaignDestination ? 'Input chiến dịch đích' : 'Chỉ chuyển vào Nhóm data'}</small>
                          </td>
                          <td>
                            <strong>{hasCampaignDestination ? (detail.targetResultStatus || 'Chưa có kết quả') : 'Không áp dụng'}</strong>
                            <small>
                              {!hasCampaignDestination
                                ? 'Không có chiến dịch đích'
                                : detail.targetResultCount
                                ? `${detail.targetResultCount} kết quả · ${formatDateTime(detail.processedAt)}`
                                : detail.processedAt ? `Xử lý: ${formatDateTime(detail.processedAt)}` : 'Đang chờ xử lý'}
                            </small>
                          </td>
                          <td>
                            <span className="automation-data-group-chip">{groupDestinationLabel || detail.targetContactGroupName || '—'}</span>
                            {detail.targetDataGroupSyncStatus && (
                              <small>Đồng bộ: {detail.targetDataGroupSyncStatus}</small>
                            )}
                          </td>
                          <td>
                            <span className={`automation-execution-status is-${tone}`}><StatusIcon size={14} /> {statusLabel}</span>
                            {(detail.errorMessage || detail.targetDataGroupSyncError) && (
                              <small className="is-error" title={detail.errorMessage || detail.targetDataGroupSyncError || ''}>
                                {detail.errorMessage || detail.targetDataGroupSyncError}
                              </small>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {detailTotalPages > 1 && (
                  <div className="automation-detail-pagination">
                    <span>{(detailPage - 1) * DETAIL_PAGE_SIZE + 1}–{Math.min(detailTotal, detailPage * DETAIL_PAGE_SIZE)} của {detailTotal}</span>
                    <button type="button" className="automation-icon-button" onClick={() => setDetailPage(current => Math.max(1, current - 1))} disabled={detailPage <= 1} aria-label="Trang dữ liệu trước"><ChevronLeft size={15} /></button>
                    <span>{detailPage}</span>
                    <button type="button" className="automation-icon-button" onClick={() => setDetailPage(current => Math.min(detailTotalPages, current + 1))} disabled={detailPage >= detailTotalPages} aria-label="Trang dữ liệu sau"><ChevronRight size={15} /></button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {modal && (
        <AutomationFormModal
          mode={modal.mode}
          automation={modal.automation}
          options={options}
          onClose={() => setModal(null)}
          onSaved={saved => {
            setModal(null)
            setSelectedId(saved.id)
            useUiStore.getState().showAlert(modal.mode === 'edit' ? 'Đã cập nhật tự động hóa.' : 'Đã thêm tự động hóa.', 'success')
            void loadAutomations(true)
          }}
        />
      )}
    </div>
  )
}
