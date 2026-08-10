import {
  MEDIA_FILE_MAX_SIZE_BYTES,
  MEDIA_IMAGE_MAX_SIZE_BYTES,
  type Campaign,
  type CampaignMediaInput,
  type CampaignMediaSnapshot
} from '../../../../shared/types'
import {
  isImageMediaSource,
  isImageOrVideoMediaSource,
  isVideoMediaSource,
  runtimeMediaSourceMatchesSelectionMode,
  type MediaSelectionMode
} from '../../../../shared/mediaTypes'

const ZALO_TOGGLEABLE_MESSAGE_ACTION_IDS = new Set([
  'zalo_message_phone',
  'zalo_message_group_member',
  'zalo_message_group_realtime',
  'zalo_message_remarketing_customer',
  'zalo_message_friend_recommendation'
])

interface LocalCampaignMediaOptions {
  mode: MediaSelectionMode
  maxSelect?: number
}

export interface LocalCampaignMediaSelection {
  snapshots: CampaignMediaSnapshot[]
  failures: string[]
}

export const isCampaignMediaImage = (item: CampaignMediaInput): boolean => {
  if (typeof item === 'string') {
    return isImageMediaSource('', item)
  }
  return isImageMediaSource(
    item.mimeType,
    item.localPath,
    item.cloudUrl,
    item.name
  )
}

export const isCampaignMediaVideo = (item: CampaignMediaInput): boolean => {
  if (typeof item === 'string') {
    return isVideoMediaSource('', item)
  }
  return isVideoMediaSource(
    item.mimeType,
    item.localPath,
    item.cloudUrl,
    item.name
  )
}

export const isCampaignMediaImageOrVideo = (item: CampaignMediaInput): boolean => {
  if (typeof item === 'string') {
    return isImageOrVideoMediaSource('', item)
  }
  return isImageOrVideoMediaSource(
    item.mimeType,
    item.localPath,
    item.cloudUrl,
    item.name
  )
}

export const filterCampaignMediaBySelectionMode = (
  items: CampaignMediaSnapshot[],
  mode: MediaSelectionMode
): CampaignMediaSnapshot[] => items.filter(item => campaignMediaMatchesRuntimeSelectionMode(item, mode))

const isImageFile = (file: File): boolean => isImageMediaSource(file.type, file.name)

const getRuntimeMediaName = (item: CampaignMediaInput): string => {
  if (typeof item === 'string') return item.split(/[\\/]/).pop() || item
  return String(item.name || '').trim() ||
    String(item.localPath || '').split(/[\\/]/).pop() ||
    String(item.cloudUrl || '').split('/').pop()?.split('?')[0] ||
    ''
}

const isLocalMediaAvailable = (localPath: string): boolean => {
  if (!localPath) return false
  if (/^data:/i.test(localPath)) return true
  try {
    return window.electronAPI.fileExists(localPath)
  } catch {
    return false
  }
}

export const campaignMediaMatchesRuntimeSelectionMode = (
  item: CampaignMediaInput,
  mode: MediaSelectionMode
): boolean => {
  if (mode === 'file') return true

  if (typeof item === 'string') {
    const value = item.trim()
    if (!value) return false
    if (/^https?:\/\//i.test(value)) {
      return runtimeMediaSourceMatchesSelectionMode(mode, {
        cloudUrl: value,
        name: getRuntimeMediaName(item)
      })
    }
    return runtimeMediaSourceMatchesSelectionMode(mode, {
      localPath: value,
      localPathAvailable: isLocalMediaAvailable(value),
      name: getRuntimeMediaName(item)
    })
  }

  const localPath = String(item.localPath || '').trim()
  return runtimeMediaSourceMatchesSelectionMode(mode, {
    localPath,
    localPathAvailable: isLocalMediaAvailable(localPath),
    cloudUrl: item.cloudUrl,
    name: getRuntimeMediaName(item),
    mimeType: item.mimeType
  })
}

const fileMatchesMode = (file: File, localPath: string, mode: MediaSelectionMode): boolean =>
  runtimeMediaSourceMatchesSelectionMode(mode, {
    localPath,
    localPathAvailable: true,
    name: file.name,
    mimeType: file.type
  })

const formatBytes = (value: number): string => {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${Math.round(value / 1024 / 1024)} MB`
}

export const selectLocalCampaignMedia = (
  rawFiles: File[],
  options: LocalCampaignMediaOptions
): LocalCampaignMediaSelection => {
  const maxSelect = options.maxSelect ?? Number.MAX_SAFE_INTEGER
  if (rawFiles.length > maxSelect) {
    return {
      snapshots: [],
      failures: [`Chỉ có thể chọn tối đa ${maxSelect} media.`]
    }
  }

  const snapshots: CampaignMediaSnapshot[] = []
  const failures: string[] = []
  const selectedPaths = new Set<string>()

  for (const file of rawFiles) {
    let localPath = ''
    try {
      localPath = window.electronAPI.getPathForFile(file).trim()
    } catch {}

    if (!localPath) {
      failures.push(`${file.name || 'File'}: Không xác định được đường dẫn local.`)
      continue
    }
    if (!window.electronAPI.fileExists(localPath)) {
      failures.push(`${file.name || 'File'}: File local không còn tồn tại.`)
      continue
    }
    if (!fileMatchesMode(file, localPath, options.mode)) {
      const expected = options.mode === 'image-video' ? 'ảnh hoặc video' : options.mode === 'video' ? 'video' : 'ảnh'
      failures.push(`${file.name || 'File'}: Định dạng ${expected} không được runtime hỗ trợ.`)
      continue
    }

    const imageFile = isImageFile(file)
    const sizeLimit = imageFile ? MEDIA_IMAGE_MAX_SIZE_BYTES : MEDIA_FILE_MAX_SIZE_BYTES
    if (file.size > sizeLimit) {
      failures.push(`${file.name || 'File'}: Vượt quá dung lượng tối đa ${formatBytes(sizeLimit)}.`)
      continue
    }

    const stablePath = window.electronAPI.platform === 'win32'
      ? localPath.toLowerCase()
      : localPath
    if (selectedPaths.has(stablePath)) continue
    selectedPaths.add(stablePath)

    snapshots.push({
      name: file.name || localPath.split(/[\\/]/).pop() || 'Media',
      localPath,
      cloudUrl: '',
      mimeType: file.type || '',
      sizeBytes: file.size,
      provider: 'local'
    })
  }

  return { snapshots, failures }
}

export const summarizeLocalCampaignMediaFailures = (failures: string[]): string => {
  const details = failures.slice(0, 3).join('\n')
  return failures.length > 3
    ? `${details}\n... và ${failures.length - 3} file khác.`
    : details
}

export const isLocalOnlyCampaignMedia = (item: CampaignMediaInput): boolean => {
  if (typeof item === 'string') {
    const value = item.trim()
    return Boolean(value) && !value.startsWith('data:') && !/^https?:\/\//i.test(value)
  }
  return Boolean(String(item.localPath || '').trim()) && !String(item.cloudUrl || '').trim()
}

const normalizeLocalPathIdentity = (value: string): string =>
  window.electronAPI.platform === 'win32' ? value.toLowerCase() : value

const getCampaignMediaIdentityKeys = (item: CampaignMediaInput): string[] => {
  if (typeof item === 'string') {
    const value = item.trim()
    if (!value) return []
    if (/^https?:\/\//i.test(value)) return [`url:${value}`]
    if (value.startsWith('data:')) return [`data:${value}`]
    return [`path:${normalizeLocalPathIdentity(value)}`]
  }

  const keys: string[] = []
  const localPath = String(item.localPath || '').trim()
  const cloudUrl = String(item.cloudUrl || '').trim()
  if (localPath) keys.push(`path:${normalizeLocalPathIdentity(localPath)}`)
  if (cloudUrl) keys.push(`url:${cloudUrl}`)
  if (keys.length === 0 && item.name) keys.push(`name:${item.name}`)
  return keys
}

export const getUniqueCampaignMediaAdditions = (
  current: CampaignMediaInput[],
  candidates: CampaignMediaInput[]
): CampaignMediaInput[] => {
  const identities = new Set(current.flatMap(getCampaignMediaIdentityKeys))
  return candidates.filter(item => {
    const itemIdentities = getCampaignMediaIdentityKeys(item)
    if (itemIdentities.some(identity => identities.has(identity))) return false
    itemIdentities.forEach(identity => identities.add(identity))
    return itemIdentities.length > 0
  })
}

export const campaignHasLocalOnlyMedia = (campaign: Campaign): boolean => {
  const extra = campaign.extraSettings || {}
  const hasLocalOnly = (items: CampaignMediaInput[] | undefined): boolean =>
    Array.isArray(items) && items.some(isLocalOnlyCampaignMedia)

  // This helper guards a Zalo Desktop -> Server subtype change. Only Zalo
  // message actions expose/use main media; the other Zalo actions can retain
  // hidden media from an earlier form selection, but never send it.
  if (!campaign.actionId.startsWith('zalo_message_')) return false
  if (ZALO_TOGGLEABLE_MESSAGE_ACTION_IDS.has(campaign.actionId) && extra.enableMessage !== true) {
    return false
  }

  if (extra.advancedContentEnabled === true) {
    const advancedItems = Array.isArray(extra.advancedContentItems) ? extra.advancedContentItems : []
    return advancedItems.some(item => (
      (item.mediaOption === 'all' || item.mediaOption === 'random') && hasLocalOnly(item.mediaItems)
    ))
  }

  return extra.imageOption !== 'none' && hasLocalOnly(campaign.images)
}
