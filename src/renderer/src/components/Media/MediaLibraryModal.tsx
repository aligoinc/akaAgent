import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, Cloud, Copy, Edit3, FileText, Folder, FolderPlus, Image, Plus, RefreshCw, Save, Search, Trash2, Upload, X } from 'lucide-react'
import {
  CampaignMediaInput,
  CampaignMediaSnapshot,
  MEDIA_FILE_MAX_SIZE_BYTES,
  MEDIA_IMAGE_MAX_SIZE_BYTES,
  MEDIA_LIBRARY_MAX_FILES_PER_STAFF,
  MediaFile,
  MediaGroup,
  MediaStorageSettings,
  MediaUploadFailure
} from '../../../../shared/types'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import MediaPreviewHover from './MediaPreviewHover'

type MediaPickerMode = 'image' | 'file'

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
  keyPrefix: ''
}

const isImageMime = (mime?: string | null) => String(mime || '').toLowerCase().startsWith('image/')
const IMAGE_FILE_EXTENSION_RE = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i

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
  isImageMime(file.type) || IMAGE_FILE_EXTENSION_RE.test(file.name)

const getUploadFileSizeLimit = (file: File): number =>
  isUploadImageFile(file) ? MEDIA_IMAGE_MAX_SIZE_BYTES : MEDIA_FILE_MAX_SIZE_BYTES

const getUploadSizeError = (file: File): string => {
  const limit = getUploadFileSizeLimit(file)
  const label = isUploadImageFile(file) ? 'Ảnh' : 'File'
  return `${label} vượt quá dung lượng tối đa ${formatBytes(limit)}.`
}

const getMediaQuotaError = (activeCount: number): string =>
  `Thư viện media đã có ${activeCount}/${MEDIA_LIBRARY_MAX_FILES_PER_STAFF} file. Vui lòng xoá bớt media trước khi upload thêm.`

const formatDateTime = (value?: string): string => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('vi-VN')
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
  const groupMembershipRequestRef = useRef(0)
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
  const [groupFileIds, setGroupFileIds] = useState<Set<number>>(new Set())
  const [groupMembershipLoading, setGroupMembershipLoading] = useState(false)
  const [groupSaving, setGroupSaving] = useState(false)
  const [groupManageMode, setGroupManageMode] = useState(false)
  const [groupFormName, setGroupFormName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())

  const pickerLimit = Math.max(1, maxSelect ?? Number.MAX_SAFE_INTEGER)
  const isPicker = !!onConfirm
  const isSingleSelectPicker = isPicker && pickerLimit === 1
  const onlyImages = pickerMode === 'image'
  const activeMediaCount = files.length
  const selectedGroup = selectedGroupId ? groups.find(group => group.id === selectedGroupId) || null : null
  const canDeleteMedia = !isPicker && selectedGroupId === null
  const tableColSpan = isPicker ? 9 : 8
  const groupFileOrder = useMemo(
    () => new Map(Array.from(groupFileIds).map((id, index) => [id, index])),
    [groupFileIds]
  )

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
    setGroupsLoading(true)
    try {
      const rows = await window.electronAPI.listMediaGroups()
      setGroups(rows)
      setSelectedGroupId(current => current && rows.some(group => group.id === current) ? current : null)
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể tải thư mục media.', 'error')
    } finally {
      setGroupsLoading(false)
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
    setGroupManageMode(false)

    const requestId = groupMembershipRequestRef.current + 1
    groupMembershipRequestRef.current = requestId

    if (!selectedGroupId) {
      setGroupFileIds(new Set())
      setGroupMembershipLoading(false)
      return
    }

    void loadGroupFileIds(selectedGroupId, requestId)
  }, [selectedGroupId])

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = files.filter(file => {
      if (selectedGroupId && !groupFileIds.has(file.id)) return false
      if (!q) return true
      return mediaMatchesSearch(file, q)
    })
    return selectedGroupId
      ? [...rows].sort((a, b) => (groupFileOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (groupFileOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id - b.id)
      : rows
  }, [files, groupFileIds, groupFileOrder, onlyImages, search, selectedGroupId])

  const selectedGroupSnapshots = useMemo(() => {
    if (!selectedGroupId) return []
    return files
      .filter(file => groupFileIds.has(file.id))
      .filter(file => !onlyImages || isImageMime(file.mimeType))
      .sort((a, b) => (groupFileOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (groupFileOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id - b.id)
      .map(fileToSnapshot)
  }, [files, groupFileIds, groupFileOrder, onlyImages, selectedGroupId])

  const selectedSnapshots = useMemo(() => {
    const filesByKey = new Map(files.map(file => [getSnapshotKey(fileToSnapshot(file)), file]))
    return Array.from(selectedKeys)
      .map(key => {
        const file = filesByKey.get(key)
        if (!file) return null
        if (onlyImages && !isImageMime(file.mimeType)) return null
        return fileToSnapshot(file)
      })
      .filter((item): item is CampaignMediaSnapshot => !!item)
  }, [files, onlyImages, selectedKeys])

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
    return groupAvailableFiles.filter(file => !q || mediaMatchesSearch(file, q))
  }, [groupAvailableFiles, search, selectedGroupId])

  const visibleGroupManageFiles = useMemo(() => {
    if (!selectedGroupId) return []
    const q = search.trim().toLowerCase()
    return groupManageFiles.filter(file => !q || mediaMatchesSearch(file, q))
  }, [groupManageFiles, search, selectedGroupId])

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
    setGroupFileIds(new Set())
    setGroupMembershipLoading(!!groupId)
    setGroupManageMode(false)
    setSelectedGroupId(groupId)
  }

  const resetGroupForm = () => {
    setGroupFormName('')
    setEditingGroupId(null)
  }

  const handleSaveGroup = async () => {
    if (isPicker || groupSaving) return
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
  }

  const handleDeleteGroup = (group: MediaGroup) => {
    showConfirm(
      `Xoá thư mục media "${group.name}"? Media trong thư mục sẽ không bị xoá.`,
      async () => {
        setGroupSaving(true)
        try {
          await window.electronAPI.deleteMediaGroup(group.id)
          setGroups(current => current.filter(item => item.id !== group.id))
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
  }

  const handleAddToGroup = async (file: MediaFile) => {
    if (isPicker || !selectedGroupId || groupSaving || groupMembershipLoading || groupFileIds.has(file.id)) return
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
    if (isPicker || !selectedGroupId || groupSaving || groupMembershipLoading) return
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

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (rawFiles.length === 0) return

    if (activeMediaCount + rawFiles.length > MEDIA_LIBRARY_MAX_FILES_PER_STAFF) {
      showAlert(getMediaQuotaError(activeMediaCount), 'error')
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

    setUploading(true)
    try {
      const result = await window.electronAPI.uploadMediaFiles(paths)
      const uploaded = result.files || []
      const failures = [...rejectedBySize, ...(result.failures || [])]
      setFiles(current => [...uploaded, ...current])
      if (isPicker) {
        if (selectedGroupId && uploaded.length > 0) selectGroup(null)
        setSelectedKeys(current => {
          const next = new Set(current)
          for (const file of uploaded) {
            if (next.size >= pickerLimit) break
            if (onlyImages && !isImageMime(file.mimeType)) continue
            next.add(getSnapshotKey(fileToSnapshot(file)))
          }
          return next
        })
      } else if (selectedGroupId && uploaded.length > 0) {
        const groupId = selectedGroupId
        try {
          const savedIds = await window.electronAPI.addMediaGroupFiles(groupId, uploaded.map(file => file.id))
          applySavedGroupFileIds(groupId, savedIds)
        } catch (err) {
          showAlert(
            `Đã upload ${uploaded.length} file nhưng chưa thêm được vào thư mục: ${err instanceof Error ? err.message : 'Không thể lưu thư mục media.'}`,
            'error'
          )
          return
        }
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
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Upload media thất bại.', 'error')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = (file: MediaFile) => {
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

  const toggleSelect = (file: MediaFile) => {
    if (!isPicker) return
    if (onlyImages && !isImageMime(file.mimeType)) return
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

  const handleConfirm = () => {
    if (!onConfirm) return
    onConfirm(selectedSnapshots)
    onClose()
  }

  const handleConfirmGroup = () => {
    if (!onConfirm || !selectedGroupId || isSingleSelectPicker) return
    if (selectedGroupSnapshots.length === 0) {
      showAlert(onlyImages ? 'Thư mục này không có ảnh hợp lệ.' : 'Thư mục này chưa có media hợp lệ.', 'error')
      return
    }
    onConfirm(selectedGroupSnapshots)
    onClose()
  }

  const renderSettings = () => {
    if (isPicker) return null
    if (!isAdmin) return null
    return (
      <section className="media-library-section">
        <div className="media-settings-head">
          <div className="media-library-section-title">
            <Cloud size={16} />
            <span>Cấu hình cloud</span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSettingsExpanded(current => !current)}>
            {settingsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>{settingsExpanded ? 'Ẩn' : 'Hiện'}</span>
          </button>
        </div>
        {settingsExpanded && (
          <>
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
          </>
        )}
      </section>
    )
  }

  const renderGroupList = () => (
    <aside className="media-group-panel">
      <div className="media-group-panel-head">
        <div className="media-library-section-title">
          <Folder size={16} />
          <span>Thư mục media</span>
        </div>
      </div>

      {!isPicker && (
        <div className="media-group-form">
          <input
            className="stepper-input"
            value={groupFormName}
            onChange={event => setGroupFormName(event.target.value)}
            placeholder="Tên thư mục media"
            disabled={groupSaving}
          />
          <div className="media-group-form-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveGroup} disabled={groupSaving}>
              {groupSaving ? <RefreshCw size={14} className="spin" /> : editingGroupId ? <Save size={14} /> : <Plus size={14} />}
              <span>{editingGroupId ? 'Lưu' : 'Thêm'}</span>
            </button>
            {editingGroupId && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetGroupForm} disabled={groupSaving}>
                <X size={14} />
                <span>Hủy</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="media-group-list">
        <button
          type="button"
          className={`media-group-item ${selectedGroupId === null ? 'active' : ''}`}
          onClick={() => selectGroup(null)}
        >
          <span className="media-group-item-main">
            <FolderPlus size={15} />
            <span>Tất cả media</span>
          </span>
          <span className="media-group-count">{activeMediaCount}</span>
        </button>

        {groupsLoading ? (
          <div className="media-group-empty">Đang tải...</div>
        ) : groups.length === 0 ? (
          <div className="media-group-empty">Chưa có thư mục media</div>
        ) : groups.map(group => (
          <div key={group.id} className={`media-group-row ${selectedGroupId === group.id ? 'active' : ''}`}>
            <button type="button" className="media-group-item" onClick={() => selectGroup(group.id)}>
              <span className="media-group-item-main">
                <Folder size={15} />
                <span title={group.name}>{group.name}</span>
              </span>
              <span className="media-group-count">{group.fileCount || 0}</span>
            </button>
            {!isPicker && (
              <div className="media-group-row-actions">
                <button type="button" className="btn-icon" onClick={() => handleEditGroup(group)} title="Sửa thư mục">
                  <Edit3 size={13} />
                </button>
                <button type="button" className="btn-icon text-error" onClick={() => handleDeleteGroup(group)} title="Xoá thư mục">
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )

  const getEmptyMediaText = (): string => {
    if (filesLoading || (selectedGroupId && groupMembershipLoading)) return 'Đang tải...'
    if (selectedGroupId) return onlyImages ? 'Thư mục này chưa có ảnh' : 'Thư mục này chưa có media'
    return 'Chưa có media'
  }

  const renderGroupManagePanel = () => {
    if (isPicker || !selectedGroupId) return null
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
            ) : visibleAvailableGroupManageFiles.map(file => (
              <div key={file.id} className="media-group-manage-item">
                <MediaPreviewHover
                  name={file.originalName}
                  path={getMediaFilePreviewPath(file)}
                  mimeType={file.mimeType}
                  sizeBytes={file.sizeBytes}
                />
                <span className="media-library-name-cell">
                  {isImageMime(file.mimeType) ? <Image size={16} /> : <FileText size={16} />}
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
            ) : visibleGroupManageFiles.map(file => (
              <div key={file.id} className="media-group-manage-item">
                <MediaPreviewHover
                  name={file.originalName}
                  path={getMediaFilePreviewPath(file)}
                  mimeType={file.mimeType}
                  sizeBytes={file.sizeBytes}
                />
                <span className="media-library-name-cell">
                  {isImageMime(file.mimeType) ? <Image size={16} /> : <FileText size={16} />}
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
        </div>
      </div>
    )
  }

  return createPortal(
    <div className="modal-overlay media-library-overlay">
      <div className="modal media-library-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{isPicker ? 'Chọn media' : 'Media'}</span>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body media-library-body">
          {renderSettings()}

          <section className="media-library-section media-library-list-section">
            <div className="media-library-split">
              {renderGroupList()}

              <div className="media-files-panel">
                <div className="media-library-toolbar">
                  <div className="media-library-toolbar-main">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm media-library-upload-button"
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={uploading || settingsLoading || !settings.isConfigured || (!!selectedGroupId && groupMembershipLoading)}
                    >
                      {uploading ? <RefreshCw size={14} className="spin" /> : <Upload size={14} />}
                      <span>{uploading ? 'Đang upload' : selectedGroupId && !isPicker ? 'Upload vào thư mục' : 'Upload'}</span>
                    </button>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      multiple
                      accept={onlyImages ? 'image/*' : undefined}
                      style={{ display: 'none' }}
                      onChange={handleUploadChange}
                    />
                    <div className="media-library-quota" title={`Đã dùng ${activeMediaCount}/${MEDIA_LIBRARY_MAX_FILES_PER_STAFF} media`}>
                      <span>Đã dùng</span>
                      <strong>{activeMediaCount}/{MEDIA_LIBRARY_MAX_FILES_PER_STAFF}</strong>
                    </div>
                    <div className="media-library-active-group" title={selectedGroup?.name || 'Tất cả media'}>
                      <Folder size={14} />
                      <span>{selectedGroup?.name || 'Tất cả media'}</span>
                    </div>
                  </div>
                  <div className="media-library-toolbar-tools">
                    {!isPicker && selectedGroupId && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setGroupManageMode(current => !current)}
                        disabled={groupMembershipLoading}
                      >
                        {groupManageMode ? <Folder size={14} /> : <Edit3 size={14} />}
                        <span>{groupManageMode ? 'Xem thư mục' : 'Quản lý thư mục'}</span>
                      </button>
                    )}
                    <div className="media-library-search">
                      <Search size={15} />
                      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm media" />
                    </div>
                    <button type="button" className="btn-icon media-library-refresh" onClick={handleRefresh} disabled={filesLoading || groupsLoading || groupMembershipLoading} title="Tải lại">
                      <RefreshCw size={15} className={(filesLoading || groupsLoading || groupMembershipLoading) ? 'spin' : ''} />
                    </button>
                  </div>
                </div>

                {!isPicker && selectedGroupId && groupManageMode ? renderGroupManagePanel() : (
                <div className="stepper-grid-container media-library-grid">
                  <table className="campaign-grid">
                    <thead>
                      <tr>
                        {isPicker && <th style={{ width: 44 }}></th>}
                        <th style={{ width: 56, textAlign: 'center' }}>STT</th>
                        <th style={{ width: canDeleteMedia ? 76 : 44 }}></th>
                        <th style={{ width: 320 }}>Tên file</th>
                        <th style={{ width: 132 }}>Loại</th>
                        <th style={{ width: 160, whiteSpace: 'nowrap' }}>Dung lượng</th>
                        <th style={{ width: 160 }}>Local path</th>
                        <th style={{ width: 200 }}>Cloud URL</th>
                        <th style={{ width: 180, whiteSpace: 'nowrap' }}>Ngày upload</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filesLoading || (selectedGroupId && groupMembershipLoading) ? (
                        <tr><td colSpan={tableColSpan} className="text-center text-muted">Đang tải...</td></tr>
                      ) : filteredFiles.length === 0 ? (
                        <tr><td colSpan={tableColSpan} className="text-center text-muted">{getEmptyMediaText()}</td></tr>
                      ) : filteredFiles.map((file, index) => {
                        const snapshot = fileToSnapshot(file)
                        const key = getSnapshotKey(snapshot)
                        const selectable = !isPicker || !onlyImages || isImageMime(file.mimeType)
                        const selected = selectable && selectedKeys.has(key)
                        return (
                          <tr
                            key={file.id}
                            className={`${selected ? 'selected' : ''} ${isPicker && !selectable ? 'is-disabled' : ''}`.trim()}
                            onDoubleClick={() => toggleSelect(file)}
                          >
                            {isPicker && (
                              <td className="text-center">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleSelect(file)}
                                  disabled={!selectable}
                                  title={!selectable ? 'Chỉ chọn được ảnh trong mục này' : undefined}
                                />
                              </td>
                            )}
                            <td className="text-center" style={{ width: 56 }}>{index + 1}</td>
                            <td className="text-center">
                              <span className="media-library-row-tools">
                                <MediaPreviewHover
                                  name={file.originalName}
                                  path={getMediaFilePreviewPath(file)}
                                  mimeType={file.mimeType}
                                  sizeBytes={file.sizeBytes}
                                />
                                {canDeleteMedia && (
                                  <button
                                    type="button"
                                    className="btn-icon text-error action-btn"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      handleDelete(file)
                                    }}
                                    title="Xoá"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </span>
                            </td>
                            <td className="media-library-file-name-cell">
                              <div className="media-library-name-cell">
                                {isImageMime(file.mimeType) ? <Image size={16} /> : <FileText size={16} />}
                                <span>{file.originalName}</span>
                              </div>
                            </td>
                            <td className="media-library-type-cell" title={file.mimeType || ''}>{file.mimeType || '-'}</td>
                            <td style={{ width: 160, whiteSpace: 'nowrap' }}>{formatBytes(file.sizeBytes)}</td>
                            <td className="media-library-path-cell" title={file.localPath || ''}>{file.localPath || '-'}</td>
                            <td className="media-library-url-cell" title={file.cloudUrl}>
                              {file.cloudUrl ? (
                                <span className="media-url-cell">
                                  <span>{file.cloudUrl}</span>
                                  <button type="button" className="btn-icon" title="Copy link" onClick={() => navigator.clipboard?.writeText(file.cloudUrl)}>
                                    <Copy size={14} />
                                  </button>
                                </span>
                              ) : '-'}
                            </td>
                            <td style={{ width: 180, whiteSpace: 'nowrap' }}>{formatDateTime(file.createdAt)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </div>
            </div>
          </section>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Đóng</button>
          {isPicker && (
            <>
              {selectedGroupId && !isSingleSelectPicker && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleConfirmGroup}
                  disabled={groupMembershipLoading || selectedGroupSnapshots.length === 0}
                >
                  <Check size={15} />
                  <span>Chọn thư mục</span>
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={handleConfirm}>
                <Check size={15} />
                <span>Chọn {selectedSnapshots.length > 0 ? `(${selectedSnapshots.length})` : ''}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
