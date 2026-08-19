import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Cloud,
  Download,
  Edit3,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  HardDrive,
  Image,
  LayoutGrid,
  List,
  MoreVertical,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Trash2,
  Upload,
  Video,
  X
} from 'lucide-react'
import {
  CampaignMediaInput,
  CampaignMediaSnapshot,
  MEDIA_FILE_MAX_SIZE_BYTES,
  MEDIA_IMAGE_MAX_SIZE_BYTES,
  MEDIA_LIBRARY_DEFAULT_MAX_FILES_PER_STAFF,
  MediaClipboardImageInput,
  MediaFile,
  MediaGroup,
  MediaStorageSettings,
  MediaUploadFailure
} from '../../../../shared/types'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import MediaPreviewHover from './MediaPreviewHover'
import { isImageMediaSource, isVideoMediaSource } from './mediaImage'
import {
  IMAGE_FILE_ACCEPT,
  IMAGE_VIDEO_FILE_ACCEPT,
  runtimeMediaSourceMatchesSelectionMode,
  VIDEO_FILE_ACCEPT,
  type MediaSelectionMode
} from '../../../../shared/mediaTypes'

type MediaPickerMode = MediaSelectionMode
type MediaCategory = 'all' | 'image' | 'video' | 'document'
type MediaView = 'grid' | 'large' | 'list'
type MediaSort = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'
type MediaDateFilter = 'all' | 'today' | 'yesterday' | '7-days' | '30-days' | '90-days' | 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'custom'
type MediaOpenMenu = 'sort' | 'extension' | 'date' | null

const MEDIA_GRID_PAGE_SIZE = 24
const MEDIA_LIST_PAGE_SIZE = 100
const MEDIA_GROUP_MANAGE_PAGE_SIZE = 50

const MEDIA_CATEGORY_LABELS: Record<MediaCategory, string> = {
  all: 'Tất cả',
  image: 'Ảnh',
  video: 'Video',
  document: 'File tài liệu'
}

const MEDIA_SORT_OPTIONS: Array<{ value: MediaSort; label: string }> = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'oldest', label: 'Cũ nhất' },
  { value: 'name-asc', label: 'Tên A → Z' },
  { value: 'name-desc', label: 'Tên Z → A' },
  { value: 'size-desc', label: 'Dung lượng lớn nhất' },
  { value: 'size-asc', label: 'Dung lượng nhỏ nhất' }
]

const MEDIA_DATE_OPTIONS: Array<{ value: MediaDateFilter; label: string }> = [
  { value: 'all', label: 'Tất cả thời gian' },
  { value: 'today', label: 'Hôm nay' },
  { value: 'yesterday', label: 'Hôm qua' },
  { value: '7-days', label: '7 ngày qua' },
  { value: '30-days', label: '30 ngày qua' },
  { value: '90-days', label: '90 ngày qua' },
  { value: 'this-month', label: 'Tháng này' },
  { value: 'last-month', label: 'Tháng trước' },
  { value: 'this-quarter', label: 'Quý này' },
  { value: 'this-year', label: 'Năm nay' }
]

interface MediaLibraryModalProps {
  onClose: () => void
  pickerMode?: MediaPickerMode
  maxSelect?: number
  onConfirm?: (items: CampaignMediaSnapshot[]) => void
}

const EMPTY_SETTINGS: MediaStorageSettings = {
  provider: 'r2',
  endpointUrl: '',
  accessKeyId: '',
  secretAccessKey: '',
  bucket: '',
  publicBaseUrl: '',
  keyPrefix: '',
  maxFilesPerStaff: MEDIA_LIBRARY_DEFAULT_MAX_FILES_PER_STAFF
}

const getMediaName = (item: CampaignMediaInput): string => {
  if (typeof item === 'string') return item.split(/[\\/]/).pop() || item
  return item.name || item.localPath?.split(/[\\/]/).pop() || item.cloudUrl?.split('/').pop() || 'Media'
}

const getSnapshotKey = (item: CampaignMediaInput): string => {
  if (typeof item === 'string') return item
  return item.cloudUrl || item.localPath || item.name
}

const fileToSnapshot = (file: MediaFile): CampaignMediaSnapshot => ({
  name: file.originalName,
  localPath: file.localPath || '',
  cloudUrl: file.cloudUrl,
  mimeType: file.mimeType || '',
  sizeBytes: file.sizeBytes ?? null,
  provider: file.provider || 'r2'
})

const getMediaFilePreviewPath = (file: MediaFile): string =>
  file.cloudUrl || file.localPath || ''

const formatBytes = (value?: number | null): string => {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

const isUploadImageFile = (file: File): boolean =>
  isImageMediaSource(file.type, file.name)

const isMediaFileImage = (file: MediaFile): boolean =>
  isImageMediaSource(file.mimeType, file.originalName, file.localPath, file.cloudUrl)

const isMediaFileLocalAvailable = (localPath?: string | null): boolean => {
  const value = String(localPath || '').trim()
  if (!value) return false
  if (/^data:/i.test(value)) return true
  try {
    return window.electronAPI.fileExists(value)
  } catch {
    return false
  }
}

const mediaFileMatchesPickerMode = (file: MediaFile, pickerMode?: MediaPickerMode): boolean =>
  !pickerMode || runtimeMediaSourceMatchesSelectionMode(pickerMode, {
    localPath: file.localPath,
    localPathAvailable: isMediaFileLocalAvailable(file.localPath),
    cloudUrl: file.cloudUrl,
    name: file.originalName,
    mimeType: file.mimeType
  })

const getPickerMediaLabel = (pickerMode?: MediaPickerMode): string => {
  if (pickerMode === 'image') return 'ảnh'
  if (pickerMode === 'video') return 'video'
  if (pickerMode === 'image-video') return 'ảnh/video'
  return 'media'
}

const getPickerInputAccept = (pickerMode?: MediaPickerMode): string | undefined => {
  if (pickerMode === 'image') return IMAGE_FILE_ACCEPT
  if (pickerMode === 'video') return VIDEO_FILE_ACCEPT
  if (pickerMode === 'image-video') return IMAGE_VIDEO_FILE_ACCEPT
  return undefined
}

const getUploadFileSizeLimit = (file: File): number =>
  isUploadImageFile(file) ? MEDIA_IMAGE_MAX_SIZE_BYTES : MEDIA_FILE_MAX_SIZE_BYTES

const getUploadSizeError = (file: File): string => {
  const limit = getUploadFileSizeLimit(file)
  const label = isUploadImageFile(file) ? 'Ảnh' : 'File'
  return `${label} vượt quá dung lượng tối đa ${formatBytes(limit)}.`
}

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error(`Không thể đọc ảnh ${file.name || ''}.`))
  reader.readAsDataURL(file)
})

const normalizeMediaLibraryMaxFiles = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : MEDIA_LIBRARY_DEFAULT_MAX_FILES_PER_STAFF
}

const getMediaQuotaError = (activeCount: number, maxFilesPerStaff: number): string =>
  `Thư viện media đã có ${activeCount}/${maxFilesPerStaff} file. Vui lòng xoá bớt media trước khi upload thêm.`

const formatDateTime = (value?: string): string => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('vi-VN')
}

const formatMediaCardDate = (value?: string): string => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const getMediaExtension = (file: MediaFile): string => {
  const sources = [file.originalName, file.objectKey, file.cloudUrl, file.localPath]
  for (const source of sources) {
    const clean = String(source || '').split(/[?#]/, 1)[0]
    const fileName = clean.split(/[\\/]/).pop() || ''
    const dotIndex = fileName.lastIndexOf('.')
    if (dotIndex > 0 && dotIndex < fileName.length - 1) return fileName.slice(dotIndex + 1).toUpperCase()
  }
  const mimeSubtype = String(file.mimeType || '').split('/')[1]?.split(';')[0]?.trim()
  return mimeSubtype ? mimeSubtype.toUpperCase() : 'FILE'
}

const getMediaCategory = (file: MediaFile): Exclude<MediaCategory, 'all'> => {
  if (isImageMediaSource(file.mimeType, file.originalName, file.localPath, file.cloudUrl)) return 'image'
  if (isVideoMediaSource(file.mimeType, file.originalName, file.localPath, file.cloudUrl)) return 'video'
  return 'document'
}

const getMediaExtensionBadgeClass = (file: MediaFile, compact = false): string => {
  const extension = getMediaExtension(file).toLocaleLowerCase('vi').replace(/[^a-z0-9]+/g, '-')
  return `media-file-extension-badge extension-${extension} ${compact ? 'is-compact' : ''}`.trim()
}

const getMediaTimestamp = (file: MediaFile): number => {
  const value = new Date(file.createdAt || 0).getTime()
  return Number.isFinite(value) ? value : 0
}

const startOfDay = (date: Date): Date => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

const endOfDay = (date: Date): Date => {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

const getMediaDateRange = (
  filter: MediaDateFilter,
  customStart: string,
  customEnd: string
): { start: number; end: number } | null => {
  if (filter === 'all') return null
  const now = new Date()

  if (filter === 'custom') {
    const start = customStart ? startOfDay(new Date(`${customStart}T00:00:00`)).getTime() : Number.NEGATIVE_INFINITY
    const end = customEnd ? endOfDay(new Date(`${customEnd}T00:00:00`)).getTime() : Number.POSITIVE_INFINITY
    return { start, end }
  }

  if (filter === 'today') return { start: startOfDay(now).getTime(), end: endOfDay(now).getTime() }
  if (filter === 'yesterday') {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    return { start: startOfDay(yesterday).getTime(), end: endOfDay(yesterday).getTime() }
  }
  if (filter === 'this-month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      end: endOfDay(now).getTime()
    }
  }
  if (filter === 'last-month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      end: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)).getTime()
    }
  }
  if (filter === 'this-quarter') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
    return {
      start: new Date(now.getFullYear(), quarterStartMonth, 1).getTime(),
      end: endOfDay(now).getTime()
    }
  }
  if (filter === 'this-year') {
    return {
      start: new Date(now.getFullYear(), 0, 1).getTime(),
      end: endOfDay(now).getTime()
    }
  }

  const days = filter === '7-days' ? 7 : filter === '30-days' ? 30 : 90
  const start = startOfDay(now)
  start.setDate(start.getDate() - days + 1)
  return { start: start.getTime(), end: endOfDay(now).getTime() }
}

const sortMediaFiles = (files: MediaFile[], sort: MediaSort): MediaFile[] => {
  const next = [...files]
  next.sort((a, b) => {
    if (sort === 'oldest') return getMediaTimestamp(a) - getMediaTimestamp(b) || a.id - b.id
    if (sort === 'name-asc') return a.originalName.localeCompare(b.originalName, 'vi', { sensitivity: 'base' }) || a.id - b.id
    if (sort === 'name-desc') return b.originalName.localeCompare(a.originalName, 'vi', { sensitivity: 'base' }) || b.id - a.id
    if (sort === 'size-desc') return Number(b.sizeBytes || 0) - Number(a.sizeBytes || 0) || b.id - a.id
    if (sort === 'size-asc') return Number(a.sizeBytes || 0) - Number(b.sizeBytes || 0) || a.id - b.id
    return getMediaTimestamp(b) - getMediaTimestamp(a) || b.id - a.id
  })
  return next
}

const mediaMatchesSearch = (file: MediaFile, query: string): boolean =>
  [
    file.originalName,
    file.localPath || '',
    file.cloudUrl,
    file.mimeType || '',
    file.provider
  ].some(value => String(value).toLowerCase().includes(query))

const normalizeGroupName = (value: string): string => value.replace(/\s+/g, ' ').trim()

export default function MediaLibraryModal({
  onClose,
  pickerMode,
  maxSelect,
  onConfirm
}: MediaLibraryModalProps) {
  const user = useAuthStore(s => s.user)
  const showAlert = useUiStore(s => s.showAlert)
  const showConfirm = useUiStore(s => s.showConfirm)
  const isAdmin = !!user?.isAdminAkabiz
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const deleteSelectAllRef = useRef<HTMLInputElement>(null)
  const uploadInFlightRef = useRef(false)
  const groupMembershipRequestRef = useRef(0)
  const groupSnapshotRequestRef = useRef(0)
  const selectedGroupIdRef = useRef<number | null>(null)
  const [settings, setSettings] = useState<MediaStorageSettings>(EMPTY_SETTINGS)
  const [settingsExpanded, setSettingsExpanded] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [files, setFiles] = useState<MediaFile[]>([])
  const [filesLoading, setFilesLoading] = useState(true)
  const [groups, setGroups] = useState<MediaGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [ungroupedSelected, setUngroupedSelected] = useState(false)
  const [groupIdsByFileId, setGroupIdsByFileId] = useState<Map<number, number[]>>(() => new Map())
  const [groupIndexLoading, setGroupIndexLoading] = useState(true)
  const [groupIndexError, setGroupIndexError] = useState<string | null>(null)
  const [groupFileIds, setGroupFileIds] = useState<Set<number>>(new Set())
  const [groupMembershipLoading, setGroupMembershipLoading] = useState(false)
  const [groupSaving, setGroupSaving] = useState(false)
  const [groupManageMode, setGroupManageMode] = useState(false)
  const [groupFormOpen, setGroupFormOpen] = useState(false)
  const [groupFormName, setGroupFormName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [category, setCategory] = useState<MediaCategory>(() => {
    if (pickerMode === 'video') return 'video'
    if (pickerMode === 'file') return 'document'
    return 'image'
  })
  const [view, setView] = useState<MediaView>('grid')
  const [sort, setSort] = useState<MediaSort>('newest')
  const [openMenu, setOpenMenu] = useState<MediaOpenMenu>(null)
  const [selectedExtensions, setSelectedExtensions] = useState<Set<string>>(() => new Set())
  const [dateFilter, setDateFilter] = useState<MediaDateFilter>('all')
  const [customDateStart, setCustomDateStart] = useState('')
  const [customDateEnd, setCustomDateEnd] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<number>>(() => new Set())
  const [mediaPage, setMediaPage] = useState(1)
  const [availableManagePage, setAvailableManagePage] = useState(1)
  const [groupManagePage, setGroupManagePage] = useState(1)

  const pickerLimit = Math.max(1, maxSelect ?? Number.MAX_SAFE_INTEGER)
  const isPicker = !!onConfirm
  const isSingleSelectPicker = isPicker && pickerLimit === 1
  const pickerMediaLabel = getPickerMediaLabel(pickerMode)
  const activeMediaCount = files.length
  const mediaLibraryMaxFiles = normalizeMediaLibraryMaxFiles(settings.maxFilesPerStaff)
  const canDeleteMedia = !isPicker && selectedGroupId === null
  const allGroupedFileIds = useMemo(
    () => new Set(groupIdsByFileId.keys()),
    [groupIdsByFileId]
  )
  const groupFileOrder = useMemo(
    () => new Map(Array.from(groupFileIds).map((id, index) => [id, index])),
    [groupFileIds]
  )
  const usedStorageBytes = useMemo(
    () => files.reduce((total, file) => total + Math.max(0, Number(file.sizeBytes || 0)), 0),
    [files]
  )
  const quotaPercent = Math.min(100, (activeMediaCount / Math.max(1, mediaLibraryMaxFiles)) * 100)

  const loadSettings = async () => {
    setSettingsLoading(true)
    try {
      const next = await window.electronAPI.getMediaStorageSettings()
      setSettings({ ...EMPTY_SETTINGS, ...next })
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể tải cấu hình media.', 'error')
    } finally {
      setSettingsLoading(false)
    }
  }

  const loadFiles = async () => {
    setFilesLoading(true)
    try {
      setFiles(await window.electronAPI.listMediaFiles())
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể tải thư viện media.', 'error')
    } finally {
      setFilesLoading(false)
    }
  }

  const loadGroups = async () => {
    const requestId = groupSnapshotRequestRef.current + 1
    groupSnapshotRequestRef.current = requestId
    setGroupsLoading(true)
    setGroupIndexLoading(true)
    setGroupIndexError(null)
    try {
      const snapshot = await window.electronAPI.listMediaGroups()
      if (requestId !== groupSnapshotRequestRef.current) return
      const rows = snapshot.groups
      const next = new Map<number, number[]>()
      for (const membership of snapshot.memberships) {
        const groupIds = next.get(membership.mediaFileId)
        if (groupIds) groupIds.push(membership.groupId)
        else next.set(membership.mediaFileId, [membership.groupId])
      }
      setGroups(rows)
      setGroupIdsByFileId(next)
      setSelectedGroupId(current => current && rows.some(group => group.id === current) ? current : null)
    } catch (err) {
      if (requestId !== groupSnapshotRequestRef.current) return
      const message = err instanceof Error ? err.message : 'Không thể tải thư mục media.'
      setGroupIndexError(message)
      showAlert(message, 'error')
    } finally {
      if (requestId !== groupSnapshotRequestRef.current) return
      setGroupsLoading(false)
      setGroupIndexLoading(false)
    }
  }

  const loadGroupFileIds = async (groupId: number, requestId = groupMembershipRequestRef.current) => {
    setGroupMembershipLoading(true)
    try {
      const ids = await window.electronAPI.listMediaGroupFileIds(groupId)
      if (requestId !== groupMembershipRequestRef.current) return
      const next = new Set(ids)
      setGroupFileIds(next)
    } catch (err) {
      if (requestId !== groupMembershipRequestRef.current) return
      showAlert(err instanceof Error ? err.message : 'Không thể tải media trong thư mục.', 'error')
      setGroupFileIds(new Set())
    } finally {
      if (requestId !== groupMembershipRequestRef.current) return
      setGroupMembershipLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
    void loadFiles()
    void loadGroups()
  }, [])

  useEffect(() => {
    selectedGroupIdRef.current = selectedGroupId

    const requestId = groupMembershipRequestRef.current + 1
    groupMembershipRequestRef.current = requestId

    if (!selectedGroupId) {
      setGroupFileIds(new Set())
      setGroupMembershipLoading(false)
      return
    }

    void loadGroupFileIds(selectedGroupId, requestId)
  }, [selectedGroupId])

  const groupScopedFiles = useMemo(
    () => ungroupedSelected
      ? groupIndexError ? [] : files.filter(file => !allGroupedFileIds.has(file.id))
      : selectedGroupId ? files.filter(file => groupFileIds.has(file.id)) : files,
    [allGroupedFileIds, files, groupFileIds, groupIndexError, selectedGroupId, ungroupedSelected]
  )
  const ungroupedFileCount = files.reduce((count, file) => count + (allGroupedFileIds.has(file.id) ? 0 : 1), 0)
  const categoryCounts = useMemo(() => ({
    all: groupScopedFiles.length,
    image: groupScopedFiles.filter(file => getMediaCategory(file) === 'image').length,
    video: groupScopedFiles.filter(file => getMediaCategory(file) === 'video').length,
    document: groupScopedFiles.filter(file => getMediaCategory(file) === 'document').length
  }), [groupScopedFiles])
  const extensionOptions = useMemo(() => {
    const counts = new Map<string, { count: number; category: Exclude<MediaCategory, 'all'> }>()
    for (const file of groupScopedFiles) {
      if (category !== 'all' && getMediaCategory(file) !== category) continue
      const extension = getMediaExtension(file)
      const current = counts.get(extension)
      counts.set(extension, {
        count: (current?.count || 0) + 1,
        category: current?.category || getMediaCategory(file)
      })
    }
    return Array.from(counts.entries())
      .map(([extension, metadata]) => ({ extension, ...metadata }))
      .sort((a, b) => a.extension.localeCompare(b.extension, 'vi'))
  }, [category, groupScopedFiles])
  const dateRange = useMemo(
    () => getMediaDateRange(dateFilter, customDateStart, customDateEnd),
    [customDateEnd, customDateStart, dateFilter]
  )
  const matchesCurrentMediaFilters = (file: MediaFile, query: string): boolean => {
    if (category !== 'all' && getMediaCategory(file) !== category) return false
    if (selectedExtensions.size > 0 && !selectedExtensions.has(getMediaExtension(file))) return false
    if (dateRange) {
      const timestamp = getMediaTimestamp(file)
      if (timestamp < dateRange.start || timestamp > dateRange.end) return false
    }
    return !query || mediaMatchesSearch(file, query)
  }
  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = groupScopedFiles.filter(file => matchesCurrentMediaFilters(file, q))
    return sortMediaFiles(rows, sort)
  }, [category, dateRange, groupScopedFiles, search, selectedExtensions, sort])
  const dateOptionCounts = useMemo(() => {
    const query = search.trim().toLowerCase()
    const baseFiles = groupScopedFiles.filter(file => {
      if (category !== 'all' && getMediaCategory(file) !== category) return false
      if (selectedExtensions.size > 0 && !selectedExtensions.has(getMediaExtension(file))) return false
      return !query || mediaMatchesSearch(file, query)
    })
    return new Map(MEDIA_DATE_OPTIONS.map(option => {
      const range = getMediaDateRange(option.value, customDateStart, customDateEnd)
      const count = !range ? baseFiles.length : baseFiles.filter(file => {
        const timestamp = getMediaTimestamp(file)
        return timestamp >= range.start && timestamp <= range.end
      }).length
      return [option.value, count] as const
    }))
  }, [category, customDateEnd, customDateStart, groupScopedFiles, search, selectedExtensions])

  const mediaPageSize = category === 'all'
    ? Number.MAX_SAFE_INTEGER
    : view === 'list' ? MEDIA_LIST_PAGE_SIZE : MEDIA_GRID_PAGE_SIZE
  const mediaPageCount = Math.max(1, Math.ceil(filteredFiles.length / mediaPageSize))
  const resolvedMediaPage = Math.min(mediaPage, mediaPageCount)
  const pagedFiles = useMemo(() => {
    const start = (resolvedMediaPage - 1) * mediaPageSize
    return filteredFiles.slice(start, start + mediaPageSize)
  }, [filteredFiles, mediaPageSize, resolvedMediaPage])

  const visibleDeleteIds = useMemo(
    () => canDeleteMedia ? pagedFiles.map(file => file.id) : [],
    [canDeleteMedia, pagedFiles]
  )
  const selectedDeleteFiles = useMemo(
    () => files.filter(file => selectedDeleteIds.has(file.id)),
    [files, selectedDeleteIds]
  )
  const allVisibleDeleteSelected = visibleDeleteIds.length > 0
    && visibleDeleteIds.every(id => selectedDeleteIds.has(id))
  const someVisibleDeleteSelected = visibleDeleteIds.some(id => selectedDeleteIds.has(id))

  useEffect(() => {
    if (!deleteSelectAllRef.current) return
    deleteSelectAllRef.current.indeterminate = someVisibleDeleteSelected && !allVisibleDeleteSelected
  }, [allVisibleDeleteSelected, someVisibleDeleteSelected])

  useEffect(() => {
    const existingIds = new Set(files.map(file => file.id))
    setSelectedDeleteIds(current => {
      const next = new Set(Array.from(current).filter(id => existingIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [files])

  const selectedGroupSnapshots = useMemo(() => {
    if (!selectedGroupId) return []
    return files
      .filter(file => groupFileIds.has(file.id))
      .filter(file => mediaFileMatchesPickerMode(file, pickerMode))
      .sort((a, b) => (groupFileOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (groupFileOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id - b.id)
      .map(fileToSnapshot)
  }, [files, groupFileIds, groupFileOrder, pickerMode, selectedGroupId])

  const selectedSnapshots = useMemo(() => {
    const filesByKey = new Map(files.map(file => [getSnapshotKey(fileToSnapshot(file)), file]))
    return Array.from(selectedKeys)
      .map(key => {
        const file = filesByKey.get(key)
        if (!file) return null
        if (!mediaFileMatchesPickerMode(file, pickerMode)) return null
        return fileToSnapshot(file)
      })
      .filter((item): item is CampaignMediaSnapshot => !!item)
  }, [files, pickerMode, selectedKeys])

  const groupManageFiles = useMemo(() => {
    if (!selectedGroupId) return []
    return files
      .filter(file => groupFileIds.has(file.id))
      .sort((a, b) => (groupFileOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (groupFileOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id - b.id)
  }, [files, groupFileIds, groupFileOrder, selectedGroupId])

  const groupAvailableFiles = useMemo(() => {
    if (!selectedGroupId) return []
    return files.filter(file => !groupFileIds.has(file.id))
  }, [files, groupFileIds, selectedGroupId])

  const visibleAvailableGroupManageFiles = useMemo(() => {
    if (!selectedGroupId) return []
    const q = search.trim().toLowerCase()
    return sortMediaFiles(groupAvailableFiles.filter(file => matchesCurrentMediaFilters(file, q)), sort)
  }, [category, dateRange, groupAvailableFiles, search, selectedExtensions, selectedGroupId, sort])

  const visibleGroupManageFiles = useMemo(() => {
    if (!selectedGroupId) return []
    const q = search.trim().toLowerCase()
    return sortMediaFiles(groupManageFiles.filter(file => matchesCurrentMediaFilters(file, q)), sort)
  }, [category, dateRange, groupManageFiles, search, selectedExtensions, selectedGroupId, sort])

  const availableManagePageCount = Math.max(1, Math.ceil(visibleAvailableGroupManageFiles.length / MEDIA_GROUP_MANAGE_PAGE_SIZE))
  const resolvedAvailableManagePage = Math.min(availableManagePage, availableManagePageCount)
  const pagedAvailableGroupManageFiles = useMemo(() => {
    const start = (resolvedAvailableManagePage - 1) * MEDIA_GROUP_MANAGE_PAGE_SIZE
    return visibleAvailableGroupManageFiles.slice(start, start + MEDIA_GROUP_MANAGE_PAGE_SIZE)
  }, [resolvedAvailableManagePage, visibleAvailableGroupManageFiles])

  const groupManagePageCount = Math.max(1, Math.ceil(visibleGroupManageFiles.length / MEDIA_GROUP_MANAGE_PAGE_SIZE))
  const resolvedGroupManagePage = Math.min(groupManagePage, groupManagePageCount)
  const pagedGroupManageFiles = useMemo(() => {
    const start = (resolvedGroupManagePage - 1) * MEDIA_GROUP_MANAGE_PAGE_SIZE
    return visibleGroupManageFiles.slice(start, start + MEDIA_GROUP_MANAGE_PAGE_SIZE)
  }, [resolvedGroupManagePage, visibleGroupManageFiles])

  useEffect(() => {
    setMediaPage(1)
    setAvailableManagePage(1)
    setGroupManagePage(1)
  }, [category, dateFilter, groupManageMode, search, selectedExtensions, selectedGroupId, sort, ungroupedSelected, view])

  const handleSaveSettings = async () => {
    if (!isAdmin || settingsSaving) return
    setSettingsSaving(true)
    try {
      const saved = await window.electronAPI.saveMediaStorageSettings(settings)
      setSettings({ ...EMPTY_SETTINGS, ...saved })
      showAlert('Đã lưu cấu hình media.', 'success')
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể lưu cấu hình media.', 'error')
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleTestSettings = async () => {
    if (!isAdmin || settingsSaving) return
    setSettingsSaving(true)
    try {
      await window.electronAPI.testMediaStorageSettings(settings)
      showAlert('Kết nối upload media thành công.', 'success')
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể test cấu hình media.', 'error')
    } finally {
      setSettingsSaving(false)
    }
  }

  const selectGroup = (groupId: number | null) => {
    const groupChanged = selectedGroupId !== groupId
    if (groupChanged) {
      setGroupFileIds(new Set())
      setGroupMembershipLoading(!!groupId)
    }
    setGroupManageMode(false)
    setSelectedDeleteIds(new Set())
    setOpenMenu(null)
    setUngroupedSelected(false)
    setSelectedGroupId(groupId)
  }

  const selectUngrouped = () => {
    if (groupIndexLoading || groupIndexError) return
    setGroupFileIds(new Set())
    setGroupMembershipLoading(false)
    setGroupManageMode(false)
    setSelectedDeleteIds(new Set())
    setOpenMenu(null)
    setSelectedGroupId(null)
    setUngroupedSelected(true)
  }

  const resetGroupForm = () => {
    setGroupFormName('')
    setEditingGroupId(null)
    setGroupFormOpen(false)
  }

  const handleSaveGroup = async () => {
    if (groupSaving) return
    const name = normalizeGroupName(groupFormName)
    if (!name) {
      showAlert('Vui lòng nhập tên thư mục media.', 'error')
      return
    }

    setGroupSaving(true)
    try {
      if (editingGroupId) {
        const updated = await window.electronAPI.updateMediaGroup(editingGroupId, { name })
        setGroups(current => current.map(group => group.id === updated.id ? { ...group, ...updated } : group))
        showAlert('Đã cập nhật thư mục media.', 'success')
      } else {
        const created = await window.electronAPI.createMediaGroup({ name })
        setGroups(current => [created, ...current])
        selectGroup(created.id)
        showAlert('Đã tạo thư mục media.', 'success')
      }
      resetGroupForm()
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể lưu thư mục media.', 'error')
    } finally {
      setGroupSaving(false)
    }
  }

  const handleEditGroup = (group: MediaGroup) => {
    setGroupFormName(group.name)
    setEditingGroupId(group.id)
    setGroupFormOpen(true)
  }

  const handleDeleteGroup = (group: MediaGroup) => {
    showConfirm(
      `Xoá thư mục media "${group.name}"? Media trong thư mục sẽ không bị xoá.`,
      async () => {
        setGroupSaving(true)
        try {
          await window.electronAPI.deleteMediaGroup(group.id)
          setGroups(current => current.filter(item => item.id !== group.id))
          setGroupIdsByFileId(current => {
            const next = new Map<number, number[]>()
            current.forEach((groupIds, mediaFileId) => {
              const remainingGroupIds = groupIds.filter(groupId => groupId !== group.id)
              if (remainingGroupIds.length > 0) next.set(mediaFileId, remainingGroupIds)
            })
            return next
          })
          if (selectedGroupId === group.id) selectGroup(null)
          if (editingGroupId === group.id) resetGroupForm()
          showAlert('Đã xoá thư mục media.', 'success')
        } catch (err) {
          showAlert(err instanceof Error ? err.message : 'Không thể xoá thư mục media.', 'error')
        } finally {
          setGroupSaving(false)
        }
      },
      { title: 'Xoá thư mục media', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const applySavedGroupFileIds = (groupId: number, savedIds: number[]) => {
    const next = new Set(savedIds)
    if (selectedGroupIdRef.current === groupId) setGroupFileIds(next)
    setGroups(current => current.map(group => group.id === groupId ? { ...group, fileCount: savedIds.length } : group))
    setGroupIdsByFileId(current => {
      const updated = new Map<number, number[]>()
      current.forEach((groupIds, mediaFileId) => {
        const remainingGroupIds = groupIds.filter(id => id !== groupId)
        if (remainingGroupIds.length > 0) updated.set(mediaFileId, remainingGroupIds)
      })
      for (const mediaFileId of savedIds) {
        updated.set(mediaFileId, [...(updated.get(mediaFileId) || []), groupId])
      }
      return updated
    })
  }

  const handleAddToGroup = async (file: MediaFile) => {
    if (!selectedGroupId || groupSaving || groupMembershipLoading || groupFileIds.has(file.id)) return
    const groupId = selectedGroupId
    setGroupSaving(true)
    try {
      const savedIds = await window.electronAPI.addMediaGroupFiles(groupId, [file.id])
      applySavedGroupFileIds(groupId, savedIds)
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể thêm media vào thư mục.', 'error')
    } finally {
      setGroupSaving(false)
    }
  }

  const handleRemoveFromGroup = async (file: MediaFile) => {
    if (!selectedGroupId || groupSaving || groupMembershipLoading) return
    const groupId = selectedGroupId
    setGroupSaving(true)
    try {
      const savedIds = await window.electronAPI.removeMediaGroupFiles(groupId, [file.id])
      applySavedGroupFileIds(groupId, savedIds)
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể bỏ media khỏi thư mục.', 'error')
    } finally {
      setGroupSaving(false)
    }
  }

  const handleRefresh = () => {
    void loadFiles()
    void loadGroups()
    if (selectedGroupId) {
      const requestId = groupMembershipRequestRef.current + 1
      groupMembershipRequestRef.current = requestId
      void loadGroupFileIds(selectedGroupId, requestId)
    }
  }

  const applyUploadResult = async (uploaded: MediaFile[], failures: MediaUploadFailure[] = []) => {
    setFiles(current => [...uploaded, ...current])

    let groupMembershipError = ''
    if (selectedGroupId && uploaded.length > 0) {
      const groupId = selectedGroupId
      try {
        const savedIds = await window.electronAPI.addMediaGroupFiles(groupId, uploaded.map(file => file.id))
        applySavedGroupFileIds(groupId, savedIds)
      } catch (err) {
        groupMembershipError = err instanceof Error ? err.message : 'Không thể lưu thư mục media.'
        if (selectedGroupIdRef.current === groupId) selectGroup(null)
      }
    }

    if (isPicker) {
      setSelectedKeys(current => {
        const eligibleUploaded = uploaded.filter(file => mediaFileMatchesPickerMode(file, pickerMode))
        const next = pickerLimit === 1 && eligibleUploaded.length > 0
          ? new Set<string>()
          : new Set(current)
        for (const file of eligibleUploaded) {
          if (next.size >= pickerLimit) break
          next.add(getSnapshotKey(fileToSnapshot(file)))
        }
        return next
      })
    }

    if (groupMembershipError) {
      const uploadFailureSuffix = failures.length > 0 ? `\nNgoài ra, ${failures.length} file upload lỗi.` : ''
      showAlert(
        `Đã upload ${uploaded.length} file nhưng chưa thêm được vào thư mục: ${groupMembershipError}${uploadFailureSuffix}`,
        'error'
      )
      return
    }

    if (uploaded.length > 0 && failures.length === 0) {
      showAlert(`Đã upload ${uploaded.length} file.`, 'success')
    } else if (uploaded.length > 0) {
      const failedDetails = failures.slice(0, 3).map(item => `${getMediaName(item.localPath)}: ${item.error}`).join('\n')
      const suffix = failures.length > 3 ? `\n...và ${failures.length - 3} file khác` : ''
      showAlert(`Đã upload ${uploaded.length} file, ${failures.length} file lỗi:\n${failedDetails}${suffix}`, 'info')
    } else {
      const failedMessage = failures.slice(0, 2).map(item => `${getMediaName(item.localPath)}: ${item.error}`).join('\n')
      showAlert(failedMessage || 'Upload media thất bại.', 'error')
    }
  }

  const canStartUpload = (): boolean => {
    if (uploading || uploadInFlightRef.current) return false
    if (settingsLoading) {
      showAlert('Đang tải cấu hình media. Vui lòng thử lại.', 'info')
      return false
    }
    if (!settings.isConfigured) {
      showAlert('Kho media chưa được cấu hình upload.', 'error')
      return false
    }
    if (selectedGroupId && groupMembershipLoading) {
      showAlert('Đang tải thư mục media. Vui lòng thử lại.', 'info')
      return false
    }
    return true
  }

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (rawFiles.length === 0 || !canStartUpload()) return

    if (activeMediaCount + rawFiles.length > mediaLibraryMaxFiles) {
      showAlert(getMediaQuotaError(activeMediaCount, mediaLibraryMaxFiles), 'error')
      return
    }

    const oversizedFiles = rawFiles.filter(file => file.size > getUploadFileSizeLimit(file))
    const rejectedBySize: MediaUploadFailure[] = oversizedFiles
      .map(file => ({ localPath: file.name, error: getUploadSizeError(file) }))
    const oversizedSet = new Set(oversizedFiles)
    const uploadFiles = rawFiles.filter(file => !oversizedSet.has(file))
    const paths = uploadFiles
      .map(file => {
        try {
          return window.electronAPI.getPathForFile(file)
        } catch {
          return ''
        }
      })
      .filter(Boolean)

    if (paths.length === 0) {
      if (rejectedBySize.length > 0) {
        const failedMessage = rejectedBySize.slice(0, 2).map(item => `${item.localPath}: ${item.error}`).join('\n')
        showAlert(failedMessage, 'error')
      } else {
        showAlert('Không xác định được đường dẫn file.', 'error')
      }
      return
    }

    uploadInFlightRef.current = true
    setUploading(true)
    try {
      const result = await window.electronAPI.uploadMediaFiles(paths)
      await applyUploadResult(result.files || [], [...rejectedBySize, ...(result.failures || [])])
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Upload media thất bại.', 'error')
    } finally {
      uploadInFlightRef.current = false
      setUploading(false)
    }
  }

  const uploadClipboardFiles = async (rawFiles: File[]) => {
    if (rawFiles.length === 0 || !canStartUpload()) return
    if (activeMediaCount + rawFiles.length > mediaLibraryMaxFiles) {
      showAlert(getMediaQuotaError(activeMediaCount, mediaLibraryMaxFiles), 'error')
      return
    }

    const imageFiles = rawFiles.filter(isUploadImageFile)
    if (imageFiles.length === 0) return
    const oversizedFiles = imageFiles.filter(file => file.size > MEDIA_IMAGE_MAX_SIZE_BYTES)
    const rejectedBySize: MediaUploadFailure[] = oversizedFiles
      .map(file => ({ localPath: file.name || 'Ảnh dán', error: getUploadSizeError(file) }))
    const oversizedSet = new Set(oversizedFiles)
    const acceptedFiles = imageFiles.filter(file => !oversizedSet.has(file))

    uploadInFlightRef.current = true
    setUploading(true)
    try {
      const payload: MediaClipboardImageInput[] = []
      const readFailures: MediaUploadFailure[] = []
      for (let index = 0; index < acceptedFiles.length; index += 1) {
        const file = acceptedFiles[index]
        const name = file.name || `pasted-image-${Date.now()}-${index + 1}.png`
        try {
          payload.push({
            name,
            dataUrl: await readFileAsDataUrl(file),
            mimeType: file.type || 'image/png',
            sizeBytes: file.size
          })
        } catch (err) {
          readFailures.push({
            localPath: name,
            error: err instanceof Error ? err.message : 'Không thể đọc ảnh dán.'
          })
        }
      }

      if (payload.length === 0) {
        await applyUploadResult([], [...rejectedBySize, ...readFailures])
        return
      }
      const result = await window.electronAPI.uploadMediaClipboardImages(payload)
      await applyUploadResult(result.files || [], [...rejectedBySize, ...readFailures, ...(result.failures || [])])
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Upload ảnh dán thất bại.', 'error')
    } finally {
      uploadInFlightRef.current = false
      setUploading(false)
    }
  }

  useEffect(() => {
    const handleDocumentPaste = (event: ClipboardEvent) => {
      const imageFiles = Array.from(event.clipboardData?.items || [])
        .filter(item => isImageMediaSource(item.type))
        .map(item => item.getAsFile())
        .filter((file): file is File => !!file)
      if (imageFiles.length === 0) return
      event.preventDefault()
      void uploadClipboardFiles(imageFiles)
    }

    document.addEventListener('paste', handleDocumentPaste)
    return () => document.removeEventListener('paste', handleDocumentPaste)
  }, [activeMediaCount, groupMembershipLoading, isPicker, mediaLibraryMaxFiles, pickerLimit, pickerMode, selectedGroupId, settings.isConfigured, settingsLoading, uploading])

  const handleDelete = (file: MediaFile) => {
    if (deleting) return
    showConfirm(
      `Xoá media "${file.originalName}" khỏi thư viện?`,
      async () => {
        try {
          await window.electronAPI.deleteMediaFile(file.id)
          setFiles(current => current.filter(item => item.id !== file.id))
          setSelectedKeys(current => {
            const next = new Set(current)
            next.delete(getSnapshotKey(fileToSnapshot(file)))
            return next
          })
          setGroupFileIds(current => {
            const next = new Set(current)
            next.delete(file.id)
            return next
          })
          void loadGroups()
        } catch (err) {
          showAlert(err instanceof Error ? err.message : 'Không thể xoá media.', 'error')
        }
      },
      { title: 'Xoá media', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const toggleDeleteSelect = (fileId: number) => {
    if (!canDeleteMedia || deleting) return
    setSelectedDeleteIds(current => {
      const next = new Set(current)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  const toggleAllVisibleDelete = () => {
    if (!canDeleteMedia || deleting || visibleDeleteIds.length === 0) return
    setSelectedDeleteIds(current => {
      const next = new Set(current)
      for (const id of visibleDeleteIds) {
        if (allVisibleDeleteSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const handleBulkDelete = () => {
    if (deleting || selectedDeleteFiles.length === 0) return
    const filesToDelete = [...selectedDeleteFiles]
    const idsToDelete = filesToDelete.map(file => file.id)
    showConfirm(
      `Xoá ${idsToDelete.length} media đã chọn khỏi thư viện?`,
      async () => {
        setDeleting(true)
        try {
          const deletedIds = await window.electronAPI.deleteMediaFiles(idsToDelete)
          const deletedIdSet = new Set(deletedIds)
          const deletedKeys = new Set(
            filesToDelete
              .filter(file => deletedIdSet.has(file.id))
              .map(file => getSnapshotKey(fileToSnapshot(file)))
          )
          setFiles(current => current.filter(file => !deletedIdSet.has(file.id)))
          setSelectedDeleteIds(current => new Set(Array.from(current).filter(id => !deletedIdSet.has(id))))
          setSelectedKeys(current => new Set(Array.from(current).filter(key => !deletedKeys.has(key))))
          setGroupFileIds(current => new Set(Array.from(current).filter(id => !deletedIdSet.has(id))))
          await loadGroups()
          showAlert(
            deletedIds.length === idsToDelete.length
              ? `Đã xoá ${deletedIds.length} media.`
              : `Đã xoá ${deletedIds.length}/${idsToDelete.length} media. Vui lòng tải lại để kiểm tra các media còn lại.`,
            deletedIds.length === idsToDelete.length ? 'success' : 'info'
          )
        } catch (err) {
          showAlert(err instanceof Error ? err.message : 'Không thể xoá media.', 'error')
        } finally {
          setDeleting(false)
        }
      },
      { title: 'Xoá media', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleAddSelectedToGroup = async (groupId: number) => {
    if (groupSaving || selectedDeleteFiles.length === 0) return
    setGroupSaving(true)
    try {
      const savedIds = await window.electronAPI.addMediaGroupFiles(groupId, selectedDeleteFiles.map(file => file.id))
      applySavedGroupFileIds(groupId, savedIds)
      setSelectedDeleteIds(new Set())
      const group = groups.find(item => item.id === groupId)
      showAlert(`Đã thêm ${selectedDeleteFiles.length} media vào nhóm "${group?.name || ''}".`, 'success')
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể thêm media vào nhóm.', 'error')
    } finally {
      setGroupSaving(false)
    }
  }

  const handleDownloadSelected = async () => {
    if (downloading || selectedDeleteFiles.length === 0) return
    setDownloading(true)
    try {
      const result = await window.electronAPI.downloadMediaFiles(selectedDeleteFiles.map(file => file.id))
      if (result.canceled) return
      if (result.failed === 0) showAlert(`Đã tải xuống ${result.downloaded} media.`, 'success')
      else if (result.downloaded > 0) showAlert(`Đã tải xuống ${result.downloaded}/${result.downloaded + result.failed} media.`, 'info')
      else showAlert('Không thể tải xuống media đã chọn. Vui lòng kiểm tra kết nối kho media.', 'error')
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể tải xuống media đã chọn.', 'error')
    } finally {
      setDownloading(false)
    }
  }

  const toggleExtension = (extension: string) => {
    setSelectedExtensions(current => {
      const next = new Set(current)
      if (next.has(extension)) next.delete(extension)
      else next.add(extension)
      return next
    })
  }

  const clearMediaFilters = () => {
    setSelectedExtensions(new Set())
    setDateFilter('all')
    setCustomDateStart('')
    setCustomDateEnd('')
    setOpenMenu(null)
  }

  const toggleSelect = (file: MediaFile) => {
    if (!isPicker) return
    if (!mediaFileMatchesPickerMode(file, pickerMode)) return
    const key = getSnapshotKey(fileToSnapshot(file))
    setSelectedKeys(current => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        if (pickerLimit === 1) next.clear()
        if (next.size >= pickerLimit) return current
        next.add(key)
      }
      return next
    })
  }

  const toggleMediaSelection = (file: MediaFile) => {
    if (isPicker) toggleSelect(file)
    else if (canDeleteMedia) toggleDeleteSelect(file.id)
  }

  const isMediaSelected = (file: MediaFile): boolean => {
    if (isPicker) return selectedKeys.has(getSnapshotKey(fileToSnapshot(file)))
    return selectedDeleteIds.has(file.id)
  }

  const handleConfirm = () => {
    if (!onConfirm) return
    onConfirm(selectedSnapshots)
    onClose()
  }

  const handleConfirmGroup = () => {
    if (!onConfirm || !selectedGroupId || isSingleSelectPicker) return
    if (selectedGroupSnapshots.length === 0) {
      showAlert(`Thư mục này không có ${pickerMediaLabel} hợp lệ.`, 'error')
      return
    }
    if (selectedGroupSnapshots.length > pickerLimit) {
      showAlert(`Chỉ có thể chọn tối đa ${pickerLimit} media.`, 'error')
      return
    }
    onConfirm(selectedGroupSnapshots)
    onClose()
  }

  const renderSettings = () => {
    if (!isAdmin || !settingsExpanded) return null
    return (
      <section className="media-library-section media-settings-panel">
        <div className="media-settings-head">
          <div className="media-library-section-title">
            <Cloud size={16} />
            <span>Cấu hình cloud</span>
          </div>
          <button type="button" className="btn-icon" onClick={() => setSettingsExpanded(false)} title="Đóng cấu hình">
            <X size={14} />
          </button>
        </div>
        <div className="media-settings-grid">
          <label>
            <span>Provider</span>
            <input className="stepper-input" value={settings.provider} onChange={e => setSettings(p => ({ ...p, provider: e.target.value }))} disabled={settingsSaving || settingsLoading} />
          </label>
          <label>
            <span>Endpoint URL</span>
            <input className="stepper-input" value={settings.endpointUrl} onChange={e => setSettings(p => ({ ...p, endpointUrl: e.target.value }))} disabled={settingsSaving || settingsLoading} />
          </label>
          <label>
            <span>Access key ID</span>
            <input className="stepper-input" value={settings.accessKeyId} onChange={e => setSettings(p => ({ ...p, accessKeyId: e.target.value }))} disabled={settingsSaving || settingsLoading} />
          </label>
          <label>
            <span>Secret access key</span>
            <input className="stepper-input" type="password" value={settings.secretAccessKey || ''} onChange={e => setSettings(p => ({ ...p, secretAccessKey: e.target.value }))} disabled={settingsSaving || settingsLoading} />
          </label>
          <label>
            <span>Bucket</span>
            <input className="stepper-input" value={settings.bucket} onChange={e => setSettings(p => ({ ...p, bucket: e.target.value }))} disabled={settingsSaving || settingsLoading} />
          </label>
          <label>
            <span>Public base URL</span>
            <input className="stepper-input" value={settings.publicBaseUrl} onChange={e => setSettings(p => ({ ...p, publicBaseUrl: e.target.value }))} disabled={settingsSaving || settingsLoading} />
          </label>
          <label>
            <span>Key prefix</span>
            <input className="stepper-input" value={settings.keyPrefix || ''} onChange={e => setSettings(p => ({ ...p, keyPrefix: e.target.value }))} disabled={settingsSaving || settingsLoading} />
          </label>
        </div>
        <div className="media-library-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleTestSettings} disabled={settingsSaving || settingsLoading}>
            {settingsSaving ? <RefreshCw size={14} className="spin" /> : <Cloud size={14} />}
            <span>Test</span>
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveSettings} disabled={settingsSaving || settingsLoading}>
            {settingsSaving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
            <span>Lưu</span>
          </button>
        </div>
      </section>
    )
  }

  const renderGroupList = () => {
    const groupQuery = groupSearch.trim().toLocaleLowerCase('vi')
    const visibleGroups = groups.filter(group => !groupQuery || group.name.toLocaleLowerCase('vi').includes(groupQuery))

    return (
      <aside className="media-group-panel">
        <div className="media-group-panel-top">
          <div className="media-group-panel-head">
            <span>Nhóm media</span>
            <button
              type="button"
              className="media-group-add-button"
              onClick={() => {
                if (groupFormOpen && !editingGroupId) resetGroupForm()
                else {
                  setEditingGroupId(null)
                  setGroupFormName('')
                  setGroupFormOpen(true)
                }
              }}
              title="Tạo nhóm mới"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="media-group-search">
            <Search size={14} />
            <input
              value={groupSearch}
              onChange={event => setGroupSearch(event.target.value)}
              placeholder="Tìm nhóm..."
            />
          </div>
          {groupFormOpen && (
            <div className="media-group-form">
              <input
                className="stepper-input"
                value={groupFormName}
                onChange={event => setGroupFormName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void handleSaveGroup()
                  if (event.key === 'Escape') resetGroupForm()
                }}
                placeholder={editingGroupId ? 'Tên nhóm' : 'Tên nhóm mới...'}
                disabled={groupSaving}
                autoFocus
              />
              <div className="media-group-form-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveGroup} disabled={groupSaving}>
                  {groupSaving ? <RefreshCw size={13} className="spin" /> : <Save size={13} />}
                  <span>Lưu</span>
                </button>
                {editingGroupId && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={resetGroupForm} disabled={groupSaving}>
                    <X size={13} />
                    <span>Huỷ</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="media-group-list">
          <button
            type="button"
            className={`media-group-item ${selectedGroupId === null && !ungroupedSelected ? 'active' : ''}`}
            onClick={() => selectGroup(null)}
          >
            <span className="media-group-item-main">
              <Folder size={15} />
              <span>Tất cả media</span>
            </span>
            <span className="media-group-count">{activeMediaCount}</span>
          </button>

          <button
            type="button"
            className={`media-group-item ${ungroupedSelected ? 'active' : ''}`}
            onClick={selectUngrouped}
            disabled={groupIndexLoading || !!groupIndexError}
            title={groupIndexError || undefined}
          >
            <span className="media-group-item-main">
              <Folder size={15} />
              <span>Chưa phân nhóm</span>
            </span>
            <span className="media-group-count">{groupIndexLoading ? '…' : groupIndexError ? '!' : ungroupedFileCount}</span>
          </button>

          {groupsLoading ? (
            <div className="media-group-empty">Đang tải...</div>
          ) : groups.length === 0 ? (
            <div className="media-group-empty">Chưa có nhóm media</div>
          ) : visibleGroups.length === 0 ? (
            <div className="media-group-empty">Không tìm thấy nhóm</div>
          ) : visibleGroups.map(group => (
            <div key={group.id} className={`media-group-row ${selectedGroupId === group.id ? 'active' : ''}`}>
              <button type="button" className="media-group-item" onClick={() => selectGroup(group.id)}>
                <span className="media-group-item-main">
                  <Folder size={15} />
                  <span title={group.name}>{group.name}</span>
                </span>
                <span className="media-group-count">{group.fileCount || 0}</span>
              </button>
              <div className="media-group-row-actions">
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => {
                    selectGroup(group.id)
                    setGroupManageMode(true)
                  }}
                  title="Quản lý media trong nhóm"
                >
                  <FolderPlus size={13} />
                </button>
                <button type="button" className="btn-icon" onClick={() => handleEditGroup(group)} title="Sửa nhóm">
                  <Edit3 size={13} />
                </button>
                <button type="button" className="btn-icon text-error" onClick={() => handleDeleteGroup(group)} title="Xoá nhóm">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="media-group-storage-status">
          <Cloud size={14} />
          <span>{settings.provider === 'r2' ? 'Cloudflare R2' : settings.provider.toUpperCase()} · {settings.isConfigured ? 'đã kết nối' : 'chưa cấu hình'}</span>
          {isAdmin && (
            <button type="button" className="btn-icon" onClick={() => setSettingsExpanded(current => !current)} title="Cấu hình cloud">
              <Settings size={13} />
            </button>
          )}
        </div>
      </aside>
    )
  }

  const getEmptyMediaText = (): string => {
    if (filesLoading || (selectedGroupId && groupMembershipLoading) || (ungroupedSelected && groupIndexLoading)) return 'Đang tải...'
    if (ungroupedSelected && groupIndexError) return 'Không thể xác định media chưa phân nhóm. Vui lòng tải lại.'
    if (search.trim() || selectedExtensions.size > 0 || dateFilter !== 'all') return 'Không có media phù hợp với bộ lọc.'
    if (category !== 'all') return `Chưa có ${MEDIA_CATEGORY_LABELS[category].toLocaleLowerCase('vi')}`
    if (ungroupedSelected) return 'Không có media chưa phân nhóm'
    if (selectedGroupId) return 'Nhóm này chưa có media'
    return 'Chưa có media'
  }

  const renderPagination = (
    total: number,
    page: number,
    pageCount: number,
    pageSize: number,
    onPageChange: (page: number) => void
  ) => {
    if (total <= pageSize) return null
    const from = (page - 1) * pageSize + 1
    const to = Math.min(total, page * pageSize)
    return (
      <div className="media-library-pagination">
        <span>{from}-{to}/{total}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          title="Trang trước"
        >
          <ChevronLeft size={14} />
        </button>
        <span>Trang {page}/{pageCount}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          title="Trang sau"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    )
  }

  const renderMediaThumbnail = (file: MediaFile, compact = false) => {
    const mediaCategory = getMediaCategory(file)
    const extension = getMediaExtension(file)
    const previewPath = getMediaFilePreviewPath(file)
    const remotePreview = /^https?:\/\//i.test(previewPath) || /^data:/i.test(previewPath)

    if (mediaCategory === 'image' && remotePreview) {
      return <img src={previewPath} alt="" loading="lazy" />
    }
    if (mediaCategory === 'video' && remotePreview && !compact) {
      return <video src={previewPath} muted playsInline preload="metadata" />
    }
    if (mediaCategory === 'video') {
      return <Video size={compact ? 16 : 28} />
    }
    if (mediaCategory === 'image') {
      return <Image size={compact ? 16 : 28} />
    }
    return <span className={getMediaExtensionBadgeClass(file, compact)}>{extension}</span>
  }

  const renderMediaCard = (file: MediaFile) => {
    const selected = isMediaSelected(file)
    const mediaCategory = getMediaCategory(file)
    const pickerCompatible = !isPicker || mediaFileMatchesPickerMode(file, pickerMode)
    const selectable = pickerCompatible && (isPicker || canDeleteMedia)
    const disabled = isPicker && !pickerCompatible
    const extension = getMediaExtension(file)
    return (
      <div
        key={file.id}
        className={`media-card category-${mediaCategory} ${selected ? 'selected' : ''} ${selectable ? 'selectable' : ''} ${disabled ? 'is-disabled' : ''}`.trim()}
        role={selectable ? 'checkbox' : undefined}
        aria-checked={selectable ? selected : undefined}
        tabIndex={selectable ? 0 : -1}
        onClick={() => selectable && toggleMediaSelection(file)}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || !selectable || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          toggleMediaSelection(file)
        }}
      >
        <div className={`media-card-preview is-${mediaCategory}`}>
          {renderMediaThumbnail(file)}
          {mediaCategory === 'video' && <span className="media-video-play" aria-hidden="true" />}
          <span className="media-card-extension">{extension}</span>
          {selectable && (
            <span className={`media-card-check ${selected ? 'checked' : ''}`}>
              {selected && <Check size={11} />}
            </span>
          )}
        </div>
        <div className="media-card-details">
          <div className="media-card-name" title={file.originalName}>{file.originalName}</div>
          <div className="media-card-meta">{extension} · {formatBytes(file.sizeBytes)} · {formatMediaCardDate(file.createdAt)}</div>
        </div>
        <div className="media-card-actions" onClick={event => event.stopPropagation()}>
          <MediaPreviewHover
            name={file.originalName}
            path={getMediaFilePreviewPath(file)}
            mimeType={file.mimeType}
            sizeBytes={file.sizeBytes}
          />
          {canDeleteMedia && (
            <button type="button" className="btn-icon text-error" onClick={() => handleDelete(file)} disabled={deleting} title="Xoá media">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderMediaGrid = (
    rows: MediaFile[],
    overview = false,
    displayCategory: Exclude<MediaCategory, 'all'> = category === 'all' ? 'image' : category
  ) => (
    <div className={`media-card-grid is-${overview ? 'overview' : view} category-${displayCategory}`}>
      {rows.map(renderMediaCard)}
    </div>
  )

  const renderMediaList = (rows: MediaFile[]) => {
    const listCategory: Exclude<MediaCategory, 'all'> = category === 'all' ? 'image' : category
    const groupNameById = new Map(groups.map(group => [group.id, group.name]))
    const getMediaGroupLabel = (mediaFileId: number): string => {
      if (ungroupedSelected) return 'Chưa phân nhóm'
      if (selectedGroupId) return groupNameById.get(selectedGroupId) || 'Không xác định'
      if (groupIndexLoading) return 'Đang tải…'
      if (groupIndexError) return 'Không xác định'
      const names = (groupIdsByFileId.get(mediaFileId) || [])
        .map(groupId => groupNameById.get(groupId))
        .filter((name): name is string => !!name)
      return names.length > 0 ? names.join(', ') : 'Chưa phân nhóm'
    }
    const renderSelectAll = () => canDeleteMedia ? (
      <input
        ref={deleteSelectAllRef}
        type="checkbox"
        checked={allVisibleDeleteSelected}
        onChange={toggleAllVisibleDelete}
        disabled={deleting || visibleDeleteIds.length === 0}
        aria-label="Chọn tất cả media trên trang"
        aria-checked={someVisibleDeleteSelected && !allVisibleDeleteSelected ? 'mixed' : allVisibleDeleteSelected}
      />
    ) : null

    return (
      <div className={`media-list-shell category-${listCategory}`}>
        <table className="media-list-table">
          <thead>
            <tr>
              <th className="media-list-check-cell">{renderSelectAll()}</th>
              {listCategory === 'document' ? (
                <>
                  <th className="media-list-extension-cell">Đuôi</th>
                  <th>Tên file</th>
                  <th className="media-list-size-cell">Dung lượng</th>
                  <th className="media-list-date-cell">Ngày tải lên</th>
                  <th className="media-list-group-cell">Nhóm</th>
                </>
              ) : (
                <>
                  <th className="media-list-preview-cell">Xem</th>
                  <th>{listCategory === 'video' ? 'Tên video' : 'Tên file'}</th>
                  <th className="media-list-extension-cell">{listCategory === 'video' ? 'Thời lượng' : 'Đuôi'}</th>
                  <th className="media-list-size-cell">Dung lượng</th>
                  <th className="media-list-date-cell">Ngày tải lên</th>
                </>
              )}
              <th className="media-list-action-cell"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(file => {
              const selected = isMediaSelected(file)
              const groupLabel = getMediaGroupLabel(file.id)
              const pickerCompatible = !isPicker || mediaFileMatchesPickerMode(file, pickerMode)
              const selectable = pickerCompatible && (isPicker || canDeleteMedia)
              const disabled = isPicker && !pickerCompatible
              return (
                <tr
                  key={file.id}
                  className={`${selected ? 'selected' : ''} ${selectable ? 'selectable' : ''} ${disabled ? 'is-disabled' : ''}`.trim()}
                  onClick={() => selectable && toggleMediaSelection(file)}
                >
                  <td className="media-list-check-cell">
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleMediaSelection(file)}
                        onClick={event => event.stopPropagation()}
                        aria-label={`Chọn media ${file.originalName}`}
                      />
                    )}
                  </td>
                  {listCategory === 'document' ? (
                    <>
                      <td className="media-list-extension-cell"><span className={getMediaExtensionBadgeClass(file, true)}>{getMediaExtension(file)}</span></td>
                      <td><span className="media-list-file-name" title={file.originalName}>{file.originalName}</span></td>
                      <td className="media-list-size-cell">{formatBytes(file.sizeBytes)}</td>
                      <td className="media-list-date-cell">{formatDateTime(file.createdAt)}</td>
                      <td className="media-list-group-cell" title={groupLabel}><span>{groupLabel}</span></td>
                    </>
                  ) : (
                    <>
                      <td className="media-list-preview-cell">
                        <span className={`media-list-thumbnail is-${listCategory}`}>{renderMediaThumbnail(file, true)}</span>
                      </td>
                      <td><span className="media-list-file-name" title={file.originalName}>{file.originalName}</span></td>
                      <td className="media-list-extension-cell">
                        {listCategory === 'video' ? '—' : <span className={getMediaExtensionBadgeClass(file, true)}>{getMediaExtension(file)}</span>}
                      </td>
                      <td className="media-list-size-cell">{formatBytes(file.sizeBytes)}</td>
                      <td className="media-list-date-cell">{formatDateTime(file.createdAt)}</td>
                    </>
                  )}
                  <td className="media-list-action-cell" onClick={event => event.stopPropagation()}>
                    <MediaPreviewHover
                      name={file.originalName}
                      path={getMediaFilePreviewPath(file)}
                      mimeType={file.mimeType}
                      sizeBytes={file.sizeBytes}
                    />
                    {canDeleteMedia ? (
                      <button type="button" className="btn-icon text-error" onClick={() => handleDelete(file)} disabled={deleting} title="Xoá media">
                        <Trash2 size={13} />
                      </button>
                    ) : <MoreVertical size={15} />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const renderAllMediaOverview = () => {
    const sections: Array<{ category: Exclude<MediaCategory, 'all'>; limit: number }> = [
      { category: 'image', limit: 6 },
      { category: 'video', limit: 3 },
      { category: 'document', limit: 3 }
    ]
    return (
      <div className="media-overview">
        {sections.map(section => {
          const rows = filteredFiles.filter(file => getMediaCategory(file) === section.category)
          if (rows.length === 0) return null
          return (
            <section key={section.category} className="media-overview-section">
              <div className="media-overview-head">
                <strong>{MEDIA_CATEGORY_LABELS[section.category]}</strong>
                <span>{rows.length}</span>
                <button type="button" onClick={() => {
                  setCategory(section.category)
                  if (section.category === 'document') setView('list')
                }}>
                  {section.category === 'image' ? 'Xem tất cả ảnh' : section.category === 'video' ? 'Xem tất cả video' : 'Xem tất cả file'}
                </button>
              </div>
              {section.category === 'document' ? (
                <div className="media-overview-doc-list">
                  {rows.slice(0, section.limit).map(file => {
                    const selected = isMediaSelected(file)
                    const pickerCompatible = !isPicker || mediaFileMatchesPickerMode(file, pickerMode)
                    const selectable = pickerCompatible && (isPicker || canDeleteMedia)
                    return (
                      <button
                        key={file.id}
                        type="button"
                        className={selected ? 'selected' : ''}
                        onClick={() => selectable && toggleMediaSelection(file)}
                        disabled={!selectable}
                      >
                        <span className={getMediaExtensionBadgeClass(file, true)}>{getMediaExtension(file)}</span>
                        <strong title={file.originalName}>{file.originalName}</strong>
                        <span>{formatBytes(file.sizeBytes)}</span>
                        <time>{formatMediaCardDate(file.createdAt)}</time>
                      </button>
                    )
                  })}
                </div>
              ) : renderMediaGrid(rows.slice(0, section.limit), true, section.category)}
            </section>
          )
        })}
      </div>
    )
  }

  const renderGroupManagePanel = () => {
    if (!selectedGroupId) return null
    const loading = filesLoading || groupMembershipLoading
    return (
      <div className="media-group-manage">
        <div className="media-group-manage-column">
          <div className="media-group-manage-head">
            <div className="media-library-section-title">
              <FolderPlus size={15} />
              <span>Chưa trong thư mục</span>
              <span className="media-group-count">{groupAvailableFiles.length}</span>
            </div>
          </div>
          <div className="media-group-manage-list">
            {loading ? (
              <div className="media-group-manage-empty">Đang tải...</div>
            ) : groupAvailableFiles.length === 0 ? (
              <div className="media-group-manage-empty">Tất cả media đã nằm trong thư mục.</div>
            ) : visibleAvailableGroupManageFiles.length === 0 ? (
              <div className="media-group-manage-empty">Không có media phù hợp.</div>
            ) : pagedAvailableGroupManageFiles.map(file => (
              <div key={file.id} className="media-group-manage-item">
                <MediaPreviewHover
                  name={file.originalName}
                  path={getMediaFilePreviewPath(file)}
                  mimeType={file.mimeType}
                  sizeBytes={file.sizeBytes}
                />
                <span className="media-library-name-cell">
                  {isMediaFileImage(file) ? <Image size={16} /> : <FileText size={16} />}
                  <span title={file.originalName}>{file.originalName}</span>
                </span>
                <span className="media-group-manage-meta">{formatBytes(file.sizeBytes)}</span>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => handleAddToGroup(file)}
                  disabled={groupSaving || groupMembershipLoading}
                  title="Thêm vào thư mục"
                >
                  <Plus size={14} />
                </button>
              </div>
            ))}
          </div>
          {renderPagination(
            visibleAvailableGroupManageFiles.length,
            resolvedAvailableManagePage,
            availableManagePageCount,
            MEDIA_GROUP_MANAGE_PAGE_SIZE,
            setAvailableManagePage
          )}
        </div>

        <div className="media-group-manage-column">
          <div className="media-group-manage-head">
            <div className="media-library-section-title">
              <Folder size={15} />
              <span>Trong thư mục</span>
              <span className="media-group-count">{groupManageFiles.length}</span>
            </div>
          </div>
          <div className="media-group-manage-list">
            {loading ? (
              <div className="media-group-manage-empty">Đang tải...</div>
            ) : groupManageFiles.length === 0 ? (
              <div className="media-group-manage-empty">Thư mục này chưa có media.</div>
            ) : visibleGroupManageFiles.length === 0 ? (
              <div className="media-group-manage-empty">Không có media phù hợp.</div>
            ) : pagedGroupManageFiles.map(file => (
              <div key={file.id} className="media-group-manage-item">
                <MediaPreviewHover
                  name={file.originalName}
                  path={getMediaFilePreviewPath(file)}
                  mimeType={file.mimeType}
                  sizeBytes={file.sizeBytes}
                />
                <span className="media-library-name-cell">
                  {isMediaFileImage(file) ? <Image size={16} /> : <FileText size={16} />}
                  <span title={file.originalName}>{file.originalName}</span>
                </span>
                <span className="media-group-manage-meta">{formatBytes(file.sizeBytes)}</span>
                <button
                  type="button"
                  className="btn-icon text-error"
                  onClick={() => handleRemoveFromGroup(file)}
                  disabled={groupSaving || groupMembershipLoading}
                  title="Gỡ khỏi thư mục"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          {renderPagination(
            visibleGroupManageFiles.length,
            resolvedGroupManagePage,
            groupManagePageCount,
            MEDIA_GROUP_MANAGE_PAGE_SIZE,
            setGroupManagePage
          )}
        </div>
      </div>
    )
  }

  const dateFilterLabel = dateFilter === 'custom'
    ? [customDateStart, customDateEnd].filter(Boolean).map(value => new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN')).join(' – ') || 'Khoảng ngày'
    : MEDIA_DATE_OPTIONS.find(option => option.value === dateFilter)?.label || 'Ngày tải lên'
  const sortLabel = MEDIA_SORT_OPTIONS.find(option => option.value === sort)?.label || 'Mới nhất'
  const hasActiveFilters = selectedExtensions.size > 0 || dateFilter !== 'all' || !!selectedGroupId || ungroupedSelected
  const mediaLoading = filesLoading || (!!selectedGroupId && groupMembershipLoading) || (ungroupedSelected && groupIndexLoading)
  const selectedCount = isPicker ? selectedSnapshots.length : selectedDeleteFiles.length
  const pagerFrom = filteredFiles.length === 0 ? 0 : (resolvedMediaPage - 1) * mediaPageSize + 1
  const pagerTo = Math.min(filteredFiles.length, resolvedMediaPage * mediaPageSize)

  return createPortal(
    <div className="modal-overlay media-library-overlay">
      <div className="modal media-library-modal" onClick={event => event.stopPropagation()}>
        <div className="media-library-header">
          <div className="media-library-header-icon">
            <Image size={18} />
          </div>
          <div className="media-library-heading">
            <h2>{isPicker ? 'Chọn Media' : 'Quản lý Media'}</h2>
            <p>{isPicker ? `Chọn ${pickerMediaLabel} cho chiến dịch` : 'Tải lên và quản lý ảnh, video, file tài liệu theo nhóm'}</p>
          </div>
          <div
            className="media-library-header-usage"
            title={`${activeMediaCount.toLocaleString('vi-VN')}/${mediaLibraryMaxFiles.toLocaleString('vi-VN')} file · ${formatBytes(usedStorageBytes)} đã lưu`}
          >
            <div className="media-library-usage-count">
              <span>Đã dùng</span>
              <strong>
                {activeMediaCount.toLocaleString('vi-VN')}
                <small>/{mediaLibraryMaxFiles.toLocaleString('vi-VN')} file</small>
              </strong>
            </div>
            <div className="media-library-usage-meter">
              <span
                role="progressbar"
                aria-label="Mức sử dụng kho media"
                aria-valuemin={0}
                aria-valuemax={mediaLibraryMaxFiles}
                aria-valuenow={Math.min(activeMediaCount, mediaLibraryMaxFiles)}
              >
                <i style={{ width: `${quotaPercent}%` }} />
              </span>
              <small>{formatBytes(usedStorageBytes)} đã lưu</small>
            </div>
          </div>
          <button type="button" className="btn-icon media-library-close" onClick={onClose} title="Đóng">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body media-library-body">
          {renderSettings()}
          <div className="media-library-split">
            {renderGroupList()}

            <div className="media-files-panel">
              <div className="media-library-viewbar">
                <div className="media-category-tabs">
                  {(Object.keys(MEDIA_CATEGORY_LABELS) as MediaCategory[]).map(value => (
                    <button
                      key={value}
                      type="button"
                      className={category === value ? 'active' : ''}
                      onClick={() => setCategory(value)}
                    >
                      {MEDIA_CATEGORY_LABELS[value]}
                      <span>{categoryCounts[value]}</span>
                    </button>
                  ))}
                </div>
                <div className="media-sort-menu">
                  <button
                    type="button"
                    className={openMenu === 'sort' ? 'active' : ''}
                    onClick={() => setOpenMenu(current => current === 'sort' ? null : 'sort')}
                  >
                    <ArrowUpDown size={14} />
                    <span>{sortLabel}</span>
                    <ChevronDown size={13} />
                  </button>
                  {openMenu === 'sort' && (
                    <div className="media-sort-popover">
                      {MEDIA_SORT_OPTIONS.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          className={sort === option.value ? 'active' : ''}
                          onClick={() => {
                            setSort(option.value)
                            setOpenMenu(null)
                          }}
                        >
                          <span>{option.label}</span>
                          {sort === option.value && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {category !== 'all' && (
                  <div className="media-view-switcher">
                    <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title="Lưới nhỏ"><Grid2X2 size={15} /></button>
                    <button type="button" className={view === 'large' ? 'active' : ''} onClick={() => setView('large')} title="Lưới lớn"><LayoutGrid size={15} /></button>
                    <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title="Danh sách chi tiết"><List size={15} /></button>
                  </div>
                )}
              </div>

              <div className="media-library-toolbar">
                <div className="media-library-upload-split">
                  <button
                    type="button"
                    className="media-library-upload-button"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={uploading || settingsLoading || !settings.isConfigured || (!!selectedGroupId && groupMembershipLoading)}
                  >
                    {uploading ? <RefreshCw size={15} className="spin" /> : <Upload size={15} />}
                    <span>{uploading ? 'Đang upload' : 'Tải lên'}</span>
                  </button>
                  <span />
                  <button
                    type="button"
                    className="media-library-upload-chevron"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={uploading || settingsLoading || !settings.isConfigured || (!!selectedGroupId && groupMembershipLoading)}
                    title={selectedGroupId ? 'Tải lên vào nhóm đang chọn' : 'Chọn file để tải lên'}
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  accept={getPickerInputAccept(pickerMode)}
                  style={{ display: 'none' }}
                  onChange={handleUploadChange}
                />
                <div className="media-library-paste-hint" title="Sao chép ảnh rồi dán trực tiếp vào cửa sổ Media">
                  <ClipboardPaste size={14} />
                  <span>Dán ảnh</span>
                  <kbd>{window.electronAPI.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+V'}</kbd>
                </div>
                <div className="media-library-search">
                  <Search size={15} />
                  <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm theo tên file, đuôi file hoặc link..." />
                </div>

                <div className="media-filter-menu">
                  <button
                    type="button"
                    className={selectedExtensions.size > 0 || openMenu === 'extension' ? 'active' : ''}
                    onClick={() => setOpenMenu(current => current === 'extension' ? null : 'extension')}
                  >
                    <FileText size={14} />
                    <span>{selectedExtensions.size === 0 ? 'Đuôi file' : selectedExtensions.size === 1 ? Array.from(selectedExtensions)[0] : `Đuôi file · ${selectedExtensions.size}`}</span>
                    <ChevronDown size={13} />
                  </button>
                  {openMenu === 'extension' && (
                    <div className="media-filter-popover media-extension-popover">
                      <div className="media-filter-scroll">
                        {extensionOptions.map(option => (
                          <label key={option.extension} className={selectedExtensions.has(option.extension) ? 'active' : ''}>
                            <input type="checkbox" checked={selectedExtensions.has(option.extension)} onChange={() => toggleExtension(option.extension)} />
                            <span className={`media-file-extension-badge is-compact extension-${option.extension.toLocaleLowerCase('vi').replace(/[^a-z0-9]+/g, '-')}`}>{option.extension}</span>
                            <span>{MEDIA_CATEGORY_LABELS[option.category]}</span>
                            <small>{option.count}</small>
                          </label>
                        ))}
                      </div>
                      <div className="media-filter-popover-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedExtensions(new Set())}>Bỏ chọn</button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenMenu(null)}>Áp dụng</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="media-filter-menu">
                  <button
                    type="button"
                    className={dateFilter !== 'all' || openMenu === 'date' ? 'active' : ''}
                    onClick={() => setOpenMenu(current => current === 'date' ? null : 'date')}
                  >
                    <Calendar size={14} />
                    <span>{dateFilter === 'all' ? 'Ngày tải lên' : dateFilterLabel}</span>
                    <ChevronDown size={13} />
                  </button>
                  {openMenu === 'date' && (
                    <div className="media-filter-popover media-date-popover">
                      <div className="media-filter-scroll">
                        {MEDIA_DATE_OPTIONS.map(option => (
                          <button
                            key={option.value}
                            type="button"
                            className={dateFilter === option.value ? 'active' : ''}
                            onClick={() => {
                              setDateFilter(option.value)
                              setOpenMenu(null)
                            }}
                          >
                            <span>{option.label}</span>
                            <small>{dateOptionCounts.get(option.value) || 0}</small>
                          </button>
                        ))}
                      </div>
                      <div className="media-custom-date">
                        <strong>Tùy chọn khoảng ngày</strong>
                        <div>
                          <input type="date" value={customDateStart} onChange={event => setCustomDateStart(event.target.value)} aria-label="Từ ngày" />
                          <span>–</span>
                          <input type="date" value={customDateEnd} onChange={event => setCustomDateEnd(event.target.value)} aria-label="Đến ngày" />
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            setDateFilter('custom')
                            setOpenMenu(null)
                          }}
                          disabled={!customDateStart && !customDateEnd}
                        >
                          Áp dụng khoảng ngày
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <button type="button" className="btn-icon media-library-refresh" onClick={handleRefresh} disabled={filesLoading || groupsLoading || groupMembershipLoading} title="Tải lại">
                  <RefreshCw size={15} className={(filesLoading || groupsLoading || groupMembershipLoading) ? 'spin' : ''} />
                </button>
              </div>

              {hasActiveFilters && (
                <div className="media-filter-chips">
                  <span>Đang lọc</span>
                  {Array.from(selectedExtensions).map(extension => (
                    <button key={extension} type="button" onClick={() => toggleExtension(extension)}>{extension}<X size={11} /></button>
                  ))}
                  {dateFilter !== 'all' && (
                    <button type="button" onClick={() => setDateFilter('all')}>{dateFilterLabel}<X size={11} /></button>
                  )}
                  {selectedGroupId && (
                    <button type="button" onClick={() => selectGroup(null)}>Nhóm: {groups.find(group => group.id === selectedGroupId)?.name || 'Media'}<X size={11} /></button>
                  )}
                  {ungroupedSelected && (
                    <button type="button" onClick={() => selectGroup(null)}>Nhóm: Chưa phân nhóm<X size={11} /></button>
                  )}
                  <button
                    type="button"
                    className="clear"
                    onClick={() => {
                      clearMediaFilters()
                      if (selectedGroupId || ungroupedSelected) selectGroup(null)
                    }}
                  >
                    Xóa tất cả
                  </button>
                  <small>Tìm thấy {filteredFiles.length} media</small>
                </div>
              )}

              <div className="media-library-content">
                {selectedGroupId && groupManageMode ? renderGroupManagePanel() : mediaLoading ? (
                  <div className="media-library-empty"><RefreshCw size={20} className="spin" /><span>Đang tải media...</span></div>
                ) : filteredFiles.length === 0 ? (
                  <div className="media-library-empty"><HardDrive size={24} /><span>{getEmptyMediaText()}</span></div>
                ) : category === 'all' ? (
                  renderAllMediaOverview()
                ) : view === 'list' ? (
                  renderMediaList(pagedFiles)
                ) : (
                  renderMediaGrid(pagedFiles)
                )}
              </div>

              {selectedCount > 0 && (
                <div className="media-library-selection-bar">
                  <span>Đã chọn <strong>{selectedCount}</strong> media</span>
                  <span className="spacer" />
                  {!isPicker && (
                    <>
                      <details className="media-selection-group-menu">
                        <summary><FolderPlus size={14} />Thêm vào nhóm</summary>
                        <div>
                          {groups.length === 0 ? <span>Chưa có nhóm media</span> : groups.map(group => (
                            <button key={group.id} type="button" onClick={() => void handleAddSelectedToGroup(group.id)}>{group.name}<small>{group.fileCount || 0}</small></button>
                          ))}
                        </div>
                      </details>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleDownloadSelected()} disabled={downloading}>
                        {downloading ? <RefreshCw size={13} className="spin" /> : <Download size={14} />}
                        {downloading ? 'Đang tải' : 'Tải xuống'}
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={handleBulkDelete} disabled={deleting}>
                        {deleting ? <RefreshCw size={13} className="spin" /> : <Trash2 size={14} />}
                        {deleting ? 'Đang xoá' : 'Xoá'}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => isPicker ? setSelectedKeys(new Set()) : setSelectedDeleteIds(new Set())}
                    title="Bỏ chọn"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="media-library-footer">
                <span>
                  {category === 'all'
                    ? `${filteredFiles.length} media · sắp xếp ${sortLabel.toLocaleLowerCase('vi')}`
                    : `Hiển thị ${pagerFrom}–${pagerTo} / ${filteredFiles.length} media · sắp xếp ${sortLabel.toLocaleLowerCase('vi')}`}
                </span>
                <div className="media-library-footer-actions">
                  {category !== 'all' && (
                    <div className="media-library-pager">
                      <button type="button" onClick={() => setMediaPage(Math.max(1, resolvedMediaPage - 1))} disabled={resolvedMediaPage <= 1}><ChevronLeft size={15} /></button>
                      <span>Trang {resolvedMediaPage} / {mediaPageCount}</span>
                      <button type="button" onClick={() => setMediaPage(Math.min(mediaPageCount, resolvedMediaPage + 1))} disabled={resolvedMediaPage >= mediaPageCount}><ChevronRight size={15} /></button>
                    </div>
                  )}
                  <i />
                  <button type="button" className="btn btn-secondary" onClick={onClose}>Đóng</button>
                  {isPicker && selectedGroupId && !isSingleSelectPicker && (
                    <button type="button" className="btn btn-secondary" onClick={handleConfirmGroup} disabled={groupMembershipLoading || selectedGroupSnapshots.length === 0}>
                      <Folder size={14} />Chọn nhóm
                    </button>
                  )}
                  {isPicker && (
                    <button type="button" className="btn btn-primary" onClick={handleConfirm}>
                      <Check size={15} />Chọn {selectedSnapshots.length > 0 ? `(${selectedSnapshots.length})` : ''}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
