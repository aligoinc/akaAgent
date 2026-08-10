export const IMAGE_FILE_EXTENSIONS = [
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpg',
  'jpeg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp'
] as const

export const VIDEO_FILE_EXTENSIONS = [
  '3g2',
  '3gp',
  'avi',
  'm2ts',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'ogv',
  'webm',
  'wmv'
] as const

const buildFileExtensionRegex = (extensions: readonly string[]): RegExp =>
  new RegExp(`\\.(${extensions.join('|')})(?:[?#].*)?$`, 'i')

export const IMAGE_FILE_EXTENSION_RE = buildFileExtensionRegex(IMAGE_FILE_EXTENSIONS)

export const VIDEO_FILE_EXTENSION_RE = buildFileExtensionRegex(VIDEO_FILE_EXTENSIONS)

export const IMAGE_FILE_ACCEPT = IMAGE_FILE_EXTENSIONS.map(extension => `.${extension}`).join(',')

export const VIDEO_FILE_ACCEPT = VIDEO_FILE_EXTENSIONS.map(extension => `.${extension}`).join(',')

export const IMAGE_VIDEO_FILE_ACCEPT = `${IMAGE_FILE_ACCEPT},${VIDEO_FILE_ACCEPT}`

export type MediaSelectionMode = 'image' | 'video' | 'image-video' | 'file'

export const isImageMimeType = (mimeType: unknown): boolean =>
  String(mimeType || '').trim().toLowerCase().startsWith('image/')

export const isVideoMimeType = (mimeType: unknown): boolean =>
  String(mimeType || '').trim().toLowerCase().startsWith('video/')

export const isImageMediaSource = (mimeType: unknown, ...sources: unknown[]): boolean => {
  if (isImageMimeType(mimeType)) return true
  return sources.some(source => {
    const value = String(source || '').trim()
    return /^data:image\//i.test(value) || IMAGE_FILE_EXTENSION_RE.test(value)
  })
}

export const isVideoMediaSource = (mimeType: unknown, ...sources: unknown[]): boolean => {
  if (isVideoMimeType(mimeType)) return true
  return sources.some(source => {
    const value = String(source || '').trim()
    return /^data:video\//i.test(value) || VIDEO_FILE_EXTENSION_RE.test(value)
  })
}

export const isImageOrVideoMediaSource = (mimeType: unknown, ...sources: unknown[]): boolean =>
  isImageMediaSource(mimeType, ...sources) || isVideoMediaSource(mimeType, ...sources)

export const mediaSourceMatchesSelectionMode = (
  mode: MediaSelectionMode,
  mimeType: unknown,
  ...sources: unknown[]
): boolean => {
  if (mode === 'file') return true
  if (mode === 'video') return isVideoMediaSource(mimeType, ...sources)
  if (mode === 'image-video') return isImageOrVideoMediaSource(mimeType, ...sources)
  return isImageMediaSource(mimeType, ...sources)
}

const RUNTIME_MEDIA_DOWNLOAD_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-msvideo': '.avi',
  'video/mpeg': '.mpeg',
  'video/x-matroska': '.mkv',
  'video/ogg': '.ogv',
  'video/x-ms-wmv': '.wmv',
  'video/3gpp': '.3gp',
  'video/3gpp2': '.3g2',
  'video/mp2t': '.m2ts',
  'application/pdf': '.pdf',
  'text/plain': '.txt'
}

export const getRuntimeMediaDownloadExtensionForMimeType = (mimeType: unknown): string =>
  RUNTIME_MEDIA_DOWNLOAD_EXTENSION_BY_MIME_TYPE[
    String(mimeType || '').split(';')[0].trim().toLowerCase()
  ] || ''

export interface RuntimeMediaSelectionSource {
  localPath?: unknown
  localPathAvailable?: boolean
  cloudUrl?: unknown
  name?: unknown
  mimeType?: unknown
}

const getSourceFileExtension = (source: unknown): string => {
  const value = String(source || '').trim()
  if (!value || /^data:/i.test(value)) return ''

  let pathname = value.split(/[?#]/, 1)[0]
  if (/^https?:\/\//i.test(value)) {
    try {
      pathname = new URL(value).pathname
    } catch {
      return ''
    }
  }

  const fileName = pathname.split(/[\\/]/).pop() || ''
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex > 0 ? fileName.slice(dotIndex) : ''
}

const resolvedSourceMatchesSelectionMode = (
  mode: MediaSelectionMode,
  source: unknown
): boolean => mediaSourceMatchesSelectionMode(mode, '', source)

/**
 * Mirrors the source precedence used by CampaignScheduler before its path-only
 * Facebook media guards run. MIME is considered only for an extensionless
 * cloud download, where runtime derives the temporary extension from Content-Type.
 */
export const runtimeMediaSourceMatchesSelectionMode = (
  mode: MediaSelectionMode,
  source: RuntimeMediaSelectionSource
): boolean => {
  if (mode === 'file') return true

  const localPath = String(source.localPath || '').trim()
  if (localPath && source.localPathAvailable !== false) {
    return resolvedSourceMatchesSelectionMode(mode, localPath)
  }

  const cloudUrl = String(source.cloudUrl || '').trim()
  if (!cloudUrl) return false
  if (/^data:/i.test(cloudUrl)) return resolvedSourceMatchesSelectionMode(mode, cloudUrl)

  const cloudExtension = getSourceFileExtension(cloudUrl)
  if (cloudExtension) return resolvedSourceMatchesSelectionMode(mode, cloudExtension)

  const nameExtension = getSourceFileExtension(source.name)
  if (nameExtension) return resolvedSourceMatchesSelectionMode(mode, nameExtension)

  const mimeExtension = getRuntimeMediaDownloadExtensionForMimeType(source.mimeType)
  return Boolean(mimeExtension) && resolvedSourceMatchesSelectionMode(mode, mimeExtension)
}
