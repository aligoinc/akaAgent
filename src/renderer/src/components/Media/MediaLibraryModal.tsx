import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Cloud, Copy, FileText, Image, RefreshCw, Save, Search, Trash2, Upload, X } from 'lucide-react'
import {
  CampaignMediaInput,
  CampaignMediaSnapshot,
  MEDIA_FILE_MAX_SIZE_BYTES,
  MEDIA_IMAGE_MAX_SIZE_BYTES,
  MEDIA_LIBRARY_MAX_FILES_PER_STAFF,
  MediaFile,
  MediaStorageSettings,
  MediaUploadFailure
} from '../../../../shared/types'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'

type MediaPickerMode = 'image' | 'file'

interface MediaLibraryModalProps {
  onClose: () => void
  pickerMode?: MediaPickerMode
  maxSelect?: number
  selectedMedia?: CampaignMediaInput[]
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

const mediaInputToSnapshot = (item: CampaignMediaInput): CampaignMediaSnapshot | null => {
  if (typeof item !== 'string') {
    return {
      name: item.name || getMediaName(item),
      localPath: item.localPath || '',
      cloudUrl: item.cloudUrl || '',
      mimeType: item.mimeType || '',
      sizeBytes: item.sizeBytes ?? null,
      provider: item.provider || ''
    }
  }

  const path = item.trim()
  if (!path) return null
  const isCloudUrl = /^https?:\/\//i.test(path)
  return {
    name: getMediaName(path),
    localPath: isCloudUrl ? '' : path,
    cloudUrl: isCloudUrl ? path : '',
    mimeType: '',
    sizeBytes: null,
    provider: ''
  }
}

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

export default function MediaLibraryModal({
  onClose,
  pickerMode,
  maxSelect,
  selectedMedia = [],
  onConfirm
}: MediaLibraryModalProps) {
  const user = useAuthStore(s => s.user)
  const showAlert = useUiStore(s => s.showAlert)
  const showConfirm = useUiStore(s => s.showConfirm)
  const isAdmin = !!user?.isAdminAkabiz
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [settings, setSettings] = useState<MediaStorageSettings>(EMPTY_SETTINGS)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [files, setFiles] = useState<MediaFile[]>([])
  const [filesLoading, setFilesLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(selectedMedia.map(getSnapshotKey).filter(Boolean)))

  const pickerLimit = Math.max(1, maxSelect ?? Number.MAX_SAFE_INTEGER)
  const isPicker = !!onConfirm
  const onlyImages = pickerMode === 'image'
  const activeMediaCount = files.length

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

  useEffect(() => {
    void loadSettings()
    void loadFiles()
  }, [])

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase()
    return files.filter(file => {
      if (onlyImages && !isImageMime(file.mimeType)) return false
      if (!q) return true
      return [
        file.originalName,
        file.localPath || '',
        file.cloudUrl,
        file.mimeType || '',
        file.provider
      ].some(value => String(value).toLowerCase().includes(q))
    })
  }, [files, onlyImages, search])

  const selectedMediaByKey = useMemo(() => {
    const entries = selectedMedia
      .map(mediaInputToSnapshot)
      .filter((item): item is CampaignMediaSnapshot => !!item)
      .map(item => [getSnapshotKey(item), item] as const)
      .filter(([key]) => Boolean(key))
    return new Map(entries)
  }, [selectedMedia])

  const selectedSnapshots = useMemo(() => {
    const filesByKey = new Map(files.map(file => [getSnapshotKey(fileToSnapshot(file)), file]))
    return Array.from(selectedKeys)
      .map(key => {
        const file = filesByKey.get(key)
        return file ? fileToSnapshot(file) : selectedMediaByKey.get(key)
      })
      .filter((item): item is CampaignMediaSnapshot => !!item)
  }, [files, selectedKeys, selectedMediaByKey])

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
        setSelectedKeys(current => {
          const next = new Set(current)
          for (const file of uploaded) {
            if (next.size >= pickerLimit) break
            next.add(getSnapshotKey(fileToSnapshot(file)))
          }
          return next
        })
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
        } catch (err) {
          showAlert(err instanceof Error ? err.message : 'Không thể xoá media.', 'error')
        }
      },
      { title: 'Xoá media', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const toggleSelect = (file: MediaFile) => {
    if (!isPicker) return
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

  const renderSettings = () => {
    if (isPicker) return null
    if (!isAdmin) return null
    return (
      <section className="media-library-section">
        <div className="media-library-section-title">
          <Cloud size={16} />
          <span>Cấu hình cloud</span>
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
            <div className="media-library-toolbar">
              <div className="media-library-toolbar-main">
                <button
                  type="button"
                  className="btn btn-primary btn-sm media-library-upload-button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploading || settingsLoading || !settings.isConfigured}
                >
                  {uploading ? <RefreshCw size={14} className="spin" /> : <Upload size={14} />}
                  <span>{uploading ? 'Đang upload' : 'Upload'}</span>
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
              </div>
              <div className="media-library-toolbar-tools">
                <div className="media-library-search">
                  <Search size={15} />
                  <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm media" />
                </div>
                <button type="button" className="btn-icon media-library-refresh" onClick={loadFiles} disabled={filesLoading} title="Tải lại">
                  <RefreshCw size={15} className={filesLoading ? 'spin' : ''} />
                </button>
              </div>
            </div>

            <div className="stepper-grid-container media-library-grid">
              <table className="campaign-grid">
                <thead>
                  <tr>
                    {isPicker && <th style={{ width: 44 }}></th>}
                    <th style={{ width: 56, textAlign: 'center' }}>STT</th>
                    <th>Tên file</th>
                    <th style={{ width: 120 }}>Loại</th>
                    <th style={{ width: 160, whiteSpace: 'nowrap' }}>Dung lượng</th>
                    <th>Local path</th>
                    <th>Cloud URL</th>
                    <th style={{ width: 180, whiteSpace: 'nowrap' }}>Ngày upload</th>
                    <th style={{ width: 72 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filesLoading ? (
                    <tr><td colSpan={isPicker ? 9 : 8} className="text-center text-muted">Đang tải...</td></tr>
                  ) : filteredFiles.length === 0 ? (
                    <tr><td colSpan={isPicker ? 9 : 8} className="text-center text-muted">Chưa có media</td></tr>
                  ) : filteredFiles.map((file, index) => {
                    const snapshot = fileToSnapshot(file)
                    const key = getSnapshotKey(snapshot)
                    const selected = selectedKeys.has(key)
                    return (
                      <tr key={file.id} className={selected ? 'selected' : ''} onDoubleClick={() => toggleSelect(file)}>
                        {isPicker && (
                          <td className="text-center">
                            <input type="checkbox" checked={selected} onChange={() => toggleSelect(file)} />
                          </td>
                        )}
                        <td className="text-center" style={{ width: 56 }}>{index + 1}</td>
                        <td>
                          <div className="media-library-name-cell">
                            {isImageMime(file.mimeType) ? <Image size={16} /> : <FileText size={16} />}
                            <span>{file.originalName}</span>
                          </div>
                        </td>
                        <td>{file.mimeType || '-'}</td>
                        <td style={{ width: 160, whiteSpace: 'nowrap' }}>{formatBytes(file.sizeBytes)}</td>
                        <td className="text-truncate" title={file.localPath || ''}>{file.localPath || '-'}</td>
                        <td className="text-truncate" title={file.cloudUrl}>
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
                        <td className="text-center">
                          <button type="button" className="btn-icon text-error action-btn" onClick={() => handleDelete(file)} title="Xoá">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Đóng</button>
          {isPicker && (
            <button type="button" className="btn btn-primary" onClick={handleConfirm}>
              <Check size={15} />
              <span>Chọn {selectedSnapshots.length > 0 ? `(${selectedSnapshots.length})` : ''}</span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
