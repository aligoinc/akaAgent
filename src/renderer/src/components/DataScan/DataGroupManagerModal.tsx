import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  Folder,
  GripVertical,
  LoaderCircle,
  Palette,
  Pencil,
  Plus,
  Search,
  Trash2,
  Zap,
  X
} from 'lucide-react'
import { utils, writeFile } from 'xlsx'
import type {
  AutoAccountContact,
  CampaignImportPlatform,
  ContactDatasetImportSource,
  ContactType,
  DataGroup,
  DataGroupIngestRow,
  DataGroupListQuery,
  DataGroupMember,
  DataGroupMemberListQuery,
  DataGroupMemberStatusFilter,
  DataProvenance
} from '../../../../shared/types'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import { createDefaultDataGroupName } from '../../utils/dataGroupNames'
import {
  createDataGroupRequestId,
  getDataGroupApi,
  type DataGroupElectronAPI
} from '../DataGroups/dataGroupApi'
import CampaignDataUploadModal, {
  type CampaignDataUploadSubmission
} from '../CampaignPanels/CampaignDataUploadModal'
import type { DataScanAction, DataScanSelectionContext } from './DataScanModal'

const LazyDataScanModal = lazy(() => import('./DataScanModal'))

const GROUP_PAGE_SIZE = 50
const MEMBER_PAGE_SIZE = 50
const DEFAULT_GROUP_COLOR = '#6366f1'
const DATA_GROUP_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#64748b']

interface ImportTarget {
  value: string
  label: string
  dataTypeCode: string
  flatformType: string | null
  contactType: ContactType
  importPlatform: CampaignImportPlatform
  actionId: string
}

const IMPORT_TARGETS: ImportTarget[] = [
  { value: 'phone', label: 'Số điện thoại', dataTypeCode: 'phone', flatformType: null, contactType: 'phone', importPlatform: 'zalo', actionId: 'zalo_message_phone' },
  { value: 'email', label: 'Email', dataTypeCode: 'email', flatformType: 'email', contactType: 'email', importPlatform: 'email', actionId: 'email_send' },
  { value: 'facebook_search_keyword', label: 'Facebook · Từ khóa tìm kiếm', dataTypeCode: 'facebook_search_keyword', flatformType: 'facebook', contactType: 'campaign_input', importPlatform: 'facebook', actionId: 'facebook_find_data_search' },
  { value: 'facebook_post_url', label: 'Facebook · Link bài viết', dataTypeCode: 'facebook_post_url', flatformType: 'facebook', contactType: 'campaign_input', importPlatform: 'facebook', actionId: 'facebook_comment_seeding_post' },
  { value: 'facebook_person', label: 'Facebook · User', dataTypeCode: 'facebook_person', flatformType: 'facebook', contactType: 'person', importPlatform: 'facebook', actionId: 'facebook_message_uid' },
  { value: 'facebook_group', label: 'Facebook · Group', dataTypeCode: 'facebook_group', flatformType: 'facebook', contactType: 'group', importPlatform: 'facebook', actionId: 'facebook_join_group' },
  { value: 'facebook_page', label: 'Facebook · Page', dataTypeCode: 'facebook_page', flatformType: 'facebook', contactType: 'page', importPlatform: 'facebook', actionId: 'facebook_message_uid' },
  { value: 'zalo_person_phone', label: 'Zalo · User theo SĐT', dataTypeCode: 'phone', flatformType: 'zalo', contactType: 'phone', importPlatform: 'zalo', actionId: 'zalo_message_phone' },
  { value: 'zalo_person_uid', label: 'Zalo · User theo UID', dataTypeCode: 'zalo_person', flatformType: 'zalo', contactType: 'person', importPlatform: 'facebook', actionId: 'facebook_message_uid' },
  { value: 'zalo_group', label: 'Zalo · Group/link', dataTypeCode: 'zalo_group', flatformType: 'zalo', contactType: 'group', importPlatform: 'zalo', actionId: 'zalo_join_group_link' }
]

const DATA_GROUP_SCAN_ACTIONS: DataScanAction[] = [
  'facebook_friends',
  'facebook_groups',
  'facebook_pages',
  'facebook_post_commenters',
  'facebook_post_likes',
  'facebook_profile_friends',
  'facebook_group_members',
  'zalo_friends',
  'zalo_groups',
  'zalo_group_members',
  'zalo_remarketing_customers'
]

const SCAN_DATA_TYPE_CODE_BY_ACTION: Partial<Record<DataScanAction, string>> = {
  facebook_friends: 'facebook_person',
  facebook_groups: 'facebook_group',
  facebook_pages: 'facebook_page',
  facebook_post_commenters: 'facebook_person',
  facebook_post_likes: 'facebook_person',
  facebook_profile_friends: 'facebook_person',
  facebook_group_members: 'facebook_person',
  zalo_friends: 'zalo_person',
  zalo_groups: 'zalo_group',
  zalo_group_members: 'zalo_person',
  zalo_remarketing_customers: 'zalo_person'
}

const STATUS_FILTER_OPTIONS: Array<{ value: DataGroupMemberStatusFilter; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'friend', label: 'Bạn bè' },
  { value: 'stranger', label: 'Người lạ' },
  { value: 'joined', label: 'Đã tham gia' },
  { value: 'not_joined', label: 'Chưa tham gia' }
]

export interface DataGroupManagerModalProps {
  initialAccountId?: number | null
  initialGroupId?: number | null
  initialPlatform?: string
  initialContactType?: ContactType
  lockContext?: boolean
  zaloTagNameById?: Map<string, string>
  akaBizTagNameById?: Map<number, string>
  onGroupsChanged?: () => void | Promise<void>
  onClose: () => void
  selectionMode?: boolean
  onSelectGroup?: (group: DataGroup) => void
  compatibleActionId?: string | null
  compatibleDataTypeCategoryItemId?: number | null
  unrestrictedOnly?: boolean
}

interface AccountFilterOption {
  id: number
  name: string
  deleted: boolean
}

interface DatasetFilterOption {
  id: number
  name: string
  dataTypeName?: string | null
}

interface BackgroundRefreshOptions {
  silent?: boolean
}

interface DataTypeCatalogItem {
  id: number
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

interface SemanticDataGroupFields {
  dataTypeCategoryItemId?: number | null
  dataTypeCode?: string | null
  dataTypeName?: string | null
  datasetSyncMode?: 'manual' | 'dataset_auto'
}

interface SemanticDataGroupMemberFields {
  dataTypeCategoryItemId?: number | null
  dataTypeCode?: string | null
  dataTypeName?: string | null
  primaryDataTypeCategoryItemId?: number | null
  primaryDataTypeCode?: string | null
  primaryDataTypeName?: string | null
}

interface SemanticDataProvenanceFields {
  dataTypeCategoryItemId?: number | null
  dataTypeCode?: string | null
  dataTypeName?: string | null
}

type DataGroupCompatibilityQuery = Pick<DataGroupListQuery, 'search'> & {
  compatibleActionId?: string | null
  compatibleDataTypeCategoryItemId?: number | null
  unrestrictedOnly?: boolean
  dataTypeCategoryItemIds?: number[]
}

const formatCount = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

const formatExportTimestamp = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

const sanitizeFilename = (value: string) => value
  .normalize('NFKD')
  .replace(/[\\/:*?"<>|]+/g, '-')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 72) || 'nhom-data'

const hashDataGroupImportPayload = async (value: unknown): Promise<string> => {
  const payload = JSON.stringify(value)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`
}

const useDebouncedValue = <T,>(value: T, delay = 300) => {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay)
    return () => window.clearTimeout(timer)
  }, [delay, value])
  return debouncedValue
}

const listAllDataGroups = async (
  api: DataGroupElectronAPI,
  query: DataGroupCompatibilityQuery = {}
) => {
  const allGroups: DataGroup[] = []
  const pageSize = 200
  let offset = 0
  while (true) {
    const result = await api.listDataGroups({
      ...query,
      offset,
      limit: pageSize
    } as DataGroupListQuery)
    allGroups.push(...result.groups)
    offset += result.groups.length
    if (result.groups.length === 0 || offset >= result.total) return allGroups
  }
}

const getDataTypeCatalogApi = () => (
  window.electronAPI as unknown as {
    listDataTypeCategoryItems?: () => Promise<DataTypeCatalogItem[]>
  }
)

const getGroupSemanticFields = (group?: DataGroup | null): SemanticDataGroupFields => (
  (group || {}) as DataGroup & SemanticDataGroupFields
)

const getGroupDataTypeId = (group?: DataGroup | null) => (
  getGroupSemanticFields(group).dataTypeCategoryItemId ?? null
)

const getGroupDataTypeCode = (group?: DataGroup | null) => (
  getGroupSemanticFields(group).dataTypeCode?.trim() || null
)

const getGroupDataTypeName = (group?: DataGroup | null) => {
  const fields = getGroupSemanticFields(group)
  return fields.dataTypeName?.trim() || fields.dataTypeCode?.trim() || 'Mọi loại dữ liệu'
}

const isDatasetAutoGroup = (group?: DataGroup | null) => (
  getGroupSemanticFields(group).datasetSyncMode === 'dataset_auto'
)

const getMemberSemanticFields = (member: DataGroupMember): SemanticDataGroupMemberFields => (
  member as DataGroupMember & SemanticDataGroupMemberFields
)

const getProvenanceSemanticFields = (source: DataProvenance): SemanticDataProvenanceFields => (
  source as DataProvenance & SemanticDataProvenanceFields
)

const getContactTypeLabel = (contactType: ContactType, flatformType?: string | null) => {
  if (contactType === 'person') return flatformType === 'zalo' ? 'User Zalo' : 'User Facebook'
  if (contactType === 'group') return flatformType === 'zalo' ? 'Group Zalo' : 'Group Facebook'
  if (contactType === 'page') return 'Page Facebook'
  if (contactType === 'page_inbox_customer') return 'Khách inbox Page'
  if (contactType === 'phone') return 'Số điện thoại'
  if (contactType === 'email') return 'Email'
  if (contactType === 'campaign_input') return 'Data chiến dịch'
  return 'Data'
}

const getMemberDataTypeLabel = (member: DataGroupMember, group?: DataGroup | null) => {
  if (getGroupDataTypeId(group) != null) return getGroupDataTypeName(group)
  const fields = getMemberSemanticFields(member)
  return fields.dataTypeName?.trim()
    || fields.primaryDataTypeName?.trim()
    || fields.dataTypeCode?.trim()
    || fields.primaryDataTypeCode?.trim()
    || 'Chưa xác định'
}

const getMemberStatus = (member: DataGroupMember) => {
  if (member.isDelete) return { label: 'Đã gỡ', tone: 'is-muted' }
  if (member.contactType === 'person') {
    if (member.isFriend === true) return { label: 'Bạn bè', tone: 'is-active' }
    if (member.isFriend === false) return { label: 'Người lạ', tone: 'is-muted' }
    return { label: 'Chưa xác định', tone: 'is-muted' }
  }
  if (member.contactType === 'group') {
    return member.isJoined
      ? { label: 'Đã tham gia', tone: 'is-active' }
      : { label: 'Chưa tham gia', tone: 'is-muted' }
  }
  return { label: '—', tone: 'is-muted' }
}

const PROVENANCE_LABELS: Record<string, string> = {
  manual: 'Upload data',
  upload: 'Upload data',
  scan: 'Quét data',
  automation: 'Tự động hóa',
  api: 'API',
  legacy: 'Dữ liệu cũ',
  legacy_unknown: 'Dữ liệu cũ'
}

const getProvenanceTitle = (source: DataProvenance) => (
  source.automationName?.trim()
  || source.sourceNameSnapshot?.trim()
  || PROVENANCE_LABELS[source.kind]
  || source.kind
)

const getMemberSourceText = (member: DataGroupMember) => member.sourceName?.trim() || '—'

const getMemberAutomationText = (member: DataGroupMember) => (
  member.sourceCode === 'automation'
    ? member.sourceAutomationName?.trim() || '—'
    : '—'
)

const getMemberDatasetText = (member: DataGroupMember) => (
  Array.from(new Set((member.datasetNames || []).map(name => name.trim()).filter(Boolean))).join(', ') || '—'
)

const getInitialScanAction = (platform?: string, contactType?: ContactType) => {
  if (platform === 'zalo') return contactType === 'group' ? 'zalo_groups' : 'zalo_friends'
  if (contactType === 'group') return 'facebook_groups'
  if (contactType === 'page') return 'facebook_pages'
  return 'facebook_friends'
}

export default function DataGroupManagerModal(props: DataGroupManagerModalProps) {
  const {
    initialAccountId,
    initialGroupId,
    initialPlatform,
    initialContactType,
    lockContext = false,
    onGroupsChanged,
    onClose,
    selectionMode = false,
    onSelectGroup,
    compatibleActionId,
    compatibleDataTypeCategoryItemId,
    unrestrictedOnly = false
  } = props
  const { accounts, loadAccounts } = useCampaignStore()
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)

  const groupLoadSeqRef = useRef(0)
  const memberLoadSeqRef = useRef(0)
  const memberSelectionLoadSeqRef = useRef(0)
  const memberSelectionScopeRef = useRef('')
  const datasetLoadSeqRef = useRef(0)
  const addMenuRef = useRef<HTMLDivElement | null>(null)
  const pageSelectionRef = useRef<HTMLInputElement | null>(null)
  const copyNoticeTimerRef = useRef<number | null>(null)

  const [apiUnavailable, setApiUnavailable] = useState(false)
  const [dataTypeItems, setDataTypeItems] = useState<DataTypeCatalogItem[]>([])
  const [dataTypesLoading, setDataTypesLoading] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const debouncedGroupSearch = useDebouncedValue(groupSearch)
  const [groupDataTypeFilterId, setGroupDataTypeFilterId] = useState<number | ''>('')
  const [groupPage, setGroupPage] = useState(1)
  const [groups, setGroups] = useState<DataGroup[]>([])
  const [groupTotal, setGroupTotal] = useState(0)
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState<number | null>(initialGroupId || null)
  const [activeGroupSnapshot, setActiveGroupSnapshot] = useState<DataGroup | null>(null)
  const accountDirectorySignature = useMemo(
    () => JSON.stringify(
      [...accounts]
        .sort((left, right) => left.id - right.id)
        .map(account => [
          account.id,
          account.name,
          account.isDelete
        ])
    ),
    [accounts]
  )
  const activeGroupIdRef = useRef(activeGroupId)
  const activeGroupSnapshotRef = useRef(activeGroupSnapshot)
  const accountsRef = useRef(accounts)
  const accountDirectorySignatureRef = useRef(accountDirectorySignature)
  activeGroupIdRef.current = activeGroupId
  activeGroupSnapshotRef.current = activeGroupSnapshot
  accountsRef.current = accounts

  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState(DEFAULT_GROUP_COLOR)
  const [newGroupDataTypeCategoryItemId, setNewGroupDataTypeCategoryItemId] = useState<number | ''>('')
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [editingGroupDataTypeCategoryItemId, setEditingGroupDataTypeCategoryItemId] = useState<number | ''>('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [draggedGroupId, setDraggedGroupId] = useState<number | null>(null)
  const [copyNotice, setCopyNotice] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const [memberSearch, setMemberSearch] = useState('')
  const debouncedMemberSearch = useDebouncedValue(memberSearch)
  const lockedAccountFilterId = lockContext && initialAccountId ? initialAccountId : ''
  const lockedContactTypeFilter = lockContext && initialContactType ? initialContactType : ''
  const [accountFilterId, setAccountFilterId] = useState<number | ''>(lockedAccountFilterId)
  const [contactTypeFilter, setContactTypeFilter] = useState<ContactType | ''>(lockedContactTypeFilter)
  const [dataTypeFilterId, setDataTypeFilterId] = useState<number | ''>('')
  const [statusFilter, setStatusFilter] = useState<DataGroupMemberStatusFilter>('all')
  const [datasetFilterId, setDatasetFilterId] = useState<number | ''>('')
  const [memberPage, setMemberPage] = useState(1)
  const [members, setMembers] = useState<DataGroupMember[]>([])
  const [memberTotal, setMemberTotal] = useState(0)
  const [membersLoading, setMembersLoading] = useState(false)
  const [selectedMembershipIds, setSelectedMembershipIds] = useState<Set<number>>(new Set())
  const [selectingAllMembers, setSelectingAllMembers] = useState(false)
  const [seenAccounts, setSeenAccounts] = useState<AccountFilterOption[]>([])
  const [datasetOptions, setDatasetOptions] = useState<DatasetFilterOption[]>([])
  const [provenanceMember, setProvenanceMember] = useState<DataGroupMember | null>(null)

  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importTargetValue, setImportTargetValue] = useState(IMPORT_TARGETS[0].value)
  const importRetryIdentityRef = useRef<{ payloadHash: string; requestId: string } | null>(null)
  const [showScanPicker, setShowScanPicker] = useState(false)
  const [scanTargetGroup, setScanTargetGroup] = useState<DataGroup | null>(null)

  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [moveTargets, setMoveTargets] = useState<DataGroup[]>([])
  const [moveTargetId, setMoveTargetId] = useState<number | null>(null)
  const [moveTargetsLoading, setMoveTargetsLoading] = useState(false)
  const [moveOnlyUnrestrictedTargets, setMoveOnlyUnrestrictedTargets] = useState(false)
  const [deleteGroupCandidate, setDeleteGroupCandidate] = useState<DataGroup | null>(null)
  const [detachAutomationsOnDelete, setDetachAutomationsOnDelete] = useState(true)

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  useEffect(() => () => {
    if (copyNoticeTimerRef.current !== null) window.clearTimeout(copyNoticeTimerRef.current)
  }, [])

  useEffect(() => {
    const catalogApi = getDataTypeCatalogApi()
    if (typeof catalogApi.listDataTypeCategoryItems !== 'function') return
    let cancelled = false
    setDataTypesLoading(true)
    void catalogApi.listDataTypeCategoryItems()
      .then(items => {
        if (cancelled) return
        setDataTypeItems(items
          .filter(item => item.isActive !== false)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id))
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to load semantic data types:', err)
        showAlert(err?.message || 'Không thể tải danh mục loại data.', 'error')
      })
      .finally(() => {
        if (!cancelled) setDataTypesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showAlert])

  useEffect(() => {
    if (!addMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [addMenuOpen])

  const notifyGroupsChanged = useCallback(async () => {
    await onGroupsChanged?.()
  }, [onGroupsChanged])

  const activeGroup = useMemo(
    () => groups.find(group => group.id === activeGroupId) || (activeGroupSnapshot?.id === activeGroupId ? activeGroupSnapshot : null),
    [activeGroupId, activeGroupSnapshot, groups]
  )
  const canReorderGroups = (
    !selectionMode
    && !debouncedGroupSearch.trim()
    && groupDataTypeFilterId === ''
    && !compatibleActionId
    && compatibleDataTypeCategoryItemId == null
    && !unrestrictedOnly
  )
  const activeGroupDataTypeCode = getGroupDataTypeCode(activeGroup)
    || dataTypeItems.find(item => item.id === getGroupDataTypeId(activeGroup))?.code
    || null
  const availableImportTargets = useMemo(
    () => activeGroupDataTypeCode
      ? IMPORT_TARGETS.filter(target => target.dataTypeCode === activeGroupDataTypeCode)
      : IMPORT_TARGETS,
    [activeGroupDataTypeCode]
  )
  const availableScanActions = useMemo(
    () => activeGroupDataTypeCode
      ? DATA_GROUP_SCAN_ACTIONS.filter(action => (
        SCAN_DATA_TYPE_CODE_BY_ACTION[action] === activeGroupDataTypeCode
      ))
      : DATA_GROUP_SCAN_ACTIONS,
    [activeGroupDataTypeCode]
  )

  useEffect(() => {
    if (
      availableImportTargets.length > 0
      && !availableImportTargets.some(target => target.value === importTargetValue)
    ) {
      setImportTargetValue(availableImportTargets[0].value)
    }
  }, [availableImportTargets, importTargetValue])

  const groupPageCount = Math.max(1, Math.ceil(groupTotal / GROUP_PAGE_SIZE))
  const memberPageCount = Math.max(1, Math.ceil(memberTotal / MEMBER_PAGE_SIZE))

  const loadGroups = useCallback(async (options: BackgroundRefreshOptions = {}) => {
    const api = getDataGroupApi()
    if (!api) {
      setApiUnavailable(true)
      setGroups([])
      setGroupTotal(0)
      return
    }
    const loadSeq = ++groupLoadSeqRef.current
    if (!options.silent) setGroupsLoading(true)
    setApiUnavailable(false)
    try {
      const result = await api.listDataGroups({
        search: debouncedGroupSearch.trim() || undefined,
        compatibleActionId: compatibleActionId || undefined,
        compatibleDataTypeCategoryItemId: compatibleDataTypeCategoryItemId ?? undefined,
        unrestrictedOnly,
        dataTypeCategoryItemIds: groupDataTypeFilterId === '' ? undefined : [groupDataTypeFilterId],
        offset: (groupPage - 1) * GROUP_PAGE_SIZE,
        limit: GROUP_PAGE_SIZE
      } as DataGroupListQuery)
      if (loadSeq !== groupLoadSeqRef.current) return
      setGroups(result.groups)
      setGroupTotal(result.total)

      const currentActiveGroupId = activeGroupIdRef.current
      const currentActiveGroupSnapshot = activeGroupSnapshotRef.current
      const initialGroup = initialGroupId
        ? result.groups.find(group => group.id === initialGroupId)
        : null
      const currentGroup = currentActiveGroupId
        ? result.groups.find(group => group.id === currentActiveGroupId)
        : null
      const hasCompatibilityFilter = Boolean(compatibleActionId)
        || compatibleDataTypeCategoryItemId != null
        || unrestrictedOnly
        || groupDataTypeFilterId !== ''
      const hasActiveSnapshot = (
        !hasCompatibilityFilter
        && currentActiveGroupSnapshot?.id === currentActiveGroupId
      )
      if (
        initialGroupId
        && currentActiveGroupId === initialGroupId
        && !initialGroup
        && !hasActiveSnapshot
        && !debouncedGroupSearch.trim()
      ) {
        const allGroups = await listAllDataGroups(api, {
          compatibleActionId: compatibleActionId || undefined,
          compatibleDataTypeCategoryItemId: compatibleDataTypeCategoryItemId ?? undefined,
          unrestrictedOnly,
          dataTypeCategoryItemIds: groupDataTypeFilterId === '' ? undefined : [groupDataTypeFilterId]
        })
        if (
          loadSeq !== groupLoadSeqRef.current
          || activeGroupIdRef.current !== currentActiveGroupId
        ) return
        const selectedIndex = allGroups.findIndex(group => group.id === initialGroupId)
        if (selectedIndex >= 0) {
          const selectedGroup = allGroups[selectedIndex]
          setActiveGroupId(selectedGroup.id)
          setActiveGroupSnapshot(selectedGroup)
          const selectedPage = Math.floor(selectedIndex / GROUP_PAGE_SIZE) + 1
          if (selectedPage !== groupPage) setGroupPage(selectedPage)
          return
        }
      }
      const nextGroup = currentGroup
        || initialGroup
        || (!currentActiveGroupId || !hasActiveSnapshot ? result.groups[0] : null)
      if (nextGroup) {
        setActiveGroupId(nextGroup.id)
        setActiveGroupSnapshot(nextGroup)
      } else if (
        result.groups.length === 0
        && (!currentActiveGroupId || hasCompatibilityFilter)
      ) {
        setActiveGroupId(null)
        setActiveGroupSnapshot(null)
      }

      const lastPage = Math.max(1, Math.ceil(result.total / GROUP_PAGE_SIZE))
      if (groupPage > lastPage) setGroupPage(lastPage)
    } catch (err: any) {
      console.error('Failed to load shared data groups:', err)
      if (loadSeq === groupLoadSeqRef.current && !options.silent) {
        showAlert(err?.message || 'Không thể tải danh sách nhóm data.', 'error')
      }
    } finally {
      if (loadSeq === groupLoadSeqRef.current) setGroupsLoading(false)
    }
  }, [
    compatibleActionId,
    compatibleDataTypeCategoryItemId,
    debouncedGroupSearch,
    groupDataTypeFilterId,
    groupPage,
    initialGroupId,
    showAlert,
    unrestrictedOnly
  ])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  const loadDatasets = useCallback(async (options: BackgroundRefreshOptions = {}) => {
    if (!activeGroupId) {
      datasetLoadSeqRef.current += 1
      setDatasetOptions([])
      return
    }
    const api = getDataGroupApi()
    if (!api) return
    const loadSeq = ++datasetLoadSeqRef.current
    try {
      const datasets = await api.listDataGroupDatasets(activeGroupId)
      if (loadSeq !== datasetLoadSeqRef.current) return
      setDatasetOptions(datasets
        .map(dataset => ({
          id: dataset.id,
          name: dataset.name,
          dataTypeName: dataset.dataTypeName
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'vi')))
      setSeenAccounts(previous => {
        const next = new Map(previous.map(option => [option.id, option]))
        for (const dataset of datasets) {
          if (!dataset.accountId) continue
          const account = accountsRef.current.find(item => item.id === dataset.accountId)
          next.set(dataset.accountId, {
            id: dataset.accountId,
            name: dataset.sourceAccountName?.trim() || account?.name || 'Tài khoản',
            deleted: dataset.sourceAccountDeleted === true
          })
        }
        return Array.from(next.values()).sort((left, right) => left.name.localeCompare(right.name, 'vi'))
      })
    } catch (err: any) {
      console.error('Failed to load data-group datasets:', err)
      if (loadSeq === datasetLoadSeqRef.current && !options.silent) {
        showAlert(err?.message || 'Không thể tải danh sách nguồn data.', 'error')
      }
    }
  }, [activeGroupId, showAlert])

  useEffect(() => {
    setSeenAccounts([])
    setDatasetOptions([])
    void loadDatasets()
  }, [loadDatasets])

  const memberQuery = useMemo<DataGroupMemberListQuery | null>(() => {
    if (!activeGroupId) return null
    return {
      groupId: activeGroupId,
      search: debouncedMemberSearch.trim() || undefined,
      accountIds: accountFilterId === '' ? undefined : [accountFilterId],
      includeAccountless: accountFilterId === '',
      contactTypes: contactTypeFilter === '' ? undefined : [contactTypeFilter],
      dataTypeCategoryItemIds: dataTypeFilterId === '' ? undefined : [dataTypeFilterId],
      status: statusFilter,
      datasetIds: datasetFilterId === '' ? undefined : [datasetFilterId],
      offset: (memberPage - 1) * MEMBER_PAGE_SIZE,
      limit: MEMBER_PAGE_SIZE
    } as DataGroupMemberListQuery
  }, [
    accountFilterId,
    activeGroupId,
    contactTypeFilter,
    dataTypeFilterId,
    datasetFilterId,
    debouncedMemberSearch,
    memberPage,
    statusFilter
  ])

  const memberSelectionScopeKey = useMemo(() => JSON.stringify([
    activeGroupId,
    memberSearch,
    debouncedMemberSearch,
    accountFilterId,
    contactTypeFilter,
    dataTypeFilterId,
    statusFilter,
    datasetFilterId
  ]), [
    accountFilterId,
    activeGroupId,
    contactTypeFilter,
    dataTypeFilterId,
    datasetFilterId,
    debouncedMemberSearch,
    memberSearch,
    statusFilter
  ])
  memberSelectionScopeRef.current = memberSelectionScopeKey
  const memberSearchPending = memberSearch !== debouncedMemberSearch

  const loadMembers = useCallback(async (options: BackgroundRefreshOptions = {}) => {
    if (!memberQuery) {
      memberLoadSeqRef.current += 1
      setMembers([])
      setMemberTotal(0)
      setMembersLoading(false)
      return
    }
    const api = getDataGroupApi()
    if (!api) return
    const loadSeq = ++memberLoadSeqRef.current
    if (!options.silent) setMembersLoading(true)
    try {
      const result = await api.listDataGroupMembers(memberQuery)
      if (loadSeq !== memberLoadSeqRef.current) return
      setMembers(result.members)
      setMemberTotal(result.total)

      setSeenAccounts(previous => {
        const next = new Map(previous.map(option => [option.id, option]))
        for (const member of result.members) {
          if (!member.sourceAccountId) continue
          const account = accountsRef.current.find(item => item.id === member.sourceAccountId)
          next.set(member.sourceAccountId, {
            id: member.sourceAccountId,
            name: member.sourceAccountName?.trim() || account?.name || 'Tài khoản',
            deleted: member.sourceAccountDeleted === true
          })
        }
        return Array.from(next.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      })

      const lastPage = Math.max(1, Math.ceil(result.total / MEMBER_PAGE_SIZE))
      if (memberPage > lastPage) setMemberPage(lastPage)
    } catch (err: any) {
      console.error('Failed to load data-group members:', err)
      if (loadSeq === memberLoadSeqRef.current && !options.silent) {
        showAlert(err?.message || 'Không thể tải data trong nhóm.', 'error')
      }
    } finally {
      if (loadSeq === memberLoadSeqRef.current) setMembersLoading(false)
    }
  }, [memberPage, memberQuery, showAlert])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  useEffect(() => {
    if (accountDirectorySignatureRef.current === accountDirectorySignature) return
    accountDirectorySignatureRef.current = accountDirectorySignature
    void Promise.all([
      loadDatasets({ silent: true }),
      loadMembers({ silent: true })
    ])
  }, [
    accountDirectorySignature,
    loadDatasets,
    loadMembers
  ])

  useEffect(() => {
    memberSelectionLoadSeqRef.current += 1
    setSelectedMembershipIds(new Set())
    setSelectingAllMembers(false)
  }, [memberSelectionScopeKey])

  const accountOptions = useMemo(() => {
    const merged = new Map<number, AccountFilterOption>()
    for (const account of accounts) {
      merged.set(account.id, {
        id: account.id,
        name: account.name,
        deleted: account.isDelete
      })
    }
    for (const option of seenAccounts) merged.set(option.id, option)
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [accounts, seenAccounts])

  const selectGroup = (group: DataGroup) => {
    setActiveGroupId(group.id)
    setActiveGroupSnapshot(group)
    setMemberSearch('')
    setAccountFilterId(lockedAccountFilterId)
    setContactTypeFilter(lockedContactTypeFilter)
    setDataTypeFilterId('')
    setStatusFilter('all')
    setDatasetFilterId('')
    setMemberPage(1)
    setEditingGroupId(null)
  }

  const updateGroupInState = (updated: DataGroup) => {
    setGroups(previous => previous.map(group => group.id === updated.id ? updated : group))
    setActiveGroupSnapshot(previous => previous?.id === updated.id ? updated : previous)
  }

  const adjustActiveGroupCount = (delta: number) => {
    if (!activeGroupId || delta === 0) return
    const adjust = (group: DataGroup) => group.id === activeGroupId
      ? { ...group, activeMembershipCount: Math.max(0, group.activeMembershipCount + delta) }
      : group
    setGroups(previous => previous.map(adjust))
    setActiveGroupSnapshot(previous => previous ? adjust(previous) : previous)
  }

  const handleCreateGroup = async (event: FormEvent) => {
    event.preventDefault()
    const name = newGroupName.trim()
    const api = getDataGroupApi()
    if (!api || !name) return
    setBusyAction('create')
    try {
      const created = await api.createDataGroup({
        name,
        color: newGroupColor,
        dataTypeCategoryItemId: newGroupDataTypeCategoryItemId === ''
          ? null
          : newGroupDataTypeCategoryItemId,
        requestId: createDataGroupRequestId()
      } as Parameters<DataGroupElectronAPI['createDataGroup']>[0])
      setGroupSearch('')
      setGroupPage(1)
      setCreatingGroup(false)
      setNewGroupName('')
      setNewGroupDataTypeCategoryItemId('')
      setNewGroupColor(DATA_GROUP_COLORS[(groupTotal + 1) % DATA_GROUP_COLORS.length])
      const createdMatchesCurrentList = (
        (!compatibleActionId && compatibleDataTypeCategoryItemId == null && !unrestrictedOnly)
        && (
          groupDataTypeFilterId === ''
          || getGroupDataTypeId(created) === groupDataTypeFilterId
        )
      )
      if (createdMatchesCurrentList) {
        setGroupTotal(previous => previous + 1)
        setGroups(previous => [created, ...previous.filter(group => group.id !== created.id)])
        selectGroup(created)
      } else {
        await loadGroups({ silent: true })
      }
      showAlert('Đã tạo nhóm data.', 'success')
      await notifyGroupsChanged()
    } catch (err: any) {
      console.error('Failed to create data group:', err)
      showAlert(err?.message || 'Không thể tạo nhóm data.', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const startRenameGroup = (group: DataGroup) => {
    setEditingGroupId(group.id)
    setEditingGroupName(group.name)
    setEditingGroupDataTypeCategoryItemId(getGroupDataTypeId(group) ?? '')
  }

  const copyGroupId = async (groupId: number) => {
    try {
      await navigator.clipboard.writeText(String(groupId))
      setCopyNotice({ message: `Đã copy ID ${groupId}`, type: 'success' })
    } catch (error) {
      console.error('Failed to copy data-group ID:', error)
      setCopyNotice({ message: 'Không thể copy ID nhóm', type: 'error' })
    }
    if (copyNoticeTimerRef.current !== null) window.clearTimeout(copyNoticeTimerRef.current)
    copyNoticeTimerRef.current = window.setTimeout(() => {
      setCopyNotice(null)
      copyNoticeTimerRef.current = null
    }, 1600)
  }

  const submitRenameGroup = async (group: DataGroup) => {
    const name = editingGroupName.trim()
    const api = getDataGroupApi()
    if (!api || !name) return
    const nextDataTypeCategoryItemId = editingGroupDataTypeCategoryItemId === ''
      ? null
      : editingGroupDataTypeCategoryItemId
    const nameChanged = name !== group.name
    const dataTypeChanged = !isDatasetAutoGroup(group)
      && nextDataTypeCategoryItemId !== getGroupDataTypeId(group)
    if (!nameChanged && !dataTypeChanged) {
      setEditingGroupId(null)
      return
    }
    setBusyAction(`rename:${group.id}`)
    try {
      const request: Parameters<DataGroupElectronAPI['updateDataGroup']>[0] = {
        groupId: group.id
      }
      if (nameChanged) request.name = name
      if (dataTypeChanged) {
        request.dataTypeCategoryItemId = nextDataTypeCategoryItemId
      }
      const updated = await api.updateDataGroup(request)
      updateGroupInState(updated)
      setEditingGroupId(null)
      showAlert(
        nameChanged && dataTypeChanged
          ? 'Đã cập nhật tên và loại data của nhóm.'
          : nameChanged
            ? 'Đã đổi tên nhóm data.'
            : 'Đã cập nhật loại data của nhóm.',
        'success'
      )
      await Promise.all([
        loadGroups({ silent: true }),
        dataTypeChanged ? loadMembers({ silent: true }) : Promise.resolve(),
        notifyGroupsChanged()
      ])
    } catch (err: any) {
      console.error('Failed to update data group:', err)
      showAlert(err?.message || 'Không thể cập nhật nhóm data.', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const handleChangeGroupColor = async (group: DataGroup, color: string) => {
    const api = getDataGroupApi()
    if (!api || color === group.color) return
    const optimistic = { ...group, color }
    updateGroupInState(optimistic)
    setBusyAction(`color:${group.id}`)
    try {
      const updated = await api.updateDataGroup({ groupId: group.id, color })
      updateGroupInState(updated)
      await notifyGroupsChanged()
    } catch (err: any) {
      updateGroupInState(group)
      console.error('Failed to update data-group color:', err)
      showAlert(err?.message || 'Không thể đổi màu nhóm data.', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const handleDuplicateGroup = async (group: DataGroup) => {
    const api = getDataGroupApi()
    if (!api) return
    setBusyAction(`duplicate:${group.id}`)
    try {
      const duplicated = await api.duplicateDataGroup(
        group.id,
        `${group.name} - Bản sao`,
        createDataGroupRequestId()
      )
      setGroupSearch('')
      setGroupPage(1)
      setGroups(previous => [duplicated, ...previous.filter(item => item.id !== duplicated.id)])
      setGroupTotal(previous => previous + 1)
      selectGroup(duplicated)
      showAlert('Đã nhân bản nhóm data.', 'success')
      await notifyGroupsChanged()
    } catch (err: any) {
      console.error('Failed to duplicate data group:', err)
      showAlert(err?.message || 'Không thể nhân bản nhóm data.', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const handleDeleteGroup = (group: DataGroup) => {
    setDeleteGroupCandidate(group)
    setDetachAutomationsOnDelete(true)
  }

  const confirmDeleteGroup = async () => {
    const api = getDataGroupApi()
    const group = deleteGroupCandidate
    if (!api || !group) return
    setBusyAction(`delete:${group.id}`)
    try {
      const result = await api.deleteDataGroup(
        group.id,
        createDataGroupRequestId(),
        detachAutomationsOnDelete
      )
      const remaining = groups.filter(item => item.id !== group.id)
      setGroups(remaining)
      setGroupTotal(previous => Math.max(0, previous - 1))
      if (activeGroupId === group.id) {
        const next = remaining[0] || null
        setActiveGroupId(next?.id || null)
        setActiveGroupSnapshot(next)
      }
      setDeleteGroupCandidate(null)
      const detachedCount = result.detachedAutomationCount || 0
      showAlert(
        detachedCount > 0
          ? `Đã xoá nhóm data và gỡ khỏi ${formatCount(detachedCount)} tự động hoá.`
          : 'Đã xoá nhóm data.',
        'success'
      )
      await notifyGroupsChanged()
    } catch (err: any) {
      console.error('Failed to delete data group:', err)
      showAlert(err?.message || 'Không thể xoá nhóm data.', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const handleDropGroup = async (targetGroupId: number) => {
    const api = getDataGroupApi()
    const sourceIndex = groups.findIndex(group => group.id === draggedGroupId)
    const targetIndex = groups.findIndex(group => group.id === targetGroupId)
    setDraggedGroupId(null)
    if (!api || !canReorderGroups || sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return

    const previous = groups
    const reordered = [...groups]
    const [moved] = reordered.splice(sourceIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    const pageOffset = (groupPage - 1) * GROUP_PAGE_SIZE
    const normalized = reordered.map((group, index) => ({ ...group, sortOrder: pageOffset + index }))
    setGroups(normalized)
    setBusyAction('reorder')
    try {
      const saved = await Promise.all(normalized.map(group => api.updateDataGroup({
        groupId: group.id,
        sortOrder: group.sortOrder
      })))
      const savedById = new Map(saved.map(group => [group.id, group]))
      setGroups(normalized.map(group => savedById.get(group.id) || group))
      await notifyGroupsChanged()
    } catch (err: any) {
      setGroups(previous)
      console.error('Failed to reorder data groups:', err)
      showAlert(err?.message || 'Không thể sắp xếp lại nhóm data.', 'error')
      await loadGroups({ silent: true })
    } finally {
      setBusyAction(null)
    }
  }

  const allMatchingMembersSelected = memberTotal > 0 && selectedMembershipIds.size === memberTotal

  useEffect(() => {
    if (pageSelectionRef.current) {
      pageSelectionRef.current.indeterminate = selectedMembershipIds.size > 0 && !allMatchingMembersSelected
    }
  }, [allMatchingMembersSelected, selectedMembershipIds.size])

  const toggleMember = (membershipId: number) => {
    if (selectingAllMembers) return
    setSelectedMembershipIds(previous => {
      const next = new Set(previous)
      if (next.has(membershipId)) next.delete(membershipId)
      else next.add(membershipId)
      return next
    })
  }

  const toggleAllMatchingMembers = async () => {
    if (!memberQuery || selectingAllMembers || memberTotal === 0) return
    if (allMatchingMembersSelected) {
      memberSelectionLoadSeqRef.current += 1
      setSelectedMembershipIds(new Set())
      return
    }

    const api = getDataGroupApi()
    if (!api) return
    const loadSeq = ++memberSelectionLoadSeqRef.current
    const selectionScope = memberSelectionScopeKey
    setSelectingAllMembers(true)
    try {
      const result = await api.listDataGroupMemberIds({
        ...memberQuery,
        offset: undefined,
        limit: undefined
      })
      if (
        loadSeq !== memberSelectionLoadSeqRef.current
        || selectionScope !== memberSelectionScopeRef.current
      ) return
      setSelectedMembershipIds(new Set(result.ids))
    } catch (err: any) {
      console.error('Failed to select filtered data-group members:', err)
      if (
        loadSeq === memberSelectionLoadSeqRef.current
        && selectionScope === memberSelectionScopeRef.current
      ) {
        showAlert(err?.message || 'Không thể chọn toàn bộ data phù hợp bộ lọc.', 'error')
      }
    } finally {
      if (
        loadSeq === memberSelectionLoadSeqRef.current
        && selectionScope === memberSelectionScopeRef.current
      ) setSelectingAllMembers(false)
    }
  }

  const removeMemberships = (membershipIds: number[], label: string) => {
    if (!activeGroupId || membershipIds.length === 0) return
    const api = getDataGroupApi()
    if (!api) return
    showConfirm(
      `Xoá ${label} khỏi nhóm? Data gốc sẽ không bị xoá.`,
      async () => {
        setBusyAction('remove')
        try {
          const result = await api.removeDataGroupMembers({
            groupId: activeGroupId,
            membershipIds,
            requestId: createDataGroupRequestId()
          })
          const removedIds = new Set(membershipIds)
          setSelectedMembershipIds(previous => new Set(Array.from(previous).filter(id => !removedIds.has(id))))
          adjustActiveGroupCount(-result.count)
          showAlert(`Đã xoá ${formatCount(result.count)} data khỏi nhóm.`, 'success')
          await Promise.all([
            loadMembers({ silent: true }),
            loadGroups({ silent: true }),
            notifyGroupsChanged()
          ])
        } catch (err: any) {
          console.error('Failed to remove data-group members:', err)
          showAlert(err?.message || 'Không thể xoá data khỏi nhóm.', 'error')
        } finally {
          setBusyAction(null)
        }
      },
      { title: 'Xoá data khỏi nhóm', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleOpenMoveModal = async () => {
    const api = getDataGroupApi()
    if (!api || !activeGroupId || selectedMembershipIds.size === 0) return
    setMoveModalOpen(true)
    setMoveTargetId(null)
    setMoveOnlyUnrestrictedTargets(false)
    setMoveTargetsLoading(true)
    try {
      const selectedIds = Array.from(selectedMembershipIds)
      const visibleSelectedMembers = members.filter(member => selectedMembershipIds.has(member.id))
      const selectedMembers = visibleSelectedMembers.length === selectedIds.length
        ? visibleSelectedMembers
        : await api.exportDataGroupMembers({ groupId: activeGroupId, ids: selectedIds })
      const selectedDataTypeIds = new Set<number>()
      let hasUnknownOrMixedOrigin = selectedMembers.length !== selectedIds.length

      for (const member of selectedMembers) {
        const currentOrigins = (member.provenance || []).filter(source => source.isCurrent)
        if (currentOrigins.length === 0) {
          hasUnknownOrMixedOrigin = true
          continue
        }
        for (const origin of currentOrigins) {
          const originDataTypeId = getProvenanceSemanticFields(origin).dataTypeCategoryItemId ?? null
          if (originDataTypeId == null) {
            hasUnknownOrMixedOrigin = true
          } else {
            selectedDataTypeIds.add(originDataTypeId)
          }
        }
      }
      if (selectedDataTypeIds.size > 1) hasUnknownOrMixedOrigin = true

      const compatibleDataTypeId = !hasUnknownOrMixedOrigin && selectedDataTypeIds.size === 1
        ? Array.from(selectedDataTypeIds)[0]
        : null
      const onlyUnrestrictedTargets = compatibleDataTypeId == null
      setMoveOnlyUnrestrictedTargets(onlyUnrestrictedTargets)

      const allGroups = await listAllDataGroups(
        api,
        compatibleDataTypeId == null
          ? {}
          : { compatibleDataTypeCategoryItemId: compatibleDataTypeId }
      )
      setMoveTargets(allGroups.filter(group => (
        group.id !== activeGroupId
        && (
          getGroupDataTypeId(group) == null
          || (!onlyUnrestrictedTargets && getGroupDataTypeId(group) === compatibleDataTypeId)
        )
      )))
    } catch (err: any) {
      console.error('Failed to load move targets:', err)
      showAlert(err?.message || 'Không thể tải nhóm đích.', 'error')
    } finally {
      setMoveTargetsLoading(false)
    }
  }

  const handleMoveMemberships = async () => {
    const api = getDataGroupApi()
    if (!api || !activeGroupId || !moveTargetId || selectedMembershipIds.size === 0) return
    const membershipIds = Array.from(selectedMembershipIds)
    setBusyAction('move')
    try {
      const result = await api.moveDataGroupMembers({
        groupId: activeGroupId,
        targetGroupId: moveTargetId,
        membershipIds,
        requestId: createDataGroupRequestId()
      })
      adjustActiveGroupCount(-result.count)
      setSelectedMembershipIds(new Set())
      setMoveModalOpen(false)
      showAlert(`Đã chuyển ${formatCount(result.count)} data sang nhóm khác.`, 'success')
      await Promise.all([
        loadMembers({ silent: true }),
        loadGroups({ silent: true }),
        notifyGroupsChanged()
      ])
    } catch (err: any) {
      console.error('Failed to move data-group members:', err)
      showAlert(err?.message || 'Không thể chuyển data sang nhóm khác.', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const getAccountDisplay = (member: DataGroupMember) => {
    if (!member.sourceAccountId && !member.sourceAccountName?.trim()) return null
    const account = accounts.find(item => item.id === member.sourceAccountId)
    return {
      name: member.sourceAccountName?.trim() || account?.name || 'Tài khoản',
      deleted: member.sourceAccountDeleted === true || account?.isDelete === true
    }
  }

  const handleExport = async () => {
    const api = getDataGroupApi()
    if (!api || !activeGroupId || !activeGroup) return
    const query: DataGroupMemberListQuery = selectedMembershipIds.size > 0
      ? { groupId: activeGroupId, ids: Array.from(selectedMembershipIds) }
      : { ...memberQuery!, offset: undefined, limit: undefined }
    setBusyAction('export')
    try {
      const exportedMembers = await api.exportDataGroupMembers(query)
      if (exportedMembers.length === 0) {
        showAlert('Không có data để xuất.', 'error')
        return
      }
      const rows = exportedMembers.map(member => {
        const account = getAccountDisplay(member)
        return {
          'Tên': member.name || '',
          'UID': member.uid || '',
          'Số điện thoại': member.phone || '',
          'Email': member.email || '',
          'Link': member.url || '',
          'Tài khoản': account?.name || '—',
          'Tài khoản đã xoá': account?.deleted ? 'Có' : '',
          'Loại data': getMemberDataTypeLabel(member, activeGroup),
          'Trạng thái': getMemberStatus(member).label,
          'Danh sách': getMemberDatasetText(member) === '—' ? '' : getMemberDatasetText(member),
          'Nguồn data': getMemberSourceText(member) === '—' ? '' : getMemberSourceText(member),
          'Tự động hóa': getMemberAutomationText(member) === '—' ? '' : getMemberAutomationText(member)
        }
      })
      const worksheet = utils.json_to_sheet(rows)
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, worksheet, 'Nhóm data')
      writeFile(workbook, `nhom-data-${sanitizeFilename(activeGroup.name)}-${formatExportTimestamp()}.xlsx`)
      showAlert(`Đã xuất ${formatCount(exportedMembers.length)} data.`, 'success')
    } catch (err: any) {
      console.error('Failed to export data-group members:', err)
      showAlert(err?.message || 'Không thể xuất data.', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const resetImportModal = () => {
    importRetryIdentityRef.current = null
    setImportModalOpen(false)
  }

  const ingestRows = async (
    rows: DataGroupIngestRow[],
    kind: 'manual' | 'upload' | 'scan',
    importSource?: ContactDatasetImportSource,
    sourceName?: string,
    identity?: { requestId: string; payloadHash: string },
    datasetName?: string | null,
    datasetId?: number | null,
    targetGroupId?: number,
    dataTypeCategoryItemId?: number | null
  ) => {
    const api = getDataGroupApi()
    const destinationGroupId = targetGroupId || activeGroupId
    if (!api || !destinationGroupId || rows.length === 0) return
    setBusyAction('ingest')
    try {
      const result = await api.ingestDataGroup({
        requestId: identity?.requestId || createDataGroupRequestId(),
        groupId: destinationGroupId,
        kind,
        rows,
        dataTypeCategoryItemId: dataTypeCategoryItemId ?? null,
        datasetId: datasetId ?? null,
        datasetName: datasetName?.trim() || sourceName || null,
        importSource: importSource || null,
        sourceName: sourceName || datasetName?.trim() || null,
        payloadHash: identity?.payloadHash || null
      } as Parameters<DataGroupElectronAPI['ingestDataGroup']>[0])
      const added = result.insertedMembershipCount + result.reactivatedMembershipCount
      if (destinationGroupId === activeGroupId) adjustActiveGroupCount(added)
      const skipped = result.alreadyMemberCount + result.invalidCount + result.incompatibleCount + result.conflictCount
      const suffix = skipped > 0 ? ` · ${formatCount(skipped)} dòng không thêm mới` : ''
      showAlert(`Đã thêm ${formatCount(added)} data vào nhóm${suffix}.`, 'success')
      await Promise.all([
        loadMembers({ silent: true }),
        loadGroups({ silent: true }),
        notifyGroupsChanged()
      ])
      return result
    } catch (err: any) {
      console.error('Failed to ingest data-group rows:', err)
      showAlert(err?.message || 'Không thể thêm data vào nhóm.', 'error')
      throw err
    } finally {
      setBusyAction(null)
    }
  }

  const handleAdvancedImport = async (submission: CampaignDataUploadSubmission) => {
    const target = availableImportTargets.find(item => item.value === importTargetValue)
      || availableImportTargets[0]
    if (!target) throw new Error('Loại nhóm này chưa hỗ trợ thêm data từ file.')
    const groupDataTypeId = getGroupDataTypeId(activeGroup)
    const targetDataType = dataTypeItems.find(item => item.code === target.dataTypeCode)
    const dataTypeCategoryItemId = groupDataTypeId ?? targetDataType?.id ?? null
    if (dataTypeCategoryItemId == null) {
      throw new Error(`Không tìm thấy loại data “${target.label}” trong danh mục.`)
    }
    const rows: DataGroupIngestRow[] = submission.rows.map(rawRow => {
      const uid = String(rawRow.uid || '').trim()
      const looksLikeUrl = /^https?:\/\//i.test(uid) || /(?:facebook\.com|zalo\.me|zaloapp\.com)\//i.test(uid)
      const row: DataGroupIngestRow = {
        name: String(rawRow.name || '').trim() || null,
        phone: String(rawRow.phone || '').trim() || null,
        email: String(rawRow.email || '').trim() || null,
        info1: String(rawRow.info1 || '').trim() || null,
        info2: String(rawRow.info2 || '').trim() || null,
        info3: String(rawRow.info3 || '').trim() || null,
        info4: String(rawRow.info4 || '').trim() || null,
        info5: String(rawRow.info5 || '').trim() || null,
        contactType: target.contactType,
        flatformType: target.flatformType,
        extraData: submission.sourceLink ? { sourceLink: submission.sourceLink } : undefined
      }
      if (target.contactType !== 'phone' && target.contactType !== 'email') {
        if (looksLikeUrl) row.url = uid
        else row.uid = uid || null
      }
      return row
    }).filter(row => Boolean(row.uid || row.url || row.phone || row.email || row.name))
    if (rows.length === 0) throw new Error('Không có data hợp lệ để thêm vào nhóm.')

    const payloadHash = await hashDataGroupImportPayload({
      groupId: activeGroupId,
      target: target.value,
      datasetName: submission.datasetName,
      importSource: submission.importSource,
      sourceLink: submission.sourceLink,
      rows
    })
    const previousIdentity = importRetryIdentityRef.current
    const identity = previousIdentity?.payloadHash === payloadHash
      ? previousIdentity
      : { payloadHash, requestId: createDataGroupRequestId() }
    importRetryIdentityRef.current = identity
    await ingestRows(
      rows,
      submission.importSource === 'textbox' ? 'manual' : 'upload',
      submission.importSource,
      submission.datasetName,
      identity,
      submission.datasetName,
      undefined,
      undefined,
      dataTypeCategoryItemId
    )
  }

  const handleScanSelection = async (
    contacts: AutoAccountContact[],
    context?: DataScanSelectionContext,
    targetGroupId?: number
  ) => {
    const usesVirtualContactIds = context?.action === 'zalo_remarketing_customers'
    const relationshipKind = context?.action === 'zalo_group_members'
      ? 'zalo_group_members'
      : context?.action === 'zalo_remarketing_customers'
        ? 'zalo_remarketing_customers'
        : undefined
    const rows: DataGroupIngestRow[] = contacts.map(contact => {
      const account = accounts.find(item => item.id === contact.accountId)
      return {
        // Remarketing rows are projections of campaign details; their `id`
        // is not an auto_account_contacts PK and must never be resolved as one.
        contactId: usesVirtualContactIds ? undefined : contact.id,
        sourceAccountId: contact.accountId,
        relationshipKind,
        contactType: contact.contactType,
        flatformType: account?.flatformType || null,
        name: contact.name || null,
        uid: contact.uid || null,
        url: contact.url || null,
        phone: String(contact.extraData?.phone || '').trim() || null,
        extraData: contact.extraData
      }
    })
    const destinationGroup = scanTargetGroup?.id === targetGroupId ? scanTargetGroup : activeGroup
    const scanDataTypeCode = context?.action
      ? SCAN_DATA_TYPE_CODE_BY_ACTION[context.action]
      : undefined
    const dataTypeCategoryItemId = getGroupDataTypeId(destinationGroup)
      ?? dataTypeItems.find(item => item.code === scanDataTypeCode)?.id
      ?? null
    if (dataTypeCategoryItemId == null) {
      throw new Error('Không xác định được loại data của dữ liệu quét.')
    }
    try {
      await ingestRows(
        rows,
        'scan',
        undefined,
        context?.datasetName || 'Dữ liệu quét',
        undefined,
        context?.datasetName || null,
        context?.datasetId ?? null,
        targetGroupId,
        dataTypeCategoryItemId
      )
    } catch (error) {
      // ingestRows already reports the specific error. Re-throw so the scan
      // picker stays open and the user can retry the same selection.
      throw error
    }
  }

  const openImportModal = () => {
    if (!activeGroupId) return
    if (availableImportTargets.length === 0) {
      showAlert(`Loại “${getGroupDataTypeName(activeGroup)}” chưa hỗ trợ thêm từ file.`, 'error')
      return
    }
    if (!availableImportTargets.some(target => target.value === importTargetValue)) {
      setImportTargetValue(availableImportTargets[0].value)
    }
    setAddMenuOpen(false)
    setImportModalOpen(true)
  }

  const openScanPicker = () => {
    if (!activeGroup) return
    if (availableScanActions.length === 0) {
      showAlert(`Loại “${getGroupDataTypeName(activeGroup)}” chưa hỗ trợ thêm từ dữ liệu quét.`, 'error')
      return
    }
    setAddMenuOpen(false)
    setScanTargetGroup(activeGroup)
    setShowScanPicker(true)
  }

  const memberRangeStart = memberTotal === 0 ? 0 : (memberPage - 1) * MEMBER_PAGE_SIZE + 1
  const memberRangeEnd = Math.min(memberPage * MEMBER_PAGE_SIZE, memberTotal)
  const groupRangeStart = groupTotal === 0 ? 0 : (groupPage - 1) * GROUP_PAGE_SIZE + 1
  const groupRangeEnd = Math.min(groupPage * GROUP_PAGE_SIZE, groupTotal)
  const importTarget = availableImportTargets.find(item => item.value === importTargetValue)
    || availableImportTargets[0]
    || IMPORT_TARGETS[0]

  const modal = (
    <div className="data-group-manager-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className={`data-group-manager-modal${selectionMode ? ' is-picker' : ''}`} role="dialog" aria-modal="true" aria-label="Quản lý nhóm data">
        <header className="data-group-manager-header">
          <span className="data-group-manager-header-icon"><Folder size={19} /></span>
          <div className="data-group-manager-heading">
            <h2>Quản lý nhóm data</h2>
            <p>Nhóm dùng chung cho mọi tài khoản &amp; loại data · thêm data từ file hoặc từ dữ liệu quét</p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} title="Đóng"><X size={18} /></button>
        </header>

        <div className="data-group-manager-workspace">
          <aside className="data-group-manager-sidebar">
            <div className="data-group-manager-sidebar-head">
              <div className="data-group-manager-section-title">
                <span>Nhóm data</span>
                <span className="data-group-manager-count-pill">{formatCount(groupTotal)} nhóm</span>
              </div>
              <label className="data-group-manager-search-field">
                <Search size={15} />
                <input
                  value={groupSearch}
                  onChange={event => {
                    setGroupSearch(event.target.value)
                    setGroupPage(1)
                  }}
                  placeholder="Tìm nhóm..."
                />
              </label>
              <select
                className="stepper-input data-group-manager-sidebar-type-filter"
                value={groupDataTypeFilterId}
                onChange={event => {
                  setGroupDataTypeFilterId(event.target.value ? Number(event.target.value) : '')
                  setGroupPage(1)
                }}
                disabled={groupsLoading || dataTypesLoading}
                aria-label="Lọc nhóm theo loại data"
              >
                <option value="">Tất cả loại nhóm</option>
                {dataTypeItems.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              {!creatingGroup ? (
                <button type="button" className="btn btn-primary data-group-manager-create-button" onClick={() => {
                  setNewGroupName(createDefaultDataGroupName())
                  setNewGroupDataTypeCategoryItemId('')
                  setCreatingGroup(true)
                }}>
                  <Plus size={15} /> Thêm nhóm
                </button>
              ) : (
                <form className="data-group-manager-create-form" onSubmit={handleCreateGroup}>
                  <div className="data-group-manager-create-name-field">
                    <label htmlFor="data-group-manager-new-name">
                      Tên nhóm dữ liệu<span className="required">*</span>
                    </label>
                    <div className="data-group-manager-create-row">
                      <label className="data-group-color-input" title="Màu nhóm">
                        <span style={{ background: newGroupColor }} />
                        <input type="color" value={newGroupColor} onChange={event => setNewGroupColor(event.target.value)} />
                      </label>
                      <input
                        id="data-group-manager-new-name"
                        className="stepper-input"
                        value={newGroupName}
                        onChange={event => setNewGroupName(event.target.value)}
                        maxLength={255}
                        autoFocus
                        disabled={busyAction === 'create'}
                        required
                        aria-required="true"
                      />
                    </div>
                  </div>
                  <div className="data-group-manager-create-name-field">
                    <label htmlFor="data-group-manager-new-type">Loại data</label>
                    <select
                      id="data-group-manager-new-type"
                      className="stepper-input"
                      value={newGroupDataTypeCategoryItemId}
                      onChange={event => {
                        setNewGroupDataTypeCategoryItemId(event.target.value ? Number(event.target.value) : '')
                      }}
                      disabled={busyAction === 'create' || dataTypesLoading || unrestrictedOnly}
                    >
                      <option value="">Mọi loại dữ liệu</option>
                      {dataTypeItems.map(item => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="data-group-manager-create-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                      setCreatingGroup(false)
                      setNewGroupName('')
                      setNewGroupDataTypeCategoryItemId('')
                    }}>Huỷ</button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={!newGroupName.trim() || busyAction === 'create'}>
                      {busyAction === 'create' ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} Tạo
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="data-group-manager-group-list">
              {apiUnavailable ? (
                <div className="data-group-manager-empty"><Database size={30} /><span>Chức năng nhóm data mới chưa sẵn sàng.</span></div>
              ) : groupsLoading ? (
                <div className="data-group-manager-empty"><LoaderCircle size={24} className="spin" /><span>Đang tải nhóm data...</span></div>
              ) : groups.length === 0 ? (
                <div className="data-group-manager-empty"><Folder size={32} /><span>Chưa có nhóm data.<br />Bấm “Thêm nhóm” để tạo mới.</span></div>
              ) : groups.map(group => {
                const isActive = group.id === activeGroupId
                const isEditing = group.id === editingGroupId
                const rowBusy = busyAction?.endsWith(`:${group.id}`) === true
                return (
                  <div
                    key={group.id}
                    className={`data-group-manager-group-row${isActive ? ' is-active' : ''}${draggedGroupId === group.id ? ' is-dragging' : ''}`}
                    onClick={() => selectGroup(group)}
                    draggable={canReorderGroups && !rowBusy && busyAction !== 'reorder'}
                    onDragStart={event => {
                      if (!canReorderGroups) {
                        event.preventDefault()
                        return
                      }
                      setDraggedGroupId(group.id)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', String(group.id))
                    }}
                    onDragEnd={() => setDraggedGroupId(null)}
                    onDragOver={event => {
                      if (canReorderGroups && draggedGroupId && draggedGroupId !== group.id) {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }
                    }}
                    onDrop={event => {
                      event.preventDefault()
                      event.stopPropagation()
                      void handleDropGroup(group.id)
                    }}
                  >
                    <GripVertical
                      className={`data-group-manager-drag-handle${canReorderGroups ? '' : ' is-disabled'}`}
                      size={14}
                      aria-label={canReorderGroups ? 'Kéo để sắp xếp' : 'Không thể sắp xếp khi danh sách đang được lọc'}
                    />
                    <label className="data-group-color-input is-compact" title="Đổi màu nhóm" onClick={event => event.stopPropagation()}>
                      <span style={{ background: group.color || DEFAULT_GROUP_COLOR }} />
                      <input
                        type="color"
                        value={group.color || DEFAULT_GROUP_COLOR}
                        onChange={event => void handleChangeGroupColor(group, event.target.value)}
                        disabled={rowBusy}
                      />
                    </label>
                    <div className="data-group-manager-group-main">
                      {isEditing ? (
                        <div className="data-group-manager-edit-fields" onClick={event => event.stopPropagation()}>
                          <input
                            className="stepper-input data-group-manager-rename-input"
                            value={editingGroupName}
                            onChange={event => setEditingGroupName(event.target.value)}
                            onKeyDown={event => {
                              if (event.key === 'Enter') void submitRenameGroup(group)
                              if (event.key === 'Escape') setEditingGroupId(null)
                            }}
                            disabled={rowBusy}
                            autoFocus
                            aria-label="Tên nhóm dữ liệu"
                          />
                          <select
                            className="data-group-manager-edit-type-select"
                            value={editingGroupDataTypeCategoryItemId}
                            onChange={event => {
                              setEditingGroupDataTypeCategoryItemId(
                                event.target.value ? Number(event.target.value) : ''
                              )
                            }}
                            disabled={
                              rowBusy
                              || dataTypesLoading
                              || unrestrictedOnly
                              || isDatasetAutoGroup(group)
                            }
                            aria-label="Loại data của nhóm"
                            title={
                              isDatasetAutoGroup(group)
                                ? 'Loại của nhóm tự sinh được đồng bộ từ dataset'
                                : 'Loại data của nhóm'
                            }
                          >
                            <option value="">Mọi loại dữ liệu</option>
                            {getGroupDataTypeId(group) != null
                              && !dataTypeItems.some(item => item.id === getGroupDataTypeId(group)) && (
                              <option value={getGroupDataTypeId(group) || ''}>
                                {getGroupDataTypeName(group)} (ngừng sử dụng)
                              </option>
                            )}
                            {dataTypeItems.map(item => (
                              <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <>
                          <div className="data-group-manager-group-name-row">
                            <div className="data-group-manager-group-name" title={group.name}>{group.name}</div>
                            <button
                              type="button"
                              className="data-group-manager-id-copy"
                              onClick={event => {
                                event.stopPropagation()
                                void copyGroupId(group.id)
                              }}
                              title={`Sao chép ID nhóm ${group.id}`}
                              aria-label={`Sao chép ID nhóm ${group.id}`}
                            >
                              <span>ID: {group.id}</span>
                              <Copy size={11} />
                            </button>
                          </div>
                          <div className="data-group-manager-group-meta">
                            <span>{formatCount(group.activeMembershipCount)} data</span>
                            <span className="data-group-manager-type-badge">{getGroupDataTypeName(group)}</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="data-group-manager-group-actions">
                      {isEditing ? (
                        <>
                          <button type="button" className="btn-icon is-success" onClick={event => {
                            event.stopPropagation()
                            void submitRenameGroup(group)
                          }} disabled={rowBusy} title="Lưu"><Check size={13} /></button>
                          <button type="button" className="btn-icon" onClick={event => {
                            event.stopPropagation()
                            setEditingGroupId(null)
                          }} disabled={rowBusy} title="Huỷ"><X size={13} /></button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn-icon" onClick={event => {
                            event.stopPropagation()
                            startRenameGroup(group)
                          }} title="Đổi tên"><Pencil size={13} /></button>
                          <button type="button" className="btn-icon" onClick={event => {
                            event.stopPropagation()
                            void handleDuplicateGroup(group)
                          }} disabled={rowBusy} title="Nhân bản"><Copy size={13} /></button>
                          <button type="button" className="btn-icon data-group-manager-delete-action" onClick={event => {
                            event.stopPropagation()
                            handleDeleteGroup(group)
                          }} disabled={rowBusy} title="Xoá nhóm"><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {groupPageCount > 1 && (
              <div className="data-group-manager-sidebar-pager">
                <span>{groupRangeStart}–{groupRangeEnd} / {formatCount(groupTotal)}</span>
                <div>
                  <button type="button" className="btn-icon" onClick={() => setGroupPage(page => Math.max(1, page - 1))} disabled={groupPage <= 1 || groupsLoading}><ChevronLeft size={14} /></button>
                  <span>{groupPage}/{groupPageCount}</span>
                  <button type="button" className="btn-icon" onClick={() => setGroupPage(page => Math.min(groupPageCount, page + 1))} disabled={groupPage >= groupPageCount || groupsLoading}><ChevronRight size={14} /></button>
                </div>
              </div>
            )}
          </aside>

          <main className="data-group-manager-content">
            <div className="data-group-manager-active-header">
              <div className="data-group-manager-active-title">
                <span className="data-group-manager-active-color" style={{ background: activeGroup?.color || 'var(--text-tertiary)' }} />
                <div>
                  <div className="data-group-manager-active-name-row">
                    <h3 title={activeGroup?.name}>{activeGroup?.name || 'Chưa chọn nhóm'}</h3>
                    {activeGroup && (
                      <button
                        type="button"
                        className="data-group-manager-id-copy is-active-header"
                        onClick={() => void copyGroupId(activeGroup.id)}
                        title={`Sao chép ID nhóm ${activeGroup.id}`}
                        aria-label={`Sao chép ID nhóm ${activeGroup.id}`}
                      >
                        <span>ID: {activeGroup.id}</span>
                        <Copy size={12} />
                      </button>
                    )}
                  </div>
                  <div className="data-group-manager-active-meta">
                    <span>{activeGroup ? `${formatCount(activeGroup.activeMembershipCount)} data trong nhóm` : 'Chọn một nhóm để xem data'}</span>
                    {activeGroup && (
                      <span
                        className="data-group-manager-type-badge"
                        title={
                          isDatasetAutoGroup(activeGroup)
                            ? 'Loại của nhóm tự sinh được đồng bộ từ dataset'
                            : 'Loại data của nhóm; bấm biểu tượng sửa ở danh sách nhóm để thay đổi'
                        }
                      >
                        {getGroupDataTypeName(activeGroup)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="data-group-manager-context-filters">
                <label>
                  <span>Tài khoản</span>
                  <select value={accountFilterId} onChange={event => {
                    setAccountFilterId(event.target.value ? Number(event.target.value) : '')
                    setMemberPage(1)
                  }} disabled={!activeGroupId || lockContext}>
                    <option value="">Tất cả tài khoản</option>
                    {accountOptions.map(option => (
                      <option key={option.id} value={option.id}>{option.name}{option.deleted ? ' (đã xoá)' : ''}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Loại data</span>
                  <select value={dataTypeFilterId} onChange={event => {
                    setDataTypeFilterId(event.target.value ? Number(event.target.value) : '')
                    setMemberPage(1)
                  }} disabled={!activeGroupId || lockContext || dataTypesLoading}>
                    <option value="">
                      {lockContext && initialContactType
                        ? getContactTypeLabel(initialContactType, initialPlatform)
                        : 'Tất cả loại data'}
                    </option>
                    {dataTypeItems.map(item => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="data-group-manager-filter-bar">
              <label className="data-group-manager-search-field is-member-search">
                <Search size={15} />
                <input
                  value={memberSearch}
                  onChange={event => {
                    setMemberSearch(event.target.value)
                    setMemberPage(1)
                  }}
                  placeholder="Tìm theo tên, UID, SĐT hoặc link..."
                  disabled={!activeGroupId}
                />
              </label>
              <label className="data-group-manager-inline-filter">
                <span>Hiển thị</span>
                <select value={statusFilter} onChange={event => {
                  setStatusFilter(event.target.value as DataGroupMemberStatusFilter)
                  setMemberPage(1)
                }} disabled={!activeGroupId}>
                  {STATUS_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="data-group-manager-inline-filter">
                <span>Danh sách</span>
                <select value={datasetFilterId} onChange={event => {
                  setDatasetFilterId(event.target.value ? Number(event.target.value) : '')
                  setMemberPage(1)
                }} disabled={!activeGroupId}>
                  <option value="">Tất cả danh sách</option>
                  {datasetOptions.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.name}{option.dataTypeName ? ` · ${option.dataTypeName}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="data-group-manager-action-bar">
              {selectedMembershipIds.size > 0 ? (
                <div className="data-group-manager-selection-actions">
                  <span className="data-group-manager-selection-pill">{formatCount(selectedMembershipIds.size)} data đã chọn</span>
                  <button type="button" className="btn btn-secondary btn-sm text-error" onClick={() => removeMemberships(Array.from(selectedMembershipIds), `${formatCount(selectedMembershipIds.size)} data đã chọn`)} disabled={busyAction !== null || selectingAllMembers || memberSearchPending || membersLoading}>
                    <Trash2 size={13} /> Xoá khỏi nhóm
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleOpenMoveModal()} disabled={busyAction !== null || selectingAllMembers || memberSearchPending || membersLoading}>
                    <ArrowRightLeft size={13} /> Chuyển nhóm
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleExport()} disabled={busyAction !== null || selectingAllMembers || memberSearchPending || membersLoading}>
                    {busyAction === 'export' ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />}
                    Xuất Excel
                  </button>
                </div>
              ) : (
                <span className="data-group-manager-action-hint">Chọn data để xoá, chuyển nhóm hoặc xuất file</span>
              )}
              <div className="data-group-manager-action-right">
                <div className="data-group-manager-add-menu-wrap" ref={addMenuRef}>
                  <button type="button" className="btn btn-primary btn-sm data-group-manager-add-button" onClick={() => setAddMenuOpen(open => !open)} disabled={!activeGroupId}>
                    <Plus size={14} /> Thêm data vào nhóm <span className="data-group-manager-add-divider" aria-hidden="true" /> <ChevronDown size={14} />
                  </button>
                  {addMenuOpen && (
                    <div className="data-group-manager-add-menu">
                      <button
                        type="button"
                        onClick={openImportModal}
                        disabled={availableImportTargets.length === 0}
                        title={availableImportTargets.length === 0 ? 'Loại nhóm này chưa hỗ trợ thêm từ file' : undefined}
                      >
                        <span className="is-file"><FileSpreadsheet size={17} /></span>
                        <span><strong>Thêm từ file data</strong><small>Form txt, Excel/CSV hoặc file khách hàng</small></span>
                      </button>
                      <button
                        type="button"
                        onClick={openScanPicker}
                        disabled={availableScanActions.length === 0}
                        title={availableScanActions.length === 0 ? 'Loại nhóm này chưa hỗ trợ thêm từ dữ liệu quét' : undefined}
                      >
                        <span className="is-scan"><Database size={17} /></span>
                        <span><strong>Thêm từ dữ liệu quét</strong><small>Bạn bè, group, like, comment và danh sách đã quét</small></span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="data-group-manager-table-wrap">
              <table className="data-group-manager-table">
                <thead>
                  <tr>
                    <th className="is-checkbox">
                      <input
                        ref={pageSelectionRef}
                        type="checkbox"
                        checked={allMatchingMembersSelected}
                        onChange={() => void toggleAllMatchingMembers()}
                        disabled={memberTotal === 0 || membersLoading || selectingAllMembers || memberSearchPending}
                        aria-label="Chọn toàn bộ data phù hợp bộ lọc"
                        title={selectingAllMembers ? 'Đang chọn toàn bộ data...' : 'Chọn toàn bộ data phù hợp bộ lọc'}
                      />
                    </th>
                    <th>Tên</th>
                    <th>UID</th>
                    <th>Số điện thoại</th>
                    <th>Link</th>
                    <th>Tài khoản</th>
                    <th>Loại data</th>
                    <th>Trạng thái</th>
                    <th className="is-source">Nguồn data</th>
                    <th className="is-automation">Tự động hóa</th>
                    <th className="is-action"></th>
                  </tr>
                </thead>
                <tbody>
                  {!activeGroupId ? (
                    <tr><td colSpan={11}><div className="data-group-manager-table-empty"><Database size={36} /><span>Chọn một nhóm ở bên trái để xem data.</span></div></td></tr>
                  ) : membersLoading ? (
                    <tr><td colSpan={11}><div className="data-group-manager-table-empty"><LoaderCircle size={24} className="spin" /><span>Đang tải data trong nhóm...</span></div></td></tr>
                  ) : members.length === 0 ? (
                    <tr><td colSpan={11}><div className="data-group-manager-table-empty"><Database size={36} /><span>Không có data phù hợp với bộ lọc.</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddMenuOpen(true)}><Plus size={13} /> Thêm data vào nhóm</button></div></td></tr>
                  ) : members.map(member => {
                    const account = getAccountDisplay(member)
                    const status = getMemberStatus(member)
                    const selected = selectedMembershipIds.has(member.id)
                    return (
                      <tr key={member.id} className={selected ? 'is-selected' : ''}>
                        <td className="is-checkbox"><input type="checkbox" checked={selected} onChange={() => toggleMember(member.id)} disabled={selectingAllMembers || memberSearchPending || membersLoading} aria-label={`Chọn ${member.name || 'data'}`} /></td>
                        <td className="is-name" title={(member.provenance || []).length > 0 ? `${member.name || member.email || 'Data'} · ${getMemberSourceText(member)}` : member.name || member.email || undefined}>
                          {(member.provenance || []).length > 0 ? (
                            <button type="button" className="data-group-manager-name-button" onClick={() => setProvenanceMember(member)}>
                              {member.name || member.email || '—'}
                            </button>
                          ) : member.name || member.email || '—'}
                        </td>
                        <td className="is-uid" title={member.uid || member.email || undefined}>{member.uid || member.email || '—'}</td>
                        <td title={member.phone || undefined}>{member.phone || '—'}</td>
                        <td className="is-link" title={member.url || undefined}>{member.url || '—'}</td>
                        <td>
                          {account ? (
                            <span className="data-group-manager-account-cell" title={account.name}>
                              <span>{account.name}</span>
                              {account.deleted && <em>Đã xoá</em>}
                            </span>
                          ) : <span className="data-group-manager-accountless">—</span>}
                        </td>
                        <td><span className="data-group-manager-type-badge">{getMemberDataTypeLabel(member, activeGroup)}</span></td>
                        <td><span className={`data-group-manager-status ${status.tone}`}>{status.label}</span></td>
                        <td className="is-source" title={getMemberSourceText(member) === '—' ? undefined : getMemberSourceText(member)}>
                          {getMemberSourceText(member) === '—' ? '—' : (
                            <button type="button" className="data-group-manager-source-button" onClick={() => setProvenanceMember(member)}>
                              {getMemberSourceText(member)}
                            </button>
                          )}
                        </td>
                        <td className="is-automation" title={getMemberAutomationText(member) === '—' ? undefined : getMemberAutomationText(member)}>
                          {getMemberAutomationText(member) === '—' ? '—' : (
                            <button type="button" className="data-group-manager-source-button" onClick={() => setProvenanceMember(member)}>
                              <Zap size={13} />
                              <span>{getMemberAutomationText(member)}</span>
                            </button>
                          )}
                        </td>
                        <td className="is-action"><button type="button" className="btn-icon data-group-manager-delete-action" onClick={() => removeMemberships([member.id], `“${member.name || member.uid || 'data này'}”`)} title="Xoá khỏi nhóm" disabled={selectingAllMembers || memberSearchPending || membersLoading}><Trash2 size={13} /></button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="data-group-manager-member-pager">
              <span>Hiển thị {formatCount(memberRangeStart)}–{formatCount(memberRangeEnd)} / {formatCount(memberTotal)} data</span>
              <div>
                <button type="button" className="btn-icon" onClick={() => setMemberPage(page => Math.max(1, page - 1))} disabled={memberPage <= 1 || membersLoading}><ChevronLeft size={15} /></button>
                <span>Trang {memberPage}/{memberPageCount}</span>
                <button type="button" className="btn-icon" onClick={() => setMemberPage(page => Math.min(memberPageCount, page + 1))} disabled={memberPage >= memberPageCount || membersLoading}><ChevronRight size={15} /></button>
              </div>
            </div>
          </main>
        </div>

        {selectionMode && (
          <footer className="data-group-manager-picker-footer">
            <div>
              <span className="data-group-manager-active-color" style={{ background: activeGroup?.color || 'var(--text-tertiary)' }} />
              <span>Đang chọn</span>
              <strong>{activeGroup?.name || 'Chưa chọn nhóm'}</strong>
              <small>· {formatCount(activeGroup?.activeMembershipCount || 0)} data</small>
              {activeGroup && (
                <span className="data-group-manager-type-badge">{getGroupDataTypeName(activeGroup)}</span>
              )}
            </div>
            <span className="data-group-manager-picker-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Huỷ</button>
              <button type="button" className="btn btn-primary" onClick={() => {
                if (!activeGroup) return
                onSelectGroup?.(activeGroup)
                onClose()
              }} disabled={!activeGroup}>
                <Check size={14} /> Chọn nhóm data
              </button>
            </span>
          </footer>
        )}

        {copyNotice && (
          <div
            className={`data-group-manager-copy-notice is-${copyNotice.type}`}
            role={copyNotice.type === 'error' ? 'alert' : 'status'}
          >
            {copyNotice.type === 'success' ? <Check size={14} /> : <X size={14} />}
            <span>{copyNotice.message}</span>
          </div>
        )}
      </section>

      {importModalOpen && (
        <CampaignDataUploadModal
          key={importTarget.value}
          platform={importTarget.importPlatform}
          actionId={importTarget.actionId}
          actionName={`Nhóm data · ${importTarget.label}`}
          accountIds={[]}
          title="Thêm data từ file"
          showDatasetName={false}
          layout="data-group"
          submitLabel="Thêm vào nhóm"
          contextSlot={(
            <div className="data-group-file-import-context">
              <div className="data-group-file-import-destination">
                <span
                  className="data-group-manager-active-color"
                  style={{ background: activeGroup?.color || 'var(--text-tertiary)' }}
                />
                <span>Data sẽ được thêm vào nhóm</span>
                <strong>{activeGroup?.name || 'Nhóm data'}</strong>
              </div>
              <label className="data-group-file-import-type" htmlFor="data-group-import-target">
                <span>Loại data</span>
                <select
                  id="data-group-import-target"
                  className="stepper-input"
                  value={importTargetValue}
                  onChange={event => setImportTargetValue(event.target.value)}
                  disabled={busyAction === 'ingest'}
                >
                  {availableImportTargets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}
                </select>
                {activeGroupDataTypeCode && (
                  <small>Nhóm này chỉ nhận data loại {getGroupDataTypeName(activeGroup)}.</small>
                )}
              </label>
            </div>
          )}
          onClose={resetImportModal}
          onInsert={() => undefined}
          onSubmitRows={handleAdvancedImport}
        />
      )}

      {moveModalOpen && (
        <div className="data-group-submodal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget && busyAction !== 'move') setMoveModalOpen(false)
        }}>
          <section className="data-group-move-modal" role="dialog" aria-modal="true" aria-label="Chuyển data sang nhóm khác">
            <header><div><h3>Chuyển data sang nhóm khác</h3><p>{formatCount(selectedMembershipIds.size)} data đã chọn</p></div><button type="button" className="btn-icon" onClick={() => setMoveModalOpen(false)} disabled={busyAction === 'move'}><X size={17} /></button></header>
            <div className="data-group-move-list">
              {moveTargetsLoading ? (
                <div className="data-group-manager-empty"><LoaderCircle size={22} className="spin" /><span>Đang tải nhóm...</span></div>
              ) : moveTargets.length === 0 ? (
                <div className="data-group-manager-empty">
                  <Folder size={28} />
                  <span>
                    {moveOnlyUnrestrictedTargets
                      ? 'Data đã chọn có loại mixed/chưa xác định và chỉ có thể chuyển sang nhóm Mọi loại dữ liệu.'
                      : 'Không có nhóm tương thích nào khác.'}
                  </span>
                </div>
              ) : moveTargets.map(group => (
                <button type="button" key={group.id} className={moveTargetId === group.id ? 'is-selected' : ''} onClick={() => setMoveTargetId(group.id)}>
                  <span className="data-group-manager-active-color" style={{ background: group.color }} />
                  <strong>{group.name}</strong>
                  <small>
                    {formatCount(group.activeMembershipCount)} data · {getGroupDataTypeName(group)}
                  </small>
                  {moveTargetId === group.id && <Check size={15} />}
                </button>
              ))}
            </div>
            <footer><button type="button" className="btn btn-ghost" onClick={() => setMoveModalOpen(false)} disabled={busyAction === 'move'}>Huỷ</button><button type="button" className="btn btn-primary" onClick={() => void handleMoveMemberships()} disabled={!moveTargetId || busyAction === 'move'}>{busyAction === 'move' ? <LoaderCircle size={14} className="spin" /> : <ArrowRightLeft size={14} />} Chuyển nhóm</button></footer>
          </section>
        </div>
      )}

      {deleteGroupCandidate && (
        <div className="data-group-submodal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget && busyAction !== `delete:${deleteGroupCandidate.id}`) {
            setDeleteGroupCandidate(null)
          }
        }}>
          <section className="data-group-delete-modal" role="dialog" aria-modal="true" aria-label="Xoá nhóm data">
            <header>
              <div>
                <h3>Xoá nhóm data</h3>
                <p>“{deleteGroupCandidate.name}”</p>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setDeleteGroupCandidate(null)}
                disabled={busyAction === `delete:${deleteGroupCandidate.id}`}
              >
                <X size={17} />
              </button>
            </header>
            <div className="data-group-delete-body">
              <p>
                Nhóm và membership sẽ được xoá mềm. Campaign input, lịch sử và provenance đã tạo vẫn được giữ nguyên.
              </p>
              <label className="data-group-delete-option">
                <input
                  type="checkbox"
                  checked={detachAutomationsOnDelete}
                  onChange={event => setDetachAutomationsOnDelete(event.target.checked)}
                  disabled={busyAction === `delete:${deleteGroupCandidate.id}`}
                />
                <span>
                  <strong>Gỡ nhóm khỏi automation đang dùng làm nhóm đích</strong>
                  <small>Automation A → B vẫn tiếp tục hoạt động; chỉ ngừng bổ sung kết quả vào nhóm này.</small>
                </span>
              </label>
              <p className="data-group-delete-note">Data gốc trong danh bạ hoặc dataset không bị xoá.</p>
            </div>
            <footer>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDeleteGroupCandidate(null)}
                disabled={busyAction === `delete:${deleteGroupCandidate.id}`}
              >
                Huỷ
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void confirmDeleteGroup()}
                disabled={busyAction === `delete:${deleteGroupCandidate.id}`}
              >
                {busyAction === `delete:${deleteGroupCandidate.id}` ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
                Xoá nhóm
              </button>
            </footer>
          </section>
        </div>
      )}

      {provenanceMember && (
        <div className="data-group-submodal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) setProvenanceMember(null)
        }}>
          <section className="data-group-provenance-modal" role="dialog" aria-modal="true" aria-label="Chi tiết nguồn data">
            <header>
              <div>
                <h3>Chi tiết nguồn data</h3>
                <p>{provenanceMember.name || provenanceMember.uid || provenanceMember.phone || provenanceMember.email || 'Data trong nhóm'}</p>
              </div>
              <button type="button" className="btn-icon" onClick={() => setProvenanceMember(null)}><X size={17} /></button>
            </header>
            <div className="data-group-provenance-list">
              {(provenanceMember.provenance || []).map((source, index) => (
                <article key={source.id || `${source.kind}-${source.createdAt || index}`}>
                  <div className="data-group-provenance-card-header">
                    <span className={`data-group-provenance-kind is-${source.kind}`}>{PROVENANCE_LABELS[source.kind] || source.kind}</span>
                    <span className={`data-group-provenance-state ${source.isCurrent ? 'is-current' : 'is-history'}`}>
                      {source.isCurrent ? 'Hiện hành' : 'Lịch sử'}
                    </span>
                  </div>
                  <div className="data-group-provenance-card-body">
                    <strong>{getProvenanceTitle(source)}</strong>
                    {source.kind === 'automation' && (source.sourceCampaignName || source.targetCampaignName) && (
                      <p>
                        <span>{source.sourceCampaignName || 'Chiến dịch nguồn'}</span>
                        <ArrowRightLeft size={12} />
                        <span>{source.targetCampaignName || 'Chiến dịch đích'}</span>
                      </p>
                    )}
                    {source.sourceAccountId ? (
                      <small>
                        Tài khoản: {source.sourceAccountName || 'Không rõ'}
                        {source.sourceAccountDeleted && <em>Đã xoá</em>}
                      </small>
                    ) : source.kind !== 'automation' && <small>Tài khoản: —</small>}
                    {source.automationDetailStatus && <small>Kết quả tự động hoá: {source.automationDetailStatus}</small>}
                    {(getProvenanceSemanticFields(source).dataTypeName
                      || getProvenanceSemanticFields(source).dataTypeCode) && (
                      <small>
                        Loại data: {getProvenanceSemanticFields(source).dataTypeName
                          || getProvenanceSemanticFields(source).dataTypeCode}
                      </small>
                    )}
                    {source.createdAt && <small>{new Date(source.createdAt).toLocaleString('vi-VN')}</small>}
                  </div>
                </article>
              ))}
            </div>
            <footer>
              <button type="button" className="btn btn-primary" onClick={() => setProvenanceMember(null)}>Đóng</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )

  return createPortal(
    <>
      {modal}
      {showScanPicker && scanTargetGroup && (
        <div className="data-group-scan-layer">
          <Suspense fallback={<div className="data-group-scan-loading"><LoaderCircle size={24} className="spin" /> Đang mở quét data...</div>}>
            <LazyDataScanModal
              initialAction={getInitialScanAction(initialPlatform, initialContactType)}
              initialAccountId={initialAccountId || undefined}
              allowedActions={availableScanActions}
              targetDataGroup={scanTargetGroup}
              onClose={() => {
                setShowScanPicker(false)
                setScanTargetGroup(null)
              }}
              onSelect={(contacts, context) => handleScanSelection(contacts, context, scanTargetGroup.id)}
            />
          </Suspense>
        </div>
      )}
    </>,
    document.body
  )
}
